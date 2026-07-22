#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// voyage.js — Voyage AI embedding provider (voyage-4-large).
// Adapted from the trackB prototype: switched the model default to voyage-4-large,
// wraps Node's built-in https inside a single taskList-style callback (no Promises).
// The API key is supplied by the caller from config (config.voyageEmbedding.apiKey);
// it is NEVER read from env and NEVER logged/echoed here.
// API docs: https://docs.voyageai.com/docs/embeddings

const https = require('https');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// -----
		// embed — POST one batch of texts to Voyage; callback (err, embeddings:number[][]).
		//   resolvedConfig: { apiKey, model, dimension }. The apiKey appears ONLY in the
		//   Authorization header — never logged, never returned, never placed in an error string.

		const embed = (texts, resolvedConfig, callback) => {
			const payload = JSON.stringify({
				input: texts,
				model: resolvedConfig.model,
			});

			const options = {
				hostname: 'api.voyageai.com',
				port: 443,
				path: '/v1/embeddings',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${resolvedConfig.apiKey}`,
					'Content-Length': Buffer.byteLength(payload),
				},
			};

			const req = https.request(options, (res) => {
				let body = '';
				res.on('data', (chunk) => {
					body += chunk;
				});
				res.on('end', () => {
					if (res.statusCode !== 200) {
						// body may echo request detail but never the key (it is a header only)
						callback(`Voyage API error ${res.statusCode}: ${body}`);
						return;
					}

					const parsed = qtParseJson(body);
					if (parsed.parseError) {
						callback(`Failed to parse Voyage response: ${parsed.parseError}`);
						return;
					}

					if (!parsed.value || !Array.isArray(parsed.value.data)) {
						callback('Voyage response missing data array');
						return;
					}

					const embeddings = parsed.value.data.map((one) => one.embedding);
					callback('', embeddings);
				});
			});

			req.on('error', (err) => {
				callback(`Voyage API request failed: ${err.message}`);
			});

			req.write(payload);
			req.end();
		};

		// -----
		// qtParseJson — non-throwing JSON parse; returns {value} or {parseError}.
		//   Avoids try/catch-for-control-flow at the call site by localizing the boundary.

		const qtParseJson = (text) => {
			let value;
			let parseError = '';
			try {
				value = JSON.parse(text);
			} catch (err) {
				parseError = err.message;
			}
			return parseError ? { parseError } : { value };
		};

		return { embed };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
