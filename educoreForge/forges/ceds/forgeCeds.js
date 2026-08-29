'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeCeds.js — the CEDS forge bundle on the Forge Framework (SPEC-forgeFramework-v1.md §5.3, §8.2;
// migrated in the hub-kit-role campaign, Phase 1, from the 973-line bespoke module that parsed
// CEDS-Ontology.rdf and minted the UNIVERSAL FORGE PROPERTY CONTRACT by hand). The block id
// 09a5d658807b9c22b44b28289d9ad4b47df15e45f44c9eacec765962fe487c33 at 419,649,468 is IDENTICAL
// before and after — the Phase 1 proof. The framework owns the pipeline, the source verification,
// the version stamp, the root, the kit, the integrity pass, the finalizers, the embed pass and the
// return; this file owns nothing but the wiring:
//   H1  lib/cedsForgeDeclaration.js    — data (standardKey 'ceds', standardSource 'CEDS', the root
//       addressed by sourceUrl, parserVersion '1', the unpopulated mappingInstruction, the three
//       non-embeddable roles, and NO compatibility declarations — see that file for the probes)
//   H2  lib/cedsHooks.js               — sourceLoaderList (cedsOntology), describeSource, describeRoot
//   H3  lib/forgeCedsContractGraph.js  — the walk (via cedsHooks.emitContractGraph)
//   H4  roundTripValidator.js          — the round-trip pair, UNCHANGED by this migration and
//       DELIBERATELY still off the framework harness roster (SPEC-hubKitRole §4.6): CEDS's validator
//       is its own and its reader is role-scoped, which is what keeps the 94,602 folded hub cards
//       out of the emission. Porting it would require re-scoping that reader first.
//
// THE HUB IS NOT TOUCHED BY THIS MIGRATION. lib/cedsHubForge.js consumes this forge's output at a
// DATA boundary (SPEC-hubKitRole §3.1), so it does not know the forge was rewritten — provided every
// field it reads survives by the same name on the same role. That list is SPEC-hubKitRole §3.5 as
// CORRECTED at Phase 1 entry: it also reads `cedsId` on CLASS and OPTION_SET, through the divergence
// report's four-role loop, which invariant I5b now gates because I1 and I5 cannot see it.
//
// What `require` returns is still `({ embedder }) => bundle` in the house two-stage form — the seam
// (forger.js) is satisfied unchanged, and the bundle still answers `.forge(args, callback)` for the
// two suites that drive it directly (test-cedsHubForge.js, test-forgeCeds-multiDomain.js).
// LINEAGE: git history holds the pre-framework module on branch hubKitRole-082826 at 3ee766f.

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/cedsForgeDeclaration'); // H1 — data (§4)
const cedsHooks = require('./lib/cedsHooks')(); // H2/H3 — sourceLoaderList, describeSource, emitContractGraph, describeRoot

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: cedsHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
