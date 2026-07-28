'use strict';

// genericBridge — the REAL generic INFERRED bridge (bridgeKitRefactor_072726 design §1/§4.3). As of
// Phase 4 (spec §6), this file is EXACTLY what the spec promised it would become: "the skeleton
// filled for the generic inferred case." Every line of orchestration that used to live here — kit
// composition, the wiring-fault refusals, argument validation, the MATERIALIZE-vs-REBRIDGE mode
// dispatch, the vectorize step, the freeze/decisionStore round-trip, write-through-the-guarded-
// writer, and the five-move loop itself — moved to apps/graph-builder/apps/bridge-maker/lib/
// bridgeSkeleton.js (the REUSABLE shell a forge copies to author a custom bridge, spec §6 Phase 5).
// What remains HERE is exactly the ~10% that is genuinely THIS bridge's own choice:
//
//   mappingTool           'genericBridge'                — the identity stamp on every edge
//   hubStandard           'CEDS'                          — Phase-2 parity choice (see below)
//   defaultRole           'DmeProperty'                   — the LIF pilot's property-tier scope
//   defaultMatcherName    'semanticDefText'               — open item O3's one registered matcher
//   materializerConfig    { predicate: 'closeMatch', mappingJustification: 'semapv:SemanticSimilarity' }
//
// NO move override. genericBridge uses every one of the skeleton's five default moves (walk, match,
// select, freeze, materialize) unchanged — it is composed EXACTLY the way the fused Phase-2/3
// genericBridge.js composed them, just no longer typed out inline. test-generic-bridge-equivalence.js
// (UNCHANGED by this extraction) is the proof: genericBridge still reproduces semanticBridge's
// decisions and edges byte-identically in both modes, because the moves themselves did not move —
// only their home did.
//
// It REPLACES the P0 placeholder that used to live at bridge-maker/bridges/genericBridge.js (deleted
// alongside this file's Phase-2 creation — a bridge name must resolve to exactly ONE file across
// bridgeMaker's search path). It lives in the FORGES-SHARED scope (forges/bridges/) and is resolved
// BY NAME through bridgeMaker's three-directory search path (bridgeMaker.js resolveBridgePlugin)
// exactly like every other bridge — nothing special-cases it (design_bridgeResolution_072526).
//
// THE BRIDGE CONTRACT (interfaces.js @interface BridgeModule / BRIDGE_MODULE_SHAPE):
//   bridgeModule({ ...injected library, kit })({ inGraph, hub, applyLabel }, cb)
//       -> cb('', { edgesWritten, counts, decisionBlock })
// This shape is produced by makeBridgeSkeleton(...) below, unchanged from what genericBridge itself
// used to export directly — bridgeMaker's shape gate (arity 2, reads inGraph/hub/applyLabel, no raw
// write substrate in THIS file's own source text) is satisfied exactly as before.
//
// COMPOSES injectedTools.kit EXCLUSIVELY (bridgeMaker's ADDITIVE lib.d kit). This bridge reads NONE
// of the flat library's members (relationshipWriter, inferencePipeline, inferredIndex, graphReader-
// the-factory, ...) that the three pre-existing bridges (ctdlAuthoredBridge, ctdlFamilyStructure,
// semanticBridge) still compose — the kit is the ONLY substrate it touches, and every write travels
// through kit.writer (the SAME guarded relationshipWriter wrapped by lib.d/writer.js), never a raw
// connection (bridgeMaker's shape gate's negative substrate scan reads THIS file's bytes, not the
// skeleton's — this file contains no neo4j-driver require, no neo4jGraphWriter require, and never
// reads the raw connection-credential fields the GraphHandle carries, same as before).
//
// SCOPE — a deliberate Phase-2 boundary, carried forward unchanged into Phase 4. genericBridge
// composes ONE role/tier per pair (config.role, default 'DmeProperty') — everything the LIF pilot
// (design §1, "the simplest standard: inferred-only, no authored crosswalk, no structural family")
// needs. It does NOT reproduce semanticBridge's CTDL-specific DmeOptionValue VALUE-TIER scoping
// (lib/valueScope.js) — that is bespoke CTDL logic living where it always has, not a generic
// capability, and stays in semanticBridge until a standard needing it is migrated onto a
// purpose-built extension of this skeleton.
//
// HUB — a deliberate Phase-2 parity choice, carried forward. Like semanticBridge, this bridge
// bridges toward CEDS only (hubStandard: 'CEDS' below). Generalizing to an arbitrary `hub` argument
// is a genuine capability this bridge does not yet have — no recipe exercises a second hub today.
//
// House style: qtools curried moduleFunction (via bridgeSkeleton); no async/await or try/catch for
// control flow; compound names.

const path = require('path');

const makeBridgeSkeleton = require(
	path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'bridgeSkeleton'),
);

module.exports = makeBridgeSkeleton({
	mappingTool: 'genericBridge',
	hubStandard: 'CEDS',
	defaultRole: 'DmeProperty',
	defaultMatcherName: 'semanticDefText',
	materializerConfig: {
		predicate: 'closeMatch',
		mappingJustification: 'semapv:SemanticSimilarity',
	},
	// NO moves override — genericBridge is the skeleton's default generic-inferred case, exactly.
});
