#!/usr/bin/env node
'use strict';

// teardown-graph.js — cleanly destroy an isolated scratch graph via the 1B instance-lifecycle guard
// (container + volume + registry row). Refuses non-ephemeral/golden unless force. Usage:
//   node teardown-graph.js <graphName> [--force]
// A small operational helper for Phase-0 cleanup (e.g. freeing ports a scratch graph squatted while
// the golden container was stopped). No async/await, no try/catch for control flow.

const path = require('path');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const dbPath = path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');

const graphName = process.argv[2];
const force = process.argv.indexOf('--force') !== -1;

process.global = {
	xLog: { status: (...a) => console.error(...a), error: (...a) => console.error(...a), result: (...a) => console.log(...a), verbose: () => {} },
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
};

if (!graphName) {
	console.error('teardown-graph.js: <graphName> required');
	process.exit(1);
}

const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
const credentialAccessor = require(path.join(CORE_LIB, 'credential-accessor', 'credential-accessor'))({ forgeStore });

const taskList = new taskListPlus();
taskList.push((args, next) => {
	forgeStore.init({ dbPath }, (err) => next(err, args));
});
taskList.push((args, next) => {
	require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({ forgeStore, credentialAccessor })((err, lifecycle) => next(err, { ...args, lifecycle }));
});
taskList.push((args, next) => {
	args.lifecycle.destroyInstanceByName({ graphName, force }, (err, result) => {
		if (err) { next(err); return; }
		console.log(JSON.stringify({ action: 'teardown', ...result }));
		next('', args);
	});
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) { console.error(`teardown-graph.js: ${err}`); process.exit(1); return; }
	process.exit(0);
});
