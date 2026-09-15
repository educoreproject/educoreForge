'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// neighbourVote.js — neighbourVote-v1, the SCORING step over the text-node lookup's admitted list
// (SPEC-bridgeRevision-091426.md §4, §8; §13 R-BR-3, R-BR-4, R-BR-9 govern). PURE: no I/O, no driver, no
// embedder, no reader, writer or judge. It receives plain records from the orchestrator and returns plain
// records; vectors (through the search memo) and structure (owner, siblings, reference edges) meet only here.
//
//   neighbourSetFor({ subjectStableId, siblingPopulationByStableId, sourceStableIdSet, referenceEdgeList, neighbourVote })
//     → { neighbourSet: { ownerStableId, siblingStableIdList, referencedObjectStableIdList } } | { error }
//   classVotesForHits({ hitList, embedTextIndex, cardSlotIndex })
//     → { namedClassStableIdList } | { error }       the classes ONE neighbour's hits name, each once
//   neighbourSharesFor({ neighbourSet, textRecordListBySourceStableId, searchMemo, cardSlotIndex })
//     → { neighbourShares } | { error }              domain and range shares, counts, trace
//   scoreCandidates({ admittedList, neighbourShares, cardSlotIndex, neighbourVote, k })
//     → { rankedList } | { error }                   score DESC, own share DESC, cardTextCosine DESC, bestCosine DESC, stableId ASC
//   rankCandidatePool({ admittedList, neighbourVote, neighbourInput, searchMemo, cardSlotIndex, k })
//     → { rankedList, neighbourTrace } | { error }   neighbourVote null → the votes-only rank, trace null
//
// WHAT A NEIGHBOUR MAY DO. Reorder, never admit: only cards in the admitted list are scored. Owner and
// siblings land ONLY on a card's DOMAIN class; referenced objects land ONLY on its RANGE class. A hit on a
// class base node names that class; a hit on a property base node names the DOMAIN class of every card on
// that property; a hit on an option-set base node names NOTHING (R-BR-4). A base node on no card names
// nothing either: it is not in any slot. One neighbour names a class at most once, and a card earns at most
// one domain vote and one range vote.
//
// POPULATIONS ARE THE CALLER'S. siblingPopulationByStableId is the subject-label nodes of the FULL source
// population, never a window; sourceStableIdSet is every source node stableId, so an owner that names no
// source node is refused rather than silently scored as having no text.
//
// A NEIGHBOUR WITH NO TEXT RECORDS is lawful, names no class, and STILL COUNTS in its kind's denominator: it
// is a neighbour that said nothing, not a neighbour that is absent. This is a scoring choice, not a spec
// ruling; whether an owner class carries texts depends on the forge's include list (spec §12 item 4).

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const candidateRetrievalLib = require('./candidateRetrieval');

const { compareStrings } = candidateRetrievalLib;
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const hasOwn = (container, propertyName) => Object.prototype.hasOwnProperty.call(container, propertyName);

const NEIGHBOUR_VOTE_METHOD_LIST = Object.freeze(['neighbourVote-v1']);
const NEIGHBOUR_VOTE_FIELD_LIST = Object.freeze(['method', 'owner', 'siblings', 'referencedObject', 'earnRule']);
const TRACE_CLASS_LIMIT = 5;

// OWNER KINDS — a row per kind; a later standard's owner rule is a new row, never a branch
const OWNER_KIND_REGISTRY = Object.freeze({
	propertyValue: Object.freeze({
		fieldList: Object.freeze(['kind', 'property']),
		declarationRefusal: (ownerDeclaration) => (isNonEmptyString(ownerDeclaration.property) ? '' : `owner.property ${JSON.stringify(ownerDeclaration.property)} is not a non-empty string`),
		// → the owner stableId, or undefined when the node does not carry the owner property
		ownerStableIdOf: ({ ownerDeclaration, node }) => (hasOwn(node.properties, ownerDeclaration.property) ? node.properties[ownerDeclaration.property] : undefined),
		ownerDescription: (ownerDeclaration) => `owner property '${ownerDeclaration.property}'`,
	}),
});

const SIBLING_KIND_REGISTRY = Object.freeze({
	sameOwner: Object.freeze({
		fieldList: Object.freeze(['kind']),
		declarationRefusal: () => '',
		siblingStableIdListOf: ({ subjectStableId, ownerStableId, ownerStableIdOfNode, siblingPopulationByStableId }) =>
			Object.keys(siblingPopulationByStableId)
				.filter((oneStableId) => oneStableId !== subjectStableId && ownerStableIdOfNode(siblingPopulationByStableId[oneStableId]) === ownerStableId)
				.sort(compareStrings),
	}),
});

const REFERENCED_OBJECT_KIND_REGISTRY = Object.freeze({
	edgeTarget: Object.freeze({
		fieldList: Object.freeze(['kind', 'edgeTypeList']),
		declarationRefusal: (referencedObjectDeclaration) =>
			Array.isArray(referencedObjectDeclaration.edgeTypeList) && referencedObjectDeclaration.edgeTypeList.length > 0 && referencedObjectDeclaration.edgeTypeList.every(isNonEmptyString)
				? ''
				: `referencedObject.edgeTypeList ${JSON.stringify(referencedObjectDeclaration.edgeTypeList)} is not a non-empty list of edge type names`,
		referencedStableIdListOf: ({ referencedObjectDeclaration, subjectStableId, referenceEdgeList }) =>
			Array.from(new Set(referenceEdgeList.filter((oneEdge) => oneEdge.fromStableId === subjectStableId && referencedObjectDeclaration.edgeTypeList.indexOf(oneEdge.type) !== -1).map((oneEdge) => oneEdge.toStableId))).sort(compareStrings),
	}),
	none: Object.freeze({
		fieldList: Object.freeze(['kind']),
		declarationRefusal: () => '',
		referencedStableIdListOf: () => [],
	}),
});

// EARN RULES (TQ decision 1, ruled topShare) — which classes earn the one vote of a kind, from that kind's shares
const EARN_RULE_REGISTRY = Object.freeze({
	topShare: (shareByClassStableId) => {
		const topShare = Array.from(shareByClassStableId.values()).reduce((soFar, oneShare) => (oneShare > soFar ? oneShare : soFar), 0);
		return new Set(Array.from(shareByClassStableId.keys()).filter((oneClassStableId) => topShare > 0 && shareByClassStableId.get(oneClassStableId) === topShare));
	},
	anyHit: (shareByClassStableId) => new Set(Array.from(shareByClassStableId.keys()).filter((oneClassStableId) => shareByClassStableId.get(oneClassStableId) > 0)),
});

// CLASS NAMING by the kind of base node a neighbour's hit reached (R-BR-4)
const CLASS_NAMING_RULE_BY_BASE_KIND = Object.freeze({
	class: ({ baseStableId }) => [baseStableId],
	// every slot edge of a property base IS a property slot edge: buildCardSlotIndex refuses any other placement
	property: ({ baseStableId, cardSlotIndex }) =>
		cardSlotIndex.slotEdgeListByBaseStableId.get(baseStableId).reduce((soFar, oneSlotEdge) => soFar.concat(cardSlotIndex.baseStableIdListBySlotKindByCardStableId.get(oneSlotEdge.cardStableId).domain), []),
	optionSet: () => [],
});

const kindRowRefusal = ({ declarationPart, partName, registry }) => {
	if (!isPlainObject(declarationPart)) {
		return `neighbourVote.${partName} is not an object`;
	}
	if (!hasOwn(registry, declarationPart.kind)) {
		return `neighbourVote.${partName}.kind ${JSON.stringify(declarationPart.kind)} is none of ${Object.keys(registry).join(', ')}`;
	}
	const kindRow = registry[declarationPart.kind];
	const unknownFieldName = Object.keys(declarationPart).find((oneName) => kindRow.fieldList.indexOf(oneName) === -1);
	if (unknownFieldName !== undefined) {
		return `neighbourVote.${partName} (kind ${declarationPart.kind}) carries '${unknownFieldName}', outside { ${kindRow.fieldList.join(', ')} }`;
	}
	return kindRow.declarationRefusal(declarationPart);
};

// neighbourVoteRefusal — '' when the declared neighbourVote object is usable here, else what is wrong. The
// plugin contract is to refuse these faults at declaration time (B3a, spec §5); this module refuses them
// again because it would otherwise have to guess.
const neighbourVoteRefusal = (neighbourVote) => {
	if (!isPlainObject(neighbourVote)) {
		return `neighbourVote ${JSON.stringify(neighbourVote)} is neither the declared object nor null`;
	}
	const unknownFieldName = Object.keys(neighbourVote).find((oneName) => NEIGHBOUR_VOTE_FIELD_LIST.indexOf(oneName) === -1);
	if (unknownFieldName !== undefined) {
		return `neighbourVote carries '${unknownFieldName}', outside { ${NEIGHBOUR_VOTE_FIELD_LIST.join(', ')} }`;
	}
	const missingFieldName = NEIGHBOUR_VOTE_FIELD_LIST.find((oneName) => !hasOwn(neighbourVote, oneName));
	if (missingFieldName !== undefined) {
		return `neighbourVote lacks '${missingFieldName}'; there is no default`;
	}
	if (NEIGHBOUR_VOTE_METHOD_LIST.indexOf(neighbourVote.method) === -1) {
		return `neighbourVote.method ${JSON.stringify(neighbourVote.method)} is none of ${NEIGHBOUR_VOTE_METHOD_LIST.join(', ')}`;
	}
	if (!hasOwn(EARN_RULE_REGISTRY, neighbourVote.earnRule)) {
		return `neighbourVote.earnRule ${JSON.stringify(neighbourVote.earnRule)} is none of ${Object.keys(EARN_RULE_REGISTRY).join(', ')}`;
	}
	return (
		kindRowRefusal({ declarationPart: neighbourVote.owner, partName: 'owner', registry: OWNER_KIND_REGISTRY }) ||
		kindRowRefusal({ declarationPart: neighbourVote.siblings, partName: 'siblings', registry: SIBLING_KIND_REGISTRY }) ||
		kindRowRefusal({ declarationPart: neighbourVote.referencedObject, partName: 'referencedObject', registry: REFERENCED_OBJECT_KIND_REGISTRY })
	);
};

const neighbourSetFor = ({ subjectStableId, siblingPopulationByStableId, sourceStableIdSet, referenceEdgeList, neighbourVote } = {}) => {
	const declarationRefusal = neighbourVoteRefusal(neighbourVote);
	if (declarationRefusal !== '') {
		return { error: refuse.byName({ moduleName, what: declarationRefusal, where: 'candidateRetrieval.neighbourVote in the plugin declaration (SPEC-bridgeRevision §5)' }) };
	}
	if (!isNonEmptyString(subjectStableId)) {
		return { error: refuse.byName({ moduleName, what: `neighbourSetFor subjectStableId ${JSON.stringify(subjectStableId)} is not a non-empty string`, where: 'one subject per call' }) };
	}
	if (!isPlainObject(siblingPopulationByStableId)) {
		return { error: refuse.byName({ moduleName, what: 'neighbourSetFor needs siblingPopulationByStableId as an object of subject-label nodes', where: 'the FULL source population, never the run window (invariant 5)' }) };
	}
	const malformedStableId = Object.keys(siblingPopulationByStableId).find((oneStableId) => {
		const oneNode = siblingPopulationByStableId[oneStableId];
		return !isPlainObject(oneNode) || oneNode.stableId !== oneStableId || !isPlainObject(oneNode.properties);
	});
	if (malformedStableId !== undefined) {
		return { error: refuse.byName({ moduleName, what: `siblingPopulationByStableId entry '${malformedStableId}' is not a { stableId, properties } node under its own stableId`, where: 'the subject node read' }) };
	}
	if (!(sourceStableIdSet instanceof Set)) {
		return { error: refuse.byName({ moduleName, what: 'neighbourSetFor needs sourceStableIdSet as a Set of every source node stableId', where: 'the owner must name a source node' }) };
	}
	if (!Array.isArray(referenceEdgeList) || referenceEdgeList.some((oneEdge) => !isPlainObject(oneEdge) || !isNonEmptyString(oneEdge.fromStableId) || !isNonEmptyString(oneEdge.toStableId) || !isNonEmptyString(oneEdge.type))) {
		return { error: refuse.byName({ moduleName, what: 'neighbourSetFor needs referenceEdgeList as a list of { fromStableId, toStableId, type }', where: "the evidence view's readEdgesAmongSource" }) };
	}
	const subjectNode = siblingPopulationByStableId[subjectStableId];
	if (subjectNode === undefined) {
		return { error: refuse.byName({ moduleName, what: `subject ${subjectStableId} is not in siblingPopulationByStableId`, where: 'the sibling population is the subject-label nodes, and the subject is one of them' }) };
	}
	const ownerDeclaration = neighbourVote.owner;
	const ownerRow = OWNER_KIND_REGISTRY[ownerDeclaration.kind];
	const ownerStableId = ownerRow.ownerStableIdOf({ ownerDeclaration, node: subjectNode });
	if (ownerStableId === undefined) {
		return { error: refuse.byName({ moduleName, what: `subject ${subjectStableId} lacks its ${ownerRow.ownerDescription(ownerDeclaration)}`, where: 'every subject names an owner under the declared owner rule (SPEC-bridgeRevision §5, refused at run)' }) };
	}
	if (!sourceStableIdSet.has(ownerStableId)) {
		return { error: refuse.byName({ moduleName, what: `subject ${subjectStableId} ${ownerRow.ownerDescription(ownerDeclaration)} ${JSON.stringify(ownerStableId)} names no source node`, where: 'the owner is a node of the source standard (SPEC-bridgeRevision §5, refused at run)' }) };
	}
	const siblingStableIdList = SIBLING_KIND_REGISTRY[neighbourVote.siblings.kind].siblingStableIdListOf({
		subjectStableId,
		ownerStableId,
		ownerStableIdOfNode: (oneNode) => ownerRow.ownerStableIdOf({ ownerDeclaration, node: oneNode }),
		siblingPopulationByStableId,
	});
	const referencedObjectStableIdList = REFERENCED_OBJECT_KIND_REGISTRY[neighbourVote.referencedObject.kind].referencedStableIdListOf({ referencedObjectDeclaration: neighbourVote.referencedObject, subjectStableId, referenceEdgeList });
	return { neighbourSet: Object.freeze({ ownerStableId, siblingStableIdList: Object.freeze(siblingStableIdList), referencedObjectStableIdList: Object.freeze(referencedObjectStableIdList) }) };
};

const classVotesForHits = ({ hitList, embedTextIndex, cardSlotIndex } = {}) => {
	if (!Array.isArray(hitList) || !isPlainObject(embedTextIndex) || !(embedTextIndex.baseStableIdListByTextStableId instanceof Map) || !candidateRetrievalLib.isCardSlotIndex(cardSlotIndex)) {
		return { error: refuse.byName({ moduleName, what: 'classVotesForHits needs { hitList, embedTextIndex, cardSlotIndex }', where: 'the search memo and the card slot index of this run' }) };
	}
	const namedClassStableIdSet = new Set();
	for (let hitIndex = 0; hitIndex < hitList.length; hitIndex++) {
		const baseStableIdList = isPlainObject(hitList[hitIndex]) ? embedTextIndex.baseStableIdListByTextStableId.get(hitList[hitIndex].hitTextStableId) : undefined;
		if (baseStableIdList === undefined) {
			return { error: refuse.byName({ moduleName, what: `hitList[${hitIndex}] names no text node of the index: ${JSON.stringify(hitList[hitIndex])}`, where: 'a hit comes from a search over THIS index' }) };
		}
		baseStableIdList.forEach((oneBaseStableId) => {
			const baseKind = cardSlotIndex.baseKindByStableId.get(oneBaseStableId);
			if (baseKind === undefined) {
				return;
			}
			CLASS_NAMING_RULE_BY_BASE_KIND[baseKind]({ baseStableId: oneBaseStableId, cardSlotIndex }).forEach((oneClassStableId) => namedClassStableIdSet.add(oneClassStableId));
		});
	}
	return { namedClassStableIdList: Object.freeze(Array.from(namedClassStableIdSet).sort(compareStrings)) };
};

// namedClassListFor — every text of ONE neighbour searched (through the memo), their hits pooled, and the
// classes those hits name
const namedClassListFor = ({ neighbourStableId, textRecordListBySourceStableId, searchMemo, cardSlotIndex }) => {
	const textRecordList = textRecordListBySourceStableId.has(neighbourStableId) ? textRecordListBySourceStableId.get(neighbourStableId) : [];
	if (!Array.isArray(textRecordList)) {
		return { error: refuse.byName({ moduleName, what: `the text records of neighbour ${neighbourStableId} are not a list`, where: 'textRecordListBySourceStableId' }) };
	}
	let pooledHitList = [];
	for (let recordIndex = 0; recordIndex < textRecordList.length; recordIndex++) {
		const oneRecord = textRecordList[recordIndex];
		const shapeRefusal = candidateRetrievalLib.embedTextRecordRefusal({ textRecord: oneRecord, recordLabel: `neighbour ${neighbourStableId} text record ${recordIndex}` });
		if (shapeRefusal !== '') {
			return { error: refuse.byName({ moduleName, what: shapeRefusal, where: 'textRecordListBySourceStableId' }) };
		}
		if (oneRecord.sourceStableId !== neighbourStableId) {
			return { error: refuse.byName({ moduleName, what: `text record ${oneRecord.textStableId} is filed under neighbour ${neighbourStableId} but describes ${oneRecord.sourceStableId}`, where: 'textRecordListBySourceStableId is keyed by the described node' }) };
		}
		const searched = candidateRetrievalLib.searchEmbedText({ searchMemo, textRecord: oneRecord });
		if (searched.error) {
			return searched;
		}
		pooledHitList = pooledHitList.concat(searched.hitList);
	}
	return classVotesForHits({ hitList: pooledHitList, embedTextIndex: searchMemo.embedTextIndex, cardSlotIndex });
};

// sharesOf — neighbours naming each class ÷ the neighbour count of that kind; no neighbours → no shares
const sharesOf = ({ neighbourStableIdList, namedClassStableIdListByNeighbourStableId }) => {
	const namingCountByClassStableId = new Map();
	neighbourStableIdList.forEach((oneNeighbourStableId) => {
		namedClassStableIdListByNeighbourStableId.get(oneNeighbourStableId).forEach((oneClassStableId) => {
			namingCountByClassStableId.set(oneClassStableId, (namingCountByClassStableId.has(oneClassStableId) ? namingCountByClassStableId.get(oneClassStableId) : 0) + 1);
		});
	});
	const shareByClassStableId = new Map();
	Array.from(namingCountByClassStableId.keys())
		.sort(compareStrings)
		.forEach((oneClassStableId) => shareByClassStableId.set(oneClassStableId, namingCountByClassStableId.get(oneClassStableId) / neighbourStableIdList.length));
	return { namingCountByClassStableId, shareByClassStableId };
};

const topClassListOf = (shareByClassStableId) =>
	Object.freeze(
		Array.from(shareByClassStableId.keys())
			.sort((leftClassStableId, rightClassStableId) => (shareByClassStableId.get(rightClassStableId) - shareByClassStableId.get(leftClassStableId)) || compareStrings(leftClassStableId, rightClassStableId))
			.slice(0, TRACE_CLASS_LIMIT)
			.map((oneClassStableId) => Object.freeze({ classStableId: oneClassStableId, share: shareByClassStableId.get(oneClassStableId) })),
	);

const neighbourSharesFor = ({ neighbourSet, textRecordListBySourceStableId, searchMemo, cardSlotIndex } = {}) => {
	if (!isPlainObject(neighbourSet) || !isNonEmptyString(neighbourSet.ownerStableId) || !Array.isArray(neighbourSet.siblingStableIdList) || !Array.isArray(neighbourSet.referencedObjectStableIdList)) {
		return { error: refuse.byName({ moduleName, what: 'neighbourSharesFor needs a neighbourSet from neighbourSetFor', where: 'neighbours are resolved before they are searched' }) };
	}
	if (!(textRecordListBySourceStableId instanceof Map)) {
		return { error: refuse.byName({ moduleName, what: 'neighbourSharesFor needs textRecordListBySourceStableId as a Map', where: "the source standard's text records, keyed by the node they describe" }) };
	}
	if (!candidateRetrievalLib.isSearchMemo(searchMemo) || !candidateRetrievalLib.isCardSlotIndex(cardSlotIndex)) {
		return { error: refuse.byName({ moduleName, what: 'neighbourSharesFor needs the run\'s searchMemo and cardSlotIndex', where: 'built once per run in candidateRetrieval.js' }) };
	}
	const domainNeighbourStableIdList = [neighbourSet.ownerStableId].concat(neighbourSet.siblingStableIdList);
	const rangeNeighbourStableIdList = neighbourSet.referencedObjectStableIdList.slice();
	const namedClassStableIdListByNeighbourStableId = new Map();
	const everyNeighbourStableIdList = Array.from(new Set(domainNeighbourStableIdList.concat(rangeNeighbourStableIdList))).sort(compareStrings);
	for (let neighbourIndex = 0; neighbourIndex < everyNeighbourStableIdList.length; neighbourIndex++) {
		const neighbourStableId = everyNeighbourStableIdList[neighbourIndex];
		const named = namedClassListFor({ neighbourStableId, textRecordListBySourceStableId, searchMemo, cardSlotIndex });
		if (named.error) {
			return named;
		}
		namedClassStableIdListByNeighbourStableId.set(neighbourStableId, named.namedClassStableIdList);
	}
	const domain = sharesOf({ neighbourStableIdList: domainNeighbourStableIdList, namedClassStableIdListByNeighbourStableId });
	const range = sharesOf({ neighbourStableIdList: rangeNeighbourStableIdList, namedClassStableIdListByNeighbourStableId });
	return {
		neighbourShares: Object.freeze({
			domainShareByClassStableId: domain.shareByClassStableId,
			rangeShareByClassStableId: range.shareByClassStableId,
			domainNamingCountByClassStableId: domain.namingCountByClassStableId,
			rangeNamingCountByClassStableId: range.namingCountByClassStableId,
			namedClassStableIdListByNeighbourStableId,
			neighbourTrace: Object.freeze({
				ownerStableId: neighbourSet.ownerStableId,
				siblingCount: neighbourSet.siblingStableIdList.length,
				referencedObjectCount: neighbourSet.referencedObjectStableIdList.length,
				topDomainClassList: topClassListOf(domain.shareByClassStableId),
				topRangeClassList: topClassListOf(range.shareByClassStableId),
				// R-BR-16: every neighbour → the sorted classes it named, keys in stableId ORDER; a plain object, so the
				// frozen record keeps it (a Map would serialise as {})
				namedClassStableIdListByNeighbourStableId: Object.freeze(everyNeighbourStableIdList.reduce((soFar, oneNeighbourStableId) => ({ ...soFar, [oneNeighbourStableId]: namedClassStableIdListByNeighbourStableId.get(oneNeighbourStableId) }), {})),
			}),
		}),
	};
};

const shareOf = (shareByClassStableId, classStableId) => (shareByClassStableId.has(classStableId) ? shareByClassStableId.get(classStableId) : 0);

const scoreCandidates = ({ admittedList, neighbourShares, cardSlotIndex, neighbourVote, k } = {}) => {
	const listRefusal = candidateRetrievalLib.rankableListRefusal({ admittedList, callerName: 'scoreCandidates' });
	if (listRefusal !== '') {
		return { error: refuse.byName({ moduleName, what: listRefusal, where: 'only the lookup\'s admitted cards are scored' }) };
	}
	const declarationRefusal = neighbourVoteRefusal(neighbourVote);
	if (declarationRefusal !== '') {
		return { error: refuse.byName({ moduleName, what: declarationRefusal, where: 'scoreCandidates runs only under a declared neighbourVote' }) };
	}
	if (!isPlainObject(neighbourShares) || !(neighbourShares.domainShareByClassStableId instanceof Map) || !(neighbourShares.rangeShareByClassStableId instanceof Map) || !candidateRetrievalLib.isCardSlotIndex(cardSlotIndex)) {
		return { error: refuse.byName({ moduleName, what: 'scoreCandidates needs neighbourShares from neighbourSharesFor and the run\'s cardSlotIndex', where: 'shares are computed before scoring' }) };
	}
	if (!Number.isInteger(k) || k < 1) {
		return { error: refuse.byName({ moduleName, what: `scoreCandidates k ${JSON.stringify(k)} is not a positive integer`, where: 'K is declared data (candidateRetrieval.k); there is no default' }) };
	}
	const earnRule = EARN_RULE_REGISTRY[neighbourVote.earnRule];
	const earnedDomainClassSet = earnRule(neighbourShares.domainShareByClassStableId);
	const earnedRangeClassSet = earnRule(neighbourShares.rangeShareByClassStableId);
	const scoringCandidateList = admittedList.slice();
	const scoredList = [];
	for (let candidateIndex = 0; candidateIndex < scoringCandidateList.length; candidateIndex++) {
		const oneCandidate = scoringCandidateList[candidateIndex];
		const cardSlot = cardSlotIndex.baseStableIdListBySlotKindByCardStableId.get(oneCandidate.stableId);
		const domainList = cardSlot === undefined ? [] : cardSlot.domain;
		const rangeList = cardSlot === undefined ? [] : cardSlot.range;
		if (domainList.length !== 1) {
			return { error: refuse.byName({ moduleName, what: `candidate card ${oneCandidate.stableId} carries ${domainList.length} DOMAIN slot edges`, where: 'every scored card has exactly one DOMAIN slot edge (SPEC-bridgeRevision §5, refused at run)' }) };
		}
		if (rangeList.length > 1) {
			return { error: refuse.byName({ moduleName, what: `candidate card ${oneCandidate.stableId} carries ${rangeList.length} RANGE slot edges`, where: 'a card has at most one RANGE slot edge' }) };
		}
		const domainLandingStableId = domainList[0];
		const rangeLandingStableId = rangeList.length === 1 ? rangeList[0] : null;
		const domainShare = shareOf(neighbourShares.domainShareByClassStableId, domainLandingStableId);
		const rangeShare = shareOf(neighbourShares.rangeShareByClassStableId, rangeLandingStableId);
		const domainVote = earnedDomainClassSet.has(domainLandingStableId) ? 1 : 0;
		const rangeVote = earnedRangeClassSet.has(rangeLandingStableId) ? 1 : 0;
		scoredList.push(
			Object.freeze({
				stableId: oneCandidate.stableId,
				ownVotes: oneCandidate.ownVotes,
				domainVote,
				rangeVote,
				domainShare,
				rangeShare,
				score: oneCandidate.ownVotes + domainVote + rangeVote,
				bestCosine: oneCandidate.bestCosine,
				cardTextCosine: oneCandidate.cardTextCosine,
				cardTextWinningTextStableId: oneCandidate.cardTextWinningTextStableId,
				pathList: oneCandidate.pathList,
			}),
		);
	}
	const rankedList = scoredList
		.sort((leftScored, rightScored) => (rightScored.score - leftScored.score) || ((rightScored.domainShare + rightScored.rangeShare) - (leftScored.domainShare + leftScored.rangeShare)) || (rightScored.cardTextCosine - leftScored.cardTextCosine) || (rightScored.bestCosine - leftScored.bestCosine) || compareStrings(leftScored.stableId, rightScored.stableId))
		.slice(0, k);
	return { rankedList: Object.freeze(rankedList) };
};

const NEIGHBOUR_INPUT_FIELD_LIST = Object.freeze(['subjectStableId', 'siblingPopulationByStableId', 'sourceStableIdSet', 'referenceEdgeList', 'textRecordListBySourceStableId']);

// rankCandidatePool — ONE subject from admitted list to ranked pool. With neighbourVote null the neighbour
// inputs are not read and the result is the votes-only rank, so a null declaration cannot drift from it
// (invariant 7).
const rankCandidatePool = ({ admittedList, neighbourVote, neighbourInput, searchMemo, cardSlotIndex, k } = {}) => {
	if (neighbourVote === undefined) {
		return { error: refuse.byName({ moduleName, what: 'rankCandidatePool needs neighbourVote: the declared object, or null for the votes-only rank', where: 'candidateRetrieval.neighbourVote; there is no default' }) };
	}
	if (neighbourVote === null) {
		const votesOnly = candidateRetrievalLib.rankVotedCandidates({ admittedList, k });
		return votesOnly.error ? votesOnly : { rankedList: votesOnly.rankedList, neighbourTrace: null };
	}
	if (!isPlainObject(neighbourInput) || NEIGHBOUR_INPUT_FIELD_LIST.some((oneName) => !hasOwn(neighbourInput, oneName))) {
		return { error: refuse.byName({ moduleName, what: `rankCandidatePool needs neighbourInput { ${NEIGHBOUR_INPUT_FIELD_LIST.join(', ')} }`, where: 'the orchestrator reads these once per run' }) };
	}
	const resolved = neighbourSetFor({ subjectStableId: neighbourInput.subjectStableId, siblingPopulationByStableId: neighbourInput.siblingPopulationByStableId, sourceStableIdSet: neighbourInput.sourceStableIdSet, referenceEdgeList: neighbourInput.referenceEdgeList, neighbourVote });
	if (resolved.error) {
		return resolved;
	}
	const shared = neighbourSharesFor({ neighbourSet: resolved.neighbourSet, textRecordListBySourceStableId: neighbourInput.textRecordListBySourceStableId, searchMemo, cardSlotIndex });
	if (shared.error) {
		return shared;
	}
	const scored = scoreCandidates({ admittedList, neighbourShares: shared.neighbourShares, cardSlotIndex, neighbourVote, k });
	if (scored.error) {
		return scored;
	}
	return { rankedList: scored.rankedList, neighbourTrace: shared.neighbourShares.neighbourTrace };
};

module.exports = {
	neighbourSetFor,
	classVotesForHits,
	neighbourSharesFor,
	scoreCandidates,
	rankCandidatePool,
	neighbourVoteRefusal,
	OWNER_KIND_REGISTRY,
	SIBLING_KIND_REGISTRY,
	REFERENCED_OBJECT_KIND_REGISTRY,
	EARN_RULE_REGISTRY,
	moduleName,
};
