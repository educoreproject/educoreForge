#!/usr/bin/env node
'use strict';

// test-selfDocFieldContract.js — gate for W-A-5 (V1-C19; campaign P2): the finish walker refuses, by label and field
// name, an emitted ManifestRecipe / RecipeBlock / StandardDefinition / UsagePattern lacking a field graph-contract §5
// declares required — one check at the seam, covering finishers that do not exist yet. Pure: emitResultRefusal is driven
// directly (the real finishers' output is measured on the live R1 graph).
//
// PROVES:
//   (a) a RecipeBlock carrying every required field passes; the same block without schemaBlockRefId is refused naming
//       ':RecipeBlock' and 'schemaBlockRefId'
//   (b) every one of the four labels is covered, by the contract's own lists (a node of each, lacking its first required
//       field, is refused)
//   (c) a node of no self-doc label is not held to any list
// RED TWINS (in memory, loadBuildJsDouble on finishing.js): selfDocCheckRemoved -> (a), (b) red; recipeBlockUncovered
// (the RecipeBlock row dropped from the table) -> (a) red.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: emitted self-doc nodes carry graph-contract §5's required fields
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../../../../test/testLib/harness')(moduleName);

const path = require('path');
const vocabulary = require('../../../../../../../lib/vocabulary/vocabulary');
const { loadBuildJsDouble } = require('../../../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const FINISHING_PATH = path.join(__dirname, '..', 'finishing.js');
const refusalFor = (mutationList) => (mutationList.length === 0 ? require(FINISHING_PATH) : loadBuildJsDouble({ buildJsPath: FINISHING_PATH, mutationList }))({}).emitResultRefusal;

const FIELD_LIST_BY_LABEL = { ManifestRecipe: vocabulary.MANIFEST_RECIPE_FIELD_LIST, RecipeBlock: vocabulary.RECIPE_BLOCK_FIELD_LIST, StandardDefinition: vocabulary.STANDARD_DEFINITION_FIELD_LIST, UsagePattern: vocabulary.USAGE_PATTERN_FIELD_LIST };
const SAMPLE_BY_TYPE = { string: 'x', integer: 1, boolean: true, stringList: ['x'], jsonString: '{}' };
const nodeOf = (oneLabel, omittedName) => {
	const properties = FIELD_LIST_BY_LABEL[oneLabel].filter((oneRow) => oneRow.required && oneRow.name !== omittedName).reduce((soFar, oneRow) => ({ ...soFar, [oneRow.name]: SAMPLE_BY_TYPE[oneRow.type] }), {});
	return { stableId: `toy:${oneLabel}`, ref: { source: null, id: `toy:${oneLabel}` }, labels: ['ForgedNode', oneLabel], properties };
};

const conjunctJudgeByRefId = {
	a_recipeBlockWithoutItsAddressRefused: (mutationList) => {
		const emitResultRefusal = refusalFor(mutationList);
		const whole = emitResultRefusal('toy', { nodes: [nodeOf('RecipeBlock')], edges: [] });
		const lacking = emitResultRefusal('toy', { nodes: [nodeOf('RecipeBlock', 'schemaBlockRefId')], edges: [] });
		return { pass: whole === '' && /a :RecipeBlock lacks the required field 'schemaBlockRefId'/.test(lacking), detail: `whole: ${whole || "''"} | lacking: ${lacking.slice(0, 160) || "''"}` };
	},
	b_everySelfDocLabelCovered: (mutationList) => {
		const emitResultRefusal = refusalFor(mutationList);
		const uncoveredList = Object.keys(FIELD_LIST_BY_LABEL).filter((oneLabel) => {
			const firstRequiredName = FIELD_LIST_BY_LABEL[oneLabel].find((oneRow) => oneRow.required).name;
			return emitResultRefusal('toy', { nodes: [nodeOf(oneLabel, firstRequiredName)], edges: [] }).indexOf(`'${firstRequiredName}'`) === -1;
		});
		return { pass: uncoveredList.length === 0, detail: uncoveredList.length ? `uncovered: ${uncoveredList.join(', ')}` : 'all four labels refused when lacking a required field' };
	},
	c_otherLabelsNotHeld: (mutationList) => {
		const verdict = refusalFor(mutationList)('toy', { nodes: [{ stableId: 'toy:schema', ref: { source: null, id: 'toy:schema' }, labels: ['ForgedNode', 'SchemaView'], properties: {} }], edges: [] });
		return { pass: verdict === '', detail: verdict || "''" };
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'a_recipeBlockWithoutItsAddressRefused', twinName: 'recipeBlockUncovered', find: '			[vocabulary.SELF_DOC.NODE_LABELS.RECIPE_BLOCK]: vocabulary.RECIPE_BLOCK_FIELD_LIST,\n', replace: '' },
	{ conjunctRefId: 'b_everySelfDocLabelCovered', twinName: 'selfDocCheckRemoved', find: '.forEach((oneRow) => faultList.push(`${nodeLabel}: a :${oneLabel} lacks', replace: '.forEach((oneRow) => void (`${nodeLabel}: a :${oneLabel} lacks' },
];

harness.section('BASELINE — the real walker passes every conjunct');
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId]([]);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});
harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a walker double (in memory)');
TWIN_LIST.forEach((oneTwin) => {
	const verdict = conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }]);
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
});
harness.report();
