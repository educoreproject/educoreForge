'use strict';

// caseRoundTripPair.js — H4 for the CASE 1.1 forge bundle (nextStandards wave 2 lane E): the shared OpenAPI kit pair for this bundle's
// sourceLayout (lib/openapi-forge/openapiLayout.js; K0's openapiRoundTripPair.js for referencedSingleFile) over its profile and
// stable-uri property name. Through the layout table, never a pair module by name, so every OpenAPI bundle is wired the same way.

const path = require('path');
const openapiProfile = require('./caseOpenapiProfile.json');
const forgeDeclaration = require('./caseForgeDeclaration');

module.exports = ({ ruleModulePath }) => require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiLayout')).roundTripPairFor({
	openapiProfile,
	stableUriPropertyName: forgeDeclaration.stableUriPropertyName,
	ruleModulePath,
});
