'use strict';

// edfiForgeDeclaration.js — H1 for the Ed-Fi forge bundle (SPEC-forgeFramework-v1.md §4; the
// migration commit, F3b). DATA, never code: the constants forgeEdfiContractGraph.js:57-75 carried
// (STANDARD_KEY / STANDARD_SOURCE / STANDARD_DISPLAY / STABLE_URI_PROPERTY_NAME / ROOT_STABLE_ID /
// the CEDS anchor names / edfiMappingInstruction) written ONCE, in the framework's declared shape.
// Required by the entry module (forgeEdfi.js) and by the hooks/walk so descriptor-shaped data is
// written once. Every value here is a BYTE of the Ed-Fi block (aea6d8dfe789…) or an identity rule
// the framework enforces; none is derived.
//
// Compatibility declarations (SPEC §7; Profile v1.0.2 §13.1) — exactly TWO, ruled 2026-08-16:
//   E6  root sourceUrl '' reproduced (forgeEdfiContractGraph.js:487 stamped metadata.sourceUrl || '';
//       Profile §10.4 says OMIT — retirement is a byte change in its own commit).
//   E8  root sourceFiles names the FIVE LOGICAL input names Ed-Fi's forge() composed
//       (forgeEdfi.js:183-185: the two MetaEd source inputs + three loader logical names), not
//       verified SHA256SUMS paths; the tightened row (ruling 03:40) admits exactly the names
//       declared in logicalSourceFileNameList beside verified files. Retirement = the verified list.
// The F3b probes (2026-08-16) measured: 0 non-string / '' names, 0 '' descriptions, 0 stableIds
// failing the REAL predicate below (1,640 carry interior spaces, admitted by `.+` — ruled no
// allowance), collision census 0/0/0 — so no other row is declared.

// the authored-crosswalk anchor column names — the ONE place they are written; the walk reads them
// back through mappingInstruction (the locator it stashes IS the declared original anchor name)
const CEDS_ANCHOR_PROPERTY_NAME = 'CEDSGlobalId';
const CEDS_OPTION_ANCHOR_PROPERTY_NAME = 'CEDSOptionCode';
const STABLE_URI_PROPERTY_NAME = 'edfiStableId';

const edfiForgeDeclaration = Object.freeze({
	standardKey: 'edfi',
	standardSource: 'EdFi', // === parserDescriptor.ini standardName, EXACT (gate G-SOURCE)
	standardDisplayName: 'Ed-Fi Data Standard',
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	// the REAL predicate (forgeEdfiContractGraph.js:216-221 EDFI_STABLE_ID_RE + trim), as data (FR6)
	stableIdPattern: Object.freeze({ pattern: '^edfi:[A-Za-z]+(/.+)?$', trimmed: true }),
	rootStableIdFrom: 'declared',
	rootStableId: 'edfi:root',
	rootLabel: 'EdfiRoot',
	parserVersion: '2',
	// UNCHANGED from the incumbent (the bridge resolves EdFi.cedsId == CedsProperty.cedsId in a later
	// phase; same anchors, same resolver property); six keys in THIS order — the JSON string is a byte
	mappingInstruction: Object.freeze({
		cedsOriginalAnchorPropertyName: Object.freeze([CEDS_ANCHOR_PROPERTY_NAME]),
		cedsOptionOriginalAnchorPropertyName: Object.freeze([CEDS_OPTION_ANCHOR_PROPERTY_NAME]),
		crosswalkPrefix: Object.freeze([]),
		crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
		includeInImplied: true,
		impliedTargets: Object.freeze(['CEDS']),
	}),
	nonEmbeddableRoleList: Object.freeze([]),
	// embed-text lists — TQ decision 1 (PLAN-forgeEmbedText-091426 §8.2), label verbatim (R-ET-15). List
	// order is the derivation's iteration order. Oracle (R-ET-17, evidence/P1-textListCensus-v2.log):
	// 3,281 text nodes / 4,954 EMBEDS_TEXT_OF edges, all single-name. Declaring this MOVES the Ed-Fi
	// proxy and block id (re-pinned in P8), by design.
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'EdfiEmbedText',
		textPropertyListByRole: Object.freeze({
			DmeClass: Object.freeze(['name', 'description', 'shortDescription']),
			DmeProperty: Object.freeze(['name', 'description', 'shortDescription']),
			DmeOptionSet: Object.freeze(['name', 'description', 'shortDescription']),
		}),
	}),
	// CEDS_NO_MAPPING_SENTINEL '000000' (forgeEdfiContractGraph.js:64) — the crosswalk's "no mapping" value
	cedsAnchorAbsentSentinelList: Object.freeze(['000000']),
	additionalSourceInputList: Object.freeze([]),
	compatibilityDeclarationList: Object.freeze([
		Object.freeze({ allowanceId: 'E6' }),
		Object.freeze({
			allowanceId: 'E8',
			// the exact five names forgeEdfi.js:183-185 composed, in the order the standard states:
			// metaEdSourceLoader.js METAED_SOURCE_INPUT_NAMES + the three loader logical names
			logicalSourceFileNameList: Object.freeze([
				'metaEdModel',
				'tpdmCommunityModel',
				'descriptorCodeValues',
				'tpdmDescriptorCodeValues',
				'cedsAuthoredCrosswalk',
			]),
		}),
	]),
});

// exported un-applied (a plain frozen object, no factory): the declaration is data
module.exports = edfiForgeDeclaration;
