#!/usr/bin/env node
'use strict';

// test-bgJudgeConfig.js — BG-JUDGECONFIG: the judge's configuration and each rationale in the frozen block, opt-in by
// blockRecordsJudgeConfig (PLAN-sifReplacement-smallPhases §3 B2; SPEC-sifStructuralBridge-replacement §9 A12), plus the
// oracle conjuncts B2 owes (§1.6 R1, §1.7). Every run is the toy derived plugin over the graph double: under the DEBUG
// judge, or under the REAL llmClient driven through its own postOnce seam with a throwaway ini (no socket, no spend).
//
//   BG-JUDGECONFIG  (a0) opted in under the debug judge, the header carries the three keys and every judged record its
//                   rationale; (a1) opted in under the real llmClient, the header carries the temperature policy and the
//                   ini's maxTokens, and every record carries, word for word, the rationale the wire returned for it;
//                   (a2) changing maxTokens in the ini moves the block id; (a3) the tool-schema sha follows the tool text;
//                   (b) opted out, the toy derived block equals the branch-cut text with frameworkFingerprint masked;
//                   (m) unmasked, the two differ in exactly that one header key.
//   BG-JUDGECONFIG-ORACLE  (§1.7) the shipped Ed-Fi and PESC plugins register with the key absent; (R1 = gate c) run E's
//                   frozen block parses unchanged and keeps its id.
//
// Run: node lib/bridge-framework/test/test-bgJudgeConfig.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-JUDGECONFIG + BG-JUDGECONFIG-ORACLE

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
const { runConjunct, pureConjunct, succeeded, frameworkMutationTwin, scenarioTwin, blockOf } = require('./testSupport/bridgeTwinFactories');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const FRAMEWORK_FILE = 'bridge-framework.js';
const DECISION_BLOCK_FILE = 'decisionBlock.js';
const JUDGE_CONFIG_FILE = 'judgeConfigRecord.js';
const CONTRACT_FILE = 'bridgePluginContract.js';
const TOY_EMBED_MODEL = 'toy-embed-v1';
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const BRIDGE_MAKER_LIB_DIR = path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib');
const SCHEMA_FILE_PATH = path.join(BRIDGE_MAKER_LIB_DIR, 'selectCandidateSchema.js');
const llmClientLib = require(path.join(BRIDGE_MAKER_LIB_DIR, 'llmClient'));
const cloneJson = scenarioLib.cloneJson;
const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

// the frozen literals this phase is measured against
const BRANCH_CUT_BLOCK_PATH = path.join(__dirname, 'fixtures', 'toyBridge', 'branchCutBlocks', 'toyDerivedPlugin-B2branchCut-8d07d62.frozenText.json');
const RUN_E_BLOCK_PATH = path.join(TREE_ROOT, '..', '..', 'dataStores', 'bridgeAcceptance', 'edfiEval', 'runE_091726', 'block.json');
const RUN_E_BLOCK_ID = '7e362cebe7bb74d572e643eed37944d2577eb850313028bc0b9eb11f245c8755';
const FRAMEWORK_FINGERPRINT_TEXT_RE = /"frameworkFingerprint":"[0-9a-f]{64}"/g;
const JUDGE_CONFIG_HEADER_NAME_LIST = ['judgeTemperaturePolicy', 'judgeMaxTokens', 'judgeToolSchemaSha256'];

// the real client's settings for (a1)/(a2): claude-opus-5 is not on the temperature allow-list, so its policy is 'omitted';
// both budgets are above llmClient's JUDGMENT_MAX_TOKENS floor (1500), so each reaches the wire as written
const REAL_WIRE_MODEL = 'claude-opus-5';
const INI_MAX_TOKENS = 2000;
const INI_MAX_TOKENS_CHANGED = 2500;

const SHIPPED_DERIVED_PLUGIN_LIST = [
	{ bridgeName: 'edfiCedsDerivedPlugin', bundleDirName: 'edfi', pluginPath: 'forges/edfi/bridges/edfiCedsDerivedPlugin.js' },
	{ bridgeName: 'edfiCedsCrosswalkPlugin', bundleDirName: 'edfi', pluginPath: 'forges/edfi/bridges/edfiCedsCrosswalkPlugin.js' },
	{ bridgeName: 'pescCedsDerivedPlugin', bundleDirName: 'pesc260805', pluginPath: 'forges/pesc260805/bridges/pescCedsDerivedPlugin.js' },
	{ bridgeName: 'pescOptionSetCedsDerivedPlugin', bundleDirName: 'pesc260805', pluginPath: 'forges/pesc260805/bridges/pescOptionSetCedsDerivedPlugin.js' },
];

// ---------------------------------------------------------------------
// scenario shaping
// ---------------------------------------------------------------------
const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};
const pluginPathFor = (pluginName) => path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${pluginName}.js`);
const overrideDeclaration = (scenario, pluginName, mutate) => {
	const current = scenario.pluginModuleOverrides[pluginName] && scenario.pluginModuleOverrides[pluginName].bridgeDeclaration ? scenario.pluginModuleOverrides[pluginName].bridgeDeclaration : require(pluginPathFor(pluginName)).bridgeDeclaration;
	const bridgeDeclaration = cloneJson(current);
	mutate(bridgeDeclaration);
	scenario.pluginModuleOverrides[pluginName] = { ...(scenario.pluginModuleOverrides[pluginName] || {}), bridgeDeclaration };
};
const optedInShape = (scenario) => {
	derivedShape(scenario);
	overrideDeclaration(scenario, DERIVED_PLUGIN_NAME, (declaration) => {
		declaration.blockRecordsJudgeConfig = true;
	});
};

// the REAL llmClient, built from a throwaway [anthropicAi] ini and answering through its postOnce seam. Each answer's
// rationale is unique to its prompt and carries a quote, a newline and a non-ASCII character, so "verbatim" is tested
// against text that JSON escaping could alter. Every rationale issued is kept on the scenario for the judge to compare.
const iniFilePathFor = (maxTokens) => {
	const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bgJudgeConfig-'));
	const filePath = path.join(dirPath, 'anthropicAi.ini');
	fs.writeFileSync(filePath, `[anthropicAi]\napiKey=DUMMY-NEVER-SENT\nmodel=${REAL_WIRE_MODEL}\nmaxTokens=${maxTokens}\n`);
	return filePath;
};
const useRealClient = (scenario, maxTokens) => {
	scenario.issuedRationaleList = [];
	scenario.sentMaxTokensList = [];
	scenario.judgeClientOverride = llmClientLib({
		configFilePath: iniFilePathFor(maxTokens),
		componentOverrides: {
			postOnce: ({ payload }, postCallback) => {
				const rationale = `The "first" candidate means what the source element means.\nprompt ${sha256(payload.messages[0].content).slice(0, 16)} — naïve check`;
				scenario.issuedRationaleList.push(rationale);
				scenario.sentMaxTokensList.push(payload.max_tokens);
				postCallback('', { content: [{ type: 'tool_use', name: llmClientLib.TOOL_NAME, input: { choice: '1', category: 'strong', rationale } }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }, 200);
			},
		},
	});
};
const judgedRecordListOf = (block) => block.decisionRecordList.filter((oneRecord) => oneRecord.judge !== undefined);
const headerFaultList = (block, expectedByName) =>
	Object.keys(expectedByName)
		.filter((oneName) => block.header[oneName] !== expectedByName[oneName])
		.map((oneName) => `${oneName}: ${JSON.stringify(block.header[oneName])} (expected ${JSON.stringify(expectedByName[oneName])})`);

// the tool-schema sha the header must carry, rendered through whatever judgeConfigRecord the scenario loads (a double
// when the scenario carries mutations), so (a3) and its twin compare like with like
const judgeConfigRecordFor = (mutationList) => (mutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, JUDGE_CONFIG_FILE), mutationList }) : require('../judgeConfigRecord'));
const expectedToolSchemaSha256 = () => require('../judgeConfigRecord').judgeConfigHeaderFor({ judgeClient: { judgeConfig: {} }, predicateRule: 'categoryTable-v1' }).judgeToolSchemaSha256;

// the rationale drop, used by both (a0) and (a1): opted in, the record carries no rationale
const RATIONALE_FIND = '\t\t\t\t\t\t\t\t\tjudgeRecord.rationale = judged.rationale;\n';
// forcing the keys on for an undeclared plugin, used by (b) and (m)
const OPT_IN_FIND = 'const recordsJudgeConfig = bridgeDeclaration.blockRecordsJudgeConfig === true;';
const OPT_IN_FORCED = 'const recordsJudgeConfig = true;';

// ---------------------------------------------------------------------
// the masked comparison (§1.7, round-2 N2)
// ---------------------------------------------------------------------
const branchCutText = fs.readFileSync(BRANCH_CUT_BLOCK_PATH, 'utf8');
const maskedTextOf = (frozenText) => {
	const fingerprintMatchList = frozenText.match(FRAMEWORK_FINGERPRINT_TEXT_RE) || [];
	return fingerprintMatchList.length === 1 ? { maskedText: frozenText.replace(FRAMEWORK_FINGERPRINT_TEXT_RE, '"frameworkFingerprint":"MASKED"') } : { error: `frameworkFingerprint occurs ${fingerprintMatchList.length} times in the frozen text (must be exactly once)` };
};
const frozenTextOf = (outcome) => {
	if (blockOf(outcome) === null) {
		return null;
	}
	return outcome.stores.decisionStore.rowList.find((oneRow) => oneRow.decisionBlockHash === outcome.runReport.decisionBlock.decisionBlockHash).frozenText;
};
const differingHeaderNameList = (leftBlock, rightBlock) => {
	const nameList = Array.from(new Set(Object.keys(leftBlock.header).concat(Object.keys(rightBlock.header)))).sort();
	return nameList.filter((oneName) => JSON.stringify(leftBlock.header[oneName]) !== JSON.stringify(rightBlock.header[oneName]));
};

// (a2) runs the toy twice, from two clones of the scenario it is handed (so a twin's mutations reach both), under the
// real client with two different ini budgets, and compares the two block ids
const runOnce = (scenario, maxTokens, callback) => {
	const oneScenario = scenarioLib.cloneScenario(scenario);
	optedInShape(oneScenario);
	useRealClient(oneScenario, maxTokens);
	scenarioLib.runScenario(oneScenario, (unusedError, outcome) => callback(outcome));
};
const refusalOf = (outcome) => outcome.constructionError || outcome.runError || outcome.thrownFromRun || '';
const maxTokensMovesBlockIdConjunct = {
	conjunctId: 'a2_iniMaxTokensMovesBlockId',
	title: `changing [anthropicAi].maxTokens in the ini (${INI_MAX_TOKENS} → ${INI_MAX_TOKENS_CHANGED}) moves the block id, and each header carries its own value`,
	twinNameList: ['maxTokensFrozenAsConstant'],
	evaluate: (scenario, callback) => {
		runOnce(scenario, INI_MAX_TOKENS, (firstOutcome) => {
			runOnce(scenario, INI_MAX_TOKENS_CHANGED, (secondOutcome) => {
				const refusalText = refusalOf(firstOutcome) || refusalOf(secondOutcome);
				if (refusalText) {
					callback('', { pass: false, detail: `expected success but got: ${refusalText.slice(0, 320)}` });
					return;
				}
				const firstBlockId = firstOutcome.runReport.decisionBlock.decisionBlockHash;
				const secondBlockId = secondOutcome.runReport.decisionBlock.decisionBlockHash;
				const firstMaxTokens = blockOf(firstOutcome).header.judgeMaxTokens;
				const secondMaxTokens = blockOf(secondOutcome).header.judgeMaxTokens;
				const pass = firstBlockId !== secondBlockId && firstMaxTokens === INI_MAX_TOKENS && secondMaxTokens === INI_MAX_TOKENS_CHANGED;
				callback('', { pass, detail: `block ids ${firstBlockId.slice(0, 12)} / ${secondBlockId.slice(0, 12)} (${firstBlockId === secondBlockId ? 'SAME' : 'moved'}); judgeMaxTokens ${firstMaxTokens} / ${secondMaxTokens}` });
			});
		});
	},
};

// ---------------------------------------------------------------------
// BG-JUDGECONFIG
// ---------------------------------------------------------------------
const judgeConfigConjunctList = [
	runConjunct({
		conjunctId: 'a0_debugJudgeOptedInCarriesKeysAndRationales',
		title: "opted in under the debug judge: the header carries 'noWire', null and the tool-schema sha, and every judged record a rationale",
		twinNameList: ['rationaleDroppedUnderDebugJudge'],
		shape: optedInShape,
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const faultList = headerFaultList(block, { judgeTemperaturePolicy: 'noWire', judgeMaxTokens: null, judgeToolSchemaSha256: expectedToolSchemaSha256() });
			const judgedRecordList = judgedRecordListOf(block);
			const withoutRationaleCount = judgedRecordList.filter((oneRecord) => typeof oneRecord.judge.rationale !== 'string' || oneRecord.judge.rationale === '').length;
			return { pass: faultList.length === 0 && judgedRecordList.length > 0 && withoutRationaleCount === 0, detail: `${faultList.length ? `header faults: ${faultList.join('; ')}` : 'header keys as expected'}; ${judgedRecordList.length} judged record(s), ${withoutRationaleCount} without a rationale` };
		}),
	}),
	runConjunct({
		conjunctId: 'a1_realClientOptedInCarriesConfigAndVerbatimRationales',
		title: `opted in under the real llmClient (${REAL_WIRE_MODEL}, ini maxTokens ${INI_MAX_TOKENS}): header 'omitted' / ${INI_MAX_TOKENS} / the sha, and each record's rationale is exactly the one the wire returned`,
		twinNameList: ['rationaleDroppedUnderRealClient'],
		shape: (scenario) => { optedInShape(scenario); useRealClient(scenario, INI_MAX_TOKENS); },
		judge: succeeded((runReport, outcome, scenario) => {
			const block = blockOf(outcome);
			const faultList = headerFaultList(block, { judgeTemperaturePolicy: 'omitted', judgeMaxTokens: INI_MAX_TOKENS, judgeToolSchemaSha256: expectedToolSchemaSha256() });
			const judgedRecordList = judgedRecordListOf(block);
			const frozenRationaleList = judgedRecordList.map((oneRecord) => oneRecord.judge.rationale);
			const verbatim = JSON.stringify(frozenRationaleList.slice().sort()) === JSON.stringify(scenario.issuedRationaleList.slice().sort());
			const wireCarriedIniBudget = scenario.sentMaxTokensList.length > 0 && scenario.sentMaxTokensList.every((oneValue) => oneValue === INI_MAX_TOKENS);
			return { pass: faultList.length === 0 && judgedRecordList.length > 0 && verbatim && wireCarriedIniBudget, detail: `${faultList.length ? `header faults: ${faultList.join('; ')}` : 'header keys as expected'}; ${judgedRecordList.length} record(s) vs ${scenario.issuedRationaleList.length} rationale(s) issued, verbatim ${verbatim}; wire max_tokens ${Array.from(new Set(scenario.sentMaxTokensList)).join(',')}` };
		}),
	}),
	maxTokensMovesBlockIdConjunct,
	pureConjunct({
		conjunctId: 'a3_toolSchemaShaFollowsToolText',
		title: 'the tool-schema sha moves when the tool description moves (a word planted in selectCandidateSchema.js)',
		twinNameList: ['toolSchemaShaHashesRuleNameOnly'],
		judge: (scenario) => {
			const stubClient = { judgeConfig: { temperaturePolicy: 'noWire', maxTokens: null } };
			const plantMutation = { modulePath: SCHEMA_FILE_PATH, find: "'THEN record the single best matching CEDS candidate by its number, or NONE if no candidate is a ' +", replace: "'THEN record the single best matching CEDS candidate (planted) by its number, or NONE if no candidate is a ' +" };
			const unplanted = judgeConfigRecordFor(scenario.frameworkMutationList).judgeConfigHeaderFor({ judgeClient: stubClient, predicateRule: 'categoryTable-v1' }).judgeToolSchemaSha256;
			const planted = judgeConfigRecordFor(scenario.frameworkMutationList.concat([plantMutation])).judgeConfigHeaderFor({ judgeClient: stubClient, predicateRule: 'categoryTable-v1' }).judgeToolSchemaSha256;
			return { pass: unplanted !== planted, detail: `unplanted ${unplanted.slice(0, 12)}, planted ${planted.slice(0, 12)}` };
		},
	}),
	runConjunct({
		conjunctId: 'b_optedOutToyBlockMaskedIdentical',
		title: 'opted out, the toy derived block equals the branch-cut text with frameworkFingerprint masked',
		twinNameList: ['judgeConfigForcedOn'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const now = maskedTextOf(frozenTextOf(outcome));
			const then = maskedTextOf(branchCutText);
			if (now.error || then.error) {
				return { pass: false, detail: now.error || then.error };
			}
			return { pass: now.maskedText === then.maskedText, detail: `masked texts ${now.maskedText === then.maskedText ? 'EQUAL' : 'DIFFER'} (${now.maskedText.length} vs ${then.maskedText.length} bytes)` };
		}),
	}),
	runConjunct({
		conjunctId: 'm_unmaskedDiffersOnlyInFrameworkFingerprint',
		title: 'unmasked, the toy derived block and the branch-cut text differ in exactly one header key, frameworkFingerprint',
		twinNameList: ['judgeConfigForcedOnUnmasked'],
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
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGECONFIG', conjunctId: 'a0_debugJudgeOptedInCarriesKeysAndRationales', twinName: 'rationaleDroppedUnderDebugJudge', fileName: FRAMEWORK_FILE, find: RATIONALE_FIND, replace: '' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGECONFIG', conjunctId: 'a1_realClientOptedInCarriesConfigAndVerbatimRationales', twinName: 'rationaleDroppedUnderRealClient', fileName: FRAMEWORK_FILE, find: RATIONALE_FIND, replace: '' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGECONFIG', conjunctId: 'a2_iniMaxTokensMovesBlockId', twinName: 'maxTokensFrozenAsConstant', fileName: JUDGE_CONFIG_FILE, find: 'judgeMaxTokens: judgeClient.judgeConfig.maxTokens,', replace: `judgeMaxTokens: ${INI_MAX_TOKENS},` });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGECONFIG', conjunctId: 'a3_toolSchemaShaFollowsToolText', twinName: 'toolSchemaShaHashesRuleNameOnly', fileName: JUDGE_CONFIG_FILE, find: 'judgeToolSchemaSha256: sha256Hex(promptIdentifierScanLib.TOOL_TEXT_RENDERER_BY_PREDICATE_RULE[predicateRule]({ choiceEnum: TOOL_SCHEMA_CHOICE_ENUM_PLACEHOLDER.slice() })),', replace: 'judgeToolSchemaSha256: sha256Hex(predicateRule),' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGECONFIG', conjunctId: 'b_optedOutToyBlockMaskedIdentical', twinName: 'judgeConfigForcedOn', fileName: FRAMEWORK_FILE, find: OPT_IN_FIND, replace: OPT_IN_FORCED });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGECONFIG', conjunctId: 'm_unmaskedDiffersOnlyInFrameworkFingerprint', twinName: 'judgeConfigForcedOnUnmasked', fileName: FRAMEWORK_FILE, find: OPT_IN_FIND, replace: OPT_IN_FORCED });

// ---------------------------------------------------------------------
// BG-JUDGECONFIG-ORACLE — §1.7 (the key absent disturbs no shipped plugin) and R1, which is gate (c)
// ---------------------------------------------------------------------
const libFor = (scenario, fileName, requirePath) => (scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, fileName), mutationList: scenario.frameworkMutationList }) : require(requirePath));
const oracleConjunctList = [
	pureConjunct({
		conjunctId: 'a_shippedPluginsRegisterWithKeyAbsent',
		title: '§1.7: the shipped Ed-Fi and PESC plugins declare no blockRecordsJudgeConfig and every one still registers',
		twinNameList: ['judgeConfigKeyMadeRequired'],
		judge: (scenario) => {
			const contractLib = libFor(scenario, CONTRACT_FILE, '../bridgePluginContract');
			const resultList = SHIPPED_DERIVED_PLUGIN_LIST.map((onePlugin) => {
				const bridgeDeclaration = require(path.join(TREE_ROOT, onePlugin.pluginPath)).bridgeDeclaration;
				const validated = contractLib.validateBridgeDeclaration({ bridgeDeclaration, bundleDirPath: path.join(TREE_ROOT, 'forges', onePlugin.bundleDirName) });
				return { bridgeName: onePlugin.bridgeName, declares: bridgeDeclaration.blockRecordsJudgeConfig !== undefined, refusal: validated.error ? validated.error.message : '' };
			});
			const faultList = resultList.filter((oneResult) => oneResult.declares || oneResult.refusal);
			return { pass: faultList.length === 0, detail: faultList.length ? faultList.map((oneResult) => `${oneResult.bridgeName}: ${oneResult.declares ? 'DECLARES the key' : oneResult.refusal.slice(0, 200)}`).join(' | ') : `${resultList.length} shipped plugins register with the key absent` };
		},
	}),
	pureConjunct({
		conjunctId: 'c_runEBlockParsesAndKeepsItsId',
		title: "R1: run E's frozen block, which has no judge-config keys, parses unchanged and blockIdFor equals the frozen literal",
		twinNameList: ['judgeConfigKeysRequiredOnRead'],
		judge: (scenario) => {
			const decisionBlockLib = libFor(scenario, DECISION_BLOCK_FILE, '../decisionBlock');
			const frozenText = fs.readFileSync(RUN_E_BLOCK_PATH, 'utf8');
			const parsed = decisionBlockLib.parseFrozenText(frozenText);
			const blockId = decisionBlockLib.blockIdFor({ frozenText });
			const carriesJudgeConfig = JUDGE_CONFIG_HEADER_NAME_LIST.some((oneName) => frozenText.indexOf(`"${oneName}"`) !== -1);
			return { pass: !parsed.error && blockId === RUN_E_BLOCK_ID && !carriesJudgeConfig, detail: `${parsed.error ? `parse REFUSED: ${parsed.error.message.slice(0, 200)}` : 'parses'}; blockIdFor ${blockId}; judge-config keys in the text: ${carriesJudgeConfig}` };
		},
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGECONFIG-ORACLE', conjunctId: 'a_shippedPluginsRegisterWithKeyAbsent', twinName: 'judgeConfigKeyMadeRequired', fileName: CONTRACT_FILE, find: "blockRecordsJudgeConfig: Object.freeze({ optional: true, kind: 'closedValue'", replace: "blockRecordsJudgeConfig: Object.freeze({ kind: 'closedValue'" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGECONFIG-ORACLE', conjunctId: 'c_runEBlockParsesAndKeepsItsId', twinName: 'judgeConfigKeysRequiredOnRead', fileName: DECISION_BLOCK_FILE, find: 'const missingHeaderKey = REQUIRED_HEADER_KEY_LIST.find((oneName) => !Object.prototype.hasOwnProperty.call(block.header, oneName));', replace: 'const missingHeaderKey = HEADER_KEY_ORDER.find((oneName) => !Object.prototype.hasOwnProperty.call(block.header, oneName));' });

const gateDeclarationList = [
	{ gateId: 'BG-JUDGECONFIG', title: 'the judge configuration and each rationale in the block, opt-in, and nothing else moves', conjunctList: judgeConfigConjunctList },
	{ gateId: 'BG-JUDGECONFIG-ORACLE', title: 'the new key disturbs no shipped plugin, and run E still replays hermetically', conjunctList: oracleConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-JUDGECONFIG+BG-JUDGECONFIG-ORACLE', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 6 + 2 },
	() => harness.report(),
);
