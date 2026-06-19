#!/usr/bin/env node
'use strict';

// embedding-client-test.js — gating tests for the embedding client (contract §1C).
//   - base64 round-trip (encode -> decode -> identical Float32Array, length 1024)
//   - ONE live voyage-4-large call: 1024-dim vector + stamped embeddingModelVersion
// The api key is loaded from config INSIDE the client; this test never reads, prints,
// or references the key. Output shows only the vector LENGTH and the model version.
// Run: node lib/embedding/test/embedding-client-test.js

const assert = require('assert');

const configFilePath =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/configs/instanceSpecific/qbook/voyageEmbedding.ini';

const embedder = require('../embedding-client')({ configFilePath });

let passCount = 0;
let failCount = 0;

const check = (label, fn) => {
	try {
		fn();
		passCount++;
		console.log(`  PASS  ${label}`);
	} catch (err) {
		failCount++;
		console.log(`  FAIL  ${label}\n        ${err.message}`);
	}
};

console.log('embedding client gating tests:');

// base64 round-trip, length 1024
check('base64 round-trip identical Float32Array length 1024', () => {
	const original = new Float32Array(1024);
	for (let i = 0; i < 1024; i++) {
		// a spread of representative float32 values
		original[i] = Math.sin(i) * (i % 7 === 0 ? -1 : 1) * 0.0137 * (i + 1);
	}

	const base64 = embedder.encodeVector(original);
	assert.strictEqual(typeof base64, 'string', 'encode must yield a string');

	const decoded = embedder.decodeVector(base64);
	assert.ok(decoded instanceof Float32Array, 'decode must yield a Float32Array');
	assert.strictEqual(decoded.length, 1024, 'decoded length must be 1024');

	for (let i = 0; i < 1024; i++) {
		assert.strictEqual(
			decoded[i],
			original[i],
			`element ${i} must round-trip identically`,
		);
	}
});

// ----- async gate: ONE live voyage-4-large call -----
// Run the live test, then print the summary and exit with the right code.

const finish = () => {
	console.log(`\nembedding: ${passCount} passed, ${failCount} failed`);
	process.exit(failCount === 0 ? 0 : 1);
};

console.log('  ....  live voyage-4-large embedText call (key from config; never printed)');

embedder.embedText(
	{ text: 'K12Student | FirstName' },
	(err, result) => {
		check('live voyage-4-large call returns a 1024-dim vector', () => {
			assert.ok(!err, `embedText returned error: ${err}`);
			assert.ok(result, 'result must be present');
			assert.ok(
				result.vector instanceof Float32Array,
				'vector must be a Float32Array',
			);
			assert.strictEqual(
				result.vector.length,
				1024,
				`vector length must be 1024 (got ${result && result.vector && result.vector.length})`,
			);
		});

		check('helper stamps embeddingModelVersion = voyage-4-large', () => {
			assert.ok(result, 'result must be present');
			assert.strictEqual(
				result.embeddingModelVersion,
				'voyage-4-large',
				'embeddingModelVersion must be stamped voyage-4-large',
			);
		});

		if (result && result.vector) {
			// LENGTH and model version ONLY — never the key, never the vector contents
			console.log(
				`        live result: vector length = ${result.vector.length}, embeddingModelVersion = ${result.embeddingModelVersion}`,
			);
		}

		finish();
	},
);
