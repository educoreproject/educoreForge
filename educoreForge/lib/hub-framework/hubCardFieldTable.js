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
//   listValued true for a list (graph-contract LIST_VALUED_PROPERTY_NAME_LIST names the same two)

const BOTH_TIER_LIST = Object.freeze(['property', 'value']);
const PROPERTY_TIER_LIST = Object.freeze(['property']);
const VALUE_TIER_LIST = Object.freeze(['value']);

const row = (fieldRow) => Object.freeze({ hashed: false, listValued: false, ...fieldRow });

const HUB_CARD_FIELD_TABLE = Object.freeze([
	// ---- ADDRESS (§1.1): ids only ----
	row({ fieldName: 'hubName', group: 'address', hashed: true, tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'hubVersion', group: 'address', hashed: true, tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'referenceTier', group: 'address', tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'domainId', group: 'address', hashed: true, tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'propertyKey', group: 'address', hashed: true, tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'qualifierKeys', group: 'address', hashed: true, tierList: BOTH_TIER_LIST, presence: 'always', listValued: true }),
	row({ fieldName: 'rangeOptionSetId', group: 'address', hashed: true, hashSlot: 'range', tierList: BOTH_TIER_LIST, presence: 'conditional:the range is an option set' }),
	row({ fieldName: 'rangeClassId', group: 'address', hashed: true, hashSlot: 'range', tierList: PROPERTY_TIER_LIST, presence: 'conditional:the range is a class' }),
	row({ fieldName: 'rangeDatatype', group: 'address', hashed: true, hashSlot: 'range', tierList: PROPERTY_TIER_LIST, presence: 'conditional:the range is a datatype' }),
	row({ fieldName: 'valueKey', group: 'address', hashed: true, tierList: VALUE_TIER_LIST, presence: 'always' }),
	// ---- IDENTITY (§1.2): derived from the address ----
	row({ fieldName: 'canonicalKey', group: 'identity', hashed: true, tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'addressSignature', group: 'identity', tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'uri', group: 'identity', tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'name', group: 'identity', tierList: BOTH_TIER_LIST, presence: 'always' }),
	// ---- SCOPE ----
	row({ fieldName: '_source', group: 'scope', tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'role', group: 'scope', tierList: BOTH_TIER_LIST, presence: 'always' }),
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
	// ---- PROVENANCE (§1.4) ----
	row({ fieldName: 'anchorUri', group: 'provenance', tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'domainUri', group: 'provenance', tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'propertyUri', group: 'provenance', tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'rangeUri', group: 'provenance', tierList: BOTH_TIER_LIST, presence: 'conditional:the range is an option set or a class' }),
	row({ fieldName: 'valueUri', group: 'provenance', tierList: VALUE_TIER_LIST, presence: 'always' }),
	// ---- DERIVED (§1.5) ----
	row({ fieldName: 'embedText', group: 'derived', tierList: BOTH_TIER_LIST, presence: 'always' }),
	row({ fieldName: 'embedding', group: 'derived', tierList: BOTH_TIER_LIST, presence: 'forgerStamp' }),
	row({ fieldName: 'embeddingModelVersion', group: 'derived', tierList: BOTH_TIER_LIST, presence: 'forgerStamp' }),
	row({ fieldName: 'embedSourceProperty', group: 'derived', tierList: BOTH_TIER_LIST, presence: 'forgerStamp' }),
]);

const PRESENCE_PATTERN = /^(always|forgerStamp|conditional:.+)$/;

// the signature slots the table says are hashed, in table order, deduplicated (the three range rows share 'range')
const hashedSlotNameListOf = (fieldTable) =>
	fieldTable
		.filter((fieldRow) => fieldRow.hashed)
		.map((fieldRow) => fieldRow.hashSlot || fieldRow.fieldName)
		.filter((slotName, slotIndex, slotNameList) => slotNameList.indexOf(slotName) === slotIndex);

// slotProfileFromFieldTable — the HubDefinition's slotProfile IS the table, serialised: nothing is retyped
const slotProfileFromFieldTable = ({ cardStructureVersion, fieldTable, addressSignatureFieldOrder }) => ({
	cardStructureVersion,
	addressSignatureFieldOrder: addressSignatureFieldOrder.slice(),
	fieldList: fieldTable.map((fieldRow) => ({ ...fieldRow, tierList: fieldRow.tierList.slice() })),
});

// cardFieldRefusal — '' when a just-emitted card's properties are exactly what the table allows for its tier at emit
// time (every name declared for the tier, every 'always' name present, no forgerStamp name yet); else the reason, naming
// each offending field
const cardFieldRefusal = ({ fieldTable, referenceTier, cardPropertyNameList }) => {
	const tierRowList = fieldTable.filter((fieldRow) => fieldRow.tierList.indexOf(referenceTier) !== -1);
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
	}
	return '';
};

module.exports = {
	HUB_CARD_FIELD_TABLE,
	HUB_CARD_STRUCTURE_VERSION: 3,
	hashedSlotNameListOf,
	slotProfileFromFieldTable,
	cardFieldRefusal,
	fieldTableShapeRefusal,
};
