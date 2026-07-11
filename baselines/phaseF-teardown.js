#!/usr/bin/env node
'use strict';

// phaseF-teardown.js — the Phase-F sanctioned teardown instrument (order §1.6; DEVLOG §6
// itemization precedes every run). Destroys EXACTLY the graphs named on the command line,
// through the lifecycle (container + volume + registry row + pointer-log rows), force:true
// because demo/suite graphs register type-guarded. EDF_FORGE_STORE_DB must be set EXPLICITLY
// by the invoking shell (the disclosure-5a lesson: never rely on a default for a destructive
// run). PROTECTED names are refused outright regardless of arguments.
//
// Run: EDF_FORGE_STORE_DB=<store> node baselines/phaseF-teardown.js --names=phase0a,phase0b

const path = require('path');

process.global = {
	xLog: { status: console.error, error: console.error, result: console.log },
	getConfig: () => undefined,
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
	rawConfig: {},
};

if (!process.env.EDF_FORGE_STORE_DB) {
	console.error('REFUSED: EDF_FORGE_STORE_DB must be set explicitly for a teardown run');
	process.exit(1);
}

const namesArg = process.argv.find((oneArg) => oneArg.startsWith('--names='));
if (!namesArg) {
	console.error('usage: EDF_FORGE_STORE_DB=<store> node phaseF-teardown.js --names=<a,b,...>');
	process.exit(1);
}
const graphNames = namesArg.replace('--names=', '').split(',').filter(Boolean);

// live-serving / protected infrastructure — refused even if named (the briefing's hard line)
const PROTECTED = ['pvsEcand', 'devGolden', 'allStandards2', 'allStandards1', 'pureGraph5', 'golden'];
const offLimits = graphNames.filter((oneName) => PROTECTED.includes(oneName));
if (offLimits.length) {
	console.error(`REFUSED: protected graph name(s) in the list: ${offLimits.join(', ')}`);
	process.exit(1);
}

const CORE_LIB = path.join(__dirname, '..', 'npm', 'qtools-graph-forge-core', 'lib');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
const credentialAccessor = require(path.join(
	CORE_LIB, 'credential-accessor', 'credential-accessor',
))({ forgeStore });

const taskList = new taskListPlus();

taskList.push((args, next) => {
	forgeStore.init({ dbPath: process.env.EDF_FORGE_STORE_DB }, (err) => next(err, args));
});

taskList.push((args, next) => {
	require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({
		forgeStore,
		credentialAccessor,
	})((err, lifecycle) => next(err, { ...args, lifecycle }));
});

graphNames.forEach((graphName) => {
	taskList.push((args, next) => {
		args.lifecycle.destroyInstanceByName({ graphName, force: true }, (err) => {
			if (err) {
				next(`destroy '${graphName}' failed: ${err}`, args);
				return;
			}
			console.log(`destroyed: ${graphName}`);
			next('', args);
		});
	});
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`TEARDOWN FAILED: ${err}`);
		process.exitCode = 1;
		return;
	}
	console.log(`PHASE-F TEARDOWN COMPLETE (${graphNames.length} graph(s): ${graphNames.join(', ')})`);
});
