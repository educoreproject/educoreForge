'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// resolve-core.js — PHASE 8: the ONE shared RESOLVE capability (the verb), built once and exposed thrice
// (CLI verb, educore-standards MCP tool, askMilo tool — all thin adapters over THIS module). It is a
// READ-ONLY query capability: given a term/description it returns ranked HubReference addresses + confidence
// + a suggested predicate + an ABSTAIN flag. It is READ-ONLY w.r.t. the BUILD ARTIFACTS — it ADDS NO graph
// content and never connects to Neo4j (it reads only the immutable, content-addressed gating-manifest BLOCKS
// via forge-store, exactly as the Phase-3/4/5 producers read — so the frozen golden / baselines / manifest
// are provably untouched). Its ONLY side effect is the ADDITIVE, content-addressed embedding cache: on a
// cache-missing query the def-embedder writes phase5DefEmbCache.json (a deterministic speedup keyed by
// sha256(text)) — it can never alter an existing entry, the golden, the baselines, or the graph. It makes
// LLM calls at QUERY time; that query-time non-determinism is fine — resolve is an interactive query, NOT
// part of the deterministic build/replay (G5: LLM non-determinism never reaches replay).
//
// REUSES the SAME Phase-5 inference machinery (def-embedder + inference-pipeline retrieve->floor->rerank->
// ABSTAIN) and the SAME reference resolver (mapping-subgraph.buildReferenceIndex) that the authored/inferred
// tracks use to turn a chosen CEDS key into a property-tier HubReference address. The prior-generation
// edf-bridge/implied-pipeline.js (RETIRED and deleted 2026-07-04) and replay-engine.js were NEVER touched.
//
// DEPENDENCY-INJECTED (programming-skills discipline): the caller supplies forgeStore + defEmbedder +
// llmClient so this module is free of commandLineParameters and is callable identically from CLI, an MCP
// server, or askMilo. The surfaces-parity gate injects a DETERMINISTIC STUB llmClient so the 3-way
// identical-output comparison can't flake on Opus variance; the accuracy + abstain gates exercise the REAL
// pipeline.
//
// SUGGESTED PREDICATE POLICY (honest + doctrine-faithful): an inferred semantic pick suggests 'closeMatch'.
// Inference NEVER auto-promotes to exactMatch (exactMatch is authored-curation-only — the Phase-6
// conservativity guarantee: only exactMatch composes to equivalence). narrow/broad SUBSUMPTION typing is
// deferred (Phase 6+), so resolve does not fabricate directionality. The full SKOS enum is documented on the
// surfaces; the value resolve emits for a pick is closeMatch.
//
// No async/await, no try/catch for control flow. camelCase only.
//
// @concept: [[ResolveVerb]]
// @concept: [[Abstain]]
// @concept: [[HubReference]]

const path = require('path');

const CORE_LIB = path.join(__dirname, '..', '..', '..', '..', 'npm', 'qtools-graph-forge-core', 'lib');

const nodeLoaderFactory = require(path.join(CORE_LIB, 'node-loader', 'node-loader'));
const inferencePipelineFactory = require(path.join(CORE_LIB, 'inference-pipeline', 'inference-pipeline'));
const mappingSubgraphFactory = require(path.join(CORE_LIB, 'mapping-subgraph', 'mappingSubgraph'));

const { pipeRunner, taskListPlus } = new require(path.join(
	__dirname,
	'..',
	'..',
	'..',
	'node_modules',
	'qtools-asynchronous-pipe-plus',
))();

const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);
const round6 = (x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : null);
const clamp01 = (x) => (typeof x !== 'number' ? null : x < 0 ? 0 : x > 1 ? 1 : x);

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({
		forgeStore,
		defEmbedder,
		llmClient,
		gatingManifest,
		topK = 15,
		cosineFloor = 0,
		concurrency = 8,
	} = {}) => {
		const { xLog } = process.global;
		const nodeLoader = nodeLoaderFactory();
		const referenceResolver = mappingSubgraphFactory({});
		const defaultPipeline = inferencePipelineFactory({ llmClient, topK, cosineFloor, concurrency });

		// loaded ONCE per instance: { candidateRecords (with .vector), candidateClassIndex,
		//   basePropertyRef (cedsKey -> HubReference stableId), refByStableId }.
		let context = null;

		// ---- load the CEDS candidate pool + reference index from the gating manifest BLOCKS (read-only) ----
		const loadContext = (callback) => {
			if (context) {
				callback('', context);
				return;
			}
			const taskList = new taskListPlus();
			taskList.push((args, next) => {
				forgeStore.getManifest({ manifestKey: gatingManifest }, (err, manifest) => {
					if (err || !manifest) {
						next(err || `resolve: no gating manifest '${gatingManifest}'`);
						return;
					}
					next('', { ...args, members: manifest.members || [] });
				});
			});
			taskList.push((args, next) => {
				let cedsStandardRow = null;
				let cedsReferenceRow = null;
				const sub = new taskListPlus();
				args.members.forEach((oneMember) => {
					sub.push((a2, n2) => {
						forgeStore.getBlock({ blockId: oneMember.blockId }, (err, row) => {
							if (err) {
								n2(err);
								return;
							}
							if (row && row.type === 'standard' && row.subject === 'CEDS') cedsStandardRow = row;
							if (row && row.type === 'reference' && row.subject === 'CEDS') cedsReferenceRow = row;
							n2('', a2);
						});
					});
				});
				pipeRunner(sub.getList(), {}, (err) => {
					if (err) {
						next(err);
						return;
					}
					if (!cedsStandardRow) next("resolve: no CEDS 'standard' block in the gating manifest");
					else if (!cedsReferenceRow) next("resolve: no CEDS 'reference' block in the gating manifest");
					else next('', { ...args, cedsStandardRow, cedsReferenceRow });
				});
			});
			taskList.push((args, next) => {
				const cedsRecords = nodeLoader.collapseNodes(
					nodeLoader.deserialize(args.cedsStandardRow.text).nodes,
				);
				const referenceBlock = nodeLoader.deserialize(args.cedsReferenceRow.text);
				const candidateRecords = cedsRecords.filter((oneRecord) => oneRecord.role === 'DmeProperty');
				const candidateClassIndex = nodeLoader.buildClassIndex(cedsRecords);
				const { basePropertyRef } = referenceResolver.buildReferenceIndex(referenceBlock.nodes);
				const refByStableId = {};
				referenceBlock.nodes.forEach((oneNode) => {
					refByStableId[oneNode.stableId] = oneNode;
				});
				next('', { ...args, candidateRecords, candidateClassIndex, basePropertyRef, refByStableId });
			});
			taskList.push((args, next) => {
				const texts = args.candidateRecords.map((oneRecord) => oneRecord.defText);
				xLog.status(
					`[resolve] embedding ${texts.length} CEDS candidate definitions (cached after first run)…`,
				);
				defEmbedder.batchEmbed({ texts }, (err, result) => {
					if (err) {
						next(`resolve: candidate embedding failed: ${err}`);
						return;
					}
					args.candidateRecords.forEach((oneRecord, idx) => {
						oneRecord.vector = result.vectors[idx];
					});
					next('', args);
				});
			});
			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				context = {
					candidateRecords: args.candidateRecords,
					candidateClassIndex: args.candidateClassIndex,
					basePropertyRef: args.basePropertyRef,
					refByStableId: args.refByStableId,
				};
				callback('', context);
			});
		};

		// cedsKey -> the materialized property-tier HubReference ADDRESS (or null if unresolvable).
		const addressForCedsKey = (cedsKey) => {
			const refStableId = context.basePropertyRef[cedsKey];
			if (!refStableId) {
				return null;
			}
			const refNode = context.refByStableId[refStableId];
			const props = (refNode && refNode.properties) || {};
			return {
				address: refStableId,
				addressSignature: v1(props.addressSignature),
				canonicalKey: v1(props.canonicalKey),
				name: v1(props.name),
				referenceTier: v1(props.referenceTier),
				hubName: v1(props.hubName) || 'CEDS',
				hubVersion: v1(props.hubVersion) || null,
			};
		};

		// ---- resolve — the verb. READ-ONLY. callback(err, result). ----
		//   input: { term, definition, datatype, contextText, targetHub='CEDS', topK?, cosineFloor? }
		//   result: { query, abstain, abstainReason, suggested, candidates[], meta }
		const resolve = (
			{ term, definition, datatype, contextText, targetHub = 'CEDS', topK: callTopK, cosineFloor: callFloor } = {},
			callback,
		) => {
			if (targetHub && targetHub !== 'CEDS') {
				callback(`resolve: only the CEDS hub is materialized in this build (got '${targetHub}')`);
				return;
			}
			const hasTerm = term && `${term}`.trim() !== '';
			const hasDef = definition && `${definition}`.trim() !== '';
			if (!hasTerm && !hasDef) {
				callback('resolve: requires a term or a definition');
				return;
			}
			loadContext((loadErr) => {
				if (loadErr) {
					callback(loadErr);
					return;
				}
				const defText = hasDef ? definition : term;
				const source = {
					stableId: 'resolveQuery',
					role: 'DmeProperty',
					name: hasTerm ? term : defText,
					defText,
					domainId: null,
					rangeDatatype: datatype || null,
				};
				defEmbedder.batchEmbed({ texts: [defText] }, (embErr, embResult) => {
					if (embErr) {
						callback(`resolve: query embedding failed: ${embErr}`);
						return;
					}
					source.vector = embResult.vectors[0];
					if (!source.vector) {
						callback('resolve: query produced no embedding (empty text?)');
						return;
					}
					const effectiveTopK = typeof callTopK === 'number' ? callTopK : topK;
					const effectiveFloor = typeof callFloor === 'number' ? callFloor : cosineFloor;
					const pipeline =
						effectiveTopK !== topK || effectiveFloor !== cosineFloor
							? inferencePipelineFactory({
									llmClient,
									topK: effectiveTopK,
									cosineFloor: effectiveFloor,
									concurrency,
								})
							: defaultPipeline;
					pipeline.scoreSource(
						source,
						context.candidateRecords,
						{},
						context.candidateClassIndex,
						(scoreErr, decision) => {
							if (scoreErr) {
								callback(`resolve: rerank failed: ${scoreErr}`);
								return;
							}
							// ranked retrieval candidates -> HubReference addresses (deterministic part).
							const candidates = decision.pool.map((entry, idx) => {
								const addr = addressForCedsKey(entry.cedsId);
								return {
									rank: idx + 1,
									cedsId: entry.cedsId,
									cosine: round6(entry.cosine),
									confidence: round6(clamp01(entry.cosine)),
									hubReference: addr,
									resolved: !!addr,
								};
							});
							// the reranker pick (or null on abstain) -> suggested address + predicate.
							let suggested = null;
							if (!decision.abstain && decision.targetKey) {
								const addr = addressForCedsKey(decision.targetKey);
								if (addr) {
									suggested = {
										hubReference: addr,
										confidence: round6(clamp01(decision.cosineScore)),
										predicate: 'closeMatch',
										retrievalRank:
											typeof decision.retrievalRank === 'number' ? decision.retrievalRank : null,
									};
								}
							}
							const abstain = decision.abstain || !suggested;
							const abstainReason = decision.abstain
								? decision.abstainReason
								: suggested
									? null
									: 'pickUnresolved';
							callback('', {
								query: {
									term: hasTerm ? term : null,
									definition: hasDef ? definition : null,
									datatype: datatype || null,
									contextText: contextText || null,
									targetHub: 'CEDS',
								},
								abstain,
								abstainReason,
								suggested: abstain ? null : suggested,
								candidates,
								meta: {
									model: (llmClient && llmClient.model) || null,
									topK: effectiveTopK,
									cosineFloor: effectiveFloor,
									gatingManifest,
									bestCosine: round6(decision.bestCosine),
									candidatePoolSize: context.candidateRecords.length,
									hubReferenceCount: Object.keys(context.basePropertyRef).length,
								},
							});
						},
					);
				});
			});
		};

		return { loadContext, resolve, addressForCedsKey };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
