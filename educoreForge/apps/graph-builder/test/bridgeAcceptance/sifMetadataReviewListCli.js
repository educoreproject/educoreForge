#!/usr/bin/env node
'use strict';

// sifMetadataReviewListCli.js — builds the M6b metadata review list (phase C6; SPEC §6 M6b) to a JSON file and a
// markdown file. --priorListFilePath names an earlier run's JSON, or the literal 'none' when there is no prior.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const REQUIRED_NAME_LIST = Object.freeze(['decisionBlockFilePath', 'questionMapFilePath', 'cardLabelFilePath', 'priorListFilePath', 'outputJsonFilePath', 'outputMarkdownFilePath']);
const helpText = () => `
NAME
     ${moduleName} -- build the M6b list: every SIF_Metadata decision with the number of fields it will be copied to

SYNOPSIS
     ${moduleName} --${REQUIRED_NAME_LIST.join('=<> --')}=<>

     --priorListFilePath=none when there is no earlier list; otherwise the change since that list is shown

EXIT STATUS
     0 written;  1 otherwise.
`;
const commandLineParameters = require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const path = require('path');
const sifMetadataReviewList = require(path.join(__dirname, 'sifMetadataReviewList'));
const xLog = process.global.xLog;

const NO_PRIOR_LIST_TOKEN = 'none';
const firstValue = (valueName) => (commandLineParameters.values[valueName] === undefined ? undefined : commandLineParameters.values[valueName][0]);
const missingNameList = REQUIRED_NAME_LIST.filter((oneName) => firstValue(oneName) === undefined);
if (missingNameList.length > 0) {
	xLog.error(`${moduleName} REFUSED: needs --${missingNameList.join(', --')} — none has a default (--priorListFilePath=${NO_PRIOR_LIST_TOKEN} says there is no prior list)`);
	process.exit(1);
}
const inputFilePathOf = (valueName) => path.resolve(firstValue(valueName));
const built = sifMetadataReviewList.buildMetadataReviewListFromFiles({
	decisionBlockFilePath: inputFilePathOf('decisionBlockFilePath'),
	questionMapFilePath: inputFilePathOf('questionMapFilePath'),
	cardLabelFilePath: inputFilePathOf('cardLabelFilePath'),
	priorListFilePath: firstValue('priorListFilePath') === NO_PRIOR_LIST_TOKEN ? null : inputFilePathOf('priorListFilePath'),
});
if (built.error) {
	xLog.error(built.error.message);
	process.exit(1);
}
fs.writeFileSync(inputFilePathOf('outputJsonFilePath'), `${JSON.stringify(built.list, null, '\t')}\n`);
fs.writeFileSync(inputFilePathOf('outputMarkdownFilePath'), built.markdownText);
xLog.result(`${moduleName}: ${built.list.metadataQuestionCount} metadata questions over ${built.list.instanceTotal} fields; ${built.list.propagationTotal} fields receive a decision${built.list.priorGiven ? ` (${built.list.propagationTotalDelta >= 0 ? '+' : ''}${built.list.propagationTotalDelta} since the prior list)` : ''}\n  ${inputFilePathOf('outputJsonFilePath')}\n  ${inputFilePathOf('outputMarkdownFilePath')}`);
process.exit(0);
