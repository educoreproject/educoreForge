'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// graphFingerprint.js — order-independent, whole-graph canonical fingerprint (Phase 0, deliverable 2).
//
// Produces a single hash string over a live graph's CONTENT, plus a structured elementManifest the
// diff tool consumes. CONTENT is scoped to (:ForgedNode) nodes and (:ForgedNode)-[r]->(:ForgedNode)
// edges, deliberately EXCLUDING the single :GraphProvenance passport node — whose builtAt is
// non-deterministic (graph-builder.js stampProvenance; edfReplay.js DESCRIPTION). Fingerprinting the
// bare graph would report false non-determinism on every build; scoping to :ForgedNode is the
// system's own equality convention.
//
// Order-independence: Cypher gives no row-order guarantee, so each node/edge is canonicalized to a
// stable line string and ALL lines are SORTED before hashing.
//
// TWO MODES (the producer/replay split, G5):
//   - FULL (default): embeddings hashed in-graph via apoc and folded into each node line. Used by
//     REPLAY gates (Phase 0/9) where embeddings are frozen and constant.
//   - EMBEDDING-EXCLUDED (ignoreEmbedding=true): embeddingHash dropped from the node line (and the
//     apoc hash skipped in Cypher for speed). Used by PRODUCER-PHASE gates (Phases 1-5), where a
//     re-forge RE-EMBEDS every node (the forge has no embedding cache) and embedding bytes may vary
//     run-to-run — so structure is what must be compared, with embedding variance held constant.
//   The ignoreEmbedding salt is only appended when the flag is ON, so the DEFAULT (full) fingerprint
//   value is unchanged from before this mode existed — the frozen baseline stays valid.
//
// EMBEDDING-SIDECAR NOTE (Phase 4, 2026-07-09): the producer-phase EMBEDDING-EXCLUDED mode exists ONLY
// because the OLD forge re-embedded every node, so the volatile base64 vector varied run-to-run. Post
// embedding-sidecar, a producer BLOCK carries a STABLE embeddingRef (a content hash of the vector INPUT,
// content-address.vectorIdForInput) in place of that volatile scalar, so blockId = sha256(block text) is
// now byte-stable across a warm-cache re-forge — the MOTIVATION for the exclusion is removed at the BLOCK
// level (the long-standing Q4 hazard is closed). That block-level determinism is proven, graph-free, by the
// standing twin gates.d/36-blockDeterminismEmbeddingRef.js. This GRAPH fingerprint is deliberately NOT
// changed here: the materialized graph never carries embeddingRef (replay resolves ref -> embedding BEFORE
// the MERGE), so producer-phase gates keep ignoreEmbedding=true and the replay-side embeddingHash fold
// stays as-is. Dropping ignoreEmbedding on producer-phase gates (so the graph fingerprint also folds the
// now-deterministic embedding) is DEFERRED to Phase 5, which has the docker warm-store replay needed to
// demonstrate the resolved embedding is byte-identical across a re-forge.
//
// Owner stamp: graph-builder stamps an owner LABEL on nodes (golden->`golden`, else `user`) and an
// `owner` edge PROPERTY. ignoreOwnerStamp=true strips them for cross-owner comparison.
//
// Async style: qtools taskListPlus/pipeRunner; lifecycle.runCypher resolves at the leaf. No
// async/await, no try/catch for control flow. camelCase only.
//
// @concept: [[GraphFingerprint]]
// @concept: [[OrderIndependentHash]]
// @concept: [[ForgedNodeContentScope]]
// @concept: [[EmbeddingExcludedFingerprint]]

const path = require('path');
const crypto = require('crypto');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// Robust project-root discovery (independent of nesting depth), mirroring edfReplay.js.
const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const CORE_LIB = path.join(
	findProjectRoot(),
	'code',
	'npm',
	'qtools-graph-forge-core',
	'lib',
);
// Reuse the system's canonical property-key sort so the fingerprint shares ONE determinism
// discipline with the replay serializer rather than inventing a parallel one.
const { canonicalProperties } = require(path.join(CORE_LIB, 'replay', 'replay-block'));

const OWNER_STAMP_LABELS = ['golden', 'user'];

const sha256Hex = (text) =>
	crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// =====================================================================
// VALUE NORMALIZATION — neo4j-typed value -> stable JSON-able form
// =====================================================================

const isNeo4jInteger = (value) =>
	value !== null &&
	typeof value === 'object' &&
	typeof value.low === 'number' &&
	typeof value.high === 'number' &&
	typeof value.toString === 'function';

const normalizeValue = (value) => {
	if (value === null || value === undefined) {
		return null;
	}
	if (isNeo4jInteger(value)) {
		return value.toString();
	}
	if (Array.isArray(value)) {
		return value.map((oneValue) => normalizeValue(oneValue));
	}
	if (typeof value === 'object') {
		const out = {};
		Object.keys(value)
			.sort()
			.forEach((oneKey) => {
				out[oneKey] = normalizeValue(value[oneKey]);
			});
		return out;
	}
	return value;
};

// Canonicalize a property map: drop the embedding (hashed separately, in-graph), sort keys, normalize
// values. Optionally drop the owner-stamp `owner` edge property.
const canonicalizePropertyMap = (properties, { dropOwner = false } = {}) => {
	const working = {};
	Object.keys(properties || {}).forEach((oneKey) => {
		if (oneKey === 'embedding') {
			return;
		}
		if (dropOwner && oneKey === 'owner') {
			return;
		}
		working[oneKey] = normalizeValue(properties[oneKey]);
	});
	return canonicalProperties(working);
};

// =====================================================================
// CANONICAL LINE BUILDERS — one stable string per node / per edge
// =====================================================================

const buildNodeLine = (record, { ignoreOwnerStamp, ignoreEmbedding } = {}) => {
	const stableId = normalizeValue(record.stableId);
	const rawLabels = Array.isArray(record.labels) ? record.labels.slice() : [];
	const labels = rawLabels
		.filter((oneLabel) => oneLabel !== 'ForgedNode')
		.filter((oneLabel) =>
			ignoreOwnerStamp ? OWNER_STAMP_LABELS.indexOf(oneLabel) === -1 : true,
		)
		.sort();
	const props = canonicalizePropertyMap(record.props, { dropOwner: false });
	const embeddingHash = ignoreEmbedding
		? null
		: record.embeddingHash === undefined
			? null
			: record.embeddingHash;
	return JSON.stringify({ stableId, labels, props, embeddingHash });
};

const buildEdgeLine = (record, { ignoreOwnerStamp } = {}) => {
	const fromId = normalizeValue(record.fromId);
	const toId = normalizeValue(record.toId);
	const type = record.type;
	const props = canonicalizePropertyMap(record.props, {
		dropOwner: !!ignoreOwnerStamp,
	});
	return JSON.stringify({ fromId, toId, type, props });
};

// hash a set of lines order-independently: sort, join, sha256.
const hashLinesOrderIndependent = (lines) => {
	const sorted = lines.slice().sort();
	return { hash: sha256Hex(sorted.join('\n')), lines: sorted };
};

// combineFingerprint — the PURE fold from canonical lines to the fingerprint result. Shared by the
// live-graph path and fingerprintFromManifest. The ignoreEmbedding salt term is appended ONLY when the
// flag is on, so the default (full) fingerprint value is byte-stable across the introduction of this
// mode (the frozen baseline remains valid).
const combineFingerprint = ({
	nodeLines,
	edgeLines,
	ignoreOwnerStamp,
	ignoreEmbedding,
	scope,
}) => {
	const nodeHashed = hashLinesOrderIndependent(nodeLines);
	const edgeHashed = hashLinesOrderIndependent(edgeLines);
	const fingerprint = sha256Hex(
		`forgeGraphFingerprint/v1` +
			`|nodes:${nodeHashed.hash}` +
			`|edges:${edgeHashed.hash}` +
			`|nodeCount:${nodeLines.length}` +
			`|edgeCount:${edgeLines.length}` +
			`|ignoreOwnerStamp:${ignoreOwnerStamp ? 1 : 0}` +
			(ignoreEmbedding ? `|ignoreEmbedding:1` : ``) +
			// salt with scope ONLY for the un-scoped ('all') mode, so the default ('forgedNode')
			// fingerprint value is unchanged from before this mode existed (baselines stay valid).
			(scope === 'all' ? `|scope:all` : ``),
	);
	return {
		fingerprint,
		nodeFingerprint: nodeHashed.hash,
		edgeFingerprint: edgeHashed.hash,
		nodeCount: nodeLines.length,
		edgeCount: edgeLines.length,
		ignoreOwnerStamp: !!ignoreOwnerStamp,
		ignoreEmbedding: !!ignoreEmbedding,
		scope: scope || 'forgedNode',
		elementManifest: { nodes: nodeHashed.lines, edges: edgeHashed.lines },
	};
};

// fingerprintFromManifest — recompute a fingerprint from an existing elementManifest (no graph read).
// PURE. Used by the determinism-gate twin to prove a perturbed manifest yields a different fingerprint
// (i.e. the gate WOULD go RED on real non-determinism). Pass the SAME flags the manifest was built
// with to reproduce the original fingerprint exactly.
const fingerprintFromManifest = (
	elementManifest,
	{ ignoreOwnerStamp = false, ignoreEmbedding = false, scope = 'forgedNode' } = {},
) =>
	combineFingerprint({
		nodeLines: (elementManifest && elementManifest.nodes) || [],
		edgeLines: (elementManifest && elementManifest.edges) || [],
		ignoreOwnerStamp,
		ignoreEmbedding,
		scope,
	});

// =====================================================================
// CYPHER — scoped to (:ForgedNode); embeddings hashed in-graph via apoc (skipped when excluded)
// =====================================================================

// scope: 'forgedNode' (default) fingerprints only (:ForgedNode) content — the established equality
// scope. 'all' fingerprints EVERY node + edge, excluding ONLY the non-deterministic :GraphProvenance
// passport. The 'all' mode closes the blind spot where non-ForgedNode content (an unlabeled node, an
// edge to a non-ForgedNode endpoint) would be invisible to the scoped fingerprint — so a future change
// that adds or drops such content is caught, not silently passed.
const nodeMatchFor = (scope) =>
	scope === 'all' ? 'MATCH (n) WHERE NOT n:GraphProvenance' : 'MATCH (n:ForgedNode)';

const edgeMatchFor = (scope) =>
	scope === 'all'
		? 'MATCH (a)-[r]->(b) WHERE NOT a:GraphProvenance AND NOT b:GraphProvenance'
		: 'MATCH (a:ForgedNode)-[r]->(b:ForgedNode)';

const nodeCypherFor = (ignoreEmbedding, scope) => `
	${nodeMatchFor(scope)}
	RETURN n.stableId AS stableId,
		labels(n) AS labels,
		apoc.map.removeKey(properties(n), 'embedding') AS props,
		${
			ignoreEmbedding
				? 'null'
				: "CASE WHEN n.embedding IS NULL THEN null ELSE apoc.util.sha256([x IN n.embedding | toString(x)]) END"
		} AS embeddingHash
`;

const edgeCypherFor = (scope) => `
	${edgeMatchFor(scope)}
	RETURN a.stableId AS fromId, b.stableId AS toId, type(r) AS type,
		properties(r) AS props
`;

// =====================================================================
// MODULE — curried DI (lifecycle from 1B instance-lifecycle)
// =====================================================================

const moduleFunction = ({ moduleName } = {}) => ({ lifecycle } = {}) => {
	const { xLog } = process.global;

	// fingerprintGraph({graphName, ignoreOwnerStamp?, ignoreEmbedding?}, cb) -> fingerprint result
	const fingerprintGraph = (
		{ graphName, ignoreOwnerStamp = false, ignoreEmbedding = false, scope = 'forgedNode' } = {},
		callback,
	) => {
		if (!graphName) {
			callback('graphFingerprint: graphName is required');
			return;
		}

		const taskList = new taskListPlus();

		// read nodes (scoped to :ForgedNode by default, or ALL non-:GraphProvenance nodes when scope=all)
		taskList.push((args, next) => {
			lifecycle.runCypher(
				{ graphName, cypher: nodeCypherFor(ignoreEmbedding, scope) },
				(err, result) => {
					if (err) {
						next(`graphFingerprint: node read failed: ${err}`);
						return;
					}
					next('', { ...args, nodeRecords: result.records });
				},
			);
		});

		// read edges (scoped to ForgedNode->ForgedNode by default, or ALL non-provenance edges when scope=all)
		taskList.push((args, next) => {
			lifecycle.runCypher({ graphName, cypher: edgeCypherFor(scope) }, (err, result) => {
				if (err) {
					next(`graphFingerprint: edge read failed: ${err}`);
					return;
				}
				next('', { ...args, edgeRecords: result.records });
			});
		});

		// canonicalize, sort, hash
		taskList.push((args, next) => {
			const nodeLines = args.nodeRecords.map((oneRecord) =>
				buildNodeLine(oneRecord, { ignoreOwnerStamp, ignoreEmbedding }),
			);
			const edgeLines = args.edgeRecords.map((oneRecord) =>
				buildEdgeLine(oneRecord, { ignoreOwnerStamp }),
			);
			const result = combineFingerprint({
				nodeLines,
				edgeLines,
				ignoreOwnerStamp,
				ignoreEmbedding,
				scope,
			});
			next('', { ...args, result });
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err) {
				callback(err);
				return;
			}
			xLog.verbose(
				`[graphFingerprint] ${graphName}: ${args.result.nodeCount} node(s), ` +
					`${args.result.edgeCount} edge(s)${args.result.ignoreEmbedding ? ' [embedding-excluded]' : ''} -> ` +
					`${args.result.fingerprint.slice(0, 16)}…`,
			);
			callback('', args.result);
		});
	};

	return {
		fingerprintGraph,
		fingerprintFromManifest,
		combineFingerprint,
		buildNodeLine,
		buildEdgeLine,
		hashLinesOrderIndependent,
		normalizeValue,
		canonicalizePropertyMap,
	};
};

module.exports = moduleFunction({ moduleName });
