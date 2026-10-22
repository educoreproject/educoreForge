#!/usr/bin/env node
'use strict';

// test-judgeWording.js — R4 of the hub-neutral bridge lane (2026-10-21): the judge's tool description takes its hub noun from
// the hub's bridging declaration (hubBridging.judgeWording.toolCandidateNoun), and the CEDS hub declares today's exact text, so
// every existing tool schema, its sha and every judgment-cache key is byte-identical (TQ, Q-R1 option (i)).
//
// PROVES:
//   (a) byte identity under (i): with the CEDS noun, every rendered select_candidate schema (both predicate rules, every
//       dialect) and the judgeToolSchemaSha256 of both rules equal the values captured BEFORE the change (R4 start, 1fa8326c)
//   (b) the noun is the hub's: the CTDL noun renders 'CTDL candidate' and never 'CEDS'; an absent or empty noun is refused by name
//   (c) the noun travels in bridgeTarget, never in bridgeDeclaration: every registered bridge's entry carries its hub's
//       judgeWording, read from that hub's own bridging declaration
//   (d) the seam: the judge provider's rerank argKeys name toolCandidateNoun
//   (e) no CEDS literal is left in the judge path's code (string literals of selectCandidateSchema.js and bridge-framework.js)
//   (f) every tool-sending provider and the debug judge REFUSE a rerank that names no toolCandidateNoun, by name, and never
//       answer it (BRONZE_CROWN condition (a)); stubbed transports, no network

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the judge's hub noun comes from the hub, and CEDS renders byte-identically
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');
const SCHEMA_FILE_PATH = path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'selectCandidateSchema.js');
const FRAMEWORK_FILE_PATH = path.join(TREE_ROOT, 'lib', 'bridge-framework', 'bridge-framework.js');
const selectCandidateSchemaLib = require(SCHEMA_FILE_PATH);
const judgeConfigRecordLib = require('../judgeConfigRecord');
const pluginRegistryLib = require('../pluginRegistry');
const hubBridgingLoaderLib = require('../hubBridgingLoader');
const interfacesLib = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'interfaces'));

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const CEDS_NOUN = 'CEDS candidate';
const PROBE_CHOICE_ENUM = ['1', '2', 'NONE'];

// captured at R4 start (1fa8326c, before any R4 edit) by rendering through the then-current module: the gate under Q-R1 (i)
const RENDERED_SCHEMA_SHA_BEFORE_R4 = Object.freeze({
	'categoryTable-v1 anthropic': '057471245820bc044d03bf34f645a8888204f10f7375e9598b3aa49e2f06ab71',
	'categoryTable-v1 ollama': '680bf359d3655596494b5f65f6defed59bf89db65e4ea3b7b8b7c6f24e6552a7',
	'judgeSlot-v1 anthropic': '5b3737d4bc4b9450cc87e83d8440ddd06d20c35c9fa6ed074aea74e593b36f07',
	'judgeSlot-v1 ollama': '5a1ce2256f4022a5a4e937aa25742a07b14597a8b93febaeb29a50593b0e6b34',
});
const JUDGE_TOOL_SCHEMA_SHA_BEFORE_R4 = Object.freeze({
	'categoryTable-v1': '90e3b087e2d5a2957c1c81feddb4608eda6a26dd914ce3a6298b250371a44074',
	'judgeSlot-v1': '51ebb2629d3f2856e1c8c31779056225b641ab71dd91258a5eb4d2f36b8ac208',
});
const STUB_JUDGE_CLIENT = Object.freeze({ judgeConfig: Object.freeze({ temperaturePolicy: 'noWire', maxTokens: null }) });

const thrownMessageOf = (attempt) => {
	try {
		attempt();
	} catch (thrown) {
		return thrown.message;
	}
	return '';
};

harness.section('(a) byte identity under Q-R1 (i): the CEDS noun renders exactly what was rendered before R4');
Object.keys(RENDERED_SCHEMA_SHA_BEFORE_R4).forEach((oneLabel) => {
	const [predicateRule, dialectName] = oneLabel.split(' ');
	const renderedText = JSON.stringify(selectCandidateSchemaLib.renderSelectCandidateSchemaForPredicateRule(dialectName, { choiceEnum: PROBE_CHOICE_ENUM, predicateRule, toolCandidateNoun: CEDS_NOUN }));
	harness.equal(`${oneLabel}: rendered schema sha unchanged`, sha256Hex(renderedText), RENDERED_SCHEMA_SHA_BEFORE_R4[oneLabel]);
});
Object.keys(JUDGE_TOOL_SCHEMA_SHA_BEFORE_R4).forEach((predicateRule) => {
	const header = judgeConfigRecordLib.judgeConfigHeaderFor({ judgeClient: STUB_JUDGE_CLIENT, predicateRule, toolCandidateNoun: CEDS_NOUN });
	harness.equal(`${predicateRule}: judgeToolSchemaSha256 unchanged (the cache model key's tool part)`, header.judgeToolSchemaSha256, JUDGE_TOOL_SCHEMA_SHA_BEFORE_R4[predicateRule]);
});

harness.section('(b) the noun is the hub\'s, and its absence is refused by name');
const ctdlDescription = typeof selectCandidateSchemaLib.renderJudgeToolDescription === 'function' ? selectCandidateSchemaLib.renderJudgeToolDescription({ toolCandidateNoun: 'CTDL candidate', predicateRule: 'categoryTable-v1' }) : '';
harness.ok('the CTDL noun renders "the single best matching CTDL candidate"', /the single best matching CTDL candidate by its number/.test(ctdlDescription), ctdlDescription.slice(0, 200));
harness.ok('  and names no CEDS', ctdlDescription !== '' && !/\bCEDS\b/.test(ctdlDescription));
const ctdlSlotDescription = typeof selectCandidateSchemaLib.renderJudgeToolDescription === 'function' ? selectCandidateSchemaLib.renderJudgeToolDescription({ toolCandidateNoun: 'CTDL candidate', predicateRule: 'judgeSlot-v1' }) : '';
harness.ok('the judgeSlot-v1 description carries the same noun', /the single best matching CTDL candidate by its number/.test(ctdlSlotDescription) && /PREDICATE/.test(ctdlSlotDescription));
harness.ok('an absent noun is refused by name (render)', /toolCandidateNoun/.test(thrownMessageOf(() => selectCandidateSchemaLib.renderSelectCandidateSchemaForPredicateRule('anthropic', { choiceEnum: PROBE_CHOICE_ENUM, predicateRule: 'categoryTable-v1' }))));
harness.ok('an empty noun is refused by name (render)', /toolCandidateNoun/.test(thrownMessageOf(() => selectCandidateSchemaLib.renderSelectCandidateSchemaForPredicateRule('anthropic', { choiceEnum: PROBE_CHOICE_ENUM, predicateRule: 'categoryTable-v1', toolCandidateNoun: '' }))));
harness.ok('an absent noun is refused by name (judge config header)', /toolCandidateNoun/.test(thrownMessageOf(() => judgeConfigRecordLib.judgeConfigHeaderFor({ judgeClient: STUB_JUDGE_CLIENT, predicateRule: 'categoryTable-v1' }))));

harness.section('(c) the noun travels in bridgeTarget, read from the hub\'s own bridging declaration');
const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH });
const mismatchList = [];
Object.keys(registry.entryByBridgeName).sort().forEach((bridgeName) => {
	const entry = registry.entryByBridgeName[bridgeName];
	const hubLoad = hubBridgingLoaderLib.loadHubBridging({ forgesDirPath: FORGES_DIR_PATH, hubToken: entry.targetHub });
	const expectedNoun = hubLoad.error ? `(hub load failed: ${hubLoad.error.message})` : hubLoad.hubBridging.judgeWording.toolCandidateNoun;
	const carriedNoun = entry.judgeWording === undefined ? '(absent)' : entry.judgeWording.toolCandidateNoun;
	if (carriedNoun !== expectedNoun) {
		mismatchList.push(`${bridgeName}: carries ${carriedNoun}, hub ${entry.targetHub} declares ${expectedNoun}`);
	}
	if (Object.prototype.hasOwnProperty.call(entry.bridgeDeclaration, 'judgeWording')) {
		mismatchList.push(`${bridgeName}: judgeWording is INSIDE bridgeDeclaration (it would move declarationDigest)`);
	}
});
harness.ok(`every registered bridge (${Object.keys(registry.entryByBridgeName).length}) carries its hub's noun, outside its declaration`, mismatchList.length === 0, mismatchList.join('\n'));

harness.section('(d) the seam: rerank names toolCandidateNoun');
const rerankArgKeyList = ((interfacesLib.JUDGE_PROVIDER_SHAPE || {}).rerank || {}).argKeys || [];
harness.ok('JUDGE_PROVIDER_SHAPE.rerank.argKeys includes toolCandidateNoun', rerankArgKeyList.indexOf('toolCandidateNoun') !== -1, JSON.stringify(rerankArgKeyList));

harness.section('(e) no CEDS literal in the judge path\'s code');
const stringLiteralCedsLineList = (filePath) =>
	fs
		.readFileSync(filePath, 'utf8')
		.split('\n')
		.map((oneLine, lineIndex) => ({ lineNumber: lineIndex + 1, codeText: oneLine.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, '') }))
		.filter((oneRow) => /\bCEDS\b/.test(oneRow.codeText))
		.map((oneRow) => `${path.basename(filePath)}:${oneRow.lineNumber}`);
const literalLineList = stringLiteralCedsLineList(SCHEMA_FILE_PATH).concat(stringLiteralCedsLineList(FRAMEWORK_FILE_PATH));
harness.ok('selectCandidateSchema.js and bridge-framework.js name CEDS only in comments', literalLineList.length === 0, literalLineList.join(', '));

harness.section('(f) the providers refuse a rerank with no noun, by name, and never answer it');
const os = require('os');
const BRIDGE_MAKER_LIB_DIR = path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib');
const scratchIniPath = (fileName, sectionText) => {
	const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `${moduleName}-`)), fileName);
	fs.writeFileSync(filePath, sectionText);
	return filePath;
};
const MODEL_ANSWER = Object.freeze({ choice: '1', category: 'moderate', rationale: 'stub', sourceElementIdeaList: [], candidateIdeaList: [], sortedCandidateList: ['1', '2'], ideaCoverage: { covered: [], missed: [] } });
const llmClientFactory = require(path.join(BRIDGE_MAKER_LIB_DIR, 'llmClient'));
const llmProvider = llmClientFactory({ configFilePath: scratchIniPath('anthropicAi.ini', '[anthropicAi]\napiKey=DUMMY-NEVER-SENT\nmodel=claude-opus-5\nmaxTokens=2000\n'), componentOverrides: { postOnce: (unusedArgs, postCallback) => postCallback('', { content: [{ type: 'tool_use', name: llmClientFactory.TOOL_NAME, input: { ...MODEL_ANSWER } }], stop_reason: 'end_turn' }, 200) } });
let ollamaProvider = null;
require(path.join(BRIDGE_MAKER_LIB_DIR, 'ollamaJudgeClient'))({ configFilePath: scratchIniPath('ollamaJudge.ini', '[ollamaJudge]\nendpointHostName=127.0.0.1\nendpointPortNumber=11434\nwireModel=qwen2.5:32b\nmaxConcurrency=1\nrequestTimeoutMs=180000\nnumPredict=400\n'), componentOverrides: { fetchModelTagList: (tagCallback) => tagCallback('', { models: [{ name: 'qwen2.5:32b', model: 'qwen2.5:32b', digest: '9f13ba1299afea09d9a956fc6a85becc99115a6d596fae201a5487a03bdc4368' }] }), postOnce: (unusedArgs, postCallback) => postCallback('', { message: { content: JSON.stringify(MODEL_ANSWER) }, done: true, prompt_eval_count: 1, eval_count: 1 }, 200) } }, (constructionError, constructed) => {
	ollamaProvider = constructionError ? null : constructed;
});
const debugProvider = require(path.join(BRIDGE_MAKER_LIB_DIR, 'debugJudge'))({ ruleName: 'digest' });
const nounRefusalRe = /toolCandidateNoun is undefined; it is the hub's noun for a candidate/;
[['llmClient', llmProvider], ['ollama', ollamaProvider], ['debug judge', debugProvider]].forEach(([providerLabel, provider]) => {
	let outcomeText = 'never called back';
	if (provider === null) {
		outcomeText = 'not constructed';
	} else {
		provider.rerank({ systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', '2', 'NONE'], predicateRule: 'categoryTable-v1', maxRetries: 1 }, (rerankError, clientReturn) => {
			outcomeText = rerankError ? String(rerankError) : `ANSWERED (choice ${clientReturn.choice})`;
		});
	}
	harness.ok(`${providerLabel}: a rerank with no toolCandidateNoun is refused by name`, nounRefusalRe.test(outcomeText), outcomeText.slice(0, 240));
});

harness.report();
