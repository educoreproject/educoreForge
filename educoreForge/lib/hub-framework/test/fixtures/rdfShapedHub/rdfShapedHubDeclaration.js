'use strict';

// rdfShapedHubDeclaration.js — ⟪ctdlHub P3 step 6⟫ the hub declaration of the SYNTHETIC RDF-shaped fixture hub
// (rdfShapedBase.json beside it). It declares what CTDL will declare in P4 — the term tier on, ranges as meaning — over a
// base small enough that every card count can be stated and explained by hand. It is test data: no build loads it.
//
// The base's ids are CURIEs used as-is (uri = canonicalKey = domainId for a class), as the CTDL forge emits them, so a
// term card's termIri is the CURIE and a property card's propertyUri is the IRI its HAS_TERM_REFERENCE resolves.

const hubDeclaration = {
	hubName: 'FIXTURE',
	hubDisplayName: 'RDF-shaped fixture hub',
	canonicalKeyName: 'term CURIE',
	canonicalKeyMinted: false,
	sourceIdFieldName: 'canonicalKey',
	baseFieldNames: {
		allDomainIds: 'allDomainIds',
		rangeOptionSetId: 'rangeOptionSetId',
		rangeClassId: 'rangeClassId',
		rangeDatatype: 'rangeDatatype',
		textFormat: 'textFormat',
		prefLabel: 'prefLabel',
		notation: 'notation',
		dataType: 'dataType',
		uri: 'uri',
		name: 'name',
		definition: 'definition',
		description: 'description',
		canonicalKey: 'canonicalKey',
		domainId: 'domainId',
	},
	// no qualifiedReference: an RDF vocabulary has no identification pattern, so pass 2 is skipped entirely
	provenanceLabel: {
		forgeModule: 'hub-framework',
		forgeModuleVersion: '1.1.0',
	},
	tierList: ['term', 'property', 'value'],
	rangeAddressing: 'rangeAsMeaning',
	// ⟪ctdlHub P4⟫ as CTDL: a property's domains are the classes with a HAS_PROPERTY edge to it, never a base field
	domainAddressing: 'hasPropertyEdges',
	// ⟪ctdlHub P4⟫ as CTDL: a release label like 'Release 20260327' becomes 'Release_20260327' in the card IRI
	hubVersionSegment: 'whitespaceToUnderscore',
	rootFieldNames: {
		standardKey: 'standardKey',
		snapshotKey: 'snapshotKey',
		publishedVersion: 'publishedVersion',
		version: 'version',
		sourceUrl: 'sourceUrl',
	},
	embedTextTemplateByTier: {
		term: [['termName'], ['termDefinition']],
		property: [['domainName'], ['propertyName'], ['propertyDefinition'], ['rangeClassNameList', 'rangeOptionSetNameList', 'rangeDatatypeList']],
		value: [['domainName', 'propertyName', 'rangeOptionSetName'], ['valueName'], ['valueDefinition'], ['rangeOptionSetDefinition']],
	},
};

module.exports = hubDeclaration;
