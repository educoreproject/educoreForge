#!/usr/bin/env node
'use strict';

// =====================================================================
// Phase-1A test gate — content-address + forge-store + credential-accessor.
// Runnable with: node lib/forge-store/test/test.js
// Uses a temp sqlite file under the OS temp dir; cleans it up. Named rows
// use __TEST_ prefixes. Asserts every gating requirement from the contract.
// =====================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');

// -----
// minimal process.global — the responsible app injects this in production.
// sqlite-instance reads process.global.xLog and getConfig(moduleName).
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

const contentAddress = require('../../content-address/content-address')();
const forgeStoreFactory = require('../forge-store');
const credentialAccessorFactory = require('../../credential-accessor/credential-accessor');

// -----
// tiny assertion harness

let passCount = 0;
let failCount = 0;
const failures = [];

const assert = (label, condition) => {
	if (condition) {
		passCount++;
		console.log(`  PASS  ${label}`);
	} else {
		failCount++;
		failures.push(label);
		console.log(`  FAIL  ${label}`);
	}
};

// -----
// temp db

const dbPath = path.join(
	os.tmpdir(),
	`__TEST_forgeStore_${process.pid}_${Date.now()}.sqlite`,
);

const cleanup = () => {
	['', '-wal', '-shm'].forEach((suffix) => {
		const target = `${dbPath}${suffix}`;
		if (fs.existsSync(target)) {
			fs.unlinkSync(target);
		}
	});
};

const finish = (err) => {
	cleanup();
	console.log('');
	if (err) {
		console.log(`PIPELINE ERROR: ${err}`);
	}
	console.log(`RESULT: ${passCount} passed, ${failCount} failed`);
	process.exit(failCount === 0 && !err ? 0 : 1);
};

// =====================================================================

const forgeStore = forgeStoreFactory();
const credentialAccessor = credentialAccessorFactory({ forgeStore });

// shared text fixtures
const standardText = '__TEST_ standard CEDS block bytes';
const relText = '__TEST_ relationships block requires CEDS';
const overlayText = '__TEST_ overlay block requires CEDS';

const taskList = new taskListPlus();

// ---- content-addressing determinism (pure, no db) ----
taskList.push((args, next) => {
	const idA = contentAddress.blockIdForText(standardText);
	const idB = contentAddress.blockIdForText(standardText);
	const idC = contentAddress.blockIdForText(standardText + 'x');
	assert('blockId: identical bytes => identical blockId', idA === idB);
	assert('blockId: any change => different blockId', idA !== idC);
	assert('blockId: is 64-hex sha256', /^[0-9a-f]{64}$/.test(idA));

	const m1 = [
		{ blockId: 'bbb', position: null },
		{ blockId: 'aaa', position: 2 },
	];
	const m2 = [
		{ blockId: 'aaa', position: 2 },
		{ blockId: 'bbb', position: null },
	]; // same membership, different order
	const m3 = [
		{ blockId: 'aaa', position: 3 },
		{ blockId: 'bbb', position: null },
	]; // position changed
	const k1 = contentAddress.manifestKeyForMembership(m1);
	const k2 = contentAddress.manifestKeyForMembership(m2);
	const k3 = contentAddress.manifestKeyForMembership(m3);
	assert('manifestKey: identical membership => identical key (order-independent)', k1 === k2);
	assert('manifestKey: position change => different key', k1 !== k3);
	next('', args);
});

// ---- init ----
taskList.push((args, next) => {
	forgeStore.init({ dbPath }, (err) => {
		assert('init: creates db + 5 tables without error', !err);
		next(err, args);
	});
});

// ---- saveBlock round-trip + dedup ----
taskList.push((args, next) => {
	forgeStore.saveBlock(
		{
			type: 'standard',
			subject: 'CEDS',
			version: '1',
			requires: [],
			text: standardText,
			producedBy: '__TEST_forge',
		},
		(err, result) => {
			assert('saveBlock: returns blockId', !err && !!result.blockId);
			next(err, { ...args, cedsBlockId: result.blockId });
		},
	);
});

taskList.push((args, next) => {
	// save identical bytes again — must dedup to same id, no error
	forgeStore.saveBlock(
		{ type: 'standard', subject: 'CEDS', text: standardText },
		(err, result) => {
			assert(
				'saveBlock: identical bytes dedup to same blockId',
				!err && result.blockId === args.cedsBlockId,
			);
			next(err, args);
		},
	);
});

taskList.push((args, next) => {
	forgeStore.getBlock({ blockId: args.cedsBlockId }, (err, row) => {
		assert(
			'getBlock: round-trips type/subject/text',
			!err &&
				row &&
				row.type === 'standard' &&
				row.subject === 'CEDS' &&
				`${row.text}` === standardText,
		);
		assert('getBlock: requires parsed back to array', Array.isArray(row.requires));
		next(err, args);
	});
});

// ---- relationships + overlay blocks (for closure tests) ----
taskList.push((args, next) => {
	forgeStore.saveBlock(
		{ type: 'relationships', subject: 'CEDS_REL', requires: ['CEDS'], text: relText },
		(err, result) => next(err, { ...args, relBlockId: result.blockId }),
	);
});
taskList.push((args, next) => {
	forgeStore.saveBlock(
		{ type: 'overlay', subject: 'CEDS_OV', requires: ['CEDS'], text: overlayText },
		(err, result) => next(err, { ...args, overlayBlockId: result.blockId }),
	);
});

// orphan block: a block not yet in any manifest must be collectible
taskList.push((args, next) => {
	forgeStore.collectibleBlockIds((err, ids) => {
		assert(
			'orphan: unreferenced block is collectible (tolerated until referenced)',
			!err && ids.includes(args.cedsBlockId),
		);
		next(err, { ...args, orphanIds: ids });
	});
});

// ---- saveManifest round-trip + dedup ----
taskList.push((args, next) => {
	const members = [
		{ blockId: args.cedsBlockId, position: null },
		{ blockId: args.relBlockId, position: null },
		{ blockId: args.overlayBlockId, position: null },
	];
	forgeStore.saveManifest(
		{ label: '__TEST_golden', basedOn: null, note: 'initial', members },
		(err, result) => {
			assert('saveManifest: returns manifestKey', !err && !!result.manifestKey);
			next(err, { ...args, manifestKey: result.manifestKey, members });
		},
	);
});

taskList.push((args, next) => {
	forgeStore.saveManifest(
		{ label: '__TEST_golden', members: args.members },
		(err, result) => {
			assert(
				'saveManifest: identical membership dedups to same manifestKey',
				!err && result.manifestKey === args.manifestKey,
			);
			next(err, args);
		},
	);
});

taskList.push((args, next) => {
	forgeStore.getManifest({ manifestKey: args.manifestKey }, (err, manifest) => {
		assert(
			'getManifest: round-trips label + members',
			!err &&
				manifest &&
				manifest.label === '__TEST_golden' &&
				manifest.members.length === 3,
		);
		next(err, args);
	});
});

// after referencing in a manifest, the standard block is NOT collectible
taskList.push((args, next) => {
	forgeStore.collectibleBlockIds((err, ids) => {
		assert(
			'GC: block referenced by a retained manifest is NOT collectible',
			!err && !ids.includes(args.cedsBlockId),
		);
		next(err, args);
	});
});

// ---- graphs upsert + round-trip ----
taskList.push((args, next) => {
	forgeStore.upsertGraph(
		{ name: '__TEST_graph', location: 'bolt://localhost:7999', type: 'user' },
		(err, result) => {
			assert('upsertGraph: inserts a graph row', !err && !!result.graphId);
			next(err, { ...args, graphId: result.graphId });
		},
	);
});

taskList.push((args, next) => {
	forgeStore.getGraphByName({ name: '__TEST_graph' }, (err, row) => {
		assert(
			'getGraphByName: round-trips name/location/type',
			!err &&
				row &&
				row.name === '__TEST_graph' &&
				row.location === 'bolt://localhost:7999' &&
				row.type === 'user',
		);
		next(err, args);
	});
});

// ---- credential-accessor: generate / store / resolve through the module ----
taskList.push((args, next) => {
	credentialAccessor.generateCredential((err, cred) => {
		assert(
			'credential: generate returns reference + value',
			!err && !!cred.reference && !!cred.value && cred.value.length >= 32,
		);
		next(err, { ...args, cred });
	});
});

taskList.push((args, next) => {
	credentialAccessor.storeForGraph(
		{ graphName: '__TEST_graph', reference: args.cred.reference, value: args.cred.value },
		(err) => {
			assert('credential: storeForGraph persists onto the graph row', !err);
			next(err, args);
		},
	);
});

taskList.push((args, next) => {
	credentialAccessor.resolveForGraph({ graphName: '__TEST_graph' }, (err, cred) => {
		assert(
			'credential: resolveForGraph returns stored reference + value',
			!err &&
				cred.reference === args.cred.reference &&
				cred.value === args.cred.value,
		);
		next(err, args);
	});
});

// confirm credential is actually in the graphs row (storage IS the row)
taskList.push((args, next) => {
	forgeStore.getGraphByName({ name: '__TEST_graph' }, (err, row) => {
		assert(
			'credential: stored in graphs.credentialReference + credentialValue',
			!err &&
				row.credentialReference === args.cred.reference &&
				row.credentialValue === args.cred.value,
		);
		next(err, args);
	});
});

// ---- pointer: set current manifest + log row ----
taskList.push((args, next) => {
	forgeStore.setCurrentManifest(
		{ name: '__TEST_graph', manifestKey: args.manifestKey },
		(err) => {
			assert('setCurrentManifest: advances pointer + logs', !err);
			next(err, args);
		},
	);
});

taskList.push((args, next) => {
	forgeStore.getGraphByName({ name: '__TEST_graph' }, (err, row) => {
		assert(
			'setCurrentManifest: graphs.currentManifest now set',
			!err && row.currentManifest === args.manifestKey,
		);
		next(err, args);
	});
});

// ---- second manifest (a prior + a new), then rollback ----
taskList.push((args, next) => {
	// new manifest = only the standard block (a different membership => new key)
	const members = [{ blockId: args.cedsBlockId, position: null }];
	forgeStore.saveManifest(
		{ label: '__TEST_golden', basedOn: args.manifestKey, note: 'reduced', members },
		(err, result) => {
			assert(
				'saveManifest: a different membership yields a NEW manifestKey',
				!err && result.manifestKey !== args.manifestKey,
			);
			next(err, { ...args, secondManifestKey: result.manifestKey });
		},
	);
});

taskList.push((args, next) => {
	forgeStore.setCurrentManifest(
		{ name: '__TEST_graph', manifestKey: args.secondManifestKey },
		(err) => next(err, args),
	);
});

taskList.push((args, next) => {
	// rollback to the FIRST manifest
	forgeStore.rollbackPointer(
		{ name: '__TEST_graph', toManifestKey: args.manifestKey },
		(err) => {
			assert('rollbackPointer: repoints without error', !err);
			next(err, args);
		},
	);
});

taskList.push((args, next) => {
	forgeStore.getGraphByName({ name: '__TEST_graph' }, (err, row) => {
		assert(
			'rollbackPointer: currentManifest is the prior manifestKey',
			!err && row.currentManifest === args.manifestKey,
		);
		next(err, args);
	});
});

taskList.push((args, next) => {
	// the prior (second) manifest row must STILL exist after rollback
	forgeStore.getManifest({ manifestKey: args.secondManifestKey }, (err, manifest) => {
		assert(
			'rollbackPointer: prior manifest row is NEVER deleted',
			!err && manifest && manifest.manifestKey === args.secondManifestKey,
		);
		next(err, args);
	});
});

taskList.push((args, next) => {
	// the original manifest must also still exist
	forgeStore.getManifest({ manifestKey: args.manifestKey }, (err, manifest) => {
		assert('rollbackPointer: original manifest still present', !err && !!manifest);
		next(err, args);
	});
});

// ---- bridge-closure validation: WELL-FORMED fixture ----
// manifest with CEDS standard present and ordered before the rel/overlay blocks.
taskList.push((args, next) => {
	const members = [
		{ blockId: args.cedsBlockId, position: 0 },
		{ blockId: args.relBlockId, position: 1 },
		{ blockId: args.overlayBlockId, position: 2 },
	];
	forgeStore.saveManifest(
		{ label: '__TEST_wellFormed', note: 'ordered', members },
		(err, result) => next(err, { ...args, wfKey: result.manifestKey }),
	);
});

taskList.push((args, next) => {
	forgeStore.validateManifestClosure({ manifestKey: args.wfKey }, (err, verdict) => {
		assert(
			'closure: well-formed manifest (required subject present + earlier) => wellFormed',
			!err && verdict.wellFormed === true && verdict.violations.length === 0,
		);
		next(err, args);
	});
});

// ---- bridge-closure validation: ORDER-VIOLATION fixture ----
// relationships block ordered BEFORE the CEDS standard it requires.
taskList.push((args, next) => {
	const members = [
		{ blockId: args.relBlockId, position: 0 },
		{ blockId: args.cedsBlockId, position: 1 },
	];
	forgeStore.saveManifest(
		{ label: '__TEST_badOrder', note: 'rel before its subject', members },
		(err, result) => next(err, { ...args, badOrderKey: result.manifestKey }),
	);
});

taskList.push((args, next) => {
	forgeStore.validateManifestClosure({ manifestKey: args.badOrderKey }, (err, verdict) => {
		assert(
			'closure: rel block ordered before its required subject => NOT wellFormed',
			!err && verdict.wellFormed === false && verdict.violations.length > 0,
		);
		next(err, args);
	});
});

// ---- bridge-closure validation: MISSING-SUBJECT fixture ----
// relationships block whose required CEDS subject is absent from the manifest.
taskList.push((args, next) => {
	const members = [{ blockId: args.relBlockId, position: 0 }];
	forgeStore.saveManifest(
		{ label: '__TEST_missing', note: 'rel without its subject', members },
		(err, result) => next(err, { ...args, missingKey: result.manifestKey }),
	);
});

taskList.push((args, next) => {
	forgeStore.validateManifestClosure({ manifestKey: args.missingKey }, (err, verdict) => {
		assert(
			'closure: required subject absent from manifest => NOT wellFormed',
			!err &&
				verdict.wellFormed === false &&
				verdict.violations.some((oneViolation) => oneViolation.kind === 'missing'),
		);
		next(err, args);
	});
});

// ---- listGraphs + dropGraph ----
taskList.push((args, next) => {
	forgeStore.listGraphs((err, rows) => {
		assert('listGraphs: returns the graph row', !err && rows.length >= 1);
		next(err, args);
	});
});

taskList.push((args, next) => {
	forgeStore.dropGraph({ name: '__TEST_graph' }, (err) => {
		assert('dropGraph: removes the registry row without error', !err);
		next(err, args);
	});
});

taskList.push((args, next) => {
	forgeStore.getGraphByName({ name: '__TEST_graph' }, (err, row) => {
		assert('dropGraph: graph row is gone', !err && row == null);
		next(err, args);
	});
});

taskList.push((args, next) => {
	// blocks + manifests survive a dropGraph (retain-all)
	forgeStore.getManifest({ manifestKey: args.manifestKey }, (err, manifest) => {
		assert('dropGraph: manifests retained (retain-all)', !err && !!manifest);
		next(err, args);
	});
});

// =====================================================================

pipeRunner(taskList.getList(), {}, (err) => {
	finish(err);
});
