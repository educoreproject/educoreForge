'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sifYardstickScorer.js — THE SIF YARDSTICK SCORER (phase C5; SPEC §5.7, plan §3 C5). App-level, never
// framework: the bridge must never see the answer key, and this file is where the key meets a frozen block.
//
//   scoreBlock({ decisionBlock, annotation, questionMap, cardList, remodelTable }) → { score, markdownText } | { error }
//   scoreFromFiles({ decisionBlockFilePath, annotationFilePath, questionMapFilePath, cardListFilePath,
//                    remodelTableFilePath }) → the same, plus each input's path and sha256
//
// Inputs: a frozen decision block; the yardstick's annotation (xpath → P id) and global question map (C1);
// a per-id card list shaped like the baseline's hubCardsByCedsId.json ({ cardsBySifCedsId: { P…: [{
// cardStableId, domainName }] } }); the hub's own remodel table, keyed hubName@hubVersion from the header.
//
// ONE UNIT = ONE RECORD. A unit's standard id is read from ITS OWN instances (instanceStableIdList, a
// partitioned unit's share; the question's whole xpathList when the block carries none), then remapped
// through the hub's remodel table (the qualifier is not read: open issue OI-1), then looked up in the card
// list: no id → unannotated; no card → key-without-card; one card → specified, that card the target;
// several → contended, the target being the one card in the unit's partition label (domain), or none.
//
// IN ORDER, as SPEC §5.7 orders them: retrieval first (not-retrieved: no card of the id in retrievalSeatList;
// recall@K on the best such rank), then judgment over retrieved units only (agrees-target, agrees-key,
// disagrees, abstained-where-specified), the two grains (target on specified, key on contended), new-claim
// for unannotated picks, and all of it again per shared block. Every number is measured from the block.
//
// A debug block (INVALID_DEBUG in its generation) keeps its retrieval section, which needs no judge, and its
// judgment reads 'debug — not scored'. The output carries identifiers only, never prose from the data, and
// is refused if it would carry either word SPEC §2 forbids.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const refuse = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
const subjectGrouping = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'bridge-framework', 'subjectGrouping'));
const debugJudge = require(path.join(__dirname, '..', '..', 'apps', 'bridge-maker', 'lib', 'debugJudge'));

const RECALL_K_LIST = Object.freeze([1, 3, 5, 10, 15, 20, 25]);
const SHARED_BLOCK_LIST = Object.freeze(['model', 'SIF_Metadata', 'SIF_ExtendedElements']);
const SUBJECT_STABLE_ID_PREFIX = 'sif260928:question/';
const INSTANCE_STABLE_ID_PREFIX = 'sif260928:field';

// the report's standing and class names (SPEC §2) and every sentence the report prints. One table, so gate
// (b) has one place to be broken and the wording rule of SPEC §5.7 one place to live.
const REPORT_WORDING = Object.freeze({
	standingSpecified: 'specified',
	standingContended: 'contended',
	standingKeyWithoutCard: 'key-without-card',
	standingUnannotated: 'unannotated',
	populationKeyRemodeled: 'key-remodeled',
	classNotRetrieved: 'not-retrieved',
	classAgreesTarget: 'agrees-target',
	classAgreesKey: 'agrees-key',
	classDisagrees: 'disagrees',
	classAbstainedWhereSpecified: 'abstained-where-specified',
	classNewClaim: 'new-claim',
	debugNotScored: 'debug — not scored',
	standardSpecifiesLine: ({ cedsElementId, remodeledToCedsElementId, cardStableIdList, proposedText }) => `the standard specifies ${cedsElementId}${remodeledToCedsElementId === null ? '' : ` (remodeled to ${remodeledToCedsElementId})`} (${cardStableIdList.join(', ')}); the bridge proposed ${proposedText}`,
	noCardProposed: 'no card',
	capArtifactNote: (declaredK) => `above the block's declared K = ${declaredK}; the recorded pool holds at most ${declaredK} seats, so this row is set by the cap and is not a measurement`,
});

const FORBIDDEN_WORD_PATTERN = /error|wrong/gi;

const compareStrings = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);
const asPercent = (numerator, denominator) => (denominator === 0 ? '—' : `${((numerator / denominator) * 100).toFixed(1)}%`);

const forbiddenWordHitList = ({ text }) => text.match(FORBIDDEN_WORD_PATTERN) || [];

// standingOf — what the standard says about ONE unit: the distinct annotated ids over the unit's own
// instances (a partitioned unit's share, or the whole question), then the card list's view of that id.
const standingOf = ({ decisionRecord, question, cedsElementIdByXpath, cardsBySifCedsId, remodelTable, hubName, hubVersion }) => {
	const xpathList = decisionRecord.instanceStableIdList === undefined ? question.xpathList : decisionRecord.instanceStableIdList.map((oneStableId) => oneStableId.slice(INSTANCE_STABLE_ID_PREFIX.length));
	const strayXpath = xpathList.find((oneXpath) => question.xpathList.indexOf(oneXpath) === -1);
	if (strayXpath !== undefined) {
		return { error: refuse.byName({ moduleName, what: `unit ${decisionRecord.subjectStableId} (partition ${decisionRecord.judgmentPartitionLabel}) has an instance at ${strayXpath}, which is not a row of question ${question.questionRefId}`, where: `an instance stableId is '${INSTANCE_STABLE_ID_PREFIX}<xpath>' for a row of its own question; anything else means the block and the yardstick disagree about the rows, and the unit's id would be read from nothing` }) };
	}
	const cedsElementIdList = Array.from(new Set(xpathList.map((oneXpath) => cedsElementIdByXpath[oneXpath]).filter((oneId) => oneId !== undefined))).sort(compareStrings);
	if (cedsElementIdList.length === 0) {
		return { standing: REPORT_WORDING.standingUnannotated };
	}
	if (cedsElementIdList.length > 1) {
		return { error: refuse.byName({ moduleName, what: `unit ${decisionRecord.subjectStableId} (partition ${decisionRecord.judgmentPartitionLabel}) spans ${cedsElementIdList.length} annotated ids (${cedsElementIdList.join(', ')})`, where: 'the yardstick splits a multi-id question into one question per id (SPEC A17), so one unit names at most one id; a unit naming two means the block and the yardstick were built from different question maps' }) };
	}
	const cedsElementId = cedsElementIdList[0];
	// the hub's own remodel table (CEDS 14 folded some ids into another): the card lookup uses the id the
	// hub carries, and the report keeps the standard's id beside it. The table's qualifier is not read here.
	const remodeled = subjectGrouping.applyRemodel({ target: { canonicalKey: cedsElementId }, remodelTable, hubName, hubVersion });
	const remodeledToCedsElementId = remodeled.remodelApplied === null ? null : remodeled.target.canonicalKey;
	const cardLookupCedsElementId = remodeled.target.canonicalKey;
	const cardList = cardsBySifCedsId[cardLookupCedsElementId];
	if (cardList === undefined) {
		return { error: refuse.byName({ moduleName, what: `the card list has no entry for ${cardLookupCedsElementId}${remodeledToCedsElementId === null ? '' : ` (${cedsElementId} remodeled)`} (unit ${decisionRecord.subjectStableId})`, where: 'the card list must name every id the annotation names, after the remodel, with an empty list for an id the hub has no card for' }) };
	}
	const keyCardStableIdList = cardList.map((oneCard) => oneCard.cardStableId).sort(compareStrings);
	if (keyCardStableIdList.length === 0) {
		return { standing: REPORT_WORDING.standingKeyWithoutCard, cedsElementId, remodeledToCedsElementId, keyCardStableIdList };
	}
	if (keyCardStableIdList.length === 1) {
		return { standing: REPORT_WORDING.standingSpecified, cedsElementId, remodeledToCedsElementId, keyCardStableIdList, targetCardStableId: keyCardStableIdList[0] };
	}
	// contended: the target is the one card in the unit's own partition (domain); a unit with no partition
	// label (the metadata block) has no target and is read at key grain only
	const partitionCardList = cardList.filter((oneCard) => decisionRecord.judgmentPartitionLabel !== undefined && decisionRecord.judgmentPartitionLabel !== null && oneCard.domainName === decisionRecord.judgmentPartitionLabel);
	return { standing: REPORT_WORDING.standingContended, cedsElementId, remodeledToCedsElementId, keyCardStableIdList, targetCardStableId: partitionCardList.length === 1 ? partitionCardList[0].cardStableId : null };
};

// bestKeyRankOf — the best retrieval rank any card of the key reached (key grain; on a specified unit the
// key has one card, so this is the target's rank), or null when none was retrieved
const bestKeyRankOf = ({ decisionRecord, keyCardStableIdList }) => {
	const rankList = decisionRecord.retrievalSeatList.filter((oneSeat) => keyCardStableIdList.indexOf(oneSeat.stableId) !== -1).map((oneSeat) => oneSeat.rank);
	return rankList.length === 0 ? null : Math.min(...rankList);
};

const judgmentClassOf = ({ decisionRecord, keyCardStableIdList, targetCardStableId }) => {
	if (decisionRecord.abstained === true) {
		return REPORT_WORDING.classAbstainedWhereSpecified;
	}
	if (decisionRecord.objectStableId === targetCardStableId) {
		return REPORT_WORDING.classAgreesTarget;
	}
	if (keyCardStableIdList.indexOf(decisionRecord.objectStableId) !== -1) {
		return REPORT_WORDING.classAgreesKey;
	}
	return REPORT_WORDING.classDisagrees;
};

const JUDGMENT_CLASS_LIST = Object.freeze([REPORT_WORDING.classAgreesTarget, REPORT_WORDING.classAgreesKey, REPORT_WORDING.classDisagrees, REPORT_WORDING.classAbstainedWhereSpecified]);

const emptyTally = () => ({
	unitCount: 0,
	keyRemodeledCount: 0,
	keyRemodeledIdSet: new Set(),
	keyWithoutCardIdSet: new Set(),
	standingCountByName: { [REPORT_WORDING.standingSpecified]: 0, [REPORT_WORDING.standingContended]: 0, [REPORT_WORDING.standingKeyWithoutCard]: 0, [REPORT_WORDING.standingUnannotated]: 0 },
	scorableCount: 0,
	notRetrievedCount: 0,
	retrievedCount: 0,
	recallHitCountByK: RECALL_K_LIST.reduce((soFar, oneK) => ({ ...soFar, [oneK]: 0 }), {}),
	judgmentCountByClass: JUDGMENT_CLASS_LIST.reduce((soFar, oneClass) => ({ ...soFar, [oneClass]: 0 }), {}),
	specifiedRetrievedCount: 0,
	specifiedAgreesTargetCount: 0,
	contendedRetrievedCount: 0,
	contendedAgreesKeyGrainCount: 0,
	newClaimCount: 0,
	unannotatedAbstainedCount: 0,
});

const addUnitToTally = ({ tally, unitVerdict }) => {
	tally.unitCount += 1;
	tally.standingCountByName[unitVerdict.standing] += 1;
	if (unitVerdict.remodeledToCedsElementId !== undefined && unitVerdict.remodeledToCedsElementId !== null) {
		tally.keyRemodeledCount += 1;
		tally.keyRemodeledIdSet.add(`${unitVerdict.cedsElementId}->${unitVerdict.remodeledToCedsElementId}`);
	}
	if (unitVerdict.standing === REPORT_WORDING.standingUnannotated) {
		if (unitVerdict.newClaim) {
			tally.newClaimCount += 1;
		} else {
			tally.unannotatedAbstainedCount += 1;
		}
		return;
	}
	if (unitVerdict.standing === REPORT_WORDING.standingKeyWithoutCard) {
		tally.keyWithoutCardIdSet.add(unitVerdict.cedsElementId);
		return;
	}
	tally.scorableCount += 1;
	if (unitVerdict.bestKeyRank === null) {
		tally.notRetrievedCount += 1;
		return;
	}
	tally.retrievedCount += 1;
	RECALL_K_LIST.forEach((oneK) => {
		tally.recallHitCountByK[oneK] += unitVerdict.bestKeyRank <= oneK ? 1 : 0;
	});
	tally.judgmentCountByClass[unitVerdict.judgmentClass] += 1;
	if (unitVerdict.standing === REPORT_WORDING.standingSpecified) {
		tally.specifiedRetrievedCount += 1;
		tally.specifiedAgreesTargetCount += unitVerdict.judgmentClass === REPORT_WORDING.classAgreesTarget ? 1 : 0;
	} else {
		tally.contendedRetrievedCount += 1;
		tally.contendedAgreesKeyGrainCount += unitVerdict.judgmentClass === REPORT_WORDING.classAgreesTarget || unitVerdict.judgmentClass === REPORT_WORDING.classAgreesKey ? 1 : 0;
	}
};

// scoreBlock — pure: one frozen decision block against the yardstick and the card list
const scoreBlock = ({ decisionBlock, annotation, questionMap, cardList, remodelTable }) => {
	const hubName = decisionBlock.header.hubName;
	const hubVersion = String(decisionBlock.header.hubVersion);
	const remodelTableSectionName = `${hubName}@${hubVersion}`;
	if (remodelTable[remodelTableSectionName] === null || typeof remodelTable[remodelTableSectionName] !== 'object') {
		return { error: refuse.byName({ moduleName, what: `the remodel table carries no entry for ${remodelTableSectionName} (entries: ${Object.keys(remodelTable).join(', ')})`, where: 'the table is keyed hubName@hubVersion, read from the block header, as the bridge framework reads it' }) };
	}
	const questionByRefId = {};
	questionMap.questionList.forEach((oneQuestion) => {
		questionByRefId[oneQuestion.questionRefId] = oneQuestion;
	});
	const debugMark = debugJudge.debugMarkFromGeneration(decisionBlock.header.generation);

	const unitVerdictList = [];
	for (let recordIndex = 0; recordIndex < decisionBlock.decisionRecordList.length; recordIndex++) {
		const decisionRecord = decisionBlock.decisionRecordList[recordIndex];
		const questionRefId = decisionRecord.subjectStableId.startsWith(SUBJECT_STABLE_ID_PREFIX) ? decisionRecord.subjectStableId.slice(SUBJECT_STABLE_ID_PREFIX.length) : null;
		const question = questionByRefId[questionRefId];
		if (question === undefined) {
			return { error: refuse.byName({ moduleName, what: `record ${recordIndex} names subject ${decisionRecord.subjectStableId}, which is not a question of the yardstick's question map`, where: `a scored subject must be '${SUBJECT_STABLE_ID_PREFIX}<questionRefId>' for a questionRefId the question map holds; otherwise the block and the yardstick describe different sources` }) };
		}
		if (SHARED_BLOCK_LIST.indexOf(question.sharedBlock) === -1) {
			return { error: refuse.byName({ moduleName, what: `question ${questionRefId} carries sharedBlock '${question.sharedBlock}'`, where: `the per-block split knows exactly ${SHARED_BLOCK_LIST.join(', ')}` }) };
		}
		const standing = standingOf({ decisionRecord, question, cedsElementIdByXpath: annotation.cedsElementIdByXpath, cardsBySifCedsId: cardList.cardsBySifCedsId, remodelTable, hubName, hubVersion });
		if (standing.error) {
			return { error: standing.error };
		}
		const unitVerdict = { subjectStableId: decisionRecord.subjectStableId, judgmentPartitionLabel: decisionRecord.judgmentPartitionLabel === undefined ? null : decisionRecord.judgmentPartitionLabel, sharedBlock: question.sharedBlock, ...standing, proposedCardStableId: decisionRecord.abstained === true ? null : decisionRecord.objectStableId };
		if (standing.standing === REPORT_WORDING.standingUnannotated) {
			unitVerdict.newClaim = decisionRecord.abstained !== true;
		} else if (standing.standing !== REPORT_WORDING.standingKeyWithoutCard) {
			unitVerdict.bestKeyRank = bestKeyRankOf({ decisionRecord, keyCardStableIdList: standing.keyCardStableIdList });
			unitVerdict.judgmentClass = unitVerdict.bestKeyRank === null ? REPORT_WORDING.classNotRetrieved : judgmentClassOf({ decisionRecord, keyCardStableIdList: standing.keyCardStableIdList, targetCardStableId: standing.targetCardStableId });
		}
		unitVerdictList.push(unitVerdict);
	}

	const overallTally = emptyTally();
	const tallyBySharedBlock = SHARED_BLOCK_LIST.reduce((soFar, oneBlockName) => ({ ...soFar, [oneBlockName]: emptyTally() }), {});
	unitVerdictList.forEach((unitVerdict) => {
		addUnitToTally({ tally: overallTally, unitVerdict });
		addUnitToTally({ tally: tallyBySharedBlock[unitVerdict.sharedBlock], unitVerdict });
	});

	const declaredK = decisionBlock.header.candidateRetrieval.k;
	const retrievalOf = (tally) => ({
		scorableCount: tally.scorableCount,
		notRetrievedCount: tally.notRetrievedCount,
		retrievedCount: tally.retrievedCount,
		recallByK: RECALL_K_LIST.map((oneK) => ({ k: oneK, hitCount: tally.recallHitCountByK[oneK], scorableCount: tally.scorableCount, aboveDeclaredK: oneK > declaredK })),
	});
	const judgmentOf = (tally) =>
		debugMark
			? { scored: false, statusText: REPORT_WORDING.debugNotScored }
			: {
					scored: true,
					retrievedCount: tally.retrievedCount,
					countByClass: tally.judgmentCountByClass,
					targetGrainOnSpecified: { retrievedCount: tally.specifiedRetrievedCount, agreesTargetCount: tally.specifiedAgreesTargetCount },
					keyGrainOnContended: { retrievedCount: tally.contendedRetrievedCount, agreesKeyGrainCount: tally.contendedAgreesKeyGrainCount },
					newClaimCount: tally.newClaimCount,
				};
	const populationOf = (tally) => ({ unitCount: tally.unitCount, standingCountByName: tally.standingCountByName, keyRemodeledCount: tally.keyRemodeledCount, keyRemodeledIdList: Array.from(tally.keyRemodeledIdSet).sort(compareStrings), keyWithoutCardIdList: Array.from(tally.keyWithoutCardIdSet).sort(compareStrings), unannotatedAbstainedCount: debugMark ? null : tally.unannotatedAbstainedCount });

	const standardSpecifiesLineOf = (unitVerdict) =>
		REPORT_WORDING.standardSpecifiesLine({ cedsElementId: unitVerdict.cedsElementId, remodeledToCedsElementId: unitVerdict.remodeledToCedsElementId, cardStableIdList: unitVerdict.targetCardStableId ? [unitVerdict.targetCardStableId] : unitVerdict.keyCardStableIdList, proposedText: unitVerdict.proposedCardStableId === null ? REPORT_WORDING.noCardProposed : unitVerdict.proposedCardStableId });
	const listedClassList = [REPORT_WORDING.classDisagrees, REPORT_WORDING.classAbstainedWhereSpecified];
	const comparisonLineList = debugMark
		? []
		: unitVerdictList
				.filter((unitVerdict) => listedClassList.indexOf(unitVerdict.judgmentClass) !== -1)
				.map((unitVerdict) => ({ subjectStableId: unitVerdict.subjectStableId, judgmentPartitionLabel: unitVerdict.judgmentPartitionLabel, judgmentClass: unitVerdict.judgmentClass, lineText: standardSpecifiesLineOf(unitVerdict) }));

	const score = {
		generation: decisionBlock.header.generation,
		debugMark: debugMark === undefined ? null : debugMark,
		declaredK,
		population: populationOf(overallTally),
		retrieval: retrievalOf(overallTally),
		judgment: judgmentOf(overallTally),
		bySharedBlock: SHARED_BLOCK_LIST.map((oneBlockName) => ({ sharedBlock: oneBlockName, population: populationOf(tallyBySharedBlock[oneBlockName]), retrieval: retrievalOf(tallyBySharedBlock[oneBlockName]), judgment: judgmentOf(tallyBySharedBlock[oneBlockName]) })),
		comparisonLineList,
		unitVerdictList,
	};
	const markdownText = markdownOf({ score });
	const hitList = forbiddenWordHitList({ text: `${JSON.stringify(score)}\n${markdownText}` });
	if (hitList.length > 0) {
		return { error: refuse.byName({ moduleName, what: `the report carries ${hitList.length} forbidden word(s) (${Array.from(new Set(hitList.map((oneHit) => oneHit.toLowerCase()))).join(', ')})`, where: 'SPEC §2 and §5.7: the report names what the standard specifies and what the bridge proposed; it never says error or wrong' }) };
	}
	return { score, markdownText };
};

const markdownOf = ({ score }) => {
	const lineList = [];
	lineList.push(`# SIF yardstick score — ${score.generation}`);
	lineList.push('');
	lineList.push('## Population');
	lineList.push('');
	lineList.push(`- units in the block: **${score.population.unitCount}**`);
	Object.keys(score.population.standingCountByName).forEach((oneStanding) => lineList.push(`- ${oneStanding}: **${score.population.standingCountByName[oneStanding]}**${oneStanding === REPORT_WORDING.standingKeyWithoutCard && score.population.keyWithoutCardIdList.length > 0 ? ` (${score.population.keyWithoutCardIdList.join(', ')})` : ''}`));
	lineList.push(`- ${REPORT_WORDING.populationKeyRemodeled}: **${score.population.keyRemodeledCount}**${score.population.keyRemodeledIdList.length > 0 ? ` (${score.population.keyRemodeledIdList.join(', ')})` : ''}`);
	lineList.push('');
	lineList.push('## Retrieval');
	lineList.push('');
	lineList.push(`- ${REPORT_WORDING.classNotRetrieved}: **${score.retrieval.notRetrievedCount}** of ${score.retrieval.scorableCount}`);
	lineList.push('');
	lineList.push('| K | key card in pool | recall |');
	lineList.push('|---:|---:|---:|');
	score.retrieval.recallByK.forEach((oneRow) => lineList.push(`| ${oneRow.k} | ${oneRow.hitCount} / ${oneRow.scorableCount} | ${asPercent(oneRow.hitCount, oneRow.scorableCount)}${oneRow.aboveDeclaredK ? ` (${REPORT_WORDING.capArtifactNote(score.declaredK)})` : ''} |`));
	lineList.push('');
	lineList.push('## Judgment');
	lineList.push('');
	if (!score.judgment.scored) {
		lineList.push(score.judgment.statusText);
	} else {
		lineList.push(`Over the ${score.judgment.retrievedCount} retrieved units:`);
		lineList.push('');
		JUDGMENT_CLASS_LIST.forEach((oneClass) => lineList.push(`- ${oneClass}: **${score.judgment.countByClass[oneClass]}**`));
		lineList.push('');
		lineList.push(`- target grain on ${REPORT_WORDING.standingSpecified} units: **${score.judgment.targetGrainOnSpecified.agreesTargetCount}** of ${score.judgment.targetGrainOnSpecified.retrievedCount} (${asPercent(score.judgment.targetGrainOnSpecified.agreesTargetCount, score.judgment.targetGrainOnSpecified.retrievedCount)})`);
		lineList.push(`- key grain on ${REPORT_WORDING.standingContended} units: **${score.judgment.keyGrainOnContended.agreesKeyGrainCount}** of ${score.judgment.keyGrainOnContended.retrievedCount} (${asPercent(score.judgment.keyGrainOnContended.agreesKeyGrainCount, score.judgment.keyGrainOnContended.retrievedCount)})`);
		lineList.push(`- ${REPORT_WORDING.classNewClaim} (${REPORT_WORDING.standingUnannotated} units): **${score.judgment.newClaimCount}**`);
	}
	lineList.push('');
	lineList.push('## Per shared block');
	lineList.push('');
	lineList.push(`| block | units | ${REPORT_WORDING.classNotRetrieved} | recall@${RECALL_K_LIST[RECALL_K_LIST.length - 1]} | ${JUDGMENT_CLASS_LIST.join(' | ')} | ${REPORT_WORDING.classNewClaim} |`);
	lineList.push(`|---|${'---:|'.repeat(JUDGMENT_CLASS_LIST.length + 4)}`);
	score.bySharedBlock.forEach((oneBlock) => {
		const lastRecallRow = oneBlock.retrieval.recallByK[oneBlock.retrieval.recallByK.length - 1];
		const judgmentCellList = oneBlock.judgment.scored ? JUDGMENT_CLASS_LIST.map((oneClass) => oneBlock.judgment.countByClass[oneClass]).concat([oneBlock.judgment.newClaimCount]) : JUDGMENT_CLASS_LIST.concat([REPORT_WORDING.classNewClaim]).map(() => REPORT_WORDING.debugNotScored);
		lineList.push(`| ${oneBlock.sharedBlock} | ${oneBlock.population.unitCount} | ${oneBlock.retrieval.notRetrievedCount} | ${lastRecallRow.hitCount} / ${lastRecallRow.scorableCount} | ${judgmentCellList.join(' | ')} |`);
	});
	if (score.comparisonLineList.length > 0) {
		lineList.push('');
		lineList.push('## Where the bridge did not propose the standard\'s card');
		lineList.push('');
		score.comparisonLineList.forEach((oneLine) => lineList.push(`- ${oneLine.subjectStableId}${oneLine.judgmentPartitionLabel === null ? '' : ` [${oneLine.judgmentPartitionLabel}]`} (${oneLine.judgmentClass}): ${oneLine.lineText}`));
	}
	lineList.push('');
	return lineList.join('\n');
};

// scoreFromFiles — reads the four inputs by path and scores them; each input's sha256 rides on the result
const scoreFromFiles = ({ decisionBlockFilePath, annotationFilePath, questionMapFilePath, cardListFilePath, remodelTableFilePath }) => {
	const inputFilePathByRole = { decisionBlock: decisionBlockFilePath, annotation: annotationFilePath, questionMap: questionMapFilePath, cardList: cardListFilePath, remodelTable: remodelTableFilePath };
	const inputTextByRole = {};
	const inputFileSha256ByRole = {};
	Object.keys(inputFilePathByRole).forEach((oneRole) => {
		inputTextByRole[oneRole] = fs.readFileSync(inputFilePathByRole[oneRole], 'utf8');
		inputFileSha256ByRole[oneRole] = crypto.createHash('sha256').update(inputTextByRole[oneRole]).digest('hex');
	});
	const scored = scoreBlock({ decisionBlock: JSON.parse(inputTextByRole.decisionBlock), annotation: JSON.parse(inputTextByRole.annotation), questionMap: JSON.parse(inputTextByRole.questionMap), cardList: JSON.parse(inputTextByRole.cardList), remodelTable: JSON.parse(inputTextByRole.remodelTable) });
	if (scored.error) {
		return { error: scored.error };
	}
	return { score: { ...scored.score, inputFilePathByRole, inputFileSha256ByRole }, markdownText: scored.markdownText };
};

module.exports = { scoreBlock, scoreFromFiles, forbiddenWordHitList, REPORT_WORDING, RECALL_K_LIST, SHARED_BLOCK_LIST, JUDGMENT_CLASS_LIST, moduleName };
