#!/usr/bin/env node
'use strict';

// test-bgJevQuestion.js — BG-JEVQUESTION: Jev's better choice question (lane JEVQ, cedsRichness-101226, 2026-10-13).
//
// The deep dive (deepDive-101326 §4.3) measured that Jev answers better when the source element carries its owning
// construct's definition and Claude's system prompt is NOT in its state. This suite holds the three things the work order
// names, and the seams that make them true:
//   (a) the owning-definition variant's split question carries the definition and no instructions; its TEXT prompts are
//       derivedJudgeSlot's byte for byte; the definition text keys its promptHash; the relation question's source is the
//       source WITHOUT the definition
//   (b) the old judge (derivedJudgeSlot) renders byte-identically to main 317cba12 (pinned below)
//   (c) a source with no owning definition renders without one and records why; the resolver's refusals are by name
//   (d) the contract: the split question's FORM is declared PER BRIDGE (ruling COPPER_RIVER, 2026-10-13) and picks the variant,
//       with no default form; the owning-definition variant requires owningConstructDefinitionSource, every other variant
//       forbids it, the kinds are checked, and the contract's lists agree with the renderer's rows; the shipped plugins
//       declare what was ruled: Ed-Fi and PESC the owning-definition form, SIF the instruction form
//   (e) the identifier scan reads the split question, where the definition is the only new text
//   (f) end to end: a toy run in the owning-definition form resolves each subject's owner
//   (g) the judge is BOUND to the bridge's form: every question carries the form by name, and every frozen record, the
//       header's judgeKind and the cache rows carry the identity the judge names for that form
//       (judgeClientForChoiceQuestionForm.js)
//
// Every conjunct was observed RED before it was made to pass (DEVLOG-JEVQ.md, "gates observed red").
//
// Run: node lib/bridge-framework/test/test-bgJevQuestion.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-JEVQUESTION, the owning-definition split question for Jev

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASS;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const crypto = require('crypto');
const evidenceRendererLib = require('../evidenceRenderer');
const bridgePluginContractLib = require('../bridgePluginContract');
const owningConstructDefinitionLib = require('../owningConstructDefinition');
const promptIdentifierScanLib = require('../promptIdentifierScan');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const OLD_JUDGE_RENDER_INPUT = require('./fixtures/jevQuestion/oldJudgeRenderInput.json');
const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
const cloneJson = (value) => JSON.parse(JSON.stringify(value));

// PINNED on main 317cba12 (lane QUAL merged, before lane JEVQ), from the fixture above: the whole renderQuestion result as
// JSON, and its promptHash. The old judge must render exactly this. (First pinned on a07ea515 as 842ca8d2…; QUAL added
// cardCollapseList and qualifiedCardStableIdList to the result, re-pinned on the rebase; promptHash did not move.)
const OLD_JUDGE_RESULT_SHA256 = '8ad81534ceadcff2992895478e490c28da67d9c205ac12ef51dc6ece770d2cef';
const OLD_JUDGE_PROMPT_HASH = 'c0a8a9fa7442bb87a086bba61e2fc1e5ca97f0de9d69bbecd644b58bad432d7b';
const NEW_VARIANT_NAME = 'derivedJudgeSlotOwningDefinition';
const NEW_RENDERER_VERSION_LITERAL = 'bridgeEvidenceRenderer-derivedJudgeSlotOwningDefinition-v1';
const SURVEY_DEFINITION = 'A survey to identified or anonymous respondents.';

const renderInputFor = ({ judgePromptVariant, owningConstructDefinition, owningConstructDefinitionAbsentReason }) => {
	const renderInput = cloneJson(OLD_JUDGE_RENDER_INPUT);
	renderInput.judgePromptVariant = judgePromptVariant;
	// ⟪R3⟫ the shipped Ed-Fi bridge's blinding list (the captured input predates the parameter; it changes no rendered byte)
	renderInput.blindingNameList = require('./testSupport/shippedBridge').shippedBridgeDeclarationFor('edfiCedsDerivedPlugin').blindingDeclaration;
	if (owningConstructDefinition !== undefined) {
		renderInput.sourceElement.owningConstructDefinition = owningConstructDefinition;
		renderInput.sourceElement.owningConstructDefinitionAbsentReason = owningConstructDefinitionAbsentReason;
	}
	return renderInput;
};
const renderedOrNull = (renderInput) => {
	const rendered = evidenceRendererLib.renderQuestion(renderInput);
	return rendered.error ? null : rendered;
};

harness.section('(b) THE OLD JUDGE RENDERS BYTE-IDENTICALLY TO main 317cba12');
const oldRendered = evidenceRendererLib.renderQuestion(renderInputFor({ judgePromptVariant: 'derivedJudgeSlot' }));
harness.ok('the old variant renders', !oldRendered.error, oldRendered.error && oldRendered.error.message);
harness.equal('the whole result, as JSON, hashes to the pin', sha256(JSON.stringify(oldRendered)), OLD_JUDGE_RESULT_SHA256);
harness.equal('its promptHash is the pinned one', oldRendered.promptHash, OLD_JUDGE_PROMPT_HASH);
harness.equal('its split state is still { matchingInstructions: <system prompt>, sourceElement }', Object.keys(oldRendered.choiceQuestion.stateObject).join(','), 'matchingInstructions,sourceElement');
harness.equal('its split question carries no form stamp', Object.prototype.hasOwnProperty.call(oldRendered.choiceQuestion, 'questionFormName'), false);
harness.equal('its result carries no owningConstructDefinitionRecord', Object.prototype.hasOwnProperty.call(oldRendered, 'owningConstructDefinitionRecord'), false);

harness.section('(a) THE OWNING-DEFINITION VARIANT: DEFINITION IN, INSTRUCTIONS OUT, TEXT UNCHANGED');
const newRendered = renderedOrNull(renderInputFor({ judgePromptVariant: NEW_VARIANT_NAME, owningConstructDefinition: SURVEY_DEFINITION, owningConstructDefinitionAbsentReason: null }));
harness.ok('the new variant renders', newRendered !== null);
const newState = newRendered ? newRendered.choiceQuestion.stateObject : {};
harness.equal('the state is exactly { sourceElement }: matchingInstructions is gone', Object.keys(newState).join(','), 'sourceElement');
harness.equal('the source element carries the owning construct definition, as its last member', newState.sourceElement && Object.keys(newState.sourceElement).slice(-1)[0] + '=' + newState.sourceElement.owningConstructDefinition, `owningConstructDefinition=${SURVEY_DEFINITION}`);
harness.equal('…and otherwise the same allow-listed members, in the same order, as the old state', newState.sourceElement && JSON.stringify({ ...newState.sourceElement, owningConstructDefinition: undefined }), JSON.stringify(oldRendered.choiceQuestion.stateObject.sourceElement));
harness.equal('the question is stamped with its form', newRendered && newRendered.choiceQuestion.questionFormName, evidenceRendererLib.CHOICE_QUESTION_FORM_NAME_OWNING_DEFINITION_STATE);
harness.equal('the relation question source is the source WITHOUT the definition (the relation question is unchanged)', newRendered && JSON.stringify(newRendered.choiceQuestion.relationStateSourceElement), JSON.stringify(oldRendered.choiceQuestion.stateObject.sourceElement));
harness.equal('the instruction text and the candidates are the old ones', newRendered && JSON.stringify([newRendered.choiceQuestion.instructionText, newRendered.choiceQuestion.criteriaByChoice]), JSON.stringify([oldRendered.choiceQuestion.instructionText, oldRendered.choiceQuestion.criteriaByChoice]));
harness.equal('the SYSTEM prompt is the old one byte for byte (every text judge reads the same)', newRendered && newRendered.systemPrompt, oldRendered.systemPrompt);
harness.equal('the USER prompt is the old one byte for byte', newRendered && newRendered.userPrompt, oldRendered.userPrompt);
harness.equal('its renderer version is its own', newRendered && newRendered.rendererVersion, NEW_RENDERER_VERSION_LITERAL);
harness.equal('its predicate rule is still judgeSlot-v1', newRendered && newRendered.judgePredicateRule, 'judgeSlot-v1');
harness.ok('its promptHash is not the old one (new cache keys)', newRendered && newRendered.promptHash !== oldRendered.promptHash, newRendered && newRendered.promptHash);
const rewordedRendered = renderedOrNull(renderInputFor({ judgePromptVariant: NEW_VARIANT_NAME, owningConstructDefinition: `${SURVEY_DEFINITION} Reworded.`, owningConstructDefinitionAbsentReason: null }));
harness.ok('rewording ONLY the definition moves the promptHash (the definition text keys the cache)', rewordedRendered && newRendered && rewordedRendered.promptHash !== newRendered.promptHash && rewordedRendered.userPrompt === newRendered.userPrompt, rewordedRendered && rewordedRendered.promptHash);
harness.equal('the record says the definition was rendered', newRendered && JSON.stringify(newRendered.owningConstructDefinitionRecord), JSON.stringify({ rendered: true, absentReason: null }));

harness.section('(c) NO OWNING DEFINITION: NONE RENDERED, AND WHY IS RECORDED');
const absentReasonText = 'declaredNone: SIF 260928 publishes no definition text for its objects';
const absentRendered = renderedOrNull(renderInputFor({ judgePromptVariant: NEW_VARIANT_NAME, owningConstructDefinition: null, owningConstructDefinitionAbsentReason: absentReasonText }));
harness.ok('it renders', absentRendered !== null);
harness.equal('the state source element carries no owningConstructDefinition member at all', absentRendered && Object.prototype.hasOwnProperty.call(absentRendered.choiceQuestion.stateObject.sourceElement, 'owningConstructDefinition'), false);
harness.equal('…and still no matchingInstructions', absentRendered && Object.keys(absentRendered.choiceQuestion.stateObject).join(','), 'sourceElement');
harness.equal('the record says none was rendered, and why', absentRendered && JSON.stringify(absentRendered.owningConstructDefinitionRecord), JSON.stringify({ rendered: false, absentReason: absentReasonText }));
const refusalTextFor = (renderInput) => {
	const rendered = evidenceRendererLib.renderQuestion(renderInput);
	return rendered.error ? rendered.error.message : '';
};
harness.match('the new variant with neither the text nor a reason is refused by name', refusalTextFor(renderInputFor({ judgePromptVariant: NEW_VARIANT_NAME })), /needs the source element to carry owningConstructDefinition \(text\) or owningConstructDefinitionAbsentReason/);
harness.match('…with both is refused by name', refusalTextFor(renderInputFor({ judgePromptVariant: NEW_VARIANT_NAME, owningConstructDefinition: SURVEY_DEFINITION, owningConstructDefinitionAbsentReason: 'x' })), /exactly one, the other null/);
harness.match('…with a blank text and no reason is refused by name', refusalTextFor(renderInputFor({ judgePromptVariant: NEW_VARIANT_NAME, owningConstructDefinition: '  ', owningConstructDefinitionAbsentReason: null })), /exactly one, the other null/);
harness.match('the OLD variant handed a definition refuses it rather than dropping it silently', refusalTextFor(renderInputFor({ judgePromptVariant: 'derivedJudgeSlot', owningConstructDefinition: SURVEY_DEFINITION, owningConstructDefinitionAbsentReason: null })), /does not render an owning-construct definition, and the source element carries one/);

// the resolver, over a small node set shaped like the forge's (stableId + properties)
const nodeByStableId = {
	'edfi:domainEntity/Survey': { stableId: 'edfi:domainEntity/Survey', properties: { name: 'Survey', description: `  ${SURVEY_DEFINITION}  ` } },
	'edfi:domainEntityExtension/Student': { stableId: 'edfi:domainEntityExtension/Student', properties: { name: 'Student', description: null } },
	'edfi:property/Survey.SurveyCategory': { stableId: 'edfi:property/Survey.SurveyCategory', properties: { name: 'SurveyCategory', parentId: 'edfi:domainEntity/Survey' } },
	'edfi:property/StudentExt.Thing': { stableId: 'edfi:property/StudentExt.Thing', properties: { name: 'Thing', parentId: 'edfi:domainEntityExtension/Student' } },
	'edfi:property/Orphan.Thing': { stableId: 'edfi:property/Orphan.Thing', properties: { name: 'Thing', parentId: 'edfi:domainEntity/NotThere' } },
	'edfi:property/NoParent.Thing': { stableId: 'edfi:property/NoParent.Thing', properties: { name: 'Thing' } },
};
const OWNER_SOURCE = Object.freeze({ kind: 'ownerNodeProperty', ownerReferencePropertyName: 'parentId', definitionPropertyName: 'description' });
const resolvedFor = (subjectStableId, owningConstructDefinitionSource) => owningConstructDefinitionLib.owningConstructDefinitionFor({ subjectNode: nodeByStableId[subjectStableId], subjectNodeByStableId: nodeByStableId, owningConstructDefinitionSource });
harness.equal('ownerNodeProperty: the owner\'s definition, trimmed', JSON.stringify(resolvedFor('edfi:property/Survey.SurveyCategory', OWNER_SOURCE)), JSON.stringify({ owningConstructDefinition: SURVEY_DEFINITION, absentReason: null }));
harness.equal('ownerNodeProperty: an owner without the text gives none and the reason (never borrowed from a same-named node)', JSON.stringify(resolvedFor('edfi:property/StudentExt.Thing', OWNER_SOURCE)), JSON.stringify({ owningConstructDefinition: null, absentReason: owningConstructDefinitionLib.ABSENT_REASON_OWNER_HAS_NO_DEFINITION }));
harness.equal('none: every subject gives none, under the declared reason', JSON.stringify(resolvedFor('edfi:property/Survey.SurveyCategory', { kind: 'none', reason: 'no definitions published' })), JSON.stringify({ owningConstructDefinition: null, absentReason: 'declaredNone: no definitions published' }));
const resolverRefusalFor = (subjectStableId, owningConstructDefinitionSource) => {
	const resolved = resolvedFor(subjectStableId, owningConstructDefinitionSource);
	return resolved.error ? resolved.error.message : '';
};
harness.match('an owner reference naming no node is refused by name', resolverRefusalFor('edfi:property/Orphan.Thing', OWNER_SOURCE), /names owner 'edfi:domainEntity\/NotThere', which is not a node of the source standard/);
harness.match('a subject without the owner reference is refused by name', resolverRefusalFor('edfi:property/NoParent.Thing', OWNER_SOURCE), /carries no 'parentId'/);

harness.section('(d) THE CONTRACT: REQUIRED FOR THE VARIANT, FORBIDDEN ELSEWHERE, KINDS CHECKED');
const rowRequiringVariantList = Object.keys(evidenceRendererLib.JUDGE_PROMPT_VARIANT_REGISTRY).filter((variantName) => evidenceRendererLib.JUDGE_PROMPT_VARIANT_REGISTRY[variantName].requiresOwningConstructDefinitionSource === true).sort();
harness.equal('the contract\'s OWNING_CONSTRUCT_DEFINITION_VARIANT_LIST is exactly the renderer rows that require it', JSON.stringify(bridgePluginContractLib.OWNING_CONSTRUCT_DEFINITION_VARIANT_LIST.slice().sort()), JSON.stringify(rowRequiringVariantList));
harness.equal('every renderer row says whether it requires it (no row leaves it undefined)', Object.keys(evidenceRendererLib.JUDGE_PROMPT_VARIANT_REGISTRY).filter((variantName) => typeof evidenceRendererLib.JUDGE_PROMPT_VARIANT_REGISTRY[variantName].requiresOwningConstructDefinitionSource !== 'boolean').join(','), '');
harness.equal('the renderer registry and the contract list name the same variants', JSON.stringify(Object.keys(evidenceRendererLib.JUDGE_PROMPT_VARIANT_REGISTRY).sort()), JSON.stringify(bridgePluginContractLib.JUDGE_PROMPT_VARIANT_LIST.slice().sort()));
harness.equal('(derived, judgeSlot-v1) names the base variant derivedJudgeSlot, as before the lane', bridgePluginContractLib.VARIANT_BY_BASIS_AND_PREDICATE_RULE.derived['judgeSlot-v1'], 'derivedJudgeSlot');
const formRowFaultList = Object.keys(bridgePluginContractLib.VARIANT_BY_CHOICE_QUESTION_FORM).reduce((soFar, baseVariantName) => {
	const variantByForm = bridgePluginContractLib.VARIANT_BY_CHOICE_QUESTION_FORM[baseVariantName];
	return soFar.concat(Object.keys(variantByForm).filter((formName) => (evidenceRendererLib.JUDGE_PROMPT_VARIANT_REGISTRY[variantByForm[formName]] || {}).choiceQuestionFormName !== formName).map((formName) => `${baseVariantName}.${formName} -> ${variantByForm[formName]}`));
}, []);
harness.equal('every form the contract maps names a renderer row that builds THAT form', formRowFaultList.join(', '), '');
harness.equal('the contract\'s form list is the renderer\'s', JSON.stringify(bridgePluginContractLib.CHOICE_QUESTION_FORM_NAME_LIST.slice().sort()), JSON.stringify(evidenceRendererLib.CHOICE_QUESTION_FORM_NAME_LIST.slice().sort()));
const variantOrErrorFor = (bridgeDeclaration) => {
	const resolved = bridgePluginContractLib.judgePromptVariantFor({ bridgeDeclaration });
	return resolved.error ? `ERROR ${resolved.error}` : resolved.judgePromptVariant;
};
const edfiBundleDirPath = path.join(TREE_ROOT, 'forges', 'edfi');
const { shippedBridgeDeclarationFor } = require('./testSupport/shippedBridge');
const edfiDeclaration = () => shippedBridgeDeclarationFor('edfiCedsDerivedPlugin');
const validationRefusalFor = (bridgeDeclaration) => {
	const validated = bridgePluginContractLib.validateBridgeDeclaration({ bridgeDeclaration, bundleDirPath: edfiBundleDirPath });
	return validated && validated.error ? validated.error.message : '';
};
harness.equal('the shipped Ed-Fi declaration validates', validationRefusalFor(edfiDeclaration()), '');
harness.equal('the owning-definition form resolves to the owning-definition variant', variantOrErrorFor(edfiDeclaration()), NEW_VARIANT_NAME);
const instructionFormDeclaration = edfiDeclaration();
instructionFormDeclaration.choiceQuestionFormName = 'matchingInstructionsState';
harness.equal('the instruction form resolves to derivedJudgeSlot', variantOrErrorFor(instructionFormDeclaration), 'derivedJudgeSlot');
const formlessDeclaration = edfiDeclaration();
delete formlessDeclaration.choiceQuestionFormName;
harness.match('a judgeSlot-v1 derived declaration that names NO form is refused (no default form)', variantOrErrorFor(formlessDeclaration), /^ERROR resolves to 'derivedJudgeSlot', whose split question has forms matchingInstructionsState, owningConstructDefinitionState, and declares choiceQuestionFormName undefined; declare one of them \(per bridge, no default\)/);
harness.match('…and registration refuses it by name', validationRefusalFor(formlessDeclaration), /declares choiceQuestionFormName undefined/);
const unknownFormDeclaration = edfiDeclaration();
unknownFormDeclaration.choiceQuestionFormName = 'claudePrompt';
harness.match('an unknown form is refused at registration, listing the forms', validationRefusalFor(unknownFormDeclaration), /choiceQuestionFormName.*claudePrompt/);
const formOnSingleFormVariant = edfiDeclaration();
formOnSingleFormVariant.predicateSource = { kind: 'judge', predicateRule: 'categoryTable-v1' };
formOnSingleFormVariant.predicateByCategory = { strong: 'exactMatch', moderate: 'closeMatch', weakButReal: 'closeMatch' };
formOnSingleFormVariant.judgePromptVariant = 'derived';
delete formOnSingleFormVariant.owningConstructDefinitionSource;
harness.match('a form declared on a single-form variant is refused (it would be read by nothing)', variantOrErrorFor(formOnSingleFormVariant), /^ERROR declares choiceQuestionFormName 'owningConstructDefinitionState', and its variant 'derived' has one form only/);
const withoutSource = edfiDeclaration();
delete withoutSource.owningConstructDefinitionSource;
harness.match('a judgeSlot-v1 derived declaration WITHOUT owningConstructDefinitionSource is refused by name', validationRefusalFor(withoutSource), /resolves to variant 'derivedJudgeSlotOwningDefinition', which renders the owning construct's definition, and declares no owningConstructDefinitionSource/);
const onCategoryTable = edfiDeclaration();
onCategoryTable.predicateSource = { kind: 'judge', predicateRule: 'categoryTable-v1' };
onCategoryTable.predicateByCategory = { strong: 'exactMatch', moderate: 'closeMatch', weakButReal: 'closeMatch' };
onCategoryTable.judgePromptVariant = 'derived';
delete onCategoryTable.choiceQuestionFormName;
harness.match('a declaration whose variant does not render it, carrying it, is refused by name', validationRefusalFor(onCategoryTable), /declares owningConstructDefinitionSource, and its variant 'derived' does not render an owning-construct definition/);
harness.match('an unknown kind is refused listing the kinds', owningConstructDefinitionLib.owningConstructDefinitionSourceReason({ kind: 'borrowByName' }), /kind "borrowByName" is not one of ownerNodeProperty, none/);
harness.match('kind none without a reason is refused', owningConstructDefinitionLib.owningConstructDefinitionSourceReason({ kind: 'none' }), /needs a non-blank reason/);
harness.match('a stray member is refused by name', owningConstructDefinitionLib.owningConstructDefinitionSourceReason({ ...OWNER_SOURCE, fallbackPropertyName: 'documentation' }), /carries undeclared member\(s\) fallbackPropertyName/);
harness.match('ownerNodeProperty without its property names is refused', owningConstructDefinitionLib.owningConstructDefinitionSourceReason({ kind: 'ownerNodeProperty', ownerReferencePropertyName: 'parentId' }), /needs a non-blank ownerReferencePropertyName and definitionPropertyName/);
// ruling COPPER_RIVER 2026-10-13: Ed-Fi and every per-release PESC bridge take the owning-definition form and read the owner's
// description; SIF keeps the instruction form, so it declares no source (its variant would read none)
const SHIPPED_SOURCE_BY_BRIDGE_NAME = {
	edfiCedsDerivedPlugin: OWNER_SOURCE,
	sif260928CedsDerivedPlugin: null,
	pescCollegeTranscript1v8v0CedsDerivedPlugin: OWNER_SOURCE,
	pescCollegeTranscript1v7v0CedsDerivedPlugin: OWNER_SOURCE,
	pescHighSchoolTranscript1v6v0CedsDerivedPlugin: OWNER_SOURCE,
	pescTestScoreReport1v1v0CedsDerivedPlugin: OWNER_SOURCE,
	pescLearningRecord1v0v0CedsDerivedPlugin: OWNER_SOURCE,
	pescDocumentRequest1v0v0CedsDerivedPlugin: OWNER_SOURCE,
	pescDocumentResponse1v0v0CedsDerivedPlugin: OWNER_SOURCE,
	pescAcademicEportfolio1v0v0CedsDerivedPlugin: OWNER_SOURCE,
};
const shippedFaultList = Object.keys(SHIPPED_SOURCE_BY_BRIDGE_NAME).map((bridgeName) => {
	const shippedDeclaration = shippedBridgeDeclarationFor(bridgeName);
	const expected = SHIPPED_SOURCE_BY_BRIDGE_NAME[bridgeName];
	const declared = shippedDeclaration.owningConstructDefinitionSource;
	const expectedFormName = expected === null ? 'matchingInstructionsState' : 'owningConstructDefinitionState';
	const sourceAgrees = expected === null ? declared === undefined : declared !== undefined && Object.keys(expected).every((memberName) => declared[memberName] === expected[memberName]) && owningConstructDefinitionLib.owningConstructDefinitionSourceReason(declared) === '';
	return sourceAgrees && shippedDeclaration.choiceQuestionFormName === expectedFormName ? null : `${bridgeName}: form ${JSON.stringify(shippedDeclaration.choiceQuestionFormName)}, source ${JSON.stringify(declared)}`;
}).filter((oneFault) => oneFault !== null);
harness.equal('the ten shipped judgeSlot plugins declare what was ruled: Ed-Fi and PESC the owning-definition form reading parentId.description, SIF the instruction form and no source', shippedFaultList.join(' | '), '');

harness.section('(e) THE IDENTIFIER SCAN READS THE SPLIT QUESTION');
const { compiledScan } = promptIdentifierScanLib.compileScan({ scanDeclaration: { identifierPatternList: [{ patternName: 'cedsPropertyId', regexSource: 'P\\d{6}' }] }, identifierList: null });
const leakingRendered = renderedOrNull(renderInputFor({ judgePromptVariant: NEW_VARIANT_NAME, owningConstructDefinition: `${SURVEY_DEFINITION} See P000206.`, owningConstructDefinitionAbsentReason: null }));
const leakScan = leakingRendered ? promptIdentifierScanLib.scanSurfaces({ compiledScan, surfaceTextByName: promptIdentifierScanLib.questionSurfaceTextByName({ predicateRule: 'judgeSlot-v1', question: leakingRendered }) }) : { hit: null };
harness.equal('an identifier in the owning definition is a hit, on the choiceQuestionText surface (no text prompt carries it)', leakScan.hit && `${leakScan.hit.surfaceName}:${leakScan.hit.matchedText}`, 'choiceQuestionText:P000206');
const cleanScan = promptIdentifierScanLib.scanSurfaces({ compiledScan, surfaceTextByName: promptIdentifierScanLib.questionSurfaceTextByName({ predicateRule: 'judgeSlot-v1', question: newRendered }) });
harness.equal('the clean question has no hit', cleanScan.hit, null);

harness.section('(f) END TO END THROUGH THE FRAMEWORK: A TOY judgeSlot-v1 RUN RESOLVES EACH SUBJECT\'S OWNER');
// The toy standard's property nodes gain an owner reference to their construct node; Student and School carry a
// definition, Course does not. A capturing judge (the debug judge, wrapped) records the split question each subject reached.
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { blockOf } = require('./testSupport/bridgeTwinFactories');
const debugJudgeLib = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'debugJudge'));
const TOY_DEFINITION_BY_CONSTRUCT_STABLE_ID = Object.freeze({ 'toy:construct/Student': 'A person enrolled in a school.', 'toy:construct/School': 'An institution that teaches students.' });
const toyRunScenario = scenarioLib.makeScenario();
toyRunScenario.spec.bridge = 'toyDerivedPlugin';
toyRunScenario.graph.nodeList = toyRunScenario.graph.nodeList.map((oneNode) => {
	const withModel = oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: 'toy-embed-v1' } };
	if (withModel.labels.indexOf('ToyProperty') !== -1) {
		return { ...withModel, properties: { ...withModel.properties, parentId: `toy:construct/${withModel.properties.owningConstructName}` } };
	}
	return TOY_DEFINITION_BY_CONSTRUCT_STABLE_ID[withModel.stableId] === undefined ? withModel : { ...withModel, properties: { ...withModel.properties, description: TOY_DEFINITION_BY_CONSTRUCT_STABLE_ID[withModel.stableId] } };
});
const toyDerivedDeclaration = cloneJson(require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyDerivedPlugin.js')).bridgeDeclaration);
toyDerivedDeclaration.predicateSource = { kind: 'judge', predicateRule: 'judgeSlot-v1' };
toyDerivedDeclaration.judgePromptVariant = NEW_VARIANT_NAME;
toyDerivedDeclaration.choiceQuestionFormName = 'owningConstructDefinitionState';
toyDerivedDeclaration.owningConstructDefinitionSource = { ...OWNER_SOURCE };
delete toyDerivedDeclaration.predicateByCategory;
toyRunScenario.pluginModuleOverrides.toyDerivedPlugin = { bridgeDeclaration: toyDerivedDeclaration };
const capturedChoiceQuestionList = [];
const capturedFormNameList = [];
const debugJudge = debugJudgeLib({ ruleName: 'digest' });
// (g) a judge whose identity differs by form, as Jev's does: the instruction form keeps the debug judge's own model
const OWNING_FORM_TOY_MODEL = `${debugJudge.model}-owningForm`;
toyRunScenario.judgeClientOverride = {
	...debugJudge,
	modelForChoiceQuestionForm: (choiceQuestionFormName) => ({ model: choiceQuestionFormName === 'owningConstructDefinitionState' ? OWNING_FORM_TOY_MODEL : debugJudge.model }),
	rerank: (rerankOptions, rerankCallback) => {
		capturedChoiceQuestionList.push(rerankOptions.choiceQuestion);
		capturedFormNameList.push(rerankOptions.choiceQuestionFormName);
		debugJudge.rerank(rerankOptions, (rerankError, verdict) => rerankCallback(rerankError, verdict && { ...verdict, model: OWNING_FORM_TOY_MODEL }));
	},
};
scenarioLib.runScenario(toyRunScenario, (unusedError, outcome) => {
	harness.ok('the toy run completes', outcome && !outcome.runError && !outcome.constructionError && !outcome.thrownFromRun, outcome && (outcome.runError || outcome.constructionError || outcome.thrownFromRun));
	const definitionByOwnerName = capturedChoiceQuestionList.reduce((soFar, oneChoiceQuestion) => ({ ...soFar, [oneChoiceQuestion.stateObject.sourceElement.owningConstructName]: oneChoiceQuestion.stateObject.sourceElement.owningConstructDefinition === undefined ? '(none)' : oneChoiceQuestion.stateObject.sourceElement.owningConstructDefinition }), {});
	harness.ok('the judge was asked', capturedChoiceQuestionList.length > 0, capturedChoiceQuestionList.length);
	harness.equal('every question reaching the judge has no matchingInstructions', capturedChoiceQuestionList.filter((oneChoiceQuestion) => Object.prototype.hasOwnProperty.call(oneChoiceQuestion.stateObject, 'matchingInstructions')).length, 0);
	harness.equal('each subject carries ITS owner\'s definition, and the owner without one renders none', JSON.stringify(definitionByOwnerName, Object.keys(definitionByOwnerName).sort()), JSON.stringify({ Course: '(none)', School: TOY_DEFINITION_BY_CONSTRUCT_STABLE_ID['toy:construct/School'], Student: TOY_DEFINITION_BY_CONSTRUCT_STABLE_ID['toy:construct/Student'] }));
	const coverage = outcome && outcome.runReport && outcome.runReport.counts ? outcome.runReport.counts.owningConstructDefinitionCoverage : undefined;
	const courseQuestionCount = capturedChoiceQuestionList.filter((oneChoiceQuestion) => oneChoiceQuestion.stateObject.sourceElement.owningConstructName === 'Course').length;
	harness.equal('the run report counts rendered and absent-by-reason, and they add up to the questions asked', JSON.stringify(coverage), JSON.stringify({ renderedCount: capturedChoiceQuestionList.length - courseQuestionCount, absentCountByReason: { [owningConstructDefinitionLib.ABSENT_REASON_OWNER_HAS_NO_DEFINITION]: courseQuestionCount } }));

	harness.section('(g) THE JUDGE IS BOUND TO THE BRIDGE\'S FORM');
	harness.equal('every question reached the judge with the bridge\'s form, by name', Array.from(new Set(capturedFormNameList)).join(','), 'owningConstructDefinitionState');
	const block = outcome && !outcome.runError ? blockOf(outcome) : { header: {}, decisionRecordList: [] };
	const judgedRecordList = block.decisionRecordList.filter((oneRecord) => oneRecord.judge !== undefined);
	harness.ok('the run froze judged records', judgedRecordList.length > 0, judgedRecordList.length);
	harness.equal('every frozen record names the form\'s identity', Array.from(new Set(judgedRecordList.map((oneRecord) => oneRecord.judge.judgeModel))).join(','), OWNING_FORM_TOY_MODEL);
	harness.equal('the header\'s judgeKind is the form\'s identity', block.header.judgeKind, OWNING_FORM_TOY_MODEL);
	harness.report();
});
