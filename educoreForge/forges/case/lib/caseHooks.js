'use strict';

// caseHooks.js — the H2/H3 hook set for the CASE 1.1 forge bundle (nextStandards wave 2 lane E): the shared OpenAPI kit hooks
// (lib/openapi-forge/openapiHooks.js) over this bundle's own openapi profile.

const path = require('path');
const openapiProfile = require('./caseOpenapiProfile.json');

module.exports = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiHooks'))({ openapiProfile });
