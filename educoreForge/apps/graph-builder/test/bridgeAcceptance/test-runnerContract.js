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

harness.report();
