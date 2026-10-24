'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeCase.js — the CASE 1.1 forge bundle on the Forge Framework (nextStandards wave 2 lane E, 2026-10-24): the 1EdTech OpenAPI 3.0
// YAML document's components.schemas, through the OpenAPI kit. The framework owns the pipeline, the root, the finalizers and the
// embed passes; the kit owns the loader, the walk and the round-trip pair; this file owns only the wiring.
//   H1  lib/caseForgeDeclaration.js   data
//   H2  lib/caseHooks.js              the kit's hooks over lib/caseOpenapiProfile.json
//   H4  roundTripValidator.js         declared in parserDescriptor.ini

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/caseForgeDeclaration');
const caseHooks = require('./lib/caseHooks')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: caseHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
