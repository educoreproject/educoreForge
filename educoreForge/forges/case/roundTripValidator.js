'use strict';

// roundTripValidator.js — the CASE 1.1 forge bundle's round-trip validator on the Forge Framework HARNESS (nextStandards wave 2 lane E;
// SPEC-forgeFramework-v1.md §6.6). The harness is required DIRECTLY here, never by the entry module or a hook (FR15). Exports the
// APPLIED stage: { validate, validateWithReader }. The pair canonicalises the snapshot's components.schemas; the rest of the
// OpenAPI document is omitted by declaration (plan Q-N3), and the two YAML-typed caseVersion members by the profile (declaredMemberText).

const path = require('path');
const roundTripHarness = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const forgeDeclaration = require('./lib/caseForgeDeclaration'); // the SAME declaration object as forgeCase.js
const caseRoundTripPair = require('./lib/caseRoundTripPair')({ ruleModulePath: 'lib/openapi-forge/openapiRoundTripPair.js' });

module.exports = roundTripHarness.validatorFrom({
	forgeDeclaration,
	...caseRoundTripPair,
	verdictVersion: 'caseRoundTripVerdict-1',
});
