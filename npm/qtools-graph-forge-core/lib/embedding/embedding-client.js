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
//     vector: Float32Array(1024), embeddingModelVersion: 'voyage-4-large'
//   embedder.encodeVector(float32) -> base64 (little-endian float32)
//   embedder.decodeVector(base64)  -> Float32Array (round-trip identical, length 1024)

const path = require('path');
const fs = require('fs');
const configFileProcessor = require('qtools-config-file-processor');

// canonical config home for this project (DECISIONS §3; secrets live ONLY here)
const defaultConfigFilePath =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/configs/instanceSpecific/qbook/voyageEmbedding.ini';

const stampedModelVersion = 'voyage-4-large';

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

			return {
				resolvedConfig: {
					apiKey: voyageEmbedding.apiKey,
					model: voyageEmbedding.model || stampedModelVersion,
					dimension: parseInt(voyageEmbedding.embeddingDims, 10) || 1024,
				},
			};
		};

		const provider = providers[providerName];

		// -----
		// embedText — embed ONE text; callback (err, { vector, embeddingModelVersion }).
		//   vector is a Float32Array of length dimension (1024); embeddingModelVersion is
		//   stamped 'voyage-4-large' per DECISIONS §3 regardless of the query-side model.

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
					embeddingModelVersion: stampedModelVersion,
				});
			});
		};

		// -----
		// encodeVector — Float32Array -> base64 of its little-endian float32 bytes.

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

		return { embedText, encodeVector, decodeVector, stampedModelVersion };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
