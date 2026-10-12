'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// scoring.js — DESIGN-WALK §4–§6 over the runs' subject rows. Pure: it reads rows, the proxy truth, the card labels and
// the structure index, and returns numbers; it calls nothing.
//
// TRUTH (§4). perSubject.json's `truth` is a "Class.Property" label, 'NONE', a sentence (Milo's suggestion was prose,
// e.g. "a course-parts count card, or abstain"), or null (unsure: not scored). A label is RESOLVED when at least one
// property-tier card carries it as "<domainName>.<name>" (the class is half the idea: a same-property card on another
// class does not count). The 71 = labels + NONE + sentences, exactly the prior analysis' denominator; a sentence can
// never be matched, so it counts against every arm alike, as it did there.
//   pool recall      over RESOLVED labels: is a card with the truth label among the arm's (capped) pool
//   uncapped recall  the same over the arm's pool before the cap
//   proxy-correct    of 71: a label truth when the judge picked a card with that label; NONE when it abstained or the
//                    arm found no candidate (no judge is asked over an empty pool, as in the bridge)
//
// §5.6 where a walk went wrong, for each A1/A2 recall miss on a resolved label:
//   A1  wrongConcept   no chosen concept has the truth card's class as a member
//       wrongClass     a chosen concept has it, but Jev did not keep that class
//       rankedOut      the class was kept and its card was ranked out of the top 15
//   A2  for a property NO placement reaches (one of the 390): it can only arrive through A1, so A1's verdict is given,
//       prefixed unplaced/. Otherwise:
//       wrongDomain    no entity of a chosen domain places the truth property
//       wrongEntity    a chosen domain has such an entity, Jev did not keep it
//       rankedOut      a kept entity places it, and its card was ranked out

const ARM_NAME_LIST = Object.freeze(['A0', 'A1', 'A2', 'A3']);
const SENTENCE_TRUTH_KIND = 'sentence';

const pathOfSubject = (subjectStableId) => subjectStableId.split('/').slice(1).join('/').split('.').slice(-2).join('.');
const labelOfCard = (card) => `${card.domainName}.${card.name}`;

// truthBySubject — { truthKind: 'label'|'NONE'|'sentence', truthLabel, truthCardStableIdList } for each scorable subject
const truthBySubjectFor = ({ proxyTruthRowList, subjectStableIdList, cardList }) => {
	const cardStableIdListByLabel = cardList.reduce((soFar, oneCard) => {
		(soFar[labelOfCard(oneCard)] = soFar[labelOfCard(oneCard)] || []).push(oneCard.stableId);
		return soFar;
	}, {});
	const truthRowByPath = proxyTruthRowList.reduce((soFar, oneRow) => Object.assign(soFar, { [oneRow.path]: oneRow }), {});
	const unmatchedSubjectStableId = subjectStableIdList.find((subjectStableId) => truthRowByPath[pathOfSubject(subjectStableId)] === undefined);
	if (unmatchedSubjectStableId !== undefined) {
		return { error: `${moduleName}: no proxy-truth row for ${unmatchedSubjectStableId} (path ${pathOfSubject(unmatchedSubjectStableId)})` };
	}
	const truthBySubject = subjectStableIdList.reduce((soFar, subjectStableId) => {
		const truthRow = truthRowByPath[pathOfSubject(subjectStableId)];
		if (truthRow.truth === null) {
			return soFar;
		}
		if (truthRow.truth === 'NONE') {
			return Object.assign(soFar, { [subjectStableId]: { truthKind: 'NONE', truthLabel: 'NONE', truthCardStableIdList: [] } });
		}
		// a truth no card carries as its label is a sentence (or a three-part label no card has): unmatchable by construction
		const truthCardStableIdList = cardStableIdListByLabel[truthRow.truth] || [];
		return Object.assign(soFar, { [subjectStableId]: { truthKind: truthCardStableIdList.length > 0 ? 'label' : SENTENCE_TRUTH_KIND, truthLabel: truthRow.truth, truthCardStableIdList } });
	}, {});
	return { truthBySubject };
};

const confidenceBandOf = (pickConfidence) => (pickConfidence >= 0.8 ? 'atLeast80' : pickConfidence >= 0.5 ? 'from50to80' : 'below50');

// diagnoseConceptMiss / diagnoseDesMiss — §5.6, reading the arm's own frozen walk trace
const diagnoseConceptMiss = ({ armResult, truthCardStableIdList, structureIndex }) => {
	const walkTrace = armResult.walkTrace;
	const truthClassStableIdSet = new Set([].concat(...truthCardStableIdList.map((oneStableId) => structureIndex.classStableIdListByCardStableId[oneStableId])));
	const memberClassStableIdSet = new Set(walkTrace.memberClassStableIdList);
	if (![...truthClassStableIdSet].some((oneStableId) => memberClassStableIdSet.has(oneStableId))) {
		return 'wrongConcept';
	}
	if (!walkTrace.chosenClassStableIdList.some((oneStableId) => truthClassStableIdSet.has(oneStableId))) {
		return 'wrongClass';
	}
	return 'rankedOut';
};

const diagnoseDesMiss = ({ armResult, conceptArmResult, truthCardStableIdList, structureIndex }) => {
	const truthPropertyStableIdSet = new Set([].concat(...truthCardStableIdList.map((oneStableId) => structureIndex.propertyStableIdListByCardStableId[oneStableId])));
	if ([...truthPropertyStableIdSet].every((oneStableId) => structureIndex.unplacedPropertyStableIdSet.has(oneStableId))) {
		const inConceptPool = conceptArmResult.uncappedCardStableIdList.some((oneStableId) => truthCardStableIdList.indexOf(oneStableId) !== -1);
		return inConceptPool ? 'unplaced/rankedOut' : `unplaced/${diagnoseConceptMiss({ armResult: conceptArmResult, truthCardStableIdList, structureIndex })}`;
	}
	const walkTrace = armResult.walkTrace;
	// an entity whose placements reach no property, a domain with no entity: true empty readings of the structure
	const placesTruth = (desEntityStableId) => (structureIndex.propertyStableIdListByDesEntityStableId[desEntityStableId] || []).some((oneStableId) => truthPropertyStableIdSet.has(oneStableId));
	const chosenDomainStableIdList = walkTrace.desDomainTrace.keptList.map((oneKept) => oneKept.optionStableId);
	const domainEntityStableIdList = [].concat(...chosenDomainStableIdList.map((oneStableId) => (structureIndex.desEntityListByDomainStableId[oneStableId] || []).map((oneRow) => oneRow.desEntityStableId)));
	if (!domainEntityStableIdList.some(placesTruth)) {
		return 'wrongDomain';
	}
	if (!walkTrace.chosenEntityStableIdList.some(placesTruth)) {
		return 'wrongEntity';
	}
	return 'rankedOut';
};

// scoreRun — one run's rows → per-arm measures and per-subject verdicts
const scoreRun = ({ rowList, truthBySubject, cardByStableId, structureIndex, armNameList }) => {
	const armScoreByArmName = {};
	const subjectVerdictList = [];
	armNameList.forEach((armName) => {
		armScoreByArmName[armName] = { recallHitCount: 0, uncappedRecallHitCount: 0, recallPopulationCount: 0, proxyCorrectCount: 0, proxyPopulationCount: 0, abstainedCount: 0, noCandidateCount: 0, pickCount: 0, pickCountByConfidenceBand: { atLeast80: 0, from50to80: 0, below50: 0 }, judgeInputTokens: 0, judgeOutputTokens: 0, judgeAskedCount: 0, buildMsTotal: 0, judgeMsTotal: 0, subjectCount: 0, missDiagnosisCount: {} };
	});
	rowList.forEach((oneRow) => {
		const truth = truthBySubject[oneRow.subjectStableId];
		const verdictByArmName = {};
		armNameList.forEach((armName) => {
			const armResult = oneRow.armResultByArmName[armName];
			const armScore = armScoreByArmName[armName];
			armScore.subjectCount += 1;
			armScore.buildMsTotal += armResult.buildMs;
			armScore.judgeMsTotal += armResult.judgeMs;
			if (armResult.outcome === 'abstained') {
				armScore.abstainedCount += 1;
			}
			if (armResult.outcome === 'noCandidate') {
				armScore.noCandidateCount += 1;
			}
			if (armResult.judged !== null && !armResult.judged.cacheHit) {
				armScore.judgeAskedCount += 1;
				armScore.judgeInputTokens += armResult.judged.usage.inputTokens;
				armScore.judgeOutputTokens += armResult.judged.usage.outputTokens;
			}
			const pickedLabel = armResult.outcome === 'picked' ? labelOfCard(cardByStableId[armResult.judged.chosenCardStableId]) : 'NONE';
			if (armResult.outcome === 'picked') {
				armScore.pickCount += 1;
				armScore.pickCountByConfidenceBand[confidenceBandOf(armResult.judged.judgeSummary.judgePickConfidence)] += 1;
			}
			if (truth === undefined) {
				verdictByArmName[armName] = { pickedLabel, scored: false };
				return;
			}
			armScore.proxyPopulationCount += 1;
			const proxyCorrect = truth.truthKind === 'NONE' ? pickedLabel === 'NONE' : truth.truthKind === 'label' && pickedLabel === truth.truthLabel;
			armScore.proxyCorrectCount += proxyCorrect ? 1 : 0;
			const verdict = { pickedLabel, truthLabel: truth.truthLabel, truthKind: truth.truthKind, proxyCorrect, scored: true };
			if (truth.truthKind === 'label') {
				armScore.recallPopulationCount += 1;
				const inPool = armResult.cappedCardStableIdList.some((oneStableId) => truth.truthCardStableIdList.indexOf(oneStableId) !== -1);
				const inUncapped = armResult.uncappedCardStableIdList.some((oneStableId) => truth.truthCardStableIdList.indexOf(oneStableId) !== -1);
				armScore.recallHitCount += inPool ? 1 : 0;
				armScore.uncappedRecallHitCount += inUncapped ? 1 : 0;
				verdict.inPool = inPool;
				verdict.inUncapped = inUncapped;
				if (!inPool && (armName === 'A1' || armName === 'A2')) {
					verdict.missDiagnosis = armName === 'A1'
						? diagnoseConceptMiss({ armResult, truthCardStableIdList: truth.truthCardStableIdList, structureIndex })
						: diagnoseDesMiss({ armResult, conceptArmResult: oneRow.armResultByArmName.A1, truthCardStableIdList: truth.truthCardStableIdList, structureIndex });
					armScore.missDiagnosisCount[verdict.missDiagnosis] = (armScore.missDiagnosisCount[verdict.missDiagnosis] || 0) + 1;
				}
			}
			verdictByArmName[armName] = verdict;
		});
		subjectVerdictList.push({ subjectStableId: oneRow.subjectStableId, verdictByArmName });
	});
	return { armScoreByArmName, subjectVerdictList };
};

// realDifference — §6: a difference is REAL only if it holds in ALL runs and is at least minimumSubjectCount on
// proxy-correct OR on pool recall. Returns the per-run differences so the reader sees why.
const realDifference = ({ runScoreList, leaderArmName, otherArmName, minimumSubjectCount }) => {
	const measureList = [{ measureName: 'proxyCorrect', fieldName: 'proxyCorrectCount' }, { measureName: 'poolRecall', fieldName: 'recallHitCount' }];
	const byMeasure = measureList.map((oneMeasure) => {
		const differenceList = runScoreList.map((oneRun) => oneRun.armScoreByArmName[leaderArmName][oneMeasure.fieldName] - oneRun.armScoreByArmName[otherArmName][oneMeasure.fieldName]);
		return { measureName: oneMeasure.measureName, differenceList, real: differenceList.every((oneDifference) => oneDifference >= minimumSubjectCount) };
	});
	return { leaderArmName, otherArmName, byMeasure, real: byMeasure.some((oneMeasure) => oneMeasure.real) };
};

module.exports = { truthBySubjectFor, scoreRun, realDifference, labelOfCard, ARM_NAME_LIST, moduleName };
