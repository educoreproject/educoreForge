#!/usr/bin/env node
'use strict';

// test-sif260928Skeleton.js — the phase A1a gates for the sif260928 forge skeleton
// (PLAN-sifReplacement-smallPhases-092826.md §3 A1a). ALL PURE: skipEmbedding true, no Docker, no
// network. Every conjunct runs on the real bundle and the real snapshot, and every conjunct is
// observed RED under its own twin before the family counts as green. The framework's gate engine
// does the sweep (roundTripHarness/gateEvaluator via testSupport/gateSuiteRunner).
//
//   A1a-VERSION   (a) the snapshot stamps 4.3 from standardSourceLocation; with the line gone the
//                     forge's OWN guard refuses by name (the framework alone would only warn)
//   A1a-UNIQUE    (b) G-UNIQUE and G-SOURCE hold with SIF and SIF260928 both present
//   A1a-CHECKSUM  (c) the TSV verifies against SHA256SUMS; one altered byte is refused (restated in A4:
//                     the RefId map is the snapshot's second declared input, verified the same way,
//                     and the root names both files)
//   A1a-ROLES     (d) the role table and nonEmbeddableRoleList equal the ruling; the declaration,
//                     with no allowances, is accepted by the framework
//   A1a-VALIDATOR     the declared round-trip validator is a stub that refuses by name until A6
//
// Twins build SCRATCH snapshots and scratch forges directories under the OS temp directory and
// remove them at the end. Nothing in the tree is written. Bundle mutations are compiled in memory
// (moduleDouble), never written to disk.
//
// Run: PATH=/usr/local/bin:$PATH node forges/sif260928/test/test-sif260928Skeleton.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase A1a gates: version guard, G-UNIQUE/G-SOURCE, checksum, role table, validator stub

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const BUNDLE_DIR = path.join(__dirname, '..');
const TREE_ROOT = path.join(BUNDLE_DIR, '..', '..');
const FORGE_FRAMEWORK_DIR = path.join(TREE_ROOT, 'lib', 'forge-framework');
const REAL_FORGES_DIR = path.join(TREE_ROOT, 'forges');
const ENTRY_MODULE_PATH = path.join(BUNDLE_DIR, 'forgeSif260928.js');
const VERSION_GUARD_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928VersionGuard.js');
const VALIDATOR_MODULE_PATH = path.join(BUNDLE_DIR, 'roundTripValidator.js');
const ROSTER_MODULE_PATH = path.join(FORGE_FRAMEWORK_DIR, 'roster.js');
const DESCRIPTOR_PATH = path.join(BUNDLE_DIR, 'parserDescriptor.ini');
const PROVENANCE_FILE_NAME = 'standardSourceLocation';

const { runGateFamily } = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'gateSuiteRunner'));
const moduleDouble = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'moduleDouble'));
const { makeTwinRegistry } = require(path.join(FORGE_FRAMEWORK_DIR, 'roundTripHarness', 'twinRegistry'));
const forgeDeclarationContract = require(path.join(FORGE_FRAMEWORK_DIR, 'forgeDeclarationContract'));
const { MIGRATING_BUNDLE_LIST } = require(path.join(FORGE_FRAMEWORK_DIR, 'migrationAllowanceRegistry'));
const rosterLib = require(ROSTER_MODULE_PATH);
const { DME_ROLES } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));
const sif260928ForgeDeclaration = require(path.join(BUNDLE_DIR, 'lib', 'sif260928ForgeDeclaration'));
const sif260928NodeKindTable = require(path.join(BUNDLE_DIR, 'lib', 'sif260928NodeKindTable'));

// the descriptor is the one place the snapshot and its source file are named
const descriptorValueByName = rosterLib.readDescriptorSection(DESCRIPTOR_PATH).valueByName;
const SOURCE_FILE_NAME = descriptorValueByName.sourceFile;
// PLAN §3 A4: the snapshot's second input, declared in additionalSourceInputList
const REF_ID_MAP_FILE_NAME = 'refIdResolutionMap.tsv';
const REAL_SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', descriptorValueByName.defaultSnapshot);

// ---- FROZEN LITERALS: the rulings these gates hold the code to. Never edited to match a measurement.
const RULED_PUBLISHED_VERSION = '4.3';
const RULED_NODE_KIND_TABLE = {
	object: { perStandardLabel: 'Sif260928Object', role: 'DmeClass' },
	question: { perStandardLabel: 'Sif260928Question', role: 'DmeProperty' },
	field: { perStandardLabel: 'Sif260928Field', role: 'DmeSupport' },
	container: { perStandardLabel: 'Sif260928Container', role: 'DmeSupport' },
	codeset: { perStandardLabel: 'Sif260928Codeset', role: 'DmeOptionSet' },
	codesetValue: { perStandardLabel: 'Sif260928CodesetValue', role: 'DmeOptionValue' },
};
const RULED_NON_EMBEDDABLE_ROLE_LIST = ['DmeSupport', 'DmeOptionSet', 'DmeOptionValue'];

// ---- scratch fixtures, all removed at the end
const scratchRootPathList = [];
const makeScratchRoot = (prefix) => {
	const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	scratchRootPathList.push(scratchRootPath);
	return scratchRootPath;
};

// a copy of the real snapshot inside a standardSourceData/ container, so the version stamp still
// finds its snapshot directory and provenance file; alterFileByName edits the copy only
const makeScratchSnapshot = ({ alterFileByName }) => {
	const snapshotDirPath = path.join(makeScratchRoot('sif260928Snapshot-'), 'standardSourceData', path.basename(REAL_SNAPSHOT_DIR));
	fs.mkdirSync(snapshotDirPath, { recursive: true });
	fs.readdirSync(REAL_SNAPSHOT_DIR).forEach((oneFileName) => {
		fs.copyFileSync(path.join(REAL_SNAPSHOT_DIR, oneFileName), path.join(snapshotDirPath, oneFileName));
	});
	Object.keys(alterFileByName).forEach((oneFileName) => {
		const filePath = path.join(snapshotDirPath, oneFileName);
		fs.writeFileSync(filePath, alterFileByName[oneFileName](fs.readFileSync(filePath)));
	});
	return snapshotDirPath;
};

const withoutPublishedVersionLine = (fileBuffer) => {
	const alteredText = fileBuffer.toString('utf8').replace(/^publishedVersion:.*\n/m, '');
	if (alteredText === fileBuffer.toString('utf8')) {
		throw new Error(`${moduleName}: fixture fault — no publishedVersion line to remove`);
	}
	return alteredText;
};

// flips the case of a file's first letter (the TSV's first table heading; the map's header)
const withOneByteAltered = (fileBuffer) => {
	const alteredBuffer = Buffer.from(fileBuffer);
	alteredBuffer[0] = alteredBuffer[0] ^ 0x20;
	return alteredBuffer;
};

// a scratch forges/ dir holding ONLY each bundle's descriptor (the roster reads nothing else)
const makeScratchForgesDir = ({ descriptorTextByBundleDirName }) => {
	const scratchForgesDirPath = makeScratchRoot('sif260928Forges-');
	fs.readdirSync(REAL_FORGES_DIR, { withFileTypes: true })
		.filter((oneEntry) => oneEntry.isDirectory() && fs.existsSync(path.join(REAL_FORGES_DIR, oneEntry.name, rosterLib.DESCRIPTOR_FILE_NAME)))
		.forEach((oneEntry) => {
			fs.mkdirSync(path.join(scratchForgesDirPath, oneEntry.name));
			const descriptorText = descriptorTextByBundleDirName[oneEntry.name] !== undefined
				? descriptorTextByBundleDirName[oneEntry.name]
				: fs.readFileSync(path.join(REAL_FORGES_DIR, oneEntry.name, rosterLib.DESCRIPTOR_FILE_NAME), 'utf8');
			fs.writeFileSync(path.join(scratchForgesDirPath, oneEntry.name, rosterLib.DESCRIPTOR_FILE_NAME), descriptorText);
		});
	return scratchForgesDirPath;
};

const descriptorTextSayingSif = () => {
	const descriptorText = fs.readFileSync(DESCRIPTOR_PATH, 'utf8');
	const alteredText = descriptorText.replace(/^standardName=SIF260928$/m, 'standardName=SIF');
	if (alteredText === descriptorText) {
		throw new Error(`${moduleName}: fixture fault — no 'standardName=SIF260928' line to rewrite`);
	}
	return alteredText;
};

// ---- the subject every conjunct reads and every twin mutates (on a clone)
const makeSubject = () => ({
	snapshotDirPath: REAL_SNAPSHOT_DIR,
	forgesDirPath: REAL_FORGES_DIR,
	descriptorText: fs.readFileSync(DESCRIPTOR_PATH, 'utf8'),
	forgeDeclaration: sif260928ForgeDeclaration,
	nodeKindTable: sif260928NodeKindTable,
	bundleMutationList: [],
	rosterMutationList: [],
	validatorMutationList: [],
});
const cloneSubject = (subject) => ({
	...subject,
	bundleMutationList: subject.bundleMutationList.slice(),
	rosterMutationList: subject.rosterMutationList.slice(),
	validatorMutationList: subject.validatorMutationList.slice(),
});

// the bundle as the forger loads it, or compiled in memory with the subject's mutations
const loadBundle = (subject) => {
	const bundleFactory = subject.bundleMutationList.length
		? moduleDouble.loadWithMutations({ modulePath: ENTRY_MODULE_PATH, mutationList: subject.bundleMutationList })
		: require(ENTRY_MODULE_PATH);
	return bundleFactory({ embedder: null });
};

// forge the subject's snapshot exactly as the forger does: sourcePath is <snapshot>/<sourceFile>
const forgeSnapshot = ({ subject, snapshotDirPath }, callback) => {
	loadBundle(subject).forge({ sourcePath: path.join(snapshotDirPath, SOURCE_FILE_NAME), owner: 'test', skipEmbedding: true }, callback);
};

const twinRegistry = makeTwinRegistry();
const VERSION_GATE_ID = 'A1a-VERSION';
const UNIQUE_GATE_ID = 'A1a-UNIQUE';
const CHECKSUM_GATE_ID = 'A1a-CHECKSUM';
const ROLES_GATE_ID = 'A1a-ROLES';
const VALIDATOR_GATE_ID = 'A1a-VALIDATOR';

// =====================================================================
// (a) A1a-VERSION
// =====================================================================
const VERSION_GUARD_REFUSAL_RE = /sif260928VersionGuard REFUSED: forge-sif260928 version guard: versionSource is 'unknown'/;
const versionConjunctList = [
	{
		conjunctId: 'snapshotStampsRuledVersion',
		title: `the snapshot forges, stamped publishedVersion '${RULED_PUBLISHED_VERSION}' from standardSourceLocation (versionSource 'provenance-file'), and the root carries that version`,
		twinNameList: ['publishedVersionLineRemoved'],
		evaluate: (subject, callback) => {
			forgeSnapshot({ subject, snapshotDirPath: subject.snapshotDirPath }, (forgeError, forged) => {
				if (forgeError) {
					callback('', { pass: false, detail: `forge refused: ${forgeError}` });
					return;
				}
				const rootNode = forged.nodes.find((oneNode) => oneNode.role === DME_ROLES.STANDARD_ROOT);
				const pass =
					forged.metadata.publishedVersion === RULED_PUBLISHED_VERSION &&
					forged.metadata.versionSource === 'provenance-file' &&
					rootNode.properties.version === RULED_PUBLISHED_VERSION &&
					rootNode.properties.publishedVersion === RULED_PUBLISHED_VERSION;
				callback('', { pass, detail: `publishedVersion ${forged.metadata.publishedVersion}, versionSource ${forged.metadata.versionSource}, root version ${rootNode.properties.version}` });
			});
		},
	},
	{
		conjunctId: 'unknownVersionRefusedByTheForgeGuard',
		title: 'a scratch snapshot whose standardSourceLocation has no publishedVersion line is REFUSED BY NAME by the sif260928 version guard',
		twinNameList: ['versionGuardDisabled'],
		evaluate: (subject, callback) => {
			const scratchSnapshotDirPath = makeScratchSnapshot({ alterFileByName: { [PROVENANCE_FILE_NAME]: withoutPublishedVersionLine } });
			forgeSnapshot({ subject, snapshotDirPath: scratchSnapshotDirPath }, (forgeError, forged) => {
				const pass = typeof forgeError === 'string' && VERSION_GUARD_REFUSAL_RE.test(forgeError);
				callback('', { pass, detail: forgeError ? forgeError.slice(0, 300) : `NOT refused: forged ${forged.nodes.length} nodes at version '${forged.metadata.version}'` });
			});
		},
	},
];
twinRegistry.register({
	gateId: VERSION_GATE_ID,
	conjunctId: 'snapshotStampsRuledVersion',
	twinName: 'publishedVersionLineRemoved',
	leverKind: 'inputFault',
	shippedConfig: true,
	run: (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ alterFileByName: { [PROVENANCE_FILE_NAME]: withoutPublishedVersionLine } }) }),
});
twinRegistry.register({
	gateId: VERSION_GATE_ID,
	conjunctId: 'unknownVersionRefusedByTheForgeGuard',
	twinName: 'versionGuardDisabled',
	leverKind: 'productionMutation',
	shippedConfig: true,
	run: (subject) => {
		const versionGuardMutation = { modulePath: VERSION_GUARD_MODULE_PATH, find: "const REFUSED_VERSION_SOURCE_LIST = Object.freeze(['unknown']);", replace: 'const REFUSED_VERSION_SOURCE_LIST = Object.freeze([]);' };
		moduleDouble.assertMutationApplies(versionGuardMutation);
		subject.bundleMutationList.push(versionGuardMutation);
		return subject;
	},
});

// =====================================================================
// (b) A1a-UNIQUE — G-UNIQUE and G-SOURCE with SIF and SIF260928 both present
// =====================================================================
const DUPLICATE_SIF_REFUSAL_RE = /standardName 'SIF' is declared by TWO bundle directories: 'sif' and 'sif260928'/;
const uniqueConjunctList = [
	{
		conjunctId: 'forgesUniqueWithSifAndSif260928',
		title: "roster.assertUniqueStandardNames over the forges/ dir returns null, and that dir carries BOTH 'SIF' (sif) and 'SIF260928' (sif260928)",
		twinNameList: ['sif260928DescriptorSaysSif'],
		evaluate: (subject, callback) => {
			const verdict = rosterLib.assertUniqueStandardNames({ forgesDirPath: subject.forgesDirPath });
			const standardNameOf = (bundleDirName) => rosterLib.readDescriptorSection(path.join(subject.forgesDirPath, bundleDirName, rosterLib.DESCRIPTOR_FILE_NAME)).valueByName.standardName;
			const pass = verdict === null && standardNameOf('sif') === 'SIF' && standardNameOf('sif260928') === 'SIF260928';
			callback('', { pass, detail: verdict === null ? `unique; sif='${standardNameOf('sif')}', sif260928='${standardNameOf('sif260928')}'` : verdict.message.slice(0, 300) });
		},
	},
	{
		conjunctId: 'sharedSifNameRefusedNamingBoth',
		title: "a sif260928 descriptor saying standardName=SIF is refused by G-UNIQUE NAMING BOTH 'sif' and 'sif260928'",
		twinNameList: ['rosterDuplicateRefusalDisabled'],
		evaluate: (subject, callback) => {
			const rosterModule = subject.rosterMutationList.length ? moduleDouble.loadWithMutations({ modulePath: ROSTER_MODULE_PATH, mutationList: subject.rosterMutationList }) : rosterLib;
			const verdict = rosterModule.assertUniqueStandardNames({ forgesDirPath: makeScratchForgesDir({ descriptorTextByBundleDirName: { sif260928: descriptorTextSayingSif() } }) });
			const pass = verdict !== null && DUPLICATE_SIF_REFUSAL_RE.test(verdict.message);
			callback('', { pass, detail: verdict === null ? 'NOT refused' : verdict.message.slice(0, 300) });
		},
	},
	{
		conjunctId: 'sourceEqualsDescriptorAndEveryNode',
		title: "G-SOURCE: declaration.standardSource EQUALS the descriptor's standardName, and every forged node's _source equals it",
		twinNameList: ['descriptorSaysSif'],
		evaluate: (subject, callback) => {
			const scratchDescriptorPath = path.join(makeScratchRoot('sif260928Descriptor-'), rosterLib.DESCRIPTOR_FILE_NAME);
			fs.writeFileSync(scratchDescriptorPath, subject.descriptorText);
			const descriptorStandardName = rosterLib.readDescriptorSection(scratchDescriptorPath).valueByName.standardName;
			forgeSnapshot({ subject, snapshotDirPath: subject.snapshotDirPath }, (forgeError, forged) => {
				if (forgeError) {
					callback('', { pass: false, detail: `forge refused: ${forgeError}` });
					return;
				}
				const offendingNode = forged.nodes.find((oneNode) => oneNode.properties._source !== descriptorStandardName);
				const pass = descriptorStandardName === subject.forgeDeclaration.standardSource && offendingNode === undefined;
				callback('', { pass, detail: `descriptor '${descriptorStandardName}', declaration '${subject.forgeDeclaration.standardSource}', ${offendingNode ? `node '${offendingNode.stableId}' _source '${offendingNode.properties._source}'` : `all ${forged.nodes.length} nodes match`}` });
			});
		},
	},
];
twinRegistry.register({
	gateId: UNIQUE_GATE_ID,
	conjunctId: 'forgesUniqueWithSifAndSif260928',
	twinName: 'sif260928DescriptorSaysSif',
	leverKind: 'inputFault',
	shippedConfig: true,
	run: (subject) => ({ ...subject, forgesDirPath: makeScratchForgesDir({ descriptorTextByBundleDirName: { sif260928: descriptorTextSayingSif() } }) }),
});
twinRegistry.register({
	gateId: UNIQUE_GATE_ID,
	conjunctId: 'sharedSifNameRefusedNamingBoth',
	twinName: 'rosterDuplicateRefusalDisabled',
	leverKind: 'productionMutation',
	shippedConfig: true,
	run: (subject) => {
		const rosterMutation = { modulePath: ROSTER_MODULE_PATH, find: '\t\tif (bundleDirNameByStandardName[standardName] !== undefined) {', replace: '\t\tif (bundleDirNameByStandardName[standardName] !== undefined && false) {' };
		moduleDouble.assertMutationApplies(rosterMutation);
		subject.rosterMutationList.push(rosterMutation);
		return subject;
	},
});
twinRegistry.register({
	gateId: UNIQUE_GATE_ID,
	conjunctId: 'sourceEqualsDescriptorAndEveryNode',
	twinName: 'descriptorSaysSif',
	leverKind: 'inputFault',
	shippedConfig: true,
	run: (subject) => ({ ...subject, descriptorText: descriptorTextSayingSif() }),
});

// =====================================================================
// (c) A1a-CHECKSUM
// =====================================================================
const checksumConjunctList = [
	{
		conjunctId: 'sourceFilesVerifyAgainstSha256sums',
		title: `the framework verifies ${SOURCE_FILE_NAME} and ${REF_ID_MAP_FILE_NAME} against the snapshot's SHA256SUMS, forges, and the root names exactly those two source files`,
		twinNameList: ['oneTsvByteAltered', 'oneMapByteAltered'],
		evaluate: (subject, callback) => {
			forgeSnapshot({ subject, snapshotDirPath: subject.snapshotDirPath }, (forgeError, forged) => {
				if (forgeError) {
					callback('', { pass: false, detail: `forge refused: ${forgeError.slice(0, 300)}` });
					return;
				}
				const pass = JSON.stringify(forged.metadata.sourceFiles) === JSON.stringify([SOURCE_FILE_NAME, REF_ID_MAP_FILE_NAME]);
				callback('', { pass, detail: `sourceFiles ${JSON.stringify(forged.metadata.sourceFiles)}` });
			});
		},
	},
];
twinRegistry.register({
	gateId: CHECKSUM_GATE_ID,
	conjunctId: 'sourceFilesVerifyAgainstSha256sums',
	twinName: 'oneTsvByteAltered',
	leverKind: 'inputFault',
	shippedConfig: true,
	run: (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ alterFileByName: { [SOURCE_FILE_NAME]: withOneByteAltered } }) }),
});
twinRegistry.register({
	gateId: CHECKSUM_GATE_ID,
	conjunctId: 'sourceFilesVerifyAgainstSha256sums',
	twinName: 'oneMapByteAltered',
	leverKind: 'inputFault',
	shippedConfig: true,
	run: (subject) => ({ ...subject, snapshotDirPath: makeScratchSnapshot({ alterFileByName: { [REF_ID_MAP_FILE_NAME]: withOneByteAltered } }) }),
});

// =====================================================================
// (d) A1a-ROLES
// =====================================================================
const rolesConjunctList = [
	{
		conjunctId: 'nodeKindTableEqualsRuling',
		title: 'the role table EQUALS the ruling: Object DmeClass, Question DmeProperty, Field and Container DmeSupport, Codeset DmeOptionSet, CodesetValue DmeOptionValue, all labels Sif260928-prefixed',
		twinNameList: ['fieldAsDmeProperty'],
		evaluate: (subject, callback) => {
			const pass = JSON.stringify(subject.nodeKindTable) === JSON.stringify(RULED_NODE_KIND_TABLE);
			callback('', { pass, detail: JSON.stringify(subject.nodeKindTable) });
		},
	},
	{
		conjunctId: 'nonEmbeddableRoleListEqualsRuling',
		title: `nonEmbeddableRoleList EQUALS the ruling [${RULED_NON_EMBEDDABLE_ROLE_LIST.join(', ')}]`,
		twinNameList: ['questionRoleMadeNonEmbeddable'],
		evaluate: (subject, callback) => {
			const pass = JSON.stringify(subject.forgeDeclaration.nonEmbeddableRoleList) === JSON.stringify(RULED_NON_EMBEDDABLE_ROLE_LIST);
			callback('', { pass, detail: JSON.stringify(subject.forgeDeclaration.nonEmbeddableRoleList) });
		},
	},
	{
		conjunctId: 'declarationAcceptedWithNoAllowance',
		title: 'the framework accepts the declaration, whose compatibilityDeclarationList is [] (a new bundle may declare no migration allowance)',
		twinNameList: ['migrationAllowanceDeclared'],
		evaluate: (subject, callback) => {
			const declarationError = forgeDeclarationContract.validateForgeDeclaration({ forgeDeclaration: subject.forgeDeclaration, migratingBundleList: MIGRATING_BUNDLE_LIST });
			const pass = declarationError === null && subject.forgeDeclaration.compatibilityDeclarationList.length === 0;
			callback('', { pass, detail: declarationError ? declarationError.message.slice(0, 300) : `accepted; compatibilityDeclarationList ${JSON.stringify(subject.forgeDeclaration.compatibilityDeclarationList)}` });
		},
	},
];
twinRegistry.register({
	gateId: ROLES_GATE_ID,
	conjunctId: 'nodeKindTableEqualsRuling',
	twinName: 'fieldAsDmeProperty',
	leverKind: 'inputFault',
	shippedConfig: true,
	run: (subject) => ({ ...subject, nodeKindTable: { ...subject.nodeKindTable, field: { ...subject.nodeKindTable.field, role: DME_ROLES.PROPERTY } } }),
});
twinRegistry.register({
	gateId: ROLES_GATE_ID,
	conjunctId: 'nonEmbeddableRoleListEqualsRuling',
	twinName: 'questionRoleMadeNonEmbeddable',
	leverKind: 'inputFault',
	shippedConfig: true,
	run: (subject) => ({ ...subject, forgeDeclaration: { ...subject.forgeDeclaration, nonEmbeddableRoleList: subject.forgeDeclaration.nonEmbeddableRoleList.concat([DME_ROLES.PROPERTY]) } }),
});
twinRegistry.register({
	gateId: ROLES_GATE_ID,
	conjunctId: 'declarationAcceptedWithNoAllowance',
	twinName: 'migrationAllowanceDeclared',
	leverKind: 'inputFault',
	shippedConfig: true,
	run: (subject) => ({ ...subject, forgeDeclaration: { ...subject.forgeDeclaration, compatibilityDeclarationList: [{ allowanceId: 'S6' }] } }),
});

// =====================================================================
// A1a-VALIDATOR — the declared stub refuses by name
// =====================================================================
const VALIDATOR_REFUSAL_RE = /roundTripValidator REFUSED: forge-sif260928 round-trip validator is not built yet/;
const validatorConjunctList = [
	{
		conjunctId: 'stubValidatorRefusesByName',
		title: 'the declared roundTripValidator loads, exports validate, and REFUSES BY NAME when run',
		twinNameList: ['stubReturnsVerdict'],
		evaluate: (subject, callback) => {
			const validatorModule = subject.validatorMutationList.length ? moduleDouble.loadWithMutations({ modulePath: VALIDATOR_MODULE_PATH, mutationList: subject.validatorMutationList }) : require(VALIDATOR_MODULE_PATH);
			const declaredValidatorFileName = rosterLib.readDescriptorSection(DESCRIPTOR_PATH).valueByName.roundTripValidator;
			validatorModule.validate({ containerName: 'DEV_gb_notRun', snapshotPath: subject.snapshotDirPath }, (validateError, verdict) => {
				const pass = declaredValidatorFileName === path.basename(VALIDATOR_MODULE_PATH) && typeof validateError === 'string' && VALIDATOR_REFUSAL_RE.test(validateError);
				callback('', { pass, detail: validateError ? `declared '${declaredValidatorFileName}': ${validateError.slice(0, 200)}` : `NOT refused: verdict ${JSON.stringify(verdict)}` });
			});
		},
	},
];
twinRegistry.register({
	gateId: VALIDATOR_GATE_ID,
	conjunctId: 'stubValidatorRefusesByName',
	twinName: 'stubReturnsVerdict',
	leverKind: 'productionMutation',
	shippedConfig: true,
	run: (subject) => {
		const validatorMutation = {
			modulePath: VALIDATOR_MODULE_PATH,
			find: 'const validate = ({ containerName, boltUrl, user, password, snapshotPath, outputPath } = {}, callback) => {\n',
			replace: "const validate = ({ containerName, boltUrl, user, password, snapshotPath, outputPath } = {}, callback) => {\n\tcallback('', { roundTripClean: true, inventedTotal: 0, lostTotal: 0, contentGapTotal: 0, explicitlyOmittedTotal: 0 });\n\treturn;\n",
		};
		moduleDouble.assertMutationApplies(validatorMutation);
		subject.validatorMutationList.push(validatorMutation);
		return subject;
	},
});

const gateDeclarationList = [
	{ gateId: VERSION_GATE_ID, title: '(a) the version is 4.3, and an unknown version is refused by the forge itself', conjunctList: versionConjunctList },
	{ gateId: UNIQUE_GATE_ID, title: '(b) G-UNIQUE and G-SOURCE with SIF and SIF260928 both present', conjunctList: uniqueConjunctList },
	{ gateId: CHECKSUM_GATE_ID, title: '(c) the source-file checksums (the TSV and, since A4, the RefId map)', conjunctList: checksumConjunctList },
	{ gateId: ROLES_GATE_ID, title: '(d) the role table, nonEmbeddableRoleList, and no allowances', conjunctList: rolesConjunctList },
	{ gateId: VALIDATOR_GATE_ID, title: 'the round-trip validator is a refusing stub until A6', conjunctList: validatorConjunctList },
];

runGateFamily(
	{ harness, familyName: 'sif260928 A1a skeleton', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 10, expectedTwinCount: 11 },
	() => {
		scratchRootPathList.forEach((oneScratchRootPath) => fs.rmSync(oneScratchRootPath, { recursive: true, force: true }));
		harness.report();
	},
);
