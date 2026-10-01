'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgePescAcademicEportfolio1v0v0.js — the PESC Academic Eportfolio v1.0.0 release forge on the Forge Framework.
// WRITTEN BY lib/pesc-release-forge/tools/scaffoldReleaseBundle.js from the release's manifest
// entry; rescaffold rather than edit. Everything this bundle does lives in the shared library
// lib/pesc-release-forge/ (DESIGN-pescForge.md §4.1); this file only wires the framework, the shared
// hooks and this bundle's declaration together.
//
// `require` returns ({ embedder }) => bundle, the house two-stage form the forger expects.

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const releaseBundle = require(path.join(__dirname, '..', '..', 'lib', 'pesc-release-forge', 'releaseBundle'));
const forgeDeclaration = require('./lib/declaration');
const hooks = releaseBundle.makeBundleHooks({ bundleDirPath: __dirname });

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
