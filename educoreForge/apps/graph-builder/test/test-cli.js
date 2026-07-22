#!/usr/bin/env node
'use strict';

// test-cli.js — end-to-end gates for the graphBuilder CONTROL SURFACE, run by spawning the real
// executable exactly as a user or a script would. The help text is the design statement, so these
// gates hold the binary to what it advertises: the actions, the two input channels, the output
// channel discipline (results on stdout, progress on stderr), and the EXIT CODES.
//
// Exit codes matter more than they look: they are how a build script learns that a recipe was
// rejected. Every action is proven in both directions -- a success case AND a failure case with
// the specific rejection named.
//
// Also gated here: the -build vs -validate POLICY difference, which is a deliberate decision and
// exactly the sort of thing that erodes silently. -build hard-gates on structural + referential
// only, treating resolvability as a non-blocking note during the stub era; -validate is strict
// about all three.
//
// Run: node apps/graph-builder/test/test-cli.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const path = require('path');
const { spawnSync } = require('child_process');

const helpText = () => `
NAME
     ${moduleName} -- end-to-end gates for the graphBuilder control surface

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Spawns the real graphBuilder executable exactly as a user or a script would, and holds it
     to what its own -help advertises: the actions, both input channels, the output channel
     discipline (results on stdout, progress on stderr), and the EXIT CODES. Also gates the
     deliberate -build vs -validate policy difference, in both directions.

OPTIONS
     -verbose    Show every individual assertion, not just failures and the tally.
     -quiet      Failures and the tally only.
     -help       This message.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const treeRoot = path.join(__dirname, '..', '..', '..');
const executable = path.join(treeRoot, 'apps', 'graph-builder', 'graphBuilder.js');
const fixture = (name) => path.join(__dirname, 'fixtures', `${name}.recipe.jsonc`);
const goodRecipe = (name) => path.join(treeRoot, 'recipes', `${name}.recipe.jsonc`);

// run the real executable. stdinText '' means a non-TTY EMPTY stdin, which the tool must treat
// as "no piped input" and fall back to the command line.
const runCli = (args, stdinText) =>
	spawnSync(process.execPath, [executable, ...args], {
		input: stdinText === undefined ? '' : stdinText,
		encoding: 'utf8',
		cwd: treeRoot,
	});

const parsedStdout = (run) => {
	try {
		return JSON.parse(run.stdout);
	} catch (parseError) {
		return null;
	}
};

// =====================================================================
harness.section('-help — the design statement is reachable and complete');
// =====================================================================

const helpRun = runCli(['-help']);
harness.equal('-help exits 0', helpRun.status, 0);
harness.match('-help documents the synopsis', helpRun.stdout, /SYNOPSIS/);
harness.match('-help documents every action', helpRun.stdout, /-build[\s\S]*-validate[\s\S]*-deps/);
harness.match('-help documents --recipePath', helpRun.stdout, /--recipePath=/);
harness.match('-help documents the JSON-stdin channel', helpRun.stdout, /JSON on stdin/i);

const noArgsRun = runCli([]);
harness.equal('no action prints help rather than failing silently', noArgsRun.status, 0);
harness.match('no action prints the same help', noArgsRun.stdout, /SYNOPSIS/);

// =====================================================================
harness.section('-deps — environment discovery');
// =====================================================================

const depsRun = runCli(['-deps']);
harness.equal('-deps exits 0', depsRun.status, 0);
harness.ok('-deps emits parseable JSON on stdout', parsedStdout(depsRun) !== null, depsRun.stdout);
harness.ok(
	'-deps reports an availableForges array',
	Array.isArray((parsedStdout(depsRun) || {}).availableForges),
	depsRun.stdout,
);
harness.match('-deps stdout ends with a newline', depsRun.stdout, /\}\n$/);

// =====================================================================
harness.section('-validate — STRICT about all three layers');
// =====================================================================

// Since 2026-07-22 the ceds and lif forges are PORTED, so cedsLif resolves fully — strict
// validate passes all three layers. The failure direction moved to bad-unforgedStandard.
const validateGood = runCli(['-validate', '--recipePath=' + goodRecipe('cedsLif')]);
harness.equal('a fully-resolvable recipe passes strict validate (exit 0)', validateGood.status, 0);
harness.ok(
	'  with all three layers reporting PASS',
	((parsedStdout(validateGood) || {}).layers || {}).structural?.ok === true &&
		((parsedStdout(validateGood) || {}).layers || {}).referential?.ok === true &&
		((parsedStdout(validateGood) || {}).layers || {}).resolvability?.ok === true,
	validateGood.stdout,
);

const validateUnforged = runCli(['-validate', '--recipePath=' + fixture('bad-unforgedStandard')]);
harness.equal(
	'a sound recipe naming an UN-FORGED standard fails strict validate (exit 1)',
	validateUnforged.status,
	1,
);
harness.ok(
	'  and says so via the resolvability layer, not by lumping it in elsewhere',
	((parsedStdout(validateUnforged) || {}).layers || {}).resolvability?.ok === false,
	validateUnforged.stdout,
);
harness.ok(
	'  while reporting structural and referential as PASSING',
	((parsedStdout(validateUnforged) || {}).layers || {}).structural?.ok === true &&
		((parsedStdout(validateUnforged) || {}).layers || {}).referential?.ok === true,
	validateUnforged.stdout,
);

const validateMalformed = runCli(['-validate', '--recipePath=' + fixture('bad-malformed')]);
harness.equal('an unparseable recipe exits 1', validateMalformed.status, 1);
harness.ok(
	'  and still emits a machine-readable verdict on stdout',
	(parsedStdout(validateMalformed) || {}).valid === false,
	validateMalformed.stdout,
);
harness.match('-validate stdout ends with a newline', validateGood.stdout, /\}\n$/);

const validateMissingPath = runCli(['-validate']);
harness.equal('-validate without a recipe path exits 1', validateMissingPath.status, 1);
harness.match(
	'  and says which parameter is missing',
	validateMissingPath.stderr,
	/--recipePath/,
);

const validateNoSuchFile = runCli(['-validate', '--recipePath=/no/such/file.jsonc']);
harness.equal('-validate on a nonexistent file exits 1', validateNoSuchFile.status, 1);
harness.match('  and names the missing file', validateNoSuchFile.stderr, /not found/);

// =====================================================================
harness.section('-build — succeeds on a good recipe, with channel discipline');
// =====================================================================

const buildGood = runCli(['-build', '--recipePath=' + goodRecipe('cedsLif')]);
harness.equal('-build exits 0 on a good recipe', buildGood.status, 0);

const buildResult = parsedStdout(buildGood);
harness.ok('-build emits parseable JSON on stdout', buildResult !== null, buildGood.stdout);
harness.ok('  carrying a manifestId', !!(buildResult || {}).manifestId, buildGood.stdout);
harness.ok('  carrying a boltUrl', !!(buildResult || {}).boltUrl, buildGood.stdout);
harness.equal('  reporting 4 members for cedsLif', (buildResult || {}).memberCount, 4);

// qtools-x-log's result() appends NO newline (the caller owns line termination so results stay
// pipe-composable). Every result-bearing action must supply its own, or stdout ends mid-line and
// the next thing written to the terminal runs into it. This was found by fault injection AFTER
// the refactor slipped past every other assertion — hence a gate of its own.
harness.match('-build stdout ends with a newline', buildGood.stdout, /\}\n$/);

harness.match('progress goes to stderr', buildGood.stderr, /\[A\] forge ceds@current/);
harness.ok(
	'stdout carries the RESULT ONLY — no progress chatter (a pipeline could consume it)',
	!/\[A\]|\[C\]|recipe understood/.test(buildGood.stdout),
	buildGood.stdout,
);

const buildMinimal = runCli(['-build', '--recipePath=' + goodRecipe('lifOnly')]);
harness.equal('-build exits 0 on the minimal recipe', buildMinimal.status, 0);
harness.equal('  reporting 1 member', (parsedStdout(buildMinimal) || {}).memberCount, 1);

const buildPositional = runCli(['-build', goodRecipe('lifOnly')]);
harness.equal('the recipe path may be given as a positional', buildPositional.status, 0);
harness.equal(
	'  with the same result as the flag form',
	(parsedStdout(buildPositional) || {}).memberCount,
	1,
);

const buildMissingPath = runCli(['-build']);
harness.equal('-build without a recipe path exits 1', buildMissingPath.status, 1);
harness.match('  and says which parameter is missing', buildMissingPath.stderr, /--recipePath/);

// =====================================================================
harness.section('-build POLICY — what blocks a build and what merely warns');
// =====================================================================
// The deliberate asymmetry. Structural and referential faults STOP the build; an un-ported forge
// does not, so a new-format recipe can flow through the component pipeline before any forge is
// ported. Both halves are gated, because a policy proven in only one direction is not a policy.

const buildStructural = runCli(['-build', '--recipePath=' + fixture('bad-noStandards')]);
harness.equal('a STRUCTURAL fault blocks the build (exit 1)', buildStructural.status, 1);
harness.match('  and the rejection is announced', buildStructural.stderr, /recipe REJECTED/);
harness.match('  naming the structural cause', buildStructural.stderr, /structural:/);

const buildReferential = runCli(['-build', '--recipePath=' + fixture('bad-hubNotInStandards')]);
harness.equal('a REFERENTIAL fault blocks the build (exit 1)', buildReferential.status, 1);
harness.match('  and the rejection is announced', buildReferential.stderr, /recipe REJECTED/);
harness.match('  naming the referential cause', buildReferential.stderr, /referential:/);

const buildUnforged = runCli(['-build', '--recipePath=' + fixture('bad-unforgedStandard')]);
harness.equal(
	'a RESOLVABILITY fault does NOT block the build (exit 0) — the stub-era policy',
	buildUnforged.status,
	0,
);
harness.match(
	'  but is announced as an explicit NOTE rather than passing silently',
	buildUnforged.stderr,
	/NOTE -- 1 standard\(s\) have no forge yet/,
);
harness.match(
	'  and the validation summary reports the layer as FAIL, honestly',
	buildUnforged.stderr,
	/resolvability FAIL/,
);
harness.match(
	'  while reporting the two gating layers as PASS',
	buildUnforged.stderr,
	/structural PASS; referential PASS/,
);
harness.match(
	'a fully-resolvable recipe reports resolvability PASS (both forges discovered)',
	buildGood.stderr,
	/structural PASS; referential PASS; resolvability PASS/,
);
harness.ok(
	'  with NO no-forge NOTE',
	!/have no forge yet/.test(buildGood.stderr),
	buildGood.stderr.split('\n').filter((l) => /NOTE/.test(l)).join(' '),
);

const buildDupPairing = runCli(['-build', '--recipePath=' + fixture('bad-dupPairing')]);
harness.equal('a duplicate pairing blocks the build', buildDupPairing.status, 1);
harness.match('  naming the duplicate', buildDupPairing.stderr, /duplicate bridge pairing/);

// =====================================================================
harness.section('INPUT CHANNELS — JSON on stdin REPLACES the command line');
// =====================================================================

const stdinDeps = runCli([], JSON.stringify({ switches: { deps: true }, values: {}, fileList: [] }));
harness.equal('an action given only on stdin runs (exit 0)', stdinDeps.status, 0);
harness.ok(
	'  and produces that action output',
	Array.isArray((parsedStdout(stdinDeps) || {}).availableForges),
	stdinDeps.stdout,
);

const stdinBuild = runCli(
	['-deps'],
	JSON.stringify({
		switches: { build: true },
		values: { recipePath: [goodRecipe('lifOnly')] },
		fileList: [],
	}),
);
harness.equal('stdin OVERRIDES a conflicting command-line action', stdinBuild.status, 0);
harness.equal(
	'  the stdin action is what ran (build, not deps)',
	(parsedStdout(stdinBuild) || {}).memberCount,
	1,
);

const stdinBadJson = runCli([], '{ not json');
harness.equal('unparseable stdin exits 1', stdinBadJson.status, 1);
harness.match('  naming stdin as the problem', stdinBadJson.stderr, /invalid JSON on stdin/);

const stdinEmpty = runCli(['-deps'], '');
harness.equal(
	'EMPTY non-TTY stdin falls back to the command line rather than hanging or failing',
	stdinEmpty.status,
	0,
);

harness.report();
