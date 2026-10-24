'use strict';

// jedxRoundTripPair.js — H4 for the JEDx forge bundle (nextStandards-102326 B1): the OpenAPI kit's pair for this bundle's layout
// (lib/openapi-forge/openapiLayout.js roundTripPairFor: dereferencedMultiFile -> openapiDereferencedRoundTripPair.js), over this
// bundle's profile and stable-uri property name. The pair states each of the four bundles' components.schemas separately (kit K1 §2).

const path = require('path');
const openapiProfile = require('./jedxOpenapiProfile.json');
const forgeDeclaration = require('./jedxForgeDeclaration');
const { roundTripPairFor } = require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiLayout'));

module.exports = ({ ruleModulePath }) => roundTripPairFor({
	openapiProfile,
	stableUriPropertyName: forgeDeclaration.stableUriPropertyName,
	ruleModulePath,
});
