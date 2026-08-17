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

module.exports = { buildHubVectorIndex, retrieveCandidatePool, vectorRefusal, normOf, moduleName };
