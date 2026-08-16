#!/usr/bin/env node
'use strict';

// runToyFingerprint.js — TEST SUPPORT child-process runner for G-ENV: forges the toy in THIS process's
// locale environment (the parent sets LC_ALL) and prints the pure-layer canonical text's sha256 on
// stdout, so two locales can be compared byte for byte. `--twin=localeCompareSort` applies the G-ENV
// twin (a fixture hook sorting a mixed-case list with localeCompare, whose ICU vs code-unit order
// disagree across locales) — PROBED 2026-08-16: Node 24 on macOS resolves ICU's default locale to
// en-US whatever LC_ALL says, so that sort does NOT vary and cannot turn the gate red here (kept as
// a demonstration, not a counting twin). `--twin=readsLocaleEnv` applies the COUNTING twin: a fixture
// hook that stamps process.env.LC_ALL into a name — an environment-dependent pure layer, which the
// two-locale comparison catches.

const path = require('path');
process.global = { xLog: require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'qtools-x-log')) };
Object.freeze(process.global);
process.global.xLog.logToStdOut = process.global.xLog.logToStdOut || (() => {});

const toyScenario = require('./toyScenario');
const fingerprintLib = require(path.join(toyScenario.FRAMEWORK_DIR, 'fingerprint'));

const twinName = (process.argv.find((oneArg) => oneArg.startsWith('--twin=')) || '--twin=').slice('--twin='.length);
const scenario = toyScenario.makeScenario();
if (twinName === 'localeCompareSort') {
	const baseHooks = toyScenario.toyHooksFactory();
	scenario.hookOverrides.emitContractGraph = (context) => {
		const walkResult = baseHooks.emitContractGraph(context);
		// a mixed-case list ICU (en_US) and code-unit (C/POSIX) order disagree on: 'a' vs 'B'
		const orderedNames = ['b', 'A', 'a', 'B'].sort((leftName, rightName) => leftName.localeCompare(rightName));
		context.kit.makeNode({
			role: 'DmeClass',
			perStandardLabel: 'ToyClass',
			stableId: `toy:class/LocaleProbe`,
			name: orderedNames.join(''),
			structural: { parentId: context.kit.rootStableId, path: 'LocaleProbe' },
			origin: 'g-env twin',
		});
		return walkResult;
	};
}
if (twinName === 'readsLocaleEnv') {
	const baseHooks = toyScenario.toyHooksFactory();
	scenario.hookOverrides.emitContractGraph = (context) => {
		const walkResult = baseHooks.emitContractGraph(context);
		context.kit.makeNode({
			role: 'DmeClass',
			perStandardLabel: 'ToyClass',
			stableId: `toy:class/EnvProbe`,
			name: `env ${process.env.LC_ALL}`,
			structural: { parentId: context.kit.rootStableId, path: 'EnvProbe' },
			origin: 'g-env twin',
		});
		return walkResult;
	};
}
toyScenario.runScenario(scenario, (runError, outcome) => {
	if (outcome.forgeError || outcome.injectionError || outcome.thrownFromForge) {
		process.stdout.write(`ERROR ${outcome.forgeError || outcome.injectionError || outcome.thrownFromForge}\n`);
		process.exit(2);
	}
	process.stdout.write(`${fingerprintLib.pureLayerFingerprint({ nodes: outcome.result.nodes, edges: outcome.result.edges })}\n`);
	process.exit(0);
});
