#!/usr/bin/env node
'use strict';

// test-verdictShapeAtStage.js — gate for W-C-14 (V1-C46, V1-S17/S18; campaign P2): the round-trip stage adjudicates every
// bundle's verdict on ONE normative field list (the forge framework's typed NORMATIVE_VERDICT_FIELD_LIST) and checks each
// field's TYPE, so a null or a string count is refused by name instead of passing (before P2: `null > 0` is false).
//
// PROVES:
//   (a) a verdict with inventedTotal: null FAILS the stage, named nonconforming
//   (b) a verdict with lostTotal: '0' (a string) FAILS the stage, named
//   (c) a well-typed lossy verdict still succeeds (LOST tolerated, unchanged)
//   (d) the stage keeps no list of its own (NORMATIVE_VERDICT_FIELD_NAMES is gone from round-trip-stage.js) and the
//       assembler's typed list names the five normative fields
// RED TWIN (in memory, round-trip-stage double): typeCheckRemoved -> (a) and (b) red.
//
// ⟪campaign P3, W-C-14; ruling VIOLET_VALLEY 2026-10-06: "ONE shape, no exceptions - the CEDS and Ed-Fi validators emit the
// full normative verdict, including the lost/invented ITEM lists (empty when clean, so cheap), and the stage applies the whole
// rule. Gate it with a red twin on each."⟫
//   (e) a verdict without its lostList FAILS the stage, named; (f) without its inventedList; (g) without the A8 census
//   (h-ceds) (h-edfi) (h-sif) each bespoke validator's normativeVerdictPartFor, over a synthetic lossy report, makes a verdict
//       verifyVerdictShape accepts — so that validator emits the whole shape. RED TWIN ON EACH: a validator double whose
//       part omits its lostList (the shape every one of them carried before P3) -> its conjunct red.
// (c)'s fixture now carries the whole shape (5 contentGap items, 2 declared omissions (G21), no inventions, a limit, a census).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the round-trip stage type-checks the one normative verdict field list
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');
const verdictAssembler = require('../../../lib/forge-framework/roundTripHarness/verdictAssembler');

const STAGE_PATH = path.join(__dirname, '..', 'lib', 'round-trip-stage.js');
const stageFor = (mutationList) => (mutationList.length === 0 ? require(STAGE_PATH) : loadBuildJsDouble({ buildJsPath: STAGE_PATH, mutationList }))();
const silentXLog = { status() {}, error() {}, verbose() {}, result() {} };
const runStageWith = (mutationList, verdict, done) => {
	const outputDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'p2VerdictShape-'));
	stageFor(mutationList).runRoundTripStage(
		{
			stageSpec: { mode: 'build', enabled: true, outputDirPath, roster: { rosterRows: [{ token: 'alpha', standardName: 'ALPHA', disposition: 'declared', validatorPath: '/fake/alpha/roundTripValidator.js', validatorApi: { validate: (spec, cb) => cb('', verdict) }, snapshotDirPath: '/fake/alpha/snap' }], declaredTokens: ['alpha'], absentTokens: [], unresolvableTokens: [] } },
			containerHandle: { containerName: 'DEV_verdictShape', boltUrl: 'bolt://localhost:9999', user: 'neo4j', password: 'x' },
			xLog: silentXLog,
		},
		(err) => done(err || ''),
	);
};
const lostItemFor = (lostCategory, itemIndex) => ({ statementKey: `s${itemIndex}`, statement: { subject: `s${itemIndex}` }, lostCategory });
// ⟪G21⟫ the omitted items live in explicitlyOmittedList under their declaration, no longer inside lostList
const WELL_TYPED = {
	roundTripClean: false, inventedTotal: 0, lostTotal: 5, contentGapTotal: 5, explicitlyOmittedTotal: 2,
	lostList: [0, 1, 2, 3, 4].map((itemIndex) => lostItemFor('contentGap', itemIndex)),
	explicitlyOmittedList: [5, 6].map((itemIndex) => ({ statementKey: `s${itemIndex}`, kind: 'toyKind', rule: 'toy/rule.js' })),
	explicitOmissionDeclaration: { rule: 'toy/rule.js', kindPropertyName: 'omittedKind', kindList: ['toyKind'], caveatText: '' },
	inventedList: [],
	semanticValidationLimit: 'a toy limit',
	census: { wallClockMs: 1, peakMemoryBytes: 1, statementCensus: { sourceStatementCount: 7, graphStatementCount: 0, matchedCount: 0 } },
};
const withoutMember = (verdict, memberName) => Object.keys(verdict).filter((oneName) => oneName !== memberName).reduce((soFar, oneName) => ({ ...soFar, [oneName]: verdict[oneName] }), {});
// the bespoke validators (W-C-14): each one's PURE verdict part over a synthetic lossy report, joined to the normative counts
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const VALIDATOR_PATH_BY_NAME = {
	ceds: path.join(TREE_ROOT, 'forges', 'ceds', 'roundTripValidator.js'),
	edfi: path.join(TREE_ROOT, 'forges', 'edfi', 'roundTripValidator.js'),
	sif: path.join(TREE_ROOT, 'forges', 'sif', 'roundTripValidator.js'),
};
const validatorFor = (validatorName, mutationList) => {
	const loaded = mutationList.length === 0 ? require(VALIDATOR_PATH_BY_NAME[validatorName]) : loadBuildJsDouble({ buildJsPath: VALIDATOR_PATH_BY_NAME[validatorName], mutationList });
	return typeof loaded === 'function' ? loaded() : loaded;
};
const SYNTHETIC_PART_BY_VALIDATOR = {
	ceds: (validator) => validator.normativeVerdictPartFor({ report: { headline: { sourceStatements: 3, emittedStatements: 2, matched: 2 }, lostItemList: [{ statementKey: 'k1', statement: { subject: 'a', predicate: 'p', objectKind: 'literal', object: 'x', datatype: '' } }], inventedItemList: [] }, explicitlyOmittedPredicateList: [], wallClockMs: 1, peakMemoryBytes: 1 }),
	edfi: (validator) => validator.normativeVerdictPartFor({ report: { headline: { sourceStatements: 3, emittedStatements: 2, reproduced: 2 }, lostDetailList: [{ subject: 'a', predicate: 'p', object: 'x', bucketName: 'contentGap' }], inventedDetailList: [] }, crosswalkGuardViolationList: [], wallClockMs: 1, peakMemoryBytes: 1 }),
	sif: (validator) => validator.normativeVerdictPartFor({ report: { headline: { sourceStatements: 3, emittedStatements: 2, matched: 2 }, lostDetailList: [{ subject: 'a', predicate: 'p', object: 'x', lostCategory: 'contentGap' }], inventedDetailList: [] }, wallClockMs: 1, peakMemoryBytes: 1 }),
};
const bespokeConjunctFor = (validatorName) => (mutationList, done) => {
	const part = SYNTHETIC_PART_BY_VALIDATOR[validatorName](validatorFor(validatorName, mutationList));
	const verdict = { roundTripClean: false, inventedTotal: 0, lostTotal: 1, contentGapTotal: 1, explicitlyOmittedTotal: 0, semanticValidationLimit: `the ${validatorName} limit`, ...part };
	const shape = verdictAssembler.verifyVerdictShape(verdict);
	done({ pass: shape.error === '', detail: shape.error || `${validatorName}: the whole shape (${part.lostList.length} lost item, census ${JSON.stringify(Object.keys(part.census))})` });
};
// ⟪G21 re-anchor⟫ each part now returns its partitioned lostList (the true losses); the twin still withholds it
const LOST_LIST_FIND_BY_VALIDATOR = {
	ceds: 'lostList: partitioned.lostList,',
	edfi: 'lostList: partitioned.lostList,',
	sif: 'lostList: partitioned.lostList,',
};

const conjunctJudgeByRefId = {
	a_nullInventedRefused: (mutationList, done) => runStageWith(mutationList, { ...WELL_TYPED, inventedTotal: null }, (err) => done({ pass: /'alpha' verdict is nonconforming: .*'inventedTotal' is null, expected number/.test(err), detail: err || 'the stage passed a null inventedTotal' })),
	b_stringLostRefused: (mutationList, done) => runStageWith(mutationList, { ...WELL_TYPED, lostTotal: '0' }, (err) => done({ pass: /'lostTotal' is a string, expected number/.test(err), detail: err || "the stage passed lostTotal '0'" })),
	c_wellTypedLossTolerated: (mutationList, done) => runStageWith(mutationList, WELL_TYPED, (err) => done({ pass: err === '', detail: err || 'succeeded' })),
	e_noLostListRefused: (mutationList, done) => runStageWith(mutationList, withoutMember(WELL_TYPED, 'lostList'), (err) => done({ pass: /'alpha' verdict is nonconforming: .*verdict lacks lostList/.test(err), detail: err || 'the stage passed a verdict with no lostList' })),
	f_noInventedListRefused: (mutationList, done) => runStageWith(mutationList, withoutMember(WELL_TYPED, 'inventedList'), (err) => done({ pass: /verdict inventedList is absent but inventedTotal is 0/.test(err), detail: err || 'the stage passed a verdict with no inventedList' })),
	g_noCensusRefused: (mutationList, done) => runStageWith(mutationList, withoutMember(WELL_TYPED, 'census'), (err) => done({ pass: /verdict lacks the A8 census/.test(err), detail: err || 'the stage passed a verdict with no census' })),
	hCeds_bespokeVerdictHasTheWholeShape: bespokeConjunctFor('ceds'),
	hEdfi_bespokeVerdictHasTheWholeShape: bespokeConjunctFor('edfi'),
	hSif_bespokeVerdictHasTheWholeShape: bespokeConjunctFor('sif'),
	d_oneListOnly: (mutationList, done) => {
		const stageText = fs.readFileSync(STAGE_PATH, 'utf8');
		done({ pass: stageText.indexOf('NORMATIVE_VERDICT_FIELD_NAMES') === -1 && verdictAssembler.NORMATIVE_VERDICT_FIELD_NAME_LIST.join(',') === 'roundTripClean,inventedTotal,lostTotal,contentGapTotal,explicitlyOmittedTotal', detail: verdictAssembler.NORMATIVE_VERDICT_FIELD_NAME_LIST.join(',') });
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'a_nullInventedRefused', twinName: 'typeCheckRemoved', find: '			if (typeShapeError) {', replace: '			if (false) {' },
	{ conjunctRefId: 'b_stringLostRefused', twinName: 'typeCheckRemoved', find: '			if (typeShapeError) {', replace: '			if (false) {' },
	// the P2 stage applied only the normative half: e, f and g pass a verdict without its items or census
	{ conjunctRefId: 'e_noLostListRefused', twinName: 'stageAppliesNormativeHalfOnly', find: '			const typeShapeError = verifyVerdictShape(verdict).error;', replace: '			const typeShapeError = require(path.join(__dirname, \'..\', \'..\', \'..\', \'lib\', \'forge-framework\', \'roundTripHarness\', \'verdictAssembler\')).normativeFieldShapeError(verdict);' },
	{ conjunctRefId: 'f_noInventedListRefused', twinName: 'stageAppliesNormativeHalfOnly', find: '			const typeShapeError = verifyVerdictShape(verdict).error;', replace: '			const typeShapeError = require(path.join(__dirname, \'..\', \'..\', \'..\', \'lib\', \'forge-framework\', \'roundTripHarness\', \'verdictAssembler\')).normativeFieldShapeError(verdict);' },
	{ conjunctRefId: 'g_noCensusRefused', twinName: 'stageAppliesNormativeHalfOnly', find: '			const typeShapeError = verifyVerdictShape(verdict).error;', replace: '			const typeShapeError = require(path.join(__dirname, \'..\', \'..\', \'..\', \'lib\', \'forge-framework\', \'roundTripHarness\', \'verdictAssembler\')).normativeFieldShapeError(verdict);' },
	// A RED TWIN ON EACH bespoke validator (the ruling's words): its verdict part without the lostList it lacked before P3
	...['ceds', 'edfi', 'sif'].map((oneValidatorName) => ({ conjunctRefId: `h${oneValidatorName.charAt(0).toUpperCase()}${oneValidatorName.slice(1)}_bespokeVerdictHasTheWholeShape`, twinName: `${oneValidatorName}PartWithoutLostList`, validatorName: oneValidatorName, find: LOST_LIST_FIND_BY_VALIDATOR[oneValidatorName], replace: `${LOST_LIST_FIND_BY_VALIDATOR[oneValidatorName].replace('lostList:', 'lostListWithheld:')}` })),
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
harness.section('BASELINE — the real stage passes every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a stage double (in memory)');
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
