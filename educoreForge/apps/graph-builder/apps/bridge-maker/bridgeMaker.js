'use strict';

/** @implements {BridgeMakerComponent} — formal contract declared in apps/graph-builder/interfaces.js;
 *  enforced by test-interfaces (arity / argKeys statically, resultKeys against the framework's own suite,
 *  BG-REG f). The PLUGIN contract lives in lib/bridge-framework/bridgePluginContract.js. */

// bridgeMaker — THE SEAM FACE of the EDUcore Bridge Framework (SPEC-bridgeFramework-v1.md §3.1, §9, §5.5;
// RULINGS A2, A11, BF8, D-S1, SABLE_RIVER 12:05 #1). It replaces the root-and-branch Phase-3 refuse-only stub
// (tags preDemolition-081526 / preBridgeFramework-081626).
//
//   bridgeMaker() -> { run(spec, callback) }        zero-arg for build.js (build.js `components.bridgeMaker()`)
//
// CONSTRUCTION: builds the discovery registry over forges/<standardKey>/bridges/*.js and validates every plugin
// THEN — BEFORE any forge is spent (build.js constructs the bridgeMaker before Phase A): a stray file, a
// duplicate bridgeName, a standardKey that is not its directory, any declaration/hook drift or a forbidden
// require REFUSES construction by name. Constructs the framework with the REAL reader/writer factories (the two
// bolt files, lib/bridge-framework/graphReader.js + graphWriter.js — named in DOCTRINE.md) and the store-side
// sibling-lookup CONFLICT DETECTOR the seam face HOSTS (conflictDetector.js — the ONE thing that spans two runs).
// A construction argument of ANY name is REFUSED by name (thrown): test injection goes through the FRAMEWORK
// factory only (fixture registry, reader/writer doubles), never the seam face (D-S1).
//
// run(spec, callback): forwards to bridgeFramework.run UNCHANGED (the seam contract build.js Phase C composes —
// { inGraph, bridge, source, hub, applyLabel, rebridge, decisionStore, judgmentCache, matchForensics,
// inferenceConfig, config }) and stringifies the framework's error at the seam (refuse.byName returns an Error;
// every module stringifies at its callback boundary, the seam face once more — RULING BF12). The runReport
// carries EVERY key of interfaces.js resultKeys, INCLUDING blocks[] (ONE block under the PAIR-SCOPED
// applyLabel `<applyLabel>_<SOURCE>_<HUB>`, producer ALWAYS explicit) so build.js never infers a producer.
//
// Control flow: err-string-first callbacks; no async/await; no try/catch (server/CLI rule). No per-standard
// token anywhere in this file (BG-NOSUB / BG-COMPOSE c).

const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const bridgeFrameworkLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'bridge-framework'));
const pluginRegistryLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'pluginRegistry'));
const conflictDetectorLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'conflictDetector'));
const { graphReaderFactory } = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'graphReader'));
const { graphWriterFactory } = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'graphWriter'));

const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(constructionArgs = {}) => {
		// CONSTRUCTION REFUSAL — the seam face honours no injection (D-S1). Naming what was handed in is the
		// whole point: a suite that injects a resolver or writer double here and gets a component that quietly
		// never uses it has proven nothing, and would not know.
		const injectedNames = Object.keys(constructionArgs || {});
		if (injectedNames.length) {
			throw new Error(
				`${moduleName}: construction argument(s) ${injectedNames.join(', ')} are not honoured — the seam face takes NO ` +
					`arguments; test injection goes through the framework factory (lib/bridge-framework/bridge-framework.js deps: ` +
					`graphReaderFactory, graphWriterFactory, pluginRegistry), never the seam face (SPEC §3.1, D-S1).`,
			);
		}

		// the discovery registry — validated at construction, before any forge is spent (SPEC §9)
		const pluginRegistry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH });

		const bridgeFramework = bridgeFrameworkLib({
			graphReaderFactory,
			graphWriterFactory,
			pluginRegistry,
			conflictDetector: conflictDetectorLib.detectSiblingConflicts,
		});

		const run = ({ inGraph, bridge, applyLabel, ...restOfSpec }, callback) => {
			// forwarded UNCHANGED; the framework refuses inGraph / bridge / applyLabel by name for its own reasons
			bridgeFramework.run({ inGraph, bridge, applyLabel, ...restOfSpec }, (runError, runReport) => {
				if (runError) {
					callback(`${moduleName}: ${String(runError)}`);
					return;
				}
				callback('', runReport);
			});
		};

		// describeBridge — FORWARDED UNCHANGED, like run above. The seam face adds nothing to it: it reads a
		// registered plugin's declaration and returns { description } or { error }, touching no graph and
		// spending nothing. build.js calls it BEFORE PHASE A (RULING FJ-P7-1) so a recipe whose bridges would
		// compose one relationship subject is refused before the FORGE spend, not merely before the judge run.
		//
		// It is a SECOND method on this component, so apps/graph-builder/interfaces.js declares it — the
		// METHOD SET checker refuses an undeclared extra by name, and it equally refuses a DECLARED method
		// this face does not expose. Both halves of that pair were observed red before this line existed.
		const describeBridge = ({ bridgeName, source }) => bridgeFramework.describeBridge({ bridgeName, source });

		return { run, describeBridge };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
