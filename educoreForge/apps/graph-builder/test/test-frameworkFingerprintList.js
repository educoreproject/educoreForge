#!/usr/bin/env node
'use strict';

// test-frameworkFingerprintList.js — gate for the build side of W-A-3 (campaign P2): the passport's frameworkFingerprint is
// read from the FROZEN HEADER of each decision block the build materialised (build.js frameworkFingerprintListFor), never
// assumed from the code that happens to be running at finish.
//
// PROVES:
//   (a) two pairKeys whose stored blocks carry fingerprints F1 and F2 give [F1, F2], in pairKey order
//   (b) no pairKey gives [] (a replay, or a build whose bridges froze nothing) and needs no store
//   (c) a pairKey the store cannot answer is REFUSED by name (the run report said a block exists)
//   (d) materializeSchemaBlocks refuses a frameworkFingerprintList that is not a list, by name, before anything runs
// RED TWINS (in memory, loadBuildJsDouble on build.js): headerNotRead — the push skipped -> (a) red; missingBlockAdmitted —
// an unanswered pairKey silently skipped -> (c) red; listCheckRemoved — the materialize refusal gone -> (d) red.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the passport's frameworkFingerprint comes from the frozen decision block headers
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const decisionBlockLib = require('../../../lib/bridge-framework/decisionBlock');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const BUILD_JS_PATH = path.join(__dirname, '..', 'lib', 'build.js');
const buildLibFor = (mutationList) => (mutationList.length === 0 ? require(BUILD_JS_PATH) : loadBuildJsDouble({ buildJsPath: BUILD_JS_PATH, mutationList }));

// a toy frozen block: every required header member present, the fingerprint the one that matters here
const frozenTextWith = (frameworkFingerprint) => {
	const header = decisionBlockLib.REQUIRED_HEADER_KEY_LIST.reduce((soFar, oneName) => ({ ...soFar, [oneName]: 'toy' }), {});
	return decisionBlockLib.frozenTextFor({ header: { ...header, frameworkFingerprint }, decisionRecordList: [], refusalList: [] }).frozenText;
};
const FROZEN_TEXT_BY_PAIR_KEY = { 'toy::A': frozenTextWith('1'.repeat(64)), 'toy::B': frozenTextWith('2'.repeat(64)) };
const decisionStoreDouble = { getDecisionBlock: ({ pairKey }, callback) => callback('', FROZEN_TEXT_BY_PAIR_KEY[pairKey] ? { frozenText: FROZEN_TEXT_BY_PAIR_KEY[pairKey] } : null) };

const conjunctJudgeByRefId = {
	a_fingerprintsReadFromFrozenHeaders: (mutationList, done) =>
		buildLibFor(mutationList).frameworkFingerprintListFor({ decisionStore: decisionStoreDouble, pairKeyList: ['toy::A', 'toy::B'] }, (err, fingerprintList) =>
			done({ pass: !err && JSON.stringify(fingerprintList) === JSON.stringify(['1'.repeat(64), '2'.repeat(64)]), detail: err || JSON.stringify((fingerprintList || []).map((oneFingerprint) => oneFingerprint.slice(0, 8))) })),
	b_noPairKeyNoStoreNeeded: (mutationList, done) =>
		buildLibFor(mutationList).frameworkFingerprintListFor({ decisionStore: null, pairKeyList: [] }, (err, fingerprintList) =>
			done({ pass: !err && Array.isArray(fingerprintList) && fingerprintList.length === 0, detail: err || JSON.stringify(fingerprintList) })),
	c_unanswerablePairKeyRefused: (mutationList, done) =>
		buildLibFor(mutationList).frameworkFingerprintListFor({ decisionStore: decisionStoreDouble, pairKeyList: ['toy::A', 'toy::MISSING'] }, (err) =>
			done({ pass: /the decision block for toy::MISSING could not be read for its frameworkFingerprint/.test(String(err)), detail: String(err || 'admitted a pairKey with no stored block') })),
	d_materializeRefusesANonList: (mutationList, done) =>
		buildLibFor(mutationList).materializeSchemaBlocks({ finishReportFilePath: null, embeddingCoverageGateRunner: () => {}, forgeCensusGateRunner: () => {}, forgeCensusSpec: null, storeResolver: () => {}, fidelityGateRunner: () => {}, storeReader: { getManifest: () => {} }, roundTripStageRunner: () => {}, roundTripStageSpec: {}, replay: { create: (spec, callback) => callback('reached create') } }, (err) =>
			done({ pass: /frameworkFingerprintList is REQUIRED as a list/.test(String(err)), detail: String(err) })),
};
const TWIN_LIST = [
	{ conjunctRefId: 'a_fingerprintsReadFromFrozenHeaders', twinName: 'headerNotRead', find: '				fingerprintList.push(parsed.block.header.frameworkFingerprint);', replace: '				void parsed;' },
	{ conjunctRefId: 'c_unanswerablePairKeyRefused', twinName: 'missingBlockAdmitted', find: "				if (getError || !stored || typeof stored.frozenText !== 'string') {", replace: '				if (getError || !stored) { oneDone(); return; } if (false) {' },
	{ conjunctRefId: 'd_materializeRefusesANonList', twinName: 'listCheckRemoved', find: '	if (!Array.isArray(frameworkFingerprintList)) {', replace: '	if (false) {' },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
harness.section('BASELINE — the real build.js passes every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a build.js double (in memory)');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) => {
				let settled = false;
				const settle = (verdict) => {
					if (settled) return;
					settled = true;
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
					stepDone();
				};
				conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }], settle);
			}),
			() => harness.report(),
		);
	},
);
