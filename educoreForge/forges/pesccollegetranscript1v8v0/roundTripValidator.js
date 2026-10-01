'use strict';

// roundTripValidator.js — pesccollegetranscript1v8v0's round-trip validator, declared in parserDescriptor.ini.
// WRITTEN BY lib/pesc-release-forge/tools/scaffoldReleaseBundle.js. The validator itself is the shared
// library's (lib/pesc-release-forge/roundTripValidatorFor.js), a refusing stub until phase F4.

const path = require('path');
const { makeRoundTripValidator } = require(path.join(__dirname, '..', '..', 'lib', 'pesc-release-forge', 'roundTripValidatorFor'));
const forgeDeclaration = require('./lib/declaration'); // the SAME declaration object as the entry module

module.exports = makeRoundTripValidator({ forgeDeclaration });
