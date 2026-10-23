'use strict';

// openbadgesHooks.js — the H2/H3 hook set for the Open Badges 3.0 forge bundle (nextStandards-102326 A1): the shared OpenAPI kit
// hooks (lib/openapi-forge/openapiHooks.js) over this bundle's own openapi profile.

const path = require('path');
const openapiProfile = require('./openbadgesOpenapiProfile.json');

module.exports = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'openapi-forge', 'openapiHooks'))({ openapiProfile });
