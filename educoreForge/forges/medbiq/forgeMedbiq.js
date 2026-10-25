'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeMedbiq.js — the MedBiquitous forge bundle on the Forge Framework (nextStandards wave 3 lane I, 2026-10-25): the AAMC MedBiquitous
// XML Schema portfolio, one standard of schema sets, through the XSD kit. The framework owns the pipeline, the root, the finalizers and
// the embed passes; the kit owns the loader, the walk and the round-trip pair; this file owns only the wiring.
//   H1  lib/medbiqForgeDeclaration.js   data
//   H2  lib/medbiqHooks.js              the kit's hooks over lib/medbiqXsdProfile.json
//   H4  roundTripValidator.js           declared in parserDescriptor.ini

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/medbiqForgeDeclaration');
const medbiqHooks = require('./lib/medbiqHooks')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: medbiqHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
