'use strict';
const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
// forgeToy.js — the Toy Standard forge bundle on the Forge Framework (SPEC-forgeFramework-v1.md §5.3,
// §8.2). The framework owns the pipeline, the adapter, the root, the embed pass and the return; this
// file owns nothing but the wiring. What `require` returns is still `({ embedder }) => bundle`, in
// the house two-stage form — the seam (forger.js:816) is satisfied unchanged.
const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', '..', 'forge-framework'));
const forgeDeclaration = require('./lib/toyForgeDeclaration'); // H1 — data (§4)
const toyHooks = require('./lib/toyHooks')(); // H2/H3 — sourceLoaderList, describeSource, emitContractGraph, describeRoot

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: toyHooks });

module.exports = moduleFunction({ moduleName });
