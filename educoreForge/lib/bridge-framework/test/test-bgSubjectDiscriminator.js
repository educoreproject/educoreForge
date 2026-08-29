#!/usr/bin/env node
'use strict';

// test-bgSubjectDiscriminator.js — the gate for the OPT-IN subjectDiscriminator DECLARATION
// (SPEC-phase7-optInDiscriminator-082926.md §3.2, invariant I-G; finding [C1]). This locks:
//   (a) I-G' — all FIVE shipped plugins register UNCHANGED: FOUR with subjectDiscriminator undeclared and
//       ONE (pescOptionSetCedsDerivedPlugin) declaring 'optionSet'. The header used to say "all five …
//       undeclared", which described the state BEFORE this phase's one kit line landed; the conjunct body
//       has always asserted the split, so the header was the stale half. It is the whole
//       backward-compatibility claim at the declaration layer, and it is the conjunct
//       that would have gone red had the row been written `required: false`: CODE FACT, the declaration
//       walk reads presentIff / basisConditional / optional and has NEVER read `required`, so a
//       `required: false` row falls through to "missing required key" and becomes MANDATORY;
//   (b) a DECLARED, well-formed discriminator is accepted;
//   (c) a malformed one is REFUSED BY NAME — the refusal names the property AND quotes the offending
//       value, for every malformed shape including '' and null, which are values and not absences;
//   (d) THE INVARIANT THE NEW MODE MUST NOT DISTURB — a row WITHOUT `optional` still refuses on absence.
//       The walk's existing behaviour is the thing under test here, not a side effect of the new branch;
//   (e) `optional` skips the kind check ONLY for `undefined`. A row that is present but malformed is
//       still checked, so the optional mode is a presence rule and never a validation escape.
// RED TWINS (observed by the sweep below on every run, three-state — in-memory doubles via
// lib/forge-framework/test/testSupport/moduleDouble.js; no file written): the optional branch deleted
// → (a) and (b) red, every shipped plugin refused; the kind checker neutered → (c) and (e) red; an
// existing REQUIRED row marked optional → (d) red. Pure; no docker, no database, no network.
//
// Run: node lib/bridge-framework/test/test-bgSubjectDiscriminator.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate for the opt-in subjectDiscriminator declaration row and the plain-optional walk mode
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Locks that all five shipped plugins register unchanged, that a declared discriminator is accepted,
     that a malformed one is refused by name, that a non-optional row still refuses on absence, and that
     the optional mode skips only absence. Every conjunct is observed RED under an in-memory double. Pure.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));

const CONTRACT_PATH = path.join(__dirname, '..', 'bridgePluginContract.js');
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');

// the five shipped plugins, with the bundle directory the contract resolves document channels against
const SHIPPED_PLUGIN_LIST = [
	{ bridgeName: 'sifCedsStandardPlugin', bundleDirName: 'sif', pluginPath: 'forges/sif/bridges/sifCedsStandardPlugin.js' },
	{ bridgeName: 'edfiCedsCrosswalkPlugin', bundleDirName: 'edfi', pluginPath: 'forges/edfi/bridges/edfiCedsCrosswalkPlugin.js' },
	{ bridgeName: 'edfiCedsDerivedPlugin', bundleDirName: 'edfi', pluginPath: 'forges/edfi/bridges/edfiCedsDerivedPlugin.js' },
	{ bridgeName: 'pescCedsDerivedPlugin', bundleDirName: 'pesc260805', pluginPath: 'forges/pesc260805/bridges/pescCedsDerivedPlugin.js' },
	{ bridgeName: 'pescOptionSetCedsDerivedPlugin', bundleDirName: 'pesc260805', pluginPath: 'forges/pesc260805/bridges/pescOptionSetCedsDerivedPlugin.js' },
];

// The mutation fixture: a real shipped declaration, cloned so a test never edits a shipped object.
const clonedDeclarationFor = (onePlugin, overrideByName) => {
	const shipped = require(path.join(TREE_ROOT, onePlugin.pluginPath)).bridgeDeclaration;
	const cloned = { ...shipped, ...overrideByName };
	Object.keys(overrideByName || {}).forEach((oneName) => {
		if (overrideByName[oneName] === '__DELETE__') {
			delete cloned[oneName];
		}
	});
	return cloned;
};

const MALFORMED_DISCRIMINATOR_LIST = [
	{ value: 'Bad', why: 'upper-case initial' },
	{ value: '', why: 'empty string is a malformed VALUE, not an absent key' },
	{ value: 'a~b', why: 'carries the separator itself' },
	{ value: 'a'.repeat(33), why: '33 characters, one past the 32 the pattern admits' },
	{ value: null, why: 'null is a value, not an absence' },
	{ value: 7, why: 'not a string' },
	{ value: ['optionSet'], why: 'not a string' },
];

const validateWith = (subject, onePlugin, overrideByName) =>
	subject.validateBridgeDeclaration({
		bridgeDeclaration: clonedDeclarationFor(onePlugin, overrideByName),
		bundleDirPath: path.join(FORGES_DIR_PATH, onePlugin.bundleDirName),
	});

const optionSetPlugin = SHIPPED_PLUGIN_LIST[4];
// The property-tier sibling declares NO discriminator and is the fixture for every ABSENCE case. Using the
// option-set plugin for those was correct until the kit change of this same phase gave it a declaration —
// at which point "absent" quietly stopped being absent and the [C1] twin stopped being able to go red. The
// gate caught it; the fixture is now chosen for the property it needs rather than for convenience.
const undeclaredPlugin = SHIPPED_PLUGIN_LIST[3];

const conjunctJudgeByRefId = {
	// FOUR declare nothing and ONE declares 'optionSet' — the state after this phase's single kit edit, and
	// the conjunct asserts BOTH halves rather than the pre-kit "all five undeclared", which stopped being
	// true the moment the declaration line landed. Asserting the split is what keeps the claim honest: if a
	// future edit gave a second plugin a discriminator, this goes red and someone has to say why.
	a_allFiveShippedPluginsRegisterUnchanged: (subject) => {
		const refused = SHIPPED_PLUGIN_LIST.filter((onePlugin) => validateWith(subject, onePlugin, {}).error !== undefined);
		const declaringList = SHIPPED_PLUGIN_LIST.filter((onePlugin) => require(path.join(TREE_ROOT, onePlugin.pluginPath)).bridgeDeclaration.subjectDiscriminator !== undefined);
		const splitIsRight = declaringList.length === 1 && declaringList[0].bridgeName === 'pescOptionSetCedsDerivedPlugin';
		return {
			pass: refused.length === 0 && splitIsRight,
			detail: refused.length
				? refused.map((onePlugin) => `${onePlugin.bridgeName}: ${validateWith(subject, onePlugin, {}).error.message}`).join(' | ')
				: `${SHIPPED_PLUGIN_LIST.length} shipped plugins accepted; exactly ${declaringList.length} declares a discriminator (${declaringList.map((onePlugin) => onePlugin.bridgeName).join(', ') || 'none'})`,
		};
	},
	b_declaredDiscriminatorAccepted: (subject) => {
		const verdict = validateWith(subject, optionSetPlugin, { subjectDiscriminator: 'optionSet' });
		return { pass: verdict.error === undefined, detail: verdict.error ? verdict.error.message : "accepted 'optionSet'" };
	},
	c_malformedRefusedByName: (subject) => {
		const notRefused = MALFORMED_DISCRIMINATOR_LIST.filter((oneCase) => {
			const verdict = validateWith(subject, optionSetPlugin, { subjectDiscriminator: oneCase.value });
			return verdict.error === undefined ||
				verdict.error.message.indexOf('subjectDiscriminator') === -1 ||
				verdict.error.message.indexOf(JSON.stringify(oneCase.value)) === -1;
		});
		return {
			pass: notRefused.length === 0,
			detail: notRefused.length
				? `not refused by name: ${notRefused.map((oneCase) => `${JSON.stringify(oneCase.value)} (${oneCase.why})`).join(', ')}`
				: `${MALFORMED_DISCRIMINATOR_LIST.length} malformed values refused, each naming the property and quoting the value`,
		};
	},
	// THE INVARIANT, NOT A SIDE EFFECT. bridgeName carries no `optional`, so deleting it must still reach
	// the fallthrough and be refused as a missing required key. If the new branch ever widened to cover
	// rows it was not meant to, this is what would notice.
	d_nonOptionalRowStillRefusesOnAbsence: (subject) => {
		const verdict = validateWith(subject, undeclaredPlugin, { bridgeName: '__DELETE__' });
		return {
			pass: verdict.error !== undefined && verdict.error.message.indexOf("missing required key 'bridgeName'") !== -1,
			detail: verdict.error ? verdict.error.message.slice(0, 160) : 'ACCEPTED a declaration with bridgeName absent',
		};
	},
	// `optional` is a PRESENCE rule, never a validation escape: a present-but-malformed value is still
	// kind-checked. This is the difference between "may be absent" and "is never checked".
	e_optionalSkipsAbsenceNotValidation: (subject) => {
		// GENUINE absence: the property-tier sibling declares none. Passing {} to the option-set plugin would
		// hand back its own shipped 'optionSet' and test nothing about absence at all.
		const absent = validateWith(subject, undeclaredPlugin, {});
		const presentMalformed = validateWith(subject, undeclaredPlugin, { subjectDiscriminator: 'Bad' });
		return {
			pass: absent.error === undefined && presentMalformed.error !== undefined,
			detail: `absent → ${absent.error ? 'REFUSED' : 'accepted'}; present-malformed → ${presentMalformed.error ? 'REFUSED' : 'ACCEPTED (defective)'}`,
		};
	},
};

// =====================================================================
harness.section('BASELINE — the real contract passes every conjunct');
// =====================================================================
const contract = require('../bridgePluginContract');
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId](contract);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});
harness.equal('the row declares the plain-optional presence mode', JSON.stringify(contract.BRIDGE_DECLARATION_CONTRACT.subjectDiscriminator), JSON.stringify({ optional: true, kind: 'subjectDiscriminator' }));
harness.equal('RUN_REPORT_RESULT_KEYS is UNCHANGED at 13 (BG-NOSUB (i) pins this number)', contract.RUN_REPORT_RESULT_KEYS.length, 13);
harness.ok('subjectDiscriminator is NOT a RUN_REPORT_RESULT_KEYS member', contract.RUN_REPORT_RESULT_KEYS.indexOf('subjectDiscriminator') === -1);

// =====================================================================
harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a contract double (in memory)');
// =====================================================================
const twinList = [
	{
		// [C1] MADE VISIBLE. Delete the plain-optional branch and the row falls through to the fallthrough
		// refusal, which is EXACTLY what a `required: false` row would have done: every shipped plugin is
		// refused for not declaring a key none of them declares.
		conjunctRefIdList: ['a_allFiveShippedPluginsRegisterUnchanged', 'e_optionalSkipsAbsenceNotValidation'],
		twinName: 'plainOptionalBranchDeleted',
		leverKind: 'productionMutation',
		find: '\t\t} else if (contractEntry.optional === true && value === undefined) {',
		replace: '\t\t} else if (false) {',
	},
	{
		conjunctRefIdList: ['c_malformedRefusedByName', 'e_optionalSkipsAbsenceNotValidation'],
		twinName: 'discriminatorKindCheckerNeutered',
		leverKind: 'productionMutation',
		find: "\tsubjectDiscriminator: (value) =>\n\t\ttypeof value === 'string' && vocabularyLib.RELATIONSHIP_DISCRIMINATOR_PATTERN.test(value)",
		replace: "\tsubjectDiscriminator: (value) =>\n\t\ttrue",
	},
	{
		// The invariant's own twin: mark a genuinely REQUIRED row optional and the absence test must go red.
		// Without this, "the new mode leaves every other row unaffected" would be a claim rather than a gate.
		conjunctRefIdList: ['d_nonOptionalRowStillRefusesOnAbsence'],
		twinName: 'requiredRowMarkedOptional',
		leverKind: 'productionMutation',
		find: "\tbridgeName: Object.freeze({ required: true, kind: 'lowerCamelString' }),",
		replace: "\tbridgeName: Object.freeze({ optional: true, kind: 'lowerCamelString' }),",
	},
	{
		conjunctRefIdList: ['b_declaredDiscriminatorAccepted'],
		twinName: 'rowRemovedFromContract',
		leverKind: 'productionMutation',
		find: "\tsubjectDiscriminator: Object.freeze({ optional: true, kind: 'subjectDiscriminator' }),",
		replace: '',
	},
];
const observedRedSet = new Set();
twinList.forEach((oneTwin) => {
	moduleDouble.assertMutationApplies({ modulePath: CONTRACT_PATH, find: oneTwin.find });
	const doubled = moduleDouble.loadWithMutations({ modulePath: CONTRACT_PATH, mutationList: [{ modulePath: CONTRACT_PATH, find: oneTwin.find, replace: oneTwin.replace }] });
	oneTwin.conjunctRefIdList.forEach((oneRefId) => {
		const verdict = conjunctJudgeByRefId[oneRefId](doubled);
		harness.ok(`${oneRefId} observed RED under twin '${oneTwin.twinName}' (${oneTwin.leverKind})`, verdict.pass === false, verdict.detail);
		if (verdict.pass === false) {
			observedRedSet.add(oneRefId);
		}
		process.global.xLog.status(`  RED-OBSERVED BG-SUBJECT-DISCRIMINATOR/${oneRefId} twin='${oneTwin.twinName}' lever=${oneTwin.leverKind} → ${verdict.pass ? 'PASS (DEFECTIVE)' : 'FAIL'}: ${verdict.detail}`);
	});
});
harness.equal('every conjunct was observed red', observedRedSet.size, Object.keys(conjunctJudgeByRefId).length);
process.global.xLog.status(`  BG-SUBJECT-DISCRIMINATOR: ${observedRedSet.size}/${Object.keys(conjunctJudgeByRefId).length} conjuncts observed red, ${twinList.length} twin runs`);

harness.report();
