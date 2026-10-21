#!/usr/bin/env node
'use strict';

// test-blockCompare.js — gate for apps/graph-builder/lib/block-compare.js and its CLI tools/blockCompare.js
// (R0 proof kit, 2026-10-21, step 4). Two tiny fixture stores of each kind in a temporary directory outside the tree; the
// decision stores are written through the REAL decision-store module, the standards stores carry the three tables the
// manifest compare reads (manifests, manifestBlocks, blocks) under their real column names.
//
// PROVES:
//   (a) decision blocks: a byte-equal block is IDENTICAL; a block differing ONLY in header.frameworkFingerprint is
//       ONLY_FINGERPRINT_DIFFERS; both PASS
//   (b) a block whose header (declarationDigest) or whose body moved is DIFFERENT and FAILS, naming the header field
//   (c) a pairKey frozen on one side only is BASELINE_ONLY / CANDIDATE_ONLY and FAILS
//   (d) the LATEST row per pairKey is the one compared (what getDecisionBlock answers)
//   (e) two empty stores do not PASS (an empty comparison proves nothing)
//   (f) manifests: identical member lists PASS; a member absent, a subject under another refId, and a member only the
//       candidate holds each FAIL and are listed; a prefix naming two manifests is refused by name
//   (g) nothing is written: every fixture store's bytes are unchanged after every compare
//   (h) the CLI: exit 0 on PASS, 1 on FAIL, refused by name with no action or a missing flag; -help answers
//   (i) no hub literal in the tool or its library (they take store paths and refIds, never a hub name)

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: blockCompare compares frozen decision blocks (fingerprint-substituting) and manifests
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { taskListPlus, pipeRunner } = require('qtools-asynchronous-pipe-plus')();

const blockCompareLib = require('../lib/block-compare');
const decisionStoreLib = require('../../../lib/decision-store/decision-store');

const TOOL_PATH = path.join(__dirname, '..', 'tools', 'blockCompare.js');
const scratchDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'testBlockCompare-'));
const scratchPath = (fileName) => path.join(scratchDirectoryPath, fileName);
const sha256OfFile = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

// ---------------------------------------------------------------- decision-block fixtures
const frozenTextOf = ({ frameworkFingerprint, declarationDigest, decisionList }) =>
	JSON.stringify({ header: { frameworkFingerprint, declarationDigest, bridgeName: 'toyBridge' }, decisionRecordList: decisionList });
const FINGERPRINT_OLD = 'a'.repeat(64);
const FINGERPRINT_NEW = 'b'.repeat(64);
const PAIR_SAME = 'hubx@1::toy@1::toyBridge::inferred';
const PAIR_FINGERPRINT = 'hubx@1::toy@2::toyBridge::inferred';
const PAIR_HEADER = 'hubx@1::toy@3::toyBridge::inferred';
const PAIR_BODY = 'hubx@1::toy@4::toyBridge::inferred';
const PAIR_BASELINE_ONLY = 'hubx@1::toy@5::toyBridge::inferred';
const PAIR_CANDIDATE_ONLY = 'hubx@1::toy@6::toyBridge::inferred';

const baseText = (fingerprint, decisionList) => frozenTextOf({ frameworkFingerprint: fingerprint, declarationDigest: 'd1', decisionList });
const BASELINE_ROW_LIST = [
	{ pairKey: PAIR_SAME, frozenText: baseText(FINGERPRINT_OLD, ['s1']) },
	{ pairKey: PAIR_FINGERPRINT, frozenText: baseText(FINGERPRINT_OLD, ['f1']) },
	{ pairKey: PAIR_HEADER, frozenText: baseText(FINGERPRINT_OLD, ['h1']) },
	{ pairKey: PAIR_BODY, frozenText: baseText(FINGERPRINT_OLD, ['b1']) },
	{ pairKey: PAIR_BASELINE_ONLY, frozenText: baseText(FINGERPRINT_OLD, ['o1']) },
];
const CANDIDATE_ROW_LIST = [
	{ pairKey: PAIR_SAME, frozenText: baseText(FINGERPRINT_OLD, ['s1']) },
	// (d) an EARLIER row for the pair that would be DIFFERENT; the later one is the one compared
	{ pairKey: PAIR_FINGERPRINT, frozenText: baseText(FINGERPRINT_NEW, ['stale']) },
	{ pairKey: PAIR_FINGERPRINT, frozenText: baseText(FINGERPRINT_NEW, ['f1']) },
	{ pairKey: PAIR_HEADER, frozenText: frozenTextOf({ frameworkFingerprint: FINGERPRINT_NEW, declarationDigest: 'd2', decisionList: ['h1'] }) },
	{ pairKey: PAIR_BODY, frozenText: baseText(FINGERPRINT_NEW, ['b2']) },
	{ pairKey: PAIR_CANDIDATE_ONLY, frozenText: baseText(FINGERPRINT_NEW, ['c1']) },
];

const writeDecisionStore = (filePath, rowList, callback) => {
	decisionStoreLib().open({ databaseFilePath: filePath }, (openError, store) => {
		if (openError) {
			callback(openError);
			return;
		}
		const taskList = new taskListPlus();
		rowList.forEach((oneRow) => taskList.push((args, next) => store.saveDecisionBlock({ pairKey: oneRow.pairKey, frozenText: oneRow.frozenText }, (saveError) => next(saveError, args))));
		pipeRunner(taskList.getList(), {}, (pipeError) => callback(pipeError || ''));
	});
};

// ---------------------------------------------------------------- standards-store fixtures
const writeStandardsStore = (filePath, manifestList) => {
	const database = new Database(filePath);
	database.exec('create table blocks (refId text primary key, kind text, subject text, text text); create table manifests (refId text primary key, recipeHash text); create table manifestBlocks (manifestRefId text, schemaBlockRefId text);');
	manifestList.forEach((oneManifest) => {
		database.prepare('insert into manifests (refId, recipeHash) values (?, ?)').run(oneManifest.manifestRefId, 'r');
		oneManifest.memberList.forEach((oneMember) => {
			database.prepare('insert or ignore into blocks (refId, kind, subject, text) values (?, ?, ?, ?)').run(oneMember.refId, oneMember.kind, oneMember.subject, 'x');
			database.prepare('insert into manifestBlocks (manifestRefId, schemaBlockRefId) values (?, ?)').run(oneManifest.manifestRefId, oneMember.refId);
		});
	});
	database.close();
};
const memberOf = (kind, subject, refIdCharacter) => ({ kind, subject, refId: refIdCharacter.repeat(64) });
const BASE_MEMBER = memberOf('standardBase', 'toy@1_base', '1');
const HUB_MEMBER = memberOf('standardBase', 'hubx@1_base', '2');
const REL_MEMBER = memberOf('relationship', 'hubx@1_rel_toy@1_close', '3');

const runTool = (argumentList) => spawnSync(process.execPath, [TOOL_PATH, ...argumentList], { encoding: 'utf8' });

const taskList = new taskListPlus();
taskList.push((args, next) => writeDecisionStore(scratchPath('baseline.decisions.sqlite3'), BASELINE_ROW_LIST, (error) => next(error, args)));
taskList.push((args, next) => writeDecisionStore(scratchPath('candidate.decisions.sqlite3'), CANDIDATE_ROW_LIST, (error) => next(error, args)));
taskList.push((args, next) => writeDecisionStore(scratchPath('emptyA.decisions.sqlite3'), [], (error) => next(error, args)));
taskList.push((args, next) => writeDecisionStore(scratchPath('emptyB.decisions.sqlite3'), [], (error) => next(error, args)));
taskList.push((args, next) => writeDecisionStore(scratchPath('cleanCandidate.decisions.sqlite3'), [BASELINE_ROW_LIST[0], { pairKey: PAIR_FINGERPRINT, frozenText: baseText(FINGERPRINT_NEW, ['f1']) }], (error) => next(error, args)));
taskList.push((args, next) => writeDecisionStore(scratchPath('cleanBaseline.decisions.sqlite3'), BASELINE_ROW_LIST.slice(0, 2), (error) => next(error, args)));

pipeRunner(taskList.getList(), {}, (fixtureError) => {
	if (fixtureError) {
		harness.ok('fixture decision stores written through the real decision-store module', false, fixtureError);
		harness.report();
		return;
	}
	writeStandardsStore(scratchPath('baseline.standards.sqlite3'), [{ manifestRefId: 'aa'.repeat(32), memberList: [BASE_MEMBER, HUB_MEMBER, REL_MEMBER] }]);
	writeStandardsStore(scratchPath('candidate.standards.sqlite3'), [
		{ manifestRefId: 'ab'.repeat(32), memberList: [BASE_MEMBER, HUB_MEMBER, REL_MEMBER] },
		{ manifestRefId: 'ac'.repeat(32), memberList: [BASE_MEMBER, memberOf('standardBase', 'hubx@1_base', '4'), memberOf('relationship', 'hubx@1_rel_toy@1_exact', '5')] },
		// a second manifest sharing the 'ab' prefix's first characters, for the ambiguity refusal
		{ manifestRefId: `ababab${'cd'.repeat(29)}`, memberList: [BASE_MEMBER] },
	]);
	const fixtureFileNameList = fs.readdirSync(scratchDirectoryPath).filter((fileName) => fileName.endsWith('.sqlite3'));
	const shaBefore = fixtureFileNameList.reduce((soFar, fileName) => ({ ...soFar, [fileName]: sha256OfFile(scratchPath(fileName)) }), {});

	harness.section('(a)-(d) decision blocks, per pairKey');
	const compared = blockCompareLib.compareDecisionBlockStores({ baselineDecisionStoreFilePath: scratchPath('baseline.decisions.sqlite3'), candidateDecisionStoreFilePath: scratchPath('candidate.decisions.sqlite3') });
	harness.ok('the compare answers (no error)', compared.error === undefined, compared.error);
	const verdictOf = (pairKey) => (compared.rowList.find((oneRow) => oneRow.pairKey === pairKey) || {}).verdict;
	harness.equal('(a) byte-equal block -> IDENTICAL', verdictOf(PAIR_SAME), blockCompareLib.VERDICT_IDENTICAL);
	harness.equal('(a)+(d) fingerprint-only difference, LATEST row compared -> ONLY_FINGERPRINT_DIFFERS', verdictOf(PAIR_FINGERPRINT), blockCompareLib.VERDICT_ONLY_FINGERPRINT_DIFFERS);
	harness.equal('(b) declarationDigest moved -> DIFFERENT', verdictOf(PAIR_HEADER), blockCompareLib.VERDICT_DIFFERENT);
	harness.equal('(b) the differing header field is named', JSON.stringify((compared.rowList.find((oneRow) => oneRow.pairKey === PAIR_HEADER) || {}).differingHeaderNameList), JSON.stringify(['declarationDigest']));
	harness.equal('(b) a body-only change -> DIFFERENT, bodyDiffers', `${verdictOf(PAIR_BODY)} ${(compared.rowList.find((oneRow) => oneRow.pairKey === PAIR_BODY) || {}).bodyDiffers}`, `${blockCompareLib.VERDICT_DIFFERENT} true`);
	harness.equal('(c) frozen in the baseline only -> BASELINE_ONLY', verdictOf(PAIR_BASELINE_ONLY), blockCompareLib.VERDICT_BASELINE_ONLY);
	harness.equal('(c) frozen in the candidate only -> CANDIDATE_ONLY', verdictOf(PAIR_CANDIDATE_ONLY), blockCompareLib.VERDICT_CANDIDATE_ONLY);
	harness.equal('(b)(c) the whole compare FAILS', compared.passed, false);
	const clean = blockCompareLib.compareDecisionBlockStores({ baselineDecisionStoreFilePath: scratchPath('cleanBaseline.decisions.sqlite3'), candidateDecisionStoreFilePath: scratchPath('cleanCandidate.decisions.sqlite3') });
	harness.equal('(a) identical + fingerprint-only stores PASS', `${clean.passed} ${clean.rowList.map((oneRow) => oneRow.verdict).join(',')}`, `true ${blockCompareLib.VERDICT_IDENTICAL},${blockCompareLib.VERDICT_ONLY_FINGERPRINT_DIFFERS}`);

	harness.section('(e) an empty comparison proves nothing');
	const empty = blockCompareLib.compareDecisionBlockStores({ baselineDecisionStoreFilePath: scratchPath('emptyA.decisions.sqlite3'), candidateDecisionStoreFilePath: scratchPath('emptyB.decisions.sqlite3') });
	harness.equal('two empty stores do not PASS', empty.passed, false);
	const absent = blockCompareLib.compareDecisionBlockStores({ baselineDecisionStoreFilePath: scratchPath('noSuch.sqlite3'), candidateDecisionStoreFilePath: scratchPath('emptyB.decisions.sqlite3') });
	harness.match('a store path not on disk is refused by name', String(absent.error), /decision store .*noSuch\.sqlite3.* is not a file on disk/);

	harness.section('(f) manifests');
	const baselineStandardsPath = scratchPath('baseline.standards.sqlite3');
	const candidateStandardsPath = scratchPath('candidate.standards.sqlite3');
	const sameManifest = blockCompareLib.compareManifests({ baselineStandardsDatabaseFilePath: baselineStandardsPath, baselineManifestRefId: 'aa'.repeat(32), candidateStandardsDatabaseFilePath: candidateStandardsPath, candidateManifestRefId: 'ab'.repeat(32) });
	harness.equal('identical member lists PASS (3 identical)', `${sameManifest.passed} ${sameManifest.comparison.identicalCount}`, 'true 3');
	const movedManifest = blockCompareLib.compareManifests({ baselineStandardsDatabaseFilePath: baselineStandardsPath, baselineManifestRefId: 'aaaaaa', candidateStandardsDatabaseFilePath: candidateStandardsPath, candidateManifestRefId: 'acacac' });
	harness.equal('a moved and a replaced member FAIL', movedManifest.passed, false);
	harness.equal('baseline members absent by refId are listed', movedManifest.comparison.baselineOnlyList.map((oneMember) => oneMember.subject).join(','), 'hubx@1_rel_toy@1_close,hubx@1_base');
	harness.equal('a subject under a different refId is listed with both refIds', movedManifest.comparison.subjectMovedList.map((oneMember) => `${oneMember.subject} ${oneMember.refId[0]}->${oneMember.candidateRefId[0]}`).join(','), 'hubx@1_base 2->4');
	harness.equal('members only the candidate holds are listed', movedManifest.comparison.candidateOnlyList.map((oneMember) => oneMember.subject).join(','), 'hubx@1_rel_toy@1_exact,hubx@1_base');
	const ambiguous = blockCompareLib.compareManifests({ baselineStandardsDatabaseFilePath: baselineStandardsPath, baselineManifestRefId: 'aaaaaa', candidateStandardsDatabaseFilePath: candidateStandardsPath, candidateManifestRefId: 'abab' });
	harness.match('a refId shorter than six characters is refused by name', String(ambiguous.error), /manifestRefId "abab" is not a hex refId or prefix/);
	const ambiguousPrefix = blockCompareLib.compareManifests({ baselineStandardsDatabaseFilePath: baselineStandardsPath, baselineManifestRefId: 'aaaaaa', candidateStandardsDatabaseFilePath: candidateStandardsPath, candidateManifestRefId: 'ababab' });
	harness.match('a prefix naming two manifests is refused by name', String(ambiguousPrefix.error), /manifestRefId 'ababab' names 2 manifest\(s\).*it must name exactly one/);

	harness.section('(h) the CLI');
	const cliPass = runTool(['-decisionBlocks', `--baselineDecisionStorePath=${scratchPath('cleanBaseline.decisions.sqlite3')}`, `--candidateDecisionStorePath=${scratchPath('cleanCandidate.decisions.sqlite3')}`]);
	harness.equal('-decisionBlocks PASS exits 0', cliPass.status, 0);
	harness.match('-decisionBlocks PASS says PASS', cliPass.stdout, /2 pairKey\(s\); PASS/);
	const cliFail = runTool(['-decisionBlocks', `--baselineDecisionStorePath=${scratchPath('baseline.decisions.sqlite3')}`, `--candidateDecisionStorePath=${scratchPath('candidate.decisions.sqlite3')}`]);
	harness.equal('-decisionBlocks FAIL exits 1', cliFail.status, 1);
	harness.match('-decisionBlocks FAIL prints a DIFFERENT row', cliFail.stdout, /"verdict":"DIFFERENT"/);
	const cliManifest = runTool(['-manifests', `--baselineStandardsDatabasePath=${baselineStandardsPath}`, '--baselineManifestRefId=aaaaaa', `--candidateStandardsDatabasePath=${candidateStandardsPath}`, '--candidateManifestRefId=acacac']);
	harness.equal('-manifests FAIL exits 1', cliManifest.status, 1);
	harness.match('-manifests lists the moved subject', cliManifest.stdout, /the same subject under a DIFFERENT refId:\n  standardBase hubx@1_base 2{64} -> 4{64}/);
	const cliNoAction = runTool([]);
	harness.equal('no action exits 1', cliNoAction.status, 1);
	harness.match('no action is refused by name', `${cliNoAction.stdout}${cliNoAction.stderr}`, /REFUSED: exactly one action is required/);
	const cliMissingFlag = runTool(['-manifests', `--baselineStandardsDatabasePath=${baselineStandardsPath}`]);
	harness.match('a missing flag is refused by name, not defaulted', `${cliMissingFlag.stdout}${cliMissingFlag.stderr}`, /required and absent: --baselineManifestRefId, --candidateStandardsDatabasePath, --candidateManifestRefId/);
	const cliHelp = runTool(['-help']);
	harness.match('-help prints the page and exits 0', `${cliHelp.status} ${cliHelp.stdout}`, /^0 [\s\S]*SYNOPSIS[\s\S]*EXIT STATUS/);

	harness.section('(g) read-only');
	const changedList = fixtureFileNameList.filter((fileName) => sha256OfFile(scratchPath(fileName)) !== shaBefore[fileName]);
	harness.equal('every fixture store is byte-unchanged after every compare', changedList.join(','), '');

	harness.section('(i) no hub literal');
	const hubLiteralFileList = [TOOL_PATH, require.resolve('../lib/block-compare')].filter((filePath) => /ceds/i.test(fs.readFileSync(filePath, 'utf8')));
	harness.equal('the tool and its library name no hub', hubLiteralFileList.join(','), '');

	fs.rmSync(scratchDirectoryPath, { recursive: true, force: true });
	harness.report();
});
