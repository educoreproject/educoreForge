#!/usr/bin/env node
'use strict';

// test-sif260928DerivedPlugin.js — the phase D1 gates for the SIF derived plugin (PLAN-sifReplacement-smallPhases
// §3 D1). HERMETIC: the shipped plugin file runs, unmodified, on the bridge framework's graph-double path (the
// toyBridgeScenario harness test-bgDerived.js uses) over a toy graph shaped like the SIF forge's output, under the
// debug judge. No Docker, no network, no spend. Every conjunct is observed RED under its own twin before the
// family counts as green (gateSuiteRunner).
//
//   D1-REGISTER  (a) the registry discovers and accepts the plugin from the real forges/ at zero spend. Twins: the
//                    retrieval declaration loses neighbourVote (refused by the contract); the plugin file requires
//                    neo4j-driver (refused by source policing).
//                (a′) the id list is non-empty, sorted, unique and every entry six bare digits: an empty list
//                    would match every prompt, and a P-prefixed one would repeat what the pattern already catches.
//                (a‴) goldJev lane A: the shipped scope list holds 5,017 Question ids, sorted and unique, and not the one
//                    whose SIF description names CEDS Id 000102. Twin: that Question restored to the list.
//                (a″) the list is wired: a listed bare id planted in a question's description refuses the run, naming
//                    the identifierList pattern.
//   D1-FANOUT    (b) two SIF questions (a model question in StudentPersonal and StaffPersonal; a SIF_Metadata question
//                    copied into both) run to completion, and the block holds exactly three units: the model question
//                    once per CEDS domain of its objects, each with its own Field, the metadata question once with
//                    both. Every picked unit writes one edge per Field, from that Field to its card, naming its question.
//   D1-SSSOM     (c) the SSSOM export over that block passes the subject-prefix check: every subject_id is a Field
//                    stableId beginning 'sif260928:'.
//   B6-HARVEST   (a) phase B6: the toy graph carries Field -HAS_CHILD-> Field base edges between picked Fields, as SIF's
//                    does (SPEC A26), so under fan-out both ends of each carry the pair label. Harvested with the edge
//                    types the block entry states, the harvest equals the written edge list exactly and conservation
//                    passes. Twins: the block entry states no list (the old untyped selector), and the double's type
//                    filter deleted; each makes conservation refuse, naming the invented HAS_CHILD edges.
//                (a′) the replay engine's pattern text for that list, and its refusals of an empty list and a bad name.
//
// THE TOY GRAPH. The framework's toy hub (toyEmbedTextBoltGraph: cards, their slot edges, the property base nodes)
// with its text layer replaced: three hub texts, and SIF-shaped Sif260928Question and Sif260928Field nodes with their
// HAS_INSTANCE edges and their own texts. Every vector is fabricated and stamped with the plugin's declared model.
// The object names are real SIF objects, so the partition reads the shipped domain file untouched.
//
// Run: PATH=/usr/local/bin:$PATH node forges/sif260928/test/test-sif260928DerivedPlugin.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase D1 gates: the SIF derived plugin registers, fans out per domain on the graph double, and exports SSSOM

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const BUNDLE_DIR = path.join(__dirname, '..');
const TREE_ROOT = path.join(BUNDLE_DIR, '..', '..');
const FRAMEWORK_TEST_DIR = path.join(TREE_ROOT, 'lib', 'bridge-framework', 'test');
const scenarioLib = require(path.join(FRAMEWORK_TEST_DIR, 'testSupport', 'toyBridgeScenario'));
const toyEmbedTextBoltGraphLib = require(path.join(FRAMEWORK_TEST_DIR, 'testSupport', 'toyEmbedTextBoltGraph'));
const { runConjunct, pureConjunct, succeeded, nameInRefusal, scenarioTwin, frameworkMutationTwin, blockOf, edgesOf, forensicsOf } = require(path.join(FRAMEWORK_TEST_DIR, 'testSupport', 'bridgeTwinFactories'));
const { runGateFamily } = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const pluginRegistryLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'pluginRegistry'));
const sssomExporterLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'sssomExporter'));
const replayEngineLib = require(path.join(TREE_ROOT, 'lib', 'replay', 'replay-engine'))();
const { compareConservation } = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'replay-manager', 'replayManager'));
const { DME_ROLES, EDGE_TYPES, EMBED_TEXT_VECTOR } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));

const twinRegistry = makeTwinRegistry();
const cloneJson = scenarioLib.cloneJson;

// the plugin under test, and the frozen literals it is measured against
const PLUGIN_NAME = 'sif260928CedsDerivedPlugin';
const STANDARD_KEY = 'sif260928';
const PLUGIN_FILE_NAME = `${PLUGIN_NAME}.js`;
const REAL_FORGES_DIR = path.join(TREE_ROOT, 'forges');
const SHIPPED_BRIDGES_DIR = path.join(BUNDLE_DIR, 'bridges');
const IDENTIFIER_LIST_FILE_NAME = 'sif260928CedsIdList.json';
// 354 SIF-column ids widened to every hub id (phase D4, RULING EBONY_DREAM 2026-09-29): a ruled data change, not a measurement
const IDENTIFIER_LIST_COUNT = 2731;
const SOURCE_STANDARD_NAME = 'SIF260928';
const SOURCE_VERSION = '4.3';
const MATERIALISER_FILE = 'materialiser.js';
const BRIDGE_FRAMEWORK_FILE = 'bridge-framework.js';
const GRAPH_DOUBLE_FILE = 'graphDouble.js';
const HUB_NAME = toyEmbedTextBoltGraphLib.HUB_NAME;

// the two questions and their Fields; the object names are SIF's, so the shipped domain file labels them
const MODEL_QUESTION = 'sif260928:question/toyModelLocalId';
const METADATA_QUESTION = 'sif260928:question/toyMetadataTimeElementType';
const STUDENT_LOCAL_ID = 'sif260928:field//StudentPersonals/StudentPersonal/LocalId';
const STAFF_LOCAL_ID = 'sif260928:field//StaffPersonals/StaffPersonal/LocalId';
const STUDENT_METADATA_TYPE = 'sif260928:field//StudentPersonals/StudentPersonal/SIF_Metadata/TimeElements/TimeElement/Type';
const STAFF_METADATA_TYPE = 'sif260928:field//StaffPersonals/StaffPersonal/SIF_Metadata/TimeElements/TimeElement/Type';
// THE UNIT LITERAL (b): read by hand from the shipped domain file (StudentPersonal → K12 Student Enrollment, StaffPersonal
// → K12 Staff Employment) and the declared rule (SIF_Metadata is one unit), sorted by subject then label
const UNIT_LITERAL = Object.freeze([
	{ subjectStableId: METADATA_QUESTION, judgmentPartitionLabel: null, instanceStableIdList: [STAFF_METADATA_TYPE, STUDENT_METADATA_TYPE] },
	{ subjectStableId: MODEL_QUESTION, judgmentPartitionLabel: 'K12 Staff Employment', instanceStableIdList: [STAFF_LOCAL_ID] },
	{ subjectStableId: MODEL_QUESTION, judgmentPartitionLabel: 'K12 Student Enrollment', instanceStableIdList: [STUDENT_LOCAL_ID] },
]);
// what each unit's prompt states: the two model units their domain, the metadata unit nothing (sorted)
const PROMPT_DOMAIN_LINE_LITERAL = Object.freeze(['', 'objectDomain: K12 Staff Employment', 'objectDomain: K12 Student Enrollment']);
// SIF's own answer on the model question (the student local id), planted so every run exercises the blinding
const PLANTED_ANSWER_ID = 'P001071';
const QUESTION_BY_FIELD = Object.freeze({ [STUDENT_LOCAL_ID]: MODEL_QUESTION, [STAFF_LOCAL_ID]: MODEL_QUESTION, [STUDENT_METADATA_TYPE]: METADATA_QUESTION, [STAFF_METADATA_TYPE]: METADATA_QUESTION });
const FIELD_STABLE_ID_LIST = Object.freeze(Object.keys(QUESTION_BY_FIELD).sort());
// (phase B6) the Field -HAS_CHILD-> Field base edges planted between PICKED Fields of one object, standing in for SIF's
// element-to-attribute edges (SPEC A26): every Field is picked under the debug rule 'first', so both ends of each get
// the pair label, which is the shape D2's harvest refused on (2,992 such edges)
const FIELD_CHILD_EDGE_LIST = Object.freeze([
	{ fromStableId: STUDENT_LOCAL_ID, toStableId: STUDENT_METADATA_TYPE },
	{ fromStableId: STAFF_LOCAL_ID, toStableId: STAFF_METADATA_TYPE },
]);
// a bare id from the shipped list (the student local id SIF annotates) and a P-form the pattern alone catches
const PLANTED_BARE_ID = '001071';
// the shipped scope list (goldJev lane A): every Question of the sif260928 base block 576db6546c8f except the one whose own
// SIF description names CEDS Id 000102 (the prompt identifier scan refused it in jevBuild1)
const SCOPE_LIST_FILE_NAME = 'sif260928ScopeWithoutIdentifierLeak.json';
const SCOPE_LIST_COUNT = 5017;
const EXCLUDED_IDENTIFIER_LEAK_QUESTION = 'sif260928:question/183a60008bd203cec3adb01979500e005073f1ff26836a311874872004171ca7';
const TOY_SCOPE_LIST = Object.freeze([METADATA_QUESTION, MODEL_QUESTION].sort());

// ---------------------------------------------------------------------
// THE SCRATCH FORGES TREE — the harness's toy bundles plus a COPY of the shipped sif260928 bridges/ folder, so the
// registry discovers the real plugin next to the toy hub. A twin edits only the copy.
// ---------------------------------------------------------------------
const copyDirectory = (fromDir, toDir) => {
	fs.mkdirSync(toDir, { recursive: true });
	fs.readdirSync(fromDir, { withFileTypes: true }).forEach((oneEntry) => {
		const fromPath = path.join(fromDir, oneEntry.name);
		const toPath = path.join(toDir, oneEntry.name);
		if (oneEntry.isDirectory()) {
			copyDirectory(fromPath, toPath);
			return;
		}
		fs.copyFileSync(fromPath, toPath);
	});
};
const makeSifForgesDir = (scenario) => {
	const forgesDirPath = scenarioLib.makeScratchForgesCopy();
	const bridgesDirPath = path.join(forgesDirPath, STANDARD_KEY, 'bridges');
	copyDirectory(SHIPPED_BRIDGES_DIR, bridgesDirPath);
	if (scenario.pluginTextTransform !== undefined) {
		const pluginFilePath = path.join(bridgesDirPath, PLUGIN_FILE_NAME);
		fs.writeFileSync(pluginFilePath, scenario.pluginTextTransform(fs.readFileSync(pluginFilePath, 'utf8')));
	}
	// THE SCOPE LIST (goldJev lane A, 2026-10-01): the shipped plugin now narrows its subjects to a declared list of the
	// forge's real Question stableIds, none of which is in this toy graph. The COPY of the folder therefore gets a list of
	// the toy's two Questions, so the shipped declaration runs unmodified and its scope list is exercised, not bypassed.
	fs.writeFileSync(path.join(bridgesDirPath, SCOPE_LIST_FILE_NAME), `${JSON.stringify(scenario.toyScopeListTransform === undefined ? TOY_SCOPE_LIST : scenario.toyScopeListTransform(TOY_SCOPE_LIST.slice()), null, '\t')}\n`);
	if (scenario.identifierListTransform !== undefined) {
		const identifierListFilePath = path.join(bridgesDirPath, IDENTIFIER_LIST_FILE_NAME);
		fs.writeFileSync(identifierListFilePath, `${JSON.stringify(scenario.identifierListTransform(JSON.parse(fs.readFileSync(identifierListFilePath, 'utf8'))), null, '\t')}\n`);
	}
	return forgesDirPath;
};
// declarationOverrideFor — a twin's declaration edit, laid over the shipped declaration by the harness
const shippedDeclaration = () => cloneJson(require(path.join(SHIPPED_BRIDGES_DIR, PLUGIN_FILE_NAME)).bridgeDeclaration);
const applyDeclarationEdit = (scenario) => {
	if (scenario.declarationEdit !== undefined) {
		const bridgeDeclaration = shippedDeclaration();
		scenario.declarationEdit(bridgeDeclaration);
		scenario.pluginModuleOverrides[PLUGIN_NAME] = { bridgeDeclaration };
	}
};

// ---------------------------------------------------------------------
// THE TOY SIF GRAPH
// ---------------------------------------------------------------------
const DECLARED_MODEL = shippedDeclaration().candidateRetrieval.embeddingModelVersion;
const CARD_VECTOR_BY_CARD_STABLE_ID = Object.freeze({
	'toyhub:card/P000001.C1': [1, 0, 0, 0],
	'toyhub:card/P000002.C1': [0.2, 1, 0, 0],
	'toyhub:card/P000002.C2': [0, 1, 0, 0.3],
	'toyhub:card/P000008.C3': [0, 0, 0.2, 1],
});
// each hub text describes a hub PROPERTY base node, so a hit on it admits that property's cards
const HUB_TEXT_LIST = Object.freeze([
	{ textName: 'hIdentifier', vector: [1, 0, 0, 0], describedStableIdList: ['toyhub:property/P000001'] },
	{ textName: 'hTimePeriod', vector: [0, 1, 0, 0], describedStableIdList: ['toyhub:property/P000002'] },
	{ textName: 'hLocation', vector: [0, 0, 0, 1], describedStableIdList: ['toyhub:property/P000008'] },
]);
const SUBJECT_TEXT_LIST = Object.freeze([
	{ textName: 'localIdName', vector: [0.9, 0.1, 0, 0], describedStableId: MODEL_QUESTION, propertyNameList: 'name' },
	{ textName: 'localIdContext', vector: [0.8, 0, 0, 0.2], describedStableId: MODEL_QUESTION, propertyNameList: 'contextText' },
	{ textName: 'timeElementTypeDescription', vector: [0.1, 0.9, 0, 0], describedStableId: METADATA_QUESTION, propertyNameList: 'description' },
]);

const textNode = ({ stableId, standardName, vector }) => ({
	stableId,
	labels: ['ForgedNode', `${standardName}EmbedText`, DME_ROLES.EMBED_TEXT],
	properties: { stableId, text: `toy text ${stableId}`, role: DME_ROLES.EMBED_TEXT, _source: standardName, [EMBED_TEXT_VECTOR.propertyName]: vector.slice(), embeddingModelVersion: DECLARED_MODEL, embedSourceProperty: 'text', vectorPropertyName: EMBED_TEXT_VECTOR.propertyName },
});
const textEdge = ({ textStableId, describedStableId, propertyNameList }) => ({ fromStableId: textStableId, toStableId: describedStableId, type: EDGE_TYPES.EMBEDS_TEXT_OF, properties: { propertyNameList, provenanceTier: 'structural' } });
const questionNode = ({ stableId, name, description, relativePath, contextText, sharedBlock, objectNameList, cedsElementId }) => ({
	stableId,
	labels: ['Sif260928Question'],
	properties: { stableId, name, description, role: DME_ROLES.PROPERTY, _source: SOURCE_STANDARD_NAME, relativePath, contextText, sharedBlock, instanceCount: objectNameList.length, objectNameList, objectNameSampleList: objectNameList, ...(cedsElementId === undefined ? {} : { cedsElementId }) },
});
const fieldNode = ({ stableId, objectName, sharedBlock }) => ({
	stableId,
	labels: ['Sif260928Field'],
	properties: { stableId, name: stableId.split('/').pop(), role: DME_ROLES.SUPPORT, _source: SOURCE_STANDARD_NAME, objectName, sharedBlock },
});

const sifGraph = ({ modelDescription }) => {
	const baseGraph = toyEmbedTextBoltGraphLib.embedTextBoltGraph();
	const nodeList = baseGraph.nodeList
		.filter((oneNode) => oneNode.properties.role !== DME_ROLES.EMBED_TEXT)
		.map((oneNode) => {
			const properties = { ...oneNode.properties };
			if (CARD_VECTOR_BY_CARD_STABLE_ID[oneNode.stableId] !== undefined) {
				properties.embedding = CARD_VECTOR_BY_CARD_STABLE_ID[oneNode.stableId].slice();
			}
			if (properties.embedding !== undefined) {
				properties.embeddingModelVersion = DECLARED_MODEL;
			}
			return { ...oneNode, properties };
		})
		.concat([
			// cedsElementId is SIF's own answer column: planted on purpose, so the blinding is exercised by every run
			questionNode({ stableId: MODEL_QUESTION, name: 'LocalId', description: modelDescription, relativePath: 'LocalId', contextText: 'Local Id', sharedBlock: 'model', objectNameList: ['StaffPersonal', 'StudentPersonal'], cedsElementId: PLANTED_ANSWER_ID }),
			questionNode({ stableId: METADATA_QUESTION, name: 'Type', description: 'The kind of time period the element describes.', relativePath: 'SIF_Metadata/TimeElements/TimeElement/Type', contextText: 'SIF Metadata / Time Elements / Time Element / Type', sharedBlock: 'SIF_Metadata', objectNameList: ['StaffPersonal', 'StudentPersonal'] }),
			fieldNode({ stableId: STUDENT_LOCAL_ID, objectName: 'StudentPersonal', sharedBlock: 'model' }),
			fieldNode({ stableId: STAFF_LOCAL_ID, objectName: 'StaffPersonal', sharedBlock: 'model' }),
			fieldNode({ stableId: STUDENT_METADATA_TYPE, objectName: 'StudentPersonal', sharedBlock: 'SIF_Metadata' }),
			fieldNode({ stableId: STAFF_METADATA_TYPE, objectName: 'StaffPersonal', sharedBlock: 'SIF_Metadata' }),
		]);
	const edgeList = baseGraph.edgeList
		.filter((oneEdge) => oneEdge.type !== EDGE_TYPES.EMBEDS_TEXT_OF)
		.concat(Object.keys(QUESTION_BY_FIELD).map((fieldStableId) => ({ fromStableId: QUESTION_BY_FIELD[fieldStableId], toStableId: fieldStableId, type: EDGE_TYPES.HAS_INSTANCE, properties: { provenanceTier: 'structural' } })))
		.concat(FIELD_CHILD_EDGE_LIST.map((oneEdge) => ({ ...oneEdge, type: EDGE_TYPES.HAS_CHILD, properties: { provenanceTier: 'structural' } })));
	HUB_TEXT_LIST.forEach((oneText) => {
		const textStableId = `toyhub:root/embedText/${oneText.textName}`;
		nodeList.push(textNode({ stableId: textStableId, standardName: HUB_NAME, vector: oneText.vector }));
		oneText.describedStableIdList.forEach((describedStableId) => edgeList.push(textEdge({ textStableId, describedStableId, propertyNameList: 'name' })));
	});
	SUBJECT_TEXT_LIST.forEach((oneText) => {
		const textStableId = `sif260928:root/embedText/${oneText.textName}`;
		nodeList.push(textNode({ stableId: textStableId, standardName: SOURCE_STANDARD_NAME, vector: oneText.vector }));
		edgeList.push(textEdge({ textStableId, describedStableId: oneText.describedStableId, propertyNameList: oneText.propertyNameList }));
	});
	return { nodeList, edgeList };
};

// sifShape — the run: the shipped plugin (a twin's declaration edit laid over it, if any), the scratch forges tree,
// the SIF source on the toy hub, the debug judge's 'first' rule so every non-empty pool is picked
const sifShape = (scenario) => {
	scenario.forgesDirOverride = makeSifForgesDir(scenario);
	applyDeclarationEdit(scenario);
	scenario.graph = sifGraph({ modelDescription: scenario.plantedModelDescription === undefined ? 'The locally assigned identifier of the person.' : scenario.plantedModelDescription });
	if (scenario.graphEdit !== undefined) {
		scenario.graphEdit(scenario.graph);
	}
	scenario.judgeRule = 'first';
	scenario.spec.bridge = PLUGIN_NAME;
	scenario.spec.source = STANDARD_KEY;
	scenario.spec.config = { ...scenario.spec.config, sourceStandard: STANDARD_KEY, sourceStandardName: SOURCE_STANDARD_NAME, sourceVersion: SOURCE_VERSION, familyStandards: [STANDARD_KEY] };
};

const unitListOf = (outcome) =>
	blockOf(outcome)
		.decisionRecordList.map((oneRecord) => ({ subjectStableId: oneRecord.subjectStableId, judgmentPartitionLabel: oneRecord.judgmentPartitionLabel === undefined ? null : oneRecord.judgmentPartitionLabel, instanceStableIdList: oneRecord.instanceStableIdList }))
		.sort((leftUnit, rightUnit) => `${leftUnit.subjectStableId}|${leftUnit.judgmentPartitionLabel}`.localeCompare(`${rightUnit.subjectStableId}|${rightUnit.judgmentPartitionLabel}`));
const pickedRecordListOf = (outcome) => blockOf(outcome).decisionRecordList.filter((oneRecord) => typeof oneRecord.objectStableId === 'string' && oneRecord.objectStableId.length > 0);
const expectedEdgeLineListOf = (outcome) =>
	pickedRecordListOf(outcome)
		.reduce((soFar, oneRecord) => soFar.concat(oneRecord.instanceStableIdList.map((fieldStableId) => `${fieldStableId} → ${oneRecord.objectStableId} ⟨${oneRecord.subjectStableId}⟩`)), [])
		.sort();
const writtenEdgeLineListOf = (outcome) => edgesOf(outcome).map((oneEdge) => `${oneEdge.fromStableId} → ${oneEdge.toStableId} ⟨${oneEdge.properties.judgedSubjectStableId}⟩`).sort();

// ---------------------------------------------------------------------
// D1-REGISTER (a)
// ---------------------------------------------------------------------
// registryOutcomeFor — discovery over the scratch forges tree (the shipped plugin, or a twin's copy of it); the registry
// THROWS by name on any refusal, which is its declared interface, so the throw is caught here as the observation
const registryOutcomeFor = (scenario) => {
	const forgesDirPath = makeSifForgesDir(scenario);
	const requireModule = (pluginFilePath) => {
		const loaded = require(pluginFilePath);
		return scenario.declarationEdit !== undefined && loaded.bridgeDeclaration.bridgeName === PLUGIN_NAME ? { bridgeDeclaration: (() => { const edited = shippedDeclaration(); scenario.declarationEdit(edited); return edited; })(), bridgeHooks: loaded.bridgeHooks } : loaded;
	};
	try {
		const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath, requireModule });
		const looked = pluginRegistryLib.lookupPlugin({ registry, bridgeName: PLUGIN_NAME, standardKey: STANDARD_KEY });
		return { looked, forgesDirPath };
	} catch (registryThrow) {
		return { thrownText: registryThrow.message, forgesDirPath };
	}
};
const REAL_REGISTRY_NAME_LIST = Object.freeze(Object.keys(pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: REAL_FORGES_DIR }).entryByBridgeName).sort());
const shippedIdentifierList = () => JSON.parse(fs.readFileSync(path.join(SHIPPED_BRIDGES_DIR, IDENTIFIER_LIST_FILE_NAME), 'utf8'));

const registerConjunctList = [
	pureConjunct({
		conjunctId: 'a_registryAcceptsThePlugin',
		title: `(a) discovery over forges/ registers '${PLUGIN_NAME}' under standardKey '${STANDARD_KEY}' with no judge built and no spend, and the same file registers from a scratch copy of its folder`,
		twinNameList: ['neighbourVoteRemoved', 'neo4jDriverRequired'],
		judge: (scenario) => {
			const scratchOutcome = registryOutcomeFor(scenario);
			const realListed = REAL_REGISTRY_NAME_LIST.indexOf(PLUGIN_NAME) !== -1;
			const scratchAccepted = scratchOutcome.thrownText === undefined && scratchOutcome.looked.error === undefined;
			return { pass: realListed && scratchAccepted, detail: scratchAccepted ? `registered; real forges/ lists [${REAL_REGISTRY_NAME_LIST.join(', ')}]` : `REFUSED: ${(scratchOutcome.thrownText || scratchOutcome.looked.error.message).slice(0, 360)}` };
		},
	}),
	pureConjunct({
		conjunctId: 'aPrime_identifierListShape',
		title: `(a′) the identifier list holds ${IDENTIFIER_LIST_COUNT} unique bare six-digit ids, sorted: never empty (an empty list matches every prompt), never the P-form the pattern already catches`,
		twinNameList: ['identifierListEmptied'],
		judge: (scenario) => {
			const identifierList = scenario.identifierListTransform === undefined ? shippedIdentifierList() : scenario.identifierListTransform(shippedIdentifierList());
			const allBare = identifierList.every((oneId) => typeof oneId === 'string' && /^\d{6}$/.test(oneId));
			const sortedUnique = identifierList.every((oneId, idIndex) => idIndex === 0 || identifierList[idIndex - 1] < oneId);
			return { pass: identifierList.length === IDENTIFIER_LIST_COUNT && allBare && sortedUnique, detail: `${identifierList.length} id(s); all bare six digits ${allBare}; sorted and unique ${sortedUnique}` };
		},
	}),
	pureConjunct({
		conjunctId: 'aTriple_scopeListOmitsOnlyTheLeak',
		title: `(a‴) the shipped scope list holds ${SCOPE_LIST_COUNT} unique Question stableIds, sorted, and not the one whose SIF description names a CEDS id (${EXCLUDED_IDENTIFIER_LEAK_QUESTION.slice(0, 40)}…)`,
		twinNameList: ['leakQuestionRestored'],
		judge: (scenario) => {
			const shippedScopeList = JSON.parse(fs.readFileSync(path.join(SHIPPED_BRIDGES_DIR, SCOPE_LIST_FILE_NAME), 'utf8'));
			const scopeList = scenario.shippedScopeListTransform === undefined ? shippedScopeList : scenario.shippedScopeListTransform(shippedScopeList.slice());
			const allQuestions = scopeList.every((stableId) => typeof stableId === 'string' && stableId.indexOf('sif260928:question/') === 0);
			const sortedUnique = scopeList.every((stableId, listIndex) => listIndex === 0 || scopeList[listIndex - 1] < stableId);
			const leakAbsent = scopeList.indexOf(EXCLUDED_IDENTIFIER_LEAK_QUESTION) === -1;
			return { pass: scopeList.length === SCOPE_LIST_COUNT && allQuestions && sortedUnique && leakAbsent, detail: `${scopeList.length} id(s); all Questions ${allQuestions}; sorted and unique ${sortedUnique}; the leaking Question absent ${leakAbsent}` };
		},
	}),
	runConjunct({
		conjunctId: 'aDoublePrime_listedBareIdRefused',
		title: `(a″) a listed bare id (${PLANTED_BARE_ID}) planted in the model question's description refuses the run, naming the identifierList pattern`,
		twinNameList: ['plantedIdDroppedFromList'],
		shape: (scenario) => {
			scenario.plantedModelDescription = `The locally assigned identifier of the person (see ${PLANTED_BARE_ID}).`;
			sifShape(scenario);
		},
		judge: nameInRefusal(new RegExp(`prompt identifier scan hit for subject ${MODEL_QUESTION}: pattern 'identifierList' matched '${PLANTED_BARE_ID}'`)),
	}),
];
scenarioTwin({ registry: twinRegistry, gateId: 'D1-REGISTER', conjunctId: 'a_registryAcceptsThePlugin', twinName: 'neighbourVoteRemoved', leverKind: 'inputFault', mutate: (scenario) => { scenario.declarationEdit = (bridgeDeclaration) => { delete bridgeDeclaration.candidateRetrieval.neighbourVote; }; } });
scenarioTwin({ registry: twinRegistry, gateId: 'D1-REGISTER', conjunctId: 'a_registryAcceptsThePlugin', twinName: 'neo4jDriverRequired', leverKind: 'inputFault', mutate: (scenario) => { scenario.pluginTextTransform = (pluginText) => pluginText.replace("'use strict';\n", "'use strict';\n\nrequire('neo4j-driver');\n"); } });
scenarioTwin({ registry: twinRegistry, gateId: 'D1-REGISTER', conjunctId: 'aPrime_identifierListShape', twinName: 'identifierListEmptied', leverKind: 'inputFault', mutate: (scenario) => { scenario.identifierListTransform = () => []; } });
scenarioTwin({ registry: twinRegistry, gateId: 'D1-REGISTER', conjunctId: 'aTriple_scopeListOmitsOnlyTheLeak', twinName: 'leakQuestionRestored', leverKind: 'inputFault', mutate: (scenario) => { scenario.shippedScopeListTransform = (scopeList) => scopeList.concat([EXCLUDED_IDENTIFIER_LEAK_QUESTION]).sort(); } });
scenarioTwin({ registry: twinRegistry, gateId: 'D1-REGISTER', conjunctId: 'aDoublePrime_listedBareIdRefused', twinName: 'plantedIdDroppedFromList', leverKind: 'inputFault', mutate: (scenario) => { scenario.identifierListTransform = (identifierList) => identifierList.filter((oneId) => oneId !== PLANTED_BARE_ID); } });

// ---------------------------------------------------------------------
// D1-FANOUT (b)
// ---------------------------------------------------------------------
const INSTANCE_EXPANSION_FIND = ': oneRecord.instanceStableIdList.map((instanceStableId) => ({ record: oneRecord, fromStableId: instanceStableId, instanceStableId })),';
const fanoutConjunctList = [
	runConjunct({
		conjunctId: 'b1_threeUnitsByDomain',
		title: '(b) the block holds exactly three units, equal to the literal: the model question once per CEDS domain of its objects (K12 Staff Employment, K12 Student Enrollment), each with its own Field; the SIF_Metadata question once, label null, with both Fields',
		twinNameList: ['metadataRuleDropped'],
		shape: sifShape,
		judge: succeeded((runReport, outcome) => {
			const unitList = unitListOf(outcome);
			return { pass: JSON.stringify(unitList) === JSON.stringify(UNIT_LITERAL), detail: JSON.stringify(unitList) };
		}),
	}),
	runConjunct({
		conjunctId: 'b2_oneEdgePerFieldToItsUnitsCard',
		title: "(b) every unit is picked, and the written edges are exactly one per Field, from the Field to its unit's card, each naming its question as judgedSubjectStableId; all four Fields are reached",
		twinNameList: ['oneInstanceSkipped'],
		shape: sifShape,
		judge: succeeded((runReport, outcome) => {
			const pickedCount = pickedRecordListOf(outcome).length;
			const writtenLineList = writtenEdgeLineListOf(outcome);
			const expectedLineList = expectedEdgeLineListOf(outcome);
			const fromList = Array.from(new Set(edgesOf(outcome).map((oneEdge) => oneEdge.fromStableId))).sort();
			const pass = pickedCount === UNIT_LITERAL.length && JSON.stringify(writtenLineList) === JSON.stringify(expectedLineList) && JSON.stringify(fromList) === JSON.stringify(FIELD_STABLE_ID_LIST) && runReport.edgesWritten === FIELD_STABLE_ID_LIST.length;
			return { pass, detail: `${pickedCount} picked; edgesWritten ${runReport.edgesWritten}; written ${JSON.stringify(writtenLineList)}` };
		}),
	}),
	runConjunct({
		conjunctId: 'b3_promptStatesDomainAndHidesAnswer',
		title: "(b) each of the three prompts states its own unit's domain as an objectDomain line (none on the metadata unit), and no prompt carries the answer column: neither the name cedsElementId nor its planted value",
		twinNameList: ['answerColumnShown'],
		shape: sifShape,
		judge: succeeded((runReport, outcome) => {
			const promptList = forensicsOf(outcome).filter((oneEntry) => oneEntry.record && typeof oneEntry.record.userPrompt === 'string').map((oneEntry) => oneEntry.record.userPrompt);
			const domainLineListOf = (onePrompt) => onePrompt.split('\n').filter((oneLine) => /^\s+objectDomain: /.test(oneLine)).map((oneLine) => oneLine.trim());
			const domainLineList = promptList.map((onePrompt) => domainLineListOf(onePrompt).join('|')).sort();
			const leakList = promptList.filter((onePrompt) => onePrompt.indexOf('cedsElementId') !== -1 || onePrompt.indexOf(PLANTED_ANSWER_ID) !== -1);
			const pass = promptList.length === UNIT_LITERAL.length && JSON.stringify(domainLineList) === JSON.stringify(PROMPT_DOMAIN_LINE_LITERAL) && leakList.length === 0;
			return { pass, detail: `${promptList.length} prompt(s); objectDomain lines ${JSON.stringify(domainLineList)}; ${leakList.length} carrying the answer column` };
		}),
	}),
];
scenarioTwin({ registry: twinRegistry, gateId: 'D1-FANOUT', conjunctId: 'b1_threeUnitsByDomain', twinName: 'metadataRuleDropped', leverKind: 'inputFault', mutate: (scenario) => { scenario.declarationEdit = (bridgeDeclaration) => { bridgeDeclaration.judgmentPartition.unpartitionedSubjectRule = null; }; } });
scenarioTwin({ registry: twinRegistry, gateId: 'D1-FANOUT', conjunctId: 'b3_promptStatesDomainAndHidesAnswer', twinName: 'answerColumnShown', leverKind: 'inputFault', mutate: (scenario) => { scenario.declarationEdit = (bridgeDeclaration) => { bridgeDeclaration.blindingDeclaration = bridgeDeclaration.blindingDeclaration.filter((propertyName) => propertyName !== 'cedsElementId'); bridgeDeclaration.renderingAllowList.subject.push('cedsElementId'); delete bridgeDeclaration.promptIdentifierScan; }; } });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'D1-FANOUT', conjunctId: 'b2_oneEdgePerFieldToItsUnitsCard', twinName: 'oneInstanceSkipped', fileName: MATERIALISER_FILE, find: INSTANCE_EXPANSION_FIND, replace: INSTANCE_EXPANSION_FIND.replace('instanceStableIdList.map(', 'instanceStableIdList.slice(1).map(') });

// ---------------------------------------------------------------------
// D1-SSSOM (c)
// ---------------------------------------------------------------------
const sssomConjunctList = [
	runConjunct({
		conjunctId: 'c_sssomSubjectsArePrefixedFields',
		title: "(c) the run's SSSOM export is written and passes the subject-prefix check: one row per written edge, every subject_id a Field stableId beginning 'sif260928:field/'",
		twinNameList: ['unprefixedFieldInGraph'],
		shape: sifShape,
		judge: succeeded((runReport, outcome) => {
			const parsed = sssomExporterLib.parseSssomTsv(fs.readFileSync(runReport.sssomExportPath, 'utf8'));
			const subjectList = parsed.error ? [] : parsed.rowList.map((oneRow) => oneRow.subject_id).sort();
			const pass = !parsed.error && subjectList.length === edgesOf(outcome).length && JSON.stringify(subjectList) === JSON.stringify(FIELD_STABLE_ID_LIST);
			return { pass, detail: parsed.error || `subject_id ${JSON.stringify(subjectList)}` };
		}),
	}),
];
// the twin forges one Field WITHOUT the standard's prefix: the exporter must refuse it, so the conjunct cannot succeed
const UNPREFIXED_FIELD = STAFF_LOCAL_ID.replace(`${STANDARD_KEY}:`, '');
scenarioTwin({
	registry: twinRegistry,
	gateId: 'D1-SSSOM',
	conjunctId: 'c_sssomSubjectsArePrefixedFields',
	twinName: 'unprefixedFieldInGraph',
	leverKind: 'inputFault',
	mutate: (scenario) => {
		scenario.graphEdit = (graph) => {
			const renamed = (stableId) => (stableId === STAFF_LOCAL_ID ? UNPREFIXED_FIELD : stableId);
			graph.nodeList.forEach((oneNode) => {
				oneNode.stableId = renamed(oneNode.stableId);
				oneNode.properties.stableId = renamed(oneNode.properties.stableId);
			});
			graph.edgeList.forEach((oneEdge) => {
				oneEdge.toStableId = renamed(oneEdge.toStableId);
			});
		};
	},
});

// ---------------------------------------------------------------------
// B6-HARVEST (a) — the relationship harvest under fan-out
// ---------------------------------------------------------------------
// harvestedConservationOf — the double's harvest of the block entry's label, narrowed by the entry's own
// harvestEdgeTypeList (the value build.js passes to replayManager.harvest), put in the engine's edge shape and compared
// by the SAME compareConservation the build runs, against the writer's loaded summary the entry carries
const harvestedConservationOf = (runReport, outcome) => {
	const blockEntry = runReport.blocks[0];
	const harvest = outcome.graphDouble.harvestByLabel({ applyLabel: blockEntry.applyLabel, edgeTypeList: blockEntry.harvestEdgeTypeList });
	const engineEdgeList = harvest.edgeList.map((oneEdge) => ({ type: oneEdge.type, fromRef: { id: oneEdge.fromStableId }, toRef: { id: oneEdge.toStableId }, properties: oneEdge.properties }));
	const conservationReport = compareConservation({ expectation: blockEntry.loadedConservationSummary, harvested: replayEngineLib.conservationSummaryFor({ nodes: harvest.nodeList, edges: engineEdgeList }), graphName: 'graphDouble' });
	return { harvest, conservationReport };
};
const edgeLineOf = (oneEdge, propertiesOf) => `${oneEdge.fromStableId} -${oneEdge.type}-> ${oneEdge.toStableId} ${JSON.stringify(propertiesOf(oneEdge.properties))}`;
const listWrapped = (properties) => Object.keys(properties).sort().reduce((soFar, oneName) => ({ ...soFar, [oneName]: Array.isArray(properties[oneName]) ? properties[oneName] : [properties[oneName]] }), {});
const sortedByPropertyName = (properties) => Object.keys(properties).sort().reduce((soFar, oneName) => ({ ...soFar, [oneName]: properties[oneName] }), {});
// the planted base edges whose two ends BOTH carry the pair label after the run: the precondition that gives the gate teeth
const labelledChildEdgeCountOf = (runReport, outcome) => {
	const applyLabel = runReport.blocks[0].applyLabel;
	const labelledSet = new Set(outcome.graphDouble.state.nodeList.filter((oneNode) => oneNode.labels.indexOf(applyLabel) !== -1).map((oneNode) => oneNode.stableId));
	return outcome.graphDouble.state.edgeList.filter((oneEdge) => oneEdge.type === EDGE_TYPES.HAS_CHILD && labelledSet.has(oneEdge.fromStableId) && labelledSet.has(oneEdge.toStableId)).length;
};
const harvestConjunctList = [
	runConjunct({
		conjunctId: 'a_harvestEqualsWrittenEdgesUnderFanout',
		title: `(a) with ${FIELD_CHILD_EDGE_LIST.length} Field -HAS_CHILD-> Field base edges between picked Fields (both ends carrying the pair label), the harvest narrowed by the block entry's harvestEdgeTypeList equals the written edge list exactly, and conservation passes`,
		twinNameList: ['harvestEdgeTypeListDropped', 'doubleTypeFilterDeleted'],
		shape: sifShape,
		judge: succeeded((runReport, outcome) => {
			const { harvest, conservationReport } = harvestedConservationOf(runReport, outcome);
			const harvestedLineList = harvest.edgeList.map((oneEdge) => edgeLineOf(oneEdge, sortedByPropertyName)).sort();
			const writtenLineList = edgesOf(outcome).map((oneEdge) => edgeLineOf(oneEdge, listWrapped)).sort();
			const labelledChildEdgeCount = labelledChildEdgeCountOf(runReport, outcome);
			const pass = labelledChildEdgeCount === FIELD_CHILD_EDGE_LIST.length && writtenLineList.length === FIELD_STABLE_ID_LIST.length && JSON.stringify(harvestedLineList) === JSON.stringify(writtenLineList) && !conservationReport.error;
			// the named edges lead the detail, so an observed red shows WHICH edges the harvest invented or lost
			const conservationText = conservationReport.error ? conservationReport.error.slice(conservationReport.error.indexOf('edges missing')) : conservationReport.statusText;
			return { pass, detail: `${labelledChildEdgeCount} labelled HAS_CHILD; harvested ${harvestedLineList.length}, written ${writtenLineList.length}; ${conservationText}` };
		}),
	}),
	pureConjunct({
		conjunctId: 'aPrime_enginePatternAndRefusals',
		title: "(a′) replay-engine narrows the label harvest's pattern to exactly the stated types (':`T1`|`T2`…'), leaves it untyped when none is stated, and refuses an empty list and a non-identifier by name",
		twinNameList: ['emptyTypeListAccepted'],
		judge: (scenario) => {
			const edgeTypeList = ['CLOSE_MATCH', 'EXACT_MATCH'];
			const patternText = replayEngineLib.edgeTypeMatch(edgeTypeList);
			const untypedText = replayEngineLib.edgeTypeMatch(undefined);
			const refusalOf = scenario.edgeTypeRefusalOverride === undefined ? replayEngineLib.edgeTypeRefusal : scenario.edgeTypeRefusalOverride;
			const emptyRefusal = refusalOf([]);
			const badNameRefusal = refusalOf(['EXACT_MATCH]->(x) DETACH DELETE x //']);
			const pass = patternText === ':`CLOSE_MATCH`|`EXACT_MATCH`' && untypedText === '' && refusalOf(undefined) === '' && refusalOf(edgeTypeList) === '' && /non-empty array/.test(emptyRefusal) && /invalid relationship type name/.test(badNameRefusal);
			return { pass, detail: `pattern ${JSON.stringify(patternText)}; untyped ${JSON.stringify(untypedText)}; empty → ${JSON.stringify(emptyRefusal)}; bad → ${JSON.stringify(badNameRefusal.slice(0, 80))}` };
		},
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'B6-HARVEST', conjunctId: 'a_harvestEqualsWrittenEdgesUnderFanout', twinName: 'harvestEdgeTypeListDropped', fileName: BRIDGE_FRAMEWORK_FILE, find: ', harvestEdgeTypeList: HARVEST_EDGE_TYPE_LIST })),', replace: ' })),' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'B6-HARVEST', conjunctId: 'a_harvestEqualsWrittenEdgesUnderFanout', twinName: 'doubleTypeFilterDeleted', fileName: GRAPH_DOUBLE_FILE, find: '.filter((oneEdge) => edgeTypeList === undefined || edgeTypeList.indexOf(oneEdge.type) !== -1)', replace: '' });
// the engine is not a bridge-framework file, so its twin is an input fault: a refusal that accepts the empty list
scenarioTwin({ registry: twinRegistry, gateId: 'B6-HARVEST', conjunctId: 'aPrime_enginePatternAndRefusals', twinName: 'emptyTypeListAccepted', leverKind: 'inputFault', mutate: (scenario) => { scenario.edgeTypeRefusalOverride = (edgeTypeList) => (Array.isArray(edgeTypeList) && edgeTypeList.length === 0 ? '' : replayEngineLib.edgeTypeRefusal(edgeTypeList)); } });

const gateDeclarationList = [
	{ gateId: 'D1-REGISTER', title: 'the SIF derived plugin registers at zero spend, and its identifier list is well-formed and wired into the scan', conjunctList: registerConjunctList },
	{ gateId: 'D1-FANOUT', title: 'on the graph double, a model question is judged once per CEDS domain and a metadata question once, and each answer is written onto exactly its Fields', conjunctList: fanoutConjunctList },
	{ gateId: 'D1-SSSOM', title: 'the SSSOM export over the fanned-out block passes the subject-prefix check', conjunctList: sssomConjunctList },
	{ gateId: 'B6-HARVEST', title: "under fan-out, the relationship harvest takes exactly the written edges, never the source's own base edges between two picked Fields", conjunctList: harvestConjunctList },
];

runGateFamily(
	{ harness, familyName: 'D1-REGISTER+D1-FANOUT+D1-SSSOM+B6-HARVEST', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 10 },
	() => harness.report(),
);
