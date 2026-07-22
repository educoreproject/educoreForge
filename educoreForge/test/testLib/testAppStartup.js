'use strict';

// testAppStartup.js — the qtools bootstrap every test app shares.
//
//   const commandLineParameters = require('<...>/test/testLib/testAppStartup')({
//       moduleName: 'test-recipe',
//       helpText: helpText(),
//   });
//
// A test suite in this tree is a REAL qtools app, not an exception to the house rules: it parses
// its command line with qtools-parse-command-line, answers -help, logs through qtools-x-log, and
// reports through its exit code. This module is what makes that three lines instead of thirty,
// and what guarantees every suite answers the same flags the same way.
//
// process.global is bootstrapped and FROZEN once, exactly as an app does it, so any module under
// test that reads process.global.xLog gets a real one rather than a test-only stand-in.
//
// NOTE ON xLog (code fact): qtools-x-log is a SINGLETON that reads process.argv at require time.
// A suite therefore honours -verbose / -quiet / -silent / -debug / -noColor on its OWN command
// line, and a parent process that spawns suites must FORWARD those flags to the children — the
// runner does exactly that. Verbose output is diagnostic detail for the person running the tests:
// every individual assertion. The default is section headers, failures, and the tally.
//
// OUTPUT GOES TO STDOUT (xLog.logToStdOut). x-log defaults status/error/verbose to stderr, which
// is right for an app whose real product is something else being piped — progress must not
// pollute the payload. A TEST app is the opposite case: the report IS the product. Sending it to
// stderr would mean `runAllTests > report.txt` captured a tally with no failures beneath it,
// which is the most misleading file we could possibly write. (code fact: logToStdOut flips the
// shared defaultOutputFunction to console.log, so status/error/verbose/emphatic/debug all follow;
// result() always writes to stdout regardless.)

const commandLineParser = require('qtools-parse-command-line');

// the ONE config loader (graphBuilder.ini, host-aware, {} when absent) — shared with the app so
// a module under test reads the SAME configuration it reads in production. Two loaders that can
// disagree about the same fact will eventually disagree.
const { loadConfig } = require('../../apps/graph-builder/lib/startup');

const startTestApp = ({ moduleName, helpText }) => {
	const commandLineParameters = commandLineParser.getParameters({ noFunctions: true });
	const xLog = require('qtools-x-log');
	xLog.logToStdOut();

	if (!process.global) {
		const { getConfig, wholeConfig } = loadConfig();
		process.global = {
			xLog,
			getConfig,
			commandLineParameters,
			rawConfig: wholeConfig,
		};
		Object.freeze(process.global);
	}

	if (commandLineParameters.switches.help || commandLineParameters.switches.h) {
		xLog.result(helpText);
		process.exit(0);
	}

	xLog.verbose(`${moduleName}: starting`);
	return commandLineParameters;
};

module.exports = startTestApp;
