#!/usr/bin/env node
'use strict';

// test-sifYardstickScorer.js — phase C5's gates for sifYardstickScorer.js, over the synthetic fixtures in
// sifYardstickFixtures/ (fifteen units covering every standing, class and shared block; the counts are
// worked by hand and frozen below).
//
//   SIF-YARDSTICK-A       (a) exact class counts; the remap (supervisor ruling)
//   SIF-YARDSTICK-B       (b) neither forbidden word in the output, by the test's own scan; the scorer refuses one
//   SIF-YARDSTICK-C       (c) a debug block's judgment reads 'debug — not scored'
//   SIF-YARDSTICK-REFUSE  the named refusals where the yardstick, card list and remodel table enter
//
// Every conjunct is observed red under its own twin (forge-framework gateSuiteRunner). Hermetic: no graph,
// no Docker, no network.
//
// Run: PATH=/usr/local/bin:$PATH node apps/graph-builder/test/bridgeAcceptance/test-sifYardstickScorer.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase C5 gates: the SIF yardstick scorer's class counts, its wording scan, its debug section, its remap and its refusals

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

const SCORER_FILE_PATH = path.join(__dirname, 'sifYardstickScorer.js');
const FIXTURE_DIRECTORY_PATH = path.join(__dirname, 'sifYardstickFixtures');
const FIXTURE_FILE_PATH_BY_ROLE = Object.freeze({
	decisionBlock: path.join(FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureBlock.json'),
	annotation: path.join(FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureAnnotation.json'),
	questionMap: path.join(FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureQuestionMap.json'),
	cardList: path.join(FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureCardList.json'),
	remodelTable: path.join(FIXTURE_DIRECTORY_PATH, 'sifYardstickFixtureRemodelTable.json'),
});

// THE FROZEN ANSWERS, worked out by hand from the fixture (one unit per record; see the DEVLOG's table).
// Never edited to match a measurement.
const EXPECTED_COUNT_VIEW = Object.freeze({
	unitCount: 15,
	standingCountByName: { specified: 8, contended: 3, 'key-without-card': 1, unannotated: 3 },
	keyRemodeledCount: 1,
	unannotatedAbstainedCount: 1,
	notRetrievedCount: 1,
	recallHitCountList: [4, 7, 9, 9, 10, 10, 10],
	countByClass: { 'agrees-target': 5, 'agrees-key': 2, disagrees: 2, 'abstained-where-specified': 1 },
	targetGrainOnSpecified: { retrievedCount: 7, agreesTargetCount: 4 },
	keyGrainOnContended: { retrievedCount: 3, agreesKeyGrainCount: 3 },
	newClaimCount: 2,
	bySharedBlock: [
		{ sharedBlock: 'model', unitCount: 11, notRetrievedCount: 1, recallHitCountList: [4, 5, 7, 7, 7, 7, 7], countByClass: { 'agrees-target': 4, 'agrees-key': 1, disagrees: 1, 'abstained-where-specified': 1 }, newClaimCount: 2, unannotatedAbstainedCount: 0 },
		{ sharedBlock: 'SIF_Metadata', unitCount: 2, notRetrievedCount: 0, recallHitCountList: [0, 1, 1, 1, 2, 2, 2], countByClass: { 'agrees-target': 1, 'agrees-key': 1, disagrees: 0, 'abstained-where-specified': 0 }, newClaimCount: 0, unannotatedAbstainedCount: 0 },
		{ sharedBlock: 'SIF_ExtendedElements', unitCount: 2, notRetrievedCount: 0, recallHitCountList: [0, 1, 1, 1, 1, 1, 1], countByClass: { 'agrees-target': 0, 'agrees-key': 0, disagrees: 1, 'abstained-where-specified': 0 }, newClaimCount: 0, unannotatedAbstainedCount: 1 },
	],
});
const EXPECTED_DEBUG_STATUS_TEXT = 'debug — not scored';
// the test's OWN scan, written independently of the scorer's pattern so gate (b) does not check the scorer
// against itself
const TEST_FORBIDDEN_WORD_LIST = Object.freeze(['error', 'wrong']);

const readFixtureSet = () => Object.keys(FIXTURE_FILE_PATH_BY_ROLE).reduce((soFar, oneRole) => ({ ...soFar, [oneRole]: JSON.parse(fs.readFileSync(FIXTURE_FILE_PATH_BY_ROLE[oneRole], 'utf8')) }), {});
const makeSubject = () => ({ fixtureSet: readFixtureSet(), scorerMutationList: [] });
const cloneSubject = (subject) => ({ fixtureSet: JSON.parse(JSON.stringify(subject.fixtureSet)), scorerMutationList: subject.scorerMutationList.slice() });

// runScorer — the real module, or an in-memory double of it when a twin mutated its source. A throw is a
// MEASURED OUTCOME here, as in toyScenario: a twin that deletes a refusal can crash the scorer unnamed, and
// that crash must read as a red, not as an unmeasured gate.
const runScorer = (subject) => {
	const scorer = subject.scorerMutationList.length === 0 ? require(SCORER_FILE_PATH) : moduleDouble.loadWithMutations({ modulePath: SCORER_FILE_PATH, mutationList: subject.scorerMutationList });
	try {
		return scorer.scoreBlock(subject.fixtureSet);
	} catch (scorerThrow) {
		return { thrownFromScorer: scorerThrow.message };
	}
};

const countViewOf = (score) => ({
	unitCount: score.population.unitCount,
	standingCountByName: score.population.standingCountByName,
	keyRemodeledCount: score.population.keyRemodeledCount,
	unannotatedAbstainedCount: score.population.unannotatedAbstainedCount,
	notRetrievedCount: score.retrieval.notRetrievedCount,
	recallHitCountList: score.retrieval.recallByK.map((oneRow) => oneRow.hitCount),
	countByClass: score.judgment.countByClass,
	targetGrainOnSpecified: score.judgment.targetGrainOnSpecified,
	keyGrainOnContended: score.judgment.keyGrainOnContended,
	newClaimCount: score.judgment.newClaimCount,
	bySharedBlock: score.bySharedBlock.map((oneBlock) => ({ sharedBlock: oneBlock.sharedBlock, unitCount: oneBlock.population.unitCount, notRetrievedCount: oneBlock.retrieval.notRetrievedCount, recallHitCountList: oneBlock.retrieval.recallByK.map((oneRow) => oneRow.hitCount), countByClass: oneBlock.judgment.countByClass, newClaimCount: oneBlock.judgment.newClaimCount, unannotatedAbstainedCount: oneBlock.population.unannotatedAbstainedCount })),
});

const recordOf = (subject, subjectStableId, judgmentPartitionLabel) => subject.fixtureSet.decisionBlock.decisionRecordList.find((oneRecord) => oneRecord.subjectStableId === subjectStableId && (judgmentPartitionLabel === undefined || oneRecord.judgmentPartitionLabel === judgmentPartitionLabel));
const scorerMutation = ({ find, replace }) => ({ modulePath: SCORER_FILE_PATH, find, replace });

// a conjunct: optionally shape the subject, run the scorer, judge the outcome
const scorerConjunct = ({ conjunctId, title, twinNameList, shape, judge }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (subject, callback) => {
		if (shape) {
			shape(subject);
		}
		callback('', judge(runScorer(subject), subject));
	},
});
const refusalJudge = (regex) => (outcome) => {
	if (outcome.thrownFromScorer !== undefined) {
		return { pass: false, detail: `NOT A REFUSAL — the scorer crashed, naming nothing: ${outcome.thrownFromScorer}` };
	}
	if (!outcome.error) {
		return { pass: false, detail: 'expected a refusal but the scorer SUCCEEDED' };
	}
	return regex.test(outcome.error.message) ? { pass: true, detail: outcome.error.message.slice(0, 200) } : { pass: false, detail: `refused for another reason: ${outcome.error.message.slice(0, 200)}` };
};
const scoredJudge = (judgeScore) => (outcome) => (outcome.thrownFromScorer !== undefined ? { pass: false, detail: `the scorer crashed: ${outcome.thrownFromScorer}` } : outcome.error ? { pass: false, detail: `the scorer refused: ${outcome.error.message.slice(0, 200)}` } : judgeScore(outcome));

const twinRegistry = makeTwinRegistry();
const registerTwin = ({ gateId, conjunctId, twinName, leverKind, mutate }) => twinRegistry.register({ gateId, conjunctId, twinName, leverKind, shippedConfig: true, run: (subject) => {
	mutate(subject);
	return subject;
} });
const registerScorerMutationTwin = ({ gateId, conjunctId, twinName, find, replace }) => {
	moduleDouble.assertMutationApplies({ modulePath: SCORER_FILE_PATH, find });
	registerTwin({ gateId, conjunctId, twinName, leverKind: 'productionMutation', mutate: (subject) => subject.scorerMutationList.push(scorerMutation({ find, replace })) });
};

// ---- GATE (a): exact class counts, and the remap ----
const GATE_A = 'SIF-YARDSTICK-A';
const gateAConjunctList = [
	scorerConjunct({
		conjunctId: 'a1_classCountsExact',
		title: 'the synthetic block gives exactly the hand-worked counts: population, not-retrieved, recall@K, the four judgment classes, both grains, new-claim, and the per-block split',
		twinNameList: ['onePickMislabelled', 'recallBoundOffByOne'],
		judge: scoredJudge((outcome) => {
			const measuredText = JSON.stringify(countViewOf(outcome.score));
			const expectedText = JSON.stringify(EXPECTED_COUNT_VIEW);
			return { pass: measuredText === expectedText, detail: measuredText === expectedText ? 'equal to the frozen literal' : `measured ${measuredText}` };
		}),
	}),
	scorerConjunct({
		conjunctId: 'a2_remodelApplied',
		title: "a remodeled id is looked up under the hub's id: q13 (P000005 -> P000001) is specified and agrees-target, key-remodeled lists it, and key-without-card lists only P000003",
		twinNameList: ['remodelNotApplied'],
		judge: scoredJudge((outcome) => {
			const unitVerdict = outcome.score.unitVerdictList.find((oneVerdict) => oneVerdict.subjectStableId === 'sif260928:question/q13');
			const population = outcome.score.population;
			const pass = unitVerdict.standing === 'specified' && unitVerdict.remodeledToCedsElementId === 'P000001' && unitVerdict.judgmentClass === 'agrees-target' && JSON.stringify(population.keyRemodeledIdList) === JSON.stringify(['P000005->P000001']) && JSON.stringify(population.keyWithoutCardIdList) === JSON.stringify(['P000003']);
			return { pass, detail: `q13 standing ${unitVerdict.standing}, remodeled to ${unitVerdict.remodeledToCedsElementId}, class ${unitVerdict.judgmentClass}; key-remodeled ${JSON.stringify(population.keyRemodeledIdList)}; key-without-card ${JSON.stringify(population.keyWithoutCardIdList)}` };
		}),
	}),
];
registerTwin({ gateId: GATE_A, conjunctId: 'a1_classCountsExact', twinName: 'onePickMislabelled', leverKind: 'inputFault', mutate: (subject) => {
	recordOf(subject, 'sif260928:question/q01').objectStableId = 'card:X';
} });
registerScorerMutationTwin({ gateId: GATE_A, conjunctId: 'a1_classCountsExact', twinName: 'recallBoundOffByOne', find: 'unitVerdict.bestKeyRank <= oneK ? 1 : 0', replace: 'unitVerdict.bestKeyRank < oneK ? 1 : 0' });
registerScorerMutationTwin({ gateId: GATE_A, conjunctId: 'a2_remodelApplied', twinName: 'remodelNotApplied', find: 'target: { canonicalKey: cedsElementId }, remodelTable, hubName, hubVersion', replace: 'target: { canonicalKey: cedsElementId }, remodelTable: null, hubName, hubVersion' });

// ---- GATE (b): the words the report never says ----
const GATE_B = 'SIF-YARDSTICK-B';
const testScanHitList = (text) => TEST_FORBIDDEN_WORD_LIST.filter((oneWord) => text.toLowerCase().indexOf(oneWord) !== -1);
const gateBConjunctList = [
	scorerConjunct({
		conjunctId: 'b1_outputScansClean',
		title: "the scorer's whole output (score JSON and markdown) contains neither 'error' nor 'wrong', by the test's own scan",
		twinNameList: ['wordingRowCarriesForbiddenWord'],
		judge: scoredJudge((outcome) => {
			const hitList = testScanHitList(`${JSON.stringify(outcome.score)}\n${outcome.markdownText}`);
			return { pass: hitList.length === 0, detail: hitList.length === 0 ? 'no forbidden word' : `forbidden word(s) found: ${hitList.join(', ')}` };
		}),
	}),
	scorerConjunct({
		conjunctId: 'b2_scorerRefusesForbiddenWord',
		title: 'an output that would carry a forbidden word (a fixture card id containing it) is refused by name, never emitted',
		twinNameList: ['selfScanRemoved'],
		shape: (subject) => {
			recordOf(subject, 'sif260928:question/q02').objectStableId = 'card:wrongX';
		},
		judge: refusalJudge(/forbidden word\(s\) \(wrong\)/),
	}),
];
// the wording row carries the word AND the scorer's own scan is removed, so the red is the TEST's scan's
registerTwin({ gateId: GATE_B, conjunctId: 'b1_outputScansClean', twinName: 'wordingRowCarriesForbiddenWord', leverKind: 'productionMutation', mutate: (subject) => {
	subject.scorerMutationList.push(scorerMutation({ find: "classDisagrees: 'disagrees',", replace: "classDisagrees: 'wrong'," }));
	subject.scorerMutationList.push(scorerMutation({ find: 'if (hitList.length > 0) {', replace: 'if (false) {' }));
} });
moduleDouble.assertMutationApplies({ modulePath: SCORER_FILE_PATH, find: "classDisagrees: 'disagrees'," });
registerScorerMutationTwin({ gateId: GATE_B, conjunctId: 'b2_scorerRefusesForbiddenWord', twinName: 'selfScanRemoved', find: 'if (hitList.length > 0) {', replace: 'if (false) {' });

// ---- GATE (c): a debug block is not scored ----
const GATE_C = 'SIF-YARDSTICK-C';
const gateCConjunctList = [
	scorerConjunct({
		conjunctId: 'c1_debugJudgmentNotScored',
		title: "a debug block's judgment section reads exactly 'debug — not scored' (overall and per block, no class counts, no comparison lines), and its retrieval is still reported",
		twinNameList: ['debugMarkIgnored'],
		shape: (subject) => {
			subject.fixtureSet.decisionBlock.header.generation = `${subject.fixtureSet.decisionBlock.header.generation}-INVALID_DEBUG`;
		},
		judge: scoredJudge((outcome) => {
			const score = outcome.score;
			const judgmentSectionText = outcome.markdownText.split('## Judgment\n\n')[1].split('\n')[0];
			const everyJudgmentUnscored = [score.judgment].concat(score.bySharedBlock.map((oneBlock) => oneBlock.judgment)).every((oneJudgment) => oneJudgment.scored === false && oneJudgment.statusText === EXPECTED_DEBUG_STATUS_TEXT && oneJudgment.countByClass === undefined);
			const retrievalStillReported = JSON.stringify(score.retrieval.recallByK.map((oneRow) => oneRow.hitCount)) === JSON.stringify(EXPECTED_COUNT_VIEW.recallHitCountList) && score.retrieval.notRetrievedCount === EXPECTED_COUNT_VIEW.notRetrievedCount;
			const pass = judgmentSectionText === EXPECTED_DEBUG_STATUS_TEXT && everyJudgmentUnscored && score.comparisonLineList.length === 0 && retrievalStillReported;
			return { pass, detail: `judgment section reads '${judgmentSectionText}'; every judgment unscored ${everyJudgmentUnscored}; comparison lines ${score.comparisonLineList.length}; retrieval still reported ${retrievalStillReported}` };
		}),
	}),
];
registerScorerMutationTwin({ gateId: GATE_C, conjunctId: 'c1_debugJudgmentNotScored', twinName: 'debugMarkIgnored', find: 'const debugMark = debugJudge.debugMarkFromGeneration(decisionBlock.header.generation);', replace: 'const debugMark = undefined;' });

// ---- the refusals at the edge where the yardstick and the card list enter ----
const GATE_R = 'SIF-YARDSTICK-REFUSE';
const gateRConjunctList = [
	scorerConjunct({
		conjunctId: 'r1_subjectOutsideQuestionMapRefused',
		title: 'a record whose subject is not a question of the question map is refused by name',
		twinNameList: ['questionMapCheckDeleted'],
		shape: (subject) => {
			recordOf(subject, 'sif260928:question/q01').subjectStableId = 'sif260928:question/q99';
		},
		judge: refusalJudge(/sif260928:question\/q99, which is not a question of the yardstick's question map/),
	}),
	scorerConjunct({
		conjunctId: 'r2_unknownSharedBlockRefused',
		title: 'a question carrying a sharedBlock outside the three is refused by name',
		twinNameList: ['sharedBlockCheckDeleted'],
		shape: (subject) => {
			subject.fixtureSet.questionMap.questionList.find((oneQuestion) => oneQuestion.questionRefId === 'q01').sharedBlock = 'SIF_Other';
		},
		judge: refusalJudge(/question q01 carries sharedBlock 'SIF_Other'/),
	}),
	scorerConjunct({
		conjunctId: 'r3_unitSpanningTwoIdsRefused',
		title: 'a unit whose instances carry two annotated ids is refused by name',
		twinNameList: ['multiIdCheckDeleted'],
		shape: (subject) => {
			subject.fixtureSet.annotation.cedsElementIdByXpath['/Ss/S1/e'] = 'P000004';
			delete recordOf(subject, 'sif260928:question/q05', 'Dom Student').instanceStableIdList;
		},
		judge: refusalJudge(/spans 2 annotated ids \(P000002, P000004\)/),
	}),
	scorerConjunct({
		conjunctId: 'r4_idWithoutCardListEntryRefused',
		title: 'an annotated id with no entry in the card list (after the remap) is refused by name, never read as no card',
		twinNameList: ['cardListCheckDeleted'],
		shape: (subject) => {
			delete subject.fixtureSet.cardList.cardsBySifCedsId.P000003;
		},
		judge: refusalJudge(/the card list has no entry for P000003/),
	}),
	scorerConjunct({
		conjunctId: 'r5_remodelSectionAbsentRefused',
		title: "a block whose hubName@hubVersion has no section in the remodel table is refused by name",
		twinNameList: ['remodelSectionCheckDeleted'],
		shape: (subject) => {
			subject.fixtureSet.decisionBlock.header.hubVersion = '2';
		},
		judge: refusalJudge(/no entry for ToyHub@2/),
	}),
	scorerConjunct({
		conjunctId: 'r6_instanceOutsideQuestionRefused',
		title: "an instance that is not a row of its unit's question (a stableId prefix the scorer does not read, say) is refused by name, never read as unannotated",
		twinNameList: ['instanceRowCheckDeleted'],
		shape: (subject) => {
			recordOf(subject, 'sif260928:question/q01').instanceStableIdList = ['sif260928:fieldRow/Os/O1/a'];
		},
		judge: refusalJudge(/has an instance at Row\/Os\/O1\/a, which is not a row of question q01/),
	}),
];
registerScorerMutationTwin({ gateId: GATE_R, conjunctId: 'r1_subjectOutsideQuestionMapRefused', twinName: 'questionMapCheckDeleted', find: '\t\tif (question === undefined) {', replace: '\t\tif (false) {' });
registerScorerMutationTwin({ gateId: GATE_R, conjunctId: 'r2_unknownSharedBlockRefused', twinName: 'sharedBlockCheckDeleted', find: 'if (SHARED_BLOCK_LIST.indexOf(question.sharedBlock) === -1) {', replace: 'if (false) {' });
registerScorerMutationTwin({ gateId: GATE_R, conjunctId: 'r3_unitSpanningTwoIdsRefused', twinName: 'multiIdCheckDeleted', find: 'if (cedsElementIdList.length > 1) {', replace: 'if (false) {' });
registerScorerMutationTwin({ gateId: GATE_R, conjunctId: 'r4_idWithoutCardListEntryRefused', twinName: 'cardListCheckDeleted', find: 'if (cardList === undefined) {', replace: 'if (false) {' });
registerScorerMutationTwin({ gateId: GATE_R, conjunctId: 'r5_remodelSectionAbsentRefused', twinName: 'remodelSectionCheckDeleted', find: "if (remodelTable[remodelTableSectionName] === null || typeof remodelTable[remodelTableSectionName] !== 'object') {", replace: 'if (false) {' });
registerScorerMutationTwin({ gateId: GATE_R, conjunctId: 'r6_instanceOutsideQuestionRefused', twinName: 'instanceRowCheckDeleted', find: 'if (strayXpath !== undefined) {', replace: 'if (false) {' });

const gateDeclarationList = [
	{ gateId: GATE_A, title: 'plan §3 C5 (a): a synthetic block with known answers gives exact class counts; the remap (supervisor ruling)', conjunctList: gateAConjunctList },
	{ gateId: GATE_B, title: "plan §3 C5 (b): no 'error' or 'wrong' in the output", conjunctList: gateBConjunctList },
	{ gateId: GATE_C, title: "plan §3 C5 (c): a debug block's judgment reads 'debug — not scored'", conjunctList: gateCConjunctList },
	{ gateId: GATE_R, title: 'the refusals where the yardstick, the card list and the remodel table enter', conjunctList: gateRConjunctList },
];

// ---- outside the gates: the file path, and the brief's reading of twin (a) ----
harness.section('scoreFromFiles reads the five fixture files and gives the same score as scoreBlock');
const scorer = require(SCORER_FILE_PATH);
const fromFiles = scorer.scoreFromFiles({ decisionBlockFilePath: FIXTURE_FILE_PATH_BY_ROLE.decisionBlock, annotationFilePath: FIXTURE_FILE_PATH_BY_ROLE.annotation, questionMapFilePath: FIXTURE_FILE_PATH_BY_ROLE.questionMap, cardListFilePath: FIXTURE_FILE_PATH_BY_ROLE.cardList, remodelTableFilePath: FIXTURE_FILE_PATH_BY_ROLE.remodelTable });
harness.ok('scoreFromFiles succeeds', !fromFiles.error, fromFiles.error && fromFiles.error.message);
harness.equal('its counts equal the frozen literal', JSON.stringify(countViewOf(fromFiles.score)), JSON.stringify(EXPECTED_COUNT_VIEW));
harness.equal('it records a sha256 per input role', Object.keys(fromFiles.score.inputFileSha256ByRole).sort().join(','), 'annotation,cardList,decisionBlock,questionMap,remodelTable');

harness.section('twin (a) as the brief reads it: one mislabelled pick moves exactly one unit, from agrees-target to disagrees');
const mislabelledSubject = makeSubject();
recordOf(mislabelledSubject, 'sif260928:question/q01').objectStableId = 'card:X';
const mislabelledCountByClass = runScorer(mislabelledSubject).score.judgment.countByClass;
const classDeltaList = Object.keys(EXPECTED_COUNT_VIEW.countByClass).filter((oneClass) => mislabelledCountByClass[oneClass] !== EXPECTED_COUNT_VIEW.countByClass[oneClass]).map((oneClass) => `${oneClass} ${mislabelledCountByClass[oneClass] - EXPECTED_COUNT_VIEW.countByClass[oneClass] > 0 ? '+' : ''}${mislabelledCountByClass[oneClass] - EXPECTED_COUNT_VIEW.countByClass[oneClass]}`);
harness.equal('the class deltas are exactly agrees-target -1, disagrees +1', classDeltaList.join('; '), 'agrees-target -1; disagrees +1');

runGateFamily({ harness, familyName: 'SIF-YARDSTICK', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 11, expectedTwinCount: 12 }, () => harness.report());
