'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sifReviewPage.js — THE SIF REVIEW PAGE (phase C6; plan §3 C6, SPEC §5.7 and §6 M6). App-level: it renders
// what the yardstick scorer (sifYardstickScorer.js, C5) measured, and never measures anything itself.
//
//   buildReviewPageHtml({ score, decisionBlock, questionMap, cardLabelList, pageSetting }) → { htmlText, manifest } | { error }
//   buildReviewPageFromFiles({ decisionBlockFilePath, annotationFilePath, questionMapFilePath, cardListFilePath,
//                              remodelTableFilePath, cardLabelFilePath, pageSetting }) → the same (scores through
//                              the scorer's own scoreFromFiles, so the input shas ride on the page)
//   verifySifReviewPage({ htmlText, score }) → { pass, checkList }: reads a built or a FETCHED DEPLOYED copy
//
// EVERY NUMBER on the page sits in a scoreCell span carrying data-score-path, the path of that number inside the
// score, so the verify step (and gate (a)) compares each cell with the score mechanically.
//
// TWO KINDS OF TEXT (EBONY_DREAM's ruling). The page's OWN prose (the wording table, templates, labels, the
// script) obeys SPEC §5.7: "the standard specifies X; the bridge proposed Y", never either word SPEC §2 forbids;
// the builder refuses a page whose own prose carries one. Every string taken from the standards' data (SIF
// names, descriptions and paths, CEDS domain and property names, ids) is HTML-escaped inside a
// <span data-source="standard">, and the scan skips those spans, so a CEDS name such as a "Standard Error of
// Measurement" card never makes the page refuse.
//
// LAYOUT (phase C6c, TQ 2026-09-29: "approximate" the Ed-Fi review page; its generator, buildReviewPage2.py, is only
// read). Header (judge, renderer, round from the block header), a how-to, a Details panel (how the answers are made,
// generated numbers, and the C5 score numbers), a faceted filter panel, and one collapsible block per unit: the SIF
// element beside the CEDS answer, the source text, what the standard specifies, the card chosen, the judge's
// rationale, EVERY candidate of the judge's pool as a full tuple with the pick marked, and Yes / No / Maybe / No Valid
// Candidate tags with a note. Autosave to the browser, a name gate, and Submit to the miloFeedback endpoint. Left out,
// and said so on the page: Milo's opinion (no pre-assessment was done) and Shared Ideas (the block carries no component
// ideas). The block supplies each unit's pool and the judge's answer; a unit lacking either is refused by name.
//
// CARD TUPLES (phase C6b). A card is shown as its FULL TUPLE, so a reviewer can tell apart cards that share one
// property id and differ only by qualifier: domain (id), property (id), then the range, the value and
// each qualifier as `option set = option value (id)`, where the card has them; an empty slot is omitted. The range is
// exactly one of three shapes (an option set, a scalar datatype, a class), each rendered in its own form. The label
// list (sifCardTuple.js builds it, from the hub) carries the tuple; a card whose tuple is incomplete, or whose
// qualifier has no option value name, is refused by name, so the page never shows a raw id alone. The standard's
// own id line ("the standard specifies P000577") is unchanged.
//
// FEEDBACK: tags POST to the miloFeedback endpoint at pageSetting.feedbackTargetPath (relative to the webdev
// root, as the endpoint resolves it), with the reviewer and the time appended, as the Ed-Fi review pages do. A
// per-reviewer draft lives in localStorage under pageSetting.draftStoragePrefix. Tags are keyed by the unit's
// subjectStableId plus its partition label, never by position. There is no visit beacon (the Ed-Fi review
// pages carry none).

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
const sifYardstickScorer = require(path.join(__dirname, 'sifYardstickScorer'));

// the scorer's subject prefix (sifYardstickScorer.js keeps its own copy; see the DEVLOG's traps)
const SUBJECT_STABLE_ID_PREFIX = 'sif260928:question/';
const FEEDBACK_ENDPOINT_URL = 'https://qbook.work/api/miloFeedback';
const DATA_SPAN_OPEN = '<span data-source="standard">';
const MANIFEST_TITLE = 'SIF REVIEW PAGE MANIFEST';
const FORBIDDEN_WORD_PATTERN = /error|wrong/gi;
const DATA_SPAN_PATTERN = /<span data-source="standard">[^<]*<\/span>/g;
const SCORE_CELL_PATTERN = /<span class="scoreCell" data-score-path="([^"]+)">([^<]*)<\/span>/g;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const MANIFEST_PATTERN = new RegExp(`<!--\\n${MANIFEST_TITLE}\\n([\\s\\S]*?)\\n-->`);

// every sentence and label the page prints of its own. One table, so gate (c) has one place to be broken.
const PAGE_WORDING = Object.freeze({
	populationHeading: 'Population',
	retrievalHeading: 'Retrieval',
	judgmentHeading: 'Judgment',
	perBlockHeading: 'Per shared block',
	itemsHeading: 'Each unit the bridge judged',
	unitsInBlock: 'units in the block',
	keyRemodeled: 'key-remodeled (the hub folded the standard\'s id into another)',
	scorableUnits: 'units the standard names a card for',
	recallColumnK: 'K',
	recallColumnHit: 'a card of the standard\'s id in the pool',
	capArtifactNote: (declaredKHtml) => `above the block's declared K = ${declaredKHtml}: set by the cap, not a measurement`,
	retrievedUnits: 'retrieved units',
	targetGrain: 'target grain on specified units (the bridge proposed the standard\'s card)',
	keyGrain: 'key grain on contended units (the bridge proposed a card of the standard\'s id)',
	newClaim: 'new-claim (the bridge proposed a card where the standard names none)',
	blockColumn: 'block',
	recallColumnLast: (lastKHtml) => `in pool at K = ${lastKHtml}`,
	standardSpecifiesLine: ({ standardHtml, proposedHtml }) => `the standard specifies ${standardHtml}; the bridge proposed ${proposedHtml}`,
	standardNamesNothing: 'no element for this question',
	domainSlot: 'domain',
	propertySlot: 'property',
	rangeOptionSetSlot: 'range option set',
	rangeDatatypeSlot: 'range datatype',
	rangeClassSlot: 'range class',
	valueSlot: 'value',
	qualifierSlot: 'qualifier',
	detailsHeading: 'How the answers are made',
	scoreHeading: 'The score against the standard',
	sourceHeading: 'SIF element',
	sourceRowLabel: 'SIF',
	answerRowLabel: 'CEDS',
	noneCell: 'NONE',
	declinedCell: '\u2014 the judge declined',
	pathLabel: 'path',
	fieldsLabel: 'fields in this unit',
	noMatchHeading: 'NO MATCH CHOSEN',
	declinedAllText: (poolSize) => `the judge declined all ${poolSize} candidates`,
	cardChosenHeading: 'CEDS card chosen',
	candidateOrdinalText: (ordinal, poolSize) => `candidate ${ordinal} of ${poolSize}`,
	judgeSaidLabel: 'judge said',
	judgeSettingsLabel: 'judge category',
	slateSummary: (poolSize) => `the ${poolSize} candidates the judge was choosing among`,
	pickedMark: 'picked',
	standardCardMark: 'the standard\'s card',
	subLineUnits: 'judgment units (SIF \u2192 CEDS)',
	judgeWord: 'judge',
	rendererWord: 'renderer',
	roundWord: 'round',
	hubCarriesNoCard: 'a card the hub does not carry',
	remodeledTo: 'remodeled to',
	noCardProposed: 'no card (it abstained)',
	bestRank: 'best rank of a card of the standard\'s id',
	partitionLabel: 'domain',
	sharedBlockLabel: 'block',
	tagYes: 'Yes',
	tagNo: 'No',
	tagMaybe: 'Maybe',
	tagNoValidCandidate: 'No Valid Candidate',
	notePlaceholder: 'note (optional)',
	reviewerLabel: 'Your name',
	submitLabel: 'Submit tags',
	savedLabel: 'saved',
	notSavedLabel: 'Not saved: ',
	inputsLabel: 'Scored inputs (sha256)',
});
const TAG_VALUE_LIST = Object.freeze([
	{ tagValue: 'yes', labelText: PAGE_WORDING.tagYes, labelClassName: '' },
	{ tagValue: 'no', labelText: PAGE_WORDING.tagNo, labelClassName: '' },
	{ tagValue: 'maybe', labelText: PAGE_WORDING.tagMaybe, labelClassName: '' },
	{ tagValue: 'noValidCandidate', labelText: PAGE_WORDING.tagNoValidCandidate, labelClassName: 'fourth' },
]);
const OUTCOME_NAME = Object.freeze({ picked: 'picked', abstained: 'abstained' });
const CATEGORY_NOT_JUDGED = 'notJudged';

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const unescapeHtml = (text) => text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const dataSpan = (text) => `${DATA_SPAN_OPEN}${escapeHtml(text)}</span>`;
const valueAt = (score, scorePath) => scorePath.split('.').reduce((soFar, oneSegment) => (soFar === undefined || soFar === null ? undefined : soFar[oneSegment]), score);
const scoreCell = (score, scorePath) => `<span class="scoreCell" data-score-path="${scorePath}">${valueAt(score, scorePath)}</span>`;
const itemRefOf = (unitVerdict) => (unitVerdict.judgmentPartitionLabel === null ? unitVerdict.subjectStableId : `${unitVerdict.subjectStableId}#${unitVerdict.judgmentPartitionLabel}`);

// ownProseTextOf — the page with every data span removed: what the wording rule governs
const ownProseTextOf = (htmlText) => htmlText.replace(DATA_SPAN_PATTERN, '');
const forbiddenWordHitList = (htmlText) => ownProseTextOf(htmlText).match(FORBIDDEN_WORD_PATTERN) || [];

// tupleSlotListOf — one card's tuple as an ordered slot list: domain, property, then the range in whichever of its
// THREE shapes the card carries (an option set, a scalar datatype, a class), the value, and each qualifier. The ONE
// source of both renderings below (the one-line form and the block form), so they cannot drift. A slot the card
// lacks is not in the list.
const tupleSlotListOf = ({ cardLabel, cardLabelList }) => {
	const slotList = [
		{ captionText: PAGE_WORDING.domainSlot, compactPrefixText: '', nameText: cardLabel.domainName, idText: cardLabel.domainId, definitionText: cardLabel.domainDefinition },
		{ captionText: PAGE_WORDING.propertySlot, compactPrefixText: '', nameText: cardLabel.propertyName, idText: cardLabel.propertyId, definitionText: cardLabel.propertyDefinition },
	];
	if (cardLabel.rangeOptionSetId !== undefined) {
		slotList.push({ captionText: PAGE_WORDING.rangeOptionSetSlot, compactPrefixText: `${PAGE_WORDING.rangeOptionSetSlot} `, nameText: cardLabel.rangeOptionSetName, idText: cardLabel.rangeOptionSetId, definitionText: cardLabel.rangeOptionSetDefinition });
	}
	if (cardLabel.rangeDatatype !== undefined) {
		slotList.push({ captionText: PAGE_WORDING.rangeDatatypeSlot, compactPrefixText: `${PAGE_WORDING.rangeDatatypeSlot} `, nameText: cardLabel.rangeDatatype, idText: undefined, definitionText: undefined });
	}
	if (cardLabel.rangeClassId !== undefined) {
		slotList.push({ captionText: PAGE_WORDING.rangeClassSlot, compactPrefixText: `${PAGE_WORDING.rangeClassSlot} `, nameText: cardLabel.rangeClassName, idText: cardLabel.rangeClassId, definitionText: cardLabel.rangeClassDefinition });
	}
	if (cardLabel.valueNotation !== undefined) {
		slotList.push({ captionText: PAGE_WORDING.valueSlot, compactPrefixText: `${PAGE_WORDING.valueSlot} `, nameText: cardLabel.valueName, idText: cardLabel.valueNotation, definitionText: undefined });
	}
	cardLabel.qualifierRefIdList.forEach((oneRefId) => {
		const optionValueLabel = cardLabelList.optionValueLabelByRefId[oneRefId];
		slotList.push({ captionText: PAGE_WORDING.qualifierSlot, compactPrefixText: '', nameText: `${optionValueLabel.optionSetName} = ${optionValueLabel.optionValueName}`, idText: oneRefId, definitionText: undefined });
	});
	return slotList;
};
const rangeNameOf = (cardLabel) => (cardLabel.rangeOptionSetName !== undefined ? cardLabel.rangeOptionSetName : cardLabel.rangeDatatype !== undefined ? cardLabel.rangeDatatype : cardLabel.rangeClassName);

// cardLabelHtmlOf — a card as the reviewer reads it in a line, its FULL TUPLE (phases C6b, C6c): `Domain (C…) · Property
// (P…) · range option set Set (OS…) · Type = Value (OV…)`. The block carries stableIds only; the label list carries the tuple.
const cardLabelHtmlOf = ({ cardStableId, cardLabelList }) =>
	tupleSlotListOf({ cardLabel: cardLabelList.cardLabelByStableId[cardStableId], cardLabelList })
		.map((oneSlot) => `${oneSlot.compactPrefixText}${dataSpan(oneSlot.nameText)}${oneSlot.idText === undefined ? '' : ` (${dataSpan(oneSlot.idText)})`}`)
		.join(' · ');

// cardBlockHtmlOf — the same tuple as a block, one slot per row with its definition where the hub has one
const cardBlockHtmlOf = ({ cardStableId, cardLabelList, classText }) =>
	`<div class="${classText}">${tupleSlotListOf({ cardLabel: cardLabelList.cardLabelByStableId[cardStableId], cardLabelList })
		.map((oneSlot) => `<div class="slot"><span class="sl">${oneSlot.captionText}</span><b>${dataSpan(oneSlot.nameText)}</b>${oneSlot.idText === undefined ? '' : ` <span class="cid">(${dataSpan(oneSlot.idText)})</span>`}${oneSlot.definitionText === undefined ? '' : `<div class="d">${dataSpan(oneSlot.definitionText)}</div>`}</div>`)
		.join('')}</div>`;

// cardLabelFaultOf — why a card cannot be shown as a tuple, or null: the label list is where data enters, so each
// slot the tuple prints must be present, the range must be stated in exactly one of its three shapes, and each
// qualifier must resolve to its human label
const cardLabelFaultOf = ({ cardStableId, cardLabelList }) => {
	const cardLabel = cardLabelList.cardLabelByStableId[cardStableId];
	if (cardLabel === undefined) {
		return 'has no entry in the card label list';
	}
	const absentSlotName = ['domainId', 'domainName', 'propertyId', 'propertyName'].find((oneSlotName) => typeof cardLabel[oneSlotName] !== 'string' || cardLabel[oneSlotName] === '');
	if (absentSlotName !== undefined) {
		return `has a card label list entry with no ${absentSlotName}`;
	}
	const rangeShapeNameList = ['rangeOptionSetId', 'rangeDatatype', 'rangeClassId'].filter((oneShapeName) => cardLabel[oneShapeName] !== undefined);
	if (rangeShapeNameList.length !== 1) {
		return `carries ${rangeShapeNameList.length} range shapes in the card label list (${rangeShapeNameList.join(', ') || 'none'}); a range is exactly one of an option set, a datatype or a class`;
	}
	if (rangeNameOf(cardLabel) === undefined || rangeNameOf(cardLabel) === '') {
		return `has ${rangeShapeNameList[0]} with no name in the card label list`;
	}
	if (cardLabel.valueNotation !== undefined && !cardLabel.valueName) {
		return `has value ${cardLabel.valueNotation} with no name in the card label list`;
	}
	const unresolvedRefId = cardLabel.qualifierRefIdList.find((oneRefId) => !cardLabelList.optionValueLabelByRefId[oneRefId] || !cardLabelList.optionValueLabelByRefId[oneRefId].optionSetName || !cardLabelList.optionValueLabelByRefId[oneRefId].optionValueName);
	if (unresolvedRefId !== undefined) {
		return `carries qualifier ${unresolvedRefId} with no label in the card label list`;
	}
	return null;
};

// recordByItemRefOf — the block's records by unit, the same key the items carry
const recordByItemRefOf = (decisionBlock) => {
	const recordByItemRef = {};
	decisionBlock.decisionRecordList.forEach((oneRecord) => {
		recordByItemRef[itemRefOf({ subjectStableId: oneRecord.subjectStableId, judgmentPartitionLabel: oneRecord.judgmentPartitionLabel === undefined ? null : oneRecord.judgmentPartitionLabel })] = oneRecord;
	});
	return recordByItemRef;
};

// blockFaultOf — where the block meets the page: each unit needs its record, the record its pool as the judge saw it, the
// proposed card must be in that pool, and on a scored block the judge's answer (rationale, category)
const blockFaultOf = ({ unitVerdictList, recordByItemRef, judgmentScored }) => {
	for (let unitIndex = 0; unitIndex < unitVerdictList.length; unitIndex++) {
		const unitVerdict = unitVerdictList[unitIndex];
		const record = recordByItemRef[itemRefOf(unitVerdict)];
		if (record === undefined) {
			return { subjectStableId: unitVerdict.subjectStableId, faultText: 'has no record in the decision block' };
		}
		if (!Array.isArray(record.renderedPoolStableIdList) || record.renderedPoolStableIdList.length === 0) {
			return { subjectStableId: unitVerdict.subjectStableId, faultText: 'has a record with no rendered pool' };
		}
		if (unitVerdict.proposedCardStableId !== null && record.renderedPoolStableIdList.indexOf(unitVerdict.proposedCardStableId) === -1) {
			return { subjectStableId: unitVerdict.subjectStableId, faultText: `has a proposed card (${unitVerdict.proposedCardStableId}) that is not in its rendered pool` };
		}
		if (judgmentScored && (record.judge === undefined || typeof record.judge.rationale !== 'string' || typeof record.judge.category !== 'string')) {
			return { subjectStableId: unitVerdict.subjectStableId, faultText: 'has a record with no judge rationale or category' };
		}
	}
	return null;
};

// the one edge where the label list meets the block: every card the page names (the proposed card, the standard's
// cards, every candidate in the judge's pool) must carry a whole tuple
const unlabelledCardOf = ({ unitVerdictList, recordByItemRef, cardLabelList }) => {
	for (let unitIndex = 0; unitIndex < unitVerdictList.length; unitIndex++) {
		const unitVerdict = unitVerdictList[unitIndex];
		const shownCardStableIdList = [unitVerdict.proposedCardStableId].concat(unitVerdict.keyCardStableIdList || [], recordByItemRef[itemRefOf(unitVerdict)].renderedPoolStableIdList).filter((oneStableId) => oneStableId !== null);
		for (let shownIndex = 0; shownIndex < shownCardStableIdList.length; shownIndex++) {
			const faultText = cardLabelFaultOf({ cardStableId: shownCardStableIdList[shownIndex], cardLabelList });
			if (faultText !== null) {
				return { cardStableId: shownCardStableIdList[shownIndex], subjectStableId: unitVerdict.subjectStableId, faultText };
			}
		}
	}
	return null;
};

const pageSettingFaultOf = (pageSetting) => {
	if (typeof pageSetting.feedbackTargetPath !== 'string' || !/^[^/].*\.json$/.test(pageSetting.feedbackTargetPath)) {
		return `pageSetting.feedbackTargetPath '${pageSetting.feedbackTargetPath}' is not a relative path ending .json`;
	}
	if (typeof pageSetting.draftStoragePrefix !== 'string' || pageSetting.draftStoragePrefix === '') {
		return 'pageSetting.draftStoragePrefix is absent';
	}
	if (typeof pageSetting.pageTitle !== 'string' || pageSetting.pageTitle === '') {
		return 'pageSetting.pageTitle is absent';
	}
	if (!Number.isInteger(pageSetting.roundNumber) || pageSetting.roundNumber < 1) {
		return `pageSetting.roundNumber '${pageSetting.roundNumber}' is not a whole number of at least 1`;
	}
	return null;
};

const summaryHtmlOf = ({ score }) => {
	const partList = [];
	partList.push(`<section id="population"><h2>${PAGE_WORDING.populationHeading}</h2><ul>`);
	partList.push(`<li>${PAGE_WORDING.unitsInBlock}: ${scoreCell(score, 'population.unitCount')}</li>`);
	Object.keys(score.population.standingCountByName).forEach((oneStanding) => partList.push(`<li>${oneStanding}: ${scoreCell(score, `population.standingCountByName.${oneStanding}`)}</li>`));
	partList.push(`<li>${PAGE_WORDING.keyRemodeled}: ${scoreCell(score, 'population.keyRemodeledCount')}${score.population.keyRemodeledIdList.map((oneId) => ` ${dataSpan(oneId)}`).join('')}</li>`);
	partList.push('</ul></section>');

	partList.push(`<section id="retrieval"><h2>${PAGE_WORDING.retrievalHeading}</h2>`);
	partList.push(`<p>${sifYardstickScorer.REPORT_WORDING.classNotRetrieved}: ${scoreCell(score, 'retrieval.notRetrievedCount')} of ${scoreCell(score, 'retrieval.scorableCount')} ${PAGE_WORDING.scorableUnits}</p>`);
	partList.push(`<table><tr><th>${PAGE_WORDING.recallColumnK}</th><th>${PAGE_WORDING.recallColumnHit}</th></tr>`);
	score.retrieval.recallByK.forEach((oneRow, rowIndex) => partList.push(`<tr><td>${scoreCell(score, `retrieval.recallByK.${rowIndex}.k`)}</td><td>${scoreCell(score, `retrieval.recallByK.${rowIndex}.hitCount`)} / ${scoreCell(score, `retrieval.recallByK.${rowIndex}.scorableCount`)}${oneRow.aboveDeclaredK ? ` <small>(${PAGE_WORDING.capArtifactNote(scoreCell(score, 'declaredK'))})</small>` : ''}</td></tr>`));
	partList.push('</table></section>');

	partList.push(`<section id="judgment"><h2>${PAGE_WORDING.judgmentHeading}</h2>`);
	if (!score.judgment.scored) {
		partList.push(`<p class="unscored">${score.judgment.statusText}</p>`);
	} else {
		partList.push(`<p>${PAGE_WORDING.retrievedUnits}: ${scoreCell(score, 'judgment.retrievedCount')}</p><ul>`);
		sifYardstickScorer.JUDGMENT_CLASS_LIST.forEach((oneClass) => partList.push(`<li>${oneClass}: ${scoreCell(score, `judgment.countByClass.${oneClass}`)}</li>`));
		partList.push(`<li>${PAGE_WORDING.targetGrain}: ${scoreCell(score, 'judgment.targetGrainOnSpecified.agreesTargetCount')} of ${scoreCell(score, 'judgment.targetGrainOnSpecified.retrievedCount')}</li>`);
		partList.push(`<li>${PAGE_WORDING.keyGrain}: ${scoreCell(score, 'judgment.keyGrainOnContended.agreesKeyGrainCount')} of ${scoreCell(score, 'judgment.keyGrainOnContended.retrievedCount')}</li>`);
		partList.push(`<li>${PAGE_WORDING.newClaim}: ${scoreCell(score, 'judgment.newClaimCount')}</li></ul>`);
	}
	partList.push('</section>');

	const lastRecallIndex = score.retrieval.recallByK.length - 1;
	partList.push(`<section id="perBlock"><h2>${PAGE_WORDING.perBlockHeading}</h2><table><tr><th>${PAGE_WORDING.blockColumn}</th><th>${PAGE_WORDING.unitsInBlock}</th><th>${sifYardstickScorer.REPORT_WORDING.classNotRetrieved}</th><th>${PAGE_WORDING.recallColumnLast(scoreCell(score, `retrieval.recallByK.${lastRecallIndex}.k`))}</th>${sifYardstickScorer.JUDGMENT_CLASS_LIST.map((oneClass) => `<th>${oneClass}</th>`).join('')}<th>${sifYardstickScorer.REPORT_WORDING.classNewClaim}</th></tr>`);
	score.bySharedBlock.forEach((oneBlock, blockIndex) => {
		const blockPath = `bySharedBlock.${blockIndex}`;
		const judgmentCellList = oneBlock.judgment.scored
			? sifYardstickScorer.JUDGMENT_CLASS_LIST.map((oneClass) => scoreCell(score, `${blockPath}.judgment.countByClass.${oneClass}`)).concat([scoreCell(score, `${blockPath}.judgment.newClaimCount`)])
			: sifYardstickScorer.JUDGMENT_CLASS_LIST.concat([sifYardstickScorer.REPORT_WORDING.classNewClaim]).map(() => oneBlock.judgment.statusText);
		partList.push(`<tr><td>${dataSpan(oneBlock.sharedBlock)}</td><td>${scoreCell(score, `${blockPath}.population.unitCount`)}</td><td>${scoreCell(score, `${blockPath}.retrieval.notRetrievedCount`)}</td><td>${scoreCell(score, `${blockPath}.retrieval.recallByK.${lastRecallIndex}.hitCount`)} / ${scoreCell(score, `${blockPath}.retrieval.recallByK.${lastRecallIndex}.scorableCount`)}</td>${judgmentCellList.map((oneCell) => `<td>${oneCell}</td>`).join('')}</tr>`);
	});
	partList.push('</table></section>');
	return partList.join('\n');
};

// standardHtmlOf — the X of "the standard specifies X", by the unit's standing
const standardHtmlOf = ({ unitVerdict, cardLabelList }) => {
	if (unitVerdict.standing === sifYardstickScorer.REPORT_WORDING.standingUnannotated) {
		return PAGE_WORDING.standardNamesNothing;
	}
	const idHtml = `${dataSpan(unitVerdict.cedsElementId)}${unitVerdict.remodeledToCedsElementId === null ? '' : ` (${PAGE_WORDING.remodeledTo} ${dataSpan(unitVerdict.remodeledToCedsElementId)})`}`;
	if (unitVerdict.standing === sifYardstickScorer.REPORT_WORDING.standingKeyWithoutCard) {
		return `${idHtml} (${PAGE_WORDING.hubCarriesNoCard})`;
	}
	const shownCardStableIdList = unitVerdict.targetCardStableId ? [unitVerdict.targetCardStableId] : unitVerdict.keyCardStableIdList;
	return `${idHtml} (${shownCardStableIdList.map((oneStableId) => cardLabelHtmlOf({ cardStableId: oneStableId, cardLabelList })).join('; ')})`;
};

// itemHtmlOf — one unit, laid out as the Ed-Fi review page lays out an answer: a collapsible block whose summary
// puts the SIF element and the CEDS answer side by side; inside, the source text, what the standard specifies,
// the card chosen as a full tuple, the judge's rationale, every candidate in the judge's pool as a full tuple, and
// the tags.
const itemHtmlOf = ({ score, unitVerdict, unitIndex, question, record, cardLabelList }) => {
	const itemRef = itemRefOf(unitVerdict);
	const cardLabelByStableId = cardLabelList.cardLabelByStableId;
	const classText = unitVerdict.judgmentClass !== undefined ? unitVerdict.judgmentClass : unitVerdict.newClaim ? sifYardstickScorer.REPORT_WORDING.classNewClaim : unitVerdict.standing;
	const outcomeText = unitVerdict.proposedCardStableId === null ? OUTCOME_NAME.abstained : OUTCOME_NAME.picked;
	const judge = record.judge;
	const categoryText = judge === undefined ? CATEGORY_NOT_JUDGED : judge.category;
	const poolStableIdList = record.renderedPoolStableIdList;
	const standardCardStableIdList = unitVerdict.targetCardStableId ? [unitVerdict.targetCardStableId] : unitVerdict.keyCardStableIdList || [];
	const proposedHtml = unitVerdict.proposedCardStableId === null ? PAGE_WORDING.noCardProposed : cardLabelHtmlOf({ cardStableId: unitVerdict.proposedCardStableId, cardLabelList });
	const unitPlaceText = unitVerdict.judgmentPartitionLabel === null ? unitVerdict.sharedBlock : unitVerdict.judgmentPartitionLabel;

	const sourceCellHtmlList = [`${dataSpan(unitPlaceText)}.`, dataSpan(question.name)];
	const answerCellHtmlList = unitVerdict.proposedCardStableId === null
		? [PAGE_WORDING.noneCell, PAGE_WORDING.declinedCell]
		: [`${dataSpan(cardLabelByStableId[unitVerdict.proposedCardStableId].domainName)}.`, `${dataSpan(cardLabelByStableId[unitVerdict.proposedCardStableId].propertyName)}.`, dataSpan(rangeNameOf(cardLabelByStableId[unitVerdict.proposedCardStableId]))];
	const gridHtml = `<span class="tgrid"><span class="rl">${PAGE_WORDING.sourceRowLabel}</span>${sourceCellHtmlList.map((oneCell) => `<code class="dc src">${oneCell}</code>`).join('')}<span></span>`
		+ `<span class="rl">${PAGE_WORDING.answerRowLabel}</span>${answerCellHtmlList.map((oneCell) => `<code class="dc pic${unitVerdict.proposedCardStableId === null ? ' abst' : ''}">${oneCell}</code>`).join('')}</span>`;
	const badgeHtml = `<span class="badges"><span class="bdg kind">${classText}</span><span class="bdg">${unitVerdict.standing}</span></span>`;

	const sourceHtml = `<div class="srcbox"><div class="ph">${PAGE_WORDING.sourceHeading} <span class="ptype">${dataSpan(question.objectNameList.join(', '))}</span></div>`
		+ `<div class="d">${question.description === undefined ? '' : dataSpan(question.description)}</div>`
		+ `<div class="ideas"><span class="lbl">${PAGE_WORDING.pathLabel}</span>${dataSpan(question.relativePath)} <span class="lbl">${PAGE_WORDING.sharedBlockLabel}</span>${dataSpan(unitVerdict.sharedBlock)}${unitVerdict.judgmentPartitionLabel === null ? '' : ` <span class="lbl">${PAGE_WORDING.partitionLabel}</span>${dataSpan(unitVerdict.judgmentPartitionLabel)}`} <span class="lbl">${PAGE_WORDING.fieldsLabel}</span>${dataSpan(record.instanceStableIdList.length)}</div></div>`;
	const lineHtml = `<p class="line">${PAGE_WORDING.standardSpecifiesLine({ standardHtml: standardHtmlOf({ unitVerdict, cardLabelList }), proposedHtml })}</p>`;
	const pickHtml = unitVerdict.proposedCardStableId === null
		? `<div class="pickbox abst"><div class="ph">${PAGE_WORDING.noMatchHeading}</div><div class="d">${PAGE_WORDING.declinedAllText(poolStableIdList.length)}</div></div>`
		: `<div class="pickbox"><div class="ph">${PAGE_WORDING.cardChosenHeading} <span class="cat">${dataSpan(categoryText)}</span> <span class="ord">${PAGE_WORDING.candidateOrdinalText(poolStableIdList.indexOf(unitVerdict.proposedCardStableId) + 1, poolStableIdList.length)}</span></div>${cardBlockHtmlOf({ cardStableId: unitVerdict.proposedCardStableId, cardLabelList, classText: 'card' })}</div>`;
	const judgeHtml = judge === undefined ? '' : `<div class="jr"><span class="lbl">${PAGE_WORDING.judgeSaidLabel}</span>${dataSpan(judge.rationale)}</div>`
		+ `<div class="jr"><span class="lbl">${PAGE_WORDING.judgeSettingsLabel}</span>${dataSpan(`${categoryText}${typeof record.confidence === 'number' ? `, confidence ${record.confidence}` : ''}${record.predicate ? `, ${record.predicate}` : ''}`)}</div>`;
	const slateHtml = `<details class="slate"><summary>${PAGE_WORDING.slateSummary(poolStableIdList.length)}</summary>${poolStableIdList.map((oneStableId, poolIndex) => {
		const isPick = oneStableId === unitVerdict.proposedCardStableId;
		const isStandardCard = standardCardStableIdList.indexOf(oneStableId) !== -1;
		return `<div class="alt"><span class="ordn">${poolIndex + 1}</span><div class="altbody"><div class="altline"><code class="dc alt">${cardLabelHtmlOf({ cardStableId: oneStableId, cardLabelList })}</code>${isPick ? `<span class="bdg mark">${PAGE_WORDING.pickedMark}</span>` : ''}${isStandardCard ? `<span class="bdg kind">${PAGE_WORDING.standardCardMark}</span>` : ''}</div>${cardBlockHtmlOf({ cardStableId: oneStableId, cardLabelList, classText: 'card mini' })}</div></div>`;
	}).join('')}</details>`;
	const rankHtml = unitVerdict.bestKeyRank !== undefined && unitVerdict.bestKeyRank !== null ? `<p class="rank">${PAGE_WORDING.bestRank}: ${scoreCell(score, `unitVerdictList.${unitIndex}.bestKeyRank`)}</p>` : '';
	const tagsHtml = `<div class="tags">\n${TAG_VALUE_LIST.map((oneTag) => ` <label${oneTag.labelClassName === '' ? '' : ` class="${oneTag.labelClassName}"`}><input type="radio" name="t_${escapeHtml(itemRef)}" value="${oneTag.tagValue}"> ${oneTag.labelText}</label>`).join('\n')}\n <input class="note" type="text" name="n_${escapeHtml(itemRef)}" placeholder="${PAGE_WORDING.notePlaceholder}" value="">\n</div>`;
	return {
		itemHtml: `<article class="item" data-item-ref="${escapeHtml(itemRef)}" data-unit-class="${classText}" data-outcome="${outcomeText}" data-cat="${escapeHtml(categoryText)}">\n<details class="outer" open>\n<summary class="osum"><span class="num">${unitIndex + 1}</span>\n${gridHtml}\n${badgeHtml}</summary>\n<div class="body">\n${sourceHtml}\n${lineHtml}\n${pickHtml}\n${judgeHtml}\n${rankHtml}\n${slateHtml}\n${tagsHtml}\n</div></details></article>`,
		facetState: { outcome: outcomeText, cat: categoryText, unitclass: classText },
	};
};

// the facet boxes, as data: a group per facet, its boxes by value. The review facet is counted in the browser; a
// box whose value no unit carries is not shown.
const FACET_GROUP_LIST = Object.freeze([
	{ facetName: 'outcome', caption: 'outcome', boxList: [[OUTCOME_NAME.picked, 'matched'], [OUTCOME_NAME.abstained, 'abstained']] },
	{ facetName: 'cat', caption: 'judge category', boxList: [['strong', 'strong'], ['moderate', 'moderate'], ['weakButReal', 'weak but real'], ['none', 'none (abstained)'], [CATEGORY_NOT_JUDGED, 'not judged']] },
	{ facetName: 'unitclass', caption: 'against the standard', boxList: null },
	{ facetName: 'review', caption: 'your review', boxList: [['untagged', 'not yet'], ['tagged', 'tagged'], ['noted', 'has a note']] },
]);
const facetPanelHtmlOf = ({ facetStateList }) => FACET_GROUP_LIST.map((oneGroup) => {
	const boxList = oneGroup.boxList === null ? Array.from(new Set(facetStateList.map((oneState) => oneState[oneGroup.facetName]))).sort().map((oneValue) => [oneValue, oneValue]) : oneGroup.boxList;
	const boxHtmlList = boxList.map(([oneValue, captionText]) => {
		const boxCount = oneGroup.facetName === 'review' ? null : facetStateList.filter((oneState) => oneState[oneGroup.facetName] === oneValue).length;
		return boxCount === 0 ? '' : `  <label><input type="checkbox" data-facet="${oneGroup.facetName}" value="${escapeHtml(oneValue)}"> ${escapeHtml(captionText)}${boxCount === null ? '' : ` <span class="fcount">${boxCount}</span>`}</label>\n`;
	}).join('');
	return ` <div class="fgroup"><span class="fname">${oneGroup.caption}</span>\n${boxHtmlList} </div>\n`;
}).join('');

// RETRIEVAL_PROSE_REGISTRY — how each declared retrieval method is described. A method with no entry is refused by
// name: the Details prose must say what the block actually declares
const RETRIEVAL_PROSE_REGISTRY = Object.freeze({
	'embedTextVote-v1': ({ retrieval }) => {
		const missingName = ['k', 'hitsPerText', 'minScore', 'embeddingModelVersion'].find((oneName) => retrieval[oneName] === undefined || retrieval[oneName] === null);
		if (missingName !== undefined) {
			return { missingName };
		}
		return { html: `<p>For one unit, the bridge compares the text of the SIF element with the texts the hub keeps for its cards (the text of a property, of its option set, or of its class), by embedding similarity (${dataSpan(retrieval.embeddingModelVersion)}). Each near text votes for the cards it belongs to. Up to ${escapeHtml(retrieval.hitsPerText)} near texts are read for each text, nothing below ${escapeHtml(retrieval.minScore)} similarity is kept, and up to ${escapeHtml(retrieval.k)} cards go to the judge. This step has no opinion about meaning; it narrows the whole hub to a short list. <span class="fine">Code fact: the method name and these settings are the block's own header. Not verified by me: the exact rule that turns votes into the list, so the description of voting is a code estimation from the block's per-card vote records.</span></p>` };
	},
});

// detailsHtmlOf — what the Details panel says, with the numbers generated from the block's header and the score
const detailsHtmlOf = ({ score, decisionBlock, recordByItemRef, questionMap }) => {
	const header = decisionBlock.header;
	const retrievalProse = RETRIEVAL_PROSE_REGISTRY[header.candidateRetrieval && header.candidateRetrieval.method];
	if (retrievalProse === undefined) {
		return { error: refuse.byName({ moduleName, what: `the block declares candidate retrieval method '${header.candidateRetrieval && header.candidateRetrieval.method}', which the Details prose has no description for`, where: 'RETRIEVAL_PROSE_REGISTRY names the methods the page can describe; the Details panel says what the block declares' }) };
	}
	const retrievalDescribed = retrievalProse({ retrieval: header.candidateRetrieval });
	if (retrievalDescribed.missingName !== undefined) {
		return { error: refuse.byName({ moduleName, what: `the block's candidateRetrieval declares no ${retrievalDescribed.missingName}`, where: 'the Details prose states the retrieval settings from the block header; none has a default' }) };
	}
	const absentHeaderName = ['judgeKind', 'rendererVersion'].find((oneName) => typeof header[oneName] !== 'string' || header[oneName] === '');
	if (absentHeaderName !== undefined) {
		return { error: refuse.byName({ moduleName, what: `the block header names no ${absentHeaderName}`, where: 'the page header and the Details panel name the judge and the renderer from the block header; none has a default' }) };
	}
	const unitCount = score.unitVerdictList.length;
	const recordList = score.unitVerdictList.map((oneVerdict) => recordByItemRef[itemRefOf(oneVerdict)]);
	const poolInIdentifierOrderCount = recordList.filter((oneRecord) => JSON.stringify(oneRecord.renderedPoolStableIdList) === JSON.stringify(oneRecord.renderedPoolStableIdList.slice().sort())).length;
	const unpartitionedCount = score.unitVerdictList.filter((oneVerdict) => oneVerdict.judgmentPartitionLabel === null).length;
	const subjectCount = new Set(score.unitVerdictList.map((oneVerdict) => oneVerdict.subjectStableId)).size;
	const detailsHtml = [
		`<h2>${PAGE_WORDING.detailsHeading}</h2>`,
		`<p><b>The bridge maps SIF elements onto CEDS cards automatically.</b> ${unitCount} judgment units were judged, from ${subjectCount} SIF elements. For each unit the judge chose one candidate card or none. Every judgment carries the judge's reasoning and the candidates it chose among.</p>`,
		'<h3>Units</h3>',
		`<p>A SIF element is read as a <b>question</b>: it stands for every field that carries the same name, description and path, and one question can sit in several objects (a Student record and a Staff record, say). The bridge judges one unit per question and per CEDS domain of the objects the fields sit in, so an element that means different things in different places gets a separate answer for each. ${unpartitionedCount} of the ${unitCount} units carry no domain: a shared block that a declared rule makes one unit. The answer to a unit goes only to the fields in that unit. <span class="fine">Code fact: the partition rule, from the bridge framework's partition module; the field count on each item is the unit's own share.</span></p>`,
		'<h3>Retrieve</h3>',
		retrievalDescribed.html,
		'<h3>Judge</h3>',
		`<p>The judge is ${dataSpan(header.judgeKind)}. It is told to choose ONE of the candidates by figuring out which one matches the <i>meaning</i> of the SIF element and best represents its context, weighing details and data type as well as the domain the candidate belongs to. It sorts the candidates by closeness to the source, reviews that order again, and answers with the candidate's index number, or with NONE: abstaining is described to it as a correct and expected answer. It must also write a short rationale. <span class="fine">Code fact: from the bridge framework's prompt text. Not verified by me: which fields of each candidate the judge saw for SIF, which the bridge's declaration sets; this page shows every field the hub holds for the card.</span></p>`,
		`<p>The candidates reach the judge in a fixed order (by identifier) and with no scores or votes, so that the order says nothing about the retrieval. Measured on this block: ${poolInIdentifierOrderCount} of ${unitCount} pools are in identifier order.</p>`,
		'<h3>Record</h3>',
		`<p>Each judgment is stored with its rationale, a category (strong, moderate, weak but real, or none when it abstained), a confidence, the match predicate, the candidate pool as rendered, the fields of the unit, and a hash of the prompt.</p>`,
		'<h3>What this page leaves out</h3>',
		`<p><b>Milo's opinion</b> is left out: no pre-assessment of the SIF answers was done (an economy ruling). <b>Shared Ideas</b> and the overlap flag are left out: the SIF decision block carries no component ideas. The source panel shows the standard's own text for the element (its name, path, description and objects), <b>not the prompt as rendered</b>: the block keeps a hash of the prompt, not its text. The per-card retrieval votes are kept in the block and are not shown here.</p>`,
		`<h3>The runs</h3>`,
		`<table id="runTable"><tr><th>judge</th><th>renderer</th><th>retrieval</th><th>units</th></tr><tr><td>${dataSpan(header.judgeKind)}</td><td>${dataSpan(header.rendererVersion)}</td><td>${dataSpan(header.candidateRetrieval.method)}</td><td>${unitCount}</td></tr></table>`,
		`<h3>${PAGE_WORDING.scoreHeading}</h3>`,
		`<p>SIF's own annotation names a CEDS element for many fields. Each unit's answer is compared with it, and the numbers below are measured from the block, never typed in. <span class="fine">Each item also states what the standard specifies, so you can see the comparison for that unit.</span></p>`,
		summaryHtmlOf({ score }),
	].join('\n');
	return { detailsHtml, questionMap };
};

const HOW_TO_HTML = ({ unitCount, retrievalK }) => `<div class="note-box"><b>How to use this page</b><br><br>`
	+ `This page shows the SIF elements the bridge judged, ${unitCount} judgment units in all, each against the CEDS cards the judge could choose from (up to ${retrievalK} candidates per unit). A unit is one SIF element in one CEDS domain. The <b>Details</b> button explains how the answers are made and carries the score numbers.<br><br>`
	+ `Each item shows the SIF element's own text, what the standard specifies for it, the card the judge chose as a full CEDS tuple (domain, property, range, and any qualifier, each with its id and definition), the judge's rationale, and every candidate the judge was choosing among.<br><br>`
	+ `<b>Tag it</b>: Yes, No or Maybe for the bridge's answer, or No Valid Candidate when none of the candidates is right. The note is optional.<br><br>`
	+ `<b>Filters</b> &rarr; many are provided to allow you to examine the mappings in many ways.<br><br>`
	+ `Your choices save to this browser automatically. Submit often so your work is not lost.<br><br>`
	+ `There is no Milo opinion on this page: no pre-assessment of the SIF answers was done (an economy ruling).<br><br>`
	+ `<button id="algoBtn" class="info">Details: how the answers are made, and the score</button></div>`;

// the page's script: browser code, so async/await and try/catch are the house form here (browserCodePractices §1)
const pageScriptOf = ({ score, pageSetting, itemCount }) => `
const FEEDBACK_ENDPOINT_URL=${JSON.stringify(FEEDBACK_ENDPOINT_URL)};
const FEEDBACK_TARGET_PATH=${JSON.stringify(pageSetting.feedbackTargetPath)};
const DRAFT_STORAGE_PREFIX=${JSON.stringify(pageSetting.draftStoragePrefix)};
const REVIEWER_STORE_NAME=DRAFT_STORAGE_PREFIX+'reviewer';
const ITEM_COUNT=${itemCount};
const ROUND_NUMBER=${pageSetting.roundNumber};
const SCORE_GENERATION=${JSON.stringify(score.generation)};
const INPUT_SHA256_BY_ROLE=${JSON.stringify(score.inputFileSha256ByRole || {})};
function reviewerName(){try{return localStorage.getItem(REVIEWER_STORE_NAME)||'';}catch(storageFault){return '';}}
function draftStoreName(){return DRAFT_STORAGE_PREFIX+'draft::'+(reviewerName()||'anonymous');}
const allItems=()=>document.querySelectorAll('article.item');
function collectTags(){const tagByItemRef={};allItems().forEach(oneItem=>{
 const checkedRadio=oneItem.querySelector('input[type=radio]:checked');const noteBox=oneItem.querySelector('input.note');
 if(checkedRadio||(noteBox&&noteBox.value)){tagByItemRef[oneItem.dataset.itemRef]={tag:checkedRadio?checkedRadio.value:null,note:noteBox?noteBox.value:'',unitClass:oneItem.dataset.unitClass};}});
 return tagByItemRef;}
function saveDraft(){try{localStorage.setItem(draftStoreName(),JSON.stringify(collectTags()));}catch(storageFault){}}
function restoreDraft(){let draftByItemRef={};try{draftByItemRef=JSON.parse(localStorage.getItem(draftStoreName())||'{}');}catch(storageFault){draftByItemRef={};}
 allItems().forEach(oneItem=>{
  oneItem.querySelectorAll('input[type=radio]').forEach(oneRadio=>{oneRadio.checked=false;});
  const noteBox=oneItem.querySelector('input.note');if(noteBox){noteBox.value='';}
  const draft=draftByItemRef[oneItem.dataset.itemRef];if(!draft){return;}
  if(draft.tag){const radio=oneItem.querySelector('input[type=radio][value="'+draft.tag+'"]');if(radio){radio.checked=true;}}
  if(noteBox&&draft.note){noteBox.value=draft.note;}});}
function showTally(){let taggedCount=0;allItems().forEach(oneItem=>{const isTagged=!!oneItem.querySelector('input[type=radio]:checked');if(isTagged){taggedCount+=1;}oneItem.classList.toggle('tagged',isTagged);});
 document.getElementById('count').textContent=taggedCount+' of '+ITEM_COUNT+' tagged';}

// ---- FILTERS: boxes inside a group are OR'd, groups are AND'd; a group with no box checked constrains nothing ----
const filterButton=document.getElementById('filterBtn');
function applyFilters(){const wanted={};
 document.querySelectorAll('.filters input[type=checkbox]:checked').forEach(oneBox=>{(wanted[oneBox.dataset.facet]=wanted[oneBox.dataset.facet]||[]).push(oneBox.value);});
 let shownCount=0;
 allItems().forEach(oneItem=>{
  const isTagged=!!oneItem.querySelector('input[type=radio]:checked');const isNoted=!!(oneItem.querySelector('input.note')||{}).value;
  const state={outcome:oneItem.dataset.outcome,cat:oneItem.dataset.cat,unitclass:oneItem.dataset.unitClass,review:[isTagged?'tagged':'untagged'].concat(isNoted?['noted']:[])};
  const isShown=Object.entries(wanted).every(([facetName,valueList])=>{const have=state[facetName];return Array.isArray(have)?valueList.some(oneValue=>have.includes(oneValue)):valueList.includes(have);});
  oneItem.classList.toggle('hidden',!isShown);if(isShown){shownCount+=1;}});
 const checkedCount=document.querySelectorAll('.filters input[type=checkbox]:checked').length;
 document.getElementById('shown').textContent=checkedCount?shownCount+' of '+ITEM_COUNT+' shown':'';
 filterButton.textContent=checkedCount?'Filters ('+checkedCount+')':'Filters';filterButton.classList.toggle('on',checkedCount>0);}
const filterPanel=document.getElementById('filterPanel');const detailsPanel=document.getElementById('algoPanel');
filterButton.addEventListener('click',()=>{filterPanel.hidden=!filterPanel.hidden;});
document.getElementById('closeFilters').addEventListener('click',()=>{filterPanel.hidden=true;});
document.getElementById('clearFilters').addEventListener('click',()=>{document.querySelectorAll('.filters input[type=checkbox]').forEach(oneBox=>{oneBox.checked=false;});applyFilters();});
document.getElementById('algoBtn').addEventListener('click',()=>{detailsPanel.hidden=false;});
document.getElementById('closeAlgo').addEventListener('click',()=>{detailsPanel.hidden=true;});
detailsPanel.addEventListener('click',clickEvent=>{if(clickEvent.target===detailsPanel){detailsPanel.hidden=true;}});
const filterCard=document.getElementById('filterCard');
document.addEventListener('click',clickEvent=>{if(filterPanel.hidden){return;}if(filterCard.contains(clickEvent.target)||filterButton.contains(clickEvent.target)){return;}filterPanel.hidden=true;});
document.addEventListener('keydown',keyEvent=>{if(keyEvent.key==='Escape'){filterPanel.hidden=true;detailsPanel.hidden=true;}});
document.querySelectorAll('.filters input[type=checkbox]').forEach(oneBox=>oneBox.addEventListener('change',applyFilters));
document.getElementById('collapseAll').addEventListener('click',()=>{document.querySelectorAll('details.outer, details.slate').forEach(oneFold=>{oneFold.open=false;});});
document.getElementById('expandAll').addEventListener('click',()=>{document.querySelectorAll('details.outer').forEach(oneFold=>{oneFold.open=true;});});

// ---- REVIEWER IDENTITY: asked once per browser, kept in localStorage; it rides on every submission and is a label, not a login ----
function setReviewerName(nameText){try{localStorage.setItem(REVIEWER_STORE_NAME,nameText);}catch(storageFault){}document.getElementById('whoName').textContent=nameText;restoreDraft();showTally();applyFilters();}
function askReviewerName(existingName){
 const gate=document.createElement('div');gate.id='nameGate';
 gate.innerHTML='<div id="nameCard"><h2>Who is reviewing?</h2><p>Your name rides along with the tags you submit, so several people can review the same round.</p><input id="nameInput" placeholder="your name"><button id="nameGo">Start reviewing</button></div>';
 document.body.appendChild(gate);
 const nameInput=gate.querySelector('input');nameInput.value=existingName||'';
 const goOn=()=>{const nameText=nameInput.value.trim();if(!nameText){nameInput.focus();return;}setReviewerName(nameText);gate.remove();};
 gate.querySelector('button').addEventListener('click',goOn);
 nameInput.addEventListener('keydown',keyEvent=>{if(keyEvent.key==='Enter'){goOn();}});nameInput.focus();}
document.getElementById('changeName').addEventListener('click',clickEvent=>{clickEvent.preventDefault();askReviewerName(reviewerName());});
document.addEventListener('change',()=>{saveDraft();showTally();applyFilters();});
document.addEventListener('input',()=>{saveDraft();applyFilters();});

document.getElementById('send').addEventListener('click',async()=>{
 const sendButton=document.getElementById('send'),statusLine=document.getElementById('msg');
 sendButton.disabled=true;sendButton.textContent='Saving\\u2026';statusLine.className='';statusLine.textContent='';
 const reviewer=reviewerName()||'anonymous';
 const payload={page:document.title,round:ROUND_NUMBER,scoreGeneration:SCORE_GENERATION,inputSha256ByRole:INPUT_SHA256_BY_ROLE,reviewer:reviewer,submittedAt:new Date().toISOString(),tags:collectTags()};
 const suffix='-'+reviewer.replace(/[^A-Za-z0-9]+/g,'')+'-'+new Date().toISOString().slice(11,19).replace(/:/g,'');
 try{const response=await fetch(FEEDBACK_ENDPOINT_URL,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({filePath:FEEDBACK_TARGET_PATH.replace(/\\.json$/,suffix+'.json'),body:JSON.stringify(payload,null,1)})});
  if(!response.ok){statusLine.textContent=${JSON.stringify(PAGE_WORDING.notSavedLabel)}+await response.text();sendButton.disabled=false;sendButton.textContent='Submit tags';return;}
  const writtenList=JSON.parse(await response.text());
  statusLine.className='saved';statusLine.textContent=${JSON.stringify(PAGE_WORDING.savedLabel)}+' \\u2192 '+writtenList[0].writtenPath.split('/').pop()+' at '+new Date().toLocaleTimeString();
  sendButton.disabled=false;sendButton.textContent='Saved \\u2713';sendButton.classList.add('flash');
  setTimeout(()=>{sendButton.textContent='Submit tags';sendButton.classList.remove('flash');},1800);}
 catch(sendFault){statusLine.textContent=${JSON.stringify(PAGE_WORDING.notSavedLabel)}+sendFault.message;sendButton.disabled=false;sendButton.textContent='Submit tags';}});
const storedReviewerName=reviewerName();
if(storedReviewerName){setReviewerName(storedReviewerName);}else{restoreDraft();showTally();applyFilters();askReviewerName('');}
`;

// the layout and look of the Ed-Fi review page (its generator's page style), so the two pages read alike
const PAGE_STYLE = `
:root{--bg:#faf8f4;--ink:#23201c;--mut:#6b645c;--line:#ded7cc;--ok:#2f6f4f;--no:#a33;--may:#8a6d1f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,sans-serif;padding:0 16px 120px}
.wrap{max-width:1240px;margin:0 auto}h1{font-size:1.45rem;margin:24px 0 4px}.sub{color:var(--mut);font-size:.9rem;margin-bottom:18px}
.note-box{background:#fff;border:1px solid var(--line);border-left:4px solid #8a6d1f;padding:12px 14px;border-radius:6px;margin:16px 0;font-size:.9rem}
.item{background:#fff;border:1px solid var(--line);border-radius:8px;padding:14px;margin:14px 0}
.item.tagged{border-left:4px solid #9ec3ad}.item.hidden{display:none}
.num{background:#efe9df;border-radius:4px;padding:1px 7px;font-size:.78rem;color:var(--mut)}
.ph{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);margin-bottom:5px}
.srcbox{background:#f4f1ea;border-radius:6px;padding:10px 12px;margin:8px 0}
.pickbox{background:#eef4f0;border:1px solid #cfe0d5;border-radius:6px;padding:10px 12px;margin:9px 0}
.pickbox.abst{background:#f4f2ee;border-color:var(--line);color:var(--mut);font-style:italic}
.line{font-size:.88rem;margin:8px 0;padding:6px 10px;background:#f2f6f3;border-left:3px solid #9ec3ad;border-radius:3px}
.rank{font-size:.8rem;color:var(--mut)}
.card .slot{margin:5px 0}.sl{display:inline-block;min-width:130px;font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
.card b{font-size:.92rem}.card .d{font-size:.82rem;color:#55504a;margin:2px 0 0 130px}.cid{font-size:.8rem;color:var(--mut)}
.card.mini b{font-size:.85rem}.card.mini .d{font-size:.78rem}.d{font-size:.88rem}
.ideas{font-size:.8rem;color:#55504a;margin-top:7px}
.ptype,.ord{font-size:.7rem;color:var(--mut);background:#ece7de;padding:1px 6px;border-radius:4px;text-transform:none;letter-spacing:0}
.cat{font-size:.7rem;color:var(--ok);background:#ddeee4;padding:1px 6px;border-radius:4px;text-transform:none;letter-spacing:0}
.jr{font-size:.88rem;margin:7px 0;color:#4a453e}
.lbl{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);margin-right:6px}
.slate{margin:9px 0;font-size:.85rem}.slate summary{cursor:pointer;color:#4a6fa5;font-size:.82rem}
.alt{display:flex;gap:8px;border-top:1px solid #eee7dc;padding:7px 0}.ordn{flex:0 0 22px;color:#b3aa9d;font-size:.75rem}
.altbody{flex:1;min-width:0}.altline{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;margin-bottom:4px}
.tags{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}
.tags label{font-size:.95rem;cursor:pointer}.fourth{color:#8a6d1f;font-weight:600}
.note{flex:1;min-width:160px;padding:5px 8px;border:1px solid var(--line);border-radius:5px;font-size:.85rem}
.outer>summary{list-style:none;cursor:pointer;display:flex;gap:9px;align-items:center;flex-wrap:wrap;padding:2px 0}
.outer>summary::-webkit-details-marker{display:none}
.outer>summary::before{content:"\\25B6";color:#8f857a;font-size:.72rem;margin-right:2px}
.outer[open]>summary::before{content:"\\25BC"}
.tgrid{display:grid;grid-template-columns:max-content max-content max-content max-content;column-gap:10px;row-gap:2px;flex:1;min-width:0;align-items:baseline}
.rl{font-size:.66rem;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);white-space:nowrap}
.dc{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;border-radius:3px;padding:2px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dc.src{background:#f0ece3;color:#4a453e}.dc.pic{background:#eef2f7;color:#3d5a80}.dc.pic.abst{background:#f4f2ee;color:var(--mut);font-style:italic}
.dc.alt{background:#f6f3ee;color:#6b645c;white-space:normal;font-family:inherit;font-size:.82rem}
.badges{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.bdg{font-size:.7rem;padding:2px 7px;border-radius:10px;white-space:nowrap;background:#efe9df;color:#4a453e}
.bdg.kind{background:#e8eef7;color:#3d5a80}.bdg.mark{background:#f6efd9;color:#7a5c10}
.body{margin-top:10px;padding-top:10px;border-top:1px solid #f0ece3}
.scoreCell{font-weight:600}.unscored{color:var(--mut);font-style:italic}
#algoPanel{position:fixed;inset:0;background:rgba(35,32,28,.5);z-index:60;display:flex;align-items:flex-start;justify-content:center;padding:36px 16px;overflow:auto}
#algoPanel[hidden]{display:none}
#algoCard{background:#fff;border-radius:10px;padding:26px 30px 30px;max-width:840px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.25);position:relative}
#algoCard h2{margin:0 0 14px;font-size:1.3rem}
#algoCard h3{margin:22px 0 6px;font-size:1rem;color:var(--ok);border-bottom:1px solid var(--line);padding-bottom:4px}
#algoCard p{margin:0 0 11px;font-size:.92rem;line-height:1.6}#algoCard .fine{font-size:.78rem;color:var(--mut)}
#algoCard table{border-collapse:collapse;margin:8px 0;font-size:.86rem}
#algoCard th,#algoCard td{padding:4px 12px 4px 0;border-bottom:1px solid #eee7dc;text-align:left;vertical-align:top}
.algoclose{position:absolute;top:14px;right:16px}
#filterPanel{position:fixed;left:0;right:0;bottom:98px;z-index:40;padding:0 16px;display:flex;justify-content:center}
#filterPanel[hidden]{display:none}
.filters{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 15px;box-shadow:0 -6px 26px rgba(0,0,0,.13);max-width:860px;width:100%;max-height:62vh;overflow:auto;display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;font-size:.85rem}
.fhead{flex:0 0 100%;display:flex;gap:10px;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:7px;margin-bottom:2px}
.fhint{font-size:.76rem;color:var(--mut);flex:1}
#filterBtn.on{background:var(--ok);color:#fff;border-color:var(--ok)}
.fgroup{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.fname{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);margin-right:2px}
.filters label{cursor:pointer;white-space:nowrap}.fcount{color:var(--mut);font-size:.8rem}
.who{font-size:.85rem;color:var(--mut)}.who a{color:inherit;text-decoration:none}.who b{color:var(--ink)}
#nameGate{position:fixed;inset:0;background:rgba(35,32,28,.55);display:flex;align-items:center;justify-content:center;z-index:50}
#nameCard{background:#fff;border-radius:10px;padding:22px 24px;max-width:420px;box-shadow:0 8px 30px rgba(0,0,0,.2)}
#nameCard h2{margin:0 0 6px;font-size:1.1rem}#nameCard p{margin:0 0 14px;font-size:.9rem;color:var(--mut)}
#nameCard input{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:6px;font-size:1rem;margin-bottom:12px}
.bar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);padding:9px 16px;display:flex;flex-direction:column;gap:7px;align-items:center}
.barrow{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center}
#count,#msg{font-size:.85rem;color:var(--mut)}
.ghost{background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:7px 14px;font-size:.85rem;cursor:pointer}
#send{background:var(--ok);color:#fff;border:0;border-radius:6px;padding:10px 22px;font-size:1rem;cursor:pointer}
#send:hover{background:#255a3f}#send:disabled{background:#9aa39c;cursor:default}#send.flash{background:#3f9068}
#msg.saved{color:var(--ok);font-weight:600}
.info{background:var(--may);color:#fff;border:0;border-radius:6px;padding:8px 18px;font-size:.9rem;cursor:pointer}
@media (max-width:700px){.tgrid{grid-template-columns:1fr}.dc{white-space:normal}}
`;

// buildReviewPageHtml — pure: the page for one score
const buildReviewPageHtml = ({ score, decisionBlock, questionMap, cardLabelList, pageSetting }) => {
	const pageSettingFault = pageSettingFaultOf(pageSetting);
	if (pageSettingFault !== null) {
		return { error: refuse.byName({ moduleName, what: pageSettingFault, where: 'the page setting names where replies land (feedbackTargetPath, relative to the webdev root, ending .json), the draft store prefix, the title and the round; none has a default' }) };
	}
	const recordByItemRef = recordByItemRefOf(decisionBlock);
	const blockFault = blockFaultOf({ unitVerdictList: score.unitVerdictList, recordByItemRef, judgmentScored: score.judgment.scored });
	if (blockFault !== null) {
		return { error: refuse.byName({ moduleName, what: `unit ${blockFault.subjectStableId} ${blockFault.faultText}`, where: 'the page shows each unit\'s pool and the judge\'s answer from the decision block; every unit needs its record, its rendered pool and (on a scored block) the judge\'s rationale and category' }) };
	}
	const unlabelled = unlabelledCardOf({ unitVerdictList: score.unitVerdictList, recordByItemRef, cardLabelList });
	if (unlabelled !== null) {
		return { error: refuse.byName({ moduleName, what: `card ${unlabelled.cardStableId} (unit ${unlabelled.subjectStableId}) ${unlabelled.faultText}`, where: 'the label list must carry the whole tuple of every card the page names (each unit\'s proposed card, its standard\'s cards and every candidate in its pool), each qualifier with its option value name; the block carries stableIds only' }) };
	}
	const questionByRefId = {};
	questionMap.questionList.forEach((oneQuestion) => {
		questionByRefId[oneQuestion.questionRefId] = oneQuestion;
	});
	const detailsBuilt = detailsHtmlOf({ score, decisionBlock, recordByItemRef, questionMap });
	if (detailsBuilt.error) {
		return { error: detailsBuilt.error };
	}

	const itemBuiltList = score.unitVerdictList.map((unitVerdict, unitIndex) => itemHtmlOf({ score, unitVerdict, unitIndex, question: questionByRefId[unitVerdict.subjectStableId.slice(SUBJECT_STABLE_ID_PREFIX.length)], record: recordByItemRef[itemRefOf(unitVerdict)], cardLabelList }));
	const itemCount = score.unitVerdictList.length;
	const header = decisionBlock.header;
	const bodyHtml = [
		`<div class="wrap">`,
		`<h1>${escapeHtml(pageSetting.pageTitle)}</h1>`,
		`<div class="sub">${itemCount} ${PAGE_WORDING.subLineUnits} &middot; ${PAGE_WORDING.judgeWord} <b>${dataSpan(header.judgeKind)}</b> &middot; ${PAGE_WORDING.rendererWord} <code>${dataSpan(header.rendererVersion)}</code> &middot; ${PAGE_WORDING.roundWord} ${escapeHtml(pageSetting.roundNumber)}</div>`,
		HOW_TO_HTML({ unitCount: itemCount, retrievalK: header.candidateRetrieval.k }),
		`<div id="algoPanel" hidden><div id="algoCard"><button id="closeAlgo" class="ghost algoclose">close</button>${detailsBuilt.detailsHtml}</div></div>`,
		`<div id="filterPanel" hidden><div class="filters" id="filterCard"><div class="fhead"><b>Filters</b><span class="fhint">boxes inside a group are OR&rsquo;d; groups narrow each other; the number is how many items each box matches</span><button id="closeFilters" class="ghost">done</button></div>\n${facetPanelHtmlOf({ facetStateList: itemBuiltList.map((oneBuilt) => oneBuilt.facetState) })} <div class="fgroup"><span class="fname"></span><button id="clearFilters" class="ghost">clear all</button>\n  <span id="shown" class="fcount"></span></div>\n</div></div>`,
		`<section id="items">`,
		itemBuiltList.map((oneBuilt) => oneBuilt.itemHtml).join('\n'),
		'</section>',
		`</div><div class="bar">\n<div class="barrow"><button id="filterBtn" class="ghost">Filters</button><button id="collapseAll" class="ghost">collapse all</button><button id="expandAll" class="ghost">expand all</button>\n<span class="who">reviewer name: <b id="whoName">&mdash;</b> (<a href="#" id="changeName">change</a>)</span></div>\n<div class="barrow"><span id="count">0 of ${itemCount} tagged</span><button id="send" type="button">${PAGE_WORDING.submitLabel}</button><span id="msg"></span></div></div>`,
	].join('\n');
	const scoreCellCount = (bodyHtml.match(SCORE_CELL_PATTERN) || []).length;
	const manifest = {
		itemCount,
		scoreCellCount,
		feedbackTargetPath: pageSetting.feedbackTargetPath,
		draftStoragePrefix: pageSetting.draftStoragePrefix,
		roundNumber: pageSetting.roundNumber,
		scoreGeneration: score.generation,
		...Object.keys(score.inputFileSha256ByRole || {}).reduce((soFar, oneRole) => ({ ...soFar, [`inputSha256.${oneRole}`]: score.inputFileSha256ByRole[oneRole] }), {}),
	};
	const manifestText = `<!--\n${MANIFEST_TITLE}\n${Object.keys(manifest).map((oneName) => `${oneName}=${manifest[oneName]}`).join('\n')}\n-->`;
	const htmlText = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(pageSetting.pageTitle)}</title>\n${manifestText}\n<style>${PAGE_STYLE}</style></head>\n<body>\n${bodyHtml}\n<script>${pageScriptOf({ score, pageSetting, itemCount })}</script>\n</body></html>\n`;

	const hitList = forbiddenWordHitList(htmlText);
	if (hitList.length > 0) {
		return { error: refuse.byName({ moduleName, what: `the page's own prose carries ${hitList.length} forbidden word(s) (${Array.from(new Set(hitList.map((oneHit) => oneHit.toLowerCase()))).join(', ')})`, where: "SPEC §2 and §5.7: the page names what the standard specifies and what the bridge proposed; outside the standards' data spans it never says either word" }) };
	}
	return { htmlText, manifest };
};

// buildReviewPageFromFiles — scores the five inputs with the scorer itself, then builds the page
const buildReviewPageFromFiles = ({ decisionBlockFilePath, annotationFilePath, questionMapFilePath, cardListFilePath, remodelTableFilePath, cardLabelFilePath, pageSetting }) => {
	const scored = sifYardstickScorer.scoreFromFiles({ decisionBlockFilePath, annotationFilePath, questionMapFilePath, cardListFilePath, remodelTableFilePath });
	if (scored.error) {
		return { error: scored.error };
	}
	const built = buildReviewPageHtml({ score: scored.score, decisionBlock: JSON.parse(fs.readFileSync(decisionBlockFilePath, 'utf8')), questionMap: JSON.parse(fs.readFileSync(questionMapFilePath, 'utf8')), cardLabelList: JSON.parse(fs.readFileSync(cardLabelFilePath, 'utf8')), pageSetting });
	if (built.error) {
		return { error: built.error };
	}
	return { ...built, score: scored.score };
};

// verifySifReviewPage — checks a page (a local build, or a copy fetched from the live URL) against the score it
// must show. EVERY check reads the RENDERED content: HTML comments, the manifest among them, are removed first,
// so a phrase or number that survives only in the manifest can never pass a check (EBONY_DREAM's caution). The
// manifest is parsed separately and only for the values it declares.
const verifySifReviewPage = ({ htmlText, score }) => {
	const checkList = [];
	const addCheck = (checkName, pass, detail) => checkList.push({ checkName, pass, detail });
	const manifestMatch = htmlText.match(MANIFEST_PATTERN);
	addCheck('manifestPresent', manifestMatch !== null, manifestMatch === null ? 'the page carries no manifest' : '');
	if (manifestMatch === null) {
		return { pass: false, checkList };
	}
	const manifest = {};
	manifestMatch[1].split('\n').forEach((oneLine) => {
		const splitIndex = oneLine.indexOf('=');
		manifest[oneLine.slice(0, splitIndex)] = oneLine.slice(splitIndex + 1);
	});
	const renderedText = htmlText.replace(HTML_COMMENT_PATTERN, '');

	const scoreCellList = Array.from(renderedText.matchAll(SCORE_CELL_PATTERN)).map((oneMatch) => ({ scorePath: oneMatch[1], cellText: oneMatch[2] }));
	const unequalCellList = scoreCellList.filter((oneCell) => typeof valueAt(score, oneCell.scorePath) !== 'number' || String(valueAt(score, oneCell.scorePath)) !== oneCell.cellText);
	addCheck('scoreCellsEqualScore', scoreCellList.length > 0 && unequalCellList.length === 0, unequalCellList.map((oneCell) => `${oneCell.scorePath} shows '${oneCell.cellText}', score holds ${JSON.stringify(valueAt(score, oneCell.scorePath))}`).join('; ') || `${scoreCellList.length} cells`);
	addCheck('scoreCellCount', String(scoreCellList.length) === manifest.scoreCellCount, `rendered ${scoreCellList.length}, manifest ${manifest.scoreCellCount}`);

	const itemRefList = Array.from(renderedText.matchAll(/<article class="item" data-item-ref="([^"]*)"/g)).map((oneMatch) => unescapeHtml(oneMatch[1]));
	addCheck('itemCount', itemRefList.length === score.unitVerdictList.length && String(itemRefList.length) === manifest.itemCount, `rendered ${itemRefList.length}, score ${score.unitVerdictList.length}, manifest ${manifest.itemCount}`);
	const expectedItemRefText = score.unitVerdictList.map(itemRefOf).join('\n');
	addCheck('itemRefsAreUnits', itemRefList.join('\n') === expectedItemRefText && new Set(itemRefList).size === itemRefList.length, 'each item is keyed by its unit (subjectStableId plus partition label), in the score\'s order, once');

	const tagRadioCount = (renderedText.match(/<input type="radio" name="t_/g) || []).length;
	addCheck('tagChoicesPerItem', tagRadioCount === TAG_VALUE_LIST.length * itemRefList.length, `${tagRadioCount} radios for ${itemRefList.length} items, ${TAG_VALUE_LIST.length} choices each`);
	addCheck('feedbackTargetPath', renderedText.indexOf(`const FEEDBACK_TARGET_PATH=${JSON.stringify(manifest.feedbackTargetPath)};`) !== -1 && renderedText.indexOf(FEEDBACK_ENDPOINT_URL) !== -1, `target ${manifest.feedbackTargetPath}`);

	const handlerIdList = Array.from(new Set(Array.from(renderedText.matchAll(/document\.getElementById\('([^']+)'\)/g)).map((oneMatch) => oneMatch[1])));
	const orphanIdList = handlerIdList.filter((oneId) => renderedText.indexOf(`id="${oneId}"`) === -1);
	addCheck('handlerIdsResolve', handlerIdList.length > 0 && orphanIdList.length === 0, orphanIdList.length === 0 ? `${handlerIdList.length} ids` : `orphans: ${orphanIdList.join(', ')}`);

	const hitList = forbiddenWordHitList(renderedText);
	addCheck('ownProseClean', hitList.length === 0, hitList.join(', '));

	const shaRoleList = Object.keys(score.inputFileSha256ByRole || {});
	const unequalShaRoleList = shaRoleList.filter((oneRole) => manifest[`inputSha256.${oneRole}`] !== score.inputFileSha256ByRole[oneRole]);
	addCheck('inputShas', unequalShaRoleList.length === 0, unequalShaRoleList.length === 0 ? `${shaRoleList.length} roles` : `differ: ${unequalShaRoleList.join(', ')}`);

	return { pass: checkList.every((oneCheck) => oneCheck.pass), checkList };
};

module.exports = { buildReviewPageHtml, buildReviewPageFromFiles, verifySifReviewPage, cardLabelHtmlOf, dataSpan, escapeHtml, ownProseTextOf, itemRefOf, valueAt, PAGE_WORDING, FEEDBACK_ENDPOINT_URL, moduleName };
