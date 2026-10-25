#!/usr/bin/env node
'use strict';

// test-scratchVolumeLeak.js — gate for EC1 (build-store economy, VELVET_RIDGE for BRONZE_CROWN, 2026-10-25): a disposed scratch
// graph leaves NO volume behind. During nextStandards wave 2, 24 dangling neo4j volumes (~16 GB) accumulated in an hour. Every
// disposal inside replayManager already ran `docker rm -f -v` (test-provisionPortRace (f), (g)); the leaks came from OUTSIDE it,
// through two doors this gate closes:
//   1. the lane wrappers' memory guard (zeroBacklog laneC slotLib.sh memoryGuard) runs `pkill -TERM -P <run pid>`: when the run
//      pid is graphBuilder's own, that SIGTERMs the exit watchdog too, because the watchdog was a direct child of the process it
//      guards. The containers then outlive the process, and the hand cleanup that follows used plain `docker rm -f`.
//   2. a RETAINED graph (a build's materialized deliverable) is disposed by the lane's wrapper, and several wrappers
//      (wave2 laneG buildG.sh, laneF buildF.frozen1-3.sh) used `docker rm -f` without -v: each run leaked the graph's volumes,
//      which carried no mark of whose they were, so nothing could ever find them again.
//
// PROVES (all LIVE, Docker):
//   (k) a provisioning process signalled exactly as the memory guard does (pkill -TERM -P <pid>; kill -TERM <pid>) leaves NO
//       container and NO volume: the exit watchdog is nobody's child and ignores TERM, INT and HUP
//   (l) the volumes of a retained graph that a wrapper removed with a plain `docker rm -f` are REMOVED by the next scratch
//       provision (create's sweep of dangling volumes that carry the scratch label), and by name only
//   (m) every volume a scratch container mounts carries the label educoreForge.scratchGraph=<its graph name>, so a leaked one is
//       always identifiable as ours (and `docker rm -v` still removes it: the volumes stay anonymous)
// RED TWINS: (k) watchdogAsChild (the child launches the watchdog as before EC1); (l) sweepSkipped (create without its sweep);
// (m) volumesUnlabelled (the docker run without its labelled mounts).
// Run it with no other build active: (l)'s sweep removes ANY dangling scratch-labelled volume, which is the point.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: a disposed or abandoned scratch graph leaves no Docker volume behind
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     LIVE conjuncts (Docker): a signalled provisioning process, a carelessly removed retained graph, and the volume labels.
     Each conjunct removes, by exact name, anything it observed left behind, so a red observation leaves nothing.
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { loadBuildJsDouble } = require('../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const REPLAY_MANAGER_PATH = path.join(__dirname, '..', 'replayManager.js');
const CHILD_PATH = path.join(__dirname, 'testSupport', 'scratchVolumeLeakChild.js');
const SCRATCH_VOLUME_LABEL_NAME = 'educoreForge.scratchGraph';
const CLEANUP_WAIT_MS = 40000;
const managerModuleFor = (mutationList) => (mutationList.length === 0 ? require(REPLAY_MANAGER_PATH) : loadBuildJsDouble({ buildJsPath: REPLAY_MANAGER_PATH, mutationList }));

const volumeNamesOf = (containerName, callback) =>
	execFile('docker', ['inspect', '-f', '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}', containerName], { encoding: 'utf8' }, (inspectErr, mountText) => callback(inspectErr ? `docker inspect ${containerName}: ${inspectErr.message}` : '', String(mountText || '').trim().split(/\s+/).filter(Boolean)));
const existingVolumesOf = (volumeNameList, callback) =>
	execFile('docker', ['volume', 'ls', '-q'], { encoding: 'utf8' }, (listErr, listText) => {
		const presentNameList = String(listText || '').split('\n');
		callback(volumeNameList.filter((volumeName) => presentNameList.indexOf(volumeName) !== -1));
	});
const containerExists = (containerName, callback) =>
	execFile('docker', ['ps', '-a', '-q', '--filter', `name=^${containerName}$`], { encoding: 'utf8' }, (listErr, listText) => callback(String(listText || '').trim() !== ''));
// a red observation's leftovers, removed by EXACT name (container with -v, then any volume still standing)
const removeLeftovers = ({ containerName, volumeNameList }, callback) =>
	execFile('docker', ['rm', '-f', '-v', containerName], { encoding: 'utf8' }, () => existingVolumesOf(volumeNameList, (leftList) => (leftList.length === 0 ? callback() : execFile('docker', ['volume', 'rm', ...leftList], { encoding: 'utf8' }, () => callback()))));

// runChild — start the child; onLine gets its one JSON result line (or a refusal object) and the child process
const runChild = (argList, onLine) => {
	const child = spawn(process.execPath, [CHILD_PATH, ...argList, '-quiet'], { stdio: ['ignore', 'pipe', 'ignore'] });
	let stdoutText = '';
	let answered = false;
	const answer = (result) => {
		if (!answered) {
			answered = true;
			onLine(result, child);
		}
	};
	child.stdout.on('data', (chunk) => {
		stdoutText += chunk;
		const jsonLine = stdoutText.split('\n').find((oneLine) => oneLine.startsWith('{'));
		if (jsonLine) {
			answer(JSON.parse(jsonLine));
		}
	});
	child.on('exit', () => answer({ graphName: null, error: `the child exited with no result line: ${stdoutText.slice(0, 300)}` }));
	return child;
};

const conjunctJudgeByRefId = {
	k_signalledProvisionLeavesNothing: (mutationList, done) => {
		const watchdogAsChild = mutationList.some((oneMutation) => oneMutation.childWatchdogAsChild === true);
		runChild(['--purpose=signalCheck', '--afterCreate=hold', ...(watchdogAsChild ? ['--watchdogAsChild=true'] : [])], (result, child) => {
			if (!result.graphName) {
				child.kill('SIGKILL');
				done({ pass: false, detail: `the child provisioned nothing: ${result.error}` });
				return;
			}
			const containerName = result.graphName;
			volumeNamesOf(containerName, (inspectErr, volumeNameList) => {
				// EXACTLY the memory guard's two commands (slotLib.sh memoryGuard)
				execFile('/bin/sh', ['-c', `pkill -TERM -P ${child.pid}; kill -TERM ${child.pid}`], () => {
					const signalledAt = Date.now();
					const waitForCleanup = () => containerExists(containerName, (containerLeft) => existingVolumesOf(volumeNameList, (leftVolumeList) => {
						if ((containerLeft || leftVolumeList.length > 0) && Date.now() - signalledAt < CLEANUP_WAIT_MS) {
							setTimeout(waitForCleanup, 1000);
							return;
						}
						const report = { pass: !inspectErr && volumeNameList.length > 0 && !containerLeft && leftVolumeList.length === 0, detail: `signalled the owner of '${containerName}' (${volumeNameList.length} volume(s)) as the memory guard does; after ${Math.round((Date.now() - signalledAt) / 1000)} s: container left ${containerLeft}, volumes left ${leftVolumeList.length}${inspectErr ? `; ${inspectErr}` : ''}` };
						if (!containerLeft && leftVolumeList.length === 0) {
							done(report);
							return;
						}
						fs.rmSync(path.join(os.tmpdir(), `educoreForge-scratchContainers-${child.pid}.list`), { force: true });
						removeLeftovers({ containerName, volumeNameList }, () => done(report));
					}));
					waitForCleanup();
				});
			});
		});
	},
	l_carelessDisposeRecovered: (mutationList, done) => {
		runChild(['--purpose=retainCheck', '--afterCreate=retain'], (result) => {
			if (!result.graphName || result.error) {
				done({ pass: false, detail: `the child retained nothing: ${result.error}` });
				return;
			}
			const containerName = result.graphName;
			volumeNamesOf(containerName, (inspectErr, volumeNameList) => {
				// the careless wrapper: a plain rm -f, no -v
				execFile('docker', ['rm', '-f', containerName], { encoding: 'utf8' }, (rmErr) => {
					existingVolumesOf(volumeNameList, (orphanList) => {
						const manager = managerModuleFor(mutationList)();
						manager.create({ purpose: 'sweepCheck' }, (createErr, handle) => {
							const judge = (deleteErr) => existingVolumesOf(volumeNameList, (leftVolumeList) => {
								const report = { pass: !inspectErr && !rmErr && !createErr && !deleteErr && volumeNameList.length > 0 && orphanList.length === volumeNameList.length && leftVolumeList.length === 0, detail: `retained '${containerName}' removed with a plain rm -f: ${orphanList.length} of ${volumeNameList.length} volume(s) orphaned; after the next provision: ${leftVolumeList.length} left${createErr ? `; create error ${createErr}` : ''}${deleteErr ? `; delete error ${deleteErr}` : ''}${inspectErr ? `; ${inspectErr}` : ''}` };
								if (leftVolumeList.length === 0) {
									done(report);
									return;
								}
								execFile('docker', ['volume', 'rm', ...leftVolumeList], { encoding: 'utf8' }, () => done(report));
							});
							if (!handle) {
								judge('');
								return;
							}
							manager.delete(handle, judge);
						});
					});
				});
			});
		});
	},
	m_everyScratchVolumeLabelled: (mutationList, done) => {
		const manager = managerModuleFor(mutationList)();
		manager.create({ purpose: 'labelCheck' }, (createErr, handle) => {
			if (createErr) {
				done({ pass: false, detail: `create failed: ${createErr}` });
				return;
			}
			volumeNamesOf(handle.graphName, (inspectErr, volumeNameList) => {
				execFile('docker', ['volume', 'inspect', '-f', `{{.Name}} {{index .Labels "${SCRATCH_VOLUME_LABEL_NAME}"}} {{index .Labels "com.docker.volume.anonymous"}}|`, ...volumeNameList], { encoding: 'utf8' }, (volumeInspectErr, inspectText) => {
					const labelRowList = String(inspectText || '').split('|').map((oneRow) => oneRow.trim()).filter(Boolean).map((oneRow) => oneRow.split(' '));
					const unlabelledList = labelRowList.filter((oneRow) => oneRow[1] !== handle.graphName).map((oneRow) => oneRow[0]);
					manager.delete(handle, (deleteErr) => {
						done({ pass: !inspectErr && !volumeInspectErr && !deleteErr && volumeNameList.length >= 2 && labelRowList.length === volumeNameList.length && unlabelledList.length === 0, detail: `${volumeNameList.length} volume(s) mounted; ${labelRowList.length - unlabelledList.length} labelled ${SCRATCH_VOLUME_LABEL_NAME}=${handle.graphName}${unlabelledList.length ? `; UNLABELLED ${unlabelledList.join(', ')}` : ''}${deleteErr ? `; delete error ${deleteErr}` : ''}` });
					});
				});
			});
		});
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'k_signalledProvisionLeavesNothing', twinName: 'watchdogAsChild', mutationList: [{ childWatchdogAsChild: true }] },
	{ conjunctRefId: 'l_carelessDisposeRecovered', twinName: 'sweepSkipped', mutationList: [{ modulePath: REPLAY_MANAGER_PATH, find: '			sweepLeakedScratchVolumes({ runDockerCommand }, (sweepNote, removedVolumeNameList) => {', replace: "			((unusedSpec, sweepCallback) => sweepCallback('', []))({ runDockerCommand }, (sweepNote, removedVolumeNameList) => {" }] },
	{ conjunctRefId: 'm_everyScratchVolumeLabelled', twinName: 'volumesUnlabelled', mutationList: [{ modulePath: REPLAY_MANAGER_PATH, find: '				...scratchVolumeMountArgsFor(graphName),', replace: '' }] },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
const realMutationListOf = (mutationList) => mutationList.filter((oneMutation) => oneMutation.modulePath !== undefined);
harness.section('BASELINE — the real provisioning, watchdog and sweep pass every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED (a module double in memory, or the child launching the old watchdog)');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) => {
				const realMutationList = realMutationListOf(oneTwin.mutationList);
				conjunctJudgeByRefId[oneTwin.conjunctRefId](realMutationList.length ? realMutationList : oneTwin.mutationList, (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
					stepDone();
				});
			}),
			() => harness.report(),
		);
	},
);
