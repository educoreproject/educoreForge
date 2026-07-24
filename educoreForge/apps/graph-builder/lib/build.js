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
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();
const { readOptionalBooleanValue } = require('./optional-boolean-value');

// the VOCABULARY REGISTRY — read here for the subjectRefId role marker (§1 of the hub-port plan).
// The base block's subjectRefId is <standard>@<version> plus the marker its KIND requires; the
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

const standardKey = (std) => `${std.token}@${std.version}`;
const pairKey = (bridge) => `${bridge.source}::${bridge.hub || '(structural)'}`;

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
	const inferenceConfig = deps.inferenceConfig || {};

	const forger = components.forger();
	const replay = components.replayManager();
	const bridgeMaker = components.bridgeMaker();
	const manifest = components.manifestEditor({ standardsDatabase }).init({
		name: recipe.recipeName,
		description: recipe.description,
		recipe,
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

	// ---- Phase A: forge each standardBase (+ hub block when the standard is a hub) ----
	// The forge runs BEFORE the graph is provisioned (targetArchitectureDesign §4.4). A forge
	// bundle never sees, needs or wants a graph, so provisioning one first would spend a container
	// on material that may not exist — and a standard with no forge bundle now fails before any
	// docker command is attempted.
	const forgeOneStandard = (std, done) => {
		const subjectRefId = standardKey(std);
		// The BASE block's subject is <standard>@<version>_base (§1). The prefix is the recipe's
		// standard-version, unchanged; the '_base' marker is DERIVED from the block's kind so the name
		// and the kind cannot drift (the store's suffix↔kind gate refuses them if they do). The hub
		// block keeps the bare subjectRefId here — its '_hub' marker lands in Phase 3, with the
		// derivation that makes a hub block exist at all.
		const baseSubjectRefId = `${subjectRefId}${vocabulary.suffixMarkerForKind(
			vocabulary.SCHEMA_BLOCK_KIND.STANDARD_BASE,
		)}`;
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
					deriveHub: hubStdSet.has(String(std.token).toLowerCase()),
				},
				(err, forgeReport) => {
					if (!err) {
						// the RESOLVED version the bundle READ (a4a0da2) — recorded per token for the
						// version-keyed relationship block name Phase C composes; NOT the recipe token.
						resolvedVersionByToken[std.token] = forgeReport.version;
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
						version: std.version,
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
					subjectRefId: baseSubjectRefId,
					kind: 'standardBase',
					description: `standardBase schema block for ${baseSubjectRefId}, forged by recipe '${recipe.recipeName}'`,
					schemaBlock: args.schemaBlock,
				},
				(err, addReport) => {
					if (err) {
						next(`add standardBase ${baseSubjectRefId}: ${err}`);
						return;
					}
					xLog.status(
						`  [A] forge ${baseSubjectRefId} -> standardBase ${addReport.schemaBlockRefId}`,
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
		// live within one [StandardBase] block, both endpoints present. The '_hub' subjectRefId marker
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
		// pairLabel identifies the pairing for the operator (source::hub); the version-keyed,
		// producer-suffixed subjectRefId is COMPOSED after the bridge runs (the run result says whether the
		// producer was authored -> _exact or inferred -> _close). §7.
		const pairLabel = pairKey(bridge);
		let subjectRefId = null;
		// THE RECIPE NAMES THE MAPPER. RECIPE_SCHEMA requires it on every bridge, so a recipe that
		// reaches here has one; there is no in-code name standing behind the key any more
		// (polyArch2 §6). The guard is here rather than only in the schema because build() is
		// reachable with a recipe object that never went through validateRecipe (the test seam
		// does exactly that), and a bridge whose mapper is absent must say so rather than run
		// something nobody asked for.
		const mapper = bridge.mapper;
		if (typeof mapper !== 'string' || mapper.trim() === '') {
			done(
				`bridge ${pairLabel}: mapper is ${
					mapper === undefined ? 'not named' : JSON.stringify(mapper)
				}. Every bridge names its mapper in the recipe — it IS what the bridge does, and ` +
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
			const dependencyTokens = [bridge.source, bridge.hub].filter(
				(oneToken) => oneToken !== undefined && oneToken !== null && `${oneToken}`.trim() !== '',
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
			bridgeMaker.run(
				{
					inGraph: args.depGraph,
					mapper,
					hub: bridge.hub,
					applyLabel: RELATION_LABEL,
					rebridge: thisPairRebridges,
					decisionStore,
					inferenceConfig,
					config: {
						sourceStandard: bridge.source,
						sourceVersion: resolvedVersionByToken[bridge.source],
						hubVersion: resolvedVersionByToken[bridge.hub],
					},
				},
				(err, runReport) => {
					if (err) {
						next(`bridge ${pairLabel}: ${err}`);
						return;
					}
					// THE PRODUCER DECLARES ITS OWN KIND (polyArch2 §6). A producer that says runReport.producer
					// is believed; only a producer that stays silent is inferred from decisionBlock (authored ->
					// null -> _exact). This matters for the INFERRED producer's no-frozen-block case: it writes
					// zero edges and honestly returns decisionBlock null, but it is STILL the inferred producer
					// (an empty _close block), NOT authored — inferring _exact from the null would collide with
					// the authored pair's _exact block for the SAME pair (the intended two-producers-per-pair
					// design, §1). The producer naming itself removes that ambiguity at the source.
					const producer =
						runReport && (runReport.producer === 'inferred' || runReport.producer === 'authored')
							? runReport.producer
							: runReport && runReport.decisionBlock != null
								? 'inferred'
								: 'authored';
					const composed = vocabulary.relationshipSubjectRefId({
						hubStandard: bridge.hub,
						hubVersion: resolvedVersionByToken[bridge.hub],
						sourceStandard: bridge.source,
						sourceVersion: resolvedVersionByToken[bridge.source],
						producer,
					});
					if (composed.error) {
						next(`bridge ${pairLabel}: ${composed.error}`);
						return;
					}
					subjectRefId = composed.subjectRefId;
					next('', args);
				},
			);
		});

		taskList.push((args, next) => {
			replay.harvest(
				{
					inGraph: args.depGraph,
					selectionLabels: [RELATION_LABEL],
					header: { blockType: 'relationship', standardKey: subjectRefId },
				},
				(err, schemaBlock) => {
					next(err ? `harvest relationships ${pairLabel}: ${err}` : '', {
						...args,
						schemaBlock,
					});
				},
			);
		});

		taskList.push((args, next) => {
			manifest.add(
				{
					subjectRefId,
					kind: 'relationship',
					description: `relationship schema block for ${subjectRefId}, bridged by mapper '${mapper}' from recipe '${recipe.recipeName}'`,
					schemaBlock: args.schemaBlock,
				},
				(err, addReport) => {
					if (err) {
						next(`add relationship ${pairLabel}: ${err}`);
						return;
					}
					xLog.status(
						`  [C] bridge ${pairLabel} (mapper=${mapper}) -> relationship ${subjectRefId} ${addReport.schemaBlockRefId}`,
					);
					next('', args);
				},
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

		manifest.schemaBlocks((blocksError, resolvedSchemaBlocks) => {
			if (blocksError) {
				callback(`compose failed: ${blocksError}`);
				return;
			}
			replay.create({ purpose: 'materialize' }, (createError, goldEval) => {
				if (createError) {
					callback(`materialize failed: creating the eval golden: ${createError}`);
					return;
				}
				// The eval golden is filled through init's RESTORATION payload — no applyLabels, which
				// init refuses on that path: a harvested block already carries the labels stamped when
				// its material was created, and stamping more would make the block and the graph
				// restored from it disagree.
				replay.init(
					{ inGraph: goldEval, schemaBlocks: resolvedSchemaBlocks },
					(initError) => {
						if (initError) {
							// DISPOSE-ON-FAILURE (Item 4). goldEval was created three lines up and is NOT the
							// product when its own fill fails — a bare error here would strand it running. On
							// SUCCESS it is deliberately kept (it IS the product); only this failure disposes it.
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
						// NOT deleted — this graph is the product.
						callback('', { manifestId, boltUrl: goldEval.boltUrl, memberCount });
					},
				);
			});
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

return { build, defaultComponents };
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
