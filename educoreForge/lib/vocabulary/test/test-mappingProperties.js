#!/usr/bin/env node
'use strict';

// test-mappingProperties.js — the gate for the MAPPING_PROPERTIES registry as extended by the Bridge
// Framework's B2 vocabulary commit (SPEC-bridgeFramework-v1.md §5.7, §14.4 step 1; RULINGS A7/R7/BF12;
// BR-143; BR-145; C6). This locks:
//   (a) every Bridge-Profile edge property NAME the framework writes is a registry row (the ten B2 rows
//       plus the ten pre-existing ones — the writer's CLOSED SET; a name outside it is refused there);
//   (b) MAPPING_PROPERTY_NAME_LIST is EXACTLY the registry's values (the derived list the writer reads);
//   (c) ⟪lane P, 2026-10-04⟫ a mapping edge carries NO provenanceTier (retired: the row is absent from the closed set, and
//       the two tier tables are gone); its kind is MAPPING_KIND_LIST, EXACTLY inferred and authored — no debug kind (a
//       debug judge is named by mappingSource 'bridge-debug');
//   (d) isValidSssomJustification is GONE (BR-145 RULED: the boolean invited a caller to discard the
//       ban's name) — sssomJustificationRefusal is the only door.
// RED TWINS (observed by the sweep below on every run, three-state): a vocabulary DOUBLE compiled in
// memory (lib/forge-framework/test/testSupport/moduleDouble.js — no file is written) with (a) the
// DECISION_BLOCK_HASH row removed → (a) and (b) red; (c) 'invalid-debug' added to the mapping
// kind list → (c) red; (d) the boolean re-added → (d) red. Pure; no docker/db.
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
     producer-derived provenanceTier table (+ 'invalid-debug'), and the removal of isValidSssomJustification.
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
	'rendererVersion', // was mappingToolVersion (renamed campaign P3, W-B-1)
	'subjectMatchField',
	'objectMatchField',
	'sourceLabel',
	'predicateAssertedBy',
	'attestationChannelList',
	'decisionBlockHash',
];
const PRE_EXISTING_NAME_LIST = [
	'predicate',
	'mappingMethod', // was mappingJustification (renamed campaign P3, W-B-1)
	'subjectSource',
	'subjectVersion',
	'objectSource',
	'objectVersion',
	'judgeIdentity', // was mappingTool (renamed campaign P3, W-B-1)
	'matchId',
];
// the one name lane P RETIRED from mapping edges (TQ, 2026-10-04): it must be ABSENT from the closed set, so the write seam
// refuses it. Pre-existing until then; listed so its absence is asserted, not merely unmentioned.
// ⟪campaign P3, 2026-10-06⟫ and the four the renames and W-B-2 retired: each must be ABSENT too (the seam names their replacements)
const RETIRED_NAME_LIST = ['provenanceTier', 'mappingJustification', 'mappingTool', 'mappingToolVersion', 'confidence'];
// the four names campaign P3 ADDED: the judge's own numbers (W-B-3, G7) and its recorded text (W-B-4, V1-C06)
const P3_ADDED_NAME_LIST = ['judgePickConfidence', 'judgeTopProbability', 'judgeRunnerUpMargin', 'mappingRationale'];
// the one name the SIF replacement's phase V1 ADDED (review #1): the question a fanned-out mapping edge was
// judged as, written on every instance edge by the materialiser (plan phase B4b)
const V1_ADDED_NAME_LIST = ['judgedSubjectStableId'];
// the three names lane P ADDED (mappingProvenance 2026-10-04, TQ's design): what kind of claim, who made it, how sure
const PROVENANCE_ADDED_NAME_LIST = ['mappingConfidence', 'mappingKind', 'mappingSource'];

// the four conjuncts, each a pure judge over a vocabulary module (real or double)
const conjunctJudgeByRefId = {
	'a_everyEdgePropertyNameIsARow': (subject) => {
		const valueList = Object.keys(subject.MAPPING_PROPERTIES).map((oneMember) => subject.MAPPING_PROPERTIES[oneMember]);
		const missing = B2_ADDED_NAME_LIST.concat(PRE_EXISTING_NAME_LIST, V1_ADDED_NAME_LIST, PROVENANCE_ADDED_NAME_LIST, P3_ADDED_NAME_LIST).filter((oneName) => valueList.indexOf(oneName) === -1);
		const retiredPresent = RETIRED_NAME_LIST.filter((oneName) => valueList.indexOf(oneName) !== -1);
		return { pass: missing.length === 0 && retiredPresent.length === 0 && valueList.length === 26, detail: missing.length || retiredPresent.length ? `missing: ${missing.join(', ')}; retired yet present: ${retiredPresent.join(', ')}` : `count ${valueList.length}` };
	},
	'b_nameListEqualsRegistryValues': (subject) => {
		const valueList = Object.keys(subject.MAPPING_PROPERTIES).map((oneMember) => subject.MAPPING_PROPERTIES[oneMember]);
		const equal = JSON.stringify(subject.MAPPING_PROPERTY_NAME_LIST) === JSON.stringify(valueList) && subject.MAPPING_PROPERTY_NAME_LIST.length === 26;
		return { pass: equal, detail: `list ${JSON.stringify(subject.MAPPING_PROPERTY_NAME_LIST)}` };
	},
	// ⟪lane P, 2026-10-04⟫ replaces c_producerDerivedTiersOnly: the tier tables it pinned are retired with provenanceTier's
	// place on mapping edges; what a mapping edge's kind may be is now MAPPING_KIND_LIST, exactly two, with no debug kind
	'c_mappingKindsOnlyNoTierTables': (subject) => ({
		pass:
			JSON.stringify(subject.MAPPING_KIND_LIST) === JSON.stringify(['inferred', 'authored']) &&
			subject.MAPPING_EDGE_PERMITTED_PROVENANCE_TIER_LIST === undefined &&
			subject.MAPPING_EDGE_PROVENANCE_TIER_BY_PRODUCER_KIND === undefined,
		detail: `${JSON.stringify(subject.MAPPING_KIND_LIST)} / tier tables ${typeof subject.MAPPING_EDGE_PERMITTED_PROVENANCE_TIER_LIST}, ${typeof subject.MAPPING_EDGE_PROVENANCE_TIER_BY_PRODUCER_KIND}`,
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
		conjunctRefIdList: ['c_mappingKindsOnlyNoTierTables'],
		twinName: 'debugKindAdded',
		leverKind: 'productionMutation',
		find: "const MAPPING_KIND_LIST = Object.freeze([MAPPING_KIND.INFERRED, MAPPING_KIND.AUTHORED]);",
		replace: "const MAPPING_KIND_LIST = Object.freeze([MAPPING_KIND.INFERRED, MAPPING_KIND.AUTHORED, 'invalid-debug']);",
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
