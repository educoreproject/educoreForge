'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// implied-pipeline.js — full -implied Stage-2 pipeline orchestration: Stage-1 retrieve (scoped vector
// index) -> rerank (score-match composite) -> calibrate v0 (identity) -> classifyPredicate (SKOS) ->
// fan-out brake (floor + cap). Phase IV.
//
// MODE 'dryRun' (this commit): runs the WHOLE pipeline READ-ONLY and reports the calibrated-confidence
// DISTRIBUTION + projected emission at the configured floor/cap + where the known SPECIFIED pairs
// land. It writes NO edges and mutates NO graph — it exists so the FLOOR is chosen FROM the numbers,
// not guessed (calibrate v0 is identity and the scorer degrades to neutral 0.5, so the dynamic range
// is compressed and an absolute floor must be measured). The 'emit' mode (writeImpliedMapping +
// publish) is added once the floor is ruled.
//
// Reuses the Phase-I retrieve (implied-bridge: discover/ensure/retrieveForGroup) and the Phase-II/III
// pure modules. Async: qtools taskListPlus/pipeRunner; neo4j only via the injected lifecycle.
// camelCase only.

const fs = require('fs');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const impliedBridgeFactory = require('./implied-bridge');
const neighborhoodLoaderFactory = require('./neighborhood-loader');
const mappingInstructionFactory = require('./mapping-instruction');
const { scoreMatch } = require('./score-match');
const { calibrate } = require('./calibrate');
const { classifyPredicate } = require('./classify-predicate');
const { applyBrake } = require('./fanout-brake');
const defaultConfig = require('./rerank-config.json');

const toNumber = (value) => {
	if (value && typeof value === 'object' && typeof value.toNumber === 'function') {
		return value.toNumber();
	}
	return Number(value) || 0;
};

// confidence histogram bands (lower-inclusive, upper-exclusive except the last). Fine-grained across
// the decision region 0.30-0.60 so the floor can be read off the numbers.
const BANDS = [
	{ key: '[0.00-0.30)', lo: 0.0, hi: 0.3 },
	{ key: '[0.30-0.35)', lo: 0.3, hi: 0.35 },
	{ key: '[0.35-0.40)', lo: 0.35, hi: 0.4 },
	{ key: '[0.40-0.45)', lo: 0.4, hi: 0.45 },
	{ key: '[0.45-0.50)', lo: 0.45, hi: 0.5 },
	{ key: '[0.50-0.55)', lo: 0.5, hi: 0.55 },
	{ key: '[0.55-0.60)', lo: 0.55, hi: 0.6 },
	{ key: '[0.60-1.00]', lo: 0.6, hi: 1.0001 },
];
const bandOf = (value) => {
	const band = BANDS.find((b) => value >= b.lo && value < b.hi);
	return band ? band.key : '[0.00-0.30)';
};

// candidate floors to project edge/source volume for (the brake's cap is applied at each).
const FLOOR_SWEEP = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];

const EDGE_TYPE = 'IMPLIED_MAPPING';
const PROVENANCE_TIER = 'embedding-inferred';
const METHOD = 'findMappedItem-embeddingRerank-v0';

const toNum = (value) => {
	if (value && typeof value === 'object' && typeof value.toNumber === 'function') {
		return value.toNumber();
	}
	return Number(value) || 0;
};

const PREDICATES = ['exactMatch', 'closeMatch', 'broadMatch', 'narrowMatch', 'relatedMatch'];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle, config } = {}) => {
		const { xLog } = process.global;
		const cfg = config || defaultConfig;
		const impliedBridge = impliedBridgeFactory({ lifecycle });
		const neighborhoodLoader = neighborhoodLoaderFactory({ lifecycle });
		const mappingInstruction = mappingInstructionFactory({ lifecycle });

		// score one (source, candidate) pair -> calibrated confidence + SKOS predicate + the fields
		// needed to RECOMPUTE the predicate later without re-retrieval (rawScore, equivalence, basis).
		const scorePair = (sourceNode, sourceBundle, targetNode, targetBundle) => {
			const scored = scoreMatch({ sourceNode, targetNode, sourceBundle, targetBundle, config: cfg });
			const calibrated = calibrate({ rawScore: scored.confidence, config: cfg });
			const predicate = classifyPredicate({ signals: scored.signals, config: cfg });
			return {
				calibratedConfidence: calibrated.calibratedConfidence,
				rawScore: calibrated.rawScore,
				calibrationVersion: calibrated.calibrationVersion,
				matchPredicate: predicate.matchPredicate,
				equivalence: predicate.equivalence,
				predicateBasis: predicate.basis,
				signals: scored.signals,
			};
		};

		// retrieve ALL pools for the scope (per (target,role) group), self-provisioning scoped indexes.
		//   -> { poolsBySource: { srcStableId -> [ {stableId, score} ] }, sourcesConsidered }
		const retrieveAllPools = ({ graphName, scope, instruction }, callback) => {
			const taskList = new taskListPlus();

			// per-role census of uncovered mappable sources.
			taskList.push((args, next) => {
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							MATCH (src:ForgedNode)
							WHERE src._source = $scope AND src.role IN $mappableRoles
							  AND src.embedding IS NOT NULL
							  AND NOT (src)-[:SPECIFIED_MAPPING|DERIVED_MAPPING]->()
							RETURN src.role AS role, count(*) AS cnt
						`,
						params: { scope, mappableRoles: impliedBridge.MAPPABLE_ROLES },
					},
					(err, result) => {
						if (err) {
							next(`dryRun census: ${err}`);
							return;
						}
						const roleCensus = (result.records || []).map((r) => ({
							role: r.role,
							cnt: toNumber(r.cnt),
						}));
						next('', { ...args, roleCensus });
					},
				);
			});

			// build the (target,role) groups and retrieve each (collectPools).
			taskList.push((args, next) => {
				const targets = instruction.impliedTargets;
				const groups = [];
				targets.forEach((targetStandard) => {
					args.roleCensus.forEach((row) => groups.push({ targetStandard, role: row.role }));
				});
				const poolsBySource = {};
				const groupTaskList = new taskListPlus();
				groups.forEach((group) => {
					groupTaskList.push((gArgs, gNext) => {
						const { targetStandard, role } = group;
						const indexName = impliedBridge.scopedIndexName(targetStandard, role);
						const inner = new taskListPlus();
						inner.push((iArgs, iNext) => {
							impliedBridge.discoverScopingLabel({ graphName, targetStandard, role }, (err, found) => {
								if (err) {
									iNext(err);
									return;
								}
								iNext('', { ...iArgs, scopingLabels: found.scopingLabels });
							});
						});
						inner.push((iArgs, iNext) => {
							const labels = iArgs.scopingLabels;
							if (labels.length !== 1) {
								xLog.status(`[implied-pipeline] group ${targetStandard}/${role} scopingLabels=${labels.length}; skipped`);
								iNext('', iArgs);
								return;
							}
							const pr = new taskListPlus();
							pr.push((pArgs, pNext) => {
								impliedBridge.ensureScopedIndex({ graphName, indexName, scopingLabel: labels[0] }, (err) => pNext(err, pArgs));
							});
							pr.push((pArgs, pNext) => {
								impliedBridge.retrieveForGroup(
									{
										graphName,
										scope,
										targetStandard,
										role,
										indexName,
										probeK: instruction.probeK,
										candidatePoolK: instruction.candidatePoolK,
										collectPools: true,
									},
									(err, retrieved) => {
										if (err) {
											pNext(err);
											return;
										}
										retrieved.perSource.forEach((entry) => {
											poolsBySource[entry.srcStableId] = (entry.cands || []).map((c) => ({
												stableId: c.stableId,
												score: c.score,
											}));
										});
										pNext('', pArgs);
									},
								);
							});
							pipeRunner(pr.getList(), {}, (err) => iNext(err, iArgs));
						});
						pipeRunner(inner.getList(), {}, (err) => gNext(err, gArgs));
					});
				});
				pipeRunner(groupTaskList.getList(), {}, (err) => {
					if (err) {
						next(err);
						return;
					}
					const sourcesConsidered = args.roleCensus.reduce((sum, r) => sum + r.cnt, 0);
					next('', { ...args, poolsBySource, sourcesConsidered });
				});
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', { poolsBySource: args.poolsBySource, sourcesConsidered: args.sourcesConsidered });
			});
		};

		// runDryRun — { graphName, scope, outPath } -> distribution summary (NO edges).
		const runDryRun = ({ graphName, scope, outPath } = {}, callback) => {
			const floor = cfg.fanout.confidenceFloor;
			const cap = cfg.fanout.maxFanOut;
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				mappingInstruction.readForScope({ graphName, scope }, (err, resolved) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, instruction: resolved.instruction });
				});
			});

			taskList.push((args, next) => {
				retrieveAllPools({ graphName, scope, instruction: args.instruction }, (err, out) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, poolsBySource: out.poolsBySource, sourcesConsidered: out.sourcesConsidered });
				});
			});

			// bulk-load neighborhoods for all sources + every distinct candidate, ONCE.
			taskList.push((args, next) => {
				const ids = [];
				Object.keys(args.poolsBySource).forEach((srcId) => {
					ids.push(srcId);
					args.poolsBySource[srcId].forEach((c) => ids.push(c.stableId));
				});
				neighborhoodLoader.loadBundles({ graphName, stableIds: ids }, (err, loaded) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, fieldsById: loaded.fieldsById, bundleById: loaded.bundleById });
				});
			});

			// stream-score: histogram all candidate edges; project emission at floor+cap.
			taskList.push((args, next) => {
				const { poolsBySource, fieldsById, bundleById } = args;
				const histogram = {};
				BANDS.forEach((b) => {
					histogram[b.key] = 0;
				});
				const perPredicateKept = {};
				PREDICATES.forEach((p) => {
					perPredicateKept[p] = 0;
				});
				let candidateEdgeTotal = 0;
				let sourcesEmitting = 0;
				let totalEdges = 0;
				const keptForOut = [];

				// floor-sweep accumulators: projected edges/sources at each candidate floor (cap applied).
				const sweepEdges = {};
				const sweepSources = {};
				FLOOR_SWEEP.forEach((f) => {
					sweepEdges[f] = 0;
					sweepSources[f] = 0;
				});

				Object.keys(poolsBySource).forEach((srcId) => {
					const sourceNode = fieldsById[srcId] || null;
					const sourceBundle = bundleById[srcId] || null;
					const scoredCandidates = poolsBySource[srcId].map((cand) => {
						const targetNode = fieldsById[cand.stableId] || null;
						const targetBundle = bundleById[cand.stableId] || null;
						const result = scorePair(sourceNode, sourceBundle, targetNode, targetBundle);
						candidateEdgeTotal++;
						histogram[bandOf(result.calibratedConfidence)]++;
						return {
							stableId: cand.stableId,
							cosineScore: cand.score,
							calibratedConfidence: result.calibratedConfidence,
							matchPredicate: result.matchPredicate,
						};
					});
					const braked = applyBrake({ candidates: scoredCandidates, config: cfg });
					if (braked.keptCount > 0) {
						sourcesEmitting++;
						totalEdges += braked.keptCount;
						braked.kept.forEach((k) => {
							perPredicateKept[k.matchPredicate] = (perPredicateKept[k.matchPredicate] || 0) + 1;
						});
						keptForOut.push({ srcStableId: srcId, kept: braked.kept });
					}
					// floor sweep: for each candidate floor, edges = min(aboveFloor, cap).
					const confs = scoredCandidates.map((c) => c.calibratedConfidence);
					FLOOR_SWEEP.forEach((f) => {
						const above = confs.filter((v) => v >= f).length;
						const kept = Math.min(above, cap);
						if (kept > 0) {
							sweepEdges[f] += kept;
							sweepSources[f] += 1;
						}
					});
				});

				const floorSweep = FLOOR_SWEEP.map((f) => ({
					floor: f,
					projectedEdges: sweepEdges[f],
					projectedSources: sweepSources[f],
				}));

				next('', {
					...args,
					distribution: {
						floor,
						cap,
						sourcesConsidered: args.sourcesConsidered,
						candidateEdgeTotal,
						histogram,
						projectedSourcesEmitting: sourcesEmitting,
						projectedTotalEdges: totalEdges,
						projectedPerPredicate: perPredicateKept,
						floorSweep,
					},
					keptForOut,
				});
			});

			// where the known SPECIFIED pairs land (they are covered -> excluded from the pools above,
			// so probe their scoped pools directly, score the TRUE target, report).
			taskList.push((args, next) => {
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							MATCH (s)-[:SPECIFIED_MAPPING]->(t) WHERE s._source = $scope AND t._source IN $targets AND s.role = t.role
							CALL {
								WITH s, t
								CALL db.index.vector.queryNodes('forgeVec_' + t._source + '_' + s.role, toInteger($probeK), s.embedding) YIELD node, score
								WITH s, t, node, score WHERE node._source = t._source AND node.role = s.role AND node.stableId <> s.stableId
								WITH t, node ORDER BY score DESC LIMIT toInteger($poolK)
								WITH t, collect(node.stableId) AS poolIds
								RETURN [i IN range(0, size(poolIds) - 1) WHERE poolIds[i] = t.stableId][0] AS pos
							}
							RETURN s.stableId AS lif, t.stableId AS ceds, pos
						`,
						params: {
							scope,
							targets: args.instruction.impliedTargets,
							probeK: args.instruction.probeK,
							poolK: args.instruction.candidatePoolK,
						},
					},
					(err, result) => {
						if (err) {
							next(`dryRun knownPairs: ${err}`);
							return;
						}
						const records = result.records || [];
						// the known SPECIFIED sources are COVERED -> excluded from the main bundle load,
						// so load THEIR fields/bundles (source + true target) separately, or they'd score
						// against a null node.
						const knownIds = [];
						records.forEach((r) => {
							knownIds.push(r.lif);
							knownIds.push(r.ceds);
						});
						neighborhoodLoader.loadBundles({ graphName, stableIds: knownIds }, (loadErr, loaded) => {
							if (loadErr) {
								next(`dryRun knownPairs bundle load: ${loadErr}`);
								return;
							}
							const knownPairs = records.map((r) => {
								const inPool = r.pos !== null && r.pos !== undefined;
								const landing = { lif: r.lif, ceds: r.ceds, inPool, calibratedConfidence: null, matchPredicate: null, wouldEmit: false };
								if (inPool) {
									const scored = scorePair(
										loaded.fieldsById[r.lif] || null,
										loaded.bundleById[r.lif] || null,
										loaded.fieldsById[r.ceds] || null,
										loaded.bundleById[r.ceds] || null,
									);
									landing.calibratedConfidence = Math.round(scored.calibratedConfidence * 10000) / 10000;
									landing.matchPredicate = scored.matchPredicate;
									landing.wouldEmit = scored.calibratedConfidence >= args.distribution.floor;
								}
								return landing;
							});
							next('', { ...args, knownPairs });
						});
					},
				);
			});

			// optional --out: per-source kept edges (the projected emission set).
			taskList.push((args, next) => {
				if (!outPath || args.keptForOut.length === 0) {
					next('', args);
					return;
				}
				let writeError = null;
				try {
					fs.writeFileSync(outPath, JSON.stringify(args.keptForOut, null, 2));
				} catch (e) {
					writeError = e;
				}
				if (writeError) {
					next(`dryRun --out write to '${outPath}': ${writeError.message}`);
					return;
				}
				xLog.status(`[implied-pipeline] wrote projected emission (${args.keptForOut.length} sources) to ${outPath}`);
				next('', args);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					mode: 'dryRun',
					scope,
					...args.distribution,
					knownPairs: args.knownPairs,
					note: 'DRY RUN — no edges written, golden unmutated; floor to be ruled from this distribution',
				});
			});
		};

		// runEmit — { graphName, scope, owner, outPath } -> { edgesMerged, alreadyPresent, ... }.
		// Same pipeline as the dry run, but the brake-kept edges (calibratedConfidence >= floor, top
		// cap) are MERGEd as IMPLIED_MAPPING. ONLY uncovered sources are scored (the retrieve excludes
		// SPECIFIED/DERIVED), so the SPECIFIED pairs are NEVER duplicated as IMPLIED. Every edge carries
		// the full honest provenance so its uncalibrated/human-review nature is legible, plus rawScore +
		// equivalence + predicateBasis so the SKOS predicate can be RECOMPUTED later (e.g. when
		// option-set containment lands) WITHOUT re-retrieval. Run this in a BRONZE graph (a replay of
		// the golden manifest), NEVER directly into golden.
		const runEmit = ({ graphName, scope, owner, outPath } = {}, callback) => {
			const ownerStamp = `${owner || ':golden'}`;
			const floor = cfg.fanout.confidenceFloor;
			const cap = cfg.fanout.maxFanOut;
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				mappingInstruction.readForScope({ graphName, scope }, (err, resolved) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, instruction: resolved.instruction });
				});
			});

			taskList.push((args, next) => {
				retrieveAllPools({ graphName, scope, instruction: args.instruction }, (err, out) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, poolsBySource: out.poolsBySource, sourcesConsidered: out.sourcesConsidered });
				});
			});

			taskList.push((args, next) => {
				const ids = [];
				Object.keys(args.poolsBySource).forEach((srcId) => {
					ids.push(srcId);
					args.poolsBySource[srcId].forEach((c) => ids.push(c.stableId));
				});
				neighborhoodLoader.loadBundles({ graphName, stableIds: ids }, (err, loaded) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, fieldsById: loaded.fieldsById, bundleById: loaded.bundleById });
				});
			});

			// score -> brake -> collect the edges to MERGE.
			taskList.push((args, next) => {
				const { poolsBySource, fieldsById, bundleById } = args;
				const edges = [];
				let fanOutMax = 0;
				const perPredicate = {};
				Object.keys(poolsBySource).forEach((srcId) => {
					const sourceNode = fieldsById[srcId] || null;
					const sourceBundle = bundleById[srcId] || null;
					const scored = poolsBySource[srcId].map((cand) => {
						const result = scorePair(sourceNode, sourceBundle, fieldsById[cand.stableId] || null, bundleById[cand.stableId] || null);
						return {
							tgtStableId: cand.stableId,
							calibratedConfidence: result.calibratedConfidence,
							rawScore: result.rawScore,
							matchPredicate: result.matchPredicate,
							equivalence: result.equivalence,
							predicateBasis: result.predicateBasis,
							calibrationVersion: result.calibrationVersion,
						};
					});
					const braked = applyBrake({ candidates: scored, config: cfg });
					if (braked.keptCount > fanOutMax) {
						fanOutMax = braked.keptCount;
					}
					braked.kept.forEach((k) => {
						perPredicate[k.matchPredicate] = (perPredicate[k.matchPredicate] || 0) + 1;
						edges.push({
							srcStableId: srcId,
							tgtStableId: k.tgtStableId,
							confidence: k.calibratedConfidence,
							rawScore: k.rawScore,
							matchPredicate: k.matchPredicate,
							equivalence: k.equivalence,
							predicateBasis: k.predicateBasis,
							calibrationVersion: k.calibrationVersion,
						});
					});
				});
				next('', { ...args, edges, fanOutMax, perPredicate });
			});

			// UNWIND-batch MERGE (specified-bridge pattern). ON CREATE SET all provenance; idempotent.
			taskList.push((args, next) => {
				if (args.edges.length === 0) {
					next('', { ...args, newlyCreated: 0 });
					return;
				}
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							UNWIND $edges AS edge
							MATCH (from {stableId: edge.srcStableId})
							MATCH (to   {stableId: edge.tgtStableId})
							MERGE (from)-[r:${EDGE_TYPE}]->(to)
							ON CREATE SET
								r.confidence = edge.confidence,
								r.rawScore = edge.rawScore,
								r.matchPredicate = edge.matchPredicate,
								r.equivalence = edge.equivalence,
								r.predicateBasis = edge.predicateBasis,
								r.calibrationVersion = edge.calibrationVersion,
								r.method = $method,
								r.provenanceTier = $provenanceTier,
								r.owner = $owner
							RETURN count(r) AS touched
						`,
						params: {
							edges: args.edges,
							method: METHOD,
							provenanceTier: PROVENANCE_TIER,
							owner: ownerStamp,
						},
					},
					(err, result) => {
						if (err) {
							next(`implied emit MERGE: ${err}`);
							return;
						}
						const created =
							result.summary &&
							result.summary.counters &&
							typeof result.summary.counters.updates === 'function'
								? toNum(result.summary.counters.updates().relationshipsCreated)
								: 0;
						next('', { ...args, newlyCreated: created });
					},
				);
			});

			// optional --out: the full emitted edge set.
			taskList.push((args, next) => {
				if (!outPath || args.edges.length === 0) {
					next('', args);
					return;
				}
				let writeError = null;
				try {
					fs.writeFileSync(outPath, JSON.stringify(args.edges, null, 2));
				} catch (e) {
					writeError = e;
				}
				if (writeError) {
					next(`emit --out write to '${outPath}': ${writeError.message}`);
					return;
				}
				xLog.status(`[implied-pipeline] wrote ${args.edges.length} emitted edge(s) to ${outPath}`);
				next('', args);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					mode: 'emit',
					scope,
					owner: ownerStamp,
					graphName,
					floor,
					cap,
					sourcesConsidered: args.sourcesConsidered,
					edgesMerged: args.newlyCreated,
					alreadyPresent: args.edges.length - args.newlyCreated,
					edgesAttempted: args.edges.length,
					fanOutMax: args.fanOutMax,
					perPredicate: args.perPredicate,
					provenanceTier: PROVENANCE_TIER,
					calibrationVersion: cfg.calibration.version,
					method: METHOD,
					note: 'IMPLIED_MAPPING emitted (uncovered sources only; floor+cap applied). PROVISIONAL floor; uncalibrated-v0; option-set containment deferred (predicates are equivalence-band exact/close/related only).',
				});
			});
		};

		return { runDryRun, runEmit, scorePair, retrieveAllPools };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
