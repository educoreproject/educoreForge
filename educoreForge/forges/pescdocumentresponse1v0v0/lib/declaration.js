'use strict';

// declaration.js — pescdocumentresponse1v0v0's forge declaration, built by the shared library from
// releaseDeclaration.json beside this file. WRITTEN BY lib/pesc-release-forge/tools/scaffoldReleaseBundle.js.
// The entry module and roundTripValidator.js both require this file, so both hold the SAME object.

const path = require('path');
const releaseBundle = require(path.join(__dirname, '..', '..', '..', 'lib', 'pesc-release-forge', 'releaseBundle'));

module.exports = releaseBundle.readForgeDeclaration({ bundleDirPath: path.join(__dirname, '..') });
