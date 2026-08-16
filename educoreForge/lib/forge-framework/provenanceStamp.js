'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// provenanceStamp.js — provenance.deriveVersionStamp, a thin adapter over
// lib/snapshot-provenance deriveVersionStamp (SPEC-forgeFramework-v1.md §3.3; Profile §10.1).
// It supplies the REAL warn channel (xLog.error) so no author can pass a do-nothing one — the lib
// itself refuses a missing warn (`snapshot-provenance.js:66-82`) and this adapter refuses a missing
// xLog for the same reason: the §3.2/§3.3 warnings are mandated, not optional.
//
// callback(errString, { snapshotKey, publishedVersion, versionSource }). Called BY THE FRAMEWORK
// in forge() step 4; exported for tests. No try/catch here: the lib's only throw is the missing-warn
// refusal, which this adapter makes impossible; the framework's ONE try/catch is the pure-layer adapter.

const path = require('path');
const { deriveVersionStamp: libDeriveVersionStamp } = require(
	path.join(__dirname, '..', 'snapshot-provenance', 'snapshot-provenance'),
);
const refuse = require('./refuse');

const moduleFunction =
	({ moduleName } = {}) =>
	({ xLog } = {}) => {
		if (!xLog || typeof xLog.error !== 'function') {
			throw refuse.byName({
				moduleName,
				what: 'xLog with an error() channel is required',
				where: 'the version-provenance warnings are mandated by the binding spec and need a real channel',
			});
		}
		const deriveVersionStamp = ({ sourcePath, sourceVersion } = {}, callback) => {
			if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
				callback(
					refuse.byName({
						moduleName,
						what: `sourcePath is ${JSON.stringify(sourcePath)}`,
						where: 'deriveVersionStamp needs the sourcePath the forge was handed',
					}).message,
				);
				return;
			}
			if (sourceVersion !== null && sourceVersion !== undefined && typeof sourceVersion !== 'string') {
				callback(
					refuse.byName({
						moduleName,
						what: `sourceVersion is a ${typeof sourceVersion}`,
						where: 'sourceVersion is the self-described version string, or null when the source does not self-describe',
					}).message,
				);
				return;
			}
			// the lib's ONLY throw is a missing warn channel (snapshot-provenance.js:66-82), which this
			// adapter makes impossible by construction — so no boundary try is needed here; the
			// framework's ONE try/catch stays the pure-layer adapter in forge-framework.js
			const stamp = libDeriveVersionStamp({
				sourcePath,
				sourceVersion: sourceVersion === undefined ? null : sourceVersion,
				warn: (warnMessage) => xLog.error(warnMessage),
			});
			callback('', stamp);
		};
		return { deriveVersionStamp };
	};

module.exports = moduleFunction({ moduleName });
