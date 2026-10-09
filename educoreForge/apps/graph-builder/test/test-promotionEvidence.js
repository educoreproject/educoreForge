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
//   ⟪lane FIX, 2026-10-09: -stampPromotion accepts a TRUE -replay⟫
//   (i) a -replay run log of THIS manifest that conserved and completed reads 'pass', its detail carrying the conservation
//   (j) a -replay run log of ANOTHER manifest is REFUSED by name
//   (k) a -replay that FAILED (its restore conservation failed, or the run failed) is REFUSED by name, naming the failure
//   (l) a log that is not ONE -replay (two runs concatenated; a build log) is REFUSED by name
//   (n) a -replay that did not complete (interrupted: no conservation line, no result) is REFUSED by name
//   (m) graphBuilder -stampPromotion takes EXACTLY ONE replay evidence: neither is refused naming both forms, both are refused
//       (run as the operator runs it; no docker is reached)
// RED TWINS, each observed in memory: (a) the status ignored; (b) the manifest tie removed; (c) the replay's manifest compare
// removed so a foreign one passes; (d) the judge-call count ignored; (i) the manifest line misread; (j) the -replay's manifest
// tie removed; (k) the failure lines ignored; (l) the one-run count loosened; (n) the completion unchecked.

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
// a -replay run log, as build.replay, replayManager.restore and the -replay action print it
const replayRunText = (manifestRefId, { conservationLine = true, resultBlock = true, failureLine = '' } = {}) =>
	`  [replay] manifest ${manifestRefId} -- 19 member(s)\n[replayManager] provisioning scratch graph 'DEV_gb_materialize_1_1' (bolt 7817)...\n` +
	`[replayManager] restoring 19 schema block(s) into 'DEV_gb_materialize_1_1'\n` +
	(conservationLine ? `[replayManager] restore conservation PASS: 'DEV_gb_materialize_1_1': the blocks hold 243796 distinct node(s) (243805 emitted) and 706868 distinct edge(s) (707037 emitted); the graph holds 243796 node(s) and 706868 edge(s); 0 edge(s) dangling\n` : '') +
	(failureLine ? `${failureLine}\n` : '') +
	(resultBlock ? `{\n  "manifestId": "${manifestRefId}",\n  "memberCount": 19,\n  "finishXorVerified": true\n}\n` : '');
const verdictOf = (mutationList, evidenceReaderName, fileName, text) => evidenceLibFor(mutationList).gateVerdictFor({ evidenceReaderName, evidencePath: evidenceFile(fileName, text), manifestRefId: THIS_MANIFEST });

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
		const read = verdictOf(mutationList, 'replayBuild', 'replayThis.log', replayText(THIS_MANIFEST, 0));
		const foreign = verdictOf(mutationList, 'replayBuild', 'replayForeign.log', replayText(OTHER_MANIFEST, 0));
		return { pass: read.verdict === 'pass' && foreign.verdict === 'fail', detail: `this ${read.verdict} / foreign ${foreign.verdict}` };
	},
	d_replayThatJudgedFails: (mutationList) => {
		const read = verdictOf(mutationList, 'replayBuild', 'replayJudged.log', replayText(THIS_MANIFEST, 3));
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
	i_replayRunOfThisManifestPasses: (mutationList) => {
		const read = verdictOf(mutationList, 'replayRun', 'replayRunThis.log', replayRunText(THIS_MANIFEST));
		return { pass: read.gate === 'replay' && read.verdict === 'pass' && /-replay of manifest b{64} \(19 members\) completed; restore conservation PASS: .*0 edge\(s\) dangling/.test(read.detail), detail: read.detail || read.error };
	},
	j_replayRunOfAnotherManifestRefused: (mutationList) => {
		const read = verdictOf(mutationList, 'replayRun', 'replayRunForeign.log', replayRunText(OTHER_MANIFEST));
		return { pass: /REFUSED: the -replay replayed manifest c{64}, and this graph's passport names b{64}/.test(String(read.error)), detail: read.error || `read ${read.verdict}` };
	},
	k_failedReplayRunRefused: (mutationList) => {
		const conservationFailedRead = verdictOf(mutationList, 'replayRun', 'replayRunConservationFailed.log', replayRunText(THIS_MANIFEST, { conservationLine: false, resultBlock: false, failureLine: "graphBuilder -replay failed: graphBuilder replay: materialize failed: loading 19 schema block(s): replayManager.init 'DEV_gb_materialize_1_1': REFUSED — RESTORE CONSERVATION FAILED: the blocks hold 10 distinct node(s) (10 emitted) and 9 distinct edge(s) (9 emitted); the graph holds 10 node(s) and 8 edge(s); 1 edge(s) dangling. The graph is not the manifest's blocks." }));
		const runFailedRead = verdictOf(mutationList, 'replayRun', 'replayRunFailed.log', replayRunText(THIS_MANIFEST, { conservationLine: true, resultBlock: false, failureLine: 'graphBuilder -replay failed: replay failed: the fidelity gate refused' }));
		return { pass: /REFUSED: the -replay of bbbbbbbbbbbb FAILED: .*RESTORE CONSERVATION FAILED/.test(String(conservationFailedRead.error)) && /REFUSED: the -replay of bbbbbbbbbbbb FAILED: graphBuilder -replay failed: replay failed: the fidelity gate refused/.test(String(runFailedRead.error)), detail: `${conservationFailedRead.error || conservationFailedRead.verdict} | ${runFailedRead.error || runFailedRead.verdict}` };
	},
	l_notOneReplayRunRefused: (mutationList) => {
		const twoRunRead = verdictOf(mutationList, 'replayRun', 'replayRunTwice.log', `${replayRunText(THIS_MANIFEST)}${replayRunText(THIS_MANIFEST)}`);
		const buildLogRead = verdictOf(mutationList, 'replayRun', 'replayRunIsABuild.log', replayText(THIS_MANIFEST, 0));
		return { pass: /REFUSED: the replay evidence holds 2 '\[replay\] manifest' line\(s\)/.test(String(twoRunRead.error)) && /holds 0 '\[replay\] manifest' line\(s\).*--replayBuildLogPath/.test(String(buildLogRead.error)), detail: `${twoRunRead.error || twoRunRead.verdict} | ${buildLogRead.error || buildLogRead.verdict}` };
	},
	n_interruptedReplayRunRefused: (mutationList) => {
		// interrupted after the restore conserved, before the run's result: the conservation line alone is not a completed replay
		const read = verdictOf(mutationList, 'replayRun', 'replayRunInterrupted.log', replayRunText(THIS_MANIFEST, { conservationLine: true, resultBlock: false }));
		return { pass: /REFUSED: the -replay of bbbbbbbbbbbb did not complete: .*\(it has 1\).*no result/.test(String(read.error)), detail: read.error || `read ${read.verdict}` };
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
	{ conjunctRefId: 'i_replayRunOfThisManifestPasses', twinName: 'manifestLineMisread', find: 'const REPLAY_RUN_MANIFEST_LINE_RE = /\\[replay\\] manifest ([0-9a-f]{64}) -- (\\d+) member\\(s\\)/g;', replace: 'const REPLAY_RUN_MANIFEST_LINE_RE = /\\[replay\\] manifest ([0-9a-f]{64}) -- (\\d+) members/g;' },
	{ conjunctRefId: 'j_replayRunOfAnotherManifestRefused', twinName: 'replayRunManifestTieRemoved', find: '\t\tif (openedManifestRefId !== manifestRefId) {', replace: '\t\tif (false) {' },
	{ conjunctRefId: 'k_failedReplayRunRefused', twinName: 'failureLinesIgnored', find: 'const failureMatch = RESTORE_CONSERVATION_FAILED_LINE_RE.exec(evidenceText) || REPLAY_FAILED_LINE_RE.exec(evidenceText);', replace: 'const failureMatch = null;' },
	{ conjunctRefId: 'l_notOneReplayRunRefused', twinName: 'oneRunCountLoosened', find: '\t\tif (openedList.length !== 1) {', replace: '\t\tif (openedList.length === 0) {' },
	{ conjunctRefId: 'n_interruptedReplayRunRefused', twinName: 'completionUnchecked', find: "if (conservationLineList.length !== 1 || !resultManifestMatch || resultManifestMatch[1] !== manifestRefId || !REPLAY_RESULT_FINISHED_RE.test(evidenceText)) {", replace: 'if (conservationLineList.length !== 1) {' },
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
// (m) ⟪lane FIX⟫ exactly one replay evidence, refused by name before any container is read (red observed on main 2fbbca10: neither
// named the build log alone; both went on to 'docker inspect' — DEVLOG-FIX)
const stampRunWith = (extraArgList) => require('child_process').spawnSync('node', [path.join(__dirname, '..', 'graphBuilder.js'), '-stampPromotion', '--containerName=DEV_fixNoSuchContainer', '--goldEvalCheckLogPath=/tmp/gold.log', '--reforgeEvidencePath=/tmp/reforge.json', ...extraArgList], { encoding: 'utf8' });
const neitherRun = stampRunWith([]);
const bothRun = stampRunWith(['--replayLogPath=/tmp/replayRun.log', '--replayBuildLogPath=/tmp/replayBuild.log']);
const neitherText = `${neitherRun.stdout}${neitherRun.stderr}`;
const bothText = `${bothRun.stdout}${bothRun.stderr}`;
harness.ok('m_stampTakesExactlyOneReplayEvidence PASS', neitherRun.status === 1 && /ONE of --replayLogPath=<the -replay run log of this manifest> or --replayBuildLogPath=<the zero-judge replay build log> REQUIRED/.test(neitherText) && bothRun.status === 1 && /REFUSED — --replayLogPath and --replayBuildLogPath are both named/.test(bothText) && !/docker inspect/.test(`${neitherText}${bothText}`), `${neitherText.slice(0, 240)} | ${bothText.slice(0, 240)}`);
harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a reader double (in memory)');
harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), Object.keys(conjunctJudgeByRefId).sort().join(','));
TWIN_LIST.forEach((oneTwin) => {
	const verdict = conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }]);
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
});
fs.rmSync(scratchDir, { recursive: true, force: true });
harness.report();
