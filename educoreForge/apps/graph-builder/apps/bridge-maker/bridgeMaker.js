'use strict';

/** @implements {BridgeMakerComponent} — formal contract declared in
 *  apps/graph-builder/interfaces.js; enforced by test-interfaces. The mapper/plugin contract it
 *  resolves and runs is @interface BridgeModule (BRIDGE_MODULE_SHAPE) in the same file. */

// bridgeMaker — runs a bridge module over a materialized dependency graph, writing new LABELED
// relationship edges INTO the graph (label-based delta harvest, build.js §Phase C). In-process
// module of graphBuilder; async callback style (err-string first, no async/await, no try/catch
// for control flow).
//
//   bridgeMaker({ bridgePluginRegistry?, graphWriterFactory? }) -> { run(spec, callback) }
//
//     spec = { inGraph, mapper, applyLabel }
//       inGraph      a GraphHandle (NOT a url) — the materialized dependency graph. Carries its
//                    own boltUrl+password; the graphWriter is minted from it per run.
//       mapper       the recipe's mapper token. RESOLVED THROUGH A REGISTRY to a bridge plugin —
//                    no switch, no silent default; an unregistered mapper is REFUSED BY NAME.
//       applyLabel   the label every edge this bridge writes is stamped with, so
//                    replayManager.harvest can select exactly these edges by the same label
//                    (build.js hands the same constant to both sides).
//
//     callback('', { inGraph, mapper, applyLabel, edgesWritten, note, decisionBlock, counts })
//       — a STATUS report. The edges themselves stay in the graph; harvesting them by label is
//       build.js/replayManager.harvest's job, NOT this module's (the plan is explicit: write +
//       return status here, harvest there).
//
// HOW mapper RESOLVES (the registry, the HUB_FORGE_BY_STANDARD twin). BRIDGE_PLUGIN_BY_MAPPER is
// DATA keyed by mapper token; resolution is a lookup, never a branch. It ships with the generic
// default plugin registered under DEFAULT_GENERIC_MAPPER ('genericBridge'); per-standard OVERRIDES
// are one more row here in later phases (CTDL's structural bridge is such an override), exactly as
// forger.HUB_FORGE_BY_STANDARD gains one row per hub. A mapper naming no registered plugin is
// refused BY NAME listing the known plugins — 'I did not register it' is not 'use the default'
// (polyArch2 §6; plan §6).
//
// THE SHAPE GATE. A resolved plugin's produced callable is held to @interface BridgeModule
// (BRIDGE_MODULE_SHAPE) BEFORE it is run: right arity (ONE named-argument object, not positional),
// and it must visibly read inGraph/hub/applyLabel off that object. A drifted plugin is refused BY
// NAME rather than run against a graph. After it runs, its result is held to the declared result
// keys too. This is the runtime twin of the static enforcement test-interfaces applies to the
// four top-level components.
//
// THE WRITE SUBSTRATE. bridgeMaker mints a graphWriter from inGraph (default: the real
// neo4jGraphWriter; injectable as a DOUBLE for the suite, which is how the write path is proven
// without a container — §3 hard line 2), builds the component library over it, injects the whole
// library into the plugin, runs the plugin, and closes the writer. The default generic plugin
// writes zero edges in P0 and so never opens the connection at all.
//
// hub (P0 SEAM): the plugin contract is ({ inGraph, hub, applyLabel }, cb), but build.js's Phase C
// hands run() only { inGraph, mapper, applyLabel } today. P0 passes hub: null; threading the
// recipe's hub token through run() is a build.js change for the phase that needs it (P2/P3), not
// this module's to invent (polyArch2 §6 — nothing is substituted for it).

const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const { BRIDGE_MODULE_SHAPE } = require(path.join(__dirname, '..', '..', 'interfaces'));
const { buildComponentLibrary } = require(path.join(__dirname, 'lib', 'componentLibrary'));
const neo4jGraphWriter = require(path.join(__dirname, 'lib', 'neo4jGraphWriter'));
const neo4jGraphReader = require(path.join(__dirname, 'lib', 'neo4jGraphReader'));

// -----
// THE BRIDGE PLUGIN REGISTRY (registry-over-switch; polyArch2 §7) — DATA keyed by mapper token,
// the HUB_FORGE_BY_STANDARD twin. It ships with the generic default plugin; a per-standard
// override is ONE more row here in a later phase, never a branch to edit. Each value is a bridge
// module factory: bridgeModule(injectedTools) -> callable(spec, cb).
const DEFAULT_GENERIC_MAPPER = 'genericBridge';

const BRIDGE_PLUGIN_BY_MAPPER = {
	[DEFAULT_GENERIC_MAPPER]: require(path.join(__dirname, 'lib', 'bridgePlugins', 'genericBridge')),
	// CTDL authored EXACT_MATCH producer (P2) — a per-standard OVERRIDE (design §1), ONE more row here,
	// no branch to edit. The recipe's CTDL->CEDS bridge names this mapper. Token follows the
	// '<source>IntoCeds<Producer>' shape the LIF bridge uses ('lifIntoCedsSemantic').
	ctdlIntoCedsAuthored: require(path.join(__dirname, 'lib', 'bridgePlugins', 'ctdlAuthoredBridge')),
};

// -----
// resolveBridgePlugin — the lookup. Refuses an unregistered mapper BY NAME (no silent default),
// naming the mapper and the known plugins, so the operator sees which line to fix. Answers
// { pluginFactory } or { error } — the error-object idiom, so nothing throws past run()'s callback.
const resolveBridgePlugin = ({ mapper, registry = BRIDGE_PLUGIN_BY_MAPPER }) => {
	const pluginFactory = registry[mapper];
	if (typeof pluginFactory !== 'function') {
		const known = Object.keys(registry).join(', ') || '(none)';
		return {
			error:
				`bridgeMaker: mapper '${mapper}' resolves to no registered bridge plugin — known ` +
				`plugins: ${known}. A mapper naming no plugin is a recipe error; there is no default ` +
				`generic fallthrough, and nothing was substituted for it.`,
		};
	}
	return { pluginFactory };
};

// -----
// bridgeModuleShapeViolation — the runtime shape gate for a resolved plugin's produced callable,
// against @interface BridgeModule (BRIDGE_MODULE_SHAPE). Two static checks, the same ones
// test-interfaces applies to the top-level components:
//   ARITY  — the callable takes ONE named-argument object plus the callback (arity 2). A
//            positional (inGraph, hub, applyLabel) callable has arity 3 and is caught here.
//   argKeys — the callable's own source visibly READS inGraph/hub/applyLabel off its argument
//            object (destructured or accessed). A source-text check: it cannot pass a signature
//            that never mentions a key, which is what drift looks like. It CAN pass for the wrong
//            reason (a named-but-unused key), and this comment does not pretend otherwise.
// Types are not checked; result keys are checked AFTER the plugin runs (resultKeysViolation).
const READS_KEY = (functionSource, oneKey) =>
	new RegExp(`[{,]\\s*${oneKey}\\s*[,:=}]`).test(functionSource) ||
	new RegExp(`\\.${oneKey}\\b`).test(functionSource);

const bridgeModuleShapeViolation = (pluginCallable, mapper) => {
	if (typeof pluginCallable !== 'function') {
		return `mapper '${mapper}' produced ${typeof pluginCallable}, not a bridge-module callable`;
	}
	if (pluginCallable.length !== BRIDGE_MODULE_SHAPE.arity) {
		return (
			`mapper '${mapper}' has a drifted SHAPE: its callable takes ${pluginCallable.length} ` +
			`argument(s); @interface BridgeModule declares ${BRIDGE_MODULE_SHAPE.arity} (one ` +
			`named-argument object plus the callback). A positional signature looks exactly like this.`
		);
	}
	const functionSource = pluginCallable.toString();
	const unread = BRIDGE_MODULE_SHAPE.argKeys.filter((oneKey) => !READS_KEY(functionSource, oneKey));
	if (unread.length) {
		return (
			`mapper '${mapper}' has a drifted SHAPE: its callable never reads declared argument ` +
			`key(s) off its argument object: ${unread.join(', ')}`
		);
	}
	return '';
};

const resultKeysViolation = (producedResult, mapper) => {
	if (!producedResult || typeof producedResult !== 'object') {
		return `mapper '${mapper}' produced ${typeof producedResult}, not a status object`;
	}
	const absent = BRIDGE_MODULE_SHAPE.resultKeys.filter((oneKey) => producedResult[oneKey] === undefined);
	return absent.length
		? `mapper '${mapper}' returned a status missing declared key(s): ${absent.join(', ')}`
		: '';
};

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({
		bridgePluginRegistry = BRIDGE_PLUGIN_BY_MAPPER,
		graphWriterFactory = neo4jGraphWriter,
		graphReaderFactory = neo4jGraphReader,
	} = {}) => {
		const run = ({ inGraph, mapper, hub = null, applyLabel }, callback) => {
			// ARGUMENT REFUSALS — every required argument is stated or the run does not start
			// (polyArch2 §6). None is guessed.
			if (!inGraph) {
				callback(
					`bridgeMaker: inGraph is not given. It is the materialized dependency GraphHandle the ` +
						`bridge writes into; there is no default.`,
				);
				return;
			}
			if (typeof mapper !== 'string' || mapper.trim() === '') {
				callback(
					`bridgeMaker: mapper is ${
						mapper === undefined ? 'not named' : JSON.stringify(mapper)
					}. It is the token that resolves the bridge plugin; there is no default.`,
				);
				return;
			}
			if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
				callback(
					`bridgeMaker: applyLabel is ${
						applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)
					}. It is the label harvest selects the written edges by; there is no default.`,
				);
				return;
			}

			// RESOLVE the plugin — refuse an unregistered mapper by name, before any graph writer is
			// minted, so a bad mapper costs no connection.
			const resolved = resolveBridgePlugin({ mapper, registry: bridgePluginRegistry });
			if (resolved.error) {
				callback(resolved.error);
				return;
			}

			// MINT the write substrate from the handle, build the library over it, COMPOSE the plugin. The
			// graphReader FACTORY is injected too (P2): an authored producer mints+closes its own reader to
			// WALK the dependency graph. The suite injects a reader double, so the producer's read path is
			// proven without a container (§3 hard line 2), exactly as the writer double proves the write path.
			const graphWriter = graphWriterFactory({ inGraph });
			const componentLibrary = buildComponentLibrary({ graphWriter, graphReader: graphReaderFactory });

			let pluginCallable;
			try {
				pluginCallable = resolved.pluginFactory(componentLibrary);
			} catch (composeError) {
				callback(`bridgeMaker: composing bridge plugin for mapper '${mapper}': ${composeError.message}`);
				return;
			}

			// THE SHAPE GATE — refuse a drifted plugin BY NAME before it runs against the graph.
			const shapeViolation = bridgeModuleShapeViolation(pluginCallable, mapper);
			if (shapeViolation) {
				callback(`bridgeMaker: ${shapeViolation}`);
				return;
			}

			const taskList = new taskListPlus();

			// RUN the plugin over the live graph. hub is THREADED from run's spec (P2): build.js's Phase C
			// passes the recipe's hub token so an authored producer knows which hub it bridges toward and
			// can refuse a graph whose hub is not the one it authors against. It defaults to null when a
			// caller omits it (a hub-agnostic bridge ignores it).
			taskList.push((args, next) => {
				pluginCallable({ inGraph, hub, applyLabel }, (err, pluginResult) => {
					next(err ? `mapper '${mapper}' failed: ${err}` : '', { ...args, pluginResult });
				});
			});

			// HOLD the plugin's result to the declared result keys (the post-run half of the gate).
			taskList.push((args, next) => {
				const resultViolation = resultKeysViolation(args.pluginResult, mapper);
				next(resultViolation ? `bridgeMaker: ${resultViolation}` : '', args);
			});

			// CLOSE the writer — always, whether the plugin opened a connection or not.
			const finish = (runError, args) => {
				graphWriter.close((closeError) => {
					if (runError) {
						callback(
							closeError
								? `${runError} (and the graph writer also failed to close: ${closeError})`
								: runError,
						);
						return;
					}
					if (closeError) {
						callback(`bridgeMaker: mapper '${mapper}' wrote its edges but the graph writer ` +
							`failed to close: ${closeError}`);
						return;
					}
					const pluginResult = args.pluginResult || {};
					callback('', {
						inGraph,
						mapper,
						applyLabel,
						edgesWritten: pluginResult.edgesWritten,
						decisionBlock: pluginResult.decisionBlock === undefined ? null : pluginResult.decisionBlock,
						counts: pluginResult.counts,
						note: `mapper '${mapper}' wrote ${pluginResult.edgesWritten} edge(s) labeled '${applyLabel}'`,
					});
				});
			};

			pipeRunner(taskList.getList(), {}, (err, args) => finish(err, args));
		};

		return { run };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.resolveBridgePlugin = resolveBridgePlugin;
module.exports.bridgeModuleShapeViolation = bridgeModuleShapeViolation;
module.exports.BRIDGE_PLUGIN_BY_MAPPER = BRIDGE_PLUGIN_BY_MAPPER;
module.exports.DEFAULT_GENERIC_MAPPER = DEFAULT_GENERIC_MAPPER;
