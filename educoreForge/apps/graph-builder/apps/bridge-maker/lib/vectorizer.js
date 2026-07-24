'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// vectorizer.js — the DEFINITION-embedding NET component (design §3.1, "the renamed embedder"). FAITHFUL
// PORT of the incumbent npm/qtools-graph-forge-core/lib/def-embedder/def-embedder.js into the recreation
// (P3a), repointed at the recreation's lib/embedding/embedding-client. It re-embeds a source/candidate
// node's defText fresh (voyage-4-large, byte-deterministic) and serves a CONTENT-ADDRESSED cache keyed by
// sha256(text) so a re-run is cheap and identical — the cache is a rebridge-time speedup only and never
// touches replay (a plain -build materializes the frozen block; it never embeds).
//
//   vectorizer({ cacheFilePath, embeddingConfigFilePath }) -> {
//       batchEmbed({ texts }, cb) -> cb('', { vectors })   // Float32Array[] aligned to input order
//   }
//
// NET: it reaches Voyage, so it runs ONLY in a real --rebridge, NEVER in the suite (§3 hard line 2). The
// hermetic tests inject a FAKE vectorizer that returns deterministic fixture vectors; this real body is
// present and faithful but unexercised by runAllTests. Async via qtools taskListPlus/pipeRunner; no
// async/await, no try/catch for control flow (beyond the JSON-parse of a possibly-corrupt cache file, which
// is a parse, not control flow). camelCase only.
//
// @concept: [[DefinitionEmbedding]]
// @concept: [[Vectorizer]]

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const embeddingClientFactory = require(path.join(
	__dirname,
	'..',
	'..',
	'..',
	'..',
	'..',
	'lib',
	'embedding',
	'embedding-client',
));

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
				xLog.status(`[vectorizer] cache unreadable (${parseErr.message}); starting empty`);
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
				`[vectorizer] ${safeTexts.length} texts; ${missing.length} distinct cache-miss to embed`,
			);

			const taskList = new taskListPlus();
			const batches = [];
			for (let i = 0; i < missing.length; i += BATCH_SIZE) {
				batches.push(missing.slice(i, i + BATCH_SIZE));
			}
			batches.forEach((oneBatch, batchIndex) => {
				taskList.push((args, next) => {
					embedder.embedTexts({ texts: oneBatch }, (err, result) => {
						if (err) {
							next(`vectorizer batch ${batchIndex + 1}/${batches.length}: ${err}`);
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
