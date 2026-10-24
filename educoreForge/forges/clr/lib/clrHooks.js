'use strict';

// clrHooks.js — the H2/H3 hook set for the CLR 2.0 forge bundle (nextStandards-102326 wave 2 D1): the shared OpenAPI kit
// hooks (lib/openapi-forge/openapiHooks.js) over this bundle's own openapi profile.

const path = require('path');
const openapiProfile = require('./clrOpenapiProfile.json');

module.exports = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiHooks'))({ openapiProfile });
