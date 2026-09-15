#!/usr/bin/env node
'use strict';

// test-bgEts.js — BG-ETS at the PURE level: the text-node lookup in candidateRetrieval.js (embedTextVote-v1),
// over the hand-checkable toy in testSupport/toyEmbedTextScenario.js (SPEC-embedTextSearch-091426.md §7 as
// amended by SPEC-bridgeRevision-091426.md §13). No graph, no container, no embedder, no judge.
//
//   BG-ETS (b) every hit list holds at most hitsPerText hits, every hit at or above minScore, the per-text
//              counts equal the hand-derived ones, and the cap actually binds somewhere in the toy
//          (c) one vote per (text NODE, card): ownVotes equals the distinct voting text nodes, with a text serving
//              two properties reaching one card by two paths (R-BR-3)
//          (e) a card reached only through class or option-set slots is never admitted
//          (f) the votes-only rank is ownVotes, then best cosine, then stableId
//          (h) byte-identical twice, and again with every input list reversed
//          (r1a) a scalar propertyNameList is refused by name, on the subject side and the hub side (R-BR-1a)
//   BG-ETS (B3b, over the bolt reader through the driver double, testSupport/toyEmbedTextBoltGraph.js)
//          (d1-d4) zero text nodes from readSubjectNodes, forWalk and forEvidence, and zero text edges from an untyped
//              readEdgesAmongSource (R-BR-2); (d5) a roleless source node is kept
//          (m1) a scalar propertyNameList comes back as a one-element list, a list unchanged (R-BR-1a);
//          (m2) a number is refused by name
//   Conjuncts a, g and i are orchestrator-level (B4); j, k and l are the forge's.
//
// Run: node lib/bridge-framework/test/test-bgEts.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-ETS (pure level): the text-node lookup over the toy

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const toyLib = require('./testSupport/toyEmbedTextScenario');
const { pureConjunct, frameworkMutationTwin } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const RETRIEVAL_FILE = 'candidateRetrieval.js';
const { EXPECTED_BY_SUBJECT, EXPECTED_HIT_COUNT_BY_TEXT_STABLE_ID, TOY_SETTINGS } = toyLib;

const refusedRun = (run) => ({ pass: false, detail: `the toy pipeline REFUSED: ${String(run.error).slice(0, 260)}` });
const stableIdListOf = (candidateList) => candidateList.map((oneCandidate) => oneCandidate.stableId);
const sameJson = (leftValue, rightValue) => JSON.stringify(leftValue) === JSON.stringify(rightValue);
const subjectStableIdList = Object.keys(EXPECTED_BY_SUBJECT);

// cardsReachedBy — a TEST-SIDE walk (independent of voteCandidatePool's tally): every card any hit of the
// subject's texts reaches through any slot
const cardsReachedBy = (run, subjectStableId) => {
	const reachedSet = new Set();
	Array.from(run.searchMemo.entryByTextStableId.keys())
		.filter((oneTextStableId) => toyLib.makeToyEmbedText().sourceTextRecordList.some((oneRecord) => oneRecord.textStableId === oneTextStableId && oneRecord.sourceStableId === subjectStableId))
		.forEach((oneTextStableId) => {
			run.searchMemo.entryByTextStableId.get(oneTextStableId).hitList.forEach((oneHit) => {
				run.embedTextIndex.baseStableIdListByTextStableId.get(oneHit.hitTextStableId).forEach((oneBaseStableId) => {
					(run.cardSlotIndex.slotEdgeListByBaseStableId.get(oneBaseStableId) || []).forEach((oneSlotEdge) => reachedSet.add(oneSlotEdge.cardStableId));
				});
			});
		});
	return reachedSet;
};

const etsConjunctList = [
	pureConjunct({
		conjunctId: 'b_hitCapAndMinScore',
		title: 'every hit list holds at most hitsPerText hits, each at or above minScore; per-text counts equal the hand-derived counts; the cap binds (t2) and a hub text sits under the floor (t3)',
		twinNameList: ['ignoreHitCap', 'ignoreMinScore'],
		judge: (scenario) => {
			const run = toyLib.runToyPipeline({ scenario });
			if (run.error) {
				return refusedRun(run);
			}
			const entryList = Array.from(run.searchMemo.entryByTextStableId.entries());
			const overCapList = entryList.filter(([, oneEntry]) => oneEntry.hitList.length > TOY_SETTINGS.hitsPerText).map(([oneTextStableId]) => oneTextStableId);
			const belowFloorList = entryList.filter(([, oneEntry]) => oneEntry.hitList.some((oneHit) => oneHit.cosine < TOY_SETTINGS.minScore)).map(([oneTextStableId]) => oneTextStableId);
			const countByText = entryList.reduce((soFar, [oneTextStableId, oneEntry]) => ({ ...soFar, [oneTextStableId]: oneEntry.hitList.length }), {});
			const countsEqual = Object.keys(EXPECTED_HIT_COUNT_BY_TEXT_STABLE_ID).length === entryList.length && Object.keys(EXPECTED_HIT_COUNT_BY_TEXT_STABLE_ID).every((oneTextStableId) => countByText[oneTextStableId] === EXPECTED_HIT_COUNT_BY_TEXT_STABLE_ID[oneTextStableId]);
			return {
				pass: overCapList.length === 0 && belowFloorList.length === 0 && countsEqual,
				detail: `${entryList.length} searched text(s); over cap: ${overCapList.join(', ') || 'none'}; below floor: ${belowFloorList.join(', ') || 'none'}; counts ${countsEqual ? 'EQUAL the hand-derived counts' : `DIFFER: ${JSON.stringify(countByText)}`}`,
			};
		},
	}),
	pureConjunct({
		conjunctId: 'c_oneVotePerTextNodeAndCard',
		title: 'ownVotes equals the number of DISTINCT text nodes voting for the card; t1 (propertyNameList of two) reaches Telephone.TelephoneNumber by two paths and is still ONE vote (R-BR-3)',
		twinNameList: ['votePerPath', 'votePerPropertyName'],
		judge: (scenario) => {
			const run = toyLib.runToyPipeline({ scenario });
			if (run.error) {
				return refusedRun(run);
			}
			const badList = [];
			subjectStableIdList.forEach((oneSubjectStableId) => {
				run.resultBySubjectStableId[oneSubjectStableId].admittedList.forEach((oneCandidate) => {
					const distinctVoterCount = new Set(oneCandidate.pathList.map((onePath) => onePath.embedTextStableId)).size;
					if (oneCandidate.ownVotes !== distinctVoterCount || oneCandidate.ownVotes !== EXPECTED_BY_SUBJECT[oneSubjectStableId].ownVotesByCardStableId[oneCandidate.stableId]) {
						badList.push(`${oneCandidate.stableId} ownVotes ${oneCandidate.ownVotes} (distinct voters ${distinctVoterCount}, hand-derived ${EXPECTED_BY_SUBJECT[oneSubjectStableId].ownVotesByCardStableId[oneCandidate.stableId]})`);
					}
				});
			});
			const telephoneNumber = run.resultBySubjectStableId[toyLib.SUBJECT_TELEPHONE].admittedList.find((oneCandidate) => oneCandidate.stableId === toyLib.cardId('Telephone.TelephoneNumber'));
			const twoNamePathList = telephoneNumber === undefined ? [] : telephoneNumber.pathList.filter((onePath) => onePath.embedTextStableId === 'src/embedText/t1Telephone' && onePath.propertyNameList.length === 2);
			return {
				pass: badList.length === 0 && twoNamePathList.length === 2,
				detail: `${badList.length ? badList.join('; ') : 'every admitted card: ownVotes = distinct voting text nodes = hand-derived'}; t1 two-name paths to Telephone.TelephoneNumber: ${twoNamePathList.length} (must be 2)`,
			};
		},
	}),
	pureConjunct({
		conjunctId: 'e_classOrOptionSetOnlyCardNeverAdmitted',
		title: 'the admitted set equals the hand-derived set; every admitted card has a PROPERTY path; the cards the walk reaches only through class or option-set slots are not admitted',
		twinNameList: ['admitOnClassHit'],
		judge: (scenario) => {
			const run = toyLib.runToyPipeline({ scenario });
			if (run.error) {
				return refusedRun(run);
			}
			const problemList = [];
			subjectStableIdList.forEach((oneSubjectStableId) => {
				const expected = EXPECTED_BY_SUBJECT[oneSubjectStableId];
				const admittedList = run.resultBySubjectStableId[oneSubjectStableId].admittedList;
				if (!sameJson(stableIdListOf(admittedList), expected.admittedStableIdList)) {
					problemList.push(`${oneSubjectStableId} admitted ${JSON.stringify(stableIdListOf(admittedList))}`);
				}
				admittedList.filter((oneCandidate) => !oneCandidate.pathList.some((onePath) => onePath.slotKind === 'property')).forEach((oneCandidate) => problemList.push(`${oneCandidate.stableId} admitted with no property path`));
				const reachedSet = cardsReachedBy(run, oneSubjectStableId);
				expected.reachedNotAdmittedStableIdList.forEach((oneCardStableId) => {
					if (!reachedSet.has(oneCardStableId)) {
						problemList.push(`${oneCardStableId} is not even reached, so its exclusion proves nothing`);
					}
				});
			});
			return { pass: problemList.length === 0, detail: problemList.join('; ') || `admitted sets equal the hand-derived sets; ${EXPECTED_BY_SUBJECT[toyLib.SUBJECT_TELEPHONE].reachedNotAdmittedStableIdList.length} reached class/option-set-only card(s) excluded` };
		},
	}),
	pureConjunct({
		conjunctId: 'f_rankVotesThenCosineThenStableId',
		title: 'the votes-only rank equals the hand-derived order and every adjacent pair obeys ownVotes DESC, bestCosine DESC, stableId ASC',
		twinNameList: ['rankByCosineOnly'],
		judge: (scenario) => {
			const run = toyLib.runToyPipeline({ scenario });
			if (run.error) {
				return refusedRun(run);
			}
			const problemList = [];
			subjectStableIdList.forEach((oneSubjectStableId) => {
				const rankedList = run.resultBySubjectStableId[oneSubjectStableId].votesOnlyRankedList;
				if (!sameJson(stableIdListOf(rankedList), EXPECTED_BY_SUBJECT[oneSubjectStableId].votesOnlyRankStableIdList)) {
					problemList.push(`${oneSubjectStableId} ranked ${JSON.stringify(stableIdListOf(rankedList))}`);
				}
				rankedList.slice(1).forEach((oneCandidate, oneIndex) => {
					const prior = rankedList[oneIndex];
					const ordered = prior.ownVotes > oneCandidate.ownVotes || (prior.ownVotes === oneCandidate.ownVotes && (prior.bestCosine > oneCandidate.bestCosine || (prior.bestCosine === oneCandidate.bestCosine && prior.stableId < oneCandidate.stableId)));
					if (!ordered) {
						problemList.push(`${prior.stableId} before ${oneCandidate.stableId} breaks the order`);
					}
				});
			});
			return { pass: problemList.length === 0, detail: problemList.join('; ') || 'both subjects rank in the hand-derived votes-only order' };
		},
	}),
	pureConjunct({
		conjunctId: 'h_byteIdenticalTwiceAndUnderReversedInput',
		title: 'two runs are byte-identical, a run over every input list REVERSED is byte-identical to them, and the rank orders equal the hand-derived ones',
		twinNameList: ['reverseTieBreak', 'tieBreakByInputOrder'],
		judge: (scenario) => {
			const firstRun = toyLib.runToyPipeline({ scenario });
			const secondRun = toyLib.runToyPipeline({ scenario });
			const reversedRun = toyLib.runToyPipeline({ scenario, reverseInput: true });
			const refused = [firstRun, secondRun, reversedRun].find((oneRun) => oneRun.error);
			if (refused !== undefined) {
				return refusedRun(refused);
			}
			const firstText = toyLib.projectRun(firstRun);
			const ordersEqual = subjectStableIdList.every(
				(oneSubjectStableId) =>
					sameJson(stableIdListOf(firstRun.resultBySubjectStableId[oneSubjectStableId].votesOnlyRankedList), EXPECTED_BY_SUBJECT[oneSubjectStableId].votesOnlyRankStableIdList) &&
					sameJson(stableIdListOf(firstRun.resultBySubjectStableId[oneSubjectStableId].rankedList), EXPECTED_BY_SUBJECT[oneSubjectStableId].neighbourRankStableIdList),
			);
			return {
				pass: firstText === toyLib.projectRun(secondRun) && firstText === toyLib.projectRun(reversedRun) && ordersEqual,
				detail: `twice ${firstText === toyLib.projectRun(secondRun) ? 'IDENTICAL' : 'DIFFER'}; reversed input ${firstText === toyLib.projectRun(reversedRun) ? 'IDENTICAL' : 'DIFFER'}; rank orders ${ordersEqual ? 'equal the hand-derived orders' : 'DIFFER from the hand-derived orders'} (${firstText.length} bytes)`,
			};
		},
	}),
	pureConjunct({
		conjunctId: 'r1a_scalarPropertyNameListRefusedByName',
		title: 'a SCALAR propertyNameList is refused by name, on a subject text record and on a hub text record; the module never re-widens it (R-BR-1a: that is the reader\'s job)',
		twinNameList: ['reWidenScalarInsideTheModule'],
		judge: (scenario) => {
			const subjectSideToy = toyLib.makeToyEmbedText();
			subjectSideToy.sourceTextRecordList[0].propertyNameList = 'name';
			const hubSideToy = toyLib.makeToyEmbedText();
			hubSideToy.hubTextRecordList[0].propertyNameList = 'name';
			const subjectSideRun = toyLib.runToyPipeline({ scenario, toy: subjectSideToy });
			const hubSideRun = toyLib.runToyPipeline({ scenario, toy: hubSideToy });
			const refusalRe = /propertyNameList is "name", not an array/;
			const subjectRefused = typeof subjectSideRun.error === 'string' && refusalRe.test(subjectSideRun.error) && /REFUSED/.test(subjectSideRun.error);
			const hubRefused = typeof hubSideRun.error === 'string' && refusalRe.test(hubSideRun.error) && /REFUSED/.test(hubSideRun.error);
			return {
				pass: subjectRefused && hubRefused,
				detail: `subject side: ${subjectSideRun.error ? String(subjectSideRun.error).slice(0, 140) : 'ACCEPTED'}; hub side: ${hubSideRun.error ? String(hubSideRun.error).slice(0, 140) : 'ACCEPTED'}`,
			};
		},
	}),
];

// ---------------------------------------------------------------------
// BG-ETS at the READER level (B3b): d (text nodes excluded by role, four ways, and a roleless node kept) and m (the
// propertyNameList re-widen), over the BOLT reader compiled through moduleDouble with its one neo4j-driver require
// swapped for testSupport/boltDriverDouble.js, on testSupport/toyEmbedTextBoltGraph.js. Appended to the pure-level
// conjuncts above; none of those is changed.
// ---------------------------------------------------------------------
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const boltDriverDouble = require('./testSupport/boltDriverDouble');
const boltGraphLib = require('./testSupport/toyEmbedTextBoltGraph');
const { frameworkFile } = require('./testSupport/bridgeTwinFactories');
const vocabularyLib = require(path.join(__dirname, '..', '..', 'vocabulary', 'vocabulary'));

const READER_FILE = 'graphReader.js';
const RULES_FILE = 'graphSeamRules.js';
const DRIVER_DOUBLE_PATH = path.join(__dirname, 'testSupport', 'boltDriverDouble.js');
const EMBED_TEXT_ROLE = vocabularyLib.DME_ROLES.EMBED_TEXT;
const EMBEDS_TEXT_OF = vocabularyLib.EDGE_TYPES.EMBEDS_TEXT_OF;
const SOURCE_TEXT_STABLE_ID_LIST = [boltGraphLib.SOURCE_TEXT_ID.givenName, boltGraphLib.SOURCE_TEXT_ID.shared];
const TOY_SOURCE_EDGE_COUNT = 5; // fixtures/toyBridge/toyGraph.js SOURCE_EDGE_LIST

const readerDriverSwap = { modulePath: frameworkFile(READER_FILE), find: "\tconst neo4j = require('neo4j-driver'); // the ONE sanctioned require of the driver in the framework's read path", replace: `\tconst neo4j = require(${JSON.stringify(DRIVER_DOUBLE_PATH)}).neo4j; // BG-ETS driver double` };
const boltReaderOver = (scenario, graph) => {
	boltDriverDouble.useState(graph);
	const boltReaderLib = moduleDouble.loadWithMutations({ modulePath: frameworkFile(READER_FILE), mutationList: [readerDriverSwap].concat(scenario.frameworkMutationList) });
	return boltReaderLib.graphReaderFactory({ inGraph: { boltUrl: 'bolt://double.invalid:7687', password: 'double' }, dependencyStandardNameList: [boltGraphLib.HUB_NAME, boltGraphLib.SOURCE_STANDARD_NAME], sourceStandardName: boltGraphLib.SOURCE_STANDARD_NAME, blindingDeclaration: [] });
};
const isTextNodeRecord = (oneRecord) => SOURCE_TEXT_STABLE_ID_LIST.indexOf(oneRecord.stableId) !== -1 || oneRecord.properties.role === EMBED_TEXT_ROLE;
const touchesTextNode = (oneEdge) => oneEdge.type === EMBEDS_TEXT_OF || SOURCE_TEXT_STABLE_ID_LIST.indexOf(oneEdge.fromStableId) !== -1 || SOURCE_TEXT_STABLE_ID_LIST.indexOf(oneEdge.toStableId) !== -1;
// sourceTextCountIn — non-vacuity: the graph the reader runs over really holds the source standard's text nodes
const sourceTextCountIn = (graph) => graph.nodeList.filter((oneNode) => oneNode.properties._source === boltGraphLib.SOURCE_STANDARD_NAME && oneNode.properties.role === EMBED_TEXT_ROLE).length;
const failed = (readError) => ({ pass: false, detail: `the bolt reader REFUSED: ${String(readError).slice(0, 240)}` });

// viewConjunct — one view's node reads: every source node, the text role asked for by name, and the text ids asked for by id
const viewConjunct = ({ conjunctId, title, viewFor }) => ({
	conjunctId,
	title,
	twinNameList: ['readerIncludesEmbedText'],
	evaluate: (scenario, callback) => {
		const graph = boltGraphLib.embedTextBoltGraph();
		const view = viewFor(boltReaderOver(scenario, graph));
		view.readSourceNodes({}, (allError, allList) => {
			if (allError) {
				callback('', failed(allError));
				return;
			}
			view.readSourceNodes({ roleList: [EMBED_TEXT_ROLE] }, (roleError, roleList) => {
				if (roleError) {
					callback('', failed(roleError));
					return;
				}
				view.readNodesByStableId({ stableIdList: SOURCE_TEXT_STABLE_ID_LIST }, (idError, idList) => {
					if (idError) {
						callback('', failed(idError));
						return;
					}
					const textCount = allList.filter(isTextNodeRecord).length + roleList.length + idList.length;
					callback('', { pass: sourceTextCountIn(graph) === 2 && allList.length > 0 && textCount === 0, detail: `graph holds ${sourceTextCountIn(graph)} source text node(s); view returned ${allList.length} node(s), ${allList.filter(isTextNodeRecord).length} text; by role ${roleList.length}; by id ${idList.length}` });
				});
			});
		});
	},
});

const readerEtsConjunctList = [
	{
		conjunctId: 'd1_subjectNodesCarryNoTextNode',
		title: 'readSubjectNodes returns the source standard\'s nodes and ZERO text nodes, over a graph holding two source text nodes (R-BR-2)',
		twinNameList: ['readerIncludesEmbedText'],
		evaluate: (scenario, callback) => {
			const graph = boltGraphLib.embedTextBoltGraph();
			boltReaderOver(scenario, graph).readSubjectNodes((readError, subjectList) => {
				if (readError) {
					callback('', failed(readError));
					return;
				}
				const textList = subjectList.filter(isTextNodeRecord);
				callback('', { pass: sourceTextCountIn(graph) === 2 && subjectList.length > 0 && textList.length === 0, detail: `graph holds ${sourceTextCountIn(graph)} source text node(s); ${subjectList.length} subject(s), ${textList.length} text: ${textList.map((oneRecord) => oneRecord.stableId).join(', ') || 'none'}` });
			});
		},
	},
	viewConjunct({ conjunctId: 'd2_walkViewCarriesNoTextNode', title: 'forWalk(): readSourceNodes, readSourceNodes by the text role, and readNodesByStableId naming the text ids all return ZERO text nodes', viewFor: (reader) => reader.forWalk({ channelPropertyList: [] }) }),
	viewConjunct({ conjunctId: 'd3_evidenceViewCarriesNoTextNode', title: 'forEvidence(): readSourceNodes, readSourceNodes by the text role, and readNodesByStableId naming the text ids all return ZERO text nodes', viewFor: (reader) => reader.forEvidence() }),
	{
		conjunctId: 'd4_untypedEdgeReadCarriesNoTextEdge',
		title: 'an UNTYPED readEdgesAmongSource({}) on forEvidence() and on forWalk() returns ZERO EMBEDS_TEXT_OF edges and no edge touching a text node, and still the toy\'s five source edges',
		twinNameList: ['readerIncludesEmbedText'],
		evaluate: (scenario, callback) => {
			const graph = boltGraphLib.embedTextBoltGraph();
			const reader = boltReaderOver(scenario, graph);
			const textEdgeCountInGraph = graph.edgeList.filter((oneEdge) => oneEdge.type === EMBEDS_TEXT_OF && SOURCE_TEXT_STABLE_ID_LIST.indexOf(oneEdge.fromStableId) !== -1).length;
			reader.forEvidence().readEdgesAmongSource({}, (evidenceError, evidenceEdgeList) => {
				if (evidenceError) {
					callback('', failed(evidenceError));
					return;
				}
				reader.forWalk({ channelPropertyList: [] }).readEdgesAmongSource({}, (walkError, walkEdgeList) => {
					if (walkError) {
						callback('', failed(walkError));
						return;
					}
					const evidenceTextCount = evidenceEdgeList.filter(touchesTextNode).length;
					const walkTextCount = walkEdgeList.filter(touchesTextNode).length;
					callback('', {
						pass: textEdgeCountInGraph === 3 && evidenceTextCount === 0 && walkTextCount === 0 && evidenceEdgeList.length === TOY_SOURCE_EDGE_COUNT && walkEdgeList.length === TOY_SOURCE_EDGE_COUNT,
						detail: `graph holds ${textEdgeCountInGraph} source text edge(s); evidence ${evidenceEdgeList.length} edge(s), ${evidenceTextCount} text; walk ${walkEdgeList.length} edge(s), ${walkTextCount} text`,
					});
				});
			});
		},
	},
	{
		conjunctId: 'd5_rolelessSourceNodeKept',
		title: 'the exclusion keeps a source node that has NO role (Cypher: `null <> $x` is null and a WHERE drops it, so the clause must say IS NULL OR)',
		twinNameList: ['exclusionDropsRolelessNode'],
		evaluate: (scenario, callback) => {
			const graph = boltGraphLib.embedTextBoltGraph();
			graph.nodeList.push({ stableId: 'toy:note/Roleless', labels: ['ToyNote'], properties: { stableId: 'toy:note/Roleless', name: 'Roleless', _source: boltGraphLib.SOURCE_STANDARD_NAME } });
			boltReaderOver(scenario, graph).readSubjectNodes((readError, subjectList) => {
				if (readError) {
					callback('', failed(readError));
					return;
				}
				const kept = subjectList.some((oneRecord) => oneRecord.stableId === 'toy:note/Roleless');
				callback('', { pass: kept && subjectList.filter(isTextNodeRecord).length === 0, detail: `roleless node ${kept ? 'KEPT' : 'DROPPED'}; ${subjectList.filter(isTextNodeRecord).length} text node(s) among ${subjectList.length} subject(s)` });
			});
		},
	},
	{
		conjunctId: 'm1_scalarReWidenedListUnchanged',
		title: 'readEmbedTextVectors re-widens a SCALAR propertyNameList to a one-element list and returns a list unchanged; the records equal the hand-derived ones (R-BR-1a, BG-ETS m)',
		twinNameList: ['returnScalarPropertyNameList'],
		evaluate: (scenario, callback) => {
			const graph = boltGraphLib.embedTextBoltGraph();
			const storedList = graph.edgeList.filter((oneEdge) => oneEdge.type === EMBEDS_TEXT_OF && SOURCE_TEXT_STABLE_ID_LIST.indexOf(oneEdge.fromStableId) !== -1).map((oneEdge) => oneEdge.properties.propertyNameList);
			const storedScalarCount = storedList.filter((oneValue) => typeof oneValue === 'string').length;
			const storedListCount = storedList.filter(Array.isArray).length;
			boltReaderOver(scenario, graph).forRetrieval().readEmbedTextVectors({ standardName: boltGraphLib.SOURCE_STANDARD_NAME }, (readError, recordList) => {
				if (readError) {
					callback('', failed(readError));
					return;
				}
				const equal = sameJson(recordList, boltGraphLib.EXPECTED_SOURCE_TEXT_RECORD_LIST);
				callback('', { pass: storedScalarCount === 2 && storedListCount === 1 && equal, detail: `stored ${storedScalarCount} scalar / ${storedListCount} list; returned propertyNameList ${JSON.stringify(recordList.map((oneRecord) => oneRecord.propertyNameList))}; ${equal ? 'EQUAL the hand-derived records' : 'DIFFER from the hand-derived records'}` });
			});
		},
	},
	{
		conjunctId: 'm2_nonNamePropertyNameListRefusedByName',
		title: 'a propertyNameList that is neither a name nor a list of names (the number 7) is refused BY NAME, never wrapped',
		twinNameList: ['acceptAnyPropertyNameList'],
		evaluate: (scenario, callback) => {
			const graph = boltGraphLib.embedTextBoltGraph();
			graph.edgeList.find((oneEdge) => oneEdge.type === EMBEDS_TEXT_OF && oneEdge.toStableId === 'toy:property/Course.Title').properties.propertyNameList = 7;
			boltReaderOver(scenario, graph).forRetrieval().readEmbedTextVectors({ standardName: boltGraphLib.SOURCE_STANDARD_NAME }, (readError, recordList) => {
				const refusedByName = /REFUSED/.test(String(readError)) && /carries propertyNameList 7, which is neither a property name nor a non-empty list of names/.test(String(readError));
				callback('', { pass: refusedByName, detail: readError ? String(readError).slice(0, 200) : `ACCEPTED: ${JSON.stringify((recordList || []).map((oneRecord) => oneRecord.propertyNameList))}` });
			});
		},
	},
];

const gateDeclarationList = [{ gateId: 'BG-ETS', title: 'the text-node lookup at the pure level (cap and floor, the vote unit, admission, rank, determinism, the scalar refusal) and at the bolt reader (exclusion by role, the re-widen)', conjunctList: etsConjunctList.concat(readerEtsConjunctList) }];

// ---------------------------------------------------------------------
// TWINS — each a production mutation of candidateRetrieval.js, compiled in memory (moduleDouble)
// ---------------------------------------------------------------------
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'b_hitCapAndMinScore', twinName: 'ignoreHitCap', fileName: RETRIEVAL_FILE, find: '\tfor (let hitIndex = 0; hitIndex < scoredHitList.length && hitList.length < hitsPerText; hitIndex++) {', replace: '\tfor (let hitIndex = 0; hitIndex < scoredHitList.length; hitIndex++) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'b_hitCapAndMinScore', twinName: 'ignoreMinScore', fileName: RETRIEVAL_FILE, find: '\t\tif (scoredHitList[hitIndex].cosine < minScore) {\n\t\t\tbreak;\n\t\t}', replace: '\t\tif (false) {\n\t\t\tbreak;\n\t\t}' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'c_oneVotePerTextNodeAndCard', twinName: 'votePerPath', fileName: RETRIEVAL_FILE, find: '\t\t\t\townVotes: oneTally.voterTextStableIdSet.size,', replace: '\t\t\t\townVotes: oneTally.pathList.length,' });
frameworkMutationTwin({
	registry: twinRegistry,
	gateId: 'BG-ETS',
	conjunctId: 'c_oneVotePerTextNodeAndCard',
	twinName: 'votePerPropertyName',
	fileName: RETRIEVAL_FILE,
	find: '\t\t\t\townVotes: oneTally.voterTextStableIdSet.size,',
	replace: '\t\t\t\townVotes: Array.from(oneTally.voterTextStableIdSet).reduce((soFar, oneTextStableId) => soFar + oneTally.pathList.find((onePath) => onePath.embedTextStableId === oneTextStableId).propertyNameList.length, 0),',
});
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'e_classOrOptionSetOnlyCardNeverAdmitted', twinName: 'admitOnClassHit', fileName: RETRIEVAL_FILE, find: "const ADMITTING_SLOT_KIND_LIST = Object.freeze(['property']);", replace: "const ADMITTING_SLOT_KIND_LIST = Object.freeze(['property', 'domain', 'range']);" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'f_rankVotesThenCosineThenStableId', twinName: 'rankByCosineOnly', fileName: RETRIEVAL_FILE, find: '(rightCandidate.ownVotes - leftCandidate.ownVotes) || ', replace: '' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'h_byteIdenticalTwiceAndUnderReversedInput', twinName: 'reverseTieBreak', fileName: RETRIEVAL_FILE, find: 'compareStrings(leftCandidate.stableId, rightCandidate.stableId))', replace: 'compareStrings(rightCandidate.stableId, leftCandidate.stableId))' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'h_byteIdenticalTwiceAndUnderReversedInput', twinName: 'tieBreakByInputOrder', fileName: RETRIEVAL_FILE, find: '(rightHit.cosine - leftHit.cosine) || compareStrings(leftHit.hitTextStableId, rightHit.hitTextStableId)', replace: '(rightHit.cosine - leftHit.cosine)' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'r1a_scalarPropertyNameListRefusedByName', twinName: 'reWidenScalarInsideTheModule', fileName: RETRIEVAL_FILE, find: 'Array.isArray(textRecord.propertyNameList) ? textRecord.propertyNameList : null;', replace: 'Array.isArray(textRecord.propertyNameList) ? textRecord.propertyNameList : [textRecord.propertyNameList];' });

const readerExclusionFind = "const embedTextExclusionConditionFor = (variableName) => `(${variableName}.role IS NULL OR ${variableName}.role <> $embedTextRole)`;";
['d1_subjectNodesCarryNoTextNode', 'd2_walkViewCarriesNoTextNode', 'd3_evidenceViewCarriesNoTextNode', 'd4_untypedEdgeReadCarriesNoTextEdge'].forEach((oneConjunctId) =>
	frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: oneConjunctId, twinName: 'readerIncludesEmbedText', fileName: READER_FILE, find: readerExclusionFind, replace: "const embedTextExclusionConditionFor = (variableName) => 'true';" }),
);
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'd5_rolelessSourceNodeKept', twinName: 'exclusionDropsRolelessNode', fileName: READER_FILE, find: readerExclusionFind, replace: 'const embedTextExclusionConditionFor = (variableName) => `${variableName}.role <> $embedTextRole`;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'm1_scalarReWidenedListUnchanged', twinName: 'returnScalarPropertyNameList', fileName: RULES_FILE, find: '\t\treturn { propertyNameList: [propertyNameList] };', replace: '\t\treturn { propertyNameList };' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-ETS', conjunctId: 'm2_nonNamePropertyNameListRefusedByName', twinName: 'acceptAnyPropertyNameList', fileName: RULES_FILE, find: '\treturn { error: refuse.byName({ moduleName, what: `text edge ${edgeLocator} carries propertyNameList', replace: '\treturn { propertyNameList: [].concat(propertyNameList) };\n\treturn { error: refuse.byName({ moduleName, what: `text edge ${edgeLocator} carries propertyNameList' });

runGateFamily(
	{
		harness,
		familyName: 'BG-ETS (pure level + reader level)',
		gateDeclarationList,
		twinRegistry,
		makeSubject: toyLib.makeScenario,
		cloneSubject: toyLib.cloneScenario,
		// LITERAL, never derived from a .length (RULING SABLE_RIVER 2026-08-17): pure conjuncts b c e f h r1a, twins
		// 2+2+1+1+2+1; reader conjuncts d1 d2 d3 d4 d5 m1 m2, twins 1+1+1+1+1+1+1 (B3b)
		expectedConjunctCount: 13,
		expectedTwinCount: 16,
	},
	() => harness.report(),
);
