#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// embedding-client.js — provider-agnostic embedding client (contract §1C, DECISIONS §3).
//
// Reads the Voyage api key + model + dims from the project's standard .ini config via
// qtools-config-file-processor — section [voyageEmbedding] → apiKey / model / embeddingDims.
// The key is read ONLY from config (never from env), referred to as config.voyageEmbedding.apiKey,
// and is never logged, echoed, returned, or written anywhere.
//
//   const embedder = require('./embedding-client')({ configFilePath });
//   embedder.embedText({ text }, (err, { vector, embeddingModelVersion }) => {...});
//     vector: Float32Array of the configured dimension; embeddingModelVersion is the model that
//     ACTUALLY made it — the same [voyageEmbedding].model value that was sent to the API.
//   embedder.embedTexts({ texts }, (err, { vectors, embeddingModelVersion }) => {...});
//   embedder.resolveEmbeddingIdentity() -> { model, embeddingDims }  (never the key)
//   embedder.encodeVector(float32) -> base64 (little-endian float32)
//   embedder.decodeVector(base64)  -> Float32Array (round-trip identical)
//
// NO IN-CODE MODEL CONSTANT (Phase 4 work group 1, 2026-07-23). The model sent to Voyage used to
// come from the ini while the model stamped onto every node came from a constant here, so
// configuring any other model produced vectors whose content address named a model that did not
// make them. The stamp lied, and silently. There is now exactly ONE reading of the model, used
// for both the call and the stamp, and its absence is a fault (polyArch2 §6).

const path = require('path');
const fs = require('fs');
const configFileProcessor = require('qtools-config-file-processor');

// canonical config home for this project (DECISIONS §3; secrets live ONLY here)
const defaultConfigFilePath =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/configs/instanceSpecific/qbook/voyageEmbedding.ini';

// =====================================================================
// PROVIDER REGISTRY — auto-discovered from ./providers/ (registry, not switch)
// =====================================================================

const providersDir = path.join(__dirname, 'providers');
const providers = {};

fs.readdirSync(providersDir).forEach((file) => {
	if (file.endsWith('.js')) {
		const providerName = file.replace(/.js$/, '');
		providers[providerName] = require(path.join(providersDir, file))();
	}
});

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ configFilePath = defaultConfigFilePath, providerName = 'voyage' } = {}) => {
		// -----
		// resolveEmbeddingIdentity — the ONE reading of the vector model's identity from the ini.
		//   Public so a caller can learn what identity governs WITHOUT holding the key: the same
		//   values are used for the API call and for the stamp, and there is no other source for
		//   either. Absent or invalid is a fault, not an occasion for a default (polyArch2 §6) —
		//   these values participate in content addressing, so substituting one silently changes
		//   what every block id means.

		const resolveEmbeddingIdentity = () => {
			const wholeConfig = configFileProcessor.getConfig(configFilePath);
			const voyageEmbedding = (wholeConfig && wholeConfig.voyageEmbedding) || {};

			const model = voyageEmbedding.model;
			if (model === undefined || `${model}`.trim() === '') {
				throw new Error(
					`embedding-client: [voyageEmbedding].model is ${
						model === undefined ? 'not configured' : `'${model}'`
					}. Add it to the [voyageEmbedding] section of ${configFilePath}. There is no ` +
						`default: this value is sent to the API AND stamped on every vector as ` +
						`embeddingModelVersion, which every content address is computed from.`,
				);
			}

			return {
				model: `${model}`.trim(),
				embeddingDims: parseInt(voyageEmbedding.embeddingDims, 10) || 1024,
			};
		};

		// -----
		// loadVoyageConfig — pull [voyageEmbedding] from the .ini (key/model/dims).
		//   Never logs or returns the key beyond the resolved config object the provider needs.

		const loadVoyageConfig = () => {
			const wholeConfig = configFileProcessor.getConfig(configFilePath);
			const voyageEmbedding = wholeConfig && wholeConfig.voyageEmbedding;

			if (!voyageEmbedding || !voyageEmbedding.apiKey) {
				return {
					configError: `embedding-client: missing [voyageEmbedding].apiKey in config (${configFilePath})`,
				};
			}

			const identity = resolveEmbeddingIdentity();

			return {
				resolvedConfig: {
					apiKey: voyageEmbedding.apiKey,
					model: identity.model,
					dimension: identity.embeddingDims,
				},
			};
		};

		const provider = providers[providerName];

		// -----
		// embedText — embed ONE text; callback (err, { vector, embeddingModelVersion }).
		//   vector is a Float32Array of the configured dimension; embeddingModelVersion is the
		//   model that was ACTUALLY sent, read from the same resolved config the provider got.

		const embedText = ({ text } = {}, callback) => {
			if (text == null || `${text}`.trim() === '') {
				callback('embedding-client.embedText: text is required and must be non-empty');
				return;
			}

			if (!provider) {
				callback(
					`embedding-client.embedText: unknown provider '${providerName}' (available: ${Object.keys(providers).join(', ')})`,
				);
				return;
			}

			const loaded = loadVoyageConfig();
			if (loaded.configError) {
				callback(loaded.configError);
				return;
			}

			provider.embed([`${text}`], loaded.resolvedConfig, (err, embeddings) => {
				if (err) {
					callback(err);
					return;
				}

				if (!embeddings || !embeddings[0] || !embeddings[0].length) {
					callback('embedding-client.embedText: provider returned no embedding');
					return;
				}

				const vector = Float32Array.from(embeddings[0]);

				callback('', {
					vector,
					embeddingModelVersion: loaded.resolvedConfig.model,
				});
			});
		};

		// -----
		// encodeVector — Float32Array -> base64 of its little-endian float32 bytes.

		// embedTexts — embed an ARRAY of texts in ONE batched call to the configured model;
		// callback (err, { vectors, embeddingModelVersion }). vectors is a Float32Array[]
		// aligned 1:1 with input order (vectors[i] is the embedding of texts[i]). Additive,
		// non-breaking sibling of embedText (embedText is unchanged). Used by the forger to
		// batch-embed nodes within embedding cost/throughput limits.
		const embedTexts = ({ texts } = {}, callback) => {
			if (!Array.isArray(texts) || texts.length === 0) {
				callback('embedding-client.embedTexts: texts is required and must be a non-empty array');
				return;
			}

			const emptyIndex = texts.findIndex(
				(oneText) => oneText == null || `${oneText}`.trim() === '',
			);
			if (emptyIndex !== -1) {
				callback(`embedding-client.embedTexts: texts[${emptyIndex}] is empty (every text must be non-empty)`);
				return;
			}

			if (!provider) {
				callback(
					`embedding-client.embedTexts: unknown provider '${providerName}' (available: ${Object.keys(providers).join(', ')})`,
				);
				return;
			}

			const loaded = loadVoyageConfig();
			if (loaded.configError) {
				callback(loaded.configError);
				return;
			}

			const stringified = texts.map((oneText) => `${oneText}`);

			provider.embed(stringified, loaded.resolvedConfig, (err, embeddings) => {
				if (err) {
					callback(err);
					return;
				}

				if (!Array.isArray(embeddings) || embeddings.length !== stringified.length) {
					callback(
						`embedding-client.embedTexts: provider returned ${
							embeddings ? embeddings.length : 'no'
						} embeddings for ${stringified.length} texts`,
					);
					return;
				}

				const badIndex = embeddings.findIndex(
					(oneEmbedding) => !oneEmbedding || !oneEmbedding.length,
				);
				if (badIndex !== -1) {
					callback(`embedding-client.embedTexts: provider returned an empty embedding at index ${badIndex}`);
					return;
				}

				const vectors = embeddings.map((oneEmbedding) =>
					Float32Array.from(oneEmbedding),
				);

				callback('', {
					vectors,
					embeddingModelVersion: loaded.resolvedConfig.model,
				});
			});
		};

		const encodeVector = (float32) => {
			const source =
				float32 instanceof Float32Array ? float32 : Float32Array.from(float32 || []);
			// Buffer.from over the underlying bytes; x86/arm are little-endian, which the
			// decoder mirrors, so the round-trip is byte-exact on this platform.
			const buffer = Buffer.from(
				source.buffer,
				source.byteOffset,
				source.byteLength,
			);
			return buffer.toString('base64');
		};

		// -----
		// decodeVector — base64 -> Float32Array (mirror of encodeVector).

		const decodeVector = (base64) => {
			const buffer = Buffer.from(base64, 'base64');
			const float32 = new Float32Array(buffer.byteLength / 4);
			for (let i = 0; i < float32.length; i++) {
				float32[i] = buffer.readFloatLE(i * 4);
			}
			return float32;
		};

		return { embedText, embedTexts, encodeVector, decodeVector, resolveEmbeddingIdentity };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
