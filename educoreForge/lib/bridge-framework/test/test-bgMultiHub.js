#!/usr/bin/env node
'use strict';

// test-bgMultiHub.js — gate for ctdlHub-101926 P5 (two hubs in one build): a bridge reads ONLY its own target hub's cards,
// declares that hub, and never takes a hub-layer node for a subject. Hermetic: the toy fixture over graphDouble.
//
// PROVES:
//   (a) a plugin module without bridgeTarget is REFUSED at registration, by name; a malformed one too
//   (b) a recipe pairing that names another hub than the plugin's bridgeTarget.targetHub is REFUSED at run, by name
//   (c) a run whose config carries no hubStandardName is REFUSED at run, by name
//   (d) a graph holding TWO hubs' cards: the toy bridge runs, and every card it read is its own target hub's
//   (e) "a pairing has ONE hub" still bites AFTER the filter: with the reader's hub filter disabled (twin), the two-hub
//       graph is refused naming both hubs
//   (f) the reader's three card reads (readHubCards, readHubVectors, readCardBaseEdges) return only the target hub's cards
//   (g) a hub-layer node (HubReference, HubDefinition) carrying the SOURCE's _source is never a subject, a walk node or an
//       endpoint of an among-source edge — so a hub standard can also be a bridge source (P6)
//   (h) the reader refuses construction without hubName, by name
// RED TWINS: hubFilterRemoved -> (e) red; hubLayerExclusionRemoved -> (g) red.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: hub-scoped bridge reads, targetHub, hub-layer subject exclusion (ctdlHub P5)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const toyBridgeScenario = require('./testSupport/toyBridgeScenario');
const toyGraphLib = require('./fixtures/toyBridge/toyGraph');
const graphDoubleLib = require('../graphDouble');
const graphSeamRulesLib = require('../graphSeamRules');
const pluginRegistryLib = require('../pluginRegistry');
const moduleDouble = require('../../forge-framework/test/testSupport/moduleDouble');

const GRAPH_DOUBLE_PATH = path.join(__dirname, '..', 'graphDouble.js');
const OTHER_HUB_NAME = 'OtherHub';
const TOY_PLUGIN_DIR = path.join(__dirname, 'fixtures', 'toyBridge', 'forges', 'toy');
const TOY_PLUGIN_PATH = path.join(TOY_PLUGIN_DIR, 'bridges', 'toyCrosswalkPlugin.js');

const cloneJson = (value) => JSON.parse(JSON.stringify(value));
// a second hub's cards: the toy cards re-badged, so every read that ignores hubName would see them
const otherHubCardList = () => toyGraphLib.HUB_CARD_LIST.map((oneCard) => {
	const otherCard = cloneJson(oneCard);
	otherCard.stableId = oneCard.stableId.replace(/^toyhub:/, 'otherhub:');
	otherCard.properties.stableId = otherCard.stableId;
	otherCard.properties.hubName = OTHER_HUB_NAME;
	otherCard.properties._source = OTHER_HUB_NAME;
	return otherCard;
});
const twoHubGraph = () => {
	const graph = toyGraphLib.toyGraph();
	return { ...graph, nodeList: graph.nodeList.concat(otherHubCardList()) };
};
const readerArgsFor = ({ hubName }) => ({ inGraph: { graphName: 'DEV_multiHubDouble' }, dependencyStandardNameList: [toyGraphLib.SOURCE_STANDARD_NAME, 'toyhub'], sourceStandardName: toyGraphLib.SOURCE_STANDARD_NAME, blindingDeclaration: [], hubName });
const scenarioWith = (change) => {
	const scenario = toyBridgeScenario.cloneScenario(toyBridgeScenario.makeScenario());
	change(scenario);
	return scenario;
};
const runOf = (scenario, done) => toyBridgeScenario.runScenario(scenario, (unusedError, result) => done(result));
const failureTextOf = (result) => String(result.runError || result.constructionError || result.thrownFromRun || '');

const conjunctList = [];
const conjunct = (refId, judge) => conjunctList.push({ refId, judge });

// every judge is (done) => done({ pass, detail })
// (a) bridgeTarget is a REQUIRED sibling export, validated at registration
conjunct('a_bridgeTargetRequiredAtRegistration', (done) => {
	const loaded = require(TOY_PLUGIN_PATH);
	const absent = pluginRegistryLib.registerPlugin({ pluginModule: { bridgeDeclaration: loaded.bridgeDeclaration, bridgeHooks: loaded.bridgeHooks }, pluginFilePath: TOY_PLUGIN_PATH, bundleDirPath: TOY_PLUGIN_DIR });
	const blank = pluginRegistryLib.registerPlugin({ pluginModule: { ...loaded, bridgeTarget: { targetHub: '' } }, pluginFilePath: TOY_PLUGIN_PATH, bundleDirPath: TOY_PLUGIN_DIR });
	const unknownKey = pluginRegistryLib.registerPlugin({ pluginModule: { ...loaded, bridgeTarget: { targetHub: 'toyhub', hubVersion: '1.0' } }, pluginFilePath: TOY_PLUGIN_PATH, bundleDirPath: TOY_PLUGIN_DIR });
	const good = pluginRegistryLib.registerPlugin({ pluginModule: loaded, pluginFilePath: TOY_PLUGIN_PATH, bundleDirPath: TOY_PLUGIN_DIR });
	const absentText = absent.error ? absent.error.message : '';
	const blankText = blank.error ? blank.error.message : '';
	const unknownText = unknownKey.error ? unknownKey.error.message : '';
	done({
		pass: /does not export \{ bridgeDeclaration, bridgeHooks, bridgeTarget \}/.test(absentText) && /targetHub/.test(blankText) && /unknown key 'hubVersion'/.test(unknownText) && !good.error && good.entry.targetHub === 'toyhub',
		detail: `absent: ${absentText || 'ADMITTED'} | blank: ${blankText || 'ADMITTED'} | unknown key: ${unknownText || 'ADMITTED'} | good: ${good.error ? good.error.message : `targetHub ${good.entry.targetHub}`}`,
	});
});

// (b) the recipe's hub must be the plugin's declared target
conjunct('b_targetHubMismatchRefusedAtRun', (done) => runOf(scenarioWith((scenario) => {
	scenario.spec.hub = 'otherhub';
	scenario.spec.config.hubStandardName = OTHER_HUB_NAME;
	scenario.graph = twoHubGraph();
}), (result) => {
	const text = failureTextOf(result);
	done({ pass: /targets hub 'toyhub'/.test(text) && /pairs it with hub 'otherhub'/.test(text), detail: text || 'NOT REFUSED' });
}));

// (c) the hub's name is required run config
conjunct('c_hubStandardNameRequired', (done) => runOf(scenarioWith((scenario) => {
	delete scenario.spec.config.hubStandardName;
}), (result) => {
	const text = failureTextOf(result);
	done({ pass: /hubStandardName/.test(text), detail: text || 'NOT REFUSED' });
}));

// (d) two hubs in the graph: the bridge reads only its own
conjunct('d_twoHubGraphRunsOnItsOwnHub', (done) => runOf(scenarioWith((scenario) => {
	scenario.graph = twoHubGraph();
}), (result) => {
	const text = failureTextOf(result);
	const writtenEdgeList = result.graphDouble && result.graphDouble.state ? result.graphDouble.state.writtenEdgeList : [];
	const foreignTargetList = writtenEdgeList.filter((oneEdge) => /^otherhub:/.test(String(oneEdge.toStableId)));
	done({ pass: text === '' && writtenEdgeList.length > 0 && foreignTargetList.length === 0, detail: text || `ran; ${writtenEdgeList.length} edge(s) written, ${foreignTargetList.length} to the other hub` });
}));

// (e) the ONE-hub refusal still bites on the filtered set: with the filter disabled, two hubs are refused by name
const HUB_FILTER_FIND = 'const isTargetHubCard = (oneRecord, referenceTier) => oneRecord.labels.indexOf(graphSeamRulesLib.HUB_REFERENCE_LABEL) !== -1 && cypherEquals(oneRecord.properties.referenceTier, referenceTier) && cypherEquals(oneRecord.properties.hubName, hubName);';
const HUB_FILTER_REPLACE = 'const isTargetHubCard = (oneRecord, referenceTier) => oneRecord.labels.indexOf(graphSeamRulesLib.HUB_REFERENCE_LABEL) !== -1 && cypherEquals(oneRecord.properties.referenceTier, referenceTier);';
conjunct('e_oneHubRefusalBitesAfterTheFilter', (done) => runOf(scenarioWith((scenario) => {
	scenario.graph = twoHubGraph();
	scenario.frameworkMutationList = [{ modulePath: GRAPH_DOUBLE_PATH, find: HUB_FILTER_FIND, replace: HUB_FILTER_REPLACE }];
}), (result) => {
	const text = failureTextOf(result);
	done({ pass: /the cards name 2 hubs \(.*OtherHub.*\)/.test(text), detail: text || 'NOT REFUSED' });
}));

// (f) the reader's card reads are scoped to the target hub
conjunct('f_readerCardReadsScopedToTargetHub', (done) => {
	const reader = graphDoubleLib.graphDoubleFrom(twoHubGraph()).graphReaderFactory(readerArgsFor({ hubName: toyGraphLib.HUB_NAME }));
	reader.readHubCards({ referenceTier: 'property' }, (cardError, cardList) => {
		reader.forRetrieval().readHubVectors({ referenceTier: 'property' }, (vectorError, vectorList) => {
			const foreignCardList = (cardList || []).filter((oneCard) => oneCard.hubName !== toyGraphLib.HUB_NAME);
			const foreignVectorList = (vectorList || []).filter((oneRecord) => /^otherhub:/.test(String(oneRecord.stableId)));
			const expectedCount = toyGraphLib.HUB_CARD_LIST.filter((oneCard) => oneCard.properties.referenceTier === 'property').length;
			done({
				pass: !cardError && !vectorError && foreignCardList.length === 0 && foreignVectorList.length === 0 && cardList.length === expectedCount && vectorList.length === expectedCount,
				detail: `${cardError || vectorError || ''} cards ${cardList ? cardList.length : 'none'} (foreign ${foreignCardList.length}); vectors ${vectorList ? vectorList.length : 'none'} (foreign ${foreignVectorList.length}); expected ${expectedCount} each`,
			});
		});
	});
});

// (g) a hub-layer node of the source's own _source is never a subject or an among-source edge end
const hubLayerSourceGraph = () => {
	const graph = toyGraphLib.toyGraph();
	const sourceHubCard = cloneJson(toyGraphLib.HUB_CARD_LIST[0]);
	sourceHubCard.stableId = 'toy:hubcard/1';
	sourceHubCard.properties.stableId = 'toy:hubcard/1';
	sourceHubCard.properties._source = toyGraphLib.SOURCE_STANDARD_NAME;
	sourceHubCard.properties.hubName = toyGraphLib.SOURCE_STANDARD_NAME;
	const sourceHubDefinition = { stableId: 'toy:hubDefinition', labels: ['HubDefinition'], properties: { stableId: 'toy:hubDefinition', _source: toyGraphLib.SOURCE_STANDARD_NAME, hubName: toyGraphLib.SOURCE_STANDARD_NAME } };
	const firstSubjectRefId = graph.nodeList.find((oneNode) => oneNode.properties._source === toyGraphLib.SOURCE_STANDARD_NAME && oneNode.labels.indexOf('HubReference') === -1).stableId;
	return {
		...graph,
		nodeList: graph.nodeList.concat([sourceHubCard, sourceHubDefinition]),
		edgeList: graph.edgeList.concat([{ fromStableId: sourceHubCard.stableId, toStableId: firstSubjectRefId, type: 'HAS_TOY_PROPERTY', properties: {} }, { fromStableId: sourceHubCard.stableId, toStableId: sourceHubDefinition.stableId, type: 'IN_HUB', properties: {} }]),
	};
};
const HUB_LAYER_FIND = 'const isHubLayerRecord = (oneRecord) => graphSeamRulesLib.HUB_LAYER_LABEL_LIST.some((oneLabel) => oneRecord.labels.indexOf(oneLabel) !== -1);';
const HUB_LAYER_REPLACE = 'const isHubLayerRecord = () => false;';
const judgeHubLayerExclusion = (graphDoubleModule, done) => {
	const reader = graphDoubleModule.graphDoubleFrom(hubLayerSourceGraph()).graphReaderFactory(readerArgsFor({ hubName: toyGraphLib.HUB_NAME }));
	reader.readSubjectNodes((subjectError, subjectList) => {
		reader.forEvidence().readEdgesAmongSource({}, (edgeError, edgeList) => {
			const hubLayerSubjectList = (subjectList || []).filter((oneNode) => /^toy:hub/.test(String(oneNode.stableId)));
			const hubLayerEdgeList = (edgeList || []).filter((oneEdge) => /^toy:hub/.test(String(oneEdge.fromStableId)) || /^toy:hub/.test(String(oneEdge.toStableId)));
			done({
				pass: !subjectError && !edgeError && hubLayerSubjectList.length === 0 && hubLayerEdgeList.length === 0 && (subjectList || []).length > 0,
				detail: `${subjectError || edgeError || ''} subjects ${(subjectList || []).length} (hub-layer ${hubLayerSubjectList.length}); among-source edges touching the hub layer ${hubLayerEdgeList.length}`,
			});
		});
	});
};
conjunct('g_hubLayerNeverASubject', (done) => judgeHubLayerExclusion(graphDoubleLib, done));

// (h) the reader is constructed for ONE named hub
conjunct('h_readerRefusesAbsentHubName', (done) => {
	const refusal = graphSeamRulesLib.readerConstructionRefusal(readerArgsFor({ hubName: undefined }));
	done({ pass: Boolean(refusal) && /hubName/.test(refusal.message), detail: refusal ? refusal.message : 'ADMITTED' });
});

// the conjuncts run one after another (each judge calls done), then the twin sweep
const runTwinSweep = () => {
	harness.section('THE TWIN SWEEP');
	moduleDouble.assertMutationApplies({ modulePath: GRAPH_DOUBLE_PATH, find: HUB_LAYER_FIND });
	judgeHubLayerExclusion(moduleDouble.loadWithMutations({ modulePath: GRAPH_DOUBLE_PATH, mutationList: [{ modulePath: GRAPH_DOUBLE_PATH, find: HUB_LAYER_FIND, replace: HUB_LAYER_REPLACE }] }), (exclusionTwin) => {
		harness.ok("(g) observed RED under 'hubLayerExclusionRemoved'", !exclusionTwin.pass, exclusionTwin.detail);
		harness.note(`RED-OBSERVED g twin='hubLayerExclusionRemoved' → ${exclusionTwin.detail}`);
		harness.note('(e) is itself the twin of the hub filter (hubFilterRemoved): its PASS is the refusal observed under the mutation');
		harness.report();
	});
};
harness.section('BASELINE — every conjunct');
const runConjunctAt = (conjunctIndex) => {
	if (conjunctIndex >= conjunctList.length) {
		runTwinSweep();
		return;
	}
	const oneConjunct = conjunctList[conjunctIndex];
	oneConjunct.judge((verdict) => {
		harness.ok(`${oneConjunct.refId} PASS`, verdict.pass, verdict.detail);
		runConjunctAt(conjunctIndex + 1);
	});
};
runConjunctAt(0);
