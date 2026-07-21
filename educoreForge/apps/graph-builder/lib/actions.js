'use strict';

// actions.js — what graphBuilder actually DOES. One module because the three actions are
// genuinely related: -build and -validate share the whole load / summarize / validate sequence
// and differ only in how strictly they gate on the verdict. Written twice, that shared sequence
// would drift apart; written once, the difference between the two actions is visible in a
// dozen lines instead of buried in duplication.
//
//   actions.build(callback)     -> callback(errString, { exitCode, resultText })
//   actions.validate(callback)  -> callback(errString, { exitCode, resultText })
//   actions.deps(callback)      -> callback(errString, { exitCode, resultText })
//
// NO ACTION CALLS process.exit. Each RETURNS its outcome and the entry file owns exiting. A
// function that kills the process cannot be called by a test, and an action that cannot be
// tested is an action nobody can prove.

const path = require('path');
const fs = require('fs');

const recipeLib = require('./recipe');
const buildLib = require('./build');

// ---------------------------------------------------------------------
// ENVIRONMENT DISCOVERY
// ---------------------------------------------------------------------
// Which standards this environment can actually forge — a scan of forges/<STD>/forge.js.
// Empty until forges are ported; feeds Layer-2 resolvability so un-ported forges are flagged
// honestly rather than assumed present. It lives beside its callers because both -build and
// -deps need it and nothing else does.

const scanAvailableForges = () => {
	const forgesDir = path.join(__dirname, '..', '..', '..', 'forges');
	if (!fs.existsSync(forgesDir)) {
		return [];
	}
	try {
		return fs
			.readdirSync(forgesDir, { withFileTypes: true })
			.filter(
				(entry) =>
					entry.isDirectory() && fs.existsSync(path.join(forgesDir, entry.name, 'forge.js')),
			)
			.map((entry) => entry.name);
	} catch (scanError) {
		return [];
	}
};

// ---------------------------------------------------------------------
// SHARED — resolve the recipe path, then load / summarize / validate it
// ---------------------------------------------------------------------

const firstValue = (commandLineParameters, name) =>
	(commandLineParameters.values[name] || [])[0];

const recipePathFrom = (commandLineParameters) =>
	firstValue(commandLineParameters, 'recipePath') || (commandLineParameters.fileList || [])[0];

// Returns { error } on any failure the caller should report and stop on, otherwise
// { recipePath, recipe, verdict }. The summary is emitted as a side effect because
// comprehension output belongs with the reading of the recipe, not with the acting on it.
const readAndValidate = (actionName) => {
	const { xLog, commandLineParameters } = process.global;
	const recipePath = recipePathFrom(commandLineParameters);

	if (!recipePath) {
		return {
			error: `graphBuilder ${actionName}: --recipePath=<path> (or a positional recipe path) is required. Use -help.`,
		};
	}

	const loaded = recipeLib.loadRecipe(recipePath);
	if (loaded.error) {
		return { recipePath, loadError: loaded.error };
	}

	xLog.status(recipeLib.summarizeRecipe(loaded.recipe));

	const verdict = recipeLib.validateRecipe(loaded.recipe, {
		contentValidation: true, // Layer 2 (referential + resolvability) active
		availableForges: scanAvailableForges(),
	});

	return { recipePath, recipe: loaded.recipe, verdict };
};

// ---------------------------------------------------------------------
// -build
// ---------------------------------------------------------------------

const build = (callback) => {
	const { xLog } = process.global;
	const read = readAndValidate('-build');

	if (read.error) {
		callback(read.error);
		return;
	}
	if (read.loadError) {
		callback(`graphBuilder -build: recipe REJECTED -- ${read.loadError}`);
		return;
	}

	const { verdict, recipe } = read;
	const passFail = (layer) => (layer.ran ? (layer.ok ? 'PASS' : 'FAIL') : 'skipped');
	xLog.status(
		`graphBuilder: validation -- structural ${passFail(verdict.layers.structural)}; ` +
			`referential ${passFail(verdict.layers.referential)}; ` +
			`resolvability ${passFail(verdict.layers.resolvability)}.`,
	);

	// POLICY: -build hard-gates on STRUCTURAL + REFERENTIAL only. Resolvability (a forge not yet
	// ported) is a non-blocking NOTE during the stub era, so a new-format recipe can flow through
	// the component pipeline before any forge exists. -validate remains fully strict. Both halves
	// of this asymmetry are gated by test-cli; it is a decision, not an accident.
	const blockingErrors = [
		...verdict.layers.structural.errors,
		...verdict.layers.referential.errors,
	];
	if (blockingErrors.length) {
		callback(`graphBuilder -build: recipe REJECTED:\n  - ${blockingErrors.join('\n  - ')}`);
		return;
	}
	if (!verdict.layers.resolvability.ok) {
		xLog.status(
			`graphBuilder: NOTE -- ${verdict.layers.resolvability.errors.length} standard(s) have no forge yet; proceeding with STUB components.`,
		);
	}

	buildLib.build(recipe, { xLog }, (buildError, result) => {
		if (buildError) {
			callback(`graphBuilder -build failed: ${buildError}`);
			return;
		}
		callback('', { exitCode: 0, resultText: JSON.stringify(result, null, 2) });
	});
};

// ---------------------------------------------------------------------
// -validate
// ---------------------------------------------------------------------

const validate = (callback) => {
	const read = readAndValidate('-validate');

	if (read.error) {
		callback(read.error);
		return;
	}

	// a load/parse failure is itself a rejection — and still earns a machine-readable verdict,
	// so a caller parsing stdout gets an answer rather than an empty stream.
	if (read.loadError) {
		const { xLog } = process.global;
		xLog.error(`graphBuilder -validate: REJECTED -- ${read.loadError}`);
		callback('', {
			exitCode: 1,
			resultText: JSON.stringify(
				{
					recipePath: read.recipePath,
					valid: false,
					errors: [read.loadError],
					layers: { load: { ok: false } },
				},
				null,
				2,
			),
		});
		return;
	}

	callback('', {
		exitCode: read.verdict.valid ? 0 : 1,
		resultText: JSON.stringify({ recipePath: read.recipePath, ...read.verdict }, null, 2),
	});
};

// ---------------------------------------------------------------------
// -deps
// ---------------------------------------------------------------------

const deps = (callback) => {
	const { xLog } = process.global;
	const availableForges = scanAvailableForges();

	xLog.status(
		`graphBuilder: [deps] ${availableForges.length} standard(s) have a ported forge in this tree.`,
	);

	callback('', {
		exitCode: 0,
		resultText: JSON.stringify(
			{
				availableForges,
				note: availableForges.length
					? undefined
					: 'no forges ported yet (forges/<STD>/forge.js) -- resolvability will flag every standard',
			},
			null,
			2,
		),
	});
};

module.exports = { build, validate, deps, scanAvailableForges };
