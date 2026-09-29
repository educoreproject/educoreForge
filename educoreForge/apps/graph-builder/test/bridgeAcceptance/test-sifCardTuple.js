#!/usr/bin/env node
'use strict';

// test-sifCardTuple.js — phase C6b's gates for sifCardTuple.js, the assembly of the card label list with full
// tuples. Hermetic: rows in, list out; no graph, no Docker, no network.
//
//   SIF-TUPLE  the list carries each card's whole tuple, an absent slot is absent (never null), and a qualifier
//              no option value row resolves is refused by name
//
// Every conjunct is observed red under its own twin (forge-framework gateSuiteRunner).
//
// Run: PATH=/usr/local/bin:$PATH node apps/graph-builder/test/bridgeAcceptance/test-sifCardTuple.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase C6b gates: the card label list's full tuples and the qualifier refusal

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../test/testLib/harness')(moduleName);

const path = require('path');
const { runGateFamily } = require('../../../../lib/forge-framework/test/testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../../../../lib/forge-framework/roundTripHarness/twinRegistry');
const moduleDouble = require('../../../../lib/forge-framework/test/testSupport/moduleDouble');

const TUPLE_FILE_PATH = path.join(__dirname, 'sifCardTuple.js');

// the rows the export tool hands over, as the live hub carries them: a plain card, a card with a range option
// set, and two cards of one property id that differ only by qualifier
const makeCardRowList = () => [
	{ cardStableId: 'card:plain', domainId: 'C1', domainName: 'Dom One', propertyId: 'P1', propertyName: 'Prop One', rangeOptionSetId: null, rangeOptionSetName: null, valueNotation: null, valueName: null, qualifierRefIdList: [] },
	{ cardStableId: 'card:ranged', domainId: 'C1', domainName: 'Dom One', propertyId: 'P2', propertyName: 'Prop Two', rangeOptionSetId: 'OS2', rangeOptionSetName: 'Set Two', valueNotation: null, valueName: null, qualifierRefIdList: [] },
	{ cardStableId: 'card:qualA', domainId: 'C1', domainName: 'Dom One', propertyId: 'P3', propertyName: 'Prop Three', rangeOptionSetId: null, rangeOptionSetName: null, valueNotation: null, valueName: null, qualifierRefIdList: ['OV1'] },
	{ cardStableId: 'card:qualB', domainId: 'C1', domainName: 'Dom One', propertyId: 'P3', propertyName: 'Prop Three', rangeOptionSetId: null, rangeOptionSetName: null, valueNotation: null, valueName: null, qualifierRefIdList: ['OV2'] },
];
const makeOptionValueRowList = () => [
	{ optionValueRefId: 'OV1', optionValueName: 'Value One', optionSetId: 'OS9', optionSetName: 'Type Nine' },
	{ optionValueRefId: 'OV2', optionValueName: 'Value Two', optionSetId: 'OS9', optionSetName: 'Type Nine' },
];
// THE FROZEN ANSWER, worked by hand from the rows above: null slots are absent, each qualifier is carried by id
// and labelled once
const EXPECTED_LIST_TEXT = JSON.stringify({
	cardLabelByStableId: {
		'card:plain': { domainId: 'C1', domainName: 'Dom One', propertyId: 'P1', propertyName: 'Prop One', qualifierRefIdList: [] },
		'card:ranged': { domainId: 'C1', domainName: 'Dom One', propertyId: 'P2', propertyName: 'Prop Two', rangeOptionSetId: 'OS2', rangeOptionSetName: 'Set Two', qualifierRefIdList: [] },
		'card:qualA': { domainId: 'C1', domainName: 'Dom One', propertyId: 'P3', propertyName: 'Prop Three', qualifierRefIdList: ['OV1'] },
		'card:qualB': { domainId: 'C1', domainName: 'Dom One', propertyId: 'P3', propertyName: 'Prop Three', qualifierRefIdList: ['OV2'] },
	},
	optionValueLabelByRefId: {
		OV1: { optionSetId: 'OS9', optionSetName: 'Type Nine', optionValueName: 'Value One' },
		OV2: { optionSetId: 'OS9', optionSetName: 'Type Nine', optionValueName: 'Value Two' },
	},
});

const makeSubject = () => ({ cardRowList: makeCardRowList(), optionValueRowList: makeOptionValueRowList(), mutationList: [] });
const cloneSubject = (subject) => ({ cardRowList: JSON.parse(JSON.stringify(subject.cardRowList)), optionValueRowList: JSON.parse(JSON.stringify(subject.optionValueRowList)), mutationList: subject.mutationList.slice() });

// a throw is a MEASURED OUTCOME: a twin that deletes a refusal can crash the module unnamed, and that reads as red
const runTuple = (subject) => {
	const tupleModule = subject.mutationList.length === 0 ? require(TUPLE_FILE_PATH) : moduleDouble.loadWithMutations({ modulePath: TUPLE_FILE_PATH, mutationList: subject.mutationList });
	try {
		return tupleModule.buildCardTupleList({ cardRowList: subject.cardRowList, optionValueRowList: subject.optionValueRowList });
	} catch (tupleThrow) {
		return { thrown: tupleThrow.message };
	}
};

const twinRegistry = makeTwinRegistry();
const registerMutationTwin = ({ conjunctId, twinName, find, replace }) => {
	moduleDouble.assertMutationApplies({ modulePath: TUPLE_FILE_PATH, find });
	twinRegistry.register({ gateId: GATE_A, conjunctId, twinName, leverKind: 'productionMutation', shippedConfig: true, run: (subject) => {
		subject.mutationList.push({ modulePath: TUPLE_FILE_PATH, find, replace });
		return subject;
	} });
};

const GATE_A = 'SIF-TUPLE';
const gateAConjunctList = [
	{
		conjunctId: 'e1_tupleListExact',
		title: 'the list equals the hand-worked one: whole tuples, absent slots absent (not null), qualifiers by id with one label entry each',
		twinNameList: ['nullSlotCarried'],
		evaluate: (subject, callback) => {
			const built = runTuple(subject);
			const measuredText = JSON.stringify(built);
			callback('', { pass: measuredText === EXPECTED_LIST_TEXT, detail: measuredText === EXPECTED_LIST_TEXT ? 'equal' : `measured ${measuredText.slice(0, 300)}` });
		},
	},
	{
		conjunctId: 'e2_unresolvedQualifierRefused',
		title: 'a qualifier no option value row resolves (OV2 dropped) is refused by name, and no list is returned',
		twinNameList: ['resolveCheckDeleted'],
		evaluate: (subject, callback) => {
			subject.optionValueRowList = subject.optionValueRowList.filter((oneRow) => oneRow.optionValueRefId !== 'OV2');
			const built = runTuple(subject);
			if (built.thrown !== undefined) {
				callback('', { pass: false, detail: `NOT A REFUSAL — the module crashed, naming nothing: ${built.thrown}` });
				return;
			}
			const refused = built.error !== undefined && /card card:qualB carries qualifier OV2, and no option value row resolves it to an option value name and an option set name/.test(built.error.message) && built.cardLabelByStableId === undefined;
			callback('', { pass: refused, detail: refused ? built.error.message.slice(0, 200) : 'expected a refusal naming card:qualB and OV2, but a list was built' });
		},
	},
];
registerMutationTwin({ conjunctId: 'e1_tupleListExact', twinName: 'nullSlotCarried', find: 'oneCard[oneSlotName] !== undefined && oneCard[oneSlotName] !== null', replace: 'true' });
registerMutationTwin({ conjunctId: 'e2_unresolvedQualifierRefused', twinName: 'resolveCheckDeleted', find: 'if (unresolvedRefId !== undefined) {', replace: 'if (false) {' });

const gateDeclarationList = [{ gateId: GATE_A, title: "phase C6b: the card label list carries each card's full tuple; an unresolved qualifier is refused by name", conjunctList: gateAConjunctList }];

runGateFamily({ harness, familyName: 'SIF-TUPLE', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 2, expectedTwinCount: 2 }, () => harness.report());
