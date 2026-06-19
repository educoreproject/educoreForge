#!/usr/bin/env node
'use strict';

// Phase-1 cross-component integration smoke (SILENT_STONE).
// Wires the REAL 1A forge-store + credential-accessor into the REAL 1B instance-lifecycle
// (1B's own gate tested against in-memory fakes) and runs a full Docker round-trip,
// proving the parallel-built interfaces actually mate. Specifically guards the
// location+credential coexistence on one graphs row (an upsertGraph merge-vs-replace bug
// a fake registry could not surface). Callback style throughout; no async/await.

const os = require('os');
const path = require('path');
const fs = require('fs');

// minimal process.global — the responsible app (a CLI) injects this in production;
// sqlite-instance (under forge-store) reads process.global.xLog and getConfig(moduleName).
process.global = process.global || {};
const noop = () => {};
process.global.xLog = process.global.xLog || {
	status: noop,
	error: (msg) => console.error(`xLog.error: ${msg}`),
	result: noop,
	verbose: noop,
};
process.global.getConfig = process.global.getConfig || (() => ({}));

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const forgeStore = require('../forge-store/forge-store')();
const credentialAccessor = require('../credential-accessor/credential-accessor')({
	forgeStore,
});

const graphName = '__TEST_phase1integ';
const dbPath = path.join(os.tmpdir(), `__TEST_phase1integ_${process.pid}.sqlite3`);

let passed = 0;
let failed = 0;
const check = (label, condition) => {
	if (condition) {
		passed += 1;
		console.log(`  PASS  ${label}`);
	} else {
		failed += 1;
		console.log(`  FAIL  ${label}`);
	}
};

require('../instance-lifecycle/instance-lifecycle')({
	forgeStore,
	credentialAccessor,
})((lifecycleErr, lifecycle) => {
	if (lifecycleErr) {
		console.error(`could not build instance-lifecycle: ${lifecycleErr}`);
		process.exit(1);
	}

	const cleanupAndExit = (code) => {
		// best-effort docker cleanup so no stray container/volume survives a failure
		lifecycle.destroyInstanceByName({ graphName, force: true }, () => {
			try {
				fs.unlinkSync(dbPath);
			} catch (ignore) {}
			console.log(
				`\n=====================================================\nRESULT: ${
					failed === 0 ? 'GREEN' : 'RED'
				}  (${passed} passed, ${failed} failed)\n=====================================================`,
			);
			process.exit(code);
		});
	};

	const taskList = new taskListPlus();

	taskList.push((args, next) => {
		forgeStore.init({ dbPath }, (err) => next(err, args));
	});

	taskList.push((args, next) => {
		lifecycle.createInstanceByName({ graphName, type: 'user' }, (err, result) => {
			if (err) {
				next(err);
				return;
			}
			check('createInstanceByName returns a location', !!(result && result.location));
			next('', { ...args, location: result.location });
		});
	});

	// THE key integration assertion: location AND credential both present on the one row.
	taskList.push((args, next) => {
		forgeStore.getGraphByName({ name: graphName }, (err, row) => {
			if (err) {
				next(err);
				return;
			}
			check('graphs row carries the bolt location', !!(row && row.location));
			check('graphs row STILL carries credentialReference (not clobbered)', !!(row && row.credentialReference));
			check('graphs row STILL carries credentialValue (not clobbered)', !!(row && row.credentialValue));
			next('', { ...args, row });
		});
	});

	taskList.push((args, next) => {
		lifecycle.resolveAccessByName({ graphName }, (err, access) => {
			if (err) {
				next(err);
				return;
			}
			check('resolveAccessByName returns location', !!(access && access.location));
			check('resolveAccessByName returns a credential', !!(access && access.credential));
			next('', args);
		});
	});

	taskList.push((args, next) => {
		lifecycle.runCypher(
			{ graphName, cypher: 'RETURN 1 AS n', params: {} },
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				const value =
					result &&
					result.records &&
					result.records[0] &&
					(result.records[0].get
						? result.records[0].get('n')
						: result.records[0].n);
				check('real-wired cypher RETURN 1 round-trip yields 1', `${value}` === '1');
				next('', args);
			},
		);
	});

	taskList.push((args, next) => {
		lifecycle.destroyInstanceByName({ graphName, force: true }, (err) =>
			next(err, args),
		);
	});

	taskList.push((args, next) => {
		forgeStore.getGraphByName({ name: graphName }, (err, row) => {
			if (err) {
				next(err);
				return;
			}
			check('registry row dropped after destroy', !row);
			next('', args);
		});
	});

	const initialData = {};
	pipeRunner(taskList.getList(), initialData, (err) => {
		if (err) {
			failed += 1;
			console.log(`  FAIL  pipeline error: ${err}`);
			cleanupAndExit(1);
			return;
		}
		cleanupAndExit(failed === 0 ? 0 : 1);
	});
});
