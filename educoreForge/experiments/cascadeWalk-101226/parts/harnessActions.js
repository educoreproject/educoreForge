'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// harnessActions.js — the harness's actions, each (actionContext, callback(errString, { summaryText, passed })).
// Shared opening (gold handle, judge provider, bridge run context) is one function so every action reads the
// graph the same way.

const path = require('path');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const BRIDGE_LIB = path.join(TREE_ROOT, 'lib', 'bridge-framework');
const BRIDGE_MAKER_LIB = path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib');
const candidateRetrievalMethodRegistryLib = require(path.join(BRIDGE_LIB, 'candidateRetrievalMethodRegistry'));
const judgeProviderRegistryLib = require(path.join(BRIDGE_MAKER_LIB, 'judgeProviderRegistry'));
// the framework's canonical form (bridge-framework.js binds it as canonicalJson); key order never decides a comparison
const canonicalJson = require(path.join(BRIDGE_LIB, 'bridgePluginContract')).canonicalJsonText;

const { resolveGoldGraphHandle } = require('./goldGraphHandle');
const { buildBridgeRunContext } = require('./bridgeRunContext');
const { renderSubjectQuestion } = require('./subjectJudge');
const { runArmsOnce } = require('./armRun');
const { ARM_ROW_LIST } = require('./armPools');

const requiredValue = ({ valueOf, valueName }) => {
	const given = valueOf(valueName);
	return typeof given === 'string' && given.trim() !== '' ? { value: given } : { error: `--${valueName} is required; there is no default (see -help)` };
};

// openBridgeRun — gold handle, judge provider (constructed, not called), and the bridge run context for one bridge
const openBridgeRun = ({ experimentConfig, bridgeRunLabel }, callback) => {
	const bridgeRun = experimentConfig.bridgeRunByLabel[bridgeRunLabel];
	if (bridgeRun === undefined) {
		callback(`${moduleName}: walkExperiment.json bridgeRunByLabel has no '${bridgeRunLabel}' (known: ${Object.keys(experimentConfig.bridgeRunByLabel).join(', ')})`);
		return;
	}
	const taskList = new taskListPlus();
	taskList.push((args, next) => resolveGoldGraphHandle({ containerName: experimentConfig.goldContainerName }, (handleError, inGraph) => (handleError ? next(handleError) : next('', { ...args, inGraph }))));
	taskList.push((args, next) => {
		judgeProviderRegistryLib.constructJudgeProvider(
			{ providerName: experimentConfig.judgeProviderName, configFilePathByProviderName: { [experimentConfig.judgeProviderName]: experimentConfig.judgeConfigFilePath }, componentOverrides: {} },
			(constructionError, judgeClient) => (constructionError ? next(`${moduleName}: ${constructionError}`) : next('', { ...args, judgeClient })),
		);
	});
	taskList.push((args, next) => buildBridgeRunContext({ inGraph: args.inGraph, bridgeRun, judgeClient: args.judgeClient }, (contextError, runContext) => (contextError ? next(contextError) : next('', { ...args, runContext }))));
	pipeRunner(taskList.getList(), {}, (pipelineError, args) => (pipelineError ? callback(pipelineError) : callback('', { inGraph: args.inGraph, judgeClient: args.judgeClient, runContext: args.runContext, bridgeRun })));
};

const sameMembers = (leftList, rightList) => leftList.length === rightList.length && leftList.slice().sort().join('\n') === rightList.slice().sort().join('\n');

// reproduceBaseline — DESIGN-WALK §7: A0 must reproduce the gold's frozen pools for the hundred BEFORE anything else
const reproduceBaseline = ({ experimentConfig, valueOf }, callback) => {
	const outDirResolution = requiredValue({ valueOf, valueName: 'outDirPath' });
	if (outDirResolution.error) {
		callback(outDirResolution.error);
		return;
	}
	const goldBlock = JSON.parse(fs.readFileSync(experimentConfig.goldEdfiBlockFilePath, 'utf8'));
	openBridgeRun({ experimentConfig, bridgeRunLabel: 'edfi' }, (openError, opened) => {
		if (openError) {
			callback(openError);
			return;
		}
		const { runContext, judgeClient, bridgeRun } = opened;
		const subjectStableIdList = JSON.parse(fs.readFileSync(bridgeRun.subjectSetFilePath, 'utf8'));
		const goldRecordBySubjectStableId = goldBlock.decisionRecordList.reduce((soFar, oneRecord) => Object.assign(soFar, { [oneRecord.subjectStableId]: oneRecord }), {});
		const identityCheckList = [
			{ checkName: 'generation', rebuilt: runContext.generation, gold: goldBlock.header.generation },
			{ checkName: 'judgeKind', rebuilt: `${judgeClient.model}`, gold: goldBlock.header.judgeKind },
			{ checkName: 'rendererVersion', rebuilt: runContext.variantRow.rendererVersion, gold: goldBlock.header.rendererVersion },
			{ checkName: 'candidateRetrieval', rebuilt: JSON.stringify(runContext.bridgeDeclaration.candidateRetrieval), gold: JSON.stringify(goldBlock.header.candidateRetrieval), compareAsJson: true },
		].map((oneCheck) => ({ ...oneCheck, agrees: oneCheck.compareAsJson ? JSON.stringify(JSON.parse(oneCheck.rebuilt), Object.keys(JSON.parse(oneCheck.rebuilt)).sort()) === JSON.stringify(JSON.parse(oneCheck.gold), Object.keys(JSON.parse(oneCheck.rebuilt)).sort()) : oneCheck.rebuilt === oneCheck.gold }));
		const subjectRowList = subjectStableIdList.map((subjectStableId) => {
			const goldRecord = goldRecordBySubjectStableId[subjectStableId];
			if (goldRecord === undefined) {
				return { subjectStableId, poolAgrees: false, promptHashAgrees: false, detail: 'no gold record for this subject' };
			}
			const pooled = candidateRetrievalMethodRegistryLib.poolForSubjectChecked({ methodRow: runContext.retrievalMethodRow, retrievalState: runContext.retrievalState, retrievalDeclaration: runContext.bridgeDeclaration.candidateRetrieval, subjectStableId, hubName: runContext.hubName });
			if (pooled.error) {
				return { subjectStableId, poolAgrees: false, promptHashAgrees: false, detail: pooled.error.message };
			}
			const rendered = renderSubjectQuestion({ runContext, subjectStableId, poolCardStableIdList: pooled.seatStableIdList });
			const rebuiltPromptHash = rendered.error ? null : rendered.question.promptHash;
			const rebuiltRankList = pooled.recordTraceByFieldName.retrievalVoteList.map((oneVote) => oneVote.stableId);
			const goldRankList = goldRecord.retrievalVoteList.map((oneVote) => oneVote.stableId);
			// a rank list holding an undefined stableId would compare equal to another such list and prove nothing
			const rankOrderAgrees = rebuiltRankList.every((oneStableId) => typeof oneStableId === 'string') && JSON.stringify(rebuiltRankList) === JSON.stringify(goldRankList);
			return {
				subjectStableId,
				poolSize: pooled.seatStableIdList.length,
				poolAgrees: sameMembers(pooled.seatStableIdList, goldRecord.filteredPoolStableIdList),
				rankOrderAgrees,
				traceAgrees: canonicalJson(pooled.recordTraceByFieldName) === canonicalJson({ retrievalVoteList: goldRecord.retrievalVoteList, neighbourTrace: goldRecord.neighbourTrace }),
				promptHashAgrees: rebuiltPromptHash === goldRecord.judge.promptHash,
				rebuiltPromptHash,
				goldPromptHash: goldRecord.judge.promptHash,
				detail: rendered.error || '',
			};
		});
		runContext.reader.close(() => {
			const countWhere = (fieldName) => subjectRowList.filter((oneRow) => oneRow[fieldName] === true).length;
			const passed = identityCheckList.every((oneCheck) => oneCheck.agrees) && countWhere('poolAgrees') === subjectRowList.length && countWhere('promptHashAgrees') === subjectRowList.length;
			const reproduction = { goldBlockHash: experimentConfig.goldEdfiBlockHash, goldContainerName: experimentConfig.goldContainerName, subjectCount: subjectRowList.length, poolAgreeCount: countWhere('poolAgrees'), rankOrderAgreeCount: countWhere('rankOrderAgrees'), traceAgreeCount: countWhere('traceAgrees'), promptHashAgreeCount: countWhere('promptHashAgrees'), identityCheckList, passed, subjectRowList };
			fs.writeFileSync(path.join(outDirResolution.value, 'a0Reproduction.json'), `${JSON.stringify(reproduction, null, '\t')}\n`);
			const summaryText = [
				`A0 reproduction against gold block ${reproduction.goldBlockHash.slice(0, 12)} on ${experimentConfig.goldContainerName}:`,
				...identityCheckList.map((oneCheck) => `  ${oneCheck.agrees ? 'AGREES ' : 'DIFFERS'} ${oneCheck.checkName}${oneCheck.agrees ? '' : `: rebuilt ${oneCheck.rebuilt} | gold ${oneCheck.gold}`}`),
				`  pools (same members)   ${reproduction.poolAgreeCount}/${reproduction.subjectCount}`,
				`  rank order             ${reproduction.rankOrderAgreeCount}/${reproduction.subjectCount}`,
				`  frozen trace (bytes)   ${reproduction.traceAgreeCount}/${reproduction.subjectCount}`,
				`  promptHash             ${reproduction.promptHashAgreeCount}/${reproduction.subjectCount}`,
				`  VERDICT ${passed ? 'REPRODUCES' : 'DOES NOT REPRODUCE'}`,
			].join('\n');
			callback('', { summaryText, passed });
		});
	});
};

// runArms — one run (design §5): --runLabel names it and its fresh cache; --armList narrows the arms (optional,
// documented in -help: all four when absent); --subjectLimit takes the first n subjects of the set (optional, for a smoke)
const runArms = ({ experimentConfig, valueOf }, callback) => {
	const resolutionList = ['runLabel', 'outDirPath', 'scratchDirPath'].map((valueName) => ({ valueName, ...requiredValue({ valueOf, valueName }) }));
	const unresolved = resolutionList.find((oneResolution) => oneResolution.error);
	if (unresolved) {
		callback(unresolved.error);
		return;
	}
	const [runLabel, outDirPath, scratchDirPath] = resolutionList.map((oneResolution) => oneResolution.value);
	const knownArmNameList = ARM_ROW_LIST.map((oneRow) => oneRow.armName);
	const askedArmNameList = valueOf('armList') === undefined ? knownArmNameList : `${valueOf('armList')}`.split(',');
	const unknownArmName = askedArmNameList.find((oneName) => knownArmNameList.indexOf(oneName) === -1);
	if (unknownArmName !== undefined) {
		callback(`--armList names '${unknownArmName}'; the arms are ${knownArmNameList.join(', ')}`);
		return;
	}
	const subjectLimitText = valueOf('subjectLimit');
	if (subjectLimitText !== undefined && !/^[1-9][0-9]*$/.test(`${subjectLimitText}`)) {
		callback(`--subjectLimit is '${subjectLimitText}'; it must be a positive integer`);
		return;
	}
	openBridgeRun({ experimentConfig, bridgeRunLabel: 'edfi' }, (openError, opened) => {
		if (openError) {
			callback(openError);
			return;
		}
		const fullSubjectList = JSON.parse(fs.readFileSync(opened.bridgeRun.subjectSetFilePath, 'utf8'));
		const subjectStableIdList = subjectLimitText === undefined ? fullSubjectList : fullSubjectList.slice(0, Number(subjectLimitText));
		// spend already made by earlier runs in this output directory, for the projection against the design's stop
		const earlierSummaryList = fs.existsSync(outDirPath) ? fs.readdirSync(outDirPath).filter((oneName) => oneName.indexOf('run-') === 0 && oneName !== `run-${runLabel}` && fs.existsSync(path.join(outDirPath, oneName, 'runSummary.json'))).map((oneName) => JSON.parse(fs.readFileSync(path.join(outDirPath, oneName, 'runSummary.json'), 'utf8'))) : [];
		const spendSoFarUsd = earlierSummaryList.reduce((soFar, oneSummary) => soFar + oneSummary.ledger.usd, 0);
		const runsRemainingIncludingThis = Math.max(1, experimentConfig.plannedRunCount - earlierSummaryList.length);
		runArmsOnce({ experimentConfig, opened, runLabel, outDirPath, scratchDirPath, askedArmNameList, subjectStableIdList, spendSoFarUsd, runsRemainingIncludingThis }, (runError, runSummary) => {
			opened.runContext.reader.close(() => {
				if (runError) {
					callback(runError);
					return;
				}
				const kindText = Object.keys(runSummary.ledgerByKind).map((oneKind) => `  ${oneKind.padEnd(10)} asked ${runSummary.ledgerByKind[oneKind].askedCount}, served from cache ${runSummary.ledgerByKind[oneKind].servedFromCacheCount}, tokens in ${runSummary.ledgerByKind[oneKind].inputTokens} out ${runSummary.ledgerByKind[oneKind].outputTokens}`).join('\n');
				callback('', { summaryText: `run ${runLabel}: ${runSummary.subjectDoneCount}/${runSummary.subjectCount} subject(s), arms ${askedArmNameList.join(',')}, ${(runSummary.wallMs / 1000).toFixed(0)} s, US$${runSummary.ledger.usd.toFixed(4)}\n${kindText}`, passed: true });
			});
		});
	});
};
const sifRecall = (actionContext, callback) => callback(`${moduleName}: -sifRecall is not built yet`);

module.exports = { reproduceBaseline, runArms, sifRecall, openBridgeRun, requiredValue, moduleName };
