'use strict';

// experiment-voyageDeterminism.js — does the PRODUCTION embedder return byte-identical vectors when
// the SAME text is embedded twice? This settles the open question from the re-forge analysis: the
// forge has no embedding cache, so a re-forge re-embeds every node — and whether that produces stable
// bytes determines whether full-graph (embedding-included) gates are even possible for producer phases.
//
// Makes TWO real Voyage API calls (embed the same fixed string twice) and compares the vectors
// byte-for-byte (base64 of float32-LE) AND numerically (max abs element diff). Authorized by
// WILD_FALCON 2026-06-29. Run: node this file.
//
// No async/await, no try/catch for control flow; callback style at the leaf. camelCase.

const path = require('path');

// quiet process.global stub (the embedding-client reads config itself; this is belt-and-suspenders)
process.global = process.global || {
	xLog: { status: () => {}, error: (...a) => console.error(...a), result: () => {}, verbose: () => {} },
};

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const CORE_LIB = path.join(findProjectRoot(), 'code', 'npm', 'qtools-graph-forge-core', 'lib');

// instantiate the production embedder exactly as edf-forge does (default config path = the project's
// voyageEmbedding.ini; provider defaults to 'voyage').
const embedder = require(path.join(CORE_LIB, 'embedding', 'embedding-client'))({});

const FIXED_TEXT =
	'Student Identifier — a code or string assigned by an organization to identify a person, used for the Person Identification concept in CEDS.';

const toBase64 = (float32Array) => Buffer.from(float32Array.buffer, float32Array.byteOffset, float32Array.byteLength).toString('base64');

const maxAbsDiff = (a, b) => {
	let m = 0;
	for (let i = 0; i < a.length; i++) {
		const d = Math.abs(a[i] - b[i]);
		if (d > m) m = d;
	}
	return m;
};

console.log('[voyage-determinism] embedding a fixed string twice via the production embedder…');

embedder.embedText({ text: FIXED_TEXT }, (err1, first) => {
	if (err1) {
		console.error(`[voyage-determinism] first embed failed: ${err1}`);
		process.exit(2);
		return;
	}
	embedder.embedText({ text: FIXED_TEXT }, (err2, second) => {
		if (err2) {
			console.error(`[voyage-determinism] second embed failed: ${err2}`);
			process.exit(2);
			return;
		}
		const v1 = first.vector;
		const v2 = second.vector;
		const dims1 = v1.length;
		const dims2 = v2.length;
		const b1 = toBase64(v1);
		const b2 = toBase64(v2);
		const byteIdentical = dims1 === dims2 && b1 === b2;
		const numericMaxDiff = dims1 === dims2 ? maxAbsDiff(v1, v2) : null;

		console.log(JSON.stringify({
			experiment: 'voyageDeterminism',
			modelVersion: first.embeddingModelVersion,
			dims: dims1,
			dimsMatch: dims1 === dims2,
			byteIdentical,
			numericMaxAbsDiff: numericMaxDiff,
			verdict: byteIdentical
				? 'DETERMINISTIC — same input yields byte-identical vectors on re-call'
				: 'NON-DETERMINISTIC — same input yields different vectors on re-call',
			implication: byteIdentical
				? 'A re-forge of unchanged content would (absent other variance) reproduce identical embeddings, so full-graph byte-identity COULD hold for re-forge — but the forge still re-embeds, so an embedding cache would only save cost, not change determinism.'
				: 'A re-forge re-embeds with variance; producer-phase gates MUST use the embedding-excluded fingerprint to isolate structural change. Only a content-hash embedding cache (reuse, not re-embed) could make re-forge fully byte-identical.',
		}, null, 2));
		process.exit(0);
	});
});
