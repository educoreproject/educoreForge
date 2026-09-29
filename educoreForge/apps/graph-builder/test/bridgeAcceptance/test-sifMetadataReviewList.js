#!/usr/bin/env node
'use strict';

// test-sifMetadataReviewList.js — phase C6's gates for sifMetadataReviewList.js (SPEC §6 M6b), over
// sifMetadataReviewListFixtures/: three SIF_Metadata questions (m01 3 rows, m02 2 rows, m03 4 rows) and one model
// question (q90) that must never be listed.
//
//   SIF-M6B         (b) the hand-worked list; SPEC M6b's twin (alter one metadata decision in scratch and the
//                   list shows the change in propagation count); the exact delta of that alteration
//   SIF-M6B-REFUSE  the named refusals where the block, the label list and the prior list enter
//
// Every conjunct is observed red under its own twin (forge-framework gateSuiteRunner). Hermetic.
//
// Run: PATH=/usr/local/bin:$PATH node apps/graph-builder/test/bridgeAcceptance/test-sifMetadataReviewList.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase C6 gates: the M6b metadata review list, its propagation counts, its delta against a prior list, and its refusals

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

const LIST_FILE_PATH = path.join(__dirname, 'sifMetadataReviewList.js');
const FIXTURE_DIRECTORY_PATH = path.join(__dirname, 'sifMetadataReviewListFixtures');
const FIXTURE_FILE_PATH_BY_ROLE = Object.freeze({
	decisionBlock: path.join(FIXTURE_DIRECTORY_PATH, 'sifMetadataReviewListFixtureBlock.json'),
	annotation: path.join(FIXTURE_DIRECTORY_PATH, 'sifMetadataReviewListFixtureAnnotation.json'),
	questionMap: path.join(FIXTURE_DIRECTORY_PATH, 'sifMetadataReviewListFixtureQuestionMap.json'),
	cardList: path.join(FIXTURE_DIRECTORY_PATH, 'sifMetadataReviewListFixtureCardList.json'),
	remodelTable: path.join(FIXTURE_DIRECTORY_PATH, 'sifMetadataReviewListFixtureRemodelTable.json'),
	cardLabelList: path.join(FIXTURE_DIRECTORY_PATH, 'sifMetadataReviewListFixtureCardLabelList.json'),
});

// THE FROZEN ANSWERS, worked by hand from the fixture (see the DEVLOG). Never edited to match a measurement.
// m01: P000011 has one card, M1; picked M1 over 3 rows -> agrees-target, 3. m02: unannotated; picked S9 over 2
// rows -> new-claim, 2. m03: P000012 has two cards and metadata has no domain, so key grain; abstained -> 0.
const EXPECTED_LIST_VIEW = Object.freeze({
	metadataQuestionCount: 3,
	instanceTotal: 9,
	propagationTotal: 5,
	pickedCount: 2,
	abstainedCount: 1,
	rowList: [
		{ relativePath: 'SIF_Metadata/Cost', standardCedsElementIdList: ['P000012'], proposedCardStableId: null, judgmentClass: 'abstained-where-specified', propagationCount: 0 },
		{ relativePath: 'SIF_Metadata/RefId', standardCedsElementIdList: ['P000011'], proposedCardStableId: 'card:M1', judgmentClass: 'agrees-target', propagationCount: 3 },
		{ relativePath: 'SIF_Metadata/Source', standardCedsElementIdList: [], proposedCardStableId: 'card:S9', judgmentClass: 'new-claim', propagationCount: 2 },
	],
});
// SPEC M6b's twin, as the fixture carries it: m03 (Cost, 4 rows) changes from an abstention to card:N1
const ALTERED_SUBJECT_STABLE_ID = 'sif260928:question/m03';
const EXPECTED_ALTERED_CHANGE_VIEW = Object.freeze({
	propagationTotal: 9,
	propagationTotalDelta: 4,
	changedRowList: [{ questionRefId: 'm03', relativePath: 'SIF_Metadata/Cost', priorDecisionText: 'abstained', decisionText: 'Dom Finance · Cost', priorPropagationCount: 0, propagationCount: 4, propagationDelta: 4 }],
	alteredRowClass: 'agrees-key',
	changedMarkdownLine: '- `SIF_Metadata/Cost`: abstained → Dom Finance · Cost; fields 0 → 4 (+4)',
});

const readFixtureSet = () => Object.keys(FIXTURE_FILE_PATH_BY_ROLE).reduce((soFar, oneRole) => ({ ...soFar, [oneRole]: JSON.parse(fs.readFileSync(FIXTURE_FILE_PATH_BY_ROLE[oneRole], 'utf8')) }), {});
// priorDecisionBlock is the unaltered block the prior list is built from; fixtureSet.decisionBlock is the
// scratch copy a twin may alter
const makeSubject = () => {
	const fixtureSet = readFixtureSet();
	return { fixtureSet, priorDecisionBlock: JSON.parse(JSON.stringify(fixtureSet.decisionBlock)), priorListShape: null, listMutationList: [] };
};
const cloneSubject = (subject) => ({ fixtureSet: JSON.parse(JSON.stringify(subject.fixtureSet)), priorDecisionBlock: JSON.parse(JSON.stringify(subject.priorDecisionBlock)), priorListShape: subject.priorListShape, listMutationList: subject.listMutationList.slice() });

const alterOneMetadataDecision = (decisionBlock) => {
	const decisionRecord = decisionBlock.decisionRecordList.find((oneRecord) => oneRecord.subjectStableId === ALTERED_SUBJECT_STABLE_ID);
	decisionRecord.abstained = false;
	decisionRecord.objectStableId = 'card:N1';
	decisionRecord.predicate = 'closeMatch';
};

// runList — builds the list for a block (the real scorer's score), with an optional prior list. A throw is a
// MEASURED OUTCOME, as in C5's suite.
const runList = ({ subject, decisionBlock, priorList }) => {
	const listModule = subject.listMutationList.length === 0 ? require(LIST_FILE_PATH) : moduleDouble.loadWithMutations({ modulePath: LIST_FILE_PATH, mutationList: subject.listMutationList });
	const scored = scorer.scoreBlock({ decisionBlock, annotation: subject.fixtureSet.annotation, questionMap: subject.fixtureSet.questionMap, cardList: subject.fixtureSet.cardList, remodelTable: subject.fixtureSet.remodelTable });
	if (scored.error) {
		return { scorerRefused: scored.error.message };
	}
	try {
		return listModule.buildMetadataReviewList({ score: scored.score, decisionBlock, questionMap: subject.fixtureSet.questionMap, cardLabelList: subject.fixtureSet.cardLabelList, priorList });
	} catch (listThrow) {
		return { thrownFromList: listThrow.message };
	}
};
// runWithPrior — the prior list from the unaltered block, then the list for the (possibly altered) scratch block
const runWithPrior = (subject) => {
	const priorOutcome = runList({ subject, decisionBlock: subject.priorDecisionBlock, priorList: null });
	if (priorOutcome.list === undefined) {
		return priorOutcome;
	}
	const priorList = subject.priorListShape === null ? priorOutcome.list : subject.priorListShape(JSON.parse(JSON.stringify(priorOutcome.list)));
	return runList({ subject, decisionBlock: subject.fixtureSet.decisionBlock, priorList });
};

const listViewOf = (list) => ({
	metadataQuestionCount: list.metadataQuestionCount,
	instanceTotal: list.instanceTotal,
	propagationTotal: list.propagationTotal,
	pickedCount: list.pickedCount,
	abstainedCount: list.abstainedCount,
	rowList: list.rowList.map((oneRow) => ({ relativePath: oneRow.relativePath, standardCedsElementIdList: oneRow.standardCedsElementIdList, proposedCardStableId: oneRow.proposedCardStableId, judgmentClass: oneRow.judgmentClass, propagationCount: oneRow.propagationCount })),
});
const builtJudge = (judgeList) => (outcome) => (outcome.thrownFromList !== undefined ? { pass: false, detail: `the list crashed: ${outcome.thrownFromList}` } : outcome.scorerRefused !== undefined ? { pass: false, detail: `the scorer refused: ${outcome.scorerRefused.slice(0, 200)}` } : outcome.error ? { pass: false, detail: `the list refused: ${outcome.error.message.slice(0, 200)}` } : judgeList(outcome));
const refusalJudge = (regex) => (outcome) => {
	if (outcome.thrownFromList !== undefined) {
		return { pass: false, detail: `NOT A REFUSAL — the list crashed, naming nothing: ${outcome.thrownFromList}` };
	}
	if (!outcome.error) {
		return { pass: false, detail: 'expected a refusal but the list was BUILT' };
	}
	return regex.test(outcome.error.message) ? { pass: true, detail: outcome.error.message.slice(0, 200) } : { pass: false, detail: `refused for another reason: ${outcome.error.message.slice(0, 200)}` };
};
const listConjunct = ({ conjunctId, title, twinNameList, shape, run, judge }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (subject, callback) => {
		if (shape) {
			shape(subject);
		}
		callback('', judge(run(subject)));
	},
});
const runWithoutPrior = (subject) => runList({ subject, decisionBlock: subject.fixtureSet.decisionBlock, priorList: null });

const twinRegistry = makeTwinRegistry();
const registerTwin = ({ gateId, conjunctId, twinName, leverKind, mutate }) => twinRegistry.register({ gateId, conjunctId, twinName, leverKind, shippedConfig: true, run: (subject) => {
	mutate(subject);
	return subject;
} });
const registerListMutationTwin = ({ gateId, conjunctId, twinName, find, replace }) => {
	moduleDouble.assertMutationApplies({ modulePath: LIST_FILE_PATH, find });
	registerTwin({ gateId, conjunctId, twinName, leverKind: 'productionMutation', mutate: (subject) => subject.listMutationList.push({ modulePath: LIST_FILE_PATH, find, replace }) });
};

// ---- GATE (b): the list, and SPEC M6b's twin ----
const GATE_B = 'SIF-M6B';
const gateBConjunctList = [
	listConjunct({
		conjunctId: 'b1_listExact',
		title: 'the list is exactly the hand-worked one: the three metadata questions (never the model question), each beside the standard\'s ids, with its class and propagation count, and the totals',
		twinNameList: ['abstentionPropagates', 'modelQuestionListed'],
		run: runWithoutPrior,
		judge: builtJudge((outcome) => {
			const measuredText = JSON.stringify(listViewOf(outcome.list));
			return { pass: measuredText === JSON.stringify(EXPECTED_LIST_VIEW), detail: measuredText === JSON.stringify(EXPECTED_LIST_VIEW) ? 'equal to the frozen literal' : `measured ${measuredText}` };
		}),
	}),
	listConjunct({
		conjunctId: 'b2_unalteredBlockShowsNoChange',
		title: 'against the prior list of the same block, no decision changed, no propagation count moved and the total delta is 0 (SPEC M6b: its twin alters one of the decisions in scratch)',
		twinNameList: ['oneMetadataDecisionAltered'],
		run: runWithPrior,
		judge: builtJudge((outcome) => {
			const movedRowList = outcome.list.rowList.filter((oneRow) => oneRow.propagationDelta !== 0 || oneRow.decisionChanged);
			const pass = outcome.list.changedRowList.length === 0 && outcome.list.propagationTotalDelta === 0 && movedRowList.length === 0;
			return { pass, detail: pass ? 'no change' : `changed: ${JSON.stringify(outcome.list.changedRowList)}; total delta ${outcome.list.propagationTotalDelta}` };
		}),
	}),
	listConjunct({
		conjunctId: 'b3_alteredDecisionShowsItsDelta',
		title: 'altering m03 from an abstention to card:N1 in scratch shows exactly that change: 0 -> 4 fields (+4), the total 9 (+4), the row now agrees-key, and the markdown says so',
		twinNameList: ['deltaNotComputed', 'decisionChangeNotDetected'],
		shape: (subject) => alterOneMetadataDecision(subject.fixtureSet.decisionBlock),
		run: runWithPrior,
		judge: builtJudge((outcome) => {
			const alteredRow = outcome.list.rowList.find((oneRow) => oneRow.subjectStableId === ALTERED_SUBJECT_STABLE_ID);
			const view = { propagationTotal: outcome.list.propagationTotal, propagationTotalDelta: outcome.list.propagationTotalDelta, changedRowList: outcome.list.changedRowList, alteredRowClass: alteredRow.judgmentClass, changedMarkdownLine: outcome.markdownText.split('\n').find((oneLine) => oneLine.startsWith('- `SIF_Metadata/Cost`')) };
			const pass = JSON.stringify(view) === JSON.stringify(EXPECTED_ALTERED_CHANGE_VIEW) && alteredRow.propagationDelta === 4;
			return { pass, detail: pass ? 'the delta equals the frozen literal' : `measured ${JSON.stringify(view)}; row delta ${alteredRow.propagationDelta}` };
		}),
	}),
];
registerListMutationTwin({ gateId: GATE_B, conjunctId: 'b1_listExact', twinName: 'abstentionPropagates', find: 'propagationCount: proposedCardStableId === null ? 0 : decisionRecord.instanceStableIdList.length,', replace: 'propagationCount: decisionRecord.instanceStableIdList.length,' });
registerListMutationTwin({ gateId: GATE_B, conjunctId: 'b1_listExact', twinName: 'modelQuestionListed', find: '.filter((oneQuestion) => oneQuestion.sharedBlock === METADATA_SHARED_BLOCK)', replace: '.filter((oneQuestion) => true)' });
// SPEC §6 M6b's own twin: one of the metadata decisions altered in a scratch copy of the block
registerTwin({ gateId: GATE_B, conjunctId: 'b2_unalteredBlockShowsNoChange', twinName: 'oneMetadataDecisionAltered', leverKind: 'inputFault', mutate: (subject) => alterOneMetadataDecision(subject.fixtureSet.decisionBlock) });
registerListMutationTwin({ gateId: GATE_B, conjunctId: 'b3_alteredDecisionShowsItsDelta', twinName: 'deltaNotComputed', find: 'oneRow.propagationDelta = oneRow.propagationCount - priorRow.propagationCount;', replace: 'oneRow.propagationDelta = 0;' });
registerListMutationTwin({ gateId: GATE_B, conjunctId: 'b3_alteredDecisionShowsItsDelta', twinName: 'decisionChangeNotDetected', find: 'oneRow.decisionChanged = oneRow.proposedCardStableId !== priorRow.proposedCardStableId;', replace: 'oneRow.decisionChanged = false;' });

// ---- the refusals ----
const GATE_R = 'SIF-M6B-REFUSE';
const recordOf = (subject, subjectStableId) => subject.fixtureSet.decisionBlock.decisionRecordList.find((oneRecord) => oneRecord.subjectStableId === subjectStableId);
const gateRConjunctList = [
	listConjunct({
		conjunctId: 'r1_metadataQuestionWithoutDecisionRefused',
		title: 'a metadata question with no decision in the block is refused by name',
		twinNameList: ['missingDecisionCheckDeleted'],
		shape: (subject) => {
			subject.fixtureSet.decisionBlock.decisionRecordList = subject.fixtureSet.decisionBlock.decisionRecordList.filter((oneRecord) => oneRecord.subjectStableId !== 'sif260928:question/m02');
		},
		run: runWithoutPrior,
		judge: refusalJudge(/metadata question m02 \(SIF_Metadata\/Source\) has no decision in the block/),
	}),
	listConjunct({
		conjunctId: 'r2_splitMetadataQuestionRefused',
		title: 'a metadata question judged more than once (split by domain) is refused by name',
		twinNameList: ['splitCheckDeleted'],
		shape: (subject) => {
			const splitRecord = JSON.parse(JSON.stringify(recordOf(subject, 'sif260928:question/m01')));
			splitRecord.judgmentPartitionLabel = 'Dom Record';
			subject.fixtureSet.decisionBlock.decisionRecordList.push(splitRecord);
		},
		run: runWithoutPrior,
		judge: refusalJudge(/metadata question m01 \(SIF_Metadata\/RefId\) has 2 decisions in the block/),
	}),
	listConjunct({
		conjunctId: 'r3_decisionWithoutInstanceListRefused',
		title: 'a metadata decision carrying no instanceStableIdList is refused by name, never counted from the question map',
		twinNameList: ['instanceListCheckDeleted'],
		shape: (subject) => {
			delete recordOf(subject, 'sif260928:question/m01').instanceStableIdList;
		},
		run: runWithoutPrior,
		judge: refusalJudge(/the decision for metadata question m01 carries no instanceStableIdList/),
	}),
	listConjunct({
		conjunctId: 'r4_unlabelledCardRefused',
		title: 'a card the list would name with no entry in the label list is refused by name',
		twinNameList: ['labelCheckDeleted'],
		shape: (subject) => {
			delete subject.fixtureSet.cardLabelList.cardLabelByStableId['card:S9'];
		},
		run: runWithoutPrior,
		judge: refusalJudge(/card card:S9 \(metadata question m02\) has no entry in the card label list/),
	}),
	listConjunct({
		conjunctId: 'r5_priorOverOtherQuestionsRefused',
		title: 'a prior list over a different set of metadata questions is refused by name',
		twinNameList: ['priorSetCheckDeleted'],
		shape: (subject) => {
			subject.priorListShape = (priorList) => ({ ...priorList, rowList: priorList.rowList.filter((oneRow) => oneRow.questionRefId !== 'm02') });
		},
		run: runWithPrior,
		judge: refusalJudge(/the prior list covers 2 metadata questions and this one 3, not the same set/),
	}),
];
registerListMutationTwin({ gateId: GATE_R, conjunctId: 'r1_metadataQuestionWithoutDecisionRefused', twinName: 'missingDecisionCheckDeleted', find: 'if (decisionRecordList.length === 0) {', replace: 'if (false) {' });
registerListMutationTwin({ gateId: GATE_R, conjunctId: 'r2_splitMetadataQuestionRefused', twinName: 'splitCheckDeleted', find: 'if (decisionRecordList.length > 1) {', replace: 'if (false) {' });
registerListMutationTwin({ gateId: GATE_R, conjunctId: 'r3_decisionWithoutInstanceListRefused', twinName: 'instanceListCheckDeleted', find: 'if (!Array.isArray(decisionRecord.instanceStableIdList)) {', replace: 'if (false) {' });
registerListMutationTwin({ gateId: GATE_R, conjunctId: 'r4_unlabelledCardRefused', twinName: 'labelCheckDeleted', find: 'if (unlabelledCardStableId !== undefined) {', replace: 'if (false) {' });
registerListMutationTwin({ gateId: GATE_R, conjunctId: 'r5_priorOverOtherQuestionsRefused', twinName: 'priorSetCheckDeleted', find: 'if (priorRefIdText !== currentRefIdText) {', replace: 'if (false) {' });

const gateDeclarationList = [
	{ gateId: GATE_B, title: 'plan §3 C6 (b) and SPEC §6 M6b: the metadata decisions beside the standard\'s ids, with propagation counts, and the change when one decision is altered', conjunctList: gateBConjunctList },
	{ gateId: GATE_R, title: 'the refusals where the block, the label list and the prior list enter', conjunctList: gateRConjunctList },
];

// ---- outside the gates: the file path ----
harness.section('buildMetadataReviewListFromFiles scores the files with the scorer and gives the same list');
const listModule = require(LIST_FILE_PATH);
const fromFiles = listModule.buildMetadataReviewListFromFiles({ decisionBlockFilePath: FIXTURE_FILE_PATH_BY_ROLE.decisionBlock, annotationFilePath: FIXTURE_FILE_PATH_BY_ROLE.annotation, questionMapFilePath: FIXTURE_FILE_PATH_BY_ROLE.questionMap, cardListFilePath: FIXTURE_FILE_PATH_BY_ROLE.cardList, remodelTableFilePath: FIXTURE_FILE_PATH_BY_ROLE.remodelTable, cardLabelFilePath: FIXTURE_FILE_PATH_BY_ROLE.cardLabelList, priorListFilePath: null });
harness.ok('buildMetadataReviewListFromFiles succeeds', !fromFiles.error, fromFiles.error && fromFiles.error.message);
harness.equal('its list equals the frozen literal', JSON.stringify(listViewOf(fromFiles.list)), JSON.stringify(EXPECTED_LIST_VIEW));
harness.equal('it records a sha256 per input role', Object.keys(fromFiles.list.inputFileSha256ByRole).sort().join(','), 'annotation,cardList,decisionBlock,questionMap,remodelTable');
harness.ok('without a prior list, the markdown says no change is shown', fromFiles.markdownText.indexOf(listModule.LIST_WORDING.noPriorList) !== -1 && fromFiles.list.propagationTotalDelta === null);

runGateFamily({ harness, familyName: 'SIF-M6B', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 8, expectedTwinCount: 10 }, () => harness.report());
