'use strict';

// caseEvidenceBridge.js — Phase 5 (bridgeEvidenceRefactor-spec.md §7 P5, R6/⟪A2⟫, ⟪A1⟫): the HERMETIC
// HALF of the arc's FINAL phase — re-expressing forges/case/bridges/caseStructuralBridge.js's
// structural SIGNAL as EVIDENCE instead of a scalar blend. That file (Phase 5 of the PRIOR
// bridgeKitRefactor arc) proved bridgeSkeleton's move-override seam by computing
// `blendedScore = baseCosine + STRUCT_WEIGHT * structuralAffinity(...)` and letting the blend silently
// re-rank the pool — the structural signal never reached the judge, only its OWN gravity on ranking.
// This file throws the blend away and gives the SAME signal to Opus as prose: (a) a NOMINATE hook that
// puts token-sharing candidates the base cosine top-K might have missed INTO the union pool (⟪A1⟫,
// recall), (b) a per-candidate CONSIDERATION note on every pool candidate stating the source's
// structural location and its token overlap with that candidate (evidence, not a score), and (c) ONE
// deduped GLOBAL prompt segment telling the judge how to read CASE's often-thin property prose (R6/⟪A2⟫).
// caseStructuralBridge.js was untouched by this file's existence while both lived — read, never edited
// — pending the orchestrator's post-A/B teardown (⟪A9⟫). That teardown is now DONE; see the tombstone
// below.
//
// ⟪P5 TEARDOWN TOMBSTONE, 2026-07-30⟫ — forges/case/bridges/caseStructuralBridge.js RETIRED (git rm,
// along with forges/case/test/test-caseStructuralBridge.js). It was Phase 5 of the PRIOR
// bridgeKitRefactor arc: a bridgeSkeleton.js `match`-move override computing
// `blendedScore = baseCosine + STRUCT_WEIGHT * structuralAffinity(...)` and letting that scalar blend
// silently re-rank the pool — the structural signal reached only ranking, never the judge. The A/B this
// file exists to run (evidence+structural vs. evidence-generic vs. the old scalar blend) was COMPLETE
// and emphatic: 104 evidence+structural picks vs. 32 evidence-generic vs. 107 scalar(old-generation);
// 155/194 winners carried a structural nomination; 13 domain-corrective flips only the structural signal
// caught. The scalar path's day was done. Its tokenize/CASE_PATH_SEGMENTS_RE/STOPWORDS/overlapCoefficient
// machinery did NOT die with it — it lives on below, PORTED VERBATIM (see the next paragraph) into this
// file's caseNominate/caseWalk hooks, now producing prose evidence for the judge instead of a hidden
// ranking nudge. Full grounding for WHY those helpers exist (CASE's casePath stableId shape
// 'case:ClassName.propertyName', CASE's frequently thin/empty defText, the owning class name being the
// one place structural context survives to the match move) lived in the retired file's header; it is
// preserved here since that file no longer exists to read: the source XML rarely states a property's
// domain class in its own defText, so the ONLY place that context survives to a matcher is the casePath
// STRUCTURE itself — tokenizing it and blending/nominating on overlap recovers signal cosine-on-defText
// alone misses.
//
// PROVENANCE OF THE PORTED HELPERS — tokenize/CASE_PATH_SEGMENTS_RE/STOPWORDS/overlapCoefficient below
// are PORTED VERBATIM from caseStructuralBridge.js (the design order's own instruction: "reuse the OLD
// bridge's own tokenize/overlap machinery — port those pure helpers"), not re-derived. The CODE FACTS
// that motivated them (CASE's casePath stableId shape 'case:ClassName.propertyName', CASE's frequently
// thin/empty defText, the owning class name being the one place structural context survives to the
// match move) are documented in FULL in that file's header and are not re-argued here; see
// caseStructuralBridge.js lines 13-46 for the grounding.
//
// STRUCTURALLY, this file is genericBridge.js's OWN composition (forges/bridges/genericBridge.js — read
// in full before writing this file) with exactly THREE CASE-specific additions layered onto the SAME
// evidence pipeline (compose -> ⟪A3⟫ gate -> render -> select -> normalize -> freeze -> materialize ->
// write), nothing else changed:
//   (a) NOMINATE — caseNominate, handed to kit.evidenceComposer's `nominate` hook: any CEDS candidate
//       whose name+defText tokens overlap the source's casePath class/property tokens is nominated into
//       the union pool (⟪A1⟫), carrying a rationale — this is what recovers a candidate cosine top-K
//       dropped.
//   (b) PER-CANDIDATE CONSIDERATIONS — caseWalk, handed to the SAME composer's `walk` hook: for EVERY
//       pool candidate (cosine-retrieved or nominated), one considerations.note stating the source's
//       structural location (owning class + property, parsed off its casePath) and which tokens, if
//       any, it shares with that specific candidate. This hook performs NO graph read at all — it is a
//       pure text computation over the elements the composer already handed it — so `dependencies`/
//       `graphReader` ride through inertly (⟪A5⟫ compliant by construction, not by restraint).
//   (c) ONE GLOBAL SEGMENT — CASE_GLOBAL_SEGMENT, returned by caseWalk's `promptSegments` — CASE-wide
//       judging guidance (terse/empty CASE prose is not evidence of a weak match; the owning class is
//       often the load-bearing signal). Written about the STANDARD, never about a candidate — see the
//       CAUTION below.
//
// CAUTION (learned in this arc, load-bearing): evidencePackageViolation's smuggling check
// (evidenceContracts.js ⟪A3⟫) refuses ANY global promptSegments entry that contains a candidate-
// identifying token (stableId/canonicalKey/cedsId/valueKey/name, >=4 chars) drawn from THIS run's own
// pool. CASE_GLOBAL_SEGMENT is therefore written ENTIRELY about CASE-the-standard's own prose habits —
// it never names a candidate, a class, or a property — precisely so it can never accidentally collide
// with a live candidate token at runtime. test-caseEvidenceBridge.js proves this is not merely true by
// inspection: a fault twin builds a DELIBERATELY candidate-naming segment and shows the REAL gate
// refusing it, then shows CASE_GLOBAL_SEGMENT passing the SAME gate.
//
// Everything else — the hub module, the renderer, select, the normalizer, freeze, BOTH modes
// (REBRIDGE/MATERIALIZE), the guarded writer, the R-b confidence-on-edge disposition — is inherited
// EXACTLY as genericBridge.js composes it; nothing here reimplements or forks that machinery. Only the
// IDENTITY constants and the composer's construction call (nominate/walk/dependencies added) differ.
//
// House style (matching genericBridge.js/caseStructuralBridge.js): qtools curried moduleFunction for
// the pure helpers; callback(errString, result) with '' on success; no async/await, no try/catch for
// control flow; taskListPlus/pipeRunner; refuse-by-value (polyArch2 §6); camelCase, compound names.

const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// content-address — 3 levels up from forges/case/bridges to the tree root (forges/case/bridges ->
// forges/case -> forges -> root), ONE level deeper than genericBridge.js's own 2-level reach because
// this file sits under forges/case/, not directly under forges/ — the SAME extra level
// caseStructuralBridge.js's own requires already account for.
const contentAddress = require(path.join(__dirname, '..', '..', '..', 'lib', 'content-address', 'content-address'))();

const sourceWalkerModule = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib.d', 'sourceWalker'),
);
const flattenFullRecord = sourceWalkerModule.flattenFullRecord;

// ⟪P9, p9-judgmentPersistence 2026-07-31⟫ cachedJudgment — the judgment-persistence seam (same
// three-level climb). EVERY evidence bridge's per-source judgment routes through it: cache check
// before any API call, decided = persisted before downstream use, one forensic record per
// judgment. With kit.judgmentCache/kit.matchForensics absent (this bridge's hermetic suite), it is
// the byte-identical original kit.evidenceSelect call. This bridge does NOT opt into the P9
// structural dedupe (no judgmentKey hook — CASE's stableId-borne structure is per-source identity,
// not shared plumbing); genericBridge.js/sifEvidenceBridge.js carry that seam.
const cachedJudgment = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'cachedJudgment'),
);

// candidateKeyFor — REUSED from lib/evidenceComposer.js, not reimplemented: the walk hook below keys
// perCandidateNotes by the SAME identity the composer itself uses to look them back up when assembling
// the evidence package (stableId || canonicalKey || cedsId || valueKey || name) — a locally-invented key
// function could silently drift from the composer's own and orphan every note it computed.
const { candidateKeyFor } = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'evidenceComposer'),
);

// ⟪P12, candidateSelectionRedesign-073126.md §4⟫ facetScan — the multi-facet scan + reserved-slot
// allocation, and the composite-embed-text / owning-class-map helpers. CASE is the standard whose
// `case:CFItem.uri` failure motivated this phase (the golden's answer, 'Competency Definition URL',
// never entered the pool at all), so this bridge opts in ALONGSIDE its own nomination hook: the scan
// supplies representation, caseNominate supplies CASE's own signal, and the composer unions them.
const facetScan = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'facetScan'),
);
const {
	buildClassMap,
	stampOwningClass,
	embedTextForSource,
	CLASS_ROLE,
} = facetScan;

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// =====================================================================
// IDENTITY — this bridge's own choices.
// =====================================================================
const MAPPING_TOOL = 'caseEvidenceBridge';
const HUB_STANDARD = 'CEDS';
const HUB_REFERENCE_LABEL = 'HubReference';
const SOURCE_STANDARD = 'CASE';
const DEFAULT_ROLE = 'DmeProperty';
const MATERIALIZER_CONFIG = { predicate: 'closeMatch', mappingJustification: 'semapv:SemanticSimilarity' };

// ⟪skipAI FLAGGING, 2026-08-10⟫ the debug mark and its two travel paths, required from the module
// that owns them (lib/debugJudge.js) rather than restated here — one convention, one spelling, no
// chance of three bridges drifting apart. See that module's own header for why the mark must survive
// into the frozen block's generation.
const { debugMarkFromLlmClient, debugMarkFromGeneration, generationWithDebugMark } = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'debugJudge'),
);

// ⟪skipAI WINDOW, 2026-08-10⟫ --limit / --offset over this bridge's source elements, shared so the
// window means the same thing for every standard. It SORTS by stableId before slicing (an offset over
// an unstable graph-read order would land somewhere different every run) and marks the frozen block's
// generation, because a block built from 10 of 214 elements is otherwise indistinguishable from a
// complete one and MATERIALIZE would replay the ten forever as if that were the pairing.
const { applySourceWindow, windowMarkFor, generationWithWindowMark, describeWindow } = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'sourceWindow'),
);

// EVIDENCE_GENERATION — this bridge's OWN generation tag (⟪A6⟫, R4), distinct from genericBridge's —
// a CASE-nominating, CASE-considering pipeline produces a different generation of picks even over the
// identical graph state, and must be legible as such.
// v4 ⟪P12 MULTI-FACET SCAN, 2026-07-31⟫: composite embedded text (owning class · name · description ·
// class description) replacing the defText fallback chain, six-facet reserved-slot pool allocation
// alongside caseNominate, and renderer v4's owning-class + facet-provenance prompt. Any one of those
// changes picks over identical graph state (⟪A6⟫/R4).
// v5 ⟪hubReimplementation P3, 2026-08-03 (SPEC §6)⟫: candidates are no longer re-embedded (the
// card's forge-stamped embedding of its definition-carrying embedText is read off the graph) and the
// prompt's tuple block carries the card's MEANING via renderer v5 + the revised cedsHubModule —
// either change alone re-judges the world.
const EVIDENCE_GENERATION = 'caseEvidenceBridge-evidence-v5';

// HUB_SEGMENTS — composition-order slot 2 (hub-level framing), copied verbatim from genericBridge.js:
// this bridge bridges toward the SAME CEDS hub, so the SAME hub-level instruction applies. Deliberately
// duplicated rather than required-in-from genericBridge.js — the two bridges are independent siblings
// (matching this tree's own established precedent of small, local, intentional duplication, e.g. asList
// re-declared in cedsHubModule.js/referenceIndex.js/genericBridge.js rather than shared).
const HUB_SEGMENTS = [
	'Judge every candidate against its authoritative CEDS tuple evidence below — the domain(s), range, ' +
		'qualifier, and value-scope facts — not by surface wording alone.',
];

// =====================================================================
// CASE STRUCTURAL-SIGNAL HELPERS — PORTED VERBATIM from caseStructuralBridge.js (see file header:
// "port those pure helpers", not re-derive). Exported below for the unit test, exactly as that file
// exports them for test-caseStructuralBridge.js.
// =====================================================================

const STOPWORDS = new Set([
	'a', 'an', 'the', 'of', 'for', 'is', 'in', 'on', 'to', 'and', 'or', 'with', 'by', 'this',
]);

// tokenize — camelCase/PascalCase/snake_case/whitespace-aware word split, lowercased, short-token and
// stopword filtered. Pure, deterministic. PORTED from caseStructuralBridge.js.
const tokenize = (rawText) => {
	if (rawText == null) {
		return [];
	}
	const spaced = `${rawText}`
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary: fooBar -> foo Bar
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // acronym boundary: CFAssociation -> CF Association
		.replace(/[_\-.]+/g, ' ')
		.replace(/[^A-Za-z0-9 ]+/g, ' ');
	return spaced
		.toLowerCase()
		.split(/\s+/)
		.filter((oneToken) => oneToken.length > 2 && !STOPWORDS.has(oneToken));
};

// CASE_PATH_SEGMENTS_RE — pull the className/propertyName segments off a CASE casePath stableId
// ('case:ClassName.propertyName'). PORTED from caseStructuralBridge.js.
const CASE_PATH_SEGMENTS_RE = /^case:([^.]+)\.(.+)$/;

// casePathSegments — the RAW {className, propertyName} pair off a CASE stableId, or null when the
// stableId is not CASE-path-shaped. NEW in this file (caseStructuralBridge.js only ever needed the
// TOKENIZED union, never the raw names) — the per-candidate consideration note (b) needs the raw class
// and property names for a legible sentence, not just their token set.
const casePathSegments = (stableId) => {
	const found = typeof stableId === 'string' ? stableId.match(CASE_PATH_SEGMENTS_RE) : null;
	return found ? { className: found[1], propertyName: found[2] } : null;
};

// pathTokensFromStableId — the structural-affinity signal's SOURCE side: className + propertyName,
// tokenized and unioned into one set. PORTED from caseStructuralBridge.js.
const pathTokensFromStableId = (stableId) => {
	const segments = casePathSegments(stableId);
	if (!segments) {
		return new Set();
	}
	return new Set([...tokenize(segments.className), ...tokenize(segments.propertyName)]);
};

// candidateTokens — the structural-affinity signal's CANDIDATE side: name + defText, tokenized and
// unioned. PORTED from caseStructuralBridge.js.
const candidateTokens = (candidate) => {
	const record = candidate || {};
	return new Set([...tokenize(record.name), ...tokenize(record.defText)]);
};

// overlapCoefficient — |intersection| / min(|A|,|B|), 0 when either set is empty. PORTED from
// caseStructuralBridge.js (see that file's header for why overlap, not Jaccard, is the right measure
// for a short path-token set against a full-sentence candidate description).
const overlapCoefficient = (setA, setB) => {
	if (!setA.size || !setB.size) {
		return 0;
	}
	let matches = 0;
	setA.forEach((oneToken) => {
		if (setB.has(oneToken)) {
			matches += 1;
		}
	});
	return matches / Math.min(setA.size, setB.size);
};

// structuralAffinity — PORTED from caseStructuralBridge.js: (pathTokenSet, candidateRecord) -> [0,1].
const structuralAffinity = (pathTokenSet, candidate) => overlapCoefficient(pathTokenSet, candidateTokens(candidate));

// sharedTokens — NEW in this file: the ACTUAL intersecting tokens, not merely their count/ratio — the
// per-candidate consideration (b) is prose EVIDENCE ("these are the shared words"), never a re-hidden
// score; a bare overlap NUMBER re-smuggled into a note would be exactly the scalar-blend habit this
// phase exists to retire, wearing a different hat.
const sharedTokens = (pathTokenSet, candidate) => {
	const otherTokens = candidateTokens(candidate);
	const shared = [];
	pathTokenSet.forEach((oneToken) => {
		if (otherTokens.has(oneToken)) {
			shared.push(oneToken);
		}
	});
	return shared;
};

// =====================================================================
// (a) THE NOMINATE HOOK ⟪A1⟫ — evidenceComposer's `nominate` seam. ANY CEDS candidate element whose
// name+defText tokens overlap the source's casePath class/property tokens is nominated into the union
// pool, carrying the rationale that explains why (evidenceContracts.js §1: "a nomination with no
// rationale is a bare score with a different name" — never produced here without one).
// =====================================================================

// CASE_NOMINATION_TOPK — caps how many structurally-nominated candidates one source can add to the pool
// (sorted by overlap strength, descending), the SAME discipline caseStructuralBridge.js's own
// RAW_POOL_TOPK applied to its blended ranking — this hook nominates, it does not flood: a CEDS hub can
// carry thousands of candidates, and a source with broad token overlap (a common class name) should not
// unbound the pool the judge has to weigh. 10 comfortably exceeds caseStructuralBridge's own 15-pool
// ceiling once cosine top-K's own entries are folded in by the composer's dedupe.
const CASE_NOMINATION_TOPK = 10;

// caseNominate — evidenceComposer's NOMINATE contract: ({ sourceElement, candidateElements },
// callback(errString, [{candidate, nominatedBy, rationale}, ...])). A source whose stableId is not
// CASE-path-shaped (pathTokenSet empty) nominates NOTHING — never a guessed nomination (mirrors
// pathTokensFromStableId's own "no guess" discipline).
const caseNominate = ({ sourceElement, candidateElements } = {}, callback) => {
	const segments = casePathSegments(sourceElement && sourceElement.stableId);
	const pathTokenSet = pathTokensFromStableId(sourceElement && sourceElement.stableId);
	if (!segments || pathTokenSet.size === 0) {
		callback('', []);
		return;
	}
	const scored = (candidateElements || [])
		.map((oneCandidate) => ({ candidate: oneCandidate, overlap: structuralAffinity(pathTokenSet, oneCandidate) }))
		.filter((oneScored) => oneScored.overlap > 0)
		.sort((a, b) => b.overlap - a.overlap)
		.slice(0, CASE_NOMINATION_TOPK);
	const nominations = scored.map((oneScored) => {
		const shared = sharedTokens(pathTokenSet, oneScored.candidate);
		return {
			candidate: oneScored.candidate,
			nominatedBy: MAPPING_TOOL,
			rationale:
				`nominated: owning class '${segments.className}' (property '${segments.propertyName}') shares ` +
				`token(s) [${shared.join(', ')}] with this candidate's tuple`,
		};
	});
	callback('', nominations);
};

// =====================================================================
// (b)+(c) THE WALK HOOK — evidenceComposer's `walk` seam. Performs NO graph read at all (this bridge's
// structural signal is entirely derivable from the elements the composer already handed it — exactly
// as caseStructuralBridge.js's own matcher never read the graph either); `graphReader`/`dependencies`
// ride through unused. Produces (b) a per-candidate considerations.note on EVERY pool candidate and (c)
// ONE global, candidate-blind prompt segment (CASE_GLOBAL_SEGMENT).
// =====================================================================

// CASE_GLOBAL_SEGMENT — R6/⟪A2⟫'s global, DEDUPED segment: CASE-wide judging guidance. Written entirely
// about the STANDARD's own prose habits — never a candidate, a class, or a property name — see the
// CAUTION in the file header; test-caseEvidenceBridge.js proves this passes the REAL smuggling gate.
const CASE_GLOBAL_SEGMENT =
	'Source standard note: CASE property definitions are frequently terse or empty — many CASE ' +
	'properties (URIs, associations, structural references) forge with no description text at all, ' +
	'falling back to name-only prose. A thin or empty CASE-side definition is NOT evidence of a weak ' +
	'match. Each candidate below carries a structural-location note describing the CASE source\'s ' +
	'owning class and property and any tokens it shares with that candidate; treat genuine structural ' +
	'overlap there as a real signal even when the CASE property\'s own prose is sparse or missing.';

// caseWalk — evidenceComposer's WALK contract: ({ sourceElement, pool, graphReader, dependencies },
// callback(errString, { perCandidateNotes, promptSegments })).
const caseWalk = ({ sourceElement, pool, graphReader, dependencies } = {}, callback) => {
	void graphReader; // unused — this hook performs no graph read (see header).
	void dependencies; // unused, for the same reason.
	const segments = casePathSegments(sourceElement && sourceElement.stableId);
	const pathTokenSet = pathTokensFromStableId(sourceElement && sourceElement.stableId);
	const perCandidateNotes = {};
	(pool || []).forEach((oneCandidate) => {
		const key = candidateKeyFor(oneCandidate);
		if (key === null) {
			return; // no identity to key a note by — the composer's own poolByKey would drop this entry too.
		}
		const note = segments
			? (() => {
					const shared = sharedTokens(pathTokenSet, oneCandidate);
					return (
						`Source structural location: owning class '${segments.className}', property ` +
						`'${segments.propertyName}' (casePath ${sourceElement.stableId}). Token overlap with ` +
						`this candidate: ${shared.length ? shared.join(', ') : '(none — retrieved by cosine alone)'}.`
					);
				})()
			: `Source '${sourceElement && sourceElement.stableId}' is not CASE-path-shaped; no structural location available.`;
		perCandidateNotes[key] = [note];
	});
	callback('', { perCandidateNotes, promptSegments: [CASE_GLOBAL_SEGMENT] });
};

// =====================================================================
// asList / targetKeyFor / confidence plumbing — IDENTICAL to genericBridge.js (ported, not reinvented;
// see that file's own header for the full rationale on each, particularly targetKeyFor's qualified-ref
// orphan disposition).
// =====================================================================

const asList = (value) =>
	Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];

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

const confidenceLookupFromFrozenEvidence = (frozenEvidenceArray) => {
	const lookup = {};
	(frozenEvidenceArray || []).forEach((oneEntry) => {
		if (oneEntry && oneEntry.sourceStableId && oneEntry.judgment) {
			lookup[oneEntry.sourceStableId] = oneEntry.judgment.normalizedConfidence;
		}
	});
	return lookup;
};

const enrichInferredDecisionsWithConfidence = (inferredDecisions, confidenceLookup) =>
	(inferredDecisions || []).map((oneRow) => ({
		...oneRow,
		confidence: confidenceLookup[oneRow.fromStableId],
	}));

// requiredKitMembersFor — IDENTICAL list to genericBridge.js.
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
		if (
			kit.rebridge &&
			(!kit.inferenceConfig ||
				typeof kit.inferenceConfig.llmClient !== 'object' ||
				!kit.inferenceConfig.llmClient ||
				typeof kit.inferenceConfig.llmClient.rerank !== 'function')
		) {
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
				`${MAPPING_TOOL}: config.sourceStandard is not set — this bridge must be told which source ` +
					`standard it bridges even though it only ever sources from CASE (see the next check); there ` +
					`is no default.`,
			);
			return;
		}
		// THE CASE RULE (lib.d/sourceWalker.js): the recipe token is lowercase; forged `_source` is
		// uppercase. Read and stamp by the uppercase key.
		const sourceStandardKey = sourceStandard.toUpperCase();
		if (sourceStandardKey !== SOURCE_STANDARD) {
			callback(
				`${MAPPING_TOOL}: config.sourceStandard is '${sourceStandardKey}', but this bridge sources from ` +
					`${SOURCE_STANDARD} only — its nominate/walk hooks assume CASE's casePath stableId shape ` +
					`('case:ClassName.propertyName'); use genericBridge for a different source. There is no default.`,
			);
			return;
		}
		const subjectVersion = config.sourceVersion || '';
		const objectVersion = config.hubVersion || '';
		const role = config.role || DEFAULT_ROLE;
		const pairKey = `${HUB_STANDARD}::${sourceStandardKey}`;
		// ⟪A5⟫ walk scope — the recipe's own `dependencies` field, threaded here exactly as
		// lib/build.js:680-688/741 thread it (a mapping bridge's `config.familyStandards` falls back to
		// `bridge.dependencies` when the recipe entry carries no familyStandards of its own — the SAME
		// field this bridge's caseWalk hook never actually needs to read, since it performs no graph
		// walk at all, but is threaded honestly regardless of whether this hook exercises it).
		const composerDependencies = config.dependencies || config.familyStandards || [];

		// readReferenceNodes — the RAW HubReference nodes, flattened to FULL records (spec §5). Serves
		// TWO purposes, exactly as genericBridge.js's own version did: the materializer's resolution
		// index (referenceIndex.js, unchanged) AND, in REBRIDGE mode, the evidence composer's candidate
		// pool.
		const readReferenceNodes = (done) => {
			kit.graphReader.readNodes({ label: HUB_REFERENCE_LABEL, propertyEquals: {} }, (err, out) =>
				done(
					err ? `${MAPPING_TOOL}: reading ${HUB_STANDARD} ${HUB_REFERENCE_LABEL} nodes: ${err}` : '',
					(out || {}).nodes || [],
				),
			);
		};

		// buildAndWrite — the SHARED tail of both modes, IDENTICAL to genericBridge.js's own.
		const buildAndWrite = ({ inferredDecisions, sourceNodes, referenceNodes, decisionBlockHash, decisionAlgorithm }, done) => {
			const builder = kit.materializer({
				...MATERIALIZER_CONFIG,
				subjectSource: sourceStandardKey,
				subjectVersion,
				objectSource: HUB_STANDARD,
				objectVersion,
				mappingTool: MAPPING_TOOL,
				decisionBlockHash,
				decisionAlgorithm,
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
		// ================= calls, IDENTICAL in shape to genericBridge.js's own runMaterialize.
		const runMaterialize = () => {
			kit.decisionStore.getDecisionBlock({ pairKey }, (loadErr, loaded) => {
				if (loadErr) {
					finish(`${MAPPING_TOOL}: loading frozen evidence-decision block for ${pairKey}: ${loadErr}`);
					return;
				}
				const frozenText = loaded && loaded.frozenText;
				if (!frozenText) {
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
						{
							inferredDecisions: enrichedInferredDecisions,
							sourceNodes: args.sourceNodes,
							referenceNodes: args.referenceNodes,
							decisionBlockHash,
							// the block self-describes: a debug-frozen block keeps flagging its edges forever.
							decisionAlgorithm: debugMarkFromGeneration(parsed.generation),
						},
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
		// ================= -> normalize) -> freeze -> save -> materialize -> write. IDENTICAL shape to
		// ================= genericBridge.js's own runRebridge, with ONE difference: the composer is
		// ================= constructed with THIS bridge's nominate/walk hooks + declared dependencies.
		const runRebridge = () => {
			// ⟪skipAI FLAGGING⟫ this run's generation, SUFFIXED when a debug judge answered, so the frozen
			// block SELF-DESCRIBES as debug (⟪A6⟫) and every later plain-build replay keeps flagging its
			// edges. Computed once here rather than at each use, so the block, the judgment-cache key, the
			// forensics and the returned report can never disagree about which generation ran.
			const debugMark = debugMarkFromLlmClient(kit);
			// the window mark keys on the REQUESTED limit/offset, so the generation is fixed before any
			// data is read — it stamps the frozen block and keys the judgment cache, both of which must
			// be decided up front.
			const windowMark = windowMarkFor({ limit: config.limit, offset: config.offset });
			const runGeneration = generationWithWindowMark(
				generationWithDebugMark(EVIDENCE_GENERATION, debugMark),
				windowMark,
			);
			// ⟪P12⟫ the composer is now built INSIDE the pipeline (the ARM step below) rather than here,
			// because its facetScanner's once-per-run precomputation needs the candidate VECTORS, which do
			// not exist until the vectorize step has run. Declared here, assigned there, read by the
			// per-source step that follows — the pipeline's own ordering is what guarantees it is set.
			let composer = null;
			const llmClient = kit.inferenceConfig.llmClient;
			// ⟪P9⟫ the persistence-seamed judge (see the cachedJudgment require note above).
			const judgeOne = cachedJudgment({
				judgmentCache: kit.judgmentCache || null,
				matchForensics: kit.matchForensics || null,
				pairKey,
				generation: runGeneration,
				rendererVersion: kit.evidenceRenderer.RENDERER_VERSION,
				evidenceSelect: kit.evidenceSelect,
				llmClient,
			});

			const taskList = new taskListPlus();

			taskList.push((args, next) =>
				kit.sourceWalker.walk({ standard: sourceStandardKey, role, flatten: flattenFullRecord }, (err, out) =>
					next(err, { ...args, sourceNodes: out && out.sourceNodes }),
				),
			);
			// ⟪skipAI WINDOW⟫ apply --limit/--offset AFTER the walk (and after any standard-specific scope,
			// so a limit means "10 of the scoped set", not 10 of everything). A window is refused BY NAME
			// when malformed or when it selects nothing; an ordinary run passes through untouched.
			taskList.push((args, next) => {
				const windowed = applySourceWindow(args.sourceNodes, { limit: config.limit, offset: config.offset });
				if (windowed.error) {
					next(`${MAPPING_TOOL}: ${windowed.error}`, args);
					return;
				}
				if (windowed.window) {
					const { xLog } = process.global;
					xLog.status(`[${MAPPING_TOOL}] ${describeWindow(windowed.window)}`);
				}
				next('', { ...args, sourceNodes: windowed.sourceNodes, sourceWindow: windowed.window });
			});
			taskList.push((args, next) =>
				readReferenceNodes((err, nodes) =>
					// ⟪ZERO HUB CARDS IS A REFUSAL, 2026-08-11⟫ the missing twin of the ZERO-SOURCES guard
					// above. That one exists because the bronze build froze empty blocks as green; the
					// hub side could do exactly the same and nothing caught it. The two candidate guards
					// below use .find(), which returns undefined on an EMPTY array, so a zero-card pool
					// sailed through both — the run would judge every source against nothing, abstain on
					// all of them, freeze a block of pure abstention and EXIT 0. Nothing could produce an
					// empty hub until block reuse arrived (a base block forged without deriveHub carries
					// no cards under the same name), so this is a guard that was never needed rather than
					// a bug that was missed. Refuse BY NAME, never materialize silence.
					err
						? next(err, args)
						: (nodes || []).length === 0
							? next(
									`${MAPPING_TOOL}: found ZERO ${HUB_REFERENCE_LABEL} nodes for hub ` +
										`'${HUB_STANDARD}' in the dependency graph — there is nothing to judge against. ` +
										`The hub standard's base block is absent or was forged without its hub folded in ` +
										`(deriveHub). An empty candidate pool is refused, never judged as universal ` +
										`abstention.`,
									args,
								)
							: next('', { ...args, referenceNodes: nodes, candidateElements: nodes.map(flattenFullRecord) }),
				),
			);

			// ⟪P12 §4.5⟫ THE OWNING-CLASS MAP — one role-scoped read of every CASE DmeClass, outside the
			// scan (§4.2 forbids a graph read inside it). CASE is the standard this exists for: CFItem's
			// own class description ("content that either describes a specific competency (learning
			// objective)...") sat unused on the class node while the judge inferred CFItem's meaning from
			// its name. An empty result is honest absence; a failed read is refused by name.
			taskList.push((args, next) => {
				kit.graphReader.readNodes(
					{ label: 'ForgedNode', propertyEquals: { _source: sourceStandardKey, role: CLASS_ROLE } },
					(err, out) => {
						if (err) {
							next(`${MAPPING_TOOL}: reading ${sourceStandardKey} ${CLASS_ROLE} nodes for the owning-class map: ${err}`, args);
							return;
						}
						const classNodes = ((out || {}).nodes || []).map(flattenFullRecord);
						next('', { ...args, classMap: buildClassMap(classNodes) });
					},
				);
			});

			// ⟪hubReimplementation P3 (SPEC §6)⟫ THE CANDIDATE VECTORS COME OFF THE CARD. Every
			// reimplemented HubReference carries `embedText` (its forge-composed §4 retrieval string) and
			// `embedding` (its forge-stamped 1024-dim vector, restored onto the graph node by the Phase-2
			// sidecar wire) — the bridge READS them and refuses BY NAME any candidate lacking either; it
			// never re-embeds a candidate. The old hub DmeClass domain-map read is retired with the
			// bridge-side candidate composition (the card carries domainName itself).
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
			// so it is still composed and embedded here (candidates arrive pre-embedded on the card);
			// `defText` is untouched (caseNominate/caseWalk still tokenize name+defText, deliberately: a
			// composite that already contains the class name would make the class-token overlap trivially
			// self-satisfying and hollow out the nomination's own rationale).
			taskList.push((args, next) => {
				args.sourceNodes.forEach((oneSource) => {
					stampOwningClass(oneSource, args.classMap);
					oneSource.embedText = embedTextForSource(oneSource, args.classMap);
				});
				next('', args);
			});

			// VECTORIZE (NET) — SOURCE embedTexts only (⟪hubReimplementation P3⟫: zero candidate embeds,
			// gate G-15's whole assertion).
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

			// ARM THE SCAN ⟪P12⟫ — the scanner's per-candidate precomputation is paid ONCE for the whole
			// run, here, now that every candidate carries a vector.
			taskList.push((args, next) => {
				const facetScanner = facetScan({ candidateElements: args.candidateElements, classMap: args.classMap });
				composer = kit.evidenceComposer({
					semanticMatcher: kit.semanticMatcher,
					facetScanner,
					nominate: caseNominate,
					walk: caseWalk,
					dependencies: composerDependencies,
				});
				next('', args);
			});

			taskList.push((args, next) => {
				const decisions = [];
				const frozenEvidencePayload = [];
				const perSourceTask = new taskListPlus();
				args.sourceNodes.forEach((oneSource) => {
					perSourceTask.push((a2, n2) => {
						composer(
							{ sourceElement: oneSource, candidateElements: args.candidateElements, graphReader: kit.graphReader, hubModule: kit.cedsHubModule },
							(composeErr, evidencePackage) => {
								if (composeErr) {
									n2(`${MAPPING_TOOL}: composing evidence for ${oneSource.stableId}: ${composeErr}`);
									return;
								}
								kit.evidenceRenderer.render(evidencePackage, HUB_SEGMENTS, {}, (renderErr, promptText) => {
									if (renderErr) {
										n2(`${MAPPING_TOOL}: rendering evidence for ${oneSource.stableId}: ${renderErr}`);
										return;
									}
									// ⟪P9⟫ through the persistence seam: cache check first, decided = persisted,
									// one forensic record — byte-identical to the direct call when both are off.
									judgeOne({ promptText, pool: evidencePackage.pool, sourceStableId: oneSource.stableId, sourceName: oneSource.name }, (selectErr, judged) => {
										if (selectErr) {
											n2(`${MAPPING_TOOL}: selecting for ${oneSource.stableId}: ${selectErr}`);
											return;
										}
										const selectResult = judged.selectResult;
										// ⟪P12⟫ computed, not read off pool[0]: under reserved-slot allocation an
									// unconditional anchorMatch seat leads the pool, so pool[0] is no longer
									// necessarily the highest-cosine entry.
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
												n2(`${MAPPING_TOOL}: normalizing confidence for ${oneSource.stableId}: ${normalizeErr}`);
												return;
											}
											const ordinal = chosenEntry ? evidencePackage.pool.indexOf(chosenEntry) + 1 : null;
											decisions.push({
												source: { stableId: oneSource.stableId, role: oneSource.role },
												abstain: selectResult.abstain,
												abstainReason: selectResult.abstain ? 'evidenceAbstain' : null,
												targetKey: selectResult.abstain ? null : targetKeyFor(selectResult.pick),
												chosenStableId: selectResult.abstain ? null : selectResult.pick.stableId,
												retrievalRank: ordinal,
												cosineScore: retrievalCosine,
											});
											frozenEvidencePayload.push({
												sourceStableId: oneSource.stableId,
												// ⟪FREEZE-BY-REFERENCE, 2026-07-31⟫ — see genericBridge.js's rider: the block
												// carries the promptHash ADDRESS of the evidence (judgment cache + forensics
												// hold the bytes), never the package itself. Generation bumped.
												evidencePackageRef: { promptHash: judged.judgeMeta.promptHash, rendererVersion: kit.evidenceRenderer.RENDERER_VERSION },
												judgment: { category: selectResult.category, rationale: selectResult.rationale, normalizedConfidence },
											});
											n2('', a2);
										});
									});
								});
							},
						);
					});
				});
				pipeRunner(perSourceTask.getList(), {}, (err) => next(err, { ...args, decisions, frozenEvidencePayload }));
			});

			taskList.push((args, next) => {
				const frozen = kit.evidenceFreezer.freeze({
					pairStamp: { subjectSource: sourceStandardKey, subjectVersion, objectSource: HUB_STANDARD, objectVersion },
					decisions: args.decisions,
					generation: runGeneration,
					rendererVersion: kit.evidenceRenderer.RENDERER_VERSION,
					evidencePackages: args.frozenEvidencePayload,
				});
				kit.decisionStore.saveDecisionBlock(
					{ pairKey, frozenText: frozen.frozenText, decisionBlockHash: frozen.decisionBlockHash },
					(err) => next(err ? `${MAPPING_TOOL}: saving frozen evidence-decision block: ${err}` : '', { ...args, frozen }),
				);
			});

			taskList.push((args, next) => {
				const confidenceLookup = confidenceLookupFromFrozenEvidence(args.frozenEvidencePayload);
				const enrichedInferredDecisions = enrichInferredDecisionsWithConfidence(args.frozen.inferredDecisions, confidenceLookup);
				buildAndWrite(
					{
						inferredDecisions: enrichedInferredDecisions,
						decisionAlgorithm: debugMark,
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
					generation: runGeneration,
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
module.exports.SOURCE_STANDARD = SOURCE_STANDARD;
module.exports.EVIDENCE_GENERATION = EVIDENCE_GENERATION;
module.exports.CASE_GLOBAL_SEGMENT = CASE_GLOBAL_SEGMENT;
module.exports.CASE_NOMINATION_TOPK = CASE_NOMINATION_TOPK;
module.exports.targetKeyFor = targetKeyFor;
module.exports.confidenceLookupFromFrozenEvidence = confidenceLookupFromFrozenEvidence;
module.exports.enrichInferredDecisionsWithConfidence = enrichInferredDecisionsWithConfidence;

// Exported for the unit test ONLY (test-caseEvidenceBridge.js), matching caseStructuralBridge.js's own
// "exported for the unit test" discipline for its pure internals.
module.exports.tokenize = tokenize;
module.exports.casePathSegments = casePathSegments;
module.exports.pathTokensFromStableId = pathTokensFromStableId;
module.exports.candidateTokens = candidateTokens;
module.exports.overlapCoefficient = overlapCoefficient;
module.exports.structuralAffinity = structuralAffinity;
module.exports.sharedTokens = sharedTokens;
module.exports.caseNominate = caseNominate;
module.exports.caseWalk = caseWalk;
