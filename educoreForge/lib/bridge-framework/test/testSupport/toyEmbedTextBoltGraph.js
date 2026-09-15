'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// toyEmbedTextBoltGraph.js — TEST SUPPORT (B3b): the toy bridge graph (fixtures/toyBridge/toyGraph.js) with the text
// nodes the forge rules (SPEC-bridgeRevision-091426 §13 R-BR-1, R-BR-1a) and the property-tier cards' decomposition
// slot edges (R-BR-9, R-BR-13) added, for the bolt reader's two text-node reads and its exclusion by role, run
// through testSupport/boltDriverDouble.js. Shared by test-bgEts.js (conjuncts d, m) and test-bgBolt.js.
//
//   embedTextBoltGraph()  → a FRESH { nodeList, edgeList } (a fault may be written into it)
//   EXPECTED_SOURCE_TEXT_RECORD_LIST, EXPECTED_PROPERTY_TIER_SLOT_EDGE_LIST — DERIVED BY HAND, see below
//
// WHAT IT CARRIES, each named where it is built:
//   a source text serving one property, stored as a SCALAR ...... t1GivenName → Student.FirstName, 'description'
//   a source text serving two nodes, one of them twice ........... t2Shared → Student.BirthDate ['description', 'name']
//                                                                 (a LIST) and → Course.Title 'name' (a scalar)
//   a hub text beside them (another _source, never returned) ..... h1FirstName → the hub's P000001 property node
//   every property-tier card with DOMAIN and PROPERTY ............ nine cards, 18 edges
//   RANGE on some cards only (R-BR-13) ........................... P000003.C1 → option set, P000008.C3 → class C3
//   slots the read must NOT return ............................... QUALIFIER on the OV0001 card; IN_HUB on all nine;
//                                                                 DOMAIN on the value-tier card
// Every text node carries `text`, so a record that leaks it is visible. Names are read from lib/vocabulary.

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', '..', '..', 'vocabulary', 'vocabulary'));
const toyGraphLib = require(path.join(__dirname, '..', 'fixtures', 'toyBridge', 'toyGraph'));

const { DME_ROLES, EDGE_TYPES, EMBED_TEXT_VECTOR, IN_HUB_EDGE_TYPE, hubEdgeType } = vocabularyLib;
const { HUB_NAME, SOURCE_STANDARD_NAME } = toyGraphLib;

const TOY_EMBEDDING_MODEL_VERSION = 'toy-embed-text-v1';
const SOURCE_TEXT_ROOT = 'toy:root/embedText';
const HUB_TEXT_ROOT = 'toyhub:root/embedText';

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const textNode = ({ stableId, standardName, text, vector }) => ({
	stableId,
	labels: ['ForgedNode', 'ToyEmbedText', DME_ROLES.EMBED_TEXT],
	properties: {
		stableId,
		text,
		role: DME_ROLES.EMBED_TEXT,
		_source: standardName,
		[EMBED_TEXT_VECTOR.propertyName]: vector,
		embeddingModelVersion: TOY_EMBEDDING_MODEL_VERSION,
		embedSourceProperty: 'text',
		vectorPropertyName: EMBED_TEXT_VECTOR.propertyName,
	},
});
const textEdge = ({ textStableId, describedStableId, propertyNameList }) => ({ fromStableId: textStableId, toStableId: describedStableId, type: EDGE_TYPES.EMBEDS_TEXT_OF, properties: { propertyNameList, provenanceTier: 'structural' } });

const SOURCE_TEXT_ID = Object.freeze({ givenName: `${SOURCE_TEXT_ROOT}/t1GivenName`, shared: `${SOURCE_TEXT_ROOT}/t2Shared` });
const HUB_TEXT_ID = Object.freeze({ firstName: `${HUB_TEXT_ROOT}/h1FirstName` });

// hub base nodes the cards decompose into
const hubBaseNode = ({ stableId, role }) => ({ stableId, labels: [role], properties: { stableId, role, _source: HUB_NAME } });
const hubClassId = (domainId) => `toyhub:class/${domainId}`;
const hubPropertyId = (canonicalKey) => `toyhub:property/${canonicalKey}`;
const HUB_OPTION_SET_ID = 'toyhub:optionSet/Ethnicity';
const HUB_OPTION_VALUE_ID = 'toyhub:optionValue/OV0001';
const HUB_DEFINITION_ID = 'toyhub:definition';
const RANGE_TARGET_BY_CARD_STABLE_ID = Object.freeze({ 'toyhub:card/P000003.C1': HUB_OPTION_SET_ID, 'toyhub:card/P000008.C3': hubClassId('C3') });
const QUALIFIER_TARGET_BY_CARD_STABLE_ID = Object.freeze({ 'toyhub:card/P000005.C1.OV0001': HUB_OPTION_VALUE_ID });

const embedTextBoltGraph = () => {
	const graph = toyGraphLib.toyGraph();
	const cardList = graph.nodeList.filter((oneNode) => oneNode.labels.indexOf('HubReference') !== -1);
	const baseNodeList = []
		.concat(Array.from(new Set(cardList.map((oneCard) => oneCard.properties.domainId))).map((oneDomainId) => hubBaseNode({ stableId: hubClassId(oneDomainId), role: DME_ROLES.CLASS })))
		.concat(Array.from(new Set(cardList.map((oneCard) => oneCard.properties.canonicalKey))).map((oneCanonicalKey) => hubBaseNode({ stableId: hubPropertyId(oneCanonicalKey), role: DME_ROLES.PROPERTY })))
		.concat([hubBaseNode({ stableId: HUB_OPTION_SET_ID, role: DME_ROLES.OPTION_SET }), hubBaseNode({ stableId: HUB_OPTION_VALUE_ID, role: DME_ROLES.OPTION_VALUE }), hubBaseNode({ stableId: HUB_DEFINITION_ID, role: 'HubDefinition' })]);
	const slotEdge = (cardStableId, edgeType, baseStableId) => ({ fromStableId: cardStableId, toStableId: baseStableId, type: edgeType, properties: { provenanceTier: 'structural' } });
	const slotEdgeList = [];
	cardList.forEach((oneCard) => {
		slotEdgeList.push(slotEdge(oneCard.stableId, hubEdgeType(HUB_NAME, 'DOMAIN'), hubClassId(oneCard.properties.domainId)));
		if (oneCard.properties.referenceTier !== 'property') {
			return;
		}
		slotEdgeList.push(slotEdge(oneCard.stableId, hubEdgeType(HUB_NAME, 'PROPERTY'), hubPropertyId(oneCard.properties.canonicalKey)));
		slotEdgeList.push(slotEdge(oneCard.stableId, IN_HUB_EDGE_TYPE, HUB_DEFINITION_ID));
		if (RANGE_TARGET_BY_CARD_STABLE_ID[oneCard.stableId] !== undefined) {
			slotEdgeList.push(slotEdge(oneCard.stableId, hubEdgeType(HUB_NAME, 'RANGE'), RANGE_TARGET_BY_CARD_STABLE_ID[oneCard.stableId]));
		}
		if (QUALIFIER_TARGET_BY_CARD_STABLE_ID[oneCard.stableId] !== undefined) {
			slotEdgeList.push(slotEdge(oneCard.stableId, hubEdgeType(HUB_NAME, 'QUALIFIER'), QUALIFIER_TARGET_BY_CARD_STABLE_ID[oneCard.stableId]));
		}
	});
	const textNodeList = [
		textNode({ stableId: SOURCE_TEXT_ID.givenName, standardName: SOURCE_STANDARD_NAME, text: 'The given name of the student.', vector: [1, 0, 0, 0] }),
		textNode({ stableId: SOURCE_TEXT_ID.shared, standardName: SOURCE_STANDARD_NAME, text: 'A toy text shared by two nodes.', vector: [0, 1, 0, 0] }),
		textNode({ stableId: HUB_TEXT_ID.firstName, standardName: HUB_NAME, text: 'First Name', vector: [0, 0, 1, 0] }),
	];
	const textEdgeList = [
		textEdge({ textStableId: SOURCE_TEXT_ID.givenName, describedStableId: 'toy:property/Student.FirstName', propertyNameList: 'description' }),
		textEdge({ textStableId: SOURCE_TEXT_ID.shared, describedStableId: 'toy:property/Student.BirthDate', propertyNameList: ['description', 'name'] }),
		textEdge({ textStableId: SOURCE_TEXT_ID.shared, describedStableId: 'toy:property/Course.Title', propertyNameList: 'name' }),
		textEdge({ textStableId: HUB_TEXT_ID.firstName, describedStableId: hubPropertyId('P000001'), propertyNameList: 'name' }),
	];
	return { nodeList: cloneJson(graph.nodeList.concat(baseNodeList, textNodeList)), edgeList: cloneJson(graph.edgeList.concat(slotEdgeList, textEdgeList)) };
};

// EXPECTED_SOURCE_TEXT_RECORD_LIST — readEmbedTextVectors({ standardName: 'Toy' }), by hand: one record per source text
// edge, ordered by textStableId ('…/t1GivenName' < '…/t2Shared') then sourceStableId ('toy:property/Course.Title' <
// 'toy:property/Student.BirthDate'); the two scalars come back as one-element lists, the list unchanged
const EXPECTED_SOURCE_TEXT_RECORD_LIST = Object.freeze([
	{ textStableId: SOURCE_TEXT_ID.givenName, vector: [1, 0, 0, 0], embeddingModelVersion: TOY_EMBEDDING_MODEL_VERSION, sourceStableId: 'toy:property/Student.FirstName', sourceRole: 'property', propertyNameList: ['description'] },
	{ textStableId: SOURCE_TEXT_ID.shared, vector: [0, 1, 0, 0], embeddingModelVersion: TOY_EMBEDDING_MODEL_VERSION, sourceStableId: 'toy:property/Course.Title', sourceRole: 'property', propertyNameList: ['name'] },
	{ textStableId: SOURCE_TEXT_ID.shared, vector: [0, 1, 0, 0], embeddingModelVersion: TOY_EMBEDDING_MODEL_VERSION, sourceStableId: 'toy:property/Student.BirthDate', sourceRole: 'property', propertyNameList: ['description', 'name'] },
]);

// EXPECTED_PROPERTY_TIER_SLOT_EDGE_COUNT_BY_SLOT — readCardBaseEdges({ referenceTier: 'property' }), by hand: nine
// property-tier cards each with one DOMAIN and one PROPERTY edge, RANGE on two; QUALIFIER, IN_HUB and the value-tier
// card's DOMAIN are not returned (20 records)
const EXPECTED_PROPERTY_TIER_SLOT_EDGE_COUNT_BY_SLOT = Object.freeze({ DOMAIN: 9, PROPERTY: 9, RANGE: 2 });
const PROPERTY_TIER_CARD_WITHOUT_RANGE_STABLE_ID = 'toyhub:card/P000001.C1';

module.exports = {
	embedTextBoltGraph,
	EXPECTED_SOURCE_TEXT_RECORD_LIST,
	EXPECTED_PROPERTY_TIER_SLOT_EDGE_COUNT_BY_SLOT,
	PROPERTY_TIER_CARD_WITHOUT_RANGE_STABLE_ID,
	SOURCE_TEXT_ID,
	HUB_TEXT_ID,
	HUB_NAME,
	SOURCE_STANDARD_NAME,
	TOY_EMBEDDING_MODEL_VERSION,
	moduleName,
};
