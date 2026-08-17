#!/usr/bin/env node
'use strict';

// runBridgeAcceptanceCommand.js — the BRIDGE acceptance RUNNER (SPEC-bridgeFramework-v1.md §7.4 "the frozen command",
// §12 BG-ACCEPT; RULINGS R1, 12:05 #3; the B3 freeze ruling Q3): runs ONE frozen line from
// lib/bridge-framework/test/acceptance/acceptanceCommands.jsonc for a bridgeName (rejudgeDebug | materialise |
// materialiseReal) and a phase token, EXACTLY as committed (the runner reproduces the committed line token for token
// and refuses on drift), nohup-detached with its PID and log; and, with -verify, reads that log back and asserts the
// COMMAND'S CONTRACT: every base block the run reused or re-forged carries the id the acceptance file pins
// (expectedBaseBlockIdBySubject — RULING Q3: reuse with the pinned store is accepted ONLY on this assertion), and
// reports the decision block id, the manifest id, the container and the bolt url the log names. Mirrors
// lib/forge-framework/test/acceptance/runAcceptanceCommand.js.
//
// The spending lines (materialiseReal, rejudgeRealLimit) put the REAL judge to work: the runner REFUSES a spending
// line by name unless the acceptance file records an authorisation FOR THAT LINE under spendAuthorisationByLine
// (the supervisor's authorisation, as data, per line — RULING B4R-2). The rule itself is spendAuthorisationGuard.js.
//
// Run (from anywhere):
//   node apps/graph-builder/test/bridgeAcceptance/runBridgeAcceptanceCommand.js --bridgeName=edfiCedsCrosswalkPlugin --line=rejudgeDebug --phaseToken=cp2a
//   node apps/graph-builder/test/bridgeAcceptance/runBridgeAcceptanceCommand.js -verify --bridgeName=edfiCedsCrosswalkPlugin --line=rejudgeDebug --phaseToken=cp2a

const fs = require('fs');
const path = require('path');
const genesisGuardLib = require(path.join(__dirname, 'genesisGuard'));
const spendAuthorisationGuardLib = require(path.join(__dirname, 'spendAuthorisationGuard'));
const { spawn, spawnSync } = require('child_process');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- run (or -verify) ONE frozen bridge acceptance line with a git-provenance sidecar beside its log

SYNOPSIS
     ${moduleName} --bridgeName=<plugin> --line=<rejudgeDebug|materialise|materialiseReal> --phaseToken=<token>
     ${moduleName} -verify --bridgeName=<plugin> --line=<line> --phaseToken=<token>

DESCRIPTION
     Reads lib/bridge-framework/test/acceptance/acceptanceCommands.jsonc, substitutes <line>/<phase>, asserts the
     runner's line EQUALS the committed one, writes <buildLogsDirPath>/<line>-<phase>.provenance.json (git HEAD, dirty
     list, the exact command line, start time, PID), launches the build nohup-detached and returns. -verify reads the
     finished log and asserts the pinned base block ids (the command's contract), then prints the run's ids.
     A SPENDING line (materialiseReal, rejudgeRealLimit) is REFUSED unless spendAuthorisationByLine records an
     authorisation object under THAT LINE'S OWN NAME. A line whose name is null is refused as WITHHELD; a line
     whose name is absent is refused as UNDECLARED; the retired flat materialiseRealSpendAuthorisedBy field is
     itself refused by name, because a field that reads as authorisation and grants nothing is worse than none.

EXIT
     0 launched / verified;  1 refused by name / verification failed.
`;

const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const { xLog } = process.global;
const verifyLogContractLib = require('./verifyLogContract');

const ACCEPTANCE_FILE_PATH = path.join(__dirname, '..', '..', '..', '..', 'lib', 'bridge-framework', 'test', 'acceptance', 'acceptanceCommands.jsonc');
const EXPECTED_IDS_FILE_PATH = path.join(__dirname, '..', '..', '..', '..', 'lib', 'bridge-framework', 'test', 'acceptance', 'expectedDecisionBlockIds.json');
// rejudgeRealLimit added for D3 (RULING §11.12): the real judge over a WINDOW of source elements, released one
// batch at a time by the supervisor. It is a SPENDING line like materialiseReal, and BOTH are listed here so the
// gate knows both names — a spending line that slipped past the gate because the gate knew only one line's name is
// precisely the kind of omission that costs money once and is obvious afterwards.
//
// BUT MEMBERSHIP OF THIS LIST IS NOT AUTHORISATION, and conflating the two was DEFECT D-2. This list answers "does
// this line spend?"; spendAuthorisationByLine on the entry answers "has THIS line been released?" — separately, per
// line, as data (RULING B4R-2). The two questions have different answers for the same bridge at the same moment:
// SIF's rejudgeRealLimit is released and its materialiseReal is HELD by TQ.
// eyeGraph — the FULL four-standard + hub graph carrying the derived bridge, built for a human to look at.
// It carries NO --rebridge, so it REPLAYS the frozen block and calls the judge ZERO times; that is why it is
// deliberately absent from SPENDING_LINE_NAME_LIST and declares no maxJudgmentCount.
const LINE_NAME_LIST = Object.freeze(['rejudgeDebug', 'materialise', 'materialiseReal', 'rejudgeRealLimit', 'eyeGraph']);
const SPENDING_LINE_NAME_LIST = Object.freeze(['materialiseReal', 'rejudgeRealLimit']);

const stripJsoncComments = (text) => text.replace(/^\s*\/\/.*$/gm, '');
const acceptanceCommands = JSON.parse(stripJsoncComments(fs.readFileSync(ACCEPTANCE_FILE_PATH, 'utf8')));

const refuse = (what) => {
	xLog.error(`${moduleName} REFUSED: ${what}`);
	process.exit(1);
};
const firstValue = (name) => (commandLineParameters.values[name] && commandLineParameters.values[name][0]) || undefined;

// A BRIDGE ENTRY IS ONE CARRYING standardKey. acceptanceCommands.jsonc also holds shared, non-bridge declarations
// (sharedToolPaths, added under RULING B4R-4), so listing every top-level name as a valid --bridgeName would offer
// the caller something that is not a bridge and then fail further down for an unrelated-looking reason. The filter
// is the same one test-runnerContract.js uses, deliberately: one definition of "is a bridge entry", not two.
const bridgeNameList = Object.keys(acceptanceCommands).filter((oneName) => acceptanceCommands[oneName] && typeof acceptanceCommands[oneName] === 'object' && typeof acceptanceCommands[oneName].standardKey === 'string');
const bridgeName = firstValue('bridgeName');
if (bridgeNameList.indexOf(bridgeName) === -1) {
	refuse(`--bridgeName must be one of ${bridgeNameList.join(', ')} (got ${JSON.stringify(bridgeName)})`);
}
const entry = acceptanceCommands[bridgeName];
const lineName = firstValue('line');
if (LINE_NAME_LIST.indexOf(lineName) === -1) {
	refuse(`--line must be one of ${LINE_NAME_LIST.join(', ')} (got ${JSON.stringify(lineName)})`);
}
if (typeof entry[lineName] !== 'string' || entry[lineName].length === 0) {
	refuse(`acceptanceCommands.jsonc has no frozen '${lineName}' line for ${bridgeName} (null-and-honest until the builder freezes it)`);
}
const phaseToken = firstValue('phaseToken');
if (typeof phaseToken !== 'string' || !/^[A-Za-z0-9_-]+$/.test(phaseToken)) {
	refuse(`--phaseToken must be a token of [A-Za-z0-9_-] (got ${JSON.stringify(phaseToken)})`);
}
// THE SPEND GATE, PER LINE (RULING B4R-2, SABLE_RIVER 2026-08-17, on DEFECT D-2 of the B4 adversarial review).
//
// What stood here gated BOTH spending lines on the presence of ONE field, `materialiseRealSpendAuthorisedBy`. The
// comment above SPENDING_LINE_NAME_LIST names the hazard exactly — "a spending line that slipped past the gate
// because the gate knew only one line's name is precisely the kind of omission that costs money once" — and then
// fixed the wrong half of it: it widened the LINES covered and left the AUTHORISATION undifferentiated. So SIF's
// authorisation, written by the supervisor to release a ten-subject conformance batch and saying so in its own
// prose, also opened `materialiseReal` — the full real run over all 327 judged subjects — because the runner reads
// fields, not prose. TQ's standing directive of 00:46 CDT was enforced by a note.
//
// Now the authorisation is DECLARED PER LINE and the rule lives in spendAuthorisationGuard.js, so the twins in
// test-runnerContract.js exercise the very function called here rather than a copy of it: this file is a CLI that
// exits on refusal, so a suite requiring it would run it (the BS-5 / genesisGuard.js precedent).
const spendRefusal = spendAuthorisationGuardLib.spendRefusalFor({ entry, lineName, spendingLineNameList: SPENDING_LINE_NAME_LIST, bridgeName });
if (spendRefusal) {
	refuse(spendRefusal);
}
// the authorisation that PERMITTED this line, carried to the launch line and the provenance sidecar below, so a run
// that spent real money records WHO released THAT LINE beside the command — rather than leaving a later reader to
// infer it from whatever state the acceptance file happens to be in by then
const spendAuthorisation = spendAuthorisationGuardLib.authorisationFor({ entry, lineName });

// EVERY LINE DECLARES ITS OWN JUDGMENT CEILING (RULING §11.12). The runner refuses a line that declares none:
// the framework's own default ceiling is 20,000, which for a run whose true size is ~700 is not a cap in any
// meaningful sense, and the re-ask hazard can double a call count silently. An UNDECLARED ceiling is the
// failure mode this refusal exists for — a number nobody chose.
//
// HONEST LIMIT, and it is written here rather than in a report nobody reads: this refusal enforces that the
// number was DECLARED, not that it is OBEYED inside the run. Injecting it would need a --maxJudgmentCount
// flag, build.js owns flag parsing, and build.js is a seam file this order may not touch. Raised to the
// supervisor 2026-08-17. RULED (DR-6, 2026-08-17): maxJudgmentCount IS A BOUNDARY CHECK, NOT A CEILING. It
// asserts that a human chose a number and wrote it down before a line could run; it does NOT cap the run, and
// nothing here can make it cap the run while build.js owns flag parsing. D4's actual protection was the
// spend-authorisation gate and the run's natural size, not this number. Read it as an attestation.
//
// It also bounds JUDGMENTS, NOT DOLLARS — rejudgeDebug declares 500 and 4000 because it really does make that
// many judgments, against a free judge. A line that asks no judge at all declares 0 (test-runnerContract (c)).
const declaredMaxJudgmentCount = entry[`${lineName}MaxJudgmentCount`];
if (!Number.isInteger(declaredMaxJudgmentCount) || declaredMaxJudgmentCount < 0) {
	refuse(`the ${lineName} line for ${bridgeName} declares no ${lineName}MaxJudgmentCount (got ${JSON.stringify(declaredMaxJudgmentCount)}) — every line declares its own judgment ceiling as data; there is no default (RULING §11.12)`);
}

// <n> is the BATCH OFFSET for the windowed real-judge line. It is substituted from --offset and the line is
// REFUSED if the placeholder survives: running `--offset=<n>` literally would either fail obscurely or, worse,
// be silently parsed as something else — and this is the one line in the system that spends real money.
const offsetValue = firstValue('offset');
const committedLineRaw = entry[lineName].replace(/<line>/g, lineName).replace(/<phase>/g, phaseToken);
if (committedLineRaw.indexOf('<n>') !== -1 && (offsetValue === undefined || !/^\d+$/.test(String(offsetValue)))) {
	refuse(`the ${lineName} line for ${bridgeName} carries the batch placeholder <n> and --offset=<non-negative integer> was not supplied (got ${JSON.stringify(offsetValue)}) — a windowed spending line names its window explicitly; there is no default batch`);
}
const committedLine = committedLineRaw.replace(/<n>/g, String(offsetValue));
if (committedLine.indexOf('<') !== -1 && /<[a-z]+>/.test(committedLine)) {
	refuse(`the composed ${lineName} line still carries an unsubstituted placeholder: ${committedLine.match(/<[a-z]+>/)[0]} — a spending line runs only when every token is resolved`);
}
const buildLogPath = path.join(entry.buildLogsDirPath, `${lineName}-${phaseToken}.log`);
const treeRoot = path.join(__dirname, '..', '..', '..', '..');

// the runner's own composition of the line, asserted EQUAL to the committed text (data over drift)
if (typeof entry.standardKey !== 'string' || entry.standardKey.length === 0) {
	refuse(`acceptanceCommands.jsonc entry for ${bridgeName} carries no standardKey (the --rebridge scope token) — declare it as data`);
}
// THE BATCH SIZE IS RULED, not a knob, and it STAYS IN THE RUNNER for the reason it was put here: this is the
// runner's INDEPENDENT reconstruction of the line, so a committed line claiming a different --limit fails the
// equality check below rather than quietly running a bigger batch than the supervisor released. Reading it out
// of acceptanceCommands.jsonc would destroy exactly that independence — the file being checked would supply
// the number it is checked against — so it is NOT declared data, unlike almost everything else in this order.
//
// IT IS NOW PER BRIDGE (RULING BS-9, SABLE_RIVER 2026-08-17), because the number is not the same QUANTITY for
// every plugin and a single constant silently mis-states one of them:
//   edfiCedsDerivedPlugin — 10 means TEN JUDGED SUBJECTS. That plugin judges nearly everything it walks, so
//                           the window size and the judgment count are the same number (RULING §11.12).
//   sifCedsStandardPlugin — 70 means SEVENTY SOURCE ELEMENTS, which yield about TEN JUDGED. SIF judges only
//                           327 of 2,231 (14.7%); the rest resolve as specified without a judge. The window
//                           counts source elements, so --limit=10 here bought ONE judgment and no conformance
//                           evidence at all.
// Enlarging a released batch therefore still requires editing THIS FILE — a visible, reviewable act — and a
// plugin with no row is REFUSED BY NAME rather than defaulted, because a batch size nobody chose is precisely
// what this guard exists to prevent.
//   pescCedsDerivedPlugin — 10 means TEN JUDGED SUBJECTS, the same quantity as edfiCedsDerivedPlugin and NOT
//                           the SIF quantity. The reason is mechanical rather than incidental: this plugin
//                           declares a `scopeStableIdListPath` of 2,213 subjects, and [code fact] --limit is
//                           APPLIED AFTER the standard-specific scope (help.js --limit/--offset, with the SIF
//                           sifObjectScope worked example). So the window selects ten of the 2,213 SCOPED
//                           subjects, not ten of the 17,491 nodes carrying the label.
//                           MEASURED, not reasoned: over the exact ten subjects this window selects (sorted by
//                           subject key, so the window is deterministic), the debug census block records TEN
//                           reaching a judge and ZERO orphans — predicted real judge calls, 10.
//                           forges/pesc260805/test/probes/p3_batchSizingArithmetic.js states and retains the
//                           arithmetic. The careful-looking error it avoids: dividing by the scope share
//                           (2,213/17,491) gives ~79 and would have oversized the batch roughly EIGHTFOLD.
const D3_BATCH_SIZE_BY_BRIDGE_NAME = Object.freeze({
	edfiCedsDerivedPlugin: 10,
	sifCedsStandardPlugin: 70,
	pescCedsDerivedPlugin: 10,
});
const releasedBatchSize = D3_BATCH_SIZE_BY_BRIDGE_NAME[bridgeName];
if (lineName === 'rejudgeRealLimit' && !Number.isInteger(releasedBatchSize)) {
	refuse(`'${bridgeName}' has no released batch size in this runner's D3_BATCH_SIZE_BY_BRIDGE_NAME — the window a supervisor released is reconstructed HERE, independently of the acceptance file, and is never defaulted; add the row deliberately (RULING BS-9)`);
}
const lineSpecificArgumentList = {
	rejudgeDebug: [`--rebridge=${entry.standardKey}`, '--useDebugJudge=digest'],
	materialise: [],
	materialiseReal: [`--rebridge=${entry.standardKey}`],
	rejudgeRealLimit: [`--rebridge=${entry.standardKey}`, `--limit=${releasedBatchSize}`, `--offset=${offsetValue}`],
	// eyeGraph adds NOTHING beyond the pinned set: no --rebridge, no --useDebugJudge. It replays the frozen
	// block, which is exactly why its declared ceiling is 0.
	eyeGraph: [],
};
// A line name with no reconstruction row would `.concat(undefined)` and append the literal string "undefined"
// to the command — producing a malformed line that the equality check would reject for the WRONG reason, or
// worse, that a future edit to the check might let through. Refuse by name instead.
if (!Array.isArray(lineSpecificArgumentList[lineName])) {
	refuse(`the runner has no argument reconstruction for line '${lineName}' — every runnable line must be independently reconstructible, because that reconstruction IS the check that the committed line was not tampered with`);
}
// A line may build a DIFFERENT recipe from the bridge's default — the eye graph is the four-standard + hub
// assembly, not the two-standard eval. The override is DECLARED DATA in the same committed file, so the
// reconstruction still proves the committed line was not tampered with: it checks the line against the
// declared recipe rather than against whatever recipe the line happens to name.
const perLineRecipePath = entry[`${lineName}RecipePath`];
if (perLineRecipePath !== undefined && (typeof perLineRecipePath !== 'string' || perLineRecipePath === '')) {
	refuse(`${lineName}RecipePath is declared but is not a path (${JSON.stringify(perLineRecipePath)}) — a per-line recipe override is data or it is absent; there is no default`);
}
const lineRecipePath = perLineRecipePath === undefined ? entry.recipePath : perLineRecipePath;
const nodeArgumentList = [
	'--max-old-space-size=20000',
	path.join(treeRoot, 'apps', 'graph-builder', 'graphBuilder.js'),
	'-build',
	`--recipePath=${lineRecipePath}`,
	'--vectorize=true',
	'--reuseForgedBlocks=true',
	`--standardsDatabaseFilePath=${entry.storeFilePath}`,
	`--decisionStoreFilePath=${entry.decisionStoreFilePath}`,
	`--judgmentCacheFilePath=${entry.judgmentCacheFilePath}`,
	`--matchForensicsDirPath=${entry.matchForensicsDirPath}`,
	'--embeddingCacheFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3',
].concat(lineSpecificArgumentList[lineName]);
const runnerLine = `node ${nodeArgumentList.join(' ')} </dev/null > ${buildLogPath} 2>&1 &`;
if (runnerLine !== committedLine) {
	refuse(`the runner's command line differs from the committed frozen '${lineName}' line for ${bridgeName}:\n  committed: ${committedLine}\n  runner:    ${runnerLine}`);
}

// ---------------------------------------------------------------------
// -verify — read the finished log; assert the pinned base ids; report the run's ids
// ---------------------------------------------------------------------
if (commandLineParameters.switches.verify === true) {
	if (!fs.existsSync(buildLogPath)) {
		refuse(`no log at ${buildLogPath} — nothing to verify`);
	}
	const logText = fs.readFileSync(buildLogPath, 'utf8');
	const expectedIds = JSON.parse(fs.readFileSync(EXPECTED_IDS_FILE_PATH, 'utf8')).byBridgeName[bridgeName] || {};
	// RULING BR3-3 — the contract check is the PURE verifyLogContract (gated by test-bridgeAcceptanceEdfi SECTION 4):
	// buildFailed is a FAULT; an absent/empty pin table is a REFUSAL by name; the runner only reads and prints
	const checked = verifyLogContractLib.verifyLogContract({ logText, entry, lineName, expectedIds });
	if (checked.refusal) {
		refuse(checked.refusal);
	}
	const verdict = { bridgeName, lineName, phaseToken, buildLogPath, ...checked.verdict, faultList: checked.faultList };
	xLog.result(JSON.stringify(verdict, null, 2));
	if (checked.faultList.length) {
		refuse(`${checked.faultList.length} contract fault(s):\n  - ${checked.faultList.join('\n  - ')}`);
	}
	xLog.status(`${moduleName}: VERIFIED — every pinned base id reproduced (${verdict.pinnedSubjectCount} subjects); the build reported no failure${verdict.decisionBlockId ? `; decision block ${verdict.decisionBlockId.slice(0, 12)}…` : ''}`);
	process.exit(0);
}

// ---------------------------------------------------------------------
// launch — nohup-detached, PID + provenance sidecar beside the log
// ---------------------------------------------------------------------
// THE PINNED-STORE GUARD, and its ONE named exception — the GENESIS path (RULING BS-5, SABLE_RIVER
// 2026-08-17). The guard is right for every run after the first and IMPOSSIBLE for the first: a plugin phase
// ruled to FORGE FRESH has no store until its first run creates one, so the runner as written could not launch
// the most consequential run of the phase — the one that makes the store everything later is compared against.
//
// The exception is DECLARED AS DATA on the line (`<lineName>Genesis: true`, the same per-line convention as
// `<lineName>MaxJudgmentCount`), never inferred, and it is permitted ONLY when all of these hold:
//   - the line is a `rejudge*` line — a materialise line REPLAYS a frozen block and can have nothing to replay
//     from on a store that does not exist, so genesis there is a contradiction and is refused BY NAME;
//   - the directory that will hold the pinned store EXISTS — this is what separates "the first run of a real,
//     prepared location" from "a typo in an absolute path", which is the failure the original guard exists to
//     catch (a scratch DB read as 'no decision block', mimicking a replay defect);
//   - the store file itself does NOT exist. Once it does, THE DECLARATION IS INERT and the ordinary guard
//     governs every subsequent run — genesis cannot be left switched on as a standing bypass.
// the RULE ITSELF lives in genesisGuard.js so a twin can exercise the very function this line calls, rather
// than a copy of it — this file is a CLI that exits on refusal, so requiring it from a suite would run it
const storeDirPath = path.dirname(entry.decisionStoreFilePath);
const storeExists = fs.existsSync(entry.storeFilePath);
const genesisRefusal = genesisGuardLib.genesisRefusalFor({ entry, lineName, storeExists, storeDirPathExists: fs.existsSync(storeDirPath), storeFilePath: entry.storeFilePath, storeDirPath });
if (genesisRefusal) {
	refuse(genesisRefusal);
}
if (genesisGuardLib.isGenesisLaunch({ entry, lineName, storeExists })) {
	xLog.status(`${moduleName}: GENESIS run — the pinned store '${entry.storeFilePath}' does not exist yet and '${lineName}Genesis' declares this the run that CREATES it (RULING BS-5). Every later run is governed by the ordinary pinned-store guard, and the declaration is inert once the store is there.`);
}
if (fs.existsSync(buildLogPath)) {
	refuse(`'${buildLogPath}' already exists — a frozen run never overwrites a recorded log; choose another phaseToken`);
}
const gitOutput = (argumentList) => {
	const result = spawnSync('git', argumentList, { cwd: treeRoot, encoding: 'utf8' });
	if (result.status !== 0) {
		refuse(`git ${argumentList.join(' ')} failed in ${treeRoot}: ${(result.stderr || '').trim()}`);
	}
	return result.stdout.trim();
};
const gitHead = gitOutput(['rev-parse', 'HEAD']);
const gitDirtyFileList = gitOutput(['status', '--porcelain']).split('\n').filter((oneLine) => oneLine.length > 0);
fs.mkdirSync(entry.buildLogsDirPath, { recursive: true });
const startedAt = new Date().toISOString();
const child = spawn('node', nodeArgumentList, { cwd: treeRoot, detached: true, stdio: ['ignore', fs.openSync(buildLogPath, 'a'), fs.openSync(buildLogPath, 'a')] });
child.unref();
fs.writeFileSync(path.join(entry.buildLogsDirPath, `${lineName}-${phaseToken}.pid`), `${child.pid}\n`);
// spendAuthorisation is recorded in the sidecar for the SPENDING lines only, and it is recorded as the OBJECT the
// guard actually read rather than as a boolean: a run that cost real money should carry, beside its command line,
// the name of whoever released THAT LINE and the note they released it under. `null` for a non-spending line is the
// honest value — it asked no real judge and needed no release (RULING B4R-2).
fs.writeFileSync(path.join(entry.buildLogsDirPath, `${lineName}-${phaseToken}.provenance.json`), JSON.stringify({ bridgeName, lineName, phaseToken, gitHead, gitDirty: gitDirtyFileList.length > 0, gitDirtyFileList, commandLine: committedLine, startedAt, pid: child.pid, buildLogPath, spendsOnTheRealJudge: SPENDING_LINE_NAME_LIST.indexOf(lineName) !== -1, spendAuthorisation: spendAuthorisation === undefined ? null : spendAuthorisation }, null, 2) + '\n');
if (spendAuthorisation !== undefined) {
	xLog.status(`${moduleName}: this is a SPENDING line, released for '${lineName}' specifically by ${spendAuthorisation.sessionName}${spendAuthorisation.date ? ` on ${spendAuthorisation.date}` : ''} (RULING B4R-2 — per-line authorisation; the release for one spending line is not a release for the other)`);
}
xLog.status(`${moduleName}: launched ${bridgeName} ${lineName} (${phaseToken}) pid ${child.pid} at HEAD ${gitHead.slice(0, 7)}${gitDirtyFileList.length ? ` (DIRTY: ${gitDirtyFileList.length} file(s))` : ''} → ${buildLogPath}`);
process.exit(0);
