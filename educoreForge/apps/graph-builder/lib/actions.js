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

const recipeLib = require('./recipe')();
const buildLib = require('./build')();

// standards-database is required LAZILY, inside build(), and this is not a style choice: it pulls
// in sqlite-instance, which DESTRUCTURES process.global at REQUIRE time. graphBuilder.js requires
// this module before bootstrapGlobal() runs, so a top-level require here makes every action --
// including -help -- die on startup. (manifestEditor documents the same trap; it escaped by moving
// the block taxonomy to lib/vocabulary. There is no such escape for the standardsDatabase itself.)
const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
const requireStandardsDatabase = () =>
	require(path.join(__dirname, '..', '..', '..', 'lib', 'standards-database', 'standards-database'));

// decision-store is required LAZILY for the SAME reason standards-database is: it pulls in
// sqlite-instance, which DESTRUCTURES process.global at REQUIRE time, and this module is required
// before bootstrapGlobal() runs. A top-level require here would kill every action, -help included.
const requireDecisionStore = () =>
	require(path.join(__dirname, '..', '..', '..', 'lib', 'decision-store', 'decision-store'));

// decisionStorePathFrom — where a build reads/writes FROZEN decision blocks. An explicit
// --decisionStoreFilePath WINS (the operator names a canonical decisions db); absent, it is DERIVED
// beside the standardsDatabase (`<name>.decisions<ext>` in the same directory). Deriving is not a
// silent default: it is anchored to the standardsDatabaseFilePath the caller ALREADY had to name
// (§6's real safety concern is a fall-through to "anywhere", and a path pinned to an explicit path is
// nowhere near that). Returns { decisionStoreFilePath } or { error } — refused BY NAME if neither the
// override nor the required standardsDatabaseFilePath resolves.
const decisionStorePathFrom = (standardsDatabaseFilePath, explicitPath) => {
	if (typeof explicitPath === 'string' && explicitPath.trim() !== '') {
		return { decisionStoreFilePath: explicitPath };
	}
	if (typeof explicitPath === 'string') {
		return {
			error:
				`graphBuilder -build: --decisionStoreFilePath was given but blank. It names where FROZEN ` +
				`decision blocks are read (plain build) and written (--rebridge); a blank path is refused ` +
				`rather than derived, so the operator's intent is never guessed at.`,
		};
	}
	if (typeof standardsDatabaseFilePath !== 'string' || standardsDatabaseFilePath.trim() === '') {
		return {
			error:
				`graphBuilder -build: the decision-store path is unresolvable — no --decisionStoreFilePath ` +
				`override and no --standardsDatabaseFilePath to derive it from. There is no default.`,
		};
	}
	const parsed = path.parse(standardsDatabaseFilePath);
	return {
		decisionStoreFilePath: path.join(parsed.dir, `${parsed.name}.decisions${parsed.ext || '.sqlite'}`),
	};
};

// ---------------------------------------------------------------------
// ENVIRONMENT DISCOVERY
// ---------------------------------------------------------------------
// Which standards this environment can actually forge. A forge bundle IS its own registration
// (discovery pattern, not a registry): forges/<token>/parserDescriptor.ini names the entryModule,
// and the bundle counts as available only when that entry actually exists on disk. This is the
// SAME rule the forger's resolveBundle applies, so what -deps advertises is exactly what forge()
// will accept. (Replaces the original forge.js filename guess, which predated the ports and saw
// nothing.) Feeds Layer-2 resolvability so un-ported forges are flagged honestly.

// FORGES_DIR is the one legitimate constant here: the forges live inside the tree at a fixed
// place, there is no key to set and nothing to omit, so it shadows nothing (polyArch2 §6).
const FORGES_DIR = path.join(__dirname, '..', '..', '..', 'forges');

// scanAvailableForges({ forgesDir }) -> { availableForges } | { error }
//
// It used to answer `[]` for three DIFFERENT facts: a genuinely empty forges/, a directory it
// could not read (try/catch returning a default — the grep-invisible shape), and a bundle whose
// parserDescriptor.ini exists but is malformed. "I could not read the directory" and "the
// directory has no forges" became the same answer, and a typo'd `entryModule` key made a forge
// VANISH from -deps while forger.resolveBundle refused the identical file BY NAME. Two paths, one
// condition, opposite conduct. This is now the loud one, so what -deps advertises and what forge()
// will accept are the same answer arrived at the same way.
//
// A directory with NO parserDescriptor.ini at all is still simply not a forge bundle: it makes no
// claim to be one. A descriptor that EXISTS is a claim, and a claim that does not hold up is a
// fault, not an occasion to look away.
const scanAvailableForges = ({ forgesDir } = {}) => {
	if (typeof forgesDir !== 'string' || forgesDir.trim() === '') {
		return {
			error:
				`graphBuilder scanAvailableForges: forgesDir is required and has no default. ` +
				`The caller says which tree is being scanned.`,
		};
	}
	if (!fs.existsSync(forgesDir)) {
		return {
			error:
				`graphBuilder scanAvailableForges: the forges directory '${forgesDir}' does not ` +
				`exist. That is not the same fact as "this tree has no forges", and it is not ` +
				`reported as one.`,
		};
	}

	let entries;
	try {
		entries = fs.readdirSync(forgesDir, { withFileTypes: true });
	} catch (scanError) {
		return {
			error:
				`graphBuilder scanAvailableForges: could not read '${forgesDir}' — ` +
				`${scanError.message}. A scan that FAILED is reported as a failure, never as an ` +
				`empty roster.`,
		};
	}

	const availableForges = [];
	const problems = [];

	entries
		.filter((oneEntry) => oneEntry.isDirectory())
		.forEach((oneEntry) => {
			const descriptorPath = path.join(forgesDir, oneEntry.name, 'parserDescriptor.ini');
			if (!fs.existsSync(descriptorPath)) {
				// no descriptor is no CLAIM to be a forge bundle. Not a fault.
				return;
			}
			let descriptorText;
			try {
				descriptorText = fs.readFileSync(descriptorPath, 'utf8');
			} catch (readError) {
				problems.push(`${descriptorPath} could not be read — ${readError.message}`);
				return;
			}
			const entryModule = (descriptorText.match(
				/^entryModule[ \t]*=[ \t]*(.+?)[ \t]*$/m,
			) || [])[1];
			if (!entryModule) {
				problems.push(
					`${descriptorPath} declares no entryModule (the key must be spelled exactly ` +
						`'entryModule' and live under the [parserDescriptor] header)`,
				);
				return;
			}
			const entryPath = path.join(forgesDir, oneEntry.name, entryModule);
			if (!fs.existsSync(entryPath)) {
				problems.push(
					`${descriptorPath} names entryModule '${entryModule}', which is not on disk ` +
						`(${entryPath})`,
				);
				return;
			}
			availableForges.push(oneEntry.name);
		});

	if (problems.length) {
		return {
			error:
				`graphBuilder scanAvailableForges: ${problems.length} forge bundle(s) in ` +
				`'${forgesDir}' are MALFORMED and were NOT silently omitted from the roster:\n  - ` +
				`${problems.join('\n  - ')}`,
		};
	}

	return { availableForges };
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

	// A scan that FAILED must not reach the resolvability layer as an empty roster: every
	// standard would be flagged unresolvable and the recipe blamed for the environment's fault.
	const scan = scanAvailableForges({ forgesDir: FORGES_DIR });
	if (scan.error) {
		return { recipePath, error: `graphBuilder ${actionName}: ${scan.error}` };
	}

	const verdict = recipeLib.validateRecipe(loaded.recipe, {
		contentValidation: true, // Layer 2 (referential + resolvability) active
		availableForges: scan.availableForges,
	});

	return { recipePath, recipe: loaded.recipe, recipeText: loaded.recipeText, verdict };
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
			`graphBuilder: NOTE -- ${verdict.layers.resolvability.errors.length} standard(s) have no forge yet; the forger will refuse them by name.`,
		);
	}

	// THE STANDARDS DATABASE IS OPENED HERE, NOT IN build.js. It is a stateful shared resource, so
	// the orchestrator owns it (polyArch2 §2) and the pipeline receives it. The path is REQUIRED and
	// has no default: standards-database refuses to invent one because on 2026-07-17 a
	// scratch-intended save silently wrote the canonical standardsDatabase, and a build that must say where it
	// writes cannot fall through to writing anywhere.
	const standardsDatabaseFilePath = firstValue(
		process.global.commandLineParameters,
		'standardsDatabaseFilePath',
	);
	if (!standardsDatabaseFilePath) {
		callback(
			`graphBuilder -build: --standardsDatabaseFilePath=<path> is REQUIRED and has no default. ` +
				`Every schema block this build harvests is written through to that standardsDatabase, and a build ` +
				`that does not say where it writes is one edit away from writing the canonical one.`,
		);
		return;
	}

	// THE DECISION STORE IS OPENED HERE ALONGSIDE THE STANDARDS DATABASE, and for the same reason: it
	// is a stateful shared resource, so the orchestrator owns it (polyArch2 §2) and the pipeline
	// receives it. A semantic bridge READS a pair's frozen decision block from it on a plain build and
	// WRITES one on --rebridge; without it semanticBridge refuses BY NAME (never a silent zero-edge
	// success). An authored-only build opens it and never touches it — harmless. Its path is the
	// standardsDatabase's sibling unless --decisionStoreFilePath overrides it (decisionStorePathFrom).
	const decisionStorePathResolution = decisionStorePathFrom(
		standardsDatabaseFilePath,
		firstValue(process.global.commandLineParameters, 'decisionStoreFilePath'),
	);
	if (decisionStorePathResolution.error) {
		callback(decisionStorePathResolution.error);
		return;
	}
	const decisionStoreFilePath = decisionStorePathResolution.decisionStoreFilePath;

	requireStandardsDatabase()().open({ databaseFilePath: standardsDatabaseFilePath }, (openError, standardsDatabase) => {
		if (openError) {
			callback(`graphBuilder -build: ${openError}`);
			return;
		}
		requireDecisionStore()().open({ databaseFilePath: decisionStoreFilePath }, (decisionOpenError, decisionStore) => {
			if (decisionOpenError) {
				callback(`graphBuilder -build: ${decisionOpenError}`);
				return;
			}
			xLog.status(`graphBuilder: decision store at ${decisionStoreFilePath}`);
			buildLib.build(recipe, { xLog, standardsDatabase, decisionStore, recipePath: read.recipePath, recipeText: read.recipeText }, (buildError, result) => {
				if (buildError) {
					callback(`graphBuilder -build failed: ${buildError}`);
					return;
				}
				callback('', { exitCode: 0, resultText: JSON.stringify(result, null, 2) });
			});
		});
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
	const scan = scanAvailableForges({ forgesDir: FORGES_DIR });
	if (scan.error) {
		callback(scan.error);
		return;
	}
	const availableForges = scan.availableForges;

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

// ---------------------------------------------------------------------
// -replay
// ---------------------------------------------------------------------
// Regenerate a graph FROM A STORED MANIFEST — no forging, no bridge runs. A -build persists a
// manifest that regenerates the graph it just built; -replay is the verb that cashes that promise:
// it opens the manifest by refId, resolves its member schema blocks, and materializes them into a
// fresh DEV_ graph. NO recipe, NO decision store, NO Voyage/LLM. Its two parameters are REQUIRED and
// have no default (the same 2026-07-17 lesson as -build): a replay that does not say WHICH store and
// WHICH manifest cannot be allowed to guess. The absent-manifest and absent-member refusals live in
// buildLib.replay (routed through the store and manifestEditor), named there.

const replay = (callback) => {
	const { xLog } = process.global;

	const standardsDatabaseFilePath = firstValue(
		process.global.commandLineParameters,
		'standardsDatabaseFilePath',
	);
	if (!standardsDatabaseFilePath) {
		callback(
			`graphBuilder -replay: --standardsDatabaseFilePath=<path> is REQUIRED and has no default. ` +
				`A replay reads the blocks and the manifest from that standardsDatabase; a replay that does ` +
				`not say where it reads has nothing to reproduce.`,
		);
		return;
	}

	const manifestRefId = firstValue(process.global.commandLineParameters, 'manifestRefId');
	if (!manifestRefId) {
		callback(
			`graphBuilder -replay: --manifestRefId=<refId> is REQUIRED and has no default. It names the ` +
				`stored manifest to reproduce, and there is nothing to open without it.`,
		);
		return;
	}

	requireStandardsDatabase()().open(
		{ databaseFilePath: standardsDatabaseFilePath },
		(openError, standardsDatabase) => {
			if (openError) {
				callback(`graphBuilder -replay: ${openError}`);
				return;
			}
			buildLib.replay(
				{ manifestRefId },
				{ xLog, standardsDatabase },
				(replayError, result) => {
					if (replayError) {
						callback(`graphBuilder -replay failed: ${replayError}`);
						return;
					}
					callback('', { exitCode: 0, resultText: JSON.stringify(result, null, 2) });
				},
			);
		},
	);
};

return { build, validate, deps, replay, scanAvailableForges };
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
