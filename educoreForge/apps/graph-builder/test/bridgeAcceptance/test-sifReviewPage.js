#!/usr/bin/env node
'use strict';

// test-sifReviewPage.js — phase C6's gates for sifReviewPage.js, over C5's synthetic fixtures (block, annotation,
// card list, remodel table) plus sifReviewPageFixtures/ (the same question map carrying the members the page
// shows, and a card label list).
//
//   SIF-PAGE-A       (a) every number on the page equals C5's score; one mislabelled pick changes exactly its
//                    numbers; items are keyed by unit, never position
//   SIF-PAGE-VERIFY  the verify-against-deployed step reads rendered content only (EBONY_DREAM's caution)
//   SIF-PAGE-C       (c) the page's own prose never says either forbidden word; a data label that does renders
//   SIF-PAGE-DEBUG   a debug block's judgment reads 'debug — not scored', with no judgment numbers
//   SIF-PAGE-REFUSE  the named refusals where the label list and the page setting enter
//   SIF-PAGE-TUPLE   (phase C6b) every card renders as its full tuple; a qualifier never renders as a raw id
//
// Every conjunct is observed red under its own twin (forge-framework gateSuiteRunner). Hermetic: no graph,
// no Docker, no network.
//
// Run: PATH=/usr/local/bin:$PATH node apps/graph-builder/test/bridgeAcceptance/test-sifReviewPage.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase C6 gates: the SIF review page's numbers, its verify step, its wording scan, its debug section and its refusals

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
const scorer = require('./sifYardstickScorer');

const PAGE_FILE_PATH = path.join(__dirname, 'sifReviewPage.js');
const YARDSTICK_FIXTURE_DIRECTORY_PATH = path.join(__dirname, 'sifYardstickFixtures');
const PAGE_FIXTURE_DIRECTORY_PATH = path.join(__dirname, 'sifReviewPageFixtures');
const FIXTURE_FILE_PATH_BY_ROLE = Object.freeze({
	decisionBlock: path.join(PAGE_FIXTURE_DIRECTORY_PATH, 'sifReviewPageFixtureBlock.json'),
	annotation: path.join(YARDSTICK_FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureAnnotation.json'),
	questionMap: path.join(PAGE_FIXTURE_DIRECTORY_PATH, 'sifReviewPageFixtureQuestionMap.json'),
	cardList: path.join(YARDSTICK_FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureCardList.json'),
	remodelTable: path.join(YARDSTICK_FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureRemodelTable.json'),
	cardLabelList: path.join(PAGE_FIXTURE_DIRECTORY_PATH, 'sifReviewPageFixtureCardLabelList.json'),
});
const C5_QUESTION_MAP_FILE_PATH = path.join(YARDSTICK_FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureQuestionMap.json');
const PAGE_SETTING = Object.freeze({ feedbackTargetPath: 'educoreForge/system/dataStores/bridgeAcceptance/sif260928/feedback/c6FixtureTags.json', draftStoragePrefix: 'sifReviewPageFixture::', pageTitle: 'SIF review page (C6 fixture)', roundNumber: 1 });

// THE FROZEN ANSWERS, worked by hand from the page's layout and C5's fixture (see the DEVLOG). Never edited to
// match a measurement.
// cells: population 6 (units, four standings, key-remodeled) + retrieval 25 (not-retrieved, scorable, 7 K rows
// x 3, and the declared K in the cap note of the two rows above it, K 20 and 25) + judgment 10 (retrieved, four
// classes, two grains x 2, new-claim) + per block 28 (the last K in the column header, then 3 blocks x 9) + one
// best-rank cell per retrieved unit, 10 = 79
const EXPECTED_SCORE_CELL_COUNT = 79;
// mislabelling q01 (specified, agrees-target, model block) moves exactly these five numbers
const EXPECTED_MISLABEL_CHANGED_PATH_LIST = Object.freeze(['bySharedBlock.0.judgment.countByClass.agrees-target', 'bySharedBlock.0.judgment.countByClass.disagrees', 'judgment.countByClass.agrees-target', 'judgment.countByClass.disagrees', 'judgment.targetGrainOnSpecified.agreesTargetCount']);
const MISLABEL_SUBJECT_STABLE_ID = 'sif260928:question/q01';
const EXPECTED_DEBUG_STATUS_TEXT = 'debug — not scored';
// the test's OWN scan and span pattern, written independently of the page module's
const TEST_FORBIDDEN_WORD_LIST = Object.freeze(['error', 'wrong']);
const TEST_DATA_SPAN_PATTERN = /<span data-source="standard">[^<]*<\/span>/g;
const TEST_SCORE_CELL_PATTERN = /data-score-path="([^"]+)">([^<]*)</g;
const ERROR_BEARING_DATA_LABEL = 'Standard Error of Measurement';

const readFixtureSet = () => Object.keys(FIXTURE_FILE_PATH_BY_ROLE).reduce((soFar, oneRole) => ({ ...soFar, [oneRole]: JSON.parse(fs.readFileSync(FIXTURE_FILE_PATH_BY_ROLE[oneRole], 'utf8')) }), {});
const makeSubject = () => ({ fixtureSet: readFixtureSet(), pageSetting: { ...PAGE_SETTING }, pageMutationList: [], htmlTamperList: [], mislabelCardStableId: 'card:X' });
const cloneSubject = (subject) => ({ fixtureSet: JSON.parse(JSON.stringify(subject.fixtureSet)), pageSetting: { ...subject.pageSetting }, pageMutationList: subject.pageMutationList.slice(), htmlTamperList: subject.htmlTamperList.slice(), mislabelCardStableId: subject.mislabelCardStableId });

const walkScorePath = (score, scorePath) => scorePath.split('.').reduce((soFar, oneSegment) => (soFar === undefined || soFar === null ? undefined : soFar[oneSegment]), score);
const cellListOf = (htmlText) => Array.from(htmlText.replace(/<!--[\s\S]*?-->/g, '').matchAll(TEST_SCORE_CELL_PATTERN)).map((oneMatch) => ({ scorePath: oneMatch[1], cellText: oneMatch[2] }));
const testScanHitList = (htmlText) => TEST_FORBIDDEN_WORD_LIST.filter((oneWord) => htmlText.replace(TEST_DATA_SPAN_PATTERN, '').toLowerCase().indexOf(oneWord) !== -1);
const scoreOf = (fixtureSet) => scorer.scoreBlock({ decisionBlock: fixtureSet.decisionBlock, annotation: fixtureSet.annotation, questionMap: fixtureSet.questionMap, cardList: fixtureSet.cardList, remodelTable: fixtureSet.remodelTable });

// runPage — the real module, or an in-memory double when a twin mutated its source. The score is always C5's
// real scorer's. A throw is a MEASURED OUTCOME, as in C5's suite: a twin that deletes a refusal can crash the
// page unnamed, and that crash must read as a red.
const runPage = (subject, fixtureSet) => {
	const pageModule = subject.pageMutationList.length === 0 ? require(PAGE_FILE_PATH) : moduleDouble.loadWithMutations({ modulePath: PAGE_FILE_PATH, mutationList: subject.pageMutationList });
	const scored = scoreOf(fixtureSet);
	if (scored.error) {
		return { scorerRefused: scored.error.message };
	}
	try {
		const built = pageModule.buildReviewPageHtml({ score: scored.score, decisionBlock: fixtureSet.decisionBlock, questionMap: fixtureSet.questionMap, cardLabelList: fixtureSet.cardLabelList, pageSetting: subject.pageSetting });
		if (built.error) {
			return { error: built.error, score: scored.score };
		}
		return { htmlText: subject.htmlTamperList.reduce((soFar, oneTamper) => oneTamper(soFar), built.htmlText), score: scored.score, pageModule };
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
const builtJudge = (judgePage) => (outcome, subject) => (outcome.thrownFromPage !== undefined ? { pass: false, detail: `the page crashed: ${outcome.thrownFromPage}` } : outcome.scorerRefused !== undefined ? { pass: false, detail: `the scorer refused: ${outcome.scorerRefused.slice(0, 200)}` } : outcome.error ? { pass: false, detail: `the page refused: ${outcome.error.message.slice(0, 200)}` } : judgePage(outcome, subject));
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

// ---- GATE (a): the page's numbers are C5's ----
const GATE_A = 'SIF-PAGE-A';
const gateAConjunctList = [
	pageConjunct({
		conjunctId: 'a1_cellsEqualScore',
		title: "every number cell on the page equals the number at its data-score-path in C5's score, and there are exactly the hand-worked 79",
		twinNameList: ['oneCellOffByOne'],
		judge: builtJudge((outcome) => {
			const cellList = cellListOf(outcome.htmlText);
			const unequalList = cellList.filter((oneCell) => typeof walkScorePath(outcome.score, oneCell.scorePath) !== 'number' || String(walkScorePath(outcome.score, oneCell.scorePath)) !== oneCell.cellText);
			return { pass: cellList.length === EXPECTED_SCORE_CELL_COUNT && unequalList.length === 0, detail: `${cellList.length} cells; unequal: ${unequalList.map((oneCell) => `${oneCell.scorePath} shows ${oneCell.cellText}`).join(', ') || 'none'}` };
		}),
	}),
	{
		conjunctId: 'a2_mislabelMovesExactlyItsNumbers',
		title: 'mislabelling one fixture pick (q01) changes exactly the five hand-worked cells, each to the mislabelled score\'s value',
		twinNameList: ['mislabelIsNoOp', 'perBlockReadsOverall'],
		evaluate: (subject, callback) => {
			const baseOutcome = runPage(subject, subject.fixtureSet);
			const mislabelledFixtureSet = JSON.parse(JSON.stringify(subject.fixtureSet));
			mislabelledFixtureSet.decisionBlock.decisionRecordList.find((oneRecord) => oneRecord.subjectStableId === MISLABEL_SUBJECT_STABLE_ID).objectStableId = subject.mislabelCardStableId;
			const mislabelledOutcome = runPage(subject, mislabelledFixtureSet);
			if (baseOutcome.htmlText === undefined || mislabelledOutcome.htmlText === undefined) {
				callback('', { pass: false, detail: 'a page was not built' });
				return;
			}
			const baseCellTextByPath = {};
			cellListOf(baseOutcome.htmlText).forEach((oneCell) => {
				baseCellTextByPath[oneCell.scorePath] = oneCell.cellText;
			});
			const changedCellList = cellListOf(mislabelledOutcome.htmlText).filter((oneCell) => baseCellTextByPath[oneCell.scorePath] !== oneCell.cellText);
			const changedPathList = Array.from(new Set(changedCellList.map((oneCell) => oneCell.scorePath))).sort();
			const everyChangeIsTheScores = changedCellList.every((oneCell) => String(walkScorePath(mislabelledOutcome.score, oneCell.scorePath)) === oneCell.cellText);
			const pass = JSON.stringify(changedPathList) === JSON.stringify(EXPECTED_MISLABEL_CHANGED_PATH_LIST) && everyChangeIsTheScores;
			callback('', { pass, detail: `changed cells: ${changedCellList.map((oneCell) => `${oneCell.scorePath} ${baseCellTextByPath[oneCell.scorePath]}->${oneCell.cellText}`).join(', ') || 'none'}` });
		},
	},
	pageConjunct({
		conjunctId: 'a3_itemsKeyedByUnit',
		title: 'there is one item per unit, keyed by subjectStableId plus partition label, never by position',
		twinNameList: ['itemKeyedByPosition'],
		judge: builtJudge((outcome) => {
			const itemRefList = Array.from(outcome.htmlText.matchAll(/<article class="item" data-item-ref="([^"]*)"/g)).map((oneMatch) => oneMatch[1]);
			const expectedRefList = outcome.score.unitVerdictList.map((oneVerdict) => (oneVerdict.judgmentPartitionLabel === null ? oneVerdict.subjectStableId : `${oneVerdict.subjectStableId}#${oneVerdict.judgmentPartitionLabel}`));
			return { pass: JSON.stringify(itemRefList) === JSON.stringify(expectedRefList) && new Set(itemRefList).size === 15, detail: `item refs ${itemRefList.slice(0, 3).join(', ')}…` };
		}),
	}),
];
registerPageMutationTwin({ gateId: GATE_A, conjunctId: 'a1_cellsEqualScore', twinName: 'oneCellOffByOne', mutationList: [{ find: 'data-score-path="${scorePath}">${valueAt(score, scorePath)}</span>', replace: "data-score-path=\"${scorePath}\">${valueAt(score, scorePath) + (scorePath === 'judgment.countByClass.disagrees' ? 1 : 0)}</span>" }] });
registerTwin({ gateId: GATE_A, conjunctId: 'a2_mislabelMovesExactlyItsNumbers', twinName: 'mislabelIsNoOp', leverKind: 'inputFault', mutate: (subject) => {
	subject.mislabelCardStableId = 'card:A1';
} });
registerPageMutationTwin({ gateId: GATE_A, conjunctId: 'a2_mislabelMovesExactlyItsNumbers', twinName: 'perBlockReadsOverall', mutationList: [{ find: 'scoreCell(score, `${blockPath}.judgment.countByClass.${oneClass}`)', replace: 'scoreCell(score, `judgment.countByClass.${oneClass}`)' }] });
registerPageMutationTwin({ gateId: GATE_A, conjunctId: 'a3_itemsKeyedByUnit', twinName: 'itemKeyedByPosition', mutationList: [{ find: 'const itemRef = itemRefOf(unitVerdict);', replace: 'const itemRef = String(unitIndex);' }] });

// ---- the verify step reads rendered content only ----
const GATE_V = 'SIF-PAGE-VERIFY';
const firstItemPattern = /<article class="item"[\s\S]*?<\/article>/;
const gateVConjunctList = [
	pageConjunct({
		conjunctId: 'v1_verifyPassesOnRenderedContent',
		title: 'verifySifReviewPage passes the built page, reading only rendered content (comments and the manifest removed)',
		twinNameList: ['visibleItemMovedIntoComment', 'oneCellTampered', 'feedbackPathOnlyInManifest', 'oneTagRadioRemoved'],
		judge: builtJudge((outcome) => {
			const verified = outcome.pageModule.verifySifReviewPage({ htmlText: outcome.htmlText, score: outcome.score });
			return { pass: verified.pass, detail: verified.checkList.filter((oneCheck) => !oneCheck.pass).map((oneCheck) => `${oneCheck.checkName}: ${oneCheck.detail}`).join('; ') || `${verified.checkList.length} checks pass` };
		}),
	}),
];
// EBONY_DREAM's twin: the visible item is gone while the manifest (and a comment carrying the item) remain
registerTwin({ gateId: GATE_V, conjunctId: 'v1_verifyPassesOnRenderedContent', twinName: 'visibleItemMovedIntoComment', leverKind: 'inputFault', mutate: (subject) => {
	subject.htmlTamperList.push((htmlText) => htmlText.replace(firstItemPattern, (itemText) => `<!-- ${itemText} -->`));
} });
registerTwin({ gateId: GATE_V, conjunctId: 'v1_verifyPassesOnRenderedContent', twinName: 'oneCellTampered', leverKind: 'inputFault', mutate: (subject) => {
	subject.htmlTamperList.push((htmlText) => htmlText.replace('data-score-path="population.unitCount">15<', 'data-score-path="population.unitCount">16<'));
} });
registerTwin({ gateId: GATE_V, conjunctId: 'v1_verifyPassesOnRenderedContent', twinName: 'feedbackPathOnlyInManifest', leverKind: 'inputFault', mutate: (subject) => {
	subject.htmlTamperList.push((htmlText) => htmlText.replace(/const FEEDBACK_TARGET_PATH=[^\n]*\n/, ''));
} });

registerTwin({ gateId: GATE_V, conjunctId: 'v1_verifyPassesOnRenderedContent', twinName: 'oneTagRadioRemoved', leverKind: 'inputFault', mutate: (subject) => {
	subject.htmlTamperList.push((htmlText) => htmlText.replace(/ <label><input type="radio" name="t_[^>]*value="maybe"> Maybe<\/label>\n/, ''));
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

// ---- a debug block ----
const GATE_D = 'SIF-PAGE-DEBUG';
const gateDConjunctList = [
	pageConjunct({
		conjunctId: 'd1_debugJudgmentNotScored',
		title: "a debug block's page reads 'debug — not scored' for judgment and shows no judgment number, overall or per block",
		twinNameList: ['scoredBranchForced'],
		shape: (subject) => {
			subject.fixtureSet.decisionBlock.header.generation = `${subject.fixtureSet.decisionBlock.header.generation}-INVALID_DEBUG`;
		},
		judge: builtJudge((outcome) => {
			const judgmentCellList = cellListOf(outcome.htmlText).filter((oneCell) => /(^|\.)judgment\./.test(oneCell.scorePath));
			const statusShown = outcome.htmlText.indexOf(`<p class="unscored">${EXPECTED_DEBUG_STATUS_TEXT}</p>`) !== -1;
			return { pass: statusShown && judgmentCellList.length === 0, detail: `status shown ${statusShown}; judgment cells ${judgmentCellList.length}` };
		}),
	}),
];
registerPageMutationTwin({ gateId: GATE_D, conjunctId: 'd1_debugJudgmentNotScored', twinName: 'scoredBranchForced', mutationList: [{ find: 'if (!score.judgment.scored) {', replace: 'if (false) {' }] });

// ---- the refusals where the label list and the page setting enter ----
const GATE_R = 'SIF-PAGE-REFUSE';
const gateRConjunctList = [
	pageConjunct({
		conjunctId: 'r1_unlabelledCardRefused',
		title: 'a card the page would name with no entry in the label list is refused by name',
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

// ---- GATE (t): every card is shown as its full tuple (phase C6b) ----
// THE FROZEN LINES, worked by hand from the fixture label list (sifReviewPageFixtureCardLabelList.json): card:B1 and
// card:B2 share domain C000001 and property P000002 and differ only by qualifier (OV900001 'Kind One', OV900002
// 'Kind Two', both of option set 'Beta Type'); card:A1 has a range option set, card:D1 a value, card:X nothing else.
const GATE_T = 'SIF-PAGE-TUPLE';
const TUPLE_B1_TEXT = 'Dom Student (C000001) · Beta (P000002) · range datatype string · Beta Type = Kind One (OV900001)';
const TUPLE_B2_TEXT = 'Dom Student (C000001) · Beta (P000002) · range datatype string · Beta Type = Kind Two (OV900002)';
const TUPLE_A1_TEXT = 'Dom Student (C000001) · Alpha (P000001) · range option set Alpha Set (OS000001)';
const TUPLE_D1_TEXT = 'Dom Student (C000001) · Delta (P000004) · range datatype date · value Delta One (DeltaOne)';
const TUPLE_X_TEXT = 'Dom Other (C000009) · Chi (P000009) · range datatype token';
const TUPLE_Y_TEXT = 'Dom Other (C000009) · Upsilon (P000010) · range datatype decimal';
const TUPLE_Z_TEXT = 'Dom Other (C000009) · Zeta (P000011) · range class Zeta Class (C000077)';
const EXPECTED_LINE_TEXT_BY_ITEM_REF = Object.freeze({
	'sif260928:question/q06': `the standard specifies P000002 (${TUPLE_B1_TEXT}; ${TUPLE_B2_TEXT}); the bridge proposed ${TUPLE_B2_TEXT}`,
	'sif260928:question/q05#Dom Student': `the standard specifies P000002 (${TUPLE_B1_TEXT}); the bridge proposed ${TUPLE_B1_TEXT}`,
	'sif260928:question/q01#Dom Student': `the standard specifies P000001 (${TUPLE_A1_TEXT}); the bridge proposed ${TUPLE_A1_TEXT}`,
	'sif260928:question/q07': `the standard specifies P000004 (${TUPLE_D1_TEXT}); the bridge proposed ${TUPLE_D1_TEXT}`,
	'sif260928:question/q08#Dom Student': `the standard specifies no element for this question; the bridge proposed ${TUPLE_X_TEXT}`,
});
const TEST_TAG_PATTERN = /<[^>]*>/g;
const lineTextByItemRefOf = (htmlText) => {
	const lineTextByItemRef = {};
	Array.from(htmlText.matchAll(/<article class="item" data-item-ref="([^"]*)"[\s\S]*?<p class="line">([\s\S]*?)<\/p>/g)).forEach((oneMatch) => {
		lineTextByItemRef[oneMatch[1]] = oneMatch[2].replace(TEST_TAG_PATTERN, '');
	});
	return lineTextByItemRef;
};
const itemHtmlOf = (htmlText, itemRef) => (htmlText.match(new RegExp(`<article class="item" data-item-ref="${itemRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?<\\/article>`)) || [''])[0];
const candidateTextListOf = (htmlText, itemRef) => Array.from(itemHtmlOf(htmlText, itemRef).matchAll(/<code class="dc alt">([\s\S]*?)<\/code>/g)).map((oneMatch) => oneMatch[1].replace(TEST_TAG_PATTERN, ''));
const gateTConjunctList = [
	pageConjunct({
		conjunctId: 't1_everyCardShowsFullTuple',
		title: 'the hand-worked lines render exactly: domain and property with their ids, then the range option set, the value or each qualifier where the card has one',
		twinNameList: ['propertyIdDropped'],
		judge: builtJudge((outcome) => {
			const lineTextByItemRef = lineTextByItemRefOf(outcome.htmlText);
			const unequalList = Object.keys(EXPECTED_LINE_TEXT_BY_ITEM_REF).filter((oneItemRef) => lineTextByItemRef[oneItemRef] !== EXPECTED_LINE_TEXT_BY_ITEM_REF[oneItemRef]);
			return { pass: unequalList.length === 0, detail: unequalList.length === 0 ? `${Object.keys(EXPECTED_LINE_TEXT_BY_ITEM_REF).length} lines equal` : `${unequalList[0]} shows: ${lineTextByItemRef[unequalList[0]]}` };
		}),
	}),
	pageConjunct({
		conjunctId: 't2_qualifierNeverRawId',
		title: 'every qualifier id on the page is preceded by its option set and option value names; no qualifier renders as a raw id',
		twinNameList: ['qualifierLabelDropped'],
		judge: builtJudge((outcome) => {
			const allLineText = Object.values(lineTextByItemRefOf(outcome.htmlText)).join('\n');
			const qualifierIdCount = (allLineText.match(/OV\d+/g) || []).length;
			const labelledCount = (allLineText.match(/Beta Type = Kind (One|Two) \(OV\d+\)/g) || []).length;
			return { pass: qualifierIdCount > 0 && qualifierIdCount === labelledCount, detail: `${qualifierIdCount} qualifier ids, ${labelledCount} with their labels` };
		}),
	}),
	pageConjunct({
		conjunctId: 't3_sameIdCardsDistinguishable',
		title: 'the two cards of P000002 (one property id, qualifier the only difference) render as two different texts, each carrying its own qualifier label, in the contended unit q06',
		twinNameList: ['qualifierSlotOmitted'],
		judge: builtJudge((outcome) => {
			const lineText = lineTextByItemRefOf(outcome.htmlText)['sif260928:question/q06'];
			const standardText = lineText.slice(lineText.indexOf('(') + 1, lineText.indexOf('); the bridge proposed'));
			const cardTextList = standardText.split('; ');
			return { pass: cardTextList.length === 2 && cardTextList[0] !== cardTextList[1] && cardTextList[0].indexOf('Kind One') !== -1 && cardTextList[1].indexOf('Kind Two') !== -1, detail: cardTextList.join(' | ') };
		}),
	}),
	pageConjunct({
		conjunctId: 't4_emptySlotsOmitted',
		title: "a slot the card lacks (value, qualifier) is omitted: no 'null', no 'undefined', no empty slot, in any line or candidate, and a card with only a datatype ends at its range",
		twinNameList: ['emptySlotPrinted'],
		judge: builtJudge((outcome) => {
			const lineTextByItemRef = lineTextByItemRefOf(outcome.htmlText);
			const allLineText = Object.values(lineTextByItemRef).join('\n');
			const allText = allLineText + '\n' + Array.from(outcome.htmlText.matchAll(/<code class="dc alt">([\s\S]*?)<\/code>/g)).map((oneMatch) => oneMatch[1].replace(TEST_TAG_PATTERN, '')).join('\n');
			const emptySlotHit = /null|undefined|\(\)| ·  ·| · $/m.test(allText);
			return { pass: !emptySlotHit && lineTextByItemRef['sif260928:question/q08#Dom Student'].endsWith(`proposed ${TUPLE_X_TEXT}`), detail: emptySlotHit ? 'an empty slot is printed' : 'no empty slot printed' };
		}),
	}),
	pageConjunct({
		conjunctId: 't5_everyRangeShapeShown',
		title: "the four candidates of q03's pool (an option set, a datatype, a datatype, a class) each render their range in its own shape, in pool order",
		twinNameList: ['classRangeDropped'],
		judge: builtJudge((outcome) => {
			const candidateTextList = candidateTextListOf(outcome.htmlText, 'sif260928:question/q03#Dom Student');
			const expectedList = [TUPLE_A1_TEXT, TUPLE_X_TEXT, TUPLE_Y_TEXT, TUPLE_Z_TEXT];
			return { pass: JSON.stringify(candidateTextList) === JSON.stringify(expectedList), detail: candidateTextList.join(' | ') };
		}),
	}),
	pageConjunct({
		conjunctId: 't6_poolListedPickMarked',
		title: "q02's pool (two candidates, card:X picked) lists both in pool order and marks the pick on the second only; q03 (abstained) marks none",
		twinNameList: ['pickNotMarked'],
		judge: builtJudge((outcome) => {
			const markCountByItemRef = {};
			['sif260928:question/q02#Dom Student', 'sif260928:question/q03#Dom Student'].forEach((oneItemRef) => {
				markCountByItemRef[oneItemRef] = (itemHtmlOf(outcome.htmlText, oneItemRef).match(/<span class="bdg mark">picked<\/span>/g) || []).length;
			});
			const q02CandidateList = candidateTextListOf(outcome.htmlText, 'sif260928:question/q02#Dom Student');
			const q02PickIsSecond = /<div class="alt"><span class="ordn">2<\/span>[\s\S]*?<span class="bdg mark">picked<\/span>/.test(itemHtmlOf(outcome.htmlText, 'sif260928:question/q02#Dom Student'));
			return { pass: JSON.stringify(q02CandidateList) === JSON.stringify([TUPLE_A1_TEXT, TUPLE_X_TEXT]) && markCountByItemRef['sif260928:question/q02#Dom Student'] === 1 && markCountByItemRef['sif260928:question/q03#Dom Student'] === 0 && q02PickIsSecond, detail: `q02 candidates ${q02CandidateList.length}, marks q02 ${markCountByItemRef['sif260928:question/q02#Dom Student']}, q03 ${markCountByItemRef['sif260928:question/q03#Dom Student']}` };
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
			const everyItemOffersAll = articleList.length === 15 && articleList.every((oneArticle) => ['yes', 'no', 'maybe', 'noValidCandidate'].every((oneValue) => oneArticle.indexOf(`type="radio" name="t_`) !== -1 && new RegExp(`value="${oneValue}">`).test(oneArticle)) && /<input class="note" type="text" name="n_/.test(oneArticle));
			return { pass: everyItemOffersAll, detail: `${articleList.length} items` };
		}),
	}),
	pageConjunct({
		conjunctId: 'f1_facetCountsMeasured',
		title: 'the filter boxes carry the counts worked from the fixture block: matched 13, abstained 2; judge category strong 4, moderate 5, weak but real 4, none 2',
		twinNameList: ['facetCountNotMeasured'],
		judge: builtJudge((outcome) => {
			const wantedList = [['outcome', 'picked', 13], ['outcome', 'abstained', 2], ['cat', 'strong', 4], ['cat', 'moderate', 5], ['cat', 'weakButReal', 4], ['cat', 'none', 2]];
			const unequalList = wantedList.filter(([facetName, facetValue, wantedCount]) => new RegExp(`data-facet="${facetName}" value="${facetValue}"> [^<]*<span class="fcount">${wantedCount}</span>`).test(outcome.htmlText) === false);
			return { pass: unequalList.length === 0, detail: unequalList.length === 0 ? 'six counts equal' : `unequal: ${unequalList.map((oneWanted) => oneWanted.join(':')).join(', ')}` };
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
		conjunctId: 'r7_scoredUnitWithoutJudgeRefused',
		title: "a scored block's record with no judge answer (q01) is refused by name",
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
		title: "a block declaring a retrieval method the Details prose has no description for is refused by name",
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
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r3_unresolvedQualifierRefused', twinName: 'qualifierCheckDeleted', mutationList: [{ find: 'if (unresolvedRefId !== undefined) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r4_incompleteTupleRefused', twinName: 'slotCheckDeleted', mutationList: [{ find: 'if (absentSlotName !== undefined) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't5_everyRangeShapeShown', twinName: 'classRangeDropped', mutationList: [{ find: 'if (cardLabel.rangeClassId !== undefined) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't6_poolListedPickMarked', twinName: 'pickNotMarked', mutationList: [{ find: 'const isPick = oneStableId === unitVerdict.proposedCardStableId;', replace: 'const isPick = false;' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't7_judgeRationaleShown', twinName: 'rationaleDropped', mutationList: [{ find: "const judgeHtml = judge === undefined ? '' :", replace: "const judgeHtml = true ? '' :" }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't8_judgeTextIsData', twinName: 'rationaleUntagged', mutationList: [{ find: '${dataSpan(judge.rationale)}', replace: '${escapeHtml(judge.rationale)}' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 't9_fourTagsAndNote', twinName: 'maybeTagMissing', mutationList: [{ find: "	{ tagValue: 'maybe', labelText: PAGE_WORDING.tagMaybe, labelClassName: '' },\n", replace: '' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'f1_facetCountsMeasured', twinName: 'facetCountNotMeasured', mutationList: [{ find: 'facetStateList.filter((oneState) => oneState[oneGroup.facetName] === oneValue).length', replace: 'facetStateList.length' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'd2_detailsNumbersAreTheBlocks', twinName: 'kTyped', mutationList: [{ find: 'up to ${escapeHtml(retrieval.k)} cards go to the judge', replace: 'up to 15 cards go to the judge' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r5_noRangeRefused', twinName: 'rangeShapeCheckDeleted', mutationList: [{ find: 'if (rangeShapeNameList.length !== 1) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r6_proposedNotInPoolRefused', twinName: 'poolCheckDeleted', mutationList: [{ find: 'if (unitVerdict.proposedCardStableId !== null && record.renderedPoolStableIdList.indexOf(unitVerdict.proposedCardStableId) === -1) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r7_scoredUnitWithoutJudgeRefused', twinName: 'judgeCheckDeleted', mutationList: [{ find: 'if (judgmentScored && (record.judge === undefined', replace: 'if (false && (record.judge === undefined' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r8_roundNotWholeRefused', twinName: 'roundCheckDeleted', mutationList: [{ find: 'if (!Number.isInteger(pageSetting.roundNumber) || pageSetting.roundNumber < 1) {', replace: 'if (false) {' }] });
registerPageMutationTwin({ gateId: GATE_T, conjunctId: 'r9_undescribedRetrievalRefused', twinName: 'retrievalCheckDeleted', mutationList: [{ find: 'if (retrievalProse === undefined) {', replace: 'if (false) {' }] });

const gateDeclarationList = [
	{ gateId: GATE_A, title: "plan §3 C6 (a): the page's numbers equal C5's on a synthetic block; a mislabelled pick changes exactly its numbers", conjunctList: gateAConjunctList },
	{ gateId: GATE_V, title: 'the verify-against-deployed step reads rendered content only', conjunctList: gateVConjunctList },
	{ gateId: GATE_C, title: "brief (c): no 'error' or 'wrong' in the page's own prose; the standards' data may carry them", conjunctList: gateCConjunctList },
	{ gateId: GATE_D, title: "a debug block's judgment is not scored on the page", conjunctList: gateDConjunctList },
	{ gateId: GATE_R, title: 'the refusals where the label list and the page setting enter', conjunctList: gateRConjunctList },
	{ gateId: GATE_T, title: 'phase C6b: every proposed and standard card renders as its full tuple, qualifiers resolved to their labels, and a card the hub distinguishes only by qualifier reads distinguishably', conjunctList: gateTConjunctList },
];

// ---- outside the gates ----
harness.section("the score the page shows is C5's: the page's question map adds members the scorer never reads");
const c5QuestionMapScore = scorer.scoreBlock({ ...readFixtureSet(), questionMap: JSON.parse(fs.readFileSync(C5_QUESTION_MAP_FILE_PATH, 'utf8')) });
harness.equal('scoring with C5\'s own question map gives the identical score', JSON.stringify(scoreOf(readFixtureSet()).score), JSON.stringify(c5QuestionMapScore.score));

harness.section('buildReviewPageFromFiles scores the files with the scorer and builds the same page, which verifies');
const pageModule = require(PAGE_FILE_PATH);
const fromFiles = pageModule.buildReviewPageFromFiles({ decisionBlockFilePath: FIXTURE_FILE_PATH_BY_ROLE.decisionBlock, annotationFilePath: FIXTURE_FILE_PATH_BY_ROLE.annotation, questionMapFilePath: FIXTURE_FILE_PATH_BY_ROLE.questionMap, cardListFilePath: FIXTURE_FILE_PATH_BY_ROLE.cardList, remodelTableFilePath: FIXTURE_FILE_PATH_BY_ROLE.remodelTable, cardLabelFilePath: FIXTURE_FILE_PATH_BY_ROLE.cardLabelList, pageSetting: { ...PAGE_SETTING } });
harness.ok('buildReviewPageFromFiles succeeds', !fromFiles.error, fromFiles.error && fromFiles.error.message);
harness.equal('the manifest records the five input shas', Object.keys(fromFiles.manifest).filter((oneName) => oneName.startsWith('inputSha256.')).length, 5);
const fromFilesVerified = pageModule.verifySifReviewPage({ htmlText: fromFiles.htmlText, score: fromFiles.score });
harness.ok('the file-built page verifies against its score, input shas included', fromFilesVerified.pass, JSON.stringify(fromFilesVerified.checkList.filter((oneCheck) => !oneCheck.pass)));
harness.equal('the feedback target is in the rendered script', fromFiles.htmlText.indexOf(`const FEEDBACK_TARGET_PATH=${JSON.stringify(PAGE_SETTING.feedbackTargetPath)};`) !== -1, true);

runGateFamily({ harness, familyName: 'SIF-PAGE', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 28, expectedTwinCount: 32 }, () => harness.report());
