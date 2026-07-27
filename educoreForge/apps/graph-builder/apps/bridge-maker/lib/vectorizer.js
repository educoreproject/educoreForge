'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// vectorizer.js — the DEFINITION-embedding NET component (design §3.1, "the renamed embedder"). It
// re-embeds a source/candidate node's defText (voyage-4-large, byte-deterministic) for the inferred
// bridge's retrieval pass.
//
// NO LONGER KEEPS ITS OWN CACHE. The shared, content-addressed vector cache now lives TRANSPARENTLY
// inside embedding-client — every embedTexts checks and updates the one cache in dataStores, keyed by
// (embeddingModelVersion, embeddingDims, sha256(text)) — so this component's former per-file JSON cache
// was a redundant second layer and has been retired. What remains here is what the embedder does NOT
// do for its callers: DEDUP distinct texts and BATCH them within Voyage's per-call ceiling. A re-run is
// cheap and identical for the same reason it always was (the shared cache serves the repeats), but the
// cache is now ONE store shared with the forge, not a file beside the bridge. Replay never embeds.
//
//   vectorizer({ embeddingConfigFilePath }) -> {
//       batchEmbed({ texts }, cb) -> cb('', { vectors })   // Float32Array[] aligned to input order;
//                                                          // null at any position whose input is blank
//   }
//
// NET: it reaches Voyage (through the embedder) so it runs ONLY in a real --rebridge, NEVER in the suite
// (§3 hard line 2). The hermetic tests inject a FAKE vectorizer that returns deterministic fixture
// vectors; this real body is present and faithful but unexercised by runAllTests. Async via qtools
// taskListPlus/pipeRunner; no async/await, no try/catch for control flow. camelCase only.
//
// @concept: [[DefinitionEmbedding]]
// @concept: [[Vectorizer]]

const path = require('path');
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

// Voyage's per-call ceiling. The embedder does not chunk for its callers — it sends what it is given —
// so a component embedding thousands of texts must chunk, exactly as it always did.
const BATCH_SIZE = 128;

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embeddingConfigFilePath } = {}) => {
		const embedder = embeddingClientFactory({
			...(embeddingConfigFilePath ? { configFilePath: embeddingConfigFilePath } : {}),
		});

		// batchEmbed — texts -> { vectors } (Float32Array[] aligned 1:1 with input order; null at any
		// position whose input is blank). Dedups the distinct non-empty texts, embeds them in
		// Voyage-sized chunks THROUGH the embedder (which serves hits from and stores misses into the
		// shared content-addressed cache), then reprojects the vectors back onto the original positions.
		const batchEmbed = ({ texts } = {}, callback) => {
			const safeTexts = (texts || []).map((oneText) => `${oneText == null ? '' : oneText}`);
			const distinct = [...new Set(safeTexts.filter((oneText) => oneText.trim() !== ''))];

			if (distinct.length === 0) {
				callback('', { vectors: safeTexts.map(() => null) });
				return;
			}

			const byText = {};
			const taskList = new taskListPlus();
			for (let i = 0; i < distinct.length; i += BATCH_SIZE) {
				const chunk = distinct.slice(i, i + BATCH_SIZE);
				taskList.push((args, next) => {
					embedder.embedTexts({ texts: chunk }, (err, result) => {
						if (err) {
							next(`vectorizer batchEmbed: ${err}`);
							return;
						}
						chunk.forEach((oneText, index) => {
							byText[oneText] = result.vectors[index];
						});
						next('', args);
					});
				});
			}

			pipeRunner(taskList.getList(), {}, (err) => {
				if (err) {
					callback(err);
					return;
				}
				const vectors = safeTexts.map((oneText) =>
					oneText.trim() === '' ? null : byText[oneText],
				);
				callback('', { vectors });
			});
		};

		return { batchEmbed };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
