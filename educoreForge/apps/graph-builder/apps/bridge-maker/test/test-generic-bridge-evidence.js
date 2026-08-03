#!/usr/bin/env node
'use strict';

// test-generic-bridge-evidence.js — THE PHASE-4 PORT GATE (bridgeEvidenceRefactor-spec.md §7 P4).
//
// ⟪TOMBSTONE — test-generic-bridge-equivalence.js, RETIRED by this phase⟫
// That suite proved genericBridge (forges/bridges/) produced BYTE-IDENTICAL decisions and edges to
// semanticBridge (bridge-maker/bridges/) over identical hermetic fixtures, in both REBRIDGE and
// MATERIALIZE modes — the Phase-2/3 claim that genericBridge was "the skeleton filled for the generic
// SCALAR case," reproducing the SAME cosine-pool-rerank pipeline semanticBridge's own inline logic ran.
// Phase 4 makes that claim FALSE BY DESIGN, on purpose: genericBridge is now the EVIDENCE-MODE
// demonstrator (composer -> ⟪A3⟫ gate -> renderer -> category-out select -> normalizer -> evidence
// freezer), a STRUCTURALLY DIFFERENT pipeline from semanticBridge's scalar cosine-rerank flow (⟪A9⟫:
// semanticBridge survives BYTE-UNTOUCHED as the comparator, precisely so a genuine A/B against the OLD
// approach remains possible later, not so the two bridges keep agreeing edge-for-edge). Asserting
// equivalence between them now would be asserting a falsehood the whole phase exists to create. This
// suite replaces it: the hermetic proof that genericBridge runs the FULL EVIDENCE FLOW correctly, in
// both modes, every step gated by its own REAL contract oracle (evidenceContracts.js) — never merely
// this suite's own assertions.
//
// PROVES:
//   PART A — genericBridge's OWN wiring-fault twins (unit-level, direct calls with hand-built kit
//            doubles): every refusal — missing kit, missing decisionStore, --rebridge with no
//            kit.inferenceConfig.llmClient, hub mismatch, missing config.sourceStandard, missing
//            applyLabel/inGraph — is proven RED (the fault injected) then GREEN (the corresponding
//            correct case), the same discipline every other bridge-maker suite applies.
//   PART B — THE FULL EVIDENCE FLOW, driven through the REAL bridgeMaker.run() (the real resolver, the
//            real kitLoader.buildKit), a STUBBED llmClient (no real Anthropic call), a fake vectorizer,
//            and graphWriter/graphReader/decisionStore doubles:
//              REBRIDGE — two sources, one a strong match (category 'strong', confidence normalizes to
//                exactly the 'strong' band ceiling at cosine 1.0) and one an honest abstain (category
//                'none'). Proves: the ⟪A3⟫ evidence-package gate passes for every composed package: the
//                decision block self-describes generation + RENDERER_VERSION (⟪A6⟫); the written edge's
//                `confidence` property is the NORMALIZED value (R-b: not the raw cosine); category/
//                rationale do NOT ride as edge properties (R-b disposition) but ARE byte-recoverable
//                from the frozen block's frozenEvidence[i].judgment; the abstaining source produces NO
//                edge.
//              MATERIALIZE — the SAME frozen block replayed: byte-identical edgesWritten/decisionBlock/
//                confidence, and ZERO additional llmClient.rerank calls (pure replay, no re-judgment).
//              OBSERVED-RED refusal twins (⟪hubReimplementation P3, 2026-08-03,
//                SPEC-hubReimplementation-080326.md §6⟫): the bridge CONSUMES the self-sufficient card
//                — every candidate's vector is the card's own forge-stamped `embedding` (ONLY source
//                embedTexts ever reach kit.vectorizer.batchEmbed, gate G-15) — so a candidate missing
//                its `embedding` (or its stored `embedText`) is refused BY NAME, naming that candidate;
//                the bridge never re-embeds or recomposes a candidate.
//   PART C — RESOLVER CHECK: 'genericBridge' still resolves to exactly ONE file
//            (forges/bridges/genericBridge.js) across bridgeMaker's search path.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-generic-bridge-evidence.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- THE P4 PORT GATE: genericBridge on the evidence path, both modes, hermetic

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves genericBridge's own wiring refusals (RED then GREEN), and drives the full evidence flow
     (compose -> ⟪A3⟫ gate -> render -> select -> normalize -> freeze -> materialize -> write) through
     the REAL bridgeMaker.run() in both REBRIDGE and MATERIALIZE modes, with a stubbed llmClient. Also
     confirms the bridge still resolves uniquely. Replaces test-generic-bridge-equivalence.js (retired —
     see the tombstone comment at the top of this file).

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const bridgeMakerModule = require('../bridgeMaker');
const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const genericBridgeFactory = require(path.join(TREE_ROOT, 'forges', 'bridges', 'genericBridge'));
const evidenceFreezerFactory = require('../lib/evidenceFreezer');
const { evidencePackageViolation, hubModulePresentationViolation } = require('../lib/evidenceContracts');

// =====================================================================
// PART A — genericBridge fault twins (unit-level, direct calls, no bridgeMaker involved)
// =====================================================================
harness.section('PART A — genericBridge fault twins: every wiring refusal is RED then GREEN');

const noopGraphReader = { readNodes: (spec, cb) => { void spec; cb('', { nodes: [] }); }, close: (cb) => cb('') };
const noopSourceWalker = { walk: (spec, cb) => { void spec; cb('', { sourceNodes: [] }); } };
const noopEvidenceFreezer = {
	freeze: () => ({ frozenText: '{}', decisionBlockHash: 'h', inferredDecisions: [], generation: 'g', rendererVersion: 'r', frozenEvidence: [] }),
	parse: () => ({ inferredDecisions: [], frozenEvidence: [] }),
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
	config: { sourceStandard: 'lif', sourceStandardName: 'LIF' },
	decisionStore: noBlockDecisionStore,
	rebridge: false,
	graphReader: noopGraphReader,
	sourceWalker: noopSourceWalker,
	evidenceFreezer: noopEvidenceFreezer,
	materializer: noopMaterializerFactory,
	writer: noopWriter,
	vectorizer: null,
	semanticMatcher: null,
	evidenceComposer: null,
	cedsHubModule: null,
	evidenceRenderer: null,
	evidenceSelect: null,
	confidenceNormalizer: null,
	inferenceConfig: {},
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

// ---- RED #3 — --rebridge requested, but kit was built with no evidence-path members wired ----
(() => {
	let observed = null;
	runDirect({ kit: baseKit({ rebridge: true }) }, BASE_ARGS, (err) => { observed = err; });
	harness.rejects(
		'RED: --rebridge with the evidence-path kit members missing is refused by name',
		[observed],
		/kit\.(vectorizer|semanticMatcher|evidenceComposer|cedsHubModule|evidenceRenderer|evidenceSelect|confidenceNormalizer) is missing/,
	);
})();

// ---- RED #4 — --rebridge requested, evidence-path members present, but NO llmClient ----
(() => {
	let observed = null;
	runDirect(
		{
			kit: baseKit({
				rebridge: true,
				vectorizer: {},
				semanticMatcher: {},
				evidenceComposer: () => {},
				cedsHubModule: () => {},
				evidenceRenderer: { render: () => {}, RENDERER_VERSION: 'v1' },
				evidenceSelect: () => {},
				confidenceNormalizer: () => {},
				inferenceConfig: {},
			}),
		},
		BASE_ARGS,
		(err) => { observed = err; },
	);
	harness.rejects(
		'RED: --rebridge with kit.inferenceConfig.llmClient missing is refused by name',
		[observed],
		/kit\.inferenceConfig\.llmClient .*is missing.*SELECT_SHAPE/s,
	);
	// The positive twin of this gate — a --rebridge kit WITH a real llmClient completing successfully
	// end-to-end — is PART B's REBRIDGE run below, a strictly stronger proof than a synthetic minimal
	// fixture would be here.
})();

// ---- RED #5 — hub mismatch (this bridge bridges toward CEDS only) ----
(() => {
	let observed = null;
	runDirect({ kit: baseKit() }, { ...BASE_ARGS, hub: 'sif' }, (err) => { observed = err; });
	harness.rejects('RED: hub other than CEDS is refused by name', [observed], /hub is 'sif'.*CEDS hub only/);
})();

// ---- RED #6 — config.sourceStandard not set ----
(() => {
	let observed = null;
	runDirect({ kit: baseKit({ config: {} }) }, BASE_ARGS, (err) => { observed = err; });
	harness.rejects('RED: config.sourceStandard not set is refused by name', [observed], /config\.sourceStandard is not set/);
})();

// ---- RED #7 — applyLabel not given ----
(() => {
	let observed = null;
	const { applyLabel, ...withoutLabel } = BASE_ARGS;
	void applyLabel;
	runDirect({ kit: baseKit() }, withoutLabel, (err) => { observed = err; });
	harness.rejects('RED: applyLabel not given is refused by name', [observed], /applyLabel/);
})();

// ---- RED #8 — inGraph not given ----
(() => {
	let observed = null;
	const { inGraph, ...withoutGraph } = BASE_ARGS;
	void inGraph;
	runDirect({ kit: baseKit() }, withoutGraph, (err) => { observed = err; });
	harness.rejects('RED: inGraph not given is refused by name', [observed], /inGraph is not given/);
})();

// ---- RED #9 — config.evidenceJudgeConcurrency malformed (p8-judgeConcurrency's one new refusal) ----
(() => {
	let observed = null;
	runDirect({ kit: baseKit({ config: { sourceStandard: 'lif', sourceStandardName: 'LIF', evidenceJudgeConcurrency: 2.5 } }) }, BASE_ARGS, (err) => { observed = err; });
	harness.rejects(
		'RED: a non-positive-integer config.evidenceJudgeConcurrency is refused by name',
		[observed],
		/config\.evidenceJudgeConcurrency is 2\.5.*positive integer/s,
	);
})();

// =====================================================================
// PART B — THE FULL EVIDENCE FLOW, driven through the REAL bridgeMaker.run()
// =====================================================================
harness.section('PART B — genericBridge, evidence mode, through bridgeMaker.run(): compose -> gate -> render -> select -> normalize -> freeze -> materialize -> write');

// ---- shared fixture ----
// ONE strong-match candidate (property tier, unqualified) + ONE distractor — both in the
// ⟪hubReimplementation P3⟫ SELF-SUFFICIENT card shape (SPEC-hubReimplementation-080326.md §1/§6):
// ADDRESS + IDENTITY + MEANING (domainName/domainDefinition, propertyName/propertyDefinition, range
// prose) + DERIVED (embedText, embedding) all ON the card. No cedsId, no description, no searchText,
// no allDomainIds/allDomainNames, no ' [qualifier]' name suffix (SPEC §1.6). The card's forge-stamped
// `embedding` IS the candidate vector (the bridge sets candidate.vector = candidate.embedding and
// never re-embeds); hand-picked vectors so cosine ranks are unambiguous, exactly as
// test-evidenceFlow.js's own fixture does.
//
// cardEmbeddingProperty — the reader-double shape of a card's `embedding` property: the bare
// LIST<FLOAT> a live graph stores (lib/replay/replay-engine.js writes number[] verbatim).
// ⟪RESOLVED per the P3 flatten ruling, 2026-08-03⟫ this helper previously PRE-WRAPPED the vector one
// array level to survive flattenFullRecord's v1() collapse — a fixture accommodation that was itself
// the finding: the collapse would have truncated every live card's 1024-dim embedding to its first
// float. flattenFullRecord now carries LIST_VALUED_PROPERTY_NAMES (embedding/qualifierKeys/
// qualifierNames pass through VERBATIM), so the fixture stores the honest live shape and the
// accommodation is reverted. If this test ever fails with 'carries no embedding' again, suspect a
// registry regression in sourceWalker.js before suspecting the bridge.
const cardEmbeddingProperty = (vector) => vector;

const referenceNodesRaw = [
	{
		stableId: 'cedsHubRef:addr1',
		properties: {
			role: 'HubReference', referenceTier: 'property', canonicalKey: 'P000104', propertyKey: 'P000104',
			name: 'Staff Evaluation Score or Rating',
			domainId: 'C200366', domainName: 'Staff Evaluation',
			domainDefinition: 'Information about the evaluation of a staff member.',
			propertyName: 'Staff Evaluation Score or Rating',
			propertyDefinition: 'The score or rating assigned to a staff member as the result of an evaluation.',
			rangeDatatype: 'string',
			embedText:
				'Staff Evaluation · Staff Evaluation Score or Rating · The score or rating assigned to a staff ' +
				'member as the result of an evaluation. · Information about the evaluation of a staff member.',
			embedding: cardEmbeddingProperty([1, 0, 0]),
		},
	},
	{
		stableId: 'cedsHubRef:addr2',
		properties: {
			role: 'HubReference', referenceTier: 'property', canonicalKey: 'P600253', propertyKey: 'P600253',
			name: 'Has Local Education Agency Title I Support Service',
			domainId: 'C200188', domainName: 'Local Education Agency',
			domainDefinition: 'A local-level education agency that operates schools or contracts for educational services.',
			propertyName: 'Has Local Education Agency Title I Support Service',
			propertyDefinition: 'An indication that the local education agency provides a Title I support service.',
			rangeClassId: 'C200196',
			rangeClassName: 'Title I Support Service',
			rangeClassDefinition: 'A support service provided to students under Title I.',
			embedText:
				'Local Education Agency · Has Local Education Agency Title I Support Service · An indication that ' +
				'the local education agency provides a Title I support service. · A local-level education agency ' +
				'that operates schools or contracts for educational services.',
			embedding: cardEmbeddingProperty([0, 1, 0]),
		},
	},
];

// s1 -> a clean strong match to addr1; s2 -> nothing in the pool is a real match (an honest abstain).
const sourceGraphNodes = [
	{ stableId: 's1', properties: { _source: 'LIF', role: 'DmeProperty', name: 'Staff Eval Score', defText: 'A numeric evaluation score assigned to a staff member.' } },
	{ stableId: 's2', properties: { _source: 'LIF', role: 'DmeProperty', name: 'Something Unrelated', defText: 'unrelated text with no genuine match' } },
];

// ⟪hubReimplementation P3, 2026-08-03 (SPEC §6)⟫ the fake vectorizer is keyed on the SOURCE composite
// `embedText` ONLY (lib/facetScan.js §4.1: owning class name · property name · description · owning
// class description — these fixture sources carry no `description` and this reader returns no source
// DmeClass nodes, so each composite reduces to the source's own `name`). CANDIDATES NEVER APPEAR
// HERE: the card's forge-stamped `embedding` is read off the graph node and becomes the candidate
// vector directly — zero candidate embed calls is gate G-15's whole assertion, proven below against
// this factory's own call ledger (batchEmbedCalls).
const textVectors = {
	'Staff Eval Score': [1, 0, 0], // s1 composite embedText
	'Something Unrelated': [0, 0, 1], // s2 composite embedText -- orthogonal to both candidate vectors
};

const graphReaderDouble = ({ inGraph }) => ({
	readNodes: ({ label, propertyEquals }, callback) => {
		void inGraph;
		const eq = propertyEquals || {};
		if (label === 'HubReference') { callback('', { nodes: referenceNodesRaw }); return; }
		if (eq._source === 'LIF' && eq.role === 'DmeProperty') { callback('', { nodes: sourceGraphNodes }); return; }
		callback('', { nodes: [] });
	},
	close: (callback) => callback(''),
});

const makeWriterDouble = (writes) => ({ inGraph }) => ({
	writeRelationshipEdge: (spec, callback) => { void inGraph; writes.push({ ...spec }); callback('', { edgeWritten: true }); },
	close: (callback) => callback(''),
});

// batchEmbedCalls — the vectorizer call ledger: every batchEmbed call's texts array, verbatim. This
// is gate G-15's hermetic observation point — the suite proves ONLY source embedTexts ever cross it.
const batchEmbedCalls = [];
const fakeVectorizerFactory = () => ({
	batchEmbed: ({ texts }, cb) => {
		batchEmbedCalls.push((texts || []).slice());
		cb('', { vectors: (texts || []).map((t) => textVectors[t] || null) });
	},
});

const runConfig = { sourceStandard: 'lif', sourceStandardName: 'LIF', sourceVersion: 'v1', hubVersion: 'v14.0.0.0' };

// stubLlm — a HERMETIC double of the R-a-wired live llmClient: returns {choice, category, rationale}
// exactly as the real Anthropic tool call now does. Distinguishes s1 from s2 by the retrieval-cosine
// text the renderer stamps per candidate (evidenceRenderer.js's own renderCandidateBlock format) --
// the evidence renderer carries NO source-identifying text in its prompt at all (candidate-centric by
// design), so this is the one honest signal available to a hermetic stub standing in for a real model
// that WOULD see the full evidence and judge accordingly.
let rerankCallCount = 0;
const stubLlm = {
	rerank: (spec, callback) => {
		rerankCallCount += 1;
		if (spec.userPrompt.includes('retrieval cosine 1')) {
			// s1 -- addr1 (ordinal 1, since pool is sorted desc by cosine) is a clean, strong match.
			callback('', { choice: '1', category: 'strong', rationale: 'the definitions align exactly; domain and range match' });
			return;
		}
		// s2 -- nothing in the pool is genuinely supported by the evidence.
		callback('', { choice: 'NONE', rationale: 'no candidate is supported by the evidence' });
	},
};

const rebridgeWrites = [];
const decisionBlocks = {};
const decisionStore = {
	getDecisionBlock: ({ pairKey }, cb) => cb('', decisionBlocks[pairKey] ? { frozenText: decisionBlocks[pairKey].frozenText } : { frozenText: null }),
	saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => { decisionBlocks[pairKey] = { frozenText, decisionBlockHash }; cb('', { saved: true }); },
};

let rebridgeReport = null;
bridgeMakerModule({ graphWriterFactory: makeWriterDouble(rebridgeWrites), graphReaderFactory: graphReaderDouble }).run(
	{
		inGraph: { graphName: 'DEV_generic_evidence_rb', boltUrl: 'bolt://x', password: 'x' },
		bridge: 'genericBridge', hub: 'ceds', applyLabel: 'BridgedRelation',
		rebridge: true, decisionStore,
		inferenceConfig: { llmClient: stubLlm, topK: 15, cosineFloor: 0.6, concurrency: 4 },
		config: runConfig,
		componentOverrides: { vectorizer: fakeVectorizerFactory, graphReader: graphReaderDouble },
	},
	(err, report) => { rebridgeReport = { err, report }; },
);

harness.ok(`REBRIDGE did not error (${(rebridgeReport && rebridgeReport.err) || 'ok'})`, rebridgeReport && !rebridgeReport.err, rebridgeReport && rebridgeReport.err);
harness.equal('REBRIDGE: exactly 2 rerank calls (one per source)', rerankCallCount, 2);
harness.equal('REBRIDGE: exactly ONE edge written (s1 picks; s2 honestly abstains)', rebridgeReport.report && rebridgeReport.report.edgesWritten, 1);
harness.ok('REBRIDGE: decisionBlock is a real hash string', typeof rebridgeReport.report.decisionBlock === 'string' && rebridgeReport.report.decisionBlock.length > 0);

// ⟪hubReimplementation P3 (SPEC §6, gate G-15)⟫ ONLY the SOURCE embedTexts crossed the vectorizer
// seam — the candidate vectors came off the cards; zero candidate embed calls.
harness.equal('REBRIDGE: exactly ONE batchEmbed call — the SOURCE composite embedTexts only (G-15: zero candidate embeds)', batchEmbedCalls.length, 1);
harness.equal(
	'  and it carried EXACTLY the two source embedTexts, in source order (no candidate text ever reaches the vectorizer)',
	JSON.stringify(batchEmbedCalls[0]),
	JSON.stringify(['Staff Eval Score', 'Something Unrelated']),
);

const genericBridgeFactoryModule = require(path.join(TREE_ROOT, 'forges', 'bridges', 'genericBridge'));
harness.equal(
	'the bridge\'s EVIDENCE_GENERATION is the ⟪hubReimplementation P3⟫ generation (card vectors consumed + meaning-carrying tuples, renderer v5)',
	genericBridgeFactoryModule.EVIDENCE_GENERATION,
	'genericBridge-evidence-v5',
);
harness.equal('REBRIDGE: result.generation is that same tag (⟪A6⟫, surfaced additively)', rebridgeReport.report.generation, 'genericBridge-evidence-v5');
harness.ok('REBRIDGE: result.rendererVersion is a non-empty string (⟪A6⟫, surfaced additively)', typeof rebridgeReport.report.rendererVersion === 'string' && rebridgeReport.report.rendererVersion.length > 0);

// the ⟪A3⟫ shape gate + the R5 hub-module gate, run over the FROZEN evidence -- proving every composed
// package that fed this run was contract-conforming, not merely that this suite's own assertions liked it.
const evidenceFreezer = evidenceFreezerFactory();
const frozenBlock = decisionBlocks['CEDS::LIF'];
harness.ok('a real frozen evidence-decision block was saved', !!frozenBlock);
const parsedFrozen = evidenceFreezer.parse(frozenBlock.frozenText);
harness.ok('the frozen block parses with no error', !parsedFrozen.error, parsedFrozen.error);
harness.equal('the frozen block carries exactly 2 frozenEvidence entries (one per source)', parsedFrozen.frozenEvidence.length, 2);
// ⟪FREEZE-BY-REFERENCE, 2026-07-31⟫ frozen entries carry the evidence's ADDRESS, not its bytes —
// the bronze build's PESC pair proved embedded packages exceed V8's max string at freeze. The
// package's contract conformance is proven upstream (the ⟪A3⟫ gate runs on every compose before
// judging); here we prove the block addresses the evidence completely and honestly.
parsedFrozen.frozenEvidence.forEach((oneEntry) => {
	harness.ok(
		`frozenEvidence[${oneEntry.sourceStableId}] carries NO embedded evidencePackage (freeze-by-reference)`,
		oneEntry.evidencePackage === undefined,
	);
	harness.ok(
		`  and its evidencePackageRef carries a non-empty promptHash`,
		oneEntry.evidencePackageRef && typeof oneEntry.evidencePackageRef.promptHash === 'string' && oneEntry.evidencePackageRef.promptHash.length > 0,
	);
	harness.equal(
		`  and names the renderer that produced the addressed evidence`,
		oneEntry.evidencePackageRef && oneEntry.evidencePackageRef.rendererVersion,
		require('../lib.d/evidenceRenderer').RENDERER_VERSION,
	);
});

const s1Frozen = parsedFrozen.frozenEvidence.find((e) => e.sourceStableId === 's1');
const s2Frozen = parsedFrozen.frozenEvidence.find((e) => e.sourceStableId === 's2');
harness.ok('s1\'s frozen judgment is retrievable (R-b disposition: category/rationale ride in frozenEvidence)', !!s1Frozen);
harness.equal('s1\'s frozen category is "strong"', s1Frozen.judgment.category, 'strong');
harness.equal('s1\'s frozen rationale is the stub\'s own text', s1Frozen.judgment.rationale, 'the definitions align exactly; domain and range match');
harness.equal('s1\'s frozen normalizedConfidence is EXACTLY the "strong" band ceiling at cosine 1.0', s1Frozen.judgment.normalizedConfidence, require('../lib.d/confidenceNormalizer').CATEGORY_BAND.strong.ceiling);
harness.ok('s2\'s frozen judgment is retrievable', !!s2Frozen);
harness.equal('s2\'s frozen category is "none" (the honest abstain)', s2Frozen.judgment.category, 'none');
harness.equal('s2\'s frozen normalizedConfidence is 0 (an abstain carries no numeric confidence)', s2Frozen.judgment.normalizedConfidence, 0);

// the WRITTEN edge itself: confidence is the NORMALIZED value (R-b), category is NOT an edge property.
harness.equal('exactly one edge was written', rebridgeWrites.length, 1);
const writtenEdge = rebridgeWrites[0];
harness.equal('the written edge targets addr1 (the strong match)', writtenEdge.toStableId, 'cedsHubRef:addr1');
harness.equal('the written edge\'s confidence property is the NORMALIZED confidence, not the raw cosine', writtenEdge.properties.confidence, s1Frozen.judgment.normalizedConfidence);
harness.equal('  predicate is stamped as ever', writtenEdge.properties.predicate, 'closeMatch');
harness.equal('  provenanceTier is stamped as ever', writtenEdge.properties.provenanceTier, 'embedding-inferred');
harness.equal('  decisionBlockHash pins the edge to the frozen block', writtenEdge.properties.decisionBlockHash, rebridgeReport.report.decisionBlock);
harness.equal('  mappingTool is this bridge\'s own name', writtenEdge.properties.mappingTool, 'genericBridge');
harness.ok(
	'R-b DISPOSITION: category does NOT ride as an edge property (it rides in frozenEvidence.judgment only, see genericBridge.js\'s own header)',
	!('category' in writtenEdge.properties),
	`edge properties were: ${JSON.stringify(Object.keys(writtenEdge.properties))}`,
);
harness.ok('R-b DISPOSITION: rationale does NOT ride as an edge property either', !('rationale' in writtenEdge.properties));

// =====================================================================
// MATERIALIZE — the SAME frozen block replayed. ZERO additional llm calls; byte-identical edge.
// =====================================================================
harness.section('PART B (cont.) — MATERIALIZE: the SAME frozen block replayed, ZERO llm calls');

const rerankCallsBeforeMaterialize = rerankCallCount;
const materializeWrites = [];

let materializeReport = null;
bridgeMakerModule({ graphWriterFactory: makeWriterDouble(materializeWrites), graphReaderFactory: graphReaderDouble }).run(
	{
		inGraph: { graphName: 'DEV_generic_evidence_mat', boltUrl: 'bolt://x', password: 'x' },
		bridge: 'genericBridge', hub: 'ceds', applyLabel: 'BridgedRelation',
		rebridge: false, decisionStore,
		inferenceConfig: { llmClient: stubLlm, topK: 15, cosineFloor: 0.6 },
		config: runConfig,
		componentOverrides: { vectorizer: fakeVectorizerFactory, graphReader: graphReaderDouble },
	},
	(err, report) => { materializeReport = { err, report }; },
);

harness.ok(`MATERIALIZE did not error (${(materializeReport && materializeReport.err) || 'ok'})`, materializeReport && !materializeReport.err, materializeReport && materializeReport.err);
harness.equal('MATERIALIZE: ZERO additional rerank calls (pure replay, never re-judges)', rerankCallCount, rerankCallsBeforeMaterialize);
harness.equal('MATERIALIZE: the SAME edge count (1)', materializeReport.report.edgesWritten, 1);
harness.equal('MATERIALIZE: pins to the SAME decisionBlockHash as the rebridge that produced it', materializeReport.report.decisionBlock, rebridgeReport.report.decisionBlock);
harness.equal('MATERIALIZE: generation round-trips from the frozen block', materializeReport.report.generation, 'genericBridge-evidence-v5');
harness.equal('MATERIALIZE: ZERO additional batchEmbed calls (pure replay never vectorizes)', batchEmbedCalls.length, 1);
harness.equal(
	'MATERIALIZE: BYTE-IDENTICAL replayed edge (endpoints, type, ALL properties incl. the NORMALIZED confidence)',
	JSON.stringify(materializeWrites[0]),
	JSON.stringify(rebridgeWrites[0]),
);

// =====================================================================
// PART B (cont.) — OBSERVED-RED (⟪hubReimplementation P3, SPEC §6⟫): a candidate missing its
// card-carried embedding or embedText is refused BY NAME. The bridge consumes the self-sufficient
// card — it never re-embeds a vectorless candidate (that would both hide a graph materialized
// without its vector store AND spend against the provider for a fact the card already carries) and
// never recomposes a missing retrieval string. Each twin injects EXACTLY one broken card into an
// otherwise-green candidate set, so the refusal provably names the ONE broken candidate.
// =====================================================================
harness.section('PART B (cont.) — OBSERVED-RED: a candidate missing card-carried embedding/embedText is refused BY NAME');

// vectorlessCandidateNode — a conforming card in every respect EXCEPT the forge-stamped `embedding`.
const vectorlessCandidateNode = {
	stableId: 'cedsHubRef:addrNoEmbedding',
	properties: {
		role: 'HubReference', referenceTier: 'property', canonicalKey: 'P777001', propertyKey: 'P777001',
		name: 'Card With No Embedding',
		domainId: 'C200366', domainName: 'Staff Evaluation',
		domainDefinition: 'Information about the evaluation of a staff member.',
		propertyName: 'Card With No Embedding',
		propertyDefinition: 'A broken card whose forge-stamped vector was dropped.',
		rangeDatatype: 'string',
		embedText: 'Staff Evaluation · Card With No Embedding · A broken card whose forge-stamped vector was dropped.',
		// NO embedding — the injected fault (SPEC §1.5, G-7)
	},
};

// embedTextlessCandidateNode — carries its vector but NOT its stored retrieval string.
const embedTextlessCandidateNode = {
	stableId: 'cedsHubRef:addrNoEmbedText',
	properties: {
		role: 'HubReference', referenceTier: 'property', canonicalKey: 'P777002', propertyKey: 'P777002',
		name: 'Card With No EmbedText',
		domainId: 'C200366', domainName: 'Staff Evaluation',
		domainDefinition: 'Information about the evaluation of a staff member.',
		propertyName: 'Card With No EmbedText',
		propertyDefinition: 'A broken card whose stored retrieval string was dropped.',
		rangeDatatype: 'string',
		embedding: cardEmbeddingProperty([1, 0, 0]),
		// NO embedText — the injected fault (SPEC §1.5, G-6)
	},
};

const rerankCallsBeforeRefusalTwins = rerankCallCount;
const batchEmbedCallsBeforeRefusalTwins = batchEmbedCalls.length;

// runRefusalTwin — one full REBRIDGE attempt through the REAL bridgeMaker.run() over a candidate set
// carrying exactly one broken card. Every double is synchronous, so the observed error is in hand
// when this returns (refusal happens BEFORE vectorize/judge — proven by the ledgers below).
const runRefusalTwin = ({ graphName, referenceNodes }) => {
	const refusalReader = ({ inGraph }) => ({
		readNodes: ({ label, propertyEquals }, callback) => {
			void inGraph;
			const eq = propertyEquals || {};
			if (label === 'HubReference') { callback('', { nodes: referenceNodes }); return; }
			if (eq._source === 'LIF' && eq.role === 'DmeProperty') { callback('', { nodes: sourceGraphNodes }); return; }
			callback('', { nodes: [] });
		},
		close: (callback) => callback(''),
	});
	const refusalWrites = [];
	const refusalDecisionBlocks = {};
	const refusalDecisionStore = {
		getDecisionBlock: ({ pairKey }, cb) => cb('', refusalDecisionBlocks[pairKey] ? { frozenText: refusalDecisionBlocks[pairKey].frozenText } : { frozenText: null }),
		saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => { refusalDecisionBlocks[pairKey] = { frozenText, decisionBlockHash }; cb('', { saved: true }); },
	};
	let observed = null;
	bridgeMakerModule({ graphWriterFactory: makeWriterDouble(refusalWrites), graphReaderFactory: refusalReader }).run(
		{
			inGraph: { graphName, boltUrl: 'bolt://x', password: 'x' },
			bridge: 'genericBridge', hub: 'ceds', applyLabel: 'BridgedRelation',
			rebridge: true, decisionStore: refusalDecisionStore,
			inferenceConfig: { llmClient: stubLlm, topK: 15, cosineFloor: 0.6, concurrency: 4 },
			config: runConfig,
			componentOverrides: { vectorizer: fakeVectorizerFactory, graphReader: refusalReader },
		},
		(err) => { observed = { err, writes: refusalWrites, decisionBlocks: refusalDecisionBlocks }; },
	);
	return observed;
};

// ---- RED twin #1 — one candidate with NO embedding ----
(() => {
	const observed = runRefusalTwin({
		graphName: 'DEV_generic_refuse_no_embedding',
		referenceNodes: [...referenceNodesRaw, vectorlessCandidateNode],
	});
	harness.rejects(
		"RED: a candidate with no card-carried `embedding` is refused NAMING that candidate ('carries no embedding')",
		[observed && observed.err],
		/candidate 'P777001' carries no embedding/,
	);
	harness.equal('  and no edge was written before the refusal', observed.writes.length, 0);
	harness.equal('  and no frozen block was saved', Object.keys(observed.decisionBlocks).length, 0);
})();

// ---- RED twin #2 — one candidate with NO embedText ----
(() => {
	const observed = runRefusalTwin({
		graphName: 'DEV_generic_refuse_no_embedtext',
		referenceNodes: [...referenceNodesRaw, embedTextlessCandidateNode],
	});
	harness.rejects(
		"RED: a candidate with no card-stored `embedText` is refused NAMING that candidate ('carries no embedText')",
		[observed && observed.err],
		/candidate 'P777002' carries no embedText/,
	);
	harness.equal('  and no edge was written before the refusal', observed.writes.length, 0);
	harness.equal('  and no frozen block was saved', Object.keys(observed.decisionBlocks).length, 0);
})();

harness.equal('the refusal twins made ZERO rerank calls (refusal precedes judging)', rerankCallCount, rerankCallsBeforeRefusalTwins);
harness.equal('the refusal twins made ZERO batchEmbed calls (refusal precedes source vectorization)', batchEmbedCalls.length, batchEmbedCallsBeforeRefusalTwins);

// =====================================================================
// PART C — RESOLVER CHECK: 'genericBridge' still resolves to exactly ONE file
// =====================================================================
harness.section('PART C — RESOLVER: genericBridge still resolves uniquely from forges/bridges/');

const newPath = path.join(TREE_ROOT, 'forges', 'bridges', 'genericBridge.js');
harness.ok('the forges-shared genericBridge.js exists on disk', fs.existsSync(newPath), `not found at ${newPath}`);

const resolved = bridgeMakerModule.resolveBridgePlugin({ bridge: 'genericBridge' });
harness.ok(
	"'genericBridge' resolves through the real search path (no source given -> forges-shared + library scopes only)",
	!!resolved && !resolved.error && typeof resolved.pluginFactory === 'function',
	`got ${JSON.stringify(resolved)}`,
);
harness.equal('  and the resolved file IS forges/bridges/genericBridge.js', resolved.resolvedPath, newPath);

// =====================================================================
// PART D — DETERMINISM UNDER CONCURRENCY (p8-judgeConcurrency): the frozen decision block is
// BYTE-IDENTICAL between a concurrent run whose completions provably arrive OUT of source order
// (a stub llmClient with reversed staggered delays) and a concurrencyLimit=1 (serial) run.
// This section is ASYNC — real timers stagger the completions — so it owns harness.report().
// =====================================================================
harness.section('PART D — DETERMINISM: staggered-delay concurrent run vs concurrency-1 run, SAME frozen bytes');

const SOURCE_COUNT_D = 6;
const sourceGraphNodesD = Array.from({ length: SOURCE_COUNT_D }, (ignore, i) => ({
	stableId: `sD${i + 1}`,
	properties: {
		_source: 'LIF', role: 'DmeProperty', name: `Determinism Probe ${i + 1}`,
		defText: `determinism probe text ${i + 1}`,
	},
}));

// every probe's COMPOSITE embedText (its `name`, since these fixtures carry no description and this
// reader returns no source DmeClass nodes) embeds to the SAME vector (cosine 1.0 with addr1) —
// identity rides on the stableIds; per-source VARIETY rides in the stub's per-call responses below.
// SOURCES ONLY (⟪hubReimplementation P3⟫): the candidate vectors ride on the cards themselves
// (referenceNodesRaw's forge-stamped embeddings) and never cross the vectorizer seam.
const textVectorsD = {};
sourceGraphNodesD.forEach((oneNode) => {
	textVectorsD[oneNode.properties.name] = [1, 0, 0];
});

const graphReaderDoubleD = ({ inGraph }) => ({
	readNodes: ({ label, propertyEquals }, callback) => {
		void inGraph;
		const eq = propertyEquals || {};
		if (label === 'HubReference') { callback('', { nodes: referenceNodesRaw }); return; }
		if (eq._source === 'LIF' && eq.role === 'DmeProperty') { callback('', { nodes: sourceGraphNodesD }); return; }
		callback('', { nodes: [] });
	},
	close: (callback) => callback(''),
});

const fakeVectorizerFactoryD = () => ({
	batchEmbed: ({ texts }, cb) => cb('', { vectors: (texts || []).map((t) => textVectorsD[t] || null) }),
});

// makeStubLlmD — per-call responses VARY (category cycles; rationale carries the call ordinal; odd
// calls abstain) so a wrong-order assembly would change the frozen bytes, not merely reshuffle
// identical entries. All pre-select steps are synchronous with these doubles, so rerank call order
// IS source launch order (strictly ascending index — boundedRunner's contract) in BOTH runs; only
// the completion timing differs. delayForCall(callOrdinal) staggers the callbacks.
const CATEGORY_CYCLE_D = ['strong', 'moderate', 'weakButReal'];
const makeStubLlmD = ({ delayForCall, completionOrder, inFlightLedger }) => {
	let callOrdinal = -1;
	return {
		rerank: (spec, callback) => {
			void spec;
			callOrdinal += 1;
			const thisCall = callOrdinal;
			if (inFlightLedger) {
				inFlightLedger.now += 1;
				inFlightLedger.max = Math.max(inFlightLedger.max, inFlightLedger.now);
			}
			const respond = () => {
				if (inFlightLedger) {
					inFlightLedger.now -= 1;
				}
				if (completionOrder) {
					completionOrder.push(thisCall);
				}
				if (thisCall % 2 === 1) {
					callback('', { choice: 'NONE', rationale: `determinism abstain rationale #${thisCall}` });
					return;
				}
				callback('', {
					choice: '1',
					category: CATEGORY_CYCLE_D[(thisCall / 2) % CATEGORY_CYCLE_D.length],
					rationale: `determinism pick rationale #${thisCall}`,
				});
			};
			const delayMs = delayForCall(thisCall);
			if (delayMs === 0) {
				respond();
				return;
			}
			setTimeout(respond, delayMs);
		},
	};
};

const runOneDeterminismPass = ({ graphName, stubLlm, configOverrides, writes }, passDone) => {
	const decisionBlocksD = {};
	const decisionStoreD = {
		getDecisionBlock: ({ pairKey }, cb) => cb('', decisionBlocksD[pairKey] ? { frozenText: decisionBlocksD[pairKey].frozenText } : { frozenText: null }),
		saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => { decisionBlocksD[pairKey] = { frozenText, decisionBlockHash }; cb('', { saved: true }); },
	};
	bridgeMakerModule({ graphWriterFactory: makeWriterDouble(writes), graphReaderFactory: graphReaderDoubleD }).run(
		{
			inGraph: { graphName, boltUrl: 'bolt://x', password: 'x' },
			bridge: 'genericBridge', hub: 'ceds', applyLabel: 'BridgedRelation',
			rebridge: true, decisionStore: decisionStoreD,
			inferenceConfig: { llmClient: stubLlm, topK: 15, cosineFloor: 0.6, concurrency: 4 },
			config: { ...runConfig, ...configOverrides },
			componentOverrides: { vectorizer: fakeVectorizerFactoryD, graphReader: graphReaderDoubleD },
		},
		(err, report) => passDone(err, { report, frozenBlock: decisionBlocksD['CEDS::LIF'] }),
	);
};

// PASS 1 — CONCURRENT (the bridge's own EVIDENCE_JUDGE_CONCURRENCY=8 default), REVERSED staggered
// delays: the LAST-launched judgment completes FIRST, so completion order provably differs from
// source order.
const completionOrderD = [];
const inFlightLedgerD = { now: 0, max: 0 };
const concurrentWritesD = [];
runOneDeterminismPass(
	{
		graphName: 'DEV_generic_determinism_concurrent',
		stubLlm: makeStubLlmD({
			delayForCall: (callOrdinal) => (SOURCE_COUNT_D - callOrdinal) * 12,
			completionOrder: completionOrderD,
			inFlightLedger: inFlightLedgerD,
		}),
		configOverrides: {},
		writes: concurrentWritesD,
	},
	(concurrentErr, concurrentOut) => {
		harness.ok(`the CONCURRENT rebridge pass did not error (${concurrentErr || 'ok'})`, !concurrentErr, concurrentErr);
		harness.ok(
			'the judgments genuinely OVERLAPPED (max concurrent rerank calls in flight > 1)',
			inFlightLedgerD.max > 1,
			`max in flight was ${inFlightLedgerD.max}`,
		);
		harness.ok(
			`completion order provably DIFFERS from source order (was ${JSON.stringify(completionOrderD)})`,
			JSON.stringify(completionOrderD) !== JSON.stringify(Array.from({ length: SOURCE_COUNT_D }, (ignore, i) => i)),
			`completion order was ${JSON.stringify(completionOrderD)}`,
		);

		// PASS 2 — SERIAL comparator: config.evidenceJudgeConcurrency=1 (the documented override
		// seam), zero delay — the exact behavior of the retired taskListPlus serial loop.
		const serialWritesD = [];
		runOneDeterminismPass(
			{
				graphName: 'DEV_generic_determinism_serial',
				stubLlm: makeStubLlmD({ delayForCall: () => 0 }),
				configOverrides: { evidenceJudgeConcurrency: 1 },
				writes: serialWritesD,
			},
			(serialErr, serialOut) => {
				harness.ok(`the SERIAL (concurrency-1) rebridge pass did not error (${serialErr || 'ok'})`, !serialErr, serialErr);

				// THE PROOF — the frozen decision block is BYTE-IDENTICAL and hash-identical.
				harness.ok('both passes saved a real frozen block', !!(concurrentOut.frozenBlock && serialOut.frozenBlock));
				harness.equal(
					'DETERMINISM PROVED: the frozen decision block TEXT is BYTE-IDENTICAL between the out-of-order concurrent run and the serial run',
					concurrentOut.frozenBlock.frozenText,
					serialOut.frozenBlock.frozenText,
				);
				harness.equal(
					'  and the content-address (decisionBlockHash) is IDENTICAL',
					concurrentOut.frozenBlock.decisionBlockHash,
					serialOut.frozenBlock.decisionBlockHash,
				);
				harness.equal(
					'  and both bridge reports pin the SAME decisionBlock hash',
					concurrentOut.report.decisionBlock,
					serialOut.report.decisionBlock,
				);
				harness.equal(
					'  and the WRITTEN edges are byte-identical, in the same order',
					JSON.stringify(concurrentWritesD),
					JSON.stringify(serialWritesD),
				);
				harness.equal('  3 picks -> 3 edges in each pass (even ordinals pick, odd abstain)', concurrentWritesD.length, 3);

				harness.report();
			},
		);
	},
);
