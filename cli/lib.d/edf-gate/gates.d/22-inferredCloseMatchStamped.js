'use strict';

// Phase-5 standing gate (the inferred-track CLOSE_MATCH invariant). The inferred pipeline
// (definition-embedding retrieve -> Opus rerank -> ABSTAIN -> closeMatch) is run ONCE at production time and
// its decisions FROZEN into a content-addressed 'inferredDecision' block; the closeMatch EDGES are PURELY
// materialized from that frozen block (replay makes zero LLM calls). This gate asserts the materialized
// invariant on the gating golden: the expected count of CLOSE_MATCH edges, each carrying the inferred SSSOM
// stamp (predicate=closeMatch, mappingJustification=semapv:SemanticSimilarity, provenanceTier=embedding-inferred)
// and pinned to its frozen decision block (decisionBlockHash set), every edge targeting a HubReference; AND
// ZERO MappingAssertion nodes (reify-on-demand — a MappingAssertion node appears ONLY from a curation input).
//
// closeMatch ONLY (narrow/broad subsumption deferred to Phase 6). A wrong closeMatch is structurally safe —
// only exactMatch composes to equivalence (Phase 6), so closeMatch never causes false equivalence; the
// guarantee is in the construction, not this gate. This gate guards that the inferred edges remain present,
// correctly typed, and unreified by default.
//
// PROVEN by the gate of record test/phase5Implied.js: the PURE TWINS (baseline 68==68; perturb a frozen
// decision -> the materialized edge set moves, a fingerprint would go RED; abstain-boundary -> dropping a
// pick removes exactly one edge, a below-threshold/NONE source yields NO edge; reify -> 0 MappingAssertion
// nodes by default, exactly 1 with a 1-entry curation fixture) + the GRAPH gate (all-scope additive diff ==
// exactly the new CLOSE_MATCH edges, every edge stamped + pinned, replay byte-deterministic).
//
// ENFORCED (expectFail:false) at the Phase-5 re-freeze (2026-06-30, CARDINAL_SUMMIT) — the inferred mapping
// block is now in the gating manifest (181be81d). Mirrors how Phase-3/4 standing gates registered then
// flipped at their re-freeze. The frozen scope is the SIF person/identifier anchor set + sample (68 edges);
// the full-corpus emission is a deferred TQ budget decision (a parameterized re-run, not new code).

const EXPECTED_CLOSE_MATCH = 68; // the frozen SIF-anchor scope (candidate manifest 181be81d)

module.exports = () => ({
	name: 'inferred.closeMatchStampedAndUnreified',
	phase: 'Mapping',
	kind: 'regression',
	expectFail: false, // ENFORCED at the Phase-5 re-freeze (inferred mappings now in the gating manifest 181be81d)
	run: (ctx, callback) => {
		const cypher = `
			MATCH ()-[r:CLOSE_MATCH]->(t)
			WITH
				count(r) AS edges,
				sum(CASE WHEN r.predicate='closeMatch' AND r.mappingJustification='semapv:SemanticSimilarity'
					AND r.provenanceTier='embedding-inferred' AND r.decisionBlockHash IS NOT NULL THEN 1 ELSE 0 END) AS stamped,
				sum(CASE WHEN t:HubReference THEN 1 ELSE 0 END) AS toHubRef
			OPTIONAL MATCH (m:MappingAssertion) WHERE m.mappingJustification <> 'semapv:ManualMappingCuration'
			RETURN edges, stamped, toHubRef, count(m) AS nonCurationAssertions
		`;
		ctx.resources.lifecycle.runCypher(
			{ graphName: ctx.candidateGraphName, cypher, params: {} },
			(err, result) => {
				if (err) {
					callback('', { passed: false, detail: `query error: ${err}` });
					return;
				}
				const row = (result.records && result.records[0]) || {};
				const edges = Number(row.edges || 0);
				const stamped = Number(row.stamped || 0);
				const toHubRef = Number(row.toHubRef || 0);
				const nonCurationAssertions = Number(row.nonCurationAssertions || 0);
				callback('', {
					passed:
						edges === EXPECTED_CLOSE_MATCH &&
						stamped === EXPECTED_CLOSE_MATCH &&
						toHubRef === EXPECTED_CLOSE_MATCH &&
						nonCurationAssertions === 0,
					detail: `CLOSE_MATCH=${edges} (expect ${EXPECTED_CLOSE_MATCH}); fully-stamped+pinned=${stamped}; ->HubReference=${toHubRef}; NON-curation MappingAssertion nodes=${nonCurationAssertions} (REQUIRED: edges==stamped==toHubRef==${EXPECTED_CLOSE_MATCH} AND non-curation MappingAssertion==0 — the inferred track is unreified; Phase-6 curation MappingAssertions (justification=ManualMappingCuration) are EXCLUDED and allowed)`,
				});
			},
		);
	},
});
