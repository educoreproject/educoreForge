'use strict';

// test-hubCardFieldTable.js — ⟪campaign P3, W-C-5 (V1-C33, V1-S66/S67)⟫ the hub card field table is the ONE declaration
// of a card's fields: the HubDefinition's slotProfile is built from it, the emitter's post-emit check reads it, and its
// hashed rows ARE the vocabulary's ADDRESS_SIGNATURE_FIELD_ORDER. PURE: synthetic cards, no forge.
// (test-cedsHubForge G-9 holds the same rules over EVERY card of the real forged hub.)
//
//   a  slotProfileFromFieldTable serialises the table whole: fieldList deep-equals it, version 3, the signature order kept
//   b  the table's hashed slots (hashSlot or fieldName, deduplicated) are EXACTLY ADDRESS_SIGNATURE_FIELD_ORDER's slots
//   c  a well-formed qualified property card and a value card pass cardFieldRefusal; an undeclared field, a missing
//      'always' field, a value-tier qualifierNames and a forger stamp at emit time are each refused by name
//   d  the table's own shape: names unique, presence in the declared grammar
//
// RED TWINS (each a changed COPY of the table, nothing written):
//   qualifierNamesRowDeleted        -> c red (a qualified card now carries an undeclared field)
//   referenceTierHashed             -> b red (a slot the signature never reads)
//   duplicateRow                    -> d red
//   fieldListRetyped                -> a red (a profile built from anything but the table)

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

const path = require('path');
const tableLib = require('../hubCardFieldTable');
const { ADDRESS_SIGNATURE_FIELD_ORDER } = require(path.join(__dirname, '..', '..', 'vocabulary', 'vocabulary'));

const { HUB_CARD_FIELD_TABLE, HUB_CARD_STRUCTURE_VERSION, hashedSlotNameListOf, slotProfileFromFieldTable, cardFieldRefusal, fieldTableShapeRefusal } = tableLib;

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
const refusalFor = (fieldTable, card) => cardFieldRefusal({ fieldTable, referenceTier: card.referenceTier, cardPropertyNameList: Object.keys(card) });

const judgeByConjunct = {
	a_profileIsTheTable: ({ fieldTable, profileBuilder }) => {
		const profile = profileBuilder({ cardStructureVersion: HUB_CARD_STRUCTURE_VERSION, fieldTable: HUB_CARD_FIELD_TABLE, addressSignatureFieldOrder: ADDRESS_SIGNATURE_FIELD_ORDER });
		const pass = JSON.stringify(profile.fieldList) === JSON.stringify(fieldTable) && profile.cardStructureVersion === 3 && JSON.stringify(profile.addressSignatureFieldOrder) === JSON.stringify(ADDRESS_SIGNATURE_FIELD_ORDER);
		return { pass, detail: `version ${profile.cardStructureVersion}; fieldList ${(profile.fieldList || []).length} rows` };
	},
	b_hashedRowsAreTheSignatureOrder: ({ fieldTable }) => {
		const hashedSlotNameList = hashedSlotNameListOf(fieldTable);
		return { pass: JSON.stringify(hashedSlotNameList.slice().sort()) === JSON.stringify(ADDRESS_SIGNATURE_FIELD_ORDER.slice().sort()), detail: `table [${hashedSlotNameList.join(', ')}] vs order [${ADDRESS_SIGNATURE_FIELD_ORDER.join(', ')}]` };
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
};

const shippedSubject = () => ({ fieldTable: HUB_CARD_FIELD_TABLE, profileBuilder: slotProfileFromFieldTable });
const TWIN_LIST = [
	{ conjunctRefId: 'c_cardsCheckedByTier', twinName: 'qualifierNamesRowDeleted', subject: () => ({ ...shippedSubject(), fieldTable: HUB_CARD_FIELD_TABLE.filter((fieldRow) => fieldRow.fieldName !== 'qualifierNames') }) },
	{ conjunctRefId: 'b_hashedRowsAreTheSignatureOrder', twinName: 'referenceTierHashed', subject: () => ({ ...shippedSubject(), fieldTable: HUB_CARD_FIELD_TABLE.map((fieldRow) => (fieldRow.fieldName === 'referenceTier' ? { ...fieldRow, hashed: true } : fieldRow)) }) },
	{ conjunctRefId: 'd_tableShape', twinName: 'duplicateRow', subject: () => ({ ...shippedSubject(), fieldTable: HUB_CARD_FIELD_TABLE.concat([HUB_CARD_FIELD_TABLE[0]]) }) },
	{ conjunctRefId: 'a_profileIsTheTable', twinName: 'fieldListRetyped', subject: () => ({ ...shippedSubject(), profileBuilder: (args) => ({ ...slotProfileFromFieldTable(args), fieldList: args.fieldTable.map((fieldRow) => fieldRow.fieldName) }) }) },
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
