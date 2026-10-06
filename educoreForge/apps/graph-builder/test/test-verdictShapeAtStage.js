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
const WELL_TYPED = { roundTripClean: false, inventedTotal: 0, lostTotal: 5, contentGapTotal: 5, explicitlyOmittedTotal: 2 };

const conjunctJudgeByRefId = {
	a_nullInventedRefused: (mutationList, done) => runStageWith(mutationList, { ...WELL_TYPED, inventedTotal: null }, (err) => done({ pass: /'alpha' verdict is nonconforming: .*'inventedTotal' is null, expected number/.test(err), detail: err || 'the stage passed a null inventedTotal' })),
	b_stringLostRefused: (mutationList, done) => runStageWith(mutationList, { ...WELL_TYPED, lostTotal: '0' }, (err) => done({ pass: /'lostTotal' is a string, expected number/.test(err), detail: err || "the stage passed lostTotal '0'" })),
	c_wellTypedLossTolerated: (mutationList, done) => runStageWith(mutationList, WELL_TYPED, (err) => done({ pass: err === '', detail: err || 'succeeded' })),
	d_oneListOnly: (mutationList, done) => {
		const stageText = fs.readFileSync(STAGE_PATH, 'utf8');
		done({ pass: stageText.indexOf('NORMATIVE_VERDICT_FIELD_NAMES') === -1 && verdictAssembler.NORMATIVE_VERDICT_FIELD_NAME_LIST.join(',') === 'roundTripClean,inventedTotal,lostTotal,contentGapTotal,explicitlyOmittedTotal', detail: verdictAssembler.NORMATIVE_VERDICT_FIELD_NAME_LIST.join(',') });
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'a_nullInventedRefused', twinName: 'typeCheckRemoved', find: '			if (typeShapeError) {', replace: '			if (false) {' },
	{ conjunctRefId: 'b_stringLostRefused', twinName: 'typeCheckRemoved', find: '			if (typeShapeError) {', replace: '			if (false) {' },
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
