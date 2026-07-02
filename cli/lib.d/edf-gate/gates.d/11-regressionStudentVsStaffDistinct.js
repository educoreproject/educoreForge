'use strict';

// Regression gate (Appendix B #2): the student identifier (OV002114100002) and the staff identifier
// (OV002114100003) resolve to DISTINCT HubReferences — same base property, different qualifier ⟹ NOT
// equivalent. The contract is DISTINCTNESS, not mere existence: both refs must exist AND be DIFFERENT nodes
// (overlap=0). overlap>0 catches the equivalence-conflation this case exists to catch — one HubReference
// carrying BOTH qualifier keys, or student+staff collapsed onto one node; a set going empty catches a
// signature collision that merged the two. (Hardened per the Phase-3 review: the prior pass condition
// checked only existence and would have FALSELY PASSED a merged-ref regression once enforced.)
//
// ENFORCED (expectFail:false) at the Phase-3 re-freeze (2026-06-30, VELVET_MARBLE) — the HubReference
// subgraph is now in the gating manifest. Proven by the merged-ref distinctness twin
// (test/phase3HubReference.js twinC observed failing then restored). A merged-ref regression turns the suite RED.

module.exports = () => ({
	name: 'regression.studentVsStaffDistinct',
	phase: 'Equivalence',
	kind: 'regression',
	expectFail: false, // ENFORCED at the Phase-3 re-freeze (see header) — proven by phase3HubReference twinC
	run: (ctx, callback) => {
		const oneCase = ctx.groundTruth.NAMED_CASES.studentVsStaffDistinct;
		const cypher = `
			OPTIONAL MATCH (rs:HubReference) WHERE $student IN rs.qualifierKeys
			WITH collect(DISTINCT rs) AS studentRefs
			OPTIONAL MATCH (rt:HubReference) WHERE $staff IN rt.qualifierKeys
			WITH studentRefs, collect(DISTINCT rt) AS staffRefs
			RETURN size(studentRefs) AS studentRefs, size(staffRefs) AS staffRefs,
				size([x IN studentRefs WHERE x IN staffRefs]) AS overlap
		`;
		ctx.resources.lifecycle.runCypher(
			{
				graphName: ctx.candidateGraphName,
				cypher,
				params: {
					student: oneCase.studentQualifierValueKey,
					staff: oneCase.staffQualifierValueKey,
				},
			},
			(err, result) => {
				if (err) {
					callback('', { passed: false, detail: `query error: ${err}` });
					return;
				}
				const row = result.records[0] || {};
				const studentRefs = Number(row.studentRefs || 0);
				const staffRefs = Number(row.staffRefs || 0);
				const overlap = Number(row.overlap || 0);
				callback('', {
					passed: studentRefs >= 1 && staffRefs >= 1 && overlap === 0,
					detail: `studentRefs=${studentRefs}, staffRefs=${staffRefs}, overlap=${overlap} (REQUIRED: both ≥1 AND distinct nodes, overlap=0)`,
				});
			},
		);
	},
});
