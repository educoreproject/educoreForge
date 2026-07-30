'use strict';

// cedsHubModule.js — bridge-maker/lib.d NEW (bridgeEvidenceRefactor-spec.md §6/§7 P3, R5). THE REAL
// CEDS hub module: `(candidate, callback(err, baseTupleEvidence))` rendering the P0-authoritative CEDS
// tuple presentation (P0-cedsTupleModel.md §2/§3) for one CEDS HubReference candidate — property tier
// (unqualified or qualified) or value tier, whichever shape the candidate's own materialized fields
// carry. This is the seam R5 names: "Hub is a parameter selecting a hub-internal module" — a future
// non-CEDS hub slots into the SAME HUB_MODULE_SHAPE contract (evidenceContracts.js §3) this file
// implements; nothing here is CEDS-specific at the CONTRACT level, only at the field-mapping level.
//
// INPUT: a FULL candidate element (lib.d/sourceWalker.js flattenFullRecord shape) for a :ForgedNode
// role='HubReference' — i.e. every raw scalar property the node carries (referenceTier, canonicalKey,
// propertyKey, name, domainId, rangeDatatype/rangeClassId/rangeOptionSetId, qualifierKeys, valueKey,
// hubName, hubVersion, addressSignature, anchorUri, uri, ...) PLUS flattenCandidateRecord's computed
// convenience keys (defText, cedsId, ...). This module reads ONLY the raw HubReference fields
// documented in P0-cedsTupleModel.md §2.1 — it never re-derives anything a graph read would be needed
// for, exactly per HUB_MODULE_SHAPE's own doc: "every real implementation we can foresee renders a
// presentation from an already-read candidate synchronously — it does not itself read the graph".
//
// SYNCHRONOUS, calls back on the same tick (R7 callback-shaped regardless — evidenceContracts.js's
// ⟪TQ RULING, 2026-07-29⟫).
//
// FIELD PROVENANCE (every mapping below is a P0 code-fact, cited):
//
//   domains[] / domainsComplete — P0-cedsTupleModel.md §2.4 (forgeCeds.js:306, code-fact): domainId is
//     ALWAYS a single scalar in the materialized graph; the graph carries NO per-node signal
//     distinguishing a genuinely single-domain property from one of the 256/2324 (11%) that had a
//     domain SILENTLY DROPPED at forge time. A HubReference node can therefore never PROVE its
//     domains[] is complete — domainsComplete is UNCONDITIONALLY false here, for every candidate,
//     until spec §7 P4's forgeCeds.js:306 fix lands and the graph itself starts carrying a
//     completeness signal. (This is the honest reading of P4's own instruction: "until the fix lands,
//     the renderer marks the domain list as known-incomplete rather than presenting a partial fact as
//     complete" — there is no per-node way to tell which of the 2324 properties are among the 256, so
//     ALL of them must carry the same honest disclaimer today, not just the ones known to be affected.)
//
//   range shape — P0 §2.1/§2.3: exactly one of rangeDatatype/rangeClassId/rangeOptionSetId is ever set
//     on a live HubReference (graph-fact: Q6/Q7, zero exceptions across 29,788 live nodes). This
//     module TRUSTS that forge-level invariant and refuses BY VALUE if a candidate somehow violates it
//     (zero or more than one range field present) rather than silently guessing which one is real.
//
//   qualifier context — P0 §2.2 / forges/ceds/lib/referenceSubgraph.js:408-424 (code fact): a
//     qualified ref's `qualifierKeys` carries ONLY the qualifier option-value's canonicalKey (an OV
//     token) — the HUMAN-READABLE qualifier name is NOT stored as its own field anywhere on the node.
//     The ONE place it lives is embedded in the ref's own `name`, which referenceSubgraph.js:418
//     stamps as `${tokenName} [${qualifierValueName}]` for EVERY qualified ref, universally. This
//     module parses that bracket suffix — the one place P0's own read of the forge code shows the name
//     living — and refuses BY VALUE (never fabricates a placeholder) when a qualified candidate's name
//     carries no such suffix, which would mean the forge's own qualified-ref naming convention broke.
//
//   value-tier scope — P0 §2.2/§2.6: valueKey (== canonicalKey at value tier), propertyKey (the OWNING
//     property, inherited), rangeOptionSetId (also inherited) are already present on the node itself
//     (referenceSubgraph.js:341-357) — no graph walk needed to assemble the {valueKey,
//     owningPropertyKey, owningOptionSetId} value context the contract requires.
//
// House style: qtools moduleFunction; callback(errString, result) with '' on success; refuse-by-value
// (polyArch2 §6) — a candidate lacking the fields its own tier/shape requires is refused BY NAME,
// never defaulted or guessed at. camelCase, compound names. No async/await, no try/catch for control
// flow (there is none here to need it — pure, synchronous field mapping).

const { hubModulePresentationViolation } = require('../lib/evidenceContracts');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// asList — PG-JSON single-element collapse guard (referenceIndex.js's own helper, ported identically:
// qualifierKeys is genuinely list-valued; never collapse it via a scalar-coercing v1()).
const asList = (value) =>
	Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];

const RANGE_SHAPE_BY_FIELD = Object.freeze({
	rangeDatatype: 'datatype',
	rangeClassId: 'class',
	rangeOptionSetId: 'optionSet',
});

// resolveRange — exactly ONE of the three range fields must be present on a conforming candidate
// (P0 §2.1/§2.3's forge-level invariant). -> { range } | { violation }.
const resolveRange = (candidate) => {
	const presentFields = Object.keys(RANGE_SHAPE_BY_FIELD).filter(
		(oneField) => candidate[oneField] !== undefined && candidate[oneField] !== null && candidate[oneField] !== '',
	);
	if (presentFields.length !== 1) {
		return {
			violation:
				`candidate carries ${presentFields.length} range field(s) (${presentFields.join(', ') || 'none'}) ` +
				`— exactly one of rangeDatatype/rangeClassId/rangeOptionSetId must be set (P0 §2.1/§2.3)`,
		};
	}
	const field = presentFields[0];
	const shape = RANGE_SHAPE_BY_FIELD[field];
	const range = { shape, rangeDatatype: null, rangeClassId: null, rangeOptionSetId: null };
	range[field] = candidate[field];
	if (shape === 'class') {
		range.rangeClassName = candidate.rangeClassName || null;
	}
	return { range };
};

// QUALIFIER_NAME_SUFFIX — the ONLY place a qualifier's human name lives (referenceSubgraph.js:418,
// `${tokenName} [${qualifierValueName}]`). Captures the trailing bracketed suffix specifically, so a
// coincidental '[' earlier in a property's own name is never misread as a qualifier suffix.
const QUALIFIER_NAME_SUFFIX = /\s\[([^[\]]+)]$/;

// resolveQualifier — candidate not qualified -> { isQualified: false, qualifier: null }. Qualified ->
// parse the ONE place the qualifier's name lives (the candidate's own `name`), or a named violation
// when the forge's own qualified-ref naming convention is not present.
const resolveQualifier = (candidate) => {
	const qualifierKeys = asList(candidate.qualifierKeys);
	if (qualifierKeys.length === 0) {
		return { isQualified: false, qualifier: null };
	}
	const qualifierKey = qualifierKeys[0];
	const nameMatch = QUALIFIER_NAME_SUFFIX.exec(`${candidate.name || ''}`);
	if (!qualifierKey || !nameMatch) {
		return {
			violation:
				`candidate carries qualifierKeys but its name ('${candidate.name}') does not carry the ` +
				`'<token> [<qualifier name>]' suffix referenceSubgraph.js's own qualified-ref emission ` +
				`always stamps (P0 §2.2) — refusing rather than fabricating a qualifier name`,
		};
	}
	return { isQualified: true, qualifier: { qualifierKey, qualifierName: nameMatch[1] } };
};

// resolveValueContext — referenceTier !== 'value' -> { value: null }. Value tier -> the {valueKey,
// owningPropertyKey, owningOptionSetId} scope P0 §2.6 requires (already on the node — no graph walk).
const resolveValueContext = (candidate) => {
	if (candidate.referenceTier !== 'value') {
		return { value: null };
	}
	const valueKey = candidate.valueKey || candidate.canonicalKey;
	const owningPropertyKey = candidate.propertyKey;
	const owningOptionSetId = candidate.rangeOptionSetId;
	if (!valueKey || !owningPropertyKey || !owningOptionSetId) {
		return {
			violation:
				`candidate has referenceTier='value' but is missing valueKey/propertyKey/rangeOptionSetId ` +
				`(got valueKey=${JSON.stringify(valueKey)}, propertyKey=${JSON.stringify(owningPropertyKey)}, ` +
				`rangeOptionSetId=${JSON.stringify(owningOptionSetId)}) — a value-tier candidate with no owning ` +
				`scope is actively misleading, never rendered bare (P0 §2.6)`,
		};
	}
	return { value: { valueKey, owningPropertyKey, owningOptionSetId } };
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
						`exactly two tiers (P0 §2.2); there is no default.`,
				);
				return;
			}
			if (typeof candidate.canonicalKey !== 'string' || !candidate.canonicalKey) {
				callback(`${moduleName}: candidate.canonicalKey is missing — there is no default.`);
				return;
			}
			if (typeof candidate.propertyKey !== 'string' || !candidate.propertyKey) {
				callback(`${moduleName}: candidate.propertyKey is missing — there is no default.`);
				return;
			}
			if (typeof candidate.name !== 'string' || !candidate.name) {
				callback(`${moduleName}: candidate.name is missing — there is no default.`);
				return;
			}
			if (typeof candidate.domainId !== 'string' || !candidate.domainId) {
				callback(
					`${moduleName}: candidate.domainId is missing — every live HubReference carries exactly ` +
						`one owning class (P0 §2.1); there is no default.`,
				);
				return;
			}

			const { range, violation: rangeViolation } = resolveRange(candidate);
			if (rangeViolation) {
				callback(`${moduleName}: ${rangeViolation}`);
				return;
			}
			const { isQualified, qualifier, violation: qualifierViolation } = resolveQualifier(candidate);
			if (qualifierViolation) {
				callback(`${moduleName}: ${qualifierViolation}`);
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
				domains: [{ domainId: candidate.domainId, domainName: candidate.domainName || null }],
				// P0 §2.4 — see the file header: the materialized graph carries no per-node completeness
				// signal, so this is UNCONDITIONALLY false until spec §7 P4's forgeCeds.js:306 fix lands.
				domainsComplete: false,
				range,
				isQualified,
				qualifier,
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
module.exports.resolveQualifier = resolveQualifier;
module.exports.resolveValueContext = resolveValueContext;
module.exports.asList = asList;
