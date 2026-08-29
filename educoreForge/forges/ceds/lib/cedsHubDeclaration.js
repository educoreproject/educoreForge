'use strict';

// cedsHubDeclaration.js — H1 for the CEDS HUB role: DATA a hub author writes instead of code
// (SPEC-hubKitRole-082826.md §4.4, with the baseFieldNames correction FROZEN_JOURNEY made on
// review finding F6 — dataType and uri were missing from the published table).
//
// Deliberate sibling of lib/cedsForgeDeclaration.js. Everything here was a LITERAL inside
// cedsHubForge.js before Phase 2c; the framework now reads it through this table, so a second hub
// is a second declaration and not a branch in shared code.
//
// PROVENANCE IS DECLARED, NOT DERIVED (§4.4 [R2 F1], §4.9). forgeModule/forgeModuleVersion are
// stamped into HubDefinition.sourceProvenance, which is a NODE PROPERTY and therefore a BLOCK BYTE.
// These two values were re-keyed by controlled experiment in Phase 2b (commit 4ce39b8) and PROVED
// to move exactly one line of the block and nothing else. THEY MUST NOT BE EDITED without repeating
// that experiment: the CEDS block id I1' = e763404ea5864e2c9a9d4521b0887343e0c42bd5aa59565e2d2b1bba70dfb855
// depends on them character for character.
//
// @concept: [[CedsHubDeclaration]]

// START OF moduleFunction() ============================================================

const hubDeclaration = {
	// ---- IDENTITY (was cedsHubForge.js:132-135) ----
	// hubName is the FIRST address-signature slot and is asserted equal to
	// forgeDeclaration.standardSource by the framework (invariant I12, [R2 F6]) — two declarations of
	// the same value existed with no cross-check until Phase 2c collapsed them.
	hubName: 'CEDS',
	hubDisplayName: 'Common Education Data Standards',
	// a LABEL for the key, not the key itself: the canonical key is read PRE-LIFTED off the base
	// (the forge lifts, the hub reads — SPEC §3.3), so nothing here mints one.
	canonicalKeyName: 'CEDS Global ID',
	canonicalKeyMinted: false,

	// ---- the source's own id field: report source-id AND divergence sort key (was 'cedsId' hard-coded) ----
	sourceIdFieldName: 'cedsId',

	// ---- BASE FIELD NAMES (§4.4 [R1 Q2], as corrected) ----------------------------------------
	// The "generic" derivation is generic against a CEDS-SHAPED base: it reads these off base nodes
	// by BARE NAME, and none of them is a vocabulary constant. Measured in Phase 2 by enumerating
	// every `.properties.<name>` read in the module: 21 distinct base fields, of which these are the
	// ones with no vocabulary backing at all.
	//
	// The map is name -> name today because CEDS is the standard the derivation grew up against.
	// That is the POINT of the indirection, not a defect in it: a second hub whose base calls its
	// prose 'comment' rather than 'definition' changes this line and no framework line.
	baseFieldNames: {
		allDomainIds: 'allDomainIds',
		rangeOptionSetId: 'rangeOptionSetId',
		rangeClassId: 'rangeClassId',
		rangeDatatype: 'rangeDatatype',
		textFormat: 'textFormat',
		prefLabel: 'prefLabel',
		notation: 'notation',
		dataType: 'dataType', // ADDED by review F6 — read into cardProperties.propertyDataType
		uri: 'uri', //           ADDED by review F6 — the §1.4 provenance read on all four roles + root
		name: 'name',
		definition: 'definition',
		description: 'description', // divergence report only
	},

	// ---- QUALIFIED REFERENCE — §4.3 identification patterns, as DATA not a hook ([R1 Q7]) ------
	// Pass 2 depends on the framework's private indexes (propertyNodesOfClass, optionSetNodeOfProperty,
	// valueNodesOfOptionSet, classByDomainId) and on emitReference. A hook would need all of them —
	// a very wide seam — so the PASS stays in the framework and the declaration supplies the two data
	// items that make it CEDS-shaped. ABSENT is legal: a hub declaring no qualifiedReference skips
	// pass 2 entirely and returns identificationPatterns: [].
	qualifiedReference: {
		// the type property whose name announces an identification pattern; capture group 1 is the STEM
		typePropertyPattern: /^Has (.+) Identifier Type$/,
		// given that stem, the property names that may carry the token. EXACTLY ONE must match or the
		// pattern is recorded and SKIPPED — never fabricated into a pairing.
		tokenNamesForStem: (stem) => [`${stem} Identifier`, `Has ${stem} Identifier`],
	},

	// ---- PROVENANCE LABEL — BLOCK BYTES. See the header. ---------------------------------------
	provenanceLabel: {
		forgeModule: 'hub-framework',
		forgeModuleVersion: '1.0.0',
	},
};

// END OF moduleFunction() ============================================================

module.exports = hubDeclaration;
