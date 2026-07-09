#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const contentAddress = require('../content-address/content-address')();

// START OF moduleFunction() ============================================================
//
// caching-embedder — a content-addressed caching DECORATOR around an embedding-client (PLAN §3.4,
// the forge-side WRITE-path half of the embedding sidecar). It is injected in place of the raw
// embedder at the single forge-bundle injection point, so all forges get check-cache-then-embed
// with NO per-forge edits.
//
// INTERFACE PRESERVATION (polyArch2 formal interface): this decorator exposes the SAME shape the
// embedding-client returns — { embedText, embedTexts, encodeVector, decodeVector, stampedModelVersion }
// — so it is a drop-in. Only embedTexts is decorated; embedText/encodeVector/decodeVector are
// delegated unchanged, stampedModelVersion is passed through.
//
// embedTexts (the batched pass the forges call) becomes CHECK-CACHE-THEN-EMBED against the injected
// per-standard vector-store, keyed by the shared addressing rule
//   vectorId = contentAddress.vectorIdForInput(stampedModelVersion, inputText)   [inputText = searchText]
// so that:
//   - identical inputs under the same model INTERN to ONE embedder call and ONE stored row (dedup);
//   - a duplicate input in a LATER batch is already stored (each batch putVectors before returning),
//     so it is NOT re-embedded — API calls over a run == the DISTINCT input count;
//   - a fully-warm re-run makes ZERO embedder calls (every input a hasVector hit).
// The block-format change (embeddingRef in the persisted block) is NOT here — that is the extract
// path; this half fills the store and provides interning + warm-run determinism.
//
// Async style (project doctrine): callback + qtools-asynchronous-pipe-plus taskList; NO async/await,
// NO try/catch for control flow; string error channel ('' == success). camelCase; compound names.

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder, vectorStore } = {}) => {
		const { xLog } = process.global;
		const { vectorIdForInput } = contentAddress;

		// the single addressing modelVersion for this decorator (PLAN §3.1); the embed result's
		// embeddingModelVersion is asserted to match it below so the stored key can never diverge
		// from the returned stamp.
		const addressingModelVersion = embedder.stampedModelVersion;

		// -----
		// embedTexts — preserves embedding-client.embedTexts:
		//   ({ texts }, cb) -> cb('', { vectors: Float32Array[], embeddingModelVersion }), 1:1 aligned.
		const embedTexts = ({ texts } = {}, callback) => {
			// mirror embedding-client.embedTexts input validation (same guarantees).
			if (!Array.isArray(texts) || texts.length === 0) {
				callback(`${moduleName}.embedTexts: texts is required and must be a non-empty array`);
				return;
			}
			const emptyIndex = texts.findIndex(
				(oneText) => oneText == null || `${oneText}`.trim() === '',
			);
			if (emptyIndex !== -1) {
				callback(
					`${moduleName}.embedTexts: texts[${emptyIndex}] is empty (every text must be non-empty)`,
				);
				return;
			}

			const stringifiedTexts = texts.map((oneText) => `${oneText}`);

			// distinct inputs, order-preserving — interning is per DISTINCT (modelVersion, inputText).
			const distinctTexts = [];
			const distinctIndexByText = new Map();
			stringifiedTexts.forEach((oneText) => {
				if (!distinctIndexByText.has(oneText)) {
					distinctIndexByText.set(oneText, distinctTexts.length);
					distinctTexts.push(oneText);
				}
			});
			const vectorIdByDistinct = distinctTexts.map((oneText) =>
				vectorIdForInput(addressingModelVersion, oneText),
			);

			const taskList = new taskListPlus();

			// 1. hasVector for each distinct input -> hit flags (already-stored inputs skip the API).
			taskList.push((args, next) => {
				const hitFlags = new Array(distinctTexts.length).fill(false);
				const checkOne = (distinctIdx) => {
					if (distinctIdx >= distinctTexts.length) {
						next('', { ...args, hitFlags });
						return;
					}
					vectorStore.hasVector(
						{ vectorId: vectorIdByDistinct[distinctIdx] },
						(err, present) => {
							if (err) {
								next(`${moduleName}.embedTexts hasVector[${distinctIdx}]: ${err}`);
								return;
							}
							hitFlags[distinctIdx] = !!present;
							checkOne(distinctIdx + 1);
						},
					);
				};
				checkOne(0);
			});

			// 2. embed ONLY the distinct misses, in ONE batched call (skipped entirely when all hit —
			//    the warm path that makes ZERO embedder calls).
			taskList.push((args, next) => {
				const missDistinctIndexes = [];
				const missTexts = [];
				args.hitFlags.forEach((isHit, distinctIdx) => {
					if (!isHit) {
						missDistinctIndexes.push(distinctIdx);
						missTexts.push(distinctTexts[distinctIdx]);
					}
				});
				if (missTexts.length === 0) {
					if (xLog && xLog.status) {
						xLog.status(
							`[caching-embedder] ${distinctTexts.length} distinct input(s), 0 miss — warm, no embed call`,
						);
					}
					next('', { ...args, missDistinctIndexes, missVectorByDistinctIndex: {} });
					return;
				}
				embedder.embedTexts({ texts: missTexts }, (err, result) => {
					if (err) {
						next(`${moduleName}.embedTexts embed misses: ${err}`);
						return;
					}
					if (result.embeddingModelVersion !== addressingModelVersion) {
						next(
							`${moduleName}.embedTexts: embedder stamped modelVersion ` +
								`'${result.embeddingModelVersion}' != addressing modelVersion ` +
								`'${addressingModelVersion}' — the stored key would diverge from the stamp`,
						);
						return;
					}
					const missVectorByDistinctIndex = {};
					missDistinctIndexes.forEach((distinctIdx, missPosition) => {
						missVectorByDistinctIndex[distinctIdx] = result.vectors[missPosition];
					});
					if (xLog && xLog.status) {
						xLog.status(
							`[caching-embedder] ${distinctTexts.length} distinct input(s), ${missTexts.length} embedded (1 call)`,
						);
					}
					next('', { ...args, missDistinctIndexes, missVectorByDistinctIndex });
				});
			});

			// 3. putVector each distinct miss (idempotent first-write-wins) — fills the store so a
			//    later batch/run interns, and so the extract path's embeddingRef will resolve.
			taskList.push((args, next) => {
				const { missDistinctIndexes, missVectorByDistinctIndex } = args;
				const putOne = (missPosition) => {
					if (missPosition >= missDistinctIndexes.length) {
						next('', args);
						return;
					}
					const distinctIdx = missDistinctIndexes[missPosition];
					vectorStore.putVector(
						{
							modelVersion: addressingModelVersion,
							inputText: distinctTexts[distinctIdx],
							vector: missVectorByDistinctIndex[distinctIdx],
						},
						(err) => {
							if (err) {
								next(`${moduleName}.embedTexts putVector[${distinctIdx}]: ${err}`);
								return;
							}
							putOne(missPosition + 1);
						},
					);
				};
				putOne(0);
			});

			// 4. resolve every distinct input's vector: a miss -> the vector just embedded; a hit ->
			//    getVector from the store (verify-on-read; the stored bytes are authoritative).
			taskList.push((args, next) => {
				const { hitFlags, missVectorByDistinctIndex } = args;
				const distinctVectors = new Array(distinctTexts.length);
				const resolveOne = (distinctIdx) => {
					if (distinctIdx >= distinctTexts.length) {
						next('', { ...args, distinctVectors });
						return;
					}
					if (!hitFlags[distinctIdx]) {
						distinctVectors[distinctIdx] = missVectorByDistinctIndex[distinctIdx];
						resolveOne(distinctIdx + 1);
						return;
					}
					vectorStore.getVector(
						{ vectorId: vectorIdByDistinct[distinctIdx] },
						(err, record) => {
							if (err) {
								next(`${moduleName}.embedTexts getVector[${distinctIdx}]: ${err}`);
								return;
							}
							if (!record) {
								next(
									`${moduleName}.embedTexts: hasVector reported present but getVector ` +
										`returned null for distinct input ${distinctIdx} ` +
										`(vectorId ${vectorIdByDistinct[distinctIdx]})`,
								);
								return;
							}
							distinctVectors[distinctIdx] = Float32Array.from(record.vector);
							resolveOne(distinctIdx + 1);
						},
					);
				};
				resolveOne(0);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				// map distinct vectors back to input order (vectors[i] is the embedding of texts[i]).
				const vectors = stringifiedTexts.map(
					(oneText) => args.distinctVectors[distinctIndexByText.get(oneText)],
				);
				callback('', { vectors, embeddingModelVersion: addressingModelVersion });
			});
		};

		// interface preservation — delegate the undecorated members unchanged.
		const embedText = (params, callback) => embedder.embedText(params, callback);
		const encodeVector = (float32) => embedder.encodeVector(float32);
		const decodeVector = (base64) => embedder.decodeVector(base64);

		return {
			embedText,
			embedTexts,
			encodeVector,
			decodeVector,
			stampedModelVersion: embedder.stampedModelVersion,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
