'use strict';

// hubCardFieldTable.js — ⟪campaign P3, W-C-5 (V1-C33, V1-S66/S67)⟫ every property a HubReference card carries, DECLARED ONCE.
//
// Before this table the HubDefinition's slotProfile was a hand-written object beside the emitter: it named five lists the
// emitter did not read, so the profile and the cards could drift with nothing to notice (V1-S66 measured it: the profile
// claimed qualifierNames on value cards, which the emitter can never write, and named neither _source, role nor the
// forger's stamps). Now the SAME rows build both the profile (slotProfileFromFieldTable) and the emitter's post-emit check
// (cardFieldRefusal), so a card property nobody declared is refused by name at the producer.
//
// One row per field:
//   fieldName  the card property
//   group      address | identity | scope | meaning | provenance | derived
//   hashed     true when the value is an input to addressSignature; hashSlot names the signature slot when it differs
//              from fieldName (the three range shapes share the one slot 'range')
//   tierList   the reference tiers a card of which may carry it
//   presence   'always' (every card of a listed tier carries it), 'conditional:<rule>' (only when the rule holds), or
//              'forgerStamp' (stamped after the hub emits, by the forger's vectorizing pass — never present at emit time)
//   listValued true for a list (graph-contract LIST_VALUED_PROPERTY_NAME_LIST names the same names)
//   rangeAddressing  ⟪ctdlHub P3⟫ PRESENT ONLY on rows that exist under one rangeAddressing mode; such a row reaches a
//              hub only when the hub declares that mode. Absent (every pre-P3 row) means the row serves every mode. It is
//              never defaulted onto a row, because a new attribute on an old row would be new slotProfile bytes.
//
// ⟪ctdlHub P3⟫ ONE TABLE, FILTERED PER HUB. Rows now serve three tiers (term, property, value). A hub sees only the rows
// its declaration admits (hubFieldTableOf: tierList and rangeAddressing), each row's tierList trimmed to the hub's own
// tiers, and BOTH the slotProfile and the emit-time check read that filtered table. That is what keeps a hub without the
// term tier (CEDS) byte-identical while the table grows: its view of the table is exactly the pre-P3 table (pinned by
// test/fixtures/cedsSlotProfile-frozen-087550f9.json).

const path = require('path');
const { REFERENCE_TIER } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));

const BOTH_TIER_LIST = Object.freeze(['property', 'value']);
const PROPERTY_TIER_LIST = Object.freeze(['property']);
const VALUE_TIER_LIST = Object.freeze(['value']);
// ⟪ctdlHub P3⟫ 'term' is APPENDED, never interleaved: a trimmed ['property','value','term'] is ['property','value'] in
// the pre-P3 order, so a CEDS row reads exactly as it did
const ALL_TIER_LIST = Object.freeze(['property', 'value', 'term']);
const TERM_TIER_LIST = Object.freeze(['term']);

const row = (fieldRow) => Object.freeze({ hashed: false, listValued: false, ...fieldRow });

const HUB_CARD_FIELD_TABLE = Object.freeze([
	// ---- ADDRESS (§1.1): ids only ----
	row({ fieldName: 'hubName', group: 'address', hashed: true, tierList: ALL_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'hubVersion', group: 'address', hashed: true, tierList: ALL_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'referenceTier', group: 'address', tierList: ALL_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'domainId', group: 'address', hashed: true, tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'propertyKey', group: 'address', hashed: true, tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'qualifierKeys', group: 'address', hashed: true, tierList: BOTH_TIER_LIST, presence: 'always', listValued: true }),
	row({ fieldName: 'rangeOptionSetId', group: 'address', hashed: true, hashSlot: 'range', tierList: BOTH_TIER_LIST, presence: 'conditional:the range is an option set' }),
	row({ fieldName: 'rangeClassId', group: 'address', hashed: true, hashSlot: 'range', tierList: PROPERTY_TIER_LIST, presence: 'conditional:the range is a class' }),
	row({ fieldName: 'rangeDatatype', group: 'address', hashed: true, hashSlot: 'range', tierList: PROPERTY_TIER_LIST, presence: 'conditional:the range is a datatype' }),
	row({ fieldName: 'valueKey', group: 'address', hashed: true, tierList: VALUE_TIER_LIST, presence: 'always' }),
	// ⟪ctdlHub P3⟫ the term card's whole address beyond hubName/hubVersion: the term's own IRI (TERM_ADDRESS_SIGNATURE_FIELD_ORDER)
	row({ fieldName: 'termIri', group: 'address', hashed: true, tierList: TERM_TIER_LIST, presence: 'always' }),
	// ---- IDENTITY (§1.2): derived from the address ----
	row({ fieldName: 'canonicalKey', group: 'identity', hashed: true, tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'addressSignature', group: 'identity', tierList: ALL_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'uri', group: 'identity', tierList: ALL_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'name', group: 'identity', tierList: ALL_TIER_LIST, presence: 'always' }),
	// ---- SCOPE ----
	row({ fieldName: '_source', group: 'scope', tierList: ALL_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'role', group: 'scope', tierList: ALL_TIER_LIST, presence: 'always' }),
	// ---- MEANING (§1.3): every tuple slot's name and prose, carried when the source has it ----
	row({ fieldName: 'domainName', group: 'meaning', tierList: BOTH_TIER_LIST, presence: 'conditional:the domain class has a name' }),
	row({ fieldName: 'domainDefinition', group: 'meaning', tierList: BOTH_TIER_LIST, presence: 'conditional:the domain class has a definition' }),
	row({ fieldName: 'propertyName', group: 'meaning', tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'propertyDefinition', group: 'meaning', tierList: BOTH_TIER_LIST, presence: 'conditional:the property has a definition' }),
	row({ fieldName: 'propertyNotation', group: 'meaning', tierList: BOTH_TIER_LIST, presence: 'conditional:the property has a notation' }),
	row({ fieldName: 'propertyDataType', group: 'meaning', tierList: BOTH_TIER_LIST, presence: 'conditional:the property has a data type' }),
	row({ fieldName: 'propertyTextFormat', group: 'meaning', tierList: BOTH_TIER_LIST, presence: 'conditional:the property has a text format' }),
	row({ fieldName: 'rangeClassName', group: 'meaning', tierList: PROPERTY_TIER_LIST, presence: 'conditional:the range is a class with a name' }),
	row({ fieldName: 'rangeClassDefinition', group: 'meaning', tierList: PROPERTY_TIER_LIST, presence: 'conditional:the range is a class with a definition' }),
	row({ fieldName: 'rangeOptionSetName', group: 'meaning', tierList: BOTH_TIER_LIST, presence: 'conditional:the range is an option set with a name' }),
	row({ fieldName: 'rangeOptionSetDefinition', group: 'meaning', tierList: BOTH_TIER_LIST, presence: 'conditional:the range is an option set with a definition' }),
	row({ fieldName: 'valueName', group: 'meaning', tierList: VALUE_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'valueDefinition', group: 'meaning', tierList: VALUE_TIER_LIST, presence: 'conditional:the value has a definition' }),
	row({ fieldName: 'valueNotation', group: 'meaning', tierList: VALUE_TIER_LIST, presence: 'conditional:the value has a notation' }),
	row({ fieldName: 'valuePrefLabel', group: 'meaning', tierList: VALUE_TIER_LIST, presence: 'conditional:the value has a prefLabel' }),
	// a value card is emitted with no qualifier pairs, so qualifierNames is a PROPERTY-tier field only
	row({ fieldName: 'qualifierNames', group: 'meaning', tierList: PROPERTY_TIER_LIST, presence: 'conditional:the property is qualified', listValued: true }),
	// ⟪ctdlHub P3⟫ rangeAsMeaning: a property's ranges are MEANING, listed, never hashed (the singular range rows above are
	// then never present on a property card; a value card still carries the one option set it belongs to)
	row({ fieldName: 'rangeClassIdList', group: 'meaning', tierList: PROPERTY_TIER_LIST, presence: 'conditional:the property declares a class range', listValued: true, rangeAddressing: 'rangeAsMeaning' }),
	row({ fieldName: 'rangeClassNameList', group: 'meaning', tierList: PROPERTY_TIER_LIST, presence: 'conditional:the property declares a class range', listValued: true, rangeAddressing: 'rangeAsMeaning' }),
	row({ fieldName: 'rangeOptionSetIdList', group: 'meaning', tierList: PROPERTY_TIER_LIST, presence: 'conditional:the property targets an option set', listValued: true, rangeAddressing: 'rangeAsMeaning' }),
	row({ fieldName: 'rangeOptionSetNameList', group: 'meaning', tierList: PROPERTY_TIER_LIST, presence: 'conditional:the property targets an option set', listValued: true, rangeAddressing: 'rangeAsMeaning' }),
	row({ fieldName: 'rangeDatatypeList', group: 'meaning', tierList: PROPERTY_TIER_LIST, presence: 'conditional:the property declares a datatype range', listValued: true, rangeAddressing: 'rangeAsMeaning' }),
	// ⟪ctdlHub P3⟫ term tier: the term's own name, definition and kind (class | property | optionSet | value)
	row({ fieldName: 'termName', group: 'meaning', tierList: TERM_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'termDefinition', group: 'meaning', tierList: TERM_TIER_LIST, presence: 'conditional:the term has a definition' }),
	row({ fieldName: 'termKind', group: 'meaning', tierList: TERM_TIER_LIST, presence: 'always' }),
	// ---- PROVENANCE (§1.4) ----
	row({ fieldName: 'anchorUri', group: 'provenance', tierList: ALL_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'domainUri', group: 'provenance', tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'propertyUri', group: 'provenance', tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'rangeUri', group: 'provenance', tierList: BOTH_TIER_LIST, presence: 'conditional:the range is an option set or a class' }),
	row({ fieldName: 'valueUri', group: 'provenance', tierList: VALUE_TIER_LIST, presence: 'always' }),
	// ---- DERIVED (§1.5) ----
	row({ fieldName: 'embedText', group: 'derived', tierList: ALL_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'embedding', group: 'derived', tierList: ALL_TIER_LIST, presence: 'forgerStamp' }),
	row({ fieldName: 'embeddingModelVersion', group: 'derived', tierList: ALL_TIER_LIST, presence: 'forgerStamp' }),
	row({ fieldName: 'embedSourceProperty', group: 'derived', tierList: ALL_TIER_LIST, presence: 'forgerStamp' }),
]);

const PRESENCE_PATTERN = /^(always|forgerStamp|conditional:.+)$/;
// the tiers a row may name are the vocabulary's, not a list retyped here
const KNOWN_TIER_LIST = Object.freeze(Object.keys(REFERENCE_TIER).map((tierConstantName) => REFERENCE_TIER[tierConstantName]));

// the signature slots the table says are hashed, in table order, deduplicated (the three range rows share 'range')
const hashedSlotNameListOf = (fieldTable) =>
	fieldTable
		.filter((fieldRow) => fieldRow.hashed)
		.map((fieldRow) => fieldRow.hashSlot || fieldRow.fieldName)
		.filter((slotName, slotIndex, slotNameList) => slotNameList.indexOf(slotName) === slotIndex);

// hubFieldTableOf — ⟪ctdlHub P3⟫ THE ONE FILTER: the rows a hub admits, each row's tierList trimmed to the hub's tiers
// (row order and tier order kept). A row is admitted when it shares a tier with the hub and, if it names a
// rangeAddressing mode, that mode is the hub's.
const hubFieldTableOf = ({ fieldTable, tierList, rangeAddressing }) =>
	fieldTable
		.filter((fieldRow) => fieldRow.rangeAddressing === undefined || fieldRow.rangeAddressing === rangeAddressing)
		.map((fieldRow) => ({ ...fieldRow, tierList: fieldRow.tierList.filter((oneTier) => tierList.indexOf(oneTier) !== -1) }))
		.filter((fieldRow) => fieldRow.tierList.length > 0);

// slotProfileFromFieldTable — the HubDefinition's slotProfile IS the hub's view of the table, serialised: nothing is
// retyped. termAddressSignatureFieldOrder is written only for a hub that mints term cards, so a hub without the term
// tier gets the pre-P3 profile byte for byte.
const slotProfileFromFieldTable = ({ cardStructureVersion, fieldTable, addressSignatureFieldOrder, termAddressSignatureFieldOrder, tierList, rangeAddressing }) => ({
	cardStructureVersion,
	addressSignatureFieldOrder: addressSignatureFieldOrder.slice(),
	...(tierList.indexOf(REFERENCE_TIER.TERM) !== -1 ? { termAddressSignatureFieldOrder: termAddressSignatureFieldOrder.slice() } : {}),
	fieldList: hubFieldTableOf({ fieldTable, tierList, rangeAddressing }),
});

// cardFieldRefusal — '' when a just-emitted card's properties are exactly what the table allows for its tier at emit
// time (every name declared for the tier, every 'always' name present, no forgerStamp name yet); else the reason, naming
// each offending field
const cardFieldRefusal = ({ fieldTable, referenceTier, cardPropertyNameList, tierList, rangeAddressing }) => {
	if (tierList.indexOf(referenceTier) === -1) {
		return `referenceTier '${referenceTier}' is not in this hub's tierList [${tierList.join(', ')}]`;
	}
	const tierRowList = hubFieldTableOf({ fieldTable, tierList, rangeAddressing }).filter((fieldRow) => fieldRow.tierList.indexOf(referenceTier) !== -1);
	if (tierRowList.length === 0) {
		return `referenceTier '${referenceTier}' has no row in the hub card field table`;
	}
	const emitTimeNameList = tierRowList.filter((fieldRow) => fieldRow.presence !== 'forgerStamp').map((fieldRow) => fieldRow.fieldName);
	const undeclaredNameList = cardPropertyNameList.filter((fieldName) => emitTimeNameList.indexOf(fieldName) === -1);
	const missingAlwaysNameList = tierRowList
		.filter((fieldRow) => fieldRow.presence === 'always' && cardPropertyNameList.indexOf(fieldRow.fieldName) === -1)
		.map((fieldRow) => fieldRow.fieldName);
	if (undeclaredNameList.length === 0 && missingAlwaysNameList.length === 0) {
		return '';
	}
	return [
		undeclaredNameList.length ? `carries ${undeclaredNameList.join(', ')}, which the hub card field table does not declare for the ${referenceTier} tier at emit time` : '',
		missingAlwaysNameList.length ? `lacks ${missingAlwaysNameList.join(', ')}, which the table declares 'always' for the ${referenceTier} tier` : '',
	].filter((partText) => partText !== '').join('; ');
};

// fieldTableShapeRefusal — the table's own rules, checked where it is used: every row well-formed, names unique
const fieldTableShapeRefusal = (fieldTable) => {
	const seenNameList = [];
	for (let rowIndex = 0; rowIndex < fieldTable.length; rowIndex++) {
		const fieldRow = fieldTable[rowIndex];
		if (typeof fieldRow.fieldName !== 'string' || fieldRow.fieldName === '' || seenNameList.indexOf(fieldRow.fieldName) !== -1) {
			return `row ${rowIndex} has a blank or repeated fieldName ${JSON.stringify(fieldRow.fieldName)}`;
		}
		seenNameList.push(fieldRow.fieldName);
		if (!PRESENCE_PATTERN.test(fieldRow.presence) || !Array.isArray(fieldRow.tierList) || fieldRow.tierList.length === 0) {
			return `row '${fieldRow.fieldName}' has presence ${JSON.stringify(fieldRow.presence)} or tierList ${JSON.stringify(fieldRow.tierList)} outside the declared shape`;
		}
		const unknownTier = fieldRow.tierList.find((oneTier) => KNOWN_TIER_LIST.indexOf(oneTier) === -1);
		if (unknownTier !== undefined) {
			return `row '${fieldRow.fieldName}' names tier '${unknownTier}', which is not one of ${KNOWN_TIER_LIST.join(', ')}`;
		}
	}
	return '';
};

module.exports = {
	HUB_CARD_FIELD_TABLE,
	HUB_CARD_STRUCTURE_VERSION: 3,
	hashedSlotNameListOf,
	hubFieldTableOf,
	slotProfileFromFieldTable,
	cardFieldRefusal,
	fieldTableShapeRefusal,
};
