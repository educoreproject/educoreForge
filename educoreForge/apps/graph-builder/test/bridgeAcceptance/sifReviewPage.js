'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sifReviewPage.js — THE SIF REVIEW PAGE (phase C6; plan §3 C6, SPEC §5.7 and §6 M6). App-level: it renders
// what the yardstick scorer (sifYardstickScorer.js, C5) measured, and never measures anything itself.
//
//   buildReviewPageHtml({ score, questionMap, cardLabelList, pageSetting }) → { htmlText, manifest } | { error }
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
// CARD TUPLES (phase C6b). A card is shown as its FULL TUPLE, so a reviewer can tell apart cards that share one
// property id and differ only by qualifier: domain (id), property (id), then the range option set, the value and
// each qualifier as `option set = option value (id)`, where the card has them; an empty slot is omitted. The label
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
	rangeSlot: 'range',
	valueSlot: 'value',
	hubCarriesNoCard: 'a card the hub does not carry',
	remodeledTo: 'remodeled to',
	noCardProposed: 'no card (it abstained)',
	bestRank: 'best rank of a card of the standard\'s id',
	partitionLabel: 'domain',
	sharedBlockLabel: 'block',
	tagAgree: 'I agree with the bridge',
	tagDisagree: 'I disagree with the bridge',
	tagUnsure: 'unsure',
	notePlaceholder: 'note (optional)',
	reviewerLabel: 'Your name',
	submitLabel: 'Submit tags',
	savedLabel: 'saved',
	notSavedLabel: 'Not saved: ',
	inputsLabel: 'Scored inputs (sha256)',
});
const TAG_VALUE_LIST = Object.freeze([
	{ tagValue: 'agree', labelText: PAGE_WORDING.tagAgree },
	{ tagValue: 'disagree', labelText: PAGE_WORDING.tagDisagree },
	{ tagValue: 'unsure', labelText: PAGE_WORDING.tagUnsure },
]);

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const unescapeHtml = (text) => text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const dataSpan = (text) => `${DATA_SPAN_OPEN}${escapeHtml(text)}</span>`;
const valueAt = (score, scorePath) => scorePath.split('.').reduce((soFar, oneSegment) => (soFar === undefined || soFar === null ? undefined : soFar[oneSegment]), score);
const scoreCell = (score, scorePath) => `<span class="scoreCell" data-score-path="${scorePath}">${valueAt(score, scorePath)}</span>`;
const itemRefOf = (unitVerdict) => (unitVerdict.judgmentPartitionLabel === null ? unitVerdict.subjectStableId : `${unitVerdict.subjectStableId}#${unitVerdict.judgmentPartitionLabel}`);

// ownProseTextOf — the page with every data span removed: what the wording rule governs
const ownProseTextOf = (htmlText) => htmlText.replace(DATA_SPAN_PATTERN, '');
const forbiddenWordHitList = (htmlText) => ownProseTextOf(htmlText).match(FORBIDDEN_WORD_PATTERN) || [];

// cardLabelHtmlOf — a card as the reviewer reads it, its FULL TUPLE (phase C6b): domain, property, then the range
// option set, the value and each qualifier, where the card has them. A slot the card lacks is omitted. The block
// carries stableIds only; the label list carries the tuple.
const cardLabelHtmlOf = ({ cardStableId, cardLabelList }) => {
	const cardLabel = cardLabelList.cardLabelByStableId[cardStableId];
	const slotHtmlList = [`${dataSpan(cardLabel.domainName)} (${dataSpan(cardLabel.domainId)})`, `${dataSpan(cardLabel.propertyName)} (${dataSpan(cardLabel.propertyId)})`];
	if (cardLabel.rangeOptionSetId !== undefined) {
		slotHtmlList.push(`${PAGE_WORDING.rangeSlot} ${dataSpan(cardLabel.rangeOptionSetName)} (${dataSpan(cardLabel.rangeOptionSetId)})`);
	}
	if (cardLabel.valueNotation !== undefined) {
		slotHtmlList.push(`${PAGE_WORDING.valueSlot} ${dataSpan(cardLabel.valueName)} (${dataSpan(cardLabel.valueNotation)})`);
	}
	cardLabel.qualifierRefIdList.forEach((oneRefId) => {
		const optionValueLabel = cardLabelList.optionValueLabelByRefId[oneRefId];
		slotHtmlList.push(`${dataSpan(optionValueLabel.optionSetName)} = ${dataSpan(optionValueLabel.optionValueName)} (${dataSpan(oneRefId)})`);
	});
	return slotHtmlList.join(' · ');
};

// cardLabelFaultOf — why a card cannot be shown as a tuple, or null: the label list is where data enters, so each
// slot the tuple prints must be present, and each qualifier must resolve to its human label
const cardLabelFaultOf = ({ cardStableId, cardLabelList }) => {
	const cardLabel = cardLabelList.cardLabelByStableId[cardStableId];
	if (cardLabel === undefined) {
		return 'has no entry in the card label list';
	}
	const absentSlotName = ['domainId', 'domainName', 'propertyId', 'propertyName'].find((oneSlotName) => typeof cardLabel[oneSlotName] !== 'string' || cardLabel[oneSlotName] === '');
	if (absentSlotName !== undefined) {
		return `has a card label list entry with no ${absentSlotName}`;
	}
	if (cardLabel.rangeOptionSetId !== undefined && !cardLabel.rangeOptionSetName) {
		return `has range option set ${cardLabel.rangeOptionSetId} with no name in the card label list`;
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

// the one edge where the label list meets the block: every card the page names must carry a whole tuple
const unlabelledCardOf = ({ unitVerdictList, cardLabelList }) => {
	for (let unitIndex = 0; unitIndex < unitVerdictList.length; unitIndex++) {
		const unitVerdict = unitVerdictList[unitIndex];
		const shownCardStableIdList = [unitVerdict.proposedCardStableId].concat(unitVerdict.keyCardStableIdList || []).filter((oneStableId) => oneStableId !== null);
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

const itemHtmlOf = ({ score, unitVerdict, unitIndex, question, cardLabelList }) => {
	const itemRef = itemRefOf(unitVerdict);
	const classText = unitVerdict.judgmentClass !== undefined ? unitVerdict.judgmentClass : unitVerdict.newClaim ? sifYardstickScorer.REPORT_WORDING.classNewClaim : unitVerdict.standing;
	const proposedHtml = unitVerdict.proposedCardStableId === null ? PAGE_WORDING.noCardProposed : cardLabelHtmlOf({ cardStableId: unitVerdict.proposedCardStableId, cardLabelList });
	const partList = [];
	partList.push(`<article class="item" data-item-ref="${escapeHtml(itemRef)}" data-unit-class="${classText}">`);
	partList.push(`<h3>${dataSpan(question.name)} <span class="badge">${classText}</span> <span class="standing">${unitVerdict.standing}</span></h3>`);
	partList.push(`<p class="where">${dataSpan(question.relativePath)} · ${PAGE_WORDING.sharedBlockLabel} ${dataSpan(unitVerdict.sharedBlock)}${unitVerdict.judgmentPartitionLabel === null ? '' : ` · ${PAGE_WORDING.partitionLabel} ${dataSpan(unitVerdict.judgmentPartitionLabel)}`}</p>`);
	if (question.description !== undefined) {
		partList.push(`<p class="description">${dataSpan(question.description)}</p>`);
	}
	partList.push(`<p class="line">${PAGE_WORDING.standardSpecifiesLine({ standardHtml: standardHtmlOf({ unitVerdict, cardLabelList }), proposedHtml })}</p>`);
	if (unitVerdict.bestKeyRank !== undefined && unitVerdict.bestKeyRank !== null) {
		partList.push(`<p class="rank">${PAGE_WORDING.bestRank}: ${scoreCell(score, `unitVerdictList.${unitIndex}.bestKeyRank`)}</p>`);
	}
	partList.push(`<div class="tags">${TAG_VALUE_LIST.map((oneTag) => `<label><input type="radio" name="t_${escapeHtml(itemRef)}" value="${oneTag.tagValue}"> ${oneTag.labelText}</label>`).join(' ')}</div>`);
	partList.push(`<textarea name="n_${escapeHtml(itemRef)}" placeholder="${PAGE_WORDING.notePlaceholder}"></textarea>`);
	partList.push('</article>');
	return partList.join('\n');
};

// the page's script: browser code, so async/await and try/catch are the house form here (browserCodePractices §1)
const pageScriptOf = ({ score, pageSetting, itemCount }) => `
const FEEDBACK_ENDPOINT_URL=${JSON.stringify(FEEDBACK_ENDPOINT_URL)};
const FEEDBACK_TARGET_PATH=${JSON.stringify(pageSetting.feedbackTargetPath)};
const DRAFT_STORAGE_PREFIX=${JSON.stringify(pageSetting.draftStoragePrefix)};
const REVIEWER_STORE_NAME=DRAFT_STORAGE_PREFIX+'reviewer';
const ITEM_COUNT=${itemCount};
const SCORE_GENERATION=${JSON.stringify(score.generation)};
const INPUT_SHA256_BY_ROLE=${JSON.stringify(score.inputFileSha256ByRole || {})};
function reviewerName(){try{return localStorage.getItem(REVIEWER_STORE_NAME)||'';}catch(storageFault){return '';}}
function draftStoreName(){return DRAFT_STORAGE_PREFIX+'draft::'+(reviewerName()||'anonymous');}
function collectTags(){const tagByItemRef={};document.querySelectorAll('article.item').forEach(oneItem=>{
 const checkedRadio=oneItem.querySelector('input[type=radio]:checked');const noteBox=oneItem.querySelector('textarea');
 if(checkedRadio||(noteBox&&noteBox.value)){tagByItemRef[oneItem.dataset.itemRef]={tag:checkedRadio?checkedRadio.value:null,note:noteBox?noteBox.value:'',unitClass:oneItem.dataset.unitClass};}});
 return tagByItemRef;}
function saveDraft(){try{localStorage.setItem(draftStoreName(),JSON.stringify(collectTags()));}catch(storageFault){}}
function restoreDraft(){let draftByItemRef={};try{draftByItemRef=JSON.parse(localStorage.getItem(draftStoreName())||'{}');}catch(storageFault){draftByItemRef={};}
 document.querySelectorAll('article.item').forEach(oneItem=>{const draft=draftByItemRef[oneItem.dataset.itemRef];if(!draft){return;}
  if(draft.tag){const radio=oneItem.querySelector('input[type=radio][value="'+draft.tag+'"]');if(radio){radio.checked=true;}}
  const noteBox=oneItem.querySelector('textarea');if(noteBox&&draft.note){noteBox.value=draft.note;}});}
function showTally(){document.getElementById('tagCount').textContent=document.querySelectorAll('article.item input[type=radio]:checked').length+' of '+ITEM_COUNT+' tagged';}
document.getElementById('reviewerName').value=reviewerName();
document.getElementById('reviewerName').addEventListener('change',changeEvent=>{try{localStorage.setItem(REVIEWER_STORE_NAME,changeEvent.target.value.trim());}catch(storageFault){}restoreDraft();showTally();});
document.addEventListener('change',()=>{saveDraft();showTally();});
document.addEventListener('input',saveDraft);
document.getElementById('submitTags').addEventListener('click',async()=>{
 const submitButton=document.getElementById('submitTags'),statusLine=document.getElementById('submitStatus');
 submitButton.disabled=true;statusLine.textContent='';
 const reviewer=reviewerName()||'anonymous';
 const payload={page:document.title,scoreGeneration:SCORE_GENERATION,inputSha256ByRole:INPUT_SHA256_BY_ROLE,reviewer:reviewer,submittedAt:new Date().toISOString(),tags:collectTags()};
 const suffix='-'+reviewer.replace(/[^A-Za-z0-9]+/g,'')+'-'+new Date().toISOString().slice(11,19).replace(/:/g,'');
 try{const response=await fetch(FEEDBACK_ENDPOINT_URL,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({filePath:FEEDBACK_TARGET_PATH.replace(/\\.json$/,suffix+'.json'),body:JSON.stringify(payload,null,1)})});
  if(!response.ok){statusLine.textContent=${JSON.stringify(PAGE_WORDING.notSavedLabel)}+await response.text();submitButton.disabled=false;return;}
  const writtenList=JSON.parse(await response.text());
  statusLine.textContent=${JSON.stringify(PAGE_WORDING.savedLabel)}+' \\u2192 '+writtenList[0].writtenPath.split('/').pop()+' at '+new Date().toLocaleTimeString();
  submitButton.disabled=false;}
 catch(sendFault){statusLine.textContent=${JSON.stringify(PAGE_WORDING.notSavedLabel)}+sendFault.message;submitButton.disabled=false;}});
restoreDraft();showTally();
`;

const PAGE_STYLE = `
:root{--ink:#1d2330;--paper:#fbfaf7;--rule:#d9d4c7;--accent:#5b4a8b;--muted:#6b6f7a}
@media (prefers-color-scheme: dark){:root{--ink:#e7e4dc;--paper:#1b1d24;--rule:#3a3d48;--accent:#b3a4e0;--muted:#9a9ea8}}
body{background:var(--paper);color:var(--ink);font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0 auto;max-width:980px;padding:16px}
table{border-collapse:collapse}td,th{border-bottom:1px solid var(--rule);padding:4px 8px;text-align:right}th:first-child,td:first-child{text-align:left}
.scoreCell{font-weight:600}.item{border:1px solid var(--rule);border-radius:6px;margin:12px 0;padding:8px 12px}
.badge{background:var(--accent);border-radius:4px;color:var(--paper);font-size:12px;padding:1px 6px}.standing,.where,.rank{color:var(--muted);font-size:13px}
textarea{box-sizing:border-box;width:100%}#submitBar{background:var(--paper);border-top:1px solid var(--rule);bottom:0;padding:8px 0;position:sticky}
`;

// buildReviewPageHtml — pure: the page for one score
const buildReviewPageHtml = ({ score, questionMap, cardLabelList, pageSetting }) => {
	const pageSettingFault = pageSettingFaultOf(pageSetting);
	if (pageSettingFault !== null) {
		return { error: refuse.byName({ moduleName, what: pageSettingFault, where: 'the page setting names where replies land (feedbackTargetPath, relative to the webdev root, ending .json), the draft store prefix and the title; none has a default' }) };
	}
	const unlabelled = unlabelledCardOf({ unitVerdictList: score.unitVerdictList, cardLabelList });
	if (unlabelled !== null) {
		return { error: refuse.byName({ moduleName, what: `card ${unlabelled.cardStableId} (unit ${unlabelled.subjectStableId}) ${unlabelled.faultText}`, where: 'the label list must carry the whole tuple of every card the page names (each unit\'s proposed card and its standard\'s cards), each qualifier with its option value name; the block carries stableIds only' }) };
	}
	const questionByRefId = {};
	questionMap.questionList.forEach((oneQuestion) => {
		questionByRefId[oneQuestion.questionRefId] = oneQuestion;
	});

	const itemHtmlList = score.unitVerdictList.map((unitVerdict, unitIndex) => itemHtmlOf({ score, unitVerdict, unitIndex, question: questionByRefId[unitVerdict.subjectStableId.slice(SUBJECT_STABLE_ID_PREFIX.length)], cardLabelList }));
	const bodyHtml = [
		`<h1>${escapeHtml(pageSetting.pageTitle)}</h1>`,
		`<p class="where">${dataSpan(score.generation)}</p>`,
		summaryHtmlOf({ score }),
		`<section id="items"><h2>${PAGE_WORDING.itemsHeading}</h2>`,
		itemHtmlList.join('\n'),
		'</section>',
		`<div id="submitBar"><label>${PAGE_WORDING.reviewerLabel} <input id="reviewerName" type="text"></label> <button id="submitTags" type="button">${PAGE_WORDING.submitLabel}</button> <span id="tagCount"></span> <span id="submitStatus"></span></div>`,
	].join('\n');
	const scoreCellCount = (bodyHtml.match(SCORE_CELL_PATTERN) || []).length;
	const manifest = {
		itemCount: score.unitVerdictList.length,
		scoreCellCount,
		feedbackTargetPath: pageSetting.feedbackTargetPath,
		draftStoragePrefix: pageSetting.draftStoragePrefix,
		scoreGeneration: score.generation,
		...Object.keys(score.inputFileSha256ByRole || {}).reduce((soFar, oneRole) => ({ ...soFar, [`inputSha256.${oneRole}`]: score.inputFileSha256ByRole[oneRole] }), {}),
	};
	const manifestText = `<!--\n${MANIFEST_TITLE}\n${Object.keys(manifest).map((oneName) => `${oneName}=${manifest[oneName]}`).join('\n')}\n-->`;
	const htmlText = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(pageSetting.pageTitle)}</title>\n${manifestText}\n<style>${PAGE_STYLE}</style></head>\n<body>\n${bodyHtml}\n<script>${pageScriptOf({ score, pageSetting, itemCount: manifest.itemCount })}</script>\n</body></html>\n`;

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
	const built = buildReviewPageHtml({ score: scored.score, questionMap: JSON.parse(fs.readFileSync(questionMapFilePath, 'utf8')), cardLabelList: JSON.parse(fs.readFileSync(cardLabelFilePath, 'utf8')), pageSetting });
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
