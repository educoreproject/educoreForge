#!/usr/bin/env node
'use strict';

// sifRetrievalReplay.js — phase D2's retrieval-level instrument (PLAN small phases §3 D2; RULING round-2 #17, round 3
// K5). Over ONE read of a live DEV_ graph and the SIF debug block frozen from it, it runs, in order:
//   the CONTROL — the replay at the block's own settings with nothing excluded must reproduce every record's ORDERED
//     retrievalVoteList exactly (gate (b)'s precondition; never compared with the rendered pool);
//   the SWEEP — every cell of the run spec, each scored by the C5 yardstick scorer and reduced to specified-target
//     admission (unit grain, and weighted by annotated rows), rank and pool distributions and the per-block split;
//   the RULE — the cell chosen by the selection rule committed to DEVLOG-D2 before the first cell;
//   the TWIN — the chosen cell again with every subject text whose propertyNameList is exactly ['contextText'] dropped.
// It writes the report (JSON and markdown) and the hit dump (every specified unit whose target missed the chosen
// cell's pool). READ-ONLY: it opens READ sessions through the framework's own graph reader, embeds nothing and judges nothing.
//
// Run: PATH=/usr/local/bin:$PATH node --max-old-space-size=16000 forges/sif260928/tools/sifRetrievalReplay.js --runSpecFilePath=<json>

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the D2 control, settings sweep and context-text twin over one read of a DEV_ graph

SYNOPSIS
     ${moduleName} --runSpecFilePath=<abs path to the run spec JSON>

     The run spec names: containerName (DEV_*), decisionBlockFilePath, annotationFilePath, questionMapFilePath,
     cardListFilePath, remodelTableFilePath, sourceStandardName, hubToken, poolMedianLimit, cellList
     [{ cellName, hitsPerText, minScore, k }], twinExcludedPropertyNameListList, outputDirPath.

EXIT
     0 the report is written (the gate verdicts are IN it);  1 refused.
`;

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const { graphReaderFactory } = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'graphReader'));
const sifYardstickScorer = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'test', 'bridgeAcceptance', 'sifYardstickScorer'));
const replayLib = require(path.join(__dirname, 'sifRetrievalReplayLib'));
const { bridgeDeclaration } = require(path.join(__dirname, '..', 'bridges', 'sif260928CedsDerivedPlugin'));

const RUN_SPEC_FIELD_NAME_LIST = Object.freeze(['containerName', 'decisionBlockFilePath', 'annotationFilePath', 'questionMapFilePath', 'cardListFilePath', 'remodelTableFilePath', 'sourceStandardName', 'hubToken', 'poolMedianLimit', 'cellList', 'twinExcludedPropertyNameListList', 'outputDirPath']);
const CELL_FIELD_NAME_LIST = Object.freeze(['cellName', 'hitsPerText', 'minScore', 'k']);
const SCRATCH_CONTAINER_PATTERN = /^DEV_[A-Za-z0-9_]+$/;
const ADMISSION_BAR_PERCENT = 81.7;

const refuseAndExit = (refusalText) => {
	xLog.error(`${moduleName}: REFUSED: ${refusalText}`);
	process.exit(1);
};
const secondsSince = (startMilliseconds) => ((Date.now() - startMilliseconds) / 1000).toFixed(1);

// ---- the run spec: every field present, nothing defaulted ----
const runSpecFilePathValue = commandLineParameters.values.runSpecFilePath;
const runSpecFilePath = Array.isArray(runSpecFilePathValue) ? runSpecFilePathValue[0] : runSpecFilePathValue;
if (typeof runSpecFilePath !== 'string' || !fs.existsSync(runSpecFilePath)) {
	refuseAndExit(`--runSpecFilePath is required and must exist (got ${JSON.stringify(runSpecFilePath)})`);
}
const runSpec = JSON.parse(fs.readFileSync(runSpecFilePath, 'utf8'));
const missingFieldName = RUN_SPEC_FIELD_NAME_LIST.find((oneFieldName) => runSpec[oneFieldName] === undefined);
if (missingFieldName !== undefined) {
	refuseAndExit(`the run spec lacks '${missingFieldName}'; it names ${RUN_SPEC_FIELD_NAME_LIST.join(', ')}, and none has a default`);
}
if (!SCRATCH_CONTAINER_PATTERN.test(runSpec.containerName)) {
	refuseAndExit(`containerName ${JSON.stringify(runSpec.containerName)} is not a DEV_ scratch graph; GOLD_*, gf_* and served graphs are never read`);
}
const malformedCell = runSpec.cellList.find((oneCell) => CELL_FIELD_NAME_LIST.some((oneFieldName) => oneCell[oneFieldName] === undefined));
if (malformedCell !== undefined) {
	refuseAndExit(`cell ${JSON.stringify(malformedCell)} does not name every one of ${CELL_FIELD_NAME_LIST.join(', ')}`);
}
['annotationFilePath', 'questionMapFilePath', 'cardListFilePath', 'remodelTableFilePath', 'decisionBlockFilePath', 'outputDirPath'].forEach((oneFieldName) => {
	if (!fs.existsSync(runSpec[oneFieldName])) {
		refuseAndExit(`the run spec's ${oneFieldName} ${runSpec[oneFieldName]} does not exist`);
	}
});

const decisionBlock = JSON.parse(fs.readFileSync(runSpec.decisionBlockFilePath, 'utf8'));
const blockRetrieval = decisionBlock.header.candidateRetrieval;
if (blockRetrieval.method !== 'embedTextVote-v1' || blockRetrieval.neighbourVote !== null) {
	refuseAndExit(`the block's candidateRetrieval is ${JSON.stringify(blockRetrieval)}; this instrument replays embedTextVote-v1 with neighbourVote null only`);
}
const yardstick = {
	annotation: JSON.parse(fs.readFileSync(runSpec.annotationFilePath, 'utf8')),
	questionMap: JSON.parse(fs.readFileSync(runSpec.questionMapFilePath, 'utf8')),
	cardList: JSON.parse(fs.readFileSync(runSpec.cardListFilePath, 'utf8')),
	remodelTable: JSON.parse(fs.readFileSync(runSpec.remodelTableFilePath, 'utf8')),
};

// ---- the container's bolt port and generated password, from docker (replayManager mints both) ----
const inspectText = childProcess.execFileSync('docker', ['inspect', runSpec.containerName, '--format', '{{range .Config.Env}}{{println .}}{{end}}|{{(index (index .NetworkSettings.Ports "7687/tcp") 0).HostPort}}'], { encoding: 'utf8' });
const [envText, boltPortText] = inspectText.split('|');
const authLine = envText.split('\n').find((oneLine) => oneLine.startsWith('NEO4J_AUTH='));
if (authLine === undefined) {
	refuseAndExit(`${runSpec.containerName} carries no NEO4J_AUTH`);
}
const inGraph = { boltUrl: `bolt://localhost:${boltPortText.trim()}`, password: authLine.split('/').slice(1).join('/') };

// ---- one cell: replay, score, reduce ----
const cellResultFor = ({ replayIndex, cell, excludedPropertyNameListList }) => {
	const startMilliseconds = Date.now();
	const replayed = replayLib.replayVoteLists({ replayIndex, retrievalSettings: cell, subjectStableIdList: decisionBlock.decisionRecordList.map((oneRecord) => oneRecord.subjectStableId), excludedPropertyNameListList });
	if (replayed.error) {
		return { error: replayed.error.message };
	}
	const scorableBlock = replayLib.scorableBlockFor({ decisionBlock, voteListBySubjectStableId: replayed.voteListBySubjectStableId, retrievalSettings: cell });
	const scored = sifYardstickScorer.scoreBlock({ decisionBlock: scorableBlock, ...yardstick });
	if (scored.error) {
		return { error: scored.error.message };
	}
	const admission = replayLib.admissionReportFor({ score: scored.score, scorableBlock, annotation: yardstick.annotation });
	return { cellResult: { cell, excludedPropertyNameListList, excludedTextRecordCount: replayed.excludedTextRecordCount, admission, recallByK: scored.score.retrieval.recallByK, seconds: Number(secondsSince(startMilliseconds)) }, voteListBySubjectStableId: replayed.voteListBySubjectStableId, score: scored.score, markdownText: scored.markdownText };
};

const taskList = new taskListPlus();

taskList.push((args, next) => {
	const startMilliseconds = Date.now();
	const reader = graphReaderFactory({ inGraph, dependencyStandardNameList: [runSpec.sourceStandardName, runSpec.hubToken], sourceStandardName: runSpec.sourceStandardName, blindingDeclaration: bridgeDeclaration.blindingDeclaration.slice() });
	replayLib.readRetrievalInputs({ retrievalView: reader.forRetrieval(), sourceStandardName: runSpec.sourceStandardName, hubStandardName: decisionBlock.header.hubName }, (readError, retrievalInputs) => {
		reader.close(() => {
			if (readError) {
				next(readError);
				return;
			}
			const readCountText = `hub vectors ${retrievalInputs.hubVectorRecordList.length}, source text records ${retrievalInputs.sourceTextRecordList.length}, hub text records ${retrievalInputs.hubTextRecordList.length}, card slot edges ${retrievalInputs.cardBaseEdgeList.length}`;
			xLog.status(`${moduleName}: the one read, ${secondsSince(startMilliseconds)}s: ${readCountText}`);
			next('', { ...args, retrievalInputs, readCountText, readSeconds: Number(secondsSince(startMilliseconds)) });
		});
	});
});

taskList.push((args, next) => {
	const built = replayLib.makeReplayIndex({ retrievalInputs: args.retrievalInputs, embeddingModelVersion: blockRetrieval.embeddingModelVersion, hubName: decisionBlock.header.hubName });
	if (built.error) {
		next(built.error.message);
		return;
	}
	next('', { ...args, replayIndex: built.replayIndex });
});

// THE CONTROL — the block's own settings, nothing excluded, every record's ordered list compared
taskList.push((args, next) => {
	const controlCell = { cellName: 'control', hitsPerText: blockRetrieval.hitsPerText, minScore: blockRetrieval.minScore, k: blockRetrieval.k };
	const controlled = cellResultFor({ replayIndex: args.replayIndex, cell: controlCell, excludedPropertyNameListList: [] });
	if (controlled.error) {
		next(controlled.error);
		return;
	}
	const compared = replayLib.compareWithBlock({ decisionBlock, voteListBySubjectStableId: controlled.voteListBySubjectStableId });
	xLog.status(`${moduleName}: CONTROL at ${JSON.stringify(controlCell)}: ${compared.comparedRecordCount - compared.differingRecordList.length} of ${compared.comparedRecordCount} record(s) reproduce the block's ordered retrievalVoteList; ${compared.differingRecordList.length} differ`);
	next('', { ...args, control: { controlCell, comparedRecordCount: compared.comparedRecordCount, differingRecordCount: compared.differingRecordList.length, differingRecordSampleList: compared.differingRecordList.slice(0, 20), cellResult: controlled.cellResult } });
});

// THE SWEEP — every cell of the run spec
taskList.push((args, next) => {
	const cellResultList = [];
	const scoreByCellName = {};
	const markdownTextByCellName = {};
	for (let cellIndex = 0; cellIndex < runSpec.cellList.length; cellIndex++) {
		const cell = runSpec.cellList[cellIndex];
		const celled = cellResultFor({ replayIndex: args.replayIndex, cell, excludedPropertyNameListList: [] });
		if (celled.error) {
			next(`cell ${cell.cellName}: ${celled.error}`);
			return;
		}
		cellResultList.push(celled.cellResult);
		scoreByCellName[cell.cellName] = celled.score;
		markdownTextByCellName[cell.cellName] = celled.markdownText;
		const overall = celled.cellResult.admission.overall;
		xLog.status(`${moduleName}: cell ${cell.cellName} ${JSON.stringify(cell)}: admitted ${overall.admittedUnitCount} of ${overall.specifiedUnitCount} specified units (${overall.admissionPercent}%), rows ${overall.rowWeightedAdmissionPercent}%, median pool ${celled.cellResult.admission.pool.medianPoolSize}, ${celled.cellResult.seconds}s`);
	}
	const chosen = replayLib.chooseCell({ cellResultList, poolMedianLimit: runSpec.poolMedianLimit });
	if (chosen.error) {
		next(chosen.error.message);
		return;
	}
	xLog.status(`${moduleName}: the rule chooses cell ${chosen.chosenCellName}`);
	next('', { ...args, cellResultList, scoreByCellName, markdownTextByCellName, chosen });
});

// THE TWIN — the chosen cell with the context texts dropped
taskList.push((args, next) => {
	const chosenCell = runSpec.cellList.find((oneCell) => oneCell.cellName === args.chosen.chosenCellName);
	const twinned = cellResultFor({ replayIndex: args.replayIndex, cell: chosenCell, excludedPropertyNameListList: runSpec.twinExcludedPropertyNameListList });
	if (twinned.error) {
		next(`twin: ${twinned.error}`);
		return;
	}
	const chosenResult = args.cellResultList.find((oneResult) => oneResult.cell.cellName === chosenCell.cellName);
	xLog.status(`${moduleName}: TWIN (${JSON.stringify(runSpec.twinExcludedPropertyNameListList)} excluded, ${twinned.cellResult.excludedTextRecordCount} text record(s)) at cell ${chosenCell.cellName}: admitted ${twinned.cellResult.admission.overall.admittedUnitCount} of ${twinned.cellResult.admission.overall.specifiedUnitCount} (${twinned.cellResult.admission.overall.admissionPercent}%) against ${chosenResult.admission.overall.admissionPercent}%`);
	next('', { ...args, chosenCell, chosenResult, twinResult: twinned.cellResult });
});

pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
	if (pipelineError) {
		refuseAndExit(pipelineError);
	}
	const { control, cellResultList, chosen, chosenCell, chosenResult, twinResult, scoreByCellName, markdownTextByCellName } = args;
	const chosenScore = scoreByCellName[chosenCell.cellName];
	const missedUnitList = chosenScore.unitVerdictList.filter((oneVerdict) => oneVerdict.standing === 'specified' && oneVerdict.bestKeyRank === null).map((oneVerdict) => ({ subjectStableId: oneVerdict.subjectStableId, judgmentPartitionLabel: oneVerdict.judgmentPartitionLabel, sharedBlock: oneVerdict.sharedBlock, cedsElementId: oneVerdict.cedsElementId, remodeledToCedsElementId: oneVerdict.remodeledToCedsElementId, targetCardStableId: oneVerdict.targetCardStableId }));
	const report = {
		generatedBy: moduleName,
		runSpecFilePath,
		decisionBlock: { filePath: runSpec.decisionBlockFilePath, generation: decisionBlock.header.generation, candidateRetrieval: blockRetrieval, recordCount: decisionBlock.decisionRecordList.length },
		containerName: runSpec.containerName,
		oneRead: { readCountText: args.readCountText, seconds: args.readSeconds },
		control: { ...control, verdict: control.differingRecordCount === 0 ? 'REPRODUCED' : 'NOT REPRODUCED' },
		selectionRule: { poolMedianLimit: runSpec.poolMedianLimit, chosenCellName: chosen.chosenCellName, ruleTrace: chosen.ruleTrace },
		cellResultList,
		gateA: { admissionBarPercent: ADMISSION_BAR_PERCENT, chosenCellAdmissionPercent: chosenResult.admission.overall.admissionPercent, verdict: chosenResult.admission.overall.admissionPercent >= ADMISSION_BAR_PERCENT ? 'AT OR ABOVE THE BAR' : 'BELOW THE BAR — STOP' },
		twin: { excludedPropertyNameListList: runSpec.twinExcludedPropertyNameListList, twinResult, admissionDeltaPercentPoints: Number((chosenResult.admission.overall.admissionPercent - twinResult.admission.overall.admissionPercent).toFixed(2)), verdict: twinResult.admission.overall.admissionPercent < chosenResult.admission.overall.admissionPercent ? 'TWIN LOWER' : 'TWIN NOT LOWER' },
		hitDump: { cellName: chosenCell.cellName, missedSpecifiedUnitCount: missedUnitList.length, missedUnitList },
	};
	fs.writeFileSync(path.join(runSpec.outputDirPath, 'd2RetrievalReport.json'), `${JSON.stringify(report, null, '\t')}\n`);
	fs.writeFileSync(path.join(runSpec.outputDirPath, `d2HitDump-${chosenCell.cellName}.json`), `${JSON.stringify(report.hitDump, null, '\t')}\n`);
	// the C5 scorer's own report of the chosen cell (retrieval section; the judgment section reads 'debug — not scored')
	fs.writeFileSync(path.join(runSpec.outputDirPath, `d2Score-${chosenCell.cellName}.md`), markdownTextByCellName[chosenCell.cellName]);
	xLog.status(`${moduleName}: control ${report.control.verdict}; gate (a) ${report.gateA.verdict} (${report.gateA.chosenCellAdmissionPercent}%); twin ${report.twin.verdict} (delta ${report.twin.admissionDeltaPercentPoints} points); report in ${runSpec.outputDirPath}`);
	process.exit(0);
});
