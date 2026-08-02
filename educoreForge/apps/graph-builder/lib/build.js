'use strict';

// build.js — graphBuilder's -build orchestration. Requires the component modules IN-PROCESS and
// drives the §4.4 build sequence over them, threading real recipe data (tokens, versions, pair
// keys, harvested schema blocks) through the contracts declared in ../interfaces.js.
//
//   build(recipe, { xLog, standardsDatabase, components }, callback)
//       -> callback('', { manifestId, boltUrl, memberCount })
//
// IT DRIVES THE REAL COMPONENTS. Until 2026-07-23 this file drove a set of stub bodies and its
// own header claimed the contract was "already proven here" — which was false: what was proven
// was the STUB contract, and the two had drifted apart in three places at once (a positional
// manifest.add, an id() the manifest never had, and a create() called with three different
// argument shapes expecting a bolt url back). The stubs are gone and the calls below are the
// declared ones.
//
// STANDARDS DATABASE: injected, never discovered here. A manifest writes every schema block
// THROUGH to the store on add, so the store is a stateful shared resource and belongs to the
// orchestrator above this one (polyArch2 §2, "Injected Shared Resources"). It is REQUIRED and has
// no default — standards-database's own rule, carried to its caller: a build that must say where
// it writes cannot fall through to writing the canonical store, which is exactly what happened on
// 2026-07-17.
//
// COMPONENT SEAM: `deps.components` may override any of the four component FACTORIES; anything not
// named falls through to the real module. Production passes nothing and gets the real four. The
// seam exists so a test can drive the whole pipeline WITHOUT Docker, Voyage or a database, and so
// a test can inject a component that FAILS — without it the orchestrator's error paths could never
// be observed firing, and a path never observed is a path unproven.
//
// Pipeline (targetArchitectureDesign §4.4; hub-fold design TQ 2026-07-24):
//   A  forger.forge({..., deriveHub}) -> replayManager.create
//                   -> init(nodeEdges, applyLabels:[StandardBase])
//                   -> harvest(selectionLabels:[StandardBase]) -> manifest.add({..._base}) -> delete
//      THE HUB FOLDS INTO THE BASE. When recipe.hubs names a standard, build.js sets deriveHub on
//      that standard's forge spec; the FORGER then derives the hub and CONCATENATES its nodes/edges
//      into the nodeEdges it returns. So the ordinary [StandardBase] init (which stamps StandardBase
//      on every loaded node, hub nodes included, keeping their intrinsic HubReference/HubDefinition
//      labels) and the ordinary [StandardBase] harvest mint ONE block carrying base + hub, with the
//      hub's HAS_CEDS_*/IN_HUB edges resolving WITHIN it. There is NO separate hub block, NO separate
//      hub harvest, and NO replay-engine change — build.js never learns hub construction at all.
//   C  per bridge: create -> bridgeMaker.run (labels edges) -> harvest(:BridgedRelation)
//                        -> manifest.add({...}) -> delete
//   compose      -> manifest.refId() over the membership
//   materialize  -> create() (an EMPTY graph, always) then init({ schemaBlocks }) to fill it.
//                   create is MONOMORPHIC: it does not take a manifest and does not return a url.
//                   All polymorphism about putting content INTO a graph lives in init.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();
const { readOptionalBooleanValue } = require('./optional-boolean-value');

// the VOCABULARY REGISTRY — read here for the subject role marker (§1 of the hub-port plan).
// The base block's subject is <standard>@<version> plus the marker its KIND requires; the
// marker comes from ONE table (SCHEMA_BLOCK_KIND_SUFFIX), never a literal composed here.
const vocabulary = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

// NOTE (hub-fold design 2026-07-24): the hub derivation no longer lives here. It moved INTO the
// forger (HUB_FORGE_BY_STANDARD + foldHubIntoNodeEdges), which folds each hub standard's hub into
// the nodeEdges it returns. build.js never deserializes a base block, never runs forgeHub, and
// never mints a separate hub block — so the replay-block codec and the hub-forge registry that the
// first Phase-3 attempt required here are gone.

// The four component modules. bridgeMaker is REAL-required but STUB-BODIED by design as of
// 2026-07-22 (its body lands with Phase C bridging); the other three have real bodies. There is no
// stub-components.js any more — a second set of implementations is a second contract, and the
// drift this file just had is what that costs.
const defaultComponents = {
	forger: require(path.join(__dirname, '..', 'apps', 'forger')),
	replayManager: require(path.join(__dirname, '..', 'apps', 'replay-manager')),
	bridgeMaker: require(path.join(__dirname, '..', 'apps', 'bridge-maker')),
	manifestEditor: require(path.join(__dirname, '..', 'apps', 'manifest-editor')),
};

// The REAL Anthropic reranker llmClient factory (P3b) — the DEFAULT the inference pre-pass constructs when a
// real --rebridge runs. It is a factory (curried moduleFunction) build.js calls to MINT a client; a test
// injects its own via deps.llmClientFactory, and the hermetic suite bypasses it entirely by injecting a
// ready STUB on deps.inferenceConfig.llmClient (so this real factory is NEVER called under runAllTests —
// §3 hard line 2). It is required at module top like every other component; it is only CALLED for a real
// --rebridge (resolveInferenceConfig's eager gate below).
const realLlmClientFactory = require(path.join(__dirname, '..', 'apps', 'bridge-maker', 'lib', 'llmClient'));

// canonical [anthropicAi] config home (the twin of embedding-client's [voyageEmbedding] path). The real
// llmClient reads the key from here OR from ANTHROPIC_API_KEY, and THROWS BY NAME at construction if neither
// resolves (§6 no-silent-default). Absolute, so both trees name the one file that holds the secret.
const ANTHROPIC_CONFIG_FILE_PATH =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/configs/instanceSpecific/qbook/anthropicAi.ini';

// Label vocabulary — BARE NAMES. The colons in ':BridgedRelation:' are Cypher notation, not part
// of the name; a constant carrying them would create a label literally called ':BridgedRelation:'.
// These are handed DOWN: init stamps them, harvest selects on them, so the producing side and the
// harvesting side agree by parameter instead of by two hopeful literals.
const BASE_GRAPH_LABEL = 'StandardBase';
const RELATION_LABEL = 'BridgedRelation';

// minimal sequential async iterator (err-string convention). taskListPlus sequences a KNOWN list
// of steps; this sequences an unknown-length list of items, each of which is itself a taskList.
const eachSeries = (items, iterator, done) => {
	let index = 0;
	const step = () => {
		if (index >= items.length) {
			done('');
			return;
		}
		const item = items[index];
		index += 1;
		iterator(item, (err) => {
			if (err) {
				done(err);
				return;
			}
			step();
		});
	};
	step();
};

// materializeSchemaBlocks — RESTORE a resolved set of schema blocks into a FRESH eval graph, and
// hand back { manifestId, boltUrl, memberCount }. This is the pure materialize/restore tail shared by
// TWO callers: composeAndMaterialize (a manifest just composed by a -build) and replay (a manifest
// OPENED from storage by -replay). Both do the identical last act — create an EMPTY graph, then
// init({schemaBlocks}) to fill it — so it lives once here rather than drifting apart in two places.
// It takes ALREADY-RESOLVED blocks: resolving a manifest's members is the caller's step (compose
// names its failure 'compose failed'; replay names its own), and keeping that out of here is what lets
// the messages below stay identical for both. create is MONOMORPHIC (no manifest, no url back) and the
// RESTORATION init carries no applyLabels — a harvested block already carries its stamped labels.
// DISPOSE-ON-FAILURE (Item 4): the eval graph is created here and is the product ONLY on success; an
// init failure disposes it rather than stranding a live DEV_* container. No forger, no bridge.
// =====================================================================================
// runCedsFidelityGate — R-1: the round trip FAILS THE BUILD, it does not merely report
// =====================================================================================
// ⟪TQ, 2026-08-02: "yes, R1 please"⟫
//
// Until this existed, CEDS round-trip fidelity was a verb somebody had to remember to run.
// A future change could break it, the build would succeed, and nothing would say a word.
// Everything proven about the graph rested on someone CHOOSING to look. That is the whole
// distance between "we proved it" and "it stays proven".
//
// RUNS ONLY WHEN CEDS IS IN THE GRAPH. A recipe without CEDS has nothing to check, and a
// gate that fires on irrelevant builds gets disabled by the first person it inconveniences.
//
// THE ESCAPE HATCH REQUIRES YOU TO NAME THE NUMBER. `--allowFidelityLoss=<n>` accepts up to
// n lost statements and NOTHING ELSE -- any loss above n still fails, and INVENTION always
// fails regardless. So the flag cannot be left on to absorb a future regression: it is a
// statement about a specific known gap, not a mute button. A plain on/off skip is exactly
// the expectFail masking gate M-2 forbids, and it is deliberately not offered.
const runCedsFidelityGate = ({ xLog, graphName, standardTokens, commandLineParameters }, callback) => {
	const tokens = (standardTokens || []).map((one) => String(one).toLowerCase());
	if (!tokens.includes('ceds')) {
		callback('');
		return;
	}

	const rawAllowance = ((commandLineParameters || {}).values || {}).allowFidelityLoss;
	const allowanceText = Array.isArray(rawAllowance) ? rawAllowance[0] : rawAllowance;
	let allowedLoss = 0;
	if (allowanceText !== undefined) {
		allowedLoss = Number(allowanceText);
		if (!Number.isInteger(allowedLoss) || allowedLoss < 0) {
			callback(
				`graphBuilder build: --allowFidelityLoss must be a non-negative INTEGER naming the exact ` +
					`number of lost statements you are accepting, got '${allowanceText}'. It is not an ` +
					`on/off switch: a gate that can be silently disabled is not a gate.`,
			);
			return;
		}
	}

	const compilerLib = require(
		path.join(__dirname, '..', '..', '..', 'forges', 'ceds', 'lib', 'roundTripCompiler'),
	)();
	const canonicalLib = require(
		path.join(__dirname, '..', '..', '..', 'forges', 'ceds', 'lib', 'roundTripCanonical'),
	)();
	const diffLib = require(
		path.join(__dirname, '..', '..', '..', 'forges', 'ceds', 'lib', 'roundTripDiff'),
	)();

	const sourcePath = path.join(
		__dirname, '..', '..', '..',
		'forges', 'ceds', 'assets', 'standardSourceData', '01', 'CEDS-Ontology.rdf',
	);
	if (!fs.existsSync(sourcePath)) {
		callback(
			`graphBuilder build: the CEDS fidelity gate cannot run -- the source ontology ` +
				`'${sourcePath}' does not exist. REFUSED rather than skipped: a gate that quietly ` +
				`does not run is indistinguishable from one that passed.`,
		);
		return;
	}

	xLog.status(`  [fidelity] round-tripping CEDS out of '${graphName}' (R-1)`);
	const emittedPath = path.join(
		os.tmpdir(),
		`cedsFidelityGate-${process.pid}-${resolvedSchemaBlocksCounter()}.rdf`,
	);

	compilerLib.resolveContainerBolt({ containerName: graphName }, (resolveError, resolved) => {
		if (resolveError) {
			callback(`graphBuilder build: the CEDS fidelity gate could not reach the graph: ${resolveError}`);
			return;
		}
		const reader = compilerLib.makeNeo4jCedsReader(resolved);
		compilerLib.compileToFile({ reader, outPath: emittedPath }, (compileError) => {
			reader.close(() => {});
			if (compileError) {
				callback(`graphBuilder build: the CEDS fidelity gate failed to compile: ${compileError}`);
				return;
			}
			diffLib.compareRdfFiles(
				{ sourcePath, emittedPath, context: { gate: 'R-1', graphName } },
				(compareError, compared) => {
					fs.unlink(emittedPath, () => {});
					if (compareError) {
						callback(`graphBuilder build: the CEDS fidelity gate failed to diff: ${compareError}`);
						return;
					}
					const { headline } = compared.report;
					xLog.status(
						`  [fidelity] source ${headline.sourceStatements}, matched ${headline.matched}, ` +
							`LOST ${headline.lost}, INVENTED ${headline.invented}`,
					);
					// INVENTION IS NEVER ALLOWED. A gap is a gap; a fabrication is an assertion about
					// CEDS that CEDS never made, and no allowance covers it.
					if (headline.invented > 0) {
						callback(
							`graphBuilder build: FIDELITY GATE FAILED -- the graph would assert ` +
								`${headline.invented} statement(s) CEDS does NOT make. Invention is never ` +
								`permitted and --allowFidelityLoss does not cover it.`,
						);
						return;
					}
					if (headline.lost > allowedLoss) {
						callback(
							`graphBuilder build: FIDELITY GATE FAILED -- ${headline.lost} CEDS statement(s) ` +
								`do not round-trip` +
								(allowedLoss
									? `, which exceeds the --allowFidelityLoss=${allowedLoss} you named.`
									: `. Run 'graphBuilder -cedsRoundTrip --containerName=${graphName}' for the ` +
										`per-predicate attribution, or name the gap you are accepting with ` +
										`--allowFidelityLoss=${headline.lost}.`),
						);
						return;
					}
					if (allowedLoss) {
						xLog.status(
							`  [fidelity] PASSED under an EXPLICIT allowance of ${allowedLoss} lost ` +
								`statement(s) -- this build is knowingly incomplete`,
						);
					} else {
						xLog.status(`  [fidelity] PASSED -- zero lost, zero invented`);
					}
					callback('');
				},
			);
		});
	});
};

let materializeCounter = 0;
const resolvedSchemaBlocksCounter = () => (materializeCounter += 1);

const materializeSchemaBlocks = ({ xLog, replay, resolvedSchemaBlocks, manifestId, memberCount, standardTokens, commandLineParameters }, callback) => {
	replay.create({ purpose: 'materialize' }, (createError, goldEval) => {
		if (createError) {
			callback(`materialize failed: creating the eval golden: ${createError}`);
			return;
		}
		replay.init({ inGraph: goldEval, schemaBlocks: resolvedSchemaBlocks }, (initError) => {
			if (initError) {
				replay.delete(goldEval, (deleteErr) => {
					callback(
						deleteErr
							? `materialize failed: loading ${resolvedSchemaBlocks.length} schema block(s): ${initError} ` +
									`(and the eval golden '${goldEval.graphName}' also failed to dispose and is leaking: ${deleteErr})`
							: `materialize failed: loading ${resolvedSchemaBlocks.length} schema block(s): ${initError}`,
					);
				});
				return;
			}
			xLog.status(`  [materialize] -> ${goldEval.boltUrl}`);
			// R-1: the product is not a product until it round-trips. The graph is NOT deleted on
			// failure -- an operator needs to inspect the thing that failed.
			runCedsFidelityGate(
				{
					xLog,
					graphName: goldEval.graphName,
					standardTokens,
					commandLineParameters,
				},
				(fidelityError) => {
					if (fidelityError) {
						callback(fidelityError);
						return;
					}
					// NOT deleted — this graph is the product.
					callback('', { manifestId, boltUrl: goldEval.boltUrl, memberCount });
				},
			);
		});
	});
};

// resolveVectorize — the spend knob, made an operator switch (Item 11). Precedence: an explicit
// deps.vectorize (the orchestrator's/test's injected boolean) wins; absent, --vectorize is read
// through the production optional reader with a DOCUMENTED default of true. The normal gold build
// vectorizes, so true is the right default AND it is stated in -help — which is exactly what
// polyArch2 §6 permits for a legitimately-optional input. A supplied-but-non-boolean deps.vectorize
// and a typed-but-invalid --vectorize=no are both refused BY NAME rather than silently corrected.
// Returns { value } or { error }; no throw, so build() routes a refusal through its callback.
const resolveVectorize = (deps) => {
	if (deps.vectorize !== undefined) {
		if (typeof deps.vectorize !== 'boolean') {
			return {
				error:
					`graphBuilder build: deps.vectorize must be a boolean when supplied, got ` +
					`${typeof deps.vectorize} (${JSON.stringify(deps.vectorize)}). It was NOT corrected to a default.`,
			};
		}
		return { value: deps.vectorize };
	}
	const commandLineParameters =
		(process.global && process.global.commandLineParameters) || { values: {}, switches: {} };
	return readOptionalBooleanValue({
		name: 'vectorize',
		commandLineParameters,
		moduleName: 'graphBuilder -build',
		whatItControls: 'whether -build spends real Voyage embedding credit (the normal gold build vectorizes)',
		defaultValue: true,
	});
};

// resolveEmbeddingCacheFilePath — the vector-cache override ("unless we say otherwise" / test isolation).
// The STANDING POLICY is the shared, content-addressed vector cache ON by default: a build that names
// nothing passes no override and the forger constructs the embedder with its documented default (the one
// dataStores cache). A caller REDIRECTS it by naming a path — the embedded end-to-end gate points at a
// throwaway cache so it keeps spending real Voyage instead of being served free from the warm production
// cache. Precedence: deps.embeddingCacheFilePath (test/orchestrator injection) wins; absent, the command
// line --embeddingCacheFilePath is read; absent entirely, undefined (no override). No throw: it is a path
// or nothing, threaded verbatim to the forger, which threads it to the embedder as cacheFilePath.
const resolveEmbeddingCacheFilePath = (deps) => {
	if (deps.embeddingCacheFilePath !== undefined) {
		return deps.embeddingCacheFilePath;
	}
	const commandLineParameters =
		(process.global && process.global.commandLineParameters) || { values: {} };
	// qtools parses every --flag=value into an ARRAY under values[name]; the first element is the
	// value (the same `(values[name] || [])[0]` idiom actions.js reads recipePath/standardsDatabase by).
	// Reading the array itself would hand the embedder a non-string path that vectorCache.open refuses.
	return (commandLineParameters.values.embeddingCacheFilePath || [])[0];
};

// resolveRebridge — the INFERENCE spend knob (design §5.5), an operator switch with the same §6 discipline
// as resolveVectorize. A normal -build MATERIALIZES from whatever frozen decision blocks exist (zero LLM,
// zero Voyage); --rebridge (SCOPED) is the only thing that RUNS the inference pre-pass to produce/refresh a
// pair's frozen block. Precedence: an explicit deps.rebridge (the orchestrator's/test's injected scope) wins;
// absent, --rebridge is read from the command line. The DOCUMENTED default is NONE (no pair rebridges — a
// plain build never silently spends; a pair with no frozen block simply has no inferred edges). Scope values:
// an array of source tokens (['ctdl']), the string 'all', or absent/empty (none). A supplied-but-wrong-typed
// deps.rebridge is refused BY NAME rather than silently corrected. Returns { value } (a normalized scope:
// 'all' | string[] ) or { error }; no throw, so build() routes a refusal through its callback.
const resolveRebridge = (deps) => {
	if (deps.rebridge !== undefined) {
		if (deps.rebridge === 'all' || Array.isArray(deps.rebridge)) {
			return { value: deps.rebridge };
		}
		return {
			error:
				`graphBuilder build: deps.rebridge must be an array of source tokens or the string 'all' when ` +
				`supplied, got ${typeof deps.rebridge} (${JSON.stringify(deps.rebridge)}). It was NOT corrected ` +
				`to a default.`,
		};
	}
	const commandLineParameters =
		(process.global && process.global.commandLineParameters) || { values: {}, switches: {} };
	const scopeValues = (commandLineParameters.values && commandLineParameters.values.rebridge) || [];
	// --rebridge=all OR --rebridge=ctdl,lif OR repeated --rebridge=ctdl --rebridge=lif; absent -> [] (none).
	if (scopeValues.some((oneValue) => `${oneValue}`.trim().toLowerCase() === 'all')) {
		return { value: 'all' };
	}
	const tokens = scopeValues
		.reduce((soFar, oneValue) => soFar.concat(`${oneValue}`.split(',')), [])
		.map((oneToken) => oneToken.trim())
		.filter((oneToken) => oneToken !== '');
	return { value: tokens };
};

// pairInRebridgeScope — is THIS pairing to run the inference pre-pass? The scope match happens HERE, where
// the recipe pair is known, not guessed inside the plugin (§6 no-silent-default). 'all' rebridges every pair;
// an array rebridges a pair whose source token is named (case-insensitive).
const pairInRebridgeScope = (rebridgeScope, bridge) => {
	if (rebridgeScope === 'all') {
		return true;
	}
	if (!Array.isArray(rebridgeScope) || rebridgeScope.length === 0) {
		return false;
	}
	const source = `${bridge.source}`.toLowerCase();
	return rebridgeScope.some((oneToken) => `${oneToken}`.toLowerCase() === source);
};

// rebridgeScopeIsActive — does the resolved scope mean a real --rebridge is happening this run (as opposed
// to a plain build that only MATERIALIZES frozen blocks)? 'all' or a non-empty token array is active; an
// empty array (the documented default, §5.5) is not.
const rebridgeScopeIsActive = (rebridgeScope) =>
	rebridgeScope === 'all' || (Array.isArray(rebridgeScope) && rebridgeScope.length > 0);

// resolveInferenceConfig — assemble the inferred producer's run config, SELECTING the reranker llmClient with
// the same §6 discipline as vectorize/rebridge. This is the real-vs-stub seam (the FACTORY):
//   1. deps.inferenceConfig.llmClient present -> used AS-IS. The hermetic suite injects a deterministic STUB
//      this way, so the real factory is NEVER consulted under runAllTests (§3 hard line 2). An orchestrator
//      may likewise inject its own client.
//   2. else, when the --rebridge scope is ACTIVE (a real reforge WILL run the pre-pass), MINT a real llmClient
//      from the injected/default factory. Constructed ONLY when actually rebridging — a plain build (empty
//      scope) mints nothing, and neither does a build that only materializes. Construction THROWS BY NAME when
//      no key resolves (llmClient's own §6 refusal), surfaced here through the build's callback so a keyless
//      --rebridge fails LOUDLY before any Voyage/Opus credit is spent, never a silent no-op.
//   3. else (plain build, inactive scope) -> the config as given; the materialize path needs no llmClient.
// Answers { value } or { error } — the error-object idiom, so build() routes a refusal through its callback
// rather than throwing past it.
const resolveInferenceConfig = (deps, rebridgeScope) => {
	const base = deps.inferenceConfig || {};
	if (base.llmClient || !rebridgeScopeIsActive(rebridgeScope)) {
		return { value: base };
	}
	const llmClientFactory = deps.llmClientFactory || realLlmClientFactory;
	let mintedClient;
	// boundary translation of a CONSTRUCTION (configuration) fault into the orchestrator's callback channel —
	// the same pattern bridgeMaker uses when composing a plugin throws. Not control flow: the throw IS the §6
	// refusal, caught only to name it through build()'s callback.
	try {
		mintedClient = llmClientFactory({ configFilePath: ANTHROPIC_CONFIG_FILE_PATH });
	} catch (constructError) {
		return {
			error:
				`graphBuilder build: --rebridge is scoped active but the Anthropic reranker could not be ` +
				`constructed: ${constructError.message}`,
		};
	}
	return { value: { ...base, llmClient: mintedClient } };
};

const standardKey = (std) => `${std.token}@${std.version}`;

// slugifyVersion — a version string made safe to sit in a SUBJECT (a subject is a key, not prose):
// every run of non-alphanumerics collapses to a single '_'. Only the subject is slugged; the PRETTY
// version is kept verbatim in blocks.version and on the node.
const slugifyVersion = (version) => `${version}`.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// explicitVersionFrom — the resolved EXPLICIT version a persisted block carries in place of the recipe's
// floating 'current'. A KNOWN source gives the published version; source 'unknown' gives an honest
// 'unknown_<snapshotKey>' that names the concrete snapshot on disk rather than laundering a default into
// something that looks like a version. Derived from the forge report's snapshot-provenance triple.
const explicitVersionFrom = ({ versionSource, publishedVersion, snapshotKey }) =>
	versionSource === 'unknown' ? `unknown_${snapshotKey}` : `${publishedVersion}`;
// secondEndpointOf — the pairing's SECOND endpoint: the hub (mapping bridge) or the pairWith sibling
// (STRUCTURAL bridge), whichever the recipe named. ONE derivation, consumed by pairKey (the label) and the
// version-keyed subject composition below, so the two idioms can never drift.
const secondEndpointOf = (bridge) =>
	bridge.hub !== undefined
		? bridge.hub
		: bridge.pairWith !== undefined
			? bridge.pairWith
			: bridge.familyStandards !== undefined
				? 'family'
				: undefined;
// pairKey — the operator-facing pairing label. A hubless bridge that also names no pairWith degrades to
// '(structural)' only as a last resort (recipe validation refuses that shape upstream). This is what gives
// the CTDL family's two same-source structural entries DISTINCT labels: ctdl::ctdlasn and ctdl::ctdlqdata.
const pairKey = (bridge) => `${bridge.source}::${secondEndpointOf(bridge) || '(structural)'}`;

const isBlank = (value) => typeof value !== 'string' || value.trim() === '';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
const build = (recipe, deps, callback) => {
	const { xLog, standardsDatabase } = deps;
	const components = { ...defaultComponents, ...(deps.components || {}) };

	// ---- the orchestrator's own inputs, checked before a single component is constructed ----
	// These fire FIRST for a second reason as well as the doctrinal one: every component below is
	// now the real thing, and the real forger spends Voyage credit while the real replayManager
	// provisions Docker. A caller that has not said where its schema blocks are to be written has
	// not asked for a build, and must never get as far as either.
	if (!standardsDatabase || typeof standardsDatabase.saveBlock !== 'function') {
		callback(
			`graphBuilder build: a standardsDatabase is REQUIRED in deps and has no default. Every ` +
				`schema block is written THROUGH to the store as it is harvested, so a build with ` +
				`nowhere to write is a build that silently loses everything it made.`,
		);
		return;
	}
	if (isBlank(recipe && recipe.recipeName)) {
		callback(
			`graphBuilder build: the recipe has no recipeName. It names the manifest this build ` +
				`composes, and a manifest nobody can name is a manifest nobody can find again.`,
		);
		return;
	}
	if (isBlank(recipe.description)) {
		callback(
			`graphBuilder build: recipe '${recipe.recipeName}' has no description. The manifest ` +
				`REQUIRES one — a membership of sha256 addresses is unreadable, and the description ` +
				`is what tells the next person whether this is the graph they wanted. Add a ` +
				`"description" to the recipe.`,
		);
		return;
	}

	// vectorize is resolved BEFORE a single component is constructed: it decides whether the real
	// forger spends Voyage credit, and a caller who typed --vectorize=no must be refused here, not
	// after a container has been provisioned. deps.vectorize wins (the test seam and any future
	// programmatic caller); absent, --vectorize is read with a documented default of true.
	const vectorizeResolution = resolveVectorize(deps);
	if (vectorizeResolution.error) {
		callback(vectorizeResolution.error);
		return;
	}
	const vectorizeSpend = vectorizeResolution.value;

	// the vector-cache override, resolved once and threaded to every standard's forge (undefined = the
	// shared dataStores cache, ON by default per standing policy; a path redirects it, e.g. test isolation).
	const embeddingCacheFilePath = resolveEmbeddingCacheFilePath(deps);

	// rebridge scope is resolved alongside vectorize, same §6 discipline: a plain build MATERIALIZES frozen
	// decisions (no spend); --rebridge (scoped) RUNS the inference pre-pass. The documented default is NONE.
	const rebridgeResolution = resolveRebridge(deps);
	if (rebridgeResolution.error) {
		callback(rebridgeResolution.error);
		return;
	}
	const rebridgeScope = rebridgeResolution.value;
	// the inferred producer's run resources — injected by the orchestrator for a real reforge (P3b):
	// decisionStore is where a frozen decision block is read (plain build) / written (--rebridge);
	// inferenceConfig carries the real llmClient + topK/cosineFloor for a real --rebridge. Absent for an
	// authored-only build (the authored producer ignores both). A semantic bridge run WITHOUT a decisionStore
	// refuses BY NAME in the plugin — never a silent zero-edge success (§6).
	const decisionStore = deps.decisionStore || null;
	// ⟪P9, p9-judgmentPersistence 2026-07-31⟫ the judgment cache (decided = persisted; every
	// per-source LLM judgment lands on disk the moment it is decided) and the forensic match log
	// (one JSONL record per judgment, organized by pair). Opened by the orchestrator (actions.js,
	// which owns the documented defaults + the --judgmentCacheFilePath/--matchForensicsDirPath
	// overrides); null disables. The hermetic suites inject their own or omit them.
	const judgmentCache = deps.judgmentCache || null;
	const matchForensics = deps.matchForensics || null;
	// inferenceConfig carries the reranker llmClient for a real --rebridge. The real-vs-stub SELECTION lives in
	// resolveInferenceConfig (the FACTORY seam): the suite injects a STUB via deps.inferenceConfig.llmClient; a
	// real --rebridge with no injected client MINTS the real one, which throws BY NAME when no key resolves.
	const inferenceConfigResolution = resolveInferenceConfig(deps, rebridgeScope);
	if (inferenceConfigResolution.error) {
		callback(inferenceConfigResolution.error);
		return;
	}
	const inferenceConfig = inferenceConfigResolution.value;

	const forger = components.forger();
	const replay = components.replayManager();
	const bridgeMaker = components.bridgeMaker();
	const manifest = components.manifestEditor({ standardsDatabase }).init({
		name: recipe.recipeName,
		description: recipe.description,
		recipe,
		// provenance for the manifest: the recipe's own content hash (verifies "built from exactly
		// this recipe text") and the recipe file's name. Both come from the build entry (actions.js
		// read the file); a caller that has neither records nothing rather than inventing precision.
		recipeText: deps.recipeText,
		recipeFileName: deps.recipePath ? path.basename(deps.recipePath) : '',
	});

	const standards = Array.isArray(recipe.standards) ? recipe.standards : [];
	const hubs = Array.isArray(recipe.hubs) ? recipe.hubs : [];
	const bridges = Array.isArray(recipe.bridges) ? recipe.bridges : [];
	const hubStdSet = new Set(hubs.map((h) => String(h.standard).toLowerCase()));

	// PHASE A -> PHASE C carry (P2, implementationPlan_bridge_072426 §7). A bridge's relationship block
	// name is version-keyed on BOTH endpoints with the REAL resolved versions the forge READ (the a4a0da2
	// rule) — NOT the recipe token — so Phase A records, per standard TOKEN, the resolved version the forger
	// reported and the harvested base schema block (the bridge restores its dependency bases from these into
	// the dependency graph so the producer can WALK them).
	const resolvedVersionByToken = {};
	const baseBlockByToken = {};
	// The build's ONE embedding identity (all standards in a run share the run's embedder), captured
	// in Phase A and reused for the Phase C relationship-block harvest header: a bridged node is an
	// embedded base node, so its relationship block must declare the SAME embeddingDims/model as the
	// bases or the materialize restore gate refuses it. Undefined on --vectorize=false, when the
	// optional header fields drop and no block carries a vector.
	let buildEmbeddingModelVersion;
	let buildEmbeddingDims;

	// ---- Phase A: forge each standardBase (+ hub block when the standard is a hub) ----
	// The forge runs BEFORE the graph is provisioned (targetArchitectureDesign §4.4). A forge
	// bundle never sees, needs or wants a graph, so provisioning one first would spend a container
	// on material that may not exist — and a standard with no forge bundle now fails before any
	// docker command is attempted.
	const forgeOneStandard = (std, done) => {
		// The base block's subject and version are the RESOLVED EXPLICIT version, never the recipe's
		// floating 'current' — so they are composed AFTER the forge, from its snapshot-provenance triple
		// (in the forge task below). explicitVersion is the pretty resolved version (blocks.version and
		// the harvest header); baseSubject SLUGS it for a clean key and appends the '_base' marker DERIVED
		// from the kind, so the name and the kind cannot drift (the store's suffix<->kind gate refuses
		// them if they do). Both are filled before the harvest/add tasks that read them run.
		let explicitVersion = '';
		let baseSubject = '';
		const taskList = new taskListPlus();

		// DISPOSE-ON-FAILURE (Item 4). The scratch graph is created mid-pipeline; every step after it
		// (init, harvest, add) can fail, and pipeRunner aborts the list before its trailing delete
		// task runs — stranding a live DEV_* container. createdGraph/deleteAttempted let the final
		// handler best-effort dispose exactly what was created, exactly once: the success path's own
		// delete task runs (deleteAttempted), so the handler does not double-delete; a mid-pipeline
		// failure did NOT reach that task, so the handler disposes.
		let createdGraph = null;
		let deleteAttempted = false;

		taskList.push((args, next) => {
			// vectorize is STATED, not omitted. The forger has no default for it (Phase 4, work
			// group 4) precisely because this call used to leave it out and get real embeddings and
			// a real bill by silence. -build's contract, in graphBuilder's own -help, is that it
			// "spends embedding credit BY DEFAULT"; that promise is made HERE, in one greppable
			// place, rather than by an absent field agreeing with an in-code true.
			//
			// FIXED (Item 11): the graphBuilder operator CAN now turn this off. `vectorize` is
			// resolved once at the top of build() from --vectorize (documented default true) or an
			// explicit deps.vectorize, and threaded here — so a rehearsal build (`--vectorize=false`)
			// spends nothing, and a typed `--vectorize=no` is refused rather than silently ignored.
			// deriveHub is the HUB-FOLD SIGNAL (§7, new design): when this standard is named in
			// recipe.hubs, the forger derives its hub and folds it into the nodeEdges it returns, so
			// the ordinary [StandardBase] init+harvest below mints ONE block carrying base + hub. A
			// non-hub standard passes false and gets base-only nodeEdges.
			forger.forge(
				{
					standard: std.token,
					version: std.version,
					vectorize: vectorizeSpend,
					embeddingCacheFilePath,
					deriveHub: hubStdSet.has(String(std.token).toLowerCase()),
				},
				(err, forgeReport) => {
					if (!err) {
						// The EXPLICIT resolved version replaces the recipe's floating 'current' in every
						// persisted place: composed HERE from the forge's snapshot-provenance triple, then
						// read by the harvest header (pretty), the block subject (slugged), and blocks.version.
						explicitVersion = explicitVersionFrom(forgeReport);
						baseSubject = `${std.token}@${slugifyVersion(explicitVersion)}${vocabulary.suffixMarkerForKind(
							vocabulary.SCHEMA_BLOCK_KIND.STANDARD_BASE,
						)}`;
						// carried per token for Phase C's version-keyed relationship subjects — NOT the
						// recipe token, NOT bundleVersion.
						resolvedVersionByToken[std.token] = explicitVersion;
							// same embedder for every standard in the run — captured for Phase C's
							// relationship harvest header (undefined on --vectorize=false).
							buildEmbeddingModelVersion = forgeReport.embeddingModelVersion;
							buildEmbeddingDims = forgeReport.nodeEdges.embeddingDims;
					}
					next(err ? `forge ${std.token}: ${err}` : '', { ...args, forgeReport });
				},
			);
		});

		taskList.push((args, next) => {
			replay.create({ purpose: 'forge' }, (err, workingGraph) => {
				if (!err) {
					createdGraph = workingGraph;
				}
				next(err ? `create(forge) for ${std.token}: ${err}` : '', { ...args, workingGraph });
			});
		});

		// the forger produced; replayManager loads. The label the harvest will select on is the
		// label init stamps — handed down, not hoped for. When this standard is a hub, forgeReport
		// .nodeEdges ALREADY carries the folded hub (the forger concatenated it); applyLabels ADDS
		// StandardBase to every loaded node WITHOUT removing its own labels (replayManager
		// withAppliedLabels is a union), so the hub nodes gain StandardBase alongside their intrinsic
		// HubReference/HubDefinition and harvest with the base as one block.
		taskList.push((args, next) => {
			replay.init(
				{
					inGraph: args.workingGraph,
					nodeEdges: args.forgeReport.nodeEdges,
					applyLabels: [BASE_GRAPH_LABEL],
					sourceLabel: `nodeEdges from forge bundle '${std.token}'`,
				},
				(err) => next(err ? `init ${std.token}: ${err}` : '', args),
			);
		});

		taskList.push((args, next) => {
			replay.harvest(
				{
					inGraph: args.workingGraph,
					selectionLabels: [BASE_GRAPH_LABEL],
					header: {
						blockType: 'standardBase',
						standardKey: std.token,
						version: explicitVersion,
						// EMBEDDING/ADDRESSING HEADER (restored 2026-07-26). A standardBase block that
						// CARRIES vectors must declare, in its header, the property naming its stable URI
						// and the width + model the vectors were made at: the block serializer copies these
						// from the header (replay-block.serializeHeaderLine) and the restore gate REFUSES an
						// embedded block whose header omits embeddingDims. From the 2026-07-23 stub->real
						// rewrite (1b091d1) this header was a bare {blockType,standardKey,version}, so EVERY
						// embedded build failed on restore while un-embedded builds (which need none of
						// this) passed — a whole path no credit-free suite could see. Values are CARRIED
						// from the forge report, never invented; on --vectorize=false the forger reports
						// them undefined/null and the optional fields drop, as an un-embedded block wants.
						stableUriPropertyName: args.forgeReport.stableUriPropertyName,
						resolutionKey: args.forgeReport.stableUriPropertyName,
						embeddingModelVersion: args.forgeReport.embeddingModelVersion,
						embeddingEncoding: 'base64',
						embeddingDtype: 'float32',
						embeddingByteOrder: 'little-endian',
						embeddingDims: args.forgeReport.nodeEdges.embeddingDims,
					},
				},
				(err, schemaBlock) => {
					if (!err) {
						// the harvested base block — kept per token so a bridge can RESTORE its dependency
						// bases into the dependency graph (Phase C), the source the producer WALKs.
						baseBlockByToken[std.token] = schemaBlock;
					}
					next(err ? `harvest standardBase ${std.token}: ${err}` : '', { ...args, schemaBlock });
				},
			);
		});

		// add takes the harvested SCHEMA BLOCK, not an id: manifestEditor owns storing, and it
		// re-derives the content address from the text before writing, so a block cannot enter the
		// store under an address that does not describe it.
		taskList.push((args, next) => {
			manifest.add(
				{
					subject: baseSubject,
					kind: 'standardBase',
					version: explicitVersion,
					description: `standardBase schema block for ${baseSubject}, forged by recipe '${recipe.recipeName}'`,
					schemaBlock: args.schemaBlock,
				},
				(err, addReport) => {
					if (err) {
						next(`add standardBase ${baseSubject}: ${err}`);
						return;
					}
					xLog.status(
						`  [A] forge ${baseSubject} -> standardBase ${addReport.schemaBlockRefId}`,
					);
					next('', args);
				},
			);
		});

		// NO SEPARATE HUB BLOCK (hub-fold design 2026-07-24). A hub standard's hub is already folded
		// into the base nodeEdges by the forger and harvested with the base above — one block per
		// standard. The first Phase-3 attempt's second block (deserialize base -> forgeHub -> init ->
		// harvest(:HubReference:HubDefinition) -> add({..._hub})) is deleted: the replay engine's
		// conjunctive labelMatch could not union two hub node types and fetchEdgesWithinLabels dropped
		// the hub's cross-boundary HAS_CEDS_* edges. Folding into the base dissolves both — the edges
		// live within one [StandardBase] block, both endpoints present. The '_hub' subject marker
		// and kind:'hub' stay RESERVED in vocabulary, harmless and unused.

		taskList.push((args, next) => {
			deleteAttempted = true;
			replay.delete(args.workingGraph, (err) => next(err || '', args));
		});

		pipeRunner(taskList.getList(), {}, (err) => {
			if (err && createdGraph && !deleteAttempted) {
				// a mid-pipeline failure stranded the forge graph — best-effort dispose it, then report
				// the ORIGINAL error (with a note if disposal also failed). The build's failure is the
				// forge failure; a disposal that also fails must not mask it.
				replay.delete(createdGraph, (deleteErr) => {
					done(
						deleteErr
							? `${err} (its scratch graph '${createdGraph.graphName}' also failed to dispose and is leaking: ${deleteErr})`
							: err,
					);
				});
				return;
			}
			done(err || '');
		});
	};

	const phaseA = (done) => eachSeries(standards, forgeOneStandard, done);

	// ---- Phase C: bridges (materialize dep graph, run bridge, harvest labeled relationships) ----
	const bridgeOnePairing = (bridge, done) => {
		// pairLabel identifies the pairing for the operator (source::hub / source::pairWith / source::family);
		// the version-keyed, producer-suffixed subject is COMPOSED PER EMITTED BLOCK after the bridge runs
		// (multi-block change 2026-07-26 — one invocation may emit several pair-scoped blocks). §7.
		const pairLabel = pairKey(bridge);
		// THE RECIPE NAMES THE BRIDGE. RECIPE_SCHEMA requires it on every bridge, so a recipe that
		// reaches here has one; there is no in-code name standing behind the key any more
		// (polyArch2 §6). The guard is here rather than only in the schema because build() is
		// reachable with a recipe object that never went through validateRecipe (the test seam
		// does exactly that), and a bridge whose name is absent must say so rather than run
		// something nobody asked for. `bridgeName` is the entry's `.bridge` field — the resolvable
		// bridge NAME (was `mapper`; it names a mapping OR a structural producer, so 'mapper' was a
		// misnomer, renamed per design_bridgeResolution_072526 §5).
		const bridgeName = bridge.bridge;
		if (typeof bridgeName !== 'string' || bridgeName.trim() === '') {
			done(
				`bridge ${pairLabel}: bridge is ${
					bridgeName === undefined ? 'not named' : JSON.stringify(bridgeName)
				}. Every bridge entry names its bridge in the recipe — it IS what the bridge does, and ` +
					`there is no default. Nothing was substituted for it.`,
			);
			return;
		}
		const taskList = new taskListPlus();

		// DISPOSE-ON-FAILURE (Item 4), same idiom as phase A: a bridge failure after create must not
		// strand the dependency graph.
		let createdGraph = null;
		let deleteAttempted = false;

		// create means "an empty graph", always. The dependency schema blocks go IN through init's
		// RESTORATION payload in the next task — the producer WALKs the restored nodes.
		taskList.push((args, next) => {
			replay.create({ purpose: 'dependencyGraph' }, (err, depGraph) => {
				if (!err) {
					createdGraph = depGraph;
				}
				next(err ? `create(dep) ${pairLabel}: ${err}` : '', { ...args, depGraph });
			});
		});

		// RESTORE the bridge's dependency bases (source + hub) into the dependency graph, so the producer
		// has real nodes to read: the source standard's elements, the CEDS HubReferences and the CEDS
		// standard rows all live in these two base blocks (the hub is FOLDED into the CEDS base). A missing
		// dependency base is a recipe/order fault, named — never a silent empty graph (polyArch2 §6).
		taskList.push((args, next) => {
			// RESTORE the pairing's two endpoints (source + hub-or-pairWith) AND the bridge's declared
			// `dependencies` (design_bridgeResolution_072526 §5: "dependencies is what gets loaded to read").
			// For a mapping bridge dependencies is [source, hub] — no change. For a STRUCTURAL bridge it is the
			// whole family, so the THIRD sibling's base is restored too and the producer can resolve crossRefs
			// against the WHOLE family (telling a cross-sibling ref apart from a dangler). Deduped; a missing
			// base is a recipe/order fault, named — never a silent empty graph (polyArch2 §6).
			const dependencyTokens = Array.from(
				new Set(
					[bridge.source, bridge.hub, bridge.pairWith]
						.concat(bridge.dependencies || [])
						.filter((oneToken) => oneToken !== undefined && oneToken !== null && `${oneToken}`.trim() !== ''),
				),
			);
			const missing = dependencyTokens.filter((oneToken) => !baseBlockByToken[oneToken]);
			if (missing.length) {
				next(
					`restore deps ${pairLabel}: dependency base block(s) not forged in this build: ${missing.join(', ')}. ` +
						`A bridge's source and hub must both be forged before it runs; nothing was substituted.`,
				);
				return;
			}
			const schemaBlocks = dependencyTokens.map((oneToken) => baseBlockByToken[oneToken].blockText);
			replay.init({ inGraph: args.depGraph, schemaBlocks }, (err) =>
				next(err ? `restore deps ${pairLabel}: ${err}` : '', args),
			);
		});

		taskList.push((args, next) => {
			// THREAD the recipe's hub token so the producer knows which hub it authors toward. CAPTURE the
			// run report: a deterministic authored producer returns decisionBlock null (-> _exact); an
			// inferred producer returns a frozen decision block (-> _close). The producer suffix is DERIVED
			// from that, then the version-keyed relationship name is composed with the REAL resolved versions.
			// this pairing's inferred inputs (§5.5): rebridge is TRUE only when this pair's source is in the
			// resolved --rebridge scope — the scope match happens HERE, where the recipe pair is known, not
			// guessed in the plugin. config carries the producer's own operational data (the source standard
			// + the REAL resolved versions the forge read; the a4a0da2 rule). An authored producer ignores
			// rebridge/decisionStore/inferenceConfig entirely.
			const thisPairRebridges = pairInRebridgeScope(rebridgeScope, bridge);
			// sourceStandardName — the EXACT declared standardName from the source bundle's
			// parserDescriptor.ini (the one canonical token->name authority; forged `_source` carries
			// this value VERBATIM). Added 2026-07-30 after the EdFi authored-anchor run silently wrote
			// an EMPTY relationship block: the bridge's old CASE-RULE uppercase of the recipe token
			// ('edfi'->'EDFI') matched no `_source: 'EdFi'` node. One canonical source, exact match —
			// never normalize at the comparison site.
			const sourceBundle = components.forger.resolveBundle({ standard: bridge.source });
			if (sourceBundle.error) {
				next(`bridge ${pairLabel}: resolving source bundle for standardName: ${sourceBundle.error}`);
				return;
			}
			bridgeMaker.run(
				{
					inGraph: args.depGraph,
					bridge: bridgeName,
					// source selects the standard-local bridge search directory
					// (forges/<source>/bridges/) so a standard's bespoke bridge is found; a
					// forges-shared or library bridge resolves without it.
					source: bridge.source,
					hub: bridge.hub,
					applyLabel: RELATION_LABEL,
					rebridge: thisPairRebridges,
					decisionStore,
					judgmentCache,
					matchForensics,
					inferenceConfig,
					config: {
						// bridges[].params — DE-VESTIGIALIZED (2026-07-31, the SIF StudentPersonal trial):
						// a recipe's bridge entry may now carry bridge-specific options (e.g. the SIF
						// bridge's sifObjectScope) and they reach the producer as config keys. Spread FIRST
						// so the orchestrator-owned keys below always win over a recipe collision.
						...(bridge.params || {}),
						sourceStandard: bridge.source,
						sourceStandardName: sourceBundle.standardName,
						sourceVersion: resolvedVersionByToken[bridge.source],
						hubVersion: resolvedVersionByToken[bridge.hub],
						// pairWith + its resolved version reach a STRUCTURAL producer (ctdlFamilyStructure) so it
						// knows its sibling pairing endpoint; undefined for a mapping bridge, which ignores them.
						pairWith: bridge.pairWith,
						pairWithVersion: resolvedVersionByToken[bridge.pairWith],
						// familyStandards is the READ scope a structural producer resolves crossRefs against — the
						// whole family, so a cross-sibling ref is told apart from a dangler (the third sibling is
						// among the restored dependency bases). undefined for a mapping bridge, which ignores it.
						familyStandards: bridge.familyStandards || bridge.dependencies,
					},
				},
				(err, runReport) => {
					if (err) {
						next(`bridge ${pairLabel}: ${err}`);
						return;
					}
					// MULTI-BLOCK HARVEST (contract change 2026-07-26). A bridge invocation may emit MORE THAN ONE
					// pair-scoped block. NORMALIZE runReport into a `blocks` array so ONE code path serves both:
					//   * a coordinating producer (ctdlFamilyStructure) returns blocks[] — each with its OWN
					//     applyLabel (the distinct per-pair label it WROTE under) and its pair's firstStandard/
					//     secondStandard TOKENS, so build.js version-keys EACH block on its own two endpoints;
					//   * a single-block mapping bridge (ctdlAuthoredBridge, semanticBridge) returns NO blocks[];
					//     the degenerate list-of-one is synthesized from the top-level status, its endpoints
					//     falling back to the RECIPE (hub/source or source/pairWith) exactly as before.
					const emittedBlocks = Array.isArray(runReport.blocks) && runReport.blocks.length
						? runReport.blocks
						: [{ applyLabel: RELATION_LABEL, firstStandard: undefined, secondStandard: undefined, producer: runReport.producer, decisionBlock: runReport.decisionBlock }];
					next('', { ...args, emittedBlocks });
				},
			);
		});

		// HARVEST-AND-ADD EACH emitted block into its OWN version-keyed, pair-scoped manifest member. The
		// three CTDL-family pairings (or the one mapping block) are harvested in the order the producer
		// emitted them (S11: root-first then lexicographic for the family). eachSeries sequences the
		// unknown-length block list; a failure on any block names its label and aborts the pairing.
		taskList.push((args, next) => {
			eachSeries(
				args.emittedBlocks,
				(oneBlock, blockDone) => {
					// THE PRODUCER DECLARES ITS OWN KIND (polyArch2 §6). A named producer is BELIEVED iff the
					// vocabulary registers a suffix for it (authored/inferred/structural — one data row, no edit
					// here). Only a silent producer is inferred from decisionBlock (null -> authored/_exact;
					// non-null -> inferred/_close), preserving the two-producers-per-pair distinction.
					const producer =
						oneBlock && vocabulary.suffixForRelationshipProducer(oneBlock.producer)
							? oneBlock.producer
							: oneBlock && oneBlock.decisionBlock != null
								? 'inferred'
								: 'authored';
					// VERSION-KEY ON BOTH ENDPOINTS, ROOT-FIRST. A multi-block producer supplies the pair's two
					// TOKENS (root-first then lexicographic); a single mapping block falls back to the recipe
					// (hub_rel_source for a mapping bridge, source_rel_pairWith for a structural pair). Both
					// endpoints carry their REAL resolved version (the a4a0da2 rule), looked up per token.
					const nameFirst =
						oneBlock.firstStandard !== undefined
							? oneBlock.firstStandard
							: bridge.hub !== undefined
								? bridge.hub
								: bridge.source;
					const nameSecond =
						oneBlock.secondStandard !== undefined
							? oneBlock.secondStandard
							: bridge.hub !== undefined
								? bridge.source
								: bridge.pairWith;
					const composed = vocabulary.relationshipSubject({
						hubStandard: nameFirst,
						hubVersion: resolvedVersionByToken[nameFirst],
						sourceStandard: nameSecond,
						sourceVersion: resolvedVersionByToken[nameSecond],
						producer,
					});
					if (composed.error) {
						blockDone(`bridge ${pairLabel}: ${composed.error}`);
						return;
					}
					const oneSubject = composed.subject;
					const blockLabel = oneBlock.applyLabel || RELATION_LABEL;
					replay.harvest(
						{
							inGraph: args.depGraph,
							selectionLabels: [blockLabel],
							header: {
								blockType: 'relationship',
								standardKey: oneSubject,
								// SECOND SITE of the missing-embedding-header defect (2026-07-26). A bridged
								// node is an embedded base node, so a relationship block that carries it must
								// declare the SAME embedding width/model as the bases, or the materialize
								// restore gate refuses it (this is why --vectorize=false sailed through and
								// --vectorize=true failed at manifest[3]). stableUriPropertyName is
								// deliberately OMITTED: these nodes were already replayed, so shapeNode
								// round-trips them off the stored stableId ("re-extract byte-identical").
								// undefined on --vectorize=false, when the optional fields drop.
								embeddingModelVersion: buildEmbeddingModelVersion,
								embeddingEncoding: 'base64',
								embeddingDtype: 'float32',
								embeddingByteOrder: 'little-endian',
								embeddingDims: buildEmbeddingDims,
							},
						},
						(harvestErr, schemaBlock) => {
							if (harvestErr) {
								blockDone(`harvest relationships ${pairLabel}: ${harvestErr}`);
								return;
							}
							manifest.add(
								{
									subject: oneSubject,
									kind: 'relationship',
									description: `relationship schema block for ${oneSubject}, bridged by bridge '${bridgeName}' from recipe '${recipe.recipeName}'`,
									schemaBlock,
								},
								(addErr, addReport) => {
									if (addErr) {
										blockDone(`add relationship ${pairLabel}: ${addErr}`);
										return;
									}
									xLog.status(
										`  [C] bridge ${pairLabel} (bridge=${bridgeName}) -> relationship ${oneSubject} ${addReport.schemaBlockRefId}`,
									);
									blockDone('');
								},
							);
						},
					);
				},
				(eachErr) => next(eachErr || '', args),
			);
		});

		taskList.push((args, next) => {
			deleteAttempted = true;
			replay.delete(args.depGraph, (err) => next(err || '', args));
		});

		pipeRunner(taskList.getList(), {}, (err) => {
			if (err && createdGraph && !deleteAttempted) {
				replay.delete(createdGraph, (deleteErr) => {
					done(
						deleteErr
							? `${err} (its dependency graph '${createdGraph.graphName}' also failed to dispose and is leaking: ${deleteErr})`
							: err,
					);
				});
				return;
			}
			done(err || '');
		});
	};

	const phaseC = (done) => eachSeries(bridges, bridgeOnePairing, done);

	// ---- Finish: compose the manifest, then materialize the eval golden ----
	const composeAndMaterialize = () => {
		const memberCount = manifest.members().length;

		// refId() REFUSES an empty membership by throwing, and it is right to: the address of an
		// empty membership is a constant every empty manifest would share. The orchestrator answers
		// for its own recipe rather than letting that throw escape a callback-shaped API.
		if (memberCount === 0) {
			callback(
				`compose failed: recipe '${recipe.recipeName}' produced no schema blocks, so there is ` +
					`no manifest to address. A build that materializes nothing and reports success is ` +
					`the failure this refuses to be.`,
			);
			return;
		}

		const manifestId = manifest.refId();
		xLog.status(`  [compose] manifest ${manifestId} -- ${memberCount} members`);

		// materialize the eval golden FROM the composed manifest. Held as a named continuation so the
		// SAVE below can gate it: the manifest is persisted at compose time, then this runs.
		const materializeFromManifest = () =>
		manifest.schemaBlocks((blocksError, resolvedSchemaBlocks) => {
			if (blocksError) {
				callback(`compose failed: ${blocksError}`);
				return;
			}
			// the shared materialize/restore tail (also used by -replay). create is MONOMORPHIC, the
			// RESTORATION init carries no applyLabels, and a mid-fill failure disposes the eval graph
			// rather than stranding it — all of that lives in materializeSchemaBlocks now.
			materializeSchemaBlocks(
				{
					xLog,
					replay,
					resolvedSchemaBlocks,
					manifestId,
					memberCount,
					// R-1 needs to know whether CEDS is in this graph at all.
					standardTokens: (recipe.standards || []).map((one) => one.token),
					commandLineParameters: process.global && process.global.commandLineParameters,
				},
				callback,
			);
		});

		// PERSIST THE MANIFEST AT COMPOSE TIME — the change that makes a -build ALWAYS write a manifest
		// that regenerates the graph it just built. The manifest IS the compose artifact (the named,
		// ordered membership); until 2026-07-25 a -build composed it and materialized from it but never
		// called save(), so the manifests/manifestBlocks tables stayed EMPTY and the graph could not be
		// regenerated from storage. save() assembles the membership from the manifest's own state and
		// writes it through standardsDatabase.saveManifest, which addresses BY that membership — so a
		// re-run over the same blocks dedups onto the manifest already there rather than erroring or
		// duplicating. A save failure is NAMED through the callback, never stranded past this
		// callback-shaped API, the same idiom as the dispose-on-failure handling above. Saved BEFORE
		// materialize because the manifest is the compose artifact, not a by-product of materializing.
		manifest.save((saveError) => {
			if (saveError) {
				callback(`compose failed: persisting the manifest ${manifestId}: ${saveError}`);
				return;
			}
			// No separate phase marker: persistence is a sub-step of COMPOSE, not a distinct phase, and
			// the compose line above already named this manifest. A second '[compose]' token would make
			// the pipeline look like it composed twice.
			materializeFromManifest();
		});
	};

	phaseA((phaseAError) => {
		if (phaseAError) {
			callback(`phase A (forge) failed: ${phaseAError}`);
			return;
		}
		phaseC((phaseCError) => {
			if (phaseCError) {
				callback(`phase C (bridge) failed: ${phaseCError}`);
				return;
			}
			composeAndMaterialize();
		});
	});
};

// replay — regenerate a graph FROM A STORED MANIFEST, with NO forging and NO bridge runs. This is
// what makes a persisted manifest a usable reproducibility artifact: given a standards database
// (blocks + manifest) and a manifest refId, OPEN the manifest, RESOLVE its member schema blocks, and
// RESTORE them into a fresh DEV_ eval graph — the SAME materialize/restore tail a -build runs after
// it composes (materializeSchemaBlocks), and nothing else. NO forger, NO bridgeMaker, NO decision
// store, NO Voyage/LLM: replay reads what a build already wrote and rebuilds exactly that graph.
//
//   replay({ manifestRefId }, { xLog, standardsDatabase, components? }, callback)
//       -> callback('', { manifestId, boltUrl, memberCount })
//
// Every refusal fires BY NAME (polyArch2 §6), never a silent empty graph:
//   * a missing standardsDatabase and a missing/blank manifestRefId are refused HERE, before a
//     component is constructed;
//   * a refId absent from the manifests table is refused by manifestEditor.open (it will not hand
//     back an empty manifest indistinguishable from an emptied one);
//   * a member block absent from the blocks table is refused by manifest.schemaBlocks (it refuses a
//     partial membership rather than materializing a graph that looks whole and is not).
// The manifestId returned is the refId the caller asked for and the store was found under — the
// honest answer to "which manifest did this reproduce", echoed so the caller can confirm the match.
const replay = ({ manifestRefId } = {}, deps = {}, callback) => {
	const { xLog, standardsDatabase } = deps;
	const components = { ...defaultComponents, ...(deps.components || {}) };

	// the store gate is also the safety interlock, exactly as it is for build(): a replay with nowhere
	// to READ has nothing to reproduce, and getManifest is the door every step below goes through.
	if (!standardsDatabase || typeof standardsDatabase.getManifest !== 'function') {
		callback(
			`graphBuilder replay: a standardsDatabase is REQUIRED in deps and has no default. A replay ` +
				`OPENS a stored manifest and resolves its member blocks from the store; a replay with ` +
				`nowhere to read has nothing to reproduce.`,
		);
		return;
	}
	if (isBlank(manifestRefId)) {
		callback(
			`graphBuilder replay: a manifestRefId is REQUIRED and has no default — it names the stored ` +
				`manifest to reproduce, and there is nothing to open without it.`,
		);
		return;
	}

	const replayEngine = components.replayManager();
	const manifestEditor = components.manifestEditor({ standardsDatabase });

	// open() loads the stored membership by refId and REFUSES an absent one by name; it also disables
	// add, which a replay never wants — an opened manifest is immutable by design.
	manifestEditor.open({ manifestRefId }, (openError, manifest) => {
		if (openError) {
			callback(`graphBuilder replay: ${openError}`);
			return;
		}

		const memberCount = manifest.members().length;
		// the refId the caller asked for IS the manifest's identity; echo it rather than recompute one
		// that could only ever be equal or a lie.
		const manifestId = manifestRefId;
		xLog.status(`  [replay] manifest ${manifestId} -- ${memberCount} member(s)`);

		manifest.schemaBlocks((blocksError, resolvedSchemaBlocks) => {
			if (blocksError) {
				callback(`replay failed: ${blocksError}`);
				return;
			}
			materializeSchemaBlocks(
				{ xLog, replay: replayEngine, resolvedSchemaBlocks, manifestId, memberCount },
				callback,
			);
		});
	});
};

return { build, replay, defaultComponents };
};

// END OF moduleFunction() ============================================================

// defaultComponents is RETURNED in the API (not a static) so test-interfaces can assert the
// orchestrator's DEFAULTS are the real modules themselves — the gate that replaces "the stub set
// conforms too", which passed for a year while the arguments drifted underneath it.
module.exports = moduleFunction({ moduleName });
// pure helpers exported as statics so the rebridge-scope resolution + per-pair scope match can be gated
// directly (§6 no-silent-default), without standing up the whole build pipeline.
module.exports.resolveRebridge = resolveRebridge;
module.exports.pairInRebridgeScope = pairInRebridgeScope;
module.exports.rebridgeScopeIsActive = rebridgeScopeIsActive;
// the real-vs-stub reranker SELECTION seam (P3b), exported so the factory choice is gated directly: a stub is
// used when injected, a real client is minted (via the injected/default factory) for an active --rebridge.
module.exports.resolveInferenceConfig = resolveInferenceConfig;
