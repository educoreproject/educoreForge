#!/usr/bin/env node
'use strict';

// test-standardUsageTips.js — the per-standard metadata table (configs/dmeStandardUsageTips.json) is read strictly
// (lane P, mappingProvenance 2026-10-04; TQ's "easiest hack" until kind + tips move into each forge declaration). Pure.
//   (a) THE REAL FILE reads clean, and CEDS / SIF260928 / every PESC release each match exactly one entry
//   (b) a standardKind outside vocabulary.STANDARD_KIND_LIST is REFUSED by name
//   (c) a sourceKey two entries match is REFUSED by name (which text applies would be a guess)
//   (d) a sourceKey no entry matches yields null (the card gets no property)
// RED TWINS, each observed in memory: (b) the kind check removed; (c) the ambiguity check removed; (d) a match made for any
// key; (a) the prefix compare made case-sensitive, so the lower-cased prefixes miss the real keys.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the standard metadata table is read strictly, matched by prefix, never invented
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../../../../../../../test/testLib/harness')(moduleName);
const vocabulary = require('../../../../../../../lib/vocabulary/vocabulary');
const { loadBuildJsDouble } = require('../../../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const TIPS_PATH = path.join(__dirname, '..', 'lib', 'standard-usage-tips.js');
const REAL_TABLE_PATH = path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', '..', '..', 'configs', 'dmeStandardUsageTips.json');
const tipsLibFor = (mutationList) => (mutationList.length === 0 ? require(TIPS_PATH) : loadBuildJsDouble({ buildJsPath: TIPS_PATH, mutationList }));
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'standardUsageTips-'));
const tableFile = (fileName, table) => {
	const filePath = path.join(scratchDir, fileName);
	fs.writeFileSync(filePath, JSON.stringify(table));
	return filePath;
};
const entry = (prefixList, standardKind = 'dataStandard') => ({ standardKeyPrefixList: prefixList, standardKind, standardUsageTips: 'tips' });
const REAL_SOURCE_KEY_LIST = ['CEDS', 'SIF260928', 'PESC-CollegeTranscript-1.8.0', 'PESC-HighSchoolTranscript-1.6.0', 'PESC-TestScoreReport-1.1.0', 'PESC-LearningRecord-1.0.0', 'PESC-DocumentRequest-1.0.0', 'PESC-DocumentResponse-1.0.0', 'PESC-AcademicEportfolio-1.0.0'];

const conjunctJudgeByRefId = {
	a_realFileMatchesTheStandards: (mutationList) => {
		const tipsLib = tipsLibFor(mutationList);
		const read = tipsLib.readStandardMetadataEntryList({ filePath: REAL_TABLE_PATH, standardKindList: vocabulary.STANDARD_KIND_LIST });
		if (read.error) {
			return { pass: false, detail: read.error };
		}
		const unmatched = REAL_SOURCE_KEY_LIST.filter((oneKey) => { const found = tipsLib.standardMetadataFor({ standardMetadataEntryList: read.standardMetadataEntryList, sourceKey: oneKey }); return found.error || found.standardMetadata === null; });
		return { pass: unmatched.length === 0, detail: unmatched.length ? `unmatched: ${unmatched.join(', ')}` : `${REAL_SOURCE_KEY_LIST.length} keys matched; EdFi has no entry` };
	},
	b_badKindRefused: (mutationList) => {
		const read = tipsLibFor(mutationList).readStandardMetadataEntryList({ filePath: tableFile('badKind.json', { Toy: entry(['toy'], 'vibes') }), standardKindList: vocabulary.STANDARD_KIND_LIST });
		return { pass: /REFUSED: .*Toy: standardKind "vibes" is not one of dataStandard, classificationTaxonomy/.test(String(read.error)), detail: read.error || 'read a bad kind' };
	},
	c_ambiguousMatchRefused: (mutationList) => {
		const tipsLib = tipsLibFor(mutationList);
		const read = tipsLib.readStandardMetadataEntryList({ filePath: tableFile('ambiguous.json', { Pesc: entry(['PESC']), PescCt: entry(['PESC-College']) }), standardKindList: vocabulary.STANDARD_KIND_LIST });
		const found = tipsLib.standardMetadataFor({ standardMetadataEntryList: read.standardMetadataEntryList, sourceKey: 'PESC-CollegeTranscript-1.8.0' });
		return { pass: /REFUSED: standard 'PESC-CollegeTranscript-1.8.0' matches 2 metadata entries/.test(String(found.error)), detail: found.error || 'picked one of two' };
	},
	d_unmatchedYieldsNull: (mutationList) => {
		const tipsLib = tipsLibFor(mutationList);
		const read = tipsLib.readStandardMetadataEntryList({ filePath: tableFile('one.json', { _about: 'commentary', Toy: entry(['toy']) }), standardKindList: vocabulary.STANDARD_KIND_LIST });
		const found = tipsLib.standardMetadataFor({ standardMetadataEntryList: read.standardMetadataEntryList, sourceKey: 'EdFi' });
		return { pass: !found.error && found.standardMetadata === null, detail: JSON.stringify(found) };
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_realFileMatchesTheStandards', twinName: 'prefixCompareCaseSensitive', find: 'const lowerSourceKey = String(sourceKey).toLowerCase();', replace: 'const lowerSourceKey = String(sourceKey);' },
	{ conjunctRefId: 'b_badKindRefused', twinName: 'kindUnchecked', find: '.concat(standardKindList.indexOf(oneEntry.standardKind) !== -1 ? [] :', replace: '.concat(true ? [] :' },
	{ conjunctRefId: 'c_ambiguousMatchRefused', twinName: 'ambiguityUnchecked', find: '\tif (matchingEntryList.length > 1) {', replace: '\tif (false) {' },
	{ conjunctRefId: 'd_unmatchedYieldsNull', twinName: 'anyKeyMatches', find: 'oneEntry.standardKeyPrefixList.some((onePrefix) => lowerSourceKey.indexOf(onePrefix) === 0)', replace: 'true' },
];

harness.section('BASELINE — the real reader passes every conjunct');
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId]([]);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});
harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a reader double (in memory)');
harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), Object.keys(conjunctJudgeByRefId).sort().join(','));
TWIN_LIST.forEach((oneTwin) => {
	const verdict = conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }]);
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
});
fs.rmSync(scratchDir, { recursive: true, force: true });
harness.report();
