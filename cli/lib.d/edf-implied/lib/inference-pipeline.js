'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// inference-pipeline.js — the INFERENCE half of the Phase-5 inferred track (the ONE non-deterministic
// step, run ONCE at production time, its output FROZEN downstream). For each source element it: retrieves
// the top-K=15 same-role CEDS candidates by DEFINITION-embedding cosine (deterministic); applies a
// deterministic COSINE-FLOOR pre-abstain (a hopeless source never reaches the LLM — cheaper, and a real
// abstain path); renders the measured fmt_tuple prompt; asks the Opus reranker to pick ONE candidate or
// NONE (the abstain — the correctness differentiator); and emits ONE decision per source. Picks land a
// closeMatch (downstream); NONE / below-floor abstains land NO edge (the abstain-boundary invariant).
//
// The reranker returns a DISCRETE choice (no calibrated probability), so the numeric confidence frozen on
// a pick is the chosen candidate's retrieval COSINE — the reranker contributes the SELECTION among
// retrieved candidates, the cosine is the legible numeric signal (honest: not a fabricated probability).
//
// scoreSource(...) is the shared retrieve+rerank unit used by BOTH the producer-accuracy measure (gold
// harness) and the emit driver. processSources runs it over many sources with bounded concurrency.
// Async via qtools-asynchronous-pipe-plus + a small bounded-concurrency runner; no async/await, no
// try/catch for control flow. camelCase only.
//
// @concept: [[InferencePipeline]]
// @concept: [[Abstain]]

const moduleName2 = moduleName;

// cosine of two Float32Arrays (1024). Both assumed same length; null-safe -> -1 (never retrieved).
const cosine = (a, b) => {
	if (!a || !b) {
		return -1;
	}
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	if (na === 0 || nb === 0) {
		return -1;
	}
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

const SYSTEM_PROMPT =
	'You match an education-data element from one data standard to the single best-matching CEDS element. ' +
	'You are given a SOURCE element (its domain class, the element name, its definition, and its datatype) ' +
	'and a numbered list of CANDIDATE CEDS elements (each with its domain class, name, and definition). ' +
	'Choose the ONE candidate that means the SAME THING as the source element, judged by the DEFINITIONS, ' +
	'not surface wording. If NONE of the candidates is a correct match for the source element, choose NONE. ' +
	'Prefer NONE over a weak or merely-related match.';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ llmClient, topK = 15, cosineFloor = 0, concurrency = 8 } = {}) => {
		const { xLog } = process.global;

		// render one candidate line: "n) Domain · Name — definition (datatype)".
		// rangeLabelFor — a record's range, rendered for the prompt: a scalar rangeDatatype, ELSE (for a
		// CEDS object/association property) 'reference: <ClassName>' resolved from rangeClassId via the
		// SAME classIndex used for domain rendering (a class's own domainId/cedsId IS its rangeClassId
		// value, so the lookup is direct), ELSE null (unspecified — omitted from the prompt).
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
			const srcDomain = srcCls ? `${srcCls.name}${srcCls.description ? ' (' + srcCls.description + ')' : ''}` : '(none)';
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

		// retrieve top-K same-role candidates for a source by cosine (candidatePool already role-matched).
		const retrieve = (source, candidatePool) => {
			const scored = candidatePool.map((oneCandidate) => ({
				candidate: oneCandidate,
				cosine: cosine(source.vector, oneCandidate.vector),
			}));
			scored.sort((a, b) => b.cosine - a.cosine);
			return scored.slice(0, topK);
		};

		// scoreSource — retrieve -> floor-gate -> rerank. callback(err, decision).
		//   decision: { source, pool (ids+cosine), abstain, abstainReason, targetKey, chosenOrdinal,
		//               cosineScore, bestCosine, retrievalRank }
		const scoreSource = (source, candidatePool, sourceClassIndex, candidateClassIndex, callback) => {
			const pool = retrieve(source, candidatePool);
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

		// processSources — run scoreSource over many sources with bounded concurrency.
		//   sources: each { ...record, vector }. candidatePoolByRole: { role -> [candidate{vector}] }.
		//   candidatePoolForSource (OPTIONAL): (source) -> [candidate{vector}] — a PER-SOURCE scoped pool,
		//     used INSTEAD of candidatePoolByRole[source.role] when supplied. Additive (CODESET-VALUE
		//     scoping, PLAN §5): value-tier inference scopes each source to its OWN matched-parent-property's
		//     option set, which candidatePoolByRole's static role->pool map cannot express (every source of
		//     the same role would otherwise share one global pool). candidatePoolByRole stays REQUIRED for
		//     backward compatibility (role-based lookups elsewhere are untouched).
		//   onDecision(decision) called per source (in completion order). callback(err, { decisions }).
		const processSources = (
			{ sources, candidatePoolByRole, candidatePoolForSource, sourceClassIndex, candidateClassIndex, onDecision },
			callback,
		) => {
			const decisions = [];
			let cursor = 0;
			let active = 0;
			let failed = null;
			let done = 0;
			const total = sources.length;

			const pump = () => {
				if (failed) {
					return;
				}
				if (done === total) {
					callback('', { decisions });
					return;
				}
				while (active < concurrency && cursor < total && !failed) {
					const source = sources[cursor++];
					active++;
					const pool = (typeof candidatePoolForSource === 'function' ? candidatePoolForSource(source) : null) || candidatePoolByRole[source.role] || [];
					scoreSource(source, pool, sourceClassIndex, candidateClassIndex, (err, decision) => {
						active--;
						done++;
						if (err) {
							if (!failed) {
								failed = err;
								callback(`inference-pipeline: ${err}`);
							}
							return;
						}
						decisions.push(decision);
						if (typeof onDecision === 'function') {
							onDecision(decision);
						}
						if (done % 100 === 0) {
							xLog.status(`[inference-pipeline] ${done}/${total} sources scored`);
						}
						pump();
					});
				}
			};
			if (total === 0) {
				callback('', { decisions });
				return;
			}
			pump();
		};

		return { scoreSource, processSources, retrieve, cosine };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName: moduleName2 });
