'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// layerAgreement.js — agreement between two mapping-layer versions on the questions both answer (mappingLayers ML2-b; SPEC §8,
// D-RATERPRED; DESIGN-ML2a §4 as ruled 2026-10-25). PURE and deterministic: assertion lists in (layerAssertions.js), a report out; no
// clock, no file. Coverage is reported FIRST and never assumed: an element one side does not answer is listed, never scored.
//
//   compareJudgeAgainstRater({ judgeAssertionList, raterAssertionList, raterUnsureList, elementKindByStableId, standardNameByStandardKey,
//                              hubName, judgeLabel, raterLabel, raterPredicateExpansionByPrefix, raterBestPredicateId })
//       one ANSWER UNIT per (rater author, element). The judge's answer for element e is its assertions whose from-node is e, else
//       those whose judged subject is e (a rated type-level element under fan-out). Categories (SPEC §8.1):
//         hit                     judge picked, rater picked, the judge's object is among the rater's {best ∪ same}
//         miss                    judge picked, rater picked, no shared object
//         agreedAbsence           judge abstained, rater said noMatch
//         judgePickedRaterNoMatch judge picked, rater said noMatch
//         judgeAbstainedRaterPicked
//       bestHit (the judge's object is the rater's Best) is counted beside hit.
//   compareVersionAgainstVersion({ leftAssertionList, rightAssertionList, standardNameByStandardKey, leftLabel, rightLabel })
//       one unit per from-node both versions answer: stable (identical full-MSI sets), predicateChanged (same objects, another
//       predicate), flipped (both picked, other objects), newlyPicked, newlyAbstained.
//
// THE UNIT OF AGREEMENT is the MSI (assertionIdentity.mappingSamenessIdFor). Ruled: agreement is on the OBJECT, so the scored MSI is
// OBJECT-LEVEL: (element IRI, skos:mappingRelation, object IRI), every predicate projected onto the SKOS super-property; an abstention
// already carries that predicate, so a judge's abstention and a rater's No match have the SAME object-level MSI. The full-predicate
// MSI is computed beside it and reported (fullPredicateAgreementCount); judge and rater can never share one on a mapped row (edc:
// against skos:), by design.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { nodeIriFor, predicateIriFor, mappingSamenessIdFor } = require(path.join(__dirname, '..', 'edc-uri', 'assertionIdentity'));
const { NO_TERM_FOUND_PREDICATE_ID, NO_TERM_FOUND_OBJECT_ID } = require(path.join(__dirname, '..', 'bridge-framework', 'sssomExporter'));

const JUDGE_RATER_CATEGORY_LIST = Object.freeze(['hit', 'miss', 'agreedAbsence', 'judgePickedRaterNoMatch', 'judgeAbstainedRaterPicked']);
const VERSION_CATEGORY_LIST = Object.freeze(['stable', 'predicateChanged', 'flipped', 'newlyPicked', 'newlyAbstained']);
const UNKNOWN_ELEMENT_KIND = 'kindNotSupplied';

const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const byText = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);
const sortedUnique = (textList) => Array.from(new Set(textList)).sort(byText);
const ratioOf = (partCount, wholeCount) => (wholeCount === 0 ? null : Number((partCount / wholeCount).toFixed(4)));

// msiToolkitFor — the element IRI (edc element kind, the standard's _source name and version) and the two MSIs of an assertion
const msiToolkitFor = ({ standardNameByStandardKey, extraPredicateExpansionByPrefix }) => {
	const projectedPredicate = predicateIriFor(NO_TERM_FOUND_PREDICATE_ID);
	const elementIriOf = ({ elementStableId, standardKey, standardVersion }) => {
		const standardName = standardNameByStandardKey[standardKey];
		if (!isNonEmptyString(standardName)) {
			return { error: refusalText(`standard '${standardKey}' (of ${elementStableId}) has no standardName`, 'standardNameByStandardKey, read from recipes/layers.json standardList') };
		}
		return nodeIriFor({ stableId: elementStableId, standardName, standardVersion });
	};
	const predicateIriOfAny = (predicateId) => {
		const prefix = predicateId.slice(0, predicateId.indexOf(':'));
		if (extraPredicateExpansionByPrefix[prefix] !== undefined && predicateIriFor(predicateId).error) {
			return { iri: `${extraPredicateExpansionByPrefix[prefix]}${predicateId.slice(prefix.length + 1)}` };
		}
		return predicateIriFor(predicateId);
	};
	// msiPairFor(elementIri, assertion) → { objectLevelMsi, fullMsi } | { error }
	const msiPairFor = (elementIri, oneAssertion) => {
		// an object is a hub card (an absolute IRI) or a vocabulary term (sssom:NoTermFound); anything else is refused, never minted
		const objectIri = /^https?:\/\//.test(oneAssertion.objectId) || oneAssertion.objectId === NO_TERM_FOUND_OBJECT_ID ? nodeIriFor({ stableId: oneAssertion.objectId }) : { error: refusalText(`object ${JSON.stringify(oneAssertion.objectId)} is neither a card IRI nor ${NO_TERM_FOUND_OBJECT_ID}`, 'a compared object is a hub card or an abstention') };
		const fullPredicate = predicateIriOfAny(oneAssertion.predicateId);
		if (objectIri.error || fullPredicate.error) {
			return { error: `${moduleName}: ${oneAssertion.fromStableId} → ${oneAssertion.objectId}: ${objectIri.error || fullPredicate.error}` };
		}
		const objectLevel = mappingSamenessIdFor({ subjectIriList: [elementIri], predicateIri: projectedPredicate.iri, objectIriList: [objectIri.iri], isNegative: false });
		const full = mappingSamenessIdFor({ subjectIriList: [elementIri], predicateIri: fullPredicate.iri, objectIriList: [objectIri.iri], isNegative: false });
		return objectLevel.error || full.error ? { error: objectLevel.error || full.error } : { objectLevelMsi: objectLevel.mappingSamenessId, fullMsi: full.mappingSamenessId };
	};
	return { elementIriOf, msiPairFor };
};

// answerOf(assertionList, elementIri, msiPairFor) → { isAbstention, objectIdList, objectLevelMsiList, fullMsiList } | { error }
const answerOf = ({ assertionList, elementIri, msiPairFor }) => {
	const pairList = [];
	for (let assertionIndex = 0; assertionIndex < assertionList.length; assertionIndex++) {
		const msiPair = msiPairFor(elementIri, assertionList[assertionIndex]);
		if (msiPair.error) {
			return { error: msiPair.error };
		}
		pairList.push(msiPair);
	}
	const pickedList = assertionList.filter((oneAssertion) => !oneAssertion.isAbstention);
	if (pickedList.length > 0 && pickedList.length !== assertionList.length) {
		return { error: refusalText(`element ${elementIri} is both picked and abstained in one answer`, 'an answer is either cards or an abstention, never both') };
	}
	return {
		isAbstention: pickedList.length === 0,
		objectIdList: sortedUnique(pickedList.map((oneAssertion) => oneAssertion.objectId)),
		objectLevelMsiList: sortedUnique(pairList.map((onePair) => onePair.objectLevelMsi)),
		fullMsiList: sortedUnique(pairList.map((onePair) => onePair.fullMsi)),
	};
};

const sharedCount = (leftList, rightList) => leftList.filter((oneItem) => rightList.indexOf(oneItem) !== -1).length;
const emptyTallyFor = (categoryList) => categoryList.reduce((soFar, oneCategory) => ({ ...soFar, [oneCategory]: 0 }), { unitCount: 0 });
const tallyBy = ({ unitList, categoryList, dimensionOf, extraCounterList }) =>
	unitList.reduce((soFar, oneUnit) => {
		const dimensionValue = dimensionOf(oneUnit);
		const tally = soFar[dimensionValue] === undefined ? { ...emptyTallyFor(categoryList), ...extraCounterList.reduce((counters, oneCounter) => ({ ...counters, [oneCounter]: 0 }), {}) } : soFar[dimensionValue];
		tally.unitCount += 1;
		tally[oneUnit.category] += 1;
		extraCounterList.forEach((oneCounter) => {
			tally[oneCounter] += oneUnit[oneCounter] ? 1 : 0;
		});
		return { ...soFar, [dimensionValue]: tally };
	}, {});
// groupedBy(itemList, groupTextOf) → { groupText: [item, …] } — a local accumulator, linear (a spread per item is quadratic on 10^4 rows)
const groupedBy = (itemList, groupTextOf) => {
	const groupByText = {};
	itemList.forEach((oneItem) => {
		const groupText = groupTextOf(oneItem);
		if (groupByText[groupText] === undefined) {
			groupByText[groupText] = [];
		}
		groupByText[groupText].push(oneItem);
	});
	return groupByText;
};
const sortedObjectOf = (unsortedObject) => Object.keys(unsortedObject).sort(byText).reduce((soFar, oneName) => ({ ...soFar, [oneName]: unsortedObject[oneName] }), {});

const compareJudgeAgainstRater = ({ judgeAssertionList, raterAssertionList, raterUnsureList, elementKindByStableId, standardNameByStandardKey, hubName, judgeLabel, raterLabel, raterPredicateExpansionByPrefix, raterBestPredicateId } = {}) => {
	if (!Array.isArray(judgeAssertionList) || !Array.isArray(raterAssertionList) || !Array.isArray(raterUnsureList) || !elementKindByStableId || !standardNameByStandardKey || !isNonEmptyString(hubName) || !isNonEmptyString(judgeLabel) || !isNonEmptyString(raterLabel) || !isNonEmptyString(raterBestPredicateId)) {
		return { error: refusalText('judgeAssertionList, raterAssertionList, raterUnsureList, elementKindByStableId, standardNameByStandardKey, hubName, judgeLabel, raterLabel and raterBestPredicateId are required', 'compareJudgeAgainstRater({ … }); nothing is defaulted') };
	}
	const unauthoredRow = raterAssertionList.find((oneAssertion) => !isNonEmptyString(oneAssertion.authorIri));
	if (unauthoredRow !== undefined) {
		return { error: refusalText(`rater row for ${unauthoredRow.fromStableId} carries no author_id`, 'an answer unit is (rater, element); the pooled rater set names its rater on every row') };
	}
	const { elementIriOf, msiPairFor } = msiToolkitFor({ standardNameByStandardKey, extraPredicateExpansionByPrefix: raterPredicateExpansionByPrefix || {} });
	const judgeByFromNode = groupedBy(judgeAssertionList, (oneAssertion) => oneAssertion.fromStableId);
	const judgeByJudgedSubject = groupedBy(judgeAssertionList, (oneAssertion) => oneAssertion.judgedSubjectStableId);
	const raterByUnit = groupedBy(raterAssertionList, (oneAssertion) => `${oneAssertion.authorIri}\u001f${oneAssertion.fromStableId}`);
	const unitList = [];
	const judgeUncoveredList = [];
	const unitTextList = Object.keys(raterByUnit).sort(byText);
	for (let unitIndex = 0; unitIndex < unitTextList.length; unitIndex++) {
		const raterUnitAssertionList = raterByUnit[unitTextList[unitIndex]];
		const { authorIri, fromStableId: elementStableId, standardKey, standardVersion } = raterUnitAssertionList[0];
		const elementIri = elementIriOf({ elementStableId, standardKey, standardVersion });
		if (elementIri.error) {
			return { error: elementIri.error };
		}
		const judgeUnitAssertionList = judgeByFromNode[elementStableId] || judgeByJudgedSubject[elementStableId];
		if (judgeUnitAssertionList === undefined) {
			judgeUncoveredList.push({ authorIri, elementStableId });
			continue;
		}
		const raterAnswer = answerOf({ assertionList: raterUnitAssertionList, elementIri: elementIri.iri, msiPairFor });
		const judgeAnswer = answerOf({ assertionList: judgeUnitAssertionList, elementIri: elementIri.iri, msiPairFor });
		if (raterAnswer.error || judgeAnswer.error) {
			return { error: raterAnswer.error || judgeAnswer.error };
		}
		const objectLevelShared = sharedCount(judgeAnswer.objectLevelMsiList, raterAnswer.objectLevelMsiList);
		const category = judgeAnswer.isAbstention
			? raterAnswer.isAbstention
				? 'agreedAbsence'
				: 'judgeAbstainedRaterPicked'
			: raterAnswer.isAbstention
				? 'judgePickedRaterNoMatch'
				: objectLevelShared > 0
					? 'hit'
					: 'miss';
		const raterBestObjectIdList = sortedUnique(raterUnitAssertionList.filter((oneAssertion) => oneAssertion.predicateId === raterBestPredicateId).map((oneAssertion) => oneAssertion.objectId));
		unitList.push({
			elementStableId,
			authorIri,
			standardKey,
			hubName,
			elementKind: elementKindByStableId[elementStableId] === undefined ? UNKNOWN_ELEMENT_KIND : elementKindByStableId[elementStableId],
			category,
			bestHit: category === 'hit' && sharedCount(judgeAnswer.objectIdList, raterBestObjectIdList) > 0,
			fullPredicateAgreement: sharedCount(judgeAnswer.fullMsiList, raterAnswer.fullMsiList) > 0,
			judgedVia: judgeByFromNode[elementStableId] !== undefined ? 'fromNode' : 'judgedSubject',
			judgeObjectIdList: judgeAnswer.objectIdList,
			raterBestObjectIdList,
			raterObjectIdList: raterAnswer.objectIdList,
		});
	}
	const extraCounterList = ['bestHit', 'fullPredicateAgreement'];
	const tallyOf = (dimensionOf) => sortedObjectOf(tallyBy({ unitList, categoryList: JUDGE_RATER_CATEGORY_LIST, dimensionOf, extraCounterList }));
	const overall = tallyOf(() => 'all').all || { ...emptyTallyFor(JUDGE_RATER_CATEGORY_LIST), bestHit: 0, fullPredicateAgreement: 0 };
	const pickedBothCount = overall.hit + overall.miss;
	return {
		comparisonKind: 'judgeAgainstRater',
		judgeLabel,
		raterLabel,
		hubName,
		agreementUnit: 'object-level MSI: (element IRI, skos:mappingRelation, object IRI); the full-predicate MSI reported beside it',
		coverage: {
			raterAnswerUnitCount: unitTextList.length,
			raterUnsureUnitCount: raterUnsureList.length,
			raterUnsureList: raterUnsureList.slice().sort((leftUnit, rightUnit) => byText(`${leftUnit.authorIri}${leftUnit.elementStableId}`, `${rightUnit.authorIri}${rightUnit.elementStableId}`)),
			judgeUncoveredCount: judgeUncoveredList.length,
			judgeUncoveredList,
			scoredUnitCount: unitList.length,
			scoredElementCount: sortedUnique(unitList.map((oneUnit) => oneUnit.elementStableId)).length,
			scoredRaterCount: sortedUnique(unitList.map((oneUnit) => oneUnit.authorIri)).length,
			judgedViaJudgedSubjectCount: unitList.filter((oneUnit) => oneUnit.judgedVia === 'judgedSubject').length,
		},
		overall: { ...overall, hitRateWhereBothPicked: ratioOf(overall.hit, pickedBothCount), absenceAgreementRate: ratioOf(overall.agreedAbsence, overall.agreedAbsence + overall.judgePickedRaterNoMatch + overall.judgeAbstainedRaterPicked) },
		byStandard: tallyOf((oneUnit) => oneUnit.standardKey),
		byHub: tallyOf((oneUnit) => oneUnit.hubName),
		byElementKind: tallyOf((oneUnit) => oneUnit.elementKind),
		byRater: tallyOf((oneUnit) => oneUnit.authorIri),
		unitList,
	};
};

const compareVersionAgainstVersion = ({ leftAssertionList, rightAssertionList, standardNameByStandardKey, leftLabel, rightLabel } = {}) => {
	if (!Array.isArray(leftAssertionList) || !Array.isArray(rightAssertionList) || !standardNameByStandardKey || !isNonEmptyString(leftLabel) || !isNonEmptyString(rightLabel)) {
		return { error: refusalText('leftAssertionList, rightAssertionList, standardNameByStandardKey, leftLabel and rightLabel are required', 'compareVersionAgainstVersion({ … }); nothing is defaulted') };
	}
	const { elementIriOf, msiPairFor } = msiToolkitFor({ standardNameByStandardKey, extraPredicateExpansionByPrefix: {} });
	const groupedOf = (assertionList) => groupedBy(assertionList, (oneAssertion) => oneAssertion.fromStableId);
	const leftByElement = groupedOf(leftAssertionList);
	const rightByElement = groupedOf(rightAssertionList);
	const sharedElementList = Object.keys(leftByElement).filter((elementStableId) => rightByElement[elementStableId] !== undefined).sort(byText);
	const unitList = [];
	for (let elementIndex = 0; elementIndex < sharedElementList.length; elementIndex++) {
		const elementStableId = sharedElementList[elementIndex];
		const { standardKey, standardVersion } = leftByElement[elementStableId][0];
		const elementIri = elementIriOf({ elementStableId, standardKey, standardVersion });
		if (elementIri.error) {
			return { error: elementIri.error };
		}
		const leftAnswer = answerOf({ assertionList: leftByElement[elementStableId], elementIri: elementIri.iri, msiPairFor });
		const rightAnswer = answerOf({ assertionList: rightByElement[elementStableId], elementIri: elementIri.iri, msiPairFor });
		if (leftAnswer.error || rightAnswer.error) {
			return { error: leftAnswer.error || rightAnswer.error };
		}
		const sameFull = JSON.stringify(leftAnswer.fullMsiList) === JSON.stringify(rightAnswer.fullMsiList);
		const sameObjects = JSON.stringify(leftAnswer.objectLevelMsiList) === JSON.stringify(rightAnswer.objectLevelMsiList);
		const category = sameFull ? 'stable' : sameObjects ? 'predicateChanged' : leftAnswer.isAbstention ? 'newlyPicked' : rightAnswer.isAbstention ? 'newlyAbstained' : 'flipped';
		unitList.push({ elementStableId, standardKey, category, leftObjectIdList: leftAnswer.objectIdList, rightObjectIdList: rightAnswer.objectIdList, leftIsAbstention: leftAnswer.isAbstention, rightIsAbstention: rightAnswer.isAbstention });
	}
	const tallyOf = (dimensionOf) => sortedObjectOf(tallyBy({ unitList, categoryList: VERSION_CATEGORY_LIST, dimensionOf, extraCounterList: [] }));
	const overall = tallyOf(() => 'all').all || emptyTallyFor(VERSION_CATEGORY_LIST);
	return {
		comparisonKind: 'versionAgainstVersion',
		leftLabel,
		rightLabel,
		agreementUnit: 'full MSI per from-node (stable); object-level MSI separates predicateChanged from flipped',
		coverage: { leftElementCount: Object.keys(leftByElement).length, rightElementCount: Object.keys(rightByElement).length, sharedElementCount: sharedElementList.length, leftOnlyCount: Object.keys(leftByElement).length - sharedElementList.length, rightOnlyCount: Object.keys(rightByElement).length - sharedElementList.length },
		overall: { ...overall, stableRate: ratioOf(overall.stable, overall.unitCount) },
		byStandard: tallyOf((oneUnit) => oneUnit.standardKey),
		changedUnitList: unitList.filter((oneUnit) => oneUnit.category !== 'stable'),
	};
};

module.exports = { compareJudgeAgainstRater, compareVersionAgainstVersion, JUDGE_RATER_CATEGORY_LIST, VERSION_CATEGORY_LIST, moduleName };
