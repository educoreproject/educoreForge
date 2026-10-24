'use strict';

// roundTripValidator.js — the LIF forge bundle's round-trip validator on the Forge Framework HARNESS (nextStandards-102326 C1;
// SPEC-forgeFramework-v1.md §6.6). The harness is required DIRECTLY here, never by the entry module or a hook (FR15). Exports the
// APPLIED stage: { validate, validateWithReader }. The pair canonicalises the snapshot's components.schemas; the rest of the OpenAPI
// document is omitted by declaration (plan Q-N3), and LIF's empty values and its one enum repeat by the profile's
// statementOmissionDeclaration.

const path = require('path');
const roundTripHarness = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const forgeDeclaration = require('./lib/lifForgeDeclaration'); // the SAME declaration object as forgeLif.js
const lifRoundTripPair = require('./lib/lifRoundTripPair')({ ruleModulePath: 'lib/openapi-forge/openapiDereferencedRoundTripPair.js' });

module.exports = roundTripHarness.validatorFrom({
	forgeDeclaration,
	...lifRoundTripPair,
	verdictVersion: 'lifRoundTripVerdict-1',
});
