#!/usr/bin/env node
'use strict';

// __TEST_equivalenceGatesBite.js — runs the graph-equivalence twin gates (31-34) OUTSIDE the full
// suite, with no graph/docker dependency, so the RED-then-GREEN bite is observable in isolation. This
// is the Phase-0 "prove it bites" artifact: each fault gate internally compares an identical manifest
// (GREEN) against a perturbed one (RED) and passes only if BOTH transitions are observed. A gate that
// is never seen failing is not proven; this driver is where the failure is seen.
// Run: node __TEST_equivalenceGatesBite.js  (exit 0 = every gate passed).

const path = require('path');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

process.global = {
	xLog: { status: () => {}, error: (...a) => console.error(...a), result: () => {}, verbose: () => {} },
};

const GATE_ROOT = path.join(__dirname, '..');
const GATE_LIB = path.join(GATE_ROOT, 'lib');
const GATES_DIR = path.join(GATE_ROOT, 'gates.d');

const fingerprinter = require(path.join(GATE_LIB, 'graph-fingerprint', 'graphFingerprint'))({});
const differ = require(path.join(GATE_LIB, 'graph-diff', 'graphDiff'))();
const graphEquivalence = require(path.join(GATE_LIB, 'graph-equivalence', 'graphEquivalence'))({
	fingerprinter,
	differ,
});

const ctx = { resources: { graphEquivalence, fingerprinter, differ } };

// discover only the equivalence gates (31-34), in order
const gateFiles = fs
	.readdirSync(GATES_DIR)
	.filter((name) => /^3[1-5]-equivalence.*\.js$/.test(name))
	.sort();

const results = [];
const taskList = new taskListPlus();

gateFiles.forEach((fileName) => {
	taskList.push((args, next) => {
		const descriptor = require(path.join(GATES_DIR, fileName))();
		descriptor.run(ctx, (err, outcome) => {
			const passed = !err && outcome && outcome.passed;
			results.push({ name: descriptor.name, kind: descriptor.kind, passed: !!passed, detail: err ? `error: ${err}` : (outcome && outcome.detail) || '' });
			console.log(`${passed ? 'PASS' : 'FAIL'}  ${descriptor.name} (${descriptor.kind})`);
			console.log(`      ${err ? `error: ${err}` : (outcome && outcome.detail) || ''}`);
			next('', args);
		});
	});
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`driver error: ${err}`);
		process.exit(1);
		return;
	}
	const failed = results.filter((r) => !r.passed);
	console.log(`\n${failed.length === 0 ? `ALL ${results.length} EQUIVALENCE GATES PASS` : `${failed.length} GATE FAILURE(S)`}`);
	process.exit(failed.length === 0 ? 0 : 1);
});
