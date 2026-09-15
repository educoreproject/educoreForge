'use strict';

// toyForgeDeclaration.js — H1 for the Toy Standard fixture (SPEC-forgeFramework-v1.md §4). DATA,
// never code: what a forge author writes instead of the constants the four forges each carried.
// Required by BOTH the entry module (forgeToy.js) and the validator (roundTripValidator.js) so
// descriptor-shaped data is written once.
//
// The toy is a NEW forge (standardKey 'toy' is not in MIGRATING_BUNDLE_LIST), so its
// compatibilityDeclarationList is empty by construction — a new forge declares no allowance.

const path = require('path');
const { DME_ROLES } = require(path.join(__dirname, '..', '..', '..', '..', '..', 'vocabulary', 'vocabulary'));

const toyForgeDeclaration = Object.freeze({
	standardKey: 'toy',
	standardSource: 'Toy',
	standardDisplayName: 'Toy Standard',
	stableUriPropertyName: 'toyStableId',
	stableIdPattern: Object.freeze({ pattern: '^toy:[A-Za-z]+(/.+)?$', trimmed: true }),
	rootStableIdFrom: 'declared',
	rootStableId: 'toy:root',
	rootLabel: 'ToyRoot',
	parserVersion: '1',
	mappingInstruction: Object.freeze({
		cedsOriginalAnchorPropertyName: Object.freeze([]),
		cedsOptionOriginalAnchorPropertyName: Object.freeze([]),
		crosswalkPrefix: Object.freeze([]),
		crosswalkResolveProperty: 'toyStableId',
		includeInImplied: false,
		impliedTargets: Object.freeze([]),
	}),
	nonEmbeddableRoleList: Object.freeze([DME_ROLES.SUPPORT]),
	embedTextDeclaration: null,
	cedsAnchorAbsentSentinelList: Object.freeze([]),
	additionalSourceInputList: Object.freeze([]),
	compatibilityDeclarationList: Object.freeze([]),
});

// exported un-applied (a plain object, no factory): the declaration is data
module.exports = toyForgeDeclaration;
