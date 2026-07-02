'use strict';

// normalize.js — CTDL anchor + stableId normalization (R3, DESIGN §D/§E, DECISIONS §23-R3).
//
// CTDL (Credential Transparency Description Language, Credential Engine) is a JSON-LD vocabulary.
// Every term in the source carries a NATIVE URI in `@id`, expressed as a CURIE (a compact form,
// e.g. `ceterms:AcademicCertificate`, `ceasn:abilityEmbodied`, `accommodation:AccessibleHousing`).
// CTDL's identity is therefore URI-bearing (DESIGN §D — the CEDS/URI model, NOT the structural
// path model OpenBadges/SIF use): the stableId IS the term's `@id` CURIE, and
// `stableUriPropertyName = 'uri'`. The CURIEs in the source are globally unique (1013 distinct
// across classes/properties/concept-schemes/concepts), so they make clean, comparable stableIds
// with no minting required. An empty/blank `@id` is a normalization MISS — surfaced (returns
// { error }), NEVER silently dropped — the caller turns that into a forge-time failure so a
// malformed term cannot pass as data (R3).
//
// CTDL's only native cross-reference to CEDS is a CEDS element/option anchor embedded in a
// skos:Concept's `owl:equivalentClass` (e.g. `ceds:000113#Assistantships` — a CEDS optionSet id
// with an option fragment). CEDS option-set/value anchors normalize to a canonical CEDS optionSet
// anchor 'OS<6-digit>' (DESIGN §E "CEDS always P000113 / C000113 / OS / OV"). A normalization MISS
// is surfaced (never silent). NOTE: these are BRIDGE data for a LATER phase — stashed as a node
// property + crossRefs JSON; this STANDARD-PURE block emits NO cross-standard edge.
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// CEDS canonical-id prefixes (mirrors forge-ceds / forge-openbadges normalize). A CTDL concept's
// CEDS equivalent points at a CEDS option-set/element. Kept as a registry (not a switch).
const cedsKindPrefix = {
	optionSet: 'OS',
	optionValue: 'OV',
	element: 'P',
	property: 'P',
	class: 'C',
};

// -----
// extractDigits — pull the numeric core out of a native CEDS anchor form. The CTDL CEDS anchor is
//   `ceds:000113#Assistantships` (prefix : zero-padded-id # option-fragment). We take the FIRST run
//   of digits (the element id before the fragment), since the fragment may itself contain digits.
//   Returns the digit string, or null when no digit core is present.
const extractDigits = (rawValue) => {
	if (rawValue == null) {
		return null;
	}
	const asString = `${rawValue}`.trim();
	if (asString === '') {
		return null;
	}
	// CTDL form is `ceds:<digits>#fragment` — the element id is the FIRST digit run.
	const matches = asString.match(/(\d+)/);
	if (!matches) {
		return null;
	}
	return matches[1];
};

// -----
// normalizeCedsCrossRef — native CTDL CEDS anchor (owl:equivalentClass value) -> canonical CEDS
//   optionSet anchor (OS######). Returns { absent: true } for a blank value, { cedsId, fragment }
//   on success, { error } on a non-numeric miss (never silent). The option fragment after '#' (if
//   any) is returned separately so the caller can stash the full raw anchor.
const normalizeCedsCrossRef = ({ rawValue, kind = 'optionSet' } = {}) => {
	const trimmed = rawValue == null ? '' : `${rawValue}`.trim();
	if (trimmed === '') {
		return { absent: true };
	}
	const prefix = cedsKindPrefix[kind];
	if (!prefix) {
		return {
			error: `normalizeCedsCrossRef: unknown CEDS kind '${kind}' (expected one of ${Object.keys(
				cedsKindPrefix,
			).join(', ')})`,
		};
	}
	const digits = extractDigits(trimmed);
	if (digits === null) {
		return {
			error: `normalizeCedsCrossRef: could not extract a numeric CEDS anchor from '${rawValue}'`,
		};
	}
	const hashIndex = trimmed.indexOf('#');
	const fragment = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : '';
	return { cedsId: `${prefix}${digits.padStart(6, '0')}`, fragment };
};

// isCanonicalCrossRefCedsId — the clean-form predicate the R3 test asserts the cross-ref against.
const CANONICAL_CROSSREF_CEDS_ID_RE = /^(OS|OV|P|C)\d{6,}$/;
const isCanonicalCrossRefCedsId = (value) =>
	typeof value === 'string' && CANONICAL_CROSSREF_CEDS_ID_RE.test(value);

// -----
// cleanStableId — CTDL stableId IS the term's native `@id` CURIE. Whatever the input, trim it; an
//   empty/blank result is a MISS. Returns { stableId } on success, { error } on a blank id (R3).
const buildStableId = ({ id } = {}) => {
	const cleaned = id == null ? '' : `${id}`.trim();
	if (cleaned === '') {
		return { error: `buildStableId: empty CTDL @id` };
	}
	return { stableId: cleaned };
};

// isCleanStableId — the R3 predicate the test asserts against. A clean CTDL stableId is a non-empty,
//   non-whitespace-padded CURIE of the form `<prefix>:<localName>` (or a full http(s) URI, which the
//   CTDL source does not use but is accepted as a clean URI form for robustness).
const CTDL_CURIE_RE = /^[A-Za-z][A-Za-z0-9_-]*:[^\s]+$/;
const CTDL_HTTP_RE = /^https?:\/\/\S+$/;
const isCleanStableId = (value) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value === value.trim() &&
	(CTDL_HTTP_RE.test(value) || CTDL_CURIE_RE.test(value));

module.exports = {
	cedsKindPrefix,
	extractDigits,
	normalizeCedsCrossRef,
	isCanonicalCrossRefCedsId,
	buildStableId,
	isCleanStableId,
	CANONICAL_CROSSREF_CEDS_ID_RE,
	CTDL_CURIE_RE,
	CTDL_HTTP_RE,
};
