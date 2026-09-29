'use strict';

// sif260928ForgeDeclaration.js — H1 for the sif260928 forge bundle: the framework's declared
// shape, as data (SPEC-forgeFramework-v1.md §4). Written in phase A1a of the SIF replacement
// (PLAN-sifReplacement-smallPhases-092826.md §3 A1a; SPEC-sifStructuralBridge-replacement.md §9).
//
// THE FORGE DOES NO BRIDGING (imperative FBB-001; SPEC §9 A20). Nothing here names a CEDS domain,
// card or mapping. SIF's own 'CEDS ID' column is carried as a plain SIF property by the walk and
// is never declared as an anchor, which is why mappingInstruction is empty (supervisor ruling,
// A1a).

const path = require('path');
const { DME_ROLES } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { REF_ID_MAP_INPUT_NAME } = require('./sif260928RefIdMapLoader');

// every node's own address, and mappingInstruction.crosswalkResolveProperty: written once, read twice
const STABLE_URI_PROPERTY_NAME = 'sif260928StableId';

const sif260928ForgeDeclaration = Object.freeze({
	standardKey: 'sif260928', // equals the bundle directory; build.js resolves bundles by it
	standardSource: 'SIF260928', // equals parserDescriptor.ini standardName exactly (G-SOURCE)
	standardDisplayName: 'SIF Implementation Specification (sif260928 rebuild)',
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	// sif260928:<kind> or sif260928:<kind>/<rest>. trimmed is true because '(/.+)' admits
	// whitespace, so the pattern alone would not forbid a leading or trailing space.
	stableIdPattern: Object.freeze({ pattern: '^sif260928:[A-Za-z]+(/.+)?$', trimmed: true }),
	rootStableIdFrom: 'declared',
	rootStableId: 'sif260928:root',
	rootLabel: 'Sif260928Root',
	parserVersion: '1',
	// EMPTY: this forge makes no mapping claim (ruled, A1a). The incumbent declares 'CEDS ID' as an
	// anchor with impliedTargets ['CEDS']; that is an instruction to downstream mapping machinery,
	// and that column is also the yardstick the bridge must never see. Six keys in the framework's
	// order: the stringified object is a block byte.
	mappingInstruction: Object.freeze({
		cedsOriginalAnchorPropertyName: Object.freeze([]),
		cedsOptionOriginalAnchorPropertyName: Object.freeze([]),
		crosswalkPrefix: Object.freeze([]),
		crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
		includeInImplied: false,
		impliedTargets: Object.freeze([]),
	}),
	// RULED (EBONY_DREAM, review #9): Field and Container (DmeSupport) and the codesets
	// (DmeOptionSet, DmeOptionValue) get no node vector. Only Objects (159) and Questions (5,018 by
	// C1's measurement, SPEC §9 A21) do. The roles themselves live in sif260928NodeKindTable.js.
	nonEmbeddableRoleList: Object.freeze([DME_ROLES.SUPPORT, DME_ROLES.OPTION_SET, DME_ROLES.OPTION_VALUE]),
	// the search texts (phase A5; SPEC §9 A1): a Question's name, description and contextText, an
	// Object's name. No other role carries one. The framework mints one text node per distinct trimmed
	// string; an absent description is counted as absent, never minted.
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'Sif260928EmbedText',
		textPropertyListByRole: Object.freeze({
			[DME_ROLES.PROPERTY]: Object.freeze(['name', 'description', 'contextText']),
			[DME_ROLES.CLASS]: Object.freeze(['name']),
		}),
	}),
	cedsAnchorAbsentSentinelList: Object.freeze([]),
	// the RefId map only (phase A4; SPEC §9 A24). The framework verifies it against SHA256SUMS like
	// the TSV and hands its path to the map loader under this inputName. The object-domain file is a
	// BRIDGE input and never a forge input (SPEC §9 A20).
	additionalSourceInputList: Object.freeze([Object.freeze({ inputName: REF_ID_MAP_INPUT_NAME, relativePathFromSourcePath: 'refIdResolutionMap.tsv' })]),
	// EMPTY, as the framework requires of any standardKey outside MIGRATING_BUNDLE_LIST. The old
	// forges' migration allowances stay in the framework, and this bundle uses none of them (TQ).
	compatibilityDeclarationList: Object.freeze([]),
});

module.exports = sif260928ForgeDeclaration;
