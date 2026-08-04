'use strict';

// normalize.js — SEDM anchor + stableId normalization (R3). Mirrors forge-edfi/lib/normalize.js;
// adapted for SEDM's CEDS-Map element kinds + domain-structures kinds.
// HISTORICAL CITATION: that mirror target is the PRE-CAMPAIGN CSV-crosswalk forge-edfi, removed
// from HEAD at the round-trip closeout 2026-08-04 (git history holds it); today's forge-edfi is a
// MetaEd reimplementation and carries no normalize.js.
//
// SEDM has TWO distinct canonical-form obligations, kept separate on purpose:
//
//   1. stableId (SEDM's OWN identity). SEDM CEDS-Map elements + domain-structure constructs have no
//      single native URI we forge against, so the stableId is a DETERMINISTIC, path-based synthetic
//      key (mirrors EdFi's sedm:<kind>/<naturalKey> ruling): sedm:<token>/<naturalKey>, with the
//      root as the bare token sedm:root. This value is what edges resolve on (the replay
//      resolutionKey) and what stableUriPropertyName ('sedmStableId') points at. An empty/whitespace
//      natural key is a normalization MISS — surfaced, never silently emitted (R3).
//
//   2. cedsGlobalId (CROSS-reference — BRIDGE data for a later phase). The SEDM CEDS-Map carries a
//      target CEDS element Global ID (a bare 6-digit string) on an element. We canonicalize it to the
//      SAME canonical form CEDS itself emits for a property (P<6-digit zero-padded>), STASHED as a
//      node property (cedsId) + crossRefs JSON for the later bridge — this standard block emits NO
//      cross-standard edges. A non-numeric Global ID is a MISS -> { error }, counted by the caller and
//      kept OUT of the resolver, never silently treated as data (R3). The placeholders '000000' and
//      'Proposed' (SEDM's "no CEDS mapping" sentinels) are treated as ABSENT, not a miss.
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// -----
// kindTokenByKind — the stableId path token per SEDM element kind. Registry, not switch.
//   class      -> DmeClass       (ontology classes + compliance categories — SEDM's organizing classes)
//   element    -> DmeProperty    (the annotated CEDS data elements/fields)
//   optionSet  -> DmeOptionSet   (inline element option sets + declared option sets)
//   optionValue-> DmeOptionValue
//   support    -> DmeSupport     (indicators, milestones, IEP components, ETL templates, use cases)
const kindTokenByKind = {
	root: 'root',
	class: 'class', // -> DmeClass
	element: 'element', // -> DmeProperty
	optionSet: 'optionSet', // -> DmeOptionSet
	optionValue: 'value', // -> DmeOptionValue
	support: 'support', // -> DmeSupport
};

// -----
// buildStableId — { kind, key } -> { stableId } (sedm:<token>/<key>; root is the bare token), or
//   { error } on an unknown kind or an empty/whitespace key. Deterministic; same input -> same id.
const buildStableId = ({ kind, key } = {}) => {
	const token = kindTokenByKind[kind];
	if (!token) {
		return {
			error: `buildStableId: unknown SEDM element kind '${kind}' (expected one of ${Object.keys(
				kindTokenByKind,
			).join(', ')})`,
		};
	}
	if (kind === 'root') {
		return { stableId: 'sedm:root' };
	}
	const cleanKey = key == null ? '' : `${key}`.trim();
	if (cleanKey === '') {
		return { error: `buildStableId: empty natural key for SEDM kind '${kind}'` };
	}
	return { stableId: `sedm:${token}/${cleanKey}` };
};

// -----
// isCleanStableId — the R3 predicate the test asserts against. A clean SEDM stableId is a non-empty,
//   non-whitespace-padded string of the form sedm:<token>[/<non-empty remainder>]. The remainder may
//   contain slashes, dots and dashes (entity.element keys, codes), so only the prefix shape is fixed.
const SEDM_STABLE_ID_RE = /^sedm:[A-Za-z]+(\/.+)?$/;
const isCleanStableId = (value) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value === value.trim() &&
	SEDM_STABLE_ID_RE.test(value);

// -----
// CEDS_NO_MAPPING_SENTINELS — SEDM's "no CEDS mapping" placeholders. Treated as ABSENT (no
//   cross-ref), NOT a normalization miss.
const CEDS_NO_MAPPING_SENTINELS = ['000000', 'Proposed'];

// -----
// keyToken — collapse an arbitrary natural-key string to a stable, slug-safe token. Keeps letters,
//   digits and a few path separators; collapses whitespace runs to single dashes. Deterministic.
const keyToken = (value) => {
	if (value == null) {
		return '';
	}
	return `${value}`
		.trim()
		.replace(/\s+/g, '-')
		.replace(/[^A-Za-z0-9._/-]/g, '');
};

// -----
// extractDigits — pull the numeric core out of a native CEDS Global ID annotation (a bare digit run,
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
// normalizeCedsCrossRef — native SEDM CEDS Global ID value -> canonical CEDS *property* anchor
//   (P######). Mirrors the EdFi rule so the GENERIC -specified bridge can resolve SEDM.cedsId ==
//   CedsProperty.cedsId in a LATER phase with no per-standard code. Returns { absent: true } for the
//   no-mapping sentinels, { cedsId } on success, { error } on a non-numeric miss (never silent).
const CEDS_PROPERTY_PREFIX = 'P';
const normalizeCedsCrossRef = ({ rawValue } = {}) => {
	const trimmed = rawValue == null ? '' : `${rawValue}`.trim();
	if (trimmed === '' || CEDS_NO_MAPPING_SENTINELS.includes(trimmed)) {
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
	keyToken,
	extractDigits,
	normalizeCedsCrossRef,
	isCanonicalCrossRefCedsId,
	CEDS_NO_MAPPING_SENTINELS,
	SEDM_STABLE_ID_RE,
	CANONICAL_CROSSREF_CEDS_ID_RE,
};
