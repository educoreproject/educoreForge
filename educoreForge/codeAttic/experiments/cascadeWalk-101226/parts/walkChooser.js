'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// walkChooser.js — a walk's choice call: Jev ranks a list of options (concepts, classes, DES domains, DES entities)
// for one subject, and the top N by Jev's own probability are kept. It goes through the SAME judge provider as the
// judge (judgeClient.rerank, the jev row of judgeProviderRegistry) and through the run's judgment cache, keyed exactly
// as judgeComponent keys a judgment: (promptHash, model, rendererVersion). The rendererVersion names the choice kind
// (walkExperiment.json choiceQuestionByKind), so a walk answer can never be served as a mapping judgment or back.
//
// The question Jev sees: state { sourceElement } — the SAME allow-listed subject object the judge's split question
// carries — the kind's instruction, and one criterion per option keyed "1".."n" (never an identifier). There is no
// NONE option: a walk always goes somewhere; the judge decides later whether anything it found fits.
//
// More options than choiceSegmentSize: the list is cut into equal segments in its given order, each segment's top N
// go to a final question, and the final question's ranking is the answer. Every call is recorded in the trace.

const path = require('path');
const crypto = require('crypto');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const canonicalJson = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'bridgePluginContract')).canonicalJsonText;

// the predicate rule with NO predicate slot: one Jev call, no relation question (jevJudgeClient.rerank)
const WALK_PREDICATE_RULE = 'categoryTable-v1';
const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

const segmentListFor = ({ optionList, segmentSize }) => {
	const segmentCount = Math.ceil(optionList.length / segmentSize);
	const perSegment = Math.ceil(optionList.length / segmentCount);
	const segmentList = [];
	for (let startIndex = 0; startIndex < optionList.length; startIndex += perSegment) {
		segmentList.push(optionList.slice(startIndex, startIndex + perSegment));
	}
	return segmentList;
};

// makeWalkChooser — one per run: the judge client, the run's judgment cache, the question texts, and a ledger the
// run reads for cost. chooseTop(request, callback(errString, { rankedOptionList, trace }))
const makeWalkChooser = ({ judgeClient, judgmentCache, choiceQuestionByKind, segmentSize, spendLedger }) => {
	const askOnce = ({ questionKind, sourceElementData, optionList }, callback) => {
		const questionSetting = choiceQuestionByKind[questionKind];
		if (questionSetting === undefined) {
			callback(`${moduleName}: no choiceQuestionByKind.${questionKind} in walkExperiment.json`);
			return;
		}
		const criteriaByChoice = optionList.reduce((soFar, oneOption, optionIndex) => Object.assign(soFar, { [String(optionIndex + 1)]: oneOption.criteria }), {});
		const choiceQuestion = { stateObject: { sourceElement: sourceElementData }, instructionText: questionSetting.instructionText, criteriaByChoice };
		const choiceEnum = Object.keys(criteriaByChoice);
		const promptHash = sha256Hex(canonicalJson({ rendererVersion: questionSetting.rendererVersion, choiceQuestion }));
		const cacheAddress = { promptHash, model: judgeClient.model, rendererVersion: questionSetting.rendererVersion };
		const rankedFrom = (probabilityByChoice) =>
			choiceEnum
				.map((oneChoice, optionIndex) => ({ option: optionList[optionIndex], probability: probabilityByChoice[oneChoice] }))
				.sort((leftEntry, rightEntry) => rightEntry.probability - leftEntry.probability || (leftEntry.option.optionStableId < rightEntry.option.optionStableId ? -1 : 1));
		judgmentCache.getJudgment(cacheAddress, (getError, cached) => {
			if (getError) {
				callback(`${moduleName}: ${getError}`);
				return;
			}
			if (cached.judgment !== null) {
				spendLedger.record({ ledgerKind: questionKind, cacheHit: true, usage: null });
				callback('', { rankedList: rankedFrom(cached.judgment.judgeSummary.judgeProbabilityByChoice), callRecord: { questionKind, promptHash, optionCount: optionList.length, cacheHit: true } });
				return;
			}
			judgeClient.rerank({ choiceQuestion, choiceEnum, predicateRule: WALK_PREDICATE_RULE }, (rerankError, verdict) => {
				if (rerankError) {
					callback(`${moduleName}: ${questionKind} choice: ${rerankError}`);
					return;
				}
				spendLedger.record({ ledgerKind: questionKind, cacheHit: false, usage: verdict.usage });
				const chosenOption = optionList[choiceEnum.indexOf(verdict.choice)];
				const judgment = { choice: verdict.choice, category: verdict.category, rationale: verdict.rationale, chosenStableId: chosenOption.optionStableId, judgeSummary: verdict.judgeSummary };
				judgmentCache.putJudgment({ ...cacheAddress, generation: `walkHarness:${questionKind}`, judgment }, (putError) => {
					if (putError) {
						callback(`${moduleName}: ${putError}`);
						return;
					}
					callback('', { rankedList: rankedFrom(verdict.judgeSummary.judgeProbabilityByChoice), callRecord: { questionKind, promptHash, optionCount: optionList.length, cacheHit: false } });
				});
			});
		});
	};

	const chooseTop = ({ questionKind, sourceElementData, optionList, topCount }, callback) => {
		if (!Array.isArray(optionList) || optionList.length === 0) {
			callback(`${moduleName}: a ${questionKind} choice was asked with no options`);
			return;
		}
		const finish = (askError, asked, earlierCallRecordList) => {
			if (askError) {
				callback(askError);
				return;
			}
			callback('', {
				rankedOptionList: asked.rankedList.slice(0, topCount).map((oneEntry) => ({ ...oneEntry.option, probability: oneEntry.probability })),
				trace: { questionKind, offeredCount: optionList.length, callRecordList: earlierCallRecordList.concat([asked.callRecord]), keptList: asked.rankedList.slice(0, topCount).map((oneEntry) => ({ optionStableId: oneEntry.option.optionStableId, name: oneEntry.option.criteria.name, probability: oneEntry.probability })) },
			});
		};
		if (optionList.length <= segmentSize) {
			askOnce({ questionKind, sourceElementData, optionList }, (askError, asked) => finish(askError, asked, []));
			return;
		}
		// segmented: each segment in turn (sequential, so one subject never holds more than one call open)
		const segmentList = segmentListFor({ optionList, segmentSize });
		const finalistList = [];
		const segmentCallRecordList = [];
		const askSegment = (segmentIndex) => {
			if (segmentIndex === segmentList.length) {
				askOnce({ questionKind, sourceElementData, optionList: finalistList }, (askError, asked) => finish(askError, asked, segmentCallRecordList));
				return;
			}
			askOnce({ questionKind, sourceElementData, optionList: segmentList[segmentIndex] }, (askError, asked) => {
				if (askError) {
					callback(askError);
					return;
				}
				segmentCallRecordList.push(asked.callRecord);
				asked.rankedList.slice(0, topCount).forEach((oneEntry) => finalistList.push(oneEntry.option));
				askSegment(segmentIndex + 1);
			});
		};
		askSegment(0);
	};

	return { chooseTop };
};

module.exports = { makeWalkChooser, WALK_PREDICATE_RULE, moduleName };
