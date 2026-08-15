'use strict';

// sifEvidenceBridge.js — SIF's evidence-mode mapping bridge onto CEDS (bridgeEvidenceRefactor-spec.md
// §7, Phase 6 of the arc — pattern: forges/case/bridges/caseEvidenceBridge.js, "with SIF's character").
// STRUCTURALLY this file is genericBridge.js's OWN composition (compose -> ⟪A3⟫ gate -> render ->
// select -> normalize -> freeze -> materialize -> write) with SIF-specific additions layered onto the
// SAME evidence pipeline every bridge in this tree shares — nothing here reimplements or forks that
// machinery. Only the IDENTITY constants and the composer's construction call (nominate/walk/
// dependencies) differ, exactly as caseEvidenceBridge.js's own file header describes for CASE.
//
// WHY SIF NEEDS ITS OWN BRIDGE (grounded against the REAL forged SIF asset, no Docker — see
// forges/sif/test/test-sequence-ordinal.js and the forge-sif dry count for the numbers this header
// cites):
//   - SIF's ~15,620 fields draw their LEAF names from a small, ruthlessly reused vocabulary: 'Code'
//     alone is a leaf name on 1,125 distinct fields, 'Name' on 702, 'Type' on 549, 'Value' on 555,
//     '@Codeset' on 2,160 — a leaf name match alone is close to worthless as evidence. SIF's real
//     identity is its full XML ANCESTRY (the object it lives under, and every intermediate element on
//     the way down) — CASE's problem was thin PROSE; SIF's is thin NAMES with deep, load-bearing
//     STRUCTURE instead. This is the header's ⟪A2⟫ global-segment lesson, SIF's version of it.
//   - 2,231 of those 15,620 fields (14%) carry a NATIVE CEDS cross-reference (the source TSV's own
//     'CEDS ID' column, normalized by forgeSif.js to a canonical P###### anchor and stamped into both
//     `cedsId` and `crossRefs`) — an AUTHOR-DECLARED anchor, not an inferred token match. This is
//     grounds-checked, not assumed: forgeSif's own R3 discipline throws rather than silently drop an
//     unnormalizable annotation, so every `cedsId` present on a forged SIF field is a clean P######
//     token ready to exact-match a CEDS candidate's own `cedsId`. Feature 5 (crossref nominations)
//     is therefore LIVE, not speculative.
//   - 2,465 of 4,064 forged DmeOptionValue nodes (61%) are bare numeric codes ('01'..'99' and
//     similar) — when a candidate's own evidence is shaped like this, the code string alone is not
//     semantic content; path + description are the real signal (the global segment's second lesson).
//     A search for regex-pattern-shaped FIELD names (special characters, all-numeric) found NONE in
//     this asset — that specific pathology named in the SIF work order was checked for and is ABSENT
//     here; the numeric-code pathology that IS present lives at the option-value tier, not the field
//     name tier, and the global segment below is written to cover it honestly without overclaiming
//     the field-name case.
//   - SIF's forge (Phase A of this same work order) additively stamps sequenceOrdinal/siblingCount/
//     orderSemantics (lib/sequence-contract) on every field and non-root element — a genuine,
//     document-order XML disambiguator no other standard in this tree currently forges. Feature 4
//     (sequence-aware sibling context) is this bridge's OWN structural signal, mirroring CASE's
//     owning-class-token signal but keyed on real document position instead.
//
// THE FIVE SIF-SPECIFIC ADDITIONS on top of the shared evidence pipeline:
//   (a) ANCESTRY + THREE-SLOT PER-CANDIDATE NOTES — sifWalk states, on EVERY pool candidate, the
//       source field's full xpath ancestry (with its owning SIF object called out) and a three-slot
//       comparison: leaf token vs candidate name; immediate-ancestor token vs candidate domain; the
//       field's native XSD type/format vs the candidate's range slot.
//   (b) SEQUENCE-AWARE SIBLING CONTEXT — also in sifWalk: a WALK-FREE baseline ("child N of M under
//       '<label>'") read directly off the forged sourceElement (sequenceOrdinal/siblingCount/
//       sequenceGroupLabel — no graph read needed, since flattenFullRecord already carries every raw
//       scalar the node forged), OPTIONALLY enriched with the immediate preceding/following sibling
//       NAMES via one dependency-scoped graph read (⟪A5⟫) when the injected graphReader supports it;
//       a failed/empty read degrades gracefully to the walk-free baseline, never an error.
//   (c) NOMINATIONS ⟪A1⟫ — sifNominate: leaf+immediate-ancestor token overlap against each candidate's
//       own name+defText (ported tokenize/overlapCoefficient machinery, CASE's own lineage), capped at
//       SIF_NOMINATION_TOPK; PLUS an exact-match crossref nomination when the source carries a native
//       `cedsId` anchor — the strongest evidence class this bridge can offer, always included.
//   (d) ONE GLOBAL SEGMENT ⟪A2⟫ — SIF_GLOBAL_SEGMENT, teaching SIF's character (leaf-name reuse +
//       code-shaped names) without ever naming a specific candidate — proven against the REAL
//       smuggling gate with a RED/GREEN twin (test-sifEvidenceBridge.js SECTION 5, mirroring CASE's).
//   (e) BOTH MODES (MATERIALIZE / REBRIDGE), self-gating via evidencePackageViolation, the guarded
//       writer, and the full RED/GREEN wiring-fault twin discipline — IDENTICAL to caseEvidenceBridge.js,
//       PLUS this bridge's own new refusal (a source standard other than SIF).
//
// House style (matching genericBridge.js/caseEvidenceBridge.js): qtools curried moduleFunction for the
// pure helpers; callback(errString, result) with '' on success; no async/await, no try/catch for
// control flow; taskListPlus/pipeRunner; refuse-by-value (polyArch2 §6); camelCase, compound names.

const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// content-address — forges/sif/bridges -> forges/sif -> forges -> tree root: THREE levels up, the
// same depth caseEvidenceBridge.js's own requires climb (forges/case/bridges is the same depth).
const contentAddress = require(path.join(__dirname, '..', '..', '..', 'lib', 'content-address', 'content-address'))();

// the canonical sequence-property NAMES (design-authority upgrade, 2026-07-30) — read from the
// registry, never restated as literals (the enum-drift lesson the work order names explicitly).
const { SEQUENCE_PROPERTIES } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const sourceWalkerModule = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib.d', 'sourceWalker'),
);
const flattenFullRecord = sourceWalkerModule.flattenFullRecord;

// boundedRunner — the bounded-concurrency per-source dispatcher (p8-judgeConcurrency; same
// three-level climb as the sourceWalker require above). Pure orchestration: results are collected
// BY INDEX so the per-source outputs assemble in SOURCE ORDER regardless of completion order (see
// EVIDENCE_JUDGE_CONCURRENCY below for why that matters).
const boundedRunner = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'boundedRunner'),
);

// ⟪P9, p9-judgmentPersistence 2026-07-31⟫ the judgment-persistence seams (same three-level climb):
// cachedJudgment (the judgment cache IS the checkpoint — decided = persisted — plus the forensic
// match log) and judgmentDedupe (structural dedupe fan-out; THIS bridge implements the hook — see
// sifJudgmentKey below). See genericBridge.js's own P9 require note for the full rationale.
const cachedJudgment = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'cachedJudgment'),
);
const { planJudgmentGroups, fanOutJudgedResults } = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'judgmentDedupe'),
);

// candidateKeyFor — REUSED from lib/evidenceComposer.js, not reimplemented, for the SAME reason
// caseEvidenceBridge.js reuses it: the walk hook keys perCandidateNotes by the SAME identity the
// composer itself looks entries back up by, so a locally-invented key function can never drift.
const { candidateKeyFor } = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'evidenceComposer'),
);

// ⟪P12, candidateSelectionRedesign-073126.md §4⟫ facetScan — the multi-facet scan + reserved-slot
// allocation, and the composite-embed-text / owning-class-map helpers. SIF opts in ALONGSIDE its own
// dual-channel nomination: the scan supplies representation across six signals, sifNominate supplies
// SIF's ancestry and authored-crossref evidence, and the composer unions them.
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
const MAPPING_TOOL = 'sifEvidenceBridge';
const HUB_STANDARD = 'CEDS';
const HUB_REFERENCE_LABEL = 'HubReference';
const SOURCE_STANDARD = 'SIF';
const SOURCE_FIELD_LABEL = 'SifField'; // forgeSif.js roleSpecByNativeLabel.field.perStandardLabel
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

// EVIDENCE_GENERATION — this bridge's OWN generation tag (⟪A6⟫, R4): a SIF-nominating, SIF-
// considering pipeline produces a different generation of picks even over the identical graph state.
// v1 -> v2 (⟪P9, 2026-07-31⟫): the structural dedupe fan-out (sifJudgmentKey below) changes WHICH
// sources are judged directly and reshapes member frozenEvidence entries (reference, not duplicate)
// — a differently-judging pipeline is a different generation of picks over identical graph state
// and must be legible as one, exactly the ⟪A6⟫ discipline this constant exists for.
// v5 ⟪P12 MULTI-FACET SCAN, 2026-07-31⟫: composite embedded text (owning class · name · description ·
// class description) replacing the defText resolution chain, six-facet reserved-slot pool allocation
// alongside sifNominate, and renderer v4's owning-class + facet-provenance prompt.
// v6 ⟪hubReimplementation P3, 2026-08-03 (SPEC §6)⟫: candidates are no longer re-embedded (the
// card's forge-stamped embedding of its definition-carrying embedText is read off the graph) and the
// prompt's tuple block carries the card's MEANING via renderer v5 + the revised cedsHubModule —
// either change alone re-judges the world.
const EVIDENCE_GENERATION = 'sifEvidenceBridge-evidence-v6';

// EVIDENCE_JUDGE_CONCURRENCY — how many per-source evidence judgments (compose -> ⟪A3⟫ gate ->
// render -> select -> normalize) may be IN FLIGHT at once during REBRIDGE. The serial loop this
// replaces made THIS standard infeasible: measured 2026-07-29 on the live SIF run, ~25s per Opus
// judgment × 15,620 sources ≈ 4.5 days of wall clock for one --rebridge. WHY 8: polite to
// Anthropic rate limits — high enough to matter (~8× wall-clock division), low enough that a
// healthy key rarely 429s; and a 429 that does occur is already retried with backoff INSIDE
// llmClient (its own retriableTransport/backoffMs discipline), so a burst never surfaces as a
// bridge error. DETERMINISM IS UNAFFECTED: boundedRunner collects results BY INDEX and
// decisions[]/frozenEvidencePayload[] are assembled in SOURCE ORDER after completion, so the
// frozen decision block stays BYTE-IDENTICAL to what the serial loop produced — proven
// mechanically in test-sifEvidenceBridge.js SECTION 9 (a staggered-delay stub vs a concurrency-1
// run, same frozen bytes, same hash). config.evidenceJudgeConcurrency (a positive integer)
// overrides per run — that is the seam the determinism suite drives its concurrency-1 comparator
// through; this constant is the production value.
const EVIDENCE_JUDGE_CONCURRENCY = 8;

// HUB_SEGMENTS — composition-order slot 2 (hub-level framing), the SAME hub-level instruction every
// CEDS-hub bridge in this tree carries, deliberately duplicated (not required-in) per the established
// sibling-bridge precedent caseEvidenceBridge.js's own header names.
const HUB_SEGMENTS = [
	'Judge every candidate against its authoritative CEDS tuple evidence below — the domain(s), range, ' +
		'qualifier, and value-scope facts — not by surface wording alone.',
];

// =====================================================================
// SHARED TEXT/TOKEN HELPERS — the SAME generic algorithm caseEvidenceBridge.js ports from
// caseStructuralBridge.js (tokenize/overlapCoefficient), duplicated here as SIF's own copy per this
// tree's established small-deliberate-duplication precedent (bridges are independent siblings).
// =====================================================================

const STOPWORDS = new Set([
	'a', 'an', 'the', 'of', 'for', 'is', 'in', 'on', 'to', 'and', 'or', 'with', 'by', 'this',
]);

// tokenize — camelCase/PascalCase/snake_case/whitespace-aware word split, lowercased, short-token and
// stopword filtered. Pure, deterministic.
const tokenize = (rawText) => {
	if (rawText == null) {
		return [];
	}
	const spaced = `${rawText}`
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary: fooBar -> foo Bar
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // acronym boundary: SIFMetadata -> SIF Metadata
		.replace(/^@/, '') // SIF XML-attribute names carry a leading '@' (e.g. '@RefId') — strip it
		.replace(/[_\-.]+/g, ' ')
		.replace(/[^A-Za-z0-9 ]+/g, ' ');
	return spaced
		.toLowerCase()
		.split(/\s+/)
		.filter((oneToken) => oneToken.length > 2 && !STOPWORDS.has(oneToken));
};

// candidateTokens — a CEDS candidate's name+defText, tokenized and unioned.
const candidateTokens = (candidate) => {
	const record = candidate || {};
	return new Set([...tokenize(record.name), ...tokenize(record.defText)]);
};

// overlapCoefficient — |intersection| / min(|A|,|B|), 0 when either set is empty.
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

// sharedTokens — the ACTUAL intersecting tokens, not a re-hidden score (evidence, never a scalar).
const sharedTokens = (setA, candidate) => {
	const otherTokens = candidateTokens(candidate);
	const shared = [];
	setA.forEach((oneToken) => {
		if (otherTokens.has(oneToken)) {
			shared.push(oneToken);
		}
	});
	return shared;
};

// =====================================================================
// SIF STRUCTURAL HELPERS — leaf+ancestor tokens, ancestry prose, three-slot comparison, sequence
// context. All PURE, all reading only what flattenFullRecord already hands the composer (every raw
// scalar the forged node carries) — no graph access, exactly as caseEvidenceBridge.js's own helpers.
// =====================================================================

// leafAndAncestorTokens — the NOMINATION signal's source side: the field's own leaf name PLUS its
// immediate structural ancestor's label (forgeSif.js's sequenceGroupLabel — 'Name' for a field nested
// under a Name complex element, or the owning SifObject's own name for a root-level field). Per the
// work order: "leaf + immediate-parent tokens weigh into WHICH nominees make the cap" — deeper
// ancestry rides in the per-candidate ancestry NOTE (below), not the nomination score.
const leafAndAncestorTokens = (sourceElement) => {
	const record = sourceElement || {};
	return new Set([...tokenize(record.name), ...tokenize(record.sequenceGroupLabel)]);
};

// ancestryDescription — feature (a): the FULL xpath ancestry chain, the owning SIF object called out
// by name. Deep XPath ancestry is SIF's identity (unlike CASE's two casePath tokens) — this note says
// so in full, every time, for every candidate.
const ancestryDescription = (sourceElement) => {
	const record = sourceElement || {};
	const xpath = record.xpath || '';
	const segments = xpath.split('/').filter(Boolean);
	const chain = segments.length ? segments.join(' > ') : '(no xpath recorded)';
	return (
		`SIF source location: SIF object '${record.tableName || '(unknown object)'}', ` +
		`full XML ancestry: ${chain}.`
	);
};

// threeSlotComparisonDescription — feature (b): leaf vs property name; immediate ancestor vs domain
// class(es); native type/format vs range slot. Stated in PROSE, per candidate — never a hidden score.
const threeSlotComparisonDescription = (sourceElement, candidate) => {
	const source = sourceElement || {};
	const target = candidate || {};
	const leafToken = source.name || '(unnamed field)';
	const candidateName = target.name || '(unnamed candidate)';
	const ancestorLabel = source.sequenceGroupLabel || source.tableName || '(no intermediate element)';
	const candidateDomain = target.domainId || '(no domain resolved)';
	const valueHint = source.nativeType || source.format || '(no native type/format recorded)';
	const candidateRange = target.rangeDatatype || target.rangeClassId || target.rangeOptionSetId || '(no range recorded)';
	return (
		`Three-slot comparison — leaf: SIF field '${leafToken}' vs CEDS property name '${candidateName}'; ` +
		`ancestor: SIF ancestor '${ancestorLabel}' vs CEDS domain '${candidateDomain}'; ` +
		`value hint: SIF native type/format '${valueHint}' vs CEDS range '${candidateRange}'.`
	);
};

// sequenceBaselineDescription — feature 4's WALK-FREE half: read directly off the forged
// sourceElement, no graph access. Honest when the field carries no sequence stamp at all (a field
// forged before Phase A, or a non-field candidate) — never fabricates a position.
const sequenceBaselineDescription = (sourceElement) => {
	const record = sourceElement || {};
	const ordinal = record[SEQUENCE_PROPERTIES.SEQUENCE_ORDINAL];
	const count = record[SEQUENCE_PROPERTIES.SIBLING_COUNT];
	const semantics = record[SEQUENCE_PROPERTIES.ORDER_SEMANTICS];
	if (ordinal === undefined || ordinal === null || count === undefined || count === null) {
		return 'Sequence context: not available for this source element (no sequence stamp).';
	}
	const groupLabel = record.sequenceGroupLabel || '(ungrouped)';
	return (
		`Sequence context: child ${ordinal + 1} of ${count} under '${groupLabel}' ` +
		`(orderSemantics: ${semantics || 'document'} — SIF's TSV source cannot verify a schema compositor, ` +
		`so this is document order, never a claim of xs:sequence normativity).`
	);
};

// sequenceNeighborNamesDescription — feature 4's OPTIONAL enrichment: preceding/following sibling
// NAMES, resolved from a dependency-scoped graph read of same-group SIF fields (⟪A5⟫). `siblings` is
// the raw node list a graphReader.readNodes({label: SOURCE_FIELD_LABEL, propertyEquals: {_source,
// sequenceGroupKey}}) call returned, or null/empty when the read failed or found nothing — in EITHER
// case this degrades to null (the caller falls back to the baseline alone), never an error.
const sequenceNeighborNamesDescription = (sourceElement, siblingNodes) => {
	const record = sourceElement || {};
	const ordinal = record[SEQUENCE_PROPERTIES.SEQUENCE_ORDINAL];
	if (ordinal === undefined || ordinal === null || !Array.isArray(siblingNodes) || siblingNodes.length === 0) {
		return null;
	}
	const bySiblingOrdinal = {};
	siblingNodes.forEach((oneNode) => {
		const props = (oneNode && oneNode.properties) || {};
		const oneOrdinal = props[SEQUENCE_PROPERTIES.SEQUENCE_ORDINAL];
		if (oneOrdinal !== undefined && oneOrdinal !== null) {
			bySiblingOrdinal[oneOrdinal] = props.name;
		}
	});
	const precedingName = bySiblingOrdinal[ordinal - 1];
	const followingName = bySiblingOrdinal[ordinal + 1];
	if (precedingName === undefined && followingName === undefined) {
		return null; // nothing resolvable — the caller keeps the walk-free baseline alone, honestly
	}
	const precedingText = precedingName !== undefined ? `preceded by '${precedingName}'` : '(first child)';
	const followingText = followingName !== undefined ? `followed by '${followingName}'` : '(last child)';
	return `Immediate siblings (from the same-standard dependency graph): ${precedingText}, ${followingText}.`;
};

// =====================================================================
// (c) THE NOMINATE HOOK ⟪A1⟫ — evidenceComposer's `nominate` seam. Two DISTINCT nomination sources,
// merged (crossref wins on collision, since it is the stronger evidence class): leaf+ancestor token
// overlap (capped), and an exact-match crossref anchor when the source carries one.
// =====================================================================

// SIF_NOMINATION_TOPK — bounds the TOKEN-OVERLAP nomination list (the crossref nomination, when
// present, always enters ADDITIONALLY — it is a distinct, stronger evidence class, not subject to the
// same recall cap). Mirrors CASE's own CASE_NOMINATION_TOPK discipline: nominate, do not flood.
const SIF_NOMINATION_TOPK = 10;

// =====================================================================
// applySifObjectScope — the TRIAL-SCOPE seam (TQ ruling 2026-07-31: "bridge the SIF StudentPersonals
// object as a trial... so that we can build the rest without redoing it"). config.sifObjectScope
// (recipe bridges[].params.sifObjectScope, threaded by build.js) names the owning SIF OBJECTS whose
// fields this run judges — a field's owner is its xpath's second segment
// ('/StudentPersonals/StudentPersonal/...' -> 'StudentPersonal'). Absent scope = every field (the
// full-SIF default, unchanged). WHY THE TRIAL COSTS NOTHING LATER: every scoped judgment lands in
// the judgment cache under its promptHash, and the eventual FULL run re-renders byte-identical
// prompts and replays them free — the scope changes WHICH sources are judged now, never HOW any
// source is judged (quality untouchable). Refuse-by-value: a malformed scope, or a scope matching
// ZERO fields, is refused BY NAME — never a silent empty run (the CASE-RULE lesson, same night).
// =====================================================================
const applySifObjectScope = (sourceNodes, config) => {
	const scope = config.sifObjectScope;
	if (scope === undefined || scope === null) {
		return { sourceNodes };
	}
	if (!Array.isArray(scope) || scope.length === 0 || scope.some((oneName) => typeof oneName !== 'string' || oneName.trim() === '')) {
		return {
			error:
				`${MAPPING_TOOL}: config.sifObjectScope must be a non-empty array of non-empty object names ` +
				`(got ${JSON.stringify(scope)}) — omit it entirely to judge every SIF field.`,
		};
	}
	const scopeSet = new Set(scope);
	const scoped = sourceNodes.filter((oneNode) => scopeSet.has(String(oneNode.xpath || '').split('/')[2]));
	if (scoped.length === 0) {
		return {
			error:
				`${MAPPING_TOOL}: config.sifObjectScope ${JSON.stringify(scope)} matched ZERO fields — the named ` +
				`object(s) do not exist in the forged SIF asset (owner = xpath's second segment, e.g. ` +
				`'StudentPersonal'). An empty scoped run is refused, never judged as silence.`,
		};
	}
	return { sourceNodes: scoped, scopedFrom: sourceNodes.length };
};

// sifNominate — evidenceComposer's NOMINATE contract: ({ sourceElement, candidateElements },
// callback(errString, [{candidate, nominatedBy, rationale}, ...])).
const sifNominate = ({ sourceElement, candidateElements } = {}, callback) => {
	const primaryTokens = leafAndAncestorTokens(sourceElement);
	const byKey = new Map();

	if (primaryTokens.size > 0) {
		const scored = (candidateElements || [])
			.map((oneCandidate) => ({ candidate: oneCandidate, overlap: overlapCoefficient(primaryTokens, candidateTokens(oneCandidate)) }))
			.filter((oneScored) => oneScored.overlap > 0)
			.sort((a, b) => b.overlap - a.overlap)
			.slice(0, SIF_NOMINATION_TOPK);
		scored.forEach((oneScored) => {
			const shared = sharedTokens(primaryTokens, oneScored.candidate);
			const key = candidateKeyFor(oneScored.candidate);
			if (key === null) {
				return;
			}
			byKey.set(key, {
				candidate: oneScored.candidate,
				nominatedBy: MAPPING_TOOL,
				rationale:
					`nominated: leaf '${(sourceElement && sourceElement.name) || '?'}' (ancestor ` +
					`'${(sourceElement && sourceElement.sequenceGroupLabel) || '?'}') shares token(s) ` +
					`[${shared.join(', ')}] with this candidate's tuple`,
			});
		});
	}

	// the CROSSREF nomination (feature 5) — an exact-match author-declared anchor, the strongest
	// evidence class this bridge offers; always included regardless of the token-overlap cap, and
	// OVERWRITES any token-overlap nomination for the same candidate (a stronger rationale replaces a
	// weaker one for the identical pick, never both diluting each other).
	// ⟪DEFERRED DEBT, P3 review SF-4, 2026-08-03⟫ `oneCandidate.cedsId` here is NOT a card property —
	// the reimplemented card carries none (SPEC §1) — it is flattenCandidateRecord's COMPUTED chain
	// (`cedsId || canonicalKey || propertyKey`), which resolves to canonicalKey on every card: one
	// fact riding two names via the flatten. facetScan.candidateAnchorKeys retired exactly this chain
	// in favor of reading canonicalKey alone; this consumer was OUT of SPEC §6's named scope and is
	// deliberately deferred — the real fix (read canonicalKey here and retire the computed field)
	// belongs to Phase 5's teardown pass. Behavior today is identical either way.
	const sourceCedsId = sourceElement && sourceElement.cedsId;
	if (sourceCedsId) {
		const crossRefMatch = (candidateElements || []).find((oneCandidate) => oneCandidate && oneCandidate.cedsId === sourceCedsId);
		if (crossRefMatch) {
			const key = candidateKeyFor(crossRefMatch);
			if (key !== null) {
				byKey.set(key, {
					candidate: crossRefMatch,
					nominatedBy: MAPPING_TOOL,
					rationale:
						`nominated: authored cross-reference — this SIF field's own 'CEDS ID' annotation resolves ` +
						`to ${sourceCedsId}, an author-declared anchor (not an inferred token match) — the ` +
						`strongest evidence class this bridge offers`,
				});
			}
		}
	}

	callback('', Array.from(byKey.values()));
};

// =====================================================================
// ⟪P9⟫ THE JUDGMENT-KEY HOOK — judgmentDedupe's opt-in structural-dedupe seam (⟪TQ RULING⟫ dedupe
// for EVERYONE; SIF is the first implementer). The key is the OWNER-STRIPPED SHARED-STRUCTURE
// IDENTITY: sequenceGroupKey MINUS the owner segment, PLUS the leaf field name, PLUS nativeType —
// so the 136 copies of .../SIF_Metadata/LifeCycle/Modified/By (one per owning SifObject) judge
// ONCE and the verdict fans out honestly.
//
// WHY STRIPPING THE OWNER IS RIGHT **HERE** WHEN forgeSif's SEQUENCE CAPTURE deliberately ADDED it
// (its ⟪ADVERSARIAL-REVIEW FIX, 2026-07-30⟫ owner-scoped 'sif:fieldGroup:<owner>:<pathSegments>'):
// the two keys answer DIFFERENT questions and both answers are correct. Sibling ORDINALS are
// per-document truth — "child 3 of 7 under Modified" is only true within ONE object's contiguous
// TSV rows, so the sequence group MUST be owner-scoped or ordinals lie (952-member groups, the
// defect that fix corrected). The CEDS MAPPING of shared plumbing, by contrast, is owner-
// independent — what .../Modified/By MEANS against CEDS does not change with which SifObject
// carries the copy; that identity is the relative structure + leaf + native type, so the dedupe
// key MUST strip the owner scoping the sequence stamp deliberately added. Same string, two
// legitimate scopes.
//
// KEY FORMS (mirroring forgeSif.js's two sequenceGroupKey shapes exactly):
//   nested field  'sif:fieldGroup:<owner>:<pathSegments>' -> 'sif:judgeKey:<pathSegments>:<name>:<nativeType>:<cedsId>'
//   root field    'sif:fieldGroup:root:<ownerName>'        -> 'sif:judgeKey:root:<name>:<nativeType>:<cedsId>'
// (the root form's owner segment is its LAST token — stripping it merges root-level fields by
// leaf name + native type across owners, the literal owner-stripped identity).
// nativeType is IN the key (never optional): two fields at the same relative path with different
// native types are DIFFERENT mapping questions and must never share a judgment — the negative
// control test-sif-judgment-dedupe.js proves it. A field with no sequenceGroupKey, no name, or a
// groupKey not in the forge's stamped format returns null — judged individually, never a guessed
// grouping (quality is untouchable: an unassertable identity buys no dedupe).
//
// ⟪QUALITY-FIRST DEVIATION, measured and deliberate⟫ the AUTHORED cedsId ANCHOR is ALSO in the
// key ('(none)' when absent) — one term MORE than the work order's literal formula (structure +
// leaf + nativeType). Measured against the real asset, the literal formula produced 595 shared
// groups of which 16 carried CONFLICTING author-declared 'CEDS ID' anchors and 23 mixed
// anchored/anchorless members. Fanning ONE verdict across members whose own authors declared
// DIFFERENT CEDS anchors — or whose representative's evidence pool carried a crossref nomination
// the member's would not — is a quality-for-cost trade, and ⟪TQ RULING, 2026-07-31⟫ forbids
// exactly that ("I do not want *any* compromise in the quality of the matches"). With the anchor
// in the key those groups split and their members judge individually/per-anchor; measured cost:
// 4,666 -> 4,716 judgments on the real asset (50 more), still a 70% reduction from 15,620.
// =====================================================================

const SIF_FIELD_GROUP_KEY_PATTERN = /^sif:fieldGroup:([^:]+):(.+)$/;

// sifJudgmentKey — judgmentDedupe's JUDGMENT-KEY contract: (sourceElement, callback(err, keyOrNull)).
const sifJudgmentKey = (sourceElement, callback) => {
	const record = sourceElement || {};
	const groupKey = record.sequenceGroupKey;
	const leafName = record.name;
	if (typeof groupKey !== 'string' || typeof leafName !== 'string' || leafName.trim() === '') {
		callback('', null); // no asserted structure -> judged individually, never a guessed grouping
		return;
	}
	const match = groupKey.match(SIF_FIELD_GROUP_KEY_PATTERN);
	if (!match) {
		callback('', null); // not the forge's stamped format -> no shared-structure claim to make
		return;
	}
	const ownerSegment = match[1];
	// owner-stripped structural identity: the nested form's remainder IS the owner-relative path
	// (parser.js strips the owning object's own segments before stamping); the root form's
	// remainder is the OWNER ITSELF, so stripping the owner leaves only the 'root' position.
	const strippedPath = ownerSegment === 'root' ? 'root' : match[2];
	const nativeType = typeof record.nativeType === 'string' && record.nativeType.trim() !== '' ? record.nativeType : '(none)';
	// the authored anchor term (the quality-first deviation documented above).
	const cedsAnchor = typeof record.cedsId === 'string' && record.cedsId.trim() !== '' ? record.cedsId : '(none)';
	callback('', `sif:judgeKey:${strippedPath}:${leafName}:${nativeType}:${cedsAnchor}`);
};

// =====================================================================
// (a)+(b)+(d) THE WALK HOOK — evidenceComposer's `walk` seam. Composes THREE per-candidate notes
// (ancestry, three-slot comparison, sequence context) on EVERY pool candidate, plus ONE global,
// candidate-blind prompt segment. MAY perform ONE dependency-scoped graph read (⟪A5⟫, sibling names);
// a missing/failed/empty read degrades to the walk-free baseline, never an error.
// =====================================================================

// SIF_GLOBAL_SEGMENT — R6/⟪A2⟫'s global, DEDUPED segment: SIF-wide judging guidance. Written entirely
// about the STANDARD's own prose/naming habits — deliberately NEVER quoting a specific reused leaf
// name (e.g. 'Code'/'Type'/'Name') or a specific code value, precisely BECAUSE those exact short
// strings are plausible real CEDS property names and would risk colliding with a live pool candidate's
// own identifying token (the smuggling gate's own literal substring check) — see
// test-sifEvidenceBridge.js SECTION 5 for the RED/GREEN proof this passes the REAL gate.
const SIF_GLOBAL_SEGMENT =
	'Source standard note: SIF leaf element names are drawn from a small, heavily reused vocabulary — ' +
	'the SAME leaf name recurs across hundreds of structurally unrelated SIF objects throughout this ' +
	'standard, so a bare leaf-name match alone is weak evidence. Each candidate below carries this SIF ' +
	"field's full XML ancestry (its enclosing object and every intermediate element on the way down) " +
	'and a slot-by-slot comparison against the candidate\'s own tuple; treat that ancestry as the real ' +
	'disambiguating signal, not the bare leaf name. A meaningful share of SIF-side enumerated values are ' +
	'themselves bare codes — short alphanumeric tokens with no semantic content of their own; when a ' +
	"candidate's own evidence is shaped like this, judge it by its accompanying path and description, " +
	"never by the code string alone. Each candidate also carries this field's position among its own " +
	'true XML siblings (an ordinal and a count, drawn from the source document\'s own element order, ' +
	'sometimes enriched with the neighboring sibling names) — SIF\'s most concrete, XML-native ' +
	'disambiguator.';

// sifWalk — evidenceComposer's WALK contract: ({ sourceElement, pool, graphReader, dependencies },
// callback(errString, { perCandidateNotes, promptSegments })).
const sifWalk = ({ sourceElement, pool, graphReader, dependencies } = {}, callback) => {
	void dependencies; // the declared scope lives in the recipe; scopeGraphReader enforces it, not us.
	const ancestryNote = ancestryDescription(sourceElement);
	const baselineSequenceNote = sequenceBaselineDescription(sourceElement);

	// ONE optional, dependency-scoped, SAME-standard graph read for sibling NAMES (feature 4's
	// enrichment half). A field with no sequenceGroupKey, or an injected graphReader that cannot read,
	// skips the read entirely — the walk-free baseline note still stands either way.
	const withSequenceNote = (done) => {
		const groupKey = sourceElement && sourceElement.sequenceGroupKey;
		if (!groupKey || !graphReader || typeof graphReader.readNodes !== 'function') {
			done(baselineSequenceNote);
			return;
		}
		graphReader.readNodes(
			{ label: SOURCE_FIELD_LABEL, propertyEquals: { _source: SOURCE_STANDARD, sequenceGroupKey: groupKey } },
			(err, out) => {
				if (err || !out || !Array.isArray(out.nodes)) {
					done(baselineSequenceNote); // an unavailable/failed read degrades honestly, never throws
					return;
				}
				const neighborText = sequenceNeighborNamesDescription(sourceElement, out.nodes);
				done(neighborText ? `${baselineSequenceNote} ${neighborText}` : baselineSequenceNote);
			},
		);
	};

	withSequenceNote((sequenceNote) => {
		const perCandidateNotes = {};
		(pool || []).forEach((oneCandidate) => {
			const key = candidateKeyFor(oneCandidate);
			if (key === null) {
				return; // no identity to key a note by — the composer's own poolByKey would drop this too.
			}
			perCandidateNotes[key] = [ancestryNote, threeSlotComparisonDescription(sourceElement, oneCandidate), sequenceNote];
		});
		callback('', { perCandidateNotes, promptSegments: [SIF_GLOBAL_SEGMENT] });
	});
};

// =====================================================================
// asList / targetKeyFor / confidence plumbing — IDENTICAL to genericBridge.js/caseEvidenceBridge.js
// (ported, not reinvented; see genericBridge.js's own header for the full rationale on each).
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

// requiredKitMembersFor — IDENTICAL list to genericBridge.js/caseEvidenceBridge.js.
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
					`standard it bridges even though it only ever sources from SIF (see the next check); there ` +
					`is no default.`,
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
		// THE CASE RULE (lib.d/sourceWalker.js): the recipe token is lowercase; forged `_source` is
		// uppercase. Read and stamp by the uppercase key.
		const sourceStandardKey = sourceStandard.toUpperCase();
		if (sourceStandardKey !== SOURCE_STANDARD) {
			callback(
				`${MAPPING_TOOL}: config.sourceStandard is '${sourceStandardKey}', but this bridge sources from ` +
					`${SOURCE_STANDARD} only — its nominate/walk hooks assume SIF's forged shape (xpath, ` +
					`sequenceGroupKey/Label, cedsId); use genericBridge for a different source. There is no default.`,
			);
			return;
		}
		const subjectVersion = config.sourceVersion || '';
		const objectVersion = config.hubVersion || '';
		const role = config.role || DEFAULT_ROLE;
		const pairKey = `${HUB_STANDARD}::${sourceStandardKey}`;
		// ⟪A5⟫ walk scope — the recipe's own `dependencies` field, threaded here exactly as
		// caseEvidenceBridge.js threads it. SIF's walk hook DOES use this (the sibling-name graph read
		// is scoped to the SIF standard itself, which must therefore be named in `dependencies`).
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
					kit.sourceWalker.walk({ standard: sourceStandardKey, role, flatten: flattenFullRecord }, (err, out) => {
						if (err) {
							next(err, args);
							return;
						}
						const scopedOut = applySifObjectScope((out && out.sourceNodes) || [], config);
						next(scopedOut.error || '', { ...args, sourceNodes: scopedOut.sourceNodes });
					}),
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
			// ⟪P12⟫ the composer is built INSIDE the pipeline (the ARM step below) rather than here: its
			// facetScanner's once-per-run precomputation needs the candidate VECTORS, which do not exist
			// until the vectorize step has run. Declared here, assigned there, read by the per-source step
			// that follows — the pipeline's own ordering is what guarantees it is set.
			let composer = null;
			const llmClient = kit.inferenceConfig.llmClient;

			const taskList = new taskListPlus();

			taskList.push((args, next) =>
				kit.sourceWalker.walk({ standard: sourceStandardKey, role, flatten: flattenFullRecord }, (err, out) => {
					if (err) {
						next(err, args);
						return;
					}
					const scopedOut = applySifObjectScope((out && out.sourceNodes) || [], config);
					if (!scopedOut.error && scopedOut.scopedFrom !== undefined) {
						const { xLog } = process.global;
						xLog.status(
							`[${MAPPING_TOOL}] sifObjectScope ${JSON.stringify(config.sifObjectScope)}: judging ` +
								`${scopedOut.sourceNodes.length} of ${scopedOut.scopedFrom} fields (trial scope; the ` +
								`full run replays these free from the judgment cache)`,
						);
					}
					next(scopedOut.error || '', { ...args, sourceNodes: scopedOut.sourceNodes });
				}),
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

			// ⟪P12 §4.5⟫ THE OWNING-CLASS MAP — one role-scoped read of every SIF DmeClass (forgeSif.js maps
			// SifObject + SifComplexType to DmeClass), outside the scan (§4.2 forbids a graph read inside it).
			// An empty result is honest absence; a failed read is refused by name.
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
			// `defText` is untouched (sifNominate/sifWalk still tokenize name+defText, deliberately — see
			// lib/facetScan.js's header for the defText-vs-embedText decision and its evidence).
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
					nominate: sifNominate,
					walk: sifWalk,
					dependencies: composerDependencies,
				});
				next('', args);
			});

			taskList.push((args, next) => {
				// PER-SOURCE: compose -> ⟪A3⟫ gate -> render -> select -> normalize — dispatched through
				// boundedRunner with EVIDENCE_JUDGE_CONCURRENCY judgments in flight at once (see that
				// constant's header for the wall-clock arithmetic and the rate-limit reasoning).
				// DETERMINISM IS SACRED: results come back BY INDEX and decisions[]/frozenEvidencePayload[]
				// are assembled in SOURCE ORDER after ALL sources settle, so the frozen decision block is
				// BYTE-IDENTICAL across reruns regardless of completion order.
				// PROGRESS: the judging phase used to run silent for hours (long enough that an orchestrator
				// once killed a healthy build as hung, 2026-07-29) — it now announces itself and reports
				// every 50 completions through xLog, the same channel the surrounding build machinery logs on.
				// ⟪P9⟫ TWO seams fold in here (see genericBridge.js's twin step for the shared rationale):
				// cachedJudgment (the judgment cache IS the checkpoint; decided = persisted; forensic
				// records per judgment) and the structural dedupe plan/fan-out — THIS bridge supplies
				// sifJudgmentKey, so shared SIF plumbing (owner-stripped structure + leaf + nativeType)
				// is judged ONCE and fans out honestly.
				const { xLog } = process.global;
				const sourceCount = args.sourceNodes.length;
				const judgeOne = cachedJudgment({
					judgmentCache: kit.judgmentCache || null,
					matchForensics: kit.matchForensics || null,
					pairKey,
					generation: runGeneration,
					rendererVersion: kit.evidenceRenderer.RENDERER_VERSION,
					evidenceSelect: kit.evidenceSelect,
					llmClient,
				});
				planJudgmentGroups({ sourceNodes: args.sourceNodes, judgmentKeyHook: sifJudgmentKey }, (planErr, plan) => {
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
													// ⟪P12⟫ computed, not read off pool[0]: under reserved-slot allocation
													// an unconditional anchorMatch seat leads the pool.
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
																// ⟪FREEZE-BY-REFERENCE, 2026-07-31⟫ — see genericBridge.js's rider: the block
																// carries the promptHash ADDRESS of the evidence (judgment cache + forensics
																// hold the bytes), never the package itself. Generation bumped (v3).
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
							// (judgedVia 'dedupe:<key>' + representativeSourceStableId, evidencePackage REFERENCED not
							// duplicated) and returns the FULL per-source array in SOURCE ORDER (⟪P9⟫).
							fanOutJudgedResults(
								{
									sourceNodes: args.sourceNodes,
									judgeIndexes: plan.judgeIndexes,
									memberPlanBySourceIndex: plan.memberPlanBySourceIndex,
									judgedResults: out.results,
									matchForensics: kit.matchForensics || null,
									pairKey,
									generation: runGeneration,
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
module.exports.SIF_GLOBAL_SEGMENT = SIF_GLOBAL_SEGMENT;
module.exports.SIF_NOMINATION_TOPK = SIF_NOMINATION_TOPK;
module.exports.targetKeyFor = targetKeyFor;
module.exports.confidenceLookupFromFrozenEvidence = confidenceLookupFromFrozenEvidence;
module.exports.enrichInferredDecisionsWithConfidence = enrichInferredDecisionsWithConfidence;

// Exported for the unit test ONLY (test-sifEvidenceBridge.js), matching caseEvidenceBridge.js's own
// "exported for the unit test" discipline for its pure internals.
module.exports.tokenize = tokenize;
module.exports.candidateTokens = candidateTokens;
module.exports.overlapCoefficient = overlapCoefficient;
module.exports.sharedTokens = sharedTokens;
module.exports.leafAndAncestorTokens = leafAndAncestorTokens;
module.exports.ancestryDescription = ancestryDescription;
module.exports.threeSlotComparisonDescription = threeSlotComparisonDescription;
module.exports.sequenceBaselineDescription = sequenceBaselineDescription;
module.exports.sequenceNeighborNamesDescription = sequenceNeighborNamesDescription;
module.exports.sifNominate = sifNominate;
module.exports.sifWalk = sifWalk;
// ⟪P9⟫ the structural-dedupe judgment-key hook (and its pattern), exported for the unit test AND
// for the real-asset key-count measurement (test-sif-judgment-dedupe.js).
module.exports.sifJudgmentKey = sifJudgmentKey;
module.exports.SIF_FIELD_GROUP_KEY_PATTERN = SIF_FIELD_GROUP_KEY_PATTERN;
// the trial-scope seam (TQ ruling 2026-07-31), exported for the unit test ONLY.
module.exports.applySifObjectScope = applySifObjectScope;
