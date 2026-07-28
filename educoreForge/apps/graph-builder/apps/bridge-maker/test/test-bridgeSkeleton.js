#!/usr/bin/env node
'use strict';

// test-bridgeSkeleton.js — hermetic gate for apps/graph-builder/apps/bridge-maker/lib/bridgeSkeleton.js
// (bridgeKitRefactor_072726 spec §6 Phase 4). Three sections:
//
//   SECTION 1 — CONSTRUCTION-TIME fault twins: makeBridgeSkeleton({...}) throws BY NAME on every
//               missing required identity/config field, RED then GREEN (supplying it, or — for the
//               fields a move override makes unnecessary — supplying the override instead).
//
//   SECTION 2 — THE OVERRIDE SEAM IS REAL (mechanical proof): overriding a move DROPS that move's
//               OWN kit-member requirement. RED: the DEFAULT skeleton instance (no override) refuses
//               a --rebridge kit missing kit.selector / kit.candidateFinder, exactly as genericBridge
//               does (test-generic-bridge-equivalence.js PART A already proves this for genericBridge
//               specifically; this proves the SKELETON itself owns the refusal). GREEN (twin): a
//               skeleton instance built with moves.select / moves.match overridden runs the SAME
//               kit — still missing that member — with no refusal at all.
//
//   SECTION 3 — THE REUSABILITY DEMONSTRATION (spec deliverable 3, the Phase-5 de-risker):
//               behavioral proof, not just mechanical. TWO bridges built on the skeleton, IDENTICAL
//               in every construction field and run over an IDENTICAL fixture kit, differing in
//               EXACTLY ONE move (`moves.match`: a custom "worst-match" matcher standing in for
//               candidateFinder's default top-K-by-cosine dispatch — the design §6 Phase 5 example,
//               "SIF wants a custom matcher") — materialize DIFFERENT edges. The rest of the
//               orchestration (mode dispatch, decisionStore round-trip, write-through-the-guarded-
//               writer, the counts/decisionBlock shape) is asserted UNCHANGED between the two runs,
//               so the divergence traces to the ONE overridden move and nothing else.
//
// Hermetic throughout: doubles for graphReader/vectorizer/writer/decisionStore; a stub llmClient for
// the DEFAULT selector. No container, no Voyage, no Opus, no real graph.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-bridgeSkeleton.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the reusable bridge shell (bridgeSkeleton.js)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the skeleton's own construction-time refusals (RED then GREEN), that overriding a move
     drops that move's OWN kit-member requirement (RED then GREEN), and demonstrates a second bridge
     built on the same skeleton with ONE move overridden materializing DIFFERENT edges than the
     default over IDENTICAL fixtures, while the rest of the orchestration stays unchanged.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const makeBridgeSkeleton = require('../lib/bridgeSkeleton');
const sourceWalkerFactory = require('../lib.d/sourceWalker');
const semanticMatcherFactory = require('../lib.d/semanticMatcher');
const candidateFinderFactory = require('../lib.d/candidateFinder');
const selectorFactory = require('../lib.d/selector');
const decisionFreezerFactory = require('../lib.d/decisionFreezer');
const materializerFactory = require('../lib.d/materializer');

const throwMessage = (fn) => {
	try {
		fn();
		return '';
	} catch (e) {
		return e.message;
	}
};

const VALID_ARGS = () => ({
	mappingTool: 'testBridge',
	hubStandard: 'CEDS',
	defaultMatcherName: 'semanticDefText',
	materializerConfig: { predicate: 'closeMatch', mappingJustification: 'semapv:SemanticSimilarity' },
});

// =====================================================================
harness.section("SECTION 1 — makeBridgeSkeleton() construction-time refusals: RED then GREEN");
// =====================================================================

harness.match(
	'RED: mappingTool not given throws, naming it',
	throwMessage(() => makeBridgeSkeleton({ ...VALID_ARGS(), mappingTool: undefined })),
	/mappingTool is not given/,
);
harness.doesNotThrow('GREEN: mappingTool given does not throw', () => makeBridgeSkeleton(VALID_ARGS()));

harness.match(
	'RED: hubStandard not given throws, naming it',
	throwMessage(() => makeBridgeSkeleton({ ...VALID_ARGS(), hubStandard: undefined })),
	/hubStandard is not given/,
);
harness.doesNotThrow('GREEN: hubStandard given does not throw', () => makeBridgeSkeleton(VALID_ARGS()));

harness.match(
	'RED: defaultMatcherName not given (no moves.match) throws, naming it',
	throwMessage(() => makeBridgeSkeleton({ ...VALID_ARGS(), defaultMatcherName: undefined })),
	/defaultMatcherName is not given/,
);
harness.doesNotThrow(
	'GREEN (twin): defaultMatcherName omitted BUT moves.match supplied does not throw',
	() =>
		makeBridgeSkeleton({
			...VALID_ARGS(),
			defaultMatcherName: undefined,
			moves: { match: () => ({ retrieve: () => [] }) },
		}),
);

harness.match(
	'RED: materializerConfig.predicate not given (no moves.materialize) throws, naming it',
	throwMessage(() => makeBridgeSkeleton({ ...VALID_ARGS(), materializerConfig: { mappingJustification: 'x' } })),
	/materializerConfig\.predicate is not given/,
);
harness.match(
	'RED: materializerConfig.mappingJustification not given throws, naming it',
	throwMessage(() => makeBridgeSkeleton({ ...VALID_ARGS(), materializerConfig: { predicate: 'closeMatch' } })),
	/materializerConfig\.mappingJustification is not given/,
);
harness.doesNotThrow(
	'GREEN (twin): materializerConfig omitted entirely BUT moves.materialize supplied does not throw',
	() =>
		makeBridgeSkeleton({
			...VALID_ARGS(),
			materializerConfig: {},
			moves: { materialize: () => ({ buildInferredSubgraph: () => ({ edges: [], counts: {} }) }) },
		}),
);

// =====================================================================
harness.section("SECTION 2 — overriding a move drops that move's OWN kit-member requirement (RED then GREEN)");
// =====================================================================

const noopGraphReader = { readNodes: (spec, cb) => { void spec; cb('', { nodes: [] }); }, close: (cb) => cb('') };
const noopSourceWalker = { walk: (spec, cb) => { void spec; cb('', { sourceNodes: [] }); } };
const noopVectorizer = { batchEmbed: (spec, cb) => { void spec; cb('', { vectors: [] }); } };
const noopDecisionFreezer = {
	freeze: () => ({ frozenText: '{}', decisionBlockHash: 'h', inferredDecisions: [] }),
	parse: () => ({ inferredDecisions: [] }),
};
const noopMaterializerFactory = () => ({ buildInferredSubgraph: () => ({ edges: [], counts: { orphans: 0, fromGaps: 0 } }) });
const noopWriter = (spec, cb) => { void spec; cb('', { edgeWritten: true }); };
const emptyDecisionStore = {
	getDecisionBlock: (a, cb) => { void a; cb('', { frozenText: null }); },
	saveDecisionBlock: (a, cb) => cb(''),
};

const BASE_ARGS = { inGraph: { graphName: 'DEV_probe' }, hub: 'ceds', applyLabel: 'BridgedRelation' };

// a --rebridge-mode kit that has EVERY member EXCEPT the ones named in `omit` — exercises
// requiredKitMembersFor(true), the branch that adds vectorizer/candidateFinder/selector.
const rebridgeKitMissing = (omit) => {
	const full = {
		config: { sourceStandard: 'lif' },
		decisionStore: emptyDecisionStore,
		rebridge: true,
		graphReader: noopGraphReader,
		sourceWalker: noopSourceWalker,
		vectorizer: noopVectorizer,
		candidateFinder: { find: () => ({ retrieve: () => [] }) },
		selector: { selectFromPool: (s, p, a, b, cb) => cb('', { abstain: true }) },
		decisionFreezer: noopDecisionFreezer,
		materializer: noopMaterializerFactory,
		writer: noopWriter,
	};
	omit.forEach((oneKey) => {
		full[oneKey] = undefined;
	});
	return full;
};

const defaultSkeleton = makeBridgeSkeleton(VALID_ARGS());

// ---- RED: default skeleton (no override) refuses a --rebridge kit missing kit.selector ----
(() => {
	let observed = null;
	defaultSkeleton({ kit: rebridgeKitMissing(['selector']) })(BASE_ARGS, (err) => {
		observed = err;
	});
	harness.match(
		'RED: default skeleton refuses --rebridge kit missing kit.selector',
		observed,
		/kit\.selector is missing/,
	);
})();

// ---- GREEN (twin): moves.select overridden runs the SAME missing-selector kit with no refusal ----
(() => {
	const skeletonWithCustomSelect = makeBridgeSkeleton({
		...VALID_ARGS(),
		moves: { select: (moveArgs, callback) => callback('', { abstain: true }) },
	});
	let observed = null;
	skeletonWithCustomSelect({ kit: rebridgeKitMissing(['selector']) })(BASE_ARGS, (err) => {
		observed = err;
	});
	harness.ok(
		'GREEN: overriding moves.select runs the SAME kit (no kit.selector at all) with no refusal',
		!observed,
		observed,
	);
})();

// ---- RED: default skeleton refuses a --rebridge kit missing kit.candidateFinder ----
(() => {
	let observed = null;
	defaultSkeleton({ kit: rebridgeKitMissing(['candidateFinder']) })(BASE_ARGS, (err) => {
		observed = err;
	});
	harness.match(
		'RED: default skeleton refuses --rebridge kit missing kit.candidateFinder',
		observed,
		/kit\.candidateFinder is missing/,
	);
})();

// ---- GREEN (twin): moves.match overridden runs the SAME missing-candidateFinder kit with no refusal ----
(() => {
	const skeletonWithCustomMatch = makeBridgeSkeleton({
		...VALID_ARGS(),
		moves: { match: () => ({ retrieve: () => [] }) },
	});
	let observed = null;
	skeletonWithCustomMatch({ kit: rebridgeKitMissing(['candidateFinder']) })(BASE_ARGS, (err) => {
		observed = err;
	});
	harness.ok(
		'GREEN: overriding moves.match runs the SAME kit (no kit.candidateFinder at all) with no refusal',
		!observed,
		observed,
	);
})();

// =====================================================================
harness.section('SECTION 3 — REUSABILITY DEMONSTRATION: ONE overridden move materializes DIFFERENT edges');
// =====================================================================

// ---- shared fixture (property-tier only, same shape test-generic-bridge-equivalence.js uses) ----
const referenceNodes = [
	{ stableId: 'ref/P1', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P1', propertyKey: 'P1', qualifierKeys: [] } },
	{ stableId: 'ref/P2', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P2', propertyKey: 'P2', qualifierKeys: [] } },
	{ stableId: 'ref/P3', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P3', propertyKey: 'P3', qualifierKeys: [] } },
];
const textVectors = {
	'src one': [0.9, 0.1, 0],
	'src two': [0.1, 0.9, 0],
	'ceds P1': [1, 0, 0],
	'ceds P2': [0, 1, 0],
	'ceds P3': [0, 0, 1],
};
const sourceGraphNodes = [
	{ stableId: 's1', properties: { _source: 'LIF', role: 'DmeProperty', name: 'src one', defText: 'src one' } },
	{ stableId: 's2', properties: { _source: 'LIF', role: 'DmeProperty', name: 'src two', defText: 'src two' } },
];
const candidateGraphNodes = [
	{ stableId: 'c1', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds one', defText: 'ceds P1', cedsId: 'P1' } },
	{ stableId: 'c2', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds two', defText: 'ceds P2', cedsId: 'P2' } },
	{ stableId: 'c3', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds three', defText: 'ceds P3', cedsId: 'P3' } },
];

const graphReaderDouble = {
	readNodes: ({ label, propertyEquals }, callback) => {
		const eq = propertyEquals || {};
		if (label === 'HubReference') {
			callback('', { nodes: referenceNodes });
			return;
		}
		if (eq._source === 'LIF' && eq.role === 'DmeProperty') {
			callback('', { nodes: sourceGraphNodes });
			return;
		}
		if (eq._source === 'CEDS' && eq.role === 'DmeProperty') {
			callback('', { nodes: candidateGraphNodes });
			return;
		}
		callback('', { nodes: [] });
	},
	close: (callback) => callback(''),
};

const vectorizerDouble = { batchEmbed: ({ texts }, cb) => cb('', { vectors: (texts || []).map((t) => textVectors[t] || null) }) };

const makeWriterDouble = (writes) => (spec, callback) => {
	writes.push({ fromStableId: spec.decision.fromStableId, cedsAnchorKey: spec.decision.properties.cedsAnchorKey });
	callback('', { edgeWritten: true });
};

const makeInMemoryDecisionStore = () => {
	const blocks = {};
	return {
		getDecisionBlock: ({ pairKey }, cb) => cb('', blocks[pairKey] ? { frozenText: blocks[pairKey].frozenText } : { frozenText: null }),
		saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => {
			blocks[pairKey] = { frozenText, decisionBlockHash };
			cb('', { saved: true });
		},
	};
};

// deterministic stub reranker — always picks retrieval rank 1. cosineFloor: 0 (accept anything) so
// the demonstration isolates the MATCH move's ranking effect cleanly, with no floor-abstain noise.
const stubLlm = { rerank: (a, cb) => { void a; cb('', { choice: '1' }); } };
const COSINE_FLOOR = 0;
const runConfig = { sourceStandard: 'lif', sourceVersion: 'v1', hubVersion: 'v14' };

const makeBaselineKit = (writes) => ({
	config: runConfig,
	decisionStore: makeInMemoryDecisionStore(),
	rebridge: true,
	graphReader: graphReaderDouble,
	sourceWalker: sourceWalkerFactory({ graphReader: graphReaderDouble }),
	vectorizer: vectorizerDouble,
	candidateFinder: candidateFinderFactory({ semanticMatcher: semanticMatcherFactory({ topK: 15 }) }),
	selector: selectorFactory({ llmClient: stubLlm, cosineFloor: COSINE_FLOOR }),
	decisionFreezer: decisionFreezerFactory(),
	materializer: materializerFactory,
	writer: makeWriterDouble(writes),
});

// ---- BASELINE bridge: the skeleton's DEFAULT match move (candidateFinder -> semanticMatcher, top-K
// by definition-cosine). No moves override at all — exactly genericBridge's own composition. ----
const baselineSkeleton = makeBridgeSkeleton({
	mappingTool: 'demoDefaultBridge',
	hubStandard: 'CEDS',
	defaultRole: 'DmeProperty',
	defaultMatcherName: 'semanticDefText',
	materializerConfig: { predicate: 'closeMatch', mappingJustification: 'semapv:SemanticSimilarity' },
});

// ---- OVERRIDE bridge: IDENTICAL construction EXCEPT moves.match — a custom "worst-match" matcher
// (design §6 Phase 5's motivating example: a bridge that needs its OWN retrieval/ranking logic in
// place of candidateFinder's default dispatch). Note defaultMatcherName is OMITTED here entirely —
// construction does not even require it once moves.match is supplied (SECTION 1 proves this).
const cosineOnly = semanticMatcherFactory({}).cosine;
const worstMatchMove = () => ({
	retrieve: (source, candidatePool) => {
		const scored = candidatePool.map((oneCandidate) => ({ candidate: oneCandidate, cosine: cosineOnly(source.vector, oneCandidate.vector) }));
		// ASCENDING — the WORST match sorts to rank 1, inverted from the default's descending top-K.
		// This is the ENTIRE override: no other move, no orchestration code, changes at all.
		scored.sort((a, b) => a.cosine - b.cosine);
		return scored;
	},
});
const overrideSkeleton = makeBridgeSkeleton({
	mappingTool: 'demoOverrideBridge',
	hubStandard: 'CEDS',
	defaultRole: 'DmeProperty',
	materializerConfig: { predicate: 'closeMatch', mappingJustification: 'semapv:SemanticSimilarity' },
	moves: { match: worstMatchMove },
});

const writesBaseline = [];
const writesOverride = [];

let baselineReport = null;
let overrideReport = null;

baselineSkeleton({ kit: makeBaselineKit(writesBaseline) })(BASE_ARGS, (err, report) => {
	harness.ok(`baseline (default match) --rebridge did not error (${err || 'ok'})`, !err, err);
	baselineReport = report;
});

overrideSkeleton({ kit: makeBaselineKit(writesOverride) })(BASE_ARGS, (err, report) => {
	harness.ok(`override (custom worst-match) --rebridge did not error (${err || 'ok'})`, !err, err);
	overrideReport = report;
});

harness.equal('baseline wrote 2 edges', writesBaseline.length, 2);
harness.equal('override wrote 2 edges (SAME count — the write orchestration is unaffected by the override)', writesOverride.length, 2);

const baselineTargets = JSON.stringify(writesBaseline.map((w) => `${w.fromStableId}->${w.cedsAnchorKey}`).sort());
const overrideTargets = JSON.stringify(writesOverride.map((w) => `${w.fromStableId}->${w.cedsAnchorKey}`).sort());

harness.equal('baseline (default match) picks the BEST match per source', baselineTargets, JSON.stringify(['s1->P1', 's2->P2']));
harness.equal('override (custom worst-match) picks the WORST match per source', overrideTargets, JSON.stringify(['s1->P3', 's2->P3']));
harness.ok(
	'THE OVERRIDE ACTUALLY TOOK EFFECT: the two bridges materialize DIFFERENT edges over IDENTICAL fixtures (the seam is real, not cosmetic)',
	baselineTargets !== overrideTargets,
	`both bridges produced the SAME edges: ${baselineTargets}`,
);

harness.ok(
	'both runs report the SAME shape of orchestration output (mode dispatch, counts, decisionBlock are unaffected by the move override)',
	!!baselineReport &&
		!!overrideReport &&
		baselineReport.counts.mode === 'rebridge' &&
		overrideReport.counts.mode === 'rebridge' &&
		typeof baselineReport.decisionBlock === 'string' &&
		typeof overrideReport.decisionBlock === 'string' &&
		baselineReport.producer === 'inferred' &&
		overrideReport.producer === 'inferred',
	`baseline=${JSON.stringify(baselineReport)}, override=${JSON.stringify(overrideReport)}`,
);

harness.report();
