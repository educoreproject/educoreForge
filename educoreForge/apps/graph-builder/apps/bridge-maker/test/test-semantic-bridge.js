#!/usr/bin/env node
'use strict';

// test-semantic-bridge.js — the HERMETIC gate for the INFERRED CLOSE_MATCH producer (P3a). Proves, WITHOUT
// docker / Voyage / Opus / a database (PLAN §3 hard line 2), using a DETERMINISTIC STUB llmClient + a FAKE
// vectorizer + fixed fixtures:
//
//   A. THE PURE MATERIALIZER (inferredIndex) — a FIXED decision fixture -> byte-identical CLOSE_MATCH edges,
//      each stamped closeMatch / SemanticSimilarity / embedding-inferred + the decisionBlockHash, each -> a
//      HubReference; an unresolvable targetKey is an ORPHAN (no edge); a source not materialized is a fromGap.
//   B. RETRIEVE -> FLOOR -> RERANK (inferencePipeline, STUB llmClient) — a query resolves to the expected
//      candidate (rank-1 by cosine); a below-floor source ABSTAINS (no decision target, no edge downstream).
//   C. THE FREEZE (decisionFreezer) — deterministic content address: same decisions -> same hash; a perturbed
//      decision -> a different hash; parse() round-trips the non-abstain picks.
//   D. THE PRODUCER end-to-end through bridgeMaker.run (reader/writer/decisionStore doubles + stub llm + fake
//      vectorizer): --rebridge PRODUCES a frozen block and materializes it (-> _close via a non-null
//      decisionBlock); a plain build MATERIALIZES that same block into byte-identical edges with ZERO llm /
//      ZERO vectorizer calls; a plain build with NO decision block writes NO edges (never a silent spend).
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-semantic-bridge.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the inferred CLOSE_MATCH producer (semanticBridge)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the ported inference machinery (inferredIndex, inferencePipeline, decisionFreezer) and the
     semanticBridge plugin end-to-end through bridgeMaker.run under doubles: a stub llmClient, a fake
     vectorizer, and in-memory reader/writer/decisionStore doubles. No docker, no Voyage, no Opus, no
     database. Proves the --rebridge produce-vs-materialize split, replay determinism, and no-block-no-edges.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const inferredIndexFactory = require('../lib/inferredIndex');
const inferencePipelineFactory = require('../lib/inferencePipeline');
const decisionFreezerFactory = require('../lib/decisionFreezer');
const bridgeMakerModule = require('../bridgeMaker');

// ---- shared fixtures -------------------------------------------------------------------------------
// property-tier HubReferences (the resolution targets). canonicalKey == propertyKey == the CEDS Global ID.
const referenceNodes = [
	{ stableId: 'ref/P1', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P1', propertyKey: 'P1', qualifierKeys: [] } },
	{ stableId: 'ref/P2', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P2', propertyKey: 'P2', qualifierKeys: [] } },
	{ stableId: 'ref/P3', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P3', propertyKey: 'P3', qualifierKeys: [] } },
];

// =====================================================================
harness.section('A — THE PURE MATERIALIZER (inferredIndex): fixed decisions -> byte-identical CLOSE_MATCH edges');
// =====================================================================
const DECISION_HASH = 'deadbeefcafe';
const sourceNodesA = [{ stableId: 's1' }, { stableId: 's2' }, { stableId: 's4' }]; // s4 present for an orphan target
// the materializer input contract (decisionFreezer.nonAbstainToMaterializerRow): confidence == the cosine.
const fixedDecisions = [
	{ fromStableId: 's1', targetKey: 'P1', confidence: 0.91, rerankScore: 0.91, cosineScore: 0.91, retrievalRank: 1 },
	{ fromStableId: 's2', targetKey: 'P2', confidence: 0.88, rerankScore: 0.88, cosineScore: 0.88, retrievalRank: 1 },
	{ fromStableId: 's4', targetKey: 'PZZZ', confidence: 0.7, rerankScore: 0.7, cosineScore: 0.7, retrievalRank: 2 }, // unresolvable -> orphan
	{ fromStableId: 'sGONE', targetKey: 'P3', confidence: 0.8, rerankScore: 0.8, cosineScore: 0.8, retrievalRank: 1 }, // not a source -> fromGap
];
const buildMat = () =>
	inferredIndexFactory({ subjectSource: 'CTDL', subjectVersion: 'v1', objectVersion: 'v14', mappingTool: 'semanticBridge', decisionBlockHash: DECISION_HASH })
		.buildInferredSubgraph({ inferredDecisions: fixedDecisions, sourceNodes: sourceNodesA, referenceNodes });

const subA1 = buildMat();
const subA2 = buildMat();
harness.equal('materializes exactly 2 CLOSE_MATCH edges (the 2 resolvable picks)', subA1.counts.edgesTotal, 2);
harness.equal('1 orphan (unresolvable targetKey PZZZ)', subA1.counts.orphans, 1);
harness.equal('1 fromGap (source sGONE not materialized)', subA1.counts.fromGaps, 1);
harness.ok('every edge type CLOSE_MATCH', subA1.edges.every((e) => e.type === 'CLOSE_MATCH'));
harness.ok('every edge -> a HubReference (ref/*)', subA1.edges.every((e) => `${e.toRef.id}`.indexOf('ref/') === 0));
harness.ok('every edge mappingJustification semapv:SemanticSimilarity', subA1.edges.every((e) => e.properties.mappingJustification === 'semapv:SemanticSimilarity'));
harness.ok('every edge provenanceTier embedding-inferred', subA1.edges.every((e) => e.properties.provenanceTier === 'embedding-inferred'));
harness.ok('every edge predicate closeMatch', subA1.edges.every((e) => e.properties.predicate === 'closeMatch'));
harness.ok('every edge carries the decisionBlockHash pin', subA1.edges.every((e) => e.properties.decisionBlockHash === DECISION_HASH));
harness.ok('per-edge confidence is the frozen cosine (NOT a constant 1.0)', subA1.edges.every((e) => e.properties.confidence < 1 && e.properties.confidence > 0));
harness.equal('BYTE-IDENTICAL edges across two independent materializations', JSON.stringify(subA1.edges), JSON.stringify(subA2.edges));

// =====================================================================
harness.section('C — THE FREEZE (decisionFreezer): deterministic content address + round-trip');
// =====================================================================
const freezer = decisionFreezerFactory();
const decisionsForFreeze = [
	{ source: { stableId: 's2', role: 'DmeProperty' }, abstain: false, targetKey: 'P2', cosineScore: 0.88, retrievalRank: 1, pool: [] },
	{ source: { stableId: 's1', role: 'DmeProperty' }, abstain: false, targetKey: 'P1', cosineScore: 0.91, retrievalRank: 1, pool: [] },
	{ source: { stableId: 's3', role: 'DmeProperty' }, abstain: true, abstainReason: 'cosineFloor', targetKey: null, pool: [] },
];
const pairStamp = { subjectSource: 'CTDL', subjectVersion: 'v1', objectSource: 'CEDS', objectVersion: 'v14' };
const frozen1 = freezer.freeze({ pairStamp, decisions: decisionsForFreeze });
const frozen2 = freezer.freeze({ pairStamp, decisions: decisionsForFreeze.slice().reverse() }); // order must not matter
harness.equal('freeze is deterministic + order-independent (same hash regardless of decision order)', frozen1.decisionBlockHash, frozen2.decisionBlockHash);
harness.equal('freeze extracts the 2 non-abstain picks as inferredDecisions', frozen1.inferredDecisions.length, 2);
const perturbed = decisionsForFreeze.map((d) => (d.source.stableId === 's1' ? { ...d, targetKey: 'P3' } : d));
const frozen3 = freezer.freeze({ pairStamp, decisions: perturbed });
harness.ok('perturbing ANY decision changes the hash (the pin bites)', frozen3.decisionBlockHash !== frozen1.decisionBlockHash);
const parsed = freezer.parse(frozen1.frozenText);
harness.ok('parse() round-trips the non-abstain picks', !parsed.error && parsed.inferredDecisions.length === 2 && parsed.pairStamp.subjectSource === 'CTDL');

// ---- Section B + D shared doubles (declared BEFORE B runs; B's stub callback is synchronous) ---------
// deterministic STUB reranker: always pick retrieval rank 1; never LLM-abstains (abstain only via cosineFloor).
let stubRerankCalls = 0;
const stubLlm = {
	model: 'stub-reranker-pick1',
	rerank: ({ choiceEnum } = {}, callback) => {
		stubRerankCalls++;
		void choiceEnum;
		callback('', { choice: '1', model: 'stub-reranker-pick1', attempts: 1 });
	},
};
// a FAKE vectorizer: maps a defText to its fixture vector (no Voyage). Records call count.
const textVectors = { 'src one': [0.9, 0.1, 0], 'src two': [0.1, 0.9, 0], 'src three': [0.3, 0.3, 0.3], 'ceds P1': [1, 0, 0], 'ceds P2': [0, 1, 0], 'ceds P3': [0, 0, 1] };
let vectorizerCalls = 0;
const fakeVectorizerFactory = () => ({
	batchEmbed: ({ texts }, cb) => {
		vectorizerCalls++;
		cb('', { vectors: (texts || []).map((t) => textVectors[t] || null) });
	},
});
// graph nodes in { stableId, properties } shape (SCALAR props, as the live graph stores them).
const sourceGraphNodes = [
	{ stableId: 's1', properties: { _source: 'CTDL', role: 'DmeProperty', name: 'src one', defText: 'src one' } },
	{ stableId: 's2', properties: { _source: 'CTDL', role: 'DmeProperty', name: 'src two', defText: 'src two' } },
	{ stableId: 's3', properties: { _source: 'CTDL', role: 'DmeProperty', name: 'src three', defText: 'src three' } },
];
const candidateGraphNodes = [
	{ stableId: 'c1', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds one', defText: 'ceds P1', cedsId: 'P1' } },
	{ stableId: 'c2', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds two', defText: 'ceds P2', cedsId: 'P2' } },
	{ stableId: 'c3', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds three', defText: 'ceds P3', cedsId: 'P3' } },
];

// =====================================================================
// SECTION D — driven from B's callback (both are async; declared vars above are all in scope).
// =====================================================================
function runSectionD() {
	harness.section('D — THE PRODUCER end-to-end (bridgeMaker.run): --rebridge PRODUCE, plain-build MATERIALIZE, no-block NO-edges');

	const graphReaderDouble = ({ inGraph }) => ({
		readNodes: ({ label, propertyEquals }, callback) => {
			void inGraph;
			const eq = propertyEquals || {};
			if (label === 'HubReference') { callback('', { nodes: referenceNodes }); return; }
			if (eq._source === 'CTDL' && eq.role === 'DmeProperty') { callback('', { nodes: sourceGraphNodes }); return; }
			if (eq._source === 'CEDS' && eq.role === 'DmeProperty') { callback('', { nodes: candidateGraphNodes }); return; }
			callback('', { nodes: [] });
		},
		close: (callback) => callback(''),
	});

	const decisionBlocks = {};
	const decisionStore = {
		getDecisionBlock: ({ pairKey }, cb) => cb('', decisionBlocks[pairKey] ? { frozenText: decisionBlocks[pairKey].frozenText } : { frozenText: null }),
		saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => { decisionBlocks[pairKey] = { frozenText, decisionBlockHash }; cb('', { saved: true }); },
	};

	const makeWriterDouble = (writes) => ({ inGraph }) => ({
		writeRelationshipEdge: (spec, callback) => { void inGraph; writes.push({ ...spec }); callback('', { edgeWritten: true }); },
		close: (callback) => callback(''),
	});

	const runConfig = { sourceStandard: 'CTDL', sourceVersion: 'v1', hubVersion: 'v14' };
	const inferenceConfig = { llmClient: stubLlm, topK: 15, cosineFloor: 0.6, concurrency: 4 };

	// GUARD: --rebridge without an llmClient is refused BY NAME (never a crash inside the pipeline).
	bridgeMakerModule({ graphWriterFactory: makeWriterDouble([]), graphReaderFactory: graphReaderDouble }).run(
		{
			inGraph: { graphName: 'DEV_g', boltUrl: 'bolt://x', password: 'x' },
			mapper: 'ctdlIntoCedsSemantic', hub: 'ceds', applyLabel: 'BridgedRelation',
			rebridge: true, decisionStore, inferenceConfig: {}, config: runConfig,
			componentOverrides: { vectorizer: fakeVectorizerFactory },
		},
		(guardErr) => { harness.match('--rebridge without inferenceConfig.llmClient is REFUSED by name', `${guardErr}`, /--rebridge needs inferenceConfig\.llmClient/); },
	);

	const rerankBefore = stubRerankCalls;
	const vectorizeBefore = vectorizerCalls;

	// --- D1: --rebridge produces a frozen block and materializes it ---
	const rebridgeWrites = [];
	bridgeMakerModule({ graphWriterFactory: makeWriterDouble(rebridgeWrites), graphReaderFactory: graphReaderDouble }).run(
		{
			inGraph: { graphName: 'DEV_probe', boltUrl: 'bolt://x', password: 'x' },
			mapper: 'ctdlIntoCedsSemantic', hub: 'ceds', applyLabel: 'BridgedRelation',
			rebridge: true, decisionStore, inferenceConfig, config: runConfig,
			componentOverrides: { vectorizer: fakeVectorizerFactory },
		},
		(rebErr, rebReport) => {
			harness.ok(`--rebridge run did not error (${rebErr || 'ok'})`, !rebErr, rebErr);
			harness.equal('--rebridge wrote 2 CLOSE_MATCH edges (s1->P1, s2->P2; s3 abstained)', rebReport && rebReport.edgesWritten, 2);
			harness.ok('--rebridge returned a NON-NULL decisionBlock (-> build.js _close)', rebReport && rebReport.decisionBlock != null);
			harness.equal('--rebridge counts.mode is rebridge', rebReport && rebReport.counts && rebReport.counts.mode, 'rebridge');
			harness.equal('--rebridge froze 1 abstain', rebReport && rebReport.counts && rebReport.counts.abstains, 1);
			harness.ok('the vectorizer WAS called during --rebridge', vectorizerCalls > vectorizeBefore);
			harness.ok('the reranker WAS called during --rebridge', stubRerankCalls > rerankBefore);
			harness.ok('a frozen decision block now sits in the decisionStore', !!decisionBlocks['CEDS::CTDL']);
			harness.ok('every --rebridge write is a CLOSE_MATCH -> HubReference', rebridgeWrites.every((w) => w.relationshipType === 'CLOSE_MATCH' && `${w.toStableId}`.indexOf('ref/') === 0));

			const rerankAfterRebridge = stubRerankCalls;
			const vectorizeAfterRebridge = vectorizerCalls;

			// --- D2: a plain build MATERIALIZES the SAME block into byte-identical edges, ZERO llm/vectorizer ---
			const matWrites = [];
			bridgeMakerModule({ graphWriterFactory: makeWriterDouble(matWrites), graphReaderFactory: graphReaderDouble }).run(
				{
					inGraph: { graphName: 'DEV_probe2', boltUrl: 'bolt://x', password: 'x' },
					mapper: 'ctdlIntoCedsSemantic', hub: 'ceds', applyLabel: 'BridgedRelation',
					rebridge: false, decisionStore, inferenceConfig, config: runConfig,
					componentOverrides: { vectorizer: fakeVectorizerFactory },
				},
				(matErr, matReport) => {
					harness.ok(`plain-build materialize did not error (${matErr || 'ok'})`, !matErr, matErr);
					harness.equal('materialize wrote the SAME 2 CLOSE_MATCH edges', matReport && matReport.edgesWritten, 2);
					harness.equal('materialize counts.mode is materialize', matReport && matReport.counts && matReport.counts.mode, 'materialize');
					harness.equal('materialize decisionBlock hash EQUALS the rebridge hash (replay pins to the same block)', matReport && matReport.decisionBlock, rebReport.decisionBlock);
					harness.equal('materialize made ZERO reranker calls (no LLM on replay)', stubRerankCalls, rerankAfterRebridge);
					harness.equal('materialize made ZERO vectorizer calls (no Voyage on replay)', vectorizerCalls, vectorizeAfterRebridge);
					harness.equal('replay edges BYTE-IDENTICAL to rebridge edges', JSON.stringify(matWrites), JSON.stringify(rebridgeWrites));

					// --- D3: a plain build with NO decision block writes NO edges (never a silent spend) ---
					const emptyStore = { getDecisionBlock: ({ pairKey }, cb) => { void pairKey; cb('', { frozenText: null }); }, saveDecisionBlock: (a, cb) => cb('') };
					const noWrites = [];
					bridgeMakerModule({ graphWriterFactory: makeWriterDouble(noWrites), graphReaderFactory: graphReaderDouble }).run(
						{
							inGraph: { graphName: 'DEV_probe3', boltUrl: 'bolt://x', password: 'x' },
							mapper: 'ctdlIntoCedsSemantic', hub: 'ceds', applyLabel: 'BridgedRelation',
							rebridge: false, decisionStore: emptyStore, inferenceConfig, config: runConfig,
							componentOverrides: { vectorizer: fakeVectorizerFactory },
						},
						(nbErr, nbReport) => {
							harness.ok(`no-block build did not error (${nbErr || 'ok'})`, !nbErr, nbErr);
							harness.equal('no decision block -> 0 inferred edges written', nbReport && nbReport.edgesWritten, 0);
							harness.equal('no decision block -> decisionBlock null (never a silent spend)', nbReport && nbReport.decisionBlock, null);
							harness.ok('no decision block -> counts.noDecisionBlock flag set', nbReport && nbReport.counts && nbReport.counts.noDecisionBlock === true);
							harness.equal('no writes reached the graph', noWrites.length, 0);

							harness.report();
						},
					);
				},
			);
		},
	);
}

// =====================================================================
harness.section('B — RETRIEVE -> FLOOR -> RERANK (inferencePipeline, STUB llmClient)');
// =====================================================================
// 3-dim fixture vectors: s1~c1(P1), s2~c2(P2), s3 orthogonal -> best cosine ~0.577 < floor 0.6 -> abstain.
const cand = candidateGraphNodes.map((n) => ({ stableId: n.stableId, cedsId: n.properties.cedsId, role: 'DmeProperty', name: n.properties.name, defText: n.properties.defText, vector: textVectors[n.properties.defText] }));
const srcs = sourceGraphNodes.map((n) => ({ stableId: n.stableId, role: 'DmeProperty', name: n.properties.name, defText: n.properties.defText, vector: textVectors[n.properties.defText] }));
const pipeline = inferencePipelineFactory({ llmClient: stubLlm, topK: 15, cosineFloor: 0.6, concurrency: 4 });
pipeline.processSources(
	{ sources: srcs, candidatePoolByRole: { DmeProperty: cand }, sourceClassIndex: {}, candidateClassIndex: {} },
	(err, out) => {
		harness.ok(`pipeline did not error (${err || 'ok'})`, !err, err);
		const byId = {};
		(out.decisions || []).forEach((d) => { byId[d.source.stableId] = d; });
		harness.ok('s1 resolves to the expected candidate P1 (rank-1 by cosine, stub picks 1)', byId.s1 && !byId.s1.abstain && byId.s1.targetKey === 'P1');
		harness.ok('s2 resolves to the expected candidate P2', byId.s2 && !byId.s2.abstain && byId.s2.targetKey === 'P2');
		harness.ok('s3 ABSTAINS below the cosineFloor (no LLM reached for it)', byId.s3 && byId.s3.abstain && byId.s3.abstainReason === 'cosineFloor');
		harness.equal('the stub reranker was called ONCE per above-floor source (2), never for the abstain', stubRerankCalls, 2);

		// the abstain-boundary invariant: feeding these decisions to the materializer yields edges ONLY for picks.
		const picks = (out.decisions || []).filter((d) => !d.abstain).map((d) => ({ fromStableId: d.source.stableId, targetKey: d.targetKey, confidence: d.cosineScore, cosineScore: d.cosineScore, retrievalRank: d.retrievalRank }));
		const subB = inferredIndexFactory({ subjectSource: 'CTDL' }).buildInferredSubgraph({ inferredDecisions: picks, sourceNodes: srcs, referenceNodes });
		harness.equal('materializer emits 2 edges (the 2 picks); the abstain yields NONE', subB.counts.edgesTotal, 2);

		runSectionD();
	},
);
