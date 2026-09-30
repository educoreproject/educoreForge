#!/usr/bin/env node
'use strict';

// test-jevJudgeClient.js — THE JEV JUDGE PROVIDER, HELD TO THE CONTRACT.
// Created 2026-09-29 (COPPER_LOOM).
//
// HERMETIC — no network. The one transport seam, postOnce, is driven through componentOverrides, the same
// idiom test-ollamaJudgeClient uses. The API key comes from a throwaway environment variable and the config
// from a throwaway ini in the temp directory.
//
// Run: node apps/graph-builder/test/test-jevJudgeClient.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the Jev judge provider satisfies JUDGE_PROVIDER_SHAPE and refuses by name

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Holds jevJudgeClient.js to the provider contract: the six members, an identity namespaced by
     provider, wire model and request form, configuration refused by name, the data and string request
     forms, category derived from confidence, a rationale that names its pick, answer validation, and
     retry only on transient statuses.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');

const harness = require('../../../test/testLib/harness')(moduleName);

const { judgeProviderViolation } = require('../interfaces');
const jevJudgeClientLib = require(path.join(__dirname, '..', 'apps', 'bridge-maker', 'lib', 'jevJudgeClient'));

const TEST_KEY_VARIABLE_NAME = 'JEV_JUDGE_CLIENT_TEST_KEY';
process.env[TEST_KEY_VARIABLE_NAME] = 'test-key-not-real';

const scratchDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jevJudgeClientTest-'));

const iniTextFor = (overrideByKey = {}) => {
	const valueByKey = Object.assign(
		{
			endpointHostName: 'api.example.invalid',
			endpointPath: '/v1/systemone',
			wireModel: 'jev-1.13.0',
			apiKeyEnvironmentVariableName: TEST_KEY_VARIABLE_NAME,
			maxConcurrency: '4',
			requestTimeoutMs: '1000',
			maxAttempts: '3',
			requestForm: 'data',
			strongMinConfidence: '0.8',
			moderateMinConfidence: '0.5',
		},
		overrideByKey,
	);
	return ['[jevJudge]']
		.concat(Object.keys(valueByKey).filter((oneKey) => valueByKey[oneKey] !== null).map((oneKey) => `${oneKey}=${valueByKey[oneKey]}`))
		.join('\n');
};

let iniCount = 0;
const iniFilePathFor = (overrideByKey) => {
	iniCount += 1;
	const iniFilePath = path.join(scratchDirectoryPath, `jevJudge-${iniCount}.ini`);
	fs.writeFileSync(iniFilePath, iniTextFor(overrideByKey));
	return iniFilePath;
};

const constructionErrorFor = (overrideByKey) => {
	try {
		jevJudgeClientLib({ configFilePath: iniFilePathFor(overrideByKey) });
	} catch (constructionFault) {
		return constructionFault.message;
	}
	return '';
};

// A double for Jev: each call answers with the next scripted {statusCode, responseBody} and records the payload.
const scriptedTransport = (scriptList) => {
	const sentPayloadList = [];
	const postOnce = ({ payload }, postCallback) => {
		sentPayloadList.push(payload);
		const scripted = scriptList[Math.min(sentPayloadList.length - 1, scriptList.length - 1)];
		setImmediate(() => postCallback('', { statusCode: scripted.statusCode, responseBody: scripted.responseBody, responseText: JSON.stringify(scripted.responseBody) }));
	};
	return { postOnce, sentPayloadList };
};

const answerBody = ({ choice, confidence, probabilities }) => ({
	model: 'jev-1.13.0',
	answers: { matchingCandidate: { type: 'choice', choice, confidence, probabilities } },
	usage: { input_tokens: 100, output_tokens: 10 },
});

const choiceQuestion = {
	stateObject: { matchingInstructions: 'match by meaning', sourceElement: { name: 'EducationOrganizationId', description: 'An id.' } },
	instructionText: 'Which candidate element has the same meaning, in the same context, as the source element?',
	criteriaByChoice: {
		NONE: 'None of the candidate elements has the same meaning as the source element.',
		1: { name: 'Has Organization Identifier', domainName: 'Organization' },
		2: { name: 'Learning Resource Identifier', domainName: 'Organization' },
	},
};
const choiceEnum = ['1', '2', 'NONE'];

const providerFor = (overrideByKey, scriptList) => {
	const transport = scriptedTransport(scriptList);
	const provider = jevJudgeClientLib({ configFilePath: iniFilePathFor(overrideByKey), componentOverrides: { postOnce: transport.postOnce } });
	return { provider, transport };
};

// runSequence — the async cases run one after another; each takes a done callback.
const runSequence = (caseList, finalCallback) => {
	if (!caseList.length) {
		finalCallback();
		return;
	}
	caseList[0](() => runSequence(caseList.slice(1), finalCallback));
};

harness.section('THE PROVIDER SATISFIES JUDGE_PROVIDER_SHAPE');
const { provider: dataProvider } = providerFor({}, [{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence: 0.9, probabilities: { 1: 0.95, 2: 0.03, NONE: 0.02 } }) }]);
harness.ok('no contract violation', judgeProviderViolation(dataProvider, { providerLabel: 'jev' }) === null, judgeProviderViolation(dataProvider, { providerLabel: 'jev' }));
harness.equal('name is jev', dataProvider.name, 'jev');
harness.equal('model carries provider, wire model AND request form', dataProvider.model, 'jev:jev-1.13.0:data');
harness.equal('describe() agrees with the provider', dataProvider.describe().model, dataProvider.model);
const { provider: stringProvider } = providerFor({ requestForm: 'string' }, [{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence: 0.9, probabilities: { 1: 0.95, 2: 0.03, NONE: 0.02 } }) }]);
harness.equal('the string form is a DIFFERENT identity, so the forms never share cached verdicts', stringProvider.model, 'jev:jev-1.13.0:string');

harness.section('CONFIGURATION IS REFUSED BY NAME');
harness.match('an absent key is refused naming the key', constructionErrorFor({ wireModel: null }), /\[jevJudge\]\.wireModel is not configured/);
harness.match('an unknown requestForm is refused listing the forms', constructionErrorFor({ requestForm: 'yaml' }), /requestForm is 'yaml'.*data, string/);
harness.match('moderate above strong is refused', constructionErrorFor({ moderateMinConfidence: '0.9' }), /moderateMinConfidence \(0\.9\) is above strongMinConfidence/);
harness.match('an out-of-range confidence floor is refused', constructionErrorFor({ strongMinConfidence: '1.5' }), /must be a number from 0 to 1/);
harness.match('an unset key variable is refused naming the variable', constructionErrorFor({ apiKeyEnvironmentVariableName: 'JEV_JUDGE_CLIENT_TEST_KEY_UNSET' }), /JEV_JUDGE_CLIENT_TEST_KEY_UNSET .* is empty or unset/);

const pickCase = ({ label, confidence, expectedCategory }) => (done) => {
	const { provider, transport } = providerFor({}, [{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence, probabilities: { 1: confidence, 2: 0.1, NONE: 0.05 } }) }]);
	provider.rerank({ systemPrompt: 's', userPrompt: 'u', choiceEnum, choiceQuestion }, (rerankError, verdict) => {
		harness.section(label);
		harness.ok('no error', !rerankError, rerankError);
		harness.equal('choice is the pick', verdict && verdict.choice, '1');
		harness.equal(`category is ${expectedCategory}`, verdict && verdict.category, expectedCategory);
		harness.match('the rationale names the pick by NAME', verdict && verdict.rationale, /"Has Organization Identifier"/);
		harness.match('…and says the numbers are not reasons', verdict && verdict.rationale, /Jev reports probabilities, not reasons/);
		harness.equal('model on the verdict is the provider identity', verdict && verdict.model, 'jev:jev-1.13.0:data');
		harness.equal('one attempt', verdict && verdict.attempts, 1);
		harness.equal('the wire model is sent, not the identity', transport.sentPayloadList[0].model, 'jev-1.13.0');
		done();
	});
};

const caseList = [
	pickCase({ label: 'A PICK AT OR ABOVE strongMinConfidence IS strong', confidence: 0.8, expectedCategory: 'strong' }),
	pickCase({ label: 'A PICK BETWEEN THE FLOORS IS moderate', confidence: 0.6, expectedCategory: 'moderate' }),
	pickCase({ label: 'A PICK BELOW moderateMinConfidence IS weakButReal', confidence: 0.3, expectedCategory: 'weakButReal' }),
	(done) => {
		const { provider, transport } = providerFor({}, [{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence: 0.9, probabilities: { 1: 0.9, 2: 0.05, NONE: 0.05 } }) }]);
		provider.rerank({ choiceEnum, choiceQuestion }, () => {
			harness.section('THE data FORM SENDS OBJECTS');
			const payload = transport.sentPayloadList[0];
			harness.equal('a candidate is an object', typeof payload.questions.matchingCandidate.criteria['1'], 'object');
			harness.equal('the source element is an object', typeof payload.state.sourceElement, 'object');
			harness.equal('NONE keeps its text description', payload.questions.matchingCandidate.criteria.NONE, choiceQuestion.criteriaByChoice.NONE);
			harness.equal('the question is a choice', payload.questions.matchingCandidate.type, 'choice');
			done();
		});
	},
	(done) => {
		const { provider, transport } = providerFor({ requestForm: 'string' }, [{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence: 0.9, probabilities: { 1: 0.9, 2: 0.05, NONE: 0.05 } }) }]);
		provider.rerank({ choiceEnum, choiceQuestion }, () => {
			harness.section('THE string FORM SENDS THE SAME FIELDS AS name: value LINES');
			const payload = transport.sentPayloadList[0];
			harness.equal('a candidate is a string', typeof payload.questions.matchingCandidate.criteria['1'], 'string');
			harness.match('…of name: value lines', payload.questions.matchingCandidate.criteria['1'], /^name: Has Organization Identifier\ndomainName: Organization$/);
			harness.match('the source element is lines too', payload.state.sourceElement, /^name: EducationOrganizationId\n/);
			done();
		});
	},
	(done) => {
		const { provider } = providerFor({}, [{ statusCode: 200, responseBody: answerBody({ choice: 'NONE', confidence: 0.5, probabilities: { 1: 0.3, 2: 0.1, NONE: 0.6 } }) }]);
		provider.rerank({ choiceEnum, choiceQuestion }, (rerankError, verdict) => {
			harness.section('AN ABSTENTION IS CATEGORY none WITH A RATIONALE');
			harness.ok('no error', !rerankError, rerankError);
			harness.equal('choice NONE', verdict && verdict.choice, 'NONE');
			harness.equal('category none', verdict && verdict.category, 'none');
			harness.match('the rationale says it abstained and names the runner-up', verdict && verdict.rationale, /abstained.*"Has Organization Identifier"/);
			done();
		});
	},
	(done) => {
		const { provider } = providerFor({}, [{ statusCode: 200, responseBody: answerBody({ choice: '7', confidence: 0.9, probabilities: { 7: 0.9 } }) }]);
		provider.rerank({ choiceEnum, choiceQuestion }, (rerankError) => {
			harness.section('AN ANSWER OUTSIDE THE OFFERED OPTIONS IS REFUSED');
			harness.match('refused by name', rerankError, /Jev chose '7', which is not one of the offered options/);
			done();
		});
	},
	(done) => {
		const { provider, transport } = providerFor({}, [
			{ statusCode: 429, responseBody: { error: 'rate limited' } },
			{ statusCode: 200, responseBody: answerBody({ choice: '2', confidence: 0.9, probabilities: { 1: 0.05, 2: 0.9, NONE: 0.05 } }) },
		]);
		provider.rerank({ choiceEnum, choiceQuestion }, (rerankError, verdict) => {
			harness.section('A 429 IS RETRIED');
			harness.ok('no error', !rerankError, rerankError);
			harness.equal('two calls were made', transport.sentPayloadList.length, 2);
			harness.equal('attempts reports 2', verdict && verdict.attempts, 2);
			done();
		});
	},
	(done) => {
		const { provider, transport } = providerFor({}, [{ statusCode: 400, responseBody: { error: 'bad request' } }]);
		provider.rerank({ choiceEnum, choiceQuestion }, (rerankError) => {
			harness.section('A 400 IS NOT RETRIED');
			harness.match('refused naming the status', rerankError, /HTTP 400 after 1 attempt/);
			harness.equal('one call only', transport.sentPayloadList.length, 1);
			done();
		});
	},
	(done) => {
		const { provider, transport } = providerFor({}, [{ statusCode: 503, responseBody: { error: 'down' } }]);
		provider.rerank({ choiceEnum, choiceQuestion }, (rerankError) => {
			harness.section('RETRIES STOP AT maxAttempts');
			harness.match('refused after three attempts', rerankError, /HTTP 503 after 3 attempt/);
			harness.equal('three calls', transport.sentPayloadList.length, 3);
			done();
		});
	},
	(done) => {
		const { provider, transport } = providerFor({}, [{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence: 0.9, probabilities: { 1: 0.9 } }) }]);
		provider.rerank({ systemPrompt: 's', userPrompt: 'u', choiceEnum }, (rerankError) => {
			harness.section('A QUESTION WITHOUT choiceQuestion IS REFUSED — THERE IS NO TEXT PARSE');
			harness.match('refused by name', rerankError, /rerank received no choiceQuestion/);
			harness.equal('nothing was sent', transport.sentPayloadList.length, 0);
			done();
		});
	},
];

runSequence(caseList, () => {
	fs.rmSync(scratchDirectoryPath, { recursive: true, force: true });
	harness.report();
});
