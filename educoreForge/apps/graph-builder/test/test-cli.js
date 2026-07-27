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
// only, treating resolvability as a non-blocking note; -validate is strict about all three.
//
// WHAT THIS SUITE CAN NO LONGER PROVE, AND WHY (2026-07-23). -build used to run to completion
// here, because it ran over stub components. It now drives the REAL forger and replayManager: a
// completed -build provisions Docker containers and spends Voyage credit, and `runAllTests` does
// neither, ever. So the gates below stop at the point where real work would begin -- which is far
// enough to prove the control surface, the exit codes, the policy, and that the pipeline is
// genuinely entered and genuinely wired to the real components (the forger refuses an un-ported
// standard BY NAME, before any docker command). The completed pipeline is proven in
// test-build.js, which injects doubles at the component boundary. The gap is declared out loud
// below rather than left to be discovered.
//
// Run: node apps/graph-builder/test/test-cli.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const fs = require('fs');
const os = require('os');
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
harness.section('FORGE SCAN — "I could not read it" is never "there is nothing there"');
// =====================================================================
// scanAvailableForges answered [] for THREE different facts: a genuinely empty forges/, a
// directory it could not read, and a bundle whose parserDescriptor.ini is malformed. The last one
// is the loud one: the forge-time path (forger.resolveBundle) errors BY NAME on exactly the same
// condition, so the availability answer and the forging answer disagreed about the same file, and
// the operator was told nothing. polyArch2 §6: absent or invalid input is a fault.

const actions = require('../lib/actions')();

const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'educoreForge-forgeScan-'));
const bundleWith = (token, descriptorText, entryFileName) => {
	const bundleDir = path.join(scanDir, token);
	fs.mkdirSync(bundleDir, { recursive: true });
	if (descriptorText !== null) {
		fs.writeFileSync(path.join(bundleDir, 'parserDescriptor.ini'), descriptorText);
	}
	if (entryFileName) {
		fs.writeFileSync(path.join(bundleDir, entryFileName), '// a forge entry module\n');
	}
	return bundleDir;
};

const scanOf = (forgesDir) => {
	let answer;
	try {
		answer = actions.scanAvailableForges({ forgesDir });
	} catch (scanError) {
		answer = { error: `THREW: ${scanError.message}` };
	}
	return answer || {};
};

bundleWith('goodone', '[parserDescriptor]\nentryModule=forgeGoodone.js\n', 'forgeGoodone.js');

harness.equal(
	'a well-formed bundle is available — the positive control',
	(scanOf(scanDir).availableForges || []).join(','),
	'goodone',
);

const malformedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'educoreForge-forgeScanBad-'));
fs.mkdirSync(path.join(malformedDir, 'typoed'), { recursive: true });
fs.writeFileSync(
	path.join(malformedDir, 'typoed', 'parserDescriptor.ini'),
	'[parserDescriptor]\nentryModul=forgeTypoed.js\n',
);
harness.match(
	'a descriptor that declares no entryModule is REFUSED by name, not silently dropped',
	scanOf(malformedDir).error,
	/typoed[\s\S]*parserDescriptor\.ini[\s\S]*entryModule/,
);

const missingEntryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'educoreForge-forgeScanGone-'));
fs.mkdirSync(path.join(missingEntryDir, 'ghost'), { recursive: true });
fs.writeFileSync(
	path.join(missingEntryDir, 'ghost', 'parserDescriptor.ini'),
	'[parserDescriptor]\nentryModule=forgeGhost.js\n',
);
harness.match(
	'a descriptor naming an entryModule that is not on disk is REFUSED, naming the file',
	scanOf(missingEntryDir).error,
	/ghost[\s\S]*forgeGhost\.js/,
);

harness.match(
	'a forges directory that is not there is REFUSED, naming where it looked',
	scanOf(path.join(scanDir, 'noSuchForgesDirectory')).error,
	/noSuchForgesDirectory/,
);

harness.ok(
	'and the real tree still scans clean through the same door',
	Array.isArray(scanOf(path.join(treeRoot, 'forges')).availableForges) &&
		!scanOf(path.join(treeRoot, 'forges')).error,
	JSON.stringify(scanOf(path.join(treeRoot, 'forges'))),
);

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
harness.section('-build — the required parameters, and the pipeline genuinely entered');
// =====================================================================

// A throwaway store OUTSIDE the project. The suite never opens a project database; this proves
// the store injection reaches the pipeline, and it is deleted with the temp directory.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfCliGate-'));
const scratchStore = path.join(scratchDir, `cliGate_${process.pid}.sqlite3`);

const buildMissingPath = runCli(['-build']);
harness.equal('-build without a recipe path exits 1', buildMissingPath.status, 1);
harness.match('  and says which parameter is missing', buildMissingPath.stderr, /--recipePath/);

// The store path is REQUIRED and has no default. This is the 2026-07-17 lesson as a gate: a build
// that does not say where it writes must not be allowed to guess.
const buildNoStore = runCli(['-build', '--recipePath=' + goodRecipe('cedsLif')]);
harness.equal('-build without a standards database exits 1', buildNoStore.status, 1);
harness.match(
	'  naming the missing parameter',
	buildNoStore.stderr,
	/--standardsDatabaseFilePath=<path> is REQUIRED and has no default/,
);
harness.ok(
	'  and nothing is written to stdout, so no caller reads a refusal as a result',
	buildNoStore.stdout === '',
	buildNoStore.stdout,
);
harness.match('-help documents that parameter', helpRun.stdout, /--standardsDatabaseFilePath=/);

// The recipe is still read and summarized before the refusal, so the validation verdict for a
// fully-resolvable recipe is observable without running the pipeline.
harness.match(
	'a fully-resolvable recipe reports all three layers PASS (both forges discovered)',
	buildNoStore.stderr,
	/structural PASS; referential PASS; resolvability PASS/,
);
harness.ok(
	'  with NO no-forge NOTE',
	!/have no forge yet/.test(buildNoStore.stderr),
	buildNoStore.stderr.split('\n').filter((l) => /NOTE/.test(l)).join(' '),
);

// THE PIPELINE IS GENUINELY ENTERED, AND GENUINELY WIRED TO THE REAL COMPONENTS. An un-ported
// standard passes both gating layers, reaches phase A, and is refused BY THE REAL FORGER, by name,
// before any docker command is attempted -- which is why this case can run here at all.
const buildUnforged = runCli([
	'-build',
	'--recipePath=' + fixture('bad-unforgedStandard'),
	'--standardsDatabaseFilePath=' + scratchStore,
]);
harness.equal('a recipe naming an un-forged standard reaches the pipeline and fails', buildUnforged.status, 1);
harness.match(
	'  the REAL forger refuses it by name (not a stub reporting success)',
	buildUnforged.stderr,
	/phase A \(forge\) failed: forge zorg: forger: no forge bundle for standard 'zorg'/,
);
harness.match(
	'  and lists what this tree can actually forge',
	buildUnforged.stderr,
	/Known forges: case, ceds, cip, clr, ctdl, ctdlasn, ctdlqdata, dctap, edfi, eduapi, jedx, lif, medbiquitous, openbadges, pesc, sedm, sif, soc/,
);
harness.ok(
	'  the store was opened, so the injection reached the pipeline',
	fs.existsSync(scratchStore),
	`no database at ${scratchStore}`,
);
// P3b-store WIRING: actions.build() also opens a REAL decisionStore and threads it into the pipeline.
// Its path DEFAULTS to a sibling of the standardsDatabase ('<name>.decisions<ext>'), so a completed
// build's semanticBridge reads/writes frozen decision blocks from a real store from the CLI — no more
// null-injection refusal. The derived db existing after the run is the proof the store was opened and
// threaded, exactly as the scratchStore existence check proves it for the standardsDatabase.
const derivedDecisionStore = path.join(scratchDir, `cliGate_${process.pid}.decisions.sqlite3`);
harness.ok(
	'  the DERIVED decision store was ALSO opened, so a real decisionStore reached the pipeline',
	fs.existsSync(derivedDecisionStore),
	`no decision store at ${derivedDecisionStore}`,
);
harness.ok(
	'stdout carries no progress chatter (a pipeline could consume it)',
	!/\[A\]|\[C\]|recipe understood/.test(buildUnforged.stdout),
	buildUnforged.stdout,
);

// An explicit --decisionStoreFilePath OVERRIDE is honored (the operator names a canonical decisions db).
const overrideDecisionStore = path.join(scratchDir, `cliOverride_${process.pid}.decisions.sqlite3`);
const buildWithOverride = runCli([
	'-build',
	'--recipePath=' + fixture('bad-unforgedStandard'),
	'--standardsDatabaseFilePath=' + scratchStore,
	'--decisionStoreFilePath=' + overrideDecisionStore,
]);
harness.equal('a build with an explicit --decisionStoreFilePath still reaches the forge refusal', buildWithOverride.status, 1);
harness.ok(
	'  and the decision store was opened AT THE OVERRIDE PATH, not the derived sibling',
	fs.existsSync(overrideDecisionStore),
	`no decision store at the override path ${overrideDecisionStore}`,
);

harness.note(
	'DECLARED GAP — a COMPLETED -build is not gated here. It provisions Docker and spends Voyage\n' +
		'credit, and runAllTests does neither. The completed pipeline (result JSON on stdout, the\n' +
		'trailing newline, memberCount, the phase sequence) is gated in test-build.js against\n' +
		'component doubles. What is missing at the CLI level is the channel discipline of a\n' +
		'SUCCESSFUL -build; -deps and -validate carry the same result path and are gated above.',
);

// =====================================================================
harness.section('-build POLICY — what blocks a build and what merely warns');
// =====================================================================
// The deliberate asymmetry. Structural and referential faults STOP the build at the VALIDATION
// gate; an un-ported forge does not -- it is a NOTE, and the recipe proceeds into the pipeline,
// where the forger answers for it. Both halves are gated, because a policy proven in only one
// direction is not a policy. Note what the asymmetry now buys: the refusal comes from the
// component that actually knows, naming the standard, rather than from a validator's guess.

const buildStructural = runCli(['-build', '--recipePath=' + fixture('bad-noStandards')]);
harness.equal('a STRUCTURAL fault blocks the build (exit 1)', buildStructural.status, 1);
harness.match('  and the rejection is announced', buildStructural.stderr, /recipe REJECTED/);
harness.match('  naming the structural cause', buildStructural.stderr, /structural:/);

const buildReferential = runCli(['-build', '--recipePath=' + fixture('bad-hubNotInStandards')]);
harness.equal('a REFERENTIAL fault blocks the build (exit 1)', buildReferential.status, 1);
harness.match('  and the rejection is announced', buildReferential.stderr, /recipe REJECTED/);
harness.match('  naming the referential cause', buildReferential.stderr, /referential:/);

harness.match(
	'a RESOLVABILITY fault does NOT block at the validation gate — it is an explicit NOTE',
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
harness.ok(
	'  so the recipe reaches the pipeline and is refused THERE, not by the validator',
	!/recipe REJECTED/.test(buildUnforged.stderr) && /phase A \(forge\) failed/.test(buildUnforged.stderr),
	buildUnforged.stderr,
);

// The uniqueness key is source::hub::<bridgeName> (design §3a): the SAME bridge named twice on a
// pair is the collision that blocks the build, refused BY NAME (two DIFFERENT bridges on one pair
// are legal now).
const buildDupBridge = runCli(['-build', '--recipePath=' + fixture('bad-dupBridge')]);
harness.equal('the same bridge named twice on a pair blocks the build', buildDupBridge.status, 1);
harness.match('  naming the duplicate bridge', buildDupBridge.stderr, /duplicate bridge 'semanticBridge' for pairing 'lif::ceds'/);

// =====================================================================
harness.section('--vectorize — a real operator off-switch, refused invalid, honored both ways');
// =====================================================================
// build.js used to hardcode vectorize:true with no terminal off-switch (finding #6). It is now a
// documented --vectorize=true|false. These cases spend NOTHING: they use the un-forged-standard
// recipe, which the REAL forger refuses BY NAME before any docker/Voyage — so an INVALID vectorize
// is refused BEFORE phase A (naming the value), while a VALID one is accepted and the run walks on
// to the forge refusal, proving the value was honored rather than rejected for vectorize reasons.

const vectorizeStore = path.join(scratchDir, `cliVectorize_${process.pid}.sqlite3`);
const buildVecArgs = (vectorizeArg) =>
	[
		'-build',
		'--recipePath=' + fixture('bad-unforgedStandard'),
		'--standardsDatabaseFilePath=' + vectorizeStore,
	].concat(vectorizeArg ? [vectorizeArg] : []);

const buildVecInvalid = runCli(buildVecArgs('--vectorize=no'));
harness.equal('--vectorize=no exits 1 (refused, never silently ignored)', buildVecInvalid.status, 1);
harness.match("  naming 'no' as the unrecognized value", buildVecInvalid.stderr, /--vectorize='no'/);
harness.ok(
	'  and refusing BEFORE phase A — the forge is never reached',
	!/phase A \(forge\) failed/.test(buildVecInvalid.stderr),
	buildVecInvalid.stderr,
);

const buildVecFalse = runCli(buildVecArgs('--vectorize=false'));
harness.equal('--vectorize=false is ACCEPTED and the run proceeds (exit 1 at the forge, not the switch)', buildVecFalse.status, 1);
harness.match(
	'  the value was honored — the run walked past it to the real forger',
	buildVecFalse.stderr,
	/phase A \(forge\) failed: forge zorg/,
);
harness.ok(
	'  and NO vectorize complaint appears',
	!/vectorize/.test(buildVecFalse.stderr),
	buildVecFalse.stderr,
);

const buildVecDefault = runCli(buildVecArgs(null));
harness.match(
	'omitting --vectorize applies the documented default and proceeds (no vectorize complaint)',
	buildVecDefault.stderr,
	/phase A \(forge\) failed: forge zorg/,
);
harness.ok(
	'  with no vectorize complaint — the default is silent',
	!/vectorize/.test(buildVecDefault.stderr),
	buildVecDefault.stderr,
);

harness.match('-help documents --vectorize', helpRun.stdout, /--vectorize=true\|false/);
harness.match('  and states the default is true', helpRun.stdout, /DEFAULTS TO true/);

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
// The stdin-supplied -build stops at the required store parameter, which is itself the proof:
// -deps has no such parameter and would have exited 0 with an availableForges listing.
harness.equal('stdin OVERRIDES a conflicting command-line action', stdinBuild.status, 1);
harness.match(
	'  the stdin action is what ran (build, not deps)',
	stdinBuild.stderr,
	/graphBuilder -build: --standardsDatabaseFilePath/,
);
harness.ok(
	'  and the command-line action did NOT run',
	!/availableForges/.test(stdinBuild.stdout),
	stdinBuild.stdout,
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

// =====================================================================
harness.section('INPUT CHANNELS — a parseable-but-wrong-shaped stdin JSON is REFUSED, never help-with-0');
// =====================================================================
// The machine channel exists for PROGRAMS, which cannot notice help prose the way a human can. A
// caller that pipes a FLAT shape ({"build":true,...}, the switches envelope missing) used to have
// its input silently discarded by `parsed.switches || {}`, degrade to "no action", and be treated
// as a help request that EXITS 0 -- so a build script checking the documented exit contract
// believed a graph was built when stdout was help prose. polyArch2 §6: operator-supplied input
// that is present-but-invalid is the WORSE fault, refused by name, never guessed at.

const stdinFlatShape = runCli([], JSON.stringify({ build: true, recipePath: [goodRecipe('lifOnly')] }));
harness.ok(
	'a FLAT JSON lacking the switches envelope exits NONZERO (never help-with-0)',
	stdinFlatShape.status !== 0,
	`status=${stdinFlatShape.status}`,
);
harness.match(
	'  naming the envelope problem rather than silently degrading to help',
	stdinFlatShape.stderr,
	/NONE of the command-envelope keys|not a command envelope/i,
);
harness.ok(
	'  and does NOT print help text as if the action succeeded',
	!/SYNOPSIS/.test(stdinFlatShape.stdout),
	stdinFlatShape.stdout,
);

const stdinArrayRoot = runCli([], JSON.stringify([1, 2, 3]));
harness.ok('a JSON ARRAY root on stdin exits nonzero', stdinArrayRoot.status !== 0, `status=${stdinArrayRoot.status}`);
harness.match('  naming the root as not an envelope object', stdinArrayRoot.stderr, /array|not a command envelope/);

const stdinBadSwitches = runCli([], JSON.stringify({ switches: [1, 2] }));
harness.ok('an envelope whose switches is not an object exits nonzero', stdinBadSwitches.status !== 0, `status=${stdinBadSwitches.status}`);
harness.match("  naming 'switches' as the malformed member", stdinBadSwitches.stderr, /'switches' must be an object/);

harness.report();
