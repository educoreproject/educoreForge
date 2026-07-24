'use strict';

// semanticBridge — the INFERRED `CLOSE_MATCH` producer (P3a; design §1 "a default generic plugin", §2 the
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
// THE FREEZE SEAM (design §2): the select step does NOT write to the graph. rebridge freezes the pipeline's
// decisions into a content-addressed block first; the SAME pure inferredIndex then writes edges from the
// frozen decisions in BOTH modes — so a replay (plain -build) is byte-identical to the rebridge that made it
// and never re-runs the LLM (G2).
//
// It reads inGraph, hub and applyLabel off its ONE named-argument object (the shape gate). `hub` names the
// CEDS hub this bridge targets — read here so the producer refuses a graph whose hub is not the one it bridges
// toward. The injected `rebridge` boolean is ALREADY pair-scoped by build.js (§6 no-silent-default: the scope
// match happens where the recipe pair is known, not guessed here).
//
// House style: qtools curried moduleFunction; callback(errString, result) with '' on success; no async/await
// or try/catch for control flow; registry-over-switch; compound names.

const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// This bridge authors the <source> -> CEDS hub SEMANTIC crosswalk. The source standard is read from the
// injected config (a generic plugin serves every semantic pair); the hub is CEDS. These constants have
// nothing to shadow — the plugin IS the semantic producer (polyArch2 §6).
const HUB_STANDARD = 'CEDS';
const HUB_REFERENCE_LABEL = 'HubReference';
const SOURCE_ROLE = 'DmeProperty';
const MAPPING_TOOL = 'semanticBridge';

const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

// flattenSourceRecord / flattenCandidateRecord — a graphReader node ({ stableId, properties }, SCALAR props)
// -> the flat record shape the inferencePipeline + inferredIndex work in (the incumbent's collapseNodes
// output). defText is the definition the retrieval embeds; a candidate's cedsId is the CEDS Global ID token
// the pipeline picks and inferredIndex resolves to a HubReference by canonicalKey.
const flattenNodeRecord = (oneNode) => {
	const props = oneNode.properties || {};
	return {
		stableId: oneNode.stableId,
		role: v1(props.role),
		name: v1(props.name),
		defText: v1(props.defText) || v1(props.description) || v1(props.searchText) || v1(props.name),
		domainId: v1(props.domainId) || null,
		rangeDatatype: v1(props.rangeDatatype) || null,
	};
};

const flattenCandidateRecord = (oneNode) => {
	const props = oneNode.properties || {};
	return {
		...flattenNodeRecord(oneNode),
		// the CEDS Global ID the pipeline emits as targetKey. In the golden the CEDS DmeProperty's cedsId
		// equals the HubReference canonicalKey ('P######'); both keys are read here so the fixture and the
		// real reforge resolve identically. (Real-reforge field confirmation is P3b's; the fixture pins it.)
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
		const subjectVersion = (config && config.sourceVersion) || '';
		const objectVersion = (config && config.hubVersion) || '';
		const pairKey = `${HUB_STANDARD}::${sourceStandard}`;

		const reader = graphReader({ inGraph });
		const freezer = decisionFreezer();

		// buildAndWrite — the SHARED tail of both modes: materialize the frozen picks into CLOSE_MATCH edges
		// (pure, via inferredIndex, stamped with decisionBlockHash) and WRITE each through relationshipWriter.
		// Given the same frozen decisions + reference nodes it is byte-identical, so replay == rebridge (G2).
		const buildAndWrite = ({ inferredDecisions, sourceNodes, referenceNodes, decisionBlockHash }, done) => {
			const builder = inferredIndex({
				predicate: 'closeMatch',
				mappingJustification: 'semapv:SemanticSimilarity',
				subjectSource: sourceStandard,
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

		// readReferenceNodes — the CEDS HubReference nodes (both modes need them to resolve targetKeys).
		const readReferenceNodes = (done) => {
			reader.readNodes({ label: HUB_REFERENCE_LABEL, propertyEquals: {} }, (err, out) =>
				done(err ? `${moduleName}: reading ${HUB_STANDARD} HubReference nodes: ${err}` : '', (out || {}).nodes || []),
			);
		};
		// readSourceNodes — the source standard's bridgeable elements (DmeProperty tier).
		const readSourceNodes = (done) => {
			reader.readNodes({ label: 'ForgedNode', propertyEquals: { _source: sourceStandard, role: SOURCE_ROLE } }, (err, out) =>
				done(err ? `${moduleName}: reading ${sourceStandard} source nodes: ${err}` : '', (out || {}).nodes || []),
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
				taskList.push((args, next) => readSourceNodes((err, nodes) => next(err, { ...args, sourceNodes: nodes.map(flattenNodeRecord) })));
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

			// WALK
			taskList.push((args, next) => readSourceNodes((err, nodes) => next(err, { ...args, sourceRecords: nodes.map(flattenNodeRecord) })));
			taskList.push((args, next) => {
				reader.readNodes({ label: 'ForgedNode', propertyEquals: { _source: HUB_STANDARD, role: SOURCE_ROLE } }, (err, out) =>
					next(err ? `${moduleName}: reading ${HUB_STANDARD} candidate nodes: ${err}` : '', { ...args, candidateRecords: ((out || {}).nodes || []).map(flattenCandidateRecord) }),
				);
			});
			taskList.push((args, next) => readReferenceNodes((err, nodes) => next(err, { ...args, referenceNodes: nodes })));

			// VECTORIZE (NET) — embed source + candidate defTexts, attach .vector in place.
			taskList.push((args, next) => {
				const allRecords = args.candidateRecords.concat(args.sourceRecords);
				vectorize.batchEmbed({ texts: allRecords.map((r) => r.defText) }, (err, result) => {
					if (err) {
						next(`${moduleName}: vectorizing defTexts: ${err}`);
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
						sources: args.sourceRecords,
						candidatePoolByRole: { [SOURCE_ROLE]: args.candidateRecords },
						sourceClassIndex: {},
						candidateClassIndex: {},
					},
					(err, out) => next(err ? `${moduleName}: ${err}` : '', { ...args, decisions: (out || {}).decisions || [] }),
				);
			});

			// FREEZE -> content-addressed block, then SAVE to the decisionStore.
			taskList.push((args, next) => {
				const frozen = freezer.freeze({
					pairStamp: { subjectSource: sourceStandard, subjectVersion, objectSource: HUB_STANDARD, objectVersion },
					decisions: args.decisions,
				});
				decisionStore.saveDecisionBlock(
					{ pairKey, frozenText: frozen.frozenText, decisionBlockHash: frozen.decisionBlockHash },
					(err) => next(err ? `${moduleName}: saving frozen decision block: ${err}` : '', { ...args, frozen }),
				);
			});

			// MATERIALIZE the frozen picks + WRITE.
			taskList.push((args, next) => {
				buildAndWrite(
					{ inferredDecisions: args.frozen.inferredDecisions, sourceNodes: args.sourceRecords, referenceNodes: args.referenceNodes, decisionBlockHash: args.frozen.decisionBlockHash },
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
