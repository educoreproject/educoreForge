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
// Suites are DISCOVERED by convention, RECURSIVELY: a MODULE is any directory under apps/ that
// carries a package.json (graphBuilder AND its nested in-process components), and a module's
// suites are the test-*.js files in its OWN test/ dir. Discovering suites wherever they live
// serves two ends at once: an app-level suite proves overall correctness, while a suite sitting
// next to a component localizes a failure to that component. A module with a package.json but no
// suite is reported as untested on every full run -- a coverage gap must be visible, never
// silently absent. (Forge bundles under forges/ ARE discovered — their test/ suites run like any
// other; a bundle's end-to-end correctness is additionally proven through graphBuilder building a
// recipe.)
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
     Discovers every suite matching apps/**/test/test-*.js AND lib/**/test/test-*.js
     (recursively, so a suite next to a nested component is found too), runs each in its own
     process, and exits 0 only if every selected suite passed. Modules with no suite at all are
     listed as untested so their absence cannot be mistaken for coverage -- an app module is a
     package.json dir, a lib module is any lib directory holding .js files.

     --app selects among APP modules only and therefore drops every lib suite; that is
     deliberate (you are asking about one app, not about the substrate) and is why -list
     shows fewer suites when it is used.

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

// A MODULE is any directory carrying a package.json. Walk apps/ recursively so both the one
// consolidated graphBuilder app AND its nested in-process components (forger, replay-manager,
// bridge-maker, manifest-editor) are found. A module owns the suites in its OWN test/ dir; its
// behaviour is still gated through graphBuilder (the component seam), but a suite that lives next
// to a component is what turns a red run into "the forger is broken" rather than "something in
// the app is broken." node_modules is never descended into.
const findModuleDirs = (dirPath) => {
	if (!fs.existsSync(dirPath)) {
		return [];
	}
	const here = fs.existsSync(path.join(dirPath, 'package.json')) ? [dirPath] : [];
	const deeper = fs
		.readdirSync(dirPath, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
		.reduce((soFar, entry) => soFar.concat(findModuleDirs(path.join(dirPath, entry.name))), []);
	return here.concat(deeper);
};

const suitesInModule = (moduleDir) => {
	const testDir = path.join(moduleDir, 'test');
	if (!fs.existsSync(testDir)) {
		return [];
	}
	return fs
		.readdirSync(testDir)
		.filter((name) => /^test-.*\.js$/.test(name))
		.sort()
		.map((name) => path.join(testDir, name));
};

// tree-root lib/ is the shared SUBSTRATE, not a set of packages — its directories carry no
// package.json, so findModuleDirs cannot see them. It still holds the most safety-critical code in
// the tree (the replay engine's write path), and a suite that cannot be discovered is a suite that
// silently stops running.
//
// A LIB MODULE is any lib directory holding .js files. Defining it that way — rather than "a
// directory that happens to have a test/ dir" — is what makes DISAPPEARANCE loud: delete
// lib/replay/test/ and lib/replay flips from PASS to NONE instead of vanishing from the report
// while the runner still prints all-green. (Found by adversarial review, 2026-07-22: the first
// version discovered only dirs that already had tests, so removing a suite was silent.) The price
// is an honest list of untested substrate modules, which is a price worth paying.
const findLibModuleDirs = (dirPath) => {
	if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
		return [];
	}
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	const here = entries.some((entry) => entry.isFile() && /\.js$/.test(entry.name))
		? [dirPath]
		: [];
	const deeper = entries
		.filter(
			(entry) => entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'test',
		)
		.reduce(
			(soFar, entry) => soFar.concat(findLibModuleDirs(path.join(dirPath, entry.name))),
			[],
		);
	return here.concat(deeper);
};

const appFilter = firstValue('app');
const suiteFilter = firstValue('suite');

// forges/ IS DISCOVERED TOO. Each forge bundle carries a package.json, so findModuleDirs sees it
// the same way it sees the in-process apps — but the runner used to look only at apps/ and lib/,
// so every forge bundle was invisible to the coverage report: a suite written there would not
// have run, and the ABSENCE of one could not be seen. The forges hold the source-document
// readers, which is where the tree's provenance stamps are decided. (Phase 4, work group 5.)
const forgesDir = path.join(treeRoot, 'forges');

const allModules = findModuleDirs(appsDir).concat(findModuleDirs(forgesDir)).sort();
const libModuleDirs = findLibModuleDirs(path.join(treeRoot, 'lib')).sort();
const selectedModules = appFilter
	? allModules.filter((moduleDir) => path.basename(moduleDir) === appFilter)
	: allModules;

// lib suites join the run unless --app narrowed the selection to one app (then the operator is
// asking about that app, not about the substrate).
const selectedLibDirs = appFilter ? [] : libModuleDirs;

// Untested modules are reported only on a full-coverage run. When --suite narrows the selection
// the operator is asking about one suite, not about coverage, and listing every module without
// tests would be noise pretending to be diligence.
//
// LIB modules are counted here too, which is the whole point of discovering them as modules: a
// lib suite that is deleted turns its module NONE rather than simply ceasing to exist.
const untestedModules = suiteFilter
	? []
	: selectedModules
			.concat(selectedLibDirs)
			.filter((moduleDir) => suitesInModule(moduleDir).length === 0);

const allSuites = selectedModules
	.concat(selectedLibDirs)
	.reduce((soFar, moduleDir) => soFar.concat(suitesInModule(moduleDir)), [])
	.filter((suitePath) => !suiteFilter || path.basename(suitePath).includes(suiteFilter));

const relative = (aPath) => path.relative(treeRoot, aPath);

// =====================================================================
// ACTIONS
// =====================================================================

const doList = () => {
	xLog.status(`${moduleName}: discovered suites`);
	allSuites.forEach((suitePath) => xLog.result(`${relative(suitePath)}\n`));
	untestedModules.forEach((moduleDir) => xLog.status(`  (${relative(moduleDir)} has no test suite)`));
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
	untestedModules.forEach((moduleDir) => {
		xLog.status(`NONE  ${relative(moduleDir)}  -- no test suite yet`);
	});
	xLog.status('='.repeat(70));

	xLog.result(
		`${moduleName}: ${results.length - failed.length}/${results.length} suite(s) passed` +
			(untestedModules.length ? `; ${untestedModules.length} module(s) untested` : '') +
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
