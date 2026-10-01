'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// scaffoldReleaseBundleLib.js — writes one PESC release bundle from a release folder and its
// manifest entry (DESIGN-pescForge.md §4.2; gate F15). The CLI (scaffoldReleaseBundle.js) gathers
// the facts of the moment and calls this; the gate calls it directly on scratch folders.
//
//   scaffoldReleaseBundle({ releaseFolderPath, manifestPath, outputRootPath, expanderProvenanceText,
//                           scaffoldCommandText, copiedDateText }, callback)
//     → callback('', { bundleDirPath, releaseNames, releaseCensus, writtenRelativePathList })
//
// In order, each step refusing by name, and nothing written before step 6:
//   1. ARGUMENTS  every path exists; the folder holds .xsd files and nothing else
//   2. ENTRY      releaseManifest.json has exactly one entry whose folderName is the folder's name
//   3. FOLDER     that entry's memberFiles are exactly the folder's files by sha256 (the same check
//                 loader 2 makes at every forge, manifestEntryLoader.js)
//   4. PARSE      the parser, the resolution table and the census run over the folder, so an
//                 untaught construct in a future PESC edition is refused HERE, never in a build
//   5. NAMES      releaseNames.js; the bundle directory must not exist (no overwrite, ever)
//   6. WRITE      the bundle directory, the .xsd files copied with COPYFILE_EXCL, every other file
//                 from bundleTemplates.js with flag 'wx'; then every copied byte re-read and
//                 compared with the source
// It never edits a byte of a source file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const refuse = require(path.join(__dirname, '..', '..', 'forge-framework', 'refuse'));
const { parsePescCorpus } = require('../xsdParser')();
const resolutionTableLib = require('../resolutionTable');
const releaseCensusLib = require('../releaseCensus');
const manifestEntryLoader = require('../manifestEntryLoader');
const { deriveReleaseNames } = require('../releaseNames');
const { parseJsonText } = require('../jsonText');
const bundleTemplates = require('./bundleTemplates');

const XSD_FILE_NAME_RE = /\.xsd$/i;
const SNAPSHOT_RELATIVE_DIR = path.join('assets', 'standardSourceData', '01');
const REQUIRED_ARGUMENT_NAME_LIST = Object.freeze(['releaseFolderPath', 'manifestPath', 'outputRootPath', 'expanderProvenanceText', 'scaffoldCommandText', 'copiedDateText']);

const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const sha256OfFile = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

// runOperationList — each operation is (done) => ..., done(errorOrNull); run in order, stop at the first error
const runOperationList = (operationList, callback) => {
	const runFrom = (operationIndex) => {
		if (operationIndex >= operationList.length) {
			callback(null);
			return;
		}
		operationList[operationIndex]((operationError) => {
			if (operationError) {
				callback(operationError);
				return;
			}
			runFrom(operationIndex + 1);
		});
	};
	runFrom(0);
};

const scaffoldReleaseBundle = (scaffoldArgs, callback) => {
	const taskList = new taskListPlus();

	// 1. ARGUMENTS
	taskList.push((args, next) => {
		const missingArgumentName = REQUIRED_ARGUMENT_NAME_LIST.find((oneName) => typeof scaffoldArgs[oneName] !== 'string' || scaffoldArgs[oneName].length === 0);
		if (missingArgumentName !== undefined) {
			next(refusalText(`argument '${missingArgumentName}' is ${JSON.stringify(scaffoldArgs[missingArgumentName])}`, `scaffoldReleaseBundle needs ${REQUIRED_ARGUMENT_NAME_LIST.join(', ')}, each a non-empty string`));
			return;
		}
		const { releaseFolderPath, manifestPath, outputRootPath } = scaffoldArgs;
		const notADirectoryPath = [releaseFolderPath, outputRootPath].find((onePath) => !fs.existsSync(onePath) || !fs.statSync(onePath).isDirectory());
		if (notADirectoryPath !== undefined) {
			next(refusalText(`'${notADirectoryPath}' is not a directory`, 'the release folder and the output root are existing directories'));
			return;
		}
		if (!fs.existsSync(manifestPath)) {
			next(refusalText(`manifest '${manifestPath}' is not on disk`, "the manifest is pescReleaseExpander's releaseManifest.json"));
			return;
		}
		const folderFileNameList = fs.readdirSync(releaseFolderPath).sort();
		const notXsdFileName = folderFileNameList.find((oneFileName) => !XSD_FILE_NAME_RE.test(oneFileName));
		if (notXsdFileName !== undefined || folderFileNameList.length === 0) {
			next(refusalText(`release folder '${releaseFolderPath}' holds ${notXsdFileName === undefined ? 'no files' : `'${notXsdFileName}'`}`, 'a release folder holds its .xsd files and nothing else'));
			return;
		}
		next('', { ...args, ...scaffoldArgs, folderFileNameList });
	});

	// 2. ENTRY
	taskList.push((args, next) => {
		const parsedManifest = parseJsonText(fs.readFileSync(args.manifestPath, 'utf8'));
		if (parsedManifest.error) {
			next(refusalText(`manifest '${args.manifestPath}' is not JSON: ${parsedManifest.error}`, "the manifest is pescReleaseExpander's releaseManifest.json"));
			return;
		}
		const releaseManifest = parsedManifest.value;
		if (!Array.isArray(releaseManifest.releases)) {
			next(refusalText(`manifest '${args.manifestPath}' has no releases list`, "the manifest is pescReleaseExpander's releaseManifest.json"));
			return;
		}
		const folderName = path.basename(args.releaseFolderPath);
		const matchingEntryList = releaseManifest.releases.filter((oneEntry) => oneEntry.folderName === folderName);
		if (matchingEntryList.length !== 1) {
			next(refusalText(`manifest '${args.manifestPath}' has ${matchingEntryList.length} entries whose folderName is '${folderName}'`, 'exactly one selected release names the folder'));
			return;
		}
		const manifestEntryDocument = {
			copiedFromManifest: { manifestFormat: releaseManifest.manifestFormat, sourceCorpus: releaseManifest.sourceCorpus },
			releaseEntry: matchingEntryList[0],
		};
		next('', { ...args, manifestEntryDocument });
	});

	// 3. FOLDER
	taskList.push((args, next) => {
		const checked = manifestEntryLoader.checkManifestEntryAgainstFolder({
			manifestEntryDocument: args.manifestEntryDocument,
			xsdFileShaByFileName: manifestEntryLoader.readXsdFileShaByFileName({ folderPath: args.releaseFolderPath }),
			manifestEntryFileName: `the manifest entry for '${path.basename(args.releaseFolderPath)}'`,
		});
		if (checked.refusalMessage) {
			next(checked.refusalMessage);
			return;
		}
		next('', { ...args, releaseEntry: checked.loadedManifestEntry.releaseEntry });
	});

	// 4. PARSE
	taskList.push((args, next) => {
		parsePescCorpus({ sourcePath: args.releaseFolderPath }, (parseError, parsedCorpus) => {
			if (parseError) {
				next(parseError);
				return;
			}
			const resolved = resolutionTableLib.resolveRelease({ artifacts: parsedCorpus.artifacts });
			if (resolved.refusalMessage) {
				next(resolved.refusalMessage);
				return;
			}
			const measured = releaseCensusLib.measureReleaseCensus({ artifacts: parsedCorpus.artifacts, referenceCensus: resolved.referenceCensus });
			if (measured.refusalMessage) {
				next(measured.refusalMessage);
				return;
			}
			const rootArtifact = parsedCorpus.artifacts.find((oneArtifact) => oneArtifact.filename === args.releaseEntry.rootFilename);
			next('', { ...args, releaseCensus: measured.census, rootTargetNamespace: rootArtifact.targetNamespace });
		});
	});

	// 5. NAMES
	taskList.push((args, next) => {
		const derived = deriveReleaseNames({ standard: args.releaseEntry.standard, version: args.releaseEntry.version });
		if (derived.refusalMessage) {
			next(derived.refusalMessage);
			return;
		}
		const bundleDirPath = path.join(args.outputRootPath, derived.releaseNames.standardKey);
		if (fs.existsSync(bundleDirPath)) {
			next(refusalText(`bundle directory '${bundleDirPath}' already exists`, 'the scaffold tool never overwrites a bundle; remove it deliberately first'));
			return;
		}
		next('', { ...args, releaseNames: derived.releaseNames, bundleDirPath });
	});

	// 6. WRITE — callback fs throughout, so a failed write is a refusal and never a throw. The
	// non-recursive mkdir of the bundle directory is the atomic claim: if step 5's check was raced,
	// it fails here with EEXIST rather than writing into someone else's bundle.
	taskList.push((args, next) => {
		const { releaseNames, bundleDirPath, releaseEntry, manifestEntryDocument } = args;
		const releaseName = releaseEntry.releaseName;
		const snapshotDirPath = path.join(bundleDirPath, SNAPSHOT_RELATIVE_DIR);
		const manifestEntryRelativePath = manifestEntryLoader.MANIFEST_ENTRY_FILE_NAME;
		const shaByRelativePath = {};
		const fileTextByRelativePath = {};

		const operationList = [
			(done) => fs.mkdir(bundleDirPath, done),
			(done) => fs.mkdir(path.join(bundleDirPath, 'lib'), done),
			(done) => fs.mkdir(path.join(bundleDirPath, 'test'), done),
			(done) => fs.mkdir(snapshotDirPath, { recursive: true }, (mkdirError) => done(mkdirError)),
		]
			.concat(args.folderFileNameList.map((oneFileName) => (done) => fs.copyFile(path.join(args.releaseFolderPath, oneFileName), path.join(snapshotDirPath, oneFileName), fs.constants.COPYFILE_EXCL, done)))
			.concat([
				(done) => fs.writeFile(path.join(snapshotDirPath, manifestEntryRelativePath), bundleTemplates.jsonFileText(manifestEntryDocument), { flag: 'wx' }, done),
				(done) => {
					args.folderFileNameList.concat([manifestEntryRelativePath]).forEach((oneFileName) => {
						shaByRelativePath[oneFileName] = sha256OfFile(path.join(snapshotDirPath, oneFileName));
					});
					const templateArgs = {
						releaseNames,
						releaseName,
						releaseCensus: args.releaseCensus,
						rootTargetNamespace: args.rootTargetNamespace,
						manifestEntryDocument,
						shaByRelativePath,
						releaseFolderPath: args.releaseFolderPath,
						manifestPath: args.manifestPath,
						expanderProvenanceText: args.expanderProvenanceText,
						scaffoldCommandText: args.scaffoldCommandText,
						copiedDateText: args.copiedDateText,
					};
					Object.assign(fileTextByRelativePath, {
						'parserDescriptor.ini': bundleTemplates.parserDescriptorText(templateArgs),
						'package.json': bundleTemplates.packageJsonText(templateArgs),
						[releaseNames.entryModuleFileName]: bundleTemplates.entryModuleText(templateArgs),
						'roundTripValidator.js': bundleTemplates.roundTripValidatorText(templateArgs),
						[path.join('lib', 'declaration.js')]: bundleTemplates.declarationModuleText(templateArgs),
						[path.join('lib', 'releaseDeclaration.json')]: bundleTemplates.releaseDeclarationText(templateArgs),
						[path.join('lib', 'releaseCensus.json')]: bundleTemplates.releaseCensusText(templateArgs),
						[path.join('test', 'test-release.js')]: bundleTemplates.releaseTestText(templateArgs),
						[path.join(SNAPSHOT_RELATIVE_DIR, 'SHA256SUMS')]: bundleTemplates.checksumFileText(templateArgs),
						[path.join(SNAPSHOT_RELATIVE_DIR, 'standardSourceLocation')]: bundleTemplates.standardSourceLocationText(templateArgs),
						[path.join(SNAPSHOT_RELATIVE_DIR, 'README_PROVENANCE.md')]: bundleTemplates.provenanceReadmeText(templateArgs),
					});
					runOperationList(
						Object.keys(fileTextByRelativePath).map((oneRelativePath) => (writeDone) => fs.writeFile(path.join(bundleDirPath, oneRelativePath), fileTextByRelativePath[oneRelativePath], { flag: 'wx' }, writeDone)),
						done,
					);
				},
			]);

		runOperationList(operationList, (writeError) => {
			if (writeError) {
				next(refusalText(`writing bundle '${bundleDirPath}' failed: ${writeError.message}`, 'the scaffold tool writes a new bundle directory and never overwrites a file'));
				return;
			}
			const miscopiedFileName = args.folderFileNameList.find((oneFileName) => sha256OfFile(path.join(snapshotDirPath, oneFileName)) !== sha256OfFile(path.join(args.releaseFolderPath, oneFileName)));
			if (miscopiedFileName !== undefined) {
				next(refusalText(`the copy of '${miscopiedFileName}' in ${snapshotDirPath} differs from the source`, 'every .xsd file is copied byte for byte'));
				return;
			}
			const writtenRelativePathList = args.folderFileNameList
				.map((oneFileName) => path.join(SNAPSHOT_RELATIVE_DIR, oneFileName))
				.concat([path.join(SNAPSHOT_RELATIVE_DIR, manifestEntryRelativePath)], Object.keys(fileTextByRelativePath))
				.sort();
			next('', { ...args, writtenRelativePathList });
		});
	});

	pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
		if (pipelineError) {
			callback(pipelineError);
			return;
		}
		callback('', { bundleDirPath: args.bundleDirPath, releaseNames: args.releaseNames, releaseCensus: args.releaseCensus, writtenRelativePathList: args.writtenRelativePathList });
	});
};

module.exports = { scaffoldReleaseBundle, SNAPSHOT_RELATIVE_DIR, moduleName };
