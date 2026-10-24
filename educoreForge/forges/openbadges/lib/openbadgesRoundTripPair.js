'use strict';

// openbadgesRoundTripPair.js — H4 for the Open Badges 3.0 forge bundle (nextStandards-102326 A1): the shared OpenAPI kit pair for this
// bundle's sourceLayout (lib/openapi-forge/openapiLayout.js; K0's openapiRoundTripPair.js for referencedSingleFile) over its profile and
// stable-uri property name. Through the layout table, never a pair module by name, so every OpenAPI bundle is wired the same way.

const path = require('path');
const openapiProfile = require('./openbadgesOpenapiProfile.json');
const forgeDeclaration = require('./openbadgesForgeDeclaration');

module.exports = ({ ruleModulePath }) => require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiLayout')).roundTripPairFor({
	openapiProfile,
	stableUriPropertyName: forgeDeclaration.stableUriPropertyName,
	ruleModulePath,
});
