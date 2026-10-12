#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// walkHarness.js — the offline harness for the step-4 walk experiment (campaign cedsRichness-101226, lane WALK;
// DESIGN-WALK-cascadeWalkExperiment-101226.md). It sits BESIDE the bridge, never inside it: every pool it builds is
// rendered and judged through the bridge's own modules (parts/subjectJudge.js), and the gold graph is only ever READ.
// Nothing here constructs a graph writer or opens a store other than its own fresh scratch caches.

const path = require('path');
const fs = require('fs');

const HELP_TEXT = `
NAME
    walkHarness.js — step-4 walk experiment harness (lane WALK, cedsRichness-101226)

SYNOPSIS
    node walkHarness.js -reproduceBaseline --outDirPath=<dir>
    node walkHarness.js -runArms --runLabel=<r1|r2|r3> --outDirPath=<dir> --scratchDirPath=<dir> [--armList=A0,A1,A2,A3] [--subjectLimit=<n>]
    node walkHarness.js -sifRecall --outDirPath=<dir> --scratchDirPath=<dir> --runLabel=<label>
    node walkHarness.js -help

DESCRIPTION
    Reads the gold graph named in walkExperiment.json (read-only, password never printed), the Ed-Fi hundred and
    the gold's frozen Ed-Fi decision block (extracted beforehand by evidence/WALK/extractGoldBlock.sh).

    -reproduceBaseline  rebuilds A0 (today's embedTextVote-v1 pool) for the hundred and checks every pool and
                        every rendered promptHash against the gold's frozen records. No AI call. Writes
                        a0Reproduction.json to --outDirPath and exits 1 if anything differs.
    -runArms            one run: every named arm over the hundred, with ONE fresh judgment cache under
                        --scratchDirPath shared by the arms of this run. Calls Jev. Writes per-subject rows.
    -sifRecall          the SIF regression pair (PreferredName, StateProvinceId): pool recall per arm.

    Never touches: any graph (no writer exists here), the gold's stores, the DME pointer, demo or production.

OPTIONS
    --configFilePath=<file>   the experiment configuration. Optional; when absent, walkExperiment.json beside
                              this file is read. Every setting inside it is required.

FILES
    walkExperiment.json beside this file: every setting, all required.

EXIT STATUS
    0 success; 1 a check failed or a refusal.
`;

// process.global is read at REQUIRE time by sqlite-instance (via the judgment cache), so it is built first
const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters({ noFunctions: true });
const switchesGiven = commandLineParameters.switches || {};
if (switchesGiven.help || switchesGiven.h || process.argv.indexOf('--help') !== -1) {
	process.stdout.write(HELP_TEXT);
	process.exit(0);
}
const givenConfigFilePath = (commandLineParameters.values || {}).configFilePath;
const configFilePath = givenConfigFilePath === undefined ? path.join(__dirname, 'walkExperiment.json') : [].concat(givenConfigFilePath)[0];
const experimentConfig = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
const xLog = require('qtools-x-log');
process.global = Object.freeze({
	xLog,
	getConfig: (sectionName) => (sectionName === 'walkExperiment' ? experimentConfig : {}),
	rawConfig: { walkExperiment: experimentConfig },
	commandLineParameters,
});

const harnessActionsLib = require(path.join(__dirname, 'parts', 'harnessActions'));

// ACTION_BY_SWITCH — which action a switch runs; the switch name IS the action name
const ACTION_BY_SWITCH = Object.freeze({
	reproduceBaseline: harnessActionsLib.reproduceBaseline,
	runArms: harnessActionsLib.runArms,
	sifRecall: harnessActionsLib.sifRecall,
});

const actionNameList = Object.keys(ACTION_BY_SWITCH).filter((oneName) => switchesGiven[oneName]);
if (actionNameList.length !== 1) {
	process.stderr.write(`${moduleName}: name exactly one action of: ${Object.keys(ACTION_BY_SWITCH).map((oneName) => `-${oneName}`).join(', ')} (given: ${actionNameList.join(', ') || 'none'}). See -help.\n`);
	process.exit(1);
}
const valueOf = (valueName) => {
	const given = (commandLineParameters.values || {})[valueName];
	return Array.isArray(given) ? given[0] : given;
};

ACTION_BY_SWITCH[actionNameList[0]]({ experimentConfig, valueOf, xLog }, (actionError, actionResult) => {
	if (actionError) {
		process.stderr.write(`${moduleName}: ${actionError}\n`);
		process.exit(1);
	}
	process.stdout.write(`${actionResult.summaryText}\n`);
	process.exit(actionResult.passed === false ? 1 : 0);
});
