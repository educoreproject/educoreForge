'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sifRetrievalReplayLib.js — the RETRIEVAL-LEVEL re-run of the SIF bridge's candidate search (phase D2; PLAN small
// phases §3 D2, RULING round-2 #17 and round 3 K5). It re-runs embedTextVote-v1's votes-only search over records the
// graph reader has already returned (read ONCE per run), under any settings cell, optionally with some subject texts
// excluded, and measures how often SIF's own answer makes the pool. It never embeds, never judges and never writes.
//
//   readRetrievalInputs({ retrievalView, sourceStandardName, hubStandardName }, callback)
//     → callback('', { hubVectorRecordList, sourceTextRecordList, hubTextRecordList, cardBaseEdgeList })
//   makeReplayIndex({ retrievalInputs, embeddingModelVersion, hubName }) → { replayIndex } | { error }
//     the settings-free part (the hub vector index, the hub text index, the card slot index), built once per run
//   replayVoteLists({ replayIndex, retrievalSettings, subjectStableIdList, excludedPropertyNameListList })
//     → { voteListBySubjectStableId, excludedTextRecordCount } | { error }
//   compareWithBlock({ decisionBlock, voteListBySubjectStableId }) → { comparedRecordCount, differingRecordList }
//   scorableBlockFor({ decisionBlock, voteListBySubjectStableId, retrievalSettings }) → a COPY of the block whose
//     records carry the replayed retrievalVoteList and whose header carries the cell's settings, for the C5 scorer
//   admissionReportFor({ score, scorableBlock, annotation }) → the specified-target admission and its distributions
//   chooseCell({ cellResultList, poolMedianLimit }) → { chosenCellName, ruleTrace } | { error }
//
// WHY A RE-IMPLEMENTATION. The framework's embedTextVote-v1 glue (bridge-framework.js, the method row's
// prepareRetrieval and poolForSubject, and frozenRetrievalVoteListFor) is private. The PURE steps are called here
// unchanged (candidateRetrieval.js: buildHubVectorIndex, buildEmbedTextIndex, makeSearchMemo, buildCardSlotIndex,
// voteCandidatePool, cardTextCosineFor, rankVotedCandidates); only the glue between them is repeated. The control
// (the plan's gate (b)) is what makes that safe: with nothing excluded, at the block's own settings, the replay must
// reproduce every record's ORDERED retrievalVoteList exactly, never the rendered pool, which is re-sorted by stableId.
//
// VOTES ONLY. The SIF plugin declares neighbourVote null; a block whose header declares a neighbour vote is refused
// rather than replayed without it.
//
// THE EXCLUSION (RULING round-2 #17): a subject text record is dropped when its propertyNameList is EXACTLY one of the
// listed lists (['contextText'] for the twin). A text shared with another property is kept, as the ruling words it.

const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const candidateRetrievalLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'candidateRetrieval'));
const decisionBlockLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'decisionBlock'));
const refuse = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'refuse'));
const { DME_ROLES, hubEdgeType } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));

// the framework's own two tables, repeated because they are private to bridge-framework.js; the control catches a drift
const HUB_SLOT_BY_SLOT_KIND = Object.freeze({ property: 'PROPERTY', domain: 'DOMAIN', range: 'RANGE' });
const BASE_ROLE_BY_BASE_KIND = Object.freeze({ class: DME_ROLES.CLASS, property: DME_ROLES.PROPERTY, optionSet: DME_ROLES.OPTION_SET });
const PROPERTY_TIER = 'property';
// the votes-only entry shape frozenRetrievalVoteListFor projects (RANKED_ENTRY_SHAPE_REGISTRY.votesOnly)
const VOTES_ONLY_FIELD_NAME_LIST = Object.freeze(['bestCosine', 'cardTextCosine', 'cardTextWinningTextStableId', 'ownVotes', 'stableId']);

const compareStrings = candidateRetrievalLib.compareStrings;
const canonicalTextOf = (value) => decisionBlockLib.canonicalText(value);
const refusal = (what, where) => ({ error: refuse.byName({ moduleName, what, where }) });

// ---------------------------------------------------------------------------------------------------------
// THE ONE READ — the four retrieval reads the framework's embedTextVote-v1 row makes, in its order
// ---------------------------------------------------------------------------------------------------------
const readRetrievalInputs = ({ retrievalView, sourceStandardName, hubStandardName }, callback) => {
	retrievalView.readHubVectors({ referenceTier: PROPERTY_TIER }, (hubVectorError, hubVectorRecordList) => {
		if (hubVectorError) {
			callback(`${moduleName}: readHubVectors: ${hubVectorError}`);
			return;
		}
		retrievalView.readEmbedTextVectors({ standardName: sourceStandardName }, (sourceTextError, sourceTextRecordList) => {
			if (sourceTextError) {
				callback(`${moduleName}: readEmbedTextVectors (source '${sourceStandardName}'): ${sourceTextError}`);
				return;
			}
			retrievalView.readEmbedTextVectors({ standardName: hubStandardName }, (hubTextError, hubTextRecordList) => {
				if (hubTextError) {
					callback(`${moduleName}: readEmbedTextVectors (hub '${hubStandardName}'): ${hubTextError}`);
					return;
				}
				retrievalView.readCardBaseEdges({ referenceTier: PROPERTY_TIER }, (cardEdgeError, cardBaseEdgeList) => {
					if (cardEdgeError) {
						callback(`${moduleName}: readCardBaseEdges: ${cardEdgeError}`);
						return;
					}
					if (sourceTextRecordList.length === 0 || hubTextRecordList.length === 0) {
						callback(refuse.byName({ moduleName, what: `the read returned ${sourceTextRecordList.length} source and ${hubTextRecordList.length} hub text record(s)`, where: `both '${sourceStandardName}' and '${hubStandardName}' must carry text nodes; an empty side is never searched` }).message);
						return;
					}
					callback('', { hubVectorRecordList, sourceTextRecordList, hubTextRecordList, cardBaseEdgeList });
				});
			});
		});
	});
};

// ---------------------------------------------------------------------------------------------------------
// THE SETTINGS-FREE INDEX — built once, shared by every cell
// ---------------------------------------------------------------------------------------------------------
const makeReplayIndex = ({ retrievalInputs, embeddingModelVersion, hubName }) => {
	const hubVectorBuilt = candidateRetrievalLib.buildHubVectorIndex({ vectorRecordList: retrievalInputs.hubVectorRecordList, embeddingModelVersion });
	if (hubVectorBuilt.error) {
		return { error: hubVectorBuilt.error };
	}
	const searchedRoleList = Object.keys(BASE_ROLE_BY_BASE_KIND).map((oneBaseKind) => BASE_ROLE_BY_BASE_KIND[oneBaseKind]);
	const searchPopulationRecordList = retrievalInputs.hubTextRecordList.filter((oneRecord) => searchedRoleList.indexOf(oneRecord.sourceRole) !== -1);
	if (searchPopulationRecordList.length === 0) {
		return refusal(`none of the ${retrievalInputs.hubTextRecordList.length} hub text record(s) describes a node whose role is ${searchedRoleList.join(', ')}`, 'the search population is the hub texts of classes, properties and option sets (R-BR-9)');
	}
	const textIndexBuilt = candidateRetrievalLib.buildEmbedTextIndex({ textRecordList: searchPopulationRecordList, embeddingModelVersion });
	if (textIndexBuilt.error) {
		return { error: textIndexBuilt.error };
	}
	const slotNameBySlotKind = Object.keys(HUB_SLOT_BY_SLOT_KIND).reduce((soFar, oneSlotKind) => Object.assign(soFar, { [oneSlotKind]: hubEdgeType(hubName, HUB_SLOT_BY_SLOT_KIND[oneSlotKind]) }), {});
	const cardSlotEdgeList = retrievalInputs.cardBaseEdgeList.map((oneEdge) => ({ cardStableId: oneEdge.cardStableId, slot: oneEdge.edgeType, baseStableId: oneEdge.baseStableId, baseRole: oneEdge.baseRole }));
	const slotted = candidateRetrievalLib.buildCardSlotIndex({ cardSlotEdgeList, slotNameBySlotKind, baseRoleByBaseKind: { ...BASE_ROLE_BY_BASE_KIND } });
	if (slotted.error) {
		return { error: slotted.error };
	}
	const textRecordListBySourceStableId = new Map();
	retrievalInputs.sourceTextRecordList.forEach((oneRecord) => {
		if (!textRecordListBySourceStableId.has(oneRecord.sourceStableId)) {
			textRecordListBySourceStableId.set(oneRecord.sourceStableId, []);
		}
		textRecordListBySourceStableId.get(oneRecord.sourceStableId).push(oneRecord);
	});
	return { replayIndex: { hubName, embeddingModelVersion, hubVectorIndex: hubVectorBuilt.hubVectorIndex, embedTextIndex: textIndexBuilt.embedTextIndex, cardSlotIndex: slotted.cardSlotIndex, textRecordListBySourceStableId } };
};

// frozenVoteListFor — frozenRetrievalVoteListFor's votes-only projection: each path's slot kind becomes its graph edge type
const frozenVoteListFor = ({ rankedList, hubName }) =>
	rankedList.map((oneEntry) => ({
		...VOTES_ONLY_FIELD_NAME_LIST.reduce((soFar, oneFieldName) => Object.assign(soFar, { [oneFieldName]: oneEntry[oneFieldName] }), {}),
		pathList: oneEntry.pathList.map((onePath) => ({ embedTextStableId: onePath.embedTextStableId, propertyNameList: onePath.propertyNameList.slice(), hitTextStableId: onePath.hitTextStableId, baseStableId: onePath.baseStableId, baseKind: onePath.baseKind, edgeType: hubEdgeType(hubName, HUB_SLOT_BY_SLOT_KIND[onePath.slotKind]), cosine: onePath.cosine })),
	}));

const isExcludedRecord = ({ textRecord, excludedPropertyNameListList }) => {
	const recordListText = JSON.stringify(textRecord.propertyNameList);
	return excludedPropertyNameListList.some((oneList) => JSON.stringify(oneList) === recordListText);
};

// ---------------------------------------------------------------------------------------------------------
// ONE CELL — every listed subject's ordered vote list under one settings triple
// ---------------------------------------------------------------------------------------------------------
const replayVoteLists = ({ replayIndex, retrievalSettings, subjectStableIdList, excludedPropertyNameListList }) => {
	if (!Array.isArray(excludedPropertyNameListList)) {
		return refusal('excludedPropertyNameListList is absent', 'name the excluded lists, or pass [] to exclude nothing; there is no default');
	}
	const memoMade = candidateRetrievalLib.makeSearchMemo({ embedTextIndex: replayIndex.embedTextIndex, hitsPerText: retrievalSettings.hitsPerText, minScore: retrievalSettings.minScore });
	if (memoMade.error) {
		return { error: memoMade.error };
	}
	const voteListBySubjectStableId = {};
	let excludedTextRecordCount = 0;
	for (let subjectIndex = 0; subjectIndex < subjectStableIdList.length; subjectIndex++) {
		const subjectStableId = subjectStableIdList[subjectIndex];
		if (voteListBySubjectStableId[subjectStableId] !== undefined) {
			continue;
		}
		const ownRecordList = replayIndex.textRecordListBySourceStableId.has(subjectStableId) ? replayIndex.textRecordListBySourceStableId.get(subjectStableId) : [];
		const subjectTextRecordList = ownRecordList.filter((oneRecord) => !isExcludedRecord({ textRecord: oneRecord, excludedPropertyNameListList }));
		excludedTextRecordCount += ownRecordList.length - subjectTextRecordList.length;
		const voted = candidateRetrievalLib.voteCandidatePool({ searchMemo: memoMade.searchMemo, cardSlotIndex: replayIndex.cardSlotIndex, subjectStableId, subjectTextRecordList });
		if (voted.error) {
			return { error: voted.error };
		}
		// no admitted card: the framework's orphan (noCandidate), frozen with an empty list, routed before cardTextCosineFor
		if (voted.admittedList.length === 0) {
			voteListBySubjectStableId[subjectStableId] = [];
			continue;
		}
		const ordered = candidateRetrievalLib.cardTextCosineFor({ admittedList: voted.admittedList, subjectTextRecordList, hubVectorIndex: replayIndex.hubVectorIndex });
		if (ordered.error) {
			return { error: ordered.error };
		}
		const ranked = candidateRetrievalLib.rankVotedCandidates({ admittedList: ordered.admittedList, k: retrievalSettings.k });
		if (ranked.error) {
			return { error: ranked.error };
		}
		voteListBySubjectStableId[subjectStableId] = frozenVoteListFor({ rankedList: ranked.rankedList, hubName: replayIndex.hubName });
	}
	return { voteListBySubjectStableId, excludedTextRecordCount };
};

// ---------------------------------------------------------------------------------------------------------
// THE CONTROL — every record's ordered retrievalVoteList, byte for byte in canonical text
// ---------------------------------------------------------------------------------------------------------
const compareWithBlock = ({ decisionBlock, voteListBySubjectStableId }) => {
	const differingRecordList = [];
	decisionBlock.decisionRecordList.forEach((oneRecord, recordIndex) => {
		const replayedList = voteListBySubjectStableId[oneRecord.subjectStableId];
		const recordedText = oneRecord.retrievalVoteList === undefined ? '(absent)' : canonicalTextOf(oneRecord.retrievalVoteList);
		const replayedText = replayedList === undefined ? '(not replayed)' : canonicalTextOf(replayedList);
		if (recordedText !== replayedText || oneRecord.neighbourTrace !== null) {
			differingRecordList.push({ recordIndex, subjectStableId: oneRecord.subjectStableId, judgmentPartitionLabel: oneRecord.judgmentPartitionLabel === undefined ? null : oneRecord.judgmentPartitionLabel, recordedSeatList: recordedText === '(absent)' ? null : oneRecord.retrievalVoteList.map((oneEntry) => oneEntry.stableId), replayedSeatList: replayedList === undefined ? null : replayedList.map((oneEntry) => oneEntry.stableId), neighbourTraceIsNull: oneRecord.neighbourTrace === null });
		}
	});
	return { comparedRecordCount: decisionBlock.decisionRecordList.length, differingRecordList };
};

// scorableBlockFor — the block as one cell would have frozen it, for the C5 scorer (which reads an embedTextVote-v1
// record's retrievalVoteList, rank = position): each record's list is the cell's replayed one, and the header's
// settings are the cell's, so the scorer's cap flags describe the cell
const scorableBlockFor = ({ decisionBlock, voteListBySubjectStableId, retrievalSettings }) => ({
	header: { ...decisionBlock.header, candidateRetrieval: { ...decisionBlock.header.candidateRetrieval, hitsPerText: retrievalSettings.hitsPerText, minScore: retrievalSettings.minScore, k: retrievalSettings.k } },
	decisionRecordList: decisionBlock.decisionRecordList.map((oneRecord) => ({ ...oneRecord, retrievalVoteList: voteListBySubjectStableId[oneRecord.subjectStableId] })),
});

const medianOf = (numberList) => {
	if (numberList.length === 0) {
		return null;
	}
	const sortedList = numberList.slice().sort((leftNumber, rightNumber) => leftNumber - rightNumber);
	const middleIndex = Math.floor(sortedList.length / 2);
	return sortedList.length % 2 === 1 ? sortedList[middleIndex] : (sortedList[middleIndex - 1] + sortedList[middleIndex]) / 2;
};
const percentileOf = (numberList, fraction) => {
	const sortedList = numberList.slice().sort((leftNumber, rightNumber) => leftNumber - rightNumber);
	return sortedList.length === 0 ? null : sortedList[Math.min(sortedList.length - 1, Math.ceil(fraction * sortedList.length) - 1)];
};
const histogramOf = (numberList) => numberList.reduce((soFar, oneNumber) => Object.assign(soFar, { [oneNumber]: (soFar[oneNumber] || 0) + 1 }), {});
const shareOf = (numerator, denominator) => (denominator === 0 ? null : Number(((numerator / denominator) * 100).toFixed(2)));

// ---------------------------------------------------------------------------------------------------------
// ADMISSION — specified units whose target card is in the pool, at unit grain and weighted by annotated rows
// ---------------------------------------------------------------------------------------------------------
const admissionReportFor = ({ score, scorableBlock, annotation }) => {
	// a unit is (subject, partition label); the framework freezes an unpartitioned unit's label as null, and the scorer
	// reports an omitted one as null too, so both read as the same unit here
	const unitRefIdOf = ({ subjectStableId, judgmentPartitionLabel }) => `${subjectStableId}#${judgmentPartitionLabel === undefined || judgmentPartitionLabel === null ? '' : judgmentPartitionLabel}`;
	const recordByUnitRefId = {};
	scorableBlock.decisionRecordList.forEach((oneRecord) => {
		recordByUnitRefId[unitRefIdOf(oneRecord)] = oneRecord;
	});
	const annotatedRowCountOf = (oneRecord) => (oneRecord.instanceStableIdList === undefined ? null : oneRecord.instanceStableIdList.filter((oneStableId) => annotation.cedsElementIdByXpath[oneStableId.slice('sif260928:field'.length)] !== undefined).length);
	const tallyOf = (unitVerdictList) => {
		const specifiedList = unitVerdictList.filter((oneVerdict) => oneVerdict.standing === 'specified');
		const admittedList = specifiedList.filter((oneVerdict) => oneVerdict.bestKeyRank !== null);
		const rowCountOf = (oneVerdict) => annotatedRowCountOf(recordByUnitRefId[unitRefIdOf(oneVerdict)]);
		const specifiedRowCount = specifiedList.reduce((soFar, oneVerdict) => soFar + rowCountOf(oneVerdict), 0);
		const admittedRowCount = admittedList.reduce((soFar, oneVerdict) => soFar + rowCountOf(oneVerdict), 0);
		return {
			specifiedUnitCount: specifiedList.length,
			admittedUnitCount: admittedList.length,
			admissionPercent: shareOf(admittedList.length, specifiedList.length),
			specifiedRowCount,
			admittedRowCount,
			rowWeightedAdmissionPercent: shareOf(admittedRowCount, specifiedRowCount),
			targetRankHistogram: histogramOf(admittedList.map((oneVerdict) => oneVerdict.bestKeyRank)),
			targetRankMedian: medianOf(admittedList.map((oneVerdict) => oneVerdict.bestKeyRank)),
		};
	};
	const poolSizeList = scorableBlock.decisionRecordList.map((oneRecord) => oneRecord.retrievalVoteList.length);
	const pooledSizeList = poolSizeList.filter((onePoolSize) => onePoolSize > 0);
	const sharedBlockNameList = Array.from(new Set(score.unitVerdictList.map((oneVerdict) => oneVerdict.sharedBlock))).sort(compareStrings);
	return {
		overall: tallyOf(score.unitVerdictList),
		bySharedBlock: sharedBlockNameList.reduce((soFar, oneBlockName) => Object.assign(soFar, { [oneBlockName]: tallyOf(score.unitVerdictList.filter((oneVerdict) => oneVerdict.sharedBlock === oneBlockName)) }), {}),
		contendedKeyGrain: (() => {
			const contendedList = score.unitVerdictList.filter((oneVerdict) => oneVerdict.standing === 'contended');
			const retrievedCount = contendedList.filter((oneVerdict) => oneVerdict.bestKeyRank !== null).length;
			return { contendedUnitCount: contendedList.length, keyRetrievedUnitCount: retrievedCount, keyRetrievedPercent: shareOf(retrievedCount, contendedList.length) };
		})(),
		pool: {
			unitCount: poolSizeList.length,
			emptyPoolUnitCount: poolSizeList.length - pooledSizeList.length,
			medianPoolSize: medianOf(pooledSizeList),
			ninetiethPercentilePoolSize: percentileOf(pooledSizeList, 0.9),
			maximumPoolSize: pooledSizeList.length === 0 ? null : Math.max(...pooledSizeList),
			poolSizeHistogram: histogramOf(poolSizeList),
		},
	};
};

// ---------------------------------------------------------------------------------------------------------
// THE SELECTION RULE (committed to DEVLOG-D2 before the first cell): eligible when the median pool is at most the
// limit; the highest unit-grain admission wins; ties to the smaller hitsPerText, then the smaller k, then the larger minScore
// ---------------------------------------------------------------------------------------------------------
const chooseCell = ({ cellResultList, poolMedianLimit }) => {
	if (!Number.isFinite(poolMedianLimit)) {
		return refusal(`poolMedianLimit ${JSON.stringify(poolMedianLimit)} is not a number`, 'the rule names the limit (40); there is no default');
	}
	const eligibleList = cellResultList.filter((oneResult) => oneResult.admission.pool.medianPoolSize <= poolMedianLimit);
	if (eligibleList.length === 0) {
		return refusal(`no cell of ${cellResultList.length} has a median pool at or below ${poolMedianLimit}`, 'the rule chooses among eligible cells only');
	}
	const rankedList = eligibleList.slice().sort(
		(leftResult, rightResult) =>
			rightResult.admission.overall.admittedUnitCount / rightResult.admission.overall.specifiedUnitCount - leftResult.admission.overall.admittedUnitCount / leftResult.admission.overall.specifiedUnitCount ||
			leftResult.cell.hitsPerText - rightResult.cell.hitsPerText ||
			leftResult.cell.k - rightResult.cell.k ||
			rightResult.cell.minScore - leftResult.cell.minScore,
	);
	return {
		chosenCellName: rankedList[0].cell.cellName,
		ruleTrace: {
			ineligibleCellNameList: cellResultList.filter((oneResult) => eligibleList.indexOf(oneResult) === -1).map((oneResult) => oneResult.cell.cellName),
			rankedCellList: rankedList.map((oneResult) => ({ cellName: oneResult.cell.cellName, admittedUnitCount: oneResult.admission.overall.admittedUnitCount, specifiedUnitCount: oneResult.admission.overall.specifiedUnitCount, hitsPerText: oneResult.cell.hitsPerText, k: oneResult.cell.k, minScore: oneResult.cell.minScore, medianPoolSize: oneResult.admission.pool.medianPoolSize })),
		},
	};
};

module.exports = { readRetrievalInputs, makeReplayIndex, replayVoteLists, compareWithBlock, scorableBlockFor, admissionReportFor, chooseCell, medianOf, moduleName };
