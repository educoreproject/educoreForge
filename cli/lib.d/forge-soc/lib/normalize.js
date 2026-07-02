'use strict';

// normalize.js — SOC anchor + stableId normalization (R3). Mirrors forge-edfi/lib/normalize.js;
// adapted for SOC's O*NET-SOC occupation taxonomy + Job Zone option set.
//
// SOC has TWO distinct canonical-form obligations, kept separate on purpose:
//
//   1. stableId (SOC's OWN identity). SOC nodes have no native URI we forge against, so the stableId
//      is a DETERMINISTIC, structural synthetic key (mirrors EdFi's edfi:<kind>/<key> ruling):
//      soc:<token>/<key>, with the root as the bare token soc:root. This value is what edges resolve
//      on (the replay resolutionKey) and what stableUriPropertyName ('socStableId') points at. An
//      empty/whitespace natural key is a normalization MISS — surfaced, never silently emitted (R3).
//
//        soc:root                                  the DmeStandardRoot
//        soc:group/<socCode>                       a SocGroup (major/minor/broad) DmeClass
//        soc:occupation/<onetSocCode>              a SocOccupation (detailed O*NET-SOC) DmeClass
//        soc:property/jobZone                      the synthetic jobZone DmeProperty
//        soc:optionset/jobZone                     the Job Zone DmeOptionSet
//        soc:value/jobZone.<zoneNumber>            a Job Zone DmeOptionValue
//
//   2. cipMappings (CROSS-references — BRIDGE data for a later phase). The NCES CIP2020↔SOC2018
//      crosswalk maps a SOC occupation to CIP program codes. This is CROSS-STANDARD data: it is
//      STASHED as a node property (cipMappings array) + crossRefs JSON for a LATER bridge, and this
//      standard block emits NO cross-standard edges. A CIP code is normalized only to its trimmed
//      surface form (XX.XXXX). There is no in-standard SOC canonical anchor for it (it targets CIP,
//      not SOC), so it is never a structural resolver — purely carried-through bridge stash.
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// -----
// kindTokenByKind — the stableId path token per SOC element kind. Registry, not switch.
const kindTokenByKind = {
	root: 'root',
	group: 'group', // -> DmeClass (major/minor/broad SOC group, synthesized from code structure)
	occupation: 'occupation', // -> DmeClass (detailed O*NET-SOC occupation)
	property: 'property', // -> DmeProperty (the synthetic jobZone property)
	optionSet: 'optionset', // -> DmeOptionSet (the Job Zone option set)
	optionValue: 'value', // -> DmeOptionValue (a Job Zone tier)
};

// -----
// buildStableId — { kind, key } -> { stableId } (soc:<token>/<key>; root is the bare token), or
//   { error } on an unknown kind or an empty/whitespace key. Deterministic; same input -> same id.
const buildStableId = ({ kind, key } = {}) => {
	const token = kindTokenByKind[kind];
	if (!token) {
		return {
			error: `buildStableId: unknown SOC element kind '${kind}' (expected one of ${Object.keys(
				kindTokenByKind,
			).join(', ')})`,
		};
	}
	if (kind === 'root') {
		return { stableId: 'soc:root' };
	}
	const cleanKey = key == null ? '' : `${key}`.trim();
	if (cleanKey === '') {
		return { error: `buildStableId: empty natural key for SOC kind '${kind}'` };
	}
	return { stableId: `soc:${token}/${cleanKey}` };
};

// -----
// isCleanStableId — the R3 predicate the test asserts against. A clean SOC stableId is a non-empty,
//   non-whitespace-padded string of the form soc:<token>[/<non-empty remainder>]. The remainder may
//   contain dots (occupation code 11-1011.00) and dashes (SOC code), so only the prefix shape is
//   constrained.
const SOC_STABLE_ID_RE = /^soc:[A-Za-z]+(\/.+)?$/;
const isCleanStableId = (value) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value === value.trim() &&
	SOC_STABLE_ID_RE.test(value);

// -----
// toSocBaseCode — strip the O*NET-SOC specialization suffix (.XX) to the SOC 2018 base code. The
//   O*NET-SOC 2019 codes are 8-char (11-1011.00) while the NCES crosswalk uses 7-char SOC 2018
//   (11-1011). The trailing .XX is stripped when matching crosswalk rows to occupations. (Harvested
//   from the OLD forge-soc parser.)
const toSocBaseCode = (onetSocCode) => `${onetSocCode == null ? '' : onetSocCode}`.split('.')[0];

// -----
// socGroupCodesForBaseCode — given a SOC base code 'XX-YYYY', return the structural ancestor group
//   codes from most-general to most-specific: major 'XX-0000', minor 'XX-YZ00' (if distinct), broad
//   'XX-YYYY' (if distinct). Used to synthesize the SUBCLASS_OF occupation taxonomy from the code
//   structure (no separate group source file ships in the MVP bundle). Returns [] for a malformed
//   code (surfaced by the caller as a parent-resolution miss, never a silent partial chain).
//
// SOC code structure (2018): major group = first 2 digits + '-0000'; minor group = '-' + 4th digit
// nonzero family rolled to 'YZ00'; broad occupation = the full 'XX-YYYY' (4 digits after dash);
// detailed occupations append '.XX'. We treat the base code (XX-YYYY) as the BROAD group and build
// the major + minor ancestors above it.
const SOC_BASE_CODE_RE = /^(\d{2})-(\d)(\d)(\d{2})$/;
const socGroupCodesForBaseCode = (baseCode) => {
	const matches = `${baseCode == null ? '' : baseCode}`.trim().match(SOC_BASE_CODE_RE);
	if (!matches) {
		return [];
	}
	const [, majorDigits, minorDigit, broadDigit, detailDigits] = matches;
	const major = `${majorDigits}-0000`;
	const minor = `${majorDigits}-${minorDigit}000`;
	const broad = `${majorDigits}-${minorDigit}${broadDigit}${detailDigits}`;
	// de-duplicate while preserving general->specific order (minor may equal major-ish in some
	// families; broad always distinct from minor because detailDigits/broadDigit add specificity).
	const ordered = [];
	[major, minor, broad].forEach((code) => {
		if (!ordered.includes(code)) {
			ordered.push(code);
		}
	});
	return ordered;
};

// -----
// normalizeCipCode — a CIP2020 code's trimmed surface form (cross-standard bridge stash; NOT a SOC
//   resolver). Returns { absent: true } for empty, { cipCode } otherwise. Never an in-standard edge.
const normalizeCipCode = ({ rawValue } = {}) => {
	const trimmed = rawValue == null ? '' : `${rawValue}`.trim();
	if (trimmed === '') {
		return { absent: true };
	}
	return { cipCode: trimmed };
};

module.exports = {
	kindTokenByKind,
	buildStableId,
	isCleanStableId,
	toSocBaseCode,
	socGroupCodesForBaseCode,
	normalizeCipCode,
	SOC_STABLE_ID_RE,
	SOC_BASE_CODE_RE,
};
