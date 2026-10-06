'use strict';

// edfiForgeDeclaration.js — H1 for the Ed-Fi forge bundle (SPEC-forgeFramework-v1.md §4; the
// migration commit, F3b). DATA, never code: the constants forgeEdfiContractGraph.js:57-75 carried
// (STANDARD_KEY / STANDARD_SOURCE / STANDARD_DISPLAY / STABLE_URI_PROPERTY_NAME / ROOT_STABLE_ID /
// the CEDS anchor names / edfiMappingInstruction) written ONCE, in the framework's declared shape.
// Required by the entry module (forgeEdfi.js) and by the hooks/walk so descriptor-shaped data is
// written once. Every value here is a BYTE of the Ed-Fi block (aea6d8dfe789…) or an identity rule
// the framework enforces; none is derived.
//
// Compatibility declarations (SPEC §7; Profile v1.0.2 §13.1) — TWO ruled 2026-08-16, ONE since P3:
//   E6  RETIRED P3 W-C-16 (G14 c1, TQ 2026-10-06): the root now carries the Data Standard repository URL.
//   E8  root sourceFiles names the LOGICAL input names Ed-Fi's forge() composed (FIVE until the crosswalk's
//       retirement on 2026-10-02, FOUR since: the two MetaEd source inputs + two loader logical names), not
//       verified SHA256SUMS paths; the tightened row (ruling 03:40) admits exactly the names
//       declared in logicalSourceFileNameList beside verified files. Retirement = the verified list.
// The F3b probes (2026-08-16) measured: 0 non-string / '' names, 0 '' descriptions, 0 stableIds
// failing the REAL predicate below (1,640 carry interior spaces, admitted by `.+` — ruled no
// allowance), collision census 0/0/0 — so no other row is declared.

// THE CROSSWALK IS RETIRED (2026-10-02, BRIEF-F; TQ 2026-09-10 and 2026-10-01: excluded from every graph,
// "known to be garbage"). The two anchor column names it supplied (CEDSGlobalId, CEDSOptionCode) are gone with
// it: Ed-Fi's own MetaEd publishes no CEDS anchor, so this forge makes NO mapping claim. mappingInstruction is
// empty in the shape sif260928 and the PESC release forge declare (an anchor list is an instruction to
// downstream mapping machinery). The fifth logical source name and the '000000' no-mapping sentinel were the
// crosswalk's too, and leave with it. Each is a root byte: the Ed-Fi base moves by design.
const STABLE_URI_PROPERTY_NAME = 'edfiStableId';
const path = require('path');
const { STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const edfiForgeDeclaration = Object.freeze({
	standardKey: 'edfi',
	standardSource: 'EdFi', // === parserDescriptor.ini standardName, EXACT (gate G-SOURCE)
	standardDisplayName: 'Ed-Fi Data Standard',
	// ⟪lane R, 2026-10-05; TQ⟫ what kind of standard this is and how to read it in the graph, stamped on the root and read by
	// the StandardDefinition card. Text moved VERBATIM from configs/dmeStandardUsageTips.json (lane Q's, 2026-10-04).
	standardKind: STANDARD_KIND.DATA_STANDARD,
	// ⟪campaign P3, W-C-4⟫ the family and which member of it, version-free (CONTRACTS §7)
	standardFamily: STANDARD_FAMILY.EDFI,
	releaseLabel: 'EdFi',
	standardUsageTips: "Ed-Fi keeps its mappings directly on its properties (no instance nodes). The same property name often appears in several Ed-Fi entities or common types (e.g. BirthDate in the BirthData inline common and in ApplicantProfile), each with its own mapping and confidence: name the owning entity when presenting, and do not merge their confidences.",
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	// the REAL predicate (forgeEdfiContractGraph.js:216-221 EDFI_STABLE_ID_RE + trim), as data (FR6)
	stableIdPattern: Object.freeze({ pattern: '^edfi:[A-Za-z]+(/.+)?$', trimmed: true }),
	rootStableIdFrom: 'declared',
	rootStableId: 'edfi:root',
	rootLabel: 'EdfiRoot',
	parserVersion: '2',
	// EMPTY: no mapping claim (the crosswalk is retired, see the header); six keys in THIS order — the JSON
	// string is a byte
	mappingInstruction: Object.freeze({
		cedsOriginalAnchorPropertyName: Object.freeze([]),
		cedsOptionOriginalAnchorPropertyName: Object.freeze([]),
		crosswalkPrefix: Object.freeze([]),
		crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
		includeInImplied: false,
		impliedTargets: Object.freeze([]),
	}),
	nonEmbeddableRoleList: Object.freeze([]),
	// embed-text lists — TQ decision 1 (PLAN-forgeEmbedText-091426 §8.2), label verbatim (R-ET-15). List
	// order is the derivation's iteration order. Oracle (R-ET-17, evidence/P1-textListCensus-v2.log):
	// 3,281 text nodes / 4,954 EMBEDS_TEXT_OF edges, all single-name. Declaring this MOVES the Ed-Fi
	// proxy and block id (re-pinned in P8), by design.
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'EdfiEmbedText',
		textPropertyListByRole: Object.freeze({
			// shortDescription removed (G14 a1, TQ 2026-10-06): a phantom — no node of these roles carries it
			DmeClass: Object.freeze(['name', 'description']),
			DmeProperty: Object.freeze(['name', 'description']),
			DmeOptionSet: Object.freeze(['name', 'description']),
		}),
	}),
	// EMPTY since the crosswalk's retirement: '000000' was the crosswalk's "no mapping" value, and nothing
	// this forge reads carries a CEDS anchor
	cedsAnchorAbsentSentinelList: Object.freeze([]),
	additionalSourceInputList: Object.freeze([]),
	compatibilityDeclarationList: Object.freeze([
		Object.freeze({
			allowanceId: 'E8',
			// the four names, in the order the standard states: metaEdSourceLoader.js METAED_SOURCE_INPUT_NAMES +
			// the two code-value loader logical names ('cedsAuthoredCrosswalk', the fifth, retired 2026-10-02)
			logicalSourceFileNameList: Object.freeze([
				'metaEdModel',
				'tpdmCommunityModel',
				'descriptorCodeValues',
				'tpdmDescriptorCodeValues',
			]),
		}),
	]),
});

// exported un-applied (a plain frozen object, no factory): the declaration is data
module.exports = edfiForgeDeclaration;
