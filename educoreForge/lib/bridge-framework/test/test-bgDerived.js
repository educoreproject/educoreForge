#!/usr/bin/env node
'use strict';

// test-bgDerived.js — the DERIVED families (PLAN-derivedBridge-v1.md §8; RULINGS §11.3, §11.4, §11.9,
// §11.10, §11.12). Every conjunct runs hermetically over the toy graph through toyDerivedPlugin under the
// DEBUG judge: no container, no network, no Opus, no spend.
//
//   BG-RETRIEVAL       (a) every pool is ≤ K; (b) every seat's cosine is ≥ the declared floor; (c) the pool
//                      reaches the judge in stableId order — the retrieval RANK never survives into the
//                      rendered text; (d) no rendered prompt contains a cosine or a rank; (e) a floor above
//                      the achievable maximum EMPTIES every pool and yields orphan(noCandidate) rather than
//                      an error, and the renderer is never called on an empty pool.
//   BG-BLIND-DERIVED   (a) POSITIVE — every property line of every rendered prompt names an ALLOW-LISTED
//                      property and nothing else; (b) NEGATIVE — the id-gate regex sweep over every prompt is
//                      at ZERO; (c) an allow-list naming a NEVER property is refused at declaration time.
//   BG-DERIVED-CENSUS  judged + orphan == subjectCount per subject, and `abstained` is a per-TARGET member
//                      inside a judged subject — never a subject bucket (RULING BF8 stands, §11.10).
//   BG-NOCROSSWALK     the derived producer declares no channel, opens no document, and its run reports an
//                      EMPTY sourceChannelDigestByKey — it cannot have read the authored crosswalk because it
//                      never opened a file at all.
//   BG-PARTIAL         a block frozen from a --limit WINDOW refuses to materialise under a run that is not
//                      carrying the same window (§11.12) — ten edges must never ship as a graph.
//
// Run: node lib/bridge-framework/test/test-bgDerived.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-RETRIEVAL + BG-BLIND-DERIVED + BG-DERIVED-CENSUS + BG-NOCROSSWALK + BG-PARTIAL

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, pureConjunct, succeeded, refusalCase, refusalTextOf, frameworkMutationTwin, scenarioTwin, forensicsOf, blockOf, edgesOf } = require('./testSupport/bridgeTwinFactories');
const graphSeamRulesLib = require('../graphSeamRules');
const decisionBlockLib = require('../decisionBlock');
const toyEmbedTextBoltGraphLib = require('./testSupport/toyEmbedTextBoltGraph');
const vocabularyLib = require(path.join(__dirname, '..', '..', 'vocabulary', 'vocabulary'));
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const RETRIEVAL_FILE = 'candidateRetrieval.js';
const RENDERER_FILE = 'evidenceRenderer.js';
const FRAMEWORK_FILE = 'bridge-framework.js';
const CONTRACT_FILE = 'bridgePluginContract.js';
const TOY_EMBED_MODEL = 'toy-embed-v1';
const cloneJson = scenarioLib.cloneJson;

// derivedShape — every conjunct in this file starts here. The toy graph carries embeddings but no
// embeddingModelVersion, and candidateRetrieval REFUSES a record whose model is not the declared one, so the
// declared model is stamped onto every vector-bearing node. That is a SCENARIO edit, not a fixture edit: the
// shared toyGraph is left alone so the other eleven families keep the inputs they were frozen against.
const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};

const overrideDerivedDeclaration = (scenario, mutate) => {
	const loaded = require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`));
	const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
	mutate(bridgeDeclaration);
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = { ...(scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] || {}), bridgeDeclaration };
};

const declaredRetrievalOf = () => require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`)).bridgeDeclaration.candidateRetrieval;
const declaredAllowListOf = () => require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`)).bridgeDeclaration.renderingAllowList;

const promptListOf = (outcome) => forensicsOf(outcome).filter((oneRecord) => oneRecord.record && typeof oneRecord.record.userPrompt === 'string').map((oneRecord) => oneRecord.record.userPrompt);
const judgedRecordListOf = (outcome) => {
	const block = blockOf(outcome);
	return block && Array.isArray(block.decisionRecordList) ? block.decisionRecordList : [];
};

// THE ID GATE (§4 as amended by RULING §11.4). The pattern list is NOT defined here: it is required FROM the
// rendering-audit generator, which is the document a human signs. Two copies of this list would be two
// different audits wearing one name — the gate could pass while the document swept for something else.
const { ID_GATE_PATTERN_LIST } = require(path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'test', 'bridgeAcceptance', 'renderingAudit'));
const idGateHitList = (promptList) =>
	ID_GATE_PATTERN_LIST.reduce(
		(soFar, onePattern) => soFar.concat(promptList.filter((onePrompt) => onePattern.regex.test(onePrompt)).map((onePrompt) => `${onePattern.patternName}: ${onePrompt.slice(0, 60)}`)),
		[],
	);
// renderedPropertyNameList — the property names actually printed in a prompt's indented "name: value" lines
const renderedPropertyNameList = (onePrompt) =>
	onePrompt
		.split('\n')
		.map((oneLine) => /^\s+([A-Za-z_][A-Za-z0-9_]*):/.exec(oneLine))
		.filter((oneMatch) => oneMatch !== null)
		.map((oneMatch) => oneMatch[1]);

// ---------------------------------------------------------------------
// THE EMBED-TEXT SCENARIO (B4) — the derived toy run under candidateRetrieval.method 'embedTextVote-v1' with
// neighbourVote-v1. Built on B3b's toyEmbedTextBoltGraph (the toy graph plus the hub's class, property and option-set
// base nodes and every property-tier card's slot edges, R-BR-9 / R-BR-13), with its TEXT LAYER REPLACED by one designed
// for these conjuncts:
//   every subject carries a text ...................... cardTextCosineFor refuses a subject with none (R-BR-14)
//   a text shared by several subjects ................. the construct default texts (one text node, many edges)
//   owners carry texts ................................ the three constructs, so owner votes can land
//   a subject with a referenced object ................ Course.Level -REFERENCES-> School
//   card vectors that differ .......................... so cardTextCosine separates cards
//   a hub text outside the search population .......... hOptionValue describes an OPTION VALUE (R-BR-9)
// Four named axes: 0 name · 1 birth date · 2 course · 3 organization. A SCENARIO edit, never a fixture edit: the shared
// toy graph and B3b's bolt graph stay exactly as every other family froze them.
// ---------------------------------------------------------------------
const { DME_ROLES, EDGE_TYPES, EMBED_TEXT_VECTOR } = vocabularyLib;
const EMBED_TEXT_HUB_NAME = toyEmbedTextBoltGraphLib.HUB_NAME;
const EMBED_TEXT_SOURCE_STANDARD_NAME = toyEmbedTextBoltGraphLib.SOURCE_STANDARD_NAME;
const SUBJECT_LABEL = 'ToyProperty';
const OWNER_PROPERTY_NAME = 'parentId';
const EMBED_TEXT_RETRIEVAL = Object.freeze({
	method: 'embedTextVote-v1',
	hitsPerText: 3,
	minScore: 0.3,
	k: 4,
	embeddingModelVersion: TOY_EMBED_MODEL,
	neighbourVote: { method: 'neighbourVote-v1', owner: { kind: 'propertyValue', property: OWNER_PROPERTY_NAME }, siblings: { kind: 'sameOwner' }, referencedObject: { kind: 'edgeTarget', edgeTypeList: [EDGE_TYPES.REFERENCES] }, earnRule: 'topShare' },
});
const CARD_VECTOR_BY_CARD_STABLE_ID = Object.freeze({
	'toyhub:card/P000001.C1': [1, 0, 0, 0],
	'toyhub:card/P000002.C1': [0.2, 1, 0, 0],
	'toyhub:card/P000002.C2': [0, 1, 0, 0.3],
	'toyhub:card/P000003.C1': [0.5, 0, 0, 0.5],
	'toyhub:card/P000005.C1': [0.7, 0, 0, 0.7],
	'toyhub:card/P000005.C1.OV0001': [0.6, 0, 0, 0.8],
	'toyhub:card/P000006.C1': [0, 0, 1, 0],
	'toyhub:card/P000008.C3': [0, 0, 0.2, 1],
	'toyhub:card/P000010.C1': [0, 0.3, 1, 0],
});
const HUB_TEXT_LIST = Object.freeze([
	{ textName: 'hName', vector: [1, 0, 0, 0], describedStableIdList: ['toyhub:property/P000001', 'toyhub:property/P000005'] },
	{ textName: 'hBirthDate', vector: [0, 1, 0, 0], describedStableIdList: ['toyhub:property/P000002'] },
	{ textName: 'hCourse', vector: [0, 0, 1, 0], describedStableIdList: ['toyhub:property/P000006', 'toyhub:property/P000010'] },
	{ textName: 'hLearnerClass', vector: [0.6, 0.8, 0, 0], describedStableIdList: ['toyhub:class/C1'] },
	{ textName: 'hOrganization', vector: [0, 0, 0, 1], describedStableIdList: ['toyhub:class/C3', 'toyhub:property/P000008'] },
	{ textName: 'hEthnicity', vector: [0.7, 0, 0, 0.7], describedStableIdList: ['toyhub:optionSet/Ethnicity', 'toyhub:property/P000003'] },
	{ textName: 'hOptionValue', vector: [1, 0, 0, 0], describedStableIdList: ['toyhub:optionValue/OV0001'] },
]);
// a subject's own text: its override when it has one, else the ONE default text its construct's subjects share
const SUBJECT_TEXT_VECTOR_BY_STABLE_ID = Object.freeze({
	'toy:property/Student.FirstName': [0.9, 0.1, 0, 0],
	'toy:property/Student.BirthDate': [0.1, 0.9, 0, 0],
	'toy:property/Student.Ethnicity': [0.6, 0, 0, 0.6],
	'toy:property/School.Name': [0.7, 0, 0, 0.6],
	'toy:property/School.Address': [0, 0, 0.1, 1],
	'toy:property/Course.Title': [0, 0, 1, 0],
	'toy:property/Course.Credits': [0, 0.2, 0.9, 0],
});
const DEFAULT_SUBJECT_TEXT_VECTOR_BY_CONSTRUCT_NAME = Object.freeze({ Student: [0.6, 0.6, 0, 0], School: [0.1, 0, 0, 1], Course: [0, 0.1, 1, 0.1] });
const OWNER_TEXT_VECTOR_BY_STABLE_ID = Object.freeze({ 'toy:construct/Student': [0.6, 0.8, 0, 0], 'toy:construct/School': [0, 0, 0, 1], 'toy:construct/Course': [0, 0, 1, 0] });
const REFERENCE_EDGE_LIST = Object.freeze([{ fromStableId: 'toy:property/Course.Level', toStableId: 'toy:construct/School' }]);

const embedTextNode = ({ stableId, standardName, vector }) => ({
	stableId,
	labels: ['ForgedNode', 'ToyEmbedText', DME_ROLES.EMBED_TEXT],
	properties: { stableId, text: `toy text ${stableId}`, role: DME_ROLES.EMBED_TEXT, _source: standardName, [EMBED_TEXT_VECTOR.propertyName]: vector.slice(), embeddingModelVersion: TOY_EMBED_MODEL, embedSourceProperty: 'text', vectorPropertyName: EMBED_TEXT_VECTOR.propertyName },
});
// the loader stores a one-element propertyNameList as a SCALAR (R-BR-1a ii); the toy does the same
const embedTextEdge = ({ textStableId, describedStableId }) => ({ fromStableId: textStableId, toStableId: describedStableId, type: EDGE_TYPES.EMBEDS_TEXT_OF, properties: { propertyNameList: 'description', provenanceTier: 'structural' } });

const embedTextGraph = () => {
	const baseGraph = toyEmbedTextBoltGraphLib.embedTextBoltGraph();
	const nodeList = baseGraph.nodeList
		.filter((oneNode) => oneNode.properties.role !== DME_ROLES.EMBED_TEXT)
		.map((oneNode) => {
			const properties = { ...oneNode.properties };
			if (CARD_VECTOR_BY_CARD_STABLE_ID[oneNode.stableId] !== undefined) {
				properties.embedding = CARD_VECTOR_BY_CARD_STABLE_ID[oneNode.stableId].slice();
			}
			if (properties.embedding !== undefined) {
				properties.embeddingModelVersion = TOY_EMBED_MODEL;
			}
			if (oneNode.labels.indexOf(SUBJECT_LABEL) !== -1) {
				properties[OWNER_PROPERTY_NAME] = `toy:construct/${properties.owningConstructName}`;
			}
			return { ...oneNode, properties };
		});
	const edgeList = baseGraph.edgeList.filter((oneEdge) => oneEdge.type !== EDGE_TYPES.EMBEDS_TEXT_OF).concat(REFERENCE_EDGE_LIST.map((oneEdge) => ({ ...oneEdge, type: EDGE_TYPES.REFERENCES, properties: { provenanceTier: 'structural' } })));
	HUB_TEXT_LIST.forEach((oneText) => {
		const textStableId = `toyhub:root/embedText/${oneText.textName}`;
		nodeList.push(embedTextNode({ stableId: textStableId, standardName: EMBED_TEXT_HUB_NAME, vector: oneText.vector }));
		oneText.describedStableIdList.forEach((oneDescribedStableId) => edgeList.push(embedTextEdge({ textStableId, describedStableId: oneDescribedStableId })));
	});
	const sourceTextStableIdSet = new Set();
	const addSourceText = ({ textStableId, vector, describedStableId }) => {
		if (!sourceTextStableIdSet.has(textStableId)) {
			sourceTextStableIdSet.add(textStableId);
			nodeList.push(embedTextNode({ stableId: textStableId, standardName: EMBED_TEXT_SOURCE_STANDARD_NAME, vector }));
		}
		edgeList.push(embedTextEdge({ textStableId, describedStableId }));
	};
	nodeList
		.filter((oneNode) => oneNode.labels.indexOf(SUBJECT_LABEL) !== -1)
		.forEach((oneSubject) => {
			const override = SUBJECT_TEXT_VECTOR_BY_STABLE_ID[oneSubject.stableId];
			const constructName = oneSubject.properties.owningConstructName;
			addSourceText(override !== undefined ? { textStableId: `toy:root/embedText/${oneSubject.stableId}`, vector: override, describedStableId: oneSubject.stableId } : { textStableId: `toy:root/embedText/default${constructName}`, vector: DEFAULT_SUBJECT_TEXT_VECTOR_BY_CONSTRUCT_NAME[constructName], describedStableId: oneSubject.stableId });
		});
	Object.keys(OWNER_TEXT_VECTOR_BY_STABLE_ID).forEach((oneOwnerStableId) => addSourceText({ textStableId: `toy:root/embedText/${oneOwnerStableId}`, vector: OWNER_TEXT_VECTOR_BY_STABLE_ID[oneOwnerStableId], describedStableId: oneOwnerStableId }));
	return { nodeList, edgeList };
};

const embedTextShape = (scenario) => {
	derivedShape(scenario);
	scenario.graph = embedTextGraph();
	overrideDerivedDeclaration(scenario, (declaration) => {
		declaration.candidateRetrieval = cloneJson(EMBED_TEXT_RETRIEVAL);
	});
};

// withoutPoolShape — two subjects with NO pool (binding wiring rule 1, PRISM_COMPASS 14:52Z): the TEXTLESS subject loses
// its only text edge; the UNADMITTED subject gets its own text pointing away from every hub text (cosine <= 0, below minScore)
const TEXTLESS_SUBJECT_STABLE_ID = 'toy:property/Student.Nothing';
const UNADMITTED_SUBJECT_STABLE_ID = 'toy:property/Student.Nothing2';
const withoutPoolShape = (scenario) => {
	const poollessStableIdList = [TEXTLESS_SUBJECT_STABLE_ID, UNADMITTED_SUBJECT_STABLE_ID];
	scenario.graph.edgeList = scenario.graph.edgeList.filter((oneEdge) => !(oneEdge.type === EDGE_TYPES.EMBEDS_TEXT_OF && poollessStableIdList.indexOf(oneEdge.toStableId) !== -1));
	const unadmittedTextStableId = `toy:root/embedText/${UNADMITTED_SUBJECT_STABLE_ID}`;
	scenario.graph.nodeList.push(embedTextNode({ stableId: unadmittedTextStableId, standardName: EMBED_TEXT_SOURCE_STANDARD_NAME, vector: [0, 0, 0, -1] }));
	scenario.graph.edgeList.push(embedTextEdge({ textStableId: unadmittedTextStableId, describedStableId: UNADMITTED_SUBJECT_STABLE_ID }));
};

const canonicalTextOf = (value) => decisionBlockLib.canonicalText(value);
const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);
const subjectCountOf = (graph) => graph.nodeList.filter((oneNode) => oneNode.labels.indexOf(SUBJECT_LABEL) !== -1).length;
// voteTraceBySubjectStableId — each frozen record's retrieval trace, keyed by subject, as canonical text
const voteTraceBySubjectStableId = (outcome) =>
	judgedRecordListOf(outcome).reduce((soFar, oneRecord) => Object.assign(soFar, { [oneRecord.subjectStableId]: canonicalTextOf({ retrievalVoteList: oneRecord.retrievalVoteList === undefined ? '(absent)' : oneRecord.retrievalVoteList, neighbourTrace: oneRecord.neighbourTrace === undefined ? '(absent)' : oneRecord.neighbourTrace }) }), {});

// expectedSubjectTextRecordListByStableId — BY HAND from the graph, not through any reader: every EMBEDS_TEXT_OF edge
// from a source-standard text node into a node, in the reader's record shape, sorted by textStableId (BG-ETS v's oracle)
const expectedSubjectTextRecordListByStableId = (graph) => {
	const nodeByStableId = graph.nodeList.reduce((soFar, oneNode) => Object.assign(soFar, { [oneNode.stableId]: oneNode }), {});
	const recordListByStableId = {};
	graph.edgeList
		.filter((oneEdge) => oneEdge.type === EDGE_TYPES.EMBEDS_TEXT_OF)
		.forEach((oneEdge) => {
			const textNode = nodeByStableId[oneEdge.fromStableId];
			const describedNode = nodeByStableId[oneEdge.toStableId];
			if (textNode === undefined || describedNode === undefined || textNode.properties._source !== EMBED_TEXT_SOURCE_STANDARD_NAME || textNode.properties.role !== DME_ROLES.EMBED_TEXT) {
				return;
			}
			(recordListByStableId[describedNode.stableId] = recordListByStableId[describedNode.stableId] || []).push({ textStableId: textNode.stableId, vector: textNode.properties[EMBED_TEXT_VECTOR.propertyName], embeddingModelVersion: textNode.properties.embeddingModelVersion, sourceStableId: describedNode.stableId, sourceRole: describedNode.properties.role, propertyNameList: [].concat(oneEdge.properties.propertyNameList) });
		});
	Object.keys(recordListByStableId).forEach((oneStableId) => recordListByStableId[oneStableId].sort((leftRecord, rightRecord) => compareStrings(leftRecord.textStableId, rightRecord.textStableId)));
	return recordListByStableId;
};

// THE cardTextCosineFor INSTRUMENT (BG-ETS u, v). A scenario mutation wraps the orchestrator's OWN handle on the pure
// module, so every call's arguments and result are recorded where a judge can read them — including a call the module
// then refuses, which is how conjunct v sees a wrong argument before the module's own guard stops the run. The log
// lives on the test process's global (moduleDouble compiles with vm.runInThisContext) and is reset by each shape.
const CARD_TEXT_CALL_LOG_NAME = '__bgDerivedCardTextCosineForCallList';
const instrumentCardTextCosineFor = (scenario) => {
	global[CARD_TEXT_CALL_LOG_NAME] = [];
	scenario.frameworkMutationList.push({
		modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE),
		find: "const candidateRetrievalLib = require('./candidateRetrieval');",
		replace: `const candidateRetrievalLib = ((realCandidateRetrievalLib) => ({ ...realCandidateRetrievalLib, cardTextCosineFor: (callArguments) => { const callResult = realCandidateRetrievalLib.cardTextCosineFor(callArguments); global['${CARD_TEXT_CALL_LOG_NAME}'].push({ callArguments, callResult }); return callResult; } }))(require('./candidateRetrieval'));`,
	});
};
const cardTextCallListOf = () => (Array.isArray(global[CARD_TEXT_CALL_LOG_NAME]) ? global[CARD_TEXT_CALL_LOG_NAME] : []);

// pairRunConjunct — TWO re-judge runs of one scenario, each with fresh stores: the first as shaped, the second as
// secondShape leaves a clone of it (a named subject set, a reversed read order). The judge sees both outcomes.
const pairRunConjunct = ({ conjunctId, title, twinNameList, shape, secondShape, judge }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (scenario, callback) => {
		shape(scenario);
		const secondScenario = scenarioLib.cloneScenario(scenario);
		secondShape(secondScenario);
		scenarioLib.runScenario(scenario, (unusedFirstError, firstOutcome) => {
			scenarioLib.runScenario(secondScenario, (unusedSecondError, secondOutcome) => {
				callback('', judge(firstOutcome, secondOutcome, scenario));
			});
		});
	},
});

// THE DOUBLE'S READS, SYNCHRONOUSLY (BG-ETS-DOUBLE). graphDouble calls back inline, so a pure conjunct can read through
// it directly; it is compiled through the scenario's mutation list so a twin on graphDouble.js reaches it.
const doubleReaderOf = (scenario, graph) => {
	const graphDoubleLibForScenario = scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'graphDouble.js'), mutationList: scenario.frameworkMutationList }) : require('../graphDouble');
	return graphDoubleLibForScenario.graphDoubleFrom(graph).graphReaderFactory({ inGraph: { graphName: 'DEV_toyEmbedTextDouble' }, dependencyStandardNameList: [EMBED_TEXT_SOURCE_STANDARD_NAME, EMBED_TEXT_HUB_NAME], sourceStandardName: EMBED_TEXT_SOURCE_STANDARD_NAME, blindingDeclaration: [] });
};
const readNow = (readOnce) => {
	let readOutcome = { readError: 'the double did not call back inline' };
	readOnce((readError, readValue) => {
		readOutcome = { readError, readValue };
	});
	return readOutcome;
};

// ---------------------------------------------------------------------
// BG-RETRIEVAL
// ---------------------------------------------------------------------
const retrievalConjunctList = [
	runConjunct({
		conjunctId: 'a_poolNeverExceedsK',
		title: 'every retrieved pool holds at most the declared K candidates',
		twinNameList: ['ignoreKCeiling'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const { k } = declaredRetrievalOf();
			const recordList = judgedRecordListOf(outcome).filter((oneRecord) => Array.isArray(oneRecord.retrievalSeatList));
			const over = recordList.filter((oneRecord) => oneRecord.retrievalSeatList.length > k);
			return { pass: recordList.length > 0 && over.length === 0, detail: `${recordList.length} retrieved record(s), ${over.length} over K=${k}` };
		}),
	}),
	runConjunct({
		conjunctId: 'b_everySeatIsAtOrAboveTheFloor',
		title: "every seat's cosine is at or above the declared floor — the floor is a threshold, not a preference",
		twinNameList: ['ignoreFloor'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const { floor } = declaredRetrievalOf();
			const seatList = judgedRecordListOf(outcome).reduce((soFar, oneRecord) => soFar.concat(Array.isArray(oneRecord.retrievalSeatList) ? oneRecord.retrievalSeatList : []), []);
			const below = seatList.filter((oneSeat) => oneSeat.cosine < floor);
			return { pass: seatList.length > 0 && below.length === 0, detail: `${seatList.length} seat(s), ${below.length} below floor=${floor}` };
		}),
	}),
	runConjunct({
		conjunctId: 'c_poolReachesTheJudgeInStableIdOrder',
		title: 'the pool reaches the judge sorted by stableId — the retrieval RANK never survives into the rendered order',
		twinNameList: ['renderInRankOrder'],
		shape: derivedShape,
		// READ FROM FORENSICS, NOT THE BLOCK. decisionBlock canonicalises every member of
		// STABLE_ID_LIST_KEY_LIST — renderedPoolStableIdList among them — by SORTING it, precisely so the frozen
		// text is order-free. The block therefore cannot witness rendered order: it is sorted there whatever the
		// renderer did. The forensic record holds the list as the judge actually saw it.
		judge: succeeded((runReport, outcome) => {
			const orderList = forensicsOf(outcome)
				.filter((oneRecord) => oneRecord.record && Array.isArray(oneRecord.record.renderedPoolStableIdList) && oneRecord.record.renderedPoolStableIdList.length > 1)
				.map((oneRecord) => oneRecord.record.renderedPoolStableIdList);
			const unsorted = orderList.filter((oneOrder) => JSON.stringify(oneOrder) !== JSON.stringify(oneOrder.slice().sort()));
			return { pass: orderList.length > 0 && unsorted.length === 0, detail: `${orderList.length} multi-seat prompt(s), ${unsorted.length} not in stableId order` };
		}),
	}),
	runConjunct({
		conjunctId: 'd_noCosineOrRankIsEverRendered',
		title: 'no rendered prompt carries a cosine or a retrieval rank — they are forensics, never evidence',
		twinNameList: ['renderTheCosine'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const promptList = promptListOf(outcome);
			const leaked = promptList.filter((onePrompt) => /cosine|similarity score|\brank\b/i.test(onePrompt));
			return { pass: promptList.length > 0 && leaked.length === 0, detail: `${promptList.length} prompt(s), ${leaked.length} naming a cosine or rank` };
		}),
	}),
	runConjunct({
		conjunctId: 'e_floorAboveTheMaximumEmptiesEveryPoolAsNoCandidate',
		title: 'a floor above the achievable maximum empties every pool → orphan(noCandidate), and the renderer is never called',
		twinNameList: ['emptyPoolStillJudged'],
		shape: (scenario) => {
			derivedShape(scenario);
			// The floor cannot simply be raised out of reach: candidateRetrieval refuses a floor outside [-1, 1]
			// by name, and it is right to — a "floor" of 1.5 is not a strict threshold, it is a number that is not
			// a cosine. So the SUBJECTS are given the ANTIPARALLEL vector instead: cosine -1 against every card,
			// below any lawful floor, and deterministic because every other toy vector is identical.
			scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
				oneNode.labels.indexOf('ToyProperty') === -1 || oneNode.properties.embedding === undefined
					? oneNode
					: { ...oneNode, properties: { ...oneNode.properties, embedding: oneNode.properties.embedding.map((oneValue) => -oneValue) } },
			);
		},
		judge: succeeded((runReport, outcome) => {
			const recordList = judgedRecordListOf(outcome);
			const orphanList = recordList.filter((oneRecord) => oneRecord.classification === 'orphan' && oneRecord.reason === 'noCandidate');
			const promptList = promptListOf(outcome);
			return {
				pass: recordList.length > 0 && orphanList.length === recordList.length && promptList.length === 0,
				detail: `${orphanList.length}/${recordList.length} orphan(noCandidate); ${promptList.length} prompt(s) rendered (must be 0)`,
			};
		}),
	}),
];

// ---------------------------------------------------------------------
// BG-BLIND-DERIVED
// ---------------------------------------------------------------------
const blindConjunctList = [
	runConjunct({
		conjunctId: 'a_renderedPropertiesAreOnlyTheAllowListed',
		title: 'POSITIVE: every property line of every rendered prompt names an ALLOW-LISTED property and nothing else',
		twinNameList: ['renderOutsideTheAllowList'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const allowList = declaredAllowListOf();
			const permitted = new Set(allowList.subject.concat(allowList.candidate));
			const promptList = promptListOf(outcome);
			const outsideList = promptList.reduce((soFar, onePrompt) => soFar.concat(renderedPropertyNameList(onePrompt).filter((oneName) => !permitted.has(oneName))), []);
			return { pass: promptList.length > 0 && outsideList.length === 0, detail: `${promptList.length} prompt(s); outside the allow-list: ${Array.from(new Set(outsideList)).join(', ') || 'none'}` };
		}),
	}),
	runConjunct({
		conjunctId: 'b_idGateSweepIsAtZeroOverEveryPrompt',
		title: 'NEGATIVE: the id-gate regex sweep over EVERY rendered prompt is at zero',
		twinNameList: ['renderOutsideTheAllowList'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const promptList = promptListOf(outcome);
			const hitList = idGateHitList(promptList);
			return { pass: promptList.length > 0 && hitList.length === 0, detail: `${promptList.length} prompt(s), ${hitList.length} hit(s)${hitList.length ? `: ${hitList.slice(0, 2).join(' | ')}` : ''}` };
		}),
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-BLIND-DERIVED',
		conjunctId: 'c_allowListNamingANeverPropertyIsRefused',
		title: 'an allow-list naming a NEVER property is refused BY NAME at declaration time — the audit cannot be opted out of',
		shape: (scenario) => {
			derivedShape(scenario);
			overrideDerivedDeclaration(scenario, (declaration) => {
				declaration.renderingAllowList = { ...declaration.renderingAllowList, candidate: declaration.renderingAllowList.candidate.concat(['canonicalKey']) };
			});
		},
		regex: /renderingAllowList\.candidate names 'canonicalKey', which is on RENDERING_NEVER_NAME_LIST/,
		twinName: 'allowNeverNames',
		fileName: CONTRACT_FILE,
		find: '\t\t\tconst forbidden = value[oneSide].find((oneName) => RENDERING_NEVER_NAME_LIST.indexOf(oneName) !== -1);',
		replace: '\t\t\tconst forbidden = undefined; void RENDERING_NEVER_NAME_LIST;',
	}),
	// ⟪H-1, adversarial review D4 2026-08-17⟫ The reviewer neutered renderedBlockRefusal and bgDerived, bgBlind
	// and bgDecl ALL STAYED GREEN. The comment beside that function says it "has to be able to catch me being
	// wrong"; nothing tested whether it could.
	//
	// The honest test is the one the function claims to be: a SECOND net. So the FIRST net — the declaration
	// validator that refuses a NEVER name in the allow-list — is DELIBERATELY BYPASSED here, a NEVER name is put
	// into the allow-list, and the RENDERER must catch the leak in the bytes it produced. A conjunct that merely
	// re-tested the first net would have left this exactly as unproven as it was.
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-BLIND-DERIVED',
		conjunctId: 'd_theSecondNetCatchesALeakTHEFIRSTNETWasBypassedFor',
		title: 'with the DECLARATION net bypassed, a NEVER property reaching the rendered bytes is refused BY THE RENDERER — the second net catches what the first net was made to miss',
		shape: (scenario) => {
			derivedShape(scenario);
			// bypass net #1 (bridgePluginContract's allow-list validation) so the leak can actually reach the renderer
			scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CONTRACT_FILE), find: '\t\t\tconst forbidden = value[oneSide].find((oneName) => RENDERING_NEVER_NAME_LIST.indexOf(oneName) !== -1);', replace: '\t\t\tconst forbidden = undefined; void RENDERING_NEVER_NAME_LIST;' });
			overrideDerivedDeclaration(scenario, (declaration) => {
				declaration.renderingAllowList = { ...declaration.renderingAllowList, candidate: declaration.renderingAllowList.candidate.concat(['canonicalKey']) };
			});
		},
		regex: /the rendered prompt carries property 'canonicalKey', which is on RENDERING_NEVER_NAME_LIST/,
		twinName: 'secondNetRemoved',
		fileName: RENDERER_FILE,
		find: '\tconst leaked = renderedNameList.find((oneName) => RENDERING_NEVER_NAME_LIST.indexOf(oneName) !== -1);',
		replace: '\tconst leaked = undefined; void renderedNameList;',
	}),
];

// ---------------------------------------------------------------------
// BG-DERIVED-CENSUS
// ---------------------------------------------------------------------
const censusConjunctList = [
	runConjunct({
		conjunctId: 'a_judgedPlusOrphanEqualsSubjectCount',
		title: 'per SUBJECT: judged + orphan == subjectCount (RULING BF8 stands — no new subject bucket)',
		twinNameList: ['dropJudgedFromSubjectCount'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const perSubject = runReport.counts.cardinalityCensus.perSubject;
			const sum = perSubject.judgedSubjectCount + perSubject.orphanSubjectCount;
			return { pass: perSubject.subjectCount > 0 && sum === perSubject.subjectCount && perSubject.specifiedSubjectCount === 0, detail: `judged ${perSubject.judgedSubjectCount} + orphan ${perSubject.orphanSubjectCount} = ${sum} vs subjectCount ${perSubject.subjectCount}` };
		}),
	}),
	runConjunct({
		conjunctId: 'b_abstainedIsAPerTargetMemberNeverASubjectBucket',
		title: "`abstained` is counted per TARGET inside a judged subject and appears in NO subject bucket",
		twinNameList: ['abstainedAsSubjectBucket'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const census = runReport.counts.cardinalityCensus;
			const subjectBucketNameList = Object.keys(census.perSubject);
			return {
				pass: census.perTarget.abstainedCount > 0 && subjectBucketNameList.every((oneName) => !/abstain/i.test(oneName)),
				detail: `perTarget.abstainedCount ${census.perTarget.abstainedCount}; subject buckets ${subjectBucketNameList.join(', ')}`,
			};
		}),
	}),
];

// ---------------------------------------------------------------------
// BG-NOCROSSWALK
// ---------------------------------------------------------------------
const noCrosswalkConjunctList = [
	runConjunct({
		conjunctId: 'a_theProducerOpensNoDocumentAtAll',
		title: 'the derived producer declares no channel and reports an EMPTY sourceChannelDigestByKey — it cannot have read an authored crosswalk because it opened no file',
		twinNameList: ['derivedDeclaresAChannel'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const digestByKey = block && block.header ? block.header.sourceChannelDigestByKey : undefined;
			return { pass: digestByKey !== undefined && Object.keys(digestByKey).length === 0, detail: `sourceChannelDigestByKey = ${JSON.stringify(digestByKey)}` };
		}),
	}),
];

// ---------------------------------------------------------------------
// BG-PARTIAL
// ---------------------------------------------------------------------
const partialConjunctList = [
	runConjunct({
		conjunctId: 'a_windowedRunMarksItsBlockPartial',
		title: 'a --limit run marks its frozen block with the PARTIAL window, so incompleteness is legible in the block itself',
		twinNameList: ['unmarkedWindow'],
		shape: (scenario) => {
			derivedShape(scenario);
			scenario.spec.config = { ...scenario.spec.config, limit: 3, offset: 0 };
		},
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const windowMark = block && block.header ? block.header.sourceWindow : undefined;
			return { pass: typeof windowMark === 'string' && /PARTIAL_WINDOW/.test(windowMark), detail: `sourceWindow = ${JSON.stringify(windowMark)}` };
		}),
	}),
	// ⟪H-2, adversarial review D4 2026-08-17⟫ The reviewer disabled the PARTIAL guard and bgDerived stayed
	// 39/39. This family's TITLE claims a windowed block "refuses to ship as a whole graph"; conjunct (a)
	// asserts only that the block is MARKED. Marking is legibility; refusing is the guarantee, and the
	// guarantee was the untested half. With three PARTIAL blocks living in one store under one pairKey and
	// `materialise` being latest-wins, ten edges could have shipped as a graph and reported success.
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PARTIAL',
		conjunctId: 'b_aWindowedBlockREFUSESToMaterialiseUnderADifferentWindow',
		title: 'a block frozen from a --limit WINDOW is REFUSED BY NAME when a run whose window differs tries to materialise it — the family title\'s "refuses to ship as a whole graph", asserted rather than assumed',
		mode: 'twice',
		shape: (scenario) => {
			derivedShape(scenario);
			// freeze under a window, then materialise with NO window: the guard must refuse the second run
			scenario.spec.config = { ...scenario.spec.config, limit: 3, offset: 0 };
			scenario.secondRunConfigOverride = { limit: undefined, offset: undefined };
		},
		regex: /was frozen from a PARTIAL window[\s\S]*and this run's window is/,
		twinName: 'partialGuardRemoved',
		fileName: 'materialiser.js',
		find: '\tif (blockWindowMark !== null && blockWindowMark !== currentWindowMark) {',
		replace: '\tif (false && blockWindowMark !== null && blockWindowMark !== currentWindowMark) {',
	}),
];

// ---------------------------------------------------------------------
// BG-THREE-DERIVED — the INFERRED half of the producer-conditional edge properties. BG-THREE walks the same
// disposition table for the AUTHORED half over a crosswalk scenario; this is the other direction, and both
// are needed: a table with one side untested is a table that can be half wrong for a year.
// ---------------------------------------------------------------------
const inferredEdgeConjunctList = [
	runConjunct({
		conjunctId: 'a_inferredEdgeCarriesNoProviderAndNoSubjectMatchField',
		title: 'an INFERRED edge carries NEITHER mappingProvider NOR subjectMatchField — nobody authored it and it matched on no field',
		twinNameList: ['inferredKeptTheProvider'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const edgeList = edgesOf(outcome);
			const carrying = edgeList.filter((oneEdge) => graphSeamRulesLib.PRODUCER_CONDITIONAL_EDGE_PROPERTY_NAME_LIST.some((oneName) => Object.prototype.hasOwnProperty.call(oneEdge.properties, oneName)));
			return { pass: edgeList.length > 0 && carrying.length === 0, detail: `${edgeList.length} inferred edge(s), ${carrying.length} carrying a producer-conditional property` };
		}),
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-THREE-DERIVED',
		conjunctId: 'b_inferredEdgeCarryingAProviderIsRefusedByName',
		title: "an INFERRED edge that DOES carry a mappingProvider is refused BY NAME at the write seam — the key must be ABSENT, not null, not the tool's URL",
		shape: (scenario) => {
			derivedShape(scenario);
			// force the materialiser to stamp a provider onto every edge; the seam must then refuse the run
			scenario.frameworkMutationList.push({
				modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'materialiser.js'),
				find: '\tif (mappingProviderUrl !== null && mappingProviderUrl !== undefined) {',
				replace: '\tif (true) {\n\t\tedgeProperties[MAPPING_PROPERTIES.MAPPING_PROVIDER] = \'https://example.invalid/forced\';\n\t}\n\tif (false) {',
			});
		},
		regex: /an 'inferred' edge carries 'mappingProvider'/,
		twinName: 'providerForbiddenCheckDisabled',
		fileName: 'graphSeamRules.js',
		find: "\t\tif (disposition === 'forbidden' && Object.prototype.hasOwnProperty.call(edgeProperties, oneName)) {",
		replace: '\t\tif (false) {',
	}),
];

// ---------------------------------------------------------------------
// BG-NV at orchestrator level (e, j) and BG-ETS at orchestrator level (g, h, i, u, v, w) — B4, SPEC-bridgeRevision §9 and
// §13 R-BR-14/15/16, over THE EMBED-TEXT SCENARIO above. Pure-module conjuncts of both gates live in test-bgEts.js,
// test-neighbourVote.js and test-bgDecl.js; these prove the orchestrator wires the modules as the spec says.
// ---------------------------------------------------------------------
const crypto = require('crypto');
const NAMED_SUBJECT_STABLE_ID_LIST = Object.freeze(['toy:property/Course.Credits', 'toy:property/Student.FirstName']);
// the scoring and trace vocabularies whose appearance in a rendered prompt is a leak (j, g). Each was measured absent
// from every prompt of the untwinned run before the conjunct relied on it (DEVLOG, B4 gates-green checkpoint).
const SCORING_TERM_RE = /\bvotes?\b|ownVotes|domainVote|rangeVote|domainShare|rangeShare|\bshares?\b|\bscore\b|cardTextCosine|\bneighbou?rs?\b|\bsiblings?\b/i;
const RETRIEVAL_TRACE_TERM_RE = /\bvotes?\b|ownVotes|pathList|embedTextStableId|hitTextStableId|bestCosine/i;
// i's two oracles. BY HAND: toyDerivedPlugin declares k 3, every toy card and subject carries the SAME vector, so every
// cosine ties and stableId ascending decides — the first three property-tier card stableIds. MEASURED: the digest of
// every record's (subject, retrievalSeatList, renderedPoolStableIdList, promptHash) over this very scenario at 1d100d2,
// before the method registry existed.
const COSINE_TOP_K_HAND_DERIVED_POOL = Object.freeze(['toyhub:card/P000001.C1', 'toyhub:card/P000002.C1', 'toyhub:card/P000002.C2']);
// measured 2026-09-15 by running THIS conjunct in a git-archive export of 1d100d2 whose graphDouble.js, bridge-framework.js,
// candidateRetrieval.js, neighbourVote.js and evidenceRenderer.js were each byte-compared with 1d100d2 (B4 DEVLOG)
const COSINE_TOP_K_POOL_DIGEST_AT_1D100D2 = 'e3a08792a43fca1a139a4bf6ff1bccd9994aa0a64aa6e1746c273dd45f1dfd81';

const failureOfBoth = (firstOutcome, secondOutcome) => refusalTextOf(firstOutcome) || refusalTextOf(secondOutcome);

const neighbourVoteConjunctList = [
	pairRunConjunct({
		conjunctId: 'e_namedSetScoresEqualFullRunScores',
		title: 'a NAMED-SET run and a FULL run give each shared subject the same frozen retrievalVoteList (votes, shares, score) and neighbourTrace — neighbours come from the full source population, never the window (invariant 5)',
		twinNameList: ['siblingsFromWindow'],
		shape: embedTextShape,
		secondShape: (secondScenario) => {
			secondScenario.spec.config = { ...secondScenario.spec.config, subjectStableIdList: NAMED_SUBJECT_STABLE_ID_LIST.slice() };
		},
		judge: (fullOutcome, namedOutcome) => {
			const failure = failureOfBoth(fullOutcome, namedOutcome);
			if (failure) {
				return { pass: false, detail: `expected two successful runs but got: ${failure.slice(0, 320)}` };
			}
			const fullTraceBySubject = voteTraceBySubjectStableId(fullOutcome);
			const namedTraceBySubject = voteTraceBySubjectStableId(namedOutcome);
			const differingList = NAMED_SUBJECT_STABLE_ID_LIST.filter((oneStableId) => fullTraceBySubject[oneStableId] === undefined || fullTraceBySubject[oneStableId] !== namedTraceBySubject[oneStableId]);
			// non-vacuous: the named run's trace still counts siblings the window does not contain
			const withSiblingsList = NAMED_SUBJECT_STABLE_ID_LIST.filter((oneStableId) => /"siblingCount":[1-9]/.test(namedTraceBySubject[oneStableId] || ''));
			return { pass: Object.keys(namedTraceBySubject).length === NAMED_SUBJECT_STABLE_ID_LIST.length && differingList.length === 0 && withSiblingsList.length > 0, detail: `${Object.keys(namedTraceBySubject).length} named subject record(s); ${differingList.length} differ from the full run${differingList.length ? `: ${differingList.join(', ')}` : ''}; ${withSiblingsList.length} counting siblings outside the window` };
		},
	}),
	runConjunct({
		conjunctId: 'j_noVoteShareCardTextOrNeighbourTermRendered',
		title: 'no vote, share, score, cardTextCosine or neighbour term appears in any rendered prompt of an embedTextVote-v1 run with neighbour votes',
		twinNameList: ['renderNeighbourShare', 'renderCardText'],
		shape: embedTextShape,
		judge: succeeded((runReport, outcome) => {
			const promptList = promptListOf(outcome);
			const leakedList = promptList.filter((onePrompt) => SCORING_TERM_RE.test(onePrompt));
			return { pass: promptList.length > 0 && leakedList.length === 0, detail: `${promptList.length} prompt(s), ${leakedList.length} naming a scoring term${leakedList.length ? ` (first: '${SCORING_TERM_RE.exec(leakedList[0])[0]}')` : ''}` };
		}),
	}),
];

const embedTextSearchConjunctList = [
	runConjunct({
		conjunctId: 'g_poolRenderedInStableIdOrderWithNoVotesOrPaths',
		title: 'an embedTextVote-v1 pool reaches the judge in stableId order, and no vote, path or text-node id is rendered',
		twinNameList: ['renderVotes'],
		shape: embedTextShape,
		// READ FROM FORENSICS: the block sorts renderedPoolStableIdList, so only the forensic record witnesses rendered order
		judge: succeeded((runReport, outcome) => {
			const forensicList = forensicsOf(outcome).filter((oneRecord) => oneRecord.record && Array.isArray(oneRecord.record.renderedPoolStableIdList));
			const multiSeatCount = forensicList.filter((oneRecord) => oneRecord.record.renderedPoolStableIdList.length > 1).length;
			const unsortedCount = forensicList.filter((oneRecord) => JSON.stringify(oneRecord.record.renderedPoolStableIdList) !== JSON.stringify(oneRecord.record.renderedPoolStableIdList.slice().sort(compareStrings))).length;
			const leakedList = promptListOf(outcome).filter((onePrompt) => RETRIEVAL_TRACE_TERM_RE.test(onePrompt));
			return { pass: multiSeatCount > 0 && unsortedCount === 0 && leakedList.length === 0, detail: `${forensicList.length} prompt(s), ${multiSeatCount} multi-seat; ${unsortedCount} not in stableId order; ${leakedList.length} naming a vote, path or text id${leakedList.length ? ` (first: '${RETRIEVAL_TRACE_TERM_RE.exec(leakedList[0])[0]}')` : ''}` };
		}),
	}),
	pairRunConjunct({
		conjunctId: 'h_retrievalVoteListByteIdenticalAcrossTwoRuns',
		title: 'the frozen retrievalVoteList and neighbourTrace are byte-identical across two runs, the second reading the graph in REVERSED node and edge order (orchestrator level)',
		twinNameList: ['reverseTieBreak'],
		shape: embedTextShape,
		secondShape: (secondScenario) => {
			secondScenario.graph = { nodeList: secondScenario.graph.nodeList.slice().reverse(), edgeList: secondScenario.graph.edgeList.slice().reverse() };
		},
		judge: (firstOutcome, secondOutcome) => {
			const failure = failureOfBoth(firstOutcome, secondOutcome);
			if (failure) {
				return { pass: false, detail: `expected two successful runs but got: ${failure.slice(0, 320)}` };
			}
			const firstTraceBySubject = voteTraceBySubjectStableId(firstOutcome);
			const secondTraceBySubject = voteTraceBySubjectStableId(secondOutcome);
			const subjectStableIdList = Object.keys(firstTraceBySubject).sort(compareStrings);
			const differingList = subjectStableIdList.filter((oneStableId) => firstTraceBySubject[oneStableId] !== secondTraceBySubject[oneStableId]);
			const multiEntryCount = judgedRecordListOf(firstOutcome).filter((oneRecord) => Array.isArray(oneRecord.retrievalVoteList) && oneRecord.retrievalVoteList.length > 1).length;
			return { pass: subjectStableIdList.length > 0 && Object.keys(secondTraceBySubject).length === subjectStableIdList.length && multiEntryCount > 0 && differingList.length === 0, detail: `${subjectStableIdList.length} subject(s), ${multiEntryCount} with more than one vote entry; ${differingList.length} differ between the two runs${differingList.length ? ` (first: ${differingList[0]})` : ''}` };
		},
	}),
	runConjunct({
		conjunctId: 'i_cosineTopKPoolsUnchanged',
		title: "cosineTopK-v1 pools are unchanged by the method registry: every record's retrievalSeatList names the hand-derived top K, and (subject, seats, rendered pool, promptHash) digest to the value measured at 1d100d2",
		twinNameList: ['perturbTopK'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const recordList = judgedRecordListOf(outcome).slice().sort((leftRecord, rightRecord) => compareStrings(leftRecord.subjectStableId, rightRecord.subjectStableId));
			const offHandCount = recordList.filter((oneRecord) => !Array.isArray(oneRecord.retrievalSeatList) || JSON.stringify(oneRecord.retrievalSeatList.map((oneSeat) => oneSeat.stableId)) !== JSON.stringify(COSINE_TOP_K_HAND_DERIVED_POOL)).length;
			const poolDigest = crypto
				.createHash('sha256')
				.update(canonicalTextOf(recordList.map((oneRecord) => [oneRecord.subjectStableId, oneRecord.retrievalSeatList === undefined ? null : oneRecord.retrievalSeatList, oneRecord.renderedPoolStableIdList === undefined ? null : oneRecord.renderedPoolStableIdList, oneRecord.judge === undefined ? null : oneRecord.judge.promptHash])), 'utf8')
				.digest('hex');
			return { pass: recordList.length > 0 && offHandCount === 0 && poolDigest === COSINE_TOP_K_POOL_DIGEST_AT_1D100D2, detail: `${recordList.length} record(s), ${offHandCount} off the hand-derived pool; digest ${poolDigest} (pinned ${COSINE_TOP_K_POOL_DIGEST_AT_1D100D2})` };
		}),
	}),
	runConjunct({
		conjunctId: 'u_frozenCardTextEqualsCardTextCosineForOutput',
		title: 'every frozen retrievalVoteList entry carries cardTextCosine and cardTextWinningTextStableId EQUAL to what cardTextCosineFor returned for that subject and card',
		twinNameList: ['dropCardTextFromRecord'],
		shape: (scenario) => {
			embedTextShape(scenario);
			instrumentCardTextCosineFor(scenario);
		},
		judge: succeeded((runReport, outcome) => {
			const returnedByPairText = {};
			cardTextCallListOf().forEach((oneCall) => {
				const subjectTextRecordList = oneCall.callArguments.subjectTextRecordList;
				if (!Array.isArray(subjectTextRecordList) || subjectTextRecordList.length === 0 || !oneCall.callResult || !Array.isArray(oneCall.callResult.admittedList)) {
					return;
				}
				oneCall.callResult.admittedList.forEach((oneEntry) => {
					returnedByPairText[`${subjectTextRecordList[0].sourceStableId} ${oneEntry.stableId}`] = { cardTextCosine: oneEntry.cardTextCosine, cardTextWinningTextStableId: oneEntry.cardTextWinningTextStableId };
				});
			});
			let comparedCount = 0;
			const mismatchList = [];
			judgedRecordListOf(outcome).forEach((oneRecord) =>
				(Array.isArray(oneRecord.retrievalVoteList) ? oneRecord.retrievalVoteList : []).forEach((oneEntry) => {
					comparedCount += 1;
					const returned = returnedByPairText[`${oneRecord.subjectStableId} ${oneEntry.stableId}`];
					if (returned === undefined || typeof oneEntry.cardTextCosine !== 'number' || returned.cardTextCosine !== oneEntry.cardTextCosine || returned.cardTextWinningTextStableId !== oneEntry.cardTextWinningTextStableId) {
						mismatchList.push(`${oneRecord.subjectStableId} → ${oneEntry.stableId}`);
					}
				}),
			);
			return { pass: comparedCount > 0 && mismatchList.length === 0, detail: `${comparedCount} frozen entr(ies) against ${cardTextCallListOf().length} cardTextCosineFor call(s); ${mismatchList.length} differ${mismatchList.length ? ` (first: ${mismatchList[0]})` : ''}` };
		}),
	}),
	runConjunct({
		conjunctId: 'v_cardTextCosineForReceivesExactlyTheSubjectsOwnTexts',
		title: "cardTextCosineFor receives EXACTLY the subject's own text records — every EMBEDS_TEXT_OF record into that subject and nothing else — once per subject with a pool; and the run reads text vectors twice (source, hub) and card slot edges once",
		twinNameList: ['passNeighbourTexts'],
		shape: (scenario) => {
			embedTextShape(scenario);
			instrumentCardTextCosineFor(scenario);
		},
		// NOT wrapped in succeeded(): under the twin the module refuses the mixed list, and the record of the call that
		// carried it is the observation — the refusal alone would prove only that the module's guard works
		judge: (outcome, scenario) => {
			const expectedByStableId = expectedSubjectTextRecordListByStableId(scenario.graph);
			const callList = cardTextCallListOf();
			const mismatchCount = callList.filter((oneCall) => {
				const recordList = oneCall.callArguments.subjectTextRecordList;
				if (!Array.isArray(recordList) || recordList.length === 0) {
					return true;
				}
				const sortedRecordList = recordList.slice().sort((leftRecord, rightRecord) => compareStrings(leftRecord.textStableId, rightRecord.textStableId));
				return canonicalTextOf(sortedRecordList) !== canonicalTextOf(expectedByStableId[recordList[0].sourceStableId] || []);
			}).length;
			const refusalText = refusalTextOf(outcome);
			const doubleState = outcome.graphDouble ? outcome.graphDouble.state : {};
			const subjectCount = subjectCountOf(scenario.graph);
			// a subject with no pool is an orphan BEFORE cardTextCosineFor (wiring rule 1), so the calls are one per POOLED subject
			const pooledSubjectCount = judgedRecordListOf(outcome).filter((oneRecord) => Array.isArray(oneRecord.retrievalVoteList) && oneRecord.retrievalVoteList.length > 0).length;
			return {
				pass: !refusalText && pooledSubjectCount > 0 && callList.length === pooledSubjectCount && mismatchCount === 0 && doubleState.readEmbedTextVectorsCallCount === 2 && doubleState.readCardBaseEdgesCallCount === 1,
				detail: `${callList.length} call(s) for ${pooledSubjectCount} pooled subject(s) of ${subjectCount}; ${mismatchCount} not exactly the subject's own texts; readEmbedTextVectors ${doubleState.readEmbedTextVectorsCallCount}, readCardBaseEdges ${doubleState.readCardBaseEdgesCallCount}${refusalText ? `; run refused: ${refusalText.slice(0, 200)}` : ''}`,
			};
		},
	}),
	runConjunct({
		conjunctId: 'w_subjectWithoutPoolIsOrphanBeforeCardText',
		title: 'a subject with NO text records and a subject whose texts admit NO card are both orphans (noCandidate) with an empty retrievalVoteList, reached BEFORE cardTextCosineFor — a textless subject never refuses the run (binding wiring rule 1)',
		twinNameList: ['cardTextCosineForFirst'],
		shape: (scenario) => {
			embedTextShape(scenario);
			withoutPoolShape(scenario);
		},
		judge: succeeded((runReport, outcome) => {
			const recordBySubjectStableId = judgedRecordListOf(outcome).reduce((soFar, oneRecord) => Object.assign(soFar, { [oneRecord.subjectStableId]: oneRecord }), {});
			const orphanCount = [TEXTLESS_SUBJECT_STABLE_ID, UNADMITTED_SUBJECT_STABLE_ID].filter((oneStableId) => {
				const oneRecord = recordBySubjectStableId[oneStableId];
				return oneRecord !== undefined && oneRecord.classification === 'orphan' && oneRecord.reason === 'noCandidate' && Array.isArray(oneRecord.retrievalVoteList) && oneRecord.retrievalVoteList.length === 0 && oneRecord.neighbourTrace === null;
			}).length;
			const judgedCount = judgedRecordListOf(outcome).filter((oneRecord) => oneRecord.resolution === 'judged').length;
			return { pass: orphanCount === 2 && judgedCount > 0, detail: `${orphanCount}/2 pool-less subject(s) orphan(noCandidate) with an empty retrievalVoteList and a null neighbourTrace; ${judgedCount} other subject(s) judged` };
		}),
	}),
];

// ---------------------------------------------------------------------
// BG-ETS-DOUBLE — graphDouble's parity with the bolt reader (B4 brief §2; B3b stand-down items 1, 2, e, f), read
// DIRECTLY through the double over B3b's toyEmbedTextBoltGraph and its hand-derived expectations, so the double proves
// the same shapes boltDriverDouble proves for graphReader.js in test-bgBolt / test-bgEts
// ---------------------------------------------------------------------
const doubleParityConjunctList = [
	pureConjunct({
		conjunctId: 'a_embedTextVectorsReadAsTheBoltReaderReadsThem',
		title: "readEmbedTextVectors returns B3b's hand-derived source records for the source standard (scalar propertyNameList re-widened, sorted by text then described node) and the hub's one property text for the hub",
		twinNameList: ['doubleSkipsReWiden'],
		judge: (scenario) => {
			const retrievalView = doubleReaderOf(scenario, toyEmbedTextBoltGraphLib.embedTextBoltGraph()).forRetrieval();
			const sourceRead = readNow((readDone) => retrievalView.readEmbedTextVectors({ standardName: EMBED_TEXT_SOURCE_STANDARD_NAME }, readDone));
			const hubRead = readNow((readDone) => retrievalView.readEmbedTextVectors({ standardName: EMBED_TEXT_HUB_NAME }, readDone));
			const sourceEqual = !sourceRead.readError && canonicalTextOf(sourceRead.readValue) === canonicalTextOf(toyEmbedTextBoltGraphLib.EXPECTED_SOURCE_TEXT_RECORD_LIST);
			const hubRecordList = hubRead.readError ? [] : hubRead.readValue;
			const hubEqual = hubRecordList.length === 1 && hubRecordList[0].textStableId === toyEmbedTextBoltGraphLib.HUB_TEXT_ID.firstName && hubRecordList[0].sourceRole === DME_ROLES.PROPERTY && canonicalTextOf(hubRecordList[0].propertyNameList) === canonicalTextOf(['name']);
			return { pass: sourceEqual && hubEqual, detail: `source: ${sourceRead.readError || `${sourceRead.readValue.length} record(s), equal to the hand-derived list ${sourceEqual}`}; hub: ${hubRead.readError || `${hubRecordList.length} record(s), as expected ${hubEqual}`}` };
		},
	}),
	pureConjunct({
		conjunctId: 'b_cardBaseEdgesReadAsTheBoltReaderReadsThem',
		title: "readCardBaseEdges returns B3b's hand-derived slot counts (DOMAIN 9, PROPERTY 9, RANGE 2: QUALIFIER, IN_HUB and the value-tier card's DOMAIN not returned), and a card with no RANGE is lawful",
		twinNameList: ['doubleReturnsEverySlotEdge'],
		judge: (scenario) => {
			const edgeRead = readNow((readDone) => doubleReaderOf(scenario, toyEmbedTextBoltGraphLib.embedTextBoltGraph()).forRetrieval().readCardBaseEdges({ referenceTier: 'property' }, readDone));
			if (edgeRead.readError) {
				return { pass: false, detail: `read refused: ${edgeRead.readError}` };
			}
			const expectedCountBySlot = toyEmbedTextBoltGraphLib.EXPECTED_PROPERTY_TIER_SLOT_EDGE_COUNT_BY_SLOT;
			const slotByEdgeType = Object.keys(expectedCountBySlot).reduce((soFar, oneSlot) => Object.assign(soFar, { [vocabularyLib.hubEdgeType(EMBED_TEXT_HUB_NAME, oneSlot)]: oneSlot }), {});
			const countBySlot = edgeRead.readValue.reduce((soFar, oneEdge) => {
				const slotName = slotByEdgeType[oneEdge.edgeType] === undefined ? `unexpected ${oneEdge.edgeType}` : slotByEdgeType[oneEdge.edgeType];
				return Object.assign(soFar, { [slotName]: (soFar[slotName] || 0) + 1 });
			}, {});
			const rangeOnRangelessCardCount = edgeRead.readValue.filter((oneEdge) => oneEdge.cardStableId === toyEmbedTextBoltGraphLib.PROPERTY_TIER_CARD_WITHOUT_RANGE_STABLE_ID && slotByEdgeType[oneEdge.edgeType] === 'RANGE').length;
			const countsEqual = canonicalTextOf(countBySlot) === canonicalTextOf(expectedCountBySlot);
			return { pass: countsEqual && rangeOnRangelessCardCount === 0, detail: `counts ${canonicalTextOf(countBySlot)} (hand-derived ${canonicalTextOf(expectedCountBySlot)}); RANGE edges on ${toyEmbedTextBoltGraphLib.PROPERTY_TIER_CARD_WITHOUT_RANGE_STABLE_ID}: ${rangeOnRangelessCardCount}` };
		},
	}),
	pureConjunct({
		conjunctId: 'c_textNodesExcludedFromEverySourceReadByRole',
		title: "text nodes are excluded BY ROLE from subjects, from the evidence view's source nodes, and from both ends of every among-source edge (R-BR-2), over a graph that carries source text nodes",
		twinNameList: ['doubleIncludesEmbedText'],
		judge: (scenario) => {
			const graph = toyEmbedTextBoltGraphLib.embedTextBoltGraph();
			const sourceTextNodeCount = graph.nodeList.filter((oneNode) => oneNode.properties.role === DME_ROLES.EMBED_TEXT && oneNode.properties._source === EMBED_TEXT_SOURCE_STANDARD_NAME).length;
			const reader = doubleReaderOf(scenario, graph);
			const evidenceView = reader.forEvidence();
			const subjectRead = readNow((readDone) => reader.readSubjectNodes(readDone));
			const evidenceNodeRead = readNow((readDone) => evidenceView.readSourceNodes({}, readDone));
			const evidenceEdgeRead = readNow((readDone) => evidenceView.readEdgesAmongSource({}, readDone));
			const failedRead = [subjectRead, evidenceNodeRead, evidenceEdgeRead].find((oneRead) => oneRead.readError);
			if (failedRead !== undefined) {
				return { pass: false, detail: `read refused: ${failedRead.readError}` };
			}
			const textNodeCountIn = (nodeList) => nodeList.filter((oneNode) => oneNode.properties.role === DME_ROLES.EMBED_TEXT).length;
			const textEdgeCount = evidenceEdgeRead.readValue.filter((oneEdge) => oneEdge.type === EDGE_TYPES.EMBEDS_TEXT_OF).length;
			return {
				pass: sourceTextNodeCount > 0 && textNodeCountIn(subjectRead.readValue) === 0 && textNodeCountIn(evidenceNodeRead.readValue) === 0 && textEdgeCount === 0,
				detail: `graph carries ${sourceTextNodeCount} source text node(s); text nodes among subjects ${textNodeCountIn(subjectRead.readValue)}, among evidence nodes ${textNodeCountIn(evidenceNodeRead.readValue)}; EMBEDS_TEXT_OF edges among source ${textEdgeCount}`,
			};
		},
	}),
	pureConjunct({
		conjunctId: 'd_absentPropertyNeverEqualsAsInCypher',
		title: "equality follows Cypher: a read whose parameter is ABSENT matches nothing, not even a card whose property is absent too (boltDriverDouble's rule, B3b stand-down item 1)",
		twinNameList: ['doubleMatchesAbsentProperty'],
		judge: (scenario) => {
			const graph = toyEmbedTextBoltGraphLib.embedTextBoltGraph();
			delete graph.nodeList.find((oneNode) => oneNode.stableId === toyEmbedTextBoltGraphLib.PROPERTY_TIER_CARD_WITHOUT_RANGE_STABLE_ID).properties.referenceTier;
			const retrievalView = doubleReaderOf(scenario, graph).forRetrieval();
			const absentRead = readNow((readDone) => retrievalView.readHubVectors({}, readDone));
			const propertyRead = readNow((readDone) => retrievalView.readHubVectors({ referenceTier: 'property' }, readDone));
			const absentCount = absentRead.readError ? -1 : absentRead.readValue.length;
			const propertyCount = propertyRead.readError ? -1 : propertyRead.readValue.length;
			return { pass: absentCount === 0 && propertyCount === 8, detail: `an absent referenceTier matched ${absentCount} card(s) (must be 0); 'property' matched ${propertyCount} (the 9 property-tier cards less the one whose tier was removed)` };
		},
	}),
];

const gateDeclarationList = [
	{ gateId: 'BG-RETRIEVAL', title: 'the semantic candidate pool: K, the floor, neutral order, and an empty pool that is an orphan rather than an error', conjunctList: retrievalConjunctList },
	{ gateId: 'BG-BLIND-DERIVED', title: 'the bias audit: an ALLOW-list enforced by construction, with the regex sweep as the second net', conjunctList: blindConjunctList },
	{ gateId: 'BG-DERIVED-CENSUS', title: "the derived census in the framework's own vocabulary", conjunctList: censusConjunctList },
	{ gateId: 'BG-NOCROSSWALK', title: 'the truth set is unreachable because no document is opened at all', conjunctList: noCrosswalkConjunctList },
	{ gateId: 'BG-PARTIAL', title: 'a windowed block is legible as partial and refuses to ship as a whole graph', conjunctList: partialConjunctList },
	{ gateId: 'BG-THREE-DERIVED', title: 'the INFERRED half of the producer-conditional edge properties', conjunctList: inferredEdgeConjunctList },
	{ gateId: 'BG-NV', title: 'neighbour-vote scoring as the orchestrator wires it: named-set scores equal full-run scores, and no scoring term is rendered', conjunctList: neighbourVoteConjunctList },
	{ gateId: 'BG-ETS', title: "the text-node lookup as the orchestrator wires it: neutral rendered order, determinism, cosineTopK-v1 unchanged, and cardTextCosine frozen as computed from the subject's own texts", conjunctList: embedTextSearchConjunctList },
	{ gateId: 'BG-ETS-DOUBLE', title: 'graphDouble parity with the bolt reader: text-node reads, card slot edges, exclusion by role, Cypher equality', conjunctList: doubleParityConjunctList },
];

// ---------------------------------------------------------------------
// TWINS — each names the ONE production row or line the conjunct depends on. Where a registered data row can
// be targeted instead of a source string it is (the supervisor's note that source-text twins are
// refactor-fragile): the K/floor twins move the DECLARATION, not the retrieval code.
// ---------------------------------------------------------------------
scenarioTwin({ registry: twinRegistry, gateId: 'BG-RETRIEVAL', conjunctId: 'a_poolNeverExceedsK', twinName: 'ignoreKCeiling', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RETRIEVAL_FILE), find: 'for (let rankIndex = 0; rankIndex < scoredList.length && seatList.length < k; rankIndex++) {', replace: 'for (let rankIndex = 0; rankIndex < scoredList.length; rankIndex++) {' });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-RETRIEVAL', conjunctId: 'b_everySeatIsAtOrAboveTheFloor', twinName: 'ignoreFloor', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RETRIEVAL_FILE), find: '\t\tif (scoredList[rankIndex].cosine < floor) {\n\t\t\tbreak;\n\t\t}', replace: '\t\tif (false) {\n\t\t\tbreak;\n\t\t}' });
	// a floor no card can meet: without the break above, every seat is admitted below it
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] || {};
	const loaded = require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`));
	const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
	bridgeDeclaration.candidateRetrieval = { ...bridgeDeclaration.candidateRetrieval, floor: 1.5 };
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME].bridgeDeclaration = bridgeDeclaration;
} });
// ⟪B4⟫ RE-POINTED: the pool line moved from the cosine producer into the method-dispatched tail every retrieval method
// shares, so the twin now finds it there; before and after the move it was observed red (DEVLOG, B4 gates checkpoints)
scenarioTwin({ registry: twinRegistry, gateId: 'BG-RETRIEVAL', conjunctId: 'c_poolReachesTheJudgeInStableIdOrder', twinName: 'renderInRankOrder', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: 'const poolCardList = classificationLib.sortByStableId(pooled.seatStableIdList.map((oneSeatStableId) => args.cardByStableId[oneSeatStableId]));', replace: 'const poolCardList = pooled.seatStableIdList.map((oneSeatStableId) => args.cardByStableId[oneSeatStableId]).slice().reverse();' });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-RETRIEVAL', conjunctId: 'd_noCosineOrRankIsEverRendered', twinName: 'renderTheCosine', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RENDERER_FILE), find: "\tlineList.push(`  CANDIDATE INDEX NUMBER: [${seatIndex + 1}]`);", replace: "\tlineList.push(`  CANDIDATE INDEX NUMBER: [${seatIndex + 1}] cosine ${oneSeat.cosine}`);" });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-RETRIEVAL', conjunctId: 'e_floorAboveTheMaximumEmptiesEveryPoolAsNoCandidate', twinName: 'emptyPoolStillJudged', leverKind: 'productionMutation', mutate: (scenario) => {
	// the classification row that makes an empty retrieved pool an orphan is REMOVED: the pool then falls to a
	// judged row and the renderer is called on nothing
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'classification.js'), find: "	Object.freeze({ row: 'R2', classification: 'orphan', scope: 'target', reason: 'noCandidate', condition: (context) => context.poolOrigin === 'retrieval' && context.filteredPoolSize === 0 }),", replace: '' });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-BLIND-DERIVED', conjunctId: 'a_renderedPropertiesAreOnlyTheAllowListed', twinName: 'renderOutsideTheAllowList', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RENDERER_FILE), find: "\tlineList.push(...renderKeyValueLines(graphSeamRulesLib.allowListedPropertiesFor({ properties: cardWithIdeas, allowNameList: renderingAllowList.candidate }), '      '));", replace: "\tlineList.push(...renderKeyValueLines({ ...graphSeamRulesLib.allowListedPropertiesFor({ properties: cardWithIdeas, allowNameList: renderingAllowList.candidate }), canonicalKey: oneSeat.card.canonicalKey }, '      '));" });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-BLIND-DERIVED', conjunctId: 'b_idGateSweepIsAtZeroOverEveryPrompt', twinName: 'renderOutsideTheAllowList', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RENDERER_FILE), find: "\tlineList.push(...renderKeyValueLines(graphSeamRulesLib.allowListedPropertiesFor({ properties: cardWithIdeas, allowNameList: renderingAllowList.candidate }), '      '));", replace: "\tlineList.push(...renderKeyValueLines({ ...graphSeamRulesLib.allowListedPropertiesFor({ properties: cardWithIdeas, allowNameList: renderingAllowList.candidate }), canonicalKey: oneSeat.card.canonicalKey }, '      '));" });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-DERIVED-CENSUS', conjunctId: 'a_judgedPlusOrphanEqualsSubjectCount', twinName: 'dropJudgedFromSubjectCount', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'census.js'), find: '\tperSubject.subjectCount = perSubject.specifiedSubjectCount + perSubject.judgedSubjectCount + perSubject.orphanSubjectCount + perSubject.subjectCollisionCount + perSubject.sourceGapCount;', replace: '\tperSubject.subjectCount = perSubject.specifiedSubjectCount + perSubject.orphanSubjectCount + perSubject.subjectCollisionCount + perSubject.sourceGapCount;' });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-DERIVED-CENSUS', conjunctId: 'b_abstainedIsAPerTargetMemberNeverASubjectBucket', twinName: 'abstainedAsSubjectBucket', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'census.js'), find: '\tconst perSubject = {\n\t\tsubjectCount: 0,', replace: '\tconst perSubject = {\n\t\tabstainedSubjectCount: 0,\n\t\tsubjectCount: 0,' });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-NOCROSSWALK', conjunctId: 'a_theProducerOpensNoDocumentAtAll', twinName: 'derivedDeclaresAChannel', leverKind: 'productionMutation', mutate: (scenario) => {
	// the row-conditional emptiness refusal is disabled, and the derived plugin is given the crosswalk's own
	// document channel: the run then OPENS a document and the digest map stops being empty
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CONTRACT_FILE), find: '\t\tif (acquisitionRow !== undefined && acquisitionRow.walkChannelSourceKind === null) {', replace: '\t\tif (false) {' });
	const crosswalkLoaded = require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyCrosswalkPlugin.js'));
	const loaded = require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`));
	const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
	bridgeDeclaration.sourceChannelList = cloneJson(crosswalkLoaded.bridgeDeclaration.sourceChannelList);
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = { ...(scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] || {}), bridgeDeclaration };
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-THREE-DERIVED', conjunctId: 'a_inferredEdgeCarriesNoProviderAndNoSubjectMatchField', twinName: 'inferredKeptTheProvider', leverKind: 'productionMutation', mutate: (scenario) => {
	// BOTH halves are needed to observe this red: the materialiser must stamp the property AND the seam's
	// forbidden-check must be disabled, or the run refuses before an edge is ever written and the conjunct
	// would go red for the refusal rather than for the property it is about.
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'materialiser.js'), find: '\tif (mappingProviderUrl !== null && mappingProviderUrl !== undefined) {', replace: "\tif (true) {\n\t\tedgeProperties[MAPPING_PROPERTIES.MAPPING_PROVIDER] = 'https://example.invalid/forced';\n\t}\n\tif (false) {" });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'graphSeamRules.js'), find: "\t\tif (disposition === 'forbidden' && Object.prototype.hasOwnProperty.call(edgeProperties, oneName)) {", replace: '\t\tif (false) {' });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-PARTIAL', conjunctId: 'a_windowedRunMarksItsBlockPartial', twinName: 'unmarkedWindow', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\t\t\t\t\tsourceWindow: args.windowMark === undefined ? null : args.windowMark,', replace: '\t\t\t\t\t\tsourceWindow: null,' });
} });

// ---------------------------------------------------------------------
// B4 TWINS — BG-NV (e, j), BG-ETS (g, h, i, u, v), BG-ETS-DOUBLE (a-d). Each names the ONE orchestrator or double line its
// conjunct depends on.
// ---------------------------------------------------------------------
const SIBLING_POPULATION_FIND = 'retrievalContext.subjectNodeList.filter((oneNode) => oneNode.labels.indexOf(retrievalContext.subjectLabel) !== -1).forEach((oneNode) => {';
const POOL_CARD_LIST_FIND = 'const poolCardList = classificationLib.sortByStableId(pooled.seatStableIdList.map((oneSeatStableId) => args.cardByStableId[oneSeatStableId]));';
// decoratedPoolCardListReplace — the leak a rendering conjunct exists to catch: one frozen trace term written into each
// seat's NAME, which every candidate renders under the toy allow-list
const decoratedPoolCardListReplace = ({ termLabel, entryFieldName }) => `const poolCardList = classificationLib.sortByStableId(pooled.seatStableIdList.map((oneSeatStableId, seatIndex) => ({ ...args.cardByStableId[oneSeatStableId], name: args.cardByStableId[oneSeatStableId].name + ' ${termLabel} ' + pooled.recordTraceByFieldName.retrievalVoteList[seatIndex].${entryFieldName} })));`;
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-NV', conjunctId: 'e_namedSetScoresEqualFullRunScores', twinName: 'siblingsFromWindow', fileName: FRAMEWORK_FILE, find: SIBLING_POPULATION_FIND, replace: SIBLING_POPULATION_FIND.replace('retrievalContext.subjectNodeList.filter', 'retrievalContext.windowedNodeList.filter') });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-NV', conjunctId: 'j_noVoteShareCardTextOrNeighbourTermRendered', twinName: 'renderNeighbourShare', fileName: FRAMEWORK_FILE, find: POOL_CARD_LIST_FIND, replace: decoratedPoolCardListReplace({ termLabel: 'domainShare', entryFieldName: 'domainShare' }) });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-NV', conjunctId: 'j_noVoteShareCardTextOrNeighbourTermRendered', twinName: 'renderCardText', fileName: FRAMEWORK_FILE, find: POOL_CARD_LIST_FIND, replace: decoratedPoolCardListReplace({ termLabel: 'cardTextCosine', entryFieldName: 'cardTextCosine' }) });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'g_poolRenderedInStableIdOrderWithNoVotesOrPaths', twinName: 'renderVotes', fileName: FRAMEWORK_FILE, find: POOL_CARD_LIST_FIND, replace: decoratedPoolCardListReplace({ termLabel: 'votes', entryFieldName: 'ownVotes' }) });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'h_retrievalVoteListByteIdenticalAcrossTwoRuns', twinName: 'reverseTieBreak', leverKind: 'productionMutation', mutate: (scenario) => {
	// the frozen order stops being a function of the frozen inputs: every second run in this process reverses it, the
	// observable signature of a tie broken by run state rather than by the record (a counter per RUN, so the parity of the
	// two runs always differs whatever ran before)
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: 'const scoringLookup = neighbourScoringRowFor(retrievalDeclaration.neighbourVote);', replace: 'const scoringLookup = neighbourScoringRowFor(retrievalDeclaration.neighbourVote); global.__bgDerivedReverseTieBreakRunOrdinal = (global.__bgDerivedReverseTieBreakRunOrdinal || 0) + 1;' });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: 'recordTraceByFieldName: { retrievalVoteList: frozenVotes.retrievalVoteList, neighbourTrace: frozenTrace.neighbourTrace } };', replace: 'recordTraceByFieldName: { retrievalVoteList: global.__bgDerivedReverseTieBreakRunOrdinal % 2 === 0 ? frozenVotes.retrievalVoteList.slice().reverse() : frozenVotes.retrievalVoteList, neighbourTrace: frozenTrace.neighbourTrace } };' });
} });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'i_cosineTopKPoolsUnchanged', twinName: 'perturbTopK', fileName: FRAMEWORK_FILE, find: 'subjectVector: retrievalState.subjectVectorByStableId[subjectStableId].embedding, k, floor });', replace: 'subjectVector: retrievalState.subjectVectorByStableId[subjectStableId].embedding, k: k + 1, floor });' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'u_frozenCardTextEqualsCardTextCosineForOutput', twinName: 'dropCardTextFromRecord', fileName: FRAMEWORK_FILE, find: 'retrievalVoteList.push({ ...frozenEntry, pathList: frozenPathList });', replace: 'const { cardTextCosine: droppedCardTextCosine, cardTextWinningTextStableId: droppedWinningTextStableId, ...frozenEntryWithoutCardText } = frozenEntry; void droppedCardTextCosine; void droppedWinningTextStableId; retrievalVoteList.push({ ...frozenEntryWithoutCardText, pathList: frozenPathList });' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'v_cardTextCosineForReceivesExactlyTheSubjectsOwnTexts', twinName: 'passNeighbourTexts', fileName: FRAMEWORK_FILE, find: 'const ordered = candidateRetrievalLib.cardTextCosineFor({ admittedList: voted.admittedList, subjectTextRecordList, hubVectorIndex });', replace: `const ownerTextRecordList = textRecordListBySourceStableId.get(neighbourInputBase.siblingPopulationByStableId[subjectStableId].properties.${OWNER_PROPERTY_NAME}) || []; const ordered = candidateRetrievalLib.cardTextCosineFor({ admittedList: voted.admittedList, subjectTextRecordList: subjectTextRecordList.concat(ownerTextRecordList), hubVectorIndex });` });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'w_subjectWithoutPoolIsOrphanBeforeCardText', twinName: 'cardTextCosineForFirst', fileName: FRAMEWORK_FILE, find: 'if (voted.admittedList.length === 0) {', replace: 'const cardTextProbe = candidateRetrievalLib.cardTextCosineFor({ admittedList: voted.admittedList, subjectTextRecordList, hubVectorIndex }); if (cardTextProbe.error) { return { error: cardTextProbe.error }; } if (voted.admittedList.length === 0) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS-DOUBLE', conjunctId: 'a_embedTextVectorsReadAsTheBoltReaderReadsThem', twinName: 'doubleSkipsReWiden', fileName: 'graphDouble.js', find: 'const shaped = graphSeamRulesLib.shapeEmbedTextVectorRowList({ rowList, standardName });', replace: 'const shaped = { recordList: rowList.map((oneRow) => ({ textStableId: oneRow.textStableId, vector: oneRow.vector, embeddingModelVersion: oneRow.embeddingModelVersion, sourceStableId: oneRow.sourceStableId, sourceRole: oneRow.sourceRole, propertyNameList: oneRow.propertyNameList })) };' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS-DOUBLE', conjunctId: 'b_cardBaseEdgesReadAsTheBoltReaderReadsThem', twinName: 'doubleReturnsEverySlotEdge', fileName: 'graphDouble.js', find: 'const shaped = graphSeamRulesLib.shapeCardBaseEdgeRowList({ cardRowList, edgeRowList, textSearchVocabulary });', replace: 'const shaped = { recordList: edgeRowList };' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS-DOUBLE', conjunctId: 'c_textNodesExcludedFromEverySourceReadByRole', twinName: 'doubleIncludesEmbedText', fileName: 'graphDouble.js', find: 'cypherEquals(oneRecord.properties._source, sourceStandardName) && oneRecord.properties.role !== textSearchVocabulary.embedTextRole);', replace: 'cypherEquals(oneRecord.properties._source, sourceStandardName));' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS-DOUBLE', conjunctId: 'd_absentPropertyNeverEqualsAsInCypher', twinName: 'doubleMatchesAbsentProperty', fileName: 'graphDouble.js', find: 'const cypherEquals = (propertyValue, parameterValue) => !isAbsentValue(propertyValue) && !isAbsentValue(parameterValue) && propertyValue === parameterValue;', replace: 'const cypherEquals = (propertyValue, parameterValue) => propertyValue === parameterValue;' });

runGateFamily(
	{
		harness,
		familyName: 'BG-RETRIEVAL+BG-BLIND-DERIVED+BG-DERIVED-CENSUS+BG-NOCROSSWALK+BG-PARTIAL+BG-THREE-DERIVED+BG-NV+BG-ETS+BG-ETS-DOUBLE',
		gateDeclarationList,
		twinRegistry,
		makeSubject: scenarioLib.makeScenario,
		cloneSubject: scenarioLib.cloneScenario,
		// LITERAL, never derived from a .length (RULING SABLE_RIVER 2026-08-17)
		// LITERAL: 5 + 4 + 2 + 1 + 2 + 2 (the six pre-B4 families; the old comment read 5 + 3 + 2 + 1 + 1 + 2, which sums to 14)
		// + 2 + 6 + 4 (B4: BG-NV, BG-ETS, BG-ETS-DOUBLE)
		expectedConjunctCount: 28,
		expectedTwinCount: 29,
	},
	() => harness.report(),
);
