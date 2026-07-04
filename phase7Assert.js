#!/usr/bin/env node
'use strict';

// phase7Assert.js — Phase-7 acceptance assertion harness (TEMPORARY; removed at teardown).
// Mirrors the retired edfBridge.js shared-resource init (edf-bridge deleted 2026-07-04): opens the
// ONE canonical forge-store, builds the
// credential-accessor + instance-lifecycle, then runs cypher against a named LIVE graph (creds
// resolved from the store row — no credential file, no echoing of secrets). Also exposes a
// force-destroy for goldenCheck teardown.
//
// Usage:
//   node phase7Assert.js cypher <graphName> '<cypher>'        -> prints JSON records
//   node phase7Assert.js list                                 -> prints graphs registry (no creds)
//   node phase7Assert.js destroy <graphName>                  -> force-destroy instance + volume

const path = require('path');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CANONICAL_DB_PATH = path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');

const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

// Minimal process.global triad — sqlite-instance/forge-store destructure xLog/getConfig from it.
process.global = {
	xLog: {
		status: () => {},
		error: (...args) => console.error(...args),
		result: () => {},
		verbose: () => {},
	},
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
	rawConfig: {},
};

const buildResources = (callback) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	const credentialAccessor = require(path.join(
		CORE_LIB,
		'credential-accessor',
		'credential-accessor',
	))({ forgeStore });

	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.init({ dbPath: CANONICAL_DB_PATH }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({
			forgeStore,
			credentialAccessor,
		})((err, lifecycle) => next(err, { ...args, lifecycle }));
	});
	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		callback('', { forgeStore, credentialAccessor, lifecycle: args.lifecycle });
	});
};

const [, , mode, graphName, cypher] = process.argv;

buildResources((err, res) => {
	if (err) {
		console.error(`phase7Assert init failed: ${err}`);
		process.exit(1);
		return;
	}
	const { forgeStore, lifecycle } = res;

	if (mode === 'list') {
		forgeStore.listGraphs((err, rows) => {
			if (err) {
				console.error(`listGraphs failed: ${err}`);
				process.exit(1);
				return;
			}
			// strip any credential value defensively; print name/type/manifests/location only.
			const safe = (rows || []).map((r) => ({
				name: r.name,
				type: r.type,
				location: r.location,
				currentManifest: r.currentManifest,
				latestManifest: r.latestManifest,
			}));
			console.log(JSON.stringify(safe, null, 2));
			process.exit(0);
		});
		return;
	}

	if (mode === 'destroy') {
		lifecycle.destroyInstanceByName({ graphName, force: true }, (err) => {
			if (err) {
				console.error(`destroy failed: ${err}`);
				process.exit(1);
				return;
			}
			console.log(JSON.stringify({ destroyed: graphName }));
			process.exit(0);
		});
		return;
	}

	if (mode === 'cypher') {
		lifecycle.runCypher({ graphName, cypher, params: {} }, (err, result) => {
			if (err) {
				console.error(`runCypher failed: ${err}`);
				process.exit(1);
				return;
			}
			// instance-lifecycle.runCypher already returns record.toObject() plain objects.
			const coerce = (v) => {
				if (v && typeof v.toNumber === 'function') return v.toNumber(); // neo4j Integer
				if (Array.isArray(v)) return v.length > 8 ? `[array len ${v.length}]` : v.map(coerce);
				return v;
			};
			const records = (result.records || []).map((rec) => {
				const obj = {};
				Object.keys(rec).forEach((k) => {
					obj[k] = coerce(rec[k]);
				});
				return obj;
			});
			console.log(JSON.stringify(records, null, 2));
			process.exit(0);
		});
		return;
	}

	console.error(`unknown mode: ${mode}`);
	process.exit(1);
});
