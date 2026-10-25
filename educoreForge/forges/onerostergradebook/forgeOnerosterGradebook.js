'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeOnerosterGradebook.js — the OneRoster 1.2 Gradebook forge bundle on the Forge Framework (nextStandards-102326 wave 3 lane H1, 2026-10-24):
// the 1EdTech OpenAPI 3.0 document's components.schemas, through the OpenAPI kit. One of the three OneRoster 1.2 standards (Rostering,
// Gradebook, Resources; family OneRoster, BRONZE_CROWN ruling R2). The framework owns the pipeline, the root, the finalizers and the
// embed passes; the kit owns the loader, the walk and the round-trip pair; this file owns only the wiring.
//   H1  lib/onerostergradebookForgeDeclaration.js   data
//   H2  lib/onerostergradebookHooks.js              the kit's hooks over lib/onerostergradebookOpenapiProfile.json
//   H4  roundTripValidator.js        declared in parserDescriptor.ini

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/onerostergradebookForgeDeclaration');
const onerostergradebookHooks = require('./lib/onerostergradebookHooks')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: onerostergradebookHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
