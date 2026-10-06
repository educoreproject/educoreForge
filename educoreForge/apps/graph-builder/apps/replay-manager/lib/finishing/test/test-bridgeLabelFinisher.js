#!/usr/bin/env node
'use strict';

// test-bridgeLabelFinisher.js — gate for W-B-13 (V1-C29; campaign P2): the bridge pair-scoped labels are declared
// (graph-contract BRIDGE_PAIR_LABEL_PREFIX / _PATTERN_SOURCE / pairScopedLabelFor) and the finish strips them, refusing
// by name any label that carries the prefix outside the grammar. Pure: a toy label store answers the finisher's Cypher.
//
// PROVES:
//   (a) a toy graph with BridgedRelation_TOY_TOYHUB on 3 nodes and BridgedRelation_A_B on 12,000 (two batches) ends with
//       NO pair label, and the summary counts 12,003 occurrences of 2 labels
//   (b) a label 'BridgedRelation-x' is REFUSED by name and nothing is removed
//   (c) the registry runs 'bridgeLabel' FIRST, as an applier, before schemaView
//   (d) THE PRODUCER'S GRAMMAR, as written today (bridge-framework.js composes the label itself until P3 moves it onto
//       pairScopedLabelFor): its template is found verbatim, and for the nine gold pairs it yields what pairScopedLabelFor
//       yields, and every result matches the declared pattern
// RED TWINS (in memory): grammarCheckRemoved (finisher) -> (b); batchLoopStopsAfterOne (finisher) -> (a);
// registryOrderSwapped (finishing.js) -> (c); and (d)'s grammar twin: a hub token with a hyphen is refused by pairScopedLabelFor.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: bridge pair labels are declared and stripped at finish
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const vocabulary = require('../../../../../../../lib/vocabulary/vocabulary');
const { loadBuildJsDouble } = require('../../../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const FINISHER_PATH = path.join(__dirname, '..', 'lib', 'bridge-label-finisher.js');
const FINISHING_PATH = path.join(__dirname, '..', 'finishing.js');
const BRIDGE_FRAMEWORK_PATH = path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'lib', 'bridge-framework', 'bridge-framework.js');
const doubleOrReal = (modulePath, mutationList) => (mutationList.length === 0 ? require(modulePath) : loadBuildJsDouble({ buildJsPath: modulePath, mutationList }));

// toyLabelStore — label -> node count; answers the census and the batched REMOVE the way Neo4j would
const toyLabelStoreWith = (countByLabel) => {
	const remainingByLabel = { ...countByLabel };
	const runCypher = ({ cypher }, callback) => {
		const record = (fieldValueByName) => ({ get: (fieldName) => fieldValueByName[fieldName] });
		if (/CALL db\.labels\(\)/.test(cypher)) {
			callback('', { records: Object.keys(remainingByLabel).filter((oneLabel) => remainingByLabel[oneLabel] > 0 && oneLabel.startsWith('BridgedRelation')).sort().map((oneLabel) => record({ label: oneLabel })) });
			return;
		}
		const removeMatch = /MATCH \(n:`([^`]+)`\) WITH n LIMIT (\d+) REMOVE/.exec(cypher);
		if (removeMatch) {
			const removedCount = Math.min(remainingByLabel[removeMatch[1]] || 0, Number(removeMatch[2]));
			remainingByLabel[removeMatch[1]] = (remainingByLabel[removeMatch[1]] || 0) - removedCount;
			callback('', { records: [record({ removedCount })] });
			return;
		}
		callback(`unexpected statement: ${cypher.slice(0, 60)}`);
	};
	return { runCypher, remainingByLabel };
};
const GOLD_PAIR_LIST = ['edfi', 'sif260928', 'pesccollegetranscript1v8v0', 'peschighschooltranscript1v6v0', 'pesctestscorereport1v1v0', 'pesclearningrecord1v0v0', 'pescdocumentrequest1v0v0', 'pescdocumentresponse1v0v0', 'pescacademiceportfolio1v0v0'].map((sourceToken) => ({ sourceToken, hubToken: 'ceds' }));
// ⟪campaign P3, W-B-13 bridge half⟫ the producer now CALLS the declared composer; the restated template below is checked
// against it (gold pairs), and the call is what the source must contain
const PRODUCER_TEMPLATE_TEXT = 'const pairScopedLabel = vocabularyLib.pairScopedLabelFor({ sourceToken, hubToken });';

const conjunctJudgeByRefId = {
	a_everyPairLabelStripped: (mutationList, done) => {
		const store = toyLabelStoreWith({ BridgedRelation_TOY_TOYHUB: 3, BridgedRelation_A_B: 12000, StandardBase: 50 });
		doubleOrReal(FINISHER_PATH, mutationList)({ vocabulary }).apply({ runCypher: store.runCypher }, (err, result) => {
			const leftList = Object.keys(store.remainingByLabel).filter((oneLabel) => oneLabel.startsWith('BridgedRelation') && store.remainingByLabel[oneLabel] > 0);
			done({ pass: !err && leftList.length === 0 && result.removedOccurrenceCount === 12003 && result.removedLabelList.length === 2 && store.remainingByLabel.StandardBase === 50, detail: err || `${result.summary}; left [${leftList.join(', ')}]` });
		});
	},
	b_malformedPairLabelRefused: (mutationList, done) => {
		const store = toyLabelStoreWith({ 'BridgedRelation-x': 2, BridgedRelation_A_B: 4 });
		doubleOrReal(FINISHER_PATH, mutationList)({ vocabulary }).apply({ runCypher: store.runCypher }, (err) =>
			done({ pass: /REFUSED: label\(s\) 'BridgedRelation-x' start with 'BridgedRelation' but do not match/.test(String(err)) && store.remainingByLabel.BridgedRelation_A_B === 4, detail: String(err || 'stripped without refusing') }));
	},
	c_registryRunsItFirst: (mutationList, done) => {
		const registry = doubleOrReal(FINISHING_PATH, mutationList)({}).REGISTRY;
		done({ pass: registry[0].name === 'bridgeLabel' && registry[0].mode === 'apply' && registry[1].name === 'schemaView', detail: registry.map((oneRow) => oneRow.name).join(', ') });
	},
	d_producerGrammarAgrees: (mutationList, done) => {
		const producerSourceText = fs.readFileSync(BRIDGE_FRAMEWORK_PATH, 'utf8');
		const producerTemplate = (applyLabel, sourceToken, hubToken) => `${applyLabel}_${sourceToken.toUpperCase()}_${hubToken.toUpperCase()}`; // the line found below, restated
		const pattern = new RegExp(vocabulary.BRIDGE_PAIR_LABEL_PATTERN_SOURCE);
		const disagreeList = GOLD_PAIR_LIST.filter((onePair) => {
			const produced = producerTemplate(vocabulary.BRIDGE_PAIR_LABEL_PREFIX, onePair.sourceToken, onePair.hubToken);
			return produced !== vocabulary.pairScopedLabelFor(onePair) || !pattern.test(produced);
		});
		let hyphenRefusal = '';
		try {
			vocabulary.pairScopedLabelFor({ sourceToken: 'edfi', hubToken: 'ce-ds' });
		} catch (grammarError) {
			hyphenRefusal = grammarError.message;
		}
		done({ pass: producerSourceText.indexOf(PRODUCER_TEMPLATE_TEXT) !== -1 && disagreeList.length === 0 && /does not match the declared grammar/.test(hyphenRefusal), detail: `template found ${producerSourceText.indexOf(PRODUCER_TEMPLATE_TEXT) !== -1}; disagree [${disagreeList.map((onePair) => onePair.sourceToken).join(', ')}]; hyphen ${hyphenRefusal ? 'refused' : 'ADMITTED'}` });
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'a_everyPairLabelStripped', twinName: 'batchLoopStopsAfterOne', find: '					removeNextBatch(runningTotal + removedCount);', replace: "					callback('', runningTotal + removedCount);" },
	{ conjunctRefId: 'b_malformedPairLabelRefused', twinName: 'grammarCheckRemoved', find: '					if (malformedList.length) {', replace: '					if (false) {' },
	{ conjunctRefId: 'c_registryRunsItFirst', twinName: 'registryOrderSwapped', find: "				name: 'bridgeLabel',\n				mode: MODE_APPLY,", replace: "				name: 'bridgeLabelMoved',\n				mode: MODE_APPLY," },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
harness.section('BASELINE — the real modules pass every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a module double (in memory)');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) =>
				conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }], (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
					stepDone();
				})),
			() => harness.report(),
		);
	},
);
