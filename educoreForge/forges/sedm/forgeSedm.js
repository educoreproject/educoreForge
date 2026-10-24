'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeSedm.js — the SEDM forge bundle on the Forge Framework (nextStandards-102326 wave 2, lane G, 2026-10-24): the Special Education
// Data Model from its working documents (snapshot 01). The framework owns the pipeline, the root, the finalizers and the embed passes;
// this file owns only the wiring.
//   H1  lib/sedmForgeDeclaration.js   data
//   H2  lib/sedmHooks.js              the loader, describeSource, describeRoot, emitContractGraph (lib/sedmWalk.js)
//   H4  roundTripValidator.js         declared in parserDescriptor.ini

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/sedmForgeDeclaration');
const sedmHooks = require('./lib/sedmHooks')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: sedmHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
