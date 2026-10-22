'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sifRegression.js — the SIF regression pair (DESIGN-WALK §4, cascade design §6): every SIF Question named PreferredName
// must reach CEDS "Other Name" (P000206), every one named StateProvinceId must reach Person Identifier (P001572). POOL
// RECALL ONLY: nothing is judged. A card REACHES a target when its property slot is the target property, on any class.
//
// SIF's own pool is K = 40 (sif260928CedsDerivedPlugin, D2's sweep), not Ed-Fi's 15. So every arm is reported at 15
// (A0's first 15 by its own rank), A0 additionally at its real 40, and every arm uncapped. A0 is first checked against
// the gold's frozen SIF records for these questions (same members), as Ed-Fi's A0 was.
//
// The walk questions carry the Question's material WITHOUT its judgment-partition label (the bridge renders the label
// only on a judged partition record; a walk is asked once per Question).

const path = require('path');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const candidateRetrievalMethodRegistryLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'candidateRetrievalMethodRegistry'));

const { buildStructureIndex } = require('./structureIndex');
const { makeWalkChooser } = require('./walkChooser');
const { ARM_ROW_LIST } = require('./armPools');
const { renderSubjectQuestion } = require('./subjectJudge');
const { buildArmsForSubject } = require('./armRun');
const { makeSpendLedger } = require('./spendLedger');

const reachesTarget = ({ structureIndex, cardStableIdList, targetPropertyStableId }) => cardStableIdList.some((oneCardStableId) => structureIndex.propertyStableIdListByCardStableId[oneCardStableId].indexOf(targetPropertyStableId) !== -1);

const runSifRegression = ({ experimentConfig, opened, runLabel, outDirPath, scratchDirPath }, callback) => {
	const { runContext, judgeClient, inGraph, bridgeRun } = opened;
	const targetBySubjectName = bridgeRun.regressionTargetPropertyStableIdBySubjectName;
	const subjectLabel = runContext.bridgeDeclaration.subjectSource.label;
	const subjectStableIdList = Object.keys(runContext.subjectNodeByStableId)
		.filter((oneStableId) => runContext.subjectNodeByStableId[oneStableId].labels.indexOf(subjectLabel) !== -1 && targetBySubjectName[runContext.subjectNodeByStableId[oneStableId].properties.name] !== undefined)
		.sort();
	const judgmentCacheFilePath = path.join(scratchDirPath, `sif-${runLabel}.judgmentCache.sqlite3`);
	if (fs.existsSync(judgmentCacheFilePath)) {
		callback(`${moduleName}: ${judgmentCacheFilePath} already exists; every run takes a FRESH cache`);
		return;
	}
	const goldBlock = JSON.parse(fs.readFileSync(bridgeRun.goldBlockFilePath, 'utf8'));
	const goldPoolListBySubjectStableId = goldBlock.decisionRecordList.reduce((soFar, oneRecord) => {
		(soFar[oneRecord.subjectStableId] = soFar[oneRecord.subjectStableId] || []).push(oneRecord.filteredPoolStableIdList.slice().sort().join('\n'));
		return soFar;
	}, {});
	const spendLedger = makeSpendLedger({ usdPerMillionInputTokens: experimentConfig.jevUsdPerMillionInputTokens, usdPerMillionOutputTokens: experimentConfig.jevUsdPerMillionOutputTokens });
	const taskList = new taskListPlus();
	taskList.push((args, next) => buildStructureIndex({ inGraph, cardSlotIndex: runContext.retrievalState.cardSlotIndex }, (indexError, structureIndex) => (indexError ? next(indexError) : next('', { ...args, structureIndex }))));
	taskList.push((args, next) => require(path.join(TREE_ROOT, 'lib', 'judgment-cache', 'judgment-cache'))().open({ databaseFilePath: judgmentCacheFilePath }, (openError, judgmentCache) => (openError ? next(openError) : next('', { ...args, judgmentCache }))));
	taskList.push((args, next) => {
		const walkChooser = makeWalkChooser({ judgeClient, judgmentCache: args.judgmentCache, choiceQuestionByKind: experimentConfig.choiceQuestionByKind, segmentSize: experimentConfig.choiceSegmentSize, spendLedger });
		const builtArmNameList = ARM_ROW_LIST.map((oneRow) => oneRow.armName);
		const subjectRowList = [];
		const buildAt = (subjectIndex) => {
			if (subjectIndex === subjectStableIdList.length) {
				next('', { ...args, subjectRowList });
				return;
			}
			const subjectStableId = subjectStableIdList[subjectIndex];
			const subjectName = runContext.subjectNodeByStableId[subjectStableId].properties.name;
			const targetPropertyStableId = targetBySubjectName[subjectName];
			const baselinePooled = candidateRetrievalMethodRegistryLib.poolForSubjectChecked({ methodRow: runContext.retrievalMethodRow, retrievalState: runContext.retrievalState, retrievalDeclaration: runContext.bridgeDeclaration.candidateRetrieval, subjectStableId, hubName: runContext.hubName });
			if (baselinePooled.error) {
				next(`${moduleName}: ${subjectStableId}: ${baselinePooled.error.message}`);
				return;
			}
			const rendered = renderSubjectQuestion({ runContext, subjectStableId, poolCardStableIdList: baselinePooled.seatStableIdList });
			if (rendered.error) {
				next(rendered.error);
				return;
			}
			const armInputBase = { runContext, structureIndex: args.structureIndex, walkChooser, walkWidth: experimentConfig.walkWidth, poolCardCount: experimentConfig.poolCardCount, subjectStableId, sourceElementData: rendered.question.choiceQuestion.stateObject.sourceElement };
			buildArmsForSubject({ armInputBase, builtArmNameList }, (buildError, built) => {
				if (buildError) {
					next(`${moduleName}: ${subjectStableId}: ${buildError}`);
					return;
				}
				const goldPoolTextList = goldPoolListBySubjectStableId[subjectStableId] || [];
				const reachByArmName = builtArmNameList.reduce((soFar, armName) => {
					const pool = built.poolMemo[armName];
					return Object.assign(soFar, {
						[armName]: {
							reachAt15: reachesTarget({ structureIndex: args.structureIndex, cardStableIdList: pool.cappedCardStableIdList.slice(0, experimentConfig.poolCardCount), targetPropertyStableId }),
							reachUncapped: reachesTarget({ structureIndex: args.structureIndex, cardStableIdList: pool.uncappedCardStableIdList, targetPropertyStableId }),
							walkTrace: pool.walkTrace,
						},
					});
				}, {});
				reachByArmName.A0.reachAtDeclaredK = reachesTarget({ structureIndex: args.structureIndex, cardStableIdList: built.poolMemo.A0.cappedCardStableIdList, targetPropertyStableId });
				subjectRowList.push({ subjectStableId, subjectName, targetPropertyStableId, a0MatchesGoldRecords: goldPoolTextList.length > 0 && goldPoolTextList.every((oneText) => oneText === baselinePooled.seatStableIdList.slice().sort().join('\n')), goldRecordCount: goldPoolTextList.length, reachByArmName });
				buildAt(subjectIndex + 1);
			});
		};
		buildAt(0);
	});
	pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
		if (pipelineError) {
			callback(pipelineError);
			return;
		}
		const subjectNameList = Object.keys(targetBySubjectName);
		const countReach = (subjectName, armName, reachName) => args.subjectRowList.filter((oneRow) => oneRow.subjectName === subjectName && oneRow.reachByArmName[armName][reachName] === true).length;
		const summary = {
			runLabel,
			subjectCount: args.subjectRowList.length,
			a0MatchesGoldCount: args.subjectRowList.filter((oneRow) => oneRow.a0MatchesGoldRecords).length,
			reachTable: subjectNameList.map((subjectName) => ({
				subjectName,
				copyCount: args.subjectRowList.filter((oneRow) => oneRow.subjectName === subjectName).length,
				byArmName: ARM_ROW_LIST.reduce((soFar, oneRow) => Object.assign(soFar, { [oneRow.armName]: { reachAt15: countReach(subjectName, oneRow.armName, 'reachAt15'), reachUncapped: countReach(subjectName, oneRow.armName, 'reachUncapped'), ...(oneRow.armName === 'A0' ? { reachAtDeclaredK: countReach(subjectName, 'A0', 'reachAtDeclaredK') } : {}) } }), {}),
			})),
			ledger: spendLedger.snapshot(),
			ledgerByKind: spendLedger.byKind(),
		};
		fs.writeFileSync(path.join(outDirPath, `sifRegression-${runLabel}.json`), `${JSON.stringify({ summary, subjectRowList: args.subjectRowList }, null, '\t')}\n`);
		callback('', summary);
	});
};

module.exports = { runSifRegression, moduleName };
