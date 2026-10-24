'use strict';

// lifForgeDeclaration.js — H1 for the LIF forge bundle (nextStandards-102326 lane C1, 2026-10-24): DATA only.
//
// NAMING (WORKORDER-lif-102326, decided within plan Q-N8's pattern): standardKey lif, standardSource LIF (the July _source, so the
// inventory oracle's name matches), family LIF, stableIds lif:…, labels Lif….
//
// THE FORGE DOES NO BRIDGING (FBB-001). LIF's own entities, properties and enum values are the forge's; nothing here names a hub, a
// card or a mapping, so mappingInstruction is empty. Six LIF descriptions cite a CEDS element URL: they are carried verbatim as text and
// read by nothing here. LIF's '...Ref<Entity>' property names (77) are NOT turned into REFERENCES edges: the source states no reference,
// and a link inferred from a name is ruled out like a title link (BRONZE_CROWN, C0 ruling 2). nativeIdentifierPropertyName is null:
// LIF publishes no identifier for its schema elements.

const path = require('path');
const { DME_ROLES, STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'forgeDeclarationContract'));
const { stableIdPatternFor } = require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiIdentity'));
const openapiProfile = require('./lifOpenapiProfile.json');

const STABLE_URI_PROPERTY_NAME = 'lifStableId';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = Object.freeze([Object.freeze({}), Object.freeze({}), Object.freeze([]), STABLE_URI_PROPERTY_NAME]);

const lifForgeDeclaration = Object.freeze({
	standardKey: 'lif',
	standardSource: 'LIF', // equals parserDescriptor.ini standardName exactly (G-SOURCE)
	standardDisplayName: 'LIF 2.0 (LIF)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardFamily: STANDARD_FAMILY.LIF,
	releaseLabel: 'LIF',
	descriptionSource: "each property's OpenAPI 'description', carried verbatim: LIF states one on 1,261 of its 1,393 properties, 179 of them the empty string (declared omitted, so 1,082 properties carry text); the 132 properties whose value is an object state none. LIF's entities and nested objects publish no description, and option sets and values none. LIF's use_recommendations (usage and bias guidance: 554 non-empty, 549 on properties and 5 on objects) is carried as useRecommendations and is NOT a description.",
	nativeIdentifierPropertyName: null,
	standardUsageTips: "LIF (the LIF Initiative's Learner Information Framework) 2.0 is an OpenAPI 3.0 data model of eight entities (Assessment, CompetencyFramework, Course, Credential, Organization, Person, Position, Program) whose objects nest INLINE, up to four deep, with no titles and no $ref. A DmeClass is an entity, or an inline object at a property (its stableId ends '/inline'; its name is derived '<Owner>.<property>.inline', since LIF names none); a DmeProperty is one property of one class, reached from it by HAS_PROPERTY, and an object-valued property has a REFERENCES edge (referenceConstruct inlineObject) to its inline class. LIF types its entities and many nested objects 'array' while giving them properties: read that as 'a list of these'. An enum is a DmeOptionSet owned by its property (23, e.g. Person.Demographics.tribalNationName with 577 members). Properties named '...Ref<Entity>' (e.g. awardedByRefOrganization, InstanceOfRefCredential) are LIF's by-name references: each holds the target's identifier fields; no edge links them to the entity they name. Every entity repeats an identifier envelope (identifier, informationSourceId, informationSourceOrganization, ...). useRecommendations is LIF's usage guidance; isRequired is the object's required list.",
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: stableIdPatternFor(openapiProfile),
	rootStableIdFrom: 'declared',
	rootStableId: openapiProfile.rootStableId,
	rootLabel: 'LifRoot',
	parserVersion: '1',
	// EMPTY: the forge makes no mapping claim. Built from the framework contract's own ordered name list (the stringified object is a
	// block byte, so order matters), the pescld / openbadges form. The values, by position: two anchor-name maps, crosswalkPrefix,
	// crosswalkResolveProperty.
	mappingInstruction: Object.freeze(MAPPING_INSTRUCTION_KEY_ORDER.reduce(
		(instruction, instructionPropertyName, propertyIndex) => ({ ...instruction, [instructionPropertyName]: EMPTY_MAPPING_INSTRUCTION_VALUE_LIST[propertyIndex] }),
		{},
	)),
	nonEmbeddableRoleList: Object.freeze([]),
	// the texts embedTextVote-v1 retrieval reads: a property's name and description, a class's and an enum's name (the Ed-Fi / Open Badges
	// form, minus the class description LIF does not publish: the framework refuses a declared text no node carries). useRecommendations
	// is guidance, not a definition, and is not embedded.
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'LifEmbedText',
		textPropertyListByRole: Object.freeze({
			[DME_ROLES.CLASS]: Object.freeze(['name']),
			[DME_ROLES.PROPERTY]: Object.freeze(['name', 'description']),
			[DME_ROLES.OPTION_SET]: Object.freeze(['name']),
		}),
	}),
	additionalSourceInputList: Object.freeze([Object.freeze({ inputName: 'sourceLocation', relativePathFromSourcePath: 'standardSourceLocation' })]),
	// EMPTY, as the framework requires of a bundle outside MIGRATING_BUNDLE_LIST
	compatibilityDeclarationList: Object.freeze([]),
});

module.exports = lifForgeDeclaration;
