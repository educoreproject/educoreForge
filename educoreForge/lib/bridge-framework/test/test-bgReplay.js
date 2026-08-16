#!/usr/bin/env node
'use strict';

// test-bgReplay.js — BG-REPLAY (BR-070, BR-110) + BG-CACHE (BR-069, BR-120) + BG-JUDGE (BR-065..068, RULING BF1) +
// BG-POOL-ORDER (RULING R2) + BG-DET (BR-006, BR-072): the block is the artifact, the graph is its replay; the judge
// component maps ordinals through the rendered pool order; determinism.
//   BG-REPLAY (a) a plain build after a re-judge makes ZERO judge calls (a spy client throws on call) — there is no
//   embedder in the bridge; (b) R2 === R1: the harvest after the plain replay EQUALS the harvest after the re-judge;
//   (c) A' === A: two re-judges under digest freeze the SAME block id; with a REAL-client double on a warm cache A'
//   === A with liveJudgmentCount 0; (d) a card deleted after freezing → materialise REFUSES naming it; a subject absent
//   → sourceGap, no edge; (e) no block → edgesWritten 0, decisionBlock null, producer authored, the note says so
//   (BG-MODES also holds it); (f) a drifted document / hubVersion / declaration → refused "re-judge required".
//   BG-CACHE (a) an identical rendered question is served from the cache across two judgings (spy count); (b) a hit
//   whose chosenStableId is not in the CURRENT rendered list is REFUSED; (c) a DEBUG run leaves the row count UNCHANGED
//   and writes NO row; (d) putJudgment failure is FATAL; (e) the report carries liveJudgmentCount / cacheHitCount and the
//   budget guard HALTS by name.
//   BG-JUDGE (a) an out-of-range choice is refused by name; a mapper reading the UNSORTED read-order list → the picked
//   stableId differs from the rendered one → red; (a') putJudgment receives EXACTLY { choice, category, rationale,
//   chosenStableId }; (b) abstention → NO edge, record abstained, counted separately from orphan; (c) a pick without
//   category/rationale refused; (d) the rendered prompt contains the source element's name; (e) per-candidate material
//   rides with its candidate; (f) global guidance naming a pool candidate is refused; (g) an ordinal rationale from a
//   REAL client is refused.
//   BG-POOL-ORDER (a) the pool handed to the renderer is sorted by stableId; (b) a reader double returning cards in
//   REVERSE leaves promptHash, the debug pick and the block id UNCHANGED; (c) the forensic record carries the pool's
//   stableId list in rendered order beside the ordinal.
//   BG-DET (a) no clock/random token in the framework tree, the seam face, bridge-maker/lib, the fixture plugins;
//   (b) freezes with a delayed client completing in REVERSE are byte-identical (the runner collects by index; the
//   freeze sorts); (c) a walk yielding in REVERSE order freezes byte-identically; (d) the canonical serialiser refuses
//   undefined / NaN / Infinity.
//
// Run: node lib/bridge-framework/test/test-bgReplay.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-REPLAY + BG-CACHE + BG-JUDGE + BG-POOL-ORDER + BG-DET

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
const { runConjunct, twiceConjunct, pureConjunct, succeeded, nameInRefusal, refusalCase, frameworkMutationTwin, scenarioTwin, edgesOf, blockOf, forensicsOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const decisionBlockLib = require('../decisionBlock');

const twinRegistry = makeTwinRegistry();
const FRAMEWORK_FILE = 'bridge-framework.js';
const JUDGE_FILE = 'judgeComponent.js';
const RENDERER_FILE = 'evidenceRenderer.js';
const RUNNER_FILE = 'boundedRunner.js';
const DECISION_BLOCK_FILE = 'decisionBlock.js';
const CROSSWALK_PLUGIN_PATH = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyCrosswalkPlugin.js');
const PAIR_LABEL = 'BridgedRelation_TOY_TOYHUB';

const cloneJson = scenarioLib.cloneJson;
const harvestText = (outcome) => JSON.stringify(outcome.graphDouble.harvestByLabel({ applyLabel: PAIR_LABEL }));
const useRealClientDouble = (scenario, options) => { scenario.judgeClientOverride = scenarioLib.makeFakeRealClient(options); };
const wrapWalk = (scenario, mutateWalked) => {
	const loaded = require(CROSSWALK_PLUGIN_PATH);
	scenario.pluginModuleOverrides.toyCrosswalkPlugin = {
		bridgeHooks: {
			...loaded.bridgeHooks,
			walkSourceAssertions: (hookArgs, callback) =>
				loaded.bridgeHooks.walkSourceAssertions(hookArgs, (walkError, walked) => (walkError ? callback(walkError) : callback('', mutateWalked(walked)))),
		},
	};
};
// runThrice — re-judge, plain materialise, re-judge again on the same stores (the three-run protocol)
const runThrice = (scenario, callback) => {
	scenarioLib.runRejudgeThenMaterialise(scenario, (unusedError, twoRuns) => {
		if (!twoRuns.second || twoRuns.first.runError || twoRuns.second.runError) {
			callback('', { ...twoRuns, third: null });
			return;
		}
		const third = scenarioLib.cloneScenario(scenario);
		third.stores = scenario.stores;
		third.graph = cloneJson(scenario.graph);
		scenarioLib.runScenario(third, (unusedThirdError, thirdOutcome) => callback('', { ...twoRuns, third: thirdOutcome }));
	});
};

// ---------------------------------------------------------------------
// BG-REPLAY
// ---------------------------------------------------------------------
const replayConjunctList = [
	runConjunct({
		conjunctId: 'a_plainBuildMakesZeroJudgeCalls',
		title: 'a plain build after a re-judge makes ZERO judge calls (a spy client that THROWS on call is handed to the materialise run)',
		twinNameList: ['materialiserAsksTheJudge'],
		judge: (outcome, scenario) => {
			void outcome;
			void scenario;
			return { pass: false, detail: 'replaced below' };
		},
	}),
];
// (a) needs the two-run shape with a spy on the SECOND run: custom evaluate
replayConjunctList[0].evaluate = (scenario, callback) => {
	scenarioLib.runScenario(scenario, (unusedError, first) => {
		if (first.runError) {
			callback('', { pass: false, detail: String(first.runError).slice(0, 200) });
			return;
		}
		const second = scenarioLib.cloneScenario(scenario);
		second.stores = scenario.stores;
		second.graph = cloneJson(scenario.graph);
		second.spec.rebridge = false;
		const spy = scenarioLib.makeFakeRealClient({ throwOnCall: true });
		second.specInferenceConfigOverride = { llmClient: spy };
		scenarioLib.runScenario(second, (unusedSecondError, secondOutcome) => {
			callback('', { pass: !secondOutcome.runError && !secondOutcome.thrownFromRun && spy.callCount === 0 && secondOutcome.runReport.edgesWritten === first.runReport.edgesWritten, detail: `spy calls ${spy.callCount}; ${secondOutcome.runError || secondOutcome.thrownFromRun || 'ok'}` });
		});
	});
};
scenarioTwin({ registry: twinRegistry, gateId: 'BG-REPLAY', conjunctId: 'a_plainBuildMakesZeroJudgeCalls', twinName: 'materialiserAsksTheJudge', leverKind: 'productionMutation', mutate: (scenario) => {
	// a materialise path that consults the judge: the framework double calls llmClient.rerank once before materialising
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\t\t\t\ttaskList.push((args, next) => materialiseAndReport({ block, decisionBlockHash: stored.decisionBlockHash, exportSssom: false }, next));', replace: "\t\t\t\t\ttaskList.push((args, next) => { if (spec.inferenceConfig && spec.inferenceConfig.llmClient) { spec.inferenceConfig.llmClient.rerank({ systemPrompt: 'x', userPrompt: 'x', choiceEnum: ['1', 'NONE'], requireJudgment: true }, () => {}); } materialiseAndReport({ block, decisionBlockHash: stored.decisionBlockHash, exportSssom: false }, next); });" });
} });
replayConjunctList.push(
	twiceConjunct({
		conjunctId: 'b_relationshipHarvestEqualAcrossRuns',
		title: 'R2 === R1: the label harvest after the plain replay EQUALS the harvest after the re-judge (fresh graph, same block)',
		twinNameList: ['runCounterStampedIntoEdge'],
		judge: (outcome) => {
			if (!outcome.second || outcome.first.runError || outcome.second.runError) {
				return { pass: false, detail: String((outcome.first && outcome.first.runError) || (outcome.second && outcome.second.runError) || 'no second').slice(0, 200) };
			}
			return { pass: harvestText(outcome.first) === harvestText(outcome.second), detail: `R1 ${harvestText(outcome.first).length} bytes vs R2 ${harvestText(outcome.second).length}` };
		},
	}),
);
scenarioTwin({ registry: twinRegistry, gateId: 'BG-REPLAY', conjunctId: 'b_relationshipHarvestEqualAcrossRuns', twinName: 'runCounterStampedIntoEdge', leverKind: 'productionMutation', mutate: (scenario) => {
	// a run counter stamped into an edge property: the twin's writer double appends a per-run counter into matchId
	let runCounter = 0;
	scenario.graphWriterFactoryOverride = (graphDouble) => (writerArgs) => {
		const inner = graphDouble.graphWriterFactory(writerArgs);
		runCounter += 1;
		const thisRun = runCounter;
		return { writeMappingEdge: ({ subjectStableId, objectStableId, edgeType, edgeProperties }, callback) => inner.writeMappingEdge({ subjectStableId, objectStableId, edgeType, edgeProperties: { ...edgeProperties, matchId: `${edgeProperties.matchId}-run${thisRun}` } }, callback), close: inner.close };
	};
} });
replayConjunctList.push(
	runConjunct({
		conjunctId: 'c_rejudgeTwiceSameBlockUnderDigest',
		title: "A' === A: two re-judges under digest freeze the SAME block id (three-run protocol steps 1 and 3)",
		twinNameList: ['cacheHitCountLeakedIntoFrozenText'],
		judge: (outcome) => ({ pass: false, detail: 'replaced below' }),
	}),
);
replayConjunctList[replayConjunctList.length - 1].evaluate = (scenario, callback) => {
	runThrice(scenario, (unusedError, runs) => {
		if (!runs.third || runs.third.runError) {
			callback('', { pass: false, detail: String((runs.first && runs.first.runError) || (runs.third && runs.third.runError) || 'no third run').slice(0, 200) });
			return;
		}
		callback('', { pass: runs.first.runReport.decisionBlock.decisionBlockHash === runs.third.runReport.decisionBlock.decisionBlockHash, detail: `${runs.first.runReport.decisionBlock.decisionBlockHash.slice(0, 12)} vs ${runs.third.runReport.decisionBlock.decisionBlockHash.slice(0, 12)}` });
	});
};
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-REPLAY', conjunctId: 'c_rejudgeTwiceSameBlockUnderDigest', twinName: 'cacheHitCountLeakedIntoFrozenText', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\tcardinalityCensus: provisionalCensus,\n\t\t\t\t\t\tgeneration,', replace: '\t\t\t\t\t\tcardinalityCensus: { ...provisionalCensus, runOrdinal: spec.decisionStore.rowList ? spec.decisionStore.rowList.length : 0 },\n\t\t\t\t\t\tgeneration,' });
replayConjunctList.push(
	runConjunct({
		conjunctId: 'c_realClientWarmCacheLiveJudgmentZero',
		title: "with a REAL-client double: the second re-judge on a WARM cache freezes the SAME block with liveJudgmentCount 0 (every judgment served from the cache)",
		twinNameList: ['cacheNeverStores'],
		judge: () => ({ pass: false, detail: 'replaced below' }),
	}),
);
replayConjunctList[replayConjunctList.length - 1].evaluate = (scenario, callback) => {
	const client = scenarioLib.makeFakeRealClient({});
	scenario.judgeClientOverride = client;
	scenarioLib.runScenario(scenario, (unusedError, first) => {
		if (first.runError) {
			callback('', { pass: false, detail: String(first.runError).slice(0, 200) });
			return;
		}
		const secondClient = scenarioLib.makeFakeRealClient({});
		const second = scenarioLib.cloneScenario(scenario);
		second.stores = scenario.stores;
		second.graph = cloneJson(scenario.graph);
		second.judgeClientOverride = secondClient;
		scenarioLib.runScenario(second, (unusedSecondError, secondOutcome) => {
			if (secondOutcome.runError) {
				callback('', { pass: false, detail: String(secondOutcome.runError).slice(0, 200) });
				return;
			}
			const sameBlock = first.runReport.decisionBlock.decisionBlockHash === secondOutcome.runReport.decisionBlock.decisionBlockHash;
			callback('', { pass: sameBlock && secondClient.callCount === 0 && secondOutcome.runReport.counts.judgeSpend.asked === 0 && secondOutcome.runReport.counts.judgeSpend.servedFromCache > 0, detail: `same block ${sameBlock}; live calls ${secondClient.callCount}; asked ${secondOutcome.runReport.counts.judgeSpend.asked}, cache ${secondOutcome.runReport.counts.judgeSpend.servedFromCache}` });
		});
	});
};
scenarioTwin({ registry: twinRegistry, gateId: 'BG-REPLAY', conjunctId: 'c_realClientWarmCacheLiveJudgmentZero', twinName: 'cacheNeverStores', leverKind: 'productionMutation', mutate: (scenario) => { scenario.stores.judgmentCache.putJudgment = (unusedArgs, callback) => callback(''); } });
replayConjunctList.push(
	runConjunct({
		conjunctId: 'd_deletedCardRefusedNamingIt',
		title: 'a card deleted from the graph after freezing → the plain materialise REFUSES naming the absent objectStableId (never re-derives)',
		twinNameList: ['writerSkipsAbsentEndpoint'],
		judge: () => ({ pass: false, detail: 'replaced below' }),
	}),
);
replayConjunctList[replayConjunctList.length - 1].evaluate = (scenario, callback) => {
	scenarioLib.runScenario(scenario, (unusedError, first) => {
		if (first.runError) {
			callback('', { pass: false, detail: String(first.runError).slice(0, 200) });
			return;
		}
		const second = scenarioLib.cloneScenario(scenario);
		second.stores = scenario.stores;
		second.graph = cloneJson(scenario.graph);
		second.graph.nodeList = second.graph.nodeList.filter((oneNode) => oneNode.stableId !== 'toyhub:card/P000001.C1');
		second.spec.rebridge = false;
		scenarioLib.runScenario(second, (unusedSecondError, secondOutcome) => {
			callback('', { pass: Boolean(secondOutcome.runError) && /object endpoint 'toyhub:card\/P000001\.C1' is absent from inGraph/.test(secondOutcome.runError), detail: String(secondOutcome.runError || 'the materialise SUCCEEDED without the card').slice(0, 220) });
		});
	});
};
scenarioTwin({ registry: twinRegistry, gateId: 'BG-REPLAY', conjunctId: 'd_deletedCardRefusedNamingIt', twinName: 'writerSkipsAbsentEndpoint', leverKind: 'productionMutation', mutate: (scenario) => {
	// a writer that writes past an ABSENT object endpoint (the rule disabled; the double's label stamp tolerates it)
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'graphSeamRules.js'), find: "\tif (objectEndpoint === null || objectEndpoint === undefined) {\n\t\treturn refuse.byName({ moduleName, what: `writeMappingEdge: object endpoint '${objectStableId}' is absent from inGraph`", replace: "\tif (false && (objectEndpoint === null || objectEndpoint === undefined)) {\n\t\treturn refuse.byName({ moduleName, what: `writeMappingEdge: object endpoint '${objectStableId}' is absent from inGraph`" });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'graphSeamRules.js'), find: "\tif (!Array.isArray(objectEndpoint.labels) || objectEndpoint.labels.indexOf(HUB_REFERENCE_LABEL) === -1) {", replace: "\tif (objectEndpoint && (!Array.isArray(objectEndpoint.labels) || objectEndpoint.labels.indexOf(HUB_REFERENCE_LABEL) === -1)) {" });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'graphSeamRules.js'), find: "\tif (objectEndpoint.referenceTier !== undefined && objectEndpoint.referenceTier !== PROPERTY_TIER) {", replace: "\tif (objectEndpoint && objectEndpoint.referenceTier !== undefined && objectEndpoint.referenceTier !== PROPERTY_TIER) {" });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'graphDouble.js'), find: '\t\t\t[subjectNode, objectNode].forEach((oneNode) => {\n\t\t\t\tif (oneNode.labels.indexOf(applyLabel) === -1) {', replace: '\t\t\t[subjectNode, objectNode].filter(Boolean).forEach((oneNode) => {\n\t\t\t\tif (oneNode.labels.indexOf(applyLabel) === -1) {' });
} });
replayConjunctList.push(
	runConjunct({
		conjunctId: 'e_noBlockSaysSoAloud',
		title: 'a pairing with NO block → edgesWritten 0, decisionBlock null, producer authored, and the note SAYS SO',
		twinNameList: ['silentZeroNote'],
		shape: (scenario) => { scenario.spec.rebridge = false; },
		judge: succeeded((runReport) => ({ pass: runReport.edgesWritten === 0 && runReport.decisionBlock === null && runReport.producer === 'authored' && /no frozen decision block for toyhub@1\.0::toy@1\.2\.3::toyCrosswalkPlugin::authored; zero edges; nothing judged/.test(runReport.note), detail: runReport.note })),
	}),
);
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-REPLAY', conjunctId: 'e_noBlockSaysSoAloud', twinName: 'silentZeroNote', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\t\tconst note = `no frozen decision block for ${pairKey}; zero edges; nothing judged`;", replace: "\t\t\t\t\t\tconst note = '';" });
// (f) drift → re-judge required: three faults, one twin (a framework double that skips the re-verify)
[
	{ conjunctId: 'f_documentDriftRefused', title: 'a document byte changed after freezing (scratch copy) → the plain materialise is refused "re-judge required"', drift: (second) => {
		const scratchForgesDir = scenarioLib.makeScratchForgesCopy();
		const csvPath = path.join(scratchForgesDir, 'toy', 'assets', 'standardSourceData', '01', 'toyCrosswalk.csv');
		fs.writeFileSync(csvPath, `${fs.readFileSync(csvPath, 'utf8')}Student,Student,Drifted,000001,,Yes,,drift,,z99\n`);
		const sumsPath = path.join(scratchForgesDir, 'toy', 'assets', 'standardSourceData', '01', 'SHA256SUMS');
		fs.writeFileSync(sumsPath, fs.readFileSync(sumsPath, 'utf8').replace(/^[0-9a-f]{64}(  toyCrosswalk\.csv)$/m, `${require('crypto').createHash('sha256').update(fs.readFileSync(csvPath)).digest('hex')}$1`));
		second.forgesDirOverride = scratchForgesDir;
	}, regex: /does not match this run: sourceChannelDigestByKey\.crosswalk/ },
	{ conjunctId: 'f_hubVersionDriftRefused', title: 'a re-versioned hub (config.hubVersion changed) → the plain materialise is refused "re-judge required"', drift: (second) => { second.spec.config.hubVersion = '1.1'; second.graph.nodeList.forEach((oneNode) => { if (oneNode.properties.hubVersion) { oneNode.properties.hubVersion = '1.1'; } }); }, regex: /no frozen decision block for toyhub@1\.1|hubVersion \(block 1\.0, run 1\.1\)/ },
	{ conjunctId: 'f_declarationDriftRefused', title: 'a changed declaration (label table row edited) → the plain materialise is refused "re-judge required" (declarationDigest)', drift: (second) => {
		const loaded = require(CROSSWALK_PLUGIN_PATH);
		const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
		bridgeDeclaration.predicateSource.table.Partial = { disposition: 'predicate', predicate: 'relatedMatch' };
		second.pluginModuleOverrides.toyCrosswalkPlugin = { bridgeDeclaration };
	}, regex: /does not match this run: declarationDigest/ },
].forEach((oneCase) => {
	replayConjunctList.push(runConjunct({ conjunctId: oneCase.conjunctId, title: oneCase.title, twinNameList: ['skipReVerify'], judge: () => ({ pass: false, detail: 'replaced' }) }));
	replayConjunctList[replayConjunctList.length - 1].evaluate = (scenario, callback) => {
		scenarioLib.runScenario(scenario, (unusedError, first) => {
			if (first.runError) {
				callback('', { pass: false, detail: String(first.runError).slice(0, 200) });
				return;
			}
			const second = scenarioLib.cloneScenario(scenario);
			second.stores = scenario.stores;
			second.graph = cloneJson(scenario.graph);
			second.spec.rebridge = false;
			oneCase.drift(second);
			scenarioLib.runScenario(second, (unusedSecondError, secondOutcome) => {
				// a hubVersion drift changes the pairKey too — "no block" for the new key is ALSO the honest refusal-to-replay
				const refusalText = secondOutcome.runError || (secondOutcome.runReport && secondOutcome.runReport.decisionBlock === null ? secondOutcome.runReport.note : '');
				callback('', { pass: Boolean(refusalText) && oneCase.regex.test(refusalText), detail: String(refusalText || 'the materialise REPLAYED onto the drifted run').slice(0, 220) });
			});
		});
	};
	if (oneCase.conjunctId === 'f_hubVersionDriftRefused') {
		// the hubVersion drift is refused by the pairKey (a different address) — the twin: a framework double keying the
		// pairKey WITHOUT versions replays the old block onto the re-versioned run
		scenarioTwin({ registry: twinRegistry, gateId: 'BG-REPLAY', conjunctId: oneCase.conjunctId, twinName: 'skipReVerify', leverKind: 'productionMutation', mutate: (scenario) => {
			scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\t\tconst pairKeyPrefix = `${hubToken}@${hubVersion}::${sourceToken}@${sourceVersion}`;', replace: '\t\t\tconst pairKeyPrefix = `${hubToken}::${sourceToken}`;' });
			scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\t\t\t\t\tif (driftList.length) {', replace: '\t\t\t\t\t\tif (false && driftList.length) {' });
		} });
	} else {
		frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-REPLAY', conjunctId: oneCase.conjunctId, twinName: 'skipReVerify', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\tif (driftList.length) {', replace: '\t\t\t\t\t\tif (false && driftList.length) {' });
	}
});

// ---------------------------------------------------------------------
// BG-CACHE (a REAL-client double: the debug judge never touches the cache)
// ---------------------------------------------------------------------
const cacheConjunctList = [
	runConjunct({
		conjunctId: 'a_identicalQuestionServedFromCache',
		title: 'an identical rendered question is served from the cache: two re-judges on one warm cache → the second asks the client ZERO times',
		twinNameList: ['cacheNeverStores'],
		judge: () => ({ pass: false, detail: 'replaced' }),
	}),
];
cacheConjunctList[0].evaluate = (scenario, callback) => {
	scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({});
	scenarioLib.runScenario(scenario, (unusedError, first) => {
		if (first.runError) {
			callback('', { pass: false, detail: String(first.runError).slice(0, 200) });
			return;
		}
		const secondClient = scenarioLib.makeFakeRealClient({});
		const second = scenarioLib.cloneScenario(scenario);
		second.stores = scenario.stores;
		second.graph = cloneJson(scenario.graph);
		second.judgeClientOverride = secondClient;
		scenarioLib.runScenario(second, (unusedSecondError, secondOutcome) => {
			callback('', { pass: !secondOutcome.runError && secondClient.callCount === 0 && scenario.stores.judgmentCache.rowCount() > 0, detail: `second-run client calls ${secondClient.callCount}; cache rows ${scenario.stores.judgmentCache.rowCount()}; ${secondOutcome.runError || ''}` });
		});
	});
};
scenarioTwin({ registry: twinRegistry, gateId: 'BG-CACHE', conjunctId: 'a_identicalQuestionServedFromCache', twinName: 'cacheNeverStores', leverKind: 'productionMutation', mutate: (scenario) => { scenario.stores.judgmentCache.putJudgment = (unusedArgs, callback) => callback(''); } });
cacheConjunctList.push(
	runConjunct({
		conjunctId: 'b_staleHitRefused',
		title: 'a cache hit whose chosenStableId is not the CURRENT rendered candidate at its ordinal is REFUSED, never served',
		twinNameList: ['serveStaleHit'],
		shape: (scenario) => {
			useRealClientDouble(scenario, {});
			// pre-seed EVERY prompt hash lookup with a stale pick: a cache double whose getJudgment answers with a foreign stableId
			scenario.stores.judgmentCache.getJudgment = (unusedArgs, callback) => callback('', { judgment: { choice: '1', category: 'strong', rationale: 'stale', chosenStableId: 'toyhub:card/NOT_IN_POOL' }, generation: null, createdAt: null });
		},
		judge: nameInRefusal(/cache hit for promptHash .* remembers chosenStableId "toyhub:card\/NOT_IN_POOL" at ordinal 1, which is not the CURRENT rendered candidate/),
	}),
	runConjunct({
		conjunctId: 'c_debugRunWritesNoRow',
		title: 'a DEBUG run leaves the cache row count UNCHANGED and writes NO row (putJudgment never called)',
		twinNameList: ['debugDoubleWrites'],
		judge: succeeded((runReport, outcome) => ({ pass: outcome.stores.judgmentCache.rowCount() === 0 && outcome.stores.judgmentCache.putCallCount === 0 && outcome.stores.judgmentCache.getCallCount === 0, detail: `rows ${outcome.stores.judgmentCache.rowCount()}, put ${outcome.stores.judgmentCache.putCallCount}, get ${outcome.stores.judgmentCache.getCallCount}` })),
	}),
	runConjunct({
		conjunctId: 'd_putJudgmentFailureIsFatal',
		title: 'a putJudgment failure is FATAL — the run is refused naming it, never a warning',
		twinNameList: ['swallowPutError'],
		shape: (scenario) => {
			useRealClientDouble(scenario, {});
			scenario.stores.judgmentCache.putJudgment = (unusedArgs, callback) => callback('disk full (double)');
		},
		judge: nameInRefusal(/putJudgment FAILED for promptHash .* \(FATAL, never a warning\): disk full \(double\)/),
	}),
	runConjunct({
		conjunctId: 'e_reportCarriesCountsAndBudgetHalts',
		title: 'the report carries judgeSpend { asked, servedFromCache, abstained } and the DECLARED budget guard HALTS by name (judgeBudgetOverride 1 with several judged subjects)',
		twinNameList: ['budgetTrimsInsteadOfHalting'],
		shape: (scenario) => { scenario.deps.judgeBudgetOverride = 1; },
		judge: nameInRefusal(/the run's declared maxJudgmentCount \(1\) is reached before promptHash/),
	}),
	runConjunct({
		conjunctId: 'e_reportCountsUnderBudget',
		title: 'under budget the report carries asked / servedFromCache / abstained (the debug run: asked = judged count, cache 0)',
		twinNameList: ['countsDroppedFromReport'],
		judge: succeeded((runReport) => ({ pass: Boolean(runReport.counts.judgeSpend) && runReport.counts.judgeSpend.asked === runReport.counts.cardinalityCensus.perTarget.judgedCount && runReport.counts.judgeSpend.servedFromCache === 0 && Number.isInteger(runReport.counts.judgeSpend.abstained), detail: JSON.stringify(runReport.counts.judgeSpend) })),
	}),
	runConjunct({
		conjunctId: 'f_declaredBudgetValuePinned',
		title: 'the DECLARED per-run judgment ceiling is PINNED: the constructed framework\'s constants.MAX_JUDGMENT_COUNT_PER_RUN === 20000 AND the run\'s effective budget equals it when no override is passed (RULING BR10 — the halt mechanism is gated by (e); the declared value is gated here)',
		twinNameList: ['budgetRaisedTwentyFold'],
		judge: succeeded((runReport, outcome) => {
			const declared = outcome.framework.constants.MAX_JUDGMENT_COUNT_PER_RUN;
			return { pass: declared === 20000, detail: `declared ${declared}` };
		}),
	}),
);
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CACHE', conjunctId: 'f_declaredBudgetValuePinned', twinName: 'budgetRaisedTwentyFold', fileName: FRAMEWORK_FILE, find: 'const MAX_JUDGMENT_COUNT_PER_RUN = 20000;', replace: 'const MAX_JUDGMENT_COUNT_PER_RUN = 400000;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CACHE', conjunctId: 'b_staleHitRefused', twinName: 'serveStaleHit', fileName: JUDGE_FILE, find: '\t\tif (!stillValid) {', replace: '\t\tif (false && !stillValid) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CACHE', conjunctId: 'c_debugRunWritesNoRow', twinName: 'debugDoubleWrites', fileName: JUDGE_FILE, find: '\t\t\tif (isDebugClient) {\n\t\t\t\tdeliver({ judgment: judged, cacheHit: false, attempts: clientReturn.attempts, usage: clientReturn.usage });\n\t\t\t\treturn;\n\t\t\t}', replace: '\t\t\tif (false && isDebugClient) {\n\t\t\t\tdeliver({ judgment: judged, cacheHit: false, attempts: clientReturn.attempts, usage: clientReturn.usage });\n\t\t\t\treturn;\n\t\t\t}' });
// under the debug-writes twin judgmentCache is present in the scenario stores (the framework requires it on rebridge), so the write lands
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CACHE', conjunctId: 'd_putJudgmentFailureIsFatal', twinName: 'swallowPutError', fileName: JUDGE_FILE, find: '\t\t\t\t\tif (putError) {\n\t\t\t\t\t\tcallback(`${moduleName}: putJudgment FAILED', replace: '\t\t\t\t\tif (false && putError) {\n\t\t\t\t\t\tcallback(`${moduleName}: putJudgment FAILED' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CACHE', conjunctId: 'e_reportCarriesCountsAndBudgetHalts', twinName: 'budgetTrimsInsteadOfHalting', fileName: JUDGE_FILE, find: '\t\tif (budget.judgmentCountSoFar >= budget.maxJudgmentCount) {', replace: '\t\tif (false && budget.judgmentCountSoFar >= budget.maxJudgmentCount) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CACHE', conjunctId: 'e_reportCountsUnderBudget', twinName: 'countsDroppedFromReport', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\t\t\t\t\tconst counts = { cardinalityCensus: block.header.cardinalityCensus, contentionCensus: block.header.contentionCensus, edgesWritten: materialised.edgesWritten, conflictCount: report.conflictCount, judgeSpend: report.judgeSpend,', replace: '\t\t\t\t\t\t\t\t\t\tconst counts = { cardinalityCensus: block.header.cardinalityCensus, contentionCensus: block.header.contentionCensus, edgesWritten: materialised.edgesWritten, conflictCount: report.conflictCount, judgeSpend: null,' });

// ---------------------------------------------------------------------
// BG-JUDGE
// ---------------------------------------------------------------------
const judgeConjunctList = [
	runConjunct({
		conjunctId: 'a_outOfRangeChoiceRefused',
		title: "a client returning choice '9' against a pool of 2 is refused by name (never clamped)",
		twinNameList: ['clampOrdinal'],
		shape: (scenario) => useRealClientDouble(scenario, { pickOrdinal: '9' }),
		judge: nameInRefusal(/the judge returned choice "9", which is not in choiceEnum/),
	}),
	runConjunct({
		conjunctId: 'a_pickMappedThroughRenderedOrder',
		title: 'the picked stableId is renderedPoolStableIdList[choice − 1] on every judged record (a mapper reading the unsorted read order would differ)',
		twinNameList: ['mapThroughReversedList'],
		shape: (scenario) => useRealClientDouble(scenario, { pickOrdinal: ({ choiceEnum }) => String(choiceEnum.length - 1) }), // the LAST ordinal of every pool
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const picked = block.decisionRecordList.filter((oneRecord) => oneRecord.classification === 'judged' && oneRecord.objectStableId !== null);
			const bad = picked.filter((oneRecord) => oneRecord.renderedPoolStableIdList[Number(oneRecord.judge.choice) - 1] !== oneRecord.objectStableId);
			return { pass: picked.length > 0 && bad.length === 0, detail: `${picked.length} picks, ${bad.length} not at their ordinal` };
		}),
	}),
	runConjunct({
		conjunctId: 'aPrime_putJudgmentPayloadExactlyFourKeys',
		title: 'putJudgment receives EXACTLY { choice, category, rationale, chosenStableId }',
		twinNameList: ['payloadLacksChosenStableId'],
		shape: (scenario) => {
			useRealClientDouble(scenario, {});
			const cache = scenario.stores.judgmentCache;
			cache.payloadKeyListList = [];
			const innerPut = cache.putJudgment;
			cache.putJudgment = (putArgs, callback) => { cache.payloadKeyListList.push(Object.keys(putArgs.judgment).sort()); innerPut(putArgs, callback); };
		},
		judge: succeeded((runReport, outcome) => {
			const keyListList = outcome.stores.judgmentCache.payloadKeyListList;
			const bad = keyListList.filter((oneList) => JSON.stringify(oneList) !== JSON.stringify(['category', 'choice', 'chosenStableId', 'rationale']));
			return { pass: keyListList.length > 0 && bad.length === 0, detail: `${keyListList.length} puts; bad ${JSON.stringify(bad[0])}` };
		}),
	}),
	runConjunct({
		conjunctId: 'b_abstentionNoEdgeCountedSeparately',
		title: 'an abstention (NONE) yields NO edge, a record with abstained true, counted abstainedCount — never an orphan',
		twinNameList: ['abstainYieldsEdgeToFirstCandidate'],
		shape: (scenario) => { scenario.judgeRule = 'abstain'; },
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const judged = block.decisionRecordList.filter((oneRecord) => oneRecord.classification === 'judged');
			const withEdge = judged.filter((oneRecord) => oneRecord.objectStableId !== null);
			const census = block.header.cardinalityCensus.perTarget;
			return { pass: judged.length > 0 && withEdge.length === 0 && judged.every((oneRecord) => oneRecord.abstained === true) && census.abstainedCount === judged.length && census.orphanCount === 2, detail: `${judged.length} judged, ${withEdge.length} with edge, abstained ${census.abstainedCount}, orphan ${census.orphanCount}` };
		}),
	}),
	runConjunct({
		conjunctId: 'c_pickWithoutCategoryRefused',
		title: 'a pick without category / with a blank rationale is refused by name',
		twinNameList: ['defaultBlankRationale'],
		shape: (scenario) => useRealClientDouble(scenario, { rationaleMode: 'blank' }),
		judge: nameInRefusal(/with category "strong" \/ rationale blank/),
	}),
	runConjunct({
		conjunctId: 'd_promptContainsSourceElementName',
		title: "the rendered prompt contains the fixture source element's NAME (the judge is told what it matches FROM)",
		twinNameList: ['rendererOmitsSourceBlock'],
		judge: succeeded((runReport, outcome) => {
			const recordList = forensicsOf(outcome).filter((oneRecord) => oneRecord.record.userPrompt !== undefined);
			const genderRecord = recordList.find((oneRecord) => oneRecord.record.userPrompt.indexOf('name: Gender') !== -1);
			return { pass: recordList.length > 0 && genderRecord !== undefined && recordList.every((oneRecord) => /SOURCE ELEMENT \(what you are matching FROM\):\n  name: \S/.test(oneRecord.record.userPrompt)), detail: `${recordList.length} prompts; Gender named ${genderRecord !== undefined}` };
		}),
	}),
	runConjunct({
		conjunctId: 'e_perCandidateMaterialRidesWithCandidate',
		title: 'per-candidate material (a walkEvidence note) rides WITH its candidate in the prompt, never as a global segment',
		twinNameList: ['noteHoistedToGlobalSegment'],
		shape: (scenario) => {
			const loaded = require(CROSSWALK_PLUGIN_PATH);
			const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
			bridgeDeclaration.evidenceHooksDeclared.walkEvidence = true;
			scenario.pluginModuleOverrides.toyCrosswalkPlugin = { bridgeDeclaration, bridgeHooks: { ...loaded.bridgeHooks, walkEvidence: ({ candidatePool }, callback) => callback('', { perCandidateNoteByStableId: candidatePool.reduce((soFar, oneCard) => ({ ...soFar, [oneCard.stableId]: `note for ${oneCard.stableId}` }), {}), promptSegmentList: [] }) } };
		},
		judge: succeeded((runReport, outcome) => {
			const recordList = forensicsOf(outcome).filter((oneRecord) => oneRecord.record.userPrompt !== undefined);
			const ok = recordList.every((oneRecord) => oneRecord.record.renderedPoolStableIdList.every((oneStableId) => new RegExp(`\\[\\d+\\] [^\\n]*\\n(      [^\\n]*\\n)*      note: note for ${oneStableId.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`).test(oneRecord.record.userPrompt)) && oneRecord.record.userPrompt.indexOf('GUIDANCE') === -1);
			return { pass: recordList.length > 0 && ok, detail: `${recordList.length} prompts checked` };
		}),
	}),
	runConjunct({
		conjunctId: 'f_globalGuidanceNamingCandidateRefused',
		title: 'a global guidance string naming a pool candidate is refused by name (A2 smuggling gate)',
		twinNameList: ['smugglingGateDisabled'],
		shape: (scenario) => {
			const loaded = require(CROSSWALK_PLUGIN_PATH);
			const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
			bridgeDeclaration.evidenceHooksDeclared.globalGuidance = true;
			bridgeDeclaration.globalGuidanceList = ['prefer P000002 when in doubt'];
			scenario.pluginModuleOverrides.toyCrosswalkPlugin = { bridgeDeclaration };
		},
		judge: nameInRefusal(/a global segment "prefer P000002 when in doubt" references candidate-specific token 'P000002'/),
	}),
	runConjunct({
		conjunctId: 'g_ordinalRationaleFromRealClientRefused',
		title: "a REAL client's rationale naming the pick by ORDINAL ('picked candidate 2') is refused by name (BR-067)",
		twinNameList: ['ordinalRationaleAccepted'],
		shape: (scenario) => useRealClientDouble(scenario, { pickOrdinal: '1', rationaleMode: 'ordinal' }),
		judge: nameInRefusal(/the judge's rationale names the pick by ORDINAL/),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGE', conjunctId: 'a_outOfRangeChoiceRefused', twinName: 'clampOrdinal', fileName: JUDGE_FILE, find: "\tif (typeof choice !== 'string' || choiceEnum.indexOf(choice) === -1) {\n\t\treturn { error:", replace: "\tif (typeof choice !== 'string' || choiceEnum.indexOf(choice) === -1) {\n\t\treturn { chosenCardStableId: renderedPoolStableIdList[Math.min(renderedPoolStableIdList.length, Number(choice)) - 1] };\n\t\treturn { error:" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGE', conjunctId: 'a_pickMappedThroughRenderedOrder', twinName: 'mapThroughReversedList', fileName: JUDGE_FILE, find: '\tconst chosenCardStableId = renderedPoolStableIdList[ordinal - 1];', replace: '\tconst chosenCardStableId = renderedPoolStableIdList.slice().reverse()[ordinal - 1];' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGE', conjunctId: 'aPrime_putJudgmentPayloadExactlyFourKeys', twinName: 'payloadLacksChosenStableId', fileName: JUDGE_FILE, find: "\t\t\t\t{ ...cacheKey, generation, judgment: { choice: judged.choice, category: judged.category, rationale: judged.rationale, chosenStableId: judged.chosenCardStableId } },", replace: "\t\t\t\t{ ...cacheKey, generation, judgment: { choice: judged.choice, category: judged.category, rationale: judged.rationale, chosenStableId: judged.chosenCardStableId, model: judgeClient.model } }," });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-JUDGE', conjunctId: 'b_abstentionNoEdgeCountedSeparately', twinName: 'abstainYieldsEdgeToFirstCandidate', leverKind: 'productionMutation', mutate: (scenario) => {
	// an abstention that yields an edge to the first candidate (three coordinated faults in the judge component)
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, JUDGE_FILE), find: "\tif (choice === ABSTAIN_TOKEN) {\n\t\treturn { chosenCardStableId: null };\n\t}", replace: "\tif (choice === ABSTAIN_TOKEN) {\n\t\treturn { chosenCardStableId: renderedPoolStableIdList[0] };\n\t}" });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, JUDGE_FILE), find: "\tif (clientReturn.category === ABSTAIN_CATEGORY) {\n\t\treturn { error: refuse.byName({ moduleName, what: `the judge picked ordinal", replace: "\tif (false && clientReturn.category === ABSTAIN_CATEGORY) {\n\t\treturn { error: refuse.byName({ moduleName, what: `the judge picked ordinal" });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, JUDGE_FILE), find: '\tconst band = confidenceForCategory(clientReturn.category);\n\tif (band.error) {', replace: "\tconst band = clientReturn.category === ABSTAIN_CATEGORY ? { confidence: 0.5 } : confidenceForCategory(clientReturn.category);\n\tif (band.error) {" });
} });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGE', conjunctId: 'c_pickWithoutCategoryRefused', twinName: 'defaultBlankRationale', fileName: JUDGE_FILE, find: '\tif (!isNonBlank(clientReturn.category) || !isNonBlank(clientReturn.rationale)) {', replace: "\tif (!isNonBlank(clientReturn.category)) {\n\t\tclientReturn = { ...clientReturn };\n\t}\n\tclientReturn = { ...clientReturn, rationale: isNonBlank(clientReturn.rationale) ? clientReturn.rationale : 'no rationale given' };\n\tif (!isNonBlank(clientReturn.category) || !isNonBlank(clientReturn.rationale)) {" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGE', conjunctId: 'd_promptContainsSourceElementName', twinName: 'rendererOmitsSourceBlock', fileName: RENDERER_FILE, find: "\tlineList.push('SOURCE ELEMENT (what you are matching FROM):');\n\tlineList.push(`  name: ${sourceElement.name}`);", replace: "\tlineList.push('SOURCE ELEMENT (what you are matching FROM):');" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGE', conjunctId: 'e_perCandidateMaterialRidesWithCandidate', twinName: 'noteHoistedToGlobalSegment', fileName: RENDERER_FILE, find: "\t\tif (typeof noteByStableId[oneCard.stableId] === 'string' && noteByStableId[oneCard.stableId] !== '') {\n\t\t\tlineList.push(`      note: ${noteByStableId[oneCard.stableId]}`);\n\t\t}", replace: "\t\tif (typeof noteByStableId[oneCard.stableId] === 'string' && noteByStableId[oneCard.stableId] !== '') {\n\t\t\tlineList.push(`GUIDANCE: ${noteByStableId[oneCard.stableId]}`);\n\t\t}" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGE', conjunctId: 'f_globalGuidanceNamingCandidateRefused', twinName: 'smugglingGateDisabled', fileName: RENDERER_FILE, find: '\t\t\tconst leaked = globalSegmentList.find((oneSegment) => oneSegment.indexOf(tokenList[tokenIndex]) !== -1);', replace: '\t\t\tconst leaked = undefined;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGE', conjunctId: 'g_ordinalRationaleFromRealClientRefused', twinName: 'ordinalRationaleAccepted', fileName: JUDGE_FILE, find: '\tif (!isDebugClient && ORDINAL_RATIONALE_RE.test(clientReturn.rationale)) {', replace: '\tif (false && !isDebugClient && ORDINAL_RATIONALE_RE.test(clientReturn.rationale)) {' });

// ---------------------------------------------------------------------
// BG-POOL-ORDER
// ---------------------------------------------------------------------
const poolOrderConjunctList = [
	runConjunct({
		conjunctId: 'a_poolSortedByStableId',
		title: 'the pool handed to the renderer is sorted by stableId (every forensic renderedPoolStableIdList is sorted)',
		twinNameList: ['skipPoolSort'],
		shape: (scenario) => { scenario.graph.nodeList = scenario.graph.nodeList.slice().reverse(); },
		judge: succeeded((runReport, outcome) => {
			const recordList = forensicsOf(outcome).filter((oneRecord) => Array.isArray(oneRecord.record.renderedPoolStableIdList) && oneRecord.record.renderedPoolStableIdList.length > 1);
			const unsorted = recordList.filter((oneRecord) => JSON.stringify(oneRecord.record.renderedPoolStableIdList) !== JSON.stringify(oneRecord.record.renderedPoolStableIdList.slice().sort()));
			return { pass: recordList.length > 0 && unsorted.length === 0, detail: `${recordList.length} multi-card pools, ${unsorted.length} unsorted` };
		}),
	}),
	pureConjunct({
		conjunctId: 'b_reverseReadOrderLeavesPromptHashPickAndBlockUnchanged',
		title: 'a reader returning cards in REVERSE order leaves promptHash, the digest pick and the block id UNCHANGED',
		twinNameList: ['skipPoolSort'],
		judge: () => ({ pass: false, detail: 'replaced' }),
	}),
	runConjunct({
		conjunctId: 'c_forensicRecordCarriesRenderedList',
		title: 'the forensic record carries renderedPoolStableIdList in rendered order beside the ordinal choice',
		twinNameList: ['dropRenderedListFromForensics'],
		judge: succeeded((runReport, outcome) => {
			const recordList = forensicsOf(outcome).filter((oneRecord) => oneRecord.record.promptHash !== undefined);
			const bad = recordList.filter((oneRecord) => !Array.isArray(oneRecord.record.renderedPoolStableIdList) || typeof oneRecord.record.choice !== 'string');
			return { pass: recordList.length > 0 && bad.length === 0, detail: `${recordList.length} records, ${bad.length} lacking the list/ordinal` };
		}),
	}),
];
poolOrderConjunctList[1].evaluate = (scenario, callback) => {
	scenarioLib.runScenario(scenario, (unusedError, forward) => {
		if (forward.runError) {
			callback('', { pass: false, detail: String(forward.runError).slice(0, 200) });
			return;
		}
		const reversed = scenarioLib.cloneScenario(scenario);
		reversed.graph.nodeList = reversed.graph.nodeList.slice().reverse();
		scenarioLib.runScenario(reversed, (unusedReversedError, backward) => {
			if (backward.runError) {
				callback('', { pass: false, detail: String(backward.runError).slice(0, 200) });
				return;
			}
			const hashesOf = (outcome) => JSON.stringify(forensicsOf(outcome).filter((oneRecord) => oneRecord.record.promptHash !== undefined).map((oneRecord) => [oneRecord.record.promptHash, oneRecord.record.chosenCardStableId]).sort());
			callback('', { pass: hashesOf(forward) === hashesOf(backward) && forward.runReport.decisionBlock.decisionBlockHash === backward.runReport.decisionBlock.decisionBlockHash, detail: `blocks ${forward.runReport.decisionBlock.decisionBlockHash.slice(0, 12)} / ${backward.runReport.decisionBlock.decisionBlockHash.slice(0, 12)}; hashes equal ${hashesOf(forward) === hashesOf(backward)}` });
		});
	});
};
['a_poolSortedByStableId', 'b_reverseReadOrderLeavesPromptHashPickAndBlockUnchanged'].forEach((oneConjunctId) => {
	scenarioTwin({ registry: twinRegistry, gateId: 'BG-POOL-ORDER', conjunctId: oneConjunctId, twinName: 'skipPoolSort', leverKind: 'productionMutation', mutate: (scenario) => {
		// BOTH sorts skipped: the union pool sort in the framework and the filter's own sort in classification.js
		scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\t\t\t\t\t\tkeyPoolCardList = classificationLib.sortByStableId(keyPoolCardList);\n\t\t\t\t\t\t\tfilteredCardList = classificationLib.sortByStableId(filteredCardList);', replace: '\t\t\t\t\t\t\tkeyPoolCardList = keyPoolCardList.slice();\n\t\t\t\t\t\t\tfilteredCardList = filteredCardList.slice();' });
		scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'classification.js'), find: '\treturn { filteredPool: sortByStableId(filteredPool), filterFieldList, mismatchByField };', replace: '\treturn { filteredPool, filterFieldList, mismatchByField };' });
	} });
});
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-POOL-ORDER', conjunctId: 'c_forensicRecordCarriesRenderedList', twinName: 'dropRenderedListFromForensics', fileName: JUDGE_FILE, find: '\t\t\t\t\trenderedPoolStableIdList: question.renderedPoolStableIdList,\n\t\t\t\t\tchoice: judgment.choice,', replace: '\t\t\t\t\tchoice: judgment.choice,' });
// (a)'s twin skips the sort but the multimap and filter already visit cards in READ order — with the reversed graph
// the pool arrives reversed → the forensic list is unsorted → red. (b): reversed vs forward promptHash differ → red.

// ---------------------------------------------------------------------
// BG-DET
// ---------------------------------------------------------------------
const CLOCK_TOKEN_RE = /Date\.now|new Date\b|Math\.random|process\.hrtime|crypto\.randomBytes/;
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const listJs = (dirPath, recursive) => (fs.existsSync(dirPath) ? fs.readdirSync(dirPath, { withFileTypes: true }).reduce((soFar, oneEntry) => (oneEntry.isFile() && /\.js$/.test(oneEntry.name) ? soFar.concat([path.join(dirPath, oneEntry.name)]) : oneEntry.isDirectory() && recursive && oneEntry.name !== 'test' && oneEntry.name !== 'node_modules' ? soFar.concat(listJs(path.join(dirPath, oneEntry.name), true)) : soFar), []) : []);
const detFileListFor = (scenario) => {
	const frameworkDir = scenario.frameworkTreeDirOverride === undefined ? scenarioLib.FRAMEWORK_DIR : scenario.frameworkTreeDirOverride;
	const bridgeMakerDir = path.join(scenarioLib.FRAMEWORK_DIR, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker');
	return listJs(frameworkDir, true).concat([path.join(bridgeMakerDir, 'bridgeMaker.js')]).concat(listJs(path.join(bridgeMakerDir, 'lib'), false)).concat(listJs(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges'), false));
};
const withScratchFrameworkCopy = (scenario, mutateCopy) => {
	const scratchDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bridgeFrameworkScratch-'));
	listJs(scenarioLib.FRAMEWORK_DIR, false).forEach((oneFilePath) => fs.copyFileSync(oneFilePath, path.join(scratchDir, path.basename(oneFilePath))));
	mutateCopy(scratchDir);
	scenario.frameworkTreeDirOverride = scratchDir;
};
const detConjunctList = [
	pureConjunct({
		conjunctId: 'a_noClockOrRandomToken',
		title: 'Date.now | new Date | Math.random | process.hrtime | crypto.randomBytes absent from lib/bridge-framework/**, bridgeMaker.js, bridge-maker/lib/*.js and every fixture plugin (comments stripped)',
		twinNameList: ['dateNowInFrameworkFile'],
		judge: (scenario) => {
			const offenderList = detFileListFor(scenario).filter((oneFilePath) => CLOCK_TOKEN_RE.test(stripComments(fs.readFileSync(oneFilePath, 'utf8'))));
			return { pass: offenderList.length === 0, detail: offenderList.length ? `clock/random token in ${offenderList.map((onePath) => path.basename(onePath)).join(', ')}` : `${detFileListFor(scenario).length} files clean` };
		},
	}),
	pureConjunct({
		conjunctId: 'b_reverseCompletionOrderByteIdentical',
		title: 'two freezes with a delayed client completing in REVERSE order are byte-identical (the runner collects by index; the freeze sorts)',
		twinNameList: ['runnerCollectsInCompletionOrderAndFreezeKeepsIt'],
		judge: () => ({ pass: false, detail: 'replaced' }),
	}),
	pureConjunct({
		conjunctId: 'c_reverseWalkOrderByteIdentical',
		title: 'a walk yielding assertions in REVERSE order freezes a byte-identical block',
		twinNameList: ['freezeKeepsWalkOrder'],
		judge: () => ({ pass: false, detail: 'replaced' }),
	}),
	pureConjunct({
		conjunctId: 'd_serialiserRefusesNaNUndefinedInfinity',
		title: 'the canonical serialiser sorts keys and REFUSES undefined / NaN / Infinity',
		twinNameList: ['serialiserAdmitsNaN'],
		judge: (scenario) => {
			const lib = scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, DECISION_BLOCK_FILE), mutationList: scenario.frameworkMutationList }) : decisionBlockLib;
			const attempts = [{ a: NaN }, { a: undefined }, { a: Infinity }].map((oneValue) => {
				let refused = '';
				try {
					lib.canonicalText(oneValue);
				} catch (thrown) {
					refused = thrown.message;
				}
				return refused;
			});
			const sorted = lib.canonicalText({ b: 1, a: [3, { d: 1, c: 2 }] }) === '{"a":[3,{"c":2,"d":1}],"b":1}';
			return { pass: sorted && attempts.every((oneRefusal) => /REFUSED/.test(oneRefusal)), detail: `sorted ${sorted}; refusals ${attempts.map((oneRefusal) => (oneRefusal ? 'yes' : 'NO')).join('/')}` };
		},
	}),
];
// (b): a delayed real-client double whose i-th answer arrives after (N − i) ticks; forward vs reversed delays
const delayedClient = ({ delayList }) => {
	let callIndex = 0;
	const inner = scenarioLib.makeFakeRealClient({});
	return { model: inner.model, keySource: 'test', rerank: (question, callback) => { const thisIndex = callIndex; callIndex += 1; setTimeout(() => inner.rerank(question, callback), delayList[thisIndex % delayList.length]); } };
};
detConjunctList[1].evaluate = (scenario, callback) => {
	const forward = scenarioLib.cloneScenario(scenario);
	forward.frameworkMutationList = scenario.frameworkMutationList.slice();
	forward.judgeClientOverride = delayedClient({ delayList: [5, 10, 15, 20, 25, 30] });
	scenarioLib.runScenario(forward, (unusedError, forwardOutcome) => {
		if (forwardOutcome.runError) {
			callback('', { pass: false, detail: String(forwardOutcome.runError).slice(0, 200) });
			return;
		}
		const backward = scenarioLib.cloneScenario(scenario);
		backward.frameworkMutationList = scenario.frameworkMutationList.slice();
		backward.judgeClientOverride = delayedClient({ delayList: [30, 25, 20, 15, 10, 5] });
		scenarioLib.runScenario(backward, (unusedBackwardError, backwardOutcome) => {
			if (backwardOutcome.runError) {
				callback('', { pass: false, detail: String(backwardOutcome.runError).slice(0, 200) });
				return;
			}
			const forwardText = forwardOutcome.stores.decisionStore.rowList[0].frozenText;
			const backwardText = backwardOutcome.stores.decisionStore.rowList[0].frozenText;
			callback('', { pass: forwardText === backwardText, detail: `${forwardText.length} vs ${backwardText.length} bytes; ids ${forwardOutcome.runReport.decisionBlock.decisionBlockHash.slice(0, 12)} / ${backwardOutcome.runReport.decisionBlock.decisionBlockHash.slice(0, 12)}` });
		});
	});
};
scenarioTwin({ registry: twinRegistry, gateId: 'BG-DET', conjunctId: 'b_reverseCompletionOrderByteIdentical', twinName: 'runnerCollectsInCompletionOrderAndFreezeKeepsIt', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RUNNER_FILE), find: '\t\t\t\tresultList[thisIndex] = itemResult;', replace: '\t\t\t\tresultList[resultList.filter((oneEntry) => oneEntry !== undefined).length] = itemResult;' });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, DECISION_BLOCK_FILE), find: '\t\t\t.map(sortStableIdLists)\n\t\t\t.sort(compareRecords)', replace: '\t\t\t.map(sortStableIdLists)' });
} });
detConjunctList[2].evaluate = (scenario, callback) => {
	scenarioLib.runScenario(scenario, (unusedError, forwardOutcome) => {
		if (forwardOutcome.runError) {
			callback('', { pass: false, detail: String(forwardOutcome.runError).slice(0, 200) });
			return;
		}
		const reversed = scenarioLib.cloneScenario(scenario);
		reversed.frameworkMutationList = scenario.frameworkMutationList.slice();
		wrapWalk(reversed, (walked) => ({ ...walked, assertionList: walked.assertionList.slice().reverse() }));
		scenarioLib.runScenario(reversed, (unusedReversedError, reversedOutcome) => {
			if (reversedOutcome.runError) {
				callback('', { pass: false, detail: String(reversedOutcome.runError).slice(0, 200) });
				return;
			}
			callback('', { pass: forwardOutcome.stores.decisionStore.rowList[0].frozenText === reversedOutcome.stores.decisionStore.rowList[0].frozenText, detail: `${forwardOutcome.runReport.decisionBlock.decisionBlockHash.slice(0, 12)} vs ${reversedOutcome.runReport.decisionBlock.decisionBlockHash.slice(0, 12)}` });
		});
	});
};
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-DET', conjunctId: 'c_reverseWalkOrderByteIdentical', twinName: 'freezeKeepsWalkOrder', fileName: DECISION_BLOCK_FILE, find: '\t\t\t.map(sortStableIdLists)\n\t\t\t.sort(compareRecords)', replace: '\t\t\t.map(sortStableIdLists)' });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-DET', conjunctId: 'a_noClockOrRandomToken', twinName: 'dateNowInFrameworkFile', leverKind: 'productionMutation', mutate: (scenario) => withScratchFrameworkCopy(scenario, (scratchDir) => { const filePath = path.join(scratchDir, 'census.js'); fs.writeFileSync(filePath, `${fs.readFileSync(filePath, 'utf8')}\nconst stampedAt = Date.now();\nvoid stampedAt;\n`); }) });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-DET', conjunctId: 'd_serialiserRefusesNaNUndefinedInfinity', twinName: 'serialiserAdmitsNaN', fileName: DECISION_BLOCK_FILE, find: "\tif (typeof value === 'number' && !Number.isFinite(value)) {\n\t\tthrow refuse.byName", replace: "\tif (false && typeof value === 'number' && !Number.isFinite(value)) {\n\t\tthrow refuse.byName" });

const gateDeclarationList = [
	{ gateId: 'BG-REPLAY', title: 'the block is the artifact; the graph is its replay', conjunctList: replayConjunctList },
	{ gateId: 'BG-CACHE', title: 'the judgment cache', conjunctList: cacheConjunctList },
	{ gateId: 'BG-JUDGE', title: 'the judge component', conjunctList: judgeConjunctList },
	{ gateId: 'BG-POOL-ORDER', title: 'the rendered pool order', conjunctList: poolOrderConjunctList },
	{ gateId: 'BG-DET', title: 'determinism', conjunctList: detConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-REPLAY+BG-CACHE+BG-JUDGE+BG-POOL-ORDER+BG-DET', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 9 + 7 + 9 + 3 + 4, expectedTwinCount: 9 + 7 + 9 + 3 + 4 },
	() => harness.report(),
);
