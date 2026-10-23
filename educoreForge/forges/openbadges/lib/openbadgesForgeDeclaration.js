'use strict';

// openbadgesForgeDeclaration.js — H1 for the Open Badges 3.0 forge bundle (nextStandards-102326 lane A1, 2026-10-23): DATA only.
//
// NAMING IS RULED (plan Q-N8, BRONZE_CROWN 2026-10-23): standardKey openbadges, standardSource OpenBadges (the July _source, so the
// inventory oracle's name matches), family OpenBadges, stableIds openbadges:…, labels OpenBadges….
//
// THE FORGE DOES NO BRIDGING (FBB-001). Open Badges' own terms, $refs and enum values are the forge's; nothing here names a hub, a
// card or a mapping, so mappingInstruction is empty. The 1EdTech persistent ids (x-class-pid, x-srcprop-pid) are carried verbatim as
// data. nativeIdentifierPropertyName is null: x-class-pid is unique per schema, but x-srcprop-pid names a property's VALUE TYPE
// (179 uses, 42 distinct; measured 2026-10-23), so the standard publishes no identifier for its properties.

const path = require('path');
const { DME_ROLES, STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'forgeDeclarationContract'));
const { stableIdPatternFor } = require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiIdentity'));
const openapiProfile = require('./openbadgesOpenapiProfile.json');

const STABLE_URI_PROPERTY_NAME = 'openbadgesStableId';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = Object.freeze([Object.freeze({}), Object.freeze({}), Object.freeze([]), STABLE_URI_PROPERTY_NAME]);

const openbadgesForgeDeclaration = Object.freeze({
	standardKey: 'openbadges',
	standardSource: 'OpenBadges', // equals parserDescriptor.ini standardName exactly (G-SOURCE)
	standardDisplayName: 'Open Badges 3.0 (OpenBadges)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardFamily: STANDARD_FAMILY.OPENBADGES,
	releaseLabel: 'OpenBadges',
	descriptionSource: "each schema's and each property's OpenAPI 'description', carried verbatim (markdown backticks included): Open Badges publishes one for all 32 schemas and for 179 of 201 properties; the 22 properties that are a bare $ref carry none, because OpenAPI 3.0 allows no sibling of $ref. Option sets and their values publish no description.",
	nativeIdentifierPropertyName: null,
	standardUsageTips: "Open Badges 3.0 is an OpenAPI 3.0 data model (JSON-LD aligned to the W3C Verifiable Credentials model). A DmeClass is a schema of components.schemas (32, including ten API-plumbing schemas such as Imsx_StatusInfo and OpenApiInfo); a DmeProperty is one property of one schema, so 'id' or 'type' appears once per schema that has it. A property whose value is another schema has a REFERENCES edge to that schema's class: referenceConstruct says how ($ref for a single value, items for an array of them, oneOf/anyOf/allOf for one branch of a choice) and locator is the exact JSON pointer. An enum is a DmeOptionSet owned by its property; five of the nine are EXTENSIBLE (anyOf an enum and a pattern '(ext:)…', e.g. achievementType), and the property's compositionBranches says so. xClassPid is the 1EdTech persistent id of a schema; xSrcpropPid on a property is the persistent id of its VALUE TYPE (e.g. org.1edtech.ob.v3p0.primitive.string.class), not of the property. isRequired is the schema's required list.",
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: stableIdPatternFor(openapiProfile),
	rootStableIdFrom: 'declared',
	rootStableId: openapiProfile.rootStableId,
	rootLabel: 'OpenBadgesRoot',
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
	// minus the option-set description Open Badges does not publish)
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'OpenBadgesEmbedText',
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

module.exports = openbadgesForgeDeclaration;
