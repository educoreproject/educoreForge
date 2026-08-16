'use strict';
// roundTripValidator.js — the Toy Standard's round-trip validator on the Forge Framework HARNESS
// (SPEC-forgeFramework-v1.md §6.6). The harness is required DIRECTLY here — never by the entry module
// or a hook (FR15). Exports the APPLIED stage (Profile §8.1 SHOULD): { validate, validateWithReader }.
const path = require('path');
const roundTripHarness = require(path.join(__dirname, '..', '..', '..', 'roundTripHarness', 'roundTripHarness'))();
const forgeDeclaration = require('./lib/toyForgeDeclaration'); // the SAME declaration object as forgeToy.js
const toyRoundTripPair = require('./lib/toyRoundTripPair')();

module.exports = roundTripHarness.validatorFrom({
	forgeDeclaration,
	...toyRoundTripPair,
	verdictVersion: 'toyRoundTripVerdict-1',
});
