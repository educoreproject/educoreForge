'use strict';

// shape-forged-graph.js — turn a forge bundle's output into ENGINE-SHAPED nodes and edges.
//
// WHY THIS EXISTS AND WHY IT LIVES HERE (work order Phase 2):
// A forge bundle returns nodes shaped for a forge bundle's convenience — properties as scalars,
// `_source` buried among them, the embedding sitting inside `properties`. The replay engine writes
// nodes shaped for a graph — an externalized `ref {source, id}`, PG-JSON property arrays, the
// embedding at the top level. Something must translate, and the translation is BUNDLE knowledge,
// not GRAPH knowledge. It therefore lives with the forger and NOT in replayManager, which stays
// ignorant of what a forge bundle looks like inside.
//
// This is the pure half of what `standard-block.js buildStandardBlock` used to do on the way to
// serializing a schema block. The serializing half is what the architecture is deleting: a schema
// block is born only at harvest.
//
// PURE: no I/O, no process.global. ({ forged }) -> { nodes, edges, embeddingDims }.

const EMBEDDING_DIMS = 1024;

// The float32 NARROWING is deliberate and load-bearing (code fact, 2026-07-22): the block path
// encoded every vector to base64 float32 and decoded it again, so what actually reached Neo4j was
// always float32-precision, stored in Neo4j's 64-bit doubles. Handing the raw provider vector
// straight through would silently store MORE precision than the old path did and change every
// vector in the graph. Math.fround performs exactly the narrowing the codec performed, so removing
// the serialization round trip does not quietly change the data that survives it.
const narrowToFloat32 = (floatList) => floatList.map((oneValue) => Math.fround(oneValue));

const shapeForgedGraph = ({ forged }) => {
	if (!forged || !Array.isArray(forged.nodes) || !Array.isArray(forged.edges)) {
		return { error: 'shapeForgedGraph: forged must carry nodes[] and edges[]' };
	}

	let dimsSeen = null;
	let dimsOffender = null;
	let modelVersionOffender = null;

	const nodes = forged.nodes.map((oneNode) => {
		// PG-JSON multi-valued arrays: every property value an array. The embedding is the
		// deliberate exception (a vector's order is intrinsic) and rides at the top level.
		const properties = {};
		Object.keys(oneNode.properties).forEach((oneKey) => {
			if (oneKey === 'embedding' || oneKey === 'embeddingModelVersion') {
				return;
			}
			const value = oneNode.properties[oneKey];
			properties[oneKey] = Array.isArray(value) ? value : [value];
		});

		const shaped = {
			// ref.id externalizes the stableId value — the greenfield resolution key.
			ref: { source: oneNode.properties._source, id: oneNode.stableId },
			labels: oneNode.labels,
			stableId: oneNode.stableId,
			properties,
		};

		if (oneNode.properties.embedding) {
			const vector = oneNode.properties.embedding;
			if (dimsSeen === null) {
				dimsSeen = vector.length;
			} else if (vector.length !== dimsSeen && dimsOffender === null) {
				dimsOffender = { stableId: oneNode.stableId, length: vector.length };
			}
			shaped.embedding = narrowToFloat32(vector);
			// The model version is CARRIED, never invented. It is what vectorIdForInput hashes,
			// so standing in for a missing one does not merely behave oddly — it silently changes
			// what every content address means (polyArch2 §6). A bundle that embedded a node
			// without stamping the model that did it produced malformed output; say so.
			const carriedModelVersion = oneNode.properties.embeddingModelVersion;
			if (
				carriedModelVersion === undefined ||
				`${carriedModelVersion}`.trim() === ''
			) {
				if (modelVersionOffender === null) {
					modelVersionOffender = {
						stableId: oneNode.stableId,
						given: carriedModelVersion,
					};
				}
			}
			shaped.embeddingModelVersion = carriedModelVersion;
		}

		return shaped;
	});

	if (modelVersionOffender) {
		return {
			error:
				`shapeForgedGraph: node '${modelVersionOffender.stableId}' carries an embedding but ` +
				`its embeddingModelVersion is ${
					modelVersionOffender.given === undefined
						? 'absent'
						: `'${modelVersionOffender.given}'`
				}. The forge bundle must stamp the model that produced the vector — every content ` +
				`address is computed from it, so there is nothing to stand in for it.`,
		};
	}

	// A ragged vector set means the addressing model changed mid-run or a provider truncated a
	// batch. It would be written happily and poison every similarity query, so refuse loudly.
	if (dimsOffender) {
		return {
			error:
				`shapeForgedGraph: inconsistent embedding dimensions — most vectors are ${dimsSeen} ` +
				`but node '${dimsOffender.stableId}' has ${dimsOffender.length}. Refusing to write a ` +
				`ragged vector set.`,
		};
	}
	if (dimsSeen !== null && dimsSeen !== EMBEDDING_DIMS) {
		return {
			error:
				`shapeForgedGraph: embedding dimension ${dimsSeen} does not match the declared ` +
				`${EMBEDDING_DIMS}. The addressing model and the vector model must agree.`,
		};
	}

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

	// embeddingDims is null when nothing was embedded (the vectorize:false spend knob). The engine
	// reads that as "no vector index", which is correct: there are no vectors to index.
	return { nodes, edges, embeddingDims: dimsSeen };
};

module.exports = { shapeForgedGraph, EMBEDDING_DIMS, narrowToFloat32 };
