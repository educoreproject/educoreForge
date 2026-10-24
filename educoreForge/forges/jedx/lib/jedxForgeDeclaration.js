'use strict';

// jedxForgeDeclaration.js — H1 for the JEDx forge bundle (nextStandards-102326 lane B1, 2026-10-24): DATA only.
//
// NAMING IS RULED (plan Q-N8, BRONZE_CROWN 2026-10-23): standardKey jedx, standardSource JEDx (the July _source, so the inventory
// oracle's name matches), family JEDx, stableIds jedx:…, labels Jedx….
//
// THE SOURCE OF RECORD is snapshot 02: the JEDx Open API Specification, four self-contained OpenAPI 3.1.0 bundles at
// HROpen/APISpecifications development@707ec7d (BRONZE_CROWN ruling 2026-10-23). Snapshot 01, the July CSV, is a record only.
//
// THE FORGE DOES NO BRIDGING (FBB-001). JEDx's own schemas, properties and code lists are the forge's; nothing here names a hub, a card
// or a mapping, so mappingInstruction is empty. nativeIdentifierPropertyName is null: HR Open publishes no identifier for a schema or
// a property beyond its name (a component's title is not one: some components carry another type's title, README_ERRATA E10).

const path = require('path');
const { DME_ROLES, STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'forgeDeclarationContract'));
const { stableIdPatternFor } = require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiIdentity'));
const openapiProfile = require('./jedxOpenapiProfile.json');

const STABLE_URI_PROPERTY_NAME = 'jedxStableId';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = Object.freeze([Object.freeze({}), Object.freeze({}), Object.freeze([]), STABLE_URI_PROPERTY_NAME]);

const jedxForgeDeclaration = Object.freeze({
	standardKey: 'jedx',
	standardSource: 'JEDx', // equals parserDescriptor.ini standardName exactly (G-SOURCE)
	standardDisplayName: 'Jobs and Employment Data Exchange (JEDx)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardFamily: STANDARD_FAMILY.JEDX,
	releaseLabel: 'JEDx',
	descriptionSource: "each schema's and each property's JSON Schema 'description', carried verbatim: JEDx publishes one for 180 of its 191 schemas and 631 of their 665 direct properties (measured 2026-10-23). A property's description is the text written at that property, which overrides the description of the HR Open type it inlines at 16,057 sites; the type's own description stays on the type. Code-list values publish no description; enumNames, where a code list has them, are carried per value.",
	nativeIdentifierPropertyName: null,
	standardUsageTips: "JEDx (the Jobs and Employment Data Exchange, from the U.S. Chamber of Commerce Foundation's T3 network) is published by HR Open as four OpenAPI bundles (organizations, workers, worker compensation reports, worker paid hours reports) built from HR Open 4.3/4.5 JSON schema types. The four share one model: a DmeClass is a schema (e.g. WorkerType, OrganizationType, JobType, WorkerCompensationReportNounType), present once however many bundles use it (bundleMembership lists them); a DmeProperty is one property of one schema. A property whose value is another schema has a REFERENCES edge to it (referenceConstruct inline, inlineItems for an array, allOf/anyOf for composition). An HR Open code list (CountryCodeList, CurrencyCodeList, PayTypeCodeList, ...) is a DmeOptionSet of the root; a property that narrows one has its own option set. Inline objects that are no schema of the model are classes of their own (stableId <Owner>/<property>/inline, name <Owner>.<property>.inline). Twelve schemas are API message envelopes (*-schema_v1, ConfirmMessageType, MetaType).",
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: stableIdPatternFor(openapiProfile),
	rootStableIdFrom: 'declared',
	rootStableId: openapiProfile.rootStableId,
	rootLabel: 'JedxRoot',
	parserVersion: '1',
	// EMPTY: the forge makes no mapping claim. Built from the framework contract's own ordered name list (the stringified object is a
	// block byte, so order matters), the pescld form. The values, by position: two anchor-name maps, crosswalkPrefix,
	// crosswalkResolveProperty.
	mappingInstruction: Object.freeze(MAPPING_INSTRUCTION_KEY_ORDER.reduce(
		(instruction, instructionPropertyName, propertyIndex) => ({ ...instruction, [instructionPropertyName]: EMPTY_MAPPING_INSTRUCTION_VALUE_LIST[propertyIndex] }),
		{},
	)),
	nonEmbeddableRoleList: Object.freeze([]),
	// the texts embedTextVote-v1 retrieval reads: a schema's and a property's name and description, a code list's name (the Open Badges
	// form; code-list values publish no description)
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'JedxEmbedText',
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

module.exports = jedxForgeDeclaration;
