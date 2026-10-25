'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// raterLayerConverter.js — the rater layer (mappingLayers ML2-a; SPEC §8.1, D-RATERPRED; DESIGN-ML2a-raterLayer-102526.md, approved
// by BRONZE_CROWN 2026-10-25). PURE, synchronous and deterministic: rows in, SSSOM/TSV text out; no store, no clock, no file.
//
//   convertRaterStore({ answerRowList, raterRowList, historyRowList, suggestedByElementStableId, unresolvedElementStableIdList,
//                       raterLayerSources, versionTag })
//     → { setTextByLayerKey, censusByLayerKey, agentRowList, layerRowList } | { error }
//
//   answerRowList   [{ raterUserName, elementStableId, answerJson }]  the store's answers table: the CURRENT answer per (rater, element)
//   raterRowList    [{ refId, raterUserName, surveyName }]            NEVER displayJson (real names and emails live there)
//   historyRowList  [{ raterUserName, elementStableId }]              counted only; history never makes a row
//
// One set per rater with a row (layer rater-NN, authored by edc:agent/<raters.refId>) and one pooled set (layer raters, authored by the
// pooling organisation; every row's author_id names its rater). Rows: Best -> edc:bestMatch, each Same -> edc:alsoAcceptable, the card
// URI as object and the title the rater saw as object_label; noMatch -> the EXPORTER'S OWN abstention pair (skos:mappingRelation,
// sssom:NoTermFound, 1:0), imported so a rater's No match and Jev's abstention can agree; unsure -> no row, counted. No mapping_date
// (savedAt moves on an identical re-save) and no record_id (ruled: ML3). Rows sort by subject, predicate rank, object, author, by code
// point. Every refusal names what and where; nothing is guessed.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { NO_TERM_FOUND_OBJECT_ID, NO_TERM_FOUND_PREDICATE_ID, URN_SCHEME_PREFIX, yamlScalar } = require(path.join(__dirname, '..', 'bridge-framework', 'sssomExporter'));

const NO_TERM_FOUND_CARDINALITY = '1:0';
const ANSWER_KIND_LIST = Object.freeze(['cards', 'noMatch', 'unsure']);
const EDC_CURIE_PREFIX = 'edc';
const COLUMN_LIST = Object.freeze(['subject_id', 'predicate_id', 'object_id', 'mapping_justification', 'object_label', 'subject_source', 'subject_source_version', 'author_id', 'mapping_cardinality']);

const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const byCodePoint = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0); // UTF-16 order equals code-point order for these ASCII ids
const tsvCell = (cellText) => (cellText === undefined || cellText === null ? '' : String(cellText).replace(/[\t\r\n]/g, ' '));
const parsedJsonOf = (jsonText) => {
	let parsed;
	try {
		parsed = JSON.parse(jsonText);
	} catch (parseError) {
		return { error: parseError.message };
	}
	return { parsed };
};

// the title the rater saw: Class → Property (qualifiers), as the rater tool's candidateTitleOf writes it
const cardTitleOf = (card) => `${card.className} → ${card.propertyName}${Array.isArray(card.qualifierNameList) && card.qualifierNameList.length > 0 ? ` (${card.qualifierNameList.join(', ')})` : ''}`;

// subjectOf(storeElementStableId) → { subjectStableId, standardKey } | { error }: the store prefixes a display name ('Ed-Fi:') to the forged id
const subjectOf = ({ storeElementStableId, raterLayerSources }) => {
	const displaySeparatorIndex = storeElementStableId.indexOf(':');
	const subjectStableId = displaySeparatorIndex > 0 ? storeElementStableId.slice(displaySeparatorIndex + 1) : '';
	const standardKey = subjectStableId.indexOf(':') > 0 ? subjectStableId.slice(0, subjectStableId.indexOf(':')) : '';
	if (!isNonEmptyString(standardKey) || raterLayerSources.standardVersionByStandardKey[standardKey] === undefined) {
		return { error: refusalText(`element ${JSON.stringify(storeElementStableId)} names standard ${JSON.stringify(standardKey)}, which is not listed`, `lib/rater-layer/raterLayerSources.json standardVersionByStandardKey (${Object.keys(raterLayerSources.standardVersionByStandardKey).join(', ')})`) };
	}
	return { subjectStableId, standardKey };
};

// rowsForAnswer → { rowList, isUnsure } | { error }
const rowsForAnswer = ({ answerRow, answer, subject, authorAgentIri, suggestedByElementStableId, raterLayerSources }) => {
	const { hub, predicateIdByAnswerRole, mappingJustification } = raterLayerSources;
	const subjectColumns = {
		subject_id: subject.subjectStableId,
		mapping_justification: mappingJustification,
		subject_source: raterLayerSources.standardSourceIriPattern.replace('{standardKey}', subject.standardKey),
		subject_source_version: raterLayerSources.standardVersionByStandardKey[subject.standardKey],
		author_id: authorAgentIri,
	};
	if (answer.answerKind === 'unsure') {
		return { rowList: [], isUnsure: true };
	}
	if (answer.answerKind === 'noMatch') {
		return { rowList: [{ ...subjectColumns, predicate_id: NO_TERM_FOUND_PREDICATE_ID, object_id: NO_TERM_FOUND_OBJECT_ID, object_label: '', mapping_cardinality: NO_TERM_FOUND_CARDINALITY }], isUnsure: false };
	}
	const suggestedEntry = suggestedByElementStableId[answerRow.elementStableId];
	const offeredCardList = (suggestedEntry === undefined ? [] : suggestedEntry.cardList).concat(Array.isArray(answer.addedCardList) ? answer.addedCardList : []);
	const sameCedsTupleIdList = Array.isArray(answer.sameCedsTupleIdList) ? answer.sameCedsTupleIdList : [];
	const roleList = [{ answerRole: 'best', cedsTupleId: answer.bestCedsTupleId }].concat(sameCedsTupleIdList.map((cedsTupleId) => ({ answerRole: 'same', cedsTupleId })));
	const rowList = [];
	for (let roleIndex = 0; roleIndex < roleList.length; roleIndex++) {
		const { answerRole, cedsTupleId } = roleList[roleIndex];
		if (!isNonEmptyString(cedsTupleId) || cedsTupleId.indexOf(hub.hubCardUriPrefix) !== 0) {
			return { error: refusalText(`${answerRow.raterUserName}'s ${answerRole} card for ${answerRow.elementStableId} is ${JSON.stringify(cedsTupleId)}, not a ${hub.hubName} ${hub.hubVersion} card URI`, `raterLayerSources.json hub.hubCardUriPrefix (${hub.hubCardUriPrefix})`) };
		}
		const offeredCard = offeredCardList.find((oneCard) => oneCard.cedsTupleId === cedsTupleId);
		if (offeredCard === undefined) {
			return { error: refusalText(`${answerRow.raterUserName}'s ${answerRole} card ${cedsTupleId} for ${answerRow.elementStableId} is neither suggested nor added, so it has no label`, 'object_label is the title the rater saw (suggested.json, or the answer\'s addedCardList), never blank') };
		}
		rowList.push({ ...subjectColumns, predicate_id: predicateIdByAnswerRole[answerRole], object_id: cedsTupleId, object_label: cardTitleOf(offeredCard), mapping_cardinality: '' });
	}
	return { rowList, isUnsure: false };
};

const setTextFor = ({ layerKey, versionTag, authorAgentIri, rowList, raterLayerSources }) => {
	const predicateRankById = [raterLayerSources.predicateIdByAnswerRole.best, raterLayerSources.predicateIdByAnswerRole.same, NO_TERM_FOUND_PREDICATE_ID].reduce((soFar, predicateId, rankIndex) => ({ ...soFar, [predicateId]: rankIndex }), {});
	const sortedRowList = rowList
		.slice()
		.sort((leftRow, rightRow) => byCodePoint(leftRow.subject_id, rightRow.subject_id) || predicateRankById[leftRow.predicate_id] - predicateRankById[rightRow.predicate_id] || byCodePoint(leftRow.object_id, rightRow.object_id) || byCodePoint(leftRow.author_id, rightRow.author_id));
	const standardKeyList = Array.from(new Set(sortedRowList.map((oneRow) => oneRow.subject_id.slice(0, oneRow.subject_id.indexOf(':'))))).sort(byCodePoint);
	const curieMap = standardKeyList.reduce((soFar, standardKey) => ({ ...soFar, [standardKey]: raterLayerSources.standardSourceIriPattern.replace('{standardKey}', standardKey) }), { [EDC_CURIE_PREFIX]: raterLayerSources.edcCurieExpansion, [URN_SCHEME_PREFIX]: `${URN_SCHEME_PREFIX}:` });
	const headerLineList = [
		'#curie_map:',
		...Object.keys(curieMap)
			.sort(byCodePoint)
			.map((onePrefix) => `#  ${onePrefix}: ${yamlScalar(curieMap[onePrefix])}`),
		`#mapping_set_id: ${yamlScalar(`${raterLayerSources.edcCurieExpansion}layer/${layerKey}/${versionTag}`)}`,
		`#mapping_set_version: ${yamlScalar(versionTag)}`,
		`#mapping_provider: ${yamlScalar(authorAgentIri)}`,
		`#object_source: ${yamlScalar(raterLayerSources.hub.sourceIri)}`,
		`#object_source_version: ${yamlScalar(raterLayerSources.hub.hubVersion)}`,
		`#comment: ${yamlScalar(raterLayerSources.predicateMeaningComment)}`,
	];
	return `${headerLineList.join('\n')}\n${COLUMN_LIST.join('\t')}\n${sortedRowList.map((oneRow) => COLUMN_LIST.map((oneColumn) => tsvCell(oneRow[oneColumn])).join('\t')).join('\n')}\n`;
};

const censusFor = ({ answerUnitList, historyRowList, raterUserNameList, excludedUnresolvedList }) => {
	const ownHistoryList = historyRowList.filter((oneHistoryRow) => raterUserNameList.indexOf(oneHistoryRow.raterUserName) !== -1);
	const historyCountByPair = ownHistoryList.reduce((soFar, oneHistoryRow) => ({ ...soFar, [`${oneHistoryRow.raterUserName}|${oneHistoryRow.elementStableId}`]: (soFar[`${oneHistoryRow.raterUserName}|${oneHistoryRow.elementStableId}`] || 0) + 1 }), {});
	const rowList = answerUnitList.reduce((soFar, oneUnit) => soFar.concat(oneUnit.rowList), []);
	return {
		answerReadCount: answerUnitList.length,
		answerCountByKind: ANSWER_KIND_LIST.reduce((soFar, answerKind) => ({ ...soFar, [answerKind]: answerUnitList.filter((oneUnit) => oneUnit.answerKind === answerKind).length }), {}),
		rowCount: rowList.length,
		rowCountByPredicate: rowList.reduce((soFar, oneRow) => ({ ...soFar, [oneRow.predicate_id]: (soFar[oneRow.predicate_id] || 0) + 1 }), {}),
		subjectCount: new Set(rowList.map((oneRow) => oneRow.subject_id)).size,
		unsureCount: answerUnitList.filter((oneUnit) => oneUnit.answerKind === 'unsure').length,
		unsureSubjectList: answerUnitList.filter((oneUnit) => oneUnit.answerKind === 'unsure').map((oneUnit) => oneUnit.subjectStableId).sort(byCodePoint),
		historyRowCount: ownHistoryList.length,
		changedAnswerCount: Object.keys(historyCountByPair).filter((pairText) => historyCountByPair[pairText] > 1).length,
		excludedUnresolvedList,
	};
};

const convertRaterStore = ({ answerRowList, raterRowList, historyRowList, suggestedByElementStableId, unresolvedElementStableIdList, raterLayerSources, versionTag } = {}) => {
	const absentInput = [['answerRowList', answerRowList], ['raterRowList', raterRowList], ['historyRowList', historyRowList], ['unresolvedElementStableIdList', unresolvedElementStableIdList]].find(([, oneList]) => !Array.isArray(oneList));
	if (absentInput !== undefined) {
		return { error: refusalText(`${absentInput[0]} is not a list`, 'convertRaterStore({ … }); every input is stated, an empty list included') };
	}
	if (!suggestedByElementStableId || typeof suggestedByElementStableId !== 'object' || !raterLayerSources || !isNonEmptyString(versionTag)) {
		return { error: refusalText('suggestedByElementStableId, raterLayerSources and versionTag are required', 'convertRaterStore({ … }); nothing here is defaulted') };
	}
	const raterUserNamePattern = new RegExp(raterLayerSources.raterUserNamePattern);
	const raterByUserName = raterRowList.reduce((soFar, oneRater) => ({ ...soFar, [oneRater.raterUserName]: oneRater }), {});
	const answerUnitListByRater = {};
	const excludedUnresolvedList = [];
	const seenPairSet = new Set();
	const orderedAnswerRowList = answerRowList.slice().sort((leftRow, rightRow) => byCodePoint(leftRow.raterUserName, rightRow.raterUserName) || byCodePoint(leftRow.elementStableId, rightRow.elementStableId));
	for (let answerIndex = 0; answerIndex < orderedAnswerRowList.length; answerIndex++) {
		const answerRow = orderedAnswerRowList[answerIndex];
		const pairText = `${answerRow.raterUserName}|${answerRow.elementStableId}`;
		if (seenPairSet.has(pairText)) {
			return { error: refusalText(`two current answers for ${pairText}`, 'the answers table holds ONE current answer per (rater, element); history is answerHistory') };
		}
		seenPairSet.add(pairText);
		if (unresolvedElementStableIdList.indexOf(answerRow.elementStableId) !== -1) {
			excludedUnresolvedList.push(pairText);
			continue;
		}
		const rater = raterByUserName[answerRow.raterUserName];
		const raterNumberMatch = raterUserNamePattern.exec(answerRow.raterUserName);
		if (rater === undefined || raterNumberMatch === null || !isNonEmptyString(rater.refId)) {
			return { error: refusalText(`answer by ${JSON.stringify(answerRow.raterUserName)} names no rater account matching ${raterLayerSources.raterUserNamePattern} with a refId`, 'a rater layer is authored by edc:agent/<raters.refId>; an unknown author is refused') };
		}
		const answerParse = parsedJsonOf(answerRow.answerJson);
		if (answerParse.error || ANSWER_KIND_LIST.indexOf(answerParse.parsed && answerParse.parsed.answerKind) === -1) {
			return { error: refusalText(`answer ${pairText} is not a readable answer (${answerParse.error || `answerKind ${JSON.stringify(answerParse.parsed && answerParse.parsed.answerKind)}`})`, `an answer is JSON with answerKind one of ${ANSWER_KIND_LIST.join(', ')} (rater-answer-rules.js)`) };
		}
		const subject = subjectOf({ storeElementStableId: answerRow.elementStableId, raterLayerSources });
		if (subject.error) {
			return { error: subject.error };
		}
		const authorAgentIri = `${raterLayerSources.agentIriBase}${rater.refId}`;
		const answered = rowsForAnswer({ answerRow, answer: answerParse.parsed, subject, authorAgentIri, suggestedByElementStableId, raterLayerSources });
		if (answered.error) {
			return { error: answered.error };
		}
		answerUnitListByRater[answerRow.raterUserName] = (answerUnitListByRater[answerRow.raterUserName] || []).concat([{ answerKind: answerParse.parsed.answerKind, subjectStableId: subject.subjectStableId, rowList: answered.rowList }]);
	}
	const setTextByLayerKey = {};
	const censusByLayerKey = {};
	const agentRowList = [];
	const layerRowList = [];
	const raterUserNameList = Object.keys(answerUnitListByRater).sort(byCodePoint);
	raterUserNameList.forEach((raterUserName) => {
		const rater = raterByUserName[raterUserName];
		const raterNumber = raterUserNamePattern.exec(raterUserName)[1];
		const layerKey = raterLayerSources.perRaterLayerKeyPattern.replace('{raterNumber}', raterNumber);
		const authorAgentIri = `${raterLayerSources.agentIriBase}${rater.refId}`;
		const answerUnitList = answerUnitListByRater[raterUserName];
		const rowList = answerUnitList.reduce((soFar, oneUnit) => soFar.concat(oneUnit.rowList), []);
		censusByLayerKey[layerKey] = censusFor({ answerUnitList, historyRowList, raterUserNameList: [raterUserName], excludedUnresolvedList: excludedUnresolvedList.filter((pairText) => pairText.indexOf(`${raterUserName}|`) === 0) });
		agentRowList.push({ agentIri: authorAgentIri, agentKind: 'person', displayName: `rater ${raterNumber}, survey ${rater.surveyName}` });
		if (rowList.length === 0) {
			censusByLayerKey[layerKey].noSetBecause = 'every answer is unsure, so the set would carry no row';
			return;
		}
		setTextByLayerKey[layerKey] = setTextFor({ layerKey, versionTag, authorAgentIri, rowList, raterLayerSources });
		layerRowList.push({ layerKey, authorAgentIri, standardKeyList: Array.from(new Set(rowList.map((oneRow) => oneRow.subject_id.slice(0, oneRow.subject_id.indexOf(':'))))).sort(byCodePoint) });
	});
	const pooledUnitList = raterUserNameList.reduce((soFar, raterUserName) => soFar.concat(answerUnitListByRater[raterUserName]), []);
	const pooledRowList = pooledUnitList.reduce((soFar, oneUnit) => soFar.concat(oneUnit.rowList), []);
	censusByLayerKey[raterLayerSources.pooledLayerKey] = { ...censusFor({ answerUnitList: pooledUnitList, historyRowList, raterUserNameList, excludedUnresolvedList }), raterCount: raterUserNameList.length };
	if (pooledRowList.length > 0) {
		setTextByLayerKey[raterLayerSources.pooledLayerKey] = setTextFor({ layerKey: raterLayerSources.pooledLayerKey, versionTag, authorAgentIri: raterLayerSources.pooledAuthorAgentIri, rowList: pooledRowList, raterLayerSources });
		layerRowList.push({ layerKey: raterLayerSources.pooledLayerKey, authorAgentIri: raterLayerSources.pooledAuthorAgentIri, standardKeyList: Array.from(new Set(pooledRowList.map((oneRow) => oneRow.subject_id.slice(0, oneRow.subject_id.indexOf(':'))))).sort(byCodePoint) });
	}
	return { setTextByLayerKey, censusByLayerKey, agentRowList, layerRowList };
};

module.exports = { convertRaterStore, cardTitleOf, COLUMN_LIST, moduleName };
