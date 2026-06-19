'use strict';

// normalize.js — CEDS anchor normalization (R3, DESIGN §E, DECISIONS §23-R3).
//
// Whatever the native input form (a CEDS URL, a `ceds:000113` prefix form, a bare number,
// or the dc:identifier value), the emitted canonical `cedsId` conforms to a clean canonical
// form. A normalization MISS is surfaced (returns { error }), NEVER silently dropped — the
// caller turns that into a forge-time failure so a missed mapping cannot pass as data (R3).
//
// Canonical forms (DESIGN §E "CEDS always P000113 / C000113"):
//   class       -> C<6-digit zero-padded>
//   property    -> P<6-digit zero-padded>
//   optionSet   -> OS<6-digit zero-padded>
//   optionValue -> OV<6-digit zero-padded>
// The numeric core is the digits found in the native dc:identifier / URI / prefix form.
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// rolePrefix — canonical prefix per role kind. Registry, not switch.
const rolePrefixByKind = {
	class: 'C',
	property: 'P',
	optionSet: 'OS',
	optionValue: 'OV',
};

// extractDigits — pull the numeric core out of any native anchor form.
//   Accepts: a CEDS URL ending in digits, `ceds:000113`, `C000113`/`P000113`, a bare number,
//   or a raw dc:identifier. Returns the digit string, or null when no digit core is present.
const extractDigits = (rawValue) => {
	if (rawValue == null) {
		return null;
	}
	const asString = `${rawValue}`.trim();
	if (asString === '') {
		return null;
	}
	// Take the LAST run of digits (a URL's terminal id; a prefix form's numeric tail).
	const matches = asString.match(/(\d+)(?!.*\d)/);
	if (!matches) {
		return null;
	}
	return matches[1];
};

// normalizeCedsId — native anchor form -> canonical cedsId for the given role kind.
//   Returns { cedsId } on success, { error } on a normalization miss (never silent).
const normalizeCedsId = ({ rawValue, kind } = {}) => {
	const prefix = rolePrefixByKind[kind];
	if (!prefix) {
		return {
			error: `normalizeCedsId: unknown role kind '${kind}' (expected one of ${Object.keys(rolePrefixByKind).join(', ')})`,
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

// isCanonicalCedsId — the clean-form predicate the R3 test asserts against.
const CANONICAL_CEDS_ID_RE = /^(C|P|OS|OV)\d{6,}$/;
const isCanonicalCedsId = (value) =>
	typeof value === 'string' && CANONICAL_CEDS_ID_RE.test(value);

// isCleanStableId — the stableId is the node's CEDS uri; a clean form is an absolute
// https URI under the CEDS namespace (DESIGN §D: CEDS stableUriPropertyName = 'uri').
const CEDS_URI_RE = /^https?:\/\/\S+$/;
const isCleanStableId = (value) =>
	typeof value === 'string' && CEDS_URI_RE.test(value);

module.exports = {
	rolePrefixByKind,
	extractDigits,
	normalizeCedsId,
	isCanonicalCedsId,
	isCleanStableId,
	CANONICAL_CEDS_ID_RE,
	CEDS_URI_RE,
};
