'use strict';

// normalize.js — SIF anchor + stableId normalization (R3, DESIGN §E, DECISIONS §23-R3).
//
// SIF has TWO distinct canonical-form obligations, kept separate on purpose:
//
//   1. stableId (SIF's OWN identity). SIF schema elements have no native URI, and SIF RefId is an
//      instance-identity field, not a schema-element key. So the stableId is a DETERMINISTIC,
//      path-based synthetic key (proposed + confirmed with STEEL_WHEEL): sif:<kind>/<naturalKey>,
//      with the root as the bare token sif:root. This value is what edges resolve on (the replay
//      resolutionKey) and what stableUriPropertyName ('sifStableId') points at. An empty/whitespace
//      natural key is a normalization MISS — surfaced, never silently emitted (R3).
//
//   2. cedsId (a CROSS-reference, present only on annotated fields). The SIF 'CEDS ID' column is a
//      bare digit string; it annotates a SIF field -> CEDS *property* mapping. We canonicalize it to
//      the SAME canonical form CEDS itself emits for a property (P<6-digit zero-padded>) so the
//      GENERIC -specified bridge resolves SIF.cedsId == CedsProperty.cedsId with no per-standard
//      code. A non-numeric annotation (e.g. a stray header artifact) is a MISS -> { error }, counted
//      by the caller and kept OUT of the resolver, never silently treated as data (R3).
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// -----
// kindTokenByKind — the stableId path token per SIF element kind. Registry, not switch.
const kindTokenByKind = {
	root: 'root',
	object: 'object',
	complexType: 'complexType',
	field: 'field',
	codeset: 'codeset',
	optionValue: 'optionValue',
	simpleType: 'simpleType',
	primitiveType: 'primitiveType',
	xmlElement: 'element',
};

// -----
// buildStableId — { kind, key } -> { stableId } (sif:<token>/<key>; root is the bare token), or
//   { error } on an unknown kind or an empty/whitespace key. Deterministic; same input -> same id.
const buildStableId = ({ kind, key } = {}) => {
	const token = kindTokenByKind[kind];
	if (!token) {
		return {
			error: `buildStableId: unknown SIF element kind '${kind}' (expected one of ${Object.keys(
				kindTokenByKind,
			).join(', ')})`,
		};
	}
	if (kind === 'root') {
		return { stableId: 'sif:root' };
	}
	const cleanKey = key == null ? '' : `${key}`.trim();
	if (cleanKey === '') {
		return { error: `buildStableId: empty natural key for SIF kind '${kind}'` };
	}
	return { stableId: `sif:${token}/${cleanKey}` };
};

// -----
// isCleanStableId — the R3 predicate the test asserts against. A clean SIF stableId is a non-empty,
//   non-whitespace-padded string of the form sif:<token>[/<non-empty remainder>]. The remainder may
//   contain slashes (an xpath) and spaces (an option value), so only the prefix shape is constrained.
const SIF_STABLE_ID_RE = /^sif:[A-Za-z]+(\/.+)?$/;
const isCleanStableId = (value) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value === value.trim() &&
	SIF_STABLE_ID_RE.test(value);

// -----
// extractDigits — pull the numeric core out of a native SIF CEDS-ID annotation (a bare digit run,
//   possibly zero-padded). Returns the digit string, or null when no digit core is present.
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
// normalizeCedsCrossRef — native SIF 'CEDS ID' value -> canonical CEDS *property* anchor (P######).
//   SIF annotations point at CEDS elements that the forge maps to CedsProperty, mirroring trackA's
//   'P' + cedsId rule. Returns { cedsId } on success, { error } on a miss (never silent).
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
// isCanonicalCrossRefCedsId — the clean-form predicate the R3 test asserts the cross-ref against.
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
	SIF_STABLE_ID_RE,
	CANONICAL_CROSSREF_CEDS_ID_RE,
};
