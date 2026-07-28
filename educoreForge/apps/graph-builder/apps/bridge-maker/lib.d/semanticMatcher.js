'use strict';

// semanticMatcher.js — lib.d EXTRACT (bridgeKitRefactor_072726 design §4.1). A faithful COPY of
// inferencePipeline's `cosine` + `retrieve` (bridge-maker/lib/inferencePipeline.js) — the
// role-matched top-K CEDS candidate lookup by DEFINITION-embedding cosine (deterministic) — split
// out so the kit composes RETRIEVAL and SELECTION as two moves instead of inferencePipeline's fused
// scoreSource. inferencePipeline.js is left UNTOUCHED (P2 coexist: semanticBridge keeps calling its
// own fused pipeline); P1's equivalence gate (test-kit-equivalence.js) is what proves this copy's
// output is byte-identical to inferencePipeline.retrieve's over the same inputs.
//
//   semanticMatcher({ topK = 15 }) -> {
//       retrieve(source, candidatePool) -> [{ candidate, cosine }]   // sorted desc, sliced to topK
//       cosine(a, b) -> number                                       // -1 when either vector is absent
//   }
//
// PURE + synchronous + deterministic: no Neo4j, no async, no Date/random, no LLM. camelCase only.

// cosine of two Float32Arrays (1024). Both assumed same length; null-safe -> -1 (never retrieved).
// Byte-for-byte inferencePipeline.cosine.
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

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ topK = 15 } = {}) => {
		void moduleName; // no construction-time guard: retrieve is a pure function of its call args,
		// exactly as inferencePipeline.retrieve is — matching the original's shape is the point (P1).

		// retrieve — top-K same-role candidates for a source by cosine (candidatePool already
		// role-matched by the caller). Byte-for-byte inferencePipeline.retrieve.
		const retrieve = (source, candidatePool) => {
			const scored = (candidatePool || []).map((oneCandidate) => ({
				candidate: oneCandidate,
				cosine: cosine(source.vector, oneCandidate.vector),
			}));
			scored.sort((a, b) => b.cosine - a.cosine);
			return scored.slice(0, topK);
		};

		return { retrieve, cosine };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
