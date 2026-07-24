'use strict';

// semanticBridge — the INFERRED `CLOSE_MATCH` producer (P3a/P3c; design §1 "a default generic plugin", §2 the
// five-move loop with ONE freeze, §5.5 the --rebridge/freeze model). A bridge.js plugin registered in
// bridgeMaker's BRIDGE_PLUGIN_BY_MAPPER. It composes the ported inference machinery into the semantic half
// of the bridge, and it PRODUCES a decisionBlock (so build.js's suffix logic yields `_close`).
//
// THE MAPPER CONTRACT (interfaces.js @interface BridgeModule):
//   bridgeModule({ ...injected library tools }) ({ inGraph, hub, applyLabel }, cb)
//       -> cb('', { edgesWritten, decisionBlock, counts })
//
// TWO MODES (design §5.5 — re-inference is an EXPLICIT --rebridge, never automatic staleness):
//   MATERIALIZE (a plain -build, injectedTools.rebridge falsy): load THIS pair's FROZEN decision block from
//     the injected decisionStore and replay it PURELY through inferredIndex into CLOSE_MATCH edges. ZERO LLM,
//     ZERO Voyage. A pair with NO frozen block simply writes NO inferred edges (edgesWritten 0, decisionBlock
//     null) — explicit, never a silent spend.
//   REBRIDGE (injectedTools.rebridge truthy — build.js set it because this pair is in the --rebridge scope):
//     WALK -> VECTORIZE (NET) -> inferencePipeline retrieve/floor/rerank (the ONE non-deterministic step, the
//     injected llmClient) -> decisionFreezer FREEZE (content-addressed) -> SAVE to the decisionStore ->
//     MATERIALIZE the frozen picks -> WRITE. Returns the frozen block's hash as decisionBlock.
//
// TWO TIERS (the recreation covers the SAME source basis the golden's inferred track does — 113 DmeProperty
// + 33 DmeOptionValue sources yield the 146 CTDL->CEDS CLOSE_MATCH edges):
//   PROPERTY tier — DmeProperty sources retrieved/reranked against CEDS DmeProperty candidates (the P3a spine).
//   VALUE tier    — DmeOptionValue sources SCOPED (via valueScope, ported from edf-inferred/lib/value-scope)
//     to the option set of their OWN parent property's ALREADY-MATCHED CEDS target, then exact-shortcut or
//     scoped-rerank picked. A value's target is the COMPOSITE '${matchedPropertyKey}|${valueOVtoken}' that
//     inferredIndex resolves through baseValueRef. A source whose parent property did not match, or whose
//     matched CEDS property has no option set, ABSTAINS (never a global retrieve — value-scope's gate).
//
// THE CASE RULE: the recipe names a source token LOWERCASE ('ctdl'); the forge stamps `_source` UPPERCASE
// ('CTDL'). Every graph read and every stamp here uses the UPPERCASE key (sourceStandardKey), exactly as the
// authored producer (ctdlAuthoredBridge) uses its uppercase 'CTDL' literal — so both producers resolve the
// same nodes. Reading `_source` by the raw lowercase token was the "0 sources extracted" bug.
//
// THE FREEZE SEAM (design §2): the select step does NOT write to the graph. rebridge freezes the pipeline's
// decisions into a content-addressed block first; the SAME pure inferredIndex then writes edges from the
// frozen decisions in BOTH modes — so a replay (plain -build) is byte-identical to the rebridge that made it
// and never re-runs the LLM (G2). (The composite value targetKey survives the freeze; the scopeParent* stamps
// do not yet — see decisionFreezer — so a value edge's identity replays exactly, its parent-evidence stamps
// are a follow-on fidelity item.)
//
// House style: qtools curried moduleFunction; callback(errString, result) with '' on success; no async/await
// or try/catch for control flow; registry-over-switch; compound names.

const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const valueScope = require(path.join(__dirname, '..', 'valueScope'));

// This bridge authors the <source> -> CEDS hub SEMANTIC crosswalk. The source standard is read from the
// injected config (a generic plugin serves every semantic pair); the hub is CEDS. These constants have
// nothing to shadow — the plugin IS the semantic producer (polyArch2 §6).
const HUB_STANDARD = 'CEDS';
const HUB_REFERENCE_LABEL = 'HubReference';
const PROPERTY_ROLE = 'DmeProperty';
const VALUE_ROLE = 'DmeOptionValue';
const OPTION_SET_ROLE = 'DmeOptionSet';
const MAPPING_TOOL = 'semanticBridge';

// value-tier floors ported from edf-inferred -emit --tier=value (golden 260718):
//   VALUE_SCOPE_PARENT_FLOOR — a CLOSE_MATCH parent property match must clear this before it may scope child
//     values (EXACT parents always pass); == APPENDIX_A.rerankerFloor in the incumbent.
//   VALUE_ABSTAIN_FLOOR — a value-tier pick whose retrieval cosine is below this abstains (Phase-B derived).
const VALUE_SCOPE_PARENT_FLOOR = 0.78;
const VALUE_ABSTAIN_FLOOR = 0.3924;

const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

// flattenNodeRecord — a graphReader node ({ stableId, properties }, SCALAR props) -> the flat record shape the
// inferencePipeline + inferredIndex + valueScope work in (the incumbent's collapseNodes output). defText is
// the definition the retrieval embeds. parentId/notation/canonicalKey/rangeOptionSetId are the value-tier
// scoping fields (the 2-hop parentId chain, the exact-shortcut text, the composite key parts).
const flattenNodeRecord = (oneNode) => {
	const props = oneNode.properties || {};
	return {
		stableId: oneNode.stableId,
		role: v1(props.role),
		name: v1(props.name),
		defText: v1(props.defText) || v1(props.description) || v1(props.searchText) || v1(props.name),
		domainId: v1(props.domainId) || null,
		rangeDatatype: v1(props.rangeDatatype) || null,
		parentId: v1(props.parentId) || null,
		notation: v1(props.notation) || null,
		canonicalKey: v1(props.canonicalKey) || null,
		rangeOptionSetId: v1(props.rangeOptionSetId) || null,
	};
};

const flattenCandidateRecord = (oneNode) => {
	const props = oneNode.properties || {};
	return {
		...flattenNodeRecord(oneNode),
		// the CEDS Global ID the pipeline emits as targetKey. In the golden the CEDS DmeProperty's cedsId
		// equals the HubReference canonicalKey ('P######'); both keys are read here so the fixture and the
		// real reforge resolve identically. (A value candidate carries its OV canonicalKey too, read above.)
		cedsId: v1(props.cedsId) || v1(props.canonicalKey) || v1(props.propertyKey),
	};
};

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	(injectedTools = {}) =>
	({ inGraph, hub, applyLabel }, callback) => {
		const {
			graphReader,
			relationshipWriter,
			inferredIndex,
			decisionFreezer,
			vectorizer,
			inferencePipeline,
			inferenceConfig,
			decisionStore,
			rebridge,
			config,
		} = injectedTools;

		const xLog = injectedTools.xLog || (process.global && process.global.xLog) || { status: () => {} };

		// EVERY injected tool this producer composes is stated, or it does not run (polyArch2 §6). A missing
		// tool is a wiring fault, named — never a silent no-op that writes zero edges and reads as success.
		const requiredTools = rebridge
			? ['graphReader', 'relationshipWriter', 'inferredIndex', 'decisionFreezer', 'vectorizer', 'inferencePipeline']
			: ['graphReader', 'relationshipWriter', 'inferredIndex', 'decisionFreezer'];
		const missingTool = requiredTools.find((oneName) => typeof injectedTools[oneName] !== 'function');
		if (missingTool) {
			callback(`${moduleName}: injected tool '${missingTool}' is not a function — the component library did not supply it.`);
			return;
		}
		if (!decisionStore || typeof decisionStore.getDecisionBlock !== 'function') {
			callback(`${moduleName}: a decisionStore (getDecisionBlock/saveDecisionBlock) is REQUIRED — a frozen decision block is read from it on a plain build and written to it on --rebridge; there is no default.`);
			return;
		}
		if (!inGraph) {
			callback(`${moduleName}: inGraph is not given — there is no graph to read the source/CEDS nodes from.`);
			return;
		}
		if (hub !== null && hub !== undefined && `${hub}`.toUpperCase() !== HUB_STANDARD) {
			callback(`${moduleName}: hub is '${hub}', but this semantic producer bridges toward the ${HUB_STANDARD} hub only.`);
			return;
		}
		if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
			callback(`${moduleName}: applyLabel is ${applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)} — it is the label harvest selects the written edges by; there is no default.`);
			return;
		}

		const sourceStandard = (config && config.sourceStandard) || (config && config.source);
		if (typeof sourceStandard !== 'string' || sourceStandard.trim() === '') {
			callback(`${moduleName}: config.sourceStandard is not set — the semantic producer must be told which source standard it bridges (a generic plugin serves every pair); there is no default.`);
			return;
		}
		// THE CASE RULE: the recipe token is lowercase ('ctdl'); forged `_source` is uppercase ('CTDL'). Read
		// and stamp by the uppercase key, exactly as ctdlAuthoredBridge uses its uppercase 'CTDL' literal.
		const sourceStandardKey = sourceStandard.toUpperCase();
		const subjectVersion = (config && config.sourceVersion) || '';
		const objectVersion = (config && config.hubVersion) || '';
		const pairKey = `${HUB_STANDARD}::${sourceStandardKey}`;

		const reader = graphReader({ inGraph });
		const freezer = decisionFreezer();

		// buildAndWrite — the SHARED tail of both modes: materialize the frozen picks into CLOSE_MATCH edges
		// (pure, via inferredIndex, stamped with decisionBlockHash) and WRITE each through relationshipWriter.
		// Given the same frozen decisions + reference nodes it is byte-identical, so replay == rebridge (G2).
		const buildAndWrite = ({ inferredDecisions, sourceNodes, referenceNodes, decisionBlockHash }, done) => {
			const builder = inferredIndex({
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
					relationshipWriter(
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
								n2(`${moduleName}: writing CLOSE_MATCH ${oneEdge.fromRef.id} -> ${oneEdge.toRef.id}: ${err}`);
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

		// readReferenceNodes — the CEDS HubReference nodes (RAW { stableId, properties }; both the value-scope
		// property-range index and inferredIndex's buildReferenceIndex read the raw property shape).
		const readReferenceNodes = (done) => {
			reader.readNodes({ label: HUB_REFERENCE_LABEL, propertyEquals: {} }, (err, out) =>
				done(err ? `${moduleName}: reading ${HUB_STANDARD} HubReference nodes: ${err}` : '', (out || {}).nodes || []),
			);
		};
		// readForged — a role-scoped ForgedNode read for the given standard, flattened. reusable helper.
		const readForged = ({ standardKey, role, flatten = flattenNodeRecord, describe }, done) => {
			reader.readNodes({ label: 'ForgedNode', propertyEquals: { _source: standardKey, role } }, (err, out) =>
				done(err ? `${moduleName}: reading ${describe}: ${err}` : '', ((out || {}).nodes || []).map(flatten)),
			);
		};

		// readSourceNodes — the source standard's bridgeable elements: BOTH tiers (DmeProperty + DmeOptionValue).
		// This is the deterministic SOURCE-EXTRACTION set the golden's 146 CLOSE_MATCH sources are drawn from.
		const readSourceNodes = (done) => {
			const taskList = new taskListPlus();
			taskList.push((args, next) => readForged({ standardKey: sourceStandardKey, role: PROPERTY_ROLE, describe: `${sourceStandardKey} ${PROPERTY_ROLE} source nodes` }, (err, nodes) => next(err, { ...args, propertyNodes: nodes })));
			taskList.push((args, next) => readForged({ standardKey: sourceStandardKey, role: VALUE_ROLE, describe: `${sourceStandardKey} ${VALUE_ROLE} source nodes` }, (err, nodes) => next(err, { ...args, valueNodes: nodes })));
			pipeRunner(taskList.getList(), {}, (err, args) =>
				done(err || '', err ? [] : args.propertyNodes.concat(args.valueNodes)),
			);
		};

		// ================= MATERIALIZE (plain -build) — pure replay of a frozen block =================
		const runMaterialize = () => {
			const contentAddress = require(path.join(
				__dirname, '..', '..', '..', '..', '..', '..', 'lib', 'content-address', 'content-address',
			))();
			decisionStore.getDecisionBlock({ pairKey }, (loadErr, loaded) => {
				if (loadErr) {
					finish(`${moduleName}: loading frozen decision block for ${pairKey}: ${loadErr}`);
					return;
				}
				const frozenText = loaded && loaded.frozenText;
				if (!frozenText) {
					// NO frozen block for this pair -> NO inferred edges (design §5.5). Explicit, no spend.
					xLog.status(`  [${moduleName}] ${pairKey}: no frozen decision block — 0 inferred edges (rebridge to produce one).`);
					// decisionBlock is honestly null (there IS no frozen block), but producer says 'inferred' so
					// build.js names the empty block _close, NOT _exact — no collision with the authored pair.
					finish('', { edgesWritten: 0, decisionBlock: null, producer: 'inferred', counts: { inferred: 0, mode: 'materialize', noDecisionBlock: true } });
					return;
				}
				const parsed = freezer.parse(frozenText);
				if (parsed.error) {
					finish(parsed.error);
					return;
				}
				const decisionBlockHash = contentAddress.blockIdForText(frozenText);
				const taskList = new taskListPlus();
				// BOTH-tier source nodes so inferredIndex validates value fromStableIds (not just property).
				taskList.push((args, next) => readSourceNodes((err, nodes) => next(err, { ...args, sourceNodes: nodes })));
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

		// ================= REBRIDGE (--rebridge scope) — run the pipeline, FREEZE, then materialize =====
		const runRebridge = () => {
			// --rebridge RUNS the inference pre-pass — it needs a reranker. A missing llmClient is a wiring
			// fault, named, not a crash deep inside the pipeline (polyArch2 §6). A real reforge injects the
			// Opus client; the suite injects a deterministic stub.
			if (!inferenceConfig || typeof inferenceConfig.llmClient !== 'object' || typeof inferenceConfig.llmClient.rerank !== 'function') {
				finish(`${moduleName}: --rebridge needs inferenceConfig.llmClient (with a rerank method) to run the inference pre-pass; none was injected. A plain build (materialize) needs no llmClient, but rebridging does — there is no default.`);
				return;
			}
			const pipeline = inferencePipeline(inferenceConfig || {});
			const vectorize = vectorizer((config && config.vectorizerConfig) || {});
			const taskList = new taskListPlus();

			// WALK — read every node set both tiers need (deterministic; the case-correct uppercase key).
			taskList.push((args, next) => readForged({ standardKey: sourceStandardKey, role: PROPERTY_ROLE, describe: `${sourceStandardKey} ${PROPERTY_ROLE} source nodes` }, (err, nodes) => next(err, { ...args, propertySources: nodes })));
			taskList.push((args, next) => readForged({ standardKey: sourceStandardKey, role: VALUE_ROLE, describe: `${sourceStandardKey} ${VALUE_ROLE} source nodes` }, (err, nodes) => next(err, { ...args, valueSources: nodes })));
			taskList.push((args, next) => readForged({ standardKey: sourceStandardKey, role: OPTION_SET_ROLE, describe: `${sourceStandardKey} ${OPTION_SET_ROLE} chain nodes` }, (err, nodes) => next(err, { ...args, optionSetNodes: nodes })));
			taskList.push((args, next) => readForged({ standardKey: HUB_STANDARD, role: PROPERTY_ROLE, flatten: flattenCandidateRecord, describe: `${HUB_STANDARD} ${PROPERTY_ROLE} candidate nodes` }, (err, nodes) => next(err, { ...args, propertyCandidates: nodes })));
			taskList.push((args, next) => readForged({ standardKey: HUB_STANDARD, role: VALUE_ROLE, flatten: flattenCandidateRecord, describe: `${HUB_STANDARD} ${VALUE_ROLE} candidate nodes` }, (err, nodes) => next(err, { ...args, valueCandidates: nodes })));
			taskList.push((args, next) => readReferenceNodes((err, nodes) => next(err, { ...args, referenceNodes: nodes })));

			// ---- PROPERTY TIER ---------------------------------------------------------------------------
			// VECTORIZE (NET) — embed property source + property candidate defTexts, attach .vector in place.
			taskList.push((args, next) => {
				const allRecords = args.propertyCandidates.concat(args.propertySources);
				vectorize.batchEmbed({ texts: allRecords.map((r) => r.defText) }, (err, result) => {
					if (err) {
						next(`${moduleName}: vectorizing property defTexts: ${err}`);
						return;
					}
					allRecords.forEach((r, i) => { r.vector = result.vectors[i]; });
					next('', args);
				});
			});
			// PIPELINE — retrieve -> cosineFloor -> rerank (the ONE non-deterministic step).
			taskList.push((args, next) => {
				pipeline.processSources(
					{
						sources: args.propertySources,
						candidatePoolByRole: { [PROPERTY_ROLE]: args.propertyCandidates },
						sourceClassIndex: {},
						candidateClassIndex: {},
					},
					(err, out) => next(err ? `${moduleName}: property tier: ${err}` : '', { ...args, propertyDecisions: (out || {}).decisions || [] }),
				);
			});

			// ---- VALUE TIER (scoped; ported from edf-inferred -emit --tier=value) -------------------------
			// SCOPE every value source to its parent property's ALREADY-MATCHED CEDS option set. The matched-
			// target index is built DIRECTLY from this rebridge's non-abstain property picks (the recreation
			// has the picks in hand — the incumbent read them back off a materialized mapping block; same set).
			taskList.push((args, next) => {
				const propertyRangeOptionSetIndex = valueScope.buildPropertyRangeOptionSetIndex(args.referenceNodes);
				const optionSetCandidateIndex = valueScope.buildOptionSetCandidateIndex(args.valueCandidates);
				const matchedTargetIndex = {};
				args.propertyDecisions.forEach((oneDecision) => {
					if (oneDecision.abstain || !oneDecision.targetKey) {
						return;
					}
					// one property pick per source (the reranker chooses one) -> no L5 ambiguity here.
					matchedTargetIndex[oneDecision.source.stableId] = {
						targetPropertyKey: oneDecision.targetKey,
						predicate: 'CLOSE_MATCH',
						confidence: typeof oneDecision.cosineScore === 'number' ? oneDecision.cosineScore : null,
						ambiguousTargets: null,
					};
				});
				// sourceRecordsById MUST include the DmeOptionSet intermediates (the 2-hop chain scaffolding)
				// and the DmeProperty parents, not only the value sources being scoped.
				const sourceRecordsById = {};
				args.propertySources.concat(args.valueSources).concat(args.optionSetNodes).forEach((r) => {
					sourceRecordsById[r.stableId] = r;
				});
				const scoped = [];
				const unscopedDecisions = [];
				const unscopableTally = {};
				args.valueSources.forEach((oneValue) => {
					const { scope, unscopableReason } = valueScope.resolveValueParentScope({
						sourceValueRecord: oneValue,
						sourceRecordsById,
						matchedTargetIndex,
						propertyRangeOptionSetIndex,
						rerankerFloor: VALUE_SCOPE_PARENT_FLOOR,
					});
					if (!scope) {
						unscopableTally[unscopableReason] = (unscopableTally[unscopableReason] || 0) + 1;
						unscopedDecisions.push({
							source: { stableId: oneValue.stableId, role: oneValue.role },
							abstain: true,
							abstainReason: 'unscopedParent',
							unscopableReason,
							targetKey: null,
							pool: [],
						});
						return;
					}
					scoped.push({ sourceRecord: oneValue, scope, candidates: optionSetCandidateIndex[scope.rangeOptionSetId] || [] });
				});
				xLog.status(`  [${moduleName}] value tier: ${args.valueSources.length} DmeOptionValue; scoped=${scoped.length}, unscoped=${unscopedDecisions.length} byReason=${JSON.stringify(unscopableTally)}`);
				next('', { ...args, scoped, unscopedDecisions });
			});
			// EXACT-SHORTCUT split (deterministic, no LLM) — a scoped value whose name/notation matches ONE
			// candidate resolves immediately to the composite '${targetPropertyKey}|${OVtoken}'.
			taskList.push((args, next) => {
				const exactDecisions = [];
				const needsLlm = [];
				args.scoped.forEach((oneScoped) => {
					const { hit } = valueScope.exactShortcut(oneScoped.sourceRecord, oneScoped.candidates);
					if (hit) {
						exactDecisions.push({
							source: { stableId: oneScoped.sourceRecord.stableId, role: oneScoped.sourceRecord.role },
							abstain: false,
							abstainReason: null,
							targetKey: `${oneScoped.scope.targetPropertyKey}|${hit.canonicalKey}`,
							chosenStableId: hit.stableId,
							cosineScore: 1.0,
							bestCosine: 1.0,
							retrievalRank: 1,
							pool: [{ stableId: hit.stableId, cedsId: hit.canonicalKey, cosine: 1.0 }],
							scopeParentPredicate: oneScoped.scope.parentPredicate,
							scopeParentConfidence: oneScoped.scope.parentConfidence,
						});
					} else {
						needsLlm.push(oneScoped);
					}
				});
				next('', { ...args, exactDecisions, needsLlm });
			});
			// SCOPED VECTORIZE + RERANK for the exact-shortcut misses (per-source pool via candidatePoolForSource).
			taskList.push((args, next) => {
				if (args.needsLlm.length === 0) {
					next('', { ...args, valueLlmDecisions: [] });
					return;
				}
				const sourceRecords = args.needsLlm.map((n) => n.sourceRecord);
				const candidateUnion = [];
				const seen = new Set();
				args.needsLlm.forEach((n) => {
					n.candidates.forEach((c) => {
						if (!seen.has(c.stableId)) {
							seen.add(c.stableId);
							candidateUnion.push(c);
						}
					});
				});
				const allRecords = candidateUnion.concat(sourceRecords);
				vectorize.batchEmbed({ texts: allRecords.map((r) => r.defText) }, (err, result) => {
					if (err) {
						next(`${moduleName}: vectorizing value defTexts: ${err}`);
						return;
					}
					allRecords.forEach((r, i) => { r.vector = result.vectors[i]; });
					next('', args);
				});
			});
			taskList.push((args, next) => {
				if (args.needsLlm.length === 0) {
					next('', { ...args, valueLlmDecisions: [] });
					return;
				}
				const candidatesBySourceId = {};
				const scopeBySourceId = {};
				args.needsLlm.forEach((n) => {
					candidatesBySourceId[n.sourceRecord.stableId] = n.candidates;
					scopeBySourceId[n.sourceRecord.stableId] = n.scope;
				});
				const sources = args.needsLlm.map((n) => n.sourceRecord);
				const candidatePoolForSource = (source) => candidatesBySourceId[source.stableId] || [];
				pipeline.processSources(
					{ sources, candidatePoolByRole: {}, candidatePoolForSource, sourceClassIndex: {}, candidateClassIndex: {} },
					(err, out) => {
						if (err) {
							next(`${moduleName}: value tier: ${err}`);
							return;
						}
						// gate below the value abstain floor, then REWRITE targetKey to the COMPOSITE
						// '${matchedPropertyKey}|${OVtoken}' (the OV token is the chosen candidate's canonicalKey,
						// looked up by chosenStableId — never a bare OV, which baseValueRef cannot resolve).
						const gated = (out.decisions || []).map((oneDecision) => {
							if (!oneDecision.abstain && typeof oneDecision.cosineScore === 'number' && oneDecision.cosineScore < VALUE_ABSTAIN_FLOOR) {
								return { ...oneDecision, abstain: true, abstainReason: 'belowValueFloor', targetKey: null };
							}
							if (!oneDecision.abstain && oneDecision.targetKey) {
								const scope = scopeBySourceId[oneDecision.source.stableId] || {};
								const pool = candidatesBySourceId[oneDecision.source.stableId] || [];
								const chosen = pool.find((c) => c.stableId === oneDecision.chosenStableId);
								const ovToken = chosen ? chosen.canonicalKey : oneDecision.targetKey;
								return {
									...oneDecision,
									targetKey: `${scope.targetPropertyKey}|${ovToken}`,
									scopeParentPredicate: scope.parentPredicate,
									scopeParentConfidence: scope.parentConfidence,
								};
							}
							return oneDecision;
						});
						next('', { ...args, valueLlmDecisions: gated });
					},
				);
			});

			// FREEZE all decisions (property + value exact + value llm + value unscoped) -> content-addressed
			// block, then SAVE to the decisionStore.
			taskList.push((args, next) => {
				const allDecisions = args.propertyDecisions
					.concat(args.exactDecisions)
					.concat(args.valueLlmDecisions)
					.concat(args.unscopedDecisions);
				const frozen = freezer.freeze({
					pairStamp: { subjectSource: sourceStandardKey, subjectVersion, objectSource: HUB_STANDARD, objectVersion },
					decisions: allDecisions,
				});
				decisionStore.saveDecisionBlock(
					{ pairKey, frozenText: frozen.frozenText, decisionBlockHash: frozen.decisionBlockHash },
					(err) => next(err ? `${moduleName}: saving frozen decision block: ${err}` : '', { ...args, frozen, allDecisions }),
				);
			});

			// MATERIALIZE the frozen picks + WRITE (both tiers; inferredIndex resolves property tokens via
			// basePropertyRef and composite value keys via baseValueRef).
			taskList.push((args, next) => {
				buildAndWrite(
					{
						inferredDecisions: args.frozen.inferredDecisions,
						sourceNodes: args.propertySources.concat(args.valueSources),
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
				const abstains = args.allDecisions.filter((d) => d.abstain).length;
				finish('', {
					edgesWritten: args.edgesWritten,
					decisionBlock: args.frozen.decisionBlockHash,
					producer: 'inferred',
					counts: {
						inferred: args.edgesWritten,
						mode: 'rebridge',
						decisionsConsidered: args.allDecisions.length,
						picks: args.allDecisions.length - abstains,
						abstains,
						propertySources: args.propertySources.length,
						valueSources: args.valueSources.length,
						valueScoped: args.scoped.length,
						orphans: args.subgraph.counts.orphans,
						fromGaps: args.subgraph.counts.fromGaps,
					},
				});
			});
		};

		// finish — close the reader (whether or not the run succeeded; the writer is closed by bridgeMaker).
		const finish = (runError, result) => {
			reader.close((closeErr) => {
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

		if (rebridge) {
			runRebridge();
		} else {
			runMaterialize();
		}
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction;
