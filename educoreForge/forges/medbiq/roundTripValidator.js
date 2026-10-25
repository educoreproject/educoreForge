'use strict';

// roundTripValidator.js — the MedBiquitous forge bundle's round-trip validator on the Forge Framework HARNESS (nextStandards wave 3 lane I;
// SPEC-forgeFramework-v1.md §6.6). The harness is required DIRECTLY here, never by the entry module or a hook (FR15). Exports the APPLIED
// stage: { validate, validateWithReader }. The pair reads every forged XSD file through the kit's tree reader; the profile's excluded files
// are omitted by declaration.

const path = require('path');
const roundTripHarness = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const forgeDeclaration = require('./lib/medbiqForgeDeclaration'); // the SAME declaration object as forgeMedbiq.js
const medbiqRoundTripPair = require('./lib/medbiqRoundTripPair')({ ruleModulePath: 'lib/xsd-forge/xsdRoundTripPair.js' });

module.exports = roundTripHarness.validatorFrom({
	forgeDeclaration,
	...medbiqRoundTripPair,
	verdictVersion: 'medbiqRoundTripVerdict-1',
});
