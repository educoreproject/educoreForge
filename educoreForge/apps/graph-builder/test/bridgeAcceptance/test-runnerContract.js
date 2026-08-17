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

harness.report();
