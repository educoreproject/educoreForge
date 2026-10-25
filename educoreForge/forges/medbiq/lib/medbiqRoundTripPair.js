'use strict';

// medbiqRoundTripPair.js — H4 for the MedBiquitous forge bundle (nextStandards wave 3 lane I): the shared XSD kit pair
// (lib/xsd-forge/xsdRoundTripPair.js) over this bundle's profile and stable-uri property name.

const path = require('path');
const xsdProfile = require('./medbiqXsdProfile.json');
const forgeDeclaration = require('./medbiqForgeDeclaration');

module.exports = ({ ruleModulePath }) => require(path.join(__dirname, '..', '..', '..', 'lib', 'xsd-forge', 'xsdRoundTripPair'))({
	xsdProfile,
	stableUriPropertyName: forgeDeclaration.stableUriPropertyName,
	ruleModulePath,
});
