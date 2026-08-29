'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// hubCeds.js — the CEDS HUB role on lib/hub-framework, migrated in Phase 2c (SPEC-hubKitRole-082826
// §4.1). Deliberate sibling of forgeCeds.js and forgeEdfi.js: the framework owns the derivation and
// this file owns nothing but the wiring.
//
//   H1  lib/cedsHubDeclaration.js — DATA (the four identity literals, sourceIdFieldName,
//       baseFieldNames, qualifiedReference, provenanceLabel)
//   H2  lib/cedsHubHooks.js — methods. PRESENT AND EMPTY: CEDS needs none, which is itself the
//       finding that made the extraction possible.
//
// WHAT `require` RETURNS IS THE FACTORY THE FORGER ALREADY EXPECTS —
// ({ hubVersion, hubNamespace }) -> { forgeHub, addressSignatureFor, hubDefinitionStableId } — so the
// seam that Phase 2a pointed at forges/ceds/lib/cedsHubForge.js is satisfied UNCHANGED by pointing
// parserDescriptor.ini's hubModule at this file instead. The forger's contract did not move.
//
// I12 IS A REAL CROSS-FILE CHECK HERE, NOT A RESTATEMENT. forgeStandardSource is read from the
// FORGE declaration, so the framework compares the hub's declared hubName against the forge's own
// standardSource and refuses a mismatch by name ([R2 F6]). Before 2c these were two independent
// literals in two files with nothing between them.
//
// ⚠ THE BLOCK ID DEPENDS ON hubDeclaration.provenanceLabel CHARACTER FOR CHARACTER. It was re-keyed
// by controlled experiment in Phase 2b (commit 4ce39b8): I1' =
// e763404ea5864e2c9a9d4521b0887343e0c42bd5aa59565e2d2b1bba70dfb855. Editing those two values without
// repeating that experiment moves the id.
//
// LINEAGE: git history holds forges/ceds/lib/cedsHubForge.js, the 985-line module this replaces
// (tag post2aHubDiscovery-082926 at 7db272c is the last commit in which it still held the derivation).

const path = require('path');
const hubFramework = require(path.join(__dirname, '..', '..', 'lib', 'hub-framework', 'hub-framework'));
const hubDeclaration = require('./lib/cedsHubDeclaration'); // H1 — data (§4.4)
const cedsHubHooks = require('./lib/cedsHubHooks')(); // H2 — methods; empty for CEDS
const forgeDeclaration = require('./lib/cedsForgeDeclaration'); // for I12 only — the cross-check

// START OF moduleFunction() ============================================================

const moduleFunction = ({ moduleName } = {}) =>
	hubFramework({
		hubDeclaration,
		hooks: cedsHubHooks,
		forgeStandardSource: forgeDeclaration.standardSource,
	});

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
