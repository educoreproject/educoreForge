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
			relationInstructionText: 'How does the source element relate in meaning to the chosen candidate element?',
			exactMatchDescription: 'Exact match: same meaning.',
			closeMatchDescription: 'Close match: similar enough for most contexts.',
			broadMatchDescription: 'Broad match: the chosen candidate is more general.',
			narrowMatchDescription: 'Narrow match: the chosen candidate is more specific.',
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

// relationBody — Jev's answer to the SECOND question, the relation to the chosen candidate.
const relationBody = ({ choice, confidence, probabilities }) => ({
	model: 'jev-1.13.0',
	answers: { relationToChosenCandidate: { type: 'choice', choice, confidence, probabilities } },
	usage: { input_tokens: 40, output_tokens: 5 },
});
const RELATION_PROBABILITIES = { exactMatch: 0.1, closeMatch: 0.2, broadMatch: 0.6, narrowMatch: 0.1 };
// W-B-6 (campaign P3): the identity hashes every configured value that changes an answer or its category ('cfg-'), no
// longer the relation wording alone ('rel-')
const MODEL_IDENTITY_RE = /^jev:jev-1\.13\.0:data:cfg-[0-9a-f]{12}$/;

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
harness.match('model carries provider, wire model, request form AND the configuration identity hash', dataProvider.model, MODEL_IDENTITY_RE);
harness.equal('describe() agrees with the provider', dataProvider.describe().model, dataProvider.model);
harness.equal('judgeConfig says Jev takes no temperature, has no token budget, and names the floors its bands came from', JSON.stringify(dataProvider.judgeConfig), '{"temperaturePolicy":"notOffered","maxTokens":null,"categoryFloorByCategory":{"strong":0.8,"moderate":0.5}}');
const { provider: stringProvider } = providerFor({ requestForm: 'string' }, [{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence: 0.9, probabilities: { 1: 0.95, 2: 0.03, NONE: 0.02 } }) }]);
harness.ok('the string form is a DIFFERENT identity, so the forms never share cached verdicts (its form segment says string; the form is also hashed, W-B-6)', stringProvider.model !== dataProvider.model && /^jev:jev-1\.13\.0:string:cfg-[0-9a-f]{12}$/.test(stringProvider.model), `${stringProvider.model} vs ${dataProvider.model}`);
const { provider: rewordedProvider } = providerFor({ broadMatchDescription: 'Broad match: reworded.' }, []);
harness.ok('rewording ONE relation description moves the identity, so cached verdicts never answer a different question', rewordedProvider.model !== dataProvider.model && MODEL_IDENTITY_RE.test(rewordedProvider.model), `${rewordedProvider.model} vs ${dataProvider.model}`);
const { provider: reinstructedProvider } = providerFor({ relationInstructionText: 'Reworded instruction?' }, []);
harness.ok('rewording the relation instruction moves the identity', reinstructedProvider.model !== dataProvider.model, reinstructedProvider.model);

// W-B-6 (V1-C11, campaign P3): the category floors re-band every pick, so they are in the identity; the cache must
// never serve a verdict banded under another floor. Each conjunct has a twin: a module double whose key list drops the
// value, observed to leave the identity unmoved.
harness.section('W-B-6: THE IDENTITY COVERS THE CATEGORY FLOORS AND EVERY RELATION DESCRIPTION');
const moduleDouble = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const JEV_CLIENT_PATH = path.join(__dirname, '..', 'apps', 'bridge-maker', 'lib', 'jevJudgeClient.js');
const KEY_LIST_FIND = "const JEV_IDENTITY_CONFIG_KEY_LIST = Object.freeze(['wireModel', 'requestForm', 'strongMinConfidence', 'moderateMinConfidence', 'relationInstructionText', 'relationDescriptionByPredicate']);";
const identityPairFor = (clientLib, overrideByKey) => [clientLib({ configFilePath: iniFilePathFor({}) }).model, clientLib({ configFilePath: iniFilePathFor(overrideByKey) }).model];
[
	{ label: 'strongMinConfidence', overrideByKey: { strongMinConfidence: '0.85' }, twinReplace: KEY_LIST_FIND.replace("'strongMinConfidence', ", '') },
	{ label: 'moderateMinConfidence', overrideByKey: { moderateMinConfidence: '0.45' }, twinReplace: KEY_LIST_FIND.replace("'moderateMinConfidence', ", '') },
	{ label: 'exactMatchDescription', overrideByKey: { exactMatchDescription: 'Exact match: reworded.' }, twinReplace: KEY_LIST_FIND.replace(", 'relationDescriptionByPredicate'", '') },
].forEach((oneCase) => {
	const [baseModel, movedModel] = identityPairFor(jevJudgeClientLib, oneCase.overrideByKey);
	harness.ok(`changing ONLY ${oneCase.label} moves the identity`, baseModel !== movedModel && MODEL_IDENTITY_RE.test(movedModel), `${baseModel} vs ${movedModel}`);
	const twinLib = moduleDouble.loadWithMutations({ modulePath: JEV_CLIENT_PATH, mutationList: [{ modulePath: JEV_CLIENT_PATH, find: KEY_LIST_FIND, replace: oneCase.twinReplace }] });
	const [twinBaseModel, twinMovedModel] = identityPairFor(twinLib, oneCase.overrideByKey);
	harness.ok(`TWIN (${oneCase.label} dropped from JEV_IDENTITY_CONFIG_KEY_LIST) observed RED: the identity no longer moves`, twinBaseModel === twinMovedModel, `${twinBaseModel} vs ${twinMovedModel}`);
});

harness.section('CONFIGURATION IS REFUSED BY NAME');
harness.match('an absent key is refused naming the key', constructionErrorFor({ wireModel: null }), /\[jevJudge\]\.wireModel is not configured/);
harness.match('an unknown requestForm is refused listing the forms', constructionErrorFor({ requestForm: 'yaml' }), /requestForm is 'yaml'.*data, string/);
harness.match('moderate above strong is refused', constructionErrorFor({ moderateMinConfidence: '0.9' }), /moderateMinConfidence \(0\.9\) is above strongMinConfidence/);
harness.match('an out-of-range confidence floor is refused', constructionErrorFor({ strongMinConfidence: '1.5' }), /must be a number from 0 to 1/);
harness.match('an absent relation description is refused naming its key', constructionErrorFor({ narrowMatchDescription: null }), /\[jevJudge\]\.narrowMatchDescription is not configured/);
harness.match('an absent relation instruction is refused naming its key', constructionErrorFor({ relationInstructionText: null }), /\[jevJudge\]\.relationInstructionText is not configured/);
harness.match('an unset key variable is refused naming the variable', constructionErrorFor({ apiKeyEnvironmentVariableName: 'JEV_JUDGE_CLIENT_TEST_KEY_UNSET' }), /JEV_JUDGE_CLIENT_TEST_KEY_UNSET .* is empty or unset/);

const pickCase = ({ label, confidence, expectedCategory }) => (done) => {
	const { provider, transport } = providerFor({}, [{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence, probabilities: { 1: confidence, 2: 0.1, NONE: 0.05 } }) }]);
	provider.rerank({ systemPrompt: 's', userPrompt: 'u', choiceEnum, predicateRule: 'categoryTable-v1', choiceQuestion }, (rerankError, verdict) => {
		harness.section(label);
		harness.ok('no error', !rerankError, rerankError);
		harness.equal('choice is the pick', verdict && verdict.choice, '1');
		harness.equal(`category is ${expectedCategory}`, verdict && verdict.category, expectedCategory);
		harness.match('the rationale names the pick by NAME', verdict && verdict.rationale, /"Has Organization Identifier"/);
		harness.match('…and says the numbers are not reasons', verdict && verdict.rationale, /Jev reports probabilities, not reasons/);
		harness.equal('model on the verdict is the provider identity', verdict && verdict.model, provider.model);
		harness.equal('one attempt', verdict && verdict.attempts, 1);
		harness.equal('categoryTable-v1: the verdict carries NO predicate key (a present key is counted as discarded)', verdict && Object.prototype.hasOwnProperty.call(verdict, 'predicate'), false);
		harness.equal('categoryTable-v1: ONE call, no relation question', transport.sentPayloadList.length, 1);
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
		provider.rerank({ choiceEnum, predicateRule: 'categoryTable-v1', choiceQuestion }, () => {
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
		provider.rerank({ choiceEnum, predicateRule: 'categoryTable-v1', choiceQuestion }, () => {
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
		provider.rerank({ choiceEnum, predicateRule: 'categoryTable-v1', choiceQuestion }, (rerankError, verdict) => {
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
		provider.rerank({ choiceEnum, predicateRule: 'categoryTable-v1', choiceQuestion }, (rerankError) => {
			harness.section('AN ANSWER OUTSIDE THE OFFERED OPTIONS IS REFUSED');
			harness.match('refused by name', rerankError, /Jev chose '7' for 'matchingCandidate', which is not one of the offered options/);
			done();
		});
	},
	(done) => {
		const { provider, transport } = providerFor({}, [
			{ statusCode: 429, responseBody: { error: 'rate limited' } },
			{ statusCode: 200, responseBody: answerBody({ choice: '2', confidence: 0.9, probabilities: { 1: 0.05, 2: 0.9, NONE: 0.05 } }) },
		]);
		provider.rerank({ choiceEnum, predicateRule: 'categoryTable-v1', choiceQuestion }, (rerankError, verdict) => {
			harness.section('A 429 IS RETRIED');
			harness.ok('no error', !rerankError, rerankError);
			harness.equal('two calls were made', transport.sentPayloadList.length, 2);
			harness.equal('attempts reports 2', verdict && verdict.attempts, 2);
			done();
		});
	},
	// goldJev lane A (2026-10-01): the edge proxy's own faults, 520-524, are retried like the 50x family; one 520 killed
	// jevBuild2's SIF run after a single attempt before they were. 529 (Jev's own 'system_overloaded') joined them on 2026-10-05
	// (leftovers lane R): one 529 killed metaBuild1's SIF run after a single attempt
	...[520, 521, 522, 523, 524, 529].map((edgeStatusCode) => (done) => {
		const { provider, transport } = providerFor({}, [
			{ statusCode: edgeStatusCode, responseBody: { error: `error code: ${edgeStatusCode}` } },
			{ statusCode: 200, responseBody: answerBody({ choice: '2', confidence: 0.9, probabilities: { 1: 0.05, 2: 0.9, NONE: 0.05 } }) },
		]);
		provider.rerank({ choiceEnum, predicateRule: 'categoryTable-v1', choiceQuestion }, (rerankError, verdict) => {
			harness.section(`A ${edgeStatusCode} (${edgeStatusCode === 529 ? 'JEV OVERLOADED' : 'THE EDGE PROXY'}) IS RETRIED`);
			harness.ok('no error', !rerankError, rerankError);
			harness.equal('two calls were made', transport.sentPayloadList.length, 2);
			harness.equal('attempts reports 2', verdict && verdict.attempts, 2);
			done();
		});
	}),
	(done) => {
		const { provider, transport } = providerFor({}, [{ statusCode: 400, responseBody: { error: 'bad request' } }]);
		provider.rerank({ choiceEnum, predicateRule: 'categoryTable-v1', choiceQuestion }, (rerankError) => {
			harness.section('A 400 IS NOT RETRIED');
			harness.match('refused naming the status', rerankError, /HTTP 400 after 1 attempt/);
			harness.equal('one call only', transport.sentPayloadList.length, 1);
			done();
		});
	},
	(done) => {
		const { provider, transport } = providerFor({}, [{ statusCode: 503, responseBody: { error: 'down' } }]);
		provider.rerank({ choiceEnum, predicateRule: 'categoryTable-v1', choiceQuestion }, (rerankError) => {
			harness.section('RETRIES STOP AT maxAttempts');
			harness.match('refused after three attempts', rerankError, /HTTP 503 after 3 attempt/);
			harness.equal('three calls', transport.sentPayloadList.length, 3);
			done();
		});
	},
	(done) => {
		const { provider, transport } = providerFor({}, [{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence: 0.9, probabilities: { 1: 0.9 } }) }]);
		provider.rerank({ systemPrompt: 's', userPrompt: 'u', choiceEnum, predicateRule: 'categoryTable-v1' }, (rerankError) => {
			harness.section('A QUESTION WITHOUT choiceQuestion IS REFUSED — THERE IS NO TEXT PARSE');
			harness.match('refused by name', rerankError, /rerank received no choiceQuestion/);
			harness.equal('nothing was sent', transport.sentPayloadList.length, 0);
			done();
		});
	},
	// ── R1 (jevRelations, 2026-09-30): the relation question under judgeSlot-v1 ──
	(done) => {
		const { provider, transport } = providerFor({}, [
			{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence: 0.9, probabilities: { 1: 0.9, 2: 0.05, NONE: 0.05 } }) },
			{ statusCode: 200, responseBody: relationBody({ choice: 'broadMatch', confidence: 0.55, probabilities: RELATION_PROBABILITIES }) },
		]);
		provider.rerank({ choiceEnum, predicateRule: 'judgeSlot-v1', choiceQuestion }, (rerankError, verdict) => {
			harness.section('judgeSlot-v1 WITH A PICK: A SECOND CALL NAMES THE RELATION');
			harness.ok('no error', !rerankError, rerankError);
			harness.equal('two calls were made', transport.sentPayloadList.length, 2);
			const relationPayload = transport.sentPayloadList[1] || { questions: {}, state: {} };
			const relationQuestion = relationPayload.questions.relationToChosenCandidate || {};
			harness.equal('the second call asks relationToChosenCandidate, a choice', relationQuestion.type, 'choice');
			harness.equal('its options are the four SSSOM predicates, in schema order', Object.keys(relationQuestion.criteria || {}).join(','), 'exactMatch,closeMatch,broadMatch,narrowMatch');
			harness.equal('each option carries its configured description', (relationQuestion.criteria || {}).broadMatch, 'Broad match: the chosen candidate is more general.');
			harness.equal('the instruction is the configured wording', relationQuestion.instructions, 'How does the source element relate in meaning to the chosen candidate element?');
			harness.equal('the state holds the source element', JSON.stringify(relationPayload.state.sourceElement), JSON.stringify(choiceQuestion.stateObject.sourceElement));
			harness.equal('…and the CHOSEN candidate, not another seat', JSON.stringify(relationPayload.state.chosenCandidate), JSON.stringify(choiceQuestion.criteriaByChoice['1']));
			harness.equal('the wire model is sent on the second call too', relationPayload.model, 'jev-1.13.0');
			harness.equal('the verdict carries predicate = the relation Jev chose', verdict && verdict.predicate, 'broadMatch');
			harness.equal('the pick is unchanged by the second call', verdict && verdict.choice, '1');
			harness.equal('category still comes from the PICK confidence', verdict && verdict.category, 'strong');
			harness.match('the rationale carries the relation and its confidence beside the pick', verdict && verdict.rationale, /chose "Has Organization Identifier".*Relation: broadMatch with probability 0\.6 and confidence 0\.55\. Next: closeMatch \(0\.2\)/);
			harness.equal('attempts count both calls', verdict && verdict.attempts, 2);
			harness.equal('usage sums both calls', JSON.stringify(verdict && verdict.usage), JSON.stringify({ input_tokens: 140, output_tokens: 15 }));
			harness.equal('jevConfidence stays the PICK confidence (the cascade escalates on it)', verdict && verdict.jevConfidence, 0.9);
			harness.equal('jevRelationConfidence is carried as evidence', verdict && verdict.jevRelationConfidence, 0.55);
			done();
		});
	},
	(done) => {
		const { provider, transport } = providerFor({ requestForm: 'string' }, [
			{ statusCode: 200, responseBody: answerBody({ choice: '2', confidence: 0.9, probabilities: { 1: 0.05, 2: 0.9, NONE: 0.05 } }) },
			{ statusCode: 200, responseBody: relationBody({ choice: 'exactMatch', confidence: 0.8, probabilities: RELATION_PROBABILITIES }) },
		]);
		provider.rerank({ choiceEnum, predicateRule: 'judgeSlot-v1', choiceQuestion }, (rerankError, verdict) => {
			harness.section('THE RELATION QUESTION FOLLOWS requestForm');
			harness.ok('no error', !rerankError, rerankError);
			const relationPayload = transport.sentPayloadList[1] || { state: {} };
			harness.equal('string form: the chosen candidate is name: value lines', relationPayload.state.chosenCandidate, 'name: Learning Resource Identifier\ndomainName: Organization');
			harness.match('string form: the source element is lines too', relationPayload.state.sourceElement, /^name: EducationOrganizationId\n/);
			harness.equal('predicate carried', verdict && verdict.predicate, 'exactMatch');
			done();
		});
	},
	(done) => {
		const { provider, transport } = providerFor({}, [{ statusCode: 200, responseBody: answerBody({ choice: 'NONE', confidence: 0.7, probabilities: { 1: 0.2, 2: 0.1, NONE: 0.7 } }) }]);
		provider.rerank({ choiceEnum, predicateRule: 'judgeSlot-v1', choiceQuestion }, (rerankError, verdict) => {
			harness.section('judgeSlot-v1 WITH NONE: THE ABSTAIN VALUE, NO SECOND CALL');
			harness.ok('no error', !rerankError, rerankError);
			harness.equal('ONE call only', transport.sentPayloadList.length, 1);
			harness.equal('predicate is the abstain value', verdict && verdict.predicate, 'none');
			harness.equal('category none', verdict && verdict.category, 'none');
			done();
		});
	},
	(done) => {
		const { provider } = providerFor({}, [
			{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence: 0.9, probabilities: { 1: 0.9, 2: 0.05, NONE: 0.05 } }) },
			{ statusCode: 200, responseBody: relationBody({ choice: 'relatedMatch', confidence: 0.9, probabilities: { relatedMatch: 0.9 } }) },
		]);
		provider.rerank({ choiceEnum, predicateRule: 'judgeSlot-v1', choiceQuestion }, (rerankError) => {
			harness.section('A RELATION OUTSIDE THE FOUR IS REFUSED, NEVER MAPPED');
			harness.match('refused by name', rerankError, /picked '1' but the relation question failed: .*Jev chose 'relatedMatch' for 'relationToChosenCandidate'/);
			done();
		});
	},
	(done) => {
		const { provider, transport } = providerFor({}, [
			{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence: 0.9, probabilities: { 1: 0.9, 2: 0.05, NONE: 0.05 } }) },
			{ statusCode: 400, responseBody: { error: 'bad request' } },
		]);
		provider.rerank({ choiceEnum, predicateRule: 'judgeSlot-v1', choiceQuestion }, (rerankError, verdict) => {
			harness.section('A FAILED RELATION CALL FAILS THE JUDGMENT — NO PREDICATE-LESS PICK');
			harness.match('refused naming the status', rerankError, /relation question failed: .*HTTP 400 after 1 attempt/);
			harness.equal('no verdict', verdict, undefined);
			harness.equal('two calls', transport.sentPayloadList.length, 2);
			done();
		});
	},
	(done) => {
		const { provider, transport } = providerFor({}, [{ statusCode: 200, responseBody: answerBody({ choice: '1', confidence: 0.9, probabilities: { 1: 0.9 } }) }]);
		provider.rerank({ choiceEnum, choiceQuestion }, (rerankError) => {
			harness.section('AN ABSENT predicateRule IS REFUSED BY NAME');
			harness.match('refused listing the known rules', rerankError, /predicateRule undefined names no select_candidate schema\. The known rules are: categoryTable-v1, judgeSlot-v1/);
			harness.equal('nothing was sent', transport.sentPayloadList.length, 0);
			done();
		});
	},
];

runSequence(caseList, () => {
	fs.rmSync(scratchDirectoryPath, { recursive: true, force: true });
	harness.report();
});
