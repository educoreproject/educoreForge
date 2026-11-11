#!/usr/bin/env node
'use strict';

// test-rosettaMeaningVariant.js — educore WORKORDER-rosettaMeanings-111026 R4: the rosettaMeaning judge prompt variant.
//   (a) every variant that existed before renders BYTE-IDENTICALLY to forge main 9b9f3816 (pinned by commit, never by the name main): the whole
//       renderQuestion result, as JSON, from main's own renderer source compiled beside this one, over each fixture. The forge's judgment cache
//       keys on the rendered text, so a moved byte would orphan paid judgments.
//   (b) rosettaMeaning frames each candidate as a meaning (its property of its class), takes its words from rosettaMeaningPromptText.json, keeps
//       derivedJudgeSlot's data block and predicate rule, and has its own renderer version and promptHash.
//   (c) the renderer registry and the contract's JUDGE_PROMPT_VARIANT_LIST name the same variants.
//
// Run: node lib/bridge-framework/test/test-rosettaMeaningVariant.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- the rosettaMeaning variant, and every older variant byte-identical to main 9b9f3816

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASS;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const Module = require('module');
const childProcess = require('child_process');
const evidenceRendererLib = require('../evidenceRenderer');
const bridgePluginContractLib = require('../bridgePluginContract');
const rosettaMeaningPromptText = require('../rosettaMeaningPromptText.json');

const BASE_COMMIT = '9b9f3816';
const RENDERER_REPO_PATH = 'educoreForge/lib/bridge-framework/evidenceRenderer.js';
const NEW_VARIANT_NAME = 'rosettaMeaning';
const OLD_VARIANT_NAME_LIST = Object.freeze(['crosswalk', 'derived', 'derivedJudgeSlot', 'derivedJudgeSlotOwningDefinition']);
const OLD_JUDGE_RENDER_INPUT = require('./fixtures/jevQuestion/oldJudgeRenderInput.json');
const cloneJson = (value) => JSON.parse(JSON.stringify(value));

// main's renderer, compiled from its own source AS IF it sat in this directory, so its relative requires resolve exactly as the branch's do
const baseRendererLib = (() => {
	const repoRootPath = childProcess.execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: __dirname, encoding: 'utf8' }).trim();
	const baseSourceText = childProcess.execFileSync('git', ['show', `${BASE_COMMIT}:${RENDERER_REPO_PATH}`], { cwd: repoRootPath, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
	const standInFilePath = path.join(__dirname, '..', `evidenceRenderer.base${BASE_COMMIT}.js`);
	const baseModule = new Module(standInFilePath, module);
	baseModule.filename = standInFilePath;
	baseModule.paths = Module._nodeModulePaths(path.dirname(standInFilePath));
	baseModule._compile(baseSourceText, standInFilePath);
	return baseModule.exports;
})();

const shippedBlindingNameList = require('./testSupport/shippedBridge').shippedBridgeDeclarationFor('edfiCedsDerivedPlugin').blindingDeclaration;
const derivedInputFor = ({ judgePromptVariant, cardEditor = (cardList) => cardList, owningConstructDefinition }) => {
	const renderInput = cloneJson(OLD_JUDGE_RENDER_INPUT);
	renderInput.judgePromptVariant = judgePromptVariant;
	renderInput.blindingNameList = shippedBlindingNameList;
	renderInput.candidatePool = cardEditor(renderInput.candidatePool.map((oneSeat) => oneSeat.card)).map((oneCard) => ({ card: oneCard, seatReason: 'retrieval' }));
	if (judgePromptVariant === 'derivedJudgeSlotOwningDefinition') {
		renderInput.sourceElement.owningConstructDefinition = owningConstructDefinition === undefined ? 'A survey to identified or anonymous respondents.' : owningConstructDefinition;
		renderInput.sourceElement.owningConstructDefinitionAbsentReason = null;
	}
	return renderInput;
};
// three pools: as captured; one card qualified and one card duplicated (collapse); no guidance at all
const FIXTURE_ROW_LIST = Object.freeze([
	{ fixtureName: 'captured', cardEditor: (cardList) => cardList, guidanceEditor: (guidanceList) => guidanceList },
	{ fixtureName: 'qualifiedAndDuplicated', cardEditor: (cardList) => [{ ...cardList[0], qualifierNames: ['School Identifier'] }, ...cardList.slice(1), { ...cardList[1], stableId: `${cardList[1].stableId}-twin` }], guidanceEditor: (guidanceList) => guidanceList },
	{ fixtureName: 'noGuidance', cardEditor: (cardList) => cardList, guidanceEditor: () => [] },
]);
const crosswalkInputFor = ({ cardEditor, guidanceEditor }) => {
	const renderInput = cloneJson(OLD_JUDGE_RENDER_INPUT);
	return {
		judgePromptVariant: 'crosswalk',
		sourceElement: { name: renderInput.sourceElement.name, stableId: 'edfi:property/Survey.SurveyCategory', material: renderInput.sourceElement.material, evidence: { subject: { note: 'a subject note' }, assertion: {} }, sourceLabelByColumn: { label: 'Survey category' }, sourceNoteByColumn: {} },
		candidatePool: cardEditor(renderInput.candidatePool.map((oneSeat) => oneSeat.card)).map((oneCard) => ({ card: oneCard, seatReason: 'retrieval' })),
		globalGuidanceList: guidanceEditor(renderInput.globalGuidanceList || []).map((oneLine) => oneLine.replace(/\d{6}/g, '')),
		perCandidateNoteByStableId: {},
		promptSegmentList: [],
	};
};
const inputFor = ({ variantName, fixtureRow }) => {
	if (variantName === 'crosswalk') {
		return crosswalkInputFor(fixtureRow);
	}
	const renderInput = derivedInputFor({ judgePromptVariant: variantName, cardEditor: fixtureRow.cardEditor });
	renderInput.globalGuidanceList = fixtureRow.guidanceEditor(renderInput.globalGuidanceList || []);
	return renderInput;
};

harness.section(`(a) EVERY OLDER VARIANT RENDERS BYTE-IDENTICALLY TO forge ${BASE_COMMIT}`);
harness.equal(`the base renderer at ${BASE_COMMIT} has exactly the older variants`, JSON.stringify(Object.keys(baseRendererLib.JUDGE_PROMPT_VARIANT_REGISTRY).sort()), JSON.stringify(OLD_VARIANT_NAME_LIST.slice().sort()));
OLD_VARIANT_NAME_LIST.forEach((variantName) => FIXTURE_ROW_LIST.forEach((fixtureRow) => {
	const branchRendered = evidenceRendererLib.renderQuestion(inputFor({ variantName, fixtureRow }));
	const baseRendered = baseRendererLib.renderQuestion(inputFor({ variantName, fixtureRow }));
	harness.ok(`${variantName} / ${fixtureRow.fixtureName}: the base renders it`, !baseRendered.error, baseRendered.error && baseRendered.error.message);
	harness.equal(`${variantName} / ${fixtureRow.fixtureName}: the whole result is byte-identical (promptHash ${String(baseRendered.promptHash).slice(0, 12)})`, JSON.stringify(branchRendered), JSON.stringify(baseRendered));
}));
harness.equal('the exported prompt constants are unchanged', JSON.stringify([evidenceRendererLib.SYSTEM_PROMPT, evidenceRendererLib.DERIVED_SYSTEM_PROMPT, evidenceRendererLib.RENDERER_VERSION, evidenceRendererLib.DERIVED_RENDERER_VERSION, evidenceRendererLib.DERIVED_JUDGE_SLOT_RENDERER_VERSION, evidenceRendererLib.DERIVED_JUDGE_SLOT_OWNING_DEFINITION_RENDERER_VERSION]), JSON.stringify([baseRendererLib.SYSTEM_PROMPT, baseRendererLib.DERIVED_SYSTEM_PROMPT, baseRendererLib.RENDERER_VERSION, baseRendererLib.DERIVED_RENDERER_VERSION, baseRendererLib.DERIVED_JUDGE_SLOT_RENDERER_VERSION, baseRendererLib.DERIVED_JUDGE_SLOT_OWNING_DEFINITION_RENDERER_VERSION]));

harness.section('(b) rosettaMeaning: EACH CANDIDATE IS A MEANING, ITS WORDS ARE DATA');
const meaningRendered = evidenceRendererLib.renderQuestion(inputFor({ variantName: NEW_VARIANT_NAME, fixtureRow: FIXTURE_ROW_LIST[0] }));
const slotRendered = evidenceRendererLib.renderQuestion(inputFor({ variantName: 'derivedJudgeSlot', fixtureRow: FIXTURE_ROW_LIST[0] }));
harness.ok('it renders', !meaningRendered.error, meaningRendered.error && meaningRendered.error.message);
const firstCard = OLD_JUDGE_RENDER_INPUT.candidatePool.map((oneSeat) => oneSeat.card).sort((left, right) => (left.stableId < right.stableId ? -1 : 1))[0];
const meaningLineOf = (oneCard) => rosettaMeaningPromptText.meaningLineTemplateWithClass.replace(/\{propertyName\}/g, oneCard.name).replace(/\{className\}/g, oneCard.domainName);
harness.equal('its system prompt is the data file\'s, byte for byte', meaningRendered.systemPrompt.slice(0, rosettaMeaningPromptText.systemPrompt.length), rosettaMeaningPromptText.systemPrompt);
harness.ok('the first candidate is headed by its meaning: its property of its class', meaningRendered.userPrompt.includes(`${rosettaMeaningPromptText.candidateIndexLineTemplate.replace('{seatNumber}', '1')}\n${meaningLineOf(firstCard)}\n`), meaningLineOf(firstCard));
harness.ok('every candidate is headed by a meaning line', (meaningRendered.userPrompt.match(/\n {6}meaning: /g) || []).length === meaningRendered.renderedPoolStableIdList.length, meaningRendered.renderedPoolStableIdList.length);
harness.ok('the question is asked first, in the data file\'s words', meaningRendered.userPrompt.startsWith(rosettaMeaningPromptText.subjectLineList.join('\n')));
harness.ok('the list is introduced in the data file\'s words', meaningRendered.userPrompt.includes(`${rosettaMeaningPromptText.candidateListPreambleLineList.join('\n')}\n${rosettaMeaningPromptText.candidateListHeadingWord} (`));
const dataLinesOf = (userPrompt) => userPrompt.split('\n').filter((oneLine) => /^ {6}[A-Za-z]+: /.test(oneLine) && !/^ {6}meaning: /.test(oneLine));
harness.equal('the candidates\' data lines are derivedJudgeSlot\'s, line for line', JSON.stringify(dataLinesOf(meaningRendered.userPrompt)), JSON.stringify(dataLinesOf(slotRendered.userPrompt)));
harness.equal('the choices are derivedJudgeSlot\'s', JSON.stringify([meaningRendered.renderedPoolStableIdList, meaningRendered.choiceEnum]), JSON.stringify([slotRendered.renderedPoolStableIdList, slotRendered.choiceEnum]));
harness.equal('its renderer version is the data file\'s', meaningRendered.rendererVersion, rosettaMeaningPromptText.rendererVersion);
harness.equal('its predicate rule is judgeSlot-v1, as Rosetta\'s judge asks', meaningRendered.judgePredicateRule, 'judgeSlot-v1');
harness.ok('its promptHash is its own', meaningRendered.promptHash !== slotRendered.promptHash, meaningRendered.promptHash);
const noClassRendered = evidenceRendererLib.renderQuestion(inputFor({ variantName: NEW_VARIANT_NAME, fixtureRow: { fixtureName: 'noClass', cardEditor: (cardList) => cardList.map((oneCard) => ({ ...oneCard, domainName: undefined })), guidanceEditor: (guidanceList) => guidanceList } }));
harness.ok('a card with no class is said as its property alone', !noClassRendered.error && noClassRendered.userPrompt.includes(rosettaMeaningPromptText.meaningLineTemplateWithoutClass.replace(/\{propertyName\}/g, firstCard.name)), noClassRendered.error && noClassRendered.error.message);
const qualifiedRendered = evidenceRendererLib.renderQuestion(inputFor({ variantName: NEW_VARIANT_NAME, fixtureRow: FIXTURE_ROW_LIST[1] }));
harness.ok('a qualified card\'s meaning carries its qualifier, as its rendered name does', !qualifiedRendered.error && /meaning: [^\n]*\(School Identifier\) of /.test(qualifiedRendered.userPrompt), qualifiedRendered.error && qualifiedRendered.error.message);

harness.section('(c) THE REGISTRY AND THE CONTRACT AGREE');
harness.equal('the renderer registry and the contract list name the same variants', JSON.stringify(Object.keys(evidenceRendererLib.JUDGE_PROMPT_VARIANT_REGISTRY).sort()), JSON.stringify(bridgePluginContractLib.JUDGE_PROMPT_VARIANT_LIST.slice().sort()));
harness.equal('no bridge basis selects rosettaMeaning (only educore\'s Rosetta names it)', JSON.stringify(Object.values(bridgePluginContractLib.VARIANT_BY_BASIS_AND_PREDICATE_RULE).flatMap((byRule) => Object.values(byRule)).filter((variantName) => variantName === NEW_VARIANT_NAME)), '[]');

harness.report();
