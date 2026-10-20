'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeCtdlasn.js — the CTDLASN forge bundle on the Forge Framework (ctdlHub-101926 P2). The framework owns the
// pipeline, the root, the finalizers and the embed pass; this file owns only the wiring. A port of the July
// attic forge (codeAttic/cli/parserLib/forge-ctdlasn), judged against the July oracle GOLD_EVAL_260718.

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/ctdlasnForgeDeclaration'); // H1 — data
const ctdlasnHooks = require('./lib/ctdlasnHooks')(); // H2/H3

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: ctdlasnHooks });

module.exports = moduleFunction({ moduleName });
