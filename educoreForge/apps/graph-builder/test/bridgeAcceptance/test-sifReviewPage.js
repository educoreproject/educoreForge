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
	decisionBlock: path.join(YARDSTICK_FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureBlock.json'),
	annotation: path.join(YARDSTICK_FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureAnnotation.json'),
	questionMap: path.join(PAGE_FIXTURE_DIRECTORY_PATH, 'sifReviewPageFixtureQuestionMap.json'),
	cardList: path.join(YARDSTICK_FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureCardList.json'),
	remodelTable: path.join(YARDSTICK_FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureRemodelTable.json'),
	cardLabelList: path.join(PAGE_FIXTURE_DIRECTORY_PATH, 'sifReviewPageFixtureCardLabelList.json'),
});
const C5_QUESTION_MAP_FILE_PATH = path.join(YARDSTICK_FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureQuestionMap.json');
const PAGE_SETTING = Object.freeze({ feedbackTargetPath: 'educoreForge/system/dataStores/bridgeAcceptance/sif260928/feedback/c6FixtureTags.json', draftStoragePrefix: 'sifReviewPageFixture::', pageTitle: 'SIF review page (C6 fixture)' });

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
		const built = pageModule.buildReviewPageHtml({ score: scored.score, questionMap: fixtureSet.questionMap, cardLabelList: fixtureSet.cardLabelList, pageSetting: subject.pageSetting });
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
		twinNameList: ['visibleItemMovedIntoComment', 'oneCellTampered', 'feedbackPathOnlyInManifest'],
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
registerPageMutationTwin({ gateId: GATE_C, conjunctId: 'c1_ownProseClean', twinName: 'templateRowCarriesForbiddenWord', mutationList: [{ find: "tagUnsure: 'unsure',", replace: "tagUnsure: 'wrong'," }, { find: 'if (hitList.length > 0) {', replace: 'if (false) {' }] });
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
		judge: refusalJudge(/card card:Y \(unit sif260928:question\/q11\) has no entry in the card label list/),
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

const gateDeclarationList = [
	{ gateId: GATE_A, title: "plan §3 C6 (a): the page's numbers equal C5's on a synthetic block; a mislabelled pick changes exactly its numbers", conjunctList: gateAConjunctList },
	{ gateId: GATE_V, title: 'the verify-against-deployed step reads rendered content only', conjunctList: gateVConjunctList },
	{ gateId: GATE_C, title: "brief (c): no 'error' or 'wrong' in the page's own prose; the standards' data may carry them", conjunctList: gateCConjunctList },
	{ gateId: GATE_D, title: "a debug block's judgment is not scored on the page", conjunctList: gateDConjunctList },
	{ gateId: GATE_R, title: 'the refusals where the label list and the page setting enter', conjunctList: gateRConjunctList },
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

runGateFamily({ harness, familyName: 'SIF-PAGE', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 10, expectedTwinCount: 13 }, () => harness.report());
