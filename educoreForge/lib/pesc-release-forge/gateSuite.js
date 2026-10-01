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
// Every fault a twin plants in a release's own text (which NoteMessage it removes, which documentation it
// blanks, which extension it rewrites, which file it replaces) is DATA: releaseGateFixtures.json, one entry
// per release, refused by name when absent (phase F6; College Transcript 1.8.0's entry is the faults phases
// F1 to F4 wrote here as constants). Faults that only name CoreMain content every release carries
// (AccreditationTypeType, DocumentCompleteCodeType, LoanInformationType, DocumentID) stay constants.
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
const GATE_FIXTURES_PATH = path.join(LIBRARY_DIR, 'releaseGateFixtures.json');
const GATE_FIXTURE_FIELD_NAME_LIST = Object.freeze(['noteMessageRemoval', 'replacedFileName', 'documentationBlanking', 'extensionRewrite']);

const SNAPSHOT_CONTAINER_NAME = 'standardSourceData';
const CHECKSUM_FILE_NAME = 'SHA256SUMS';
const PROVENANCE_FILE_NAME = 'standardSourceLocation';
const PROVENANCE_README_RELATIVE_PATH = path.join('assets', SNAPSHOT_CONTAINER_NAME, '01', 'README_PROVENANCE.md');
const CORE_MAIN_FILE_RE = /^CoreMain_v[\d.]+\.xsd$/;

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

// Phase F6 added: F2-CODE-LIST-FACTS (the code list an element is typed by, on the element); in F11
// documentationShapesRoundTrip (element documentation lists, derivation annotations, schema-level
// annotations in place, on the release and on planted copies); in F12 regeneratedFilesNamespaceWellFormed
// (a namespaced schema attribute is written under a bound prefix); in F9 the substituted xsi:type
// subtype count (WORKORDER F6: Test Score Report 3, ePortfolio 5).
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
	const expectedLiteralSet = readJsonOrThrow(EXPECTED_LITERALS_PATH).literalByReleaseName[releaseName];
	// the release's twin faults (releaseGateFixtures.json): absent or partial is a fixture fault, never a default
	const gateFixture = readJsonOrThrow(GATE_FIXTURES_PATH).fixtureByReleaseName[releaseName];
	const missingFixtureFieldName = gateFixture === undefined ? 'the whole entry' : GATE_FIXTURE_FIELD_NAME_LIST.find((oneFieldName) => gateFixture[oneFieldName] === undefined);
	if (missingFixtureFieldName !== undefined) {
		throw new Error(`${moduleName}: fixture fault — releaseGateFixtures.json has no ${missingFixtureFieldName} for ${releaseName}`);
	}
	const fixtureFileNameList = [gateFixture.noteMessageRemoval.fileName, gateFixture.replacedFileName, gateFixture.documentationBlanking.fileName, gateFixture.extensionRewrite.fileName];
	const strangerFileName = fixtureFileNameList.find((oneFileName) => xsdFileNameList.indexOf(oneFileName) === -1);
	if (strangerFileName !== undefined) {
		throw new Error(`${moduleName}: fixture fault — releaseGateFixtures.json names '${strangerFileName}', which is no member file of ${releaseName} (${xsdFileNameList.join(', ')})`);
	}
	const replacedFileName = gateFixture.replacedFileName;
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
	// the fixture's NoteMessage: the first element opening with elementOpenText after the file's one
	// anchorText, self-closing or closed by the next </xs:element> (no element nested inside it)
	const noteMessageRemoval = gateFixture.noteMessageRemoval;
	const noteMessageFileName = noteMessageRemoval.fileName;
	const NOTE_MESSAGE_TYPE_TEXT = 'core:NoteMessageType"';
	const fixtureElementSpanOf = (fileText, fileName) => {
		const anchorCount = fileText.split(noteMessageRemoval.anchorText).length - 1;
		const elementStart = anchorCount === 1 ? fileText.indexOf(noteMessageRemoval.elementOpenText, fileText.indexOf(noteMessageRemoval.anchorText)) : -1;
		const openTagEnd = elementStart === -1 ? -1 : fileText.indexOf('>', elementStart) + 1;
		const selfClosing = openTagEnd > 0 && fileText[openTagEnd - 2] === '/';
		const closeStart = selfClosing || openTagEnd <= 0 ? -1 : fileText.indexOf('</xs:element>', openTagEnd);
		const elementEnd = selfClosing ? openTagEnd : closeStart === -1 ? -1 : closeStart + '</xs:element>'.length;
		const openTagText = elementStart === -1 ? '' : fileText.slice(elementStart, openTagEnd);
		if (elementEnd === -1 || openTagText.indexOf(NOTE_MESSAGE_TYPE_TEXT) === -1 || (!selfClosing && fileText.slice(openTagEnd, closeStart).indexOf('<xs:element') !== -1)) {
			throw new Error(`${moduleName}: fixture fault — no removable '${noteMessageRemoval.elementOpenText}' after the one '${noteMessageRemoval.anchorText}' in ${fileName} (anchors ${anchorCount})`);
		}
		return { elementStart, openTagEnd, elementEnd };
	};
	const withOneElementRemoved = (fileText, fileName) => {
		const { elementStart, elementEnd } = fixtureElementSpanOf(fileText, fileName);
		return fileText.slice(0, elementStart) + fileText.slice(elementEnd);
	};
	const withOpenTagRewritten = (fileText, fileName, rewriteOpenTag) => {
		const { elementStart, openTagEnd } = fixtureElementSpanOf(fileText, fileName);
		return fileText.slice(0, elementStart) + rewriteOpenTag(fileText.slice(elementStart, openTagEnd)) + fileText.slice(openTagEnd);
	};
	const REPOINTED_TYPE_NAME = 'NoteMessageTypeAbsent';
	const withOneTypeRepointed = (fileText, fileName) => withOpenTagRewritten(fileText, fileName, (openTagText) => openTagText.replace(NOTE_MESSAGE_TYPE_TEXT, `core:${REPOINTED_TYPE_NAME}"`));
	const UNION_TARGET_TEXT = '<xs:simpleType name="AccreditationTypeType">';
	const withUnionInserted = (fileText, fileName) => replacedOnce({ fileText, findText: UNION_TARGET_TEXT, replaceText: `${UNION_TARGET_TEXT}<xs:union memberTypes="xs:string xs:token"/>`, fileName });
	const rootFileName = realReleaseEntry.rootFilename;

	// ---- the subject every conjunct reads and every twin mutates (on a clone)
	const bundleForgeDeclaration = releaseBundle.readForgeDeclaration({ bundleDirPath });
	const makeSubject = () => ({
		snapshotDirPath: realSnapshotDirPath,
		forgeDeclaration: bundleForgeDeclaration,
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

	// forge a snapshot as the forger does: through the bundle's own entry module, or, with mutations, a
	// twin's census or a twin's declaration, through the framework, the subject's declaration and (a
	// double of) the shared hooks. (Phase F3: a twin that changes only the declaration is now honoured;
	// before, the entry module read the declaration from disk and such a twin never reached the forge.)
	const forgeSnapshot = ({ subject, snapshotDirPath }, callback) => {
		const bundle = subject.hooksMutationList.length || subject.frozenReleaseCensus !== bundleData.frozenReleaseCensus || subject.forgeDeclaration !== bundleForgeDeclaration
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
			title: `a scratch snapshot with the fixture's NoteMessage element (${noteMessageFileName}) removed (every seal resealed) is REFUSED BY THE CENSUS: elementDeclarationCount ${frozenElementCount - 1} against ${frozenElementCount}`,
			twinNameList: ['censusComparisonDisabled'],
			evaluate: (subject, callback) => {
				const scratchSnapshotDirPath = makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [noteMessageFileName]: withOneElementRemoved }, resealManifestEntry: true, resealChecksums: true });
				forgeSnapshot({ subject, snapshotDirPath: scratchSnapshotDirPath }, (forgeError, forged) => {
					callback('', { pass: refusedLike({ forgeError, refusalRe: censusRefusalRe }), detail: refusalDetail(forgeError, forged) });
				});
			},
		},
	];
	registerTwin(CENSUS_GATE_ID, 'statsEqualFrozenAndExpectedCensus', 'oneElementRemovedResealed', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [noteMessageFileName]: withOneElementRemoved }, resealManifestEntry: true, resealChecksums: true }) }));
	registerTwin(CENSUS_GATE_ID, 'removedElementRefusedByCensus', 'censusComparisonDisabled', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: RELEASE_CENSUS_PATH, find: 'if (differingFieldNameList.length > 0) {', replace: 'if (false) {' }),
	);

	// =====================================================================
	// F5-RESOLUTION
	// =====================================================================
	const RESOLUTION_GATE_ID = 'F5-RESOLUTION';
	const resolutionRefusalRe = new RegExp(`resolutionTable REFUSED: ${noteMessageFileName.replace(/\./g, '\\.')}: 'core:${REPOINTED_TYPE_NAME}' \\(type\\) resolves to urn:org:pesc:core:CoreMain:[^#]+#type/${REPOINTED_TYPE_NAME}, which ${coreMainFileName.replace(/\./g, '\\.')} does not define`);
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
			title: `a scratch snapshot whose fixture NoteMessage (${noteMessageFileName}) type= names core:${REPOINTED_TYPE_NAME} (resealed) is REFUSED BY THE RESOLUTION TABLE, naming the file, the QName and the namespace`,
			twinNameList: ['missingNameRefusalDisabled'],
			evaluate: (subject, callback) => {
				const scratchSnapshotDirPath = makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [noteMessageFileName]: withOneTypeRepointed }, resealManifestEntry: true, resealChecksums: true });
				forgeSnapshot({ subject, snapshotDirPath: scratchSnapshotDirPath }, (forgeError, forged) => {
					callback('', { pass: refusedLike({ forgeError, refusalRe: resolutionRefusalRe }), detail: refusalDetail(forgeError, forged) });
				});
			},
		},
	];
	registerTwin(RESOLUTION_GATE_ID, 'everyReferenceResolvesInside', 'oneTypeRepointedResealed', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [noteMessageFileName]: withOneTypeRepointed }, resealManifestEntry: true, resealChecksums: true }) }));
	registerTwin(RESOLUTION_GATE_ID, 'repointedTypeRefusedByResolution', 'missingNameRefusalDisabled', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: RESOLUTION_TABLE_PATH, find: 'if (resolvedRow === undefined) {', replace: 'if (false) {' }),
	);

	// =====================================================================
	// F15-SCAFFOLD
	// =====================================================================
	const SCAFFOLD_GATE_ID = 'F15-SCAFFOLD';
	const overwriteRefusalRe = /scaffoldReleaseBundleLib REFUSED: bundle directory '.*' already exists/;
	const folderRefusalRe = new RegExp(`manifestEntryLoader REFUSED: ${replacedFileName.replace(/\./g, '\\.')}: the manifest entry for '${realReleaseEntry.folderName.replace(/\./g, '\\.')}' says sha256`);
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
			title: `a scratch release folder with one byte of ${replacedFileName} replaced is REFUSED: the folder disagrees with its manifest entry`,
			twinNameList: ['folderShaComparisonDisabled'],
			evaluate: (subject, callback) => {
				scaffoldWith({ subject, scaffoldArgs: makeScratchReleaseInputs({ alterTextByFileName: { [replacedFileName]: withFirstByteAltered } }) }, (scaffoldError) => {
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
					callback('', { pass, detail: `text nodes ${textNodeList.length} (frozen ${walkLiteralSet.textNodeCount}${walkLiteralSet.textNodeCountCeiling === undefined ? '' : `; work order: at most ${walkLiteralSet.textNodeCountCeiling}`}); distinct declared texts ${expectedTextSet.size}; same set ${sameSet}; edge to an undeclared role ${undeclaredTargetEdge ? undeclaredTargetEdge.toRef.id : 'none'}` });
				});
			},
		},
		{
			conjunctId: 'effectiveDocumentationRule',
			title: 'every element and attribute: effectiveDocumentation is its own text when it has one, else its type\'s, and documentationSource says which; the per-kind counts EQUAL the frozen literals (elements with own text: the evidence census)',
			twinNameList: ['fixtureDocumentationBlanked'],
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
	// the fixture's element documentation (a reachable element whose own text no other node carries), blanked
	const documentationBlanking = gateFixture.documentationBlanking;
	const blankFixtureDocumentation = (fileText, fileName) => {
		const ownerOpenText = `<xs:complexType name="${documentationBlanking.ownerTypeName}">`;
		const ownerStart = fileText.indexOf(ownerOpenText);
		const elementStart = ownerStart === -1 ? -1 : fileText.indexOf(`<xs:element name="${documentationBlanking.elementName}"`, ownerStart);
		const documentationStart = elementStart === -1 ? -1 : fileText.indexOf('<xs:documentation>', elementStart) + '<xs:documentation>'.length;
		const documentationEnd = elementStart === -1 ? -1 : fileText.indexOf('</xs:documentation>', documentationStart);
		if (ownerStart === -1 || fileText.split(ownerOpenText).length !== 2 || elementStart === -1 || documentationEnd === -1 || fileText.indexOf('</xs:complexType>', ownerStart) < elementStart) {
			throw new Error(`${moduleName}: fixture fault — no ${documentationBlanking.ownerTypeName}/${documentationBlanking.elementName} documentation in ${fileName}`);
		}
		return fileText.slice(0, documentationStart) + fileText.slice(documentationEnd);
	};
	const blankedDocumentationSnapshot = (subject) => makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [documentationBlanking.fileName]: blankFixtureDocumentation }, resealManifestEntry: true, resealChecksums: true });
	registerWalkTwin(TEXTS_GATE_ID, 'textNodesAreTheDistinctDeclaredTexts', 'oneElementDocumentationBlanked', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: blankedDocumentationSnapshot(subject) }));
	registerWalkTwin(TEXTS_GATE_ID, 'effectiveDocumentationRule', 'fixtureDocumentationBlanked', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: blankedDocumentationSnapshot(subject) }));

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
	// the per-node half on its own (phase F3, NOTES-supervisor item 9): the declaration and the descriptor
	// agree, and one minted node's _source is altered after the kit stamped it
	registerWalkTwin(COEXISTENCE_GATE_ID, 'sourceEqualsDescriptorOnEveryNode', 'oneNodeSourceAltered', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: '	// ---- F14: the forge names no bridge target', replace: "	kit.nodes[kit.nodes.length - 1].properties._source = `${kit.nodes[kit.nodes.length - 1].properties._source}-altered`;\n	// ---- F14: the forge names no bridge target" }),
	);

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

	// ---- F2 (extra): the NoteMessage declarations, per file (College Transcript 1.8.0, QUIET_ORBIT ruling: 103 =
	// AR 50 + CM 52 + root 1; each release's count is its own literal)
	const DECLARATIONS_GATE_ID = 'F2-DECLARATIONS';
	const declarationsConjunctList = [
		{
			conjunctId: 'noteMessageDeclarationsPerFile',
			title: 'NoteMessage element declarations per file EQUAL the ruled literal (each its own node, under its own owner)',
			twinNameList: ['fixtureNoteMessageRemoved'],
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
	registerWalkTwin(DECLARATIONS_GATE_ID, 'noteMessageDeclarationsPerFile', 'fixtureNoteMessageRemoved', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [noteMessageFileName]: withOneElementRemoved }, resealManifestEntry: true, resealChecksums: true }), frozenReleaseCensus: { ...subject.frozenReleaseCensus, elementDeclarationCount: subject.frozenReleaseCensus.elementDeclarationCount - 1, referenceCount: subject.frozenReleaseCensus.referenceCount - 1, inReleaseReferenceCount: subject.frozenReleaseCensus.inReleaseReferenceCount - 1 } }));

	// ---- F2 (extra): the code list an element is typed by, carried onto the element (QUIET_ORBIT, F6 first
	// commit: the derived bridge renders only the subject's own properties, so the list's prose must sit there)
	const CODE_LIST_FACTS_GATE_ID = 'F2-CODE-LIST-FACTS';
	const CODE_LIST_FACT_NAME_LIST = ['codeListName', 'codeListDocumentation'];
	const codeListFactsConjunctList = [
		{
			conjunctId: 'codeListFactsOnTypedElements',
			title: 'every element with HAS_OPTION_SET carries codeListName (the named list\'s name; none for an anonymous list) and codeListDocumentation (the list\'s own documentation, absent when it has none), read through the edge; no other element carries either; neither is a declared text property; the counts EQUAL the frozen literal',
			twinNameList: ['namedCodeListDocumentationDropped', 'codeListDocumentationDeclaredAsText'],
			evaluate: (subject, callback) => {
				if (walkLiteralSet === undefined || walkLiteralSet.codeListFactCount === undefined) {
					callback('', missingLiteralResult('codeListFactCount'));
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const nodeByStableId = {};
					forged.nodes.forEach((oneNode) => {
						nodeByStableId[oneNode.stableId] = oneNode;
					});
					const codeListByElement = {};
					forged.edges.filter((oneEdge) => oneEdge.type === EDGE_TYPES.HAS_OPTION_SET).forEach((oneEdge) => {
						codeListByElement[oneEdge.fromRef.id] = nodeByStableId[oneEdge.toRef.id];
					});
					const wrongList = [];
					const factCount = { namedCodeList: 0, anonymousCodeList: 0, withCodeListDocumentation: 0 };
					forged.nodes.filter((oneNode) => labelSuffixOf(oneNode) === 'Element').forEach((oneNode) => {
						const codeListNode = codeListByElement[oneNode.stableId];
						const props = oneNode.properties;
						const expected = codeListNode === undefined ? {} : { codeListName: codeListNode.properties.documentPosition === undefined ? undefined : codeListNode.properties.name, codeListDocumentation: codeListNode.properties.documentation };
						if (props.codeListName !== expected.codeListName || props.codeListDocumentation !== expected.codeListDocumentation) {
							wrongList.push(`${oneNode.stableId} carries ${JSON.stringify([props.codeListName, (props.codeListDocumentation || '').slice(0, 30)])}`);
						}
						if (codeListNode !== undefined) {
							factCount[codeListNode.properties.documentPosition === undefined ? 'anonymousCodeList' : 'namedCodeList']++;
							factCount.withCodeListDocumentation += props.codeListDocumentation === undefined ? 0 : 1;
						}
					});
					const textPropertyListByRole = subject.forgeDeclaration.embedTextDeclaration.textPropertyListByRole;
					const declaredAsText = Object.keys(textPropertyListByRole).filter((oneRole) => textPropertyListByRole[oneRole].some((onePropertyName) => CODE_LIST_FACT_NAME_LIST.indexOf(onePropertyName) !== -1));
					const pass = wrongList.length === 0 && declaredAsText.length === 0 && sortedCountText(factCount) === sortedCountText(walkLiteralSet.codeListFactCount);
					callback('', { pass, detail: `${sortedCountText(factCount)}; declared as text by ${declaredAsText.length ? declaredAsText.join(', ') : 'no role'}; wrong ${wrongList.length ? wrongList.slice(0, 3).join('; ') : 'none'}` });
				});
			},
		},
	];
	registerWalkTwin(CODE_LIST_FACTS_GATE_ID, 'codeListFactsOnTypedElements', 'namedCodeListDocumentationDropped', 'productionMutation', (subject) =>
		addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: 'codeListDocumentation: nonBlankOrNull(target.definition.documentation) }', replace: 'codeListDocumentation: null }' }),
	);
	registerWalkTwin(CODE_LIST_FACTS_GATE_ID, 'codeListFactsOnTypedElements', 'codeListDocumentationDeclaredAsText', 'inputFault', (subject) => ({
		...subject,
		forgeDeclaration: {
			...subject.forgeDeclaration,
			embedTextDeclaration: { ...subject.forgeDeclaration.embedTextDeclaration, textPropertyListByRole: { ...subject.forgeDeclaration.embedTextDeclaration.textPropertyListByRole, [DME_ROLES.PROPERTY]: subject.forgeDeclaration.embedTextDeclaration.textPropertyListByRole[DME_ROLES.PROPERTY].concat(['codeListDocumentation']) } },
		},
	}));

	const walkGateDeclarationList = [
		{ gateId: IDENTITY_GATE_ID, title: 'F6 identity: unique, patterned, deterministic', conjunctList: identityConjunctList },
		{ gateId: ABSENT_GATE_ID, title: 'F7 absent is absent', conjunctList: absentConjunctList },
		{ gateId: TEXTS_GATE_ID, title: 'F8 texts (the occurrence conjunct waits for F3)', conjunctList: textsConjunctList },
		{ gateId: EDGES_GATE_ID, title: 'F10 edges (HAS_INSTANCE and HAS_CHILD wait for F3)', conjunctList: edgesConjunctList },
		{ gateId: COEXISTENCE_GATE_ID, title: 'F13 coexistence: G-UNIQUE and G-SOURCE', conjunctList: coexistenceConjunctList },
		{ gateId: BRIDGING_GATE_ID, title: 'F14 no bridging', conjunctList: bridgingConjunctList },
		{ gateId: SEQUENCE_GATE_ID, title: 'F22 sequence', conjunctList: sequenceConjunctList },
		{ gateId: DECLARATIONS_GATE_ID, title: 'F2 declarations (extra): one node per declaration', conjunctList: declarationsConjunctList },
		{ gateId: CODE_LIST_FACTS_GATE_ID, title: 'F2 code-list facts (extra): the list an element is typed by, on the element', conjunctList: codeListFactsConjunctList },
	];
	const makeWalkSubject = () => ({ ...makeSubject(), secondReleaseStandardName: SECOND_RELEASE_STANDARD_NAME });

	// =====================================================================
	// PHASE F3 FAMILY — reachability and occurrences (WORKORDER §3 F3): F9 reachability, F18 occurrence
	// identity, F19 occurrence tree, F10's HAS_INSTANCE and HAS_CHILD, F8's occurrence conjunct, and
	// (extra) the global element digest. A third family with its own twin registry.
	// =====================================================================
	const reachabilityLiteralSet = expectedLiteralSet === undefined ? undefined : expectedLiteralSet.reachability;
	const reachabilityTwinRegistry = makeTwinRegistry();
	const registerReachabilityTwin = (gateId, conjunctId, twinName, leverKind, run) => reachabilityTwinRegistry.register({ gateId, conjunctId, twinName, leverKind, shippedConfig: true, run });
	const REACHABILITY_PATH = path.join(LIBRARY_DIR, 'reachability.js');
	const SCOPE_TOOL_LIB_PATH = path.join(LIBRARY_DIR, 'tools', 'writeScopeAndSectionsLib.js');
	const { contextTextOf } = require('./contextText');
	const missingReachabilityLiteralResult = () => ({ pass: false, detail: `expectedReleaseLiterals.json has no reachability block for ${releaseName}` });
	const widened = (listOrScalar) => (listOrScalar === undefined ? [] : Array.isArray(listOrScalar) ? listOrScalar : [listOrScalar]);
	const sortedCountText = (countMap) => JSON.stringify(Object.keys(countMap).sort().map((oneName) => [oneName, countMap[oneName]]));
	const countOf = (itemList, nameOf) => itemList.reduce((soFar, oneItem) => ({ ...soFar, [nameOf(oneItem)]: (soFar[nameOf(oneItem)] || 0) + 1 }), {});

	// what every F3 conjunct reads from one forge: the nodes by kind, and each declaration's occurrences
	// in document order (the order the walk minted them)
	const releaseViewOf = (forged) => {
		const nodeByStableId = {};
		forged.nodes.forEach((oneNode) => {
			nodeByStableId[oneNode.stableId] = oneNode;
		});
		const occurrenceList = forged.nodes.filter((oneNode) => labelSuffixOf(oneNode) === 'Occurrence');
		const elementList = forged.nodes.filter((oneNode) => labelSuffixOf(oneNode) === 'Element');
		const instanceEdgeList = forged.edges.filter((oneEdge) => oneEdge.type === EDGE_TYPES.HAS_INSTANCE);
		const childEdgeList = forged.edges.filter((oneEdge) => oneEdge.type === EDGE_TYPES.HAS_CHILD);
		const occurrenceListByDeclaration = {};
		const occurrencePositionByStableId = {};
		occurrenceList.forEach((oneOccurrence, occurrenceIndex) => {
			occurrencePositionByStableId[oneOccurrence.stableId] = occurrenceIndex;
		});
		instanceEdgeList.forEach((oneEdge) => {
			(occurrenceListByDeclaration[oneEdge.fromRef.id] = occurrenceListByDeclaration[oneEdge.fromRef.id] || []).push(nodeByStableId[oneEdge.toRef.id]);
		});
		Object.keys(occurrenceListByDeclaration).forEach((oneDeclarationStableId) => occurrenceListByDeclaration[oneDeclarationStableId].sort((left, right) => occurrencePositionByStableId[left.stableId] - occurrencePositionByStableId[right.stableId]));
		const viaSetOf = (declarationStableId) => new Set((occurrenceListByDeclaration[declarationStableId] || []).map((oneOccurrence) => oneOccurrence.properties.reachableVia));
		return { nodeByStableId, occurrenceList, elementList, instanceEdgeList, childEdgeList, occurrenceListByDeclaration, viaSetOf };
	};
	const sectionsOfDeclaration = (declarationOccurrenceList) => [...new Set(declarationOccurrenceList.map((oneOccurrence) => oneOccurrence.properties.sectionPath))];

	// ---- F9-REACHABILITY
	const REACHABILITY_GATE_ID = 'F9-REACHABILITY';
	// the fixture's extension rewritten as a restriction: an xsi:type substitution subtype where the release
	// has one (its substitution disappears), else a reached type's extension (its base content disappears)
	const extensionRewrite = gateFixture.extensionRewrite;
	const fixtureExtensionRewritten = (fileText, fileName) => {
		const typeOpenText = `<xs:complexType name="${extensionRewrite.typeName}">`;
		const typeStart = fileText.indexOf(typeOpenText);
		const extensionOpenHead = `<xs:extension base="${extensionRewrite.baseQNameText}"`;
		const extensionStart = typeStart === -1 ? -1 : fileText.indexOf(extensionOpenHead, typeStart);
		const extensionOpenEnd = extensionStart === -1 ? -1 : fileText.indexOf('>', extensionStart) + 1;
		const selfClosing = extensionOpenEnd > 0 && fileText[extensionOpenEnd - 2] === '/';
		const extensionEnd = extensionOpenEnd <= 0 ? -1 : selfClosing ? extensionOpenEnd : fileText.indexOf('</xs:extension>', extensionOpenEnd);
		if (typeStart === -1 || fileText.split(typeOpenText).length !== 2 || extensionStart === -1 || extensionEnd === -1 || fileText.indexOf('</xs:complexType>', typeStart) < extensionEnd) {
			throw new Error(`${moduleName}: fixture fault — no ${extensionRewrite.typeName} extension of ${extensionRewrite.baseQNameText} in ${fileName}`);
		}
		const restrictionOpenText = `<xs:restriction base="${extensionRewrite.baseQNameText}"${selfClosing ? '/>' : '>'}`;
		return selfClosing
			? `${fileText.slice(0, extensionStart)}${restrictionOpenText}${fileText.slice(extensionOpenEnd)}`
			: `${fileText.slice(0, extensionStart)}${restrictionOpenText}${fileText.slice(extensionOpenEnd, extensionEnd)}</xs:restriction>${fileText.slice(extensionEnd + '</xs:extension>'.length)}`;
	};
	const fixtureNoteMessageRemovedSubject = (subject) => ({
		...subject,
		snapshotDirPath: makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [noteMessageFileName]: withOneElementRemoved }, resealManifestEntry: true, resealChecksums: true }),
		frozenReleaseCensus: { ...subject.frozenReleaseCensus, elementDeclarationCount: subject.frozenReleaseCensus.elementDeclarationCount - 1, referenceCount: subject.frozenReleaseCensus.referenceCount - 1, inReleaseReferenceCount: subject.frozenReleaseCensus.inReleaseReferenceCount - 1 },
	});
	const reachabilityConjunctList = [
		{
			conjunctId: 'reachabilityCountsEqualLiterals',
			title: 'reachable declarations (content and base, xsiType only, all), occurrences (all, xsiType), reachable named types and groups (content and base, all), substituted xsi:type subtypes, sections, deepest document depths and the substitution rule EQUAL the literals (WORKORDER F3 and F6, as ruled)',
			twinNameList: ['fixtureNoteMessageRemoved', 'fixtureExtensionRewritten', 'wildcardFollowed'],
			evaluate: (subject, callback) => {
				if (reachabilityLiteralSet === undefined) {
					callback('', missingReachabilityLiteralResult());
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const view = releaseViewOf(forged);
					const reachableElementList = view.elementList.filter((oneNode) => oneNode.properties.reachableFromRoot === true);
					const stats = forged.stats.reachabilityStats;
					const measured = {
						substitutableSubtypeRuleName: stats.substitutableSubtypeRuleName,
						substitutedSubtypeCount: stats.substitutedSubtypeCount,
						contentAndBaseDeclarationCount: reachableElementList.filter((oneNode) => view.viaSetOf(oneNode.stableId).has('content') || view.viaSetOf(oneNode.stableId).has('base')).length,
						xsiTypeOnlyDeclarationCount: reachableElementList.filter((oneNode) => view.viaSetOf(oneNode.stableId).size === 1 && view.viaSetOf(oneNode.stableId).has('xsiType')).length,
						reachableDeclarationCount: reachableElementList.length,
						contentAndBaseOccurrenceCount: view.occurrenceList.filter((oneNode) => oneNode.properties.reachableVia !== 'xsiType').length,
						xsiTypeOccurrenceCount: view.occurrenceList.filter((oneNode) => oneNode.properties.reachableVia === 'xsiType').length,
						occurrenceCount: view.occurrenceList.length,
						contentAndBaseDefinitionCount: stats.contentAndBaseDefinitionCount,
						reachableDefinitionCount: forged.nodes.filter((oneNode) => oneNode.properties.documentPosition !== undefined && labelSuffixOf(oneNode) !== 'GlobalElement' && oneNode.properties.reachableFromRoot === true).length,
						deepestContentAndBaseDocumentDepth: Math.max(...view.occurrenceList.filter((oneNode) => oneNode.properties.reachableVia !== 'xsiType').map((oneNode) => oneNode.properties.documentDepth)),
						deepestDocumentDepth: Math.max(...view.occurrenceList.map((oneNode) => oneNode.properties.documentDepth)),
						sectionCount: new Set(view.occurrenceList.map((oneNode) => oneNode.properties.sectionPath)).size,
					};
					const differingNameList = Object.keys(measured).filter((oneName) => measured[oneName] !== reachabilityLiteralSet[oneName]);
					// the content-and-base declaration count also equals the walk's own first pass (no substitution)
					const firstPassAgrees = stats.contentAndBaseDeclarationCount === measured.contentAndBaseDeclarationCount && stats.contentAndBaseOccurrenceCount === measured.contentAndBaseOccurrenceCount;
					callback('', { pass: differingNameList.length === 0 && firstPassAgrees, detail: `${JSON.stringify(measured)}; first pass ${stats.contentAndBaseDeclarationCount}/${stats.contentAndBaseOccurrenceCount}; differing: ${differingNameList.length ? differingNameList.map((oneName) => `${oneName} ${measured[oneName]} (literal ${reachabilityLiteralSet[oneName]})`).join(', ') : 'none'}` });
				});
			},
		},
		{
			conjunctId: 'marksAgreeWithInstances',
			title: 'every reachableFromRoot true element declaration has at least one HAS_INSTANCE edge and every false one has none; no unreachable declaration carries a path fact; contextPathCount equals its HAS_INSTANCE count and contextText is its first occurrence\'s; every top-level definition, anonymous type, attribute and code carries the mark',
			twinNameList: ['everyElementMarkedReachable'],
			evaluate: (subject, callback) => {
				forgeOrFail({ subject }, callback, (forged) => {
					const view = releaseViewOf(forged);
					const PATH_FACT_NAME_LIST = ['contextText', 'contextPathSampleList', 'contextPathCount', 'occurrenceSectionList', 'reachableVia'];
					const wrongList = [];
					view.elementList.forEach((oneNode) => {
						const declarationOccurrenceList = view.occurrenceListByDeclaration[oneNode.stableId] || [];
						const props = oneNode.properties;
						if (props.reachableFromRoot !== (declarationOccurrenceList.length > 0)) {
							wrongList.push(`${oneNode.stableId} marked ${props.reachableFromRoot} with ${declarationOccurrenceList.length} instances`);
							return;
						}
						if (declarationOccurrenceList.length === 0) {
							const carriedName = PATH_FACT_NAME_LIST.find((oneName) => props[oneName] !== undefined);
							if (carriedName !== undefined) {
								wrongList.push(`${oneNode.stableId} unreachable carries ${carriedName}`);
							}
							return;
						}
						if (props.contextPathCount !== declarationOccurrenceList.length || props.contextText !== declarationOccurrenceList[0].properties.contextText) {
							wrongList.push(`${oneNode.stableId} contextPathCount ${props.contextPathCount} / contextText '${props.contextText}' against ${declarationOccurrenceList.length} instances`);
						}
					});
					const MARKED_LABEL_SUFFIX_LIST = ['Type', 'AnonymousType', 'CodeList', 'DataType', 'Group', 'GlobalElement', 'Attribute', 'Code'];
					const unmarkedNode = forged.nodes.find((oneNode) => MARKED_LABEL_SUFFIX_LIST.indexOf(labelSuffixOf(oneNode)) !== -1 && typeof oneNode.properties.reachableFromRoot !== 'boolean');
					if (unmarkedNode !== undefined) {
						wrongList.push(`${unmarkedNode.stableId} carries no reachableFromRoot`);
					}
					callback('', { pass: wrongList.length === 0, detail: `${view.elementList.length} element declarations, ${view.instanceEdgeList.length} HAS_INSTANCE; wrong ${wrongList.length ? wrongList.slice(0, 3).join('; ') : 'none'}` });
				});
			},
		},
		{
			conjunctId: 'scopeAndSectionFilesFromTheForge',
			title: 'writeScopeAndSections over the forge: the scope list holds exactly the reachable declarations (the literal count), the section file exactly the literal sections, each labelled by the readable-path rule, and a graph read (every one-element list a scalar, as the replay engine stores it) yields byte-identical files',
			twinNameList: ['scalarWideningDisabled'],
			evaluate: (subject, callback) => {
				if (reachabilityLiteralSet === undefined) {
					callback('', missingReachabilityLiteralResult());
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const scopeToolLib = subject.scopeToolMutationList.length ? moduleDouble.loadWithMutations({ modulePath: SCOPE_TOOL_LIB_PATH, mutationList: subject.scopeToolMutationList }) : require(SCOPE_TOOL_LIB_PATH);
					const fromForge = scopeToolLib.scopeAndSectionsOf({ nodeList: forged.nodes, edgeList: forged.edges, labelPrefix: releaseDeclarationData.labelPrefix });
					// the replay engine's storage: a one-element list reads back as its one value
					const scalarizedNodeList = forged.nodes.map((oneNode) => ({ ...oneNode, properties: Object.keys(oneNode.properties).reduce((soFar, onePropertyName) => ({ ...soFar, [onePropertyName]: Array.isArray(oneNode.properties[onePropertyName]) && oneNode.properties[onePropertyName].length === 1 ? oneNode.properties[onePropertyName][0] : oneNode.properties[onePropertyName] }), {}) }));
					const collapsedDeclarationCount = scalarizedNodeList.filter((oneNode) => labelSuffixOf(oneNode) === 'Element' && typeof oneNode.properties.occurrenceSectionList === 'string').length;
					const fromGraphRead = scopeToolLib.scopeAndSectionsOf({ nodeList: scalarizedNodeList, edgeList: forged.edges, labelPrefix: releaseDeclarationData.labelPrefix });
					if (fromForge.refusalMessage || fromGraphRead.refusalMessage) {
						callback('', { pass: false, detail: `refused: ${(fromForge.refusalMessage || fromGraphRead.refusalMessage).slice(0, 400)}` });
						return;
					}
					const literalSectionPathList = Object.keys(reachabilityLiteralSet.occurrenceAndUnitCountBySection).sort();
					const reachableStableIdList = forged.nodes.filter((oneNode) => labelSuffixOf(oneNode) === 'Element' && oneNode.properties.reachableFromRoot === true).map((oneNode) => oneNode.stableId).sort();
					const labelsFollowRule = fromForge.sectionRowList.every((oneRow) => oneRow.documentSection === contextTextOf(oneRow.sectionPath));
					const pass =
						fromForge.reachableSubjectStableIdList.length === reachabilityLiteralSet.reachableDeclarationCount &&
						JSON.stringify(fromForge.reachableSubjectStableIdList) === JSON.stringify(reachableStableIdList) &&
						JSON.stringify(fromForge.sectionRowList.map((oneRow) => oneRow.sectionPath)) === JSON.stringify(literalSectionPathList) &&
						labelsFollowRule &&
						fromForge.scopeFileText === fromGraphRead.scopeFileText &&
						fromForge.sectionFileText === fromGraphRead.sectionFileText &&
						collapsedDeclarationCount > 0;
					callback('', { pass, detail: `scope ${fromForge.reachableSubjectStableIdList.length} (literal ${reachabilityLiteralSet.reachableDeclarationCount}); sections ${fromForge.sectionRowList.length} (literal ${literalSectionPathList.length}); labels follow the rule ${labelsFollowRule}; ${collapsedDeclarationCount} declarations' section list collapses to a scalar in a graph read; graph read identical: scope ${fromForge.scopeFileText === fromGraphRead.scopeFileText}, sections ${fromForge.sectionFileText === fromGraphRead.sectionFileText}; section file sha256 ${fromForge.sectionFileSha256}` });
				});
			},
		},
	];
	registerReachabilityTwin(REACHABILITY_GATE_ID, 'reachabilityCountsEqualLiterals', 'fixtureNoteMessageRemoved', 'inputFault', fixtureNoteMessageRemovedSubject);
	registerReachabilityTwin(REACHABILITY_GATE_ID, 'reachabilityCountsEqualLiterals', 'fixtureExtensionRewritten', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [extensionRewrite.fileName]: fixtureExtensionRewritten }, resealManifestEntry: true, resealChecksums: true }) }));
	registerReachabilityTwin(REACHABILITY_GATE_ID, 'reachabilityCountsEqualLiterals', 'wildcardFollowed', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: REACHABILITY_PATH, find: 'const WILDCARD_IS_FOLLOWED = false;', replace: 'const WILDCARD_IS_FOLLOWED = true;' }));
	registerReachabilityTwin(REACHABILITY_GATE_ID, 'marksAgreeWithInstances', 'everyElementMarkedReachable', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: 'reachableFromRoot: declarationIsReachable(elementStableId),', replace: 'reachableFromRoot: true,' }));
	registerReachabilityTwin(REACHABILITY_GATE_ID, 'scopeAndSectionFilesFromTheForge', 'scalarWideningDisabled', 'productionMutation', (subject) => addMutation(subject, 'scopeToolMutationList', { modulePath: SCOPE_TOOL_LIB_PATH, find: 'const widenedList = (listOrScalar) => (Array.isArray(listOrScalar) ? listOrScalar : [listOrScalar]);', replace: 'const widenedList = (listOrScalar) => listOrScalar;' }));

	// ---- F18-OCCURRENCE-IDENTITY
	const OCCURRENCE_IDENTITY_GATE_ID = 'F18-OCCURRENCE-IDENTITY';
	const OCCURRENCE_ID_MUTATION_FIND = 'occurrenceStableId: `${declarationStableId}/${OCCURRENCE_SEGMENT}/${contextPath}`,';
	const PUSHED_TWICE_MUTATION = {
		modulePath: REACHABILITY_PATH,
		find: '		descendInto({ occurrence, typeTarget, anonymousType: oneElement.anonymousType, anonymousOwnerStableId: anonymousTypeStableIdOf(declarationStableId), artifact, walkState });',
		replace: "		if (oneElement.name === 'DocumentID') { recordOccurrence({ declarationStableId, declarationName: oneElement.name, parentOccurrence: walkState.parentOccurrence, reachableVia: walkState.stepVia, xsiTypeName: walkState.xsiTypeName }); }\n		descendInto({ occurrence, typeTarget, anonymousType: oneElement.anonymousType, anonymousOwnerStableId: anonymousTypeStableIdOf(declarationStableId), artifact, walkState });",
	};
	const pushedTwiceRefusalRe = /reachability REFUSED: declaration '[^']+:DocumentID' reaches '[^']+' twice/;
	const occurrenceIdentityConjunctList = [
		{
			conjunctId: 'occurrenceIsDeclarationAtPath',
			title: "every occurrence's stableId is '<its declaration's stableId>/at/<contextPath>', it has exactly one HAS_INSTANCE (from that declaration), the paths reached by two declarations EQUAL the literal, each ending in the literal suffix (College Transcript 1.8.0: every …/Contacts/Address/PostalCode, 14 occurrences), and no declaration reaches one path twice",
			twinNameList: ['occurrenceMintedByPathAlone'],
			evaluate: (subject, callback) => {
				if (reachabilityLiteralSet === undefined) {
					callback('', missingReachabilityLiteralResult());
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const view = releaseViewOf(forged);
					const instanceSourceListByOccurrence = {};
					view.instanceEdgeList.forEach((oneEdge) => {
						(instanceSourceListByOccurrence[oneEdge.toRef.id] = instanceSourceListByOccurrence[oneEdge.toRef.id] || []).push(oneEdge.fromRef.id);
					});
					const misnamedList = view.occurrenceList.filter((oneNode) => {
						const sourceList = instanceSourceListByOccurrence[oneNode.stableId] || [];
						return sourceList.length !== 1 || oneNode.stableId !== `${sourceList[0]}/at/${oneNode.properties.contextPath}`;
					});
					const declarationCountByPath = countOf(view.occurrenceList, (oneNode) => oneNode.properties.contextPath);
					const sharedPathList = Object.keys(declarationCountByPath).filter((onePath) => declarationCountByPath[onePath] > 1);
					const sharedPathSuffix = reachabilityLiteralSet.pathReachedByTwoDeclarationsSuffix;
					const postalCodeOccurrenceCount = view.occurrenceList.filter((oneNode) => oneNode.properties.contextPath.endsWith(sharedPathSuffix)).length;
					const repeatingDeclarationCount = Object.keys(view.occurrenceListByDeclaration).filter((oneId) => new Set(view.occurrenceListByDeclaration[oneId].map((oneNode) => oneNode.properties.contextPath)).size !== view.occurrenceListByDeclaration[oneId].length).length;
					const pass = misnamedList.length === 0 && sharedPathList.length === reachabilityLiteralSet.pathReachedByTwoDeclarationsCount && sharedPathList.every((onePath) => onePath.endsWith(sharedPathSuffix)) && postalCodeOccurrenceCount === reachabilityLiteralSet.postalCodeOccurrenceCount && repeatingDeclarationCount === reachabilityLiteralSet.declarationReachingOnePathTwiceCount;
					callback('', { pass, detail: `${view.occurrenceList.length} occurrences; misnamed ${misnamedList.length ? misnamedList[0].stableId : 'none'}; paths by two declarations ${sharedPathList.length} (literal ${reachabilityLiteralSet.pathReachedByTwoDeclarationsCount}); occurrences ending '${sharedPathSuffix}' ${postalCodeOccurrenceCount}; declarations repeating a path ${repeatingDeclarationCount}` });
				});
			},
		},
		{
			conjunctId: 'pathPushedTwiceRefused',
			title: 'a scratch walk that pushes one path twice for one declaration (DocumentID) is REFUSED BY NAME by reachability.js, naming the declaration, the path and both parents',
			twinNameList: ['duplicatePathGuardDisabled'],
			evaluate: (subject, callback) => {
				forgeSnapshot({ subject: withExtraHooksMutation(subject, PUSHED_TWICE_MUTATION), snapshotDirPath: subject.snapshotDirPath }, (forgeError, forged) => {
					callback('', { pass: refusedLike({ forgeError, refusalRe: pushedTwiceRefusalRe }), detail: refusalDetail(forgeError, forged) });
				});
			},
		},
	];
	registerReachabilityTwin(OCCURRENCE_IDENTITY_GATE_ID, 'occurrenceIsDeclarationAtPath', 'occurrenceMintedByPathAlone', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: REACHABILITY_PATH, find: OCCURRENCE_ID_MUTATION_FIND, replace: "occurrenceStableId: `${declarationStableId.split(':')[0]}:occurrence/${contextPath}`," }));
	registerReachabilityTwin(OCCURRENCE_IDENTITY_GATE_ID, 'pathPushedTwiceRefused', 'duplicatePathGuardDisabled', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: REACHABILITY_PATH, find: '		if (parentByPath.has(contextPath)) {', replace: '		if (false) {' }));

	// ---- F19-OCCURRENCE-TREE
	const OCCURRENCE_TREE_GATE_ID = 'F19-OCCURRENCE-TREE';
	const occurrenceTreeConjunctList = [
		{
			conjunctId: 'parentChainIsThePath',
			title: "every occurrence's parentId chain (occurrences up to the root global element) spells its contextPath; its one HAS_CHILD comes from its parentId; documentDepth is its segment count less one, the framework's depth is documentDepth + 1 (ruled), and the occurrences by depth EQUAL the literal",
			twinNameList: ['occurrenceParentedOnDeclaration'],
			evaluate: (subject, callback) => {
				if (reachabilityLiteralSet === undefined) {
					callback('', missingReachabilityLiteralResult());
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const view = releaseViewOf(forged);
					const childSourceListByOccurrence = {};
					view.childEdgeList.forEach((oneEdge) => {
						(childSourceListByOccurrence[oneEdge.toRef.id] = childSourceListByOccurrence[oneEdge.toRef.id] || []).push(oneEdge.fromRef.id);
					});
					const wrongList = [];
					view.occurrenceList.forEach((oneOccurrence) => {
						const props = oneOccurrence.properties;
						const spelledNameList = [];
						let cursor = oneOccurrence;
						while (cursor !== undefined && labelSuffixOf(cursor) === 'Occurrence') {
							spelledNameList.unshift(cursor.properties.name);
							cursor = view.nodeByStableId[cursor.properties.parentId];
						}
						const topIsGlobalElement = cursor !== undefined && labelSuffixOf(cursor) === 'GlobalElement' && cursor.properties.reachableFromRoot === true;
						const spelledPath = topIsGlobalElement ? [cursor.properties.name].concat(spelledNameList).join('/') : `(chain ends at ${cursor === undefined ? 'nothing' : labelSuffixOf(cursor)})`;
						const childSourceList = childSourceListByOccurrence[oneOccurrence.stableId] || [];
						if (spelledPath !== props.contextPath || props.path !== props.contextPath || childSourceList.length !== 1 || childSourceList[0] !== props.parentId || props.documentDepth !== props.contextPath.split('/').length - 1 || props.depth !== props.documentDepth + reachabilityLiteralSet.frameworkDepthMinusDocumentDepth) {
							wrongList.push(`${oneOccurrence.stableId}: spelled '${spelledPath}', HAS_CHILD from [${childSourceList.join(', ')}], documentDepth ${props.documentDepth}, depth ${props.depth}`);
						}
					});
					const depthCountText = sortedCountText(countOf(view.occurrenceList, (oneNode) => String(oneNode.properties.documentDepth)));
					const pass = wrongList.length === 0 && view.childEdgeList.length === view.occurrenceList.length && depthCountText === sortedCountText(reachabilityLiteralSet.occurrenceCountByDocumentDepth);
					callback('', { pass, detail: `${view.occurrenceList.length} occurrences, ${view.childEdgeList.length} HAS_CHILD; by depth ${depthCountText}; wrong ${wrongList.length ? wrongList.slice(0, 2).join('; ') : 'none'}` });
				});
			},
		},
		{
			conjunctId: 'sectionIsTwoSegmentsBelowRoot',
			title: "every occurrence's sectionPath is the first two segments below the root, or its whole path when shallower, and the occurrences and judgment units by section EQUAL the literal (22 sections)",
			twinNameList: ['sectionRuleThreeSegments'],
			evaluate: (subject, callback) => {
				if (reachabilityLiteralSet === undefined) {
					callback('', missingReachabilityLiteralResult());
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const view = releaseViewOf(forged);
					const RULED_SEGMENT_COUNT = 3;
					const wrongNode = view.occurrenceList.find((oneNode) => oneNode.properties.sectionPath !== oneNode.properties.contextPath.split('/').slice(0, RULED_SEGMENT_COUNT).join('/'));
					const measuredBySection = {};
					view.occurrenceList.forEach((oneNode) => {
						const sectionRow = (measuredBySection[oneNode.properties.sectionPath] = measuredBySection[oneNode.properties.sectionPath] || { occurrences: 0, units: 0 });
						sectionRow.occurrences++;
					});
					Object.keys(view.occurrenceListByDeclaration).forEach((oneDeclarationStableId) => sectionsOfDeclaration(view.occurrenceListByDeclaration[oneDeclarationStableId]).forEach((oneSectionPath) => {
						measuredBySection[oneSectionPath].units++;
					}));
					const bySectionText = (sectionMap) => JSON.stringify(Object.keys(sectionMap).sort().map((oneSection) => [oneSection, sectionMap[oneSection].occurrences, sectionMap[oneSection].units]));
					const pass = wrongNode === undefined && bySectionText(measuredBySection) === bySectionText(reachabilityLiteralSet.occurrenceAndUnitCountBySection);
					callback('', { pass, detail: `${Object.keys(measuredBySection).length} sections (literal ${reachabilityLiteralSet.sectionCount}); off-rule ${wrongNode ? `${wrongNode.properties.contextPath} → ${wrongNode.properties.sectionPath}` : 'none'}; by section equal ${bySectionText(measuredBySection) === bySectionText(reachabilityLiteralSet.occurrenceAndUnitCountBySection)}` });
				});
			},
		},
		{
			conjunctId: 'declarationPathEvidence',
			title: 'every reachable declaration: occurrenceSectionList is its occurrences\' sections, sorted; contextPathSampleList is the first two readable paths of each section in document order; reachableVia is its occurrences\' routes; spanning declarations, units, the sections-per-declaration histogram, the longest sample and the literal\'s spanning example (College Transcript 1.8.0: ContactsType/Address, 7 paths, 4 sections, 5 samples) EQUAL the literals',
			twinNameList: ['perSectionSampleOfOne'],
			evaluate: (subject, callback) => {
				if (reachabilityLiteralSet === undefined) {
					callback('', missingReachabilityLiteralResult());
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const view = releaseViewOf(forged);
					const VIA_ORDER = ['content', 'base', 'xsiType'];
					const wrongList = [];
					let unitCount = 0;
					const sectionCountHistogram = {};
					let longestSample = 0;
					view.elementList.filter((oneNode) => oneNode.properties.reachableFromRoot === true).forEach((oneNode) => {
						const declarationOccurrenceList = view.occurrenceListByDeclaration[oneNode.stableId];
						const sectionList = sectionsOfDeclaration(declarationOccurrenceList);
						const expectedSampleList = sectionList.reduce((soFar, oneSection) => soFar.concat(declarationOccurrenceList.filter((oneOccurrence) => oneOccurrence.properties.sectionPath === oneSection).slice(0, 2).map((oneOccurrence) => contextTextOf(oneOccurrence.properties.contextPath))), []);
						const expectedViaList = VIA_ORDER.filter((oneVia) => declarationOccurrenceList.some((oneOccurrence) => oneOccurrence.properties.reachableVia === oneVia));
						const props = oneNode.properties;
						if (JSON.stringify(widened(props.occurrenceSectionList)) !== JSON.stringify(sectionList.slice().sort()) || JSON.stringify(widened(props.contextPathSampleList)) !== JSON.stringify(expectedSampleList) || JSON.stringify(widened(props.reachableVia)) !== JSON.stringify(expectedViaList)) {
							wrongList.push(oneNode.stableId);
						}
						unitCount += sectionList.length;
						sectionCountHistogram[sectionList.length] = (sectionCountHistogram[sectionList.length] || 0) + 1;
						longestSample = Math.max(longestSample, widened(props.contextPathSampleList).length);
					});
					const example = reachabilityLiteralSet.spanningExample;
					const exampleNode = view.nodeByStableId[`${standardKey}:${example.declarationReleaseIndependentId}`];
					const exampleHolds = exampleNode !== undefined && (view.occurrenceListByDeclaration[exampleNode.stableId] || []).length === example.occurrenceCount && JSON.stringify(widened(exampleNode.properties.occurrenceSectionList)) === JSON.stringify(example.occurrenceSectionList) && widened(exampleNode.properties.contextPathSampleList).length === example.contextPathSampleListLength;
					const spanningCount = Object.keys(sectionCountHistogram).filter((oneCount) => Number(oneCount) > 1).reduce((soFar, oneCount) => soFar + sectionCountHistogram[oneCount], 0);
					const pass = wrongList.length === 0 && exampleHolds && unitCount === reachabilityLiteralSet.judgmentUnitCount && spanningCount === reachabilityLiteralSet.spanningDeclarationCount && sortedCountText(sectionCountHistogram) === sortedCountText(reachabilityLiteralSet.sectionsPerDeclarationHistogram) && longestSample === reachabilityLiteralSet.perSectionSampleListMaxLength;
					callback('', { pass, detail: `units ${unitCount}; spanning ${spanningCount}; histogram ${sortedCountText(sectionCountHistogram)}; longest sample ${longestSample}; spanning example holds ${exampleHolds}; wrong ${wrongList.length ? wrongList.slice(0, 2).join('; ') : 'none'}` });
				});
			},
		},
	];
	registerReachabilityTwin(OCCURRENCE_TREE_GATE_ID, 'parentChainIsThePath', 'occurrenceParentedOnDeclaration', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: '			structural: { parentId: oneOccurrence.parentStableId, path: contextPath },', replace: '			structural: { parentId: oneOccurrence.declarationStableId, path: contextPath },' }));
	registerReachabilityTwin(OCCURRENCE_TREE_GATE_ID, 'sectionIsTwoSegmentsBelowRoot', 'sectionRuleThreeSegments', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: 'const SECTION_DEPTH_BELOW_ROOT = 2;', replace: 'const SECTION_DEPTH_BELOW_ROOT = 3;' }));
	registerReachabilityTwin(OCCURRENCE_TREE_GATE_ID, 'declarationPathEvidence', 'perSectionSampleOfOne', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: 'const PER_SECTION_SAMPLE_COUNT = 2;', replace: 'const PER_SECTION_SAMPLE_COUNT = 1;' }));

	// ---- F10-INSTANCE-CHILD
	const INSTANCE_CHILD_GATE_ID = 'F10-INSTANCE-CHILD';
	const instanceChildConjunctList = [
		{
			conjunctId: 'instanceAndChildEdgesWellFormed',
			title: 'HAS_INSTANCE runs only element declaration → occurrence and HAS_CHILD only occurrence or root global element → occurrence; each EQUALS the occurrence count (1,367), one of each into every occurrence',
			twinNameList: ['childEdgeFromDeclaration'],
			evaluate: (subject, callback) => {
				if (reachabilityLiteralSet === undefined) {
					callback('', missingReachabilityLiteralResult());
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const view = releaseViewOf(forged);
					const endpointText = (edgeList) => sortedCountText(countOf(edgeList, (oneEdge) => `${labelSuffixOf(view.nodeByStableId[oneEdge.fromRef.id])} -> ${labelSuffixOf(view.nodeByStableId[oneEdge.toRef.id])}`));
					const rootGlobalElementStableIdSet = new Set(forged.nodes.filter((oneNode) => labelSuffixOf(oneNode) === 'GlobalElement' && oneNode.properties.reachableFromRoot === true).map((oneNode) => oneNode.stableId));
					const instanceWellFormed = view.instanceEdgeList.every((oneEdge) => labelSuffixOf(view.nodeByStableId[oneEdge.fromRef.id]) === 'Element' && labelSuffixOf(view.nodeByStableId[oneEdge.toRef.id]) === 'Occurrence');
					const childWellFormed = view.childEdgeList.every((oneEdge) => labelSuffixOf(view.nodeByStableId[oneEdge.toRef.id]) === 'Occurrence' && (labelSuffixOf(view.nodeByStableId[oneEdge.fromRef.id]) === 'Occurrence' || rootGlobalElementStableIdSet.has(oneEdge.fromRef.id)));
					const intoEveryOccurrence = (edgeList) => new Set(edgeList.map((oneEdge) => oneEdge.toRef.id)).size === view.occurrenceList.length;
					const pass = instanceWellFormed && childWellFormed && view.instanceEdgeList.length === reachabilityLiteralSet.occurrenceCount && view.childEdgeList.length === reachabilityLiteralSet.occurrenceCount && intoEveryOccurrence(view.instanceEdgeList) && intoEveryOccurrence(view.childEdgeList);
					callback('', { pass, detail: `HAS_INSTANCE ${endpointText(view.instanceEdgeList)}; HAS_CHILD ${endpointText(view.childEdgeList)}` });
				});
			},
		},
	];
	registerReachabilityTwin(INSTANCE_CHILD_GATE_ID, 'instanceAndChildEdgesWellFormed', 'childEdgeFromDeclaration', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: 'addEdge({ edgeType: EDGE_TYPES.HAS_CHILD, fromStableId: oneOccurrence.parentStableId,', replace: 'addEdge({ edgeType: EDGE_TYPES.HAS_CHILD, fromStableId: oneOccurrence.declarationStableId,' }));

	// ---- F8-OCCURRENCE-TEXTS
	const OCCURRENCE_TEXTS_GATE_ID = 'F8-OCCURRENCE-TEXTS';
	const occurrenceTextsConjunctList = [
		{
			conjunctId: 'occurrencesCarryNoText',
			title: 'no occurrence is described by a text node (no EMBEDS_TEXT_OF reaches one), none carries searchText or a vector, and its role is non-embeddable in the declaration',
			twinNameList: ['supportTextDeclared'],
			evaluate: (subject, callback) => {
				forgeOrFail({ subject }, callback, (forged) => {
					const view = releaseViewOf(forged);
					const occurrenceStableIdSet = new Set(view.occurrenceList.map((oneNode) => oneNode.stableId));
					const describedCount = forged.edges.filter((oneEdge) => oneEdge.type === 'EMBEDS_TEXT_OF' && occurrenceStableIdSet.has(oneEdge.toRef.id)).length;
					const carryingNode = view.occurrenceList.find((oneNode) => oneNode.properties.searchText !== undefined || oneNode.properties.embedding !== undefined);
					const declaredRoleList = Object.keys(subject.forgeDeclaration.embedTextDeclaration.textPropertyListByRole);
					const occurrenceRole = subject.nodeKindTable.occurrence.role;
					const pass = describedCount === 0 && carryingNode === undefined && declaredRoleList.indexOf(occurrenceRole) === -1 && subject.forgeDeclaration.nonEmbeddableRoleList.indexOf(occurrenceRole) !== -1;
					callback('', { pass, detail: `${view.occurrenceList.length} occurrences; described by text ${describedCount}; carrying searchText or embedding ${carryingNode ? carryingNode.stableId : 'none'}; text roles ${declaredRoleList.join(', ')}` });
				});
			},
		},
		{
			conjunctId: 'reachableDocumentationSource',
			title: 'reachable element declarations by route and documentationSource EQUAL the literal (College Transcript 1.8.0 content and base: 367 own, 4 type, WORKORDER F2; xsiType-only: first measured in F3)',
			twinNameList: ['fixtureDocumentationBlankedReachable'],
			evaluate: (subject, callback) => {
				if (reachabilityLiteralSet === undefined || reachabilityLiteralSet.reachableDocumentationSourceCount === undefined) {
					callback('', { pass: false, detail: `expectedReleaseLiterals.json has no reachability.reachableDocumentationSourceCount for ${releaseName}` });
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const view = releaseViewOf(forged);
					const countByRoute = {};
					view.elementList.filter((oneNode) => oneNode.properties.reachableFromRoot === true).forEach((oneNode) => {
						const viaSet = view.viaSetOf(oneNode.stableId);
						const routeName = viaSet.has('content') || viaSet.has('base') ? 'contentAndBase' : 'xsiTypeOnly';
						const sourceName = oneNode.properties.documentationSource === undefined ? 'none' : oneNode.properties.documentationSource;
						countByRoute[routeName] = countByRoute[routeName] || {};
						countByRoute[routeName][sourceName] = (countByRoute[routeName][sourceName] || 0) + 1;
					});
					const routeText = (routeMap) => JSON.stringify(Object.keys(routeMap).sort().map((oneRoute) => [oneRoute, sortedCountText(routeMap[oneRoute])]));
					callback('', { pass: routeText(countByRoute) === routeText(reachabilityLiteralSet.reachableDocumentationSourceCount), detail: routeText(countByRoute) });
				});
			},
		},
	];
	registerReachabilityTwin(OCCURRENCE_TEXTS_GATE_ID, 'occurrencesCarryNoText', 'supportTextDeclared', 'inputFault', (subject) => ({
		...subject,
		forgeDeclaration: {
			...subject.forgeDeclaration,
			embedTextDeclaration: { ...subject.forgeDeclaration.embedTextDeclaration, textPropertyListByRole: { ...subject.forgeDeclaration.embedTextDeclaration.textPropertyListByRole, [DME_ROLES.SUPPORT]: ['name', 'contextText'] } },
		},
	}));
	registerReachabilityTwin(OCCURRENCE_TEXTS_GATE_ID, 'reachableDocumentationSource', 'fixtureDocumentationBlankedReachable', 'inputFault', (subject) => ({ ...subject, snapshotDirPath: blankedDocumentationSnapshot(subject) }));

	// ---- F6-DIGEST (extra; NOTES-supervisor item 9: verdict carry depends on it)
	const DIGEST_GATE_ID = 'F6-DIGEST';
	const digestConjunctList = [
		{
			conjunctId: 'globalElementDigestCoversItsType',
			title: "a global element's definitionDigest covers its resolved type, as an element's and an attribute's do: a scratch snapshot that alters only the documentation of LoanInformationType (adds one where it has none) changes LoanInformation's digest",
			twinNameList: ['globalElementDigestDefinitionOnly'],
			evaluate: (subject, callback) => {
				const coreMainText = fs.readFileSync(path.join(subject.snapshotDirPath, coreMainFileName), 'latin1');
				const typeOpenText = '<xs:complexType name="LoanInformationType">';
				const typeStart = coreMainText.indexOf(typeOpenText);
				const typeEnd = coreMainText.indexOf('</xs:complexType>', typeStart);
				const documentationOpenStart = coreMainText.indexOf('<xs:documentation>', typeStart);
				if (typeStart === -1 || typeEnd === -1) {
					throw new Error(`${moduleName}: fixture fault — no LoanInformationType in ${coreMainFileName}`);
				}
				// the type's own documentation is altered; a type with none (CoreMain 1.16.0, ePortfolio's) gains one,
				// written first inside the type, where XSD puts it
				const typeIsDocumented = documentationOpenStart !== -1 && documentationOpenStart < typeEnd && coreMainText.slice(typeStart + typeOpenText.length, documentationOpenStart).replace(/<xs:annotation>/, '').trim() === '';
				const alteredCoreMainText = typeIsDocumented
					? (fileText) => `${fileText.slice(0, documentationOpenStart + '<xs:documentation>'.length)}Altered for the digest gate. ${fileText.slice(documentationOpenStart + '<xs:documentation>'.length)}`
					: (fileText) => `${fileText.slice(0, typeStart + typeOpenText.length)}<xs:annotation><xs:documentation>Added for the digest gate.</xs:documentation></xs:annotation>${fileText.slice(typeStart + typeOpenText.length)}`;
				const alteredSnapshotDirPath = makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [coreMainFileName]: alteredCoreMainText }, resealManifestEntry: true, resealChecksums: true });
				const digestOf = (forged, nameText) => forged.nodes.find((oneNode) => labelSuffixOf(oneNode) === nameText.labelSuffix && oneNode.properties.name === nameText.name).properties.definitionDigest;
				forgeOrFail({ subject }, callback, (realForged) => {
					forgeOrFail({ subject, snapshotDirPath: alteredSnapshotDirPath }, callback, (alteredForged) => {
						const globalElement = { labelSuffix: 'GlobalElement', name: 'LoanInformation' };
						const typeNode = { labelSuffix: 'Type', name: 'LoanInformationType' };
						const globalDigestMoved = digestOf(realForged, globalElement) !== digestOf(alteredForged, globalElement);
						const typeDigestMoved = digestOf(realForged, typeNode) !== digestOf(alteredForged, typeNode);
						callback('', { pass: globalDigestMoved && typeDigestMoved, detail: `LoanInformationType digest moved ${typeDigestMoved}; LoanInformation digest moved ${globalDigestMoved}` });
					});
				});
			},
		},
	];
	registerReachabilityTwin(DIGEST_GATE_ID, 'globalElementDigestCoversItsType', 'globalElementDigestDefinitionOnly', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: 'definitionDigest: definitionDigestOf({ globalElement: oneDefinition, resolvedType: typed.target === null ? null : typed.target.definition }),', replace: 'definitionDigest: definitionDigestOf(oneDefinition),' }));

	const reachabilityGateDeclarationList = [
		{ gateId: REACHABILITY_GATE_ID, title: 'F9 reachability: the counts, the marks, and the bridge\'s two files', conjunctList: reachabilityConjunctList },
		{ gateId: OCCURRENCE_IDENTITY_GATE_ID, title: 'F18 occurrence identity: the declaration at the path', conjunctList: occurrenceIdentityConjunctList },
		{ gateId: OCCURRENCE_TREE_GATE_ID, title: 'F19 occurrence tree: the parent chain, the section rule, the per-declaration evidence', conjunctList: occurrenceTreeConjunctList },
		{ gateId: INSTANCE_CHILD_GATE_ID, title: "F10's HAS_INSTANCE and HAS_CHILD conjuncts", conjunctList: instanceChildConjunctList },
		{ gateId: OCCURRENCE_TEXTS_GATE_ID, title: "F8's occurrence conjunct, and the documentation of what is reachable", conjunctList: occurrenceTextsConjunctList },
		{ gateId: DIGEST_GATE_ID, title: "F6 digest (extra): a global element's digest covers its type", conjunctList: digestConjunctList },
	];
	// =====================================================================
	// PHASE F4 FAMILY — the round-trip pair and its hermetic gates (WORKORDER §3 F4): F11 round trip over
	// the graph double, F12 the regenerated files compile, F20 derived structure out of the round trip;
	// and QUIET_ORBIT's 2026-10-01 ruling (the three closed losses and the parser's attribute census).
	// =====================================================================
	const roundTripLiteralSet = expectedLiteralSet === undefined ? undefined : expectedLiteralSet.roundTrip;
	const roundTripTwinRegistry = makeTwinRegistry();
	const registerRoundTripTwin = (gateId, conjunctId, twinName, leverKind, run) => roundTripTwinRegistry.register({ gateId, conjunctId, twinName, leverKind, shippedConfig: true, run });
	const ROUND_TRIP_PAIR_PATH = path.join(LIBRARY_DIR, 'roundTripPair.js');
	const ROUND_TRIP_VALIDATOR_FOR_PATH = path.join(LIBRARY_DIR, 'roundTripValidatorFor.js');
	const roundTripHarnessLib = require(path.join(FORGE_FRAMEWORK_DIR, 'roundTripHarness', 'roundTripHarness'))();
	const childProcess = require('child_process');
	const missingRoundTripLiteralResult = () => ({ pass: false, detail: `expectedReleaseLiterals.json has no roundTrip block for ${releaseName}` });
	const XMLLINT_PROBE_TEXT = '<?xml version="1.0"?><roundTripProbe/>\n';
	const XMLLINT_PROBE_FILE_NAME = 'roundTripProbe.xml';
	const DROPPED_DEFINITION_OPEN_TEXT = '<xs:simpleType name="DocumentCompleteCodeType">';

	const roundTripPairOf = (subject) => (subject.roundTripMutationList.length ? moduleDouble.loadWithMutations({ modulePath: ROUND_TRIP_PAIR_PATH, mutationList: subject.roundTripMutationList }) : require(ROUND_TRIP_PAIR_PATH));
	const roundTripValidatorOf = (subject) => (subject.roundTripMutationList.length ? moduleDouble.loadWithMutations({ modulePath: ROUND_TRIP_VALIDATOR_FOR_PATH, mutationList: subject.roundTripMutationList }) : require(ROUND_TRIP_VALIDATOR_FOR_PATH)).makeRoundTripValidator({ forgeDeclaration: subject.forgeDeclaration });

	// the double's faults: a forge result with one code removed, or one invented code added
	const firstCodeOf = (forged) => forged.nodes.find((oneNode) => labelSuffixOf(oneNode) === 'Code');
	const DOUBLE_FAULT_BY_NAME = Object.freeze({
		oneCodeDeleted: (forged) => {
			const deletedStableId = firstCodeOf(forged).stableId;
			return { nodes: forged.nodes.filter((oneNode) => oneNode.stableId !== deletedStableId), edges: forged.edges.filter((oneEdge) => oneEdge.fromRef.id !== deletedStableId && oneEdge.toRef.id !== deletedStableId) };
		},
		oneCodeInjected: (forged) => {
			const modelCode = firstCodeOf(forged);
			const injectedProperties = { ...modelCode.properties, value: 'INJECTED', codePosition: 9999 };
			delete injectedProperties.documentation;
			delete injectedProperties.documentationValueList;
			return { nodes: forged.nodes.concat([{ ...modelCode, stableId: `${modelCode.stableId}Injected`, properties: injectedProperties }]), edges: forged.edges };
		},
	});
	const doubleOf = ({ subject, forged }) => roundTripHarnessLib.graphDoubleFrom({ forgeResult: subject.doubleFaultName === null ? forged : DOUBLE_FAULT_BY_NAME[subject.doubleFaultName](forged) });

	// the pair's two sides over the double, as the validator would see them
	const sideStatementsOf = ({ subject }, callback, onSides) => {
		forgeOrFail({ subject }, callback, (forged) => {
			const pair = roundTripPairOf(subject).makeRoundTripPair({ labelPrefix: releaseDeclarationData.labelPrefix });
			const verifiedFileList = parseChecksumFile(fs.readFileSync(path.join(subject.snapshotDirPath, CHECKSUM_FILE_NAME), 'utf8')).map((oneEntry) => oneEntry.relativePath);
			pair.canonicalizeSource({ snapshotPath: subject.snapshotDirPath, verifiedFileList }, (sourceError, sourceSide) => {
				if (sourceError) {
					callback('', { pass: false, detail: `canonicalizeSource refused: ${sourceError.slice(0, 300)}` });
					return;
				}
				pair.emitFromGraph({ reader: doubleOf({ subject, forged }) }, (emitError, graphSide) => {
					if (emitError || graphSide.fault !== undefined) {
						callback('', { pass: false, detail: `emitFromGraph: ${(emitError || graphSide.fault).slice(0, 300)}` });
						return;
					}
					onSides({ forged, pair, sourceStatements: sourceSide.statements, graphStatements: graphSide.statements, sourceStats: sourceSide.stats });
				});
			});
		});
	};
	const compareText = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);
	const sameStatement = (leftStatement, rightStatement) => rightStatement !== undefined && JSON.stringify(leftStatement) === JSON.stringify(rightStatement);

	// ---- F11-ROUND-TRIP
	const ROUND_TRIP_GATE_ID = 'F11-ROUND-TRIP';
	const NESTED_CHOICE_STATEMENT_RE = /\/\d+:(sequence|choice)\/\d+:choice$/;
	const FORBIDDEN_CANONICALIZER_REQUIRE_RE = /require\([^)]*(xsdTree|xsdParser|resolutionTable|walk|definitionDigest|reachability)['"]?\)/;
	const roundTripConjunctList = [
		{
			conjunctId: 'hermeticRoundTripClean',
			title: "the bundle's round-trip validator over the graph double: inventedTotal 0, contentGapTotal 0, roundTripClean, and explicitlyOmittedTotal EQUALS the literal and the canonicalizer's own count of comments, whitespace runs and processing instructions; the verdict file is written",
			twinNameList: ['oneCodeDeletedFromDouble', 'oneCodeInjectedIntoDouble'],
			evaluate: (subject, callback) => {
				if (roundTripLiteralSet === undefined) {
					callback('', missingRoundTripLiteralResult());
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const outputPath = makeScratchRoot(`${standardKey}RoundTrip-`);
					roundTripValidatorOf(subject).validateWithReader({ reader: doubleOf({ subject, forged }), snapshotPath: subject.snapshotDirPath, outputPath }, (validateError, verdict) => {
						if (validateError) {
							callback('', { pass: false, detail: `validator refused: ${validateError.slice(0, 400)}` });
							return;
						}
						const omittedCountByKind = verdict.census.sourceStats.omittedCountByKind;
						const canonicalizerOmittedCount = Object.keys(omittedCountByKind).reduce((soFar, oneKind) => soFar + omittedCountByKind[oneKind], 0);
						const verdictWritten = fs.existsSync(path.join(outputPath, roundTripHarnessLib.VERDICT_FILE_NAME));
						const pass = verdict.inventedTotal === roundTripLiteralSet.inventedTotal && verdict.contentGapTotal === roundTripLiteralSet.contentGapTotal && verdict.roundTripClean === true && verdict.explicitlyOmittedTotal === roundTripLiteralSet.explicitlyOmittedTotal && verdict.explicitlyOmittedTotal === canonicalizerOmittedCount && sortedCountText(omittedCountByKind) === sortedCountText(roundTripLiteralSet.explicitlyOmittedCountByKind) && verdictWritten;
						const firstLost = verdict.lostList.find((oneLost) => oneLost.lostCategory === 'contentGap');
						callback('', { pass, detail: `invented ${verdict.inventedTotal}; contentGap ${verdict.contentGapTotal}; explicitlyOmitted ${verdict.explicitlyOmittedTotal} ${sortedCountText(omittedCountByKind)}; clean ${verdict.roundTripClean}; verdict written ${verdictWritten}${verdict.inventedList.length ? `; first invented ${verdict.inventedList[0].statementKey}` : ''}${firstLost ? `; first gap ${firstLost.statementKey}` : ''}` });
					});
				});
			},
		},
		{
			conjunctId: 'canonicalizerIsNotTheParser',
			title: "roundTripPair.js requires none of the forge's readers (xsdTree, xsdParser, resolutionTable, walk, definitionDigest, reachability): the proof cannot show the forge agreeing with itself",
			twinNameList: ['canonicalizerRequiresTheParser'],
			evaluate: (subject, callback) => {
				const pairText = subject.roundTripMutationList.reduce((soFar, oneMutation) => (oneMutation.modulePath === ROUND_TRIP_PAIR_PATH ? soFar.replace(oneMutation.find, oneMutation.replace) : soFar), fs.readFileSync(ROUND_TRIP_PAIR_PATH, 'utf8'));
				const requireTextList = pairText.match(/require\([^)]*\)/g) || [];
				const forbiddenText = requireTextList.find((oneRequireText) => FORBIDDEN_CANONICALIZER_REQUIRE_RE.test(oneRequireText));
				callback('', { pass: forbiddenText === undefined && requireTextList.length > 0, detail: `requires ${requireTextList.join(', ')}; forbidden ${forbiddenText === undefined ? 'none' : forbiddenText}` });
			},
		},
		{
			conjunctId: 'nestedChoiceRebuilt',
			title: 'every xs:choice nested in a compositor (NOTES-supervisor item 6: elements under it are stamped normative, so contentModelShape must keep the choice) is regenerated in its place with its attributes; the count EQUALS the literal',
			twinNameList: ['nestedChoiceFlattenedToSequence'],
			evaluate: (subject, callback) => {
				if (roundTripLiteralSet === undefined) {
					callback('', missingRoundTripLiteralResult());
					return;
				}
				sideStatementsOf({ subject }, callback, ({ sourceStatements, graphStatements }) => {
					const nestedChoiceStatementKeyList = [...sourceStatements.keys()].filter((oneStatementKey) => NESTED_CHOICE_STATEMENT_RE.test(oneStatementKey));
					const unrebuiltStatementKeyList = nestedChoiceStatementKeyList.filter((oneStatementKey) => !sameStatement(sourceStatements.get(oneStatementKey), graphStatements.get(oneStatementKey)));
					callback('', { pass: nestedChoiceStatementKeyList.length === roundTripLiteralSet.nestedChoiceCount && unrebuiltStatementKeyList.length === 0, detail: `${nestedChoiceStatementKeyList.length} nested choices (literal ${roundTripLiteralSet.nestedChoiceCount}); not rebuilt ${unrebuiltStatementKeyList.length ? unrebuiltStatementKeyList.slice(0, 2).join(' | ') : 'none'}` });
				});
			},
		},
		{
			conjunctId: 'rulingLossesRegenerated',
			title: "the three losses the round trip found and the ruling closed are regenerated: every element's form attribute, every empty enumeration value and every empty documentation (counts EQUAL the literals)",
			twinNameList: ['formDroppedByWalk', 'emptyValueFlagDroppedByWalk', 'codeDocumentationListDroppedByWalk'],
			evaluate: (subject, callback) => {
				if (roundTripLiteralSet === undefined) {
					callback('', missingRoundTripLiteralResult());
					return;
				}
				sideStatementsOf({ subject }, callback, ({ sourceStatements, graphStatements }) => {
					const keysWhere = (predicate) => [...sourceStatements.entries()].filter((oneEntry) => predicate(oneEntry[1])).map((oneEntry) => oneEntry[0]);
					const hasAttribute = (oneStatement, attributeName, attributeValue) => Array.isArray(oneStatement.attributeList) && oneStatement.attributeList.some((onePair) => onePair[0] === attributeName && (attributeValue === undefined || onePair[1] === attributeValue));
					const caseStatementKeyListByName = {
						formElementCount: keysWhere((oneStatement) => oneStatement.tag === 'element' && hasAttribute(oneStatement, 'form')),
						emptyEnumerationValueCount: keysWhere((oneStatement) => oneStatement.tag === 'enumeration' && hasAttribute(oneStatement, 'value', '')),
						emptyDocumentationCount: keysWhere((oneStatement) => oneStatement.tag === 'documentation' && oneStatement.text === ''),
					};
					const failingList = [];
					Object.keys(caseStatementKeyListByName).forEach((caseName) => {
						const caseStatementKeyList = caseStatementKeyListByName[caseName];
						const unregeneratedStatementKey = caseStatementKeyList.find((oneStatementKey) => !sameStatement(sourceStatements.get(oneStatementKey), graphStatements.get(oneStatementKey)));
						if (caseStatementKeyList.length !== roundTripLiteralSet[caseName] || unregeneratedStatementKey !== undefined) {
							failingList.push(`${caseName} ${caseStatementKeyList.length} (literal ${roundTripLiteralSet[caseName]})${unregeneratedStatementKey ? ` not regenerated ${unregeneratedStatementKey}` : ''}`);
						}
					});
					callback('', { pass: failingList.length === 0, detail: `${Object.keys(caseStatementKeyListByName).map((caseName) => `${caseName} ${caseStatementKeyListByName[caseName].length}`).join(', ')}; failing ${failingList.length ? failingList.join('; ') : 'none'}` });
				});
			},
		},
		{
			conjunctId: 'untaughtAttributeRefusedByCensus',
			title: "a scratch snapshot whose fixture NoteMessage element carries an untaught attribute (block=\"#all\") is REFUSED BY NAME by the parser's attribute census (QUIET_ORBIT ruling: no silent attribute drop)",
			twinNameList: ['attributeCensusDisabled'],
			evaluate: (subject, callback) => {
				const scratchSnapshotDirPath = makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName: { [noteMessageFileName]: (fileText, fileName) => withOpenTagRewritten(fileText, fileName, (openTagText) => openTagText.replace('<xs:element ', '<xs:element block="#all" ')) }, resealManifestEntry: true, resealChecksums: true });
				forgeSnapshot({ subject, snapshotDirPath: scratchSnapshotDirPath }, (forgeError, forged) => {
					callback('', { pass: refusedLike({ forgeError, refusalRe: /xsdParser REFUSES: file '[^']+': attribute 'block' on xs:element \(a localElement/ }), detail: refusalDetail(forgeError, forged) });
				});
			},
		},
	];
	// ---- F11 (phase F6): the documentation shapes the first measurement of the six releases found lost,
	// proved on the release itself (its own counts, literals) AND on planted copies every release carries,
	// so each fix's twin is red on every bundle, not only on the release that needed it
	const PLANTED_ELEMENT_DOCUMENTATION_LIST = Object.freeze(['', 'planted second documentation (gate F11, phase F6)']);
	const PLANTED_DERIVATION_DOCUMENTATION = 'planted derivation documentation (gate F11, phase F6)';
	const PLANTED_FILE_DOCUMENTATION = 'planted trailing schema documentation (gate F11, phase F6)';
	const DERIVATION_PLANT_OPEN_TEXT = '<xs:simpleType name="DocumentCompleteCodeType">';
	const plantedDocumentationTextOf = (documentationList) => documentationList.map((oneText) => (oneText === '' ? '<xs:documentation/>' : `<xs:documentation>${oneText}</xs:documentation>`)).join('');
	// the fixture NoteMessage gains an empty and a second documentation (an annotation if it had none)
	const withElementDocumentationPlanted = (fileText, fileName) => {
		const { elementStart, openTagEnd, elementEnd } = fixtureElementSpanOf(fileText, fileName);
		const plantedText = plantedDocumentationTextOf(PLANTED_ELEMENT_DOCUMENTATION_LIST);
		const openTagText = fileText.slice(elementStart, openTagEnd);
		if (openTagText.endsWith('/>')) {
			return `${fileText.slice(0, elementStart)}${openTagText.slice(0, -2)}><xs:annotation>${plantedText}</xs:annotation></xs:element>${fileText.slice(elementEnd)}`;
		}
		const annotationCloseStart = fileText.indexOf('</xs:annotation>', openTagEnd);
		return annotationCloseStart !== -1 && annotationCloseStart < elementEnd
			? `${fileText.slice(0, annotationCloseStart)}${plantedText}${fileText.slice(annotationCloseStart)}`
			: `${fileText.slice(0, openTagEnd)}<xs:annotation>${plantedText}</xs:annotation>${fileText.slice(openTagEnd)}`;
	};
	// CoreMain's DocumentCompleteCodeType restriction gains its own annotation; a trailing schema-level
	// annotation follows CoreMain's last definition
	const withCoreMainDocumentationPlanted = (fileText, fileName) => {
		const typeStart = fileText.indexOf(DERIVATION_PLANT_OPEN_TEXT);
		const restrictionStart = typeStart === -1 ? -1 : fileText.indexOf('<xs:restriction', typeStart);
		const restrictionOpenEnd = restrictionStart === -1 ? -1 : fileText.indexOf('>', restrictionStart) + 1;
		const schemaCloseStart = fileText.lastIndexOf('</xs:schema>');
		if (restrictionOpenEnd <= 0 || fileText.slice(restrictionOpenEnd).trimStart().startsWith('<xs:annotation') || schemaCloseStart === -1) {
			throw new Error(`${moduleName}: fixture fault — no unannotated DocumentCompleteCodeType restriction, or no </xs:schema>, in ${fileName}`);
		}
		return `${fileText.slice(0, restrictionOpenEnd)}<xs:annotation>${plantedDocumentationTextOf([PLANTED_DERIVATION_DOCUMENTATION])}</xs:annotation>${fileText.slice(restrictionOpenEnd, schemaCloseStart)}<xs:annotation>${plantedDocumentationTextOf([PLANTED_FILE_DOCUMENTATION])}</xs:annotation>${fileText.slice(schemaCloseStart)}`;
	};
	const plantedDocumentationSnapshot = (subject) => {
		const alterTextByFileName = { [coreMainFileName]: withCoreMainDocumentationPlanted };
		alterTextByFileName[noteMessageFileName] = noteMessageFileName === coreMainFileName ? (fileText, fileName) => withElementDocumentationPlanted(withCoreMainDocumentationPlanted(fileText, fileName), fileName) : withElementDocumentationPlanted;
		return makeScratchSnapshot({ baseSnapshotDirPath: subject.snapshotDirPath, alterTextByFileName, resealManifestEntry: true, resealChecksums: true });
	};
	// the shapes in a release's own source statements: an element-like declaration's empty or second
	// documentation, a derivation's own annotation, a schema-level annotation not first among the children
	const DECLARATION_DOCUMENTATION_STATEMENT_KEY_RE = /\/\d+:(element|attribute)\/annotation\/documentation#(\d+)$|\|schema\/element:[^/]+\/annotation\/documentation#(\d+)$/;
	const DERIVATION_ANNOTATION_STATEMENT_KEY_RE = /:(restriction|extension)\/annotation$/;
	const documentationShapeStatementKeyListByShape = (sourceStatements) => {
		const statementKeyListByShape = { declarationDocumentationShapeCount: [], derivationAnnotationCount: [], fileAnnotationNotFirstCount: [] };
		sourceStatements.forEach((oneStatement, oneStatementKey) => {
			const declarationMatch = DECLARATION_DOCUMENTATION_STATEMENT_KEY_RE.exec(oneStatementKey);
			if (declarationMatch !== null && (oneStatement.text.trim() === '' || Number(declarationMatch[2] || declarationMatch[3]) > 1)) {
				statementKeyListByShape.declarationDocumentationShapeCount.push(oneStatementKey);
			}
			if (DERIVATION_ANNOTATION_STATEMENT_KEY_RE.test(oneStatementKey)) {
				statementKeyListByShape.derivationAnnotationCount.push(oneStatementKey);
			}
			if (oneStatement.schemaChildSegmentList !== undefined && oneStatement.schemaChildSegmentList.indexOf('annotation') > 0) {
				statementKeyListByShape.fileAnnotationNotFirstCount.push(oneStatementKey);
			}
		});
		return statementKeyListByShape;
	};
	roundTripConjunctList.push({
		conjunctId: 'documentationShapesRoundTrip',
		title: "every element-like declaration's documentation list (an empty and a second documentation included), every derivation's own annotation and every schema-level annotation in its place are regenerated: on the release itself (each shape's count EQUALS the literal) and on a scratch copy that plants all three in every release (the fixture NoteMessage; CoreMain's DocumentCompleteCodeType restriction; a trailing CoreMain annotation), whose round trip is clean",
		twinNameList: ['declarationDocumentationListDroppedByWalk', 'derivationAnnotationDroppedByWalk', 'fileAnnotationPositionIgnoredByEmitter'],
		evaluate: (subject, callback) => {
			if (roundTripLiteralSet === undefined || roundTripLiteralSet.documentationShapeCount === undefined) {
				callback('', { pass: false, detail: `expectedReleaseLiterals.json has no roundTrip.documentationShapeCount for ${releaseName}` });
				return;
			}
			sideStatementsOf({ subject }, callback, ({ sourceStatements, graphStatements }) => {
				const statementKeyListByShape = documentationShapeStatementKeyListByShape(sourceStatements);
				const failingList = [];
				Object.keys(statementKeyListByShape).forEach((shapeName) => {
					const unregeneratedStatementKey = statementKeyListByShape[shapeName].find((oneStatementKey) => !sameStatement(sourceStatements.get(oneStatementKey), graphStatements.get(oneStatementKey)));
					if (statementKeyListByShape[shapeName].length !== roundTripLiteralSet.documentationShapeCount[shapeName] || unregeneratedStatementKey !== undefined) {
						failingList.push(`${shapeName} ${statementKeyListByShape[shapeName].length} (literal ${roundTripLiteralSet.documentationShapeCount[shapeName]})${unregeneratedStatementKey ? ` not regenerated ${unregeneratedStatementKey}` : ''}`);
					}
				});
				sideStatementsOf({ subject: { ...subject, snapshotDirPath: plantedDocumentationSnapshot(subject) } }, callback, (planted) => {
					const plantedDiff = roundTripPairOf(subject).diffStatementsOf({ sourceStatements: planted.sourceStatements, graphStatements: planted.graphStatements });
					const plantedGapList = plantedDiff.lostList.filter((oneLost) => oneLost.lostCategory === 'contentGap');
					const plantedStatementKeyListByShape = documentationShapeStatementKeyListByShape(planted.sourceStatements);
					const everyShapePlanted = Object.keys(plantedStatementKeyListByShape).every((shapeName) => plantedStatementKeyListByShape[shapeName].length > statementKeyListByShape[shapeName].length);
					const pass = failingList.length === 0 && everyShapePlanted && plantedGapList.length === 0 && plantedDiff.inventedList.length === 0;
					callback('', { pass, detail: `release ${Object.keys(statementKeyListByShape).map((shapeName) => `${shapeName} ${statementKeyListByShape[shapeName].length}`).join(', ')}; failing ${failingList.length ? failingList.join('; ') : 'none'}; planted copy: every shape planted ${everyShapePlanted}, contentGap ${plantedGapList.length}${plantedGapList.length ? ` (first ${plantedGapList[0].statementKey})` : ''}, invented ${plantedDiff.inventedList.length}` });
				});
			});
		},
	});
	registerRoundTripTwin(ROUND_TRIP_GATE_ID, 'documentationShapesRoundTrip', 'declarationDocumentationListDroppedByWalk', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: '					documentationValueList: oneElement.documentationValues,', replace: '					documentationValueList: nonBlankOrNull(oneElement.documentation) === null ? null : [oneElement.documentation],' }));
	registerRoundTripTwin(ROUND_TRIP_GATE_ID, 'documentationShapesRoundTrip', 'derivationAnnotationDroppedByWalk', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: 'derivationDocumentationValueList: derivation.documentationValues };', replace: 'derivationDocumentationValueList: null };' }));
	registerRoundTripTwin(ROUND_TRIP_GATE_ID, 'documentationShapesRoundTrip', 'fileAnnotationPositionIgnoredByEmitter', 'productionMutation', (subject) => addMutation(subject, 'roundTripMutationList', { modulePath: ROUND_TRIP_PAIR_PATH, find: 'placedList.push({ documentPosition: oneAnnotation.afterDocumentPosition + (annotationIndex + 1) / FILE_ANNOTATION_POSITION_DIVISOR,', replace: 'placedList.push({ documentPosition: (annotationIndex + 1) / FILE_ANNOTATION_POSITION_DIVISOR,' }));

	registerRoundTripTwin(ROUND_TRIP_GATE_ID, 'hermeticRoundTripClean', 'oneCodeDeletedFromDouble', 'inputFault', (subject) => ({ ...subject, doubleFaultName: 'oneCodeDeleted' }));
	registerRoundTripTwin(ROUND_TRIP_GATE_ID, 'hermeticRoundTripClean', 'oneCodeInjectedIntoDouble', 'inputFault', (subject) => ({ ...subject, doubleFaultName: 'oneCodeInjected' }));
	registerRoundTripTwin(ROUND_TRIP_GATE_ID, 'canonicalizerIsNotTheParser', 'canonicalizerRequiresTheParser', 'productionMutation', (subject) => addMutation(subject, 'roundTripMutationList', { modulePath: ROUND_TRIP_PAIR_PATH, find: "const sax = require('sax');", replace: "const sax = require('sax');\nconst forgeTreeReader = require('./xsdTree');" }));
	registerRoundTripTwin(ROUND_TRIP_GATE_ID, 'nestedChoiceRebuilt', 'nestedChoiceFlattenedToSequence', 'productionMutation', (subject) => addMutation(subject, 'roundTripMutationList', { modulePath: ROUND_TRIP_PAIR_PATH, find: '						return compositorText({ shape: oneParticle, ownerStableId });', replace: "						return compositorText({ shape: { ...oneParticle, compositor: 'sequence' }, ownerStableId });" }));
	registerRoundTripTwin(ROUND_TRIP_GATE_ID, 'rulingLossesRegenerated', 'formDroppedByWalk', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: '					formAsWritten: oneElement.formAsWritten,', replace: '					formAsWritten: null,' }));
	registerRoundTripTwin(ROUND_TRIP_GATE_ID, 'rulingLossesRegenerated', 'emptyValueFlagDroppedByWalk', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: "valueIsEmptyString: oneValue.value === '' ? true : null,", replace: 'valueIsEmptyString: null,' }));
	registerRoundTripTwin(ROUND_TRIP_GATE_ID, 'rulingLossesRegenerated', 'codeDocumentationListDroppedByWalk', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: WALK_PATH, find: 'documentationValueList: oneValue.documentationValues, codePosition }', replace: 'codePosition }' }));
	registerRoundTripTwin(ROUND_TRIP_GATE_ID, 'untaughtAttributeRefusedByCensus', 'attributeCensusDisabled', 'productionMutation', (subject) => addMutation(subject, 'hooksMutationList', { modulePath: XSD_PARSER_PATH, find: '			if (untaughtAttribute !== null) {', replace: '			if (false) {' }));

	// ---- F12-REGENERATED-COMPILE
	const COMPILE_GATE_ID = 'F12-REGENERATED-COMPILE';
	const xmllintExitOf = ({ schemaDirPath }, onExit) => {
		fs.writeFileSync(path.join(schemaDirPath, XMLLINT_PROBE_FILE_NAME), XMLLINT_PROBE_TEXT);
		childProcess.execFile('xmllint', ['--nonet', '--noout', '--schema', rootFileName, XMLLINT_PROBE_FILE_NAME], { cwd: schemaDirPath }, (execError, stdoutText, stderrText) => {
			onExit({ exitCode: execError ? execError.code : 0, stderrText: String(stderrText).trim() });
		});
	};
	const compileConjunctList = [
		{
			conjunctId: 'regeneratedRootCompiles',
			title: "the files regenerated from the graph double compile: xmllint --nonet --schema <root> over a probe document exits 3 ('fails to validate', the schema compiled), as the source folder does",
			twinNameList: ['oneDefinitionDroppedFromRegeneration'],
			evaluate: (subject, callback) => {
				if (roundTripLiteralSet === undefined) {
					callback('', missingRoundTripLiteralResult());
					return;
				}
				forgeOrFail({ subject }, callback, (forged) => {
					const pair = roundTripPairOf(subject).makeRoundTripPair({ labelPrefix: releaseDeclarationData.labelPrefix });
					pair.regenerateFromGraph({ reader: doubleOf({ subject, forged }) }, (regenerateError, regenerated) => {
						if (regenerateError || regenerated.fault !== undefined) {
							callback('', { pass: false, detail: `regeneration: ${regenerateError || regenerated.fault}` });
							return;
						}
						const regeneratedDirPath = makeScratchRoot(`${standardKey}Regenerated-`);
						Object.keys(regenerated.fileTextByName).forEach((oneFileName) => {
							const fileText = regenerated.fileTextByName[oneFileName];
							const droppedStart = subject.dropRegeneratedDefinition ? fileText.indexOf(DROPPED_DEFINITION_OPEN_TEXT) : -1;
							fs.writeFileSync(path.join(regeneratedDirPath, oneFileName), droppedStart === -1 ? fileText : fileText.slice(0, droppedStart) + fileText.slice(fileText.indexOf('</xs:simpleType>', droppedStart) + '</xs:simpleType>'.length));
						});
						const sourceCopyDirPath = makeScratchRoot(`${standardKey}SourceCopy-`);
						xsdFileNameList.forEach((oneFileName) => fs.copyFileSync(path.join(subject.snapshotDirPath, oneFileName), path.join(sourceCopyDirPath, oneFileName)));
						xmllintExitOf({ schemaDirPath: regeneratedDirPath }, (regeneratedResult) => {
							xmllintExitOf({ schemaDirPath: sourceCopyDirPath }, (sourceResult) => {
								const pass = regeneratedResult.exitCode === roundTripLiteralSet.xmllintProbeExitCode && sourceResult.exitCode === roundTripLiteralSet.xmllintProbeExitCode;
								callback('', { pass, detail: `regenerated exit ${regeneratedResult.exitCode} (${regeneratedResult.stderrText.split('\n').slice(-1)[0].slice(0, 160)}); source exit ${sourceResult.exitCode}; literal ${roundTripLiteralSet.xmllintProbeExitCode}` });
							});
						});
					});
				});
			},
		},
	];
	registerRoundTripTwin(COMPILE_GATE_ID, 'regeneratedRootCompiles', 'oneDefinitionDroppedFromRegeneration', 'inputFault', (subject) => ({ ...subject, dropRegeneratedDefinition: true }));
	// ---- F12 (phase F6, NOTES-supervisor item 13): a namespaced schema attribute (ePortfolio's vc:minVersion)
	// is regenerated with its prefix bound, so every regenerated file is namespace-well-formed
	const sax = require('sax');
	const NAMESPACED_SCHEMA_ATTRIBUTE_NAME_RE = /^\{[^}]+\}.+$/;
	const UNBOUND_PROBE_ATTRIBUTE_NAME = 'zz:unboundProbe';
	const namespaceErrorListOf = (fileText) => {
		const errorList = [];
		const strictParser = sax.parser(true, { xmlns: true });
		strictParser.onerror = (parseError) => {
			errorList.push(parseError.message.split('\n')[0]);
			strictParser.resume();
		};
		strictParser.write(fileText).close();
		return errorList;
	};
	compileConjunctList.push({
		conjunctId: 'regeneratedFilesNamespaceWellFormed',
		title: "every file regenerated from the graph double parses as namespace-well-formed XML (sax, strict, xmlns): every prefix it writes is bound, a namespaced schema attribute's included; the count of namespaced schema attributes EQUALS the literal",
		twinNameList: ['unboundSchemaAttributeInDouble'],
		evaluate: (subject, callback) => {
			if (roundTripLiteralSet === undefined || roundTripLiteralSet.namespacedSchemaAttributeCount === undefined) {
				callback('', { pass: false, detail: `expectedReleaseLiterals.json has no roundTrip.namespacedSchemaAttributeCount for ${releaseName}` });
				return;
			}
			forgeOrFail({ subject }, callback, (forged) => {
				const doubledForged = subject.unboundSchemaAttribute ? { nodes: forged.nodes.map((oneNode, nodeIndex) => (nodeIndex === forged.nodes.findIndex((candidateNode) => labelSuffixOf(candidateNode) === 'SchemaFile') ? { ...oneNode, properties: { ...oneNode.properties, schemaAttributeList: JSON.stringify({ ...JSON.parse(oneNode.properties.schemaAttributeList || '{}'), [UNBOUND_PROBE_ATTRIBUTE_NAME]: 'probe' }) } } : oneNode)), edges: forged.edges } : forged;
				const namespacedCount = forged.nodes.filter((oneNode) => labelSuffixOf(oneNode) === 'SchemaFile').reduce((soFar, oneNode) => soFar + Object.keys(JSON.parse(oneNode.properties.schemaAttributeList || '{}')).filter((oneName) => NAMESPACED_SCHEMA_ATTRIBUTE_NAME_RE.test(oneName)).length, 0);
				roundTripPairOf(subject).makeRoundTripPair({ labelPrefix: releaseDeclarationData.labelPrefix }).regenerateFromGraph({ reader: roundTripHarnessLib.graphDoubleFrom({ forgeResult: doubledForged }) }, (regenerateError, regenerated) => {
					if (regenerateError || regenerated.fault !== undefined) {
						callback('', { pass: false, detail: `regeneration: ${regenerateError || regenerated.fault}` });
						return;
					}
					const errorTextList = [];
					Object.keys(regenerated.fileTextByName).sort().forEach((oneFileName) => namespaceErrorListOf(regenerated.fileTextByName[oneFileName]).forEach((oneError) => errorTextList.push(`${oneFileName}: ${oneError}`)));
					callback('', { pass: errorTextList.length === 0 && namespacedCount === roundTripLiteralSet.namespacedSchemaAttributeCount, detail: `${Object.keys(regenerated.fileTextByName).length} files; namespaced schema attributes ${namespacedCount} (literal ${roundTripLiteralSet.namespacedSchemaAttributeCount}); namespace errors ${errorTextList.length ? errorTextList.slice(0, 2).join(' | ') : 'none'}` });
				});
			});
		},
	});
	registerRoundTripTwin(COMPILE_GATE_ID, 'regeneratedFilesNamespaceWellFormed', 'unboundSchemaAttributeInDouble', 'inputFault', (subject) => ({ ...subject, unboundSchemaAttribute: true }));

	// ---- F20-DERIVED-OUT
	const DERIVED_GATE_ID = 'F20-DERIVED-OUT';
	const RULED_DERIVED_SUFFIX_LIST = ['Root', 'Release', 'Occurrence', 'EmbedText'];
	const derivedConjunctList = [
		{
			conjunctId: 'derivedStructureNeverEmitted',
			title: "the pair's disposition table names Root, Release, Occurrence and EmbedText as derived structure, and the emitter reads none of them: the statements from the double EQUAL those from the double with every derived node (and its edges) removed",
			twinNameList: ['statementEmittedFromOccurrence'],
			evaluate: (subject, callback) => {
				forgeOrFail({ subject }, callback, (forged) => {
					const pairModule = roundTripPairOf(subject);
					const pair = pairModule.makeRoundTripPair({ labelPrefix: releaseDeclarationData.labelPrefix });
					const derivedSuffixList = Object.keys(pairModule.GRAPH_LABEL_SUFFIX_DISPOSITION_TABLE).filter((oneSuffix) => pairModule.GRAPH_LABEL_SUFFIX_DISPOSITION_TABLE[oneSuffix] === pairModule.NODE_DISPOSITION.DERIVED_STRUCTURE).sort();
					const derivedStableIdSet = new Set(forged.nodes.filter((oneNode) => derivedSuffixList.indexOf(labelSuffixOf(oneNode)) !== -1 || oneNode.labels.indexOf(subject.forgeDeclaration.rootLabel) !== -1).map((oneNode) => oneNode.stableId));
					const strippedForged = { nodes: forged.nodes.filter((oneNode) => !derivedStableIdSet.has(oneNode.stableId)), edges: forged.edges.filter((oneEdge) => !derivedStableIdSet.has(oneEdge.fromRef.id) && !derivedStableIdSet.has(oneEdge.toRef.id)) };
					const statementText = (statements) => JSON.stringify([...statements.entries()].sort((left, right) => compareText(left[0], right[0])));
					pair.emitFromGraph({ reader: roundTripHarnessLib.graphDoubleFrom({ forgeResult: forged }) }, (fullError, fullSide) => {
						pair.emitFromGraph({ reader: roundTripHarnessLib.graphDoubleFrom({ forgeResult: strippedForged }) }, (strippedError, strippedSide) => {
							if (fullError || strippedError || fullSide.fault !== undefined || strippedSide.fault !== undefined) {
								callback('', { pass: false, detail: `emitFromGraph: ${fullError || strippedError || fullSide.fault || strippedSide.fault}` });
								return;
							}
							const identical = statementText(fullSide.statements) === statementText(strippedSide.statements);
							const tableHolds = JSON.stringify(derivedSuffixList) === JSON.stringify(RULED_DERIVED_SUFFIX_LIST.slice().sort());
							callback('', { pass: identical && tableHolds, detail: `derived kinds ${derivedSuffixList.join(', ')}; ${derivedStableIdSet.size} derived nodes removed; statements full ${fullSide.statements.size}, stripped ${strippedSide.statements.size}, identical ${identical}` });
						});
					});
				});
			},
		},
	];
	registerRoundTripTwin(DERIVED_GATE_ID, 'derivedStructureNeverEmitted', 'statementEmittedFromOccurrence', 'productionMutation', (subject) =>
		addMutation(subject, 'roundTripMutationList', {
			modulePath: ROUND_TRIP_PAIR_PATH,
			find: '		placedList.sort((left, right) => left.documentPosition - right.documentPosition);',
			replace: "		const derivedOccurrenceNode = schemaFileNode.properties.layer === 'message' ? nodes.find((oneNode) => oneNode.labels.indexOf(`${labelPrefix}Occurrence`) !== -1) : undefined;\n		if (derivedOccurrenceNode !== undefined) { placedList.push({ documentPosition: 1e9, placedText: `<xs:element name=\"${derivedOccurrenceNode.properties.name}FromOccurrence\"/>` }); }\n		placedList.sort((left, right) => left.documentPosition - right.documentPosition);",
		}),
	);

	const roundTripGateDeclarationList = [
		{ gateId: ROUND_TRIP_GATE_ID, title: 'F11 round trip, hermetic: the graph gives the files back (and the ruling\'s closed losses and attribute census)', conjunctList: roundTripConjunctList },
		{ gateId: COMPILE_GATE_ID, title: 'F12 the regenerated files compile', conjunctList: compileConjunctList },
		{ gateId: DERIVED_GATE_ID, title: 'F20 derived structure out of the round trip', conjunctList: derivedConjunctList },
	];
	const makeRoundTripSubject = () => ({ ...makeSubject(), roundTripMutationList: [], doubleFaultName: null, dropRegeneratedDefinition: false, unboundSchemaAttribute: false });
	const cloneRoundTripSubject = (subject) => ({ ...cloneSubject(subject), roundTripMutationList: subject.roundTripMutationList.slice() });

	const makeReachabilitySubject = () => ({ ...makeSubject(), scopeToolMutationList: [] });
	const cloneReachabilitySubject = (subject) => ({ ...cloneSubject(subject), scopeToolMutationList: subject.scopeToolMutationList.slice() });


	runGateFamily(
		{ harness, familyName: `${standardKey} release gates (phase F1)`, gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 17, expectedTwinCount: 17 },
		() => {
			runGateFamily(
				{ harness, familyName: `${standardKey} walk gates (phase F2)`, gateDeclarationList: walkGateDeclarationList, twinRegistry: walkTwinRegistry, makeSubject: makeWalkSubject, cloneSubject, expectedConjunctCount: 16, expectedTwinCount: 19 },
				() => {
					runGateFamily(
						{ harness, familyName: `${standardKey} reachability gates (phase F3)`, gateDeclarationList: reachabilityGateDeclarationList, twinRegistry: reachabilityTwinRegistry, makeSubject: makeReachabilitySubject, cloneSubject: cloneReachabilitySubject, expectedConjunctCount: 12, expectedTwinCount: 14 },
						() => {
							runGateFamily(
								{ harness, familyName: `${standardKey} round-trip gates (phase F4)`, gateDeclarationList: roundTripGateDeclarationList, twinRegistry: roundTripTwinRegistry, makeSubject: makeRoundTripSubject, cloneSubject: cloneRoundTripSubject, expectedConjunctCount: 9, expectedTwinCount: 14 },
								() => {
									scratchRootPathList.forEach((oneScratchRootPath) => fs.rmSync(oneScratchRootPath, { recursive: true, force: true }));
									whenDone();
								},
							);
						},
					);
				},
			);
		},
	);
};

module.exports = { runReleaseGateSuite, RULED_ROLE_BY_LABEL_SUFFIX, moduleName };
