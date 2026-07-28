#!/usr/bin/env node
'use strict';

// test-generic-bridge-equivalence.js — THE PHASE-2 BOUNDARY GATE (bridgeKitRefactor_072726 spec §6
// Phase 2). Proves, hermetically (no container, no Voyage, no Opus, a stubbed llmClient + a fake
// vectorizer + graphWriter/graphReader/decisionStore doubles — §3 hard line 2):
//
//   PART A — genericBridge's OWN fault twins (unit-level, calling the module directly with hand-built
//            kit doubles): every wiring refusal genericBridge makes is proven RED (the fault injected)
//            then GREEN (the corresponding correct case), the same discipline test-bridge-maker.js and
//            every lib.d suite already apply.
//
//   PART B — THE EQUIVALENCE GATE: driven through the REAL bridgeMaker.run() (the real resolver, the
//            real additive kit-building bridgeMaker.js now does for every run), genericBridge
//            (forges/bridges/) produces the SAME edges as semanticBridge (bridge-maker/bridges/) over
//            IDENTICAL inputs, in BOTH modes:
//              - REBRIDGE: same fixture graph, same stub llmClient behavior, same fake vectorizer ->
//                byte-identical decisionBlockHash and byte-identical materialized edges (mappingTool
//                excluded from the comparison — see the note at PART B's top; it is an IDENTITY stamp,
//                not a behavior, and each bridge honestly stamps its own name).
//              - MATERIALIZE: the SAME real frozen block (produced by the rebridge above) fed into
//                BOTH bridges' plain-build path -> byte-identical replayed edges, ZERO llm/vectorizer
//                calls on either side.
//
//   PART C — RESOLVER CHECK: 'genericBridge' resolves to EXACTLY ONE file across the whole search path
//            (forges/bridges/genericBridge.js), and the old library-scope placeholder
//            (bridge-maker/bridges/genericBridge.js) no longer exists on disk.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-generic-bridge-equivalence.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- THE PHASE-2 BOUNDARY GATE: genericBridge (kit) vs. semanticBridge (fused), both modes

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves genericBridge's own wiring refusals (RED then GREEN), and drives genericBridge and
     semanticBridge through the real bridgeMaker.run() over identical hermetic fixtures, asserting
     byte-identical decisions/edges in both REBRIDGE and MATERIALIZE modes. Also proves the resolver
     now finds genericBridge uniquely in forges/bridges/, with the old placeholder gone.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const { taskListPlus, pipeRunner } = new require('qtools-asynchronous-pipe-plus')();

const bridgeMakerModule = require('../bridgeMaker');
const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const genericBridgeFactory = require(path.join(TREE_ROOT, 'forges', 'bridges', 'genericBridge'));

// =====================================================================
// PART A — genericBridge's OWN fault twins (unit-level, direct calls, no bridgeMaker involved)
// =====================================================================
harness.section('PART A — genericBridge fault twins: every wiring refusal is RED then GREEN');

const noopGraphReader = { readNodes: (spec, cb) => { void spec; cb('', { nodes: [] }); }, close: (cb) => cb('') };
const noopSourceWalker = { walk: (spec, cb) => { void spec; cb('', { sourceNodes: [] }); } };
const noopDecisionFreezer = {
	freeze: () => ({ frozenText: '{}', decisionBlockHash: 'h', inferredDecisions: [] }),
	parse: () => ({ inferredDecisions: [] }),
};
const noopMaterializerFactory = () => ({
	buildInferredSubgraph: () => ({ edges: [], counts: { orphans: 0, fromGaps: 0 } }),
});
const noopWriter = (spec, cb) => { void spec; cb('', { edgeWritten: true }); };
const noBlockDecisionStore = {
	getDecisionBlock: (a, cb) => { void a; cb('', { frozenText: null }); },
	saveDecisionBlock: (a, cb) => { void a; cb(''); },
};

// baseKit — a minimal, valid MATERIALIZE-mode kit (no frozen block for the pair, so genericBridge's
// runMaterialize returns before any of these stub members actually do meaningful work). Each RED case
// below starts from this and breaks EXACTLY one thing.
const baseKit = (overrides = {}) => ({
	config: { sourceStandard: 'lif' },
	decisionStore: noBlockDecisionStore,
	rebridge: false,
	graphReader: noopGraphReader,
	sourceWalker: noopSourceWalker,
	decisionFreezer: noopDecisionFreezer,
	materializer: noopMaterializerFactory,
	writer: noopWriter,
	vectorizer: null,
	candidateFinder: null,
	selector: null,
	...overrides,
});

const runDirect = (injectedTools, spec, done) => genericBridgeFactory(injectedTools)(spec, done);

const BASE_ARGS = { inGraph: { graphName: 'DEV_probe' }, hub: 'ceds', applyLabel: 'BridgedRelation' };

// ---- GREEN (the base case every RED below perturbs) ----
(() => {
	let observed = null;
	runDirect({ kit: baseKit() }, BASE_ARGS, (err, result) => { observed = { err, result }; });
	harness.equal('GREEN base case: a valid materialize-no-block kit runs with no error', observed && observed.err, '');
	harness.ok(
		'  and returns the honest zero-edge / null-decisionBlock status',
		observed && observed.result && observed.result.edgesWritten === 0 && observed.result.decisionBlock === null,
		`result was ${JSON.stringify(observed && observed.result)}`,
	);
})();

// ---- RED #1 — no kit at all ----
(() => {
	let observed = null;
	runDirect({}, BASE_ARGS, (err) => { observed = err; });
	harness.rejects('RED: injectedTools.kit is not given is refused by name', [observed], /injectedTools\.kit is not given/);
})();

// ---- RED #2 — kit given, but no decisionStore ----
(() => {
	let observed = null;
	runDirect({ kit: baseKit({ decisionStore: null }) }, BASE_ARGS, (err) => { observed = err; });
	harness.rejects('RED: kit.decisionStore missing is refused by name', [observed], /kit\.decisionStore .*REQUIRED/);
})();

// ---- RED #3 — --rebridge requested, but kit was built with no selector (no llmClient) ----
(() => {
	let observed = null;
	runDirect(
		{ kit: baseKit({ rebridge: true, vectorizer: {}, candidateFinder: {}, selector: null }) },
		BASE_ARGS,
		(err) => { observed = err; },
	);
	harness.rejects(
		'RED: --rebridge with kit.selector null (no llmClient injected) is refused by name',
		[observed],
		/kit\.selector is missing.*--rebridge needs a kit built with inferenceConfig\.llmClient/s,
	);
	// The positive twin of this gate — a --rebridge kit WITH a real selector completing successfully
	// end-to-end — is PART B's REBRIDGE equivalence run below, which is a strictly stronger proof than
	// a synthetic minimal fixture would be here.
})();

// ---- RED #4 — hub mismatch (this bridge bridges toward CEDS only, Phase-2 parity) ----
(() => {
	let observed = null;
	runDirect({ kit: baseKit() }, { ...BASE_ARGS, hub: 'sif' }, (err) => { observed = err; });
	harness.rejects('RED: hub other than CEDS is refused by name', [observed], /hub is 'sif'.*CEDS hub only/);
})();

// ---- RED #5 — config.sourceStandard not set ----
(() => {
	let observed = null;
	runDirect({ kit: baseKit({ config: {} }) }, BASE_ARGS, (err) => { observed = err; });
	harness.rejects('RED: config.sourceStandard not set is refused by name', [observed], /config\.sourceStandard is not set/);
})();

// ---- RED #6 — applyLabel not given ----
(() => {
	let observed = null;
	const { applyLabel, ...withoutLabel } = BASE_ARGS;
	void applyLabel;
	runDirect({ kit: baseKit() }, withoutLabel, (err) => { observed = err; });
	harness.rejects('RED: applyLabel not given is refused by name', [observed], /applyLabel/);
})();

// ---- RED #7 — inGraph not given ----
(() => {
	let observed = null;
	const { inGraph, ...withoutGraph } = BASE_ARGS;
	void inGraph;
	runDirect({ kit: baseKit() }, withoutGraph, (err) => { observed = err; });
	harness.rejects('RED: inGraph not given is refused by name', [observed], /inGraph is not given/);
})();

// =====================================================================
// PART B — THE EQUIVALENCE GATE: genericBridge vs. semanticBridge, driven through the REAL
// bridgeMaker.run(), over IDENTICAL hermetic fixtures.
// =====================================================================
harness.section('PART B — genericBridge vs. semanticBridge through bridgeMaker.run(): identical inputs, identical edges');

// NOTE ON mappingTool — the ONE deliberate, honest difference. inferredIndex.js stamps
// properties.mappingTool with whatever mappingTool the calling bridge composes its materializer with;
// semanticBridge stamps 'semanticBridge', genericBridge stamps 'genericBridge' (each bridge's own
// name — the SAME identity-provenance convention every producer in this tree follows, not a behavior
// difference). decisionBlockHash is UNAFFECTED (decisionFreezer's frozen record never carries
// mappingTool — only fromStableId/role/abstain/targetKey/scores), so the freeze/replay proof is
// asserted byte-identical with NO normalization; the materialized EDGES are asserted byte-identical
// after normalizing away exactly this one field, called out explicitly rather than silently ignored.
const normalizeMappingTool = (writes) =>
	writes.map((oneWrite) => ({ ...oneWrite, properties: { ...oneWrite.properties, mappingTool: 'NORMALIZED_MAPPING_TOOL' } }));

// ---- shared fixture (property-tier only — LIF pilot; design §1) ----
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

const graphReaderDouble = ({ inGraph }) => ({
	readNodes: ({ label, propertyEquals }, callback) => {
		void inGraph;
		const eq = propertyEquals || {};
		if (label === 'HubReference') { callback('', { nodes: referenceNodes }); return; }
		if (eq._source === 'LIF' && eq.role === 'DmeProperty') { callback('', { nodes: sourceGraphNodes }); return; }
		if (eq._source === 'CEDS' && eq.role === 'DmeProperty') { callback('', { nodes: candidateGraphNodes }); return; }
		callback('', { nodes: [] });
	},
	close: (callback) => callback(''),
});

const makeWriterDouble = (writes) => ({ inGraph }) => ({
	writeRelationshipEdge: (spec, callback) => { void inGraph; writes.push({ ...spec }); callback('', { edgeWritten: true }); },
	close: (callback) => callback(''),
});

const fakeVectorizerFactory = () => ({
	batchEmbed: ({ texts }, cb) => cb('', { vectors: (texts || []).map((t) => textVectors[t] || null) }),
});

// SAME config object handed to BOTH bridges — literally identical inputs, not just equal-shaped ones.
const runConfig = { sourceStandard: 'lif', sourceVersion: 'v1', hubVersion: 'v14' };

// deterministic stub rerankers — always pick retrieval rank 1 (abstain only via the 0.6 cosineFloor,
// which s3 falls below — 3-dim fixture: s1~c1(P1), s2~c2(P2), s3 orthogonal). Tracked per bridge.
let semanticRerankCalls = 0;
let genericRerankCalls = 0;
const semanticStubLlm = { rerank: (a, cb) => { semanticRerankCalls++; void a; cb('', { choice: '1' }); } };
const genericStubLlm = { rerank: (a, cb) => { genericRerankCalls++; void a; cb('', { choice: '1' }); } };

// =====================================================================
// B1 — REBRIDGE: both bridges, fresh empty decisionStores, run in parallel-equivalent isolation.
// =====================================================================
const decisionBlocksSemantic = {};
const decisionStoreSemantic = {
	getDecisionBlock: ({ pairKey }, cb) => cb('', decisionBlocksSemantic[pairKey] ? { frozenText: decisionBlocksSemantic[pairKey].frozenText } : { frozenText: null }),
	saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => { decisionBlocksSemantic[pairKey] = { frozenText, decisionBlockHash }; cb('', { saved: true }); },
};
const decisionBlocksGeneric = {};
const decisionStoreGeneric = {
	getDecisionBlock: ({ pairKey }, cb) => cb('', decisionBlocksGeneric[pairKey] ? { frozenText: decisionBlocksGeneric[pairKey].frozenText } : { frozenText: null }),
	saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => { decisionBlocksGeneric[pairKey] = { frozenText, decisionBlockHash }; cb('', { saved: true }); },
};

const semanticRebridgeWrites = [];
const genericRebridgeWrites = [];

const runSemanticRebridge = (done) => {
	bridgeMakerModule({ graphWriterFactory: makeWriterDouble(semanticRebridgeWrites), graphReaderFactory: graphReaderDouble }).run(
		{
			inGraph: { graphName: 'DEV_semantic_rb', boltUrl: 'bolt://x', password: 'x' },
			bridge: 'semanticBridge', hub: 'ceds', applyLabel: 'BridgedRelation',
			rebridge: true, decisionStore: decisionStoreSemantic,
			inferenceConfig: { llmClient: semanticStubLlm, topK: 15, cosineFloor: 0.6, concurrency: 4 },
			config: runConfig,
			componentOverrides: { vectorizer: fakeVectorizerFactory, graphReader: graphReaderDouble },
		},
		done,
	);
};
const runGenericRebridge = (done) => {
	bridgeMakerModule({ graphWriterFactory: makeWriterDouble(genericRebridgeWrites), graphReaderFactory: graphReaderDouble }).run(
		{
			inGraph: { graphName: 'DEV_generic_rb', boltUrl: 'bolt://x', password: 'x' },
			bridge: 'genericBridge', hub: 'ceds', applyLabel: 'BridgedRelation',
			rebridge: true, decisionStore: decisionStoreGeneric,
			inferenceConfig: { llmClient: genericStubLlm, topK: 15, cosineFloor: 0.6, concurrency: 4 },
			config: runConfig,
			componentOverrides: { vectorizer: fakeVectorizerFactory, graphReader: graphReaderDouble },
		},
		done,
	);
};

runSemanticRebridge((semanticErr, semanticReport) => {
	harness.ok(`semanticBridge --rebridge did not error (${semanticErr || 'ok'})`, !semanticErr, semanticErr);

	runGenericRebridge((genericErr, genericReport) => {
		harness.ok(`genericBridge --rebridge did not error (${genericErr || 'ok'})`, !genericErr, genericErr);

		harness.equal('B1: both rerankers were called the SAME number of times (2 above-floor sources; s3 abstains on both)', semanticRerankCalls, genericRerankCalls);
		harness.equal('  reranker called exactly 2 times (cosineFloor abstain never reaches it)', genericRerankCalls, 2);
		harness.equal('B1: both bridges wrote the SAME edge count (2)', semanticReport && semanticReport.edgesWritten, genericReport && genericReport.edgesWritten);
		harness.equal('  2 edges written', genericReport && genericReport.edgesWritten, 2);

		harness.equal(
			'B1: BYTE-IDENTICAL decisionBlockHash (mappingTool is not part of the frozen record, so no normalization needed here)',
			semanticReport && semanticReport.decisionBlock,
			genericReport && genericReport.decisionBlock,
		);

		const semanticNormalized = normalizeMappingTool(semanticRebridgeWrites).sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : 1));
		const genericNormalized = normalizeMappingTool(genericRebridgeWrites).sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : 1));
		harness.equal(
			'B1: BYTE-IDENTICAL materialized edges (endpoints, type, ALL properties incl. decisionBlockHash/confidence/cosineScore) modulo the one honest mappingTool identity stamp',
			JSON.stringify(semanticNormalized),
			JSON.stringify(genericNormalized),
		);
		harness.ok(
			'  and the un-normalized mappingTool DOES honestly differ (each bridge stamps its own name — proving the normalization is not hiding a REAL divergence)',
			semanticRebridgeWrites.every((w) => w.properties.mappingTool === 'semanticBridge') &&
				genericRebridgeWrites.every((w) => w.properties.mappingTool === 'genericBridge'),
			`semantic mappingTools=${JSON.stringify(semanticRebridgeWrites.map((w) => w.properties.mappingTool))}, generic=${JSON.stringify(genericRebridgeWrites.map((w) => w.properties.mappingTool))}`,
		);

		runMaterializeComparison(semanticReport.decisionBlock);
	});
});

// =====================================================================
// B2 — MATERIALIZE: the SAME real frozen block (from B1's rebridge) fed into BOTH bridges' plain
// build path. ZERO llm / ZERO vectorizer calls on either side; byte-identical replayed edges.
// =====================================================================
function runMaterializeComparison(rebridgeDecisionBlockHash) {
	harness.section('B2 — MATERIALIZE: the SAME frozen block replayed through both bridges, ZERO llm/vectorizer');

	const frozenText = decisionBlocksSemantic['CEDS::LIF'].frozenText;
	harness.ok('a real frozen block exists to replay (produced by B1\'s rebridge)', !!frozenText, 'no frozen block was saved');

	const sharedFrozenStore = () => ({
		getDecisionBlock: (a, cb) => { void a; cb('', { frozenText }); },
		saveDecisionBlock: (a, cb) => cb(''),
	});

	const rerankBefore = semanticRerankCalls + genericRerankCalls;

	const semanticMaterializeWrites = [];
	const genericMaterializeWrites = [];

	bridgeMakerModule({ graphWriterFactory: makeWriterDouble(semanticMaterializeWrites), graphReaderFactory: graphReaderDouble }).run(
		{
			inGraph: { graphName: 'DEV_semantic_mat', boltUrl: 'bolt://x', password: 'x' },
			bridge: 'semanticBridge', hub: 'ceds', applyLabel: 'BridgedRelation',
			rebridge: false, decisionStore: sharedFrozenStore(),
			inferenceConfig: { llmClient: semanticStubLlm, topK: 15, cosineFloor: 0.6 },
			config: runConfig,
			componentOverrides: { vectorizer: fakeVectorizerFactory, graphReader: graphReaderDouble },
		},
		(semMatErr, semMatReport) => {
			harness.ok(`semanticBridge materialize did not error (${semMatErr || 'ok'})`, !semMatErr, semMatErr);

			bridgeMakerModule({ graphWriterFactory: makeWriterDouble(genericMaterializeWrites), graphReaderFactory: graphReaderDouble }).run(
				{
					inGraph: { graphName: 'DEV_generic_mat', boltUrl: 'bolt://x', password: 'x' },
					bridge: 'genericBridge', hub: 'ceds', applyLabel: 'BridgedRelation',
					rebridge: false, decisionStore: sharedFrozenStore(),
					inferenceConfig: { llmClient: genericStubLlm, topK: 15, cosineFloor: 0.6 },
					config: runConfig,
					componentOverrides: { vectorizer: fakeVectorizerFactory, graphReader: graphReaderDouble },
				},
				(genMatErr, genMatReport) => {
					harness.ok(`genericBridge materialize did not error (${genMatErr || 'ok'})`, !genMatErr, genMatErr);

					harness.equal('B2: ZERO reranker calls on either side during replay', semanticRerankCalls + genericRerankCalls, rerankBefore);
					harness.equal('B2: both replays wrote the SAME edge count (2)', semMatReport && semMatReport.edgesWritten, genMatReport && genMatReport.edgesWritten);
					harness.equal(
						'B2: both replays pin to the SAME decisionBlockHash as the rebridge that produced the block',
						semMatReport && semMatReport.decisionBlock,
						rebridgeDecisionBlockHash,
					);
					harness.equal('  genericBridge replay pins to the SAME hash too', genMatReport && genMatReport.decisionBlock, rebridgeDecisionBlockHash);

					const semNorm = normalizeMappingTool(semanticMaterializeWrites).sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : 1));
					const genNorm = normalizeMappingTool(genericMaterializeWrites).sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : 1));
					harness.equal(
						'B2: BYTE-IDENTICAL replayed edges (modulo the one honest mappingTool identity stamp)',
						JSON.stringify(semNorm),
						JSON.stringify(genNorm),
					);

					runResolverCheck();
				},
			);
		},
	);
}

// =====================================================================
// PART C — RESOLVER CHECK: 'genericBridge' resolves to EXACTLY ONE file, and it is forges/bridges/,
// and the old library-scope placeholder is GONE.
// =====================================================================
function runResolverCheck() {
	harness.section('PART C — RESOLVER: genericBridge resolves uniquely from forges/bridges/; the old placeholder is gone');

	const oldPlaceholderPath = path.join(__dirname, '..', 'bridges', 'genericBridge.js');
	harness.ok(
		'the OLD library-scope placeholder file no longer exists on disk',
		!fs.existsSync(oldPlaceholderPath),
		`still found at ${oldPlaceholderPath}`,
	);

	const newPath = path.join(TREE_ROOT, 'forges', 'bridges', 'genericBridge.js');
	harness.ok('the NEW forges-shared genericBridge.js exists on disk', fs.existsSync(newPath), `not found at ${newPath}`);

	const resolved = bridgeMakerModule.resolveBridgePlugin({ bridge: 'genericBridge' });
	harness.ok(
		"'genericBridge' resolves through the real search path (no source given -> forges-shared + library scopes only)",
		!!resolved && !resolved.error && typeof resolved.pluginFactory === 'function',
		`got ${JSON.stringify(resolved)}`,
	);
	harness.equal('  and the resolved file IS forges/bridges/genericBridge.js', resolved.resolvedPath, newPath);

	// a bridge name resolving in >1 directory THROWS (ambiguity) — confirm 'genericBridge' does NOT,
	// across ALL THREE scopes this time (source given, so the standard-local scope also joins the
	// search — still just the one file in forges-shared).
	let threw = null;
	try {
		bridgeMakerModule.resolveBridgePlugin({ bridge: 'genericBridge', source: 'lif' });
	} catch (ambiguityError) {
		threw = ambiguityError;
	}
	harness.ok('  and resolving WITH a source token (all three scopes searched) still finds exactly one file', !threw, threw && threw.message);

	harness.report();
}
