'use strict';

// retrieval-metrics.js — THE INSTRUMENT. Measures how well candidate selection is actually
// working, from the forensic match log this tree already writes (⟪P11, 2026-07-31⟫).
//
// WHY IT EXISTS. This project has been issuing quality verdicts with no instrument, and it cost
// real money. The specific failure it was born from: a rescue count of 155 was reported when the
// true count was 20, because "the winner carried a nomination" and "the winner was ONLY in the
// pool BECAUSE of a nomination" were conflated into one number. Those are different facts and this
// module reports them as two named, separately-labelled fields — see §RESCUE ATTRIBUTION. A
// measurement that can be mistaken for a stronger claim than it makes is the defect this module
// exists to end.
//
// WHERE IT LIVES, AND WHY HERE. It sits beside lib/match-forensics — the module that WRITES the
// records it READS. The two share ONE record contract and must change together; a reader parked in
// apps/graph-builder/lib/ (which holds only CLI plumbing: actions, build, help, recipe, startup)
// would drift from the writer silently. Living in tree-root lib/ also earns it independent test
// discovery: runAllTests treats every lib directory holding .js files as a module, so deleting its
// suite flips it to NONE rather than letting it vanish from an all-green report.
//
// WHAT IT READS. <baseDirPath>/<pairKey>/<generation>.jsonl, one JSON record per judgment, as
// written by lib/match-forensics. The fields consumed: promptText (the FULL rendered prompt),
// response { choice, category, rationale }, sourceStableId, sourceName, judgedVia, candidatePool.
//
// WHAT IT COMPUTES, per pair+generation (all six of the P11 measures):
//   1. WINNER RANK DISTRIBUTION — where the CHOSEN candidate sat when the pool is re-sorted by
//      retrieval cosine, descending. Buckets: 1 / 2-3 / 4-10 / 11-15 / 16+.
//   2. COSINE TOP-1 ACCURACY — how often cosine's own best candidate was the final choice.
//   3. RECALL — how often the choice sat within the cosine cutoff, i.e. would have been retrieved
//      by cosine alone.
//   4. RESCUE ATTRIBUTION — genuine rescues (nominated AND below the cutoff) reported SEPARATELY
//      from the weaker "winner merely carried a nomination".
//   5. ABSTENTION ANALYSIS — the forensics lint. NONE responses bucketed by declared diagnostic
//      phrase probes; any probe over the flag threshold is a FLAGGED SIGNAL.
//   6. POOL COMPOSITION — pool-size distribution and how many candidates carried nominations.
//
// THE PROMPT IS THE MEASUREMENT SURFACE. The pool as DISPLAYED is not in cosine order — the
// composer lists the cosine top-K first and then APPENDS nominated candidates, whose cosines are
// lower and unsorted. So display position is NOT rank. Every rank here is computed by re-sorting
// the parsed pool by retrievalCosine descending (ties broken by display position, so the ranking
// is deterministic). Reading display position as rank would silently overstate recall.
//
// No sqlite, no process.global, no construction-time side effects — safe to require anywhere.
// Async style: callback(errString, result). Every public callable takes a callback whether it
// needs one or not (R7, ⟪TQ RULING 2026-07-29⟫: "It's easy to use not-needed when the callback is
// present. Very difficult to change when it's not."). camelCase only; no async/await; no try/catch
// for control flow.

const path = require('path');
const fs = require('fs');

const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

// =====================================================================
// DECLARED CONSTANTS — the measurement's own contract, exported for the tests and the report
// =====================================================================

// METRICS_VERSION stamps every report and sidecar. A change to parsing, bucketing, or the probe
// catalog changes what the numbers MEAN, and a stored sidecar must say which instrument produced
// it — the same self-describing discipline the frozen decision blocks carry (⟪A6⟫).
const METRICS_VERSION = 'retrievalMetrics-v1';

// The cosine rank at or above which a candidate would have been retrieved by cosine ALONE. It is
// the composer's own top-K, restated here as an analysis parameter because the log does not record
// it. 15 is the documented default; it is what the CASE and generic pools were built with.
const DEFAULT_COSINE_CUTOFF = 15;

// A probe firing on more than this share of abstentions is a FLAGGED SIGNAL — a spike loud enough
// to suspect a systemic prompt defect rather than scattered honest abstentions.
const DEFAULT_ABSTENTION_FLAG_THRESHOLD = 0.05;

// RANK_BUCKETS — the winner-rank histogram, as DATA rather than a chain of else-ifs. Fixed by the
// P11 measurement contract, deliberately NOT derived from cosineCutoff: these buckets are how this
// project's numbers have been stated and compared, and a histogram whose bin edges move with a
// parameter cannot be compared across runs. At the default cutoff of 15 the last edge coincides
// with it, which is why 'rank16plus' and "outside the cutoff" agree by default.
const RANK_BUCKETS = [
	{ key: 'rank1', label: 'rank 1', lowRank: 1, highRank: 1 },
	{ key: 'rank2to3', label: 'rank 2-3', lowRank: 2, highRank: 3 },
	{ key: 'rank4to10', label: 'rank 4-10', lowRank: 4, highRank: 10 },
	{ key: 'rank11to15', label: 'rank 11-15', lowRank: 11, highRank: 15 },
	{ key: 'rank16plus', label: 'rank 16+', lowRank: 16, highRank: Infinity },
];

// ABSTENTION_PROBES — THE FORENSICS LINT CATALOG.
//
// DECLARED probes, not discovered n-grams. A raw n-gram pass over these rationales returns the
// judge's writing habits ("the case source is", 55% of abstentions) far more loudly than it
// returns any defect; a catalog states, in advance and by name, WHICH recurring phrasing would
// mean something is wrong, so a spike is interpretable instead of merely large. Discovery is still
// run alongside it (recurringPhrases below) but is INFORMATIONAL ONLY and never flagged — it is
// raw material for writing the NEXT probe, not a verdict.
//
// Each probe names the defect it is evidence FOR. Add probes freely; never delete one silently,
// because a probe that stops being reported is a defect that stops being watched.
const ABSTENTION_PROBES = [
	{
		key: 'sourceNotVisible',
		label: 'the judge could not see the source element',
		defect:
			'PROMPT DEFECT: the judge says the source itself was absent or undescribed. The judge ' +
			'cannot match FROM something it was never shown; a spike here indicts the renderer, not ' +
			'the retrieval.',
		pattern:
			/\b(no source (text|description|definition)|source (is|was) not (described|provided|shown|given)|source (definition|description) is (empty|absent|blank|missing)|without (a|any) source (description|definition)|no (description|definition) (of|for) the source)/i,
	},
	{
		key: 'noDescriptionAtAll',
		label: 'the element carries no description',
		defect:
			'FORGE/SOURCE THINNESS: the judge reports an undescribed element. Expected for standards ' +
			'whose prose is genuinely terse (CASE); a spike elsewhere suggests a forge dropped defText.',
		pattern:
			/\b(has no description|no description (is )?(provided|available|given)|lacks a description|undescribed)/i,
	},
	{
		key: 'insufficientEvidence',
		label: 'not enough evidence to decide',
		defect:
			'EVIDENCE STARVATION: the judge had candidates but could not tell. Points at the evidence ' +
			'composition (tuple facts, notes, segments), not at the pool.',
		pattern:
			/\b(insufficient|not enough (information|evidence)|cannot (be )?determine|too little (information|evidence)|no basis)/i,
	},
	{
		key: 'noCandidateSupported',
		label: 'no candidate in the pool was supported',
		defect:
			'RETRIEVAL MISS: the pool itself held nothing right. This is the honest-abstention shape ' +
			'and is expected at some rate; a spike means recall is failing upstream of the judge.',
		pattern:
			/\b(none of the candidates|no candidate is genuinely supported|no candidate (genuinely )?(matches|corresponds))/i,
	},
	{
		key: 'surfaceTokenOnly',
		label: 'candidates shared only surface tokens',
		defect:
			'NOMINATION NOISE: the judge is being handed candidates whose only claim is a shared word. ' +
			'A spike means the nominate hook is padding the pool with token coincidences.',
		pattern:
			/\b((only|merely|purely) (the |a |an )?(surface|generic|incidental|bare|shared) token|token overlap alone|shares? only|by cosine alone)/i,
	},
	{
		key: 'genericSourceProperty',
		label: 'the source element is a generic or structural slot',
		defect:
			'UNJUDGEABLE SOURCE: extension slots, free-text notes, sequence numbers and structural ' +
			'containers have no semantic counterpart to find. A spike means the walk is spending ' +
			'judgment credit on elements that can never match.',
		pattern:
			/\b(generic (property|container|slot|extension|ordering)|free[- ]text|structural (container|reference|extension)|extension slot)/i,
	},
	{
		key: 'scopeMismatch',
		label: 'candidates were option-set values out of scope',
		defect:
			'POOL COMPOSITION: enumerated option-set values are crowding a pool that wanted properties ' +
			'(or the reverse). Points at what the retrieval is allowed to offer.',
		pattern: /\b(option set|enumerated value|different owning property|value token)/i,
	},
];

// The candidate-block header, as the renderer writes it:
//     `1) Competency Association Identifier URI — retrieval cosine 0.591891`
// Anchored at line start with NO leading whitespace, because every body line of a block IS
// indented — that indent is the only thing separating a block header from prose that resembles
// one, and relying on it is why this parser does not need to understand the body at all.
//
// THE COSINE SLOT MATCHES ANY NON-SPACE TOKEN, and is validated SEPARATELY (COSINE_VALUE_PATTERN).
// That split is deliberate. If the pattern itself demanded a number, a header-shaped line carrying
// a malformed cosine would simply fail to match — and a candidate block would VANISH from the
// pool, silently shrinking it and shifting every rank below it. Recognizing the line and then
// refusing its value BY NAME turns a silent corruption into a sentence.
const CANDIDATE_HEADER_PATTERN = /^(\d+)\)[ \t]+(.*?)[ \t]+—[ \t]+retrieval cosine[ \t]+(\S+)[ \t]*$/;

// A cosine is a plain decimal, optionally signed, optionally exponent-bearing — and nothing else.
// parseFloat alone would happily read '0.5abc' as 0.5, which is the sort of quiet acceptance that
// makes a wrong number look like a right one.
const COSINE_VALUE_PATTERN = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

// The nomination line, indented, immediately under its header:
//     `   Nominated by caseEvidenceBridge: nominated: owning class 'CFAssociation' ...`
const NOMINATION_PATTERN = /^[ \t]+Nominated by[ \t]+([^:]+):[ \t]*(.*)$/;

// Recognized body markers — parsed only so the report can say what the blocks CONTAINED. Nothing
// downstream branches on them; they are descriptive, not load-bearing.
const BODY_MARKER_PATTERNS = [
	{ key: 'cedsReference', pattern: /^[ \t]+CEDS (Value )?Reference:/ },
	{ key: 'domains', pattern: /^[ \t]+Domain\(s\):/ },
	{ key: 'range', pattern: /^[ \t]+Range:/ },
	{ key: 'scope', pattern: /^[ \t]+Scope:/ },
	{ key: 'notes', pattern: /^[ \t]+Notes:/ },
];

// Discovery-pass tuning. Phrases are counted once per abstention (a rationale that repeats a
// phrase is one occurrence, not several), over word n-grams of these lengths.
const PHRASE_MIN_WORDS = 3;
const PHRASE_MAX_WORDS = 6;
const PHRASE_REPORT_LIMIT = 15;

// =====================================================================
// SMALL SHARED HELPERS — synchronous, private, no callbacks (R7 governs the PUBLIC surface)
// =====================================================================

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isNonBlankString = (value) => typeof value === 'string' && value.trim() !== '';

// percentOf — one rounding rule for the whole report, so a number never disagrees with itself
// between the text report and the JSON sidecar. One decimal place; a zero denominator is null
// (there is no percentage of nothing), never 0 — 0% and "no data" are different facts.
const percentOf = (part, whole) =>
	whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

// bucketKeyForRank — the histogram lookup, driven by the RANK_BUCKETS table.
const bucketKeyForRank = (rank) => {
	const found = RANK_BUCKETS.find((oneBucket) => rank >= oneBucket.lowRank && rank <= oneBucket.highRank);
	return found ? found.key : '';
};

// choiceKind — what a judgment's `choice` field actually says. THREE outcomes, never two: a pick,
// a deliberate abstention, and an UNRECOGNIZED value. The third is reported rather than folded
// into either of the others, because a choice this module cannot read is a fault in the log or in
// this parser, and quietly counting it as an abstention would hide both.
const choiceKind = (choice) => {
	if (choice === null || choice === undefined) {
		return 'unrecognized';
	}
	const text = String(choice).trim();
	if (text.toUpperCase() === 'NONE') {
		return 'abstention';
	}
	if (/^\d+$/.test(text)) {
		return 'pick';
	}
	return 'unrecognized';
};

// =====================================================================
// START OF moduleFunction() ============================================
// =====================================================================

const retrievalMetrics = () => {
	// -----------------------------------------------------------------
	// parseCandidateBlocks — THE PARSER. promptText -> the pool, in DISPLAY order.
	// -----------------------------------------------------------------
	// Pure and synchronous inside; callback-shaped outside (R7). Returns each candidate as
	//   { displayPosition, name, retrievalCosine, nominatedBy, nominationRationale, bodyMarkers }
	// A block whose cosine does not parse as a finite number is refused BY NAME rather than
	// admitted with a NaN that would poison every rank downstream.
	const parseCandidateBlocks = ({ promptText } = {}, callback) => {
		if (typeof callback !== 'function') {
			throw new Error('retrievalMetrics.parseCandidateBlocks: a callback is REQUIRED (R7)');
		}
		if (typeof promptText !== 'string') {
			callback(
				`retrievalMetrics.parseCandidateBlocks: promptText is REQUIRED and must be a string, got ` +
					`${promptText === null ? 'null' : typeof promptText}. There is no default — a judgment ` +
					`with no prompt cannot be measured, only guessed at.`,
			);
			return;
		}

		const candidates = [];
		let current = null;
		let malformedCosine = '';

		promptText.split('\n').forEach((oneLine) => {
			const headerMatch = oneLine.match(CANDIDATE_HEADER_PATTERN);
			if (headerMatch) {
				const cosineText = headerMatch[3];
				const retrievalCosine = COSINE_VALUE_PATTERN.test(cosineText)
					? parseFloat(cosineText)
					: NaN;
				if (!isFinite(retrievalCosine)) {
					malformedCosine = malformedCosine || oneLine;
					return;
				}
				current = {
					displayPosition: parseInt(headerMatch[1], 10),
					name: headerMatch[2],
					retrievalCosine,
					nominatedBy: '',
					nominationRationale: '',
					bodyMarkers: [],
				};
				candidates.push(current);
				return;
			}
			if (!current) {
				return; // preamble, instructions, the global segment — not part of any block
			}
			// FIRST nomination line wins. The renderer writes exactly one, directly under the
			// header; taking the first means prose deeper in the body that happens to echo the
			// phrasing cannot overwrite the real attribution.
			const nominationMatch = current.nominatedBy ? null : oneLine.match(NOMINATION_PATTERN);
			if (nominationMatch) {
				current.nominatedBy = nominationMatch[1].trim();
				current.nominationRationale = nominationMatch[2].trim();
				return;
			}
			BODY_MARKER_PATTERNS.forEach((oneMarker) => {
				if (oneMarker.pattern.test(oneLine) && current.bodyMarkers.indexOf(oneMarker.key) === -1) {
					current.bodyMarkers.push(oneMarker.key);
				}
			});
		});

		if (malformedCosine) {
			callback(
				`retrievalMetrics.parseCandidateBlocks: a candidate block header carried a cosine that is ` +
					`not a finite number — '${malformedCosine.trim()}'. Refused rather than admitted as NaN, ` +
					`which would silently corrupt every rank computed from this pool.`,
			);
			return;
		}

		callback('', { candidates });
	};

	// -----------------------------------------------------------------
	// rankCandidatesByCosine — DISPLAY ORDER IS NOT RANK. Re-sort the pool.
	// -----------------------------------------------------------------
	// The composer lists the cosine top-K first, then APPENDS nominated candidates whose cosines
	// are lower and in no particular order. Every rank in this module comes from here. Ties are
	// broken by displayPosition so the ordering is total and deterministic — two candidates with
	// an identical cosine must not rank differently between runs of the same data.
	const rankCandidatesByCosine = ({ candidates } = {}, callback) => {
		if (typeof callback !== 'function') {
			throw new Error('retrievalMetrics.rankCandidatesByCosine: a callback is REQUIRED (R7)');
		}
		if (!Array.isArray(candidates)) {
			callback(
				`retrievalMetrics.rankCandidatesByCosine: candidates is REQUIRED and must be an array, got ` +
					`${candidates === null ? 'null' : typeof candidates}.`,
			);
			return;
		}

		const rankedCandidates = candidates
			.slice()
			.sort(
				(one, other) =>
					other.retrievalCosine - one.retrievalCosine || one.displayPosition - other.displayPosition,
			)
			.map((oneCandidate, index) => Object.assign({}, oneCandidate, { cosineRank: index + 1 }));

		callback('', { rankedCandidates });
	};

	// -----------------------------------------------------------------
	// analyzeRecord — ONE judgment record -> the facts the metrics are summed from.
	// -----------------------------------------------------------------
	// Returns { analysis } with an `outcome` of 'pick' | 'abstention' | 'unrecognizedChoice' |
	// 'unresolvableChoice'. That last one is the honest name for "the judge named candidate 27 and
	// the prompt has 21 blocks": neither a pick this module can rank nor an abstention, so it is
	// counted under its own name and excluded from the rank denominators rather than guessed at.
	const analyzeRecord = ({ record, cosineCutoff = DEFAULT_COSINE_CUTOFF } = {}, callback) => {
		if (typeof callback !== 'function') {
			throw new Error('retrievalMetrics.analyzeRecord: a callback is REQUIRED (R7)');
		}
		if (!isPlainObject(record)) {
			callback(
				`retrievalMetrics.analyzeRecord: record is REQUIRED and must be a plain object, got ` +
					`${record === null ? 'null' : Array.isArray(record) ? 'an array' : typeof record}.`,
			);
			return;
		}
		if (typeof cosineCutoff !== 'number' || !isFinite(cosineCutoff) || cosineCutoff < 1) {
			callback(
				`retrievalMetrics.analyzeRecord: cosineCutoff must be a finite number >= 1, got ` +
					`${JSON.stringify(cosineCutoff)}. It names the cosine rank within which a candidate ` +
					`would have been retrieved by cosine alone; there is no sane default below 1.`,
			);
			return;
		}

		const response = isPlainObject(record.response) ? record.response : {};
		const outcomeKind = choiceKind(response.choice);

		const baseAnalysis = {
			sourceStableId: record.sourceStableId || '',
			sourceName: record.sourceName || '',
			judgedVia: record.judgedVia || '',
			category: response.category || '',
			rationale: typeof response.rationale === 'string' ? response.rationale : '',
		};

		if (outcomeKind === 'unrecognized') {
			callback(
				'',
				{
					analysis: Object.assign({}, baseAnalysis, {
						outcome: 'unrecognizedChoice',
						rawChoice: response.choice === undefined ? null : response.choice,
					}),
				},
			);
			return;
		}

		parseCandidateBlocks({ promptText: record.promptText }, (parseError, parsed) => {
			if (parseError) {
				callback(
					`retrievalMetrics.analyzeRecord: source '${baseAnalysis.sourceStableId || '(unnamed)'}': ` +
						`${parseError}`,
				);
				return;
			}

			const poolSize = parsed.candidates.length;
			const nominatedInPool = parsed.candidates.filter((oneCandidate) => oneCandidate.nominatedBy).length;
			const poolFacts = { poolSize, nominatedInPool };

			if (outcomeKind === 'abstention') {
				callback('', { analysis: Object.assign({}, baseAnalysis, poolFacts, { outcome: 'abstention' }) });
				return;
			}

			rankCandidatesByCosine({ candidates: parsed.candidates }, (rankError, ranked) => {
				if (rankError) {
					callback(`retrievalMetrics.analyzeRecord: ${rankError}`);
					return;
				}
				const chosenPosition = parseInt(String(response.choice).trim(), 10);
				const chosen = ranked.rankedCandidates.find(
					(oneCandidate) => oneCandidate.displayPosition === chosenPosition,
				);
				if (!chosen) {
					callback('', {
						analysis: Object.assign({}, baseAnalysis, poolFacts, {
							outcome: 'unresolvableChoice',
							rawChoice: response.choice,
						}),
					});
					return;
				}
				callback('', {
					analysis: Object.assign({}, baseAnalysis, poolFacts, {
						outcome: 'pick',
						chosenDisplayPosition: chosen.displayPosition,
						chosenName: chosen.name,
						chosenRetrievalCosine: chosen.retrievalCosine,
						winnerCosineRank: chosen.cosineRank,
						winnerRankBucket: bucketKeyForRank(chosen.cosineRank),
						winnerWasCosineTopOne: chosen.cosineRank === 1,
						winnerWithinCosineCutoff: chosen.cosineRank <= cosineCutoff,
						winnerCarriedNomination: !!chosen.nominatedBy,
						winnerNominatedBy: chosen.nominatedBy,
						// THE DISTINCTION THIS MODULE EXISTS FOR. A nomination on the winner is NOT a
						// rescue: cosine may well have retrieved it anyway. A GENUINE rescue is a winner
						// that carried a nomination AND sat outside the cosine cutoff, so the nomination
						// is the only reason it was in the pool at all.
						winnerWasGenuineRescue: !!chosen.nominatedBy && chosen.cosineRank > cosineCutoff,
					}),
				});
			});
		});
	};

	// -----------------------------------------------------------------
	// lintAbstentions — THE FORENSICS LINT.
	// -----------------------------------------------------------------
	// Declared probes (flagged over threshold) PLUS an informational recurring-phrase discovery
	// pass that is never flagged. Both are returned; only `flaggedSignals` is a verdict.
	const lintAbstentions = (
		{ rationales, flagThreshold = DEFAULT_ABSTENTION_FLAG_THRESHOLD } = {},
		callback,
	) => {
		if (typeof callback !== 'function') {
			throw new Error('retrievalMetrics.lintAbstentions: a callback is REQUIRED (R7)');
		}
		if (!Array.isArray(rationales)) {
			callback(
				`retrievalMetrics.lintAbstentions: rationales is REQUIRED and must be an array of strings, ` +
					`got ${rationales === null ? 'null' : typeof rationales}.`,
			);
			return;
		}
		if (typeof flagThreshold !== 'number' || !isFinite(flagThreshold) || flagThreshold < 0 || flagThreshold > 1) {
			callback(
				`retrievalMetrics.lintAbstentions: flagThreshold must be a number between 0 and 1 ` +
					`(a SHARE, not a percentage), got ${JSON.stringify(flagThreshold)}.`,
			);
			return;
		}

		const texts = rationales.map((one) => (typeof one === 'string' ? one : ''));
		const total = texts.length;

		const probeResults = ABSTENTION_PROBES.map((oneProbe) => {
			const count = texts.filter((oneText) => oneProbe.pattern.test(oneText)).length;
			const share = total > 0 ? count / total : 0;
			return {
				key: oneProbe.key,
				label: oneProbe.label,
				defect: oneProbe.defect,
				count,
				percent: percentOf(count, total),
				flagged: total > 0 && share > flagThreshold,
			};
		});

		// Discovery pass — INFORMATIONAL. Word n-grams counted once per abstention, then collapsed
		// to maximal phrases: a shorter phrase is dropped when a longer one containing it has the
		// SAME count, because the two are the same observation stated at different lengths.
		const phraseCounts = new Map();
		texts.forEach((oneText) => {
			const words = oneText
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, ' ')
				.trim()
				.split(' ')
				.filter((one) => one !== '');
			const seenInThisText = new Set();
			for (let size = PHRASE_MIN_WORDS; size <= PHRASE_MAX_WORDS; size += 1) {
				for (let start = 0; start + size <= words.length; start += 1) {
					const phrase = words.slice(start, start + size).join(' ');
					if (!seenInThisText.has(phrase)) {
						seenInThisText.add(phrase);
						phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
					}
				}
			}
		});
		const overThreshold = Array.from(phraseCounts.entries()).filter(
			([, count]) => total > 0 && count / total > flagThreshold,
		);
		const maximalPhrases = [];
		overThreshold
			.slice()
			.sort((one, other) => other[0].length - one[0].length)
			.forEach(([phrase, count]) => {
				const subsumed = maximalPhrases.some(
					(kept) => kept.count === count && kept.phrase.indexOf(phrase) !== -1,
				);
				if (!subsumed) {
					maximalPhrases.push({ phrase, count, percent: percentOf(count, total) });
				}
			});
		maximalPhrases.sort((one, other) => other.count - one.count || one.phrase.localeCompare(other.phrase));

		callback('', {
			abstentionLint: {
				abstentionCount: total,
				flagThresholdPercent: Math.round(flagThreshold * 1000) / 10,
				probes: probeResults,
				flaggedSignals: probeResults.filter((oneProbe) => oneProbe.flagged),
				// NEVER a verdict. Raw material for writing the next probe, nothing more.
				recurringPhrases: maximalPhrases.slice(0, PHRASE_REPORT_LIMIT),
				recurringPhrasesNote:
					'INFORMATIONAL ONLY — recurring phrasing discovered mechanically, not a flagged ' +
					'signal. Most of it is the judge\'s prose habit. Read it looking for a defect worth ' +
					'promoting into ABSTENTION_PROBES.',
			},
		});
	};

	// -----------------------------------------------------------------
	// computeMetrics — the whole measurement over an array of records.
	// -----------------------------------------------------------------
	const computeMetrics = (
		{
			records,
			cosineCutoff = DEFAULT_COSINE_CUTOFF,
			flagThreshold = DEFAULT_ABSTENTION_FLAG_THRESHOLD,
			pairKey = '',
			generation = '',
			forensicFilePath = '',
			malformedLineCount = 0,
		} = {},
		callback,
	) => {
		if (typeof callback !== 'function') {
			throw new Error('retrievalMetrics.computeMetrics: a callback is REQUIRED (R7)');
		}
		if (!Array.isArray(records)) {
			callback(
				`retrievalMetrics.computeMetrics: records is REQUIRED and must be an array, got ` +
					`${records === null ? 'null' : typeof records}. There is no default — measuring nothing ` +
					`and measuring an empty run are different facts and must be asked for differently.`,
			);
			return;
		}

		const analyses = [];
		let analysisError = '';
		records.forEach((oneRecord) => {
			if (analysisError) {
				return;
			}
			analyzeRecord({ record: oneRecord, cosineCutoff }, (recordError, result) => {
				if (recordError) {
					analysisError = recordError;
					return;
				}
				analyses.push(result.analysis);
			});
		});
		if (analysisError) {
			callback(analysisError);
			return;
		}

		const withOutcome = (outcome) => analyses.filter((one) => one.outcome === outcome);
		const picks = withOutcome('pick');
		const abstentions = withOutcome('abstention');
		const unresolvableChoices = withOutcome('unresolvableChoice');
		const unrecognizedChoices = withOutcome('unrecognizedChoice');

		// 1. WINNER RANK DISTRIBUTION
		const winnerRankDistribution = RANK_BUCKETS.reduce((soFar, oneBucket) => {
			const count = picks.filter((one) => one.winnerRankBucket === oneBucket.key).length;
			return Object.assign(soFar, {
				[oneBucket.key]: { label: oneBucket.label, count, percent: percentOf(count, picks.length) },
			});
		}, {});

		// 2. COSINE TOP-1 ACCURACY
		const topOneHits = picks.filter((one) => one.winnerWasCosineTopOne).length;

		// 3. RECALL WITHIN THE COSINE CUTOFF
		const recallHits = picks.filter((one) => one.winnerWithinCosineCutoff).length;

		// 4. RESCUE ATTRIBUTION — the two numbers, side by side, each labelled for what it IS.
		const genuineRescues = picks.filter((one) => one.winnerWasGenuineRescue).length;
		const winnerCarriedNomination = picks.filter((one) => one.winnerCarriedNomination).length;

		// 6. POOL COMPOSITION
		const poolBearing = analyses.filter((one) => typeof one.poolSize === 'number');
		const poolSizes = poolBearing.map((one) => one.poolSize).sort((one, other) => one - other);
		const sumOf = (list) => list.reduce((soFar, one) => soFar + one, 0);
		const poolSizeHistogram = poolSizes.reduce(
			(soFar, one) => Object.assign(soFar, { [one]: (soFar[one] || 0) + 1 }),
			{},
		);
		const nominatedPerPool = poolBearing.map((one) => one.nominatedInPool);

		const categoryCounts = analyses.reduce(
			(soFar, one) =>
				one.category ? Object.assign(soFar, { [one.category]: (soFar[one.category] || 0) + 1 }) : soFar,
			{},
		);
		const judgedViaCounts = analyses.reduce((soFar, one) => {
			const channel = String(one.judgedVia || '').split(':')[0] || '(none)';
			return Object.assign(soFar, { [channel]: (soFar[channel] || 0) + 1 });
		}, {});

		lintAbstentions(
			{ rationales: abstentions.map((one) => one.rationale), flagThreshold },
			(lintError, lintResult) => {
				if (lintError) {
					callback(`retrievalMetrics.computeMetrics: ${lintError}`);
					return;
				}
				callback('', {
					metrics: {
						metricsVersion: METRICS_VERSION,
						pairKey,
						generation,
						forensicFilePath,
						cosineCutoff,
						recordCount: records.length,
						malformedLineCount,

						judgmentOutcomes: {
							picks: picks.length,
							abstentions: abstentions.length,
							abstentionRatePercent: percentOf(abstentions.length, records.length),
							unresolvableChoices: unresolvableChoices.length,
							unrecognizedChoices: unrecognizedChoices.length,
						},

						winnerRankDistribution,

						cosineTopOneAccuracy: {
							hits: topOneHits,
							of: picks.length,
							percent: percentOf(topOneHits, picks.length),
						},

						recallWithinCosineCutoff: {
							cosineCutoff,
							hits: recallHits,
							of: picks.length,
							percent: percentOf(recallHits, picks.length),
						},

						rescueAttribution: {
							// THE TWO NUMBERS ARE NOT INTERCHANGEABLE — see the module header.
							genuineRescues,
							genuineRescuePercent: percentOf(genuineRescues, picks.length),
							genuineRescueMeaning:
								`winner carried a nomination AND sat outside the cosine top-${cosineCutoff}, so ` +
								`the nomination is the ONLY reason it was in the pool`,
							winnerCarriedNomination,
							winnerCarriedNominationPercent: percentOf(winnerCarriedNomination, picks.length),
							winnerCarriedNominationMeaning:
								'winner merely carried a nomination — cosine may well have retrieved it anyway. ' +
								'This is the WEAKER claim and must never be reported as a rescue count.',
						},

						abstentionAnalysis: lintResult.abstentionLint,

						poolComposition: {
							poolsMeasured: poolBearing.length,
							minPoolSize: poolSizes.length ? poolSizes[0] : null,
							maxPoolSize: poolSizes.length ? poolSizes[poolSizes.length - 1] : null,
							meanPoolSize: poolSizes.length
								? Math.round((sumOf(poolSizes) / poolSizes.length) * 10) / 10
								: null,
							medianPoolSize: poolSizes.length ? poolSizes[Math.floor(poolSizes.length / 2)] : null,
							poolSizeHistogram,
							meanNominatedPerPool: nominatedPerPool.length
								? Math.round((sumOf(nominatedPerPool) / nominatedPerPool.length) * 10) / 10
								: null,
							poolsWithNoNomination: nominatedPerPool.filter((one) => one === 0).length,
						},

						categoryCounts,
						judgedViaCounts,
					},
				});
			},
		);
	};

	// -----------------------------------------------------------------
	// readForensicRecords — one .jsonl trail -> records.
	// -----------------------------------------------------------------
	// A line that does not parse is COUNTED and reported, never silently dropped: a forensic trail
	// with unreadable lines is a fact the reader must state, because every denominator below
	// depends on how many judgments were actually read.
	const readForensicRecords = ({ filePath } = {}, callback) => {
		if (typeof callback !== 'function') {
			throw new Error('retrievalMetrics.readForensicRecords: a callback is REQUIRED (R7)');
		}
		if (!isNonBlankString(filePath)) {
			callback(
				`retrievalMetrics.readForensicRecords: filePath is REQUIRED and has no default. A reader ` +
					`that does not say which trail it read cannot be believed about what it found.`,
			);
			return;
		}
		fs.readFile(filePath, 'utf8', (readError, fileText) => {
			if (readError) {
				callback(`retrievalMetrics.readForensicRecords: reading '${filePath}': ${readError.message}`);
				return;
			}
			const records = [];
			const malformedLines = [];
			fileText.split('\n').forEach((oneLine, index) => {
				if (oneLine.trim() === '') {
					return;
				}
				let parsed = null;
				try {
					parsed = JSON.parse(oneLine);
				} catch (parseError) {
					malformedLines.push(index + 1);
					return;
				}
				records.push(parsed);
			});
			callback('', { records, malformedLineCount: malformedLines.length, malformedLines, filePath });
		});
	};

	// -----------------------------------------------------------------
	// discoverTrails — which pair+generation trails exist to be measured.
	// -----------------------------------------------------------------
	// pairKey is REQUIRED (a measurement is always OF a standard pairing). generation is optional:
	// absent, EVERY generation under the pair is measured, because "which generation did you mean"
	// is exactly the question a silent default would answer wrongly — and comparing generations
	// side by side is the point of keeping them side by side.
	const discoverTrails = ({ forensicsDirPath, pairKey, generation } = {}, callback) => {
		if (typeof callback !== 'function') {
			throw new Error('retrievalMetrics.discoverTrails: a callback is REQUIRED (R7)');
		}
		if (!isNonBlankString(forensicsDirPath)) {
			callback(
				`retrievalMetrics.discoverTrails: forensicsDirPath is REQUIRED and has no default here ` +
					`(the documented default lives in the caller, graphBuilder's actions.js — the same ` +
					`split match-forensics itself uses).`,
			);
			return;
		}
		if (!isNonBlankString(pairKey)) {
			callback(
				`retrievalMetrics.discoverTrails: pairKey is REQUIRED and has no default. A metrics run ` +
					`is always ABOUT one standard pairing (e.g. 'CEDS::CASE'); there is no meaningful ` +
					`aggregate across pairings that judge different standards.`,
			);
			return;
		}

		const pairDirPath = path.join(forensicsDirPath, pairKey);
		if (!fs.existsSync(pairDirPath)) {
			const available = fs.existsSync(forensicsDirPath)
				? fs
						.readdirSync(forensicsDirPath, { withFileTypes: true })
						.filter((one) => one.isDirectory())
						.map((one) => one.name)
						.sort()
				: [];
			callback(
				`retrievalMetrics.discoverTrails: no forensic trail for pairKey '${pairKey}' at ` +
					`'${pairDirPath}'. ${
						available.length
							? `Pairs present: ${available.join(', ')}.`
							: `The forensics directory '${forensicsDirPath}' holds no pair directories at all.`
					}`,
			);
			return;
		}

		const generationsPresent = fs
			.readdirSync(pairDirPath)
			.filter((one) => /\.jsonl$/.test(one))
			.map((one) => one.replace(/\.jsonl$/, ''))
			.sort();

		if (!generationsPresent.length) {
			callback(
				`retrievalMetrics.discoverTrails: pair directory '${pairDirPath}' holds no <generation>.jsonl ` +
					`trail. An empty pair directory is reported, never measured as a zero-judgment run.`,
			);
			return;
		}

		if (isNonBlankString(generation)) {
			if (generationsPresent.indexOf(generation) === -1) {
				callback(
					`retrievalMetrics.discoverTrails: generation '${generation}' has no trail under ` +
						`'${pairDirPath}'. Generations present: ${generationsPresent.join(', ')}.`,
				);
				return;
			}
			callback('', {
				trails: [
					{ pairKey, generation, filePath: path.join(pairDirPath, `${generation}.jsonl`) },
				],
			});
			return;
		}

		callback('', {
			trails: generationsPresent.map((oneGeneration) => ({
				pairKey,
				generation: oneGeneration,
				filePath: path.join(pairDirPath, `${oneGeneration}.jsonl`),
			})),
		});
	};

	// -----------------------------------------------------------------
	// measureTrail — read ONE trail and compute its metrics.
	// -----------------------------------------------------------------
	const measureTrail = (
		{ filePath, pairKey = '', generation = '', cosineCutoff, flagThreshold } = {},
		callback,
	) => {
		if (typeof callback !== 'function') {
			throw new Error('retrievalMetrics.measureTrail: a callback is REQUIRED (R7)');
		}
		const taskList = new taskListPlus();

		taskList.push((args, next) => {
			const { filePath } = args;
			readForensicRecords({ filePath }, (readError, readResult) => {
				if (readError) {
					next(readError, args);
					return;
				}
				next('', Object.assign({}, args, readResult));
			});
		});

		taskList.push((args, next) => {
			const { records, malformedLineCount, pairKey, generation, filePath, cosineCutoff, flagThreshold } = args;
			computeMetrics(
				{
					records,
					malformedLineCount,
					pairKey,
					generation,
					forensicFilePath: filePath,
					...(cosineCutoff === undefined ? {} : { cosineCutoff }),
					...(flagThreshold === undefined ? {} : { flagThreshold }),
				},
				(computeError, computeResult) => {
					if (computeError) {
						next(computeError, args);
						return;
					}
					next('', Object.assign({}, args, computeResult));
				},
			);
		});

		pipeRunner(
			taskList.getList(),
			{ filePath, pairKey, generation, cosineCutoff, flagThreshold },
			(pipeError, args) => {
				if (pipeError) {
					callback(pipeError);
					return;
				}
				callback('', { metrics: args.metrics });
			},
		);
	};

	// -----------------------------------------------------------------
	// measurePair — discover every trail for a pair and measure each.
	// -----------------------------------------------------------------
	const measurePair = (
		{ forensicsDirPath, pairKey, generation, cosineCutoff, flagThreshold } = {},
		callback,
	) => {
		if (typeof callback !== 'function') {
			throw new Error('retrievalMetrics.measurePair: a callback is REQUIRED (R7)');
		}
		discoverTrails({ forensicsDirPath, pairKey, generation }, (discoverError, discovered) => {
			if (discoverError) {
				callback(discoverError);
				return;
			}
			const taskList = new taskListPlus();
			discovered.trails.forEach((oneTrail) => {
				taskList.push((args, next) => {
					measureTrail(
						{
							filePath: oneTrail.filePath,
							pairKey: oneTrail.pairKey,
							generation: oneTrail.generation,
							cosineCutoff,
							flagThreshold,
						},
						(measureError, measured) => {
							if (measureError) {
								next(measureError, args);
								return;
							}
							next('', Object.assign({}, args, { reports: args.reports.concat([measured.metrics]) }));
						},
					);
				});
			});
			pipeRunner(taskList.getList(), { reports: [] }, (pipeError, args) => {
				if (pipeError) {
					callback(pipeError);
					return;
				}
				callback('', { pairKey, forensicsDirPath, reports: args.reports });
			});
		});
	};

	// -----------------------------------------------------------------
	// renderReportText — the human-readable report.
	// -----------------------------------------------------------------
	// Every number here is read straight off the metrics object the JSON sidecar carries; the text
	// and the JSON can never disagree because neither recomputes anything.
	const renderReportText = ({ reports } = {}, callback) => {
		if (typeof callback !== 'function') {
			throw new Error('retrievalMetrics.renderReportText: a callback is REQUIRED (R7)');
		}
		if (!Array.isArray(reports)) {
			callback(
				`retrievalMetrics.renderReportText: reports is REQUIRED and must be an array of metrics ` +
					`objects, got ${reports === null ? 'null' : typeof reports}.`,
			);
			return;
		}

		const pad = (text, width) => `${text}${' '.repeat(Math.max(0, width - String(text).length))}`;
		const show = (value) => (value === null || value === undefined ? 'n/a' : String(value));
		const lines = [];

		reports.forEach((oneReport) => {
			const outcomes = oneReport.judgmentOutcomes;
			lines.push('='.repeat(78));
			lines.push(`RETRIEVAL METRICS — ${oneReport.pairKey}  /  ${oneReport.generation}`);
			lines.push('='.repeat(78));
			lines.push(`instrument      : ${oneReport.metricsVersion}   (cosine cutoff ${oneReport.cosineCutoff})`);
			lines.push(`trail           : ${oneReport.forensicFilePath}`);
			lines.push(
				`judgments       : ${oneReport.recordCount} records — ${outcomes.picks} picks, ` +
					`${outcomes.abstentions} abstentions (${show(outcomes.abstentionRatePercent)}%)`,
			);
			if (outcomes.unresolvableChoices || outcomes.unrecognizedChoices || oneReport.malformedLineCount) {
				lines.push(
					`anomalies       : ${outcomes.unresolvableChoices} unresolvable choice(s), ` +
						`${outcomes.unrecognizedChoices} unrecognized choice(s), ` +
						`${oneReport.malformedLineCount} malformed line(s)`,
				);
			}

			lines.push('');
			lines.push(`WINNER RANK DISTRIBUTION  (where the CHOSEN candidate sat in cosine order)`);
			RANK_BUCKETS.forEach((oneBucket) => {
				const bucket = oneReport.winnerRankDistribution[oneBucket.key];
				const barWidth = outcomes.picks > 0 ? Math.round((bucket.count / outcomes.picks) * 40) : 0;
				lines.push(
					`  ${pad(bucket.label, 10)} ${pad(bucket.count, 6)} ${pad(`${show(bucket.percent)}%`, 8)} ` +
						`${'#'.repeat(barWidth)}`,
				);
			});

			lines.push('');
			lines.push(
				`COSINE TOP-1 ACCURACY     : ${oneReport.cosineTopOneAccuracy.hits}/` +
					`${oneReport.cosineTopOneAccuracy.of} = ${show(oneReport.cosineTopOneAccuracy.percent)}%`,
			);
			lines.push(
				`RECALL (within top-${oneReport.recallWithinCosineCutoff.cosineCutoff})     : ` +
					`${oneReport.recallWithinCosineCutoff.hits}/${oneReport.recallWithinCosineCutoff.of} = ` +
					`${show(oneReport.recallWithinCosineCutoff.percent)}%   ` +
					`(would have been retrieved by cosine alone)`,
			);

			lines.push('');
			lines.push('RESCUE ATTRIBUTION  (these two numbers are NOT interchangeable)');
			lines.push(
				`  GENUINE rescues         : ${oneReport.rescueAttribution.genuineRescues} ` +
					`(${show(oneReport.rescueAttribution.genuineRescuePercent)}% of picks) — nominated AND ` +
					`outside the cosine top-${oneReport.cosineCutoff}`,
			);
			lines.push(
				`  winner merely nominated : ${oneReport.rescueAttribution.winnerCarriedNomination} ` +
					`(${show(oneReport.rescueAttribution.winnerCarriedNominationPercent)}% of picks) — the ` +
					`WEAKER claim; cosine may have retrieved it anyway`,
			);

			lines.push('');
			const lint = oneReport.abstentionAnalysis;
			lines.push(
				`ABSTENTION LINT  (${lint.abstentionCount} abstentions; flag threshold ` +
					`>${lint.flagThresholdPercent}%)`,
			);
			lint.probes.forEach((oneProbe) => {
				lines.push(
					`  ${oneProbe.flagged ? 'FLAGGED SIGNAL' : '      ok      '} ${pad(oneProbe.key, 24)} ` +
						`${pad(oneProbe.count, 6)} ${show(oneProbe.percent)}%`,
				);
			});
			if (lint.flaggedSignals.length) {
				lines.push('');
				lines.push('  what the flagged signals mean:');
				lint.flaggedSignals.forEach((oneProbe) => {
					lines.push(`    - ${oneProbe.key} (${show(oneProbe.percent)}%): ${oneProbe.label}`);
					lines.push(`      ${oneProbe.defect}`);
				});
			}
			if (lint.recurringPhrases.length) {
				lines.push('');
				lines.push('  recurring phrasing (INFORMATIONAL — not a flagged signal):');
				lint.recurringPhrases.slice(0, 8).forEach((onePhrase) => {
					lines.push(`    ${pad(`${show(onePhrase.percent)}%`, 8)} "${onePhrase.phrase}"`);
				});
			}

			lines.push('');
			const pool = oneReport.poolComposition;
			lines.push('POOL COMPOSITION');
			lines.push(
				`  size: min ${show(pool.minPoolSize)}, median ${show(pool.medianPoolSize)}, ` +
					`mean ${show(pool.meanPoolSize)}, max ${show(pool.maxPoolSize)} ` +
					`(${pool.poolsMeasured} pools)`,
			);
			lines.push(
				`  nominations: ${show(pool.meanNominatedPerPool)} per pool on average; ` +
					`${pool.poolsWithNoNomination} pool(s) carried none`,
			);
			lines.push(
				`  categories: ${
					Object.keys(oneReport.categoryCounts)
						.sort()
						.map((one) => `${one}=${oneReport.categoryCounts[one]}`)
						.join(', ') || '(none)'
				}`,
			);
			lines.push(
				`  judged via: ${
					Object.keys(oneReport.judgedViaCounts)
						.sort()
						.map((one) => `${one}=${oneReport.judgedViaCounts[one]}`)
						.join(', ') || '(none)'
				}`,
			);
			lines.push('');
		});

		callback('', { reportText: lines.join('\n') });
	};

	return {
		// the pure, separately-testable pieces
		parseCandidateBlocks,
		rankCandidatesByCosine,
		analyzeRecord,
		lintAbstentions,
		computeMetrics,
		// the I/O-bearing composition
		readForensicRecords,
		discoverTrails,
		measureTrail,
		measurePair,
		renderReportText,
		// the declared contract
		METRICS_VERSION,
		DEFAULT_COSINE_CUTOFF,
		DEFAULT_ABSTENTION_FLAG_THRESHOLD,
		RANK_BUCKETS,
		ABSTENTION_PROBES,
	};
};

// END OF moduleFunction() ============================================================

module.exports = retrievalMetrics;
