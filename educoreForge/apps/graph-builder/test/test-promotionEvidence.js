#!/usr/bin/env node
'use strict';

// test-promotionEvidence.js — the promotion stamp's verdicts are READ from evidence files, tied to the graph by its manifest
// id (lane P, mappingProvenance 2026-10-04). Pure: synthetic evidence texts in a temp directory.
//   (a) a goldEvalCheck output saying PASS for THIS manifest reads 'pass'; FAIL reads 'fail'
//   (b) a goldEvalCheck output for ANOTHER manifest is REFUSED by name (it is not evidence about this graph)
//   (c) a replay log composing THIS manifest with no judge call reads 'pass'
//   (d) a replay log that called a judge reads 'fail' (a rebuild, not a replay)
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
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_goldEvalStatusRead', twinName: 'statusIgnored', find: "verdict: statusMatch[1] === 'PASS' ? 'pass' : 'fail'", replace: "verdict: 'pass'" },
	{ conjunctRefId: 'b_foreignGoldEvalRefused', twinName: 'manifestTieRemoved', find: '\t\tif (manifestMatch[1] !== manifestRefId) {', replace: '\t\tif (false) {' },
	{ conjunctRefId: 'c_replayOfThisManifestPasses', twinName: 'replayManifestUncompared', find: 'const reproduced = composedManifestRefId === manifestRefId && judgedLineCount === 0;', replace: 'const reproduced = judgedLineCount === 0;' },
	{ conjunctRefId: 'd_replayThatJudgedFails', twinName: 'judgeCallsIgnored', find: 'const reproduced = composedManifestRefId === manifestRefId && judgedLineCount === 0;', replace: 'const reproduced = composedManifestRefId === manifestRefId;' },
];

harness.section('BASELINE — the real evidence readers pass every conjunct');
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId]([]);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});
harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a reader double (in memory)');
harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), Object.keys(conjunctJudgeByRefId).sort().join(','));
TWIN_LIST.forEach((oneTwin) => {
	const verdict = conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }]);
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
});
fs.rmSync(scratchDir, { recursive: true, force: true });
harness.report();
