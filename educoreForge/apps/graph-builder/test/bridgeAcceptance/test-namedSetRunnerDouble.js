#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// test-namedSetRunnerDouble.js — phase B5 gates (a)–(f) end to end, through the REAL runner CLI over a runner double.
//
// test-namedSetSpendLine.js calls the rules directly. This suite runs runBridgeAcceptanceCommand.js itself, as a
// process, so what it proves is the wiring: the refusals happen before anything is launched (no log, no PID, no
// provenance sidecar), a permitted launch hands the build the entry's stableId file, and -verify prints judged,
// re-asks and max side by side from only the records the run appended.
//
// THE DOUBLE. The runner's paths are fixed relative to its own file, so the suite builds a scratch tree with the
// same shape: the runner and its helper modules COPIED from this checkout (so it tests this code), test/ and
// sourceWindow.js linked, a scratch acceptanceCommands.jsonc holding one toy entry, and in place of graphBuilder.js
// a double that writes the log lines -verify reads and appends forensic records, one of them re-asked once. The
// scratch tree is its own git repository because the runner records git HEAD at launch.
//
// Nothing here reaches a real store, a container, the network or a judge.

const helpText = () => `
NAME
     ${moduleName} -- phase B5: the named-set line, end to end through the runner CLI over a runner double

SYNOPSIS
     ${moduleName}

EXIT STATUS
     0 all assertions pass;  1 otherwise.
`;
require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const harness = require('../../../../test/testLib/harness')(moduleName);
const namedSetSpendGuardLib = require('./namedSetSpendGuard');

const CHECKOUT_TREE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const LINE_NAME = namedSetSpendGuardLib.NAMED_SET_LINE_NAME;
const MAX_FIELD_NAME = namedSetSpendGuardLib.MAX_JUDGMENT_COUNT_FIELD_NAME;
const COPIED_MODULE_LIST = ['runBridgeAcceptanceCommand.js', 'genesisGuard.js', 'spendAuthorisationGuard.js', 'namedSetSpendGuard.js', 'verifyLogContract.js'];

// ---------------------------------------------------------------------
// the scratch tree
// ---------------------------------------------------------------------
const scratchRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'b5RunnerDouble-')));
const treeRoot = path.join(scratchRoot, 'educoreForge');
const dataDirPath = path.join(scratchRoot, 'data');
const acceptanceDirPath = path.join(treeRoot, 'lib', 'bridge-framework', 'test', 'acceptance');
const runnerDirPath = path.join(treeRoot, 'apps', 'graph-builder', 'test', 'bridgeAcceptance');
[runnerDirPath, acceptanceDirPath, path.join(treeRoot, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib'), dataDirPath].forEach((oneDirPath) => fs.mkdirSync(oneDirPath, { recursive: true }));
COPIED_MODULE_LIST.forEach((oneFileName) => fs.copyFileSync(path.join(__dirname, oneFileName), path.join(runnerDirPath, oneFileName)));
fs.symlinkSync(path.join(CHECKOUT_TREE_ROOT, 'test'), path.join(treeRoot, 'test'));
fs.symlinkSync(path.join(CHECKOUT_TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'sourceWindow.js'), path.join(treeRoot, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'sourceWindow.js'));
fs.writeFileSync(path.join(acceptanceDirPath, 'expectedDecisionBlockIds.json'), JSON.stringify({ byBridgeName: {} }));

// the double stands where graphBuilder.js stands. Every run: two live judgments (the second re-asked once), one
// cache hit, a review record, and the log lines -verify reads.
const BASE_BLOCK_ID = 'b'.repeat(64);
fs.writeFileSync(
	path.join(treeRoot, 'apps', 'graph-builder', 'graphBuilder.js'),
	`'use strict';
const fs = require('fs');
const path = require('path');
const sourceWindowLib = require('./apps/bridge-maker/lib/sourceWindow');
const flagValue = (flagName) => process.argv.find((oneArgument) => oneArgument.startsWith(\`--\${flagName}=\`)).split('=').slice(1).join('=');
const subjectStableIdList = JSON.parse(fs.readFileSync(flagValue('subjectListFilePath'), 'utf8'));
const pairDirPath = path.join(flagValue('matchForensicsDirPath'), 'CEDS__TOY');
fs.mkdirSync(pairDirPath, { recursive: true });
const forensicFilePath = path.join(pairDirPath, \`toyGeneration_\${sourceWindowLib.namedSetMarkFor({ subjectStableIdList })}.jsonl\`);
[{ promptHash: 'p1', cacheHit: false, reaskCount: 0 }, { promptHash: 'p2', cacheHit: false, reaskCount: 1 }, { promptHash: 'p3', cacheHit: true, reaskCount: 0 }, { kind: 'MappingReview', conflictList: [] }].forEach((oneRecord) => fs.appendFileSync(forensicFilePath, JSON.stringify(oneRecord) + '\\n'));
process.stdout.write('[A] REUSED toy -> standardBase ${BASE_BLOCK_ID}\\n');
process.stdout.write(\`handed subjectListFilePath=\${flagValue('subjectListFilePath')} (\${subjectStableIdList.length} subjects)\\n\`);
process.stdout.write('bridge: judged: 3 (asked 2, cache 1, abstained 0, rationaleForm refused 0; judge double)\\n');
process.stdout.write('DOUBLE DONE\\n');
`,
);

// the named set: three ids, their stableIds
const PREFIX = 'toy:question/';
const QUESTION_ID_LIST = ['q001', 'q002', 'q003'];
const namedSetFilePath = path.join(dataDirPath, 'namedSet.json');
const subjectStableIdFilePath = path.join(dataDirPath, 'namedSetStableIds.json');
const namedSetFileText = JSON.stringify(QUESTION_ID_LIST);
fs.writeFileSync(namedSetFilePath, namedSetFileText);
fs.writeFileSync(subjectStableIdFilePath, JSON.stringify(QUESTION_ID_LIST.map((oneQuestionId) => `${PREFIX}${oneQuestionId}`)));
const storeFilePath = path.join(dataDirPath, 'toy.standardsDatabase.sqlite3');
fs.writeFileSync(storeFilePath, '');
const buildLogsDirPath = path.join(dataDirPath, 'buildLogs');
const matchForensicsDirPath = path.join(dataDirPath, 'matchForensics');

// the committed line, written out the way the supervisor writes one: literal paths and the two placeholders
const committedLineFor = (subjectListFilePath) =>
	[
		'node --max-old-space-size=20000',
		path.join(treeRoot, 'apps', 'graph-builder', 'graphBuilder.js'),
		'-build',
		`--recipePath=${path.join(dataDirPath, 'toy.recipe.jsonc')}`,
		'--vectorize=true',
		'--reuseForgedBlocks=true',
		`--standardsDatabaseFilePath=${storeFilePath}`,
		`--decisionStoreFilePath=${path.join(dataDirPath, 'toy.decisions.sqlite3')}`,
		`--judgmentCacheFilePath=${path.join(dataDirPath, 'toy.judgmentCache.sqlite3')}`,
		`--matchForensicsDirPath=${matchForensicsDirPath}`,
		'--embeddingCacheFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3',
		'--rebridge=toy',
		`--subjectListFilePath=${subjectListFilePath}`,
		`</dev/null > ${buildLogsDirPath}/<line>-<phase>.log 2>&1 &`,
	].join(' ');
const baseEntry = Object.freeze({
	standardKey: 'toy',
	recipePath: path.join(dataDirPath, 'toy.recipe.jsonc'),
	storeFilePath,
	decisionStoreFilePath: path.join(dataDirPath, 'toy.decisions.sqlite3'),
	judgmentCacheFilePath: path.join(dataDirPath, 'toy.judgmentCache.sqlite3'),
	matchForensicsDirPath,
	buildLogsDirPath,
	expectedBaseBlockIdBySubject: { toy: BASE_BLOCK_ID },
	spendAuthorisationByLine: { rejudgeRealLimit: null, materialiseReal: null, [LINE_NAME]: { sessionName: 'TEST_SESSION', date: '2026-09-29', note: 'runner double' } },
	[LINE_NAME]: committedLineFor(subjectStableIdFilePath),
	[MAX_FIELD_NAME]: 3,
	namedSetFilePath,
	namedSetSha256: namedSetSpendGuardLib.sha256HexOf(namedSetFileText),
	namedSetSubjectStableIdFilePath: subjectStableIdFilePath,
	namedSetSubjectStableIdPrefix: PREFIX,
});
const writeAcceptanceFile = (entry) => fs.writeFileSync(path.join(acceptanceDirPath, 'acceptanceCommands.jsonc'), JSON.stringify({ toyBridge: entry }, null, 2));
const withEntry = (changes) => ({ ...baseEntry, ...changes });

const gitIn = (argumentList) => spawnSync('git', argumentList, { cwd: treeRoot, encoding: 'utf8' });
writeAcceptanceFile(baseEntry);
gitIn(['init', '-q']);
gitIn(['add', '-A']);
gitIn(['-c', 'user.email=b5@double.invalid', '-c', 'user.name=b5double', 'commit', '-q', '-m', 'runner double']);
harness.ok('the scratch tree is a git repository with a HEAD (the runner records it at launch)', /^[0-9a-f]{40}$/.test(gitIn(['rev-parse', 'HEAD']).stdout.trim()));

// ---------------------------------------------------------------------
// running the runner
// ---------------------------------------------------------------------
const runnerFilePath = path.join(runnerDirPath, 'runBridgeAcceptanceCommand.js');
const runRunner = (phaseToken, extraArgumentList) => {
	const result = spawnSync('node', [runnerFilePath, '--bridgeName=toyBridge', `--line=${LINE_NAME}`, `--phaseToken=${phaseToken}`].concat(extraArgumentList || []), { cwd: treeRoot, encoding: 'utf8', env: { ...process.env, PATH: `/usr/local/bin:${process.env.PATH}` } });
	return { exitCode: result.status, outputText: `${result.stdout}${result.stderr}` };
};
const artefactPathListFor = (phaseToken) => ['log', 'pid', 'provenance.json'].map((oneSuffix) => path.join(buildLogsDirPath, `${LINE_NAME}-${phaseToken}.${oneSuffix}`));
const noArtefactsFor = (phaseToken) => artefactPathListFor(phaseToken).every((oneFilePath) => !fs.existsSync(oneFilePath));
const waitForDouble = (phaseToken) => {
	const logFilePath = path.join(buildLogsDirPath, `${LINE_NAME}-${phaseToken}.log`);
	const isDone = () => fs.existsSync(logFilePath) && /DOUBLE DONE/.test(fs.readFileSync(logFilePath, 'utf8'));
	for (let attemptCount = 0; attemptCount < 100 && !isDone(); attemptCount += 1) {
		spawnSync('sleep', ['0.1']);
	}
	return isDone();
};

// a refused launch: exit 1, the refusal names its check, and NOTHING was written for that phase token
const assertRefusedBeforeLaunch = ({ label, entry, phaseToken, expectedPattern }) => {
	writeAcceptanceFile(entry);
	const run = runRunner(phaseToken);
	harness.ok(`${label}: the runner exits 1 with the refusal naming its check (${expectedPattern})`, run.exitCode === 1 && expectedPattern.test(run.outputText), run.outputText.slice(-600));
	harness.ok(`${label}: refused BEFORE LAUNCH — no log, no PID file, no provenance sidecar for '${phaseToken}'`, noArtefactsFor(phaseToken));
	writeAcceptanceFile(baseEntry);
};

// ---------------------------------------------------------------------
// the permitted run, and -verify
// ---------------------------------------------------------------------
const firstLaunch = runRunner('run1');
harness.ok('PERMITTED — the authorised, sha-matching, in-max named set launches (exit 0)', firstLaunch.exitCode === 0, firstLaunch.outputText.slice(-600));
harness.ok('the double finished and wrote its log', waitForDouble('run1'));
const firstProvenance = JSON.parse(fs.readFileSync(artefactPathListFor('run1')[2], 'utf8'));
harness.ok('the provenance sidecar records the named set and its sha, and an empty launch snapshot (no forensic file existed yet)', firstProvenance.namedSetSha256 === baseEntry.namedSetSha256 && firstProvenance.namedSetFilePath === namedSetFilePath && JSON.stringify(firstProvenance.forensicByteSizeAtLaunchByPath) === '{}' && firstProvenance.spendsOnTheRealJudge === true, JSON.stringify(firstProvenance));
harness.ok('the build was handed the entry\'s STABLEID file as --subjectListFilePath (3 subjects)', fs.readFileSync(artefactPathListFor('run1')[0], 'utf8').indexOf(`handed subjectListFilePath=${subjectStableIdFilePath} (3 subjects)`) !== -1);
const firstVerify = runRunner('run1', ['-verify']);
harness.ok('(f) -verify prints judged, re-asks and max SIDE BY SIDE: "judged 2 · re-asks 1 · max 3", and exits 0', firstVerify.exitCode === 0 && firstVerify.outputText.indexOf('judged 2 · re-asks 1 · max 3') !== -1, firstVerify.outputText.slice(-900));

// a second run of the same set appends to the same forensic file; its report must count only its own records
const secondLaunch = runRunner('run2');
harness.ok('a second run of the same named set launches', secondLaunch.exitCode === 0 && waitForDouble('run2'), secondLaunch.outputText.slice(-400));
const secondProvenance = JSON.parse(fs.readFileSync(artefactPathListFor('run2')[2], 'utf8'));
const snapshotSizeList = Object.values(secondProvenance.forensicByteSizeAtLaunchByPath);
harness.ok("the second launch snapshot records the first run's forensic file at its size then", snapshotSizeList.length === 1 && snapshotSizeList[0] > 0, JSON.stringify(secondProvenance.forensicByteSizeAtLaunchByPath));
const secondVerify = runRunner('run2', ['-verify']);
harness.ok("(f) the second run's -verify counts ONLY its own records: judged 2 · re-asks 1 · max 3 (not 4 and 2)", secondVerify.exitCode === 0 && secondVerify.outputText.indexOf('judged 2 · re-asks 1 · max 3') !== -1, secondVerify.outputText.slice(-900));
// twin: forget the launch offset and the earlier run's records are counted, and the log cross-check refuses
const provenanceFilePath = artefactPathListFor('run2')[2];
fs.writeFileSync(provenanceFilePath, JSON.stringify({ ...secondProvenance, forensicByteSizeAtLaunchByPath: {} }));
const offsetForgottenVerify = runRunner('run2', ['-verify']);
harness.ok('(f) RED-OBSERVED — with the launch offset erased, -verify reads re-asks 2 and FAILS by name: the forensic slice does not describe this run', offsetForgottenVerify.exitCode === 1 && offsetForgottenVerify.outputText.indexOf('judged 4 · re-asks 2 · max 3') !== -1 && /does not describe this run/.test(offsetForgottenVerify.outputText), offsetForgottenVerify.outputText.slice(-900));
fs.writeFileSync(provenanceFilePath, JSON.stringify(secondProvenance));

// ---------------------------------------------------------------------
// the refusals, each before launch
// ---------------------------------------------------------------------
// (a) one byte of the list of record altered
fs.writeFileSync(namedSetFilePath, namedSetFileText.replace('q002', 'q00X'));
assertRefusedBeforeLaunch({ label: '(a) RED-OBSERVED — one byte of the list file altered', entry: baseEntry, phaseToken: 'shaTwin', expectedPattern: /NAMED SET SHA MISMATCH/ });
fs.writeFileSync(namedSetFilePath, namedSetFileText);
// (b) the max deleted
const withoutMax = Object.keys(baseEntry).filter((oneFieldName) => oneFieldName !== MAX_FIELD_NAME).reduce((soFar, oneFieldName) => ({ ...soFar, [oneFieldName]: baseEntry[oneFieldName] }), {});
assertRefusedBeforeLaunch({ label: `(b) RED-OBSERVED — ${MAX_FIELD_NAME} deleted`, entry: withoutMax, phaseToken: 'maxTwin', expectedPattern: new RegExp(`declares no ${MAX_FIELD_NAME}`) });
// (c) withheld, then undeclared
assertRefusedBeforeLaunch({ label: '(c) RED-OBSERVED — authorisation null', entry: withEntry({ spendAuthorisationByLine: { rejudgeRealLimit: null, materialiseReal: null, [LINE_NAME]: null } }), phaseToken: 'withheldTwin', expectedPattern: /WITHHELD/ });
assertRefusedBeforeLaunch({ label: '(c) RED-OBSERVED — authorisation absent', entry: withEntry({ spendAuthorisationByLine: { rejudgeRealLimit: null, materialiseReal: null } }), phaseToken: 'undeclaredTwin', expectedPattern: /UNDECLARED/ });
// (d) max one below the list length
assertRefusedBeforeLaunch({ label: '(d) RED-OBSERVED — max set one below the list length', entry: withEntry({ [MAX_FIELD_NAME]: QUESTION_ID_LIST.length - 1 }), phaseToken: 'lengthTwin', expectedPattern: /NAMED SET LONGER THAN ITS MAX/ });
// the stableId file drifts from the pinned list
fs.writeFileSync(subjectStableIdFilePath, JSON.stringify([`${PREFIX}q001`, `${PREFIX}q002`]));
assertRefusedBeforeLaunch({ label: '(stableId) RED-OBSERVED — the stableId file drops one id', entry: baseEntry, phaseToken: 'stableIdTwin', expectedPattern: /NAMED SET STABLEID FILE DISAGREES WITH THE LIST OF RECORD/ });
fs.writeFileSync(subjectStableIdFilePath, JSON.stringify(QUESTION_ID_LIST.map((oneQuestionId) => `${PREFIX}${oneQuestionId}`)));
// the committed line handing the build a different file than the entry declares
assertRefusedBeforeLaunch({ label: '(tamper) RED-OBSERVED — the committed line names a different --subjectListFilePath than the entry', entry: withEntry({ [LINE_NAME]: committedLineFor(path.join(dataDirPath, 'someOtherList.json')) }), phaseToken: 'tamperTwin', expectedPattern: /differs from the committed frozen/ });

// and after all of that the permitted world still launches, so no refusal above was the world being broken
const finalLaunch = runRunner('run3');
harness.ok('the restored world launches again (every refusal above was its own change, not a broken fixture)', finalLaunch.exitCode === 0 && waitForDouble('run3'), finalLaunch.outputText.slice(-400));

fs.rmSync(scratchRoot, { recursive: true, force: true });
harness.report();
