'use strict';

// test-hubTierFiltering.js — ⟪ctdlHub P3 step 1⟫ THE TRAP THE TERM TIER WOULD SPRING ON CEDS. The HubDefinition's
// slotProfile is the hub card field table serialised whole (hubCardFieldTable.slotProfileFromFieldTable), and the
// slotProfile is a node property, so it is BLOCK BYTES. A term-tier row added to the table for CTDL would therefore
// enter the CEDS profile and move the CEDS block id, unless the table is filtered by the tiers a hub declares
// (hubDeclaration.tierList). PURE: a COPY of the table with one dummy row, nothing written.
//
//   a  a term-tier row in the table does NOT change the profile of a hub whose tierList lacks 'term'
//   b  a term-tier card is refused by name by a hub whose tierList lacks 'term', and admitted by one that has it
//
// RED FIRST: this suite was committed BEFORE the filter existed and was observed failing on both conjuncts (the
// unfiltered profile carried the dummy row; cardFieldRefusal admitted the term card). See DEVLOG-hubFramework.md.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- ctdlHub P3 step 1: the field table is filtered by the hub's declared tierList

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const { HUB_CARD_FIELD_TABLE, HUB_CARD_STRUCTURE_VERSION, slotProfileFromFieldTable, cardFieldRefusal } = require('../hubCardFieldTable');
const { ADDRESS_SIGNATURE_FIELD_ORDER } = require(path.join(__dirname, '..', '..', 'vocabulary', 'vocabulary'));

const CEDS_TIER_LIST = Object.freeze(['property', 'value']);
const TERM_HUB_TIER_LIST = Object.freeze(['term', 'property', 'value']);
const DUMMY_TERM_ROW = Object.freeze({ fieldName: 'dummyTermOnlyField', group: 'meaning', hashed: false, listValued: false, tierList: Object.freeze(['term']), presence: 'always' });
const TABLE_WITH_DUMMY_TERM_ROW = Object.freeze(HUB_CARD_FIELD_TABLE.concat([DUMMY_TERM_ROW]));

const profileTextOf = ({ fieldTable, tierList }) =>
	JSON.stringify(slotProfileFromFieldTable({ cardStructureVersion: HUB_CARD_STRUCTURE_VERSION, fieldTable, addressSignatureFieldOrder: ADDRESS_SIGNATURE_FIELD_ORDER, tierList }));

harness.section('a — a term-tier row does not reach the profile of a hub that mints no term cards');
const profileWithoutDummy = profileTextOf({ fieldTable: HUB_CARD_FIELD_TABLE, tierList: CEDS_TIER_LIST });
const profileWithDummy = profileTextOf({ fieldTable: TABLE_WITH_DUMMY_TERM_ROW, tierList: CEDS_TIER_LIST });
harness.ok(
	'a_cedsProfileUnmovedByTermRow',
	profileWithDummy === profileWithoutDummy,
	`profile with the dummy row is ${profileWithDummy.length} chars, without it ${profileWithoutDummy.length}; carries dummy: ${profileWithDummy.indexOf(DUMMY_TERM_ROW.fieldName) !== -1}`,
);
harness.ok(
	'a_termHubProfileCarriesTheTermRow (control: the filter is not a deletion)',
	profileTextOf({ fieldTable: TABLE_WITH_DUMMY_TERM_ROW, tierList: TERM_HUB_TIER_LIST }).indexOf(DUMMY_TERM_ROW.fieldName) !== -1,
	'a hub declaring the term tier must still see its term rows',
);

harness.section('b — a term card is refused by a hub that does not declare the term tier');
const termCardPropertyNameList = ['dummyTermOnlyField'];
const refusalUnderCeds = cardFieldRefusal({ fieldTable: TABLE_WITH_DUMMY_TERM_ROW, referenceTier: 'term', cardPropertyNameList: termCardPropertyNameList, tierList: CEDS_TIER_LIST });
const refusalUnderTermHub = cardFieldRefusal({ fieldTable: TABLE_WITH_DUMMY_TERM_ROW, referenceTier: 'term', cardPropertyNameList: termCardPropertyNameList, tierList: TERM_HUB_TIER_LIST });
harness.match('b_termCardRefusedWithoutTermTier', refusalUnderCeds, /referenceTier 'term' is not in this hub's tierList/);
harness.equal('b_termCardAdmittedWithTermTier (control)', refusalUnderTermHub, '');

harness.report();
