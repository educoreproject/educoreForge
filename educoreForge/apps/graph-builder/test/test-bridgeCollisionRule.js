#!/usr/bin/env node
'use strict';

// test-bridgeCollisionRule.js — the gate for the PRE-SPEND declaration-tuple refusal
// (SPEC-phase7-optInDiscriminator-082926.md §3.7; invariant I-D's twin). This locks:
//   (a) the Phase 5 FOUR-bridge recipe's declarations do NOT collide — Ed-Fi's two tiers share a pair
//       but differ in producerKind, which is the fact the whole opt-in design rests on;
//   (b) the FIVE-bridge shape with both PESC tiers undeclared IS refused, and the refusal NAMES BOTH
//       plugins and QUOTES the shared tuple — a refusal that does not name the offender leaves a reader
//       exactly where the docketed BG-COMPOSE-SIF (c) defect leaves them;
//   (c) declaring subjectDiscriminator on ONE of them clears the refusal — the remedy the message states
//       actually works, checked rather than asserted;
//   (d) `undefined` (declared nothing) and `null` do NOT compare equal. JSON.stringify renders an
//       undefined array member as `null`, so a naive key would collapse the two; the sentinel is what
//       keeps them apart and this conjunct is the only thing watching it;
//   (e) a describedBridgeList that is not an array is REFUSED BY NAME rather than returning '' — a
//       pre-spend check that cannot run must not read as "no collision" and wave the spend through.
// RED TWINS (observed by the sweep below on every run, three-state — in-memory doubles via
// lib/forge-framework/test/testSupport/moduleDouble.js; no file written): the sentinel replaced by null
// → (d) red; subjectDiscriminator dropped from the tuple term list → (c) red; the duplicate filter
// loosened to length > 2 → (b) red; the non-array guard made to return '' → (e) red. Pure; no docker,
// no database, no network, no build.
//
// Run: node apps/graph-builder/test/test-bridgeCollisionRule.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate for the pre-spend bridge-declaration collision rule (Phase 7 §3.7)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Locks that the four-bridge declarations do not collide, that the undiscriminated five-bridge shape is
     refused naming both plugins, that a declared discriminator clears it, that absent and null stay
     distinct, and that a malformed input is refused rather than read as "no collision". Every conjunct is
     observed RED under an in-memory double. Pure.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const moduleDouble = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));

const RULE_PATH = path.join(__dirname, '..', 'lib', 'bridgeCollisionRule.js');

// The four Phase 5 bridges, exactly as describeBridge reports them (producerKind read from each shipped
// plugin's own declaration; hub/source from recipes/fourWithHubFourBridges.recipe.jsonc).
const FOUR_BRIDGE_DESCRIBED_LIST = [
	{ bridgeName: 'sifCedsStandardPlugin', hub: 'ceds', source: 'sif', producerKind: 'authored', subjectDiscriminator: undefined },
	{ bridgeName: 'edfiCedsCrosswalkPlugin', hub: 'ceds', source: 'edfi', producerKind: 'authored', subjectDiscriminator: undefined },
	{ bridgeName: 'edfiCedsDerivedPlugin', hub: 'ceds', source: 'edfi', producerKind: 'inferred', subjectDiscriminator: undefined },
	{ bridgeName: 'pescCedsDerivedPlugin', hub: 'ceds', source: 'pesc260805', producerKind: 'inferred', subjectDiscriminator: undefined },
];
const OPTION_SET_UNDECLARED = { bridgeName: 'pescOptionSetCedsDerivedPlugin', hub: 'ceds', source: 'pesc260805', producerKind: 'inferred', subjectDiscriminator: undefined };
const OPTION_SET_DECLARED = { ...OPTION_SET_UNDECLARED, subjectDiscriminator: 'optionSet' };

const conjunctJudgeByRefId = {
	a_theFourDoNotCollide: (subject) => {
		const refusal = subject.collisionRefusalFor({ recipeName: 'fourWithHubFourBridges', describedBridgeList: FOUR_BRIDGE_DESCRIBED_LIST });
		return { pass: refusal === '', detail: refusal === '' ? "4 bridges, no shared tuple — Ed-Fi's two differ in producerKind" : refusal };
	},
	b_undiscriminatedFifthIsRefusedNamingBoth: (subject) => {
		const refusal = subject.collisionRefusalFor({ recipeName: 'fourWithHubFiveBridges', describedBridgeList: FOUR_BRIDGE_DESCRIBED_LIST.concat([OPTION_SET_UNDECLARED]) });
		const namesBoth = refusal.indexOf('pescCedsDerivedPlugin') !== -1 && refusal.indexOf('pescOptionSetCedsDerivedPlugin') !== -1;
		const quotesTuple = refusal.indexOf('"ceds","pesc260805","inferred"') !== -1;
		const namesRemedy = refusal.indexOf('subjectDiscriminator') !== -1;
		return { pass: refusal !== '' && namesBoth && quotesTuple && namesRemedy, detail: refusal === '' ? 'NOT REFUSED' : `namesBoth ${namesBoth}, quotesTuple ${quotesTuple}, namesRemedy ${namesRemedy}` };
	},
	c_declaringTheDiscriminatorClearsIt: (subject) => {
		const refusal = subject.collisionRefusalFor({ recipeName: 'fourWithHubFiveBridges', describedBridgeList: FOUR_BRIDGE_DESCRIBED_LIST.concat([OPTION_SET_DECLARED]) });
		return { pass: refusal === '', detail: refusal === '' ? "5 bridges, no shared tuple once one declares 'optionSet'" : refusal };
	},
	d_absentAndNullStayDistinct: (subject) => {
		// two entries identical but for absent-vs-null. They are DIFFERENT declarations and must not collide;
		// a JSON key that renders undefined as null would fuse them and refuse a recipe that is fine.
		const refusal = subject.collisionRefusalFor({
			recipeName: 'probe',
			describedBridgeList: [
				{ bridgeName: 'absentOne', hub: 'ceds', source: 'pesc260805', producerKind: 'inferred', subjectDiscriminator: undefined },
				{ bridgeName: 'nullOne', hub: 'ceds', source: 'pesc260805', producerKind: 'inferred', subjectDiscriminator: null },
			],
		});
		return { pass: refusal === '', detail: refusal === '' ? 'absent and null are distinct keys' : `FUSED: ${refusal}` };
	},
	e_malformedInputRefusedNotWavedThrough: (subject) => {
		// The twin that deletes the guard makes this call THROW rather than return, so the throw is CAUGHT and
		// scored — a throw is neither '' nor a named refusal, so it fails the conjunct exactly as it should.
		// This is the codebase's own twin idiom (test-bgProducer.js:109-113): in a suite, catching a mutated
		// module's throw IS the measurement, not control flow.
		const outcomeList = [undefined, null, 'notAList', { bridgeName: 'x' }, 7].map((oneBad) => {
			let observed = '';
			try {
				observed = subject.collisionRefusalFor({ recipeName: 'probe', describedBridgeList: oneBad });
			} catch (refusalThrow) {
				observed = `THREW: ${refusalThrow.message}`;
			}
			return observed;
		});
		const wavedThrough = outcomeList.filter((oneOutcome) => oneOutcome === '');
		const threwInstead = outcomeList.filter((oneOutcome) => oneOutcome.indexOf('THREW: ') === 0);
		const allNamed = outcomeList.every((oneOutcome) => oneOutcome.indexOf('bridgeCollisionRule') === 0);
		return {
			pass: wavedThrough.length === 0 && threwInstead.length === 0 && allNamed,
			detail: wavedThrough.length
				? `${wavedThrough.length} of 5 malformed inputs read as "no collision"`
				: threwInstead.length
					? `${threwInstead.length} of 5 malformed inputs THREW instead of being refused by name`
					: '5 malformed inputs each refused by module name',
		};
	},
};

// =====================================================================
harness.section('BASELINE — the real rule passes every conjunct');
// =====================================================================
const rule = require('../lib/bridgeCollisionRule');
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId](rule);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});
harness.equal('the tuple is DATA, four terms', JSON.stringify(rule.COLLISION_TUPLE_TERM_LIST), JSON.stringify(['hub', 'source', 'producerKind', 'subjectDiscriminator']));
harness.ok('the absent-term sentinel is unreachable by a valid discriminator (the pattern admits no "<")', rule.ABSENT_TERM_SENTINEL.indexOf('<') !== -1);

// =====================================================================
harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a rule double (in memory)');
// =====================================================================
const twinList = [
	{
		conjunctRefIdList: ['d_absentAndNullStayDistinct'],
		twinName: 'sentinelReplacedByNull',
		leverKind: 'productionMutation',
		find: "const ABSENT_TERM_SENTINEL = '<absent>';",
		replace: 'const ABSENT_TERM_SENTINEL = null;',
	},
	{
		conjunctRefIdList: ['c_declaringTheDiscriminatorClearsIt'],
		twinName: 'discriminatorDroppedFromTheTuple',
		leverKind: 'productionMutation',
		find: "const COLLISION_TUPLE_TERM_LIST = Object.freeze(['hub', 'source', 'producerKind', 'subjectDiscriminator']);",
		replace: "const COLLISION_TUPLE_TERM_LIST = Object.freeze(['hub', 'source', 'producerKind']);",
	},
	{
		conjunctRefIdList: ['b_undiscriminatedFifthIsRefusedNamingBoth'],
		twinName: 'duplicateFilterLoosened',
		leverKind: 'productionMutation',
		find: '\tconst collidingTupleTextList = Object.keys(bridgeNameListByTupleText).filter((oneTupleText) => bridgeNameListByTupleText[oneTupleText].length > 1);',
		replace: '\tconst collidingTupleTextList = Object.keys(bridgeNameListByTupleText).filter((oneTupleText) => bridgeNameListByTupleText[oneTupleText].length > 2);',
	},
	{
		conjunctRefIdList: ['e_malformedInputRefusedNotWavedThrough'],
		twinName: 'malformedInputWavedThrough',
		leverKind: 'productionMutation',
		find: '\tif (!Array.isArray(describedBridgeList)) {',
		replace: '\tif (false) {',
	},
	{
		// (a)'s own twin: fuse producerKind out of the tuple and Ed-Fi's two tiers collide, which is the
		// exact claim (a) makes — that the four are safe BECAUSE crosswalk is authored and derived is inferred.
		conjunctRefIdList: ['a_theFourDoNotCollide'],
		twinName: 'producerKindDroppedFromTheTuple',
		leverKind: 'productionMutation',
		find: "\t\tCOLLISION_TUPLE_TERM_LIST.map((oneTermName) => (oneDescribed[oneTermName] === undefined ? ABSENT_TERM_SENTINEL : oneDescribed[oneTermName])),",
		replace: "\t\tCOLLISION_TUPLE_TERM_LIST.filter((oneTermName) => oneTermName !== 'producerKind').map((oneTermName) => (oneDescribed[oneTermName] === undefined ? ABSENT_TERM_SENTINEL : oneDescribed[oneTermName])),",
	},
];
const observedRedSet = new Set();
twinList.forEach((oneTwin) => {
	moduleDouble.assertMutationApplies({ modulePath: RULE_PATH, find: oneTwin.find });
	const doubled = moduleDouble.loadWithMutations({ modulePath: RULE_PATH, mutationList: [{ modulePath: RULE_PATH, find: oneTwin.find, replace: oneTwin.replace }] });
	oneTwin.conjunctRefIdList.forEach((oneRefId) => {
		const verdict = conjunctJudgeByRefId[oneRefId](doubled);
		harness.ok(`${oneRefId} observed RED under twin '${oneTwin.twinName}' (${oneTwin.leverKind})`, verdict.pass === false, verdict.detail);
		if (verdict.pass === false) {
			observedRedSet.add(oneRefId);
		}
		process.global.xLog.status(`  RED-OBSERVED BRIDGE-COLLISION-RULE/${oneRefId} twin='${oneTwin.twinName}' lever=${oneTwin.leverKind} → ${verdict.pass ? 'PASS (DEFECTIVE)' : 'FAIL'}: ${verdict.detail}`);
	});
});
harness.equal('every conjunct was observed red', observedRedSet.size, Object.keys(conjunctJudgeByRefId).length);
process.global.xLog.status(`  BRIDGE-COLLISION-RULE: ${observedRedSet.size}/${Object.keys(conjunctJudgeByRefId).length} conjuncts observed red, ${twinList.length} twin runs`);

harness.report();
