'use strict';

// jedxHooks.js — the H2/H3 hook set for the JEDx forge bundle (nextStandards-102326 B1): the shared OpenAPI kit hooks
// (lib/openapi-forge/openapiHooks.js) over this bundle's own openapi profile (layout dereferencedMultiFile, kit K1).

const path = require('path');
const openapiProfile = require('./jedxOpenapiProfile.json');

module.exports = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiHooks'))({ openapiProfile });
