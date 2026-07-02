'use strict';

// Phase-4 standing gate (the version-bridge distinctness contract, the conservativity-relevant half provable
// with Ed-Fi alone): the authored version-bridge resolves Ed-Fi student P001071 -> the Student-qualified
// Person-Identifier reference (OV002114100002) and staff P001070 -> the Staff-qualified reference
// (OV002114100003), as DISTINCT references. Asserts DISTINCTNESS (overlap=0), not mere existence — same
// discipline as Phase-3 gate 11; catches a version-bridge that conflated the two per-role identifiers onto
// one reference (the studentID≡staffID false-equivalence this whole build exists to preclude).
//
// PROVEN by the gate of record test/phase4Mapping.js (the PURE-PRODUCER version-bridge twin: drop the
// P001071 entry -> the student edge vanishes; AND the GRAPH twin: merge the staff mapping onto the student
// ref -> overlap>0 RED -> restore GREEN). Full Phase-4 deliverable proof lives there.
//
// ENFORCED (expectFail:false) at the Phase-4 re-freeze (2026-06-30, SCARLET_GATE) — the mapping block is now
// in the gating manifest (14665fcf). Mirrors how the Phase-3 ReferenceSubgraph gates 18/19/20 registered
// XFAIL then flipped at the Phase-3 re-freeze. Proven by test/phase4Mapping.js (the PURE-PRODUCER version-
// bridge twin + the GRAPH merge twin, both observed RED then restored). A merged/conflated version-bridge
// turns the suite RED.

const STUDENT_OLD_ID = 'P001071';
const STAFF_OLD_ID = 'P001070';
const STUDENT_QUALIFIER = 'OV002114100002';
const STAFF_QUALIFIER = 'OV002114100003';

module.exports = () => ({
	name: 'versionBridge.studentStaffDistinct',
	phase: 'Mapping',
	kind: 'regression',
	expectFail: false, // ENFORCED at the Phase-4 re-freeze (mappings now in the gating manifest 14665fcf)
	run: (ctx, callback) => {
		const cypher = `
			OPTIONAL MATCH (s {_source:'EdFi', cedsId:$studentOld})-[:EXACT_MATCH]->(rs:HubReference)
			WITH collect(DISTINCT rs) AS stuRefs
			OPTIONAL MATCH (t {_source:'EdFi', cedsId:$staffOld})-[:EXACT_MATCH]->(rt:HubReference)
			WITH stuRefs, collect(DISTINCT rt) AS staffRefs
			RETURN
				size(stuRefs) AS stu, size(staffRefs) AS staff,
				size([x IN stuRefs WHERE $studentQ IN x.qualifierKeys]) AS stuQual,
				size([x IN staffRefs WHERE $staffQ IN x.qualifierKeys]) AS staffQual,
				size([x IN stuRefs WHERE x IN staffRefs]) AS overlap
		`;
		ctx.resources.lifecycle.runCypher(
			{
				graphName: ctx.candidateGraphName,
				cypher,
				params: {
					studentOld: STUDENT_OLD_ID,
					staffOld: STAFF_OLD_ID,
					studentQ: STUDENT_QUALIFIER,
					staffQ: STAFF_QUALIFIER,
				},
			},
			(err, result) => {
				if (err) {
					callback('', { passed: false, detail: `query error: ${err}` });
					return;
				}
				const row = result.records[0] || {};
				const stu = Number(row.stu || 0);
				const staff = Number(row.staff || 0);
				const stuQual = Number(row.stuQual || 0);
				const staffQual = Number(row.staffQual || 0);
				const overlap = Number(row.overlap || 0);
				callback('', {
					passed: stu >= 1 && staff >= 1 && stuQual === stu && staffQual === staff && overlap === 0,
					detail: `studentRefs=${stu} (qualified=${stuQual}) staffRefs=${staff} (qualified=${staffQual}) overlap=${overlap} (REQUIRED: each maps to its OWN type-qualified ref AND the two are DISTINCT, overlap=0)`,
				});
			},
		);
	},
});
