'use strict';

// versionBridge.js — the maintained VERSION-BRIDGE TABLE for the Phase-4 authored-crosswalk track
// (WHITEPAPER §6.2, PLAN §Phase 4). The Ed-Fi CEDS crosswalk was authored against an OLDER CEDS version;
// six of its CEDS-property targets were REMODELED in the current hub and therefore have NO property-tier
// HubReference under their old Global ID (they are exactly gate 17's 6-miss set {P001070..P001075}). This
// table maps each OLD Global ID -> the CURRENT canonical address it became, so the conversion stays
// deterministic AND conservative (the per-role identifiers resolve to the SAME base property qualified by
// DIFFERENT type values -> distinct HubReferences -> student !== staff is preserved).
//
// DERIVED from the live CEDS hub (read-only, this build): Person Identifier = P001572 (class C200291
// Person Identification); the type qualifier values are OV002114100002 (Student Identifier) /
// OV002114100003 (Staff Member Identifier) — confirmed against the materialized qualified HubReferences
// (the same keys ground-truth NAMED_CASES + Phase-3 gate 11 use). Has Person Identification System =
// P001571 (C200291); Has Organization Identification System = P000827 (C200252).
//
// Each entry resolves against the materialized reference subgraph by (targetPropertyKey, qualifierKey):
// qualifierKey set -> the QUALIFIED property-tier HubReference; qualifierKey null -> the UNQUALIFIED base.
// Data only — no logic. Passed into the PURE core producer (mapping-subgraph) so the core stays generic.

module.exports = {
	hubName: 'CEDS',
	// keyed by the OLD CEDS Global ID that appears as a source-element cedsId.
	entries: {
		// --- per-role IDENTIFIER token properties -> Person Identifier + type qualifier (the load-bearing
		//     conservativity case: same base property P001572, DIFFERENT qualifier -> DISTINCT references) ---
		P001070: {
			targetPropertyKey: 'P001572',
			qualifierKey: 'OV002114100003',
			oldName: 'Staff Member Identifier',
			note: 'remodeled: Staff Member Identifier -> Person Identifier qualified by Has Person Identifier Type = Staff Member Identifier',
		},
		P001071: {
			targetPropertyKey: 'P001572',
			qualifierKey: 'OV002114100002',
			oldName: 'Student Identifier',
			note: 'remodeled: Student Identifier -> Person Identifier qualified by Has Person Identifier Type = Student Identifier',
		},
		// --- per-role IDENTIFICATION-SYSTEM properties -> Has Person Identification System (the current hub
		//     has NO per-role system property; the coding scheme is role-agnostic, so both collapse to one) ---
		P001074: {
			targetPropertyKey: 'P001571',
			qualifierKey: null,
			oldName: 'Has Staff Member Identification System',
			note: 'remodeled: -> Has Person Identification System (system is role-agnostic in current CEDS; role distinction lives on the identifier qualifier, not the system)',
		},
		P001075: {
			targetPropertyKey: 'P001571',
			qualifierKey: null,
			oldName: 'Has Student Identification System',
			note: 'remodeled: -> Has Person Identification System',
		},
		// --- organization-side identification-system properties: the old per-org-subtype properties collapse
		//     to the SINGLE current Has Organization Identification System (P000827) in the current hub. Their
		//     authored Yes rows resolve to P000827; the resulting (source,ref) edge dedups against the shared
		//     P000827 target (so they add coverage but not a uniquely-attributed version-bridge edge). Kept for
		//     correctness/completeness of the table. ---
		P001072: {
			targetPropertyKey: 'P000827',
			qualifierKey: null,
			oldName: 'Has Local Education Agency Identification System',
			note: 'remodeled: -> Has Organization Identification System (per-org-subtype system property collapsed to one)',
		},
		P001073: {
			targetPropertyKey: 'P000827',
			qualifierKey: null,
			oldName: 'Has School Identification System',
			note: 'remodeled: -> Has Organization Identification System (per-org-subtype system property collapsed to one)',
		},
	},
};
