#!/usr/bin/env node
'use strict';

// phaseD-teardown.js — the Phase-D sanctioned teardown (boundary-review approved, order
// §1.6): destroy EXACTLY the six pvsD transient graphs this phase created, through the
// 1B lifecycle (container + volume + registry row), force:true because the graphs
// registered type 'user'. EDF_FORGE_STORE_DB must be set EXPLICITLY by the invoking
// shell (the disclosure-5a lesson: never rely on a default for a destructive run).
//
// Run: EDF_FORGE_STORE_DB=<canonical> node baselines/phaseD-teardown.js

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

const CORE_LIB = path.join(
	__dirname, '..', 'npm', 'qtools-graph-forge-core', 'lib',
);

const PHASE_D_GRAPHS = [
	'pvsD1direct',
	'pvsD1group',
	'pvsD1directRaw',
	'pvsD1groupRaw',
	'pvsD3mismatch',
	'pvsD3matched',
];

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

PHASE_D_GRAPHS.forEach((graphName) => {
	taskList.push((args, next) => {
		args.lifecycle.destroyInstanceByName({ graphName, force: true }, (err, result) => {
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
	console.log('PHASE-D TEARDOWN COMPLETE (6 graphs)');
});
