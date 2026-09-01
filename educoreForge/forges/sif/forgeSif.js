'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeSif.js — the SIF forge bundle on the Forge Framework (SPEC-forgeFramework-v1.md §5.3, §8.2;
// migrated in the hub-kit-role campaign, Phase 3, from the 843-line bespoke module that parsed the
// SIF Implementation-Specification TSV and minted the UNIVERSAL FORGE PROPERTY CONTRACT by hand).
// The block id d393b0406d08f613f3142711fca5a9f2b0c580e84c4bef3ffd6b18d4eaa2330a at 56,395,535 is
// IDENTICAL before and after — the Phase 3 proof. The framework owns the pipeline, the source
// verification, the version stamp, the root, the kit, the integrity pass, the finalizers, the embed
// pass and the return; this file owns nothing but the wiring:
//   H1  lib/sifForgeDeclaration.js     — data (standardKey 'sif', standardSource 'SIF', the DECLARED
//       root id 'sif:root', parserVersion '1', the POPULATED mappingInstruction anchored on the
//       'CEDS ID' column, an EMPTY nonEmbeddableRoleList because SIF embeds every node, and the
//       THREE measured allowances S2/S4/S7 (S3 RETIRED 2026-09-01, versionFromStamp order: this bundle declares no version, so there was nothing left to permit) — matching expectedAllowanceCounts.json's frozen
//       sif = 4. See that file for the probes, for the S2 correction under RULING FJ-P3-2, and for
//       why S6 alone is deliberately NOT declared.)
//   H2  lib/sifHooks.js                — sourceLoaderList (sifImplementationSpecification),
//       describeSource, describeRoot
//   H3  lib/forgeSifContractGraph.js   — the walk (via sifHooks.emitContractGraph)
//   H4  roundTripValidator.js          — the round-trip pair, UNCHANGED by this migration and still
//       DECLARED in parserDescriptor.ini. SIF's validator is ACTIVE: a stage-ON build
//       (recipes/sifOnlyRoundTrip.recipe.jsonc) runs it and MEASURED inventedTotal 0, lostTotal 0,
//       roundTripClean TRUE in Phase 3. An earlier draft of this header repeated the descriptor's
//       "lostTotal ~15,458, roundTripClean honestly false" — that claim was RETIRED under RULING
//       FJ-P3-3: the enrichment landed in commit 4b6254d and exactly 15,458 SifField nodes now carry
//       `characteristics`, the very count the old text predicted as lost. ⚠ AND CLEAN IS NOT
//       COMPLETE: the verdict's own semanticValidationLimit says lostTotal 0 is fidelity TO THE
//       INGESTED SNAPSHOT, never completeness of the SIF model — the flattened export gives no row to
//       any element with element children.
//
// ⚠ NINE SIF EDGES COLLAPSE UNDER MERGE AT LOAD — 88,766 in, 88,757 harvested. Baked into
// d393b040… since Phase 0, docketed with an unverified candidate cause, and NOT this phase's to fix.
// Node counts are exact both ways. "Fixing" it would move the id and destroy the oracle.
//
// ⚠ THE PER-STANDARD LABELS ARE KEYED BY NATIVE KIND, NOT BY ROLE. SIF carries NINE labels across
// SIX roles — DmeClass holds both SifObject and SifComplexType, DmeSupport holds three — so CEDS's
// role-keyed registry cannot express SIF and copying it would mislabel up to 6,173 nodes with every
// count and every suite still green. The registry and its refusal live in H3; the reasoning is in
// that file's header.
//
// What `require` returns is still `({ embedder }) => bundle` in the house two-stage form — the seam
// (forger.js:904) is satisfied unchanged, and the bundle still answers `.forge(args, callback)` and
// `.buildContractGraph(...)`. NOTE THE SIGNATURE CHANGE ON THE LATTER: the framework's is
// `buildContractGraph({ parsed, metadata })` with `parsed` keyed by LOADER NAME, where the bespoke
// module took a single object carrying `nodes` and `metadata`. EXACTLY TWO suites drive it directly
// and migrate with this file: test-r3-canonical.js and test-sequence-ordinal.js.
// ⚠ AN EARLIER DRAFT OF THIS COMMENT NAMED FOUR, adding test-sifRoundTrip.js and runSifMaterialize.js.
// Those two only `require` the bundle and then call `bundle.forge(...)`, whose signature the framework
// PRESERVES — so neither needed a change and neither is modified. Measured: test-sifRoundTrip passes
// 136/136 untouched. The four-file figure came from a grep for `require.*forgeSif` rather than for the
// method actually being called; a consumer list is only as good as the thing it greps for.
// LINEAGE: git history holds the pre-framework module on branch hubKitRole-082826 at db0570b.

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/sifForgeDeclaration'); // H1 — data (§4)
const sifHooks = require('./lib/sifHooks')(); // H2/H3 — sourceLoaderList, describeSource, emitContractGraph, describeRoot

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: sifHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
