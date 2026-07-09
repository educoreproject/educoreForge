'use strict';

// Gate (twin / determinism, STANDING): the embedding-sidecar Q4 closure, at the BLOCK level.
//
// A producer BLOCK now carries a STABLE embeddingRef (a content hash of the vector INPUT:
// sha256(embeddingModelVersion \0 searchText), content-address.vectorIdForInput) in place of the OLD
// volatile base64 float32 scalar. Because blockId = sha256(block text) (content-address.blockIdForText),
// the block's identity now depends on that STABLE ref, not on non-deterministic embedding bytes — so a
// re-forge with a warm cache produces a byte-identical block. This closes the long-standing Q4 hazard
// (pre-sidecar, the volatile vector lived inside the hashed text, so every re-forge changed the blockId).
//
// This gate proves, graph-free, three things through the REAL serializer + REAL content-address:
//   GREEN (stability): re-shaping the identical block (same header + same node refs) yields the SAME
//     block text and the SAME blockId; and a ref recomputed from the same (modelVersion, searchText) is
//     byte-identical — so a warm-cache / cold-cache-same-input re-forge is block-identical (Q4 closed).
//   RED (drift bite): mutating ONE node's embeddingRef (the effect of a model bump or a changed input —
//     cold-cache re-embed of the SAME input keeps the ref, a determinant change moves it) changes the
//     block text and yields a DIFFERENT blockId. A gate never seen failing is unproven; the RED transition
//     (blockId MUST move) is asserted here every run.
//   GUARD (ref load-bearing): baseline vs. the ref-mutated block differ in EXACTLY one node line, and that
//     line differs ONLY in the embeddingRef value — proof the ref genuinely sits inside the hashed block
//     text (not adjacent to it).
//
// Relationship to the graph-level determinism gates (03/07): those compare MATERIALIZED graphs, where
// replay has already resolved embeddingRef -> embedding BEFORE the MERGE, so the graph never carries a ref
// and producer-phase gates exclude the volatile embedding (ignoreEmbedding=true). THIS gate proves the
// producer artifact — the block — is byte-stable BECAUSE the ref replaced the volatile vector. The
// GRAPH-level FULL-mode flip (dropping ignoreEmbedding on producer gates once a transported warm store
// makes the resolved embedding deterministic) is DEFERRED to Phase 5, which has the docker warm-store
// replay needed to demonstrate it.
//
// Graph-free / pure: builds blocks in memory via replay-block.serializeBlock (which writes embeddingRef)
// and content-address.blockIdForText. No Neo4j/docker; ctx is unused.

const path = require('path');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const CORE_LIB = path.join(
	findProjectRoot(),
	'code',
	'npm',
	'qtools-graph-forge-core',
	'lib',
);

const { serializeBlock } = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const { blockIdForText, vectorIdForInput } = require(
	path.join(CORE_LIB, 'content-address', 'content-address'),
)();

const MODEL_VERSION = 'voyage-4-large';

// SEARCH_TEXTS — the strings the embedder would be fed (role+name+context, pipe-delimited, never a NUL).
const SEARCH_TEXTS = [
	'role=property|name=First Name|class=Person',
	'role=property|name=Last Name|class=Person',
	'role=class|name=Person',
];

// buildBlock — a small, fixed, embeddingRef-carrying standard block (deterministic; stable array order).
// node0RefOverride (when given) replaces ONLY node 0's embeddingRef, leaving its modelVersion and every
// other field intact — the isolation the load-bearing guard needs.
const buildBlock = ({ node0RefOverride } = {}) => {
	const header = {
		blockType: 'standard',
		standardKey: 'CEDS',
		version: 'v0',
		stableUriPropertyName: 'cedsId',
		resolutionKey: 'cedsId',
		goldenVersionAuthoredAgainst: 'v0',
		embeddingModelVersion: MODEL_VERSION,
		embeddingEncoding: 'none',
		embeddingDtype: 'float32',
		embeddingByteOrder: 'little-endian',
		embeddingDims: 1024,
	};
	const nodes = SEARCH_TEXTS.map((searchText, idx) => ({
		ref: { source: 'ceds', id: `n${idx}` },
		labels: ['ForgedNode', idx === 2 ? 'CedsClass' : 'CedsProperty'],
		stableId: `ceds:n${idx}`,
		properties: { name: searchText, searchText },
		embeddingRef:
			idx === 0 && node0RefOverride
				? node0RefOverride
				: vectorIdForInput(MODEL_VERSION, searchText),
		embeddingModelVersion: MODEL_VERSION,
	}));
	return serializeBlock({ header, nodes, edges: [] });
};

module.exports = () => ({
	name: 'determinism.blockDeterminismEmbeddingRef',
	phase: 'Phase0',
	kind: 'twin',
	expectFail: false,
	run: (ctx, callback) => {
		const baseText = buildBlock();
		const baseId = blockIdForText(baseText);

		// GREEN (stability): re-shape the identical block -> identical text & blockId.
		const rebuiltText = buildBlock();
		const rebuiltId = blockIdForText(rebuiltText);
		const stable = rebuiltText === baseText && rebuiltId === baseId;

		// the ref is a pure function of (modelVersion, searchText): a cold-cache re-embed of the SAME input
		// yields the SAME ref regardless of the actual float bytes — the heart of the Q4 closure.
		const refReproducible =
			vectorIdForInput(MODEL_VERSION, SEARCH_TEXTS[0]) ===
			vectorIdForInput(MODEL_VERSION, SEARCH_TEXTS[0]);

		// RED (drift bite): a determinant change moves node 0's ref -> a different, real 64-hex ref.
		const baseNode0Ref = vectorIdForInput(MODEL_VERSION, SEARCH_TEXTS[0]);
		const driftedRef = vectorIdForInput(
			MODEL_VERSION,
			'role=property|name=Middle Name|class=Person',
		);
		const refActuallyDiffers = driftedRef !== baseNode0Ref;

		const mutatedText = buildBlock({ node0RefOverride: driftedRef });
		const mutatedId = blockIdForText(mutatedText);
		const driftCaught = mutatedText !== baseText && mutatedId !== baseId;

		// GUARD (ref load-bearing): baseline vs mutated differ in EXACTLY one line, and that line differs
		// ONLY in the embeddingRef value — the ref is genuinely inside the hashed block text.
		const baseLines = baseText.split('\n');
		const mutatedLines = mutatedText.split('\n');
		const diffIdxs = baseLines.reduce(
			(acc, line, idx) => (line === mutatedLines[idx] ? acc : acc.concat(idx)),
			[],
		);
		let refOnlyDiff = false;
		if (diffIdxs.length === 1) {
			const before = JSON.parse(baseLines[diffIdxs[0]]);
			const after = JSON.parse(mutatedLines[diffIdxs[0]]);
			const refsDiffer = before.embeddingRef !== after.embeddingRef;
			const beforeRest = { ...before };
			const afterRest = { ...after };
			delete beforeRest.embeddingRef;
			delete afterRest.embeddingRef;
			refOnlyDiff =
				refsDiffer && JSON.stringify(beforeRest) === JSON.stringify(afterRest);
		}
		const refLoadBearing =
			diffIdxs.length === 1 && refOnlyDiff && mutatedId !== baseId;

		const passed =
			stable &&
			refReproducible &&
			refActuallyDiffers &&
			driftCaught &&
			refLoadBearing;

		callback('', {
			passed,
			detail:
				`GREEN(stable)->sameBlockId=${stable} (${baseId.slice(0, 12)}…); ` +
				`refReproducible=${refReproducible}; ` +
				`RED(refDrift)->differentBlockId=${driftCaught} ` +
				`(base ${baseId.slice(0, 12)}… vs mutated ${mutatedId.slice(0, 12)}…); ` +
				`GUARD(refLoadBearing)->${diffIdxs.length} line changed, refOnly=${refOnlyDiff}, ` +
				`blockIdMoved=${mutatedId !== baseId}`,
		});
	},
});
