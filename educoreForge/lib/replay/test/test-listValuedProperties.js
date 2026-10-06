#!/usr/bin/env node
'use strict';

// test-listValuedProperties.js — gate for W-A-1 (V1-C01, PLAN G10; campaign P2): the replay engine keeps a property the
// graph contract declares list-valued (graph-contract §1, LIST_VALUED_PROPERTY_NAME_LIST) as a LIST at any length, and
// still collapses every other one-element PG-JSON array to its scalar.
//
// PROVES:
//   (a) every declared name: pgToStored({ [name]: ['x'] })[name] deep-equals ['x'] (a list of one survives)
//   (b) an undeclared name: pgToStored({ role: ['DmeProperty'] }).role === 'DmeProperty' (the wrapped-scalar rule holds)
//   (c) a multi-element list is a list whether declared or not
//   (d) THE NAME RULE: every property name of the frozen gold census that ends in 'List' or 'Keys' is declared
//       list-valued or named in LIST_NAME_RULE_EXEMPTION_BY_NAME (a JSON string or a literal by declaration)
// RED TWINS (in memory, loadBuildJsDouble on replay-engine.js; the file on disk is never touched):
//   keepAsListIgnored — the registry lookup forced false -> (a) red
//   collapseEverything — the collapse no longer reads keepAsList -> (a) red
// and the registry twin for (d): the rule run over the registry with 'propertyNameList' removed -> red.
//
// Run: node lib/replay/test/test-listValuedProperties.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate: declared list-valued properties stay lists at any length through replay

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const { loadBuildJsDouble } = require('../../bridge-framework/test/testSupport/bridgeTwinFactories');
const { LIST_VALUED_PROPERTY_NAME_LIST, LIST_NAME_RULE_EXEMPTION_BY_NAME } = require('../../vocabulary/vocabulary');
const censusFixture = require('./fixtures/liveCensus/goldEval261005PropertyNameList.json');

const ENGINE_PATH = path.join(__dirname, '..', 'replay-engine.js');
const engineFor = (mutationList) => (mutationList.length === 0 ? require(ENGINE_PATH) : loadBuildJsDouble({ buildJsPath: ENGINE_PATH, mutationList }))();

const nameRuleOffenderListOf = (registeredNameList) =>
	censusFixture.propertyNameList.filter(
		(onePropertyName) => /(List|Keys)$/.test(onePropertyName) && registeredNameList.indexOf(onePropertyName) === -1 && !LIST_NAME_RULE_EXEMPTION_BY_NAME[onePropertyName],
	);

const conjunctJudgeByRefId = {
	a_declaredListOfOneStaysAList: (mutationList) => {
		const { pgToStored } = engineFor(mutationList);
		const collapsedNameList = LIST_VALUED_PROPERTY_NAME_LIST.filter((oneName) => JSON.stringify(pgToStored({ [oneName]: ['x'] })[oneName]) !== '["x"]');
		return { pass: collapsedNameList.length === 0, detail: collapsedNameList.length ? `collapsed: ${collapsedNameList.join(', ')}` : `${LIST_VALUED_PROPERTY_NAME_LIST.length} declared name(s) kept as lists of one` };
	},
	b_undeclaredListOfOneCollapses: (mutationList) => {
		const stored = engineFor(mutationList).pgToStored({ role: ['DmeProperty'], name: ['BirthDate'] });
		return { pass: stored.role === 'DmeProperty' && stored.name === 'BirthDate', detail: JSON.stringify(stored) };
	},
	c_multiElementListIsAList: (mutationList) => {
		const stored = engineFor(mutationList).pgToStored({ propertyNameList: ['a', 'b'], someUndeclaredList: ['c', 'd'] });
		return { pass: JSON.stringify(stored) === '{"propertyNameList":["a","b"],"someUndeclaredList":["c","d"]}', detail: JSON.stringify(stored) };
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_declaredListOfOneStaysAList', twinName: 'keepAsListIgnored', find: 'const keepAsList = LIST_VALUED_PROPERTY_NAME_SET.has(onePropertyName);', replace: 'const keepAsList = false;' },
	{ conjunctRefId: 'a_declaredListOfOneStaysAList', twinName: 'collapseEverything', find: 'oneValue.length === 1 && !keepAsList ? oneValue[0]', replace: 'oneValue.length === 1 ? oneValue[0]' },
];

harness.section('BASELINE — the real engine passes every conjunct');
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId]([]);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});

harness.section('(d) THE NAME RULE over the frozen gold census');
const offenderList = nameRuleOffenderListOf(LIST_VALUED_PROPERTY_NAME_LIST);
harness.ok('every List/Keys name of the census is declared list-valued or exempted by name', offenderList.length === 0, offenderList.join(', '));
const twinOffenderList = nameRuleOffenderListOf(LIST_VALUED_PROPERTY_NAME_LIST.filter((oneName) => oneName !== 'propertyNameList'));
harness.ok("(d) observed RED with 'propertyNameList' removed from the registry", twinOffenderList.indexOf('propertyNameList') !== -1, twinOffenderList.join(', '));
harness.note(`RED-OBSERVED d_nameRule twin='registryWithoutPropertyNameList' → offenders [${twinOffenderList.join(', ')}]`);

harness.section('THE TWIN SWEEP — each twin OBSERVED RED under an engine double (in memory)');
TWIN_LIST.forEach((oneTwin) => {
	const verdict = conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }]);
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
});

harness.report();
