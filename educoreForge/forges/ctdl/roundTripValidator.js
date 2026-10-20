'use strict';

// roundTripValidator.js — the CTDL forge bundle's round-trip validator on the Forge Framework HARNESS
// (SPEC-forgeFramework-v1.md §6.6; ctdlHub-101926 P1). The harness is required DIRECTLY here, never by the entry
// module or a hook (FR15). Exports the APPLIED stage: { validate, validateWithReader }.

const path = require('path');
const roundTripHarness = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const forgeDeclaration = require('./lib/ctdlForgeDeclaration'); // the SAME declaration object as forgeCtdl.js
const vocabularyProfile = require('./lib/ctdlVocabularyProfile.json');
const ctdlRoundTripPair = require(path.join(__dirname, '..', '..', 'lib', 'ctdl-family-forge', 'jsonLdRoundTripPair'))({ vocabularyProfile, ruleModulePath: 'lib/ctdl-family-forge/jsonLdRoundTripPair.js' });

module.exports = roundTripHarness.validatorFrom({
	forgeDeclaration,
	...ctdlRoundTripPair,
	verdictVersion: 'ctdlRoundTripVerdict-1',
});
