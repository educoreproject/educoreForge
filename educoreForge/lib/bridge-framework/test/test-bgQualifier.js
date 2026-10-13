#!/usr/bin/env node
'use strict';

// test-bgQualifier.js — BG-QUALIFIER: CEDS qualifiers on the judge's card, and identical cards collapsed (lane QUAL,
// cedsRichness-101226, 2026-10-13).
//
//   BG-QUALIFIER  (a) a qualified card renders its qualifierNames in its name, and the question names it in
//                 qualifiedCardStableIdList; (b) an unqualified pool renders byte-identical to the BASE renderer (main
//                 a07ea515), pinned as that renderer's promptHash, and an empty qualifierNames list changes nothing;
//                 (c) identical rendered cards collapse into one choice carrying every member; (d) cards that differ
//                 only in their qualifier do NOT collapse; (e) a pick on a collapsed card resolves to EVERY member, and
//                 an uncollapsed pick to itself; (f) the crosswalk variant neither collapses nor renders the qualifier;
//                 (g) a malformed qualifierNames is refused by name; (h) through a real bridge run, a pick on a collapsed
//                 card freezes one decision record per member, each carrying the collapse; (i) every variant row declares
//                 its collapse switch, or the renderer refuses to load.
//
// Run: node lib/bridge-framework/test/test-bgQualifier.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-QUALIFIER

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, pureConjunct, succeeded, frameworkMutationTwin, blockOf } = require('./testSupport/bridgeTwinFactories');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const GATE_ID = 'BG-QUALIFIER';
const RENDERER_FILE = 'evidenceRenderer.js';
const FRAMEWORK_FILE = 'bridge-framework.js';
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const edfiDeclaration = require(path.join(TREE_ROOT, 'forges', 'edfi', 'bridges', 'edfiCedsDerivedPlugin.js')).bridgeDeclaration;

// THE EXTERNAL REFERENCE for (b): the promptHash the BASE renderer (educoreForge main a07ea515, before lane QUAL)
// produced for UNQUALIFIED_POOL_INPUT below, computed with that checkout's own module. A pin from the renderer under
// test would only prove the renderer agrees with itself.
const BASE_RENDERER_UNQUALIFIED_PROMPT_HASH = '276027d0711537fa7b1f91cc50deab12adbc684b3fd9031b2dfcfd362bac49ca';

const rendererLibFor = (scenario) =>
	(scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RENDERER_FILE), mutationList: scenario.frameworkMutationList }) : require(path.join(scenarioLib.FRAMEWORK_DIR, RENDERER_FILE)));

const seatFor = ({ stableId, name, domainName, qualifierNames }) => ({
	card: { stableId, name, domainName, propertyDefinition: `${name} definition.`, domainDefinition: `${domainName} domain.`, ...(qualifierNames === undefined ? {} : { qualifierNames }) },
	seatReason: 'retrieval',
});
const SOURCE_ELEMENT = { name: 'EducationOrganizationId', material: { name: 'EducationOrganizationId', path: 'EducationOrganization.EducationOrganizationId', description: 'The identifier assigned to an education organization.', owningConstructName: 'EducationOrganization' } };
const questionInputFor = ({ candidatePool, judgePromptVariant = 'derivedJudgeSlot' }) => ({
	sourceElement: SOURCE_ELEMENT,
	candidatePool,
	globalGuidanceList: edfiDeclaration.globalGuidanceList,
	promptSegmentList: [],
	judgePromptVariant,
	renderingAllowList: judgePromptVariant === 'crosswalk' ? undefined : edfiDeclaration.renderingAllowList,
});
const UNQUALIFIED_POOL = [seatFor({ stableId: 'hub:a', name: 'Has Organization Identifier', domainName: 'Organization' }), seatFor({ stableId: 'hub:b', name: 'Organization Name', domainName: 'Organization' }), seatFor({ stableId: 'hub:c', name: 'School Identifier', domainName: 'K12 School' })];
const QUALIFIED_POOL = [seatFor({ stableId: 'hub:a', name: 'Has Organization Identifier', domainName: 'Organization', qualifierNames: ['School Identifier'] }), seatFor({ stableId: 'hub:b', name: 'Has Organization Identifier', domainName: 'Organization', qualifierNames: ['Local Education Agency Identifier'] }), seatFor({ stableId: 'hub:c', name: 'Organization Name', domainName: 'Organization' })];
const DUPLICATE_POOL = [seatFor({ stableId: 'hub:a', name: 'Has Organization Identifier', domainName: 'Organization' }), seatFor({ stableId: 'hub:b', name: 'Organization Name', domainName: 'Organization' }), seatFor({ stableId: 'hub:c', name: 'Has Organization Identifier', domainName: 'Organization' })];

const questionOf = (scenario, input) => rendererLibFor(scenario).renderQuestion(input);

const qualifierConjunctList = [
	pureConjunct({
		conjunctId: 'a_qualifiedCardRendersItsQualifier',
		title: "a qualified card renders as 'Has Organization Identifier (School Identifier)' and is named in qualifiedCardStableIdList",
		twinNameList: ['qualifierDroppedFromName'],
		judge: (scenario) => {
			const question = questionOf(scenario, questionInputFor({ candidatePool: QUALIFIED_POOL }));
			if (question.error) {
				return { pass: false, detail: question.error.message };
			}
			const rendersBoth = question.userPrompt.indexOf('name: Has Organization Identifier (School Identifier)') !== -1 && question.userPrompt.indexOf('name: Has Organization Identifier (Local Education Agency Identifier)') !== -1;
			const listed = JSON.stringify(question.qualifiedCardStableIdList) === JSON.stringify(['hub:a', 'hub:b']);
			return { pass: rendersBoth && listed, detail: `rendersBoth ${rendersBoth}; qualifiedCardStableIdList ${JSON.stringify(question.qualifiedCardStableIdList)}` };
		},
	}),
	pureConjunct({
		conjunctId: 'b_unqualifiedPoolByteIdenticalToBaseRenderer',
		title: 'an unqualified pool hashes exactly as the base renderer hashed it, with and without an empty qualifierNames list',
		twinNameList: ['emptyQualifierListRendersParentheses'],
		judge: (scenario) => {
			const plainQuestion = questionOf(scenario, questionInputFor({ candidatePool: UNQUALIFIED_POOL }));
			const emptyListQuestion = questionOf(scenario, questionInputFor({ candidatePool: UNQUALIFIED_POOL.map((oneSeat) => ({ ...oneSeat, card: { ...oneSeat.card, qualifierNames: [] } })) }));
			if (plainQuestion.error || emptyListQuestion.error) {
				return { pass: false, detail: (plainQuestion.error || emptyListQuestion.error).message };
			}
			const pass = plainQuestion.promptHash === BASE_RENDERER_UNQUALIFIED_PROMPT_HASH && emptyListQuestion.promptHash === BASE_RENDERER_UNQUALIFIED_PROMPT_HASH && plainQuestion.qualifiedCardStableIdList.length === 0 && plainQuestion.cardCollapseList.length === 0;
			return { pass, detail: `plain ${plainQuestion.promptHash}; empty list ${emptyListQuestion.promptHash}; base ${BASE_RENDERER_UNQUALIFIED_PROMPT_HASH}` };
		},
	}),
	pureConjunct({
		conjunctId: 'c_identicalCardsCollapse',
		title: 'two cards identical as rendered become ONE choice carrying both stableIds; the pool offers 2 choices, not 3',
		twinNameList: ['derivedRowDoesNotCollapse'],
		judge: (scenario) => {
			const question = questionOf(scenario, questionInputFor({ candidatePool: DUPLICATE_POOL }));
			if (question.error) {
				return { pass: false, detail: question.error.message };
			}
			const expectedCollapse = JSON.stringify([{ renderedStableId: 'hub:a', memberStableIdList: ['hub:a', 'hub:c'] }]);
			const pass = JSON.stringify(question.renderedPoolStableIdList) === JSON.stringify(['hub:a', 'hub:b']) && JSON.stringify(question.choiceEnum) === JSON.stringify(['1', '2', 'NONE']) && JSON.stringify(question.cardCollapseList) === expectedCollapse && question.userPrompt.indexOf('CANDIDATE ELEMENTS (2)') !== -1 && Object.keys(question.choiceQuestion.criteriaByChoice).length === 3;
			return { pass, detail: `pool ${JSON.stringify(question.renderedPoolStableIdList)}; choiceEnum ${JSON.stringify(question.choiceEnum)}; collapse ${JSON.stringify(question.cardCollapseList)}` };
		},
	}),
	pureConjunct({
		conjunctId: 'd_qualifiersKeepTwinsApart',
		title: 'two cards that differ only in their qualifier stay two choices',
		twinNameList: ['qualifierDroppedFromNameForCollapse'],
		judge: (scenario) => {
			const question = questionOf(scenario, questionInputFor({ candidatePool: QUALIFIED_POOL }));
			if (question.error) {
				return { pass: false, detail: question.error.message };
			}
			return { pass: question.renderedPoolStableIdList.length === 3 && question.cardCollapseList.length === 0, detail: `pool ${JSON.stringify(question.renderedPoolStableIdList)}; collapse ${JSON.stringify(question.cardCollapseList)}` };
		},
	}),
	pureConjunct({
		conjunctId: 'e_collapsedPickResolvesToEveryMember',
		title: 'a pick on a collapsed card resolves to every member; an uncollapsed pick to itself',
		twinNameList: ['collapsedPickResolvesToRepresentativeOnly'],
		judge: (scenario) => {
			const rendererLib = rendererLibFor(scenario);
			const cardCollapseList = [{ renderedStableId: 'hub:a', memberStableIdList: ['hub:a', 'hub:c'] }];
			const collapsedPick = rendererLib.memberStableIdListFor({ cardCollapseList, chosenCardStableId: 'hub:a' });
			const plainPick = rendererLib.memberStableIdListFor({ cardCollapseList, chosenCardStableId: 'hub:b' });
			return { pass: JSON.stringify(collapsedPick) === JSON.stringify(['hub:a', 'hub:c']) && JSON.stringify(plainPick) === JSON.stringify(['hub:b']), detail: `collapsed pick -> ${JSON.stringify(collapsedPick)}; plain pick -> ${JSON.stringify(plainPick)}` };
		},
	}),
	pureConjunct({
		conjunctId: 'f_crosswalkNeitherCollapsesNorQualifies',
		title: 'the byte-frozen crosswalk variant keeps every seat and lists no qualified card',
		twinNameList: ['crosswalkRowCollapses'],
		judge: (scenario) => {
			const pool = DUPLICATE_POOL.map((oneSeat) => ({ ...oneSeat, card: { ...oneSeat.card, canonicalKey: 'P000001', qualifierNames: ['School Identifier'] } }));
			const question = questionOf(scenario, questionInputFor({ candidatePool: pool, judgePromptVariant: 'crosswalk' }));
			if (question.error) {
				return { pass: false, detail: question.error.message };
			}
			return { pass: question.renderedPoolStableIdList.length === 3 && question.cardCollapseList.length === 0 && question.qualifiedCardStableIdList.length === 0, detail: `pool ${question.renderedPoolStableIdList.length}; collapse ${question.cardCollapseList.length}; qualified ${question.qualifiedCardStableIdList.length}` };
		},
	}),
	pureConjunct({
		conjunctId: 'i_everyVariantRowDeclaresItsSwitches',
		title: 'the renderer loads only when every variant row declares requiresRenderingAllowList and collapsesIdenticalCards as booleans',
		twinNameList: ['crosswalkRowOmitsCollapseSwitch'],
		judge: (scenario) => {
			let loadRefusal = '';
			try {
				rendererLibFor(scenario);
			} catch (loadError) {
				loadRefusal = loadError.message;
			}
			return { pass: loadRefusal === '', detail: loadRefusal === '' ? 'loads' : loadRefusal.slice(0, 220) };
		},
	}),
	pureConjunct({
		conjunctId: 'g_malformedQualifierNamesRefused',
		title: 'a qualifierNames that is not a list of non-blank names is refused by name, never rendered',
		twinNameList: ['qualifierNamesRefusalDeleted'],
		judge: (scenario) => {
			const pool = [seatFor({ stableId: 'hub:a', name: 'Has Organization Identifier', domainName: 'Organization', qualifierNames: ['School Identifier', ' '] })];
			const question = questionOf(scenario, questionInputFor({ candidatePool: pool }));
			return { pass: Boolean(question.error) && /qualifierNames/.test(question.error.message), detail: question.error ? question.error.message.slice(0, 200) : 'rendered, not refused' };
		},
	}),
];

const RENDERED_NAME_FIND = '	Array.isArray(card.qualifierNames) && card.qualifierNames.length > 0 ? `${card.name} (${card.qualifierNames.join(QUALIFIER_NAME_SEPARATOR)})` : card.name;';
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'a_qualifiedCardRendersItsQualifier', twinName: 'qualifierDroppedFromName', fileName: RENDERER_FILE, find: RENDERED_NAME_FIND, replace: '	card.name;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'b_unqualifiedPoolByteIdenticalToBaseRenderer', twinName: 'emptyQualifierListRendersParentheses', fileName: RENDERER_FILE, find: RENDERED_NAME_FIND, replace: '	Array.isArray(card.qualifierNames) ? `${card.name} (${card.qualifierNames.join(QUALIFIER_NAME_SEPARATOR)})` : card.name;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'c_identicalCardsCollapse', twinName: 'derivedRowDoesNotCollapse', fileName: RENDERER_FILE, find: '	collapsesIdenticalCards: true,\n', replace: '	collapsesIdenticalCards: false,\n' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'd_qualifiersKeepTwinsApart', twinName: 'qualifierDroppedFromNameForCollapse', fileName: RENDERER_FILE, find: RENDERED_NAME_FIND, replace: '	card.name;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'e_collapsedPickResolvesToEveryMember', twinName: 'collapsedPickResolvesToRepresentativeOnly', fileName: RENDERER_FILE, find: '	return collapseEntry === undefined ? [chosenCardStableId] : collapseEntry.memberStableIdList.slice();', replace: '	return [chosenCardStableId];' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'f_crosswalkNeitherCollapsesNorQualifies', twinName: 'crosswalkRowCollapses', fileName: RENDERER_FILE, find: '		collapsesIdenticalCards: false,\n', replace: '		collapsesIdenticalCards: true,\n		candidateData: ({ oneSeat }) => ({ name: oneSeat.card.name }),\n' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'i_everyVariantRowDeclaresItsSwitches', twinName: 'crosswalkRowOmitsCollapseSwitch', fileName: RENDERER_FILE, find: '		collapsesIdenticalCards: false,\n', replace: '' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'g_malformedQualifierNamesRefused', twinName: 'qualifierNamesRefusalDeleted', fileName: RENDERER_FILE, find: '		if (qualifierNamesRefusal) {', replace: '		if (false) {' });

// ---------------------------------------------------------------------
// (h) THROUGH A REAL RUN. The toy derived bridge, with the 'Birth Date (staff)' card reshaped to render exactly as
// 'Birth Date' does, so the two collapse in every pool holding both. The decision block must then hold, for any
// subject whose pick landed on the collapsed choice, one record per member, each carrying cardCollapseList.
// ---------------------------------------------------------------------
const TOY_EMBED_MODEL = 'toy-embed-v1';
const TWIN_CARD_STABLE_ID = 'toyhub:card/P000002.C2';
const ORIGINAL_CARD_STABLE_ID = 'toyhub:card/P000002.C1';
const shapeIdenticalCards = (scenario) => {
	const nodeList = scenario.graph.nodeList;
	const originalNode = nodeList.find((oneNode) => oneNode.stableId === ORIGINAL_CARD_STABLE_ID);
	const twinNode = nodeList.find((oneNode) => oneNode.stableId === TWIN_CARD_STABLE_ID);
	['name', 'propertyDefinition', 'domainName', 'domainDefinition'].forEach((propertyName) => {
		twinNode.properties[propertyName] = originalNode.properties[propertyName];
	});
};
// the judge double picks the 'Birth Date' choice wherever the pool offers it, and abstains elsewhere
const birthDateOrdinalFor = ({ userPrompt }) => {
	const blockList = userPrompt.split(/\n {2}CANDIDATE INDEX NUMBER: \[/).slice(1);
	const pickIndex = blockList.findIndex((oneBlock) => /\n {6}name: Birth Date\n/.test(`${oneBlock}\n`));
	return pickIndex === -1 ? 'NONE' : String(pickIndex + 1);
};
const runConjunctList = [
	runConjunct({
		conjunctId: 'h_collapsedPickFreezesOneRecordPerMember',
		title: 'a pick on a collapsed toy card freezes one record per member, each carrying the collapse, under one judgment',
		twinNameList: ['frameworkKeepsRepresentativeOnly'],
		shape: (scenario) => {
			// the test-bgDerived derivedShape step: candidateRetrieval refuses a vector whose model is not the declared one
			scenario.spec.bridge = 'toyDerivedPlugin';
			scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) => (oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } }));
			scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({ pickOrdinal: birthDateOrdinalFor });
			shapeIdenticalCards(scenario);
		},
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const collapsedRecordList = block.decisionRecordList.filter((oneRecord) => Array.isArray(oneRecord.cardCollapseList) && oneRecord.objectStableId !== null);
			const memberObjectSet = new Set(collapsedRecordList.map((oneRecord) => `${oneRecord.subjectStableId}\u001f${oneRecord.objectStableId}`));
			const subjectList = Array.from(new Set(collapsedRecordList.filter((oneRecord) => [ORIGINAL_CARD_STABLE_ID, TWIN_CARD_STABLE_ID].indexOf(oneRecord.objectStableId) !== -1).map((oneRecord) => oneRecord.subjectStableId)));
			const everySubjectHasBothMembers = subjectList.length > 0 && subjectList.every((subjectStableId) => memberObjectSet.has(`${subjectStableId}\u001f${ORIGINAL_CARD_STABLE_ID}`) && memberObjectSet.has(`${subjectStableId}\u001f${TWIN_CARD_STABLE_ID}`));
			return { pass: everySubjectHasBothMembers, detail: `subjects picking the collapsed card: ${JSON.stringify(subjectList)}; collapsed records ${collapsedRecordList.length}` };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-QUALIFIER-RUN', conjunctId: 'h_collapsedPickFreezesOneRecordPerMember', twinName: 'frameworkKeepsRepresentativeOnly', fileName: FRAMEWORK_FILE, find: 'const memberStableIdList = evidenceRendererLib.memberStableIdListFor({ cardCollapseList: question.cardCollapseList, chosenCardStableId: judged.chosenCardStableId });', replace: 'const memberStableIdList = [judged.chosenCardStableId];' });

const gateDeclarationList = [
	{ gateId: GATE_ID, title: 'CEDS qualifiers render on the judge card; identical cards collapse; a collapsed pick resolves to every member', conjunctList: qualifierConjunctList },
	{ gateId: 'BG-QUALIFIER-RUN', title: 'a collapsed pick freezes one record per member through a real bridge run', conjunctList: runConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-QUALIFIER+BG-QUALIFIER-RUN', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 8 + 1 },
	() => harness.report(),
);
