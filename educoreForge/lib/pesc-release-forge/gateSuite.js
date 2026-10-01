'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// gateSuite.js — the PESC release gates, run by every release bundle's test/test-release.js
// (DESIGN-pescForge.md §6; WORKORDER §3). ALL PURE: skipEmbedding true, no Docker, no network.
//
//   runReleaseGateSuite({ harness, bundleDirPath }, whenDone)
//
// Phase F1 gates (each conjunct OBSERVED RED under its own twin before the family counts as green;
// the framework's gate engine does the sweep, testSupport/gateSuiteRunner):
//   F1-CHECKSUM    the framework verifies every snapshot byte against SHA256SUMS; one altered byte
//                  of CoreMain is refused by the checksum, not by anything later
//   F2-MANIFEST    loader 2 holds the folder to the expander's manifest entry; one edited member sha
//                  (SHA256SUMS resealed, so only loader 2 can see it) is refused
//   F3-VERSION     the root carries the release version from standardSourceLocation; no version is
//                  refused by the forge's own guard, and a version that disagrees with the manifest
//                  entry is refused too
//   F4-CENSUS      the forge's census equals the bundle's frozen census AND the work order's literal;
//                  one xs:element removed (every seal resealed) is refused by the census
//   F5-RESOLUTION  every reference resolves inside the release and the count equals the expander's;
//                  one type= repointed at a missing name (resealed) is refused by name
//   F15-SCAFFOLD   the committed bundle is exactly what the scaffold tool writes; the tool refuses to
//                  overwrite, refuses a folder that disagrees with its entry, and refuses a folder the
//                  parser refuses (an xs:union)
//   F1-ROLES       (extra) the node-kind table equals the design's §2.1 and the declaration is
//                  accepted with no migration allowance
//
// Twins build SCRATCH snapshots, release folders and output roots under the OS temp directory and
// remove them at the end. Nothing in the tree is written. Production mutations are compiled in
// memory (moduleDouble), never written to disk. "Resealed" means the twin also rewrites the seals
// that would otherwise catch the fault first (SHA256SUMS, and the manifest entry's member sha), so
// the conjunct proves the guard it names and not an earlier one.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TREE_ROOT = path.join(__dirname, '..', '..');
const FORGE_FRAMEWORK_DIR = path.join(TREE_ROOT, 'lib', 'forge-framework');
const { runGateFamily } = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'gateSuiteRunner'));
const moduleDouble = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'moduleDouble'));
const { makeTwinRegistry } = require(path.join(FORGE_FRAMEWORK_DIR, 'roundTripHarness', 'twinRegistry'));
const forgeDeclarationContract = require(path.join(FORGE_FRAMEWORK_DIR, 'forgeDeclarationContract'));
const { MIGRATING_BUNDLE_LIST } = require(path.join(FORGE_FRAMEWORK_DIR, 'migrationAllowanceRegistry'));
const forgeFrameworkFactory = require(path.join(FORGE_FRAMEWORK_DIR, 'forge-framework'));
const { parseChecksumFile } = require(path.join(FORGE_FRAMEWORK_DIR, 'sourceVerification'));
const { DME_ROLES } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));
const rosterLib = require(path.join(FORGE_FRAMEWORK_DIR, 'roster'));

const releaseBundle = require('./releaseBundle');
const { buildNodeKindTable } = require('./nodeKindTable');
const manifestEntryLoader = require('./manifestEntryLoader');
const { parseJsonText } = require('./jsonText');
const bundleTemplates = require('./tools/bundleTemplates');

const LIBRARY_DIR = __dirname;
const HOOKS_MODULE_PATH = path.join(LIBRARY_DIR, 'hooks.js');
const MANIFEST_ENTRY_LOADER_PATH = path.join(LIBRARY_DIR, 'manifestEntryLoader.js');
const VERSION_GUARD_PATH = path.join(LIBRARY_DIR, 'versionGuard.js');
const RELEASE_CENSUS_PATH = path.join(LIBRARY_DIR, 'releaseCensus.js');
const RESOLUTION_TABLE_PATH = path.join(LIBRARY_DIR, 'resolutionTable.js');
const XSD_PARSER_PATH = path.join(LIBRARY_DIR, 'xsdParser.js');
const SCAFFOLD_LIB_PATH = path.join(LIBRARY_DIR, 'tools', 'scaffoldReleaseBundleLib.js');
const BUNDLE_TEMPLATES_PATH = path.join(LIBRARY_DIR, 'tools', 'bundleTemplates.js');
const EXPECTED_LITERALS_PATH = path.join(LIBRARY_DIR, 'expectedReleaseLiterals.json');

const SNAPSHOT_CONTAINER_NAME = 'standardSourceData';
const CHECKSUM_FILE_NAME = 'SHA256SUMS';
const PROVENANCE_FILE_NAME = 'standardSourceLocation';
const PROVENANCE_README_RELATIVE_PATH = path.join('assets', SNAPSHOT_CONTAINER_NAME, '01', 'README_PROVENANCE.md');
const CORE_MAIN_FILE_RE = /^CoreMain_v[\d.]+\.xsd$/;
const CODES_FILE_RE = /^iso_3166-1_v[\d.]+\.xsd$/;

// ---- the ruled role table (DESIGN-pescForge.md §2.1, revision 3; QUIET_ORBIT ruling 3A.3), as suffix → role
const RULED_ROLE_BY_LABEL_SUFFIX = Object.freeze({
	Release: 'DmeSupport',
	SchemaFile: 'DmeSupport',
	Type: 'DmeClass',
	AnonymousType: 'DmeClass',
	Element: 'DmeProperty',
	Attribute: 'DmeProperty',
	GlobalElement: 'DmeProperty',
	Occurrence: 'DmeSupport',
	CodeList: 'DmeOptionSet',
	Code: 'DmeOptionValue',
	DataType: 'DmeSupport',
	Group: 'DmeSupport',
});

const sha256OfBuffer = (fileBuffer) => crypto.createHash('sha256').update(fileBuffer).digest('hex');
const readJsonOrThrow = (filePath) => {
	const parsedJson = parseJsonText(fs.readFileSync(filePath, 'utf8'));
	if (parsedJson.error) {
		throw new Error(`${moduleName}: fixture fault — ${filePath} is not JSON: ${parsedJson.error}`);
	}
	return parsedJson.value;
};

// a text substitution that must apply exactly once, or the fixture is at fault (a twin that changed
// nothing would prove nothing)
const replacedOnce = ({ fileText, findText, replaceText, fileName }) => {
	const matchCount = fileText.split(findText).length - 1;
	if (matchCount !== 1) {
		throw new Error(`${moduleName}: fixture fault — '${findText.slice(0, 80)}' occurs ${matchCount} times in ${fileName}, not once`);
	}
	return fileText.replace(findText, replaceText);
};

const runReleaseGateSuite = ({ harness, bundleDirPath }, whenDone) => {
	const bundleData = releaseBundle.readBundleData({ bundleDirPath });
	const { releaseDeclarationData } = bundleData;
	const releaseName = releaseDeclarationData.releaseName;
	const descriptorValueByName = rosterLib.readDescriptorSection(path.join(bundleDirPath, rosterLib.DESCRIPTOR_FILE_NAME)).valueByName;
	const realSnapshotDirPath = path.join(bundleDirPath, 'assets', SNAPSHOT_CONTAINER_NAME, descriptorValueByName.defaultSnapshot);
	const entryModulePath = path.join(bundleDirPath, descriptorValueByName.entryModule);
	const realManifestEntryDocument = readJsonOrThrow(path.join(realSnapshotDirPath, manifestEntryLoader.MANIFEST_ENTRY_FILE_NAME));
	const realReleaseEntry = realManifestEntryDocument.releaseEntry;
	const xsdFileNameList = realReleaseEntry.memberFiles.map((oneMember) => oneMember.filename).sort();
	const coreMainFileName = xsdFileNameList.find((oneFileName) => CORE_MAIN_FILE_RE.test(oneFileName));
	const codesFileName = xsdFileNameList.find((oneFileName) => CODES_FILE_RE.test(oneFileName));
	const expectedLiteralSet = readJsonOrThrow(EXPECTED_LITERALS_PATH).literalByReleaseName[releaseName];
	const standardKey = releaseDeclarationData.standardKey;

	// ---- scratch fixtures, all removed at the end
	const scratchRootPathList = [];
	const makeScratchRoot = (prefix) => {
		const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		scratchRootPathList.push(scratchRootPath);
		return scratchRootPath;
	};

	// a copy of a snapshot inside a standardSourceData/01 container (so the version stamp finds its
	// snapshot and provenance file); alterTextByFileName edits the copy only. resealManifestEntry
	// rewrites the member sha of every altered .xsd in releaseManifestEntry.json; resealChecksums
	// rewrites SHA256SUMS for every listed file.
	const makeScratchSnapshot = ({ baseSnapshotDirPath, alterTextByFileName = {}, resealManifestEntry = false, resealChecksums = false }) => {
		const snapshotDirPath = path.join(makeScratchRoot(`${standardKey}Snapshot-`), SNAPSHOT_CONTAINER_NAME, '01');
		fs.mkdirSync(snapshotDirPath, { recursive: true });
		fs.readdirSync(baseSnapshotDirPath).forEach((oneFileName) => fs.copyFileSync(path.join(baseSnapshotDirPath, oneFileName), path.join(snapshotDirPath, oneFileName)));
		Object.keys(alterTextByFileName).forEach((oneFileName) => {
			const filePath = path.join(snapshotDirPath, oneFileName);
			const originalText = fs.readFileSync(filePath, 'latin1');
			const alteredText = alterTextByFileName[oneFileName](originalText, oneFileName);
			if (alteredText === originalText) {
				throw new Error(`${moduleName}: fixture fault — the alteration of ${oneFileName} changed nothing`);
			}
			fs.writeFileSync(filePath, alteredText, 'latin1');
		});
		if (resealManifestEntry) {
			const manifestEntryPath = path.join(snapshotDirPath, manifestEntryLoader.MANIFEST_ENTRY_FILE_NAME);
			const manifestEntryDocument = readJsonOrThrow(manifestEntryPath);
			manifestEntryDocument.releaseEntry.memberFiles.forEach((oneMember) => {
				oneMember.sha256 = sha256OfBuffer(fs.readFileSync(path.join(snapshotDirPath, oneMember.filename)));
			});
			fs.writeFileSync(manifestEntryPath, bundleTemplates.jsonFileText(manifestEntryDocument));
		}
		if (resealChecksums) {
			const checksumFilePath = path.join(snapshotDirPath, CHECKSUM_FILE_NAME);
			const shaByRelativePath = {};
			parseChecksumFile(fs.readFileSync(checksumFilePath, 'utf8')).forEach((oneEntry) => {
				shaByRelativePath[oneEntry.relativePath] = sha256OfBuffer(fs.readFileSync(path.join(snapshotDirPath, oneEntry.relativePath)));
			});
			fs.writeFileSync(checksumFilePath, bundleTemplates.checksumFileText({ shaByRelativePath }));
		}
		return snapshotDirPath;
	};

	// a scratch release folder and a one-entry scratch manifest built from a snapshot, the scaffold
	// tool's inputs; alterTextByFileName edits the folder, and updateManifestSha makes the entry agree
	const makeScratchReleaseInputs = ({ alterTextByFileName = {}, updateManifestSha = false }) => {
		const scratchRootPath = makeScratchRoot(`${standardKey}Release-`);
		const releaseFolderPath = path.join(scratchRootPath, realReleaseEntry.folderName);
		fs.mkdirSync(releaseFolderPath);
		xsdFileNameList.forEach((oneFileName) => fs.copyFileSync(path.join(realSnapshotDirPath, oneFileName), path.join(releaseFolderPath, oneFileName)));
		Object.keys(alterTextByFileName).forEach((oneFileName) => {
			const filePath = path.join(releaseFolderPath, oneFileName);
			const originalText = fs.readFileSync(filePath, 'latin1');
			const alteredText = alterTextByFileName[oneFileName](originalText, oneFileName);
			if (alteredText === originalText) {
				throw new Error(`${moduleName}: fixture fault — the alteration of ${oneFileName} changed nothing`);
			}
			fs.writeFileSync(filePath, alteredText, 'latin1');
		});
		const releaseEntry = JSON.parse(JSON.stringify(realReleaseEntry));
		if (updateManifestSha) {
			releaseEntry.memberFiles.forEach((oneMember) => {
				oneMember.sha256 = sha256OfBuffer(fs.readFileSync(path.join(releaseFolderPath, oneMember.filename)));
			});
		}
		const manifestPath = path.join(scratchRootPath, 'releaseManifest.json');
		fs.writeFileSync(manifestPath, bundleTemplates.jsonFileText({ manifestFormat: realManifestEntryDocument.copiedFromManifest.manifestFormat, sourceCorpus: realManifestEntryDocument.copiedFromManifest.sourceCorpus, releases: [releaseEntry] }));
		const outputRootPath = path.join(scratchRootPath, 'forges');
		fs.mkdirSync(outputRootPath);
		return { releaseFolderPath, manifestPath, outputRootPath };
	};

	// ---- the faults the twins and refusal conjuncts use
	const withFirstByteAltered = (fileText) => String.fromCharCode(fileText.charCodeAt(0) ^ 0x20) + fileText.slice(1);
	const withOneMemberShaEdited = (fileText) => {
		const manifestEntryDocument = JSON.parse(fileText);
		const coreMainMember = manifestEntryDocument.releaseEntry.memberFiles.find((oneMember) => oneMember.filename === coreMainFileName);
		coreMainMember.sha256 = `${coreMainMember.sha256.slice(0, -1)}${coreMainMember.sha256.slice(-1) === '0' ? '1' : '0'}`;
		return bundleTemplates.jsonFileText(manifestEntryDocument);
	};
	const withoutPublishedVersionLine = (fileText) => fileText.replace(/^publishedVersion:.*\n/m, '');
	const DISAGREEING_VERSION = '0.0.1';
	const withDisagreeingPublishedVersion = (fileText) => fileText.replace(/^publishedVersion:.*$/m, `publishedVersion: ${DISAGREEING_VERSION}`);
	// the root's NoteMessage: one local element of the root's anonymous type
	const REMOVED_ELEMENT_TEXT = '<xs:element name="NoteMessage" type="core:NoteMessageType" minOccurs="0" maxOccurs="unbounded"/>';
	const withOneElementRemoved = (fileText, fileName) => replacedOnce({ fileText, findText: REMOVED_ELEMENT_TEXT, replaceText: '', fileName });
	const REPOINTED_TYPE_NAME = 'NoteMessageTypeAbsent';
	const withOneTypeRepointed = (fileText, fileName) => replacedOnce({ fileText, findText: REMOVED_ELEMENT_TEXT, replaceText: REMOVED_ELEMENT_TEXT.replace('core:NoteMessageType"', `core:${REPOINTED_TYPE_NAME}"`), fileName });
	const UNION_TARGET_TEXT = '<xs:simpleType name="AccreditationTypeType">';
	const withUnionInserted = (fileText, fileName) => replacedOnce({ fileText, findText: UNION_TARGET_TEXT, replaceText: `${UNION_TARGET_TEXT}<xs:union memberTypes="xs:string xs:token"/>`, fileName });
	const rootFileName = realReleaseEntry.rootFilename;

	// ---- the subject every conjunct reads and every twin mutates (on a clone)
	const makeSubject = () => ({
		snapshotDirPath: realSnapshotDirPath,
		forgeDeclaration: releaseBundle.readForgeDeclaration({ bundleDirPath }),
		frozenReleaseCensus: bundleData.frozenReleaseCensus,
		frozenCensusName: bundleData.frozenCensusName,
		nodeKindTable: buildNodeKindTable({ labelPrefix: releaseDeclarationData.labelPrefix }),
		checksumFaultResealed: false,
		hooksMutationList: [],
		scaffoldMutationList: [],
	});
	const cloneSubject = (subject) => ({
		...subject,
		hooksMutationList: subject.hooksMutationList.slice(),
		scaffoldMutationList: subject.scaffoldMutationList.slice(),
	});

	// forge a snapshot as the forger does: through the bundle's own entry module, or, with mutations,
	// through the framework, the bundle's declaration and an in-memory double of the shared hooks
	const forgeSnapshot = ({ subject, snapshotDirPath }, callback) => {
		const bundle = subject.hooksMutationList.length
			? forgeFrameworkFactory({ embedder: null }).injectStandardHooks({
					forgeDeclaration: subject.forgeDeclaration,
					hooks: moduleDouble.loadWithMutations({ modulePath: HOOKS_MODULE_PATH, mutationList: subject.hooksMutationList }).makeReleaseHooks({ standardKey, frozenReleaseCensus: subject.frozenReleaseCensus, frozenCensusName: subject.frozenCensusName }),
				})
			: require(entryModulePath)({ embedder: null });
		bundle.forge({ sourcePath: snapshotDirPath, owner: 'test', skipEmbedding: true }, callback);
	};
	const scaffoldWith = ({ subject, scaffoldArgs }, callback) => {
		const scaffoldLib = subject.scaffoldMutationList.length ? moduleDouble.loadWithMutations({ modulePath: SCAFFOLD_LIB_PATH, mutationList: subject.scaffoldMutationList }) : require(SCAFFOLD_LIB_PATH);
		scaffoldLib.scaffoldReleaseBundle({ expanderProvenanceText: 'gate scratch run', scaffoldCommandText: 'gate scratch run', copiedDateText: '2026-09-30', ...scaffoldArgs }, callback);
	};
	const refusedLike = ({ forgeError, refusalRe }) => typeof forgeError === 'string' && refusalRe.test(forgeError);
	const refusalDetail = (forgeError, forged) => (forgeError ? forgeError.slice(0, 400) : `NOT refused: forged ${forged.nodes.length} nodes`);
	const addMutation = (subject, listName, mutation) => {
		moduleDouble.assertMutationApplies(mutation);
		subject[listName].push(mutation);
		return subject;
	};

	const twinRegistry = makeTwinRegistry();
	const registerTwin = (gateId, conjunctId, twinName, leverKind, run) => twinRegistry.register({ gateId, conjunctId, twinName, leverKind, shippedConfig: true, run });

	// =====================================================================
	// F1-CHECKSUM
	// =====================================================================
	const CHECKSUM_GATE_ID = 'F1-CHECKSUM';
	const checksumRefusalRe = new RegExp(`sourceVerification REFUSED: '${coreMainFileName.replace(/\./g, '\\.')}' sha256 MISMATCH`);
	const expectedSourceFileList = xsdFileNameList.concat([manifestEntryLoader.MANIFEST_ENTRY_FILE_NAME]);
	const checksumConjunctList = [
		{
			conjunctId: 'snapshotVerifiesAndForges',
			title: `the bundle's entry module forges its snapshot: the framework verifies every file SHA256SUMS lists, and the root names exactly ${expectedSourceFileList.join(', ')}`,
			twinNameList: ['oneCoreMainByteAltered'],
			evaluate: (subject, callback) => {
				forgeSnapshot({ subject, snapshotDirPath: subject.snapshotDirPath }, (forgeError, forged) => {
					if (forgeError) {
						callback('', { pass: false, detail: `forge refused: ${forgeError.slice(0, 400)}` });
						return;
					}
					const pass = JSON.stringify(forged.metadata.sourceFiles) === JSON.stringify(expectedSourceFileList);
					callback('', { pass, detail: `sourceFiles ${JSON.stringify(forged.metadata.sourceFiles)}` });
				});
			},
		},
		{
			conjunctId: 'alteredByteRefusedByChecksum',
			title: `a scratch snapshot with one byte of ${coreMainFileName} altered is refused BY THE CHECKSUM, naming the file`,
			twinNameList: ['alteredByteResealed'],
			evaluate: (subject, callback) => {
				const scratchSnapshotDirPath = makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [coreMainFileName]: withFirstByteAltered }, resealChecksums: subject.checksumFaultResealed });
				forgeSnapshot({ subject, snapshotDirPath: scratchSnapshotDirPath }, (forgeError, forged) => {
					callback('', { pass: refusedLike({ forgeError, refusalRe: checksumRefusalRe }), detail: refusalDetail(forgeError, forged) });
				});
			},
		},
	];
	registerTwin(CHECKSUM_GATE_ID, 'snapshotVerifiesAndForges', 'oneCoreMainByteAltered', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [coreMainFileName]: withFirstByteAltered } }) }));
	registerTwin(CHECKSUM_GATE_ID, 'alteredByteRefusedByChecksum', 'alteredByteResealed', 'inputFault', (subject) => ({ ...subject, checksumFaultResealed: true }));

	// =====================================================================
	// F2-MANIFEST
	// =====================================================================
	const MANIFEST_GATE_ID = 'F2-MANIFEST';
	const manifestRefusalRe = new RegExp(`manifestEntryLoader REFUSED: ${coreMainFileName.replace(/\./g, '\\.')}: releaseManifestEntry\\.json says sha256 [0-9a-f]{64}, the folder's bytes are`);
	const MANIFEST_SHA_COMPARISON_MUTATION = { modulePath: MANIFEST_ENTRY_LOADER_PATH, find: 'const disagreeingFileName = entryFileNameList.find(', replace: 'const disagreeingFileName = undefined && entryFileNameList.find(' };
	const manifestConjunctList = [
		{
			conjunctId: 'entryAgreesWithFolder',
			title: `the snapshot forges, and loader 2 returns the entry for ${releaseName}, whose member files are exactly the folder's ${xsdFileNameList.length} .xsd files by sha256`,
			twinNameList: ['oneMemberShaEditedResealed'],
			evaluate: (subject, callback) => {
				forgeSnapshot({ subject, snapshotDirPath: subject.snapshotDirPath }, (forgeError) => {
					if (forgeError) {
						callback('', { pass: false, detail: `forge refused: ${forgeError.slice(0, 400)}` });
						return;
					}
					manifestEntryLoader.loadReleaseManifestEntry({ sourcePath: subject.snapshotDirPath, additionalSourceInputPathByName: { [manifestEntryLoader.MANIFEST_ENTRY_INPUT_NAME]: path.join(subject.snapshotDirPath, manifestEntryLoader.MANIFEST_ENTRY_FILE_NAME) } }, (loadError, loadedManifestEntry) => {
						const pass = !loadError && loadedManifestEntry.releaseEntry.releaseName === releaseName && loadedManifestEntry.releaseEntry.memberFiles.length === xsdFileNameList.length;
						callback('', { pass, detail: loadError ? loadError.slice(0, 400) : `entry ${loadedManifestEntry.releaseEntry.releaseName}, ${loadedManifestEntry.releaseEntry.memberFiles.length} member files, closure ${loadedManifestEntry.releaseEntry.closureDigest.slice(0, 12)}` });
					});
				});
			},
		},
		{
			conjunctId: 'editedShaRefusedByLoader2',
			title: `a scratch manifest entry with ${coreMainFileName}'s sha edited (SHA256SUMS resealed) is refused BY LOADER 2, naming the file and both shas`,
			twinNameList: ['shaComparisonDisabled'],
			evaluate: (subject, callback) => {
				const scratchSnapshotDirPath = makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [manifestEntryLoader.MANIFEST_ENTRY_FILE_NAME]: withOneMemberShaEdited }, resealChecksums: true });
				forgeSnapshot({ subject, snapshotDirPath: scratchSnapshotDirPath }, (forgeError, forged) => {
					callback('', { pass: refusedLike({ forgeError, refusalRe: manifestRefusalRe }), detail: refusalDetail(forgeError, forged) });
				});
			},
		},
	];
	registerTwin(MANIFEST_GATE_ID, 'entryAgreesWithFolder', 'oneMemberShaEditedResealed', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [manifestEntryLoader.MANIFEST_ENTRY_FILE_NAME]: withOneMemberShaEdited }, resealChecksums: true }) }));
	registerTwin(MANIFEST_GATE_ID, 'editedShaRefusedByLoader2', 'shaComparisonDisabled', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', MANIFEST_SHA_COMPARISON_MUTATION));

	// =====================================================================
	// F3-VERSION
	// =====================================================================
	const VERSION_GATE_ID = 'F3-VERSION';
	const unknownVersionRefusalRe = new RegExp(`versionGuard REFUSED: ${standardKey} version guard: versionSource is 'unknown'`);
	const disagreeingVersionRefusalRe = new RegExp(`versionGuard REFUSED: ${standardKey} version guard: standardSourceLocation says '${DISAGREEING_VERSION.replace(/\./g, '\\.')}' and the manifest entry for ${releaseName.replace(/\./g, '\\.')} says '${releaseDeclarationData.version.replace(/\./g, '\\.')}'`);
	const versionConjunctList = [
		{
			conjunctId: 'rootCarriesReleaseVersion',
			title: `the snapshot stamps publishedVersion '${releaseDeclarationData.version}' from standardSourceLocation (versionSource 'provenance-file'), and the root carries that version`,
			twinNameList: ['publishedVersionLineRemoved'],
			evaluate: (subject, callback) => {
				forgeSnapshot({ subject, snapshotDirPath: subject.snapshotDirPath }, (forgeError, forged) => {
					if (forgeError) {
						callback('', { pass: false, detail: `forge refused: ${forgeError.slice(0, 400)}` });
						return;
					}
					const rootNode = forged.nodes.find((oneNode) => oneNode.role === DME_ROLES.STANDARD_ROOT);
					const pass = forged.metadata.publishedVersion === releaseDeclarationData.version && forged.metadata.versionSource === 'provenance-file' && rootNode.properties.version === releaseDeclarationData.version;
					callback('', { pass, detail: `publishedVersion ${forged.metadata.publishedVersion}, versionSource ${forged.metadata.versionSource}, root version ${rootNode.properties.version}` });
				});
			},
		},
		{
			conjunctId: 'unknownVersionRefusedByGuard',
			title: 'a scratch snapshot whose standardSourceLocation has no publishedVersion line is REFUSED BY NAME by the forge\'s own version guard (the framework alone would only warn)',
			twinNameList: ['unknownVersionGuardDisabled'],
			evaluate: (subject, callback) => {
				const scratchSnapshotDirPath = makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [PROVENANCE_FILE_NAME]: withoutPublishedVersionLine } });
				forgeSnapshot({ subject, snapshotDirPath: scratchSnapshotDirPath }, (forgeError, forged) => {
					callback('', { pass: refusedLike({ forgeError, refusalRe: unknownVersionRefusalRe }), detail: refusalDetail(forgeError, forged) });
				});
			},
		},
		{
			conjunctId: 'disagreeingVersionRefusedByGuard',
			title: `a scratch standardSourceLocation saying '${DISAGREEING_VERSION}' is REFUSED BY NAME: it disagrees with the manifest entry's '${releaseDeclarationData.version}'`,
			twinNameList: ['disagreementGuardDisabled'],
			evaluate: (subject, callback) => {
				const scratchSnapshotDirPath = makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [PROVENANCE_FILE_NAME]: withDisagreeingPublishedVersion } });
				forgeSnapshot({ subject, snapshotDirPath: scratchSnapshotDirPath }, (forgeError, forged) => {
					callback('', { pass: refusedLike({ forgeError, refusalRe: disagreeingVersionRefusalRe }), detail: refusalDetail(forgeError, forged) });
				});
			},
		},
	];
	registerTwin(VERSION_GATE_ID, 'rootCarriesReleaseVersion', 'publishedVersionLineRemoved', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [PROVENANCE_FILE_NAME]: withoutPublishedVersionLine } }) }));
	registerTwin(VERSION_GATE_ID, 'unknownVersionRefusedByGuard', 'unknownVersionGuardDisabled', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: VERSION_GUARD_PATH, find: "const REFUSED_VERSION_SOURCE_LIST = Object.freeze(['unknown']);", replace: 'const REFUSED_VERSION_SOURCE_LIST = Object.freeze([]);' }),
	);
	registerTwin(VERSION_GATE_ID, 'disagreeingVersionRefusedByGuard', 'disagreementGuardDisabled', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: VERSION_GUARD_PATH, find: 'if (metadata.publishedVersion !== releaseEntry.version) {', replace: 'if (false) {' }),
	);

	// =====================================================================
	// F4-CENSUS
	// =====================================================================
	const CENSUS_GATE_ID = 'F4-CENSUS';
	const frozenElementCount = bundleData.frozenReleaseCensus.elementDeclarationCount;
	const censusRefusalRe = new RegExp(`releaseCensus REFUSED: the release census differs from ${bundleData.frozenCensusName.replace(/\./g, '\\.')}: .*elementDeclarationCount measured ${frozenElementCount - 1}, frozen ${frozenElementCount}`);
	const censusConjunctList = [
		{
			conjunctId: 'statsEqualFrozenAndExpectedCensus',
			title: `the forge's stats.releaseCensus EQUALS the bundle's frozen census AND the work order's expected literal for ${releaseName} (${expectedLiteralSet ? Object.keys(expectedLiteralSet.census).length : 'NO'} fields)`,
			twinNameList: ['oneElementRemovedResealed'],
			evaluate: (subject, callback) => {
				if (expectedLiteralSet === undefined) {
					callback('', { pass: false, detail: `expectedReleaseLiterals.json has no entry for ${releaseName}` });
					return;
				}
				forgeSnapshot({ subject, snapshotDirPath: subject.snapshotDirPath }, (forgeError, forged) => {
					if (forgeError) {
						callback('', { pass: false, detail: `forge refused: ${forgeError.slice(0, 400)}` });
						return;
					}
					const measuredText = JSON.stringify(forged.stats.releaseCensus);
					const pass = measuredText === JSON.stringify(subject.frozenReleaseCensus) && measuredText === JSON.stringify(expectedLiteralSet.census);
					callback('', { pass, detail: `measured ${measuredText}` });
				});
			},
		},
		{
			conjunctId: 'removedElementRefusedByCensus',
			title: `a scratch snapshot with the root's NoteMessage element removed (every seal resealed) is REFUSED BY THE CENSUS: elementDeclarationCount ${frozenElementCount - 1} against ${frozenElementCount}`,
			twinNameList: ['censusComparisonDisabled'],
			evaluate: (subject, callback) => {
				const scratchSnapshotDirPath = makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [rootFileName]: withOneElementRemoved }, resealManifestEntry: true, resealChecksums: true });
				forgeSnapshot({ subject, snapshotDirPath: scratchSnapshotDirPath }, (forgeError, forged) => {
					callback('', { pass: refusedLike({ forgeError, refusalRe: censusRefusalRe }), detail: refusalDetail(forgeError, forged) });
				});
			},
		},
	];
	registerTwin(CENSUS_GATE_ID, 'statsEqualFrozenAndExpectedCensus', 'oneElementRemovedResealed', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [rootFileName]: withOneElementRemoved }, resealManifestEntry: true, resealChecksums: true }) }));
	registerTwin(CENSUS_GATE_ID, 'removedElementRefusedByCensus', 'censusComparisonDisabled', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: RELEASE_CENSUS_PATH, find: 'if (differingFieldNameList.length > 0) {', replace: 'if (false) {' }),
	);

	// =====================================================================
	// F5-RESOLUTION
	// =====================================================================
	const RESOLUTION_GATE_ID = 'F5-RESOLUTION';
	const resolutionRefusalRe = new RegExp(`resolutionTable REFUSED: ${rootFileName.replace(/\./g, '\\.')}: 'core:${REPOINTED_TYPE_NAME}' \\(type\\) resolves to urn:org:pesc:core:CoreMain:[^#]+#type/${REPOINTED_TYPE_NAME}, which ${coreMainFileName.replace(/\./g, '\\.')} does not define`);
	const resolutionConjunctList = [
		{
			conjunctId: 'everyReferenceResolvesInside',
			title: `every reference resolves inside the release: referenceCount EQUALS the expander's releaseReferenceCheck.totalReferences (${realReleaseEntry.releaseReferenceCheck.totalReferences}), split into built-in and in-release, and the expander saw 0 missing and 0 leaving`,
			twinNameList: ['oneTypeRepointedResealed'],
			evaluate: (subject, callback) => {
				forgeSnapshot({ subject, snapshotDirPath: subject.snapshotDirPath }, (forgeError, forged) => {
					if (forgeError) {
						callback('', { pass: false, detail: `forge refused: ${forgeError.slice(0, 400)}` });
						return;
					}
					const { referenceCount, builtinReferenceCount, inReleaseReferenceCount } = forged.stats.releaseCensus;
					const expanderCheck = realReleaseEntry.releaseReferenceCheck;
					const pass = referenceCount === expanderCheck.totalReferences && builtinReferenceCount + inReleaseReferenceCount === referenceCount && expanderCheck.missingNameReferences === 0 && expanderCheck.referencesLeavingRelease === 0;
					callback('', { pass, detail: `references ${referenceCount} (built-in ${builtinReferenceCount}, in release ${inReleaseReferenceCount}); expander ${JSON.stringify(expanderCheck)}` });
				});
			},
		},
		{
			conjunctId: 'repointedTypeRefusedByResolution',
			title: `a scratch snapshot whose root NoteMessage type= names core:${REPOINTED_TYPE_NAME} (resealed) is REFUSED BY THE RESOLUTION TABLE, naming the file, the QName and the namespace`,
			twinNameList: ['missingNameRefusalDisabled'],
			evaluate: (subject, callback) => {
				const scratchSnapshotDirPath = makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [rootFileName]: withOneTypeRepointed }, resealManifestEntry: true, resealChecksums: true });
				forgeSnapshot({ subject, snapshotDirPath: scratchSnapshotDirPath }, (forgeError, forged) => {
					callback('', { pass: refusedLike({ forgeError, refusalRe: resolutionRefusalRe }), detail: refusalDetail(forgeError, forged) });
				});
			},
		},
	];
	registerTwin(RESOLUTION_GATE_ID, 'everyReferenceResolvesInside', 'oneTypeRepointedResealed', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [rootFileName]: withOneTypeRepointed }, resealManifestEntry: true, resealChecksums: true }) }));
	registerTwin(RESOLUTION_GATE_ID, 'repointedTypeRefusedByResolution', 'missingNameRefusalDisabled', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: RESOLUTION_TABLE_PATH, find: 'if (resolvedRow === undefined) {', replace: 'if (false) {' }),
	);

	// =====================================================================
	// F15-SCAFFOLD
	// =====================================================================
	const SCAFFOLD_GATE_ID = 'F15-SCAFFOLD';
	const overwriteRefusalRe = /scaffoldReleaseBundleLib REFUSED: bundle directory '.*' already exists/;
	const folderRefusalRe = new RegExp(`manifestEntryLoader REFUSED: ${codesFileName.replace(/\./g, '\\.')}: the manifest entry for '${realReleaseEntry.folderName.replace(/\./g, '\\.')}' says sha256`);
	const unionRefusalRe = new RegExp(`xsdParser REFUSES: file '${coreMainFileName.replace(/\./g, '\\.')}': untaught construct 'xs:union' inside simpleType`);
	const scaffoldConjunctList = [
		{
			conjunctId: 'committedBundleIsScaffoldOutput',
			title: `the scaffold tool, run on this bundle's own release files, writes every file of the committed bundle byte for byte (all but ${path.basename(PROVENANCE_README_RELATIVE_PATH)}, which records the moment)`,
			twinNameList: ['templateEdited'],
			evaluate: (subject, callback) => {
				scaffoldWith({ subject, scaffoldArgs: makeScratchReleaseInputs({}) }, (scaffoldError, scaffolded) => {
					if (scaffoldError) {
						callback('', { pass: false, detail: `scaffold refused: ${scaffoldError.slice(0, 400)}` });
						return;
					}
					const differingRelativePathList = scaffolded.writtenRelativePathList
						.filter((oneRelativePath) => oneRelativePath !== PROVENANCE_README_RELATIVE_PATH)
						.filter((oneRelativePath) => {
							const committedPath = path.join(bundleDirPath, oneRelativePath);
							return !fs.existsSync(committedPath) || !fs.readFileSync(committedPath).equals(fs.readFileSync(path.join(scaffolded.bundleDirPath, oneRelativePath)));
						});
					const pass = scaffolded.writtenRelativePathList.length > 0 && differingRelativePathList.length === 0 && path.basename(scaffolded.bundleDirPath) === path.basename(bundleDirPath);
					callback('', { pass, detail: `${scaffolded.writtenRelativePathList.length} files written into ${path.basename(scaffolded.bundleDirPath)}; differing from the committed bundle: ${differingRelativePathList.length ? differingRelativePathList.join(', ') : 'none'}` });
				});
			},
		},
		{
			conjunctId: 'secondRunRefused',
			title: 'run twice into one output root, the scaffold tool REFUSES the second run by name: it never overwrites a bundle',
			twinNameList: ['existenceCheckDisabled'],
			evaluate: (subject, callback) => {
				const scaffoldArgs = makeScratchReleaseInputs({});
				scaffoldWith({ subject, scaffoldArgs }, (firstError) => {
					if (firstError) {
						callback('', { pass: false, detail: `the first run refused: ${firstError.slice(0, 400)}` });
						return;
					}
					scaffoldWith({ subject, scaffoldArgs }, (secondError) => {
						callback('', { pass: refusedLike({ forgeError: secondError, refusalRe: overwriteRefusalRe }), detail: secondError ? secondError.slice(0, 400) : 'NOT refused: the second run wrote a bundle' });
					});
				});
			},
		},
		{
			conjunctId: 'replacedFileRefused',
			title: `a scratch release folder with one byte of ${codesFileName} replaced is REFUSED: the folder disagrees with its manifest entry`,
			twinNameList: ['folderShaComparisonDisabled'],
			evaluate: (subject, callback) => {
				scaffoldWith({ subject, scaffoldArgs: makeScratchReleaseInputs({ alterTextByFileName: { [codesFileName]: withFirstByteAltered } }) }, (scaffoldError) => {
					callback('', { pass: refusedLike({ forgeError: scaffoldError, refusalRe: folderRefusalRe }), detail: scaffoldError ? scaffoldError.slice(0, 400) : 'NOT refused: a bundle was written' });
				});
			},
		},
		{
			conjunctId: 'unionRefusedByParser',
			title: `a scratch release folder whose ${coreMainFileName} carries an xs:union (its manifest entry agreeing) is REFUSED BY THE PARSER at scaffold time, never in a build`,
			twinNameList: ['parserTaughtToSkipUnion'],
			evaluate: (subject, callback) => {
				scaffoldWith({ subject, scaffoldArgs: makeScratchReleaseInputs({ alterTextByFileName: { [coreMainFileName]: withUnionInserted }, updateManifestSha: true }) }, (scaffoldError) => {
					callback('', { pass: refusedLike({ forgeError: scaffoldError, refusalRe: unionRefusalRe }), detail: scaffoldError ? scaffoldError.slice(0, 400) : 'NOT refused: a bundle was written' });
				});
			},
		},
	];
	registerTwin(SCAFFOLD_GATE_ID, 'committedBundleIsScaffoldOutput', 'templateEdited', 'productionMutation', (subject) =>
		addMutation(subject, 'scaffoldMutationList', { modulePath: BUNDLE_TEMPLATES_PATH, find: '# defaultSnapshot is an explicit pin', replace: '# defaultSnapshot is the explicit pin' }),
	);
	registerTwin(SCAFFOLD_GATE_ID, 'secondRunRefused', 'existenceCheckDisabled', 'productionMutation', (subject) => addMutation(subject, 'scaffoldMutationList', { modulePath: SCAFFOLD_LIB_PATH, find: 'if (fs.existsSync(bundleDirPath)) {', replace: 'if (false) {' }));
	registerTwin(SCAFFOLD_GATE_ID, 'replacedFileRefused', 'folderShaComparisonDisabled', 'productionMutation', (subject) => addMutation(subject, 'scaffoldMutationList', MANIFEST_SHA_COMPARISON_MUTATION));
	registerTwin(SCAFFOLD_GATE_ID, 'unionRefusedByParser', 'parserTaughtToSkipUnion', 'productionMutation', (subject) =>
		addMutation(subject, 'scaffoldMutationList', { modulePath: XSD_PARSER_PATH, find: '					// xs:union and xs:list occur ZERO times in this corpus;', replace: "					if (oneChild.tag === 'xs:union') { return; }\n					// xs:union and xs:list occur ZERO times in this corpus;" }),
	);

	// =====================================================================
	// F1-ROLES (extra)
	// =====================================================================
	const ROLES_GATE_ID = 'F1-ROLES';
	const rolesConjunctList = [
		{
			conjunctId: 'nodeKindTableEqualsDesign',
			title: `the node-kind table EQUALS DESIGN-pescForge.md §2.1 (revision 3, ruling 3A.3: the occurrence is DmeSupport), every label prefixed '${releaseDeclarationData.labelPrefix}'`,
			twinNameList: ['occurrenceAsDmeProperty'],
			evaluate: (subject, callback) => {
				const roleByLabel = {};
				Object.keys(subject.nodeKindTable).forEach((oneKind) => {
					roleByLabel[subject.nodeKindTable[oneKind].perStandardLabel] = subject.nodeKindTable[oneKind].role;
				});
				const ruledRoleByLabel = {};
				Object.keys(RULED_ROLE_BY_LABEL_SUFFIX).forEach((oneSuffix) => {
					ruledRoleByLabel[`${releaseDeclarationData.labelPrefix}${oneSuffix}`] = RULED_ROLE_BY_LABEL_SUFFIX[oneSuffix];
				});
				const sortedText = (roleMap) => JSON.stringify(Object.keys(roleMap).sort().map((oneLabel) => [oneLabel, roleMap[oneLabel]]));
				callback('', { pass: sortedText(roleByLabel) === sortedText(ruledRoleByLabel), detail: sortedText(roleByLabel) });
			},
		},
		{
			conjunctId: 'declarationAcceptedWithNoAllowance',
			title: 'the framework accepts the declaration, whose compatibilityDeclarationList is [] (a new bundle may declare no migration allowance), and whose mappingInstruction makes no claim (FBB-001)',
			twinNameList: ['migrationAllowanceDeclared'],
			evaluate: (subject, callback) => {
				const declarationError = forgeDeclarationContract.validateForgeDeclaration({ forgeDeclaration: subject.forgeDeclaration, migratingBundleList: MIGRATING_BUNDLE_LIST });
				const mappingInstruction = subject.forgeDeclaration.mappingInstruction;
				const pass =
					declarationError === null &&
					subject.forgeDeclaration.compatibilityDeclarationList.length === 0 &&
					mappingInstruction.cedsOriginalAnchorPropertyName.length === 0 &&
					mappingInstruction.impliedTargets.length === 0;
				callback('', { pass, detail: declarationError ? declarationError.message.slice(0, 400) : `accepted; compatibilityDeclarationList ${JSON.stringify(subject.forgeDeclaration.compatibilityDeclarationList)}` });
			},
		},
	];
	registerTwin(ROLES_GATE_ID, 'nodeKindTableEqualsDesign', 'occurrenceAsDmeProperty', 'inputFault', (subject) => ({ ...subject, nodeKindTable: { ...subject.nodeKindTable, occurrence: { ...subject.nodeKindTable.occurrence, role: DME_ROLES.PROPERTY } } }));
	registerTwin(ROLES_GATE_ID, 'declarationAcceptedWithNoAllowance', 'migrationAllowanceDeclared', 'inputFault', (subject) => ({ ...subject, forgeDeclaration: { ...subject.forgeDeclaration, compatibilityDeclarationList: [{ allowanceId: 'S6' }] } }));

	const gateDeclarationList = [
		{ gateId: CHECKSUM_GATE_ID, title: 'F1 checksum: every snapshot byte verified, an altered one refused by the checksum', conjunctList: checksumConjunctList },
		{ gateId: MANIFEST_GATE_ID, title: 'F2 manifest match: the folder is exactly the expander\'s release', conjunctList: manifestConjunctList },
		{ gateId: VERSION_GATE_ID, title: 'F3 version guard: the release version, and no unknown or disagreeing one', conjunctList: versionConjunctList },
		{ gateId: CENSUS_GATE_ID, title: 'F4 census: the frozen counts and the work order\'s literals', conjunctList: censusConjunctList },
		{ gateId: RESOLUTION_GATE_ID, title: 'F5 resolution: every reference inside the release', conjunctList: resolutionConjunctList },
		{ gateId: SCAFFOLD_GATE_ID, title: 'F15 scaffold: the bundle is the tool\'s output, and the tool refuses what it must', conjunctList: scaffoldConjunctList },
		{ gateId: ROLES_GATE_ID, title: 'F1 roles (extra): the node-kind table and the declaration', conjunctList: rolesConjunctList },
	];

	runGateFamily(
		{ harness, familyName: `${standardKey} release gates (phase F1)`, gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 17, expectedTwinCount: 17 },
		() => {
			scratchRootPathList.forEach((oneScratchRootPath) => fs.rmSync(oneScratchRootPath, { recursive: true, force: true }));
			whenDone();
		},
	);
};

module.exports = { runReleaseGateSuite, RULED_ROLE_BY_LABEL_SUFFIX, moduleName };
