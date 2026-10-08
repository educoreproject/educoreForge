#!/usr/bin/env node
'use strict';

// test-promotionEvidence.js — the promotion stamp's verdicts are READ from evidence files, tied to the graph by its manifest
// id (lane P, mappingProvenance 2026-10-04). Pure: synthetic evidence texts in a temp directory.
//   (a) a goldEvalCheck output saying PASS for THIS manifest reads 'pass'; FAIL reads 'fail'
//   (b) a goldEvalCheck output for ANOTHER manifest is REFUSED by name (it is not evidence about this graph)
//   (c) a replay log composing THIS manifest with no judge call reads 'pass'
//   (d) a replay log that called a judge reads 'fail' (a rebuild, not a replay)
//   (e) ⟪lane REFORGE⟫ a reforgeCompare summary reading pass reads 'pass', and its detail says whether THIS graph's manifest is one
//       the reforge run composed (it is recorded, not refused: the run attests the forge code at its head, which a later
//       build of the same head inherits)
//   (f) a reforgeCompare summary reading fail reads 'fail'
//   (g) a file that is not a reforgeCompare summary is REFUSED by name
//   (h) ⟪lane REFORGE⟫ graphBuilder -stampPromotion REQUIRES --reforgeEvidencePath beside the other two evidence paths, and
//       refuses its absence by name before it reads any container (run as the operator runs it; no docker is reached)
// RED TWINS, each observed in memory: (a) the status ignored; (b) the manifest tie removed; (c) the replay's manifest compare
// removed so a foreign one passes; (d) the judge-call count ignored.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: promotion verdicts are read from evidence tied to the graph's manifest
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const EVIDENCE_PATH = path.join(__dirname, '..', 'lib', 'promotion-evidence.js');
const evidenceLibFor = (mutationList) => (mutationList.length === 0 ? require(EVIDENCE_PATH) : loadBuildJsDouble({ buildJsPath: EVIDENCE_PATH, mutationList }));

const THIS_MANIFEST = 'b'.repeat(64);
const OTHER_MANIFEST = 'c'.repeat(64);
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promotionEvidence-'));
const evidenceFile = (fileName, text) => {
	const filePath = path.join(scratchDir, fileName);
	fs.writeFileSync(filePath, text);
	return filePath;
};
const goldText = (status, manifestRefId) => `graphBuilder: [goldEvalCheck] ${status} — test\n{\n  "certification": "${status}",\n  "manifestRefId": "${manifestRefId}"\n}\n`;
const replayText = (manifestRefId, judgedLineCount) => `  [compose] manifest ${manifestRefId} -- 19 members\n${'[bridge x] judged: 5 (asked 5)\n'.repeat(judgedLineCount)}`;

const reforgeText = (verdict, manifestRefIdList) => JSON.stringify({ summaryFormat: 'reforgeEvidence-v1', reforgeRunRefId: 'toyRun', codeHead: '0123456789abcdef', dirtyPathCount: 0, verdict, detail: `reforgeCompare run toyRun on head 0123456789ab: 3 of 3 comparison report(s) identical`, manifestRefIdList, reportRowList: [] });
const verdictOf = (mutationList, gate, fileName, text) => evidenceLibFor(mutationList).gateVerdictFor({ gate, evidencePath: evidenceFile(fileName, text), manifestRefId: THIS_MANIFEST });

const conjunctJudgeByRefId = {
	a_goldEvalStatusRead: (mutationList) => {
		const passRead = verdictOf(mutationList, 'goldEvalCheck', 'goldPass.log', goldText('PASS', THIS_MANIFEST));
		const failRead = verdictOf(mutationList, 'goldEvalCheck', 'goldFail.log', goldText('FAIL', THIS_MANIFEST));
		return { pass: passRead.verdict === 'pass' && failRead.verdict === 'fail' && /^[0-9a-f]{64}$/.test(passRead.evidenceSha256), detail: `${passRead.verdict} / ${failRead.verdict}` };
	},
	b_foreignGoldEvalRefused: (mutationList) => {
		const read = verdictOf(mutationList, 'goldEvalCheck', 'goldForeign.log', goldText('PASS', OTHER_MANIFEST));
		return { pass: /REFUSED: the goldEvalCheck evidence certifies manifest c{64}, and this graph's passport names b{64}/.test(String(read.error)), detail: read.error || `read ${read.verdict}` };
	},
	c_replayOfThisManifestPasses: (mutationList) => {
		const read = verdictOf(mutationList, 'replay', 'replayThis.log', replayText(THIS_MANIFEST, 0));
		const foreign = verdictOf(mutationList, 'replay', 'replayForeign.log', replayText(OTHER_MANIFEST, 0));
		return { pass: read.verdict === 'pass' && foreign.verdict === 'fail', detail: `this ${read.verdict} / foreign ${foreign.verdict}` };
	},
	d_replayThatJudgedFails: (mutationList) => {
		const read = verdictOf(mutationList, 'replay', 'replayJudged.log', replayText(THIS_MANIFEST, 3));
		return { pass: read.verdict === 'fail' && /judge calls in the log: 3/.test(read.detail), detail: read.detail };
	},
	e_reforgePassReadWithManifestRelation: (mutationList) => {
		const composedRead = verdictOf(mutationList, 'reforgeDeterminism', 'reforgeComposed.json', reforgeText('pass', [THIS_MANIFEST]));
		const otherRead = verdictOf(mutationList, 'reforgeDeterminism', 'reforgeOther.json', reforgeText('pass', [OTHER_MANIFEST]));
		return { pass: composedRead.verdict === 'pass' && /run toyRun on head 0123456789ab/.test(composedRead.detail) && /this graph's manifest bbbbbbbbbbbb IS one the reforge run composed/.test(composedRead.detail) && otherRead.verdict === 'pass' && /is NOT one the reforge run composed/.test(otherRead.detail), detail: `${composedRead.detail || composedRead.error} | ${otherRead.detail || otherRead.error}` };
	},
	f_reforgeFailReadsFail: (mutationList) => {
		const read = verdictOf(mutationList, 'reforgeDeterminism', 'reforgeFail.json', reforgeText('fail', [THIS_MANIFEST]));
		return { pass: read.verdict === 'fail', detail: read.verdict || read.error };
	},
	g_notASummaryRefused: (mutationList) => {
		const notJsonRead = verdictOf(mutationList, 'reforgeDeterminism', 'reforgeNotJson.txt', 'graphBuilder: [goldEvalCheck] PASS');
		const otherFormatRead = verdictOf(mutationList, 'reforgeDeterminism', 'reforgeOtherFormat.json', reforgeText('pass', [THIS_MANIFEST]).replace('reforgeEvidence-v1', 'somethingElse-v1'));
		return { pass: /the reforgeDeterminism evidence is not a reforgeEvidence-v1 summary/.test(String(notJsonRead.error)) && /not a reforgeEvidence-v1 summary/.test(String(otherFormatRead.error)), detail: `${notJsonRead.error || notJsonRead.verdict} | ${otherFormatRead.error || otherFormatRead.verdict}` };
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_goldEvalStatusRead', twinName: 'statusIgnored', find: "verdict: statusMatch[1] === 'PASS' ? 'pass' : 'fail'", replace: "verdict: 'pass'" },
	{ conjunctRefId: 'b_foreignGoldEvalRefused', twinName: 'manifestTieRemoved', find: '\t\tif (manifestMatch[1] !== manifestRefId) {', replace: '\t\tif (false) {' },
	{ conjunctRefId: 'c_replayOfThisManifestPasses', twinName: 'replayManifestUncompared', find: 'const reproduced = composedManifestRefId === manifestRefId && judgedLineCount === 0;', replace: 'const reproduced = judgedLineCount === 0;' },
	{ conjunctRefId: 'e_reforgePassReadWithManifestRelation', twinName: 'manifestRelationDropped', find: "${composedByRun ? 'IS one the reforge run composed'", replace: "${true ? 'IS one the reforge run composed'" },
	{ conjunctRefId: 'f_reforgeFailReadsFail', twinName: 'reforgeVerdictIgnored', find: 'return { verdict: summary.verdict, detail:', replace: "return { verdict: 'pass', detail:" },
	{ conjunctRefId: 'g_notASummaryRefused', twinName: 'formatUnchecked', find: '!summary || summary.summaryFormat !== reforgeEvidenceFormat ||', replace: '!summary ||' },
	{ conjunctRefId: 'd_replayThatJudgedFails', twinName: 'judgeCallsIgnored', find: 'const reproduced = composedManifestRefId === manifestRefId && judgedLineCount === 0;', replace: 'const reproduced = composedManifestRefId === manifestRefId;' },
];

harness.section('BASELINE — the real evidence readers pass every conjunct');
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId]([]);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});
// (h) — the action's required parameters, run end to end (its red was observed before the action named the flag: the run
// went on to 'docker inspect' a container that does not exist)
const stampRun = require('child_process').spawnSync('node', [path.join(__dirname, '..', 'graphBuilder.js'), '-stampPromotion', '--containerName=DEV_reforgeNoSuchContainer', '--goldEvalCheckLogPath=/tmp/gold.log', '--replayBuildLogPath=/tmp/replay.log'], { encoding: 'utf8' });
harness.ok('h_stampRequiresReforgeEvidence PASS', stampRun.status === 1 && /--reforgeEvidencePath=<the reforgeCompare -summarize evidence file> REQUIRED/.test(`${stampRun.stdout}${stampRun.stderr}`) && !/docker inspect/.test(`${stampRun.stdout}${stampRun.stderr}`), `${stampRun.stdout}${stampRun.stderr}`.slice(0, 300));
harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a reader double (in memory)');
harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), Object.keys(conjunctJudgeByRefId).sort().join(','));
TWIN_LIST.forEach((oneTwin) => {
	const verdict = conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }]);
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
});
fs.rmSync(scratchDir, { recursive: true, force: true });
harness.report();
