#!/usr/bin/env node
'use strict';

// sifReviewPageCli.js — the publisher's commands for the SIF review page (phases C6, C6c). It builds a page to a file,
// and verifies a page, normally a copy fetched back from the live URL, against the block and the other two inputs it was
// built from (the page carries no score and no comparison with the standard's annotation).
// It deploys nothing: publication is the supervisor's step (see DEVLOG-C6 for what the publisher records).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const PAGE_INPUT_NAME_LIST = ['decisionBlockFilePath', 'questionMapFilePath', 'cardLabelFilePath'];
const REQUIRED_NAME_LIST_BY_MODE = Object.freeze({
	build: PAGE_INPUT_NAME_LIST.concat(['feedbackTargetPath', 'draftStoragePrefix', 'pageTitle', 'roundNumber', 'outputFilePath']),
	verify: PAGE_INPUT_NAME_LIST.concat(['htmlFilePath']),
});
const helpText = () => `
NAME
     ${moduleName} -- build the SIF review page, or verify a page (a fetched deployed copy) against its inputs

SYNOPSIS
     ${moduleName} -build --${REQUIRED_NAME_LIST_BY_MODE.build.join('=<> --')}=<>
     ${moduleName} -verify --${REQUIRED_NAME_LIST_BY_MODE.verify.join('=<> --')}=<>

     -build   reads the block, the question map and the card label list, writes the page to outputFilePath, prints the manifest
     -verify  checks the page's rendered items, candidates, tag choices, feedback target, handler ids, wording and input
              shas against the same three inputs; curl the live URL to a file first

EXIT STATUS
     0 built, or every verify check passes;  1 otherwise.
`;
const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const path = require('path');
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
const pageInputSet = PAGE_INPUT_NAME_LIST.reduce((soFar, oneName) => ({ ...soFar, [oneName]: path.resolve(firstValue(oneName)) }), {});

if (modeName === 'build') {
	const built = sifReviewPage.buildReviewPageFromFiles({ ...pageInputSet, pageSetting: { feedbackTargetPath: firstValue('feedbackTargetPath'), draftStoragePrefix: firstValue('draftStoragePrefix'), pageTitle: firstValue('pageTitle'), roundNumber: Number(firstValue('roundNumber')) } });
	if (built.error) {
		xLog.error(built.error.message);
		process.exit(1);
	}
	fs.writeFileSync(path.resolve(firstValue('outputFilePath')), built.htmlText);
	xLog.result(`${moduleName}: wrote ${path.resolve(firstValue('outputFilePath'))}\n${JSON.stringify(built.manifest, null, 1)}`);
	process.exit(0);
}

const verified = sifReviewPage.verifySifReviewPage({ htmlText: fs.readFileSync(path.resolve(firstValue('htmlFilePath')), 'utf8'), decisionBlock: JSON.parse(fs.readFileSync(pageInputSet.decisionBlockFilePath, 'utf8')), inputFileSha256ByRole: sifReviewPage.inputFileSha256ByRoleOf(pageInputSet) });
xLog.result(`${verified.checkList.map((oneCheck) => `  ${oneCheck.pass ? 'ok  ' : 'FAIL'}  ${oneCheck.checkName}  ${oneCheck.detail}`).join('\n')}\n${moduleName}: ${verified.pass ? 'VERIFIED' : 'NOT VERIFIED'} ${path.resolve(firstValue('htmlFilePath'))}\n`);
process.exit(verified.pass ? 0 : 1);
