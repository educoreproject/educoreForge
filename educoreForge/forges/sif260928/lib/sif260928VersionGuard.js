'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sif260928VersionGuard.js — refuses to forge SIF without a known version (SPEC §9 A5).
//
// The framework only WARNS when no version can be found: deriveVersionStamp stamps
// versionSource 'unknown' and the build carries on, with 'unknown' in the block subject. This
// forge refuses instead. The SIF TSV declares no version of its own, so the version always comes
// from the snapshot's standardSourceLocation file ('publishedVersion: 4.3'). If that line is
// deleted, or starts with 'unknown', the stamp resolves to 'unknown' and this guard throws.
//
// It runs inside the framework's pure layer (called from describeRoot, the first hook to see the
// stamped metadata), so its throw reaches the forge callback through the framework's one adapter.

const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));

// the versionSource values that mean no version was found
const REFUSED_VERSION_SOURCE_LIST = Object.freeze(['unknown']);

const assertKnownVersion = ({ metadata }) => {
	if (REFUSED_VERSION_SOURCE_LIST.indexOf(metadata.versionSource) !== -1) {
		throw refuse.byName({
			moduleName,
			what: `forge-sif260928 version guard: versionSource is '${metadata.versionSource}' (publishedVersion '${metadata.publishedVersion}', snapshot '${metadata.snapshotKey}')`,
			where: "the sif260928 forge never builds an unknown version; put a bare 'publishedVersion: <version>' line in the snapshot's standardSourceLocation",
		});
	}
};

module.exports = { assertKnownVersion, REFUSED_VERSION_SOURCE_LIST, moduleName };
