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
// The pipeline (materialize-and-harvest model):
//   Phase A  forge each standardBase           -> extract block -> add to manifest
//   Phase B  build hub blocks (recipe.hubs)     -> add to manifest
//   Phase C  per (source, hub/structural):       materialize dependency graph -> run bridge
//              (labels new edges) -> extract the LABELED relationship block -> add to manifest
//   Compose  manifestEditor assembles the manifest
//   Material replayManager materializes the final graph -> bolt url
//
// A fully-qualified qtools module: process.global (xLog, getConfig, commandLineParameters)
// bootstrapped and FROZEN once; qtools-parse-command-line; taskListPlus/pipeRunner async
// (no async/await, no try/catch for control flow); camelCase only.
//
// INPUT CHANNELS: command-line flags OR a JSON object on stdin. When stdin is not a TTY and
// carries content, the parsed JSON REPLACES the command-line parameters (the qtools
// {switches, values, fileList} shape).
//
// STATUS: SCAFFOLD. The control surface, help text, JSON-stdin channel, and the phase
// pipeline are in place; each phase BODY is a stub that logs its intent and threads state.
//
// Action flags take a single hyphen (-build); parameters take a double hyphen (--recipePath=).
// =====================================================================

const path = require('path');
const fs = require('fs');

const commandLineParser = require('qtools-parse-command-line');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const recipeLib = require('./lib/recipe');
const buildLib = require('./lib/build');

// which standards the environment can actually forge — a scan of the tree's forges/<STD>/forge.js.
// Empty until forges are ported; feeds Layer-2 resolvability so un-ported forges are flagged honestly.
const scanAvailableForges = () => {
	const forgesDir = path.join(__dirname, '..', '..', 'forges');
	if (!fs.existsSync(forgesDir)) {
		return [];
	}
	try {
		return fs
			.readdirSync(forgesDir, { withFileTypes: true })
			.filter(
				(entry) =>
					entry.isDirectory() &&
					fs.existsSync(path.join(forgesDir, entry.name, 'forge.js')),
			)
			.map((entry) => entry.name);
	} catch (scanError) {
		return [];
	}
};

// =====================================================================
// HELP TEXT — the control surface IS the contract
// =====================================================================

const helpText = () => `
NAME
     graphBuilder -- build any graph (up to a full golden) from a recipe, under program control

SYNOPSIS
     graphBuilder   -build    --recipePath=<path>
     graphBuilder   -validate --recipePath=<path>
     graphBuilder   -deps
     graphBuilder   -help

     ... | graphBuilder                (JSON on stdin REPLACES command-line parameters)

DESCRIPTION
     graphBuilder is the hands-free recipe runner for the educoreForge grand recreation.
     Given a recipe it forges each standard's base graph, builds the declared hub blocks,
     runs each bridge over a materialized dependency graph, composes the manifest, and
     materializes the resulting graph -- returning the new manifest id and the bolt url.
     A golden is simply a MAXIMAL recipe; graphBuilder builds ANY graph a recipe describes.

     Action flags take a single hyphen; parameters take a double hyphen.

     STATUS: SCAFFOLD -- control surface, help, JSON-stdin channel, and phase pipeline are
     in place; the phase bodies are stubs (they log their intent and thread state).

INPUT
     Parameters may be supplied as command-line flags OR as a JSON object on stdin. When
     stdin is not a terminal and carries content, it REPLACES the command-line parameters.
     The JSON mirrors the qtools-parse-command-line shape:
         { "switches": { "build": true },
           "values":   { "recipePath": ["/path/to/recipe.goldenRecipe.jsonc"] },
           "fileList":  [] }

COMMANDS
     -build       Build the graph described by the recipe. Returns { manifestId, boltUrl }.
     -validate    Validate a recipe (Layer 1 JSON Schema + Layer 2 semantic/referential).
     -deps        List the resolvable standard tokens, versions, and hub group aliases.

OPTIONS
     --recipePath=<path>   The recipe file (a build/golden recipe). Required for -build and
                           -validate. May also be given as a positional (fileList).
     -verbose              Emit verbose progress on stderr.

OUTPUT
     -build:    JSON { manifestId, boltUrl } on stdout (progress on stderr).
     -validate: JSON validation verdict on stdout.
     -deps:     JSON discovery listing on stdout.
`;

// =====================================================================
// PARAMETER RESOLUTION — JSON-on-stdin overrides the command line
// =====================================================================
// If stdin is not a TTY and carries content, parse it as the {switches, values, fileList}
// object and use it INSTEAD of the parsed command line. Otherwise use the command line.
// Errors are values (callback(errString)); no try/catch for control flow beyond the parse.

const resolveParameters = (callback) => {
	const cliParameters = commandLineParser.getParameters();

	if (process.stdin.isTTY) {
		// attached to a terminal -> there is no piped stdin
		callback('', cliParameters);
		return;
	}

	let buffer = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (chunk) => {
		buffer += chunk;
	});
	process.stdin.on('end', () => {
		if (!buffer.trim()) {
			// non-TTY but nothing piped (e.g. </dev/null) -> fall back to the command line
			callback('', cliParameters);
			return;
		}
		let parsed;
		try {
			parsed = JSON.parse(buffer);
		} catch (parseError) {
			callback(`graphBuilder: invalid JSON on stdin: ${parseError.message}`);
			return;
		}
		callback('', {
			switches: parsed.switches || {},
			values: parsed.values || {},
			fileList: parsed.fileList || [],
		});
	});
};

// =====================================================================
// BOOTSTRAP process.global (xLog + getConfig + commandLineParameters), frozen once
// =====================================================================

const bootstrapGlobal = (commandLineParameters) => {
	const verbose = !!commandLineParameters.switches.verbose;

	const xLog = {
		status: (...args) => console.error(...args),
		error: (...args) => console.error(...args),
		result: (...args) => console.log(...args),
		verbose: verbose ? (...args) => console.error(...args) : () => {},
	};

	// Config wiring is DEFERRED (the scaffold needs none). getConfig answers {} for every
	// section so the module stays self-contained and relocatable; real config resolution
	// (a tree-local systemParameters.ini) lands when a phase first needs it.
	const getConfig = () => ({});

	process.global = { xLog, getConfig, commandLineParameters, rawConfig: {} };
	Object.freeze(process.global);
};

// value helper — qtools values arrive as arrays
const firstValue = (commandLineParameters, name) =>
	(commandLineParameters.values[name] || [])[0];

const recipePathFrom = (commandLineParameters) =>
	firstValue(commandLineParameters, 'recipePath') ||
	(commandLineParameters.fileList || [])[0];

// =====================================================================
// ACTIONS (stubs — each logs its intent and threads state through the pipe)
// =====================================================================

const doBuild = () => {
	const { xLog, commandLineParameters } = process.global;
	const recipePath = recipePathFrom(commandLineParameters);
	if (!recipePath) {
		xLog.error(
			'graphBuilder -build: --recipePath=<path> (or a positional recipe path) is required. Use -help.',
		);
		process.exit(1);
		return;
	}

	// ---- load + validate the recipe (fail fast, before any forging) ----
	const loaded = recipeLib.loadRecipe(recipePath);
	if (loaded.error) {
		xLog.error(`graphBuilder -build: recipe REJECTED -- ${loaded.error}`);
		process.exit(1);
		return;
	}
	xLog.status(recipeLib.summarizeRecipe(loaded.recipe));
	const verdict = recipeLib.validateRecipe(loaded.recipe, {
		contentValidation: true, // Layer 2 (referential + resolvability) active
		availableForges: scanAvailableForges(),
	});
	const passFail = (layer) => (layer.ran ? (layer.ok ? 'PASS' : 'FAIL') : 'skipped');
	xLog.status(
		`graphBuilder: validation -- structural ${passFail(verdict.layers.structural)}; ` +
			`referential ${passFail(verdict.layers.referential)}; ` +
			`resolvability ${passFail(verdict.layers.resolvability)}.`,
	);
	// -build hard-gates on STRUCTURAL + REFERENTIAL only; resolvability (forge-not-ported) is a
	// non-blocking note during the stub era, so a new-format recipe flows into the component pipeline
	// before any forge exists. -validate remains fully strict.
	const blockingErrors = [
		...verdict.layers.structural.errors,
		...verdict.layers.referential.errors,
	];
	if (blockingErrors.length) {
		xLog.error(
			`graphBuilder -build: recipe REJECTED:\n  - ${blockingErrors.join('\n  - ')}`,
		);
		process.exit(1);
		return;
	}
	if (!verdict.layers.resolvability.ok) {
		xLog.status(
			`graphBuilder: NOTE -- ${verdict.layers.resolvability.errors.length} standard(s) have no forge yet; proceeding with STUB components.`,
		);
	}

	// run the pipeline over the (stub) component modules, in-process
	buildLib.build(loaded.recipe, { xLog }, (err, result) => {
		if (err) {
			xLog.error(`graphBuilder -build failed: ${err}`);
			process.exit(1);
			return;
		}
		xLog.result(JSON.stringify(result, null, 2));
		process.exit(0);
	});
};

const doValidate = () => {
	const { xLog, commandLineParameters } = process.global;
	const recipePath = recipePathFrom(commandLineParameters);
	if (!recipePath) {
		xLog.error(
			'graphBuilder -validate: --recipePath=<path> (or a positional recipe path) is required. Use -help.',
		);
		process.exit(1);
		return;
	}
	const loaded = recipeLib.loadRecipe(recipePath);
	if (loaded.error) {
		// a load/parse failure is itself a rejection
		xLog.error(`graphBuilder -validate: REJECTED -- ${loaded.error}`);
		xLog.result(
			JSON.stringify(
				{
					recipePath,
					valid: false,
					errors: [loaded.error],
					layers: { load: { ok: false } },
				},
				null,
				2,
			),
		);
		process.exit(1);
		return;
	}

	xLog.status(recipeLib.summarizeRecipe(loaded.recipe));
	const verdict = recipeLib.validateRecipe(loaded.recipe, {
		contentValidation: true, // Layer 2 (referential + resolvability) active
		availableForges: scanAvailableForges(),
	});
	xLog.result(JSON.stringify({ recipePath, ...verdict }, null, 2));
	process.exit(verdict.valid ? 0 : 1);
};

const doDeps = () => {
	const { xLog } = process.global;
	const availableForges = scanAvailableForges();
	xLog.status(
		`graphBuilder: [deps] ${availableForges.length} standard(s) have a ported forge in this tree.`,
	);
	xLog.result(
		JSON.stringify(
			{
				availableForges,
				note: availableForges.length
					? undefined
					: 'no forges ported yet (forges/<STD>/forge.js) -- resolvability will flag every standard',
			},
			null,
			2,
		),
	);
	process.exit(0);
};

// =====================================================================
// RUN
// =====================================================================

const run = () => {
	resolveParameters((err, commandLineParameters) => {
		if (err) {
			console.error(err);
			process.exit(1);
			return;
		}

		const switches = commandLineParameters.switches || {};
		const noAction = !switches.build && !switches.validate && !switches.deps;

		if (switches.help || switches.h || noAction) {
			console.log(helpText());
			process.exit(0);
			return;
		}

		bootstrapGlobal(commandLineParameters);

		if (switches.build) {
			doBuild();
			return;
		}
		if (switches.validate) {
			doValidate();
			return;
		}
		if (switches.deps) {
			doDeps();
			return;
		}
	});
};

run();
