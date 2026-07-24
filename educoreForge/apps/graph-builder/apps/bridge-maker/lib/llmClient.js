'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// llmClient.js — the REAL Anthropic Messages client for the INFERRED-track RERANKER (P3b). FAITHFUL PORT of
// the incumbent npm/qtools-graph-forge-core/lib/llm-client/llm-client.js into the recreation, repointed at
// this project's [anthropicAi] .ini (env ANTHROPIC_API_KEY remains the alternative key source). It forces a
// single structured tool call so the model emits a constrained `choice` (a candidate index OR 'NONE'),
// exactly the json_schema-choice contract inferencePipeline.js consumes: it calls
//   llmClient.rerank({ systemPrompt, userPrompt, choiceEnum }, cb)  and reads only  cb('', { choice }).
// The extra returned keys ({ model, attempts }) are harmless surplus the pipeline ignores — the contract is
// met precisely on `choice`. The key is NEVER logged, echoed, or returned.
//
// NON-determinism note: the rerank is the ONE non-deterministic step of the inferred producer — it runs ONCE
// at --rebridge time and its output is FROZEN into a content-addressed decision block; a plain-build replay
// never calls this client. It is constructed ONLY on a real --rebridge (build.js's eager gate), NEVER by the
// hermetic suite (which injects a deterministic STUB llmClient).
//
// §6 NO-SILENT-DEFAULT (the one intentional deviation from the incumbent, mirroring embedding-client's
// discipline): a CONFIGURATION FAULT THROWS AT CONSTRUCTION. When no key resolves from either the ini or the
// env, the client REFUSES BY NAME the moment it is built — before any socket exists — rather than
// constructing cleanly and no-opping (or erroring only deep inside a rerank callback after credit could have
// been spent). Operational faults (a bad response, a timeout) still travel by callback.
//
// temperature is omitted for claude-opus-4-8 (the API rejects temperature for that model: 400
// invalid_request_error 'temperature is deprecated'); temperature 0 is sent for other models. Robust answer
// extraction (structured tool input.choice -> embedded "choice" regex -> bare NONE -> first in-range integer)
// mirrors the measured harness so parse failures stay at ~0.
//
// Native https + callbacks (no qtools HTTP-to-Anthropic library exists). No async/await, no try/catch for
// control flow (a JSON.parse guard is the one local exception, isolated to parsing the response body).
// camelCase only.
//
// @concept: [[LlmReranker]]

const path = require('path');
const fs = require('fs');
const https = require('https');
const configFileProcessor = require('qtools-config-file-processor');

// canonical config home for this project (secrets live ONLY here; the SAME [anthropicAi] .ini
// embedding-client's twin discipline names for [voyageEmbedding]). env ANTHROPIC_API_KEY is the alternative
// key source, resolved below and never logged.
const defaultConfigFilePath =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/configs/instanceSpecific/qbook/anthropicAi.ini';

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const TOOL_NAME = 'select_candidate';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ configFilePath = defaultConfigFilePath, model: modelOverride } = {}) => {
		const { xLog } = process.global;

		// resolve key/model/version from ini, with env as the alternative key source (never logged).
		const resolveConfig = () => {
			let iniConfig = {};
			if (fs.existsSync(configFilePath)) {
				const whole = configFileProcessor.getConfig(configFilePath) || {};
				iniConfig = whole.anthropicAi || {};
			}
			const apiKey = iniConfig.apiKey || process.env.ANTHROPIC_API_KEY || '';
			return {
				apiKey,
				keySource: iniConfig.apiKey ? 'ini' : process.env.ANTHROPIC_API_KEY ? 'env' : 'none',
				model: modelOverride || iniConfig.model || 'claude-opus-4-8',
				apiVersion: iniConfig.apiVersion || '2023-06-01',
				maxTokens: parseInt(iniConfig.maxTokens, 10) || 64,
				// L12: response timeout — a hung connection must never stall the pipeline forever (the
				// concurrency slot was never freed). Timeout destroys the request, which routes error-first
				// through the existing 'error' handler and the normal retry/backoff path.
				requestTimeoutMs: parseInt(iniConfig.requestTimeoutMs, 10) || 120000,
			};
		};

		const cfg = resolveConfig();

		// §6 CONFIGURATION FAULT — THROW AT CONSTRUCTION, BY NAME, when no key resolved. This is the seam the
		// recreation adds over the incumbent: build.js constructs this client ONLY for a real --rebridge, and a
		// real --rebridge with no Anthropic key must fail LOUDLY here (before a single Voyage or Opus credit is
		// spent), never construct a silently-no-op client. The message names the two places a key can live; it
		// NEVER echoes any key value.
		if (!cfg.apiKey) {
			throw new Error(
				`${moduleName}: no Anthropic API key resolved — set [anthropicAi].apiKey in the config ` +
					`(${configFilePath}) or the ANTHROPIC_API_KEY environment variable. There is no default; the ` +
					`reranker refuses to construct without a key rather than no-op later.`,
			);
		}

		// extractChoice — robust, mirrors the measured harness order.
		const extractChoice = (responseBody, choiceEnum) => {
			const inEnum = (value) => choiceEnum.indexOf(`${value}`) !== -1;
			// (a) structured tool input.choice
			const blocks = (responseBody && responseBody.content) || [];
			const toolBlock = blocks.find((b) => b && b.type === 'tool_use' && b.name === TOOL_NAME);
			if (toolBlock && toolBlock.input && inEnum(toolBlock.input.choice)) {
				return `${toolBlock.input.choice}`;
			}
			// gather any text the model emitted (for the alternative extraction paths)
			const text = blocks
				.filter((b) => b && b.type === 'text' && typeof b.text === 'string')
				.map((b) => b.text)
				.join(' ');
			// (b) embedded "choice": "X"
			const m = text.match(/"choice"\s*:\s*"?([A-Za-z0-9_]+)"?/);
			if (m && inEnum(m[1])) {
				return m[1];
			}
			// (c) a bare NONE token
			if (/\bNONE\b/.test(text) && inEnum('NONE')) {
				return 'NONE';
			}
			// (d) the first in-range integer mentioned
			const ints = text.match(/\d+/g) || [];
			const firstInRange = ints.find((n) => inEnum(n));
			return firstInRange || null;
		};

		// one POST attempt -> callback(err, parsedBody, statusCode).
		const postOnce = ({ payload }, callback) => {
			const body = JSON.stringify(payload);
			const req = https.request(
				{
					host: API_HOST,
					path: API_PATH,
					method: 'POST',
					timeout: cfg.requestTimeoutMs,
					headers: {
						'content-type': 'application/json',
						'content-length': Buffer.byteLength(body),
						'x-api-key': cfg.apiKey,
						'anthropic-version': cfg.apiVersion,
					},
				},
				(res) => {
					let raw = '';
					res.on('data', (chunk) => {
						raw += chunk;
					});
					res.on('end', () => {
						let parsed = null;
						let parseErr = null;
						const attempt = () => {
							parsed = JSON.parse(raw);
						};
						try {
							attempt();
						} catch (e) {
							parseErr = e;
						}
						if (parseErr) {
							callback(`response not JSON (status ${res.statusCode}): ${raw.slice(0, 200)}`, null, res.statusCode);
							return;
						}
						callback('', parsed, res.statusCode);
					});
				},
			);
			req.on('timeout', () => {
				// destroy() fires the 'error' handler below with this message -> status 0 (retriable).
				req.destroy(new Error(`no response within ${cfg.requestTimeoutMs}ms (request timeout)`));
			});
			req.on('error', (err) => callback(`request error: ${err.message}`, null, 0));
			req.write(body);
			req.end();
		};

		// rerank — { systemPrompt, userPrompt, choiceEnum } -> callback(err, { choice, model, attempts }).
		//   choiceEnum: e.g. ['1','2',...,'15','NONE']. Retries (6) with backoff on 429/5xx/network.
		//   The pipeline reads ONLY result.choice; model/attempts are surplus it ignores.
		const rerank = ({ systemPrompt, userPrompt, choiceEnum, maxRetries = 6 } = {}, callback) => {
			if (!cfg.apiKey) {
				// unreachable in normal use (construction already threw), kept as defense-in-depth.
				callback(`${moduleName}: no Anthropic API key ([anthropicAi].apiKey or ANTHROPIC_API_KEY)`);
				return;
			}
			const tool = {
				name: TOOL_NAME,
				description:
					'Record the single best matching CEDS candidate by its number, or NONE if no candidate is a correct match.',
				input_schema: {
					type: 'object',
					properties: {
						choice: {
							type: 'string',
							enum: choiceEnum,
							description: 'The chosen candidate number, or the string NONE.',
						},
					},
					required: ['choice'],
					additionalProperties: false,
				},
			};
			const payload = {
				model: cfg.model,
				max_tokens: cfg.maxTokens,
				system: systemPrompt,
				messages: [{ role: 'user', content: userPrompt }],
				tools: [tool],
				tool_choice: { type: 'tool', name: TOOL_NAME },
			};
			// claude-opus-4-8 rejects temperature; send 0 for everything else (the measured fix).
			if (!/^claude-opus-4/.test(cfg.model)) {
				payload.temperature = 0;
			}

			const backoffMs = [0, 500, 1200, 2500, 5000, 9000];
			const tryAttempt = (attemptIndex) => {
				postOnce({ payload }, (err, parsed, status) => {
					const retriable = status === 429 || (status >= 500 && status <= 599) || status === 0;
					if ((err || retriable) && attemptIndex + 1 < maxRetries) {
						const waitMs = backoffMs[Math.min(attemptIndex + 1, backoffMs.length - 1)];
						setTimeout(() => tryAttempt(attemptIndex + 1), waitMs);
						return;
					}
					if (err) {
						callback(`${moduleName}.rerank failed after ${attemptIndex + 1} attempts: ${err}`);
						return;
					}
					if (status !== 200) {
						const apiMsg = parsed && parsed.error ? parsed.error.message : `status ${status}`;
						callback(`${moduleName}.rerank API error (${status}): ${apiMsg}`);
						return;
					}
					const choice = extractChoice(parsed, choiceEnum);
					if (choice === null) {
						callback(`${moduleName}.rerank: could not extract a choice from the response`);
						return;
					}
					callback('', { choice, model: cfg.model, attempts: attemptIndex + 1 });
				});
			};
			tryAttempt(0);
		};

		return { rerank, model: cfg.model, keySource: cfg.keySource };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
