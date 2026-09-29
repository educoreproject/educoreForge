#!/usr/bin/env node
'use strict';

// sifReviewPageCli.js — the publisher's commands for the SIF review page (phase C6). It builds a page to a file,
// and verifies a page, normally a copy fetched back from the live URL, against the score of the same five inputs.
// It deploys nothing: publication is the supervisor's step (see DEVLOG-C6 for what the publisher records).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const SCORE_INPUT_NAME_LIST = ['decisionBlockFilePath', 'annotationFilePath', 'questionMapFilePath', 'cardListFilePath', 'remodelTableFilePath'];
const REQUIRED_NAME_LIST_BY_MODE = Object.freeze({
	build: SCORE_INPUT_NAME_LIST.concat(['cardLabelFilePath', 'feedbackTargetPath', 'draftStoragePrefix', 'pageTitle', 'outputFilePath']),
	verify: SCORE_INPUT_NAME_LIST.concat(['htmlFilePath']),
});
const helpText = () => `
NAME
     ${moduleName} -- build the SIF review page, or verify a page (a fetched deployed copy) against its inputs' score

SYNOPSIS
     ${moduleName} -build --${REQUIRED_NAME_LIST_BY_MODE.build.join('=<> --')}=<>
     ${moduleName} -verify --${REQUIRED_NAME_LIST_BY_MODE.verify.join('=<> --')}=<>

     -build   scores the five inputs with sifYardstickScorer, writes the page to outputFilePath, prints the manifest
     -verify  scores the same five inputs and checks the page's rendered numbers, items, feedback target, handler
              ids, wording and input shas against that score; curl the live URL to a file first

EXIT STATUS
     0 built, or every verify check passes;  1 otherwise.
`;
const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const path = require('path');
const sifYardstickScorer = require(path.join(__dirname, 'sifYardstickScorer'));
const sifReviewPage = require(path.join(__dirname, 'sifReviewPage'));
const xLog = process.global.xLog;

const firstValue = (valueName) => (commandLineParameters.values[valueName] === undefined ? undefined : commandLineParameters.values[valueName][0]);
const modeNameList = Object.keys(REQUIRED_NAME_LIST_BY_MODE).filter((oneMode) => commandLineParameters.switches[oneMode] === true);
if (modeNameList.length !== 1) {
	xLog.error(`${moduleName} REFUSED: give exactly one of -${Object.keys(REQUIRED_NAME_LIST_BY_MODE).join(', -')} (got ${modeNameList.length}) — see -help`);
	process.exit(1);
}
const modeName = modeNameList[0];
const missingNameList = REQUIRED_NAME_LIST_BY_MODE[modeName].filter((oneName) => firstValue(oneName) === undefined);
if (missingNameList.length > 0) {
	xLog.error(`${moduleName} REFUSED: -${modeName} needs --${missingNameList.join(', --')} — none has a default`);
	process.exit(1);
}
const scoreInputSet = SCORE_INPUT_NAME_LIST.reduce((soFar, oneName) => ({ ...soFar, [oneName]: path.resolve(firstValue(oneName)) }), {});

if (modeName === 'build') {
	const built = sifReviewPage.buildReviewPageFromFiles({ ...scoreInputSet, cardLabelFilePath: path.resolve(firstValue('cardLabelFilePath')), pageSetting: { feedbackTargetPath: firstValue('feedbackTargetPath'), draftStoragePrefix: firstValue('draftStoragePrefix'), pageTitle: firstValue('pageTitle') } });
	if (built.error) {
		xLog.error(built.error.message);
		process.exit(1);
	}
	fs.writeFileSync(path.resolve(firstValue('outputFilePath')), built.htmlText);
	xLog.result(`${moduleName}: wrote ${path.resolve(firstValue('outputFilePath'))}\n${JSON.stringify(built.manifest, null, 1)}`);
	process.exit(0);
}

const scored = sifYardstickScorer.scoreFromFiles(scoreInputSet);
if (scored.error) {
	xLog.error(scored.error.message);
	process.exit(1);
}
const verified = sifReviewPage.verifySifReviewPage({ htmlText: fs.readFileSync(path.resolve(firstValue('htmlFilePath')), 'utf8'), score: scored.score });
xLog.result(`${verified.checkList.map((oneCheck) => `  ${oneCheck.pass ? 'ok  ' : 'FAIL'}  ${oneCheck.checkName}  ${oneCheck.detail}`).join('\n')}\n${moduleName}: ${verified.pass ? 'VERIFIED' : 'NOT VERIFIED'} ${path.resolve(firstValue('htmlFilePath'))}\n`);
process.exit(verified.pass ? 0 : 1);
