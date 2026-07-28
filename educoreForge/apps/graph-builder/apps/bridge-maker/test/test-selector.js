#!/usr/bin/env node
'use strict';

// test-selector.js — hermetic gate for lib.d/selector.js (bridgeKitRefactor_072726 Phase 1, the
// EXTRACT of inferencePipeline.scoreSource's floor-gate + rerank tail). Proves, against a STUB
// llmClient:
//   RED  — construction without an llmClient is refused BY NAME; a below-floor pool ABSTAINS
//          (cosineFloor pre-abstain) WITHOUT ever reaching the reranker (the cheap-abstain path).
//   GREEN — an above-floor pool reaches the reranker and the resulting decision is BYTE-IDENTICAL
//          to inferencePipeline.scoreSource's decision over the SAME source/pool/floor/stub — the
//          cross-check that proves this split is a faithful copy (P1's per-module half of the
//          equivalence gate; test-kit-equivalence.js proves the SAME thing end-to-end through the
//          composed kit).
//
// PURE / hermetic: a STUB llmClient only, no Neo4j, no network.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-selector.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the lib.d selector kit module

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves selector's construction guard, the cosineFloor pre-abstain (RED, never reaches the LLM),
     and a cross-check against inferencePipeline.scoreSource proving byte-identical decisions over
     the same retrieved pool + stub llmClient (GREEN).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const inferencePipelineFactory = require('../lib/inferencePipeline');
const selectorFactory = require('../lib.d/selector');

let stubRerankCalls = 0;
const stubLlm = {
	rerank: ({ choiceEnum } = {}, callback) => {
		stubRerankCalls++;
		void choiceEnum;
		callback('', { choice: '1' });
	},
};

const source = { name: 'src one', defText: 'src one def', vector: [1, 0, 0] };
const candidatePool = [
	{ stableId: 'c1', cedsId: 'P1', name: 'ceds one', defText: 'ceds P1 def', vector: [1, 0, 0] },
	{ stableId: 'c2', cedsId: 'P2', name: 'ceds two', defText: 'ceds P2 def', vector: [0, 1, 0] },
];

// =====================================================================
harness.section('RED — construction guard + the cosineFloor pre-abstain never reaches the reranker');
// =====================================================================
harness.match(
	'constructing without an llmClient throws, naming the reason',
	(() => {
		try {
			selectorFactory({});
			return '';
		} catch (constructionError) {
			return constructionError.message;
		}
	})(),
	/constructed without an llmClient/,
);

(() => {
	const before = stubRerankCalls;
	const selector = selectorFactory({ llmClient: stubLlm, cosineFloor: 0.99 });
	// retrieve the real pool (via inferencePipeline's own retrieve — proven faithful in
	// test-semanticMatcher.js), then floor-gate it: the SOLE candidate's cosine (1.0) is used as
	// bestCosine, and the floor here (0.99) still passes it — use a source whose best cosine is
	// BELOW the floor to force the abstain.
	const pipeline = inferencePipelineFactory({ llmClient: stubLlm });
	const belowFloorSource = { name: 'orthogonal', vector: [0, 0, 1] };
	const pool = pipeline.retrieve(belowFloorSource, candidatePool);
	let observed = null;
	selector.selectFromPool(belowFloorSource, pool, {}, {}, (err, decision) => {
		observed = { err, decision };
	});
	harness.ok('did not error', observed && !observed.err, observed && observed.err);
	harness.ok('a below-floor pool ABSTAINS', observed.decision.abstain === true && observed.decision.abstainReason === 'cosineFloor');
	harness.equal('the reranker was NEVER called for the abstain', stubRerankCalls, before);
})();

// =====================================================================
harness.section('GREEN — CROSS-CHECK: selector.selectFromPool over an above-floor pool is BYTE-IDENTICAL to inferencePipeline.scoreSource');
// =====================================================================
(() => {
	const cosineFloor = 0.5;
	const pipeline = inferencePipelineFactory({ llmClient: stubLlm, topK: 15, cosineFloor });
	const selector = selectorFactory({ llmClient: stubLlm, cosineFloor });

	let fromOriginal = null;
	pipeline.scoreSource(source, candidatePool, {}, {}, (err, decision) => {
		fromOriginal = { err, decision };
	});

	const kitMatcher = require('../lib.d/semanticMatcher')({ topK: 15 });
	const pool = kitMatcher.retrieve(source, candidatePool);
	let fromKit = null;
	selector.selectFromPool(source, pool, {}, {}, (err, decision) => {
		fromKit = { err, decision };
	});

	harness.ok('neither path errored', !fromOriginal.err && !fromKit.err, `${fromOriginal.err} / ${fromKit.err}`);
	harness.equal(
		'BYTE-IDENTICAL decision from the fused scoreSource vs. the split retrieve+selectFromPool',
		JSON.stringify(fromOriginal.decision),
		JSON.stringify(fromKit.decision),
	);
	harness.ok('the decision is a non-abstain pick of P1', !fromKit.decision.abstain && fromKit.decision.targetKey === 'P1');
})();

harness.report();
