'use strict';

// normalize.js — CTDL-ASN anchor + stableId normalization (R3, DESIGN §D/§E, DECISIONS §23-R3).
//
// CTDL-ASN (Credential Transparency Description Language — Achievement Standards Network, Credential
// Engine) is a JSON-LD vocabulary. Every term in the source carries a NATIVE URI in `@id`, expressed
// as a CURIE (a compact form, e.g. `ceasn:competencyText`, `asn:EducationalFramework`,
// `evalCat:progression`). CTDL-ASN's identity is therefore URI-bearing (DESIGN §D — the CEDS/URI
// model, NOT the structural path model OpenBadges/SIF use): the stableId IS the term's `@id` CURIE,
// and `stableUriPropertyName = 'uri'`. The CURIEs in the source are globally unique, so they make
// clean, comparable stableIds with no minting required. An empty/blank `@id` is a normalization MISS —
// surfaced (returns { error }), NEVER silently dropped — the caller turns that into a forge-time
// failure so a malformed term cannot pass as data (R3).
//
// CROSS-STANDARD NOTE: CTDL-ASN carries ZERO CEDS anchors (verified against the source blob). Its only
// cross-standard overlap is the 4 `ceterms:*` terms it redefines; those are handled by the parser's
// filter-and-reference crossRef stash (a {system:'ctdl',...} record), NOT by CEDS-anchor
// normalization. The CEDS helpers below are RETAINED-BUT-DORMANT — kept identical to the forge-ctdl
// / forge-ctdlqdata family so the JSON-LD normalize contract stays parallel; they are simply not
// exercised for ASN (no ceds: values exist to normalize).
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// CEDS canonical-id prefixes (mirrors forge-ceds / forge-ctdl normalize). Retained-but-dormant for
// ASN (no CEDS anchors). Kept as a registry (not a switch).
const cedsKindPrefix = {
	optionSet: 'OS',
	optionValue: 'OV',
	element: 'P',
	property: 'P',
	class: 'C',
};

// -----
// extractDigits — pull the numeric core out of a native CEDS anchor form (retained-but-dormant for
//   ASN). Returns the digit string, or null when no digit core is present.
const extractDigits = (rawValue) => {
	if (rawValue == null) {
		return null;
	}
	const asString = `${rawValue}`.trim();
	if (asString === '') {
		return null;
	}
	const matches = asString.match(/(\d+)/);
	if (!matches) {
		return null;
	}
	return matches[1];
};

// -----
// normalizeCedsCrossRef — native CEDS anchor -> canonical CEDS optionSet anchor (OS######). Retained-
//   but-dormant for ASN. Returns { absent: true } for a blank value, { cedsId, fragment } on success,
//   { error } on a non-numeric miss (never silent).
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

// isCanonicalCrossRefCedsId — the clean-form predicate (retained-but-dormant for ASN).
const CANONICAL_CROSSREF_CEDS_ID_RE = /^(OS|OV|P|C)\d{6,}$/;
const isCanonicalCrossRefCedsId = (value) =>
	typeof value === 'string' && CANONICAL_CROSSREF_CEDS_ID_RE.test(value);

// -----
// buildStableId — CTDL-ASN stableId IS the term's native `@id` CURIE. Whatever the input, trim it; an
//   empty/blank result is a MISS. Returns { stableId } on success, { error } on a blank id (R3).
const buildStableId = ({ id } = {}) => {
	const cleaned = id == null ? '' : `${id}`.trim();
	if (cleaned === '') {
		return { error: `buildStableId: empty CTDL-ASN @id` };
	}
	return { stableId: cleaned };
};

// isCleanStableId — the R3 predicate the test asserts against. A clean CTDL-ASN stableId is a non-empty,
//   non-whitespace-padded CURIE of the form `<prefix>:<localName>` (or a full http(s) URI, which the
//   source does not use but is accepted as a clean URI form for robustness).
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
