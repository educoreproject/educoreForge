'use strict';

// onerosterrosteringHooks.js — the H2/H3 hook set for the OneRoster 1.2 Rostering forge bundle (nextStandards-102326 wave 3 H1): the shared
// OpenAPI kit hooks (lib/openapi-forge/openapiHooks.js) over this bundle's own openapi profile.

const path = require('path');
const openapiProfile = require('./onerosterrosteringOpenapiProfile.json');

module.exports = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiHooks'))({ openapiProfile });
