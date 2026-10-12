'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// armPools.js — the four arms of DESIGN-WALK §3, one REGISTRY ROW each. A row's buildPool(armInput, callback) answers
// callback(errString, { cappedCardStableIdList, uncappedCardStableIdList, walkTrace }) — the pool the judge sees (at
// most poolCardCount cards), the pool before the cap, and what the walk chose on the way.
//
// Ranking inside a walk is A0's own card-text similarity (candidateRetrieval.cardTextCosineFor: the subject's own
// text vectors against each card's whole-card vector), highest first, ties by stableId. The walk decides WHERE to
// look; similarity decides the order (design §3). A0's neighbour votes are not applied to the walks: they are not an
// embedding similarity, and the design names similarity alone.
//
// armInput = { runContext, structureIndex, walkChooser, walkWidth, poolCardCount, subjectStableId, sourceElementData,
//              poolMemo }   — poolMemo holds the arms already built for this subject, so A2 and A3 reuse A0 and A1
//                             rather than asking again (the cache would answer anyway; this keeps the cost honest).

const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const BRIDGE_LIB = path.join(TREE_ROOT, 'lib', 'bridge-framework');
const candidateRetrievalLib = require(path.join(BRIDGE_LIB, 'candidateRetrieval'));
const candidateRetrievalMethodRegistryLib = require(path.join(BRIDGE_LIB, 'candidateRetrievalMethodRegistry'));

const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);
const distinctList = (stableIdList) => Array.from(new Set(stableIdList));

// rankByCardText — A0's similarity over a walk's raw pool. A subject with no text record cannot be ranked and is
// refused by name (cardTextCosineFor refuses it too); it is never ranked by stableId instead.
const rankByCardText = ({ runContext, subjectStableId, cardStableIdList }) => {
	if (cardStableIdList.length === 0) {
		return { rankedList: [] };
	}
	const textRecordListBySourceStableId = runContext.retrievalState.textRecordListBySourceStableId;
	if (!textRecordListBySourceStableId.has(subjectStableId)) {
		return { error: `${moduleName}: subject ${subjectStableId} has no text record, so a walk pool cannot be ranked by A0's similarity` };
	}
	const unvotedList = cardStableIdList.slice().sort(compareStrings).map((oneStableId) => ({ stableId: oneStableId, ownVotes: 0, bestCosine: 0, pathList: [] }));
	const scored = candidateRetrievalLib.cardTextCosineFor({ admittedList: unvotedList, subjectTextRecordList: textRecordListBySourceStableId.get(subjectStableId), hubVectorIndex: runContext.retrievalState.hubVectorIndex });
	if (scored.error) {
		return { error: `${moduleName}: ${scored.error.message}` };
	}
	return { rankedList: scored.admittedList.slice().sort((leftEntry, rightEntry) => rightEntry.cardTextCosine - leftEntry.cardTextCosine || compareStrings(leftEntry.stableId, rightEntry.stableId)).map((oneEntry) => oneEntry.stableId) };
};

// a class or property with no card, an entity whose placements reach no property, a domain with no entity: each is a
// true empty answer of the structure (the || [] is that reading), never a missing input
const cardsOfClassList = ({ structureIndex, classStableIdList }) => distinctList([].concat(...classStableIdList.map((oneStableId) => structureIndex.cardStableIdListByClassStableId[oneStableId] || [])));
const cardsOfPropertyList = ({ structureIndex, propertyStableIdList }) => distinctList([].concat(...propertyStableIdList.map((oneStableId) => structureIndex.cardStableIdListByPropertyStableId[oneStableId] || [])));

const cappedResult = ({ runContext, subjectStableId, rawCardStableIdList, poolCardCount, walkTrace }) => {
	const ranked = rankByCardText({ runContext, subjectStableId, cardStableIdList: rawCardStableIdList });
	if (ranked.error) {
		return { error: ranked.error };
	}
	return { pool: { cappedCardStableIdList: ranked.rankedList.slice(0, poolCardCount), uncappedCardStableIdList: ranked.rankedList, walkTrace } };
};

// conceptWalk — A1: concepts → classes (primary and secondary members) → the chosen classes' cards
const conceptWalk = (armInput, callback) => {
	const { runContext, structureIndex, walkChooser, walkWidth, poolCardCount, subjectStableId, sourceElementData } = armInput;
	const conceptOptionList = structureIndex.conceptList.map((oneConcept) => ({ optionStableId: oneConcept.conceptStableId, criteria: { name: oneConcept.name, definition: oneConcept.definition } }));
	walkChooser.chooseTop({ questionKind: 'concept', sourceElementData, optionList: conceptOptionList, topCount: walkWidth.conceptTopCount }, (conceptError, conceptChoice) => {
		if (conceptError) {
			callback(conceptError);
			return;
		}
		// a concept no class is assigned to (Claim) offers nothing; its members are an empty list, not an error
		const memberClassStableIdList = distinctList([].concat(...conceptChoice.rankedOptionList.map((oneConcept) => structureIndex.classStableIdListByConceptStableId[oneConcept.optionStableId] || []))).sort(compareStrings);
		if (memberClassStableIdList.length === 0) {
			const emptied = cappedResult({ runContext, subjectStableId, rawCardStableIdList: [], poolCardCount, walkTrace: { conceptTrace: conceptChoice.trace, classTrace: null, memberClassCount: 0 } });
			callback(emptied.error || '', emptied.pool);
			return;
		}
		const classOptionList = memberClassStableIdList.map((oneStableId) => ({ optionStableId: oneStableId, criteria: { name: structureIndex.classByStableId[oneStableId].name, definition: structureIndex.classByStableId[oneStableId].definition } }));
		walkChooser.chooseTop({ questionKind: 'class', sourceElementData, optionList: classOptionList, topCount: walkWidth.classTopCount }, (classError, classChoice) => {
			if (classError) {
				callback(classError);
				return;
			}
			const chosenClassStableIdList = classChoice.rankedOptionList.map((oneClass) => oneClass.optionStableId);
			const built = cappedResult({ runContext, subjectStableId, rawCardStableIdList: cardsOfClassList({ structureIndex, classStableIdList: chosenClassStableIdList }), poolCardCount, walkTrace: { conceptTrace: conceptChoice.trace, classTrace: classChoice.trace, memberClassCount: memberClassStableIdList.length, memberClassStableIdList, chosenClassStableIdList } });
			callback(built.error || '', built.pool);
		});
	});
};

// desWalk — A2: DES domains → entities within them → the properties their placements reach → those properties' cards,
// plus A1's cards for properties NO placement reaches (the 390), so V13's gap cannot hide the answer
const desWalk = (armInput, callback) => {
	const { runContext, structureIndex, walkChooser, walkWidth, poolCardCount, subjectStableId, sourceElementData, poolMemo } = armInput;
	const conceptPool = poolMemo.A1;
	if (conceptPool === undefined) {
		callback(`${moduleName}: A2 needs A1's pool for this subject; the arm order puts A1 first`);
		return;
	}
	const domainOptionList = structureIndex.desDomainList.map((oneDomain) => ({ optionStableId: oneDomain.desDomainStableId, criteria: { name: oneDomain.name } }));
	walkChooser.chooseTop({ questionKind: 'desDomain', sourceElementData, optionList: domainOptionList, topCount: walkWidth.desDomainTopCount }, (domainError, domainChoice) => {
		if (domainError) {
			callback(domainError);
			return;
		}
		const entityRowList = [].concat(...domainChoice.rankedOptionList.map((oneDomain) => structureIndex.desEntityListByDomainStableId[oneDomain.optionStableId] || [])).sort((leftRow, rightRow) => compareStrings(leftRow.desEntityStableId, rightRow.desEntityStableId));
		const entityOptionList = entityRowList.map((oneRow) => ({ optionStableId: oneRow.desEntityStableId, criteria: { name: oneRow.name, desDomainName: oneRow.desDomainName } }));
		const unplacedConceptCardList = conceptPool.uncappedCardStableIdList.filter((oneCardStableId) => structureIndex.propertyStableIdListByCardStableId[oneCardStableId].some((onePropertyStableId) => structureIndex.unplacedPropertyStableIdSet.has(onePropertyStableId)));
		const finishWith = ({ entityTrace, chosenEntityStableIdList }) => {
			const placedPropertyStableIdList = distinctList([].concat(...chosenEntityStableIdList.map((oneStableId) => structureIndex.propertyStableIdListByDesEntityStableId[oneStableId] || [])));
			const desCardList = cardsOfPropertyList({ structureIndex, propertyStableIdList: placedPropertyStableIdList });
			const built = cappedResult({ runContext, subjectStableId, rawCardStableIdList: distinctList(desCardList.concat(unplacedConceptCardList)), poolCardCount, walkTrace: { desDomainTrace: domainChoice.trace, desEntityTrace: entityTrace, chosenEntityStableIdList, desCardCount: desCardList.length, unplacedConceptCardCount: unplacedConceptCardList.length } });
			callback(built.error || '', built.pool);
		};
		if (entityOptionList.length === 0) {
			finishWith({ entityTrace: null, chosenEntityStableIdList: [] });
			return;
		}
		walkChooser.chooseTop({ questionKind: 'desEntity', sourceElementData, optionList: entityOptionList, topCount: walkWidth.desEntityTopCount }, (entityError, entityChoice) => {
			if (entityError) {
				callback(entityError);
				return;
			}
			finishWith({ entityTrace: entityChoice.trace, chosenEntityStableIdList: entityChoice.rankedOptionList.map((oneEntity) => oneEntity.optionStableId) });
		});
	});
};

// baselinePool — A0: the declared retrieval method's pool, exactly as the bridge builds it (reproduced 100/100), and,
// for uncapped recall, every card the method ADMITTED before its K cap (voteCandidatePool over the subject's texts)
const baselinePool = (armInput, callback) => {
	const { runContext, subjectStableId } = armInput;
	const pooled = candidateRetrievalMethodRegistryLib.poolForSubjectChecked({ methodRow: runContext.retrievalMethodRow, retrievalState: runContext.retrievalState, retrievalDeclaration: runContext.bridgeDeclaration.candidateRetrieval, subjectStableId, hubName: runContext.hubName });
	if (pooled.error) {
		callback(`${moduleName}: A0 pool for ${subjectStableId}: ${pooled.error.message}`);
		return;
	}
	const textRecordListBySourceStableId = runContext.retrievalState.textRecordListBySourceStableId;
	const voted = candidateRetrievalLib.voteCandidatePool({ searchMemo: runContext.retrievalState.searchMemo, cardSlotIndex: runContext.retrievalState.cardSlotIndex, subjectStableId, subjectTextRecordList: textRecordListBySourceStableId.has(subjectStableId) ? textRecordListBySourceStableId.get(subjectStableId) : [] });
	if (voted.error) {
		callback(`${moduleName}: A0 admitted list for ${subjectStableId}: ${voted.error.message}`);
		return;
	}
	callback('', { cappedCardStableIdList: pooled.seatStableIdList.slice(), uncappedCardStableIdList: voted.admittedList.map((oneEntry) => oneEntry.stableId), walkTrace: null });
};

// embeddingPlusConcept — A3: A0's pool merged with A1's, deduplicated, ranked by A0's similarity, capped
const embeddingPlusConcept = (armInput, callback) => {
	const { runContext, poolCardCount, subjectStableId, poolMemo } = armInput;
	if (poolMemo.A0 === undefined || poolMemo.A1 === undefined) {
		callback(`${moduleName}: A3 needs A0's and A1's pools for this subject; the arm order puts both first`);
		return;
	}
	const merged = cappedResult({ runContext, subjectStableId, rawCardStableIdList: distinctList(poolMemo.A0.cappedCardStableIdList.concat(poolMemo.A1.cappedCardStableIdList)), poolCardCount, walkTrace: { fromA0Count: poolMemo.A0.cappedCardStableIdList.length, fromA1Count: poolMemo.A1.cappedCardStableIdList.length } });
	if (merged.error) {
		callback(merged.error);
		return;
	}
	callback('', { ...merged.pool, uncappedCardStableIdList: distinctList(poolMemo.A0.uncappedCardStableIdList.concat(poolMemo.A1.uncappedCardStableIdList)) });
};

// ARM_ROW_LIST — the arms, in the order they must be built for one subject (A2 and A3 read earlier arms' pools)
const ARM_ROW_LIST = Object.freeze([
	Object.freeze({ armName: 'A0', armTitle: 'baseline: today\'s embedding pool', buildPool: baselinePool }),
	Object.freeze({ armName: 'A1', armTitle: 'concept walk', buildPool: conceptWalk }),
	Object.freeze({ armName: 'A2', armTitle: 'DES first, concept behind', buildPool: desWalk }),
	Object.freeze({ armName: 'A3', armTitle: 'embedding plus concept', buildPool: embeddingPlusConcept }),
]);
// ARM_PREREQUISITE_BY_ARM_NAME — which arms a run must also build so an asked arm can be built
const ARM_PREREQUISITE_BY_ARM_NAME = Object.freeze({ A0: [], A1: [], A2: ['A1'], A3: ['A0', 'A1'] });

module.exports = { ARM_ROW_LIST, ARM_PREREQUISITE_BY_ARM_NAME, rankByCardText, moduleName };
