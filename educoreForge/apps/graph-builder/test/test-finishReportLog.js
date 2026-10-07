#!/usr/bin/env node
'use strict';

// test-finishReportLog.js — gate for W-A-8 (V1-C22; campaign P2): the finish verb's report reaches the build log (one
// status line per declared path in FINISH_REPORT_LOG_FIELD_LIST, plus one per degraded edge family) and, for a run with a
// directory, the whole report lands in finishReport.json; a -replay passes an explicit null and gets the log lines only.
//
// PROVES:
//   (a) finishReportLogLinesFor yields '[finish] passport.summary: passport written …' and a DEGRADED line naming the
//       absent family's absenceMeaning
//   (b) the materialize tail prints those lines and writes finishReport.json carrying exemplarVerification.rowCounts
//   (c) finishReportFilePath null writes nothing; finishReportFilePath absent is refused by name
// RED TWINS (in memory, build.js double): summaryPathUndeclared -> (a); reportFileNotWritten -> (b).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the finish report reaches the build log and the run directory
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

const BUILD_JS_PATH = path.join(__dirname, '..', 'lib', 'build.js');
const buildLibFor = (mutationList) => (mutationList.length === 0 ? require(BUILD_JS_PATH) : loadBuildJsDouble({ buildJsPath: BUILD_JS_PATH, mutationList }));

const FINISH_REPORT = {
	passportElementId: 'double:passport',
	writeCount: 2,
	xorVerified: true,
	applied: [{ name: 'schemaView' }],
	passport: { summary: 'passport written (singleton verified)', edgeReportList: [{ edgeType: 'ADVISES', edgeCount: 0 }], degradedList: [{ edgeType: 'ADVISES', absenceMeaning: 'the usagePattern finisher was disabled' }], trust: { trustworthyForMeaning: true } },
	exemplarVerification: { summary: '5 executed', rowCounts: { whereDoIStart: 95 }, zeroRowFindings: [] },
	verificationAttestation: { summary: 'usagePatternVerification written' },
	xorRecheck: { totalNodes: 12 },
};
const runMaterialize = (mutationList, finishReportFilePath, done) => {
	const statusLineList = [];
	const replayDouble = {
		create: (spec, callback) => callback('', { graphName: 'DEV_finishReportDouble', boltUrl: 'bolt://double:1' }),
		init: (spec, callback) => callback('', { legacyStringIntegerTotal: 0, legacyStringIntegerCountBySource: {} }), // ⟪P3, ruling B⟫ the replay report's legacy count
		delete: (graphHandle, callback) => callback(''),
		finish: (spec, callback) => callback('', FINISH_REPORT),
	};
	const materializeSpec = {
		xLog: { status: (oneLine) => statusLineList.push(oneLine), error() {}, verbose() {}, result() {} },
		replay: replayDouble, resolvedSchemaBlocks: [], manifestId: 'double-manifest', memberCount: 0, standardTokens: [], commandLineParameters: { switches: {}, values: {} },
		fidelityGateRunner: (spec, callback) => callback('', { gate: 'fidelity', verdict: 'notRun', detail: 'double' }),
		storeResolver: () => {}, storeReader: { getManifest: () => {} },
		roundTripStageRunner: (spec, callback) => callback('', { stageRan: false, disposition: 'double' }),
		roundTripStageSpec: { mode: 'double' }, frameworkFingerprintList: [],
		embeddingCoverageGateRunner: (spec, callback) => callback('', { gate: 'embeddingCoverage', verdict: 'notRun', detail: 'double' }),
		forgeCensusGateRunner: (spec, callback) => callback('', { gate: 'forgeCensus', verdict: 'notRun', detail: 'double' }), forgeCensusSpec: null,
	};
	buildLibFor(mutationList).materializeSchemaBlocks(finishReportFilePath === undefined ? materializeSpec : { ...materializeSpec, finishReportFilePath }, (err) => done({ err: err || '', statusLineList }));
};

const conjunctJudgeByRefId = {
	a_linesForEveryDeclaredPath: (mutationList, done) => {
		const { lineList } = buildLibFor(mutationList).finishReportLogLinesFor(FINISH_REPORT);
		const pass = lineList.some((oneLine) => oneLine === '[finish] passport.summary: passport written (singleton verified)') && lineList.some((oneLine) => /^\[finish\] DEGRADED ADVISES: the usagePattern finisher was disabled$/.test(oneLine)) && lineList.some((oneLine) => /^\[finish\] exemplarVerification\.rowCounts: \{"whereDoIStart":95\}$/.test(oneLine));
		done({ pass, detail: lineList.slice(0, 3).join(' | ') });
	},
	b_tailLogsAndWritesTheReport: (mutationList, done) => {
		const reportFilePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p2FinishReport-')), 'run', 'finishReport.json');
		runMaterialize(mutationList, reportFilePath, ({ err, statusLineList }) => {
			const written = fs.existsSync(reportFilePath) ? JSON.parse(fs.readFileSync(reportFilePath, 'utf8')) : null;
			const pass = !err && statusLineList.some((oneLine) => /\[finish\] passport\.summary: passport written/.test(oneLine)) && written !== null && written.exemplarVerification.rowCounts.whereDoIStart === 95;
			done({ pass, detail: err || `file ${written ? 'written' : 'ABSENT'}; ${statusLineList.filter((oneLine) => /\[finish\]/.test(oneLine)).length} [finish] line(s)` });
		});
	},
	c_nullWritesNothingAbsentRefused: (mutationList, done) =>
		runMaterialize(mutationList, null, (nullOutcome) =>
			runMaterialize(mutationList, undefined, (absentOutcome) =>
				done({ pass: !nullOutcome.err && nullOutcome.statusLineList.every((oneLine) => !/the whole finish report ->/.test(oneLine)) && /finishReportFilePath is REQUIRED/.test(absentOutcome.err), detail: `null: ${nullOutcome.err || 'ok'} | absent: ${absentOutcome.err || 'accepted'}` }))),
};
const TWIN_LIST = [
	{ conjunctRefId: 'a_linesForEveryDeclaredPath', twinName: 'summaryPathUndeclared', find: "\t'passport.summary',\n", replace: '' },
	{ conjunctRefId: 'b_tailLogsAndWritesTheReport', twinName: 'reportFileNotWritten', find: "\t\t\t\t\t\t\t\t\t\tfs.writeFileSync(finishReportFilePath, `${JSON.stringify(finishReport, null, '\\t')}\\n`);", replace: '' },
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
