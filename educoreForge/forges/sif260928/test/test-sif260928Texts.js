#!/usr/bin/env node
'use strict';

// test-sif260928Texts.js — the phase A5 gates for the sif260928 search texts (PLAN-sifReplacement-
// smallPhases-092826.md §3 A5; SPEC §3.3 as amended by §9 A1, A18 and A22). ALL PURE: the whole forge
// runs in pure mode (skipEmbedding, no Docker, no network). Every conjunct is observed RED under its
// own twin before the family counts as green (gateSuiteRunner).
//
// The witness is C1's yardstick, built from the TSV alone with no shared code (EMERALD_BEACON): the
// text-count witness (per-kind counts and the 1,825-row segment rendering table) and the question map.
// Neither side is ever edited to match the other: a difference goes to the supervisor.
//
//   A5-TEXTS          (a) the distinct text strings equal C1's literals (7,540 over the Question kinds,
//                         7,698 with the Object names, and per kind); the EMBEDS_TEXT_OF edges are
//                         exactly the (text, node, property names) set rebuilt from C1's question map
//                         and segment table; the framework's trim and skip counts measure C1's
//                         QUESTION-level population (the row-level figures are a different population)
//   A5-EVERYQUESTION  (b) every Question has a name text and a contextText text, and a description text
//                         exactly when it has a description; nothing is skipped as empty
//   A5-CONTEXTTEXT    (c) contextText equals C1's table for every segment, and is exact for six named
//                         Questions, among them 'Demographics / Birth Date' and a metadata question
//   A5-NOSUPPORTTEXT  (d) only Questions and Objects carry texts: no Field, Container, Codeset,
//                         CodesetValue or the root has an EMBEDS_TEXT_OF edge
//
// The twins mutate the forge's modules in memory (moduleDouble); nothing is written.
//
// Run: PATH=/usr/local/bin:$PATH node forges/sif260928/test/test-sif260928Texts.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase A5 gates: the distinct texts, every Question's texts, contextText, no support-node text

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const BUNDLE_DIR = path.join(__dirname, '..');
const TREE_ROOT = path.join(BUNDLE_DIR, '..', '..');
const FORGE_FRAMEWORK_DIR = path.join(TREE_ROOT, 'lib', 'forge-framework');
const ENTRY_MODULE_PATH = path.join(BUNDLE_DIR, 'forgeSif260928.js');
const DECLARATION_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928ForgeDeclaration.js');
const QUESTIONS_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928Questions.js');
const CONTEXT_TEXT_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928ContextText.js');
const DESCRIPTOR_PATH = path.join(BUNDLE_DIR, 'parserDescriptor.ini');
// <system>/dataStores, reached as system/code does it (a worktree reaches it through the supervisor's
// codeWorktrees/dataStores link)
const DATA_STORES_DIR = path.join(TREE_ROOT, '..', '..', 'dataStores');
const YARDSTICK_DIR = path.join(DATA_STORES_DIR, 'bridgeAcceptance', 'sif260928', 'yardstick');
const WITNESS_TEXT_COUNT_PATH = path.join(YARDSTICK_DIR, 'sifTextCountWitness-51d3db06b2e6.json');
const WITNESS_QUESTION_MAP_PATH = path.join(YARDSTICK_DIR, 'sifQuestionMap-global-c94179bc7a78.json');

const { runGateFamily } = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'gateSuiteRunner'));
const moduleDouble = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'moduleDouble'));
const { makeTwinRegistry } = require(path.join(FORGE_FRAMEWORK_DIR, 'roundTripHarness', 'twinRegistry'));
const rosterLib = require(path.join(FORGE_FRAMEWORK_DIR, 'roster'));

const descriptorValueByName = rosterLib.readDescriptorSection(DESCRIPTOR_PATH).valueByName;
const SOURCE_PATH = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', descriptorValueByName.defaultSnapshot, descriptorValueByName.sourceFile);

// ---- FROZEN LITERALS. Never edited to match a measurement.
// C1's text-count witness (sifTextCountWitness-51d3db06b2e6.json), restated in the A5 brief
const RULED_DISTINCT_QUESTION_TEXT_COUNT = 7540;
const RULED_DISTINCT_TEXT_COUNT = 7698;
const RULED_DISTINCT_TEXT_COUNT_BY_KIND = Object.freeze({ 'Sif260928Question.name': 1270, 'Sif260928Question.description': 1752, 'Sif260928Question.contextText': 4603, 'Sif260928Object.name': 159 });
// C1's question-level population: 5,018 name and contextText slots, 4,487 descriptions (531 empty),
// nothing quote-stripped or trimmed (A17 already normalised the identity description)
const RULED_QUESTION_COUNT = 5018;
const RULED_OBJECT_COUNT = 159;
const RULED_QUESTION_EMPTY_DESCRIPTION_COUNT = 531;
const RULED_QUESTION_TRIMMED_COUNT = 0;
// C1's ROW-level description cells, the population the framework does NOT count (Fields carry no text)
const RULED_ROW_TRIMMED_COUNT = 3622;
const RULED_ROW_EMPTY_DESCRIPTION_COUNT = 4733;
// C1's segment rendering table
const RULED_SEGMENT_ROW_COUNT = 1825;
// SPEC §3.3 and §9 A22, worked examples on named Questions (C1's question map)
const RULED_NAMED_CONTEXT_TEXT_LIST = Object.freeze([
	Object.freeze({ questionRefId: '77778159015aa9d8b4bfc223cb156fda47a1ef45584313d177383cc2398d8388', relativePath: 'Demographics/BirthDate', contextText: 'Demographics / Birth Date' }),
	Object.freeze({ questionRefId: '7ba219ea53c3d824a9ae2ff3f4f61880bd70f5ca01ee993db7bb56ea152e76ae', relativePath: 'SIF_Metadata/EducationFilter/GradeLevels/GradeLevel/Code', contextText: 'SIF Metadata / Education Filter / Grade Levels / Grade Level / Code' }),
	Object.freeze({ questionRefId: '80764e843f6f920d31aec14e88fd7e64f16d19c3aeaa42de8ac85f4490d94722', relativePath: 'OtherLEAs/LEAInfoRefId', contextText: 'Other LEAs / LEA Info Ref Id' }),
	Object.freeze({ questionRefId: 'f663b1ce3660359fa92b3b1f39fe802f2d5abb24d82179a68518dbc85e4a1630', relativePath: 'TitleIProgramType', contextText: 'Title I Program Type' }),
	Object.freeze({ questionRefId: '411ed8c7898853a40e5019a0513c776d4467fed219ed05d43273785648e10f87', relativePath: 'W4Date', contextText: 'W4 Date' }),
	Object.freeze({ questionRefId: 'f7f79a9459b15141ada8e82326ca09599ec807e2e220e52a5a2e44598346e60e', relativePath: 'AssociatedRoleRefId/@Zone_Id', contextText: 'Associated Role Ref Id / Zone Id' }),
]);
// the only labels whose nodes may carry a text (SPEC §9 A1)
const RULED_TEXT_CARRYING_LABEL_LIST = Object.freeze(['Sif260928Object', 'Sif260928Question']);
const TEXT_LABEL = 'Sif260928EmbedText';

// ---- named rows and values the twins use
const NAMED_EMPTIED_RELATIVE_PATH = 'Demographics/BirthDate';

// ---- the witnesses
const WITNESS_TEXT_COUNT = JSON.parse(fs.readFileSync(WITNESS_TEXT_COUNT_PATH, 'utf8'));
const WITNESS_QUESTION_LIST = JSON.parse(fs.readFileSync(WITNESS_QUESTION_MAP_PATH, 'utf8')).questionList;
const WITNESS_RENDERING_BY_SEGMENT = new Map(WITNESS_TEXT_COUNT.segmentRenderingList);
const witnessContextTextOf = (relativePath) => relativePath.split('/').map((segment) => WITNESS_RENDERING_BY_SEGMENT.get(segment)).join(' / ');
// the (text, node, sorted property names) lines C1's files imply, one per EMBEDS_TEXT_OF edge. The
// witness strings are already stripped and trimmed; the trim here mirrors the framework's identity
// rule and changes nothing on them.
const WITNESS_TEXT_EDGE_LINE_LIST = (() => {
	const lineListOf = ({ nodeText, textByPropertyName }) => {
		const propertyNameListByText = Object.keys(textByPropertyName).reduce((soFar, propertyName) => {
			const rawText = textByPropertyName[propertyName];
			if (rawText === null || rawText.trim().length === 0) {
				return soFar;
			}
			return soFar.set(rawText.trim(), (soFar.get(rawText.trim()) || []).concat([propertyName]));
		}, new Map());
		return [...propertyNameListByText.entries()].map(([text, propertyNameList]) => JSON.stringify([text, nodeText, propertyNameList.slice().sort()]));
	};
	const questionLineList = WITNESS_QUESTION_LIST.reduce(
		(soFar, witnessQuestion) => soFar.concat(lineListOf({ nodeText: `question ${witnessQuestion.questionRefId}`, textByPropertyName: { name: witnessQuestion.name, description: witnessQuestion.description, contextText: witnessContextTextOf(witnessQuestion.relativePath) } })),
		[],
	);
	const objectNameList = [...new Set(WITNESS_QUESTION_LIST.reduce((soFar, witnessQuestion) => soFar.concat(witnessQuestion.objectNameList), []))];
	const objectLineList = objectNameList.reduce((soFar, objectName) => soFar.concat(lineListOf({ nodeText: `object ${objectName}`, textByPropertyName: { name: objectName } })), []);
	return questionLineList.concat(objectLineList).sort();
})();

// ---- the subject every conjunct reads and every twin mutates (on a clone)
const makeSubject = () => ({ bundleMutationList: [] });
const cloneSubject = (subject) => ({ ...subject, bundleMutationList: subject.bundleMutationList.slice() });

const forgeWith = ({ mutationList }, callback) => {
	const forgeBundle = mutationList.length ? moduleDouble.loadWithMutations({ modulePath: ENTRY_MODULE_PATH, mutationList }) : require(ENTRY_MODULE_PATH);
	forgeBundle({ embedder: null }).forge({ sourcePath: SOURCE_PATH, owner: 'test', skipEmbedding: true }, callback);
};

// a conjunct over the forged nodes and edges: a forge refusal is a FAIL, with the refusal as the detail
const overForged = (judgeForged) => (subject, callback) => {
	forgeWith({ mutationList: subject.bundleMutationList }, (forgeError, forged) => {
		if (forgeError) {
			callback('', { pass: false, detail: `forge refused: ${String(forgeError).slice(0, 300)}` });
			return;
		}
		callback('', judgeForged(forged));
	});
};

const nodeListByLabel = (forged, perStandardLabel) => forged.nodes.filter((oneNode) => oneNode.labels[1] === perStandardLabel);
const edgeListByType = (forged, edgeType) => forged.edges.filter((oneEdge) => oneEdge.type === edgeType);
const firstOf = (itemList) => (itemList.length ? ` (first ${JSON.stringify(itemList[0])})` : '');
const sortedCopy = (itemList) => itemList.slice().sort();

// every EMBEDS_TEXT_OF edge with its text and its target node
const textEdgeFactsListOf = (forged) => {
	const nodeByStableId = new Map(forged.nodes.map((oneNode) => [oneNode.stableId, oneNode]));
	return edgeListByType(forged, 'EMBEDS_TEXT_OF').map((oneEdge) => ({
		text: nodeByStableId.get(oneEdge.fromRef.id).properties.text,
		targetNode: nodeByStableId.get(oneEdge.toRef.id),
		propertyNameList: oneEdge.properties.propertyNameList,
	}));
};
// the forged edge in the witness's line form: a Question by its questionRefId, an Object by its name
const edgeLineOf = (textEdgeFacts) => {
	const { targetNode } = textEdgeFacts;
	const nodeText = targetNode.labels[1] === 'Sif260928Question' ? `question ${targetNode.properties.questionRefId}` : `object ${targetNode.properties.objectName}`;
	return JSON.stringify([textEdgeFacts.text, nodeText, textEdgeFacts.propertyNameList]);
};

const twinRegistry = makeTwinRegistry();
// a twin applies one mutation, or a list of them applied together
const registerMutationTwin = ({ gateId, conjunctId, twinName, mutation, mutationList = [mutation] }) => {
	twinRegistry.register({
		gateId,
		conjunctId,
		twinName,
		leverKind: 'productionMutation',
		shippedConfig: true,
		run: (subject) => {
			mutationList.forEach((oneMutation) => {
				moduleDouble.assertMutationApplies(oneMutation);
				subject.bundleMutationList.push(oneMutation);
			});
			return subject;
		},
	});
};
const declarationMutation = ({ find, replace }) => ({ modulePath: DECLARATION_MODULE_PATH, find, replace });
const questionsMutation = ({ find, replace }) => ({ modulePath: QUESTIONS_MODULE_PATH, find, replace });
const contextTextMutation = ({ find, replace }) => ({ modulePath: CONTEXT_TEXT_MODULE_PATH, find, replace });

const QUESTION_TEXT_LIST_LINE = "[DME_ROLES.PROPERTY]: Object.freeze(['name', 'description', 'contextText']),";
const CONTEXT_TEXT_LINE = 'contextText: contextTextOf(firstFieldFacts.relativePath),';

const TEXTS_GATE_ID = 'A5-TEXTS';
const EVERY_QUESTION_GATE_ID = 'A5-EVERYQUESTION';
const CONTEXT_TEXT_GATE_ID = 'A5-CONTEXTTEXT';
const NO_SUPPORT_TEXT_GATE_ID = 'A5-NOSUPPORTTEXT';

// =====================================================================
// (a) A5-TEXTS
// =====================================================================
const textsConjunctList = [
	{
		conjunctId: 'distinctTextsEqualWitness',
		title: "the forge mints 7,698 text nodes, 7,540 of them the texts of Questions, with C1's distinct count per kind (name 1,270, description 1,752, contextText 4,603, Object name 159); its EMBEDS_TEXT_OF edges are exactly the (text, node, property names) lines rebuilt from C1's question map and segment table",
		twinNameList: ['contextTextDroppedFromDeclaration'],
		evaluate: overForged((forged) => {
			const textEdgeFactsList = textEdgeFactsListOf(forged);
			const textNodeCount = nodeListByLabel(forged, TEXT_LABEL).length;
			const questionTextCount = new Set(textEdgeFactsList.filter((textEdgeFacts) => textEdgeFacts.targetNode.labels[1] === 'Sif260928Question').map((textEdgeFacts) => textEdgeFacts.text)).size;
			const textSetByKind = textEdgeFactsList.reduce((soFar, textEdgeFacts) => {
				textEdgeFacts.propertyNameList.forEach((propertyName) => {
					const kindName = `${textEdgeFacts.targetNode.labels[1]}.${propertyName}`;
					soFar[kindName] = (soFar[kindName] || new Set()).add(textEdgeFacts.text);
				});
				return soFar;
			}, {});
			const distinctCountByKind = Object.keys(textSetByKind).reduce((soFar, kindName) => ({ ...soFar, [kindName]: textSetByKind[kindName].size }), {});
			const kindWrongList = Object.keys(RULED_DISTINCT_TEXT_COUNT_BY_KIND).filter((kindName) => distinctCountByKind[kindName] !== RULED_DISTINCT_TEXT_COUNT_BY_KIND[kindName]);
			const witnessKindWrongList = [
				['Sif260928Question.name', WITNESS_TEXT_COUNT.questionTextByKind.name.distinctTextCount],
				['Sif260928Question.description', WITNESS_TEXT_COUNT.questionTextByKind.description.distinctTextCount],
				['Sif260928Question.contextText', WITNESS_TEXT_COUNT.questionTextByKind.contextText.distinctTextCount],
				['Sif260928Object.name', WITNESS_TEXT_COUNT.objectTextByKind.name.distinctTextCount],
			].filter(([kindName, witnessCount]) => witnessCount !== RULED_DISTINCT_TEXT_COUNT_BY_KIND[kindName]);
			const forgedLineList = textEdgeFactsList.map(edgeLineOf).sort();
			const witnessLineSet = new Set(WITNESS_TEXT_EDGE_LINE_LIST);
			const forgedLineSet = new Set(forgedLineList);
			const forgedOnlyList = forgedLineList.filter((edgeLine) => !witnessLineSet.has(edgeLine));
			const witnessOnlyList = WITNESS_TEXT_EDGE_LINE_LIST.filter((edgeLine) => !forgedLineSet.has(edgeLine));
			return {
				pass:
					textNodeCount === RULED_DISTINCT_TEXT_COUNT &&
					questionTextCount === RULED_DISTINCT_QUESTION_TEXT_COUNT &&
					WITNESS_TEXT_COUNT.distinctTextCountAcrossAllKinds === RULED_DISTINCT_TEXT_COUNT &&
					WITNESS_TEXT_COUNT.distinctQuestionTextCountAcrossKinds === RULED_DISTINCT_QUESTION_TEXT_COUNT &&
					kindWrongList.length === 0 &&
					Object.keys(distinctCountByKind).length === Object.keys(RULED_DISTINCT_TEXT_COUNT_BY_KIND).length &&
					witnessKindWrongList.length === 0 &&
					forgedLineList.length === WITNESS_TEXT_EDGE_LINE_LIST.length &&
					forgedOnlyList.length === 0 &&
					witnessOnlyList.length === 0,
				detail: `text nodes ${textNodeCount}, Question texts ${questionTextCount}; distinct by kind ${JSON.stringify(distinctCountByKind)}; kinds wrong [${kindWrongList}]; witness kinds off the literals [${witnessKindWrongList}]; edges ${forgedLineList.length} (witness ${WITNESS_TEXT_EDGE_LINE_LIST.length}), forged only ${forgedOnlyList.length}${firstOf(forgedOnlyList)}, witness only ${witnessOnlyList.length}${firstOf(witnessOnlyList)}`,
			};
		}),
	},
	{
		conjunctId: 'frameworkCountsMeasureQuestionLevelPopulation',
		title: "the framework's text counts measure C1's QUESTION-level population: trimmed 0 (C1 0); the 531 empty descriptions reach it as ABSENT (the walk omits an empty description, SPEC §3.1), so embedTextAbsentCount is 531 and embedTextSkippedEmptyCount 0, together C1's 531; neither equals C1's row-level 3,622 trimmed or 4,733 empty",
		twinNameList: ['descriptionDroppedFromDeclaration', 'contextTextPaddedWithASpace'],
		evaluate: overForged((forged) => {
			const { embedTextTrimmedCount, embedTextSkippedEmptyCount, embedTextAbsentCount } = forged.stats;
			const witnessQuestionKindList = [WITNESS_TEXT_COUNT.questionTextByKind.name, WITNESS_TEXT_COUNT.questionTextByKind.description, WITNESS_TEXT_COUNT.questionTextByKind.contextText, WITNESS_TEXT_COUNT.objectTextByKind.name];
			const witnessQuestionTrimmedCount = witnessQuestionKindList.reduce((soFar, witnessKind) => soFar + witnessKind.trimmedCount, 0);
			const witnessQuestionEmptyCount = witnessQuestionKindList.reduce((soFar, witnessKind) => soFar + witnessKind.emptySkippedCount, 0);
			const witnessRowDescription = WITNESS_TEXT_COUNT.rowCellByKind.description;
			return {
				pass:
					witnessQuestionTrimmedCount === RULED_QUESTION_TRIMMED_COUNT &&
					witnessQuestionEmptyCount === RULED_QUESTION_EMPTY_DESCRIPTION_COUNT &&
					witnessRowDescription.trimmedCount === RULED_ROW_TRIMMED_COUNT &&
					witnessRowDescription.emptySkippedCount === RULED_ROW_EMPTY_DESCRIPTION_COUNT &&
					embedTextTrimmedCount === RULED_QUESTION_TRIMMED_COUNT &&
					embedTextAbsentCount === RULED_QUESTION_EMPTY_DESCRIPTION_COUNT &&
					embedTextSkippedEmptyCount === 0 &&
					embedTextAbsentCount + embedTextSkippedEmptyCount === witnessQuestionEmptyCount,
				detail: `framework trimmed ${embedTextTrimmedCount}, absent ${embedTextAbsentCount}, skipped empty ${embedTextSkippedEmptyCount}; C1 question level trimmed ${witnessQuestionTrimmedCount}, empty ${witnessQuestionEmptyCount}; C1 row level trimmed ${witnessRowDescription.trimmedCount}, empty ${witnessRowDescription.emptySkippedCount}`,
			};
		}),
	},
];
// the plan's twin: the declaration forgets contextText, and the counts move
registerMutationTwin({
	gateId: TEXTS_GATE_ID,
	conjunctId: 'distinctTextsEqualWitness',
	twinName: 'contextTextDroppedFromDeclaration',
	mutation: declarationMutation({ find: QUESTION_TEXT_LIST_LINE, replace: "[DME_ROLES.PROPERTY]: Object.freeze(['name', 'description'])," }),
});
// the 531 absences are the description slot's: undeclared, it is never read and never counted. (Stamping
// the empty descriptions as '' is no lever: the kit refuses an empty description in makeNode.)
registerMutationTwin({
	gateId: TEXTS_GATE_ID,
	conjunctId: 'frameworkCountsMeasureQuestionLevelPopulation',
	twinName: 'descriptionDroppedFromDeclaration',
	mutation: declarationMutation({ find: QUESTION_TEXT_LIST_LINE, replace: "[DME_ROLES.PROPERTY]: Object.freeze(['name', 'contextText'])," }),
});
// a text the framework must trim: every contextText gains a trailing space
registerMutationTwin({
	gateId: TEXTS_GATE_ID,
	conjunctId: 'frameworkCountsMeasureQuestionLevelPopulation',
	twinName: 'contextTextPaddedWithASpace',
	mutation: questionsMutation({ find: CONTEXT_TEXT_LINE, replace: "contextText: `${contextTextOf(firstFieldFacts.relativePath)} `," }),
});

// =====================================================================
// (b) A5-EVERYQUESTION
// =====================================================================
const everyQuestionConjunctList = [
	{
		conjunctId: 'everyQuestionCarriesItsTexts',
		title: "each of the 5,018 Questions has at least one text: exactly one carrying 'name' and one carrying 'contextText', a 'description' text exactly when it has a description, each equal to that property; no text is skipped as empty",
		twinNameList: ['oneContextTextForcedEmpty'],
		evaluate: overForged((forged) => {
			const textEdgeFactsListByQuestionStableId = textEdgeFactsListOf(forged)
				.filter((textEdgeFacts) => textEdgeFacts.targetNode.labels[1] === 'Sif260928Question')
				.reduce((soFar, textEdgeFacts) => soFar.set(textEdgeFacts.targetNode.stableId, (soFar.get(textEdgeFacts.targetNode.stableId) || []).concat([textEdgeFacts])), new Map());
			const questionNodeList = nodeListByLabel(forged, 'Sif260928Question');
			const textlessList = questionNodeList.filter((questionNode) => !textEdgeFactsListByQuestionStableId.has(questionNode.stableId)).map((questionNode) => questionNode.properties.relativePath);
			const wrongList = questionNodeList
				.filter((questionNode) => {
					const textEdgeFactsList = textEdgeFactsListByQuestionStableId.get(questionNode.stableId) || [];
					const textListOf = (propertyName) => textEdgeFactsList.filter((textEdgeFacts) => textEdgeFacts.propertyNameList.indexOf(propertyName) !== -1).map((textEdgeFacts) => textEdgeFacts.text);
					const hasDescription = questionNode.properties.description !== undefined;
					return (
						JSON.stringify(textListOf('name')) !== JSON.stringify([questionNode.properties.name]) ||
						JSON.stringify(textListOf('contextText')) !== JSON.stringify([questionNode.properties.contextText]) ||
						JSON.stringify(textListOf('description')) !== JSON.stringify(hasDescription ? [questionNode.properties.description] : [])
					);
				})
				.map((questionNode) => questionNode.properties.relativePath);
			const { embedTextSkippedEmptyCount } = forged.stats;
			return {
				pass: questionNodeList.length === RULED_QUESTION_COUNT && textlessList.length === 0 && wrongList.length === 0 && embedTextSkippedEmptyCount === 0,
				detail: `Questions ${questionNodeList.length}; with no text ${textlessList.length}${firstOf(textlessList)}; texts not their properties ${wrongList.length}${firstOf(wrongList)}; skipped empty (counted, not minted) ${embedTextSkippedEmptyCount}`,
			};
		}),
	},
];
// the plan's twin: one Question's contextText is empty, so the framework counts it and mints nothing
registerMutationTwin({
	gateId: EVERY_QUESTION_GATE_ID,
	conjunctId: 'everyQuestionCarriesItsTexts',
	twinName: 'oneContextTextForcedEmpty',
	mutation: questionsMutation({ find: CONTEXT_TEXT_LINE, replace: `contextText: firstFieldFacts.relativePath === '${NAMED_EMPTIED_RELATIVE_PATH}' ? '' : contextTextOf(firstFieldFacts.relativePath),` }),
});

// =====================================================================
// (c) A5-CONTEXTTEXT
// =====================================================================
// the segments of every forged Question's relativePath whose rendering differs from C1's table
const segmentsDifferingFromWitnessOf = ({ forged, contextTextModule }) => {
	const questionNodeList = nodeListByLabel(forged, 'Sif260928Question');
	const forgedSegmentList = sortedCopy([...new Set(questionNodeList.reduce((soFar, questionNode) => soFar.concat(questionNode.properties.relativePath.split('/')), []))]);
	return {
		questionNodeList,
		forgedSegmentList,
		differingSegmentList: forgedSegmentList.filter((segment) => contextTextModule.segmentRenderingOf(segment) !== WITNESS_RENDERING_BY_SEGMENT.get(segment)),
		wrongQuestionList: questionNodeList.filter((questionNode) => questionNode.properties.contextText !== witnessContextTextOf(questionNode.properties.relativePath)).map((questionNode) => questionNode.properties.relativePath),
	};
};
const contextTextModuleOf = (subject) => (subject.bundleMutationList.length ? moduleDouble.loadWithMutations({ modulePath: CONTEXT_TEXT_MODULE_PATH, mutationList: subject.bundleMutationList }) : require(CONTEXT_TEXT_MODULE_PATH));
const contextTextConjunctList = [
	{
		conjunctId: 'contextTextEqualsWitnessTableForEverySegment',
		title: "the distinct segments of the Questions' relative paths are exactly C1's 1,825 table rows; the forge renders every one as the table does, and every Question's contextText is its segments' renderings joined by ' / '",
		twinNameList: ['pluralAcronymRuleRemoved'],
		evaluate: (subject, callback) => {
			const contextTextModule = contextTextModuleOf(subject);
			overForged((forged) => {
				const { questionNodeList, forgedSegmentList, differingSegmentList, wrongQuestionList } = segmentsDifferingFromWitnessOf({ forged, contextTextModule });
				const witnessSegmentList = sortedCopy(WITNESS_TEXT_COUNT.segmentRenderingList.map(([segment]) => segment));
				return {
					pass:
						questionNodeList.length === RULED_QUESTION_COUNT &&
						witnessSegmentList.length === RULED_SEGMENT_ROW_COUNT &&
						JSON.stringify(forgedSegmentList) === JSON.stringify(witnessSegmentList) &&
						differingSegmentList.length === 0 &&
						wrongQuestionList.length === 0,
					detail: `segments ${forgedSegmentList.length} (table ${witnessSegmentList.length}, same set ${JSON.stringify(forgedSegmentList) === JSON.stringify(witnessSegmentList)}); segments rendered unlike the table [${differingSegmentList.join(', ')}]; Questions whose contextText differs ${wrongQuestionList.length}${firstOf(wrongQuestionList)}`,
				};
			})(subject, callback);
		},
	},
	{
		conjunctId: 'namedQuestionsContextTextExact',
		title: "six named Questions carry exactly SPEC §3.3 / §9 A22's contextText: 'Demographics / Birth Date', the metadata 'SIF Metadata / Education Filter / Grade Levels / Grade Level / Code', 'Other LEAs / LEA Info Ref Id', 'Title I Program Type', 'W4 Date' and 'Associated Role Ref Id / Zone Id'",
		twinNameList: ['underscoreKeptInSegments'],
		evaluate: overForged((forged) => {
			const questionNodeByRefId = new Map(nodeListByLabel(forged, 'Sif260928Question').map((questionNode) => [questionNode.properties.questionRefId, questionNode]));
			const wrongList = RULED_NAMED_CONTEXT_TEXT_LIST.filter((namedQuestion) => {
				const questionNode = questionNodeByRefId.get(namedQuestion.questionRefId);
				return questionNode === undefined || questionNode.properties.relativePath !== namedQuestion.relativePath || questionNode.properties.contextText !== namedQuestion.contextText;
			}).map((namedQuestion) => {
				const questionNode = questionNodeByRefId.get(namedQuestion.questionRefId);
				return `${namedQuestion.relativePath} → ${questionNode === undefined ? 'no such Question' : JSON.stringify(questionNode.properties.contextText)}`;
			});
			return {
				pass: wrongList.length === 0,
				detail: `named Questions wrong ${wrongList.length}${firstOf(wrongList)}`,
			};
		}),
	},
];
// the plan's twin: without the plural-acronym refinement, exactly OtherLEAs renders differently
registerMutationTwin({
	gateId: CONTEXT_TEXT_GATE_ID,
	conjunctId: 'contextTextEqualsWitnessTableForEverySegment',
	twinName: 'pluralAcronymRuleRemoved',
	mutation: contextTextMutation({ find: '&& !endsPluralAcronym({ characterList, characterIndex })', replace: '' }),
});
registerMutationTwin({
	gateId: CONTEXT_TEXT_GATE_ID,
	conjunctId: 'namedQuestionsContextTextExact',
	twinName: 'underscoreKeptInSegments',
	mutation: contextTextMutation({ find: "unmarkedSegment.replace(WORD_SEPARATOR_PATTERN, ' ')", replace: 'unmarkedSegment' }),
});

// =====================================================================
// (d) A5-NOSUPPORTTEXT
// =====================================================================
const noSupportTextConjunctList = [
	{
		conjunctId: 'onlyQuestionsAndObjectsCarryTexts',
		title: "every EMBEDS_TEXT_OF edge ends at a Question or an Object, never a Field, Container, Codeset, CodesetValue or the root; each of the 159 Objects has exactly one, its name, carrying ['name']",
		twinNameList: ['supportRoleDeclared'],
		evaluate: overForged((forged) => {
			const textEdgeFactsList = textEdgeFactsListOf(forged);
			const otherTargetList = textEdgeFactsList.filter((textEdgeFacts) => RULED_TEXT_CARRYING_LABEL_LIST.indexOf(textEdgeFacts.targetNode.labels[1]) === -1).map((textEdgeFacts) => textEdgeFacts.targetNode.stableId);
			const objectTextEdgeFactsList = textEdgeFactsList.filter((textEdgeFacts) => textEdgeFacts.targetNode.labels[1] === 'Sif260928Object');
			const objectWrongList = objectTextEdgeFactsList.filter((textEdgeFacts) => textEdgeFacts.text !== textEdgeFacts.targetNode.properties.objectName || JSON.stringify(textEdgeFacts.propertyNameList) !== JSON.stringify(['name'])).map((textEdgeFacts) => textEdgeFacts.targetNode.stableId);
			const objectWithTextCount = new Set(objectTextEdgeFactsList.map((textEdgeFacts) => textEdgeFacts.targetNode.stableId)).size;
			return {
				pass: otherTargetList.length === 0 && objectTextEdgeFactsList.length === RULED_OBJECT_COUNT && objectWithTextCount === RULED_OBJECT_COUNT && objectWrongList.length === 0,
				detail: `texts on other nodes ${otherTargetList.length}${firstOf(otherTargetList)}; Object text edges ${objectTextEdgeFactsList.length} over ${objectWithTextCount} Objects; wrong ${objectWrongList.length}${firstOf(objectWrongList)}`,
			};
		}),
	},
];
// the plan's twin: the declaration gives DmeSupport (Fields and Containers) a text
registerMutationTwin({
	gateId: NO_SUPPORT_TEXT_GATE_ID,
	conjunctId: 'onlyQuestionsAndObjectsCarryTexts',
	twinName: 'supportRoleDeclared',
	mutation: declarationMutation({ find: QUESTION_TEXT_LIST_LINE, replace: `${QUESTION_TEXT_LIST_LINE} [DME_ROLES.SUPPORT]: Object.freeze(['name']),` }),
});

const gateDeclarationList = [
	{ gateId: TEXTS_GATE_ID, title: "(a) the distinct texts equal C1's literals, and the framework counts C1's question-level population", conjunctList: textsConjunctList },
	{ gateId: EVERY_QUESTION_GATE_ID, title: '(b) every Question has its texts', conjunctList: everyQuestionConjunctList },
	{ gateId: CONTEXT_TEXT_GATE_ID, title: "(c) contextText equals C1's table for every segment, and six named Questions", conjunctList: contextTextConjunctList },
	{ gateId: NO_SUPPORT_TEXT_GATE_ID, title: '(d) no Field, Container or code list carries a text', conjunctList: noSupportTextConjunctList },
];

runGateFamily({ harness, familyName: 'sif260928 A5 texts', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 6, expectedTwinCount: 7 }, () => {
	harness.report();
});
