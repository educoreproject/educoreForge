'use strict';

// onerosterrosteringRoundTripPair.js — H4 for the OneRoster 1.2 Rostering forge bundle (nextStandards-102326 wave 3 H1): the shared OpenAPI kit
// pair for this bundle's sourceLayout (lib/openapi-forge/openapiLayout.js; K0's openapiRoundTripPair.js for referencedSingleFile) over its
// profile and stable-uri property name. Through the layout table, never a pair module by name, so every OpenAPI bundle is wired the same way.

const path = require('path');
const openapiProfile = require('./onerosterrosteringOpenapiProfile.json');
const forgeDeclaration = require('./onerosterrosteringForgeDeclaration');

module.exports = ({ ruleModulePath }) => require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiLayout')).roundTripPairFor({
	openapiProfile,
	stableUriPropertyName: forgeDeclaration.stableUriPropertyName,
	ruleModulePath,
});
