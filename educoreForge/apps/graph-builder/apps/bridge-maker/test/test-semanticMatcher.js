#!/usr/bin/env node
'use strict';

// test-semanticMatcher.js — hermetic gate for lib.d/semanticMatcher.js (bridgeKitRefactor_072726
// Phase 1, the EXTRACT of inferencePipeline's cosine + retrieve). Proves the copy's PURE retrieval
// logic byte-for-byte against a hand-computed fixture, plus its two documented edge behaviors:
//   RED (the degenerate case the original documents) — a source with NO vector never meaningfully
//        retrieves (every candidate scores cosine -1, "never retrieved").
//   GREEN — a source WITH a vector retrieves its true nearest candidate at rank 1, and topK caps
//        the returned pool exactly.
// PURE + synchronous + deterministic: no Neo4j, no async, no Date/random, no LLM.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-semanticMatcher.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the lib.d semanticMatcher kit module

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves semanticMatcher.retrieve/cosine faithfully reproduce inferencePipeline's own (a
     cross-check against a hand-computed fixture), the null-vector -1 degenerate case (RED), and
     top-K ranking + capping (GREEN).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const inferencePipelineFactory = require('../lib/inferencePipeline');
const semanticMatcherFactory = require('../lib.d/semanticMatcher');

const stubLlm = { rerank: (a, cb) => cb('', { choice: '1' }) };

const candidatePool = [
	{ stableId: 'c1', cedsId: 'P1', vector: [1, 0, 0] },
	{ stableId: 'c2', cedsId: 'P2', vector: [0, 1, 0] },
	{ stableId: 'c3', cedsId: 'P3', vector: [0.9, 0.1, 0] },
];

// =====================================================================
harness.section('CROSS-CHECK — semanticMatcher.retrieve reproduces inferencePipeline.retrieve exactly (same inputs, same topK)');
// =====================================================================
(() => {
	const source = { name: 'src', vector: [1, 0, 0] };
	const originalPipeline = inferencePipelineFactory({ llmClient: stubLlm, topK: 2 });
	const kitMatcher = semanticMatcherFactory({ topK: 2 });

	const fromOriginal = originalPipeline.retrieve(source, candidatePool);
	const fromKit = kitMatcher.retrieve(source, candidatePool);
	harness.equal(
		'byte-identical retrieval order + cosine for the SAME source/candidatePool/topK',
		JSON.stringify(fromOriginal),
		JSON.stringify(fromKit),
	);
	harness.equal('topK caps the pool at 2 (of 3 candidates)', fromKit.length, 2);
	harness.equal('rank-1 is the exact match c1', fromKit[0].candidate.stableId, 'c1');
})();

// =====================================================================
harness.section('RED — a source with NO vector never meaningfully retrieves (cosine -1 for every candidate, the documented degenerate case)');
// =====================================================================
(() => {
	const matcher = semanticMatcherFactory({ topK: 3 });
	const pool = matcher.retrieve({ name: 'novector' }, candidatePool);
	harness.ok('every entry scores cosine -1 (never retrieved)', pool.every((entry) => entry.cosine === -1));
})();

// =====================================================================
harness.section('GREEN — a source WITH a vector retrieves its true nearest candidate at rank 1');
// =====================================================================
(() => {
	const matcher = semanticMatcherFactory({ topK: 3 });
	const pool = matcher.retrieve({ name: 'src2', vector: [0, 1, 0] }, candidatePool);
	harness.equal('rank-1 is c2 (the exact match)', pool[0].candidate.stableId, 'c2');
	harness.equal('rank-1 cosine is 1', pool[0].cosine, 1);
	harness.ok('pool is sorted descending by cosine', pool[0].cosine >= pool[1].cosine && pool[1].cosine >= pool[2].cosine);
})();

harness.report();
