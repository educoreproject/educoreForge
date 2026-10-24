'use strict';

// lifRoundTripPair.js — H4 for the LIF forge bundle (nextStandards-102326 C1): the shared OpenAPI kit pair for this bundle's sourceLayout
// (lib/openapi-forge/openapiLayout.js; openapiDereferencedRoundTripPair.js for dereferencedMultiFile) over its profile and stable-uri
// property name. Through the layout table, never a pair module by name (K1b).

const path = require('path');
const openapiProfile = require('./lifOpenapiProfile.json');
const forgeDeclaration = require('./lifForgeDeclaration');

module.exports = ({ ruleModulePath }) => require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiLayout')).roundTripPairFor({
	openapiProfile,
	stableUriPropertyName: forgeDeclaration.stableUriPropertyName,
	ruleModulePath,
});
