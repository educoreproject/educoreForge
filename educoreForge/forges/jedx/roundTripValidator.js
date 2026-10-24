'use strict';

// roundTripValidator.js — the JEDx forge bundle's round-trip validator on the Forge Framework HARNESS (nextStandards-102326 B1;
// SPEC-forgeFramework-v1.md §6.6). The harness is required DIRECTLY here, never by the entry module or a hook (FR15). Exports the
// APPLIED stage: { validate, validateWithReader }. The pair canonicalises each bundle's components.schemas; the rest of each OpenAPI
// document is omitted by declaration (plan Q-N3).

const path = require('path');
const roundTripHarness = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const forgeDeclaration = require('./lib/jedxForgeDeclaration'); // the SAME declaration object as forgeJedx.js
const jedxRoundTripPair = require('./lib/jedxRoundTripPair')({ ruleModulePath: 'lib/openapi-forge/openapiDereferencedRoundTripPair.js' });

module.exports = roundTripHarness.validatorFrom({
	forgeDeclaration,
	...jedxRoundTripPair,
	verdictVersion: 'jedxRoundTripVerdict-1',
});
