'use strict';

// curationInputs.js — the DURABLE Phase-6 CURATION FIXTURE (frozen manifest content; replayed
// deterministically, NO LLM). Each promotion is a HUMAN-VETTED act: it promotes a Phase-5 inferred
// closeMatch (which lands on the UNQUALIFIED Person Identifier P001572) to a curated EXACT_MATCH at the
// QUALIFIED reference (the role distinction the property-tier pick could not make). This is the lever that
// resolves Appendix-B #1 (gives the qualified Student reference a 2nd EXACT_MATCH source — SIF alongside the
// EdFi authored one — so the equivalence cluster forms and gate 10 flips), and demonstrates conservativity
// (staff lands on the DISTINCT staff reference; the two clusters stay disjoint).
//
// The SPECIFIC field choice is a curation/vocabulary judgment (flagged to WILD_FALCON for review). The
// acceptance contract is objective: any genuine SIF student identifier on the qualified Student reference
// satisfies gate 10. Targets resolve via (targetPropertyKey '|' qualifierKey) against the materialized
// HubReference subgraph; an input that does not resolve materializes NOTHING (recorded as an orphan).
//
// @concept: [[CurationFixture]]
// @concept: [[MappingAssertion]]

module.exports = {
	sourceStandard: 'SIF',
	promotions: [
		{
			fromStableId: 'sif:field//StudentSchoolEnrollments/StudentSchoolEnrollment/@StudentPersonalRefId',
			targetPropertyKey: 'P001572', // Person Identifier
			qualifierKey: 'OV002114100002', // Has Person Identifier Type = Student Identifier
			annotation: 'CURATED_BY',
			curator: 'tqii',
			note:
				'SIF StudentSchoolEnrollment is the structural analog of EdFi ' +
				'StudentEducationOrganizationAssociation; its @StudentPersonalRefId is the student identifier in ' +
				'the enrollment/org-association context — the cross-standard counterpart of EdFi IdentificationCode. ' +
				'Vetted promotion of the Phase-5 closeMatch (unqualified P001572) to the QUALIFIED Student Identifier ' +
				'reference (OV002114100002).',
		},
		{
			fromStableId: 'sif:field//StaffAssignments/StaffAssignment/@StaffPersonalRefId',
			targetPropertyKey: 'P001572', // Person Identifier
			qualifierKey: 'OV002114100003', // Has Person Identifier Type = Staff Member Identifier
			annotation: 'CURATED_BY',
			curator: 'tqii',
			note:
				'SIF StaffAssignment is the analog of an EdFi staff organization-assignment; its @StaffPersonalRefId ' +
				'is the staff identifier. Promotion to the QUALIFIED Staff Member Identifier reference (OV002114100003) ' +
				'— staff lands on the DISTINCT staff reference, keeping the student and staff clusters disjoint ' +
				'(conservativity-positive).',
		},
	],
	// The conservativity guarantee (DEVLOG §6L-c) has TWO complementary checks:
	//
	// (A) the GENERAL STRUCTURAL INVARIANT (checkQualifierConservativity) — needs NO list: it asserts NO
	//     source is EXACT_MATCH to two HubReferences that share a base property but DIFFER in the qualifier.
	//     That single rule is the general form of the studentId != staffId thesis and covers every future
	//     qualifier-distinct identifier pair. student/staff is its NAMED TEST CASE + twin (below).
	qualifierConservativityNamedCase: {
		label: 'studentId vs staffId (Person Identifier P001572, role qualifier) — named test of the general invariant',
		basePropertyKey: 'P001572',
		qualifierA: 'OV002114100002', // Student Identifier
		qualifierB: 'OV002114100003', // Staff Member Identifier
	},
	// (B) DIFFERENT-PROPERTY must-never-merge pairs the same-property invariant does NOT cover. The ENFORCED
	//     list is EMPTY — the one candidate pair (School op-status P000533 vs LEA op-status P000174, named in
	//     Appendix-B #3) was INVESTIGATED and judged NOT must-never-merge (WILD_FALCON's option (b)):
	differentPropertyMustNeverMerge: [],
	differentPropertyInvestigated: [
		{
			label: 'School Operational Status (P000533) vs LEA Operational Status (P000174)',
			propertyA: 'P000533', // Has School Operational Status / School Operational Detail
			propertyB: 'P000174', // Has Local Education Agency Operational Status / LEA Operational Detail
			verdict: 'NOT must-never-merge',
			// the ONE source that legitimately holds EXACT_MATCH to both (the abstract supertype):
			legitimateSupertypeBridge: ['edfi:field/EducationOrganization.OperationalStatusDescriptor'],
			reason:
				'The abstract Ed-Fi EducationOrganization SUPERTYPE operational-status field crosswalks (authored, ' +
				'spec-authoritative) to BOTH the School (P000533) and LEA (P000174) operational-status properties — ' +
				'when the org is a School it IS the school status, when an LEA it IS the LEA status. A single source ' +
				'(the supertype) can LEGITIMATELY be EXACT_MATCH to both, and no two DISTINCT concrete sources are ' +
				'falsely equated (School-only and LEA-only sources never share a reference). So this pair is NOT ' +
				'must-never-merge. Appendix-B #3 is satisfied by the REFERENCES being distinct nodes (gate 12) + the ' +
				'sources resolving to distinct refs — NOT by forbidding a common supertype source. The general ' +
				'qualifier invariant correctly does NOT flag it (different properties, not same-property/diff-qualifier).',
		},
	],
};
