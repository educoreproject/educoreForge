#!/usr/bin/env node
'use strict';

// test-bgJudgeSlot.js — BG-JUDGESLOT: the judge-slot contract and its own prompt variant (PLAN-sifReplacement-smallPhases
// §3 B3a; SPEC-sifStructuralBridge-replacement §9 A11), plus the oracle conjuncts B3a owes (§1.6 R1, §1.7).
//
//   BG-JUDGESLOT  (a) DERIVED_RENDERER_VERSION is the frozen literal, and the toy derived block keeps that rendererVersion
//                 and equals the branch-cut text with frameworkFingerprint masked; (m) unmasked, the two differ in exactly
//                 that one header key; (b) the categoryTable-v1 rendering still hashes to X0's v12 pin, and the
//                 judgeSlot-v1 rendering carries a required predicate enum in every dialect; (c) judgeSlot-v1 paired with
//                 judgePromptVariant 'derived' is refused by name, paired with 'derivedJudgeSlot' it registers without a
//                 predicateByCategory table, and with one it is refused; the derivedJudgeSlot variant renders the derived
//                 prompts under its own renderer version; (d) the shipped plugins resolve to the variants they had;
//                 (e) an unregistered (basis, rule) pair is refused by name; (f) all five shipped plugins register through
//                 pluginRegistry discovery; (g) the judgeSlot-v1 tool text has a row in the prompt identifier scan.
//   BG-JUDGESLOT-ORACLE  (R1) run E's frozen block parses unchanged and keeps its id.
//
// Run: node lib/bridge-framework/test/test-bgJudgeSlot.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-JUDGESLOT + BG-JUDGESLOT-ORACLE

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, pureConjunct, succeeded, frameworkMutationTwin, scenarioTwin, blockOf } = require('./testSupport/bridgeTwinFactories');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const CROSSWALK_PLUGIN_NAME = 'toyCrosswalkPlugin';
const CONTRACT_FILE = 'bridgePluginContract.js';
const RENDERER_FILE = 'evidenceRenderer.js';
const SCAN_FILE = 'promptIdentifierScan.js';
const REGISTRY_FILE = 'pluginRegistry.js';
const TOY_EMBED_MODEL = 'toy-embed-v1';
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const SCHEMA_FILE_PATH = path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'selectCandidateSchema.js');
const TOY_BUNDLE_DIR = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy');
const cloneJson = scenarioLib.cloneJson;
const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

// the frozen literals this phase is measured against
const DERIVED_RENDERER_VERSION_LITERAL = 'bridgeEvidenceRenderer-derived-v12';
const JUDGE_SLOT_RENDERER_VERSION_LITERAL = 'bridgeEvidenceRenderer-derivedJudgeSlot-v1';
const CROSSWALK_RENDERER_VERSION_LITERAL = 'bridgeEvidenceRenderer-v1';
const BRANCH_CUT_BLOCK_PATH = path.join(__dirname, 'fixtures', 'toyBridge', 'branchCutBlocks', 'toyDerivedPlugin-B3abranchCut-7254e2f.frozenText.json');
const RUN_E_BLOCK_PATH = path.join(TREE_ROOT, '..', '..', 'dataStores', 'bridgeAcceptance', 'edfiEval', 'runE_091726', 'block.json');
const RUN_E_BLOCK_ID = '7e362cebe7bb74d572e643eed37944d2577eb850313028bc0b9eb11f245c8755';
const FRAMEWORK_FINGERPRINT_TEXT_RE = /"frameworkFingerprint":"[0-9a-f]{64}"/g;
// X0's v12 pin (apps/graph-builder/test/test-selectCandidateSchema.js ANTHROPIC_RENDERING_BASELINE_SHA256) and the
// choiceEnum it was captured with
const X0_ANTHROPIC_RENDERING_SHA256 = '96fc8257688b7080db84491405a023ec724e6e88f8a82c1b04d7f71088cf2feb';
const X0_CHOICE_ENUM_FIXTURE = Object.freeze(['1', '2', '3', 'NONE']);
const JUDGE_SLOT_PREDICATE_ENUM_LITERAL = Object.freeze(['exactMatch', 'closeMatch', 'broadMatch', 'narrowMatch', 'none']);

// every bridge plugin shipped under forges/ on 2026-09-28, with the variant and renderer version each resolves to
const SHIPPED_PLUGIN_LIST = [
	{ bridgeName: 'sifCedsStandardPlugin', pluginPath: 'forges/sif/bridges/sifCedsStandardPlugin.js', judgePromptVariant: 'crosswalk', rendererVersion: CROSSWALK_RENDERER_VERSION_LITERAL },
	{ bridgeName: 'edfiCedsCrosswalkPlugin', pluginPath: 'forges/edfi/bridges/edfiCedsCrosswalkPlugin.js', judgePromptVariant: 'crosswalk', rendererVersion: CROSSWALK_RENDERER_VERSION_LITERAL },
	// MOVED 2026-09-30 (IVORY_ECHO, WORKORDER-jevRelations-093026 R2, TQ ruling "every bridge uses judge-named relations"):
	// Ed-Fi derived now declares predicateRule judgeSlot-v1, so it resolves to derivedJudgeSlot. Was: 'derived' / derived-v12.
	{ bridgeName: 'edfiCedsDerivedPlugin', pluginPath: 'forges/edfi/bridges/edfiCedsDerivedPlugin.js', judgePromptVariant: 'derivedJudgeSlot', rendererVersion: JUDGE_SLOT_RENDERER_VERSION_LITERAL },
	{ bridgeName: 'pescCedsDerivedPlugin', pluginPath: 'forges/pesc260805/bridges/pescCedsDerivedPlugin.js', judgePromptVariant: 'derived', rendererVersion: DERIVED_RENDERER_VERSION_LITERAL },
	{ bridgeName: 'pescOptionSetCedsDerivedPlugin', pluginPath: 'forges/pesc260805/bridges/pescOptionSetCedsDerivedPlugin.js', judgePromptVariant: 'derived', rendererVersion: DERIVED_RENDERER_VERSION_LITERAL },
	{ bridgeName: 'sif260928CedsDerivedPlugin', pluginPath: 'forges/sif260928/bridges/sif260928CedsDerivedPlugin.js', judgePromptVariant: 'derivedJudgeSlot', rendererVersion: JUDGE_SLOT_RENDERER_VERSION_LITERAL },
	// ADDED 2026-10-01 (COPPER_MARBLE, PESC B1, QUIET_ORBIT-authorised): the PESC College Transcript 1.8.0 derived plugin,
	// judgeSlot-v1 like SIF 260928, so it resolves to derivedJudgeSlot.
	{ bridgeName: 'pescCollegeTranscript1v8v0CedsDerivedPlugin', pluginPath: 'forges/pesccollegetranscript1v8v0/bridges/pescCollegeTranscript1v8v0CedsDerivedPlugin.js', judgePromptVariant: 'derivedJudgeSlot', rendererVersion: JUDGE_SLOT_RENDERER_VERSION_LITERAL },
	// ADDED 2026-10-01 (DAWN_CHORUS, PESC lane E, roster literals pre-authorised): the PESC Academic ePortfolio 1.0.0 derived
	// plugin, judgeSlot-v1 like College Transcript, so it resolves to derivedJudgeSlot.
	{ bridgeName: 'pescAcademicEportfolio1v0v0CedsDerivedPlugin', pluginPath: 'forges/pescacademiceportfolio1v0v0/bridges/pescAcademicEportfolio1v0v0CedsDerivedPlugin.js', judgePromptVariant: 'derivedJudgeSlot', rendererVersion: JUDGE_SLOT_RENDERER_VERSION_LITERAL },
];

// ---------------------------------------------------------------------
// module loading: the real module, or a double carrying the scenario's mutations
// ---------------------------------------------------------------------
const frameworkLibFor = (scenario, fileName) =>
	(scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, fileName), mutationList: scenario.frameworkMutationList }) : require(path.join(scenarioLib.FRAMEWORK_DIR, fileName)));
const schemaLibFor = (scenario) =>
	(scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: SCHEMA_FILE_PATH, mutationList: scenario.frameworkMutationList }) : require(SCHEMA_FILE_PATH));
// selectCandidateSchema.js lives outside lib/bridge-framework, so its twins name the file by absolute path
const schemaMutationTwin = ({ gateId, conjunctId, twinName, find, replace }) =>
	twinRegistry.register({
		gateId,
		conjunctId,
		twinName,
		leverKind: 'productionMutation',
		shippedConfig: true,
		run: (scenario) => {
			moduleDouble.assertMutationApplies({ modulePath: SCHEMA_FILE_PATH, find });
			scenario.frameworkMutationList.push({ modulePath: SCHEMA_FILE_PATH, find, replace });
			return scenario;
		},
	});

// ---------------------------------------------------------------------
// declarations
// ---------------------------------------------------------------------
const toyDeclarationOf = (pluginName) => cloneJson(require(path.join(TOY_BUNDLE_DIR, 'bridges', `${pluginName}.js`)).bridgeDeclaration);
const judgeSlotDeclaration = ({ judgePromptVariant, keepPredicateByCategory }) => {
	const bridgeDeclaration = toyDeclarationOf(DERIVED_PLUGIN_NAME);
	bridgeDeclaration.predicateSource = { kind: 'judge', predicateRule: 'judgeSlot-v1' };
	bridgeDeclaration.judgePromptVariant = judgePromptVariant;
	if (!keepPredicateByCategory) {
		delete bridgeDeclaration.predicateByCategory;
	}
	return bridgeDeclaration;
};
const validationOf = (scenario, bridgeDeclaration) => frameworkLibFor(scenario, CONTRACT_FILE).validateBridgeDeclaration({ bridgeDeclaration, bundleDirPath: TOY_BUNDLE_DIR });
const refusalConjunct = ({ conjunctId, title, twinNameList, declarationFor, refusalRe }) =>
	pureConjunct({
		conjunctId,
		title,
		twinNameList,
		judge: (scenario) => {
			const validated = validationOf(scenario, declarationFor());
			if (!validated.error) {
				return { pass: false, detail: 'expected a refusal but the declaration REGISTERED' };
			}
			return { pass: refusalRe.test(validated.error.message), detail: `refused: ${validated.error.message.slice(0, 260)}` };
		},
	});

// ---------------------------------------------------------------------
// the toy derived run and the masked comparison (§1.7, round-2 N2)
// ---------------------------------------------------------------------
const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};
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

// a fixed question for the renderer: one subject, two candidates, the toy derived allow-list
const rendererInputFor = (judgePromptVariant) => {
	const renderingAllowList = toyDeclarationOf(DERIVED_PLUGIN_NAME).renderingAllowList;
	return {
		sourceElement: { name: 'FirstName', material: { name: 'FirstName', description: 'The given name of the person.', owningConstructName: 'Person' } },
		candidatePool: [
			{ card: { stableId: 'toy:card/1', name: 'First Name', propertyDefinition: 'A given name.', domainName: 'Person', domainDefinition: 'A human being.' }, seatReason: 'retrieval' },
			{ card: { stableId: 'toy:card/2', name: 'Last Name', propertyDefinition: 'A family name.', domainName: 'Person', domainDefinition: 'A human being.' }, seatReason: 'retrieval' },
		],
		judgePromptVariant,
		renderingAllowList,
	};
};

// the finds the twins mutate
const DERIVED_VERSION_FIND = "const DERIVED_RENDERER_VERSION = 'bridgeEvidenceRenderer-derived-v12';";
const DERIVED_VERSION_BUMPED = "const DERIVED_RENDERER_VERSION = 'bridgeEvidenceRenderer-derived-v13';";
const CATEGORY_TABLE_ROW_FIND = "[PREDICATE_RULE_CATEGORY_TABLE_V1]: 'derived',";
const CATEGORY_TABLE_ROW_TO_JUDGE_SLOT = "[PREDICATE_RULE_CATEGORY_TABLE_V1]: 'derivedJudgeSlot',";
const VARIANT_CROSS_KEY_FIND = 'if (bridgeDeclaration.judgePromptVariant !== undefined && bridgeDeclaration.judgePromptVariant !== variantResolved.judgePromptVariant) {';

// ---------------------------------------------------------------------
// BG-JUDGESLOT
// ---------------------------------------------------------------------
const judgeSlotConjunctList = [
	pureConjunct({
		conjunctId: 'a_derivedRendererVersionIsTheFrozenLiteral',
		title: `DERIVED_RENDERER_VERSION === '${DERIVED_RENDERER_VERSION_LITERAL}', and the derived variant row carries it`,
		twinNameList: ['derivedRendererVersionBumped'],
		judge: (scenario) => {
			const rendererLib = frameworkLibFor(scenario, RENDERER_FILE);
			const rowVersion = rendererLib.JUDGE_PROMPT_VARIANT_REGISTRY.derived.rendererVersion;
			return { pass: rendererLib.DERIVED_RENDERER_VERSION === DERIVED_RENDERER_VERSION_LITERAL && rowVersion === DERIVED_RENDERER_VERSION_LITERAL, detail: `DERIVED_RENDERER_VERSION ${rendererLib.DERIVED_RENDERER_VERSION}; derived row ${rowVersion}` };
		},
	}),
	runConjunct({
		conjunctId: 'a_toyDerivedBlockKeepsRendererVersionAndMaskedText',
		title: `the toy derived block's rendererVersion is ${DERIVED_RENDERER_VERSION_LITERAL}, and the block equals the branch-cut text with frameworkFingerprint masked`,
		twinNameList: ['derivedRendererVersionBumpedInRun', 'categoryTableMappedToJudgeSlotInRun'],
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
		title: 'unmasked, the toy derived block and the branch-cut text differ in exactly one header key, frameworkFingerprint',
		twinNameList: ['derivedRendererVersionBumpedUnmasked'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const nowBlock = JSON.parse(frozenTextOf(outcome));
			const thenBlock = JSON.parse(branchCutText);
			const headerDiffList = differingHeaderNameList(nowBlock, thenBlock);
			const bodyEqual = JSON.stringify(nowBlock.decisionRecordList) === JSON.stringify(thenBlock.decisionRecordList) && JSON.stringify(nowBlock.refusalList) === JSON.stringify(thenBlock.refusalList);
			return { pass: headerDiffList.length === 1 && headerDiffList[0] === 'frameworkFingerprint' && bodyEqual, detail: `differing header keys [${headerDiffList.join(', ')}]; records and refusals ${bodyEqual ? 'equal' : 'DIFFER'}` };
		}),
	}),
	pureConjunct({
		conjunctId: 'b_categoryTableRenderingKeepsX0Pin',
		title: "the categoryTable-v1 rendering, by either entry point, still hashes to X0's v12 pin (the categoryTable schema is unchanged)",
		twinNameList: ['predicateSentenceLeaksIntoSharedDescription'],
		judge: (scenario) => {
			const schemaLib = schemaLibFor(scenario);
			const directSha = sha256(JSON.stringify(schemaLib.renderSelectCandidateSchema('anthropic', { choiceEnum: X0_CHOICE_ENUM_FIXTURE }), null, 2));
			const byRuleSha = sha256(JSON.stringify(schemaLib.renderSelectCandidateSchemaForPredicateRule('anthropic', { choiceEnum: X0_CHOICE_ENUM_FIXTURE, predicateRule: 'categoryTable-v1' }), null, 2));
			return { pass: directSha === X0_ANTHROPIC_RENDERING_SHA256 && byRuleSha === X0_ANTHROPIC_RENDERING_SHA256, detail: `renderSelectCandidateSchema ${directSha.slice(0, 12)}, by rule ${byRuleSha.slice(0, 12)}, pin ${X0_ANTHROPIC_RENDERING_SHA256.slice(0, 12)}` };
		},
	}),
	pureConjunct({
		conjunctId: 'b_judgeSlotRenderingCarriesRequiredPredicate',
		title: `in every dialect, the judgeSlot-v1 rendering has a required string predicate with enum exactly ${JUDGE_SLOT_PREDICATE_ENUM_LITERAL.join(' | ')}, and the categoryTable-v1 rendering has none`,
		twinNameList: ['predicateDroppedFromRequired'],
		judge: (scenario) => {
			const schemaLib = schemaLibFor(scenario);
			const faultList = [];
			schemaLib.SCHEMA_DIALECT_NAME_LIST.forEach((oneDialectName) => {
				const judgeSlotRendering = schemaLib.renderSelectCandidateSchemaForPredicateRule(oneDialectName, { choiceEnum: X0_CHOICE_ENUM_FIXTURE, predicateRule: 'judgeSlot-v1' });
				const categoryTableRendering = schemaLib.renderSelectCandidateSchema(oneDialectName, { choiceEnum: X0_CHOICE_ENUM_FIXTURE });
				const judgeSlotJsonSchema = judgeSlotRendering.input_schema || judgeSlotRendering;
				const categoryTableJsonSchema = categoryTableRendering.input_schema || categoryTableRendering;
				const predicateProperty = judgeSlotJsonSchema.properties.predicate;
				if (predicateProperty === undefined || predicateProperty.type !== 'string' || JSON.stringify(predicateProperty.enum) !== JSON.stringify(JUDGE_SLOT_PREDICATE_ENUM_LITERAL)) {
					faultList.push(`${oneDialectName}: predicate property ${JSON.stringify(predicateProperty && { type: predicateProperty.type, enum: predicateProperty.enum })}`);
				}
				if (judgeSlotJsonSchema.required.indexOf('predicate') === -1) {
					faultList.push(`${oneDialectName}: predicate is not required`);
				}
				if (categoryTableJsonSchema.properties.predicate !== undefined || categoryTableJsonSchema.required.indexOf('predicate') !== -1) {
					faultList.push(`${oneDialectName}: the categoryTable-v1 rendering carries a predicate`);
				}
			});
			return { pass: faultList.length === 0, detail: faultList.length ? faultList.join('; ') : `${schemaLib.SCHEMA_DIALECT_NAME_LIST.join(', ')}: required predicate enum present under judgeSlot-v1, absent under categoryTable-v1` };
		},
	}),
	refusalConjunct({
		conjunctId: 'c_judgeSlotWithDerivedVariantRefused',
		title: "a declaration pairing predicateRule judgeSlot-v1 with judgePromptVariant 'derived' is refused by name",
		twinNameList: ['variantCrossKeyCheckDeleted'],
		declarationFor: () => judgeSlotDeclaration({ judgePromptVariant: 'derived', keepPredicateByCategory: false }),
		refusalRe: /judgePromptVariant 'derived' disagrees with VARIANT_BY_BASIS_AND_PREDICATE_RULE for \(matchBasis 'derived', predicateRule 'judgeSlot-v1'\), which names 'derivedJudgeSlot'/,
	}),
	pureConjunct({
		conjunctId: 'c_judgeSlotDeclarationRegistersWithoutTable',
		title: "judgeSlot-v1 with judgePromptVariant 'derivedJudgeSlot' and NO predicateByCategory registers, and resolves to derivedJudgeSlot",
		twinNameList: ['predicateByCategoryRequiredUnderJudgeSlot'],
		judge: (scenario) => {
			const bridgeDeclaration = judgeSlotDeclaration({ judgePromptVariant: 'derivedJudgeSlot', keepPredicateByCategory: false });
			const validated = validationOf(scenario, bridgeDeclaration);
			if (validated.error) {
				return { pass: false, detail: `REFUSED: ${validated.error.message.slice(0, 260)}` };
			}
			const resolved = frameworkLibFor(scenario, CONTRACT_FILE).judgePromptVariantFor({ bridgeDeclaration });
			return { pass: resolved.judgePromptVariant === 'derivedJudgeSlot', detail: `registers; resolves to ${JSON.stringify(resolved)}` };
		},
	}),
	refusalConjunct({
		conjunctId: 'c_judgeSlotWithPredicateByCategoryRefused',
		title: 'under judgeSlot-v1 a predicateByCategory table is FORBIDDEN, refused by name (EBONY_DREAM ruling: a table nothing reads is dead config)',
		twinNameList: ['predicateByCategoryMadePlainOptional'],
		declarationFor: () => judgeSlotDeclaration({ judgePromptVariant: 'derivedJudgeSlot', keepPredicateByCategory: true }),
		refusalRe: /carries key 'predicateByCategory' which is FORBIDDEN while predicateSource\.predicateRule is not "categoryTable-v1"/,
	}),
	pureConjunct({
		conjunctId: 'c_derivedJudgeSlotRendersDerivedPromptsUnderItsOwnVersion',
		title: `the derivedJudgeSlot variant renders the derived system and user prompts byte for byte, under ${JUDGE_SLOT_RENDERER_VERSION_LITERAL}, so its promptHash differs`,
		twinNameList: ['judgeSlotGivenDerivedRendererVersion'],
		judge: (scenario) => {
			const rendererLib = frameworkLibFor(scenario, RENDERER_FILE);
			const derivedQuestion = rendererLib.renderQuestion(rendererInputFor('derived'));
			const judgeSlotQuestion = rendererLib.renderQuestion(rendererInputFor('derivedJudgeSlot'));
			if (derivedQuestion.error || judgeSlotQuestion.error) {
				return { pass: false, detail: `render REFUSED: ${(derivedQuestion.error || judgeSlotQuestion.error).message.slice(0, 200)}` };
			}
			const promptsEqual = derivedQuestion.systemPrompt === judgeSlotQuestion.systemPrompt && derivedQuestion.userPrompt === judgeSlotQuestion.userPrompt;
			const pass = promptsEqual && judgeSlotQuestion.rendererVersion === JUDGE_SLOT_RENDERER_VERSION_LITERAL && derivedQuestion.rendererVersion === DERIVED_RENDERER_VERSION_LITERAL && judgeSlotQuestion.promptHash !== derivedQuestion.promptHash;
			return { pass, detail: `prompts ${promptsEqual ? 'equal' : 'DIFFER'}; versions ${derivedQuestion.rendererVersion} / ${judgeSlotQuestion.rendererVersion}; promptHash ${derivedQuestion.promptHash.slice(0, 12)} / ${judgeSlotQuestion.promptHash.slice(0, 12)}` };
		},
	}),
	pureConjunct({
		conjunctId: 'd_shippedPluginsResolveToTheirVariants',
		title: `the PESC derived plugins resolve to 'derived' (${DERIVED_RENDERER_VERSION_LITERAL}); the Ed-Fi and SIF 260928 derived plugins to 'derivedJudgeSlot' (${JUDGE_SLOT_RENDERER_VERSION_LITERAL}); the two documentary plugins resolve to 'crosswalk'`,
		twinNameList: ['categoryTableMappedToJudgeSlot'],
		judge: (scenario) => {
			const contractLib = frameworkLibFor(scenario, CONTRACT_FILE);
			const rendererLib = frameworkLibFor(scenario, RENDERER_FILE);
			const faultList = SHIPPED_PLUGIN_LIST.map((onePlugin) => {
				const resolved = contractLib.judgePromptVariantFor({ bridgeDeclaration: require(path.join(TREE_ROOT, onePlugin.pluginPath)).bridgeDeclaration });
				const rendererVersion = resolved.judgePromptVariant === undefined ? null : rendererLib.JUDGE_PROMPT_VARIANT_REGISTRY[resolved.judgePromptVariant].rendererVersion;
				return resolved.judgePromptVariant === onePlugin.judgePromptVariant && rendererVersion === onePlugin.rendererVersion ? null : `${onePlugin.bridgeName}: ${JSON.stringify(resolved)} ${rendererVersion}`;
			}).filter((oneFault) => oneFault !== null);
			return { pass: faultList.length === 0, detail: faultList.length ? faultList.join(' | ') : `${SHIPPED_PLUGIN_LIST.length} shipped plugins resolve as before` };
		},
	}),
	refusalConjunct({
		conjunctId: 'e_unregisteredPairRefused',
		title: "an unregistered pair, (crosswalk, judgeSlot-v1), is refused by name at registration",
		twinNameList: ['wildcardVariantDefault'],
		declarationFor: () => {
			const bridgeDeclaration = toyDeclarationOf(CROSSWALK_PLUGIN_NAME);
			bridgeDeclaration.predicateSource = { kind: 'judge', predicateRule: 'judgeSlot-v1' };
			return bridgeDeclaration;
		},
		refusalRe: /\(matchBasis 'crosswalk', predicateRule 'judgeSlot-v1'\) names no VARIANT_BY_BASIS_AND_PREDICATE_RULE row/,
	}),
	pureConjunct({
		conjunctId: 'f_allShippedPluginsRegisterThroughDiscovery',
		title: `pluginRegistry.buildRegistryFromDirectory over the real forges/ registers exactly the ${SHIPPED_PLUGIN_LIST.length} shipped plugins and does not throw`,
		twinNameList: ['standardRowDeleted'],
		judge: (scenario) => {
			const registryLib = frameworkLibFor(scenario, REGISTRY_FILE);
			let registry = null;
			let thrownText = '';
			// discovery THROWS by name on any refusal (its declared interface); the throw is this conjunct's red detail
			try {
				registry = registryLib.buildRegistryFromDirectory({ forgesDirPath: path.join(TREE_ROOT, 'forges') });
			} catch (thrown) {
				thrownText = thrown.message;
			}
			if (registry === null) {
				return { pass: false, detail: `discovery THREW: ${thrownText.slice(0, 300)}` };
			}
			const registeredNameList = Object.keys(registry.entryByBridgeName).sort();
			const expectedNameList = SHIPPED_PLUGIN_LIST.map((onePlugin) => onePlugin.bridgeName).sort();
			return { pass: JSON.stringify(registeredNameList) === JSON.stringify(expectedNameList), detail: `registered [${registeredNameList.join(', ')}]` };
		},
	}),
	pureConjunct({
		conjunctId: 'g_judgeSlotToolTextHasAScanRow',
		title: 'the prompt identifier scan has a judgeSlot-v1 tool-text row: every dialect line carries the predicate slot, and its text differs from categoryTable-v1',
		twinNameList: ['judgeSlotToolTextRowDeleted'],
		judge: (scenario) => {
			const scanLib = frameworkLibFor(scenario, SCAN_FILE);
			const judgeSlotRenderer = scanLib.TOOL_TEXT_RENDERER_BY_PREDICATE_RULE['judgeSlot-v1'];
			if (typeof judgeSlotRenderer !== 'function') {
				return { pass: false, detail: `TOOL_TEXT_RENDERER_BY_PREDICATE_RULE has no judgeSlot-v1 row (rows: ${Object.keys(scanLib.TOOL_TEXT_RENDERER_BY_PREDICATE_RULE).join(', ')})` };
			}
			const judgeSlotText = judgeSlotRenderer({ choiceEnum: X0_CHOICE_ENUM_FIXTURE.slice() });
			const categoryTableText = scanLib.TOOL_TEXT_RENDERER_BY_PREDICATE_RULE['categoryTable-v1']({ choiceEnum: X0_CHOICE_ENUM_FIXTURE.slice() });
			const lineList = judgeSlotText.split('\n');
			const linesWithSlot = lineList.filter((oneLine) => oneLine.indexOf('"predicate":{"type":"string","enum":["exactMatch","closeMatch","broadMatch","narrowMatch","none"]') !== -1).length;
			return { pass: lineList.length >= 2 && linesWithSlot === lineList.length && judgeSlotText !== categoryTableText, detail: `${linesWithSlot}/${lineList.length} dialect line(s) carry the slot; differs from categoryTable-v1: ${judgeSlotText !== categoryTableText}` };
		},
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESLOT', conjunctId: 'a_derivedRendererVersionIsTheFrozenLiteral', twinName: 'derivedRendererVersionBumped', fileName: RENDERER_FILE, find: DERIVED_VERSION_FIND, replace: DERIVED_VERSION_BUMPED });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESLOT', conjunctId: 'a_toyDerivedBlockKeepsRendererVersionAndMaskedText', twinName: 'derivedRendererVersionBumpedInRun', fileName: RENDERER_FILE, find: DERIVED_VERSION_FIND, replace: DERIVED_VERSION_BUMPED });
// (d)'s twin, carried into the run. Mapped alone, the row makes registration refuse the toy (it declares 'derived'), so
// the run never reaches the check this conjunct makes; the cross-key check is therefore also removed, the run judges
// under derivedJudgeSlot, and the conjunct goes red on the block's own rendererVersion.
twinRegistry.register({
	gateId: 'BG-JUDGESLOT',
	conjunctId: 'a_toyDerivedBlockKeepsRendererVersionAndMaskedText',
	twinName: 'categoryTableMappedToJudgeSlotInRun',
	leverKind: 'productionMutation',
	shippedConfig: true,
	run: (scenario) => {
		const contractFilePath = path.join(scenarioLib.FRAMEWORK_DIR, CONTRACT_FILE);
		[{ find: CATEGORY_TABLE_ROW_FIND, replace: CATEGORY_TABLE_ROW_TO_JUDGE_SLOT }, { find: VARIANT_CROSS_KEY_FIND, replace: 'if (false) {' }].forEach((oneMutation) => {
			moduleDouble.assertMutationApplies({ modulePath: contractFilePath, find: oneMutation.find });
			scenario.frameworkMutationList.push({ modulePath: contractFilePath, ...oneMutation });
		});
		return scenario;
	},
});
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESLOT', conjunctId: 'm_unmaskedDiffersOnlyInFrameworkFingerprint', twinName: 'derivedRendererVersionBumpedUnmasked', fileName: RENDERER_FILE, find: DERIVED_VERSION_FIND, replace: DERIVED_VERSION_BUMPED });
schemaMutationTwin({ gateId: 'BG-JUDGESLOT', conjunctId: 'b_categoryTableRenderingKeepsX0Pin', twinName: 'predicateSentenceLeaksIntoSharedDescription', find: "`category MUST be ${ABSTAIN_CATEGORY_NAME}: an abstention carries no confidence about any candidate.`;", replace: "`category MUST be ${ABSTAIN_CATEGORY_NAME}: an abstention carries no confidence about any candidate. You MUST ALSO record a PREDICATE.`;" });
schemaMutationTwin({ gateId: 'BG-JUDGESLOT', conjunctId: 'b_judgeSlotRenderingCarriesRequiredPredicate', twinName: 'predicateDroppedFromRequired', find: "\t\t.concat(['predicate'])\n", replace: '\t\t.concat([])\n' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESLOT', conjunctId: 'c_judgeSlotWithDerivedVariantRefused', twinName: 'variantCrossKeyCheckDeleted', fileName: CONTRACT_FILE, find: VARIANT_CROSS_KEY_FIND, replace: 'if (false) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESLOT', conjunctId: 'c_judgeSlotDeclarationRegistersWithoutTable', twinName: 'predicateByCategoryRequiredUnderJudgeSlot', fileName: CONTRACT_FILE, find: "presentIff: Object.freeze({ key: 'predicateSource', member: 'predicateRule', value: PREDICATE_RULE_CATEGORY_TABLE_V1 })", replace: "presentIff: Object.freeze({ key: 'predicateSource', member: 'kind', value: 'judge' })" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESLOT', conjunctId: 'c_judgeSlotWithPredicateByCategoryRefused', twinName: 'predicateByCategoryMadePlainOptional', fileName: CONTRACT_FILE, find: "predicateByCategory: Object.freeze({ required: false, kind: 'predicateByCategory', presentIff: Object.freeze({ key: 'predicateSource', member: 'predicateRule', value: PREDICATE_RULE_CATEGORY_TABLE_V1 }) }),", replace: "predicateByCategory: Object.freeze({ optional: true, kind: 'predicateByCategory' })," });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESLOT', conjunctId: 'c_derivedJudgeSlotRendersDerivedPromptsUnderItsOwnVersion', twinName: 'judgeSlotGivenDerivedRendererVersion', fileName: RENDERER_FILE, find: "derivedJudgeSlot: Object.freeze({ ...DERIVED_VARIANT_ROW, rendererVersion: DERIVED_JUDGE_SLOT_RENDERER_VERSION, judgePredicateRule: 'judgeSlot-v1' }),", replace: "derivedJudgeSlot: Object.freeze({ ...DERIVED_VARIANT_ROW, rendererVersion: DERIVED_RENDERER_VERSION, judgePredicateRule: 'judgeSlot-v1' })," });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESLOT', conjunctId: 'd_shippedPluginsResolveToTheirVariants', twinName: 'categoryTableMappedToJudgeSlot', fileName: CONTRACT_FILE, find: CATEGORY_TABLE_ROW_FIND, replace: CATEGORY_TABLE_ROW_TO_JUDGE_SLOT });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESLOT', conjunctId: 'e_unregisteredPairRefused', twinName: 'wildcardVariantDefault', fileName: CONTRACT_FILE, find: 'if (!Object.prototype.hasOwnProperty.call(variantByPredicateRule, predicateRule)) {', replace: "if (!Object.prototype.hasOwnProperty.call(variantByPredicateRule, predicateRule)) { return { judgePromptVariant: 'crosswalk' };" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESLOT', conjunctId: 'f_allShippedPluginsRegisterThroughDiscovery', twinName: 'standardRowDeleted', fileName: CONTRACT_FILE, find: "\tstandard: Object.freeze({ [NO_JUDGE_PREDICATE_RULE]: 'crosswalk' }),\n", replace: '' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGESLOT', conjunctId: 'g_judgeSlotToolTextHasAScanRow', twinName: 'judgeSlotToolTextRowDeleted', fileName: SCAN_FILE, find: "\t'judgeSlot-v1': ({ choiceEnum }) =>", replace: "\t'judgeSlot-v1-deleted': ({ choiceEnum }) =>" });

// ---------------------------------------------------------------------
// BG-JUDGESLOT-ORACLE — R1: run E's frozen block still replays hermetically
// ---------------------------------------------------------------------
const runEBlockTextFor = (scenario) => {
	const frozenText = fs.readFileSync(RUN_E_BLOCK_PATH, 'utf8');
	return typeof scenario.runEBlockTextTransform === 'function' ? scenario.runEBlockTextTransform(frozenText) : frozenText;
};
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
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-JUDGESLOT-ORACLE', conjunctId: 'r1_runEBlockParsesAndKeepsItsId', twinName: 'runEBlockOneByteChanged', leverKind: 'inputFault', mutate: (scenario) => { scenario.runEBlockTextTransform = (frozenText) => frozenText.replace('"frameworkGeneration":"', '"frameworkGeneration":"x'); } });

const gateDeclarationList = [
	{ gateId: 'BG-JUDGESLOT', title: 'the judge-slot contract and its own prompt variant, with nothing about the derived variant moved', conjunctList: judgeSlotConjunctList },
	{ gateId: 'BG-JUDGESLOT-ORACLE', title: 'run E still replays hermetically', conjunctList: oracleConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-JUDGESLOT+BG-JUDGESLOT-ORACLE', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 13 + 1 },
	() => harness.report(),
);
