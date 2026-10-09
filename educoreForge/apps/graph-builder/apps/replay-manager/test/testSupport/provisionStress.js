#!/usr/bin/env node
'use strict';

// provisionStress.js — ⟪lane FIX, 2026-10-09⟫ the stress instrument for scratch-container deaths at start (exit 64). It runs
// ROUNDS of CONCURRENCY provisions at once, each in its own PROCESS (provisionPortRaceChild.js: the REAL replayManager.create,
// then delete), and counts deaths with TWO instruments that do not share a code path:
//   * the children's own results: a create that failed, with its refusal text;
//   * `docker events`, STREAMED for the whole run: every 'die' of a container of this run, with its exit code. A container we
//     remove dies with 137 (rm -f kills it); ANY OTHER exit code is a death at start, named with the container.
// The gate (test-provisionPortRace (j)) requires zero of both; run alone, it is the red-evidence tool against another tree.
//
//   runProvisionStress({ roundCount, concurrency, purpose, childArgListFor, replayManagerPath }, callback)
//       -> callback('', { provisionCount, failedResultList, deathEventList, roundSummaryList })
//
// Run alone: node provisionStress.js --roundCount=<n> --concurrency=<n> --purpose=<letters> [--replayManagerPath=<path>]
//            prints one JSON line; exit 0 when no death was seen by either instrument, 1 otherwise.

const path = require('path');
const { execFile, spawn } = require('child_process');

const CHILD_PATH = path.join(__dirname, 'provisionPortRaceChild.js');
// the exit code of a container removed by `docker rm -f` (SIGKILL); every other 'die' exit code is a death we did not cause
const REMOVED_BY_US_EXIT_CODE = '137';

const runOneChild = ({ purpose, childArgList, replayManagerPath }, callback) => {
	const argList = [CHILD_PATH, '--pauseAfterSearchMs=0', `--purpose=${purpose}`, ...(replayManagerPath ? [`--replayManagerPath=${replayManagerPath}`] : []), ...childArgList, '-quiet'];
	execFile(process.execPath, argList, { encoding: 'utf8', timeout: 400000, maxBuffer: 16 * 1024 * 1024 }, (execErr, stdoutText) => {
		const jsonLine = String(stdoutText || '').split('\n').filter((oneLine) => oneLine.startsWith('{')).pop();
		callback(jsonLine ? JSON.parse(jsonLine) : { boltPort: null, error: `the child printed no result${execErr ? ` (${execErr.message})` : ''}` });
	});
};

const runRound = ({ roundIndex, concurrency, purpose, childArgListFor, replayManagerPath }, callback) => {
	const resultList = [];
	let finishedCount = 0;
	for (let childIndex = 0; childIndex < concurrency; childIndex++) {
		runOneChild({ purpose, childArgList: childArgListFor(roundIndex, childIndex), replayManagerPath }, (oneResult) => {
			resultList.push({ roundIndex, childIndex, ...oneResult });
			finishedCount += 1;
			if (finishedCount === concurrency) {
				callback(resultList);
			}
		});
	}
};

// the run's 'die' events, STREAMED from docker for the whole run: the daemon keeps only its last few hundred events, so a read
// after a run of a hundred containers (each a dozen events) sees only its tail (measured: 18 of 120 dies). watchDeathEvents
// starts the stream; its stop() ends it and reports.
const watchDeathEvents = ({ purpose }) => {
	const namePrefix = `DEV_gb_${purpose}_`;
	const dieList = [];
	let pendingText = '';
	const eventsProcess = spawn('docker', ['events', '--filter', 'type=container', '--filter', 'event=die', '--format', '{{.Actor.Attributes.name}} {{.Actor.Attributes.exitCode}}']);
	eventsProcess.stdout.on('data', (chunk) => {
		const lineList = `${pendingText}${chunk}`.split('\n');
		pendingText = lineList.pop();
		lineList.filter(Boolean).forEach((oneLine) => dieList.push({ containerName: oneLine.split(' ')[0], exitCode: oneLine.split(' ')[1] }));
	});
	return {
		stop: (callback) => {
			eventsProcess.kill('SIGTERM');
			const runDieList = dieList.filter((oneDie) => oneDie.containerName.startsWith(namePrefix));
			callback({ dieCount: runDieList.length, deathEventList: runDieList.filter((oneDie) => oneDie.exitCode !== REMOVED_BY_US_EXIT_CODE) });
		},
	};
};

const runProvisionStress = ({ roundCount, concurrency, purpose, childArgListFor, replayManagerPath }, callback) => {
	if (!Number.isInteger(roundCount) || roundCount < 1 || !Number.isInteger(concurrency) || concurrency < 1 || typeof purpose !== 'string' || !/^[a-zA-Z]+$/.test(purpose) || typeof childArgListFor !== 'function') {
		callback(`provisionStress: roundCount and concurrency (positive integers), purpose (letters) and childArgListFor (a function) are REQUIRED`);
		return;
	}
	const deathEventWatch = watchDeathEvents({ purpose });
	const allResultList = [];
	const roundSummaryList = [];
	const nextRound = (roundIndex) => {
		if (roundIndex >= roundCount) {
			// two seconds of slack, so the last removals' events have arrived before the stream ends
			setTimeout(() => {
				deathEventWatch.stop((eventsReport) => {
					callback('', {
						provisionCount: allResultList.length,
						failedResultList: allResultList.filter((oneResult) => oneResult.error !== '' || oneResult.deleteError),
						dieCount: eventsReport.dieCount,
						deathEventList: eventsReport.deathEventList,
						roundSummaryList,
					});
				});
			}, 2000);
			return;
		}
		const roundStartedAt = Date.now();
		runRound({ roundIndex, concurrency, purpose, childArgListFor, replayManagerPath }, (roundResultList) => {
			allResultList.push(...roundResultList);
			roundSummaryList.push(`round ${roundIndex + 1}: ${roundResultList.filter((oneResult) => oneResult.error === '').length}/${concurrency} up in ${Math.round((Date.now() - roundStartedAt) / 1000)} s`);
			nextRound(roundIndex + 1);
		});
	};
	nextRound(0);
};

module.exports = { runProvisionStress, REMOVED_BY_US_EXIT_CODE };

if (require.main === module) {
	const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
	require('../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: `${moduleName} --roundCount=<n> --concurrency=<n> --purpose=<letters> [--replayManagerPath=<path>]` });
	const { commandLineParameters } = process.global;
	const valueOf = (valueName) => {
		const rawValue = commandLineParameters.values[valueName];
		return Array.isArray(rawValue) ? rawValue[0] : rawValue;
	};
	runProvisionStress(
		{ roundCount: Number(valueOf('roundCount')), concurrency: Number(valueOf('concurrency')), purpose: valueOf('purpose'), childArgListFor: () => [], replayManagerPath: valueOf('replayManagerPath') },
		(stressErr, report) => {
			if (stressErr) {
				process.stdout.write(`${JSON.stringify({ error: stressErr })}\n`);
				process.exit(1);
			}
			process.stdout.write(`${JSON.stringify(report)}\n`);
			process.exit(report.failedResultList.length === 0 && report.deathEventList.length === 0 ? 0 : 1);
		},
	);
}
