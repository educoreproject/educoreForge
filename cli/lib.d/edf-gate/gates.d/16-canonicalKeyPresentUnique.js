'use strict';

// Phase-2 standing gate (ENFORCED — baselines re-frozen to the addressed golden 2026-06-29):
// canonicalKey is stamped on the CEDS hub property/value nodes — PRESENT (>0) and UNIQUE (zero
// collisions). expectFail:false ⇒ this is a REQUIRED pass; a future regression that drops or duplicates
// canonicalKey turns the cumulative suite RED (it is no longer masked as XFAIL). The standalone gate of
// record is test/phase2CanonicalAddressing.js (builds the candidate and proves the full delta + twin);
// the canonicalKey-drop twin demonstration proves this gate turns the suite RED.
//
// PHASE-3 SCOPING (2026-06-30, VELVET_MARBLE): this gate asserts uniqueness of the HUB STRUCTURAL nodes'
// canonicalKey. The Phase-3 HubReference nodes ALSO carry canonicalKey, but it is INTENTIONALLY
// NON-UNIQUE among value-tier references (the same option value under different properties is a distinct
// address sharing one canonicalKey) — their identity is the composite (hubName, addressSignature), NOT
// canonicalKey (enforced by gates.d/19). So :HubReference is EXCLUDED here; including it would falsely
// flag the by-design non-uniqueness. (Hub-node uniqueness still fully enforced: 21870 distinct, 0 collisions.)

module.exports = () => ({
	name: 'canonicalAddressing.canonicalKeyPresentUnique',
	phase: 'CanonicalAddressing',
	kind: 'positive',
	expectFail: false,
	run: (ctx, callback) => {
		const cypher = `
			MATCH (n:ForgedNode) WHERE n.canonicalKey IS NOT NULL AND NOT n:HubReference
			WITH n.canonicalKey AS k, count(*) AS c
			RETURN count(k) AS distinctKeys, sum(CASE WHEN c > 1 THEN 1 ELSE 0 END) AS violations
		`;
		ctx.resources.lifecycle.runCypher(
			{ graphName: ctx.candidateGraphName, cypher, params: {} },
			(err, result) => {
				if (err) {
					callback('', { passed: false, detail: `query error: ${err}` });
					return;
				}
				const row = (result.records && result.records[0]) || {};
				const distinctKeys = Number(row.distinctKeys || 0);
				const violations = Number(row.violations || 0);
				callback('', {
					passed: distinctKeys > 0 && violations === 0,
					detail: `distinctCanonicalKeys=${distinctKeys} violations=${violations} (REQUIRED: present>0 & unique)`,
				});
			},
		);
	},
});
