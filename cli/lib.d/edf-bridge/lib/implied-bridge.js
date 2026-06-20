'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// implied-bridge.js — the -implied mode of bridgeMaker (helpSpec, DESIGN §F; SPEC-findMappedItem).
//
// findMappedItem: hybrid retrieve -> rerank -> calibrated emit. Runs LAST, only on scope items NOT
// already covered by a SPECIFIED_MAPPING or DERIVED_MAPPING edge (it calibrates on, and skips, what
// the deterministic tiers already covered).
//
// PHASE I (this file): Stage-1 RETRIEVE rebuilt onto the Neo4j vector index. It emits NO edges — it
// proves bounded, target-scoped candidate retrieval and reports a compact distribution. Stages 2-4
// (rerank / classifyPredicate / calibrate / emit) are built in later phases.
//
// WHY TARGET-STANDARD-SCOPED INDEXES (the load-bearing design, OBSIDIAN_FLAME ruling 2026-06-19):
//   The golden's `golden_vector` index is GLOBAL (every ForgedNode across every standard). voyage-4
//   embeddings CLUSTER BY AUTHORING-STANDARD, so a source standard's nearest neighbors are
//   overwhelmingly its OWN siblings — a global index STARVES cross-standard retrieval (a probe of 40
//   gave a candidate pool to only 25% of LIF sources; classes got zero). The faithful fix (what
//   trackA actually relied on) is a TARGET-STANDARD-SCOPED vector index, so the index's top-K are the
//   target standard by CONSTRUCTION. We build one vector index per (targetStandard, role) on the
//   target's existing scoping label (e.g. CedsProperty for (CEDS, DmeProperty)) — INDEX-ONLY (no node
//   writes), so golden content == replay is preserved and nothing re-embeds. Coverage -> 100%.
//
// GENERIC (no per-standard code; DECISIONS §12): the scoping label is DISCOVERED from the graph (the
// node's non-Dme*, non-ForgedNode, non-graphName label), the index NAME is derived by convention
// `forgeVec_<targetStandard>_<role>`, and per-standard knobs (impliedTargets, includeInImplied,
// probeK, candidatePoolK) arrive as DATA on the scope standard's mappingInstruction. There is no CEDS
// literal anywhere here, and `_source` is matched EXACTLY (no toLower).
//
// Async style: qtools taskListPlus/pipeRunner; neo4j resolves at the leaf via lifecycle.runCypher. No
// async/await, no try/catch-for-control-flow, no Promises surfaced. camelCase only.

const fs = require('fs');
const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const mappingInstructionFactory = require('./mapping-instruction');

const EDGE_TYPE = 'IMPLIED_MAPPING';
const PROVENANCE_TIER = 'embedding-inferred';

// The canonical role labels are the universal contract (DECISIONS §6). The implied pass maps
// STRUCTURAL roles only — never DmeStandardRoot (a standard root is not a mappable element) and never
// DmeSupport. Compatible-role matching is role EQUALITY (src.role == target.role), which subsumes the
// per-role examples in the brief without any hardcoded per-role branch.
const MAPPABLE_ROLES = ['DmeClass', 'DmeProperty', 'DmeOptionSet', 'DmeOptionValue'];

// Scoped vector index naming convention — generic over (targetStandard, role); NEVER a CEDS literal.
const INDEX_NAME_PREFIX = 'forgeVec';
const scopedIndexName = (targetStandard, role) => `${INDEX_NAME_PREFIX}_${targetStandard}_${role}`;

// Mirror golden_vector's COSINE similarity. The dimensionality is DISCOVERED from a sample target
// node's embedding at provision time (not a magic number) — it equals golden's 1024 for voyage-4
// (DECISIONS §5) but stays correct if a standard's embedding width ever differs.
const SIMILARITY_FUNCTION = 'cosine';

// Index-online wait (a freshly created index on a fresh bronze graph populates asynchronously; on
// golden the index already exists ONLINE and IF NOT EXISTS makes creation a no-op).
const INDEX_ONLINE_TIMEOUT_MS = 180000;
const INDEX_POLL_MS = 1000;

const toNumber = (value) => {
	if (value && typeof value === 'object' && typeof value.toNumber === 'function') {
		return value.toNumber();
	}
	return Number(value) || 0;
};

const round2 = (value) => Math.round(value * 100) / 100;

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle } = {}) => {
		const { xLog } = process.global;
		const mappingInstruction = mappingInstructionFactory({ lifecycle });

		// discoverScopingLabel — the single label that scopes (targetStandard, role): a sample node's
		// label that is NOT a role label (Dme*), NOT ForgedNode, NOT an OWNER-stamp label (golden/user
		// — the universal :golden/:user ownership stamp, present on every replayed node and distinct
		// from the graph NAME, e.g. a bronze graph's nodes still carry the 'golden' owner label), and
		// NOT the graph-name label. For (CEDS, DmeProperty) that is 'CedsProperty'. Returns
		// { scopingLabels } so the caller decides:
		// exactly one -> use it; zero -> the target has no node of that role (skip the group); more
		// than one -> an IRREGULAR target (e.g. LIF's LifComposite/LifEntity for DmeClass) which this
		// phase does NOT silently guess on — the caller surfaces it as an error.
		const discoverScopingLabel = ({ graphName, targetStandard, role }, callback) => {
			lifecycle.runCypher(
				{
					graphName,
					cypher: `
						MATCH (n:ForgedNode)
						WHERE n._source = $targetStandard AND n.role = $role
						WITH labels(n) AS ls
						LIMIT 1
						RETURN [l IN ls WHERE NOT l STARTS WITH 'Dme' AND l <> 'ForgedNode' AND NOT l IN ['golden','user'] AND l <> $graphName] AS scopingLabels
					`,
					params: { targetStandard, role, graphName },
				},
				(err, result) => {
					if (err) {
						callback(`discoverScopingLabel(${targetStandard},${role}): ${err}`);
						return;
					}
					if (!result.records || result.records.length === 0) {
						callback('', { scopingLabels: [] });
						return;
					}
					callback('', { scopingLabels: result.records[0].scopingLabels || [] });
				},
			);
		};

		// waitIndexOnline — poll SHOW VECTOR INDEXES until the named index is ONLINE (or FAILED/timeout).
		// setTimeout is callback-style polling (not async/await); mirrors instance-lifecycle's readiness wait.
		const waitIndexOnline = ({ graphName, indexName, deadline }, callback) => {
			const probe = () => {
				lifecycle.runCypher(
					{ graphName, cypher: 'SHOW VECTOR INDEXES YIELD name, state RETURN name, state' },
					(err, result) => {
						if (err) {
							callback(`waitIndexOnline(${indexName}): ${err}`);
							return;
						}
						const row = (result.records || []).find((record) => record.name === indexName);
						const state = row ? row.state : null;
						if (state === 'ONLINE') {
							callback('');
							return;
						}
						if (state === 'FAILED') {
							callback(`waitIndexOnline(${indexName}): index state FAILED`);
							return;
						}
						if (Date.now() >= deadline) {
							callback(`waitIndexOnline(${indexName}): timed out (state=${state})`);
							return;
						}
						setTimeout(probe, INDEX_POLL_MS);
					},
				);
			};
			probe();
		};

		// ensureScopedIndex — idempotent CREATE VECTOR INDEX ... IF NOT EXISTS on the scoping label,
		// then wait until ONLINE. Self-provisioning so -implied works on bronze/dev/golden alike.
		const ensureScopedIndex = ({ graphName, indexName, scopingLabel }, callback) => {
			const taskList = new taskListPlus();

			// discover the embedding dimensionality from a sample node (dimension-agnostic, no magic
			// number). A scoping-label node with no embedding is a real data fault — surface it.
			taskList.push((args, next) => {
				lifecycle.runCypher(
					{
						graphName,
						cypher: `MATCH (n:\`${scopingLabel}\`) WHERE n.embedding IS NOT NULL RETURN size(n.embedding) AS dims LIMIT 1`,
						params: {},
					},
					(err, result) => {
						if (err) {
							next(`ensureScopedIndex dims(${scopingLabel}): ${err}`);
							return;
						}
						if (!result.records || result.records.length === 0) {
							next(
								`ensureScopedIndex: no '${scopingLabel}' node carries an embedding — cannot size the scoped index`,
							);
							return;
						}
						next('', { ...args, dims: toNumber(result.records[0].dims) });
					},
				);
			});

			taskList.push((args, next) => {
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							CREATE VECTOR INDEX \`${indexName}\` IF NOT EXISTS
							FOR (n:\`${scopingLabel}\`) ON (n.embedding)
							OPTIONS {indexConfig: {\`vector.dimensions\`: ${args.dims}, \`vector.similarity_function\`: '${SIMILARITY_FUNCTION}'}}
						`,
						params: {},
					},
					(err) => next(err, args),
				);
			});

			taskList.push((args, next) => {
				waitIndexOnline(
					{ graphName, indexName, deadline: Date.now() + INDEX_ONLINE_TIMEOUT_MS },
					(err) => next(err, args),
				);
			});

			pipeRunner(taskList.getList(), {}, (err) => callback(err));
		};

		// retrieveForGroup — for ALL uncovered scope sources of one role, query the SCOPED target index
		// and keep the top candidatePoolK by cosine. ONE round-trip (correlated subquery), bounded —
		// no in-memory cross-product, one index probe per source. EXACT _source + role filter
		// (redundant-but-safe atop a scoped index; no toLower, no literals). Drops self.
		//   -> { perSource: [ { srcStableId, candCount, cands? } ] }   (cands present only when collectPools)
		const retrieveForGroup = (
			{ graphName, scope, targetStandard, role, indexName, probeK, candidatePoolK, collectPools },
			callback,
		) => {
			const candsReturn = collectPools
				? 'collect({stableId: node.stableId, score: score}) AS cands'
				: '[] AS cands';
			lifecycle.runCypher(
				{
					graphName,
					cypher: `
						MATCH (src:ForgedNode)
						WHERE src._source = $scope AND src.role = $role AND src.embedding IS NOT NULL
						  AND NOT (src)-[:SPECIFIED_MAPPING|DERIVED_MAPPING]->()
						CALL {
							WITH src
							CALL db.index.vector.queryNodes($indexName, toInteger($probeK), src.embedding)
								YIELD node, score
							WHERE node._source = $targetStandard AND node.role = $role
							  AND node.stableId <> src.stableId
							WITH node, score
							ORDER BY score DESC
							LIMIT toInteger($candidatePoolK)
							RETURN count(node) AS candCount, ${candsReturn}
						}
						RETURN src.stableId AS srcStableId, candCount, cands
					`,
					params: { scope, role, targetStandard, indexName, probeK, candidatePoolK },
				},
				(err, result) => {
					if (err) {
						callback(`retrieveForGroup(${targetStandard},${role}): ${err}`);
						return;
					}
					const perSource = (result.records || []).map((record) => ({
						srcStableId: record.srcStableId,
						candCount: toNumber(record.candCount),
						cands: collectPools
							? (record.cands || []).map((candidate) => ({
									stableId: candidate.stableId,
									score: toNumber(candidate.score),
								}))
							: undefined,
					}));
					callback('', { perSource });
				},
			);
		};

		// bridge — { graphName, scope, owner, outPath } ->
		//   { scope, sourcesConsidered, candidatesRetrieved, sourcesWithCandidates, sourcesZero,
		//     perSourceAvg, perSourceMax, edgesMerged:0, note }
		const bridge = ({ graphName, scope, owner, outPath } = {}, callback) => {
			const taskList = new taskListPlus();

			// 1. read the scope's mappingInstruction (generic data: impliedTargets, includeInImplied,
			//    probeK, candidatePoolK — all with documented defaults).
			taskList.push((args, next) => {
				mappingInstruction.readForScope({ graphName, scope }, (err, resolved) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, instruction: resolved.instruction });
				});
			});

			// 2. per-role census of the UNCOVERED, mappable scope sources (defines sourcesConsidered and
			//    the set of (target,role) groups to retrieve). includeInImplied=false opts the standard out.
			taskList.push((args, next) => {
				if (!args.instruction.includeInImplied) {
					xLog.status(
						`[implied-bridge] scope '${scope}' opts out of implied (includeInImplied=false); skipping`,
					);
					next('', { ...args, roleCensus: [], optedOut: true });
					return;
				}
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
						params: { scope, mappableRoles: MAPPABLE_ROLES },
					},
					(err, result) => {
						if (err) {
							next(`implied source census: ${err}`);
							return;
						}
						const roleCensus = (result.records || []).map((record) => ({
							role: record.role,
							cnt: toNumber(record.cnt),
						}));
						next('', { ...args, roleCensus, optedOut: false });
					},
				);
			});

			// 3. for each (target, role) group: discover the scoping label, self-provision the scoped
			//    index, run the bounded retrieve. Accumulate per-source candidate counts. Sequential
			//    over groups (a handful: |impliedTargets| x |roles present|), each group ONE round-trip.
			taskList.push((args, next) => {
				if (args.optedOut) {
					next('', { ...args, perSourceCounts: {}, perSourcePools: [] });
					return;
				}
				const targets = args.instruction.impliedTargets;
				const probeK = args.instruction.probeK;
				const candidatePoolK = args.instruction.candidatePoolK;
				const collectPools = !!outPath;

				const groups = [];
				targets.forEach((targetStandard) => {
					args.roleCensus.forEach((censusRow) => {
						groups.push({ targetStandard, role: censusRow.role });
					});
				});

				const perSourceCounts = {};
				const perSourcePools = [];

				const groupTaskList = new taskListPlus();
				groups.forEach((group) => {
					groupTaskList.push((gArgs, gNext) => {
						const { targetStandard, role } = group;
						const indexName = scopedIndexName(targetStandard, role);
						const innerTaskList = new taskListPlus();

						// discover the scoping label for this (target, role).
						innerTaskList.push((iArgs, iNext) => {
							discoverScopingLabel({ graphName, targetStandard, role }, (err, found) => {
								if (err) {
									iNext(err);
									return;
								}
								iNext('', { ...iArgs, scopingLabels: found.scopingLabels });
							});
						});

						// provision + retrieve (or skip when the target has no node of this role).
						innerTaskList.push((iArgs, iNext) => {
							const labels = iArgs.scopingLabels;
							if (labels.length === 0) {
								xLog.status(
									`[implied-bridge] target '${targetStandard}' has no '${role}' node — no scoped index, group skipped (its sources retrieve 0)`,
								);
								iNext('', iArgs);
								return;
							}
							if (labels.length > 1) {
								iNext(
									`[implied-bridge] target '${targetStandard}' role '${role}' is IRREGULAR — ${labels.length} scoping labels (${labels.join(', ')}); a single (standard,role) scoping label is required for a scoped index. This phase does not guess; see the deferred regular-scoping-label work.`,
								);
								return;
							}
							const scopingLabel = labels[0];

							const provideAndRetrieve = new taskListPlus();
							provideAndRetrieve.push((pArgs, pNext) => {
								ensureScopedIndex({ graphName, indexName, scopingLabel }, (err) =>
									pNext(err, pArgs),
								);
							});
							provideAndRetrieve.push((pArgs, pNext) => {
								retrieveForGroup(
									{
										graphName,
										scope,
										targetStandard,
										role,
										indexName,
										probeK,
										candidatePoolK,
										collectPools,
									},
									(err, retrieved) => {
										if (err) {
											pNext(err);
											return;
										}
										retrieved.perSource.forEach((entry) => {
											perSourceCounts[entry.srcStableId] =
												(perSourceCounts[entry.srcStableId] || 0) + entry.candCount;
											if (collectPools) {
												perSourcePools.push({
													srcStableId: entry.srcStableId,
													targetStandard,
													role,
													cands: entry.cands,
												});
											}
										});
										pNext('', pArgs);
									},
								);
							});
							pipeRunner(provideAndRetrieve.getList(), {}, (err) => iNext(err, iArgs));
						});

						pipeRunner(innerTaskList.getList(), {}, (err) => gNext(err, gArgs));
					});
				});

				pipeRunner(groupTaskList.getList(), {}, (err) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, perSourceCounts, perSourcePools });
				});
			});

			// 4. optional --out dump of the (large) per-source candidate pools; stdout stays compact.
			taskList.push((args, next) => {
				if (!outPath || args.perSourcePools.length === 0) {
					next('', args);
					return;
				}
				// fs.writeFileSync can throw on a bad path — a genuine operator fault, surface it.
				let writeError = null;
				try {
					fs.writeFileSync(outPath, JSON.stringify(args.perSourcePools, null, 2));
				} catch (fsErr) {
					writeError = fsErr;
				}
				if (writeError) {
					next(`implied --out write to '${outPath}': ${writeError.message}`);
					return;
				}
				xLog.status(
					`[implied-bridge] wrote ${args.perSourcePools.length} per-source candidate pool(s) to ${outPath}`,
				);
				next('', args);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				const sourcesConsidered = args.optedOut
					? 0
					: args.roleCensus.reduce((sum, row) => sum + row.cnt, 0);
				const counts = Object.keys(args.perSourceCounts).map((key) => args.perSourceCounts[key]);
				const candidatesRetrieved = counts.reduce((sum, value) => sum + value, 0);
				const sourcesWithCandidates = counts.filter((value) => value > 0).length;
				const sourcesZero = sourcesConsidered - sourcesWithCandidates;
				const perSourceMax = counts.length > 0 ? Math.max(...counts) : 0;
				const perSourceAvg =
					sourcesConsidered > 0 ? round2(candidatesRetrieved / sourcesConsidered) : 0;

				xLog.status(
					`[implied-bridge] Stage-1 retrieve (scoped vector index): scope '${scope}' ${sourcesConsidered} uncovered source(s) -> ${candidatesRetrieved} candidate(s); ${sourcesWithCandidates} with pool, ${sourcesZero} zero. NO edges emitted (Phase I).`,
				);

				callback('', {
					scope,
					sourcesConsidered,
					candidatesRetrieved,
					sourcesWithCandidates,
					sourcesZero,
					perSourceAvg,
					perSourceMax,
					edgesMerged: 0,
					note: args.optedOut
						? 'includeInImplied=false — scope opts out of the implied pass; no retrieve, no edges'
						: 'Phase I: Stage-1 retrieve on target-standard-scoped vector indexes; no edges emitted (Stage-2 rerank/calibrate/emit not built)',
				});
			});
		};

		return {
			bridge,
			discoverScopingLabel,
			ensureScopedIndex,
			retrieveForGroup,
			scopedIndexName,
			MAPPABLE_ROLES,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
