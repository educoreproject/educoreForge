#!/usr/bin/env node
'use strict';

// test-sifReviewPage.js — the gates for sifReviewPage.js (phases C6, C6b, C6c), over sifReviewPageFixtures/: a decision block
// (units, pools and judge answers), a question map and a card label list (full tuples). The page reads no score and
// carries no comparison with the standard's own annotation (TQ, 2026-09-29), so C6's gates that tied page numbers to the C5
// score are retired and a gate that the page carries none of that comparison takes their place.
//
//   SIF-PAGE-A       items are keyed by unit, never position; the page carries no comparison with the standard
//   SIF-PAGE-VERIFY  the verify-against-deployed step reads rendered content only: items, candidates, tags, feedback target
//   SIF-PAGE-C       the page's own prose never says either forbidden word; data and judge text that do render
//   SIF-PAGE-REFUSE  the named refusals where the label list and the page setting enter
//   SIF-PAGE-TUPLE   every card renders as its full tuple (three range shapes, qualifiers labelled); the layout: source text,
//                    pick, rationale, the whole pool with the pick marked, four tags, facets, the Details numbers
//
// Every conjunct is observed red under its own twin (forge-framework gateSuiteRunner). Hermetic: no graph, no Docker, no
// network.
//
// Run: PATH=/usr/local/bin:$PATH node apps/graph-builder/test/bridgeAcceptance/test-sifReviewPage.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- the SIF review page's gates: unit keys, no comparison with the standard, verify step, wording scan, tuples, layout, refusals

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const { runGateFamily } = require('../../../../lib/forge-framework/test/testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../../../../lib/forge-framework/roundTripHarness/twinRegistry');
const moduleDouble = require('../../../../lib/forge-framework/test/testSupport/moduleDouble');

const PAGE_FILE_PATH = path.join(__dirname, 'sifReviewPage.js');
const PAGE_FIXTURE_DIRECTORY_PATH = path.join(__dirname, 'sifReviewPageFixtures');
const FIXTURE_FILE_PATH_BY_ROLE = Object.freeze({
	decisionBlock: path.join(PAGE_FIXTURE_DIRECTORY_PATH, 'sifReviewPageFixtureBlock.json'),
	questionMap: path.join(PAGE_FIXTURE_DIRECTORY_PATH, 'sifReviewPageFixtureQuestionMap.json'),
	cardLabelList: path.join(PAGE_FIXTURE_DIRECTORY_PATH, 'sifReviewPageFixtureCardLabelList.json'),
	miloAssessments: path.join(PAGE_FIXTURE_DIRECTORY_PATH, 'sifReviewPageFixtureMiloAssessments.json'),
});
const PAGE_SETTING = Object.freeze({ feedbackTargetPath: 'educoreForge/system/dataStores/bridgeAcceptance/sif260928/feedback/c6FixtureTags.json', draftStoragePrefix: 'sifReviewPageFixture::', pageTitle: 'SIF review page (C6 fixture)', roundNumber: 1 });
const INPUT_FILE_SHA256_BY_ROLE = Object.freeze({ decisionBlock: 'shaOfTheBlock', questionMap: 'shaOfTheQuestionMap', cardLabelList: 'shaOfTheLabelList' });

// the test's OWN scan and span pattern, written independently of the page module's
const TEST_FORBIDDEN_WORD_LIST = Object.freeze(['error', 'wrong']);
const TEST_DATA_SPAN_PATTERN = /<span data-source="standard">[^<]*<\/span>/g;
const TEST_TAG_PATTERN = /<[^>]*>/g;
const ERROR_BEARING_DATA_LABEL = 'Standard Error of Measurement';
// the phrases of the comparison with the standard's own annotation (TQ: "remove it entirely"), none of which may appear
const TEST_COMPARISON_PHRASE_LIST = Object.freeze(['the standard specifies', 'agrees-target', 'agrees-key', 'abstained-where-specified', 'new-claim', 'not-retrieved', 'best rank', 'contended', 'unannotated', 'scoreCell', 'data-score-path']);

const readFixtureSet = () => Object.keys(FIXTURE_FILE_PATH_BY_ROLE).reduce((soFar, oneRole) => ({ ...soFar, [oneRole]: JSON.parse(fs.readFileSync(FIXTURE_FILE_PATH_BY_ROLE[oneRole], 'utf8')) }), {});
const makeSubject = () => ({ fixtureSet: readFixtureSet(), pageSetting: { ...PAGE_SETTING }, pageMutationList: [], htmlTamperList: [], withMilo: false });
const cloneSubject = (subject) => ({ fixtureSet: JSON.parse(JSON.stringify(subject.fixtureSet)), pageSetting: { ...subject.pageSetting }, pageMutationList: subject.pageMutationList.slice(), htmlTamperList: subject.htmlTamperList.slice(), withMilo: subject.withMilo });

const testScanHitList = (htmlText) => TEST_FORBIDDEN_WORD_LIST.filter((oneWord) => htmlText.replace(TEST_DATA_SPAN_PATTERN, '').toLowerCase().indexOf(oneWord) !== -1);
const escapeForPattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const itemHtmlOf = (htmlText, itemRef) => (htmlText.match(new RegExp(`<article class="item" data-item-ref="${escapeForPattern(itemRef)}"[\\s\\S]*?<\\/article>`)) || [''])[0];
const candidateTextListOf = (htmlText, itemRef) => Array.from(itemHtmlOf(htmlText, itemRef).matchAll(/<code class="dc alt">([\s\S]*?)<\/code>/g)).map((oneMatch) => oneMatch[1].replace(TEST_TAG_PATTERN, ''));
const answerCellTextListOf = (htmlText, itemRef) => Array.from(itemHtmlOf(htmlText, itemRef).matchAll(/<code class="dc pic[^"]*">([\s\S]*?)<\/code>/g)).map((oneMatch) => oneMatch[1].replace(TEST_TAG_PATTERN, ''));

// runPage — the real module, or an in-memory double when a twin mutated its source. A throw is a MEASURED OUTCOME: a twin
// that deletes a refusal can crash the page unnamed, and that crash must read as a red.
const runPage = (subject, fixtureSet) => {
	const pageModule = subject.pageMutationList.length === 0 ? require(PAGE_FILE_PATH) : moduleDouble.loadWithMutations({ modulePath: PAGE_FILE_PATH, mutationList: subject.pageMutationList });
	try {
		const built = pageModule.buildReviewPageHtml({ decisionBlock: fixtureSet.decisionBlock, questionMap: fixtureSet.questionMap, cardLabelList: fixtureSet.cardLabelList, pageSetting: subject.pageSetting, inputFileSha256ByRole: { ...INPUT_FILE_SHA256_BY_ROLE }, miloAssessmentByItemKey: subject.withMilo ? fixtureSet.miloAssessments : undefined });
		if (built.error) {
			return { error: built.error };
		}
		return { htmlText: subject.htmlTamperList.reduce((soFar, oneTamper) => oneTamper(soFar), built.htmlText), pageModule, decisionBlock: fixtureSet.decisionBlock };
	} catch (pageThrow) {
		return { thrownFromPage: pageThrow.message };
	}
};

const pageConjunct = ({ conjunctId, title, twinNameList, shape, judge }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (subject, callback) => {
		if (shape) {
			shape(subject);
		}
		callback('', judge(runPage(subject, subject.fixtureSet), subject));
	},
});
const builtJudge = (judgePage) => (outcome, subject) => (outcome.thrownFromPage !== undefined ? { pass: false, detail: `the page crashed: ${outcome.thrownFromPage}` } : outcome.error ? { pass: false, detail: `the page refused: ${outcome.error.message.slice(0, 200)}` } : judgePage(outcome, subject));
const refusalJudge = (regex) => (outcome) => {
	if (outcome.thrownFromPage !== undefined) {
		return { pass: false, detail: `NOT A REFUSAL — the page crashed, naming nothing: ${outcome.thrownFromPage}` };
	}
	if (!outcome.error) {
		return { pass: false, detail: 'expected a refusal but the page was BUILT' };
	}
	return regex.test(outcome.error.message) ? { pass: true, detail: outcome.error.message.slice(0, 200) } : { pass: false, detail: `refused for another reason: ${outcome.error.message.slice(0, 200)}` };
};

const twinRegistry = makeTwinRegistry();
const registerTwin = ({ gateId, conjunctId, twinName, leverKind, mutate }) => twinRegistry.register({ gateId, conjunctId, twinName, leverKind, shippedConfig: true, run: (subject) => {
	mutate(subject);
	return subject;
} });
const registerPageMutationTwin = ({ gateId, conjunctId, twinName, mutationList }) => {
	mutationList.forEach((oneMutation) => moduleDouble.assertMutationApplies({ modulePath: PAGE_FILE_PATH, find: oneMutation.find }));
	registerTwin({ gateId, conjunctId, twinName, leverKind: 'productionMutation', mutate: (subject) => mutationList.forEach((oneMutation) => subject.pageMutationList.push({ modulePath: PAGE_FILE_PATH, find: oneMutation.find, replace: oneMutation.replace })) });
};

// ---- GATE (a): units, and no comparison with the standard ----
const GATE_A = 'SIF-PAGE-A';
const EXPECTED_ITEM_REF_LIST = Object.freeze([
	'sif260928:question/q01#Dom Student', 'sif260928:question/q02#Dom Student', 'sif260928:question/q03#Dom Student', 'sif260928:question/q04#Dom Student', 'sif260928:question/q05#Dom Student',
	'sif260928:question/q05#Dom Staff', 'sif260928:question/q06', 'sif260928:question/q07', 'sif260928:question/q08#Dom Student', 'sif260928:question/q09#Dom Student',
	'sif260928:question/q10#Dom Student', 'sif260928:question/q11#Dom Student', 'sif260928:question/q12#Dom Student', 'sif260928:question/q12#Dom Staff', 'sif260928:question/q13#Dom Student',
]);
const gateAConjunctList = [
	pageConjunct({
		conjunctId: 'a3_itemsKeyedByUnit',
		title: 'there is one item per unit of the block, keyed by subjectStableId plus partition label (none for a unit with no domain), in the block\'s order, never by position',
		twinNameList: ['itemKeyedByPosition'],
		judge: builtJudge((outcome) => {
			const itemRefList = Array.from(outcome.htmlText.matchAll(/<article class="item" data-item-ref="([^"]*)"/g)).map((oneMatch) => oneMatch[1]);
			return { pass: JSON.stringify(itemRefList) === JSON.stringify(EXPECTED_ITEM_REF_LIST), detail: `item refs ${itemRefList.slice(0, 3).join(', ')}…` };
		}),
	}),
	pageConjunct({
		conjunctId: 'a4_noComparisonWithStandard',
		title: "the page carries none of the comparison with the standard's own annotation: no 'the standard specifies' line, no class name, no rank, no score cell (TQ: remove it entirely)",
		twinNameList: ['comparisonLineRestored'],
		judge: builtJudge((outcome) => {
			const visibleText = outcome.htmlText.replace(TEST_DATA_SPAN_PATTERN, '');
			const hitList = TEST_COMPARISON_PHRASE_LIST.filter((onePhrase) => visibleText.indexOf(onePhrase) !== -1);
			return { pass: hitList.length === 0, detail: hitList.length === 0 ? 'none of the comparison phrases' : `found: ${hitList.join(', ')}` };
		}),
	}),
];
registerPageMutationTwin({ gateId: GATE_A, conjunctId: 'a3_itemsKeyedByUnit', twinName: 'itemKeyedByPosition', mutationList: [{ find: 'const itemRef = itemRefOf(unit);', replace: 'const itemRef = String(unitIndex);' }] });
registerPageMutationTwin({ gateId: GATE_A, conjunctId: 'a4_noComparisonWithStandard', twinName: 'comparisonLineRestored', mutationList: [{ find: '<div class="body">\\n${sourceHtml}\\n${pickHtml}', replace: '<div class="body">\\n${sourceHtml}\\n<p class="line">the standard specifies P000001</p>\\n${pickHtml}' }] });

// ---- the verify step reads rendered content only ----
const GATE_V = 'SIF-PAGE-VERIFY';
const firstItemPattern = /<article class="item"[\s\S]*?<\/article>/;
const gateVConjunctList = [
	pageConjunct({
		conjunctId: 'v1_verifyPassesOnRenderedContent',
		title: 'verifySifReviewPage passes the built page, reading only rendered content (comments and the manifest removed): items, candidates, tags, feedback target, handler ids, wording, input shas',
		twinNameList: ['visibleItemMovedIntoComment', 'feedbackPathOnlyInManifest', 'oneTagRadioRemoved', 'oneCandidateRemoved', 'inputShaAltered'],
		judge: builtJudge((outcome) => {
			const verified = outcome.pageModule.verifySifReviewPage({ htmlText: outcome.htmlText, decisionBlock: outcome.decisionBlock, inputFileSha256ByRole: { ...INPUT_FILE_SHA256_BY_ROLE } });
			return { pass: verified.pass, detail: verified.checkList.filter((oneCheck) => !oneCheck.pass).map((oneCheck) => `${oneCheck.checkName}: ${oneCheck.detail}`).join('; ') || `${verified.checkList.length} checks pass` };
		}),
	}),
];
// EBONY_DREAM's twin: the visible item is gone while the manifest (and a comment carrying the item) remain
registerTwin({ gateId: GATE_V, conjunctId: 'v1_verifyPassesOnRenderedContent', twinName: 'visibleItemMovedIntoComment', leverKind: 'inputFault', mutate: (subject) => {
	subject.htmlTamperList.push((htmlText) => htmlText.replace(firstItemPattern, (itemText) => `<!-- ${itemText} -->`));
} });
registerTwin({ gateId: GATE_V, conjunctId: 'v1_verifyPassesOnRenderedContent', twinName: 'feedbackPathOnlyInManifest', leverKind: 'inputFault', mutate: (subject) => {
	subject.htmlTamperList.push((htmlText) => htmlText.replace(/const FEEDBACK_TARGET_PATH=[^\n]*\n/, ''));
} });
registerTwin({ gateId: GATE_V, conjunctId: 'v1_verifyPassesOnRenderedContent', twinName: 'oneTagRadioRemoved', leverKind: 'inputFault', mutate: (subject) => {
	subject.htmlTamperList.push((htmlText) => htmlText.replace(/ <label><input type="radio" name="t_[^>]*value="maybe"> Maybe<\/label>\n/, ''));
} });
registerTwin({ gateId: GATE_V, conjunctId: 'v1_verifyPassesOnRenderedContent', twinName: 'oneCandidateRemoved', leverKind: 'inputFault', mutate: (subject) => {
	subject.htmlTamperList.push((htmlText) => htmlText.replace('<div class="alt">', '<div class="altGone">'));
} });
registerTwin({ gateId: GATE_V, conjunctId: 'v1_verifyPassesOnRenderedContent', twinName: 'inputShaAltered', leverKind: 'inputFault', mutate: (subject) => {
	subject.htmlTamperList.push((htmlText) => htmlText.replace('inputSha256.decisionBlock=shaOfTheBlock', 'inputSha256.decisionBlock=someOtherSha'));
} });

// ---- GATE (c): the words the page never says, in its own prose ----
const GATE_C = 'SIF-PAGE-C';
const gateCConjunctList = [
	pageConjunct({
		conjunctId: 'c1_ownProseClean',
		title: "the rendered page with the standards' data spans removed (templates, wording, labels, script) contains neither 'error' nor 'wrong', by the test's own scan",
		twinNameList: ['templateRowCarriesForbiddenWord'],
		judge: builtJudge((outcome) => {
			const hitList = testScanHitList(outcome.htmlText);
			return { pass: hitList.length === 0, detail: hitList.length === 0 ? 'no forbidden word' : `forbidden word(s) found: ${hitList.join(', ')}` };
		}),
	}),
	pageConjunct({
		conjunctId: 'c2_dataLabelWithForbiddenWordRenders',
		title: `a card label from the data reading '${ERROR_BEARING_DATA_LABEL}' renders, inside a data span, without refusal`,
		twinNameList: ['dataSpanUntagged'],
		shape: (subject) => {
			subject.fixtureSet.cardLabelList.cardLabelByStableId['card:X'].propertyName = ERROR_BEARING_DATA_LABEL;
		},
		judge: builtJudge((outcome) => {
			const shownInDataSpan = outcome.htmlText.indexOf(`<span data-source="standard">${ERROR_BEARING_DATA_LABEL}</span>`) !== -1;
			return { pass: shownInDataSpan, detail: shownInDataSpan ? 'rendered in a data span' : 'the label is not in a data span' };
		}),
	}),
	pageConjunct({
		conjunctId: 'c3_pageRefusesOwnProseWord',
		title: 'a page whose own prose would carry a forbidden word (the title) is refused by name, never emitted',
		twinNameList: ['selfScanRemoved'],
		shape: (subject) => {
			subject.pageSetting.pageTitle = 'a wrong title';
		},
		judge: refusalJudge(/own prose carries 2 forbidden word\(s\) \(wrong\)/),
	}),
];
// the wording row carries the word AND the page's own scan is removed, so the red is the TEST's scan's
registerPageMutationTwin({ gateId: GATE_C, conjunctId: 'c1_ownProseClean', twinName: 'templateRowCarriesForbiddenWord', mutationList: [{ find: "tagMaybe: 'Maybe',", replace: "tagMaybe: 'wrong'," }, { find: 'if (hitList.length > 0) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_C, conjunctId: 'c2_dataLabelWithForbiddenWordRenders', twinName: 'dataSpanUntagged', mutationList: [{ find: 'const dataSpan = (text) => `${DATA_SPAN_OPEN}${escapeHtml(text)}</span>`;', replace: 'const dataSpan = (text) => `<span>${escapeHtml(text)}</span>`;' }] });
registerPageMutationTwin({ gateId: GATE_C, conjunctId: 'c3_pageRefusesOwnProseWord', twinName: 'selfScanRemoved', mutationList: [{ find: 'if (hitList.length > 0) {', replace: 'if (false) {' }] });

// ---- the refusals where the label list and the page setting enter ----
const GATE_R = 'SIF-PAGE-REFUSE';
const gateRConjunctList = [
	pageConjunct({
		conjunctId: 'r1_unlabelledCardRefused',
		title: 'a card the page would name with no entry in the label list (card:Y, first in the pool of q03) is refused by name',
		twinNameList: ['labelCheckDeleted'],
		shape: (subject) => {
			delete subject.fixtureSet.cardLabelList.cardLabelByStableId['card:Y'];
		},
		judge: refusalJudge(/card card:Y \(unit sif260928:question\/q03\) has no entry in the card label list/),
	}),
	pageConjunct({
		conjunctId: 'r2_feedbackTargetNotJsonRefused',
		title: 'a feedbackTargetPath that is not a relative path ending .json is refused by name',
		twinNameList: ['pageSettingCheckDeleted'],
		shape: (subject) => {
			subject.pageSetting.feedbackTargetPath = 'educoreForge/feedback/tags.txt';
		},
		judge: refusalJudge(/feedbackTargetPath 'educoreForge\/feedback\/tags\.txt' is not a relative path ending \.json/),
	}),
];
registerPageMutationTwin({ gateId: GATE_R, conjunctId: 'r1_unlabelledCardRefused', twinName: 'labelCheckDeleted', mutationList: [{ find: 'if (unlabelled !== null) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_R, conjunctId: 'r2_feedbackTargetNotJsonRefused', twinName: 'pageSettingCheckDeleted', mutationList: [{ find: 'if (pageSettingFault !== null) {', replace: 'if (false) {' }] });

// ---- GATE (t): every card is shown as its full tuple, and the layout (phases C6b, C6c) ----
// THE FROZEN TEXTS, worked by hand from the fixture label list (sifReviewPageFixtureCardLabelList.json): card:B1 and card:B2
// share domain C000001 and property P000002 and differ only by qualifier (OV900001 'Kind One', OV900002 'Kind Two', both of
// option set 'Beta Type'); card:A1 has an option-set range, card:D1 a datatype range and a value, card:X a datatype range,
// card:Z a class range.
const GATE_T = 'SIF-PAGE-TUPLE';
const TUPLE_B1_TEXT = 'Dom Student (C000001) · Beta (P000002) · range datatype string · Beta Type = Kind One (OV900001)';
const TUPLE_B2_TEXT = 'Dom Student (C000001) · Beta (P000002) · range datatype string · Beta Type = Kind Two (OV900002)';
const TUPLE_A1_TEXT = 'Dom Student (C000001) · Alpha (P000001) · range option set Alpha Set (OS000001)';
const TUPLE_D1_TEXT = 'Dom Student (C000001) · Delta (P000004) · range datatype date · value Delta One (DeltaOne)';
const TUPLE_X_TEXT = 'Dom Other (C000009) · Chi (P000009) · range datatype token';
const TUPLE_Y_TEXT = 'Dom Other (C000009) · Upsilon (P000010) · range datatype decimal';
const TUPLE_Z_TEXT = 'Dom Other (C000009) · Zeta (P000011) · range class Zeta Class (C000077)';
// each item's candidates, from the fixture block's rendered pools in pool order
const EXPECTED_CANDIDATE_TEXT_LIST_BY_ITEM_REF = Object.freeze({
	'sif260928:question/q01#Dom Student': [TUPLE_A1_TEXT, TUPLE_X_TEXT],
	'sif260928:question/q03#Dom Student': [TUPLE_A1_TEXT, TUPLE_X_TEXT, TUPLE_Y_TEXT, TUPLE_Z_TEXT],
	'sif260928:question/q05#Dom Student': [TUPLE_B1_TEXT, TUPLE_B2_TEXT],
	'sif260928:question/q06': [TUPLE_B2_TEXT, TUPLE_X_TEXT, TUPLE_Y_TEXT],
	'sif260928:question/q07': [TUPLE_D1_TEXT, TUPLE_X_TEXT],
	'sif260928:question/q08#Dom Student': [TUPLE_X_TEXT],
});
// the summary's CEDS cells for a pick (domain., property., range name) and for an abstention
const EXPECTED_ANSWER_CELL_LIST_BY_ITEM_REF = Object.freeze({
	'sif260928:question/q01#Dom Student': ['Dom Student.', 'Alpha.', 'Alpha Set'],
	'sif260928:question/q07': ['Dom Student.', 'Delta.', 'date'],
	'sif260928:question/q03#Dom Student': ['NONE', '— the judge declined'],
});
const gateTConjunctList = [
	pageConjunct({
		conjunctId: 't1_everyCardShowsFullTuple',
		title: "each item's candidates are its pool in pool order, each rendered exactly as its full tuple: domain and property with their ids, then the range, the value or each qualifier where the card has one; the summary's answer cells are domain, property and the range name",
		twinNameList: ['propertyIdDropped'],
		judge: builtJudge((outcome) => {
			const unequalItemRefList = Object.keys(EXPECTED_CANDIDATE_TEXT_LIST_BY_ITEM_REF).filter((oneItemRef) => JSON.stringify(candidateTextListOf(outcome.htmlText, oneItemRef)) !== JSON.stringify(EXPECTED_CANDIDATE_TEXT_LIST_BY_ITEM_REF[oneItemRef]))
				.concat(Object.keys(EXPECTED_ANSWER_CELL_LIST_BY_ITEM_REF).filter((oneItemRef) => JSON.stringify(answerCellTextListOf(outcome.htmlText, oneItemRef)) !== JSON.stringify(EXPECTED_ANSWER_CELL_LIST_BY_ITEM_REF[oneItemRef])));
			return { pass: unequalItemRefList.length === 0, detail: unequalItemRefList.length === 0 ? 'all candidate lists and answer cells equal' : `${unequalItemRefList[0]} shows: ${candidateTextListOf(outcome.htmlText, unequalItemRefList[0]).join(' | ')}` };
		}),
	}),
	pageConjunct({
		conjunctId: 't2_qualifierNeverRawId',
		title: 'every qualifier id on the page is preceded by its option set and option value names; no qualifier renders as a raw id',
		twinNameList: ['qualifierLabelDropped'],
		judge: builtJudge((outcome) => {
			const allCandidateText = Object.keys(EXPECTED_CANDIDATE_TEXT_LIST_BY_ITEM_REF).map((oneItemRef) => candidateTextListOf(outcome.htmlText, oneItemRef).join('\n')).join('\n');
			const qualifierIdCount = (allCandidateText.match(/OV\d+/g) || []).length;
			const labelledCount = (allCandidateText.match(/Beta Type = Kind (One|Two) \(OV\d+\)/g) || []).length;
			return { pass: qualifierIdCount > 0 && qualifierIdCount === labelledCount, detail: `${qualifierIdCount} qualifier ids, ${labelledCount} with their labels` };
		}),
	}),
	pageConjunct({
		conjunctId: 't3_sameIdCardsDistinguishable',
		title: 'the two cards of P000002 (one property id, qualifier the only difference) render as two different texts, each carrying its own qualifier label, in q05',
		twinNameList: ['qualifierSlotOmitted'],
		judge: builtJudge((outcome) => {
			const cardTextList = candidateTextListOf(outcome.htmlText, 'sif260928:question/q05#Dom Student');
			return { pass: cardTextList.length === 2 && cardTextList[0] !== cardTextList[1] && cardTextList[0].indexOf('Kind One') !== -1 && cardTextList[1].indexOf('Kind Two') !== -1, detail: cardTextList.join(' | ') };
		}),
	}),
	pageConjunct({
		conjunctId: 't4_emptySlotsOmitted',
		title: "a slot the card lacks (value, qualifier) is omitted: no 'null', no 'undefined', no empty slot, in any candidate or summary cell",
		twinNameList: ['emptySlotPrinted'],
		judge: builtJudge((outcome) => {
			const allText = Object.keys(EXPECTED_CANDIDATE_TEXT_LIST_BY_ITEM_REF).map((oneItemRef) => candidateTextListOf(outcome.htmlText, oneItemRef).concat(answerCellTextListOf(outcome.htmlText, oneItemRef)).join('\n')).join('\n');
			const emptySlotHit = /null|undefined|\(\)| ·  ·| · $/m.test(allText);
			return { pass: !emptySlotHit, detail: emptySlotHit ? 'an empty slot is printed' : 'no empty slot printed' };
		}),
	}),
	pageConjunct({
		conjunctId: 't5_everyRangeShapeShown',
		title: "the four candidates of q03's pool (an option set, a datatype, a datatype, a class) each render their range in its own shape, in pool order",
		twinNameList: ['classRangeDropped'],
		judge: builtJudge((outcome) => {
			const candidateTextList = candidateTextListOf(outcome.htmlText, 'sif260928:question/q03#Dom Student');
			return { pass: JSON.stringify(candidateTextList) === JSON.stringify([TUPLE_A1_TEXT, TUPLE_X_TEXT, TUPLE_Y_TEXT, TUPLE_Z_TEXT]), detail: candidateTextList.join(' | ') };
		}),
	}),
	pageConjunct({
		conjunctId: 't6_poolListedPickMarked',
		title: "q02's pool (two candidates, card:X picked) lists both in pool order and marks the pick on the second only; q03 (abstained) marks none",
		twinNameList: ['pickNotMarked'],
		judge: builtJudge((outcome) => {
			const markCountOf = (oneItemRef) => (itemHtmlOf(outcome.htmlText, oneItemRef).match(/<span class="bdg mark">picked<\/span>/g) || []).length;
			const q02CandidateList = candidateTextListOf(outcome.htmlText, 'sif260928:question/q02#Dom Student');
			const q02PickIsSecond = /<div class="alt"><span class="ordn">2<\/span>[\s\S]*?<span class="bdg mark">picked<\/span>/.test(itemHtmlOf(outcome.htmlText, 'sif260928:question/q02#Dom Student'));
			return { pass: JSON.stringify(q02CandidateList) === JSON.stringify([TUPLE_A1_TEXT, TUPLE_X_TEXT]) && markCountOf('sif260928:question/q02#Dom Student') === 1 && markCountOf('sif260928:question/q03#Dom Student') === 0 && q02PickIsSecond, detail: `q02 candidates ${q02CandidateList.length}, marks q02 ${markCountOf('sif260928:question/q02#Dom Student')}, q03 ${markCountOf('sif260928:question/q03#Dom Student')}` };
		}),
	}),
	pageConjunct({
		conjunctId: 't7_judgeRationaleShown',
		title: "q02 shows the judge's rationale exactly as the block carries it",
		twinNameList: ['rationaleDropped'],
		judge: builtJudge((outcome) => {
			const rationaleText = (itemHtmlOf(outcome.htmlText, 'sif260928:question/q02#Dom Student').match(/<span class="lbl">judge said<\/span>([\s\S]*?)<\/div>/) || [null, ''])[1].replace(TEST_TAG_PATTERN, '');
			return { pass: rationaleText === 'The source means card:X (fixture rationale 1).', detail: rationaleText };
		}),
	}),
	pageConjunct({
		conjunctId: 't8_judgeTextIsData',
		title: "a rationale that says 'wrong' and 'Error' renders (it is the judge's text, in a data span) without refusal",
		twinNameList: ['rationaleUntagged'],
		shape: (subject) => {
			subject.fixtureSet.decisionBlock.decisionRecordList[1].judge.rationale = 'It is not wrong to call this an Error of Measurement.';
		},
		judge: builtJudge((outcome) => ({ pass: outcome.htmlText.indexOf('<span data-source="standard">It is not wrong to call this an Error of Measurement.</span>') !== -1, detail: 'checked for the rationale in a data span' })),
	}),
	pageConjunct({
		conjunctId: 't9_fourTagsAndNote',
		title: 'every item offers Yes, No, Maybe and No Valid Candidate, and a note',
		twinNameList: ['maybeTagMissing'],
		judge: builtJudge((outcome) => {
			const articleList = outcome.htmlText.match(/<article class="item"[\s\S]*?<\/article>/g);
			const everyItemOffersAll = articleList.length === 15 && articleList.every((oneArticle) => ['yes', 'no', 'maybe', 'noValidCandidate'].every((oneValue) => oneArticle.indexOf('type="radio" name="t_') !== -1 && new RegExp(`value="${oneValue}">`).test(oneArticle)) && /<input class="note" type="text" name="n_/.test(oneArticle));
			return { pass: everyItemOffersAll, detail: `${articleList.length} items` };
		}),
	}),
	pageConjunct({
		conjunctId: 't10_sourceElementShown',
		title: "q01's item shows the SIF element's own text: its objects, description, path, block, domain and the number of fields in the unit (1)",
		twinNameList: ['sourceTextDropped'],
		judge: builtJudge((outcome) => {
			const sourceText = ((itemHtmlOf(outcome.htmlText, 'sif260928:question/q01#Dom Student').match(/<div class="srcbox">([\s\S]*?)<div class="pickbox/) || [null, ''])[1]).replace(TEST_TAG_PATTERN, ' ').replace(/\s+/g, ' ').trim();
			const everyPartShown = sourceText === 'SIF element ObjectOfBirthDate The date of birth. path a block model domain Dom Student fields in this unit 1';
			return { pass: everyPartShown, detail: sourceText.slice(0, 200) };
		}),
	}),
	pageConjunct({
		conjunctId: 'f1_facetCountsMeasured',
		title: 'the filter boxes carry the counts worked from the fixture block: matched 13, abstained 2; judge category strong 4, moderate 5, weak but real 4, none 2; block model 11, SIF_Metadata 2, SIF_ExtendedElements 2; domain Dom Student 11, Dom Staff 2, none 2',
		twinNameList: ['facetCountNotMeasured'],
		judge: builtJudge((outcome) => {
			const wantedList = [['outcome', 'picked', 13], ['outcome', 'abstained', 2], ['cat', 'strong', 4], ['cat', 'moderate', 5], ['cat', 'weakButReal', 4], ['cat', 'none', 2], ['block', 'model', 11], ['block', 'SIF_Metadata', 2], ['block', 'SIF_ExtendedElements', 2], ['domain', 'Dom Student', 11], ['domain', 'Dom Staff', 2], ['domain', 'noDomain', 2]];
			const unequalList = wantedList.filter(([facetName, facetValue, wantedCount]) => new RegExp(`data-facet="${facetName}" value="${facetValue}"> [^<]*<span class="fcount">${wantedCount}</span>`).test(outcome.htmlText) === false);
			return { pass: unequalList.length === 0, detail: unequalList.length === 0 ? 'twelve counts equal' : `unequal: ${unequalList.map((oneWanted) => oneWanted.join(':')).join(', ')}` };
		}),
	}),
	pageConjunct({
		conjunctId: 'd2_detailsNumbersAreTheBlocks',
		title: "the Details panel and the how-to state the block header's own retrieval settings (k 25 planted in the header of this run): 'up to 25 cards', 'up to 25 candidates per unit', and 'nothing below 0.3'",
		twinNameList: ['kTyped'],
		shape: (subject) => {
			subject.fixtureSet.decisionBlock.header.candidateRetrieval.k = 25;
		},
		judge: builtJudge((outcome) => ({ pass: outcome.htmlText.indexOf('up to 25 cards go to the judge') !== -1 && outcome.htmlText.indexOf('up to 25 candidates per unit') !== -1 && outcome.htmlText.indexOf('nothing below 0.3 similarity') !== -1, detail: 'checked the three phrases' })),
	}),
	pageConjunct({
		conjunctId: 'r3_unresolvedQualifierRefused',
		title: "one qualifier's label dropped from the label list (OV900002, the second of the two P000002 cards) is refused by name; the page never renders a raw id alone",
		twinNameList: ['qualifierCheckDeleted'],
		shape: (subject) => {
			delete subject.fixtureSet.cardLabelList.optionValueLabelByRefId.OV900002;
		},
		judge: refusalJudge(/card card:B2 \(unit sif260928:question\/q05\) carries qualifier OV900002 with no label in the card label list/),
	}),
	pageConjunct({
		conjunctId: 'r4_incompleteTupleRefused',
		title: 'a card label with no property id (card:Y) is refused by name',
		twinNameList: ['slotCheckDeleted'],
		shape: (subject) => {
			delete subject.fixtureSet.cardLabelList.cardLabelByStableId['card:Y'].propertyId;
		},
		judge: refusalJudge(/card card:Y \(unit sif260928:question\/q03\) has a card label list entry with no propertyId/),
	}),
	pageConjunct({
		conjunctId: 'r5_noRangeRefused',
		title: 'a card with no range shape (card:Y) is refused by name; the range is never left unstated',
		twinNameList: ['rangeShapeCheckDeleted'],
		shape: (subject) => {
			delete subject.fixtureSet.cardLabelList.cardLabelByStableId['card:Y'].rangeDatatype;
		},
		judge: refusalJudge(/card card:Y \(unit sif260928:question\/q03\) carries 0 range shapes in the card label list \(none\)/),
	}),
	pageConjunct({
		conjunctId: 'r6_proposedNotInPoolRefused',
		title: "a unit whose proposed card is not in its record's rendered pool (q02, card:X) is refused by name",
		twinNameList: ['poolCheckDeleted'],
		shape: (subject) => {
			subject.fixtureSet.decisionBlock.decisionRecordList[1].renderedPoolStableIdList = ['card:A1'];
		},
		judge: refusalJudge(/unit sif260928:question\/q02 has a proposed card \(card:X\) that is not in its rendered pool/),
	}),
	pageConjunct({
		conjunctId: 'r7_recordWithoutJudgeRefused',
		title: "a record with no judge answer (q01) is refused by name",
		twinNameList: ['judgeCheckDeleted'],
		shape: (subject) => {
			delete subject.fixtureSet.decisionBlock.decisionRecordList[0].judge;
		},
		judge: refusalJudge(/unit sif260928:question\/q01 has a record with no judge rationale or category/),
	}),
	pageConjunct({
		conjunctId: 'r8_roundNotWholeRefused',
		title: 'a round that is not a whole number of at least 1 is refused by name',
		twinNameList: ['roundCheckDeleted'],
		shape: (subject) => {
			subject.pageSetting.roundNumber = 0;
		},
		judge: refusalJudge(/pageSetting\.roundNumber '0' is not a whole number of at least 1/),
	}),
	pageConjunct({
		conjunctId: 'r9_undescribedRetrievalRefused',
		title: 'a block declaring a retrieval method the Details prose has no description for is refused by name',
		twinNameList: ['retrievalCheckDeleted'],
		shape: (subject) => {
			subject.fixtureSet.decisionBlock.header.candidateRetrieval.method = 'cosineTopK-v1';
		},
		judge: refusalJudge(/the block declares candidate retrieval method 'cosineTopK-v1', which the Details prose has no description for/),
	}),
];
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't1_everyCardShowsFullTuple', twinName: 'propertyIdDropped', mutationList: [{ find: 'nameText: cardLabel.propertyName, idText: cardLabel.propertyId,', replace: 'nameText: cardLabel.propertyName, idText: undefined,' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't2_qualifierNeverRawId', twinName: 'qualifierLabelDropped', mutationList: [{ find: 'nameText: `${optionValueLabel.optionSetName} = ${optionValueLabel.optionValueName}`, idText: oneRefId', replace: 'nameText: oneRefId, idText: undefined' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't3_sameIdCardsDistinguishable', twinName: 'qualifierSlotOmitted', mutationList: [{ find: 'cardLabel.qualifierRefIdList.forEach((oneRefId) => {', replace: '[].forEach((oneRefId) => {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't4_emptySlotsOmitted', twinName: 'emptySlotPrinted', mutationList: [{ find: 'if (cardLabel.valueNotation !== undefined) {', replace: 'if (true) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't5_everyRangeShapeShown', twinName: 'classRangeDropped', mutationList: [{ find: 'if (cardLabel.rangeClassId !== undefined) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't6_poolListedPickMarked', twinName: 'pickNotMarked', mutationList: [{ find: 'const isPick = oneStableId === unit.proposedCardStableId;', replace: 'const isPick = false;' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't7_judgeRationaleShown', twinName: 'rationaleDropped', mutationList: [{ find: 'const judgeHtml = `<div class="jr"><span class="lbl">${PAGE_WORDING.judgeSaidLabel}</span>${dataSpan(judge.rationale)}</div>`', replace: 'const judgeHtml = `<div class="jr"><span class="lbl">${PAGE_WORDING.judgeSaidLabel}</span></div>`' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't8_judgeTextIsData', twinName: 'rationaleUntagged', mutationList: [{ find: '${dataSpan(judge.rationale)}', replace: '${escapeHtml(judge.rationale)}' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't9_fourTagsAndNote', twinName: 'maybeTagMissing', mutationList: [{ find: "	{ tagValue: 'maybe', labelText: PAGE_WORDING.tagMaybe, labelClassName: '' },\n", replace: '' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't10_sourceElementShown', twinName: 'sourceTextDropped', mutationList: [{ find: "question.description === undefined ? '' : dataSpan(question.description)", replace: "''" }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'f1_facetCountsMeasured', twinName: 'facetCountNotMeasured', mutationList: [{ find: 'facetStateList.filter((oneState) => oneState[oneGroup.facetName] === oneValue).length', replace: 'facetStateList.length' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'd2_detailsNumbersAreTheBlocks', twinName: 'kTyped', mutationList: [{ find: 'up to ${escapeHtml(retrieval.k)} cards go to the judge', replace: 'up to 15 cards go to the judge' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r3_unresolvedQualifierRefused', twinName: 'qualifierCheckDeleted', mutationList: [{ find: 'if (unresolvedRefId !== undefined) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r4_incompleteTupleRefused', twinName: 'slotCheckDeleted', mutationList: [{ find: 'if (absentSlotName !== undefined) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r5_noRangeRefused', twinName: 'rangeShapeCheckDeleted', mutationList: [{ find: 'if (rangeShapeNameList.length !== 1) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r6_proposedNotInPoolRefused', twinName: 'poolCheckDeleted', mutationList: [{ find: 'if (unit.proposedCardStableId !== null && unit.record.renderedPoolStableIdList.indexOf(unit.proposedCardStableId) === -1) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r7_recordWithoutJudgeRefused', twinName: 'judgeCheckDeleted', mutationList: [{ find: 'if (unit.record.judge === undefined ||', replace: 'if (false && unit.record.judge === undefined ||' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r8_roundNotWholeRefused', twinName: 'roundCheckDeleted', mutationList: [{ find: 'if (!Number.isInteger(pageSetting.roundNumber) || pageSetting.roundNumber < 1) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r9_undescribedRetrievalRefused', twinName: 'retrievalCheckDeleted', mutationList: [{ find: 'if (retrievalProse === undefined) {', replace: 'if (false) {' }] });

// ---- GATE (m): Milo's opinion (TQ's addition, 2026-09-29): a badge, the reason, what Milo would pick (marked when it is not in the
// judge's pool), a filter by verdict; a file given means every item needs an entry ----
// THE FROZEN ANSWERS, worked by hand from sifReviewPageFixtureMiloAssessments.json: verdicts in item order are agree, disagree,
// unsure, agree, agree, unsure, disagree, agree, agree, unsure, agree, disagree, agree, agree, unsure = agree 8, unsure 4, disagree 3;
// q02 (disagrees) would pick card:A1, which IS in its pool; q03 (unsure) would pick card:W, which is NOT in its pool.
const GATE_M = 'SIF-PAGE-MILO';
const Q02_REF = 'sif260928:question/q02#Dom Student';
const Q03_REF = 'sif260928:question/q03#Dom Student';
const miloHtmlOf = (htmlText, itemRef) => (itemHtmlOf(htmlText, itemRef).match(/<div class="mr">[\s\S]*?(?=<details class="slate">)/) || [''])[0];
const withMiloShape = (subject) => {
	subject.withMilo = true;
};
const gateMConjunctList = [
	pageConjunct({
		conjunctId: 'm0_noMiloWithoutTheFile',
		title: 'with no Milo assessment file the page carries no Milo slot and says there is none (an item never shows an invented opinion)',
		twinNameList: ['miloSlotAlwaysOn'],
		judge: builtJudge((outcome) => ({ pass: outcome.htmlText.indexOf('There is no Milo opinion on this page') !== -1 && outcome.htmlText.indexOf('<div class="mr">') === -1 && outcome.htmlText.indexOf('data-v=') === -1, detail: 'checked the line, the slot and the verdict attribute' })),
	}),
	pageConjunct({
		conjunctId: 'm1_miloBadgeAndReasonShown',
		title: "q02 shows the badge 'Milo disagrees' and the reason 'Fixture Milo reason 2.'; q01 shows 'Milo agrees'; the summary carries the badge too",
		twinNameList: ['miloReasonDropped'],
		shape: withMiloShape,
		judge: builtJudge((outcome) => {
			const q02Text = miloHtmlOf(outcome.htmlText, Q02_REF).replace(TEST_TAG_PATTERN, '|');
			const q01Text = miloHtmlOf(outcome.htmlText, 'sif260928:question/q01#Dom Student').replace(TEST_TAG_PATTERN, '|');
			const summaryBadgeShown = /<summary class="osum">[\s\S]*?<span class="v no">Milo disagrees<\/span>[\s\S]*?<\/summary>/.test(itemHtmlOf(outcome.htmlText, Q02_REF));
			return { pass: q02Text.indexOf('Milo disagrees') !== -1 && q02Text.indexOf('Fixture Milo reason 2.') !== -1 && q01Text.indexOf('Milo agrees') !== -1 && summaryBadgeShown, detail: q02Text.slice(0, 160) };
		}),
	}),
	pageConjunct({
		conjunctId: 'm2_miloSuggestionAndPoolMark',
		title: "q02's Milo would pick card:A1's tuple with NO 'not in the judge's pool' mark (it is in the pool); q03's would pick card:W's tuple WITH the mark; q01 (no suggestion) shows none",
		twinNameList: ['notInPoolMarkDropped'],
		shape: withMiloShape,
		judge: builtJudge((outcome) => {
			const q02Text = miloHtmlOf(outcome.htmlText, Q02_REF).replace(TEST_TAG_PATTERN, '');
			const q03Text = miloHtmlOf(outcome.htmlText, Q03_REF).replace(TEST_TAG_PATTERN, '');
			const q01Text = miloHtmlOf(outcome.htmlText, 'sif260928:question/q01#Dom Student');
			const pass = q02Text.indexOf(`Milo would pick${TUPLE_A1_TEXT}`) !== -1 && q02Text.indexOf("not in the judge's pool") === -1 && q03Text.indexOf("Milo would pick" + 'Dom Other (C000009) · Omega (P000012) · range option set Omega Set (OS000002)' + " (not in the judge's pool)") !== -1 && q01Text.indexOf('Milo would pick') === -1;
			return { pass, detail: `q02: ${q02Text.slice(-140)} || q03: ${q03Text.slice(-160)}` };
		}),
	}),
	pageConjunct({
		conjunctId: 'm3_miloFilterCounts',
		title: 'the Milo filter boxes carry the hand-worked counts: agrees 8, unsure 4, disagrees 3',
		twinNameList: ['miloFacetCountNotMeasured'],
		shape: withMiloShape,
		judge: builtJudge((outcome) => {
			const wantedList = [['agree', 8], ['unsure', 4], ['disagree', 3]];
			const unequalList = wantedList.filter(([verdictName, wantedCount]) => new RegExp(`data-facet="v" value="${verdictName}"> [^<]*<span class="fcount">${wantedCount}</span>`).test(outcome.htmlText) === false);
			return { pass: unequalList.length === 0 && (outcome.htmlText.match(/data-v="/g) || []).length === 15, detail: unequalList.length === 0 ? 'three counts equal; 15 items carry a verdict' : `unequal: ${unequalList.map((oneWanted) => oneWanted.join(':')).join(', ')}` };
		}),
	}),
	pageConjunct({
		conjunctId: 'm4_miloTextIsData',
		title: "a Milo reason that says 'wrong' and 'Error' renders (it is Milo's text, in a data span) without refusal",
		twinNameList: ['miloReasonUntagged'],
		shape: (subject) => {
			subject.withMilo = true;
			subject.fixtureSet.miloAssessments['sif260928:question/q01#Dom Student'].reason = 'Not wrong: an Error of Measurement.';
		},
		judge: builtJudge((outcome) => ({ pass: outcome.htmlText.indexOf('<span data-source="standard">Not wrong: an Error of Measurement.</span>') !== -1, detail: 'checked for the reason in a data span' })),
	}),
	pageConjunct({
		conjunctId: 'm5_verifyWithMilo',
		title: 'verifySifReviewPage passes a page built with Milo assessments and reads one Milo slot per item; a page that loses one slot fails',
		twinNameList: ['miloSlotRemoved'],
		shape: withMiloShape,
		judge: builtJudge((outcome) => {
			const verified = outcome.pageModule.verifySifReviewPage({ htmlText: outcome.htmlText, decisionBlock: outcome.decisionBlock, inputFileSha256ByRole: { ...INPUT_FILE_SHA256_BY_ROLE } });
			return { pass: verified.pass, detail: verified.checkList.filter((oneCheck) => !oneCheck.pass).map((oneCheck) => `${oneCheck.checkName}: ${oneCheck.detail}`).join('; ') || `${verified.checkList.length} checks pass` };
		}),
	}),
	pageConjunct({
		conjunctId: 'r10_itemWithoutAssessmentRefused',
		title: 'with a Milo file given, an item with no entry (q07) is refused by name',
		twinNameList: ['entryCheckDeleted'],
		shape: (subject) => {
			subject.withMilo = true;
			delete subject.fixtureSet.miloAssessments['sif260928:question/q07'];
		},
		judge: refusalJudge(/item sif260928:question\/q07 has no entry in the Milo assessment file/),
	}),
	pageConjunct({
		conjunctId: 'r11_suggestionPoolClaimRefused',
		title: "a Milo suggestion whose inPool disagrees with the judge's rendered pool (q02's card:A1 claimed outside it) is refused by name",
		twinNameList: ['poolAgreementCheckDeleted'],
		shape: (subject) => {
			subject.withMilo = true;
			subject.fixtureSet.miloAssessments[Q02_REF].suggest.inPool = false;
		},
		judge: refusalJudge(/item sif260928:question\/q02#Dom Student has a Milo suggestion \(card:A1\) whose inPool \(false\) disagrees with the judge's rendered pool/),
	}),
	pageConjunct({
		conjunctId: 'r12_unknownItemKeyRefused',
		title: 'a Milo entry keyed to an item the page does not have is refused by name',
		twinNameList: ['unmatchedKeyCheckDeleted'],
		shape: (subject) => {
			subject.withMilo = true;
			subject.fixtureSet.miloAssessments['sif260928:question/q99'] = { verdict: 'agree', confidence: 0.5, reason: 'x', suggest: null };
		},
		judge: refusalJudge(/names an item the page does not have: sif260928:question\/q99/),
	}),
	pageConjunct({
		conjunctId: 'r13_unknownVerdictRefused',
		title: "a Milo verdict that is not agree, unsure or disagree ('maybe' on q01) is refused by name",
		twinNameList: ['verdictCheckDeleted'],
		shape: (subject) => {
			subject.withMilo = true;
			subject.fixtureSet.miloAssessments['sif260928:question/q01#Dom Student'].verdict = 'maybe';
		},
		judge: refusalJudge(/item sif260928:question\/q01#Dom Student carries the Milo verdict 'maybe', which is not one of agree, unsure, disagree/),
	}),
];
registerPageMutationTwin({ gateId: GATE_M, conjunctId: 'm0_noMiloWithoutTheFile', twinName: 'miloSlotAlwaysOn', mutationList: [{ find: 'const withMilo = miloAssessmentByItemKey !== undefined;', replace: 'const withMilo = true;' }] });
registerPageMutationTwin({ gateId: GATE_M, conjunctId: 'm1_miloBadgeAndReasonShown', twinName: 'miloReasonDropped', mutationList: [{ find: '${miloBadgeHtml} ${dataSpan(miloAssessment.reason)}</div>', replace: '${miloBadgeHtml}</div>' }] });
registerPageMutationTwin({ gateId: GATE_M, conjunctId: 'm2_miloSuggestionAndPoolMark', twinName: 'notInPoolMarkDropped', mutationList: [{ find: "${miloAssessment.suggest.inPool ? '' : ` <span class=\"bdg mark\">${PAGE_WORDING.notInPoolMark}</span>`}", replace: '' }] });
registerPageMutationTwin({ gateId: GATE_M, conjunctId: 'm3_miloFilterCounts', twinName: 'miloFacetCountNotMeasured', mutationList: [{ find: 'facetStateList.filter((oneState) => oneState[oneGroup.facetName] === oneValue).length', replace: 'facetStateList.length' }] });
registerPageMutationTwin({ gateId: GATE_M, conjunctId: 'm4_miloTextIsData', twinName: 'miloReasonUntagged', mutationList: [{ find: '${dataSpan(miloAssessment.reason)}', replace: '${escapeHtml(miloAssessment.reason)}' }] });
registerTwin({ gateId: GATE_M, conjunctId: 'm5_verifyWithMilo', twinName: 'miloSlotRemoved', leverKind: 'inputFault', mutate: (subject) => {
	subject.htmlTamperList.push((htmlText) => htmlText.replace('<div class="mr">', '<div class="mrGone">'));
} });
registerPageMutationTwin({ gateId: GATE_M, conjunctId: 'r10_itemWithoutAssessmentRefused', twinName: 'entryCheckDeleted', mutationList: [{ find: 'if (assessment === undefined) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_M, conjunctId: 'r11_suggestionPoolClaimRefused', twinName: 'poolAgreementCheckDeleted', mutationList: [{ find: 'if (unitList[unitIndex].record.renderedPoolStableIdList.indexOf(suggestion.cardStableId) !== -1 !== suggestion.inPool) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_M, conjunctId: 'r12_unknownItemKeyRefused', twinName: 'unmatchedKeyCheckDeleted', mutationList: [{ find: 'if (unmatchedItemKey !== undefined) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_M, conjunctId: 'r13_unknownVerdictRefused', twinName: 'verdictCheckDeleted', mutationList: [{ find: 'if (MILO_VERDICT_REGISTRY[assessment.verdict] === undefined) {', replace: 'if (false) {' }] });

const gateDeclarationList = [
	{ gateId: GATE_A, title: "items are keyed by unit; the page carries no comparison with the standard's own annotation (TQ, 2026-09-29)", conjunctList: gateAConjunctList },
	{ gateId: GATE_V, title: 'the verify-against-deployed step reads rendered content only', conjunctList: gateVConjunctList },
	{ gateId: GATE_C, title: "brief (c): no 'error' or 'wrong' in the page's own prose; the standards' data and the judge's text may carry them", conjunctList: gateCConjunctList },
	{ gateId: GATE_R, title: 'the refusals where the label list and the page setting enter', conjunctList: gateRConjunctList },
	{ gateId: GATE_M, title: "Milo's opinion (TQ's addition): badge, reason, what Milo would pick (marked when outside the pool), filter by verdict; a file given means every item needs an entry", conjunctList: gateMConjunctList },
	{ gateId: GATE_T, title: 'phases C6b, C6c: every card renders as its full tuple, qualifiers resolved, the range in its three shapes; the layout (source text, pick, rationale, the whole pool with the pick marked, four tags, facets, Details numbers); the refusals where the block and the label list enter', conjunctList: gateTConjunctList },
];

// ---- outside the gates ----
harness.section('buildReviewPageFromFiles reads the three inputs and builds the same page, which verifies against them');
const pageModule = require(PAGE_FILE_PATH);
const fromFiles = pageModule.buildReviewPageFromFiles({ decisionBlockFilePath: FIXTURE_FILE_PATH_BY_ROLE.decisionBlock, questionMapFilePath: FIXTURE_FILE_PATH_BY_ROLE.questionMap, cardLabelFilePath: FIXTURE_FILE_PATH_BY_ROLE.cardLabelList, pageSetting: { ...PAGE_SETTING } });
harness.ok('buildReviewPageFromFiles succeeds', !fromFiles.error, fromFiles.error && fromFiles.error.message);
harness.equal('the manifest records the three input shas', Object.keys(fromFiles.manifest).filter((oneName) => oneName.startsWith('inputSha256.')).length, 3);
const fromFilesVerified = pageModule.verifySifReviewPage({ htmlText: fromFiles.htmlText, decisionBlock: fromFiles.decisionBlock, inputFileSha256ByRole: pageModule.inputFileSha256ByRoleOf({ decisionBlockFilePath: FIXTURE_FILE_PATH_BY_ROLE.decisionBlock, questionMapFilePath: FIXTURE_FILE_PATH_BY_ROLE.questionMap, cardLabelFilePath: FIXTURE_FILE_PATH_BY_ROLE.cardLabelList }) });
harness.ok('the file-built page verifies against its inputs, input shas included', fromFilesVerified.pass, JSON.stringify(fromFilesVerified.checkList.filter((oneCheck) => !oneCheck.pass)));
harness.equal('the feedback target is in the rendered script', fromFiles.htmlText.indexOf(`const FEEDBACK_TARGET_PATH=${JSON.stringify(PAGE_SETTING.feedbackTargetPath)};`) !== -1, true);
harness.equal('the page module does not read the yardstick scorer', fs.readFileSync(PAGE_FILE_PATH, 'utf8').replace(/\/\/.*$/gm, '').indexOf('sifYardstickScorer') === -1, true);

runGateFamily({ harness, familyName: 'SIF-PAGE', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 37, expectedTwinCount: 41 }, () => harness.report());
