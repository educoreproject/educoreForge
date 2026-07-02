'use strict';

// Regression gate (Appendix B #3): "Has School Operational Status" (P000533, class School Operational
// Detail) and "Has Local Education Agency Operational Status" (P000174, class LEA Operational Detail) are
// DISTINCT HubReferences — the domain slot differs ⟹ never equated. Both property-tier references must
// exist; their canonicalKeys differ (P000533 ≠ P000174), so they are inherently distinct nodes (different
// addressSignature/stableId) — keysPresent===2 over the two distinct keys is therefore a sound distinctness
// assertion (a single ref cannot carry both keys; they cannot collapse).
//
// ENFORCED (expectFail:false) at the Phase-3 re-freeze (2026-06-30, VELVET_MARBLE) — the HubReference
// subgraph is now in the gating manifest. Proven by test/phase3HubReference.js (gate 12 check + the
// additive gate of record). A regression that drops either reference turns the suite RED.

module.exports = () => ({
	name: 'regression.schoolVsLeaStatus',
	phase: 'Equivalence',
	kind: 'regression',
	expectFail: false,
	run: (ctx, callback) => {
		const oneCase = ctx.groundTruth.NAMED_CASES.schoolVsLeaOperationalStatus;
		const cypher = `
			MATCH (r:HubReference)
			WHERE r.canonicalKey IN $keys
			RETURN count(DISTINCT r.canonicalKey) AS keysPresent, count(r) AS refs
		`;
		ctx.resources.lifecycle.runCypher(
			{
				graphName: ctx.candidateGraphName,
				cypher,
				params: { keys: [oneCase.schoolPropertyKey, oneCase.leaPropertyKey] },
			},
			(err, result) => {
				if (err) {
					callback('', { passed: false, detail: `query error: ${err}` });
					return;
				}
				const row = result.records[0] || {};
				const keysPresent = Number(row.keysPresent || 0);
				callback('', {
					passed: keysPresent === 2,
					detail: `distinctCanonicalKeysPresent=${keysPresent}/2 (P000533 school, P000174 LEA; HubReference subgraph lands in Phase 3)`,
				});
			},
		);
	},
});
