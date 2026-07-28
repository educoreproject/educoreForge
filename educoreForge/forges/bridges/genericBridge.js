'use strict';

// genericBridge — the REAL generic INFERRED bridge (bridgeKitRefactor_072726 design §1/§4.3, spec
// Phase 2). It REPLACES the P0 placeholder that used to live at bridge-maker/bridges/genericBridge.js
// (deleted alongside this file's creation — a bridge name must resolve to exactly ONE file across
// bridgeMaker's search path, so the old library-scope stub could not coexist with this one). It lives
// in the FORGES-SHARED scope (forges/bridges/) and is resolved BY NAME through bridgeMaker's
// three-directory search path (bridgeMaker.js resolveBridgePlugin) exactly like every other bridge —
// nothing special-cases it (design_bridgeResolution_072526).
//
// THE BRIDGE CONTRACT (interfaces.js @interface BridgeModule / BRIDGE_MODULE_SHAPE):
//   bridgeModule({ ...injected library, kit })({ inGraph, hub, applyLabel }, cb)
//       -> cb('', { edgesWritten, counts, decisionBlock })
//
// COMPOSES injectedTools.kit EXCLUSIVELY (bridgeMaker's ADDITIVE lib.d kit, bridgeKitRefactor_072726
// Phase 1 built the kit, Phase 2 wires bridgeMaker.run() to inject it alongside the old flat
// component library). This bridge reads NONE of the flat library's members (relationshipWriter,
// inferencePipeline, inferredIndex, graphReader-the-factory, ...) that the three pre-existing bridges
// (ctdlAuthoredBridge, ctdlFamilyStructure, semanticBridge) still compose — the kit is the ONLY
// substrate it touches, and every write travels through kit.writer (the SAME guarded relationshipWriter
// wrapped by lib.d/writer.js), never a raw connection (the shape gate's substrate scan, bridgeMaker.js).
//
// THE FIVE-MOVE LOOP (design §4.3), BOTH modes:
//   REBRIDGE (kit.rebridge truthy):
//     sourceWalker -> vectorizer -> semanticMatcher (via candidateFinder) -> selector -> decisionFreezer
//     -> decisionStore.save -> materializer -> writer
//   MATERIALIZE (kit.rebridge falsy — a plain build, ZERO LLM):
//     decisionStore.load -> materializer -> writer
// This is byte-for-byte the shape semanticBridge.js already proves out (P3a) — genericBridge is the
// SAME moves, composed over the kit's decomposed modules instead of the fused inferencePipeline.
//
// SCOPE — a deliberate Phase-2 boundary, stated here rather than left implicit. genericBridge composes
// ONE role/tier per pair (config.role, default 'DmeProperty') — everything the LIF pilot (design §1,
// "the simplest standard: inferred-only, no authored crosswalk, no structural family") needs. It does
// NOT reproduce semanticBridge's CTDL-specific DmeOptionValue VALUE-TIER scoping (lib/valueScope.js,
// ported from edf-inferred -emit --tier=value) — that is bespoke CTDL logic living where it always
// has, not a generic capability, and stays in semanticBridge until a standard needing it is migrated
// onto a purpose-built extension of this skeleton (spec §6 Phase 4/5). The Phase-2 equivalence gate
// (test/test-generic-bridge-equivalence.js) proves genericBridge against semanticBridge over a
// PROPERTY-TIER-ONLY fixture (no DmeOptionValue nodes at all), where the two bridges' behavior is, by
// design, identical.
//
// HUB — a deliberate Phase-2 parity choice. Like semanticBridge, this bridge bridges toward CEDS only
// (HUB_STANDARD hardcoded below). Generalizing to an arbitrary `hub` argument is a genuine capability
// this bridge does not yet have — no recipe exercises a second hub today — and is left to the
// skeleton-extraction phase (spec §6 Phase 4) rather than invented ahead of a real second hub.
//
// House style: qtools curried moduleFunction; callback(errString, result) with '' on success; no
// async/await or try/catch for control flow; registry-over-switch (candidateFinder dispatches the
// recipe's matcher-name token, open item O3); compound names.

const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const contentAddress = require(
	path.join(__dirname, '..', '..', 'lib', 'content-address', 'content-address'),
)();

// flattenCandidateRecord — the kit's OWN exported static (lib.d/sourceWalker.js), reused here rather
// than a fourth duplicate copy of the same 8-line mapping (sourceWalker.js already documents itself as
// a byte-for-byte copy of semanticBridge's inline helper — this is that SAME function, not a new one).
// Requiring it does not reach around the kit's substrate: it is a pure, stateless record-shaping
// function, never a connection, and never trips the shape gate's negative substrate scan.
const sourceWalkerModule = require(
	path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib.d', 'sourceWalker'),
);
const flattenCandidateRecord = sourceWalkerModule.flattenCandidateRecord;

const HUB_STANDARD = 'CEDS';
const HUB_REFERENCE_LABEL = 'HubReference';
const DEFAULT_ROLE = 'DmeProperty';
const DEFAULT_MATCHER_NAME = 'semanticDefText';
const MAPPING_TOOL = 'genericBridge';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	(injectedTools = {}) =>
	({ inGraph, hub, applyLabel }, callback) => {
		const { kit } = injectedTools;

		// EVERY kit member this bridge composes is stated, or it does not run (polyArch2 §6). A
		// missing kit — an old-style resolver double standing in with no `.kit` at all, or a kit built
		// without a selector because no llmClient was injected for a --rebridge run — is a wiring
		// fault, named, never a silent no-op.
		if (!kit || typeof kit !== 'object') {
			callback(
				`${moduleName}: injectedTools.kit is not given — this bridge composes ONLY the lib.d kit ` +
					`(bridgeMaker.buildKit, injected alongside the flat library); there is no default.`,
			);
			return;
		}
		const requiredKitMembers = kit.rebridge
			? ['sourceWalker', 'graphReader', 'vectorizer', 'candidateFinder', 'selector', 'decisionFreezer', 'materializer', 'writer']
			: ['sourceWalker', 'graphReader', 'decisionFreezer', 'materializer', 'writer'];
		const missingKitMember = requiredKitMembers.find((oneName) => kit[oneName] === undefined || kit[oneName] === null);
		if (missingKitMember) {
			callback(
				`${moduleName}: kit.${missingKitMember} is missing (kit.rebridge=${!!kit.rebridge}) — the ` +
					`injected lib.d kit did not supply it; there is no default.` +
					(missingKitMember === 'selector'
						? ` --rebridge needs a kit built with inferenceConfig.llmClient; none was injected.`
						: ''),
			);
			return;
		}
		if (!kit.decisionStore || typeof kit.decisionStore.getDecisionBlock !== 'function') {
			callback(
				`${moduleName}: kit.decisionStore (getDecisionBlock/saveDecisionBlock) is REQUIRED — a ` +
					`frozen decision block is read from it on a plain build and written to it on --rebridge; ` +
					`there is no default.`,
			);
			return;
		}
		if (!inGraph) {
			callback(`${moduleName}: inGraph is not given — there is no graph to read the source/${HUB_STANDARD} nodes from.`);
			return;
		}
		if (hub !== null && hub !== undefined && `${hub}`.toUpperCase() !== HUB_STANDARD) {
			callback(
				`${moduleName}: hub is '${hub}', but this generic inferred bridge bridges toward the ` +
					`${HUB_STANDARD} hub only (Phase-2 parity with semanticBridge; see header).`,
			);
			return;
		}
		if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
			callback(
				`${moduleName}: applyLabel is ${
					applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)
				} — it is the label harvest selects the written edges by; there is no default.`,
			);
			return;
		}

		const config = kit.config || {};
		const sourceStandard = config.sourceStandard || config.source;
		if (typeof sourceStandard !== 'string' || sourceStandard.trim() === '') {
			callback(
				`${moduleName}: config.sourceStandard is not set — the generic producer must be told which ` +
					`source standard it bridges (a generic plugin serves every pair); there is no default.`,
			);
			return;
		}
		// THE CASE RULE (see lib.d/sourceWalker.js): the recipe token is lowercase ('lif'); forged
		// `_source` is uppercase ('LIF'). Read and stamp by the uppercase key, exactly as semanticBridge
		// does for its 'CTDL' literal.
		const sourceStandardKey = sourceStandard.toUpperCase();
		const subjectVersion = config.sourceVersion || '';
		const objectVersion = config.hubVersion || '';
		const role = config.role || DEFAULT_ROLE;
		const matcherName = config.matcherName || DEFAULT_MATCHER_NAME;
		const pairKey = `${HUB_STANDARD}::${sourceStandardKey}`;

		const readReferenceNodes = (done) => {
			kit.graphReader.readNodes({ label: HUB_REFERENCE_LABEL, propertyEquals: {} }, (err, out) =>
				done(err ? `${moduleName}: reading ${HUB_STANDARD} HubReference nodes: ${err}` : '', (out || {}).nodes || []),
			);
		};

		// buildAndWrite — the SHARED tail of both modes: materialize the frozen picks into CLOSE_MATCH
		// edges (pure, via kit.materializer, stamped with decisionBlockHash) and WRITE each through
		// kit.writer. Given the same frozen decisions + reference nodes it is byte-identical, so replay
		// == rebridge (G2) — the SAME invariant semanticBridge.buildAndWrite proves, composed over the
		// kit instead of the flat library.
		const buildAndWrite = ({ inferredDecisions, sourceNodes, referenceNodes, decisionBlockHash }, done) => {
			const builder = kit.materializer({
				predicate: 'closeMatch',
				mappingJustification: 'semapv:SemanticSimilarity',
				subjectSource: sourceStandardKey,
				subjectVersion,
				objectSource: HUB_STANDARD,
				objectVersion,
				mappingTool: MAPPING_TOOL,
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
								n2(`${moduleName}: writing ${oneEdge.type} ${oneEdge.fromRef.id} -> ${oneEdge.toRef.id}: ${err}`);
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
					finish(`${moduleName}: loading frozen decision block for ${pairKey}: ${loadErr}`);
					return;
				}
				const frozenText = loaded && loaded.frozenText;
				if (!frozenText) {
					// NO frozen block for this pair -> NO inferred edges (design §5.5). Explicit, no spend,
					// no graph read at all — mirrors semanticBridge.runMaterialize exactly.
					finish('', {
						edgesWritten: 0,
						decisionBlock: null,
						producer: 'inferred',
						counts: { inferred: 0, mode: 'materialize', noDecisionBlock: true },
					});
					return;
				}
				const parsed = kit.decisionFreezer.parse(frozenText);
				if (parsed.error) {
					finish(parsed.error);
					return;
				}
				const decisionBlockHash = contentAddress.blockIdForText(frozenText);
				const taskList = new taskListPlus();
				taskList.push((args, next) =>
					kit.sourceWalker.walk({ standard: sourceStandardKey, role }, (err, out) =>
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
			const matcher = kit.candidateFinder.find(matcherName);
			const taskList = new taskListPlus();

			// WALK — the source standard's own elements, and the hub's candidate elements (role-scoped;
			// the candidate flatten also carries cedsId, the targetKey selector.selectFromPool emits).
			taskList.push((args, next) =>
				kit.sourceWalker.walk({ standard: sourceStandardKey, role }, (err, out) =>
					next(err, { ...args, sourceNodes: out && out.sourceNodes }),
				),
			);
			taskList.push((args, next) =>
				kit.sourceWalker.walk({ standard: HUB_STANDARD, role, flatten: flattenCandidateRecord }, (err, out) =>
					next(err, { ...args, candidateNodes: out && out.sourceNodes }),
				),
			);
			taskList.push((args, next) => readReferenceNodes((err, nodes) => next(err, { ...args, referenceNodes: nodes })));

			// VECTORIZE (NET) — embed every source + candidate defText, attach .vector in place.
			taskList.push((args, next) => {
				const allRecords = args.candidateNodes.concat(args.sourceNodes);
				kit.vectorizer.batchEmbed({ texts: allRecords.map((r) => r.defText) }, (err, result) => {
					if (err) {
						next(`${moduleName}: vectorizing defTexts: ${err}`);
						return;
					}
					allRecords.forEach((r, i) => {
						r.vector = result.vectors[i];
					});
					next('', args);
				});
			});

			// MATCH (candidateFinder-dispatched semanticMatcher) + SELECT (the ONE non-deterministic
			// step), one source at a time.
			taskList.push((args, next) => {
				const decisions = [];
				const perSourceTask = new taskListPlus();
				args.sourceNodes.forEach((oneSource) => {
					perSourceTask.push((a2, n2) => {
						const pool = matcher.retrieve(oneSource, args.candidateNodes);
						kit.selector.selectFromPool(oneSource, pool, {}, {}, (err, decision) => {
							if (err) {
								n2(`${moduleName}: selecting for ${oneSource.stableId}: ${err}`);
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
				const frozen = kit.decisionFreezer.freeze({
					pairStamp: { subjectSource: sourceStandardKey, subjectVersion, objectSource: HUB_STANDARD, objectVersion },
					decisions: args.decisions,
				});
				kit.decisionStore.saveDecisionBlock(
					{ pairKey, frozenText: frozen.frozenText, decisionBlockHash: frozen.decisionBlockHash },
					(err) => next(err ? `${moduleName}: saving frozen decision block: ${err}` : '', { ...args, frozen }),
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
		// it — the same local-ownership pattern semanticBridge applies to its own reader instance).
		// The kit's writer rides on the graphWriter bridgeMaker itself closes; nothing here touches that.
		const finish = (runError, result) => {
			kit.graphReader.close((closeErr) => {
				if (runError) {
					callback(closeErr ? `${runError} (and the graph reader also failed to close: ${closeErr})` : runError);
					return;
				}
				if (closeErr) {
					callback(`${moduleName}: produced ${result.edgesWritten} edge(s) but the graph reader failed to close: ${closeErr}`);
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

// END OF moduleFunction() ============================================================

module.exports = moduleFunction;
