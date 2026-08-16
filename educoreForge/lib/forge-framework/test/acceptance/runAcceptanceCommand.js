#!/usr/bin/env node
'use strict';

// runAcceptanceCommand.js — the framework's ACCEPTANCE RUNNER (SPEC-forgeFramework-v1.md §9.2; ruling FB5
// 2026-08-16): runs ONE frozen line from acceptanceCommands.jsonc for a standardKey and a phase token, EXACTLY
// as committed (nohup-detached, PID + log under buildLogs/forgeFramework/<standardKey>-<phase>/), and writes a
// git-provenance sidecar `provenance.json` BESIDE build.log BEFORE the build starts:
//   { standardKey, phaseToken, gitHead, gitDirty, gitDirtyFileList, commandLine, treeRoot, startedAt, pid,
//     buildLogPath, standardsDatabasePath }
// so a recorded id can always be tied to the code that produced it (the reviewer had to prove it from a
// code-fingerprint line in the logs). graphBuilder itself is NOT touched (the seam) — provenance lives in the
// runner, beside the run.
//
// Refuses by name: an unknown standardKey / phaseToken, a scratch standardsDatabase already on disk (a frozen
// run never overwrites a recorded run), a missing tree root, git unavailable.
//
// Run (from anywhere): node lib/forge-framework/test/acceptance/runAcceptanceCommand.js --standardKey=edfi --phaseToken=migrated
//                      node lib/forge-framework/test/acceptance/runAcceptanceCommand.js --finalProof --phaseToken=postEdfi

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- run ONE frozen acceptance line (SPEC §9.2) with a git-provenance sidecar beside its log

SYNOPSIS
     ${moduleName} --standardKey=<edfi|sif|pesc260805|ceds> --phaseToken=<preMigration|migrated|...>
     ${moduleName} -finalProof --phaseToken=<label>       # the fourWithHub-baseline manifest proof

DESCRIPTION
     Reads acceptanceCommands.jsonc, substitutes <phase>, refuses if the scratch standardsDatabase already
     exists, writes buildLogs/forgeFramework/<standardKey>-<phase>/provenance.json (git HEAD, dirty flag and
     file list, the exact command line, start time, PID), then launches the build nohup-detached with its PID
     file and returns immediately. ONE-MACHINE-ONLY, licence-gated (Docker, Voyage, gitignored MetaEd bytes).

EXIT
     0 launched;  1 refused by name.
`;

const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const { xLog } = process.global;

const stripJsoncComments = (text) => text.replace(/^\s*\/\/.*$/gm, '');
const acceptanceCommands = JSON.parse(stripJsoncComments(fs.readFileSync(path.join(__dirname, 'acceptanceCommands.jsonc'), 'utf8')));
const treeRoot = acceptanceCommands.treeRoot;

const refuse = (what) => {
	xLog.error(`${moduleName} REFUSED: ${what}`);
	process.exit(1);
};

if (!fs.existsSync(treeRoot)) {
	refuse(`treeRoot '${treeRoot}' (acceptanceCommands.jsonc) is not on disk`);
}
const phaseToken = commandLineParameters.values.phaseToken && commandLineParameters.values.phaseToken[0];
if (typeof phaseToken !== 'string' || !/^[A-Za-z0-9_-]+$/.test(phaseToken)) {
	refuse(`--phaseToken must be a token of [A-Za-z0-9_-] (got ${JSON.stringify(phaseToken)}); the committed phase tokens are ${acceptanceCommands.phaseTokenList.join(', ')}`);
}
const isFinalProof = commandLineParameters.switches.finalProof === true;
const standardKey = isFinalProof ? 'fourWithHub' : commandLineParameters.values.standardKey && commandLineParameters.values.standardKey[0];
if (!isFinalProof && !acceptanceCommands.byStandardKey[standardKey]) {
	refuse(`--standardKey must be one of ${Object.keys(acceptanceCommands.byStandardKey).join(', ')} (got ${JSON.stringify(standardKey)}), or pass -finalProof`);
}

// the committed line, with <phase> substituted; the final proof takes the same frozen FORM as the per-forge line
const runLabel = `${standardKey}-${phaseToken}`;
const runDirPath = path.join(treeRoot, '..', '..', 'dataStores', 'buildLogs', 'forgeFramework', runLabel);
const buildLogPath = path.join(runDirPath, 'build.log');
const standardsDatabasePath = path.join(treeRoot, '..', '..', 'dataStores', 'graphBuilder', `forgeFramework_${standardKey}_${phaseToken}.standardsDatabase.sqlite3`);
const embeddingCachePath = path.join(treeRoot, '..', '..', 'dataStores', 'vectorCache', 'vectorCache.sqlite3');
const recipePath = isFinalProof ? acceptanceCommands.finalProof.recipePath : acceptanceCommands.byStandardKey[standardKey].recipePath;
const nodeArgumentList = [
	'--max-old-space-size=20000',
	'apps/graph-builder/graphBuilder.js',
	'-build',
	`--recipePath=${recipePath}`,
	'--vectorize=true',
	`--standardsDatabaseFilePath=${standardsDatabasePath}`,
	`--embeddingCacheFilePath=${embeddingCachePath}`,
];
const commandLine = `node ${nodeArgumentList.join(' ')} </dev/null > ${buildLogPath} 2>&1 &`;

if (!isFinalProof) {
	// the per-forge line is COMMITTED verbatim; assert this runner reproduces it token for token (data over drift)
	const committedLine = acceptanceCommands.byStandardKey[standardKey].command.replace(/<phase>/g, phaseToken);
	if (committedLine !== commandLine) {
		refuse(`the runner's command line differs from the committed frozen line for ${standardKey}:\n  committed: ${committedLine}\n  runner:    ${commandLine}`);
	}
}
if (fs.existsSync(standardsDatabasePath)) {
	refuse(`scratch standardsDatabase '${standardsDatabasePath}' already exists — a frozen run never overwrites a recorded run; choose another phaseToken or move the old database aside deliberately`);
}
if (fs.existsSync(buildLogPath)) {
	refuse(`'${buildLogPath}' already exists — a frozen run never overwrites a recorded log`);
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

fs.mkdirSync(runDirPath, { recursive: true });
const startedAt = new Date().toISOString();
const child = spawn('node', nodeArgumentList, {
	cwd: treeRoot,
	detached: true,
	stdio: ['ignore', fs.openSync(buildLogPath, 'a'), fs.openSync(buildLogPath, 'a')],
});
child.unref();
fs.writeFileSync(path.join(runDirPath, 'build.pid'), `${child.pid}\n`);
const provenance = {
	standardKey,
	phaseToken,
	recipePath,
	gitHead,
	gitDirty: gitDirtyFileList.length > 0,
	gitDirtyFileList,
	commandLine,
	treeRoot,
	startedAt,
	pid: child.pid,
	buildLogPath,
	standardsDatabasePath,
	writtenBy: moduleName,
};
fs.writeFileSync(path.join(runDirPath, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
xLog.status(`${moduleName}: launched ${runLabel} (pid ${child.pid}) at git ${gitHead.slice(0, 7)}${provenance.gitDirty ? ' DIRTY' : ''}; log ${buildLogPath}; provenance ${path.join(runDirPath, 'provenance.json')}`);
process.exit(0);
