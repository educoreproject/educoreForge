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
 * @property {string} user           the neo4j auth user (RT-13: the handle carries the FULL
 *                                   bolt triple so the round-trip stage hands validators
 *                                   credentials from one home, never a second literal)
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
 * @property {boolean}     [deriveHub]     OPTIONAL, default false — the HUB-FOLD SIGNAL (new design
 *                                         2026-07-24). true makes the forger derive this standard's
 *                                         hub and FOLD it into the returned nodeEdges, so ONE block
 *                                         per standard carries its hub. build.js sets it from
 *                                         recipe.hubs; a standard declared a hub with no registered
 *                                         derivation is refused by name (no silent default).
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
 *                                    ENGINE-shaped, ready for ReplayManagerComponent.init. When the
 *                                    spec set deriveHub, this ALSO carries the standard's folded hub
 *                                    (HubReference + HubDefinition nodes and their HAS_CEDS_ and IN_HUB
 *                                    edges), so a single [StandardBase] load mints one block with both.
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
 * @interface FinisherComponent
 * ONE member of the replayManager FINISHING REGISTRY (graphSelfDoc campaign, 2026-08-31;
 * ARCH-replayManager-083126.md §8; RULING GRANITE_ECHO 2026-08-31 on the finisher seam).
 * A finisher turns a materialized graph into a SELF-DESCRIBING one. It is internal to
 * replayManager's `finish` verb — it is NOT one of the four components build.js wires, which is
 * why its shape is declared HERE as a sibling (the MANIFEST_HANDLE_SHAPE precedent) and never as
 * a COMPONENT_SHAPES key.
 *
 * THE SEAM: the word "finisher" names THREE behaviours, and pretending otherwise is what makes
 * this a polymorphic seam needing a declared contract. Five members produce nodes; schemaConstraints
 * creates DATABASE OBJECTS (uniqueness constraints — there is nothing to emit, and its gate is
 * `SHOW CONSTRAINTS > 0`); graphMeta STAMPS and VERIFIES across the whole graph. So a finisher
 * declares one of exactly two MODES, and the verb dispatches on the DECLARED VALUE:
 *
 *   'emit'   -> emit(spec, cb) -> ('', { nodes, edges, summary })
 *               Produces Channel-A material. Every emitted node is :ForgedNode carrying a stableId,
 *               so it passes the engine's three guards natively; the VERB writes it, never the
 *               finisher (see the write rule below).
 *   'apply'  -> apply(spec, cb) -> ('', { summary })
 *               Acts on the graph directly because its product is not nodes. Gets the
 *               session-bearing `runCypher` it genuinely needs.
 *
 * THE MODE IS DECLARED, NEVER SNIFFED. The registry entry carries it as data; the verb refuses BY
 * NAME an absent or unrecognised mode. Probing which method happens to exist would make the
 * contract depend on an implementation accident, and a finisher that silently did nothing because
 * neither method matched is precisely the class of silent success this campaign exists to abolish.
 *
 * THE WRITE RULE — WHY EMITTERS GET A READ-ONLY DOOR. Emitters legitimately need to READ the built
 * graph: standardDefinition derives its counts and mapping disposition from it, and usagePattern
 * must EXECUTE each exemplar and see rows before that exemplar may be written. So `readQuery` is
 * injected — and it is a READ-MODE session, which makes "an emitter never writes" MECHANICAL rather
 * than honour-system. Every write an emitter causes goes through the verb's assembled
 * writeShapedGraph call, which is what keeps replay-engine's "entry points that cannot disagree
 * about what a safe write is" true when the count goes from two to three.
 *
 * ORDER IS FORCED, AND THE REGISTRY IS ITS ONLY HOME. schemaView must emit before schemaConstraints
 * creates constraints over its nodes; graphMeta must run last so everything above it exists to be
 * stamped and XOR-verified. THEREFORE the verb walks the registry IN ORDER and batches MAXIMAL
 * CONTIGUOUS RUNS OF EMITTERS into one writeShapedGraph call each — it does NOT collapse all
 * emitters into a single write, which would hoist schemaView's nodes past the constraints or sink
 * them behind later emitters and thereby make the DECLARED ORDER STOP BEING THE EXECUTION ORDER
 * while still reading as correct. The rule is general; today's registry happens to yield two writes.
 *
 * @property {string} mode                'emit' or 'apply' — declared on the registry entry, as data.
 * @property {function({readQuery: function, storeReader?: Object, gateResults?: Array},
 *           function(string, {nodes: Array, edges: Array, summary: string}=): void): void} [emit]
 *           Required when mode is 'emit'. Reads through readQuery only; returns material, writes nothing.
 * @property {function({runCypher: function}, function(string, {summary: string}=): void): void} [apply]
 *           Required when mode is 'apply'. Acts on the graph; its product is not nodes.
 */

/**
 * @interface BridgeMakerComponent
 * Runs a bridge PLUGIN over a materialized dependency graph through the EDUcore Bridge Framework
 * (lib/bridge-framework, SPEC-bridgeFramework-v1.md), writing labeled SKOS mapping edges INTO the graph
 * (label-based delta harvest, §4 Phase C). apps/bridge-maker/bridgeMaker.js is the SEAM FACE: it builds
 * the discovery registry over forges/<standardKey>/bridges/*.js at construction (SPEC §9), constructs
 * the framework with the real graph reader/writer factories, and forwards run(spec, callback) to
 * bridgeFramework.run unchanged (SPEC §3.1). The pre-reset component (three-directory search path,
 * component library, P0 default generic plugin) and the Phase-3 refuse-only stub are HISTORY
 * (system/codeAttic, tags preDemolition-081526 / preBridgeFramework-081626).
 *
 * It takes a GraphHandle, not a URL (the handle is what replayManager.create returns).
 *
 * CONSTRUCTION: bridgeMaker() takes NO arguments and honours NO injection — a construction argument
 * of ANY name is REFUSED BY NAME (thrown), never silently ignored (SPEC §3.1, D-S1): test injection
 * goes through the FRAMEWORK factory (fixture registry, reader/writer doubles), never the seam face.
 * @property {function({inGraph: GraphHandle, bridge: string, applyLabel: string,
 *           source: string, hub: string, rebridge: boolean, decisionStore: Object, judgmentCache: Object,
 *           matchForensics: Object, inferenceConfig: Object, config: Object},
 *           function(string, Object=): void): void} run
 *           spec is EXACTLY what build.js Phase C composes (build.js bridgeOnePairing); the framework
 *           refuses by name an unregistered `bridge` (LISTING the registered names), a `source` that is
 *           not the plugin's standardKey, an absent hub/decisionStore/version, and any `config` key
 *           outside the framework's RUN_CONFIG_KEY_LIST (the recipe's params channel is CLOSED). On
 *           success it calls back the runReport carrying EVERY key in
 *           COMPONENT_SHAPES.bridgeMaker.run.resultKeys — including `blocks` (exactly ONE block under a
 *           PAIR-SCOPED applyLabel `<applyLabel>_<SOURCE>_<HUB>`) and an ALWAYS-explicit `producer`
 *           (`authored` for every v1 plugin), so build.js never infers a producer from decisionBlock.
 */

/**
 * @interface BridgeModule — RETIRED (B2 interfaces commit, 2026-08-16; RULING BF10 / BR-140). The bridge
 * PLUGIN contract is now `{ bridgeDeclaration, bridgeHooks }` validated by a table walk over
 * BRIDGE_DECLARATION_CONTRACT + BRIDGE_HOOK_CONTRACT in lib/bridge-framework/bridgePluginContract.js.
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
 *           {add: function({subject: string, kind: string, description: string,
 *            schemaBlock: Object}, function(string, Object=): void): void,
 *            members: function(): Array, refId: function(): string,
 *            schemaBlocks: function(function(string, Array=): void): void,
 *            save: function(function(string, Object=): void): void,
 *            recipeName: function(): string, recipeHash: function(): string, recipeFileName: function(): string}} init
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
		argKeys: ['subject', 'kind', 'description', 'schemaBlock'],
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
	recipeHash: { arity: 0, argKeys: null, resultKeys: null },
	recipeFileName: { arity: 0, argKeys: null, resultKeys: null },
};

// The BRIDGE MODULE contract as DATA (BRIDGE_MODULE_SHAPE) — RETIRED into
// lib/bridge-framework/bridgePluginContract.js (B2 interfaces commit, RULING BF10 / BR-140).

// FINISHER_MODULE_SHAPE — the FinisherComponent contract, as DATA (graphSelfDoc, 2026-08-31).
// A SIBLING of COMPONENT_SHAPES, deliberately NOT a member of it: COMPONENT_SHAPES names the four
// components build.js wires, and test-interfaces asserts that key set EXACTLY. A finisher is
// internal to replayManager's `finish` verb, so it is declared beside MANIFEST_HANDLE_SHAPE — the
// established precedent for a shape that is contractual without being a build.js component.
//
// Keyed by MODE. The registry entry declares its mode as data and the verb dispatches on that
// declared value; MODE_TOKENS exists so a refusal can NAME the modes it accepts rather than saying
// only that the given one was wrong. An absent or unrecognised mode is refused BY NAME — never
// defaulted, and never resolved by probing which method the module happens to expose.
const FINISHER_MODULE_SHAPE = {
	MODE_TOKENS: ['emit', 'apply'],
	// PRODUCES Channel-A material; the VERB writes it. `readQuery` is a READ-MODE session, which is
	// what makes "an emitter never writes" mechanical rather than a promise in a comment.
	emit: {
		method: 'emit',
		arity: 2,
		argKeys: ['readQuery'],
		resultKeys: ['nodes', 'edges', 'summary'],
	},
	// ACTS on the graph because its product is not nodes (DB constraints; label stamping and the XOR
	// verification). Gets the session-bearing door an emitter is denied.
	apply: {
		method: 'apply',
		arity: 2,
		argKeys: ['runCypher'],
		resultKeys: ['summary'],
	},
	// ⟪N1 RULING, GRANITE_ECHO 2026-08-31⟫ THE EMITTED NODE SHAPE, PINNED. The REGISTRY WALKER validates
	// every emitted node against this ONCE, before anything reaches writeShapedGraph — not each finisher
	// against itself, which would be a finisher grading its own homework and would leave a future
	// emitter uncovered.
	//
	// WHY `ref` IS REQUIRED AND WHY ITS `source` MAY BE NULL — both measured 2026-08-31:
	//   * replay-engine buildNodeRow dereferences `node.ref.source` and `node.ref.id` UNCONDITIONALLY. A
	//     node without `ref` does not get refused, it CRASHES — and the TypeError surfaces MISATTRIBUTED
	//     as "phase1 resolution-key index failed", a signpost pointing at the index code rather than at the
	//     malformed node. The walker's refusal exists so that crash path is UNREACHABLE from finish.
	//   * `source` must be PRESENT but may be NULL. Cypher's `SET n += {…}` REMOVES a null-valued property
	//     rather than storing null, so a metadata node written with `{source: null}` carries NO `_source` —
	//     which is what lets Channel A satisfy the `_source` XOR `:GraphMeta` invariant through the shared
	//     write path. `{source: null}` is the honest expression of "computed by the build, parsed from
	//     nothing"; an omitted `ref` is a defect, and a fabricated source token would be a lie.
	//   * `_id` IS stored, equal to the stableId. Documented, not incidental.
	EMITTED_NODE_SHAPE: {
		requiredKeys: ['stableId', 'ref', 'labels', 'properties'],
		refRequiredKeys: ['source', 'id'],
		// `source` is the one key whose value may be null; every other required key must be non-null.
		nullableRefKeys: ['source'],
	},
	// The emitted EDGE shape. `provenanceTier` is required because engine GUARD 3 refuses to write ANY edge
	// in a block if one lacks it — a whole-batch refusal is far cheaper to diagnose at the walker, naming
	// the emitting finisher, than at the engine naming nothing.
	EMITTED_EDGE_SHAPE: {
		requiredKeys: ['type', 'fromRef', 'toRef', 'properties'],
		endpointRequiredKeys: ['id'],
		requiredProperties: ['provenanceTier'],
	},
};

/**
 * @typedef {Object} JudgeProvider
 * ONE judge — the thing `judgeComponent.judgeOne` holds and cannot tell apart from any other.
 * Two implementations exist today (llmClient, debugJudge) and more are coming, which is exactly
 * the condition polyArch2 §3 says demands a declared interface rather than prose.
 * @property {string}   name            provider id: 'anthropic', 'ollama', 'debugJudge'
 * @property {string}   wireModel       what the TRANSPORT sends — 'claude-opus-4-8', 'qwen2.5:32b'.
 *                                      INTERNAL to the provider; it reaches no caller and no edge.
 * @property {string}   model           the NAMESPACED IDENTITY — 'anthropic:claude-opus-4-8'. The
 *                                      judgment-cache key, `judgeModel`, and the edge's mappingTool.
 * @property {number}   maxConcurrency  the provider's own ceiling on in-flight judgments
 * @property {function} rerank          ({systemPrompt, userPrompt, choiceEnum}, cb) ->
 *                                      cb(err, {choice, category, rationale, model, attempts})
 * @property {function} describe        () -> {provider, model, version}
 */

// JUDGE_PROVIDER_SHAPE — the JUDGE PROVIDER contract, as DATA (judgeProviderRegistry JOB 1,
// 2026-09-07). A SIBLING of COMPONENT_SHAPES, deliberately NOT a member of it, for the same reason
// FINISHER_MODULE_SHAPE is not: COMPONENT_SHAPES names the four components build.js wires and
// test-interfaces asserts that key set EXACTLY. A judge provider is selected by the registry and
// handed to the framework inside inferenceConfig, so it is declared here beside the other two
// contractual-but-not-a-component shapes.
//
// WHO VALIDATES, AND WHY IT IS NOT THE PROVIDER — the FINISHER_MODULE_SHAPE precedent, followed
// deliberately: the REGISTRY validates every provider against this ONCE, before one reaches the
// framework, rather than each provider checking itself, "which would be a finisher grading its own
// homework." It also means bridge-maker/lib takes on NO dependency outside the decision-block
// fingerprint tree (decisionBlock.js:67-69) — a contract change moves the registry's bytes, not the
// fingerprinted client's. The registry itself is JOB 4; judgeProviderViolation below is what it will
// call, and is exercised meanwhile by apps/graph-builder/test/test-judgeProviderContract.js.
//
// ⟪THE cfg.model SPLIT — the whole reason this shape exists⟫ Before JOB 1, llmClient's `cfg.model`
// did THREE jobs at once: the API wire name, the input to the /^claude-opus-4/ temperature rule, and
// `client.model` — which is the judgment cache key (judgeComponent.js:242), the forensic `judgeModel`,
// and the edge's `mappingTool`. One string cannot be both an API-vendor's model name and a
// cross-provider identity: the cache distinguishes two providers handed identical prompts through the
// same renderer by `model` ALONE, so two providers that happened to share a wire name would silently
// serve each other's verdicts. `wireModel` and `model` are therefore SEPARATE MEMBERS, and `model` is
// namespaced by `name` so a collision is impossible to construct rather than merely unlikely.
const JUDGE_PROVIDER_SHAPE = Object.freeze({
	// MEMBER_KIND_BY_NAME — every required member and the kind of value it must hold. Kinds are
	// checked (unlike COMPONENT_SHAPES, which checks only presence and arity) because the three
	// string members are IDENTITIES: a provider whose `model` is undefined does not fail loudly, it
	// writes `undefined` into a cache key and onto an edge.
	MEMBER_KIND_BY_NAME: Object.freeze({
		name: 'nonEmptyString',
		wireModel: 'nonEmptyString',
		model: 'nonEmptyString',
		maxConcurrency: 'positiveInteger',
		rerank: 'function',
		describe: 'function',
	}),
	// MODEL_NAMESPACE_SEPARATOR — `model` MUST begin `${name}${separator}`. Note the separator may
	// also occur INSIDE a wireModel ('qwen2.5:32b'), which is why the rule is a PREFIX test against
	// the provider's own name and never a count of separators or a split.
	MODEL_NAMESPACE_SEPARATOR: ':',
	rerank: Object.freeze({
		arity: 2,
		argKeys: Object.freeze(['systemPrompt', 'userPrompt', 'choiceEnum']),
		// ⟪JOB 1⟫ `model` and `attempts` are CONTRACT MEMBERS of the result, no longer the "harmless
		// surplus the pipeline ignores" llmClient's header used to call them: `model` is the identity
		// the judgment travelled under and must agree with the provider's own `model`.
		resultKeys: Object.freeze(['choice', 'category', 'rationale', 'model', 'attempts']),
	}),
	describe: Object.freeze({
		arity: 0,
		argKeys: null,
		resultKeys: Object.freeze(['provider', 'model', 'version']),
	}),
});

// judgeProviderViolation — the shape check, as a FUNCTION OF DATA. Returns a refusal STRING naming
// every member at fault, or null when the candidate satisfies the contract. It NEVER probes which
// methods a module happens to expose: the required set is MEMBER_KIND_BY_NAME and nothing else.
//
// It names EVERY violation rather than the first, because a provider written against the wrong
// contract version typically misses several members and discovering them one construction at a time
// is the slow way to learn the same thing.
const judgeProviderViolation = (candidateProvider, { providerLabel = 'judge provider' } = {}) => {
	if (candidateProvider === null || typeof candidateProvider !== 'object') {
		return `${providerLabel} is ${candidateProvider === null ? 'null' : `a ${typeof candidateProvider}`} — a judge provider must be an object satisfying JUDGE_PROVIDER_SHAPE (${Object.keys(JUDGE_PROVIDER_SHAPE.MEMBER_KIND_BY_NAME).join(', ')})`;
	}
	const kindSatisfiedBy = {
		nonEmptyString: (oneValue) => typeof oneValue === 'string' && oneValue.length > 0,
		positiveInteger: (oneValue) => Number.isInteger(oneValue) && oneValue >= 1,
		function: (oneValue) => typeof oneValue === 'function',
	};
	const memberFaultList = Object.keys(JUDGE_PROVIDER_SHAPE.MEMBER_KIND_BY_NAME)
		.filter((oneMemberName) => !kindSatisfiedBy[JUDGE_PROVIDER_SHAPE.MEMBER_KIND_BY_NAME[oneMemberName]](candidateProvider[oneMemberName]))
		.map((oneMemberName) => `${oneMemberName} (must be ${JUDGE_PROVIDER_SHAPE.MEMBER_KIND_BY_NAME[oneMemberName]}, got ${JSON.stringify(candidateProvider[oneMemberName])})`);
	if (memberFaultList.length) {
		return `${providerLabel} does not satisfy JUDGE_PROVIDER_SHAPE — ${memberFaultList.length} member(s) at fault: ${memberFaultList.join('; ')}. Every member is required; there is no default and no probing of which methods the module happens to expose.`;
	}
	// THE NAMESPACE RULE (G-F1-a). `model` is what the judgment cache keys on and what lands on the
	// edge as mappingTool; namespacing it by the provider's own name is what makes a collision
	// between two providers impossible to CONSTRUCT rather than merely unlikely to occur.
	const requiredModelPrefix = `${candidateProvider.name}${JUDGE_PROVIDER_SHAPE.MODEL_NAMESPACE_SEPARATOR}`;
	if (candidateProvider.model.indexOf(requiredModelPrefix) !== 0) {
		return `${providerLabel} model '${candidateProvider.model}' is not namespaced by its provider name — it must begin '${requiredModelPrefix}'. The bare wire name ('${candidateProvider.wireModel}') belongs in wireModel; model is the identity the judgment cache keys on and the edge carries as mappingTool, and two providers sharing one identity would serve each other's verdicts.`;
	}
	// describe() must be INSTANCE-DERIVED, not a constant: a judge that cannot say what it is must
	// never run, and a describe() returning a hard-coded string says nothing about the instance that
	// actually answered. Agreement with the provider's own members is the mechanical form of that.
	const described = candidateProvider.describe();
	if (described === null || typeof described !== 'object') {
		return `${providerLabel} describe() returned ${described === null ? 'null' : `a ${typeof described}`} — it must return {${JUDGE_PROVIDER_SHAPE.describe.resultKeys.join(', ')}}.`;
	}
	const describeFaultList = JUDGE_PROVIDER_SHAPE.describe.resultKeys
		.filter((oneKeyName) => !(typeof described[oneKeyName] === 'string' && described[oneKeyName].length > 0))
		.map((oneKeyName) => `${oneKeyName} (${JSON.stringify(described[oneKeyName])})`);
	if (describeFaultList.length) {
		return `${providerLabel} describe() returned ${describeFaultList.length} empty or absent key(s): ${describeFaultList.join('; ')} — every key must be a non-empty string. A judge that cannot say what it is must never run.`;
	}
	if (described.model !== candidateProvider.model || described.provider !== candidateProvider.name) {
		return `${providerLabel} describe() disagrees with its own members — describe() says provider '${described.provider}' model '${described.model}', the provider says name '${candidateProvider.name}' model '${candidateProvider.model}'. describe() must report THIS instance, never a constant.`;
	}
	return null;
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
		// ⟪graphSelfDoc Phase 4, 2026-09-01⟫ THE FIFTH VERB. Makes a materialized graph self-documenting:
		// registry finishers on Channel A, then the Channel-B passport, then the verb's own verifications.
		// resultKeys are the three CONTRACT-level fields (ARCH §6); the report carries more, and
		// resultShapeViolation names REQUIRED keys rather than exact ones, so a superset is the contract.
		finish: {
			arity: 2,
			argKeys: ['inGraph', 'manifestRefId', 'storeReader', 'gateResults'],
			resultKeys: ['applied', 'passportElementId', 'xorVerified'],
		},
		// takes a GraphHandle positionally, by contract — no argument object to declare keys of.
		delete: { arity: 2, argKeys: null, resultKeys: null },
	},
	bridgeMaker: {
		// THE BRIDGE FRAMEWORK SEAM (B2 interfaces commit, 2026-08-16; SPEC-bridgeFramework-v1.md §5.9,
		// §14.4 step 2; RULING A8/BF10; BR-140). resultKeys is the framework's RUN_REPORT_RESULT_KEYS —
		// the SAME list, declared here as data; BG-REG(f) in lib/bridge-framework/test asserts the two are
		// EQUAL and that a real run returns every one of them. `blocks` is REQUIRED (exactly one block,
		// pair-scoped applyLabel, explicit producer); `sssomExportPath` is null on a materialise run
		// (no export happened) and a path on a re-judge — present either way. The Phase-3 stub's null
		// ("no result shape") is history.
		run: {
			arity: 2,
			argKeys: ['inGraph', 'bridge', 'applyLabel'],
			resultKeys: [
				'inGraph',
				'bridge',
				'applyLabel',
				'producer',
				'decisionBlock',
				'blocks',
				'edgesWritten',
				'counts',
				'generation',
				'rendererVersion',
				'mode',
				'sssomExportPath',
				'note',
			],
		},
		// describeBridge — the PRE-SPEND declaration reader (Phase 7, SPEC §3.7). SYNCHRONOUS (arity 1, no
		// callback): it reads a registered plugin's declaration and returns it, touching no graph, no store,
		// no judge. build.js calls it BEFORE PHASE A (RULING FJ-P7-1, amending SPEC §3.7's "before phase C") so a
		// recipe declaring two bridges that would compose one relationship subject is refused before ANY forge or
		// judge spend, rather than by the manifest editor after the colliding bridge's whole run.
		//
		// IT IS DECLARED HERE BECAUSE IT MUST BE. test-interfaces' METHOD SET checker computes
		// `Object.keys(instance).filter(name => !declared.includes(name))` and refuses any undeclared extra by
		// name, so the export without this row is `undeclared extras: describeBridge`. Adding it is safe for
		// BG-NOSUB (i), measured rather than assumed: (i) byte-compares every COMPONENT_SHAPES member OTHER
		// than bridgeMaker, and its bridgeMaker assertions are run.arity, run.argKeys,
		// run.resultKeys.length === 13 and BRIDGE_MODULE_SHAPE's removal — a new sibling key touches none.
		describeBridge: {
			arity: 1,
			argKeys: ['bridgeName', 'source'],
			// `source` is REQUIRED, not decorative: pluginRegistry.lookupPlugin refuses a bridge whose
			// registered standardKey differs from the pairing's source (BR-009), so a describe that omitted it
			// could pass on a pairing the run itself would refuse.
			resultKeys: ['description', 'error'],
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

module.exports = { COMPONENT_SHAPES, MANIFEST_HANDLE_SHAPE, FINISHER_MODULE_SHAPE, JUDGE_PROVIDER_SHAPE, judgeProviderViolation };
