#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// test-namedSetSpendLine.js — phase B5 gates (a)–(f): the rejudgeRealNamedSet spending line.
//
// The runner is a CLI that exits on refusal, so it cannot be required here. Its rules live in
// namedSetSpendGuard.js and spendAuthorisationGuard.js, which the runner calls; the conjuncts below call the SAME
// functions over stated worlds (the runner double), and read the runner's source for the wiring — that the line
// is a spending line, that the refusals come before the spawn, and what the build is handed.
//
// Each gate has a twin: the passing world, then one change that turns exactly that gate's check red. The twin
// asserts the refusal names ITS check, so a twin cannot go red for a neighbour's reason.
//
// A last section runs the rule over the real named set of record and its stableId file, read-only.
// It launches nothing, spends nothing, and starts no container.

const helpText = () => `
NAME
     ${moduleName} -- phase B5: the named-set spending line refuses what it must, before launch

SYNOPSIS
     ${moduleName}

EXIT STATUS
     0 all assertions pass;  1 otherwise.
`;
require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const path = require('path');
const harness = require('../../../../test/testLib/harness')(moduleName);
const namedSetSpendGuardLib = require('./namedSetSpendGuard');
const spendAuthorisationGuardLib = require('./spendAuthorisationGuard');
const sourceWindowLib = require('../../apps/bridge-maker/lib/sourceWindow');

const RUNNER_FILE_PATH = path.join(__dirname, 'runBridgeAcceptanceCommand.js');
const runnerText = fs.readFileSync(RUNNER_FILE_PATH, 'utf8');
const LINE_NAME = namedSetSpendGuardLib.NAMED_SET_LINE_NAME;
const MAX_FIELD_NAME = namedSetSpendGuardLib.MAX_JUDGMENT_COUNT_FIELD_NAME;

// ---------------------------------------------------------------------
// the passing world: a three-id list of record, its stableIds, a max equal to its length
// ---------------------------------------------------------------------
const PREFIX = 'toy:question/';
const QUESTION_ID_LIST = ['q001', 'q002', 'q003'];
const namedSetFileText = JSON.stringify(QUESTION_ID_LIST);
const subjectStableIdFileText = JSON.stringify(QUESTION_ID_LIST.map((oneQuestionId) => `${PREFIX}${oneQuestionId}`));
const baseEntry = Object.freeze({
	standardKey: 'toy',
	namedSetFilePath: '/declared/namedSet.json',
	namedSetSha256: namedSetSpendGuardLib.sha256HexOf(namedSetFileText),
	namedSetSubjectStableIdFilePath: '/declared/namedSetStableIds.json',
	namedSetSubjectStableIdPrefix: PREFIX,
	[MAX_FIELD_NAME]: QUESTION_ID_LIST.length,
	spendAuthorisationByLine: { rejudgeRealLimit: null, materialiseReal: null, [LINE_NAME]: { sessionName: 'TEST_SESSION', date: '2026-09-29', note: 'fixture' } },
});
const refusalFor = (world) => namedSetSpendGuardLib.namedSetRefusalFor({ entry: baseEntry, bridgeName: 'toyBridge', namedSetFileText, subjectStableIdFileText, ...world });
const withEntry = (changes) => ({ ...baseEntry, ...changes });
const withoutField = (fieldName) => Object.keys(baseEntry).filter((oneFieldName) => oneFieldName !== fieldName).reduce((soFar, oneFieldName) => ({ ...soFar, [oneFieldName]: baseEntry[oneFieldName] }), {});

harness.equal('BASE — the passing world is PERMITTED: sha matches, max equals the list length, stableIds are exactly prefix + id', refusalFor({}), '');

// ---------------------------------------------------------------------
// (a) a sha mismatch is refused
// ---------------------------------------------------------------------
const oneByteAlteredText = namedSetFileText.replace('q002', 'q00X');
harness.ok('(a) the one-byte alteration really is one byte and really changes the sha (the twin tests what it says)', oneByteAlteredText.length === namedSetFileText.length && [...oneByteAlteredText].filter((oneCharacter, oneIndex) => oneCharacter !== namedSetFileText[oneIndex]).length === 1 && namedSetSpendGuardLib.sha256HexOf(oneByteAlteredText) !== baseEntry.namedSetSha256);
harness.ok('(a) RED-OBSERVED — one byte of the list of record altered: REFUSED as NAMED SET SHA MISMATCH, naming both shas', /^NAMED SET SHA MISMATCH/.test(refusalFor({ namedSetFileText: oneByteAlteredText })) && refusalFor({ namedSetFileText: oneByteAlteredText }).indexOf(baseEntry.namedSetSha256) !== -1, refusalFor({ namedSetFileText: oneByteAlteredText }));
harness.ok('(a) RED-OBSERVED — the pinned sha absent from the entry is refused by name (a line with no sha has no spend bound)', /declares no namedSetSha256/.test(refusalFor({ entry: withoutField('namedSetSha256') })), refusalFor({ entry: withoutField('namedSetSha256') }));
harness.ok('(a) RED-OBSERVED — the list of record absent from disk is refused by name', /names a list of record that is not on disk/.test(refusalFor({ namedSetFileText: null })), refusalFor({ namedSetFileText: null }));

// ---------------------------------------------------------------------
// (b) a missing max count is refused
// ---------------------------------------------------------------------
harness.ok(`(b) RED-OBSERVED — ${MAX_FIELD_NAME} deleted: REFUSED by name as REQUIRED`, new RegExp(`declares no ${MAX_FIELD_NAME}`).test(refusalFor({ entry: withoutField(MAX_FIELD_NAME) })) && /REQUIRED/.test(refusalFor({ entry: withoutField(MAX_FIELD_NAME) })), refusalFor({ entry: withoutField(MAX_FIELD_NAME) }));
[0, -1, 2.5, '3', null].forEach((oneBadMax) => {
	harness.ok(`(b) RED-OBSERVED — ${MAX_FIELD_NAME} = ${JSON.stringify(oneBadMax)} is refused, never coerced`, new RegExp(`declares no ${MAX_FIELD_NAME}`).test(refusalFor({ entry: withEntry({ [MAX_FIELD_NAME]: oneBadMax }) })), refusalFor({ entry: withEntry({ [MAX_FIELD_NAME]: oneBadMax }) }));
});
// the runner's own generic check refuses an undeclared <line>MaxJudgmentCount before the named-set rule runs, for
// every line; this line inherits it because the key name is built by interpolation
harness.ok("(b) the runner's generic per-line ceiling check still runs on every line, including this one (interpolated key name)", /const declaredMaxJudgmentCount = entry\[`\$\{lineName\}MaxJudgmentCount`\];/.test(runnerText));

// ---------------------------------------------------------------------
// (c) a missing or withheld authorisation is refused under the guard's existing names
// ---------------------------------------------------------------------
const spendingLineNameList = (() => {
	const matched = /const SPENDING_LINE_NAME_LIST = Object\.freeze\(\[([^\]]*)\]\)/.exec(runnerText);
	return matched === null ? [] : matched[1].split(',').map((oneEntry) => oneEntry.trim().replace(/^'|'$/g, '')).filter((oneEntry) => oneEntry !== '');
})();
harness.ok(`(c) ${LINE_NAME} is in the runner's SPENDING_LINE_NAME_LIST, so the existing guard demands its authorisation (${spendingLineNameList.join(', ')})`, spendingLineNameList.indexOf(LINE_NAME) !== -1);
const spendRefusalFor = (entry) => spendAuthorisationGuardLib.spendRefusalFor({ entry, lineName: LINE_NAME, spendingLineNameList, bridgeName: 'toyBridge' });
harness.equal(`(c) an authorisation object under ${LINE_NAME} PERMITS it`, spendRefusalFor(baseEntry), '');
harness.ok(`(c) RED-OBSERVED — ${LINE_NAME}: null is REFUSED as WITHHELD`, /WITHHELD/.test(spendRefusalFor(withEntry({ spendAuthorisationByLine: { ...baseEntry.spendAuthorisationByLine, [LINE_NAME]: null } }))), spendRefusalFor(withEntry({ spendAuthorisationByLine: { ...baseEntry.spendAuthorisationByLine, [LINE_NAME]: null } })));
harness.ok(`(c) RED-OBSERVED — ${LINE_NAME} absent from spendAuthorisationByLine is REFUSED as UNDECLARED, not as WITHHELD`, /UNDECLARED/.test(spendRefusalFor(withEntry({ spendAuthorisationByLine: { rejudgeRealLimit: null, materialiseReal: null } }))) && !/WITHHELD/.test(spendRefusalFor(withEntry({ spendAuthorisationByLine: { rejudgeRealLimit: null, materialiseReal: null } }))), spendRefusalFor(withEntry({ spendAuthorisationByLine: { rejudgeRealLimit: null, materialiseReal: null } })));
harness.ok(`(c) RED-OBSERVED — a release for rejudgeRealLimit does NOT release ${LINE_NAME} (per-line, RULING B4R-2)`, /WITHHELD/.test(spendRefusalFor(withEntry({ spendAuthorisationByLine: { rejudgeRealLimit: { sessionName: 'TEST_SESSION' }, materialiseReal: null, [LINE_NAME]: null } }))));

// ---------------------------------------------------------------------
// (d) a list longer than the max is refused before launch, by name
// ---------------------------------------------------------------------
const shortMaxRefusal = refusalFor({ entry: withEntry({ [MAX_FIELD_NAME]: QUESTION_ID_LIST.length - 1 }) });
harness.ok(`(d) RED-OBSERVED — max set one below the list length (${QUESTION_ID_LIST.length - 1} < ${QUESTION_ID_LIST.length}): REFUSED as NAMED SET LONGER THAN ITS MAX, BEFORE LAUNCH`, /^NAMED SET LONGER THAN ITS MAX/.test(shortMaxRefusal) && /BEFORE LAUNCH/.test(shortMaxRefusal), shortMaxRefusal);
harness.equal('(d) a max ABOVE the list length is permitted (the max is an upper bound, not an exact count)', refusalFor({ entry: withEntry({ [MAX_FIELD_NAME]: QUESTION_ID_LIST.length + 1 }) }), '');
// before launch: in the runner's source, both refusals come before the build is spawned and before the sidecar is written
const indexOfText = (text) => runnerText.indexOf(text);
harness.ok('(d) the runner calls namedSetRefusalFor BEFORE it spawns the build and BEFORE it writes the provenance sidecar', indexOfText('namedSetSpendGuardLib.namedSetRefusalFor(') !== -1 && indexOfText('namedSetSpendGuardLib.namedSetRefusalFor(') < indexOfText("spawn('node'") && indexOfText('namedSetSpendGuardLib.namedSetRefusalFor(') < indexOfText('.provenance.json`), JSON.stringify'));
harness.ok('(d) the runner calls the spend guard BEFORE the named-set rule, so an unauthorised line is refused as unauthorised whatever its list says', indexOfText('spendAuthorisationGuardLib.spendRefusalFor(') !== -1 && indexOfText('spendAuthorisationGuardLib.spendRefusalFor(') < indexOfText('namedSetSpendGuardLib.namedSetRefusalFor('));
harness.ok('(d) the named-set rule runs only for this line — the existing lines are not asked about a named set', /if \(isNamedSetLine\) \{\n\tconst namedSetRefusal = namedSetSpendGuardLib\.namedSetRefusalFor\(/.test(runnerText) && /const isNamedSetLine = lineName === namedSetSpendGuardLib\.NAMED_SET_LINE_NAME;/.test(runnerText));

// ---------------------------------------------------------------------
// the stableId file the build is handed must be exactly the pinned list
// ---------------------------------------------------------------------
const stableIdRefusalFor = (subjectStableIdList) => refusalFor({ subjectStableIdFileText: JSON.stringify(subjectStableIdList) });
const expectedStableIdList = QUESTION_ID_LIST.map((oneQuestionId) => `${PREFIX}${oneQuestionId}`);
[
	['one stableId MISSING', expectedStableIdList.slice(0, 2), /is MISSING/],
	['one stableId EXTRA', expectedStableIdList.concat([`${PREFIX}q999`]), /is EXTRA/],
	['one stableId DUPLICATED', expectedStableIdList.concat([expectedStableIdList[0]]), /appears more than once/],
	['the wrong prefix', QUESTION_ID_LIST.map((oneQuestionId) => `other:question/${oneQuestionId}`), /is MISSING/],
].forEach(([oneLabel, oneStableIdList, oneExpectedPattern]) => {
	const refusal = stableIdRefusalFor(oneStableIdList);
	harness.ok(`(stableId) RED-OBSERVED — ${oneLabel}: REFUSED as NAMED SET STABLEID FILE DISAGREES WITH THE LIST OF RECORD`, /^NAMED SET STABLEID FILE DISAGREES WITH THE LIST OF RECORD/.test(refusal) && oneExpectedPattern.test(refusal), refusal);
});
harness.equal('(stableId) order does not matter: a reversed stableId file names the same set and is permitted', stableIdRefusalFor(expectedStableIdList.slice().reverse()), '');
harness.ok('(stableId) RED-OBSERVED — the stableId file absent from disk is refused by name', /names a subject stableId file that is not on disk/.test(refusalFor({ subjectStableIdFileText: null })));
harness.ok('(stableId) RED-OBSERVED — the prefix undeclared is refused by name (the mapping is data, never assumed)', /declares no namedSetSubjectStableIdPrefix/.test(refusalFor({ entry: withoutField('namedSetSubjectStableIdPrefix') })));
harness.ok('(stableId) RED-OBSERVED — a duplicated id in the pinned list of record is refused (a named set is a set)', (() => { const duplicatedText = JSON.stringify(['q001', 'q001']); return /more than once/.test(refusalFor({ namedSetFileText: duplicatedText, entry: withEntry({ namedSetSha256: namedSetSpendGuardLib.sha256HexOf(duplicatedText) }) })); })());
harness.ok('(stableId) the build is handed the stableId file, reconstructed from the entry, in the runner line the tamper check compares', /rejudgeRealNamedSet: \[`--rebridge=\$\{entry\.standardKey\}`, `--subjectListFilePath=\$\{entry\.namedSetSubjectStableIdFilePath\}`\],/.test(runnerText));

// ---------------------------------------------------------------------
// (f) after the run: judged count, re-ask count and max, side by side
// ---------------------------------------------------------------------
// the runner double: the forensic records a run appends, one per judgment. An earlier run's records sit before the
// launch offset and must not be counted.
const forensicLineOf = (record) => `${JSON.stringify(record)}\n`;
const earlierRunText = forensicLineOf({ promptHash: 'old1', cacheHit: false, reaskCount: 5 });
const thisRunText = [
	forensicLineOf({ promptHash: 'p1', cacheHit: false, reaskCount: 0 }),
	forensicLineOf({ promptHash: 'p2', cacheHit: false, reaskCount: 1 }),
	forensicLineOf({ promptHash: 'p3', cacheHit: true, reaskCount: 0 }),
	forensicLineOf({ kind: 'MappingReview', conflictList: [] }),
].join('');
const forensicFileListOf = (runText) => [{ filePath: '/declared/forensics/pair/gen_NAMED_SET_x.jsonl', fileBuffer: Buffer.from(earlierRunText + runText, 'utf8'), byteSizeAtLaunch: Buffer.byteLength(earlierRunText, 'utf8') }];
const LOG_TEXT = 'bridge: judged: 3 (asked 2, cache 1, abstained 0, rationaleForm refused 0; judge anthropic)\n';
const runReport = namedSetSpendGuardLib.namedSetRunReportFor({ forensicFileList: forensicFileListOf(thisRunText), logText: LOG_TEXT, maxJudgmentCount: 3 });
harness.ok('(f) RED-OBSERVED — a runner double that re-asks once shows re-asks = 1', runReport.reaskCount === 1, JSON.stringify(runReport));
harness.equal('(f) the report states judged, re-asks and max SIDE BY SIDE', runReport.sideBySideText, 'judged 2 · re-asks 1 · max 3');
harness.ok('(f) and as numbers: judged 2 (cache hits and the review record excluded), served from cache 1, no fault', runReport.judgedCount === 2 && runReport.servedFromCacheCount === 1 && runReport.maxJudgmentCount === 3 && runReport.faultList.length === 0, JSON.stringify(runReport));
const noReaskReport = namedSetSpendGuardLib.namedSetRunReportFor({ forensicFileList: forensicFileListOf(thisRunText.replace('"reaskCount":1', '"reaskCount":0')), logText: LOG_TEXT, maxJudgmentCount: 3 });
harness.ok('(f) the same double with its re-ask removed shows re-asks = 0 (the count is read, not constant)', noReaskReport.reaskCount === 0, JSON.stringify(noReaskReport));
const wholeFileReport = namedSetSpendGuardLib.namedSetRunReportFor({ forensicFileList: [{ ...forensicFileListOf(thisRunText)[0], byteSizeAtLaunch: 0 }], logText: LOG_TEXT, maxJudgmentCount: 3 });
harness.ok("(f) RED-OBSERVED — reading from byte 0 instead of the launch offset counts the earlier run's record (re-asks 6, judged 3) and the log cross-check names the fault", wholeFileReport.reaskCount === 6 && wholeFileReport.judgedCount === 3 && wholeFileReport.faultList.some((oneFault) => /does not describe this run/.test(oneFault)), JSON.stringify(wholeFileReport));
const noAskedLineReport = namedSetSpendGuardLib.namedSetRunReportFor({ forensicFileList: forensicFileListOf(thisRunText), logText: 'no judge summary here\n', maxJudgmentCount: 3 });
harness.ok('(f) RED-OBSERVED — a log with no "asked N" line is a fault by name (UNMEASURED), not a silent pass', noAskedLineReport.faultList.some((oneFault) => /UNMEASURED/.test(oneFault)), JSON.stringify(noAskedLineReport));
harness.ok('(f) the runner prints the side-by-side report on -verify for this line and turns its faults into contract faults', /namedSetSpendGuardLib\.namedSetRunReportFor\(/.test(runnerText) && /checked\.faultList\.push\(\.\.\.namedSetRunReport\.faultList\)/.test(runnerText) && /namedSetRunReport\.sideBySideText/.test(runnerText));
harness.ok('(f) the launch sidecar records each forensic file size BEFORE the spawn, so -verify reads only this run', indexOfText('const forensicByteSizeAtLaunchByPath = isNamedSetLine') !== -1 && indexOfText('const forensicByteSizeAtLaunchByPath = isNamedSetLine') < indexOfText("spawn('node'"));

// ---------------------------------------------------------------------
// the real named set of record (read-only): what D4's entry will meet
// ---------------------------------------------------------------------
const YARDSTICK_DIR_PATH = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/sif260928/yardstick';
const REAL_NAMED_SET_FILE_PATH = path.join(YARDSTICK_DIR_PATH, 'sifEvalSet-100-331f9cddb8f0.json');
const REAL_STABLE_ID_FILE_PATH = path.join(YARDSTICK_DIR_PATH, 'sifEvalSetStableIds-100-0f33f6dde6c7.json');
const REAL_NAMED_SET_SHA256 = '331f9cddb8f02c4153d0d4d6c536a10ec2f9ea7358de1a9c25747df4a9f87028';
if (fs.existsSync(REAL_NAMED_SET_FILE_PATH) && fs.existsSync(REAL_STABLE_ID_FILE_PATH)) {
	const realRulesPrefix = JSON.parse(fs.readFileSync(path.join(YARDSTICK_DIR_PATH, 'sifEvalSetDrawRules.json'), 'utf8')).questionStableIdPrefix;
	const realEntry = { namedSetFilePath: REAL_NAMED_SET_FILE_PATH, namedSetSha256: REAL_NAMED_SET_SHA256, namedSetSubjectStableIdFilePath: REAL_STABLE_ID_FILE_PATH, namedSetSubjectStableIdPrefix: realRulesPrefix, [MAX_FIELD_NAME]: 100 };
	const realRefusalFor = (entryChanges) => namedSetSpendGuardLib.namedSetRefusalFor({ entry: { ...realEntry, ...entryChanges }, bridgeName: 'realNamedSet', namedSetFileText: fs.readFileSync(REAL_NAMED_SET_FILE_PATH, 'utf8'), subjectStableIdFileText: fs.readFileSync(REAL_STABLE_ID_FILE_PATH, 'utf8') });
	harness.equal(`(real) the list of record, its pinned sha, its stableId file and max 100 are PERMITTED (prefix ${JSON.stringify(realRulesPrefix)} from the draw rules)`, realRefusalFor({}), '');
	harness.ok('(real) RED-OBSERVED — the same set with max 99 is refused before launch', /^NAMED SET LONGER THAN ITS MAX/.test(realRefusalFor({ [MAX_FIELD_NAME]: 99 })));
	const realStableIdList = JSON.parse(fs.readFileSync(REAL_STABLE_ID_FILE_PATH, 'utf8'));
	const realMark = sourceWindowLib.namedSetMarkFor({ subjectStableIdList: realStableIdList });
	harness.note(`(real) the block and the forensic files of this run carry ${realMark} — the digest of the STABLEID list the build is handed, not the list-of-record sha ${REAL_NAMED_SET_SHA256.slice(0, 12)}…`);
	harness.equal('(real) that generation mark is the digest of the stableId list (0f33f6dde6c7…), which is why the report matches forensic files by it', realMark.slice(0, 'NAMED_SET_'.length + 12), 'NAMED_SET_0f33f6dde6c7');
} else {
	harness.ok(`(real) UNMEASURED — the real named set files are not on this machine (${REAL_NAMED_SET_FILE_PATH})`, false);
}

harness.report();
