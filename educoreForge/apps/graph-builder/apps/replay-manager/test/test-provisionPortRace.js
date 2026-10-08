#!/usr/bin/env node
'use strict';

// test-provisionPortRace.js — gate for the scratch-port race (forgeClean lane CLEAN, VIOLET_VALLEY ruling 2026-10-08). Two
// builds in two lanes both provisioned on bolt 7811 within 27 s (REFORGE debugA, CLEAN dev2), each spoke to the other's
// container with the wrong credential, and both died. replayManager.create now holds a cross-process port allocation lock
// from the port search through the post-run check, and refuses by name when its own container is not the one running on
// the port it chose.
//
// PROVES:
//   (a) the post-run check passes OUR container running on OUR bolt port, and refuses by name a container that is not
//       running, one published on another port, and an inspect that fails (pure: an injected docker)
//   (b) the lock is exclusive: a second taker waits, and gives up by name (naming the holder) at its deadline; after a
//       release it is granted (pure: a scratch lock directory)
//   (c) a lock older than the stale age is broken and granted (pure: a back-dated scratch lock)
//   (d) LIVE: two provisions in two PROCESSES, each pausing between its port search and its docker run, BOTH succeed, on
//       DISTINCT bolt ports (Docker; run with no other build active — another lane's provisions would share the ports)
//   (e) ⟪ONYX_SUMMIT's measurement, 13:21: a container on a just-freed port died 1 s after start, exit 64, and readiness polled
//       the dead port for the whole timeout⟫ a container that dies while readiness polls fails create AT ONCE, naming its exit
//       code, cancels the readiness poll, and is disposed (pure: an injected docker that reports exit 64)
//   (f) ⟪VIOLET_VALLEY 2026-10-08: REFORGE measured 459 orphan neo4j data volumes, 408 GB⟫ LIVE: create then delete a scratch
//       graph, and every volume the container mounted is GONE (its own volumes, named from docker inspect, so another
//       lane's volumes cannot confuse the count)
// RED TWINS: (a) checkAccepted (the check passes anything); (b) lockNotExclusive (mkdir's refusal ignored); (c)
// staleNeverBroken; (f) volumesKept (dispose back to a plain rm -f; the twin removes the volume it leaked); (e) livenessUnwatched (create waits on readiness alone); (d) withoutPortLock — the two children run with the lock replaced by one always granted (the code
// before the fix): they choose the same pair, and they do not both succeed on distinct ports.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: replayManager's scratch-port race is closed (lock + post-run check)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Pure conjuncts over the real lock and check, then a LIVE conjunct that runs two provisions in two processes (Docker).
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
// loadBuildJsDouble, not moduleDouble: replayManager.js's `new require(...)` and its .json-reaching requires need a real module
const { loadBuildJsDouble } = require('../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const REPLAY_MANAGER_PATH = path.join(__dirname, '..', 'replayManager.js');
const CHILD_PATH = path.join(__dirname, 'testSupport', 'provisionPortRaceChild.js');
// long enough that the second child's search lands inside the first's pause, short beside a neo4j start
const PAUSE_AFTER_SEARCH_MS = 4000;
const managerModuleFor = (mutationList) => (mutationList.length === 0 ? require(REPLAY_MANAGER_PATH) : loadBuildJsDouble({ buildJsPath: REPLAY_MANAGER_PATH, mutationList }));
const scratchLockDirPath = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portRaceGate-')), 'portAllocation.lock');
const inspectDocker = (stdoutText, errorText) => (dockerArgs, callback) => callback(errorText ? new Error(errorText) : null, stdoutText, '');

const conjunctJudgeByRefId = {
	a_postRunCheckIsOurs: (mutationList, done) => {
		const { verifyOwnContainerPublished } = managerModuleFor(mutationList);
		const verdictList = [];
		const caseList = [
			{ caseName: 'ours', stdoutText: 'true 7811', errorText: '', expectRefusal: false },
			{ caseName: 'not running', stdoutText: 'false 7811', errorText: '', expectRefusal: true },
			{ caseName: 'another port', stdoutText: 'true 7813', errorText: '', expectRefusal: true },
			{ caseName: 'inspect failed', stdoutText: '', errorText: 'No such object', expectRefusal: true },
		];
		const nextCase = (caseIndex) => {
			if (caseIndex >= caseList.length) {
				done({ pass: verdictList.every((oneVerdict) => oneVerdict.ok), detail: verdictList.map((oneVerdict) => `${oneVerdict.caseName}: ${oneVerdict.text || 'accepted'}`).join(' | ') });
				return;
			}
			const oneCase = caseList[caseIndex];
			verifyOwnContainerPublished({ runDockerCommand: inspectDocker(oneCase.stdoutText, oneCase.errorText), graphName: 'DEV_gb_portRace_1_1', boltPort: 7811 }, (verifyErr) => {
				verdictList.push({ caseName: oneCase.caseName, text: verifyErr, ok: oneCase.expectRefusal ? /its own container is not running on bolt port 7811/.test(verifyErr) : verifyErr === '' });
				nextCase(caseIndex + 1);
			});
		};
		nextCase(0);
	},
	b_lockIsExclusive: (mutationList, done) => {
		const { acquirePortAllocationLock, releasePortAllocationLock } = managerModuleFor(mutationList);
		const lockDirPath = scratchLockDirPath();
		acquirePortAllocationLock({ lockDirPath, deadline: Date.now() + 1000 }, (firstErr) => {
			acquirePortAllocationLock({ lockDirPath, deadline: Date.now() + 1000 }, (secondErr) => {
				releasePortAllocationLock({ lockDirPath }, (releaseErr) => {
					acquirePortAllocationLock({ lockDirPath, deadline: Date.now() + 1000 }, (thirdErr) => {
						releasePortAllocationLock({ lockDirPath }, () => {
							done({ pass: firstErr === '' && /was not released in time \(held by pid \d+ at /.test(secondErr) && releaseErr === '' && thirdErr === '', detail: `first '${firstErr}'; second '${secondErr}'; after release '${thirdErr}'` });
						});
					});
				});
			});
		});
	},
	c_staleLockBroken: (mutationList, done) => {
		const { acquirePortAllocationLock, releasePortAllocationLock } = managerModuleFor(mutationList);
		const lockDirPath = scratchLockDirPath();
		fs.mkdirSync(lockDirPath);
		fs.writeFileSync(path.join(lockDirPath, 'owner'), 'pid 1 at a long time ago');
		const longAgo = new Date(Date.now() - 600000);
		fs.utimesSync(lockDirPath, longAgo, longAgo);
		acquirePortAllocationLock({ lockDirPath, deadline: Date.now() + 1000 }, (acquireErr) => {
			const ownerText = fs.existsSync(path.join(lockDirPath, 'owner')) ? fs.readFileSync(path.join(lockDirPath, 'owner'), 'utf8') : '';
			releasePortAllocationLock({ lockDirPath }, () => done({ pass: acquireErr === '' && new RegExp(`^pid ${process.pid} at `).test(ownerText), detail: `acquire '${acquireErr}'; owner now '${ownerText}'` }));
		});
	},
	e_deadContainerRefusedAtOnce: (mutationList, done) => {
		const managerModule = managerModuleFor(mutationList);
		const dockerCallList = [];
		let readinessCancelled = false;
		const manager = managerModule({
			portAllocationLockDirPath: scratchLockDirPath(),
			findAvailablePortPair: (settings, callback) => callback('', { boltPort: 17901, httpPort: 17902 }),
			runDockerCommand: (dockerArgs, callback) => {
				dockerCallList.push(dockerArgs.join(' '));
				const answerText = dockerArgs[0] === 'run' ? 'containerId\n' : dockerArgs[0] === 'inspect' ? (dockerArgs[2].indexOf('NetworkSettings') !== -1 ? 'true 17901\n' : 'false 64\n') : '';
				callback(null, answerText, '');
			},
			// a readiness that never succeeds: it returns only when create cancels it
			waitForReadiness: (readySpec, callback) => {
				const pollCancel = () => (readySpec.isCancelled() ? ((readinessCancelled = true), callback('cancelled')) : setTimeout(pollCancel, 200));
				pollCancel();
			},
		});
		const startedAt = Date.now();
		let judged = false;
		const judge = (verdict) => {
			if (!judged) {
				judged = true;
				done(verdict);
			}
		};
		setTimeout(() => judge({ pass: false, detail: 'create did not refuse within 15 s: a dead container was polled as if it might still come up' }), 15000);
		manager.create({ purpose: 'deadContainer' }, (createErr) => {
			setTimeout(() => {
				const elapsedMs = Date.now() - startedAt;
				const removed = dockerCallList.some((oneCall) => /^rm -f -v DEV_gb_deadContainer_/.test(oneCall));
				judge({ pass: /its own container stopped while neo4j was starting \(running 'false', exit code 64\)/.test(createErr) && /was disposed/.test(createErr) && elapsedMs < 15000 && readinessCancelled && removed, detail: `after ${elapsedMs} ms: ${createErr}; readiness cancelled ${readinessCancelled}; disposed ${removed}` });
			}, 500);
		});
	},
	f_destroyRemovesItsVolumes: (mutationList, done) => {
		const manager = managerModuleFor(mutationList)();
		manager.create({ purpose: 'volumeCheck' }, (createErr, handle) => {
			if (createErr) {
				done({ pass: false, detail: `create failed: ${createErr}` });
				return;
			}
			execFile('docker', ['inspect', '-f', '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}', handle.graphName], { encoding: 'utf8' }, (inspectErr, mountText) => {
				const volumeNameList = String(mountText || '').trim().split(/\s+/).filter(Boolean);
				manager.delete(handle, (deleteErr) => {
					execFile('docker', ['volume', 'ls', '-q'], { encoding: 'utf8' }, (listErr, volumeListText) => {
						const remainingVolumeNameList = volumeNameList.filter((volumeName) => String(volumeListText).split('\n').indexOf(volumeName) !== -1);
						const report = { pass: !inspectErr && !deleteErr && volumeNameList.length > 0 && remainingVolumeNameList.length === 0, detail: `mounted ${volumeNameList.length} volume(s); left after delete ${remainingVolumeNameList.length}${remainingVolumeNameList.length ? ` (${remainingVolumeNameList.join(', ')})` : ''}${deleteErr ? `; delete error ${deleteErr}` : ''}` };
						// a twin's leaked volume is removed here, by name, so the red observation leaves nothing behind
						if (remainingVolumeNameList.length === 0) {
							done(report);
							return;
						}
						execFile('docker', ['volume', 'rm', ...remainingVolumeNameList], { encoding: 'utf8' }, () => done(report));
					});
				});
			});
		});
	},
	d_twoProcessesTwoPorts: (mutationList, done) => {
		const withoutPortLock = mutationList.some((oneMutation) => oneMutation.childWithoutPortLock === true);
		const resultList = [];
		const runChild = (childDone) => {
			execFile(process.execPath, [CHILD_PATH, `--pauseAfterSearchMs=${PAUSE_AFTER_SEARCH_MS}`, ...(withoutPortLock ? ['--withoutPortLock=true'] : []), '-quiet'], { encoding: 'utf8', timeout: 300000 }, (execErr, stdoutText) => {
				const jsonLine = String(stdoutText || '').split('\n').filter((oneLine) => oneLine.startsWith('{')).pop();
				resultList.push(jsonLine ? JSON.parse(jsonLine) : { boltPort: null, error: `the child printed no result${execErr ? ` (${execErr.message})` : ''}` });
				childDone();
			});
		};
		let finishedCount = 0;
		const onChildDone = () => {
			finishedCount += 1;
			if (finishedCount < 2) {
				return;
			}
			const bothSucceeded = resultList.every((oneResult) => oneResult.error === '' && Number.isInteger(oneResult.boltPort));
			const distinctPorts = new Set(resultList.map((oneResult) => oneResult.boltPort)).size === 2;
			done({ pass: bothSucceeded && distinctPorts, detail: resultList.map((oneResult) => `bolt ${oneResult.boltPort}${oneResult.error ? ` ERROR ${String(oneResult.error).slice(0, 240)}` : ''}${oneResult.deleteError ? ` deleteError ${oneResult.deleteError}` : ''}`).join(' | ') });
		};
		runChild(onChildDone);
		setTimeout(() => runChild(onChildDone), 1000);
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_postRunCheckIsOurs', twinName: 'checkAccepted', mutationList: [{ modulePath: REPLAY_MANAGER_PATH, find: "		if (err || observedText !== `true ${boltPort}`) {", replace: '		if (false) {' }] },
	{ conjunctRefId: 'b_lockIsExclusive', twinName: 'lockNotExclusive', mutationList: [{ modulePath: REPLAY_MANAGER_PATH, find: "			if (!mkdirErr) {", replace: "			if (!mkdirErr || mkdirErr.code === 'EEXIST') {" }] },
	{ conjunctRefId: 'c_staleLockBroken', twinName: 'staleNeverBroken', mutationList: [{ modulePath: REPLAY_MANAGER_PATH, find: '				if (Date.now() - lockStat.mtimeMs > PORT_ALLOCATION_LOCK_STALE_MS) {', replace: '				if (false) {' }] },
	{ conjunctRefId: 'e_deadContainerRefusedAtOnce', twinName: 'livenessUnwatched', mutationList: [{ modulePath: REPLAY_MANAGER_PATH, find: '			const livenessWatch = watchContainerLiveness({ runDockerCommand, graphName }, settleReadiness);', replace: '			const livenessWatch = { stop: () => {} };' }] },
	{ conjunctRefId: 'f_destroyRemovesItsVolumes', twinName: 'volumesKept', mutationList: [{ modulePath: REPLAY_MANAGER_PATH, find: "	runDockerCommand(['rm', '-f', '-v', graphName], (err, stdout, stderr) => {", replace: "	runDockerCommand(['rm', '-f', graphName], (err, stdout, stderr) => {" }] },
	{ conjunctRefId: 'd_twoProcessesTwoPorts', twinName: 'withoutPortLock', mutationList: [{ childWithoutPortLock: true }] },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
const realMutationListOf = (mutationList) => mutationList.filter((oneMutation) => oneMutation.modulePath !== undefined);
harness.section('BASELINE — the real lock, check and provisioning pass every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED (a module double in memory, or the children without the lock)');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) => {
				const twinMutationList = oneTwin.mutationList.filter((oneMutation) => oneMutation.modulePath !== undefined);
				const judgeMutationList = twinMutationList.length ? realMutationListOf(oneTwin.mutationList) : oneTwin.mutationList;
				conjunctJudgeByRefId[oneTwin.conjunctRefId](judgeMutationList, (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
					stepDone();
				});
			}),
			() => harness.report(),
		);
	},
);
