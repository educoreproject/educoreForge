'use strict';

// roundTripValidator.js — the use-case forge bundle's round-trip validator on the Forge Framework HARNESS (useCaseForge-102926 Phase 1;
// SPEC-forgeFramework-v1.md §6.6). The harness is required DIRECTLY here, never by the entry module or a hook (FR15). Exports the APPLIED
// stage: { validate, validateWithReader }. The pair (lib/usecaseRoundTripPair.js) rebuilds every case document from the graph.

const path = require('path');
const roundTripHarness = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const forgeDeclaration = require('./lib/usecaseForgeDeclaration'); // the SAME declaration object as forgeUsecase.js
const usecaseRoundTripPair = require('./lib/usecaseRoundTripPair')({ ruleModulePath: 'forges/usecase/lib/usecaseRoundTripPair.js' });

module.exports = roundTripHarness.validatorFrom({
	forgeDeclaration,
	...usecaseRoundTripPair,
	verdictVersion: 'usecaseRoundTripVerdict-1',
});
