'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeEdfi.js — the Ed-Fi forge bundle on the Forge Framework (SPEC-forgeFramework-v1.md §5.3, §8.2;
// migrated F3b 2026-08-16 by AMBER_TRAIL, block id aea6d8dfe789… IDENTICAL before and after — the
// F3b proof). The framework owns the pipeline, the source verification, the version stamp, the root,
// the adapter, the embed pass and the return; this file owns nothing but the wiring:
//   H1  lib/edfiForgeDeclaration.js — data (standardKey 'edfi', standardSource 'EdFi', the identity
//       rule, mappingInstruction, allowances E6 + E8)
//   H2  lib/edfiHooks.js — sourceLoaderList (metaEdModel, descriptorCodeValues, authoredCrosswalk),
//       describeSource, describeRoot
//   H3  lib/forgeEdfiContractGraph.js — the walk (via edfiHooks.emitContractGraph)
//   H4  roundTripValidator.js — the round-trip pair (unchanged by the migration)
// What `require` returns is still `({ embedder }) => bundle` in the house two-stage form — the seam
// (forger.js:816-828) is satisfied unchanged. LINEAGE: git history holds the pre-framework module
// (tag preEdfiMigration-081626, 428ca06) and, before it, the incumbent CSV-crosswalk forge.

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/edfiForgeDeclaration'); // H1 — data (§4)
const edfiHooks = require('./lib/edfiHooks')(); // H2/H3 — sourceLoaderList, describeSource, emitContractGraph, describeRoot

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: edfiHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
