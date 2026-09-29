'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripValidator.js — the sif260928 round-trip validator, a REFUSING STUB until phase A6.
//
// parserDescriptor.ini declares this file now. The round-trip stage requires a declared validator
// to exist, load and export validate, and refuses every build otherwise, stage on or off. This stub
// meets that. When it is actually run (a stage-on build), it refuses by name, so no build can
// report a verdict for this bundle before A6 builds the eight-column regeneration proof.

const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'refuse'));

const validate = ({ containerName, boltUrl, user, password, snapshotPath, outputPath } = {}, callback) => {
	callback(
		refuse.byName({
			moduleName,
			what: 'forge-sif260928 round-trip validator is not built yet',
			where: 'phase A6 builds the eight-column regeneration proof; until then no verdict exists for this bundle, so run no stage-on build with it',
		}).message,
	);
};

module.exports = { validate };
