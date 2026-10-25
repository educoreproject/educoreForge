#!/usr/bin/env node
'use strict';

// test-deltaPromotionRefusal.js — gate for BRONZE_CROWN's EC ruling (2026-10-25): golds come only from a store of record or a folded store,
// so -goldEvalCheck and -stampPromotion REFUSE BY NAME a store stamped as an unfolded DELTA (lib/store-reference).
//
// PROVES:
//   (a) -goldEvalCheck --standardsDatabaseFilePath=<a delta> is refused by name, naming the delta and its reference, before it reads anything
//       else; the same flag naming a STANDALONE store is not refused for being a delta (it goes on to its own next refusal)
//   (b) -stampPromotion whose -goldEvalCheck evidence certified a delta (its certificate's standardsDatabaseFilePath) is refused by name
//       before any container is touched; evidence certifying a standalone store is not refused for it
// RED TWINS: goldEvalCheckUnguarded (a), stampPromotionUnguarded (b) — actions.js compiled in memory with its check removed.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: -goldEvalCheck and -stampPromotion refuse an unfolded delta store by name
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Hermetic: two throwaway stores (a delta, stamped, and a standalone one) under the OS temp directory; no container, no graph.
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DRIVER_PATH = path.join(__dirname, 'testSupport', 'deltaPromotionRefusalDriver.js');
const storeReference = require('../../../lib/store-reference/store-reference');
const standardsDatabaseModule = require('../../../lib/standards-database/standards-database');

const scratchDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'edfDeltaPromotion-'));
const referenceFilePath = path.join(scratchDirPath, 'record.sqlite3');
const deltaFilePath = path.join(scratchDirPath, 'delta.sqlite3');
const standaloneFilePath = path.join(scratchDirPath, 'standalone.sqlite3');
const evidenceFilePathFor = (certifiedFilePath) => {
	const evidenceFilePath = path.join(scratchDirPath, `goldEvalCheck-${path.basename(certifiedFilePath)}.log`);
	fs.writeFileSync(evidenceFilePath, `graphBuilder: [goldEvalCheck] PASS — fixture\n{ "bridgeSibling": { "standardsDatabaseFilePath": "${certifiedFilePath}" } }\n`);
	return evidenceFilePath;
};
const placeholderFilePath = path.join(scratchDirPath, 'placeholder.log');
fs.writeFileSync(placeholderFilePath, 'fixture\n');

const runDriver = (argumentList) => {
	const driverRun = spawnSync(process.execPath, [DRIVER_PATH, ...argumentList, '-quiet'], { encoding: 'utf8' });
	const jsonLine = String(driverRun.stdout || '').split('\n').find((oneLine) => oneLine.startsWith('{'));
	return jsonLine ? JSON.parse(jsonLine).actionError : `the driver printed no result: ${String(driverRun.stderr).slice(0, 300)}`;
};
const DELTA_REFUSAL_PATTERN = /REFUSED — '.*delta\.sqlite3' is an UNFOLDED DELTA of '.*record\.sqlite3' \(standardsDatabase\)/;

const conjunctJudgeByRefId = {
	a_goldEvalCheckRefusesDelta: (twinArgumentList) => {
		const deltaError = runDriver(['--actionName=goldEvalCheck', `--standardsDatabaseFilePath=${deltaFilePath}`, ...twinArgumentList]);
		const standaloneError = runDriver(['--actionName=goldEvalCheck', `--standardsDatabaseFilePath=${standaloneFilePath}`, ...twinArgumentList]);
		return { pass: DELTA_REFUSAL_PATTERN.test(deltaError) && !/UNFOLDED DELTA/.test(standaloneError) && /--buildLogDirPath/.test(standaloneError), detail: `delta: ${deltaError.slice(0, 200)} | standalone: ${standaloneError.slice(0, 120)}` };
	},
	b_stampPromotionRefusesDelta: (twinArgumentList) => {
		const commonList = ['--actionName=stampPromotion', '--containerName=GOLD_EVAL_000000_gateFixture', `--replayLogPath=${placeholderFilePath}`, `--reforgeEvidencePath=${placeholderFilePath}`, ...twinArgumentList];
		const deltaError = runDriver([...commonList, `--goldEvalCheckLogPath=${evidenceFilePathFor(deltaFilePath)}`]);
		const standaloneError = runDriver([...commonList, `--goldEvalCheckLogPath=${evidenceFilePathFor(standaloneFilePath)}`]);
		return { pass: DELTA_REFUSAL_PATTERN.test(deltaError) && !/UNFOLDED DELTA/.test(standaloneError), detail: `delta-certified evidence: ${deltaError.slice(0, 200)} | standalone-certified: ${standaloneError.slice(0, 140)}` };
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'a_goldEvalCheckRefusesDelta', twinName: 'goldEvalCheckUnguarded' },
	{ conjunctRefId: 'b_stampPromotionRefusesDelta', twinName: 'stampPromotionUnguarded' },
];

// the fixture: a store of record, a delta stamped over it, and a standalone store (both through their real modules)
standardsDatabaseModule().open({ databaseFilePath: referenceFilePath }, (referenceErr) => {
	standardsDatabaseModule().open({ databaseFilePath: standaloneFilePath }, (standaloneErr) => {
		storeReference.stampReference({ familyName: 'standardsDatabase', databaseFilePath: deltaFilePath, referenceDatabaseFilePath: referenceFilePath }, (stampErr) => {
			setImmediate(() => {
				harness.ok('the fixture stores were made', !referenceErr && !standaloneErr && !stampErr, `${referenceErr} ${standaloneErr} ${stampErr}`);
				harness.section('BASELINE — the real actions refuse an unfolded delta');
				Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
					const verdict = conjunctJudgeByRefId[oneRefId]([]);
					harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
					harness.note(`${oneRefId}: ${verdict.detail}`);
				});
				harness.section('THE TWIN SWEEP — each twin OBSERVED RED (actions.js compiled in memory with its check removed)');
				TWIN_LIST.forEach((oneTwin) => {
					const verdict = conjunctJudgeByRefId[oneTwin.conjunctRefId]([`--twinName=${oneTwin.twinName}`]);
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
				});
				fs.rmSync(scratchDirPath, { recursive: true, force: true });
				harness.report();
			});
		});
	});
});
