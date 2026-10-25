'use strict';

// roundTripValidator.js — the OneRoster 1.2 Resources forge bundle's round-trip validator on the Forge Framework HARNESS
// (nextStandards-102326 wave 3 H1; SPEC-forgeFramework-v1.md §6.6). The harness is required DIRECTLY here, never by the entry module or a hook
// (FR15). Exports the APPLIED stage: { validate, validateWithReader }. The pair canonicalises the snapshot's components.schemas; the rest of
// the OpenAPI document is omitted by declaration (plan Q-N3).

const path = require('path');
const roundTripHarness = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const forgeDeclaration = require('./lib/onerosterresourcesForgeDeclaration'); // the SAME declaration object as forgeOnerosterResources.js
const onerosterresourcesRoundTripPair = require('./lib/onerosterresourcesRoundTripPair')({ ruleModulePath: 'lib/openapi-forge/openapiRoundTripPair.js' });

module.exports = roundTripHarness.validatorFrom({
	forgeDeclaration,
	...onerosterresourcesRoundTripPair,
	verdictVersion: 'onerosterresourcesRoundTripVerdict-1',
});
