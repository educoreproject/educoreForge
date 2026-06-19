#!/usr/bin/env node
'use strict';

// =====================================================================
// manifestEditor test gate — the compose-by-selection layer over forge-store.
// Runnable with: node lib/manifest-editor/test/test.js
// Uses a temp sqlite file under the OS temp dir; cleans it up. Named rows use
// __TEST_ prefixes. Asserts every gating requirement from the contract:
//   - content-addressing: identical bytes => identical blockId; -save idempotent
//     (exactly one blocks row after a double-save).
//   - -combine: compose-by-selection (supersede-by-subject; add new subject);
//     manifestKey ALWAYS derived; identical membership => identical key (dedup);
//     prior manifests never destroyed; genesis compose (no base).
//   - topo ordering: derived order respects `requires` (CEDS-first); explicit
//     `position` overrides.
//   - bridge-closure validation: well-formed passes; missing/mis-ordered fails.
//   - round-trip: save -> combine -> read back -> membership + manifestKey stable.
// =====================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');

// minimal process.global — the responsible app injects this in production.
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
const forgeStoreFactory = require('../../forge-store/forge-store');
const manifestEditorFactory = require('../manifest-editor');

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
	`__TEST_manifestEditor_${process.pid}_${Date.now()}.sqlite`,
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
const manifestEditor = manifestEditorFactory({ forgeStore });

// text fixtures
const cedsText = '__TEST_ CEDS standard block bytes';
const cipText = '__TEST_ CIP standard block bytes';
const relText = '__TEST_ relationships block requires CEDS+CIP';
const cedsV2Text = '__TEST_ CEDS standard block bytes v2 (new version)';
const dctapText = '__TEST_ DCTAP standard block bytes';
const relV2Text = '__TEST_ relationships block re-extracted v2';

const taskList = new taskListPlus();

// ---- content-addressing determinism (pure) ----
taskList.push((args, next) => {
	const idA = contentAddress.blockIdForText(cedsText);
	const idB = contentAddress.blockIdForText(cedsText);
	const idC = contentAddress.blockIdForText(cedsText + 'x');
	assert('content-address: identical bytes => identical blockId', idA === idB);
	assert('content-address: any change => different blockId', idA !== idC);
	next('', args);
});

// ---- init ----
taskList.push((args, next) => {
	forgeStore.init({ dbPath }, (err) => {
		assert('init: store ready', !err);
		next(err, args);
	});
});

// ---- saveSchemaBlock + idempotency (exactly one row) ----
taskList.push((args, next) => {
	manifestEditor.saveSchemaBlock(
		{ type: 'standard', subject: 'CEDS', version: '1', requires: [], text: cedsText, producedBy: '__TEST_forge' },
		(err, result) => {
			assert('save: returns a blockId', !err && !!result.blockId);
			next(err, { ...args, cedsId: result.blockId });
		},
	);
});

taskList.push((args, next) => {
	// save identical bytes again — same blockId, no error
	manifestEditor.saveSchemaBlock(
		{ type: 'standard', subject: 'CEDS', text: cedsText },
		(err, result) => {
			assert('save: identical bytes dedup to same blockId', !err && result.blockId === args.cedsId);
			next(err, args);
		},
	);
});

taskList.push((args, next) => {
	// real no-dup-row check: an unreferenced block appears EXACTLY ONCE in the blocks table
	forgeStore.collectibleBlockIds((err, ids) => {
		const occurrences = ids.filter((blockId) => blockId === args.cedsId).length;
		assert('save: idempotent — exactly one blocks row after double-save', !err && occurrences === 1);
		next(err, args);
	});
});

// ---- the rest of the blocks ----
taskList.push((args, next) => {
	manifestEditor.saveSchemaBlock(
		{ type: 'standard', subject: 'CIP', version: '1', requires: [], text: cipText },
		(err, result) => next(err, { ...args, cipId: result.blockId }),
	);
});
taskList.push((args, next) => {
	manifestEditor.saveSchemaBlock(
		{ type: 'relationships', subject: null, requires: ['CEDS', 'CIP'], text: relText },
		(err, result) => next(err, { ...args, relId: result.blockId }),
	);
});

// ---- genesis combine (no base) ----
taskList.push((args, next) => {
	manifestEditor.combine(
		{ set: [args.cedsId, args.cipId, args.relId], label: '__TEST_golden', note: 'genesis' },
		(err, result) => {
			assert('combine: genesis (no base) mints a manifest', !err && !!result.manifestKey);
			assert('combine: genesis member count = 3', !err && result.memberCount === 3);
			next(err, { ...args, m1: result.manifestKey });
		},
	);
});

// ---- manifestKey is derived + dedup (identical membership) ----
taskList.push((args, next) => {
	manifestEditor.combine(
		{ set: [args.cedsId, args.cipId, args.relId], label: '__TEST_golden', note: 'genesis-again' },
		(err, result) => {
			assert('combine: identical membership => identical (derived) manifestKey [dedup]', !err && result.manifestKey === args.m1);
			next(err, args);
		},
	);
});

// ---- validate: well-formed ----
taskList.push((args, next) => {
	manifestEditor.validate({ manifest: args.m1 }, (err, verdict) => {
		assert('validate: genesis manifest is well-formed', !err && verdict.wellFormed === true && verdict.violations.length === 0);
		next(err, args);
	});
});

// ---- show: derived build order puts standards before the relationships block ----
taskList.push((args, next) => {
	manifestEditor.show({ manifest: args.m1 }, (err, shown) => {
		const order = (shown.members || []).map((oneMember) => oneMember.blockId);
		const relIndex = order.indexOf(args.relId);
		const cedsIndex = order.indexOf(args.cedsId);
		const cipIndex = order.indexOf(args.cipId);
		assert('show: round-trips the same manifestKey', !err && shown.manifestKey === args.m1);
		assert('topo: CEDS ordered before the relationships block', cedsIndex >= 0 && relIndex >= 0 && cedsIndex < relIndex);
		assert('topo: CIP ordered before the relationships block', cipIndex >= 0 && cipIndex < relIndex);
		assert('topo: relationships block is last (CEDS-first falls out)', relIndex === order.length - 1);
		next(err, args);
	});
});

// ---- topo: explicit position OVERRIDES derived order ----
taskList.push((args, next) => {
	// rel given explicit position 0; the standard it requires has no position.
	// explicit-position members sort first => rel lands ahead of its subject in build order.
	const memberBlocks = [
		{ blockId: args.cedsId, position: null, type: 'standard', subject: 'CEDS', requires: [] },
		{ blockId: args.relId, position: 0, type: 'relationships', subject: null, requires: ['CEDS'] },
	];
	const ordered = forgeStore.deriveBuildOrder(memberBlocks);
	assert('topo: explicit position overrides derived order (pinned block leads)', !ordered.cycle && ordered.list[0].blockId === args.relId);
	next('', args);
});

// ---- compose-by-selection: SUPERSEDE a subject (new CEDS version) ----
taskList.push((args, next) => {
	manifestEditor.saveSchemaBlock(
		{ type: 'standard', subject: 'CEDS', version: '2', requires: [], text: cedsV2Text },
		(err, result) => next(err, { ...args, cedsV2Id: result.blockId }),
	);
});
taskList.push((args, next) => {
	manifestEditor.combine(
		{ base: args.m1, set: [args.cedsV2Id], label: '__TEST_golden', note: 'bump CEDS to v2' },
		(err, result) => next(err, { ...args, m2: result.manifestKey, m2count: result.memberCount }),
	);
});
taskList.push((args, next) => {
	manifestEditor.show({ manifest: args.m2 }, (err, shown) => {
		const ids = (shown.members || []).map((oneMember) => oneMember.blockId);
		assert('combine: supersede keeps member count stable (3)', !err && args.m2count === 3);
		assert('combine: superseding block replaces the old CEDS block', ids.includes(args.cedsV2Id) && !ids.includes(args.cedsId));
		assert('combine: untouched subjects (CIP, relationships) survive supersede', ids.includes(args.cipId) && ids.includes(args.relId));
		assert('combine: supersede mints a NEW manifestKey (immutable)', args.m2 !== args.m1);
		next(err, args);
	});
});

// ---- compose-by-selection: ADD a new subject ----
taskList.push((args, next) => {
	manifestEditor.saveSchemaBlock(
		{ type: 'standard', subject: 'DCTAP', version: '1', requires: [], text: dctapText },
		(err, result) => next(err, { ...args, dctapId: result.blockId }),
	);
});
taskList.push((args, next) => {
	manifestEditor.combine(
		{ base: args.m1, set: [args.dctapId], label: '__TEST_golden', note: 'add DCTAP' },
		(err, result) => {
			assert('combine: adding a new subject grows member count to 4', !err && result.memberCount === 4);
			next(err, { ...args, m3: result.manifestKey });
		},
	);
});
taskList.push((args, next) => {
	manifestEditor.show({ manifest: args.m3 }, (err, shown) => {
		const ids = (shown.members || []).map((oneMember) => oneMember.blockId);
		assert('combine: new subject present alongside the original three', ids.includes(args.dctapId) && ids.includes(args.cedsId) && ids.includes(args.cipId) && ids.includes(args.relId));
		next(err, args);
	});
});

// ---- compose-by-selection: RE-EXTRACT the relationships block (subject NULL) ----
taskList.push((args, next) => {
	manifestEditor.saveSchemaBlock(
		{ type: 'relationships', subject: null, requires: ['CEDS', 'CIP'], text: relV2Text },
		(err, result) => next(err, { ...args, relV2Id: result.blockId }),
	);
});
taskList.push((args, next) => {
	manifestEditor.combine(
		{ base: args.m1, set: [args.relV2Id], label: '__TEST_golden', note: 're-extract relationships' },
		(err, result) => next(err, { ...args, m4: result.manifestKey, m4count: result.memberCount }),
	);
});
taskList.push((args, next) => {
	manifestEditor.show({ manifest: args.m4 }, (err, shown) => {
		const ids = (shown.members || []).map((oneMember) => oneMember.blockId);
		assert('combine: re-extracted relationships supersedes the old one (count stable 3)', !err && args.m4count === 3);
		assert('combine: relationships block replaced by re-extraction', ids.includes(args.relV2Id) && !ids.includes(args.relId));
		next(err, args);
	});
});

// ---- supersede-with-self => identical membership => dedup to the same manifestKey ----
taskList.push((args, next) => {
	manifestEditor.combine(
		{ base: args.m1, set: [args.cedsId], label: '__TEST_golden', note: 'supersede CEDS with itself' },
		(err, result) => {
			assert('combine: superseding a subject with its own block dedups to the base manifestKey', !err && result.manifestKey === args.m1);
			next(err, args);
		},
	);
});

// ---- prior manifests are NEVER destroyed ----
taskList.push((args, next) => {
	forgeStore.getManifest({ manifestKey: args.m1 }, (err, manifest) => {
		assert('immutable: base manifest M1 still present after M2/M3/M4 minted', !err && manifest && manifest.members.length === 3);
		next(err, args);
	});
});

// ---- bridge-closure FAILURE: required subject absent ----
taskList.push((args, next) => {
	// genesis manifest of JUST the relationships block (requires CEDS+CIP, both absent)
	manifestEditor.combine(
		{ set: [args.relId], label: '__TEST_broken', note: 'rel without its subjects' },
		(err, result) => next(err, { ...args, brokenKey: result.manifestKey }),
	);
});
taskList.push((args, next) => {
	manifestEditor.validate({ manifest: args.brokenKey }, (err, verdict) => {
		assert('validate: required subject absent => NOT well-formed (missing violation)', !err && verdict.wellFormed === false && verdict.violations.some((oneViolation) => oneViolation.kind === 'missing'));
		next(err, args);
	});
});

// ---- bridge-closure FAILURE: relationships ordered before its subject ----
taskList.push((args, next) => {
	// explicit positions force rel ahead of CEDS — an order violation validate must catch
	const members = [
		{ blockId: args.relId, position: 0 },
		{ blockId: args.cedsId, position: 1 },
		{ blockId: args.cipId, position: 2 },
	];
	forgeStore.saveManifest(
		{ label: '__TEST_badOrder', note: 'rel before subject', members },
		(err, result) => next(err, { ...args, badOrderKey: result.manifestKey }),
	);
});
taskList.push((args, next) => {
	manifestEditor.validate({ manifest: args.badOrderKey }, (err, verdict) => {
		assert('validate: relationships ordered before its subject => NOT well-formed (order violation)', !err && verdict.wellFormed === false && verdict.violations.some((oneViolation) => oneViolation.kind === 'order'));
		next(err, args);
	});
});

// ---- diff: membership delta ----
taskList.push((args, next) => {
	manifestEditor.diff({ from: args.m1, to: args.m3 }, (err, delta) => {
		assert('diff: M1 -> M3 reports DCTAP added, nothing removed', !err && delta.added.includes(args.dctapId) && delta.removed.length === 0);
		next(err, args);
	});
});

// ---- round-trip: save -> combine -> read back -> membership + manifestKey stable ----
taskList.push((args, next) => {
	manifestEditor.show({ manifest: args.m1 }, (err, shown) => {
		const ids = (shown.members || []).map((oneMember) => oneMember.blockId).sort();
		const expected = [args.cedsId, args.cipId, args.relId].sort();
		const sameMembership = ids.length === expected.length && ids.every((value, index) => value === expected[index]);
		assert('round-trip: membership read back matches the composed set', !err && sameMembership);
		assert('round-trip: manifestKey is stable across read-back', !err && shown.manifestKey === args.m1);
		next(err, args);
	});
});

// =====================================================================

pipeRunner(taskList.getList(), {}, (err) => {
	finish(err);
});
