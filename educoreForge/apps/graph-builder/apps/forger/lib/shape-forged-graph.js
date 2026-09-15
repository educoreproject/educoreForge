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
// PURE: no I/O, no process.global.
//   ({ forged, declaredEmbeddingDims }) -> { nodes, edges, embeddingDims }
//
// declaredEmbeddingDims is the width the vectors were MADE at — [voyageEmbedding].embeddingDims,
// read by the embedding client and handed down by the caller. It used to be an in-code
// EMBEDDING_DIMS = 1024, which shadowed that settable key: configure 512 and every vector was
// refused for disagreeing with a number the operator never typed (polyArch2 §6 — an in-code
// constant is legitimate only where nothing is settable). It is REQUIRED whenever any node
// carries a vector, and unused when none does: with no vectors there is no width to agree about.

// The float32 NARROWING is deliberate and load-bearing (code fact, 2026-07-22): the block path
// encoded every vector to base64 float32 and decoded it again, so what actually reached Neo4j was
// always float32-precision, stored in Neo4j's 64-bit doubles. Handing the raw provider vector
// straight through would silently store MORE precision than the old path did and change every
// vector in the graph. Math.fround performs exactly the narrowing the codec performed, so removing
// the serialization round trip does not quietly change the data that survives it.
const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// The vector-slot declaration rule lives in the engine, which lands the vector back under the declared
// name at restore; the shaper asks the same function so the two ends cannot disagree about it.
const { vectorSlotPropertyNameOf, ORDINARY_VECTOR_PROPERTY_NAME } =
	require('../../../../../lib/replay/replay-engine')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
const narrowToFloat32 = (floatList) => floatList.map((oneValue) => Math.fround(oneValue));

// ⟪R-ET-8, R-ET-30, PLAN-forgeEmbedText-091426 §8.3-8.4⟫ ONE VECTOR SLOT. A forge record MAY declare, by
// the ordinary property `vectorPropertyName`, that its vector lives under that property rather than
// `embedding` (a DmeEmbedText node declares 'textEmbedding' beside embedSourceProperty 'text'). The shaper
// LIFTS that vector into the same top-level `embedding` slot every vector rides in, so the ragged-dimension
// and model-version guards below cover it and the float32 narrowing applies to it. A record WITHOUT the
// declaration is the original format and takes exactly the old path: a format discriminator in the R-P2-2
// idiom, not a default. Returns { error } or { vectorSlotPropertyName }.
const forgeRecordVectorSlotOf = (oneNode) => {
	const forgeProperties = oneNode.properties;
	const declaredName = forgeProperties.vectorPropertyName;
	if (declaredName === undefined || declaredName === null) {
		return { error: '', vectorSlotPropertyName: ORDINARY_VECTOR_PROPERTY_NAME };
	}
	const declarationVerdict = vectorSlotPropertyNameOf({
		stableId: oneNode.stableId,
		declaredName,
		embedSourcePropertyValue: forgeProperties.embedSourceProperty,
	});
	if (declarationVerdict.error) {
		return declarationVerdict;
	}
	if (forgeProperties[ORDINARY_VECTOR_PROPERTY_NAME] !== undefined && forgeProperties[ORDINARY_VECTOR_PROPERTY_NAME] !== null) {
		return {
			error:
				`node '${oneNode.stableId}' declares vectorPropertyName '${declaredName}' AND carries ` +
				`'${ORDINARY_VECTOR_PROPERTY_NAME}'. A record has ONE vector slot: a declared vector lives only ` +
				`under '${declaredName}', and an '${ORDINARY_VECTOR_PROPERTY_NAME}' beside the declaration would ` +
				`enter the ordinary vector index.`,
		};
	}
	const declaredVector = forgeProperties[declaredName];
	if (declaredVector !== undefined && declaredVector !== null && !(Array.isArray(declaredVector) && declaredVector.length > 0)) {
		return {
			error:
				`node '${oneNode.stableId}' declares vectorPropertyName '${declaredName}' but the value ` +
				`there is not a non-empty vector (got ${Array.isArray(declaredVector) ? 'an empty array' : typeof declaredVector}).`,
		};
	}
	return declarationVerdict;
};

const shapeForgedGraph = ({ forged, declaredEmbeddingDims }) => {
	if (!forged || !Array.isArray(forged.nodes) || !Array.isArray(forged.edges)) {
		return { error: 'shapeForgedGraph: forged must carry nodes[] and edges[]' };
	}

	let dimsSeen = null;
	let dimsOffender = null;
	let modelVersionOffender = null;
	let vectorSlotOffender = null;

	const nodes = forged.nodes.map((oneNode) => {
		const vectorSlotVerdict = forgeRecordVectorSlotOf(oneNode);
		if (vectorSlotVerdict.error) {
			// refused below, before any shaped node is returned
			if (vectorSlotOffender === null) {
				vectorSlotOffender = vectorSlotVerdict.error;
			}
			return null;
		}
		const vectorSlotPropertyName = vectorSlotVerdict.vectorSlotPropertyName;

		// PG-JSON multi-valued arrays: every property value an array. The embedding is the
		// deliberate exception (a vector's order is intrinsic) and rides at the top level.
		const properties = {};
		Object.keys(oneNode.properties).forEach((oneKey) => {
			if (oneKey === 'embedding' || oneKey === 'embeddingModelVersion' || oneKey === vectorSlotPropertyName) {
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

		if (oneNode.properties[vectorSlotPropertyName]) {
			const vector = oneNode.properties[vectorSlotPropertyName];
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

	if (vectorSlotOffender) {
		return { error: `shapeForgedGraph: ${vectorSlotOffender}` };
	}

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
	if (dimsSeen !== null) {
		if (!Number.isInteger(declaredEmbeddingDims) || declaredEmbeddingDims <= 0) {
			return {
				error:
					`shapeForgedGraph: declaredEmbeddingDims is ${
						declaredEmbeddingDims === undefined
							? 'absent'
							: `'${declaredEmbeddingDims}'`
					}, and these nodes carry vectors. Pass the [voyageEmbedding].embeddingDims the ` +
					`vectors were made at — there is no in-code width to compare against.`,
			};
		}
		if (dimsSeen !== declaredEmbeddingDims) {
			return {
				error:
					`shapeForgedGraph: embedding dimension ${dimsSeen} does not match the declared ` +
					`${declaredEmbeddingDims}. The addressing model and the vector model must agree.`,
			};
		}
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

return { shapeForgedGraph, narrowToFloat32 };
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
