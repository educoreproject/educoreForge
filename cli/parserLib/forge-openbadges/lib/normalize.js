'use strict';

// normalize.js — OpenBadges anchor + stableId normalization (R3, DESIGN §D/§E, DECISIONS §23-R3).
//
// OpenBadges 3.0 (1EdTech) is an OpenAPI 3.0 JSON schema (JSON-LD aligned to the W3C Verifiable
// Credentials data model) with NO native per-element URI: its identity is STRUCTURAL (DESIGN §D
// case 3 "the standard's identity is structural: name the structural-path property"), exactly like
// CASE's casePath, LIF's lifPath and SIF's sifStableId. OpenBadges' stableUriPropertyName is
// therefore 'openbadgesPath' — a clean, deterministic dotted structural locator the forge mints
// from the schema shape (root / class / class.property / class.property.optionSet /
// class.property.option.value).
//
// OpenBadges' potential cross-reference to CEDS would be a CEDS element URL embedded in a property's
// description prose (harvested by the parser as cedsGlobalIds — bare numeric element ids from
// `ceds.ed.gov/element/NNN`). CEDS *elements* are CEDS PROPERTIES, so an OpenBadges crossRef
// normalizes to a canonical CEDS property anchor 'P<6-digit>' (DESIGN §E "CEDS always P000113/
// C000113"), identical to CASE's / LIF's / SIF's CEDS normalization. A normalization MISS is
// surfaced (returns { error }), NEVER silently dropped — the caller turns that into a forge-time
// failure so a missed mapping cannot pass as data (R3). (THIS source carries 0 CEDS element URLs —
// the harvest + R3 paths are present and unit-tested regardless; see the bundle's test.)
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// CEDS canonical-id prefixes (mirrors forge-case / forge-lif / forge-ceds normalize). An OpenBadges→
// CEDS reference is to a CEDS element, which is a CEDS property -> 'P'. Kept as a registry (not a
// switch) so a value-level option crossRef ('OV') could be added without restructuring.
const cedsKindPrefix = {
	element: 'P',
	property: 'P',
	class: 'C',
	optionSet: 'OS',
	optionValue: 'OV',
};

// extractDigits — pull the numeric core out of any native CEDS anchor form.
//   Accepts: a CEDS element URL ending in digits, a bare number, an already-padded id, or a
//   `P000021`/`C000021` form. Returns the digit string, or null when no digit core is present.
const extractDigits = (rawValue) => {
	if (rawValue == null) {
		return null;
	}
	const asString = `${rawValue}`.trim();
	if (asString === '') {
		return null;
	}
	// Take the LAST run of digits (a URL's terminal element id; a prefix form's numeric tail).
	const matches = asString.match(/(\d+)(?!.*\d)/);
	if (!matches) {
		return null;
	}
	return matches[1];
};

// normalizeCedsId — native CEDS anchor form -> canonical cedsId for the given CEDS kind.
//   Returns { cedsId } on success, { error } on a normalization miss (never silent).
const normalizeCedsId = ({ rawValue, kind = 'element' } = {}) => {
	const prefix = cedsKindPrefix[kind];
	if (!prefix) {
		return {
			error: `normalizeCedsId: unknown CEDS kind '${kind}' (expected one of ${Object.keys(cedsKindPrefix).join(', ')})`,
		};
	}

	const digits = extractDigits(rawValue);
	if (digits === null) {
		return {
			error: `normalizeCedsId: could not extract a numeric anchor from '${rawValue}' for kind '${kind}'`,
		};
	}

	const padded = digits.padStart(6, '0');
	return { cedsId: `${prefix}${padded}` };
};

// isCanonicalCedsId — the clean-form predicate the R3 test asserts against (identical to CEDS/CASE/LIF).
const CANONICAL_CEDS_ID_RE = /^(C|P|OS|OV)\d{6,}$/;
const isCanonicalCedsId = (value) =>
	typeof value === 'string' && CANONICAL_CEDS_ID_RE.test(value);

// -----
// OpenBadges stableId (openbadgesPath) construction + clean-form predicate.
//
// An OpenBadges stableId is a dotted structural locator under the standard key. Whatever odd
// characters a schema class / property / enum value name carries, the emitted segment is reduced to
// a clean token ([A-Za-z0-9_-]) so the path is a stable, comparable identifier. Empty input is a miss.

const cleanSegment = (rawValue) => {
	if (rawValue == null) {
		return null;
	}
	const token = `${rawValue}`.trim().replace(/[^A-Za-z0-9_-]/g, '_');
	return token === '' ? null : token;
};

// buildOpenbadgesPath — assemble a clean dotted openbadgesPath from ordered raw segments.
//   Returns { openbadgesPath } on success, { error } when no usable segment survives cleaning.
const OPENBADGES_PATH_PREFIX = 'openbadges';
const buildOpenbadgesPath = (segments = []) => {
	const cleaned = (Array.isArray(segments) ? segments : [segments])
		.map(cleanSegment)
		.filter((one) => one != null);
	if (cleaned.length === 0) {
		return {
			error: `buildOpenbadgesPath: no usable path segment from [${JSON.stringify(segments)}]`,
		};
	}
	return { openbadgesPath: `${OPENBADGES_PATH_PREFIX}:${cleaned.join('.')}` };
};

// isCleanStableId — an OpenBadges stableId is a clean dotted openbadgesPath (the structural identity,
// DESIGN §D case 3). No URI scheme — OpenBadges has none at the element level; identity is the
// structural locator.
const OPENBADGES_PATH_RE = /^openbadges:[A-Za-z0-9_.-]+$/;
const isCleanStableId = (value) => typeof value === 'string' && OPENBADGES_PATH_RE.test(value);

module.exports = {
	cedsKindPrefix,
	extractDigits,
	normalizeCedsId,
	isCanonicalCedsId,
	buildOpenbadgesPath,
	isCleanStableId,
	CANONICAL_CEDS_ID_RE,
	OPENBADGES_PATH_RE,
	OPENBADGES_PATH_PREFIX,
};
