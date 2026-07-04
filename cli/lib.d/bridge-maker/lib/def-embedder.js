'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// def-embedder.js — DEFINITION embeddings for the inferred-track retrieval. The per-standard forges embed
// `searchText` (a name-ish string) into node.embedding; the measured pipeline (EVAL-composedPipeline-062626)
// retrieves on DEFINITION embeddings (voyage-4-large over the node DESCRIPTION), which lifted recall@15 from
// ~0.754 (name pool) to 0.871 (def pool). So this module RE-EMBEDS defText fresh via the forge's own
// embedding-client (voyage-4-large, byte-deterministic) and serves a content-addressed cache keyed by
// sha256(text) so reruns are cheap and identical. Voyage determinism means the cache never changes a
// vector; the cache is a production-time speedup only and does not touch replay (replay reads the frozen
// edge block, never embeds).
//
// batchEmbed({ texts }, cb) -> { vectors: Float32Array[] } aligned to input order, embedding only the
// cache-missing texts (batched), then persisting the cache. Async via qtools taskListPlus/pipeRunner; no
// async/await, no try/catch for control flow. camelCase only.
//
// @concept: [[DefinitionEmbedding]]

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const CORE_LIB = path.join(__dirname, '..', '..', '..', '..', 'npm', 'qtools-graph-forge-core', 'lib');
const embeddingClientFactory = require(path.join(CORE_LIB, 'embedding', 'embedding-client'));

const BATCH_SIZE = 128;
const sha256 = (text) => crypto.createHash('sha256').update(`${text}`, 'utf8').digest('hex');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ cacheFilePath, embeddingConfigFilePath } = {}) => {
		const { xLog } = process.global;
		const embedder = embeddingClientFactory({
			...(embeddingConfigFilePath ? { configFilePath: embeddingConfigFilePath } : {}),
		});

		// cache: { sha256(text) -> base64 vector }. Loaded once, persisted after embedding new texts.
		const loadCache = () => {
			if (!cacheFilePath || !fs.existsSync(cacheFilePath)) {
				return {};
			}
			const raw = fs.readFileSync(cacheFilePath, 'utf8');
			let parsed = {};
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
				xLog.status(`[def-embedder] cache unreadable (${parseErr.message}); starting empty`);
				return {};
			}
			return parsed;
		};

		const persistCache = (cache) => {
			if (!cacheFilePath) {
				return;
			}
			fs.writeFileSync(cacheFilePath, JSON.stringify(cache));
		};

		// batchEmbed — texts -> { vectors } (Float32Array[]), cache-aware.
		const batchEmbed = ({ texts } = {}, callback) => {
			const safeTexts = (texts || []).map((oneText) => `${oneText == null ? '' : oneText}`);
			const cache = loadCache();

			// the distinct cache-missing texts (embed each once).
			const missing = [];
			const missingSeen = new Set();
			safeTexts.forEach((oneText) => {
				const key = sha256(oneText);
				if (!cache[key] && !missingSeen.has(key) && oneText.trim() !== '') {
					missingSeen.add(key);
					missing.push(oneText);
				}
			});

			xLog.status(
				`[def-embedder] ${safeTexts.length} texts; ${missing.length} distinct cache-miss to embed (voyage-4-large)`,
			);

			const taskList = new taskListPlus();
			// embed missing texts in serial batches, updating the cache.
			const batches = [];
			for (let i = 0; i < missing.length; i += BATCH_SIZE) {
				batches.push(missing.slice(i, i + BATCH_SIZE));
			}
			batches.forEach((oneBatch, batchIndex) => {
				taskList.push((args, next) => {
					embedder.embedTexts({ texts: oneBatch }, (err, result) => {
						if (err) {
							next(`def-embedder batch ${batchIndex + 1}/${batches.length}: ${err}`);
							return;
						}
						oneBatch.forEach((oneText, idx) => {
							cache[sha256(oneText)] = embedder.encodeVector(result.vectors[idx]);
						});
						next('', args);
					});
				});
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				if (err) {
					callback(err);
					return;
				}
				persistCache(cache);
				// assemble output vectors aligned to input order (empty text -> null vector).
				const vectors = safeTexts.map((oneText) => {
					if (oneText.trim() === '') {
						return null;
					}
					const encoded = cache[sha256(oneText)];
					return encoded ? embedder.decodeVector(encoded) : null;
				});
				callback('', { vectors });
			});
		};

		return { batchEmbed };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
