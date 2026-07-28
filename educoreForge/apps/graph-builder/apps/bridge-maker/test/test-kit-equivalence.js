#!/usr/bin/env node
'use strict';

// test-kit-equivalence.js — THE PHASE-1 BOUNDARY GATE (bridgeKitRefactor_072726 spec §6 Phase 1, the
// load-bearing proof; design P1 "behavior must match"). With a STUBBED llmClient (fixture picks,
// hermetic — no container, no Voyage, no Opus, no real graph, §3 hard line 2), drives BOTH:
//
//   (a) the COMPOSED KIT     — lib.d/sourceWalker -> lib.d/semanticMatcher -> lib.d/selector ->
//                               lib.d/decisionFreezer -> lib.d/materializer
//   (b) the EXISTING FUSED PATH — lib/inferencePipeline (retrieve+scoreSource fused) -> lib/inferredIndex
//
// over the SAME graph fixture (read through the SAME graphReader double via sourceWalker for both
// paths, so there is only ONE flattened source/candidate record set feeding both — the fixture
// itself cannot be a source of divergence), and asserts the DECISIONS (after freezing, which is
// order-independent by construction — test-decisionFreezer.js) and the MATERIALIZED EDGE SPECS are
// BYTE-IDENTICAL. This is the proof that licenses the eventual teardown of the fused path (P2): the
// extraction changes NOTHING observable.
//
// inferencePipeline.js, inferredIndex.js and semanticBridge.js are NOT modified by this suite or by
// Phase 1 at all (P2 coexist) — this suite only READS them, exactly as every other bridge-maker
// suite does.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-kit-equivalence.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- THE PHASE-1 BOUNDARY GATE: composed kit vs. fused inferencePipeline+inferredIndex

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives the composed lib.d kit (sourceWalker->semanticMatcher->selector->decisionFreezer->
     materializer) and the existing fused inferencePipeline+inferredIndex over the SAME fixture graph
     and a stubbed llmClient, and asserts BYTE-IDENTICAL decisions and materialized edges. Hermetic:
     no container, no Voyage, no Opus, no real graph.

EXIT STATUS
     0 the two paths are byte-identical;  1 they diverge (or any assertion fails).
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const { taskListPlus, pipeRunner } = new require('qtools-asynchronous-pipe-plus')();

// ---- the OLD FUSED PATH (untouched originals) ----
const inferencePipelineFactory = require('../lib/inferencePipeline');
const inferredIndexFactory = require('../lib/inferredIndex');
const decisionFreezerFactoryOld = require('../lib/decisionFreezer');

// ---- the NEW COMPOSED KIT (lib.d) ----
const sourceWalkerFactory = require('../lib.d/sourceWalker');
const semanticMatcherFactory = require('../lib.d/semanticMatcher');
const selectorFactory = require('../lib.d/selector');
const decisionFreezerFactoryKit = require('../lib.d/decisionFreezer');
const materializerFactoryKit = require('../lib.d/materializer');

// =====================================================================
// FIXTURE — the same 3-dim vectors test-semantic-bridge.js Section B proves (s1~c1(P1), s2~c2(P2),
// s3 orthogonal -> below the 0.6 cosineFloor -> abstain). The pilot standard, LIF (spec §1).
// =====================================================================
const referenceNodes = [
	{ stableId: 'ref/P1', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P1', propertyKey: 'P1', qualifierKeys: [] } },
	{ stableId: 'ref/P2', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P2', propertyKey: 'P2', qualifierKeys: [] } },
	{ stableId: 'ref/P3', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P3', propertyKey: 'P3', qualifierKeys: [] } },
];
const textVectors = {
	'src one': [0.9, 0.1, 0],
	'src two': [0.1, 0.9, 0],
	'src three': [0.3, 0.3, 0.3],
	'ceds P1': [1, 0, 0],
	'ceds P2': [0, 1, 0],
	'ceds P3': [0, 0, 1],
};
const sourceGraphNodes = [
	{ stableId: 's1', properties: { _source: 'LIF', role: 'DmeProperty', name: 'src one', defText: 'src one' } },
	{ stableId: 's2', properties: { _source: 'LIF', role: 'DmeProperty', name: 'src two', defText: 'src two' } },
	{ stableId: 's3', properties: { _source: 'LIF', role: 'DmeProperty', name: 'src three', defText: 'src three' } },
];
const candidateGraphNodes = [
	{ stableId: 'c1', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds one', defText: 'ceds P1', cedsId: 'P1' } },
	{ stableId: 'c2', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds two', defText: 'ceds P2', cedsId: 'P2' } },
	{ stableId: 'c3', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds three', defText: 'ceds P3', cedsId: 'P3' } },
];

const graphReaderDouble = {
	readNodes: ({ label, propertyEquals }, callback) => {
		const eq = propertyEquals || {};
		if (label === 'ForgedNode' && eq._source === 'LIF' && eq.role === 'DmeProperty') {
			callback('', { nodes: sourceGraphNodes });
			return;
		}
		if (label === 'ForgedNode' && eq._source === 'CEDS' && eq.role === 'DmeProperty') {
			callback('', { nodes: candidateGraphNodes });
			return;
		}
		callback('', { nodes: [] });
	},
};

// deterministic STUB reranker: always pick retrieval rank 1; never LLM-abstains (abstain only via
// cosineFloor). Call counts are tracked SEPARATELY per path so the "same LLM behavior, same call
// count" sanity check is meaningful.
let oldRerankCalls = 0;
let kitRerankCalls = 0;
const makeStubLlm = (counterIncrement) => ({
	rerank: ({ choiceEnum } = {}, callback) => {
		counterIncrement();
		void choiceEnum;
		callback('', { choice: '1' });
	},
});
const oldStubLlm = makeStubLlm(() => {
	oldRerankCalls++;
});
const kitStubLlm = makeStubLlm(() => {
	kitRerankCalls++;
});

const TOP_K = 15;
const COSINE_FLOOR = 0.6;
const PAIR_STAMP = { subjectSource: 'LIF', subjectVersion: 'v1', objectSource: 'CEDS', objectVersion: 'v14' };
const MATERIALIZER_OPTS = {
	subjectSource: 'LIF',
	subjectVersion: 'v1',
	objectSource: 'CEDS',
	objectVersion: 'v14',
	mappingTool: 'semanticBridge',
};

// =====================================================================
// STEP 1 — read the SAME flattened source/candidate records for BOTH paths, via sourceWalker (the
// extracted reader). Using ONE reader for both means the fixture itself cannot be a divergence source.
// =====================================================================
const walker = sourceWalkerFactory({ graphReader: graphReaderDouble });

const taskList = new taskListPlus();
taskList.push((args, next) =>
	walker.walk({ standard: 'lif', role: 'DmeProperty' }, (err, out) =>
		next(err, { ...args, srcs: out && out.sourceNodes }),
	),
);
taskList.push((args, next) =>
	walker.walk({ standard: 'ceds', role: 'DmeProperty', flatten: sourceWalkerFactory.flattenCandidateRecord }, (err, out) =>
		next(err, { ...args, cand: out && out.sourceNodes }),
	),
);
// attach fixture vectors (the vectorizer's job in a real --rebridge; injected directly here, exactly
// as test-semantic-bridge.js does, since the vectorizer is the NET seam and is never exercised by
// the suite — §3 hard line 2).
taskList.push((args, next) => {
	args.srcs.forEach((r) => {
		r.vector = textVectors[r.defText];
	});
	args.cand.forEach((r) => {
		r.vector = textVectors[r.defText];
	});
	next('', args);
});

pipeRunner(taskList.getList(), {}, (readErr, fixture) => {
	harness.ok('fixture read did not error', !readErr, readErr);
	harness.equal('3 LIF sources read via sourceWalker', fixture.srcs.length, 3);
	harness.equal('3 CEDS candidates read via sourceWalker (with cedsId)', fixture.cand.length, 3);

	runComparison(fixture.srcs, fixture.cand);
});

// =====================================================================
function runComparison(srcs, cand) {
	harness.section('A — THE OLD FUSED PATH: inferencePipeline.processSources -> decisionFreezer -> inferredIndex');

	const oldPipeline = inferencePipelineFactory({ llmClient: oldStubLlm, topK: TOP_K, cosineFloor: COSINE_FLOOR });
	oldPipeline.processSources(
		{ sources: srcs, candidatePoolByRole: { DmeProperty: cand }, sourceClassIndex: {}, candidateClassIndex: {} },
		(oldErr, oldOut) => {
			harness.ok('old fused path did not error', !oldErr, oldErr);
			const oldDecisions = (oldOut || {}).decisions || [];
			harness.equal('old path: 2 picks + 1 abstain (3 decisions total)', oldDecisions.length, 3);

			const oldFrozen = decisionFreezerFactoryOld().freeze({ pairStamp: PAIR_STAMP, decisions: oldDecisions });
			const oldSubgraph = inferredIndexFactory({ ...MATERIALIZER_OPTS, decisionBlockHash: oldFrozen.decisionBlockHash }).buildInferredSubgraph({
				inferredDecisions: oldFrozen.inferredDecisions,
				sourceNodes: srcs,
				referenceNodes,
			});

			runKitPath(srcs, cand, { oldDecisions, oldFrozen, oldSubgraph });
		},
	);
}

// =====================================================================
function runKitPath(srcs, cand, oldResults) {
	harness.section('B — THE COMPOSED KIT: sourceWalker(done) -> semanticMatcher -> selector -> decisionFreezer -> materializer');

	const matcher = semanticMatcherFactory({ topK: TOP_K });
	const selector = selectorFactory({ llmClient: kitStubLlm, cosineFloor: COSINE_FLOOR });

	const perSourceTask = new taskListPlus();
	const kitDecisions = [];
	srcs.forEach((oneSource) => {
		perSourceTask.push((args, next) => {
			const pool = matcher.retrieve(oneSource, cand);
			selector.selectFromPool(oneSource, pool, {}, {}, (err, decision) => {
				if (err) {
					next(`selecting for ${oneSource.stableId}: ${err}`);
					return;
				}
				kitDecisions.push(decision);
				next('', args);
			});
		});
	});

	pipeRunner(perSourceTask.getList(), {}, (kitErr) => {
		harness.ok('composed kit path did not error', !kitErr, kitErr);
		harness.equal('kit path: 2 picks + 1 abstain (3 decisions total)', kitDecisions.length, 3);

		const kitFrozen = decisionFreezerFactoryKit().freeze({ pairStamp: PAIR_STAMP, decisions: kitDecisions });
		const kitSubgraph = materializerFactoryKit({ ...MATERIALIZER_OPTS, decisionBlockHash: kitFrozen.decisionBlockHash }).buildInferredSubgraph({
			inferredDecisions: kitFrozen.inferredDecisions,
			sourceNodes: srcs,
			referenceNodes,
		});

		assertEquivalence(oldResults, { kitDecisions, kitFrozen, kitSubgraph });
	});
}

// =====================================================================
function assertEquivalence(oldResults, kitResults) {
	harness.section('C — THE BOUNDARY GATE: byte-identical decisions, hash, and materialized edges');

	harness.equal(
		'reranker call counts match (2 above-floor sources reached the LLM on BOTH paths, s3 abstained on BOTH)',
		oldRerankCalls,
		kitRerankCalls,
	);
	harness.equal('reranker was called exactly 2 times (not 3 — the cosineFloor abstain never reaches it)', kitRerankCalls, 2);

	harness.equal(
		'BYTE-IDENTICAL raw decisions (sorted by fromStableId — decision.source.stableId) between the fused path and the composed kit',
		JSON.stringify(
			oldResults.oldDecisions
				.map((d) => ({ ...d, source: d.source }))
				.sort((a, b) => (a.source.stableId < b.source.stableId ? -1 : 1)),
		),
		JSON.stringify(
			kitResults.kitDecisions
				.map((d) => ({ ...d, source: d.source }))
				.sort((a, b) => (a.source.stableId < b.source.stableId ? -1 : 1)),
		),
	);

	harness.equal(
		'BYTE-IDENTICAL decisionBlockHash (freeze() is order-independent; same decisions -> same hash on both paths)',
		oldResults.oldFrozen.decisionBlockHash,
		kitResults.kitFrozen.decisionBlockHash,
	);
	harness.equal(
		'BYTE-IDENTICAL frozen inferredDecisions array',
		JSON.stringify(oldResults.oldFrozen.inferredDecisions),
		JSON.stringify(kitResults.kitFrozen.inferredDecisions),
	);

	harness.equal('both paths materialize exactly 2 CLOSE_MATCH edges (s1->P1, s2->P2; s3 abstained)', oldResults.oldSubgraph.counts.edgesTotal, 2);
	harness.equal('kit path materializes the SAME edge count', kitResults.kitSubgraph.counts.edgesTotal, 2);
	harness.equal(
		'BYTE-IDENTICAL materialized edge specs (type, endpoints, ALL properties incl. decisionBlockHash) between the fused path and the composed kit',
		JSON.stringify(oldResults.oldSubgraph.edges),
		JSON.stringify(kitResults.kitSubgraph.edges),
	);

	harness.report();
}
