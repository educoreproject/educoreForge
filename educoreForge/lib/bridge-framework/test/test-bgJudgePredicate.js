#!/usr/bin/env node
'use strict';

// test-bgJudgePredicate.js — BG-JUDGEPRED: the judges, the verifier and the cache carry the judge's predicate under
// predicateRule judgeSlot-v1 (PLAN-sifReplacement-smallPhases §3 B3b; SPEC-sifStructuralBridge-replacement §9 A11), with
// categoryTable-v1 unmoved, plus the oracle conjuncts B3b owes (§1.6 R1, §1.7).
//
//   BG-JUDGEPRED  (a) the verifier accepts the lawful answers and refuses by name a missing predicate, a predicate on
//                 NONE, the abstain value on a pick, and a value outside the offered enum; (b) under judgeSlot-v1 a cache
//                 row written under the categoryTable shape for the identical rendered prompt is a miss, and a judgeSlot
//                 row is served back with its predicate; (c) under categoryTable-v1 a stray predicate is still discarded
//                 and counted (BG-P6), and no record carries one; (d) the debug judge's predicate is deterministic;
//                 (e) a toy judgeSlot-v1 run completes end to end under the debug judge with predicates frozen in the
//                 block; (f) opted in to blockRecordsJudgeConfig, the judge configuration the header states is folded
//                 into the cache key (a maxTokens change is a miss), and opted out the key is the plain model; (g) the
//                 contract's and the schema's predicate-rule lists agree; (h) every rendering variant names the rule its
//                 (basis, rule) row stands for; (i) llmClient and ollama send and read the declared rule's schema, and
//                 every provider refuses an absent rule by name.
//   BG-JUDGEPRED-ORACLE  (R1) run E's frozen block parses unchanged and keeps its id; (§1.7) the toy derived block equals
//                 the branch-cut text with frameworkFingerprint masked, and (m) unmasked differs in that key alone.
//
// Run: node lib/bridge-framework/test/test-bgJudgePredicate.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-JUDGEPRED + BG-JUDGEPRED-ORACLE

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, pureConjunct, succeeded, frameworkMutationTwin, scenarioTwin, blockOf, edgesOf } = require('./testSupport/bridgeTwinFactories');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const JUDGE_FILE = 'judgeComponent.js';
const FRAMEWORK_FILE = 'bridge-framework.js';
const CONTRACT_FILE = 'bridgePluginContract.js';
const RENDERER_FILE = 'evidenceRenderer.js';
const TOY_EMBED_MODEL = 'toy-embed-v1';
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const BRIDGE_MAKER_LIB_DIR = path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib');
const SCHEMA_FILE_PATH = path.join(BRIDGE_MAKER_LIB_DIR, 'selectCandidateSchema.js');
const LLM_CLIENT_FILE_PATH = path.join(BRIDGE_MAKER_LIB_DIR, 'llmClient.js');
const OLLAMA_FILE_PATH = path.join(BRIDGE_MAKER_LIB_DIR, 'ollamaJudgeClient.js');
const DEBUG_JUDGE_FILE_PATH = path.join(BRIDGE_MAKER_LIB_DIR, 'debugJudge.js');
const TOY_BUNDLE_DIR = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy');
const cloneJson = scenarioLib.cloneJson;
const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

// the frozen literals this phase is measured against
const PICK_PREDICATE_LITERAL_LIST = Object.freeze(['exactMatch', 'closeMatch', 'broadMatch', 'narrowMatch']);
const ABSTAIN_PREDICATE_LITERAL = 'none';
const JUDGE_SLOT_RENDERER_VERSION_LITERAL = 'bridgeEvidenceRenderer-derivedJudgeSlot-v1';
const DERIVED_RENDERER_VERSION_LITERAL = 'bridgeEvidenceRenderer-derived-v12';
const BRANCH_CUT_BLOCK_PATH = path.join(__dirname, 'fixtures', 'toyBridge', 'branchCutBlocks', 'toyDerivedPlugin-B3bbranchCut-d3a7382.frozenText.json');
const RUN_E_BLOCK_PATH = path.join(TREE_ROOT, '..', '..', 'dataStores', 'bridgeAcceptance', 'edfiEval', 'runE_091726', 'block.json');
const RUN_E_BLOCK_ID = '7e362cebe7bb74d572e643eed37944d2577eb850313028bc0b9eb11f245c8755';
const FRAMEWORK_FINGERPRINT_TEXT_RE = /"frameworkFingerprint":"[0-9a-f]{64}"/g;
const JUDGE_CONFIG_HEADER_NAME_LIST = ['judgeTemperaturePolicy', 'judgeMaxTokens', 'judgeToolSchemaSha256'];
const JUDGE_CONFIG_CACHE_MODEL_SEPARATOR_LITERAL = '#judgeConfig:';
const CHOICE_ENUM_FIXTURE = Object.freeze(['1', '2', '3', 'NONE']);

// ---------------------------------------------------------------------
// module loading: the real module, or a double carrying the scenario's mutations
// ---------------------------------------------------------------------
const libAt = (scenario, modulePath) => (scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath, mutationList: scenario.frameworkMutationList }) : require(modulePath));
const frameworkLibFor = (scenario, fileName) => libAt(scenario, path.join(scenarioLib.FRAMEWORK_DIR, fileName));
// bridge-maker files live outside lib/bridge-framework, so their twins name the file by absolute path
const absoluteMutationTwin = ({ gateId, conjunctId, twinName, modulePath, find, replace }) =>
	twinRegistry.register({
		gateId,
		conjunctId,
		twinName,
		leverKind: 'productionMutation',
		shippedConfig: true,
		run: (scenario) => {
			moduleDouble.assertMutationApplies({ modulePath, find });
			scenario.frameworkMutationList.push({ modulePath, find, replace });
			return scenario;
		},
	});

// ---------------------------------------------------------------------
// scenario shaping
// ---------------------------------------------------------------------
const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};
const toyDerivedDeclaration = () => cloneJson(require(path.join(TOY_BUNDLE_DIR, 'bridges', `${DERIVED_PLUGIN_NAME}.js`)).bridgeDeclaration);
const declareWith = (scenario, mutate) => {
	const bridgeDeclaration = toyDerivedDeclaration();
	mutate(bridgeDeclaration);
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = { bridgeDeclaration };
};
const toJudgeSlot = (bridgeDeclaration) => {
	bridgeDeclaration.predicateSource = { kind: 'judge', predicateRule: 'judgeSlot-v1' };
	bridgeDeclaration.judgePromptVariant = 'derivedJudgeSlot';
	delete bridgeDeclaration.predicateByCategory;
};
const judgeSlotShape = (scenario) => {
	derivedShape(scenario);
	declareWith(scenario, toJudgeSlot);
};
const judgeSlotOptedInShape = (scenario) => {
	derivedShape(scenario);
	declareWith(scenario, (bridgeDeclaration) => {
		toJudgeSlot(bridgeDeclaration);
		bridgeDeclaration.blockRecordsJudgeConfig = true;
	});
};

// a REAL-client double (it takes part in the judgment cache) that picks '1' or abstains by a digest of the prompt, so a
// run has both; the judge-slot form adds the predicate the rule asks for and states its own maxTokens
const pickOrAbstain = ({ userPrompt }) => (sha256(userPrompt)[0] < '5' ? 'NONE' : '1');
const makeCategoryTableClient = () => scenarioLib.makeFakeRealClient({ pickOrdinal: pickOrAbstain });
const makeJudgeSlotClient = ({ maxTokens = 2000, pickPredicate = 'narrowMatch' } = {}) => {
	const innerClient = scenarioLib.makeFakeRealClient({ pickOrdinal: pickOrAbstain });
	return {
		innerClient,
		name: innerClient.name,
		wireModel: innerClient.wireModel,
		model: innerClient.model,
		maxConcurrency: innerClient.maxConcurrency,
		describe: innerClient.describe,
		keySource: innerClient.keySource,
		judgeConfig: Object.freeze({ temperaturePolicy: 'fakeNoWire', maxTokens }),
		rerank: (rerankOptions, callback) =>
			innerClient.rerank(rerankOptions, (rerankError, clientReturn) => {
				if (rerankError) {
					callback(rerankError);
					return;
				}
				callback('', { ...clientReturn, predicate: clientReturn.choice === 'NONE' ? ABSTAIN_PREDICATE_LITERAL : pickPredicate });
			}),
	};
};

// runAfter — a second run on the SAME stores as a finished one (the cache carried across)
const runAfter = ({ scenario, shape, judgeClient }, callback) => {
	const nextScenario = scenarioLib.cloneScenario(scenario);
	nextScenario.stores = scenario.stores;
	nextScenario.pluginModuleOverrides = {};
	nextScenario.graph = cloneJson(scenario.graph);
	shape(nextScenario);
	nextScenario.judgeClientOverride = judgeClient;
	scenarioLib.runScenario(nextScenario, (unusedError, outcome) => callback(outcome));
};
const refusalOf = (outcome) => outcome.constructionError || outcome.runError || outcome.thrownFromRun || '';
const spendOf = (outcome) => outcome.runReport.counts.judgeSpend;
const asyncConjunct = ({ conjunctId, title, twinNameList, evaluate }) => ({ conjunctId, title, twinNameList, evaluate });

// ---------------------------------------------------------------------
// (a) the verifier, over judgmentFromReturn with a judgeSlot-v1 question
// ---------------------------------------------------------------------
const judgeSlotQuestion = () => ({ choiceEnum: ['1', '2', 'NONE'], renderedPoolStableIdList: ['toy:card/1', 'toy:card/2'], renderedPoolNameList: ['First Name', 'Last Name'], promptHash: 'x', rendererVersion: JUDGE_SLOT_RENDERER_VERSION_LITERAL, judgePredicateRule: 'judgeSlot-v1' });
const pickReturn = (predicateByFieldName) => ({ choice: '1', category: 'strong', rationale: 'First Name means the same thing as the source element', ...predicateByFieldName });
const noneReturn = (predicateByFieldName) => ({ choice: 'NONE', category: 'none', rationale: 'none of the candidates means the same thing', ...predicateByFieldName });
const verdictOf = (scenario, clientReturn) => frameworkLibFor(scenario, JUDGE_FILE).judgmentFromReturn({ clientReturn, question: judgeSlotQuestion(), isDebugClient: false });
const verifierRefusalConjunct = ({ conjunctId, title, twinNameList, caseList, refusalRe }) =>
	pureConjunct({
		conjunctId,
		title,
		twinNameList,
		judge: (scenario) => {
			const faultList = caseList.map((oneCase) => {
				const verdict = verdictOf(scenario, oneCase.clientReturn);
				if (!verdict.error) {
					return `${oneCase.label}: ACCEPTED (predicate ${JSON.stringify(verdict.predicate)})`;
				}
				return refusalRe.test(verdict.error.message) ? null : `${oneCase.label}: refused for another reason: ${verdict.error.message.slice(0, 200)}`;
			}).filter((oneFault) => oneFault !== null);
			return { pass: faultList.length === 0, detail: faultList.length ? faultList.join(' | ') : `${caseList.length} case(s) refused by name (${refusalRe})` };
		},
	});

const verifierConjunctList = [
	pureConjunct({
		conjunctId: 'a0_lawfulAnswersAccepted',
		title: `each pick predicate (${PICK_PREDICATE_LITERAL_LIST.join(', ')}) on a pick, and '${ABSTAIN_PREDICATE_LITERAL}' on NONE, is accepted and carried on the judgment, with nothing counted as discarded`,
		twinNameList: ['verifierSeesNoSlot'],
		judge: (scenario) => {
			const faultList = PICK_PREDICATE_LITERAL_LIST.map((onePredicate) => ({ label: `pick ${onePredicate}`, clientReturn: pickReturn({ predicate: onePredicate }), expected: onePredicate }))
				.concat([{ label: 'NONE none', clientReturn: noneReturn({ predicate: ABSTAIN_PREDICATE_LITERAL }), expected: ABSTAIN_PREDICATE_LITERAL }])
				.map((oneCase) => {
					const verdict = verdictOf(scenario, oneCase.clientReturn);
					if (verdict.error) {
						return `${oneCase.label}: REFUSED ${verdict.error.message.slice(0, 160)}`;
					}
					return verdict.predicate === oneCase.expected && verdict.discardedPredicateKeyCount === 0 ? null : `${oneCase.label}: predicate ${JSON.stringify(verdict.predicate)}, discarded ${verdict.discardedPredicateKeyCount}`;
				})
				.filter((oneFault) => oneFault !== null);
			return { pass: faultList.length === 0, detail: faultList.length ? faultList.join(' | ') : 'five lawful answers accepted, each carrying its predicate' };
		},
	}),
	verifierRefusalConjunct({
		conjunctId: 'a1_missingPredicateRefused',
		title: 'a pick, and an abstention, that carry no predicate are refused by name',
		twinNameList: ['missingPredicateCheckDeleted'],
		caseList: [{ label: 'pick without predicate', clientReturn: pickReturn({}) }, { label: 'NONE without predicate', clientReturn: noneReturn({}) }, { label: 'pick with blank predicate', clientReturn: pickReturn({ predicate: ' ' }) }],
		refusalRe: /with no predicate/,
	}),
	verifierRefusalConjunct({
		conjunctId: 'a2_predicateOnNoneRefused',
		title: 'an abstention that names a relation is refused by name (predicate is the abstain value exactly when choice is NONE)',
		twinNameList: ['predicateOnNoneCheckDeleted'],
		caseList: PICK_PREDICATE_LITERAL_LIST.map((onePredicate) => ({ label: `NONE ${onePredicate}`, clientReturn: noneReturn({ predicate: onePredicate }) })),
		refusalRe: /abstained \(NONE\) but returned predicate '(exactMatch|closeMatch|broadMatch|narrowMatch)'/,
	}),
	verifierRefusalConjunct({
		conjunctId: 'a3_abstainPredicateOnPickRefused',
		title: `a pick that names '${ABSTAIN_PREDICATE_LITERAL}' as its relation is refused by name`,
		twinNameList: ['abstainPredicateOnPickCheckDeleted'],
		caseList: [{ label: 'pick none', clientReturn: pickReturn({ predicate: ABSTAIN_PREDICATE_LITERAL }) }],
		refusalRe: /picked ordinal 1 but returned predicate 'none'/,
	}),
	verifierRefusalConjunct({
		conjunctId: 'a4_outOfEnumPredicateRefused',
		title: 'a predicate outside the offered enum is refused by name, on a pick and on NONE',
		twinNameList: ['offeredEnumCheckDeleted'],
		caseList: [{ label: 'pick relatedMatch', clientReturn: pickReturn({ predicate: 'relatedMatch' }) }, { label: 'pick ExactMatch', clientReturn: pickReturn({ predicate: 'ExactMatch' }) }, { label: 'NONE NONE', clientReturn: noneReturn({ predicate: 'NONE' }) }],
		refusalRe: /which is not one of the offered values/,
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'a0_lawfulAnswersAccepted', twinName: 'verifierSeesNoSlot', fileName: JUDGE_FILE, find: '\tconst predicateField = PREDICATE_FIELD_BY_PREDICATE_RULE[question.judgePredicateRule];\n', replace: '\tconst predicateField = null;\n' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'a1_missingPredicateRefused', twinName: 'missingPredicateCheckDeleted', fileName: JUDGE_FILE, find: '\tif (!isNonBlank(offeredValue)) {', replace: '\tif (false) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'a2_predicateOnNoneRefused', twinName: 'predicateOnNoneCheckDeleted', fileName: JUDGE_FILE, find: '\tif (isAbstention && offeredValue !== predicateField.abstainValue) {', replace: '\tif (false) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'a3_abstainPredicateOnPickRefused', twinName: 'abstainPredicateOnPickCheckDeleted', fileName: JUDGE_FILE, find: '\tif (!isAbstention && offeredValue === predicateField.abstainValue) {', replace: '\tif (false) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'a4_outOfEnumPredicateRefused', twinName: 'offeredEnumCheckDeleted', fileName: JUDGE_FILE, find: '\tif (predicateField.offeredValueList.indexOf(offeredValue) === -1) {', replace: '\tif (false) {' });

// ---------------------------------------------------------------------
// (b) the cache: a categoryTable row is a miss under judgeSlot-v1; a judgeSlot row is served with its predicate
// ---------------------------------------------------------------------
const JUDGE_SLOT_VERSION_FIND = "derivedJudgeSlot: Object.freeze({ ...DERIVED_VARIANT_ROW, rendererVersion: DERIVED_JUDGE_SLOT_RENDERER_VERSION, judgePredicateRule: 'judgeSlot-v1' }),";
const JUDGE_SLOT_GIVEN_DERIVED_VERSION = "derivedJudgeSlot: Object.freeze({ ...DERIVED_VARIANT_ROW, rendererVersion: DERIVED_RENDERER_VERSION, judgePredicateRule: 'judgeSlot-v1' }),";
const cacheConjunctList = [
	asyncConjunct({
		conjunctId: 'b_categoryTableRowMissUnderJudgeSlot',
		title: 'rows a categoryTable-v1 run wrote for the SAME rendered prompts are a miss under judgeSlot-v1: every judgeSlot judgment is asked live, none served',
		twinNameList: ['judgeSlotGivenDerivedRendererVersion'],
		evaluate: (scenario, callback) => {
			derivedShape(scenario);
			const categoryTableClient = makeCategoryTableClient();
			scenario.judgeClientOverride = categoryTableClient;
			scenarioLib.runScenario(scenario, (unusedError, first) => {
				if (refusalOf(first)) {
					callback('', { pass: false, detail: `categoryTable run refused: ${String(refusalOf(first)).slice(0, 200)}` });
					return;
				}
				const rowCount = scenario.stores.judgmentCache.rowCount();
				const judgeSlotClient = makeJudgeSlotClient({});
				runAfter({ scenario, shape: judgeSlotShape, judgeClient: judgeSlotClient }, (second) => {
					if (refusalOf(second)) {
						callback('', { pass: false, detail: `judgeSlot run on the warm cache refused (a categoryTable row was SERVED and failed verification): ${String(refusalOf(second)).slice(0, 220)}` });
						return;
					}
					const categoryTablePromptList = categoryTableClient.questionList.map((oneQuestion) => oneQuestion.userPrompt).sort();
					const judgeSlotPromptList = judgeSlotClient.innerClient.questionList.map((oneQuestion) => oneQuestion.userPrompt).sort();
					const samePrompts = JSON.stringify(categoryTablePromptList) === JSON.stringify(judgeSlotPromptList);
					const spend = spendOf(second);
					callback('', { pass: rowCount > 0 && samePrompts && spend.servedFromCache === 0 && spend.asked === judgeSlotPromptList.length && spend.asked > 0, detail: `categoryTable rows ${rowCount}; identical rendered prompts ${samePrompts}; judgeSlot asked ${spend.asked}, served ${spend.servedFromCache}` });
				});
			});
		},
	}),
	asyncConjunct({
		conjunctId: 'b_judgeSlotRowServedWithItsPredicate',
		title: 'a second judgeSlot-v1 run on a warm cache is served entirely from it, rebuilds each predicate, and freezes the same block',
		twinNameList: ['cachePayloadDropsPredicate'],
		evaluate: (scenario, callback) => {
			judgeSlotShape(scenario);
			scenario.judgeClientOverride = makeJudgeSlotClient({});
			scenarioLib.runScenario(scenario, (unusedError, first) => {
				if (refusalOf(first)) {
					callback('', { pass: false, detail: `first judgeSlot run refused: ${String(refusalOf(first)).slice(0, 200)}` });
					return;
				}
				const secondClient = makeJudgeSlotClient({});
				runAfter({ scenario, shape: judgeSlotShape, judgeClient: secondClient }, (second) => {
					if (refusalOf(second)) {
						callback('', { pass: false, detail: `warm judgeSlot run refused: ${String(refusalOf(second)).slice(0, 220)}` });
						return;
					}
					const sameBlock = first.runReport.decisionBlock.decisionBlockHash === second.runReport.decisionBlock.decisionBlockHash;
					const spend = spendOf(second);
					callback('', { pass: sameBlock && secondClient.innerClient.callCount === 0 && spend.asked === 0 && spend.servedFromCache > 0, detail: `same block ${sameBlock}; live calls ${secondClient.innerClient.callCount}; asked ${spend.asked}, served ${spend.servedFromCache}` });
				});
			});
		},
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'b_categoryTableRowMissUnderJudgeSlot', twinName: 'judgeSlotGivenDerivedRendererVersion', fileName: RENDERER_FILE, find: JUDGE_SLOT_VERSION_FIND, replace: JUDGE_SLOT_GIVEN_DERIVED_VERSION });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'b_judgeSlotRowServedWithItsPredicate', twinName: 'cachePayloadDropsPredicate', fileName: JUDGE_FILE, find: 'chosenStableId: judged.chosenCardStableId, ...predicateByFieldNameOf(judged) };', replace: 'chosenStableId: judged.chosenCardStableId };' }); // re-anchored 2026-10-06 (campaign P0): W-B-7 names the payload putPayload

// ---------------------------------------------------------------------
// (c) categoryTable-v1: BF1's discard-and-count, unchanged
// ---------------------------------------------------------------------
const categoryTableConjunctList = [
	runConjunct({
		conjunctId: 'c_categoryTableStrayPredicateDiscardedAndCounted',
		title: "under categoryTable-v1 a client returning a stray predicate has it discarded and counted once per judgment; no record carries judge.predicate, and each pick's predicate comes from the table",
		twinNameList: ['discardNotCounted'],
		shape: (scenario) => {
			derivedShape(scenario);
			scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({ pickOrdinal: pickOrAbstain, extraReturnKeys: { predicate: 'relatedMatch' } });
		},
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const judgedRecordList = block.decisionRecordList.filter((oneRecord) => oneRecord.judge !== undefined);
			const predicateTable = toyDerivedDeclaration().predicateByCategory;
			const recordFaultList = judgedRecordList.filter((oneRecord) => oneRecord.judge.predicate !== undefined || (!oneRecord.abstained && oneRecord.predicate !== predicateTable[oneRecord.judge.category]));
			const counted = runReport.counts.discardedPredicateKeyCount;
			return { pass: judgedRecordList.length > 0 && counted === judgedRecordList.length && recordFaultList.length === 0, detail: `${judgedRecordList.length} judged; discardedPredicateKeyCount ${counted}; ${recordFaultList.length} record(s) with a judge predicate or a non-table predicate` };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'c_categoryTableStrayPredicateDiscardedAndCounted', twinName: 'discardNotCounted', fileName: JUDGE_FILE, find: "\tconst discardedPredicateKeyCount = Object.prototype.hasOwnProperty.call(clientReturn, 'predicate') ? 1 : 0;", replace: '\tconst discardedPredicateKeyCount = 0;' });

// ---------------------------------------------------------------------
// (d) the debug judge's predicate is deterministic
// ---------------------------------------------------------------------
const debugAnswersFor = (scenario, { ruleName, predicateRule, userPromptList }) => {
	const debugJudge = libAt(scenario, DEBUG_JUDGE_FILE_PATH)({ ruleName });
	return userPromptList.map((oneUserPrompt) => {
		let answered = null;
		debugJudge.rerank({ systemPrompt: 's', userPrompt: oneUserPrompt, choiceEnum: CHOICE_ENUM_FIXTURE.slice(), predicateRule }, (rerankError, clientReturn) => {
			answered = rerankError ? { refusal: rerankError } : clientReturn;
		});
		return answered;
	});
};
const DEBUG_PROMPT_LIST = Array.from({ length: 24 }, (unused, promptIndex) => `debug prompt ${promptIndex}`);
const debugConjunctList = [
	pureConjunct({
		conjunctId: 'd_debugPredicateDeterministic',
		title: "the debug judge (digest) gives the same predicate for the same input twice, over 24 prompts, varies it, answers 'none' on NONE; 'first' answers exactMatch; under categoryTable-v1 it answers no predicate key",
		twinNameList: ['debugPredicateRandomised'],
		judge: (scenario) => {
			const firstPass = debugAnswersFor(scenario, { ruleName: 'digest', predicateRule: 'judgeSlot-v1', userPromptList: DEBUG_PROMPT_LIST });
			const secondPass = debugAnswersFor(scenario, { ruleName: 'digest', predicateRule: 'judgeSlot-v1', userPromptList: DEBUG_PROMPT_LIST });
			const refusedList = firstPass.concat(secondPass).filter((oneAnswer) => oneAnswer === null || oneAnswer.refusal);
			if (refusedList.length) {
				return { pass: false, detail: `the debug judge refused or never answered: ${JSON.stringify(refusedList[0])}` };
			}
			const unstableCount = firstPass.filter((oneAnswer, answerIndex) => oneAnswer.predicate !== secondPass[answerIndex].predicate).length;
			const pickPredicateSet = new Set(firstPass.filter((oneAnswer) => oneAnswer.choice !== 'NONE').map((oneAnswer) => oneAnswer.predicate));
			const noneFaultCount = firstPass.filter((oneAnswer) => (oneAnswer.choice === 'NONE') !== (oneAnswer.predicate === ABSTAIN_PREDICATE_LITERAL)).length;
			const outOfEnumCount = firstPass.filter((oneAnswer) => oneAnswer.choice !== 'NONE' && PICK_PREDICATE_LITERAL_LIST.indexOf(oneAnswer.predicate) === -1).length;
			const firstRuleAnswer = debugAnswersFor(scenario, { ruleName: 'first', predicateRule: 'judgeSlot-v1', userPromptList: ['p'] })[0];
			const categoryTableAnswer = debugAnswersFor(scenario, { ruleName: 'digest', predicateRule: 'categoryTable-v1', userPromptList: ['p'] })[0];
			const categoryTableHasKey = Object.prototype.hasOwnProperty.call(categoryTableAnswer, 'predicate');
			const pass = unstableCount === 0 && pickPredicateSet.size >= 2 && noneFaultCount === 0 && outOfEnumCount === 0 && firstRuleAnswer.predicate === 'exactMatch' && !categoryTableHasKey;
			return { pass, detail: `unstable ${unstableCount}/24; distinct pick predicates ${pickPredicateSet.size} [${Array.from(pickPredicateSet).join(', ')}]; NONE/none mismatches ${noneFaultCount}; out of enum ${outOfEnumCount}; 'first' ${firstRuleAnswer.predicate}; categoryTable-v1 has predicate key ${categoryTableHasKey}` };
		},
	}),
];
absoluteMutationTwin({ gateId: 'BG-JUDGEPRED', conjunctId: 'd_debugPredicateDeterministic', twinName: 'debugPredicateRandomised', modulePath: DEBUG_JUDGE_FILE_PATH, find: 'pickPredicateIndexFor: ({ pickValueCount, userPrompt }) => promptDigest(`predicate:${userPrompt}`) % pickValueCount,', replace: 'pickPredicateIndexFor: ({ pickValueCount, userPrompt }) => Math.floor(Math.random() * pickValueCount),' });

// ---------------------------------------------------------------------
// (e) a toy judgeSlot-v1 run end to end under the debug judge
// ---------------------------------------------------------------------
const toyRunConjunctList = [
	runConjunct({
		conjunctId: 'e_toyJudgeSlotRunFreezesPredicates',
		title: `a toy judgeSlot-v1 run completes under the debug judge: header predicateRule judgeSlot-v1 / ${JUDGE_SLOT_RENDERER_VERSION_LITERAL}; every pick freezes judge.predicate in the pick enum, equal to its record and edge predicate, asserted by the judge; no abstention carries one`,
		twinNameList: ['judgeRecordPredicateDropped', 'abstentionRecordsPredicate', 'resolverReadsTableUnderJudgeSlot'],
		shape: judgeSlotShape,
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const judgedRecordList = block.decisionRecordList.filter((oneRecord) => oneRecord.judge !== undefined);
			const pickList = judgedRecordList.filter((oneRecord) => !oneRecord.abstained);
			const abstentionList = judgedRecordList.filter((oneRecord) => oneRecord.abstained);
			const pickFaultList = pickList.filter((oneRecord) => PICK_PREDICATE_LITERAL_LIST.indexOf(oneRecord.judge.predicate) === -1 || oneRecord.predicate !== oneRecord.judge.predicate || oneRecord.predicateAssertedBy !== 'judge');
			const abstentionFaultList = abstentionList.filter((oneRecord) => Object.prototype.hasOwnProperty.call(oneRecord.judge, 'predicate') || oneRecord.predicate !== null);
			// the materialised edges carry exactly the judged relations, one per pick
			const judgedEdgeList = edgesOf(outcome).filter((oneEdge) => oneEdge.properties.resolution === 'judged');
			const edgePredicateText = judgedEdgeList.map((oneEdge) => oneEdge.properties.predicate).sort().join(',');
			const pickPredicateText = pickList.map((oneRecord) => oneRecord.judge.predicate).sort().join(',');
			const edgeFaultList = edgePredicateText === pickPredicateText ? [] : [`edges [${edgePredicateText}] vs picks [${pickPredicateText}]`];
			const headerOk = block.header.predicateRule === 'judgeSlot-v1' && block.header.rendererVersion === JUDGE_SLOT_RENDERER_VERSION_LITERAL;
			return { pass: headerOk && pickList.length > 0 && abstentionList.length > 0 && pickFaultList.length === 0 && abstentionFaultList.length === 0 && edgeFaultList.length === 0, detail: `header ${block.header.predicateRule} / ${block.header.rendererVersion}; ${pickList.length} pick(s), ${pickFaultList.length} faulty; ${abstentionList.length} abstention(s), ${abstentionFaultList.length} faulty; ${judgedEdgeList.length} judged edge(s), ${edgeFaultList.length} faulty; pick predicates [${Array.from(new Set(pickList.map((oneRecord) => oneRecord.judge.predicate))).join(', ')}]` };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'e_toyJudgeSlotRunFreezesPredicates', twinName: 'judgeRecordPredicateDropped', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\t\t\t\tjudgeRecord.predicate = judged.predicate;\n', replace: '' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'e_toyJudgeSlotRunFreezesPredicates', twinName: 'abstentionRecordsPredicate', fileName: FRAMEWORK_FILE, find: 'if (judged.chosenCardStableId !== null && judged.predicate !== undefined) {', replace: 'if (judged.predicate !== undefined) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'e_toyJudgeSlotRunFreezesPredicates', twinName: 'resolverReadsTableUnderJudgeSlot', fileName: FRAMEWORK_FILE, find: "\t'judgeSlot-v1': ({ judged }) => ({ predicate: judged.predicate }),", replace: "\t'judgeSlot-v1': ({ judged, bridgeDeclaration }) => ({ predicate: bridgeDeclaration.predicateByCategory[judged.category] })," });

// ---------------------------------------------------------------------
// (f) the judge configuration the header states, folded into the cache key
// ---------------------------------------------------------------------
const foldConjunctList = [
	asyncConjunct({
		conjunctId: 'f1_judgeConfigFoldedIntoCacheKey',
		title: `opted in: a repeat run is served from the cache; a run whose judge states another maxTokens is a MISS; every row's model is '<model>${JUDGE_CONFIG_CACHE_MODEL_SEPARATOR_LITERAL}<sha256 of the header's three judge-config values>'`,
		twinNameList: ['foldRemoved'],
		evaluate: (scenario, callback) => {
			judgeSlotOptedInShape(scenario);
			const firstClient = makeJudgeSlotClient({ maxTokens: 2000 });
			scenario.judgeClientOverride = firstClient;
			scenarioLib.runScenario(scenario, (unusedError, first) => {
				if (refusalOf(first)) {
					callback('', { pass: false, detail: `first run refused: ${String(refusalOf(first)).slice(0, 200)}` });
					return;
				}
				const header = blockOf(first).header;
				const statedDigest = sha256(require(path.join(scenarioLib.FRAMEWORK_DIR, CONTRACT_FILE)).canonicalJsonText(JUDGE_CONFIG_HEADER_NAME_LIST.reduce((soFar, oneName) => ({ ...soFar, [oneName]: header[oneName] }), {})));
				const rowModelList = Object.values(scenario.stores.judgmentCache.rowByRefId).map((oneRow) => oneRow.model);
				const rowsCarryStatedDigest = rowModelList.length > 0 && rowModelList.every((oneModel) => oneModel === `${firstClient.model}${JUDGE_CONFIG_CACHE_MODEL_SEPARATOR_LITERAL}${statedDigest}`);
				runAfter({ scenario, shape: judgeSlotOptedInShape, judgeClient: makeJudgeSlotClient({ maxTokens: 2000 }) }, (second) => {
					runAfter({ scenario, shape: judgeSlotOptedInShape, judgeClient: makeJudgeSlotClient({ maxTokens: 2500 }) }, (third) => {
						if (refusalOf(second) || refusalOf(third)) {
							callback('', { pass: false, detail: `a later run refused: ${String(refusalOf(second) || refusalOf(third)).slice(0, 200)}` });
							return;
						}
						const secondSpend = spendOf(second);
						const thirdSpend = spendOf(third);
						const pass = rowsCarryStatedDigest && secondSpend.asked === 0 && secondSpend.servedFromCache > 0 && thirdSpend.servedFromCache === 0 && thirdSpend.asked > 0 && blockOf(third).header.judgeMaxTokens === 2500;
						callback('', { pass, detail: `rows carry the stated digest ${rowsCarryStatedDigest} (${rowModelList.length} rows); same config: asked ${secondSpend.asked}, served ${secondSpend.servedFromCache}; maxTokens 2500: asked ${thirdSpend.asked}, served ${thirdSpend.servedFromCache}` });
					});
				});
			});
		},
	}),
	asyncConjunct({
		conjunctId: 'f2_optedOutCacheKeyIsThePlainModel',
		title: 'opted out, every cache row is keyed by the plain judge model, exactly as before B3b',
		twinNameList: ['foldAppliedWhenOptedOut'],
		evaluate: (scenario, callback) => {
			judgeSlotShape(scenario);
			const client = makeJudgeSlotClient({});
			scenario.judgeClientOverride = client;
			scenarioLib.runScenario(scenario, (unusedError, outcome) => {
				if (refusalOf(outcome)) {
					callback('', { pass: false, detail: `run refused: ${String(refusalOf(outcome)).slice(0, 200)}` });
					return;
				}
				const rowModelList = Object.values(scenario.stores.judgmentCache.rowByRefId).map((oneRow) => oneRow.model);
				const foreignList = rowModelList.filter((oneModel) => oneModel !== client.model);
				callback('', { pass: rowModelList.length > 0 && foreignList.length === 0, detail: `${rowModelList.length} row(s); ${foreignList.length} keyed by another model${foreignList.length ? ` (${foreignList[0]})` : ''}` });
			});
		},
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'f1_judgeConfigFoldedIntoCacheKey', twinName: 'foldRemoved', fileName: JUDGE_FILE, find: 'const cacheModelFor = ({ model, judgeConfigCacheDigest }) => (judgeConfigCacheDigest === null ? model :', replace: 'const cacheModelFor = ({ model, judgeConfigCacheDigest }) => (true ? model :' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'f2_optedOutCacheKeyIsThePlainModel', twinName: 'foldAppliedWhenOptedOut', fileName: FRAMEWORK_FILE, find: 'const runJudgeConfigHeader = recordsJudgeConfig && judgeClient !== null ?', replace: 'const runJudgeConfigHeader = judgeClient !== null ?' });

// ---------------------------------------------------------------------
// (g) (h) the registries agree
// ---------------------------------------------------------------------
const registryConjunctList = [
	pureConjunct({
		conjunctId: 'g_predicateRuleListsAgree',
		title: "the contract's JUDGE_PREDICATE_RULE_LIST, the schema's PREDICATE_RULE_NAME_LIST, and the rows of PREDICATE_FIELD_BY_PREDICATE_RULE and of the orchestrator's JUDGE_PICK_PREDICATE_BY_PREDICATE_RULE name the same rules (B3a docket item)",
		twinNameList: ['ruleAddedToSchemaOnly'],
		judge: (scenario) => {
			const contractRuleList = frameworkLibFor(scenario, CONTRACT_FILE).JUDGE_PREDICATE_RULE_LIST.slice().sort();
			const schemaLib = libAt(scenario, SCHEMA_FILE_PATH);
			const schemaRuleList = schemaLib.PREDICATE_RULE_NAME_LIST.slice().sort();
			const fieldRuleList = Object.keys(schemaLib.PREDICATE_FIELD_BY_PREDICATE_RULE).sort();
			const pickResolverRuleList = Object.keys(frameworkLibFor(scenario, FRAMEWORK_FILE).JUDGE_PICK_PREDICATE_BY_PREDICATE_RULE).sort();
			const agree = [schemaRuleList, fieldRuleList, pickResolverRuleList].every((oneList) => JSON.stringify(oneList) === JSON.stringify(contractRuleList));
			return { pass: agree, detail: `contract [${contractRuleList.join(', ')}]; schema [${schemaRuleList.join(', ')}]; predicate fields [${fieldRuleList.join(', ')}]; pick resolvers [${pickResolverRuleList.join(', ')}]` };
		},
	}),
	pureConjunct({
		conjunctId: 'h_variantNamesItsRowRule',
		title: "every VARIANT_BY_BASIS_AND_PREDICATE_RULE row lands on a variant whose judgePredicateRule is that row's rule (a documentary row, which declares none, judges through categoryTable-v1)",
		twinNameList: ['judgeSlotVariantAnswersCategoryTable'],
		judge: (scenario) => {
			const contractLib = frameworkLibFor(scenario, CONTRACT_FILE);
			const rendererLib = frameworkLibFor(scenario, RENDERER_FILE);
			const faultList = [];
			Object.keys(contractLib.VARIANT_BY_BASIS_AND_PREDICATE_RULE).forEach((oneBasis) => {
				Object.keys(contractLib.VARIANT_BY_BASIS_AND_PREDICATE_RULE[oneBasis]).forEach((oneRule) => {
					const variantName = contractLib.VARIANT_BY_BASIS_AND_PREDICATE_RULE[oneBasis][oneRule];
					const expectedRule = oneRule === contractLib.NO_JUDGE_PREDICATE_RULE ? 'categoryTable-v1' : oneRule;
					const variantRule = rendererLib.JUDGE_PROMPT_VARIANT_REGISTRY[variantName].judgePredicateRule;
					if (variantRule !== expectedRule) {
						faultList.push(`(${oneBasis}, ${oneRule}) → ${variantName} answers ${variantRule}, expected ${expectedRule}`);
					}
				});
			});
			return { pass: faultList.length === 0, detail: faultList.length ? faultList.join('; ') : 'every row lands on a variant answering its own rule' };
		},
	}),
];
absoluteMutationTwin({ gateId: 'BG-JUDGEPRED', conjunctId: 'g_predicateRuleListsAgree', twinName: 'ruleAddedToSchemaOnly', modulePath: SCHEMA_FILE_PATH, find: "\t'judgeSlot-v1': buildJudgeSlotSelectCandidateSchema,\n", replace: "\t'judgeSlot-v1': buildJudgeSlotSelectCandidateSchema,\n\t'judgeSlot-v2': buildJudgeSlotSelectCandidateSchema,\n" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED', conjunctId: 'h_variantNamesItsRowRule', twinName: 'judgeSlotVariantAnswersCategoryTable', fileName: RENDERER_FILE, find: JUDGE_SLOT_VERSION_FIND, replace: "derivedJudgeSlot: Object.freeze({ ...DERIVED_VARIANT_ROW, rendererVersion: DERIVED_JUDGE_SLOT_RENDERER_VERSION, judgePredicateRule: 'categoryTable-v1' })," });

// ---------------------------------------------------------------------
// (i) the providers send and read the declared rule's schema, and refuse an absent rule
// ---------------------------------------------------------------------
const scratchIniPath = (fileName, sectionText) => {
	const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bgJudgePredicate-')), fileName);
	fs.writeFileSync(filePath, sectionText);
	return filePath;
};
const anthropicIniPath = () => scratchIniPath('anthropicAi.ini', '[anthropicAi]\napiKey=DUMMY-NEVER-SENT\nmodel=claude-opus-5\nmaxTokens=2000\n');
const ollamaIniPath = () => scratchIniPath('ollamaJudge.ini', '[ollamaJudge]\nendpointHostName=127.0.0.1\nendpointPortNumber=11434\nwireModel=qwen2.5:32b\nmaxConcurrency=1\nrequestTimeoutMs=180000\nnumPredict=400\n');
const OLLAMA_TAG_LIST = { models: [{ name: 'qwen2.5:32b', model: 'qwen2.5:32b', digest: '9f13ba1299afea09d9a956fc6a85becc99115a6d596fae201a5487a03bdc4368' }] };
// the judgment a model returns, with a predicate present in the answer whatever the rule; the provider decides what it reads
const MODEL_ANSWER = Object.freeze({ choice: '2', category: 'moderate', rationale: 'Last Name is the family name the source element holds', predicate: 'broadMatch', sourceElementIdeaList: [], candidateIdeaList: [], sortedCandidateList: ['2', '1', '3'], ideaCoverage: { candidateIndexNumber: '2', sourceNounsCovered: [], sourceNounsNotCovered: [] } });
const askProvider = ({ provider, predicateRule }, callback) => provider.rerank({ systemPrompt: 's', userPrompt: 'u', choiceEnum: CHOICE_ENUM_FIXTURE.slice(), predicateRule, maxRetries: 1 }, (rerankError, clientReturn) => callback({ rerankError, clientReturn }));
// providerRoundTrip — both rules through one provider; judge what went on the wire and what came back
const providerRoundTrip = ({ scenario, makeProvider, sentSchemaOf, dialectName }, callback) => {
	const schemaLib = require(SCHEMA_FILE_PATH);
	const sentByRule = {};
	askProvider({ provider: makeProvider((payload) => { sentByRule.judgeSlot = sentSchemaOf(payload); }), predicateRule: 'judgeSlot-v1' }, (judgeSlotAnswer) => {
		askProvider({ provider: makeProvider((payload) => { sentByRule.categoryTable = sentSchemaOf(payload); }), predicateRule: 'categoryTable-v1' }, (categoryTableAnswer) => {
			const expectedJudgeSlot = JSON.stringify(schemaLib.renderSelectCandidateSchemaForPredicateRule(dialectName, { choiceEnum: CHOICE_ENUM_FIXTURE.slice(), predicateRule: 'judgeSlot-v1' }));
			const expectedCategoryTable = JSON.stringify(schemaLib.renderSelectCandidateSchemaForPredicateRule(dialectName, { choiceEnum: CHOICE_ENUM_FIXTURE.slice(), predicateRule: 'categoryTable-v1' }));
			const faultList = [];
			if (judgeSlotAnswer.rerankError || categoryTableAnswer.rerankError) {
				faultList.push(`refused: ${judgeSlotAnswer.rerankError || categoryTableAnswer.rerankError}`);
			} else {
				if (JSON.stringify(sentByRule.judgeSlot) !== expectedJudgeSlot) {
					faultList.push('judgeSlot-v1 sent another schema');
				}
				if (JSON.stringify(sentByRule.categoryTable) !== expectedCategoryTable) {
					faultList.push('categoryTable-v1 sent another schema');
				}
				if (judgeSlotAnswer.clientReturn.predicate !== 'broadMatch') {
					faultList.push(`judgeSlot-v1 read predicate ${JSON.stringify(judgeSlotAnswer.clientReturn.predicate)}`);
				}
				if (Object.prototype.hasOwnProperty.call(categoryTableAnswer.clientReturn, 'predicate')) {
					faultList.push('categoryTable-v1 return carries a predicate key');
				}
			}
			callback('', { pass: faultList.length === 0, detail: faultList.length ? faultList.join('; ') : `${dialectName}: each rule's schema on the wire; judgeSlot-v1 reads broadMatch; categoryTable-v1 returns no predicate key` });
		});
	});
	void scenario;
};
const providerConjunctList = [
	asyncConjunct({
		conjunctId: 'i1_llmClientSendsAndReadsTheRuleSchema',
		title: 'llmClient sends the declared rule’s anthropic schema, reads the predicate under judgeSlot-v1, and returns no predicate key under categoryTable-v1',
		twinNameList: ['llmClientAlwaysSendsCategoryTable'],
		evaluate: (scenario, callback) => {
			const llmClientFactory = libAt(scenario, LLM_CLIENT_FILE_PATH);
			const makeProvider = (capturePayload) =>
				llmClientFactory({
					configFilePath: anthropicIniPath(),
					componentOverrides: {
						postOnce: ({ payload }, postCallback) => {
							capturePayload(payload);
							postCallback('', { content: [{ type: 'tool_use', name: llmClientFactory.TOOL_NAME, input: { ...MODEL_ANSWER } }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }, 200);
						},
					},
				});
			providerRoundTrip({ scenario, makeProvider, sentSchemaOf: (payload) => payload.tools[0], dialectName: 'anthropic' }, callback);
		},
	}),
	asyncConjunct({
		conjunctId: 'i2_ollamaSendsAndReadsTheRuleSchema',
		title: 'the ollama client sends the declared rule’s ollama schema as format, reads the predicate under judgeSlot-v1, and returns no predicate key under categoryTable-v1',
		twinNameList: ['ollamaAlwaysSendsCategoryTable'],
		evaluate: (scenario, callback) => {
			const ollamaFactory = libAt(scenario, OLLAMA_FILE_PATH);
			const makeProvider = (capturePayload) => {
				let provider = null;
				ollamaFactory(
					{
						configFilePath: ollamaIniPath(),
						componentOverrides: {
							fetchModelTagList: (tagCallback) => tagCallback('', OLLAMA_TAG_LIST),
							postOnce: ({ payload }, postCallback) => {
								capturePayload(payload);
								postCallback('', { model: 'qwen2.5:32b', message: { role: 'assistant', content: JSON.stringify(MODEL_ANSWER) }, done: true, done_reason: 'stop' }, 200);
							},
						},
					},
					(constructionError, constructed) => {
						provider = constructionError ? { rerank: (unusedOptions, rerankCallback) => rerankCallback(`construction refused: ${constructionError}`) } : constructed;
					},
				);
				return provider;
			};
			providerRoundTrip({ scenario, makeProvider, sentSchemaOf: (payload) => payload.format, dialectName: 'ollama' }, callback);
		},
	}),
	asyncConjunct({
		conjunctId: 'i3_providersRefuseAnAbsentRule',
		title: 'llmClient, the ollama client and the debug judge each refuse a rerank that names no predicateRule, by name, and never answer it',
		twinNameList: ['debugJudgeDefaultsTheRule'],
		evaluate: (scenario, callback) => {
			const refusalRe = /predicateRule undefined names no select_candidate schema/;
			const llmClientFactory = libAt(scenario, LLM_CLIENT_FILE_PATH);
			const llmProvider = llmClientFactory({ configFilePath: anthropicIniPath(), componentOverrides: { postOnce: (unusedArgs, postCallback) => postCallback('', { content: [{ type: 'tool_use', name: llmClientFactory.TOOL_NAME, input: { ...MODEL_ANSWER } }], stop_reason: 'end_turn' }, 200) } });
			let ollamaProvider = null;
			libAt(scenario, OLLAMA_FILE_PATH)({ configFilePath: ollamaIniPath(), componentOverrides: { fetchModelTagList: (tagCallback) => tagCallback('', OLLAMA_TAG_LIST), postOnce: (unusedArgs, postCallback) => postCallback('', { message: { content: JSON.stringify(MODEL_ANSWER) }, done: true }, 200) } }, (constructionError, constructed) => {
				ollamaProvider = constructed;
			});
			const debugProvider = libAt(scenario, DEBUG_JUDGE_FILE_PATH)({ ruleName: 'digest' });
			const outcomeList = [];
			[['llmClient', llmProvider], ['ollama', ollamaProvider], ['debug', debugProvider]].forEach(([providerLabel, provider]) => {
				provider.rerank({ systemPrompt: 's', userPrompt: 'u', choiceEnum: CHOICE_ENUM_FIXTURE.slice(), maxRetries: 1 }, (rerankError, clientReturn) => {
					outcomeList.push(rerankError && refusalRe.test(rerankError) ? null : `${providerLabel}: ${rerankError ? `refused otherwise: ${String(rerankError).slice(0, 160)}` : `ANSWERED (choice ${clientReturn.choice})`}`);
				});
			});
			const faultList = outcomeList.filter((oneFault) => oneFault !== null);
			callback('', { pass: outcomeList.length === 3 && faultList.length === 0, detail: faultList.length ? faultList.join(' | ') : 'three providers refuse by name' });
		},
	}),
];
absoluteMutationTwin({ gateId: 'BG-JUDGEPRED', conjunctId: 'i1_llmClientSendsAndReadsTheRuleSchema', twinName: 'llmClientAlwaysSendsCategoryTable', modulePath: LLM_CLIENT_FILE_PATH, find: "const buildTool = ({ choiceEnum, predicateRule } = {}) => renderSelectCandidateSchemaForPredicateRule('anthropic', { choiceEnum, predicateRule });", replace: "const buildTool = ({ choiceEnum, predicateRule } = {}) => renderSelectCandidateSchemaForPredicateRule('anthropic', { choiceEnum, predicateRule: 'categoryTable-v1' });" });
absoluteMutationTwin({ gateId: 'BG-JUDGEPRED', conjunctId: 'i2_ollamaSendsAndReadsTheRuleSchema', twinName: 'ollamaAlwaysSendsCategoryTable', modulePath: OLLAMA_FILE_PATH, find: 'const renderedSchema = renderSelectCandidateSchemaForPredicateRule(PROVIDER_NAME, { choiceEnum, predicateRule });', replace: "const renderedSchema = renderSelectCandidateSchemaForPredicateRule(PROVIDER_NAME, { choiceEnum, predicateRule: 'categoryTable-v1' });" });
absoluteMutationTwin({ gateId: 'BG-JUDGEPRED', conjunctId: 'i3_providersRefuseAnAbsentRule', twinName: 'debugJudgeDefaultsTheRule', modulePath: DEBUG_JUDGE_FILE_PATH, find: 'const { systemPrompt, userPrompt, choiceEnum, predicateRule } = rerankOptions;', replace: "const { systemPrompt, userPrompt, choiceEnum, predicateRule = 'categoryTable-v1' } = rerankOptions;" });

// ---------------------------------------------------------------------
// BG-JUDGEPRED-ORACLE — R1, and the §1.7 masked comparison against the text captured at this phase's branch cut
// ---------------------------------------------------------------------
const branchCutText = fs.readFileSync(BRANCH_CUT_BLOCK_PATH, 'utf8');
const maskedTextOf = (frozenText) => {
	const fingerprintMatchList = frozenText.match(FRAMEWORK_FINGERPRINT_TEXT_RE) || [];
	return fingerprintMatchList.length === 1 ? { maskedText: frozenText.replace(FRAMEWORK_FINGERPRINT_TEXT_RE, '"frameworkFingerprint":"MASKED"') } : { error: `frameworkFingerprint occurs ${fingerprintMatchList.length} times in the frozen text (must be exactly once)` };
};
const frozenTextOf = (outcome) => outcome.stores.decisionStore.rowList.find((oneRow) => oneRow.decisionBlockHash === outcome.runReport.decisionBlock.decisionBlockHash).frozenText;
const differingHeaderNameList = (leftBlock, rightBlock) => {
	const nameList = Array.from(new Set(Object.keys(leftBlock.header).concat(Object.keys(rightBlock.header)))).sort();
	return nameList.filter((oneName) => JSON.stringify(leftBlock.header[oneName]) !== JSON.stringify(rightBlock.header[oneName]));
};
const runEBlockTextFor = (scenario) => {
	const frozenText = fs.readFileSync(RUN_E_BLOCK_PATH, 'utf8');
	return typeof scenario.runEBlockTextTransform === 'function' ? scenario.runEBlockTextTransform(frozenText) : frozenText;
};
const ABSTENTION_RECORD_FIND = "taskDone('', { ...oneTask.baseRecord, objectStableId: null, predicate: null, predicateAssertedBy: null, sourceLabel: null, confidence: null, abstained: true, judge: judgeRecord,";
const ABSTENTION_RECORD_FORCED = "taskDone('', { ...oneTask.baseRecord, objectStableId: null, predicate: null, predicateAssertedBy: null, sourceLabel: null, confidence: null, abstained: 'forced', judge: judgeRecord,";
const oracleConjunctList = [
	pureConjunct({
		conjunctId: 'r1_runEBlockParsesAndKeepsItsId',
		title: "R1: run E's frozen block parses unchanged and blockIdFor equals the frozen literal",
		twinNameList: ['runEBlockOneByteChanged'],
		judge: (scenario) => {
			const decisionBlockLib = frameworkLibFor(scenario, 'decisionBlock.js');
			const frozenText = runEBlockTextFor(scenario);
			const parsed = decisionBlockLib.parseFrozenText(frozenText);
			const blockId = decisionBlockLib.blockIdFor({ frozenText });
			return { pass: !parsed.error && blockId === RUN_E_BLOCK_ID, detail: `${parsed.error ? `parse REFUSED: ${parsed.error.message.slice(0, 160)}` : 'parses'}; blockIdFor ${blockId}` };
		},
	}),
	runConjunct({
		conjunctId: 'a_toyDerivedBlockMaskedIdentical',
		title: `§1.7: the toy derived (categoryTable-v1) block keeps rendererVersion ${DERIVED_RENDERER_VERSION_LITERAL} and equals the text captured at this phase's cut (d3a7382) with frameworkFingerprint masked`,
		twinNameList: ['abstentionFieldForced', 'categoryTableRecordGainsPredicate'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const rendererVersion = blockOf(outcome).header.rendererVersion;
			const now = maskedTextOf(frozenTextOf(outcome));
			const then = maskedTextOf(branchCutText);
			if (now.error || then.error) {
				return { pass: false, detail: now.error || then.error };
			}
			const maskedEqual = now.maskedText === then.maskedText;
			return { pass: rendererVersion === DERIVED_RENDERER_VERSION_LITERAL && maskedEqual, detail: `rendererVersion ${rendererVersion}; masked texts ${maskedEqual ? 'EQUAL' : 'DIFFER'} (${now.maskedText.length} vs ${then.maskedText.length} bytes)` };
		}),
	}),
	runConjunct({
		conjunctId: 'm_unmaskedDiffersOnlyInFrameworkFingerprint',
		title: '§1.7 (m): unmasked, the toy derived block and the branch-cut text differ in exactly one header key, frameworkFingerprint',
		twinNameList: ['abstentionFieldForcedUnmasked'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const nowBlock = JSON.parse(frozenTextOf(outcome));
			const thenBlock = JSON.parse(branchCutText);
			const headerDiffList = differingHeaderNameList(nowBlock, thenBlock);
			const bodyEqual = JSON.stringify(nowBlock.decisionRecordList) === JSON.stringify(thenBlock.decisionRecordList) && JSON.stringify(nowBlock.refusalList) === JSON.stringify(thenBlock.refusalList);
			return { pass: headerDiffList.length === 1 && headerDiffList[0] === 'frameworkFingerprint' && bodyEqual, detail: `differing header keys [${headerDiffList.join(', ')}]; records and refusals ${bodyEqual ? 'equal' : 'DIFFER'}` };
		}),
	}),
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED-ORACLE', conjunctId: 'r1_runEBlockParsesAndKeepsItsId', twinName: 'runEBlockOneByteChanged', leverKind: 'inputFault', mutate: (scenario) => { scenario.runEBlockTextTransform = (frozenText) => frozenText.replace('"frameworkGeneration":"', '"frameworkGeneration":"x'); } });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED-ORACLE', conjunctId: 'a_toyDerivedBlockMaskedIdentical', twinName: 'abstentionFieldForced', fileName: FRAMEWORK_FILE, find: ABSTENTION_RECORD_FIND, replace: ABSTENTION_RECORD_FORCED });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED-ORACLE', conjunctId: 'a_toyDerivedBlockMaskedIdentical', twinName: 'categoryTableRecordGainsPredicate', fileName: FRAMEWORK_FILE, find: 'if (judged.chosenCardStableId !== null && judged.predicate !== undefined) {\n\t\t\t\t\t\t\t\t\tjudgeRecord.predicate = judged.predicate;', replace: "if (judged.chosenCardStableId !== null) {\n\t\t\t\t\t\t\t\t\tjudgeRecord.predicate = judged.predicate === undefined ? 'leaked' : judged.predicate;" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEPRED-ORACLE', conjunctId: 'm_unmaskedDiffersOnlyInFrameworkFingerprint', twinName: 'abstentionFieldForcedUnmasked', fileName: FRAMEWORK_FILE, find: ABSTENTION_RECORD_FIND, replace: ABSTENTION_RECORD_FORCED });

const gateDeclarationList = [
	{ gateId: 'BG-JUDGEPRED', title: 'the judges, the verifier and the cache carry the judge predicate under judgeSlot-v1, with categoryTable-v1 unmoved', conjunctList: [].concat(verifierConjunctList, cacheConjunctList, categoryTableConjunctList, debugConjunctList, toyRunConjunctList, foldConjunctList, registryConjunctList, providerConjunctList) },
	{ gateId: 'BG-JUDGEPRED-ORACLE', title: 'run E still replays hermetically, and the toy Ed-Fi-shaped block is unmoved but for its framework fingerprint', conjunctList: oracleConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-JUDGEPRED+BG-JUDGEPRED-ORACLE', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 17 + 3 },
	() => harness.report(),
);
