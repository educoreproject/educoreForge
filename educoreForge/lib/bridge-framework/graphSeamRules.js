'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// graphSeamRules.js — the PURE rules of the two bolt-facing seams, shared by graphReader.js, graphWriter.js
// AND graphDouble.js so the double proves the SAME rules the bolt files enforce (SPEC-bridgeFramework-v1.md
// §4.2 sourceReader, §5.2 step 1, §5.7, §6; RULINGS P8, BF2, BF7, BF12, 12:05 #2, 12:20). Not in the SPEC
// §14.1 file list by name — a named DEVLOG deviation: the rules exist ONCE, the I/O twice (bolt) + once (double).
//
//   readerConstructionRefusal / writerConstructionRefusal   the factory argument refusals
//   shapeHubCardList({ rawRecordList, referenceTier })       ONE flatten of a card: list slots RE-WIDENED
//                                                            (qualifierKeys / qualifierNames scalar → [scalar]),
//                                                            embedding present-or-refused (BR-123)
//   withoutEmbedding(record)                                 subject nodes never carry the vector
//   blindedRecordFor({ record, blindingDeclaration })        forEvidence(): every declared name REMOVED
//   blindedEdgeFor / walkEdgeFor                             the same two rules over an EDGE's properties (BR6)
//   walkRecordFor({ record, blindingDeclaration, channelPropertyList })  forWalk(): declared channel properties
//                                                            readable, any OTHER blinded name REFUSED on read
//   closedView / closedReader / closedWriter                 Proxies asserting the CLOSED member sets (BG-CONTAIN)
//   mappingEdgeRefusal({...})                                the §6 write-seam refusals incl. the MAPPING_PROPERTIES
//                                                            closed-set check (NEW enforcement, RULING BF12) and the
//                                                            producer-derived provenanceTier (RULING 12:20)

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { TUPLE_LIST_FIELD_LIST } = require('./bridgePluginContract');

const { SKOS_EDGE_TYPES, SKOS_PREDICATES, MAPPING_PROPERTIES, MAPPING_PROPERTY_NAME_LIST, MAPPING_EDGE_PERMITTED_PROVENANCE_TIER_LIST, SSSOM_JUSTIFICATIONS, sssomJustificationRefusal } = vocabularyLib;

const HUB_REFERENCE_LABEL = 'HubReference';
const PROPERTY_TIER = 'property';
const CARD_LIST_SLOT_LIST = Object.freeze(TUPLE_LIST_FIELD_LIST.concat(['qualifierNames']));
const CARD_REQUIRED_PROPERTY_LIST = Object.freeze(['stableId', 'canonicalKey', 'referenceTier', 'hubName', 'hubVersion', 'name']);
const READER_MEMBER_LIST = Object.freeze(['readHubCards', 'readSubjectNodes', 'forWalk', 'forEvidence', 'close']);
const VIEW_MEMBER_LIST = Object.freeze(['readSourceNodes', 'readNodesByStableId', 'readEdgesAmongSource']);
const WRITER_MEMBER_LIST = Object.freeze(['writeMappingEdge', 'close']);
const EDGE_TYPE_BY_PREDICATE = SKOS_EDGE_TYPES;
const PREDICATE_BY_EDGE_TYPE = Object.freeze(Object.keys(SKOS_EDGE_TYPES).reduce((soFar, onePredicate) => ({ ...soFar, [SKOS_EDGE_TYPES[onePredicate]]: onePredicate }), {}));
const JUDGED_ONLY_PROPERTY_LIST = Object.freeze([MAPPING_PROPERTIES.CONFIDENCE, MAPPING_PROPERTIES.MAPPING_TOOL, MAPPING_PROPERTIES.MAPPING_TOOL_VERSION]);
const EVERY_EDGE_REQUIRED_PROPERTY_LIST = Object.freeze([
	MAPPING_PROPERTIES.PREDICATE,
	MAPPING_PROPERTIES.MAPPING_JUSTIFICATION,
	MAPPING_PROPERTIES.MATCH_BASIS,
	MAPPING_PROPERTIES.RESOLUTION,
	MAPPING_PROPERTIES.MAPPING_PROVIDER,
	MAPPING_PROPERTIES.SUBJECT_MATCH_FIELD,
	MAPPING_PROPERTIES.OBJECT_MATCH_FIELD,
	MAPPING_PROPERTIES.SUBJECT_SOURCE,
	MAPPING_PROPERTIES.SUBJECT_VERSION,
	MAPPING_PROPERTIES.OBJECT_SOURCE,
	MAPPING_PROPERTIES.OBJECT_VERSION,
	MAPPING_PROPERTIES.PREDICATE_ASSERTED_BY,
	MAPPING_PROPERTIES.ATTESTATION_CHANNEL_LIST,
	MAPPING_PROPERTIES.DECISION_BLOCK_HASH,
	MAPPING_PROPERTIES.PROVENANCE_TIER,
]);

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

const readerConstructionRefusal = ({ inGraph, dependencyStandardNameList, sourceStandardName, blindingDeclaration } = {}) => {
	if (!isPlainObject(inGraph)) {
		return refuse.byName({ moduleName, what: 'graphReaderFactory: inGraph is absent', where: 'the materialized dependency GraphHandle; there is no default' });
	}
	if (!Array.isArray(dependencyStandardNameList) || dependencyStandardNameList.length === 0 || dependencyStandardNameList.some((oneName) => !isNonEmptyString(oneName))) {
		return refuse.byName({ moduleName, what: 'graphReaderFactory: dependencyStandardNameList must be a non-empty list of names', where: 'the reader is scoped at construction to the recipe\'s declared dependencies (BR-002, BR-093)' });
	}
	if (!isNonEmptyString(sourceStandardName)) {
		return refuse.byName({ moduleName, what: 'graphReaderFactory: sourceStandardName is required', where: 'the source scope is EXACT (BR-023); the hub is MEASURED from the cards (one hub per pairing)' });
	}
	if (!Array.isArray(blindingDeclaration) || blindingDeclaration.some((oneName) => !isNonEmptyString(oneName))) {
		return refuse.byName({ moduleName, what: 'graphReaderFactory: blindingDeclaration must be a list of property names ([] valid, absent refused)', where: 'the ONE flatten applies the blinding declaration at entry (BR-090, BR-091)' });
	}
	return null;
};

const writerConstructionRefusal = ({ inGraph, applyLabel, sourceStandardName } = {}) => {
	if (!isPlainObject(inGraph)) {
		return refuse.byName({ moduleName, what: 'graphWriterFactory: inGraph is absent', where: 'the materialized dependency GraphHandle; there is no default' });
	}
	if (!isNonEmptyString(applyLabel) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(applyLabel)) {
		return refuse.byName({ moduleName, what: `graphWriterFactory: applyLabel ${JSON.stringify(applyLabel)} is not a label`, where: 'the PAIR-SCOPED label the block declares (RULING BF2)' });
	}
	if (!isNonEmptyString(sourceStandardName)) {
		return refuse.byName({ moduleName, what: 'graphWriterFactory: sourceStandardName is required', where: 'a subject endpoint whose _source is not the pairing\'s source is refused (§6)' });
	}
	return null;
};

// reWidenListSlots — a one-element PG-JSON array stored as a SCALAR is re-widened at the read boundary
const reWidenListSlots = (properties) => {
	const widened = { ...properties };
	CARD_LIST_SLOT_LIST.forEach((oneSlot) => {
		if (widened[oneSlot] === undefined || widened[oneSlot] === null) {
			return;
		}
		if (!Array.isArray(widened[oneSlot])) {
			widened[oneSlot] = widened[oneSlot] === '' ? [] : [widened[oneSlot]];
		}
	});
	return widened;
};

// shapeHubCardList — cards flattened (properties + stableId), list slots re-widened, embedding present-or-refused
const shapeHubCardList = ({ rawRecordList, referenceTier } = {}) => {
	const cardList = [];
	for (let recordIndex = 0; recordIndex < rawRecordList.length; recordIndex++) {
		const oneRecord = rawRecordList[recordIndex];
		const card = { ...reWidenListSlots(oneRecord.properties), stableId: oneRecord.stableId };
		const missing = CARD_REQUIRED_PROPERTY_LIST.find((oneName) => card[oneName] === undefined || card[oneName] === null || card[oneName] === '');
		if (missing !== undefined) {
			return { error: refuse.byName({ moduleName, what: `hub card ${JSON.stringify(oneRecord.stableId)} lacks '${missing}'`, where: 'every HubReference card carries the tuple fields, stableId, hubName, hubVersion, name' }) };
		}
		if (card.referenceTier !== referenceTier) {
			return { error: refuse.byName({ moduleName, what: `hub card ${card.stableId} is tier '${card.referenceTier}' in a '${referenceTier}' read`, where: 'value-tier cards are not read in v1 (BR-080)' }) };
		}
		if (!Array.isArray(card.embedding) && !(typeof card.embedding === 'string' && card.embedding.length > 0)) {
			return { error: refuse.byName({ moduleName, what: `hub card ${card.stableId} (${card.canonicalKey}) carries no embedding`, where: 'a vectorless candidate is refused; the framework never re-embeds (BR-123)' }) };
		}
		cardList.push(card);
	}
	return { cardList };
};

const withoutEmbedding = (record) => {
	const properties = { ...record.properties };
	delete properties.embedding;
	return { stableId: record.stableId, labels: record.labels.slice(), properties };
};

// blindedRecordFor — forEvidence(): the declared names are REMOVED (a record carries none of them)
const blindedRecordFor = ({ record, blindingDeclaration }) => {
	const properties = { ...record.properties };
	blindingDeclaration.forEach((oneName) => {
		delete properties[oneName];
	});
	return { stableId: record.stableId, labels: record.labels.slice(), properties };
};

// walkRecordFor — forWalk(): the channel's declared properties readable UNBLINDED; any OTHER blinded name refused on read
const walkRecordFor = ({ record, blindingDeclaration, channelPropertyList }) => {
	const refusedNameSet = new Set(blindingDeclaration.filter((oneName) => channelPropertyList.indexOf(oneName) === -1));
	const properties = new Proxy(
		{ ...record.properties },
		{
			get: (target, propertyName) => {
				if (typeof propertyName === 'string' && refusedNameSet.has(propertyName)) {
					throw refuse.byName({ moduleName, what: `the walk read blinded property '${propertyName}' on ${record.stableId}, which the channel did not declare in channelPropertyList (${channelPropertyList.join(', ')})`, where: 'forWalk() is the SOLE blinding exemption and only for declared channel properties (RULING BF7)' });
				}
				return target[propertyName];
			},
			has: (target, propertyName) => (typeof propertyName === 'string' && refusedNameSet.has(propertyName) ? false : propertyName in target),
			ownKeys: (target) => Reflect.ownKeys(target).filter((oneName) => !(typeof oneName === 'string' && refusedNameSet.has(oneName))),
			getOwnPropertyDescriptor: (target, propertyName) => (typeof propertyName === 'string' && refusedNameSet.has(propertyName) ? undefined : Object.getOwnPropertyDescriptor(target, propertyName)),
		},
	);
	return { stableId: record.stableId, labels: record.labels.slice(), properties };
};

// blindedEdgeFor / walkEdgeFor — the SAME two rules applied to an EDGE's properties (RULING BR6): forEvidence()
// removes every declared blinded name from edge properties too; forWalk() exposes only the declared channel
// properties and refuses any other blinded name on read. An edge is shaped through the node rule with a synthetic
// locator ('from -> to') so the two views can never diverge between nodes and edges.
const edgeLocatorOf = (edge) => `${edge.fromStableId} -[${edge.type}]-> ${edge.toStableId}`;
const blindedEdgeFor = ({ edge, blindingDeclaration }) => {
	const shaped = blindedRecordFor({ record: { stableId: edgeLocatorOf(edge), labels: [], properties: edge.properties }, blindingDeclaration });
	return { fromStableId: edge.fromStableId, toStableId: edge.toStableId, type: edge.type, properties: shaped.properties };
};
const walkEdgeFor = ({ edge, blindingDeclaration, channelPropertyList }) => {
	const shaped = walkRecordFor({ record: { stableId: edgeLocatorOf(edge), labels: [], properties: edge.properties }, blindingDeclaration, channelPropertyList });
	return { fromStableId: edge.fromStableId, toStableId: edge.toStableId, type: edge.type, properties: shaped.properties };
};

const walkViewRefusal = ({ channelPropertyList, blindingDeclaration } = {}) => {
	if (!Array.isArray(channelPropertyList) || channelPropertyList.some((oneName) => !isNonEmptyString(oneName))) {
		return refuse.byName({ moduleName, what: 'forWalk needs channelPropertyList (a list of property names; [] for a document-only walk)', where: 'the declared channel properties are the ONLY unblinded reads' });
	}
	void blindingDeclaration;
	return null;
};

// closed member sets — a Proxy throws by name on any other read (BG-CONTAIN)
const closedShape = ({ target, memberList, shapeName }) =>
	new Proxy(target, {
		get: (innerTarget, propertyName) => {
			if (typeof propertyName === 'string' && memberList.indexOf(propertyName) === -1 && propertyName !== 'then' && propertyName !== 'toJSON' && propertyName !== 'inspect' && propertyName !== 'constructor') {
				throw refuse.byName({ moduleName, what: `${shapeName} has no member '${propertyName}'`, where: `the ${shapeName} member set is CLOSED: ${memberList.join(', ')} (BR-018; SPEC §4.2)` });
			}
			return innerTarget[propertyName];
		},
	});
const closedView = (view) => closedShape({ target: view, memberList: VIEW_MEMBER_LIST, shapeName: 'sourceReader view' });
// closedHookArgs — the argument object handed to a plugin hook: exactly its own keys, nothing else (no judge, no store, no writer)
const closedHookArgs = (hookArgs) => closedShape({ target: hookArgs, memberList: Object.keys(hookArgs), shapeName: 'hook argument object' });
const closedReader = (reader) => closedShape({ target: reader, memberList: READER_MEMBER_LIST, shapeName: 'graphReader' });
const closedWriter = (writer) => closedShape({ target: writer, memberList: WRITER_MEMBER_LIST, shapeName: 'graphWriter' });

// mappingEdgeRefusal — the §6 write seam: returns an Error or null
const mappingEdgeRefusal = ({ subjectStableId, objectStableId, edgeType, edgeProperties, sourceStandardName, subjectEndpoint, objectEndpoint } = {}) => {
	if (!isNonEmptyString(subjectStableId) || !isNonEmptyString(objectStableId)) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: subjectStableId ${JSON.stringify(subjectStableId)} / objectStableId ${JSON.stringify(objectStableId)}`, where: 'both endpoints are named by stableId, read off the record (BR-031)' });
	}
	if (PREDICATE_BY_EDGE_TYPE[edgeType] === undefined) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: edgeType '${edgeType}' is not in SKOS_EDGE_TYPES (${Object.keys(PREDICATE_BY_EDGE_TYPE).join(', ')})`, where: 'a mapping edge is typed by its SKOS relation (§6, BG-CONSERV b)' });
	}
	if (!isPlainObject(edgeProperties)) {
		return refuse.byName({ moduleName, what: 'writeMappingEdge: edgeProperties is not an object', where: 'the closed MAPPING_PROPERTIES set' });
	}
	const outside = Object.keys(edgeProperties).find((oneName) => MAPPING_PROPERTY_NAME_LIST.indexOf(oneName) === -1);
	if (outside !== undefined) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: edge property '${outside}' is outside vocabulary.MAPPING_PROPERTIES (${MAPPING_PROPERTY_NAME_LIST.join(', ')})`, where: 'the CLOSED SET check (RULING BF12); add a vocabulary row in its own named commit or drop the property' });
	}
	const missing = EVERY_EDGE_REQUIRED_PROPERTY_LIST.find((oneName) => edgeProperties[oneName] === undefined || edgeProperties[oneName] === null || edgeProperties[oneName] === '');
	if (missing !== undefined) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: edge property '${missing}' is absent`, where: 'every mapping edge carries the three properties, the hash, the sources/versions and the provenance (§5.7, BG-THREE)' });
	}
	if (SKOS_PREDICATES.indexOf(edgeProperties.predicate) === -1) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: predicate '${edgeProperties.predicate}' is not SKOS`, where: 'SKOS_PREDICATES' });
	}
	if (EDGE_TYPE_BY_PREDICATE[edgeProperties.predicate] !== edgeType) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: predicate '${edgeProperties.predicate}' disagrees with edgeType '${edgeType}' (which is ${PREDICATE_BY_EDGE_TYPE[edgeType]})`, where: 'the predicate property EQUALS the edge type\'s relation (BG-THREE c)' });
	}
	const justificationRefusal = sssomJustificationRefusal(edgeProperties.mappingJustification);
	if (justificationRefusal) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: ${justificationRefusal}`, where: `the three: ${SSSOM_JUSTIFICATIONS.join(', ')}` });
	}
	if (edgeProperties.resolution === 'judged') {
		const missingJudged = JUDGED_ONLY_PROPERTY_LIST.find((oneName) => edgeProperties[oneName] === undefined || edgeProperties[oneName] === null);
		if (missingJudged !== undefined) {
			return refuse.byName({ moduleName, what: `writeMappingEdge: a judged edge lacks '${missingJudged}'`, where: 'judged ⇒ confidence + mappingTool(+Version) + decisionBlockHash (§6)' });
		}
		if (typeof edgeProperties.confidence !== 'number' || !Number.isFinite(edgeProperties.confidence)) {
			return refuse.byName({ moduleName, what: `writeMappingEdge: confidence ${JSON.stringify(edgeProperties.confidence)} is not a finite number`, where: 'the band table\'s discrete value' });
		}
	} else if (edgeProperties.resolution === 'specified') {
		const present = JUDGED_ONLY_PROPERTY_LIST.find((oneName) => Object.prototype.hasOwnProperty.call(edgeProperties, oneName));
		if (present !== undefined) {
			return refuse.byName({ moduleName, what: `writeMappingEdge: a specified edge carries '${present}' (${JSON.stringify(edgeProperties[present])})`, where: 'specified ⇒ NO confidence / tool — the key must be ABSENT, not null, not 1.0 (C1, BG-P5 b)' });
		}
	} else {
		return refuse.byName({ moduleName, what: `writeMappingEdge: resolution '${edgeProperties.resolution}' is not specified | judged`, where: 'RESOLUTION_LIST' });
	}
	if (MAPPING_EDGE_PERMITTED_PROVENANCE_TIER_LIST.indexOf(edgeProperties.provenanceTier) === -1) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: provenanceTier '${edgeProperties.provenanceTier}' is not a mapping-edge tier (${MAPPING_EDGE_PERMITTED_PROVENANCE_TIER_LIST.join(', ')})`, where: 'the ENGINE-LEVEL tier derived from producerKind, or invalid-debug on a debug block (RULING 12:20)' });
	}
	if (!Array.isArray(edgeProperties.attestationChannelList) || edgeProperties.attestationChannelList.length === 0) {
		return refuse.byName({ moduleName, what: 'writeMappingEdge: attestationChannelList must be a non-empty list', where: 'attestation channels are DATA on the edge (BR-045)' });
	}
	if (subjectEndpoint === null || subjectEndpoint === undefined) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: subject endpoint '${subjectStableId}' is absent from inGraph`, where: 'the writer refuses a missing endpoint by name (§5.7)' });
	}
	if (objectEndpoint === null || objectEndpoint === undefined) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: object endpoint '${objectStableId}' is absent from inGraph`, where: 'the writer refuses a missing endpoint by name — it never re-derives (BG-P2 c)' });
	}
	if (!Array.isArray(objectEndpoint.labels) || objectEndpoint.labels.indexOf(HUB_REFERENCE_LABEL) === -1) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: object endpoint '${objectStableId}' is not a ${HUB_REFERENCE_LABEL}`, where: 'conservativity: a mapping edge points at a hub card (BG-CONSERV a)' });
	}
	if (objectEndpoint.referenceTier !== undefined && objectEndpoint.referenceTier !== PROPERTY_TIER) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: object endpoint '${objectStableId}' is a '${objectEndpoint.referenceTier}'-tier card`, where: 'NO edge to a value-tier card exists in v1 (BR-080, BG-VALUE c)' });
	}
	if (subjectEndpoint.sourceStandardName !== sourceStandardName) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: subject endpoint '${subjectStableId}' has _source ${JSON.stringify(subjectEndpoint.sourceStandardName)}, not the pairing's source '${sourceStandardName}'`, where: 'conservativity (BG-CONSERV a)' });
	}
	return null;
};

module.exports = {
	HUB_REFERENCE_LABEL,
	CARD_LIST_SLOT_LIST,
	CARD_REQUIRED_PROPERTY_LIST,
	READER_MEMBER_LIST,
	VIEW_MEMBER_LIST,
	WRITER_MEMBER_LIST,
	EVERY_EDGE_REQUIRED_PROPERTY_LIST,
	JUDGED_ONLY_PROPERTY_LIST,
	PREDICATE_BY_EDGE_TYPE,
	readerConstructionRefusal,
	writerConstructionRefusal,
	reWidenListSlots,
	shapeHubCardList,
	withoutEmbedding,
	blindedRecordFor,
	walkRecordFor,
	blindedEdgeFor,
	walkEdgeFor,
	walkViewRefusal,
	closedView,
	closedHookArgs,
	closedReader,
	closedWriter,
	mappingEdgeRefusal,
	moduleName,
};
