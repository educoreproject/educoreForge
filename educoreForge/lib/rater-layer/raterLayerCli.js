#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// raterLayerCli.js — the I/O shell of the rater-layer converter (mappingLayers ML2-a). Reads a READ-ONLY COPY of the rater tool's sqlite
// store (never the live file: make the copy on the host with VACUUM INTO), the rater tool's frozen suggested.json, and a JSON list of
// unresolved store elementStableIds (the FIRST CHECK's output; [] when every rated item resolves in the gold). Writes, into --outputDirPath:
//     <layerKey>.<versionTag>.sssom.tsv      one per rater with a row, and the pooled set (raters)
//     raterLayerCensus.<versionTag>.json     per layer: answers read, rows by predicate, unsure, history, exclusions
//     raterLayerRegistryRows.<versionTag>.json   the agent rows and layer rows the registries need (appended by hand, reviewed)
// It reads only raters.refId, raterUserName and surveyName: raters.displayJson (real names and emails) is NEVER selected. Every
// parameter is REQUIRED, with no default:
//     node lib/rater-layer/raterLayerCli.js --raterStoreCopyPath=<copy.sqlite3> --suggestedPath=<suggested.json>
//          --unresolvedListPath=<unresolved.json> --versionTag=r1 --outputDirPath=<dir>
// Exit 0 when every set is written; 1 on a refusal (printed). -help prints this header.

const fs = require('fs');
const path = require('path');

const helpText = () => fs.readFileSync(__filename, 'utf8').split('\n').filter((oneLine) => oneLine.startsWith('//')).map((oneLine) => oneLine.replace(/^\/\/ ?/, '')).join('\n');
const parameterValueFor = (parameterName) => {
	const prefix = `--${parameterName}=`;
	const argument = process.argv.slice(2).find((oneArgument) => oneArgument.indexOf(prefix) === 0);
	return argument === undefined ? undefined : argument.slice(prefix.length);
};
if (process.argv.slice(2).some((oneArgument) => ['-help', '--help', '-h'].indexOf(oneArgument) !== -1)) {
	process.stdout.write(`${helpText()}\n`);
	process.exit(0);
}
const REQUIRED_PARAMETER_NAME_LIST = ['raterStoreCopyPath', 'suggestedPath', 'unresolvedListPath', 'versionTag', 'outputDirPath'];
const missingParameterList = REQUIRED_PARAMETER_NAME_LIST.filter((parameterName) => !parameterValueFor(parameterName));
if (missingParameterList.length) {
	process.stderr.write(`${moduleName}: ${missingParameterList.map((parameterName) => `--${parameterName}`).join(', ')} REQUIRED, with no default (${moduleName} -help for the full page)\n`);
	process.exit(1);
}
const Database = require(path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'));
const { convertRaterStore } = require(path.join(__dirname, 'raterLayerConverter'));
const raterLayerSources = require(path.join(__dirname, 'raterLayerSources.json'));

const raterStore = new Database(parameterValueFor('raterStoreCopyPath'), { readonly: true, fileMustExist: true });
const answerRowList = raterStore.prepare('SELECT raterUserName, elementStableId, answerJson FROM answers').all();
const raterRowList = raterStore.prepare('SELECT refId, raterUserName, surveyName FROM raters').all();
const historyRowList = raterStore.prepare('SELECT raterUserName, elementStableId FROM answerHistory').all();
raterStore.close();

const suggestedDocument = JSON.parse(fs.readFileSync(parameterValueFor('suggestedPath'), 'utf8'));
const unresolvedElementStableIdList = JSON.parse(fs.readFileSync(parameterValueFor('unresolvedListPath'), 'utf8'));
const versionTag = parameterValueFor('versionTag');
const converted = convertRaterStore({ answerRowList, raterRowList, historyRowList, suggestedByElementStableId: suggestedDocument.suggestedByElementStableId, unresolvedElementStableIdList, raterLayerSources, versionTag });
if (converted.error) {
	process.stderr.write(`${converted.error}\n`);
	process.exit(1);
}
const outputDirPath = parameterValueFor('outputDirPath');
fs.mkdirSync(outputDirPath, { recursive: true });
Object.keys(converted.setTextByLayerKey)
	.sort()
	.forEach((layerKey) => {
		fs.writeFileSync(path.join(outputDirPath, `${layerKey}.${versionTag}.sssom.tsv`), converted.setTextByLayerKey[layerKey]);
		process.stdout.write(`${moduleName}: wrote ${layerKey}.${versionTag}.sssom.tsv (${converted.censusByLayerKey[layerKey].rowCount} rows)\n`);
	});
fs.writeFileSync(path.join(outputDirPath, `raterLayerCensus.${versionTag}.json`), `${JSON.stringify(converted.censusByLayerKey, null, '\t')}\n`);
fs.writeFileSync(path.join(outputDirPath, `raterLayerRegistryRows.${versionTag}.json`), `${JSON.stringify({ agentRowList: converted.agentRowList, layerRowList: converted.layerRowList }, null, '\t')}\n`);
