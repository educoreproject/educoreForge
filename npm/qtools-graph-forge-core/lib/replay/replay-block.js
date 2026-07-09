'use strict';

// replay-block.js — PG-JSONL graph replay block serializer + deserializer (Phase 2).
//
// Conforms to the FROZEN block-format contract (CONTRACT-pgjsonl-block-format-061426.md,
// schemas.md §2). A block is line-delimited JSON: line 1 = header, every later line = one
// node or one edge. Properties are PG-JSON multi-valued arrays (every value an array). The
// embedding is the deliberate base64 SCALAR exception — a single base64 float32 little-endian
// string — because PG-JSON value-arrays are spec-unordered and a vector's order is intrinsic.
//
// GREENFIELD RESOLUTION (DECISIONS-firstApp §1, §20): the durable resolution key is the
// node's stableId (= the value of the standard's stableUriPropertyName). Edge fromRef/toRef
// externalize that stableId value. There is NO (_source,_id) composite key here — this is the
// switch away from the legacy prototype. serializerVersion is stamped "1" and read, but NO
// version-dispatch logic exists until a second block format does (§20).
//
// Async style (DECISIONS §2): the (de)serializer codec is PURE and synchronous; extractBlock
// lives in replay-engine.js. No async/await, no try/catch for control flow. camelCase only.
//
// @concept: [[ReplayBlock]]
// @concept: [[PgJsonlBlockFormat]]
// @concept: [[Base64EmbeddingCodec]]
// @concept: [[GreenfieldResolutionKey]]
// @concept: [[Replay]]

const SERIALIZER_VERSION = '1';

// Edge type is a validated identifier (CONTRACT; schemas.md §2). Guards against Cypher
// injection through the relationship-type position, which cannot be parameterized.
// Phase 1: the edge-type regex + validator now come from the canonical vocabulary registry (single
// source of truth). Values/behavior are byte-identical; replay-block still re-exports them, so its
// public API is unchanged.
const { EDGE_TYPE_RE, isValidEdgeType } = require('../vocabulary/vocabulary');

// provenanceTier — the four-value canonical set (DECISIONS §11/§21).
// Phase 1: the canonical provenanceTier set + validator come from the vocabulary registry (single
// source of truth). The array order + values are byte-identical; replay-block re-exports them, so its
// public API (PROVENANCE_TIERS, isValidProvenanceTier) is unchanged.
const { PROVENANCE_TIERS, isValidProvenanceTier } = require('../vocabulary/vocabulary');

// =====================================================================
// EMBEDDING CODEC — explicit little-endian float32 (byte order intrinsic)
// =====================================================================
// Neo4j stores vector components as 64-bit doubles; the contract pins the wire dtype to
// float32, so encode is a deliberate double -> float32 narrowing. Round-trip equality is
// therefore at float32 precision, NOT double precision — the harness compares embeddings
// with a float32 tolerance and all other properties exactly.

const encodeEmbedding = (floatList) => {
	if (!Array.isArray(floatList)) {
		throw new Error('replay-block.encodeEmbedding: expected a number[]');
	}
	const buf = Buffer.allocUnsafe(floatList.length * 4);
	for (let i = 0; i < floatList.length; i++) {
		buf.writeFloatLE(floatList[i], i * 4);
	}
	return buf.toString('base64');
};

const decodeEmbedding = (base64Scalar, expectedDims) => {
	if (typeof base64Scalar !== 'string') {
		throw new Error(
			'replay-block.decodeEmbedding: embedding must be a base64 scalar string',
		);
	}
	const buf = Buffer.from(base64Scalar, 'base64');
	if (buf.length !== expectedDims * 4) {
		throw new Error(
			`replay-block.decodeEmbedding: byte length ${buf.length} != expected ${expectedDims * 4} ` +
				`(${expectedDims} dims x 4-byte float32) — block corruption or wrong embeddingDims`,
		);
	}
	const out = new Array(expectedDims);
	for (let i = 0; i < expectedDims; i++) {
		out[i] = buf.readFloatLE(i * 4);
	}
	return out;
};

// =====================================================================
// DETERMINISTIC SERIALIZATION
// =====================================================================
// Byte-identical output across re-extractions is a contract goal (incremental-add: untouched
// blocks must be byte-identical). Determinism is enforced HERE so it cannot be forgotten by a
// caller: property-map keys are sorted, labels are sorted. The caller (extractBlock) is still
// responsible for emitting nodes/edges in a stable ORDER (it orders by stableId).

const canonicalProperties = (properties) => {
	const out = {};
	Object.keys(properties || {})
		.sort()
		.forEach((oneKey) => {
			out[oneKey] = properties[oneKey];
		});
	return out;
};

const serializeHeaderLine = (header) => {
	const h = header || {};
	// Fixed field order per CONTRACT. Bridge blocks carry pairA/pairB instead of
	// standardKey/version; everything else is identical. resolutionKey is the greenfield
	// stable-URI key.
	const ordered = {
		kind: 'header',
		blockType: h.blockType,
		serializerVersion: SERIALIZER_VERSION,
	};
	if (h.blockType === 'bridge') {
		ordered.pairA = h.pairA;
		ordered.pairB = h.pairB;
	} else {
		ordered.standardKey = h.standardKey;
		ordered.version = h.version;
	}
	ordered.stableUriPropertyName = h.stableUriPropertyName;
	ordered.resolutionKey = h.resolutionKey;
	ordered.goldenVersionAuthoredAgainst = h.goldenVersionAuthoredAgainst;
	ordered.embeddingModelVersion = h.embeddingModelVersion;
	ordered.embeddingEncoding = h.embeddingEncoding;
	ordered.embeddingDtype = h.embeddingDtype;
	ordered.embeddingByteOrder = h.embeddingByteOrder;
	ordered.embeddingDims = h.embeddingDims;
	return JSON.stringify(ordered);
};

// node: { ref:{source,id}, labels:[...], stableId, properties:{}, embedding?:base64,
//         embeddingModelVersion? }. embedding is ALREADY a base64 scalar string here;
// extractBlock encodes the live number[] before calling this. ref.id externalizes the
// node's stableId value (the greenfield resolution key).
const serializeNodeLine = (node) => {
	const ordered = {
		kind: 'node',
		ref: { source: node.ref.source, id: node.ref.id },
		labels: (node.labels || []).slice().sort(),
	};
	if (node.stableId !== undefined && node.stableId !== null) {
		ordered.stableId = node.stableId;
	}
	ordered.properties = canonicalProperties(node.properties);
	// Embedding sidecar (PLAN §3.3): a node carries EITHER embeddingRef (the content-hash of the
	// vector input — the new persisted-block format, written by the EXTRACT path) OR the legacy
	// inline embedding base64 scalar (still emitted by the materializer's ephemeral-graph block,
	// F2). They are mutually exclusive; embeddingRef takes precedence. The field occupies the same
	// stable position either way, so node-line byte-order is unchanged (determinism).
	if (node.embeddingRef !== undefined && node.embeddingRef !== null) {
		ordered.embeddingRef = node.embeddingRef; // 64-hex vectorId
		ordered.embeddingModelVersion = node.embeddingModelVersion;
	} else if (node.embedding !== undefined && node.embedding !== null) {
		ordered.embedding = node.embedding; // base64 scalar (legacy / materializer)
		ordered.embeddingModelVersion = node.embeddingModelVersion;
	}
	return JSON.stringify(ordered);
};

const serializeEdgeLine = (edge) => {
	if (!isValidEdgeType(edge.type)) {
		throw new Error(
			`replay-block.serializeEdgeLine: invalid edge type '${edge.type}'`,
		);
	}
	const ordered = {
		kind: 'edge',
		type: edge.type,
		fromRef: { source: edge.fromRef.source, id: edge.fromRef.id },
		toRef: { source: edge.toRef.source, id: edge.toRef.id },
		properties: canonicalProperties(edge.properties),
	};
	return JSON.stringify(ordered);
};

// serializeBlock — assemble a full block from a header plus already-shaped node/edge objects.
// nodes[].embedding (if present) must already be a base64 scalar. Pure: caller supplies stable
// array order; this guarantees stable field/key/label order. Ends with a single trailing
// newline (consistent, so byte comparison is stable).
const serializeBlock = ({ header, nodes, edges }) => {
	const lines = [serializeHeaderLine(header)];
	(nodes || []).forEach((oneNode) => lines.push(serializeNodeLine(oneNode)));
	(edges || []).forEach((oneEdge) => lines.push(serializeEdgeLine(oneEdge)));
	return lines.join('\n') + '\n';
};

// =====================================================================
// DESERIALIZE
// =====================================================================
// Returns { header, nodes, edges }. Embeddings are decoded base64 -> number[] (float32 LE) and
// attached as node.embedding; the raw PG-JSON property arrays are returned UNCHANGED — the
// single-element [x] -> scalar mapping is the engine's job at MERGE time, not the serializer's.
// Fails LOUD (throws) on any structural violation: a corrupt block is a failure, never a silent
// partial parse.

const deserializeBlock = (blockText) => {
	if (typeof blockText !== 'string' || blockText.length === 0) {
		throw new Error('replay-block.deserializeBlock: empty or non-string block text');
	}
	const rawLines = blockText.split('\n').filter((oneLine) => oneLine.trim().length > 0);
	if (rawLines.length === 0) {
		throw new Error('replay-block.deserializeBlock: block has no lines');
	}

	const header = JSON.parse(rawLines[0]);
	if (header.kind !== 'header') {
		throw new Error(
			`replay-block.deserializeBlock: line 1 kind '${header.kind}' is not 'header'`,
		);
	}
	// L13 contract (Phase R, authorized AZURE_PEAK 2026-07-02): edge-only blocks
	// (mapping/inferredMapping) carry NO embedding header fields, so embeddingDims is
	// validated ONLY when an embedded node line actually needs it. A block that carries an
	// embedding without a valid dims still refuses loudly, per-line, below.
	const dims = header.embeddingDims;
	const dimsValid = typeof dims === 'number' && dims > 0;

	const nodes = [];
	const edges = [];

	for (let i = 1; i < rawLines.length; i++) {
		const rec = JSON.parse(rawLines[i]);
		if (rec.kind === 'node') {
			const node = {
				ref: rec.ref,
				labels: rec.labels || [],
				stableId: rec.stableId !== undefined ? rec.stableId : null,
				properties: rec.properties || {},
				embedding: null,
				embeddingModelVersion: rec.embeddingModelVersion || null,
			};
			if (rec.embedding !== undefined && rec.embedding !== null) {
				if (!dimsValid) {
					throw new Error(
						`replay-block.deserializeBlock: line ${i + 1} carries an embedding but ` +
							`header.embeddingDims '${dims}' is invalid`,
					);
				}
				node.embedding = decodeEmbedding(rec.embedding, dims);
			}
			nodes.push(node);
		} else if (rec.kind === 'edge') {
			if (!isValidEdgeType(rec.type)) {
				throw new Error(
					`replay-block.deserializeBlock: line ${i + 1} invalid edge type '${rec.type}'`,
				);
			}
			edges.push({
				type: rec.type,
				fromRef: rec.fromRef,
				toRef: rec.toRef,
				properties: rec.properties || {},
			});
		} else {
			throw new Error(
				`replay-block.deserializeBlock: line ${i + 1} unknown kind '${rec.kind}'`,
			);
		}
	}

	return { header, nodes, edges };
};

module.exports = {
	SERIALIZER_VERSION,
	PROVENANCE_TIERS,
	isValidEdgeType,
	isValidProvenanceTier,
	encodeEmbedding,
	decodeEmbedding,
	canonicalProperties,
	serializeHeaderLine,
	serializeNodeLine,
	serializeEdgeLine,
	serializeBlock,
	deserializeBlock,
};
