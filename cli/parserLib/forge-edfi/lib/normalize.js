'use strict';

// normalize.js — EdFi anchor + stableId normalization (R3, DESIGN §E, DECISIONS §23-R3).
// Mirrors forge-sif/lib/normalize.js; adapted for EdFi's CSV-crosswalk element kinds.
//
// EdFi has TWO distinct canonical-form obligations, kept separate on purpose:
//
//   1. stableId (EdFi's OWN identity). Ed-Fi crosswalk CSV elements have no native URI we forge
//      against, so the stableId is a DETERMINISTIC, path-based synthetic key (mirrors SIF's
//      sif:<kind>/<naturalKey> ruling): edfi:<kind>/<naturalKey>, with the root as the bare token
//      edfi:root. This value is what edges resolve on (the replay resolutionKey) and what
//      stableUriPropertyName ('edfiStableId') points at. An empty/whitespace natural key is a
//      normalization MISS — surfaced, never silently emitted (R3).
//
//   2. cedsGlobalId / cedsOptionCode (CROSS-references — BRIDGE data for a later phase). The EdFi
//      crosswalk columns carry a target CEDS element global-id (a bare 6-digit string) on a field,
//      and a target CEDS option code on a descriptor value. We canonicalize the global-id to the
//      SAME canonical form CEDS itself emits for a property (P<6-digit zero-padded>), STASHED as a
//      node property + crossRefs JSON for the later bridge — this standard block emits NO
//      cross-standard edges. A non-numeric global-id is a MISS -> { error }, counted by the caller
//      and kept OUT of the resolver, never silently treated as data (R3). The placeholder '000000'
//      (old parser's "no mapping" sentinel) is treated as ABSENT, not a miss.
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// -----
// kindTokenByKind — the stableId path token per EdFi element kind. Registry, not switch.
const kindTokenByKind = {
	root: 'root',
	entity: 'entity', // -> DmeClass
	field: 'field', // -> DmeProperty
	descriptor: 'descriptor', // -> DmeOptionSet
	descriptorValue: 'value', // -> DmeOptionValue
};

// -----
// buildStableId — { kind, key } -> { stableId } (edfi:<token>/<key>; root is the bare token), or
//   { error } on an unknown kind or an empty/whitespace key. Deterministic; same input -> same id.
const buildStableId = ({ kind, key } = {}) => {
	const token = kindTokenByKind[kind];
	if (!token) {
		return {
			error: `buildStableId: unknown EdFi element kind '${kind}' (expected one of ${Object.keys(
				kindTokenByKind,
			).join(', ')})`,
		};
	}
	if (kind === 'root') {
		return { stableId: 'edfi:root' };
	}
	const cleanKey = key == null ? '' : `${key}`.trim();
	if (cleanKey === '') {
		return { error: `buildStableId: empty natural key for EdFi kind '${kind}'` };
	}
	return { stableId: `edfi:${token}/${cleanKey}` };
};

// -----
// isCleanStableId — the R3 predicate the test asserts against. A clean EdFi stableId is a non-empty,
//   non-whitespace-padded string of the form edfi:<token>[/<non-empty remainder>]. The remainder may
//   contain slashes (an entity path) and dots (entity.field), so only the prefix shape is constrained.
const EDFI_STABLE_ID_RE = /^edfi:[A-Za-z]+(\/.+)?$/;
const isCleanStableId = (value) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value === value.trim() &&
	EDFI_STABLE_ID_RE.test(value);

// -----
// CEDS_NO_MAPPING_SENTINEL — the old parser's "no CEDS mapping" placeholder. Treated as ABSENT
//   (no cross-ref), NOT a normalization miss.
const CEDS_NO_MAPPING_SENTINEL = '000000';

// -----
// extractDigits — pull the numeric core out of a native CEDS global-id annotation (a bare digit run,
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
// normalizeCedsCrossRef — native EdFi CEDSGlobalId value -> canonical CEDS *property* anchor
//   (P######). Mirrors the SIF rule (and the old EdFi 'P'+id bridge convention) so the GENERIC
//   -specified bridge can resolve EdFi.cedsId == CedsProperty.cedsId in a LATER phase with no
//   per-standard code. Returns { absent: true } for the no-mapping sentinel, { cedsId } on success,
//   { error } on a non-numeric miss (never silent).
const CEDS_PROPERTY_PREFIX = 'P';
const normalizeCedsCrossRef = ({ rawValue } = {}) => {
	const trimmed = rawValue == null ? '' : `${rawValue}`.trim();
	if (trimmed === '' || trimmed === CEDS_NO_MAPPING_SENTINEL) {
		return { absent: true };
	}
	const digits = extractDigits(trimmed);
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
	CEDS_NO_MAPPING_SENTINEL,
	EDFI_STABLE_ID_RE,
	CANONICAL_CROSSREF_CEDS_ID_RE,
};
