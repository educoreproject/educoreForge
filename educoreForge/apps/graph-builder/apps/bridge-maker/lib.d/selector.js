'use strict';

// selector.js — lib.d EXTRACT (bridgeKitRefactor_072726 design §4.1). A faithful COPY of
// inferencePipeline.scoreSource's FLOOR-GATE + RERANK tail (Opus abstain-first;
// bridge-maker/lib/inferencePipeline.js) — given a source and its ALREADY-RETRIEVED candidate pool
// (semanticMatcher.retrieve's output), applies the deterministic cosine-floor pre-abstain (a
// hopeless source never reaches the LLM), then asks the reranker to pick ONE candidate or NONE (the
// abstain — the correctness differentiator). inferencePipeline.js is left UNTOUCHED (P2 coexist);
// P1's equivalence gate (test-kit-equivalence.js) proves this split reproduces scoreSource's
// decisions byte-identically over the same inputs + the same stub llmClient.
//
//   selector({ llmClient, cosineFloor = 0 }) -> {
//       selectFromPool(source, pool, sourceClassIndex, candidateClassIndex, callback('', decision))
//   }
//
// The reranker returns a DISCRETE choice (no calibrated probability), so the numeric confidence
// frozen on a pick is the chosen candidate's retrieval COSINE (honest: not a fabricated probability)
// — exactly as inferencePipeline documents.
//
// callback(errString, result) — err is '' on success. No async/await, no try/catch for control
// flow. camelCase only.

const SYSTEM_PROMPT =
	'You match an education-data element from one data standard to the single best-matching CEDS element. ' +
	'You are given a SOURCE element (its domain class, the element name, its definition, and its datatype) ' +
	'and a numbered list of CANDIDATE CEDS elements (each with its domain class, name, and definition). ' +
	'Choose the ONE candidate that means the SAME THING as the source element, judged by the DEFINITIONS, ' +
	'not surface wording. If NONE of the candidates is a correct match for the source element, choose NONE. ' +
	'Prefer NONE over a weak or merely-related match.';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ llmClient, cosineFloor = 0 } = {}) => {
		// a selector with no reranker cannot select — a wiring fault, named, never a silent no-op
		// (polyArch2 §6; the same line semanticBridge's runRebridge guard already draws for --rebridge).
		if (!llmClient || typeof llmClient.rerank !== 'function') {
			throw new Error(
				`${moduleName}: constructed without an llmClient (rerank). selector reranks the ` +
					`retrieved pool with an LLM; there is no default reranker.`,
			);
		}

		const rangeLabelFor = (record, classIndex) => {
			if (record.rangeDatatype) {
				return record.rangeDatatype;
			}
			if (record.rangeClassId) {
				const cls = classIndex[record.rangeClassId];
				return cls && cls.name ? `reference: ${cls.name}` : `reference: ${record.rangeClassId}`;
			}
			return null;
		};

		const renderCandidate = (oneCandidate, ordinal, candidateClassIndex) => {
			const cls = oneCandidate.domainId && candidateClassIndex[oneCandidate.domainId];
			const domainName = cls ? cls.name : '';
			const def = oneCandidate.defText || oneCandidate.name || '';
			const rangeLabel = rangeLabelFor(oneCandidate, candidateClassIndex);
			const dt = rangeLabel ? ` [${rangeLabel}]` : '';
			return `${ordinal}) ${domainName ? domainName + ' · ' : ''}${oneCandidate.name} — ${def}${dt}`;
		};

		const renderUserPrompt = (source, pool, sourceClassIndex, candidateClassIndex) => {
			const srcCls = source.domainId && sourceClassIndex[source.domainId];
			const srcDomain = srcCls
				? `${srcCls.name}${srcCls.description ? ' (' + srcCls.description + ')' : ''}`
				: '(none)';
			const srcDt = rangeLabelFor(source, sourceClassIndex) || '(unspecified)';
			const candidateLines = pool
				.map((entry, idx) => renderCandidate(entry.candidate, idx + 1, candidateClassIndex))
				.join('\n');
			return (
				`SOURCE ELEMENT\n` +
				`Domain class: ${srcDomain}\n` +
				`Element: ${source.name} — ${source.defText || source.name}\n` +
				`Datatype: ${srcDt}\n\n` +
				`CANDIDATES\n${candidateLines}\n\n` +
				`Reply with the number of the single best-matching candidate, or NONE.`
			);
		};

		// selectFromPool — floor-gate -> rerank, over an ALREADY-RETRIEVED pool (semanticMatcher's
		// output). callback(err, decision). Byte-for-byte inferencePipeline.scoreSource's tail (only
		// the internal `retrieve(...)` call is gone — the pool arrives already retrieved).
		const selectFromPool = (source, pool, sourceClassIndex, candidateClassIndex, callback) => {
			const poolSummary = pool.map((entry) => ({
				stableId: entry.candidate.stableId,
				cedsId: entry.candidate.cedsId,
				cosine: Math.round(entry.cosine * 1e6) / 1e6,
			}));
			const bestCosine = pool.length ? pool[0].cosine : -1;

			// deterministic cosine-floor pre-abstain: a hopeless source never reaches the LLM.
			if (bestCosine < cosineFloor) {
				callback('', {
					source,
					pool: poolSummary,
					abstain: true,
					abstainReason: 'cosineFloor',
					bestCosine: Math.round(bestCosine * 1e6) / 1e6,
					targetKey: null,
				});
				return;
			}

			const choiceEnum = pool.map((entry, idx) => `${idx + 1}`).concat(['NONE']);
			const userPrompt = renderUserPrompt(source, pool, sourceClassIndex, candidateClassIndex);
			llmClient.rerank({ systemPrompt: SYSTEM_PROMPT, userPrompt, choiceEnum }, (err, result) => {
				if (err) {
					callback(err);
					return;
				}
				if (result.choice === 'NONE') {
					callback('', {
						source,
						pool: poolSummary,
						abstain: true,
						abstainReason: 'llmNone',
						bestCosine: Math.round(bestCosine * 1e6) / 1e6,
						targetKey: null,
					});
					return;
				}
				const ordinal = parseInt(result.choice, 10);
				const chosen = pool[ordinal - 1];
				callback('', {
					source,
					pool: poolSummary,
					abstain: false,
					abstainReason: null,
					targetKey: chosen.candidate.cedsId,
					chosenStableId: chosen.candidate.stableId,
					chosenOrdinal: ordinal,
					retrievalRank: ordinal,
					cosineScore: Math.round(chosen.cosine * 1e6) / 1e6,
					bestCosine: Math.round(bestCosine * 1e6) / 1e6,
				});
			});
		};

		return { selectFromPool };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
