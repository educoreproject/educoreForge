'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// refuse.js — the ONE shape every framework refusal is built with (SPEC-forgeFramework-v1.md §3.3,
// Profile §7.1). The house form is the forger's own (`forger.js:106-108,186-195`):
//
//     <moduleName> REFUSED: <what> — <where it belongs / which line to fix>
//
// PURE and synchronous: these helpers RETURN an Error (or null); the caller decides whether to
// throw it (inside the pure layer, under the framework's ONE adapter) or to hand its message to a
// callback (on the orchestration side). No I/O, no channel, no clock.
//
// ONE helper: byName — a fully composed refusal naming WHAT and WHERE. (requiredKeys / closedValue
// were DELETED in the F3b amendment, ruling FB8 2026-08-16: zero callers in the tree — the declaration
// contract composes its own messages; a surface member nobody calls is dead surface, not a convenience.)

const byName = ({ moduleName: refusingModuleName, what, where }) =>
	new Error(`${refusingModuleName} REFUSED: ${what} — ${where}`);

module.exports = { byName, moduleName };
