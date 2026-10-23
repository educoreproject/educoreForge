'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeOpenbadges.js — the Open Badges 3.0 forge bundle on the Forge Framework (nextStandards-102326 lane A1, 2026-10-23): the 1EdTech
// OpenAPI 3.0 document's components.schemas, through the OpenAPI kit. The framework owns the pipeline, the root, the finalizers and
// the embed passes; the kit owns the loader, the walk and the round-trip pair; this file owns only the wiring.
//   H1  lib/openbadgesForgeDeclaration.js   data
//   H2  lib/openbadgesHooks.js              the kit's hooks over lib/openbadgesOpenapiProfile.json
//   H4  roundTripValidator.js               declared in parserDescriptor.ini

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/openbadgesForgeDeclaration');
const openbadgesHooks = require('./lib/openbadgesHooks')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: openbadgesHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
