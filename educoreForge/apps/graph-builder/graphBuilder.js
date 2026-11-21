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
//   lib/graphBuilderActionRegistry.json   the actions and switches, as data (the dispatch)
//   lib/operator-input.js  the ONE audit of operator input, both channels, before any action
//   lib/actions.js    the action functions the registry names
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
const actionRegistry = require('./lib/graphBuilderActionRegistry.json');
const operatorInput = require('./lib/operator-input')({ actionRegistry });

// ⟪deep review 2026-11-21, Build 2, F-38⟫ THE DISPATCH IS DATA. lib/graphBuilderActionRegistry.json lists the actions; each
// names a function of the actions module, checked here once at load so a registry row without its function fails at
// the first run of any command rather than on the day someone types it. test-operatorInput.js holds the registry, the
// exports and the help to each other both ways.
const missingActionFunctionList = actionRegistry.actionList.map((oneAction) => oneAction.switchName).filter((switchName) => typeof actions[switchName] !== 'function');
if (missingActionFunctionList.length > 0) {
	throw new Error(`graphBuilder: graphBuilderActionRegistry.json names actions the actions module does not export: ${missingActionFunctionList.join(', ')}`);
}

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

const refuse = (refusalText) => {
	process.stderr.write(`${refusalText}\n`);
	process.exit(1);
};

const run = () => {
	resolveParameters((err, commandLineParameters, inputChannel) => {
		if (err) {
			refuse(err);
			return;
		}

		// help first, and before any config is read: -help and -h always answer, whatever else was typed
		if (operatorInput.helpIsRequested(commandLineParameters.switches)) {
			process.stdout.write(`${helpText()}\n`);
			process.exit(0);
			return;
		}

		// THE ONE AUDIT of operator input, both channels: blank, bare and repeated flags, wrong-shaped stdin members,
		// unknown or doubled switches, parameters with no action. Refused by name, exit 1 (lib/operator-input.js).
		const inputRefusal = operatorInput.operatorInputRefusal({ commandLineParameters, commandLineTokenList: inputChannel.commandLineTokenList });
		if (inputRefusal) {
			refuse(inputRefusal);
			return;
		}

		// an invocation that names nothing at all is a question, not an error: the help, exit 0
		const actionSwitchName = operatorInput.chosenActionSwitchName(commandLineParameters.switches);
		if (!actionSwitchName) {
			process.stdout.write(`${helpText()}\n`);
			process.exit(0);
			return;
		}

		bootstrapGlobal(commandLineParameters);
		actions[actionSwitchName](finish(process.global.xLog));
	});
};

run();
