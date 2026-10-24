'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeEduapi.js — the EduAPI 1.0 forge bundle on the Forge Framework (nextStandards wave 2 lane F, 2026-10-24): the 1EdTech Edu-API
// OpenAPI 3.0 document's components.schemas, through the OpenAPI kit. The framework owns the pipeline, the root, the finalizers and
// the embed passes; the kit owns the loader, the walk and the round-trip pair; this file owns only the wiring.
//   H1  lib/eduapiForgeDeclaration.js   data
//   H2  lib/eduapiHooks.js              the kit's hooks over lib/eduapiOpenapiProfile.json
//   H4  roundTripValidator.js           declared in parserDescriptor.ini

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/eduapiForgeDeclaration');
const eduapiHooks = require('./lib/eduapiHooks')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: eduapiHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
