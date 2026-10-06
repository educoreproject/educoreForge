#!/usr/bin/env node
'use strict';

// test-bgJudgeSummary.js — BG-JUDGESUMMARY (W-B-3, V1-C08 / V1-S82; campaign P3 2026-10-06): the judge's OWN numbers are
// carried verbatim from the provider's return to the judgment cache row, the forensic record and the frozen decision
// record. Before P3 the Jev client returned them and judgeComponent dropped them at its return literal, so nothing
// downstream had a slot; a full re-judge is what fills it (the cache and forensics never held the full map).
//
//   BG-JUDGESUMMARY  (a) under a number-reporting client the cache row's judgment.judgeSummary equals the client's;
//                    (b) the forensic record carries it; (c) the frozen record's judge.judgeSummary equals it; (d) a second
//                    run served from the cache freezes byte-identical text (why the cache must carry it); (e) a client
//                    returning a PARTIAL probability map is refused by name; (f) under the debug judge no frozen record
//                    carries judgeSummary (a text judge's block text is what it was).
//
// Run: node lib/bridge-framework/test/test-bgJudgeSummary.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-JUDGESUMMARY: the judge's own numbers carried verbatim to cache, forensics and the frozen record

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, succeeded, nameInRefusal, frameworkMutationTwin, forensicsOf, blockOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const JUDGE_FILE = 'judgeComponent.js';
const FRAMEWORK_FILE = 'bridge-framework.js';
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const TOY_EMBED_MODEL = 'toy-embed-v1';

const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};
// the summary a number-reporting judge returns for one question: a probability for every offered option (or, partial,
// every option but the last), the chosen one highest; recorded by promptHash so the conjuncts can compare verbatim
const summaryFor = ({ choiceEnum, choice, partial }) => {
	const offeredList = partial ? choiceEnum.slice(0, -1) : choiceEnum;
	const otherList = offeredList.filter((oneOption) => oneOption !== choice);
	const judgeProbabilityByChoice = offeredList.reduce((soFar, oneOption) => ({ ...soFar, [oneOption]: oneOption === choice ? 0.7 : 0.3 / Math.max(otherList.length, 1) }), {});
	const runnerUp = otherList.length ? Math.max(...otherList.map((oneOption) => judgeProbabilityByChoice[oneOption])) : 0;
	return { judgePickConfidence: 0.75, judgeTopProbability: 0.7, judgeRunnerUpMargin: 0.7 - runnerUp, judgeProbabilityByChoice, judgeRelationConfidence: null, judgeRelationProbabilityByPredicate: null };
};
const numberReportingClient = ({ partial = false } = {}) => {
	const inner = scenarioLib.makeFakeRealClient({});
	const issuedSummaryByUserPrompt = {};
	return {
		...inner,
		issuedSummaryByUserPrompt,
		rerank: (rerankOptions, callback) =>
			inner.rerank(rerankOptions, (rerankError, clientReturn) => {
				if (rerankError) {
					callback(rerankError);
					return;
				}
				const judgeSummary = summaryFor({ choiceEnum: rerankOptions.choiceEnum, choice: clientReturn.choice, partial });
				issuedSummaryByUserPrompt[rerankOptions.userPrompt] = judgeSummary;
				callback('', { ...clientReturn, judgeSummary });
			}),
	};
};
const reportingShape = (scenario) => {
	derivedShape(scenario);
	scenario.judgeClientOverride = numberReportingClient({});
};
const sortedText = (value) => JSON.stringify(value, Object.keys(value || {}).sort());
const deepSortedText = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? `{${Object.keys(value).sort().map((oneName) => `${JSON.stringify(oneName)}:${deepSortedText(value[oneName])}`).join(',')}}` : JSON.stringify(value));
const frozenTextOf = (outcome) => {
	const row = outcome.stores.decisionStore.rowList.find((oneRow) => oneRow.decisionBlockHash === outcome.runReport.decisionBlock.decisionBlockHash);
	return row === undefined ? null : row.frozenText;
};

const conjunctList = [
	runConjunct({
		conjunctId: 'a_cacheRowCarriesTheSummary',
		title: "the judgment cache row's judgment.judgeSummary equals the summary the client returned (verbatim)",
		twinNameList: ['putPayloadDropsSummary'],
		shape: reportingShape,
		judge: succeeded((runReport, outcome, scenario) => {
			const issuedList = Object.keys(scenario.judgeClientOverride.issuedSummaryByUserPrompt).map((oneUserPrompt) => deepSortedText(scenario.judgeClientOverride.issuedSummaryByUserPrompt[oneUserPrompt])).sort();
			const cachedList = Object.values(outcome.stores.judgmentCache.rowByRefId).map((oneRow) => deepSortedText(oneRow.judgment.judgeSummary)).sort();
			return { pass: issuedList.length > 0 && JSON.stringify(issuedList) === JSON.stringify(cachedList), detail: `${issuedList.length} issued, ${cachedList.length} cached; equal ${JSON.stringify(issuedList) === JSON.stringify(cachedList)}` };
		}),
	}),
	runConjunct({
		conjunctId: 'b_forensicRecordCarriesTheSummary',
		title: 'every judgment forensic record carries the summary its prompt was answered with',
		twinNameList: ['forensicRecordNullsSummary'],
		shape: reportingShape,
		judge: succeeded((runReport, outcome, scenario) => {
			const recordList = forensicsOf(outcome).map((oneEntry) => oneEntry.record).filter((oneRecord) => oneRecord.kind === undefined && oneRecord.refusedAttempt === undefined);
			const badList = recordList.filter((oneRecord) => deepSortedText(oneRecord.judgeSummary) !== deepSortedText(scenario.judgeClientOverride.issuedSummaryByUserPrompt[oneRecord.userPrompt]));
			return { pass: recordList.length > 0 && badList.length === 0, detail: `${recordList.length} record(s), ${badList.length} not carrying their summary` };
		}),
	}),
	runConjunct({
		conjunctId: 'c_frozenRecordCarriesTheSummary',
		title: "every judged frozen record's judge.judgeSummary is present and passes the declared shape",
		twinNameList: ['frozenRecordOmitsSummary'],
		shape: reportingShape,
		judge: succeeded((runReport, outcome) => {
			const judgedList = blockOf(outcome).decisionRecordList.filter((oneRecord) => oneRecord.judge !== undefined);
			const vocabularyLib = require(path.join(__dirname, '..', '..', 'vocabulary', 'vocabulary'));
			const badList = judgedList.filter((oneRecord) => oneRecord.judge.judgeSummary === undefined || vocabularyLib.judgeSummaryRefusal(oneRecord.judge.judgeSummary) !== '');
			return { pass: judgedList.length > 0 && badList.length === 0, detail: `${judgedList.length} judged record(s), ${badList.length} without a valid summary` };
		}),
	}),
	{
		conjunctId: 'd_cacheHitFreezesTheSameText',
		title: 'a second run served wholly from the cache freezes text byte-identical to the fresh run',
		twinNameList: ['cacheHitDropsSummary'],
		evaluate: (scenario, callback) => {
			const firstScenario = scenarioLib.cloneScenario(scenario);
			reportingShape(firstScenario);
			scenarioLib.runScenario(firstScenario, (unusedFirstError, firstOutcome) => {
				const secondScenario = scenarioLib.cloneScenario(scenario);
				reportingShape(secondScenario);
				secondScenario.stores = firstScenario.stores;
				const servedBefore = firstOutcome.runReport ? firstOutcome.runReport.judgeSpend || {} : {};
				scenarioLib.runScenario(secondScenario, (unusedSecondError, secondOutcome) => {
					const failure = firstOutcome.runError || secondOutcome.runError || firstOutcome.thrownFromRun || secondOutcome.thrownFromRun;
					if (failure) {
						callback('', { pass: false, detail: `a run failed: ${String(failure).slice(0, 260)}` });
						return;
					}
					const firstText = frozenTextOf(firstOutcome);
					const secondText = frozenTextOf(secondOutcome);
					const served = secondScenario.judgeClientOverride.callCount === 0;
					callback('', { pass: firstText !== null && firstText === secondText && served, detail: `fresh vs cached frozen text ${firstText === secondText ? 'IDENTICAL' : 'DIFFER'}; second run asked the client ${secondScenario.judgeClientOverride.callCount} time(s); first spend ${JSON.stringify(servedBefore)}` });
				});
			});
		},
	},
	runConjunct({
		conjunctId: 'e_partialProbabilityMapRefused',
		title: 'a client returning a probability map that omits an offered option is refused by name',
		twinNameList: ['offeredOptionCheckRemoved'],
		shape: (scenario) => { derivedShape(scenario); scenario.judgeClientOverride = numberReportingClient({ partial: true }); },
		judge: nameInRefusal(/the judge's probability map names \[[^\]]*\] but the question offered \[/),
	}),
	runConjunct({
		conjunctId: 'f_debugJudgeFreezesNoSummary',
		title: 'under the debug judge no frozen record carries judgeSummary',
		twinNameList: ['summaryAlwaysFrozen'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const judgedList = blockOf(outcome).decisionRecordList.filter((oneRecord) => oneRecord.judge !== undefined);
			const carrying = judgedList.filter((oneRecord) => Object.prototype.hasOwnProperty.call(oneRecord.judge, 'judgeSummary')).length;
			return { pass: judgedList.length > 0 && carrying === 0, detail: `${judgedList.length} judged record(s), ${carrying} carrying judgeSummary` };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESUMMARY', conjunctId: 'a_cacheRowCarriesTheSummary', twinName: 'putPayloadDropsSummary', fileName: JUDGE_FILE, find: 'chosenStableId: judged.chosenCardStableId, judgeSummary: judged.judgeSummary, ...predicateByFieldNameOf(judged) };', replace: 'chosenStableId: judged.chosenCardStableId, ...predicateByFieldNameOf(judged) };' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESUMMARY', conjunctId: 'b_forensicRecordCarriesTheSummary', twinName: 'forensicRecordNullsSummary', fileName: JUDGE_FILE, find: '					judgeSummary: judgment.judgeSummary,\n', replace: '					judgeSummary: null,\n' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESUMMARY', conjunctId: 'c_frozenRecordCarriesTheSummary', twinName: 'frozenRecordOmitsSummary', fileName: FRAMEWORK_FILE, find: '									judgeRecord.judgeSummary = judged.judgeSummary;', replace: '									judgeRecord.judgeSummaryDropped = true;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESUMMARY', conjunctId: 'd_cacheHitFreezesTheSameText', twinName: 'cacheHitDropsSummary', fileName: JUDGE_FILE, find: 'judgeSummary: remembered.judgeSummary === undefined ? null : remembered.judgeSummary,', replace: 'judgeSummary: null,' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESUMMARY', conjunctId: 'e_partialProbabilityMapRefused', twinName: 'offeredOptionCheckRemoved', fileName: JUDGE_FILE, find: '	if (judgeSummary !== null && JSON.stringify(Object.keys(judgeSummary.judgeProbabilityByChoice).sort()) !== JSON.stringify(question.choiceEnum.slice().sort())) {', replace: '	if (false) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESUMMARY', conjunctId: 'f_debugJudgeFreezesNoSummary', twinName: 'summaryAlwaysFrozen', fileName: FRAMEWORK_FILE, find: '								if (judged.judgeSummary !== null && judged.judgeSummary !== undefined) {', replace: '								if (true) {' });

const gateDeclarationList = [{ gateId: 'BG-JUDGESUMMARY', title: "the judge's own numbers carried verbatim to cache, forensics and the frozen record", conjunctList }];

runGateFamily(
	{ harness, familyName: 'BG-JUDGESUMMARY', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 6 },
	() => harness.report(),
);
