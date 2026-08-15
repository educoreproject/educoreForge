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
// Async style (DECISIONS §2): the (de)serializer codec is PURE and synchronous; harvestBlock
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

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
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

// ⟪MIXED VECTOR WIDTHS, tqii ruling 2026-08-13⟫ THE VECTOR CARRIES ITS OWN WIDTH. A float32
// little-endian buffer is self-describing: its byte length divided by four IS the dimension count.
// The block header's `embeddingDims` was previously the sole authority here, which made a single
// per-block number decide whether a node's own vector could be read at all — and a block assembled
// from more than one standard has no single right answer to put there.
//
// TQ's ruling: differing vector lengths are LEGITIMATE, not corruption. Voyage supports lengths that
// are compatible and comparable, so a block holding a 1024-wide vector beside a 512-wide one is a
// real condition to handle rather than a fault to refuse. Refuse-by-name remains right for invented
// values and silent substitutions; it is wrong for a variation the underlying technology supports.
//
// SO THE HEADER IS NOW CORROBORATION, NOT SOURCE. When the caller supplies a positive expectedDims,
// a mismatch is still a hard refusal — that check catches genuine corruption and is kept verbatim.
// When the caller supplies nothing (a block whose header declares no single width), the width is
// DERIVED from the buffer. What is never tolerated is a byte length that is not a whole number of
// float32s: that is not a different width, it is a damaged vector, and it refuses by name.
const decodeEmbedding = (base64Scalar, expectedDims) => {
	if (typeof base64Scalar !== 'string') {
		throw new Error(
			'replay-block.decodeEmbedding: embedding must be a base64 scalar string',
		);
	}
	const buf = Buffer.from(base64Scalar, 'base64');
	if (buf.length === 0 || buf.length % 4 !== 0) {
		throw new Error(
			`replay-block.decodeEmbedding: byte length ${buf.length} is not a positive multiple of 4 ` +
				`— a float32 vector cannot have a partial value. This is a damaged vector, not a ` +
				`different width.`,
		);
	}
	const declaredDims = typeof expectedDims === 'number' && expectedDims > 0 ? expectedDims : null;
	if (declaredDims !== null && buf.length !== declaredDims * 4) {
		throw new Error(
			`replay-block.decodeEmbedding: byte length ${buf.length} != expected ${declaredDims * 4} ` +
				`(${declaredDims} dims x 4-byte float32) — block corruption or wrong embeddingDims`,
		);
	}
	const dims = declaredDims === null ? buf.length / 4 : declaredDims;
	const out = new Array(dims);
	for (let i = 0; i < dims; i++) {
		out[i] = buf.readFloatLE(i * 4);
	}
	return out;
};

// =====================================================================
// DETERMINISTIC SERIALIZATION
// =====================================================================
// Byte-identical output across re-extractions is a contract goal (incremental-add: untouched
// blocks must be byte-identical). Determinism is enforced HERE so it cannot be forgotten by a
// caller: property-map keys are sorted, labels are sorted. The caller (harvestBlock) is still
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
	// pair/version-key + tier-scope fields (BINDING spec §4.2/§4.3, Phase C) — ALL OPTIONAL:
	// an undefined value is omitted by JSON.stringify, so every pre-Phase-C block's header
	// bytes are unchanged. Pair-keyed mapping blocks carry pairA/pairB INSTEAD of standardKey
	// (the undefined standardKey above vanishes the same way). tierScope is the granularity
	// axis (property|value|crosswalk) — distinct from the edges' provenanceTier authorship
	// axis. hubSnapshotKey is the reference block's §4.3 hub-version key.
	if (h.blockType !== 'bridge') {
		ordered.pairA = h.pairA;
		ordered.pairB = h.pairB;
	}
	ordered.pairAVersion = h.pairAVersion;
	ordered.pairBVersion = h.pairBVersion;
	ordered.publishedVersionA = h.publishedVersionA;
	ordered.publishedVersionB = h.publishedVersionB;
	ordered.tierScope = h.tierScope;
	ordered.hubSnapshotKey = h.hubSnapshotKey;
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
// harvestBlock encodes the live number[] before calling this. ref.id externalizes the
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
// Returns { header, nodes, edges }. Embedding sidecar DUAL-READ (PLAN §3.5, §5): a node line carries
// EITHER the legacy inline base64 `embedding` (decoded here to node.embedding, number[] float32 LE) OR
// the new `embeddingRef` (a 64-hex content-hash of the vector INPUT — carried through as node.embeddingRef
// with node.embedding left null; the replay ENGINE resolves the ref to the vector against the per-standard
// sidecar store before MERGE). The two are mutually exclusive (serializeNodeLine writes one or the other).
// This codec stays PURE + synchronous — it does no store lookup. The raw PG-JSON property arrays are
// returned UNCHANGED — the single-element [x] -> scalar mapping is the engine's job at MERGE time, not
// the serializer's. Fails LOUD (throws) on any structural violation: a corrupt block is a failure, never
// a silent partial parse.

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
	// validated ONLY when an embedded node line actually needs it.
	//
	// ⟪MIXED VECTOR WIDTHS, tqii ruling 2026-08-13⟫ A block whose header declares no width no longer
	// refuses its embedded nodes — see decodeEmbedding's header for the ruling. THE FAILURE THIS
	// REMOVES, so nobody restores the old gate believing it was load-bearing: a relationship block
	// harvested from a run that reused two bases got its header width from whichever base loaded
	// LAST. EdFi's stored base carries no vectors and declares none, CEDS declares 1024, EdFi came
	// second — so the header said 'no vectors' while the harvested CEDS hub card in the body carried
	// a 1024-wide one, and every materialize refused. The header and the body disagreed because the
	// header was decided by load order; the body was right both times.
	//
	// A DECLARED WIDTH IS STILL ENFORCED. When the header names one, decodeEmbedding refuses any
	// vector that does not match it, exactly as before. Only the ABSENCE of a declaration is now
	// tolerated, and it resolves to the width the vector itself carries.
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
				embeddingRef: null,
				embeddingModelVersion: rec.embeddingModelVersion || null,
			};
			// DUAL-READ (PLAN §3.5, §5): legacy inline base64 `embedding` OR new `embeddingRef` — mutually
			// exclusive. A ref is carried as a string (engine resolves it); embedding stays null.
			// Neither present -> embedding null (as today).
			//
			// ⟪MIXED VECTOR WIDTHS⟫ dimsValid decides whether the header gets a vote, not whether the
			// line is readable: a declared width is passed through and enforced, an undeclared one
			// leaves decodeEmbedding to read the width off the vector.
			if (rec.embedding !== undefined && rec.embedding !== null) {
				node.embedding = decodeEmbedding(rec.embedding, dimsValid ? dims : null);
			} else if (rec.embeddingRef !== undefined && rec.embeddingRef !== null) {
				node.embeddingRef = rec.embeddingRef;
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

return {
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
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
