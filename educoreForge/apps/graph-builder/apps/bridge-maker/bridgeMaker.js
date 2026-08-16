'use strict';

/** @implements {BridgeMakerComponent} — formal contract declared in
 *  apps/graph-builder/interfaces.js; enforced by test-interfaces. The bridge/plugin contract this
 *  component WILL resolve and run again is @interface BridgeModule (BRIDGE_MODULE_SHAPE) in the
 *  same file; its runtime gate (bridgeModuleShapeViolation) is kept here so Phase 6's plugins are
 *  held to a contract that already exists. */

// bridgeMaker — THE SEAM STUB (root-and-branch reset, Phase 3, 2026-08-15; RULINGS-supervisor-phase2
// §2 option A; SEAM-bridgeMakerStub.md §5). The bridge system is being REBUILT under the EDUcore
// Bridge Profile v1.0; every bridge implementation, the lib.d evidence kit, the component library,
// the graph writer/reader and the three-directory plugin search path were set aside (system/codeAttic,
// tag preDemolition-081526). What remains is the CONTRACT and its refusal:
//
//   bridgeMaker() -> { run(spec, callback) }
//
//     spec = { inGraph, bridge, applyLabel, ... }   — same argument keys as the declared shape
//     callback(errString)                            — ALWAYS a refusal (see below)
//
// WHAT THIS STUB DOES.
//   1. It satisfies interfaces.js: `require('.../apps/bridge-maker')` is a FACTORY whose `()` returns
//      `{ run }`, `run` has arity 2 and reads inGraph / bridge / applyLabel off its first argument
//      (COMPONENT_SHAPES.bridgeMaker.run — the static sweep in test-interfaces checks exactly that).
//   2. With `bridges: []` in the recipe — the only buildable shape while no producer is registered —
//      build.js's Phase C is `eachSeries([], …)`, a no-op: run() is NEVER CALLED and the build's
//      relationship-block result is simply empty. Nothing here has to (or does) fabricate a result.
//   3. With ANY declared bridge, run() REFUSES BY NAME (polyArch2 §6): the recipe names a producer
//      that does not exist, and NOTHING is substituted for it — no zero-edge default plugin, no
//      silent success. The refusal text is the supervisor's ruling, verbatim.
//   4. Argument refusals (inGraph / bridge / applyLabel not given) are kept exactly as before, so a
//      malformed call is still refused for the RIGHT reason before the registry refusal fires.
//
// WHAT THIS STUB DOES NOT DO — and refuses to pretend to.
//   - It registers NO plugin resolver, NO graph writer, NO graph reader. The construction-time
//     injection points the pre-reset component accepted (`bridgePluginResolver`, `graphWriterFactory`,
//     `graphReaderFactory`, `bridgeSearchPath` …) are NOT honoured: a caller that hands one in is
//     REFUSED at construction (thrown, named), never silently ignored — an injected double that
//     never runs would make a suite look like it proved something.
//   - It does not export DEFAULT_GENERIC_BRIDGE: a constant naming a bridge that no longer exists is
//     a lie waiting for a caller.
//
// Control flow: err-string-first callbacks, no async/await, no try/catch (server/CLI rule).

const path = require('path');

const { BRIDGE_MODULE_SHAPE } = require(path.join(__dirname, '..', '..', 'interfaces'));

// -----
// THE REGISTRY REFUSAL — the supervisor's words (RULINGS §2). Named once, as data, so the run-time
// refusal and any test that asserts it read the same bytes.
const NO_BRIDGE_IMPLEMENTATION_REGISTERED =
	'no bridge implementation is registered; the bridge system is being rebuilt under the EDUcore Bridge Profile v1.0';

// -----
// bridgeModuleShapeViolation — the runtime shape gate for a resolved plugin, against @interface
// BridgeModule (BRIDGE_MODULE_SHAPE). KEPT through the reset: it is the declared PLUGIN CONTRACT
// Phase 6's producers must meet, it depends on nothing that left, and test-interfaces observes it in
// both directions (a gate never seen failing is not one). Two static checks:
//   ARITY   — the callable takes ONE named-argument object plus the callback (arity 2). A positional
//             (inGraph, hub, applyLabel) callable has arity 3 and is caught here.
//   argKeys — the callable's own source visibly READS inGraph/hub/applyLabel off its argument object
//             (destructured or accessed). A source-text check: it cannot pass a signature that never
//             mentions a key, which is what drift looks like. It CAN pass for the wrong reason (a
//             named-but-unused key), and this comment does not pretend otherwise.
// The pre-reset third check — the FORBIDDEN_SUBSTRATE scan of the plugin's module file for a raw
// neo4j-driver / graph-writer / credential reference — left with the write substrate it guarded; when
// Phase 6 re-introduces a writer, the scan comes back with it (HARVEST-bridgeKnowledge.md).
// Types are not checked; result keys are a post-run check and there is no run.
const READS_ARG_KEY = (functionSource, oneArgKey) =>
	new RegExp(`[{,]\\s*${oneArgKey}\\s*[,:=}]`).test(functionSource) ||
	new RegExp(`\\.${oneArgKey}\\b`).test(functionSource);

const bridgeModuleShapeViolation = (pluginCallable, bridge) => {
	if (typeof pluginCallable !== 'function') {
		return `bridge '${bridge}' produced ${typeof pluginCallable}, not a bridge-module callable`;
	}
	if (pluginCallable.length !== BRIDGE_MODULE_SHAPE.arity) {
		return (
			`bridge '${bridge}' has a drifted SHAPE: its callable takes ${pluginCallable.length} ` +
			`argument(s); @interface BridgeModule declares ${BRIDGE_MODULE_SHAPE.arity} (one ` +
			`named-argument object plus the callback). A positional signature looks exactly like this.`
		);
	}
	const functionSource = pluginCallable.toString();
	const unread = BRIDGE_MODULE_SHAPE.argKeys.filter((oneArgKey) => !READS_ARG_KEY(functionSource, oneArgKey));
	if (unread.length) {
		return (
			`bridge '${bridge}' has a drifted SHAPE: its callable never reads declared argument ` +
			`key(s) off its argument object: ${unread.join(', ')}`
		);
	}
	return '';
};

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(constructionArgs = {}) => {
		// CONSTRUCTION REFUSAL — the stub honours no injection. Naming what was handed in is the whole
		// point: a suite that injects a resolver or writer double and gets a component that quietly
		// never uses it has proven nothing, and would not know.
		const injectedNames = Object.keys(constructionArgs || {});
		if (injectedNames.length) {
			throw new Error(
				`${moduleName}: construction argument(s) ${injectedNames.join(', ')} are not honoured — ` +
					`${NO_BRIDGE_IMPLEMENTATION_REGISTERED}. There is no resolver, writer or reader to inject into.`,
			);
		}

		const run = ({ inGraph, bridge, applyLabel }, callback) => {
			// ARGUMENT REFUSALS — every required argument is stated or the run does not start
			// (polyArch2 §6). None is guessed. Kept byte-for-byte in spirit from the pre-reset
			// component so a malformed call is refused for its own reason first.
			if (!inGraph) {
				callback(
					`${moduleName}: inGraph is not given. It is the materialized dependency GraphHandle the ` +
						`bridge writes into; there is no default.`,
				);
				return;
			}
			if (typeof bridge !== 'string' || bridge.trim() === '') {
				callback(
					`${moduleName}: bridge is ${
						bridge === undefined ? 'not named' : JSON.stringify(bridge)
					}. It is the name that resolves the bridge implementation; there is no default.`,
				);
				return;
			}
			if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
				callback(
					`${moduleName}: applyLabel is ${
						applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)
					}. It is the label harvest selects the written edges by; there is no default.`,
				);
				return;
			}

			// THE REGISTRY REFUSAL — a well-formed call naming a bridge. There is nothing to resolve it
			// to, and nothing is substituted for it (RULINGS §2). This is the seam's actual contract
			// while no producer exists; the probe in test-interfaces turns red the moment someone
			// re-adds a silent default here.
			callback(
				`${moduleName}: bridge '${bridge}' is REFUSED — ${NO_BRIDGE_IMPLEMENTATION_REGISTERED}. ` +
					`Nothing was substituted for it.`,
			);
		};

		return { run };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.bridgeModuleShapeViolation = bridgeModuleShapeViolation;
module.exports.NO_BRIDGE_IMPLEMENTATION_REGISTERED = NO_BRIDGE_IMPLEMENTATION_REGISTERED;
