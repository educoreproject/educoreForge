'use strict';

// pescldForgeDeclaration.js — H1 for the PESC_LD forge bundle (zeroBacklog lane C1, 2026-10-22): DATA only.
//
// NAMING IS RULED (TQ 2026-10-20; WORKORDER-C): the standard is PESC_LD, "PESC_LD v0.0.2" is the JSON-LD College Transcript
// package, and on disk and in code it is standardKey pescld, standardSource PESCLD, family PESCLD, stableIds pescld:…, labels
// PescLd…. The distinct token keeps it out of the retired attic PESC forge's stableId space (pesc:, _source 'PESC').
//
// THE FORGE DOES NO BRIDGING (FBB-001). The CURIEs this standard borrows from other vocabularies are carried verbatim as each
// node's termCurie and termIri; nothing here names a hub, a card or a mapping, so mappingInstruction is empty.

const path = require('path');
const { DME_ROLES, STANDARD_KIND, STANDARD_FAMILY } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'forgeDeclarationContract'));

const STABLE_URI_PROPERTY_NAME = 'pescldStableId';
const ROOT_STABLE_ID = 'pescld:root';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = Object.freeze([Object.freeze([]), Object.freeze([]), Object.freeze([]), STABLE_URI_PROPERTY_NAME, false, Object.freeze([])]);
// a shape (pescld:shape/<shapeID>), a TAP row (pescld:shape/<shapeID>/<propertyID>), a picklist (pescld:picklist/<shapeID>/<propertyID>)
// and its values (…/<value>); a CURIE's local part and a bare literal value admit letters, digits, _ . -. The framework mints the
// embed-text nodes under the root (<root>/embedText/<sha256>, lib/forge-framework/embedTextDerivation.js).
const SHAPE_ID_PATTERN = '[A-Za-z][A-Za-z0-9]*';
const CURIE_PATTERN = '[A-Za-z][A-Za-z0-9]*:[A-Za-z0-9_.-]+';
const VALUE_PATTERN = '[A-Za-z0-9_.:-]+';

const pescldForgeDeclaration = Object.freeze({
	standardKey: 'pescld',
	standardSource: 'PESCLD', // equals parserDescriptor.ini standardName exactly (G-SOURCE)
	standardDisplayName: 'PESC College Transcript in JSON-LD (PESC_LD)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardFamily: STANDARD_FAMILY.PESCLD,
	releaseLabel: 'PESCLD',
	descriptionSource: "the package publishes labels only (TAP propertyLabel, shapes.csv label) and no definitions; a TAP row's 'note' column is carried as usageNote",
	standardUsageTips: "PESC_LD is a SHACL application profile, not a vocabulary: a DmeClass is a SHAPE (a node shape that targets a class) and a DmeProperty is one ROW of the profile (one property as constrained on one shape). Most rows borrow their term from another standard; the borrowed term is on the node as termCurie (as the source writes it, e.g. ceterms:name) and termIri (expanded from the package's own namespaces.csv). The same borrowed term can appear on several shapes, so search by termCurie returns one row per shape. Picklists are DmeOptionSet nodes owned by their row.",
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: Object.freeze({
		pattern: `^(${ROOT_STABLE_ID}(/embedText/[0-9a-f]{64})?|pescld:shape/${SHAPE_ID_PATTERN}(/${CURIE_PATTERN})?|pescld:picklist/${SHAPE_ID_PATTERN}/${CURIE_PATTERN}(/${VALUE_PATTERN})?)$`,
		trimmed: true,
	}),
	rootStableIdFrom: 'declared',
	rootStableId: ROOT_STABLE_ID,
	rootLabel: 'PescLdRoot',
	parserVersion: '1',
	// EMPTY: the forge makes no mapping claim. Built from the framework contract's own ordered name list (the stringified object
	// is a block byte, so order matters) because two of the six names still carry a hub's name (deferred re-key D1,
	// DEFERRED-rekey-102126.md) and a new bundle writes no hub literal (TQ 2026-10-21). The values, by position: two anchor-name
	// lists, crosswalkPrefix, crosswalkResolveProperty, includeInImplied, impliedTargets.
	mappingInstruction: Object.freeze(MAPPING_INSTRUCTION_KEY_ORDER.reduce(
		(instruction, instructionPropertyName, propertyIndex) => ({ ...instruction, [instructionPropertyName]: EMPTY_MAPPING_INSTRUCTION_VALUE_LIST[propertyIndex] }),
		{},
	)),
	nonEmbeddableRoleList: Object.freeze([]),
	// the package has labels and notes only: a shape's label, a row's label and note
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'PescLdEmbedText',
		textPropertyListByRole: Object.freeze({
			[DME_ROLES.CLASS]: Object.freeze(['name']),
			[DME_ROLES.PROPERTY]: Object.freeze(['name', 'usageNote']),
		}),
	}),
	hubAnchorAbsentSentinelList: Object.freeze([]),
	additionalSourceInputList: Object.freeze([]),
	// EMPTY, as the framework requires of a bundle outside MIGRATING_BUNDLE_LIST
	compatibilityDeclarationList: Object.freeze([]),
});

module.exports = pescldForgeDeclaration;
