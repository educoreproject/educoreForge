#!/usr/bin/env node
'use strict';

// test-gDet.js — G-DET and G-ENV (SPEC-forgeFramework-v1.md §10.1; Profile §5.3, §5.5): the pure layer
// is deterministic (two buildContractGraph runs over one parsed byte-identical after canonical sort;
// two forge() runs on ONE framework instance byte-identical — no per-build state); no clock/randomness
// in the framework tree or the fixture hooks (static grep); the same under LC_ALL=C and en_US.UTF-8
// in CHILD PROCESSES; the verified-file order follows SHA256SUMS, not the directory.
//
// The static-grep conjuncts read the framework's *.js and the fixture hook files from disk PLUS any
// `staticExtraSourceList` entries on the subject — the twin appends an in-memory hook text carrying
// Date.now() (a fixture hook with a clock) so the grep goes red without writing into the tree.
//
// G-ENV note (probed 2026-08-16): Node 24 on macOS resolves ICU's default locale to en-US whatever
// LC_ALL says, so the spec's suggested localeCompare twin does not vary here and is kept only as a
// demonstration line; the counting twin is a fixture hook that stamps process.env.LC_ALL into a name.
//
// Run: node lib/forge-framework/test/test-gDet.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-DET + G-ENV: determinism of the pure layer, no clock, locale independence

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, scenarioTwin, shapedConjunct, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const fingerprintLib = require('../fingerprint');
const sourceVerificationLib = require('../sourceVerification');

const DET_GATE_ID = 'G-DET';
const ENV_GATE_ID = 'G-ENV';
const twinRegistry = makeTwinRegistry();
const FRAMEWORK_FILE = 'forge-framework.js';
const CLOCK_RE = /Date\.now|new Date|Math\.random|process\.hrtime|crypto\.randomBytes/;
const LOCALE_RUNNER = path.join(__dirname, 'testSupport', 'runToyFingerprint.js');

// the framework's forge-time tree (flat *.js) and the fixture's hook files — the harness module is
// OUTSIDE this list by the §12.1 module boundary (its A8 census mandates wall-clock)
const staticSourceList = () => {
	const frameworkFileList = fs
		.readdirSync(toyScenario.FRAMEWORK_DIR)
		.filter((oneName) => /\.js$/.test(oneName))
		.map((oneName) => ({ fileName: `lib/forge-framework/${oneName}`, text: fs.readFileSync(path.join(toyScenario.FRAMEWORK_DIR, oneName), 'utf8') }));
	const hookFileList = ['lib/toyHooks.js', 'lib/toyRoundTripPair.js', 'lib/toyForgeDeclaration.js', 'forgeToy.js', 'roundTripValidator.js'].map((oneRelative) => ({
		fileName: `test/fixtures/toyForge/${oneRelative}`,
		text: fs.readFileSync(path.join(toyScenario.TOY_DIR, oneRelative), 'utf8'),
	}));
	return frameworkFileList.concat(hookFileList);
};

// stripComments — the grep is over CODE; a comment that names the forbidden call while explaining
// the rule (this file's own header, the SPEC's words in a module header) is not a call
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const runForgeTwice = (scenario, callback) => {
	toyScenario.runScenario(scenario, (firstError, firstOutcome) => {
		if (firstOutcome.forgeError || firstOutcome.injectionError || firstOutcome.thrownFromForge) {
			callback({ pass: false, detail: `first run: ${firstOutcome.forgeError || firstOutcome.injectionError || firstOutcome.thrownFromForge}` });
			return;
		}
		// the SAME bundle (one framework instance) forged again
		firstOutcome.bundle.forge(scenario.forgeArgs, (secondError, secondResult) => {
			if (secondError) {
				callback({ pass: false, detail: `second run on the same instance: ${secondError}` });
				return;
			}
			const firstText = fingerprintLib.canonicalText({ nodes: firstOutcome.result.nodes, edges: firstOutcome.result.edges });
			const secondText = fingerprintLib.canonicalText({ nodes: secondResult.nodes, edges: secondResult.edges });
			callback({ pass: firstText === secondText, detail: firstText === secondText ? `identical (${firstText.length} bytes)` : 'the two runs DIFFER after canonical sort' });
		});
	});
};

const detConjunctList = [
	{
		conjunctId: 'twoBuildContractGraphRunsIdentical',
		title: 'two buildContractGraph runs over ONE parsed are byte-identical after canonical sort (mirroring replay-block)',
		twinNameList: ['runCounterInStableId'],
		evaluate: (scenario, callback) => {
			toyScenario.runScenario(scenario, (runError, outcome) => {
				if (outcome.forgeError || outcome.injectionError || outcome.thrownFromForge) {
					callback('', { pass: false, detail: outcome.forgeError || outcome.injectionError || outcome.thrownFromForge });
					return;
				}
				// re-run the PURE layer over the same parsed/metadata (reconstruct parsed from the toy loader)
				const hooks = toyScenario.buildHooks(scenario);
				hooks.sourceLoaderList[0].load({ sourcePath: scenario.forgeArgs.sourcePath, additionalSourceInputPathByName: {}, xLog: process.global.xLog }, (loadError, loaded) => {
					const parsed = { toyModel: loaded };
					const metadata = outcome.result.metadata;
					let firstText;
					let secondText;
					let buildError = '';
					try {
						const first = outcome.bundle.buildContractGraph({ parsed, metadata });
						const second = outcome.bundle.buildContractGraph({ parsed, metadata });
						firstText = fingerprintLib.canonicalText(first);
						secondText = fingerprintLib.canonicalText(second);
					} catch (thrownError) {
						buildError = thrownError.message;
					}
					if (buildError) {
						callback('', { pass: false, detail: `pure layer refused: ${buildError}` });
						return;
					}
					callback('', { pass: firstText === secondText, detail: firstText === secondText ? 'identical' : 'DIFFER' });
				});
			});
		},
	},
	{
		conjunctId: 'twoForgeRunsOneInstanceIdentical',
		title: 'two forge() runs on ONE framework instance are byte-identical (no per-build state on the object)',
		twinNameList: ['cacheKitOnFrameworkObject'],
		evaluate: (scenario, callback) => runForgeTwice(scenario, (verdict) => callback('', verdict)),
	},
	{
		conjunctId: 'noClockInFrameworkOrHooks',
		title: 'static: no Date.now / new Date / Math.random / process.hrtime / crypto.randomBytes in the framework tree (code, comments stripped) or the fixture hooks',
		twinNameList: ['dateNowInFixtureHook'],
		evaluate: (scenario, callback) => {
			const offenderList = staticSourceList()
				.concat(scenario.staticExtraSourceList || [])
				.filter((oneFile) => CLOCK_RE.test(stripComments(oneFile.text)))
				.map((oneFile) => oneFile.fileName);
			callback('', { pass: offenderList.length === 0, detail: offenderList.length ? `clock/randomness in: ${offenderList.join(', ')}` : `${staticSourceList().length} files clean` });
		},
	},
];

frameworkMutationTwin({
	registry: twinRegistry, gateId: DET_GATE_ID, conjunctId: 'twoForgeRunsOneInstanceIdentical', twinName: 'cacheKitOnFrameworkObject', fileName: FRAMEWORK_FILE,
	find: '\t\t\t\tconst { kit, kitInternals } = contractGraphKitLib.contractGraphKit({ forgeDeclaration, metadata, activeAllowanceById });',
	replace: '\t\t\t\tif (!module.exports.__cachedKit) { module.exports.__cachedKit = contractGraphKitLib.contractGraphKit({ forgeDeclaration, metadata, activeAllowanceById }); } const { kit, kitInternals } = module.exports.__cachedKit;',
});
scenarioTwin({
	registry: twinRegistry, gateId: DET_GATE_ID, conjunctId: 'twoBuildContractGraphRunsIdentical', twinName: 'runCounterInStableId', leverKind: 'productionMutation',
	mutate: (scenario) => {
		const baseHooks = toyScenario.toyHooksFactory();
		let runCounter = 0;
		scenario.hookOverrides.emitContractGraph = (context) => {
			const walkResult = baseHooks.emitContractGraph(context);
			runCounter += 1;
			context.kit.makeNode({ role: 'DmeClass', perStandardLabel: 'ToyClass', stableId: `toy:class/Run${runCounter}`, name: 'Run', structural: { parentId: context.kit.rootStableId, path: 'Run' }, origin: 'twin' });
			return walkResult;
		};
	},
});
scenarioTwin({
	registry: twinRegistry, gateId: DET_GATE_ID, conjunctId: 'noClockInFrameworkOrHooks', twinName: 'dateNowInFixtureHook', leverKind: 'productionMutation',
	mutate: (scenario) => {
		scenario.staticExtraSourceList = (scenario.staticExtraSourceList || []).concat([{ fileName: 'test/fixtures/toyForge/lib/toyHooksWithClock.js (in-memory)', text: "const stamp = Date.now();\nmodule.exports = { stamp };\n" }]);
	},
});

// ---------------------------------------------------------------- G-ENV
const runLocaleChild = ({ localeName, twinArg }) => {
	const run = spawnSync(process.execPath, [LOCALE_RUNNER].concat(twinArg ? [`--twin=${twinArg}`] : []), { env: { ...process.env, LC_ALL: localeName, LANG: localeName }, encoding: 'utf8' });
	const lastLine = String(run.stdout || '').trim().split('\n').pop();
	return { status: run.status, fingerprint: lastLine, stderr: String(run.stderr || '').slice(0, 300) };
};

const envConjunctList = [
	{
		conjunctId: 'identicalUnderTwoLocales',
		title: 'the pure-layer fingerprint is IDENTICAL under LC_ALL=C and LC_ALL=en_US.UTF-8 (child processes)',
		twinNameList: ['hookReadsLocaleEnv'],
		evaluate: (scenario, callback) => {
			const twinArg = scenario.localeRunnerTwinArg;
			const underC = runLocaleChild({ localeName: 'C', twinArg });
			const underEnUs = runLocaleChild({ localeName: 'en_US.UTF-8', twinArg });
			if (underC.status !== 0 || underEnUs.status !== 0) {
				callback('', { pass: false, detail: `child failed: C→${underC.status} ${underC.fingerprint} ${underC.stderr}; en_US→${underEnUs.status} ${underEnUs.fingerprint} ${underEnUs.stderr}` });
				return;
			}
			callback('', { pass: underC.fingerprint === underEnUs.fingerprint && /^[0-9a-f]{64}$/.test(underC.fingerprint), detail: `C ${underC.fingerprint.slice(0, 16)}… vs en_US ${underEnUs.fingerprint.slice(0, 16)}…` });
		},
	},
	{
		conjunctId: 'verifiedOrderFollowsListNotDirectory',
		title: 'verifySnapshotChecksums returns files in SHA256SUMS order, not directory order (scratch snapshot listing two files in reverse-alphabetical order)',
		twinNameList: ['sortVerifiedFileList'],
		evaluate: (scenario, callback) => {
			const scratchDir = toyScenario.makeScratchSnapshotCopy();
			fs.writeFileSync(path.join(scratchDir, 'aaaExtra.json'), '{"extra":true}\n');
			const crypto = require('crypto');
			const shaOf = (fileName) => crypto.createHash('sha256').update(fs.readFileSync(path.join(scratchDir, fileName))).digest('hex');
			fs.writeFileSync(path.join(scratchDir, 'SHA256SUMS'), `${shaOf('toyModel.json')}  toyModel.json\n${shaOf('aaaExtra.json')}  aaaExtra.json\n`);
			const verifyFn = scenario.verifySnapshotChecksumsOverride || sourceVerificationLib.verifySnapshotChecksums;
			verifyFn({ snapshotDirPath: scratchDir }, (verifyError, verified) => {
				if (verifyError) {
					callback('', { pass: false, detail: verifyError });
					return;
				}
				const orderText = verified.verifiedFileList.join(',');
				callback('', { pass: orderText === 'toyModel.json,aaaExtra.json', detail: `verifiedFileList order: ${orderText}` });
			});
		},
	},
];
scenarioTwin({
	registry: twinRegistry, gateId: ENV_GATE_ID, conjunctId: 'identicalUnderTwoLocales', twinName: 'hookReadsLocaleEnv', leverKind: 'productionMutation',
	mutate: (scenario) => { scenario.localeRunnerTwinArg = 'readsLocaleEnv'; },
});
scenarioTwin({
	registry: twinRegistry, gateId: ENV_GATE_ID, conjunctId: 'verifiedOrderFollowsListNotDirectory', twinName: 'sortVerifiedFileList', leverKind: 'productionMutation',
	mutate: (scenario) => {
		// a test double of the verifier that sorts its result alphabetically (directory-ish order)
		scenario.verifySnapshotChecksumsOverride = (args, callback) =>
			sourceVerificationLib.verifySnapshotChecksums(args, (verifyError, verified) => {
				if (verifyError) {
					callback(verifyError);
					return;
				}
				callback('', { verifiedFileList: verified.verifiedFileList.slice().sort() });
			});
	},
});

const gateDeclarationList = [
	{ gateId: DET_GATE_ID, title: 'determinism of the pure layer', conjunctList: detConjunctList },
	{ gateId: ENV_GATE_ID, title: 'locale and directory-order independence', conjunctList: envConjunctList },
];

// the demonstration line (not a twin): the spec's localeCompare probe on this Node
(() => {
	const underC = runLocaleChild({ localeName: 'C', twinArg: 'localeCompareSort' });
	const underEnUs = runLocaleChild({ localeName: 'en_US.UTF-8', twinArg: 'localeCompareSort' });
	harness.note(`G-ENV demonstration (not counted): a localeCompare-sorting fixture hook under LC_ALL=C vs en_US.UTF-8 → ${underC.fingerprint === underEnUs.fingerprint ? 'IDENTICAL (Node resolves ICU default locale to en-US regardless of LC_ALL on this machine)' : 'DIFFERENT'}`);
})();

runGateFamily(
	{ harness, familyName: 'G-DET + G-ENV', gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: (scenario) => ({ ...toyScenario.cloneScenario(scenario), staticExtraSourceList: (scenario.staticExtraSourceList || []).slice(), localeRunnerTwinArg: scenario.localeRunnerTwinArg, verifySnapshotChecksumsOverride: scenario.verifySnapshotChecksumsOverride }), expectedConjunctCount: 5, expectedTwinCount: 5 },
	() => harness.report(),
);
