'use strict';

// eduapiHooks.js — the H2/H3 hook set for the EduAPI 1.0 forge bundle (nextStandards wave 2 lane F): the shared OpenAPI kit
// hooks (lib/openapi-forge/openapiHooks.js) over this bundle's own openapi profile.

const path = require('path');
const openapiProfile = require('./eduapiOpenapiProfile.json');

module.exports = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiHooks'))({ openapiProfile });
