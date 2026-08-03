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
//   embedder.encodeVector(float32) -> base64 (little-endian float32). Takes a Float32Array or
//     an array of finite numbers; anything else is REFUSED rather than coerced. An EMPTY vector
//     is a legitimate value and encodes to the empty string.
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

// canonical home of the ONE shared vector cache (dataStores, used by every forge and every bridge).
// A DOCUMENTED default standing behind an optional module parameter — polyArch2 §6 permits exactly
// that: the cache is ON by default because a vector is a once-ever cost and isolating it per build is
// waste, and a caller (the test suite) turns it OFF or redirects it by passing cacheFilePath. Passing
// `false` disables caching entirely (pure provider path); passing another path redirects it.
const defaultCacheFilePath =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3';

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
	({
		configFilePath = defaultConfigFilePath,
		providerName = DEFAULT_PROVIDER_NAME,
		cacheFilePath = defaultCacheFilePath,
	} = {}) => {
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
		// THE TRANSPARENT VECTOR CACHE. Caching is ON by default (cacheFilePath defaults to the
		// shared dataStores store); `false`/`null` disables it and reproduces the original pure
		// provider path exactly. vectorCache is required LAZILY — only here, on the first embed
		// with caching on — because it requires sqlite-instance at load, which destructures
		// process.global; a top-level require would kill -help (the same trap decision-store
		// carries). cacheOpenState memoizes the opened cache so the file opens once per client.
		const cachingEnabled = !(cacheFilePath === false || cacheFilePath == null);
		let vectorCacheModule = null;
		let cacheOpenState = null; // null=unopened; { api } once opened

		const getVectorCacheModule = () => {
			if (!vectorCacheModule) {
				vectorCacheModule = require('./vectorCache')();
			}
			return vectorCacheModule;
		};

		// ensureCache — yields the opened cache api, or null when caching is disabled. Opens the
		// shared store once and memoizes it. A cache open failure is a fault named through the
		// callback, not a silent fall-through to an uncached path (which would resume spending
		// Voyage without anyone asking).
		const ensureCache = (cacheCallback) => {
			if (!cachingEnabled) {
				cacheCallback('', null);
				return;
			}
			if (cacheOpenState) {
				cacheCallback('', cacheOpenState.api);
				return;
			}
			getVectorCacheModule().open({ databaseFilePath: cacheFilePath }, (openErr, api) => {
				if (openErr) {
					cacheCallback(`embedding-client: opening vector cache '${cacheFilePath}': ${openErr}`);
					return;
				}
				cacheOpenState = { api };
				cacheCallback('', api);
			});
		};

		// vectorsFromProvider — the raw provider call + the validation both embed doors used to
		// carry inline, now in one place: texts -> Float32Array[] aligned 1:1 with input order.
		const vectorsFromProvider = (stringified, resolvedConfig, provCallback) => {
			provider.embed(stringified, resolvedConfig, (err, embeddings) => {
				if (err) {
					provCallback(err);
					return;
				}
				if (!Array.isArray(embeddings) || embeddings.length !== stringified.length) {
					provCallback(
						`embedding-client: provider returned ${
							embeddings ? embeddings.length : 'no'
						} embeddings for ${stringified.length} texts`,
					);
					return;
				}
				const badIndex = embeddings.findIndex(
					(oneEmbedding) => !oneEmbedding || !oneEmbedding.length,
				);
				if (badIndex !== -1) {
					provCallback(`embedding-client: provider returned an empty embedding at index ${badIndex}`);
					return;
				}
				provCallback('', embeddings.map((oneEmbedding) => Float32Array.from(oneEmbedding)));
			});
		};

		// cachedEmbedTexts — the ONE cached embedding path both embedText and embedTexts funnel
		// through. Look up every text's (model, dims, textHash) in the shared cache, send ONLY the
		// distinct misses to the provider, store the new vectors, and assemble the result in input
		// order. With caching disabled it is exactly the old provider path. Returns Float32Array[]
		// aligned 1:1 with `stringified`, plus the embeddingModelVersion actually in force.
		const cachedEmbedTexts = (stringified, embedCallback) => {
			const loaded = loadVoyageConfig(); // config faults THROW here, before anything async
			const model = loaded.resolvedConfig.model;
			const dims = loaded.resolvedConfig.dimension;

			ensureCache((cacheErr, cacheApi) => {
				if (cacheErr) {
					embedCallback(cacheErr);
					return;
				}

				if (!cacheApi) {
					// caching disabled — the original behavior, unchanged.
					vectorsFromProvider(stringified, loaded.resolvedConfig, (err, vectors) => {
						if (err) {
							embedCallback(err);
							return;
						}
						embedCallback('', { vectors, embeddingModelVersion: model });
					});
					return;
				}

				const cacheModule = getVectorCacheModule();
				const hashes = stringified.map((oneText) => cacheModule.textHashOf(oneText));

				cacheApi.getVectors(
					{ embeddingModelVersion: model, embeddingDims: dims, textHashes: hashes },
					(getErr, getResult) => {
						if (getErr) {
							embedCallback(getErr);
							return;
						}
						const byHash = getResult.byHash;

						// distinct misses only — a batch may repeat a text, and two texts that hash
						// the same are one embedding cost, not two.
						const missSeen = new Set();
						const missTexts = [];
						const missHashes = [];
						stringified.forEach((oneText, index) => {
							const oneHash = hashes[index];
							if (!byHash[oneHash] && !missSeen.has(oneHash)) {
								missSeen.add(oneHash);
								missTexts.push(oneText);
								missHashes.push(oneHash);
							}
						});

						// observability, mirroring the bridge vectorizer's long-standing line: every
						// text not named a miss was served from the shared cache and cost no Voyage.
						const { xLog } = process.global || {};
						if (xLog && xLog.status) {
							xLog.status(
								`[embedding-client] vector cache: ${stringified.length} text(s), ` +
									`${missTexts.length} distinct miss to embed, ` +
									`${stringified.length - missTexts.length} served from cache`,
							);
						}

						const assemble = () => {
							// every hash is now present in byHash (hits + just-stored misses)
							const vectors = stringified.map((oneText, index) =>
								decodeVector(byHash[hashes[index]]),
							);
							embedCallback('', { vectors, embeddingModelVersion: model });
						};

						if (missTexts.length === 0) {
							// DEFERRED, deliberately (hubReimplementation Phase 2, 2026-08-03). With zero
							// misses this path used to call assemble() IN-FRAME, making embedTexts complete
							// synchronously on a warm cache while completing asynchronously on any miss (the
							// provider HTTP call unwinds the stack). A caller running SERIAL batches through a
							// callback pipe — the forge bundles' embedNodes pattern and the hub-card embed
							// pass — therefore recursed one whole batch-chain deeper per fully-cached batch and
							// blew the stack on the FIRST fully-cache-served run (observed: hub batch 320/740,
							// RangeError, test-cedsHubBuildGates forge run 2 — unreachable before the cache was
							// ever warm enough). setImmediate unwinds the stack between batches; the contract
							// and result are byte-identical, only the completion tick moves.
							setImmediate(assemble);
							return;
						}

						vectorsFromProvider(missTexts, loaded.resolvedConfig, (err, missVectors) => {
							if (err) {
								embedCallback(err);
								return;
							}
							const entries = missTexts.map((oneText, index) => {
								const vectorBase64 = encodeVector(missVectors[index]);
								byHash[missHashes[index]] = vectorBase64; // fill for assembly
								return { textHash: missHashes[index], sourceText: oneText, vectorBase64 };
							});
							cacheApi.putVectors(
								{ embeddingModelVersion: model, embeddingDims: dims, entries },
								(putErr) => {
									if (putErr) {
										embedCallback(putErr);
										return;
									}
									assemble();
								},
							);
						});
					},
				);
			});
		};

		// -----
		// embedText — embed ONE text; callback (err, { vector, embeddingModelVersion }).
		//   vector is a Float32Array of the configured dimension; embeddingModelVersion is the
		//   model that was ACTUALLY sent, read from the same resolved config the provider got.

		const embedText = ({ text } = {}, callback) => {
			if (text == null || `${text}`.trim() === '') {
				callback('embedding-client.embedText: text is required and must be non-empty');
				return;
			}

			// funnels through the ONE cached path; a single-text embed is a one-element batch.
			cachedEmbedTexts([`${text}`], (err, result) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					vector: result.vectors[0],
					embeddingModelVersion: result.embeddingModelVersion,
				});
			});
		};

		// -----
		// encodeVector — Float32Array -> base64 of its little-endian float32 bytes.

		// embedTexts — embed an ARRAY of texts in ONE batched call to the configured model;
		// callback (err, { vectors, embeddingModelVersion }). vectors is a Float32Array[]
		// aligned 1:1 with input order (vectors[i] is the embedding of texts[i]). Used by the
		// forger to batch-embed nodes. Now cache-aware: it funnels through cachedEmbedTexts, so
		// only distinct cache-MISSES reach the provider — the same public contract, transparently.
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

			const stringified = texts.map((oneText) => `${oneText}`);
			cachedEmbedTexts(stringified, callback);
		};

		const encodeVector = (float32) => {
			// `Float32Array.from(float32 || [])` used to sit here. It turned null and undefined
			// into an EMPTY vector, and — the worse case — a stray STRING into a NaN-filled one
			// that base64-encodes to a real-looking payload. This is a public codec on the module
			// surface: a caller who hands it the wrong thing must hear so, not receive a plausible
			// blob (polyArch2 §6). An empty vector remains a legitimate VALUE; what is refused is
			// a non-vector.
			if (!(float32 instanceof Float32Array) && !Array.isArray(float32)) {
				throw new Error(
					`embedding-client.encodeVector: expected a Float32Array or an array of numbers, ` +
						`got ${float32 === null ? 'null' : typeof float32}. A vector is not something ` +
						`this codec will invent from what it was handed.`,
				);
			}
			const badIndex = Array.from(float32).findIndex(
				(oneValue) => typeof oneValue !== 'number' || !Number.isFinite(oneValue),
			);
			if (badIndex !== -1) {
				throw new Error(
					`embedding-client.encodeVector: element [${badIndex}] is ` +
						`${JSON.stringify(float32[badIndex])}, which is not a finite number. A vector ` +
						`carrying a NaN is not a vector, and it is not encoded as though it were.`,
				);
			}
			const source =
				float32 instanceof Float32Array ? float32 : Float32Array.from(float32);
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
