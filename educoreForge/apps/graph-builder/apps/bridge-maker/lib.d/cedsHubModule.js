'use strict';

// cedsHubModule.js — bridge-maker/lib.d (bridgeEvidenceRefactor-spec.md §6/§7 P3, R5; REVISED by
// hubReimplementation Phase 3, SPEC-hubReimplementation-080326.md §6). THE REAL CEDS hub module:
// `(candidate, callback(err, baseTupleEvidence))` rendering the CEDS tuple presentation for one CEDS
// HubReference candidate — property tier (unqualified or qualified) or value tier, whichever shape the
// candidate's own materialized fields carry. This is the seam R5 names: "Hub is a parameter selecting
// a hub-internal module" — a future non-CEDS hub slots into the SAME HUB_MODULE_SHAPE contract
// (evidenceContracts.js §3) this file implements; nothing here is CEDS-specific at the CONTRACT level,
// only at the field-mapping level.
//
// ⟪hubReimplementation P3, 2026-08-03⟫ THE MEANING REVISION. The Phase-1/2 hub reimplementation made
// every HubReference card SELF-SUFFICIENT (SPEC §1: ADDRESS + IDENTITY + MEANING + PROVENANCE +
// DERIVED groups all ON the card), so this module now reads MEANING directly off the card instead of
// presenting an id-only tuple:
//   - `resolveDomains` is DELETED. A card IS one domain's view of one idea (SPEC §1.1: exactly one
//     domainId), and it carries `domainName` + `domainDefinition` itself (SPEC §1.3). The old
//     domains[]/domainsComplete list-plus-disclaimer contract — built for cards that knew their domain
//     only as an opaque id and might have collapsed a multi-domain property — describes a card shape
//     that no longer exists. The presentation is now `domain: { domainId, domainName,
//     domainDefinition }`, singular, always complete by construction.
//   - `property` meaning group joins the presentation: `{ propertyName, propertyDefinition, ... }` —
//     at value tier this is the OWNING property's meaning, which is what makes a value-tier card
//     judgeable when ~52% of option values carry no prose of their own (PLAN §3).
//   - range prose rides with the range: rangeClassName/rangeClassDefinition (class ranges),
//     rangeOptionSetName/rangeOptionSetDefinition (option-set ranges) — copied from the card when the
//     card has them, absent when it does not ("absent is absent", SPEC §1.3 — never '').
//   - value prose rides with the value context: valueName/valueDefinition/valueNotation/valuePrefLabel.
//   - the QUALIFIER_NAME_SUFFIX name-parse is DELETED. The card carries `qualifierNames[]`
//     positionally parallel to `qualifierKeys[]` (SPEC §1.3); the one place a qualifier's human name
//     used to live (embedded in the card's own `name`) is retired along with the `" [qualifier]"`
//     naming convention itself (SPEC §1.6). The presentation carries `qualifierNames` verbatim.
//
// REFUSALS, not substitutions (SPEC standing rule): a missing REQUIRED meaning field — `domainName`,
// `propertyName` — is refused NAMING THE CARD (its canonicalKey), never defaulted, never worked
// around by a map lookup or a name-parse. A definition CEDS never wrote is honestly absent (G-3:
// "CEDS has no definition" and "we failed to copy it" must remain distinguishable); a definition the
// card SHOULD carry but does not is a broken card and refusing it is the point.
//
// INPUT: a FULL candidate element (lib.d/sourceWalker.js flattenFullRecord shape) for a :ForgedNode
// role='HubReference' — every raw scalar property the node carries (referenceTier, canonicalKey,
// propertyKey, name, domainId, domainName, domainDefinition, propertyName, propertyDefinition,
// rangeDatatype/rangeClassId/rangeOptionSetId (+ range prose), qualifierKeys, qualifierNames,
// valueKey (+ value prose), hubName, hubVersion, addressSignature, anchorUri, uri, embedText,
// embedding, ...). This module reads ONLY raw HubReference fields — it never re-derives anything a
// graph read would be needed for, exactly per HUB_MODULE_SHAPE's own doc: "every real implementation
// we can foresee renders a presentation from an already-read candidate synchronously — it does not
// itself read the graph".
//
// SYNCHRONOUS, calls back on the same tick (R7 callback-shaped regardless — evidenceContracts.js's
// ⟪TQ RULING, 2026-07-29⟫).
//
// House style: qtools moduleFunction; callback(errString, result) with '' on success; refuse-by-value
// (polyArch2 §6) — a candidate lacking the fields its own tier/shape requires is refused BY NAME,
// never defaulted or guessed at. camelCase, compound names. No async/await, no try/catch for control
// flow (there is none here to need it — pure, synchronous field mapping).

const { hubModulePresentationViolation } = require('../lib/evidenceContracts');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// asList — PG-JSON single-element collapse guard (referenceIndex.js's own helper, ported identically:
// qualifierKeys/qualifierNames are genuinely list-valued; never collapse them via a scalar-coercing
// v1()).
const asList = (value) =>
	Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];

// hasProse — a field is PRESENT only when it is a non-empty string. Null/undefined/'' are all honest
// absence ("absent is absent", SPEC §1.3) — this is absence PROPAGATION, not a default: an absent
// source field yields an absent presentation field, never a substituted value.
const hasProse = (value) => typeof value === 'string' && value !== '';

// copyPresentFields — copy each named field from the candidate onto the target ONLY when the
// candidate actually carries it. One fact, one field; nothing invented, nothing defaulted.
const copyPresentFields = (target, candidate, fieldNames) => {
	fieldNames.forEach((oneFieldName) => {
		if (hasProse(candidate[oneFieldName])) {
			target[oneFieldName] = candidate[oneFieldName];
		}
	});
	return target;
};

const RANGE_SHAPE_BY_FIELD = Object.freeze({
	rangeDatatype: 'datatype',
	rangeClassId: 'class',
	rangeOptionSetId: 'optionSet',
});

// resolveRange — exactly ONE of the three range fields must be present on a conforming candidate
// (the forge-level XOR invariant, SPEC §1.1 / gate G-12). -> { range } | { violation }. Range PROSE
// (SPEC §1.3: rangeClassName/rangeClassDefinition on class ranges, rangeOptionSetName/
// rangeOptionSetDefinition on option-set ranges) is copied from the card when present.
const resolveRange = (candidate) => {
	const presentFields = Object.keys(RANGE_SHAPE_BY_FIELD).filter(
		(oneField) => candidate[oneField] !== undefined && candidate[oneField] !== null && candidate[oneField] !== '',
	);
	if (presentFields.length !== 1) {
		return {
			violation:
				`candidate carries ${presentFields.length} range field(s) (${presentFields.join(', ') || 'none'}) ` +
				`— exactly one of rangeDatatype/rangeClassId/rangeOptionSetId must be set (SPEC §1.1, G-12)`,
		};
	}
	const field = presentFields[0];
	const shape = RANGE_SHAPE_BY_FIELD[field];
	const range = { shape, rangeDatatype: null, rangeClassId: null, rangeOptionSetId: null };
	range[field] = candidate[field];
	if (shape === 'class') {
		copyPresentFields(range, candidate, ['rangeClassName', 'rangeClassDefinition']);
	}
	if (shape === 'optionSet') {
		copyPresentFields(range, candidate, ['rangeOptionSetName', 'rangeOptionSetDefinition']);
	}
	return { range };
};

// resolveQualifierNames — the card carries qualifierKeys[] and qualifierNames[] POSITIONALLY PARALLEL
// (SPEC §1.3); this reads them verbatim. The retired incumbent stored a qualifier's human name ONLY
// inside the card's own `name` (`${tokenName} [${qualifierValueName}]`), which this module used to
// parse back out — that convention is gone (SPEC §1.6) and so is the parse. A qualified card whose
// two lists disagree in length is a broken card, refused by name.
const resolveQualifierNames = (candidate) => {
	const qualifierKeys = asList(candidate.qualifierKeys);
	const qualifierNames = asList(candidate.qualifierNames);
	if (qualifierKeys.length === 0) {
		if (qualifierNames.length !== 0) {
			return {
				violation:
					`candidate carries qualifierNames (${JSON.stringify(qualifierNames)}) but no qualifierKeys ` +
					`— the two lists are positionally parallel (SPEC §1.3); an unqualified card carries neither`,
			};
		}
		return { isQualified: false, qualifierNames: [] };
	}
	if (qualifierNames.length !== qualifierKeys.length) {
		return {
			violation:
				`candidate carries ${qualifierKeys.length} qualifierKeys but ${qualifierNames.length} ` +
				`qualifierNames — the lists are positionally parallel (SPEC §1.3); refusing rather than ` +
				`presenting a qualifier with no name`,
		};
	}
	const badName = qualifierNames.find((oneName) => !hasProse(oneName));
	if (badName !== undefined) {
		return {
			violation:
				`candidate carries a qualifierNames entry that is not a non-empty string ` +
				`(${JSON.stringify(badName)}) — refusing rather than presenting a nameless qualifier`,
		};
	}
	return { isQualified: true, qualifierNames };
};

// resolveDomain — SINGULAR (SPEC §1.1: a card IS one domain's view of the idea). domainId was already
// guard-checked by the caller; domainName is a REQUIRED meaning field (SPEC §6) — a card without it
// is refused naming the card, never resolved through a map or presented as an opaque id.
// domainDefinition is copied when present (G-4 proves it always is on a conforming card; this module
// still propagates absence honestly rather than refusing on a field SPEC §6 does not name REQUIRED).
const resolveDomain = (candidate) => {
	if (!hasProse(candidate.domainName)) {
		return {
			violation:
				`candidate '${candidate.canonicalKey}' carries no domainName — a REQUIRED meaning field ` +
				`(SPEC §6); the card is self-sufficient by design and a card without its domain's name is ` +
				`broken, not resolvable`,
		};
	}
	const domain = { domainId: candidate.domainId, domainName: candidate.domainName };
	copyPresentFields(domain, candidate, ['domainDefinition']);
	return { domain };
};

// resolveProperty — the property-slot meaning group (SPEC §1.3). At property tier this is the card's
// own property; at value tier it is the OWNING property, whose prose is the context stack that makes
// a prose-less option value judgeable (PLAN §3). propertyName is REQUIRED (SPEC §6);
// propertyDefinition exists on 2,321 of 2,324 CEDS properties — the three without stay honestly
// absent. propertyNotation/propertyDataType/propertyTextFormat ride along as CEDS has them.
const resolveProperty = (candidate) => {
	if (!hasProse(candidate.propertyName)) {
		return {
			violation:
				`candidate '${candidate.canonicalKey}' carries no propertyName — a REQUIRED meaning field ` +
				`(SPEC §6); refusing rather than presenting a property with no name`,
		};
	}
	const property = { propertyName: candidate.propertyName };
	copyPresentFields(property, candidate, [
		'propertyDefinition',
		'propertyNotation',
		'propertyDataType',
		'propertyTextFormat',
	]);
	return { property };
};

// resolveValueContext — referenceTier !== 'value' -> { value: null }. Value tier -> the
// { valueKey, owningPropertyKey, owningOptionSetId } scope (a bare option-value token is NOT unique
// across properties — P0 §2.6's finding still governs) PLUS the card's value prose (SPEC §1.3:
// valueName/valueDefinition/valueNotation/valuePrefLabel, present as CEDS has them). valueKey is
// read directly — the new card carries it on every value-tier card (SPEC §1.1); an absent valueKey
// is a broken card, refused by name, never recovered from canonicalKey.
const resolveValueContext = (candidate) => {
	if (candidate.referenceTier !== 'value') {
		return { value: null };
	}
	const valueKey = candidate.valueKey;
	const owningPropertyKey = candidate.propertyKey;
	const owningOptionSetId = candidate.rangeOptionSetId;
	if (!hasProse(valueKey) || !hasProse(owningPropertyKey) || !hasProse(owningOptionSetId)) {
		return {
			violation:
				`candidate '${candidate.canonicalKey}' has referenceTier='value' but is missing ` +
				`valueKey/propertyKey/rangeOptionSetId (got valueKey=${JSON.stringify(valueKey)}, ` +
				`propertyKey=${JSON.stringify(owningPropertyKey)}, rangeOptionSetId=` +
				`${JSON.stringify(owningOptionSetId)}) — a value-tier candidate with no owning scope is ` +
				`actively misleading, never rendered bare`,
		};
	}
	const value = { valueKey, owningPropertyKey, owningOptionSetId };
	copyPresentFields(value, candidate, ['valueName', 'valueDefinition', 'valueNotation', 'valuePrefLabel']);
	return { value };
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// hubModule — the produced HubModule callable (evidenceContracts.js HUB_MODULE_SHAPE: arity 2,
		// positional (candidate, callback)). Synchronous; calls back on the same tick.
		const hubModule = (candidate, callback) => {
			if (!candidate || typeof candidate !== 'object') {
				callback(`${moduleName}: candidate is missing or not an object — there is no default.`);
				return;
			}
			if (candidate.referenceTier !== 'property' && candidate.referenceTier !== 'value') {
				callback(
					`${moduleName}: candidate.referenceTier must be 'property' or 'value' (got ` +
						`${JSON.stringify(candidate.referenceTier)}) — every CEDS HubReference carries one of ` +
						`exactly two tiers; there is no default.`,
				);
				return;
			}
			if (!hasProse(candidate.canonicalKey)) {
				callback(`${moduleName}: candidate.canonicalKey is missing — there is no default.`);
				return;
			}
			if (!hasProse(candidate.propertyKey)) {
				callback(`${moduleName}: candidate '${candidate.canonicalKey}': propertyKey is missing — there is no default.`);
				return;
			}
			if (!hasProse(candidate.name)) {
				callback(`${moduleName}: candidate '${candidate.canonicalKey}': name is missing — there is no default.`);
				return;
			}
			if (!hasProse(candidate.domainId)) {
				callback(
					`${moduleName}: candidate '${candidate.canonicalKey}': domainId is missing — every ` +
						`HubReference carries exactly one owning class (SPEC §1.1); there is no default.`,
				);
				return;
			}

			const { domain, violation: domainViolation } = resolveDomain(candidate);
			if (domainViolation) {
				callback(`${moduleName}: ${domainViolation}`);
				return;
			}
			const { property, violation: propertyViolation } = resolveProperty(candidate);
			if (propertyViolation) {
				callback(`${moduleName}: ${propertyViolation}`);
				return;
			}
			const { range, violation: rangeViolation } = resolveRange(candidate);
			if (rangeViolation) {
				callback(`${moduleName}: candidate '${candidate.canonicalKey}': ${rangeViolation}`);
				return;
			}
			const { isQualified, qualifierNames, violation: qualifierViolation } = resolveQualifierNames(candidate);
			if (qualifierViolation) {
				callback(`${moduleName}: candidate '${candidate.canonicalKey}': ${qualifierViolation}`);
				return;
			}
			const { value, violation: valueViolation } = resolveValueContext(candidate);
			if (valueViolation) {
				callback(`${moduleName}: ${valueViolation}`);
				return;
			}

			const baseTupleEvidence = {
				referenceTier: candidate.referenceTier,
				canonicalKey: candidate.canonicalKey,
				propertyKey: candidate.propertyKey,
				name: candidate.name,
				domain,
				property,
				range,
				isQualified,
				qualifierNames,
				value,
			};

			// SELF-GATE — the hub module proves its OWN output before ever calling back with it (the same
			// discipline evidenceComposer.js applies to its evidencePackage, ⟪A3⟫'s sibling for R5).
			const selfGateViolation = hubModulePresentationViolation(baseTupleEvidence);
			if (selfGateViolation) {
				callback(`${moduleName}: composed a presentation that fails its own R5 gate: ${selfGateViolation}`);
				return;
			}
			callback('', baseTupleEvidence);
		};

		return hubModule;
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.resolveRange = resolveRange;
module.exports.resolveQualifierNames = resolveQualifierNames;
module.exports.resolveDomain = resolveDomain;
module.exports.resolveProperty = resolveProperty;
module.exports.resolveValueContext = resolveValueContext;
module.exports.asList = asList;
