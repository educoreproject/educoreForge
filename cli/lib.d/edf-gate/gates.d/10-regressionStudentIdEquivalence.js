'use strict';

// Regression gate (Appendix B #1, HONEST EXPECT-FAIL until Phase 6): two source elements from DIFFERENT
// standards (SIF.studentId and EdFi StudentEducationOrganizationAssociation.IdentificationCode) resolve via
// EXACT_MATCH to the SAME HubReference (Person Identifier qualified by Student Identifier, OV002114100002) —
// i.e. ONE HubReference carries ≥2 DISTINCT EXACT_MATCH sources (an equivalence cluster).
//
// WHY IT STAYS XFAIL THROUGH PHASE 4 (data-grounded, SCARLET_GATE): the Ed-Fi authored crosswalk alone
// (Phase 4) puts exactly ONE EXACT_MATCH source (P001071) on the student reference. The second source is
// SIF.studentId, and SIF ships NO authored crosswalk -> it is INFERRED (Phase 5, closeMatch — NOT
// exactMatch). The ≥2-EXACT_MATCH-same-ref contract is therefore only satisfiable at the Phase-6 equivalence
// layer (where Appendix-B #1 is scheduled to assert), not Phase 4. Left honest XFAIL; flip when that lands.
//
// CONTRACT FIX (the recurring under-enforcement pattern): the prior pass condition counted refs and sources
// SEPARATELY (refs≥1 && sources≥2) over ALL refs carrying the qualifier — two sources on TWO DIFFERENT refs
// would have FALSELY PASSED. It now asserts a SINGLE shared reference carries ≥2 DISTINCT sources (the real
// equivalence-cluster contract: max-distinct-sources-on-one-ref ≥ 2). Fixed now so the Phase-6 flip is correct.

module.exports = () => ({
	name: 'regression.studentIdEquivalence',
	phase: 'Equivalence',
	kind: 'regression',
	expectFail: false, // ENFORCED at the Phase-6 re-freeze (LUNAR_GARDEN 2026-06-30): the SIF.studentId curation
	// promotes a 2nd DISTINCT EXACT_MATCH source onto the qualified student ref -> the equivalence cluster forms.
	// Proven by the gate of record (test/phase6Equivalence.js gate10 flip + the remove-source twin) BEFORE the flip.
	run: (ctx, callback) => {
		const oneCase = ctx.groundTruth.NAMED_CASES.studentIdEquivalence;
		// the equivalence-cluster contract: SOME single HubReference carrying the student qualifier has ≥2
		// DISTINCT EXACT_MATCH sources. max(sources-on-one-ref) ≥ 2 — NOT refs≥1 && total-sources≥2.
		const cypher = `
			MATCH (r:HubReference) WHERE $qualifierKey IN r.qualifierKeys
			OPTIONAL MATCH (s)-[:EXACT_MATCH]->(r)
			WITH r, count(DISTINCT s) AS sourcesOnRef
			RETURN count(r) AS refs, coalesce(max(sourcesOnRef), 0) AS maxSourcesOnOneRef
		`;
		ctx.resources.lifecycle.runCypher(
			{
				graphName: ctx.candidateGraphName,
				cypher,
				params: { qualifierKey: oneCase.qualifierValueKey },
			},
			(err, result) => {
				if (err) {
					callback('', { passed: false, detail: `query error: ${err}` });
					return;
				}
				const row = result.records[0] || {};
				const refs = Number(row.refs || 0);
				const maxSourcesOnOneRef = Number(row.maxSourcesOnOneRef || 0);
				callback('', {
					passed: refs >= 1 && maxSourcesOnOneRef >= 2,
					detail: `studentRefs=${refs}, maxDistinctExactMatchSourcesOnOneRef=${maxSourcesOnOneRef} (REQUIRED: ONE shared ref with ≥2 DISTINCT sources — equivalence cluster; needs the SIF source at Phase 6)`,
				});
			},
		);
	},
});
