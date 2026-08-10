#!/usr/bin/env node
'use strict';

// test-debugFlagging.js — hermetic gate for INVALID_DEBUG FLAGGING (skipAI,
// PLAN-skipAiDebugJudge-081026 Phase 3). Phase 1 gated the judge, Phase 2 the operator switch; this
// gates the part that keeps a debug graph from ever passing as a real one.
//
// What it proves:
//   1. THE ACCEPT-CONTROL, FIRST — a materializer given NO decisionAlgorithm produces edges carrying
//      NO SUCH PROPERTY AT ALL. Without this, "the flag is present" would be unfalsifiable: an
//      always-on flag looks identical to a correctly-applied one.
//   2. TOTALITY — with the flag set, EVERY edge carries it. Not most; the count must equal the edge
//      count, because a partial flag is worse than none (it certifies the unflagged ones as real).
//   3. REIFIED NODES TOO — the only nodes a materializer composes are flagged with the edges. FORGED
//      nodes are deliberately NOT flagged: a bridge composes none of them, so marking them would
//      brand correct content invalid.
//   4. THE REPLAY PATH — the mark survives INTO the frozen block's generation and is read back OUT of
//      it. This is the one that matters: a plain build replaying a debug block has no judge to ask,
//      and would otherwise write fake edges carrying no flag, silently, forever.
//   5. THE JUDGE IS RECOGNISED — the real client is not mistaken for a debug one, and vice versa.
//
// PURE / hermetic: no Neo4j, no network, no LLM, no filesystem.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-debugFlagging.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for INVALID_DEBUG flagging of inferred edges

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves that a real run carries NO debug property (the accept-control), that a debug run flags
     EVERY edge it composes, and that the mark survives into and back out of the frozen block's
     generation so a plain-build replay keeps flagging.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const inferredIndexFactory = require('../lib/inferredIndex');
const debugJudgeFactory = require('../lib/debugJudge');

const { DEBUG_MARK, debugMarkFromLlmClient, debugMarkFromGeneration, generationWithDebugMark } =
	debugJudgeFactory;
const { isValidProvenanceTier } = require('../../../../../lib/vocabulary/vocabulary');

// A minimal but REAL materializer input: three source nodes, three hub references, three decisions.
// The reference-node shape is the one referenceIndex.js actually indexes (role HubReference,
// referenceTier property, canonicalKey/propertyKey, empty qualifierKeys) — copied from the shape
// test-materializer.js proves against rather than invented, so this gate exercises real resolution.
const SUBJECT_SOURCE = 'SIF';
const sourceNodes = [1, 2, 3].map((n) => ({ stableId: `sif:field/Thing${n}` }));
const referenceNodes = [1, 2, 3].map((n) => ({
	stableId: `ceds:ref/P00000${n}`,
	properties: {
		role: 'HubReference',
		referenceTier: 'property',
		canonicalKey: `P00000${n}`,
		propertyKey: `P00000${n}`,
		qualifierKeys: [],
	},
}));
const inferredDecisions = [1, 2, 3].map((n) => ({
	fromStableId: `sif:field/Thing${n}`,
	targetKey: `P00000${n}`,
	confidence: 0.9,
	rerankScore: 0.9,
	cosineScore: 0.8,
	retrievalRank: 1,
}));

const buildWith = (decisionAlgorithm) =>
	inferredIndexFactory({
		predicate: 'closeMatch',
		mappingJustification: 'semapv:SemanticSimilarity',
		subjectSource: SUBJECT_SOURCE,
		objectSource: 'CEDS',
		mappingTool: 'testBridge',
		decisionBlockHash: 'testhash',
		decisionAlgorithm,
	}).buildInferredSubgraph({ inferredDecisions, sourceNodes, referenceNodes });

// =====================================================================
harness.section('THE ACCEPT-CONTROL — a REAL run carries no debug property at all');
// =====================================================================

const realRun = buildWith(undefined);
harness.ok('the fixture materializes edges at all (the control is meaningful)', realRun.edges.length === 3);
harness.equal(
	'NOT ONE edge of a real run carries decisionAlgorithm',
	realRun.edges.filter((oneEdge) => oneEdge.properties.decisionAlgorithm !== undefined).length,
	0,
);
harness.ok(
	'the property is ABSENT, not present-and-falsy — nothing must be read to know an edge is genuine',
	!Object.prototype.hasOwnProperty.call(realRun.edges[0].properties, 'decisionAlgorithm'),
);
// an empty string must behave as "no flag", not as a flag whose value happens to be blank
harness.equal(
	'an empty decisionAlgorithm is treated as NO flag',
	buildWith('').edges.filter((oneEdge) => oneEdge.properties.decisionAlgorithm !== undefined).length,
	0,
);

// =====================================================================
harness.section('TOTALITY — a debug run flags EVERY edge, not most of them');
// =====================================================================

const debugRun = buildWith(DEBUG_MARK);
harness.equal('the debug run materializes the same number of edges', debugRun.edges.length, realRun.edges.length);
harness.equal(
	'EVERY edge carries the flag (count equals edge count — a partial flag certifies the rest as real)',
	debugRun.edges.filter((oneEdge) => oneEdge.properties.decisionAlgorithm === DEBUG_MARK).length,
	debugRun.edges.length,
);
harness.equal('ZERO edges are unflagged', debugRun.edges.filter((oneEdge) => !oneEdge.properties.decisionAlgorithm).length, 0);
harness.equal(
	'flagging changes NOTHING else about an edge — same type',
	debugRun.edges[0].type,
	realRun.edges[0].type,
);
harness.equal(
	'...same confidence',
	debugRun.edges[0].properties.confidence,
	realRun.edges[0].properties.confidence,
);
harness.equal(
	'...same predicate stamp',
	debugRun.edges[0].properties.predicate,
	realRun.edges[0].properties.predicate,
);

// =====================================================================
harness.section('THE PROVENANCE TIER TELLS THE TRUTH — the half that matters most');
// =====================================================================
// A debug edge used to be stamped 'embedding-inferred', which ASSERTS that an embedding informed the
// choice. Nothing did. provenanceTier is the field a consumer trusts most, so it was the worst place
// in the edge for a false claim — and it showed: askMilo, asked directly about contamination,
// described these mappings as calibrated-confidence equivalents (tqii observed it live, 2026-08-10).

harness.equal(
	'a REAL run still carries embedding-inferred (the accept-control — the tier is not always debug)',
	realRun.edges[0].properties.provenanceTier,
	'embedding-inferred',
);
harness.equal(
	'a DEBUG run carries invalid-debug, NOT embedding-inferred',
	debugRun.edges[0].properties.provenanceTier,
	'invalid-debug',
);
harness.equal(
	'EVERY debug edge carries the honest tier, not most of them',
	debugRun.edges.filter((oneEdge) => oneEdge.properties.provenanceTier === 'invalid-debug').length,
	debugRun.edges.length,
);
harness.equal(
	'NOT ONE debug edge still claims embedding-inferred',
	debugRun.edges.filter((oneEdge) => oneEdge.properties.provenanceTier === 'embedding-inferred').length,
	0,
);
harness.ok(
	'invalid-debug is a SANCTIONED tier — the replay engine would refuse an unlisted one',
	isValidProvenanceTier('invalid-debug'),
);
harness.ok(
	'...and the four original tiers still validate (nothing was displaced)',
	['spec-authoritative', 'embedding-inferred', 'structural', 'user-asserted'].every(isValidProvenanceTier),
);
harness.ok('an invented tier is still refused', !isValidProvenanceTier('made-up-tier'));

// =====================================================================
harness.section('REIFIED NODES — the only nodes a materializer composes are flagged too');
// =====================================================================

const curationInputs = [{ fromStableId: 'sif:field/Thing1', targetKey: 'P000001', annotation: 'CURATED_BY', note: '' }];
const reifiedReal = inferredIndexFactory({
	subjectSource: SUBJECT_SOURCE,
	mappingTool: 'testBridge',
}).buildInferredSubgraph({ inferredDecisions, sourceNodes, referenceNodes, curationInputs });
const reifiedDebug = inferredIndexFactory({
	subjectSource: SUBJECT_SOURCE,
	mappingTool: 'testBridge',
	decisionAlgorithm: DEBUG_MARK,
}).buildInferredSubgraph({ inferredDecisions, sourceNodes, referenceNodes, curationInputs });

harness.ok('the curation fixture produces a reified node (the control is meaningful)', reifiedDebug.nodes.length > 0);
harness.equal(
	'a real run leaves reified nodes unflagged',
	reifiedReal.nodes.filter((oneNode) => oneNode.properties.decisionAlgorithm !== undefined).length,
	0,
);
harness.equal(
	'a debug run flags EVERY reified node',
	reifiedDebug.nodes.filter((oneNode) => oneNode.properties.decisionAlgorithm === DEBUG_MARK).length,
	reifiedDebug.nodes.length,
);
harness.equal(
	'an ordinary run composes ZERO nodes — which is why FORGED nodes are never flagged',
	realRun.nodes.length,
	0,
);

// =====================================================================
harness.section('THE REPLAY PATH — the mark survives into the block and back out');
// =====================================================================

const BASE_GENERATION = 'genericBridge-evidence-v5';

harness.equal(
	'a real run freezes the plain generation',
	generationWithDebugMark(BASE_GENERATION, undefined),
	BASE_GENERATION,
);
const debugGeneration = generationWithDebugMark(BASE_GENERATION, DEBUG_MARK);
harness.match('a debug run freezes a generation carrying the mark', debugGeneration, new RegExp(DEBUG_MARK));
harness.ok('...and the base generation is still legible inside it', debugGeneration.indexOf(BASE_GENERATION) === 0);

harness.equal(
	'reading a PLAIN generation back yields no mark (a replay of real work stays unflagged)',
	debugMarkFromGeneration(BASE_GENERATION),
	undefined,
);
harness.equal(
	'reading a DEBUG generation back yields the mark — THE REPLAY KEEPS FLAGGING',
	debugMarkFromGeneration(debugGeneration),
	DEBUG_MARK,
);
harness.equal('a missing generation yields no mark rather than throwing', debugMarkFromGeneration(undefined), undefined);

// the full round trip, as a plain build would experience it
const replayed = buildWith(debugMarkFromGeneration(debugGeneration));
harness.equal(
	'A PLAIN BUILD REPLAYING A DEBUG BLOCK FLAGS EVERY EDGE (no judge present, mark from the block)',
	replayed.edges.filter((oneEdge) => oneEdge.properties.decisionAlgorithm === DEBUG_MARK).length,
	replayed.edges.length,
);
const replayedReal = buildWith(debugMarkFromGeneration(BASE_GENERATION));
harness.equal(
	'...and replaying a REAL block flags nothing',
	replayedReal.edges.filter((oneEdge) => oneEdge.properties.decisionAlgorithm !== undefined).length,
	0,
);

// =====================================================================
harness.section('RECOGNISING THE JUDGE — real is not mistaken for debug, or the reverse');
// =====================================================================

const debugJudge = debugJudgeFactory({ ruleName: 'first' });
harness.equal(
	'a DEBUG judge on the kit is recognised',
	debugMarkFromLlmClient({ inferenceConfig: { llmClient: debugJudge } }),
	DEBUG_MARK,
);
harness.equal(
	'a REAL client (no decisionAlgorithm) is NOT mistaken for debug',
	debugMarkFromLlmClient({ inferenceConfig: { llmClient: { rerank: () => {}, model: 'claude-opus-4-8' } } }),
	undefined,
);
harness.equal(
	'an impostor claiming another algorithm is not accepted as the debug mark',
	debugMarkFromLlmClient({ inferenceConfig: { llmClient: { rerank: () => {}, decisionAlgorithm: 'SOMETHING_ELSE' } } }),
	undefined,
);
harness.equal('no kit at all yields no mark rather than throwing', debugMarkFromLlmClient(undefined), undefined);
harness.equal(
	'a materialize-mode kit (no llmClient) yields no mark rather than throwing',
	debugMarkFromLlmClient({ inferenceConfig: {} }),
	undefined,
);

harness.report();
