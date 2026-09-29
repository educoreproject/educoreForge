'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeSif260928.js — the sif260928 forge bundle on the Forge Framework: the SIF replacement
// (SPEC-sifStructuralBridge-replacement.md; PLAN-sifReplacement-smallPhases-092826.md, lane A).
// It lives beside the incumbent forges/sif, which it does not touch, and coexists with it under its
// own standardName 'SIF260928'.
//
// The framework owns the pipeline: source verification, the version stamp, the root, the kit, the
// integrity pass and the embed passes. This file only wires the pieces together:
//   H1  lib/sif260928ForgeDeclaration.js  — data (standardKey, stableIdPattern, root, roles that
//       get no vector, no allowances)
//   H2  lib/sif260928Hooks.js             — sourceLoaderList, describeSource, describeRoot (which
//       applies the version guard), emitContractGraph
//   H4  roundTripValidator.js             — declared in parserDescriptor.ini; a refusing stub until A6
//
// `require` returns ({ embedder }) => bundle, the house two-stage form the forger expects.

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/sif260928ForgeDeclaration');
const sif260928Hooks = require('./lib/sif260928Hooks')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: sif260928Hooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
