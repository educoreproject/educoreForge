'use strict';

// actions.js — what graphBuilder actually DOES. One module because the three actions are
// genuinely related: -build and -validate share the whole load / summarize / validate sequence
// and differ only in how strictly they gate on the verdict. Written twice, that shared sequence
// would drift apart; written once, the difference between the two actions is visible in a
// dozen lines instead of buried in duplication.
//
//   actions.build(callback)             -> callback(errString, { exitCode, resultText })
//   actions.validate(callback)          -> callback(errString, { exitCode, resultText })
//   actions.deps(callback)              -> callback(errString, { exitCode, resultText })
//   actions.retrievalMetrics(callback)  -> callback(errString, { exitCode, resultText })
//   actions.cedsRoundTrip(callback)     -> callback(errString, { exitCode, resultText })
//
// NO ACTION CALLS process.exit. Each RETURNS its outcome and the entry file owns exiting. A
// function that kills the process cannot be called by a test, and an action that cannot be
// tested is an action nobody can prove.

const path = require('path');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const recipeLib = require('./recipe')();
const buildLib = require('./build')();

// timestampForFileName — a sortable, filesystem-safe stamp for a backup copy's name (YYYYMMDD-HHMMSS,
// local time, matching the buildLogs run-directory convention already in this tree). It is a distinct
// named function rather than an inline expression because -truncateStore's whole safety story rests on
// never overwriting a previous backup, and a name is what makes that intent greppable.
const timestampForFileName = () => {
	const now = new Date();
	const twoDigit = (oneNumber) => `${oneNumber}`.padStart(2, '0');
	return (
		`${now.getFullYear()}${twoDigit(now.getMonth() + 1)}${twoDigit(now.getDate())}` +
		`-${twoDigit(now.getHours())}${twoDigit(now.getMinutes())}${twoDigit(now.getSeconds())}`
	);
};

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

// judgment-cache carries the IDENTICAL sqlite-instance lazy-require trap — required lazily too.
const requireJudgmentCache = () =>
	require(path.join(__dirname, '..', '..', '..', 'lib', 'judgment-cache', 'judgment-cache'));

// match-forensics has NO sqlite pull (fs/path only) — lazily required anyway, for symmetry with
// its two sibling persistence stores; the trap discipline is easier to audit when uniform.
const requireMatchForensics = () =>
	require(path.join(__dirname, '..', '..', '..', 'lib', 'match-forensics', 'match-forensics'));

// ⟪P11⟫ retrieval-metrics READS what match-forensics WROTE. Same lazy-require discipline as its
// four sibling stores, for the same auditability reason (it pulls no sqlite either).
const requireRetrievalMetrics = () =>
	require(path.join(__dirname, '..', '..', '..', 'lib', 'retrieval-metrics', 'retrieval-metrics'));

// ⟪P9, p9-judgmentPersistence 2026-07-31⟫ the canonical home of the forensic match LOG — a DOCUMENTED
// default standing behind an optional command-line parameter, ON by default because a judgment is real
// spent money and losing one is crazy (⟪TQ RULING, 2026-07-30⟫); '--<param>=false' disables; any other
// value redirects.
//
// ⟪Round-Trip Perfection Phase 1, 2026-08-04⟫ JUDGMENT_CACHE_DEFAULT_FILE_PATH stood here beside this
// one and is GONE, not merely unused: under TQ's single-file ruling the judgment cache lives IN the
// configured support store, so its default is now the path an operator named in [stores]. Leaving the
// constant in place would have left a second, code-invented home for the cache that nothing consulted
// but that the next reader would reasonably believe in. The forensic match log is a DIRECTORY of JSON,
// not a SQLite family, so it is not one of the five and keeps its own home.
const MATCH_FORENSICS_DEFAULT_DIR_PATH =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/matchForensics';

// resolvePersistencePath — shared resolution for both P9 stores. Returns
// { filePath } (a path to open), { disabled: true } ('false' was passed), or { error } (blank).
//   explicitValue   the raw --param value, or undefined when not given
//   defaultPath     the documented canonical default (used when the param is absent)
// When the DEFAULT is in force, its parent directory is PREPARED here (mkdirSync recursive) —
// deliberately: default-ON must not fail on a fresh machine, and preparing the ONE canonical,
// documented location is the orchestrator's job. An EXPLICIT override is NOT prepared: an operator
// naming a path must name one that exists (the same refusal decision-store/judgment-cache apply).
const resolvePersistencePath = ({ explicitValue, defaultPath, parameterName, prepareDir }) => {
	if (typeof explicitValue === 'string' && explicitValue.trim() === 'false') {
		return { disabled: true };
	}
	if (typeof explicitValue === 'string' && explicitValue.trim() !== '') {
		return { filePath: explicitValue };
	}
	if (typeof explicitValue === 'string') {
		return {
			error:
				`graphBuilder -build: --${parameterName} was given but blank. Pass a path, 'false' to ` +
				`disable, or omit it to take the documented default (${defaultPath}). A blank is refused ` +
				`rather than guessed at.`,
		};
	}
	fs.mkdirSync(prepareDir, { recursive: true });
	return { filePath: defaultPath };
};

// ---------------------------------------------------------------------
// THE SINGLE SUPPORT STORE (Round-Trip Perfection Campaign, Phase 1)
// ---------------------------------------------------------------------
// resolveSupportStoreFilePath — where ALL FIVE store families live. TQ ruled ONE FILE (2026-08-04):
// schema blocks + manifests + manifestBlocks, decisionBlocks, frozen vectors, the embedding vector
// cache, and the AI judgment cache, all in the file named by [stores] graphBuilderSupportFilePath.
//
// THE NO-DEFAULT REFUSAL IS PRESERVED, NOT RELAXED, AND THAT IS THIS FUNCTION'S WHOLE POINT.
// standardsDatabase.open:92-98 refuses an unnamed path because on 2026-07-17 a scratch-intended
// `manifestEditor -save` silently wrote the canonical store, having no path handling and falling
// through to one. Its comment is the doctrine: "a caller that does not say where it is writing is a
// caller that can write anywhere." Moving the path into configuration changes WHO says it, never
// WHETHER it is said.
//
// CONFIG-SUPPLIED IS NOT A CODE DEFAULT. This is the distinction the phase turns on. A code default
// is a value the program invents when nobody spoke; a configured value is an operator speaking
// through a file instead of through argv. So an ABSENT config key is silence, and silence is refused
// BY NAME here exactly as an absent --standardsDatabaseFilePath always was. There is deliberately no
// `|| SOME_PATH` anywhere in this function, and a red twin proves the absence refuses rather than
// resolving to the campaign's own store, the tree's dataStores, or anywhere else.
//
// PRECEDENCE: an explicit --standardsDatabaseFilePath WINS over the configured key. An operator or a
// hermetic test naming a path is the most specific instruction available and must not be overridden
// by a file; this is also what keeps every existing suite's scratch-store isolation working.
//
// Returns { filePath } or { error }. A blank on either channel is refused rather than skipped over:
// a present-but-empty value is operator input that failed, which polyArch2 §6 treats as the worse
// fault than absence — it means someone tried to say something and it did not arrive.
const resolveSupportStoreFilePath = ({ explicitValue, configuredValue, actionName }) => {
	if (typeof explicitValue === 'string' && explicitValue.trim() !== '') {
		return { filePath: explicitValue, resolvedFrom: 'commandLine' };
	}
	if (typeof explicitValue === 'string') {
		return {
			error:
				`graphBuilder ${actionName}: --standardsDatabaseFilePath was given but BLANK. It names the ` +
				`single support store every schema block, manifest, decision, vector and judgment is ` +
				`written to. A blank is refused rather than quietly replaced by the configured path, ` +
				`because a caller that tried to name a path and failed has not agreed to any other one.`,
		};
	}
	if (typeof configuredValue === 'string' && configuredValue.trim() !== '') {
		return { filePath: configuredValue, resolvedFrom: 'config' };
	}
	if (typeof configuredValue === 'string') {
		return {
			error:
				`graphBuilder ${actionName}: [stores] graphBuilderSupportFilePath is present in ` +
				`graphBuilder.ini but BLANK. Name a path or remove the key; it is not guessed at.`,
		};
	}
	return {
		error:
			`graphBuilder ${actionName}: no support store path resolved, and there is NO DEFAULT. Set ` +
			`[stores] graphBuilderSupportFilePath in graphBuilder.ini, or pass ` +
			`--standardsDatabaseFilePath=<path> to override it. A configured path is an operator ` +
			`speaking through a file; an ABSENT key is silence, and silence is refused here exactly as ` +
			`an unnamed path always was — a caller that does not say where it is writing is a caller ` +
			`that can write anywhere (standards-database.js:92). Config-supplied is not a code default.`,
	};
};

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
				`override and no support store path to take it from. There is no default.`,
		};
	}
	// SINGLE FILE (TQ ruling, 2026-08-04). This used to DERIVE a sibling `<name>.decisions<ext>`
	// beside the standards database, which was correct while the two were separate files. Under the
	// single-store ruling the decision blocks live in the SAME file as everything else, so the
	// answer is the support store path itself and no name is composed at all. The sibling derivation
	// is not merely unnecessary now — keeping it would silently split the store back into two files
	// and leave every frozen decision block somewhere the configured path does not describe.
	// decisionBlocks does not collide with any other family's table (audit, 2026-08-04).
	return { decisionStoreFilePath: standardsDatabaseFilePath };
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
	// The path now comes from [stores] graphBuilderSupportFilePath, with --standardsDatabaseFilePath
	// still winning as an override. The REFUSAL IS UNCHANGED: resolveSupportStoreFilePath has no
	// `|| default` in it, so an absent config key and an absent flag together are refused by name
	// rather than resolved to anywhere.
	const supportStoreResolution = resolveSupportStoreFilePath({
		explicitValue: firstValue(process.global.commandLineParameters, 'standardsDatabaseFilePath'),
		configuredValue: process.global.getConfig('stores').graphBuilderSupportFilePath,
		actionName: '-build',
	});
	if (supportStoreResolution.error) {
		callback(supportStoreResolution.error);
		return;
	}
	const standardsDatabaseFilePath = supportStoreResolution.filePath;
	xLog.status(
		`graphBuilder: support store at ${standardsDatabaseFilePath} ` +
			`(resolved from ${supportStoreResolution.resolvedFrom})`,
	);

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

	// ⟪P9⟫ THE JUDGMENT CACHE AND THE FORENSIC MATCH LOG ARE OPENED HERE TOO — stateful shared
	// resources, so the orchestrator owns them (polyArch2 §2) and the pipeline receives them. Both
	// DEFAULT ON (their canonical dataStores homes, prepared above when defaulted); either is
	// disabled with an explicit '=false'. An open failure is a FAULT named through the callback,
	// never a silent fall-through to an uncached/unlogged run (embedding-client's own ensureCache
	// discipline: silently resuming spend without persistence is exactly what P9 exists to end).
	// SINGLE FILE (TQ ruling 2026-08-04): the judgment cache now lives IN the support store rather
	// than in its own dataStores home, so the "documented default" it takes when the parameter is
	// absent is the CONFIGURED support store — a path an operator named — not the in-code constant.
	// '--judgmentCacheFilePath=false' still disables it and an explicit path still redirects it,
	// because a judgment is real spent money and losing one is crazy (TQ ruling, 2026-07-30).
	const judgmentCachePathResolution = resolvePersistencePath({
		explicitValue: firstValue(process.global.commandLineParameters, 'judgmentCacheFilePath'),
		defaultPath: standardsDatabaseFilePath,
		parameterName: 'judgmentCacheFilePath',
		prepareDir: path.dirname(standardsDatabaseFilePath),
	});
	if (judgmentCachePathResolution.error) {
		callback(judgmentCachePathResolution.error);
		return;
	}
	const matchForensicsPathResolution = resolvePersistencePath({
		explicitValue: firstValue(process.global.commandLineParameters, 'matchForensicsDirPath'),
		defaultPath: MATCH_FORENSICS_DEFAULT_DIR_PATH,
		parameterName: 'matchForensicsDirPath',
		prepareDir: MATCH_FORENSICS_DEFAULT_DIR_PATH,
	});
	if (matchForensicsPathResolution.error) {
		callback(matchForensicsPathResolution.error);
		return;
	}

	// openJudgmentCache / openMatchForensics — each yields its opened api, or null when disabled.
	const openJudgmentCache = (done) => {
		if (judgmentCachePathResolution.disabled) {
			xLog.status(`graphBuilder: judgment cache DISABLED (--judgmentCacheFilePath=false)`);
			done('', null);
			return;
		}
		requireJudgmentCache()().open({ databaseFilePath: judgmentCachePathResolution.filePath }, (openErr, api) => {
			if (openErr) {
				done(`graphBuilder -build: ${openErr}`);
				return;
			}
			xLog.status(`graphBuilder: judgment cache at ${judgmentCachePathResolution.filePath}`);
			done('', api);
		});
	};
	const openMatchForensics = (done) => {
		if (matchForensicsPathResolution.disabled) {
			xLog.status(`graphBuilder: forensic match log DISABLED (--matchForensicsDirPath=false)`);
			done('', null);
			return;
		}
		requireMatchForensics()().open({ baseDirPath: matchForensicsPathResolution.filePath }, (openErr, api) => {
			if (openErr) {
				done(`graphBuilder -build: ${openErr}`);
				return;
			}
			xLog.status(`graphBuilder: forensic match log at ${matchForensicsPathResolution.filePath}`);
			done('', api);
		});
	};

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
			openJudgmentCache((judgmentCacheError, judgmentCache) => {
				if (judgmentCacheError) {
					callback(judgmentCacheError);
					return;
				}
				openMatchForensics((matchForensicsError, matchForensics) => {
					if (matchForensicsError) {
						callback(matchForensicsError);
						return;
					}
					buildLib.build(
						recipe,
						{
							xLog,
							standardsDatabase,
							decisionStore,
							judgmentCache,
							matchForensics,
							recipePath: read.recipePath,
							recipeText: read.recipeText,
						},
						(buildError, result) => {
							if (buildError) {
								callback(`graphBuilder -build failed: ${buildError}`);
								return;
							}
							callback('', { exitCode: 0, resultText: JSON.stringify(result, null, 2) });
						},
					);
				});
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

	// Same resolution as -build, and deliberately the SAME function rather than a second copy of the
	// precedence rule: a replay that resolved its store differently from the build that wrote it is
	// how a replay ends up reproducing the wrong graph. The refusal is likewise unchanged — an absent
	// config key with no flag is refused by name, never resolved to a path.
	const supportStoreResolution = resolveSupportStoreFilePath({
		explicitValue: firstValue(process.global.commandLineParameters, 'standardsDatabaseFilePath'),
		configuredValue: process.global.getConfig('stores').graphBuilderSupportFilePath,
		actionName: '-replay',
	});
	if (supportStoreResolution.error) {
		callback(supportStoreResolution.error);
		return;
	}
	const standardsDatabaseFilePath = supportStoreResolution.filePath;

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

// ---------------------------------------------------------------------
// -retrievalMetrics
// ---------------------------------------------------------------------
// ⟪P11, 2026-07-31⟫ THE INSTRUMENT. Measure how well candidate selection is working, from the
// forensic match log a --rebridge already wrote. READ-ONLY and FREE: no graph, no standards
// database, no decision store, no LLM, no Voyage — it opens .jsonl trails and computes. That is
// the whole point: this project had been issuing quality verdicts with no instrument, and the
// verdicts cost real money.
//
// --pairKey is REQUIRED and has no default (a measurement is always OF a standard pairing).
// --generation is OPTIONAL and, absent, measures EVERY generation under the pair — comparing
// generations side by side is why they are kept side by side, and picking one silently is exactly
// the question a default would answer wrongly.
//
// The READABLE REPORT is the result on stdout; the JSON SIDECAR is written beside the trail it
// measures (<pairDir>/<generation>.retrievalMetrics.json) so a stored number can always be traced
// back to the trail and the instrument version that produced it.

const retrievalMetricsAction = (callback) => {
	const { xLog, commandLineParameters } = process.global;

	const pairKey = firstValue(commandLineParameters, 'pairKey');
	if (!pairKey) {
		callback(
			`graphBuilder -retrievalMetrics: --pairKey=<pairKey> is REQUIRED and has no default ` +
				`(e.g. --pairKey=CEDS::CASE). A metrics run is always ABOUT one standard pairing; there ` +
				`is no meaningful aggregate across pairings that judge different standards.`,
		);
		return;
	}

	// --matchForensicsDirPath names the SAME directory -build writes to — ONE name across both boundaries (house rule), and
	// defaults to the SAME documented canonical home. The reader's parameter is named for what it
	// reads; the writer's for what it writes. The default is NOT prepared here — a metrics run
	// against a directory that does not exist has nothing to measure and says so.
	const explicitForensicsDirPath = firstValue(commandLineParameters, 'matchForensicsDirPath');
	if (typeof explicitForensicsDirPath === 'string' && explicitForensicsDirPath.trim() === '') {
		callback(
			`graphBuilder -retrievalMetrics: --matchForensicsDirPath was given but blank. Pass a path, or ` +
				`omit it to take the documented default (${MATCH_FORENSICS_DEFAULT_DIR_PATH}). A blank is ` +
				`refused rather than guessed at.`,
		);
		return;
	}
	const forensicsDirPath = explicitForensicsDirPath || MATCH_FORENSICS_DEFAULT_DIR_PATH;

	const generation = firstValue(commandLineParameters, 'generation');

	// --cosineCutoff restates the composer's own retrieval top-K, which the log does not record.
	// Only a positive integer is accepted; a garbage value is refused BY NAME rather than
	// NaN-ing every rank comparison downstream into silent falsehood.
	const rawCosineCutoff = firstValue(commandLineParameters, 'cosineCutoff');
	let cosineCutoff;
	if (rawCosineCutoff !== undefined) {
		if (!/^\d+$/.test(String(rawCosineCutoff).trim()) || parseInt(rawCosineCutoff, 10) < 1) {
			callback(
				`graphBuilder -retrievalMetrics: --cosineCutoff='${rawCosineCutoff}' is not a positive ` +
					`integer. It names the cosine rank within which a candidate would have been retrieved ` +
					`by cosine alone; omit it to take the documented default (15).`,
			);
			return;
		}
		cosineCutoff = parseInt(rawCosineCutoff, 10);
	}

	// --abstentionFlagPercent is stated as a PERCENT on the control surface (an operator says 5,
	// not 0.05) and converted to the share the library takes. One name, two honest units, the
	// conversion in exactly one place.
	const rawFlagPercent = firstValue(commandLineParameters, 'abstentionFlagPercent');
	let flagThreshold;
	if (rawFlagPercent !== undefined) {
		const parsedPercent = Number(String(rawFlagPercent).trim());
		if (!isFinite(parsedPercent) || parsedPercent < 0 || parsedPercent > 100) {
			callback(
				`graphBuilder -retrievalMetrics: --abstentionFlagPercent='${rawFlagPercent}' is not a ` +
					`number between 0 and 100. It is the share of abstentions above which a phrase probe ` +
					`becomes a FLAGGED SIGNAL; omit it to take the documented default (5).`,
			);
			return;
		}
		flagThreshold = parsedPercent / 100;
	}

	const explicitSidecarDirPath = firstValue(commandLineParameters, 'sidecarDirPath');
	if (typeof explicitSidecarDirPath === 'string' && explicitSidecarDirPath.trim() === '') {
		callback(
			`graphBuilder -retrievalMetrics: --sidecarDirPath was given but blank. Pass a directory, or ` +
				`omit it to write each sidecar beside the trail it measures.`,
		);
		return;
	}

	const retrievalMetricsLib = requireRetrievalMetrics()();

	retrievalMetricsLib.measurePair(
		{ forensicsDirPath, pairKey, generation, cosineCutoff, flagThreshold },
		(measureError, measured) => {
			if (measureError) {
				callback(`graphBuilder -retrievalMetrics: ${measureError}`);
				return;
			}

			// The sidecar is written BEFORE the report is returned, and a write failure is a FAULT
			// named through the callback. A run that printed numbers but silently failed to persist
			// them would be a measurement nobody can go back and check — which is the condition this
			// verb exists to end.
			const sidecarPaths = [];
			let sidecarFault = '';
			measured.reports.forEach((oneReport) => {
				if (sidecarFault) {
					return;
				}
				const sidecarDirPath =
					explicitSidecarDirPath || path.dirname(oneReport.forensicFilePath);
				const sidecarFilePath = path.join(
					sidecarDirPath,
					`${oneReport.generation}.retrievalMetrics.json`,
				);
				try {
					fs.mkdirSync(sidecarDirPath, { recursive: true });
					fs.writeFileSync(sidecarFilePath, `${JSON.stringify(oneReport, null, 2)}\n`, 'utf8');
				} catch (writeError) {
					sidecarFault = `writing the JSON sidecar '${sidecarFilePath}': ${writeError.message}`;
					return;
				}
				sidecarPaths.push(sidecarFilePath);
			});
			if (sidecarFault) {
				callback(`graphBuilder -retrievalMetrics: ${sidecarFault}`);
				return;
			}

			retrievalMetricsLib.renderReportText(
				{ reports: measured.reports },
				(renderError, rendered) => {
					if (renderError) {
						callback(`graphBuilder -retrievalMetrics: ${renderError}`);
						return;
					}
					sidecarPaths.forEach((onePath) => {
						xLog.status(`graphBuilder: retrieval-metrics sidecar written to ${onePath}`);
					});
					callback('', { exitCode: 0, resultText: rendered.reportText });
				},
			);
		},
	);
};

// ---------------------------------------------------------------------
// -cedsRoundTrip
// ---------------------------------------------------------------------
// ⟪TQ RULING, 2026-08-02⟫ "the CEDS OWL source describes a graph. We want to represent it as a
// graph. We should be able to write a graph that we could extract and compile back into the OWL."
// ROUND-TRIP FIDELITY is the acceptance criterion for hub completeness, and this verb is the
// MEASURING STICK: it compiles the materialized CEDS graph back into RDF/XML, diffs that emission
// against the source ontology as canonical statement SETS, and reports the loss.
//
// READ-ONLY EVERYWHERE. It opens the named container over bolt and issues MATCH/RETURN only; it
// never writes to a graph, never forges, never spends a cent of LLM or Voyage credit. The only
// things it writes are its own three artifacts (the emitted RDF, the readable report, the JSON
// sidecar).
//
// IT DOES NOT FIX ANYTHING. The loss it reports is expected to be enormous — the source carries
// roughly 240,000 statements and the graph today carries a fraction. A large HONEST diff IS the
// deliverable: it is the baseline every future enrichment gets scored against, and the
// per-predicate loss table is the enrichment work order.
//
// --containerName is REQUIRED and has no default: a fidelity measurement is always OF one
// materialized graph, and there is no meaningful "whichever graph happens to be running".

const CEDS_ROUND_TRIP_DEFAULT_DIR_PATH =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/cedsRoundTrip';

const requireCedsRoundTripCompiler = () =>
	require(path.join(__dirname, '..', '..', '..', 'forges', 'ceds', 'lib', 'roundTripCompiler'));
const requireCedsRoundTripDiff = () =>
	require(path.join(__dirname, '..', '..', '..', 'forges', 'ceds', 'lib', 'roundTripDiff'));

// The CEDS source ontology's documented home in this tree: the snapshot the CEDS forge bundle
// itself reads (forges/ceds/parserDescriptor.ini names snapshot 01 and CEDS-Ontology.rdf). The
// default is DOCUMENTED rather than discovered so a measurement always names the file it measured.
const CEDS_SOURCE_DEFAULT_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'forges',
	'ceds',
	'assets',
	'standardSourceData',
	'01',
	'CEDS-Ontology.rdf',
);

const cedsRoundTripAction = (callback) => {
	const { xLog, commandLineParameters } = process.global;

	const containerName = firstValue(commandLineParameters, 'containerName');
	if (!containerName) {
		callback(
			`graphBuilder -cedsRoundTrip: --containerName=<name> is REQUIRED and has no default. A ` +
				`fidelity measurement is always OF one materialized graph; there is no meaningful ` +
				`"whichever graph happens to be running". The bolt port and credential are read from ` +
				`that container with 'docker inspect', never restated here where they could drift.`,
		);
		return;
	}

	// Each optional path follows the same discipline the P9 stores established: a blank value is
	// REFUSED BY NAME rather than silently taken as "use the default".
	const optionalPath = ({ parameterName, defaultPath }) => {
		const explicitValue = firstValue(commandLineParameters, parameterName);
		if (typeof explicitValue === 'string' && explicitValue.trim() === '') {
			return {
				error:
					`graphBuilder -cedsRoundTrip: --${parameterName} was given but blank. Pass a path, or ` +
					`omit it to take the documented default (${defaultPath}). A blank is refused rather ` +
					`than guessed at.`,
			};
		}
		return { filePath: explicitValue || defaultPath };
	};

	const sourceResolution = optionalPath({
		parameterName: 'sourcePath',
		defaultPath: CEDS_SOURCE_DEFAULT_PATH,
	});
	if (sourceResolution.error) {
		callback(sourceResolution.error);
		return;
	}
	if (!fs.existsSync(sourceResolution.filePath)) {
		callback(
			`graphBuilder -cedsRoundTrip: the CEDS source ontology '${sourceResolution.filePath}' does ` +
				`not exist. There is nothing to measure the graph AGAINST, and a measurement without a ` +
				`source is not a smaller measurement — it is no measurement at all.`,
		);
		return;
	}

	const outResolution = optionalPath({
		parameterName: 'outPath',
		defaultPath: path.join(CEDS_ROUND_TRIP_DEFAULT_DIR_PATH, `${containerName}.emitted.rdf`),
	});
	if (outResolution.error) {
		callback(outResolution.error);
		return;
	}
	const reportResolution = optionalPath({
		parameterName: 'reportPath',
		defaultPath: path.join(CEDS_ROUND_TRIP_DEFAULT_DIR_PATH, `${containerName}.roundTrip.txt`),
	});
	if (reportResolution.error) {
		callback(reportResolution.error);
		return;
	}
	const emittedFilePath = outResolution.filePath;
	const reportFilePath = reportResolution.filePath;
	const sidecarFilePath = `${reportFilePath.replace(/\.txt$/, '')}.json`;

	const compilerLib = requireCedsRoundTripCompiler()();
	const diffRoundTripLib = requireCedsRoundTripDiff()();

	compilerLib.resolveContainerBolt({ containerName }, (resolveError, resolved) => {
		if (resolveError) {
			callback(`graphBuilder -cedsRoundTrip: ${resolveError}`);
			return;
		}
		xLog.status(
			`graphBuilder: -cedsRoundTrip reading '${containerName}' at ${resolved.boltUrl} ` +
				`(MATCH/RETURN only — this verb never writes to a graph)`,
		);

		const reader = compilerLib.makeNeo4jCedsReader({
			boltUrl: resolved.boltUrl,
			user: resolved.user,
			password: resolved.password,
		});

		compilerLib.compileToFile({ reader, outPath: emittedFilePath }, (compileError, compiled) => {
			reader.close((closeError) => {
				if (closeError) {
					xLog.error(`graphBuilder -cedsRoundTrip: ${closeError}`);
				}
				if (compileError) {
					callback(`graphBuilder -cedsRoundTrip: ${compileError}`);
					return;
				}
				xLog.status(
					`graphBuilder: -cedsRoundTrip emitted ${compiled.counts.class} class(es), ` +
						`${compiled.counts.property} propert(ies), ${compiled.counts.optionSet} option set(s), ` +
						`${compiled.counts.optionValue} option value(s) to ${emittedFilePath}`,
				);
				(compiled.readerNotes.unresolvedDomainIds || []).forEach((oneNote) =>
					xLog.error(`graphBuilder -cedsRoundTrip: UNRESOLVABLE REFERENCE — ${oneNote}`),
				);

				diffRoundTripLib.compareRdfFiles(
					{
						sourcePath: sourceResolution.filePath,
						emittedPath: emittedFilePath,
						context: {
							containerName,
							boltUrl: resolved.boltUrl,
							sourcePath: sourceResolution.filePath,
							emittedPath: emittedFilePath,
							emittedCounts: JSON.stringify(compiled.counts),
						},
					},
					(compareError, compared) => {
						if (compareError) {
							callback(`graphBuilder -cedsRoundTrip: ${compareError}`);
							return;
						}
						diffRoundTripLib.renderReportText(
							{ report: compared.report },
							(renderError, rendered) => {
								if (renderError) {
									callback(`graphBuilder -cedsRoundTrip: ${renderError}`);
									return;
								}
								// BOTH artifacts are written BEFORE the report is returned, and a write
								// failure is a FAULT named through the callback. A run that printed numbers
								// and silently failed to persist them is a measurement nobody can go back
								// and check — the same discipline -retrievalMetrics applies to its sidecar.
								let writeFault = '';
								try {
									fs.mkdirSync(path.dirname(reportFilePath), { recursive: true });
									fs.writeFileSync(reportFilePath, rendered.reportText, 'utf8');
									fs.mkdirSync(path.dirname(sidecarFilePath), { recursive: true });
									fs.writeFileSync(
										sidecarFilePath,
										`${JSON.stringify(compared.report, null, 2)}\n`,
										'utf8',
									);
								} catch (writeError) {
									writeFault = writeError.message;
								}
								if (writeFault) {
									callback(
										`graphBuilder -cedsRoundTrip: writing the report artifacts failed: ${writeFault}`,
									);
									return;
								}
								xLog.status(`graphBuilder: -cedsRoundTrip report written to ${reportFilePath}`);
								xLog.status(`graphBuilder: -cedsRoundTrip JSON sidecar written to ${sidecarFilePath}`);
								callback('', { exitCode: 0, resultText: rendered.reportText });
							},
						);
					},
				);
			});
		});
	});
};

// ---------------------------------------------------------------------
// -cedsGates
// ---------------------------------------------------------------------
// ⟪TQ, 2026-08-02⟫ "Please enhance the spec with very thorough gates."
//
// Runs the CEDS fidelity gate suite: 46 gates declared as DATA in
// forges/ceds/gates/cedsFidelityGates.jsonc, evaluated by roundTripGates, measured by
// roundTripGateMeasures, and proven by roundTripGateTwins.
//
// THE VERDICT IS A WORD, NEVER A PERCENTAGE. Acceptance is zero FAIL, zero UNMEASURED and
// zero UNPROVEN. A tampered emission carrying four fabricated statements still reported
// 71.936% -- proven live during the audit -- so a percentage cannot be trusted to decide
// anything, and none participates here.
//
// A RED SUITE DURING ENRICHMENT IS CORRECT. Its redness is the work order. There is
// deliberately no expected-to-fail state; that is masking with a lanyard (gate M-2).
//
// READ-ONLY. Every measure is MATCH/RETURN and refuseIfWriteClause enforces it mechanically
// before any statement is issued.

const requireGatesLib = () =>
	require(path.join(__dirname, '..', '..', '..', 'forges', 'ceds', 'lib', 'roundTripGates'));
const requireGateMeasuresLib = () =>
	require(path.join(__dirname, '..', '..', '..', 'forges', 'ceds', 'lib', 'roundTripGateMeasures'));
const requireGateTwinsLib = () =>
	require(path.join(__dirname, '..', '..', '..', 'forges', 'ceds', 'lib', 'roundTripGateTwins'));

const cedsGatesAction = (callback) => {
	const { xLog, commandLineParameters } = process.global;

	const containerName = firstValue(commandLineParameters, 'containerName');
	if (!containerName) {
		callback(
			`graphBuilder -cedsGates: --containerName=<name> is REQUIRED and has no default. Gates ` +
				`are always measured AGAINST one materialized graph; there is no "whichever graph ` +
				`happens to be running".`,
		);
		return;
	}
	const reportJsonPath = firstValue(commandLineParameters, 'reportJsonPath');

	const gatesLib = requireGatesLib()();
	const measuresLib = requireGateMeasuresLib()();
	const twinsLib = requireGateTwinsLib()();

	gatesLib.loadGateDeclarations({}, (loadError, loadResult) => {
		if (loadError) {
			callback(`graphBuilder -cedsGates: ${loadError}`);
			return;
		}
		const { declarations } = loadResult;

		measuresLib.loadSuiteFacts({}, (factsError, factsResult) => {
			if (factsError) {
				callback(`graphBuilder -cedsGates: ${factsError}`);
				return;
			}

			// The round-trip report is OPTIONAL input. Without it every report-derived gate goes
			// UNMEASURED, which is a failure and says so -- rather than a silent pass.
			let report = null;
			if (reportJsonPath) {
				if (!fs.existsSync(reportJsonPath)) {
					callback(
						`graphBuilder -cedsGates: --reportJsonPath '${reportJsonPath}' does not exist. ` +
							`Run -cedsRoundTrip first, or omit the flag and accept UNMEASURED report gates.`,
					);
					return;
				}
				report = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
			} else {
				measuresLib.record(
					'report:*',
					'no --reportJsonPath was given, so no round-trip report was supplied',
				);
			}

			xLog.status(`graphBuilder: -cedsGates measuring '${containerName}' (read-only)`);

			measuresLib.measureGraph({ containerName }, (graphError, graphResult) => {
				if (graphError) {
					callback(`graphBuilder -cedsGates: ${graphError}`);
					return;
				}
				measuresLib.deriveCanonicalProbes((canonicalError, canonicalProbes) => {
					if (canonicalError) {
						callback(`graphBuilder -cedsGates: ${canonicalError}`);
						return;
					}
					measuresLib.deriveDiffProbes((diffProbeError, diffProbes) => {
						if (diffProbeError) {
							callback(`graphBuilder -cedsGates: ${diffProbeError}`);
							return;
						}
						// C-3: the OUTSIDE opinion. Runs only when both documents are named --
						// --sourcePath and --emittedPath -- because a comparison is always OF two
						// specific files. Omitted, the gate reads UNMEASURED with that reason,
						// which is the honest state and never a pass.
						const independentSourcePath = firstValue(commandLineParameters, 'sourcePath');
						const independentEmittedPath = firstValue(commandLineParameters, 'emittedPath');
						if (independentSourcePath && independentEmittedPath) {
							xLog.status(
								`graphBuilder: -cedsGates running the INDEPENDENT rdflib comparison ` +
									`(parses 19MB twice; ~90s)`,
							);
						}
						measuresLib.deriveIndependentRdfProbe(
							{ sourcePath: independentSourcePath, emittedPath: independentEmittedPath },
							(independentError, independentProbes) => {
						if (independentError) {
							callback(`graphBuilder -cedsGates: ${independentError}`);
							return;
						}
						measuresLib.recordDeferredMeasures();

						const measurements = {
							report: { ...(report || {}), ...measuresLib.deriveReportMeasures({ report }) },
							graph: graphResult.graphMeasures,
							probe: {
								...measuresLib.deriveStaticProbes(),
								...canonicalProbes,
								...diffProbes,
								...independentProbes,
							},
							suite: {},
						};

						// Twins run FIRST: a gate can only be PASS once its twin has been watched
						// turning it RED, so the observation set is an input to the evaluation.
						gatesLib.runTwins(
							{ declarations, measurements, twinRegistry: twinsLib.twinRegistry },
							(twinError, twinResult) => {
								if (twinError) {
									callback(`graphBuilder -cedsGates: ${twinError}`);
									return;
								}
								measurements.suite = measuresLib.deriveSuiteMeasures({
									declarations,
									suiteFacts: factsResult.suiteFacts,
									observedTwins: twinResult.observedTwins,
								});

								gatesLib.evaluateSuite(
									{ declarations, measurements, observedTwins: twinResult.observedTwins },
									(evaluateError, evaluateResult) => {
										if (evaluateError) {
											callback(`graphBuilder -cedsGates: ${evaluateError}`);
											return;
										}
										gatesLib.renderSuiteText(
											{
												suiteResult: evaluateResult.suiteResult,
												twinReports: twinResult.twinReports,
											},
											(renderError, rendered) => {
												if (renderError) {
													callback(`graphBuilder -cedsGates: ${renderError}`);
													return;
												}
												const unsuppliedLines = measuresLib.unsupplied.length
													? [
															'',
															'-'.repeat(96),
															'UNSUPPLIED MEASURES — why these gates read UNMEASURED',
															'-'.repeat(96),
														].concat(
															measuresLib.unsupplied.map(
																(one) => `  ${one.name}\n      ${one.reason}`,
															),
														)
													: [];
												callback('', {
													exitCode: evaluateResult.suiteResult.accepted ? 0 : 1,
													resultText: [rendered.text]
														.concat(unsuppliedLines)
														.join('\n'),
												});
											},
										);
									},
								);
							},
						);
							},
						);
					});
				});
			});
		});
	});
};

// =====================================================================
// -goldEvalCheck — the GOLD_EVAL certification verb (RT-13.4 / R-WO-20)
// =====================================================================
// GNC-001 promotion (DEV build -> GOLD_EVAL_<YYMMDD>) is an operational docker rename; this
// verb is the code-side gate that makes the doctrine's certification clause RUNNABLE instead
// of remembered: "GOLD_EVAL certification requires every declared validator to have run and
// reported — no golden is declared without the verdicts in hand" (doctrine §7.4). The intended
// operational law (stated here as the verb's purpose; the skill/imperative edit is TQ's and
// the supervisor's): no DEV build is renamed GOLD_EVAL without a PASS from this check on its
// build run directory.
//
// It reads the stage summary the -build landed (roundTrip/roundTripStageSummary.json — the
// path also rides the build result as roundTripSummaryPath) and REFUSES BY NAME when:
//   * the stage did not run (off, or a pre-RT-13 build with no summary at all);
//   * any DECLARED bundle did not run or its verdict artifact is missing on disk;
//   * any inventedTotal is nonzero (the hard line — although the stage itself already fails
//     such a build, a hand-doctored or stale summary must not certify).
// Declared-ABSENT bundles are tolerated during the big-bang retrofit and LISTED in the
// certification output — the reader sees exactly what was not checked.
const goldEvalCheckAction = (callback) => {
	const { xLog } = process.global;
	const roundTripStageStatics = require('./round-trip-stage');
	const buildLogDirPath = firstValue(process.global.commandLineParameters, 'buildLogDirPath');
	if (!buildLogDirPath) {
		callback(
			`graphBuilder -goldEvalCheck: --buildLogDirPath=<the build's run directory under ` +
				`dataStores/buildLogs> is REQUIRED and has no default — certification is a claim ` +
				`about ONE build's evidence, and the build must be named.`,
		);
		return;
	}
	const summaryFilePath = path.join(
		buildLogDirPath,
		roundTripStageStatics.STAGE_SUBDIR_NAME,
		roundTripStageStatics.STAGE_SUMMARY_FILE_NAME,
	);
	if (!fs.existsSync(summaryFilePath)) {
		callback(
			`graphBuilder -goldEvalCheck: no stage summary at '${summaryFilePath}'. Either the ` +
				`path is not a build run directory, or the build predates the RT-13 stage — in ` +
				`both cases there is no round-trip evidence and nothing can be certified.`,
		);
		return;
	}
	let summary;
	// boundary translation of a parse fault into the callback channel — a summary that does
	// not parse is evidence that cannot certify, named as such.
	try {
		summary = JSON.parse(fs.readFileSync(summaryFilePath, 'utf-8'));
	} catch (parseError) {
		callback(
			`graphBuilder -goldEvalCheck: the stage summary '${summaryFilePath}' does not parse ` +
				`(${parseError.message}) — unreadable evidence certifies nothing.`,
		);
		return;
	}
	if (summary.stageRan !== true) {
		callback(
			`graphBuilder -goldEvalCheck: REFUSED — the round-trip stage did not run for this ` +
				`build (summary disposition: '${summary.disposition}'). GOLD_EVAL certification ` +
				`requires every declared validator to have run and reported (doctrine §7.4); ` +
				`rebuild with roundTripStage: true in the recipe.`,
		);
		return;
	}
	const declaredRows = (summary.standards || []).filter(
		(oneRow) => oneRow.disposition === 'declared',
	);
	const failures = [];
	declaredRows.forEach((oneRow) => {
		if (oneRow.ran !== true) {
			failures.push(`'${oneRow.token}' is declared but its validator did not run`);
			return;
		}
		if (typeof oneRow.verdictPath !== 'string' || !fs.existsSync(oneRow.verdictPath)) {
			failures.push(
				`'${oneRow.token}' ran but its verdict artifact is missing ` +
					`(expected: ${oneRow.verdictPath})`,
			);
			return;
		}
		if (oneRow.inventedTotal > 0) {
			failures.push(
				`'${oneRow.token}' reports inventedTotal=${oneRow.inventedTotal} — INVENTED must ` +
					`be 0 (doctrine §5.3)`,
			);
		}
	});
	if (failures.length) {
		callback(
			`graphBuilder -goldEvalCheck: REFUSED —\n  - ${failures.join('\n  - ')}`,
		);
		return;
	}
	const absentTokens = summary.absentTokens || [];

	// ⟪B3, 2026-08-16⟫ THE BRIDGE SIBLING (SPEC-bridgeFramework-v1 §12 item 7, BG-DEBUG (c); RULING R5;
	// B2 review ruling for B3): a relationship block carrying ANY edge with provenanceTier 'invalid-debug'
	// (a debug-judge block) MUST NOT reach a certified graph. The RULE is the framework's
	// (lib/bridge-framework/certificationCheck.js); the WIRING here reads the run's MANIFEST out of the
	// standardsDatabase (the artifact — no container) and audits every relationship member block's edge
	// list (apps/graph-builder/lib/gold-eval-bridge-sibling.js).
	//
	// HOW IT IS INVOKED, and why this is not a silent default: the run directory records no manifest id
	// (build.js writes only the round-trip stage summary there, and build.js is a seam file), so the
	// sibling is driven by --manifestRefId=<the manifest -build printed>, with the store resolved exactly
	// as -replay resolves it (an explicit --standardsDatabaseFilePath wins over the configured support
	// store; neither → refused by name). WITHOUT --manifestRefId the sibling DOES NOT RUN and the verdict
	// SAYS SO BY NAME on the status line and in the payload (scope 'forgeRoundTripOnly',
	// mappingEdgesCertified false): a forge-only build certifies exactly as before B3, and a bridged
	// build cannot be promoted on a forge-only PASS without the promoter reading that it was forge-only.
	// A manifest with ZERO relationship members is REPORTED (mappingBlockList []), never a refusal.
	const manifestRefId = firstValue(process.global.commandLineParameters, 'manifestRefId');
	// ⟪B3 tightening, SABLE_RIVER freeze ruling 2026-08-16⟫ when the RECIPE DECLARES bridges[] and the sibling did
	// not run, goldEvalCheck must NOT answer PASS — a bridged build is refused by name until its mapping edges are
	// audited. The recipe is located from the run directory's own name (<recipeName>_<stamp> under buildLogs →
	// recipes/<recipeName>.recipe.jsonc in this tree), or named explicitly with --recipePath; a run directory whose
	// recipe cannot be located leaves the bridge declaration UNKNOWN, and the verdict says so by name (a synthetic
	// or foreign run directory certifies its forge round trip only — the promoter reads that it was forge-only).
	const explicitRecipePath = firstValue(process.global.commandLineParameters, 'recipePath');
	const recipeNameFromRunDir = path.basename(buildLogDirPath).replace(/_\d{8}-\d{6}$/, '');
	const derivedRecipePath = path.join(__dirname, '..', '..', '..', 'recipes', `${recipeNameFromRunDir}.recipe.jsonc`);
	const recipePathForBridges = explicitRecipePath || (fs.existsSync(derivedRecipePath) ? derivedRecipePath : null);
	const loadedRecipe = recipePathForBridges ? recipeLib.loadRecipe(recipePathForBridges) : null;
	if (loadedRecipe && loadedRecipe.error) {
		callback(`graphBuilder -goldEvalCheck: REFUSED — the recipe named for the bridge declaration (${recipePathForBridges}) does not load: ${loadedRecipe.error}`);
		return;
	}
	const bridgeDeclaration = loadedRecipe ? { known: true, recipePath: recipePathForBridges, bridgeCount: Array.isArray(loadedRecipe.recipe.bridges) ? loadedRecipe.recipe.bridges.length : 0 } : { known: false, recipePath: null, bridgeCount: null, note: `recipe not located (run dir '${path.basename(buildLogDirPath)}' → ${derivedRecipePath} absent; pass --recipePath to name it) — bridge declaration UNKNOWN` };
	if (!manifestRefId && bridgeDeclaration.known && bridgeDeclaration.bridgeCount > 0) {
		callback(`graphBuilder -goldEvalCheck: REFUSED — the recipe ${recipePathForBridges} DECLARES ${bridgeDeclaration.bridgeCount} bridge(s); mapping edges UNCERTIFIED — pass --manifestRefId=<the manifest -build printed> (and --standardsDatabaseFilePath=<its store>) so the bridge sibling audits the manifest's relationship blocks; a bridged build never certifies on the forge round trip alone`);
		return;
	}
	const emitVerdict = (bridgeSibling) => {
		const scopeText = bridgeSibling.ran
			? `bridge sibling: ${bridgeSibling.mappingBlockList.length} relationship block(s) audited, ${bridgeSibling.mappingBlockList.reduce((soFar, oneBlock) => soFar + oneBlock.edgeCount, 0)} mapping edge(s), 0 invalid-debug`
			: `FORGE ROUND TRIP ONLY — bridge sibling NOT RUN (${bridgeSibling.notRunReason}); ${bridgeDeclaration.known ? `recipe declares ${bridgeDeclaration.bridgeCount} bridge(s)` : bridgeDeclaration.note}; MAPPING EDGES UNCERTIFIED`;
		xLog.status(
			`graphBuilder: [goldEvalCheck] PASS — ${declaredRows.length} declared validator(s) ran ` +
				`with inventedTotal=0${absentTokens.length ? `; ${absentTokens.length} bundle(s) declared-ABSENT (tolerated during the retrofit): ${absentTokens.join(', ')}` : ''}; ${scopeText}`,
		);
		callback('', {
			exitCode: 0,
			resultText: JSON.stringify(
				{
					certification: 'PASS',
					scope: bridgeSibling.ran ? 'forgeRoundTripAndMappingEdges' : 'forgeRoundTripOnly',
					mappingEdgesCertified: bridgeSibling.ran,
					bridgeDeclaration,
					bridgeSibling,
					summaryFilePath,
					containerName: summary.containerName,
					declared: declaredRows.map((oneRow) => ({
						token: oneRow.token,
						roundTripClean: oneRow.roundTripClean,
						inventedTotal: oneRow.inventedTotal,
						lostTotal: oneRow.lostTotal,
						// ⟪PHASE 7, F-6⟫ THIS PAYLOAD IS WHAT A PROMOTER READS, and it stated `lostTotal: 0`
						// bare. The qualification must travel with the zero: lostTotal counts loss only in
						// the dimensions the comparator MODELS, and a dimension unread by the emitter AND
						// unmeasured by the canonicalizer reports zero on both sides and reads as fidelity.
						//
						// A MISSING KEY HERE MEANS EXACTLY ONE THING, because round-trip-stage.js now always
						// writes it (either the bundle's declaration or an explicit NONE DECLARED marker):
						// the stage summary was written by a builder that predates this field. Said by name
						// rather than left as an absence, so a stale artifact cannot read as an unqualified
						// clean bill of health.
						semanticValidationLimit:
							typeof oneRow.semanticValidationLimit === 'string' &&
							oneRow.semanticValidationLimit.trim() !== ''
								? oneRow.semanticValidationLimit
								: 'ABSENT FROM THIS STAGE SUMMARY — it was written before the builder carried ' +
									'this field. What this round-trip does and does not model is therefore ' +
									'UNSTATED in the certification evidence; open the verdict at verdictPath, ' +
									'or re-run the build to regenerate the summary.',
						verdictPath: oneRow.verdictPath,
					})),
					declaredAbsentTolerated: absentTokens,
				},
				null,
				2,
			),
		});
	};
	if (!manifestRefId) {
		emitVerdict({ ran: false, notRunReason: 'no --manifestRefId given; pass --manifestRefId=<the manifest -build printed> (and --standardsDatabaseFilePath=<its store>) to audit the manifest\'s relationship blocks', mappingBlockList: [] });
		return;
	}
	const supportStoreResolution = resolveSupportStoreFilePath({
		explicitValue: firstValue(process.global.commandLineParameters, 'standardsDatabaseFilePath'),
		configuredValue: process.global.getConfig('stores').graphBuilderSupportFilePath,
		actionName: '-goldEvalCheck',
	});
	if (supportStoreResolution.error) {
		callback(supportStoreResolution.error);
		return;
	}
	requireStandardsDatabase()().open({ databaseFilePath: supportStoreResolution.filePath }, (openError, standardsDatabase) => {
		if (openError) {
			callback(`graphBuilder -goldEvalCheck: ${openError}`);
			return;
		}
		require('./gold-eval-bridge-sibling').auditManifestMappingBlocks({ standardsDatabase, manifestRefId }, (auditError, audit) => {
			if (auditError) {
				callback(`graphBuilder -goldEvalCheck: REFUSED —\n  - ${auditError}`);
				return;
			}
			if (audit.refusalMessageList.length) {
				callback(`graphBuilder -goldEvalCheck: REFUSED —\n  - ${audit.refusalMessageList.join('\n  - ')}`);
				return;
			}
			emitVerdict({ ran: true, manifestRefId: audit.manifestRefId, standardsDatabaseFilePath: supportStoreResolution.filePath, memberCount: audit.memberCount, mappingBlockList: audit.mappingBlockList });
		});
	});
};

// ---------------------------------------------------------------------
// -truncateStore — empty the support store's tables, but ONLY behind a PROVEN backup
// ---------------------------------------------------------------------
// TQ asked for this explicitly and said he trusts it to be done correctly, so the interesting part is
// not the truncation — it is the refusal.
//
// A BACKUP THAT WAS NEVER OPENED IS NOT A BACKUP. It is a file of the right size in the right place,
// which is exactly what a corrupt copy also looks like. So this does not copy and hope: it takes a
// timestamped copy, OPENS the copy as a database, reads a row count out of EVERY table it is about to
// empty, and requires those counts to equal what the live store held. If the copy cannot be opened, or
// a table is missing from it, or a single count disagrees, it REFUSES BY NAME and the live store is
// left exactly as it was found.
//
// The copy is made with sqlite's own VACUUM INTO rather than a filesystem copy, and that is
// load-bearing rather than a preference. This store runs in WAL mode, so a cp of the main file alone
// silently omits every uncheckpointed page — and this campaign has already met four source stores whose
// contents were largely WAL-resident, two of them with 4,096-byte main files. VACUUM INTO writes a
// fully checkpointed, self-contained database through the engine, so the backup cannot be a torn copy.
//
// TRUNCATION IS BY DELETE, NOT DROP. The tables belong to the five owning modules; emptying rows leaves
// their schema — columns, indexes, triggers — exactly as its owner declared it. A DROP would make this
// function a second, competing declaration of somebody else's schema the next time CREATE TABLE IF NOT
// EXISTS ran, which is precisely the hazard the generation collision is about.
// THE SQLITE RUNNER IS A SEAM, with the real one as its documented default (the R-P2-1 fidelity-gate
// idiom used elsewhere in this tree). Without it the most important branch in this function — "the
// backup's counts DISAGREE with the live store" — is unreachable by any test, because nothing can make
// a freshly written VACUUM INTO copy disagree with the file it was copied from. A refusal no test can
// reach is a refusal nobody has seen work, and this is the refusal TQ asked for by name.
const truncateStoreAction = (callback, injectedDeps = {}) => {
	const { xLog } = process.global;

	const supportStoreResolution = resolveSupportStoreFilePath({
		explicitValue: firstValue(process.global.commandLineParameters, 'standardsDatabaseFilePath'),
		configuredValue: process.global.getConfig('stores').graphBuilderSupportFilePath,
		actionName: '-truncateStore',
	});
	if (supportStoreResolution.error) {
		callback(supportStoreResolution.error);
		return;
	}
	const storeFilePath = supportStoreResolution.filePath;

	if (!fs.existsSync(storeFilePath)) {
		callback(
			`graphBuilder -truncateStore: the support store '${storeFilePath}' does not exist. Refusing ` +
				`— there is nothing to truncate, and reporting success would imply there was.`,
		);
		return;
	}

	// The tables emptied are DATA, one row per owning family, so adding a family is a row here rather
	// than a new branch — and the backup verification therefore covers exactly the tables the
	// truncation touches, with no chance of the two lists drifting apart. sqlite_sequence is
	// deliberately absent: it is sqlite's own AUTOINCREMENT registry, not any family's data, and
	// emptying it would restart the seq numbering that decision-store reads as an append order.
	const truncatableTables = [
		{ tableName: 'blocks', owningFamily: 'standards-database' },
		{ tableName: 'manifests', owningFamily: 'standards-database' },
		{ tableName: 'manifestBlocks', owningFamily: 'standards-database' },
		{ tableName: 'decisionBlocks', owningFamily: 'decision-store' },
		{ tableName: 'vectors', owningFamily: 'vector-store' },
		{ tableName: 'vectorCacheEntries', owningFamily: 'vectorCache' },
		{ tableName: 'judgmentCacheEntries', owningFamily: 'judgment-cache' },
	];

	const runSqliteCli =
		injectedDeps.runSqliteCli ||
		require('../apps/store-migration/migrateCachesIntoSupportStore')({ xLog }).runSqliteCli;

	const countEveryTableText = truncatableTables
		.map((oneTable) => `SELECT '${oneTable.tableName}', count(*) FROM ${oneTable.tableName};`)
		.join(' ');
	const countsFromCliOutput = (output) => {
		const counts = {};
		`${output}`
			.split('\n')
			.filter((oneLine) => oneLine.trim() !== '')
			.forEach((oneLine) => {
				const [tableName, countValue] = oneLine.split('|');
				counts[tableName] = Number(countValue);
			});
		return counts;
	};

	const backupFilePath = `${storeFilePath}.beforeTruncate-${timestampForFileName()}.backup`;

	const taskList = new taskListPlus();

	// 1 — count every truncatable table in the LIVE store. This is the expectation the backup must
	//     satisfy, measured now and never remembered from a previous run.
	taskList.push((args, next) => {
		runSqliteCli(
			{ databaseFilePath: storeFilePath, statementText: countEveryTableText },
			(err, output) => {
				if (err) {
					next(`graphBuilder -truncateStore: counting the live store: ${err}`);
					return;
				}
				const liveCounts = countsFromCliOutput(output);
				xLog.status(
					`graphBuilder -truncateStore: live store holds ` +
						truncatableTables
							.map((oneTable) => `${oneTable.tableName}=${liveCounts[oneTable.tableName]}`)
							.join(' '),
				);
				next('', { ...args, liveCounts });
			},
		);
	});

	// 2 — take the backup with VACUUM INTO (WAL-safe, self-contained, engine-written).
	taskList.push((args, next) => {
		if (fs.existsSync(backupFilePath)) {
			next(
				`graphBuilder -truncateStore: the backup path '${backupFilePath}' already exists. Refusing ` +
					`to overwrite a backup — that is the one file this operation cannot afford to damage.`,
			);
			return;
		}
		runSqliteCli(
			{ databaseFilePath: storeFilePath, statementText: `VACUUM INTO '${backupFilePath}';` },
			(err) => {
				if (err) {
					next(`graphBuilder -truncateStore: taking the backup: ${err}`);
					return;
				}
				xLog.status(`graphBuilder -truncateStore: backup written to ${backupFilePath}`);
				next('', args);
			},
		);
	});

	// 3 — VERIFY THE BACKUP. Open it, read a count from every table, require exact agreement. This is
	//     the gate; everything before it is preparation and everything after it is cleanup.
	taskList.push((args, next) => {
		if (!fs.existsSync(backupFilePath)) {
			next(
				`graphBuilder -truncateStore: the backup '${backupFilePath}' is not on disk after the copy ` +
					`reported success. REFUSING to truncate. The live store is untouched.`,
			);
			return;
		}
		runSqliteCli(
			{ databaseFilePath: backupFilePath, statementText: countEveryTableText },
			(err, output) => {
				if (err) {
					next(
						`graphBuilder -truncateStore: the backup '${backupFilePath}' COULD NOT BE OPENED AND ` +
							`READ (${err}). REFUSING to truncate — a backup nobody has opened is not a backup. ` +
							`The live store is untouched.`,
					);
					return;
				}
				const backupCounts = countsFromCliOutput(output);

				const unaccountedTables = truncatableTables
					.filter((oneTable) => backupCounts[oneTable.tableName] === undefined)
					.map((oneTable) => oneTable.tableName);
				if (unaccountedTables.length > 0) {
					next(
						`graphBuilder -truncateStore: the backup reported NO row count for ` +
							`[${unaccountedTables.join(', ')}]. REFUSING to truncate a table whose backup cannot ` +
							`account for it. The live store is untouched.`,
					);
					return;
				}

				const disagreements = truncatableTables
					.filter(
						(oneTable) => backupCounts[oneTable.tableName] !== args.liveCounts[oneTable.tableName],
					)
					.map(
						(oneTable) =>
							`${oneTable.tableName} (live ${args.liveCounts[oneTable.tableName]}, backup ` +
							`${backupCounts[oneTable.tableName]})`,
					);
				if (disagreements.length > 0) {
					next(
						`graphBuilder -truncateStore: the backup's row counts DISAGREE with the live store: ` +
							`${disagreements.join('; ')}. REFUSING to truncate. There is no tolerance for a near ` +
							`miss — the backup either holds what the store holds or it is not a backup of it. ` +
							`The live store is untouched.`,
					);
					return;
				}

				xLog.status(
					`graphBuilder -truncateStore: backup VERIFIED — opened, and all ` +
						`${truncatableTables.length} table counts agree exactly with the live store.`,
				);
				next('', { ...args, backupCounts });
			},
		);
	});

	// 4 — only now, empty the tables.
	taskList.push((args, next) => {
		runSqliteCli(
			{
				databaseFilePath: storeFilePath,
				statementText: truncatableTables
					.map((oneTable) => `DELETE FROM ${oneTable.tableName};`)
					.join(' '),
			},
			(err) => {
				if (err) {
					next(`graphBuilder -truncateStore: emptying the tables: ${err}`);
					return;
				}
				next('', args);
			},
		);
	});

	// 5 — confirm the store really is empty. A truncation that reported success without emptying
	//     anything is the exact mirror of a backup nobody opened.
	taskList.push((args, next) => {
		runSqliteCli(
			{ databaseFilePath: storeFilePath, statementText: countEveryTableText },
			(err, output) => {
				if (err) {
					next(`graphBuilder -truncateStore: confirming the truncation: ${err}`);
					return;
				}
				const stillPopulated = Object.entries(countsFromCliOutput(output))
					.filter(([, oneCount]) => oneCount !== 0)
					.map(([oneTableName, oneCount]) => `${oneTableName}=${oneCount}`);
				if (stillPopulated.length > 0) {
					next(
						`graphBuilder -truncateStore: rows REMAIN after the delete: ` +
							`${stillPopulated.join(' ')}. The backup at '${backupFilePath}' is verified and intact.`,
					);
					return;
				}
				next('', args);
			},
		);
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		callback('', {
			exitCode: 0,
			resultText: JSON.stringify(
				{
					truncatedStoreFilePath: storeFilePath,
					backupFilePath,
					backupVerified: true,
					rowsPreservedInBackup: args.backupCounts,
					tablesEmptied: truncatableTables.map((oneTable) => oneTable.tableName),
				},
				null,
				2,
			),
		});
	});
};

return {
	build,
	validate,
	deps,
	replay,
	retrievalMetrics: retrievalMetricsAction,
	cedsRoundTrip: cedsRoundTripAction,
	cedsGates: cedsGatesAction,
	goldEvalCheck: goldEvalCheckAction,
	truncateStore: truncateStoreAction,
	scanAvailableForges,
	// exported for the hermetic gates: the no-default refusal is the phase's headline claim, and a
	// claim provable only by launching a whole build is a claim nobody re-checks.
	resolveSupportStoreFilePath,
};
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
