'use strict';

// test-hubCardFieldTable.js — ⟪campaign P3, W-C-5 (V1-C33, V1-S66/S67)⟫ the hub card field table is the ONE declaration
// of a card's fields: the HubDefinition's slotProfile is built from it, the emitter's post-emit check reads it, and its
// hashed rows ARE the vocabulary's ADDRESS_SIGNATURE_FIELD_ORDER. PURE: synthetic cards, no forge.
// (test-cedsHubForge G-9 holds the same rules over EVERY card of the real forged hub.)
//
//   a  slotProfileFromFieldTable serialises the HUB'S VIEW of the table (hubFieldTableOf): fieldList deep-equals it,
//      version 3, the signature order kept; and ⟪ctdlHub P3⟫ the CEDS view's profile text equals, character for
//      character, the FROZEN profile captured at 087550f9 before P3 touched the framework
//      (fixtures/cedsSlotProfile-frozen-087550f9.json)
//   b  per tier family, the hashed slots (hashSlot or fieldName, deduplicated) are EXACTLY that family's signature order:
//      property/value rows ADDRESS_SIGNATURE_FIELD_ORDER, term rows TERM_ADDRESS_SIGNATURE_FIELD_ORDER
//   c  a well-formed qualified property card and a value card pass cardFieldRefusal; an undeclared field, a missing
//      'always' field, a value-tier qualifierNames and a forger stamp at emit time are each refused by name
//   d  the table's own shape: names unique, presence in the declared grammar
//   e  ⟪ctdlHub P3⟫ a rangeAsMeaning row reaches only a rangeAsMeaning hub; a term card passes only under a term hub
//
// RED TWINS (each a changed COPY of the table, nothing written):
//   qualifierNamesRowDeleted        -> c red (a qualified card now carries an undeclared field)
//   referenceTierHashed             -> b red (a slot the signature never reads)
//   duplicateRow                    -> d red
//   fieldListRetyped                -> a red (a profile built from anything but the table)
//   cedsRowPerturbed                -> a red (one CEDS row changed: the frozen literal catches it)
//   filterIgnoresTierList           -> a red (term rows leak into the CEDS profile)
//   rangeModeAttributeDropped       -> e red (the rangeAsMeaning rows lose their mode and reach CEDS)

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- W-C-5: the hub card field table builds the slotProfile and gates every card

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const tableLib = require('../hubCardFieldTable');
const { ADDRESS_SIGNATURE_FIELD_ORDER, TERM_ADDRESS_SIGNATURE_FIELD_ORDER } = require(path.join(__dirname, '..', '..', 'vocabulary', 'vocabulary'));

const { HUB_CARD_FIELD_TABLE, HUB_CARD_STRUCTURE_VERSION, hashedSlotNameListOf, hubFieldTableOf, slotProfileFromFieldTable, cardFieldRefusal, fieldTableShapeRefusal } = tableLib;

// the scope CEDS declares (forges/ceds/lib/cedsHubDeclaration.js) and the scope a CTDL-shaped hub declares
const CEDS_SCOPE = Object.freeze({ tierList: Object.freeze(['property', 'value']), rangeAddressing: 'singleRangeSlot' });
const TERM_HUB_SCOPE = Object.freeze({ tierList: Object.freeze(['term', 'property', 'value']), rangeAddressing: 'rangeAsMeaning' });
const FROZEN_CEDS_PROFILE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cedsSlotProfile-frozen-087550f9.json'), 'utf8'));
const TERM_CARD = Object.freeze({
	_source: 'CTDL', role: 'HubReference', name: 'name', hubName: 'CTDL', hubVersion: '20260327', referenceTier: 'term',
	termIri: 'ceterms:name', addressSignature: 'c'.repeat(64), uri: 'https://x/card3', termName: 'name', termKind: 'property',
	anchorUri: 'ceterms:name', embedText: 'name',
});

const QUALIFIED_PROPERTY_CARD = Object.freeze({
	_source: 'CEDS', role: 'HubReference', name: 'Birthdate', hubName: 'CEDS', hubVersion: '14.0.0.0', referenceTier: 'property',
	domainId: 'C200275', propertyKey: 'P000033', qualifierKeys: ['C001234'], addressSignature: 'a'.repeat(64), uri: 'https://x/card',
	canonicalKey: 'P000033', rangeDatatype: 'date', domainName: 'Person', propertyName: 'Birthdate', qualifierNames: ['Some Qualifier'],
	anchorUri: 'https://x/P000033', domainUri: 'https://x/C200275', propertyUri: 'https://x/P000033', embedText: 'Person: Birthdate',
});
const VALUE_CARD = Object.freeze({
	_source: 'CEDS', role: 'HubReference', name: 'Female', hubName: 'CEDS', hubVersion: '14.0.0.0', referenceTier: 'value',
	domainId: 'C200275', propertyKey: 'P000255', qualifierKeys: [], addressSignature: 'b'.repeat(64), uri: 'https://x/card2',
	canonicalKey: 'P000255/Female', rangeOptionSetId: 'C000255', valueKey: 'Female', propertyName: 'Sex', valueName: 'Female',
	anchorUri: 'https://x/Female', domainUri: 'https://x/C200275', propertyUri: 'https://x/P000255', rangeUri: 'https://x/C000255',
	valueUri: 'https://x/Female', embedText: 'Person: Sex: Female',
});
const refusalFor = (fieldTable, card, hubScope = CEDS_SCOPE) => cardFieldRefusal({ fieldTable, referenceTier: card.referenceTier, cardPropertyNameList: Object.keys(card), ...hubScope });
const profileFor = ({ fieldTable, profileBuilder, filter, hubScope }) =>
	profileBuilder({ cardStructureVersion: HUB_CARD_STRUCTURE_VERSION, fieldTable, addressSignatureFieldOrder: ADDRESS_SIGNATURE_FIELD_ORDER, termAddressSignatureFieldOrder: TERM_ADDRESS_SIGNATURE_FIELD_ORDER, ...hubScope, filter });

const judgeByConjunct = {
	a_profileIsTheTable: ({ fieldTable, profileBuilder, filter }) => {
		const cedsProfile = profileFor({ fieldTable, profileBuilder, filter, hubScope: CEDS_SCOPE });
		const termHubProfile = profileFor({ fieldTable, profileBuilder, filter, hubScope: TERM_HUB_SCOPE });
		const viewIsTheFilteredTable =
			JSON.stringify(cedsProfile.fieldList) === JSON.stringify(hubFieldTableOf({ fieldTable: HUB_CARD_FIELD_TABLE, ...CEDS_SCOPE }))
			&& JSON.stringify(termHubProfile.fieldList) === JSON.stringify(hubFieldTableOf({ fieldTable: HUB_CARD_FIELD_TABLE, ...TERM_HUB_SCOPE }));
		const cedsEqualsFrozen = JSON.stringify(cedsProfile) === FROZEN_CEDS_PROFILE.slotProfileText;
		const termOrderOnlyForTermHub = cedsProfile.termAddressSignatureFieldOrder === undefined
			&& JSON.stringify(termHubProfile.termAddressSignatureFieldOrder) === JSON.stringify(TERM_ADDRESS_SIGNATURE_FIELD_ORDER);
		const pass = viewIsTheFilteredTable && cedsEqualsFrozen && termOrderOnlyForTermHub && cedsProfile.cardStructureVersion === 3
			&& JSON.stringify(cedsProfile.addressSignatureFieldOrder) === JSON.stringify(ADDRESS_SIGNATURE_FIELD_ORDER);
		return { pass, detail: `view is the filtered table: ${viewIsTheFilteredTable}; CEDS profile equals the frozen 087550f9 text: ${cedsEqualsFrozen}; term order only for a term hub: ${termOrderOnlyForTermHub}; CEDS fieldList ${(cedsProfile.fieldList || []).length} rows, term hub ${(termHubProfile.fieldList || []).length}` };
	},
	b_hashedRowsAreTheSignatureOrder: ({ fieldTable }) => {
		const tupleHashedSlotNameList = hashedSlotNameListOf(hubFieldTableOf({ fieldTable, ...CEDS_SCOPE }));
		const termHashedSlotNameList = hashedSlotNameListOf(hubFieldTableOf({ fieldTable, tierList: ['term'], rangeAddressing: 'rangeAsMeaning' }));
		const sortedText = (nameList) => JSON.stringify(nameList.slice().sort());
		const pass = sortedText(tupleHashedSlotNameList) === sortedText(ADDRESS_SIGNATURE_FIELD_ORDER) && sortedText(termHashedSlotNameList) === sortedText(TERM_ADDRESS_SIGNATURE_FIELD_ORDER)
			&& sortedText(tupleHashedSlotNameList) === sortedText(FROZEN_CEDS_PROFILE.hashedSlotNameList);
		return { pass, detail: `property/value [${tupleHashedSlotNameList.join(', ')}] vs [${ADDRESS_SIGNATURE_FIELD_ORDER.join(', ')}]; term [${termHashedSlotNameList.join(', ')}] vs [${TERM_ADDRESS_SIGNATURE_FIELD_ORDER.join(', ')}]` };
	},
	c_cardsCheckedByTier: ({ fieldTable }) => {
		const qualifiedRefusal = refusalFor(fieldTable, QUALIFIED_PROPERTY_CARD);
		const valueRefusal = refusalFor(fieldTable, VALUE_CARD);
		const undeclaredRefusal = refusalFor(fieldTable, { ...VALUE_CARD, frobnicate: 'x' });
		const missingRefusal = refusalFor(fieldTable, (({ valueName, ...rest }) => rest)(VALUE_CARD));
		const valueQualifierRefusal = refusalFor(fieldTable, { ...VALUE_CARD, qualifierNames: ['x'] });
		const stampRefusal = refusalFor(fieldTable, { ...VALUE_CARD, embedding: [0.1] });
		const pass = qualifiedRefusal === '' && valueRefusal === ''
			&& /carries frobnicate, which the hub card field table does not declare for the value tier/.test(undeclaredRefusal)
			&& /lacks valueName, which the table declares 'always' for the value tier/.test(missingRefusal)
			&& /carries qualifierNames/.test(valueQualifierRefusal)
			&& /carries embedding/.test(stampRefusal);
		return { pass, detail: [qualifiedRefusal || 'qualified ok', valueRefusal || 'value ok', undeclaredRefusal, missingRefusal, valueQualifierRefusal, stampRefusal].join(' | ').slice(0, 400) };
	},
	d_tableShape: ({ fieldTable }) => {
		const refusal = fieldTableShapeRefusal(fieldTable);
		return { pass: refusal === '', detail: refusal || 'well formed' };
	},
	e_scopeAdmitsOnlyItsRows: ({ fieldTable }) => {
		const rangeListNameList = ['rangeClassIdList', 'rangeClassNameList', 'rangeOptionSetIdList', 'rangeOptionSetNameList', 'rangeDatatypeList'];
		const namesIn = (hubScope) => hubFieldTableOf({ fieldTable, ...hubScope }).map((fieldRow) => fieldRow.fieldName);
		const cedsNameList = namesIn(CEDS_SCOPE);
		const termHubNameList = namesIn(TERM_HUB_SCOPE);
		const rangeListsOnlyUnderMeaning = rangeListNameList.every((fieldName) => cedsNameList.indexOf(fieldName) === -1 && termHubNameList.indexOf(fieldName) !== -1);
		const termCardUnderTermHub = refusalFor(fieldTable, TERM_CARD, TERM_HUB_SCOPE);
		const termCardUnderCeds = refusalFor(fieldTable, TERM_CARD, CEDS_SCOPE);
		const pass = rangeListsOnlyUnderMeaning && termCardUnderTermHub === '' && /is not in this hub's tierList/.test(termCardUnderCeds);
		return { pass, detail: `range lists only under rangeAsMeaning: ${rangeListsOnlyUnderMeaning}; term card under a term hub: ${termCardUnderTermHub || 'admitted'}; under CEDS: ${termCardUnderCeds}` };
	},
};

const shippedSubject = () => ({ fieldTable: HUB_CARD_FIELD_TABLE, profileBuilder: slotProfileFromFieldTable });
// a profile builder that ignores the hub's tierList (the pre-P3 shape): every row reaches every hub
const unfilteredProfileBuilder = (args) => ({ ...slotProfileFromFieldTable(args), fieldList: args.fieldTable.map((fieldRow) => ({ ...fieldRow, tierList: fieldRow.tierList.slice() })) });
const TWIN_LIST = [
	{ conjunctRefId: 'c_cardsCheckedByTier', twinName: 'qualifierNamesRowDeleted', subject: () => ({ ...shippedSubject(), fieldTable: HUB_CARD_FIELD_TABLE.filter((fieldRow) => fieldRow.fieldName !== 'qualifierNames') }) },
	{ conjunctRefId: 'b_hashedRowsAreTheSignatureOrder', twinName: 'referenceTierHashed', subject: () => ({ ...shippedSubject(), fieldTable: HUB_CARD_FIELD_TABLE.map((fieldRow) => (fieldRow.fieldName === 'referenceTier' ? { ...fieldRow, hashed: true } : fieldRow)) }) },
	{ conjunctRefId: 'd_tableShape', twinName: 'duplicateRow', subject: () => ({ ...shippedSubject(), fieldTable: HUB_CARD_FIELD_TABLE.concat([HUB_CARD_FIELD_TABLE[0]]) }) },
	{ conjunctRefId: 'a_profileIsTheTable', twinName: 'fieldListRetyped', subject: () => ({ ...shippedSubject(), profileBuilder: (args) => ({ ...slotProfileFromFieldTable(args), fieldList: args.fieldTable.map((fieldRow) => fieldRow.fieldName) }) }) },
	{ conjunctRefId: 'a_profileIsTheTable', twinName: 'cedsRowPerturbed', subject: () => ({ ...shippedSubject(), fieldTable: HUB_CARD_FIELD_TABLE.map((fieldRow) => (fieldRow.fieldName === 'propertyNotation' ? { ...fieldRow, presence: 'conditional:the property has a notation, perturbed' } : fieldRow)) }) },
	{ conjunctRefId: 'a_profileIsTheTable', twinName: 'filterIgnoresTierList', subject: () => ({ ...shippedSubject(), profileBuilder: unfilteredProfileBuilder }) },
	{ conjunctRefId: 'e_scopeAdmitsOnlyItsRows', twinName: 'rangeModeAttributeDropped', subject: () => ({ ...shippedSubject(), fieldTable: HUB_CARD_FIELD_TABLE.map((fieldRow) => (fieldRow.rangeAddressing === undefined ? fieldRow : (({ rangeAddressing, ...rest }) => rest)(fieldRow))) }) },
];

harness.section('BASELINE — the shipped table passes every conjunct');
Object.keys(judgeByConjunct).forEach((conjunctRefId) => {
	const verdict = judgeByConjunct[conjunctRefId](shippedSubject());
	harness.ok(`${conjunctRefId} PASS`, verdict.pass, verdict.detail);
});

harness.section('THE TWIN SWEEP — each conjunct OBSERVED RED under a changed copy of the table');
const reddenedConjunctList = [];
TWIN_LIST.forEach((oneTwin) => {
	const verdict = judgeByConjunct[oneTwin.conjunctRefId](oneTwin.subject());
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail.slice(0, 200)}`);
	if (!verdict.pass) reddenedConjunctList.push(oneTwin.conjunctRefId);
});
harness.equal('every conjunct has an observed twin', Object.keys(judgeByConjunct).filter((conjunctRefId) => reddenedConjunctList.indexOf(conjunctRefId) === -1).join(','), '');

harness.report();
