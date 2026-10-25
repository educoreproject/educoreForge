#!/usr/bin/env node
'use strict';

// scratchVolumeLeakChild.js — ONE provision for test-scratchVolumeLeak.js, run as its own PROCESS, because both leaks the gate
// closes happen BETWEEN processes: a wrapper's `pkill -TERM -P <pid>` reaches the exit watchdog only when the watchdog is a child
// of the provisioning process, and a wrapper's careless `docker rm -f` of a RETAINED graph happens after the build process ended.
// It creates a DEV_gb_<purpose>_* scratch graph through the REAL replayManager, prints one JSON line { graphName, error }, then:
//   --afterCreate=hold     waits until it is signalled (the memory guard's victim)
//   --afterCreate=retain   retains the graph (a build's deliverable) and exits 0
// --watchdogAsChild=true is the red twin of the signal conjunct: the exit watchdog is launched as before EC1, a direct child of
// this process with no signal immunity.
//
// Run (by the gate only): node scratchVolumeLeakChild.js --purpose=<letters> --afterCreate=hold|retain [--watchdogAsChild=true]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
require('../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: `${moduleName} --purpose=<letters> --afterCreate=hold|retain [--watchdogAsChild=true]` });
const { commandLineParameters } = process.global;

const { spawn } = require('child_process');
const replayManagerModule = require('../../replayManager');

const valueOf = (valueName) => {
	const rawValue = commandLineParameters.values[valueName];
	return Array.isArray(rawValue) ? rawValue[0] : rawValue;
};
const refuse = (refusalText) => {
	process.stdout.write(`${JSON.stringify({ graphName: null, error: `${moduleName}: ${refusalText}` })}\n`);
	process.exit(1);
};
const purpose = valueOf('purpose');
if (typeof purpose !== 'string' || !/^[a-zA-Z]+$/.test(purpose)) {
	refuse('--purpose=<letters> is REQUIRED');
}
const AFTER_CREATE_ACTION_LIST = ['hold', 'retain'];
const afterCreate = valueOf('afterCreate');
if (AFTER_CREATE_ACTION_LIST.indexOf(afterCreate) === -1) {
	refuse(`--afterCreate='${afterCreate}' is not one of: ${AFTER_CREATE_ACTION_LIST.join(', ')}`);
}
const watchdogAsChild = valueOf('watchdogAsChild') === 'true';

// the pre-EC1 launch: the watchdog script run straight under this process, so `pkill -P <this pid>` finds and kills it
let childWatchdogStarted = false;
const startWatchdogAsChild = () => {
	if (childWatchdogStarted) {
		return;
	}
	childWatchdogStarted = true;
	spawn('/bin/sh', ['-c', replayManagerModule.EXIT_WATCHDOG_BODY_TEXT, 'educoreForgeScratchWatchdog', String(process.pid), replayManagerModule.SCRATCH_REGISTRY_FILE_PATH], { detached: true, stdio: 'ignore' }).unref();
};

const manager = replayManagerModule(watchdogAsChild ? { startExitWatchdog: startWatchdogAsChild } : {});
manager.create({ purpose }, (createErr, handle) => {
	if (!handle) {
		process.stdout.write(`${JSON.stringify({ graphName: null, error: createErr || 'create returned no handle' })}\n`);
		process.exit(0);
	}
	if (afterCreate === 'hold') {
		process.stdout.write(`${JSON.stringify({ graphName: handle.graphName, error: '' })}\n`);
		setInterval(() => {}, 60000);
		return;
	}
	manager.retain(handle, (retainErr) => {
		process.stdout.write(`${JSON.stringify({ graphName: handle.graphName, error: retainErr || '' })}\n`);
		process.exit(0);
	});
});
