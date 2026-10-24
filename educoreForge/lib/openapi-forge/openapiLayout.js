'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiLayout.js — which walk and which round-trip pair read a profile's sourceLayout (nextStandards-102326 K1). A table, so adding a
// layout is a row and its modules, never a branch in the hooks or a bundle. A layout the table does not name is refused by the profile
// contract before it reaches here.

const LAYOUT_MODULE_BY_LAYOUT = Object.freeze({
	referencedSingleFile: Object.freeze({ walkModuleName: './openapiWalk', roundTripPairModuleName: './openapiRoundTripPair' }),
	dereferencedMultiFile: Object.freeze({ walkModuleName: './openapiDereferencedWalk', roundTripPairModuleName: './openapiDereferencedRoundTripPair' }),
});

// walkFor — the H3 walk for a profile's layout
const walkFor = ({ openapiProfile }) => require(LAYOUT_MODULE_BY_LAYOUT[openapiProfile.sourceLayout].walkModuleName)({ openapiProfile });

// roundTripPairFor — the H4 pair for a profile's layout: { canonicalizeSource, emitFromGraph, semanticValidationLimit, omissionDeclaration }
const roundTripPairFor = ({ openapiProfile, stableUriPropertyName, ruleModulePath }) => require(LAYOUT_MODULE_BY_LAYOUT[openapiProfile.sourceLayout].roundTripPairModuleName)({ openapiProfile, stableUriPropertyName, ruleModulePath });

module.exports = { walkFor, roundTripPairFor, LAYOUT_MODULE_BY_LAYOUT, moduleName };
