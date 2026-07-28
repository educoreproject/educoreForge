'use strict';

// bridgeSkeleton.js — THE REUSABLE BRIDGE SHELL (bridgeKitRefactor_072726 spec §6 Phase 4). Lifted
// OUT of forges/bridges/genericBridge.js (the Phase-2 fused generic-inferred bridge) once the LIF
// pilot proved the abstraction (Phase 3). genericBridge is now "the skeleton filled for the generic
// inferred case" (this file's own header explains exactly how) — the ~90% reusable orchestration
// this module owns, versus the ~10% generic-specific choices genericBridge.js supplies, is stated
// in the Phase-4 work order verbatim:
//
//   REUSABLE (lives HERE): kit composition + wiring-fault refusals, argument validation, the
//   MATERIALIZE-vs-REBRIDGE mode dispatch, the vectorize step, the freeze/decisionStore round-trip,
//   write-through-the-guarded-writer, and the { edgesWritten, decisionBlock, producer, counts }
//   return shape.
//
//   GENERIC-SPECIFIC (supplied BY THE CALLER at construction, not decided here): mappingTool
//   identity, the hub this bridge bridges toward, the source-walk role, the candidateFinder
//   matcher name, and the materializer's static config (predicate, mappingJustification, ...).
//
//   THE FIVE MOVES (design §4.3), each independently OVERRIDABLE — a custom bridge built on this
//   skeleton copies genericBridge's construction call and replaces exactly the ONE move it needs a
//   bespoke implementation for, leaving every other move (and all of the reusable orchestration
//   above) untouched:
//     walk         — extract a standard's mappable elements (default: kit.sourceWalker.walk)
//     match        — resolve a matcher that retrieves a scored candidate pool for one source
//                    (default: kit.candidateFinder.find(matcherName), the semanticMatcher module)
//     select       — pick ONE candidate from the pool, or abstain (default: kit.selector.selectFromPool)
//     freeze       — content-address raw decisions / read them back (default: kit.decisionFreezer)
//     materialize  — frozen decisions -> edge specs (default: kit.materializer, the inferredIndex factory)
//
// =====================================================================
// THE "FILL THESE MOVES" GUIDE — how a forge authors a custom bridge on this skeleton
// =====================================================================
//   1. Decide your bridge's IDENTITY: mappingTool (your bridge's own name, stamped on every edge),
//      hubStandard (the hub you bridge toward), defaultRole (the element role you walk by default).
//   2. Decide whether the DEFAULT five moves suffice. If your standard's signal is exactly
//      "role-matched top-K CEDS candidates by definition-embedding cosine, Opus abstain-first" —
//      genericBridge's own case — you need NO move overrides at all; supply only identity + the
//      static materializerConfig (predicate, mappingJustification) and you are done.
//   3. If ONE move needs bespoke logic (design §6 Phase 5's example: SIF wants a custom matcher
//      that reads XPath structure instead of definition-cosine), pass `moves: { match: yourFn }` —
//      every OTHER move (walk/select/freeze/materialize) and all reusable orchestration keeps
//      running exactly as genericBridge's does. See each move's exact override signature below,
//      next to its default implementation.
//   4. Overriding a move DROPS that move's kit-member requirement (see requiredKitMembersFor
//      below): a bridge that overrides `match` does not need kit.candidateFinder wired at all, and
//      a bridge that overrides `select` does not need kit.selector (no llmClient to build one with,
//      for instance a purely rule-based selector needs none). This is the proof the seam is real,
//      not cosmetic — test-bridge-skeleton.js's reusability section demonstrates exactly this.
//   5. Construct: `makeBridgeSkeleton({ mappingTool, hubStandard, defaultRole, defaultMatcherName,
//      materializerConfig, moves })` returns the SAME curried BridgeModule callable shape every
//      bridge in this tree exposes: `(injectedTools) => ({inGraph, hub, applyLabel}, callback)`.
//      Export that directly as your bridge file's module.exports — see forges/bridges/genericBridge.js.
//
// =====================================================================
// WHAT STAYS FIXED, NEVER OVERRIDABLE (the reusable 90%, not a "move")
// =====================================================================
//   - kit-member wiring-fault refusals (a missing kit / missing required member is refused BY NAME
//     before anything runs; polyArch2 §6 — no silent no-op).
//   - inGraph / hub / applyLabel / config.sourceStandard argument refusals.
//   - reading the hub's HubReference nodes (kit.graphReader, always, by hubReferenceLabel).
//   - the vectorize step (kit.vectorizer.batchEmbed over every source+candidate defText) — a
//     capability every kit provides regardless of standard, not a per-bridge choice (design §4.1's
//     kit table lists it as a REAL, wrap-only kit component, distinct from the matcher move).
//   - the MATERIALIZE-vs-REBRIDGE mode dispatch (kit.rebridge) and the decisionStore round-trip.
//   - writing each materialized edge through kit.writer (the guarded single write seam) — a bridge
//     NEVER gets a raw write substrate, overridable or not (bridgeMaker's negative substrate scan
//     enforces this at the FILE level regardless of what this shell does internally).
//   - the { edgesWritten, decisionBlock, producer, counts } result shape.
//
// House style throughout: qtools curried moduleFunction; callback(errString, result) with '' on
// success; no async/await or try/catch for control flow; taskListPlus/pipeRunner; refuse-by-value
// (polyArch2 §6) — every required construction/runtime input is stated or refused BY NAME, never
// guessed at with a silent default. camelCase, compound names.

const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// content-address — 5 levels up from apps/graph-builder/apps/bridge-maker/lib to the tree root,
// exactly the same depth lib/decisionFreezer.js (this tree's OTHER bridge-maker/lib module) uses.
const contentAddress = require(
	path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'content-address', 'content-address'),
)();

// flattenCandidateRecord — the kit's own exported static (lib.d/sourceWalker.js). Reused here (as
// genericBridge.js did before this extraction) rather than a second copy of the same mapping; a
// pure, stateless record-shaping function, never a connection, never trips bridgeMaker's negative
// substrate scan.
const sourceWalkerModule = require(path.join(__dirname, '..', 'lib.d', 'sourceWalker'));
const flattenCandidateRecord = sourceWalkerModule.flattenCandidateRecord;

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// =====================================================================
// DEFAULT MOVE IMPLEMENTATIONS — the generic-inferred five moves, exactly as genericBridge.js
// (Phase 2/3) composed them over the kit. Each is overridable in isolation (moves.<name>).
// =====================================================================

// walk — extract a role-scoped element set for one standard, flattened. Signature:
//   ({ kit, standard, role, flatten }, callback('', { sourceNodes })) — SAME shape as kit.sourceWalker.walk.
const defaultWalkMove = ({ kit, standard, role, flatten }, callback) => {
	kit.sourceWalker.walk({ standard, role, flatten }, callback);
};

// match — resolve a matcher for this run. SYNCHRONOUS, may THROW (an unregistered matcherName is a
// recipe/tree defect — the SAME "throws, uncaught, named" contract kit.candidateFinder.find itself
// declares; genericBridge.js never wrapped this call in try/catch, and this extraction preserves
// that exactly). Signature: ({ kit, matcherName }) -> { retrieve(source, candidatePool) -> pool }.
// An OVERRIDE may ignore matcherName/kit entirely and return any object shaped { retrieve(...) }.
const defaultMatchMove = ({ kit, matcherName }) => kit.candidateFinder.find(matcherName);

// select — pick ONE candidate from an already-retrieved pool, or abstain. Signature:
//   ({ kit, source, pool }, callback('', decision)) — SAME shape as kit.selector.selectFromPool.
const defaultSelectMove = ({ kit, source, pool }, callback) => {
	kit.selector.selectFromPool(source, pool, {}, {}, callback);
};

// =====================================================================
// makeBridgeSkeleton — construction-time factory. THROWS on a wiring fault at AUTHOR time (a bridge
// built without stating its own identity is a defect in the bridge file, not a recipe error reached
// at run time) — matching every other construction-time invariant in this tree (kitLoader.buildKit,
// selector, candidateFinder all throw at construction, never three calls downstream).
// =====================================================================
const makeBridgeSkeleton = (
	{
		mappingTool,
		hubStandard,
		hubReferenceLabel = 'HubReference',
		defaultRole = 'DmeProperty',
		defaultMatcherName,
		materializerConfig = {},
		moves = {},
	} = {},
) => {
	if (typeof mappingTool !== 'string' || mappingTool.trim() === '') {
		throw new Error(
			`${moduleName}: mappingTool is not given — every bridge built on this skeleton stamps its ` +
				`own identity on every edge it materializes; there is no default.`,
		);
	}
	if (typeof hubStandard !== 'string' || hubStandard.trim() === '') {
		throw new Error(
			`${moduleName}: hubStandard is not given — a bridge built on this skeleton bridges toward ` +
				`exactly one hub, stated at construction; there is no default.`,
		);
	}
	if (!moves.match && (typeof defaultMatcherName !== 'string' || defaultMatcherName.trim() === '')) {
		throw new Error(
			`${moduleName}: defaultMatcherName is not given — the default match move dispatches a ` +
				`candidateFinder-registered matcher by name; there is no default matcher name assumed. ` +
				`(Supply moves.match instead if this bridge does not use candidateFinder dispatch at all.)`,
		);
	}
	if (!moves.materialize) {
		if (typeof materializerConfig.predicate !== 'string' || materializerConfig.predicate.trim() === '') {
			throw new Error(
				`${moduleName}: materializerConfig.predicate is not given — the default materialize move ` +
					`stamps every edge with a mapping predicate ('closeMatch', 'exactMatch', ...); there is ` +
					`no default.`,
			);
		}
		if (
			typeof materializerConfig.mappingJustification !== 'string' ||
			materializerConfig.mappingJustification.trim() === ''
		) {
			throw new Error(
				`${moduleName}: materializerConfig.mappingJustification is not given — the default ` +
					`materialize move stamps every edge with it; there is no default.`,
			);
		}
	}

	const HUB_STANDARD = hubStandard.toUpperCase();
	const walkMove = moves.walk || defaultWalkMove;
	const matchMove = moves.match || defaultMatchMove;
	const selectMove = moves.select || defaultSelectMove;

	// requiredKitMembersFor — the kit members THIS bridge instance needs, given (a) rebridge vs.
	// materialize mode and (b) which moves are overridden. Overriding a move DROPS that move's own
	// kit-member requirement — the proof the override seam is real: a bridge overriding `select`
	// never has to wire kit.selector (no llmClient needed at all). With NO overrides this reproduces
	// genericBridge's ORIGINAL two literal lists byte-for-byte (same members, same order):
	//   rebridge:    ['sourceWalker','graphReader','vectorizer','candidateFinder','selector','decisionFreezer','materializer','writer']
	//   materialize: ['sourceWalker','graphReader','decisionFreezer','materializer','writer']
	const requiredKitMembersFor = (rebridge) => {
		const list = ['sourceWalker', 'graphReader'];
		if (rebridge) {
			list.push('vectorizer');
			if (!moves.match) {
				list.push('candidateFinder');
			}
			if (!moves.select) {
				list.push('selector');
			}
		}
		if (!moves.freeze) {
			list.push('decisionFreezer');
		}
		if (!moves.materialize) {
			list.push('materializer');
		}
		list.push('writer');
		return list;
	};

	// START OF the produced BridgeModule callable ============================================

	return (injectedTools = {}) =>
		({ inGraph, hub, applyLabel }, callback) => {
			const { kit } = injectedTools;

			if (!kit || typeof kit !== 'object') {
				callback(
					`${mappingTool}: injectedTools.kit is not given — this bridge composes ONLY the injected ` +
						`lib.d kit; there is no default.`,
				);
				return;
			}
			const requiredKitMembers = requiredKitMembersFor(kit.rebridge);
			const missingKitMember = requiredKitMembers.find(
				(oneName) => kit[oneName] === undefined || kit[oneName] === null,
			);
			if (missingKitMember) {
				callback(
					`${mappingTool}: kit.${missingKitMember} is missing (kit.rebridge=${!!kit.rebridge}) — the ` +
						`injected lib.d kit did not supply it; there is no default.` +
						(missingKitMember === 'selector'
							? ` --rebridge needs a kit built with inferenceConfig.llmClient; none was injected.`
							: ''),
				);
				return;
			}
			if (!kit.decisionStore || typeof kit.decisionStore.getDecisionBlock !== 'function') {
				callback(
					`${mappingTool}: kit.decisionStore (getDecisionBlock/saveDecisionBlock) is REQUIRED — a ` +
						`frozen decision block is read from it on a plain build and written to it on ` +
						`--rebridge; there is no default.`,
				);
				return;
			}
			if (!inGraph) {
				callback(`${mappingTool}: inGraph is not given — there is no graph to read the source/${HUB_STANDARD} nodes from.`);
				return;
			}
			if (hub !== null && hub !== undefined && `${hub}`.toUpperCase() !== HUB_STANDARD) {
				callback(
					`${mappingTool}: hub is '${hub}', but this bridge bridges toward the ${HUB_STANDARD} hub only.`,
				);
				return;
			}
			if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
				callback(
					`${mappingTool}: applyLabel is ${
						applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)
					} — it is the label harvest selects the written edges by; there is no default.`,
				);
				return;
			}

			const config = kit.config || {};
			const sourceStandard = config.sourceStandard || config.source;
			if (typeof sourceStandard !== 'string' || sourceStandard.trim() === '') {
				callback(
					`${mappingTool}: config.sourceStandard is not set — the generic producer must be told ` +
						`which source standard it bridges (a generic plugin serves every pair); there is no default.`,
				);
				return;
			}
			// THE CASE RULE (see lib.d/sourceWalker.js): the recipe token is lowercase; forged `_source`
			// is uppercase. Read and stamp by the uppercase key.
			const sourceStandardKey = sourceStandard.toUpperCase();
			const subjectVersion = config.sourceVersion || '';
			const objectVersion = config.hubVersion || '';
			const role = config.role || defaultRole;
			const matcherName = config.matcherName || defaultMatcherName;
			const pairKey = `${HUB_STANDARD}::${sourceStandardKey}`;

			const readReferenceNodes = (done) => {
				kit.graphReader.readNodes({ label: hubReferenceLabel, propertyEquals: {} }, (err, out) =>
					done(
						err ? `${mappingTool}: reading ${HUB_STANDARD} ${hubReferenceLabel} nodes: ${err}` : '',
						(out || {}).nodes || [],
					),
				);
			};

			// freeze move — the injected override object (must expose { freeze, parse }) or kit.decisionFreezer.
			const freezer = moves.freeze || kit.decisionFreezer;
			// materialize move — the injected override factory or kit.materializer (the inferredIndex factory).
			const materializerFactory = moves.materialize || kit.materializer;

			// buildAndWrite — the SHARED tail of both modes: materialize the frozen picks into edges (via
			// the materialize move) and WRITE each through kit.writer. Given the same frozen decisions +
			// reference nodes it is byte-identical, so replay == rebridge (G2) regardless of which moves a
			// particular bridge overrides.
			const buildAndWrite = ({ inferredDecisions, sourceNodes, referenceNodes, decisionBlockHash }, done) => {
				const builder = materializerFactory({
					...materializerConfig,
					subjectSource: sourceStandardKey,
					subjectVersion,
					objectSource: HUB_STANDARD,
					objectVersion,
					mappingTool,
					decisionBlockHash,
				});
				const subgraph = builder.buildInferredSubgraph({ inferredDecisions, sourceNodes, referenceNodes });
				let edgesWritten = 0;
				const writeList = new taskListPlus();
				subgraph.edges.forEach((oneEdge) => {
					writeList.push((a2, n2) => {
						kit.writer(
							{
								decision: {
									fromStableId: oneEdge.fromRef.id,
									toStableId: oneEdge.toRef.id,
									relationshipType: oneEdge.type,
									properties: oneEdge.properties,
								},
								applyLabel,
							},
							(err, writeResult) => {
								if (err) {
									n2(`${mappingTool}: writing ${oneEdge.type} ${oneEdge.fromRef.id} -> ${oneEdge.toRef.id}: ${err}`);
									return;
								}
								if (writeResult && writeResult.edgeWritten) {
									edgesWritten++;
								}
								n2('', a2);
							},
						);
					});
				});
				pipeRunner(writeList.getList(), {}, (err) => {
					done(err || '', { edgesWritten, subgraph });
				});
			};

			// ================= MATERIALIZE (plain -build) — pure replay of a frozen block =================
			const runMaterialize = () => {
				kit.decisionStore.getDecisionBlock({ pairKey }, (loadErr, loaded) => {
					if (loadErr) {
						finish(`${mappingTool}: loading frozen decision block for ${pairKey}: ${loadErr}`);
						return;
					}
					const frozenText = loaded && loaded.frozenText;
					if (!frozenText) {
						// NO frozen block for this pair -> NO inferred edges. Explicit, no spend, no graph read.
						finish('', {
							edgesWritten: 0,
							decisionBlock: null,
							producer: 'inferred',
							counts: { inferred: 0, mode: 'materialize', noDecisionBlock: true },
						});
						return;
					}
					const parsed = freezer.parse(frozenText);
					if (parsed.error) {
						finish(parsed.error);
						return;
					}
					const decisionBlockHash = contentAddress.blockIdForText(frozenText);
					const taskList = new taskListPlus();
					taskList.push((args, next) =>
						walkMove({ kit, standard: sourceStandardKey, role }, (err, out) =>
							next(err, { ...args, sourceNodes: out && out.sourceNodes }),
						),
					);
					taskList.push((args, next) => readReferenceNodes((err, nodes) => next(err, { ...args, referenceNodes: nodes })));
					taskList.push((args, next) => {
						buildAndWrite(
							{ inferredDecisions: parsed.inferredDecisions, sourceNodes: args.sourceNodes, referenceNodes: args.referenceNodes, decisionBlockHash },
							(err, out) => next(err, { ...args, ...out }),
						);
					});
					pipeRunner(taskList.getList(), {}, (err, args) => {
						if (err) {
							finish(err);
							return;
						}
						finish('', {
							edgesWritten: args.edgesWritten,
							decisionBlock: decisionBlockHash,
							producer: 'inferred',
							counts: {
								inferred: args.edgesWritten,
								mode: 'materialize',
								decisionsConsidered: parsed.inferredDecisions.length,
								orphans: args.subgraph.counts.orphans,
								fromGaps: args.subgraph.counts.fromGaps,
							},
						});
					});
				});
			};

			// ================= REBRIDGE — walk -> vectorize -> match -> select -> freeze -> materialize ====
			const runRebridge = () => {
				// MATCH resolves ONCE per run (not per source) — an unregistered matcherName throws HERE,
				// uncaught, exactly as genericBridge.js's original `kit.candidateFinder.find(matcherName)`
				// did before this extraction (a tree/recipe wiring defect, never wrapped into the callback
				// channel; see defaultMatchMove's own comment).
				const matcher = matchMove({ kit, matcherName });

				const taskList = new taskListPlus();

				// WALK — the source standard's own elements, and the hub's candidate elements (role-scoped;
				// the candidate flatten also carries cedsId, the targetKey selector.selectFromPool emits).
				taskList.push((args, next) =>
					walkMove({ kit, standard: sourceStandardKey, role }, (err, out) =>
						next(err, { ...args, sourceNodes: out && out.sourceNodes }),
					),
				);
				taskList.push((args, next) =>
					walkMove({ kit, standard: HUB_STANDARD, role, flatten: flattenCandidateRecord }, (err, out) =>
						next(err, { ...args, candidateNodes: out && out.sourceNodes }),
					),
				);
				taskList.push((args, next) => readReferenceNodes((err, nodes) => next(err, { ...args, referenceNodes: nodes })));

				// VECTORIZE (NET) — embed every source + candidate defText, attach .vector in place. Fixed
				// orchestration, not a move: every kit provides this capability regardless of standard.
				taskList.push((args, next) => {
					const allRecords = args.candidateNodes.concat(args.sourceNodes);
					kit.vectorizer.batchEmbed({ texts: allRecords.map((r) => r.defText) }, (err, result) => {
						if (err) {
							next(`${mappingTool}: vectorizing defTexts: ${err}`);
							return;
						}
						allRecords.forEach((r, i) => {
							r.vector = result.vectors[i];
						});
						next('', args);
					});
				});

				// MATCH (retrieve, via the resolved matcher) + SELECT (the ONE non-deterministic step, or a
				// custom override), one source at a time.
				taskList.push((args, next) => {
					const decisions = [];
					const perSourceTask = new taskListPlus();
					args.sourceNodes.forEach((oneSource) => {
						perSourceTask.push((a2, n2) => {
							const pool = matcher.retrieve(oneSource, args.candidateNodes);
							selectMove({ kit, source: oneSource, pool }, (err, decision) => {
								if (err) {
									n2(`${mappingTool}: selecting for ${oneSource.stableId}: ${err}`);
									return;
								}
								decisions.push(decision);
								n2('', a2);
							});
						});
					});
					pipeRunner(perSourceTask.getList(), {}, (err) => next(err, { ...args, decisions }));
				});

				// FREEZE all decisions -> content-addressed block, then SAVE to the decisionStore.
				taskList.push((args, next) => {
					const frozen = freezer.freeze({
						pairStamp: { subjectSource: sourceStandardKey, subjectVersion, objectSource: HUB_STANDARD, objectVersion },
						decisions: args.decisions,
					});
					kit.decisionStore.saveDecisionBlock(
						{ pairKey, frozenText: frozen.frozenText, decisionBlockHash: frozen.decisionBlockHash },
						(err) => next(err ? `${mappingTool}: saving frozen decision block: ${err}` : '', { ...args, frozen }),
					);
				});

				// MATERIALIZE the frozen picks + WRITE.
				taskList.push((args, next) => {
					buildAndWrite(
						{
							inferredDecisions: args.frozen.inferredDecisions,
							sourceNodes: args.sourceNodes,
							referenceNodes: args.referenceNodes,
							decisionBlockHash: args.frozen.decisionBlockHash,
						},
						(err, out) => next(err, { ...args, ...out }),
					);
				});

				pipeRunner(taskList.getList(), {}, (err, args) => {
					if (err) {
						finish(err);
						return;
					}
					const abstains = args.decisions.filter((d) => d.abstain).length;
					finish('', {
						edgesWritten: args.edgesWritten,
						decisionBlock: args.frozen.decisionBlockHash,
						producer: 'inferred',
						counts: {
							inferred: args.edgesWritten,
							mode: 'rebridge',
							decisionsConsidered: args.decisions.length,
							picks: args.decisions.length - abstains,
							abstains,
							orphans: args.subgraph.counts.orphans,
							fromGaps: args.subgraph.counts.fromGaps,
						},
					});
				});
			};

			// finish — close the kit's graphReader (shared per-run instance bridgeMaker minted via
			// buildKit; this bridge is the one that decided when it was done reading, so it owns closing
			// it). The kit's writer rides on the graphWriter bridgeMaker itself closes; nothing here touches that.
			const finish = (runError, result) => {
				kit.graphReader.close((closeErr) => {
					if (runError) {
						callback(closeErr ? `${runError} (and the graph reader also failed to close: ${closeErr})` : runError);
						return;
					}
					if (closeErr) {
						callback(`${mappingTool}: produced ${result.edgesWritten} edge(s) but the graph reader failed to close: ${closeErr}`);
						return;
					}
					callback('', result);
				});
			};

			if (kit.rebridge) {
				runRebridge();
			} else {
				runMaterialize();
			}
		};

	// END OF the produced BridgeModule callable ==============================================
};

module.exports = makeBridgeSkeleton;
