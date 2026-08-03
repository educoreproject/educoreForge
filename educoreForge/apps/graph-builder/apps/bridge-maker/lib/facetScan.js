'use strict';

// facetScan.js — bridge-maker/lib NEW (candidateSelectionRedesign-073126.md §4; P12 deliverable).
// THE MULTI-FACET CANDIDATE SCAN: the ONE pass, per source, over EVERY hub candidate that computes six
// facets and then fills the prompt's ~25 seats by RESERVED SLOT ALLOCATION rather than by unioning two
// arbitrary cutoffs.
//
// =====================================================================
// WHY THIS EXISTS (candidateSelectionRedesign-073126.md §1/§2 — every number below MEASURED 2026-07-31)
// =====================================================================
// The retired selection step ran TWO independent brute-force scans over all 29,346 CEDS candidates and
// UNIONED their tails: cosine top-15 (lib.d/semanticMatcher.js) plus a per-standard nominate hook's own
// top-10. Both scans already touch every candidate — so the usual justification for approximate
// retrieval (search is expensive) never applied here; the real constraint is PROMPT BUDGET. Choosing the
// pool by two arbitrary cutoffs unioned means a candidate ranked 16th by cosine AND 12th by tokens loses
// its seat to one ranked 3rd by cosine and 5,000th by tokens: COMBINED evidence was structurally
// invisible. Worked failure of record: `case:CFItem.uri`, whose correct answer per the production golden
// (GOLD_260718) is 'Competency Definition URL', never entered the pool at all — the judge chose the best
// thing present and wrote a confident rationale for an answer it could not have got right.
//
// The second half of the same defect lived in the EMBEDDED TEXT. `defText` is computed by a FALLBACK
// CHAIN (lib.d/sourceWalker.js: `defText || description || searchText || name`, first non-empty wins,
// the rest DISCARDED), so in practice the description won and `searchText` — the one field carrying the
// owning class, e.g. 'CFDefinition | CFConcepts' — was thrown away BEFORE embedding. Measured loss of
// owning-class context in the embedded text: LIF 794 of 803 properties (99%), PESC 1,256 of 1,792 (70%),
// CLR 139 of 167, CASE 102 of 158. The vectors encoded a description alone and could not represent
// structure at all.
//
// =====================================================================
// defText vs embedText — THE DECISION, AND WHY (work order item 1)
// =====================================================================
// This module introduces a DISTINCT field, `embedText`, and leaves `defText` BYTE-UNTOUCHED.
//
// `defText` has live readers that are NOT about embedding, established by grep over the whole tree:
//   - lib.d/evidenceRenderer.js SOURCE_IDENTITY_KEYS renders it in the SOURCE ELEMENT block (a judge-
//     facing definition; a composite string with the class name and class description spliced in would
//     read as noise there, and would DUPLICATE the owning-class lines the source block now carries in
//     their own right);
//   - lib.d/selector.js and lib/inferencePipeline.js build the SCALAR path's prompt lines from it
//     (`oneCandidate.defText || oneCandidate.name`) — the value-tier relic that survives P5 untouched;
//   - forges/case/bridges/caseEvidenceBridge.js and forges/sif/bridges/sifEvidenceBridge.js tokenize
//     name+defText for their NOMINATION signals, where a composite that already contains the class name
//     would make the class-token overlap trivially self-satisfying;
//   - test-sourceWalker.js asserts the fallback chain's exact resolved value, as a documented contract.
// Redefining `defText` would silently change all five, and four of them would get WORSE. A new field
// named for its job changes exactly one consumer (the vectorizer call) and is greppable end to end —
// "one name across boundaries", and no consumer is changed behind its own back.
//
// =====================================================================
// THE COMPOSITE EMBEDDED TEXT (§4.1) — the EXACT format, both sides
// =====================================================================
// Both sides compose the SAME positional slot order so the vectors are comparable
// (SPEC-hubReimplementation-080326.md §4 is now the slot authority for BOTH sides):
//
//   slot 1   CONTEXT      source: owning class name          candidate: domain name
//   slot 2   NAME         source: property name              candidate: property/value name
//   slot 3   DEFINITION   source: description                candidate: property/value definition
//   slot 4   CONTEXT DEF  source: owning class description   candidate: domain (or option-set) definition
//
// ⟪hubReimplementation P3, 2026-08-03⟫ WHO COMPOSES WHICH SIDE CHANGED. The SOURCE side is still
// composed HERE, per run (composeSourceEmbedText below — a source element is per-standard and has no
// stored retrieval string). The CANDIDATE side is composed AT FORGE TIME by cedsHubForge (SPEC §4)
// and STORED on the card as `embedText`, exactly as embedded — so `embedTextForCandidate` below is a
// verbatim READ of the card's own field, and the bridge-side candidate recomposition (plus its
// domain-map machinery) is retired. One composition, one authority, inspectable in the graph (G-6).
//
// Rendered as the non-empty slots, IN SLOT ORDER, joined by SEGMENT_SEPARATOR (' · '), each slot
// whitespace-collapsed and trimmed. Empty slots contribute nothing (they do not emit a bare separator).
//
// DEGENERATE CASE (SOURCE side only), stated out loud: a source whose every slot is empty composes to
// ''. Embedding '' is meaningless, so `embedTextForSource` reads the record's own `defText` (then
// `name`) FOR THAT RECORD ONLY. This is NOT the old resolution chain returning: the chain PRE-EMPTED
// composition on every record where any earlier field was non-empty; this fires only when composition
// produced literally nothing. The candidate side has no degenerate case: a card with no stored
// embedText is refused by name (the forge guarantees one on every card, gate G-6).
//
// =====================================================================
// THE SIX FACETS (§4.2) — and the HARD CONSTRAINT
// =====================================================================
//   cosine          vector similarity — the dot product of two unit-normalized 1024-dim embeddings
//   nameOverlap     source property-name tokens ↔ candidate name tokens (overlap coefficient)
//   contextOverlap  source OWNING-CLASS tokens ↔ candidate DOMAIN tokens (overlap coefficient)
//   anchorMatch     source's AUTHORED cedsId == candidate's canonicalKey (set membership)
//   typeFit         source native type ↔ candidate range shape (two precomputed small integers)
//   tierMatch       property↔property, value↔value (two precomputed small integers)
//
// HARD CONSTRAINT (§4.2, and a precedent paid for in production): EVERY facet is O(1)-ish per pair after
// precomputation — a dot product, a set-membership test over the SMALL side, an integer compare. NO
// graph read, NO LLM call, NO string allocation happens inside the scan. An `-implied` O(N²) cosine
// runaway was one of the five real-scale bugs of the original build; this file's whole per-pair budget is
// therefore stated and defended in one place:
//   - candidate token SETS, norms, anchor keys, tier and type codes are computed ONCE PER RUN in
//     `facetScan({ candidateElements })`, never per source and never per pair;
//   - the per-source scratch buffers (values, ranks, sort indexes) are allocated ONCE at construction
//     and REUSED for every source — a 5,472-source bronze run allocates them once, not 5,472 times;
//   - overlap coefficients iterate the SOURCE's token set (typically 2-6 tokens) testing membership in
//     the candidate's Set, never the other way round;
//   - the human-readable facet PROSE (shared token lists, type statements) is materialized only for the
//     ~25 SEATED candidates, from codes the pass already computed — never for all 29,346.
//
// RANKS ARE EXACT, NOT APPROXIMATE. Three full sorts of an index array (cosine, nameOverlap,
// contextOverlap) plus one of the rank-sum give every candidate its true global rank, which is what makes
// the evidence able to say "cosine 0.397 (rank 16 of 29,346)" honestly. Measured cost of the sorts is
// small against the dot products they accompany (see test-facetScan.js's timing section).
//
// =====================================================================
// RESERVED-SLOT ALLOCATION (§4.3) — NOT a weighted score
// =====================================================================
//   every anchorMatch    unconditional, exempt from the cap — an author-declared anchor beats inference
//   top 10 by cosine
//   top 5  by contextOverlap
//   top 5  by nameOverlap
//   top 5  by combined rank      ← the seats that do not exist today: strong on several facets, top on none
//   dedupe; cap at POOL_CAP (~25)
//
// ⟪TQ RULING, 2026-06-26⟫ WEIGHTED TUPLE-SUM SCORING IS REJECTED, and the caseStructuralBridge blend was
// torn out in P5 precisely because "the structural signal never reached the judge, only its own gravity
// on ranking." Reserved slots are the opposite of that: they encode a REPRESENTATION POLICY (every signal
// gets seats) with no coefficients to tune and nothing hidden in a scalar. The one place ranks combine —
// `combinedRank` — is a RANK SUM (each facet's ordinal position, added), not a value blend: it has no
// weights, is invariant to each facet's units and scale, and cannot be tuned to favour a signal. And it
// only ever decides WHO IS SHOWN.
//
//   THE RANKING DECIDES WHO IS SHOWN. IT NEVER DECIDES WHO WINS. The judge decides who wins, on the
//   evidence, and every seat states the facet(s) that earned it (§4.4).
//
// `typeFit` and `tierMatch` are EVIDENCE-ONLY facets: they are computed for every pair (they are two
// integer compares) and reported in the provenance, but they allocate NO slots and contribute NOTHING to
// combinedRank. That is deliberate — a compatible type is a fact the judge should weigh, not a reason to
// displace a candidate the semantics favour.
//
// A ZERO-VALUED FACET EARNS NO SEAT. When a source has no owning-class tokens at all, contextOverlap is
// 0 for all 29,346 candidates and its "top 5" would be five arbitrary candidates in index order — padding
// dressed as representation. Slots are filled only from candidates whose facet value is > 0.
//
//   facetScan({ candidateElements, reservations?, poolCap?, classMap? })
//     -> { scan(sourceElement) -> { entries, candidateCount },  candidateCount }
//
// PURE + synchronous + deterministic: no Neo4j, no network, no LLM, no Date/random. Every ordering is
// total (ties broken by candidate index, i.e. by the caller's own candidate order). camelCase, compound
// names; refuse-by-value (polyArch2 §6) — a malformed construction argument is refused BY NAME.
//
// House style: qtools curried moduleFunction; no async/await; no try/catch for control flow. This module
// is synchronous BY CONTRACT (it is a pure computation over already-read data, invoked from inside the
// composer's own callback-shaped seam) — the R7 callback ruling governs the six evidence CONTRACT
// callables (evidenceContracts.js), and this is not one of them; it is a helper the composer calls, the
// same way the composer calls semanticMatcher.retrieve synchronously today.

// DECLARED_FACET_NAMES — IMPORTED, never restated. evidenceContracts.js is the authority on what
// crosses the match->select seam, and its ⟪A3⟫ gate refuses a facet set missing any declared name; a
// second local list here would be a drift waiting to happen.
const { DECLARED_FACET_NAMES } = require('./evidenceContracts');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// =====================================================================
// TOKENIZATION — PORTED VERBATIM from forges/case/bridges/caseEvidenceBridge.js (itself ported from the
// retired caseStructuralBridge.js). Deliberately the SAME tokenizer the CASE and SIF nomination hooks
// use: two token measures over the same corpus that disagreed about what a word is would be a silent
// source of divergence between a facet's rank and a nomination's rationale.
// =====================================================================

const STOPWORDS = new Set([
	'a', 'an', 'the', 'of', 'for', 'is', 'in', 'on', 'to', 'and', 'or', 'with', 'by', 'this',
]);

// tokenize — camelCase/PascalCase/snake_case/whitespace-aware word split, lowercased, short-token and
// stopword filtered. Pure, deterministic.
const tokenize = (rawText) => {
	if (rawText === null || rawText === undefined) {
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

// overlapCoefficient — |intersection| / min(|A|,|B|), 0 when either set is empty. Iterates setA, so a
// caller passes the SMALL set first (the scan always passes the source's few tokens).
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

// sharedTokenList — the ACTUAL intersecting tokens, sorted, for the provenance prose. Computed ONLY for
// seated candidates: prose is evidence, and evidence is only owed for a candidate the judge can see.
const sharedTokenList = (setA, setB) => {
	const shared = [];
	setA.forEach((oneToken) => {
		if (setB.has(oneToken)) {
			shared.push(oneToken);
		}
	});
	return shared.sort();
};

// =====================================================================
// COMPOSITE EMBEDDED TEXT (§4.1)
// =====================================================================

const SEGMENT_SEPARATOR = ' · ';

// normalizeSegment — collapse all whitespace runs to one space and trim. A slot that normalizes to ''
// is absent, not empty-but-present.
const normalizeSegment = (value) => {
	if (value === null || value === undefined) {
		return '';
	}
	return `${value}`.replace(/\s+/g, ' ').trim();
};

// joinSegments — the ONE composition rule: non-empty slots, in slot order, joined by SEGMENT_SEPARATOR.
const joinSegments = (segments) =>
	segments.map(normalizeSegment).filter((oneSegment) => oneSegment !== '').join(SEGMENT_SEPARATOR);

// composeSourceEmbedText — slot order: owning class name · property name · description · owning class
// description. A pure function of its four named inputs; identical inputs always produce identical bytes.
const composeSourceEmbedText = ({ owningClassName, propertyName, description, owningClassDescription } = {}) =>
	joinSegments([owningClassName, propertyName, description, owningClassDescription]);

// asList — PG-JSON single-element collapse guard (the SAME helper cedsHubModule.js/referenceIndex.js
// each define locally: a single-element array collapses to a scalar at MERGE).
const asList = (value) =>
	Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];

// candidateLabelOf — a DISPLAY label for refusal messages, nothing more. Stated as explicit
// prose-order resolution (not an identity chain over data): a card is named by its canonicalKey; a
// record that never got one is named by its graph identity; a record with neither is called what it
// is. No downstream reader consumes this value — it exists to make an error message name its subject.
const candidateLabelOf = (record) => {
	if (typeof record.canonicalKey === 'string' && record.canonicalKey !== '') {
		return record.canonicalKey;
	}
	if (typeof record.stableId === 'string' && record.stableId !== '') {
		return record.stableId;
	}
	return '(unidentified)';
};

// candidateDomainText — the candidate's domain NAME, read off the card, full stop.
//
// ⟪hubReimplementation P3, 2026-08-03 (SPEC-hubReimplementation-080326.md §6)⟫ the reimplemented
// HubReference card carries `domainName` itself (SPEC §1.3, proven on 100% of cards by gate G-4) —
// the four-step resolution chain this function used to run (allDomainNames, then domainName, then a
// bridge-built domain map keyed by allDomainIds, then domainId) and the `buildDomainMap` helper that
// fed it are RETIRED with the card shape that made them necessary. A candidate without a domainName
// is a broken card and is refused BY NAME — never silently scanned as contextless (the no-silent-
// substitution rule; a ''-return here would quietly kill the contextOverlap facet for that card).
const candidateDomainText = (candidate) => {
	const record = candidate || {};
	if (typeof record.domainName !== 'string' || record.domainName === '') {
		throw new Error(
			`facetScan: candidate '${candidateLabelOf(record)}' carries no ` +
				`domainName — the reimplemented card carries its domain's name itself (SPEC §1.3); a card ` +
				`without one is broken, not resolvable. There is no map and no default.`,
		);
	}
	return record.domainName;
};

// descriptionTextOf — the record's own PROSE, read from the raw fields, NEVER from the computed
// `defText` (whose resolution chain is exactly what this module replaced for the embedding input).
const descriptionTextOf = (record) => record.description || record.definition || '';

// embedTextForCandidate — ⟪hubReimplementation P3⟫ the card's STORED `embedText`, verbatim. The card
// composes and stores its own retrieval string at forge time (SPEC §1.5/§4: slot-ordered, definition-
// carrying, stored exactly as embedded) — the bridge-side recomposition this function used to perform
// (domainName · name · description, with a degenerate defText/name recovery) is retired: recomposing
// here would be a second authority over one fact, and the bridge-side inputs (cards carry no
// `description`) could never reproduce the forge's own composition anyway. A card without embedText
// is refused by name.
const embedTextForCandidate = (candidate) => {
	const record = candidate || {};
	if (typeof record.embedText !== 'string' || record.embedText === '') {
		throw new Error(
			`facetScan: candidate '${candidateLabelOf(record)}' carries no ` +
				`embedText — the reimplemented card stores its composed retrieval string itself (SPEC §1.5); ` +
				`there is no bridge-side recomposition and no default.`,
		);
	}
	return record.embedText;
};

// embedTextForSource — the source side's composite. `classMap` is the PREFETCHED owning-class map
// (buildClassMap below); a source whose parentId resolves to no class simply contributes empty slots 1
// and 4 — honest absence, never a fabricated class name.
const embedTextForSource = (sourceElement, classMap) => {
	const record = sourceElement || {};
	const owningClass = owningClassOf(record, classMap);
	const composed = composeSourceEmbedText({
		owningClassName: owningClass.name,
		propertyName: record.name,
		description: descriptionTextOf(record),
		owningClassDescription: owningClass.description,
	});
	return composed || normalizeSegment(record.defText) || normalizeSegment(record.name) || '';
};

// =====================================================================
// THE OWNING-CLASS MAP (§4.5) — ONE graph read for ALL classes, then a lookup per source
// =====================================================================
// The class description already sits on the forged class node as its `description` property (verified
// 2026-07-31: case:CFItem carries "This is the content that either describes a specific competency
// (learning objective)..."), reachable from a property via its own `parentId`. The alternative — one
// dependency-scoped read per source — would be 5,472 round trips for the bronze; a single role-scoped
// read of every DmeClass for the standard is one. The read itself belongs to the BRIDGE (outside the
// scan, per §4.2's hard constraint); this module owns only the shape and the lookup.

const CLASS_ROLE = 'DmeClass';

// buildClassMap — flattened class nodes -> { <stableId>: { name, description } }. Duplicate stableIds
// cannot occur (stableId is the graph's own identity) but a later entry would win deterministically.
const buildClassMap = (classNodes) => {
	const map = {};
	(classNodes || []).forEach((oneNode) => {
		if (!oneNode || !oneNode.stableId) {
			return;
		}
		map[oneNode.stableId] = {
			name: normalizeSegment(oneNode.name),
			description: normalizeSegment(oneNode.description),
		};
	});
	return map;
};

// owningClassOf — a source's owning class via parentId, or the honest empty pair. A source element that
// already carries owningClassName/owningClassDescription (stamped by stampOwningClass below, or supplied
// by a test fixture) is taken at its word — the map is the SOURCE of those fields, not a second opinion.
const owningClassOf = (sourceElement, classMap) => {
	const record = sourceElement || {};
	if (record.owningClassName || record.owningClassDescription) {
		return {
			name: normalizeSegment(record.owningClassName),
			description: normalizeSegment(record.owningClassDescription),
		};
	}
	const found = (classMap || {})[record.parentId];
	return found ? { name: found.name, description: found.description } : { name: '', description: '' };
};

// stampOwningClass — MUTATES a source record with owningClassName/owningClassDescription (and its
// composed embedText), exactly as the bridges already mutate `r.vector` in place after batchEmbed. The
// stamped fields are what the RENDERER reads for the source block (§4.5) — the map itself never travels
// as far as the renderer.
const stampOwningClass = (sourceElement, classMap) => {
	const owningClass = owningClassOf(sourceElement, classMap);
	sourceElement.owningClassName = owningClass.name;
	sourceElement.owningClassDescription = owningClass.description;
	return sourceElement;
};

// =====================================================================
// PRECOMPUTATION — once per run for candidates, once per source for the source
// =====================================================================

// TYPE_CODE — the normalized type/shape vocabulary both sides resolve into. Small integers so the scan
// compares two array slots, never two strings.
const TYPE_UNKNOWN = 0;
const TYPE_STRING = 1;
const TYPE_NUMBER = 2;
const TYPE_DATE = 3;
const TYPE_BOOLEAN = 4;
const TYPE_URI = 5;
const TYPE_OPTION_SET = 6;
const TYPE_CLASS_REFERENCE = 7;

const TYPE_CODE_NAMES = Object.freeze({
	[TYPE_UNKNOWN]: 'unknown',
	[TYPE_STRING]: 'string',
	[TYPE_NUMBER]: 'number',
	[TYPE_DATE]: 'date',
	[TYPE_BOOLEAN]: 'boolean',
	[TYPE_URI]: 'uri',
	[TYPE_OPTION_SET]: 'optionSet',
	[TYPE_CLASS_REFERENCE]: 'classReference',
});

// datatypeCode — an XSD/native datatype token -> TYPE_CODE. Deliberately small and explicit: an
// unrecognized token is TYPE_UNKNOWN (which claims NOTHING), never guessed into a neighbouring bucket.
const datatypeCode = (rawType) => {
	const text = `${rawType === null || rawType === undefined ? '' : rawType}`.toLowerCase().replace(/^xs:|^xsd:/, '');
	if (text === '') {
		return TYPE_UNKNOWN;
	}
	if (/^(string|normalizedstring|token|text|name|ncname|language)$/.test(text)) {
		return TYPE_STRING;
	}
	if (/^(int|integer|long|short|byte|decimal|float|double|number|positiveinteger|nonnegativeinteger)$/.test(text)) {
		return TYPE_NUMBER;
	}
	if (/^(date|datetime|time|gyear|gmonth|gday|gyearmonth|duration)$/.test(text)) {
		return TYPE_DATE;
	}
	if (/^(boolean|bool)$/.test(text)) {
		return TYPE_BOOLEAN;
	}
	if (/^(anyuri|uri|url|iri)$/.test(text)) {
		return TYPE_URI;
	}
	return TYPE_UNKNOWN;
};

// candidateTypeCode — a CEDS HubReference's RANGE SHAPE (P0-cedsTupleModel.md §2.1/§2.3: exactly one of
// rangeDatatype/rangeClassId/rangeOptionSetId is ever set on a live node).
const candidateTypeCode = (candidate) => {
	if (candidate.rangeOptionSetId) {
		return TYPE_OPTION_SET;
	}
	if (candidate.rangeClassId) {
		return TYPE_CLASS_REFERENCE;
	}
	return datatypeCode(candidate.rangeDatatype);
};

// sourceTypeCode — the source element's NATIVE type. `nativeType` is the forge-stashed XSD type (SIF
// stamps it; forge guide §4); `rangeDatatype` is the universal forged scalar type; an option-set or
// class range is read from the same fields a forged property carries.
const sourceTypeCode = (sourceElement) => {
	if (sourceElement.rangeOptionSetId) {
		return TYPE_OPTION_SET;
	}
	if (sourceElement.rangeClassId) {
		return TYPE_CLASS_REFERENCE;
	}
	return datatypeCode(sourceElement.nativeType || sourceElement.rangeDatatype || sourceElement.format);
};

const TIER_PROPERTY = 1;
const TIER_VALUE = 2;
const TIER_UNKNOWN = 0;

const TIER_CODE_NAMES = Object.freeze({
	[TIER_UNKNOWN]: 'unknown',
	[TIER_PROPERTY]: 'property',
	[TIER_VALUE]: 'value',
});

// candidateTierCode — a HubReference's own referenceTier ('property' | 'value').
const candidateTierCode = (candidate) => {
	if (candidate.referenceTier === 'value') {
		return TIER_VALUE;
	}
	if (candidate.referenceTier === 'property') {
		return TIER_PROPERTY;
	}
	return TIER_UNKNOWN;
};

// sourceTierCode — a forged element's role ('DmeProperty' | 'DmeOptionValue').
const sourceTierCode = (sourceElement) => {
	if (sourceElement.role === 'DmeOptionValue') {
		return TIER_VALUE;
	}
	if (sourceElement.role === 'DmeProperty') {
		return TIER_PROPERTY;
	}
	return TIER_UNKNOWN;
};

// candidateAnchorKeys — the ONE identity a source's AUTHORED cedsId can name: the card's
// `canonicalKey`. ⟪hubReimplementation P3 (SPEC §6)⟫ the old second member, `cedsId`, is retired:
// cards carry no cedsId property (SPEC §1), so the flattened record's computed `cedsId` was the
// `cedsId || canonicalKey || propertyKey` chain resolving to canonicalKey anyway — an identity chain
// wearing a second name, exactly what the no-silent-substitution rule forbids. Reading canonicalKey
// alone states the same fact once, from its one authority.
const candidateAnchorKeys = (candidate) => {
	const keys = new Set();
	if (typeof candidate.canonicalKey === 'string' && candidate.canonicalKey.trim() !== '') {
		keys.add(candidate.canonicalKey.trim());
	}
	return keys;
};

// sourceAnchorId — the source's AUTHOR-DECLARED CEDS id, or ''. Read ONLY from fields a forge stamps
// from the standard's own authored crossref column (SIF's normalized 'CEDS ID', EdFi/SEDM's cedsId) —
// never inferred, never derived from a name.
const sourceAnchorId = (sourceElement) => {
	const raw = sourceElement.cedsId || sourceElement.cedsGlobalId || '';
	return typeof raw === 'string' ? raw.trim() : '';
};

// vectorNormOf — sqrt(sum of squares), summed in ARRAY ORDER so a precomputed norm is bit-identical to
// one computed inline (floating-point addition over the same values in the same order). This is what
// makes hoisting the candidate norms out of the pair loop a pure speedup rather than a numeric change.
const vectorNormOf = (vector) => {
	if (!vector) {
		return 0;
	}
	let sum = 0;
	for (let i = 0; i < vector.length; i++) {
		sum += vector[i] * vector[i];
	}
	return Math.sqrt(sum);
};

// =====================================================================
// SLOT POLICY (§4.3)
// =====================================================================

// SLOT_ORDER / DEFAULT_RESERVATIONS — the reserved seats, IN PRIORITY ORDER. Priority governs two
// things and two things only: which slot's name is listed first in a shared candidate's provenance, and
// which seats survive if the cap binds. It is NOT a weight.
const SLOT_ANCHOR_MATCH = 'anchorMatch';
const SLOT_COSINE = 'cosine';
const SLOT_CONTEXT_OVERLAP = 'contextOverlap';
const SLOT_NAME_OVERLAP = 'nameOverlap';
const SLOT_COMBINED_RANK = 'combinedRank';

const DEFAULT_RESERVATIONS = Object.freeze([
	Object.freeze({ slotType: SLOT_COSINE, seats: 10 }),
	Object.freeze({ slotType: SLOT_CONTEXT_OVERLAP, seats: 5 }),
	Object.freeze({ slotType: SLOT_NAME_OVERLAP, seats: 5 }),
	Object.freeze({ slotType: SLOT_COMBINED_RANK, seats: 5 }),
]);

const POOL_CAP = 25;

// FACET_NAMES — re-exported from the contracts' DECLARED_FACET_NAMES so a consumer that already has
// this module in hand does not need a second require just to learn the vocabulary.
const FACET_NAMES = DECLARED_FACET_NAMES;

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ candidateElements, reservations = DEFAULT_RESERVATIONS, poolCap = POOL_CAP, classMap = null } = {}) => {
		if (!Array.isArray(candidateElements)) {
			throw new Error(
				`${moduleName}: constructed without a candidateElements array (got ${typeof candidateElements}) — ` +
					`the scan is a pass over EVERY candidate; there is no default candidate set.`,
			);
		}
		if (!Array.isArray(reservations) || reservations.length === 0) {
			throw new Error(
				`${moduleName}: reservations must be a non-empty array of { slotType, seats } — the reserved-slot ` +
					`policy IS the selection (§4.3); there is no default beyond the module's own DEFAULT_RESERVATIONS.`,
			);
		}
		const badReservation = reservations.find(
			(oneReservation) =>
				!oneReservation ||
				typeof oneReservation.slotType !== 'string' ||
				oneReservation.slotType.trim() === '' ||
				!Number.isInteger(oneReservation.seats) ||
				oneReservation.seats < 1,
		);
		if (badReservation !== undefined) {
			throw new Error(
				`${moduleName}: reservation ${JSON.stringify(badReservation)} is malformed — every reservation ` +
					`needs a non-empty slotType and a positive integer seats; there is no default.`,
			);
		}
		if (!Number.isInteger(poolCap) || poolCap < 1) {
			throw new Error(
				`${moduleName}: poolCap is ${JSON.stringify(poolCap)} — it must be a positive integer (the prompt ` +
					`budget is the real constraint on this whole design, §2); there is no default beyond ${POOL_CAP}.`,
			);
		}

		const candidateCount = candidateElements.length;

		// ---- ONCE PER RUN: candidate precomputation (§4.1's "precompute per node") ----
		const candidateNameTokens = new Array(candidateCount);
		const candidateContextTokens = new Array(candidateCount);
		const candidateAnchorKeySets = new Array(candidateCount);
		const candidateVectors = new Array(candidateCount);
		const candidateNorms = new Float64Array(candidateCount);
		const candidateTypeCodes = new Uint8Array(candidateCount);
		const candidateTierCodes = new Uint8Array(candidateCount);

		candidateElements.forEach((oneCandidate, i) => {
			const record = oneCandidate || {};
			candidateNameTokens[i] = new Set(tokenize(record.name));
			// the candidate's CONTEXT is its DOMAIN — the card's own domainName (⟪hubReimplementation P3⟫
			// read directly, no map), plus the domainId token itself (an exact id match between an
			// authored context and a domain key is signal, and tokenize() already splits 'C200354' into a
			// single usable token).
			candidateContextTokens[i] = new Set([
				...tokenize(candidateDomainText(record)),
				...tokenize(record.domainId),
			]);
			candidateAnchorKeySets[i] = candidateAnchorKeys(record);
			candidateVectors[i] = record.vector || null;
			candidateNorms[i] = vectorNormOf(record.vector);
			candidateTypeCodes[i] = candidateTypeCode(record);
			candidateTierCodes[i] = candidateTierCode(record);
		});

		// ---- ONCE PER RUN: the per-source scratch buffers, REUSED for every source ----
		const cosineValues = new Float64Array(candidateCount);
		const nameOverlapValues = new Float64Array(candidateCount);
		const contextOverlapValues = new Float64Array(candidateCount);
		const anchorFlags = new Uint8Array(candidateCount);
		const typeFitCodes = new Uint8Array(candidateCount); // 0 unknown-either-side, 1 same, 2 different
		const tierFlags = new Uint8Array(candidateCount); // 0 no/unknown, 1 same tier
		const cosineRanks = new Uint32Array(candidateCount);
		const nameOverlapRanks = new Uint32Array(candidateCount);
		const contextOverlapRanks = new Uint32Array(candidateCount);
		const combinedRankValues = new Float64Array(candidateCount);
		const combinedRanks = new Uint32Array(candidateCount);
		const sortIndexes = new Uint32Array(candidateCount);

		// rankByDescendingValue — fill `ranks` with each candidate's 1-based position in the descending
		// order of `values`. TOTAL ordering: ties break by candidate index, so the ordering is a function
		// of the caller's own candidate order and nothing else. Returns the sorted index array (a VIEW of
		// the shared scratch — valid only until the next call, which is exactly how it is used below).
		const rankByDescendingValue = (values, ranks) => {
			for (let i = 0; i < candidateCount; i++) {
				sortIndexes[i] = i;
			}
			// Uint32Array.prototype.sort with a comparator; the tie-break on index makes it total, so the
			// underlying sort's own stability is irrelevant to the result.
			sortIndexes.sort((a, b) => (values[b] - values[a]) || (a - b));
			for (let position = 0; position < candidateCount; position++) {
				ranks[sortIndexes[position]] = position + 1;
			}
			return sortIndexes;
		};

		// topIndexesByRank — the first `seats` candidate indexes of a ranking, skipping any whose facet
		// value is 0 (A ZERO-VALUED FACET EARNS NO SEAT — see the header). `sortedIndexes` must be the
		// live sorted view for `values`.
		const topIndexesByRank = (sortedIndexes, values, seats, zeroIsIneligible) => {
			const picked = [];
			for (let position = 0; position < candidateCount && picked.length < seats; position++) {
				const candidateIndex = sortedIndexes[position];
				if (zeroIsIneligible && !(values[candidateIndex] > 0)) {
					break; // the ordering is descending: once a zero appears, every later value is zero too
				}
				picked.push(candidateIndex);
			}
			return picked;
		};

		// seatsFor — the declared seat count for a slot type, or 0 when the policy does not name it.
		const seatsFor = (slotType) => {
			const found = reservations.find((oneReservation) => oneReservation.slotType === slotType);
			return found ? found.seats : 0;
		};

		// scan — THE ONE PASS, plus the ranking and the allocation. Returns the seated pool entries in
		// SLOT-ALLOCATION order (anchors first, then slot priority, then rank within slot).
		//
		// SCRATCH DISCIPLINE, stated because it is load-bearing: rankByDescendingValue returns a VIEW of
		// the ONE shared `sortIndexes` buffer, so each ranking's top-N must be extracted BEFORE the next
		// rankByDescendingValue call clobbers it. The four call pairs below are written adjacently for
		// exactly that reason; separating a sort from its own extraction would silently read the wrong
		// ordering. (The RANK arrays are per-facet and survive; only the sorted-index view is shared.)
		const scan = (sourceElement) => {
			const source = sourceElement || {};
			const sourceVector = source.vector || null;
			const sourceNorm = vectorNormOf(sourceVector);
			const sourceNameTokens = new Set(tokenize(source.name));
			const owningClass = owningClassOf(source, classMap);
			const sourceContextTokens = new Set(tokenize(owningClass.name));
			const anchorId = sourceAnchorId(source);
			const sourceType = sourceTypeCode(source);
			const sourceTier = sourceTierCode(source);
			const vectorLength = sourceVector ? sourceVector.length : 0;

			// ---- THE PASS: six facets, O(1)-ish per pair, zero allocation inside the loop ----
			for (let i = 0; i < candidateCount; i++) {
				// cosine — byte-for-byte semanticMatcher.cosine's own arithmetic (dot / (|a| * |b|)), with
				// both norms hoisted out of the pair loop (bit-identical, see vectorNormOf).
				const candidateVector = candidateVectors[i];
				if (!sourceVector || !candidateVector || sourceNorm === 0 || candidateNorms[i] === 0) {
					cosineValues[i] = -1; // the documented degenerate case: a missing vector never retrieves
				} else {
					let dot = 0;
					for (let d = 0; d < vectorLength; d++) {
						dot += sourceVector[d] * candidateVector[d];
					}
					cosineValues[i] = dot / (sourceNorm * candidateNorms[i]);
				}
				nameOverlapValues[i] = overlapCoefficient(sourceNameTokens, candidateNameTokens[i]);
				contextOverlapValues[i] = overlapCoefficient(sourceContextTokens, candidateContextTokens[i]);
				anchorFlags[i] = anchorId !== '' && candidateAnchorKeySets[i].has(anchorId) ? 1 : 0;
				const candidateType = candidateTypeCodes[i];
				typeFitCodes[i] =
					sourceType === TYPE_UNKNOWN || candidateType === TYPE_UNKNOWN ? 0 : sourceType === candidateType ? 1 : 2;
				tierFlags[i] = sourceTier !== TIER_UNKNOWN && sourceTier === candidateTierCodes[i] ? 1 : 0;
			}

			// ---- RANKING: exact global ranks, so the evidence can say "rank 16 of 29,346" honestly ----
			const cosineSorted = rankByDescendingValue(cosineValues, cosineRanks);
			const cosineTop = topIndexesByRank(cosineSorted, cosineValues, seatsFor(SLOT_COSINE), false);
			const nameSorted = rankByDescendingValue(nameOverlapValues, nameOverlapRanks);
			const nameTop = topIndexesByRank(nameSorted, nameOverlapValues, seatsFor(SLOT_NAME_OVERLAP), true);
			const contextSorted = rankByDescendingValue(contextOverlapValues, contextOverlapRanks);
			const contextTop = topIndexesByRank(contextSorted, contextOverlapValues, seatsFor(SLOT_CONTEXT_OVERLAP), true);

			// combinedRank — a RANK SUM over the three RANKED facets (no weights, no units, nothing to
			// tune). Negated so the shared descending machinery ranks the SMALLEST rank sum first.
			for (let i = 0; i < candidateCount; i++) {
				combinedRankValues[i] = -(cosineRanks[i] + nameOverlapRanks[i] + contextOverlapRanks[i]);
			}
			const combinedSorted = rankByDescendingValue(combinedRankValues, combinedRanks);
			const combinedTop = topIndexesByRank(combinedSorted, combinedRankValues, seatsFor(SLOT_COMBINED_RANK), false);

			// ---- SLOT ALLOCATION (§4.3) ----
			const anchorTop = [];
			for (let i = 0; i < candidateCount; i++) {
				if (anchorFlags[i]) {
					anchorTop.push(i);
				}
			}

			const slotLists = [
				{ slotType: SLOT_ANCHOR_MATCH, indexes: anchorTop, unconditional: true },
				{ slotType: SLOT_COSINE, indexes: cosineTop, unconditional: false },
				{ slotType: SLOT_CONTEXT_OVERLAP, indexes: contextTop, unconditional: false },
				{ slotType: SLOT_NAME_OVERLAP, indexes: nameTop, unconditional: false },
				{ slotType: SLOT_COMBINED_RANK, indexes: combinedTop, unconditional: false },
			];

			// seatedOrder — first-appearance order across the slot lists in PRIORITY order; a candidate
			// appearing in several lists is seated ONCE and records EVERY slot it appeared in (§4.4: no
			// candidate occupies a seat for a reason the judge cannot see).
			const seatedOrder = [];
			const slotTypesByCandidateIndex = new Map();
			slotLists.forEach((oneSlotList) => {
				oneSlotList.indexes.forEach((oneCandidateIndex) => {
					const already = slotTypesByCandidateIndex.get(oneCandidateIndex);
					if (already) {
						already.push(oneSlotList.slotType);
						return;
					}
					slotTypesByCandidateIndex.set(oneCandidateIndex, [oneSlotList.slotType]);
					seatedOrder.push({ candidateIndex: oneCandidateIndex, unconditional: oneSlotList.unconditional });
				});
			});

			// THE CAP — anchors are exempt (author-declared beats inference, §4.3); everything else is
			// admitted in slot-priority order until the cap binds. The count actually dropped is reported
			// so a caller can never mistake a truncated pool for a short one.
			const unconditionalSeats = seatedOrder.filter((oneSeat) => oneSeat.unconditional);
			const conditionalSeats = seatedOrder.filter((oneSeat) => !oneSeat.unconditional);
			const remainingSeats = Math.max(0, poolCap - unconditionalSeats.length);
			const admittedConditional = conditionalSeats.slice(0, remainingSeats);
			const droppedCount = conditionalSeats.length - admittedConditional.length;
			const admitted = seatedOrder.filter(
				(oneSeat) => oneSeat.unconditional || admittedConditional.includes(oneSeat),
			);

			// ---- PROVENANCE (§4.4) — materialized ONLY for the seated candidates ----
			const entries = admitted.map((oneSeat) => {
				const i = oneSeat.candidateIndex;
				const candidate = candidateElements[i];
				const typeFitCode = typeFitCodes[i];
				return {
					candidate,
					cosine: cosineValues[i],
					slots: slotTypesByCandidateIndex.get(i).slice(),
					facets: {
						cosine: { value: cosineValues[i], rank: cosineRanks[i], outOf: candidateCount },
						nameOverlap: {
							value: nameOverlapValues[i],
							rank: nameOverlapRanks[i],
							outOf: candidateCount,
							sharedTokens: sharedTokenList(sourceNameTokens, candidateNameTokens[i]),
						},
						contextOverlap: {
							value: contextOverlapValues[i],
							rank: contextOverlapRanks[i],
							outOf: candidateCount,
							sharedTokens: sharedTokenList(sourceContextTokens, candidateContextTokens[i]),
							sourceContext: owningClass.name,
							candidateContext: candidateDomainText(candidate),
						},
						anchorMatch: {
							value: anchorFlags[i] === 1,
							anchorId: anchorId === '' ? null : anchorId,
						},
						typeFit: {
							value: typeFitCode === 1 ? 'compatible' : typeFitCode === 2 ? 'different' : 'undetermined',
							sourceType: TYPE_CODE_NAMES[sourceType],
							candidateType: TYPE_CODE_NAMES[candidateTypeCodes[i]],
						},
						tierMatch: {
							value: tierFlags[i] === 1,
							sourceTier: TIER_CODE_NAMES[sourceTier],
							candidateTier: TIER_CODE_NAMES[candidateTierCodes[i]],
						},
						combinedRank: {
							value: cosineRanks[i] + nameOverlapRanks[i] + contextOverlapRanks[i],
							rank: combinedRanks[i],
							outOf: candidateCount,
						},
					},
				};
			});

			return { entries, candidateCount, droppedCount };
		};

		return { scan, candidateCount };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });

// exported for the unit test AND for the bridges' own preparation steps (embedText composition, the
// class map) — the ONE authority for each, never reimplemented at a call site.
module.exports.tokenize = tokenize;
module.exports.overlapCoefficient = overlapCoefficient;
module.exports.sharedTokenList = sharedTokenList;
module.exports.composeSourceEmbedText = composeSourceEmbedText;
module.exports.embedTextForSource = embedTextForSource;
module.exports.embedTextForCandidate = embedTextForCandidate;
module.exports.buildClassMap = buildClassMap;
module.exports.candidateDomainText = candidateDomainText;
module.exports.owningClassOf = owningClassOf;
module.exports.stampOwningClass = stampOwningClass;
module.exports.datatypeCode = datatypeCode;
module.exports.sourceTypeCode = sourceTypeCode;
module.exports.candidateTypeCode = candidateTypeCode;
module.exports.sourceTierCode = sourceTierCode;
module.exports.candidateTierCode = candidateTierCode;
module.exports.sourceAnchorId = sourceAnchorId;
module.exports.candidateAnchorKeys = candidateAnchorKeys;
module.exports.vectorNormOf = vectorNormOf;
module.exports.SEGMENT_SEPARATOR = SEGMENT_SEPARATOR;
module.exports.DEFAULT_RESERVATIONS = DEFAULT_RESERVATIONS;
module.exports.POOL_CAP = POOL_CAP;
module.exports.FACET_NAMES = FACET_NAMES;
module.exports.CLASS_ROLE = CLASS_ROLE;
module.exports.TYPE_CODE_NAMES = TYPE_CODE_NAMES;
module.exports.TIER_CODE_NAMES = TIER_CODE_NAMES;
