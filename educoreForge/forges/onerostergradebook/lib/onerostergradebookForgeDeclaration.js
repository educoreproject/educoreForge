'use strict';

// onerostergradebookForgeDeclaration.js — H1 for the OneRoster 1.2 Gradebook forge bundle (nextStandards-102326 wave 3 lane H1, 2026-10-24): DATA only.
//
// NAMING (DESIGN-H0-oneroster-102426.md; BRONZE_CROWN ruling R2): OneRoster 1.2 is THREE standards in family OneRoster, one per REST
// service model the publisher issues (Rostering, Gradebook, Resources). This one: standardKey onerostergradebook, standardSource OneRoster-Gradebook-1.2 (the PESC
// family's <Family>-<Member>-<version> form), releaseLabel Gradebook, stableIds onerostergradebook:…, labels OnerosterGradebook….
//
// THE FORGE DOES NO BRIDGING (FBB-001). The service's own terms, $refs and enum values are the forge's; nothing here names a hub, a card or
// a mapping, so mappingInstruction is empty. A schema whose name also occurs in another OneRoster service is this service's OWN copy (its
// persistent ids are in this service's namespace, its $refs local) and is forged with no edge to the other service. The 1EdTech persistent
// ids (x-class-pid, x-srcprop-pid) are carried verbatim as data. nativeIdentifierPropertyName is null: x-srcprop-pid names a property's
// VALUE TYPE, so the standard publishes no identifier for its properties.

const path = require('path');
const { DME_ROLES, STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'forgeDeclarationContract'));
const { stableIdPatternFor } = require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiIdentity'));
const openapiProfile = require('./onerostergradebookOpenapiProfile.json');

const STABLE_URI_PROPERTY_NAME = 'onerostergradebookStableId';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = Object.freeze([Object.freeze({}), Object.freeze({}), Object.freeze([]), STABLE_URI_PROPERTY_NAME]);

const onerostergradebookForgeDeclaration = Object.freeze({
	standardKey: 'onerostergradebook',
	standardSource: 'OneRoster-Gradebook-1.2', // equals parserDescriptor.ini standardName exactly (G-SOURCE)
	standardDisplayName: 'OneRoster 1.2 Gradebook (OneRoster)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardFamily: STANDARD_FAMILY.ONEROSTER,
	releaseLabel: 'Gradebook',
	descriptionSource: "each schema's and each property's OpenAPI 'description', carried verbatim: OneRoster 1.2 Gradebook publishes one for all 37 schemas and for 107 of 138 properties; the 31 properties that are a bare $ref carry none, because OpenAPI 3.0 allows no sibling of $ref. Option sets and their values publish no description.",
	nativeIdentifierPropertyName: null,
	standardUsageTips: "OneRoster 1.2 Gradebook is the OpenAPI 3.0 data model of 1EdTech's K-12 gradebook service: line items and assessment line items, their categories and score scales, and the results and assessment results recorded against them, with learning-objective scores. A DmeClass is a schema of components.schemas (37, including 16 API-plumbing schemas: the Single* and *Set response wrappers and imsx_*); a DmeProperty is one property of one schema, so 'sourcedId' or 'status' appears once per schema that has it. The *GUIDRef classes are typed references by sourcedId and href (ClassGUIDRef, UserGUIDRef, ... point at Rostering's objects by identifier only); Metadata is an empty, extensible container for proprietary extensions. OneRoster 1.2 is three standards in this graph (Rostering, Gradebook, Resources; family OneRoster): a class of the same name in two of them (ClassGUIDRef, imsx_StatusInfo, Metadata) is each service's own copy, related by no edge. A property whose value is another schema has a REFERENCES edge to that schema's class: referenceConstruct says how ($ref for a single value, items for an array of them) and locator is the exact JSON pointer. An enum is a DmeOptionSet owned by its property; four are EXTENSIBLE (anyOf an enum and a pattern '(ext:)...', e.g. Result.scoreStatus, whose members 'fully graded', 'not submitted' and 'partially graded' are percent-encoded in their ids, never in their names). xClassPid is the 1EdTech persistent id of a schema; xSrcpropPid on a property is the persistent id of its VALUE TYPE, not of the property. isRequired is the schema's required list.",
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: stableIdPatternFor(openapiProfile),
	rootStableIdFrom: 'declared',
	rootStableId: openapiProfile.rootStableId,
	rootLabel: 'OnerosterGradebookRoot',
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
		embedTextLabel: 'OnerosterGradebookEmbedText',
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

module.exports = onerostergradebookForgeDeclaration;
