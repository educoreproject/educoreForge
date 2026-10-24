'use strict';

// caseForgeDeclaration.js — H1 for the CASE 1.1 forge bundle (nextStandards wave 2 lane E, 2026-10-24): DATA only.
//
// NAMING (DESIGN-E0-case-102426.md §4, ruled by BRONZE_CROWN): standardKey case, standardSource CASE (the July _source, so the inventory
// oracle's name matches), family CASE, stableIds case:…, labels Case….
//
// THE FORGE DOES NO BRIDGING (FBB-001). CASE's own terms, $refs and enum values are the forge's; nothing here names a hub, a card or a
// mapping, so mappingInstruction is empty. The 1EdTech annotations (x-1edtech-confidentiality, -privacy, -confidentiality-normal) are
// carried verbatim as data. nativeIdentifierPropertyName is null: the document publishes no identifier for its schemas or properties.

const path = require('path');
const { DME_ROLES, STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'forgeDeclarationContract'));
const { stableIdPatternFor } = require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiIdentity'));
const openapiProfile = require('./caseOpenapiProfile.json');

const STABLE_URI_PROPERTY_NAME = 'caseStableId';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = Object.freeze([Object.freeze({}), Object.freeze({}), Object.freeze([]), STABLE_URI_PROPERTY_NAME]);

const caseForgeDeclaration = Object.freeze({
	standardKey: 'case',
	standardSource: 'CASE', // equals parserDescriptor.ini standardName exactly (G-SOURCE)
	standardDisplayName: 'CASE 1.1 (CASE)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardFamily: STANDARD_FAMILY.CASE,
	releaseLabel: 'CASE',
	descriptionSource: "each schema's and each property's OpenAPI 'description', carried verbatim from the publisher's YAML (a block scalar keeps its final newline: 39 schema and 29 property descriptions end in one): CASE publishes one for all 39 schemas and for 164 of 201 properties; the 37 properties that are a bare $ref carry none, because OpenAPI 3.0 allows no sibling of $ref. Most property descriptions end with the 1EdTech model's datatype ('Model Primitive Datatype = NormalizedString.'). Option sets and their values publish no description.",
	nativeIdentifierPropertyName: null,
	standardUsageTips: "CASE 1.1 is an OpenAPI 3.0 data model for publishing competency frameworks and academic standards: a CFDocument (the framework) holds CFItems (its statements), related by CFAssociations (isChildOf, exactMatchOf, …), with definitions (CFConcept, CFSubject, CFLicense, CFItemType, CFAssociationGrouping) and rubrics (CFRubric, CFRubricCriterion, CFRubricCriterionLevel). A DmeClass is a schema of components.schemas (39, named …DType as the publisher names them, including 13 empty *ExtensionDType containers and five imsx_* / Link* plumbing schemas); the CFPckg* schemas are the package forms of CFDocument, CFItem and CFAssociation, so their properties repeat those. A DmeProperty is one property of one schema. A property whose value is another schema has a REFERENCES edge to it: referenceConstruct $ref for a single value, items for an array; locator is the JSON pointer. An enum is a DmeOptionSet owned by its property; associationType is EXTENSIBLE (anyOf an enum and a pattern), and its compositionBranches says so. x_1edtechConfidentiality, x_1edtechPrivacy and x_1edtechConfidentialityNormal are 1EdTech's privacy annotations (the last two JSON lists). isRequired is the schema's required list.",
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: stableIdPatternFor(openapiProfile),
	rootStableIdFrom: 'declared',
	rootStableId: openapiProfile.rootStableId,
	rootLabel: 'CaseRoot',
	parserVersion: '1',
	// EMPTY: the forge makes no mapping claim. Built from the framework contract's own ordered name list (the stringified object is a
	// block byte, so order matters), the pescld form. The values, by position: two anchor-name maps, crosswalkPrefix,
	// crosswalkResolveProperty.
	mappingInstruction: Object.freeze(MAPPING_INSTRUCTION_KEY_ORDER.reduce(
		(instruction, instructionPropertyName, propertyIndex) => ({ ...instruction, [instructionPropertyName]: EMPTY_MAPPING_INSTRUCTION_VALUE_LIST[propertyIndex] }),
		{},
	)),
	nonEmbeddableRoleList: Object.freeze([]),
	// the texts embedTextVote-v1 retrieval reads: a schema's and a property's name and description, an enum's name (the Open Badges form)
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'CaseEmbedText',
		textPropertyListByRole: Object.freeze({
			[DME_ROLES.CLASS]: Object.freeze(['name', 'description']),
			[DME_ROLES.PROPERTY]: Object.freeze(['name', 'description']),
			[DME_ROLES.OPTION_SET]: Object.freeze(['name']),
		}),
	}),
	additionalSourceInputList: Object.freeze([Object.freeze({ inputName: 'sourceLocation', relativePathFromSourcePath: 'standardSourceLocation' })]),
	// EMPTY, as the framework requires of a bundle outside MIGRATING_BUNDLE_LIST
	compatibilityDeclarationList: Object.freeze([]),
});

module.exports = caseForgeDeclaration;
