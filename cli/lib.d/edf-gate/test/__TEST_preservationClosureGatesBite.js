#!/usr/bin/env node
'use strict';

// __TEST_preservationClosureGatesBite.js — runs the standing preservation + delta-closure twin gates
// (37-38) OUTSIDE the full suite, with NO store/graph/docker dependency, so the RED-then-GREEN bite
// is observable in isolation. This is the Phase-0 "prove it bites" artifact: each gate internally
// compares a clean fixture (GREEN) against a fault-injected one (RED) and passes only if BOTH
// transitions are observed. A gate that is never seen failing is not proven; this driver is where the
// PASS (both transitions seen) is confirmed.
//
// It ALSO carries a negative control: it re-runs each gate against a BROKEN comparator (one that can
// never detect the fault) and asserts the gate then reports FAIL — proving the gate's PASS is load-
// bearing on the comparator actually biting, not a tautology.
//
// Run: node __TEST_preservationClosureGatesBite.js   (exit 0 = every check passed).

const path = require('path');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

process.global = {
	xLog: { status: () => {}, error: (...a) => console.error(...a), result: () => {}, verbose: () => {} },
};

const GATE_ROOT = path.join(__dirname, '..');
const GATE_LIB = path.join(GATE_ROOT, 'lib');
const GATES_DIR = path.join(GATE_ROOT, 'gates.d');

const manifestPreservation = require(path.join(GATE_LIB, 'manifest-preservation', 'manifestPreservation'))();
const closureDelta = require(path.join(GATE_LIB, 'closure-delta', 'closureDelta'))();

// the REAL resources — the comparators the running suite injects
const realCtx = { resources: { manifestPreservation, closureDelta } };

// a BROKEN pair — comparators that ALWAYS declare success (never bite). The gates must FAIL against
// these, proving the PASS above is load-bearing on real detection.
const brokenCtx = {
	resources: {
		manifestPreservation: {
			assertPreservation: () => ({ preserved: true, wellFormed: true, missing: [] }),
		},
		closureDelta: {
			assertDeltaClosure: () => ({
				clean: true,
				noNewViolations: true,
				newViolations: [],
				healedViolations: [],
				baseCount: 0,
			}),
		},
	},
};

const gateFiles = fs
	.readdirSync(GATES_DIR)
	.filter((name) => /^3[78]-(preservation|deltaClosure).*\.js$/.test(name))
	.sort();

const checks = [];
const taskList = new taskListPlus();

gateFiles.forEach((fileName) => {
	// POSITIVE: real comparator -> gate must PASS (both RED and GREEN transitions observed inside)
	taskList.push((args, next) => {
		const descriptor = require(path.join(GATES_DIR, fileName))();
		descriptor.run(realCtx, (err, outcome) => {
			const passed = !err && outcome && outcome.passed;
			checks.push({ label: `${descriptor.name} PASSES with real comparator`, ok: !!passed, detail: err ? `error: ${err}` : (outcome && outcome.detail) || '' });
			console.log(`${passed ? 'PASS' : 'FAIL'}  ${descriptor.name} (real comparator)`);
			console.log(`      ${err ? `error: ${err}` : (outcome && outcome.detail) || ''}`);
			next('', args);
		});
	});
	// NEGATIVE CONTROL: broken comparator -> gate must FAIL (the RED evidence: the gate itself bites)
	taskList.push((args, next) => {
		const descriptor = require(path.join(GATES_DIR, fileName))();
		descriptor.run(brokenCtx, (err, outcome) => {
			const gatePassed = !err && outcome && outcome.passed;
			const controlOk = !gatePassed; // we WANT the gate to fail here
			checks.push({ label: `${descriptor.name} FAILS with broken comparator (negative control)`, ok: controlOk, detail: (outcome && outcome.detail) || '' });
			console.log(`${controlOk ? 'PASS' : 'FAIL'}  ${descriptor.name} negative-control -> gate reported ${gatePassed ? 'PASS (BAD)' : 'FAIL (expected)'}`);
			console.log(`      ${(outcome && outcome.detail) || ''}`);
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
	const failed = checks.filter((oneCheck) => !oneCheck.ok);
	console.log(
		`\n${failed.length === 0 ? `ALL ${checks.length} CHECKS PASS (both gates bite; negative controls confirm)` : `${failed.length} CHECK FAILURE(S)`}`,
	);
	process.exit(failed.length === 0 ? 0 : 1);
});
