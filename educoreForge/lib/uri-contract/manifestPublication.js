'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// manifestPublication.js — what -publishManifest gathers before it writes (ML3.1 Part B): the manifest's members, the closure of
// their schema blocks, the frozen vectors they reference, the counts a replay of them yields, and whether a question URI needs a
// declared default (AMBER_JOURNEY ruling (b), 2026-10-26).
//
//   manifestForPublish({ supportStore, manifestRefId }) → { memberList, frozenVectorList, basedOnManifestRefId } | { error }
//       supportStore  a READ-ONLY better-sqlite3 handle on a support store (blocks, manifests, manifestBlocks, vectors)
//   answerConflictListFor({ memberList }) → { answerKeyCount, answerConflictList: [{ subjectStableId, hubSegment, answerSourceList }] } | { error }
//   defaultLayerByHubFor({ answerConflictList, declaredDefaultLayerByHub }) → { defaultLayerByHub } | { error }
//
// THE QUESTION RULE (ruling (b)): a question URI asks what THIS GRAPH says an element maps to, and answers from the manifest's own
// relationship schema blocks, every row carrying its provenance. A declared default is needed only where the graph itself is
// ambiguous: a SUBJECT element whose answer edges toward one hub come from two decision schema blocks (two producers). MEASURED 2026-10-26 on goldWave3
// 4303bbdb: 22,747 (subject, hub) pairs, NONE with two producers, although three standard-hub PAIRS carry blocks of two or three
// producers (pescld: authored declared identity beside two judged facets, toward each hub; ctdlasn: authored beside structural).
// Those producers answer DIFFERENT subjects, so the conflict is tested per subject, never per pair. An answer edge is a SKOS match
// or DECLARED_CORRESPONDENCE edge (lib/vocabulary) whose target parses (lib/edc-uri) as a meaning, a HubReference card; the hub is
// the card URI's hubSegment; what answered is the edge's decisionBlockHash. No conflict and no declaration → null; a conflict needs a
// declaration whose decisionBlockHashList picks exactly one answering block per conflicted subject; a declaration with no
// conflict to settle is refused (nothing is stored that nothing needs).

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const { embeddingRefListOf } = require(path.join(__dirname, 'uriContract'));
const derivedIndexesLib = require(path.join(__dirname, 'derivedIndexes'));

const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const manifestForPublish = ({ supportStore, manifestRefId } = {}) => {
	const manifestRow = supportStore.prepare('SELECT refId, basedOnManifestRefId FROM manifests WHERE refId = ?').get(manifestRefId);
	if (manifestRow === undefined) {
		return { error: refusalText(`manifest ${manifestRefId} is not in the support store`, '-publishManifest publishes a manifest a build stored; name its refId') };
	}
	const memberRowList = supportStore.prepare('SELECT schemaBlockRefId, position FROM manifestBlocks WHERE manifestRefId = ? ORDER BY position').all(manifestRefId);
	const blockStatement = supportStore.prepare('SELECT refId, kind, subject, version, requires, text, producedBy FROM blocks WHERE refId = ?');
	const memberList = [];
	for (let memberIndex = 0; memberIndex < memberRowList.length; memberIndex++) {
		const { schemaBlockRefId, position } = memberRowList[memberIndex];
		const blockRow = blockStatement.get(schemaBlockRefId);
		if (blockRow === undefined || !Number.isInteger(position)) {
			return { error: refusalText(`manifest ${manifestRefId} member ${schemaBlockRefId} ${blockRow === undefined ? 'is not in the blocks table' : 'has no position'}`, 'a published manifest is whole and ordered') };
		}
		const requiresList = blockRow.requires === null || blockRow.requires === '' ? [] : JSON.parse(blockRow.requires);
		memberList.push({ position, schemaBlock: { refId: blockRow.refId, kind: blockRow.kind, subject: blockRow.subject === null ? undefined : blockRow.subject, version: blockRow.version === null ? undefined : blockRow.version, requires: requiresList, text: String(blockRow.text), producedBy: blockRow.producedBy === null ? undefined : blockRow.producedBy } });
	}
	const vectorIdSet = new Set(memberList.reduce((soFar, { schemaBlock }) => soFar.concat(embeddingRefListOf(schemaBlock.text)), []));
	const vectorStatement = supportStore.prepare('SELECT vectorId, modelVersion, dims, dtype, inputText, vector, vectorHash FROM vectors WHERE vectorId = ?');
	const frozenVectorList = [];
	const vectorIdList = [...vectorIdSet];
	for (let vectorIndex = 0; vectorIndex < vectorIdList.length; vectorIndex++) {
		const vectorRow = vectorStatement.get(vectorIdList[vectorIndex]);
		if (vectorRow === undefined) {
			return { error: refusalText(`manifest ${manifestRefId} references vector ${vectorIdList[vectorIndex]}, which the support store does not hold`, 'every frozen vector a published block references is copied into uriContract') };
		}
		frozenVectorList.push({ ...vectorRow, dims: Number(vectorRow.dims) });
	}
	return { memberList, frozenVectorList, basedOnManifestRefId: manifestRow.basedOnManifestRefId === null ? undefined : manifestRow.basedOnManifestRefId };
};

// answerConflictListFor — grouped from the same answer-edge rows the derived index holds (derivedIndexes.js), so the publish-time
// conflict test and the question resolver read ONE definition of an answer edge; what answered is the edge's decisionBlockHash
const answerConflictListFor = ({ memberList } = {}) => {
	const answerSourceSetByAnswerKey = new Map();
	for (let memberIndex = 0; memberIndex < memberList.length; memberIndex++) {
		const derived = derivedIndexesLib.derivedRowsForSchemaBlock(memberList[memberIndex].schemaBlock);
		if (derived.error) {
			return { error: derived.error };
		}
		derived.answerEdgeRowList.forEach((oneRow) => {
			const answerKey = `${oneRow.subjectStableId}\u0000${oneRow.hubSegment}`;
			if (!answerSourceSetByAnswerKey.has(answerKey)) {
				answerSourceSetByAnswerKey.set(answerKey, new Set());
			}
			answerSourceSetByAnswerKey.get(answerKey).add(oneRow.decisionBlockHash === null ? `noDecisionBlock:${oneRow.schemaBlockRefId}` : oneRow.decisionBlockHash);
		});
	}
	return {
		answerKeyCount: answerSourceSetByAnswerKey.size,
		answerConflictList: [...answerSourceSetByAnswerKey]
			.filter(([, answerSourceSet]) => answerSourceSet.size > 1)
			.map(([answerKey, answerSourceSet]) => ({ subjectStableId: answerKey.split('\u0000')[0], hubSegment: answerKey.split('\u0000')[1], answerSourceList: [...answerSourceSet].sort() })),
	};
};

// defaultLayerByHubFor — the shape lane A's question kind case reads (AMBER_JOURNEY relay 2026-10-26):
//   null | { <hubSegment>: { decisionBlockHashList: [ ... ] } }   the blocks whose edges answer for that hub where a subject is conflicted
const defaultLayerByHubFor = ({ answerConflictList, declaredDefaultLayerByHub } = {}) => {
	if (answerConflictList.length === 0) {
		return declaredDefaultLayerByHub === undefined ? { defaultLayerByHub: null } : { error: refusalText('a defaultLayerByHub was declared, but no subject in this manifest has answer edges from two decision schema blocks', '--defaultLayerByHubPath settles a conflict; with none, a question answers from the manifest\'s own edges and nothing is stored') };
	}
	const conflictedHubList = [...new Set(answerConflictList.map((oneConflict) => oneConflict.hubSegment))].sort();
	if (!isPlainObject(declaredDefaultLayerByHub)) {
		return { error: refusalText(`${answerConflictList.length} subject(s) have answer edges from two decision schema blocks toward hub(s) ${conflictedHubList.join(', ')} (first: ${answerConflictList[0].subjectStableId} -> ${answerConflictList[0].hubSegment}: ${answerConflictList[0].answerSourceList.join(' + ')})`, '--defaultLayerByHubPath must name, per conflicted hub, { decisionBlockHashList } (SPEC D-DEFAULTLAYER: no silent choice)') };
	}
	const malformedHub = Object.keys(declaredDefaultLayerByHub).find((hubSegment) => !isPlainObject(declaredDefaultLayerByHub[hubSegment]) || !Array.isArray(declaredDefaultLayerByHub[hubSegment].decisionBlockHashList) || Object.keys(declaredDefaultLayerByHub[hubSegment]).length !== 1);
	if (malformedHub !== undefined) {
		return { error: refusalText(`the declaration for hub ${malformedHub} is not { decisionBlockHashList: [ ... ] }`, '--defaultLayerByHubPath: { <hubSegment>: { "decisionBlockHashList": [ <decision schema block hash>, ... ] } }') };
	}
	const unsettled = answerConflictList.find((oneConflict) => {
		const declared = declaredDefaultLayerByHub[oneConflict.hubSegment];
		return declared === undefined || oneConflict.answerSourceList.filter((answerSource) => declared.decisionBlockHashList.indexOf(answerSource) !== -1).length !== 1;
	});
	if (unsettled !== undefined) {
		return { error: refusalText(`the declaration does not pick exactly one of ${unsettled.answerSourceList.join(', ')} for ${unsettled.subjectStableId} toward hub ${unsettled.hubSegment}`, '--defaultLayerByHubPath: each conflicted subject must find exactly one of its answering blocks in its hub\'s decisionBlockHashList') };
	}
	return { defaultLayerByHub: declaredDefaultLayerByHub };
};

module.exports = { manifestForPublish, answerConflictListFor, defaultLayerByHubFor, moduleName };
