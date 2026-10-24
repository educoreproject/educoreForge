'use strict';

// roundTripValidator.js — the SEDM forge bundle's round-trip validator on the Forge Framework HARNESS (nextStandards-102326 wave 2,
// lane G; SPEC-forgeFramework-v1.md §6.6). The harness is required DIRECTLY here, never by the entry module or a hook (FR15). Exports
// the APPLIED stage: { validate, validateWithReader }. The pair (lib/sedmRoundTripPair.js) canonicalises snapshot 01, the source.

const path = require('path');
const roundTripHarness = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const forgeDeclaration = require('./lib/sedmForgeDeclaration'); // the SAME declaration object as forgeSedm.js
const sedmRoundTripPair = require('./lib/sedmRoundTripPair')({ ruleModulePath: 'forges/sedm/lib/sedmRoundTripPair.js' });

module.exports = roundTripHarness.validatorFrom({
	forgeDeclaration,
	...sedmRoundTripPair,
	verdictVersion: 'sedmRoundTripVerdict-1',
});
