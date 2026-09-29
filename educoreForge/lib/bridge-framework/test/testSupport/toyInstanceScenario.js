'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// toyInstanceScenario.js — TEST SUPPORT (phase B4a): the derived toy over subjects that stand for instances. Two
// questions over five fields in three objects, joined by HAS_INSTANCE, with materialisationFanout declared. Shared by
// the fan-out suite (test-bgMaterialisationFanout.js) and the partition suite (test-bgJudgmentPartition.js), which lays
// judgmentPartition over it.
//
//   derivedShape(scenario)                 the toy derived plugin over the toy graph, embeddings stamped with the model
//   instanceShapeWith(mutateDeclaration)   → shape: derivedShape plus the question/field nodes and edges, subjects read
//                                          from the ToyQuestion label, fan-out declared; mutateDeclaration adjusts the
//                                          declaration after; a twin's scenario.instanceEdgeFilter drops instance edges
//                                          before they reach the graph

const path = require('path');
const scenarioLib = require('./toyBridgeScenario');

const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const TOY_EMBED_MODEL = 'toy-embed-v1';
const INSTANCE_EDGE_TYPE = 'HAS_INSTANCE';
const IDENTIFIER_QUESTION = 'toy:question/Identifier';
const TIMESTAMP_QUESTION = 'toy:question/Timestamp';
const TOY_BUNDLE_DIR = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy');
const cloneJson = scenarioLib.cloneJson;

const questionNode = ({ element, description, sharedBlock }) => ({
	stableId: `toy:question/${element}`,
	labels: ['ToyQuestion'],
	properties: { stableId: `toy:question/${element}`, name: element, description, role: 'property', sharedBlock, _source: scenarioLib.toyGraphLib.SOURCE_STANDARD_NAME, embedding: scenarioLib.toyGraphLib.EMBEDDING.slice(), embeddingModelVersion: TOY_EMBED_MODEL },
});
const fieldNode = ({ objectName, element }) => ({
	stableId: `toy:field/${objectName}.${element}`,
	labels: ['ToyField'],
	properties: { stableId: `toy:field/${objectName}.${element}`, name: element, objectName, role: 'support', _source: scenarioLib.toyGraphLib.SOURCE_STANDARD_NAME },
});
const INSTANCE_NODE_LIST = Object.freeze([
	questionNode({ element: 'Identifier', description: 'The identifier of the record subject.', sharedBlock: 'model' }),
	questionNode({ element: 'Timestamp', description: 'When the record was last changed.', sharedBlock: 'ToyMetadata' }),
	fieldNode({ objectName: 'StudentRecord', element: 'Identifier' }),
	fieldNode({ objectName: 'StudentEnrollment', element: 'Identifier' }),
	fieldNode({ objectName: 'StaffRecord', element: 'Identifier' }),
	fieldNode({ objectName: 'StudentRecord', element: 'Timestamp' }),
	fieldNode({ objectName: 'StaffRecord', element: 'Timestamp' }),
]);
// graph order is deliberately NOT sorted within either subject, so a frozen list that is sorted was sorted by the freeze
const instanceEdge = (fromStableId, toStableId) => ({ fromStableId, toStableId, type: INSTANCE_EDGE_TYPE, properties: { provenanceTier: 'structural' } });
const INSTANCE_EDGE_LIST = Object.freeze([
	instanceEdge(IDENTIFIER_QUESTION, 'toy:field/StudentRecord.Identifier'),
	instanceEdge(IDENTIFIER_QUESTION, 'toy:field/StudentEnrollment.Identifier'),
	instanceEdge(IDENTIFIER_QUESTION, 'toy:field/StaffRecord.Identifier'),
	instanceEdge(TIMESTAMP_QUESTION, 'toy:field/StudentRecord.Timestamp'),
	instanceEdge(TIMESTAMP_QUESTION, 'toy:field/StaffRecord.Timestamp'),
]);
const fanoutDeclarationFixture = () => ({ kind: 'edgeFromSubject', edgeType: INSTANCE_EDGE_TYPE });

const toyDerivedDeclaration = () => cloneJson(require(path.join(TOY_BUNDLE_DIR, 'bridges', `${DERIVED_PLUGIN_NAME}.js`)).bridgeDeclaration);
const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};
const instanceShapeWith = (mutateDeclaration) => (scenario) => {
	derivedShape(scenario);
	scenario.graph.nodeList = scenario.graph.nodeList.concat(cloneJson(INSTANCE_NODE_LIST));
	scenario.graph.edgeList = scenario.graph.edgeList.concat(cloneJson(INSTANCE_EDGE_LIST).filter(scenario.instanceEdgeFilter === undefined ? () => true : scenario.instanceEdgeFilter));
	const bridgeDeclaration = toyDerivedDeclaration();
	bridgeDeclaration.subjectSource = { kind: 'graphLabel', label: 'ToyQuestion', scopeStableIdListPath: null };
	bridgeDeclaration.materialisationFanout = fanoutDeclarationFixture();
	if (mutateDeclaration !== undefined) {
		mutateDeclaration(bridgeDeclaration, scenario);
	}
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = { bridgeDeclaration };
};

module.exports = {
	DERIVED_PLUGIN_NAME,
	TOY_EMBED_MODEL,
	INSTANCE_EDGE_TYPE,
	IDENTIFIER_QUESTION,
	TIMESTAMP_QUESTION,
	TOY_BUNDLE_DIR,
	INSTANCE_NODE_LIST,
	INSTANCE_EDGE_LIST,
	derivedShape,
	instanceShapeWith,
	moduleName,
};
