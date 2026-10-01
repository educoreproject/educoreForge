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
const { DME_ROLES, EDGE_TYPES } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));
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

	// forge a snapshot as the forger does: through the bundle's own entry module, or, with mutations or
	// a twin's census, through the framework, the bundle's declaration and (a double of) the shared hooks
	const forgeSnapshot = ({ subject, snapshotDirPath }, callback) => {
		const bundle = subject.hooksMutationList.length || subject.frozenReleaseCensus !== bundleData.frozenReleaseCensus
			? forgeFrameworkFactory({ embedder: null }).injectStandardHooks({
					forgeDeclaration: subject.forgeDeclaration,
					hooks: (subject.hooksMutationList.length ? moduleDouble.loadWithMutations({ modulePath: HOOKS_MODULE_PATH, mutationList: subject.hooksMutationList }) : require(HOOKS_MODULE_PATH)).makeReleaseHooks({ standardKey, labelPrefix: releaseDeclarationData.labelPrefix, frozenReleaseCensus: subject.frozenReleaseCensus, frozenCensusName: subject.frozenCensusName }),
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

	// =====================================================================
	// PHASE F2 FAMILY — the walk: identity, absent is absent, texts, edges, coexistence, no bridging,
	// sequence (WORKORDER §3 F2). A second family with its own twin registry, run after phase F1's.
	// =====================================================================
	const walkLiteralSet = expectedLiteralSet === undefined ? undefined : expectedLiteralSet.walk;
	const walkTwinRegistry = makeTwinRegistry();
	const registerWalkTwin = (gateId, conjunctId, twinName, leverKind, run) => walkTwinRegistry.register({ gateId, conjunctId, twinName, leverKind, shippedConfig: true, run });
	const WALK_PATH = path.join(LIBRARY_DIR, 'walk.js');
	const SEQUENCE_GROUPS_PATH = path.join(LIBRARY_DIR, 'sequenceGroups.js');
	const labelSuffixOf = (oneNode) => oneNode.labels[1].slice(releaseDeclarationData.labelPrefix.length);
	const stableIdKindOf = (stableId) => stableId.slice(standardKey.length + 1).split('/')[0];
	const forgeOrFail = ({ subject, snapshotDirPath }, callback, onForged) => {
		forgeSnapshot({ subject, snapshotDirPath: snapshotDirPath === undefined ? subject.snapshotDirPath : snapshotDirPath }, (forgeError, forged) => {
			if (forgeError) {
				callback('', { pass: false, detail: `forge refused: ${forgeError.slice(0, 400)}` });
				return;
			}
			onForged(forged);
		});
	};
	const withExtraHooksMutation = (subject, mutation) => {
		moduleDouble.assertMutationApplies(mutation);
		return { ...subject, hooksMutationList: subject.hooksMutationList.concat([mutation]) };
	};
	const missingLiteralResult = (literalName) => ({ pass: false, detail: `expectedReleaseLiterals.json has no walk.${literalName} for ${releaseName}` });

	// ---- F6-IDENTITY
	const IDENTITY_GATE_ID = 'F6-IDENTITY';
	const identityConjunctList = [
		{
			conjunctId: 'idsUniquePatternedAndReleaseIndependent',
			title: `every stableId is unique and matches the declared pattern, and every carried releaseIndependentId is its stableId less '${standardKey}:'`,
			twinNameList: ['releaseIndependentIdOffByOne'],
			evaluate: (subject, callback) => {
				forgeOrFail({ subject }, callback, (forged) => {
					const stableIdPatternRe = new RegExp(subject.forgeDeclaration.stableIdPattern.pattern);
					const seenStableIdSet = new Set();
					const duplicateNode = forged.nodes.find((oneNode) => (seenStableIdSet.has(oneNode.stableId) ? true : (seenStableIdSet.add(oneNode.stableId), false)));
					const unpatternedNode = forged.nodes.find((oneNode) => !stableIdPatternRe.test(oneNode.stableId));
					const misnamedNode = forged.nodes.find((oneNode) => oneNode.properties.releaseIndependentId !== undefined && `${standardKey}:${oneNode.properties.releaseIndependentId}` !== oneNode.stableId);
					const carryingCount = forged.nodes.filter((oneNode) => oneNode.properties.releaseIndependentId !== undefined).length;
					const pass = duplicateNode === undefined && unpatternedNode === undefined && misnamedNode === undefined && carryingCount > 0;
					callback('', { pass, detail: `${forged.nodes.length} nodes; ${carryingCount} carry releaseIndependentId; duplicate ${duplicateNode ? duplicateNode.stableId : 'none'}; unpatterned ${unpatternedNode ? unpatternedNode.stableId : 'none'}; misnamed ${misnamedNode ? `${misnamedNode.stableId} → ${misnamedNode.properties.releaseIndependentId}` : 'none'}` });
				});
			},
		},
		{
			conjunctId: 'twoForgesByteIdentical',
			title: 'two forges of the one snapshot, by one bundle, produce byte-identical { nodes, edges }',
			twinNameList: ['runCounterInReleaseRecordId'],
			evaluate: (subject, callback) => {
				forgeOrFail({ subject }, callback, (firstForged) => {
					forgeOrFail({ subject }, callback, (secondForged) => {
						const firstText = JSON.stringify({ nodes: firstForged.nodes, edges: firstForged.edges });
						const secondText = JSON.stringify({ nodes: secondForged.nodes, edges: secondForged.edges });
						callback('', { pass: firstText === secondText, detail: `${firstText.length} and ${secondText.length} bytes; identical ${firstText === secondText}` });
					});
				});
			},
		},
	];
	registerWalkTwin(IDENTITY_GATE_ID, 'idsUniquePatternedAndReleaseIndependent', 'releaseIndependentIdOffByOne', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: 'const releaseIndependentIdOf = (stableId) => stableId.slice(stableIdPrefix.length);', replace: 'const releaseIndependentIdOf = (stableId) => stableId.slice(stableIdPrefix.length - 1);' }),
	);
	// the fault: a counter that survives between two forges of one snapshot
	registerWalkTwin(IDENTITY_GATE_ID, 'twoForgesByteIdentical', 'runCounterInReleaseRecordId', 'productionMutation', (subject) => {
		// the counter lives on globalThis because every forge here compiles the walk afresh (moduleDouble), so
		// a module-level counter would restart at each forge and prove nothing
		return addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: 'const releaseRecordStableId = `${stableIdPrefix}${RELEASE_RECORD_SEGMENT}`;', replace: 'globalThis.pescRunCounterForTwin = (globalThis.pescRunCounterForTwin || 0) + 1;\n	const releaseRecordStableId = `${stableIdPrefix}${RELEASE_RECORD_SEGMENT}/run${globalThis.pescRunCounterForTwin}`;' });
	});

	// ---- F7-ABSENT
	const ABSENT_GATE_ID = 'F7-ABSENT';
	const absentConjunctList = [
		{
			conjunctId: 'noEmptyStringOrEmptyList',
			title: "no node carries a property whose value is '' or an empty list (name and description included): absent is absent",
			twinNameList: ['noteMessageNameForcedEmpty'],
			evaluate: (subject, callback) => {
				forgeOrFail({ subject }, callback, (forged) => {
					const emptyList = [];
					forged.nodes.forEach((oneNode) =>
						Object.keys(oneNode.properties).forEach((onePropertyName) => {
							const propertyValue = oneNode.properties[onePropertyName];
							if (propertyValue === '' || (Array.isArray(propertyValue) && propertyValue.length === 0)) {
								emptyList.push(`${oneNode.stableId}.${onePropertyName}`);
							}
						}),
					);
					callback('', { pass: emptyList.length === 0, detail: `${forged.nodes.length} nodes; empty properties: ${emptyList.length ? emptyList.slice(0, 5).join(', ') : 'none'}` });
				});
			},
		},
	];
	registerWalkTwin(ABSENT_GATE_ID, 'noEmptyStringOrEmptyList', 'noteMessageNameForcedEmpty', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: '			...(isAbsent(name) ? {} : { name }),', replace: "			...(isAbsent(name) ? {} : { name: name === 'NoteMessage' ? '' : name })," }),
	);

	// ---- F8-TEXTS
	const TEXTS_GATE_ID = 'F8-TEXTS';
	const EMBED_TEXT_ROLE = DME_ROLES.EMBED_TEXT;
	const BLANKED_ELEMENT_STABLE_ID = `${standardKey}:type/urn:org:pesc:sector:AcademicRecord:v1.13.0#PersonType/el/12:HighSchool`;
	const textsConjunctList = [
		{
			conjunctId: 'textNodesAreTheDistinctDeclaredTexts',
			title: 'the text nodes are exactly the distinct trimmed values of the declared text properties (computed here from the nodes and the declaration), their count EQUALS the frozen literal, and no text reaches a DmeSupport, DmeOptionValue or DmeOptionSet-without-declaration node',
			twinNameList: ['oneElementDocumentationBlanked'],
			evaluate: (subject, callback) => {
				if (walkLiteralSet === undefined) {
					callback('', missingLiteralResult('textNodeCount'));
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const textPropertyListByRole = subject.forgeDeclaration.embedTextDeclaration.textPropertyListByRole;
					const expectedTextSet = new Set();
					forged.nodes.forEach((oneNode) => {
						(textPropertyListByRole[oneNode.role] || []).forEach((onePropertyName) => {
							const propertyValue = oneNode.properties[onePropertyName];
							[].concat(propertyValue === undefined ? [] : propertyValue).forEach((oneText) => {
								if (oneText.trim() !== '') {
									expectedTextSet.add(oneText.trim());
								}
							});
						});
					});
					const textNodeList = forged.nodes.filter((oneNode) => oneNode.role === EMBED_TEXT_ROLE);
					const mintedTextSet = new Set(textNodeList.map((oneNode) => oneNode.properties.text));
					const roleByStableId = {};
					forged.nodes.forEach((oneNode) => {
						roleByStableId[oneNode.stableId] = oneNode.role;
					});
					const undeclaredTargetEdge = forged.edges.find((oneEdge) => oneEdge.type === 'EMBEDS_TEXT_OF' && textPropertyListByRole[roleByStableId[oneEdge.toRef.id]] === undefined);
					const sameSet = expectedTextSet.size === mintedTextSet.size && [...expectedTextSet].every((oneText) => mintedTextSet.has(oneText));
					const pass = sameSet && textNodeList.length === walkLiteralSet.textNodeCount && undeclaredTargetEdge === undefined;
					callback('', { pass, detail: `text nodes ${textNodeList.length} (frozen ${walkLiteralSet.textNodeCount}; work order: at most ${walkLiteralSet.textNodeCountCeiling}); distinct declared texts ${expectedTextSet.size}; same set ${sameSet}; edge to an undeclared role ${undeclaredTargetEdge ? undeclaredTargetEdge.toRef.id : 'none'}` });
				});
			},
		},
		{
			conjunctId: 'effectiveDocumentationRule',
			title: 'every element and attribute: effectiveDocumentation is its own text when it has one, else its type\'s, and documentationSource says which; the per-kind counts EQUAL the frozen literals (elements with own text: 1,220, the evidence census)',
			twinNameList: ['highSchoolDocumentationBlanked'],
			evaluate: (subject, callback) => {
				if (walkLiteralSet === undefined) {
					callback('', missingLiteralResult('documentationSourceCountByLabelSuffix'));
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const nodeByStableId = {};
					forged.nodes.forEach((oneNode) => {
						nodeByStableId[oneNode.stableId] = oneNode;
					});
					// a named type, found by its qualified name among the top-level definitions (they alone carry
					// documentPosition; parentId cannot say, see F22)
					const topLevelTypeByQName = {};
					forged.nodes
						.filter((oneNode) => oneNode.properties.documentPosition !== undefined && ['Type', 'CodeList', 'DataType'].indexOf(labelSuffixOf(oneNode)) !== -1)
						.forEach((oneNode) => {
							topLevelTypeByQName[`${oneNode.properties.targetNamespace}#${oneNode.properties.name}`] = oneNode;
						});
					const countByLabelSuffix = {};
					const ruleBreakList = [];
					forged.nodes
						.filter((oneNode) => ['Element', 'Attribute'].indexOf(labelSuffixOf(oneNode)) !== -1)
						.forEach((oneNode) => {
							const props = oneNode.properties;
							const ownText = props.documentation;
							const anonymousNode = nodeByStableId[`${oneNode.stableId}/anon`];
							const typeNode = anonymousNode !== undefined ? anonymousNode : topLevelTypeByQName[props.typeQName];
							const typeText = typeNode === undefined ? undefined : typeNode.properties.documentation;
							const expected = ownText !== undefined ? { text: ownText, source: 'own' } : typeText !== undefined ? { text: typeText, source: 'type' } : { text: undefined, source: undefined };
							if (props.effectiveDocumentation !== expected.text || props.documentationSource !== expected.source) {
								ruleBreakList.push(oneNode.stableId);
							}
							const suffix = labelSuffixOf(oneNode);
							countByLabelSuffix[suffix] = countByLabelSuffix[suffix] || {};
							const sourceName = props.documentationSource === undefined ? 'none' : props.documentationSource;
							countByLabelSuffix[suffix][sourceName] = (countByLabelSuffix[suffix][sourceName] || 0) + 1;
						});
					const sortedText = (countMap) => JSON.stringify(Object.keys(countMap).sort().map((oneSuffix) => [oneSuffix, Object.keys(countMap[oneSuffix]).sort().map((oneSource) => [oneSource, countMap[oneSuffix][oneSource]])]));
					const pass = ruleBreakList.length === 0 && sortedText(countByLabelSuffix) === sortedText(walkLiteralSet.documentationSourceCountByLabelSuffix);
					callback('', { pass, detail: `counts ${sortedText(countByLabelSuffix)}; rule broken on ${ruleBreakList.length ? ruleBreakList.slice(0, 3).join(', ') : 'none'}` });
				});
			},
		},
	];
	const blankHighSchoolDocumentation = (fileText, fileName) => {
		const highSchoolOpenText = '<xs:element name="HighSchool"';
		const elementStart = fileText.indexOf(highSchoolOpenText, fileText.indexOf('<xs:complexType name="PersonType">'));
		const documentationStart = fileText.indexOf('<xs:documentation>', elementStart) + '<xs:documentation>'.length;
		const documentationEnd = fileText.indexOf('</xs:documentation>', documentationStart);
		if (elementStart === -1 || documentationEnd === -1) {
			throw new Error(`${moduleName}: fixture fault — no PersonType/HighSchool documentation in ${fileName}`);
		}
		return fileText.slice(0, documentationStart) + fileText.slice(documentationEnd);
	};
	const academicRecordFileName = xsdFileNameList.find((oneFileName) => /^AcademicRecord_v/.test(oneFileName));
	const blankedHighSchoolSnapshot = (subject) => makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [academicRecordFileName]: blankHighSchoolDocumentation }, resealManifestEntry: true, resealChecksums: true });
	registerWalkTwin(TEXTS_GATE_ID, 'textNodesAreTheDistinctDeclaredTexts', 'oneElementDocumentationBlanked', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: blankedHighSchoolSnapshot(subject) }));
	registerWalkTwin(TEXTS_GATE_ID, 'effectiveDocumentationRule', 'highSchoolDocumentationBlanked', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: blankedHighSchoolSnapshot(subject) }));

	// ---- F10-EDGES
	const EDGES_GATE_ID = 'F10-EDGES';
	const edgesConjunctList = [
		{
			conjunctId: 'edgeCountsEqualLiterals',
			title: 'structural edge counts by type EQUAL the work order literals (and REFERENCES_TYPE by target, SUBCLASS_OF by variety, REFERENCES by target), and no HAS_SUPPORT reaches a data type',
			twinNameList: ['dataTypeSupportRestored'],
			evaluate: (subject, callback) => {
				if (walkLiteralSet === undefined) {
					callback('', missingLiteralResult('edgeCountByType'));
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const countBy = (edgeList, nameOf) => edgeList.reduce((soFar, oneEdge) => ({ ...soFar, [nameOf(oneEdge)]: (soFar[nameOf(oneEdge)] || 0) + 1 }), {});
					const structuralEdgeList = forged.edges.filter((oneEdge) => oneEdge.type !== 'EMBEDS_TEXT_OF');
					const measured = {
						edgeCountByType: countBy(structuralEdgeList, (oneEdge) => oneEdge.type),
						referencesTypeCountByTarget: countBy(structuralEdgeList.filter((oneEdge) => oneEdge.type === 'REFERENCES_TYPE'), (oneEdge) => stableIdKindOf(oneEdge.toRef.id)),
						subclassOfCountByVariety: countBy(structuralEdgeList.filter((oneEdge) => oneEdge.type === 'SUBCLASS_OF'), (oneEdge) => oneEdge.properties.derivationVariety),
						referencesCountByTarget: countBy(structuralEdgeList.filter((oneEdge) => oneEdge.type === 'REFERENCES'), (oneEdge) => stableIdKindOf(oneEdge.toRef.id)),
					};
					const supportToDataTypeCount = structuralEdgeList.filter((oneEdge) => oneEdge.type === 'HAS_SUPPORT' && stableIdKindOf(oneEdge.toRef.id) === 'dataType').length;
					const sortedText = (countMap) => JSON.stringify(Object.keys(countMap).sort().map((oneName) => [oneName, countMap[oneName]]));
					const differingNameList = Object.keys(measured).filter((oneName) => sortedText(measured[oneName]) !== sortedText(walkLiteralSet[oneName]));
					const pass = differingNameList.length === 0 && supportToDataTypeCount === 0;
					callback('', { pass, detail: `${Object.keys(measured).map((oneName) => `${oneName} ${sortedText(measured[oneName])}`).join('; ')}; HAS_SUPPORT to a data type ${supportToDataTypeCount}; differing: ${differingNameList.length ? differingNameList.join(', ') : 'none'}` });
				});
			},
		},
		{
			conjunctId: 'noDanglingEndpointAndVocabularyOnly',
			title: 'every edge endpoint is a minted node and every edge type is an EDGE_TYPES member',
			twinNameList: ['groupReferenceToMissingId'],
			evaluate: (subject, callback) => {
				forgeOrFail({ subject }, callback, (forged) => {
					const stableIdSet = new Set(forged.nodes.map((oneNode) => oneNode.stableId));
					const edgeTypeValueList = Object.values(EDGE_TYPES);
					const danglingEdge = forged.edges.find((oneEdge) => !stableIdSet.has(oneEdge.fromRef.id) || !stableIdSet.has(oneEdge.toRef.id));
					const foreignEdge = forged.edges.find((oneEdge) => edgeTypeValueList.indexOf(oneEdge.type) === -1);
					callback('', { pass: danglingEdge === undefined && foreignEdge === undefined, detail: `${forged.edges.length} edges; dangling ${danglingEdge ? `${danglingEdge.type} → ${danglingEdge.toRef.id}` : 'none'}; outside EDGE_TYPES ${foreignEdge ? foreignEdge.type : 'none'}` });
				});
			},
		},
	];
	edgesConjunctList.push({
		conjunctId: 'everyDeclarationHasItsTypeEdge',
		title: "every element-like declaration (element, attribute, global element) typed by a named type has exactly one REFERENCES_TYPE or HAS_OPTION_SET edge to that type, every declaration with an anonymous code list has HAS_OPTION_SET to it (QUIET_ORBIT ruling), and the counts by declaration kind EQUAL the frozen literal",
		twinNameList: ['attributeTypeEdgesDropped', 'anonymousOptionSetEdgeDropped'],
		evaluate: (subject, callback) => {
			if (walkLiteralSet === undefined || walkLiteralSet.typeEdgeCountByDeclaration === undefined) {
				callback('', missingLiteralResult('typeEdgeCountByDeclaration'));
				return;
			}
			forgeOrFail({ subject }, callback, (forged) => {
				const nodeByStableId = {};
				forged.nodes.forEach((oneNode) => {
					nodeByStableId[oneNode.stableId] = oneNode;
				});
				const topLevelTypeByQName = {};
				forged.nodes
					.filter((oneNode) => oneNode.properties.documentPosition !== undefined && ['Type', 'CodeList', 'DataType'].indexOf(labelSuffixOf(oneNode)) !== -1)
					.forEach((oneNode) => {
						topLevelTypeByQName[`${oneNode.properties.targetNamespace}#${oneNode.properties.name}`] = oneNode;
					});
				const typeEdgeList = forged.edges.filter((oneEdge) => oneEdge.type === 'REFERENCES_TYPE' || oneEdge.type === 'HAS_OPTION_SET');
				const typeEdgeTargetListByDeclaration = {};
				const countByDeclaration = {};
				typeEdgeList.forEach((oneEdge) => {
					(typeEdgeTargetListByDeclaration[oneEdge.fromRef.id] = typeEdgeTargetListByDeclaration[oneEdge.fromRef.id] || []).push(oneEdge.toRef.id);
					const toNode = nodeByStableId[oneEdge.toRef.id];
					const countName = `${oneEdge.type} ${labelSuffixOf(nodeByStableId[oneEdge.fromRef.id])} -> ${oneEdge.toRef.id.endsWith('/anon') ? 'anonymous ' : ''}${labelSuffixOf(toNode)}`;
					countByDeclaration[countName] = (countByDeclaration[countName] || 0) + 1;
				});
				const wrongList = [];
				forged.nodes
					.filter((oneNode) => ['Element', 'Attribute', 'GlobalElement'].indexOf(labelSuffixOf(oneNode)) !== -1)
					.forEach((oneNode) => {
						const namedType = topLevelTypeByQName[oneNode.properties.typeQName];
						const anonymousNode = nodeByStableId[`${oneNode.stableId}/anon`];
						const expectedTarget = namedType !== undefined ? namedType.stableId : anonymousNode !== undefined && labelSuffixOf(anonymousNode) === 'CodeList' ? anonymousNode.stableId : undefined;
						const actualTargetList = typeEdgeTargetListByDeclaration[oneNode.stableId] || [];
						if (expectedTarget === undefined ? actualTargetList.length !== 0 : actualTargetList.length !== 1 || actualTargetList[0] !== expectedTarget) {
							wrongList.push(`${oneNode.stableId} → [${actualTargetList.join(', ')}]`);
						}
					});
				const sortedText = (countMap) => JSON.stringify(Object.keys(countMap).sort().map((oneName) => [oneName, countMap[oneName]]));
				const pass = wrongList.length === 0 && sortedText(countByDeclaration) === sortedText(walkLiteralSet.typeEdgeCountByDeclaration);
				callback('', { pass, detail: `${sortedText(countByDeclaration)}; wrong ${wrongList.length ? wrongList.slice(0, 3).join('; ') : 'none'}` });
			});
		},
	});
	registerWalkTwin(EDGES_GATE_ID, 'everyDeclarationHasItsTypeEdge', 'attributeTypeEdgesDropped', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: '			addTypeEdge({ declarationStableId: attributeStableId, target: typed.target });\n', replace: '' }),
	);
	registerWalkTwin(EDGES_GATE_ID, 'everyDeclarationHasItsTypeEdge', 'anonymousOptionSetEdgeDropped', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: '			addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: ownerDeclarationStableId, toStableId: anonymousStableId });\n', replace: '' }),
	);
	registerWalkTwin(EDGES_GATE_ID, 'edgeCountsEqualLiterals', 'dataTypeSupportRestored', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: '	group: EDGE_TYPES.HAS_SUPPORT,\n	type: EDGE_TYPES.HAS_CLASS,', replace: '	group: EDGE_TYPES.HAS_SUPPORT,\n	dataType: EDGE_TYPES.HAS_SUPPORT,\n	type: EDGE_TYPES.HAS_CLASS,' }),
	);
	registerWalkTwin(EDGES_GATE_ID, 'noDanglingEndpointAndVocabularyOnly', 'groupReferenceToMissingId', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: 'addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId: ownerStableId, toStableId: target.stableId });', replace: 'addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId: ownerStableId, toStableId: `${target.stableId}Missing` });' }),
	);

	// ---- F13-COEXISTENCE
	const COEXISTENCE_GATE_ID = 'F13-COEXISTENCE';
	const SECOND_RELEASE_DIR_NAME = `${standardKey}second`;
	const descriptorText = fs.readFileSync(path.join(bundleDirPath, rosterLib.DESCRIPTOR_FILE_NAME), 'utf8');
	const secondReleaseDescriptorText = ({ standardName }) => descriptorText.replace(/^standardName=.*$/m, `standardName=${standardName}`);
	const makeScratchForgesDir = ({ secondStandardName }) => {
		const scratchForgesDirPath = makeScratchRoot(`${standardKey}Forges-`);
		const realForgesDirPath = path.dirname(bundleDirPath);
		fs.readdirSync(realForgesDirPath, { withFileTypes: true })
			.filter((oneEntry) => oneEntry.isDirectory() && fs.existsSync(path.join(realForgesDirPath, oneEntry.name, rosterLib.DESCRIPTOR_FILE_NAME)))
			.forEach((oneEntry) => {
				fs.mkdirSync(path.join(scratchForgesDirPath, oneEntry.name));
				fs.copyFileSync(path.join(realForgesDirPath, oneEntry.name, rosterLib.DESCRIPTOR_FILE_NAME), path.join(scratchForgesDirPath, oneEntry.name, rosterLib.DESCRIPTOR_FILE_NAME));
			});
		fs.mkdirSync(path.join(scratchForgesDirPath, SECOND_RELEASE_DIR_NAME));
		fs.writeFileSync(path.join(scratchForgesDirPath, SECOND_RELEASE_DIR_NAME, rosterLib.DESCRIPTOR_FILE_NAME), secondReleaseDescriptorText({ standardName: secondStandardName }));
		return scratchForgesDirPath;
	};
	const SECOND_RELEASE_STANDARD_NAME = `${releaseDeclarationData.standardSource}-second`;
	const coexistenceConjunctList = [
		{
			conjunctId: 'uniqueWithPesc260805AndTwoReleaseBundles',
			title: `G-UNIQUE holds over every real bundle plus a second PESC release bundle ('${SECOND_RELEASE_STANDARD_NAME}'), with pesc260805 present`,
			twinNameList: ['secondReleaseSharesTheName'],
			evaluate: (subject, callback) => {
				const scratchForgesDirPath = makeScratchForgesDir({ secondStandardName: subject.secondReleaseStandardName });
				const verdict = rosterLib.assertUniqueStandardNames({ forgesDirPath: scratchForgesDirPath });
				const pass = verdict === null && fs.existsSync(path.join(scratchForgesDirPath, 'pesc260805', rosterLib.DESCRIPTOR_FILE_NAME));
				callback('', { pass, detail: verdict === null ? `unique over ${fs.readdirSync(scratchForgesDirPath).length} bundles` : verdict.message.slice(0, 300) });
			},
		},
		{
			conjunctId: 'sourceEqualsDescriptorOnEveryNode',
			title: "G-SOURCE: the declaration's standardSource EQUALS the descriptor's standardName, and every forged node's _source equals it",
			twinNameList: ['declarationSourceRenamed'],
			evaluate: (subject, callback) => {
				forgeOrFail({ subject }, callback, (forged) => {
					const descriptorStandardName = /^standardName=(.*)$/m.exec(descriptorText)[1];
					const offendingNode = forged.nodes.find((oneNode) => oneNode.properties._source !== descriptorStandardName);
					const pass = subject.forgeDeclaration.standardSource === descriptorStandardName && offendingNode === undefined;
					callback('', { pass, detail: `descriptor '${descriptorStandardName}', declaration '${subject.forgeDeclaration.standardSource}', ${offendingNode ? `node ${offendingNode.stableId} _source '${offendingNode.properties._source}'` : `all ${forged.nodes.length} nodes match`}` });
				});
			},
		},
	];
	registerWalkTwin(COEXISTENCE_GATE_ID, 'uniqueWithPesc260805AndTwoReleaseBundles', 'secondReleaseSharesTheName', 'inputFault', (subject) => ({ ...subject, secondReleaseStandardName: releaseDeclarationData.standardSource }));
	registerWalkTwin(COEXISTENCE_GATE_ID, 'sourceEqualsDescriptorOnEveryNode', 'declarationSourceRenamed', 'inputFault', (subject) => ({ ...subject, forgeDeclaration: { ...subject.forgeDeclaration, standardSource: SECOND_RELEASE_STANDARD_NAME } }));

	// ---- F14-NO-BRIDGING
	const BRIDGING_GATE_ID = 'F14-NO-BRIDGING';
	const CEDS_PROPERTY_MUTATION = {
		modulePath: WALK_PATH,
		find: '			carriedProperties: kit.carriedProperties({ parsedObject: presentFactsOf(facts), carryList: CARRY_LIST_BY_NODE_KIND[nodeKind] }),',
		replace: "			carriedProperties: { ...kit.carriedProperties({ parsedObject: presentFactsOf(facts), carryList: CARRY_LIST_BY_NODE_KIND[nodeKind] }), ...(nodeKind === 'element' ? { cedsId: 'P000001' } : {}) },",
	};
	const bridgingRefusalRe = /walk REFUSED: node '[^']+' carries property 'cedsId'/;
	const bridgingConjunctList = [
		{
			conjunctId: 'noBridgingInTheGraph',
			title: 'the forge names no bridge target: no property name speaks of CEDS, mappingInstruction is empty, and every edge stays inside the release',
			twinNameList: ['cedsIdPropertyAdded'],
			evaluate: (subject, callback) => {
				forgeOrFail({ subject }, callback, (forged) => {
					const cedsNamedNode = forged.nodes.find((oneNode) => Object.keys(oneNode.properties).some((onePropertyName) => /ceds/i.test(onePropertyName)));
					const foreignEdge = forged.edges.find((oneEdge) => oneEdge.fromRef.source !== subject.forgeDeclaration.standardSource || oneEdge.toRef.source !== subject.forgeDeclaration.standardSource);
					const mappingInstruction = subject.forgeDeclaration.mappingInstruction;
					const pass = cedsNamedNode === undefined && foreignEdge === undefined && mappingInstruction.cedsOriginalAnchorPropertyName.length === 0 && mappingInstruction.impliedTargets.length === 0;
					callback('', { pass, detail: `CEDS-named property on ${cedsNamedNode ? cedsNamedNode.stableId : 'no node'}; cross-standard edge ${foreignEdge ? foreignEdge.type : 'none'}` });
				});
			},
		},
		{
			conjunctId: 'cedsPropertyRefusedByScan',
			title: "a scratch walk that adds a 'cedsId' property to the elements is REFUSED BY NAME by the forge's own scan",
			twinNameList: ['bridgingScanDisabled'],
			evaluate: (subject, callback) => {
				forgeSnapshot({ subject: withExtraHooksMutation(subject, CEDS_PROPERTY_MUTATION), snapshotDirPath: subject.snapshotDirPath }, (forgeError, forged) => {
					callback('', { pass: refusedLike({ forgeError, refusalRe: bridgingRefusalRe }), detail: refusalDetail(forgeError, forged) });
				});
			},
		},
	];
	registerWalkTwin(BRIDGING_GATE_ID, 'noBridgingInTheGraph', 'cedsIdPropertyAdded', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', CEDS_PROPERTY_MUTATION));
	registerWalkTwin(BRIDGING_GATE_ID, 'cedsPropertyRefusedByScan', 'bridgingScanDisabled', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: 'const BRIDGING_PROPERTY_NAME_RE = /ceds/i;', replace: 'const BRIDGING_PROPERTY_NAME_RE = /^$/;' }),
	);

	// ---- F22-SEQUENCE
	const SEQUENCE_GATE_ID = 'F22-SEQUENCE';
	const CHOICE_NORMATIVE_MUTATION = { modulePath: SEQUENCE_GROUPS_PATH, find: '	choice: DOCUMENT,', replace: '	choice: NORMATIVE,' };
	const choiceNormativeRefusalRe = /sequenceGroups REFUSED: group '[^']+' would be marked 'normative' under compositor 'choice'/;
	const sequenceConjunctList = [
		{
			conjunctId: 'orderedNodesStamped',
			title: "every local element, code and top-level definition carries sequenceOrdinal, siblingCount and orderSemantics, and nothing else does; 'normative' only on elements whose owner's top compositor is xs:sequence; the counts EQUAL the frozen literals",
			twinNameList: ['choiceGroupMarkedNormative'],
			evaluate: (subject, callback) => {
				if (walkLiteralSet === undefined) {
					callback('', missingLiteralResult('sequenceCountByOrderSemantics'));
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const ORDERED_LABEL_SUFFIX_LIST = ['Element', 'Code', 'Type', 'CodeList', 'DataType', 'Group', 'GlobalElement'];
					const nodeByStableId = {};
					forged.nodes.forEach((oneNode) => {
						nodeByStableId[oneNode.stableId] = oneNode;
					});
					const isOrderedNode = (oneNode) => {
						const suffix = labelSuffixOf(oneNode);
						if (suffix === 'Element' || suffix === 'Code') {
							return true;
						}
						// a top-level definition carries documentPosition; nothing else does. Not 'its parent is the
						// root': the structural contract re-parents a single-owner code list onto its one owning
						// property (structural-contract.js M8), so 89 named code lists here have an element parent
						return ORDERED_LABEL_SUFFIX_LIST.indexOf(suffix) !== -1 && oneNode.properties.documentPosition !== undefined;
					};
					const wrongList = [];
					const countByOrderSemantics = {};
					forged.nodes.forEach((oneNode) => {
						const props = oneNode.properties;
						const stamped = props.sequenceOrdinal !== undefined && props.siblingCount !== undefined && props.orderSemantics !== undefined;
						if (stamped !== isOrderedNode(oneNode)) {
							wrongList.push(`${oneNode.stableId} stamped ${stamped}`);
							return;
						}
						if (!stamped) {
							return;
						}
						countByOrderSemantics[props.orderSemantics] = (countByOrderSemantics[props.orderSemantics] || 0) + 1;
						if (props.orderSemantics === 'normative') {
							const ownerShape = JSON.parse(nodeByStableId[props.parentId].properties.contentModelShape || 'null');
							if (labelSuffixOf(oneNode) !== 'Element' || ownerShape === null || ownerShape.compositor !== 'sequence') {
								wrongList.push(`${oneNode.stableId} normative under ${ownerShape === null ? 'no compositor' : ownerShape.compositor}`);
							}
						}
					});
					const sortedText = (countMap) => JSON.stringify(Object.keys(countMap).sort().map((oneName) => [oneName, countMap[oneName]]));
					const pass = wrongList.length === 0 && sortedText(countByOrderSemantics) === sortedText(walkLiteralSet.sequenceCountByOrderSemantics);
					callback('', { pass, detail: `stamped ${sortedText(countByOrderSemantics)}; wrong ${wrongList.length ? wrongList.slice(0, 3).join(', ') : 'none'}` });
				});
			},
		},
		{
			conjunctId: 'choiceNormativeRefused',
			title: 'a scratch ordering table that marks an xs:choice group normative is REFUSED BY NAME by sequenceGroups (the sequence contract cannot check it)',
			twinNameList: ['normativeGuardDisabled'],
			evaluate: (subject, callback) => {
				forgeSnapshot({ subject: withExtraHooksMutation(subject, CHOICE_NORMATIVE_MUTATION), snapshotDirPath: subject.snapshotDirPath }, (forgeError, forged) => {
					callback('', { pass: refusedLike({ forgeError, refusalRe: choiceNormativeRefusalRe }), detail: refusalDetail(forgeError, forged) });
				});
			},
		},
	];
	registerWalkTwin(SEQUENCE_GATE_ID, 'orderedNodesStamped', 'choiceGroupMarkedNormative', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', CHOICE_NORMATIVE_MUTATION));
	registerWalkTwin(SEQUENCE_GATE_ID, 'choiceNormativeRefused', 'normativeGuardDisabled', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: SEQUENCE_GROUPS_PATH, find: 'if (orderSemantics === NORMATIVE && compositor !== NORMATIVE_COMPOSITOR) {', replace: 'if (false) {' }),
	);

	// ---- F2 (extra): the NoteMessage declarations, per file (QUIET_ORBIT ruling: 103 = AR 50 + CM 52 + root 1)
	const DECLARATIONS_GATE_ID = 'F2-DECLARATIONS';
	const declarationsConjunctList = [
		{
			conjunctId: 'noteMessageDeclarationsPerFile',
			title: 'NoteMessage element declarations per file EQUAL the ruled literal (each its own node, under its own owner)',
			twinNameList: ['rootNoteMessageRemoved'],
			evaluate: (subject, callback) => {
				if (walkLiteralSet === undefined) {
					callback('', missingLiteralResult('noteMessageDeclarationCountByFile'));
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const countByFile = {};
					forged.nodes.filter((oneNode) => labelSuffixOf(oneNode) === 'Element' && oneNode.properties.name === 'NoteMessage').forEach((oneNode) => {
						countByFile[oneNode.properties.sourceFileName] = (countByFile[oneNode.properties.sourceFileName] || 0) + 1;
					});
					const sortedText = (countMap) => JSON.stringify(Object.keys(countMap).sort().map((oneName) => [oneName, countMap[oneName]]));
					callback('', { pass: sortedText(countByFile) === sortedText(walkLiteralSet.noteMessageDeclarationCountByFile), detail: sortedText(countByFile) });
				});
			},
		},
	];
	registerWalkTwin(DECLARATIONS_GATE_ID, 'noteMessageDeclarationsPerFile', 'rootNoteMessageRemoved', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [rootFileName]: withOneElementRemoved }, resealManifestEntry: true, resealChecksums: true }), frozenReleaseCensus: { ...subject.frozenReleaseCensus, elementDeclarationCount: subject.frozenReleaseCensus.elementDeclarationCount - 1, referenceCount: subject.frozenReleaseCensus.referenceCount - 1, inReleaseReferenceCount: subject.frozenReleaseCensus.inReleaseReferenceCount - 1 } }));

	const walkGateDeclarationList = [
		{ gateId: IDENTITY_GATE_ID, title: 'F6 identity: unique, patterned, deterministic', conjunctList: identityConjunctList },
		{ gateId: ABSENT_GATE_ID, title: 'F7 absent is absent', conjunctList: absentConjunctList },
		{ gateId: TEXTS_GATE_ID, title: 'F8 texts (the occurrence conjunct waits for F3)', conjunctList: textsConjunctList },
		{ gateId: EDGES_GATE_ID, title: 'F10 edges (HAS_INSTANCE and HAS_CHILD wait for F3)', conjunctList: edgesConjunctList },
		{ gateId: COEXISTENCE_GATE_ID, title: 'F13 coexistence: G-UNIQUE and G-SOURCE', conjunctList: coexistenceConjunctList },
		{ gateId: BRIDGING_GATE_ID, title: 'F14 no bridging', conjunctList: bridgingConjunctList },
		{ gateId: SEQUENCE_GATE_ID, title: 'F22 sequence', conjunctList: sequenceConjunctList },
		{ gateId: DECLARATIONS_GATE_ID, title: 'F2 declarations (extra): one node per declaration', conjunctList: declarationsConjunctList },
	];
	const makeWalkSubject = () => ({ ...makeSubject(), secondReleaseStandardName: SECOND_RELEASE_STANDARD_NAME });

	runGateFamily(
		{ harness, familyName: `${standardKey} release gates (phase F1)`, gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 17, expectedTwinCount: 17 },
		() => {
			runGateFamily(
				{ harness, familyName: `${standardKey} walk gates (phase F2)`, gateDeclarationList: walkGateDeclarationList, twinRegistry: walkTwinRegistry, makeSubject: makeWalkSubject, cloneSubject, expectedConjunctCount: 15, expectedTwinCount: 16 },
				() => {
					scratchRootPathList.forEach((oneScratchRootPath) => fs.rmSync(oneScratchRootPath, { recursive: true, force: true }));
					whenDone();
				},
			);
		},
	);
};

module.exports = { runReleaseGateSuite, RULED_ROLE_BY_LABEL_SUFFIX, moduleName };
