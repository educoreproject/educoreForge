'use strict';

// lifHooks.js — the H2/H3 hook set for the LIF forge bundle (nextStandards-102326 C1): the shared OpenAPI kit hooks
// (lib/openapi-forge/openapiHooks.js) over this bundle's own openapi profile.

const path = require('path');
const openapiProfile = require('./lifOpenapiProfile.json');

module.exports = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiHooks'))({ openapiProfile });
