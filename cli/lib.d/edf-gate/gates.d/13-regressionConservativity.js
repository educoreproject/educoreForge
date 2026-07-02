'use strict';

// Regression gate (Appendix B #4) — CONSERVATIVITY, the load-bearing safety guarantee. ENFORCED at the
// Phase-6 re-freeze (LUNAR_GARDEN 2026-06-30). This is THE safety gate: it makes coarseness/curation in the
// hub unable to manufacture a false equivalence (WHITEPAPER §7.3, P5).
//
// THE PINNED RULE — generalized to a STRUCTURAL INVARIANT (the general form of the studentId != staffId
// thesis; no hand-list): NO source may hold EXACT_MATCH to two HubReferences that share a base PROPERTY
// (same propertyKey) but DIFFER in the qualifier (different qualifierKeys). Such a source would be claiming
// to be EXACTLY two different qualified senses of one property — bridging two role-distinct references and
// equating them. Because an equivalence cluster is exactly the sources holding EXACT_MATCH to ONE
// HubReference (clusters never span references — the exactMatch-only construction guarantee), this single
// structural check is the general "no must-never-merge pair shares a cluster" rule. It covers student/staff
// (P001572, OV002114100002 vs OV002114100003 — the NAMED test case + the gate-of-record twin) AND every
// future qualifier-distinct identifier pair, with no enumerated list. The CLOSE_MATCH evidence is NEVER
// consulted (closeMatch never composes to equivalence).
//
// DIFFERENT-PROPERTY pairs are NOT covered here and are NOT enforced: the one candidate (School op-status
// P000533 vs LEA op-status P000174, Appendix-B #3) was investigated and judged NOT must-never-merge — the
// abstract Ed-Fi EducationOrganization SUPERTYPE field legitimately crosswalks to BOTH concrete subtype
// properties, and no two DISTINCT concrete sources are equated. (Recorded in edf-equivalence/assets/
// curationInputs.js differentPropertyInvestigated + DEVLOG §6L; the gate of record asserts the only such
// bridge is that documented supertype.) Appendix-B #3 is enforced by gate 12 (distinct references).
//
// PASS = (a) the equivalence layer is non-trivial (>=1 cluster exists) AND (b) ZERO sources bridge a
// same-property/different-qualifier pair. Proven by test/phase6Equivalence.js BEFORE this flip: the
// gate-of-record twin injects a staff->student EXACT_MATCH and observes this exact check go RED, then
// restores it — the proof the guarantee actually bites.
//
// BOUNDARY (documented, carried forward): this single-hub, pairwise/structural check is COMPLETE only while
// equivalence stays NON-TRANSITIVE + SINGLE-HUB. When cross-hub equivalence (WHITEPAPER §4.7 — composes
// exactMatch ACROSS hubs) is implemented, the guard becomes incomplete and MUST be re-derived. See the
// PHASE-7 HANDOFF + the cross-hub phase.

module.exports = () => ({
	name: 'regression.conservativity',
	phase: 'Equivalence',
	kind: 'regression',
	expectFail: false, // ENFORCED at the Phase-6 re-freeze (the generalized structural invariant; twin-proven)
	run: (ctx, callback) => {
		// (b) the general structural invariant: any source EXACT_MATCH to two same-property/different-qualifier refs.
		const bridgeCypher = `
			MATCH (s)-[:EXACT_MATCH]->(r1:HubReference)
			MATCH (s)-[:EXACT_MATCH]->(r2:HubReference)
			WHERE r1.propertyKey = r2.propertyKey AND r1.qualifierKeys <> r2.qualifierKeys
			RETURN count(DISTINCT s) AS bridging
		`;
		// (a) the equivalence layer is non-trivial: at least one cluster (a HubReference with >=2 exact sources).
		const clusterCypher = `
			MATCH (r:HubReference)<-[:EXACT_MATCH]-(s)
			WITH r, count(DISTINCT s) AS sourceCount
			WHERE sourceCount >= 2
			RETURN count(r) AS clusters
		`;
		ctx.resources.lifecycle.runCypher(
			{ graphName: ctx.candidateGraphName, cypher: bridgeCypher, params: {} },
			(err, bridgeResult) => {
				if (err) {
					callback('', { passed: false, detail: `bridge query error: ${err}` });
					return;
				}
				const bridging = Number(((bridgeResult.records || [])[0] || {}).bridging || 0);
				ctx.resources.lifecycle.runCypher(
					{ graphName: ctx.candidateGraphName, cypher: clusterCypher, params: {} },
					(err2, clusterResult) => {
						if (err2) {
							callback('', { passed: false, detail: `cluster query error: ${err2}` });
							return;
						}
						const clusters = Number(((clusterResult.records || [])[0] || {}).clusters || 0);
						callback('', {
							passed: clusters >= 1 && bridging === 0,
							detail: `equivalenceClusters=${clusters} (must be >=1); sources bridging a same-property/different-qualifier reference pair=${bridging} (must be 0 — the generalized must-never-merge invariant; covers student/staff + all qualifier-distinct pairs)`,
						});
					},
				);
			},
		);
	},
});
