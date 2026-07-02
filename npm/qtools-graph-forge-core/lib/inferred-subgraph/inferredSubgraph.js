'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// inferredSubgraph.js — PURE, deterministic materialization of the Phase-5 INFERRED-track mapping subgraph
// (the probabilistic track; WHITEPAPER §6.1/§6.2, PLAN §Phase 5). It is the DETERMINISTIC half of the
// inferred producer: it takes the ALREADY-FROZEN inference decisions (the non-deterministic LLM rerank +
// abstain having been run ONCE at production time and quarantined into a content-addressed decision block)
// and materializes them into typed (source)-[:CLOSE_MATCH]->(HubReference) EDGES. It makes NO LLM call, NO
// network call, reads no graph — given the same frozen decisions it emits a byte-identical edge set, so
// replay(manifest) stays deterministic (the LLM non-determinism never reaches replay; G5).
//
// Mirrors mappingSubgraph.js (Phase-4 authored track) and REUSES its reference-resolution index
// (buildReferenceIndex) — a chosen CEDS target Global ID resolves to a property-tier HubReference by
// canonicalKey, exactly as the authored track resolves a crosswalk target. The ONLY differences from the
// authored track: (1) predicate CLOSE_MATCH not EXACT_MATCH (inferred is never auto-promoted to exact —
// the abstain/closeMatch discipline is the correctness differentiator; a closeMatch never composes to
// equivalence, which is the Phase-6 conservativity guarantee); (2) mappingJustification semapv:SemanticSimilarity
// not ManualMappingCuration; (3) provenanceTier embedding-inferred; (4) per-edge confidence = the frozen
// rerank score (NOT a constant 1.0) plus the frozen rerankScore / cosineScore / retrievalRank, and a
// decisionBlockHash that PINS every edge to the exact frozen decision block (perturbing any frozen decision
// changes the block hash -> every edge's decisionBlockHash changes -> the fingerprint goes RED; the twin).
//
// Phase 5 emits closeMatch ONLY (WILD_FALCON 2026-06-30): narrow/broad SUBSUMPTION typing is DEFERRED to
// Phase 6 where directional transmissibility properly lives — no under-justified directional claim here.
//
// ABSTAINS never reach this core: an abstained source produces NO decision row here and therefore NO edge
// (the abstain-boundary invariant — a below-threshold candidate yields no edge — is enforced upstream in
// the inference half and asserted by a twin). Mappings are EDGES (reify-on-demand; §6.1): ZERO
// MappingAssertion nodes (a MappingAssertion node appears ONLY from a curation input, handled elsewhere).
//
// PURE + synchronous + deterministic: no Neo4j, no async, no Date/random, no LLM. camelCase only.
//
// @concept: [[InferredSubgraph]]
// @concept: [[HubReference]]
// @concept: [[MappingSubgraph]]

const path = require('path');
const crypto = require('crypto');

const vocab = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const {
	SKOS_EDGE_TYPES,
	MAPPING_PROPERTIES: MP,
	PROVENANCE_TIER,
} = vocab;

// REUSE the Phase-4 authored-track reference-resolution index (the SAME resolver; not re-implemented).
const mappingSubgraphFactory = require(path.join(__dirname, '..', 'mapping-subgraph', 'mappingSubgraph'));

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
		mappingTool = 'edf-implied',
		method = 'definitionEmbedding-opusRerank-v1',
		decisionBlockHash = '',
	} = {}) => {
		const edgeType = SKOS_EDGE_TYPES[predicate];

		// the authored-track factory, used ONLY for its pure buildReferenceIndex(referenceNodes) ->
		// { basePropertyRef, qualifiedRef }. The chosen CEDS target resolves DIRECTLY by canonicalKey
		// (the inferred pick is always a CURRENT CEDS node, so no version-bridge remodeling is involved).
		const referenceResolver = mappingSubgraphFactory({});

		// buildInferredSubgraph — PURE. -> { edges, orphans, diagnostics, counts }.
		//   inferredDecisions: [{ fromStableId, targetKey, confidence, rerankScore, cosineScore, retrievalRank }]
		//        (NON-ABSTAIN decisions only; one row per emitting source. targetKey = chosen CEDS Global ID.)
		//   sourceNodes      : the source-standard nodes (for fromStableId existence validation)
		//   referenceNodes   : the materialized HubReference nodes (the resolution targets)
		// reify-on-demand (§6.1): a MappingAssertion NODE appears ONLY from a curation input. With NO
		// curationInputs the output carries ZERO nodes (edges only — the default). Each curation input
		// { fromStableId, targetKey, annotation, note } that resolves yields exactly ONE MappingAssertion
		// node (+ its REIFIED_AS / ASSERTS edges); the gate toggles the fixture and asserts the node
		// count moves 0 <-> N precisely (the reify twin).
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
						[MP.PROVENANCE_TIER]: provenanceTier,
						[MP.SUBJECT_SOURCE]: subjectSource,
						[MP.OBJECT_SOURCE]: objectSource,
						[MP.MAPPING_TOOL]: mappingTool,
						cedsAnchorKey: targetKey,
						curationAnnotation: oneInput.annotation || 'CURATED_BY',
						curationNote: oneInput.note || '',
						decisionBlockHash,
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

		const buildInferredSubgraph = ({
			inferredDecisions,
			sourceNodes,
			referenceNodes,
			curationInputs,
		} = {}) => {
			const { basePropertyRef, baseValueRef } = referenceResolver.buildReferenceIndex(referenceNodes);
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
				const refStableId = basePropertyRef[targetKey] || baseValueRef[targetKey];
				if (!refStableId) {
					orphans.push({
						fromStableId,
						targetKey,
						reason: 'no property-tier or value-tier HubReference with this canonicalKey (chosen CEDS target unresolvable)',
					});
					return;
				}
				const pairKey = `${fromStableId}|${refStableId}`;
				if (edgeByPair.has(pairKey)) {
					return; // one source already mapped to this reference -> ONE edge (MERGE semantics)
				}
				// confidence = the frozen rerank score; numeric, in [0,1]. Stamped on the edge alongside the
				// raw rerankScore/cosineScore/retrievalRank so the decision is fully legible and recomputable.
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
						[MP.PROVENANCE_TIER]: provenanceTier,
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
						// scope-parent evidence (value tier): the parent property-match hypothesis this
						// edge is conditional on. Stamped only when the decision carries it — property-tier
						// decisions have no scoping parent and their edges are unchanged.
						...(typeof oneDecision.scopeParentPredicate === 'string'
							? { scopeParentPredicate: oneDecision.scopeParentPredicate }
							: {}),
						...(typeof oneDecision.scopeParentConfidence === 'number'
							? { scopeParentConfidence: oneDecision.scopeParentConfidence }
							: {}),
						cedsAnchorKey: targetKey,
						decisionBlockHash,
						resolution: 'direct',
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
