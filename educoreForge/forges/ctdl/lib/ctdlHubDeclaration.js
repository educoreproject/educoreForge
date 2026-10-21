'use strict';

// ctdlHubDeclaration.js — H1 for the CTDL HUB role (ctdlHub-101926 P4): DATA a hub author writes instead of code
// (SPEC-hubKitRole-082826.md §4.4). Deliberate sibling of lib/ctdlForgeDeclaration.js and of
// forges/ceds/lib/cedsHubDeclaration.js; the second real hub on lib/hub-framework.
//
// THE CANONICAL KEY IS THE TERM'S CURIE EXACTLY AS FORGED (e.g. ceterms:Credential), never a CTID: a CTID names a
// registry RECORD, not a vocabulary term (PLAN §3.2). The CTDL forge stamps the CURIE as the node's uri (and stableId), so
// every identity read below goes through 'uri'.
//
// WHAT THE CTDL BASE DOES NOT CARRY, AND WHY THAT IS SAFE (measured on the P2b-enriched base, P4 step 1):
//   allDomainIds, domainId on properties  — domains are HAS_PROPERTY edges, read by domainAddressing 'hasPropertyEdges'
//                                           (the field read is never made; allDomainIds names a field no CTDL node has)
//   rangeClassId                          — read only by singleRangeSlot and pass 2; this hub is rangeAsMeaning with no
//                                           qualifiedReference, so neither runs
//   textFormat, prefLabel, notation, dataType — CEDS card extras, carried only when present; absent on CTDL, so absent on
//                                           the cards (never '' — hasProse)
// The datatype ranges ARE carried: the forge lifts them as rangeDatatypeList (row E14, SCARLET_ARROW ruling), read here
// list-agnostically through baseFieldNames.rangeDatatype.
//
// PROVENANCE IS DECLARED, NOT DERIVED (§4.9): provenanceLabel is BLOCK BYTES of the CTDL block. Its first anchor is the
// block id recorded in DEVLOG-P4.md; editing these two values moves that id.
//
// @concept: [[CtdlHubDeclaration]]

// START OF moduleFunction() ============================================================

const hubDeclaration = {
	// ---- IDENTITY ----
	// I12: hubName equals forgeDeclaration.standardSource ('CTDL'); the framework asserts it by name
	hubName: 'CTDL',
	hubDisplayName: 'Credential Transparency Description Language',
	canonicalKeyName: 'CTDL term CURIE',
	canonicalKeyMinted: false,

	// the source's own id: the CURIE (report source-id and divergence sort key)
	sourceIdFieldName: 'uri',

	// ---- BASE FIELD NAMES (logical name -> CTDL base property) ----
	baseFieldNames: {
		allDomainIds: 'allDomainIds', // absent on CTDL; unread under hasPropertyEdges
		rangeOptionSetId: 'uri', // a concept scheme's id is its CURIE
		rangeClassId: 'rangeClassId', // absent on CTDL; unread under rangeAsMeaning without qualifiedReference
		rangeDatatype: 'rangeDatatypeList', // E14
		textFormat: 'textFormat', // absent on CTDL
		prefLabel: 'prefLabel', // absent on CTDL (the forge folds skos:prefLabel into name)
		notation: 'notation', // absent on CTDL
		dataType: 'dataType', // absent on CTDL
		uri: 'uri',
		name: 'name',
		// CTDL's prose is ONE composed text (dct:description, else rdfs:comment, else skos:definition — the forge's
		// descriptionSource); definition and description therefore read the same field and the divergence report is empty
		// by construction, not by accident
		definition: 'description',
		description: 'description',
		canonicalKey: 'uri',
		domainId: 'uri', // a class's domain id is its CURIE; read off the class node hasPropertyEdges finds
	},

	// ---- ⟪ctdlHub P3/P4⟫ the hub's shape ----
	tierList: ['term', 'property', 'value'],
	// every range a property declares is MEANING (listed, never hashed): schema:rangeIncludes is a hint, not a key
	rangeAddressing: 'rangeAsMeaning',
	// a property's domains are the classes with a HAS_PROPERTY edge to it (schema:domainIncludes, forged class -> property)
	domainAddressing: 'hasPropertyEdges',
	// the bundle's version is the release label 'Release 20260327'; in the card IRI it reads 'Release_20260327', the form
	// the block key already uses (SCARLET_ARROW ruling B). The hubVersion card field and the addressSignature keep it raw.
	hubVersionSegment: 'whitespaceToUnderscore',
	rootFieldNames: {
		standardKey: 'standardKey',
		snapshotKey: 'snapshotKey',
		publishedVersion: 'publishedVersion',
		version: 'version',
		sourceUrl: 'sourceUrl',
	},
	// embedText, slot by slot: a slot's fields joined ' · ', empty slots drop out, slots joined ' · '
	embedTextTemplateByTier: {
		term: [['termName'], ['termDefinition']],
		property: [['domainName'], ['propertyName'], ['propertyDefinition'], ['rangeClassNameList', 'rangeOptionSetNameList', 'rangeDatatypeList']],
		value: [['domainName', 'propertyName', 'rangeOptionSetName'], ['valueName'], ['valueDefinition'], ['rangeOptionSetDefinition']],
	},

	// no qualifiedReference: an RDF vocabulary has no identification pattern; pass 2 is skipped, identificationPatterns []

	// ---- PROVENANCE LABEL — BLOCK BYTES. See the header. ----
	provenanceLabel: {
		forgeModule: 'hub-framework',
		forgeModuleVersion: '1.1.0',
	},
};

// END OF moduleFunction() ============================================================

module.exports = hubDeclaration;
