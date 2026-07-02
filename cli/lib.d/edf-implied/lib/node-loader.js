'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// node-loader.js — read the gating manifest's CONTENT BLOCKS (the immutable, content-addressed input —
// NOT the mutable graph) and present in-memory scalar node records for the inferred-track inference half.
// Reading from blocks (the same source Phase-3/4 producers read) keeps the producer reproducible: the
// gating manifest is fixed, a replayed graph could drift.
//
// Exposes: deserialize(blockText) -> raw block; collapseNodes(rawNodes) -> scalar records
// { stableId, source, role, name, description, searchText, cedsId, canonicalKey, domainId, rangeClassId,
// rangeDatatype, depth, defText }; buildClassIndex(records) -> { classId -> { name, description } } for
// rendering a source element's domain class (or its rangeClassId, for a CEDS object/association property)
// in the reranker prompt. defText = description, then searchText, then name (the measured eval's defText
// choice; coverage ~100%). CARRY-FORWARD: a source node's own `cedsId` is the forge's per-node anchoring
// and DIVERGES from the authored crosswalk — it is NEVER used as a mapping target here.
//
// Pure read + synchronous collapse. No async/await, no try/catch for control flow. camelCase only.
//
// @concept: [[NodeLoader]]

const path = require('path');

const CORE_LIB = path.join(__dirname, '..', '..', '..', '..', 'npm', 'qtools-graph-forge-core', 'lib');
const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));

// single-element PG-JSON array -> scalar.
const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

// START OF moduleFunction() ============================================================

const moduleFunction = ({ moduleName } = {}) => () => {
	const deserialize = (blockText) => replayBlock.deserializeBlock(blockText);

	// collapseNodes — raw block nodes -> scalar records (defText resolved).
	const collapseNodes = (rawNodes) =>
		(rawNodes || []).map((oneNode) => {
			const p = oneNode.properties || {};
			const description = v1(p.description);
			const searchText = v1(p.searchText);
			const name = v1(p.name);
			const defText =
				description && `${description}`.trim() !== ''
					? description
					: searchText && `${searchText}`.trim() !== ''
						? searchText
						: name || '';
			return {
				stableId: oneNode.stableId,
				labels: oneNode.labels || [],
				source: v1(p._source),
				role: v1(p.role),
				name,
				description: description || '',
				searchText: searchText || '',
				cedsId: v1(p.cedsId) || null,
				canonicalKey: v1(p.canonicalKey) || null,
				domainId: v1(p.domainId) || null,
				rangeClassId: v1(p.rangeClassId) || null,
				rangeDatatype: v1(p.rangeDatatype) || null,
				rangeOptionSetId: v1(p.rangeOptionSetId) || null,
				parentId: v1(p.parentId) || null,
				notation: v1(p.notation) || null,
				depth: v1(p.depth),
				defText,
			};
		});

	// buildClassIndex — classId -> { name, description } from DmeClass records (for prompt domain rendering).
	const buildClassIndex = (records) => {
		const index = {};
		(records || []).forEach((oneRecord) => {
			if (oneRecord.role === 'DmeClass') {
				const key = oneRecord.cedsId || oneRecord.canonicalKey || oneRecord.stableId;
				index[key] = { name: oneRecord.name, description: oneRecord.description };
				// also key by stableId so a source domainId (which references a class node id) resolves.
				index[oneRecord.stableId] = { name: oneRecord.name, description: oneRecord.description };
			}
		});
		return index;
	};

	return { deserialize, collapseNodes, buildClassIndex };
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
