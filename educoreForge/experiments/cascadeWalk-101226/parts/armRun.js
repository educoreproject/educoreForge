'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// armRun.js — ONE run of the experiment (design §5 "Repetition"): every asked arm over the subject set, with ONE fresh
// judgment cache shared by the arms of this run (so an arm whose pool equals another's gets the same answer, as the
// bridge would), a fresh forensic trail, and a spend ledger checked after every subject against the design's stop.
// Per subject the arms are built in ARM_ROW_LIST order, then each asked arm's capped pool is judged.

const path = require('path');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const boundedRunnerLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'boundedRunner'));
const candidateRetrievalMethodRegistryLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'candidateRetrievalMethodRegistry'));

const { buildStructureIndex } = require('./structureIndex');
const { makeWalkChooser } = require('./walkChooser');
const { ARM_ROW_LIST, ARM_PREREQUISITE_BY_ARM_NAME } = require('./armPools');
const { renderSubjectQuestion, judgeSubject } = require('./subjectJudge');
const { makeSpendLedger } = require('./spendLedger');

// buildArmsForSubject — every arm the run needs, in registry order, sequentially (A2 and A3 read earlier pools)
const buildArmsForSubject = ({ armInputBase, builtArmNameList }, callback) => {
	const poolMemo = {};
	const timingMsByArmName = {};
	const armRowList = ARM_ROW_LIST.filter((oneRow) => builtArmNameList.indexOf(oneRow.armName) !== -1);
	const buildAt = (armIndex) => {
		if (armIndex === armRowList.length) {
			callback('', { poolMemo, timingMsByArmName });
			return;
		}
		const armRow = armRowList[armIndex];
		const startedAtMs = Date.now();
		armRow.buildPool({ ...armInputBase, poolMemo }, (buildError, pool) => {
			if (buildError) {
				callback(`${armRow.armName}: ${buildError}`);
				return;
			}
			poolMemo[armRow.armName] = pool;
			timingMsByArmName[armRow.armName] = Date.now() - startedAtMs;
			buildAt(armIndex + 1);
		});
	};
	buildAt(0);
};

// judgeArmsForSubject — the judge over each asked arm's capped pool. An empty pool is a noCandidate orphan, as the
// framework classifies it (no judge call, no edge); it is recorded as such, never as an abstention by the judge.
const judgeArmsForSubject = ({ runContext, judgeRunState, subjectStableId, poolMemo, askedArmNameList, timingMsByArmName }, callback) => {
	const armResultByArmName = {};
	const judgeAt = (armIndex) => {
		if (armIndex === askedArmNameList.length) {
			callback('', armResultByArmName);
			return;
		}
		const armName = askedArmNameList[armIndex];
		const pool = poolMemo[armName];
		const armResultBase = { cappedCardStableIdList: pool.cappedCardStableIdList, uncappedCount: pool.uncappedCardStableIdList.length, uncappedCardStableIdList: pool.uncappedCardStableIdList, walkTrace: pool.walkTrace, buildMs: timingMsByArmName[armName] };
		if (pool.cappedCardStableIdList.length === 0) {
			armResultByArmName[armName] = { ...armResultBase, outcome: 'noCandidate', judged: null, judgeMs: 0 };
			judgeAt(armIndex + 1);
			return;
		}
		const startedAtMs = Date.now();
		judgeSubject({ runContext, judgeRunState, subjectStableId, poolCardStableIdList: pool.cappedCardStableIdList }, (judgeError, judgeResult) => {
			if (judgeError) {
				callback(`${armName}: ${judgeError}`);
				return;
			}
			const judged = judgeResult.judged;
			judgeRunState.spendLedger.record({ ledgerKind: 'judge', cacheHit: judged.cacheHit, usage: judged.usage });
			armResultByArmName[armName] = {
				...armResultBase,
				outcome: judged.chosenCardStableId === null ? 'abstained' : 'picked',
				judged: { choice: judged.choice, chosenCardStableId: judged.chosenCardStableId, category: judged.category, predicate: judged.predicate === undefined ? null : judged.predicate, judgeSummary: judged.judgeSummary, promptHash: judged.promptHash, cacheHit: judged.cacheHit, usage: judged.usage },
				judgeMs: Date.now() - startedAtMs,
			};
			judgeAt(armIndex + 1);
		});
	};
	judgeAt(0);
};

const runArmsOnce = ({ experimentConfig, opened, runLabel, outDirPath, scratchDirPath, askedArmNameList, subjectStableIdList, spendSoFarUsd, runsRemainingIncludingThis }, callback) => {
	const { runContext, judgeClient, inGraph } = opened;
	const builtArmNameList = Array.from(new Set([].concat(...askedArmNameList.map((oneName) => ARM_PREREQUISITE_BY_ARM_NAME[oneName].concat([oneName])))));
	const judgmentCacheFilePath = path.join(scratchDirPath, `${runLabel}.judgmentCache.sqlite3`);
	if (fs.existsSync(judgmentCacheFilePath)) {
		callback(`${moduleName}: ${judgmentCacheFilePath} already exists; every run takes a FRESH judgment cache (design §5). Name a new --runLabel or remove the old run's cache yourself.`);
		return;
	}
	const runOutDirPath = path.join(outDirPath, `run-${runLabel}`);
	fs.mkdirSync(runOutDirPath, { recursive: true });
	const spendLedger = makeSpendLedger({ usdPerMillionInputTokens: experimentConfig.jevUsdPerMillionInputTokens, usdPerMillionOutputTokens: experimentConfig.jevUsdPerMillionOutputTokens });
	const taskList = new taskListPlus();
	taskList.push((args, next) => buildStructureIndex({ inGraph, cardSlotIndex: runContext.retrievalState.cardSlotIndex }, (indexError, structureIndex) => (indexError ? next(indexError) : next('', { ...args, structureIndex }))));
	taskList.push((args, next) => require(path.join(TREE_ROOT, 'lib', 'judgment-cache', 'judgment-cache'))().open({ databaseFilePath: judgmentCacheFilePath }, (openError, judgmentCache) => (openError ? next(openError) : next('', { ...args, judgmentCache }))));
	taskList.push((args, next) => require(path.join(TREE_ROOT, 'lib', 'match-forensics', 'match-forensics'))().open({ baseDirPath: path.join(scratchDirPath, `${runLabel}.matchForensics`) }, (openError, matchForensics) => (openError ? next(openError) : next('', { ...args, matchForensics }))));
	taskList.push((args, next) => {
		const walkChooser = makeWalkChooser({ judgeClient, judgmentCache: args.judgmentCache, choiceQuestionByKind: experimentConfig.choiceQuestionByKind, segmentSize: experimentConfig.choiceSegmentSize, spendLedger });
		const judgeRunState = { judgeClient, judgmentCache: args.judgmentCache, matchForensics: args.matchForensics, budget: { maxJudgmentCount: 20000, judgmentCountSoFar: 0 }, spendLedger };
		const rowStream = fs.createWriteStream(path.join(runOutDirPath, 'subjectRows.jsonl'));
		let subjectDoneCount = 0;
		let stopReason = '';
		const runStartedAtMs = Date.now();
		boundedRunnerLib.runBounded(
			{
				itemList: subjectStableIdList,
				concurrency: judgeClient.maxConcurrency,
				oneItem: (subjectStableId, subjectIndex, itemDone) => {
					if (stopReason) {
						itemDone(stopReason);
						return;
					}
					const subjectStartedAtMs = Date.now();
					const ledgerBefore = spendLedger.snapshot();
					// the subject's material exactly as the judge's split question carries it, rendered once over A0's pool
					// (the subject object does not depend on the pool)
					const baselinePooled = candidateRetrievalMethodRegistryLib.poolForSubjectChecked({ methodRow: runContext.retrievalMethodRow, retrievalState: runContext.retrievalState, retrievalDeclaration: runContext.bridgeDeclaration.candidateRetrieval, subjectStableId, hubName: runContext.hubName });
					if (baselinePooled.error) {
						itemDone(`subject ${subjectStableId}: ${baselinePooled.error.message}`);
						return;
					}
					const rendered = renderSubjectQuestion({ runContext, subjectStableId, poolCardStableIdList: baselinePooled.seatStableIdList });
					if (rendered.error) {
						itemDone(rendered.error);
						return;
					}
					const armInputBase = { runContext, structureIndex: args.structureIndex, walkChooser, walkWidth: experimentConfig.walkWidth, poolCardCount: experimentConfig.poolCardCount, subjectStableId, sourceElementData: rendered.question.choiceQuestion.stateObject.sourceElement };
					buildArmsForSubject({ armInputBase, builtArmNameList }, (buildError, built) => {
						if (buildError) {
							itemDone(`subject ${subjectStableId}: ${buildError}`);
							return;
						}
						judgeArmsForSubject({ runContext, judgeRunState, subjectStableId, poolMemo: built.poolMemo, askedArmNameList, timingMsByArmName: built.timingMsByArmName }, (judgeError, armResultByArmName) => {
							if (judgeError) {
								itemDone(`subject ${subjectStableId}: ${judgeError}`);
								return;
							}
							rowStream.write(`${JSON.stringify({ runLabel, subjectIndex, subjectStableId, subjectMs: Date.now() - subjectStartedAtMs, spendForSubject: spendLedger.differenceSince(ledgerBefore), armResultByArmName })}\n`);
							subjectDoneCount += 1;
							const projectedTotalUsd = spendSoFarUsd + (spendLedger.snapshot().usd / subjectDoneCount) * subjectStableIdList.length * runsRemainingIncludingThis;
							if (projectedTotalUsd > experimentConfig.spendStopUsd) {
								stopReason = `${moduleName}: STOP — projected spend US$${projectedTotalUsd.toFixed(2)} passes the design's US$${experimentConfig.spendStopUsd} after ${subjectDoneCount} subject(s)`;
							}
							process.stderr.write(`[${runLabel}] ${subjectDoneCount}/${subjectStableIdList.length} ${subjectStableId}  run spend US$${spendLedger.snapshot().usd.toFixed(4)}\n`);
							itemDone('', null);
						});
					});
				},
			},
			(runError) => {
				rowStream.end(() => {
					const runSummary = { runLabel, askedArmNameList, builtArmNameList, subjectCount: subjectStableIdList.length, subjectDoneCount, wallMs: Date.now() - runStartedAtMs, judgeModel: judgeClient.model, judgmentCacheFilePath, ledger: spendLedger.snapshot(), ledgerByKind: spendLedger.byKind(), runError: runError || '' };
					fs.writeFileSync(path.join(runOutDirPath, 'runSummary.json'), `${JSON.stringify(runSummary, null, '\t')}\n`);
					next(runError || '', { ...args, runSummary });
				});
			},
		);
	});
	pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
		if (pipelineError) {
			callback(pipelineError);
			return;
		}
		callback('', args.runSummary);
	});
};

module.exports = { runArmsOnce, buildArmsForSubject, moduleName };
