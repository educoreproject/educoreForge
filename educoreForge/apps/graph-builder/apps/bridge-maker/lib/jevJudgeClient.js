'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// jevJudgeClient.js — the JEV judge provider (TypeSafe System One), satisfying JUDGE_PROVIDER_SHAPE.
// Created 2026-09-29 (COPPER_LOOM) on TQ's instruction. Jev is a PERMANENT judge option, not a trial.
//
// It answers the same seam as llmClient and ollamaJudgeClient —
// rerank({systemPrompt, userPrompt, choiceEnum, choiceQuestion}, cb) -> cb(err, {choice, category, rationale,
// model, attempts, usage}) — but Jev is not a text model. It takes {state, model, questions} and answers a
// typed Choice question with the winning option, a probability for every option, and a confidence. There is
// no prose to parse and none to ask for.
//
// ⟪THE QUESTION ARRIVES ALREADY SPLIT⟫ evidenceRenderer builds choiceQuestion {stateObject, instructionText,
// criteriaByChoice} from the same ALLOW-LISTED objects it renders into userPrompt (TQ's template slot). This
// driver never reads userPrompt. A question without choiceQuestion is refused by name — there is no parse to
// fall back to.
//
// ⟪requestForm⟫ data | string — TQ's comparison. data sends the source element and each candidate as JSON
// objects; string sends the same fields as "name: value" lines. The form is part of this provider's MODEL
// IDENTITY (jev:<wireModel>:<form>) because the judgment cache keys on identity: two forms must never serve
// each other's verdicts.
//
// ⟪CATEGORY AND RATIONALE ARE DERIVED, AND SAY SO⟫ Jev reports a confidence, not a category, so the category
// comes from configured confidence floors. The rationale is written HERE from Jev's own numbers and names the
// pick by its rendered name (BR-067); it never pretends Jev reasoned in words.
//
// Same-directory requires only, plus node builtins and the config processor, as ollamaJudgeClient.
// NO CLOCK, NO RANDOMNESS (BG-DET (a) covers this directory).

const fs = require('fs');
const https = require('https');
const configFileProcessor = require('qtools-config-file-processor');

const defaultConfigFilePath =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/configs/instanceSpecific/qbook/jevJudge.ini';

const CONFIG_SECTION_NAME = 'jevJudge';
const PROVIDER_NAME = 'jev';
const MODEL_NAMESPACE_SEPARATOR = ':';
const CLIENT_VERSION = 'jevJudgeClient-v1';
const QUESTION_ID = 'matchingCandidate';
const ABSTAIN_OPTION_NAME = 'NONE';
const ABSTAIN_CATEGORY_NAME = 'none';
const REQUEST_FORM_NAME_LIST = Object.freeze(['data', 'string']);
// Statuses worth one more try: rate limiting and server-side faults. Anything else is refused at once.
const RETRYABLE_STATUS_CODE_LIST = Object.freeze([429, 500, 502, 503, 504]);

const requiredValueOrThrow = (sectionConfig, configKeyName, configFilePath) => {
	const rawValue = sectionConfig[configKeyName];
	if (rawValue === undefined || rawValue === null || `${rawValue}`.trim() === '') {
		throw new Error(`${moduleName}: [${CONFIG_SECTION_NAME}].${configKeyName} is not configured in ${configFilePath}. Every key is required; there are no defaults.`);
	}
	return `${rawValue}`.trim();
};

const positiveIntegerOrThrow = (rawValue, configKeyName, configFilePath) => {
	const numberValue = Number(rawValue);
	if (!Number.isInteger(numberValue) || numberValue < 1) {
		throw new Error(`${moduleName}: [${CONFIG_SECTION_NAME}].${configKeyName} is '${rawValue}' in ${configFilePath} — it must be a positive integer.`);
	}
	return numberValue;
};

const unitIntervalOrThrow = (rawValue, configKeyName, configFilePath) => {
	const numberValue = Number(rawValue);
	if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 1) {
		throw new Error(`${moduleName}: [${CONFIG_SECTION_NAME}].${configKeyName} is '${rawValue}' in ${configFilePath} — it must be a number from 0 to 1.`);
	}
	return numberValue;
};

const resolveConfigOrThrow = (configFilePath) => {
	if (!fs.existsSync(configFilePath)) {
		throw new Error(`${moduleName}: no config file at ${configFilePath}. This provider is configured by a [${CONFIG_SECTION_NAME}] section there.`);
	}
	const sectionConfig = (configFileProcessor.getConfig(configFilePath) || {})[CONFIG_SECTION_NAME];
	if (!sectionConfig) {
		throw new Error(`${moduleName}: ${configFilePath} has no [${CONFIG_SECTION_NAME}] section.`);
	}
	const apiKeyEnvironmentVariableName = requiredValueOrThrow(sectionConfig, 'apiKeyEnvironmentVariableName', configFilePath);
	const apiKey = process.env[apiKeyEnvironmentVariableName];
	if (!apiKey) {
		throw new Error(`${moduleName}: the environment variable ${apiKeyEnvironmentVariableName} (named by [${CONFIG_SECTION_NAME}].apiKeyEnvironmentVariableName in ${configFilePath}) is empty or unset. TQ exports it from ~/.bash_aliases_local.`);
	}
	const requestForm = requiredValueOrThrow(sectionConfig, 'requestForm', configFilePath);
	if (REQUEST_FORM_NAME_LIST.indexOf(requestForm) === -1) {
		throw new Error(`${moduleName}: [${CONFIG_SECTION_NAME}].requestForm is '${requestForm}' in ${configFilePath}; the forms are: ${REQUEST_FORM_NAME_LIST.join(', ')}.`);
	}
	const strongMinConfidence = unitIntervalOrThrow(requiredValueOrThrow(sectionConfig, 'strongMinConfidence', configFilePath), 'strongMinConfidence', configFilePath);
	const moderateMinConfidence = unitIntervalOrThrow(requiredValueOrThrow(sectionConfig, 'moderateMinConfidence', configFilePath), 'moderateMinConfidence', configFilePath);
	if (moderateMinConfidence > strongMinConfidence) {
		throw new Error(`${moduleName}: [${CONFIG_SECTION_NAME}] moderateMinConfidence (${moderateMinConfidence}) is above strongMinConfidence (${strongMinConfidence}) in ${configFilePath}.`);
	}
	return {
		endpointHostName: requiredValueOrThrow(sectionConfig, 'endpointHostName', configFilePath),
		endpointPath: requiredValueOrThrow(sectionConfig, 'endpointPath', configFilePath),
		wireModel: requiredValueOrThrow(sectionConfig, 'wireModel', configFilePath),
		maxConcurrency: positiveIntegerOrThrow(requiredValueOrThrow(sectionConfig, 'maxConcurrency', configFilePath), 'maxConcurrency', configFilePath),
		requestTimeoutMs: positiveIntegerOrThrow(requiredValueOrThrow(sectionConfig, 'requestTimeoutMs', configFilePath), 'requestTimeoutMs', configFilePath),
		maxAttempts: positiveIntegerOrThrow(requiredValueOrThrow(sectionConfig, 'maxAttempts', configFilePath), 'maxAttempts', configFilePath),
		apiKey,
		requestForm,
		strongMinConfidence,
		moderateMinConfidence,
	};
};

// asFieldLines — the string form of one allow-listed object: "name: value" lines, the same shape the text
// prompt uses, without its headings.
const asFieldLines = (fieldObject) =>
	Object.keys(fieldObject)
		.map((fieldName) => `${fieldName}: ${fieldObject[fieldName]}`)
		.join('\n');

const buildRequestPayload = ({ choiceQuestion, wireModel, requestForm }) => {
	const shape = requestForm === 'string' ? asFieldLines : (fieldObject) => fieldObject;
	const criteria = Object.keys(choiceQuestion.criteriaByChoice).reduce((soFar, optionName) => {
		const optionValue = choiceQuestion.criteriaByChoice[optionName];
		return Object.assign({}, soFar, { [optionName]: typeof optionValue === 'string' ? optionValue : shape(optionValue) });
	}, {});
	return {
		state: { ...choiceQuestion.stateObject, sourceElement: shape(choiceQuestion.stateObject.sourceElement) },
		model: wireModel,
		questions: { [QUESTION_ID]: { type: 'choice', instructions: choiceQuestion.instructionText, criteria } },
	};
};

const optionNameFor = (choiceQuestion, optionName) => {
	const optionValue = choiceQuestion.criteriaByChoice[optionName];
	return optionValue && typeof optionValue === 'object' && optionValue.name ? optionValue.name : optionName;
};

const categoryFor = ({ choice, confidence, strongMinConfidence, moderateMinConfidence }) => {
	if (choice === ABSTAIN_OPTION_NAME) {
		return ABSTAIN_CATEGORY_NAME;
	}
	if (confidence >= strongMinConfidence) {
		return 'strong';
	}
	return confidence >= moderateMinConfidence ? 'moderate' : 'weakButReal';
};

// rationaleFor — Jev's numbers in words. Names every candidate it mentions by NAME, never by number (BR-067).
const rationaleFor = ({ choiceQuestion, answer, model }) => {
	const rankedOptionNameList = Object.keys(answer.probabilities).sort((left, right) => answer.probabilities[right] - answer.probabilities[left]);
	const describeOption = (optionName) =>
		optionName === ABSTAIN_OPTION_NAME ? `NONE (${answer.probabilities[optionName]})` : `"${optionNameFor(choiceQuestion, optionName)}" (${answer.probabilities[optionName]})`;
	const runnerUpList = rankedOptionNameList.filter((optionName) => optionName !== answer.choice).slice(0, 2);
	const pickText = answer.choice === ABSTAIN_OPTION_NAME ? 'abstained: NONE of the candidates' : `chose "${optionNameFor(choiceQuestion, answer.choice)}"`;
	return (
		`${model} ${pickText} with probability ${answer.probabilities[answer.choice]} and confidence ${answer.confidence}. ` +
		`Next: ${runnerUpList.map(describeOption).join(', ')}. ` +
		`Jev reports probabilities, not reasons; this rationale is written by ${moduleName} from those numbers.`
	);
};

// answerRefusal — Jev's answer checked against what was asked. A refusal names what is wrong.
const answerRefusal = ({ answer, choiceEnum }) => {
	if (!answer || answer.type !== 'choice') {
		return `the response carries no choice answer for '${QUESTION_ID}'`;
	}
	if (choiceEnum.indexOf(`${answer.choice}`) === -1) {
		return `Jev chose '${answer.choice}', which is not one of the offered options (${choiceEnum.join(', ')})`;
	}
	if (typeof answer.confidence !== 'number' || !answer.probabilities || typeof answer.probabilities[answer.choice] !== 'number') {
		return `Jev's answer for '${answer.choice}' carries no confidence or probability`;
	}
	return null;
};

const moduleFunction = (constructionOptions = {}) => {
	const { configFilePath = defaultConfigFilePath, componentOverrides = {} } = constructionOptions;
	const cfg = resolveConfigOrThrow(configFilePath);
	const namespacedModel = `${PROVIDER_NAME}${MODEL_NAMESPACE_SEPARATOR}${cfg.wireModel}${MODEL_NAMESPACE_SEPARATOR}${cfg.requestForm}`;

	const realPostOnce = ({ payload }, postCallback) => {
		const body = JSON.stringify(payload);
		const req = https.request(
			{
				hostname: cfg.endpointHostName,
				path: cfg.endpointPath,
				method: 'POST',
				headers: {
					Authorization: `Bearer ${cfg.apiKey}`,
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(body),
				},
				timeout: cfg.requestTimeoutMs,
			},
			(res) => {
				const chunkList = [];
				res.on('data', (chunk) => chunkList.push(chunk));
				res.on('end', () => {
					const responseText = Buffer.concat(chunkList).toString('utf8');
					let responseBody = null;
					try {
						responseBody = JSON.parse(responseText);
					} catch (parseFault) {
						responseBody = null;
					}
					postCallback('', { statusCode: res.statusCode, responseBody, responseText });
				});
			},
		);
		req.on('timeout', () => req.destroy(new Error(`request exceeded requestTimeoutMs (${cfg.requestTimeoutMs})`)));
		req.on('error', (requestFault) => postCallback(`${moduleName}: request to ${cfg.endpointHostName}${cfg.endpointPath} failed: ${requestFault.message}`));
		req.write(body);
		req.end();
	};
	const postOnce = componentOverrides.postOnce || realPostOnce;

	const rerank = (rerankOptions = {}, callback) => {
		const { choiceQuestion, choiceEnum } = rerankOptions;
		if (!choiceQuestion || !choiceQuestion.stateObject || !choiceQuestion.instructionText || !choiceQuestion.criteriaByChoice) {
			callback(`${moduleName}: rerank received no choiceQuestion {stateObject, instructionText, criteriaByChoice}. The renderer's variant must declare subjectData and candidateData for Jev to judge it; there is no text parse to fall back to.`);
			return;
		}
		if (!Array.isArray(choiceEnum) || !choiceEnum.length) {
			callback(`${moduleName}: rerank received no choiceEnum.`);
			return;
		}
		const payload = buildRequestPayload({ choiceQuestion, wireModel: cfg.wireModel, requestForm: cfg.requestForm });

		const attemptOnce = (attemptNumber) => {
			postOnce({ payload }, (postError, postResult) => {
				const statusCode = postResult ? postResult.statusCode : null;
				const isRetryable = !!postError || RETRYABLE_STATUS_CODE_LIST.indexOf(statusCode) !== -1;
				if (isRetryable && attemptNumber < cfg.maxAttempts) {
					attemptOnce(attemptNumber + 1);
					return;
				}
				if (postError) {
					callback(`${postError} (after ${attemptNumber} attempt(s))`);
					return;
				}
				if (statusCode !== 200 || !postResult.responseBody) {
					callback(`${moduleName}: HTTP ${statusCode} after ${attemptNumber} attempt(s): ${`${postResult.responseText}`.slice(0, 500)}`);
					return;
				}
				const answer = postResult.responseBody.answers && postResult.responseBody.answers[QUESTION_ID];
				const refusal = answerRefusal({ answer, choiceEnum });
				if (refusal) {
					callback(`${moduleName}: ${refusal}`);
					return;
				}
				callback('', {
					choice: `${answer.choice}`,
					category: categoryFor({ choice: `${answer.choice}`, confidence: answer.confidence, strongMinConfidence: cfg.strongMinConfidence, moderateMinConfidence: cfg.moderateMinConfidence }),
					rationale: rationaleFor({ choiceQuestion, answer, model: namespacedModel }),
					model: namespacedModel,
					attempts: attemptNumber,
					usage: postResult.responseBody.usage,
				});
			});
		};
		attemptOnce(1);
	};

	const describe = () => ({ provider: PROVIDER_NAME, model: namespacedModel, version: CLIENT_VERSION });

	return {
		name: PROVIDER_NAME,
		wireModel: cfg.wireModel,
		model: namespacedModel,
		maxConcurrency: cfg.maxConcurrency,
		rerank,
		describe,
	};
};

moduleFunction.PROVIDER_NAME = PROVIDER_NAME;

module.exports = moduleFunction;
