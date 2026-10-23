'use strict';

// openbadgesRoundTripPair.js — H4 for the Open Badges 3.0 forge bundle (nextStandards-102326 A1): the shared OpenAPI kit pair
// (lib/openapi-forge/openapiRoundTripPair.js) over this bundle's profile and stable-uri property name.

const path = require('path');
const openapiProfile = require('./openbadgesOpenapiProfile.json');
const forgeDeclaration = require('./openbadgesForgeDeclaration');

module.exports = ({ ruleModulePath }) => require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiRoundTripPair'))({
	openapiProfile,
	stableUriPropertyName: forgeDeclaration.stableUriPropertyName,
	ruleModulePath,
});
