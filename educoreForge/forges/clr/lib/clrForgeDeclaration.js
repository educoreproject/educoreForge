'use strict';

// clrForgeDeclaration.js — H1 for the CLR 2.0 forge bundle (nextStandards-102326 wave 2 lane D1, 2026-10-24): DATA only.
//
// NAMING (work order wave 2; DESIGN-D0-clr-102426.md): standardKey clr, standardSource CLR (the July _source, so the inventory oracle's
// name matches), family CLR, stableIds clr:…, labels Clr….
//
// THE FORGE DOES NO BRIDGING (FBB-001). CLR's own terms, $refs and enum values are the forge's; nothing here names a hub, a card or a
// mapping, so mappingInstruction is empty. 28 of CLR's schemas share a name with an Open Badges 3.0 schema; they are CLR's OWN copies
// (CLR's persistent-id namespace, CLR-local $refs) and are forged under clr: with no edge to Open Badges. The 1EdTech persistent ids
// (x-class-pid, x-srcprop-pid) are carried verbatim as data. nativeIdentifierPropertyName is null: x-class-pid is unique per schema, but
// x-srcprop-pid names a property's VALUE TYPE (184 uses, 44 distinct; measured 2026-10-24), so the standard publishes no identifier for its
// properties.

const path = require('path');
const { DME_ROLES, STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'forgeDeclarationContract'));
const { stableIdPatternFor } = require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiIdentity'));
const openapiProfile = require('./clrOpenapiProfile.json');

const STABLE_URI_PROPERTY_NAME = 'clrStableId';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = Object.freeze([Object.freeze({}), Object.freeze({}), Object.freeze([]), STABLE_URI_PROPERTY_NAME]);

const clrForgeDeclaration = Object.freeze({
	standardKey: 'clr',
	standardSource: 'CLR', // equals parserDescriptor.ini standardName exactly (G-SOURCE)
	standardDisplayName: 'CLR 2.0 (CLR)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardFamily: STANDARD_FAMILY.CLR,
	releaseLabel: 'CLR',
	descriptionSource: "each schema's and each property's OpenAPI 'description', carried verbatim (markdown backticks included): CLR publishes one for all 34 schemas and for 184 of 206 properties; the 22 properties that are a bare $ref carry none, because OpenAPI 3.0 allows no sibling of $ref. Option sets and their values publish no description.",
	nativeIdentifierPropertyName: null,
	standardUsageTips: "CLR 2.0 (Comprehensive Learner Record) is an OpenAPI 3.0 data model (JSON-LD aligned to the W3C Verifiable Credentials model) for a learner's whole record: a ClrCredential whose ClrSubject carries many verifiable credentials and the Associations between their Achievements. A DmeClass is a schema of components.schemas (34, including ten API-plumbing schemas such as Imsx_StatusInfo and OpenApiInfo); a DmeProperty is one property of one schema, so 'id' or 'type' appears once per schema that has it. 28 schemas (Achievement, Profile, Alignment, Evidence, ...) have the same names and shapes as Open Badges 3.0's: in this graph they are CLR's own copies, under clr:, related to Open Badges by no edge. A property whose value is another schema has a REFERENCES edge to that schema's class: referenceConstruct says how ($ref for a single value, items for an array of them, oneOf/anyOf/allOf for one branch of a choice) and locator is the exact JSON pointer. An enum is a DmeOptionSet owned by its property; five of the nine are EXTENSIBLE (anyOf an enum and a pattern '(ext:)…', e.g. achievementType), and the property's compositionBranches says so. xClassPid is the 1EdTech persistent id of a schema; xSrcpropPid on a property is the persistent id of its VALUE TYPE (e.g. org.1edtech.clr.v2p0.primitive.string.class), not of the property. isRequired is the schema's required list.",
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: stableIdPatternFor(openapiProfile),
	rootStableIdFrom: 'declared',
	rootStableId: openapiProfile.rootStableId,
	rootLabel: 'ClrRoot',
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
		embedTextLabel: 'ClrEmbedText',
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

module.exports = clrForgeDeclaration;
