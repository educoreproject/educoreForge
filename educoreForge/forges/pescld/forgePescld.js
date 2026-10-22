'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgePescld.js — the PESC_LD forge bundle on the Forge Framework (zeroBacklog lane C1, 2026-10-22): the PESC College Transcript
// JSON-LD application profile (package v0.0.2) from its TAP CSVs. The framework owns the pipeline, the root, the finalizers and
// the embed passes; this file owns only the wiring.
//   H1  lib/pescldForgeDeclaration.js   data
//   H2  lib/pescldHooks.js              the loader, describeSource, describeRoot, emitContractGraph (lib/pescldWalk.js)
//   H4  roundTripValidator.js           declared in parserDescriptor.ini

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/pescldForgeDeclaration');
const pescldHooks = require('./lib/pescldHooks')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: pescldHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
