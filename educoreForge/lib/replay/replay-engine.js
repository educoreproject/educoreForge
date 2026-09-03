'use strict';

// replay-engine.js — the single schema-block<->graph boundary. harvestBlock serializes a
// graph subset into a PG-JSONL schema block; replay materializes an ordered manifest of blocks into a
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
const replayBlock = require('./replay-block')();
const contentAddress = require('../content-address/content-address')();

const BATCH_SIZE = 500;
const NEO4J_USER = 'neo4j';
const NODE_PAGE_SIZE = 2000; // bounds driver memory: embedded nodes carry 1024 floats each.

// =====================================================================
// HELPERS — pure
// =====================================================================

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
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

// =====================================================================
// CONSERVATION IDENTITY — ONE implementation, used by BOTH sides of the forge-to-harvest seam.
// =====================================================================
// The seam gate compares what was LOADED against what was HARVESTED. If the two sides computed
// their identity keys separately they would eventually disagree, and a disagreement between two
// copies of a key function is EXACTLY the class of silent divergence this gate exists to catch —
// so the gate must not contain one. This is the same reasoning the write path already states about
// its own two entry points: two doors into one implementation cannot disagree about what they mean.
//
// EDGE identity is (type, from, to, sorted key=VALUE property pairs). NOT the key SET: four SIF
// privacy references carry the identical key set {provenanceTier, nativeEdgeType, via, mandatory}
// and differ only in the VALUE of `via`, so a key-set form reports them as one and would certify
// their loss as conservation. MEASURED 2026-09-02: the forged SIF edge set is 88,757 distinct under
// the key-set form and 88,766 under this one.
const edgeConservationIdentityFor = (oneEdge) => {
	const propertyNameList = Object.keys(oneEdge.properties || {}).sort();
	const propertyText = propertyNameList
		.map((onePropertyName) => `${onePropertyName}=${JSON.stringify(oneEdge.properties[onePropertyName])}`)
		.join(',');
	return `${oneEdge.type}\u241f${oneEdge.fromRef.id}\u241f${oneEdge.toRef.id}\u241f${propertyText}`;
};

// NODE identity is the stableId. The two sides SPELL it differently — the loaded side carries
// ref.id (the forger's engine shape) and the harvested side carries stableId (the block shape) —
// so this reads either, deliberately and in one place, rather than letting each side normalise
// its own way.
const nodeConservationIdentityFor = (oneNode) =>
	oneNode.stableId !== undefined && oneNode.stableId !== null
		? `${oneNode.stableId}`
		: `${oneNode.ref && oneNode.ref.id}`;

// The summary carried across the seam. Counts are TOTALS (emissions); the sets are DISTINCT.
// total minus distinct is the DUPLICATE count, which the gate reports as a NUMBER and never as a
// failure — a naive count check on 2026-09-02 would have refused a build for nine cosmetic
// duplicates while missing the real defect entirely.
const conservationSummaryFor = ({ nodes, edges }) => ({
	nodeTotal: (nodes || []).length,
	edgeTotal: (edges || []).length,
	nodeIdentitySet: new Set((nodes || []).map(nodeConservationIdentityFor)),
	edgeIdentitySet: new Set((edges || []).map(edgeConservationIdentityFor)),
});

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
	// Persist the embedding provenance stamp the materializer set at the node's top level
	// (DECISIONS §3): every replayed node carries its embeddingModelVersion (e.g. 'voyage-4-large').
	if (node.embeddingModelVersion) props.embeddingModelVersion = node.embeddingModelVersion;
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
			// H8: the MERGE match key is :ForgedNode {stableId} ALONE — matching on the batch's
			// full label-set forked one stableId into duplicate nodes when two blocks stated
			// different label-sets for it (the overlay/curation shape). The remaining labels are
			// SET after the match, so label-sets UNION onto the single node. Every replayed node
			// carries :ForgedNode — enforced at deserialize time in replay(), before any write.
			const query = `
				UNWIND $batch AS row
				MERGE (n:\`ForgedNode\` {stableId: row.stableId})
				SET n:${clause}
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
		// provenanceTier rides the row (the blockType precedent) so a dangling edge's record
		// can carry it — spec §10.3's single authorized engine addition. PG-JSON single-element
		// array or scalar, same acceptance as findProvenanceViolations.
		const rows = byType[edgeType].map((oneEdge) => ({
			fromStableId: oneEdge.fromRef.id,
			toStableId: oneEdge.toRef.id,
			fromSrc: oneEdge.fromRef.source,
			toSrc: oneEdge.toRef.source,
			props: pgToStored(oneEdge.properties),
			blockType: oneEdge.blockType,
			provenanceTier: Array.isArray((oneEdge.properties || {}).provenanceTier)
				? (oneEdge.properties || {}).provenanceTier[0]
				: (oneEdge.properties || {}).provenanceTier,
		}));
		// ⚠ THE IDENTITY MAP MUST NOT CARRY A NULL, AN UNDEFINED, OR AN ARRAY HOLDING A NULL. The
		// write below hands `props` to apoc.merge.relationship as the IDENTITY map it matches on, so
		// such a value decides which relationship an edge merges onto. That is not a behaviour to
		// discover from a production build. MEASURED 2026-09-02 over the four blocks of the run3
		// store: 663,675 edges, 868,641 property VALUES, zero null, zero undefined, zero
		// array-containing-null. So this refuses a shape that does not occur today — it exists so
		// that it cannot START occurring silently.
		// The guard covers EXACTLY the shapes its justification names: a bare null, an undefined,
		// and an array carrying a null element. An empty string is deliberately NOT refused — it is
		// a legitimate value and it matches predictably.
		const identityHostileValue = (oneValue) =>
			oneValue === null ||
			oneValue === undefined ||
			(Array.isArray(oneValue) && oneValue.some((oneElement) => oneElement === null));
		const nullValuedRow = rows.find((oneRow) =>
			Object.keys(oneRow.props || {}).some((onePropertyName) => identityHostileValue(oneRow.props[onePropertyName])),
		);
		if (nullValuedRow) {
			const nullPropertyNameList = Object.keys(nullValuedRow.props).filter((onePropertyName) =>
				identityHostileValue(nullValuedRow.props[onePropertyName]),
			);
			callback(
				`mergeEdges: REFUSED — edge ${edgeType} ${nullValuedRow.fromStableId} -> ` +
					`${nullValuedRow.toStableId} carries identity-hostile propert(ies) — null, undefined, or an ` +
				`array holding null: ` +
					`${nullPropertyNameList.join(', ')}. Edge properties are the relationship's merge ` +
					`identity; a null there decides which relationship the edge merges onto and is ` +
					`never defaulted. Nothing written for this type.`,
			);
			return;
		}

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
			// PERF: endpoints labeled :ForgedNode so the reskey RANGE index on :ForgedNode(stableId)
			// drives a NodeIndexSeek (was AllNodesScan-per-row => O(edges x nodes)). Every replayed
			// node carries :ForgedNode — ENFORCED at deserialize time in replay() (a block with a
			// node missing the label is a hard error before any write), so the resolution SET is
			// identical. THAT change was purely a plan change and left the write itself alone.
			// ⚠ THE WRITE IS NO LONGER A CYPHER MERGE (2026-09-02) — see the note on the query below.
			// What survived BOTH changes unaltered is what this paragraph is really about: the
			// two-endpoint orphan gate, the batching, and the danglingRefs semantics.
			// ⚠ THE MERGE KEYS ON THE FULL PROPERTY MAP, AND IT MUST. A Cypher MERGE pattern cannot
			// take a map VARIABLE for its relationship properties, so the incumbent pattern carried
			// NONE — `MERGE (from)-[r:TYPE]->(to) SET r += e.props` matched ANY relationship of that
			// type between those two nodes and then overwrote its properties. OBSERVED on a scratch
			// graph 2026-09-02: four writes differing only in `via` produced ONE relationship
			// carrying the LAST via written. That is how SIF's four opposed privacy references
			// (ShareWith / DoNotShareWith / NeverShareWith / PermissionGrantee) became one edge.
			// apoc.merge.relationship merges on the identity map it is handed and stores no
			// synthetic key, so distinct-by-value edges survive and no block byte moves.
			//
			// GENUINELY IDENTICAL EDGES STILL MERGE, AND THAT IS LOAD-BEARING, NOT INCIDENTAL:
			// MEASURED over the seven-block fourWithHubDebugBridged manifest, the edfi standardBase
			// block and the ceds<->edfi relationship block share 169 byte-identical HAS_OPTION_SET
			// edges. CREATE would duplicate every one of them. A merge keyed on the full property
			// map collapses those 169 exactly as the incumbent did.
			//
			// THE SUBQUERY SHAPE IS THE POINT, NOT DECORATION. A procedure cannot be called inside
			// FOREACH, and the FOREACH is what let rows with an UNRESOLVED endpoint survive to the
			// RETURN that feeds danglingRefs. Filtering them out with a bare WHERE would drop them
			// before the RETURN and the dangling accounting would silently lose them. A CALL
			// subquery ENDING IN AN AGGREGATE returns exactly one row per outer row, so an
			// unresolved edge still reaches the RETURN with fromMissing/toMissing true and
			// mergedRelationshipCount 0, and `written` and `danglingRefs` keep their meanings.
			//
			// $edgeType is a PARAMETER now rather than a backtick-templated label, because apoc
			// takes the type as a string — which also closes the interpolation surface the template
			// form opened.
			const query = `
				UNWIND $edges AS e
				OPTIONAL MATCH (from:ForgedNode {stableId: e.fromStableId})
				OPTIONAL MATCH (to:ForgedNode   {stableId: e.toStableId})
				CALL {
					WITH e, from, to
					WITH e, from, to WHERE from IS NOT NULL AND to IS NOT NULL
					CALL apoc.merge.relationship(from, $edgeType, e.props, {}, to) YIELD rel
					RETURN count(rel) AS mergedRelationshipCount
				}
				RETURN e.fromSrc AS fromSrc, e.fromStableId AS fromStableId,
				       e.toSrc AS toSrc, e.toStableId AS toStableId,
				       e.blockType AS blockType,
				       e.provenanceTier AS provenanceTier,
				       (from IS NULL) AS fromMissing, (to IS NULL) AS toMissing,
				       mergedRelationshipCount AS mergedRelationshipCount
			`;
			session
				.run(query, { edges: batch, edgeType })
				.then((result) => {
					let invariantViolation = null;
					result.records.forEach((rec) => {
						const fromMissing = rec.get('fromMissing');
						const toMissing = rec.get('toMissing');
						if (!fromMissing && !toMissing) {
							// ⚠ A RESOLVED ROW MUST PRODUCE EXACTLY ONE RELATIONSHIP. apoc.merge.relationship
							// yields the relationship it matched or created, so a healthy write counts 1. TWO or
							// more means the identity map matched SEVERAL existing relationships, which can only
							// happen if the graph already held duplicates; ZERO means nothing was written while
							// both endpoints resolved. Neither would show in `written`, which counts ROWS and not
							// relationships — which is precisely the class of blindness this order exists to end.
							// OBSERVED RED 2026-09-02 against a CREATE-seeded graph holding two identical REFERENCES
							// between one pair: the refusal fired naming count 2. No load path in this tree can
							// produce that state today — that is a fact about the LOAD PATHS, not about the guard,
							// and this tree grew a third write door (bridge-framework/graphWriter) that nobody had
							// enumerated until the same day. A guard for a graph STATE cannot know how the state arose.
							const mergedRelationshipCount = neoToJs(rec.get('mergedRelationshipCount'));
							if (mergedRelationshipCount !== 1 && invariantViolation === null) {
								invariantViolation =
									`mergeEdges: REFUSED — edge ${edgeType} ${rec.get('fromStableId')} -> ` +
									`${rec.get('toStableId')} resolved both endpoints but merged ` +
									`${mergedRelationshipCount} relationship(s), not exactly 1. More than one means the ` +
									`identity map matched several existing relationships; zero means nothing was ` +
									`written. Neither is a count this loader may report as success.`;
							}
							written++;
							return;
						}
						danglingRefs.push({
							blockType: rec.get('blockType'),
							provenanceTier: rec.get('provenanceTier'),
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
					if (invariantViolation) {
						callback(invariantViolation);
						return;
					}
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
// harvestBlock — read a graph subset (READ-mode) into a PG-JSONL schema block.
// =====================================================================
// selector: {source:'CEDS'} for a standard block; {pairA,pairB} for a bridge block. Returns
// { blockText, nodeCount, edgeCount, stableIdCoverage }. Orders by stableId for byte-stable
// re-extraction.

const sourceOf = (oneSelector) =>
	typeof oneSelector === 'string'
		? oneSelector
		: oneSelector.standardKey || oneSelector.source;

const shapeNode = (neoNode, header, emitEmbeddingRef) => {
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
		if (emitEmbeddingRef) {
			// EXTRACT-path embedding sidecar (PLAN §3.4): the persisted block carries the
			// content-hash REF of the vector INPUT, not the base64 vector. The ref is a pure
			// function of (embeddingModelVersion, embed-input text) via the shared addressing
			// rule — identical to the forge decorator's key (F7). The raw vector + its
			// determinants ride on non-serialized _sidecar* fields so harvestBlock can putVector
			// them (F4); serializeNodeLine whitelists fields, so these never reach the block text.
			//
			// ⟪R-P2-2, 2026-08-03⟫ WHICH property was embedded is FORMAT-VERSIONED PER NODE
			// RECORD, because one folded block carries bases and hub cards together and they
			// embed different properties. A record carrying `embedSourceProperty` DECLARES its
			// embed input (hub cards declare 'embedText', stamped by the fold's embed pass); a
			// record NOT carrying it is the ORIGINAL FORMAT and keeps the searchText behavior
			// EXACTLY as it always was — a format discriminator, not a default. A DECLARED
			// property that is absent/empty on the node is a refusal naming node and property;
			// nothing is substituted.
			const declaredSourcePropertyName =
				props.embedSourceProperty !== undefined && props.embedSourceProperty !== null
					? `${neoToJs(props.embedSourceProperty)}`
					: null;
			let embedInputValue;
			if (declaredSourcePropertyName !== null) {
				if (declaredSourcePropertyName.trim() === '') {
					throw new Error(
						`replay-engine.shapeNode: node '${stableId}' declares an EMPTY ` +
							`embedSourceProperty — a declaration must name a property; nothing is ` +
							`substituted.`,
					);
				}
				const declaredValue = props[declaredSourcePropertyName];
				embedInputValue =
					declaredValue !== undefined && declaredValue !== null
						? `${neoToJs(declaredValue)}`
						: null;
				if (embedInputValue === null || embedInputValue.trim() === '') {
					throw new Error(
						`replay-engine.shapeNode: node '${stableId}' declares embedSourceProperty ` +
							`'${declaredSourcePropertyName}' but carries no value under it — cannot ` +
							`compute embeddingRef; a declared embed input that is absent is refused, ` +
							`never substituted.`,
					);
				}
			} else {
				// ORIGINAL FORMAT — byte-identical behavior to the pre-R-P2-2 engine.
				const searchTextValue =
					props.searchText !== undefined && props.searchText !== null
						? `${neoToJs(props.searchText)}`
						: null;
				if (searchTextValue === null || searchTextValue.trim() === '') {
					throw new Error(
						`replay-engine.shapeNode: node '${stableId}' carries an embedding but no ` +
							`searchText — cannot compute embeddingRef (the addressing input is missing)`,
					);
				}
				embedInputValue = searchTextValue;
			}
			node.embeddingRef = contentAddress.vectorIdForInput(
				header.embeddingModelVersion,
				embedInputValue,
			);
			node.embeddingModelVersion = header.embeddingModelVersion;
			node._sidecarVector = props.embedding.map(neoToJs);
			node._sidecarInputText = embedInputValue;
		} else {
			node.embedding = replayBlock.encodeEmbedding(props.embedding.map(neoToJs));
			node.embeddingModelVersion = header.embeddingModelVersion;
		}
	}
	return node;
};

// eachEntrySequentialStackSafe — run an async worker over items ONE at a time, STACK-SAFE whether
// the worker's callback fires synchronously (sqlite-instance/better-sqlite3 IS synchronous) or
// asynchronously. A naive putOne(i+1)-from-the-callback recursion grows the stack by one frame per
// item under a synchronous store — thousands deep on a real standard (~14k distinct searchText for
// CEDS) → stack overflow. This trampoline loops on synchronous completion instead of recursing, and
// re-enters on asynchronous completion. (The existing forges sidestep this by recursing per BATCH,
// not per item; the extract puts one row per distinct vector, so it needs the flat driver.)
const eachEntrySequentialStackSafe = (items, worker, done) => {
	let index = 0;
	let running = false;
	let advanced = false;
	const iterate = () => {
		if (running) {
			advanced = true; // a synchronous completion re-entered — let the active loop continue
			return;
		}
		running = true;
		advanced = true;
		while (advanced) {
			advanced = false;
			if (index >= items.length) {
				running = false;
				done('');
				return;
			}
			const current = items[index];
			index++;
			worker(current, (err) => {
				if (err) {
					running = false;
					done(err);
					return;
				}
				if (running) {
					advanced = true; // synchronous callback: continue the while loop, no recursion
				} else {
					iterate(); // asynchronous callback: re-enter the driver
				}
			});
		}
		running = false;
	};
	iterate();
};

// putDistinctNodeVectors — persist each DISTINCT embeddingRef's raw vector (carried on the
// _sidecar* fields shapeNode attached in emitEmbeddingRef mode) into the injected per-standard
// store, idempotent first-write-wins, then strip those carrier fields. No vectorStore -> no-op.
// NEVER reorders `nodes` (determinism). Split out of harvestBlock so the gate can drive it
// graph-free; exported alongside shapeNode.
const putDistinctNodeVectors = ({ nodes, vectorStore }, callback) => {
	if (!vectorStore) {
		callback('');
		return;
	}
	const distinctByRef = new Map();
	(nodes || []).forEach((oneNode) => {
		if (
			oneNode.embeddingRef &&
			oneNode._sidecarVector &&
			!distinctByRef.has(oneNode.embeddingRef)
		) {
			distinctByRef.set(oneNode.embeddingRef, {
				modelVersion: oneNode.embeddingModelVersion,
				inputText: oneNode._sidecarInputText,
				vector: oneNode._sidecarVector,
			});
		}
	});
	const distinctEntries = Array.from(distinctByRef.values());
	eachEntrySequentialStackSafe(
		distinctEntries,
		(oneEntry, entryDone) => vectorStore.putVector(oneEntry, entryDone),
		(err) => {
			if (err) {
				callback(`harvestBlock putVector: ${err}`);
				return;
			}
			(nodes || []).forEach((oneNode) => {
				delete oneNode._sidecarVector;
				delete oneNode._sidecarInputText;
			});
			callback('');
		},
	);
};

// resolveNodeVectors — the READ-side mirror of putDistinctNodeVectors (PLAN §3.5, Phase 3). For every
// node carrying an embeddingRef (and NO inline embedding — the dual-read leaves legacy inline nodes to
// the untouched path), resolve the ref to its raw vector via the per-standard sidecar store and set
// node.embedding (the number[] buildNodeRow persists — buildNodeRow is UNCHANGED). The store is chosen
// PER NODE by its standardKey: a golden manifest spans MANY standards, each with its OWN vectorStore, so
// the injected dependency is a store-RESOLVER storeResolver(standardKey, cb)->vectorStore (lazy+cached in
// the CLI), NOT one fixed store.
//
// Distinct work is keyed on (standardKey, embeddingRef): identical inputs INTERN to ONE getVector, then
// the resolved vector fans out to every node sharing that key. The per-entry loop runs through
// eachEntrySequentialStackSafe because sqlite-instance callbacks are SYNCHRONOUS — a naive per-ref
// recursion would overflow the stack over ~15k distinct refs, exactly the hazard the write-side driver
// guards.
//
// FAIL-LOUD is the crux (PLAN §6, risk "non-determinism leak"): getVector returns ('', null) on ABSENCE
// (a cold-cache miss is not an error at the store layer), so a MISSING ref at replay time must be made
// to fail HERE, naming standardKey+embeddingRef — a silently-null embedding would corrupt the graph. A
// resolver "no store" error, a getVector corrupt-row refusal, and a resolved-dims != header.embeddingDims
// mismatch ALL propagate error-first. NO storeResolver -> NO-OP (legacy inline replay + the untouched
// materializer ephemeral path are unaffected). Mutates node.embedding in place; NEVER reorders nodes.
const resolveNodeVectors = ({ nodes, storeResolver, header }, callback) => {
	const REF_KEY_SEP = String.fromCharCode(0);
	const compositeKey = (standardKey, embeddingRef) =>
		`${standardKey}${REF_KEY_SEP}${embeddingRef}`;

	if (!storeResolver) {
		// ⟪P2-review M-2⟫ NO RESOLVER is legal ONLY for legacy inline material. A node carrying
		// embeddingRef without an inline embedding is REF-STYLE: its vector lives in the
		// per-standard store, and proceeding without a resolver would merge it into the graph
		// with no embedding and no trace (buildNodeRow does not persist the ref) — a silently
		// blind graph every downstream cosine would search without noticing. The check IS the
		// old-vs-ref format discriminator, in the R-P2-2 idiom: legacy inline manifests carry
		// no refs and pass through exactly as they always did; a ref-style block without a
		// resolver is refused naming the first offender.
		const firstRefStyleNode = (nodes || []).find(
			(oneNode) => oneNode.embeddingRef && !oneNode.embedding,
		);
		if (firstRefStyleNode) {
			callback(
				`replay-engine.resolveNodeVectors: REFUSED — node ` +
					`'${firstRefStyleNode.stableId}' (standard ` +
					`'${firstRefStyleNode._standardKey}') carries embeddingRef ` +
					`'${firstRefStyleNode.embeddingRef}' with no inline embedding, and NO ` +
					`storeResolver was supplied. A ref-style block requires a storeResolver; ` +
					`restoring it without one would write a vectorless graph and say nothing.`,
			);
			return;
		}
		// legacy path: strip the transient standardKey tag (set in replay()'s accumulation) so
		// it never lingers, and leave inline embeddings exactly as the legacy read produced them.
		(nodes || []).forEach((oneNode) => {
			delete oneNode._standardKey;
		});
		callback('');
		return;
	}

	// ⟪MIXED VECTOR WIDTHS, tqii 2026-08-13⟫ the block header's embeddingDims was read here for the
	// store/header equality check below. That check is gone (see its site for why), and nothing else
	// on this path consulted the header — a resolved vector's own `record.dims` is authoritative —
	// so the read is gone with it rather than left as a variable nobody uses.

	// DISTINCT (standardKey, embeddingRef) over ref-carrying nodes without an inline embedding.
	const distinctByKey = new Map();
	(nodes || []).forEach((oneNode) => {
		if (oneNode.embeddingRef && !oneNode.embedding) {
			const key = compositeKey(oneNode._standardKey, oneNode.embeddingRef);
			if (!distinctByKey.has(key)) {
				distinctByKey.set(key, {
					standardKey: oneNode._standardKey,
					embeddingRef: oneNode.embeddingRef,
				});
			}
		}
	});
	const distinctEntries = Array.from(distinctByKey.values());
	const resolvedByKey = new Map(); // (standardKey,ref) -> vector (number[])

	eachEntrySequentialStackSafe(
		distinctEntries,
		(oneEntry, entryDone) => {
			storeResolver(oneEntry.standardKey, (resolverErr, vectorStore) => {
				if (resolverErr) {
					entryDone(
						`resolveNodeVectors: cannot resolve a vector store for standard ` +
							`'${oneEntry.standardKey}' (embeddingRef ${oneEntry.embeddingRef}): ${resolverErr}`,
					);
					return;
				}
				vectorStore.getVector(
					{ vectorId: oneEntry.embeddingRef },
					(getErr, record) => {
						if (getErr) {
							entryDone(
								`resolveNodeVectors: getVector refused embeddingRef ` +
									`${oneEntry.embeddingRef} (standard '${oneEntry.standardKey}'): ${getErr}`,
							);
							return;
						}
						if (!record) {
							// FAIL LOUD: absence is not a store error, but a missing ref at replay time
							// means the per-standard sidecar is incomplete — a null embedding would
							// silently corrupt the graph. Refuse, naming the ref + standard.
							entryDone(
								`resolveNodeVectors: embeddingRef ${oneEntry.embeddingRef} is ABSENT ` +
									`from the vector store for standard '${oneEntry.standardKey}' — the ` +
									`per-standard sidecar is incomplete (transport gap). No graph written.`,
							);
							return;
						}
						// ⟪MIXED VECTOR WIDTHS, tqii ruling 2026-08-13⟫ A stored vector whose width differs
						// from the block header's declaration is NO LONGER REFUSED. The header is one
						// number for a block that may hold nodes from several standards, and Voyage
						// supports lengths that are compatible and comparable — so a difference here is a
						// legitimate condition, not a store/header corruption. `record.dims` is the width
						// of the vector actually retrieved and is authoritative for that vector.
						//
						// WHAT WAS GIVEN UP, stated plainly: this check also used to catch a genuinely
						// mismatched sidecar (right ref, wrong store). That case now passes through and
						// would surface later as a bad vector rather than a named refusal here. The
						// per-vector integrity checks in the store and decodeEmbedding's
						// not-a-multiple-of-four refusal remain.
						resolvedByKey.set(
							compositeKey(oneEntry.standardKey, oneEntry.embeddingRef),
							record.vector,
						);
						entryDone('');
					},
				);
			});
		},
		(err) => {
			if (err) {
				callback(err);
				return;
			}
			// INTERN: fan the resolved vector out to every node sharing (standardKey, embeddingRef), then
			// strip the transient standardKey tag so it never reaches buildNodeRow / the materialized graph.
			(nodes || []).forEach((oneNode) => {
				if (oneNode.embeddingRef && !oneNode.embedding) {
					const vector = resolvedByKey.get(
						compositeKey(oneNode._standardKey, oneNode.embeddingRef),
					);
					if (vector) {
						// INVARIANT: node.embedding here is a SHARED array reference across all nodes with the
						// same (standardKey, embeddingRef); it MUST be treated read-only downstream — in-place
						// mutation would corrupt every co-referring node. Verified 2026-07-09: no downstream
						// mutation exists. If a future change must mutate embeddings post-resolution, .slice()
						// per node first.
						oneNode.embedding = vector;
					}
				}
				delete oneNode._standardKey;
			});
			callback('');
		},
	);
};

const shapeEdgeProps = (props) => {
	const out = {};
	Object.keys(props || {}).forEach((oneKey) => {
		out[oneKey] = pgArray(props[oneKey]);
	});
	return out;
};

const fetchNodesPaged = (session, source, header, emitEmbeddingRef, callback) => {
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
					nodes.push(shapeNode(rec.get('n'), header, emitEmbeddingRef)),
				);
				if (result.records.length < NODE_PAGE_SIZE) {
					callback('', nodes);
					return;
				}
				pageNext(skip + NODE_PAGE_SIZE);
			})
			.catch((err) => callback(`harvestBlock fetchNodes failed: ${err.message}`));
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
			callback(`harvestBlock fetchStandardEdges failed: ${err.message}`),
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
			callback(`harvestBlock fetchBridgeEdges failed: ${err.message}`),
		);
};

// LABEL-SCOPED HARVEST (targetArchitectureDesign §4). The incumbent selected a block by the
// `_source` property; the recreation selects POSITIVELY BY LABEL, because the orchestrator hands
// the label down at init time and therefore knows it is the same word on both sides. A graph may
// hold a standard's base AND its hub subgraph at once, which `_source` alone cannot separate.
//
// Labels are validated as bare identifiers before interpolation: a label position cannot be
// parameterized in Cypher, so this is the same injection guard the edge-type validator provides.
const LABEL_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

const labelRefusal = (selectionLabels) => {
	if (!Array.isArray(selectionLabels) || selectionLabels.length === 0) {
		return 'harvestBlock: selectionLabels must be a non-empty array of label names';
	}
	const bad = selectionLabels.filter((oneLabel) => !LABEL_RE.test(oneLabel));
	if (bad.length > 0) {
		return (
			`harvestBlock: invalid label name(s) ${JSON.stringify(bad)} — a label is a bare ` +
			`identifier (the colons in ':StandardBase:' are Cypher notation, not part of the name)`
		);
	}
	return '';
};

const labelMatch = (selectionLabels) =>
	selectionLabels.map((oneLabel) => `\`${oneLabel}\``).join(':');

const fetchNodesByLabelsPaged = (session, selectionLabels, header, emitEmbeddingRef, callback) => {
	const nodes = [];
	const clause = labelMatch(selectionLabels);
	const pageNext = (skip) => {
		session
			.run(
				`MATCH (n:${clause}) RETURN n ORDER BY n.stableId SKIP $skip LIMIT $limit`,
				{ skip: neo4j.int(skip), limit: neo4j.int(NODE_PAGE_SIZE) },
			)
			.then((result) => {
				result.records.forEach((rec) =>
					nodes.push(shapeNode(rec.get('n'), header, emitEmbeddingRef)),
				);
				if (result.records.length < NODE_PAGE_SIZE) {
					callback('', nodes);
					return;
				}
				pageNext(skip + NODE_PAGE_SIZE);
			})
			.catch((err) => callback(`harvestBlock fetchNodesByLabels failed: ${err.message}`));
	};
	pageNext(0);
};

// Edges with BOTH endpoints inside the selected labels. A block carries only the edges whose
// endpoints it also carries; anything else would deserialize into a dangling reference.
const fetchEdgesWithinLabels = (session, selectionLabels, callback) => {
	const clause = labelMatch(selectionLabels);
	session
		.run(
			`MATCH (a:${clause})-[r]->(b:${clause})
			 RETURN a._source AS fromSrc, a.stableId AS fromStableId, type(r) AS type,
			        b._source AS toSrc, b.stableId AS toStableId, properties(r) AS props
			 ORDER BY fromStableId, type, toStableId`,
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
		.catch((err) => callback(`harvestBlock fetchEdgesWithinLabels failed: ${err.message}`));
};

const harvestBlock = ({ boltUri, password, selector, header, vectorStore }, callback) => {
	const driver = openDriver(boltUri, password);
	const session = driver.session({ defaultAccessMode: neo4j.session.READ });
	const isBridge = !!(selector && selector.pairA);
	// selector = { selectionLabels: [...] } is the RECREATION path; { source } and { pairA, pairB }
	// are the incumbent-faithful ones, kept because they are proven and cost nothing.
	const selectionLabels = selector && selector.selectionLabels;
	const isLabelScoped = !!selectionLabels;
	if (isLabelScoped) {
		const refusal = labelRefusal(selectionLabels);
		if (refusal) {
			session.close().then(() => driver.close());
			callback(refusal);
			return;
		}
	}
	// EXTRACT-path embedding sidecar (F1/F2): when a per-standard vectorStore is injected, shapeNode
	// emits embeddingRef (not base64) and the raw vectors are persisted below. Absent a vectorStore,
	// the extract keeps the legacy inline base64 (unchanged behavior for callers that don't opt in).
	const emitEmbeddingRef = !!vectorStore;

	const taskList = new taskListPlus();

	taskList.push((args, next) => {
		if (isBridge) {
			next('', { ...args, nodes: [] });
			return;
		}
		const collect = (err, nodes) => {
			if (err) {
				next(err);
				return;
			}
			next('', { ...args, nodes });
		};
		if (isLabelScoped) {
			fetchNodesByLabelsPaged(session, selectionLabels, header, emitEmbeddingRef, collect);
			return;
		}
		fetchNodesPaged(session, sourceOf(selector.source), header, emitEmbeddingRef, collect);
	});

	// EXTRACT-side vector persistence (F4): putVector every DISTINCT embeddingRef's raw vector into
	// the per-standard store (idempotent first-write-wins), so the block's refs resolve. The forge
	// decorator is the authoritative writer on a fresh forge; this is the ref-writer + safety net.
	// Order-independent: serialization below uses args.nodes AS-IS, so node-line order is unchanged.
	taskList.push((args, next) => {
		putDistinctNodeVectors({ nodes: args.nodes, vectorStore }, (err) =>
			next(err, args),
		);
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
		const collectEdges = (err, edges) => {
			if (err) {
				next(err);
				return;
			}
			next('', { ...args, edges });
		};
		if (isLabelScoped) {
			fetchEdgesWithinLabels(session, selectionLabels, collectEdges);
			return;
		}
		fetchStandardEdges(session, sourceOf(selector.source), collectEdges);
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
			// ADDITIVE, for the forge-to-harvest conservation gate. Built HERE, where the harvested
			// nodes and edges are already in hand, rather than by re-parsing the block text — which
			// would be a second reading of the same thing and a second place to drift.
			harvestedConservationSummary: conservationSummaryFor({ nodes: args.nodes, edges: args.edges }),
		});
	});
};

// =====================================================================
// THE SHARED WRITE PATH — one implementation, two entry points
// =====================================================================
// Everything below the deserialize boundary is common to BOTH ways content reaches a graph:
//
//     replay()  =  deserialize block text  -> writeShapedGraph      (RESTORATION)
//     init()    =  applyLabels to nodeEdges -> writeShapedGraph     (CREATION)
//
// It is one function because it was very nearly two. The guards, the resolution-key index, the
// merge order and the vector index all used to live inside replay(), reachable only through block
// TEXT; a creation path that took shaped objects would have had to reimplement them, and a second
// implementation is a second thing to drift. Two entry points into one write path cannot disagree
// about what a safe write is.
//
// A "group" is one labeled batch of shaped nodes+edges: replay passes ONE PER BLOCK so its errors
// keep naming the offending block, and init passes a single group naming its forge bundle.
//   group = { sourceLabel: string, nodes: [...], edges: [...] }

// validateShapedGraph — the SHAPE check and the THREE pre-write guards, pure and synchronous.
// Returns { error, nodes, edges }: error '' means admitted, and nodes/edges are the SINGLE
// flattened walk the writer then uses (assembling them twice would let the thing that was
// validated drift from the thing that gets written).
//
// It FAILS CLOSED on a malformed argument. That is not defensive noise: the first review of this
// function found that `groups = []` plus `oneGroup.nodes || []` made "I could not find any nodes"
// indistinguishable from "there were no nodes", so handing it a bare node array — precisely the
// shape a caller has in hand — admitted a graph in which every node violated every guard. A guard
// that can be bypassed by a caller's shape mistake is the same silent failure as a guard that was
// deleted, wearing a different hat.
//
// Guard order is significant and matches the original replay(): label, then stableId, then
// provenanceTier. Every message names the offending group and the first offender, because a
// failure that names nothing is a failure you cannot act on.
const validateShapedGraph = (groups) => {
	const refuse = (message) => ({ error: message, nodes: [], edges: [] });

	if (!Array.isArray(groups)) {
		return refuse(
			`shape enforcement: writeShapedGraph expects an ARRAY of groups, got ` +
				`${groups === null ? 'null' : typeof groups}. No writes performed.`,
		);
	}

	const labelViolations = [];
	const nullIdViolations = [];
	const provenanceViolations = [];
	const allNodes = [];
	const allEdges = [];

	for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
		const oneGroup = groups[groupIndex];

		// SHAPE — a group must BE a group. Anything else is a caller bug, not an empty graph.
		if (!oneGroup || typeof oneGroup !== 'object' || Array.isArray(oneGroup)) {
			return refuse(
				`shape enforcement: groups[${groupIndex}] is not a group object ` +
					`{sourceLabel, nodes, edges}. No writes performed.`,
			);
		}
		if (typeof oneGroup.sourceLabel !== 'string' || oneGroup.sourceLabel.trim() === '') {
			return refuse(
				`shape enforcement: groups[${groupIndex}] has no sourceLabel — every guard message ` +
					`must be able to name where the offending content came from. No writes performed.`,
			);
		}
		if (!Array.isArray(oneGroup.nodes) || !Array.isArray(oneGroup.edges)) {
			return refuse(
				`shape enforcement: group '${oneGroup.sourceLabel}' must carry nodes[] and edges[] ` +
					`(got nodes=${typeof oneGroup.nodes}, edges=${typeof oneGroup.edges}). ` +
					`A missing array must never read as an empty one. No writes performed.`,
			);
		}

		const sourceLabel = oneGroup.sourceLabel;

		// GUARD 1 — every written node must carry :ForgedNode. Edge endpoints resolve ONLY via
		// (:ForgedNode {stableId}), so a node without it merges fine and then every edge touching
		// it lands in danglingRefs while the run exits 0. Silent, and therefore the worst kind.
		// `labels` must BE an array: a bare string would satisfy indexOf by substring.
		const badLabelShape = oneGroup.nodes.filter((oneNode) => !Array.isArray(oneNode.labels));
		if (badLabelShape.length > 0) {
			return refuse(
				`shape enforcement: group '${sourceLabel}' has ${badLabelShape.length} node(s) whose ` +
					`labels is not an array (first: stableId='${badLabelShape[0].stableId}', ` +
					`labels=${JSON.stringify(badLabelShape[0].labels)}). No writes performed.`,
			);
		}
		const offenders = oneGroup.nodes.filter(
			(oneNode) => oneNode.labels.indexOf('ForgedNode') === -1,
		);
		if (offenders.length > 0) {
			labelViolations.push(
				`${sourceLabel}: ${offenders.length} node(s) missing the ForgedNode label; ` +
					`first offender stableId='${offenders[0].stableId}' ` +
					`labels=[${offenders[0].labels.join(', ')}]`,
			);
		}

		// GUARD 2 — stableId is the MERGE resolution key. A null one used to abort MID-BATCH,
		// after earlier batches had already committed: a silently partial graph. The empty string
		// is refused for the same reason a null is — it is not an identity, and every node
		// carrying it would MERGE onto one another.
		const nullIdOffenders = oneGroup.nodes.filter(
			(oneNode) =>
				oneNode.stableId === null || oneNode.stableId === undefined || oneNode.stableId === '',
		);
		if (nullIdOffenders.length > 0) {
			nullIdViolations.push(
				`${sourceLabel}: ${nullIdOffenders.length} node(s) with null/missing/empty stableId; ` +
					`first offender labels=[${(nullIdOffenders[0].labels || []).join(', ')}]`,
			);
		}

		// GUARD 3 — provenanceTier on every edge (§21). Checked PER GROUP so the refusal can name
		// the source, which the first version of this function could not do.
		findProvenanceViolations(oneGroup.edges).forEach((oneViolation) =>
			provenanceViolations.push({ ...oneViolation, sourceLabel }),
		);

		oneGroup.nodes.forEach((oneNode) => allNodes.push(oneNode));
		oneGroup.edges.forEach((oneEdge) => allEdges.push(oneEdge));
	}

	if (labelViolations.length > 0) {
		return refuse(
			`ForgedNode enforcement: ${labelViolations.length} non-conforming source(s) — every written node ` +
				`must carry the ForgedNode label (edge endpoints resolve ONLY via :ForgedNode(stableId); a node ` +
				`without it makes every touching edge dangle silently). ${labelViolations.join(' | ')} No writes performed.`,
		);
	}
	if (nullIdViolations.length > 0) {
		return refuse(
			`stableId enforcement: ${nullIdViolations.length} non-conforming source(s) — every written node ` +
				`must carry a non-null stableId (it is the MERGE resolution key; a null aborts mid-batch and ` +
				`leaves a partial graph). ${nullIdViolations.join(' | ')} No writes performed.`,
		);
	}
	if (provenanceViolations.length > 0) {
		const sample = provenanceViolations[0];
		return refuse(
			`provenanceTier enforcement: ${provenanceViolations.length} edge(s) missing/invalid ` +
				`provenanceTier (must be one of ${replayBlock.PROVENANCE_TIERS.join(', ')}); ` +
				`first offender in '${sample.sourceLabel}': ${sample.edgeType} ${JSON.stringify(sample.fromRef)} -> ` +
				`${JSON.stringify(sample.toRef)} tier=${JSON.stringify(sample.provenanceTier)}. ` +
				`No edges written.`,
		);
	}

	return { error: '', nodes: allNodes, edges: allEdges };
};
// writeShapedGraph — validate, resolve vectors, index, merge, index. The caller owns the session
// (and closing it); this owns what a safe write IS.
// -----
// kernelSupportsVectorIndex — does this Neo4j kernel have the GA CREATE VECTOR INDEX (>= 5.13)?
//
//   kernelSupportsVectorIndex(versionString) -> { supported } | { error }
//
// `const major = parts[0] || 0; const minor = parts[1] || 0;` read an UNPARSEABLE version
// (parseInt -> NaN) as 0.0 — "older than 5.13" — and the index was skipped. The skip WAS recorded,
// but as the wrong fact: "this server is too old" when the truth was "I could not read what this
// server said". Two different facts producing one behavior, with the report asserting the false
// one. A version string is external input, and polyArch2 §6 puts a present-but-invalid input in
// the worst class. It is refused, quoting exactly what the server answered.
const kernelSupportsVectorIndex = (versionString) => {
	if (versionString === undefined || versionString === null || `${versionString}`.trim() === '') {
		return {
			error:
				`the server answered no kernel version (dbms.components() returned ` +
				`${JSON.stringify(versionString)}). Whether the vector index can be built is not a ` +
				`question to answer by guessing.`,
		};
	}
	const given = `${versionString}`.trim();
	const parts = given.split('.');
	if (parts.length < 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
		return {
			error:
				`unparseable kernel version '${given}'. A version this module cannot read is NOT ` +
				`the same fact as a server older than 5.13, and it is not reported as one — the ` +
				`vector index was neither built nor recorded as skipped-for-age.`,
		};
	}
	const major = Number(parts[0]);
	const minor = Number(parts[1]);
	return { supported: major > 5 || (major === 5 && minor >= 13) };
};

const writeShapedGraph = (
	{ session, groups, storeResolver, embeddingDims, graphName },
	callback,
) => {
	const resKeyIndex = resKeyIndexName();
	const vectorIndex = vectorIndexName(graphName);
	const taskList = new taskListPlus();

	// --- SHAPE + ALL THREE GUARDS, before anything is written. This is the load-bearing line of
	//     the whole extraction: nothing may touch the session until validateShapedGraph has
	//     admitted the content, and the nodes/edges written below are the ones IT walked — not a
	//     second, independently assembled flattening that could drift from what was checked.
	taskList.push((args, next) => {
		const validated = validateShapedGraph(groups);
		if (validated.error) {
			next(validated.error);
			return;
		}
		next('', { ...args, allNodes: validated.nodes, allEdges: validated.edges });
	});

	// --- RESOLVE embedding refs (PLAN §3.5): for every node carrying an embeddingRef, resolve it to
	//     the vector via the per-standard storeResolver and set node.embedding BEFORE any write, so
	//     buildNodeRow persists it exactly as the legacy inline path would. FAIL LOUD on a
	//     missing/corrupt/dims-mismatched ref. NO storeResolver -> no-op (the creation path and
	//     legacy inline blocks are both unaffected). Placed BEFORE the index so a resolution failure
	//     means NO writes were performed, matching the guards above.
	taskList.push((args, next) => {
		resolveNodeVectors(
			{ nodes: args.allNodes, storeResolver, header: { embeddingDims } },
			(err) => {
				if (err) {
					next(err);
					return;
				}
				next('', args);
			},
		);
	});

	// --- PHASE 1 (before node MERGE): resolution-key index on stableId, on the EMPTY store.
	taskList.push((args, next) => {
		session
			.run(`CREATE INDEX ${resKeyIndex} IF NOT EXISTS FOR (n:ForgedNode) ON (n.stableId)`)
			.then(() => session.run('CALL db.awaitIndexes(300)'))
			.then(() => next('', args))
			.catch((err) => next(`phase1 resolution-key index failed: ${err.message}`));
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

	// --- PHASE 3 (after edges): vector index (cosine), off the write hot path. The PRODUCTION form
	// is the GA Cypher `CREATE VECTOR INDEX ... OPTIONS {...}`, which requires a Neo4j kernel >=
	// 5.13. We probe the server's kernel version first: on a capable server the index is built per
	// spec; on an older server we record the index as skipped rather than erroring — write
	// correctness does not depend on it, and the production golden runs a modern Neo4j.
	taskList.push((args, next) => {
		const indexesBuilt = [resKeyIndex];
		if (!embeddingDims) {
			next('', { ...args, indexesBuilt });
			return;
		}
		const buildVectorIndex = () => {
			const vectorQuery = `
				CREATE VECTOR INDEX ${vectorIndex} IF NOT EXISTS
				FOR (n:ForgedNode) ON (n.embedding)
				OPTIONS {indexConfig: {
					\`vector.dimensions\`: ${embeddingDims},
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
			.run('CALL dbms.components() YIELD versions RETURN versions[0] AS kernelVersion')
			.then((result) => {
				const kernelVersion = result.records[0] && result.records[0].get('kernelVersion');
				const capability = kernelSupportsVectorIndex(kernelVersion);
				if (capability.error) {
					next(`phase3 version probe: ${capability.error}`);
					return;
				}
				if (capability.supported) {
					buildVectorIndex();
					return;
				}
				indexesBuilt.push(`${vectorIndex}:skipped(serverVersion ${kernelVersion} < 5.13)`);
				next('', { ...args, indexesBuilt });
			})
			.catch((err) => next(`phase3 version probe failed: ${err.message}`));
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
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

// =====================================================================
// resolveManifestEmbeddingDims — reconcile the embeddingDims declared across a manifest's blocks
// into the ONE value the vector index is built from (writeShapedGraph builds the cosine index iff
// this is truthy). Returns { error, embeddingDims }, error-first like every refusal in this module.
// =====================================================================
// The defect this closes (deep-dive review): the accumulator was `if (dims === null) dims =
// h.embeddingDims`. Only a block that DECLARES a dimension should contribute, but an edge-only
// first block carries embeddingDims === undefined; the old guard seeded `dims = undefined`, its
// strict `=== null` test never fired again, and a LATER vectorized block's real dimension was
// dropped — writeShapedGraph then read a falsy dims and SKIPPED the index with no error. A
// one-position manifest reordering silently decided whether the golden was searchable. Two fixes,
// one invariant (a graph that should be searchable is never silently left unsearchable):
//   (a) undefined and null are treated IDENTICALLY — neither is a declaration, so only a numeric
//       embeddingDims seeds or is compared; an edge-only block can no longer strand the value.
//   (b) blocks that declare DIFFERENT dimensions is a corruption we REFUSE loudly, naming both
//       blocks and both values — never silently pick one and build an index the other's vectors
//       cannot use. An all-edge-only manifest yields null (no vectors, so no index is correct).
const resolveManifestEmbeddingDims = (blockDims) => {
	let embeddingDims = null;
	let declaringBlockName = null;
	for (let index = 0; index < blockDims.length; index++) {
		const oneBlock = blockDims[index];
		if (typeof oneBlock.embeddingDims !== 'number') continue;
		if (embeddingDims === null) {
			embeddingDims = oneBlock.embeddingDims;
			declaringBlockName = oneBlock.blockName;
			continue;
		}
		if (oneBlock.embeddingDims !== embeddingDims) {
			return {
				error:
					`embeddingDims disagreement across manifest blocks: ${declaringBlockName} ` +
					`declares ${embeddingDims} but ${oneBlock.blockName} declares ` +
					`${oneBlock.embeddingDims}. A single graph cannot carry two vector dimensions. ` +
					`No writes performed.`,
			};
		}
	}
	return { error: '', embeddingDims };
};

// =====================================================================
// PUBLIC API — replay({ manifest, boltUri, password, graphName? }, callback)
// =====================================================================
const replay = ({ manifest, boltUri, password, graphName, storeResolver }, callback) => {
	const driver = openDriver(boltUri, password);
	const session = driver.session();

	// --- Deserialize the manifest (pure) -> ONE GROUP PER BLOCK. The group's sourceLabel carries
	//     the block's identity, so every guard message from writeShapedGraph still names the
	//     offending block exactly as it did when the guards lived here.
	const groups = [];
	const blockDims = [];

	for (let entryIndex = 0; entryIndex < manifest.length; entryIndex++) {
		const entry = manifest[entryIndex];
		const entryName =
			typeof entry === 'string' && entry.indexOf('\n') === -1 ? ` (${entry})` : '';
		// deserializeBlock throws on corrupt/malformed block text. Contain the throw at this
		// boundary and route it error-first, so the session/driver close on the normal error path
		// instead of leaking through a process crash.
		let block;
		try {
			block = replayBlock.deserializeBlock(readManifestEntry(entry));
		} catch (deserializeError) {
			session.close().then(() => driver.close());
			callback(
				`deserialize failed: manifest[${entryIndex}]${entryName} is not a readable ` +
					`block — ${deserializeError.message}. No writes performed.`,
			);
			return;
		}
		const h = block.header || {};
		const blockName =
			h.blockType === 'bridge'
				? `bridge ${h.pairA}~${h.pairB}`
				: `${h.blockType} ${h.standardKey} v${h.version}`;

		blockDims.push({ blockName, embeddingDims: h.embeddingDims });

		// Tag each node with its block's standardKey — a TRANSIENT carrier resolveNodeVectors reads
		// to pick the per-standard store, then STRIPS (it never persists; buildNodeRow whitelists
		// fields). Edges are tagged with blockType the same way, for violation reporting.
		block.nodes.forEach((oneNode) => {
			oneNode._standardKey = h.standardKey;
		});

		groups.push({
			sourceLabel: `manifest[${entryIndex}] ${blockName}${entryName}`,
			nodes: block.nodes,
			edges: block.edges.map((oneEdge) => ({ ...oneEdge, blockType: h.blockType })),
		});
	}

	const dimsResolution = resolveManifestEmbeddingDims(blockDims);
	if (dimsResolution.error) {
		session.close().then(() => driver.close());
		callback(dimsResolution.error);
		return;
	}
	const embeddingDims = dimsResolution.embeddingDims;

	writeShapedGraph(
		{ session, groups, storeResolver, embeddingDims, graphName },
		(err, result) => {
			session.close().then(() => driver.close());
			if (err) {
				callback(err);
				return;
			}
			callback('', result);
		},
	);
};

return {
	// HARVEST is the word (targetArchitectureDesign vocabulary): the operation takes a schema block
	// OUT of a graph and changes nothing. The old name `extractBlock` is deliberately NOT aliased —
	// a second vocabulary surviving one layer down is exactly what the rename exists to prevent.
	harvestBlock,
	// exported so the LOAD side computes conservation identity with the SAME function the
	// HARVEST side uses; see the note on edgeConservationIdentityFor.
	conservationSummaryFor,
	edgeConservationIdentityFor,
	labelRefusal,
	replay,
	// the shared write path — replay() and replayManager.init() are its two entry points
	writeShapedGraph,
	validateShapedGraph,
	shapeNode,
	putDistinctNodeVectors,
	buildNodeRow,
	resolveNodeVectors,
	kernelSupportsVectorIndex,
	resolveManifestEmbeddingDims,
};
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
