'use strict';

// experiment-voyageBatchedDeterminism.js — does the BATCHED embed path (embedTexts — the one the
// PRODUCERS actually use) return byte-identical vectors when the SAME batch is embedded twice? The
// earlier experiment confirmed single-embed (embedText) determinism; WILD_FALCON correctly flagged the
// batched path as the residual unknown before embeddings-INCLUDED byte-identity can be a trustworthy
// gate. This embeds a small batch twice via embedTexts and compares every vector byte-for-byte.
//
// Two real Voyage batched calls. No async/await, no try/catch for control flow.

const path = require('path');

process.global = process.global || {
	xLog: { status: () => {}, error: (...a) => console.error(...a), result: () => {}, verbose: () => {} },
};

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const CORE_LIB = path.join(findProjectRoot(), 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const embedder = require(path.join(CORE_LIB, 'embedding', 'embedding-client'))({});

// a small batch of distinct, producer-like searchText strings
const BATCH = [
	'CEDS · Person Identification · Person Identifier',
	'CEDS · Organization · Local Education Agency Operational Status',
	'SIF · StudentPersonal · LocalId',
	'EdFi · StudentEducationOrganizationAssociation · IdentificationCode',
];

const toBase64 = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString('base64');
const maxAbsDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; } return m; };

console.log('[voyage-batched] embedding a 4-text batch twice via embedTexts…');

embedder.embedTexts({ texts: BATCH }, (err1, first) => {
	if (err1) { console.error(`[voyage-batched] first batch failed: ${err1}`); process.exit(2); return; }
	embedder.embedTexts({ texts: BATCH }, (err2, second) => {
		if (err2) { console.error(`[voyage-batched] second batch failed: ${err2}`); process.exit(2); return; }
		const v1 = first.vectors;
		const v2 = second.vectors;
		let allByteIdentical = v1.length === v2.length;
		let worstDiff = 0;
		const perVector = [];
		for (let i = 0; i < Math.min(v1.length, v2.length); i++) {
			const a = Float32Array.from(v1[i]);
			const b = Float32Array.from(v2[i]);
			const bi = a.length === b.length && toBase64(a) === toBase64(b);
			const d = a.length === b.length ? maxAbsDiff(a, b) : null;
			if (!bi) allByteIdentical = false;
			if (d !== null && d > worstDiff) worstDiff = d;
			perVector.push({ index: i, dims: a.length, byteIdentical: bi, maxAbsDiff: d });
		}
		console.log(JSON.stringify({
			experiment: 'voyageBatchedDeterminism',
			modelVersion: first.embeddingModelVersion,
			batchSize: BATCH.length,
			allByteIdentical,
			worstMaxAbsDiff: worstDiff,
			perVector,
			verdict: allByteIdentical
				? 'BATCHED DETERMINISTIC — embedTexts yields byte-identical vectors on re-call'
				: 'BATCHED NON-DETERMINISTIC — embedTexts varies on re-call',
			implication: allByteIdentical
				? 'Embeddings-INCLUDED block-text byte-identity is a TRUSTWORTHY strict gate (promote to bonus-strict). The embedding-excluded structural diff remains the gate of record.'
				: 'Keep embeddings-INCLUDED byte-identity BEST-EFFORT only; the embedding-excluded structural diff is the gate of record (immune to this variance).',
		}, null, 2));
		process.exit(0);
	});
});
