'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeLif.js — the LIF forge bundle on the Forge Framework (nextStandards-102326 lane C1, 2026-10-24): the LIF Initiative's lif-core
// lif-schema.json (OpenAPI 3.0) components.schemas, through the OpenAPI kit's dereferenced layout. The framework owns the pipeline, the
// root, the finalizers and the embed passes; the kit owns the loader, the walk and the round-trip pair; this file owns only the wiring.
//   H1  lib/lifForgeDeclaration.js   data
//   H2  lib/lifHooks.js              the kit's hooks over lib/lifOpenapiProfile.json
//   H4  roundTripValidator.js        declared in parserDescriptor.ini

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/lifForgeDeclaration');
const lifHooks = require('./lib/lifHooks')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: lifHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
