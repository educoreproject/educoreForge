'use strict';

// replay-engine.js — the single block<->graph boundary (Phase 2). extractBlock serializes a
// graph subset into a PG-JSONL block; replay materializes an ordered manifest of blocks into a
// FRESH store. Dependency-light: connects to bolt directly via neo4j-driver (the CLI resolves
// access by name and passes boltUri + password).
//
// GREENFIELD RESOLUTION — the correctness requirement (DECISIONS-firstApp §1, §20):
//   * The durable resolution key is the node's stableId (= the value of the standard's
//     stableUriPropertyName). This is the switch AWAY from the legacy prototype's (_source,_id)
//     composite.
//   * MERGE nodes on stableId. OPTIONAL MATCH both edge endpoints on stableId. The resolution-
//     key index is on (n.stableId). Edge fromRef/toRef externalize the stableId value (carried
//     in ref.id).
//   * serializerVersion "1" is stamped/read; NO version-dispatch logic (§20).
//
// THREE ORDERED INDEX PHASES (correctness-of-performance, SPEC §4.5):
//   (1) create the resolution-key index on the EMPTY store + db.awaitIndexes BEFORE node MERGE;
//   (2) MERGE nodes (grouped by label-set, 500/batch, UNWIND) then MERGE edges (by type,
//       500/batch) with two-endpoint orphan collection — write the edge only if BOTH endpoints
//       resolve, else record a danglingRefs entry, NEVER a partial edge;
//   (3) build the <graphName>_vector index (1024-dim cosine) LAST + db.awaitIndexes.
// Idempotent (MERGE, not CREATE) + deterministic.
//
// provenanceTier ENFORCEMENT (§21): every edge MUST carry a provenanceTier in the four-value
// set. A missing/invalid tier is an ERROR (a distinct malformed-edge case — NOT dangling/
// partial), surfaced like an audit finding; the engine refuses to write any edge in that block.
//
// Async style (DECISIONS §2): qtools-asynchronous-pipe-plus taskListPlus/pipeRunner for
// orchestration; each neo4j-driver call resolves at the leaf via .then().catch(err=>next(err)).
// No async/await, no try/catch for control flow, no Promises surfaced. camelCase only.
//
// @concept: [[ReplayEngine]]
// @concept: [[IndexFirstOrdering]]
// @concept: [[GreenfieldResolutionKey]]
// @concept: [[GlobalEdgeResolution]]
// @concept: [[TwoEndpointOrphanReport]]
// @concept: [[ProvenanceTierEnforcement]]
// @concept: [[Replay]]

const fs = require('fs');
const neo4j = require('neo4j-driver');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const replayBlock = require('./replay-block');

const BATCH_SIZE = 500;
const NEO4J_USER = 'neo4j';
const NODE_PAGE_SIZE = 2000; // bounds driver memory: embedded nodes carry 1024 floats each.

// =====================================================================
// HELPERS — pure
// =====================================================================

const batchArray = (arr, size) => {
	const out = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
};

// CONTRACT: single-element PG-JSON array -> scalar; multi-element -> array.
const pgToStored = (properties) => {
	const out = {};
	Object.keys(properties || {}).forEach((oneKey) => {
		const oneValue = properties[oneKey];
		out[oneKey] =
			Array.isArray(oneValue) && oneValue.length === 1 ? oneValue[0] : oneValue;
	});
	return out;
};

// A property value as a PG-JSON multi-valued array (every value an array; CONTRACT §node).
const neoToJs = (oneValue) => {
	if (neo4j.isInt(oneValue)) return oneValue.toNumber();
	if (Array.isArray(oneValue)) return oneValue.map(neoToJs);
	return oneValue;
};
const pgArray = (oneValue) =>
	Array.isArray(oneValue) ? oneValue.map(neoToJs) : [neoToJs(oneValue)];

const labelClause = (labels) =>
	(labels || [])
		.slice()
		.sort()
		.map((oneLabel) => `\`${oneLabel}\``)
		.join(':');

// stableId index name: per-graph, named off the graph (schemas.md §4). The resolution-key
// index name is graph-neutral here because the engine is told only boltUri; we use a stable
// constant for the reskey index and derive the vector index name from the header's standardKey
// when available, falling back to a constant. The CONSUMERS contract names the vector index
// <graphName>_vector; the engine accepts an optional graphName to honor that.
const resKeyIndexName = () => 'replay_reskey';
const vectorIndexName = (graphName) =>
	`${graphName ? graphName : 'replay'}_vector`;

// graphName-aware ownerStamp is the replayManager's concern; the engine writes data only.

// buildNodeRow — the stored row for a MERGE. The resolution key is stableId; _source/_id are
// retained as ordinary stored properties for provenance/debugging but are NOT the merge key.
const buildNodeRow = (node) => {
	const props = pgToStored(node.properties);
	props._source = node.ref.source;
	props._id = node.ref.id;
	props.stableId = node.stableId; // the durable resolution key, stored on the node.
	if (node.embedding) props.embedding = node.embedding; // number[] -> Neo4j LIST<FLOAT>
	return { stableId: node.stableId, props };
};

// Read a manifest entry: an existing file path -> its contents; otherwise the entry IS block
// text (SPEC §4.1 "ordered block texts/paths").
const readManifestEntry = (entry) => {
	if (typeof entry === 'string' && entry.indexOf('\n') === -1 && fs.existsSync(entry)) {
		return fs.readFileSync(entry, 'utf8');
	}
	return entry;
};

const openDriver = (boltUri, password) =>
	neo4j.driver(boltUri, neo4j.auth.basic(NEO4J_USER, password), { encrypted: false });

// =====================================================================
// PROVENANCE TIER ENFORCEMENT (§21)
// =====================================================================
// Scan all edges BEFORE any write. A missing/invalid provenanceTier is a malformed-edge ERROR
// (distinct from dangling/partial). Surfaced as an audit finding; the engine refuses the run so
// no edge in a malformed block is silently written.
const findProvenanceViolations = (edges) => {
	const violations = [];
	edges.forEach((oneEdge) => {
		const tierProp = (oneEdge.properties || {}).provenanceTier;
		// PG-JSON: a single-element array, OR (post pgToStored) a scalar. Accept either shape.
		const tierValue = Array.isArray(tierProp) ? tierProp[0] : tierProp;
		if (
			tierValue === undefined ||
			tierValue === null ||
			!replayBlock.isValidProvenanceTier(tierValue)
		) {
			violations.push({
				blockType: oneEdge.blockType,
				edgeType: oneEdge.type,
				fromRef: oneEdge.fromRef,
				toRef: oneEdge.toRef,
				provenanceTier: tierValue === undefined ? null : tierValue,
			});
		}
	});
	return violations;
};

// =====================================================================
// NODE REPLAY — MERGE on stableId, batched UNWIND, grouped by label-set.
// =====================================================================
const mergeNodes = (session, nodes, callback) => {
	const groups = {};
	nodes.forEach((oneNode) => {
		const key = labelClause(oneNode.labels);
		if (!groups[key]) groups[key] = [];
		groups[key].push(oneNode);
	});

	const groupKeys = Object.keys(groups);
	let merged = 0;
	let gi = 0;

	const nextGroup = () => {
		if (gi >= groupKeys.length) {
			callback('', merged);
			return;
		}
		const clause = groupKeys[gi];
		const groupNodes = groups[clause];
		gi++;

		const batches = batchArray(groupNodes.map(buildNodeRow), BATCH_SIZE);
		let bi = 0;

		const nextBatch = () => {
			if (bi >= batches.length) {
				nextGroup();
				return;
			}
			const batch = batches[bi];
			bi++;
			// GREENFIELD: MERGE on stableId (the durable resolution key), NOT (_source,_id).
			const query = `
				UNWIND $batch AS row
				MERGE (n:${clause} {stableId: row.stableId})
				SET n += row.props
			`;
			session
				.run(query, { batch })
				.then(() => {
					merged += batch.length;
					nextBatch();
				})
				.catch((err) =>
					callback(`mergeNodes failed for [${clause}]: ${err.message}`),
				);
		};
		nextBatch();
	};

	nextGroup();
};

// =====================================================================
// EDGE REPLAY — global endpoint resolution on stableId + two-endpoint orphan collection.
// =====================================================================
const mergeEdges = (session, edges, callback) => {
	const byType = {};
	edges.forEach((oneEdge) => {
		if (!byType[oneEdge.type]) byType[oneEdge.type] = [];
		byType[oneEdge.type].push(oneEdge);
	});

	const types = Object.keys(byType);
	let written = 0;
	const danglingRefs = [];
	let ti = 0;

	const nextType = () => {
		if (ti >= types.length) {
			callback('', { written, danglingRefs });
			return;
		}
		const edgeType = types[ti];
		ti++;
		if (!replayBlock.isValidEdgeType(edgeType)) {
			callback(`mergeEdges: invalid edge type '${edgeType}'`);
			return;
		}

		// Edge endpoints externalize the stableId value (carried in ref.id).
		const rows = byType[edgeType].map((oneEdge) => ({
			fromStableId: oneEdge.fromRef.id,
			toStableId: oneEdge.toRef.id,
			fromSrc: oneEdge.fromRef.source,
			toSrc: oneEdge.toRef.source,
			props: pgToStored(oneEdge.properties),
			blockType: oneEdge.blockType,
		}));
		const batches = batchArray(rows, BATCH_SIZE);
		let bi = 0;

		const nextBatch = () => {
			if (bi >= batches.length) {
				nextType();
				return;
			}
			const batch = batches[bi];
			bi++;
			// GREENFIELD: resolve BOTH endpoints on stableId, anywhere in the store (so cross-
			// source bridges resolve). Write only if both resolve; never a partial edge.
			const query = `
				UNWIND $edges AS e
				OPTIONAL MATCH (from {stableId: e.fromStableId})
				OPTIONAL MATCH (to   {stableId: e.toStableId})
				FOREACH (_ IN CASE WHEN from IS NULL OR to IS NULL THEN [] ELSE [1] END |
					MERGE (from)-[r:\`${edgeType}\`]->(to) SET r += e.props)
				RETURN e.fromSrc AS fromSrc, e.fromStableId AS fromStableId,
				       e.toSrc AS toSrc, e.toStableId AS toStableId,
				       e.blockType AS blockType,
				       (from IS NULL) AS fromMissing, (to IS NULL) AS toMissing
			`;
			session
				.run(query, { edges: batch })
				.then((result) => {
					result.records.forEach((rec) => {
						const fromMissing = rec.get('fromMissing');
						const toMissing = rec.get('toMissing');
						if (!fromMissing && !toMissing) {
							written++;
							return;
						}
						danglingRefs.push({
							blockType: rec.get('blockType'),
							edgeType,
							fromRef: {
								source: rec.get('fromSrc'),
								id: rec.get('fromStableId'),
							},
							toRef: {
								source: rec.get('toSrc'),
								id: rec.get('toStableId'),
							},
							missingEndpoint:
								fromMissing && toMissing
									? 'both'
									: fromMissing
										? 'from'
										: 'to',
						});
					});
					nextBatch();
				})
				.catch((err) =>
					callback(`mergeEdges failed for ${edgeType}: ${err.message}`),
				);
		};
		nextBatch();
	};

	nextType();
};

// =====================================================================
// extractBlock — read a graph subset (READ-mode) into a PG-JSONL block.
// =====================================================================
// selector: {source:'CEDS'} for a standard block; {pairA,pairB} for a bridge block. Returns
// { blockText, nodeCount, edgeCount, stableIdCoverage }. Orders by stableId for byte-stable
// re-extraction.

const sourceOf = (oneSelector) =>
	typeof oneSelector === 'string'
		? oneSelector
		: oneSelector.standardKey || oneSelector.source;

const shapeNode = (neoNode, header) => {
	const props = neoNode.properties || {};
	const properties = {};
	Object.keys(props).forEach((oneKey) => {
		if (oneKey === '_id' || oneKey === '_source' || oneKey === 'embedding') return;
		if (oneKey === 'stableId') return; // externalized into ref/stableId, not a duplicate prop.
		properties[oneKey] = pgArray(props[oneKey]);
	});
	// The durable resolution key. A forged node carries it under the standard's own stable
	// property (named by header.stableUriPropertyName) AND, once replayed, under the engine's
	// canonical `stableId` property. Prefer the standard property (the source of truth at
	// forge time); fall back to the stored `stableId` so a re-extract of an already-replayed
	// graph round-trips byte-identically.
	const standardPropValue = props[header.stableUriPropertyName];
	const stablePropValue =
		standardPropValue !== undefined && standardPropValue !== null
			? standardPropValue
			: props.stableId;
	const stableId =
		stablePropValue !== undefined && stablePropValue !== null
			? neoToJs(stablePropValue)
			: null;
	const node = {
		// ref.id externalizes the stableId value — the greenfield resolution key.
		ref: { source: neoToJs(props._source), id: stableId },
		labels: neoNode.labels || [],
		stableId,
		properties,
	};
	if (Array.isArray(props.embedding) && props.embedding.length > 0) {
		node.embedding = replayBlock.encodeEmbedding(props.embedding.map(neoToJs));
		node.embeddingModelVersion = header.embeddingModelVersion;
	}
	return node;
};

const shapeEdgeProps = (props) => {
	const out = {};
	Object.keys(props || {}).forEach((oneKey) => {
		out[oneKey] = pgArray(props[oneKey]);
	});
	return out;
};

const fetchNodesPaged = (session, source, header, callback) => {
	const nodes = [];
	const pageNext = (skip) => {
		session
			.run(
				'MATCH (n {_source:$source}) RETURN n ORDER BY n.stableId SKIP $skip LIMIT $limit',
				{
					source,
					skip: neo4j.int(skip),
					limit: neo4j.int(NODE_PAGE_SIZE),
				},
			)
			.then((result) => {
				result.records.forEach((rec) =>
					nodes.push(shapeNode(rec.get('n'), header)),
				);
				if (result.records.length < NODE_PAGE_SIZE) {
					callback('', nodes);
					return;
				}
				pageNext(skip + NODE_PAGE_SIZE);
			})
			.catch((err) => callback(`extractBlock fetchNodes failed: ${err.message}`));
	};
	pageNext(0);
};

// Edges with BOTH endpoints in the source (a standard block carries only intra-source edges).
// Externalize endpoints on stableId.
const fetchStandardEdges = (session, source, callback) => {
	session
		.run(
			`MATCH (a {_source:$source})-[r]->(b {_source:$source})
			 RETURN a._source AS fromSrc, a.stableId AS fromStableId, type(r) AS type,
			        b._source AS toSrc, b.stableId AS toStableId, properties(r) AS props
			 ORDER BY fromStableId, type, toStableId`,
			{ source },
		)
		.then((result) => {
			const edges = result.records.map((rec) => ({
				type: rec.get('type'),
				fromRef: { source: rec.get('fromSrc'), id: rec.get('fromStableId') },
				toRef: { source: rec.get('toSrc'), id: rec.get('toStableId') },
				properties: shapeEdgeProps(rec.get('props')),
			}));
			callback('', edges);
		})
		.catch((err) =>
			callback(`extractBlock fetchStandardEdges failed: ${err.message}`),
		);
};

// Cross-source edges between two standards, both directions (a bridge block = edges only).
const fetchBridgeEdges = (session, pairASource, pairBSource, callback) => {
	session
		.run(
			`MATCH (a)-[r]->(b)
			 WHERE a._source IN [$pa,$pb] AND b._source IN [$pa,$pb] AND a._source <> b._source
			 RETURN a._source AS fromSrc, a.stableId AS fromStableId, type(r) AS type,
			        b._source AS toSrc, b.stableId AS toStableId, properties(r) AS props
			 ORDER BY fromSrc, fromStableId, type, toSrc, toStableId`,
			{ pa: pairASource, pb: pairBSource },
		)
		.then((result) => {
			const edges = result.records.map((rec) => ({
				type: rec.get('type'),
				fromRef: { source: rec.get('fromSrc'), id: rec.get('fromStableId') },
				toRef: { source: rec.get('toSrc'), id: rec.get('toStableId') },
				properties: shapeEdgeProps(rec.get('props')),
			}));
			callback('', edges);
		})
		.catch((err) =>
			callback(`extractBlock fetchBridgeEdges failed: ${err.message}`),
		);
};

const extractBlock = ({ boltUri, password, selector, header }, callback) => {
	const driver = openDriver(boltUri, password);
	const session = driver.session({ defaultAccessMode: neo4j.session.READ });
	const isBridge = !!(selector && selector.pairA);

	const taskList = new taskListPlus();

	taskList.push((args, next) => {
		if (isBridge) {
			next('', { ...args, nodes: [] });
			return;
		}
		fetchNodesPaged(session, sourceOf(selector.source), header, (err, nodes) => {
			if (err) {
				next(err);
				return;
			}
			next('', { ...args, nodes });
		});
	});

	taskList.push((args, next) => {
		if (isBridge) {
			fetchBridgeEdges(
				session,
				sourceOf(selector.pairA),
				sourceOf(selector.pairB),
				(err, edges) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, edges });
				},
			);
			return;
		}
		fetchStandardEdges(session, sourceOf(selector.source), (err, edges) => {
			if (err) {
				next(err);
				return;
			}
			next('', { ...args, edges });
		});
	});

	taskList.push((args, next) => {
		// stableIdCoverage — the forward-looking durable-key check over the block's nodes.
		if (isBridge) {
			next('', { ...args, stableIdCoverage: null });
			return;
		}
		const withStable = args.nodes.filter(
			(oneNode) => oneNode.stableId !== null && oneNode.stableId !== undefined,
		);
		const distinct = new Set(withStable.map((oneNode) => oneNode.stableId));
		next('', {
			...args,
			stableIdCoverage: {
				property: header.stableUriPropertyName,
				total: args.nodes.length,
				present: withStable.length,
				distinct: distinct.size,
				unique: distinct.size === withStable.length,
			},
		});
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		session.close().then(() => driver.close());
		if (err) {
			callback(err);
			return;
		}
		const blockText = replayBlock.serializeBlock({
			header,
			nodes: args.nodes,
			edges: args.edges,
		});
		callback('', {
			blockText,
			nodeCount: args.nodes.length,
			edgeCount: args.edges.length,
			stableIdCoverage: args.stableIdCoverage,
		});
	});
};

// =====================================================================
// PUBLIC API — replay({ manifest, boltUri, password, graphName? }, callback)
// =====================================================================
const replay = ({ manifest, boltUri, password, graphName }, callback) => {
	const driver = openDriver(boltUri, password);
	const session = driver.session();
	const resKeyIndex = resKeyIndexName();
	const vectorIndex = vectorIndexName(graphName);

	const taskList = new taskListPlus();

	// --- Deserialize the manifest (pure) -> all nodes + all edges (edges tagged blockType).
	taskList.push((args, next) => {
		const allNodes = [];
		const allEdges = [];
		let embeddingDims = null;
		manifest.forEach((entry) => {
			const block = replayBlock.deserializeBlock(readManifestEntry(entry));
			if (embeddingDims === null) embeddingDims = block.header.embeddingDims;
			block.nodes.forEach((oneNode) => allNodes.push(oneNode));
			block.edges.forEach((oneEdge) =>
				allEdges.push({ ...oneEdge, blockType: block.header.blockType }),
			);
		});
		next('', { ...args, allNodes, allEdges, embeddingDims });
	});

	// --- provenanceTier ENFORCEMENT (§21): malformed-edge ERROR before any write.
	taskList.push((args, next) => {
		const violations = findProvenanceViolations(args.allEdges);
		if (violations.length > 0) {
			const sample = violations[0];
			next(
				`provenanceTier enforcement: ${violations.length} edge(s) missing/invalid ` +
					`provenanceTier (must be one of ${replayBlock.PROVENANCE_TIERS.join(', ')}); ` +
					`first offender: ${sample.edgeType} ${JSON.stringify(sample.fromRef)} -> ` +
					`${JSON.stringify(sample.toRef)} tier=${JSON.stringify(sample.provenanceTier)}. ` +
					`No edges written.`,
			);
			return;
		}
		next('', args);
	});

	// --- PHASE 1 (before node MERGE): resolution-key index on stableId, on the EMPTY store.
	taskList.push((args, next) => {
		session
			.run(
				`CREATE INDEX ${resKeyIndex} IF NOT EXISTS FOR (n:ForgedNode) ON (n.stableId)`,
			)
			.then(() => session.run('CALL db.awaitIndexes(300)'))
			.then(() => next('', args))
			.catch((err) =>
				next(`phase1 resolution-key index failed: ${err.message}`),
			);
	});

	// --- PHASE 2a: replay nodes (indexed MERGE on stableId).
	taskList.push((args, next) => {
		mergeNodes(session, args.allNodes, (err, nodesMerged) => {
			if (err) {
				next(err);
				return;
			}
			next('', { ...args, nodesMerged });
		});
	});

	// --- PHASE 2b: replay edges (global resolution on stableId + orphan collection).
	taskList.push((args, next) => {
		mergeEdges(session, args.allEdges, (err, result) => {
			if (err) {
				next(err);
				return;
			}
			next('', {
				...args,
				edgesMerged: result.written,
				danglingRefs: result.danglingRefs,
			});
		});
	});

	// --- PHASE 3 (after edges): vector index (1024-dim cosine), off the replay hot path.
	// The PRODUCTION form is the GA Cypher `CREATE VECTOR INDEX ... OPTIONS {...}` (SPEC §4.5,
	// schemas §4), which requires a Neo4j kernel >= 5.13. We probe the server's kernel version
	// first: on a capable server the index is built per spec; on an older server (e.g. the
	// neo4j:5.5 test substrate, which has NO vector-index support in any syntax) we record the
	// index as skipped rather than erroring — replay correctness does not depend on it, and the
	// production golden runs a modern Neo4j. The resolution-key index and all data are unaffected.
	taskList.push((args, next) => {
		const indexesBuilt = [resKeyIndex];
		if (!args.embeddingDims) {
			next('', { ...args, indexesBuilt });
			return;
		}
		const versionAtLeast513 = (versionString) => {
			const parts = `${versionString}`.split('.').map((oneSeg) => parseInt(oneSeg, 10));
			const major = parts[0] || 0;
			const minor = parts[1] || 0;
			return major > 5 || (major === 5 && minor >= 13);
		};
		const buildVectorIndex = () => {
			const vectorQuery = `
				CREATE VECTOR INDEX ${vectorIndex} IF NOT EXISTS
				FOR (n:ForgedNode) ON (n.embedding)
				OPTIONS {indexConfig: {
					\`vector.dimensions\`: ${args.embeddingDims},
					\`vector.similarity_function\`: 'cosine'
				}}
			`;
			session
				.run(vectorQuery)
				.then(() => session.run('CALL db.awaitIndexes(300)'))
				.then(() => {
					indexesBuilt.push(vectorIndex);
					next('', { ...args, indexesBuilt });
				})
				.catch((err) => next(`phase3 vector index failed: ${err.message}`));
		};
		session
			.run("CALL dbms.components() YIELD versions RETURN versions[0] AS kernelVersion")
			.then((result) => {
				const kernelVersion =
					result.records[0] && result.records[0].get('kernelVersion');
				if (versionAtLeast513(kernelVersion)) {
					buildVectorIndex();
					return;
				}
				indexesBuilt.push(`${vectorIndex}:skipped(serverVersion ${kernelVersion} < 5.13)`);
				next('', { ...args, indexesBuilt });
			})
			.catch((err) => next(`phase3 version probe failed: ${err.message}`));
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		session.close().then(() => driver.close());
		if (err) {
			callback(err);
			return;
		}
		callback('', {
			nodesMerged: args.nodesMerged,
			edgesMerged: args.edgesMerged,
			danglingRefs: args.danglingRefs,
			indexesBuilt: args.indexesBuilt,
		});
	});
};

module.exports = { extractBlock, replay };
