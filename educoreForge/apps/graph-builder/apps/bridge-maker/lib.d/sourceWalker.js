'use strict';

// sourceWalker.js — lib.d EXTRACT (bridgeKitRefactor_072726 design §4.1). A faithful COPY of the
// node-reading half semanticBridge keeps inline (bridges/semanticBridge.js: readForged,
// flattenNodeRecord, flattenCandidateRecord) — the "walk" move of the five-move loop (design §4.3).
// semanticBridge.js is left UNTOUCHED (P2 coexist: the old bridges keep composing their own inline
// copy); P1's equivalence gate (test-kit-equivalence.js) is what proves this copy reproduces the
// SAME flattened records semanticBridge's inline reader does, over the same fixture graph.
//
// THE CASE RULE preserved exactly: the recipe token is lowercase ('ctdl'); the forged `_source`
// stamp is uppercase ('CTDL'). `walk` upcases the standard token before reading — precisely as the
// incumbent readForged/readSourceNodes does (reading by the raw lowercase token was the
// "0 sources extracted" bug semanticBridge.js documents).
//
// ONE function serves BOTH tiers this kit reads today: a subject standard's OWN mappable elements
// (the default flatten, flattenNodeRecord) and the hub's CANDIDATE elements (flatten:
// flattenCandidateRecord, which additionally carries the CEDS Global ID the pipeline emits as
// targetKey) — exactly as semanticBridge's readForged already serves both call sites with an
// optional `flatten` parameter.
//
//   sourceWalker({ graphReader }) -> {
//       walk({ standard, role = 'DmeProperty', flatten = flattenNodeRecord }, callback('', { sourceNodes }))
//   }
//
// PURE mapping over the injected READ seam (graphReader.readNodes); no Neo4j of its own, no
// network, no LLM. callback(errString, result) — err is '' on success. camelCase only.

const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

// flattenNodeRecord — a graphReader node ({ stableId, properties }, SCALAR props) -> the flat record
// shape inferencePipeline/inferredIndex/the kit work in. Byte-for-byte semanticBridge's helper.
const flattenNodeRecord = (oneNode) => {
	const props = oneNode.properties || {};
	return {
		stableId: oneNode.stableId,
		role: v1(props.role),
		name: v1(props.name),
		defText: v1(props.defText) || v1(props.description) || v1(props.searchText) || v1(props.name),
		domainId: v1(props.domainId) || null,
		rangeDatatype: v1(props.rangeDatatype) || null,
		parentId: v1(props.parentId) || null,
		notation: v1(props.notation) || null,
		canonicalKey: v1(props.canonicalKey) || null,
		rangeOptionSetId: v1(props.rangeOptionSetId) || null,
	};
};

// flattenCandidateRecord — flattenNodeRecord + the CEDS Global ID the pipeline emits as targetKey.
// Byte-for-byte semanticBridge's helper.
const flattenCandidateRecord = (oneNode) => {
	const props = oneNode.properties || {};
	return {
		...flattenNodeRecord(oneNode),
		cedsId: v1(props.cedsId) || v1(props.canonicalKey) || v1(props.propertyKey),
	};
};

// flattenFullRecord — bridgeEvidenceRefactor-spec.md §5 retrieval-enrichment reversal. NEW, ADDITIVE:
// flattenNodeRecord/flattenCandidateRecord above are UNTOUCHED, byte-for-byte, and every existing
// caller (inferencePipeline, semanticBridge, bridgeSkeleton's default walk move) keeps calling `walk`
// with its existing `flatten` (or none) and keeps getting the exact same thin slice it always has —
// this is a THIRD flatten a caller opts INTO by passing `flatten: flattenFullRecord`, never a change
// to what the other two produce. COEXISTENCE is therefore by construction, not by convention: nothing
// here can perturb an existing consumer because nothing existing ever names this function.
//
// The evidence composer (lib/evidenceComposer.js, P2) needs the FULL element on both sides — "every
// property the graph node carries", not the name/defText slice §5 says retrieval currently
// pre-decides relevance with. Mechanism chosen: every RAW scalar property the node carries is merged
// in FIRST, then flattenCandidateRecord's own computed fields (the defText fallback chain, cedsId,
// the null-coalesced convenience keys) are layered on TOP and win on overlap — a caller reading
// record.defText still gets the fallback-computed value, never a raw `undefined` that happened to
// exist on the node; everything the flat shape does NOT already surface (hubName, hubVersion,
// addressSignature, qualifierKeys, referenceTier, anchorUri, embedding, uri, ...) rides through
// unfiltered. Scalar-normalized with the SAME v1() the flat fields already use, so an array-collapsed
// Neo4j property reads identically whether accessed via its flat key or its raw key.
const flattenFullRecord = (oneNode) => {
	const props = oneNode.properties || {};
	const rawScalars = {};
	Object.keys(props).forEach((oneKey) => {
		rawScalars[oneKey] = v1(props[oneKey]);
	});
	return {
		...rawScalars,
		...flattenCandidateRecord(oneNode),
	};
};

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ graphReader } = {}) => {
		if (!graphReader || typeof graphReader.readNodes !== 'function') {
			throw new Error(
				`${moduleName}: constructed without a graphReader (readNodes). sourceWalker extracts a ` +
					`standard's mappable elements by reading :ForgedNode through the injected read seam; ` +
					`there is no default reader.`,
			);
		}

		// walk — the ONLY move: read a role-scoped :ForgedNode set for one standard, flattened.
		const walk = ({ standard, role = 'DmeProperty', flatten = flattenNodeRecord } = {}, callback) => {
			if (typeof standard !== 'string' || standard.trim() === '') {
				callback(
					`${moduleName}: standard is not given — sourceWalker must be told which standard's ` +
						`elements to extract; there is no default.`,
				);
				return;
			}
			// THE CASE RULE: the recipe token is lowercase ('ctdl'); forged _source is uppercase ('CTDL').
			const standardKey = standard.toUpperCase();
			graphReader.readNodes(
				{ label: 'ForgedNode', propertyEquals: { _source: standardKey, role } },
				(err, out) => {
					if (err) {
						callback(`${moduleName}: reading ${standardKey} ${role} elements: ${err}`);
						return;
					}
					callback('', { sourceNodes: ((out || {}).nodes || []).map(flatten) });
				},
			);
		};

		return { walk };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.flattenNodeRecord = flattenNodeRecord;
module.exports.flattenCandidateRecord = flattenCandidateRecord;
module.exports.flattenFullRecord = flattenFullRecord;
