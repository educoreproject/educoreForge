#!/usr/bin/env node
'use strict';

// test-spendClients.js — the spend ledger's RECORDED-FIXTURE gate for every live judge client (spend ledger lane R1).
//
// Each REAL client runs over its own transport seam with a stored response body (no network, no key, no spend), is
// METERED by the same latencyMeter build.js puts round every provider (on a scripted clock), and its answer is turned into
// a spend record and priced from the FIXTURE pricing table — exactly as judgeComponent does it. Voyage's half is in
// lib/embedding/providers/test/test-voyage.js and lib/spend-ledger/test/test-embeddingSpend.js.
//
// PROVES:
//   anthropic  a judgmentIncomplete retry and the accepted answer are TWO paid calls, both counted (before R1 only the
//              last was); a 200 without usage is refused by name
//   jev        the pick and the relation are two calls, each its own spendCallList entry, the wire model billed
//   jevOpus    a confident Jev answer is the Jev leg alone; an ESCALATED unit is the Jev leg AND the Opus leg (before R1
//              the Jev leg was dropped); a leg that names no list leaves the unit unpriceable, refused by the record
//   ollama     prompt_eval_count / eval_count become the call's tokens; the local model is priced at its declared $0
//   meter      latencyMs is the scripted clock's difference, stamped by the wrapper and by nothing in the client
//
// Run: node apps/graph-builder/test/test-spendClients.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- recorded-fixture spend gate for the anthropic, jev, jevOpus and ollama judge clients

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const BRIDGE_MAKER_LIB_DIR = path.join(__dirname, '..', 'apps', 'bridge-maker', 'lib');
const llmClientLib = require(path.join(BRIDGE_MAKER_LIB_DIR, 'llmClient'));
const jevJudgeClientLib = require(path.join(BRIDGE_MAKER_LIB_DIR, 'jevJudgeClient'));
const jevOpusJudgeClientLib = require(path.join(BRIDGE_MAKER_LIB_DIR, 'jevOpusJudgeClient'));
const ollamaJudgeClientLib = require(path.join(BRIDGE_MAKER_LIB_DIR, 'ollamaJudgeClient'));
const SPEND_LEDGER_DIR = path.join(__dirname, '..', '..', '..', 'lib', 'spend-ledger');
const { latencyMeteredJudgeClientFor } = require(path.join(SPEND_LEDGER_DIR, 'latencyMeter'));
const spendRecordLib = require(path.join(SPEND_LEDGER_DIR, 'spendRecord'));
const spendPricer = require(path.join(SPEND_LEDGER_DIR, 'spendPricing')).loadSpendPricing({ pricingFilePath: path.join(SPEND_LEDGER_DIR, 'test', 'fixtures', 'spendPricing-fixture.ini') }).spendPricer;

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfSpendClientsGate-'));
const scratchIni = (fileName, iniText) => {
	const filePath = path.join(scratchDir, fileName);
	fs.writeFileSync(filePath, iniText);
	return filePath;
};
const near = (actual, expected) => typeof actual === 'number' && Math.abs(actual - expected) < 1e-12;

// a scripted clock: each reading advances by stepMs, so a metered call's latency is known in advance (2 readings → stepMs)
const scriptedClock = (stepMs) => {
	let nowMs = 1000;
	return () => {
		nowMs += stepMs;
		return nowMs;
	};
};

// meteredAnswerOf — the client as build.js hands it to the framework, asked once; then the record judgeComponent builds
const meteredAnswerOf = ({ judgeClient, rerankOptions, stepMs }, callback) => {
	const metered = latencyMeteredJudgeClientFor({ judgeClient, readClockMs: scriptedClock(stepMs) }).judgeClient;
	metered.rerank(rerankOptions, (rerankError, clientReturn) => {
		if (rerankError) {
			callback({ rerankError });
			return;
		}
		const priced = spendRecordLib.judgeSpendRecordFor({ judgeName: judgeClient.name, judgeModel: judgeClient.model, spendCallList: clientReturn.spendCallList, latencyMs: clientReturn.latencyMs, cacheHit: false, isDebugClient: false, spendPricer });
		callback({ clientReturn, spendRecord: priced.spendRecord, pricingError: priced.error });
	});
};

// ---- anthropic: a stored Messages envelope, the first one INCOMPLETE (no rationale) so the client retries
const anthropicIniFilePath = scratchIni('anthropicAi.ini', '[anthropicAi]\napiKey=DUMMY-NEVER-SENT\nmodel=claude-opus-5\nmaxTokens=2000\n');
const anthropicEnvelope = ({ rationale, usage }) => ({ content: [{ type: 'tool_use', name: llmClientLib.TOOL_NAME, input: { choice: '1', category: 'strong', ...(rationale === undefined ? {} : { rationale }) } }], stop_reason: 'end_turn', ...(usage === undefined ? {} : { usage }) });
const anthropicWith = (envelopeList) => {
	let sentCount = 0;
	return llmClientLib({
		configFilePath: anthropicIniFilePath,
		componentOverrides: {
			postOnce: (unusedArgs, postCallback) => {
				const envelope = envelopeList[Math.min(sentCount, envelopeList.length - 1)];
				sentCount += 1;
				setImmediate(() => postCallback('', envelope, 200));
			},
		},
	});
};
const TEXT_RERANK_OPTIONS = { systemPrompt: 's', userPrompt: 'Which candidate? [1] Person Birth Date', choiceEnum: ['1', 'NONE'], predicateRule: 'categoryTable-v1', toolCandidateNoun: 'CEDS candidate' };

// ---- jev: the real client over its scripted transport (pick, then relation)
process.env.SPEND_CLIENTS_GATE_JEV_KEY = 'test-key-not-real';
const jevIniFilePath = scratchIni(
	'jevJudge.ini',
	[
		'[jevJudge]', 'endpointHostName=api.example.invalid', 'endpointPath=/v1/systemone', 'wireModel=jev-1.13.0',
		'apiKeyEnvironmentVariableName=SPEND_CLIENTS_GATE_JEV_KEY', 'maxConcurrency=4', 'requestTimeoutMs=1000', 'maxAttempts=1', 'requestForm=data',
		'strongMinConfidence=0.8', 'moderateMinConfidence=0.5', 'relationInstructionText=How does the source element relate?',
		'exactMatchDescription=same', 'closeMatchDescription=close', 'broadMatchDescription=broader', 'narrowMatchDescription=narrower',
	].join('\n'),
);
const jevPickBody = (confidence) => ({ answers: { matchingCandidate: { type: 'choice', choice: '1', confidence, probabilities: { 1: confidence, 2: 0.05, NONE: 0.05 } } }, usage: { input_tokens: 4000, output_tokens: 200 } });
const jevRelationBody = { answers: { relationToChosenCandidate: { type: 'choice', choice: 'closeMatch', confidence: 0.6, probabilities: { exactMatch: 0.1, closeMatch: 0.6, broadMatch: 0.2, narrowMatch: 0.1 } } }, usage: { input_tokens: 900, output_tokens: 30 } };
const jevWith = (responseBodyList) => {
	let sentCount = 0;
	return jevJudgeClientLib({
		configFilePath: jevIniFilePath,
		componentOverrides: {
			postOnce: (unusedArgs, postCallback) => {
				const responseBody = responseBodyList[sentCount];
				sentCount += 1;
				setImmediate(() => postCallback('', { statusCode: 200, responseBody, responseText: JSON.stringify(responseBody) }));
			},
		},
	});
};
const JEV_CHOICE_QUESTION = {
	stateObject: { matchingInstructions: 'match by meaning', sourceElement: { name: 'EducationOrganizationId' } },
	instructionText: 'Which candidate element has the same meaning as the source element?',
	criteriaByChoice: { NONE: 'None of them.', 1: { name: 'Has Organization Identifier' }, 2: { name: 'Learning Resource Identifier' } },
};
const jevRerankOptions = (predicateRule) => ({ systemPrompt: 's', userPrompt: 'u', choiceEnum: ['1', '2', 'NONE'], predicateRule, toolCandidateNoun: 'CEDS candidate', choiceQuestion: JEV_CHOICE_QUESTION, choiceQuestionFormName: 'matchingInstructionsState' });

const caseList = [
	(done) => {
		harness.section('anthropic — a retried 200 is a paid call; usage is required');
		meteredAnswerOf({ judgeClient: anthropicWith([anthropicEnvelope({ rationale: undefined, usage: { input_tokens: 4659, output_tokens: 120 } }), anthropicEnvelope({ rationale: 'Person Birth Date is the same idea', usage: { input_tokens: 4700, output_tokens: 205 } })]), rerankOptions: TEXT_RERANK_OPTIONS, stepMs: 40 }, ({ rerankError, clientReturn, spendRecord, pricingError }) => {
			harness.accepts('the retried answer is accepted', rerankError || pricingError ? [rerankError || pricingError] : []);
			harness.equal('TWO paid calls are listed (the incomplete 200 and the accepted one)', clientReturn && clientReturn.spendCallList.length, 2);
			harness.ok('both are anthropic:claude-opus-5 (the WIRE model billed), with the stored token counts', clientReturn && clientReturn.spendCallList.every((oneCall) => oneCall.provider === 'anthropic' && oneCall.model === 'claude-opus-5') && clientReturn.spendCallList[0].inputTokens === 4659 && clientReturn.spendCallList[1].outputTokens === 205, JSON.stringify(clientReturn && clientReturn.spendCallList));
			harness.ok('the unit is priced over both: (4659+4700)×$5 + (120+205)×$25 per million', spendRecord && near(spendRecord.usd, (9359 * 5 + 325 * 25) / 1e6), JSON.stringify(spendRecord));
			harness.equal('latencyMs is the metering wrapper\'s, from the scripted clock (one step)', spendRecord && spendRecord.latencyMs, 40);
			meteredAnswerOf({ judgeClient: anthropicWith([anthropicEnvelope({ rationale: 'Person Birth Date', usage: undefined })]), rerankOptions: TEXT_RERANK_OPTIONS, stepMs: 1 }, ({ rerankError: noUsageError }) => {
				harness.match('a 200 WITHOUT usage is REFUSED by name (it cannot be priced)', noUsageError, /carries usage undefined; input_tokens and output_tokens must be non-negative integers, or the call cannot be priced/);
				done();
			});
		});
	},
	(done) => {
		harness.section('jev — the pick and the relation, two calls');
		meteredAnswerOf({ judgeClient: jevWith([jevPickBody(0.9), jevRelationBody]), rerankOptions: jevRerankOptions('judgeSlot-v1'), stepMs: 15 }, ({ rerankError, clientReturn, spendRecord, pricingError }) => {
			harness.accepts('the pick and its relation are answered', rerankError || pricingError ? [rerankError || pricingError] : []);
			harness.equal('two calls listed: pick 4000/200, relation 900/30', clientReturn && JSON.stringify(clientReturn.spendCallList.map((oneCall) => [oneCall.model, oneCall.inputTokens, oneCall.outputTokens])), JSON.stringify([['jev-1.13.0', 4000, 200], ['jev-1.13.0', 900, 30]]));
			harness.ok('priced at the fixture Jev rate: 4,900 in × $0.5 per million (output free)', spendRecord && near(spendRecord.usd, 4900 * 0.5 / 1e6) && spendRecord.provider === 'jev', JSON.stringify(spendRecord));
			done();
		});
	},
	(done) => {
		harness.section('jevOpus — a confident Jev answer, then an escalation that pays for both legs');
		const opusIniFilePath = scratchIni('jevOpusJudge.ini', `[jevOpusJudge]\nescalateBelowConfidence=0.7\njevConfigFilePath=${jevIniFilePath}\nanthropicConfigFilePath=${anthropicIniFilePath}\n`);
		const cascadeWith = ({ jevBodyList, anthropicEnvelopeList }) => jevOpusJudgeClientLib({ configFilePath: opusIniFilePath, componentOverrides: { jevProvider: jevWith(jevBodyList), anthropicProvider: anthropicWith(anthropicEnvelopeList) } });
		const opusAnswer = anthropicEnvelope({ rationale: 'Has Organization Identifier', usage: { input_tokens: 5000, output_tokens: 300 } });
		meteredAnswerOf({ judgeClient: cascadeWith({ jevBodyList: [jevPickBody(0.9)], anthropicEnvelopeList: [opusAnswer] }), rerankOptions: jevRerankOptions('categoryTable-v1'), stepMs: 5 }, ({ rerankError, clientReturn, spendRecord }) => {
			harness.accepts('a confident Jev answer stands', rerankError ? [rerankError] : []);
			harness.equal('  and its unit is the Jev leg alone', clientReturn && clientReturn.spendCallList.map((oneCall) => oneCall.provider).join(','), 'jev');
			harness.equal('  filed under the cascade\'s own identity', spendRecord && spendRecord.provider, 'jevOpus');
			meteredAnswerOf({ judgeClient: cascadeWith({ jevBodyList: [jevPickBody(0.4)], anthropicEnvelopeList: [opusAnswer] }), rerankOptions: jevRerankOptions('categoryTable-v1'), stepMs: 5 }, ({ rerankError: escalatedError, clientReturn: escalatedReturn, spendRecord: escalatedRecord }) => {
				harness.accepts('a doubtful Jev answer escalates to Opus', escalatedError ? [escalatedError] : []);
				harness.equal('  the ESCALATED unit lists BOTH legs: Jev, then Opus (the Jev leg was dropped before R1)', escalatedReturn && escalatedReturn.spendCallList.map((oneCall) => `${oneCall.provider}:${oneCall.model}`).join(','), 'jev:jev-1.13.0,anthropic:claude-opus-5');
				harness.ok('  priced as the sum of the legs: 4000×$0.5 + 5000×$5 + 300×$25 per million', escalatedRecord && near(escalatedRecord.usd, (4000 * 0.5 + 5000 * 5 + 300 * 25) / 1e6), JSON.stringify(escalatedRecord));
				harness.ok('  `usage` is what it always was (Opus\'s alone), so no forensic reader moves', escalatedReturn && escalatedReturn.usage.inputTokens === 5000);
				const halfList = jevOpusJudgeClientLib({ configFilePath: opusIniFilePath, componentOverrides: { jevProvider: jevWith([jevPickBody(0.4)]), anthropicProvider: { ...anthropicWith([opusAnswer]), rerank: (unusedOptions, cb) => cb('', { choice: '1', category: 'strong', rationale: 'Has Organization Identifier', model: 'anthropic:claude-opus-5', attempts: 1, usage: { inputTokens: 1, outputTokens: 1 } }) } } });
				meteredAnswerOf({ judgeClient: halfList, rerankOptions: jevRerankOptions('categoryTable-v1'), stepMs: 5 }, ({ pricingError }) => {
					harness.match('  a leg naming no list leaves the unit UNPRICEABLE, refused by name (never a half count)', pricingError, /answered without its spend: spendCallList is undefined/);
					done();
				});
			});
		});
	},
	(done) => {
		harness.section('ollama — the server\'s counts, priced at the declared $0');
		const ollamaIniFilePath = scratchIni('ollamaJudge.ini', '[ollamaJudge]\nendpointHostName=127.0.0.1\nendpointPortNumber=11434\nwireModel=qwen2.5:32b\nmaxConcurrency=1\nrequestTimeoutMs=180000\nnumPredict=400\n');
		const tagList = { models: [{ name: 'qwen2.5:32b', model: 'qwen2.5:32b', digest: '9f13ba1299afea09d9a956fc6a85becc99115a6d596fae201a5487a03bdc4368' }] };
		const modelAnswer = { choice: '1', category: 'strong', rationale: 'Person Birth Date is the same idea', sourceElementIdeaList: [], candidateIdeaList: [], sortedCandidateList: ['1'], ideaCoverage: { candidateIndexNumber: '1', sourceNounsCovered: [], sourceNounsNotCovered: [] } };
		ollamaJudgeClientLib({ configFilePath: ollamaIniFilePath, componentOverrides: { fetchModelTagList: (tagCallback) => tagCallback('', tagList), postOnce: (unusedArgs, postCallback) => setImmediate(() => postCallback('', { model: 'qwen2.5:32b', message: { role: 'assistant', content: JSON.stringify(modelAnswer) }, done: true, done_reason: 'stop', prompt_eval_count: 168, eval_count: 83 }, 200)) } }, (constructionError, ollamaClient) => {
			harness.accepts('the real ollama client constructs over its stubbed tag list', constructionError ? [constructionError] : []);
			meteredAnswerOf({ judgeClient: ollamaClient, rerankOptions: TEXT_RERANK_OPTIONS, stepMs: 900 }, ({ rerankError, clientReturn, spendRecord, pricingError }) => {
				harness.accepts('it answers and its unit is priced', rerankError || pricingError ? [rerankError || pricingError] : []);
				harness.equal('one call: prompt_eval_count 168 in, eval_count 83 out', clientReturn && JSON.stringify(clientReturn.spendCallList), JSON.stringify([{ provider: 'ollama', model: 'qwen2.5:32b', inputTokens: 168, outputTokens: 83 }]));
				harness.ok('priced at the declared $0 (a row that says so), pricedBy the table, latency 900 ms', spendRecord && spendRecord.usd === 0 && spendRecord.pricedBy === 'spendPricingTable' && spendRecord.latencyMs === 900, JSON.stringify(spendRecord));
				done();
			});
		});
	},
];

const runSequence = (remainingList) => {
	if (!remainingList.length) {
		harness.report();
		return;
	}
	remainingList[0](() => runSequence(remainingList.slice(1)));
};
runSequence(caseList);
