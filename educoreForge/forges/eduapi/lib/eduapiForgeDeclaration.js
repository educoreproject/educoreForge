'use strict';

// eduapiForgeDeclaration.js — H1 for the EduAPI 1.0 forge bundle (nextStandards wave 2 lane F, 2026-10-24): DATA only.
//
// NAMING IS RULED (BRONZE_CROWN 2026-10-24, GATEREPORT-F0): standardKey eduapi, standardSource EduAPI (the July _source, so the
// inventory oracle's name matches), family EduAPI, stableIds eduapi:…, labels Eduapi….
//
// THE FORGE DOES NO BRIDGING (FBB-001). EduAPI's own terms, $refs and enum values are the forge's; nothing here names a hub, a card
// or a mapping, so mappingInstruction is empty. The 1EdTech persistent ids (x-class-pid, x-srcprop-pid) are carried verbatim as data.
// nativeIdentifierPropertyName is null: x-class-pid is unique per schema (39 of 39), but x-srcprop-pid names a property's VALUE TYPE
// (309 uses, 61 distinct; measured 2026-10-24), so the standard publishes no identifier for its properties.

const path = require('path');
const { DME_ROLES, STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'forgeDeclarationContract'));
const { stableIdPatternFor } = require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiIdentity'));
const openapiProfile = require('./eduapiOpenapiProfile.json');

const STABLE_URI_PROPERTY_NAME = 'eduapiStableId';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = Object.freeze([Object.freeze({}), Object.freeze({}), Object.freeze([]), STABLE_URI_PROPERTY_NAME]);

const eduapiForgeDeclaration = Object.freeze({
	standardKey: 'eduapi',
	standardSource: 'EduAPI', // equals parserDescriptor.ini standardName exactly (G-SOURCE)
	standardDisplayName: 'EduAPI 1.0 (EduAPI)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardFamily: STANDARD_FAMILY.EDUAPI,
	releaseLabel: 'EduAPI',
	descriptionSource: "each schema's and each property's OpenAPI 'description', carried verbatim (markdown backticks included): EduAPI publishes one for all 39 schemas and for 309 of 341 properties; the 32 properties that are a bare $ref carry none, because OpenAPI 3.0 allows no sibling of $ref. Option sets and their values publish no description.",
	nativeIdentifierPropertyName: null,
	standardUsageTips: "EduAPI 1.0 (1EdTech Edu-API) is an OpenAPI 3.0 data model for institutional data: people, organizations, academic sessions, course, component and collection templates and their offerings, enrollments, affiliations and learning objective sets. A DmeClass is a schema of components.schemas (39, including the three Imsx_* status-envelope schemas and eight empty <entity>Extensions extension points); a DmeProperty is one property of one schema, so 'sourcedId' or 'recordStatus' appears once per schema that has it (14 times each). A property whose value is another schema has a REFERENCES edge to that schema's class: referenceConstruct says how ($ref for a single value, items for an array of them) and locator is the exact JSON pointer. An enum is a DmeOptionSet owned by its property; 41 of the 62 are EXTENSIBLE (anyOf an enum and a pattern '(ext:)…', e.g. Enrollment.enrollmentStatus), and the property's compositionBranches says so. xClassPid is the 1EdTech persistent id of a schema; xSrcpropPid on a property is the persistent id of its VALUE TYPE (e.g. org.1edtech.eduapi.v1p0.primitive.string.class), not of the property. isRequired is the schema's required list.",
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: stableIdPatternFor(openapiProfile),
	rootStableIdFrom: 'declared',
	rootStableId: openapiProfile.rootStableId,
	rootLabel: 'EduapiRoot',
	parserVersion: '1',
	// EMPTY: the forge makes no mapping claim. Built from the framework contract's own ordered name list (the stringified object is a
	// block byte, so order matters), the pescld form. The values, by position: two anchor-name maps, crosswalkPrefix,
	// crosswalkResolveProperty.
	mappingInstruction: Object.freeze(MAPPING_INSTRUCTION_KEY_ORDER.reduce(
		(instruction, instructionPropertyName, propertyIndex) => ({ ...instruction, [instructionPropertyName]: EMPTY_MAPPING_INSTRUCTION_VALUE_LIST[propertyIndex] }),
		{},
	)),
	nonEmbeddableRoleList: Object.freeze([]),
	// the texts embedTextVote-v1 retrieval reads: a schema's and a property's name and description, an enum's name (the Ed-Fi form,
	// minus the option-set description EduAPI does not publish)
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'EduapiEmbedText',
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

module.exports = eduapiForgeDeclaration;
