'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// structural-contract.js — the CENTRAL structural-property authority for the universal forge
// contract (Wave-2 items 5/6; findings M7/M8). Every producer calls finalizeStructuralContract
// as the LAST step of its buildContractGraph, so the structural properties every consumer walks
// (parentId / depth / crossRefs) are defined and derived in ONE place instead of sixteen.
//
// THE CONTRACT (what this module makes true, or throws):
//   parentId — present on every non-root node and resolves to a MEMBER node's stableId (the ONE
//     referent; value-scope.js and neighborhood loaders walk stableId). The producer asserts the
//     parent (it knows its containment/taxonomy semantics); this module ENFORCES the referent.
//     A violation throws a named diagnostic distinguishing "matches a member _id — wrong referent
//     stamped" from "matches no member at all" (never silent).
//   single-owner optionSet alignment — a ROOT-parented DmeOptionSet with EXACTLY ONE owning
//     DmeProperty (one distinct HAS_OPTION_SET source) is re-parented to that property's stableId,
//     so the value -> optionSet -> property chain value-scoping walks is real for every producer,
//     not just the CASE family. Multi-owner and orphan sets honestly stay on the root.
//   depth — DERIVED, = parentId-chain length to the root (root itself = 0). Producer-stamped
//     depth values are superseded (overwritten) here; the per-module role tables that drifted
//     (SOC flat 1, optionSet 2-with-root-parent) are dead as inputs.
//   crossRefs — ALWAYS present; stamped as the JSON string '[]' when the producer harvested
//     nothing (kills the same-role-different-key-set drift; consumers JSON.parse unconditionally).
//
// Pure + synchronous + deterministic: operates on the in-memory { nodes, edges } a producer
// built; no I/O, no DI, no clock. Mutates node.properties in place and returns { nodes, edges }.
// Throws on contract violations (surfaced by the forge orchestrator as a forge error, the same
// path as the producers' R3/R4 throws). camelCase only.
//
// @concept: [[StructuralContract]]
// @concept: [[UniversalForgeContract]]

const path = require('path');
const { DME_ROLES, EDGE_TYPES, STRUCTURAL_PROPERTIES } = require(
	path.join(__dirname, '..', 'vocabulary', 'vocabulary'),
);

const P = STRUCTURAL_PROPERTIES;

// classifyParentReferent — diagnostic classifier for a parentId that failed stableId resolution:
// 'wrongReferent' (matches a member's _id — the producer stamped the _id-form) vs 'unresolvable'
// (matches no member at all). Exported for harnesses/tests.
const classifyParentReferent = ({ parentId, memberByStableId, memberByInternalId }) => {
	if (memberByStableId[parentId]) {
		return 'stableId';
	}
	if (memberByInternalId[parentId]) {
		return 'wrongReferent';
	}
	return 'unresolvable';
};

// finalizeStructuralContract — { nodes, edges } -> { nodes, edges } (node.properties mutated).
// See the module header for the contract enforced/derived. Throws Error on violation.
const finalizeStructuralContract = ({ nodes, edges }) => {
	const memberByStableId = {};
	const memberByInternalId = {};
	const rootNodes = [];

	(nodes || []).forEach((oneNode) => {
		memberByStableId[oneNode.stableId] = oneNode;
		const internalId = oneNode.properties && oneNode.properties._id;
		if (internalId !== undefined) {
			memberByInternalId[internalId] = oneNode;
		}
		if (oneNode.role === DME_ROLES.STANDARD_ROOT) {
			rootNodes.push(oneNode);
		}
	});

	if (rootNodes.length !== 1) {
		throw new Error(
			`structural-contract: expected exactly one ${DME_ROLES.STANDARD_ROOT}, found ${rootNodes.length}`,
		);
	}
	const rootStableId = rootNodes[0].stableId;

	// ---- single-owner optionSet alignment (M8) ----
	// distinct HAS_OPTION_SET owners per option-set stableId; owner must be a member DmeProperty.
	const optionSetOwners = {};
	(edges || []).forEach((oneEdge) => {
		if (oneEdge.type !== EDGE_TYPES.HAS_OPTION_SET) {
			return;
		}
		const ownerStableId = oneEdge.fromRef && oneEdge.fromRef.id;
		const setStableId = oneEdge.toRef && oneEdge.toRef.id;
		const owner = memberByStableId[ownerStableId];
		if (!owner || owner.role !== DME_ROLES.PROPERTY) {
			return;
		}
		(optionSetOwners[setStableId] = optionSetOwners[setStableId] || {})[ownerStableId] = true;
	});

	nodes.forEach((oneNode) => {
		if (oneNode.role !== DME_ROLES.OPTION_SET) {
			return;
		}
		if (oneNode.properties[P.PARENT_ID] !== rootStableId) {
			return; // producer asserted a real owner (CASE family) — respected as-is
		}
		const ownerStableIds = Object.keys(optionSetOwners[oneNode.stableId] || {});
		if (ownerStableIds.length === 1) {
			oneNode.properties[P.PARENT_ID] = ownerStableIds[0];
		}
	});

	// ---- parentId referent enforcement (M7) ----
	const violations = [];
	nodes.forEach((oneNode) => {
		if (oneNode.role === DME_ROLES.STANDARD_ROOT) {
			return; // the root has no parent (parentId absent by contract)
		}
		const parentId = oneNode.properties[P.PARENT_ID];
		if (parentId === undefined || parentId === null || parentId === '') {
			violations.push({ stableId: oneNode.stableId, role: oneNode.role, reason: 'missing parentId' });
			return;
		}
		const referent = classifyParentReferent({ parentId, memberByStableId, memberByInternalId });
		if (referent === 'wrongReferent') {
			violations.push({
				stableId: oneNode.stableId,
				role: oneNode.role,
				reason: `parentId '${parentId}' matches a member _id, not a stableId — wrong referent stamped`,
			});
			return;
		}
		if (referent === 'unresolvable') {
			violations.push({
				stableId: oneNode.stableId,
				role: oneNode.role,
				reason: `parentId '${parentId}' matches no member stableId (unresolvable)`,
			});
		}
	});

	if (violations.length > 0) {
		const shown = violations
			.slice(0, 5)
			.map((oneV) => `${oneV.role} '${oneV.stableId}': ${oneV.reason}`)
			.join('; ');
		throw new Error(
			`structural-contract: ${violations.length} parentId contract violation(s) — ${shown}${violations.length > 5 ? '; …' : ''}`,
		);
	}

	// ---- depth derivation (M8): depth = parentId-chain length to the root; root = 0 ----
	const depthByStableId = {};
	const depthFor = (oneNode) => {
		const chain = [];
		let cursor = oneNode;
		while (cursor) {
			if (depthByStableId[cursor.stableId] !== undefined) {
				break;
			}
			if (chain.indexOf(cursor) !== -1) {
				throw new Error(
					`structural-contract: parentId cycle at '${cursor.stableId}' (chain: ${chain.map((n) => n.stableId).join(' -> ')})`,
				);
			}
			chain.push(cursor);
			cursor =
				cursor.role === DME_ROLES.STANDARD_ROOT
					? null
					: memberByStableId[cursor.properties[P.PARENT_ID]];
		}
		// cursor is the nearest already-depth-assigned ancestor (the pre-seeded root at minimum,
		// since every parentId was validated above); a null cursor cannot occur post-validation.
		let base = cursor ? depthByStableId[cursor.stableId] : -1;
		// assign depths back down the chain (last element is nearest the root)
		for (let i = chain.length - 1; i >= 0; i--) {
			base = base + 1;
			depthByStableId[chain[i].stableId] = base;
		}
		return depthByStableId[oneNode.stableId];
	};

	// root anchors the recursion at 0
	depthByStableId[rootStableId] = 0;
	nodes.forEach((oneNode) => {
		oneNode.properties[P.DEPTH] = depthFor(oneNode);
	});

	// ---- crossRefs universality (M8) ----
	nodes.forEach((oneNode) => {
		if (oneNode.properties[P.CROSS_REFS] === undefined) {
			oneNode.properties[P.CROSS_REFS] = '[]';
		}
	});

	return { nodes, edges };
};

module.exports = { finalizeStructuralContract, classifyParentReferent };
