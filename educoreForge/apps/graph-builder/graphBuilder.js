#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// =====================================================================
// graphBuilder — the hands-free recipe runner (educoreForge grand recreation)
// =====================================================================
// Given a recipe, graphBuilder builds the graph it describes ENTIRELY under program
// control and returns { manifestId, boltUrl }. A golden is simply a MAXIMAL recipe —
// graphBuilder builds ANY graph a recipe describes, not only goldens.
//
// This file is the ENTRY POINT and nothing else: resolve parameters, bootstrap the
// process environment, dispatch to an action, report, exit. Every piece of processing
// lives in a module under lib/ —
//
//   lib/help.js       the help text (the control surface IS the contract)
//   lib/startup.js    parameter resolution (CLI or JSON-on-stdin) + process.global
//   lib/actions.js    -build / -validate / -deps, returned as functions to execute
//   lib/recipe.js     load / summarize / validate (Layers 1 and 2)
//   lib/build.js      the phase pipeline over the component modules
//
// graphBuilder is the ONE functional app of this tree. The forger, replayManager,
// bridgeMaker and manifestEditor are IN-PROCESS MODULES of this app, not separate
// programs; thin CLI wrappers that shell out to graphBuilder may follow later.
//
// A fully-qualified qtools module: process.global (xLog, getConfig, commandLineParameters)
// bootstrapped and FROZEN once; qtools-parse-command-line; qtools-x-log; callback style
// (no async/await, no try/catch for control flow); camelCase only.
//
// EXITING IS THIS FILE'S JOB. Actions return { exitCode, resultText } rather than calling
// process.exit themselves — a function that kills the process cannot be tested.
//
// Action flags take a single hyphen (-build); parameters take a double hyphen (--recipePath=).
// =====================================================================

const { helpText } = require('./lib/help')();
const { resolveParameters, bootstrapGlobal } = require('./lib/startup')();
const actions = require('./lib/actions')();

const finish = (xLog) => (err, outcome) => {
	if (err) {
		xLog.error(err);
		process.exit(1);
		return;
	}
	if (outcome.resultText) {
		// xLog.result appends no newline (code fact, qtools-x-log) — the caller owns it.
		xLog.result(`${outcome.resultText}\n`);
	}
	process.exit(outcome.exitCode);
};

const run = () => {
	resolveParameters((err, commandLineParameters) => {
		if (err) {
			console.error(err);
			process.exit(1);
			return;
		}

		const switches = commandLineParameters.switches || {};
		const chosenAction = switches.build
			? actions.build
			: switches.validate
			? actions.validate
			: switches.deps
			? actions.deps
			: switches.replay
			? actions.replay
			: switches.retrievalMetrics
			? actions.retrievalMetrics
			: switches.cedsRoundTrip
			? actions.cedsRoundTrip
			: switches.cedsGates
			? actions.cedsGates
			: null;

		// help is the default: an invocation that names no action is a question, not an error
		if (switches.help || switches.h || !chosenAction) {
			process.stdout.write(`${helpText()}\n`);
			process.exit(0);
			return;
		}

		bootstrapGlobal(commandLineParameters);
		chosenAction(finish(process.global.xLog));
	});
};

run();
