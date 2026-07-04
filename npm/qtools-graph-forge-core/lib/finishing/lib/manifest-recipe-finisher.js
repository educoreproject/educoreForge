'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// manifest-recipe-finisher.js — Wave B move #1 (PLAN-inGraphSelfDocumentationEnrichment-070126.md §1):
// materialize the manifest RECIPE in-graph so a bolt-only consumer can see what this graph was replayed
// from. One :ManifestRecipe node for the build manifest + one per ANCESTOR manifest (metadata only —
// no HAS_BLOCK fan-out for ancestors; the lineage is the point), chained recipe -[:BASED_ON]-> parent;
// one :RecipeBlock per member block, recipe -[:HAS_BLOCK]-> block. The GraphProvenance passport links
// passport -[:BUILT_FROM]-> recipe — created in graph-builder.stampProvenance because the passport is
// minted AFTER finishing.
//
// SOURCES (all store facts the replay already reads — deterministic across replays of one manifest):
//   manifests: manifestKey, label, basedOn, note, createdAt (row facts, stable once minted)
//   blocks:    type, subject, version, requires, producedBy, createdAt — via getBlockMeta (NO text read)
// Each RecipeBlock carries a mechanical human `purpose` derived from its type+subject (a structural
// statement, never fabricated source content). Nodes are :ForgedNode (deterministic content, fingerprint
// scope) and are :GraphMeta-stamped by the graph-meta finisher; edges carry provenanceTier 'structural'.
//
// ROUND-TRIP GATE (the plan's validator): after emission the finisher re-queries the chain and REFUSES
// if the recipe, its member count, or the ancestry chain do not resolve.
//
// Async style: qtools taskListPlus/pipeRunner; cypher at the leaf via the injected lifecycle. No
// async/await, no try/catch-for-control-flow. camelCase only.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle, vocabulary, forgeStore } = {}) => {
		const { xLog } = process.global;

		const { SELF_DOC } = vocabulary;
		const RECIPE_LABEL = SELF_DOC.NODE_LABELS.MANIFEST_RECIPE;
		const BLOCK_LABEL = SELF_DOC.NODE_LABELS.RECIPE_BLOCK;
		const HAS_BLOCK = SELF_DOC.EDGE_TYPES.HAS_BLOCK;
		const BASED_ON = SELF_DOC.EDGE_TYPES.BASED_ON;
		const selfDocTier = SELF_DOC.PROVENANCE_TIER;

		// mechanical one-line purpose from block type+subject — a structural statement of what the block
		// IS in the model, never a fabricated content description.
		const purposeForBlock = ({ type, subject }) => {
			switch (type) {
				case 'standard':
					return `Source standard block: the ${subject} structural content (classes, properties, option sets, values).`;
				case 'reference':
					return `Hub reference block: the canonical ${subject} tuples every mapping resolves to (the meaning layer).`;
				case 'mapping':
					return `Authored mapping block: ${subject} elements resolved to hub tuples (spec-authoritative EXACT_MATCH).`;
				case 'inferredMapping':
					return `Inferred mapping block: ${subject} elements resolved to hub tuples by frozen LLM inference (CLOSE_MATCH hypotheses).`;
				case 'inferredDecision':
					return `Frozen inference decision block for ${subject}: pins the sampled LLM decisions so replay is deterministic.`;
				default:
					return `${type} block for ${subject}.`;
			}
		};

		// ----- collectRecipeFacts — walk the manifest + its basedOn ancestry (metadata only) and the
		//   member blocks' metadata. Returns { manifestRow, memberMetas, ancestorRows } via callback.
		const collectRecipeFacts = ({ manifestKey }, callback) => {
			const taskList = new taskListPlus();

			// the build manifest row + members
			taskList.push((args, next) => {
				forgeStore.getManifest({ manifestKey }, (err, manifest) => {
					if (err) {
						next(`manifest-recipe-finisher: getManifest('${manifestKey}') failed: ${err}`);
						return;
					}
					if (!manifest) {
						next(`manifest-recipe-finisher: no manifest '${manifestKey}' in the store`);
						return;
					}
					next('', { ...args, manifestRow: manifest });
				});
			});

			// each member block's metadata (getBlockMeta — never the text)
			taskList.push((args, next) => {
				const memberMetas = [];
				const sub = new taskListPlus();
				(args.manifestRow.members || []).forEach((oneMember) => {
					sub.push((subArgs, subNext) => {
						forgeStore.getBlockMeta({ blockId: oneMember.blockId }, (err, row) => {
							if (err) {
								subNext(err);
								return;
							}
							if (!row) {
								subNext(
									`manifest-recipe-finisher: manifest member block '${oneMember.blockId}' missing from the store`,
								);
								return;
							}
							memberMetas.push({ ...row, position: oneMember.position });
							subNext('', subArgs);
						});
					});
				});
				pipeRunner(sub.getList(), {}, (err) => next(err, { ...args, memberMetas }));
			});

			// the basedOn ancestry chain (metadata only; cycle-guarded)
			taskList.push((args, next) => {
				const ancestorRows = [];
				const seen = new Set([manifestKey]);
				const walk = (parentKey) => {
					if (!parentKey) {
						next('', { ...args, ancestorRows });
						return;
					}
					if (seen.has(parentKey)) {
						next(
							`manifest-recipe-finisher: basedOn ancestry cycles at '${parentKey}' — refusing`,
						);
						return;
					}
					seen.add(parentKey);
					forgeStore.getManifest({ manifestKey: parentKey }, (err, parentRow) => {
						if (err) {
							next(`manifest-recipe-finisher: ancestry getManifest('${parentKey}') failed: ${err}`);
							return;
						}
						if (!parentRow) {
							// honest gap: the parent key is recorded but its row is gone (pruned store).
							// The chain ends here; the child's basedOn property still names the key.
							next('', { ...args, ancestorRows });
							return;
						}
						ancestorRows.push(parentRow);
						walk(parentRow.basedOn || null);
					});
				};
				walk(args.manifestRow.basedOn || null);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					manifestRow: args.manifestRow,
					memberMetas: args.memberMetas,
					ancestorRows: args.ancestorRows,
				});
			});
		};

		// ----- finish — MERGE the recipe chain + member blocks, then round-trip-verify.
		const finish = ({ graphName, manifestKey } = {}, callback) => {
			if (!manifestKey) {
				callback(
					`manifest-recipe-finisher: no manifestKey in the build context — the recipe cannot be materialized`,
				);
				return;
			}
			if (!forgeStore) {
				callback(
					`manifest-recipe-finisher: no forgeStore injected — the recipe cannot be materialized`,
				);
				return;
			}

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				collectRecipeFacts({ manifestKey }, (err, facts) => next(err, { ...args, ...facts }));
			});

			// 1) MERGE the recipe node for the build manifest + every ancestor (metadata only), each
			//    carrying its manifest-row facts and a human description.
			taskList.push((args, next) => {
				const recipeRows = [args.manifestRow, ...args.ancestorRows].map((oneRow, index) => ({
					stableId: `${SELF_DOC.MANIFEST_RECIPE_STABLE_ID_PREFIX}${oneRow.manifestKey}`,
					manifestKey: oneRow.manifestKey,
					label: oneRow.label || null,
					note: oneRow.note || null,
					basedOn: oneRow.basedOn || null,
					createdAt: oneRow.createdAt || null,
					isBuildManifest: index === 0,
					name: oneRow.label || oneRow.manifestKey,
					description:
						index === 0
							? `The manifest this graph was replayed from: ${(args.memberMetas || []).length} content-addressed block(s), key ${oneRow.manifestKey}.`
							: `Ancestor manifest in this graph's lineage (metadata only), key ${oneRow.manifestKey}.`,
				}));
				const cypher = `UNWIND $recipeRows AS row
					MERGE (r:ForgedNode:\`${RECIPE_LABEL}\` { stableId: row.stableId })
					SET r.manifestKey = row.manifestKey, r.label = row.label, r.note = row.note,
						r.basedOn = row.basedOn, r.createdAt = row.createdAt,
						r.isBuildManifest = row.isBuildManifest,
						r.name = row.name, r.description = row.description
					RETURN count(r) AS recipeCount`;
				lifecycle.runCypher(
					{ graphName, cypher, params: { recipeRows } },
					(err, result) => {
						if (err) {
							next(`manifest-recipe-finisher: recipe MERGE failed: ${err}`);
							return;
						}
						next('', { ...args, recipeCount: Number(result.records[0].recipeCount) });
					},
				);
			});

			// 2) MERGE the BASED_ON chain (recipe -> parent recipe), structural tier.
			taskList.push((args, next) => {
				// each recipe's parent is the NEXT row in the walk order (build manifest first, then
				// ancestors oldest-last) — consecutive pairs are exactly the BASED_ON chain.
				const orderedRows = [args.manifestRow, ...args.ancestorRows];
				const chainPairs = orderedRows.slice(0, -1).map((oneRow, index) => ({
					childId: `${SELF_DOC.MANIFEST_RECIPE_STABLE_ID_PREFIX}${oneRow.manifestKey}`,
					parentId: `${SELF_DOC.MANIFEST_RECIPE_STABLE_ID_PREFIX}${orderedRows[index + 1].manifestKey}`,
				}));
				if (!chainPairs.length) {
					next('', { ...args, basedOnCount: 0 });
					return;
				}
				const cypher = `UNWIND $chainPairs AS pair
					MATCH (child:\`${RECIPE_LABEL}\` { stableId: pair.childId })
					MATCH (parent:\`${RECIPE_LABEL}\` { stableId: pair.parentId })
					MERGE (child)-[e:\`${BASED_ON}\`]->(parent)
					SET e.provenanceTier = $selfDocTier
					RETURN count(e) AS basedOnCount`;
				lifecycle.runCypher(
					{ graphName, cypher, params: { chainPairs, selfDocTier } },
					(err, result) => {
						if (err) {
							next(`manifest-recipe-finisher: BASED_ON chain MERGE failed: ${err}`);
							return;
						}
						next('', { ...args, basedOnCount: Number(result.records[0].basedOnCount) });
					},
				);
			});

			// 3) MERGE one :RecipeBlock per member + recipe->HAS_BLOCK->block, structural tier.
			taskList.push((args, next) => {
				const blockRows = args.memberMetas.map((oneMeta) => ({
					stableId: `${SELF_DOC.RECIPE_BLOCK_STABLE_ID_PREFIX}${oneMeta.blockId}`,
					blockId: oneMeta.blockId,
					blockType: oneMeta.type,
					subject: oneMeta.subject || null,
					version: oneMeta.version || null,
					requires: oneMeta.requires || [],
					producedBy: oneMeta.producedBy || null,
					createdAt: oneMeta.createdAt || null,
					position: oneMeta.position === undefined ? null : oneMeta.position,
					name: `${oneMeta.subject || '(no subject)'} ${oneMeta.type}`,
					purpose: purposeForBlock(oneMeta),
					description: purposeForBlock(oneMeta),
				}));
				const cypher = `MATCH (r:\`${RECIPE_LABEL}\` { stableId: $recipeStableId })
					UNWIND $blockRows AS row
					MERGE (b:ForgedNode:\`${BLOCK_LABEL}\` { stableId: row.stableId })
					SET b.blockId = row.blockId, b.blockType = row.blockType, b.subject = row.subject,
						b.version = row.version, b.requires = row.requires, b.producedBy = row.producedBy,
						b.createdAt = row.createdAt, b.position = row.position,
						b.name = row.name, b.purpose = row.purpose, b.description = row.description
					MERGE (r)-[e:\`${HAS_BLOCK}\`]->(b)
					SET e.provenanceTier = $selfDocTier
					RETURN count(b) AS blockCount`;
				lifecycle.runCypher(
					{
						graphName,
						cypher,
						params: {
							recipeStableId: `${SELF_DOC.MANIFEST_RECIPE_STABLE_ID_PREFIX}${manifestKey}`,
							blockRows,
							selfDocTier,
						},
					},
					(err, result) => {
						if (err) {
							next(`manifest-recipe-finisher: RecipeBlock MERGE failed: ${err}`);
							return;
						}
						next('', { ...args, blockCount: Number(result.records[0].blockCount) });
					},
				);
			});

			// 4) ROUND-TRIP verification (the plan's gate): the recipe resolves, member count matches the
			//    manifest, and the BASED_ON chain walks to its end.
			taskList.push((args, next) => {
				const cypher = `MATCH (r:\`${RECIPE_LABEL}\` { stableId: $recipeStableId })
					OPTIONAL MATCH (r)-[:\`${HAS_BLOCK}\`]->(b:\`${BLOCK_LABEL}\`)
					OPTIONAL MATCH chain = (r)-[:\`${BASED_ON}\`*0..50]->(ancestor:\`${RECIPE_LABEL}\`)
					RETURN count(DISTINCT b) AS blockCount, count(DISTINCT ancestor) AS chainNodeCount`;
				lifecycle.runCypher(
					{
						graphName,
						cypher,
						params: {
							recipeStableId: `${SELF_DOC.MANIFEST_RECIPE_STABLE_ID_PREFIX}${manifestKey}`,
						},
					},
					(err, result) => {
						if (err) {
							next(`manifest-recipe-finisher: round-trip query failed: ${err}`);
							return;
						}
						const row = result.records[0];
						const blockCount = Number(row.blockCount);
						const chainNodeCount = Number(row.chainNodeCount);
						const expectedBlocks = args.memberMetas.length;
						const expectedChain = 1 + args.ancestorRows.length;
						if (blockCount !== expectedBlocks || chainNodeCount !== expectedChain) {
							next(
								`manifest-recipe-finisher: ROUND-TRIP FAILED — blocks in-graph ${blockCount} (expected ${expectedBlocks}), ` +
									`recipe chain ${chainNodeCount} (expected ${expectedChain}). Refusing to accept the build's self-documentation.`,
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
					summary: `manifest recipe: 1 build recipe + ${args.ancestorRows.length} ancestor(s), ${args.blockCount} RecipeBlock(s), round-trip verified`,
					recipeStableId: `${SELF_DOC.MANIFEST_RECIPE_STABLE_ID_PREFIX}${manifestKey}`,
					recipeCount: args.recipeCount,
					blockCount: args.blockCount,
					ancestorCount: args.ancestorRows.length,
				});
			});
		};

		return { finish, purposeForBlock };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
