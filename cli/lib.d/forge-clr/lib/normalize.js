'use strict';

// normalize.js — CLR anchor + stableId normalization (R3, DESIGN §D/§E, DECISIONS §23-R3).
//
// CLR (Comprehensive Learner Record) is an IMS Global / 1EdTech OpenAPI 3.0 JSON schema with NO
// native per-element URI: its identity is STRUCTURAL (DESIGN §D case 3 "the standard's identity is
// structural: name the structural-path property"), exactly like CASE's casePath and LIF's lifPath.
// CLR's stableUriPropertyName is therefore 'clrPath' — a clean, deterministic dotted structural
// locator the forge mints from the schema shape (root / class / class.property /
// class.property.optionSet / class.property.option.value).
//
// CLR's NATIVE cross-reference to CEDS, when present, is the CEDS element URL embedded in a
// property's description prose (harvested by the parser as cedsGlobalIds — bare numeric element ids
// from `ceds.ed.gov/element/NNN`). CEDS *elements* are CEDS PROPERTIES, so a CLR crossRef normalizes
// to a canonical CEDS property anchor 'P<6-digit>' (DESIGN §E "CEDS always P000113/C000113"),
// identical to CASE's and LIF's CEDS normalization. A normalization MISS is surfaced (returns
// { error }), NEVER silently dropped — the caller turns that into a forge-time failure so a missed
// mapping cannot pass as data (R3).
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// CEDS canonical-id prefixes (mirrors forge-case / forge-lif / forge-ceds normalize). A CLR→CEDS
// reference is to a CEDS element, which is a CEDS property -> 'P'. Kept as a registry (not a switch)
// so a value-level option crossRef ('OV') could be added without restructuring.
const cedsKindPrefix = {
	element: 'P',
	property: 'P',
	class: 'C',
	optionSet: 'OS',
	optionValue: 'OV',
};

// extractDigits — pull the numeric core out of any native CEDS anchor form.
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

// isCanonicalCedsId — the clean-form predicate the R3 test asserts against (identical to CEDS/CASE).
const CANONICAL_CEDS_ID_RE = /^(C|P|OS|OV)\d{6,}$/;
const isCanonicalCedsId = (value) =>
	typeof value === 'string' && CANONICAL_CEDS_ID_RE.test(value);

// -----
// CLR stableId (clrPath) construction + clean-form predicate.
//
// A CLR stableId is a dotted structural locator under the standard key. Whatever odd characters a
// schema class / property / enum value name carries, the emitted segment is reduced to a clean token
// ([A-Za-z0-9_-]) so the path is a stable, comparable identifier. Empty input is a miss.

const cleanSegment = (rawValue) => {
	if (rawValue == null) {
		return null;
	}
	const token = `${rawValue}`.trim().replace(/[^A-Za-z0-9_-]/g, '_');
	return token === '' ? null : token;
};

// buildClrPath — assemble a clean dotted clrPath from ordered raw segments.
//   Returns { clrPath } on success, { error } when no usable segment survives cleaning.
const CLR_PATH_PREFIX = 'clr';
const buildClrPath = (segments = []) => {
	const cleaned = (Array.isArray(segments) ? segments : [segments])
		.map(cleanSegment)
		.filter((one) => one != null);
	if (cleaned.length === 0) {
		return { error: `buildClrPath: no usable path segment from [${JSON.stringify(segments)}]` };
	}
	return { clrPath: `${CLR_PATH_PREFIX}:${cleaned.join('.')}` };
};

// isCleanStableId — a CLR stableId is a clean dotted clrPath (the structural identity, DESIGN §D
// case 3). No URI scheme — CLR has none at the element level; identity is the structural locator.
const CLR_PATH_RE = /^clr:[A-Za-z0-9_.-]+$/;
const isCleanStableId = (value) => typeof value === 'string' && CLR_PATH_RE.test(value);

module.exports = {
	cedsKindPrefix,
	extractDigits,
	normalizeCedsId,
	isCanonicalCedsId,
	buildClrPath,
	isCleanStableId,
	CANONICAL_CEDS_ID_RE,
	CLR_PATH_RE,
	CLR_PATH_PREFIX,
};
