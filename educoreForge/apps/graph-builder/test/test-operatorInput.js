#!/usr/bin/env node
'use strict';

// test-operatorInput.js — gates for Build 2 of the 2026-11-21 deep review (F-2 and its siblings, F-38).
//
// Every case spawns the REAL graphBuilder exactly as an operator or a script would. The actions used are
// chosen so a case can never write anything: -spendLedger (reads a ledger; every case names a SCRATCH
// ledger, or is refused before any ledger is opened), -deps (reads the forge tree) and -validate (reads a
// recipe). A case that would fall through to the configured store of record is exactly the bug, so the
// cases are written to be refused before that point on the fixed code, and to stop harmlessly on the old.
//
// The stdin-hang cases need a pipe that stays OPEN, which spawnSync cannot give (it closes stdin after
// writing its input), so they run last, asynchronously, and the report is printed when they finish.
//
// Run: node apps/graph-builder/test/test-operatorInput.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const helpText = () => `
NAME
     ${moduleName} -- gates for graphBuilder's operator input: blank, bare and repeated flags,
     the stdin envelope's members, unknown and doubled actions, the open-stdin hang, and the
     action registry against the help

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const treeRoot = path.join(__dirname, '..', '..', '..');
const executable = path.join(treeRoot, 'apps', 'graph-builder', 'graphBuilder.js');
const goodRecipePath = path.join(treeRoot, 'recipes', 'edfiOnly.recipe.jsonc');

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfOperatorInput-'));
const scratchLedgerFilePath = path.join(scratchDir, 'spendLedgerLifetime.jsonl');
fs.writeFileSync(scratchLedgerFilePath, '');

const runCli = (argumentList, stdinText) =>
	spawnSync(process.execPath, [executable, ...argumentList], {
		input: stdinText === undefined ? '' : stdinText,
		encoding: 'utf8',
		cwd: treeRoot,
		timeout: 60000,
	});

const runStdin = (envelope) => runCli([], JSON.stringify(envelope));

const refusedBy = (label, run, regex) => {
	harness.equal(`${label}: exits 1`, run.status, 1);
	harness.match(`  ${label}: refused by name`, run.stderr || '', regex);
	harness.ok(`  ${label}: and prints nothing on stdout (no help, no result)`, (run.stdout || '') === '', (run.stdout || '').slice(0, 160));
};

// =====================================================================
harness.section('CONTROLS — the well-formed forms keep working');
// =====================================================================

const cleanLedgerRun = runCli(['-spendLedger', `--lifetimeLedgerFilePath=${scratchLedgerFilePath}`]);
harness.equal('a well-formed -spendLedger on a scratch ledger exits 0', cleanLedgerRun.status, 0);
harness.match('  and reads the ledger it was given', cleanLedgerRun.stdout || '', new RegExp(scratchLedgerFilePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

const helpRun = runCli(['-help']);
harness.equal('-help exits 0', helpRun.status, 0);
const noArgumentRun = runCli([]);
harness.equal('no arguments at all still print help and exit 0', noArgumentRun.status, 0);
harness.match('  the same help', noArgumentRun.stdout || '', /SYNOPSIS/);

const bareSwitchLastRun = runCli(['-validate', `--recipePath=${goodRecipePath}`, '--useDebugJudge']);
harness.equal('a declared bare-switch flag (--useDebugJudge) as the LAST token is admitted', bareSwitchLastRun.status, 0);

const commaListRun = runCli(['-spendLedger', `--lifetimeLedgerFilePath=${scratchLedgerFilePath}`, '--recipe=a,b']);
harness.equal('a comma list on a NON-path flag is still admitted (the parser splits it; the reader takes it)', commaListRun.status, 0);

// =====================================================================
harness.section('F-2 — a flag typed with a blank value is refused, on the command line');
// =====================================================================

refusedBy('a trailing --lifetimeLedgerFilePath= (the parser makes it true)', runCli(['-spendLedger', '--lifetimeLedgerFilePath=']), /graphBuilder -spendLedger: --lifetimeLedgerFilePath was given but BLANK/);
refusedBy('a blank flag before the ACTION (it would swallow -spendLedger)', runCli(['--lifetimeLedgerFilePath=', '-spendLedger']), /--lifetimeLedgerFilePath was given but BLANK/);
refusedBy('a blank flag before another flag (it would swallow --since)', runCli(['-spendLedger', '--lifetimeLedgerFilePath=', '--since=2999-01-01']), /--lifetimeLedgerFilePath was given but BLANK/);
refusedBy('a blank flag before a positional (it would swallow the recipe path)', runCli(['-validate', '--recipePath=', goodRecipePath]), /--recipePath was given but BLANK/);
refusedBy('a flag typed without = (the space form swallows the next token)', runCli(['-spendLedger', '--lifetimeLedgerFilePath', scratchLedgerFilePath]), /--lifetimeLedgerFilePath was given without '='/);
refusedBy('a declared bare-switch flag that is NOT last (it would swallow the next token)', runCli(['-validate', '--useDebugJudge', `--recipePath=${goodRecipePath}`]), /--useDebugJudge.*LAST/);
refusedBy('a repeated flag (the parser keeps only the last)', runCli(['-spendLedger', `--lifetimeLedgerFilePath=${scratchLedgerFilePath}`, '--since=2000-01-01', '--since=2999-01-01']), /--since was given 2 times/);
refusedBy('a repeated --rebridge (the parser keeps only the last)', runCli(['-validate', `--recipePath=${goodRecipePath}`, '--rebridge=edfi', '--rebridge=ceds']), /--rebridge was given 2 times/);
refusedBy('a switch typed with a value (the parser drops =1)', runCli(['-spendLedger=1', `--lifetimeLedgerFilePath=${scratchLedgerFilePath}`]), /-spendLedger=1.*a switch takes no value/);
refusedBy('a PATH flag carrying a comma (the parser splits it and the first piece was read)', runCli(['-spendLedger', `--lifetimeLedgerFilePath=${scratchLedgerFilePath},second`]), /--lifetimeLedgerFilePath was given 2 values/);
refusedBy('a blank element in a comma list', runCli(['-validate', `--recipePath=${goodRecipePath}`, '--rebridge=edfi,']), /--rebridge was given but BLANK/);

// =====================================================================
harness.section('F-2 siblings — the stdin envelope members are checked, not trusted');
// =====================================================================

refusedBy('a values member that is a STRING (firstValue read its first character)', runStdin({ switches: { spendLedger: true }, values: { lifetimeLedgerFilePath: scratchLedgerFilePath } }), /'values\.lifetimeLedgerFilePath' must be an array of strings, got string/);
refusedBy('a values member that is an EMPTY array (read as absent, config taken)', runStdin({ switches: { spendLedger: true }, values: { lifetimeLedgerFilePath: [] } }), /--lifetimeLedgerFilePath was given with no value/);
refusedBy('a values member holding a BLANK string', runStdin({ switches: { spendLedger: true }, values: { lifetimeLedgerFilePath: [''] } }), /graphBuilder -spendLedger: --lifetimeLedgerFilePath was given but BLANK/);
refusedBy('a values member holding a non-string', runStdin({ switches: { spendLedger: true }, values: { lifetimeLedgerFilePath: [123] } }), /--lifetimeLedgerFilePath carries a number/);
refusedBy("a switch whose value is not true ('false' is a truthy string)", runStdin({ switches: { spendLedger: 'false' }, values: { lifetimeLedgerFilePath: [scratchLedgerFilePath] } }), /switch 'spendLedger' must be true/);
refusedBy('an envelope with parameters but NO action (it used to be help, exit 0)', runStdin({ values: { lifetimeLedgerFilePath: [scratchLedgerFilePath] } }), /names no action/);

// =====================================================================
harness.section('F-2 sibling and F-38 — the action switch: unknown, doubled, none');
// =====================================================================

refusedBy('a misspelled action (-biuld)', runCli(['-biuld']), /unknown switch -biuld/);
refusedBy('two actions at once (the first in ternary order used to win silently)', runCli(['-deps', '-validate', `--recipePath=${goodRecipePath}`]), /more than one action: -deps, -validate/);
refusedBy('parameters with no action on the command line', runCli([`--recipePath=${goodRecipePath}`]), /names no action/);

// =====================================================================
harness.section('F-38 — the action registry is data, and the help agrees with it both ways');
// =====================================================================

const registryFilePath = path.join(__dirname, '..', 'lib', 'graphBuilderActionRegistry.json');
const registryPresent = fs.existsSync(registryFilePath);
harness.ok('the action registry is a data file', registryPresent, registryFilePath);
if (registryPresent) {
	const actionRegistry = JSON.parse(fs.readFileSync(registryFilePath, 'utf8'));
	const actions = require('../lib/actions')();
	const fullHelpText = require('../lib/help')().helpText();
	const actionSwitchNameList = actionRegistry.actionList.map((oneAction) => oneAction.switchName);
	const synopsisActionNameList = (fullHelpText.match(/^\s+graphBuilder\s+-([a-zA-Z]+)/gm) || []).map((oneLine) => oneLine.replace(/^\s+graphBuilder\s+-/, '')).filter((oneName) => !actionRegistry.helpSwitchNameList.includes(oneName));

	harness.equal('every registry action names a function the actions module exports', actionSwitchNameList.filter((oneName) => typeof actions[oneName] !== 'function').join(', '), '');
	harness.equal('every registry action is in the help SYNOPSIS', actionSwitchNameList.filter((oneName) => !synopsisActionNameList.includes(oneName)).join(', '), '');
	harness.equal('every help SYNOPSIS action is in the registry', synopsisActionNameList.filter((oneName) => !actionSwitchNameList.includes(oneName)).join(', '), '');
	harness.equal('every registry action has its own COMMANDS entry in the help', actionSwitchNameList.filter((oneName) => !new RegExp(`^\\s{5}-${oneName}\\b`, 'm').test(fullHelpText)).join(', '), '');
	harness.equal('every declared non-action switch is in the help', actionRegistry.modifierSwitchNameList.concat(actionRegistry.helpSwitchNameList).filter((oneName) => !new RegExp(`(^|\\s)-${oneName}\\b`, 'm').test(fullHelpText)).join(', '), '');
	harness.equal('every declared bare-switch flag is documented as --<name>[=...] in the help', actionRegistry.bareSwitchFlagNameList.filter((oneName) => fullHelpText.indexOf(`--${oneName}[=`) === -1).join(', '), '');
}

// =====================================================================
harness.section('F-2 sibling — the --rebridge scope: unknown bare token, duplicate, blank (build.js, in process)');
// =====================================================================

const buildStatics = require('../lib/build');
const scopeBridgeList = [{ source: 'edfi', hub: 'ceds' }, { source: 'edfi', hub: 'ctdl' }, { source: 'ctdlasn', hub: 'ctdl' }];
const scopeRefusalFor = (rebridgeScope) => buildStatics.rebridgeScopeRefusalFor({ rebridgeScope, bridgeList: scopeBridgeList, hubTokenList: ['ceds', 'ctdl'] });
const scopeFromCommandLine = (rebridgeValueList) => buildStatics.resolveRebridge({ commandLineParameters: { switches: { build: true }, values: { rebridge: rebridgeValueList } } });

harness.equal('every currently valid form is admitted: a bare source, a pair, both, all, none', [['edfi'], ['EdFi'], ['edfi:ctdl'], ['edfi:ctdl', 'ctdlasn'], 'all', []].map((oneScope) => scopeRefusalFor(oneScope)).join('|'), '|||||');
harness.match('a bare token naming no source of the recipe is REFUSED by name (it would rebridge nothing)', scopeRefusalFor(['sif']), /--rebridge token 'sif' names no source of this recipe[\s\S]*\(its sources: ctdlasn, edfi\)/);
harness.match('  including a hub named as if it were a source', scopeRefusalFor(['ceds']), /--rebridge token 'ceds' names no source of this recipe/);
harness.equal('resolveRebridge: the command-line list resolves as before', JSON.stringify((scopeFromCommandLine(['edfi', 'ctdlasn:ctdl']) || {}).value), '["edfi","ctdlasn:ctdl"]');
harness.equal("resolveRebridge: 'all' resolves as before", (scopeFromCommandLine(['all']) || {}).value, 'all');
harness.match('resolveRebridge: a DUPLICATED token is REFUSED by name', (scopeFromCommandLine(['edfi', 'EDFI']) || {}).error || '', /--rebridge names 'edfi' twice/);
harness.match('resolveRebridge: a BLANK element is REFUSED by name, not filtered out', (scopeFromCommandLine(['edfi', ' ']) || {}).error || '', /--rebridge carries a blank token/);
harness.match('resolveRebridge: a bare --rebridge that reached it (the boolean true) is REFUSED by name, not a TypeError', (scopeFromCommandLine(true) || {}).error || '', /--rebridge was given with no value/);
harness.match('resolveRebridge: an injected deps.rebridge with a duplicate is REFUSED the same way', (buildStatics.resolveRebridge({ rebridge: ['edfi', 'edfi'] }) || {}).error || '', /--rebridge names 'edfi' twice/);

// =====================================================================
// THE OPEN-STDIN HANG — asynchronous: spawn with a pipe that is never closed
// =====================================================================

const STDIN_HANG_KILL_MILLISECONDS = 15000;

const runWithOpenStdin = (argumentList, callback) => {
	const startedAt = Date.now();
	const child = spawn(process.execPath, [executable, ...argumentList], { cwd: treeRoot, stdio: ['pipe', 'pipe', 'pipe'] });
	let stdoutText = '';
	let stderrText = '';
	let killedForHanging = false;
	child.stdout.on('data', (chunk) => {
		stdoutText += chunk;
	});
	child.stderr.on('data', (chunk) => {
		stderrText += chunk;
	});
	const killTimer = setTimeout(() => {
		killedForHanging = true;
		child.kill('SIGKILL');
	}, STDIN_HANG_KILL_MILLISECONDS);
	child.on('close', (exitCode) => {
		clearTimeout(killTimer);
		child.stdin.destroy();
		callback({ exitCode, stdoutText, stderrText, killedForHanging, elapsedMilliseconds: Date.now() - startedAt });
	});
};

harness.section('the stdin hang — an open, silent stdin pipe never blocks graphBuilder');

runWithOpenStdin(['-deps'], (depsOutcome) => {
	harness.ok('-deps with an open, silent stdin pipe finishes (was killed for hanging before the fix)', !depsOutcome.killedForHanging, `elapsed ${depsOutcome.elapsedMilliseconds} ms`);
	harness.equal('  and exits 0 with its result', depsOutcome.exitCode, 0);
	harness.match('  the result is the -deps listing (the command line was used)', depsOutcome.stdoutText, /availableForges/);
	harness.match('  and stderr says the silent stdin was set aside', depsOutcome.stderrText, /stdin is an open pipe that sent nothing/);

	runWithOpenStdin([], (bareOutcome) => {
		harness.ok('no arguments with an open, silent stdin pipe finishes', !bareOutcome.killedForHanging, `elapsed ${bareOutcome.elapsedMilliseconds} ms`);
		harness.equal('  and exits 1: there is nothing to do, and a program reading help prose as success is the trap', bareOutcome.exitCode, 1);
		harness.match('  refused by name', bareOutcome.stderrText, /stdin is an open pipe that sent nothing[\s\S]*no command line either/);
		harness.report();
	});
});
