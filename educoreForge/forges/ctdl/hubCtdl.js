'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// hubCtdl.js — the CTDL HUB role on lib/hub-framework (ctdlHub-101926 P4). Deliberate sibling of forges/ceds/hubCeds.js:
// the framework owns the derivation and this file owns nothing but the wiring.
//
//   H1  lib/ctdlHubDeclaration.js — DATA
//   H2  lib/ctdlHubHooks.js — methods, PRESENT AND EMPTY
//
// What `require` returns is the factory the forger expects — ({ hubVersion, hubNamespace }) -> { forgeHub, ... } — reached
// through parserDescriptor.ini's hubModule. Declaring it there makes CTDL ABLE to be a hub; only a recipe that names
// { standard: 'ctdl' } in hubs makes it one (capability is not activation).
//
// I12 is a real cross-file check: forgeStandardSource is read from the FORGE declaration and the framework refuses a hubName
// that differs from it by name.

const path = require('path');
const hubFramework = require(path.join(__dirname, '..', '..', 'lib', 'hub-framework', 'hub-framework'));
const hubDeclaration = require('./lib/ctdlHubDeclaration'); // H1 — data
const ctdlHubHooks = require('./lib/ctdlHubHooks')(); // H2 — methods; empty for CTDL
const forgeDeclaration = require('./lib/ctdlForgeDeclaration'); // for I12 only — the cross-check

// START OF moduleFunction() ============================================================

const moduleFunction = ({ moduleName } = {}) =>
	hubFramework({
		hubDeclaration,
		hooks: ctdlHubHooks,
		forgeStandardSource: forgeDeclaration.standardSource,
	});

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
