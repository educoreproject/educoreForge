'use strict';

// roundTripValidator.js — the sif260928 round-trip validator (phase A6): the graph regenerates the
// SIF spreadsheet byte for byte. It is built on the forge framework's round-trip harness, in the
// toyForge validator's shape, and exports the applied stage { validate, validateWithReader }. The
// harness is required directly here, never by the entry module or a hook (FR15).
//
// The two sides of the proof and its diff live in lib/sif260928RoundTripPair.js, which states what
// the proof models and what it does not (its semanticValidationLimit). The answer key is
// parserDescriptor.ini's sourceFile inside the pinned snapshot, and intake verifies it against
// SHA256SUMS before either side runs.

const path = require('path');
const roundTripHarness = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const rosterLib = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'roster'));
const forgeDeclaration = require('./lib/sif260928ForgeDeclaration'); // the SAME declaration object as forgeSif260928.js

const { sourceFile } = rosterLib.readDescriptorSection(path.join(__dirname, rosterLib.DESCRIPTOR_FILE_NAME)).valueByName;
const roundTripPair = require('./lib/sif260928RoundTripPair')({ sourceFileName: sourceFile });

module.exports = roundTripHarness.validatorFrom({
	forgeDeclaration,
	...roundTripPair,
	verdictVersion: 'sif260928RoundTripVerdict-1',
});
