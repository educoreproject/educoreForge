'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeClr.js — the CLR 2.0 forge bundle on the Forge Framework (nextStandards-102326 wave 2 lane D1, 2026-10-24): the 1EdTech
// OpenAPI 3.0 document's components.schemas, through the OpenAPI kit. The framework owns the pipeline, the root, the finalizers and
// the embed passes; the kit owns the loader, the walk and the round-trip pair; this file owns only the wiring.
//   H1  lib/clrForgeDeclaration.js   data
//   H2  lib/clrHooks.js              the kit's hooks over lib/clrOpenapiProfile.json
//   H4  roundTripValidator.js        declared in parserDescriptor.ini

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/clrForgeDeclaration');
const clrHooks = require('./lib/clrHooks')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: clrHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
