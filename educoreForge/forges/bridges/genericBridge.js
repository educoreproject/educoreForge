'use strict';

// genericBridge — Phase 4 (bridgeEvidenceRefactor-spec.md §7 P4): the REAL generic bridge PORTED onto
// the EVIDENCE path. Every prior generation of this file narrated its own history in this header; this
// one continues that discipline. Phase 2/3 (bridgeKitRefactor_072726): genericBridge was "the skeleton
// filled for the generic inferred SCALAR case" — a thin construction call over
// apps/graph-builder/apps/bridge-maker/lib/bridgeSkeleton.js, reproducing semanticBridge's decisions
// byte-identically (test-generic-bridge-equivalence.js, RETIRED by this phase — see
// test/test-generic-bridge-evidence.js's tombstone comment for why that claim is now FALSE BY DESIGN).
//
// P4 makes genericBridge the EVIDENCE-MODE DEMONSTRATOR: it composes kit.evidenceComposer (with the
// REAL kit.cedsHubModule, R5) -> the ⟪A3⟫ evidence-package shape gate -> kit.evidenceRenderer ->
// kit.evidenceSelect (the kit's llmClient, injected via kit.inferenceConfig at CALL time per
// SELECT_SHAPE) -> kit.confidenceNormalizer -> kit.evidenceFreezer (+ kit.decisionStore save/load) ->
// kit.materializer (lib/inferredIndex.js, UNCHANGED) + kit.writer for edges. TWO modes, unchanged in
// spirit from every bridge in this tree: MATERIALIZE (replay a frozen evidence-decision record, ZERO
// LLM calls, pure) and REBRIDGE (the full evidence flow, one non-deterministic step: evidenceSelect).
//
// ⟪A9⟫ — semanticBridge (bridge-maker/bridges/semanticBridge.js) is the SCALAR COMPARATOR and survives
// BYTE-UNTOUCHED, together with its own skeleton path (bridgeSkeleton.js, unmodified by this file —
// see the SKELETON-VS-DIRECT decision below) and inferencePipeline.js. Nothing in this port touches any
// of the three.
//
// =====================================================================
// SKELETON-VS-DIRECT — the ONE construction choice this phase's work order leaves to the Programmer
// Milo, justified here in full (the order asked for "one line"; this is the one line plus the reasoning
// a reviewer will want, kept together with the choice itself rather than only in the final report):
// =====================================================================
// genericBridge does NOT build on apps/graph-builder/apps/bridge-maker/lib/bridgeSkeleton.js anymore.
// bridgeSkeleton.js is a REUSABLE SHELL purpose-built for the SCALAR five-move loop (walk/match/select/
// freeze/materialize, each independently overridable, but the SHAPE of the loop — one scored pool, one
// scalar decision per source — is fixed by the shell itself) and it has a SECOND live consumer today:
// forges/case/bridges/caseStructuralBridge.js (Phase 5's one-move-override demonstration), which per
// ⟪A9⟫ must keep running byte-identically through P5, when it is re-expressed onto these SAME evidence
// seams and the scalar path is finally torn out. The evidence flow this file composes is not a sixth
// move bolted onto that shell — it is a STRUCTURALLY DIFFERENT pipeline (a composer producing a UNION
// POOL + prompt segments, a named renderer, a category-out judge, a deterministic normalizer, a
// SECOND freezer with its own record type) with its own mode dispatch, its own kit-member requirements,
// and its own result enrichment (confidence normalization before materializing). Grafting that shape
// onto bridgeSkeleton's five fixed slots would mean either (a) contorting the shell with evidence-
// specific parameters until it no longer resembles "the generic scalar shell" caseStructuralBridge
// still depends on, or (b) adding an evidence-mode branch inside the shell that the scalar bridges
// never exercise but that still shares the shell's construction-time validation, requiredKitMembersFor
// list, and run() dispatch — both risk perturbing the ONE file a live scalar bridge composes today.
// Composing the evidence flow DIRECTLY in this file, following the SAME house style bridgeSkeleton.js
// itself documents (qtools curried moduleFunction; wiring-fault refusals stated by name at both
// construction and run time; taskListPlus/pipeRunner sequencing; the SAME { edgesWritten, decisionBlock,
// producer, counts } result shape; write ONLY through kit.writer), keeps bridgeSkeleton.js — and
// therefore caseStructuralBridge's own byte-identical behavior — completely unperturbed, while giving
// the evidence pipeline a shape that fits what it actually is. semanticBridge.js itself set this exact
// precedent: it is a standalone bridge module, not skeleton-built, and this file now follows that same
// structural pattern for the same reason (a bridge whose pipeline shape does not match the shell's).
//
// =====================================================================
// R-b DISPOSITION — WHERE category/rationale LIVE ON (NOT on) THE EDGE:
// =====================================================================
// Per the P3 boundary review's rider R-b (evidenceContracts.js CONTRACT_STATUS, now HARDENED) and
// carried forward here: category and rationale are NOT promoted to first-class edge properties.
// lib/inferredIndex.js — the SHARED materializer semanticBridge, caseStructuralBridge, and this bridge
// ALL compose via kit.materializer — is BYTE-UNTOUCHED by this port; its fixed decision-row field list
// (confidence, rerankScore, cosineScore, retrievalRank, ...) has no category/rationale slot, and adding
// one would touch the ONE module the scalar comparator also depends on. Instead:
//   - confidence IS promoted onto the edge, using the EXISTING `confidence` slot inferredIndex.js
//     already reads off each inferredDecisions row — but the value written there is now the NORMALIZED
//     confidence (kit.confidenceNormalizer's output), not a raw cosine/rerank score, satisfying the work
//     order's "confidence now the NORMALIZED value" literally, through a slot that already existed.
//   - category/rationale/normalizedConfidence all ride together inside the FROZEN decision block's
//     `frozenEvidence[i].judgment` (one entry per source, keyed by sourceStableId) — retrievable by any
//     reader that loads the pair's frozen block (kit.decisionStore.getDecisionBlock({pairKey}) then
//     kit.evidenceFreezer.parse(frozenText)) and reads `.frozenEvidence` for the source in question.
//     This is NOT a workaround; it is the disposition R-b itself already named as correct for P3, and
//     P4 (this port) never had a reason to promote them further.
//   - generation/rendererVersion (⟪A6⟫) are stamped onto the DECISION BLOCK by kit.evidenceFreezer.freeze
//     (required construction fields), NOT onto individual edges — this bridge's OWN run() result
//     additionally surfaces them (result.generation / result.rendererVersion, additive to the declared
//     BRIDGE_MODULE_SHAPE result keys) so a caller never has to re-parse the frozen block just to learn
//     which generation/renderer produced the edges it is looking at.
//
// THE BRIDGE CONTRACT (interfaces.js @interface BridgeModule / BRIDGE_MODULE_SHAPE), unchanged:
//   bridgeModule({ ...injected library, kit })({ inGraph, hub, applyLabel }, cb)
//       -> cb('', { edgesWritten, counts, decisionBlock })
// COMPOSES injectedTools.kit EXCLUSIVELY (bridgeMaker's ADDITIVE lib.d kit) — every write travels
// through kit.writer (the guarded relationshipWriter), never a raw connection; this file contains no
// neo4j-driver require, no neo4jGraphWriter require, and never reads the raw connection-credential
// fields the GraphHandle carries
// (bridgeMaker's shape gate's negative substrate scan reads THIS file's bytes, exactly as before).
//
// SCOPE — carried forward unchanged from every prior phase: ONE role/tier per pair (config.role,
// default 'DmeProperty'), the LIF pilot's property-tier scope; value-tier scoping (lib/valueScope.js,
// semanticBridge's own CTDL-specific logic) is not reproduced here, same boundary as before.
//
// HUB — unchanged: this bridge bridges toward CEDS only (HUB_STANDARD below).
//
// House style: qtools curried moduleFunction; callback(errString, result) with '' on success; no
// async/await or try/catch for control flow; taskListPlus/pipeRunner; refuse-by-value (polyArch2 §6);
// camelCase, compound names. Deep relative `require`s to the tree-root `lib/` follow the SAME
// established convention this tree's own bridge-maker/lib modules already use (bridgeSkeleton.js,
// evidenceComposer.js, evidenceFreezer.js, inferredIndex.js, referenceIndex.js all reach lib/vocabulary
// or lib/content-address this way, each documenting its own exact depth) — matched here rather than
// introduced as a new, inconsistent mechanism.

const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// content-address — 2 levels up from forges/bridges to the tree root (forges/bridges -> forges -> root;
// bridgeMaker.js's own FORGES_DIR constant confirms this exact depth: TREE_ROOT is 4 levels up from
// apps/graph-builder/apps/bridge-maker, and FORGES_DIR = TREE_ROOT/forges).
const contentAddress = require(path.join(__dirname, '..', '..', 'lib', 'content-address', 'content-address'))();

// flattenFullRecord — the kit's own exported static (lib.d/sourceWalker.js), NOT reachable through an
// instantiated kit.sourceWalker (which exposes only `{ walk }`) — needed here exactly the way the prior
// phase's genericBridge.js reused flattenCandidateRecord directly rather than duplicating the mapping.
// Pure, stateless, never a connection; never trips bridgeMaker's negative substrate scan.
const sourceWalkerModule = require(
	path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib.d', 'sourceWalker'),
);
const flattenFullRecord = sourceWalkerModule.flattenFullRecord;

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// =====================================================================
// IDENTITY — this bridge's own choices (the ~10% every generic-inferred bridge in this tree supplies).
// =====================================================================
const MAPPING_TOOL = 'genericBridge';
const HUB_STANDARD = 'CEDS';
const HUB_REFERENCE_LABEL = 'HubReference';
const DEFAULT_ROLE = 'DmeProperty';
const MATERIALIZER_CONFIG = { predicate: 'closeMatch', mappingJustification: 'semapv:SemanticSimilarity' };

// EVIDENCE_GENERATION — the ⟪A6⟫ generation tag every frozen block self-describes (R4: new evidence +
// prompt => new picks by design => the inferred edges are a NEW generation). A FIXED pipeline-version
// string, not a timestamp — replay stays byte-exact within one generation (R4). Bump this string
// whenever the evidence pipeline's own wiring (composer/renderer/select/normalizer, or which kit modules
// they compose) changes in a way that could change picks over the SAME graph state — exactly the same
// discipline RENDERER_VERSION applies to the renderer alone, one level up at the whole-pipeline scope.
const EVIDENCE_GENERATION = 'genericBridge-evidence-v1';

// HUB_SEGMENTS — composition-order slot 2 (RENDERER_COMPOSITION_ORDER[1], evidenceRenderer.js), the
// hub-level framing this bridge (CEDS-only, HUB_STANDARD fixed) always supplies. A small, FIXED array —
// genericBridge nominates nothing standard-specific (no custom composer nominate/walk hook, §the
// composer construction below), so this is the one piece of prompt framing it contributes beyond the
// renderer's own base abstain-first instruction.
const HUB_SEGMENTS = [
	'Judge every candidate against its authoritative CEDS tuple evidence below — the domain(s), range, ' +
		'qualifier, and value-scope facts — not by surface wording alone.',
];

// asList — PG-JSON single-element collapse guard (the SAME helper every reader of a possibly-list
// HubReference property in this tree defines locally: cedsHubModule.js, referenceIndex.js).
const asList = (value) =>
	Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];

// targetKeyFor — the materializer-resolvable key for a CHOSEN HubReference candidate (the raw,
// flattenFullRecord-shaped element evidenceSelect's selectResult.pick carries). Mirrors
// referenceIndex.js's OWN key-construction rules exactly (basePropertyRef / qualifiedRef / baseValueRef,
// see apps/graph-builder/apps/bridge-maker/lib/referenceIndex.js), because lib/inferredIndex.js (this
// bridge's materializer) resolves a chosen target ONLY through basePropertyRef/baseValueRef — it does
// NOT consult qualifiedRef at all (inferredIndex.js destructures only the first two). Consequence,
// FLAGGED for the boundary review: a picked QUALIFIED property-tier candidate's composite key
// ('${propertyKey}|${qualifierKey}') therefore resolves in NEITHER map and becomes a counted ORPHAN
// (subgraph.counts.orphans) — SAFE (no edge materializes) rather than DANGEROUS (the bare canonicalKey
// would silently resolve to the UNQUALIFIED base HubReference, a DIFFERENT node, since basePropertyRef
// is populated only for qualifierKeys.length===0 refs). This is an existing lib/inferredIndex.js
// limitation (shared with the authored track's own qualifiedRef, also unread by inferredIndex.js), not
// introduced by this port; genericBridge's ONLY obligation here is to never manufacture a targetKey that
// COLLIDES with the wrong node, which fail-safe-to-orphan achieves. The qualified population is small
// (27 of 2351 property-tier refs, P0 §2.5) and orphaning them is the honest, safe behavior until
// inferredIndex.js is taught qualifiedRef (out of P4 scope — a materializer change, not a bridge change).
const targetKeyFor = (candidate) => {
	if (candidate.referenceTier === 'value') {
		return `${candidate.propertyKey}|${candidate.valueKey || candidate.canonicalKey}`;
	}
	const qualifierKeys = asList(candidate.qualifierKeys);
	if (qualifierKeys.length > 0) {
		return `${candidate.propertyKey}|${qualifierKeys[0]}`;
	}
	return candidate.canonicalKey;
};

// confidenceLookupFromFrozenEvidence — sourceStableId -> normalizedConfidence, built from the
// frozenEvidence PAYLOAD this bridge itself shapes (an array of { sourceStableId, evidencePackage,
// judgment }, see runRebridge below). Used IDENTICALLY by both modes: REBRIDGE builds it fresh from the
// per-source results it just computed; MATERIALIZE rebuilds it from the frozen block's own
// frozenEvidence array (parse() reads it back verbatim, byte-identical — replay never re-judges).
const confidenceLookupFromFrozenEvidence = (frozenEvidenceArray) => {
	const lookup = {};
	(frozenEvidenceArray || []).forEach((oneEntry) => {
		if (oneEntry && oneEntry.sourceStableId && oneEntry.judgment) {
			lookup[oneEntry.sourceStableId] = oneEntry.judgment.normalizedConfidence;
		}
	});
	return lookup;
};

// enrichInferredDecisionsWithConfidence — R-b disposition (see file header): lib/inferredIndex.js reads
// `confidence` off each inferredDecisions row but evidenceFreezer.js's own nonAbstainRow (a DIFFERENT,
// byte-untouched module — see the header) never carries one. This bridge closes that gap itself,
// entirely within its own file: merge the NORMALIZED confidence (looked up by fromStableId) onto each
// row before handing it to the materializer. A row with no matching lookup entry (should not happen —
// every non-abstain decision has a judgment) is left with confidence undefined, and inferredIndex.js's
// own `typeof ... === 'number' ? ... : 0` fallback stamps an honest 0 rather than crashing.
const enrichInferredDecisionsWithConfidence = (inferredDecisions, confidenceLookup) =>
	(inferredDecisions || []).map((oneRow) => ({
		...oneRow,
		confidence: confidenceLookup[oneRow.fromStableId],
	}));

// requiredKitMembersFor — the kit members THIS bridge needs, given rebridge vs. materialize (mirrors
// bridgeSkeleton.js's own requiredKitMembersFor discipline, restated here since this file no longer
// composes that shell — see the SKELETON-VS-DIRECT decision above).
const requiredKitMembersFor = (rebridge) => {
	const list = ['sourceWalker', 'graphReader', 'evidenceFreezer', 'materializer', 'writer'];
	if (rebridge) {
		list.push(
			'vectorizer',
			'semanticMatcher',
			'evidenceComposer',
			'cedsHubModule',
			'evidenceRenderer',
			'evidenceSelect',
			'confidenceNormalizer',
		);
	}
	return list;
};

// START OF the produced BridgeModule callable ============================================

module.exports = (injectedTools = {}) =>
	({ inGraph, hub, applyLabel }, callback) => {
		const { kit } = injectedTools;

		if (!kit || typeof kit !== 'object') {
			callback(
				`${MAPPING_TOOL}: injectedTools.kit is not given — this bridge composes ONLY the injected ` +
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
				`${MAPPING_TOOL}: kit.${missingKitMember} is missing (kit.rebridge=${!!kit.rebridge}) — the ` +
					`injected lib.d kit did not supply it; there is no default.`,
			);
			return;
		}
		if (!kit.decisionStore || typeof kit.decisionStore.getDecisionBlock !== 'function') {
			callback(
				`${MAPPING_TOOL}: kit.decisionStore (getDecisionBlock/saveDecisionBlock) is REQUIRED — a ` +
					`frozen evidence-decision block is read from it on a plain build and written to it on ` +
					`--rebridge; there is no default.`,
			);
			return;
		}
		if (kit.rebridge && (!kit.inferenceConfig || typeof kit.inferenceConfig.llmClient !== 'object' || !kit.inferenceConfig.llmClient || typeof kit.inferenceConfig.llmClient.rerank !== 'function')) {
			callback(
				`${MAPPING_TOOL}: kit.inferenceConfig.llmClient (rerank) is missing — --rebridge needs a kit ` +
					`built with inferenceConfig.llmClient; kit.evidenceSelect takes it at CALL time (SELECT_SHAPE), ` +
					`not construction, so it must arrive via kit.inferenceConfig; there is no default.`,
			);
			return;
		}
		if (!inGraph) {
			callback(`${MAPPING_TOOL}: inGraph is not given — there is no graph to read the source/${HUB_STANDARD} nodes from.`);
			return;
		}
		if (hub !== null && hub !== undefined && `${hub}`.toUpperCase() !== HUB_STANDARD) {
			callback(`${MAPPING_TOOL}: hub is '${hub}', but this bridge bridges toward the ${HUB_STANDARD} hub only.`);
			return;
		}
		if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
			callback(
				`${MAPPING_TOOL}: applyLabel is ${
					applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)
				} — it is the label harvest selects the written edges by; there is no default.`,
			);
			return;
		}

		const config = kit.config || {};
		const sourceStandard = config.sourceStandard || config.source;
		if (typeof sourceStandard !== 'string' || sourceStandard.trim() === '') {
			callback(
				`${MAPPING_TOOL}: config.sourceStandard is not set — the generic producer must be told which ` +
					`source standard it bridges (a generic plugin serves every pair); there is no default.`,
			);
			return;
		}
		// THE CASE RULE (lib.d/sourceWalker.js): the recipe token is lowercase; forged `_source` is
		// uppercase. Read and stamp by the uppercase key.
		const sourceStandardKey = sourceStandard.toUpperCase();
		const subjectVersion = config.sourceVersion || '';
		const objectVersion = config.hubVersion || '';
		const role = config.role || DEFAULT_ROLE;
		const pairKey = `${HUB_STANDARD}::${sourceStandardKey}`;

		// readReferenceNodes — the RAW HubReference nodes, flattened to FULL records (spec §5). Serves
		// TWO purposes, exactly as bridgeSkeleton's own version did: the materializer's resolution index
		// (referenceIndex.js, unchanged) AND, in REBRIDGE mode, the evidence composer's candidate pool.
		const readReferenceNodes = (done) => {
			kit.graphReader.readNodes({ label: HUB_REFERENCE_LABEL, propertyEquals: {} }, (err, out) =>
				done(
					err ? `${MAPPING_TOOL}: reading ${HUB_STANDARD} ${HUB_REFERENCE_LABEL} nodes: ${err}` : '',
					(out || {}).nodes || [],
				),
			);
		};

		// buildAndWrite — the SHARED tail of both modes: materialize the (confidence-enriched) frozen
		// picks into edges via kit.materializer (lib/inferredIndex.js, BYTE-UNTOUCHED) and WRITE each
		// through kit.writer. Given the same frozen decisions + reference nodes it is byte-identical, so
		// replay == rebridge regardless of mode — the SAME invariant every bridge in this tree holds.
		const buildAndWrite = ({ inferredDecisions, sourceNodes, referenceNodes, decisionBlockHash }, done) => {
			const builder = kit.materializer({
				...MATERIALIZER_CONFIG,
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
								n2(`${MAPPING_TOOL}: writing ${oneEdge.type} ${oneEdge.fromRef.id} -> ${oneEdge.toRef.id}: ${err}`);
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

		// ================= MATERIALIZE (plain -build) — pure replay of a frozen EVIDENCE block, ZERO LLM
		// ================= calls: no composer, no hubModule, no renderer, no evidenceSelect is ever
		// ================= invoked — the normalized confidence + category/rationale are READ BACK from
		// ================= the frozen text, never recomputed.
		const runMaterialize = () => {
			kit.decisionStore.getDecisionBlock({ pairKey }, (loadErr, loaded) => {
				if (loadErr) {
					finish(`${MAPPING_TOOL}: loading frozen evidence-decision block for ${pairKey}: ${loadErr}`);
					return;
				}
				const frozenText = loaded && loaded.frozenText;
				if (!frozenText) {
					// NO frozen block for this pair -> NO inferred edges. Explicit, no spend, no graph read.
					finish('', {
						edgesWritten: 0,
						decisionBlock: null,
						producer: 'inferred',
						generation: null,
						rendererVersion: null,
						counts: { inferred: 0, mode: 'materialize', noDecisionBlock: true },
					});
					return;
				}
				const parsed = kit.evidenceFreezer.parse(frozenText);
				if (parsed.error) {
					finish(parsed.error);
					return;
				}
				const decisionBlockHash = contentAddress.blockIdForText(frozenText);
				const confidenceLookup = confidenceLookupFromFrozenEvidence(parsed.frozenEvidence);
				const enrichedInferredDecisions = enrichInferredDecisionsWithConfidence(parsed.inferredDecisions, confidenceLookup);

				const taskList = new taskListPlus();
				taskList.push((args, next) =>
					kit.sourceWalker.walk({ standard: sourceStandardKey, role, flatten: flattenFullRecord }, (err, out) =>
						next(err, { ...args, sourceNodes: out && out.sourceNodes }),
					),
				);
				taskList.push((args, next) => readReferenceNodes((err, nodes) => next(err, { ...args, referenceNodes: nodes })));
				taskList.push((args, next) => {
					buildAndWrite(
						{ inferredDecisions: enrichedInferredDecisions, sourceNodes: args.sourceNodes, referenceNodes: args.referenceNodes, decisionBlockHash },
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
						generation: parsed.generation,
						rendererVersion: parsed.rendererVersion,
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

		// ================= REBRIDGE — walk -> vectorize -> per-source(compose -> gate -> render -> select
		// ================= -> normalize) -> freeze -> save -> materialize -> write. The ONE
		// ================= non-deterministic step is evidenceSelect (the injected llmClient); everything
		// ================= else is pure/deterministic.
		const runRebridge = () => {
			const composer = kit.evidenceComposer({ semanticMatcher: kit.semanticMatcher });
			const llmClient = kit.inferenceConfig.llmClient;

			const taskList = new taskListPlus();

			// WALK — the source standard's FULL elements (spec §5 retrieval-enrichment reversal).
			taskList.push((args, next) =>
				kit.sourceWalker.walk({ standard: sourceStandardKey, role, flatten: flattenFullRecord }, (err, out) =>
					next(err, { ...args, sourceNodes: out && out.sourceNodes }),
				),
			);
			// the FULL CEDS HubReference candidate elements (R5's base evidence source, all tiers).
			taskList.push((args, next) =>
				readReferenceNodes((err, nodes) =>
					next(err, { ...args, referenceNodes: nodes, candidateElements: nodes.map(flattenFullRecord) }),
				),
			);

			// VECTORIZE (NET) — embed every source + candidate defText (flattenFullRecord's own fallback
			// chain resolves defText to `name` for a HubReference node, which carries no defText field of
			// its own — P0-cedsTupleModel.md §2.1). Fixed orchestration, not a move.
			taskList.push((args, next) => {
				const allRecords = args.candidateElements.concat(args.sourceNodes);
				kit.vectorizer.batchEmbed({ texts: allRecords.map((r) => r.defText) }, (err, result) => {
					if (err) {
						next(`${MAPPING_TOOL}: vectorizing defTexts: ${err}`);
						return;
					}
					allRecords.forEach((r, i) => {
						r.vector = result.vectors[i];
					});
					next('', args);
				});
			});

			// PER-SOURCE: compose -> ⟪A3⟫ gate -> render -> select -> normalize.
			taskList.push((args, next) => {
				const decisions = [];
				const frozenEvidencePayload = [];
				const perSourceTask = new taskListPlus();
				args.sourceNodes.forEach((oneSource) => {
					perSourceTask.push((a2, n2) => {
						composer(
							{ sourceElement: oneSource, candidateElements: args.candidateElements, graphReader: kit.graphReader, hubModule: kit.cedsHubModule },
							(composeErr, evidencePackage) => {
								if (composeErr) {
									n2(`${MAPPING_TOOL}: composing evidence for ${oneSource.stableId}: ${composeErr}`);
									return;
								}
								kit.evidenceRenderer.render(evidencePackage, HUB_SEGMENTS, {}, (renderErr, promptText) => {
									if (renderErr) {
										n2(`${MAPPING_TOOL}: rendering evidence for ${oneSource.stableId}: ${renderErr}`);
										return;
									}
									kit.evidenceSelect({ promptText, pool: evidencePackage.pool }, llmClient, (selectErr, selectResult) => {
										if (selectErr) {
											n2(`${MAPPING_TOOL}: selecting for ${oneSource.stableId}: ${selectErr}`);
											return;
										}
										const bestCosine = evidencePackage.pool.length ? evidencePackage.pool[0].cosine : -1;
										const chosenEntry = selectResult.abstain
											? null
											: evidencePackage.pool.find((oneEntry) => oneEntry.candidate === selectResult.pick);
										const retrievalCosine = chosenEntry ? chosenEntry.cosine : bestCosine;
										kit.confidenceNormalizer(selectResult.category, retrievalCosine, {}, (normalizeErr, normalizedConfidence) => {
											if (normalizeErr) {
												n2(`${MAPPING_TOOL}: normalizing confidence for ${oneSource.stableId}: ${normalizeErr}`);
												return;
											}
											const ordinal = chosenEntry ? evidencePackage.pool.indexOf(chosenEntry) + 1 : null;
											decisions.push({
												source: { stableId: oneSource.stableId, role: oneSource.role },
												abstain: selectResult.abstain,
												abstainReason: selectResult.abstain ? 'evidenceAbstain' : null,
												targetKey: selectResult.abstain ? null : targetKeyFor(selectResult.pick),
												chosenStableId: selectResult.abstain ? null : selectResult.pick.stableId,
												retrievalRank: ordinal,
												cosineScore: retrievalCosine,
											});
											frozenEvidencePayload.push({
												sourceStableId: oneSource.stableId,
												evidencePackage,
												judgment: { category: selectResult.category, rationale: selectResult.rationale, normalizedConfidence },
											});
											n2('', a2);
										});
									});
								});
							},
						);
					});
				});
				pipeRunner(perSourceTask.getList(), {}, (err) => next(err, { ...args, decisions, frozenEvidencePayload }));
			});

			// FREEZE all decisions + the frozen evidence payload -> content-addressed block, self-
			// describing generation/rendererVersion (⟪A6⟫), then SAVE to the decisionStore.
			taskList.push((args, next) => {
				const frozen = kit.evidenceFreezer.freeze({
					pairStamp: { subjectSource: sourceStandardKey, subjectVersion, objectSource: HUB_STANDARD, objectVersion },
					decisions: args.decisions,
					generation: EVIDENCE_GENERATION,
					rendererVersion: kit.evidenceRenderer.RENDERER_VERSION,
					evidencePackages: args.frozenEvidencePayload,
				});
				kit.decisionStore.saveDecisionBlock(
					{ pairKey, frozenText: frozen.frozenText, decisionBlockHash: frozen.decisionBlockHash },
					(err) => next(err ? `${MAPPING_TOOL}: saving frozen evidence-decision block: ${err}` : '', { ...args, frozen }),
				);
			});

			// MATERIALIZE the frozen picks (confidence-enriched) + WRITE.
			taskList.push((args, next) => {
				const confidenceLookup = confidenceLookupFromFrozenEvidence(args.frozenEvidencePayload);
				const enrichedInferredDecisions = enrichInferredDecisionsWithConfidence(args.frozen.inferredDecisions, confidenceLookup);
				buildAndWrite(
					{
						inferredDecisions: enrichedInferredDecisions,
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
					generation: EVIDENCE_GENERATION,
					rendererVersion: kit.evidenceRenderer.RENDERER_VERSION,
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

		// finish — close the kit's graphReader (this bridge is the one that decided when it was done
		// reading, so it owns closing it). kit.writer rides on the graphWriter bridgeMaker itself closes.
		const finish = (runError, result) => {
			kit.graphReader.close((closeErr) => {
				if (runError) {
					callback(closeErr ? `${runError} (and the graph reader also failed to close: ${closeErr})` : runError);
					return;
				}
				if (closeErr) {
					callback(`${MAPPING_TOOL}: produced ${result.edgesWritten} edge(s) but the graph reader failed to close: ${closeErr}`);
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

module.exports.MAPPING_TOOL = MAPPING_TOOL;
module.exports.HUB_STANDARD = HUB_STANDARD;
module.exports.EVIDENCE_GENERATION = EVIDENCE_GENERATION;
module.exports.targetKeyFor = targetKeyFor;
module.exports.confidenceLookupFromFrozenEvidence = confidenceLookupFromFrozenEvidence;
module.exports.enrichInferredDecisionsWithConfidence = enrichInferredDecisionsWithConfidence;
