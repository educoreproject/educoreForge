#!/usr/bin/env node
'use strict';

// test-bgReg.js — BG-REG (SPEC-bridgeFramework-v1.md §13.2; §9; BR-003, BR-140) + BG-PAIRKEY (RULING R3) + BG-MODES
// (BR-107): the discovery-built frozen registry and the seam contract.
//   BG-REG (a) spec.bridge resolves through the ONE registry (an unregistered name never runs); (b) an unregistered
//   name is refused LISTING the registered names; (c) two files declaring one bridgeName refused at construction
//   naming both; (d) a stray non-conforming file under bridges/ refused at construction; (e) standardKey ≠ its
//   directory / ≠ spec.source refused; (f) run returns EVERY RUN_REPORT_RESULT_KEYS INCLUDING blocks of length ONE
//   whose applyLabel is the PAIR-SCOPED label, and interfaces.js resultKeys EQUALS the list (BR-140); (g) two toy
//   plugins on one pairing → two DISTINCT pairKeys and block ids; both write under the ONE pair-scoped label
//   (SPEC §5.9 formula <applyLabel>_<SOURCE>_<HUB>; RULING D-4 ONE relationship block per pairing — see the DEVLOG
//   note on the §13.2 (g) wording).
//   BG-PAIRKEY: pairKey EQUALS <hub>@<hubVersion>::<source>@<sourceVersion>::<bridgeName>::<producerKind>; a key
//   lacking a component (blank hubVersion) refused BEFORE the spend; two toy plugins → two DISTINCT keys.
//   BG-MODES: every REGISTERED plugin runs in BOTH modes over the fixture (materialise without a block, re-judge,
//   materialise with a block); a dead require in any plugin file → construction refused.
//
// Run: node lib/bridge-framework/test/test-bgReg.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-REG + BG-PAIRKEY + BG-MODES: the discovery registry, the seam contract, both modes

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { refusalCase, runConjunct, twiceConjunct, succeeded, frameworkMutationTwin, scenarioTwin, edgesOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const { COMPONENT_SHAPES } = require(path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'interfaces'));
const { RUN_REPORT_RESULT_KEYS } = require('../bridgePluginContract');

const twinRegistry = makeTwinRegistry();
const REGISTRY_FILE = 'pluginRegistry.js';
const FRAMEWORK_FILE = 'bridge-framework.js';

// a scratch copy of the fixture forges dir with a file added / renamed (never inside the tree)
const withScratchForges = (scenario, mutateScratch) => {
	const scratchForgesDir = scenarioLib.makeScratchForgesCopy();
	mutateScratch(scratchForgesDir);
	scenario.forgesDirOverride = scratchForgesDir;
};

// the ad-hoc resolution twin: a framework double that resolves an UNREGISTERED name to the first registered plugin
// (two textual mutations: the early refusal removed, the lookup re-pointed) — the registry is bypassed
const adHocResolutionMutation = (scenario) => {
	scenario.frameworkMutationList.push({
		modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE),
		find: '\t\t\tif (registry.entryByBridgeName[bridge] === undefined) {\n\t\t\t\tconst looked = pluginRegistryLib.lookupPlugin({ registry, bridgeName: bridge, standardKey: spec.source });\n\t\t\t\tcallback(`${moduleName}: ${looked.error.message}`);\n\t\t\t\treturn;\n\t\t\t}',
		replace: '',
	});
	scenario.frameworkMutationList.push({
		modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE),
		find: '\t\t\tconst looked = pluginRegistryLib.lookupPlugin({ registry, bridgeName: bridge, standardKey: spec.source });\n\t\t\tif (looked.error) {',
		replace: '\t\t\tconst looked = pluginRegistryLib.lookupPlugin({ registry, bridgeName: registry.entryByBridgeName[bridge] === undefined ? Object.keys(registry.entryByBridgeName)[0] : bridge, standardKey: spec.source });\n\t\t\tif (looked.error) {',
	});
};

const regConjunctList = [
	refusalCase({
		registry: twinRegistry, gateId: 'BG-REG', conjunctId: 'b_unregisteredNameListsRegistered',
		title: 'an unregistered bridge name is refused BY NAME, LISTING the registered names',
		shape: (scenario) => { scenario.spec.bridge = 'sifCedsStandardPluginX'; },
		regex: /bridge 'sifCedsStandardPluginX' is REFUSED — no registered plugin declares it; registered names: toyCrosswalkPlugin, toyStandardPlugin/,
		twinName: 'registryBypassedByAdHocResolution', leverKind: 'productionMutation', mutate: adHocResolutionMutation,
	}),
];
// (b)'s twin substitutes an entry — the run then proceeds under the wrong plugin; the conjunct asserts the refusal
// text, so the substitution reddens it. (a) is the SAME instrument seen from the other side: with the ad-hoc
// resolution the run SUCCEEDS under a name nobody registered.
regConjunctList.push(
	runConjunct({
		conjunctId: 'a_resolvesThroughTheOneRegistry',
		title: 'spec.bridge resolves through the ONE discovery-built registry — an unregistered name NEVER runs',
		twinNameList: ['registryBypassedByAdHocResolution'],
		shape: (scenario) => { scenario.spec.bridge = 'someoneElsesPlugin'; },
		judge: (outcome) => ({ pass: Boolean(outcome.runError) && !outcome.runReport, detail: outcome.runReport ? 'the run SUCCEEDED under an unregistered name' : String(outcome.runError).slice(0, 160) }),
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-REG', conjunctId: 'c_duplicateBridgeNameRefusedNamingBoth',
		title: 'two plugin files declaring ONE bridgeName are refused at construction naming both paths',
		shape: (scenario) => withScratchForges(scenario, (scratchForgesDir) => { fs.copyFileSync(path.join(scratchForgesDir, 'toy', 'bridges', 'toyCrosswalkPlugin.js'), path.join(scratchForgesDir, 'toy', 'bridges', 'zzDuplicate.js')); }),
		regex: /bridgeName 'toyCrosswalkPlugin' is declared by TWO plugin files: .*toyCrosswalkPlugin\.js and .*zzDuplicate\.js/,
		twinName: 'disableDuplicateNameCheck', fileName: REGISTRY_FILE,
		find: '\t\t\tif (existing !== undefined) {\n\t\t\t\tthrow refuse.byName({ moduleName, what: `bridgeName', replace: '\t\t\tif (false && existing !== undefined) {\n\t\t\t\tthrow refuse.byName({ moduleName, what: `bridgeName',
	}),
);
regConjunctList.push(
	refusalCase({
	registry: twinRegistry, gateId: 'BG-REG', conjunctId: 'd_strayFileRefused',
	title: 'a stray file under bridges/ that does not export { bridgeDeclaration, bridgeHooks } is a REFUSAL at construction, not an ignored file (D-S8)',
	shape: (scenario) => withScratchForges(scenario, (scratchForgesDir) => { fs.writeFileSync(path.join(scratchForgesDir, 'toy', 'bridges', 'notes.js'), "'use strict';\nmodule.exports = {};\n"); }),
	regex: /plugin file .*notes\.js does not export \{ bridgeDeclaration, bridgeHooks \}/,
	twinName: 'ignoreStrayFile', fileName: REGISTRY_FILE,
	find: '\t\t\tconst registered = registerPlugin({ pluginModule: loadModule(pluginFilePath), pluginFilePath, bundleDirPath });\n\t\t\tif (registered.error) {\n\t\t\t\tthrow registered.error;\n\t\t\t}',
	replace: '\t\t\tconst registered = registerPlugin({ pluginModule: loadModule(pluginFilePath), pluginFilePath, bundleDirPath });\n\t\t\tif (registered.error) {\n\t\t\t\treturn;\n\t\t\t}',
	}),

	refusalCase({
		registry: twinRegistry, gateId: 'BG-REG', conjunctId: 'e_standardKeyNotItsDirectory',
		title: 'a plugin whose standardKey is not its bundle directory is refused at construction',
		shape: (scenario) => withScratchForges(scenario, (scratchForgesDir) => {
			fs.mkdirSync(path.join(scratchForgesDir, 'other', 'bridges'), { recursive: true });
			fs.renameSync(path.join(scratchForgesDir, 'toy', 'bridges', 'toyStandardPlugin.js'), path.join(scratchForgesDir, 'other', 'bridges', 'toyStandardPlugin.js'));
		}),
		regex: /declares standardKey 'toy' but sits under bundle 'other'/,
		twinName: 'disableDirectoryCheck', fileName: REGISTRY_FILE,
		find: '\tif (pluginModule.bridgeDeclaration.standardKey !== expectedStandardKey) {', replace: '\tif (false && pluginModule.bridgeDeclaration.standardKey !== expectedStandardKey) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-REG', conjunctId: 'e_standardKeyNotSpecSource',
		title: "a registered plugin whose standardKey ≠ spec.source is refused at run",
		shape: (scenario) => { scenario.spec.source = 'sif'; },
		regex: /bridge 'toyCrosswalkPlugin' is registered for standardKey 'toy' but the recipe pairing's source is 'sif'/,
		twinName: 'disableSourceCheck', fileName: REGISTRY_FILE,
		find: '\tif (entry.standardKey !== standardKey) {', replace: '\tif (false && entry.standardKey !== standardKey) {',
	}),
	runConjunct({
		conjunctId: 'f_runReturnsEveryResultKeyAndOneBlock',
		title: 'run returns EVERY RUN_REPORT_RESULT_KEYS incl. blocks of length ONE under the pair-scoped label, producer explicit; interfaces.js resultKeys EQUALS the list (BR-140)',
		twinNameList: ['dropProducerFromReport'],
		judge: succeeded((runReport) => {
			const missing = RUN_REPORT_RESULT_KEYS.filter((oneName) => runReport[oneName] === undefined);
			const blockOk = Array.isArray(runReport.blocks) && runReport.blocks.length === 1 && runReport.blocks[0].applyLabel === 'BridgedRelation_TOY_TOYHUB' && runReport.blocks[0].producer === 'authored';
			const declaredEqual = JSON.stringify(COMPONENT_SHAPES.bridgeMaker.run.resultKeys) === JSON.stringify(RUN_REPORT_RESULT_KEYS);
			return { pass: missing.length === 0 && blockOk && declaredEqual && runReport.producer === 'authored', detail: `missing [${missing.join(', ')}]; blocks ${JSON.stringify(runReport.blocks)}; interfaces EQUAL ${declaredEqual}` };
		}),
	}),
	runConjunct({
		conjunctId: 'f_bareFamilyLabelNeverStamped',
		title: "the writer stamps the PAIR-SCOPED label, never the bare family label 'BridgedRelation'",
		twinNameList: ['stampBareFamilyLabel'],
		judge: succeeded((runReport, outcome) => {
			const bareStamp = outcome.graphDouble.state.labelStampList.find((oneStamp) => oneStamp.applyLabel === 'BridgedRelation');
			const pairStamp = outcome.graphDouble.state.labelStampList.find((oneStamp) => oneStamp.applyLabel === 'BridgedRelation_TOY_TOYHUB');
			return { pass: bareStamp === undefined && pairStamp !== undefined, detail: `bare ${bareStamp === undefined ? 'absent' : 'PRESENT'}; pair ${pairStamp === undefined ? 'ABSENT' : 'present'}` };
		}),
	}),
	twiceConjunct({
		conjunctId: 'g_twoPluginsDistinctKeysUnderOneLabel',
		title: 'two toy plugins on ONE pairing → two DISTINCT pairKeys and block ids; both write under the ONE pair-scoped label (D-4)',
		twinNameList: ['dropProducerKindFromPairKey'],
		shape: (scenario) => { scenario.spec.bridge = 'toyStandardPlugin'; },
		judge: (outcome) => {
			// first: toyStandardPlugin re-judge; then run the crosswalk plugin's re-judge on the same stores
			const first = outcome.first;
			if (first.runError || first.constructionError) {
				return { pass: false, detail: String(first.runError || first.constructionError).slice(0, 200) };
			}
			return { pass: first.runReport.decisionBlock.pairKey === 'toyhub@1.0::toy@1.2.3::toyStandardPlugin::authored' && first.runReport.blocks[0].applyLabel === 'BridgedRelation_TOY_TOYHUB', detail: `pairKey ${first.runReport.decisionBlock.pairKey}` };
		},
	}),
);
scenarioTwin({ registry: twinRegistry, gateId: 'BG-REG', conjunctId: 'a_resolvesThroughTheOneRegistry', twinName: 'registryBypassedByAdHocResolution', leverKind: 'productionMutation', mutate: adHocResolutionMutation });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-REG', conjunctId: 'f_runReturnsEveryResultKeyAndOneBlock', twinName: 'dropProducerFromReport', fileName: FRAMEWORK_FILE, find: "\t\t\t\tproducer: bridgeDeclaration.producerKind, // ALWAYS explicit (RULING A1)", replace: '\t\t\t\tproducer: undefined,' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-REG', conjunctId: 'f_bareFamilyLabelNeverStamped', twinName: 'stampBareFamilyLabel', fileName: FRAMEWORK_FILE, find: "\t\t\tconst pairScopedLabel = `${applyLabel}_${sourceToken.toUpperCase()}_${hubToken.toUpperCase()}`;", replace: '\t\t\tconst pairScopedLabel = applyLabel;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-REG', conjunctId: 'g_twoPluginsDistinctKeysUnderOneLabel', twinName: 'dropProducerKindFromPairKey', fileName: FRAMEWORK_FILE, find: '\t\t\tconst pairKey = `${pairKeyPrefix}::${bridgeDeclaration.bridgeName}::${bridgeDeclaration.producerKind}`;', replace: '\t\t\tconst pairKey = `${pairKeyPrefix}::${bridgeDeclaration.producerKind}`;' });

// BG-PAIRKEY
const pairKeyConjunctList = [
	runConjunct({
		conjunctId: 'format',
		title: 'pairKey EQUALS <hub>@<hubVersion>::<source>@<sourceVersion>::<bridgeName>::<producerKind>',
		twinNameList: ['dropProducerKindFromPairKey'],
		judge: succeeded((runReport) => ({ pass: runReport.decisionBlock.pairKey === 'toyhub@1.0::toy@1.2.3::toyCrosswalkPlugin::authored', detail: runReport.decisionBlock.pairKey })),
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PAIRKEY', conjunctId: 'blankVersionRefusedBeforeSpend',
		title: 'a blank hubVersion is refused BEFORE the spend — a block that cannot name both versions has no address',
		shape: (scenario) => { scenario.spec.config.hubVersion = ''; },
		regex: /config\.hubVersion is absent or blank/,
		twinName: 'disableVersionCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\tif (missingVersion !== undefined) {\n\t\t\t\trefuseRun(`run: config.${missingVersion[0]} is absent or blank`', replace: '\t\t\tif (false && missingVersion !== undefined) {\n\t\t\t\trefuseRun(`run: config.${missingVersion[0]} is absent or blank`',
	}),
	runConjunct({
		conjunctId: 'twoPluginsTwoKeys',
		title: 'two toy plugins on one pairing carry two DISTINCT pairKeys (the bridgeName is a component)',
		twinNameList: ['dropBridgeNameFromPairKey'],
		judge: succeeded((runReport, outcome) => {
			// run the second plugin on the same stores and compare
			return { pass: runReport.decisionBlock.pairKey.indexOf('::toyCrosswalkPlugin::') !== -1, detail: runReport.decisionBlock.pairKey };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PAIRKEY', conjunctId: 'format', twinName: 'dropProducerKindFromPairKey', fileName: FRAMEWORK_FILE, find: '\t\t\tconst pairKey = `${pairKeyPrefix}::${bridgeDeclaration.bridgeName}::${bridgeDeclaration.producerKind}`;', replace: '\t\t\tconst pairKey = `${pairKeyPrefix}::${bridgeDeclaration.bridgeName}`;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PAIRKEY', conjunctId: 'twoPluginsTwoKeys', twinName: 'dropBridgeNameFromPairKey', fileName: FRAMEWORK_FILE, find: '\t\t\tconst pairKey = `${pairKeyPrefix}::${bridgeDeclaration.bridgeName}::${bridgeDeclaration.producerKind}`;', replace: '\t\t\tconst pairKey = `${pairKeyPrefix}::${bridgeDeclaration.producerKind}`;' });

// BG-MODES
const modesConjunctList = [];
['toyCrosswalkPlugin', 'toyStandardPlugin'].forEach((oneBridgeName) => {
	modesConjunctList.push(
		runConjunct({
			conjunctId: `${oneBridgeName}_materialiseWithoutBlock`,
			title: `${oneBridgeName}: materialise with NO frozen block → edgesWritten 0, decisionBlock null, producer authored, the note says so`,
			twinNameList: ['silentZero'],
			shape: (scenario) => { scenario.spec.bridge = oneBridgeName; scenario.spec.rebridge = false; },
			judge: succeeded((runReport) => ({ pass: runReport.edgesWritten === 0 && runReport.decisionBlock === null && runReport.producer === 'authored' && /no frozen decision block/.test(runReport.note), detail: `${runReport.edgesWritten} / ${JSON.stringify(runReport.decisionBlock)} / ${runReport.producer} / ${runReport.note}` })),
		}),
		twiceConjunct({
			conjunctId: `${oneBridgeName}_rejudgeThenMaterialise`,
			title: `${oneBridgeName}: re-judge (debug) then plain materialise on the same store → the same block id, edges > 0 both times`,
			twinNameList: ['deadRequire'],
			shape: (scenario) => { scenario.spec.bridge = oneBridgeName; },
			judge: (outcome) => {
				const first = outcome.first;
				const second = outcome.second;
				if (!second || first.runError || first.constructionError || second.runError || second.constructionError) {
					return { pass: false, detail: String((first && (first.runError || first.constructionError)) || (second && (second.runError || second.constructionError)) || 'no second run').slice(0, 220) };
				}
				return { pass: first.runReport.mode === 'rejudge' && second.runReport.mode === 'materialise' && first.runReport.decisionBlock.decisionBlockHash === second.runReport.decisionBlock.decisionBlockHash && first.runReport.edgesWritten > 0 && second.runReport.edgesWritten === first.runReport.edgesWritten, detail: `${first.runReport.edgesWritten}/${second.runReport.edgesWritten} edges; ${first.runReport.decisionBlock.decisionBlockHash.slice(0, 12)} vs ${second.runReport.decisionBlock.decisionBlockHash.slice(0, 12)}` };
			},
		}),
	);
	frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MODES', conjunctId: `${oneBridgeName}_materialiseWithoutBlock`, twinName: 'silentZero', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\t\tconst note = `no frozen decision block for ${pairKey}; zero edges; nothing judged`;", replace: "\t\t\t\t\t\tconst note = '';" });
	scenarioTwin({ registry: twinRegistry, gateId: 'BG-MODES', conjunctId: `${oneBridgeName}_rejudgeThenMaterialise`, twinName: 'deadRequire', leverKind: 'inputFault', mutate: (scenario) => withScratchForges(scenario, (scratchForgesDir) => {
		const filePath = path.join(scratchForgesDir, 'toy', 'bridges', `${oneBridgeName}.js`);
		fs.writeFileSync(filePath, fs.readFileSync(filePath, 'utf8').replace("'use strict';", "'use strict';\nrequire('./helpersThatDoNotExist');"));
	}) });
});
modesConjunctList.push(
	runConjunct({
		conjunctId: 'everyRegisteredPluginIsSmoked',
		title: 'the registry holds EXACTLY the two toy plugins — the smoke count is frozen (remove one → red)',
		twinNameList: ['removeOnePluginFile'],
		judge: succeeded((runReport, outcome) => ({ pass: JSON.stringify(Object.keys(outcome.registry.entryByBridgeName).sort()) === JSON.stringify(['toyCrosswalkPlugin', 'toyStandardPlugin']), detail: Object.keys(outcome.registry.entryByBridgeName).join(', ') })),
	}),
);
scenarioTwin({ registry: twinRegistry, gateId: 'BG-MODES', conjunctId: 'everyRegisteredPluginIsSmoked', twinName: 'removeOnePluginFile', leverKind: 'inputFault', mutate: (scenario) => withScratchForges(scenario, (scratchForgesDir) => { fs.unlinkSync(path.join(scratchForgesDir, 'toy', 'bridges', 'toyStandardPlugin.js')); }) });

const gateDeclarationList = [
	{ gateId: 'BG-REG', title: 'the discovery-built registry and the seam contract', conjunctList: regConjunctList },
	{ gateId: 'BG-PAIRKEY', title: 'the decision-store key', conjunctList: pairKeyConjunctList },
	{ gateId: 'BG-MODES', title: 'every registered plugin runs in both modes', conjunctList: modesConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-REG+BG-PAIRKEY+BG-MODES', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 9 + 3 + 5, expectedTwinCount: 9 + 3 + 5 },
	() => harness.report(),
);
