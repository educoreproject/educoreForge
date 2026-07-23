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
// PURE: no I/O, no process.global.
//   ({ forged, declaredEmbeddingDims }) -> { blockText, nodeCount, edgeCount } | { error }
//
// declaredEmbeddingDims is the width the vectors were MADE at — [voyageEmbedding].embeddingDims,
// read by the embedding client and handed down by the caller. It used to be an in-code
// EMBEDDING_DIMS = 1024 stamped into every header regardless of what the block actually carried,
// which shadowed that settable key (polyArch2 §6). REQUIRED whenever any node carries a vector;
// with nothing embedded there is no width to declare and the header omits the key. Held in
// lockstep with shape-forged-graph, which makes the identical demand.

const path = require('path');

// tree-root lib/ (five levels up: forger/lib -> forger -> apps -> graph-builder -> apps -> root)
const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', '..', 'lib');
const replayBlock = require(path.join(TREE_LIB, 'replay', 'replay-block'));
const { SCHEMA_BLOCK_KIND } = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary'));

// -----
// carriedModelVersion — the ONE model version the embedded nodes say produced their vectors.
//   Returns { modelVersion } or { error }. It is CARRIED, never invented: this value is what
//   vectorIdForInput hashes, so standing in for a missing one silently changes what every
//   content address means (polyArch2 §6). Held in lockstep with shape-forged-graph's identical
//   refusal — the fidelity gate compares what these two produce, so a silent stamp on either
//   side weakens exactly the comparison this module exists for.

const carriedModelVersion = (forged) => {
	const embeddedNodes = forged.nodes.filter((oneNode) => oneNode.properties.embedding);

	const offender = embeddedNodes.find(
		(oneNode) =>
			oneNode.properties.embeddingModelVersion === undefined ||
			`${oneNode.properties.embeddingModelVersion}`.trim() === '',
	);
	if (offender) {
		return {
			error:
				`buildStandardBlock: node '${offender.stableId}' carries an embedding but its ` +
				`embeddingModelVersion is ${
					offender.properties.embeddingModelVersion === undefined
						? 'absent'
						: `'${offender.properties.embeddingModelVersion}'`
				}. The forge bundle must stamp the model that produced the vector — every content ` +
				`address is computed from it, so there is nothing to stand in for it.`,
		};
	}

	const distinct = embeddedNodes.reduce(
		(soFar, oneNode) =>
			soFar.includes(`${oneNode.properties.embeddingModelVersion}`.trim())
				? soFar
				: soFar.concat(`${oneNode.properties.embeddingModelVersion}`.trim()),
		[],
	);
	if (distinct.length > 1) {
		return {
			error:
				`buildStandardBlock: the block's nodes disagree about which model made their ` +
				`vectors (${distinct.join(', ')}). One block header can declare only one model ` +
				`version, and the addressing model must not change mid-block.`,
		};
	}

	// No embeddings means no vectors, and no vectors means there is no model version to declare.
	return { modelVersion: distinct[0] };
};

const buildStandardBlock = ({ forged, declaredEmbeddingDims }) => {
	const carried = carriedModelVersion(forged);
	if (carried.error) {
		return { error: carried.error };
	}

	const anythingEmbedded = forged.nodes.some((oneNode) => oneNode.properties.embedding);
	if (
		anythingEmbedded &&
		(!Number.isInteger(declaredEmbeddingDims) || declaredEmbeddingDims <= 0)
	) {
		return {
			error:
				`buildStandardBlock: declaredEmbeddingDims is ${
					declaredEmbeddingDims === undefined ? 'absent' : `'${declaredEmbeddingDims}'`
				}, and these nodes carry vectors. Pass the [voyageEmbedding].embeddingDims the ` +
				`vectors were made at — there is no in-code width to declare in the header.`,
		};
	}

	const header = {
		// The kind is READ from the vocabulary registry, not spelled here. This header used to say
		// 'standard' while the store accepted only 'standardBase' — one concept with two live words
		// and nothing reconciling them (Phase 1, 2026-07-23).
		blockType: SCHEMA_BLOCK_KIND.STANDARD_BASE,
		standardKey: forged.standardKey,
		version: forged.metadata.version,
		stableUriPropertyName: forged.stableUriPropertyName,
		resolutionKey: forged.stableUriPropertyName,
		embeddingModelVersion: carried.modelVersion,
		embeddingEncoding: 'base64',
		embeddingDtype: 'float32',
		embeddingByteOrder: 'little-endian',
		embeddingDims: declaredEmbeddingDims,
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
			serialized.embeddingModelVersion = oneNode.properties.embeddingModelVersion;
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

module.exports = { buildStandardBlock };
