'use strict';

// genericBridge — Phase 4 (bridgeEvidenceRefactor-spec.md §7 P4): the REAL generic bridge PORTED onto
// the EVIDENCE path. Every prior generation of this file narrated its own history in this header; this
// one continues that discipline. Phase 2/3 (bridgeKitRefactor_072726): genericBridge was "the skeleton
// filled for the generic inferred SCALAR case" — a thin construction call over
// apps/graph-builder/apps/bridge-maker/lib/bridgeSkeleton.js, reproducing semanticBridge's decisions
// byte-identically (test-generic-bridge-equivalence.js, RETIRED by this phase — see
// test/test-generic-bridge-evidence.js's tombstone comment for why that claim is now FALSE BY DESIGN).
//
// P4 makes genericBridge the EVIDENCE-MODE DEMONSTRATOR: it composes kit.evidenceComposer (with the
// REAL kit.cedsHubModule, R5) -> the ⟪A3⟫ evidence-package shape gate -> kit.evidenceRenderer ->
// kit.evidenceSelect (the kit's llmClient, injected via kit.inferenceConfig at CALL time per
// SELECT_SHAPE) -> kit.confidenceNormalizer -> kit.evidenceFreezer (+ kit.decisionStore save/load) ->
// kit.materializer (lib/inferredIndex.js, UNCHANGED) + kit.writer for edges. TWO modes, unchanged in
// spirit from every bridge in this tree: MATERIALIZE (replay a frozen evidence-decision record, ZERO
// LLM calls, pure) and REBRIDGE (the full evidence flow, one non-deterministic step: evidenceSelect).
//
// ⟪A9⟫ — semanticBridge (bridge-maker/bridges/semanticBridge.js) is the SCALAR COMPARATOR and survives
// BYTE-UNTOUCHED, together with inferencePipeline.js. Nothing in this port touches either (see the
// VALUE-TIER RELIC header on each — they now survive P5's teardown as the sole value-tier
// implementation, not as an active comparator with a live successor path).
//
// ⟪P5 TEARDOWN TOMBSTONE, 2026-07-30⟫ — apps/graph-builder/apps/bridge-maker/lib/bridgeSkeleton.js
// RETIRED (git rm, along with its test, test-bridgeSkeleton.js). At P4 (see the SKELETON-VS-DIRECT
// decision below, preserved for the historical reasoning) bridgeSkeleton.js still had a second live
// consumer — forges/case/bridges/caseStructuralBridge.js — which is WHY this file deliberately did not
// build on it: perturbing the shell risked perturbing that scalar bridge's byte-identical behavior. P5's
// A/B (evidence+structural vs. evidence-generic vs. scalar) came back complete and emphatic in evidence's
// favor (see caseEvidenceBridge.js's own tombstone for the numbers), caseStructuralBridge.js was retired,
// and that removal left bridgeSkeleton.js — the reusable five-move (walk/match/select/freeze/materialize)
// shell purpose-built for the scalar loop — with NO consumer at all: grepped and confirmed, every
// remaining mention of "bridgeSkeleton" in the tree after the retirement was a comment, not a require().
// Its own reusable pieces (defaultMatchMove's kit.candidateFinder dispatch, its construction-time
// requiredKitMembersFor discipline) do not survive it in a new location — see lib.d/candidateFinder.js's
// own tombstone for what became of the ONE downstream piece that mattered.
//
// =====================================================================
// SKELETON-VS-DIRECT — the ONE construction choice this phase's work order leaves to the Programmer
// Milo, justified here in full (the order asked for "one line"; this is the one line plus the reasoning
// a reviewer will want, kept together with the choice itself rather than only in the final report):
// =====================================================================
// genericBridge does NOT build on apps/graph-builder/apps/bridge-maker/lib/bridgeSkeleton.js anymore.
// bridgeSkeleton.js is a REUSABLE SHELL purpose-built for the SCALAR five-move loop (walk/match/select/
// freeze/materialize, each independently overridable, but the SHAPE of the loop — one scored pool, one
// scalar decision per source — is fixed by the shell itself) and it has a SECOND live consumer today:
// forges/case/bridges/caseStructuralBridge.js (Phase 5's one-move-override demonstration), which per
// ⟪A9⟫ must keep running byte-identically through P5, when it is re-expressed onto these SAME evidence
// seams and the scalar path is finally torn out. The evidence flow this file composes is not a sixth
// move bolted onto that shell — it is a STRUCTURALLY DIFFERENT pipeline (a composer producing a UNION
// POOL + prompt segments, a named renderer, a category-out judge, a deterministic normalizer, a
// SECOND freezer with its own record type) with its own mode dispatch, its own kit-member requirements,
// and its own result enrichment (confidence normalization before materializing). Grafting that shape
// onto bridgeSkeleton's five fixed slots would mean either (a) contorting the shell with evidence-
// specific parameters until it no longer resembles "the generic scalar shell" caseStructuralBridge
// still depends on, or (b) adding an evidence-mode branch inside the shell that the scalar bridges
// never exercise but that still shares the shell's construction-time validation, requiredKitMembersFor
// list, and run() dispatch — both risk perturbing the ONE file a live scalar bridge composes today.
// Composing the evidence flow DIRECTLY in this file, following the SAME house style bridgeSkeleton.js
// itself documents (qtools curried moduleFunction; wiring-fault refusals stated by name at both
// construction and run time; taskListPlus/pipeRunner sequencing; the SAME { edgesWritten, decisionBlock,
// producer, counts } result shape; write ONLY through kit.writer), keeps bridgeSkeleton.js — and
// therefore caseStructuralBridge's own byte-identical behavior — completely unperturbed, while giving
// the evidence pipeline a shape that fits what it actually is. semanticBridge.js itself set this exact
// precedent: it is a standalone bridge module, not skeleton-built, and this file now follows that same
// structural pattern for the same reason (a bridge whose pipeline shape does not match the shell's).
//
// =====================================================================
// R-b DISPOSITION — WHERE category/rationale LIVE ON (NOT on) THE EDGE:
// =====================================================================
// Per the P3 boundary review's rider R-b (evidenceContracts.js CONTRACT_STATUS, now HARDENED) and
// carried forward here: category and rationale are NOT promoted to first-class edge properties.
// lib/inferredIndex.js — the SHARED materializer semanticBridge, caseStructuralBridge, and this bridge
// ALL compose via kit.materializer — is BYTE-UNTOUCHED by this port; its fixed decision-row field list
// (confidence, rerankScore, cosineScore, retrievalRank, ...) has no category/rationale slot, and adding
// one would touch the ONE module the scalar comparator also depends on. Instead:
//   - confidence IS promoted onto the edge, using the EXISTING `confidence` slot inferredIndex.js
//     already reads off each inferredDecisions row — but the value written there is now the NORMALIZED
//     confidence (kit.confidenceNormalizer's output), not a raw cosine/rerank score, satisfying the work
//     order's "confidence now the NORMALIZED value" literally, through a slot that already existed.
//   - category/rationale/normalizedConfidence all ride together inside the FROZEN decision block's
//     `frozenEvidence[i].judgment` (one entry per source, keyed by sourceStableId) — retrievable by any
//     reader that loads the pair's frozen block (kit.decisionStore.getDecisionBlock({pairKey}) then
//     kit.evidenceFreezer.parse(frozenText)) and reads `.frozenEvidence` for the source in question.
//     This is NOT a workaround; it is the disposition R-b itself already named as correct for P3, and
//     P4 (this port) never had a reason to promote them further.
//   - generation/rendererVersion (⟪A6⟫) are stamped onto the DECISION BLOCK by kit.evidenceFreezer.freeze
//     (required construction fields), NOT onto individual edges — this bridge's OWN run() result
//     additionally surfaces them (result.generation / result.rendererVersion, additive to the declared
//     BRIDGE_MODULE_SHAPE result keys) so a caller never has to re-parse the frozen block just to learn
//     which generation/renderer produced the edges it is looking at.
//
// THE BRIDGE CONTRACT (interfaces.js @interface BridgeModule / BRIDGE_MODULE_SHAPE), unchanged:
//   bridgeModule({ ...injected library, kit })({ inGraph, hub, applyLabel }, cb)
//       -> cb('', { edgesWritten, counts, decisionBlock })
// COMPOSES injectedTools.kit EXCLUSIVELY (bridgeMaker's ADDITIVE lib.d kit) — every write travels
// through kit.writer (the guarded relationshipWriter), never a raw connection; this file contains no
// neo4j-driver require, no neo4jGraphWriter require, and never reads the raw connection-credential
// fields the GraphHandle carries
// (bridgeMaker's shape gate's negative substrate scan reads THIS file's bytes, exactly as before).
//
// SCOPE — carried forward unchanged from every prior phase: ONE role/tier per pair (config.role,
// default 'DmeProperty'), the LIF pilot's property-tier scope; value-tier scoping (lib/valueScope.js,
// semanticBridge's own CTDL-specific logic) is not reproduced here, same boundary as before.
//
// HUB — unchanged: this bridge bridges toward CEDS only (HUB_STANDARD below).
//
// House style: qtools curried moduleFunction; callback(errString, result) with '' on success; no
// async/await or try/catch for control flow; taskListPlus/pipeRunner; refuse-by-value (polyArch2 §6);
// camelCase, compound names. Deep relative `require`s to the tree-root `lib/` follow the SAME
// established convention this tree's own bridge-maker/lib modules already use (bridgeSkeleton.js,
// evidenceComposer.js, evidenceFreezer.js, inferredIndex.js, referenceIndex.js all reach lib/vocabulary
// or lib/content-address this way, each documenting its own exact depth) — matched here rather than
// introduced as a new, inconsistent mechanism.

const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// content-address — 2 levels up from forges/bridges to the tree root (forges/bridges -> forges -> root;
// bridgeMaker.js's own FORGES_DIR constant confirms this exact depth: TREE_ROOT is 4 levels up from
// apps/graph-builder/apps/bridge-maker, and FORGES_DIR = TREE_ROOT/forges).
const contentAddress = require(path.join(__dirname, '..', '..', 'lib', 'content-address', 'content-address'))();

// flattenFullRecord — the kit's own exported static (lib.d/sourceWalker.js), NOT reachable through an
// instantiated kit.sourceWalker (which exposes only `{ walk }`) — needed here exactly the way the prior
// phase's genericBridge.js reused flattenCandidateRecord directly rather than duplicating the mapping.
// Pure, stateless, never a connection; never trips bridgeMaker's negative substrate scan.
const sourceWalkerModule = require(
	path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib.d', 'sourceWalker'),
);
const flattenFullRecord = sourceWalkerModule.flattenFullRecord;

// boundedRunner — the bounded-concurrency per-source dispatcher (p8-judgeConcurrency; same two-level
// climb as the sourceWalker require above). Pure orchestration: results are collected BY INDEX so the
// per-source outputs assemble in SOURCE ORDER regardless of completion order (see
// EVIDENCE_JUDGE_CONCURRENCY below for why that matters).
const boundedRunner = require(
	path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'boundedRunner'),
);

// ⟪P9, p9-judgmentPersistence 2026-07-31⟫ the judgment-persistence seams (same two-level climb):
//   cachedJudgment — wraps the per-source kit.evidenceSelect call so EVERY judgment (a) checks the
//     shared judgment cache before any API call (a hit is zero spend) and (b) is WRITTEN TO DISK
//     BEFORE it is used downstream (decided = persisted — ⟪TQ RULING, 2026-07-30⟫ "make totally
//     sure that all the results are written to disk as they are decided. Losing data is crazy."),
//     plus one forensic match-log record per judgment. With kit.judgmentCache/kit.matchForensics
//     absent (every hermetic suite that predates P9), it is the byte-identical original call.
//   judgmentDedupe — the OPT-IN structural dedupe fan-out (planJudgmentGroups/fanOutJudgedResults).
//     genericBridge does NOT implement a judgmentKey of its own (see the config.judgmentKey seam
//     below): with no hook the plan is the identity and behavior is byte-unchanged for LIF/CASE.
const cachedJudgment = require(
	path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'cachedJudgment'),
);
const { planJudgmentGroups, fanOutJudgedResults } = require(
	path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'judgmentDedupe'),
);

// ⟪P12, candidateSelectionRedesign-073126.md §4⟫ facetScan — the multi-facet candidate scan and its
// reserved-slot allocation, plus the composite-embed-text and owning-class-map helpers this bridge's
// PREPARATION steps use (same two-level climb as the requires above). Pure computation, no substrate.
const facetScan = require(
	path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'facetScan'),
);
const {
	buildClassMap,
	stampOwningClass,
	embedTextForSource,
	CLASS_ROLE,
} = facetScan;

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// =====================================================================
// IDENTITY — this bridge's own choices (the ~10% every generic-inferred bridge in this tree supplies).
// =====================================================================
const MAPPING_TOOL = 'genericBridge';
const HUB_STANDARD = 'CEDS';
const HUB_REFERENCE_LABEL = 'HubReference';
const DEFAULT_ROLE = 'DmeProperty';
const MATERIALIZER_CONFIG = { predicate: 'closeMatch', mappingJustification: 'semapv:SemanticSimilarity' };

// EVIDENCE_GENERATION — the ⟪A6⟫ generation tag every frozen block self-describes (R4: new evidence +
// prompt => new picks by design => the inferred edges are a NEW generation). A FIXED pipeline-version
// string, not a timestamp — replay stays byte-exact within one generation (R4). Bump this string
// whenever the evidence pipeline's own wiring (composer/renderer/select/normalizer, or which kit modules
// they compose) changes in a way that could change picks over the SAME graph state — exactly the same
// discipline RENDERER_VERSION applies to the renderer alone, one level up at the whole-pipeline scope.
// v4 ⟪P12 MULTI-FACET SCAN, 2026-07-31⟫: three pipeline changes, any one of which changes picks over
// identical graph state — (1) the embedded text is now the COMPOSITE (owning class · name · description
// · class description) rather than the resolution chain's first non-empty field, so every vector moved;
// (2) the pool is chosen by six-facet reserved-slot allocation rather than cosine-top-15 unioned with a
// nominate hook's own top-10; (3) the prompt carries the owning class description and per-candidate
// facet provenance (renderer v4). A differently-retrieved, differently-framed judgment is a new
// generation by definition (⟪A6⟫/R4).
// v5 ⟪hubReimplementation P3, 2026-08-03 (SPEC-hubReimplementation-080326.md §6)⟫: the bridge now
// CONSUMES the self-sufficient card — (1) candidates are NOT re-embedded: the card's forge-stamped
// `embedding` (of its stored, definition-carrying `embedText`) is read off the graph, so every
// candidate vector moved from the bridge-composed id-flavored text to the forge's §4 composition;
// (2) the prompt's tuple block carries the card's MEANING (definitions for property/domain/range/
// value; singular named domain; qualifierNames) via renderer v5 and the revised cedsHubModule.
// Either change alone re-judges the world; together they are this generation.
const EVIDENCE_GENERATION = 'genericBridge-evidence-v5';

// EVIDENCE_JUDGE_CONCURRENCY — how many per-source evidence judgments (compose -> ⟪A3⟫ gate ->
// render -> select -> normalize) may be IN FLIGHT at once during REBRIDGE. The serial loop this
// replaces made big standards infeasible: measured 2026-07-29 on the live SIF run, ~25s per Opus
// judgment × 15,620 sources ≈ 4.5 days of wall clock for one --rebridge. WHY 8: polite to
// Anthropic rate limits — high enough to matter (~8× wall-clock division), low enough that a
// healthy key rarely 429s; and a 429 that does occur is already retried with backoff INSIDE
// llmClient (its own retriableTransport/backoffMs discipline), so a burst never surfaces as a
// bridge error. DETERMINISM IS UNAFFECTED: boundedRunner collects results BY INDEX and
// decisions[]/frozenEvidencePayload[] are assembled in SOURCE ORDER after completion, so the
// frozen decision block stays BYTE-IDENTICAL to what the serial loop produced — proven
// mechanically in test-generic-bridge-evidence.js PART D (a staggered-delay stub vs a
// concurrency-1 run, same frozen bytes, same hash). config.evidenceJudgeConcurrency (a positive
// integer) overrides per run — that is the seam the determinism suite drives its concurrency-1
// comparator through; this constant is the production value.
const EVIDENCE_JUDGE_CONCURRENCY = 8;

// HUB_SEGMENTS — composition-order slot 2 (RENDERER_COMPOSITION_ORDER[1], evidenceRenderer.js), the
// hub-level framing this bridge (CEDS-only, HUB_STANDARD fixed) always supplies. A small, FIXED array —
// genericBridge nominates nothing standard-specific (no custom composer nominate/walk hook, §the
// composer construction below), so this is the one piece of prompt framing it contributes beyond the
// renderer's own base abstain-first instruction.
const HUB_SEGMENTS = [
	'Judge every candidate against its authoritative CEDS tuple evidence below — the domain(s), range, ' +
		'qualifier, and value-scope facts — not by surface wording alone.',
];

// asList — PG-JSON single-element collapse guard (the SAME helper every reader of a possibly-list
// HubReference property in this tree defines locally: cedsHubModule.js, referenceIndex.js).
const asList = (value) =>
	Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];

// targetKeyFor — the materializer-resolvable key for a CHOSEN HubReference candidate (the raw,
// flattenFullRecord-shaped element evidenceSelect's selectResult.pick carries). Mirrors
// referenceIndex.js's OWN key-construction rules exactly (basePropertyRef / qualifiedRef / baseValueRef,
// see apps/graph-builder/apps/bridge-maker/lib/referenceIndex.js), because lib/inferredIndex.js (this
// bridge's materializer) resolves a chosen target ONLY through basePropertyRef/baseValueRef — it does
// NOT consult qualifiedRef at all (inferredIndex.js destructures only the first two). Consequence,
// FLAGGED for the boundary review: a picked QUALIFIED property-tier candidate's composite key
// ('${propertyKey}|${qualifierKey}') therefore resolves in NEITHER map and becomes a counted ORPHAN
// (subgraph.counts.orphans) — SAFE (no edge materializes) rather than DANGEROUS (the bare canonicalKey
// would silently resolve to the UNQUALIFIED base HubReference, a DIFFERENT node, since basePropertyRef
// is populated only for qualifierKeys.length===0 refs). This is an existing lib/inferredIndex.js
// limitation (shared with the authored track's own qualifiedRef, also unread by inferredIndex.js), not
// introduced by this port; genericBridge's ONLY obligation here is to never manufacture a targetKey that
// COLLIDES with the wrong node, which fail-safe-to-orphan achieves. The qualified population is small
// (27 of 2351 property-tier refs, P0 §2.5) and orphaning them is the honest, safe behavior until
// inferredIndex.js is taught qualifiedRef (out of P4 scope — a materializer change, not a bridge change).
const targetKeyFor = (candidate) => {
	if (candidate.referenceTier === 'value') {
		return `${candidate.propertyKey}|${candidate.valueKey || candidate.canonicalKey}`;
	}
	const qualifierKeys = asList(candidate.qualifierKeys);
	if (qualifierKeys.length > 0) {
		return `${candidate.propertyKey}|${qualifierKeys[0]}`;
	}
	return candidate.canonicalKey;
};

// confidenceLookupFromFrozenEvidence — sourceStableId -> normalizedConfidence, built from the
// frozenEvidence PAYLOAD this bridge itself shapes (an array of { sourceStableId, evidencePackage,
// judgment }, see runRebridge below). Used IDENTICALLY by both modes: REBRIDGE builds it fresh from the
// per-source results it just computed; MATERIALIZE rebuilds it from the frozen block's own
// frozenEvidence array (parse() reads it back verbatim, byte-identical — replay never re-judges).
const confidenceLookupFromFrozenEvidence = (frozenEvidenceArray) => {
	const lookup = {};
	(frozenEvidenceArray || []).forEach((oneEntry) => {
		if (oneEntry && oneEntry.sourceStableId && oneEntry.judgment) {
			lookup[oneEntry.sourceStableId] = oneEntry.judgment.normalizedConfidence;
		}
	});
	return lookup;
};

// enrichInferredDecisionsWithConfidence — R-b disposition (see file header): lib/inferredIndex.js reads
// `confidence` off each inferredDecisions row but evidenceFreezer.js's own nonAbstainRow (a DIFFERENT,
// byte-untouched module — see the header) never carries one. This bridge closes that gap itself,
// entirely within its own file: merge the NORMALIZED confidence (looked up by fromStableId) onto each
// row before handing it to the materializer. A row with no matching lookup entry (should not happen —
// every non-abstain decision has a judgment) is left with confidence undefined, and inferredIndex.js's
// own `typeof ... === 'number' ? ... : 0` fallback stamps an honest 0 rather than crashing.
const enrichInferredDecisionsWithConfidence = (inferredDecisions, confidenceLookup) =>
	(inferredDecisions || []).map((oneRow) => ({
		...oneRow,
		confidence: confidenceLookup[oneRow.fromStableId],
	}));

// requiredKitMembersFor — the kit members THIS bridge needs, given rebridge vs. materialize (mirrors
// bridgeSkeleton.js's own requiredKitMembersFor discipline, restated here since this file no longer
// composes that shell — see the SKELETON-VS-DIRECT decision above).
const requiredKitMembersFor = (rebridge) => {
	const list = ['sourceWalker', 'graphReader', 'evidenceFreezer', 'materializer', 'writer'];
	if (rebridge) {
		list.push(
			'vectorizer',
			'semanticMatcher',
			'evidenceComposer',
			'cedsHubModule',
			'evidenceRenderer',
			'evidenceSelect',
			'confidenceNormalizer',
		);
	}
	return list;
};

// START OF the produced BridgeModule callable ============================================

module.exports = (injectedTools = {}) =>
	({ inGraph, hub, applyLabel }, callback) => {
		const { kit } = injectedTools;

		if (!kit || typeof kit !== 'object') {
			callback(
				`${MAPPING_TOOL}: injectedTools.kit is not given — this bridge composes ONLY the injected ` +
					`lib.d kit; there is no default.`,
			);
			return;
		}
		const requiredKitMembers = requiredKitMembersFor(kit.rebridge);
		const missingKitMember = requiredKitMembers.find(
			(oneName) => kit[oneName] === undefined || kit[oneName] === null,
		);
		if (missingKitMember) {
			callback(
				`${MAPPING_TOOL}: kit.${missingKitMember} is missing (kit.rebridge=${!!kit.rebridge}) — the ` +
					`injected lib.d kit did not supply it; there is no default.`,
			);
			return;
		}
		if (!kit.decisionStore || typeof kit.decisionStore.getDecisionBlock !== 'function') {
			callback(
				`${MAPPING_TOOL}: kit.decisionStore (getDecisionBlock/saveDecisionBlock) is REQUIRED — a ` +
					`frozen evidence-decision block is read from it on a plain build and written to it on ` +
					`--rebridge; there is no default.`,
			);
			return;
		}
		if (kit.rebridge && (!kit.inferenceConfig || typeof kit.inferenceConfig.llmClient !== 'object' || !kit.inferenceConfig.llmClient || typeof kit.inferenceConfig.llmClient.rerank !== 'function')) {
			callback(
				`${MAPPING_TOOL}: kit.inferenceConfig.llmClient (rerank) is missing — --rebridge needs a kit ` +
					`built with inferenceConfig.llmClient; kit.evidenceSelect takes it at CALL time (SELECT_SHAPE), ` +
					`not construction, so it must arrive via kit.inferenceConfig; there is no default.`,
			);
			return;
		}
		if (!inGraph) {
			callback(`${MAPPING_TOOL}: inGraph is not given — there is no graph to read the source/${HUB_STANDARD} nodes from.`);
			return;
		}
		if (hub !== null && hub !== undefined && `${hub}`.toUpperCase() !== HUB_STANDARD) {
			callback(`${MAPPING_TOOL}: hub is '${hub}', but this bridge bridges toward the ${HUB_STANDARD} hub only.`);
			return;
		}
		if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
			callback(
				`${MAPPING_TOOL}: applyLabel is ${
					applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)
				} — it is the label harvest selects the written edges by; there is no default.`,
			);
			return;
		}

		const config = kit.config || {};
		const sourceStandard = config.sourceStandard || config.source;
		if (typeof sourceStandard !== 'string' || sourceStandard.trim() === '') {
			callback(
				`${MAPPING_TOOL}: config.sourceStandard is not set — the generic producer must be told which ` +
					`source standard it bridges (a generic plugin serves every pair); there is no default.`,
			);
			return;
		}
		// evidenceJudgeConcurrency — EVIDENCE_JUDGE_CONCURRENCY unless config.evidenceJudgeConcurrency
		// overrides it (the determinism suite's concurrency-1 comparator seam; also an operator knob
		// for a rate-limited key). A malformed override is refused by name, never coerced.
		const evidenceJudgeConcurrency =
			config.evidenceJudgeConcurrency === undefined
				? EVIDENCE_JUDGE_CONCURRENCY
				: config.evidenceJudgeConcurrency;
		if (!Number.isInteger(evidenceJudgeConcurrency) || evidenceJudgeConcurrency < 1) {
			callback(
				`${MAPPING_TOOL}: config.evidenceJudgeConcurrency is ${JSON.stringify(
					config.evidenceJudgeConcurrency,
				)} — when given it must be a positive integer (the default is ${EVIDENCE_JUDGE_CONCURRENCY}).`,
			);
			return;
		}
		// ⟪P9⟫ config.judgmentKey — THE OPT-IN STRUCTURAL-DEDUPE SEAM. A hook
		// (sourceElement, callback(err, keyOrNull)) mapping a source to a shared-structure identity
		// (null = judge individually); sources sharing a key are judged ONCE and the verdict fans out
		// honestly (judgmentDedupe.js). genericBridge itself supplies NO key — undefined/null/false
		// all mean "no dedupe, byte-unchanged behavior"; anything else that is not a function is
		// refused by name. (A recipe file cannot carry a function today — the seam is consumed by a
		// composing orchestrator or a standard-local bridge; sifEvidenceBridge.js implements its own.)
		const judgmentKeyHook =
			config.judgmentKey === undefined || config.judgmentKey === null || config.judgmentKey === false
				? null
				: config.judgmentKey;
		if (judgmentKeyHook !== null && typeof judgmentKeyHook !== 'function') {
			callback(
				`${MAPPING_TOOL}: config.judgmentKey is ${JSON.stringify(config.judgmentKey)} — when given ` +
					`it must be a function (sourceElement, callback(err, keyOrNull)) or false; there is no default.`,
			);
			return;
		}
		// THE EXACT-NAME RULE (supersedes THE CASE RULE, 2026-07-31 — the bronze build's second
		// case-mismatch casualty in one night): the forged `_source` carries the bundle's DECLARED
		// standardName VERBATIM, and it is NOT always the uppercased token — OpenBadges/EduAPI/JEDx/
		// MedBiquitous all stamp mixed case, so toUpperCase matched ZERO nodes and this bridge silently
		// judged 0/0 per pair and froze EMPTY blocks as success. build.js resolves the declared name
		// from parserDescriptor.ini (forger.resolveBundle) and passes config.sourceStandardName; this
		// bridge requires it and matches EXACTLY — refuse-by-name, no default, no normalization.
		const sourceStandardKey = config.sourceStandardName;
		if (typeof sourceStandardKey !== 'string' || sourceStandardKey.trim() === '') {
			callback(
				`${MAPPING_TOOL}: config.sourceStandardName is not set — the EXACT declared standardName ` +
					`(parserDescriptor.ini) is required for _source matching; the recipe token's case is not ` +
					`trustworthy (OpenBadges != OPENBADGES). There is no default.`,
			);
			return;
		}
		const subjectVersion = config.sourceVersion || '';
		const objectVersion = config.hubVersion || '';
		const role = config.role || DEFAULT_ROLE;
		const pairKey = `${HUB_STANDARD}::${sourceStandardKey}`;

		// readReferenceNodes — the RAW HubReference nodes, flattened to FULL records (spec §5). Serves
		// TWO purposes, exactly as bridgeSkeleton's own version did: the materializer's resolution index
		// (referenceIndex.js, unchanged) AND, in REBRIDGE mode, the evidence composer's candidate pool.
		const readReferenceNodes = (done) => {
			kit.graphReader.readNodes({ label: HUB_REFERENCE_LABEL, propertyEquals: {} }, (err, out) =>
				done(
					err ? `${MAPPING_TOOL}: reading ${HUB_STANDARD} ${HUB_REFERENCE_LABEL} nodes: ${err}` : '',
					(out || {}).nodes || [],
				),
			);
		};

		// buildAndWrite — the SHARED tail of both modes: materialize the (confidence-enriched) frozen
		// picks into edges via kit.materializer (lib/inferredIndex.js, BYTE-UNTOUCHED) and WRITE each
		// through kit.writer. Given the same frozen decisions + reference nodes it is byte-identical, so
		// replay == rebridge regardless of mode — the SAME invariant every bridge in this tree holds.
		const buildAndWrite = ({ inferredDecisions, sourceNodes, referenceNodes, decisionBlockHash }, done) => {
			const builder = kit.materializer({
				...MATERIALIZER_CONFIG,
				subjectSource: sourceStandardKey,
				subjectVersion,
				objectSource: HUB_STANDARD,
				objectVersion,
				mappingTool: MAPPING_TOOL,
				decisionBlockHash,
			});
			const subgraph = builder.buildInferredSubgraph({ inferredDecisions, sourceNodes, referenceNodes });
			let edgesWritten = 0;
			const writeList = new taskListPlus();
			subgraph.edges.forEach((oneEdge) => {
				writeList.push((a2, n2) => {
					kit.writer(
						{
							decision: {
								fromStableId: oneEdge.fromRef.id,
								toStableId: oneEdge.toRef.id,
								relationshipType: oneEdge.type,
								properties: oneEdge.properties,
							},
							applyLabel,
						},
						(err, writeResult) => {
							if (err) {
								n2(`${MAPPING_TOOL}: writing ${oneEdge.type} ${oneEdge.fromRef.id} -> ${oneEdge.toRef.id}: ${err}`);
								return;
							}
							if (writeResult && writeResult.edgeWritten) {
								edgesWritten++;
							}
							n2('', a2);
						},
					);
				});
			});
			pipeRunner(writeList.getList(), {}, (err) => {
				done(err || '', { edgesWritten, subgraph });
			});
		};

		// ================= MATERIALIZE (plain -build) — pure replay of a frozen EVIDENCE block, ZERO LLM
		// ================= calls: no composer, no hubModule, no renderer, no evidenceSelect is ever
		// ================= invoked — the normalized confidence + category/rationale are READ BACK from
		// ================= the frozen text, never recomputed.
		const runMaterialize = () => {
			kit.decisionStore.getDecisionBlock({ pairKey }, (loadErr, loaded) => {
				if (loadErr) {
					finish(`${MAPPING_TOOL}: loading frozen evidence-decision block for ${pairKey}: ${loadErr}`);
					return;
				}
				const frozenText = loaded && loaded.frozenText;
				if (!frozenText) {
					// NO frozen block for this pair -> NO inferred edges. Explicit, no spend, no graph read.
					finish('', {
						edgesWritten: 0,
						decisionBlock: null,
						producer: 'inferred',
						generation: null,
						rendererVersion: null,
						counts: { inferred: 0, mode: 'materialize', noDecisionBlock: true },
					});
					return;
				}
				const parsed = kit.evidenceFreezer.parse(frozenText);
				if (parsed.error) {
					finish(parsed.error);
					return;
				}
				const decisionBlockHash = contentAddress.blockIdForText(frozenText);
				const confidenceLookup = confidenceLookupFromFrozenEvidence(parsed.frozenEvidence);
				const enrichedInferredDecisions = enrichInferredDecisionsWithConfidence(parsed.inferredDecisions, confidenceLookup);

				const taskList = new taskListPlus();
				taskList.push((args, next) =>
					kit.sourceWalker.walk({ standard: sourceStandardKey, role, flatten: flattenFullRecord }, (err, out) =>
						next(err, { ...args, sourceNodes: out && out.sourceNodes }),
					),
				);
				taskList.push((args, next) => readReferenceNodes((err, nodes) => next(err, { ...args, referenceNodes: nodes })));
				taskList.push((args, next) => {
					buildAndWrite(
						{ inferredDecisions: enrichedInferredDecisions, sourceNodes: args.sourceNodes, referenceNodes: args.referenceNodes, decisionBlockHash },
						(err, out) => next(err, { ...args, ...out }),
					);
				});
				pipeRunner(taskList.getList(), {}, (err, args) => {
					if (err) {
						finish(err);
						return;
					}
					finish('', {
						edgesWritten: args.edgesWritten,
						decisionBlock: decisionBlockHash,
						producer: 'inferred',
						generation: parsed.generation,
						rendererVersion: parsed.rendererVersion,
						counts: {
							inferred: args.edgesWritten,
							mode: 'materialize',
							decisionsConsidered: parsed.inferredDecisions.length,
							orphans: args.subgraph.counts.orphans,
							fromGaps: args.subgraph.counts.fromGaps,
						},
					});
				});
			});
		};

		// ================= REBRIDGE — walk -> vectorize -> per-source(compose -> gate -> render -> select
		// ================= -> normalize) -> freeze -> save -> materialize -> write. The ONE
		// ================= non-deterministic step is evidenceSelect (the injected llmClient); everything
		// ================= else is pure/deterministic.
		const runRebridge = () => {
			const llmClient = kit.inferenceConfig.llmClient;

			const taskList = new taskListPlus();

			// WALK — the source standard's FULL elements (spec §5 retrieval-enrichment reversal).
			// ZERO SOURCES IS A REFUSAL (2026-07-31): the bronze build's four mixed-case pairs each
			// judged 0/0 and froze an EMPTY block as green — a recipe named this pair, so an empty
			// harvest means the name is wrong or the dependency graph is; refuse BY NAME, never
			// materialize silence.
			taskList.push((args, next) =>
				kit.sourceWalker.walk({ standard: sourceStandardKey, role, flatten: flattenFullRecord }, (err, out) => {
					if (err) {
						next(err, args);
						return;
					}
					const sourceNodes = (out && out.sourceNodes) || [];
					if (sourceNodes.length === 0) {
						next(
							`${MAPPING_TOOL}: found ZERO ${role} nodes with _source '${sourceStandardKey}' in the ` +
								`dependency graph — the named source standard is absent (wrong sourceStandardName, or ` +
								`the recipe's dependencies do not include it). An empty source set is refused, never ` +
								`frozen as an empty block.`,
							args,
						);
						return;
					}
					next('', { ...args, sourceNodes });
				}),
			);
			// the FULL CEDS HubReference candidate elements (R5's base evidence source, all tiers).
			taskList.push((args, next) =>
				readReferenceNodes((err, nodes) =>
					next(err, { ...args, referenceNodes: nodes, candidateElements: nodes.map(flattenFullRecord) }),
				),
			);

			// ⟪P12 §4.5⟫ THE OWNING-CLASS MAP — ONE role-scoped read of every DmeClass this standard
			// forged, turned into { stableId -> {name, description} }. This is the read the spec calls for
			// ("a prefetched class map — one read for all classes, then a lookup"), and it sits HERE,
			// OUTSIDE the scan, precisely because §4.2's hard constraint forbids a graph read inside it.
			// An EMPTY result is a legitimate state (a flat standard forges no classes) and proceeds with
			// honest absence; a FAILED read is refused by name — silently embedding without class context
			// is the exact defect this phase exists to remove.
			taskList.push((args, next) => {
				kit.graphReader.readNodes(
					{ label: 'ForgedNode', propertyEquals: { _source: sourceStandardKey, role: CLASS_ROLE } },
					(err, out) => {
						if (err) {
							next(`${MAPPING_TOOL}: reading ${sourceStandardKey} ${CLASS_ROLE} nodes for the owning-class map: ${err}`, args);
							return;
						}
						const classNodes = ((out || {}).nodes || []).map(flattenFullRecord);
						next('', { ...args, classMap: buildClassMap(classNodes), classCount: classNodes.length });
					},
				);
			});

			// ⟪hubReimplementation P3 (SPEC §6)⟫ THE CANDIDATE VECTORS COME OFF THE CARD. Every
			// reimplemented HubReference carries `embedText` (its forge-composed §4 retrieval string,
			// stored exactly as embedded) and `embedding` (its 1024-dim vector, stamped through the shared
			// vector cache at forge time and restored onto the graph node by the Phase-2 sidecar wire) —
			// so the bridge READS them, refusing BY NAME any candidate that lacks either. It never
			// re-embeds a candidate: a missing vector means the graph was materialized without its vector
			// store (the exact silent-vectorless failure the Phase-2 M-1/M-2 review closed), and quietly
			// re-embedding here would both hide that defect and spend against the provider for a fact the
			// card already carries. The old hub DmeClass domain-map read is retired with the bridge-side
			// candidate composition (the card carries domainName itself).
			taskList.push((args, next) => {
				const vectorlessCandidate = args.candidateElements.find(
					(oneCandidate) => !Array.isArray(oneCandidate.embedding) || oneCandidate.embedding.length === 0,
				);
				if (vectorlessCandidate !== undefined) {
					next(
						`${MAPPING_TOOL}: candidate '${vectorlessCandidate.canonicalKey || vectorlessCandidate.stableId}' ` +
							`carries no embedding — every reimplemented HubReference is forged with its vector ` +
							`(SPEC §1.5, G-7); a vectorless candidate means this graph was materialized without its ` +
							`vector store. Refusing rather than re-embedding.`,
						args,
					);
					return;
				}
				const embedTextlessCandidate = args.candidateElements.find(
					(oneCandidate) => typeof oneCandidate.embedText !== 'string' || oneCandidate.embedText === '',
				);
				if (embedTextlessCandidate !== undefined) {
					next(
						`${MAPPING_TOOL}: candidate '${embedTextlessCandidate.canonicalKey || embedTextlessCandidate.stableId}' ` +
							`carries no embedText — every reimplemented HubReference stores its composed retrieval ` +
							`string (SPEC §1.5, G-6). Refusing rather than recomposing.`,
						args,
					);
					return;
				}
				args.candidateElements.forEach((oneCandidate) => {
					oneCandidate.vector = oneCandidate.embedding;
				});
				next('', args);
			});

			// ⟪P12 §4.1⟫ COMPOSE THE SOURCE EMBEDDED TEXT — the source side is per-standard and per-run,
			// so it is still composed and embedded HERE (candidates, above, arrive pre-embedded on the
			// card). `defText` itself is left untouched (it has four other live readers — see
			// lib/facetScan.js's header for the decision and its evidence); the composite lands on
			// `embedText`, named for its one job. Sources additionally get owningClassName/
			// owningClassDescription stamped on, which is what the renderer's source block reads (§4.5).
			taskList.push((args, next) => {
				args.sourceNodes.forEach((oneSource) => {
					stampOwningClass(oneSource, args.classMap);
					oneSource.embedText = embedTextForSource(oneSource, args.classMap);
				});
				next('', args);
			});

			// VECTORIZE (NET) — embed the SOURCE composite embedTexts only (⟪hubReimplementation P3⟫:
			// zero candidate embed calls, gate G-15's whole assertion). Fixed orchestration, not a move.
			taskList.push((args, next) => {
				kit.vectorizer.batchEmbed({ texts: args.sourceNodes.map((oneSource) => oneSource.embedText) }, (err, result) => {
					if (err) {
						next(`${MAPPING_TOOL}: vectorizing source composite embedTexts: ${err}`);
						return;
					}
					args.sourceNodes.forEach((oneSource, i) => {
						oneSource.vector = result.vectors[i];
					});
					next('', args);
				});
			});

			// PER-SOURCE: compose -> ⟪A3⟫ gate -> render -> select -> normalize — dispatched through
			// boundedRunner with EVIDENCE_JUDGE_CONCURRENCY judgments in flight at once (see that
			// constant's header for the wall-clock arithmetic and the rate-limit reasoning).
			// DETERMINISM IS SACRED: results come back BY INDEX and decisions[]/frozenEvidencePayload[]
			// are assembled in SOURCE ORDER after ALL sources settle, so the frozen decision block is
			// BYTE-IDENTICAL to what the serial loop produced regardless of completion order.
			// PROGRESS: the judging phase used to run silent for hours (long enough that an orchestrator
			// once killed a healthy build as hung, 2026-07-29) — it now announces itself and reports
			// every 50 completions through xLog, the same channel the surrounding build machinery logs on.
			taskList.push((args, next) => {
				const { xLog } = process.global;
				const sourceCount = args.sourceNodes.length;
				// ⟪P12 §4.1/§4.2⟫ THE SCANNER — constructed HERE rather than at the top of runRebridge
				// because its once-per-run precomputation (candidate token sets, vector norms, anchor keys,
				// type/tier codes, and the reused per-source scratch buffers) needs the candidate VECTORS,
				// which exist only after the vectorize step above. Constructed ONCE for the whole run: the
				// per-candidate precomputation is paid once, not once per source.
				const facetScanner = facetScan({ candidateElements: args.candidateElements, classMap: args.classMap });
				xLog.status(
					`[${MAPPING_TOOL}] multi-facet scan armed over ${facetScanner.candidateCount} candidate(s); ` +
						`${Object.keys(args.classMap).length} owning class(es) mapped for ${sourceStandardKey}; ` +
						`candidate vectors read off the cards (zero candidate embeds)`,
				);
				const composer = kit.evidenceComposer({ semanticMatcher: kit.semanticMatcher, facetScanner });
				// ⟪P9⟫ judgeOne — the persistence-seamed judge (cachedJudgment.js): checks the shared
				// judgment cache BEFORE any API call, persists a live judgment BEFORE it is used
				// downstream (decided = persisted), and writes one forensic record per judgment. With
				// kit.judgmentCache/kit.matchForensics absent it is the byte-identical original
				// kit.evidenceSelect call.
				const judgeOne = cachedJudgment({
					judgmentCache: kit.judgmentCache || null,
					matchForensics: kit.matchForensics || null,
					pairKey,
					generation: EVIDENCE_GENERATION,
					rendererVersion: kit.evidenceRenderer.RENDERER_VERSION,
					evidenceSelect: kit.evidenceSelect,
					llmClient,
				});
				// ⟪P9⟫ the dedupe plan — with no judgmentKeyHook (this bridge's default) the plan is
				// the identity: every source judged individually, byte-unchanged behavior.
				planJudgmentGroups({ sourceNodes: args.sourceNodes, judgmentKeyHook }, (planErr, plan) => {
					if (planErr) {
						next(`${MAPPING_TOOL}: ${planErr}`, args);
						return;
					}
					const judgeCount = plan.judgeIndexes.length;
					const dedupeNote = plan.dedupedCount
						? `; ${plan.dedupedCount} source(s) share ${plan.sharedGroupCount} structural judgment group(s) and fan out`
						: '';
					xLog.status(
						`[${MAPPING_TOOL}] judging ${judgeCount} of ${sourceCount} source elements (concurrency ${evidenceJudgeConcurrency}${dedupeNote})`,
					);
					let judgedCount = 0;
					let cacheHitCount = 0;
					boundedRunner(
						{
							items: plan.judgeIndexes.map((oneSourceIndex) => args.sourceNodes[oneSourceIndex]),
							concurrencyLimit: evidenceJudgeConcurrency,
							oneItem: (oneSource, judgeSlotIndex, itemDone) => {
								void judgeSlotIndex; // identity rides on oneSource.stableId; ORDER rides on boundedRunner's own index
								composer(
									{ sourceElement: oneSource, candidateElements: args.candidateElements, graphReader: kit.graphReader, hubModule: kit.cedsHubModule },
									(composeErr, evidencePackage) => {
										if (composeErr) {
											itemDone(`${MAPPING_TOOL}: composing evidence for ${oneSource.stableId}: ${composeErr}`);
											return;
										}
										kit.evidenceRenderer.render(evidencePackage, HUB_SEGMENTS, {}, (renderErr, promptText) => {
											if (renderErr) {
												itemDone(`${MAPPING_TOOL}: rendering evidence for ${oneSource.stableId}: ${renderErr}`);
												return;
											}
											judgeOne(
												{ promptText, pool: evidencePackage.pool, sourceStableId: oneSource.stableId, sourceName: oneSource.name },
												(judgeErr, judged) => {
													if (judgeErr) {
														itemDone(`${MAPPING_TOOL}: selecting for ${oneSource.stableId}: ${judgeErr}`);
														return;
													}
													const selectResult = judged.selectResult;
													if (judged.judgeMeta.servedFromCache) {
														cacheHitCount += 1;
													}
													// ⟪P12⟫ the ABSTAIN case's retrieval cosine is the pool's BEST cosine, computed
													// rather than read off pool[0]: under reserved-slot allocation the pool is
													// ordered by SLOT (an unconditional anchorMatch seat leads), so pool[0] is no
													// longer necessarily the highest-cosine entry. Same value as before whenever
													// cosine does lead; honest whenever it does not.
													const bestCosine = evidencePackage.pool.reduce(
														(best, oneEntry) => (oneEntry.cosine > best ? oneEntry.cosine : best),
														-1,
													);
													const chosenEntry = selectResult.abstain
														? null
														: evidencePackage.pool.find((oneEntry) => oneEntry.candidate === selectResult.pick);
													const retrievalCosine = chosenEntry ? chosenEntry.cosine : bestCosine;
													kit.confidenceNormalizer(selectResult.category, retrievalCosine, {}, (normalizeErr, normalizedConfidence) => {
														if (normalizeErr) {
															itemDone(`${MAPPING_TOOL}: normalizing confidence for ${oneSource.stableId}: ${normalizeErr}`);
															return;
														}
														const ordinal = chosenEntry ? evidencePackage.pool.indexOf(chosenEntry) + 1 : null;
														judgedCount += 1;
														if (judgedCount % 50 === 0 && judgedCount < judgeCount) {
															xLog.status(`[${MAPPING_TOOL}] judged ${judgedCount}/${judgeCount} (${cacheHitCount} served from the judgment cache)`);
														}
														itemDone('', {
															decision: {
																source: { stableId: oneSource.stableId, role: oneSource.role },
																abstain: selectResult.abstain,
																abstainReason: selectResult.abstain ? 'evidenceAbstain' : null,
																targetKey: selectResult.abstain ? null : targetKeyFor(selectResult.pick),
																chosenStableId: selectResult.abstain ? null : selectResult.pick.stableId,
																retrievalRank: ordinal,
																cosineScore: retrievalCosine,
															},
															frozenEntry: {
																sourceStableId: oneSource.stableId,
																// ⟪FREEZE-BY-REFERENCE, 2026-07-31⟫ the full evidencePackage is NOT duplicated
																// into the frozen block any more — the bronze build's PESC pair proved 1,792
																// embedded packages exceed V8's max string at serialize (RangeError). The
																// judgment cache + matchForensics log (both keyed by this promptHash) are the
																// single source of the full rendered evidence; the block carries the ADDRESS.
																// Generation bumped (v2) — a v1 block replays unchanged via its own stored text.
																evidencePackageRef: { promptHash: judged.judgeMeta.promptHash, rendererVersion: kit.evidenceRenderer.RENDERER_VERSION },
																judgment: { category: selectResult.category, rationale: selectResult.rationale, normalizedConfidence },
															},
															judgeMeta: judged.judgeMeta,
														});
													});
												},
											);
										});
									},
								);
							},
						},
						(runErr, out) => {
							if (runErr) {
								next(runErr, args);
								return;
							}
							xLog.status(
								`[${MAPPING_TOOL}] judged ${judgeCount}/${judgeCount} (${cacheHitCount} served from the judgment cache, ${judgeCount - cacheHitCount} live)`,
							);
							// SOURCE-ORDER ASSEMBLY — out.results[j] belongs to plan.judgeIndexes[j] (boundedRunner's
							// by-index contract); fanOutJudgedResults re-addresses every fanned-out member honestly
							// and returns the FULL per-source array in SOURCE ORDER (⟪P9⟫).
							fanOutJudgedResults(
								{
									sourceNodes: args.sourceNodes,
									judgeIndexes: plan.judgeIndexes,
									memberPlanBySourceIndex: plan.memberPlanBySourceIndex,
									judgedResults: out.results,
									matchForensics: kit.matchForensics || null,
									pairKey,
									generation: EVIDENCE_GENERATION,
									rendererVersion: kit.evidenceRenderer.RENDERER_VERSION,
								},
								(fanErr, fanned) => {
									if (fanErr) {
										next(`${MAPPING_TOOL}: ${fanErr}`, args);
										return;
									}
									next('', {
										...args,
										decisions: fanned.perSourceResults.map((onePerSourceResult) => onePerSourceResult.decision),
										frozenEvidencePayload: fanned.perSourceResults.map((onePerSourceResult) => onePerSourceResult.frozenEntry),
									});
								},
							);
						},
					);
				});
			});

			// FREEZE all decisions + the frozen evidence payload -> content-addressed block, self-
			// describing generation/rendererVersion (⟪A6⟫), then SAVE to the decisionStore.
			taskList.push((args, next) => {
				const frozen = kit.evidenceFreezer.freeze({
					pairStamp: { subjectSource: sourceStandardKey, subjectVersion, objectSource: HUB_STANDARD, objectVersion },
					decisions: args.decisions,
					generation: EVIDENCE_GENERATION,
					rendererVersion: kit.evidenceRenderer.RENDERER_VERSION,
					evidencePackages: args.frozenEvidencePayload,
				});
				kit.decisionStore.saveDecisionBlock(
					{ pairKey, frozenText: frozen.frozenText, decisionBlockHash: frozen.decisionBlockHash },
					(err) => next(err ? `${MAPPING_TOOL}: saving frozen evidence-decision block: ${err}` : '', { ...args, frozen }),
				);
			});

			// MATERIALIZE the frozen picks (confidence-enriched) + WRITE.
			taskList.push((args, next) => {
				const confidenceLookup = confidenceLookupFromFrozenEvidence(args.frozenEvidencePayload);
				const enrichedInferredDecisions = enrichInferredDecisionsWithConfidence(args.frozen.inferredDecisions, confidenceLookup);
				buildAndWrite(
					{
						inferredDecisions: enrichedInferredDecisions,
						sourceNodes: args.sourceNodes,
						referenceNodes: args.referenceNodes,
						decisionBlockHash: args.frozen.decisionBlockHash,
					},
					(err, out) => next(err, { ...args, ...out }),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					finish(err);
					return;
				}
				const abstains = args.decisions.filter((d) => d.abstain).length;
				finish('', {
					edgesWritten: args.edgesWritten,
					decisionBlock: args.frozen.decisionBlockHash,
					producer: 'inferred',
					generation: EVIDENCE_GENERATION,
					rendererVersion: kit.evidenceRenderer.RENDERER_VERSION,
					counts: {
						inferred: args.edgesWritten,
						mode: 'rebridge',
						decisionsConsidered: args.decisions.length,
						picks: args.decisions.length - abstains,
						abstains,
						orphans: args.subgraph.counts.orphans,
						fromGaps: args.subgraph.counts.fromGaps,
					},
				});
			});
		};

		// finish — close the kit's graphReader (this bridge is the one that decided when it was done
		// reading, so it owns closing it). kit.writer rides on the graphWriter bridgeMaker itself closes.
		const finish = (runError, result) => {
			kit.graphReader.close((closeErr) => {
				if (runError) {
					callback(closeErr ? `${runError} (and the graph reader also failed to close: ${closeErr})` : runError);
					return;
				}
				if (closeErr) {
					callback(`${MAPPING_TOOL}: produced ${result.edgesWritten} edge(s) but the graph reader failed to close: ${closeErr}`);
					return;
				}
				callback('', result);
			});
		};

		if (kit.rebridge) {
			runRebridge();
		} else {
			runMaterialize();
		}
	};

// END OF the produced BridgeModule callable ==============================================

module.exports.MAPPING_TOOL = MAPPING_TOOL;
module.exports.HUB_STANDARD = HUB_STANDARD;
module.exports.EVIDENCE_GENERATION = EVIDENCE_GENERATION;
module.exports.targetKeyFor = targetKeyFor;
module.exports.confidenceLookupFromFrozenEvidence = confidenceLookupFromFrozenEvidence;
module.exports.enrichInferredDecisionsWithConfidence = enrichInferredDecisionsWithConfidence;
