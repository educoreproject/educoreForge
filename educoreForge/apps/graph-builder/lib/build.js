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
// Pipeline (targetArchitectureDesign §4.4):
//   A  forger.forge -> replayManager.create -> init(nodeEdges, applyLabels:[StandardBase])
//                   -> harvest(selectionLabels:[StandardBase]) -> manifest.add({...})
//      (if the standard is a hub)  -> harvest(:HubReference) -> manifest.add({...})
//                                  -> replayManager.delete
//   C  per bridge: create -> bridgeMaker.run (labels edges) -> harvest(:BridgedRelation)
//                        -> manifest.add({...}) -> delete
//   compose      -> manifest.refId() over the membership
//   materialize  -> create() (an EMPTY graph, always) then init({ schemaBlocks }) to fill it.
//                   create is MONOMORPHIC: it does not take a manifest and does not return a url.
//                   All polymorphism about putting content INTO a graph lives in init.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();
const { readOptionalBooleanValue } = require('./optional-boolean-value');

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
const HUB_LABEL = 'HubReference';
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

	// ---- Phase A: forge each standardBase (+ hub block when the standard is a hub) ----
	// The forge runs BEFORE the graph is provisioned (targetArchitectureDesign §4.4). A forge
	// bundle never sees, needs or wants a graph, so provisioning one first would spend a container
	// on material that may not exist — and a standard with no forge bundle now fails before any
	// docker command is attempted.
	const forgeOneStandard = (std, done) => {
		const subjectRefId = standardKey(std);
		const taskList = new taskListPlus();

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
			forger.forge({ standard: std.token, version: std.version, vectorize: vectorizeSpend }, (err, forgeReport) => {
				next(err ? `forge ${std.token}: ${err}` : '', { ...args, forgeReport });
			});
		});

		taskList.push((args, next) => {
			replay.create({ purpose: 'forge' }, (err, workingGraph) => {
				next(err ? `create(forge) for ${std.token}: ${err}` : '', { ...args, workingGraph });
			});
		});

		// the forger produced; replayManager loads. The label the harvest will select on is the
		// label init stamps — handed down, not hoped for.
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
					subjectRefId,
					kind: 'standardBase',
					description: `standardBase schema block for ${subjectRefId}, forged by recipe '${recipe.recipeName}'`,
					schemaBlock: args.schemaBlock,
				},
				(err, addReport) => {
					if (err) {
						next(`add standardBase ${subjectRefId}: ${err}`);
						return;
					}
					xLog.status(
						`  [A] forge ${subjectRefId} -> standardBase ${addReport.schemaBlockRefId}`,
					);
					next('', args);
				},
			);
		});

		// A hub emits a SECOND schema block from the same working graph (§2). Deriving that block
		// from the harvested base — forgeHub — is deferred with the rest of the hub step; what is
		// here is the harvest-and-record half, speaking the declared contract like everything else.
		if (hubStdSet.has(String(std.token).toLowerCase())) {
			taskList.push((args, next) => {
				replay.harvest(
					{
						inGraph: args.workingGraph,
						selectionLabels: [HUB_LABEL],
						header: {
							blockType: 'hub',
							standardKey: std.token,
							version: std.version,
						},
					},
					(err, hubSchemaBlock) => {
						next(err ? `harvest hub ${std.token}: ${err}` : '', { ...args, hubSchemaBlock });
					},
				);
			});

			taskList.push((args, next) => {
				manifest.add(
					{
						subjectRefId,
						kind: 'hub',
						description: `hub reference schema block for ${subjectRefId}, from recipe '${recipe.recipeName}'`,
						schemaBlock: args.hubSchemaBlock,
					},
					(err, addReport) => {
						if (err) {
							next(`add hub ${subjectRefId}: ${err}`);
							return;
						}
						xLog.status(`  [B] hub block ${std.token} -> ${addReport.schemaBlockRefId}`);
						next('', args);
					},
				);
			});
		}

		taskList.push((args, next) => {
			replay.delete(args.workingGraph, (err) => next(err || '', args));
		});

		pipeRunner(taskList.getList(), {}, (err) => done(err || ''));
	};

	const phaseA = (done) => eachSeries(standards, forgeOneStandard, done);

	// ---- Phase C: bridges (materialize dep graph, run bridge, harvest labeled relationships) ----
	const bridgeOnePairing = (bridge, done) => {
		const subjectRefId = pairKey(bridge);
		// THE RECIPE NAMES THE MAPPER. RECIPE_SCHEMA requires it on every bridge, so a recipe that
		// reaches here has one; there is no in-code name standing behind the key any more
		// (polyArch2 §6). The guard is here rather than only in the schema because build() is
		// reachable with a recipe object that never went through validateRecipe (the test seam
		// does exactly that), and a bridge whose mapper is absent must say so rather than run
		// something nobody asked for.
		const mapper = bridge.mapper;
		if (typeof mapper !== 'string' || mapper.trim() === '') {
			done(
				`bridge ${subjectRefId}: mapper is ${
					mapper === undefined ? 'not named' : JSON.stringify(mapper)
				}. Every bridge names its mapper in the recipe — it IS what the bridge does, and ` +
					`there is no default. Nothing was substituted for it.`,
			);
			return;
		}
		const taskList = new taskListPlus();

		// create means "an empty graph", always. The dependency schema blocks go IN through init's
		// RESTORATION payload once dependency resolution lands with the rest of Phase C.
		taskList.push((args, next) => {
			replay.create({ purpose: 'dependencyGraph' }, (err, depGraph) => {
				next(err ? `create(dep) ${subjectRefId}: ${err}` : '', { ...args, depGraph });
			});
		});

		taskList.push((args, next) => {
			bridgeMaker.run(
				{ inGraph: args.depGraph, mapper, applyLabel: RELATION_LABEL },
				(err) => next(err ? `bridge ${subjectRefId}: ${err}` : '', args),
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
					next(err ? `harvest relationships ${subjectRefId}: ${err}` : '', {
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
						next(`add relationship ${subjectRefId}: ${err}`);
						return;
					}
					xLog.status(
						`  [C] bridge ${subjectRefId} (mapper=${mapper}) -> relationship ${addReport.schemaBlockRefId}`,
					);
					next('', args);
				},
			);
		});

		taskList.push((args, next) => {
			replay.delete(args.depGraph, (err) => next(err || '', args));
		});

		pipeRunner(taskList.getList(), {}, (err) => done(err || ''));
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
							callback(
								`materialize failed: loading ${resolvedSchemaBlocks.length} schema block(s): ${initError}`,
							);
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
