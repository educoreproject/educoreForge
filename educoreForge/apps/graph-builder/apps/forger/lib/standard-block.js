'use strict';

// standard-block.js — serialize a forged contract graph into ONE PG-JSONL 'standardBase' block.
//
// CARRIED FAITHFULLY from the incumbent forger's materializer (cli/lib.d/forger/lib/
// materializer.js buildStandardBlock, 2026-07-21): this is the PROVEN serialization — PG-JSON
// multi-valued arrays (every property value an array), the base64 float32 little-endian embedding
// exception, resolutionKey = stableUriPropertyName (greenfield, DECISIONS §1/§20). The block text
// is the forger's TRANSPORT into the scratch graph; the canonical stored block is the one
// replayManager harvests OUT of the graph later (materialize-and-harvest). Keeping this serializer
// byte-faithful to the incumbent is what keeps that eventual round-trip comparable.
//
// !! NO LONGER PART OF THE PIPELINE (work order Phase 5, 2026-07-22) !!
// The forger used to call this to serialize a schema block and hand it to replay(), which
// deserialized it again — objects -> string -> objects, purely to reach the only writer that
// existed. replayManager.init takes objects, so that round trip is gone and a schema block is now
// born in exactly ONE place: replayManager.harvest.
//
// This module survives DELIBERATELY, as the fixture for the punch-24 fidelity gate
// (apps/graph-builder/apps/replay-manager/test/integration-harvest.js): it is the only way to
// produce the "in-memory" side of the in-memory-vs-harvested comparison. Do not wire it back into
// the pipeline. If the fidelity gate is ever retired, this goes with it.
//
// PURE: no I/O, no process.global. ({ forged }) -> { blockText, nodeCount, edgeCount }.

const path = require('path');

// tree-root lib/ (five levels up: forger/lib -> forger -> apps -> graph-builder -> apps -> root)
const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', '..', 'lib');
const replayBlock = require(path.join(TREE_LIB, 'replay', 'replay-block'));
const { SCHEMA_BLOCK_KIND } = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary'));

const EMBEDDING_DIMS = 1024;

const buildStandardBlock = ({ forged }) => {
	const header = {
		// The kind is READ from the vocabulary registry, not spelled here. This header used to say
		// 'standard' while the store accepted only 'standardBase' — one concept with two live words
		// and nothing reconciling them (Phase 1, 2026-07-23).
		blockType: SCHEMA_BLOCK_KIND.STANDARD_BASE,
		standardKey: forged.standardKey,
		version: forged.metadata.version,
		stableUriPropertyName: forged.stableUriPropertyName,
		resolutionKey: forged.stableUriPropertyName,
		embeddingModelVersion: 'voyage-4-large',
		embeddingEncoding: 'base64',
		embeddingDtype: 'float32',
		embeddingByteOrder: 'little-endian',
		embeddingDims: EMBEDDING_DIMS,
	};

	const nodes = forged.nodes.map((oneNode) => {
		// PG-JSON multi-valued arrays: every property value an array (embedding excepted).
		const properties = {};
		Object.keys(oneNode.properties).forEach((oneKey) => {
			if (oneKey === 'embedding' || oneKey === 'embeddingModelVersion') {
				return; // embedding is the base64 scalar exception; modelVersion rides the node
			}
			const value = oneNode.properties[oneKey];
			properties[oneKey] = Array.isArray(value) ? value : [value];
		});

		const serialized = {
			ref: { source: oneNode.properties._source, id: oneNode.stableId },
			labels: oneNode.labels,
			stableId: oneNode.stableId,
			properties,
		};
		if (oneNode.properties.embedding) {
			serialized.embedding = replayBlock.encodeEmbedding(oneNode.properties.embedding);
			serialized.embeddingModelVersion =
				oneNode.properties.embeddingModelVersion || 'voyage-4-large';
		}
		return serialized;
	});

	const edges = forged.edges.map((oneEdge) => {
		const properties = {};
		Object.keys(oneEdge.properties || {}).forEach((oneKey) => {
			const value = oneEdge.properties[oneKey];
			properties[oneKey] = Array.isArray(value) ? value : [value];
		});
		return {
			type: oneEdge.type,
			fromRef: oneEdge.fromRef,
			toRef: oneEdge.toRef,
			properties,
		};
	});

	const blockText = replayBlock.serializeBlock({ header, nodes, edges });
	return { blockText, nodeCount: nodes.length, edgeCount: edges.length };
};

module.exports = { buildStandardBlock, EMBEDDING_DIMS };
