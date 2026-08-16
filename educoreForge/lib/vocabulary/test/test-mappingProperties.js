#!/usr/bin/env node
'use strict';

// test-mappingProperties.js — the gate for the MAPPING_PROPERTIES registry as extended by the Bridge
// Framework's B2 vocabulary commit (SPEC-bridgeFramework-v1.md §5.7, §14.4 step 1; RULINGS A7/R7/BF12;
// BR-143; BR-145; C6). This locks:
//   (a) every Bridge-Profile edge property NAME the framework writes is a registry row (the ten B2 rows
//       plus the ten pre-existing ones — the writer's CLOSED SET; a name outside it is refused there);
//   (b) MAPPING_PROPERTY_NAME_LIST is EXACTLY the registry's values (the derived list the writer reads);
//   (c) the ONE provenanceTier a mapping edge may carry is 'invalid-debug' (Profile v1.0.5 §4.6 carve-out)
//       — the tier is otherwise RETIRED from mapping edges (C6);
//   (d) isValidSssomJustification is GONE (BR-145 RULED: the boolean invited a caller to discard the
//       ban's name) — sssomJustificationRefusal is the only door.
// RED TWINS (observed by the sweep below on every run, three-state): a vocabulary DOUBLE compiled in
// memory (lib/forge-framework/test/testSupport/moduleDouble.js — no file is written) with (a) the
// DECISION_BLOCK_HASH row removed → (a) and (b) red; (c) 'spec-authoritative' added to the permitted
// tier list → (c) red; (d) the boolean re-added → (d) red. Pure; no docker/db.
//
// Run: node lib/vocabulary/test/test-mappingProperties.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate for the MAPPING_PROPERTIES closed set (Bridge Framework B2 vocabulary commit)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Locks the ten B2 mapping-edge property names, the derived MAPPING_PROPERTY_NAME_LIST, the
     'invalid-debug'-only provenanceTier carve-out, and the removal of isValidSssomJustification.
     Every conjunct is observed RED under an in-memory vocabulary double. Pure.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const vocabulary = require('../vocabulary');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));

const VOCABULARY_PATH = path.join(__dirname, '..', 'vocabulary.js');

// the ten names the B2 commit ADDED (SPEC §14.4 step 1) and the ten that were already there
const B2_ADDED_NAME_LIST = [
	'matchBasis',
	'resolution',
	'mappingProvider',
	'mappingToolVersion',
	'subjectMatchField',
	'objectMatchField',
	'sourceLabel',
	'predicateAssertedBy',
	'attestationChannelList',
	'decisionBlockHash',
];
const PRE_EXISTING_NAME_LIST = [
	'predicate',
	'confidence',
	'mappingJustification',
	'subjectSource',
	'subjectVersion',
	'objectSource',
	'objectVersion',
	'mappingTool',
	'matchId',
	'provenanceTier',
];

// the four conjuncts, each a pure judge over a vocabulary module (real or double)
const conjunctJudgeByRefId = {
	'a_everyEdgePropertyNameIsARow': (subject) => {
		const valueList = Object.keys(subject.MAPPING_PROPERTIES).map((oneMember) => subject.MAPPING_PROPERTIES[oneMember]);
		const missing = B2_ADDED_NAME_LIST.concat(PRE_EXISTING_NAME_LIST).filter((oneName) => valueList.indexOf(oneName) === -1);
		return { pass: missing.length === 0 && valueList.length === 20, detail: missing.length ? `missing: ${missing.join(', ')}` : `count ${valueList.length}` };
	},
	'b_nameListEqualsRegistryValues': (subject) => {
		const valueList = Object.keys(subject.MAPPING_PROPERTIES).map((oneMember) => subject.MAPPING_PROPERTIES[oneMember]);
		const equal = JSON.stringify(subject.MAPPING_PROPERTY_NAME_LIST) === JSON.stringify(valueList) && subject.MAPPING_PROPERTY_NAME_LIST.length === 20;
		return { pass: equal, detail: `list ${JSON.stringify(subject.MAPPING_PROPERTY_NAME_LIST)}` };
	},
	'c_onlyInvalidDebugTierPermitted': (subject) => ({
		pass: JSON.stringify(subject.MAPPING_EDGE_PERMITTED_PROVENANCE_TIER_LIST) === JSON.stringify(['invalid-debug']),
		detail: JSON.stringify(subject.MAPPING_EDGE_PERMITTED_PROVENANCE_TIER_LIST),
	}),
	'd_booleanJustificationGateRemoved': (subject) => ({
		pass: subject.isValidSssomJustification === undefined && typeof subject.sssomJustificationRefusal === 'function',
		detail: `isValidSssomJustification is ${typeof subject.isValidSssomJustification}`,
	}),
};

// =====================================================================
harness.section('BASELINE — the real vocabulary passes every conjunct');
// =====================================================================
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId](vocabulary);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});
harness.ok('MAPPING_PROPERTIES is frozen', Object.isFrozen(vocabulary.MAPPING_PROPERTIES));
harness.ok('MAPPING_PROPERTY_NAME_LIST is frozen', Object.isFrozen(vocabulary.MAPPING_PROPERTY_NAME_LIST));

// =====================================================================
harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a vocabulary double (in memory)');
// =====================================================================
const twinList = [
	{
		conjunctRefIdList: ['a_everyEdgePropertyNameIsARow', 'b_nameListEqualsRegistryValues'],
		twinName: 'dropDecisionBlockHashRow',
		leverKind: 'productionMutation',
		find: "\tDECISION_BLOCK_HASH: 'decisionBlockHash',\n",
		replace: '',
	},
	{
		conjunctRefIdList: ['c_onlyInvalidDebugTierPermitted'],
		twinName: 'permitSpecAuthoritativeTier',
		leverKind: 'productionMutation',
		find: 'const MAPPING_EDGE_PERMITTED_PROVENANCE_TIER_LIST = Object.freeze([PROVENANCE_TIER.INVALID_DEBUG]);',
		replace: 'const MAPPING_EDGE_PERMITTED_PROVENANCE_TIER_LIST = Object.freeze([PROVENANCE_TIER.INVALID_DEBUG, PROVENANCE_TIER.SPEC_AUTHORITATIVE]);',
	},
	{
		conjunctRefIdList: ['d_booleanJustificationGateRemoved'],
		twinName: 'reAddBooleanJustificationGate',
		leverKind: 'productionMutation',
		find: '\tsssomJustificationRefusal,\n\tMAPPING_PROPERTIES,\n',
		replace: "\tsssomJustificationRefusal,\n\tisValidSssomJustification: (oneJustification) => sssomJustificationRefusal(oneJustification) === '',\n\tMAPPING_PROPERTIES,\n",
	},
];
const observedRedSet = new Set();
twinList.forEach((oneTwin) => {
	moduleDouble.assertMutationApplies({ modulePath: VOCABULARY_PATH, find: oneTwin.find });
	const doubled = moduleDouble.loadWithMutations({ modulePath: VOCABULARY_PATH, mutationList: [{ modulePath: VOCABULARY_PATH, find: oneTwin.find, replace: oneTwin.replace }] });
	oneTwin.conjunctRefIdList.forEach((oneRefId) => {
		const verdict = conjunctJudgeByRefId[oneRefId](doubled);
		harness.ok(`${oneRefId} observed RED under twin '${oneTwin.twinName}' (${oneTwin.leverKind})`, verdict.pass === false, verdict.detail);
		if (verdict.pass === false) {
			observedRedSet.add(oneRefId);
		}
		process.global.xLog.status(`  RED-OBSERVED MAPPING-PROPERTIES/${oneRefId} twin='${oneTwin.twinName}' lever=${oneTwin.leverKind} → ${verdict.pass ? 'PASS (DEFECTIVE)' : 'FAIL'}: ${verdict.detail}`);
	});
});
harness.equal('every conjunct was observed red', observedRedSet.size, Object.keys(conjunctJudgeByRefId).length);

harness.report();
