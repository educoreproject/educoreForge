'use strict';

// medbiqForgeDeclaration.js — H1 for the MedBiquitous forge bundle (nextStandards wave 3 lane I, 2026-10-25): DATA only.
//
// NAMING (DESIGN-I0-medbiq-102526.md §4, ruled by BRONZE_CROWN): standardKey medbiq, standardSource MedBiquitous (the July _source, so the
// inventory oracle's name matches), family MEDBIQ, stableIds medbiq:…, labels Medbiq….
//
// THE FORGE DOES NO BRIDGING (FBB-001). MedBiquitous's own types, fields, enumerations and references are the forge's; the PESC types
// Educational Achievement imports are carried as written and never resolved; nothing here names a hub, a card or a mapping, so
// mappingInstruction is empty. nativeIdentifierPropertyName is null: the schemas publish no identifier for their declarations.

const path = require('path');
const { DME_ROLES, STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'forgeDeclarationContract'));
const { stableIdPatternFor } = require(path.join(__dirname, '..', '..', '..', 'lib', 'xsd-forge', 'xsdIdentity'));
const xsdProfile = require('./medbiqXsdProfile.json');

const STABLE_URI_PROPERTY_NAME = 'medbiqStableId';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = Object.freeze([Object.freeze({}), Object.freeze({}), Object.freeze([]), STABLE_URI_PROPERTY_NAME]);

const medbiqForgeDeclaration = Object.freeze({
	standardKey: 'medbiq',
	standardSource: 'MedBiquitous', // equals parserDescriptor.ini standardName exactly (G-SOURCE)
	standardDisplayName: 'MedBiquitous (AAMC health professions education standards)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardFamily: STANDARD_FAMILY.MEDBIQ,
	releaseLabel: 'MedBiquitous',
	descriptionSource: "each node's OWN xs:documentation, carried verbatim from the publisher's XSD: the schemas document few of their definitions (34 complex types, one simple type and one global element of the forged set) and none of their fields, so a field has no description; MedBiquitous defines its terms in PDF specifications the forge does not read. Nothing is borrowed from a type or a reference.",
	nativeIdentifierPropertyName: null,
	standardUsageTips: "MedBiquitous is the AAMC's portfolio of XML Schema standards for health professions education: Activity Report (continuing education), Curriculum Inventory, Competency Framework and Competency Object, Educational Achievement, Educational Trajectory, Entrustment Scale, Financial Interest (disclosure), Healthcare LOM (learning-object metadata), Journal, Medical Education Metrics, Performance Framework, Professional Profile (member), Survey Items and Virtual Patient. They are ONE standard here: each forged file says which sub-standards (schemaSetNameList) reach it, and each definition of the shared libraries (common, address, name, member, Healthcare LOM) is one node, whichever sub-standard imports it. A DmeClass is an XSD complexType (named, or the anonymous type of one element); a DmeProperty is one element or attribute it declares, or an element ref= (named for what it references); a DmeOptionSet is a simpleType of enumerations and a DmeOptionValue one enumeration; a DmeSupport is a schema file, a global element, a group, an attribute group or another simpleType. Every QName the schema writes is carried as written (typeQName, refQName) and, when it names a forged definition, is an edge: REFERENCES_TYPE or HAS_OPTION_SET to the type, REFERENCES to a global element, group or attribute group, SUBCLASS_OF to an extension or restriction base. The IEEE LOM binding (namespace ltsc.ieee.org/xsd/LOM) is IEEE's, carried as MedBiquitous ships it inside Healthcare LOM. Compositors, facets, wildcards, identity constraints, annotations and the publisher's comments (copyright notices included) ride verbatim on xsdStructureList. Ids name the namespace, not the file: medbiq:type/ns.medbiq.org/curriculuminventory/v2#SequenceBlockType.",
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: stableIdPatternFor(xsdProfile),
	rootStableIdFrom: 'declared',
	rootStableId: xsdProfile.rootStableId,
	rootLabel: 'MedbiqRoot',
	parserVersion: '1',
	// EMPTY: the forge makes no mapping claim. Built from the framework contract's own ordered name list (the stringified object is a
	// block byte, so order matters), the pescld form. The values, by position: two anchor-name maps, crosswalkPrefix,
	// crosswalkResolveProperty.
	mappingInstruction: Object.freeze(MAPPING_INSTRUCTION_KEY_ORDER.reduce(
		(instruction, instructionPropertyName, propertyIndex) => ({ ...instruction, [instructionPropertyName]: EMPTY_MAPPING_INSTRUCTION_VALUE_LIST[propertyIndex] }),
		{},
	)),
	nonEmbeddableRoleList: Object.freeze([]),
	// the texts embedTextVote-v1 retrieval reads (Phase 0 ruling 5): a field has no description, so its contextText (the kit's
	// '<owning type>.<field>', equal to its path) is embedded beside its name; a type's and an option set's name and description
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'MedbiqEmbedText',
		textPropertyListByRole: Object.freeze({
			[DME_ROLES.CLASS]: Object.freeze(['name', 'description']),
			[DME_ROLES.PROPERTY]: Object.freeze(['name', 'contextText']),
			[DME_ROLES.OPTION_SET]: Object.freeze(['name', 'description']),
		}),
	}),
	additionalSourceInputList: Object.freeze([Object.freeze({ inputName: 'sourceLocation', relativePathFromSourcePath: 'standardSourceLocation' })]),
	// EMPTY, as the framework requires of a bundle outside MIGRATING_BUNDLE_LIST
	compatibilityDeclarationList: Object.freeze([]),
});

module.exports = medbiqForgeDeclaration;
