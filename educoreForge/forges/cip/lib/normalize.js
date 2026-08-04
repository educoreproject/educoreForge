'use strict';

// normalize.js — CIP anchor + stableId normalization (R3, DESIGN §E, DECISIONS §23-R3).
// Mirrors forge-edfi/lib/normalize.js; adapted for CIP's pure-taxonomy code kinds.
// HISTORICAL CITATION: that mirror target is the PRE-CAMPAIGN CSV-crosswalk forge-edfi, removed
// from HEAD at the round-trip closeout 2026-08-04 (git history holds it); today's forge-edfi is a
// MetaEd reimplementation and carries no normalize.js.
//
// CIP is a 3-level NCES taxonomy (Classification of Instructional Programs 2020): a 2-digit
// FAMILY/domain ("01"), a 4-digit SUBDOMAIN ("01.01"), and a 6-digit PROGRAM ("01.0101"). It is a
// PURE taxonomy — codes are taxonomy classes (DmeClass), NOT option values. There are NO codesets,
// so CIP emits no DmeProperty / DmeOptionSet / DmeOptionValue.
//
// CIP has ONE canonical-form obligation:
//
//   stableId (CIP's OWN identity). CIP codes ARE the natural key (the NCES CIP code itself), so the
//   stableId is a DETERMINISTIC synthetic key: cip:<kind>/<cipCode>, with the root as the bare token
//   cip:root. This value is what edges resolve on (the replay resolutionKey) and what
//   stableUriPropertyName ('cipStableId') points at. An empty/whitespace code is a normalization
//   MISS — surfaced, never silently emitted (R3).
//
// CIP carries an intra-CIP CrossReferences field (e.g. "14.0301 - Agricultural Engineering.") naming
// OTHER CIP codes. These are SAME-standard references (CIP->CIP) and become REFERENCES edges; they
// are NOT cross-standard. The old forge's separate cip-to-ceds.json bridge is NOT part of the CSV
// source and is out of scope for this standard-pure block (no CEDS columns exist in the CSV).
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// -----
// kindTokenByKind — the stableId path token per CIP element kind. Registry, not switch.
const kindTokenByKind = {
	root: 'root',
	domain: 'domain', // 2-digit family   -> DmeClass
	subdomain: 'subdomain', // 4-digit subdomain -> DmeClass
	program: 'program', // 6-digit program   -> DmeClass
};

// -----
// buildStableId — { kind, key } -> { stableId } (cip:<token>/<key>; root is the bare token), or
//   { error } on an unknown kind or an empty/whitespace key. Deterministic; same input -> same id.
const buildStableId = ({ kind, key } = {}) => {
	const token = kindTokenByKind[kind];
	if (!token) {
		return {
			error: `buildStableId: unknown CIP element kind '${kind}' (expected one of ${Object.keys(
				kindTokenByKind,
			).join(', ')})`,
		};
	}
	if (kind === 'root') {
		return { stableId: 'cip:root' };
	}
	const cleanKey = key == null ? '' : `${key}`.trim();
	if (cleanKey === '') {
		return { error: `buildStableId: empty natural key for CIP kind '${kind}'` };
	}
	return { stableId: `cip:${token}/${cleanKey}` };
};

// -----
// isCleanStableId — the R3 predicate the test asserts against. A clean CIP stableId is a non-empty,
//   non-whitespace-padded string of the form cip:<token>[/<non-empty remainder>]. The remainder is a
//   CIP code (digits + a dot), so the prefix shape is constrained; the remainder is left permissive.
const CIP_STABLE_ID_RE = /^cip:[A-Za-z]+(\/.+)?$/;
const isCleanStableId = (value) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value === value.trim() &&
	CIP_STABLE_ID_RE.test(value);

// -----
// classifyCode — a CIP code -> its taxonomy level. 2-digit (no dot) is a domain; 4-digit
//   (".dd") is a subdomain; 6-digit (".dddd") is a program. (Harvested from the old parser.)
const classifyCode = (cipCode) => {
	const clean = cipCode == null ? '' : `${cipCode}`.trim();
	if (!clean.includes('.')) {
		return 'domain';
	}
	const afterDot = clean.split('.')[1] || '';
	if (afterDot.length === 2) {
		return 'subdomain';
	}
	return 'program';
};

// -----
// parentCodeOf — the parent CIP code for a subdomain/program (the SUBCLASS_OF target code), or null
//   for a domain (its parent is the root). (Harvested from the old parser's getParentCode.)
const parentCodeOf = (cipCode, level) => {
	const clean = cipCode == null ? '' : `${cipCode}`.trim();
	if (level === 'subdomain') {
		return clean.split('.')[0]; // 01.01 -> 01
	}
	if (level === 'program') {
		const parts = clean.split('.');
		return `${parts[0]}.${(parts[1] || '').substring(0, 2)}`; // 01.0101 -> 01.01
	}
	return null;
};

module.exports = {
	kindTokenByKind,
	buildStableId,
	isCleanStableId,
	classifyCode,
	parentCodeOf,
	CIP_STABLE_ID_RE,
};
