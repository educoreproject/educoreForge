'use strict';

// normalize.js — PESC anchor + stableId normalization (R3, DESIGN §E, DECISIONS §23-R3).
// Mirrors forge-sif/lib/normalize.js and forge-edfi/lib/normalize.js; adapted for PESC's XSD element
// kinds (the XSD-family trailblazer).
// HISTORICAL CITATION: the forge-edfi mirror target is the PRE-CAMPAIGN CSV-crosswalk forge-edfi,
// removed from HEAD at the round-trip closeout 2026-08-04 (git history holds it); today's
// forge-edfi is a MetaEd reimplementation and carries no normalize.js.
//
// PESC has ONE canonical-form obligation that matters for this standard block:
//
//   1. stableId (PESC's OWN identity). PESC schema elements DO live in versioned XML namespaces, but
//      a namespace URI is per-FILE, not per-type, and the same local type name recurs across files
//      (e.g. PersonType in CoreMain and AcademicRecord). So — exactly as SIF/EdFi did for elements
//      with no clean per-element URI — the PESC stableId is a DETERMINISTIC, source-qualified
//      synthetic key: pesc:<kind>/<source>/<name> (the source-file label disambiguates the recurring
//      local names), with the root as the bare token pesc:root. This value is what edges resolve on
//      (the replay resolutionKey) and what stableUriPropertyName ('pescStableId') points at. An
//      empty/whitespace natural key is a normalization MISS — surfaced, never silently emitted (R3).
//
//   2. cedsCrossRef (a CROSS-reference) — PESC's XSD source carries NO CEDS crosswalk inside the
//      schema files (the OLD forge kept separate bridges/*.json crosswalks, which are a later-phase
//      BRIDGE concern and OUT OF SCOPE for this standard-PURE block). normalizeCedsCrossRef is kept
//      for API parity with the SIF/EdFi normalize modules (P<6-digit> canonicalization) but is unused
//      by the PESC forge — PESC emits no cedsId and no cross-standard edge.
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// -----
// kindTokenByKind — the stableId path token per PESC element kind. Registry, not switch.
const kindTokenByKind = {
	root: 'root',
	complexType: 'class', // -> DmeClass
	field: 'field', // -> DmeProperty (xs:element / xs:attribute)
	optionSet: 'optionSet', // -> DmeOptionSet (enum simpleType)
	optionValue: 'optionValue', // -> DmeOptionValue
	support: 'support', // -> DmeSupport (non-enum simpleType / group)
};

// -----
// buildStableId — { kind, key } -> { stableId } (pesc:<token>/<key>; root is the bare token), or
//   { error } on an unknown kind or an empty/whitespace key. Deterministic; same input -> same id.
const buildStableId = ({ kind, key } = {}) => {
	const token = kindTokenByKind[kind];
	if (!token) {
		return {
			error: `buildStableId: unknown PESC element kind '${kind}' (expected one of ${Object.keys(
				kindTokenByKind,
			).join(', ')})`,
		};
	}
	if (kind === 'root') {
		return { stableId: 'pesc:root' };
	}
	const cleanKey = key == null ? '' : `${key}`.trim();
	if (cleanKey === '') {
		return { error: `buildStableId: empty natural key for PESC kind '${kind}'` };
	}
	return { stableId: `pesc:${token}/${cleanKey}` };
};

// -----
// isCleanStableId — the R3 predicate the test asserts against. A clean PESC stableId is a non-empty,
//   non-whitespace-padded string of the form pesc:<token>[/<non-empty remainder>]. The remainder may
//   contain slashes (source/name) and other punctuation in enumeration values, so only the prefix
//   shape is constrained.
const PESC_STABLE_ID_RE = /^pesc:[A-Za-z]+(\/.+)?$/;
const isCleanStableId = (value) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value === value.trim() &&
	PESC_STABLE_ID_RE.test(value);

// -----
// extractDigits — pull the numeric core out of a CEDS-ID-style annotation (kept for API parity).
const extractDigits = (rawValue) => {
	if (rawValue == null) {
		return null;
	}
	const asString = `${rawValue}`.trim();
	if (asString === '') {
		return null;
	}
	const matches = asString.match(/(\d+)(?!.*\d)/);
	if (!matches) {
		return null;
	}
	return matches[1];
};

// -----
// normalizeCedsCrossRef — canonical CEDS *property* anchor (P######). Kept for API parity with the
//   SIF/EdFi normalize modules; PESC's XSD source carries no CEDS crosswalk so this is unused.
const CEDS_PROPERTY_PREFIX = 'P';
const normalizeCedsCrossRef = ({ rawValue } = {}) => {
	const digits = extractDigits(rawValue);
	if (digits === null) {
		return {
			error: `normalizeCedsCrossRef: could not extract a numeric CEDS anchor from '${rawValue}'`,
		};
	}
	return { cedsId: `${CEDS_PROPERTY_PREFIX}${digits.padStart(6, '0')}` };
};

// -----
const CANONICAL_CROSSREF_CEDS_ID_RE = /^P\d{6,}$/;
const isCanonicalCrossRefCedsId = (value) =>
	typeof value === 'string' && CANONICAL_CROSSREF_CEDS_ID_RE.test(value);

module.exports = {
	kindTokenByKind,
	buildStableId,
	isCleanStableId,
	extractDigits,
	normalizeCedsCrossRef,
	isCanonicalCrossRefCedsId,
	PESC_STABLE_ID_RE,
	CANONICAL_CROSSREF_CEDS_ID_RE,
};
