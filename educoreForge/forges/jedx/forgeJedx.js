'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeJedx.js — the JEDx forge bundle on the Forge Framework (nextStandards-102326 lane B1): the JEDx Open API Specification's four
// dereferenced bundles, through the OpenAPI kit (layout dereferencedMultiFile, K1). The framework owns the pipeline, the root, the
// finalizers and the embed passes; the kit owns the loader, the walk and the round-trip pair; this file owns only the wiring.
//   H1  lib/jedxForgeDeclaration.js   data
//   H2  lib/jedxHooks.js              the kit's hooks over lib/jedxOpenapiProfile.json
//   H4  roundTripValidator.js         declared in parserDescriptor.ini

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/jedxForgeDeclaration');
const jedxHooks = require('./lib/jedxHooks')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: jedxHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
