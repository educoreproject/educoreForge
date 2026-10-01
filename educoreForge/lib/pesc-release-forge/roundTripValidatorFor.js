'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripValidatorFor.js — every PESC release bundle's round-trip validator, a REFUSING STUB until
// phase F4 (WORKORDER §3 F4) builds the round-trip pair.
//
//   makeRoundTripValidator({ forgeDeclaration }) → { validate }
//
// Each bundle's roundTripValidator.js is declared in its parserDescriptor.ini now, because the
// round-trip stage requires a declared validator to exist, load and export validate, and refuses
// every build otherwise, stage on or off. This stub meets that. When it is actually run (a stage-on
// build), it refuses by name, so no build reports a verdict for a release before F4 exists. F4
// replaces this module's body with the harness and the shared pair, and the bundles' three-line
// validator files need not change.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const makeRoundTripValidator = ({ forgeDeclaration }) => {
	const validate = (unusedValidateArgs, callback) => {
		callback(
			refuse.byName({
				moduleName,
				what: `the ${forgeDeclaration.standardKey} round-trip validator is not built yet`,
				where: 'phase F4 builds the round-trip pair; until then no verdict exists for a PESC release bundle, so run no stage-on build with it',
			}).message,
		);
	};
	return { validate };
};

module.exports = { makeRoundTripValidator, moduleName };
