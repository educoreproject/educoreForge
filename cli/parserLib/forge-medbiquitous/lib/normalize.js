'use strict';

// normalize.js — MedBiquitous anchor + stableId normalization (R3). Mirrors forge-pesc/lib/normalize.js
// (the XSD-family trailblazer), adapted for MedBiquitous.
//
// MedBiquitous has ONE canonical-form obligation that matters for this standard block:
//
//   1. stableId (MedBiquitous's OWN identity). MedBiquitous schema types live in versioned XML
//      namespace URIs, but a URI is per-FILE not per-type and the same local type name recurs across
//      files/standards (e.g. an AddressType in the shared substrate AND a content standard). So —
//      exactly as PESC/SIF/EdFi did — the stableId is a DETERMINISTIC, source-qualified synthetic key:
//      medbiq:<kind>/<source>/<name>, where <source> is the directory-qualified relative path of the
//      defining file (without extension), e.g. medbiq:class/activityReport/v2/activityreport/HeaderType.
//      The root is the bare token medbiq:root. This value is what edges resolve on (the replay
//      resolutionKey) and what stableUriPropertyName ('medbiquitousStableId') points at. An
//      empty/whitespace natural key is a normalization MISS — surfaced, never silently emitted (R3).
//
//   2. cedsCrossRef — MedBiquitous's XSD/WSDL source carries NO CEDS crosswalk inside the schema files
//      (the OLD forge kept cross-walks in a separate crosswalk-engine, a later-phase BRIDGE concern,
//      OUT OF SCOPE for this standard-PURE block). normalizeCedsCrossRef is kept for API parity with the
//      PESC/SIF/EdFi normalize modules but is UNUSED — MedBiquitous emits no cedsId and no
//      cross-standard edge.
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

const kindTokenByKind = {
	root: 'root',
	complexType: 'class', // -> DmeClass
	field: 'field', // -> DmeProperty (xs:element / xs:attribute)
	optionSet: 'optionSet', // -> DmeOptionSet (enum simpleType)
	optionValue: 'optionValue', // -> DmeOptionValue
	support: 'support', // -> DmeSupport (non-enum simpleType / group / attributeGroup / WSDL construct)
};

// buildStableId — { kind, key } -> { stableId } (medbiq:<token>/<key>; root is the bare token), or
//   { error } on an unknown kind or an empty/whitespace key. Deterministic.
const buildStableId = ({ kind, key } = {}) => {
	const token = kindTokenByKind[kind];
	if (!token) {
		return {
			error: `buildStableId: unknown MedBiquitous element kind '${kind}' (expected one of ${Object.keys(
				kindTokenByKind,
			).join(', ')})`,
		};
	}
	if (kind === 'root') {
		return { stableId: 'medbiq:root' };
	}
	const cleanKey = key == null ? '' : `${key}`.trim();
	if (cleanKey === '') {
		return { error: `buildStableId: empty natural key for MedBiquitous kind '${kind}'` };
	}
	return { stableId: `medbiq:${token}/${cleanKey}` };
};

// isCleanStableId — the R3 predicate the test asserts against.
const MEDBIQ_STABLE_ID_RE = /^medbiq:[A-Za-z]+(\/.+)?$/;
const isCleanStableId = (value) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value === value.trim() &&
	MEDBIQ_STABLE_ID_RE.test(value);

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

// normalizeCedsCrossRef — kept for API parity with PESC/SIF/EdFi; UNUSED by MedBiquitous.
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
	MEDBIQ_STABLE_ID_RE,
	CANONICAL_CROSSREF_CEDS_ID_RE,
};
