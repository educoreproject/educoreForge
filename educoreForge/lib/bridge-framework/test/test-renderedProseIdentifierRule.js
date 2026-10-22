#!/usr/bin/env node
'use strict';

// test-renderedProseIdentifierRule.js — zeroBacklog lane B2 (R3-F2; ruling Q-Z10, BRONZE_CROWN 2026-10-22): a hub's OWN prose may cite
// the hub's own identifiers ("Subclasses of ceterms:Credential …": 402 CTDL cards' domainDefinition and 24 cards' propertyDefinition,
// measured on GOLD_EVAL_261021_ctdlHub), and the hub's own identifier scan refuses any such CURIE in a prompt. The hub declares
// renderedProseIdentifierRule { patternSource, replacementTemplate } for its OWN cards; the composer carries it into a bridge
// declaration only when the hub declares one; the renderer applies it to CANDIDATE values only; the scan still scans everything.
//
// PROVES:
//   (i)   a CTDL card whose prose cites ceterms: CURIEs: the CTDL scan REFUSES the rendered question without the rule and ADMITS it
//         with the rule, which reads "Subclasses of Credential"; the split question (choiceQuestion) is rewritten the same way
//   (ii)  a CEDS card question renders byte-identically (promptHash equal to the literal pinned at the pre-B2 code) with the rule
//         absent and with it null
//   (iii) the contracts: CTDL declares a rule, CEDS declares null; a rule with an unknown member, a missing member or a non-string
//         member is refused BY NAME by the hub contract and by the plugin contract; the composer carries the rule into the
//         edfi→ctdl declaration (the R3 overlay fixture's pair) and into no edfi→ceds declaration
//   (iv)  a SUBJECT carrying a ceterms: CURIE still refuses with the rule set (the subject side is never rewritten)

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: a hub's renderedProseIdentifierRule rewrites its own candidate prose, and nothing else (lane B2)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');
const OVERLAY_FIXTURE_DIR_PATH = path.join(TREE_ROOT, 'apps', 'graph-builder', 'test', 'fixtures', 'deCedsPcOverlay');
const hubBridgingContractLib = require('../hubBridgingContract');
const hubBridgingLoaderLib = require('../hubBridgingLoader');
const bridgeComposerLib = require('../bridgeComposer');
const bridgePluginContractLib = require('../bridgePluginContract');
const evidenceRendererLib = require('../evidenceRenderer');
const promptIdentifierScanLib = require('../promptIdentifierScan');

// the CEDS promptHash of the question below, rendered at main 15d0fb67 (before B2), per variant: B2 must not move a CEDS byte
const PRE_B2_CEDS_PROMPT_HASH_BY_VARIANT = Object.freeze({
	derived: 'fee6a7053c5f7854f92cc30ee8476a8c3cb3d9ec9936818a28a82fcfde603dfa',
	derivedJudgeSlot: 'efb1e381aa6e10f483966fe105a6d09526b5a7dd8992b8be9a574163974e52cb',
});
const JUDGE_SLOT_PREDICATE_RULE = 'judgeSlot-v1';
const CTDL_CURIE_TEXT_RE = /\b(?:ceterms|ceasn|qdata):/;

const cedsLoaded = hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: 'ceds' });
const ctdlLoaded = hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: 'ctdl' });
harness.ok('both hub bridging declarations load', !cedsLoaded.error && !ctdlLoaded.error, [cedsLoaded.error, ctdlLoaded.error].filter(Boolean).map((oneError) => oneError.message).join(' | '));
if (cedsLoaded.error || ctdlLoaded.error) {
	harness.report();
	return;
}
const cedsHubBridging = cedsLoaded.hubBridging;
const ctdlHubBridging = ctdlLoaded.hubBridging;
const ctdlRule = ctdlHubBridging.renderedProseIdentifierRule;

const scanHitFor = ({ hubBridging, question }) => {
	const { compiledScan } = promptIdentifierScanLib.compileScan({ scanDeclaration: hubBridging.promptIdentifierScan, identifierList: null });
	return promptIdentifierScanLib.scanSurfaces({ compiledScan, surfaceTextByName: promptIdentifierScanLib.questionSurfaceTextByName({ predicateRule: JUDGE_SLOT_PREDICATE_RULE, question: { ...question, toolCandidateNoun: hubBridging.judgeWording.toolCandidateNoun } }) }).hit;
};

// ------------------------------------------------------------------ (i) the CTDL card
harness.section('(i) CTDL prose that cites CTDL CURIEs: refused without the rule, admitted with it');
const ctdlQuestionInput = {
	sourceElement: { name: 'DegreeTitle', description: 'The title of the degree conferred.', material: { name: 'DegreeTitle' } },
	candidatePool: [
		{ card: { stableId: 'https://w3id.org/EDUcore/CTDL/hub/Release 20260327/card/1', name: 'Name', domainName: 'Credential', domainDefinition: 'Subclasses of ceterms:Credential, such as ceterms:Degree and ceterms:Badge.', propertyDefinition: 'The name or title of this resource; see also ceterms:alternateName.' }, seatReason: 'retrieval' },
		{ card: { stableId: 'https://w3id.org/EDUcore/CTDL/hub/Release 20260327/card/2', name: 'Description', domainName: 'Credential', domainDefinition: 'A qualification.', propertyDefinition: 'A statement about the resource.' }, seatReason: 'retrieval' },
	],
	globalGuidanceList: [],
	perCandidateNoteByStableId: {},
	promptSegmentList: [],
	judgePromptVariant: 'derivedJudgeSlot',
	renderingAllowList: { subject: ['name', 'description'], candidate: ctdlHubBridging.candidateRenderingAllowList.slice() },
	blindingNameList: ['crossRefs'],
};
const unruledQuestion = evidenceRendererLib.renderQuestion({ ...ctdlQuestionInput, renderedProseIdentifierRule: null });
harness.ok('without the rule the question renders', !unruledQuestion.error, unruledQuestion.error && unruledQuestion.error.message);
const unruledHit = unruledQuestion.error ? null : scanHitFor({ hubBridging: ctdlHubBridging, question: unruledQuestion });
harness.ok('RED: without the rule the CTDL scan refuses the question on a CTDL CURIE', unruledHit !== null && unruledHit.patternName === 'ctdlTermCurie', JSON.stringify(unruledHit));
const ruledQuestion = evidenceRendererLib.renderQuestion({ ...ctdlQuestionInput, renderedProseIdentifierRule: ctdlRule });
harness.ok('with the rule the question renders', !ruledQuestion.error, ruledQuestion.error && ruledQuestion.error.message);
const ruledHit = ruledQuestion.error ? 'not rendered' : scanHitFor({ hubBridging: ctdlHubBridging, question: ruledQuestion });
harness.ok('with the rule the CTDL scan admits the question', ruledHit === null, JSON.stringify(ruledHit));
harness.ok('the prose reads "Subclasses of Credential, such as Degree and Badge."', !ruledQuestion.error && ruledQuestion.userPrompt.indexOf('Subclasses of Credential, such as Degree and Badge.') !== -1);
harness.ok('the propertyDefinition reads "see also alternateName"', !ruledQuestion.error && ruledQuestion.userPrompt.indexOf('see also alternateName.') !== -1);
harness.ok('the split question (choiceQuestion) is built and carries no CTDL CURIE', !ruledQuestion.error && ruledQuestion.choiceQuestion !== undefined && !CTDL_CURIE_TEXT_RE.test(JSON.stringify(ruledQuestion.choiceQuestion)));
harness.ok('the rule changes the promptHash (no cached answer to the unruled question can serve the ruled one)', !ruledQuestion.error && !unruledQuestion.error && ruledQuestion.promptHash !== unruledQuestion.promptHash);

// ------------------------------------------------------------------ (ii) the CEDS card
harness.section('(ii) a CEDS question is byte-identical to the pre-B2 rendering');
const cedsQuestionInput = {
	sourceElement: { name: 'FirstName', description: 'The first name of a person.', material: { name: 'FirstName' } },
	candidatePool: [
		{ card: { stableId: 'https://w3id.org/CEDStandards/hub/x/1', name: 'First Name', propertyDefinition: 'The full legal first name given to a person at birth.', domainName: 'Person', domainDefinition: 'A human being.' }, seatReason: 'retrieval' },
		{ card: { stableId: 'https://w3id.org/CEDStandards/hub/x/2', name: 'Middle Name', propertyDefinition: 'A secondary name.', domainName: 'Person', domainDefinition: 'A human being.' }, seatReason: 'retrieval' },
	],
	globalGuidanceList: [],
	perCandidateNoteByStableId: {},
	promptSegmentList: [],
	renderingAllowList: { subject: ['name', 'description'], candidate: cedsHubBridging.candidateRenderingAllowList.slice() },
	blindingNameList: cedsHubBridging.sourceAnchorBlindingNameList.slice(),
};
Object.keys(PRE_B2_CEDS_PROMPT_HASH_BY_VARIANT).forEach((variantName) => {
	const absentQuestion = evidenceRendererLib.renderQuestion({ ...cedsQuestionInput, judgePromptVariant: variantName });
	const nullQuestion = evidenceRendererLib.renderQuestion({ ...cedsQuestionInput, judgePromptVariant: variantName, renderedProseIdentifierRule: cedsHubBridging.renderedProseIdentifierRule });
	harness.equal(`${variantName}: the rule absent, the promptHash is the pre-B2 one`, absentQuestion.promptHash, PRE_B2_CEDS_PROMPT_HASH_BY_VARIANT[variantName]);
	harness.equal(`${variantName}: the CEDS hub's rule (null), the promptHash is the pre-B2 one`, nullQuestion.promptHash, PRE_B2_CEDS_PROMPT_HASH_BY_VARIANT[variantName]);
});

// ------------------------------------------------------------------ (iii) the contracts and the composer
harness.section('(iii) the hub contract, the plugin contract, the composer');
harness.ok('CTDL declares a rule { patternSource, replacementTemplate }', ctdlRule !== null && typeof ctdlRule === 'object' && Object.keys(ctdlRule).sort().join(',') === 'patternSource,replacementTemplate', JSON.stringify(ctdlRule));
harness.ok('CEDS declares the rule as null (it has none; the contract takes no omission)', Object.prototype.hasOwnProperty.call(cedsHubBridging, 'renderedProseIdentifierRule') && cedsHubBridging.renderedProseIdentifierRule === null);
harness.ok('both hub declarations validate', hubBridgingContractLib.validateHubBridging({ hubBridging: cedsHubBridging }) === null && hubBridgingContractLib.validateHubBridging({ hubBridging: ctdlHubBridging }) === null);
const hubRefusalTextOf = (renderedProseIdentifierRule) => String((hubBridgingContractLib.validateHubBridging({ hubBridging: { ...ctdlHubBridging, renderedProseIdentifierRule } }) || {}).message);
const BAD_RULE_CASE_LIST = [
	{ caseName: 'an unknown member', rule: { ...(ctdlRule || {}), flags: 'i' } },
	{ caseName: 'a missing replacementTemplate', rule: { patternSource: (ctdlRule || {}).patternSource } },
	{ caseName: 'a non-string patternSource', rule: { patternSource: 7, replacementTemplate: '$1' } },
	{ caseName: 'an empty patternSource', rule: { patternSource: '', replacementTemplate: '$1' } },
	{ caseName: 'a list in place of the object', rule: ['x'] },
];
BAD_RULE_CASE_LIST.forEach((oneCase) => harness.match(`hub contract: ${oneCase.caseName} is refused naming renderedProseIdentifierRule`, hubRefusalTextOf(oneCase.rule), /hub bridging key 'renderedProseIdentifierRule' /));

const composeFixtureEdfi = () => {
	const fixtureModule = require(path.join(OVERLAY_FIXTURE_DIR_PATH, 'edfi', 'bridges', 'edfiBridging.js'));
	return bridgeComposerLib.composePluginModuleList({ standardBridging: fixtureModule.standardBridging, bridgeHooksByFacetName: fixtureModule.bridgeHooksByFacetName, hubBridgingByToken: { ceds: cedsHubBridging, ctdl: ctdlHubBridging }, bundleDirName: 'edfi' });
};
const composed = composeFixtureEdfi();
harness.ok('the overlay fixture\'s edfi bridging composes against both hubs', !composed.error, composed.error && composed.error.message);
const composedByHub = (composed.pluginModuleList || []).reduce((soFar, onePluginModule) => ({ ...soFar, [onePluginModule.bridgeTarget.targetHub]: onePluginModule.bridgeDeclaration }), {});
harness.ok('edfi→ctdl carries the CTDL rule, equal to the hub\'s', composedByHub.ctdl !== undefined && JSON.stringify(composedByHub.ctdl.renderedProseIdentifierRule) === JSON.stringify(ctdlRule));
harness.ok('edfi→ceds carries no renderedProseIdentifierRule key at all (its digest cannot move)', composedByHub.ceds !== undefined && !Object.prototype.hasOwnProperty.call(composedByHub.ceds, 'renderedProseIdentifierRule'));
// a DECLARED bridge toward the same hub renders nothing, so it composes no rule (its frozen digest is P-a1's; observed red when the
// composer carried the rule for every bridge toward a ruled hub: goldCtdlHub and ctdlFamilyDeclared failed P-a1)
const ctdlasnModule = require(path.join(FORGES_DIR_PATH, 'ctdlasn', 'bridges', 'ctdlasnBridging.js'));
const ctdlasnComposed = bridgeComposerLib.composePluginModuleList({ standardBridging: ctdlasnModule.standardBridging, bridgeHooksByFacetName: ctdlasnModule.bridgeHooksByFacetName, hubBridgingByToken: { ceds: cedsHubBridging, ctdl: ctdlHubBridging }, bundleDirName: 'ctdlasn' });
harness.ok('the declared ctdlasn→ctdl bridge composes with no renderedProseIdentifierRule key', !ctdlasnComposed.error && ctdlasnComposed.pluginModuleList.length > 0 && ctdlasnComposed.pluginModuleList.every((onePluginModule) => !Object.prototype.hasOwnProperty.call(onePluginModule.bridgeDeclaration, 'renderedProseIdentifierRule')), ctdlasnComposed.error && ctdlasnComposed.error.message);
const pluginRefusalTextOf = (renderedProseIdentifierRule) => {
	const validated = bridgePluginContractLib.validateBridgeDeclaration({ bridgeDeclaration: { ...composedByHub.ctdl, renderedProseIdentifierRule }, bundleDirPath: path.join(FORGES_DIR_PATH, 'edfi') });
	return String((validated.error && validated.error.message) || '');
};
harness.equal('plugin contract: the composed edfi→ctdl declaration validates', composedByHub.ctdl === undefined ? 'not composed' : pluginRefusalTextOf(ctdlRule), '');
BAD_RULE_CASE_LIST.forEach((oneCase) => harness.match(`plugin contract: ${oneCase.caseName} is refused naming renderedProseIdentifierRule`, composedByHub.ctdl === undefined ? '' : pluginRefusalTextOf(oneCase.rule), /bridgeDeclaration 'renderedProseIdentifierRule' /));

// ------------------------------------------------------------------ (iv) the subject side
harness.section('(iv) the subject side is never rewritten: a CURIE there still refuses');
const leakySubjectQuestion = evidenceRendererLib.renderQuestion({ ...ctdlQuestionInput, sourceElement: { ...ctdlQuestionInput.sourceElement, material: { name: 'DegreeTitle', description: 'Maps to ceterms:Degree.' } }, renderedProseIdentifierRule: ctdlRule });
harness.ok('the question with a CURIE in the subject renders', !leakySubjectQuestion.error, leakySubjectQuestion.error && leakySubjectQuestion.error.message);
const leakyHit = leakySubjectQuestion.error ? null : scanHitFor({ hubBridging: ctdlHubBridging, question: leakySubjectQuestion });
harness.ok('the CTDL scan refuses it, on the subject\'s CURIE', leakyHit !== null && leakyHit.matchedText === 'ceterms:Degree', JSON.stringify(leakyHit));

harness.report();
