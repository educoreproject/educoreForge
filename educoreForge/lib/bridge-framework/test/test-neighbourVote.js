#!/usr/bin/env node
'use strict';

// test-neighbourVote.js — BG-NV at the PURE level: neighbourVote-v1 scoring in neighbourVote.js over the toy in
// testSupport/toyEmbedTextScenario.js (SPEC-bridgeRevision-091426.md §4, §8, §9; §13 governs). No graph, no
// container, no embedder, no judge.
//
//   BG-NV (a) no card outside the admitted set is ever ranked
//         (b) domainVote and rangeVote are each 0 or 1, and both 1s occur
//         (c) owner and sibling shares land only on a card's DOMAIN class, reference shares only on its RANGE
//             class, and a neighbour whose only hit is an option set names no class (R-BR-4)
//         (d) the subject is never in its own sibling list
//         (f) the memoised search equals the direct search, and a subject run after another on a shared memo
//             equals the same subject run alone on a fresh one
//         (g) neighbourVote: null gives exactly the votes-only rank
//         (h) the rank is score, own share, best cosine, stableId
//         (i) topShare gives the vote only to the highest-share classes
//         (runRefusals) the three run-time refusals of §5 fire by name: no owner property, an owner naming no
//             source node, a scored card with no DOMAIN slot edge
//         (contain) neighbourVote.js and candidateRetrieval.js require only an allow-list: no I/O, driver,
//             embedder, reader, writer or judge (the BG-CONTAIN rule, asserted on the new files)
//   Conjuncts e, j, k, l are orchestrator- or declaration-level and belong to B3a/B4.
//
// Run: node lib/bridge-framework/test/test-neighbourVote.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-NV (pure level): neighbour-vote scoring over the toy

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const toyLib = require('./testSupport/toyEmbedTextScenario');
const { pureConjunct, frameworkMutationTwin, scenarioTwin } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const NEIGHBOUR_FILE = 'neighbourVote.js';
const { EXPECTED_BY_SUBJECT, SUBJECT_TELEPHONE, SUBJECT_NAME } = toyLib;
const subjectStableIdList = Object.keys(EXPECTED_BY_SUBJECT);

const refusedRun = (run) => ({ pass: false, detail: `the toy pipeline REFUSED: ${String(run.error).slice(0, 260)}` });
const stableIdListOf = (candidateList) => candidateList.map((oneCandidate) => oneCandidate.stableId);
const sameJson = (leftValue, rightValue) => JSON.stringify(leftValue) === JSON.stringify(rightValue);
const entryListOf = (shareMap) => Array.from(shareMap.keys()).sort().map((oneClassStableId) => [oneClassStableId, shareMap.get(oneClassStableId)]);

const nvConjunctList = [
	pureConjunct({
		conjunctId: 'a_noCardOutsideTheAdmittedSet',
		title: 'every ranked card is in the lookup\'s admitted set — neighbours reorder and never admit (invariant 1)',
		twinNameList: ['admitByNeighbour'],
		judge: (scenario) => {
			const run = toyLib.runToyPipeline({ scenario });
			if (run.error) {
				return refusedRun(run);
			}
			const outsideList = subjectStableIdList.reduce((soFar, oneSubjectStableId) => {
				const admittedSet = new Set(stableIdListOf(run.resultBySubjectStableId[oneSubjectStableId].admittedList));
				return soFar.concat(stableIdListOf(run.resultBySubjectStableId[oneSubjectStableId].rankedList).filter((oneCardStableId) => !admittedSet.has(oneCardStableId)));
			}, []);
			return { pass: outsideList.length === 0, detail: outsideList.length ? `ranked but never admitted: ${outsideList.join(', ')}` : 'every ranked card was admitted by the lookup' };
		},
	}),
	pureConjunct({
		conjunctId: 'b_domainVoteAndRangeVoteAreZeroOrOne',
		title: 'domainVote and rangeVote are each 0 or 1 on every ranked card, and a 1 of each kind occurs in the toy (invariant 2)',
		twinNameList: ['votePerNeighbour'],
		judge: (scenario) => {
			const run = toyLib.runToyPipeline({ scenario });
			if (run.error) {
				return refusedRun(run);
			}
			const rankedList = subjectStableIdList.reduce((soFar, oneSubjectStableId) => soFar.concat(run.resultBySubjectStableId[oneSubjectStableId].rankedList), []);
			const outOfRangeList = rankedList.filter((oneCandidate) => [0, 1].indexOf(oneCandidate.domainVote) === -1 || [0, 1].indexOf(oneCandidate.rangeVote) === -1);
			const domainOneCount = rankedList.filter((oneCandidate) => oneCandidate.domainVote === 1).length;
			const rangeOneCount = rankedList.filter((oneCandidate) => oneCandidate.rangeVote === 1).length;
			return {
				pass: outOfRangeList.length === 0 && domainOneCount > 0 && rangeOneCount > 0,
				detail: `${outOfRangeList.length ? `out of {0,1}: ${outOfRangeList.map((oneCandidate) => `${oneCandidate.stableId} domain ${oneCandidate.domainVote} range ${oneCandidate.rangeVote}`).join('; ')}` : 'every vote in {0,1}'}; domain 1s ${domainOneCount}, range 1s ${rangeOneCount}`,
			};
		},
	}),
	pureConjunct({
		conjunctId: 'c_landingSlotsAndTheOptionSetNeighbour',
		title: 'shares and votes land per card exactly as hand-derived: owner/sibling shares on the DOMAIN class, reference shares on the RANGE class; PhoneKindCode (an option-set hit only) names NO class and Status\'s option-set base adds none (R-BR-4)',
		twinNameList: ['swapLandingSlots', 'optionSetNamesClass'],
		judge: (scenario) => {
			const run = toyLib.runToyPipeline({ scenario });
			if (run.error) {
				return refusedRun(run);
			}
			const problemList = [];
			subjectStableIdList.forEach((oneSubjectStableId) => {
				const expected = EXPECTED_BY_SUBJECT[oneSubjectStableId];
				const oneResult = run.resultBySubjectStableId[oneSubjectStableId];
				if (!sameJson(entryListOf(oneResult.neighbourShares.domainShareByClassStableId), expected.domainShareEntryList)) {
					problemList.push(`${oneSubjectStableId} domain shares ${JSON.stringify(entryListOf(oneResult.neighbourShares.domainShareByClassStableId))}`);
				}
				if (!sameJson(entryListOf(oneResult.neighbourShares.rangeShareByClassStableId), expected.rangeShareEntryList)) {
					problemList.push(`${oneSubjectStableId} range shares ${JSON.stringify(entryListOf(oneResult.neighbourShares.rangeShareByClassStableId))}`);
				}
				Object.keys(expected.namedClassStableIdListByNeighbourStableId).forEach((oneNeighbourStableId) => {
					const namedList = oneResult.neighbourShares.namedClassStableIdListByNeighbourStableId.get(oneNeighbourStableId);
					if (!sameJson(namedList, expected.namedClassStableIdListByNeighbourStableId[oneNeighbourStableId])) {
						problemList.push(`${oneNeighbourStableId} names ${JSON.stringify(namedList)} for ${oneSubjectStableId}`);
					}
				});
				oneResult.rankedList.forEach((oneCandidate) => {
					const expectedLanding = expected.landingByCardStableId[oneCandidate.stableId];
					const actualLanding = { domainVote: oneCandidate.domainVote, rangeVote: oneCandidate.rangeVote, domainShare: oneCandidate.domainShare, rangeShare: oneCandidate.rangeShare, score: oneCandidate.score };
					if (!sameJson(actualLanding, expectedLanding)) {
						problemList.push(`${oneCandidate.stableId} landed ${JSON.stringify(actualLanding)} vs hand-derived ${JSON.stringify(expectedLanding)}`);
					}
				});
			});
			return { pass: problemList.length === 0, detail: problemList.join('; ').slice(0, 400) || 'shares, named classes and per-card landings equal the hand-derived values for both subjects' };
		},
	}),
	pureConjunct({
		conjunctId: 'd_subjectIsNotItsOwnSibling',
		title: 'the subject is not in its own sibling list, and owner, siblings and referenced objects equal the hand-derived sets (invariant 4)',
		twinNameList: ['includeSubjectAsSibling'],
		judge: (scenario) => {
			const run = toyLib.runToyPipeline({ scenario });
			if (run.error) {
				return refusedRun(run);
			}
			const problemList = [];
			subjectStableIdList.forEach((oneSubjectStableId) => {
				const neighbourSet = run.resultBySubjectStableId[oneSubjectStableId].neighbourSet;
				const expected = EXPECTED_BY_SUBJECT[oneSubjectStableId];
				if (neighbourSet.siblingStableIdList.indexOf(oneSubjectStableId) !== -1) {
					problemList.push(`${oneSubjectStableId} is its own sibling`);
				}
				if (neighbourSet.ownerStableId !== expected.ownerStableId || !sameJson(neighbourSet.siblingStableIdList, expected.siblingStableIdList) || !sameJson(neighbourSet.referencedObjectStableIdList, expected.referencedObjectStableIdList)) {
					problemList.push(`${oneSubjectStableId} neighbours ${JSON.stringify(neighbourSet)}`);
				}
			});
			return { pass: problemList.length === 0, detail: problemList.join('; ') || 'no subject is its own sibling; neighbour sets equal the hand-derived sets' };
		},
	}),
	pureConjunct({
		conjunctId: 'f_memoisedSearchEqualsDirectSearch',
		title: 'every memoised hit list, read at rest AND read back through searchEmbedText, equals a direct search; Applicant.Name run after Applicant.Telephone on a shared memo equals Applicant.Name run alone on a fresh memo (invariant 6)',
		twinNameList: ['corruptSearchMemo'],
		judge: (scenario) => {
			const run = toyLib.runToyPipeline({ scenario });
			if (run.error) {
				return refusedRun(run);
			}
			const aloneRun = toyLib.runToyPipeline({ scenario, subjectStableIdListOverride: [SUBJECT_NAME] });
			if (aloneRun.error) {
				return refusedRun(aloneRun);
			}
			const { candidateRetrievalLib } = run.modules;
			const toy = toyLib.makeToyEmbedText();
			const problemList = [];
			Array.from(run.searchMemo.entryByTextStableId.keys()).forEach((oneTextStableId) => {
				const textRecord = toy.sourceTextRecordList.find((oneRecord) => oneRecord.textStableId === oneTextStableId);
				const direct = candidateRetrievalLib.searchEmbedTextDirect({ embedTextIndex: run.embedTextIndex, textRecord, hitsPerText: run.searchMemo.hitsPerText, minScore: run.searchMemo.minScore });
				const readBack = candidateRetrievalLib.searchEmbedText({ searchMemo: run.searchMemo, textRecord });
				if (direct.error || readBack.error || !sameJson(run.searchMemo.entryByTextStableId.get(oneTextStableId).hitList, direct.hitList) || !sameJson(readBack.hitList, direct.hitList)) {
					problemList.push(`${oneTextStableId} memo and direct search differ`);
				}
			});
			const sharedMemoName = JSON.stringify(run.resultBySubjectStableId[SUBJECT_NAME].rankedList);
			const aloneName = JSON.stringify(aloneRun.resultBySubjectStableId[SUBJECT_NAME].rankedList);
			if (sharedMemoName !== aloneName) {
				problemList.push('Applicant.Name ranks differently on the shared memo than alone');
			}
			return { pass: problemList.length === 0, detail: problemList.join('; ') || `${run.searchMemo.entryByTextStableId.size} memo entries equal direct search at rest and read back; shared-memo run equals the fresh-memo run` };
		},
	}),
	pureConjunct({
		conjunctId: 'g_nullNeighbourVoteEqualsVotesOnly',
		title: 'with neighbourVote: null the ranked pool equals the votes-only rank exactly and carries no trace, while the declared neighbourVote ranks differently (so the equality is not vacuous) (invariant 7)',
		twinNameList: ['applyNeighboursWhenNull'],
		judge: (scenario) => {
			const nullRun = toyLib.runToyPipeline({ scenario, neighbourVoteOverride: null });
			if (nullRun.error) {
				return refusedRun(nullRun);
			}
			const problemList = [];
			subjectStableIdList.forEach((oneSubjectStableId) => {
				const oneResult = nullRun.resultBySubjectStableId[oneSubjectStableId];
				if (JSON.stringify(oneResult.rankedList) !== JSON.stringify(oneResult.votesOnlyRankedList) || oneResult.neighbourTrace !== null) {
					problemList.push(`${oneSubjectStableId} null-declaration pool ${JSON.stringify(stableIdListOf(oneResult.rankedList))} vs votes-only ${JSON.stringify(stableIdListOf(oneResult.votesOnlyRankedList))}, trace ${oneResult.neighbourTrace === null ? 'null' : 'PRESENT'}`);
				}
			});
			const differs = subjectStableIdList.some((oneSubjectStableId) => !sameJson(EXPECTED_BY_SUBJECT[oneSubjectStableId].votesOnlyRankStableIdList, EXPECTED_BY_SUBJECT[oneSubjectStableId].neighbourRankStableIdList));
			return { pass: problemList.length === 0 && differs, detail: problemList.join('; ') || `null declaration reproduces the votes-only rank for both subjects; the neighbour rank differs from it in the toy: ${differs}` };
		},
	}),
	pureConjunct({
		conjunctId: 'h_rankScoreThenShareThenCosineThenStableId',
		title: 'the neighbour rank equals the hand-derived order (Person.Status before Telephone.TelephoneNumber on share, both score 3) and every adjacent pair obeys score DESC, domainShare+rangeShare DESC, bestCosine DESC, stableId ASC',
		twinNameList: ['rankIgnoresShare'],
		judge: (scenario) => {
			const run = toyLib.runToyPipeline({ scenario });
			if (run.error) {
				return refusedRun(run);
			}
			const problemList = [];
			subjectStableIdList.forEach((oneSubjectStableId) => {
				const rankedList = run.resultBySubjectStableId[oneSubjectStableId].rankedList;
				if (!sameJson(stableIdListOf(rankedList), EXPECTED_BY_SUBJECT[oneSubjectStableId].neighbourRankStableIdList)) {
					problemList.push(`${oneSubjectStableId} ranked ${JSON.stringify(stableIdListOf(rankedList))}`);
				}
				rankedList.slice(1).forEach((oneCandidate, oneIndex) => {
					const prior = rankedList[oneIndex];
					const priorShare = prior.domainShare + prior.rangeShare;
					const oneShare = oneCandidate.domainShare + oneCandidate.rangeShare;
					const ordered = prior.score > oneCandidate.score || (prior.score === oneCandidate.score && (priorShare > oneShare || (priorShare === oneShare && (prior.bestCosine > oneCandidate.bestCosine || (prior.bestCosine === oneCandidate.bestCosine && prior.stableId < oneCandidate.stableId)))));
					if (!ordered) {
						problemList.push(`${prior.stableId} before ${oneCandidate.stableId} breaks the order`);
					}
				});
			});
			return { pass: problemList.length === 0, detail: problemList.join('; ') || 'both subjects rank in the hand-derived neighbour order' };
		},
	}),
	pureConjunct({
		conjunctId: 'i_topShareEarnsOnlyTheHighestShareClasses',
		title: 'under topShare a card earns the domain (range) vote exactly when its domain (range) class holds the highest share of that kind and that share is above 0; Organization.Email (Organization 2/4 < Person 3/4) earns none',
		twinNameList: ['earnOnAnyHit'],
		judge: (scenario) => {
			const run = toyLib.runToyPipeline({ scenario });
			if (run.error) {
				return refusedRun(run);
			}
			const problemList = [];
			subjectStableIdList.forEach((oneSubjectStableId) => {
				const oneResult = run.resultBySubjectStableId[oneSubjectStableId];
				const topDomainShare = Math.max(0, ...Array.from(oneResult.neighbourShares.domainShareByClassStableId.values()));
				const topRangeShare = Math.max(0, ...Array.from(oneResult.neighbourShares.rangeShareByClassStableId.values()));
				oneResult.rankedList.forEach((oneCandidate) => {
					const expectedDomainVote = topDomainShare > 0 && oneCandidate.domainShare === topDomainShare ? 1 : 0;
					const expectedRangeVote = topRangeShare > 0 && oneCandidate.rangeShare === topRangeShare ? 1 : 0;
					if (oneCandidate.domainVote !== expectedDomainVote || oneCandidate.rangeVote !== expectedRangeVote) {
						problemList.push(`${oneCandidate.stableId} domain ${oneCandidate.domainVote}/${expectedDomainVote} range ${oneCandidate.rangeVote}/${expectedRangeVote}`);
					}
				});
			});
			const organizationEmail = run.resultBySubjectStableId[SUBJECT_TELEPHONE].rankedList.find((oneCandidate) => oneCandidate.stableId === toyLib.cardId('Organization.Email'));
			const nonVacuous = organizationEmail !== undefined && organizationEmail.domainShare > 0 && organizationEmail.domainVote === 0;
			return { pass: problemList.length === 0 && nonVacuous, detail: `${problemList.join('; ') || 'every vote goes only to the top-share class'}; Organization.Email share>0 without the vote: ${nonVacuous}` };
		},
	}),
	pureConjunct({
		conjunctId: 'runRefusals_threeRunRefusalsFireByName',
		title: 'refused at run, by name (SPEC-bridgeRevision §5): a subject lacking its owner property; an owner value naming no source node; a scored card with no DOMAIN slot edge',
		twinNameList: ['ownerAbsenceUnchecked', 'ownerExistenceUnchecked', 'domainSlotUnchecked'],
		judge: (scenario) => {
			const noOwnerToy = toyLib.makeToyEmbedText();
			delete noOwnerToy.siblingPopulationByStableId[SUBJECT_TELEPHONE].properties.parentId;
			const strayOwnerToy = toyLib.makeToyEmbedText();
			strayOwnerToy.siblingPopulationByStableId[SUBJECT_TELEPHONE].properties.parentId = 'src/class/Nowhere';
			const noDomainToy = toyLib.makeToyEmbedText();
			noDomainToy.cardSlotEdgeList = noDomainToy.cardSlotEdgeList.filter((oneEdge) => !(oneEdge.cardStableId === toyLib.cardId('Person.HasTelephone') && oneEdge.slot === 'HAS_TOYHUB_DOMAIN'));
			const caseList = [
				{ caseName: 'no owner property', run: toyLib.runToyPipeline({ scenario, toy: noOwnerToy }), regex: /REFUSED: subject src\/property\/Applicant\.Telephone lacks its owner property 'parentId'/ },
				{ caseName: 'owner names no source node', run: toyLib.runToyPipeline({ scenario, toy: strayOwnerToy }), regex: /REFUSED: subject src\/property\/Applicant\.Telephone owner property 'parentId' "src\/class\/Nowhere" names no source node/ },
				{ caseName: 'no DOMAIN slot edge', run: toyLib.runToyPipeline({ scenario, toy: noDomainToy }), regex: /REFUSED: candidate card toyhub\/card\/Person\.HasTelephone carries 0 DOMAIN slot edges/ },
			];
			const missedList = caseList.filter((oneCase) => typeof oneCase.run.error !== 'string' || !oneCase.regex.test(oneCase.run.error));
			return {
				pass: missedList.length === 0,
				detail: missedList.length ? missedList.map((oneCase) => `${oneCase.caseName}: ${oneCase.run.error ? String(oneCase.run.error).slice(0, 160) : 'ACCEPTED'}`).join(' | ') : `${caseList.length} run refusals fired by name`,
			};
		},
	}),
	pureConjunct({
		conjunctId: 'contain_pureModulesRequireOnlyTheAllowList',
		title: 'neighbourVote.js and candidateRetrieval.js require ONLY path, the refusal helper and each other: no fs, driver, embedder, vector store, reader, writer, judge or decision store (BG-CONTAIN, on the new files)',
		twinNameList: ['requireSubstrateInPureModule'],
		judge: (scenario) => {
			const allowedRequireList = ["'path'", "path.join(__dirname, '..', 'forge-framework', 'refuse')", "'./candidateRetrieval'"];
			const offenderList = [];
			[NEIGHBOUR_FILE, 'candidateRetrieval.js'].forEach((oneFileName) => {
				const sourceText = scenario.containmentSourceByFileName[oneFileName] === undefined ? fs.readFileSync(path.join(toyLib.FRAMEWORK_DIR, oneFileName), 'utf8') : scenario.containmentSourceByFileName[oneFileName];
				const requireArgumentList = [];
				const requireRe = /\brequire\(([^)]*\)?)\)/g;
				let oneMatch = requireRe.exec(sourceText);
				while (oneMatch !== null) {
					requireArgumentList.push(oneMatch[1]);
					oneMatch = requireRe.exec(sourceText);
				}
				requireArgumentList.filter((oneArgument) => allowedRequireList.indexOf(oneArgument) === -1).forEach((oneArgument) => offenderList.push(`${oneFileName}: require(${oneArgument})`));
				if (requireArgumentList.length === 0) {
					offenderList.push(`${oneFileName}: no require found at all, so the scan saw nothing`);
				}
			});
			return { pass: offenderList.length === 0, detail: offenderList.join('; ') || 'both modules require only the allow-list' };
		},
	}),
];

const gateDeclarationList = [{ gateId: 'BG-NV', title: 'neighbour-vote scoring at the pure level: admission, vote bounds, landing slots, siblings, memo, null declaration, rank, earn rule, run refusals, containment', conjunctList: nvConjunctList }];

// ---------------------------------------------------------------------
// TWINS — production mutations of neighbourVote.js (compiled in memory), and one containment twin over its source
// ---------------------------------------------------------------------
frameworkMutationTwin({
	registry: twinRegistry,
	gateId: 'BG-NV',
	conjunctId: 'a_noCardOutsideTheAdmittedSet',
	twinName: 'admitByNeighbour',
	fileName: NEIGHBOUR_FILE,
	find: '\tconst scoringCandidateList = admittedList.slice();',
	replace:
		'\tconst scoringCandidateList = admittedList.concat(Array.from(cardSlotIndex.baseStableIdListBySlotKindByCardStableId.keys()).filter((oneCardStableId) => earnedDomainClassSet.has(cardSlotIndex.baseStableIdListBySlotKindByCardStableId.get(oneCardStableId).domain[0]) && !admittedList.some((oneCandidate) => oneCandidate.stableId === oneCardStableId)).map((oneCardStableId) => ({ stableId: oneCardStableId, ownVotes: 0, bestCosine: 0, pathList: [] })));',
});
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-NV', conjunctId: 'b_domainVoteAndRangeVoteAreZeroOrOne', twinName: 'votePerNeighbour', fileName: NEIGHBOUR_FILE, find: '\t\tconst domainVote = earnedDomainClassSet.has(domainLandingStableId) ? 1 : 0;', replace: '\t\tconst domainVote = earnedDomainClassSet.has(domainLandingStableId) ? neighbourShares.domainNamingCountByClassStableId.get(domainLandingStableId) : 0;' });
frameworkMutationTwin({
	registry: twinRegistry,
	gateId: 'BG-NV',
	conjunctId: 'c_landingSlotsAndTheOptionSetNeighbour',
	twinName: 'swapLandingSlots',
	fileName: NEIGHBOUR_FILE,
	find: '\t\tconst domainLandingStableId = domainList[0];\n\t\tconst rangeLandingStableId = rangeList.length === 1 ? rangeList[0] : null;',
	replace: '\t\tconst domainLandingStableId = rangeList.length === 1 ? rangeList[0] : null;\n\t\tconst rangeLandingStableId = domainList[0];',
});
frameworkMutationTwin({
	registry: twinRegistry,
	gateId: 'BG-NV',
	conjunctId: 'c_landingSlotsAndTheOptionSetNeighbour',
	twinName: 'optionSetNamesClass',
	fileName: NEIGHBOUR_FILE,
	find: '\toptionSet: () => [],',
	replace: '\toptionSet: ({ baseStableId, cardSlotIndex }) => cardSlotIndex.slotEdgeListByBaseStableId.get(baseStableId).reduce((soFar, oneSlotEdge) => soFar.concat(cardSlotIndex.baseStableIdListBySlotKindByCardStableId.get(oneSlotEdge.cardStableId).domain), []),',
});
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-NV', conjunctId: 'd_subjectIsNotItsOwnSibling', twinName: 'includeSubjectAsSibling', fileName: NEIGHBOUR_FILE, find: 'oneStableId !== subjectStableId && ', replace: '' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-NV', conjunctId: 'f_memoisedSearchEqualsDirectSearch', twinName: 'corruptSearchMemo', fileName: 'candidateRetrieval.js', find: '\t\treturn { hitList: memoEntry.hitList };', replace: '\t\treturn { hitList: memoEntry.hitList.slice(1) };' });
frameworkMutationTwin({
	registry: twinRegistry,
	gateId: 'BG-NV',
	conjunctId: 'g_nullNeighbourVoteEqualsVotesOnly',
	twinName: 'applyNeighboursWhenNull',
	fileName: NEIGHBOUR_FILE,
	find: '\tif (neighbourVote === null) {',
	replace: `\tif (neighbourVote === null) {\n\t\tneighbourVote = ${JSON.stringify(toyLib.TOY_NEIGHBOUR_VOTE)};\n\t}\n\tif (false) {`,
});
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-NV', conjunctId: 'h_rankScoreThenShareThenCosineThenStableId', twinName: 'rankIgnoresShare', fileName: NEIGHBOUR_FILE, find: '((rightScored.domainShare + rightScored.rangeShare) - (leftScored.domainShare + leftScored.rangeShare)) || ', replace: '' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-NV', conjunctId: 'i_topShareEarnsOnlyTheHighestShareClasses', twinName: 'earnOnAnyHit', fileName: NEIGHBOUR_FILE, find: '\tconst earnRule = EARN_RULE_REGISTRY[neighbourVote.earnRule];', replace: '\tconst earnRule = EARN_RULE_REGISTRY.anyHit;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-NV', conjunctId: 'runRefusals_threeRunRefusalsFireByName', twinName: 'ownerAbsenceUnchecked', fileName: NEIGHBOUR_FILE, find: '\tif (ownerStableId === undefined) {', replace: '\tif (false) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-NV', conjunctId: 'runRefusals_threeRunRefusalsFireByName', twinName: 'ownerExistenceUnchecked', fileName: NEIGHBOUR_FILE, find: '\tif (!sourceStableIdSet.has(ownerStableId)) {', replace: '\tif (false) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-NV', conjunctId: 'runRefusals_threeRunRefusalsFireByName', twinName: 'domainSlotUnchecked', fileName: NEIGHBOUR_FILE, find: '\t\tif (domainList.length !== 1) {', replace: '\t\tif (false) {' });
scenarioTwin({
	registry: twinRegistry,
	gateId: 'BG-NV',
	conjunctId: 'contain_pureModulesRequireOnlyTheAllowList',
	twinName: 'requireSubstrateInPureModule',
	leverKind: 'productionMutation',
	mutate: (scenario) => {
		scenario.containmentSourceByFileName[NEIGHBOUR_FILE] = `${fs.readFileSync(path.join(toyLib.FRAMEWORK_DIR, NEIGHBOUR_FILE), 'utf8')}\nconst neo4jDriver = require('neo4j-driver');\nvoid neo4jDriver;\n`;
	},
});

runGateFamily(
	{
		harness,
		familyName: 'BG-NV (pure level)',
		gateDeclarationList,
		twinRegistry,
		makeSubject: toyLib.makeScenario,
		cloneSubject: toyLib.cloneScenario,
		// LITERAL, never derived from a .length (RULING SABLE_RIVER 2026-08-17): conjuncts a b c d f g h i runRefusals contain;
		// twins 1+1+2+1+1+1+1+1+3+1
		expectedConjunctCount: 10,
		expectedTwinCount: 13,
	},
	() => harness.report(),
);
