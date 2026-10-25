#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// layerAgreementCli.js — the I/O shell of lib/layer-agreement (mappingLayers ML2-b). Reads frozen layer versions (decision blocks from
// a decision store, opened READ-ONLY, and SSSOM sets from files), compares them with layerAgreement.js and writes ONE JSON report.
// Nothing is written anywhere else; no graph, no judge. The report carries no clock, so the same inputs give the same bytes.
//
// ACTIONS (exactly one):
//   -judgeAgainstRater   a judge layer against a rater layer (SPEC §8.1), with inter-rater agreement beside it
//       --judgeBlockList=<store.sqlite3>#<blockHash>[,…]   the judge layer version's member blocks for the rated pairs
//       --judgeLabel=<text>  --raterSetPath=<raters.r1.sssom.tsv>  --raterCensusPath=<raterLayerCensus.r1.json>  --raterLabel=<text>
//       --raterLayerKey=<pooled layer key in the census>  --sampleJsonPath=<rater tool sample.json> (element kinds)
//       --raterStoreCopyPath=<copy.sqlite3>  --suggestedPath=<suggested.json>  --raterResultsModulePath=<educore rater-results.js>
//            (inter-rater: the rater tool's OWN aggregation, required read-only and never changed)
//   -versionAgainstVersion   two versions of one layer (SPEC §8.2)
//       --leftBlockList=…  --rightBlockList=…  --leftLabel=<text>  --rightLabel=<text>
// ALWAYS:  --layerRegistryFilePath=<recipes/layers.json> (standard names)  --reportJsonPath=<out.json>
// Every parameter is REQUIRED for its action, with no default. Exit 0 when the report is written; 1 on a refusal (printed).
// -help prints this header.

const fs = require('fs');
const path = require('path');

const helpText = () => fs.readFileSync(__filename, 'utf8').split('\n').filter((oneLine) => oneLine.startsWith('//')).map((oneLine) => oneLine.replace(/^\/\/ ?/, '')).join('\n');
const argumentList = process.argv.slice(2);
const parameterValueFor = (parameterName) => {
	const prefix = `--${parameterName}=`;
	const argument = argumentList.find((oneArgument) => oneArgument.indexOf(prefix) === 0);
	return argument === undefined ? undefined : argument.slice(prefix.length);
};
const refuseAndExit = (refusalText) => {
	process.stderr.write(`${moduleName}: ${refusalText} (${moduleName} -help for the full page)\n`);
	process.exit(1);
};
if (argumentList.some((oneArgument) => ['-help', '--help', '-h'].indexOf(oneArgument) !== -1)) {
	process.stdout.write(`${helpText()}\n`);
	process.exit(0);
}
const REQUIRED_PARAMETER_NAME_LIST_BY_ACTION = Object.freeze({
	judgeAgainstRater: ['judgeBlockList', 'judgeLabel', 'raterSetPath', 'raterCensusPath', 'raterLabel', 'raterLayerKey', 'sampleJsonPath', 'raterStoreCopyPath', 'suggestedPath', 'raterResultsModulePath', 'layerRegistryFilePath', 'reportJsonPath'],
	versionAgainstVersion: ['leftBlockList', 'rightBlockList', 'leftLabel', 'rightLabel', 'layerRegistryFilePath', 'reportJsonPath'],
});
const actionList = Object.keys(REQUIRED_PARAMETER_NAME_LIST_BY_ACTION).filter((actionName) => argumentList.indexOf(`-${actionName}`) !== -1);
if (actionList.length !== 1) {
	refuseAndExit(`exactly one action is required (${Object.keys(REQUIRED_PARAMETER_NAME_LIST_BY_ACTION).map((actionName) => `-${actionName}`).join(' | ')}); got ${actionList.length}`);
}
const actionName = actionList[0];
const missingParameterList = REQUIRED_PARAMETER_NAME_LIST_BY_ACTION[actionName].filter((parameterName) => !parameterValueFor(parameterName));
if (missingParameterList.length) {
	refuseAndExit(`-${actionName}: ${missingParameterList.map((parameterName) => `--${parameterName}`).join(', ')} REQUIRED, with no default`);
}

const Database = require(path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'));
const { assertionsFromSssomText, assertionsFromDecisionBlock } = require(path.join(__dirname, 'layerAssertions'));
const { compareJudgeAgainstRater, compareVersionAgainstVersion } = require(path.join(__dirname, 'layerAgreement'));
const raterLayerSources = require(path.join(__dirname, '..', 'rater-layer', 'raterLayerSources.json'));

const crypto = require('crypto');
const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');
const exitOnError = (result) => {
	if (result.error) {
		refuseAndExit(result.error);
	}
	return result;
};

const layerRegistry = JSON.parse(fs.readFileSync(parameterValueFor('layerRegistryFilePath'), 'utf8'));
const standardNameByStandardKey = layerRegistry.layerList.reduce((soFar, oneLayer) => oneLayer.standardList.reduce((inner, oneStandard) => ({ ...inner, [oneStandard.standardKey]: oneStandard.standardName }), soFar), {});

// blockAssertionsFor('<store>#<hash>,…') → { assertionList, inputList } — every named block must exist, verified by re-hash
const blockAssertionsFor = (blockListText) => {
	const inputList = [];
	const assertionList = blockListText.split(',').reduce((soFar, oneBlockText) => {
		const [storePath, decisionBlockHash] = oneBlockText.split('#');
		const store = new Database(storePath, { readonly: true, fileMustExist: true });
		const blockRow = store.prepare('SELECT pairKey, CAST(frozenText AS TEXT) AS frozenText FROM decisionBlocks WHERE decisionBlockHash = ?').get(decisionBlockHash);
		store.close();
		if (blockRow === undefined) {
			refuseAndExit(`block ${decisionBlockHash} is not in ${storePath}`);
		}
		if (sha256Hex(blockRow.frozenText) !== decisionBlockHash) {
			refuseAndExit(`block ${decisionBlockHash} in ${storePath} does not re-hash to its id`);
		}
		const read = exitOnError(assertionsFromDecisionBlock({ decisionBlock: JSON.parse(blockRow.frozenText), sourceLabel: decisionBlockHash }));
		inputList.push({ decisionBlockHash, pairKey: blockRow.pairKey, judgeKind: JSON.parse(blockRow.frozenText).header.judgeKind, assertionCount: read.assertionList.length });
		return soFar.concat(read.assertionList);
	}, []);
	return { assertionList, inputList };
};

// interRaterSummaryFor — the rater tool's own buildRaterResults over the same copy, summarised for targets with two or more answers
const interRaterSummaryFor = () => {
	const { buildRaterResults } = require(path.resolve(parameterValueFor('raterResultsModulePath')));
	const sampleDocument = JSON.parse(fs.readFileSync(parameterValueFor('sampleJsonPath'), 'utf8'));
	const suggestedDocument = JSON.parse(fs.readFileSync(parameterValueFor('suggestedPath'), 'utf8'));
	const raterStore = new Database(parameterValueFor('raterStoreCopyPath'), { readonly: true, fileMustExist: true });
	const raterList = raterStore.prepare('SELECT raterUserName, surveyName FROM raters').all();
	const answerList = raterStore
		.prepare('SELECT raterUserName, elementStableId, answerJson FROM answers')
		.all()
		.map((oneRow) => ({ raterUserName: oneRow.raterUserName, elementStableId: oneRow.elementStableId, answer: JSON.parse(oneRow.answerJson) }));
	raterStore.close();
	const results = buildRaterResults({ elementList: sampleDocument.elementList, suggestedDocument, raterList, answerList });
	if (results.problemText) {
		refuseAndExit(`rater-results: ${results.problemText}`);
	}
	const multiAnswerTargetList = results.targetList.filter((oneTarget) => oneTarget.answeredCount >= 2);
	return {
		instrument: `educore rater-results.js buildRaterResults (sha256 ${sha256Hex(fs.readFileSync(path.resolve(parameterValueFor('raterResultsModulePath'))))}), read-only`,
		answeredTargetCount: results.targetList.filter((oneTarget) => oneTarget.answeredCount >= 1).length,
		multiAnswerTargetCount: multiAnswerTargetList.length,
		fullCardAgreementCount: multiAnswerTargetList.filter((oneTarget) => oneTarget.sameCardCount === oneTarget.answeredCount).length,
		fullPropertyAgreementCount: multiAnswerTargetList.filter((oneTarget) => oneTarget.samePropertyCount === oneTarget.answeredCount).length,
		multiAnswerTargetList: multiAnswerTargetList
			.map((oneTarget) => ({ targetStableId: oneTarget.targetStableId, answeredCount: oneTarget.answeredCount, sameCardCount: oneTarget.sameCardCount, samePropertyCount: oneTarget.samePropertyCount, distinctBestCount: oneTarget.distinctBestCount }))
			.sort((leftTarget, rightTarget) => (leftTarget.targetStableId < rightTarget.targetStableId ? -1 : 1)),
	};
};

const reportFor = {
	judgeAgainstRater: () => {
		const judge = blockAssertionsFor(parameterValueFor('judgeBlockList'));
		const raterSetText = fs.readFileSync(parameterValueFor('raterSetPath'), 'utf8');
		const rater = exitOnError(assertionsFromSssomText({ sssomText: raterSetText, sourceLabel: parameterValueFor('raterSetPath') }));
		const raterCensus = JSON.parse(fs.readFileSync(parameterValueFor('raterCensusPath'), 'utf8'))[parameterValueFor('raterLayerKey')];
		if (raterCensus === undefined || !Array.isArray(raterCensus.unsureUnitList)) {
			refuseAndExit(`the census names no layer '${parameterValueFor('raterLayerKey')}' with an unsureUnitList`);
		}
		const sampleDocument = JSON.parse(fs.readFileSync(parameterValueFor('sampleJsonPath'), 'utf8'));
		const elementKindByStableId = sampleDocument.elementList.reduce((soFar, oneElement) => ({ ...soFar, [oneElement.elementStableId.slice(oneElement.elementStableId.indexOf(':') + 1)]: oneElement.kind }), {});
		const compared = exitOnError(
			compareJudgeAgainstRater({
				judgeAssertionList: judge.assertionList,
				raterAssertionList: rater.assertionList,
				raterUnsureList: raterCensus.unsureUnitList,
				elementKindByStableId,
				standardNameByStandardKey,
				hubName: raterLayerSources.hub.hubName,
				judgeLabel: parameterValueFor('judgeLabel'),
				raterLabel: parameterValueFor('raterLabel'),
				raterPredicateExpansionByPrefix: rater.predicateExpansionByPrefix,
				raterBestPredicateId: raterLayerSources.predicateIdByAnswerRole.best,
			}),
		);
		return { ...compared, inputs: { judgeBlockList: judge.inputList, raterSet: { path: path.basename(parameterValueFor('raterSetPath')), sha256: sha256Hex(raterSetText) } }, interRater: interRaterSummaryFor() };
	},
	versionAgainstVersion: () => {
		const left = blockAssertionsFor(parameterValueFor('leftBlockList'));
		const right = blockAssertionsFor(parameterValueFor('rightBlockList'));
		const compared = exitOnError(compareVersionAgainstVersion({ leftAssertionList: left.assertionList, rightAssertionList: right.assertionList, standardNameByStandardKey, leftLabel: parameterValueFor('leftLabel'), rightLabel: parameterValueFor('rightLabel') }));
		return { ...compared, inputs: { leftBlockList: left.inputList, rightBlockList: right.inputList } };
	},
};

const report = reportFor[actionName]();
fs.mkdirSync(path.dirname(parameterValueFor('reportJsonPath')), { recursive: true });
fs.writeFileSync(parameterValueFor('reportJsonPath'), `${JSON.stringify(report, null, '\t')}\n`);
process.stdout.write(`${moduleName}: wrote ${parameterValueFor('reportJsonPath')} (${report.comparisonKind}; ${JSON.stringify(report.coverage)})\n`);
