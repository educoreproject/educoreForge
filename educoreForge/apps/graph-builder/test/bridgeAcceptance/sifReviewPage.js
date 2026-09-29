'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sifReviewPage.js — THE SIF REVIEW PAGE (phases C6, C6b, C6c; plan §3 C6). App-level: it renders what the bridge's frozen
// decision block holds, and measures nothing.
//
//   buildReviewPageHtml({ decisionBlock, questionMap, cardLabelList, pageSetting, inputFileSha256ByRole }) → { htmlText, manifest } | { error }
//   buildReviewPageFromFiles({ decisionBlockFilePath, questionMapFilePath, cardLabelFilePath, pageSetting }) → the same,
//                              with the three inputs' sha256 riding on the page
//   verifySifReviewPage({ htmlText, decisionBlock, inputFileSha256ByRole }) → { pass, checkList }: reads a built or a
//                              FETCHED DEPLOYED copy
//
// NO COMPARISON WITH THE STANDARD'S OWN ANNOTATIONS (TQ, 2026-09-29: "remove it entirely. those mappings are crap"). The page
// carries no class badge, no "the standard specifies" line, no rank against the annotation and no score number; the
// yardstick scorer (sifYardstickScorer.js) is not read here at all. The page shows the SIF element, the judge's pool as full
// tuples, the pick, the judge's rationale and category, and the tags.
//
// TWO KINDS OF TEXT (EBONY_DREAM's ruling). The page's OWN prose (the wording table, templates, labels, the script) never
// says either word SPEC §2 forbids; the builder refuses a page whose own prose carries one. Every string taken from the
// standards' data or from the judge (SIF names, descriptions and paths, CEDS domain and property names, ids, the
// rationale) is HTML-escaped inside a <span data-source="standard">, and the scan skips those spans, so a CEDS name such as
// a "Standard Error of Measurement" card, or a rationale that says "wrong", never makes the page refuse.
//
// LAYOUT (phase C6c, TQ 2026-09-29: "approximate" the Ed-Fi review page; its generator, buildReviewPage2.py, is only read).
// Header (judge, renderer, round from the block header), a how-to, a Details panel (how the answers are made, with numbers
// generated from the block header), a faceted filter panel, and one collapsible block per unit: the SIF element beside the
// CEDS answer, the source text, the card chosen, the judge's rationale, EVERY candidate of the judge's pool as a full tuple
// with the pick marked, and Yes / No / Maybe / No Valid Candidate tags with a note. Autosave to the browser, a name gate,
// and Submit to the miloFeedback endpoint. Left out, and said so on the page: Milo's opinion (no pre-assessment was done)
// and Shared Ideas (the block carries no component ideas). The block supplies each unit's pool and the judge's answer; a
// unit lacking either is refused by name.
//
// CARD TUPLES (phase C6b). A card is shown as its FULL TUPLE, so a reviewer can tell apart cards that share one property
// id and differ only by qualifier: domain (id), property (id), then the range, the value and each qualifier as
// `option set = option value (id)`, where the card has them; an empty slot is omitted. The range is exactly one of three
// shapes (an option set, a scalar datatype, a class), each rendered in its own form. The label list (sifCardTuple.js builds
// it, from the hub) carries the tuple; a card whose tuple is incomplete, or whose qualifier has no option value name, is
// refused by name, so the page never shows a raw id alone.
//
// FEEDBACK: tags POST to the miloFeedback endpoint at pageSetting.feedbackTargetPath (relative to the webdev root, as the
// endpoint resolves it), with the reviewer and the time appended, as the Ed-Fi review pages do. A per-reviewer draft lives in
// localStorage under pageSetting.draftStoragePrefix. Tags are keyed by the unit's subjectStableId plus its partition label,
// never by position. There is no visit beacon (the Ed-Fi review pages carry none).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const refuse = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'forge-framework', 'refuse'));

const SUBJECT_STABLE_ID_PREFIX = 'sif260928:question/';
const FEEDBACK_ENDPOINT_URL = 'https://qbook.work/api/miloFeedback';
const DATA_SPAN_OPEN = '<span data-source="standard">';
const MANIFEST_TITLE = 'SIF REVIEW PAGE MANIFEST';
const FORBIDDEN_WORD_PATTERN = /error|wrong/gi;
const DATA_SPAN_PATTERN = /<span data-source="standard">[^<]*<\/span>/g;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const MANIFEST_PATTERN = new RegExp(`<!--\\n${MANIFEST_TITLE}\\n([\\s\\S]*?)\\n-->`);
const INPUT_ROLE_LIST = Object.freeze(['decisionBlock', 'questionMap', 'cardLabelList']);

// every sentence and label the page prints of its own. One table, so gate (c) has one place to be broken.
const PAGE_WORDING = Object.freeze({
	domainSlot: 'domain',
	propertySlot: 'property',
	rangeOptionSetSlot: 'range option set',
	rangeDatatypeSlot: 'range datatype',
	rangeClassSlot: 'range class',
	valueSlot: 'value',
	qualifierSlot: 'qualifier',
	detailsHeading: 'How the answers are made',
	sourceHeading: 'SIF element',
	sourceRowLabel: 'SIF',
	answerRowLabel: 'CEDS',
	noneCell: 'NONE',
	declinedCell: '— the judge declined',
	pathLabel: 'path',
	sharedBlockLabel: 'block',
	partitionLabel: 'domain',
	fieldsLabel: 'fields in this unit',
	noMatchHeading: 'NO MATCH CHOSEN',
	declinedAllText: (poolSize) => `the judge declined all ${poolSize} candidates`,
	cardChosenHeading: 'CEDS card chosen',
	candidateOrdinalText: (ordinal, poolSize) => `candidate ${ordinal} of ${poolSize}`,
	judgeSaidLabel: 'judge said',
	judgeSettingsLabel: 'judge category',
	slateSummary: (poolSize) => `the ${poolSize} candidates the judge was choosing among`,
	pickedMark: 'picked',
	subLineUnits: 'judgment units (SIF → CEDS)',
	judgeWord: 'judge',
	rendererWord: 'renderer',
	roundWord: 'round',
	noDomainCaption: '(no domain)',
	tagYes: 'Yes',
	tagNo: 'No',
	tagMaybe: 'Maybe',
	tagNoValidCandidate: 'No Valid Candidate',
	notePlaceholder: 'note (optional)',
	submitLabel: 'Submit tags',
	savedLabel: 'saved',
	notSavedLabel: 'Not saved: ',
});
const TAG_VALUE_LIST = Object.freeze([
	{ tagValue: 'yes', labelText: PAGE_WORDING.tagYes, labelClassName: '' },
	{ tagValue: 'no', labelText: PAGE_WORDING.tagNo, labelClassName: '' },
	{ tagValue: 'maybe', labelText: PAGE_WORDING.tagMaybe, labelClassName: '' },
	{ tagValue: 'noValidCandidate', labelText: PAGE_WORDING.tagNoValidCandidate, labelClassName: 'fourth' },
]);
const OUTCOME_NAME = Object.freeze({ picked: 'picked', abstained: 'abstained' });
const NO_DOMAIN_VALUE = 'noDomain';

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const unescapeHtml = (text) => text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const dataSpan = (text) => `${DATA_SPAN_OPEN}${escapeHtml(text)}</span>`;
const itemRefOf = (unit) => (unit.judgmentPartitionLabel === null ? unit.subjectStableId : `${unit.subjectStableId}#${unit.judgmentPartitionLabel}`);

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

// cardLabelHtmlOf — a card as the reviewer reads it in a line, its FULL TUPLE: `Domain (C…) · Property (P…) · range
// option set Set (OS…) · Type = Value (OV…)`. The block carries stableIds only; the label list carries the tuple.
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

// unitListOf — one unit per record of the block, in the block's order: the unit's subject and partition label, the block
// the question belongs to, the card the judge chose (null when it abstained), and the record itself. A record whose
// question the question map lacks is refused by name.
const unitListOf = ({ decisionBlock, questionMap }) => {
	const questionByRefId = {};
	questionMap.questionList.forEach((oneQuestion) => {
		questionByRefId[oneQuestion.questionRefId] = oneQuestion;
	});
	const unitList = [];
	for (let recordIndex = 0; recordIndex < decisionBlock.decisionRecordList.length; recordIndex++) {
		const record = decisionBlock.decisionRecordList[recordIndex];
		const question = questionByRefId[record.subjectStableId.slice(SUBJECT_STABLE_ID_PREFIX.length)];
		if (question === undefined) {
			return { error: refuse.byName({ moduleName, what: `record ${recordIndex} (${record.subjectStableId}) names a question the question map does not carry`, where: 'the page shows each unit\'s SIF element from the question map; the block and the map must be of one yardstick' }) };
		}
		unitList.push({ subjectStableId: record.subjectStableId, judgmentPartitionLabel: record.judgmentPartitionLabel === undefined ? null : record.judgmentPartitionLabel, sharedBlock: question.sharedBlock, proposedCardStableId: record.abstained === true ? null : record.objectStableId, record, question });
	}
	return { unitList };
};

// blockFaultOf — where the block meets the page: each record needs its pool as the judge saw it, the proposed card must be
// in that pool, and the judge's answer (rationale, category) must be there
const blockFaultOf = ({ unitList }) => {
	for (let unitIndex = 0; unitIndex < unitList.length; unitIndex++) {
		const unit = unitList[unitIndex];
		if (!Array.isArray(unit.record.renderedPoolStableIdList) || unit.record.renderedPoolStableIdList.length === 0) {
			return { subjectStableId: unit.subjectStableId, faultText: 'has a record with no rendered pool' };
		}
		if (unit.proposedCardStableId !== null && unit.record.renderedPoolStableIdList.indexOf(unit.proposedCardStableId) === -1) {
			return { subjectStableId: unit.subjectStableId, faultText: `has a proposed card (${unit.proposedCardStableId}) that is not in its rendered pool` };
		}
		if (unit.record.judge === undefined || typeof unit.record.judge.rationale !== 'string' || typeof unit.record.judge.category !== 'string') {
			return { subjectStableId: unit.subjectStableId, faultText: 'has a record with no judge rationale or category' };
		}
	}
	return null;
};

// the one edge where the label list meets the block: every card the page names (the proposed card and every candidate in
// the judge's pool) must carry a whole tuple
const unlabelledCardOf = ({ unitList, cardLabelList }) => {
	for (let unitIndex = 0; unitIndex < unitList.length; unitIndex++) {
		const unit = unitList[unitIndex];
		const shownCardStableIdList = [unit.proposedCardStableId].concat(unit.record.renderedPoolStableIdList).filter((oneStableId) => oneStableId !== null);
		for (let shownIndex = 0; shownIndex < shownCardStableIdList.length; shownIndex++) {
			const faultText = cardLabelFaultOf({ cardStableId: shownCardStableIdList[shownIndex], cardLabelList });
			if (faultText !== null) {
				return { cardStableId: shownCardStableIdList[shownIndex], subjectStableId: unit.subjectStableId, faultText };
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

// itemHtmlOf — one unit, laid out as the Ed-Fi review page lays out an answer: a collapsible block whose summary puts the
// SIF element and the CEDS answer side by side; inside, the source text, the card chosen as a full tuple, the judge's
// rationale, every candidate in the judge's pool as a full tuple, and the tags.
const itemHtmlOf = ({ unit, unitIndex, cardLabelList }) => {
	const itemRef = itemRefOf(unit);
	const cardLabelByStableId = cardLabelList.cardLabelByStableId;
	const record = unit.record;
	const question = unit.question;
	const judge = record.judge;
	const outcomeText = unit.proposedCardStableId === null ? OUTCOME_NAME.abstained : OUTCOME_NAME.picked;
	const domainValue = unit.judgmentPartitionLabel === null ? NO_DOMAIN_VALUE : unit.judgmentPartitionLabel;
	const poolStableIdList = record.renderedPoolStableIdList;
	const unitPlaceText = unit.judgmentPartitionLabel === null ? unit.sharedBlock : unit.judgmentPartitionLabel;

	const sourceCellHtmlList = [`${dataSpan(unitPlaceText)}.`, dataSpan(question.name)];
	const answerCellHtmlList = unit.proposedCardStableId === null
		? [PAGE_WORDING.noneCell, PAGE_WORDING.declinedCell]
		: [`${dataSpan(cardLabelByStableId[unit.proposedCardStableId].domainName)}.`, `${dataSpan(cardLabelByStableId[unit.proposedCardStableId].propertyName)}.`, dataSpan(rangeNameOf(cardLabelByStableId[unit.proposedCardStableId]))];
	const gridHtml = `<span class="tgrid"><span class="rl">${PAGE_WORDING.sourceRowLabel}</span>${sourceCellHtmlList.map((oneCell) => `<code class="dc src">${oneCell}</code>`).join('')}<span></span>`
		+ `<span class="rl">${PAGE_WORDING.answerRowLabel}</span>${answerCellHtmlList.map((oneCell) => `<code class="dc pic${unit.proposedCardStableId === null ? ' abst' : ''}">${oneCell}</code>`).join('')}</span>`;
	const badgeHtml = `<span class="badges"><span class="bdg kind">${dataSpan(judge.category)}</span></span>`;

	const sourceHtml = `<div class="srcbox"><div class="ph">${PAGE_WORDING.sourceHeading} <span class="ptype">${dataSpan(question.objectNameList.join(', '))}</span></div>`
		+ `<div class="d">${question.description === undefined ? '' : dataSpan(question.description)}</div>`
		+ `<div class="ideas"><span class="lbl">${PAGE_WORDING.pathLabel}</span>${dataSpan(question.relativePath)} <span class="lbl">${PAGE_WORDING.sharedBlockLabel}</span>${dataSpan(unit.sharedBlock)}${unit.judgmentPartitionLabel === null ? '' : ` <span class="lbl">${PAGE_WORDING.partitionLabel}</span>${dataSpan(unit.judgmentPartitionLabel)}`} <span class="lbl">${PAGE_WORDING.fieldsLabel}</span>${dataSpan(record.instanceStableIdList.length)}</div></div>`;
	const pickHtml = unit.proposedCardStableId === null
		? `<div class="pickbox abst"><div class="ph">${PAGE_WORDING.noMatchHeading}</div><div class="d">${PAGE_WORDING.declinedAllText(poolStableIdList.length)}</div></div>`
		: `<div class="pickbox"><div class="ph">${PAGE_WORDING.cardChosenHeading} <span class="cat">${dataSpan(judge.category)}</span> <span class="ord">${PAGE_WORDING.candidateOrdinalText(poolStableIdList.indexOf(unit.proposedCardStableId) + 1, poolStableIdList.length)}</span></div>${cardBlockHtmlOf({ cardStableId: unit.proposedCardStableId, cardLabelList, classText: 'card' })}</div>`;
	const judgeHtml = `<div class="jr"><span class="lbl">${PAGE_WORDING.judgeSaidLabel}</span>${dataSpan(judge.rationale)}</div>`
		+ `<div class="jr"><span class="lbl">${PAGE_WORDING.judgeSettingsLabel}</span>${dataSpan(`${judge.category}${typeof record.confidence === 'number' ? `, confidence ${record.confidence}` : ''}${record.predicate ? `, ${record.predicate}` : ''}`)}</div>`;
	const slateHtml = `<details class="slate"><summary>${PAGE_WORDING.slateSummary(poolStableIdList.length)}</summary>${poolStableIdList.map((oneStableId, poolIndex) => {
		const isPick = oneStableId === unit.proposedCardStableId;
		return `<div class="alt"><span class="ordn">${poolIndex + 1}</span><div class="altbody"><div class="altline"><code class="dc alt">${cardLabelHtmlOf({ cardStableId: oneStableId, cardLabelList })}</code>${isPick ? `<span class="bdg mark">${PAGE_WORDING.pickedMark}</span>` : ''}</div>${cardBlockHtmlOf({ cardStableId: oneStableId, cardLabelList, classText: 'card mini' })}</div></div>`;
	}).join('')}</details>`;
	const tagsHtml = `<div class="tags">\n${TAG_VALUE_LIST.map((oneTag) => ` <label${oneTag.labelClassName === '' ? '' : ` class="${oneTag.labelClassName}"`}><input type="radio" name="t_${escapeHtml(itemRef)}" value="${oneTag.tagValue}"> ${oneTag.labelText}</label>`).join('\n')}\n <input class="note" type="text" name="n_${escapeHtml(itemRef)}" placeholder="${PAGE_WORDING.notePlaceholder}" value="">\n</div>`;
	return {
		itemHtml: `<article class="item" data-item-ref="${escapeHtml(itemRef)}" data-outcome="${outcomeText}" data-cat="${escapeHtml(judge.category)}" data-block="${escapeHtml(unit.sharedBlock)}" data-domain="${escapeHtml(domainValue)}">\n<details class="outer" open>\n<summary class="osum"><span class="num">${unitIndex + 1}</span>\n${gridHtml}\n${badgeHtml}</summary>\n<div class="body">\n${sourceHtml}\n${pickHtml}\n${judgeHtml}\n${slateHtml}\n${tagsHtml}\n</div></details></article>`,
		facetState: { outcome: outcomeText, cat: judge.category, block: unit.sharedBlock, domain: domainValue },
	};
};

// the facet boxes, as data: a group per facet, its boxes by value (null: the values the units carry). The review facet is
// counted in the browser; a box whose value no unit carries is not shown.
const FACET_GROUP_LIST = Object.freeze([
	{ facetName: 'outcome', caption: 'outcome', boxList: [[OUTCOME_NAME.picked, 'matched'], [OUTCOME_NAME.abstained, 'abstained']] },
	{ facetName: 'cat', caption: 'judge category', boxList: [['strong', 'strong'], ['moderate', 'moderate'], ['weakButReal', 'weak but real'], ['none', 'none (abstained)']] },
	{ facetName: 'block', caption: 'block', boxList: null },
	{ facetName: 'domain', caption: 'domain', boxList: null },
	{ facetName: 'review', caption: 'your review', boxList: [['untagged', 'not yet'], ['tagged', 'tagged'], ['noted', 'has a note']] },
]);
const facetBoxCaptionOf = (facetName, facetValue) => (facetName === 'domain' && facetValue === NO_DOMAIN_VALUE ? PAGE_WORDING.noDomainCaption : facetValue);
const facetPanelHtmlOf = ({ facetStateList }) => FACET_GROUP_LIST.map((oneGroup) => {
	const boxList = oneGroup.boxList === null ? Array.from(new Set(facetStateList.map((oneState) => oneState[oneGroup.facetName]))).sort().map((oneValue) => [oneValue, facetBoxCaptionOf(oneGroup.facetName, oneValue)]) : oneGroup.boxList;
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

// detailsHtmlOf — what the Details panel says, with the numbers generated from the block's header and records
const detailsHtmlOf = ({ decisionBlock, unitList }) => {
	const header = decisionBlock.header;
	const retrievalProse = RETRIEVAL_PROSE_REGISTRY[header.candidateRetrieval && header.candidateRetrieval.method];
	if (retrievalProse === undefined) {
		return { error: refuse.byName({ moduleName, what: `the block declares candidate retrieval method '${header.candidateRetrieval && header.candidateRetrieval.method}', which the Details prose has no description for`, where: 'RETRIEVAL_PROSE_REGISTRY names the methods the page can describe; the Details panel says what the block declares' }) };
	}
	const retrievalDescribed = retrievalProse({ retrieval: header.candidateRetrieval });
	if (retrievalDescribed.missingName !== undefined) {
		return { error: refuse.byName({ moduleName, what: `the block's candidateRetrieval declares no ${retrievalDescribed.missingName}`, where: 'the Details prose states the retrieval settings from the block header; none has a default' }) };
	}
	const unitCount = unitList.length;
	const poolInIdentifierOrderCount = unitList.filter((oneUnit) => JSON.stringify(oneUnit.record.renderedPoolStableIdList) === JSON.stringify(oneUnit.record.renderedPoolStableIdList.slice().sort())).length;
	const unpartitionedCount = unitList.filter((oneUnit) => oneUnit.judgmentPartitionLabel === null).length;
	const subjectCount = new Set(unitList.map((oneUnit) => oneUnit.subjectStableId)).size;
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
		`<h3>The run</h3>`,
		`<table id="runTable"><tr><th>judge</th><th>renderer</th><th>retrieval</th><th>units</th></tr><tr><td>${dataSpan(header.judgeKind)}</td><td>${dataSpan(header.rendererVersion)}</td><td>${dataSpan(header.candidateRetrieval.method)}</td><td>${unitCount}</td></tr></table>`,
	].join('\n');
	return { detailsHtml };
};

const HOW_TO_HTML = ({ unitCount, retrievalK }) => `<div class="note-box"><b>How to use this page</b><br><br>`
	+ `This page shows the SIF elements the bridge judged, ${unitCount} judgment units in all, each against the CEDS cards the judge could choose from (up to ${retrievalK} candidates per unit). A unit is one SIF element in one CEDS domain. The <b>Details</b> button explains how the answers are made.<br><br>`
	+ `Each item shows the SIF element's own text, the card the judge chose as a full CEDS tuple (domain, property, range, and any qualifier, each with its id and definition), the judge's rationale, and every candidate the judge was choosing among.<br><br>`
	+ `<b>Tag it</b>: Yes, No or Maybe for the bridge's answer, or No Valid Candidate when none of the candidates is right. The note is optional.<br><br>`
	+ `<b>Filters</b> &rarr; many are provided to allow you to examine the mappings in many ways.<br><br>`
	+ `Your choices save to this browser automatically. Submit often so your work is not lost.<br><br>`
	+ `There is no Milo opinion on this page: no pre-assessment of the SIF answers was done (an economy ruling).<br><br>`
	+ `<button id="algoBtn" class="info">Details: how the answers are made</button></div>`;

// the page's script: browser code, so async/await and try/catch are the house form here (browserCodePractices §1)
const pageScriptOf = ({ decisionBlock, pageSetting, itemCount, inputFileSha256ByRole }) => `
const FEEDBACK_ENDPOINT_URL=${JSON.stringify(FEEDBACK_ENDPOINT_URL)};
const FEEDBACK_TARGET_PATH=${JSON.stringify(pageSetting.feedbackTargetPath)};
const DRAFT_STORAGE_PREFIX=${JSON.stringify(pageSetting.draftStoragePrefix)};
const REVIEWER_STORE_NAME=DRAFT_STORAGE_PREFIX+'reviewer';
const ITEM_COUNT=${itemCount};
const ROUND_NUMBER=${pageSetting.roundNumber};
const BLOCK_GENERATION=${JSON.stringify(decisionBlock.header.generation)};
const INPUT_SHA256_BY_ROLE=${JSON.stringify(inputFileSha256ByRole)};
function reviewerName(){try{return localStorage.getItem(REVIEWER_STORE_NAME)||'';}catch(storageFault){return '';}}
function draftStoreName(){return DRAFT_STORAGE_PREFIX+'draft::'+(reviewerName()||'anonymous');}
const allItems=()=>document.querySelectorAll('article.item');
function collectTags(){const tagByItemRef={};allItems().forEach(oneItem=>{
 const checkedRadio=oneItem.querySelector('input[type=radio]:checked');const noteBox=oneItem.querySelector('input.note');
 if(checkedRadio||(noteBox&&noteBox.value)){tagByItemRef[oneItem.dataset.itemRef]={tag:checkedRadio?checkedRadio.value:null,note:noteBox?noteBox.value:'',judgeCategory:oneItem.dataset.cat,outcome:oneItem.dataset.outcome};}});
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
  const state={outcome:oneItem.dataset.outcome,cat:oneItem.dataset.cat,block:oneItem.dataset.block,domain:oneItem.dataset.domain,review:[isTagged?'tagged':'untagged'].concat(isNoted?['noted']:[])};
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
 const payload={page:document.title,round:ROUND_NUMBER,blockGeneration:BLOCK_GENERATION,inputSha256ByRole:INPUT_SHA256_BY_ROLE,reviewer:reviewer,submittedAt:new Date().toISOString(),tags:collectTags()};
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

// buildReviewPageHtml — pure: the page for one block
const buildReviewPageHtml = ({ decisionBlock, questionMap, cardLabelList, pageSetting, inputFileSha256ByRole }) => {
	const pageSettingFault = pageSettingFaultOf(pageSetting);
	if (pageSettingFault !== null) {
		return { error: refuse.byName({ moduleName, what: pageSettingFault, where: 'the page setting names where replies land (feedbackTargetPath, relative to the webdev root, ending .json), the draft store prefix, the title and the round; none has a default' }) };
	}
	const absentHeaderName = ['judgeKind', 'rendererVersion', 'generation'].find((oneName) => typeof decisionBlock.header[oneName] !== 'string' || decisionBlock.header[oneName] === '');
	if (absentHeaderName !== undefined) {
		return { error: refuse.byName({ moduleName, what: `the block header names no ${absentHeaderName}`, where: 'the page header, the Details panel and the submission name the judge, the renderer and the block generation from the block header; none has a default' }) };
	}
	const unitBuilt = unitListOf({ decisionBlock, questionMap });
	if (unitBuilt.error) {
		return { error: unitBuilt.error };
	}
	const unitList = unitBuilt.unitList;
	const blockFault = blockFaultOf({ unitList });
	if (blockFault !== null) {
		return { error: refuse.byName({ moduleName, what: `unit ${blockFault.subjectStableId} ${blockFault.faultText}`, where: 'the page shows each unit\'s pool and the judge\'s answer from the decision block; every record needs its rendered pool and the judge\'s rationale and category' }) };
	}
	const unlabelled = unlabelledCardOf({ unitList, cardLabelList });
	if (unlabelled !== null) {
		return { error: refuse.byName({ moduleName, what: `card ${unlabelled.cardStableId} (unit ${unlabelled.subjectStableId}) ${unlabelled.faultText}`, where: 'the label list must carry the whole tuple of every card the page names (each unit\'s proposed card and every candidate in its pool), each qualifier with its option value name; the block carries stableIds only' }) };
	}
	const detailsBuilt = detailsHtmlOf({ decisionBlock, unitList });
	if (detailsBuilt.error) {
		return { error: detailsBuilt.error };
	}

	const itemBuiltList = unitList.map((unit, unitIndex) => itemHtmlOf({ unit, unitIndex, cardLabelList }));
	const itemCount = unitList.length;
	const candidateCount = unitList.reduce((soFar, oneUnit) => soFar + oneUnit.record.renderedPoolStableIdList.length, 0);
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
	const manifest = {
		itemCount,
		candidateCount,
		feedbackTargetPath: pageSetting.feedbackTargetPath,
		draftStoragePrefix: pageSetting.draftStoragePrefix,
		roundNumber: pageSetting.roundNumber,
		blockGeneration: header.generation,
		...Object.keys(inputFileSha256ByRole).reduce((soFar, oneRole) => ({ ...soFar, [`inputSha256.${oneRole}`]: inputFileSha256ByRole[oneRole] }), {}),
	};
	const manifestText = `<!--\n${MANIFEST_TITLE}\n${Object.keys(manifest).map((oneName) => `${oneName}=${manifest[oneName]}`).join('\n')}\n-->`;
	const htmlText = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(pageSetting.pageTitle)}</title>\n${manifestText}\n<style>${PAGE_STYLE}</style></head>\n<body>\n${bodyHtml}\n<script>${pageScriptOf({ decisionBlock, pageSetting, itemCount, inputFileSha256ByRole })}</script>\n</body></html>\n`;

	const hitList = forbiddenWordHitList(htmlText);
	if (hitList.length > 0) {
		return { error: refuse.byName({ moduleName, what: `the page's own prose carries ${hitList.length} forbidden word(s) (${Array.from(new Set(hitList.map((oneHit) => oneHit.toLowerCase()))).join(', ')})`, where: "SPEC §2 and §5.7: outside the standards' data spans the page never says either word" }) };
	}
	return { htmlText, manifest };
};

const sha256OfFile = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const inputFileSha256ByRoleOf = ({ decisionBlockFilePath, questionMapFilePath, cardLabelFilePath }) => ({ decisionBlock: sha256OfFile(decisionBlockFilePath), questionMap: sha256OfFile(questionMapFilePath), cardLabelList: sha256OfFile(cardLabelFilePath) });

// buildReviewPageFromFiles — reads the three inputs, then builds the page; their sha256 ride on it
const buildReviewPageFromFiles = ({ decisionBlockFilePath, questionMapFilePath, cardLabelFilePath, pageSetting }) => {
	const inputFileSha256ByRole = inputFileSha256ByRoleOf({ decisionBlockFilePath, questionMapFilePath, cardLabelFilePath });
	const decisionBlock = JSON.parse(fs.readFileSync(decisionBlockFilePath, 'utf8'));
	const built = buildReviewPageHtml({ decisionBlock, questionMap: JSON.parse(fs.readFileSync(questionMapFilePath, 'utf8')), cardLabelList: JSON.parse(fs.readFileSync(cardLabelFilePath, 'utf8')), pageSetting, inputFileSha256ByRole });
	if (built.error) {
		return { error: built.error };
	}
	return { ...built, decisionBlock, inputFileSha256ByRole };
};

// verifySifReviewPage — checks a page (a local build, or a copy fetched from the live URL) against the block it must
// show. EVERY check reads the RENDERED content: HTML comments, the manifest among them, are removed first, so a phrase
// that survives only in the manifest can never pass a check (EBONY_DREAM's caution). The manifest is parsed separately
// and only for the values it declares.
const verifySifReviewPage = ({ htmlText, decisionBlock, inputFileSha256ByRole }) => {
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

	const recordList = decisionBlock.decisionRecordList;
	const expectedItemRefList = recordList.map((oneRecord) => itemRefOf({ subjectStableId: oneRecord.subjectStableId, judgmentPartitionLabel: oneRecord.judgmentPartitionLabel === undefined ? null : oneRecord.judgmentPartitionLabel }));
	const articleTextList = renderedText.match(/<article class="item" data-item-ref="[^"]*"[\s\S]*?<\/article>/g) || [];
	const itemRefList = articleTextList.map((oneArticle) => unescapeHtml(oneArticle.match(/data-item-ref="([^"]*)"/)[1]));
	addCheck('itemCount', itemRefList.length === recordList.length && String(itemRefList.length) === manifest.itemCount, `rendered ${itemRefList.length}, block ${recordList.length}, manifest ${manifest.itemCount}`);
	addCheck('itemRefsAreUnits', itemRefList.join('\n') === expectedItemRefList.join('\n') && new Set(itemRefList).size === itemRefList.length, 'each item is keyed by its unit (subjectStableId plus partition label), in the block\'s order, once');
	const candidateCountList = articleTextList.map((oneArticle) => (oneArticle.match(/<div class="alt">/g) || []).length);
	const unequalCandidateIndex = recordList.findIndex((oneRecord, recordIndex) => candidateCountList[recordIndex] !== oneRecord.renderedPoolStableIdList.length);
	addCheck('candidatesPerItem', unequalCandidateIndex === -1 && String(candidateCountList.reduce((soFar, oneCount) => soFar + oneCount, 0)) === manifest.candidateCount, unequalCandidateIndex === -1 ? `${candidateCountList.length} items, each with its pool's candidates` : `item ${unequalCandidateIndex + 1} shows ${candidateCountList[unequalCandidateIndex]} candidates, its pool has ${recordList[unequalCandidateIndex].renderedPoolStableIdList.length}`);
	const tagRadioCount = (renderedText.match(/<input type="radio" name="t_/g) || []).length;
	addCheck('tagChoicesPerItem', tagRadioCount === TAG_VALUE_LIST.length * itemRefList.length, `${tagRadioCount} radios for ${itemRefList.length} items, ${TAG_VALUE_LIST.length} choices each`);

	addCheck('feedbackTargetPath', renderedText.indexOf(`const FEEDBACK_TARGET_PATH=${JSON.stringify(manifest.feedbackTargetPath)};`) !== -1 && renderedText.indexOf(FEEDBACK_ENDPOINT_URL) !== -1, `target ${manifest.feedbackTargetPath}`);

	const handlerIdList = Array.from(new Set(Array.from(renderedText.matchAll(/document\.getElementById\('([^']+)'\)/g)).map((oneMatch) => oneMatch[1])));
	const orphanIdList = handlerIdList.filter((oneId) => renderedText.indexOf(`id="${oneId}"`) === -1);
	addCheck('handlerIdsResolve', handlerIdList.length > 0 && orphanIdList.length === 0, orphanIdList.length === 0 ? `${handlerIdList.length} ids` : `orphans: ${orphanIdList.join(', ')}`);

	const hitList = forbiddenWordHitList(renderedText);
	addCheck('ownProseClean', hitList.length === 0, hitList.join(', '));

	const shaRoleList = Object.keys(inputFileSha256ByRole);
	const unequalShaRoleList = INPUT_ROLE_LIST.filter((oneRole) => manifest[`inputSha256.${oneRole}`] !== inputFileSha256ByRole[oneRole]);
	addCheck('inputShas', shaRoleList.length === INPUT_ROLE_LIST.length && unequalShaRoleList.length === 0, unequalShaRoleList.length === 0 ? `${shaRoleList.length} roles` : `differ: ${unequalShaRoleList.join(', ')}`);

	return { pass: checkList.every((oneCheck) => oneCheck.pass), checkList };
};

module.exports = { buildReviewPageHtml, buildReviewPageFromFiles, verifySifReviewPage, inputFileSha256ByRoleOf, cardLabelHtmlOf, dataSpan, escapeHtml, ownProseTextOf, itemRefOf, PAGE_WORDING, FEEDBACK_ENDPOINT_URL, INPUT_ROLE_LIST, moduleName };
