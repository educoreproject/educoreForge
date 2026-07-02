'use strict';

// Phase-3 standing gate — addressSignature COMPOSITE uniqueness. The HubReference identity key is the
// composite (hubName, addressSignature), NOT canonicalKey (canonicalKey is intentionally non-unique among
// value-tier refs — the same option value under different properties is a distinct address). This gate
// asserts every (hubName, addressSignature) pair is distinct across all HubReferences — zero violations —
// and that the distinct-pair count equals the reference count (29788). A collision (two distinct addresses
// hashing/keyed alike) turns the suite RED. Standalone proof + collision twin: test/phase3HubReference.js.
//
// expectFail:true UNTIL the Phase-3 re-freeze (the subgraph is not in today's gating manifest, so this
// honestly XFAILs). ▶ RE-FREEZE CHECKLIST (REQUIRED): FLIP expectFail:false at re-freeze AND prove with
// the addressSignature-collision twin (test/phase3HubReference.js twinA observed failing).

module.exports = () => ({
	name: 'referenceSubgraph.addressSignatureUniqueness',
	phase: 'ReferenceSubgraph',
	kind: 'positive',
	expectFail: false, // ENFORCED at the Phase-3 re-freeze (2026-06-30, VELVET_MARBLE) — proven by phase3HubReference twinA
	run: (ctx, callback) => {
		const cypher = `
			MATCH (r:HubReference)
			WITH r.hubName AS h, r.addressSignature AS s, count(*) AS c
			RETURN count(*) AS distinctPairs, sum(CASE WHEN c > 1 THEN 1 ELSE 0 END) AS violations, sum(c) AS total
		`;
		ctx.resources.lifecycle.runCypher(
			{ graphName: ctx.candidateGraphName, cypher, params: {} },
			(err, result) => {
				if (err) {
					callback('', { passed: false, detail: `query error: ${err}` });
					return;
				}
				const row = (result.records && result.records[0]) || {};
				const distinctPairs = Number(row.distinctPairs || 0);
				const violations = Number(row.violations || 0);
				const total = Number(row.total || 0);
				callback('', {
					passed: violations === 0 && distinctPairs === 29788 && total === 29788,
					detail: `distinct (hubName,addressSignature)=${distinctPairs} total=${total} violations=${violations} (REQUIRED: 29788/29788/0)`,
				});
			},
		);
	},
});
