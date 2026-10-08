#!/usr/bin/env node
'use strict';

// provisionPortRaceChild.js — ONE provision for test-provisionPortRace.js, run as its own PROCESS (the race is between
// processes, so a proof inside one process would prove nothing). It creates a DEV_gb_portRace_* scratch graph through the
// REAL replayManager with ONE seam widened: the real port search is followed by a pause (--pauseAfterSearchMs) so two
// children overlap between choosing a pair and publishing it, deterministically. --withoutPortLock replaces the lock with
// one that is always granted (the red twin: the code as it was before the lock). It prints one JSON line
// { boltPort, error } and deletes what it created. --purpose names the scratch graph's purpose segment (default portRace is
// the gate's own word, not a guess: the kill gate passes killCheck); --withoutExitWatchdog=true starts no exit watchdog (the
// kill gate's red twin: the code before the watchdog); the kill gate SIGKILLs this process while it provisions.
//
// Run (by the gate only): node provisionPortRaceChild.js --pauseAfterSearchMs=<ms> --purpose=<word> [--withoutPortLock=true] [--withoutExitWatchdog=true]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
require('../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: `${moduleName} --pauseAfterSearchMs=<ms> [--withoutPortLock=true]` });
const { commandLineParameters } = process.global;

const replayManagerModule = require('../../replayManager');

const valueOf = (valueName) => {
	const rawValue = commandLineParameters.values[valueName];
	return Array.isArray(rawValue) ? rawValue[0] : rawValue;
};
const pauseAfterSearchMs = Number(valueOf('pauseAfterSearchMs'));
if (!Number.isInteger(pauseAfterSearchMs) || pauseAfterSearchMs < 0) {
	process.stdout.write(`${JSON.stringify({ boltPort: null, error: `${moduleName}: --pauseAfterSearchMs=<non-negative integer> is REQUIRED` })}\n`);
	process.exit(1);
}
const withoutPortLock = valueOf('withoutPortLock') === 'true';
const withoutExitWatchdog = valueOf('withoutExitWatchdog') === 'true';
const purpose = valueOf('purpose');
if (typeof purpose !== 'string' || !/^[a-zA-Z]+$/.test(purpose)) {
	process.stdout.write(`${JSON.stringify({ boltPort: null, error: `${moduleName}: --purpose=<letters> is REQUIRED` })}\n`);
	process.exit(1);
}

const manager = replayManagerModule({
	findAvailablePortPair: (settings, callback) => replayManagerModule.findAvailablePortPair(settings, (searchErr, ports) => setTimeout(() => callback(searchErr, ports), pauseAfterSearchMs)),
	...(withoutPortLock ? { acquirePortAllocationLock: (lockSpec, callback) => callback(''), releasePortAllocationLock: (lockSpec, callback) => callback('') } : {}),
	...(withoutExitWatchdog ? { startExitWatchdog: () => {} } : {}),
});
manager.create({ purpose }, (createErr, handle) => {
	const result = { boltPort: handle ? handle.boltPort : null, error: createErr || '' };
	if (!handle) {
		process.stdout.write(`${JSON.stringify(result)}\n`);
		process.exit(0);
	}
	manager.delete(handle, (deleteErr) => {
		process.stdout.write(`${JSON.stringify({ ...result, deleteError: deleteErr || '' })}\n`);
		process.exit(0);
	});
});
