'use strict';

// roundTripValidator.js — the EduAPI 1.0 forge bundle's round-trip validator on the Forge Framework HARNESS (nextStandards wave 2
// lane F; SPEC-forgeFramework-v1.md §6.6). The harness is required DIRECTLY here, never by the entry module or a hook (FR15). Exports the
// APPLIED stage: { validate, validateWithReader }. The pair canonicalises the snapshot's components.schemas; the rest of the
// OpenAPI document is omitted by declaration (plan Q-N3).

const path = require('path');
const roundTripHarness = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const forgeDeclaration = require('./lib/eduapiForgeDeclaration'); // the SAME declaration object as forgeEduapi.js
const eduapiRoundTripPair = require('./lib/eduapiRoundTripPair')({ ruleModulePath: 'lib/openapi-forge/openapiRoundTripPair.js' });

module.exports = roundTripHarness.validatorFrom({
	forgeDeclaration,
	...eduapiRoundTripPair,
	verdictVersion: 'eduapiRoundTripVerdict-1',
});
