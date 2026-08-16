#!/usr/bin/env node
'use strict';

// runBridgeAcceptanceCommand.js — the BRIDGE acceptance RUNNER (SPEC-bridgeFramework-v1.md §7.4 "the frozen command",
// §12 BG-ACCEPT; RULINGS R1, 12:05 #3; the B3 freeze ruling Q3): runs ONE frozen line from
// lib/bridge-framework/test/acceptance/acceptanceCommands.jsonc for a bridgeName (rejudgeDebug | materialise |
// materialiseReal) and a phase token, EXACTLY as committed (the runner reproduces the committed line token for token
// and refuses on drift), nohup-detached with its PID and log; and, with -verify, reads that log back and asserts the
// COMMAND'S CONTRACT: every base block the run reused or re-forged carries the id the acceptance file pins
// (expectedBaseBlockIdBySubject — RULING Q3: reuse with the pinned store is accepted ONLY on this assertion), and
// reports the decision block id, the manifest id, the container and the bolt url the log names. Mirrors
// lib/forge-framework/test/acceptance/runAcceptanceCommand.js.
//
// The materialiseReal line SPENDS (the real judge over the judged share): the runner REFUSES it by name unless the
// acceptance file records materialiseRealSpendAuthorisedBy (the supervisor's authorisation, as data).
//
// Run (from anywhere):
//   node apps/graph-builder/test/bridgeAcceptance/runBridgeAcceptanceCommand.js --bridgeName=edfiCedsCrosswalkPlugin --line=rejudgeDebug --phaseToken=cp2a
//   node apps/graph-builder/test/bridgeAcceptance/runBridgeAcceptanceCommand.js -verify --bridgeName=edfiCedsCrosswalkPlugin --line=rejudgeDebug --phaseToken=cp2a

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- run (or -verify) ONE frozen bridge acceptance line with a git-provenance sidecar beside its log

SYNOPSIS
     ${moduleName} --bridgeName=<plugin> --line=<rejudgeDebug|materialise|materialiseReal> --phaseToken=<token>
     ${moduleName} -verify --bridgeName=<plugin> --line=<line> --phaseToken=<token>

DESCRIPTION
     Reads lib/bridge-framework/test/acceptance/acceptanceCommands.jsonc, substitutes <line>/<phase>, asserts the
     runner's line EQUALS the committed one, writes <buildLogsDirPath>/<line>-<phase>.provenance.json (git HEAD, dirty
     list, the exact command line, start time, PID), launches the build nohup-detached and returns. -verify reads the
     finished log and asserts the pinned base block ids (the command's contract), then prints the run's ids.
     materialiseReal is REFUSED unless the acceptance file records materialiseRealSpendAuthorisedBy.

EXIT
     0 launched / verified;  1 refused by name / verification failed.
`;

const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const { xLog } = process.global;
const verifyLogContractLib = require('./verifyLogContract');

const ACCEPTANCE_FILE_PATH = path.join(__dirname, '..', '..', '..', '..', 'lib', 'bridge-framework', 'test', 'acceptance', 'acceptanceCommands.jsonc');
const EXPECTED_IDS_FILE_PATH = path.join(__dirname, '..', '..', '..', '..', 'lib', 'bridge-framework', 'test', 'acceptance', 'expectedDecisionBlockIds.json');
const LINE_NAME_LIST = Object.freeze(['rejudgeDebug', 'materialise', 'materialiseReal']);

const stripJsoncComments = (text) => text.replace(/^\s*\/\/.*$/gm, '');
const acceptanceCommands = JSON.parse(stripJsoncComments(fs.readFileSync(ACCEPTANCE_FILE_PATH, 'utf8')));

const refuse = (what) => {
	xLog.error(`${moduleName} REFUSED: ${what}`);
	process.exit(1);
};
const firstValue = (name) => (commandLineParameters.values[name] && commandLineParameters.values[name][0]) || undefined;

const bridgeName = firstValue('bridgeName');
if (!acceptanceCommands[bridgeName] || typeof acceptanceCommands[bridgeName] !== 'object') {
	refuse(`--bridgeName must be one of ${Object.keys(acceptanceCommands).join(', ')} (got ${JSON.stringify(bridgeName)})`);
}
const entry = acceptanceCommands[bridgeName];
const lineName = firstValue('line');
if (LINE_NAME_LIST.indexOf(lineName) === -1) {
	refuse(`--line must be one of ${LINE_NAME_LIST.join(', ')} (got ${JSON.stringify(lineName)})`);
}
if (typeof entry[lineName] !== 'string' || entry[lineName].length === 0) {
	refuse(`acceptanceCommands.jsonc has no frozen '${lineName}' line for ${bridgeName} (null-and-honest until the builder freezes it)`);
}
const phaseToken = firstValue('phaseToken');
if (typeof phaseToken !== 'string' || !/^[A-Za-z0-9_-]+$/.test(phaseToken)) {
	refuse(`--phaseToken must be a token of [A-Za-z0-9_-] (got ${JSON.stringify(phaseToken)})`);
}
if (lineName === 'materialiseReal' && !(entry.materialiseRealSpendAuthorisedBy && typeof entry.materialiseRealSpendAuthorisedBy === 'object' && typeof entry.materialiseRealSpendAuthorisedBy.sessionName === 'string')) {
	refuse(`the materialiseReal line SPENDS on the real judge and acceptanceCommands.jsonc records no materialiseRealSpendAuthorisedBy for ${bridgeName} — the supervisor authorises the spend as data before this line runs`);
}

const committedLine = entry[lineName].replace(/<line>/g, lineName).replace(/<phase>/g, phaseToken);
const buildLogPath = path.join(entry.buildLogsDirPath, `${lineName}-${phaseToken}.log`);
const treeRoot = path.join(__dirname, '..', '..', '..', '..');

// the runner's own composition of the line, asserted EQUAL to the committed text (data over drift)
if (typeof entry.standardKey !== 'string' || entry.standardKey.length === 0) {
	refuse(`acceptanceCommands.jsonc entry for ${bridgeName} carries no standardKey (the --rebridge scope token) — declare it as data`);
}
const lineSpecificArgumentList = { rejudgeDebug: [`--rebridge=${entry.standardKey}`, '--useDebugJudge=digest'], materialise: [], materialiseReal: [`--rebridge=${entry.standardKey}`] };
const nodeArgumentList = [
	'--max-old-space-size=20000',
	path.join(treeRoot, 'apps', 'graph-builder', 'graphBuilder.js'),
	'-build',
	`--recipePath=${entry.recipePath}`,
	'--vectorize=true',
	'--reuseForgedBlocks=true',
	`--standardsDatabaseFilePath=${entry.storeFilePath}`,
	`--decisionStoreFilePath=${entry.decisionStoreFilePath}`,
	`--judgmentCacheFilePath=${entry.judgmentCacheFilePath}`,
	`--matchForensicsDirPath=${entry.matchForensicsDirPath}`,
	'--embeddingCacheFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3',
].concat(lineSpecificArgumentList[lineName]);
const runnerLine = `node ${nodeArgumentList.join(' ')} </dev/null > ${buildLogPath} 2>&1 &`;
if (runnerLine !== committedLine) {
	refuse(`the runner's command line differs from the committed frozen '${lineName}' line for ${bridgeName}:\n  committed: ${committedLine}\n  runner:    ${runnerLine}`);
}

// ---------------------------------------------------------------------
// -verify — read the finished log; assert the pinned base ids; report the run's ids
// ---------------------------------------------------------------------
if (commandLineParameters.switches.verify === true) {
	if (!fs.existsSync(buildLogPath)) {
		refuse(`no log at ${buildLogPath} — nothing to verify`);
	}
	const logText = fs.readFileSync(buildLogPath, 'utf8');
	const expectedIds = JSON.parse(fs.readFileSync(EXPECTED_IDS_FILE_PATH, 'utf8')).byBridgeName[bridgeName] || {};
	// RULING BR3-3 — the contract check is the PURE verifyLogContract (gated by test-bridgeAcceptanceEdfi SECTION 4):
	// buildFailed is a FAULT; an absent/empty pin table is a REFUSAL by name; the runner only reads and prints
	const checked = verifyLogContractLib.verifyLogContract({ logText, entry, lineName, expectedIds });
	if (checked.refusal) {
		refuse(checked.refusal);
	}
	const verdict = { bridgeName, lineName, phaseToken, buildLogPath, ...checked.verdict, faultList: checked.faultList };
	xLog.result(JSON.stringify(verdict, null, 2));
	if (checked.faultList.length) {
		refuse(`${checked.faultList.length} contract fault(s):\n  - ${checked.faultList.join('\n  - ')}`);
	}
	xLog.status(`${moduleName}: VERIFIED — every pinned base id reproduced (${verdict.pinnedSubjectCount} subjects); the build reported no failure${verdict.decisionBlockId ? `; decision block ${verdict.decisionBlockId.slice(0, 12)}…` : ''}`);
	process.exit(0);
}

// ---------------------------------------------------------------------
// launch — nohup-detached, PID + provenance sidecar beside the log
// ---------------------------------------------------------------------
if (!fs.existsSync(entry.storeFilePath)) {
	refuse(`the pinned store '${entry.storeFilePath}' is not on disk — the frozen line runs against the pinned store only`);
}
if (fs.existsSync(buildLogPath)) {
	refuse(`'${buildLogPath}' already exists — a frozen run never overwrites a recorded log; choose another phaseToken`);
}
const gitOutput = (argumentList) => {
	const result = spawnSync('git', argumentList, { cwd: treeRoot, encoding: 'utf8' });
	if (result.status !== 0) {
		refuse(`git ${argumentList.join(' ')} failed in ${treeRoot}: ${(result.stderr || '').trim()}`);
	}
	return result.stdout.trim();
};
const gitHead = gitOutput(['rev-parse', 'HEAD']);
const gitDirtyFileList = gitOutput(['status', '--porcelain']).split('\n').filter((oneLine) => oneLine.length > 0);
fs.mkdirSync(entry.buildLogsDirPath, { recursive: true });
const startedAt = new Date().toISOString();
const child = spawn('node', nodeArgumentList, { cwd: treeRoot, detached: true, stdio: ['ignore', fs.openSync(buildLogPath, 'a'), fs.openSync(buildLogPath, 'a')] });
child.unref();
fs.writeFileSync(path.join(entry.buildLogsDirPath, `${lineName}-${phaseToken}.pid`), `${child.pid}\n`);
fs.writeFileSync(path.join(entry.buildLogsDirPath, `${lineName}-${phaseToken}.provenance.json`), JSON.stringify({ bridgeName, lineName, phaseToken, gitHead, gitDirty: gitDirtyFileList.length > 0, gitDirtyFileList, commandLine: committedLine, startedAt, pid: child.pid, buildLogPath }, null, 2) + '\n');
xLog.status(`${moduleName}: launched ${bridgeName} ${lineName} (${phaseToken}) pid ${child.pid} at HEAD ${gitHead.slice(0, 7)}${gitDirtyFileList.length ? ` (DIRTY: ${gitDirtyFileList.length} file(s))` : ''} → ${buildLogPath}`);
process.exit(0);
