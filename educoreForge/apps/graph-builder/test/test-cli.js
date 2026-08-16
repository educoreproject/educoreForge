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

// sqliteTableNames — the table names in a database file, read with better-sqlite3 (the same engine
// sqlite-instance uses). Under the single-file ruling a store's CONTENTS are what proves a family was
// wired in, where a separate file used to be; so the suite needs to look inside one.
// A file that cannot be opened returns [], which the assertions report as the tables they did not find
// rather than as a pass.
const sqliteTableNames = (databaseFilePath) => {
	if (!fs.existsSync(databaseFilePath)) {
		return [];
	}
	const Database = require('better-sqlite3');
	const oneConnection = new Database(databaseFilePath, { readonly: true });
	const rows = oneConnection
		.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`)
		.all();
	oneConnection.close();
	return rows.map((oneRow) => oneRow.name);
};

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

// Since Phase 3 of the root-and-branch reset (2026-08-15) the survival set is ceds/edfi/sif/pesc260805
// with the CEDS hub and NO bridge, so fourWithHub-baseline (hub, no bridge; validated PASS in
// Phase 1) is the fully-resolvable recipe — strict validate passes all three layers. The failure
// direction is bad-unforgedStandard.
const validateGood = runCli(['-validate', '--recipePath=' + goodRecipe('fourWithHub-baseline')]);
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

// The store path is REQUIRED and has no default. This is the 2026-07-17 lesson as a gate: a build that
// does not say where it writes must not be allowed to guess.
//
// ⟪Round-Trip Perfection Phase 1, 2026-08-04⟫ WHAT CHANGED, AND WHAT DID NOT. The path may now come
// from [stores] graphBuilderSupportFilePath, so OMITTING the flag is no longer the way to observe the
// refusal from a CLI that discovers the real graphBuilder.ini — the configured key answers, which is
// the phase's whole point (gate 1, asserted below). The refusal itself is UNCHANGED and is observed
// here through a BLANK flag, which is the stronger case anyway: present-but-empty operator input is
// polyArch2 §6's worse fault, because someone tried to name a path and it did not arrive.
// The absent-config-key refusal — the case a CLI with a populated ini cannot reach — is the red twin in
// test-actions-supportStore.js, which drives resolveSupportStoreFilePath directly.
// THE BLANK IS SENT ON STDIN, NOT AS A COMMAND-LINE FLAG, and that is a finding rather than a style
// choice. qtools-parse-command-line CANNOT PRODUCE an empty-string value from `--flag=` (observed, this
// suite's sibling probe): a trailing `--flag=` parses to the BOOLEAN true, and a `--flag=` followed by
// anything CONSUMES THE NEXT ARGUMENT as its value — so `--alpha= --beta=bee` yields
// alpha=['--beta=bee'] and drops --beta entirely. firstValue() reads the boolean form as ABSENT, so a
// command-line `--standardsDatabaseFilePath=` looks like no flag at all and resolves from config.
// The JSON-on-stdin channel carries literal strings, so it is the only channel that can express "the
// operator named a blank", which is the case being gated. (The same is true of the pre-existing blank
// refusals in resolvePersistencePath and decisionStorePathFrom — reachable via stdin, not via argv.)
const buildBlankStore = runCli(
	[],
	JSON.stringify({
		switches: { build: true },
		values: { recipePath: [goodRecipe('edfiOnly')], standardsDatabaseFilePath: [''] },
		fileList: [],
	}),
);
harness.equal('-build with a BLANK standards database path exits 1', buildBlankStore.status, 1);
harness.match(
	'  naming the blank parameter, and refusing rather than falling back to the configured path',
	buildBlankStore.stderr,
	/--standardsDatabaseFilePath was given but BLANK/,
);
harness.ok(
	'  and nothing is written to stdout, so no caller reads a refusal as a result',
	buildBlankStore.stdout === '',
	buildBlankStore.stdout,
);
harness.match('-help documents that parameter', helpRun.stdout, /--standardsDatabaseFilePath=/);

// keep the old variable name alive for the validation-verdict assertions below: they only ever needed
// a run that printed its recipe verdict and then refused BEFORE provisioning anything.
const buildNoStore = buildBlankStore;

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
// ⟪P9⟫ every -build in this suite OVERRIDES the judgment-cache/forensics paths into the scratch
// directory: their documented defaults are the CANONICAL dataStores homes (default ON is the whole
// point in production), and a hermetic suite must never write into the shared production stores.
const scratchJudgmentCache = path.join(scratchDir, `cliGate_${process.pid}.judgments.sqlite3`);
const scratchForensicsDir = path.join(scratchDir, 'matchForensics');
const p9ScratchArgs = [
	'--judgmentCacheFilePath=' + scratchJudgmentCache,
	'--matchForensicsDirPath=' + scratchForensicsDir,
];

const buildUnforged = runCli([
	'-build',
	'--recipePath=' + fixture('bad-unforgedStandard'),
	'--standardsDatabaseFilePath=' + scratchStore,
	...p9ScratchArgs,
]);
harness.equal('a recipe naming an un-forged standard reaches the pipeline and fails', buildUnforged.status, 1);
harness.match(
	'  the REAL forger refuses it by name (not a stub reporting success)',
	buildUnforged.stderr,
	/phase A \(forge\) failed: forge zorg: forger: no forge bundle for standard 'zorg'/,
);
// DERIVED FROM THE TREE, NEVER RESTATED. This assertion used to carry a hardcoded list of eighteen
// forge tokens, so adding the pesc260805 forge — a correct and routine act — broke an assertion about
// ERROR-MESSAGE FORMATTING, which is the only thing it is actually here to prove. The list now comes
// from the same forge scan the forger itself consults, so a new forge can never break it again while
// the assertion keeps proving that the refusal names what IS available. (Fixed 2026-08-10; the
// hardcoded form had been failing at 18-vs-19 tokens.)
const knownForgeTokens = (scanOf(path.join(treeRoot, 'forges')).availableForges || []).join(', ');
harness.ok(
	`  and lists what this tree can actually forge (derived: ${
		(scanOf(path.join(treeRoot, 'forges')).availableForges || []).length
	} forges)`,
	knownForgeTokens.length > 0 && buildUnforged.stderr.indexOf(`Known forges: ${knownForgeTokens}`) !== -1,
	`expected 'Known forges: ${knownForgeTokens}' in stderr:\n${buildUnforged.stderr}`,
);
harness.ok(
	'  the store was opened, so the injection reached the pipeline',
	fs.existsSync(scratchStore),
	`no database at ${scratchStore}`,
);
// P3b-store WIRING: actions.build() also opens a REAL decisionStore and threads it into the pipeline,
// so a completed build's semanticBridge reads/writes frozen decision blocks from a real store from the
// CLI — no more null-injection refusal.
//
// ⟪Round-Trip Perfection Phase 1, 2026-08-04⟫ Its path no longer DERIVES a sibling
// '<name>.decisions<ext>'; under TQ's single-file ruling the decision blocks live in the SAME file as
// everything else. So the proof changes shape: instead of a second database existing, the ONE database
// must carry the decision-store's own table. Asserting the sibling is ABSENT matters as much as
// asserting decisionBlocks is present — if the derivation came back, the store would silently split in
// two and every frozen decision block would land somewhere the configured path does not describe.
const retiredSiblingDecisionStore = path.join(scratchDir, `cliGate_${process.pid}.decisions.sqlite3`);
harness.ok(
	'  NO sibling decision database was created — the single-file ruling holds',
	!fs.existsSync(retiredSiblingDecisionStore),
	`a sibling decision store reappeared at ${retiredSiblingDecisionStore}`,
);
harness.match(
	'  and the decision store reported the SAME path as the support store',
	buildUnforged.stderr,
	new RegExp(`decision store at ${scratchStore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
);
harness.ok(
	'  the support store carries decisionBlocks, so a real decisionStore reached the pipeline',
	sqliteTableNames(scratchStore).includes('decisionBlocks'),
	`tables present: ${sqliteTableNames(scratchStore).join(', ')}`,
);

// =====================================================================
// ⟪Round-Trip Perfection Phase 1⟫ GATE 1 — A BUILD RESOLVES ITS STORE FROM CONFIG ALONE
// =====================================================================
// No --standardsDatabaseFilePath anywhere on the command line: the path must come from
// [stores] graphBuilderSupportFilePath in the discovered graphBuilder.ini, and the run must SAY so, so
// an operator can tell which of the two channels answered.
//
// STAYING HERMETIC WHILE RESOLVING THE REAL CONFIG — the awkward part, and worth stating plainly.
// The configured path IS the live 2.4GB production support store, and a hermetic suite must never open
// it, let alone write to it. But the resolution must be observed through the real discovery path or the
// gate proves nothing about the wiring.
//
// The seam: actions.build resolves the support store and LOGS it (actions.js:417-428), and only opens it
// much later (actions.js:512). Between the two sits the judgment-cache path resolution, which refuses a
// BLANK --judgmentCacheFilePath by name (actions.js:465). So a deliberately blank judgment-cache path
// stops the run in that gap — after the real configured path has been resolved and reported, before any
// connection to it is made. Nothing is opened, nothing is written, and the resolution is still the
// genuine one from the discovered graphBuilder.ini.
//
// It also asserts the OLD refusal is GONE. A gate that only checked the new behavior arrived would still
// pass if the retired refusal had survived alongside it and fired first.
// The blank judgment-cache path likewise has to travel by stdin — see the parser note above; a
// command-line `--judgmentCacheFilePath=` would parse to the boolean true and read as absent, taking
// the documented default instead of refusing.
const buildFromConfig = runCli(
	[],
	JSON.stringify({
		switches: { build: true },
		values: { recipePath: [goodRecipe('edfiOnly')], judgmentCacheFilePath: [''] },
		fileList: [],
	}),
);
harness.equal('GATE 1 — the config-resolving run stops in the intended gap', buildFromConfig.status, 1);
harness.match(
	'  with NO store flag, -build resolves the support store FROM CONFIG and says so',
	buildFromConfig.stderr,
	/graphBuilder: support store at \S+ \(resolved from config\)/,
);
harness.match(
	'  and it stopped on the BLANK judgment cache path, before the support store was ever opened',
	buildFromConfig.stderr,
	/--judgmentCacheFilePath was given but blank/,
);
harness.ok(
	'  the retired "REQUIRED and has no default" refusal did NOT fire',
	!/--standardsDatabaseFilePath=<path> is REQUIRED and has no default/.test(buildFromConfig.stderr),
	buildFromConfig.stderr.split('\n').filter((oneLine) => /REQUIRED/.test(oneLine)).join(' | '),
);
harness.match(
	'  the resolved path is the one graphBuilder.ini names',
	buildFromConfig.stderr,
	/support store at .*graphBuilderSupport\.sqlite/,
);
// ⟪P9⟫ WIRING: actions.build() also opens the judgment cache (decided = persisted) and threads it
// into the pipeline — the db existing at the OVERRIDE path is the same proof the decisionStore
// check above makes, for the P9 store.
harness.ok(
	'  the JUDGMENT CACHE was opened at its override path, so the P9 checkpoint store reached the pipeline',
	fs.existsSync(scratchJudgmentCache),
	`no judgment cache at ${scratchJudgmentCache}`,
);
harness.match('  and the run announced it', buildUnforged.stderr, /judgment cache at .*cliGate_.*\.judgments\.sqlite3/);
harness.match('  and announced the forensic match log too', buildUnforged.stderr, /forensic match log at /);

// ⟪P9⟫ the '=false' DISABLE path: both stores off, the run still proceeds to the forge refusal.
const buildP9Disabled = runCli([
	'-build',
	'--recipePath=' + fixture('bad-unforgedStandard'),
	'--standardsDatabaseFilePath=' + scratchStore,
	'--judgmentCacheFilePath=false',
	'--matchForensicsDirPath=false',
]);
harness.equal("--judgmentCacheFilePath=false / --matchForensicsDirPath=false still reach the forge refusal (disable is a mode, not a fault)", buildP9Disabled.status, 1);
harness.match('  and the run says the judgment cache is DISABLED', buildP9Disabled.stderr, /judgment cache DISABLED/);
harness.match('  and the forensic log is DISABLED', buildP9Disabled.stderr, /forensic match log DISABLED/);
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
	...p9ScratchArgs,
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
		...p9ScratchArgs, // ⟪P9⟫ never the canonical dataStores homes from a hermetic suite
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
		values: {
			recipePath: [goodRecipe('edfiOnly')],
			// ⟪Round-Trip Perfection Phase 1⟫ a BLANK store path is what stops this run now. The
			// stdin -build used to halt on the ABSENT store parameter, and that absence is no longer a
			// refusal — the configured key answers it. Left as it was, this probe would have resolved the
			// LIVE support store and run a real build from a hermetic suite. A blank keeps the refusal
			// early and keeps the proof: -deps has no store parameter at all and would have exited 0 with
			// an availableForges listing, so a store refusal can only mean the stdin action is the one
			// that ran.
			standardsDatabaseFilePath: [''],
		},
		fileList: [],
	}),
);
harness.equal('stdin OVERRIDES a conflicting command-line action', stdinBuild.status, 1);
harness.match(
	'  the stdin action is what ran (build, not deps)',
	stdinBuild.stderr,
	/graphBuilder -build: --standardsDatabaseFilePath was given but BLANK/,
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

const stdinFlatShape = runCli([], JSON.stringify({ build: true, recipePath: [goodRecipe('edfiOnly')] }));
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

// =====================================================================
harness.section('-retrievalMetrics — the instrument, over a SYNTHETIC forensic trail');
// =====================================================================
// ⟪P11⟫ Gated end-to-end here through the real binary, against a throwaway forensics directory
// built in this suite, so the gate is hermetic: the CLI's own contract (required parameters,
// refusals, the readable report on stdout, the JSON sidecar on disk, the exit codes) is proven
// without depending on the dataStores corpus. The NUMBERS are gated separately, against real
// data, in lib/retrieval-metrics/test/test-retrievalMetricsCaseAcceptance.js.

harness.match('-help documents the -retrievalMetrics action', helpRun.stdout, /-retrievalMetrics/);
harness.match(
	'  and states the rescue distinction the verb exists to protect',
	helpRun.stdout,
	/GENUINE rescue[\s\S]*WEAKER claim/,
);

const metricsScratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfCliRetrievalMetrics-'));
const metricsForensicsDir = path.join(metricsScratchDir, 'matchForensics');
const metricsPairDir = path.join(metricsForensicsDir, 'CEDS::CLITEST');
fs.mkdirSync(metricsPairDir, { recursive: true });

// two candidates, cosine-ordered; the winner is the second, so it ranks 2 — a pick that is NOT
// cosine top-1, which makes the top-1 accuracy assertion below meaningful rather than trivially 100%.
const cliPromptText =
	'EVIDENCE\n' +
	'1) First Candidate — retrieval cosine 0.900000\n' +
	'  CEDS Reference: P000001 — "First Candidate"\n' +
	'2) Second Candidate — retrieval cosine 0.500000\n' +
	'   Nominated by cliTestBridge: shares token(s) [second]\n' +
	'  CEDS Reference: P000002 — "Second Candidate"\n' +
	'Reply with the number.\n';
const cliRecord = (choice, rationale) =>
	JSON.stringify({
		timestamp: '2026-07-31T00:00:00.000Z',
		sourceStableId: 'cli:Thing.thing',
		sourceName: 'thing',
		promptText: cliPromptText,
		judgedVia: 'cache:abc',
		response: { choice, category: choice === 'NONE' ? 'none' : 'moderate', rationale },
	});
fs.writeFileSync(
	path.join(metricsPairDir, 'cliTestBridge-evidence-v1.jsonl'),
	`${cliRecord('2', 'the second one fits')}\n${cliRecord('NONE', 'none of the candidates are supported')}\n`,
	'utf8',
);

const noPairKeyRun = runCli(['-retrievalMetrics']);
harness.ok('-retrievalMetrics with no --pairKey exits nonzero', noPairKeyRun.status !== 0, `status=${noPairKeyRun.status}`);
harness.match(
	'  refusing BY NAME and saying there is no default',
	noPairKeyRun.stderr,
	/--pairKey=<pairKey> is REQUIRED and has no default/,
);

const unknownPairRun = runCli([
	'-retrievalMetrics',
	'--pairKey=CEDS::NOSUCHPAIR',
	`--matchForensicsDirPath=${metricsForensicsDir}`,
]);
harness.ok('an unknown pairKey exits nonzero', unknownPairRun.status !== 0, `status=${unknownPairRun.status}`);
harness.match('  and LISTS the pairs that are present', unknownPairRun.stderr, /Pairs present: CEDS::CLITEST/);

const badCutoffRun = runCli([
	'-retrievalMetrics',
	'--pairKey=CEDS::CLITEST',
	`--matchForensicsDirPath=${metricsForensicsDir}`,
	'--cosineCutoff=banana',
]);
harness.ok('a non-numeric --cosineCutoff exits nonzero', badCutoffRun.status !== 0, `status=${badCutoffRun.status}`);
harness.match('  refused by name rather than NaN-ing every rank', badCutoffRun.stderr, /is not a positive integer/);

const metricsRun = runCli([
	'-retrievalMetrics',
	'--pairKey=CEDS::CLITEST',
	`--matchForensicsDirPath=${metricsForensicsDir}`,
]);
harness.equal('a real -retrievalMetrics run exits 0', metricsRun.status, 0);
harness.match('  the READABLE REPORT lands on stdout', metricsRun.stdout, /RETRIEVAL METRICS — CEDS::CLITEST/);
harness.match('  reporting the winner rank distribution', metricsRun.stdout, /WINNER RANK DISTRIBUTION/);
harness.match('  and BOTH rescue numbers, labelled', metricsRun.stdout, /GENUINE rescues[\s\S]*winner merely nominated/);
harness.match('  and the abstention lint', metricsRun.stdout, /ABSTENTION LINT/);
harness.ok(
	'  progress (the sidecar path) goes to stderr, never polluting the report',
	/retrieval-metrics sidecar written to/.test(metricsRun.stderr) &&
		!/retrieval-metrics sidecar written to/.test(metricsRun.stdout),
	`stdout=${metricsRun.stdout.slice(0, 200)}`,
);

const sidecarFilePath = path.join(metricsPairDir, 'cliTestBridge-evidence-v1.retrievalMetrics.json');
harness.ok('  the JSON SIDECAR is written beside the trail it measures', fs.existsSync(sidecarFilePath), sidecarFilePath);
(() => {
	if (!fs.existsSync(sidecarFilePath)) {
		return;
	}
	const sidecar = JSON.parse(fs.readFileSync(sidecarFilePath, 'utf8'));
	harness.equal('  the sidecar names the pair', sidecar.pairKey, 'CEDS::CLITEST');
	harness.equal('  and stamps the instrument version', sidecar.metricsVersion, 'retrievalMetrics-v1');
	harness.equal('  and carries the pick count', sidecar.judgmentOutcomes.picks, 1);
	harness.equal('  and the abstention count', sidecar.judgmentOutcomes.abstentions, 1);
	harness.equal(
		'  the winner ranked 2 by cosine, so top-1 accuracy is 0 (display order is not rank)',
		sidecar.cosineTopOneAccuracy.hits,
		0,
	);
	harness.equal(
		'  the nominated winner sat INSIDE the cutoff, so it is NOT a genuine rescue',
		sidecar.rescueAttribution.genuineRescues,
		0,
	);
	harness.equal(
		'  though it DID merely carry a nomination — the two numbers stay apart',
		sidecar.rescueAttribution.winnerCarriedNomination,
		1,
	);
})();

fs.rmSync(metricsScratchDir, { recursive: true, force: true });

harness.report();
