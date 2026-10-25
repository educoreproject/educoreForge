#!/usr/bin/env node
'use strict';

// test-buildRetention.js — gate for EC4 (build-store economy, VELVET_RIDGE for BRONZE_CROWN, 2026-10-25): automatic retention of a
// campaign's build stores (lib/build-retention.js, tools/retainBuilds.js). Hermetic: a fixture campaign under the OS temp directory.
//
// PROVES:
//   (a) a rehearsal store nothing keeps is listed DELETE with its allocated size, and applying deletes it and its -wal/-shm ONLY:
//       its log, buildRequest.json, buildLogs/ and forensics/ survive, and a retention record is written
//   (b) a .buildOfRecord marker (in the directory or an ancestor) keeps a store
//   (c) a gate report naming the build directory keeps it
//   (d) a run log beside the directory naming a promoted graph (GOLD_EVAL_ and six digits) keeps it
//   (e) a judgment cache holding a judgment the store of record lacks is kept (a fold still needs it); one whose every judgment
//       the store of record holds is not
//   (f) a store under a 'backup' path segment is REFUSED by name and never touched
//   (g) a store a live process holds open is REFUSED by name (lsof)
//   (h) the reference a kept delta reads through is kept
//   (i) a campaign directory that is a backup, that contains the P-a1 baseline, or that lies inside it, is refused whole
//   (j) the CLI's dry run (no --apply) deletes nothing, and --apply=<anything but true> is refused by name
// RED TWINS: markerIgnored (b), gateReportIgnored (c), promotionIgnored (d), foldNeedIgnored (e), backupNotRefused (f),
// openNotRefused (g), referenceNotKept (h), wholeRunUnguarded (i), directoryDeleted (a).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: EC4 build-store retention keeps what must be kept and deletes only rehearsal stores
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Hermetic: a fixture campaign under the OS temp directory; the CLI conjunct reads graphBuilder.ini's [stores] for its stores
     of record and deletes nothing.
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { loadWithMutations } = require('../../../lib/forge-framework/test/testSupport/moduleDouble');

const RETENTION_PATH = path.join(__dirname, '..', 'lib', 'build-retention.js');
const TOOL_PATH = path.join(__dirname, '..', 'tools', 'retainBuilds.js');
const retentionFor = (mutationList) => (mutationList.length === 0 ? require(RETENTION_PATH) : loadWithMutations({ modulePath: RETENTION_PATH, mutationList }));

const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'edfBuildRetention-'));
let scratchSequence = 0;
const writeFile = (filePath, text) => {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, text);
};
const makeStore = (filePath, { judgmentPromptList = [], stampReferenceFilePath } = {}) => {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const connection = new Database(filePath);
	connection.pragma('journal_mode = WAL');
	connection.exec('CREATE TABLE IF NOT EXISTS blocks (refId TEXT PRIMARY KEY, text TEXT)');
	connection.prepare('INSERT OR IGNORE INTO blocks (refId, text) VALUES (?, ?)').run(path.basename(path.dirname(filePath)), 'x'.repeat(5000));
	if (judgmentPromptList.length > 0) {
		connection.exec('CREATE TABLE IF NOT EXISTS judgmentCacheEntries (seq INTEGER PRIMARY KEY AUTOINCREMENT, promptHash TEXT, model TEXT, rendererVersion TEXT, judgmentJson TEXT)');
		judgmentPromptList.forEach((promptHash) => connection.prepare(`INSERT INTO judgmentCacheEntries (promptHash, model, rendererVersion, judgmentJson) VALUES (?, 'gateModel', 'gateRenderer', '{}')`).run(promptHash));
	}
	if (stampReferenceFilePath) {
		connection.exec('CREATE TABLE storeReferenceStamps (familyName TEXT PRIMARY KEY, referenceDatabaseFilePath TEXT NOT NULL, referenceRowCountAtStamp INTEGER NOT NULL, referenceMaxSequenceAtStamp INTEGER, stampedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
		connection.prepare(`INSERT INTO storeReferenceStamps (familyName, referenceDatabaseFilePath, referenceRowCountAtStamp) VALUES ('standardsDatabase', ?, 1)`).run(stampReferenceFilePath);
	}
	return connection;
};

// buildCampaign — the fixture: one campaign directory holding every kind of build, plus a store of record and a P-a1 baseline OUTSIDE it
const buildCampaign = () => {
	scratchSequence += 1;
	const rootPath = path.join(scratchRootPath, `case${scratchSequence}`);
	const campaignDirPath = path.join(rootPath, 'campaign');
	const openConnectionList = [];
	const keepOpen = (connection) => openConnectionList.push(connection);
	keepOpen(makeStore(path.join(campaignDirPath, 'laneA', 'builds', 'rehearsal', 'standards.sqlite3')));
	writeFile(path.join(campaignDirPath, 'laneA', 'builds', 'rehearsal', 'build.log'), 'a rehearsal build log\n');
	writeFile(path.join(campaignDirPath, 'laneA', 'builds', 'rehearsal', 'buildRequest.json'), '{}\n');
	writeFile(path.join(campaignDirPath, 'laneA', 'builds', 'rehearsal', 'buildLogs', 'run', 'spendLedger.json'), '{}\n');
	writeFile(path.join(campaignDirPath, 'laneA', 'builds', 'rehearsal', 'forensics', 'match.jsonl'), '{}\n');
	keepOpen(makeStore(path.join(campaignDirPath, 'laneA', 'builds', 'ofRecord', 'standards.sqlite3')));
	writeFile(path.join(campaignDirPath, 'laneA', 'builds', 'ofRecord', '.buildOfRecord'), 'A1 build of record (GATEREPORT-A1)\n');
	keepOpen(makeStore(path.join(campaignDirPath, 'laneB', 'named', 'standards.sqlite3')));
	keepOpen(makeStore(path.join(campaignDirPath, 'laneB', 'promoted', 'standards.sqlite3')));
	writeFile(path.join(campaignDirPath, 'laneB', 'promoted.run.log'), 'kept as GOLD_EVAL_261025_wave3\n');
	keepOpen(makeStore(path.join(campaignDirPath, 'laneC', 'unfolded', 'judgmentCache.sqlite3'), { judgmentPromptList: ['heldPrompt', 'novelPrompt'] }));
	keepOpen(makeStore(path.join(campaignDirPath, 'laneC', 'folded', 'judgmentCache.sqlite3'), { judgmentPromptList: ['heldPrompt'] }));
	keepOpen(makeStore(path.join(campaignDirPath, 'laneD', 'preFoldBackup', 'standards.sqlite3')));
	keepOpen(makeStore(path.join(campaignDirPath, 'laneE', 'reference', 'standards.sqlite3')));
	keepOpen(makeStore(path.join(campaignDirPath, 'laneE', 'delta', 'standards.sqlite3'), { stampReferenceFilePath: path.join(campaignDirPath, 'laneE', 'reference', 'standards.sqlite3') }));
	writeFile(path.join(campaignDirPath, 'laneE', 'delta', '.buildOfRecord'), 'E1 delta build of record\n');
	keepOpen(makeStore(path.join(campaignDirPath, 'laneF', 'busy', 'standards.sqlite3')));
	const gateReportPath = path.join(rootPath, 'GATEREPORT-B.md');
	writeFile(gateReportPath, `the build of record is ${path.join(campaignDirPath, 'laneB', 'named')}\n`);
	const storeOfRecordFilePath = path.join(rootPath, 'record', 'graphBuilderSupport.sqlite');
	keepOpen(makeStore(storeOfRecordFilePath, { judgmentPromptList: ['heldPrompt'] }));
	const pa1BaselineDirectoryPath = path.join(rootPath, 'pa1baseline');
	fs.mkdirSync(pa1BaselineDirectoryPath);
	// every fixture connection is closed (their -wal/-shm stay); only laneF/busy is held open, by a child process
	openConnectionList.forEach((connection) => connection.close());
	// a closed WAL connection checkpoints and removes its -wal/-shm; a build's store keeps them, so the rehearsal gets them back
	['-wal', '-shm'].forEach((suffix) => writeFile(path.join(campaignDirPath, 'laneA', 'builds', 'rehearsal', `standards.sqlite3${suffix}`), 'companion'));
	return { rootPath, campaignDirPath, gateReportPath, storeOfRecordFilePath, pa1BaselineDirectoryPath, busyFilePath: path.join(campaignDirPath, 'laneF', 'busy', 'standards.sqlite3') };
};

// holdOpen — a child process that keeps a file open until killed (what a live build looks like to lsof)
const holdOpen = (filePath, onReady) => {
	const child = spawn(process.execPath, ['-e', `const fd = require('fs').openSync(${JSON.stringify(filePath)}, 'r'); process.stdout.write('open\\n'); setInterval(() => fd, 1000);`], { stdio: ['ignore', 'pipe', 'ignore'] });
	child.stdout.once('data', () => onReady(child));
	return child;
};
const lsofOpenFilePathSetFor = (filePathList, callback) => {
	const lsofRun = spawnSync('lsof', ['-F', 'n', '--'].concat(filePathList), { encoding: 'utf8' });
	callback('', new Set(String(lsofRun.stdout || '').split('\n').filter((oneLine) => oneLine.startsWith('n')).map((oneLine) => oneLine.slice(1))));
};
const planFor = (retention, fixture, extra, callback) =>
	retention.planRetention(
		{ campaignDirPath: fixture.campaignDirPath, gateReportPathList: [fixture.gateReportPath], foldTargetFilePathByTableName: { judgmentCacheEntries: fixture.storeOfRecordFilePath }, storeOfRecordFilePathList: [fixture.storeOfRecordFilePath], pa1BaselineDirectoryPath: fixture.pa1BaselineDirectoryPath, openFilePathSetFor: lsofOpenFilePathSetFor, ...extra },
		callback,
	);
const verdictOf = (plan, relativeDirPath) => {
	const found = plan.storeList.find((oneStore) => oneStore.dirPath.endsWith(relativeDirPath));
	return found ? `${found.verdict}: ${found.reasonList.join(' | ')}` : 'NOT LISTED';
};

// verdictConjunct — plan the fixture (with laneF/busy held open) and judge one store's verdict
const verdictConjunct = (relativeDirPath, expectedPattern) => (mutationList, done) => {
	const fixture = buildCampaign();
	holdOpen(fixture.busyFilePath, (child) => {
		planFor(retentionFor(mutationList), fixture, {}, (planErr, plan) => {
			child.kill();
			if (planErr) {
				done({ pass: false, detail: `plan refused: ${planErr}` });
				return;
			}
			const verdictText = verdictOf(plan, relativeDirPath);
			done({ pass: expectedPattern.test(verdictText), detail: `${relativeDirPath} -> ${verdictText}` });
		});
	});
};

const conjunctJudgeByRefId = {
	a_rehearsalDeletedLogsSurvive: (mutationList, done) => {
		const fixture = buildCampaign();
		const retention = retentionFor(mutationList);
		holdOpen(fixture.busyFilePath, (child) => {
			planFor(retention, fixture, {}, (planErr, plan) => {
				if (planErr) {
					child.kill();
					done({ pass: false, detail: `plan refused: ${planErr}` });
					return;
				}
				const rehearsalDirPath = path.join(fixture.campaignDirPath, 'laneA', 'builds', 'rehearsal');
				const rehearsal = plan.storeList.find((oneStore) => oneStore.dirPath === rehearsalDirPath);
				const companionCount = rehearsal ? rehearsal.companionFilePathList.length : -1;
				const retentionRecordFilePath = path.join(fixture.campaignDirPath, 'retentionRecord-gate.json');
				retention.applyRetention({ plan, openFilePathSetFor: lsofOpenFilePathSetFor, retentionRecordFilePath }, (applyErr, applied) => {
					child.kill();
					const survivorList = ['build.log', 'buildRequest.json', path.join('buildLogs', 'run', 'spendLedger.json'), path.join('forensics', 'match.jsonl')].filter((relativePath) => fs.existsSync(path.join(rehearsalDirPath, relativePath)));
					const storeGone = ['standards.sqlite3', 'standards.sqlite3-wal', 'standards.sqlite3-shm'].every((fileName) => !fs.existsSync(path.join(rehearsalDirPath, fileName)));
					const deleteVerdictList = plan.storeList.filter((oneStore) => oneStore.verdict === 'DELETE').map((oneStore) => path.relative(fixture.campaignDirPath, oneStore.dirPath));
					const othersIntact = plan.storeList.filter((oneStore) => oneStore.verdict !== 'DELETE').every((oneStore) => fs.existsSync(oneStore.filePath));
					done({
						pass: !applyErr && rehearsal && rehearsal.verdict === 'DELETE' && rehearsal.allocatedBytes > 0 && companionCount === 2 && storeGone && survivorList.length === 4 && othersIntact && fs.existsSync(retentionRecordFilePath) && JSON.stringify(deleteVerdictList.sort()) === JSON.stringify(['laneA/builds/rehearsal', 'laneC/folded']),
						detail: `DELETE ${deleteVerdictList.join(', ')}; rehearsal ${rehearsal ? `${rehearsal.allocatedBytes} bytes, ${companionCount} companion(s)` : 'NOT LISTED'}; after apply: store gone ${storeGone}, survivors ${survivorList.length}/4, kept stores intact ${othersIntact}, record ${fs.existsSync(retentionRecordFilePath)}${applyErr ? `; ERROR ${applyErr}` : ` (deleted ${applied.deletedCount})`}`,
					});
				});
			});
		});
	},
	b_markerKeeps: verdictConjunct(path.join('laneA', 'builds', 'ofRecord'), /^KEEP: build of record \(marker /),
	c_gateReportKeeps: verdictConjunct(path.join('laneB', 'named'), /^KEEP: named by gate report /),
	d_promotionKeeps: verdictConjunct(path.join('laneB', 'promoted'), /^KEEP: a promoted graph is named in .*promoted\.run\.log/),
	e_foldNeedKeeps: verdictConjunct(path.join('laneC', 'unfolded'), /^KEEP: holds 1 judgment\(s\) the store of record .* lacks: fold first/),
	f_backupRefused: verdictConjunct(path.join('laneD', 'preFoldBackup'), /^REFUSED: is a backup \(path segment 'preFoldBackup'\)/),
	g_openRefused: verdictConjunct(path.join('laneF', 'busy'), /^REFUSED: held open by a live process/),
	h_deltaReferenceKept: verdictConjunct(path.join('laneE', 'reference'), /^KEEP: the reference the kept delta .* reads through/),
	i_protectedCampaignRefusedWhole: (mutationList, done) => {
		const retention = retentionFor(mutationList);
		const fixture = buildCampaign();
		const backupCampaignDirPath = path.join(fixture.rootPath, 'campaignBackup');
		fs.mkdirSync(backupCampaignDirPath);
		const insideBaselineDirPath = path.join(fixture.pa1BaselineDirectoryPath, 'inner');
		fs.mkdirSync(insideBaselineDirPath);
		const caseList = [
			{ caseName: 'a backup directory', extra: { campaignDirPath: backupCampaignDirPath }, pattern: /REFUSED — the campaign directory .* is a backup/ },
			{ caseName: 'contains the P-a1 baseline', extra: { campaignDirPath: fixture.rootPath }, pattern: /REFUSED — the campaign directory .* contains the P-a1 baseline/ },
			{ caseName: 'inside the P-a1 baseline', extra: { campaignDirPath: insideBaselineDirPath }, pattern: /REFUSED — the campaign directory .* is the P-a1 baseline/ },
		];
		const resultList = [];
		const nextCase = (caseIndex) => {
			if (caseIndex >= caseList.length) {
				done({ pass: resultList.every((oneResult) => oneResult.ok), detail: resultList.map((oneResult) => `${oneResult.caseName}: ${oneResult.text.slice(0, 140)}`).join(' | ') });
				return;
			}
			const oneCase = caseList[caseIndex];
			planFor(retention, fixture, oneCase.extra, (planErr) => {
				resultList.push({ caseName: oneCase.caseName, ok: oneCase.pattern.test(String(planErr)), text: planErr || 'PLANNED' });
				nextCase(caseIndex + 1);
			});
		};
		nextCase(0);
	},
	j_cliDryRunDeletesNothing: (mutationList, done) => {
		const fixture = buildCampaign();
		const storeCountBefore = fs.readdirSync(path.join(fixture.campaignDirPath, 'laneA', 'builds', 'rehearsal')).length;
		const dryRun = spawnSync(process.execPath, [TOOL_PATH, `--campaignDirPath=${fixture.campaignDirPath}`], { encoding: 'utf8' });
		const badApply = spawnSync(process.execPath, [TOOL_PATH, `--campaignDirPath=${fixture.campaignDirPath}`, '--apply=yes'], { encoding: 'utf8' });
		const storeCountAfter = fs.readdirSync(path.join(fixture.campaignDirPath, 'laneA', 'builds', 'rehearsal')).length;
		const dryRunText = `${dryRun.stdout}${dryRun.stderr}`;
		done({ pass: dryRun.status === 0 && /DRY RUN: nothing is deleted/.test(dryRunText) && /DELETE .*rehearsal\/standards\.sqlite3/.test(dryRunText) && storeCountAfter === storeCountBefore && badApply.status === 1 && /--apply must be 'true' when given \(got 'yes'\)/.test(`${badApply.stdout}${badApply.stderr}`), detail: `dry run exit ${dryRun.status}; files in rehearsal ${storeCountBefore} -> ${storeCountAfter}; --apply=yes exit ${badApply.status}: ${`${badApply.stderr}`.split('\n')[0].slice(0, 120)}` });
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_rehearsalDeletedLogsSurvive', twinName: 'directoryDeleted', mutationList: [{ modulePath: RETENTION_PATH, find: 'storeFilePathList.forEach((oneFilePath) => fs.rmSync(oneFilePath, { force: true }))', replace: 'fs.rmSync(path.dirname(oneStore.filePath), { recursive: true, force: true })' }] },
	{ conjunctRefId: 'b_markerKeeps', twinName: 'markerIgnored', mutationList: [{ modulePath: RETENTION_PATH, find: '			if (markerPath) {', replace: '			if (false) {' }] },
	{ conjunctRefId: 'c_gateReportKeeps', twinName: 'gateReportIgnored', mutationList: [{ modulePath: RETENTION_PATH, find: '			if (namingReport) {', replace: '			if (false) {' }] },
	{ conjunctRefId: 'd_promotionKeeps', twinName: 'promotionIgnored', mutationList: [{ modulePath: RETENTION_PATH, find: '			if (promotionFilePath) {', replace: '			if (false) {' }] },
	{ conjunctRefId: 'e_foldNeedKeeps', twinName: 'foldNeedIgnored', mutationList: [{ modulePath: RETENTION_PATH, find: '.filter((oneCount) => oneCount.rowCount > 0 && (oneCount.unfoldedCount === null || oneCount.unfoldedCount > 0))', replace: '.filter(() => false)' }] },
	{ conjunctRefId: 'f_backupRefused', twinName: 'backupNotRefused', mutationList: [{ modulePath: RETENTION_PATH, find: '	if (backupSegment) {', replace: '	if (false) {' }] },
	{ conjunctRefId: 'g_openRefused', twinName: 'openNotRefused', mutationList: [{ modulePath: RETENTION_PATH, find: "openPath ? `held open by a live process ('${path.basename(openPath)}')` : ''", replace: "''" }] },
	{ conjunctRefId: 'h_deltaReferenceKept', twinName: 'referenceNotKept', mutationList: [{ modulePath: RETENTION_PATH, find: 'if (referencedStore && !keptRealPathSet.has(referenceRealPath)) {', replace: 'if (false) {' }] },
	{ conjunctRefId: 'i_protectedCampaignRefusedWhole', twinName: 'wholeRunUnguarded', mutationList: [{ modulePath: RETENTION_PATH, find: 'if (campaignProtection || isUnder(pa1BaselineRealPath, realPathOf(absoluteCampaignDirPath))) {', replace: 'if (false) {' }] },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => setImmediate(() => nextStep(stepIndex + 1))));
	nextStep(0);
};
harness.section('BASELINE — the real retention passes every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); harness.note(`${oneRefId}: ${verdict.detail}`); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED (build-retention.js compiled in memory with one named mutation)');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) => {
				conjunctJudgeByRefId[oneTwin.conjunctRefId](oneTwin.mutationList, (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
					stepDone();
				});
			}),
			() => {
				fs.rmSync(scratchRootPath, { recursive: true, force: true });
				harness.report();
			},
		);
	},
);
