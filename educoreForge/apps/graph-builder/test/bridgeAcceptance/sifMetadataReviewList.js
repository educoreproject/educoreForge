'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sifMetadataReviewList.js — THE M6b LIST (phases C6, C6c; SPEC §6 M6b, amendment A9). SIF copies one metadata block
// into every object, so its SIF_Metadata questions (66 on the real source) land on 8,976 fields. Before any of
// those edges is propagated, TQ reviews the block's decisions as a batch: each one with the number of fields the
// decision will be copied to. NO COMPARISON WITH THE STANDARD'S OWN ANNOTATIONS (TQ, 2026-09-29, ruling on the review page,
// applied to this list by EBONY_DREAM): no standard's id, standing or class, and the yardstick scorer is not read.
//
//   buildMetadataReviewList({ decisionBlock, questionMap, cardLabelList, priorList }) → { list, markdownText } | { error }
//   buildMetadataReviewListFromFiles({ decisionBlockFilePath, questionMapFilePath, cardLabelFilePath, priorListFilePath }) → the same
//
// The metadata questions are the question map's SIF_Metadata questions, and each must have exactly one decision in
// the block (metadata is not split by domain, A20).
//
// PROPAGATION COUNT: a pick is copied to every instance the block froze for the unit (instanceStableIdList,
// A10), so the count is that list's length; an abstention propagates to nothing, 0.
//
// priorList is the JSON of an earlier run of this list, or null when there is none. Given one, every row carries
// its prior decision and the change in its propagation count, and the list names the rows whose decision
// changed and the change in the total (SPEC §6 M6b's twin). The list covers exactly the prior's questions or it
// refuses.

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
const crypto = require('crypto');

const METADATA_SHARED_BLOCK = 'SIF_Metadata';
const SUBJECT_STABLE_ID_PREFIX = 'sif260928:question/';
const LIST_WORDING = Object.freeze({
	abstainedDecision: 'abstained',
	noPriorList: 'no prior list was given, so no change is shown',
	changedHeading: 'Decisions changed since the prior list',
	noChange: 'no decision changed since the prior list',
	rowTableHeading: 'The metadata decisions',
});

const compareStrings = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);
const signedText = (delta) => (delta > 0 ? `+${delta}` : `${delta}`);
const cardLabelTextOf = ({ cardStableId, cardLabelByStableId }) => `${cardLabelByStableId[cardStableId].domainName} · ${cardLabelByStableId[cardStableId].propertyName}`;
const decisionTextOf = (row) => (row.proposedCardStableId === null ? LIST_WORDING.abstainedDecision : row.proposedCardLabelText);

const buildMetadataReviewList = ({ decisionBlock, questionMap, cardLabelList, priorList }) => {
	const cardLabelByStableId = cardLabelList.cardLabelByStableId;
	const metadataQuestionList = questionMap.questionList.filter((oneQuestion) => oneQuestion.sharedBlock === METADATA_SHARED_BLOCK).sort((leftQuestion, rightQuestion) => compareStrings(leftQuestion.relativePath, rightQuestion.relativePath));
	const rowList = [];
	for (let questionIndex = 0; questionIndex < metadataQuestionList.length; questionIndex++) {
		const question = metadataQuestionList[questionIndex];
		const subjectStableId = `${SUBJECT_STABLE_ID_PREFIX}${question.questionRefId}`;
		const decisionRecordList = decisionBlock.decisionRecordList.filter((oneRecord) => oneRecord.subjectStableId === subjectStableId);
		if (decisionRecordList.length === 0) {
			return { error: refuse.byName({ moduleName, what: `metadata question ${question.questionRefId} (${question.relativePath}) has no decision in the block`, where: 'M6b reviews every metadata decision before any is propagated; the block must judge every SIF_Metadata question of the question map (judge them as a named set first, A9)' }) };
		}
		if (decisionRecordList.length > 1) {
			return { error: refuse.byName({ moduleName, what: `metadata question ${question.questionRefId} (${question.relativePath}) has ${decisionRecordList.length} decisions in the block (partitions ${decisionRecordList.map((oneRecord) => oneRecord.judgmentPartitionLabel).join(', ')})`, where: 'SIF_Metadata questions are judged once, never split by domain (SPEC A20)' }) };
		}
		const decisionRecord = decisionRecordList[0];
		if (!Array.isArray(decisionRecord.instanceStableIdList)) {
			return { error: refuse.byName({ moduleName, what: `the decision for metadata question ${question.questionRefId} carries no instanceStableIdList`, where: 'the propagation count is the list of instances the block froze for the unit (materialisation fan-out, A10); a block frozen without fan-out cannot say how many fields a decision reaches' }) };
		}
		const proposedCardStableId = decisionRecord.abstained === true ? null : decisionRecord.objectStableId;
		const unlabelledCardStableId = proposedCardStableId !== null && cardLabelByStableId[proposedCardStableId] === undefined ? proposedCardStableId : undefined;
		if (unlabelledCardStableId !== undefined) {
			return { error: refuse.byName({ moduleName, what: `card ${unlabelledCardStableId} (metadata question ${question.questionRefId}) has no entry in the card label list`, where: 'the label list must carry every card the list names; the block carries stableIds only' }) };
		}
		const row = {
			questionRefId: question.questionRefId,
			subjectStableId,
			name: question.name,
			relativePath: question.relativePath,
			instanceCount: question.instanceCount,
			proposedCardStableId,
			proposedCardLabelText: proposedCardStableId === null ? null : cardLabelTextOf({ cardStableId: proposedCardStableId, cardLabelByStableId }),
			predicate: decisionRecord.predicate === undefined ? null : decisionRecord.predicate,
			propagationCount: proposedCardStableId === null ? 0 : decisionRecord.instanceStableIdList.length,
		};
		rowList.push(row);
	}

	const list = {
		generation: decisionBlock.header.generation,
		metadataQuestionCount: rowList.length,
		instanceTotal: rowList.reduce((soFar, oneRow) => soFar + oneRow.instanceCount, 0),
		propagationTotal: rowList.reduce((soFar, oneRow) => soFar + oneRow.propagationCount, 0),
		pickedCount: rowList.filter((oneRow) => oneRow.proposedCardStableId !== null).length,
		abstainedCount: rowList.filter((oneRow) => oneRow.proposedCardStableId === null).length,
		priorGiven: priorList !== null,
		propagationTotalDelta: null,
		changedRowList: [],
		rowList,
	};

	if (priorList !== null) {
		const priorRowByRefId = {};
		priorList.rowList.forEach((onePriorRow) => {
			priorRowByRefId[onePriorRow.questionRefId] = onePriorRow;
		});
		const priorRefIdText = priorList.rowList.map((onePriorRow) => onePriorRow.questionRefId).sort(compareStrings).join(',');
		const currentRefIdText = rowList.map((oneRow) => oneRow.questionRefId).sort(compareStrings).join(',');
		if (priorRefIdText !== currentRefIdText) {
			return { error: refuse.byName({ moduleName, what: `the prior list covers ${priorList.rowList.length} metadata questions and this one ${rowList.length}, not the same set`, where: 'a change can only be read between two lists over the same metadata questions; lists built from different question maps are not comparable' }) };
		}
		rowList.forEach((oneRow) => {
			const priorRow = priorRowByRefId[oneRow.questionRefId];
			oneRow.priorProposedCardStableId = priorRow.proposedCardStableId;
			oneRow.priorPropagationCount = priorRow.propagationCount;
			oneRow.propagationDelta = oneRow.propagationCount - priorRow.propagationCount;
			oneRow.decisionChanged = oneRow.proposedCardStableId !== priorRow.proposedCardStableId;
		});
		list.propagationTotalDelta = list.propagationTotal - priorList.propagationTotal;
		list.changedRowList = rowList
			.filter((oneRow) => oneRow.decisionChanged)
			.map((oneRow) => ({ questionRefId: oneRow.questionRefId, relativePath: oneRow.relativePath, priorDecisionText: priorRowByRefId[oneRow.questionRefId].proposedCardStableId === null ? LIST_WORDING.abstainedDecision : priorRowByRefId[oneRow.questionRefId].proposedCardLabelText, decisionText: decisionTextOf(oneRow), priorPropagationCount: oneRow.priorPropagationCount, propagationCount: oneRow.propagationCount, propagationDelta: oneRow.propagationDelta }));
	}
	return { list, markdownText: markdownOf({ list }) };
};

const markdownOf = ({ list }) => {
	const lineList = [];
	lineList.push(`# SIF metadata decisions before propagation (M6b) — ${list.generation}`);
	lineList.push('');
	lineList.push(`- metadata questions: **${list.metadataQuestionCount}**, over **${list.instanceTotal}** fields`);
	lineList.push(`- the bridge proposed a card on **${list.pickedCount}** and abstained on **${list.abstainedCount}**`);
	lineList.push(`- fields the decisions will be copied to: **${list.propagationTotal}**${list.priorGiven ? ` (${signedText(list.propagationTotalDelta)} since the prior list)` : ''}`);
	lineList.push('');
	lineList.push(`## ${LIST_WORDING.changedHeading}`);
	lineList.push('');
	if (!list.priorGiven) {
		lineList.push(LIST_WORDING.noPriorList);
	} else if (list.changedRowList.length === 0) {
		lineList.push(LIST_WORDING.noChange);
	} else {
		list.changedRowList.forEach((oneChange) => lineList.push(`- \`${oneChange.relativePath}\`: ${oneChange.priorDecisionText} → ${oneChange.decisionText}; fields ${oneChange.priorPropagationCount} → ${oneChange.propagationCount} (${signedText(oneChange.propagationDelta)})`));
	}
	lineList.push('');
	lineList.push(`## ${LIST_WORDING.rowTableHeading}`);
	lineList.push('');
	lineList.push(`| question | fields | the bridge's decision | predicate | copied to${list.priorGiven ? ' | change' : ''} |`);
	lineList.push(`|---|---:|---|---|---:|${list.priorGiven ? '---:|' : ''}`);
	list.rowList.forEach((oneRow) => lineList.push(`| \`${oneRow.relativePath}\` | ${oneRow.instanceCount} | ${decisionTextOf(oneRow)} | ${oneRow.predicate === null ? '—' : oneRow.predicate} | ${oneRow.propagationCount} |${list.priorGiven ? ` ${signedText(oneRow.propagationDelta)} |` : ''}`));
	lineList.push('');
	return lineList.join('\n');
};

// buildMetadataReviewListFromFiles — reads the three inputs, then builds the list; priorListFilePath is a path or null
const sha256OfFile = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const buildMetadataReviewListFromFiles = ({ decisionBlockFilePath, questionMapFilePath, cardLabelFilePath, priorListFilePath }) => {
	const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
	const built = buildMetadataReviewList({ decisionBlock: readJson(decisionBlockFilePath), questionMap: readJson(questionMapFilePath), cardLabelList: readJson(cardLabelFilePath), priorList: priorListFilePath === null ? null : readJson(priorListFilePath) });
	if (built.error) {
		return { error: built.error };
	}
	const inputFilePathByRole = { decisionBlock: decisionBlockFilePath, questionMap: questionMapFilePath, cardLabelList: cardLabelFilePath };
	const inputFileSha256ByRole = Object.keys(inputFilePathByRole).reduce((soFar, oneRole) => ({ ...soFar, [oneRole]: sha256OfFile(inputFilePathByRole[oneRole]) }), {});
	return { list: { ...built.list, inputFilePathByRole, inputFileSha256ByRole }, markdownText: built.markdownText };
};

module.exports = { buildMetadataReviewList, buildMetadataReviewListFromFiles, LIST_WORDING, moduleName };
