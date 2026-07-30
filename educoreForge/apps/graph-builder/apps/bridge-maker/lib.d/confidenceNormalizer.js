'use strict';

// confidenceNormalizer.js — bridge-maker/lib.d NEW (bridgeEvidenceRefactor-spec.md §3, ⟪A4⟫; P3
// deliverable). THE NORMALIZER: `(category, retrievalCosine, context, callback(err, confidence))` —
// generic, deterministic. Implements the NORMALIZER contract (evidenceContracts.js §6): arity 4,
// positional, trailing callback (R7). SAME inputs -> SAME number, always — determinism is the WHOLE
// of this contract; normalizerDeterminismViolation is its own keystone proof.
//
// THE MAPPING f(category, cosine) — documented HERE because the contract deliberately pins only
// determinism + shape, not the formula (evidenceContracts.js §6 comment: "the mapping ITSELF ... is
// P3's to design"):
//
//   category === 'none'  -> confidence 0, always (an abstain carries no numeric confidence to report).
//   otherwise             -> confidence = floor + (ceiling - floor) * normalizedCosine
//     where {floor, ceiling} is a per-category BAND (CATEGORY_BAND below) and normalizedCosine maps
//     the retrieval cosine — legal range [-1, 1] (evidenceContracts.js's own doc: "-1 is a legal 'no
//     vector'") — onto [0, 1] via (clamp(cosine, -1, 1) + 1) / 2.
//
//   Chosen deliberately SIMPLE and LEGIBLE over clever (documented per the contract's own framing:
//   "simple and legible beats clever"), extending the standing doctrine this tree already states
//   twice (inferencePipeline.js, selector.js): "the reranker contributes the SELECTION, the cosine is
//   the legible numeric signal" — here, the CATEGORY (the LLM's own discrete judgment, ⟪A4⟫)
//   contributes WHICH BAND, and the cosine's position within [-1,1] contributes WHERE in that band —
//   never the reverse (the cosine never promotes a 'weakButReal' pick into 'strong' territory; a band
//   is a hard ceiling on how much retrieval agreement alone can buy).
//
//   CATEGORY_BAND is exported as DATA so a future hub or a calibration pass can inspect (or, via a
//   documented override — none exists yet in P3, flagged for the boundary review) reason about the
//   exact numbers without re-deriving them from prose.
//
// `context` (3rd positional argument) is ACCEPTED per the contract's fixed arity but UNUSED by this
// P3 mapping — reserved for a future hub- or standard-specific calibration (e.g. a hub whose retrieval
// embeddings are known to run cosine-hot or cosine-cold could recalibrate the [-1,1] normalization);
// declared, not exercised, exactly as the contract's own doc allows ("nor whether a real
// implementation ever needs the callback's async freedom").
//
// House style: qtools moduleFunction; callback(errString, result) with '' on success; refuse-by-value
// (polyArch2 §6) — an invalid category or a non-finite cosine is refused BY NAME, never coerced or
// defaulted. camelCase, compound names. No async/await, no try/catch for control flow (pure arithmetic).

const { SELECT_CATEGORY_ENUM } = require('../lib/evidenceContracts');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// CATEGORY_BAND — the per-category [floor, ceiling] confidence range. 'none' has no band (always 0,
// handled as a special case below, never diluted into a [0,0] band that would look like a coincidence).
const CATEGORY_BAND = Object.freeze({
	strong: Object.freeze({ floor: 0.85, ceiling: 1.0 }),
	moderate: Object.freeze({ floor: 0.6, ceiling: 0.85 }),
	weakButReal: Object.freeze({ floor: 0.35, ceiling: 0.6 }),
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// normalize — the produced NormalizerModule.normalize callable (evidenceContracts.js
		// NORMALIZER_SHAPE: arity 4, positional). Synchronous; calls back on the same tick.
		const normalize = (category, retrievalCosine, context, callback) => {
			void context; // reserved, unused in P3's mapping — see file header.
			if (!SELECT_CATEGORY_ENUM.includes(category)) {
				callback(
					`${moduleName}: category must be one of ${SELECT_CATEGORY_ENUM.join(', ')} (got ` +
						`${JSON.stringify(category)}) — there is no default mapping for an unrecognized category.`,
				);
				return;
			}
			if (typeof retrievalCosine !== 'number' || Number.isNaN(retrievalCosine) || !Number.isFinite(retrievalCosine)) {
				callback(
					`${moduleName}: retrievalCosine is not a finite number (got ${JSON.stringify(retrievalCosine)}) — ` +
						`there is no default.`,
				);
				return;
			}
			if (category === 'none') {
				callback('', 0);
				return;
			}
			const band = CATEGORY_BAND[category];
			const normalizedCosine = (clamp(retrievalCosine, -1, 1) + 1) / 2;
			const confidence = band.floor + (band.ceiling - band.floor) * normalizedCosine;
			callback('', confidence);
		};

		return normalize;
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.CATEGORY_BAND = CATEGORY_BAND;
