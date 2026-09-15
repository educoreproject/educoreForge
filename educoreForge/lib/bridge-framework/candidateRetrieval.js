'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// candidateRetrieval.js — the semantic candidate pool for a RETRIEVED basis (SPEC-bridgeFramework-v1.md §5.4
// as amended; RULINGS §11.3, §11.4). PURE: no I/O, no driver, no network, and — this is the point of the
// module — NO EMBEDDER. It reads vectors that are already stored on the graph and never makes one. BG-CONTAIN
// stands: nothing here requires lib/embedding or lib/vector-store, and a subject or card whose vector is
// absent, wrong-dimensioned, wrong-model or degenerate is REFUSED BY NAME rather than skipped or re-embedded.
//
//   buildHubVectorIndex({ vectorRecordList, embeddingModelVersion })
//     → { hubVectorIndex } | { error }        ONE flattening of the hub side into a typed-array matrix
//   retrieveCandidatePool({ hubVectorIndex, subjectStableId, subjectVector, k, floor })
//     → { seatList } | { error }              seatList = [{ stableId, rank, cosine }], rank 1-based
//
// ORDER AND TIES. Selection ranks by cosine DESCENDING and breaks ties by stableId ASCENDING, so the selected
// SET is a deterministic function of (vectors, k, floor) and nothing else — no read order, no insertion order.
// The RANK and the COSINE ride in the seat as forensics only; the framework sorts the pool by stableId before
// rendering (classification.sortByStableId), so retrieval order never reaches the judge and never reaches the
// frozen text. That is the whole reason the pool is neutral: it is independent of retrieval rank, not merely
// hashed (D0 review §D4).
//
// COSINE, not dot product. The stored vectors are L2-normalised in practice (measured 1.0000000 on both
// labels), which makes the two identical — but a normalisation that is TRUE TODAY is not a contract, and a
// silently-unnormalised vector would quietly distort every pool rather than fail. The norm is computed and a
// zero-norm vector refuses by name.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const compareStrings = (leftValue, rightValue) => (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);

// vectorRefusal — the ONE place a stored vector is judged fit to compare. Every caller uses it, so the hub
// side and the subject side can never drift into different standards of fitness.
const vectorRefusal = ({ vector, stableId, expectedDimension }) => {
	if (!Array.isArray(vector) || vector.length === 0) {
		return `${stableId} carries no embedding array (got ${vector === undefined ? 'undefined' : typeof vector}); a vectorless element is refused, never re-embedded (BR-123)`;
	}
	if (expectedDimension !== null && vector.length !== expectedDimension) {
		return `${stableId} carries a ${vector.length}-dimensional embedding where the index is ${expectedDimension}-dimensional; vectors of two shapes are never compared`;
	}
	const nonFinite = vector.findIndex((oneValue) => typeof oneValue !== 'number' || !Number.isFinite(oneValue));
	if (nonFinite !== -1) {
		return `${stableId} embedding[${nonFinite}] is ${JSON.stringify(vector[nonFinite])}, not a finite number`;
	}
	return '';
};

const normOf = (vector) => {
	let sumOfSquares = 0;
	for (let oneIndex = 0; oneIndex < vector.length; oneIndex++) {
		sumOfSquares += vector[oneIndex] * vector[oneIndex];
	}
	return Math.sqrt(sumOfSquares);
};

// buildHubVectorIndex — flattens { stableId, embedding, embeddingModelVersion } records into one Float64Array
// matrix plus a parallel stableId list and a parallel norm list. Every record must carry the DECLARED model:
// a card embedded by another model is refused by name, because a cosine across two models is a number with no
// meaning rather than a bad score.
const buildHubVectorIndex = ({ vectorRecordList, embeddingModelVersion } = {}) => {
	if (!Array.isArray(vectorRecordList) || vectorRecordList.length === 0) {
		return { error: refuse.byName({ moduleName, what: 'buildHubVectorIndex needs a non-empty vectorRecordList', where: 'an empty candidate space is never a retrieval run (BG-EMPTY)' }) };
	}
	if (!isNonEmptyString(embeddingModelVersion)) {
		return { error: refuse.byName({ moduleName, what: 'buildHubVectorIndex needs the declared embeddingModelVersion', where: 'candidateRetrieval.embeddingModelVersion in the plugin declaration; there is no default' }) };
	}
	const dimension = Array.isArray(vectorRecordList[0].embedding) ? vectorRecordList[0].embedding.length : 0;
	if (dimension === 0) {
		return { error: refuse.byName({ moduleName, what: `the first vector record (${vectorRecordList[0].stableId}) carries no embedding array`, where: 'the index dimension is MEASURED from the records, never declared' }) };
	}
	const recordCount = vectorRecordList.length;
	const matrix = new Float64Array(recordCount * dimension);
	const stableIdList = new Array(recordCount);
	const normList = new Float64Array(recordCount);
	for (let recordIndex = 0; recordIndex < recordCount; recordIndex++) {
		const oneRecord = vectorRecordList[recordIndex];
		if (!isPlainObject(oneRecord) || !isNonEmptyString(oneRecord.stableId)) {
			return { error: refuse.byName({ moduleName, what: `vectorRecordList[${recordIndex}] is not { stableId, embedding, embeddingModelVersion }`, where: 'the purpose-scoped forRetrieval() view returns exactly that shape' }) };
		}
		if (oneRecord.embeddingModelVersion !== embeddingModelVersion) {
			return { error: refuse.byName({ moduleName, what: `${oneRecord.stableId} is embedded by '${oneRecord.embeddingModelVersion}' but the declaration names '${embeddingModelVersion}'`, where: 'a cosine between two models is meaningless, not merely inaccurate; re-declare or re-forge, never compare' }) };
		}
		const oneRefusal = vectorRefusal({ vector: oneRecord.embedding, stableId: oneRecord.stableId, expectedDimension: dimension });
		if (oneRefusal !== '') {
			return { error: refuse.byName({ moduleName, what: oneRefusal, where: 'every candidate in the space carries a comparable vector or the run refuses' }) };
		}
		const oneNorm = normOf(oneRecord.embedding);
		if (oneNorm === 0) {
			return { error: refuse.byName({ moduleName, what: `${oneRecord.stableId} carries a ZERO-norm embedding`, where: 'a zero vector has no direction; its cosine with anything is undefined' }) };
		}
		stableIdList[recordIndex] = oneRecord.stableId;
		normList[recordIndex] = oneNorm;
		matrix.set(oneRecord.embedding, recordIndex * dimension);
	}
	const duplicate = stableIdList.slice().sort(compareStrings).find((oneId, oneIndex, sortedList) => oneIndex > 0 && sortedList[oneIndex - 1] === oneId);
	if (duplicate !== undefined) {
		return { error: refuse.byName({ moduleName, what: `the vector space names '${duplicate}' twice`, where: 'a stableId identifies ONE card; a duplicate would let one card hold two seats in a pool' }) };
	}
	return {
		hubVectorIndex: Object.freeze({
			matrix,
			normList,
			stableIdList: Object.freeze(stableIdList),
			dimension,
			recordCount,
			embeddingModelVersion,
		}),
	};
};

// retrieveCandidatePool — the top-K by cosine at or above the floor. An EMPTY result is a lawful outcome
// (the subject has no candidate above the floor) and is returned as an empty seatList, NOT an error: the
// caller classifies it as an orphan carrying reason 'noCandidate' and never calls the renderer on it.
const retrieveCandidatePool = ({ hubVectorIndex, subjectStableId, subjectVector, k, floor } = {}) => {
	if (!isPlainObject(hubVectorIndex) || !(hubVectorIndex.matrix instanceof Float64Array)) {
		return { error: refuse.byName({ moduleName, what: 'retrieveCandidatePool needs a hubVectorIndex from buildHubVectorIndex', where: 'the index is built ONCE per run and reused for every subject' }) };
	}
	if (!Number.isInteger(k) || k < 1) {
		return { error: refuse.byName({ moduleName, what: `retrieveCandidatePool k ${JSON.stringify(k)} is not a positive integer`, where: 'K is declared data (candidateRetrieval.k); there is no default' }) };
	}
	if (typeof floor !== 'number' || !Number.isFinite(floor)) {
		return { error: refuse.byName({ moduleName, what: `retrieveCandidatePool floor ${JSON.stringify(floor)} is not a finite number`, where: 'the floor is declared data (candidateRetrieval.floor); there is no default' }) };
	}
	const subjectRefusal = vectorRefusal({ vector: subjectVector, stableId: String(subjectStableId), expectedDimension: hubVectorIndex.dimension });
	if (subjectRefusal !== '') {
		return { error: refuse.byName({ moduleName, what: subjectRefusal, where: 'the subject side of a retrieval must be comparable to the index' }) };
	}
	const subjectNorm = normOf(subjectVector);
	if (subjectNorm === 0) {
		return { error: refuse.byName({ moduleName, what: `subject ${subjectStableId} carries a ZERO-norm embedding`, where: 'a zero vector has no direction; its cosine with anything is undefined' }) };
	}
	const { matrix, normList, stableIdList, dimension, recordCount } = hubVectorIndex;
	const scoredList = new Array(recordCount);
	for (let recordIndex = 0; recordIndex < recordCount; recordIndex++) {
		const base = recordIndex * dimension;
		let dotProduct = 0;
		for (let oneIndex = 0; oneIndex < dimension; oneIndex++) {
			dotProduct += matrix[base + oneIndex] * subjectVector[oneIndex];
		}
		scoredList[recordIndex] = { stableId: stableIdList[recordIndex], cosine: dotProduct / (normList[recordIndex] * subjectNorm) };
	}
	// cosine DESC, then stableId ASC — the tie-break is declared, deterministic, and feeds the frozen text
	scoredList.sort((leftEntry, rightEntry) => (rightEntry.cosine - leftEntry.cosine) || compareStrings(leftEntry.stableId, rightEntry.stableId));
	const seatList = [];
	for (let rankIndex = 0; rankIndex < scoredList.length && seatList.length < k; rankIndex++) {
		if (scoredList[rankIndex].cosine < floor) {
			break;
		}
		seatList.push(Object.freeze({ stableId: scoredList[rankIndex].stableId, rank: rankIndex + 1, cosine: scoredList[rankIndex].cosine }));
	}
	return { seatList };
};

// =========================================================================================================
// embedTextVote-v1 — the TEXT-NODE LOOKUP (SPEC-embedTextSearch-091426.md §4 steps 1-7, read through
// SPEC-bridgeRevision-091426.md §13: R-BR-1/1a record shape, R-BR-3 vote unit, R-BR-9 roles and slots).
// Same purity as the half above: vectors already on the graph, no embedder, refusal by name.
//
//   buildEmbedTextIndex({ textRecordList, embeddingModelVersion })
//     → { embedTextIndex } | { error }       the hub's text nodes flattened ONCE per run
//   makeSearchMemo({ embedTextIndex, hitsPerText, minScore })
//     → { searchMemo } | { error }           caller-owned; each distinct text node is searched once per run
//   searchEmbedTextDirect({ embedTextIndex, textRecord, hitsPerText, minScore })
//     → { hitList } | { error }              hitList = [{ hitTextStableId, cosine }], cosine DESC, textStableId ASC
//   searchEmbedText({ searchMemo, textRecord })
//     → { hitList } | { error }              the memoised form; equal to the direct form by gate (BG-NV f)
//   buildCardSlotIndex({ cardSlotEdgeList, slotNameBySlotKind, baseRoleByBaseKind })
//     → { cardSlotIndex } | { error }        card ↔ base node, by slot kind and base kind
//   voteCandidatePool({ searchMemo, cardSlotIndex, subjectStableId, subjectTextRecordList })
//     → { admittedList } | { error }         admittedList = [{ stableId, ownVotes, bestCosine, pathList }], by stableId
//   rankVotedCandidates({ admittedList, k })
//     → { rankedList } | { error }           ownVotes DESC, bestCosine DESC, stableId ASC; first k
//
// RECORD SHAPES ARE CLOSED. A text record is { textStableId, vector, embeddingModelVersion, sourceStableId,
// propertyNameList }, one per (text node, described node). A card slot edge is { cardStableId, slot,
// baseStableId, baseRole }. `slot` and `baseRole` are the caller's own names (an edge type made by
// hubEdgeType, a role constant), mapped here onto the logical kinds below. That mapping is why this file
// holds no hub or standard name. baseRole is carried because a RANGE slot may point at a class OR an
// option set, and the two are scored differently (R-BR-4).
//
// VOTE UNIT (R-BR-3). One vote per (subject text NODE, card). A text node serving two properties of the
// subject is one vote; its propertyNameList rides on every path. A card is ADMITTED only if some path
// reached it through the PROPERTY slot; class and option-set paths add votes to an admitted card and never
// admit one.

const EMBED_TEXT_RECORD_FIELD_LIST = Object.freeze(['textStableId', 'vector', 'embeddingModelVersion', 'sourceStableId', 'propertyNameList']);
const CARD_SLOT_EDGE_FIELD_LIST = Object.freeze(['cardStableId', 'slot', 'baseStableId', 'baseRole']);
const SLOT_KIND_LIST = Object.freeze(['property', 'domain', 'range']);
const BASE_KIND_LIST = Object.freeze(['class', 'property', 'optionSet']);
// which base kinds each slot may point at; an edge outside this table is a reader or hub fault
const BASE_KIND_LIST_BY_SLOT_KIND = Object.freeze({
	property: Object.freeze(['property']),
	domain: Object.freeze(['class']),
	range: Object.freeze(['class', 'optionSet']),
});
const ADMITTING_SLOT_KIND_LIST = Object.freeze(['property']);

const hasOwn = (container, propertyName) => Object.prototype.hasOwnProperty.call(container, propertyName);

const sameVector = (leftVector, rightVector) =>
	Array.isArray(leftVector) && Array.isArray(rightVector) && leftVector.length === rightVector.length && leftVector.every((oneValue, oneIndex) => oneValue === rightVector[oneIndex]);

// embedTextRecordRefusal — '' when the record is the closed text record shape, else what is wrong with it
const embedTextRecordRefusal = ({ textRecord, recordLabel }) => {
	if (!isPlainObject(textRecord)) {
		return `${recordLabel} is not a text record object`;
	}
	const unknownFieldName = Object.keys(textRecord).find((oneName) => EMBED_TEXT_RECORD_FIELD_LIST.indexOf(oneName) === -1);
	if (unknownFieldName !== undefined) {
		return `${recordLabel} carries '${unknownFieldName}', outside the closed text record shape { ${EMBED_TEXT_RECORD_FIELD_LIST.join(', ')} }`;
	}
	const missingFieldName = EMBED_TEXT_RECORD_FIELD_LIST.find((oneName) => !hasOwn(textRecord, oneName));
	if (missingFieldName !== undefined) {
		return `${recordLabel} lacks '${missingFieldName}'`;
	}
	if (!isNonEmptyString(textRecord.textStableId) || !isNonEmptyString(textRecord.sourceStableId) || !isNonEmptyString(textRecord.embeddingModelVersion)) {
		return `${recordLabel} textStableId, sourceStableId and embeddingModelVersion must each be a non-empty string`;
	}
	const propertyNameList = Array.isArray(textRecord.propertyNameList) ? textRecord.propertyNameList : null;
	if (propertyNameList === null) {
		return `${textRecord.textStableId} propertyNameList is ${JSON.stringify(textRecord.propertyNameList)}, not an array; the reader re-widens a scalar to a one-element list at its read boundary (R-BR-1a), so a scalar here is a reader fault`;
	}
	if (propertyNameList.length === 0 || !propertyNameList.every(isNonEmptyString)) {
		return `${textRecord.textStableId} propertyNameList ${JSON.stringify(propertyNameList)} must name at least one property, each a non-empty string`;
	}
	return '';
};

// buildEmbedTextIndex — the hub's text records, one per (text node, base node), flattened into one matrix
// over DISTINCT text nodes (first-seen order) plus the base nodes each text describes. A text node carries
// one vector: the same textStableId with two vectors, or the same (text, base) pair twice, is refused.
const buildEmbedTextIndex = ({ textRecordList, embeddingModelVersion } = {}) => {
	if (!Array.isArray(textRecordList) || textRecordList.length === 0) {
		return { error: refuse.byName({ moduleName, what: 'buildEmbedTextIndex needs a non-empty textRecordList', where: "the hub's text records; an empty search population is never a lookup run" }) };
	}
	if (!isNonEmptyString(embeddingModelVersion)) {
		return { error: refuse.byName({ moduleName, what: 'buildEmbedTextIndex needs the declared embeddingModelVersion', where: 'candidateRetrieval.embeddingModelVersion in the plugin declaration; there is no default' }) };
	}
	const firstVector = isPlainObject(textRecordList[0]) ? textRecordList[0].vector : undefined;
	const dimension = Array.isArray(firstVector) ? firstVector.length : 0;
	if (dimension === 0) {
		return { error: refuse.byName({ moduleName, what: 'the first text record carries no vector array', where: 'the index dimension is MEASURED from the records, never declared' }) };
	}
	const vectorByTextStableId = new Map();
	const baseStableIdSetByTextStableId = new Map();
	for (let recordIndex = 0; recordIndex < textRecordList.length; recordIndex++) {
		const oneRecord = textRecordList[recordIndex];
		const shapeRefusal = embedTextRecordRefusal({ textRecord: oneRecord, recordLabel: `textRecordList[${recordIndex}]` });
		if (shapeRefusal !== '') {
			return { error: refuse.byName({ moduleName, what: shapeRefusal, where: "the retrieval view's embed-text read returns exactly that shape" }) };
		}
		if (oneRecord.embeddingModelVersion !== embeddingModelVersion) {
			return { error: refuse.byName({ moduleName, what: `${oneRecord.textStableId} is embedded by '${oneRecord.embeddingModelVersion}' but the declaration names '${embeddingModelVersion}'`, where: 'a cosine between two models is meaningless; re-declare or re-forge, never compare' }) };
		}
		const oneVectorRefusal = vectorRefusal({ vector: oneRecord.vector, stableId: oneRecord.textStableId, expectedDimension: dimension });
		if (oneVectorRefusal !== '') {
			return { error: refuse.byName({ moduleName, what: oneVectorRefusal, where: 'every text node in the search population carries a comparable vector or the run refuses' }) };
		}
		if (normOf(oneRecord.vector) === 0) {
			return { error: refuse.byName({ moduleName, what: `${oneRecord.textStableId} carries a ZERO-norm vector`, where: 'a zero vector has no direction; its cosine with anything is undefined' }) };
		}
		const priorVector = vectorByTextStableId.get(oneRecord.textStableId);
		if (priorVector === undefined) {
			vectorByTextStableId.set(oneRecord.textStableId, oneRecord.vector);
			baseStableIdSetByTextStableId.set(oneRecord.textStableId, new Set());
		} else if (!sameVector(priorVector, oneRecord.vector)) {
			return { error: refuse.byName({ moduleName, what: `text node ${oneRecord.textStableId} arrives with two different vectors`, where: 'a text node is content-addressed and carries ONE vector' }) };
		}
		const baseStableIdSet = baseStableIdSetByTextStableId.get(oneRecord.textStableId);
		if (baseStableIdSet.has(oneRecord.sourceStableId)) {
			return { error: refuse.byName({ moduleName, what: `the pair (${oneRecord.textStableId}, ${oneRecord.sourceStableId}) arrives twice`, where: 'the forge emits ONE text edge per distinct (text node, described node) pair (R-BR-1)' }) };
		}
		baseStableIdSet.add(oneRecord.sourceStableId);
	}
	const textStableIdList = Array.from(vectorByTextStableId.keys());
	const textCount = textStableIdList.length;
	const matrix = new Float64Array(textCount * dimension);
	const normList = new Float64Array(textCount);
	const baseStableIdListByTextStableId = new Map();
	textStableIdList.forEach((oneTextStableId, textIndex) => {
		const oneVector = vectorByTextStableId.get(oneTextStableId);
		matrix.set(oneVector, textIndex * dimension);
		normList[textIndex] = normOf(oneVector);
		baseStableIdListByTextStableId.set(oneTextStableId, Object.freeze(Array.from(baseStableIdSetByTextStableId.get(oneTextStableId)).sort(compareStrings)));
	});
	return {
		embedTextIndex: Object.freeze({ matrix, normList, textStableIdList: Object.freeze(textStableIdList), baseStableIdListByTextStableId, dimension, textCount, embeddingModelVersion }),
	};
};

const searchSettingsRefusal = ({ hitsPerText, minScore }) => {
	if (!Number.isInteger(hitsPerText) || hitsPerText < 1) {
		return `hitsPerText ${JSON.stringify(hitsPerText)} is not a positive integer; it is declared data (candidateRetrieval.hitsPerText), there is no default`;
	}
	if (typeof minScore !== 'number' || !Number.isFinite(minScore) || minScore < -1 || minScore > 1) {
		return `minScore ${JSON.stringify(minScore)} is not a cosine in [-1, 1]; it is declared data (candidateRetrieval.minScore), there is no default`;
	}
	return '';
};

const isEmbedTextIndex = (candidate) => isPlainObject(candidate) && candidate.matrix instanceof Float64Array && candidate.baseStableIdListByTextStableId instanceof Map;

// searchEmbedTextDirect — the top hitsPerText hub text nodes at or above minScore for ONE text record.
// An empty hitList is lawful: the text reached nothing close enough.
const searchEmbedTextDirect = ({ embedTextIndex, textRecord, hitsPerText, minScore } = {}) => {
	if (!isEmbedTextIndex(embedTextIndex)) {
		return { error: refuse.byName({ moduleName, what: 'searchEmbedTextDirect needs an embedTextIndex from buildEmbedTextIndex', where: 'the index is built ONCE per run' }) };
	}
	const settingsRefusal = searchSettingsRefusal({ hitsPerText, minScore });
	if (settingsRefusal !== '') {
		return { error: refuse.byName({ moduleName, what: settingsRefusal, where: 'searchEmbedTextDirect' }) };
	}
	const shapeRefusal = embedTextRecordRefusal({ textRecord, recordLabel: 'the searched text record' });
	if (shapeRefusal !== '') {
		return { error: refuse.byName({ moduleName, what: shapeRefusal, where: 'a searched text is a text record of the source standard' }) };
	}
	if (textRecord.embeddingModelVersion !== embedTextIndex.embeddingModelVersion) {
		return { error: refuse.byName({ moduleName, what: `${textRecord.textStableId} is embedded by '${textRecord.embeddingModelVersion}' but the index holds '${embedTextIndex.embeddingModelVersion}'`, where: 'a cosine between two models is meaningless' }) };
	}
	const searchedVectorRefusal = vectorRefusal({ vector: textRecord.vector, stableId: textRecord.textStableId, expectedDimension: embedTextIndex.dimension });
	if (searchedVectorRefusal !== '') {
		return { error: refuse.byName({ moduleName, what: searchedVectorRefusal, where: 'the searched side must be comparable to the index' }) };
	}
	const searchedNorm = normOf(textRecord.vector);
	if (searchedNorm === 0) {
		return { error: refuse.byName({ moduleName, what: `${textRecord.textStableId} carries a ZERO-norm vector`, where: 'a zero vector has no direction; its cosine with anything is undefined' }) };
	}
	const { matrix, normList, textStableIdList, dimension, textCount } = embedTextIndex;
	const scoredHitList = new Array(textCount);
	for (let textIndex = 0; textIndex < textCount; textIndex++) {
		const base = textIndex * dimension;
		let dotProduct = 0;
		for (let oneIndex = 0; oneIndex < dimension; oneIndex++) {
			dotProduct += matrix[base + oneIndex] * textRecord.vector[oneIndex];
		}
		scoredHitList[textIndex] = { hitTextStableId: textStableIdList[textIndex], cosine: dotProduct / (normList[textIndex] * searchedNorm) };
	}
	scoredHitList.sort((leftHit, rightHit) => (rightHit.cosine - leftHit.cosine) || compareStrings(leftHit.hitTextStableId, rightHit.hitTextStableId));
	const hitList = [];
	for (let hitIndex = 0; hitIndex < scoredHitList.length && hitList.length < hitsPerText; hitIndex++) {
		if (scoredHitList[hitIndex].cosine < minScore) {
			break;
		}
		hitList.push(Object.freeze({ hitTextStableId: scoredHitList[hitIndex].hitTextStableId, cosine: scoredHitList[hitIndex].cosine }));
	}
	return { hitList: Object.freeze(hitList) };
};

// makeSearchMemo — the run's settings travel WITH the memo, so a memoised hit list can never be read back
// under settings it was not searched with
const makeSearchMemo = ({ embedTextIndex, hitsPerText, minScore } = {}) => {
	if (!isEmbedTextIndex(embedTextIndex)) {
		return { error: refuse.byName({ moduleName, what: 'makeSearchMemo needs an embedTextIndex from buildEmbedTextIndex', where: 'one memo per run, over that run\'s index' }) };
	}
	const settingsRefusal = searchSettingsRefusal({ hitsPerText, minScore });
	if (settingsRefusal !== '') {
		return { error: refuse.byName({ moduleName, what: settingsRefusal, where: 'makeSearchMemo' }) };
	}
	return { searchMemo: Object.freeze({ embedTextIndex, hitsPerText, minScore, entryByTextStableId: new Map() }) };
};

const isSearchMemo = (candidate) => isPlainObject(candidate) && candidate.entryByTextStableId instanceof Map && isEmbedTextIndex(candidate.embedTextIndex);

const searchEmbedText = ({ searchMemo, textRecord } = {}) => {
	if (!isSearchMemo(searchMemo)) {
		return { error: refuse.byName({ moduleName, what: 'searchEmbedText needs a searchMemo from makeSearchMemo', where: 'the memo is owned by the caller and passed in' }) };
	}
	if (!isPlainObject(textRecord) || !isNonEmptyString(textRecord.textStableId)) {
		return { error: refuse.byName({ moduleName, what: 'searchEmbedText needs a text record carrying a textStableId', where: 'the memo is keyed by text node stableId' }) };
	}
	const memoEntry = searchMemo.entryByTextStableId.get(textRecord.textStableId);
	if (memoEntry !== undefined) {
		if (!sameVector(memoEntry.vector, textRecord.vector)) {
			return { error: refuse.byName({ moduleName, what: `text node ${textRecord.textStableId} arrives with a vector different from the one searched earlier in this run`, where: 'a text node carries ONE vector; two readers disagree' }) };
		}
		return { hitList: memoEntry.hitList };
	}
	const searched = searchEmbedTextDirect({ embedTextIndex: searchMemo.embedTextIndex, textRecord, hitsPerText: searchMemo.hitsPerText, minScore: searchMemo.minScore });
	if (searched.error) {
		return searched;
	}
	searchMemo.entryByTextStableId.set(textRecord.textStableId, Object.freeze({ vector: textRecord.vector.slice(), hitList: searched.hitList }));
	return { hitList: searched.hitList };
};

// closedNameMapRefusal — the caller's name map must name EXACTLY the logical kinds, each with a distinct
// non-empty string
const closedNameMapRefusal = ({ nameMap, requiredKindList, mapLabel }) => {
	if (!isPlainObject(nameMap)) {
		return `${mapLabel} is not an object naming ${requiredKindList.join(', ')}`;
	}
	const unknownKind = Object.keys(nameMap).find((oneKind) => requiredKindList.indexOf(oneKind) === -1);
	if (unknownKind !== undefined) {
		return `${mapLabel} names '${unknownKind}', outside ${requiredKindList.join(', ')}`;
	}
	const missingKind = requiredKindList.find((oneKind) => !hasOwn(nameMap, oneKind) || !isNonEmptyString(nameMap[oneKind]));
	if (missingKind !== undefined) {
		return `${mapLabel} lacks a non-empty name for '${missingKind}'`;
	}
	if (new Set(requiredKindList.map((oneKind) => nameMap[oneKind])).size !== requiredKindList.length) {
		return `${mapLabel} gives two kinds the same name: ${JSON.stringify(nameMap)}`;
	}
	return '';
};

const invertNameMap = (nameMap) => Object.keys(nameMap).reduce((soFar, oneKind) => ({ ...soFar, [nameMap[oneKind]]: oneKind }), {});

// buildCardSlotIndex — the card side of the walk, built ONCE per run:
//   slotEdgeListByBaseStableId           base → [{ cardStableId, slotKind }]
//   baseKindByStableId                   base → 'class' | 'property' | 'optionSet'
//   baseStableIdListBySlotKindByCardStableId  card → { property: [...], domain: [...], range: [...] }
const buildCardSlotIndex = ({ cardSlotEdgeList, slotNameBySlotKind, baseRoleByBaseKind } = {}) => {
	const slotMapRefusal = closedNameMapRefusal({ nameMap: slotNameBySlotKind, requiredKindList: SLOT_KIND_LIST, mapLabel: 'slotNameBySlotKind' });
	if (slotMapRefusal !== '') {
		return { error: refuse.byName({ moduleName, what: slotMapRefusal, where: 'the caller resolves each slot through hubEdgeType(hubName, slot)' }) };
	}
	const roleMapRefusal = closedNameMapRefusal({ nameMap: baseRoleByBaseKind, requiredKindList: BASE_KIND_LIST, mapLabel: 'baseRoleByBaseKind' });
	if (roleMapRefusal !== '') {
		return { error: refuse.byName({ moduleName, what: roleMapRefusal, where: 'the caller names each base kind by its role constant' }) };
	}
	if (!Array.isArray(cardSlotEdgeList) || cardSlotEdgeList.length === 0) {
		return { error: refuse.byName({ moduleName, what: 'buildCardSlotIndex needs a non-empty cardSlotEdgeList', where: 'a hub with no card slot edges has nothing to walk to' }) };
	}
	const slotKindBySlotName = invertNameMap(slotNameBySlotKind);
	const baseKindByBaseRole = invertNameMap(baseRoleByBaseKind);
	const slotEdgeListByBaseStableId = new Map();
	const baseKindByStableId = new Map();
	const baseStableIdListBySlotKindByCardStableId = new Map();
	const seenEdgeRefIdSet = new Set();
	for (let edgeIndex = 0; edgeIndex < cardSlotEdgeList.length; edgeIndex++) {
		const oneEdge = cardSlotEdgeList[edgeIndex];
		const edgeLabel = `cardSlotEdgeList[${edgeIndex}]`;
		if (!isPlainObject(oneEdge) || Object.keys(oneEdge).some((oneName) => CARD_SLOT_EDGE_FIELD_LIST.indexOf(oneName) === -1) || !CARD_SLOT_EDGE_FIELD_LIST.every((oneName) => isNonEmptyString(oneEdge[oneName]))) {
			return { error: refuse.byName({ moduleName, what: `${edgeLabel} is not the closed shape { ${CARD_SLOT_EDGE_FIELD_LIST.join(', ')} } of non-empty strings: ${JSON.stringify(oneEdge)}`, where: "the retrieval view's card slot edge read returns exactly that shape" }) };
		}
		if (!hasOwn(slotKindBySlotName, oneEdge.slot)) {
			return { error: refuse.byName({ moduleName, what: `${edgeLabel} slot '${oneEdge.slot}' is none of ${SLOT_KIND_LIST.map((oneKind) => slotNameBySlotKind[oneKind]).join(', ')}`, where: 'only the declared hub slots are walked' }) };
		}
		if (!hasOwn(baseKindByBaseRole, oneEdge.baseRole)) {
			return { error: refuse.byName({ moduleName, what: `${edgeLabel} baseRole '${oneEdge.baseRole}' is none of ${BASE_KIND_LIST.map((oneKind) => baseRoleByBaseKind[oneKind]).join(', ')}`, where: 'a base node is a class, a property or an option set' }) };
		}
		const slotKind = slotKindBySlotName[oneEdge.slot];
		const baseKind = baseKindByBaseRole[oneEdge.baseRole];
		if (BASE_KIND_LIST_BY_SLOT_KIND[slotKind].indexOf(baseKind) === -1) {
			return { error: refuse.byName({ moduleName, what: `${edgeLabel} puts a ${baseKind} base (${oneEdge.baseStableId}) in the ${slotKind} slot of ${oneEdge.cardStableId}`, where: `the ${slotKind} slot holds only ${BASE_KIND_LIST_BY_SLOT_KIND[slotKind].join(' or ')}` }) };
		}
		const priorBaseKind = baseKindByStableId.get(oneEdge.baseStableId);
		if (priorBaseKind !== undefined && priorBaseKind !== baseKind) {
			return { error: refuse.byName({ moduleName, what: `base ${oneEdge.baseStableId} arrives as both a ${priorBaseKind} and a ${baseKind}`, where: 'a node carries one role' }) };
		}
		const edgeRefId = `${oneEdge.cardStableId} ${oneEdge.slot} ${oneEdge.baseStableId}`;
		if (seenEdgeRefIdSet.has(edgeRefId)) {
			return { error: refuse.byName({ moduleName, what: `${edgeLabel} repeats (${oneEdge.cardStableId}, ${oneEdge.slot}, ${oneEdge.baseStableId})`, where: 'one slot edge per (card, slot, base)' }) };
		}
		seenEdgeRefIdSet.add(edgeRefId);
		baseKindByStableId.set(oneEdge.baseStableId, baseKind);
		if (!slotEdgeListByBaseStableId.has(oneEdge.baseStableId)) {
			slotEdgeListByBaseStableId.set(oneEdge.baseStableId, []);
		}
		slotEdgeListByBaseStableId.get(oneEdge.baseStableId).push({ cardStableId: oneEdge.cardStableId, slotKind });
		if (!baseStableIdListBySlotKindByCardStableId.has(oneEdge.cardStableId)) {
			baseStableIdListBySlotKindByCardStableId.set(oneEdge.cardStableId, { property: [], domain: [], range: [] });
		}
		baseStableIdListBySlotKindByCardStableId.get(oneEdge.cardStableId)[slotKind].push(oneEdge.baseStableId);
	}
	slotEdgeListByBaseStableId.forEach((slotEdgeList, baseStableId) => {
		slotEdgeListByBaseStableId.set(baseStableId, Object.freeze(slotEdgeList.sort((leftEdge, rightEdge) => compareStrings(leftEdge.cardStableId, rightEdge.cardStableId) || compareStrings(leftEdge.slotKind, rightEdge.slotKind)).map((oneEdge) => Object.freeze(oneEdge))));
	});
	baseStableIdListBySlotKindByCardStableId.forEach((slotListByKind, cardStableId) => {
		baseStableIdListBySlotKindByCardStableId.set(cardStableId, Object.freeze({ property: Object.freeze(slotListByKind.property.sort(compareStrings)), domain: Object.freeze(slotListByKind.domain.sort(compareStrings)), range: Object.freeze(slotListByKind.range.sort(compareStrings)) }));
	});
	return { cardSlotIndex: Object.freeze({ slotEdgeListByBaseStableId, baseKindByStableId, baseStableIdListBySlotKindByCardStableId }) };
};

const isCardSlotIndex = (candidate) => isPlainObject(candidate) && candidate.slotEdgeListByBaseStableId instanceof Map && candidate.baseKindByStableId instanceof Map && candidate.baseStableIdListBySlotKindByCardStableId instanceof Map;

const comparePaths = (leftPath, rightPath) =>
	compareStrings(leftPath.embedTextStableId, rightPath.embedTextStableId) ||
	compareStrings(leftPath.hitTextStableId, rightPath.hitTextStableId) ||
	compareStrings(leftPath.baseStableId, rightPath.baseStableId) ||
	compareStrings(leftPath.slotKind, rightPath.slotKind);

// voteCandidatePool — steps 1-6 for ONE subject. An EMPTY admittedList is lawful (orphan 'noCandidate' to the
// caller), exactly as an empty seatList is above.
const voteCandidatePool = ({ searchMemo, cardSlotIndex, subjectStableId, subjectTextRecordList } = {}) => {
	if (!isSearchMemo(searchMemo)) {
		return { error: refuse.byName({ moduleName, what: 'voteCandidatePool needs a searchMemo from makeSearchMemo', where: 'the memo is owned by the caller and passed in' }) };
	}
	if (!isCardSlotIndex(cardSlotIndex)) {
		return { error: refuse.byName({ moduleName, what: 'voteCandidatePool needs a cardSlotIndex from buildCardSlotIndex', where: 'the card slot index is built ONCE per run' }) };
	}
	if (!isNonEmptyString(subjectStableId)) {
		return { error: refuse.byName({ moduleName, what: `voteCandidatePool subjectStableId ${JSON.stringify(subjectStableId)} is not a non-empty string`, where: 'one subject per call' }) };
	}
	if (!Array.isArray(subjectTextRecordList)) {
		return { error: refuse.byName({ moduleName, what: `subject ${subjectStableId} subjectTextRecordList is not an array`, where: "the subject's own text records" }) };
	}
	const seenTextStableIdSet = new Set();
	const tallyByCardStableId = new Map();
	for (let recordIndex = 0; recordIndex < subjectTextRecordList.length; recordIndex++) {
		const oneRecord = subjectTextRecordList[recordIndex];
		const shapeRefusal = embedTextRecordRefusal({ textRecord: oneRecord, recordLabel: `subject ${subjectStableId} text record ${recordIndex}` });
		if (shapeRefusal !== '') {
			return { error: refuse.byName({ moduleName, what: shapeRefusal, where: "the subject's own text records" }) };
		}
		if (oneRecord.sourceStableId !== subjectStableId) {
			return { error: refuse.byName({ moduleName, what: `text record ${oneRecord.textStableId} describes ${oneRecord.sourceStableId}, not subject ${subjectStableId}`, where: "a subject votes only with its OWN texts; a neighbour's texts belong to the neighbour step" }) };
		}
		if (seenTextStableIdSet.has(oneRecord.textStableId)) {
			return { error: refuse.byName({ moduleName, what: `text node ${oneRecord.textStableId} arrives twice for subject ${subjectStableId}`, where: 'ONE text edge per (text node, described node); a repeat would vote twice (R-BR-3)' }) };
		}
		seenTextStableIdSet.add(oneRecord.textStableId);
		const searched = searchEmbedText({ searchMemo, textRecord: oneRecord });
		if (searched.error) {
			return searched;
		}
		const propertyNameList = Object.freeze(oneRecord.propertyNameList.slice());
		searched.hitList.forEach((oneHit) => {
			searchMemo.embedTextIndex.baseStableIdListByTextStableId.get(oneHit.hitTextStableId).forEach((oneBaseStableId) => {
				// a base node on no card (a class with no cards, say) is lawful and reaches nothing
				const slotEdgeList = cardSlotIndex.slotEdgeListByBaseStableId.get(oneBaseStableId);
				if (slotEdgeList === undefined) {
					return;
				}
				slotEdgeList.forEach((oneSlotEdge) => {
					if (!tallyByCardStableId.has(oneSlotEdge.cardStableId)) {
						tallyByCardStableId.set(oneSlotEdge.cardStableId, { stableId: oneSlotEdge.cardStableId, voterTextStableIdSet: new Set(), pathList: [], bestCosine: null, admittingPathCount: 0 });
					}
					const oneTally = tallyByCardStableId.get(oneSlotEdge.cardStableId);
					oneTally.voterTextStableIdSet.add(oneRecord.textStableId);
					oneTally.pathList.push(Object.freeze({ embedTextStableId: oneRecord.textStableId, propertyNameList, hitTextStableId: oneHit.hitTextStableId, baseStableId: oneBaseStableId, baseKind: cardSlotIndex.baseKindByStableId.get(oneBaseStableId), slotKind: oneSlotEdge.slotKind, cosine: oneHit.cosine }));
					oneTally.bestCosine = oneTally.bestCosine === null || oneHit.cosine > oneTally.bestCosine ? oneHit.cosine : oneTally.bestCosine;
					if (ADMITTING_SLOT_KIND_LIST.indexOf(oneSlotEdge.slotKind) !== -1) {
						oneTally.admittingPathCount += 1;
					}
				});
			});
		});
	}
	const admittedList = Array.from(tallyByCardStableId.values())
		.filter((oneTally) => oneTally.admittingPathCount > 0)
		.sort((leftTally, rightTally) => compareStrings(leftTally.stableId, rightTally.stableId))
		.map((oneTally) =>
			Object.freeze({
				stableId: oneTally.stableId,
				ownVotes: oneTally.voterTextStableIdSet.size,
				bestCosine: oneTally.bestCosine,
				pathList: Object.freeze(oneTally.pathList.slice().sort(comparePaths)),
			}),
		);
	return { admittedList: Object.freeze(admittedList) };
};

const admittedListRefusal = ({ admittedList, callerName }) => {
	if (!Array.isArray(admittedList)) {
		return `${callerName} needs admittedList as an array (voteCandidatePool's output)`;
	}
	const malformedIndex = admittedList.findIndex((oneCandidate) => !isPlainObject(oneCandidate) || !isNonEmptyString(oneCandidate.stableId) || !Number.isInteger(oneCandidate.ownVotes) || typeof oneCandidate.bestCosine !== 'number' || !Number.isFinite(oneCandidate.bestCosine));
	if (malformedIndex !== -1) {
		return `${callerName} admittedList[${malformedIndex}] is not { stableId, ownVotes, bestCosine, pathList }`;
	}
	return '';
};

// rankVotedCandidates — step 7, the VOTES-ONLY rank. Also exactly what neighbourVote: null must reproduce.
const rankVotedCandidates = ({ admittedList, k } = {}) => {
	const listRefusal = admittedListRefusal({ admittedList, callerName: 'rankVotedCandidates' });
	if (listRefusal !== '') {
		return { error: refuse.byName({ moduleName, what: listRefusal, where: 'rank the admitted list only' }) };
	}
	if (!Number.isInteger(k) || k < 1) {
		return { error: refuse.byName({ moduleName, what: `rankVotedCandidates k ${JSON.stringify(k)} is not a positive integer`, where: 'K is declared data (candidateRetrieval.k); there is no default' }) };
	}
	const rankedList = admittedList
		.slice()
		.sort((leftCandidate, rightCandidate) => (rightCandidate.ownVotes - leftCandidate.ownVotes) || (rightCandidate.bestCosine - leftCandidate.bestCosine) || compareStrings(leftCandidate.stableId, rightCandidate.stableId))
		.slice(0, k);
	return { rankedList: Object.freeze(rankedList) };
};

module.exports = {
	buildHubVectorIndex,
	retrieveCandidatePool,
	vectorRefusal,
	normOf,
	buildEmbedTextIndex,
	makeSearchMemo,
	searchEmbedTextDirect,
	searchEmbedText,
	buildCardSlotIndex,
	voteCandidatePool,
	rankVotedCandidates,
	embedTextRecordRefusal,
	admittedListRefusal,
	isSearchMemo,
	isCardSlotIndex,
	compareStrings,
	moduleName,
};
