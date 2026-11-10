#!/usr/bin/env node
'use strict';

// test-llmClientForcedTool.js — feat/llmForcedTool (educore WORKORDER-rosettaFreeInput-111026, ruling ROMANTIC_PARASOL 2026-11-10).
// llmClient gained callForcedTool, and its retry loop moved into postWithRetries, shared by rerank and callForcedTool. HERMETIC: the real client is
// constructed from a throwaway ini with a dummy key and answers through its postOnce seam; nothing is sent and nothing is spent.
//
// PROVES:
//   1. RERANK UNCHANGED. The same scripted responses go through this branch's llmClient and through main's (read with git show and loaded from a temporary
//      copy), and every answer and every refusal is the same JSON, byte for byte: a whole judgment, an incomplete one retried, one cut at max_tokens until
//      the attempts run out, a 503 then a 200, a 400, a 200 without usage, a response with no choice, and a transport fault on every attempt.
//   2. callForcedTool sends the caller's tool, forces it by name, sends the caller's max_tokens, and sends temperature by the same rule as rerank.
//   3. A TRUNCATED ANSWER IS NEVER SALVAGED: stop_reason max_tokens gives toolInput null and stopReason max_tokens even though the cut input parses,
//      it is not retried, and its spend is listed. An answer with no call of the tool gives toolInput null too.
//   4. maxTokens and maxRetries have no default: absent, the call is refused by name and nothing is posted.
//   5. The shared loop serves callForcedTool: a 503 is retried and noted, a 200 without usage is refused by name.
//
// Run: node apps/graph-builder/test/test-llmClientForcedTool.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

process.global = process.global || { xLog: { status() {}, error() {}, verbose() {}, result() {} } };

const forgeRootPath = path.join(__dirname, '..', '..', '..');
const clientRelativePath = path.join('apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'llmClient.js');
const clientLib = require(path.join(forgeRootPath, clientRelativePath));
const BASE_COMMIT = process.env.LLM_CLIENT_BASE_COMMIT || 'main';

let passedCount = 0;
let failedCount = 0;
const ok = (testName, condition, detailText) => {
	if (condition) { passedCount += 1; console.log(`  PASS: ${testName}`); return; }
	failedCount += 1;
	console.log(`  FAIL: ${testName}${detailText ? ` — ${detailText}` : ''}`);
};

const scratchDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'llmForcedTool-'));
const iniFilePathFor = (wireModel) => {
	const iniFilePath = path.join(scratchDirPath, `${wireModel}.ini`);
	fs.writeFileSync(iniFilePath, `[anthropicAi]\napiKey=DUMMY-NEVER-SENT\nmodel=${wireModel}\nmaxTokens=2000\n`);
	return iniFilePath;
};

// main's llmClient, loaded from a temporary copy whose two relative requires are made absolute, so the copy runs exactly main's code
const baseClientLib = (() => {
	const baseSourceText = execFileSync('git', ['show', `${BASE_COMMIT}:educoreForge/${clientRelativePath}`], { cwd: forgeRootPath, encoding: 'utf8' });
	const libDirPath = path.join(forgeRootPath, path.dirname(clientRelativePath));
	const absoluteSourceText = baseSourceText
		.replace("require('./selectCandidateSchema')", `require(${JSON.stringify(path.join(libDirPath, 'selectCandidateSchema'))})`)
		.replace("require('qtools-config-file-processor')", `require(${JSON.stringify(require.resolve('qtools-config-file-processor', { paths: [libDirPath] }))})`);
	// named llmClient.js, in a directory of its own: the client names itself after its file in every refusal
	const baseFilePath = path.join(scratchDirPath, 'base', 'llmClient.js');
	fs.mkdirSync(path.dirname(baseFilePath));
	fs.writeFileSync(baseFilePath, absoluteSourceText);
	return require(baseFilePath);
})();

// a client whose postOnce answers from a script: each entry is [errText, parsedBody, status]; every payload sent is kept
const scriptedClientOf = ({ fromLib, wireModel, responseList }) => {
	const sentPayloadList = [];
	const judgeClient = fromLib({
		configFilePath: iniFilePathFor(wireModel),
		componentOverrides: {
			postOnce: ({ payload }, postCallback) => {
				sentPayloadList.push(payload);
				const [errText, parsedBody, statusCode] = responseList[Math.min(sentPayloadList.length - 1, responseList.length - 1)];
				setImmediate(() => postCallback(errText, parsedBody, statusCode));
			},
		},
	});
	return { judgeClient, sentPayloadList };
};

const USAGE = { input_tokens: 1200, output_tokens: 90 };
const judgmentEnvelope = ({ rationale, stopReason = 'end_turn', usage = USAGE, choice = '1' }) => ({ content: [{ type: 'tool_use', name: clientLib.TOOL_NAME, input: { ...(choice === undefined ? {} : { choice }), category: 'strong', ...(rationale === undefined ? {} : { rationale }) } }], stop_reason: stopReason, ...(usage === null ? {} : { usage }) });
const RERANK_OPTIONS = { systemPrompt: 's', userPrompt: 'Which candidate? [1] Person Birth Date', choiceEnum: ['1', 'NONE'], predicateRule: 'categoryTable-v1', toolCandidateNoun: 'CEDS candidate', maxRetries: 2 };
const RERANK_SCENARIO_LIST = [
	{ scenarioName: 'a whole judgment', responseList: [['', judgmentEnvelope({ rationale: 'same idea' }), 200]] },
	{ scenarioName: 'incomplete, then whole', responseList: [['', judgmentEnvelope({ rationale: undefined }), 200], ['', judgmentEnvelope({ rationale: 'same idea' }), 200]] },
	{ scenarioName: 'cut at max_tokens on every attempt', responseList: [['', judgmentEnvelope({ rationale: 'cut', stopReason: 'max_tokens' }), 200]] },
	{ scenarioName: 'a 503, then a 200', responseList: [['', { error: { message: 'overloaded' } }, 503], ['', judgmentEnvelope({ rationale: 'same idea' }), 200]] },
	{ scenarioName: 'a 400', responseList: [['', { error: { message: 'bad request' } }, 400]] },
	{ scenarioName: 'a 200 without usage', responseList: [['', judgmentEnvelope({ rationale: 'same idea', usage: null }), 200]] },
	{ scenarioName: 'no choice in the answer', responseList: [['', { content: [{ type: 'text', text: 'I will not choose' }], stop_reason: 'end_turn', usage: USAGE }, 200]] },
	{ scenarioName: 'a transport fault on every attempt', responseList: [['request error: socket hang up', null, 0]] },
];

const rerankOutcomeOf = ({ fromLib, responseList }, done) => {
	const { judgeClient, sentPayloadList } = scriptedClientOf({ fromLib, wireModel: 'claude-opus-5', responseList });
	judgeClient.rerank(RERANK_OPTIONS, (rerankError, clientReturn) => done(JSON.stringify({ rerankError, clientReturn, sentPayloadList })));
};

const FIELD_TOOL = { name: 'report_fields', description: 'd', input_schema: { type: 'object', required: ['fieldList'], properties: { fieldList: { type: 'array' } } } };
const FORCED_OPTIONS = { systemPrompt: 'Copy fields.', userPrompt: 'dob: date of birth', tool: FIELD_TOOL, maxTokens: 16000, maxRetries: 2 };
const toolEnvelope = ({ input, stopReason = 'tool_use', usage = USAGE, toolName = FIELD_TOOL.name }) => ({ content: [{ type: 'tool_use', name: toolName, input }], stop_reason: stopReason, ...(usage === null ? {} : { usage }) });

const stepList = [];

// ---- 1. rerank unchanged, scenario by scenario
RERANK_SCENARIO_LIST.forEach(({ scenarioName, responseList }) => stepList.push((next) => rerankOutcomeOf({ fromLib: baseClientLib, responseList }, (baseOutcomeText) => rerankOutcomeOf({ fromLib: clientLib, responseList }, (branchOutcomeText) => {
	ok(`rerank unchanged from ${BASE_COMMIT}: ${scenarioName}`, branchOutcomeText === baseOutcomeText, `\n      base:   ${baseOutcomeText.slice(0, 400)}\n      branch: ${branchOutcomeText.slice(0, 400)}`);
	next();
}))));

// ---- 2. what callForcedTool sends, and what it answers
stepList.push((next) => {
	const { judgeClient, sentPayloadList } = scriptedClientOf({ fromLib: clientLib, wireModel: 'claude-opus-5', responseList: [['', toolEnvelope({ input: { fieldList: [{ name: 'dob', definition: 'date of birth' }] } }), 200]] });
	ok('the client offers callForcedTool', typeof judgeClient.callForcedTool === 'function');
	if (typeof judgeClient.callForcedTool !== 'function') {
		next();
		return;
	}
	judgeClient.callForcedTool(FORCED_OPTIONS, (callError, called) => {
		const sentPayload = sentPayloadList[0] || {};
		ok('it answers the tool\'s input', !callError && JSON.stringify(called.toolInput) === JSON.stringify({ fieldList: [{ name: 'dob', definition: 'date of birth' }] }), callError);
		ok('it sends the caller\'s tool and forces it by name', JSON.stringify(sentPayload.tools) === JSON.stringify([FIELD_TOOL]) && JSON.stringify(sentPayload.tool_choice) === JSON.stringify({ type: 'tool', name: 'report_fields' }));
		ok('it sends the caller\'s max_tokens, not the judge\'s', sentPayload.max_tokens === 16000);
		ok('a model off the temperature list gets no temperature, as in rerank', sentPayload.temperature === undefined);
		ok('the answer carries its stop reason, the wire model billed, one attempt and the identity', called && called.stopReason === 'tool_use' && called.spendCallList.length === 1 && called.spendCallList[0].model === 'claude-opus-5' && called.attempts === 1 && called.model === 'anthropic:claude-opus-5', JSON.stringify(called));
		next();
	});
});
stepList.push((next) => {
	const { judgeClient, sentPayloadList } = scriptedClientOf({ fromLib: clientLib, wireModel: 'claude-haiku-4-5', responseList: [['', toolEnvelope({ input: { fieldList: [] } }), 200]] });
	if (typeof judgeClient.callForcedTool !== 'function') {
		ok('a model on the temperature list gets temperature 0', false, 'no callForcedTool');
		next();
		return;
	}
	judgeClient.callForcedTool(FORCED_OPTIONS, () => {
		ok('a model on the temperature list gets temperature 0, as in rerank', sentPayloadList[0].temperature === 0);
		next();
	});
});

// ---- 3. a cut answer is never salvaged; an answer with no call of the tool reads as none
stepList.push((next) => {
	const { judgeClient, sentPayloadList } = scriptedClientOf({ fromLib: clientLib, wireModel: 'claude-opus-5', responseList: [['', toolEnvelope({ input: { fieldList: [{ name: 'dob' }] }, stopReason: 'max_tokens' }), 200]] });
	if (typeof judgeClient.callForcedTool !== 'function') {
		ok('a cut answer is not salvaged', false, 'no callForcedTool');
		next();
		return;
	}
	judgeClient.callForcedTool(FORCED_OPTIONS, (callError, called) => {
		ok('a cut answer gives toolInput null, though what was cut parses', !callError && called.toolInput === null, JSON.stringify(called));
		ok('it reports stopReason max_tokens', called && called.stopReason === 'max_tokens');
		ok('it is not retried: the same budget would cut it again', sentPayloadList.length === 1 && called.attempts === 1);
		ok('its spend is listed, for the caller to ledger', called && called.spendCallList.length === 1 && called.spendCallList[0].outputTokens === USAGE.output_tokens);
		next();
	});
});
stepList.push((next) => {
	const { judgeClient } = scriptedClientOf({ fromLib: clientLib, wireModel: 'claude-opus-5', responseList: [['', toolEnvelope({ input: { fieldList: [] }, toolName: 'some_other_tool' }), 200]] });
	if (typeof judgeClient.callForcedTool !== 'function') {
		ok('an answer with no call of the tool gives toolInput null', false, 'no callForcedTool');
		next();
		return;
	}
	judgeClient.callForcedTool(FORCED_OPTIONS, (callError, called) => {
		ok('an answer with no call of the named tool gives toolInput null', !callError && called.toolInput === null);
		next();
	});
});

// ---- 4. no default budget
stepList.push((next) => {
	const { judgeClient, sentPayloadList } = scriptedClientOf({ fromLib: clientLib, wireModel: 'claude-opus-5', responseList: [['', toolEnvelope({ input: {} }), 200]] });
	if (typeof judgeClient.callForcedTool !== 'function') {
		ok('maxTokens and maxRetries are refused by name when absent', false, 'no callForcedTool');
		next();
		return;
	}
	const { maxTokens: unusedMaxTokens, maxRetries: unusedMaxRetries, ...optionsWithoutBudget } = FORCED_OPTIONS;
	judgeClient.callForcedTool(optionsWithoutBudget, (callError) => {
		ok('maxTokens and maxRetries are refused by name when absent, and nothing is posted', /callForcedTool: absent or bad: .*maxTokens.*maxRetries/.test(String(callError)) && sentPayloadList.length === 0, callError);
		next();
	});
});

// ---- 5. the shared loop serves callForcedTool
stepList.push((next) => {
	const { judgeClient, sentPayloadList } = scriptedClientOf({ fromLib: clientLib, wireModel: 'claude-opus-5', responseList: [['', { error: { message: 'overloaded' } }, 503], ['', toolEnvelope({ input: { fieldList: [] } }), 200]] });
	if (typeof judgeClient.callForcedTool !== 'function') {
		ok('a 503 is retried', false, 'no callForcedTool');
		next();
		return;
	}
	judgeClient.callForcedTool(FORCED_OPTIONS, (callError, called) => {
		ok('a 503 is retried by the shared loop and noted', !callError && sentPayloadList.length === 2 && called.attempts === 2 && /^transport \(attempt 1\): status 503$/.test(called.retryReasons[0]), JSON.stringify(called && called.retryReasons));
		next();
	});
});
stepList.push((next) => {
	const { judgeClient } = scriptedClientOf({ fromLib: clientLib, wireModel: 'claude-opus-5', responseList: [['', toolEnvelope({ input: { fieldList: [] }, usage: null }), 200]] });
	if (typeof judgeClient.callForcedTool !== 'function') {
		ok('a 200 without usage is refused', false, 'no callForcedTool');
		next();
		return;
	}
	judgeClient.callForcedTool(FORCED_OPTIONS, (callError) => {
		ok('a 200 without usage is refused by name', /llmClient\.callForcedTool: the response \(attempt 1\) carries usage undefined/.test(String(callError)), callError);
		next();
	});
});

const runStep = (stepIndex) => {
	if (stepIndex >= stepList.length) {
		fs.rmSync(scratchDirPath, { recursive: true, force: true });
		console.log(`test-llmClientForcedTool: ${passedCount} passed, ${failedCount} failed`);
		process.exit(failedCount === 0 ? 0 : 1);
	}
	stepList[stepIndex](() => runStep(stepIndex + 1));
};
runStep(0);
