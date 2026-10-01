'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// releaseNames.js — the naming rule for one PESC release, in one place (DESIGN-pescForge.md §2.5;
// TQ's ruling Q2, option B).
//
//   deriveReleaseNames({ standard, version }) → { releaseNames } | { refusalMessage }
//
// For standard 'CollegeTranscript' and version '1.8.0':
//   standardKey            pesccollegetranscript1v8v0      directory, recipe token, stableId prefix, CURIE prefix
//   standardSource         PESC-CollegeTranscript-1.8.0    every node's _source; unique across bundles
//   standardDisplayName    PESC College Transcript v1.8.0  the DME title
//   labelPrefix            PescCollegeTranscript1v8v0      DECLARED, not derived from standardKey: a
//                                                          lowercase standardKey has lost its word boundaries
//
// The version encoding puts a 'v' between components, so it reads one way only: 1.1.0 is 1v1v0 and
// 11.0.0 is 11v0v0 (the bundle-name correction recorded against this project). The scaffold tool
// writes these names into the bundle's releaseDeclaration.json once; the forge declaration checks
// the file against this rule every time it is built, so a hand edit to one name refuses.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const STANDARD_TOKEN_RE = /^[A-Z][A-Za-z]*$/;
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const KEY_PREFIX = 'pesc';
const LABEL_PREFIX_HEAD = 'Pesc';
const SOURCE_PREFIX = 'PESC';
const VERSION_COMPONENT_JOINER = 'v';

// 'CollegeTranscript' → 'College Transcript': a space before every capital that follows a lowercase letter
const spacedStandardWords = (standard) => standard.replace(/([a-z])([A-Z])/g, '$1 $2');

const deriveReleaseNames = ({ standard, version }) => {
	if (typeof standard !== 'string' || !STANDARD_TOKEN_RE.test(standard)) {
		return { refusalMessage: refuse.byName({ moduleName, what: `standard is ${JSON.stringify(standard)}`, where: `a PESC standard token is letters only, starting with a capital (${STANDARD_TOKEN_RE})` }).message };
	}
	const versionMatch = typeof version === 'string' ? version.match(VERSION_RE) : null;
	if (versionMatch === null) {
		return { refusalMessage: refuse.byName({ moduleName, what: `version is ${JSON.stringify(version)}`, where: 'a PESC release version is three dot-separated integers' }).message };
	}
	const encodedVersion = versionMatch.slice(1, 4).join(VERSION_COMPONENT_JOINER);
	const standardKey = `${KEY_PREFIX}${standard.toLowerCase()}${encodedVersion}`;
	const labelPrefix = `${LABEL_PREFIX_HEAD}${standard}${encodedVersion}`;
	return {
		releaseNames: Object.freeze({
			standard,
			version,
			standardKey,
			standardSource: `${SOURCE_PREFIX}-${standard}-${version}`,
			standardDisplayName: `${SOURCE_PREFIX} ${spacedStandardWords(standard)} v${version}`,
			labelPrefix,
			stableUriPropertyName: `${standardKey}StableId`,
			rootStableId: `${standardKey}:root`,
			rootLabel: `${labelPrefix}Root`,
			// the SIF rebuild's shape: <standardKey>:<kind> or <standardKey>:<kind>/<rest> (the root and the release
			// record have no rest)
			stableIdPatternText: `^${standardKey}:[A-Za-z]+(/.+)?$`,
			embedTextLabel: `${labelPrefix}EmbedText`,
			entryModuleFileName: `forge${labelPrefix}.js`,
		}),
	};
};

module.exports = { deriveReleaseNames, spacedStandardWords, moduleName };
