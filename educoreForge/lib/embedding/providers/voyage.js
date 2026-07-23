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
	({ httpsRequest = https.request } = {}) => {
		// httpsRequest is the transport seam: production takes the real https.request; the test
		// suite injects a fake so the built request payload and the returned-vector length check
		// can be proven WITHOUT a socket or a Voyage bill. It is inert plumbing — it changes no
		// behavior of a live call, which uses the default.
		// -----
		// embed — POST one batch of texts to Voyage; callback (err, embeddings:number[][]).
		//   resolvedConfig: { apiKey, model, dimension }. The apiKey appears ONLY in the
		//   Authorization header — never logged, never returned, never placed in an error string.

		const embed = (texts, resolvedConfig, callback) => {
			// output_dimension carries the CONFIGURED width to Voyage. voyage-4-large (and the
			// other Matryoshka models) answer at their OWN default width when it is omitted, so a
			// config of 512 against a 1024-default model used to bill the call AND hand back
			// 1024-long vectors that a 512-wide index then silently dropped — money spent, search
			// empty. resolvedConfig.dimension is the ini's embeddingDims, already validated as a
			// positive integer by embedding-client before it reaches here.
			// API field name per https://docs.voyageai.com/docs/embeddings — output_dimension.
			const payload = JSON.stringify({
				input: texts,
				model: resolvedConfig.model,
				output_dimension: resolvedConfig.dimension,
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

			const req = httpsRequest(options, (res) => {
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

					// EVERY returned vector must be the CONFIGURED width. output_dimension asks for
					// it; this refuses to trust that it was honoured. A vector of any other length
					// is one the downstream index would silently drop, so it is caught HERE, named,
					// rather than handed on to disappear. Operational fault (the provider answered
					// badly) → it travels by CALLBACK, like every other response fault in this
					// module — a throw inside this async response handler would be uncaught.
					const expectedDimension = resolvedConfig.dimension;
					const wrongIndex = embeddings.findIndex(
						(oneEmbedding) =>
							!Array.isArray(oneEmbedding) || oneEmbedding.length !== expectedDimension,
					);
					if (wrongIndex !== -1) {
						const gotLength = Array.isArray(embeddings[wrongIndex])
							? embeddings[wrongIndex].length
							: 'not-an-array';
						callback(
							`Voyage returned a vector of the WRONG length at index ${wrongIndex}: ` +
								`expected ${expectedDimension} (the configured embeddingDims, sent as ` +
								`output_dimension), got ${gotLength}. The vector is refused rather than ` +
								`handed on to be silently dropped by a ${expectedDimension}-wide index.`,
						);
						return;
					}

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
