#!/usr/bin/env node
'use strict';

// test-gChecksum.js — G-CHECKSUM (SPEC-forgeFramework-v1.md §10.1; §3.3; §6.1 step 2; FR8): before any
// loader runs, every file the loaders will consume is verified against SHA256SUMS; a caller-named file
// absent from the list → refused naming it; a listed file altered on disk → refused naming it and the
// recipe path; a file on disk the list does not name → IGNORED (the negative conjunct); SHA256SUMS
// absent → refused; a listed file missing on disk → refused; and the loader never runs when
// verification fails. Every alteration is made in a SCRATCH copy of the snapshot (os.tmpdir), never
// in the fixture.
//
// Run: node lib/forge-framework/test/test-gChecksum.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-CHECKSUM: consumed bytes verified against SHA256SUMS before any loader runs

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, refusalCase, shapedConjunct, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const sourceVerificationLib = require('../sourceVerification');

const GATE_ID = 'G-CHECKSUM';
const twinRegistry = makeTwinRegistry();
const VERIFY_FILE = 'sourceVerification.js';
const FRAMEWORK_FILE = 'forge-framework.js';

const alterOneByte = (scenario) => {
	const scratchDir = toyScenario.makeScratchSnapshotCopy();
	const modelPath = path.join(scratchDir, 'toyModel.json');
	const bytes = fs.readFileSync(modelPath);
	bytes[bytes.length - 3] = bytes[bytes.length - 3] ^ 0x01; // flip one bit near the end
	fs.writeFileSync(modelPath, bytes);
	scenario.sourceDirOverride = scratchDir;
	return scratchDir;
};

const conjunctList = [
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'alteredByteRefused',
		title: 'one altered byte in a listed file (scratch copy) is refused naming the file AND the recipe path',
		shape: (scenario) => { alterOneByte(scenario); },
		regex: /'toyModel.json' sha256 MISMATCH — SHA256SUMS says [0-9a-f]{64}, disk has [0-9a-f]{64} — .*README_PROVENANCE.md/,
		twinName: 'disableMismatchCheck', fileName: VERIFY_FILE,
		find: '\t\tif (actualSha256 !== expectedSha256) {', replace: '\t\tif (actualSha256 !== expectedSha256 && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'callerNamedUnlistedRefused',
		title: 'a caller-named file absent from SHA256SUMS is refused naming it (verifySnapshotChecksums with relativePathList)',
		shape: (scenario) => { scenario.directVerifyArgs = { snapshotDirPath: toyScenario.TOY_SNAPSHOT_DIR, relativePathList: ['toyModel.json', 'stray.txt'] }; },
		regex: /'stray.txt' is not listed in .*SHA256SUMS/,
		twinName: 'disableUnlistedCheck', fileName: VERIFY_FILE,
		find: '\t\tif (expectedSha256 === undefined) {', replace: '\t\tif (expectedSha256 === undefined && false) {',
	}),
	shapedConjunct({
		conjunctId: 'unlistedStrayIgnored',
		title: 'an UNLISTED stray file added to a scratch snapshot is IGNORED — the forge still succeeds (the negative conjunct)',
		twinNameList: ['refuseUnlistedOnDisk'],
		shape: (scenario) => { const scratchDir = toyScenario.makeScratchSnapshotCopy(); fs.writeFileSync(path.join(scratchDir, 'stray.txt'), 'not provenanced\n'); scenario.sourceDirOverride = scratchDir; },
		judge: succeeded((result) => ({ pass: result.nodes.length === 16, detail: `forged ${result.nodes.length} nodes with a stray file present` })),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'checksumFileAbsentRefused',
		title: 'an absent SHA256SUMS is refused naming its path',
		shape: (scenario) => { const scratchDir = toyScenario.makeScratchSnapshotCopy(); fs.unlinkSync(path.join(scratchDir, 'SHA256SUMS')); scenario.sourceDirOverride = scratchDir; },
		regex: /SHA256SUMS is absent at .*SHA256SUMS/,
		twinName: 'disableAbsentChecksumFileCheck', fileName: VERIFY_FILE,
		find: '\tif (!fs.existsSync(checksumFilePath)) {', replace: '\tif (!fs.existsSync(checksumFilePath) && false) {\n\t\t// (twin) fall through to an empty list\n\t}\n\tif (!fs.existsSync(checksumFilePath)) {\n\t\tcallback(\'\', { verifiedFileList: [] });\n\t\treturn;\n\t}\n\tif (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'listedFileMissingRefused',
		title: 'a listed file missing on disk is refused naming it',
		shape: (scenario) => { const scratchDir = toyScenario.makeScratchSnapshotCopy(); fs.unlinkSync(path.join(scratchDir, 'toyModel.json')); scenario.sourceDirOverride = scratchDir; },
		regex: /listed file 'toyModel.json' is missing on disk/,
		twinName: 'disableMissingFileCheck', fileName: VERIFY_FILE,
		find: '\t\tif (!fs.existsSync(absoluteFilePath)) {', replace: '\t\tif (!fs.existsSync(absoluteFilePath) && false) {\n\t\t\t// (twin)\n\t\t}\n\t\tif (!fs.existsSync(absoluteFilePath)) {\n\t\t\tverifiedFileList.push(oneRelativePath);\n\t\t\tcontinue;\n\t\t}\n\t\tif (false) {',
	}),
	shapedConjunct({
		conjunctId: 'loaderNeverRunsOnFailure',
		title: 'when verification fails the loader is NEVER called (a spy loader counts 0) and the run is refused',
		twinNameList: ['verificationNonFatal'],
		shape: (scenario) => {
			alterOneByte(scenario);
			scenario.loaderSpy = { callCount: 0 };
			const [baseLoader] = toyScenario.toyHooksFactory().sourceLoaderList;
			scenario.hookOverrides.sourceLoaderList = [{ loaderName: 'toyModel', load: (args, callback) => { scenario.loaderSpy.callCount += 1; baseLoader.load(args, callback); } }];
		},
		judge: (outcome, scenario) => {
			const refused = typeof outcome.forgeError === 'string' && /sha256 MISMATCH/.test(outcome.forgeError);
			return { pass: refused && scenario.loaderSpy.callCount === 0, detail: `refused: ${refused}; loader calls ${scenario.loaderSpy.callCount}` };
		},
	}),
];

// the caller-named conjunct verifies DIRECTLY through the surface export (a scenario field routes it)
conjunctList[1].evaluate = (scenario, callback) => {
	const outcome = toyScenario.injectOnly(scenario);
	if (outcome.injectionError) {
		callback('', { pass: false, detail: outcome.injectionError });
		return;
	}
	outcome.forgeFramework.provenance.verifySnapshotChecksums({ snapshotDirPath: toyScenario.TOY_SNAPSHOT_DIR, relativePathList: ['toyModel.json', 'stray.txt'] }, (verifyError, verified) => {
		if (!verifyError) {
			callback('', { pass: false, detail: `expected a refusal but verified ${JSON.stringify(verified)}` });
			return;
		}
		callback('', { pass: /'stray.txt' is not listed in .*SHA256SUMS/.test(verifyError), detail: verifyError.slice(0, 200) });
	});
};

frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'unlistedStrayIgnored', twinName: 'refuseUnlistedOnDisk', fileName: VERIFY_FILE,
	find: '\tconst verifiedFileList = [];', replace: "\tconst strayOnDisk = fs.readdirSync(snapshotDirPath).find((oneName) => ['SHA256SUMS', 'README_PROVENANCE.md', 'standardSourceLocation'].indexOf(oneName) === -1 && expectedByRelativePath[oneName] === undefined);\n\tif (strayOnDisk !== undefined) { callback(`${moduleName} REFUSED: unlisted file '${strayOnDisk}' on disk`); return; }\n\tconst verifiedFileList = [];" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'loaderNeverRunsOnFailure', twinName: 'verificationNonFatal', fileName: FRAMEWORK_FILE,
	find: '\t\t\t\t\t\tif (verifyError) {\n\t\t\t\t\t\t\tnext(`${forgePrefix} source verification: ${verifyError}`);\n\t\t\t\t\t\t\treturn;\n\t\t\t\t\t\t}', replace: "\t\t\t\t\t\tif (verifyError) {\n\t\t\t\t\t\t\tnext('', { ...args, verifiedFileList: [] });\n\t\t\t\t\t\t\treturn;\n\t\t\t\t\t\t}" });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'checksum verification before any loader', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: toyScenario.cloneScenario, expectedConjunctCount: 6, expectedTwinCount: 6 }, () => harness.report());
