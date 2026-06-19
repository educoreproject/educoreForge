'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// specified-bridge.js — the -specified mode of bridgeMaker (helpSpec, DESIGN §F, DECISIONS §11/§19).
//
// Deterministic anchor pass. For each node in --scope carrying a canonical cedsId, MERGE a
// SPECIFIED_MAPPING edge to the CEDS node whose identity matches that cedsId, with:
//   confidence       = 1.0
//   provenanceTier   = 'spec-authoritative'
//   matchPredicate   ABSENT  (a specified edge is exact by definition — DESIGN §F)
//   owner            the --owner property (relationships can't carry labels)
//
// GENERIC: the forge already normalized each standard's native CEDS crossRef into the canonical
// cedsId (and value-level cedsOptionId on DmeOptionValue) — so the maker resolves on cedsId, period.
// The mappingInstruction's cedsOriginalAnchorPropertyName tells us the ORIGIN of the anchor (recorded
// as cedsOriginalAnchorPropertyName provenance on the edge), but is NOT used to resolve. There is no
// per-standard code (DECISIONS §12).
//
// §19 (R-D deferred): ALL crossRefs are treated as equivalence-grade SPECIFIED_MAPPING for now.
//
// Endpoint resolution: BOTH the scope node (carries cedsId) and the CEDS node (its identity matches
// that cedsId) must resolve, or the pair goes to the orphan report — NEVER a partial edge (same
// discipline as replay). The CEDS node's identity is matched on its cedsId property if present, else
// its stableId (CEDS is the hub; a CEDS Property's own cedsId == its stableId in canonical form).
//
// Idempotent: MERGE on the (from,to,type) pair. Existing pairs in scope are NOT re-bridged — MERGE
// is a no-op for an existing edge, and we report how many were already present (pairsAlreadyBridged)
// vs newly created (edgesMerged delta) by reading the create-vs-match summary.
//
// Async style: qtools taskListPlus/pipeRunner; neo4j resolves at the leaf. No async/await, no
// try/catch-for-control-flow, no Promises surfaced. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const mappingInstructionFactory = require('./mapping-instruction');

// The CEDS hub's canonical _source casing comes ONLY from the standard-registry — the single source
// of truth (FROZEN_LATTICE casing RULING: STANDARDIZE the casing, do NOT match case-insensitively).
// There is NO hardcoded hub-name string literal in this module; the hub identity is matched EXACTLY
// against cedsHubStandardName.
const { cedsHubStandardName } = require('../../edf-forge/lib/standard-registry');

const PROVENANCE_TIER = 'spec-authoritative';
const EDGE_TYPE = 'SPECIFIED_MAPPING';

const toNumber = (value) => {
	if (value && typeof value === 'object' && typeof value.toNumber === 'function') {
		return value.toNumber();
	}
	return Number(value) || 0;
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle } = {}) => {
		const { xLog } = process.global;
		const mappingInstruction = mappingInstructionFactory({ lifecycle });

		// the element-level anchor pass: scope nodes carrying cedsId -> CEDS nodes matched on cedsId.
		// the value-level anchor pass: scope DmeOptionValue nodes carrying cedsOptionId -> CEDS
		// DmeOptionValue nodes matched on cedsOptionId. Both are the SAME shape of MERGE on a
		// canonical anchor property, so one parameterized cypher serves both (anchorProperty +
		// cedsAnchorProperty differ). This keeps the maker generic.
		//
		// Returns { newlyCreated, alreadyPresent, anchorsConsidered, orphans }.
		const runAnchorPass = (
			{ graphName, scope, owner, anchorProperty, cedsAnchorProperty, levelLabel },
			callback,
		) => {
			const taskList = new taskListPlus();

			// 1. collect the scope anchors and CLASSIFY each: resolvable (a CEDS node matches) or
			//    orphan (no CEDS node matches). We do this in ONE cypher so resolution is atomic and
			//    we never emit a partial edge. The scope node is identified by _source = scope and a
			//    non-null anchor property; the CEDS node is any node whose _source is the CEDS hub
			//    (matched EXACTLY against cedsHubStandardName from the registry — both real CEDS and the
			//    synthetic test/p6 hub emit that exact casing) whose cedsAnchorProperty (or, failing
			//    that, stableId) equals anchorValue.
			taskList.push((args, next) => {
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							MATCH (src)
							WHERE src._source = $scope AND src.\`${anchorProperty}\` IS NOT NULL
							WITH src, src.\`${anchorProperty}\` AS anchorValue
							OPTIONAL MATCH (ceds)
								WHERE ceds._source = $cedsHub
								  AND ( ceds.\`${cedsAnchorProperty}\` = anchorValue OR ceds.stableId = anchorValue )
							RETURN
								src.stableId    AS srcStableId,
								anchorValue     AS anchorValue,
								ceds.stableId   AS cedsStableId
						`,
						params: { scope, cedsHub: cedsHubStandardName },
					},
					(err, result) => {
						if (err) {
							next(`specified ${levelLabel} anchor scan: ${err}`);
							return;
						}
						const resolvable = [];
						const orphans = [];
						result.records.forEach((record) => {
							const srcStableId = record.srcStableId;
							const anchorValue = record.anchorValue;
							const cedsStableId = record.cedsStableId;
							if (cedsStableId === null || cedsStableId === undefined) {
								orphans.push({
									level: levelLabel,
									srcStableId,
									anchorValue,
									reason: 'no CEDS node matches this cedsId',
								});
								return;
							}
							resolvable.push({ srcStableId, cedsStableId, anchorValue });
						});
						next('', { ...args, resolvable, orphans });
					},
				);
			});

			// 2. MERGE the SPECIFIED_MAPPING edges for the resolvable pairs ONLY (never a partial
			//    edge). Idempotent MERGE on the (from,to,type) pair: an existing pair is NOT
			//    re-bridged. We count create-vs-match by reading relationshipsCreated from the
			//    summary across a batched UNWIND. confidence=1.0, provenanceTier set, NO
			//    matchPredicate. The anchor origin is recorded for provenance.
			taskList.push((args, next) => {
				if (args.resolvable.length === 0) {
					next('', { ...args, newlyCreated: 0, alreadyPresent: 0 });
					return;
				}
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							UNWIND $pairs AS pair
							MATCH (from {stableId: pair.srcStableId})
							MATCH (to   {stableId: pair.cedsStableId})
							MERGE (from)-[r:${EDGE_TYPE}]->(to)
							ON CREATE SET
								r.confidence = 1.0,
								r.provenanceTier = $provenanceTier,
								r.owner = $owner,
								r.cedsAnchorValue = pair.anchorValue,
								r.bridgeLevel = $levelLabel
							RETURN count(r) AS touched
						`,
						params: {
							pairs: args.resolvable,
							provenanceTier: PROVENANCE_TIER,
							owner: `${owner}`,
							levelLabel,
						},
					},
					(err, result) => {
						if (err) {
							next(`specified ${levelLabel} merge: ${err}`);
							return;
						}
						const created = toNumber(
							result.summary &&
								result.summary.counters &&
								typeof result.summary.counters.updates === 'function'
								? result.summary.counters.updates().relationshipsCreated
								: 0,
						);
						const touched = args.resolvable.length;
						next('', {
							...args,
							newlyCreated: created,
							alreadyPresent: touched - created,
						});
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					newlyCreated: args.newlyCreated,
					alreadyPresent: args.alreadyPresent,
					anchorsConsidered: args.resolvable.length + args.orphans.length,
					orphans: args.orphans,
				});
			});
		};

		// bridge — { graphName, scope, owner } ->
		//   { edgesMerged, pairsAlreadyBridged, anchorsConsidered, orphans }.
		// Reads the scope's mappingInstruction (generic), then runs the element-level anchor pass
		// (cedsId -> CEDS) AND the value-level anchor pass (cedsOptionId -> CEDS DmeOptionValue).
		const bridge = ({ graphName, scope, owner }, callback) => {
			// Hub-scope no-op: -specified is CROSS-standard only. When the scope IS the CEDS hub
			// itself, there is nothing to bridge TO (the hub bridges to nothing — a same-source
			// self-reference is not a cross-standard mapping), so short-circuit to a clean no-op.
			// This also prevents the hub's own cedsIds from each resolving to themselves and being
			// dumped as a giant self-orphan/self-edge array for -addStandard CEDS.
			if (`${scope}` === cedsHubStandardName) {
				xLog.status(
					`[specified-bridge] scope '${scope}' is the CEDS hub — nothing to specified-bridge`,
				);
				callback('', {
					edgesMerged: 0,
					pairsAlreadyBridged: 0,
					anchorsConsidered: 0,
					orphans: [],
				});
				return;
			}

			const taskList = new taskListPlus();

			// read the mappingInstruction for the scope (generic; informs provenance/origin only —
			// resolution is always on the canonical cedsId/cedsOptionId the forge wrote).
			taskList.push((args, next) => {
				mappingInstruction.readForScope({ graphName, scope }, (err, resolved) => {
					if (err) {
						next(err);
						return;
					}
					xLog.status(
						`[specified-bridge] scope '${scope}' mappingInstruction rootFound=${resolved.rootFound}; anchor origins: ${JSON.stringify(resolved.instruction.cedsOriginalAnchorPropertyName)}`,
					);
					next('', { ...args, instruction: resolved.instruction });
				});
			});

			// element-level anchor pass: resolve on the canonical cedsId property.
			taskList.push((args, next) => {
				runAnchorPass(
					{
						graphName,
						scope,
						owner,
						anchorProperty: 'cedsId',
						cedsAnchorProperty: 'cedsId',
						levelLabel: 'element',
					},
					(err, elementResult) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(
							`[specified-bridge] element pass: ${elementResult.newlyCreated} created, ${elementResult.alreadyPresent} already present, ${elementResult.orphans.length} orphan(s)`,
						);
						next('', { ...args, elementResult });
					},
				);
			});

			// value-level anchor pass: resolve on the canonical cedsOptionId property.
			taskList.push((args, next) => {
				runAnchorPass(
					{
						graphName,
						scope,
						owner,
						anchorProperty: 'cedsOptionId',
						cedsAnchorProperty: 'cedsOptionId',
						levelLabel: 'value',
					},
					(err, valueResult) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(
							`[specified-bridge] value pass: ${valueResult.newlyCreated} created, ${valueResult.alreadyPresent} already present, ${valueResult.orphans.length} orphan(s)`,
						);
						next('', { ...args, valueResult });
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				const { elementResult, valueResult } = args;
				callback('', {
					edgesMerged: elementResult.newlyCreated + valueResult.newlyCreated,
					pairsAlreadyBridged:
						elementResult.alreadyPresent + valueResult.alreadyPresent,
					anchorsConsidered:
						elementResult.anchorsConsidered + valueResult.anchorsConsidered,
					orphans: [...elementResult.orphans, ...valueResult.orphans],
				});
			});
		};

		return { bridge, runAnchorPass };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
