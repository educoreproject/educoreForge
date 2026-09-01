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
// FIDELITY-GATE SEAM (⟪R-P2-1⟫): `deps.cedsFidelityGateRunner` may override the R-1 in-build
// fidelity gate with a function of the same signature; the documented default is the REAL
// runCedsFidelityGate (byte-unchanged production behavior). The hermetic suites inject a
// SELF-ANNOUNCING stub — the real gate reaches a LIVE graph over bolt (docker inspect), which
// no hermetic double provides. A silent skip is not offered.
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
const bridgeCollisionRuleLib = require(path.join(__dirname, 'bridgeCollisionRule'));

// the canonical home of per-run build reports (the same documented-default convention as the
// judgment cache and match-forensics homes in actions.js): hub prose-divergence and skip
// reports land under ONE run directory per build invocation, so "no report file" always means
// "the fold did not run", never "the report went somewhere else".
const BUILD_LOGS_DIR_PATH =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs';

// resolveBuildLogsDirPath — WHERE THIS BUILD'S RUN DIRECTORY GOES (root-and-branch Phase 4, K3b:
// the suite was writing run dirs into the canonical home on every run — the embedded end-to-end
// gate and any build that reaches the CEDS report fold or the round-trip stage — re-littering
// dataStores/buildLogs/ and, once, riding into a commit). Same precedence idiom as
// resolveEmbeddingCacheFilePath: deps.buildLogsDirPath (test/orchestrator injection) wins; absent,
// the command line --buildLogsDirPath is read; absent entirely, the DOCUMENTED default is the
// canonical home above (help.js says so). A supplied-but-empty value is refused BY NAME, never
// silently corrected to the default — an operator who typed it believes it took effect. Returns
// { value } or { error }; no throw, so build() routes a refusal through its callback.
const resolveBuildLogsDirPath = (deps) => {
	const commandLineParameters =
		(process.global && process.global.commandLineParameters) || { values: {} };
	const commandLineValue = (commandLineParameters.values.buildLogsDirPath || [])[0];
	const supplied = deps.buildLogsDirPath !== undefined ? deps.buildLogsDirPath : commandLineValue;
	if (supplied === undefined) {
		return { value: BUILD_LOGS_DIR_PATH };
	}
	if (typeof supplied !== 'string' || supplied.trim() === '') {
		return {
			error:
				`build: buildLogsDirPath is ${JSON.stringify(supplied)}. When supplied (deps.buildLogsDirPath ` +
				`or --buildLogsDirPath) it must be a non-empty directory path; omit it to use the documented ` +
				`default ${BUILD_LOGS_DIR_PATH}. It is not corrected silently.`,
		};
	}
	return { value: supplied };
};

// ⟪R-P2-2, 2026-08-03⟫ the embedding SIDECAR stores' canonical home (same documented-default
// convention): one content-addressed SQLite per standard, named by the block header's
// standardKey verbatim. A VECTORIZED standardBase block persists its raw vectors here and
// carries per-node embeddingRefs in its text — a block is never half a gigabyte of inline
// base64 (the V8 max-string ceiling the 94,602-card hub block exceeded), and block identity
// becomes embedding-excluded BY DESIGN.
// ⟪Round-Trip Perfection Phase 1, 2026-08-04⟫ VECTOR_STORES_DIR_PATH stood here and is GONE. Frozen
// vectors now live in the ONE configured support store, so a per-standard directory constant would be a
// second, code-invented home that nothing consults but that the next reader would reasonably believe
// in. The 19 existing files in that directory are untouched and stay where they are — see the M-3
// supersession note on makeVectorStoreResolver for why they are copied from and never moved.
const vectorStoreModule = require(
	path.join(__dirname, '..', '..', '..', 'lib', 'vector-store', 'vector-store'),
);
// ⟪P2-review M-3, RULED⟫ store filenames derive from the SAME AUTHORITY as the node _source
// stamp — the forge bundle's standardName (resolveBundle; 'ceds' -> 'CEDS' -> CEDS.sqlite3).
// ONE store per standard, SHARED with the incumbent producer BY DESIGN (content-addressed,
// verify-on-read, first-write-wins). Never a casing literal and never the lowercase token:
// on a case-insensitive filesystem the token spelling silently opened the incumbent's file
// while claiming a separate one (the M-3 finding), and on the case-SENSITIVE deploy targets
// it would name a file that does not exist.
const { resolveBundle: resolveForgeBundle } = require(path.join(__dirname, '..', 'apps', 'forger'));

// ⟪RT-13, forge-edfi Phase 4⟫ the round-trip stage: roster composition from parserDescriptor
// declarations + the post-materialization validator run (doctrine §7; R-WO-16..21). The runner
// is a SEAM with the real one as its documented default (the R-P2-1 fidelity-gate idiom):
// hermetic suites inject a SELF-ANNOUNCING stub so no test build writes into the canonical
// buildLogs home — never a silent skip.
const roundTripStageLib = require('./round-trip-stage')();

// ⟪P2-review S-2⟫ resolveHeapAdequacy — refuse a vectorized load the process heap cannot
// hold BEFORE a container is provisioned, naming the remedy. The engine-side JSON.stringify
// in the LOAD path makes a vectorized build's heap appetite a large multiple of the raw
// vector bytes; until the streaming batch write lands, the honest posture is a guard, not a
// devlog sentence (an OOM kill also bypasses dispose-on-failure and strands the scratch
// container — observed 2026-08-03). The multiplier is EMPIRICAL, calibrated on the
// 119,805-node / 1024-dim hubV2 build: raw vector bytes ≈ 0.98GB, observed to OOM at an
// 8GB heap and complete at 24GB — so the estimate uses 16× raw vector bytes + 1GB base,
// which brackets the measurement. heapSizeLimitBytes is injectable so the refusal is
// provable without shrinking a real process's heap.
const HEAP_BYTES_PER_VECTOR_VALUE = 8; // a JS number in a packed double array
const HEAP_LOAD_MULTIPLIER = 16; // empirical: forge copy + shape copy + load stringify + GC headroom
const HEAP_BASE_NEED_BYTES = 1024 * 1024 * 1024; // non-vector material + engine overhead
const resolveHeapAdequacy = ({
	nodeCount,
	embeddingDims,
	heapSizeLimitBytes = require('v8').getHeapStatistics().heap_size_limit,
}) => {
	if (embeddingDims === null || embeddingDims === undefined) {
		return {}; // un-vectorized payload: no vector term; the legacy sizes never OOM'd
	}
	const estimatedNeedBytes =
		nodeCount * embeddingDims * HEAP_BYTES_PER_VECTOR_VALUE * HEAP_LOAD_MULTIPLIER +
		HEAP_BASE_NEED_BYTES;
	if (heapSizeLimitBytes < estimatedNeedBytes) {
		const suggestedMb = Math.ceil((estimatedNeedBytes / (1024 * 1024)) * 1.25);
		return {
			error:
				`build: REFUSED before provisioning — this vectorized load (${nodeCount} nodes × ` +
				`${embeddingDims} dims) is estimated to need ~${Math.ceil(estimatedNeedBytes / (1024 * 1024 * 1024))}GB ` +
				`of heap and this process is limited to ` +
				`${Math.floor(heapSizeLimitBytes / (1024 * 1024 * 1024))}GB. Re-run with ` +
				`node --max-old-space-size=${suggestedMb} (an OOM mid-build would also strand the ` +
				`scratch container — the kill bypasses dispose-on-failure).`,
		};
	}
	return {};
};

// makeVectorStoreResolver — storeResolver(standardKey, cb) -> vectorStore, lazy-open and
// cached per standardKey for the life of ONE build/replay invocation. Used on BOTH sides of
// the block boundary: the Phase-A harvest injects the store for the standard being harvested
// (write side), and materialize/replay/depGraph-restore hand the resolver to the engine so
// each ref-carrying node's vector is stamped back onto its graph node (read side). A store
// file is only ever CREATED when something actually resolves — a build with no vectors
// touches nothing.
// ⟪Round-Trip Perfection Phase 1, 2026-08-04⟫ COLLAPSED TO ONE STORE, per TQ's single-file ruling and
// the supervisor's Q3 authorization. Frozen vectors now live in the ONE configured support store, so
// the resolver opens that file for EVERY standardKey and returns the same handle. supportStoreFilePath
// is REQUIRED — the resolver has no path of its own to fall back to.
//
// M-3 IS SUPERSEDED, NOT FORGOTTEN. The comment above still records the ruling this replaces: one
// store per standard, filename derived from the forge bundle's standardName, deliberately SHARED with
// the incumbent producer. Two parts of it outlive the per-standard filename and are kept alive here on
// purpose:
//
//   * THE DERIVATION LESSON, which is not about vector stores at all. A name must come from an
//     AUTHORITY, never from a casing literal or a lowercase token: on a case-insensitive filesystem
//     the wrong spelling silently opened the incumbent's file while claiming a separate one, and on a
//     case-SENSITIVE deploy target it would name a file that does not exist. The standardKey is still
//     validated through resolveForgeBundle below for exactly that reason — an unresolvable token is a
//     refusal naming it, even though its NAME no longer picks the file. Dropping the check because the
//     filename no longer depends on it would discard the guard and keep only the habit.
//
//   * THE SHARING WITH THE INCUMBENT IS NOW ENDED, and that is a real consequence rather than a
//     bookkeeping note. The incumbent path is still reachable (cli/lib.d/forger, cli/lib.d/edf-replay,
//     cli/lib.d/edf-migrate-embeddings all still reference vector-store), so the 19 files under
//     system/dataStores/vectorStores/ are LEFT EXACTLY WHERE THEY ARE — their contents were COPIED
//     into the support store, never moved. If the incumbent is run again it must keep finding its own
//     warm cache rather than silently re-embedding at Voyage's expense. Their disposition is TQ's call
//     at Phase 8, not this phase's.
const makeVectorStoreResolver = ({ supportStoreFilePath } = {}) => {
	let openedSupportStore = null;
	return (standardKey, callback) => {
		if (standardKey === undefined || standardKey === null || `${standardKey}`.trim() === '') {
			callback(
				`vectorStoreResolver: a standardKey is REQUIRED to resolve a vector store — ` +
					`nothing is substituted.`,
			);
			return;
		}
		if (typeof supportStoreFilePath !== 'string' || supportStoreFilePath.trim() === '') {
			callback(
				`vectorStoreResolver: a supportStoreFilePath is REQUIRED and has no default. Frozen ` +
					`vectors live in the ONE configured support store ([stores] ` +
					`graphBuilderSupportFilePath); a resolver that does not know which file it is opening ` +
					`is a resolver that can open anywhere.`,
			);
			return;
		}
		// The standardKey is still resolved through the bundle authority even though it no longer
		// picks the filename — see THE DERIVATION LESSON above. An unknown standard is a refusal
		// naming it, because a build harvesting vectors for a standard this tree cannot forge is a
		// caller bug wherever those vectors are being written.
		const resolvedBundle = resolveForgeBundle({ standard: standardKey });
		if (resolvedBundle.error) {
			callback(
				`vectorStoreResolver: '${standardKey}' is not a forgeable standard in this tree — ` +
					`${resolvedBundle.error}`,
			);
			return;
		}
		if (openedSupportStore) {
			callback('', openedSupportStore);
			return;
		}
		const oneStore = vectorStoreModule({});
		oneStore.init({ dbPath: supportStoreFilePath }, (initError) => {
			if (initError) {
				callback(
					`vectorStoreResolver: opening the support store '${supportStoreFilePath}' for frozen ` +
						`vectors: ${initError}`,
				);
				return;
			}
			openedSupportStore = oneStore;
			callback('', oneStore);
		});
	};
};

// NOTE (hub-fold design 2026-07-24): the hub derivation no longer lives here. It moved INTO the
// forger (descriptor discovery + foldHubIntoNodeEdges), which folds each hub standard's hub into
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

// debugJudgeFactory — the FREE, FLAGGED stand-in for the reranker (skipAI, 2026-08-10). The other
// module in this tree that answers `rerank`; --useDebugJudge selects it INSTEAD of the real client,
// so the whole bridging chain can be exercised without spending Opus credit. Its own header carries
// the full rationale. REGISTERED_RULE_NAMES/DEFAULT_RULE are read from it rather than restated here,
// so adding a rule to its register needs no edit in this file.
const debugJudgeFactory = require(path.join(__dirname, '..', 'apps', 'bridge-maker', 'lib', 'debugJudge'));

// parsePositiveInteger — the SAME reader lib/sourceWindow.js applies at slice time, required here so
// a malformed --limit/--offset is refused identically whether it is caught eagerly (before forging)
// or at the moment the window is applied. Two readers would be two chances to disagree.
const { parsePositiveInteger } = require(path.join(__dirname, '..', 'apps', 'bridge-maker', 'lib', 'sourceWindow'));

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

	// THE DECISION LIVES IN ITS OWN MODULE so its failure branch can be negated in
	// milliseconds instead of a five-minute forge. See
	// lib/ceds-fidelity-judgment/test/test-cedsFidelityJudgment.js -- 26 assertions, every one
	// a way this build must die. This function keeps only the I/O.
	const judgmentLib = require(
		path.join(__dirname, '..', '..', '..', 'lib', 'ceds-fidelity-judgment', 'ceds-fidelity-judgment'),
	)();
	const allowance = judgmentLib.resolveAllowance({
		rawValue: ((commandLineParameters || {}).values || {}).allowFidelityLoss,
	});
	if (allowance.error) {
		callback(`graphBuilder build: ${allowance.error}`);
		return;
	}
	const allowedLoss = allowance.allowedLoss;

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
					const verdict = judgmentLib.judgeFidelity({ headline, allowedLoss, graphName });
					if (!verdict.passed) {
						callback(`graphBuilder build: ${verdict.reason}`);
						return;
					}
					xLog.status(`  [fidelity] ${verdict.reason}`);
					callback('');
				},
			);
		});
	});
};

let materializeCounter = 0;
const resolvedSchemaBlocksCounter = () => (materializeCounter += 1);

const materializeSchemaBlocks = ({ xLog, replay, resolvedSchemaBlocks, manifestId, memberCount, standardTokens, commandLineParameters, fidelityGateRunner, storeResolver, roundTripStageRunner, roundTripStageSpec }, callback) => {
	// ⟪R-P2-2⟫ the vector-store RESOLVER is REQUIRED here (both in-module callers supply it;
	// the engine consults it only for ref-carrying nodes, so legacy inline blocks restore
	// exactly as before). An absent resolver would restore a ref-style block into a graph
	// whose nodes carry embeddingRef but NO embedding — a silently vector-less graph that
	// every downstream cosine would search blind. Refused by name instead.
	if (typeof storeResolver !== 'function') {
		callback(
			`materialize failed: a storeResolver is REQUIRED (the caller resolves ` +
				`deps.vectorStoreResolver with the canonical-home resolver as its documented ` +
				`default) — restoring ref-style blocks without one would materialize a graph ` +
				`with no vectors and say nothing.`,
		);
		return;
	}
	// ⟪R-P2-1⟫ the fidelity gate arrives INJECTED (a function with runCedsFidelityGate's
	// signature). Both in-module callers resolve it from deps with the REAL gate as the
	// documented default, so production is byte-unchanged; the hermetic suites inject a
	// SELF-ANNOUNCING stub (the real gate spawns `docker inspect` against a live container,
	// which no hermetic double has — the wiring gap that silently broke test-build/test-replay
	// from R-1's landing until 2026-08-03). An absent runner is REFUSED, never defaulted here:
	// this function cannot know which caller forgot it.
	if (typeof fidelityGateRunner !== 'function') {
		callback(
			`materialize failed: a fidelityGateRunner is REQUIRED (the caller resolves ` +
				`deps.cedsFidelityGateRunner with the real R-1 gate as its documented default) — ` +
				`an unstated gate would be indistinguishable from a passed one.`,
		);
		return;
	}
	// ⟪RT-13⟫ the round-trip stage arrives INJECTED with an explicit spec, same discipline as
	// the fidelity gate: both in-module callers supply runner + spec (-build composes a 'build'
	// spec from the recipe and the descriptor roster; -replay passes 'replayNotApplicable', a
	// VISIBLE non-run per R-WO-19). Absence is REFUSED, never defaulted — a skipped stage must
	// be indistinguishable from nothing, and it is the runner that makes every disposition loud.
	if (typeof roundTripStageRunner !== 'function' || !roundTripStageSpec) {
		callback(
			`materialize failed: a roundTripStageRunner AND a roundTripStageSpec are REQUIRED ` +
				`(build composes the stage spec from the recipe; replay passes ` +
				`'replayNotApplicable') — an unstated round-trip stage would be indistinguishable ` +
				`from a run one (RT-13.3).`,
		);
		return;
	}
	replay.create({ purpose: 'materialize' }, (createError, goldEval) => {
		if (createError) {
			callback(`materialize failed: creating the eval golden: ${createError}`);
			return;
		}
		replay.init({ inGraph: goldEval, schemaBlocks: resolvedSchemaBlocks, storeResolver }, (initError) => {
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
			fidelityGateRunner(
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
					// ⟪RT-13.2⟫ the round-trip stage — the LAST act before success, against the
					// finished product over bolt. Every schema block is already content-addressed
					// and persisted; the stage holds no write channel to any build artifact (its
					// writes are confined to the stage output directory). On stage failure the
					// graph is NOT deleted — same posture as R-1: an operator needs to inspect
					// the thing that failed.
					roundTripStageRunner(
						{ stageSpec: roundTripStageSpec, containerHandle: goldEval, xLog },
						(roundTripStageError, roundTripStageReport) => {
							if (roundTripStageError) {
								callback(roundTripStageError);
								return;
							}
							// NOT deleted — this graph is the product. roundTripSummaryPath rides
							// the result only when the stage wrote a summary (a -replay's visible
							// non-run writes nothing), so the -goldEvalCheck evidence is findable
							// from the build report itself.
							callback('', {
								manifestId,
								boltUrl: goldEval.boltUrl,
								memberCount,
								...(roundTripStageReport && roundTripStageReport.summaryFilePath
									? { roundTripSummaryPath: roundTripStageReport.summaryFilePath }
									: {}),
							});
						},
					);
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
// ⟪Round-Trip Perfection Phase 1, 2026-08-04⟫ THE SUPPORT STORE IS NOW THE CACHE'S HOME. Under TQ's
// single-file ruling the vector cache lives in the same file as the blocks, so when nothing overrides
// it this returns the OPENED standardsDatabase's own path rather than undefined — which used to let the
// embedder fall through to its in-code dataStores default. That fall-through is exactly what the phase
// removes: the path is now something an operator said, not something the embedder invented.
// supportStoreFilePath comes from the opened store handle for the same by-construction reason the
// vector-store resolver does.
const resolveEmbeddingCacheFilePath = (deps, { supportStoreFilePath } = {}) => {
	if (deps.embeddingCacheFilePath !== undefined) {
		return deps.embeddingCacheFilePath;
	}
	const commandLineParameters =
		(process.global && process.global.commandLineParameters) || { values: {} };
	// qtools parses every --flag=value into an ARRAY under values[name]; the first element is the
	// value (the same `(values[name] || [])[0]` idiom actions.js reads recipePath/standardsDatabase by).
	// Reading the array itself would hand the embedder a non-string path that vectorCache.open refuses.
	const commandLineOverride = (commandLineParameters.values.embeddingCacheFilePath || [])[0];
	if (commandLineOverride !== undefined) {
		return commandLineOverride;
	}
	return supportStoreFilePath;
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

// resolveDebugJudge — WHICH judge answers this run, an operator switch with the same §6 discipline as
// resolveVectorize/resolveRebridge. --useDebugJudge names a RULE from debugJudge's register (tqii,
// 2026-08-10), NOT a list of standards: SCOPING REMAINS --rebridge's job, and one judge serves the
// whole run ("I have no intention of allowing different standards to use different debugging
// judges"). Precedence: an explicit deps.useDebugJudge (orchestrator/test injection) wins; absent,
// the command line is read; absent entirely -> null, meaning the REAL reranker. A second argument
// may supply the command line explicitly (the test seam; production passes nothing).
//   --useDebugJudge            (bare, no value) -> the register's documented DEFAULT_RULE
//   --useDebugJudge=abstain    -> that rule, matched CASE-INSENSITIVELY
//   --useDebugJudge=nonsense   -> REFUSED BY NAME, listing the registered rules. Never a fallback.
// Returns { value } (a rule name or null) or { error }; no throw, so build() routes a refusal
// through its callback.
const resolveDebugJudge = (deps, injectedCommandLineParameters) => {
	const registeredNames = debugJudgeFactory.REGISTERED_RULE_NAMES;
	const nameOrRefusal = (rawValue) => {
		const wanted = `${rawValue}`.trim();
		if (wanted === '') {
			return { value: debugJudgeFactory.DEFAULT_RULE };
		}
		const matched = registeredNames.find(
			(oneName) => oneName.toLowerCase() === wanted.toLowerCase(),
		);
		if (!matched) {
			return {
				error:
					`graphBuilder build: --useDebugJudge='${wanted}' names no registered debug judge rule. ` +
					`Registered rules are: ${registeredNames.join(', ')}. It was NOT corrected to a default — ` +
					`a misspelled rule must refuse rather than silently become another rule.`,
			};
		}
		return { value: matched };
	};

	if (deps.useDebugJudge !== undefined) {
		if (deps.useDebugJudge === null || deps.useDebugJudge === false) {
			return { value: null };
		}
		if (typeof deps.useDebugJudge !== 'string') {
			return {
				error:
					`graphBuilder build: deps.useDebugJudge must be a rule-name string (or null) when supplied, ` +
					`got ${typeof deps.useDebugJudge} (${JSON.stringify(deps.useDebugJudge)}). It was NOT ` +
					`corrected to a default.`,
			};
		}
		return nameOrRefusal(deps.useDebugJudge);
	}

	// injectedCommandLineParameters — the TEST seam, and the same componentOverrides idiom llmClient
	// uses for postOnce. process.global.commandLineParameters is sealed NON-WRITABLE on purpose (the
	// real command line must not be mutable at run time), so a hermetic gate is given its own object
	// here rather than swapping process.global out from under the process — which would mutate shared
	// state and leave it clobbered if an assertion threw. PRODUCTION PASSES NOTHING and reads exactly
	// what it always read.
	const commandLineParameters =
		injectedCommandLineParameters ||
		(process.global && process.global.commandLineParameters) || { values: {}, switches: {} };
	const values = (commandLineParameters.values && commandLineParameters.values.useDebugJudge) || undefined;
	const switched = !!(commandLineParameters.switches && commandLineParameters.switches.useDebugJudge);
	if (values === undefined && !switched) {
		return { value: null };
	}
	// Present with no value (bare --useDebugJudge, which qtools parses to an empty array, or a bare
	// switch) means "the default rule" rather than a guess about which rule was meant.
	const firstValue = (values || [])[0];
	return nameOrRefusal(firstValue === undefined ? '' : firstValue);
};

// resolveReuseForgedBlocks — the OPT-IN for retrieving an already-forged base block instead of
// forging it again. ⟪Item 4, tqii 2026-08-11⟫ "revise the control system in graphBuilder so it
// retrieves and instantiates the base schema block for a standard instead of forging it. Then it
// passes to the bridgeMaker as normal."
//
// ⚠ WHY THIS IS OPT-IN AND WILL STAY OPT-IN. Reuse resolves a block by SUBJECT — a name, a slot —
// which deliberately bypasses the content addressing that protects every other identity in this
// system. Change a forge's code, rebuild, and a reusing run hands you YESTERDAY'S BLOCK with no
// signal that anything was skipped. That is a correctness trap wearing a performance improvement's
// clothes, and the only honest place for it is behind a switch an operator typed. Measured cost of
// what it skips, on cedsLifGeneric 2026-08-11: parse+embed ~25s, the Docker load+harvest ~100s.
const resolveReuseForgedBlocks = (deps, injectedCommandLineParameters) => {
	if (deps.reuseForgedBlocks !== undefined) {
		if (typeof deps.reuseForgedBlocks !== 'boolean') {
			return {
				error:
					`graphBuilder build: deps.reuseForgedBlocks must be a boolean when supplied, got ` +
					`${typeof deps.reuseForgedBlocks}. It was NOT corrected to a default.`,
			};
		}
		return { value: deps.reuseForgedBlocks };
	}
	const commandLineParameters =
		injectedCommandLineParameters ||
		(process.global && process.global.commandLineParameters) || { values: {}, switches: {} };
	return readOptionalBooleanValue({
		name: 'reuseForgedBlocks',
		commandLineParameters,
		moduleName: 'graphBuilder -build',
		whatItControls:
			'whether -build RETRIEVES an already-forged standardBase block from the store instead of forging it again',
		defaultValue: false,
	});
};

// resolveSourceWindow — the DEBUG WINDOW over each bridge's source elements (tqii, 2026-08-10:
// "if I ask for SIF.StudentPersonals and say limit=10, I want only 10 of 214 elements processed...
// lets add --offset as well so we can skip around"). --limit=N / --offset=N, both OPTIONAL and both
// defaulting to ABSENT, which is an ordinary full run. Precedence matches the other operator knobs:
// an explicit deps value wins; absent, the command line is read; a second argument may supply the
// command line (the test seam — production passes nothing).
//
// PARSING AND REFUSAL LIVE IN lib/sourceWindow.js, not here, so the CLI and any programmatic caller
// refuse identically. This resolver only decides WHERE the values come from.
//
// THE WINDOW APPLIES TO BRIDGING ONLY. It narrows which SOURCE ELEMENTS a bridge judges; it does not
// limit forging, materialization, or anything else. A windowed run's frozen block is PARTIAL and its
// generation says so.
const resolveSourceWindow = (deps, injectedCommandLineParameters) => {
	const commandLineParameters =
		injectedCommandLineParameters ||
		(process.global && process.global.commandLineParameters) || { values: {}, switches: {} };
	const readOne = (name) => {
		if (deps[name] !== undefined) {
			return deps[name];
		}
		return ((commandLineParameters.values && commandLineParameters.values[name]) || [])[0];
	};
	const limit = readOne('limit');
	const offset = readOne('offset');
	// Validate HERE as well as at apply time, so a malformed window fails BEFORE a container is
	// provisioned and a forge runs — the same eager-gate discipline a keyless --rebridge gets.
	const limitCheck = parsePositiveInteger({ value: limit, name: '--limit', minimum: 1 });
	if (limitCheck.error) {
		return { error: `graphBuilder build: ${limitCheck.error}` };
	}
	const offsetCheck = parsePositiveInteger({ value: offset, name: '--offset', minimum: 0 });
	if (offsetCheck.error) {
		return { error: `graphBuilder build: ${offsetCheck.error}` };
	}
	return { value: { limit: limitCheck.value, offset: offsetCheck.value } };
};

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
// ⟪skipAI, 2026-08-10⟫ a resolved debugJudgeRule DIVERTS step 2: the register's judge is constructed
// instead of the Anthropic client, so a real --rebridge runs end to end with no key and no spend. Two
// refusals guard it, both BY NAME:
//   - --useDebugJudge with NO ACTIVE --rebridge SCOPE. Nothing would be judged, so the flag would sit
//     idle and the run would LOOK like it worked — the silent-no-op shape this tree refuses. It does
//     NOT imply --rebridge=all: a flag that quietly enables another flag is exactly what §6 forbids.
//   - --useDebugJudge TOGETHER WITH an injected deps.inferenceConfig.llmClient. Two judges were named
//     for one run; picking either silently would make the run's own report unreliable.
// Answers { value } or { error } — the error-object idiom, so build() routes a refusal through its callback
// rather than throwing past it.
const resolveInferenceConfig = (deps, rebridgeScope, debugJudgeRule) => {
	const base = deps.inferenceConfig || {};
	const scopeIsActive = rebridgeScopeIsActive(rebridgeScope);

	if (debugJudgeRule && !scopeIsActive) {
		return {
			error:
				`graphBuilder build: --useDebugJudge='${debugJudgeRule}' was given but no --rebridge scope is ` +
				`active, so NOTHING WOULD BE JUDGED and the debug judge would never be called. A plain build ` +
				`MATERIALIZES frozen decision blocks and asks no judge at all. Name what to rebridge ` +
				`(--rebridge=all or --rebridge=<token>[,<token>...]); --useDebugJudge does not imply it.`,
		};
	}
	if (base.llmClient && debugJudgeRule) {
		return {
			error:
				`graphBuilder build: --useDebugJudge='${debugJudgeRule}' was given AND an llmClient was injected ` +
				`through deps.inferenceConfig. Two judges are named for one run and there is no precedence rule ` +
				`— pass one or the other.`,
		};
	}
	if (base.llmClient || !scopeIsActive) {
		return { value: base };
	}
	if (debugJudgeRule) {
		// Construction refuses BY NAME on an unregistered rule (already validated in resolveDebugJudge,
		// so this is defense in depth), translated into the callback channel like the real client below.
		let debugJudge;
		try {
			debugJudge = debugJudgeFactory({ ruleName: debugJudgeRule });
		} catch (constructError) {
			return {
				error: `graphBuilder build: the debug judge could not be constructed: ${constructError.message}`,
			};
		}
		return { value: { ...base, llmClient: debugJudge } };
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

	// the vector cache, resolved once and threaded to every standard's forge. Under the single-file
	// ruling it defaults to the OPENED support store; deps or --embeddingCacheFilePath still redirect it
	// (test isolation), and 'false' still turns it off inside the embedder.
	const embeddingCacheFilePath = resolveEmbeddingCacheFilePath(deps, {
		supportStoreFilePath: standardsDatabase.databaseFilePath,
	});

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
	// ⟪R-P2-1, 2026-08-03⟫ the R-1 fidelity-gate SEAM: injectable via deps.cedsFidelityGateRunner,
	// with the REAL gate as the documented default — the production path is byte-unchanged (same
	// function, same refusals: missing ontology refuses, invention always fails). The hermetic
	// suites inject a SELF-ANNOUNCING stub that prints its own [fidelity] HERMETIC STUB line —
	// never a silent skip, which R-1's own doctrine forbids (a gate that quietly does not run is
	// indistinguishable from one that passed). This seam existed nowhere from R-1's in-build
	// landing (92aecda) until now, so every hermetic ceds-recipe build died at materialize on a
	// `docker inspect` of a double's fake container.
	const cedsFidelityGateRunner = deps.cedsFidelityGateRunner || runCedsFidelityGate;
	// ⟪RT-13.4 / R-WO-17⟫ the recipe's stage opt-in. roundTripStage is a legitimately-optional
	// boolean with a DOCUMENTED default of false during the big-bang retrofit (stated in -help;
	// doctrine §7.4 grants recipes the DEV choice) — and the default is never SILENT: the stage
	// runner prints the disposition line on every build. The guard lives here as well as in the
	// recipe schema because build() is reachable with a recipe object that never went through
	// validateRecipe (the test seam); a supplied-but-non-boolean value is refused by name, never
	// corrected.
	if (recipe.roundTripStage !== undefined && typeof recipe.roundTripStage !== 'boolean') {
		callback(
			`graphBuilder build: recipe '${recipe.recipeName}' has roundTripStage=` +
				`${JSON.stringify(recipe.roundTripStage)} — it must be a boolean when supplied ` +
				`(true runs the RT-13 round-trip stage post-materialization; false/absent does ` +
				`not). It was NOT corrected to a default.`,
		);
		return;
	}
	const roundTripStageEnabled = recipe.roundTripStage === true;
	const roundTripStageDisabledReason =
		recipe.roundTripStage === false
			? 'recipe says roundTripStage: false'
			: 'recipe default (roundTripStage absent)';
	// the stage runner SEAM (the R-P2-1 idiom): real runner by documented default; hermetic
	// suites inject a self-announcing stub so no test build writes into the canonical buildLogs
	// home. The roster is composed below, before phase A, so a declared-but-missing validator
	// refuses BEFORE any forge spend (R-WO-16: on every build, stage on or off).
	const roundTripStageRunner = deps.roundTripStageRunner || roundTripStageLib.runRoundTripStage;
	let roundTripValidatorRoster = null;
	// ⟪R-P2-2⟫ ONE vector-store resolver per build invocation (deps-injectable for tests; the
	// documented default is the real canonical-home resolver). Harvest injects the resolved
	// store per VECTORIZED standard; materialize hands the resolver to the restore path.
	// Hermetic builds never reach it: the harvest side asks only when the forge report declares
	// embeddingDims, and the restore side only consults it for ref-carrying nodes.
	// The support store path is taken from the OPENED standardsDatabase rather than re-resolved from
	// config here, and that is deliberate: it makes the frozen-vector store and the block store the
	// same file BY CONSTRUCTION. Two independent resolutions of "the configured path" are two things
	// that can disagree, and the failure would be silent — vectors written beside blocks that no
	// longer reference them.
	const vectorStoreResolver =
		deps.vectorStoreResolver ||
		makeVectorStoreResolver({ supportStoreFilePath: standardsDatabase.databaseFilePath });
	// inferenceConfig carries the reranker llmClient for a real --rebridge. The real-vs-stub SELECTION lives in
	// resolveInferenceConfig (the FACTORY seam): the suite injects a STUB via deps.inferenceConfig.llmClient; a
	// real --rebridge with no injected client MINTS the real one, which throws BY NAME when no key resolves.
	// ⟪skipAI⟫ WHICH judge answers, resolved before the config that carries it. A refusal here must
	// reach the operator before any judging begins, exactly as a keyless --rebridge does.
	const reuseResolution = resolveReuseForgedBlocks(deps, deps.commandLineParameters);
	if (reuseResolution.error) {
		callback(reuseResolution.error);
		return;
	}
	const reuseForgedBlocks = reuseResolution.value;

	const sourceWindowResolution = resolveSourceWindow(deps, deps.commandLineParameters);
	if (sourceWindowResolution.error) {
		callback(sourceWindowResolution.error);
		return;
	}
	const sourceWindow = sourceWindowResolution.value;

	const debugJudgeResolution = resolveDebugJudge(deps, deps.commandLineParameters);
	if (debugJudgeResolution.error) {
		callback(debugJudgeResolution.error);
		return;
	}
	const debugJudgeRule = debugJudgeResolution.value;
	if (debugJudgeRule) {
		xLog.status(
			`graphBuilder build: --useDebugJudge='${debugJudgeRule}' — THE REAL RERANKER IS NOT BEING USED. ` +
				`Judgments this run are mechanical and every resulting node and edge is flagged ` +
				`${debugJudgeFactory.DEBUG_MARK}. No Opus credit will be spent on inference.`,
		);
	}

	const inferenceConfigResolution = resolveInferenceConfig(deps, rebridgeScope, debugJudgeRule);
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

	// ---- the build's report directory (hubReimplementation Phase 2, SPEC §5) ----
	// ONE directory per build invocation under the canonical dataStores home (the actions.js
	// documented-default precedent), named recipe + wall-clock start, created lazily by the
	// first standard that has something to write. The hub prose-divergence and skip reports
	// land here — the build orchestrator owns the build's log directory; the forger carries
	// report DATA only and writes nothing.
	const buildRunStamp = new Date()
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\..+$/, '')
		.replace('T', '-');
	const buildLogsDirPathResolution = resolveBuildLogsDirPath(deps);
	if (buildLogsDirPathResolution.error) {
		callback(buildLogsDirPathResolution.error);
		return;
	}
	const buildReportsDirPath = path.join(
		buildLogsDirPathResolution.value,
		`${recipe.recipeName}_${buildRunStamp}`,
	);

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
	// ⟪ITEM 4, 2026-08-11⟫ attemptBaseBlockReuse — RETRIEVE an already-forged standardBase instead of
	// forging it. Answers callback('', true) when it reused, ('', false) on a clean miss (the caller
	// forges), or (error) on a fault.
	//
	// HOW THE NAME IS KNOWN WITHOUT FORGING. The recipe usually says version 'current', and phase A
	// normally composes the subject AFTER the forge from its snapshot-provenance triple. forger
	// .getVersionStamp answers that triple from the descriptor's PINNED snapshot and its provenance
	// file — the SAME deriveVersionStamp arithmetic the forge uses — and REFUSES BY NAME when the
	// answer would need a parse. The subject is then composed HERE with the very same functions phase
	// A uses (explicitVersionFrom, slugifyVersion, suffixMarkerForKind), so the reused name and the
	// forged name cannot drift.
	//
	// WHAT REUSE MUST STILL SUPPLY, because phase C reads all of it: the block itself
	// (baseBlockByToken), the resolved version (resolvedVersionByToken, which keys phase C's
	// relationship subjects), and the run's EMBEDDING IDENTITY — recovered from the stored block's own
	// header line, since phase C's relationship harvest must declare the same embeddingDims/model as
	// the bases or the materialize restore gate refuses it.
	//
	// A MISS IS A STATE, NOT AN ERROR. Nothing stored means forge normally.
	const attemptBaseBlockReuse = (std, callback) => {
		if (!reuseForgedBlocks) {
			callback('', false);
			return;
		}
		const stamp = components.forger.getVersionStamp({ standard: std.token });
		if (stamp.error) {
			xLog.status(`  [A] ${std.token}: cannot name a stored block without forging — ${stamp.error}`);
			callback('', false);
			return;
		}
		const reuseVersion = explicitVersionFrom(stamp.value);
		const reuseSubject = `${std.token}@${slugifyVersion(reuseVersion)}${vocabulary.suffixMarkerForKind(
			vocabulary.SCHEMA_BLOCK_KIND.STANDARD_BASE,
		)}`;
		standardsDatabase.findBlockBySubject(
			{ kind: 'standardBase', subject: reuseSubject, version: reuseVersion },
			(findError, found) => {
				if (findError) {
					callback(findError);
					return;
				}
				if (!found) {
					xLog.status(`  [A] ${std.token}: no stored block for '${reuseSubject}' — forging`);
					callback('', false);
					return;
				}
				// getBlock returns the whole ROW and VERIFIES the content address before handing it back,
				// so reuse inherits corruption detection for free: a tampered or truncated block is
				// refused by name here rather than materializing into a graph.
				standardsDatabase.getBlock({ refId: found.refId }, (getError, blockRow) => {
					if (getError) {
						callback(`reuse ${reuseSubject}: ${getError}`);
						return;
					}
					if (!blockRow || blockRow.text === undefined || blockRow.text === null) {
						callback(
							`reuse ${reuseSubject}: the store found block ${found.refId} by subject but ` +
								`returned no text for it.`,
						);
						return;
					}
					const text = typeof blockRow.text === 'string' ? blockRow.text : `${blockRow.text}`;
					// the block's FIRST LINE is its header; the embedding identity is declared there.
					let header = {};
					const parseHeader = () => {
						header = JSON.parse(text.slice(0, text.indexOf('\n')));
					};
					try {
						parseHeader();
					} catch (headerError) {
						callback(
							`reuse ${reuseSubject}: the stored block's header line is not parseable JSON ` +
								`(${headerError.message}) — refusing to reuse a block whose embedding identity ` +
								`cannot be read.`,
						);
						return;
					}
					// I7b — the reuse path's ONLY inspection of the text used to be the header line
					// above. Ask, now, whether the block it matched by NAME actually carries the hub
					// this recipe declared. Refused BY NAME; nothing substituted. (Phase 2a.)
					const hublessReuseRefusal = refuseHublessReuseUnderDeriveHub({
						deriveHub: hubStdSet.has(String(std.token).toLowerCase()),
						reusedBlockText: text,
						subject: reuseSubject,
					});
					if (hublessReuseRefusal !== '') {
						callback(hublessReuseRefusal);
						return;
					}
					resolvedVersionByToken[std.token] = reuseVersion;
					baseBlockByToken[std.token] = { blockText: text, refId: found.refId };
					buildEmbeddingModelVersion = header.embeddingModelVersion;
					buildEmbeddingDims = header.embeddingDims;
					xLog.status(
						`  [A] REUSED ${reuseSubject} -> standardBase ${found.refId} (forged ${found.createdAt}) ` +
							`— NOT FORGED. --reuseForgedBlocks resolves by NAME, so this is only correct if the ` +
							`forge that made it is the forge you mean.`,
					);
					manifest.add(
						{
							subject: reuseSubject,
							kind: 'standardBase',
							version: reuseVersion,
							description: `standardBase schema block for ${reuseSubject}, REUSED (not forged) by recipe '${recipe.recipeName}'`,
							// refId MUST ride along: manifestEditor re-derives the content address from the
							// text and refuses a block claiming an address that does not describe it. A
							// reused block already HAS its address — omitting it claimed '' and was rightly
							// refused.
							schemaBlock: { blockText: text, refId: found.refId },
						},
						(addError) => callback(addError ? `reuse add ${reuseSubject}: ${addError}` : '', !addError),
					);
				});
			},
		);
	};

	const forgeOneStandard = (std, done) => {
		attemptBaseBlockReuse(std, (reuseError, reused) => {
			if (reuseError) {
				done(reuseError);
				return;
			}
			if (reused) {
				done('');
				return;
			}
			forgeOneStandardByForging(std, done);
		});
	};

	const forgeOneStandardByForging = (std, done) => {
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

		// ---- hub-fold reports (hubReimplementation Phase 2, SPEC §5) ----
		// Present on the forge report ONLY when this standard's forge folded a hub. An EMPTY
		// report is written explicitly (SPEC §5: "no report" must always mean "did not run").
		taskList.push((args, next) => {
			if (
				args.forgeReport.hubDivergenceReport === undefined &&
				args.forgeReport.hubSkipReport === undefined
			) {
				next('', args);
				return;
			}
			// ⟪P2-review S-1⟫ the two reports are a PAIR from one fold; one without the other is
			// a malformed forge report, refused BY NAME — not a JSON.stringify(undefined) crash
			// inside the write callback.
			if (
				args.forgeReport.hubDivergenceReport === undefined ||
				args.forgeReport.hubSkipReport === undefined
			) {
				next(
					`build: the forge report for ${std.token} carries ` +
						`${args.forgeReport.hubDivergenceReport === undefined ? 'NO hubDivergenceReport' : 'NO hubSkipReport'} ` +
						`while its pair is present — the fold emits both together (explicit-empty when ` +
						`empty), so half a pair is a malformed report, refused rather than half-written.`,
				);
				return;
			}
			fs.mkdir(buildReportsDirPath, { recursive: true }, (mkdirError) => {
				if (mkdirError) {
					next(
						`build: cannot create the build report directory ` +
							`'${buildReportsDirPath}': ${mkdirError.message}`,
					);
					return;
				}
				const divergenceReportPath = path.join(
					buildReportsDirPath,
					'cedsProseDivergence.json',
				);
				const skipReportPath = path.join(buildReportsDirPath, 'cedsHubSkipReport.json');
				fs.writeFile(
					divergenceReportPath,
					JSON.stringify(args.forgeReport.hubDivergenceReport, null, '\t'),
					(divergenceWriteError) => {
						if (divergenceWriteError) {
							next(
								`build: cannot write '${divergenceReportPath}': ` +
									`${divergenceWriteError.message}`,
							);
							return;
						}
						fs.writeFile(
							skipReportPath,
							JSON.stringify(args.forgeReport.hubSkipReport, null, '\t'),
							(skipWriteError) => {
								if (skipWriteError) {
									next(
										`build: cannot write '${skipReportPath}': ${skipWriteError.message}`,
									);
									return;
								}
								xLog.status(
									`  [hubReports] ${args.forgeReport.hubDivergenceReport.length} ` +
										`prose-divergence row(s) -> ${divergenceReportPath}; ` +
										`${args.forgeReport.hubSkipReport.length} skip row(s) -> ${skipReportPath}`,
								);
								next('', args);
							},
						);
					},
				);
			});
		});

		// ⟪P2-review S-2⟫ the heap gate fires BEFORE any container is provisioned, so an
		// under-provisioned process refuses by name (with the --max-old-space-size remedy)
		// instead of OOM-killing mid-load and stranding the scratch graph.
		taskList.push((args, next) => {
			const adequacy = resolveHeapAdequacy({
				nodeCount: args.forgeReport.nodeEdges.nodes.length,
				embeddingDims: args.forgeReport.nodeEdges.embeddingDims,
			});
			if (adequacy.error) {
				next(adequacy.error);
				return;
			}
			next('', args);
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

		// ⟪R-P2-2⟫ resolve this standard's vector-store BEFORE the harvest, exactly when the block
		// will carry vectors (the forge report's embeddingDims is the declaration). An un-vectorized
		// build resolves nothing and creates no store file — hermetic runs never touch the canonical
		// home. With the store injected, the harvested block carries per-node embeddingRefs and the
		// raw vectors land in the sidecar, so the block text stays under the V8 string ceiling
		// whatever the card population.
		taskList.push((args, next) => {
			if (
				args.forgeReport.nodeEdges.embeddingDims === null ||
				args.forgeReport.nodeEdges.embeddingDims === undefined
			) {
				next('', { ...args, standardVectorStore: undefined });
				return;
			}
			vectorStoreResolver(std.token, (resolveError, standardVectorStore) => {
				if (resolveError) {
					next(`harvest standardBase ${std.token}: ${resolveError}`);
					return;
				}
				next('', { ...args, standardVectorStore });
			});
		});

		taskList.push((args, next) => {
			replay.harvest(
				{
					inGraph: args.workingGraph,
					selectionLabels: [BASE_GRAPH_LABEL],
					vectorStore: args.standardVectorStore,
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
					// alreadyPresent is REPORTED, not inferred. standards-database.saveBlock content-addresses
					// the block and answers { refId, alreadyPresent } — true meaning 'the same bytes ARE the same
					// block. Not an error, not a rewrite.' It is emitted here because A BYTE-IDENTITY GATE CANNOT
					// READ IT FROM THE ABSENCE OF A NEW ROW: a forge that silently skipped writing also inserts
					// nothing, and by row count the two are indistinguishable. Observability ONLY — this line
					// changes no block text, no block id and no control flow. (versionFromStamp order, scope
					// addition authorized by the design authority 2026-08-31.)
					xLog.status(
						`  [A] forge ${baseSubject} -> standardBase ${addReport.schemaBlockRefId} ` +
							`(alreadyPresent ${addReport.alreadyPresent === true ? 'true' : addReport.alreadyPresent === false ? 'false' : 'NOT REPORTED'})`,
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
			// ⟪P2-review M-1⟫ the dependency-graph restore carries the SAME resolver as the
			// materialize leg: a bridge's dependency bases now arrive ref-style (every vectorized
			// standard after R-P2-2), and a resolverless restore would hand the bridge a graph
			// whose candidates carry no embedding — the exact path Phase 3's no-reembed contract
			// (G-15) reads. The engine's M-2 refusal is the layer-owned backstop; this is the wire.
			replay.init({ inGraph: args.depGraph, schemaBlocks, storeResolver: vectorStoreResolver }, (err) =>
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
						// ⟪skipAI WINDOW⟫ --limit/--offset reach every bridge as config, AFTER the recipe's own
						// params spread so an operator's window always wins over a recipe's. Undefined on an
						// ordinary run, which the bridges pass through untouched.
						limit: sourceWindow.limit,
						offset: sourceWindow.offset,
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
						// THE OPT-IN DISCRIMINATOR, CARRIED ON THE BLOCK (Phase 7). The orchestrator never sees a
						// plugin declaration — it hands bridgeMaker a NAME and gets back a runReport — so the
						// declared value rides out on each blocks[] entry and is passed straight through here.
						// `undefined` when the plugin declares nothing, which is every plugin but one, and the
						// composer's undefined path returns the string it returned before this parameter existed.
						discriminator: oneBlock.subjectDiscriminator,
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

	// refuseCollidingBridgeDeclarations — THE PRE-SPEND CHECK (SPEC §3.7, placement amended by RULING
	// FJ-P7-1). The manifest editor already refuses a duplicate subject, but it does so at `manifest.add`,
	// which is reached AFTER the colliding bridge's entire judge run: on a real judge that is a paid spend
	// thrown away to learn something the recipe stated up front. This answers the same question from the
	// DECLARATIONS alone — and, under FJ-P7-1, BEFORE PHASE A, so a colliding recipe costs neither a forge
	// nor a judge.
	//
	// IT DELIBERATELY DOES NOT COMPOSE SUBJECTS, AND THAT IS WHAT LETS IT RUN THIS EARLY. Subjects need
	// resolved versions, and versions are not resolved until phase A has forged or reused every base — so a
	// subject-level check could not run before phase A at all. The TUPLE it compares is the part that IS
	// knowable at declaration time: (hub, source, producerKind,
	// subjectDiscriminator). Two bridges agreeing on all four WILL compose one subject whatever the versions
	// turn out to be, because every remaining term is shared. That makes this check sound without being
	// complete, and it is stated that way rather than sold as a subject check.
	//
	// MAPPING BRIDGES ONLY. A structural pairing carries `pairWith` and no `hub`; its subject is composed
	// from a different pair of tokens, so pooling the two kinds would compare tuples that are not
	// commensurable. Excluded by the presence of `hub`, which is the same discriminator phase C's own
	// nameFirst/nameSecond resolution uses.
	const refuseCollidingBridgeDeclarations = () => {
		const mappingBridgeList = bridges.filter((oneBridge) => oneBridge.hub !== undefined);
		// A COMPONENT THAT CANNOT DESCRIBE IS REFUSED BY NAME, NOT TOLERATED. describeBridge is part of the
		// declared bridgeMaker interface, so a component lacking it is non-conforming — and the one thing this
		// must never do is skip the check and let the build proceed, because a pre-spend gate that silently
		// does not run is worse than no gate: it reads as "no collision" to everyone downstream. Reaching this
		// with mapping bridges to check and no way to check them is a refusal.
		if (mappingBridgeList.length > 0 && typeof bridgeMaker.describeBridge !== 'function') {
			return (
				`the bridgeMaker component does not expose describeBridge, so recipe ` +
				`'${recipe.recipeName}' cannot be checked for colliding bridge declarations before any forge or ` +
				`judge spend. describeBridge is a DECLARED member of COMPONENT_SHAPES.bridgeMaker ` +
				`(apps/graph-builder/interfaces.js); a component missing it is non-conforming. The check is never ` +
				`skipped silently — a pre-spend gate that does not run reads as "no collision" to everything after it.`
			);
		}
		const describedList = [];
		for (let bridgeIndex = 0; bridgeIndex < mappingBridgeList.length; bridgeIndex++) {
			const oneBridge = mappingBridgeList[bridgeIndex];
			const described = bridgeMaker.describeBridge({ bridgeName: oneBridge.bridge, source: oneBridge.source });
			if (described.error) {
				// A DELIBERATE BEHAVIOUR CHANGE, NAMED (review finding C-3, RULING FJ-P7-2 item 2). Before
				// Phase 7 a recipe naming an unregistered bridge FORGED EVERY BASE and then failed inside
				// bridgeMaker.run in phase C. Under FJ-P7-1 the declaration read happens before phase A, so the
				// same recipe is now refused before a single forge runs. Strictly better, and OUTSIDE the
				// backward-compatibility claim, which is scoped to subjects, block ids, manifests and fixtures —
				// not to when an already-broken recipe learns it is broken.
				//
				// The refusal names the BRIDGE and the SOURCE it was looked up under, then carries the registry's
				// own message VERBATIM. Verbatim on purpose: test-bgReg pins that text, and a wrapper that
				// paraphrased it would break a gate while looking like an improvement.
				return `recipe '${recipe.recipeName}' names bridge '${oneBridge.bridge}', which is not registered for source '${oneBridge.source}' — refused before phase A, so no base was forged for a recipe that cannot run. ${described.error}`;
			}
			describedList.push({ hub: oneBridge.hub, ...described.description });
		}
		// THE RULE ITSELF LIVES IN A PURE MODULE so its red twins exercise the rule rather than a copy of it
		// (the genesisGuard.js / batchWindowVerdict.js precedent). This function keeps only the IMPURE half:
		// one describeBridge lookup per mapping bridge.
		return bridgeCollisionRuleLib.collisionRefusalFor({ recipeName: recipe.recipeName, describedBridgeList: describedList });
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
					// ⟪R-P2-1⟫ the injected-or-real fidelity gate, resolved once at the top of build()
					fidelityGateRunner: cedsFidelityGateRunner,
					// ⟪R-P2-2⟫ the same per-build resolver the harvest used — restore stamps each
					// ref-carrying node's vector back onto its graph node
					storeResolver: vectorStoreResolver,
					// ⟪RT-13⟫ the stage runner + the 'build' spec: the descriptor-composed roster,
					// the recipe's enablement, and the build's own run directory for the verdicts
					// and the certification summary (RT-6: the verdict lands with the build outputs).
					roundTripStageRunner,
					roundTripStageSpec: {
						mode: 'build',
						enabled: roundTripStageEnabled,
						disabledReason: roundTripStageDisabledReason,
						roster: roundTripValidatorRoster,
						outputDirPath: buildReportsDirPath,
					},
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

	// ⟪RT-13.1 / R-WO-16⟫ COMPOSE THE VALIDATOR ROSTER FIRST — before a single container is
	// provisioned or a credit spent. The roster is read from the same parserDescriptor.ini
	// authority the forge roster uses (components.forger.resolveBundle — injectable, so the
	// hermetic suites drive it with doubles), and a DECLARED-BUT-MISSING validator refuses the
	// build here, on every build, stage on or off: a descriptor naming a file that does not
	// load is a broken bundle self-description regardless of whether anyone was about to run
	// it. An UNRESOLVABLE bundle is NOT refused here — the forger's own phase-A refusal is the
	// incumbent error for that case and keeps firing exactly as it always has.
	roundTripStageLib.composeValidatorRoster(
		{
			standardTokens: standards.map((one) => one.token),
			bundleResolver: components.forger.resolveBundle,
		},
		(rosterError, composedRoster) => {
			if (rosterError) {
				callback(`graphBuilder build: ${rosterError}`);
				return;
			}
			roundTripValidatorRoster = composedRoster;
			// RULING FJ-P7-1 (supervisor FROZEN_JOURNEY, 2026-08-29) — A DELIBERATE DEVIATION FROM SPEC §3.7,
			// which placed this check "before phase C". It runs BEFORE PHASE A instead. The check reads
			// DECLARATIONS ONLY — no resolved version, no per-block producer, nothing phase A produces — so
			// nothing made it late except the spec's own wording, and refusing before the FORGE spend is
			// strictly better than refusing before the judge spend. A recipe that cannot compose distinct
			// relationship subjects is wrong at the moment it is read, not at the moment it is paid for.
			const declarationCollisionRefusal = refuseCollidingBridgeDeclarations();
			if (declarationCollisionRefusal !== '') {
				callback(`graphBuilder build: ${declarationCollisionRefusal}`);
				return;
			}
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
		},
	);
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
				{
					xLog,
					replay: replayEngine,
					resolvedSchemaBlocks,
					manifestId,
					memberCount,
					// ⟪R-P2-1⟫ same seam as build(): injected runner or the real gate. (This path
					// passes no standardTokens, so the real gate no-ops here exactly as before —
					// the seam changes nothing about -replay's behavior.)
					fidelityGateRunner: deps.cedsFidelityGateRunner || runCedsFidelityGate,
					// ⟪R-P2-2⟫ a -replay of stored ref-style blocks resolves vectors from the same
					// canonical home (deps-injectable for tests, real resolver by default)
					storeResolver:
						deps.vectorStoreResolver ||
						makeVectorStoreResolver({ supportStoreFilePath: standardsDatabase.databaseFilePath }),
					// ⟪RT-13 / R-WO-19⟫ the stage is NOT APPLICABLE to -replay (the round trip
					// belongs to the build that composed the manifest) — and that non-run is
					// VISIBLE: the runner prints the disposition line rather than silently
					// skipping. Same runner seam as build().
					roundTripStageRunner: deps.roundTripStageRunner || roundTripStageLib.runRoundTripStage,
					roundTripStageSpec: { mode: 'replayNotApplicable' },
				},
				callback,
			);
		});
	});
};

// makeVectorStoreResolver is RETURNED so its refusals can be gated directly. Under the single-file
// ruling it REQUIRES a supportStoreFilePath and still validates the standardKey through the forge-bundle
// authority; both refusals are reachable only by holding the resolver itself, and a refusal no test can
// reach is a refusal nobody has seen work.
return { build, replay, defaultComponents, makeVectorStoreResolver };
};

// END OF moduleFunction() ============================================================

// -----
// refuseHublessReuseUnderDeriveHub — INVARIANT I7b (SPEC-hubKitRole-082826.md §4.2 [R2 F4]),
// landed Phase 2a. --reuseForgedBlocks resolves a stored block BY SUBJECT — a name, a slot — and the
// only inspection the reuse path makes of the block TEXT is JSON.parse of its FIRST LINE, read for
// embedding identity. It never asked whether the block carries a hub.
//
// That was reachable, not theoretical. recipes/cedsOnlyRoundTrip.recipe.jsonc declares "hubs": [], so
// a HUBLESS ceds@14_0_0_0_base is a legitimate store entry; findBlockBySubject orders by createdAt
// DESC, so the MOST RECENT block for a subject wins on RECENCY and fitness is never consulted. A
// hubless build followed by a hub build with reuse on therefore handed back the hubless block,
// deriveHub never ran, and every bridge targeting the CEDS hub ran against ZERO CARDS while
// reporting success. Phase 0 forged both blocks and proved the pair exists.
//
// PURE: text in, string out. '' means ADMITTED. Exported as a static per this module's own idiom so
// the refusal is provable directly, without standing up the whole build pipeline.
//
// The discriminator matches the QUOTED label, not the bare word: HubDefinition is a node line
// {"kind":"node",…,"labels":[…,"HubDefinition",…]}, and a bare-word match would also hit prose inside
// a property value and make the discriminator lie.
const HUB_DEFINITION_LABEL_PATTERN = /"HubDefinition"/;
const refuseHublessReuseUnderDeriveHub = ({ deriveHub, reusedBlockText, subject } = {}) => {
	if (!deriveHub) {
		return ''; // a hubless recipe reusing a hubless block is CORRECT and must keep working
	}
	const text = typeof reusedBlockText === 'string' ? reusedBlockText : `${reusedBlockText}`;
	if (HUB_DEFINITION_LABEL_PATTERN.test(text)) {
		return '';
	}
	return (
		`build: REFUSED — the recipe declares a hub for '${subject}' (deriveHub) and ` +
		`--reuseForgedBlocks matched a STORED BLOCK THAT CARRIES NO HubDefinition. Reuse resolves by ` +
		`SUBJECT and by RECENCY, never by fitness, so a hubless block forged under a "hubs": [] recipe ` +
		`legitimately occupies the same subject name. Reusing it would skip hub derivation silently and ` +
		`every bridge targeting this hub would then run against ZERO cards while reporting success. ` +
		`Forge it (drop --reuseForgedBlocks) or point the store at a hub-bearing block for '${subject}'. ` +
		`Nothing was substituted.`
	);
};

// defaultComponents is RETURNED in the API (not a static) so test-interfaces can assert the
// orchestrator's DEFAULTS are the real modules themselves — the gate that replaces "the stub set
// conforms too", which passed for a year while the arguments drifted underneath it.
module.exports = moduleFunction({ moduleName });
// pure helpers exported as statics so the rebridge-scope resolution + per-pair scope match can be gated
// directly (§6 no-silent-default), without standing up the whole build pipeline.
module.exports.refuseHublessReuseUnderDeriveHub = refuseHublessReuseUnderDeriveHub;
module.exports.resolveRebridge = resolveRebridge;
module.exports.pairInRebridgeScope = pairInRebridgeScope;
module.exports.rebridgeScopeIsActive = rebridgeScopeIsActive;
// the real-vs-stub reranker SELECTION seam (P3b), exported so the factory choice is gated directly: a stub is
// used when injected, a real client is minted (via the injected/default factory) for an active --rebridge.
module.exports.resolveInferenceConfig = resolveInferenceConfig;
// ⟪skipAI⟫ exported for its hermetic gate — the rule resolution is refuse-by-name logic worth
// exercising directly rather than only through a full build.
module.exports.resolveDebugJudge = resolveDebugJudge;
module.exports.resolveSourceWindow = resolveSourceWindow;
module.exports.resolveReuseForgedBlocks = resolveReuseForgedBlocks;
// ⟪P2-review S-2⟫ the heap gate, exported as a static so its refusal is provable with an
// injected limit — never by shrinking a real process's heap.
module.exports.resolveHeapAdequacy = resolveHeapAdequacy;
// ⟪Phase 4 K3b⟫ the build-log root resolver, exported as a static so its precedence and its
// refusal of an empty value are gated directly (test-build) — and so the suite can point every
// real build at a scratch root instead of the canonical dataStores/buildLogs home.
module.exports.resolveBuildLogsDirPath = resolveBuildLogsDirPath;
module.exports.BUILD_LOGS_DIR_PATH = BUILD_LOGS_DIR_PATH;
