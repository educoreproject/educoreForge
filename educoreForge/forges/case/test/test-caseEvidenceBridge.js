#!/usr/bin/env node
'use strict';

// test-caseEvidenceBridge.js — hermetic gate for forges/case/bridges/caseEvidenceBridge.js
// (bridgeEvidenceRefactor-spec.md §7 P5): caseStructuralBridge's scalar signal re-expressed as
// EVIDENCE. PURE + synchronous + deterministic where the module itself is (the pure helpers, the
// nominate/walk hooks, the REAL evidenceComposer run); the full-flow sections drive the REAL
// bridgeMaker.run() with a STUBBED llmClient (no real Anthropic call) and graphReader/graphWriter/
// vectorizer doubles, exactly test-generic-bridge-evidence.js's own PART B discipline.
//
// PROVES:
//   SECTION 1 — the ported pure helpers (tokenize/casePathSegments/pathTokensFromStableId/
//     candidateTokens/overlapCoefficient/structuralAffinity/sharedTokens), including the two new ones
//     (casePathSegments, sharedTokens) this file adds beyond caseStructuralBridge.js's own set.
//   SECTION 2 — caseNominate in isolation: RED (non-CASE-shaped source nominates nothing), GREEN
//     (token-sharing candidates nominated with a rationale naming the shared tokens), the TOPK cap.
//   SECTION 3 — caseWalk in isolation: a per-candidate note on EVERY pool candidate (including one with
//     ZERO overlap — "retrieved by cosine alone"), and the ONE global segment.
//   SECTION 4 — THE HEADLINE PROOF, through the REAL kit.evidenceComposer (lib/evidenceComposer.js,
//     not a double): a candidate ABSENT from cosine top-K (topK=1) but token-sharing with the source's
//     casePath ENTERS the pool via caseNominate, carrying its nomination rationale; a candidate that is
//     NEITHER cosine-top-K NOR token-sharing is ABSENT from the pool entirely; every pool candidate
//     carries the per-candidate structural-location note; the assembled evidencePackage passes the REAL
//     evidencePackageViolation oracle (⟪A3⟫); the global segment appears EXACTLY ONCE.
//   SECTION 5 — THE SMUGGLING GATE (⟪A3⟫) TWIN: RED — a deliberately candidate-naming segment IS
//     refused by the REAL evidencePackageViolation; GREEN — CASE_GLOBAL_SEGMENT, run through the SAME
//     gate over the SAME pool, passes clean. Not asserted by inspection alone — both run through the
//     real oracle.
//   SECTION 6 — PART A-style wiring-fault twins (unit-level, direct calls, no bridgeMaker involved):
//     every refusal genericBridge.js proves (missing kit, missing decisionStore, --rebridge with no
//     llmClient, hub mismatch, missing config.sourceStandard, missing applyLabel/inGraph) PLUS this
//     bridge's OWN new refusal (source standard other than CASE).
//   SECTION 7 — THE FULL EVIDENCE FLOW through the REAL bridgeMaker.run(), REBRIDGE then MATERIALIZE:
//     the nomination-recovered candidate is the one the stub LLM picks (proving the recall recovery is
//     not merely a composer-level artifact but actually reaches a written edge); MATERIALIZE replays
//     byte-identically with ZERO additional llmClient calls.
//   SECTION 8 — RESOLVER CHECK: 'caseEvidenceBridge' resolves to exactly ONE file via bridgeMaker's
//     standard-local search (source: 'case').
//
// Run: node forges/case/test/test-caseEvidenceBridge.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for forges/case/bridges/caseEvidenceBridge.js

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the ported pure helpers, the nominate/walk hooks in isolation, the headline nomination-
     recovers-recall proof through the REAL evidenceComposer, the ⟪A3⟫ smuggling-gate RED/GREEN twin,
     the bridge's own wiring-fault twins, and the full evidence flow (REBRIDGE then MATERIALIZE)
     through the REAL bridgeMaker.run() with a stubbed llmClient.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');

const bridgeModule = require('../bridges/caseEvidenceBridge');
const bridgeMakerModule = require('../../../apps/graph-builder/apps/bridge-maker/bridgeMaker');
const evidenceComposerFactory = require('../../../apps/graph-builder/apps/bridge-maker/lib/evidenceComposer');
const { evidencePackageViolation } = require('../../../apps/graph-builder/apps/bridge-maker/lib/evidenceContracts');

const {
	tokenize,
	casePathSegments,
	pathTokensFromStableId,
	candidateTokens,
	overlapCoefficient,
	structuralAffinity,
	sharedTokens,
	caseNominate,
	caseWalk,
	CASE_GLOBAL_SEGMENT,
	CASE_NOMINATION_TOPK,
	MAPPING_TOOL,
	SOURCE_STANDARD,
} = bridgeModule;

// =====================================================================
harness.section('SECTION 1 — the ported pure helpers');
// =====================================================================
(() => {
	harness.equal(
		'tokenize: camelCase boundary split, lowercased',
		JSON.stringify(tokenize('rubricCriterionId')),
		JSON.stringify(['rubric', 'criterion']), // 'id' filtered: length <= 2
	);
	harness.equal(
		'tokenize: acronym-prefixed class name splits the acronym off',
		JSON.stringify(tokenize('CFRubric')),
		JSON.stringify(['rubric']),
	);
	harness.equal('tokenize: null/undefined -> empty array', JSON.stringify(tokenize(undefined)), '[]');

	harness.equal(
		'casePathSegments: a well-shaped CASE stableId yields {className, propertyName}',
		JSON.stringify(casePathSegments('case:CFRubric.rubricCriterionId')),
		JSON.stringify({ className: 'CFRubric', propertyName: 'rubricCriterionId' }),
	);
	harness.ok('casePathSegments: a non-CASE stableId yields null, never a guess', casePathSegments('lif:SomeProperty') === null);
	harness.ok('casePathSegments: a null stableId yields null', casePathSegments(null) === null);

	harness.equal(
		'pathTokensFromStableId: className + propertyName tokens, unioned',
		JSON.stringify([...pathTokensFromStableId('case:CFRubric.rubricCriterionId')].sort()),
		JSON.stringify(['criterion', 'rubric']),
	);
	harness.ok('pathTokensFromStableId: non-CASE stableId -> empty set', pathTokensFromStableId('lif:X').size === 0);

	const candTokens = candidateTokens({ name: 'Rubric Criterion Identifier', defText: 'The identifier for a rubric criterion.' });
	harness.equal(
		'candidateTokens: name+defText tokenized and unioned, stopwords dropped',
		JSON.stringify([...candTokens].sort()),
		JSON.stringify(['criterion', 'identifier', 'rubric']),
	);

	harness.equal('overlapCoefficient: full containment of the smaller set scores 1.0', overlapCoefficient(new Set(['a1', 'bb2']), new Set(['a1', 'bb2', 'cc3'])), 1);
	harness.equal('overlapCoefficient: empty set on either side scores 0', overlapCoefficient(new Set(['a1']), new Set()), 0);

	harness.equal(
		'structuralAffinity: composes pathTokens vs candidateTokens via overlapCoefficient',
		structuralAffinity(new Set(['rubric', 'criterion']), { name: 'Rubric Criterion Identifier', defText: '' }),
		1,
	);

	harness.equal(
		'sharedTokens: the ACTUAL intersecting tokens, not a re-hidden score',
		JSON.stringify(sharedTokens(new Set(['rubric', 'criterion']), { name: 'Rubric Criterion Identifier', defText: '' }).sort()),
		JSON.stringify(['criterion', 'rubric']),
	);
	harness.equal('sharedTokens: no overlap -> empty array', JSON.stringify(sharedTokens(new Set(['rubric']), { name: 'Generic Caption', defText: '' })), '[]');
})();

// =====================================================================
harness.section('SECTION 2 — caseNominate in isolation');
// =====================================================================
(() => {
	const source = { stableId: 'case:CFRubric.rubricCriterionId', name: 'rubricCriterionId' };
	const candA = { stableId: 'ceds:P900001', cedsId: 'P900001', name: 'Generic Caption', defText: 'A generic caption used for display purposes.' };
	const candB = { stableId: 'ceds:P900002', cedsId: 'P900002', name: 'Rubric Criterion Identifier', defText: 'The identifier for a rubric criterion.' };

	// RED — a non-CASE-shaped source nominates NOTHING, never a guessed nomination.
	let redResult = null;
	caseNominate({ sourceElement: { stableId: 'lif:SomeProperty' }, candidateElements: [candA, candB] }, (err, nominations) => {
		redResult = { err, nominations };
	});
	harness.equal('RED: a non-CASE-shaped source nominates zero candidates', redResult && redResult.nominations.length, 0);
	harness.equal('RED: no error either — an empty nomination list is honest, not a fault', redResult && redResult.err, '');

	// GREEN — the token-sharing candidate is nominated; the unrelated one is not.
	let greenResult = null;
	caseNominate({ sourceElement: source, candidateElements: [candA, candB] }, (err, nominations) => {
		greenResult = { err, nominations };
	});
	harness.equal('GREEN: no error', greenResult && greenResult.err, '');
	harness.equal('GREEN: exactly ONE candidate nominated (candB, the token-sharing one)', greenResult && greenResult.nominations.length, 1);
	const nomination = greenResult.nominations[0];
	harness.equal('GREEN: the nominated candidate IS candB', nomination.candidate, candB);
	harness.equal('GREEN: nominatedBy is this bridge\'s own MAPPING_TOOL', nomination.nominatedBy, MAPPING_TOOL);
	harness.match('GREEN: the rationale names the owning class and the shared tokens', nomination.rationale, /owning class 'CFRubric'.*rubric.*criterion/s);
	harness.ok('GREEN: the rationale is a non-empty string (evidencePackageViolation\'s own nomination requirement)', typeof nomination.rationale === 'string' && nomination.rationale.trim().length > 0);

	// CAP — CASE_NOMINATION_TOPK bounds the nomination list even when many candidates overlap.
	const manyOverlapping = Array.from({ length: CASE_NOMINATION_TOPK + 5 }, (v, i) => ({
		stableId: `ceds:Pmany${i}`,
		cedsId: `Pmany${i}`,
		name: `Rubric Criterion Variant ${i}`,
		defText: 'rubric criterion text',
	}));
	let cappedResult = null;
	caseNominate({ sourceElement: source, candidateElements: manyOverlapping }, (err, nominations) => {
		cappedResult = { err, nominations };
	});
	harness.equal(`CAP: nominations never exceed CASE_NOMINATION_TOPK (${CASE_NOMINATION_TOPK})`, cappedResult && cappedResult.nominations.length, CASE_NOMINATION_TOPK);
})();

// =====================================================================
harness.section('SECTION 3 — caseWalk in isolation');
// =====================================================================
(() => {
	const source = { stableId: 'case:CFRubric.rubricCriterionId', name: 'rubricCriterionId' };
	const candOverlap = { stableId: 'ceds:P900002', cedsId: 'P900002', name: 'Rubric Criterion Identifier', defText: 'The identifier for a rubric criterion.' };
	const candNoOverlap = { stableId: 'ceds:P900001', cedsId: 'P900001', name: 'Generic Caption', defText: 'A generic caption used for display purposes.' };

	let walkResult = null;
	caseWalk({ sourceElement: source, pool: [candOverlap, candNoOverlap], graphReader: null, dependencies: ['case', 'ceds'] }, (err, result) => {
		walkResult = { err, result };
	});
	harness.equal('caseWalk: no error', walkResult && walkResult.err, '');
	harness.equal('caseWalk: a note for BOTH pool candidates', Object.keys(walkResult.result.perCandidateNotes).length, 2);
	harness.match(
		'caseWalk: the overlapping candidate\'s note names the structural location AND the shared tokens',
		walkResult.result.perCandidateNotes['ceds:P900002'][0],
		/owning class 'CFRubric', property 'rubricCriterionId'.*rubric.*criterion/s,
	);
	harness.match(
		'caseWalk: the non-overlapping candidate\'s note is honest about having none',
		walkResult.result.perCandidateNotes['ceds:P900001'][0],
		/\(none — retrieved by cosine alone\)/,
	);
	harness.equal('caseWalk: EXACTLY ONE global segment', walkResult.result.promptSegments.length, 1);
	harness.equal('caseWalk: the global segment IS CASE_GLOBAL_SEGMENT', walkResult.result.promptSegments[0], CASE_GLOBAL_SEGMENT);
})();

// =====================================================================
harness.section('SECTION 4 — THE HEADLINE PROOF: nomination recovers a cosine top-K miss, through the REAL evidenceComposer');
// =====================================================================
(() => {
	// Fixture: source = [1,0]. candA is a HIGH-cosine, structurally UNRELATED candidate (retrieved by
	// cosine alone). candB is a ZERO-cosine (orthogonal), structurally RELATED candidate — with topK=1,
	// candB is excluded from cosine retrieval entirely; caseNominate is its ONLY way into the pool.
	// candC is BOTH low-cosine AND structurally unrelated — it must be ABSENT from the final pool.
	const source = { stableId: 'case:CFRubric.rubricCriterionId', name: 'rubricCriterionId', vector: [1, 0] };
	const candA = { stableId: 'ceds:P900001', cedsId: 'P900001', name: 'Generic Caption', defText: 'A generic caption used for display purposes.', vector: [0.99, Math.sqrt(1 - 0.99 * 0.99)] };
	const candB = { stableId: 'ceds:P900002', cedsId: 'P900002', name: 'Rubric Criterion Identifier', defText: 'The identifier for a rubric criterion.', vector: [0, 1] };
	const candC = { stableId: 'ceds:P900003', cedsId: 'P900003', name: 'Unrelated Widget Description', defText: 'Completely unrelated content with no shared vocabulary.', vector: [-1, 0] };
	const candidateElements = [candA, candB, candC];

	// fixture sanity, computed with the SAME helpers the hooks use.
	const pathTokens = pathTokensFromStableId(source.stableId);
	harness.equal('fixture check: candB has FULL structural affinity to the source path', structuralAffinity(pathTokens, candB), 1);
	harness.equal('fixture check: candA has ZERO structural affinity', structuralAffinity(pathTokens, candA), 0);
	harness.equal('fixture check: candC has ZERO structural affinity', structuralAffinity(pathTokens, candC), 0);

	// a semanticMatcher double with topK=1 — byte-simple cosine, forced to a narrow top-K so candB's
	// exclusion from cosine-only retrieval is unambiguous (a REAL top-K knob, not a rigged double).
	const cosine = (a, b) => {
		if (!a || !b) return -1;
		let dot = 0, na = 0, nb = 0;
		for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
		return na === 0 || nb === 0 ? -1 : dot / (Math.sqrt(na) * Math.sqrt(nb));
	};
	const narrowSemanticMatcher = {
		cosine,
		retrieve: (src, pool) =>
			pool.map((c) => ({ candidate: c, cosine: cosine(src.vector, c.vector) })).sort((a, b) => b.cosine - a.cosine).slice(0, 1),
	};

	// a minimal, contract-conforming hub module double: every pool candidate gets a valid property-tier
	// BaseTupleEvidence (hubModulePresentationViolation-clean), keyed off its own cedsId.
	const fakeHubModule = (candidate, callback) => {
		callback('', {
			referenceTier: 'property',
			canonicalKey: candidate.cedsId,
			propertyKey: candidate.cedsId,
			name: candidate.name,
			domains: [{ domainId: 'C000001', domainName: null }],
			domainsComplete: true,
			range: { shape: 'datatype', rangeDatatype: 'string', rangeClassId: null, rangeOptionSetId: null },
			isQualified: false,
			qualifier: null,
			value: null,
		});
	};
	const noopGraphReader = { readNodes: (spec, cb) => cb('', { nodes: [] }), close: (cb) => cb('') };

	const composer = evidenceComposerFactory({
		semanticMatcher: narrowSemanticMatcher,
		nominate: caseNominate,
		walk: caseWalk,
		dependencies: ['case', 'ceds'],
	});

	let composed = null;
	composer({ sourceElement: source, candidateElements, graphReader: noopGraphReader, hubModule: fakeHubModule }, (err, evidencePackage) => {
		composed = { err, evidencePackage };
	});

	harness.equal('composer: no error', composed && composed.err, '');
	const pool = composed.evidencePackage.pool;
	const poolIds = pool.map((e) => e.candidate.stableId).sort();
	harness.equal('the pool is EXACTLY {candA (cosine top-K), candB (nominated)} — candC is ABSENT', JSON.stringify(poolIds), JSON.stringify(['ceds:P900001', 'ceds:P900002']));

	const candBEntry = pool.find((e) => e.candidate.stableId === 'ceds:P900002');
	harness.ok('candB entered the pool carrying a `nomination` (⟪A1⟫)', !!candBEntry.nomination);
	harness.equal('candB\'s nomination is attributed to this bridge', candBEntry.nomination.nominatedBy, MAPPING_TOOL);
	harness.match('candB\'s nomination rationale names the shared structural tokens', candBEntry.nomination.rationale, /rubric.*criterion/s);
	harness.equal(
		'candB\'s cosine field is its OWN base cosine (0, computed fresh since it was NOT cosine-retrieved), never fabricated',
		Math.round(candBEntry.cosine * 1e6) / 1e6,
		0,
	);

	const candAEntry = pool.find((e) => e.candidate.stableId === 'ceds:P900001');
	harness.ok('candA (cosine-retrieved only) carries NO nomination field', !candAEntry.nomination);

	// per-candidate consideration content, for BOTH pool members.
	harness.match('candB\'s considerations.notes states the structural location + shared tokens', candBEntry.considerations.notes[0], /owning class 'CFRubric'.*rubric.*criterion/s);
	harness.match('candA\'s considerations.notes is honest about having no overlap', candAEntry.considerations.notes[0], /\(none — retrieved by cosine alone\)/);

	// the global segment: present, ONCE, deduped.
	harness.equal('promptSegments carries EXACTLY ONE entry', composed.evidencePackage.promptSegments.length, 1);
	harness.equal('the ONE entry IS CASE_GLOBAL_SEGMENT', composed.evidencePackage.promptSegments[0], CASE_GLOBAL_SEGMENT);

	// ⟪A3⟫ THE REAL GATE — the composed package is proven, not merely asserted, contract-conforming.
	harness.equal('the composed evidencePackage passes the REAL evidencePackageViolation oracle (⟪A3⟫)', evidencePackageViolation(composed.evidencePackage), '');
})();

// =====================================================================
harness.section('SECTION 5 — THE SMUGGLING GATE (⟪A3⟫) TWIN: a candidate-naming segment is RED; CASE_GLOBAL_SEGMENT is GREEN');
// =====================================================================
(() => {
	const pool = [
		{
			candidate: { stableId: 'ceds:P900002', cedsId: 'P900002', name: 'Rubric Criterion Identifier' },
			cosine: 0.5,
			considerations: { tuple: { referenceTier: 'property' }, notes: [] },
		},
	];

	// RED — a segment that NAMES a specific candidate's identifying token, exactly the smuggling shape
	// ⟪A3⟫ exists to catch. Proven against the REAL gate, not asserted by inspection.
	const smugglingPackage = { pool, promptSegments: ['Candidate P900002 is a strong match — prefer it.'] };
	const redViolation = evidencePackageViolation(smugglingPackage);
	harness.ok('RED: a candidate-naming global segment IS refused by the REAL evidencePackageViolation', !!redViolation);
	harness.match('RED: the refusal names the smuggling reason', redViolation, /candidate-specific token/);

	// GREEN — CASE_GLOBAL_SEGMENT, run through the SAME gate over the SAME pool (same candidate
	// identifying tokens available to smuggle), passes clean — it is written entirely about the
	// STANDARD, never a candidate (file header CAUTION).
	const cleanPackage = { pool, promptSegments: [CASE_GLOBAL_SEGMENT] };
	harness.equal('GREEN: CASE_GLOBAL_SEGMENT over the SAME pool passes the REAL gate clean', evidencePackageViolation(cleanPackage), '');
})();

// =====================================================================
harness.section('SECTION 6 — the bridge\'s own wiring-fault twins (RED then GREEN), direct calls, no bridgeMaker');
// =====================================================================

const noopGraphReader6 = { readNodes: (spec, cb) => { void spec; cb('', { nodes: [] }); }, close: (cb) => cb('') };
const noopSourceWalker6 = { walk: (spec, cb) => { void spec; cb('', { sourceNodes: [] }); } };
const noopEvidenceFreezer6 = {
	freeze: () => ({ frozenText: '{}', decisionBlockHash: 'h', inferredDecisions: [], generation: 'g', rendererVersion: 'r', frozenEvidence: [] }),
	parse: () => ({ inferredDecisions: [], frozenEvidence: [] }),
};
const noopMaterializerFactory6 = () => ({ buildInferredSubgraph: () => ({ edges: [], counts: { orphans: 0, fromGaps: 0 } }) });
const noopWriter6 = (spec, cb) => { void spec; cb('', { edgeWritten: true }); };
const noBlockDecisionStore6 = {
	getDecisionBlock: (a, cb) => { void a; cb('', { frozenText: null }); },
	saveDecisionBlock: (a, cb) => { void a; cb(''); },
};

const baseKit6 = (overrides = {}) => ({
	config: { sourceStandard: 'case' },
	decisionStore: noBlockDecisionStore6,
	rebridge: false,
	graphReader: noopGraphReader6,
	sourceWalker: noopSourceWalker6,
	evidenceFreezer: noopEvidenceFreezer6,
	materializer: noopMaterializerFactory6,
	writer: noopWriter6,
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

const runDirect6 = (injectedTools, spec, done) => bridgeModule(injectedTools)(spec, done);
const BASE_ARGS6 = { inGraph: { graphName: 'DEV_probe' }, hub: 'ceds', applyLabel: 'BridgedRelation' };

(() => {
	let observed = null;
	runDirect6({ kit: baseKit6() }, BASE_ARGS6, (err, result) => { observed = { err, result }; });
	harness.equal('GREEN base case: a valid materialize-no-block kit runs with no error', observed && observed.err, '');
	harness.ok('  and returns the honest zero-edge / null-decisionBlock status', observed && observed.result && observed.result.edgesWritten === 0 && observed.result.decisionBlock === null);
})();

(() => {
	let observed = null;
	runDirect6({}, BASE_ARGS6, (err) => { observed = err; });
	harness.rejects('RED: injectedTools.kit is not given is refused by name', [observed], /injectedTools\.kit is not given/);
})();

(() => {
	let observed = null;
	runDirect6({ kit: baseKit6({ decisionStore: null }) }, BASE_ARGS6, (err) => { observed = err; });
	harness.rejects('RED: kit.decisionStore missing is refused by name', [observed], /kit\.decisionStore .*REQUIRED/);
})();

(() => {
	let observed = null;
	runDirect6({ kit: baseKit6({ rebridge: true }) }, BASE_ARGS6, (err) => { observed = err; });
	harness.rejects(
		'RED: --rebridge with the evidence-path kit members missing is refused by name',
		[observed],
		/kit\.(vectorizer|semanticMatcher|evidenceComposer|cedsHubModule|evidenceRenderer|evidenceSelect|confidenceNormalizer) is missing/,
	);
})();

(() => {
	let observed = null;
	runDirect6(
		{
			kit: baseKit6({
				rebridge: true,
				vectorizer: {}, semanticMatcher: {}, evidenceComposer: () => {}, cedsHubModule: () => {},
				evidenceRenderer: { render: () => {}, RENDERER_VERSION: 'v1' }, evidenceSelect: () => {}, confidenceNormalizer: () => {},
				inferenceConfig: {},
			}),
		},
		BASE_ARGS6,
		(err) => { observed = err; },
	);
	harness.rejects('RED: --rebridge with kit.inferenceConfig.llmClient missing is refused by name', [observed], /kit\.inferenceConfig\.llmClient .*is missing.*SELECT_SHAPE/s);
})();

(() => {
	let observed = null;
	runDirect6({ kit: baseKit6() }, { ...BASE_ARGS6, hub: 'sif' }, (err) => { observed = err; });
	harness.rejects('RED: hub other than CEDS is refused by name', [observed], /hub is 'sif'.*CEDS hub only/);
})();

(() => {
	let observed = null;
	runDirect6({ kit: baseKit6({ config: {} }) }, BASE_ARGS6, (err) => { observed = err; });
	harness.rejects('RED: config.sourceStandard not set is refused by name', [observed], /config\.sourceStandard is not set/);
})();

// ---- THIS BRIDGE'S OWN new refusal — a source standard other than CASE ----
(() => {
	let observed = null;
	runDirect6({ kit: baseKit6({ config: { sourceStandard: 'lif' } }) }, BASE_ARGS6, (err) => { observed = err; });
	harness.rejects(
		`RED (new to this bridge): source standard other than ${SOURCE_STANDARD} is refused by name`,
		[observed],
		/sourceStandard is 'LIF', but this bridge sources from CASE only/,
	);
})();
(() => {
	let observed = null;
	runDirect6({ kit: baseKit6({ config: { sourceStandard: 'case' } }) }, BASE_ARGS6, (err) => { observed = err; });
	harness.equal('GREEN twin: sourceStandard=case is accepted (no error)', observed, '');
})();

(() => {
	let observed = null;
	const { applyLabel, ...withoutLabel } = BASE_ARGS6;
	void applyLabel;
	runDirect6({ kit: baseKit6() }, withoutLabel, (err) => { observed = err; });
	harness.rejects('RED: applyLabel not given is refused by name', [observed], /applyLabel/);
})();

(() => {
	let observed = null;
	const { inGraph, ...withoutGraph } = BASE_ARGS6;
	void inGraph;
	runDirect6({ kit: baseKit6() }, withoutGraph, (err) => { observed = err; });
	harness.rejects('RED: inGraph not given is refused by name', [observed], /inGraph is not given/);
})();

// =====================================================================
harness.section('SECTION 7 — THE FULL EVIDENCE FLOW through the REAL bridgeMaker.run(): REBRIDGE then MATERIALIZE');
// =====================================================================

// ONE CASE source whose casePath structurally matches a candidate a NARROW cosine top-K (topK=1) would
// otherwise never see — the SAME fixture shape as SECTION 4, now driven end-to-end so the recovered
// candidate is proven to reach an ACTUAL written edge, not merely the composer's own pool.
const referenceNodesRaw7 = [
	{ stableId: 'cedsHubRef:addr1', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P900001', propertyKey: 'P900001', name: 'Generic Caption', domainId: 'C200001', rangeDatatype: 'string', qualifierKeys: [] } },
	{ stableId: 'cedsHubRef:addr2', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P900002', propertyKey: 'P900002', name: 'Rubric Criterion Identifier', domainId: 'C200002', rangeDatatype: 'string', qualifierKeys: [] } },
];

const sourceGraphNodes7 = [
	{ stableId: 'case:CFRubric.rubricCriterionId', properties: { _source: 'CASE', role: 'DmeProperty', name: 'rubricCriterionId', defText: '' } }, // CASE's own frequent-empty-defText shape (file header)
];

const textVectors7 = {
	'': [0, 1], // s1's own empty defText -- ORTHOGONAL to candA, cosine 0 -- narrow topK=1 keeps only candA, s1's true structural match (candB) is cosine-invisible; only caseNominate can recover it
	'Generic Caption': [1, 0], // addr1 -- the wrong-domain, HIGH-cosine distractor
	'Rubric Criterion Identifier': [0, 0.999], // addr2 -- near-parallel to s1's vector -- the structurally-correct pick, deliberately kept OUT of a topK=1 slice by being narrowly second
};

const graphReaderDouble7 = ({ inGraph }) => ({
	readNodes: ({ label, propertyEquals }, callback) => {
		void inGraph;
		const eq = propertyEquals || {};
		if (label === 'HubReference') { callback('', { nodes: referenceNodesRaw7 }); return; }
		if (eq._source === 'CASE' && eq.role === 'DmeProperty') { callback('', { nodes: sourceGraphNodes7 }); return; }
		callback('', { nodes: [] });
	},
	close: (callback) => callback(''),
});

const makeWriterDouble7 = (writes) => ({ inGraph }) => ({
	writeRelationshipEdge: (spec, callback) => { void inGraph; writes.push({ ...spec }); callback('', { edgeWritten: true }); },
	close: (callback) => callback(''),
});

const fakeVectorizerFactory7 = () => ({
	batchEmbed: ({ texts }, cb) => cb('', { vectors: (texts || []).map((t) => textVectors7[t] || null) }),
});

const runConfig7 = { sourceStandard: 'case', sourceVersion: 'v1', hubVersion: 'v14.0.0.0', dependencies: ['case', 'ceds'] };

// stubLlm — distinguishes candB (the nomination-recovered candidate) by its OWN nomination rationale
// text, which the renderer stamps verbatim into the candidate block (evidenceRenderer.js's own
// renderCandidateBlock: "Nominated by <tool>: <rationale>") — the one honest signal available to a
// hermetic stub standing in for a real model that WOULD read the full evidence and judge accordingly.
let rerankCallCount7 = 0;
const stubLlm7 = {
	rerank: (spec, callback) => {
		rerankCallCount7 += 1;
		const pickOrdinal = spec.userPrompt.includes(`Nominated by ${MAPPING_TOOL}`)
			? spec.userPrompt.split('\n').findIndex((line) => line.includes(`Nominated by ${MAPPING_TOOL}`))
			: -1;
		void pickOrdinal;
		// the nominated candidate's own header line carries "Rubric Criterion Identifier" -- find its
		// ordinal directly off the rendered candidate headers rather than fragile line-splitting.
		const match = spec.userPrompt.match(/(\d+)\) Rubric Criterion Identifier/);
		if (match) {
			callback('', { choice: match[1], category: 'strong', rationale: 'the nominated candidate shares the source\'s structural class/property tokens' });
			return;
		}
		callback('', { choice: 'NONE', rationale: 'no candidate is supported by the evidence' });
	},
};

const rebridgeWrites7 = [];
const decisionBlocks7 = {};
const decisionStore7 = {
	getDecisionBlock: ({ pairKey }, cb) => cb('', decisionBlocks7[pairKey] ? { frozenText: decisionBlocks7[pairKey].frozenText } : { frozenText: null }),
	saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => { decisionBlocks7[pairKey] = { frozenText, decisionBlockHash }; cb('', { saved: true }); },
};

let rebridgeReport7 = null;
bridgeMakerModule({ graphWriterFactory: makeWriterDouble7(rebridgeWrites7), graphReaderFactory: graphReaderDouble7 }).run(
	{
		inGraph: { graphName: 'DEV_case_evidence_rb', boltUrl: 'bolt://x', password: 'x' },
		bridge: 'caseEvidenceBridge', source: 'case', hub: 'ceds', applyLabel: 'BridgedRelation',
		rebridge: true, decisionStore: decisionStore7,
		inferenceConfig: { llmClient: stubLlm7, topK: 1, cosineFloor: -1, concurrency: 4 },
		config: runConfig7,
		componentOverrides: { vectorizer: fakeVectorizerFactory7, graphReader: graphReaderDouble7 },
	},
	(err, report) => { rebridgeReport7 = { err, report }; },
);

harness.ok(`REBRIDGE did not error (${(rebridgeReport7 && rebridgeReport7.err) || 'ok'})`, rebridgeReport7 && !rebridgeReport7.err, rebridgeReport7 && rebridgeReport7.err);
harness.equal('REBRIDGE: exactly 1 rerank call (one source)', rerankCallCount7, 1);
harness.equal('REBRIDGE: exactly ONE edge written', rebridgeReport7.report && rebridgeReport7.report.edgesWritten, 1);
harness.equal('REBRIDGE: result.generation is this bridge\'s own EVIDENCE_GENERATION tag', rebridgeReport7.report.generation, bridgeModule.EVIDENCE_GENERATION);

harness.ok('exactly one edge was written', rebridgeWrites7.length === 1, JSON.stringify(rebridgeWrites7));
const writtenEdge7 = rebridgeWrites7[0];
harness.equal(
	'THE HEADLINE PROOF, end-to-end: the written edge targets addr2 -- the nomination-RECOVERED candidate, invisible to a topK=1 cosine retrieval alone',
	writtenEdge7 && writtenEdge7.toStableId,
	'cedsHubRef:addr2',
);
harness.equal('  mappingTool is this bridge\'s own name', writtenEdge7 && writtenEdge7.properties.mappingTool, MAPPING_TOOL);
harness.equal('  predicate is stamped as ever', writtenEdge7 && writtenEdge7.properties.predicate, 'closeMatch');

// the frozen block's own evidence package, re-checked through the REAL gates -- not merely trusted.
const evidenceFreezerFactory7 = require('../../../apps/graph-builder/apps/bridge-maker/lib/evidenceFreezer');
const { hubModulePresentationViolation } = require('../../../apps/graph-builder/apps/bridge-maker/lib/evidenceContracts');
const frozenBlock7 = decisionBlocks7['CEDS::CASE'];
harness.ok('a real frozen evidence-decision block was saved under pairKey CEDS::CASE', !!frozenBlock7);
const parsedFrozen7 = evidenceFreezerFactory7().parse(frozenBlock7.frozenText);
harness.ok('the frozen block parses with no error', !parsedFrozen7.error, parsedFrozen7.error);
const s1Frozen7 = parsedFrozen7.frozenEvidence.find((e) => e.sourceStableId === 'case:CFRubric.rubricCriterionId');
harness.ok('s1\'s frozen evidence is retrievable', !!s1Frozen7);
harness.equal('s1\'s frozen evidencePackage passes the REAL evidencePackageViolation oracle (⟪A3⟫)', evidencePackageViolation(s1Frozen7.evidencePackage), '');
s1Frozen7.evidencePackage.pool.forEach((onePoolEntry) => {
	harness.equal('  each pool candidate\'s hub tuple passes the REAL hubModulePresentationViolation oracle (R5)', hubModulePresentationViolation(onePoolEntry.considerations.tuple), '');
});
harness.equal('s1\'s frozen category is "strong"', s1Frozen7.judgment.category, 'strong');

// =====================================================================
harness.section('SECTION 7 (cont.) — MATERIALIZE: the SAME frozen block replayed, ZERO llm calls');
// =====================================================================

const rerankCallsBeforeMaterialize7 = rerankCallCount7;
const materializeWrites7 = [];
let materializeReport7 = null;
bridgeMakerModule({ graphWriterFactory: makeWriterDouble7(materializeWrites7), graphReaderFactory: graphReaderDouble7 }).run(
	{
		inGraph: { graphName: 'DEV_case_evidence_mat', boltUrl: 'bolt://x', password: 'x' },
		bridge: 'caseEvidenceBridge', source: 'case', hub: 'ceds', applyLabel: 'BridgedRelation',
		rebridge: false, decisionStore: decisionStore7,
		inferenceConfig: { llmClient: stubLlm7, topK: 1, cosineFloor: -1 },
		config: runConfig7,
		componentOverrides: { vectorizer: fakeVectorizerFactory7, graphReader: graphReaderDouble7 },
	},
	(err, report) => { materializeReport7 = { err, report }; },
);

harness.ok(`MATERIALIZE did not error (${(materializeReport7 && materializeReport7.err) || 'ok'})`, materializeReport7 && !materializeReport7.err, materializeReport7 && materializeReport7.err);
harness.equal('MATERIALIZE: ZERO additional rerank calls (pure replay, never re-judges)', rerankCallCount7, rerankCallsBeforeMaterialize7);
harness.equal('MATERIALIZE: the SAME edge count (1)', materializeReport7.report.edgesWritten, 1);
harness.equal('MATERIALIZE: pins to the SAME decisionBlockHash as the rebridge that produced it', materializeReport7.report.decisionBlock, rebridgeReport7.report.decisionBlock);
harness.equal(
	'MATERIALIZE: BYTE-IDENTICAL replayed edge',
	JSON.stringify(materializeWrites7[0]),
	JSON.stringify(rebridgeWrites7[0]),
);

// =====================================================================
harness.section('SECTION 8 — RESOLVER CHECK: caseEvidenceBridge resolves uniquely via the standard-local search (source: case)');
// =====================================================================

const resolved8 = bridgeMakerModule.resolveBridgePlugin({ bridge: 'caseEvidenceBridge', source: 'case' });
harness.ok(
	"'caseEvidenceBridge' resolves through the real search path (source: 'case' -> standard-local scope)",
	!!resolved8 && !resolved8.error && typeof resolved8.pluginFactory === 'function',
	`got ${JSON.stringify(resolved8)}`,
);
const expectedPath8 = path.join(__dirname, '..', 'bridges', 'caseEvidenceBridge.js');
harness.equal('  and the resolved file IS forges/case/bridges/caseEvidenceBridge.js', resolved8.resolvedPath, expectedPath8);

harness.report();
