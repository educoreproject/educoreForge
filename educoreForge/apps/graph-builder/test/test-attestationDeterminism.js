#!/usr/bin/env node
'use strict';

// test-attestationDeterminism.js — gate for lane REFORGE (forgeClean R3, 2026-10-08): a channel-A BuildAttestation row carries
// :ForgedNode, so it sits INSIDE the determinism fingerprint (build-attestation-finisher.js, S2: "twin builds must produce
// identical bytes ... no pid, no clock"). The first reforge comparison (plainA vs plainB, two from-scratch builds of one recipe
// on one head) found ONE such row differing: the roundTrip row's detail ended "; summary <the run directory>/roundTrip/
// roundTripStageSummary.json", and the run directory's name carries the build's start time. The detail now names the summary
// RELATIVE to the run directory, so the row is the same on every build of the same verdicts.
//
// PROVES:
//   (a) two stage reports identical but for WHERE their run directories are (different stamps) give byte-identical rows
//   (b) the detail still says where the summary is: the stage's own subdirectory and file name, under "the build's run directory"
// RED TWIN (in memory, a build.js double): absolutePathRestored -> (a).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: a channel-A attestation row carries nothing run-specific (lane REFORGE)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const BUILD_JS_PATH = path.join(__dirname, '..', 'lib', 'build.js');
const buildFor = (mutationList) => (mutationList.length === 0 ? require(BUILD_JS_PATH) : loadBuildJsDouble({ buildJsPath: BUILD_JS_PATH, mutationList }));
const cleanRow = (token) => ({ token, ran: true, roundTripClean: true, lostTotal: 0, inventedTotal: 0, explicitlyOmittedTotal: 12, explicitOmissionDeclarationText: `${token}: whitespace 12 (rule: toy/rule.js)` });
const stageReportIn = (runDirPath) => ({ stageRan: true, summaryFilePath: path.join(runDirPath, 'roundTrip', 'roundTripStageSummary.json'), standards: [cleanRow('ceds'), cleanRow('edfi')] });

const conjunctJudgeByRefId = {
	a_rowIdenticalAcrossRunDirectories: (mutationList) => {
		const build = buildFor(mutationList);
		const rowA = build.roundTripRowFor(stageReportIn('/scratch/reforge/plainA/buildLogs/goldJevAcceptance2_20261008-144120'));
		const rowB = build.roundTripRowFor(stageReportIn('/scratch/reforge/plainB/buildLogs/goldJevAcceptance2_20261008-153231'));
		return { pass: JSON.stringify(rowA) === JSON.stringify(rowB), detail: `A: …${rowA.detail.slice(-90)} | B: …${rowB.detail.slice(-90)}` };
	},
	b_detailStillNamesTheSummary: (mutationList) => {
		const row = buildFor(mutationList).roundTripRowFor(stageReportIn('/scratch/run'));
		return { pass: /; summary roundTrip\/roundTripStageSummary\.json in the build's run directory$/.test(row.detail) && row.verdict === 'pass', detail: row.detail.slice(-120) };
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'a_rowIdenticalAcrossRunDirectories', twinName: 'absolutePathRestored', find: "; summary ${ROUND_TRIP_SUMMARY_RELATIVE_PATH} in the build's run directory`,", replace: "; summary ${roundTripStageReport.summaryFilePath}`," },
];

harness.section('BASELINE — the real build.js passes every conjunct');
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId]([]);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});
harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a build.js double (in memory)');
TWIN_LIST.forEach((oneTwin) => {
	const verdict = conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }]);
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
});
harness.report();
