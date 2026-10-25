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
//   actions.roundTripCompile(callback)  -> callback(errString, { exitCode, resultText })   (and roundTripGates; --standard=<token>)
//
// NO ACTION CALLS process.exit. Each RETURNS its outcome and the entry file owns exiting. A
// function that kills the process cannot be called by a test, and an action that cannot be
// tested is an action nobody can prove.

const path = require('path');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const recipeLib = require('./recipe')();
const { readOptionalBooleanValue } = require('./optional-boolean-value');
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

// store-reference (EC2/EC3: a delta store over a read-only reference) requires sqlite-instance at load too — required lazily.
const requireStoreReference = () =>
	require(path.join(__dirname, '..', '..', '..', 'lib', 'store-reference', 'store-reference'));
// store-fold has no sqlite-instance pull (better-sqlite3 only), required lazily for symmetry; the two caches' modules the fold's
// schema step opens carry the trap and are required lazily too
const requireStoreFold = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'store-fold', 'store-fold'));
const requireVectorStore = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'vector-store', 'vector-store'));
const requireVectorCache = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'embedding', 'vectorCache'));

// match-forensics has NO sqlite pull (fs/path only) — lazily required anyway, for symmetry with
// its two sibling persistence stores; the trap discipline is easier to audit when uniform.
const requireMatchForensics = () =>
	require(path.join(__dirname, '..', '..', '..', 'lib', 'match-forensics', 'match-forensics'));


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

// STORE_FAMILY_RESOLUTION_TABLE — W-C-11 (V1-S56..S59, V1-C42, PLAN G13; 2026-10-06). ONE resolver for the four store
// families a build opens, so the precedence, the disable word and the existence rule are said once.
//   flagName           the command-line override, which WINS (an operator or a hermetic suite naming a path)
//   configName         the [stores] key read when no flag spoke; absent or blank is refused by name (no code default)
//   sameFileAsFamilyName  the family lives in the file another family resolved to (TQ's single-file ruling, 2026-08-04):
//                      the decision store and the judgment cache follow the RESOLVED support store, never the raw
//                      config key, so a suite naming a scratch --standardsDatabaseFilePath keeps all three in scratch
//   disableWord        the flag value that turns the family off; parsed HERE, once, into { disabled: true } — the STRING
//                      'false' used to reach the embedder, which disables only on the BOOLEAN, and cached into ./false
//   isSupportStore     THE support store: its two channels are resolved by resolveSupportStoreFilePath (its refusal texts
//                      are the 2026-08-04 ones every suite and runbook names), then the existence rule below applies
//   explicitPathMustExist  whether an EXPLICIT flag path must already exist. A CONFIGURED path always must (the
//                      configured support store was absent on 2026-10-06 and a flagless build would have minted a cold
//                      store and re-embedded ~177k texts); an explicit path to a new standards database is an operator
//                      starting one for this run (hermetic suites and acceptance runs do), but a new VECTOR CACHE is a
//                      cold cache and is never what a build means unless it says --createStore=true.
// Frozen vectors have no row: they ALWAYS live in the standards database file (build.js), stated here so nobody adds one.
//   referenceFlagName  ⟪EC2/EC3, 2026-10-25⟫ the flag naming this family's read-only REFERENCE: the build's own store becomes a
//                      DELTA of it (lib/store-reference), reading the reference in place and writing only what it does not
//                      hold. Absent, the family has no reference and every statement is the one that ran before EC.
//   referenceSameFileAsFamilyName  the reference follows the RESOLVED reference of that family unless its own flag speaks (the
//                      single-file ruling, read on the reference side: one store of record holds every family). Frozen vectors
//                      follow the standards database's reference, as their store follows the standards database's file.
const STORE_FAMILY_RESOLUTION_TABLE = Object.freeze([
	Object.freeze({ familyName: 'standardsDatabase', flagName: 'standardsDatabaseFilePath', configName: 'graphBuilderSupportFilePath', explicitPathMustExist: false, isSupportStore: true, referenceFlagName: 'referenceStandardsDatabaseFilePath' }),
	Object.freeze({ familyName: 'decisionStore', flagName: 'decisionStoreFilePath', sameFileAsFamilyName: 'standardsDatabase', explicitPathMustExist: false, referenceFlagName: 'referenceDecisionStoreFilePath', referenceSameFileAsFamilyName: 'standardsDatabase' }),
	Object.freeze({ familyName: 'judgmentCache', flagName: 'judgmentCacheFilePath', sameFileAsFamilyName: 'standardsDatabase', disableWord: 'false', explicitPathMustExist: false, referenceFlagName: 'referenceJudgmentCacheFilePath', referenceSameFileAsFamilyName: 'standardsDatabase' }),
	Object.freeze({ familyName: 'vectorCache', flagName: 'embeddingCacheFilePath', configName: 'vectorCacheFilePath', disableWord: 'false', explicitPathMustExist: true, referenceFlagName: 'referenceEmbeddingCacheFilePath' }),
]);
const CREATE_STORE_FLAG_NAME = 'createStore';

// resolveStoreFamilyPath — { filePath, resolvedFrom } | { disabled: true } | { error }. Reads the filesystem (existence)
// and nothing else; it never creates a file or a directory.
const resolveStoreFamilyPath = ({ familyName, commandLineParameters, storesConfig, supportStoreFilePath, actionName }) => {
	const familyRow = STORE_FAMILY_RESOLUTION_TABLE.find((oneRow) => oneRow.familyName === familyName);
	if (!familyRow) {
		return { error: `graphBuilder ${actionName}: '${familyName}' is not a store family in STORE_FAMILY_RESOLUTION_TABLE` };
	}
	const createStoreText = firstValue(commandLineParameters, CREATE_STORE_FLAG_NAME);
	if (createStoreText !== undefined && createStoreText !== 'true') {
		return { error: `graphBuilder ${actionName}: --createStore must be 'true' when given (got '${createStoreText}'); it is the one way a run may start a store that does not exist yet, and it is not guessed at.` };
	}
	const createStoreRequested = createStoreText === 'true';
	const explicitValue = firstValue(commandLineParameters, familyRow.flagName);

	const candidate = (() => {
		if (familyRow.disableWord !== undefined && typeof explicitValue === 'string' && explicitValue.trim() === familyRow.disableWord) {
			return { disabled: true };
		}
		if (familyRow.isSupportStore === true) {
			const supportResolution = resolveSupportStoreFilePath({ explicitValue, configuredValue: (storesConfig || {})[familyRow.configName], actionName });
			return { ...supportResolution, mustExist: supportResolution.resolvedFrom === 'config' || familyRow.explicitPathMustExist };
		}
		if (typeof explicitValue === 'string' && explicitValue.trim() !== '') {
			return { filePath: explicitValue, resolvedFrom: 'commandLine', mustExist: familyRow.explicitPathMustExist };
		}
		if (typeof explicitValue === 'string') {
			return { error: `graphBuilder ${actionName}: --${familyRow.flagName} was given but blank. Pass a path${familyRow.disableWord === undefined ? '' : `, '${familyRow.disableWord}' to disable,`} or omit it; a blank is refused rather than guessed at.` };
		}
		if (familyRow.sameFileAsFamilyName !== undefined) {
			if (typeof supportStoreFilePath !== 'string' || supportStoreFilePath.trim() === '') {
				return { error: `graphBuilder ${actionName}: the ${familyName} lives in the ${familyRow.sameFileAsFamilyName} file, and no resolved ${familyRow.sameFileAsFamilyName} path was handed over. There is no default.` };
			}
			return { filePath: supportStoreFilePath, resolvedFrom: familyRow.sameFileAsFamilyName, mustExist: false };
		}
		const configuredValue = (storesConfig || {})[familyRow.configName];
		if (typeof configuredValue === 'string' && configuredValue.trim() !== '') {
			return { filePath: configuredValue, resolvedFrom: 'config', mustExist: true };
		}
		if (typeof configuredValue === 'string') {
			return { error: `graphBuilder ${actionName}: [stores] ${familyRow.configName} is present in graphBuilder.ini but BLANK. Name a path or remove the key; it is not guessed at.` };
		}
		return { error: `graphBuilder ${actionName}: no ${familyName} store path resolved, and there is NO DEFAULT. Set [stores] ${familyRow.configName} in graphBuilder.ini, or pass --${familyRow.flagName}=<path>.` };
	})();

	if (candidate.error || candidate.disabled) {
		return candidate.error ? { error: candidate.error } : { disabled: true };
	}
	if (candidate.mustExist && !createStoreRequested && !fs.existsSync(candidate.filePath)) {
		return { error: `graphBuilder ${actionName}: ${familyName} store '${candidate.filePath}' does not exist. A build never creates a store silently; pass --createStore=true on the one run meant to start it.` };
	}
	return { filePath: candidate.filePath, resolvedFrom: candidate.resolvedFrom };
};

// resolveReferenceStorePath — ⟪EC2/EC3⟫ a family's REFERENCE: { filePath } | { none: true } | { error }. The flag wins; a blank one is
// refused; else a same-file family follows the resolved reference of the family it shares a file with; else none. A reference is
// refused by name for a family that is disabled, and for an own store that came from CONFIG: the configured store of record is
// never anybody's delta (a reference is for a build's own explicit store).
const resolveReferenceStorePath = ({ familyName, commandLineParameters, ownResolution, resolvedReferenceByFamilyName, actionName }) => {
	const familyRow = STORE_FAMILY_RESOLUTION_TABLE.find((oneRow) => oneRow.familyName === familyName);
	if (!familyRow || familyRow.referenceFlagName === undefined) {
		return { error: `graphBuilder ${actionName}: '${familyName}' is not a store family that takes a reference (STORE_FAMILY_RESOLUTION_TABLE)` };
	}
	const explicitValue = firstValue(commandLineParameters, familyRow.referenceFlagName);
	if (typeof explicitValue === 'string' && explicitValue.trim() === '') {
		return { error: `graphBuilder ${actionName}: --${familyRow.referenceFlagName} was given but blank. Pass the store of record's path or omit it; a blank is refused rather than guessed at.` };
	}
	const followedReference = familyRow.referenceSameFileAsFamilyName === undefined ? undefined : resolvedReferenceByFamilyName[familyRow.referenceSameFileAsFamilyName];
	const referenceFilePath = typeof explicitValue === 'string' ? explicitValue : followedReference && followedReference.filePath;
	if (referenceFilePath === undefined) {
		return { none: true };
	}
	if (ownResolution.disabled) {
		return typeof explicitValue === 'string' ? { error: `graphBuilder ${actionName}: --${familyRow.referenceFlagName} names a reference for the ${familyName}, which this run DISABLES (--${familyRow.flagName}=${familyRow.disableWord}). Drop one of the two.` } : { none: true };
	}
	if (ownResolution.resolvedFrom === 'config') {
		return { error: `graphBuilder ${actionName}: a reference for the ${familyName} was named, but its own store '${ownResolution.filePath}' came from [stores] config: the configured store of record is never a delta. Name the build's own store with --${familyRow.flagName}.` };
	}
	if (!fs.existsSync(referenceFilePath)) {
		return { error: `graphBuilder ${actionName}: the ${familyName} reference '${referenceFilePath}' does not exist. A reference is a store of record; it is never created.` };
	}
	return { filePath: referenceFilePath };
};

// stampDeltaStores — ⟪EC2/EC3⟫ before any family module opens, make each own store with a resolved reference a DELTA of it
// (lib/store-reference stampReference; idempotent for the same reference, refused for a different one). Frozen vectors
// (familyName vectorStore) live in the standards database file and follow its reference. stampPlanList: [{ familyName,
// databaseFilePath, referenceFilePath }]; reports each stamp on the status log, so a delta build says so where it starts.
const stampDeltaStores = ({ stampPlanList, actionName }, callback) => {
	const { xLog } = process.global;
	const stampNext = (planIndex) => {
		if (planIndex >= stampPlanList.length) {
			callback('');
			return;
		}
		const onePlan = stampPlanList[planIndex];
		requireStoreReference().stampReference({ databaseFilePath: onePlan.databaseFilePath, familyName: onePlan.familyName, referenceDatabaseFilePath: onePlan.referenceFilePath }, (stampErr, stampReport) => {
			if (stampErr) {
				callback(`graphBuilder ${actionName}: ${stampErr}`);
				return;
			}
			xLog.status(`graphBuilder: ${onePlan.familyName} store ${onePlan.databaseFilePath} is a DELTA of ${onePlan.referenceFilePath} (${stampReport.alreadyStamped ? 'stamped before' : 'stamped now'}): it reads the reference in place and writes only what the reference does not hold`);
			stampNext(planIndex + 1);
		});
	};
	stampNext(0);
};

// unfoldedDeltaRefusal — ⟪EC, BRONZE_CROWN ruling 2026-10-25⟫ golds come only from a store of record or a FOLDED store: a store stamped as a
// DELTA (lib/store-reference) is refused by name by -goldEvalCheck and -stampPromotion. '' for a standalone store, and for a path that is
// not on disk (the action's own checks refuse an absent store it needs; an evidence file may name a store retention has since removed).
const unfoldedDeltaRefusal = ({ databaseFilePath, actionName }) => {
	if (typeof databaseFilePath !== 'string' || !fs.existsSync(databaseFilePath)) {
		return '';
	}
	const stampRead = requireStoreReference().stampListOfFile(databaseFilePath);
	if (stampRead.error) {
		return `graphBuilder ${actionName}: REFUSED — whether '${databaseFilePath}' is an unfolded delta could not be read (${stampRead.error}); a gold is never certified from a store nobody can classify`;
	}
	if (stampRead.stampList.length === 0) {
		return '';
	}
	return (
		`graphBuilder ${actionName}: REFUSED — '${databaseFilePath}' is an UNFOLDED DELTA of '${stampRead.stampList[0].referenceDatabaseFilePath}' ` +
		`(${stampRead.stampList.map((oneStamp) => oneStamp.familyName).join(', ')}). A gold is certified and promoted only from a store of record or a folded store: ` +
		`fold it (graphBuilder -foldStore --sourceFilePath=${databaseFilePath} --targetFilePath=<the store of record>) and name the store of record.`
	);
};

// embeddingCacheFilePathFor — the value build.js threads to the embedder: a path, or the BOOLEAN false that disables it.
const embeddingCacheFilePathFor = (vectorCacheResolution) => (vectorCacheResolution.disabled ? false : vectorCacheResolution.filePath);

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

// resolveBasedOnManifestRefId — ⟪campaign P2, W-C-8⟫ the optional -build --basedOnManifestRefId: absent -> {} (no parent
// named, recorded as such); present -> a non-blank value, else refused by name (a blank flag is not "no parent").
const resolveBasedOnManifestRefId = (commandLineParameters) => {
	if (!Object.prototype.hasOwnProperty.call(commandLineParameters.values || {}, 'basedOnManifestRefId')) {
		return {};
	}
	const namedValue = firstValue(commandLineParameters, 'basedOnManifestRefId');
	if (typeof namedValue !== 'string' || !namedValue.trim()) {
		return { error: `graphBuilder -build: --basedOnManifestRefId was given without a manifest address — name the parent manifest (64 hex) or omit the flag` };
	}
	return { basedOnManifestRefId: namedValue.trim() };
};

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

	// ⟪deCeds R3 P-c⟫ the bridging overlay is a test/scratch seam: it must reach the recipe LOAD (a new-form entry may name a
	// pairing only the overlay declares, and the expansion reads the bridging file), so it is checked before the load, and
	// refused for any recipe whose kind is not dev right after it (no recipe of record runs an unshipped bridge)
	const bridgingOverlayDirPath = firstValue(commandLineParameters, 'bridgingOverlayDirPath');
	if (bridgingOverlayDirPath !== undefined && !(path.isAbsolute(bridgingOverlayDirPath) && fs.existsSync(bridgingOverlayDirPath))) {
		return { recipePath, error: `graphBuilder ${actionName}: --bridgingOverlayDirPath ${JSON.stringify(bridgingOverlayDirPath)} is not an absolute, existing directory` };
	}
	const loaded = recipeLib.loadRecipe(recipePath, { forgesDirPath: FORGES_DIR, ...(bridgingOverlayDirPath === undefined ? {} : { bridgingOverlayDirPath }) });
	if (loaded.error) {
		return { recipePath, loadError: loaded.error };
	}
	if (bridgingOverlayDirPath !== undefined && loaded.recipe.kind !== 'dev') {
		return { recipePath, error: `graphBuilder ${actionName}: --bridgingOverlayDirPath is a test/scratch seam and recipe '${loaded.recipe.recipeName}' is kind ${JSON.stringify(loaded.recipe.kind)}; it is refused for every kind but dev, so no recipe of record runs an unshipped bridge` };
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

	const basedOnManifestRefIdResolution = resolveBasedOnManifestRefId(process.global.commandLineParameters);
	if (basedOnManifestRefIdResolution.error) {
		callback(basedOnManifestRefIdResolution.error);
		return;
	}

	const { verdict, recipe } = read;
	// ⟪deCeds R3 P-c⟫ --embeddingCacheOnly is checked BEFORE anything is opened: the embedding client reads it itself, so a
	// malformed value is refused here by name rather than thrown from inside the forge (the bridging overlay is checked in
	// readAndValidate, because it must reach the recipe load)
	const embeddingCacheOnlyRead = readOptionalBooleanValue({ name: 'embeddingCacheOnly', commandLineParameters: process.global.commandLineParameters, moduleName: 'graphBuilder -build', whatItControls: 'whether a vector-cache miss is a stop instead of a Voyage call', defaultValue: false });
	if (embeddingCacheOnlyRead.error) {
		callback(embeddingCacheOnlyRead.error);
		return;
	}
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
	// W-C-11: every store family through STORE_FAMILY_RESOLUTION_TABLE; a CONFIGURED store must exist (--createStore=true
	// is the one opt-in), and each family's disable word is parsed once, there.
	const storeResolutionArgs = { commandLineParameters: process.global.commandLineParameters, storesConfig: process.global.getConfig('stores'), actionName: '-build' };
	const supportStoreResolution = resolveStoreFamilyPath({ ...storeResolutionArgs, familyName: 'standardsDatabase' });
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
	// support store file itself unless --decisionStoreFilePath overrides it (STORE_FAMILY_RESOLUTION_TABLE).
	const decisionStorePathResolution = resolveStoreFamilyPath({ ...storeResolutionArgs, familyName: 'decisionStore', supportStoreFilePath: standardsDatabaseFilePath });
	if (decisionStorePathResolution.error) {
		callback(decisionStorePathResolution.error);
		return;
	}
	const decisionStoreFilePath = decisionStorePathResolution.filePath;

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
	const judgmentCachePathResolution = resolveStoreFamilyPath({ ...storeResolutionArgs, familyName: 'judgmentCache', supportStoreFilePath: standardsDatabaseFilePath });
	if (judgmentCachePathResolution.error) {
		callback(judgmentCachePathResolution.error);
		return;
	}
	// the vector cache: [stores] vectorCacheFilePath (the ONE shared cache) unless --embeddingCacheFilePath names another
	// or 'false' disables it; handed to build.js as a path or the BOOLEAN false (W-C-11)
	const vectorCachePathResolution = resolveStoreFamilyPath({ ...storeResolutionArgs, familyName: 'vectorCache' });
	if (vectorCachePathResolution.error) {
		callback(vectorCachePathResolution.error);
		return;
	}
	// ⟪EC2/EC3⟫ each family's REFERENCE (none unless a --reference* flag names one; decision store and judgment cache follow the
	// standards database's reference, frozen vectors live in its file and follow it too)
	const resolvedReferenceByFamilyName = {};
	const ownResolutionByFamilyName = { standardsDatabase: supportStoreResolution, decisionStore: decisionStorePathResolution, judgmentCache: judgmentCachePathResolution, vectorCache: vectorCachePathResolution };
	const referenceError = ['standardsDatabase', 'decisionStore', 'judgmentCache', 'vectorCache'].reduce((firstError, familyName) => {
		if (firstError) {
			return firstError;
		}
		const referenceResolution = resolveReferenceStorePath({ familyName, commandLineParameters: process.global.commandLineParameters, ownResolution: ownResolutionByFamilyName[familyName], resolvedReferenceByFamilyName, actionName: '-build' });
		resolvedReferenceByFamilyName[familyName] = referenceResolution;
		return referenceResolution.error || '';
	}, '');
	if (referenceError) {
		callback(referenceError);
		return;
	}
	const stampPlanList = [
		{ familyName: 'standardsDatabase', databaseFilePath: standardsDatabaseFilePath, referenceResolution: resolvedReferenceByFamilyName.standardsDatabase },
		{ familyName: 'vectorStore', databaseFilePath: standardsDatabaseFilePath, referenceResolution: resolvedReferenceByFamilyName.standardsDatabase },
		{ familyName: 'decisionStore', databaseFilePath: decisionStoreFilePath, referenceResolution: resolvedReferenceByFamilyName.decisionStore },
		{ familyName: 'judgmentCache', databaseFilePath: judgmentCachePathResolution.filePath, referenceResolution: resolvedReferenceByFamilyName.judgmentCache },
		{ familyName: 'vectorCache', databaseFilePath: vectorCachePathResolution.filePath, referenceResolution: resolvedReferenceByFamilyName.vectorCache },
	]
		.filter((onePlan) => onePlan.referenceResolution.filePath !== undefined)
		.map((onePlan) => ({ familyName: onePlan.familyName, databaseFilePath: onePlan.databaseFilePath, referenceFilePath: onePlan.referenceResolution.filePath }));

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

	stampDeltaStores({ stampPlanList, actionName: '-build' }, (stampError) => {
		if (stampError) {
			callback(stampError);
			return;
		}
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
								embeddingCacheFilePath: embeddingCacheFilePathFor(vectorCachePathResolution),
								recipePath: read.recipePath,
								recipeText: read.recipeText,
								// ⟪campaign P2, W-C-8⟫ optional lineage: the manifest this build was composed FROM, when the operator names one
								...(basedOnManifestRefIdResolution.basedOnManifestRefId !== undefined ? { basedOnManifestRefId: basedOnManifestRefIdResolution.basedOnManifestRefId } : {}),
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
	});
};

// ---------------------------------------------------------------------
// -foldStore
// ---------------------------------------------------------------------
// ⟪EC3, build-store economy 2026-10-25⟫ return a store's novel rows to the store of record: lib/store-fold does the counting, the
// conflict check, the one-transaction insert, the conserved-count check and PRAGMA foreign_key_check; this action resolves the two
// paths, holds the fold lock across plan and apply, prints the plan, and opens the target through each OWNING module first so
// every table it writes is the schema its owner declares (the fold declares none). DRY RUN unless --apply=true.
const FOLD_SCHEMA_OPENER_BY_FAMILY_NAME = Object.freeze({
	standardsDatabase: (targetFilePath, done) => requireStandardsDatabase()().open({ databaseFilePath: targetFilePath }, (err) => done(err || '')),
	vectorStore: (targetFilePath, done) => requireVectorStore()({}).init({ dbPath: targetFilePath }, (err) => done(err || '')),
	decisionStore: (targetFilePath, done) => requireDecisionStore()().open({ databaseFilePath: targetFilePath }, (err) => done(err || '')),
	judgmentCache: (targetFilePath, done) => requireJudgmentCache()().open({ databaseFilePath: targetFilePath }, (err) => done(err || '')),
	vectorCache: (targetFilePath, done) => requireVectorCache()().open({ databaseFilePath: targetFilePath }, (err) => done(err || '')),
});
const foldPlanText = (plan) =>
	[`graphBuilder -foldStore: ${plan.sourceFilePath}`, `                     into ${plan.targetFilePath}`]
		.concat(
			plan.tablePlanList.map(
				(tablePlan) =>
					`  ${tablePlan.tableName.padEnd(22)} source ${tablePlan.sourceRowCount}, target before ${tablePlan.targetRowCountBefore}${tablePlan.targetTablePresent ? '' : ' (no table yet)'}, MISSING ${tablePlan.missingCount}, overlap ${tablePlan.overlapCount}, conflicts ${tablePlan.conflictCount}, order conflicts ${tablePlan.orderConflictCount}` +
					tablePlan.conflictExampleList.concat(tablePlan.orderConflictExampleList).map((exampleText) => `\n      CONFLICT ${exampleText}`).join(''),
			),
		)
		.concat([`  total missing ${plan.missingTotal}, total conflicts ${plan.conflictTotal}${plan.conflictTotal > 0 ? ' — a fold with any conflict is a STOP' : ''}`])
		.join('\n');

const foldStoreAction = (callback) => {
	const { xLog, commandLineParameters } = process.global;
	const storeFold = requireStoreFold();
	const sourceFilePath = firstValue(commandLineParameters, 'sourceFilePath');
	const targetFilePath = firstValue(commandLineParameters, 'targetFilePath');
	const applyText = firstValue(commandLineParameters, 'apply');
	if (applyText !== undefined && applyText !== 'true') {
		callback(`graphBuilder -foldStore: --apply must be 'true' when given (got '${applyText}'); without it the fold is a dry run.`);
		return;
	}
	const absentList = [['sourceFilePath', sourceFilePath], ['targetFilePath', targetFilePath]].filter((oneFlag) => typeof oneFlag[1] !== 'string' || oneFlag[1].trim() === '').map((oneFlag) => `--${oneFlag[0]}`);
	if (absentList.length > 0) {
		callback(`graphBuilder -foldStore: required and absent: ${absentList.join(', ')}. There are no defaults: the source is the delta or store being folded, the target the store of record it folds into.`);
		return;
	}
	const lockRefusal = storeFold.acquireFoldLock({ ownerText: `graphBuilder -foldStore ${sourceFilePath} -> ${targetFilePath}` });
	if (lockRefusal) {
		callback(`graphBuilder -foldStore: ${lockRefusal}`);
		return;
	}
	const finishUnlocked = (err, result) => {
		const releaseRefusal = storeFold.releaseFoldLock({});
		callback(err ? `${err}${releaseRefusal ? `; AND ${releaseRefusal}` : ''}` : releaseRefusal ? `graphBuilder -foldStore: ${releaseRefusal}` : '', err || releaseRefusal ? undefined : result);
	};
	const planned = storeFold.planFold({ sourceFilePath, targetFilePath });
	if (planned.error) {
		finishUnlocked(`graphBuilder -foldStore: ${planned.error}`);
		return;
	}
	xLog.status(foldPlanText(planned.plan));
	if (applyText !== 'true') {
		finishUnlocked('', { exitCode: planned.plan.conflictTotal > 0 ? 1 : 0, resultText: JSON.stringify({ dryRun: true, plan: planned.plan }, null, 2) });
		return;
	}
	const ensureTargetSchema = (familyNameList, done) => {
		const openNext = (familyIndex) => {
			if (familyIndex >= familyNameList.length) {
				done('');
				return;
			}
			const schemaOpener = FOLD_SCHEMA_OPENER_BY_FAMILY_NAME[familyNameList[familyIndex]];
			if (!schemaOpener) {
				done(`no owning module is registered for family '${familyNameList[familyIndex]}' (FOLD_SCHEMA_OPENER_BY_FAMILY_NAME)`);
				return;
			}
			schemaOpener(planned.plan.targetFilePath, (openErr) => (openErr ? done(`${familyNameList[familyIndex]}: ${openErr}`) : openNext(familyIndex + 1)));
		};
		openNext(0);
	};
	storeFold.applyFold({ plan: planned.plan, ensureTargetSchema }, (applyErr, report) => {
		if (applyErr) {
			finishUnlocked(`graphBuilder -foldStore: ${applyErr}`);
			return;
		}
		xLog.status(`graphBuilder -foldStore: APPLIED — ${report.tableReportList.map((tableReport) => `${tableReport.tableName} ${tableReport.beforeCount} + ${tableReport.insertedCount} = ${tableReport.afterCount}`).join('; ')}; foreign_key_check clean`);
		finishUnlocked('', { exitCode: 0, resultText: JSON.stringify({ dryRun: false, report }, null, 2) });
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
	const supportStoreResolution = resolveStoreFamilyPath({ familyName: 'standardsDatabase', commandLineParameters: process.global.commandLineParameters, storesConfig: process.global.getConfig('stores'), actionName: '-replay' }); // W-C-11: a configured store must exist
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
// -retrievalMetrics — RETIRED 2026-10-06 (campaign P3, W-B-8; ROADS-NOT-TAKEN "retrievalMetrics: Retire")
// ---------------------------------------------------------------------
// The instrument read a PRE-FRAMEWORK forensic record shape ({ promptText, response, sourceStableId, judgedVia }) that no
// bridge-framework judgment carries, so every read it made of a record written since 2026-08-16 was absent. Its code is in
// codeAttic/retrieval-metrics/. The verb is kept so an operator who types it is told why, by name, instead of "unknown".
const RETRIEVAL_METRICS_RETIRED_TEXT =
	'graphBuilder -retrievalMetrics is RETIRED (2026-10-06, campaign P3 W-B-8): retrievalMetrics read a pre-framework forensic ' +
	'shape; the retrieval evidence now lives in each decision record\'s retrievalVoteList (decision store), not in forensics. ' +
	'The instrument\'s code is kept in codeAttic/retrieval-metrics/.';
const retrievalMetricsAction = (callback) => {
	callback(RETRIEVAL_METRICS_RETIRED_TEXT);
};

// ---------------------------------------------------------------------
// -roundTripCompile / -roundTripGates --standard=<token>
// ---------------------------------------------------------------------
// ⟪R5 S9, 2026-10-21⟫ the operator's round-trip verbs over ONE materialized graph, generic over the standard: graphBuilder
// names none. The standard's bundle DECLARES its verbs (parserDescriptor.ini roundTripVerbModule=, a module exporting the
// functions this table names) and carries their bodies (CEDS: forges/ceds/lib/cedsRoundTripVerbs.js, the former
// -cedsRoundTrip and -cedsGates, byte-unchanged but for their names). --standard is REQUIRED and has no default; a standard
// whose bundle declares no verbs is refused by name rather than read as "nothing to do".
const ROUND_TRIP_VERB_FUNCTION_NAME_BY_ACTION = Object.freeze({
	roundTripCompile: 'runRoundTripCompile',
	roundTripGates: 'runRoundTripGates',
});
const roundTripVerbActionFor = (actionName) => (callback) => {
	const { xLog, commandLineParameters } = process.global;
	const functionName = ROUND_TRIP_VERB_FUNCTION_NAME_BY_ACTION[actionName];
	const standardToken = firstValue(commandLineParameters, 'standard');
	if (typeof standardToken !== 'string' || standardToken.trim() === '') {
		callback(`graphBuilder -${actionName}: --standard=<token> is REQUIRED and has no default; it names the standard whose bundle declares this verb (e.g. --standard=ceds)`);
		return;
	}
	const { resolveBundle } = require(path.join(__dirname, '..', 'apps', 'forger', 'forger'));
	const bundle = resolveBundle({ standard: standardToken });
	if (bundle.error) {
		callback(`graphBuilder -${actionName} --standard=${standardToken}: ${bundle.error}`);
		return;
	}
	if (bundle.roundTripVerbModulePath === undefined) {
		callback(`graphBuilder -${actionName} --standard=${standardToken}: this standard's bundle declares no roundTripVerbModule= in ${path.join(bundle.bundleDir, 'parserDescriptor.ini')}, so it has no -${actionName} verb`);
		return;
	}
	if (!fs.existsSync(bundle.roundTripVerbModulePath)) {
		callback(`graphBuilder -${actionName} --standard=${standardToken}: roundTripVerbModule ${bundle.roundTripVerbModulePath} is not on disk`);
		return;
	}
	const verbModule = require(bundle.roundTripVerbModulePath);
	if (typeof verbModule[functionName] !== 'function') {
		callback(`graphBuilder -${actionName} --standard=${standardToken}: ${bundle.roundTripVerbModulePath} exports no ${functionName}({ xLog, commandLineParameters }, callback)`);
		return;
	}
	verbModule[functionName]({ xLog, commandLineParameters }, callback);
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
// ⟪JOB 6, 2026-09-08⟫ --judgedBy — THE PROMOTION GATE NAMES ITS JUDGES, AND PROMOTION NAMES THEM BACK.
//
// Nobody decides in advance whether a provider is "production". The decision moves from DECLARATION time to
// PROMOTION time and is made against evidence: the verdict SHOWS what judged the graph, and the promoter has
// to type it back. Three refusals, each BY NAME, and each list is built FROM THE ENUMERATION — never from a
// hand-written list of judges we expect to exist, because a hand list is blind to exactly the judge nobody
// declared, which is the one a promotion gate is for.
//
// --judgedBy ARRIVES AS AN ARRAY, and the CORRECT FORM IS COMMA-SEPARATED — `--judgedBy=A,B`. ⚠ A REPEATED
// `--flag=` DOES NOT ACCUMULATE: qtools-parse-command-line keeps the LAST value and drops the earlier ones.
// ⟪CORRECTED 2026-09-08 — this comment previously asserted the opposite, on an INFERENCE from `firstValue`
// at :324 that was never run. MEASURED against the real startup.js resolveParameters: comma -> 2 values;
// JSON-on-stdin envelope with a real array -> 2 values; `--judgedBy=A --judgedBy=B` -> 1 value; `--judgedBy A B`
// -> 1 value. The parser's own README says so — its example is `--value2 1,2,3` yielding ['1','2','3'].⟫
// The READER below is correct either way because it takes the whole array; the fault was in the DOCUMENTATION,
// and it fails SAFE (a dropped judge reads as an UNNAMED judge and REFUSES; it can never let a graph through
// with a judge unnamed). graphBuilder.js still needs no entry-point change, and the refusal for a malformed
// value lives HERE, beside every other -goldEvalCheck refusal, rather than being split across two files.
//
// ZERO judged edges is REPORTED, never refused, and --judgedBy is then not required: an authored-only bridge
// and a forge-only manifest both pass exactly as before. That is the population rule, and it is why every
// check below is scoped to what the enumeration FOUND rather than to whether blocks exist.
const JUDGED_BY_VALUE_NAME = 'judgedBy';
const quotedIdentityList = (identityList) => identityList.map((oneIdentity) => `'${oneIdentity}'`).join(', ');
// which blocks a given identity was found in — read from the per-block enumeration, so a refusal can point
// at the block rather than only at the manifest
const blockSubjectListForIdentity = (audit, oneIdentity) =>
	audit.mappingBlockList.filter((oneBlockRow) => oneBlockRow.judgeIdentityPairList.some((onePair) => onePair.judgeIdentity === oneIdentity)).map((oneBlockRow) => oneBlockRow.subject);

// ⟪JOB 6b, G6-l⟫ RETURNS BOTH the refusal AND the list it validated. It used to return only the refusal,
// and the verdict then RE-READ process.global at emit time to report what the operator had named — TWO READS
// OF ONE FACT, the species this campaign exists to remove, shipped by me inside the gate written against it.
// They could not disagree today because nothing mutates the parameters in between; that is what makes it a
// drift SITE rather than a drift, and what would have carried it past review. The raw value is now read
// EXACTLY ONCE and travels forward, which the twin asserts by counting reads of a getter.
// One shape out of every arm: a refusal (or null) plus THE LIST THAT WAS VALIDATED.
const refusalOf = (refusalMessage) => ({ refusalMessage, namedIdentityList: [] });
const judgedByViolation = ({ commandLineParameters, audit, manifestRefId }) => {
	const rawJudgedByList = commandLineParameters.values[JUDGED_BY_VALUE_NAME] || [];   // THE ONE READ
	// A MALFORMED VALUE IS REFUSED BY NAME, NEVER SILENTLY DROPPED. A dropped value is the silent-no-op this
	// whole order exists to refuse: the promoter typed a judge, believes it took effect, and the gate that
	// was supposed to check it quietly checked one fewer.
	const malformedValueList = rawJudgedByList.filter((oneValue) => typeof oneValue !== 'string' || oneValue.trim() === '');
	if (malformedValueList.length) {
		return refusalOf(
			`graphBuilder -goldEvalCheck: REFUSED — --${JUDGED_BY_VALUE_NAME} was given ${malformedValueList.length} empty or ` +
			`non-string value(s) (${malformedValueList.map((oneValue) => JSON.stringify(oneValue)).join(', ')}). A judge id that is blank ` +
			`names no judge; it is refused rather than dropped, because a dropped value would let a promotion command ` +
			`appear to name a judge it does not name.`
		);
	}
	const namedIdentityList = rawJudgedByList.map((oneValue) => oneValue.trim());
	const presentIdentityList = audit.judgeToolIdList;
	// THE POPULATION RULE. Nothing was judged → nothing to name. Reported by the caller, never refused here.
	if (presentIdentityList.length === 0) {
		if (namedIdentityList.length === 0) {
			return { refusalMessage: null, namedIdentityList };
		}
		return refusalOf(
			`graphBuilder -goldEvalCheck: REFUSED — --${JUDGED_BY_VALUE_NAME} names ${quotedIdentityList(namedIdentityList)}, but manifest ` +
			`${manifestRefId} carries NO judged edges at all across its ${audit.mappingBlockList.length} relationship block(s). ` +
			`A promotion command naming a judge that judged nothing is stale, and a stale command is a defect: it would ` +
			`certify by habit rather than by evidence.`
		);
	}
	if (namedIdentityList.length === 0) {
		return refusalOf(
			`graphBuilder -goldEvalCheck: REFUSED — manifest ${manifestRefId} was judged by ${presentIdentityList.length} judge(s) and ` +
			`--${JUDGED_BY_VALUE_NAME} names none. Every judgeIdentity FOUND, enumerated from the manifest's own relationship blocks: ` +
			`${quotedIdentityList(presentIdentityList)}. Promotion requires --${JUDGED_BY_VALUE_NAME}=<toolId>[,<toolId>...] — ONE flag, COMMA-SEPARATED, one id per judge present (a REPEATED --${JUDGED_BY_VALUE_NAME}= is NOT accumulated; the parser keeps the last value) — ` +
			`nobody promotes a graph without having been shown what judged it and typing that back.`
		);
	}
	const unnamedIdentityList = presentIdentityList.filter((oneIdentity) => namedIdentityList.indexOf(oneIdentity) === -1);
	if (unnamedIdentityList.length) {
		const unnamedWithBlockList = unnamedIdentityList.map((oneIdentity) => `'${oneIdentity}' (block(s): ${blockSubjectListForIdentity(audit, oneIdentity).join(', ')})`).join('; ');
		return refusalOf(
			`graphBuilder -goldEvalCheck: REFUSED — ${unnamedIdentityList.length} judge(s) judged this manifest and --${JUDGED_BY_VALUE_NAME} ` +
			`does not name them: ${unnamedWithBlockList}. Every judgeIdentity FOUND in manifest ${manifestRefId}, enumerated from its ` +
			`relationship blocks and never from a list of judges we expected: ${quotedIdentityList(presentIdentityList)}. Add ` +
			`--${JUDGED_BY_VALUE_NAME}=<toolId> for each one you are promoting.`
		);
	}
	const absentIdentityList = namedIdentityList.filter((oneIdentity) => presentIdentityList.indexOf(oneIdentity) === -1);
	if (absentIdentityList.length) {
		return refusalOf(
			`graphBuilder -goldEvalCheck: REFUSED — --${JUDGED_BY_VALUE_NAME} names ${absentIdentityList.length} judge(s) that judged NOTHING ` +
			`in manifest ${manifestRefId}: ${quotedIdentityList(absentIdentityList)}. A stale promotion command is a defect, not a ` +
			`harmless surplus: it says the operator believes something about this graph that is not true of it. The judges ` +
			`actually present are: ${quotedIdentityList(presentIdentityList)}.`
		);
	}
	return { refusalMessage: null, namedIdentityList };
};

const goldEvalCheckAction = (callback) => {
	const { xLog } = process.global;
	const deltaRefusal = unfoldedDeltaRefusal({ databaseFilePath: firstValue(process.global.commandLineParameters, 'standardsDatabaseFilePath'), actionName: '-goldEvalCheck' });
	if (deltaRefusal) {
		callback(deltaRefusal);
		return;
	}
	const roundTripStageStatics = require('./round-trip-stage');
	const certificateEnrichmentLib = require('./certificate-enrichment');
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
	// B2 review ruling for B3): a relationship block carrying ANY edge with mappingSource 'bridge-debug' (provenanceTier 'invalid-debug' until 2026-10-04)
	// (a debug-judge block) MUST NOT reach a certified graph. The RULE is the framework's
	// (lib/bridge-framework/certificationCheck.js); the WIRING here reads the run's MANIFEST out of the
	// standardsDatabase (the artifact — no container) and audits every relationship member block's edge
	// list (apps/graph-builder/lib/gold-eval-bridge-sibling.js).
	//
	// HOW IT IS INVOKED, and why this is not a silent default: the run directory records no manifest id
	// (build.js writes only the round-trip stage summary there, and build.js is a seam file), so the
	// sibling is driven by --manifestRefId=<the manifest -build printed>, with the store resolved exactly
	// as -replay resolves it (an explicit --standardsDatabaseFilePath wins over the configured support
	// store; neither → refused by name).
	// ⟪CHANGED JOB 6b⟫ THIS PARAGRAPH USED TO SAY: "WITHOUT --manifestRefId the sibling DOES NOT RUN and
	// the verdict SAYS SO BY NAME on the status line and in the payload (scope 'forgeRoundTripOnly',
	// mappingEdgesCertified false): a forge-only build certifies exactly as before B3". EVERY CLAUSE OF
	// THAT IS NOW FALSE. --manifestRefId is REQUIRED and its absence REFUSES — every build harvests
	// blocks, so conservation has no honest partial scope to narrow to. There is no forge-only PASS and
	// no 'forgeRoundTripOnly' verdict; the scope vocabulary shrank with the path (see the payload below).
	// Corrected IN PLACE rather than appended beside, and the same correction was made in help.js; this
	// copy was found only by grepping the FACT'S PHRASES across the tree instead of the file being read.
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
	const loadedRecipe = recipePathForBridges ? recipeLib.loadRecipe(recipePathForBridges, { forgesDirPath: FORGES_DIR }) : null;
	if (loadedRecipe && loadedRecipe.error) {
		callback(`graphBuilder -goldEvalCheck: REFUSED — the recipe named for the bridge declaration (${recipePathForBridges}) does not load: ${loadedRecipe.error}`);
		return;
	}
	// RULING BR3-5: a `bridges` key that is PRESENT and not an array is REFUSED by name — it must never read as "0 bridges"
	// and silently disarm the bridged-recipe refusal below (validateRecipe refuses it at -build; -goldEvalCheck reads
	// the run dir's recipe AFTER the fact and must refuse it too)
	if (loadedRecipe && Object.prototype.hasOwnProperty.call(loadedRecipe.recipe, 'bridges') && !Array.isArray(loadedRecipe.recipe.bridges)) {
		callback(`graphBuilder -goldEvalCheck: REFUSED — the recipe ${recipePathForBridges} carries a 'bridges' key that is not an array (${typeof loadedRecipe.recipe.bridges}); the bridge declaration is unreadable, so mapping-edge certification cannot be decided — fix the recipe (bridges: [] or a list of { source, hub, bridge, dependencies })`);
		return;
	}
	const bridgeDeclaration = loadedRecipe ? { known: true, recipePath: recipePathForBridges, bridgeCount: Array.isArray(loadedRecipe.recipe.bridges) ? loadedRecipe.recipe.bridges.length : 0 } : { known: false, recipePath: null, bridgeCount: null, note: `recipe not located (run dir '${path.basename(buildLogDirPath)}' → ${derivedRecipePath} absent; pass --recipePath to name it) — bridge declaration UNKNOWN` };
	if (!manifestRefId && bridgeDeclaration.known && bridgeDeclaration.bridgeCount > 0) {
		callback(`graphBuilder -goldEvalCheck: REFUSED — the recipe ${recipePathForBridges} DECLARES ${bridgeDeclaration.bridgeCount} bridge(s); mapping edges UNCERTIFIED — pass --manifestRefId=<the manifest -build printed> (and --standardsDatabaseFilePath=<its store>) so the bridge sibling audits the manifest's relationship blocks; a bridged build never certifies on the forge round trip alone`);
		return;
	}
	// ⟪PHASE 6, RULING R5⟫ THE CERTIFICATE NOW NAMES WHAT IT CERTIFIED, not merely where it ran.
	// The four fields are APPENDED below, after every incumbent field, so each keeps its name, its
	// position and its value; the enrichment is computed FIRST because a certificate that cannot name
	// its base schema block, its recipe, its endpoint or its declared tokens must REFUSE rather than
	// emit those fields holding null — a null here reads as 'measured and empty' when the truth is
	// 'never obtained'.
	//
	// ⚠ THE PRECONDITION THIS INTRODUCED, STATED WHERE THE PROMOTER READS IT (Phase 6 review, P2).
	// "Additive" is exact about the PAYLOAD — no incumbent field moved, changed or was renamed — and it
	// would be misleading if left to stand alone about the INPUT. A run directory must now carry
	// `declaredTokens` in its stage summary and `.graph.boltUrl` in EVERY declared verdict, or this
	// verb REFUSES where it previously certified. That narrowing was accepted on measurement, not on
	// argument: of the artifacts on disk under dataStores/buildLogs, 91 of 91 stage summaries carry
	// `declaredTokens` and 153 of 153 roundTripVerdict.json carry `.graph.boltUrl` — none missing on
	// either count, measured twice by two parties. SO NO REAL BUILD DIRECTORY IN THE RECORD CHANGES
	// VERDICT; the class that does is SYNTHETIC run directories, and two test fixtures modelling the
	// artifact without those fields are the proof it changed at all. A hand-assembled or foreign run
	// directory that predates them will be refused BY NAME rather than silently certified on partial
	// evidence, which is the trade this ruling makes deliberately.
	const emitVerdict = ({ bridgeSibling, manifest, judgeEnumeration, inventoryGate }) => {
		const enrichmentResult = certificateEnrichmentLib.buildCertificateEnrichment({
			summary,
			declaredRowList: declaredRows,
			manifest,
			recipePath: recipePathForBridges,
		});
		if (enrichmentResult.refusalMessageList.length) {
			callback(`graphBuilder -goldEvalCheck: REFUSED —\n  - ${enrichmentResult.refusalMessageList.join('\n  - ')}`);
			return;
		}
		// ⟪CHANGED JOB 6b⟫ this was a ternary on bridgeSibling.ran. Its false arm — the FORGE ROUND TRIP
		// ONLY status line — is UNREACHABLE: emitVerdict has exactly ONE call site and it is reached only
		// after --manifestRefId is present and the sibling has run. A dead arm in a certificate is worse
		// than dead code elsewhere, because it advertises an outcome the gate can no longer produce.
		// ⟪JOB 6⟫ the status line NAMES THE JUDGES, because the point of this gate is that a promoter is SHOWN
		// what judged the graph rather than having to go and look for it. Zero judged edges says so IN WORDS —
		// an empty list rendered as nothing would read as 'not measured' instead of 'measured, and none found'.
		const judgeText =
			judgeEnumeration.judgedEdgeTotal === 0
				? 'judges: NONE — zero judged edges across the audited block(s), so --judgedBy is not required'
				: `judges (${judgeEnumeration.judgeToolIdList.length}, over ${judgeEnumeration.judgedEdgeTotal} judged edge(s)): ${judgeEnumeration.judgeToolIdList.join(', ')}`;
		// ⟪ctdlHub P8⟫ family-structure edges (exempt from the no-mappingSource rule, RULING (A)) are counted apart, so the
		// status line never calls a structural edge a mapping edge
		const structuralEdgeTotal = bridgeSibling.mappingBlockList.reduce((soFar, oneBlock) => soFar + Object.keys(oneBlock.structuralEdgeCountByType || {}).reduce((blockSoFar, edgeTypeName) => blockSoFar + oneBlock.structuralEdgeCountByType[edgeTypeName], 0), 0);
		const edgeTotal = bridgeSibling.mappingBlockList.reduce((soFar, oneBlock) => soFar + oneBlock.edgeCount, 0);
		const scopeText = `bridge sibling: ${bridgeSibling.mappingBlockList.length} relationship block(s) audited, ${edgeTotal - structuralEdgeTotal} mapping edge(s)${structuralEdgeTotal ? ` + ${structuralEdgeTotal} family-structure edge(s) (exempt, reported per block)` : ''}, 0 invalid-debug; ${judgeText}; ${inventoryGate.statusText}`;
		xLog.status(
			`graphBuilder: [goldEvalCheck] PASS — ${declaredRows.length} declared validator(s) ran ` +
				`with inventedTotal=0${absentTokens.length ? `; ${absentTokens.length} bundle(s) declared-ABSENT (tolerated during the retrofit): ${absentTokens.join(', ')}` : ''}; ${scopeText}`,
		);
		callback('', {
			exitCode: 0,
			resultText: JSON.stringify(
				{
					certification: 'PASS',
					// ⟪CHANGED JOB 6b⟫ both were ternaries on bridgeSibling.ran and both false arms are
					// unreachable — see scopeText above. THE CERTIFICATE'S SCOPE VOCABULARY SHRANK: it can no
					// longer emit 'forgeRoundTripOnly', and mappingEdgesCertified can no longer be false. A
					// reader who finds either in an OLD certificate is looking at a pre-JOB-6b artifact.
					scope: 'forgeRoundTripAndMappingEdges',
					mappingEdgesCertified: true,
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
					// ⟪JOB 6⟫ WHAT JUDGED THIS GRAPH, enumerated from the manifest's own relationship blocks and never
					// from a registry of what we expected to find. namedAtPromotionList records what the operator
					// actually typed, so the certificate carries BOTH the evidence and the assertion made against it —
					// a later reader can see the two agreed instead of taking it on faith.
					judgeEnumeration,
					// ⟪PHASE 6, R5⟫ APPENDED, never interleaved — baseBlockIdByToken, recipeTextHash,
					// boltEndpoint, declaredTokens. Spreading LAST guarantees the four arrive AFTER every
					// incumbent key, so no existing key changes POSITION. ⚠ It does NOT by itself guarantee
					// additivity: a spread key colliding with an incumbent name would overwrite that value
					// silently, in place. Additivity holds because the four names were checked against the
					// payload above and none collides — a claim about THESE names, not a property of spread.
					...enrichmentResult.enrichment,
					// ⟪ctdlHub P8⟫ THE INVENTORY GATE'S REPORT, appended after the enrichment (no incumbent key moves; the
					// name collides with none of the payload's keys above). It carries what was read, from where, and what the
					// candidate adds — the refusal path never reaches here, so a PASS payload always says what it compared.
					inventoryGate: inventoryGate.payload,
				},
				null,
				2,
			),
		});
	};
	// ⟪ctdlHub P8, WORKORDER-P8 step 1⟫ THE STANDARD-INVENTORY PROMOTION GATE (lib/gold-eval-inventory.js). A graph whose
	// recipe PERMITS promotion (RECIPE_KIND_RULE) — or whose recipe could not be located, which fails safe — must name what
	// it supersedes (--supersedes=<containerName>[,...] or --supersedes=none), and is REFUSED BY NAME when it lacks any
	// standard or hub a predecessor holds. A recipe whose kind forbids promotion is not required to, and the payload says so;
	// naming --supersedes on one still runs the gate. Runs LAST, after conservation: it is the one check that opens graphs.
	const inventoryGateRequired = !(loadedRecipe && recipeLib.RECIPE_KIND_RULE[loadedRecipe.recipe.kind] && recipeLib.RECIPE_KIND_RULE[loadedRecipe.recipe.kind].promotionRenameAllowed === false);
	const rawSupersedesList = process.global.commandLineParameters.values.supersedes;
	const runInventoryGateStep = ({ manifestRefIdUnderCertification }, inventoryCallback) => {
		if (!inventoryGateRequired && rawSupersedesList === undefined) {
			const notRequiredText = `inventory gate: NOT REQUIRED — recipe kind '${loadedRecipe.recipe.kind}' does not permit promotion`;
			inventoryCallback('', { statusText: notRequiredText, payload: { ran: false, reason: notRequiredText } });
			return;
		}
		const neo4j = require('neo4j-driver');
		// the candidate and every live predecessor are opened READ-ONLY, bolt port and credential read from the container
		const openGraphReader = ({ containerName }, openCallback) => {
			require(path.join(__dirname, '..', '..', '..', 'lib', 'graph-connection', 'containerBolt')).resolveContainerBolt({ containerName }, (resolveError, resolved) => {
				if (resolveError) {
					openCallback(resolveError);
					return;
				}
				const driver = neo4j.driver(resolved.boltUrl, neo4j.auth.basic('neo4j', resolved.password), { encrypted: false });
				const session = driver.session({ defaultAccessMode: neo4j.session.READ });
				const runCypher = ({ cypherText }, cypherCallback) =>
					session.run(cypherText).then((cypherResult) => cypherCallback('', cypherResult.records.map((oneRecord) => oneRecord.toObject())), (cypherError) => cypherCallback(cypherError.message));
				openCallback('', { runCypher, closeAll: (closeCallback) => session.close().then(() => driver.close(), () => driver.close()).then(() => closeCallback(), () => closeCallback()) });
			});
		};
		require('./gold-eval-inventory').runInventoryGate(
			{
				rawSupersedesList,
				candidateContainerName: firstValue(process.global.commandLineParameters, 'containerName'),
				manifestRefId: manifestRefIdUnderCertification,
				inventoryDirectoryPath: firstValue(process.global.commandLineParameters, 'supersedesInventoryDirectoryPath'),
				openGraphReader,
			},
			(gateRefusal, gateReport) => {
				if (gateRefusal) {
					inventoryCallback(`graphBuilder -goldEvalCheck: REFUSED — INVENTORY GATE —\n  - ${gateRefusal}`);
					return;
				}
				const inventoryText = gateReport.supersedesNone
					? 'inventory gate: --supersedes=none (supersedes nothing; nothing compared)'
					: `inventory gate: PASS against ${gateReport.predecessorReportList.map((oneReport) => `${oneReport.predecessorInventory.graphName} (${oneReport.predecessorInventory.inventoryOrigin})`).join(', ')}; candidate holds ${gateReport.candidateInventory.nameListByDimension.standard.length} standard(s), ${gateReport.candidateInventory.nameListByDimension.hub.length} hub(s)`;
				inventoryCallback('', { statusText: inventoryText, payload: { ran: true, ...gateReport } });
			},
		);
	};
	// ⟪JOB 6b⟫ THIS BRANCH USED TO NARROW; IT NOW REFUSES, and the change is deliberate.
	// Without --manifestRefId the BRIDGE sibling could honestly narrow to 'forge round trip only',
	// because a forge-only build genuinely has no mapping edges to certify. THE CONSERVATION AUDIT HAS NO
	// SUCH HONEST PARTIAL SCOPE: every build harvests blocks, so there is no such thing as a build with
	// nothing to conserve. Emitting a verdict here without enumerating the manifest would be a check
	// reporting PASS without having looked — precisely the defect this gate exists to catch.
	if (!manifestRefId) {
		// ⟪RULING TWILIGHT_ARROW 2026-09-02⟫ A REFUSAL FOR ONE REASON MUST NOT HIDE THE EVIDENCE
		// GATHERED FOR ANOTHER. By this point the round-trip stage has been read and validated —
		// `summary`, `declaredRows` and `absentTokens` are all in hand — and refusing here used to throw
		// all of it away. That is the same defect as a hygiene gate reporting 'CHANGED' without naming
		// what changed: an instrument that did the work and then withheld it.
		//
		// So the STAGE's machine-readable findings are emitted FIRST, labelled unmistakably as a STAGE
		// result and never as the verdict, and the refusal follows and still exits nonzero. THE GATE'S
		// STRICTNESS IS UNCHANGED: this is not promotable, and nothing here says PASS. It is also the
		// live witness that declared-ABSENT bundles are LISTED rather than hidden — a real tolerance of
		// the retrofit that would otherwise have no witness anywhere once the forge-only PASS path was
		// removed. (The PASS-token witness lives in test-goldEvalBridgeSibling's clean-manifest run,
		// which has a store and conservation artifacts.)
		xLog.status(
			`graphBuilder: [goldEvalCheck] ROUND-TRIP STAGE RESULT (NOT A VERDICT — certification is REFUSED below): ` +
				`${declaredRows.length} declared validator(s) ran with inventedTotal=0` +
				`${absentTokens.length ? `; ${absentTokens.length} bundle(s) declared-ABSENT (tolerated during the retrofit): ${absentTokens.join(', ')}` : ''}`,
		);
		callback(
			`graphBuilder -goldEvalCheck: REFUSED — CONSERVATION UNCERTIFIED without --manifestRefId. The ` +
				`audit must enumerate the MANIFEST'S members and demand a conservation artifact for each, ` +
				`because a population read from the artifacts themselves cannot detect its own omission — a ` +
				`block that was never checked would be indistinguishable from a block with nothing wrong. ` +
				`Unlike the bridge sibling there is no honest partial scope to narrow to: every build ` +
				`harvests blocks. Pass --manifestRefId=<the manifest -build printed> (and ` +
				`--standardsDatabaseFilePath=<its store>).`,
		);
		return;
	}
	const supportStoreResolution = resolveStoreFamilyPath({ familyName: 'standardsDatabase', commandLineParameters: process.global.commandLineParameters, storesConfig: process.global.getConfig('stores'), actionName: '-goldEvalCheck' }); // W-C-11: a configured store must exist
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
			// ⟪JOB 6⟫ THE INVALID-DEBUG REFUSAL ABOVE FIRES FIRST AND IS UNTOUCHED. These run only once it has
			// passed, and the ordering is STRUCTURAL — the two refusals travel in SEPARATE channels off the
			// audit, so this is not a question of which message happens to be first in a shared list.
			//
			// The missing-judgeIdentity refusal precedes the naming checks deliberately: a judged edge that
			// cannot say what judged it makes the question "did you name every judge" unanswerable, so
			// refusing on the naming would report a second-order fault and hide the first-order one.
			if (audit.judgeEnumerationRefusalMessageList.length) {
				callback(`graphBuilder -goldEvalCheck: REFUSED —\n  - ${audit.judgeEnumerationRefusalMessageList.join('\n  - ')}`);
				return;
			}
			const judgedByOutcome = judgedByViolation({ commandLineParameters: process.global.commandLineParameters, audit, manifestRefId });
			if (judgedByOutcome.refusalMessage !== null) {
				callback(judgedByOutcome.refusalMessage);
				return;
			}
			// ⟪PHASE 6, R5⟫ the sibling reports its AUDIT; the certificate must also NAME the base blocks,
			// so the manifest is read here for its members. Deliberately a second read rather than a widened
			// sibling contract: the sibling's subject is 'do the relationship blocks carry debug edges', and
			// making it also a manifest accessor would blur a seam that is currently exact.
			standardsDatabase.getManifest({ refId: manifestRefId }, (manifestError, manifest) => {
				if (manifestError) {
					callback(`graphBuilder -goldEvalCheck: getManifest ${manifestRefId}: ${manifestError}`);
					return;
				}
				if (!manifest) {
					callback(`graphBuilder -goldEvalCheck: REFUSED — manifest ${manifestRefId} is ABSENT from the store when read for its base schema blocks — nothing can be named as certified`);
					return;
				}
				// ⟪JOB 6b⟫ THE CONSERVATION AUDIT — the last thing between this run and a PASS.
				// Every manifest member must carry a conservation artifact reading PASS. The population is
				// the MANIFEST'S member list, never the conservation directory: a population read from the
				// evidence cannot detect its own omission, so a block that was never checked would read
				// exactly like a block with nothing wrong. Refuses by name on a member with no artifact, on
				// an unparseable or mismatched one, on the DECLARED EXEMPTION — which after JOB 5b no
				// production caller can produce, so its presence means a seam went ungated — and on any
				// verdict that is neither PASS nor EXEMPT.
				// It takes the manifest ALREADY FETCHED above rather than reading a second copy: two reads
				// of one fact are two things that can drift, which is the subject of this whole campaign.
				const conservationAudit = require('./gold-eval-conservation').auditConservationForManifest({ manifest, buildLogDirPath });
				if (conservationAudit.refusalMessageList.length) {
					callback(
						`graphBuilder -goldEvalCheck: REFUSED — CONSERVATION UNCERTIFIED across ` +
							`${conservationAudit.memberCount} manifest member(s) —\n  - ` +
							`${conservationAudit.refusalMessageList.join('\n  - ')}`,
					);
					return;
				}
				xLog.status(
					`[goldEvalCheck] conservation: ${conservationAudit.memberCount} of ` +
						`${conservationAudit.memberCount} manifest member(s) certified PASS from their per-block artifacts`,
				);
				runInventoryGateStep({ manifestRefIdUnderCertification: manifestRefId }, (inventoryError, inventoryGate) => {
					if (inventoryError) {
						callback(inventoryError);
						return;
					}
					emitVerdict({
						bridgeSibling: { manifestRefId: audit.manifestRefId, standardsDatabaseFilePath: supportStoreResolution.filePath, memberCount: audit.memberCount, mappingBlockList: audit.mappingBlockList },
						manifest,
						judgeEnumeration: {
							judgeToolIdList: audit.judgeToolIdList,
							judgeIdentityPairList: audit.judgeIdentityPairList,
							judgedEdgeTotal: audit.judgedEdgeTotal,
							perBlockList: audit.mappingBlockList.map((oneBlockRow) => ({ subject: oneBlockRow.subject, judgedEdgeCount: oneBlockRow.judgedEdgeCount, judgeIdentityPairList: oneBlockRow.judgeIdentityPairList })),
							// ⟪G6-l⟫ THE LIST judgedByViolation VALIDATED, handed forward — never a second read of process.global.
							namedAtPromotionList: judgedByOutcome.namedIdentityList,
						},
						inventoryGate,
					});
				});
			});
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
// ⟪lane P, mappingProvenance 2026-10-04; TQ-approved⟫ -stampPromotion — run AFTER a graph is promoted (renamed). Writes the
// graph's REAL name into its passport and the goldEvalCheck and replay verdicts into BuildAttestation, each read from the
// evidence file its run wrote (promotion-evidence.js) and tied to the graph by the manifest id its passport carries. It
// changes no content node or edge and proves it with a before/after census (promotion-stamp.js). Both evidence paths are
// REQUIRED: a stamp that recorded one verdict would leave the other reading 'notRun' beside a claim of promotion.
// promotionKindRefusal — ⟪campaign P2, W-C-10⟫ '' when the stamp may proceed, else the refusal. Only a GOLD_EVAL_* target is
// gated; its recipe must be locatable by name and its kind must permit promotion (recipe.js RECIPE_KIND_RULE).
const PROMOTION_GATED_NAME_PATTERN = /^GOLD_EVAL_/;
// ⟪lane FIX⟫ which evidence reader (promotion-evidence.js) reads the replay row's evidence, by the parameter that names it
const STAMP_REPLAY_EVIDENCE_READER_BY_PARAMETER_NAME = Object.freeze({ replayLogPath: 'replayRun', replayBuildLogPath: 'replayBuild' });
const promotionKindRefusal = ({ containerName, recipeName, recipesDirPath = path.join(__dirname, '..', '..', '..', 'recipes') }) => {
	if (!PROMOTION_GATED_NAME_PATTERN.test(`${containerName}`)) {
		return '';
	}
	const recipePath = path.join(recipesDirPath, `${recipeName}.recipe.jsonc`);
	if (typeof recipeName !== 'string' || !recipeName || !fs.existsSync(recipePath)) {
		return `graphBuilder -stampPromotion: REFUSED — '${containerName}' is a GOLD_EVAL name, and the passport's recipe ${JSON.stringify(recipeName)} has no recipe file at ${recipePath}, so its kind (what it permits) cannot be read`;
	}
	const loaded = recipeLib.loadRecipe(recipePath, { forgesDirPath: FORGES_DIR });
	const kindRule = loaded.recipe ? recipeLib.RECIPE_KIND_RULE[loaded.recipe.kind] : undefined;
	if (!kindRule || !kindRule.promotionRenameAllowed) {
		return `graphBuilder -stampPromotion: REFUSED — recipe '${recipeName}' is kind ${JSON.stringify(loaded.recipe && loaded.recipe.kind)}, which does not permit a GOLD_EVAL name (RECIPE_KIND_RULE: only 'golden' does); declare the acceptance recipe kind 'golden'`;
	}
	return '';
};

const stampPromotionAction = (callback) => {
	const { xLog, commandLineParameters } = process.global;
	const containerName = firstValue(commandLineParameters, 'containerName');
	// ⟪lane REFORGE, forgeClean R3⟫ reforgeDeterminism joined the stamp: its evidence is reforgeCompare's -summarize file, REQUIRED
	// for the same reason as the other two (a stamp that recorded some verdicts would leave the rest reading notRun beside a
	// claim of promotion)
	// ⟪lane FIX, 2026-10-09⟫ the replay row's evidence is EITHER a true -replay run log (--replayLogPath, ~10 min) OR a replay
	// build log (--replayBuildLogPath, ~25 min): exactly one is named, and the evidence reader is the one for the kind named
	const replayEvidenceReaderNameList = Object.keys(STAMP_REPLAY_EVIDENCE_READER_BY_PARAMETER_NAME).filter((parameterName) => firstValue(commandLineParameters, parameterName));
	const evidenceList = [
		{ evidenceReaderName: 'goldEvalCheck', evidencePath: firstValue(commandLineParameters, 'goldEvalCheckLogPath') },
		...replayEvidenceReaderNameList.map((parameterName) => ({ evidenceReaderName: STAMP_REPLAY_EVIDENCE_READER_BY_PARAMETER_NAME[parameterName], evidencePath: firstValue(commandLineParameters, parameterName) })),
		{ evidenceReaderName: 'reforgeDeterminism', evidencePath: firstValue(commandLineParameters, 'reforgeEvidencePath') },
	];
	const missingParameterList = []
		.concat(containerName ? [] : ['--containerName=<the PROMOTED container name>'])
		.concat(evidenceList[0].evidencePath ? [] : ['--goldEvalCheckLogPath=<the saved -goldEvalCheck output>'])
		.concat(replayEvidenceReaderNameList.length ? [] : ['ONE of --replayLogPath=<the -replay run log of this manifest> or --replayBuildLogPath=<the zero-judge replay build log>'])
		.concat(evidenceList[evidenceList.length - 1].evidencePath ? [] : ['--reforgeEvidencePath=<the reforgeCompare -summarize evidence file>']);
	if (missingParameterList.length) {
		callback(`graphBuilder -stampPromotion: ${missingParameterList.join(', ')} REQUIRED, with no default — the stamp records evidence, and evidence must be named`);
		return;
	}
	if (replayEvidenceReaderNameList.length > 1) {
		callback(`graphBuilder -stampPromotion: REFUSED — ${replayEvidenceReaderNameList.map((parameterName) => `--${parameterName}`).join(' and ')} are both named; the replay row records ONE piece of evidence, so name one`);
		return;
	}
	// ⟪EC, ruling 2026-10-25⟫ the store the -goldEvalCheck evidence certified (its certificate's standardsDatabaseFilePath) must not be an unfolded delta
	const goldEvalCheckLogPath = evidenceList[0].evidencePath;
	const certifiedStoreFilePathList = fs.existsSync(goldEvalCheckLogPath) ? [...new Set([...fs.readFileSync(goldEvalCheckLogPath, 'utf8').matchAll(/"standardsDatabaseFilePath":\s*"([^"]+)"/g)].map((oneMatch) => oneMatch[1]))] : [];
	const promotionDeltaRefusal = certifiedStoreFilePathList.map((databaseFilePath) => unfoldedDeltaRefusal({ databaseFilePath, actionName: '-stampPromotion' })).find(Boolean);
	if (promotionDeltaRefusal) {
		callback(promotionDeltaRefusal);
		return;
	}
	const vocabulary = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
	const certificationCheckLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'bridge-framework', 'certificationCheck'));
	const finishingDir = path.join(__dirname, '..', 'apps', 'replay-manager', 'lib', 'finishing');
	const passportWriter = require(path.join(finishingDir, 'passport-writer'))({ vocabulary, debugMappingSource: certificationCheckLib.DEBUG_MAPPING_SOURCE });
	const promotionStamp = require(path.join(finishingDir, 'promotion-stamp'))({ vocabulary, passportWriter });
	const promotionEvidenceLib = require('./promotion-evidence');
	const neo4j = require('neo4j-driver');
	const taskList = new taskListPlus();

	// the bolt port and credential are read from the container, as -roundTripCompile reads them
	taskList.push((args, next) => {
		require(path.join(__dirname, '..', '..', '..', 'lib', 'graph-connection', 'containerBolt')).resolveContainerBolt({ containerName }, (resolveError, resolved) => {
			if (resolveError) {
				next(`graphBuilder -stampPromotion: ${resolveError}`);
				return;
			}
			const driver = neo4j.driver(resolved.boltUrl, neo4j.auth.basic('neo4j', resolved.password), { encrypted: false });
			const session = driver.session();
			const runCypher = ({ cypher }, cypherCallback) =>
				session.run(cypher).then((result) => cypherCallback('', result), (cypherError) => cypherCallback(cypherError.message));
			next('', { ...args, runCypher, closeAll: () => session.close().then(() => driver.close(), () => driver.close()) });
		});
	});
	taskList.push((args, next) => {
		args.runCypher({ cypher: `MATCH (p:GraphProvenance) RETURN p.manifestRefId AS manifestRefId, p.recipeName AS recipeName` }, (err, result) => {
			const rows = (result && result.records) || [];
			if (err || rows.length !== 1) {
				next(`graphBuilder -stampPromotion: '${containerName}' does not hold exactly one passport with a manifestRefId${err ? ` (${err})` : ''}`);
				return;
			}
			next('', { ...args, manifestRefId: rows[0].get('manifestRefId'), recipeName: rows[0].get('recipeName') });
		});
	});
	// ⟪campaign P2, W-C-10⟫ a GOLD_EVAL_* name is permitted only to a graph whose recipe's kind allows it (RECIPE_KIND_RULE):
	// the recipe is found by the passport's recipeName under the recipes/<recipeName>.recipe.jsonc convention -goldEvalCheck uses
	taskList.push((args, next) => {
		const kindVerdict = promotionKindRefusal({ containerName, recipeName: args.recipeName });
		if (kindVerdict) {
			next(kindVerdict);
			return;
		}
		next('', args);
	});
	taskList.push((args, next) => {
		const readList = evidenceList.map((oneEvidence) => promotionEvidenceLib.gateVerdictFor({ ...oneEvidence, manifestRefId: args.manifestRefId }));
		const refusedRead = readList.find((oneRead) => oneRead.error);
		if (refusedRead) {
			next(`graphBuilder -stampPromotion: ${refusedRead.error}`);
			return;
		}
		next('', { ...args, gateVerdictList: readList });
	});
	taskList.push((args, next) => {
		promotionStamp.stampPromotion({ runCypher: args.runCypher, promotedGraphName: containerName, gateVerdictList: args.gateVerdictList }, (err, stamped) => (err ? next(err) : next('', { ...args, stamped })));
	});
	pipeRunner(taskList.getList(), {}, (err, args) => {
		const finishWith = () => {
			if (err) {
				callback(err);
				return;
			}
			xLog.status(`graphBuilder: [stampPromotion] ${args.stamped.summary}`);
			args.gateVerdictList.forEach((oneVerdict) => xLog.status(`graphBuilder: [stampPromotion] ${oneVerdict.gate}: ${oneVerdict.verdict} — ${oneVerdict.detail} (evidence ${oneVerdict.evidencePath} sha256 ${oneVerdict.evidenceSha256})`));
			callback('', args.stamped);
		};
		if (args && typeof args.closeAll === 'function') {
			args.closeAll().then(finishWith);
			return;
		}
		finishWith();
	});
};

const truncateStoreAction = (callback, injectedDeps = {}) => {
	const { xLog } = process.global;

	const supportStoreResolution = resolveStoreFamilyPath({ familyName: 'standardsDatabase', commandLineParameters: process.global.commandLineParameters, storesConfig: process.global.getConfig('stores'), actionName: '-truncateStore' }); // W-C-11: a configured store must exist
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

// ---------------------------------------------------------------------
// -spendLedger  ⟪spend ledger R1, 2026-10-21⟫
// ---------------------------------------------------------------------
// Read the LIFETIME spend ledger (one JSONL line per build, appended by build.js) and print what was spent, by day, by
// recipe and by provider:model. Read-only. The ledger is [spendLedger].lifetimeLedgerFilePath in graphBuilder.ini, or
// --lifetimeLedgerFilePath; --since=YYYY-MM-DD and --recipe=<recipeName> narrow it. No ledger path is refused by name.
const spendLedgerAction = (callback) => {
	const { xLog, commandLineParameters, getConfig } = process.global;
	const spendLedgerLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'spend-ledger', 'spendLedger'));
	const lifetimeLedgerFilePath = firstValue(commandLineParameters, 'lifetimeLedgerFilePath') || (getConfig('spendLedger') || {}).lifetimeLedgerFilePath;
	if (typeof lifetimeLedgerFilePath !== 'string' || lifetimeLedgerFilePath.trim() === '') {
		callback('graphBuilder -spendLedger: no lifetime ledger is named. Set [spendLedger].lifetimeLedgerFilePath in graphBuilder.ini or pass --lifetimeLedgerFilePath=<path>; there is no default.');
		return;
	}
	const sinceDayText = firstValue(commandLineParameters, 'since');
	const recipeName = firstValue(commandLineParameters, 'recipe');
	spendLedgerLib.querySpendLedger({ lifetimeLedgerFilePath, sinceDayText, recipeName }, (queryError, queried) => {
		if (queryError) {
			callback(`graphBuilder -spendLedger: ${queryError}`);
			return;
		}
		const usdText = (usd) => `$${usd.toFixed(4)}`;
		const groupLineList = (titleText, totalsByName) => [titleText].concat(Object.keys(totalsByName).sort().map((groupName) => `  ${groupName}: ${usdText(totalsByName[groupName].usd)} over ${totalsByName[groupName].buildCount} build(s) (judge ${usdText(totalsByName[groupName].judgeUsd)}, embedding ${usdText(totalsByName[groupName].embeddingUsd)}; saved ${usdText(totalsByName[groupName].savedUsd)}${totalsByName[groupName].savedUsdUnknownCount ? ` +${totalsByName[groupName].savedUsdUnknownCount} unknown` : ''})`));
		const providerLineList = ['by provider:model'].concat(Object.keys(queried.byProviderModel).sort().map((providerModelName) => `  ${providerModelName}: ${usdText(queried.byProviderModel[providerModelName].usd)} over ${queried.byProviderModel[providerModelName].callCount} call(s) (${queried.byProviderModel[providerModelName].inputTokens} in / ${queried.byProviderModel[providerModelName].outputTokens} out)`));
		const filterText = `${sinceDayText === undefined ? 'all days' : `since ${sinceDayText}`}, ${recipeName === undefined ? 'every recipe' : `recipe ${recipeName}`}`;
		[`graphBuilder: -spendLedger ${lifetimeLedgerFilePath} (${filterText}): ${usdText(queried.totals.usd)} over ${queried.totals.buildCount} build(s)`]
			.concat(groupLineList('by day', queried.byDay), groupLineList('by recipe', queried.byRecipe), providerLineList)
			.forEach((lineText) => xLog.status(lineText));
		callback('', { exitCode: 0, resultText: JSON.stringify({ lifetimeLedgerFilePath, sinceDayText: sinceDayText === undefined ? null : sinceDayText, recipeName: recipeName === undefined ? null : recipeName, totals: queried.totals, byDay: queried.byDay, byRecipe: queried.byRecipe, byProviderModel: queried.byProviderModel }, null, 2) });
	});
};

// ⟪mappingLayers ML1-b, 2026-10-24 (STEEL_BRIDGE)⟫ -publishLayer — freeze one SSSOM/TSV set as a version of a registered mapping
// layer (lib/layer-registry/publishLayer.js): validates (parseSssomTsv, then the REAL sssom-py at --sssomValidatorPath), freezes the
// whole set and its per-pair blocks into --decisionStoreFilePath, appends the version (Candidate) to the layer registry and prints
// the content id. Idempotent on identical bytes (alreadyPresent); a tag already holding other bytes is refused by name. Lists no
// library and touches no manifest. The registries default to the tree's recipes/layers.json and recipes/agents.json (help says so).
const PUBLISH_LAYER_REGISTRY_DEFAULT_PATH_BY_PARAMETER_NAME = Object.freeze({
	layerRegistryFilePath: path.join(__dirname, '..', '..', '..', 'recipes', 'layers.json'),
	agentRegistryFilePath: path.join(__dirname, '..', '..', '..', 'recipes', 'agents.json'),
});
const publishLayerAction = (callback) => {
	const { xLog, commandLineParameters } = process.global;
	const { spawnSync } = require('child_process');
	const layerRegistryLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'layer-registry', 'layerRegistry'));
	const publishLayerLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'layer-registry', 'publishLayer'));
	const requiredParameterNameList = ['layerKey', 'versionTag', 'sssomPath', 'decisionStoreFilePath', 'sssomValidatorPath'];
	const missingParameterList = requiredParameterNameList.filter((parameterName) => !firstValue(commandLineParameters, parameterName));
	if (missingParameterList.length) {
		callback(`graphBuilder -publishLayer: ${missingParameterList.map((parameterName) => `--${parameterName}`).join(', ')} REQUIRED, with no default — a publish names what it freezes, where, and the validator that blesses it`);
		return;
	}
	const sssomPath = path.resolve(firstValue(commandLineParameters, 'sssomPath'));
	const sssomValidatorPath = firstValue(commandLineParameters, 'sssomValidatorPath');
	if (!fs.existsSync(sssomPath) || !fs.existsSync(sssomValidatorPath)) {
		callback(`graphBuilder -publishLayer: REFUSED — ${!fs.existsSync(sssomPath) ? `--sssomPath ${sssomPath}` : `--sssomValidatorPath ${sssomValidatorPath}`} does not exist`);
		return;
	}
	const registryPathByParameterName = Object.keys(PUBLISH_LAYER_REGISTRY_DEFAULT_PATH_BY_PARAMETER_NAME).reduce((soFar, parameterName) => ({ ...soFar, [parameterName]: firstValue(commandLineParameters, parameterName) || PUBLISH_LAYER_REGISTRY_DEFAULT_PATH_BY_PARAMETER_NAME[parameterName] }), {});
	const loaded = layerRegistryLib.loadRegistry(registryPathByParameterName);
	if (loaded.error) {
		callback(`graphBuilder -publishLayer: ${loaded.error}`);
		return;
	}
	// the REAL validator, run as a child: exit 0 is a pass, anything else is its own words
	const validateWithSssomPy = (validatedPath, validatedCallback) => {
		const validatorRun = spawnSync(sssomValidatorPath, ['validate', validatedPath], { encoding: 'utf8' });
		xLog.status(`graphBuilder: [publishLayer] sssom validate ${validatedPath}: exit ${validatorRun.status}`);
		validatedCallback(validatorRun.status === 0 ? '' : `exit ${validatorRun.status}: ${`${validatorRun.stdout}\n${validatorRun.stderr}`.trim().slice(0, 2000)}`);
	};
	requireDecisionStore()().open({ databaseFilePath: firstValue(commandLineParameters, 'decisionStoreFilePath') }, (openError, decisionStore) => {
		if (openError) {
			callback(`graphBuilder -publishLayer: ${openError}`);
			return;
		}
		const publishArgs = {
			sssomText: fs.readFileSync(sssomPath, 'utf8'),
			sssomPath,
			layerKey: firstValue(commandLineParameters, 'layerKey'),
			versionTag: firstValue(commandLineParameters, 'versionTag'),
			authorIri: firstValue(commandLineParameters, 'authorIri'),
			registry: loaded.registry,
			decisionStore,
			publishedAt: new Date().toISOString(),
			validateWithSssomPy,
		};
		publishLayerLib.publishLayer(publishArgs, (publishError, published) => {
			if (publishError) {
				callback(`graphBuilder -publishLayer: ${publishError}`);
				return;
			}
			// the store already holds the blocks; the registry is written last, by temp file and rename, so a crash between the two
			// leaves blocks a re-run finds alreadyPresent and a registry that never names a block it does not have
			if (published.layerRegistry !== null) {
				const registryFilePath = registryPathByParameterName.layerRegistryFilePath;
				const temporaryFilePath = `${registryFilePath}.publishLayer-${process.pid}.tmp`;
				fs.writeFileSync(temporaryFilePath, layerRegistryLib.registryText(published.layerRegistry));
				fs.renameSync(temporaryFilePath, registryFilePath);
			}
			const { layerRegistry, ...reported } = published;
			xLog.status(`graphBuilder: [publishLayer] ${published.alreadyPresent ? 'alreadyPresent' : 'published'} ${published.layerVersionUri} contentId ${published.contentId} (${published.memberBlockList.length} pair block(s))`);
			callback('', { exitCode: 0, resultText: JSON.stringify(reported, null, 2) });
		});
	});
};

return {
	build,
	validate,
	deps,
	replay,
	retrievalMetrics: retrievalMetricsAction,
	roundTripCompile: roundTripVerbActionFor('roundTripCompile'),
	roundTripGates: roundTripVerbActionFor('roundTripGates'),
	goldEvalCheck: goldEvalCheckAction,
	truncateStore: truncateStoreAction,
	foldStore: foldStoreAction,
	stampPromotion: stampPromotionAction,
	spendLedger: spendLedgerAction,
	publishLayer: publishLayerAction,
	scanAvailableForges,
	// exported for the hermetic gates: the no-default refusal is the phase's headline claim, and a
	// claim provable only by launching a whole build is a claim nobody re-checks.
	resolveSupportStoreFilePath,
	resolveStoreFamilyPath,
	unfoldedDeltaRefusal,
	STORE_FAMILY_RESOLUTION_TABLE,
	embeddingCacheFilePathFor,
	// ⟪campaign P2, W-C-10⟫ the GOLD_EVAL kind gate and the -build lineage flag, for their hermetic gates
	promotionKindRefusal,
	resolveBasedOnManifestRefId,
};
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
