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
//   const embedder = require('./embedding-client')({ configFilePath, providerName });
//     configFilePath?  the .ini holding [voyageEmbedding]; default = the canonical project config
//                      named at the top of this file.
//     providerName?    which provider in ./providers/ makes the vectors. DEFAULT: 'voyage'.
//                      Legitimately optional and DOCUMENTED HERE, which is what §6 requires of a
//                      default: voyage is the only provider on disk, the registry is a discovery
//                      pattern, and a caller that names nothing gets the one that exists. An
//                      UNKNOWN or blank name is REFUSED when the client is built — not later,
//                      inside a callback, after the credentials file has been opened.
//   embedder.providerName() -> the provider actually in force (so a caller can SEE the default)
//   embedder.embedText({ text }, (err, { vector, embeddingModelVersion }) => {...});
//     vector: Float32Array of the configured dimension; embeddingModelVersion is the model that
//     ACTUALLY made it — the same [voyageEmbedding].model value that was sent to the API.
//   embedder.embedTexts({ texts }, (err, { vectors, embeddingModelVersion }) => {...});
//   embedder.resolveEmbeddingIdentity() -> { model, embeddingDims }  (never the key)
//   embedder.encodeVector(float32) -> base64 (little-endian float32)
//   embedder.decodeVector(base64)  -> Float32Array (round-trip identical)
//
// CHANNELS: CONFIGURATION FAULTS THROW; OPERATIONAL FAULTS CALL BACK. apiKey, model and
// embeddingDims are three keys in one section of one file, read in one pass, and all three THROW
// when absent or invalid — they are read in a synchronous resolver before any provider is touched
// and long before a socket exists, and resolveEmbeddingIdentity() is public with no callback at
// all. An empty text, or a provider that answered badly, travels by callback.
//
// NO IN-CODE MODEL CONSTANT (Phase 4 work group 1, 2026-07-23). The model sent to Voyage used to
// come from the ini while the model stamped onto every node came from a constant here, so
// configuring any other model produced vectors whose content address named a model that did not
// make them. The stamp lied, and silently. There is now exactly ONE reading of the model, used
// for both the call and the stamp, and its absence is a fault (polyArch2 §6).

const path = require('path');
const fs = require('fs');
const configFileProcessor = require('qtools-config-file-processor');

// The DOCUMENTED default provider (header interface block above). It shadows no config key —
// there is no ini setting for the provider — so it is a plain constant standing behind a
// legitimately optional module parameter, which is what polyArch2 §6 permits when the default is
// stated in the module's interface. It is stated there.
const DEFAULT_PROVIDER_NAME = 'voyage';

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
	({ configFilePath = defaultConfigFilePath, providerName = DEFAULT_PROVIDER_NAME } = {}) => {
		// THE PROVIDER IS CHECKED WHEN THE CLIENT IS BUILT. An unknown name used to construct
		// cleanly, answer resolveEmbeddingIdentity() as though all were well, and be refused only
		// at embedText time — deep inside a callback, after the credentials file had been opened.
		// The default itself is legitimate and is documented in the header interface block above;
		// what was not legitimate was discovering a bad value three steps downstream (polyArch2 §6).
		if (typeof providerName !== 'string' || providerName.trim() === '') {
			throw new Error(
				`embedding-client: providerName is ${JSON.stringify(providerName)}, which is not a ` +
					`provider name. Omit it to take the documented default ` +
					`('${DEFAULT_PROVIDER_NAME}'), or name one of: ${Object.keys(providers).sort().join(', ')}.`,
			);
		}
		if (!providers[providerName]) {
			throw new Error(
				`embedding-client: unknown provider '${providerName}'. Available providers ` +
					`(discovered in ./providers/): ${Object.keys(providers).sort().join(', ')}. It was ` +
					`NOT quietly replaced with the default.`,
			);
		}

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

			// `parseInt(x, 10) || DEFAULT` used to sit here, which is two defects in one
			// expression: an absent key and a typo'd one both produced the same in-code number,
			// and 'embeddingDims=102o' produced 102 — a value nobody typed and nobody would see.
			// Numeric() is exact: a trailing character makes it NaN rather than a truncated number.
			const givenDims = voyageEmbedding.embeddingDims;
			const embeddingDims = Number(`${givenDims}`.trim());
			if (
				givenDims === undefined ||
				`${givenDims}`.trim() === '' ||
				!Number.isInteger(embeddingDims) ||
				embeddingDims <= 0
			) {
				throw new Error(
					`embedding-client: [voyageEmbedding].embeddingDims is ${
						givenDims === undefined ? 'not configured' : `'${givenDims}'`
					}, which is not a positive whole number. Add it to the [voyageEmbedding] section ` +
						`of ${configFilePath}. There is no default: this value governs the vector ` +
						`index and is part of the vector model's identity.`,
				);
			}

			return {
				model: `${model}`.trim(),
				embeddingDims,
			};
		};

		// -----
		// loadVoyageConfig — pull [voyageEmbedding] from the .ini (key/model/dims).
		//   Never logs or returns the key beyond the resolved config object the provider needs.

		const loadVoyageConfig = () => {
			const wholeConfig = configFileProcessor.getConfig(configFilePath);
			const voyageEmbedding = (wholeConfig && wholeConfig.voyageEmbedding) || {};
			const apiKey = voyageEmbedding.apiKey;

			// ONE CHANNEL FOR ONE CLASS OF FAULT. This used to answer a callback error string for
			// a missing apiKey while resolveEmbeddingIdentity() THREW for a missing model or a
			// mistyped embeddingDims — three keys, one section, one file, read in one pass,
			// reported on two channels. The throw already escaped embedText, so a caller had to
			// handle both anyway; the split bought nothing and hid the symmetry.
			//
			// THROW is the channel, for the same reasons work group 2 gave for replayManager's
			// resolveSettings: the read happens in a synchronous resolver before any provider is
			// touched and long before a socket exists, so nothing is in flight for a callback to
			// unwind; resolveEmbeddingIdentity() is PUBLIC and has no callback at all, so it must
			// throw regardless; and routing the throw into the callback would take a try/catch
			// around a synchronous call, which is try/catch as control flow and is forbidden here.
			//
			// The line this draws is CONFIGURATION THROWS, OPERATION CALLS BACK. An empty text or
			// a provider that answered badly still travels by callback, as it should.
			if (apiKey === undefined || apiKey === null || `${apiKey}`.trim() === '') {
				throw new Error(
					`embedding-client: [voyageEmbedding].apiKey is ${
						apiKey === undefined ? 'not configured' : 'present but EMPTY'
					}. Add it to the [voyageEmbedding] section of ${configFilePath}. There is no ` +
						`default and no other source: the key is read ONLY from config, never from ` +
						`the environment and never from the command line.`,
				);
			}

			const identity = resolveEmbeddingIdentity();

			return {
				resolvedConfig: {
					apiKey,
					model: identity.model,
					dimension: identity.embeddingDims,
				},
			};
		};

		// guaranteed present: an unknown providerName was refused at construction, above.
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

			const loaded = loadVoyageConfig();

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

			const loaded = loadVoyageConfig();

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

		return {
			embedText,
			embedTexts,
			encodeVector,
			decodeVector,
			resolveEmbeddingIdentity,
			// so a caller can SEE which provider is in force rather than assume the default took
			providerName: () => providerName,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
