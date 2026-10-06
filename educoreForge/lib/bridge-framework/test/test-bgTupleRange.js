#!/usr/bin/env node
'use strict';

// test-bgTupleRange.js — BG-TUPLERANGE (W-B-14, V1-C34 / V1-S71/S72; campaign P3 2026-10-06): the tuple filter names the
// card's three range properties, not 'range' — a name no card carries (it is the hub address-signature SLOT).
//
//   BG-TUPLERANGE  (a) a crosswalk declaration mapping 'range' is refused by name, naming the three card properties;
//                  (b) one mapping rangeOptionSetId registers; (c) the toy crosswalk run's prompts are byte-identical to
//                  before the change (the renderer passed range: oneCard.range, which was always undefined and never
//                  emitted) — digest of every (promptHash, sha256(userPrompt)) measured at 622b3c6.
//
// Run: node lib/bridge-framework/test/test-bgTupleRange.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-TUPLERANGE: the tuple filter names the card's range properties

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { pureConjunct, runConjunct, succeeded, frameworkMutationTwin, scenarioTwin, forensicsOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const CONTRACT_FILE = 'bridgePluginContract.js';
const RENDERER_FILE = 'evidenceRenderer.js';
const CROSSWALK_PLUGIN_NAME = 'toyCrosswalkPlugin';
// measured at 622b3c6 (before W-B-14) over the default toy scenario: 5 prompts
const CROSSWALK_PROMPT_DIGEST_BEFORE = '7e8c88cd1a02a526d1fe439617956a2259d9f0ced7f08a56219333d1ba5d234c';
const contractLibFor = (scenario) => (scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CONTRACT_FILE), mutationList: scenario.frameworkMutationList }) : require('../bridgePluginContract'));
const crosswalkDeclarationMapping = (fieldName) => {
	const bridgeDeclaration = scenarioLib.cloneJson(require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${CROSSWALK_PLUGIN_NAME}.js`)).bridgeDeclaration);
	bridgeDeclaration.tupleFieldColumnMap = { ...bridgeDeclaration.tupleFieldColumnMap, [fieldName]: { ...bridgeDeclaration.tupleFieldColumnMap.canonicalKey } };
	return bridgeDeclaration;
};
const validationOf = (scenario, fieldName) => contractLibFor(scenario).validateBridgeDeclaration({ bridgeDeclaration: crosswalkDeclarationMapping(fieldName), bundleDirPath: path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy') });

const conjunctList = [
	pureConjunct({
		conjunctId: 'a_rangeRefusedNamingTheCardProperties',
		title: "a crosswalk declaration mapping 'range' is refused by name, naming rangeOptionSetId | rangeClassId | rangeDatatype",
		twinNameList: ['rangeBackInTheTupleList'],
		judge: (scenario) => {
			const validated = validationOf(scenario, 'range');
			const refusalText = validated.error ? validated.error.message : '';
			return { pass: /'range' is not a card field.*rangeOptionSetId \| rangeClassId \| rangeDatatype/.test(refusalText), detail: refusalText ? refusalText.slice(0, 240) : 'REGISTERED' };
		},
	}),
	pureConjunct({
		conjunctId: 'b_rangeOptionSetIdRegisters',
		title: 'a crosswalk declaration mapping rangeOptionSetId registers',
		twinNameList: ['rangeFieldsNotDeclared'],
		judge: (scenario) => {
			const validated = validationOf(scenario, 'rangeOptionSetId');
			return { pass: !validated.error, detail: validated.error ? validated.error.message.slice(0, 240) : 'registered' };
		},
	}),
	runConjunct({
		conjunctId: 'c_crosswalkPromptsByteIdentical',
		title: 'the toy crosswalk run renders byte-identical prompts to before W-B-14 (the dropped range line was never emitted)',
		twinNameList: ['rendererEmitsARangeLine'],
		judge: succeeded((runReport, outcome) => {
			const pairList = forensicsOf(outcome).map((oneEntry) => oneEntry.record).filter((oneRecord) => oneRecord.userPrompt !== undefined).map((oneRecord) => `${oneRecord.promptHash}:${scenarioLib.sha256Hex(oneRecord.userPrompt)}`);
			const digest = scenarioLib.sha256Hex(JSON.stringify(pairList));
			return { pass: digest === CROSSWALK_PROMPT_DIGEST_BEFORE, detail: `${pairList.length} prompt(s); digest ${digest.slice(0, 16)} vs before ${CROSSWALK_PROMPT_DIGEST_BEFORE.slice(0, 16)}` };
		}),
	}),
];
// the pre-W-B-14 contract: 'range' back in the list and no retired-name row (two mutations of one file, so a scenario twin)
scenarioTwin({
	registry: twinRegistry, gateId: 'BG-TUPLERANGE', conjunctId: 'a_rangeRefusedNamingTheCardProperties', twinName: 'rangeBackInTheTupleList', leverKind: 'productionMutation',
	mutate: (scenario) => {
		const modulePath = path.join(scenarioLib.FRAMEWORK_DIR, CONTRACT_FILE);
		scenario.frameworkMutationList.push({ modulePath, find: "const TUPLE_FIELD_LIST = Object.freeze(['canonicalKey', 'domainId', 'propertyKey', ...TUPLE_RANGE_FIELD_LIST, 'valueKey', 'qualifierKeys']);", replace: "const TUPLE_FIELD_LIST = Object.freeze(['canonicalKey', 'domainId', 'propertyKey', 'range', 'valueKey', 'qualifierKeys']);" });
		scenario.frameworkMutationList.push({ modulePath, find: '			if (RETIRED_TUPLE_FIELD_REASON_BY_NAME[oneField] !== undefined) {', replace: '			if (false) {' });
	},
});
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-TUPLERANGE', conjunctId: 'b_rangeOptionSetIdRegisters', twinName: 'rangeFieldsNotDeclared', fileName: CONTRACT_FILE, find: "const TUPLE_FIELD_LIST = Object.freeze(['canonicalKey', 'domainId', 'propertyKey', ...TUPLE_RANGE_FIELD_LIST, 'valueKey', 'qualifierKeys']);", replace: "const TUPLE_FIELD_LIST = Object.freeze(['canonicalKey', 'domainId', 'propertyKey', 'valueKey', 'qualifierKeys']);" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-TUPLERANGE', conjunctId: 'c_crosswalkPromptsByteIdentical', twinName: 'rendererEmitsARangeLine', fileName: RENDERER_FILE, find: 'qualifierKeys: oneCard.qualifierKeys, rangeDatatype: oneCard.rangeDatatype,', replace: "qualifierKeys: oneCard.qualifierKeys, range: oneCard.rangeOptionSetId || oneCard.rangeClassId || oneCard.rangeDatatype || 'none', rangeDatatype: oneCard.rangeDatatype," });

const gateDeclarationList = [{ gateId: 'BG-TUPLERANGE', title: "the tuple filter names the card's range properties", conjunctList }];

runGateFamily(
	{ harness, familyName: 'BG-TUPLERANGE', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 3 },
	() => harness.report(),
);
