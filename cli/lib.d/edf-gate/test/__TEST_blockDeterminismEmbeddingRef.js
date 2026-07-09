#!/usr/bin/env node
'use strict';

// __TEST_blockDeterminismEmbeddingRef.js — runs the block-level determinism twin (gates.d/36) OUTSIDE the
// full suite, graph-free, so the embedding-sidecar Q4-closure bite is observable in isolation:
//   GREEN  identical blocks -> identical blockId (warm-cache re-forge is block-identical);
//   RED    one mutated embeddingRef -> different blockId (a determinant drift is caught);
//   GUARD  the ref is load-bearing INSIDE the hashed block text (exactly one line moves, ref only).
// A gate never seen failing is unproven; this driver is where the RED transition is seen. It runs the SAME
// gate descriptor the suite discovers (no forked logic). Run: node __TEST_blockDeterminismEmbeddingRef.js
// (exit 0 = the gate passed).

const path = require('path');

process.global = {
	xLog: {
		status: () => {},
		error: (...a) => console.error(...a),
		result: () => {},
		verbose: () => {},
	},
};

const GATES_DIR = path.join(__dirname, '..', 'gates.d');
const descriptor = require(
	path.join(GATES_DIR, '36-blockDeterminismEmbeddingRef.js'),
)();

descriptor.run({}, (err, outcome) => {
	const passed = !err && outcome && outcome.passed;
	console.log(`${passed ? 'PASS' : 'FAIL'}  ${descriptor.name} (${descriptor.kind})`);
	console.log(
		`      ${err ? `error: ${err}` : (outcome && outcome.detail) || ''}`,
	);
	console.log(
		`\n${passed ? 'BLOCK-DETERMINISM EMBEDDING-REF GATE PASSES' : 'GATE FAILURE'}`,
	);
	process.exit(passed ? 0 : 1);
});
