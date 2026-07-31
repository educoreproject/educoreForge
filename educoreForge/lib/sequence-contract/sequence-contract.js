'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sequence-contract.js — the CENTRAL SEQUENCE-PROPERTY authority for the universal forge contract
// (design-authority upgrade to the SIF sequence-capture work order, 2026-07-30). Sibling family to
// lib/structural-contract/structural-contract.js: same house shape (a pure module + its own test
// dir), same discipline (additive, refuse-by-value). Every forge that can see ELEMENT ORDER calls
// finalizeSequence as (one of) the last steps of its buildContractGraph, so the sequence properties
// every consumer reads (sequenceOrdinal / siblingCount / orderSemantics) are defined and derived in
// ONE place instead of once per standard. forges/sif is the FIRST caller (Phase A of the work order
// this module belongs to); a future XSD-shaped forge (JEDX, PESC, medbiquitous, ...) that can see
// element order calls the SAME module rather than inventing its own per-standard ordinal names.
//
// THE CONTRACT (what this module makes true, or refuses BY NAME via its callback):
//   sequenceOrdinal — 0-based position of a node within ITS OWN SIBLING GROUP, exactly as the
//     caller's parser saw it. ONE uniform property name for EVERY standard (the naming ruling this
//     module encodes: no per-certainty property-name variants — a uniform name, an honest marker).
//   siblingCount — the size of that same sibling group (>= 1; a group of one still gets stamped,
//     honestly — "1 of 1" is real information, not a degenerate case to special-case away).
//   orderSemantics — 'normative' when the caller's parser POSITIVELY VERIFIED a schema-ordered group
//     (e.g. xs:sequence, where the schema itself makes reordering the children invalid); 'document'
//     when only document/source order is known (xs:choice children, whose order is not schema-
//     normative, OR a parser/source format that never captured the compositor at all — e.g. a
//     flattened TSV implementation-specification with no group-type column). A caller that cannot
//     VERIFY normative order MUST say 'document' — this module refuses any other value, so a forge
//     can never accidentally claim schema semantics it never checked.
//
// ADDITIVE ONLY (the P4 address-stability ruling, carried into this module unchanged): the three
// properties above are EXTRA properties on an already-built node. This module never reads or writes
// stableId, parentId, path, depth, or any other addressing/identity slot — a forge that never calls
// finalizeSequence is byte-unchanged; a forge that DOES call it gains exactly these three properties
// on the nodes named in orderingByParent, and nothing else moves.
//
// Pure + synchronous + deterministic: no I/O, no DI, no clock. Mutates node.properties IN PLACE
// (mirrors structural-contract's own convention) and delivers { nodes } via its callback.
// CALLBACK-SHAPED (R7 — "ALL CONTRACT CALLABLES ARE CALLBACK-SHAPED, WHETHER THEY NEED ONE OR NOT",
// TQ ruling 2026-07-29, bridgeEvidenceRefactor-spec.md §4): a malformed input is refused BY NAME via
// callback(errString), never thrown across this boundary — unlike structural-contract.js (which
// predates R7 and throws), this module is written to the post-R7 house convention explicitly named
// in the design-authority upgrade.
//
// @concept: [[SequenceContract]]
// @concept: [[UniversalForgeContract]]

const path = require('path');
const { SEQUENCE_PROPERTIES, SEQUENCE_ORDER_SEMANTICS_VALUES } = require(
	path.join(__dirname, '..', 'vocabulary', 'vocabulary'),
);

const P = SEQUENCE_PROPERTIES;

// =====================================================================
// finalizeSequence — ({ nodes, orderingByParent }, callback(errString, { nodes }=))
// =====================================================================
//
//   nodes             the forge's in-progress node array — SAME array structural-contract works on;
//                     node.properties is mutated in place, exactly that module's own convention.
//   orderingByParent  { [groupKey]: { orderSemantics: 'normative'|'document', members: [stableId, ...] } }
//                     ONE entry per sibling group the caller's parser saw. `groupKey` is NEVER read by
//                     this module beyond error-message provenance — callers are free to key it however
//                     is convenient (a parent stableId, a synthetic group label, ...); it does not have
//                     to be, and often is not, a real node's stableId. `members` is the ORDERED list of
//                     that group's children, named by THEIR OWN stableId — array index IS the
//                     sequenceOrdinal this module stamps. A group's members must be non-empty, distinct,
//                     and every one of them must resolve to a node actually present in `nodes` — an
//                     unresolvable or duplicate member is refused BY NAME, never silently skipped.
//
// Refuses (via callback(errString), no second argument):
//   - nodes not an array
//   - orderingByParent not a plain object
//   - a group whose orderSemantics is not exactly 'normative' or 'document'
//   - a group whose members is not a non-empty array
//   - a group listing the same member stableId more than once
//   - a group member stableId that resolves to no node in `nodes`
//
// On success: callback('', { nodes }) — every named member now carries sequenceOrdinal (0-based),
// siblingCount, and orderSemantics; nothing else on any node is touched.
const finalizeSequence = ({ nodes, orderingByParent } = {}, callback) => {
	if (!Array.isArray(nodes)) {
		callback(`${moduleName}: nodes is not an array (got ${typeof nodes})`);
		return;
	}
	if (!orderingByParent || typeof orderingByParent !== 'object' || Array.isArray(orderingByParent)) {
		callback(
			`${moduleName}: orderingByParent is not a plain object (got ${
				Array.isArray(orderingByParent) ? 'array' : typeof orderingByParent
			})`,
		);
		return;
	}

	const nodeByStableId = {};
	nodes.forEach((oneNode) => {
		nodeByStableId[oneNode.stableId] = oneNode;
	});

	const groupKeys = Object.keys(orderingByParent);
	for (let gi = 0; gi < groupKeys.length; gi++) {
		const groupKey = groupKeys[gi];
		const group = orderingByParent[groupKey];
		if (!group || typeof group !== 'object') {
			callback(`${moduleName}: orderingByParent['${groupKey}'] is not an object`);
			return;
		}
		if (!SEQUENCE_ORDER_SEMANTICS_VALUES.includes(group.orderSemantics)) {
			callback(
				`${moduleName}: orderingByParent['${groupKey}'].orderSemantics must be one of ` +
					`${SEQUENCE_ORDER_SEMANTICS_VALUES.join(', ')} (got ${JSON.stringify(group.orderSemantics)}) — ` +
					`a caller that cannot verify schema-ordered semantics must say 'document', never guess 'normative'`,
			);
			return;
		}
		if (!Array.isArray(group.members) || group.members.length === 0) {
			callback(
				`${moduleName}: orderingByParent['${groupKey}'].members must be a non-empty array ` +
					`(got ${JSON.stringify(group.members)})`,
			);
			return;
		}
		const seen = new Set();
		for (let mi = 0; mi < group.members.length; mi++) {
			const memberStableId = group.members[mi];
			if (seen.has(memberStableId)) {
				callback(
					`${moduleName}: orderingByParent['${groupKey}'].members lists '${memberStableId}' more than ` +
						`once — a sibling group's members must be distinct`,
				);
				return;
			}
			seen.add(memberStableId);
			const memberNode = nodeByStableId[memberStableId];
			if (!memberNode) {
				callback(
					`${moduleName}: orderingByParent['${groupKey}'].members['${memberStableId}'] does not resolve ` +
						`to any node in the given nodes[] — never stamp an unresolvable member`,
				);
				return;
			}
			memberNode.properties[P.SEQUENCE_ORDINAL] = mi;
			memberNode.properties[P.SIBLING_COUNT] = group.members.length;
			memberNode.properties[P.ORDER_SEMANTICS] = group.orderSemantics;
		}
	}

	callback('', { nodes });
};

module.exports = {
	finalizeSequence,
	SEQUENCE_PROPERTIES: P,
	SEQUENCE_ORDER_SEMANTICS_VALUES,
};
