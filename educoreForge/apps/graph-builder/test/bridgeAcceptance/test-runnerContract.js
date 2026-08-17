#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// test-runnerContract.js — F-H1 (adversarial review D4, 2026-08-17, DR-2/DR-13).
//
// The reviewer measured that `eyeGraphMaxJudgmentCount`, `eyeGraphRecipePath` and the eyeGraph tamper-check
// reconstruction had NO TEST ANYWHERE — one grep hit, the implementation itself. That is literally true and
// slightly worse than it sounds: the runner builds those key names by INTERPOLATION (`${lineName}RecipePath`),
// so the literal strings appear only in the committed .jsonc and a reader grepping for them finds nothing that
// looks like coverage.
//
// WHAT THIS FILE ASSERTS, and why each one is here rather than being obvious:
//
//   (a) EVERY runnable line declares its own judgment ceiling. Not just the spending ones — RULING §11.12 says
//       every line, without qualification, and I assumed otherwise while adding eyeGraph and the runner
//       refused me. This is a DATA-COMPLETENESS gate: it catches the NEXT line someone adds, before that
//       person spends a real batch discovering it.
//   (b) EVERY runnable line has an argument reconstruction row. A line without one would `.concat(undefined)`
//       and append the literal string "undefined" to the command, which the equality check would then reject
//       for the WRONG reason.
//   (c) A NON-SPENDING line declares a ceiling of ZERO. A replay line that claims a positive ceiling is
//       claiming it might spend; the ceiling is the guard, and a guard set above the thing it guards is
//       decoration.
//   (d) The per-line recipe override, where declared, NAMES A FILE THAT EXISTS. The override exists so the
//       tamper check can compare a committed line against a DECLARED recipe instead of assuming one recipe per
//       bridge; an override pointing at nothing would make the check pass against a fiction.
//
// It reads the committed acceptance file and the runner's own source. It launches nothing, spends nothing,
// opens no graph and starts no container.

const helpText = () => `
NAME
     ${moduleName} -- F-H1: the runner's per-line declarations are complete and honest

SYNOPSIS
     ${moduleName}

EXIT STATUS
     0 all assertions pass;  1 otherwise.
`;
require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const path = require('path');
const harness = require('../../../../test/testLib/harness')(moduleName);

const ACCEPTANCE_FILE_PATH = path.join(__dirname, '..', '..', '..', '..', 'lib', 'bridge-framework', 'test', 'acceptance', 'acceptanceCommands.jsonc');
const RUNNER_FILE_PATH = path.join(__dirname, 'runBridgeAcceptanceCommand.js');

const acceptanceText = fs.readFileSync(ACCEPTANCE_FILE_PATH, 'utf8').replace(/^\s*\/\/.*$/gm, '');
const acceptanceCommands = JSON.parse(acceptanceText);
const runnerText = fs.readFileSync(RUNNER_FILE_PATH, 'utf8');

// the runner's own lists, read from its source rather than restated here — a restatement would drift and this
// file would then be testing its own copy instead of the runner
const listOf = (constantName) => {
	const matched = new RegExp(`const ${constantName} = Object\\.freeze\\(\\[([^\\]]*)\\]\\)`).exec(runnerText);
	return matched === null ? null : matched[1].split(',').map((oneEntry) => oneEntry.trim().replace(/^'|'$/g, '')).filter((oneEntry) => oneEntry !== '');
};
const lineNameList = listOf('LINE_NAME_LIST');
const spendingLineNameList = listOf('SPENDING_LINE_NAME_LIST');
const reconstructionText = /const lineSpecificArgumentList = \{([\s\S]*?)\n\};/.exec(runnerText);

harness.ok(`LINE_NAME_LIST read from the runner (${lineNameList ? lineNameList.join(', ') : 'NOT FOUND'})`, Array.isArray(lineNameList) && lineNameList.length > 0);
harness.ok(`SPENDING_LINE_NAME_LIST read from the runner (${spendingLineNameList ? spendingLineNameList.join(', ') : 'NOT FOUND'})`, Array.isArray(spendingLineNameList));
harness.ok('lineSpecificArgumentList read from the runner', reconstructionText !== null);

const bridgeNameList = Object.keys(acceptanceCommands).filter((oneName) => acceptanceCommands[oneName] && typeof acceptanceCommands[oneName] === 'object' && typeof acceptanceCommands[oneName].standardKey === 'string');

lineNameList.forEach((oneLineName) => {
	// (b) — a reconstruction row for every runnable line
	harness.ok(`(b) line '${oneLineName}' has an argument reconstruction row`, new RegExp(`(^|\\n)\\s*${oneLineName}:`).test(reconstructionText[1]));

	bridgeNameList.forEach((oneBridgeName) => {
		const entry = acceptanceCommands[oneBridgeName];
		if (typeof entry[oneLineName] !== 'string') {
			return; // this bridge does not offer this line at all, which is lawful
		}
		const declaredCeiling = entry[`${oneLineName}MaxJudgmentCount`];
		// (a) — every offered line declares a ceiling, spending or not
		harness.ok(`(a) ${oneBridgeName}.${oneLineName} declares ${oneLineName}MaxJudgmentCount (got ${JSON.stringify(declaredCeiling)})`, Number.isInteger(declaredCeiling) && declaredCeiling >= 0);

		// (c) — a line that makes NO JUDGMENTS AT ALL declares a ceiling of zero.
		//
		// ⟪THIS TEST CORRECTED ME TWICE, and DR-6 is the reason⟫ maxJudgmentCount bounds JUDGMENTS, not DOLLARS.
		// My first version asserted "non-spending implies no --rebridge" and rejudgeDebug refuted it: it DOES
		// re-judge, with --useDebugJudge, so it costs nothing. My second asserted "non-spending implies a ceiling
		// of 0" and rejudgeDebug refuted that too — it declares 500 and 4000, because it really does make that
		// many judgments against a free judge. The honest predicate is about whether the line judges AT ALL: a
		// line carrying neither --rebridge nor --useDebugJudge replays a frozen block, asks nothing, and must
		// declare 0. That is the eyeGraph case, and a positive ceiling there would permit spend on the one line
		// whose whole premise is that it cannot.
		const judgesAtAll = /--rebridge/.test(entry[oneLineName]) || /--useDebugJudge/.test(entry[oneLineName]);
		if (!judgesAtAll) {
			harness.ok(`(c) ${oneBridgeName}.${oneLineName} asks NO judge (no --rebridge, no --useDebugJudge) and declares a ceiling of 0 (got ${JSON.stringify(declaredCeiling)})`, declaredCeiling === 0);
		}

		// (d) — a declared per-line recipe override names a file that exists, and the committed line uses it
		const perLineRecipePath = entry[`${oneLineName}RecipePath`];
		if (perLineRecipePath !== undefined) {
			harness.ok(`(d) ${oneBridgeName}.${oneLineName}RecipePath names a file that EXISTS (${perLineRecipePath})`, typeof perLineRecipePath === 'string' && fs.existsSync(perLineRecipePath));
			harness.ok(`(d) the committed ${oneBridgeName}.${oneLineName} line actually carries the declared recipe — otherwise the tamper check compares against a fiction`, entry[oneLineName].indexOf(`--recipePath=${perLineRecipePath}`) !== -1);
		}
	});
});

// ---------------------------------------------------------------------
// (e) THE PER-LINE SPEND AUTHORISATION — RULING B4R-2, on DEFECT D-2 of reviews/REVIEW-B4-sifPlugin-081726.md
// ---------------------------------------------------------------------
//
// The retired gate was a presence check on ONE field covering BOTH spending lines, so an authorisation written to
// release a ten-subject conformance batch also opened the full real run. The reviewer traced every guard between
// that line and the spawn and found nothing else in the way; TQ's standing hold of 00:46 CDT was enforced by a
// prose note the runner never read.
//
// Two kinds of assertion below, and the difference matters:
//
//   THE RULE — fed a stated world and asked what it does. These exercise the very function the runner calls
//   (spendAuthorisationGuard.js), not a copy, because the runner is a CLI that exits on refusal and cannot be
//   required from a suite. Each REFUSED case is a branch of the rule observed going red on purpose.
//
//   THE COMMITTED DATA — a completeness check over acceptanceCommands.jsonc as it actually stands. This is what
//   catches the NEXT bridge somebody adds, before that person discovers the gap by spending a real batch. It is
//   also where TQ's hold becomes a testable claim rather than a comment: SIF's materialiseReal must be WITHHELD.
const spendAuthorisationGuardLib = require('./spendAuthorisationGuard');
const spendRefusalFor = (world) => spendAuthorisationGuardLib.spendRefusalFor({ spendingLineNameList: spendingLineNameList, bridgeName: 'testBridge', ...world });

const GO_TEXT = { sessionName: 'SABLE_RIVER', date: '2026-08-17', note: 'CP3 conformance batch ONLY' };

// the world the SIF entry is actually in: the windowed batch released, the full run held
const cp3ReleasedFullRunHeld = { spendAuthorisationByLine: { rejudgeRealLimit: GO_TEXT, materialiseReal: null } };

harness.equal('(e) THE RULE — a CP3 release on rejudgeRealLimit PERMITS rejudgeRealLimit', spendRefusalFor({ entry: cp3ReleasedFullRunHeld, lineName: 'rejudgeRealLimit' }), '');
harness.ok('(e) RED-OBSERVED — THE DEFECT D-2 CASE: the SAME entry, whose rejudgeRealLimit IS released, REFUSES materialiseReal BY NAME as WITHHELD. Under the retired one-field gate this exact entry permitted it, which is the whole of D-2',
	/materialiseReal line SPENDS/.test(spendRefusalFor({ entry: cp3ReleasedFullRunHeld, lineName: 'materialiseReal' })) && /WITHHELD/.test(spendRefusalFor({ entry: cp3ReleasedFullRunHeld, lineName: 'materialiseReal' })),
	spendRefusalFor({ entry: cp3ReleasedFullRunHeld, lineName: 'materialiseReal' }));

// BOTH NULL — the state every bridge sits in before a supervisor speaks at all
const bothWithheld = { spendAuthorisationByLine: { rejudgeRealLimit: null, materialiseReal: null } };
spendingLineNameList.forEach((oneSpendingLineName) => {
	harness.ok(`(e) RED-OBSERVED — with BOTH lines null, '${oneSpendingLineName}' is REFUSED as WITHHELD`, /WITHHELD/.test(spendRefusalFor({ entry: bothWithheld, lineName: oneSpendingLineName })), spendRefusalFor({ entry: bothWithheld, lineName: oneSpendingLineName }));
});

// ABSENT is not WITHHELD, and the two refusals must say different things. Reading an absent name as a "no" would
// credit the file with a deliberation nobody performed — and it is the absent case, not the null one, that a
// newly-added bridge arrives in.
const nothingDeclaredForTheFullRun = { spendAuthorisationByLine: { rejudgeRealLimit: GO_TEXT } };
harness.ok('(e) RED-OBSERVED — an ABSENT line name is refused as UNDECLARED, not as WITHHELD (absent means nobody recorded a decision; reporting it as a decision would be a lie about the file)',
	/UNDECLARED/.test(spendRefusalFor({ entry: nothingDeclaredForTheFullRun, lineName: 'materialiseReal' })) && !/WITHHELD/.test(spendRefusalFor({ entry: nothingDeclaredForTheFullRun, lineName: 'materialiseReal' })),
	spendRefusalFor({ entry: nothingDeclaredForTheFullRun, lineName: 'materialiseReal' }));
harness.ok('(e) RED-OBSERVED — an entry with NO spendAuthorisationByLine object at all refuses every spending line by name', /declares no 'spendAuthorisationByLine'/.test(spendRefusalFor({ entry: { standardKey: 'toy' }, lineName: 'materialiseReal' })), spendRefusalFor({ entry: { standardKey: 'toy' }, lineName: 'materialiseReal' }));

// THE RETIRED FIELD IS ITSELF REFUSED, on any line. If it were merely ignored, a successor would write the
// familiar field, see no complaint, and believe a spend was authorised while the guard read past it — D-2 again,
// pointing the other way. So its presence makes the entry malformed, including for a line that spends nothing,
// because the fault is in the DECLARATION rather than in the request.
const carriesTheRetiredField = { materialiseRealSpendAuthorisedBy: GO_TEXT, spendAuthorisationByLine: { rejudgeRealLimit: GO_TEXT, materialiseReal: GO_TEXT } };
['materialiseReal', 'rejudgeRealLimit', 'materialise', 'rejudgeDebug', 'eyeGraph'].forEach((oneLineName) => {
	harness.ok(`(e) RED-OBSERVED — the RETIRED flat field makes the entry malformed and refuses '${oneLineName}', even though every per-line authorisation is present and even on a line that spends nothing`, /RETIRED field/.test(spendRefusalFor({ entry: carriesTheRetiredField, lineName: oneLineName })), spendRefusalFor({ entry: carriesTheRetiredField, lineName: oneLineName }));
});

// a malformed authorisation is refused rather than read generously — the generous reading is how money gets spent
[{ note: 'no sessionName' }, { sessionName: '' }, { sessionName: 42 }, 'SABLE_RIVER', [], true].forEach((oneMalformedAuthorisation, oneIndex) => {
	const entry = { spendAuthorisationByLine: { rejudgeRealLimit: oneMalformedAuthorisation, materialiseReal: null } };
	harness.ok(`(e) RED-OBSERVED — a malformed authorisation (#${oneIndex + 1}, ${JSON.stringify(oneMalformedAuthorisation)}) is REFUSED, never read as a release`, /is present but is not an authorisation/.test(spendRefusalFor({ entry, lineName: 'rejudgeRealLimit' })), spendRefusalFor({ entry, lineName: 'rejudgeRealLimit' }));
});

// a NON-spending line needs no authorisation, and inventing one for it would be theatre
lineNameList.filter((oneLineName) => spendingLineNameList.indexOf(oneLineName) === -1).forEach((oneLineName) => {
	harness.equal(`(e) THE RULE — '${oneLineName}' asks no real judge, so it needs no authorisation and is PERMITTED with none declared`, spendRefusalFor({ entry: { standardKey: 'toy' }, lineName: oneLineName }), '');
});

// --- THE COMMITTED DATA ---
harness.ok('(e) the runner reads the spend rule from spendAuthorisationGuard.js rather than carrying its own copy — a second implementation is a second thing to drift', /spendAuthorisationGuardLib\.spendRefusalFor\(/.test(runnerText) && !new RegExp(`entry\\.${spendAuthorisationGuardLib.RETIRED_FLAT_AUTHORISATION_FIELD_NAME}`).test(runnerText));

bridgeNameList.forEach((oneBridgeName) => {
	const entry = acceptanceCommands[oneBridgeName];
	harness.ok(`(e) ${oneBridgeName} carries NO retired '${spendAuthorisationGuardLib.RETIRED_FLAT_AUTHORISATION_FIELD_NAME}' field`, !Object.prototype.hasOwnProperty.call(entry, spendAuthorisationGuardLib.RETIRED_FLAT_AUTHORISATION_FIELD_NAME));
	const authorisationByLine = entry[spendAuthorisationGuardLib.AUTHORISATION_BY_LINE_FIELD_NAME];
	harness.ok(`(e) ${oneBridgeName} declares a '${spendAuthorisationGuardLib.AUTHORISATION_BY_LINE_FIELD_NAME}' object`, authorisationByLine !== null && typeof authorisationByLine === 'object' && !Array.isArray(authorisationByLine));
	spendingLineNameList.forEach((oneSpendingLineName) => {
		// EVERY bridge states EVERY spending line, whether or not it offers that line. This is the completeness
		// half: it is what makes "absent" a bug the suite catches rather than a silence the runner discovers.
		harness.ok(`(e) ${oneBridgeName}.${spendAuthorisationGuardLib.AUTHORISATION_BY_LINE_FIELD_NAME} states a decision for '${oneSpendingLineName}' (null = withheld is a decision; ABSENT is not)`, authorisationByLine !== null && typeof authorisationByLine === 'object' && Object.prototype.hasOwnProperty.call(authorisationByLine, oneSpendingLineName));
		// and every line the bridge actually OFFERS must agree with the guard: either the guard permits it, or the
		// refusal is the reason it does not. This asserts the committed file against the live rule, not against prose.
		if (typeof entry[oneSpendingLineName] === 'string') {
			const refusalText = spendAuthorisationGuardLib.spendRefusalFor({ entry, lineName: oneSpendingLineName, spendingLineNameList, bridgeName: oneBridgeName });
			harness.ok(`(e) ${oneBridgeName}.${oneSpendingLineName} is offered and the guard's verdict on it is ${refusalText === '' ? 'PERMITTED' : 'REFUSED'} — recorded here so a change of release state is a visible test diff`, refusalText === '' || /WITHHELD|UNDECLARED/.test(refusalText), refusalText);
		}
	});
});

// TQ'S STANDING HOLD, AS A TEST. RULINGS-supervisor-bridgeFramework.md records TQ's text of 2026-08-17 00:46 CDT
// — "do not start a full run until we talk tomorrow" — as applying to SIF and every other order. B4R-2's whole
// purpose is that the hold stops depending on anyone reading a note, so the hold gets an assertion of its own. If
// a successor releases SIF's materialiseReal, this line goes red and names the ruling it is standing on.
const sifEntry = acceptanceCommands.sifCedsStandardPlugin;
if (sifEntry) {
	harness.ok("(e) TQ'S HOLD AS DATA — sifCedsStandardPlugin.materialiseReal authorisation is NULL (CP4 / any full SIF real run remains HELD by TQ, text 2026-08-17 00:46 CDT). Releasing it is a deliberate, visible edit that reddens this assertion", sifEntry[spendAuthorisationGuardLib.AUTHORISATION_BY_LINE_FIELD_NAME] && sifEntry[spendAuthorisationGuardLib.AUTHORISATION_BY_LINE_FIELD_NAME].materialiseReal === null);
	harness.ok('(e) and SIF.rejudgeRealLimit IS released, so the gate is discriminating between the two lines rather than simply refusing everything — a gate that refuses uniformly proves nothing about per-line scope', spendAuthorisationGuardLib.spendRefusalFor({ entry: sifEntry, lineName: 'rejudgeRealLimit', spendingLineNameList, bridgeName: 'sifCedsStandardPlugin' }) === '');
}

// (f) THE TAMPER-CHECK RECONSTRUCTION STILL HOLDS. B4R-2 asks for this explicitly, because the spend edit sits a
// few lines above the reconstruction and the reconstruction is what proves a committed line was not altered. The
// runner's independent per-bridge released window must remain IN THE RUNNER: reading it out of the acceptance file
// would let the file being checked supply the number it is checked against.
harness.ok('(f) the runner still reconstructs the released batch window from its OWN per-bridge table, not from the acceptance file', /const D3_BATCH_SIZE_BY_BRIDGE_NAME = Object\.freeze\(\{/.test(runnerText) && /D3_BATCH_SIZE_BY_BRIDGE_NAME\[bridgeName\]/.test(runnerText));
harness.ok('(f) the runner still asserts its own composed line EQUALS the committed one, and refuses on drift', /if \(runnerLine !== committedLine\) \{/.test(runnerText));
harness.ok('(f) a bridge with no released-window row is still REFUSED by name rather than defaulted', /has no released batch size in this runner's D3_BATCH_SIZE_BY_BRIDGE_NAME/.test(runnerText) || /has no released batch size in this runner/.test(runnerText));

// ---------------------------------------------------------------------
// (g) WHICH SSSOM VALIDATOR RAN — RULING B4R-4 (option (c)), on FINDING B4-F9
// ---------------------------------------------------------------------
//
// The rule and its rationale live in sssomValidatorProvenance.js. The twins live HERE, and the choice is worth
// stating: BG-P7's own suite is test-bgP7.js, which sits inside expectedCompose.diffedPathList — a byte written
// there by this phase would turn BG-COMPOSE-SIF (a), the zero-framework-diff proof, RED. So the supervisor takes
// that two-line require+call at merge (ruled), and the twins go where they will actually BE RUN by anyone
// exercising the acceptance instruments. This file's own subject is "the runner's declarations are complete and
// honest", and a declared absolute tool path is exactly that kind of declaration.
//
// FINDING B4-F9 in one sentence: test-bgP7.js computed the venv path by climbing four directories, which resolves
// from the main tree and misses from a worktree, and it had NO UNMEASURED accounting — so it silently ran the proxy
// and reported 44/44 green, telling a reviewer the real validator passed when it never ran.
const sssomValidatorProvenanceLib = require('./sssomValidatorProvenance');
const provenanceFor = (world) => sssomValidatorProvenanceLib.sssomValidatorProvenanceFor(world);
const REAL = sssomValidatorProvenanceLib.REAL_VALIDATOR_NAME;
const PROXY = sssomValidatorProvenanceLib.PROXY_VALIDATOR_NAME;
const DECLARED_PATH = '/declared/absolute/path/to/sssom';

// THE MEASURED CASE — the only combination that entitles the conjunct to claim anything
const measuredVerdict = provenanceFor({ declaredBinPath: DECLARED_PATH, binPathPresent: true, ranValidatorName: REAL });
harness.ok(`(g) declared + on disk + the REAL ${REAL} ran => MEASURED, with no unmeasured reason`, measuredVerdict.measured === true && measuredVerdict.unmeasuredReason === '', JSON.stringify(measuredVerdict));

// THE B4-F9 CASE ITSELF — declared and absent. This is the world the worktree was in while reporting green.
const trapVerdict = provenanceFor({ declaredBinPath: DECLARED_PATH, binPathPresent: false, ranValidatorName: PROXY });
// ⟪THIS ASSERTION WAS STRENGTHENED AFTER WATCHING IT FAIL TO BITE, and the reason is worth keeping⟫ It first read
// `/UNMEASURED/ && contains the declared path`. Disabling the absent-path branch outright then left this twin GREEN:
// execution fell through to the present-but-unused branch, whose text ALSO says UNMEASURED and ALSO names the path.
// The suite still caught the mutation — the distinct-texts twin below went red — but a twin that survives the
// deletion of the branch it is named for is testing the family, not the branch. Each of the three now pins its own
// branch by a marker unique to it.
harness.ok('(g) RED-OBSERVED — declared + NOT on disk + proxy ran => UNMEASURED BY NAME, naming the absent DECLARED path AND saying NOT ON DISK. This is FINDING B4-F9 exactly: the state in which test-bgP7 reported 44/44 green from a worktree', trapVerdict.measured === false && /NOT ON DISK/.test(trapVerdict.unmeasuredReason) && trapVerdict.unmeasuredReason.indexOf(DECLARED_PATH) !== -1, JSON.stringify(trapVerdict));

// PRESENT-BUT-UNUSED is a DIFFERENT fault and must not be collapsed into the one above — otherwise the next reader
// is sent to inspect a venv that is perfectly healthy while the real bug is in the wiring.
const unusedVerdict = provenanceFor({ declaredBinPath: DECLARED_PATH, binPathPresent: true, ranValidatorName: PROXY });
harness.ok('(g) RED-OBSERVED — declared + ON DISK + only the proxy ran => UNMEASURED BY NAME for a WIRING reason (its own marker: "present but not used"), and the two unmeasured reasons are DISTINCT texts — an environment fault and a wiring fault send a reader to different places', unusedVerdict.measured === false && /present but not used/.test(unusedVerdict.label) && /WIRING/.test(unusedVerdict.unmeasuredReason) && unusedVerdict.unmeasuredReason !== trapVerdict.unmeasuredReason, `${JSON.stringify(unusedVerdict)}\nvs\n${JSON.stringify(trapVerdict)}`);

// NOT DECLARED + PROXY => PERMITTED. No declaration, no promise. A machine without the venv is not a failing machine.
const permittedVerdict = provenanceFor({ declaredBinPath: undefined, binPathPresent: false, ranValidatorName: PROXY });
harness.equal('(g) NOT declared + proxy ran => PERMITTED (unmeasuredReason empty), because nothing promised the real validator — but the label still SAYS proxy-only rather than implying a measurement', permittedVerdict.unmeasuredReason, '');
harness.ok(`(g) …and that permitted verdict is honest about itself: measured is false and the label names the ${PROXY}`, permittedVerdict.measured === false && new RegExp(PROXY, 'i').test(permittedVerdict.label), JSON.stringify(permittedVerdict));

// NOT DECLARED + REAL => REFUSED as DISCOVERY. The ruling's words are "declared, not discovered": a run whose
// validator depends on what happened to be on the box is unreproducible even when it passes.
const discoveredVerdict = provenanceFor({ declaredBinPath: undefined, binPathPresent: false, ranValidatorName: REAL });
harness.ok(`(g) RED-OBSERVED — NOT declared + the REAL ${REAL} ran => UNMEASURED BY NAME as DISCOVERED, because a validator nobody declared makes the run unreproducible even when it passes`, discoveredVerdict.measured === false && /DISCOVERED|discovered/.test(discoveredVerdict.unmeasuredReason), JSON.stringify(discoveredVerdict));

// a rule that cannot say which validator ran cannot claim a measurement
[undefined, null, '', 'real', 'sssom', 'SSSOM-PY'].forEach((oneBadName) => {
	const verdict = provenanceFor({ declaredBinPath: DECLARED_PATH, binPathPresent: true, ranValidatorName: oneBadName });
	harness.ok(`(g) RED-OBSERVED — an unrecognised validator name (${JSON.stringify(oneBadName)}) is UNMEASURED by name rather than assumed to be one of the two`, verdict.measured === false && verdict.unmeasuredReason.length > 0, JSON.stringify(verdict));
});
// declared, but the caller did not say whether it is on disk — the whole question, never assumed
harness.ok('(g) RED-OBSERVED — a declared path with no boolean binPathPresent is UNMEASURED by name (whether the declared tool is actually there is the whole question and is never assumed)', provenanceFor({ declaredBinPath: DECLARED_PATH, ranValidatorName: REAL }).unmeasuredReason.length > 0);

// --- THE COMMITTED DECLARATION ---
// The path must be DECLARED, and ABSOLUTE. A relative path would reintroduce the defect in a new costume: it would
// resolve against whatever cwd the suite happened to run under.
const sharedToolPaths = acceptanceCommands.sharedToolPaths;
harness.ok('(g) acceptanceCommands.jsonc declares sharedToolPaths, and it is NOT mistakable for a bridge entry (no standardKey, so every reader that filters on standardKey skips it)', sharedToolPaths !== null && typeof sharedToolPaths === 'object' && typeof sharedToolPaths.standardKey !== 'string');
harness.ok(`(g) sharedToolPaths.sssomPyBinPath is declared and ABSOLUTE (${sharedToolPaths && sharedToolPaths.sssomPyBinPath}) — a relative path would resolve against whatever cwd the suite ran under, which is the same class of bug as the four-level climb it replaces`, !!sharedToolPaths && typeof sharedToolPaths.sssomPyBinPath === 'string' && path.isAbsolute(sharedToolPaths.sssomPyBinPath));
// and the runner's bridge list excludes it, so a caller is never offered a non-bridge as a --bridgeName
harness.ok('(g) the runner derives its --bridgeName list by filtering on standardKey, so sharedToolPaths is never offered as a bridge', /typeof acceptanceCommands\[oneName\]\.standardKey === 'string'/.test(runnerText));
harness.ok('(g) sharedToolPaths is not in the bridge list this file iterates either — one definition of "is a bridge entry", not two', bridgeNameList.indexOf('sharedToolPaths') === -1);

// THE LIVE STATE, RECORDED RATHER THAN ASSERTED EITHER WAY. On TQ's box the venv is present, so this prints
// MEASURED; on a machine without it the declaration is still there and the verdict would be UNMEASURED-by-name,
// which is the point. Asserting "present" would make this suite fail on any other machine for a reason that is not
// a defect, so what is asserted is that the RULE returns a coherent verdict about whatever is actually there.
const liveDeclaredPath = sharedToolPaths && sharedToolPaths.sssomPyBinPath;
const livePresent = typeof liveDeclaredPath === 'string' && fs.existsSync(liveDeclaredPath);
harness.note(`(g) live: the declared ${REAL} path is ${livePresent ? 'PRESENT' : 'ABSENT'} on this machine — ${provenanceFor({ declaredBinPath: liveDeclaredPath, binPathPresent: livePresent, ranValidatorName: livePresent ? REAL : PROXY }).label}`);
harness.ok('(g) the rule returns a coherent verdict about the LIVE declared path (asserting "present" instead would fail on any machine without the venv, which is an environment fact and not a defect)', (() => { const verdict = provenanceFor({ declaredBinPath: liveDeclaredPath, binPathPresent: livePresent, ranValidatorName: livePresent ? REAL : PROXY }); return livePresent ? verdict.measured === true && verdict.unmeasuredReason === '' : /UNMEASURED/.test(verdict.unmeasuredReason); })());

// ---------------------------------------------------------------------
// (h) WHICH WINDOW A BATCH DOCUMENT MAY CLAIM — STAND-DOWN-B4 disposition (b), ratified as code under B4R-3
// ---------------------------------------------------------------------
//
// The rule is batchWindowVerdict.js, extracted for the BS-13 / recordDisposition.js reason: batchCheckpoint.js is
// a CLI that RUNS ON REQUIRE, so a suite requiring it would write a document, and a twin could only test a copy.
//
// The amendment in one sentence: a document's cleanliness must not depend on a number that can move AFTER the
// document was written. batch-0 ran at limit 10 and was clean; BS-9 released 70; batch-0 went unclean
// retroactively, by an edit to a file it has no relationship with. Its own author raised that rather than
// weakening the check, which is why this is an amendment and not a loosening — and the inequality where the row
// always did its real work, caller-disagrees-with-block, still fails.
const batchWindowVerdictLib = require('./batchWindowVerdict');
const windowVerdictFor = (world) => batchWindowVerdictLib.batchWindowVerdictFor(world);

// THE batch-0 CASE ITSELF: block ran 10, caller says 10, runner has since released 70 => CLEAN, and SUPERSEDED
const batchZeroVerdict = windowVerdictFor({ blockWindowLimit: 10, callerWindowLimit: 10, releasedWindowLimit: 70 });
harness.ok('(h) block 10 · caller 10 · released 70 => CLEAN and flagged SUPERSEDED. This is batch-0 exactly: it ran at the window in force when it was frozen, and a later release cannot make an already-frozen document unclean (SABLE_RIVER stand-down disposition (b))', batchZeroVerdict.pass === true && batchZeroVerdict.superseded === true && batchZeroVerdict.detail.indexOf(batchWindowVerdictLib.SUPERSEDED_LABEL) !== -1, JSON.stringify(batchZeroVerdict));

// THE batch-1 CASE: block ran the currently-released window => CLEAN, not superseded
const batchOneVerdict = windowVerdictFor({ blockWindowLimit: 70, callerWindowLimit: 70, releasedWindowLimit: 70 });
harness.ok('(h) block 70 · caller 70 · released 70 => CLEAN and NOT superseded — the ordinary case still reads as ordinary', batchOneVerdict.pass === true && batchOneVerdict.superseded === false, JSON.stringify(batchOneVerdict));

// RED, AND THIS IS THE HALF THAT MUST NOT SOFTEN: a caller who misdescribes the block still FAILS. Without this
// the amendment would be a loosening, because a document could then assert a window its block never ran.
[{ blockWindowLimit: 70, callerWindowLimit: 10, releasedWindowLimit: 70 }, { blockWindowLimit: 10, callerWindowLimit: 70, releasedWindowLimit: 70 }, { blockWindowLimit: 10, callerWindowLimit: 70, releasedWindowLimit: 10 }].forEach((oneWorld) => {
	const verdict = windowVerdictFor(oneWorld);
	harness.ok(`(h) RED-OBSERVED — block ${oneWorld.blockWindowLimit} · caller ${oneWorld.callerWindowLimit} · released ${oneWorld.releasedWindowLimit} => FAILS by name (CALLER DISAGREES WITH THE BLOCK). The amendment relaxes the released-row comparison and NOT this one, because this is the inequality that would let a document claim a window its block never ran`, verdict.pass === false && /CALLER DISAGREES WITH THE BLOCK/.test(verdict.detail), JSON.stringify(verdict));
});
// a window nobody can state is not a window a document may claim
[{ blockWindowLimit: 0, callerWindowLimit: 10, releasedWindowLimit: 70 }, { blockWindowLimit: 10, callerWindowLimit: undefined, releasedWindowLimit: 70 }, { blockWindowLimit: 10, callerWindowLimit: 10, releasedWindowLimit: NaN }, { blockWindowLimit: '10', callerWindowLimit: 10, releasedWindowLimit: 70 }].forEach((oneWorld, oneIndex) => {
	const verdict = windowVerdictFor(oneWorld);
	harness.ok(`(h) RED-OBSERVED — a non-positive-integer window (#${oneIndex + 1}) FAILS by name rather than being coerced into a number and quietly compared`, verdict.pass === false && /not a window this document may claim/.test(verdict.detail), JSON.stringify(verdict));
});
// and the generator reads the rule rather than carrying its own copy
harness.ok('(h) batchCheckpoint.js calls batchWindowVerdict.js rather than comparing the three numbers inline — one rule, one place, and the twins above exercise the function the generator actually calls', (() => { const generatorText = fs.readFileSync(path.join(__dirname, 'batchCheckpoint.js'), 'utf8'); return /batchWindowVerdictLib\.batchWindowVerdictFor\(/.test(generatorText) && !/blockWindowLimit === releasedWindowLimit/.test(generatorText); })());

// ---------------------------------------------------------------------
// (i) THE REFERENCE-ROLE VOCABULARY IS A POLYMORPHIC SEAM AND NOW HAS AN INTERFACE CHECK
// ---------------------------------------------------------------------
//
// FOUND BY MY OWN polyArch2 SELF-AUDIT, not by a failing test, and it is the audit item "a formally declared
// interface for every polymorphic seam you touched".
//
// BS-8 made batchCheckpoint.js's vocabulary a two-role registry — `truth` for the derived plugin, `comparison` for
// a standard-declared one — and the ROLE selects the words. B4R-5 then added a fourteenth member
// (pickedNoComparisonWord) to both roles. Nothing anywhere asserted the two roles carry the SAME MEMBERS. Add a
// member to one role only and the document prints the literal string "undefined" for the other, in a
// judge-facing sentence, with no error and no red gate.
//
// That is not hypothetical: it is precisely the defect BS-12 was called in to fix — 58 rows rendered with
// "confidence undefined" — arriving by a different door. A registry whose members must line up across roles has an
// interface whether or not anyone wrote it down, so it is written down here.
const referenceVocabularyByRole = (() => {
	const generatorText = fs.readFileSync(path.join(__dirname, 'batchCheckpoint.js'), 'utf8');
	const matched = /const REFERENCE_VOCABULARY_BY_ROLE = Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(generatorText);
	if (matched === null) {
		return null;
	}
	return matched[1].split(/\n\t(?=[a-zA-Z]+: Object\.freeze)/).reduce((soFar, oneBlock) => {
		const roleNameMatch = /^\s*([a-zA-Z]+): Object\.freeze/.exec(oneBlock);
		return roleNameMatch === null ? soFar : { ...soFar, [roleNameMatch[1]]: [...oneBlock.matchAll(/^\t\t([a-zA-Z]+):/gm)].map((oneMatch) => oneMatch[1]) };
	}, {});
})();
harness.ok('(i) REFERENCE_VOCABULARY_BY_ROLE is readable from the generator, and declares at least the two ruled roles', referenceVocabularyByRole !== null && Object.keys(referenceVocabularyByRole).length >= 2, JSON.stringify(referenceVocabularyByRole === null ? null : Object.keys(referenceVocabularyByRole)));
const roleNameList = referenceVocabularyByRole === null ? [] : Object.keys(referenceVocabularyByRole);
// the runner's own list of lawful roles, read from the generator rather than restated
const declaredRoleNameList = (() => {
	const generatorText = fs.readFileSync(path.join(__dirname, 'batchCheckpoint.js'), 'utf8');
	const matched = /const REFERENCE_ROLE_LIST = Object\.freeze\(\[([^\]]*)\]\)/.exec(generatorText);
	return matched === null ? null : matched[1].split(',').map((oneEntry) => oneEntry.trim().replace(/^'|'$/g, '')).filter((oneEntry) => oneEntry !== '');
})();
harness.equal('(i) every role in REFERENCE_ROLE_LIST has a vocabulary, and every vocabulary has a role — a role the runner accepts with no words to print would refuse at document time, which is the wrong end of the run to discover it', JSON.stringify((declaredRoleNameList || []).slice().sort()), JSON.stringify(roleNameList.slice().sort()));
// THE INTERFACE ITSELF: identical member sets across every role.
const memberSetSignature = (oneRoleName) => referenceVocabularyByRole[oneRoleName].slice().sort().join(',');
const signatureList = roleNameList.map(memberSetSignature);
harness.ok(`(i) EVERY role vocabulary declares the IDENTICAL member set (${roleNameList.length} roles, ${referenceVocabularyByRole === null ? 0 : (referenceVocabularyByRole[roleNameList[0]] || []).length} members each) — a member present in one role and absent in another prints the literal "undefined" into a judge-facing sentence, which is BS-12's own defect arriving by a different door`, signatureList.length > 1 && signatureList.every((oneSignature) => oneSignature === signatureList[0]), roleNameList.map((oneRoleName) => `${oneRoleName}: ${memberSetSignature(oneRoleName)}`).join('\n'));
// and the member B4R-5 added is actually there, in both, by name — so this conjunct cannot pass on an empty parse
harness.ok('(i) the B4R-5 member pickedNoComparisonWord is present in EVERY role, by name (a parity check over two empty lists would also be "identical")', roleNameList.length > 1 && roleNameList.every((oneRoleName) => referenceVocabularyByRole[oneRoleName].indexOf('pickedNoComparisonWord') !== -1));

harness.report();
