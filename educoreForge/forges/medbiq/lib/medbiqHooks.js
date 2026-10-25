'use strict';

// medbiqHooks.js — the H2/H3 hook set for the MedBiquitous forge bundle (nextStandards wave 3 lane I): the shared XSD kit hooks
// (lib/xsd-forge/xsdHooks.js) over this bundle's own xsd profile.

const path = require('path');
const xsdProfile = require('./medbiqXsdProfile.json');

module.exports = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'xsd-forge', 'xsdHooks'))({ xsdProfile });
