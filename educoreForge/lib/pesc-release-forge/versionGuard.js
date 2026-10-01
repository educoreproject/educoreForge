'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// versionGuard.js — refuses to forge a PESC release without a known version, or with a version
// that disagrees with the release's manifest entry (DESIGN-pescForge.md §6 gate F3).
//
//   assertKnownVersion({ metadata, releaseEntry, standardKey })   throws a named refusal, or returns
//
// The framework only WARNS when no version is found: deriveVersionStamp stamps versionSource
// 'unknown' and the build carries on. This guard refuses instead, as the SIF rebuild's does. The
// XSD files are not read for a version (describeSource says selfDescribedVersion null), so the
// version always comes from the snapshot's standardSourceLocation ('publishedVersion: 1.8.0').
//
// The second refusal is this forge's own: the expander's manifest entry also states the version,
// and the two must agree. standardSourceLocation is written by the scaffold tool from that entry,
// so a disagreement means one of the two was edited by hand.
//
// It runs inside the framework's pure layer (called from describeRoot, the first hook that sees
// the stamped metadata), so its throw reaches the forge callback through the framework's adapter.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

// the versionSource values that mean no version was found
const REFUSED_VERSION_SOURCE_LIST = Object.freeze(['unknown']);

const assertKnownVersion = ({ metadata, releaseEntry, standardKey }) => {
	if (REFUSED_VERSION_SOURCE_LIST.indexOf(metadata.versionSource) !== -1) {
		throw refuse.byName({
			moduleName,
			what: `${standardKey} version guard: versionSource is '${metadata.versionSource}' (publishedVersion '${metadata.publishedVersion}', snapshot '${metadata.snapshotKey}')`,
			where: "a PESC release forge never builds an unknown version; put a bare 'publishedVersion: <version>' line in the snapshot's standardSourceLocation",
		});
	}
	if (metadata.publishedVersion !== releaseEntry.version) {
		throw refuse.byName({
			moduleName,
			what: `${standardKey} version guard: standardSourceLocation says '${metadata.publishedVersion}' and the manifest entry for ${releaseEntry.releaseName} says '${releaseEntry.version}'`,
			where: 'the scaffold tool writes both from the expander\'s manifest; one of them was edited',
		});
	}
};

module.exports = { assertKnownVersion, REFUSED_VERSION_SOURCE_LIST, moduleName };
