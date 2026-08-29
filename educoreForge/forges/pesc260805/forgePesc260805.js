'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgePesc260805.js — the PESC260805 forge bundle on the Forge Framework
// (SPEC-forgeFramework-v1.md §5.3, §8.2; migrated in the hub-kit-role campaign, Phase 4, from the
// 906-line bespoke module that parsed the 64-file PESC XSD aggregate and minted the UNIVERSAL FORGE
// PROPERTY CONTRACT by hand across three tiers). The framework owns the pipeline, the source
// verification, the version stamp, the root, the kit, the integrity pass, the finalizers, the embed
// pass and the return; this file owns nothing but the wiring:
//   H1  lib/pescForgeDeclaration.js      — data (standardKey 'pesc260805', standardSource
//       'PESC260805', the DECLARED root id 'pesc260805:root', parserVersion '1', the honestly EMPTY
//       mappingInstruction, an EMPTY nonEmbeddableRoleList because PESC embeds every node including
//       the root, the shared PERMISSIVE stableId pattern, and the FIVE measured allowances
//       P16/P9/P5/P17/P4)
//   H2  lib/pescHooks.js                 — sourceLoaderList (pescCorpus), describeSource,
//       describeRoot
//   H3  lib/forgePescContractGraph.js    — the walk: source, derived, searchText composition and
//       synthetic tiers, in that order, all minting through the kit
//   H4  roundTripValidator.js            — the round-trip pair, UNCHANGED by this migration and
//       still DECLARED in parserDescriptor.ini
//
// ⚠ THIS MIGRATION RE-KEYS THE BLOCK, AND THE RE-KEY IS RULED (FJ-P4-5), PREDICTED AND PROVED.
//   I4  f139654a98cd0ef238759e6dc2bda2e532f13d5a7db00bfea94d89c3317b149d at 88,551,726 — the
//       PRE-migration id, reproduced on unchanged code at this phase's entry gate.
//   I4' the POST-migration id — see the DEVLOG for the measured value and the six proofs.
// THE CAUSE IS ONE NODE. PESC's bespoke root was the only node in this block that did not already
// look like a framework root: 42,371 of 42,372 nodes carry depth AND crossRefs and the root carried
// neither, nor any of snapshotKey / publishedVersion / versionSource / coreVersion. The framework
// stamps all six, and structural-contract.js does so with no allowance channel and no root
// exemption, so NO declaration-only migration could have held f139654a. Rather than write four
// allowance rows whose only purpose would be to keep one root non-conformant, the ruling made the
// root CONFORMANT with CEDS, SIF and Ed-Fi. The predicted new root line was written into the DEVLOG
// IN FULL before the re-forge, so the check afterwards is an assertion rather than an interpretation.
//
// ⚠ FIVE ALLOWANCES, FOUR OF WHICH DID NOT EXIST BEFORE THIS COMMIT, and THREE of those were named
// in framework refusal prose that could never have worked — "P9" at contractGraphKit.js:223,
// "P5: pescTier" at rootNode.js:124, "an active P4 edgeTypeAllowList" at contractGraphKit.js:310 —
// because PESC was the only forge permitted to declare them. A closed registry's rows are UNTESTED
// until a forge declares them, and here that applied to the ERROR MESSAGES as much as to the rows.
//
// ⚠ THE PER-STANDARD LABELS ARE KEYED BY NATIVE XSD CONSTRUCT KIND — a FOURTH axis, and the only
// one where role -> label is not even a function: DmeSupport carries six labels and
// PescNamedDefinition appears under three roles. CEDS's role-keyed registry cannot express it. The
// kind-keyed refusing registry and its reasoning live in H3.
//
// What `require` returns is still `({ embedder }) => bundle` in the house two-stage form — the seam
// (forger.js) is satisfied unchanged, and the bundle still answers `.forge(args, callback)` for the
// three suites that drive it directly (test-pesc260805SourceTier / DerivedTier / SyntheticTier),
// which this commit also makes DISCOVERABLE for the first time by adding the kit's package.json.
// LINEAGE: git history holds the pre-framework module on branch hubKitRole-082826 at 9fc1abb.

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/pescForgeDeclaration'); // H1 — data (§4)
const pescHooks = require('./lib/pescHooks')(); // H2/H3 — sourceLoaderList, describeSource, emitContractGraph, describeRoot

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: pescHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
