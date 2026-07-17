#!/usr/bin/env node
'use strict';

// pilotPhase4-closure-probe — one validateManifestClosure call in an ISOLATED
// process (Phase 4, forgeArchitectureRefactor). Full-golden closure deserializes
// every member block text (~206MB across 35 members; the 66MB CEDS reference
// block alone) and peaks 4-6GB of V8 heap PER CALL — two calls in one process
// exceed even an 8GB heap (observed OOM, 2026-07-17). Subprocess isolation
// bounds the peak: one call, print the verdict JSON, exit.
//
// Usage: node --max-old-space-size=8192 pilotPhase4-closure-probe.js \
//          --db=<storePath> --manifest=<manifestKey>
// Output (stdout): {"wellFormed":bool,"violations":[...]}

const path = require('path');

process.global = {
	xLog: { status: () => {}, error: (...a) => console.error(...a), result: () => {}, verbose: () => {} },
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
};

const CORE_LIB = path.join(__dirname, '..', 'npm', 'qtools-graph-forge-core', 'lib');
const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();

const argValue = (name) => {
	const found = process.argv.find((oneArg) => oneArg.startsWith(`--${name}=`));
	return found ? found.slice(name.length + 3) : null;
};

const dbPath = argValue('db');
const manifestKey = argValue('manifest');
if (!dbPath || !manifestKey) {
	console.error('usage: pilotPhase4-closure-probe --db=<storePath> --manifest=<manifestKey>');
	process.exit(2);
}

forgeStore.init({ dbPath }, (initErr) => {
	if (initErr) {
		console.error(`closure-probe init: ${initErr}`);
		process.exit(1);
	}
	forgeStore.validateManifestClosure({ manifestKey }, (err, verdict) => {
		if (err) {
			console.error(`closure-probe: ${err}`);
			process.exit(1);
		}
		console.log(JSON.stringify({ wellFormed: verdict.wellFormed, violations: verdict.violations || [] }));
		process.exit(0);
	});
});
