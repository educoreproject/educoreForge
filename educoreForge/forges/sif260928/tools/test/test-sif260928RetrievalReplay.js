#!/usr/bin/env node
'use strict';

// test-sif260928RetrievalReplay.js — phase D2's hermetic gates for the retrieval-level instrument
// (forges/sif260928/tools/sifRetrievalReplayLib.js). The shipped SIF plugin runs, unmodified, through the REAL
// bridge framework on the graph-double path (toyBridgeScenario, toyEmbedTextBoltGraph, graphDouble) under the debug
// judge; the instrument then reads the SAME graph through the double's retrieval view and replays the search.
// No Docker, no network, no spend. Every conjunct is observed RED under its own twin (gateSuiteRunner).
//
//   D2-REPLAY  (b-control) the replay at the plugin's settings with nothing excluded reproduces every record's ORDERED
//                  retrievalVoteList from the framework's own block, byte for byte in canonical text.
//              (b-twin) excluding the texts whose propertyNameList is exactly ['contextText'] drops exactly the one
//                  context text, and the card only it reached leaves the model question's pool.
//   D2-RULE    (c) the selection rule: the highest admission wins among cells whose median pool is at most the
//                  limit; a tie goes to the smaller hitsPerText.
//
// Run: PATH=/usr/local/bin:$PATH node forges/sif260928/tools/test/test-sif260928RetrievalReplay.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase D2 gates: the retrieval replay reproduces the framework's vote lists, the context-text exclusion bites, and the selection rule chooses as written

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const TOOLS_DIR = path.join(__dirname, '..');
const BUNDLE_DIR = path.join(TOOLS_DIR, '..');
const TREE_ROOT = path.join(BUNDLE_DIR, '..', '..');
const FRAMEWORK_TEST_DIR = path.join(TREE_ROOT, 'lib', 'bridge-framework', 'test');
const REPLAY_LIB_PATH = path.join(TOOLS_DIR, 'sifRetrievalReplayLib.js');
const scenarioLib = require(path.join(FRAMEWORK_TEST_DIR, 'testSupport', 'toyBridgeScenario'));
const toyEmbedTextBoltGraphLib = require(path.join(FRAMEWORK_TEST_DIR, 'testSupport', 'toyEmbedTextBoltGraph'));
const { scenarioTwin, blockOf, refusalTextOf } = require(path.join(FRAMEWORK_TEST_DIR, 'testSupport', 'bridgeTwinFactories'));
const { runGateFamily } = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const moduleDouble = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { graphDoubleFrom } = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'graphDouble'));
const { DME_ROLES, EDGE_TYPES, EMBED_TEXT_VECTOR } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));

const twinRegistry = makeTwinRegistry();
const cloneJson = scenarioLib.cloneJson;

const PLUGIN_NAME = 'sif260928CedsDerivedPlugin';
const STANDARD_KEY = 'sif260928';
const SOURCE_STANDARD_NAME = 'SIF260928';
const SOURCE_VERSION = '4.3';
const HUB_NAME = toyEmbedTextBoltGraphLib.HUB_NAME;
const SHIPPED_BRIDGES_DIR = path.join(BUNDLE_DIR, 'bridges');
const shippedDeclaration = () => cloneJson(require(path.join(SHIPPED_BRIDGES_DIR, `${PLUGIN_NAME}.js`)).bridgeDeclaration);
const DECLARED_RETRIEVAL = shippedDeclaration().candidateRetrieval;

// THE TOY: two SIF questions on the framework's toy hub. The model question has a name text and a CONTEXT text; the
// context text alone reaches the hub's location property (cosine 0.8), so excluding it must take that card out.
const MODEL_QUESTION = 'sif260928:question/toyModelLocalId';
const METADATA_QUESTION = 'sif260928:question/toyMetadataTimeElementType';
const FIELD_LIST = Object.freeze([
	{ stableId: 'sif260928:field//StudentPersonals/StudentPersonal/LocalId', objectName: 'StudentPersonal', questionStableId: MODEL_QUESTION, sharedBlock: 'model' },
	{ stableId: 'sif260928:field//StaffPersonals/StaffPersonal/LocalId', objectName: 'StaffPersonal', questionStableId: MODEL_QUESTION, sharedBlock: 'model' },
	{ stableId: 'sif260928:field//StudentPersonals/StudentPersonal/SIF_Metadata/TimeElements/TimeElement/Type', objectName: 'StudentPersonal', questionStableId: METADATA_QUESTION, sharedBlock: 'SIF_Metadata' },
]);
const CONTEXT_ONLY_CARD = 'toyhub:card/P000008.C3';
const CARD_VECTOR_BY_CARD_STABLE_ID = Object.freeze({
	'toyhub:card/P000001.C1': [1, 0, 0, 0],
	'toyhub:card/P000002.C1': [0.2, 1, 0, 0],
	'toyhub:card/P000002.C2': [0, 1, 0, 0.3],
	[CONTEXT_ONLY_CARD]: [0, 0, 0.2, 1],
});
const HUB_TEXT_LIST = Object.freeze([
	{ textName: 'hIdentifier', vector: [1, 0, 0, 0], describedStableId: 'toyhub:property/P000001' },
	{ textName: 'hTimePeriod', vector: [0, 1, 0, 0], describedStableId: 'toyhub:property/P000002' },
	{ textName: 'hLocation', vector: [0, 0, 0, 1], describedStableId: 'toyhub:property/P000008' },
]);
// a one-name propertyNameList is stored as a scalar, as the loader stores it; the reader re-widens it
const SUBJECT_TEXT_LIST = Object.freeze([
	{ textName: 'localIdName', vector: [0.9, 0.1, 0, 0], describedStableId: MODEL_QUESTION, propertyNameList: 'name' },
	{ textName: 'localIdContext', vector: [0.6, 0, 0, 0.8], describedStableId: MODEL_QUESTION, propertyNameList: 'contextText' },
	{ textName: 'timeElementTypeDescription', vector: [0.1, 0.9, 0, 0], describedStableId: METADATA_QUESTION, propertyNameList: 'description' },
]);
const CONTEXT_TEXT_STABLE_ID = 'sif260928:root/embedText/localIdContext';

const textNode = ({ stableId, standardName, vector }) => ({
	stableId,
	labels: ['ForgedNode', `${standardName}EmbedText`, DME_ROLES.EMBED_TEXT],
	properties: { stableId, text: `toy text ${stableId}`, role: DME_ROLES.EMBED_TEXT, _source: standardName, [EMBED_TEXT_VECTOR.propertyName]: vector.slice(), embeddingModelVersion: DECLARED_RETRIEVAL.embeddingModelVersion, embedSourceProperty: 'text', vectorPropertyName: EMBED_TEXT_VECTOR.propertyName },
});
// ⟪campaign P3⟫ propertyNameList is declared list-valued (W-A-1): replay stores it as a list at any length and the read
// boundary refuses a scalar, so the double writes the one name as a one-element list
const textEdge = ({ textStableId, describedStableId, propertyNameList }) => ({ fromStableId: textStableId, toStableId: describedStableId, type: EDGE_TYPES.EMBEDS_TEXT_OF, properties: { propertyNameList: [propertyNameList], provenanceTier: 'structural' } });
const questionNode = ({ stableId, name, relativePath, sharedBlock, objectNameList }) => ({
	stableId,
	labels: ['Sif260928Question'],
	properties: { stableId, name, description: `The ${name} of the toy.`, role: DME_ROLES.PROPERTY, _source: SOURCE_STANDARD_NAME, relativePath, contextText: relativePath, sharedBlock, instanceCount: objectNameList.length, objectNameList, objectNameSampleList: objectNameList },
});

const replayGraph = () => {
	const baseGraph = toyEmbedTextBoltGraphLib.embedTextBoltGraph();
	const nodeList = baseGraph.nodeList
		.filter((oneNode) => oneNode.properties.role !== DME_ROLES.EMBED_TEXT)
		.map((oneNode) => {
			const properties = { ...oneNode.properties };
			if (CARD_VECTOR_BY_CARD_STABLE_ID[oneNode.stableId] !== undefined) {
				properties.embedding = CARD_VECTOR_BY_CARD_STABLE_ID[oneNode.stableId].slice();
			}
			if (properties.embedding !== undefined) {
				properties.embeddingModelVersion = DECLARED_RETRIEVAL.embeddingModelVersion;
			}
			return { ...oneNode, properties };
		})
		.concat([
			questionNode({ stableId: MODEL_QUESTION, name: 'LocalId', relativePath: 'LocalId', sharedBlock: 'model', objectNameList: ['StaffPersonal', 'StudentPersonal'] }),
			questionNode({ stableId: METADATA_QUESTION, name: 'Type', relativePath: 'SIF_Metadata/TimeElements/TimeElement/Type', sharedBlock: 'SIF_Metadata', objectNameList: ['StudentPersonal'] }),
		])
		.concat(FIELD_LIST.map((oneField) => ({ stableId: oneField.stableId, labels: ['Sif260928Field'], properties: { stableId: oneField.stableId, name: oneField.stableId.split('/').pop(), role: DME_ROLES.SUPPORT, _source: SOURCE_STANDARD_NAME, objectName: oneField.objectName, sharedBlock: oneField.sharedBlock } })));
	const edgeList = baseGraph.edgeList
		.filter((oneEdge) => oneEdge.type !== EDGE_TYPES.EMBEDS_TEXT_OF)
		.concat(FIELD_LIST.map((oneField) => ({ fromStableId: oneField.questionStableId, toStableId: oneField.stableId, type: EDGE_TYPES.HAS_INSTANCE, properties: { provenanceTier: 'structural' } })));
	HUB_TEXT_LIST.forEach((oneText) => {
		const textStableId = `toyhub:root/embedText/${oneText.textName}`;
		nodeList.push(textNode({ stableId: textStableId, standardName: HUB_NAME, vector: oneText.vector }));
		edgeList.push(textEdge({ textStableId, describedStableId: oneText.describedStableId, propertyNameList: 'name' }));
	});
	SUBJECT_TEXT_LIST.forEach((oneText) => {
		const textStableId = `sif260928:root/embedText/${oneText.textName}`;
		nodeList.push(textNode({ stableId: textStableId, standardName: SOURCE_STANDARD_NAME, vector: oneText.vector }));
		edgeList.push(textEdge({ textStableId, describedStableId: oneText.describedStableId, propertyNameList: oneText.propertyNameList }));
	});
	return { nodeList, edgeList };
};

// the scratch forges tree: the harness's toy bundles plus a COPY of the shipped sif260928 bridges/ folder
const copyDirectory = (fromDir, toDir) => {
	fs.mkdirSync(toDir, { recursive: true });
	fs.readdirSync(fromDir, { withFileTypes: true }).forEach((oneEntry) => (oneEntry.isDirectory() ? copyDirectory(path.join(fromDir, oneEntry.name), path.join(toDir, oneEntry.name)) : fs.copyFileSync(path.join(fromDir, oneEntry.name), path.join(toDir, oneEntry.name))));
};
const TOY_SCOPE_STABLE_ID_LIST = Object.freeze([MODEL_QUESTION, METADATA_QUESTION]);
const writeToyScopeList = (forgesDirPath) => {
	const { scopeStableIdListPath } = shippedDeclaration().subjectSource;
	if (typeof scopeStableIdListPath !== 'string' || path.isAbsolute(scopeStableIdListPath)) {
		throw new Error(`${moduleName}: the shipped plugin's subjectSource.scopeStableIdListPath is ${JSON.stringify(scopeStableIdListPath)} — this double writes a RELATIVE scope list beside the plugin and cannot stand in for anything else`);
	}
	fs.writeFileSync(path.join(forgesDirPath, STANDARD_KEY, scopeStableIdListPath), JSON.stringify(TOY_SCOPE_STABLE_ID_LIST, null, 1));
};
const replayShape = (scenario) => {
	scenario.forgesDirOverride = scenarioLib.makeScratchForgesCopy();
	copyDirectory(SHIPPED_BRIDGES_DIR, path.join(scenario.forgesDirOverride, STANDARD_KEY, 'bridges'));
	// ⟪campaign P4a⟫ the shipped plugin declares an evaluation scope (subjectSource.scopeStableIdListPath, since goldJev A
	// 51d14f7): 5,017 real Question stableIds, which this two-Question toy graph cannot hold, so the framework rightly
	// refused. The double writes ITS OWN scope list — the toy's two Questions — at the path the shipped declaration names.
	writeToyScopeList(scenario.forgesDirOverride);
	scenario.graph = replayGraph();
	scenario.graphEdit(scenario.graph);
	scenario.judgeRule = 'first';
	scenario.spec.bridge = PLUGIN_NAME;
	scenario.spec.source = STANDARD_KEY;
	scenario.spec.config = { ...scenario.spec.config, sourceStandard: STANDARD_KEY, sourceStandardName: SOURCE_STANDARD_NAME, sourceVersion: SOURCE_VERSION, familyStandards: [STANDARD_KEY] };
};

// the subject: the framework scenario plus the instrument's own mutation list and graph edit (a twin writes either)
const makeSubject = () => ({ ...scenarioLib.makeScenario(), replayMutationList: [], graphEdit: () => {} });
const cloneSubject = (subject) => ({ ...scenarioLib.cloneScenario(subject), replayMutationList: subject.replayMutationList.slice(), graphEdit: subject.graphEdit });
const replayLibOf = (subject) => (subject.replayMutationList.length === 0 ? require(REPLAY_LIB_PATH) : moduleDouble.loadWithMutations({ modulePath: REPLAY_LIB_PATH, mutationList: subject.replayMutationList }));

// replayOver — the instrument over the scenario's graph through the double's retrieval view, as the CLI does over bolt
const replayOver = ({ subject, retrievalSettings, excludedPropertyNameListList }, callback) => {
	const replayLib = replayLibOf(subject);
	const reader = graphDoubleFrom(cloneJson(subject.graph)).graphReaderFactory({ inGraph: {}, dependencyStandardNameList: [SOURCE_STANDARD_NAME, HUB_NAME], sourceStandardName: SOURCE_STANDARD_NAME, blindingDeclaration: shippedDeclaration().blindingDeclaration });
	replayLib.readRetrievalInputs({ retrievalView: reader.forRetrieval(), sourceStandardName: SOURCE_STANDARD_NAME, hubStandardName: HUB_NAME }, (readError, retrievalInputs) => {
		if (readError) {
			callback(readError);
			return;
		}
		const built = replayLib.makeReplayIndex({ retrievalInputs, embeddingModelVersion: DECLARED_RETRIEVAL.embeddingModelVersion, hubName: HUB_NAME });
		if (built.error) {
			callback(built.error.message);
			return;
		}
		const replayed = replayLib.replayVoteLists({ replayIndex: built.replayIndex, retrievalSettings, subjectStableIdList: [MODEL_QUESTION, METADATA_QUESTION], excludedPropertyNameListList });
		callback(replayed.error ? replayed.error.message : '', { replayLib, replayed });
	});
};

// ---------------------------------------------------------------------
// D2-REPLAY
// ---------------------------------------------------------------------
const replayConjunctList = [
	{
		conjunctId: 'bControl_replayReproducesTheBlockVoteLists',
		title: "(b) the control: at the plugin's declared settings with nothing excluded, the replay reproduces every record's ORDERED retrievalVoteList from the framework's own block (canonical text), including a list of more than one card",
		twinNameList: ['pathEdgeTypeNotProjected'],
		evaluate: (subject, callback) => {
			replayShape(subject);
			scenarioLib.runScenario(subject, (unusedError, outcome) => {
				const decisionBlock = blockOf(outcome);
				if (decisionBlock === null) {
					callback('', { pass: false, detail: `the framework run froze no block: ${refusalTextOf(outcome).slice(0, 300)}` });
					return;
				}
				replayOver({ subject, retrievalSettings: DECLARED_RETRIEVAL, excludedPropertyNameListList: [] }, (replayError, replayResult) => {
					if (replayError) {
						callback('', { pass: false, detail: `the replay refused: ${replayError.slice(0, 300)}` });
						return;
					}
					const compared = replayResult.replayLib.compareWithBlock({ decisionBlock, voteListBySubjectStableId: replayResult.replayed.voteListBySubjectStableId });
					const longestListLength = Math.max(...decisionBlock.decisionRecordList.map((oneRecord) => oneRecord.retrievalVoteList.length));
					const pass = compared.comparedRecordCount === 3 && compared.differingRecordList.length === 0 && longestListLength > 1;
					callback('', { pass, detail: `${compared.comparedRecordCount} record(s) compared, ${compared.differingRecordList.length} differing, longest list ${longestListLength}${compared.differingRecordList.length > 0 ? `: ${JSON.stringify(compared.differingRecordList[0]).slice(0, 240)}` : ''}` });
				});
			});
		},
	},
	{
		conjunctId: 'bTwin_contextTextExclusionBites',
		title: "(b) the twin's exclusion: dropping texts whose propertyNameList is exactly ['contextText'] drops exactly one text record, takes the context-only card out of the model question's pool, and leaves the metadata question's list unchanged",
		twinNameList: ['contextTextSharedWithName'],
		evaluate: (subject, callback) => {
			subject.graph = replayGraph();
			subject.graphEdit(subject.graph);
			replayOver({ subject, retrievalSettings: DECLARED_RETRIEVAL, excludedPropertyNameListList: [] }, (fullError, fullResult) => {
				replayOver({ subject, retrievalSettings: DECLARED_RETRIEVAL, excludedPropertyNameListList: [['contextText']] }, (twinError, twinResult) => {
					if (fullError || twinError) {
						callback('', { pass: false, detail: `the replay refused: ${fullError || twinError}` });
						return;
					}
					const cardListOf = (replayResult, subjectStableId) => replayResult.replayed.voteListBySubjectStableId[subjectStableId].map((oneEntry) => oneEntry.stableId);
					const fullModelCardList = cardListOf(fullResult, MODEL_QUESTION);
					const twinModelCardList = cardListOf(twinResult, MODEL_QUESTION);
					const metadataUnchanged = JSON.stringify(cardListOf(fullResult, METADATA_QUESTION)) === JSON.stringify(cardListOf(twinResult, METADATA_QUESTION));
					const pass = twinResult.replayed.excludedTextRecordCount === 1 && fullModelCardList.indexOf(CONTEXT_ONLY_CARD) !== -1 && twinModelCardList.indexOf(CONTEXT_ONLY_CARD) === -1 && metadataUnchanged;
					callback('', { pass, detail: `excluded ${twinResult.replayed.excludedTextRecordCount} text record(s); model pool ${JSON.stringify(fullModelCardList)} -> ${JSON.stringify(twinModelCardList)}; metadata unchanged ${metadataUnchanged}` });
				});
			});
		},
	},
];
moduleDouble.assertMutationApplies({ modulePath: REPLAY_LIB_PATH, find: 'edgeType: hubEdgeType(hubName, HUB_SLOT_BY_SLOT_KIND[onePath.slotKind])' });
scenarioTwin({ registry: twinRegistry, gateId: 'D2-REPLAY', conjunctId: 'bControl_replayReproducesTheBlockVoteLists', twinName: 'pathEdgeTypeNotProjected', leverKind: 'productionMutation', mutate: (subject) => subject.replayMutationList.push({ modulePath: REPLAY_LIB_PATH, find: 'edgeType: hubEdgeType(hubName, HUB_SLOT_BY_SLOT_KIND[onePath.slotKind])', replace: 'edgeType: onePath.slotKind' }) });
// the context text also serves the name: its propertyNameList is no longer EXACTLY ['contextText'], so it must stay
scenarioTwin({ registry: twinRegistry, gateId: 'D2-REPLAY', conjunctId: 'bTwin_contextTextExclusionBites', twinName: 'contextTextSharedWithName', leverKind: 'inputFault', mutate: (subject) => {
	subject.graphEdit = (graph) => {
		graph.edgeList.find((oneEdge) => oneEdge.fromStableId === CONTEXT_TEXT_STABLE_ID).properties.propertyNameList = ['contextText', 'name'];
	};
} });

// ---------------------------------------------------------------------
// D2-RULE — the selection rule, over hand-made cell results
// ---------------------------------------------------------------------
const cellResultOf = ({ cellName, hitsPerText, minScore, k, admittedUnitCount, medianPoolSize }) => ({ cell: { cellName, hitsPerText, minScore, k }, admission: { overall: { admittedUnitCount, specifiedUnitCount: 100 }, pool: { medianPoolSize } } });
// cell w is the most admissions but ineligible (median 45); u and v tie at 90 and v has the smaller hitsPerText
const RULE_CELL_RESULT_LIST = Object.freeze([
	cellResultOf({ cellName: 'u', hitsPerText: 40, minScore: 0.3, k: 40, admittedUnitCount: 90, medianPoolSize: 30 }),
	cellResultOf({ cellName: 'v', hitsPerText: 20, minScore: 0.3, k: 40, admittedUnitCount: 90, medianPoolSize: 25 }),
	cellResultOf({ cellName: 'w', hitsPerText: 40, minScore: 0.3, k: 60, admittedUnitCount: 95, medianPoolSize: 45 }),
	cellResultOf({ cellName: 'x', hitsPerText: 20, minScore: 0.3, k: 20, admittedUnitCount: 80, medianPoolSize: 20 }),
]);
const ruleConjunctList = [
	{
		conjunctId: 'c_ruleChoosesAsWritten',
		title: '(c) the rule: w (most admissions, median pool 45) is ineligible at a limit of 40; u and v tie at 90, and v wins on the smaller hitsPerText',
		twinNameList: ['tieGoesToLargerHitsPerText'],
		evaluate: (subject, callback) => {
			const chosen = replayLibOf(subject).chooseCell({ cellResultList: cloneJson(RULE_CELL_RESULT_LIST), poolMedianLimit: 40 });
			const pass = !chosen.error && chosen.chosenCellName === 'v' && JSON.stringify(chosen.ruleTrace.ineligibleCellNameList) === JSON.stringify(['w']);
			callback('', { pass, detail: chosen.error ? chosen.error.message : `chose ${chosen.chosenCellName}; ineligible ${JSON.stringify(chosen.ruleTrace.ineligibleCellNameList)}` });
		},
	},
];
moduleDouble.assertMutationApplies({ modulePath: REPLAY_LIB_PATH, find: 'leftResult.cell.hitsPerText - rightResult.cell.hitsPerText' });
scenarioTwin({ registry: twinRegistry, gateId: 'D2-RULE', conjunctId: 'c_ruleChoosesAsWritten', twinName: 'tieGoesToLargerHitsPerText', leverKind: 'productionMutation', mutate: (subject) => subject.replayMutationList.push({ modulePath: REPLAY_LIB_PATH, find: 'leftResult.cell.hitsPerText - rightResult.cell.hitsPerText', replace: 'rightResult.cell.hitsPerText - leftResult.cell.hitsPerText' }) });

const gateDeclarationList = [
	{ gateId: 'D2-REPLAY', title: "the retrieval replay reproduces the framework's frozen vote lists, and its context-text exclusion removes exactly what the ruling names", conjunctList: replayConjunctList },
	{ gateId: 'D2-RULE', title: 'the selection rule committed to DEVLOG-D2 chooses as written', conjunctList: ruleConjunctList },
];

runGateFamily({ harness, familyName: 'D2-REPLAY+D2-RULE', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 3 }, () => harness.report());
