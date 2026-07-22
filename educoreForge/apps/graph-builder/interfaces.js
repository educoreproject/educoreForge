'use strict';

// =====================================================================
// interfaces.js — the FORMAL CONTRACTS of graphBuilder's polymorphic seams (polyArch2 §3).
// =====================================================================
// Every contract here has at least two implementations (a real one and a stub, and for
// ForgeBundle, eighteen incumbents) — exactly the situation polyArch2 says demands a formally
// declared interface rather than prose. The JSDoc blocks are the declarations editors and
// static analysis consume; COMPONENT_SHAPES at the bottom is the same contract as a
// runtime-checkable manifest, enforced by test-interfaces.js so stub/real drift turns a suite
// red instead of surfacing mid-build.
//
// House async style everywhere: callback(errString, result) — err is '' on success, a
// human-readable string on failure. No exceptions for control flow, no Promises surfaced.
// =====================================================================

/**
 * @typedef {Object} GraphHandle
 * The capability token for ONE scratch graph. Minted ONLY by ReplayManagerComponent.create;
 * the credential lives here and nowhere else (no registry, no file). Anything holding the
 * handle may write; nothing without it can. graphName is always DEV_* (GNC-001 scratch tier).
 * @property {string} graphName      DEV_*-prefixed; also the docker container name
 * @property {string} containerName  same value as graphName (explicit for docker callers)
 * @property {string} boltUrl        e.g. 'bolt://localhost:7811'
 * @property {string} password       generated per-graph; lives only in this handle
 * @property {number} boltPort
 * @property {number} httpPort
 */

/**
 * @typedef {Object} ForgeSpec
 * @property {string}      standard        token resolving forges/<standard>/ (e.g. 'lif')
 * @property {string}      [version]       recipe version token (reported; the bundle stamps
 *                                         real version provenance itself)
 * @property {string}      [source]        source-data path; default = the bundle's own asset
 * @property {string}      [owner]         ownerStamp pass-through (default ':golden')
 * @property {boolean}     [vectorize=true]  the SPEND KNOB — false constructs no Voyage client
 * @property {number}      [embedNodeLimit]  embed only the first N nodes (spend bound)
 * @property {string}      [embeddingConfigFilePath]  announced override of the Voyage ini
 */

/**
 * @typedef {Object} ForgeReport
 * @property {string} standard        resolved standardName (e.g. 'LIF')
 * @property {string} version         the version the bundle stamped
 * @property {{nodes: Array, edges: Array, embeddingDims: number|null}} nodeEdges
 *                                    ENGINE-shaped, ready for ReplayManagerComponent.init
 * @property {number} nodeCount
 * @property {number} edgeCount
 * @property {number} embedCallCount
 */

/**
 * @interface ForgerComponent
 * PRODUCE ONLY (targetArchitectureDesign §4.1): resolve which forge bundle answers to a standard,
 * wire its Embedder, run it, and translate the result to engine shape. It does NOT write to a
 * graph — exactly three things touch a graph and the forger is not one of them. No store, no
 * cache, no provisioning, no writing. The orchestrator hands the returned nodeEdges to
 * ReplayManagerComponent.init, whose nameRefusal is where the DEV_*-only line is now held.
 * @property {function(ForgeSpec, function(string, ForgeReport=): void): void} forge
 */

/**
 * @interface ReplayManagerComponent
 * The ONE owner of everything a graph is and everything that crosses its boundary
 * (targetArchitectureDesign §4): create / init / harvest / delete. All provisioning (docker,
 * ports, credentials) lives here and nowhere else, and no other component writes to a graph.
 *
 * `create` is deliberately MONOMORPHIC — it means "an empty graph", always. Everything that
 * varies about putting content into a graph varies in `init`, which is the single polymorphic
 * loader, because there are exactly two kinds of thing that can enter a graph and they have
 * different histories: freshly forged material that has never been a schema block, and schema
 * blocks harvested earlier.
 *
 * @property {function({purpose?: string, graphName?: string}, function(string, GraphHandle=): void): void} create
 * @property {function({inGraph: GraphHandle, nodeEdges?: {nodes: Array, edges: Array,
 *           embeddingDims?: number}, schemaBlocks?: Array, applyLabels?: string[],
 *           sourceLabel?: string}, function(string, Object=): void): void} init
 *           CREATION takes nodeEdges; RESTORATION takes schemaBlocks (a later milestone — it
 *           refuses honestly). `applyLabels` is stamped on every node loaded, which is how the
 *           orchestrator's label vocabulary reaches the graph without a forge bundle ever
 *           learning it. Delegates to replay-engine.writeShapedGraph — the SAME write path
 *           replay() uses, so the guards cannot diverge between creation and restoration.
 * @property {function({inGraph: GraphHandle, selectionLabels: string[], header: Object},
 *           function(string, Object=): void): void} harvest
 *           THE ONLY PLACE A SCHEMA BLOCK IS BORN. Selection is POSITIVE and by label — the same
 *           label the orchestrator handed to init — so producer and harvester agree by parameter
 *           rather than by two hopeful literals. Returns { blockText, blockId, nodeCount,
 *           edgeCount, stableIdCoverage }; it PERSISTS nothing (manifestEditor owns storing).
 * @property {function(GraphHandle, function(string): void): void} delete
 */

/**
 * @interface BridgeMakerComponent
 * Runs a bridge module over a materialized dependency graph, writing new LABELED relationship
 * edges INTO the graph (label-based delta harvest, §4 Phase C). Stub-bodied as of 2026-07-22.
 *
 * It takes a GraphHandle, not a URL. The scaffolded orchestrator named replayManager.create's
 * result `boltUrl` and passed it as `graphBoltUrl`, which was harmless only while every component
 * was a stub: the real create returns a HANDLE, and a handle is not a string. Calling the
 * parameter what it is removes the trap rather than documenting it.
 * @property {function({inGraph: GraphHandle, mapper: string, applyLabel: string},
 *           function(string, Object=): void): void} run
 */

/**
 * @interface ManifestEditorComponent
 * Composes a manifest from RESOLVED block references (compose-by-selection; never handed the
 * recipe itself — the orchestrator resolves recipe -> keys). Stub-bodied as of 2026-07-22.
 * @property {function(string, Object): {add: function(string, string, Object): void, id: function(): string}} init
 */

/**
 * @interface ForgeBundle
 * The per-standard forge bundle contract (18 incumbent implementations; forges/lif and
 * forges/ceds in this tree). A bundle IS its own registration via parserDescriptor.ini
 * (standardName, entryModule, defaultSnapshot, sourceFile). Its entry module exports the
 * SECOND stage of `moduleFunction({moduleName})` — a factory taking the injected dependencies:
 *
 *   require(entryPath)({ embedder: Embedder|null }) -> bundle
 *
 * @property {function({sourcePath: string, owner?: string, embedNodeLimit?: number,
 *           skipEmbedding?: boolean}, function(string, Object=): void): void} forge
 *           result: { nodes, edges, metadata, embedCallCount, standardKey,
 *           stableUriPropertyName } — nodes/edges in memory, embeddings stamped inline
 * @property {function(Object): {nodes: Array, edges: Array}} buildContractGraph
 *           the PURE deterministic layer, exported for determinism tests
 */

/**
 * @interface Embedder
 * The vectorizer seam (our word: vectorizer; the bundles' injected param name: embedder —
 * kept for byte-identity until the deferred rename). Formerly a comment in the incumbent;
 * declared here per punch item 28. Embeddings feed CONTENT ADDRESSING: vectors[i] MUST
 * align 1:1 with texts[i], and embeddingModelVersion must match the addressing model version,
 * or every block id changes.
 * @property {function({texts: string[]}, function(string, {vectors: number[][],
 *           embeddingModelVersion: string}=): void): void} embedTexts
 */

// ---------------------------------------------------------------------
// COMPONENT_SHAPES — the same contract, runtime-checkable. test-interfaces.js asserts every
// component implementation (real AND stub) exposes EXACTLY these methods, so a drifted or
// half-implemented component turns the suite red. Keys are build.js's component names.
// ---------------------------------------------------------------------

const COMPONENT_SHAPES = {
	forger: ['forge'],
	replayManager: ['create', 'init', 'harvest', 'delete'],
	bridgeMaker: ['run'],
	manifestEditor: ['init'],
};

module.exports = { COMPONENT_SHAPES };
