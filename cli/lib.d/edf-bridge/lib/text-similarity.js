'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// text-similarity.js — shared PURE primitives for the -implied reranker (Phase II): a name/path
// tokenizer, token-set Jaccard, and cosine over stored embeddings. Harvested+adapted from trackA
// (crosswalk-engine: elementMatcher.tokenize/jaccard, embeddingMatcher.cosine). No I/O, no qtools, no
// neo4j — these are deterministic functions the matchers compose. camelCase only.

// Tokens that carry no discriminating signal for education-data element names.
const STOP_TOKENS = new Set([
	'the', 'of', 'and', 'or', 'a', 'an', 'to', 'in', 'on', 'for', 'by',
	'type', 'code', 'value', 'id', 'name',
]);

// tokenize — camelCase-split, separator-normalize, lowercase, strip punctuation, drop short/stop
// tokens, de-dupe. Returns a de-duplicated array. Empty/non-string -> [].
//
// MEMOIZED: tokenization is deterministic and pure, and the reranker re-tokenizes the SAME node /
// sibling / segment names across hundreds of thousands of candidate pairs. A transparent cache keyed
// on the raw string collapses that to one tokenization per distinct string (distinct names+segments
// are bounded — ~tens of thousands). Output is identical to the uncached function.
const tokenizeCache = new Map();
const tokenize = (raw) => {
	if (!raw || typeof raw !== 'string') {
		return [];
	}
	const cached = tokenizeCache.get(raw);
	if (cached) {
		return cached;
	}
	const expanded = raw
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase split
		.replace(/[_\-./:]+/g, ' ') // snake / kebab / path / colon
		.toLowerCase()
		.replace(/[^a-z0-9 ]+/g, ' ')
		.split(/\s+/)
		.filter((token) => token.length > 1 && !STOP_TOKENS.has(token));
	const tokens = Array.from(new Set(expanded));
	tokenizeCache.set(raw, tokens);
	return tokens;
};

// jaccard — |A∩B| / |A∪B| over two token lists. Empty-vs-empty -> 0 (NOT 0.5).
const jaccard = (aTokens, bTokens) => {
	if (aTokens.length === 0 && bTokens.length === 0) {
		return 0;
	}
	const aSet = new Set(aTokens);
	const bSet = new Set(bTokens);
	let intersection = 0;
	aSet.forEach((token) => {
		if (bSet.has(token)) {
			intersection++;
		}
	});
	const union = aSet.size + bSet.size - intersection;
	if (union === 0) {
		return 0;
	}
	return intersection / union;
};

// cosine — standard cosine over two equal-length numeric vectors, clamped to [0,1] (negatives -> 0).
// Missing / mismatched-length / zero-norm -> 0 (NOT 0.5): an absent embedding is a real penalty.
const cosine = (a, b) => {
	if (!Array.isArray(a) || !Array.isArray(b)) {
		return 0;
	}
	if (a.length === 0 || a.length !== b.length) {
		return 0;
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
		return 0;
	}
	const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
	if (sim < 0) {
		return 0;
	}
	if (sim > 1) {
		return 1;
	}
	return sim;
};

module.exports = { tokenize, jaccard, cosine, STOP_TOKENS, moduleName };
