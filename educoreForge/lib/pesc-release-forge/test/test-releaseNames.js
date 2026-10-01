#!/usr/bin/env node
'use strict';

// test-releaseNames.js — the PESC release naming rule against the names TQ ruled (Q2, option B) and
// DESIGN-pescForge.md §2.5 lists for the seven releases, and the rule's refusals. ALL PURE.
//
// The release gates themselves run from each bundle's test/test-release.js (gateSuite.js); this
// suite holds the shared library's own rule to its frozen literals, so a change to the rule shows
// here before any bundle is rescaffolded.
//
// Run: node lib/pesc-release-forge/test/test-releaseNames.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- the PESC release naming rule: the seven ruled keys, the College Transcript names, the refusals

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const { deriveReleaseNames } = require(path.join(__dirname, '..', 'releaseNames'));
const { buildNodeKindTable } = require(path.join(__dirname, '..', 'nodeKindTable'));

// ---- FROZEN LITERALS (DESIGN-pescForge.md §2.5; WORKORDER §1 ruling 2). Never edited to match.
const RULED_KEY_BY_RELEASE = Object.freeze({
	'CollegeTranscript 1.8.0': 'pesccollegetranscript1v8v0',
	'HighSchoolTranscript 1.6.0': 'peschighschooltranscript1v6v0',
	'TestScoreReport 1.1.0': 'pesctestscorereport1v1v0',
	'DocumentRequest 1.0.0': 'pescdocumentrequest1v0v0',
	'DocumentResponse 1.0.0': 'pescdocumentresponse1v0v0',
	'LearningRecord 1.0.0': 'pesclearningrecord1v0v0',
	'AcademicEportfolio 1.0.0': 'pescacademiceportfolio1v0v0',
});
const RULED_COLLEGE_TRANSCRIPT_NAMES = Object.freeze({
	standardKey: 'pesccollegetranscript1v8v0',
	standardSource: 'PESC-CollegeTranscript-1.8.0',
	standardDisplayName: 'PESC College Transcript v1.8.0',
	labelPrefix: 'PescCollegeTranscript1v8v0',
	stableUriPropertyName: 'pesccollegetranscript1v8v0StableId',
	rootStableId: 'pesccollegetranscript1v8v0:root',
	rootLabel: 'PescCollegeTranscript1v8v0Root',
	entryModuleFileName: 'forgePescCollegeTranscript1v8v0.js',
});
// the constraints the design rechecked standardKey against (§2.5): lowercase, a CURIE prefix of letters and digits
const CURIE_PREFIX_RE = /^[A-Za-z][A-Za-z0-9]*$/;

harness.section('the seven ruled keys');
Object.keys(RULED_KEY_BY_RELEASE).forEach((oneRelease) => {
	const [standard, version] = oneRelease.split(' ');
	const derived = deriveReleaseNames({ standard, version });
	harness.equal(`${oneRelease} → ${RULED_KEY_BY_RELEASE[oneRelease]}`, derived.releaseNames && derived.releaseNames.standardKey, RULED_KEY_BY_RELEASE[oneRelease]);
	harness.ok(`${oneRelease}: the key is lowercase and a CURIE prefix of letters and digits`, derived.releaseNames && derived.releaseNames.standardKey === derived.releaseNames.standardKey.toLowerCase() && CURIE_PREFIX_RE.test(derived.releaseNames.standardKey));
});

harness.section('College Transcript 1.8.0, every name');
const collegeTranscriptNames = deriveReleaseNames({ standard: 'CollegeTranscript', version: '1.8.0' }).releaseNames;
Object.keys(RULED_COLLEGE_TRANSCRIPT_NAMES).forEach((oneName) => {
	harness.equal(`${oneName} is '${RULED_COLLEGE_TRANSCRIPT_NAMES[oneName]}'`, collegeTranscriptNames[oneName], RULED_COLLEGE_TRANSCRIPT_NAMES[oneName]);
});
harness.ok('the root id and the release record id match the stableId pattern', ['pesccollegetranscript1v8v0:root', 'pesccollegetranscript1v8v0:release', 'pesccollegetranscript1v8v0:type/urn:org:pesc:core:CoreMain:v1.19.0#NoteMessageType'].every((oneStableId) => new RegExp(collegeTranscriptNames.stableIdPatternText).test(oneStableId)));
harness.ok('every node-kind label carries the declared prefix', Object.values(buildNodeKindTable({ labelPrefix: collegeTranscriptNames.labelPrefix })).every((oneRow) => oneRow.perStandardLabel.startsWith('PescCollegeTranscript1v8v0')));

harness.section('the display-words override: one row, ePortfolio (QUIET_ORBIT ruling, phase F6)');
const ePortfolioNames = deriveReleaseNames({ standard: 'AcademicEportfolio', version: '1.0.0' }).releaseNames;
harness.equal("AcademicEportfolio 1.0.0's DME title is 'PESC Academic ePortfolio v1.0.0'", ePortfolioNames.standardDisplayName, 'PESC Academic ePortfolio v1.0.0');
harness.equal('its standardSource keeps the token', ePortfolioNames.standardSource, 'PESC-AcademicEportfolio-1.0.0');
harness.equal('its labelPrefix keeps the token', ePortfolioNames.labelPrefix, 'PescAcademicEportfolio1v0v0');
harness.equal('the override table has exactly one row', Object.keys(require(path.join(__dirname, '..', 'releaseNames')).DISPLAY_WORDS_OVERRIDE_BY_STANDARD).join(','), 'AcademicEportfolio');
harness.equal('a standard without a row follows the rule', deriveReleaseNames({ standard: 'HighSchoolTranscript', version: '1.6.0' }).releaseNames.standardDisplayName, 'PESC High School Transcript v1.6.0');

harness.section('the encoding reads one way only, and bad input is refused');
harness.ok("1.10.0 and 11.0.0 give different keys ('1v10v0', '11v0v0')", deriveReleaseNames({ standard: 'CollegeTranscript', version: '1.10.0' }).releaseNames.standardKey !== deriveReleaseNames({ standard: 'CollegeTranscript', version: '11.0.0' }).releaseNames.standardKey);
harness.match("a two-component version '1.8' is refused by name", deriveReleaseNames({ standard: 'CollegeTranscript', version: '1.8' }).refusalMessage, /releaseNames REFUSED: version is "1\.8"/);
harness.match("a lowercase standard 'collegeTranscript' is refused by name", deriveReleaseNames({ standard: 'collegeTranscript', version: '1.8.0' }).refusalMessage, /releaseNames REFUSED: standard is "collegeTranscript"/);
harness.match('an absent standard is refused, never defaulted', deriveReleaseNames({ version: '1.8.0' }).refusalMessage, /releaseNames REFUSED: standard is undefined/);

harness.report();
