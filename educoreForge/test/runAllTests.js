#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// =====================================================================
// runAllTests — run this tree's test suites and report a single verdict
// =====================================================================
// A real qtools app, not an exception to the house rules: qtools-parse-command-line for its
// control surface, qtools-x-log for output, -help that states what it does, and a meaningful
// exit code. It is the app you run to learn whether the tree is sound.
//
// Suites are DISCOVERED by convention -- apps/<app>/test/test-*.js -- so a new suite is picked
// up the moment it is written and there is no registry to forget. Apps with NO suite are
// reported as such on every run: an untested app must be visible, never silently absent.
//
// Each suite runs as its OWN process, so a suite that crashes outright counts as failed rather
// than taking the runner down with it. Output flags are FORWARDED to the children, because
// qtools-x-log reads the command line of the process it lives in (code fact) -- without
// forwarding, `runAllTests -verbose` would make the runner chatty and leave the suites mute.
//
// Action flags take a single hyphen; parameters take a double hyphen.
// =====================================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const treeRoot = path.join(__dirname, '..');
const appsDir = path.join(treeRoot, 'apps');

// =====================================================================
// HELP TEXT — the control surface IS the contract
// =====================================================================

const helpText = () => `
NAME
     runAllTests -- run the educoreForge tree's test suites and report one verdict

SYNOPSIS
     runAllTests [-list] [--app=<name>] [--suite=<name>] [-verbose] [-quiet] [-help]

DESCRIPTION
     Discovers every suite matching apps/<app>/test/test-*.js, runs each in its own process,
     and exits 0 only if every selected suite passed. Apps with no suite at all are listed as
     untested so their absence cannot be mistaken for coverage.

     Also available as: npm test

OPTIONS
     -list             List the discovered suites and exit without running anything.
     --app=<name>      Run only the suites belonging to that app (e.g. --app=graph-builder).
     --suite=<name>    Run only suites whose filename contains this (e.g. --suite=recipe).
     -verbose          Show every individual assertion, not just failures and tallies.
                       Forwarded to each suite.
     -quiet            Suppress progress; show failures and tallies only. Forwarded.
     -noColor          Disable colored output. Forwarded.
     -help             This message.

OUTPUT
     Everything on stdout -- progress, suite output, failures and the final verdict. A test
     app's report IS its product, so all of it survives redirection to a file.

EXIT STATUS
     0    every selected suite passed
     1    at least one suite failed, or no suite matched the selection
`;

// =====================================================================
// STARTUP — qtools bootstrap (process.global frozen once), then -help
// =====================================================================

const commandLineParameters = require('./testLib/testAppStartup')({
	moduleName,
	helpText: helpText(),
});

const { xLog } = process.global;

const firstValue = (name) => (commandLineParameters.values[name] || [])[0];

// =====================================================================
// DISCOVERY
// =====================================================================

const listDirectories = (dirPath) => {
	if (!fs.existsSync(dirPath)) {
		return [];
	}
	return fs
		.readdirSync(dirPath, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
};

const suitesForApp = (appName) => {
	const testDir = path.join(appsDir, appName, 'test');
	if (!fs.existsSync(testDir)) {
		return [];
	}
	return fs
		.readdirSync(testDir)
		.filter((name) => /^test-.*\.js$/.test(name))
		.sort()
		.map((name) => path.join(testDir, name));
};

const apps = listDirectories(appsDir);
const appFilter = firstValue('app');
const suiteFilter = firstValue('suite');

const selectedApps = appFilter ? apps.filter((name) => name === appFilter) : apps;

// Untested apps are reported only on a full-coverage run. When --suite narrows the selection the
// operator is asking about one suite, not about coverage, and listing every app without tests
// would be noise pretending to be diligence.
const untestedApps = suiteFilter
	? []
	: selectedApps.filter((appName) => suitesForApp(appName).length === 0);

const allSuites = selectedApps
	.reduce((soFar, appName) => soFar.concat(suitesForApp(appName)), [])
	.filter((suitePath) => !suiteFilter || path.basename(suitePath).includes(suiteFilter));

const relative = (suitePath) => path.relative(treeRoot, suitePath);

// =====================================================================
// ACTIONS
// =====================================================================

const doList = () => {
	xLog.status(`${moduleName}: discovered suites`);
	allSuites.forEach((suitePath) => xLog.result(`${relative(suitePath)}\n`));
	untestedApps.forEach((appName) => xLog.status(`  (apps/${appName} has no test suite)`));
	process.exit(0);
};

// the output flags qtools-x-log honours, forwarded so a child logs the way the parent was asked to
const forwardedFlags = () =>
	['verbose', 'quiet', 'silent', 'debug', 'noColor'].filter(
		(name) => commandLineParameters.switches[name],
	).map((name) => `-${name}`);

const doRun = () => {
	if (!allSuites.length) {
		xLog.error(
			`${moduleName}: no test suites matched` +
				(appFilter || suiteFilter ? ' the given selection' : ' apps/*/test/test-*.js'),
		);
		process.exit(1);
	}

	xLog.status(`${moduleName}: ${allSuites.length} suite(s)\n`);

	const childArgs = forwardedFlags();
	const results = allSuites.map((suitePath) => {
		const run = spawnSync(process.execPath, [suitePath, ...childArgs], {
			encoding: 'utf8',
			cwd: treeRoot,
			stdio: 'inherit',
		});
		return { label: relative(suitePath), ok: run.status === 0, status: run.status };
	});

	const failed = results.filter((r) => !r.ok);

	xLog.status('='.repeat(70));
	results.forEach((r) => {
		const line = `${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.ok ? '' : `  (exit ${r.status})`}`;
		if (r.ok) {
			xLog.status(line);
		} else {
			xLog.error(line);
		}
	});
	untestedApps.forEach((appName) => {
		xLog.status(`NONE  apps/${appName}  -- no test suite yet`);
	});
	xLog.status('='.repeat(70));

	xLog.result(
		`${moduleName}: ${results.length - failed.length}/${results.length} suite(s) passed` +
			(untestedApps.length ? `; ${untestedApps.length} app(s) untested` : '') +
			'\n',
	);

	process.exit(failed.length ? 1 : 0);
};

// =====================================================================
// RUN
// =====================================================================

if (commandLineParameters.switches.list) {
	doList();
} else {
	doRun();
}
