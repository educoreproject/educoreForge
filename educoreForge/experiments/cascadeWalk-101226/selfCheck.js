#!/usr/bin/env node
'use strict';

// selfCheck.js — the scorer's own checks, over hand-built fixtures (no graph, no AI). The decision rule (§6) and the
// recall / proxy-correct / §5.6 arithmetic are what RESULTS-WALK stands on, so each is asserted here on a case whose
// answer is known by construction. Optional --scoringModulePath=<file> points at another copy of scoring.js: that is
// how a mutated copy is shown to turn this check red.
//
// Exit 0 when every assertion holds, 1 otherwise.

const path = require('path');

const scoringModuleArgument = process.argv.find((oneArgument) => oneArgument.indexOf('--scoringModulePath=') === 0);
const scoringLib = require(scoringModuleArgument === undefined ? path.join(__dirname, 'parts', 'scoring') : path.resolve(scoringModuleArgument.split('=')[1]));

const resultList = [];
const check = (checkName, holds) => resultList.push({ checkName, holds });

// --- realDifference: real only when EVERY run differs by at least the minimum, on either measure ---
const runOf = (proxyByArm, recallByArm) => ({ armScoreByArmName: Object.keys(proxyByArm).reduce((soFar, armName) => Object.assign(soFar, { [armName]: { proxyCorrectCount: proxyByArm[armName], recallHitCount: recallByArm[armName] } }), {}) });
const allRunsByThree = [runOf({ A1: 40, A0: 37 }, { A1: 10, A0: 10 }), runOf({ A1: 41, A0: 37 }, { A1: 10, A0: 10 }), runOf({ A1: 43, A0: 40 }, { A1: 10, A0: 10 })];
check('realDifference: +3 in all three runs is real', scoringLib.realDifference({ runScoreList: allRunsByThree, leaderArmName: 'A1', otherArmName: 'A0', minimumSubjectCount: 3 }).real === true);
const oneRunShort = [runOf({ A1: 40, A0: 37 }, { A1: 10, A0: 10 }), runOf({ A1: 39, A0: 37 }, { A1: 10, A0: 10 }), runOf({ A1: 43, A0: 40 }, { A1: 10, A0: 10 })];
check('realDifference: +2 in one run is not real', scoringLib.realDifference({ runScoreList: oneRunShort, leaderArmName: 'A1', otherArmName: 'A0', minimumSubjectCount: 3 }).real === false);
const recallOnly = [runOf({ A1: 30, A0: 30 }, { A1: 20, A0: 15 }), runOf({ A1: 30, A0: 30 }, { A1: 19, A0: 15 }), runOf({ A1: 30, A0: 30 }, { A1: 18, A0: 15 })];
check('realDifference: recall alone can make it real', scoringLib.realDifference({ runScoreList: recallOnly, leaderArmName: 'A1', otherArmName: 'A0', minimumSubjectCount: 3 }).real === true);
check('realDifference: the reverse direction is not real', scoringLib.realDifference({ runScoreList: allRunsByThree, leaderArmName: 'A0', otherArmName: 'A1', minimumSubjectCount: 3 }).real === false);

// --- scoreRun: two subjects, one label truth, one NONE truth ---
const cardList = [
	{ stableId: 'card/a', domainName: 'Person', name: 'Has Name' },
	{ stableId: 'card/b', domainName: 'Organization', name: 'Has Name' },
	{ stableId: 'card/c', domainName: 'Person', name: 'Birthdate' },
];
const cardByStableId = cardList.reduce((soFar, oneCard) => Object.assign(soFar, { [oneCard.stableId]: oneCard }), {});
const truthResolution = scoringLib.truthBySubjectFor({
	proxyTruthRowList: [{ path: 'Student.Name', truth: 'Person.Has Name' }, { path: 'Student.Shoe', truth: 'NONE' }, { path: 'Student.Hat', truth: 'a hat card, or abstain' }],
	subjectStableIdList: ['edfi:property/domainEntity.Student.Name', 'edfi:property/domainEntity.Student.Shoe', 'edfi:property/domainEntity.Student.Hat'],
	cardList,
});
const truthBySubject = truthResolution.truthBySubject;
check('truth: a label resolves to its card only (the class is half the idea)', JSON.stringify(truthBySubject['edfi:property/domainEntity.Student.Name'].truthCardStableIdList) === JSON.stringify(['card/a']));
check('truth: a sentence is unmatchable', truthBySubject['edfi:property/domainEntity.Student.Hat'].truthKind === 'sentence');
const structureIndex = {
	classStableIdListByCardStableId: { 'card/a': ['class/person'], 'card/b': ['class/organization'], 'card/c': ['class/person'] },
	propertyStableIdListByCardStableId: { 'card/a': ['property/name'], 'card/b': ['property/name'], 'card/c': ['property/birthdate'] },
	unplacedPropertyStableIdSet: new Set(),
	propertyStableIdListByDesEntityStableId: {},
	desEntityListByDomainStableId: {},
};
const armResultOf = ({ cappedCardStableIdList, outcome, chosenCardStableId, walkTrace }) => ({ cappedCardStableIdList, uncappedCardStableIdList: cappedCardStableIdList, outcome, walkTrace, buildMs: 1, judgeMs: 1, judged: outcome === 'noCandidate' ? null : { chosenCardStableId, cacheHit: true, usage: null, judgeSummary: { judgePickConfidence: 0.9 } } });
const rowList = [
	{ subjectStableId: 'edfi:property/domainEntity.Student.Name', armResultByArmName: {
		A0: armResultOf({ cappedCardStableIdList: ['card/a', 'card/b'], outcome: 'picked', chosenCardStableId: 'card/a' }),
		// the same-property card on another class is in the pool, the truth card is not: a miss, and the walk chose the wrong class
		A1: armResultOf({ cappedCardStableIdList: ['card/b'], outcome: 'picked', chosenCardStableId: 'card/b', walkTrace: { memberClassStableIdList: ['class/person', 'class/organization'], chosenClassStableIdList: ['class/organization'] } }),
	} },
	{ subjectStableId: 'edfi:property/domainEntity.Student.Shoe', armResultByArmName: {
		A0: armResultOf({ cappedCardStableIdList: ['card/c'], outcome: 'picked', chosenCardStableId: 'card/c' }),
		A1: armResultOf({ cappedCardStableIdList: [], outcome: 'noCandidate', walkTrace: { memberClassStableIdList: [], chosenClassStableIdList: [] } }),
	} },
];
const scored = scoringLib.scoreRun({ rowList, truthBySubject, cardByStableId, structureIndex, armNameList: ['A0', 'A1'] });
check('scoreRun: A0 recall 1 of 1', scored.armScoreByArmName.A0.recallHitCount === 1 && scored.armScoreByArmName.A0.recallPopulationCount === 1);
check('scoreRun: A1 recall 0 of 1 (a same-property card on another class is not the truth)', scored.armScoreByArmName.A1.recallHitCount === 0);
check('scoreRun: A0 proxy-correct 1 (the NONE truth is wrong when A0 picked)', scored.armScoreByArmName.A0.proxyCorrectCount === 1);
check('scoreRun: A1 proxy-correct 1 (noCandidate counts as NONE)', scored.armScoreByArmName.A1.proxyCorrectCount === 1);
check('scoreRun: §5.6 names the A1 miss wrongClass', scored.armScoreByArmName.A1.missDiagnosisCount.wrongClass === 1);

const failedList = resultList.filter((oneResult) => !oneResult.holds);
resultList.forEach((oneResult) => process.stdout.write(`${oneResult.holds ? 'PASS' : 'FAIL'}  ${oneResult.checkName}\n`));
process.stdout.write(`${resultList.length - failedList.length}/${resultList.length} hold\n`);
process.exit(failedList.length === 0 ? 0 : 1);
