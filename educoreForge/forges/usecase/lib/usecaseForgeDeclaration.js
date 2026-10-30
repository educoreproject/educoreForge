'use strict';

// usecaseForgeDeclaration.js — H1 for the use-case forge bundle (useCaseForge-102926 Phase 1, 2026-10-29): DATA only.
//
// NAMING IS RULED (SHADOW_MEADOW 2026-10-29, SPEC-useCaseForge-102926 §3.2): standardKey usecase, standardSource UseCase, family
// UseCase, kind useCaseCorpus, label stem Uc, root usecase:root. The standard is the EDUcore Enhanced Cockburn use cases, released by an
// EDUcore committee; release 1.0 is the root version (REVISION 1, R2), and each case carries the FORMAT version it is written to (R3).
//
// THE FORGE DOES NO BRIDGING (FBB-001). A citation of another standard is carried verbatim on a reference node (citedStandard,
// citedIdentifier, and the expansion the standard's OWN resolution registry gives); the declared bridge (bridges/usecaseBridging.js)
// draws the edge to the cited node. mappingInstruction is empty.

const path = require('path');
const { DME_ROLES, STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'forgeDeclarationContract'));

const STABLE_URI_PROPERTY_NAME = 'usecaseStableId';
const ROOT_STABLE_ID = 'usecase:root';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = Object.freeze([Object.freeze({}), Object.freeze({}), Object.freeze([]), STABLE_URI_PROPERTY_NAME]);
// the corpus's own identifiers: the ratified namespace enumeration (v011-schema.json $defs.namespacePrefix) plus uc: for cases, with
// the schema's own body; and the forge's minted forms (DESIGN-0-identityAndUri-102926.md §1)
const CORPUS_NAMESPACE_SOURCE = '(uc|subj|intermediate|us|cond|actor|event|orphan|vd|ip|artifact)';
const CORPUS_BODY_SOURCE = '[A-Za-z0-9][A-Za-z0-9-]*(:[A-Za-z0-9-]+)*';
const MINTED_SOURCE = 'usecase:(root|ref/[A-Za-z0-9-]+(/[A-Za-z0-9][A-Za-z0-9:._-]*)?|(story|condition|event|valueDriver|subject|resource|artifact|actor)/[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9.]+)';

const usecaseForgeDeclaration = Object.freeze({
	standardKey: 'usecase',
	standardSource: 'UseCase', // equals parserDescriptor.ini standardName exactly (G-SOURCE)
	standardDisplayName: 'EDUcore Enhanced Cockburn Use Cases (UseCase)',
	standardKind: STANDARD_KIND.USE_CASE_CORPUS,
	standardFamily: STANDARD_FAMILY.USECASE,
	releaseLabel: 'UseCase',
	descriptionSource: 'none carried as description: a use case has no single definition text; its own words ride as named properties (shortName, longName as name, a story\'s action as name with intention and benefit, a condition\'s statement as name)',
	// a case's published identifier is its corpus id, which IS the stable uri: nothing beyond it
	nativeIdentifierPropertyName: null,
	standardUsageTips: 'UseCase is a standard of USE CASES (format v0.11, Enhanced Cockburn), not a data standard. A DmeUseCase reaches its cast (HAS_ACTOR, HAS_INTERESTED_PARTY, HAS_PRIMARY_ACTOR), its steps (HAS_STEP to a shared DmeUserStory, carrying codedNotation, position and kind; INVOKES to a delegated case), its state (TRIGGERED_BY, ASSUMES, GUARANTEES), its motivation (ALIGNS_WITH) and its grounding (HAS_SUBJECT, REQUIRES*, GOVERNS). Stories, actors, conditions and the rest are SHARED nodes: one identifier, one node, reached from every case that uses it. A story\'s data is CONSUMES/PRODUCES to a reference node (label UcDataReference): an external element or whole standard (role DmeExternalReference, citedStandard + citedIdentifier, linked to the cited standard\'s own node by DECLARED_CORRESPONDENCE when the standard is in the graph), or the corpus\'s own orphan, intermediate or artifact (role DmeDataReference). An orphan is a confirmed standards gap.',
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: Object.freeze({
		pattern: `^(${CORPUS_NAMESPACE_SOURCE}:${CORPUS_BODY_SOURCE}|${MINTED_SOURCE})$`,
		trimmed: true,
	}),
	rootStableIdFrom: 'declared',
	rootStableId: ROOT_STABLE_ID,
	rootLabel: 'UcRoot',
	parserVersion: '1',
	// EMPTY: the forge makes no mapping claim (built from the framework contract's own ordered name list; the string is a block byte)
	mappingInstruction: Object.freeze(MAPPING_INSTRUCTION_KEY_ORDER.reduce(
		(instruction, instructionPropertyName, propertyIndex) => ({ ...instruction, [instructionPropertyName]: EMPTY_MAPPING_INSTRUCTION_VALUE_LIST[propertyIndex] }),
		{},
	)),
	// a cited element or whole standard is searched through the cited standard's own node, never through its reference (SPEC T4)
	nonEmbeddableRoleList: Object.freeze([DME_ROLES.EXTERNAL_REFERENCE]),
	// no text nodes: the use-case nodes are embedded through their searchText alone
	embedTextDeclaration: null,
	additionalSourceInputList: Object.freeze([]),
	// EMPTY, as the framework requires of a bundle outside MIGRATING_BUNDLE_LIST
	compatibilityDeclarationList: Object.freeze([]),
});

module.exports = usecaseForgeDeclaration;
