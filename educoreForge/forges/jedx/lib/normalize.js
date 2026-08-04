'use strict';

// normalize.js — JEDx anchor + stableId normalization (R3). Mirrors forge-edfi/lib/normalize.js,
// adapted for JEDx's CSV element kinds (entity/field/codeset). JEDx code sets have no enumerated
// values in the source, so there is no descriptorValue kind here.
// HISTORICAL CITATION: that mirror target is the PRE-CAMPAIGN CSV-crosswalk forge-edfi, removed
// from HEAD at the round-trip closeout 2026-08-04 (git history holds it); today's forge-edfi is a
// MetaEd reimplementation and carries no normalize.js.
//
// JEDx stableId (its OWN identity): JEDx CSV elements have no native URI we forge against, so the
// stableId is a DETERMINISTIC, path-based synthetic key (mirrors EdFi/SIF): jedx:<kind>/<naturalKey>,
// with the root the bare token jedx:root. This value is what edges resolve on (the replay
// resolutionKey) and what stableUriPropertyName ('jedxStableId') points at. An empty/whitespace
// natural key is a normalization MISS — surfaced, never silently emitted (R3).
//
// JEDx carries NO CEDS-crosswalk columns, so it stashes NO cross-references and emits NO
// cross-standard edges (the block is naturally CEDS-pure). normalizeCedsCrossRef + the canonical
// cross-ref predicate are KEPT for parity with the shared normalize contract and the R3 unit test,
// but are not exercised by real JEDx data.
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// -----
// kindTokenByKind — the stableId path token per JEDx element kind. Registry, not switch.
const kindTokenByKind = {
	root: 'root',
	entity: 'entity', // -> DmeClass
	field: 'field', // -> DmeProperty
	codeset: 'codeset', // -> DmeOptionSet
};

// -----
// buildStableId — { kind, key } -> { stableId } (jedx:<token>/<key>; root is the bare token), or
//   { error } on an unknown kind or an empty/whitespace key. Deterministic; same input -> same id.
const buildStableId = ({ kind, key } = {}) => {
	const token = kindTokenByKind[kind];
	if (!token) {
		return {
			error: `buildStableId: unknown JEDx element kind '${kind}' (expected one of ${Object.keys(
				kindTokenByKind,
			).join(', ')})`,
		};
	}
	if (kind === 'root') {
		return { stableId: 'jedx:root' };
	}
	const cleanKey = key == null ? '' : `${key}`.trim();
	if (cleanKey === '') {
		return { error: `buildStableId: empty natural key for JEDx kind '${kind}'` };
	}
	return { stableId: `jedx:${token}/${cleanKey}` };
};

// -----
// isCleanStableId — the R3 predicate the test asserts against. A clean JEDx stableId is a non-empty,
//   non-whitespace-padded string of the form jedx:<token>[/<non-empty remainder>]. The remainder may
//   contain slashes (an entity path), dots (entity.field), and URLs/spaces (a raw code-set key), so
//   only the prefix shape is constrained.
const JEDX_STABLE_ID_RE = /^jedx:[A-Za-z]+(\/.+)?$/;
const isCleanStableId = (value) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value === value.trim() &&
	JEDX_STABLE_ID_RE.test(value);

// -----
// CEDS_NO_MAPPING_SENTINEL — the "no CEDS mapping" placeholder. Treated as ABSENT, NOT a miss. Kept
//   for parity with the shared normalize contract (JEDx data does not carry CEDS columns).
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
// normalizeCedsCrossRef — kept for parity; canonicalizes a CEDS property anchor to P######. JEDx
//   does not carry CEDS columns, so this is unused by real data but asserted by the R3 unit test.
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
	JEDX_STABLE_ID_RE,
	CANONICAL_CROSSREF_CEDS_ID_RE,
};
