'use strict';

// =====================================================================
// VALUE-TIER RELIC (P5 teardown ruling, 2026-07-30): the property-tier scalar path is superseded by
// the evidence architecture (see genericBridge/caseEvidenceBridge); this module survives ONLY as the
// sole value-tier implementation. Do not extend; do not use for new property-tier work; dies when
// value-tier is re-expressed on the evidence path.
// (This module is ALSO reused, unmodified, as the evidence path's kit.materializer — see
// kitLoader.js/genericBridge.js — so it is NOT dead code; only the VALUE-TIER call shape it serves
// through semanticBridge/inferencePipeline is the relic.)
// =====================================================================

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// inferredIndex.js — the PURE, deterministic INFERRED-track materializer (design §3, the bridge library's
// inferred materialize seam; implementationPlan_bridge_072426 §8). It is the FAITHFUL PORT of the incumbent
// npm/qtools-graph-forge-core/lib/inferred-subgraph/inferredSubgraph.js into the recreation (P3a). The ONLY
// changes from the incumbent are the two require repoints: `vocabulary` -> the recreation's
// lib/vocabulary/vocabulary, and the reference resolver -> the recreation's referenceIndex.js (the ported
// mappingSubgraph, which exposes the SAME buildReferenceIndex). The resolution logic, the dedup/order and
// the emitted edge shape are byte-for-byte the incumbent's. This is the twin of how referenceIndex.js was
// ported from mappingSubgraph.js (P2) and referenceSubgraph.js from reference-subgraph (hub).
//
// It is the DETERMINISTIC half of the inferred producer: it takes the ALREADY-FROZEN inference decisions
// (the non-deterministic LLM rerank + abstain having been run ONCE at rebridge time and quarantined into a
// content-addressed decision block) and materializes them into typed (source)-[:CLOSE_MATCH]->(HubReference)
// EDGES. It makes NO LLM call, NO network call, reads no graph — given the same frozen decisions it emits a
// byte-identical edge set, so a plain -build materialize stays deterministic (the LLM non-determinism never
// reaches replay; G2).
//
// REUSES the authored-track buildReferenceIndex (referenceIndex.js) — a chosen CEDS target Global ID resolves
// to a property-tier (or value-tier composite) HubReference by canonicalKey, exactly as the authored track
// resolves a crosswalk target. The ONLY differences from the authored track: (1) predicate CLOSE_MATCH not
// EXACT_MATCH; (2) mappingJustification semapv:SemanticSimilarity not ManualMappingCuration; (3) provenanceTier
// embedding-inferred; (4) per-edge confidence = the frozen rerank/cosine score (NOT a constant 1.0) plus the
// frozen rerankScore / cosineScore / retrievalRank, and a decisionBlockHash that PINS every edge to the exact
// frozen decision block (perturbing any frozen decision changes the block hash -> every edge's decisionBlockHash
// changes -> the fingerprint goes RED; the twin).
//
// ABSTAINS never reach this core: an abstained source produces NO decision row here and therefore NO edge
// (the abstain-boundary invariant). Mappings are EDGES (reify-on-demand): ZERO MappingAssertion nodes unless
// curationInputs are supplied.
//
// PURE + synchronous + deterministic: no Neo4j, no async, no Date/random, no LLM. camelCase only.
//
// @concept: [[InferredSubgraph]]
// @concept: [[HubReference]]
// @concept: [[MappingSubgraph]]

const path = require('path');
const crypto = require('crypto');

const vocab = require(path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const {
	SKOS_EDGE_TYPES,
	MAPPING_PROPERTIES: MP,
	PROVENANCE_TIER,
} = vocab;

// REUSE the ported authored-track reference-resolution index (the SAME resolver referenceIndex.js exposes;
// not re-implemented). buildReferenceIndex(referenceNodes) -> { basePropertyRef, baseValueRef, ... }.
const referenceIndexFactory = require(path.join(__dirname, 'referenceIndex'));

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({
		predicate = 'closeMatch',
		mappingJustification = 'semapv:SemanticSimilarity',
		provenanceTier = PROVENANCE_TIER.EMBEDDING_INFERRED,
		subjectSource,
		subjectVersion = '',
		objectSource = 'CEDS',
		objectVersion = '',
		mappingTool = 'semanticBridge',
		method = 'definitionEmbedding-opusRerank-v1',
		decisionBlockHash = '',
		// ⟪skipAI FLAGGING, 2026-08-10⟫ decisionAlgorithm — set ONLY when a DEBUG JUDGE answered this
		// run (--useDebugJudge). It stamps every edge this materializer composes so a contaminated
		// graph is DETECTABLE rather than merely documented: askMilo can be told to accept
		// INVALID_DEBUG deliberately and will otherwise raise an alarm. Absent on every real run, so a
		// genuine edge carries no such property at all and the flag can never be a false positive.
		//
		// EDGES ONLY, AND THAT IS DELIBERATE. A bridge composes NO nodes on the ordinary path
		// (buildReifiedNodes fires only on curationInputs), so the nodes in a bridged graph are FORGED
		// standard elements and CEDS hub references — correct content that a debug run did not produce.
		// Flagging them would mark honest work invalid. The reified MappingAssertion nodes ARE this
		// materializer's own output and are flagged with the edges.
		decisionAlgorithm = undefined,
	} = {}) => {
		const edgeType = SKOS_EDGE_TYPES[predicate];

		// Spread into every composed edge/node. Empty on a real run — an absent property, not a
		// property whose value says 'not debug', so nothing has to be read to know an edge is genuine.
		const isDebugRun = typeof decisionAlgorithm === 'string' && decisionAlgorithm !== '';
		const debugFlagProperties = isDebugRun ? { decisionAlgorithm } : {};

		// ⟪skipAI, 2026-08-10⟫ THE TIER FLIPS TOO, and this is the more important half of the flagging.
		// A debug edge used to be stamped provenanceTier 'embedding-inferred' — a FALSE CLAIM: no
		// embedding informed the choice, rule 'first' takes candidate 1 unconditionally. provenanceTier
		// is the field a consumer trusts most, so it was the worst place in the edge for a lie, and
		// askMilo duly described these mappings as calibrated-confidence equivalents (tqii observed it
		// live, 2026-08-10). A reader who checks only the tier now learns the truth without being told
		// what to look for.
		const effectiveProvenanceTier = isDebugRun ? PROVENANCE_TIER.INVALID_DEBUG : provenanceTier;

		// the authored-track factory, used ONLY for its pure buildReferenceIndex(referenceNodes) ->
		// { basePropertyRef, baseValueRef }. The chosen CEDS target resolves DIRECTLY by canonicalKey.
		const referenceResolver = referenceIndexFactory({});

		// buildReifiedNodes — reify-on-demand (§6.1): a MappingAssertion NODE appears ONLY from a curation
		// input. With NO curationInputs the output carries ZERO nodes (edges only — the default).
		const buildReifiedNodes = ({ curationInputs, basePropertyRef, sourceStableIds }) => {
			const nodes = [];
			const reifyEdges = [];
			(curationInputs || []).forEach((oneInput) => {
				const { fromStableId, targetKey } = oneInput;
				const refStableId = basePropertyRef[targetKey];
				if (!sourceStableIds.has(fromStableId) || !refStableId) {
					return; // a curation input that does not resolve materializes nothing (no dangling node)
				}
				const assertionId = `mappingAssertion:${crypto
					.createHash('sha256')
					.update(`${fromStableId}|${refStableId}|${predicate}`, 'utf8')
					.digest('hex')}`;
				nodes.push({
					stableId: assertionId,
					labels: ['MappingAssertion', 'ForgedNode'],
					properties: {
						role: 'MappingAssertion',
						[MP.PREDICATE]: predicate,
						[MP.MAPPING_JUSTIFICATION]: mappingJustification,
						[MP.PROVENANCE_TIER]: effectiveProvenanceTier,
						[MP.SUBJECT_SOURCE]: subjectSource,
						[MP.OBJECT_SOURCE]: objectSource,
						[MP.MAPPING_TOOL]: mappingTool,
						cedsAnchorKey: targetKey,
						curationAnnotation: oneInput.annotation || 'CURATED_BY',
						curationNote: oneInput.note || '',
						decisionBlockHash,
						...debugFlagProperties,
					},
				});
				reifyEdges.push({
					type: 'REIFIED_AS',
					fromRef: { source: subjectSource, id: fromStableId },
					toRef: { source: subjectSource, id: assertionId },
					properties: { [MP.PREDICATE]: [predicate] },
				});
				reifyEdges.push({
					type: 'ASSERTS',
					fromRef: { source: subjectSource, id: assertionId },
					toRef: { source: objectSource, id: refStableId },
					properties: { [MP.PREDICATE]: [predicate] },
				});
			});
			return { nodes, reifyEdges };
		};

		// buildInferredSubgraph — PURE. -> { nodes, edges, orphans, diagnostics, counts }.
		//   inferredDecisions: [{ fromStableId, targetKey, confidence, rerankScore, cosineScore, retrievalRank }]
		//        (NON-ABSTAIN decisions only; one row per emitting source. targetKey = chosen CEDS Global ID.)
		//   sourceNodes      : the source-standard nodes (for fromStableId existence validation)
		//   referenceNodes   : the materialized HubReference nodes (the resolution targets)
		const buildInferredSubgraph = ({
			inferredDecisions,
			sourceNodes,
			referenceNodes,
			curationInputs,
		} = {}) => {
			// ⟪QUALIFIED REFERENCES NOW RESOLVE, tqii 2026-08-13⟫ qualifiedRef is the THIRD map
			// buildReferenceIndex has always returned, and this function used to destructure only two of
			// them — so a chosen QUALIFIED property-tier reference could never resolve and every such
			// judgment was silently discarded as an orphan.
			//
			// The three maps and their key shapes:
			//   basePropertyRef[canonicalKey]                  unqualified property tier
			//   qualifiedRef[propertyKey '|' qualifierKey]     qualified property tier   ← was unread
			//   baseValueRef[propertyKey '|' valueKey]         value tier
			//
			// genericBridge's targetKeyFor already emits exactly `propertyKey|qualifierKey` for a
			// qualified pick, and its own header documents the consequence of this map being unread:
			// "resolves in NEITHER map and becomes a counted ORPHAN — SAFE (no edge materializes) rather
			// than DANGEROUS". Reading the map is what that comment was waiting for.
			//
			// ⚠ WHY THE ORDER OF THE LOOKUP BELOW MATTERS. A qualified key contains a pipe and a base
			// property key never does, so the three key spaces cannot collide — but do NOT "simplify" the
			// chain by falling back to the bare canonicalKey when a qualified key misses. That fallback is
			// precisely the DANGEROUS behavior the bridge refused to implement: the bare key resolves to
			// the UNQUALIFIED base HubReference, a DIFFERENT node, and would produce a healthy-looking
			// edge pointing at the wrong thing. An unresolvable key must stay an orphan.
			const { basePropertyRef, qualifiedRef, baseValueRef } =
				referenceResolver.buildReferenceIndex(referenceNodes);
			const sourceStableIds = new Set((sourceNodes || []).map((oneNode) => oneNode.stableId));

			const edgeByPair = new Map(); // `${fromStableId}|${refStableId}` -> edge (dedup; MERGE semantics)
			const orphans = [];
			const fromGaps = [];

			(inferredDecisions || []).forEach((oneDecision) => {
				const { fromStableId, targetKey } = oneDecision;
				if (!sourceStableIds.has(fromStableId)) {
					fromGaps.push({ fromStableId, targetKey, reason: 'source element not materialized as a node' });
					return;
				}
				const refStableId =
					basePropertyRef[targetKey] || qualifiedRef[targetKey] || baseValueRef[targetKey];
				if (!refStableId) {
					orphans.push({
						fromStableId,
						targetKey,
						reason:
							'no unqualified-property, qualified-property, or value-tier HubReference with this ' +
							'key (chosen CEDS target unresolvable)',
					});
					return;
				}
				const pairKey = `${fromStableId}|${refStableId}`;
				if (edgeByPair.has(pairKey)) {
					return; // one source already mapped to this reference -> ONE edge (MERGE semantics)
				}
				// confidence = the frozen rerank/cosine score; numeric, in [0,1]. Stamped on the edge alongside
				// the raw rerankScore/cosineScore/retrievalRank so the decision is fully legible and recomputable.
				const confidence =
					typeof oneDecision.confidence === 'number'
						? oneDecision.confidence
						: typeof oneDecision.rerankScore === 'number'
							? oneDecision.rerankScore
							: 0;
				edgeByPair.set(pairKey, {
					type: edgeType,
					fromRef: { source: subjectSource, id: fromStableId },
					toRef: { source: objectSource, id: refStableId },
					properties: {
						[MP.PREDICATE]: predicate,
						[MP.CONFIDENCE]: confidence,
						[MP.MAPPING_JUSTIFICATION]: mappingJustification,
						[MP.PROVENANCE_TIER]: effectiveProvenanceTier,
						[MP.SUBJECT_SOURCE]: subjectSource,
						[MP.SUBJECT_VERSION]: subjectVersion,
						[MP.OBJECT_SOURCE]: objectSource,
						[MP.OBJECT_VERSION]: objectVersion,
						[MP.MAPPING_TOOL]: mappingTool,
						method,
						rerankScore: typeof oneDecision.rerankScore === 'number' ? oneDecision.rerankScore : confidence,
						cosineScore: typeof oneDecision.cosineScore === 'number' ? oneDecision.cosineScore : null,
						retrievalRank:
							typeof oneDecision.retrievalRank === 'number' ? oneDecision.retrievalRank : null,
						...(typeof oneDecision.scopeParentPredicate === 'string'
							? { scopeParentPredicate: oneDecision.scopeParentPredicate }
							: {}),
						...(typeof oneDecision.scopeParentConfidence === 'number'
							? { scopeParentConfidence: oneDecision.scopeParentConfidence }
							: {}),
						cedsAnchorKey: targetKey,
						decisionBlockHash,
						resolution: 'direct',
						// ⟪JUDGMENT ON THE EDGE, tqii 2026-08-13⟫ the judge's own confidence category and its
						// sentence of reasoning, carried here so a reader holding ONE mapping can see why it
						// exists without unpacking the frozen block named by decisionBlockHash. Previously
						// omitted by the R-b disposition, whose stated reason — keep this shared module
						// byte-untouched for caseStructuralBridge — expired when that bridge was retired.
						//
						// SPREAD, NOT ASSIGNED, so a decision row that carries neither (an older frozen block
						// replayed after this change, or a producer that never supplied them) yields an edge
						// with the keys ABSENT rather than present-and-null. An absent property reads as
						// "this block predates the change"; a null one reads as "the judge gave no reason",
						// and those are different facts.
						...(typeof oneDecision.category === 'string' ? { category: oneDecision.category } : {}),
						...(typeof oneDecision.rationale === 'string' ? { rationale: oneDecision.rationale } : {}),
						...debugFlagProperties,
					},
				});
			});

			const edges = [...edgeByPair.values()];
			// deterministic ordering for a byte-stable block (sort edges by tuple).
			edges.sort((a, b) => {
				const ka = `${a.type}|${a.fromRef.id}|${a.toRef.id}`;
				const kb = `${b.type}|${b.fromRef.id}|${b.toRef.id}`;
				return ka < kb ? -1 : ka > kb ? 1 : 0;
			});
			orphans.sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : 1));
			fromGaps.sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : 1));

			// reify-on-demand: nodes ONLY when curationInputs are supplied (default: zero nodes).
			const { nodes, reifyEdges } = buildReifiedNodes({
				curationInputs,
				basePropertyRef,
				sourceStableIds,
			});
			nodes.sort((a, b) => (a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0));

			return {
				nodes,
				edges: edges.concat(reifyEdges),
				orphans,
				diagnostics: { fromGaps },
				counts: {
					edgesTotal: edges.length,
					reifiedNodes: nodes.length,
					reifyEdges: reifyEdges.length,
					orphans: orphans.length,
					fromGaps: fromGaps.length,
					decisionsConsidered: (inferredDecisions || []).length,
				},
			};
		};

		return { buildInferredSubgraph };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
