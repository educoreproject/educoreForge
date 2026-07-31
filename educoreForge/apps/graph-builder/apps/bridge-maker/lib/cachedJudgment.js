'use strict';

// cachedJudgment.js — THE JUDGMENT-PERSISTENCE SEAM (p9-judgmentPersistence, 2026-07-31): the ONE
// wrapper every evidence bridge routes its per-source kit.evidenceSelect call through, folding TWO
// mechanisms transparently around the unchanged judge:
//
//   1. THE JUDGMENT CACHE IS THE CHECKPOINT (⟪TQ RULING, 2026-07-30⟫ "make totally sure that all
//      the results are written to disk as they are decided. Losing data is crazy."): before any
//      API call, the shared judgment cache (lib/judgment-cache) is checked under the full
//      three-part address (promptHash, model, rendererVersion) — a hit returns the stored
//      judgment with ZERO spend; a live judgment is WRITTEN TO DISK **BEFORE** it is delivered
//      downstream (decided = persisted, synchronously in this callback chain — a cache-write
//      failure is FATAL, because proceeding past it recreates exactly the losable-judgment state
//      the ruling forbids). promptHash = lib/content-address.blockIdForText of the EXACT rendered
//      prompt text. SOUNDNESS INVARIANT (restated from judgment-cache.js): a hit is only valid
//      because identical rendered evidence + same model + same renderer version — this module
//      refuses to consult a cache without a declared model or rendererVersion, and re-verifies on
//      every hit that the stored ordinal still names the same candidate (chosenStableId).
//
//   2. FORENSIC MATCH LOGGING (⟪TQ RULING, 2026-07-31⟫ "make sure that you have a good log so
//      that we can review and diagnose the processing details to support forensic examination to
//      improve quality later"): one JSONL record per judgment (lib/match-forensics), written AT
//      DECISION TIME — live judgments AND cache hits both (dedupe fan-outs are recorded by
//      lib/judgmentDedupe.js, this seam's sibling). Forensics are EVIDENCE, NOT A GATE: an append
//      failure is logged LOUDLY through xLog and surfaced in judgeMeta.forensicsError, but never
//      kills the run — unlike the cache write, which is replayed truth and IS a gate.
//
// QUALITY IS UNTOUCHABLE (⟪TQ RULING, 2026-07-31⟫ "I do not want *any* compromise in the quality
// of the matches"): this seam changes NOTHING about what is judged or how — no truncation, no
// model substitution, no judgment skipping. A live call is the byte-identical evidenceSelect call
// the bridge always made; a cache hit is sound precisely because the rendered evidence, model, and
// renderer are identical; a passthrough (both mechanisms off) is the original call, unchanged.
//
// USAGE CAPTURE without contract drift: the Anthropic usage envelope (input/output tokens,
// stop_reason, attempts, retryReasons — llmClient.js's additive rerank payload) is captured by a
// per-call DECORATOR around llmClient.rerank, so kit.evidenceSelect and the SELECT contract stay
// byte-untouched. A stub llmClient that returns no usage simply yields usage null — never a
// fabricated number.
//
//   cachedJudgment({ judgmentCache, matchForensics, pairKey, generation, rendererVersion,
//                    evidenceSelect, llmClient })
//     -> judgeOne({ promptText, pool, sourceStableId, sourceName },
//                 callback(err, { selectResult, judgeMeta }))
//
//   judgmentCache    the OPENED lib/judgment-cache api ({ getJudgment, putJudgment }), or null —
//                    null disables caching entirely (the original pure judge path).
//   matchForensics   the OPENED lib/match-forensics api ({ appendRecord }), or null — null
//                    disables forensic logging.
//   selectResult     exactly what kit.evidenceSelect delivers ({ abstain, pick, category,
//                    rationale }) — byte-identical whether live or served from cache.
//   judgeMeta        { servedFromCache, promptHash, judgmentPayload, model, forensicsError } —
//                    judgmentPayload is the persisted decided-time truth ({ choice,
//                    chosenStableId, category, rationale }), which lib/judgmentDedupe.js reuses
//                    for fan-out forensic records.
//
// House style: callback(errString, result) with '' on success (R7 — callback-shaped throughout);
// refuse-by-name (polyArch2 §6); no async/await, no try/catch control flow; camelCase.

const path = require('path');

// 5 levels up from apps/graph-builder/apps/bridge-maker/lib to the tree root — the SAME depth
// evidenceFreezer.js (this directory) uses to reach lib/content-address.
const contentAddress = require(
	path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'content-address', 'content-address'),
)();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// reconstructSelectResult — a stored decided-time judgment + the CURRENT pool -> the selectResult
// the live judge would have delivered. Refuses BY NAME (error string return) when the stored
// ordinal does not resolve or names a different candidate than it did at decision time — either
// would mean the soundness invariant was violated upstream (a non-identical pool behind an
// identical prompt), and a wrong-candidate replay must never flow silently.
const reconstructSelectResult = (storedJudgment, pool) => {
	if (storedJudgment.choice === 'NONE') {
		return {
			selectResult: {
				abstain: true,
				pick: null,
				category: storedJudgment.category,
				rationale: storedJudgment.rationale,
			},
		};
	}
	const ordinal = parseInt(storedJudgment.choice, 10);
	const poolEntry = Number.isInteger(ordinal) && ordinal >= 1 ? pool[ordinal - 1] : undefined;
	if (!poolEntry || !poolEntry.candidate) {
		return {
			error:
				`${moduleName}: cached judgment names ordinal '${storedJudgment.choice}' but the current ` +
				`pool has ${pool.length} entries — an identical prompt cannot have produced a different ` +
				`pool; the soundness invariant is violated and this hit is refused rather than replayed.`,
		};
	}
	if (poolEntry.candidate.stableId !== storedJudgment.chosenStableId) {
		return {
			error:
				`${moduleName}: cached judgment ordinal ${ordinal} named candidate ` +
				`'${storedJudgment.chosenStableId}' at decision time but now resolves to ` +
				`'${poolEntry.candidate.stableId}' — an identical prompt cannot have reordered the pool; ` +
				`the soundness invariant is violated and this hit is refused rather than replayed.`,
		};
	}
	return {
		selectResult: {
			abstain: false,
			pick: poolEntry.candidate,
			category: storedJudgment.category,
			rationale: storedJudgment.rationale,
		},
	};
};

// judgmentPayloadFrom — a live selectResult + its pool -> the decided-time truth the cache stores.
// The ordinal is recovered by object identity against the pool (the same identity evidenceSelect's
// own pick mapping used), so what is persisted is exactly what was decided.
const judgmentPayloadFrom = (selectResult, pool) => {
	if (selectResult.abstain) {
		return {
			payload: {
				choice: 'NONE',
				chosenStableId: null,
				category: selectResult.category,
				rationale: selectResult.rationale,
			},
		};
	}
	const pickIndex = pool.findIndex((oneEntry) => oneEntry.candidate === selectResult.pick);
	if (pickIndex === -1) {
		return {
			error:
				`${moduleName}: the live selectResult's pick is not an object in the pool it was judged ` +
				`from — the decided judgment cannot be addressed and is refused rather than mis-persisted.`,
		};
	}
	return {
		payload: {
			choice: `${pickIndex + 1}`,
			chosenStableId: selectResult.pick.stableId,
			category: selectResult.category,
			rationale: selectResult.rationale,
		},
	};
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ judgmentCache = null, matchForensics = null, pairKey, generation, rendererVersion, evidenceSelect, llmClient } = {}) => {
		// judgeOne — the produced seam callable. All wiring refusals travel by callback (this factory
		// is composed mid-run inside a bridge's REBRIDGE flow, where the callback IS the channel).
		const judgeOne = ({ promptText, pool, sourceStableId, sourceName } = {}, callback) => {
			if (typeof evidenceSelect !== 'function') {
				callback(`${moduleName}: evidenceSelect is not a function — there is no default judge.`);
				return;
			}
			if (!llmClient || typeof llmClient.rerank !== 'function') {
				callback(`${moduleName}: llmClient (rerank) is missing — there is no default.`);
				return;
			}
			if (typeof promptText !== 'string' || promptText === '') {
				callback(`${moduleName}: promptText is required and must be a non-empty string.`);
				return;
			}
			if (!Array.isArray(pool)) {
				callback(`${moduleName}: pool is required and must be an array.`);
				return;
			}
			const cacheActive = !!judgmentCache;
			const forensicsActive = !!matchForensics;
			const model = typeof llmClient.model === 'string' && llmClient.model.trim() ? llmClient.model : null;
			if (cacheActive && !model) {
				callback(
					`${moduleName}: the judgment cache is active but llmClient.model is not a non-empty ` +
						`string — the cache key is (promptHash, model, rendererVersion) and a judgment with no ` +
						`declared model identity cannot be soundly cached. There is no default model name.`,
				);
				return;
			}
			if ((cacheActive || forensicsActive) && (typeof rendererVersion !== 'string' || !rendererVersion.trim())) {
				callback(
					`${moduleName}: rendererVersion is required (non-empty string) when the judgment cache ` +
						`or forensic log is active — it is part of the cache key and of every forensic record. ` +
						`There is no default.`,
				);
				return;
			}
			if (forensicsActive && (typeof pairKey !== 'string' || !pairKey.trim() || typeof generation !== 'string' || !generation.trim())) {
				callback(
					`${moduleName}: pairKey and generation are required (non-empty strings) when the ` +
						`forensic log is active — they name the trail file. There is no default.`,
				);
				return;
			}

			const promptHash = cacheActive || forensicsActive ? contentAddress.blockIdForText(promptText) : null;
			const startedAtMs = Date.now();

			// writeForensics — LOUD BUT NONFATAL (forensics are evidence, not a gate): an append
			// failure goes to xLog.error and into judgeMeta.forensicsError, and the run continues.
			const writeForensics = (record, forensicsDone) => {
				if (!forensicsActive) {
					forensicsDone('');
					return;
				}
				matchForensics.appendRecord({ pairKey, generation, record }, (appendErr) => {
					if (appendErr) {
						const { xLog } = process.global;
						xLog.error(
							`[${moduleName}] FORENSIC LOG WRITE FAILED (run continues; the judgment itself ` +
								`is safe in the judgment cache): ${appendErr}`,
						);
						forensicsDone(appendErr);
						return;
					}
					forensicsDone('');
				});
			};

			const candidatePoolStableIds = () =>
				pool.map((oneEntry) => (oneEntry && oneEntry.candidate ? oneEntry.candidate.stableId : null));

			// deliver — the ONE exit: selectResult + judgeMeta, byte-identical either path.
			const deliver = ({ selectResult, servedFromCache, judgmentPayload, forensicsError }) => {
				callback('', {
					selectResult,
					judgeMeta: {
						servedFromCache,
						promptHash,
						judgmentPayload,
						model,
						forensicsError: forensicsError || '',
					},
				});
			};

			// judgeLive — the byte-identical original judge path, decorated ONLY to capture the
			// usage envelope, then persisted (cache first — FATAL on failure — then forensics).
			const judgeLive = () => {
				let capturedRerank = null;
				const decoratedLlmClient = {
					...llmClient,
					rerank: (spec, rerankCallback) =>
						llmClient.rerank(spec, (rerankErr, rerankResult) => {
							if (!rerankErr) {
								capturedRerank = rerankResult;
							}
							rerankCallback(rerankErr, rerankResult);
						}),
				};
				evidenceSelect({ promptText, pool }, decoratedLlmClient, (selectErr, selectResult) => {
					if (selectErr) {
						callback(selectErr);
						return;
					}
					const derived = judgmentPayloadFrom(selectResult, pool);
					if (derived.error) {
						callback(derived.error);
						return;
					}
					const finishLive = () => {
						const liveRecord = {
							timestamp: new Date().toISOString(),
							sourceStableId: sourceStableId || null,
							sourceName: sourceName || null,
							promptHash,
							promptText,
							model,
							rendererVersion: rendererVersion || null,
							generation: generation || null,
							judgedVia: 'live',
							response: {
								choice: derived.payload.choice,
								category: derived.payload.category,
								rationale: derived.payload.rationale,
								stopReason: capturedRerank && capturedRerank.stopReason !== undefined ? capturedRerank.stopReason : null,
							},
							usage: capturedRerank && capturedRerank.usage ? capturedRerank.usage : null,
							retries: {
								count: capturedRerank && Number.isInteger(capturedRerank.attempts) ? capturedRerank.attempts - 1 : 0,
								reasons: capturedRerank && Array.isArray(capturedRerank.retryReasons) ? capturedRerank.retryReasons : [],
							},
							latencyMs: Date.now() - startedAtMs,
							candidatePool: candidatePoolStableIds(),
						};
						writeForensics(liveRecord, (forensicsError) =>
							deliver({ selectResult, servedFromCache: false, judgmentPayload: derived.payload, forensicsError }),
						);
					};
					if (!cacheActive) {
						finishLive();
						return;
					}
					// DECIDED = PERSISTED: the row lands on disk BEFORE the judgment flows downstream,
					// synchronously in this callback chain — and a persist failure is FATAL, because
					// proceeding past it recreates the losable-judgment state the ruling forbids.
					judgmentCache.putJudgment(
						{ promptHash, model, rendererVersion, generation: generation || null, judgment: derived.payload },
						(putErr) => {
							if (putErr) {
								callback(
									`${moduleName}: PERSISTING the decided judgment for ` +
										`${sourceStableId || '(unnamed source)'} FAILED — refusing to use a judgment ` +
										`that is not on disk (decided = persisted): ${putErr}`,
								);
								return;
							}
							finishLive();
						},
					);
				});
			};

			if (!cacheActive) {
				judgeLive();
				return;
			}

			judgmentCache.getJudgment({ promptHash, model, rendererVersion }, (getErr, getResult) => {
				if (getErr) {
					callback(`${moduleName}: consulting the judgment cache: ${getErr}`);
					return;
				}
				if (!getResult.judgment) {
					judgeLive(); // a miss is an answer — judge live, persist, proceed
					return;
				}
				const reconstructed = reconstructSelectResult(getResult.judgment, pool);
				if (reconstructed.error) {
					callback(reconstructed.error);
					return;
				}
				const hitRecord = {
					timestamp: new Date().toISOString(),
					sourceStableId: sourceStableId || null,
					sourceName: sourceName || null,
					promptHash,
					promptText,
					model,
					rendererVersion: rendererVersion || null,
					generation: generation || null,
					judgedVia: `cache:${promptHash}`,
					response: {
						choice: getResult.judgment.choice,
						category: getResult.judgment.category,
						rationale: getResult.judgment.rationale,
						stopReason: null,
					},
					usage: null, // a cache hit spends nothing — usage null, never a fabricated number
					retries: null,
					latencyMs: Date.now() - startedAtMs,
					candidatePool: candidatePoolStableIds(),
				};
				writeForensics(hitRecord, (forensicsError) =>
					deliver({
						selectResult: reconstructed.selectResult,
						servedFromCache: true,
						judgmentPayload: getResult.judgment,
						forensicsError,
					}),
				);
			});
		};

		return judgeOne;
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.reconstructSelectResult = reconstructSelectResult;
module.exports.judgmentPayloadFrom = judgmentPayloadFrom;
