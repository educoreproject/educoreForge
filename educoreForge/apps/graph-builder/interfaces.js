'use strict';

// =====================================================================
// interfaces.js — the FORMAL CONTRACTS of graphBuilder's polymorphic seams (polyArch2 §3).
// =====================================================================
// Every contract here has at least two implementations (a real one and a stub, and for
// ForgeBundle, eighteen incumbents) — exactly the situation polyArch2 says demands a formally
// declared interface rather than prose. The JSDoc blocks are the declarations editors and
// static analysis consume; COMPONENT_SHAPES at the bottom is the same contract as DATA, enforced
// by test-interfaces.js. What that enforcement covers, and what it does not, is stated exactly
// where COMPONENT_SHAPES is declared — an interface file that overstates its own enforcement is
// worse than one that admits its limits, because the overstatement is believed.
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
 * @property {boolean}     vectorize       REQUIRED, boolean, NO DEFAULT — the SPEND KNOB. true
 *                                         forges with real Voyage embeddings and spends credit;
 *                                         false constructs no Voyage client at all. A spec that
 *                                         does not say is refused, and so is a string, a number
 *                                         or null ('false' is truthy and used to spend).
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
 *           CREATION takes nodeEdges; RESTORATION takes schemaBlocks (block texts or stored
 *           { text, refId } records, whose claimed content address is VERIFIED, never trusted).
 *           Supplying both payloads is refused. `applyLabels` belongs to CREATION only — it is
 *           stamped on every node loaded, which is how the orchestrator's label vocabulary
 *           reaches the graph without a forge bundle ever learning it; on RESTORATION it is
 *           REFUSED, because a harvested block already carries the labels stamped at creation
 *           time and stamping more would make the block and the graph restored from it disagree.
 *           Both payloads reach replay-engine.writeShapedGraph — creation directly, restoration
 *           through replay() — so the guards cannot diverge between them.
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
 * Composes a manifest from RESOLVED subjects and harvested schema blocks (compose-by-selection;
 * the recipe is held only as a provenance REFERENCE, never consulted for a decision — the
 * orchestrator resolves recipe -> subjects). Real-bodied as of 2026-07-22.
 *
 * TWO DOORS, deliberately. `init` composes a NEW manifest and is the only one that can grow:
 * `add` writes its schema block THROUGH to the store immediately, so nothing accumulates in RAM
 * and a failed build leaves a warm cache. `open` loads a STORED manifest and DISABLES `add` —
 * a manifest addressed by its membership cannot grow without making that address a lie.
 *
 * A manifest's refId IS contentAddress.manifestKeyForMembership over its membership. Names and
 * descriptions are REQUIRED (a membership of sha256 addresses is unreadable) and are OUTSIDE the
 * address (fixing a typo must never mint a different manifest).
 *
 * init() and the handle's members()/refId() are SYNCHRONOUS — the §4.4 build sequence composes
 * with them inline — so their refusals are throws; everything that reaches the store is
 * callback-shaped.
 *
 * standardsDatabase is a CONSTRUCTION dependency, NOT a per-call argument: the module is built as
 * manifestEditor({ standardsDatabase }) and the same database backs every manifest it composes or
 * opens. It is therefore absent from both init's and open's argument shapes — an invariant handed
 * once cannot be a signature key that pretends to vary. It is validated at first use (init throws,
 * open calls back an error) so the component can still be constructed for shape inspection.
 *
 * @property {function({name: string, description: string, recipe?: Object, recipeText?: string}):
 *           {add: function({subjectRefId: string, kind: string, description: string,
 *            schemaBlock: Object}, function(string, Object=): void): void,
 *            members: function(): Array, refId: function(): string,
 *            schemaBlocks: function(function(string, Array=): void): void,
 *            save: function(function(string, Object=): void): void,
 *            recipeName: function(): string, recipeRefId: function(): string}} init
 * @property {function({manifestRefId: string},
 *           function(string, Object=): void): void} open
 *           hands back a manifest handle of the SAME shape init returns — one factory serves both
 *           doors — with `add` disabled.
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
// COMPONENT_SHAPES — the same contract, as DATA. Keys are build.js's component names; each names
// its methods; each method declares its shape in three fields and no more. A registry of data,
// deliberately not a type system.
//
// WHY THIS EXISTS IN THIS FORM. Until 2026-07-23 this manifest was a list of method NAMES, and
// test-interfaces.js checked that each name existed and was a function. Nothing else. That is how
// build.js came to call manifest.add(key, kind, blockId) positionally against an interface
// declaring one named-argument object, to call id() where the contract says refId(), and to read
// a GraphHandle as a bolt url — for weeks, with the interface gate reporting conformance the
// whole time. A gate that checks only names certifies only names.
//
// EACH FIELD
//   arity       the exact Function.prototype.length the contract requires. This is the field that
//               catches positional drift: add({...}, callback) has arity 2 and
//               add(key, kind, blockId) has arity 3, and no amount of correct naming hides it.
//   argKeys     the REQUIRED keys of the ONE named-argument object. [] means the argument object
//               exists but every key in it is optional; null means the method takes no argument
//               object at all (delete takes a GraphHandle positionally, by contract; members()
//               takes nothing).
//   resultKeys  the REQUIRED keys of the value handed to the callback — or returned directly, for
//               a synchronous verb. null means the contract names no result shape.
//   resultShape (in place of resultKeys) a nested method registry, when the result is itself a
//               component-shaped handle. Its method names ARE the required result keys, and each
//               is checked by these same three fields.
//
// WHAT test-interfaces.js ACTUALLY CHECKS, exactly — no more than this:
//   1. METHOD SET — every implementation exposes exactly the declared methods, each a function.
//      Nothing missing, nothing extra.
//   2. ARITY — `fn.length` equals the declared arity, for every method of every implementation
//      including the nested manifest handle.
//   3. argKeys — every declared key is visibly READ off the argument object in the method's own
//      source: destructured from it (`const {inGraph} = spec`) or accessed on it (`spec.inGraph`).
//      This is a source-text check, so it can pass for the wrong reason (a key name that appears
//      but is never used); it cannot pass a signature that never mentions the key at all, which
//      is what positional drift looks like.
//   4. resultKeys / resultShape — checked against the value the method ACTUALLY PRODUCES, which
//      requires invoking it. The suite may not spawn Docker, call Voyage, or open a database, so
//      this check reaches only what can be invoked under that line: bridgeMaker.run,
//      manifestEditor.init/open and the manifest handle (against an in-memory store double), and
//      every drift fixture. forger.forge and replayManager.create/init/harvest/delete are NOT
//      invoked, and their declared result shapes are therefore enforced against fixtures standing
//      in their place and nowhere else. That is a real gap in the gate, declared here and by
//      harness.note in the suite rather than left to be discovered.
//
// Types are NOT checked. A declared key holding the wrong sort of value passes. The declaration
// is a shape, not a type, and this comment is the whole of what it promises.
// ---------------------------------------------------------------------

// The manifest handle — the result of BOTH manifestEditor doors, because one factory serves both.
const MANIFEST_HANDLE_SHAPE = {
	add: {
		arity: 2,
		argKeys: ['subjectRefId', 'kind', 'description', 'schemaBlock'],
		resultKeys: ['memberCount', 'schemaBlockRefId', 'alreadyPresent'],
	},
	members: { arity: 0, argKeys: null, resultKeys: null },
	refId: { arity: 0, argKeys: null, resultKeys: null },
	schemaBlocks: { arity: 1, argKeys: null, resultKeys: null },
	save: {
		arity: 1,
		argKeys: null,
		resultKeys: ['manifestRefId', 'memberCount', 'alreadyPresent'],
	},
	recipeName: { arity: 0, argKeys: null, resultKeys: null },
	recipeRefId: { arity: 0, argKeys: null, resultKeys: null },
};

const COMPONENT_SHAPES = {
	forger: {
		forge: {
			arity: 2,
			// vectorize is declared here as well as standard because it is REQUIRED and has no
			// default: an implementation that stopped reading it off the spec would be back to
			// deciding the spend for its caller, and argKeys is where that drift is caught.
			argKeys: ['standard', 'vectorize'],
			resultKeys: [
				'standard',
				'version',
				'nodeEdges',
				'nodeCount',
				'edgeCount',
				'embedCallCount',
			],
		},
	},
	replayManager: {
		// MONOMORPHIC: an empty graph, always. Both spec keys are optional — hence [] rather than
		// null — and the result is a GraphHandle, which is why a caller reading it as a bolt url
		// string is a shape violation and not a matter of taste.
		create: {
			arity: 2,
			argKeys: [],
			resultKeys: [
				'graphName',
				'containerName',
				'boltUrl',
				'password',
				'boltPort',
				'httpPort',
			],
		},
		init: { arity: 2, argKeys: ['inGraph'], resultKeys: null },
		harvest: {
			arity: 2,
			argKeys: ['inGraph', 'selectionLabels', 'header'],
			resultKeys: ['blockText', 'blockId', 'nodeCount', 'edgeCount', 'stableIdCoverage'],
		},
		// takes a GraphHandle positionally, by contract — no argument object to declare keys of.
		delete: { arity: 2, argKeys: null, resultKeys: null },
	},
	bridgeMaker: {
		run: {
			arity: 2,
			argKeys: ['inGraph', 'mapper', 'applyLabel'],
			resultKeys: ['inGraph', 'mapper', 'applyLabel', 'edgesWritten', 'note'],
		},
	},
	manifestEditor: {
		// SYNCHRONOUS (arity 1, no callback) — the §4.4 build sequence composes with it inline.
		init: {
			arity: 1,
			argKeys: ['name', 'description'],
			resultShape: MANIFEST_HANDLE_SHAPE,
		},
		open: {
			arity: 2,
			argKeys: ['manifestRefId'],
			resultShape: MANIFEST_HANDLE_SHAPE,
		},
	},
};

module.exports = { COMPONENT_SHAPES, MANIFEST_HANDLE_SHAPE };
