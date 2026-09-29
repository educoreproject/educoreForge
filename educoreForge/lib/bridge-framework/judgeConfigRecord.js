'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// judgeConfigRecord.js — the judge's configuration as frozen-block header values (SPEC-sifStructuralBridge-replacement
// §9 A12; PLAN small phases §3 B2). A plugin that declares blockRecordsJudgeConfig: true gets three header keys
// (decisionBlock.js OPTIONAL_HEADER_KEY_LIST) and a verbatim judge.rationale in every judged record; a plugin that does
// not declare it gets neither, and its block text is what it was.
//
//   judgeConfigHeaderFor({ judgeClient, predicateRule }) → { judgeTemperaturePolicy, judgeMaxTokens, judgeToolSchemaSha256 }
//
// WHERE EACH VALUE COMES FROM.
//   judgeTemperaturePolicy, judgeMaxTokens — the provider's own judgeConfig member ({ temperaturePolicy, maxTokens }).
//       Only the provider knows what it puts on the wire: llmClient's temperature allow-list and its raised token budget,
//       Ollama's numPredict, the debug judge's 'noWire' and null.
//   judgeToolSchemaSha256 — sha256 of the tool text for the run's DECLARED predicate rule, from the same renderer the
//       prompt identifier scan uses (promptIdentifierScan.TOOL_TEXT_RENDERER_BY_PREDICATE_RULE, every dialect). It is
//       therefore the same whichever provider is active, as the scan is. The one per-question part of the schema, the
//       candidate-number enum, is replaced by TOOL_SCHEMA_CHOICE_ENUM_PLACEHOLDER, so the sha names the schema and not
//       any one pool's size.
//
// PURE and synchronous.

const promptIdentifierScanLib = require('./promptIdentifierScan');
const { sha256Hex } = require('./decisionBlock');

const TOOL_SCHEMA_CHOICE_ENUM_PLACEHOLDER = Object.freeze(['<one candidate number per pool member, then NONE>']);

const judgeConfigHeaderFor = ({ judgeClient, predicateRule }) => ({
	judgeTemperaturePolicy: judgeClient.judgeConfig.temperaturePolicy,
	judgeMaxTokens: judgeClient.judgeConfig.maxTokens,
	judgeToolSchemaSha256: sha256Hex(promptIdentifierScanLib.TOOL_TEXT_RENDERER_BY_PREDICATE_RULE[predicateRule]({ choiceEnum: TOOL_SCHEMA_CHOICE_ENUM_PLACEHOLDER.slice() })),
});

module.exports = {
	TOOL_SCHEMA_CHOICE_ENUM_PLACEHOLDER,
	judgeConfigHeaderFor,
	moduleName,
};
