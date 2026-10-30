'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeUsecase.js — the use-case forge bundle on the Forge Framework (useCaseForge-102926 Phase 1, 2026-10-29): the EDUcore Enhanced
// Cockburn use cases (release 1.0, format v0.11). The framework owns the pipeline, the root, the finalizers and the embed passes; this
// file owns only the wiring.
//   H1  lib/usecaseForgeDeclaration.js   data
//   H2  lib/usecaseHooks.js              the loader, describeSource, describeRoot, emitContractGraph (lib/usecaseWalk.js)
//   H4  roundTripValidator.js            declared in parserDescriptor.ini

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/usecaseForgeDeclaration');
const usecaseHooks = require('./lib/usecaseHooks')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: usecaseHooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
