'use strict';

/** @implements {BridgeMakerComponent} — formal contract declared in
 *  apps/graph-builder/interfaces.js; enforced by test-interfaces. The bridge/plugin contract it
 *  resolves and runs is @interface BridgeModule (BRIDGE_MODULE_SHAPE) in the same file. */

// bridgeMaker — runs a bridge module over a materialized dependency graph, writing new LABELED
// relationship edges INTO the graph (label-based delta harvest, build.js §Phase C). In-process
// module of graphBuilder; async callback style (err-string first, no async/await, no try/catch
// for control flow).
//
//   bridgeMaker({ bridgePluginResolver?, graphWriterFactory?, graphReaderFactory? }) -> { run(spec, callback) }
//
//     spec = { inGraph, bridge, source, hub, applyLabel, ... }
//       inGraph      a GraphHandle (NOT a url) — the materialized dependency graph. Carries its
//                    own boltUrl+password; the graphWriter is minted from it per run.
//       bridge       the recipe's bridge NAME (was 'mapper'). RESOLVED THROUGH A DIRECTORY SEARCH
//                    PATH to exactly one bridge file — no switch, no silent default; a name that
//                    resolves to zero files is REFUSED BY NAME, a name that resolves to more than
//                    one THROWS (ambiguity fails loudly, no precedence).
//       source       the source standard token. It selects the standard-local search directory
//                    (forges/<source>/bridges/) so a standard's bespoke bridge is found; a bridge
//                    living in the forges-shared or library scope resolves without it.
//       applyLabel   the label every edge this bridge writes is stamped with, so
//                    replayManager.harvest can select exactly these edges by the same label
//                    (build.js hands the same constant to both sides).
//
//     callback('', { inGraph, bridge, applyLabel, edgesWritten, note, decisionBlock, counts })
//       — a STATUS report. The edges themselves stay in the graph; harvesting them by label is
//       build.js/replayManager.harvest's job, NOT this module's (the plan is explicit: write +
//       return status here, harvest there).
//
// HOW a bridge RESOLVES (the three-directory search path; design_bridgeResolution_072526 §3b/§4).
// resolveBridgePlugin collects `<bridge>.js` across three scopes — standard-local
// (forges/<source>/bridges/), forges-shared (forges/bridges/), library
// (bridge-maker/bridges/) — and requires the single match. The default generic bridge stopped
// being special: it is JUST a file in the library dir, named like any other and resolved the same
// way. There is no registry, no most-specific-wins, and no silent default (polyArch2 §6): ZERO
// matches is a recipe error refused by name; MORE THAN ONE is a tree defect that THROWS.
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

const fs = require('fs');
const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const { BRIDGE_MODULE_SHAPE } = require(path.join(__dirname, '..', '..', 'interfaces'));
const { buildComponentLibrary } = require(path.join(__dirname, 'lib', 'componentLibrary'));
const neo4jGraphWriter = require(path.join(__dirname, 'lib', 'neo4jGraphWriter'));
const neo4jGraphReader = require(path.join(__dirname, 'lib', 'neo4jGraphReader'));
// buildKit — the lib.d kit loader (bridgeKitRefactor_072726 Phase 1, design §4.1). ADDITIVE ONLY:
// nothing below wires this into run()'s existing pipeline. buildComponentLibrary (above) remains
// the sole path run() composes a plugin over, so the three existing bridges keep working on the old
// flat bag untouched (design P2 — coexist, then tear out). Exported at the bottom alongside
// bridgeMaker's other utility exports so a Phase-2 bridge (or a test) can build the kit directly.
const { buildKit } = require(path.join(__dirname, 'lib', 'kitLoader'));

// -----
// THE THREE SEARCH DIRECTORIES (design §4), narrowest first. The tree root is five levels up from
// this file (bridge-maker -> apps -> graph-builder -> apps -> educoreForge). Order does NOT imply
// precedence — a bridge name is expected UNIQUE across the whole path; a collision is surfaced,
// never resolved silently.
const LIBRARY_BRIDGES_DIR = path.join(__dirname, 'bridges'); // library (broadest)
const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const FORGES_DIR = path.join(TREE_ROOT, 'forges');
const FORGES_SHARED_BRIDGES_DIR = path.join(FORGES_DIR, 'bridges'); // forges-shared (middle)

// the default generic bridge is now just a library file; this constant names it for callers that
// want the P0 placeholder by name (it holds no special resolution power).
const DEFAULT_GENERIC_BRIDGE = 'genericBridge';

// bridgeSearchPath — the ordered scopes to search for a bridge, given its source standard. A
// standard-local scope is added only when a source token is present; the forges-shared and
// library scopes are always searched.
const bridgeSearchPath = ({ source } = {}) => {
	const dirs = [];
	if (typeof source === 'string' && source.trim() !== '') {
		dirs.push(path.join(FORGES_DIR, source.trim(), 'bridges')); // standard-local (narrowest)
	}
	dirs.push(FORGES_SHARED_BRIDGES_DIR); // forges-shared (middle)
	dirs.push(LIBRARY_BRIDGES_DIR); // library (broadest)
	return dirs;
};

// -----
// resolveBridgePlugin — the directory search-path resolver (design §3b/§4). Collects `<bridge>.js`
// across the search path (a non-existent search dir simply contributes nothing — an empty scope,
// not a silent default). EXACTLY ONE match -> require it; MORE THAN ONE -> THROW BY NAME (ambiguity
// is a tree defect, not user input, and there is no precedence to break the tie); ZERO -> refuse BY
// NAME through the error-object idiom, so a recipe naming a bridge that does not exist is routed
// through run's callback rather than crashing. searchDirs is injectable so the suite proves all
// three outcomes against temp fixture dirs (no forge tree, no container).
const resolveBridgePlugin = ({ bridge, source, searchDirs } = {}) => {
	const dirs = searchDirs || bridgeSearchPath({ source });
	const matches = dirs
		.filter((oneDir) => fs.existsSync(oneDir))
		.map((oneDir) => path.join(oneDir, `${bridge}.js`))
		.filter((oneFile) => fs.existsSync(oneFile));

	if (matches.length > 1) {
		throw new Error(
			`bridgeMaker: bridge '${bridge}' resolves in ${matches.length} directories: ${matches.join(', ')}. ` +
				`A bridge name must be unique across the search path (standard-local, forges-shared, library); ` +
				`there is no precedence, and nothing was chosen for you.`,
		);
	}
	if (matches.length === 0) {
		return {
			error:
				`bridgeMaker: bridge '${bridge}' resolves to no bridge file — searched: ${dirs.join(', ')}. ` +
				`A bridge naming no file is a recipe error; there is no default generic fallthrough, and ` +
				`nothing was substituted for it.`,
		};
	}
	// resolvedPath is returned alongside the factory (not just required and discarded) because the
	// shape gate's NEGATIVE SUBSTRATE SCAN (bridgeModuleShapeViolation, below) needs the MODULE FILE
	// on disk to read its own source text — `pluginCallable.toString()` alone only sees the inner
	// callable, never a bridge file's top-level helpers or requires.
	return { pluginFactory: require(matches[0]), resolvedPath: matches[0] };
};

// -----
// bridgeModuleShapeViolation — the runtime shape gate for a resolved plugin, against @interface
// BridgeModule (BRIDGE_MODULE_SHAPE). THREE static checks now, the first two the same ones
// test-interfaces applies to the top-level components, the third new (design: close the raw-write
// bypass door):
//   ARITY  — the callable takes ONE named-argument object plus the callback (arity 2). A
//            positional (inGraph, hub, applyLabel) callable has arity 3 and is caught here.
//   argKeys — the callable's own source visibly READS inGraph/hub/applyLabel off its argument
//            object (destructured or accessed). A source-text check: it cannot pass a signature
//            that never mentions a key, which is what drift looks like. It CAN pass for the wrong
//            reason (a named-but-unused key), and this comment does not pretend otherwise.
//   SUBSTRATE — the plugin's MODULE FILE (read fresh off disk at resolvedPath, not just the inner
//            callable's toString()) is scanned for a reference to the raw write substrate: opening
//            neo4j-driver directly, requiring neo4jGraphWriter, or reaching for the credential
//            fields (inGraph.boltUrl / inGraph.password) that a real bridge is handed but is never
//            supposed to touch (every real bridge writes ONLY through the injected
//            relationshipWriter). This is why resolveBridgePlugin now returns resolvedPath instead
//            of discarding it after require() — pluginCallable.toString() alone only sees the inner
//            arrow function; a top-level module helper (or a stray require) never shows up there.
// Types are not checked; result keys are checked AFTER the plugin runs (resultKeysViolation).
const READS_KEY = (functionSource, oneKey) =>
	new RegExp(`[{,]\\s*${oneKey}\\s*[,:=}]`).test(functionSource) ||
	new RegExp(`\\.${oneKey}\\b`).test(functionSource);

// FORBIDDEN_SUBSTRATE_PATTERNS — the negative scan's vocabulary, as DATA (one entry per bypass
// shape), not as scattered inline regexes. Each pattern targets an actual USE, not a bare word
// occurrence, precisely so a comment merely mentioning the substrate does not trip the gate (the
// three real bridges — ctdlAuthoredBridge, ctdlFamilyStructure, semanticBridge — were read and
// checked: none references any of these; genericBridge likewise clean):
//   - a literal require('neo4j-driver') call — the plugin opening its own driver
//   - a require(...) whose argument names neo4jGraphWriter — reaching for P0's writer module directly
//   - a `.boltUrl` / `.password` property access — the two credential fields the GraphHandle carries
//     (see interfaces.js @typedef GraphHandle). Matched bare (not qualified to `inGraph.`) so a
//     plugin that destructures or renames inGraph first (`const g = inGraph; g.boltUrl`) is still
//     caught — the credential field name itself is the tell, not the variable holding it.
const FORBIDDEN_SUBSTRATE_PATTERNS = [
	{ name: `a direct require('neo4j-driver')`, regex: /require\(\s*['"]neo4j-driver['"]\s*\)/ },
	{ name: 'a direct require of the neo4jGraphWriter module', regex: /require\([^)]*neo4jGraphWriter[^)]*\)/ },
	{ name: 'a .boltUrl property access (the raw connection URL)', regex: /\.boltUrl\b/ },
	{ name: 'a .password property access (the raw graph credential)', regex: /\.password\b/ },
];

// substrateBypassViolation — read resolvedPath fresh (the file may be required-and-cached, but the
// SOURCE TEXT scan wants the bytes, not the module object) and test it against every forbidden
// pattern. Returns the offending pattern's name, or null when clean.
//
// HONESTY (polyArch2 §6 applies to what this claims, not just what it does): this is a STATIC
// heuristic — a source-text regex scan — not a sandbox. It defends against drift and laziness: a
// plugin author who reaches for the raw substrate by the obvious means is refused by name before a
// single edge is written. It does NOT defend against a determined adversary, who could obfuscate a
// dynamic require (e.g. building the module specifier from string concatenation or `global.require`)
// past a text scan entirely. What it buys is real and bounded: bypass must now visibly NAME the
// forbidden substrate in the file bridgeMaker itself reads, where it is a code-review artifact
// forever, rather than being invisible until harvested. "Nothing stops bypass" becomes "bypass must
// out itself" — raising the bar, not sealing the door.
const substrateBypassViolation = (resolvedPath) => {
	if (typeof resolvedPath !== 'string' || resolvedPath.trim() === '') {
		// no file to scan (e.g. an in-closure test double standing in for a plugin with no real file
		// on disk) — the substrate scan simply has nothing to read; it is not silently "passed", it is
		// not APPLICABLE. Real bridges always resolve through resolveBridgePlugin, which always sets
		// resolvedPath, so production runs never take this branch.
		return null;
	}
	let moduleSource;
	try {
		moduleSource = fs.readFileSync(resolvedPath, 'utf8');
	} catch (readError) {
		return `could not read its module file at '${resolvedPath}' to scan for forbidden raw-write-substrate references: ${readError.message}`;
	}
	const hit = FORBIDDEN_SUBSTRATE_PATTERNS.find((onePattern) => onePattern.regex.test(moduleSource));
	return hit
		? `its module file (${resolvedPath}) contains ${hit.name} — a bridge must write through the ` +
				`injected relationshipWriter, not open its own connection to the raw write substrate`
		: null;
};

const bridgeModuleShapeViolation = (pluginCallable, bridge, resolvedPath) => {
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
	const unread = BRIDGE_MODULE_SHAPE.argKeys.filter((oneKey) => !READS_KEY(functionSource, oneKey));
	if (unread.length) {
		return (
			`bridge '${bridge}' has a drifted SHAPE: its callable never reads declared argument ` +
			`key(s) off its argument object: ${unread.join(', ')}`
		);
	}
	const substrateViolation = substrateBypassViolation(resolvedPath);
	if (substrateViolation) {
		return `bridge '${bridge}' is REFUSED: ${substrateViolation}.`;
	}
	return '';
};

const resultKeysViolation = (producedResult, bridge) => {
	if (!producedResult || typeof producedResult !== 'object') {
		return `bridge '${bridge}' produced ${typeof producedResult}, not a status object`;
	}
	const absent = BRIDGE_MODULE_SHAPE.resultKeys.filter((oneKey) => producedResult[oneKey] === undefined);
	return absent.length
		? `bridge '${bridge}' returned a status missing declared key(s): ${absent.join(', ')}`
		: '';
};

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({
		bridgePluginResolver = resolveBridgePlugin,
		graphWriterFactory = neo4jGraphWriter,
		graphReaderFactory = neo4jGraphReader,
	} = {}) => {
		const run = (
			{
				inGraph,
				bridge,
				source = null,
				hub = null,
				applyLabel,
				// P3a INFERRED inputs (all optional; the authored/generic plugins ignore them). rebridge is
				// the pair-scoped boolean build.js sets when this pair is in the --rebridge scope (§5.5); a
				// falsy rebridge means MATERIALIZE from an existing frozen block. decisionStore is where a
				// frozen decision block is read (plain build) and written (--rebridge). inferenceConfig
				// ({ llmClient, topK, cosineFloor, concurrency }) is what the semantic producer hands the
				// pipeline — the suite passes a STUB llmClient so the run is hermetic. config carries the
				// producer's own operational data (sourceStandard, resolved versions).
				rebridge = null,
				decisionStore = null,
				inferenceConfig = {},
				config = {},
				// the NET seam — the suite passes { vectorizer: fakeFactory } so the semantic producer's
				// rebridge path runs with fixture vectors and no Voyage call (§3 hard line 2).
				componentOverrides = {},
			},
			callback,
		) => {
			// ARGUMENT REFUSALS — every required argument is stated or the run does not start
			// (polyArch2 §6). None is guessed.
			if (!inGraph) {
				callback(
					`bridgeMaker: inGraph is not given. It is the materialized dependency GraphHandle the ` +
						`bridge writes into; there is no default.`,
				);
				return;
			}
			if (typeof bridge !== 'string' || bridge.trim() === '') {
				callback(
					`bridgeMaker: bridge is ${
						bridge === undefined ? 'not named' : JSON.stringify(bridge)
					}. It is the name that resolves the bridge file; there is no default.`,
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

			// RESOLVE the plugin — refuse an unresolvable bridge by name (zero match) and fail loudly on
			// an ambiguous one (more than one match), before any graph writer is minted so a bad bridge
			// costs no connection. The resolver THROWS on ambiguity (a tree defect); that throw is
			// translated into the callback channel here — not control flow, the throw IS the §6 refusal,
			// caught only so run() honours its callback contract instead of escaping it.
			let resolved;
			try {
				resolved = bridgePluginResolver({ bridge, source });
			} catch (ambiguityError) {
				callback(ambiguityError.message);
				return;
			}
			if (resolved.error) {
				callback(resolved.error);
				return;
			}

			// MINT the write substrate from the handle, build the library over it, COMPOSE the plugin. The
			// graphReader FACTORY is injected too (P2): an authored producer mints+closes its own reader to
			// WALK the dependency graph. The suite injects a reader double, so the producer's read path is
			// proven without a container (§3 hard line 2), exactly as the writer double proves the write path.
			const graphWriter = graphWriterFactory({ inGraph });
			const componentLibrary = buildComponentLibrary({
				graphWriter,
				graphReader: graphReaderFactory,
				decisionStore,
				rebridge,
				inferenceConfig,
				config,
				componentOverrides,
			});

			let pluginCallable;
			try {
				pluginCallable = resolved.pluginFactory(componentLibrary);
			} catch (composeError) {
				callback(`bridgeMaker: composing bridge plugin for bridge '${bridge}': ${composeError.message}`);
				return;
			}

			// THE SHAPE GATE — refuse a drifted plugin BY NAME before it runs against the graph.
			// resolved.resolvedPath (set by resolveBridgePlugin) is threaded through so the gate can also
			// scan the plugin's MODULE FILE for a raw-write-substrate reference (see
			// bridgeModuleShapeViolation / substrateBypassViolation above); a resolver double with no
			// real file on disk simply leaves resolvedPath undefined and that half of the gate no-ops.
			const shapeViolation = bridgeModuleShapeViolation(pluginCallable, bridge, resolved.resolvedPath);
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
					next(err ? `bridge '${bridge}' failed: ${err}` : '', { ...args, pluginResult });
				});
			});

			// HOLD the plugin's result to the declared result keys (the post-run half of the gate).
			taskList.push((args, next) => {
				const resultViolation = resultKeysViolation(args.pluginResult, bridge);
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
						callback(`bridgeMaker: bridge '${bridge}' wrote its edges but the graph writer ` +
							`failed to close: ${closeError}`);
						return;
					}
					const pluginResult = args.pluginResult || {};
					// MULTI-BLOCK PASS-THROUGH (contract change 2026-07-26). A bridge invocation may emit MORE THAN
					// ONE pair-scoped block: a coordinating producer (ctdlFamilyStructure) writes each pairing's
					// edges under its OWN distinct applyLabel and returns them in `blocks[]`. bridgeMaker forwards
					// that array UNCHANGED so build.js Phase C can harvest EACH into its own version-keyed block.
					// A single-block mapping bridge (ctdlAuthoredBridge, semanticBridge) returns NO `blocks`; the
					// key is simply absent here, and build.js synthesizes the degenerate list-of-one from the
					// top-level status. `producer` is likewise forwarded when the producer declared it.
					callback('', {
						inGraph,
						bridge,
						applyLabel,
						edgesWritten: pluginResult.edgesWritten,
						decisionBlock: pluginResult.decisionBlock === undefined ? null : pluginResult.decisionBlock,
						counts: pluginResult.counts,
						producer: pluginResult.producer,
						blocks: pluginResult.blocks,
						note: `bridge '${bridge}' wrote ${pluginResult.edgesWritten} edge(s)` +
							(Array.isArray(pluginResult.blocks) && pluginResult.blocks.length > 1
								? ` across ${pluginResult.blocks.length} pair-scoped block(s)`
								: ` labeled '${applyLabel}'`),
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
module.exports.bridgeSearchPath = bridgeSearchPath;
module.exports.bridgeModuleShapeViolation = bridgeModuleShapeViolation;
module.exports.DEFAULT_GENERIC_BRIDGE = DEFAULT_GENERIC_BRIDGE;
// buildKit — bridgeMaker CAN load/instantiate the lib.d kit (Phase 1, design §4.1). Additive: run()
// above is unchanged and does not call this. A Phase-2 bridge composes it directly.
module.exports.buildKit = buildKit;
