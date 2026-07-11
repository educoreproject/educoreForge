#!/usr/bin/env node
'use strict';

// phaseF-act3-promote.js — ACT 3, THE GOLDEN PROMOTION (Phase F; TQ-blessed 2026-07-11;
// supervisor-authorized as this phase's climax). Repoints the store of record's golden —
// graphs.allStandards2.currentManifest — from the old golden manifest to the Phase-E
// candidate TQ personally reviewed and deployed (dev DME + demo.educore.dev), making the
// canonical store agree with the world.
//
// DISCIPLINE (supervisor note 1, verbatim conditions): backup via the SQLite backup API
// immediately before (separate step, verified before this runs); pointer read BEFORE and
// AFTER, logged with timestamps; the exact expected transition pre-declared (DEVLOG §3.5);
// executed EXACTLY ONCE via forgeStore.setCurrentManifest — the same one-UPDATE-plus-
// pointer-log-append primitive every buildGraph uses [code-fact forge-store.js:746-795];
// REFUSES to run if the store is not in the pre-declared BEFORE state (a re-run cannot
// double-fire the promotion).
//
// Run: node baselines/phaseF-act3-promote.js --db=<canonicalStorePath> [--execute]
// Without --execute: dry-run (reads + refusal logic only, no write).

const path = require('path');

process.global = process.global || {};
const noop = () => {};
process.global.xLog = process.global.xLog || {
	status: (msg) => console.log(`[act3] ${msg}`),
	error: (msg) => console.error(`[act3] ERROR: ${msg}`),
	result: noop,
	verbose: noop,
};
process.global.getConfig = process.global.getConfig || (() => ({}));

const GRAPH_NAME = 'allStandards2';
const OLD_GOLDEN =
	'a9a79df51f5745bf7c331bb798ebff239114ec27e16d10d8aaf76273c06d6957';
const NEW_GOLDEN =
	'a7f62fbc030519821960e7fe3a9f2f29463f1f8dc5b340d977df97b0d4ef72b2';

const dbArg = process.argv.find((oneArg) => oneArg.startsWith('--db='));
const execute = process.argv.includes('--execute');
if (!dbArg) {
	console.error('usage: node phaseF-act3-promote.js --db=<storePath> [--execute]');
	process.exit(2);
}
const DB_PATH = dbArg.replace('--db=', '');

const CODE = path.join(__dirname, '..');
const forgeStore = require(
	path.join(CODE, 'npm', 'qtools-graph-forge-core', 'lib', 'forge-store', 'forge-store'),
)();

const stamp = () => new Date().toISOString();

forgeStore.init({ dbPath: DB_PATH }, (initErr) => {
	if (initErr) {
		console.error(`store init failed: ${initErr}`);
		process.exit(2);
	}

	forgeStore.getGraphByName({ name: GRAPH_NAME }, (beforeErr, beforeRow) => {
		if (beforeErr || !beforeRow) {
			console.error(`BEFORE read failed: ${beforeErr || 'no such graph'}`);
			process.exit(2);
		}
		console.log(
			`[${stamp()}] BEFORE: ${GRAPH_NAME}.currentManifest = ${beforeRow.currentManifest}`,
		);

		if (beforeRow.currentManifest !== OLD_GOLDEN) {
			console.error(
				`[${stamp()}] REFUSING: pointer is not in the pre-declared BEFORE state ` +
					`(expected ${OLD_GOLDEN.slice(0, 12)}…, found ${String(beforeRow.currentManifest).slice(0, 12)}…). ` +
					`The promotion runs EXACTLY once; a repeat or drifted state is a STOP, not a retry.`,
			);
			process.exit(1);
		}

		if (!execute) {
			console.log(
				`[${stamp()}] DRY-RUN OK: state matches the pre-declared BEFORE; ` +
					`would repoint to ${NEW_GOLDEN.slice(0, 12)}… (run with --execute)`,
			);
			process.exit(0);
		}

		forgeStore.setCurrentManifest(
			{ name: GRAPH_NAME, manifestKey: NEW_GOLDEN },
			(moveErr) => {
				if (moveErr) {
					console.error(`[${stamp()}] setCurrentManifest FAILED: ${moveErr}`);
					process.exit(1);
				}
				forgeStore.getGraphByName({ name: GRAPH_NAME }, (afterErr, afterRow) => {
					if (afterErr || !afterRow) {
						console.error(`AFTER read failed: ${afterErr || 'no row'}`);
						process.exit(1);
					}
					console.log(
						`[${stamp()}] AFTER: ${GRAPH_NAME}.currentManifest = ${afterRow.currentManifest}`,
					);
					const exact = afterRow.currentManifest === NEW_GOLDEN;
					console.log(
						exact
							? `[${stamp()}] PROMOTION COMPLETE — the store of record now agrees with the world.`
							: `[${stamp()}] PROMOTION WRONG SHAPE — investigate immediately.`,
					);
					process.exit(exact ? 0 : 1);
				});
			},
		);
	});
});
