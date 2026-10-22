'use strict';

// roundTripValidator.js — the PESC_LD forge bundle's round-trip validator on the Forge Framework HARNESS (zeroBacklog lane C1;
// SPEC-forgeFramework-v1.md §6.6). The harness is required DIRECTLY here, never by the entry module or a hook (FR15). Exports the
// APPLIED stage: { validate, validateWithReader }. The pair (lib/pescldRoundTripPair.js) canonicalises the CSV snapshot, the
// source (ruling Q-Z8); the publisher's TTL is the second oracle (lib/pescldTtlOracle.js), not read here.

const path = require('path');
const roundTripHarness = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const forgeDeclaration = require('./lib/pescldForgeDeclaration'); // the SAME declaration object as forgePescld.js
const pescldRoundTripPair = require('./lib/pescldRoundTripPair')({ ruleModulePath: 'forges/pescld/lib/pescldRoundTripPair.js' });

module.exports = roundTripHarness.validatorFrom({
	forgeDeclaration,
	...pescldRoundTripPair,
	verdictVersion: 'pescldRoundTripVerdict-1',
});
