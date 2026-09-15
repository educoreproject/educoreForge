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
//   textSearchVocabularyFor()                                the text role, its edge type, its vector property and the
//                                                            slot edge types, read from lib/vocabulary or refused (B3b)
//   reWidenPropertyNameList / shapeEmbedTextVectorRowList    readEmbedTextVectors' closed record, scalar propertyNameList
//                                                            re-widened, anything else refused (R-BR-1a)
//   shapeCardBaseEdgeRowList                                 readCardBaseEdges' closed record, DOMAIN/PROPERTY required,
//                                                            RANGE optional per card (CARD_BASE_SLOT_DISPOSITION, R-BR-13)
//   closedView / closedReader / closedWriter                 Proxies asserting the CLOSED member sets (BG-CONTAIN)
//   mappingEdgeRefusal({...})                                the §6 write-seam refusals incl. the MAPPING_PROPERTIES
//                                                            closed-set check (NEW enforcement, RULING BF12) and the
//                                                            producer-derived provenanceTier (RULING 12:20)

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { TUPLE_LIST_FIELD_LIST, PRODUCER_KIND_BY_MATCH_BASIS } = require('./bridgePluginContract');

const { SKOS_EDGE_TYPES, SKOS_PREDICATES, MAPPING_PROPERTIES, MAPPING_PROPERTY_NAME_LIST, MAPPING_EDGE_PERMITTED_PROVENANCE_TIER_LIST, SSSOM_JUSTIFICATIONS, sssomJustificationRefusal } = vocabularyLib;

const HUB_REFERENCE_LABEL = 'HubReference';
const PROPERTY_TIER = 'property';
const CARD_LIST_SLOT_LIST = Object.freeze(TUPLE_LIST_FIELD_LIST.concat(['qualifierNames']));
const CARD_REQUIRED_PROPERTY_LIST = Object.freeze(['stableId', 'canonicalKey', 'referenceTier', 'hubName', 'hubVersion', 'name']);
const READER_MEMBER_LIST = Object.freeze(['readHubCards', 'readSubjectNodes', 'forWalk', 'forEvidence', 'forRetrieval', 'close']);
const VIEW_MEMBER_LIST = Object.freeze(['readSourceNodes', 'readNodesByStableId', 'readEdgesAmongSource']);
// the RETRIEVAL view is PURPOSE-SCOPED and closed to exactly four reads (RULING §11.4): readHubVectors and
// readSubjectVectors return { stableId, embedding, embeddingModelVersion } and NOTHING else; the two text-node reads
// (SPEC-bridgeRevision-091426 §6, §13 R-BR-1, R-BR-1a, R-BR-9, R-BR-13) each return their OWN closed field list.
// It is a separate member set from VIEW_MEMBER_LIST precisely so the renderer's view and the vector view can never
// be the same object: the renderer cannot reach a vector, and retrieval cannot reach a text, a name or a definition.
const RETRIEVAL_VIEW_MEMBER_LIST = Object.freeze(['readHubVectors', 'readSubjectVectors', 'readEmbedTextVectors', 'readCardBaseEdges']);
const RETRIEVAL_RECORD_KEY_LIST = Object.freeze(['stableId', 'embedding', 'embeddingModelVersion']);
const EMBED_TEXT_VECTOR_FIELD_NAME_LIST = Object.freeze(['textStableId', 'vector', 'embeddingModelVersion', 'sourceStableId', 'sourceRole', 'propertyNameList']);
const CARD_BASE_EDGE_FIELD_NAME_LIST = Object.freeze(['cardStableId', 'edgeType', 'baseStableId', 'baseRole']);
// CARD_BASE_SLOT_DISPOSITION — the decomposition slots a card-to-base read returns, and which of them every card
// must carry (R-BR-9, R-BR-13). DOMAIN and PROPERTY are on every property-tier card; RANGE is on 1,692 of the
// pilot's 2,777 (measured 2026-09-15), so a card without one is ordinary. VALUE and QUALIFIER are hub slots no
// walk follows, so their edges are not returned.
const CARD_BASE_SLOT_DISPOSITION = Object.freeze({ DOMAIN: 'required', PROPERTY: 'required', RANGE: 'optional' });
const WRITER_MEMBER_LIST = Object.freeze(['writeMappingEdge', 'close']);
const EDGE_TYPE_BY_PREDICATE = SKOS_EDGE_TYPES;
const PREDICATE_BY_EDGE_TYPE = Object.freeze(Object.keys(SKOS_EDGE_TYPES).reduce((soFar, onePredicate) => ({ ...soFar, [SKOS_EDGE_TYPES[onePredicate]]: onePredicate }), {}));
const JUDGED_ONLY_PROPERTY_LIST = Object.freeze([MAPPING_PROPERTIES.CONFIDENCE, MAPPING_PROPERTIES.MAPPING_TOOL, MAPPING_PROPERTIES.MAPPING_TOOL_VERSION]);
const EVERY_EDGE_REQUIRED_PROPERTY_LIST = Object.freeze([
	MAPPING_PROPERTIES.PREDICATE,
	MAPPING_PROPERTIES.MAPPING_JUSTIFICATION,
	MAPPING_PROPERTIES.MATCH_BASIS,
	MAPPING_PROPERTIES.RESOLUTION,
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

// EDGE_PROVIDER_DISPOSITION_BY_PRODUCER_KIND — mappingProvider is CONDITIONAL, by producerKind (RULING
// SABLE_RIVER 2026-08-17, amending §11.7 (c)). An AUTHORED mapping has a provider: a person or an institution
// asserted it, and naming them is the point. An INFERRED mapping has none — nobody asserted it; a machine
// proposed candidates by meaning and a judge chose. Putting the tool's URL in the provider slot would answer
// "who authored this?" with "nothing did", which is worse than silence, and would make the graph edge
// disagree with its own SSSOM row (where §11.7 (c) omits mapping_provider).
//
// This is the SAME idiom the seam already uses one field down: confidence / mappingTool / mappingToolVersion
// are required when `resolution` is judged and refused BY NAME when it is specified ("the key must be ABSENT,
// not null, not 1.0"). This adds a second discriminator beside that one; both are data, neither is a branch.
// producerKind is read off the edge's OWN matchBasis (1:1, PRODUCER_KIND_BY_MATCH_BASIS) rather than threaded
// in, so no caller changes and the edge is judged by what it actually carries.
// EXTENDED from a provider-only table to the full set of producer-conditional edge properties. subjectMatchField
// is the SAME fact as mappingProvider one field over: a match FIELD is the field the two sides were matched ON,
// and a derived mapping was matched on no field — it was matched on MEANING. RULING §11.7 (d) omits
// subject_match_field from the SSSOM row for exactly that reason, and the 2026-08-17 ruling on mappingProvider
// says in terms that the edge and the SSSOM row must then AGREE. Emitting it on the edge while omitting it from
// the export would recreate the disagreement that ruling exists to prevent.
// objectMatchField is NOT here: it stays required on every edge, because the exporter derives object_source from
// its CURIE prefix, and for a derived run it names the mechanism (EDUcoreHub:semanticSimilarity) rather than
// borrowing a key that was never consulted.
const EDGE_PROPERTY_DISPOSITION_BY_PRODUCER_KIND = Object.freeze({
	authored: Object.freeze({ mappingProvider: 'required', subjectMatchField: 'required' }),
	inferred: Object.freeze({ mappingProvider: 'forbidden', subjectMatchField: 'forbidden' }),
});
const PRODUCER_CONDITIONAL_EDGE_PROPERTY_NAME_LIST = Object.freeze(['mappingProvider', 'subjectMatchField']);

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
		// The vector is CHECKED here and then DROPPED from the card object on EVERY path (RULING §11.4). The
		// present-or-refused contract (BR-123) is unchanged — what changes is that no consumer downstream of this
		// point can carry a vector, or the ~320-character embedText, into a prompt by accident. Retrieval reads
		// vectors through the purpose-scoped forRetrieval() view instead, which returns nothing else.
		// This is a CARD SHAPE change and NOT a rendered-text change: evidenceRenderer never printed either name,
		// so the crosswalk variant's prompts stay byte-identical and its judgment cache keeps hitting (§11.8).
		delete card.embedding;
		delete card.embedText;
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

// allowListedPropertiesFor — the POSITIVE shaping (RULING §11.4). A deny-list can only exclude what somebody
// thought of; an allow-list excludes what nobody thought of, which is the only form that can honestly be
// called a bias audit. Given a property bag and the declared names for that side, it returns a bag carrying
// ONLY those names. A name that is allow-listed and ABSENT is simply absent — omitted, never rendered as ''
// and never defaulted (the Profile convention, ruled explicitly for the 3 cards lacking propertyDefinition).
//
// stableId is NOT a property here: it rides beside the bag as the record's identity so the framework can map a
// pick back to a card, and the RENDERER is what refuses to print it. Keeping identity out of the rendered bag
// is exactly why the allow-list can be complete without also being useless.
const allowListedPropertiesFor = ({ properties, allowNameList }) => {
	const shaped = {};
	for (let nameIndex = 0; nameIndex < allowNameList.length; nameIndex++) {
		const oneName = allowNameList[nameIndex];
		const oneValue = properties[oneName];
		if (oneValue !== undefined && oneValue !== null && oneValue !== '') {
			shaped[oneName] = oneValue;
		}
	}
	return shaped;
};

// allowListedRecordFor — forEvidence() under a declared renderingAllowList: the record keeps its stableId and
// labels (framework identity, never rendered) and carries ONLY the allow-listed properties.
const allowListedRecordFor = ({ record, allowNameList }) => ({
	stableId: record.stableId,
	labels: record.labels.slice(),
	properties: allowListedPropertiesFor({ properties: record.properties, allowNameList }),
});

// allowListRefusal — the declared list is checked against what the element ACTUALLY carries, at read time.
// An allow-listed name that exists on NO element of a non-empty population is a declaration that has quietly
// stopped describing its graph — the same failure the label table's census refuses (RULING P4) — and it is
// reported by name rather than silently rendering nothing.
const allowListRefusal = ({ allowNameList, propertyBagList, sideName }) => {
	if (!Array.isArray(allowNameList) || allowNameList.length === 0) {
		return refuse.byName({ moduleName, what: `renderingAllowList.${sideName} is absent or empty at the seam`, where: 'a side that renders nothing cannot be judged; the declaration requires a non-empty list per side' });
	}
	if (propertyBagList.length === 0) {
		return null;
	}
	const neverPresent = allowNameList.find((oneName) => !propertyBagList.some((oneBag) => oneBag[oneName] !== undefined && oneBag[oneName] !== null && oneBag[oneName] !== ''));
	if (neverPresent !== undefined) {
		return refuse.byName({ moduleName, what: `renderingAllowList.${sideName} names '${neverPresent}', which is present on NONE of the ${propertyBagList.length} element(s) read`, where: 'an allow-list that has stopped describing its graph must not stay green; remove the name or fix the forge' });
	}
	return null;
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
const closedRetrievalView = (view) => closedShape({ target: view, memberList: RETRIEVAL_VIEW_MEMBER_LIST, shapeName: 'retrieval view' });
// retrievalRecordFor — the ONLY shape the retrieval view ever yields. Built by NAMING the three keys rather
// than by deleting the rest, so a property added to the graph tomorrow cannot appear here by omission.
const retrievalRecordFor = (record) => ({
	stableId: record.stableId,
	embedding: record.properties.embedding,
	embeddingModelVersion: record.properties.embeddingModelVersion,
});

const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);

// textSearchVocabularyFor — the text-node role, its edge type, its vector property and the slot edge types, READ from
// lib/vocabulary and never re-typed (R-BR-1, R-BR-9, BG-NOSUB). A missing constant is refused by name rather than
// interpolated into cypher as 'undefined'.
const textSearchVocabularyFor = () => {
	const { DME_ROLES, EDGE_TYPES, EMBED_TEXT_VECTOR, HUB_DECOMPOSITION_SLOTS, hubEdgeType } = vocabularyLib;
	const requiredConstantList = [
		['DME_ROLES.EMBED_TEXT', DME_ROLES && DME_ROLES.EMBED_TEXT],
		['EDGE_TYPES.EMBEDS_TEXT_OF', EDGE_TYPES && EDGE_TYPES.EMBEDS_TEXT_OF],
		['EMBED_TEXT_VECTOR.propertyName', EMBED_TEXT_VECTOR && EMBED_TEXT_VECTOR.propertyName],
	];
	const missingConstant = requiredConstantList.find(([, constantValue]) => !isNonEmptyString(constantValue));
	if (missingConstant !== undefined) {
		return { error: refuse.byName({ moduleName, what: `lib/vocabulary has no ${missingConstant[0]}`, where: 'the reader names text nodes, their edge and their vector through the vocabulary only (R-BR-1)' }) };
	}
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(EMBED_TEXT_VECTOR.propertyName)) {
		return { error: refuse.byName({ moduleName, what: `EMBED_TEXT_VECTOR.propertyName ${JSON.stringify(EMBED_TEXT_VECTOR.propertyName)} is not a property name`, where: 'it reaches cypher by interpolation, so it is validated before it gets there' }) };
	}
	if (typeof hubEdgeType !== 'function' || !Array.isArray(HUB_DECOMPOSITION_SLOTS)) {
		return { error: refuse.byName({ moduleName, what: 'lib/vocabulary has no hubEdgeType function or HUB_DECOMPOSITION_SLOTS list', where: 'slot edge types are hubEdgeType(hubName, slot), never literals (R-BR-9)' }) };
	}
	const undeclaredSlot = Object.keys(CARD_BASE_SLOT_DISPOSITION).find((oneSlot) => HUB_DECOMPOSITION_SLOTS.indexOf(oneSlot) === -1);
	if (undeclaredSlot !== undefined) {
		return { error: refuse.byName({ moduleName, what: `CARD_BASE_SLOT_DISPOSITION names slot '${undeclaredSlot}', which is not in HUB_DECOMPOSITION_SLOTS (${HUB_DECOMPOSITION_SLOTS.join(', ')})`, where: 'the slot rows must be hub decomposition slots' }) };
	}
	return {
		embedTextRole: DME_ROLES.EMBED_TEXT,
		embedsTextOfEdgeType: EDGE_TYPES.EMBEDS_TEXT_OF,
		textVectorPropertyName: EMBED_TEXT_VECTOR.propertyName,
		slotByEdgeTypeFor: (hubName) => Object.keys(CARD_BASE_SLOT_DISPOSITION).reduce((soFar, oneSlot) => ({ ...soFar, [hubEdgeType(hubName, oneSlot)]: oneSlot }), {}),
	};
};

// reWidenPropertyNameList — the loader stores a ONE-element propertyNameList as a SCALAR string (R-BR-1a ii), so the
// read boundary re-widens it, as reWidenListSlots does for card list slots. A list stays a list; anything else
// (a number, an empty string, an empty list, a list holding a non-name) is refused by name.
const reWidenPropertyNameList = ({ propertyNameList, edgeLocator }) => {
	if (isNonEmptyString(propertyNameList)) {
		return { propertyNameList: [propertyNameList] };
	}
	if (Array.isArray(propertyNameList) && propertyNameList.length > 0 && propertyNameList.every(isNonEmptyString)) {
		return { propertyNameList: propertyNameList.slice() };
	}
	return { error: refuse.byName({ moduleName, what: `text edge ${edgeLocator} carries propertyNameList ${JSON.stringify(propertyNameList)}, which is neither a property name nor a non-empty list of names`, where: 'the forge writes the sorted names of the properties the text is; the loader may store one as a scalar, and nothing else (R-BR-1a)' }) };
};

// shapeEmbedTextVectorRowList — one record per text edge, built by NAMING its fields (so a property added to the
// graph tomorrow cannot appear by omission), propertyNameList re-widened, sorted by (textStableId, sourceStableId).
// A text edge reaching a node of another standard is refused by name, never silently dropped.
const shapeEmbedTextVectorRowList = ({ rowList, standardName }) => {
	const recordList = [];
	for (let rowIndex = 0; rowIndex < rowList.length; rowIndex++) {
		const oneRow = rowList[rowIndex];
		const edgeLocator = `${oneRow.textStableId} -> ${oneRow.sourceStableId}`;
		if (oneRow.sourceStandardName !== standardName) {
			return { error: refuse.byName({ moduleName, what: `text edge ${edgeLocator} reaches a node whose _source is ${JSON.stringify(oneRow.sourceStandardName)}, not '${standardName}'`, where: 'a text node describes nodes of its own standard only (R-ET-1)' }) };
		}
		const widened = reWidenPropertyNameList({ propertyNameList: oneRow.propertyNameList, edgeLocator });
		if (widened.error) {
			return { error: widened.error };
		}
		recordList.push({ textStableId: oneRow.textStableId, vector: oneRow.vector, embeddingModelVersion: oneRow.embeddingModelVersion, sourceStableId: oneRow.sourceStableId, sourceRole: oneRow.sourceRole, propertyNameList: widened.propertyNameList });
	}
	return { recordList: recordList.sort((leftRecord, rightRecord) => compareStrings(leftRecord.textStableId, rightRecord.textStableId) || compareStrings(leftRecord.sourceStableId, rightRecord.sourceStableId)) };
};

// shapeCardBaseEdgeRowList — the slot edges of the cards read, kept only when their type is hubEdgeType(card's
// hubName, slot) for a slot in CARD_BASE_SLOT_DISPOSITION, sorted by (cardStableId, edgeType, baseStableId). Every
// card read is checked against the required slots, so a card with NO slot edge at all is refused too (R-BR-13).
const shapeCardBaseEdgeRowList = ({ cardRowList, edgeRowList, textSearchVocabulary }) => {
	const hubNameByCardStableId = {};
	const slotByEdgeTypeByHubName = {};
	for (let cardIndex = 0; cardIndex < cardRowList.length; cardIndex++) {
		const oneCardRow = cardRowList[cardIndex];
		if (!isNonEmptyString(oneCardRow.hubName)) {
			return { error: refuse.byName({ moduleName, what: `hub card ${JSON.stringify(oneCardRow.cardStableId)} carries no hubName`, where: 'its slot edge types are hubEdgeType(hubName, slot); every HubReference card carries hubName' }) };
		}
		hubNameByCardStableId[oneCardRow.cardStableId] = oneCardRow.hubName;
		if (slotByEdgeTypeByHubName[oneCardRow.hubName] === undefined) {
			slotByEdgeTypeByHubName[oneCardRow.hubName] = textSearchVocabulary.slotByEdgeTypeFor(oneCardRow.hubName);
		}
	}
	const slotListByCardStableId = {};
	const recordList = [];
	for (let edgeIndex = 0; edgeIndex < edgeRowList.length; edgeIndex++) {
		const oneEdgeRow = edgeRowList[edgeIndex];
		const hubName = hubNameByCardStableId[oneEdgeRow.cardStableId];
		if (hubName === undefined) {
			return { error: refuse.byName({ moduleName, what: `slot edge ${oneEdgeRow.cardStableId} -[${oneEdgeRow.edgeType}]-> ${oneEdgeRow.baseStableId} leaves a card the card read did not return`, where: 'the card read and the edge read name the same tier; a difference means the graph changed between them' }) };
		}
		const slot = slotByEdgeTypeByHubName[hubName][oneEdgeRow.edgeType];
		if (slot === undefined) {
			continue;
		}
		slotListByCardStableId[oneEdgeRow.cardStableId] = (slotListByCardStableId[oneEdgeRow.cardStableId] || []).concat([slot]);
		recordList.push({ cardStableId: oneEdgeRow.cardStableId, edgeType: oneEdgeRow.edgeType, baseStableId: oneEdgeRow.baseStableId, baseRole: oneEdgeRow.baseRole });
	}
	const requiredSlotList = Object.keys(CARD_BASE_SLOT_DISPOSITION).filter((oneSlot) => CARD_BASE_SLOT_DISPOSITION[oneSlot] === 'required');
	for (let cardIndex = 0; cardIndex < cardRowList.length; cardIndex++) {
		const cardStableId = cardRowList[cardIndex].cardStableId;
		const missingSlot = requiredSlotList.find((oneSlot) => (slotListByCardStableId[cardStableId] || []).indexOf(oneSlot) === -1);
		if (missingSlot !== undefined) {
			return { error: refuse.byName({ moduleName, what: `hub card ${JSON.stringify(cardStableId)} has no ${missingSlot} slot edge`, where: `every card carries the required slots (${requiredSlotList.join(', ')}); RANGE alone is optional (R-BR-13)` }) };
		}
	}
	return { recordList: recordList.sort((leftRecord, rightRecord) => compareStrings(leftRecord.cardStableId, rightRecord.cardStableId) || compareStrings(leftRecord.edgeType, rightRecord.edgeType) || compareStrings(leftRecord.baseStableId, rightRecord.baseStableId)) };
};
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
	const edgeProducerKind = PRODUCER_KIND_BY_MATCH_BASIS[edgeProperties.matchBasis];
	const dispositionRow = EDGE_PROPERTY_DISPOSITION_BY_PRODUCER_KIND[edgeProducerKind];
	if (dispositionRow === undefined) {
		return refuse.byName({ moduleName, what: `writeMappingEdge: matchBasis '${edgeProperties.matchBasis}' names no producerKind, so the producer-conditional edge properties have no disposition`, where: 'PRODUCER_KIND_BY_MATCH_BASIS and EDGE_PROPERTY_DISPOSITION_BY_PRODUCER_KIND must both carry a row for every basis' });
	}
	for (let nameIndex = 0; nameIndex < PRODUCER_CONDITIONAL_EDGE_PROPERTY_NAME_LIST.length; nameIndex++) {
		const oneName = PRODUCER_CONDITIONAL_EDGE_PROPERTY_NAME_LIST[nameIndex];
		const disposition = dispositionRow[oneName];
		const oneValue = edgeProperties[oneName];
		if (disposition === 'required' && (oneValue === undefined || oneValue === null || oneValue === '')) {
			return refuse.byName({ moduleName, what: `writeMappingEdge: an '${edgeProducerKind}' edge lacks '${oneName}'`, where: 'an authored mapping names WHO asserted it and WHAT FIELD it matched on; both are required on every authored edge (§5.7, BG-THREE)' });
		}
		if (disposition === 'forbidden' && Object.prototype.hasOwnProperty.call(edgeProperties, oneName)) {
			return refuse.byName({ moduleName, what: `writeMappingEdge: an '${edgeProducerKind}' edge carries '${oneName}' (${JSON.stringify(oneValue)})`, where: 'nobody AUTHORED an inferred mapping and it matched on no FIELD — the key must be ABSENT, not null, not a borrowed one; the producer is named by producerKind and provenanceTier (RULING 2026-08-17 amending §11.7 (c)(d))' });
		}
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
	RETRIEVAL_VIEW_MEMBER_LIST,
	RETRIEVAL_RECORD_KEY_LIST,
	EMBED_TEXT_VECTOR_FIELD_NAME_LIST,
	CARD_BASE_EDGE_FIELD_NAME_LIST,
	CARD_BASE_SLOT_DISPOSITION,
	WRITER_MEMBER_LIST,
	EVERY_EDGE_REQUIRED_PROPERTY_LIST,
	EDGE_PROPERTY_DISPOSITION_BY_PRODUCER_KIND,
	PRODUCER_CONDITIONAL_EDGE_PROPERTY_NAME_LIST,
	JUDGED_ONLY_PROPERTY_LIST,
	PREDICATE_BY_EDGE_TYPE,
	readerConstructionRefusal,
	writerConstructionRefusal,
	reWidenListSlots,
	shapeHubCardList,
	withoutEmbedding,
	blindedRecordFor,
	allowListedPropertiesFor,
	allowListedRecordFor,
	allowListRefusal,
	retrievalRecordFor,
	textSearchVocabularyFor,
	reWidenPropertyNameList,
	shapeEmbedTextVectorRowList,
	shapeCardBaseEdgeRowList,
	closedRetrievalView,
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
