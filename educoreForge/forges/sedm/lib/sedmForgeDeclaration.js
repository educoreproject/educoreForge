'use strict';

// sedmForgeDeclaration.js — H1 for the SEDM forge bundle (nextStandards-102326 wave 2, lane G, 2026-10-24): DATA only.
//
// NAMING (DESIGN-G0-sedm-102426.md §6; lane D's wave-2 vocabulary commit): standardKey sedm, standardSource SEDM (the July _source),
// family SEDM, stableIds sedm:…, labels Sedm….
//
// THE FORGE DOES NO BRIDGING (FBB-001). The working documents carry, per element, the identifier of the element it annotates in
// another standard; it is carried verbatim as source data (globalIdText) and resolved nowhere here, so mappingInstruction is empty.

const path = require('path');
const { DME_ROLES, STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'forgeDeclarationContract'));
const sedmIdentity = require('./sedmIdentity');

const STABLE_URI_PROPERTY_NAME = 'sedmStableId';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = Object.freeze([Object.freeze({}), Object.freeze({}), Object.freeze([]), STABLE_URI_PROPERTY_NAME]);

const sedmForgeDeclaration = Object.freeze({
	standardKey: 'sedm',
	standardSource: 'SEDM', // equals parserDescriptor.ini standardName exactly (G-SOURCE)
	standardDisplayName: 'SEDM (Special Education Data Model), working documents',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardFamily: STANDARD_FAMILY.SEDM,
	releaseLabel: 'SEDM',
	descriptionSource: "an element's 'Definition' column of the element map CSV (sheet 6 of the SEDM Logical Model and Maps), carried verbatim as description; a structure's own definition, description or note field of the domain structures JSON. An entity, an option set and an option value carry none: the documents state none.",
	// the working documents publish no SEDM identifier of their own beyond the names the stable uri is built from
	nativeIdentifierPropertyName: null,
	standardUsageTips: "SEDM is the Special Education Data Model, an IDEA-compliance model layered over another standard's elements, forged from its working group's WORKING DOCUMENTS (no published version). A DmeClass is an ENTITY of the element map sheet (K12 Student, LEA, Parent/Guardian ...); a DmeProperty is one ELEMENT of that sheet flagged SEDM (its SEDM column non-empty), identified by entity, category and name, with the sheet's definition as description; the identifier the sheet gives for the element it annotates is carried verbatim as globalIdText. The DmeSupport nodes are the SEDM structures extracted from the Conceptual Model: ontology classes, the 16 IDEA compliance categories, the IDEA indicators, the standard event milestones, the IEP components, the entity hierarchy, the use cases, and the Generate ETL templates (an element REFERENCES each template that uses it).",
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: sedmIdentity.STABLE_ID_PATTERN,
	rootStableIdFrom: 'declared',
	rootStableId: sedmIdentity.ROOT_STABLE_ID,
	rootLabel: 'SedmRoot',
	parserVersion: '1',
	// EMPTY: the forge makes no mapping claim (the pescld form: the framework contract's own ordered name list, by position)
	mappingInstruction: Object.freeze(MAPPING_INSTRUCTION_KEY_ORDER.reduce(
		(instruction, instructionPropertyName, propertyIndex) => ({ ...instruction, [instructionPropertyName]: EMPTY_MAPPING_INSTRUCTION_VALUE_LIST[propertyIndex] }),
		{},
	)),
	nonEmbeddableRoleList: Object.freeze([]),
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'SedmEmbedText',
		textPropertyListByRole: Object.freeze({
			[DME_ROLES.CLASS]: Object.freeze(['name']),
			[DME_ROLES.PROPERTY]: Object.freeze(['name', 'description']),
			[DME_ROLES.OPTION_SET]: Object.freeze(['name']),
			[DME_ROLES.SUPPORT]: Object.freeze(['name', 'description']),
		}),
	}),
	additionalSourceInputList: Object.freeze([]),
	// EMPTY, as the framework requires of a bundle outside MIGRATING_BUNDLE_LIST
	compatibilityDeclarationList: Object.freeze([]),
});

module.exports = sedmForgeDeclaration;
