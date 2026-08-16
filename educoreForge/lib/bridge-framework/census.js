'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// census.js — cardinalityCensus (the per-TARGET table + the per-SUBJECT table under the NORMATIVE PRECEDENCE
// RULE) and contentionCensus (SPEC-bridgeFramework-v1.md §5.8; RULINGS BF4, BF8, BF17, P12; BR-007, BR-034).
// NEW code (shares only the naming style with lib/forge-framework/census.js — RULING BF12). PURE.
//
// Precedence (per subject, first match wins): subjectCollision › sourceGap › specified (≥1 specified target)
// › judged (≥1 judged target, none specified) › orphan (every target orphaned or value-tier-refused).
// `abstained` is a per-target outcome inside a judged subject, never a subject bucket. conflictCount is a
// REPORT member and NEVER a census member (RULING BF8) — the census is a MEMBER of the frozen text.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const SUBJECT_BUCKET_LIST = Object.freeze(['subjectCollision', 'sourceGap', 'specified', 'judged', 'orphan']);
const TRIPLE_SEPARATOR = '\u001f';

// contentionCensus({ cardListByCanonicalKey }) → { cardCount, distinctKeyCount, contendedKeyCount, worstContention, tier }
const contentionCensus = ({ cardListByCanonicalKey, tier } = {}) => {
	if (!cardListByCanonicalKey || typeof cardListByCanonicalKey.cardCount !== 'function') {
		throw refuse.byName({ moduleName, what: 'contentionCensus needs the multimap (makeCardListByCanonicalKey)', where: 'measured PER RUN from the index, never carried as a constant (BR-034)' });
	}
	return {
		cardCount: cardListByCanonicalKey.cardCount(),
		distinctKeyCount: cardListByCanonicalKey.distinctKeyCount(),
		contendedKeyCount: cardListByCanonicalKey.contendedKeyCount(),
		worstContention: cardListByCanonicalKey.worstContention(),
		tier: tier === undefined ? 'property' : tier,
	};
};

// cardinalityCensus({ decisionRecordList, subjectCollisionList, sourceGapList, ...counters })
//   → { perTarget: {...}, perSubject: {...} }  — every member EQUAL-comparable, no band
const cardinalityCensus = ({
	decisionRecordList,
	subjectCollisionList,
	sourceGapList,
	sentinelDroppedCount,
	sentinelLabelledRowCount,
	labelRefusedCount,
	manyToOneSubjectCount,
	refusedValueTierAssertionCount,
	edgeCount,
	contentionCensus: contention,
	indexCollisionCount,
} = {}) => {
	if (!Array.isArray(decisionRecordList) || !Array.isArray(subjectCollisionList) || !Array.isArray(sourceGapList)) {
		throw refuse.byName({ moduleName, what: 'cardinalityCensus needs decisionRecordList, subjectCollisionList and sourceGapList (arrays)', where: 'the acceptance instrument counts records, never guesses' });
	}
	const perTarget = {
		targetCount: decisionRecordList.length,
		specifiedCount: 0,
		judgedCount: 0,
		sourceSideMismatchCount: 0,
		tentativeCount: 0,
		abstainedCount: 0,
		orphanCount: 0,
		valueTierRefusedCount: 0,
		sentinelDroppedCount: sentinelDroppedCount === undefined ? 0 : sentinelDroppedCount,
		sentinelLabelledRowCount: sentinelLabelledRowCount === undefined ? 0 : sentinelLabelledRowCount,
		labelRefusedCount: labelRefusedCount === undefined ? 0 : labelRefusedCount,
		manyToOneSubjectCount: manyToOneSubjectCount === undefined ? 0 : manyToOneSubjectCount,
		refusedValueTierAssertionCount: refusedValueTierAssertionCount === undefined ? 0 : refusedValueTierAssertionCount,
		remodelAppliedCount: { propertySide: 0, classSide: 0 },
		distinctTripleCount: 0,
		edgeCount: edgeCount === undefined ? 0 : edgeCount,
		contentionCensus: contention === undefined ? null : contention,
		indexCollisionCount: indexCollisionCount === undefined ? 0 : indexCollisionCount,
	};
	const tripleSet = new Set();
	const bucketBySubjectStableId = {};
	const rankByClassification = { specified: 3, judged: 2, orphan: 1, valueTierRefused: 1 };
	decisionRecordList.forEach((oneRecord) => {
		if (oneRecord.classification === 'specified') {
			perTarget.specifiedCount += 1;
		} else if (oneRecord.classification === 'judged') {
			perTarget.judgedCount += 1;
			if (oneRecord.judgedReason === 'sourceSideMismatch') {
				perTarget.sourceSideMismatchCount += 1;
			}
			if (oneRecord.judgedReason === 'tentative') {
				perTarget.tentativeCount += 1;
			}
			if (oneRecord.abstained === true) {
				perTarget.abstainedCount += 1;
			}
		} else if (oneRecord.classification === 'orphan') {
			perTarget.orphanCount += 1;
		} else if (oneRecord.classification === 'valueTierRefused') {
			perTarget.valueTierRefusedCount += 1;
		}
		if (oneRecord.remodelApplied) {
			if (oneRecord.remodelApplied.side === 'property' || oneRecord.remodelApplied.side === 'propertyAndClass') {
				perTarget.remodelAppliedCount.propertySide += 1;
			}
			if (oneRecord.remodelApplied.side === 'class' || oneRecord.remodelApplied.side === 'propertyAndClass') {
				perTarget.remodelAppliedCount.classSide += 1;
			}
		}
		if (oneRecord.objectStableId) {
			tripleSet.add([oneRecord.subjectStableId, oneRecord.predicate, oneRecord.objectStableId].join(TRIPLE_SEPARATOR));
		}
		// per-subject bucket under precedence: specified beats judged beats orphan (collision/gap are separate lists)
		const soFar = bucketBySubjectStableId[oneRecord.subjectStableId];
		const thisRank = rankByClassification[oneRecord.classification] === undefined ? 0 : rankByClassification[oneRecord.classification];
		if (soFar === undefined || thisRank > soFar) {
			bucketBySubjectStableId[oneRecord.subjectStableId] = thisRank;
		}
	});
	perTarget.distinctTripleCount = tripleSet.size;
	const perSubject = {
		subjectCount: 0,
		specifiedSubjectCount: 0,
		judgedSubjectCount: 0,
		orphanSubjectCount: 0,
		// per SUBJECT: every asserting subject of a collided leaf is one subjectCollision subject (SPEC §10.4: 7 leaves = 31 subjects)
		subjectCollisionCount: subjectCollisionList.reduce((soFar, oneCollision) => soFar + (Array.isArray(oneCollision.assertingSubjectList) ? oneCollision.assertingSubjectList.length : 1), 0),
		sourceGapCount: sourceGapList.length,
	};
	Object.keys(bucketBySubjectStableId).forEach((oneStableId) => {
		const bucketRank = bucketBySubjectStableId[oneStableId];
		if (bucketRank === 3) {
			perSubject.specifiedSubjectCount += 1;
		} else if (bucketRank === 2) {
			perSubject.judgedSubjectCount += 1;
		} else {
			perSubject.orphanSubjectCount += 1;
		}
	});
	perSubject.subjectCount = perSubject.specifiedSubjectCount + perSubject.judgedSubjectCount + perSubject.orphanSubjectCount + perSubject.subjectCollisionCount + perSubject.sourceGapCount;
	return { perTarget, perSubject };
};

// sumInvariantHolds(perSubject) → boolean (BG-CENSUS c)
const sumInvariantHolds = (perSubject) =>
	perSubject.specifiedSubjectCount + perSubject.judgedSubjectCount + perSubject.orphanSubjectCount + perSubject.subjectCollisionCount + perSubject.sourceGapCount === perSubject.subjectCount;

module.exports = { cardinalityCensus, contentionCensus, sumInvariantHolds, SUBJECT_BUCKET_LIST, moduleName };
