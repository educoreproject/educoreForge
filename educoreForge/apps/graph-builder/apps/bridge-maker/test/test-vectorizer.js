#!/usr/bin/env node
'use strict';

// test-vectorizer.js — hermetic gate for lib.d/vectorizer.js (bridgeKitRefactor_072726 Phase 1).
// Proves identity with the real vectorizer, then RED-then-GREEN over batchEmbed's dedup/batch/
// reproject logic WITHOUT ever reaching Voyage: a FAKE embedding-client module is substituted into
// require.cache BEFORE vectorizer.js is first required in this process (embedding-client is a
// top-level `require` inside vectorizer.js, so patching the cache first is what makes the fake take
// hold — the same technique test-graphReader.js uses for neo4j-driver). §3 hard line 2: no network.
//
// A. batchEmbed({texts: []}) -> {vectors: []}, ZERO calls to the embedder (the real early-return path,
//    exercised with NO fake at all — genuinely hermetic by construction, not by substitution).
// B. RED — the (fake) embedder errors -> batchEmbed propagates a NAMED, prefixed error.
// C. GREEN — the (fake) embedder succeeds -> batchEmbed DEDUPS repeated texts (one embedder call
//    for the distinct set) and REPROJECTS vectors back onto every original position, aligned 1:1.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-vectorizer.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the lib.d vectorizer kit module

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves lib.d/vectorizer.js IS the real vectorizer (identity); the empty-texts early return
     (real code, no fake needed); RED (embedder error propagates, named) then GREEN (dedup + batch +
     reproject) over a FAKE embedding-client substituted into require.cache — no Voyage, no network.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const path = require('path');

// THE SUBSTITUTION — installed BEFORE vectorizer.js is first required anywhere in this process, so
// its top-level `require(embedding-client)` resolves to the fake. `currentEmbedTexts` is swapped per
// section; the fake factory reads it at CALL time, not at construction time, so later swaps take.
const embeddingClientPath = require.resolve(
	path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'embedding', 'embedding-client'),
);
const originalCacheEntry = require.cache[embeddingClientPath];
let currentEmbedTexts = () => {
	throw new Error('test-vectorizer: currentEmbedTexts was not set before the embedder was called');
};
const fakeEmbeddingClientFactory = () => ({
	embedTexts: (args, callback) => currentEmbedTexts(args, callback),
});
require.cache[embeddingClientPath] = {
	id: embeddingClientPath,
	filename: embeddingClientPath,
	loaded: true,
	exports: fakeEmbeddingClientFactory,
};

const vectorizerFactory = require('../lib/vectorizer');
const kitVectorizerFactory = require('../lib.d/vectorizer');

// vectorizer.js has now captured the FAKE embeddingClientFactory in its module-level closure — safe
// to restore the real cache entry immediately so nothing else in this process is affected.
if (originalCacheEntry) {
	require.cache[embeddingClientPath] = originalCacheEntry;
} else {
	delete require.cache[embeddingClientPath];
}

// =====================================================================
harness.section('IDENTITY — lib.d/vectorizer.js IS the real vectorizer, not a drifted copy');
// =====================================================================
harness.ok('lib.d/vectorizer.js delegates to the SAME factory reference', kitVectorizerFactory === vectorizerFactory);

// =====================================================================
harness.section('A — batchEmbed({texts: []}) is the REAL early-return path: ZERO embedder calls, no fake needed');
// =====================================================================
(() => {
	let embedderCalls = 0;
	currentEmbedTexts = () => {
		embedderCalls++;
	};
	const vec = kitVectorizerFactory();
	vec.batchEmbed({ texts: [] }, (err, result) => {
		harness.ok('empty texts did not error', !err, err);
		harness.equal('empty texts -> empty vectors', JSON.stringify(result && result.vectors), JSON.stringify([]));
		harness.equal('the embedder was never called for an empty input', embedderCalls, 0);

		runSectionB();
	});
})();

// =====================================================================
function runSectionB() {
	harness.section('B — RED: the (fake) embedder errors -> batchEmbed propagates a NAMED, prefixed error');
	currentEmbedTexts = (args, callback) => {
		void args;
		callback('fake embedder: quota exceeded');
	};
	const vec = kitVectorizerFactory();
	vec.batchEmbed({ texts: ['hello'] }, (err) => {
		harness.match('embedder error is propagated, prefixed with the caller', err, /vectorizer batchEmbed: fake embedder: quota exceeded/);

		runSectionC();
	});
}

// =====================================================================
function runSectionC() {
	harness.section('C — GREEN: dedup + batch + reproject over a SUCCESSFUL (fake) embedder');
	let embedderCallCount = 0;
	let lastChunkTexts = null;
	currentEmbedTexts = ({ texts }, callback) => {
		embedderCallCount++;
		lastChunkTexts = texts;
		// deterministic fixture vector per distinct text (index-based, so the test can verify alignment).
		callback('', { vectors: texts.map((oneText, idx) => [idx, oneText.length]) });
	};
	const vec = kitVectorizerFactory();
	// 'a' repeats at positions 0 and 2; one blank position (3) must reproject to null, no embed call for it.
	vec.batchEmbed({ texts: ['a', 'b', 'a', ''] }, (err, result) => {
		harness.ok('did not error', !err, err);
		harness.equal('the embedder was called ONCE (one batch for the 2 distinct non-blank texts)', embedderCallCount, 1);
		harness.equal('the embedder received only the DISTINCT non-blank texts', JSON.stringify(lastChunkTexts), JSON.stringify(['a', 'b']));
		harness.ok('position 0 and 2 (both "a") got the SAME reprojected vector', JSON.stringify(result.vectors[0]) === JSON.stringify(result.vectors[2]));
		harness.ok('position 1 ("b") got a DIFFERENT vector than "a"', JSON.stringify(result.vectors[1]) !== JSON.stringify(result.vectors[0]));
		harness.equal('the blank position (3) reprojects to null (no embed call for blanks)', result.vectors[3], null);
		harness.equal('output is aligned 1:1 with input length', result.vectors.length, 4);

		harness.report();
	});
}
