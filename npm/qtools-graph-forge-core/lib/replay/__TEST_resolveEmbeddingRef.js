#!/usr/bin/env node
'use strict';

// __TEST_resolveEmbeddingRef.js — Phase-3 acceptance gates G-R1..G-R5 (READ path / dual-read,
// GRAPH-FREE). Drives the REAL exported read-side functions (replay-block.deserializeBlock dual-read,
// replay-engine.resolveNodeVectors, replay-engine.buildNodeRow) and the REAL serializer against
// SYNTHETIC blocks + throwaway temp per-standard vector stores. No graph, no docker, no bolt.
//
// G-R1 resolution   — a standardKey=A block node carrying an embeddingRef, whose vector is in store A,
//                     deserialize + resolveNodeVectors -> node.embedding float32-BYTE-EQUAL to stored;
//                     buildNodeRow props.embedding == that same vector.
// G-R2 dual-read twin— a LEGACY inline-embedding block for the SAME vector materializes an IDENTICAL
//                     node.embedding as the ref-resolved node (the byte-identical invariant; graph-free
//                     proxy for F4).
// G-R3 missing-ref  — a ref absent from its store -> resolveNodeVectors FAILS LOUD naming ref+standardKey
//                     (RED); add the vector -> GREEN.
// G-R4 multi-standard— blocks standardKey=A and =B, each ref ONLY in its own store, resolve against their
//                     RESPECTIVE stores; PLUS a wrong-store cross-check (A's ref via B's store) FAILS LOUD.
// G-R5 dims-mismatch — resolved dims != header.embeddingDims -> FAILS LOUD (RED); matching dims -> GREEN.

const os = require('os');
const fs = require('fs');
const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: () => {},
	result: () => {},
};
process.global.getConfig = process.global.getConfig || (() => ({}));

const replayEngine = require('./replay-engine');
const replayBlock = require('./replay-block');
const contentAddress = require('../content-address/content-address')();
const vectorStoreFactory = require('../vector-store/vector-store');

const MODEL = 'voyage-4-large';
const DIMS = 4;

// float32-exact fixtures so byte-equality is clean
const VA = [1.5, 2.5, 3.5, 4.5];
const VB = [-0.5, 0.25, 8, -16];
const VMISS = [2, 4, 6, 8];
const VDIM = [10, 20, 30, 40];

let passCount = 0;
let failCount = 0;
const ok = (label, detail) => {
	passCount++;
	console.log(`PASS  ${label}${detail ? `  (${detail})` : ''}`);
};
const bad = (label, detail) => {
	failCount++;
	console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`);
};

// float32 byte comparison (mirror replay-block/encode: writeFloatLE)
const bufOf = (arr) => {
	const b = Buffer.allocUnsafe(arr.length * 4);
	for (let i = 0; i < arr.length; i++) b.writeFloatLE(arr[i], i * 4);
	return b;
};
const bytesEqual = (a, b) =>
	Array.isArray(a) && Array.isArray(b) && bufOf(a).equals(bufOf(b));

// a ref-node object as serializeNodeLine expects it (embeddingRef branch)
const refNodeObject = (standardKey, id, embeddingRef) => ({
	ref: { source: standardKey, id },
	labels: ['ForgedNode', 'DmeClass'],
	stableId: id,
	properties: { uri: [id], name: [id] },
	embeddingRef,
	embeddingModelVersion: MODEL,
});

// a legacy inline-embedding node object (embedding branch: base64 scalar)
const inlineNodeObject = (standardKey, id, vector) => ({
	ref: { source: standardKey, id },
	labels: ['ForgedNode', 'DmeClass'],
	stableId: id,
	properties: { uri: [id], name: [id] },
	embedding: replayBlock.encodeEmbedding(vector),
	embeddingModelVersion: MODEL,
});

const headerFor = (standardKey, dims) => ({
	blockType: 'standard',
	standardKey,
	version: '1',
	stableUriPropertyName: 'uri',
	resolutionKey: 'uri',
	embeddingModelVersion: MODEL,
	embeddingEncoding: 'base64',
	embeddingDtype: 'float32',
	embeddingByteOrder: 'little-endian',
	embeddingDims: dims,
});

// build a block, deserialize it, and tag each node with its standardKey (as replay()'s accumulation
// loop does) — returns the FRESH deserialized nodes ready for resolveNodeVectors.
const deserializedTaggedNodes = (standardKey, dims, nodeObjects) => {
	const blockText = replayBlock.serializeBlock({
		header: headerFor(standardKey, dims),
		nodes: nodeObjects,
		edges: [],
	});
	const { nodes } = replayBlock.deserializeBlock(blockText);
	nodes.forEach((oneNode) => {
		oneNode._standardKey = standardKey;
	});
	return nodes;
};

const makeResolver = (mapping) => (standardKey, callback) => {
	const store = mapping[standardKey];
	if (!store) {
		callback(`test resolver: no store registered for standard '${standardKey}'`);
		return;
	}
	callback('', store);
};

// temp-file bookkeeping
const tempFiles = [];
const tmpDb = (tag) => {
	const p = path.join(os.tmpdir(), `__TEST_resolveEmbeddingRef_${tag}_${process.pid}.sqlite3`);
	[p, `${p}-shm`, `${p}-wal`].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f));
	tempFiles.push(p);
	return p;
};
const initStore = (tag, callback) => {
	const dbPath = tmpDb(tag);
	const store = vectorStoreFactory({});
	store.init({ dbPath }, (err) => callback(err, store));
};
const putV = (store, inputText, vector, callback) =>
	store.putVector({ modelVersion: MODEL, inputText, vector }, (err) => callback(err));

const finish = () => {
	tempFiles.forEach((p) => {
		[p, `${p}-shm`, `${p}-wal`].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f));
	});
	console.log(
		`\n${failCount === 0 ? 'ALL RESOLVE-EMBEDDING-REF CHECKS PASS' : 'RESOLVE-EMBEDDING-REF CHECKS FAILED'} ` +
			`(${passCount} pass, ${failCount} fail)`,
	);
	process.exit(failCount === 0 ? 0 : 1);
};

// content refs
const refA = contentAddress.vectorIdForInput(MODEL, 'DmeClass Alpha');
const refB = contentAddress.vectorIdForInput(MODEL, 'DmeClass Bravo');
const refMiss = contentAddress.vectorIdForInput(MODEL, 'DmeClass Missing');
const refDim = contentAddress.vectorIdForInput(MODEL, 'DmeClass Dims');

// carried from G-R1 for the G-R2 byte-identical comparison
let gr1ResolvedEmbedding = null;

// =====================================================================
// G-R1 — resolution + buildNodeRow
// =====================================================================
const runGR1 = (next) => {
	initStore('A', (initErr, storeA) => {
		if (initErr) {
			bad('G-R1 init store A', initErr);
			finish();
			return;
		}
		putV(storeA, 'DmeClass Alpha', VA, (putErr) => {
			if (putErr) {
				bad('G-R1 putVector A', putErr);
				finish();
				return;
			}
			const nodes = deserializedTaggedNodes('A', DIMS, [
				refNodeObject('A', 'a:1', refA),
			]);
			// deserialize dual-read: the ref is carried, embedding is null (engine resolves it)
			if (nodes[0].embeddingRef !== refA || nodes[0].embedding !== null) {
				bad('G-R1 deserialize carries embeddingRef, embedding null', `ref=${nodes[0].embeddingRef} emb=${nodes[0].embedding}`);
				finish();
				return;
			}
			replayEngine.resolveNodeVectors(
				{ nodes, storeResolver: makeResolver({ A: storeA }), header: { embeddingDims: DIMS } },
				(resolveErr) => {
					if (resolveErr) {
						bad('G-R1 resolveNodeVectors', resolveErr);
						finish();
						return;
					}
					if (bytesEqual(nodes[0].embedding, VA)) {
						ok('G-R1 resolveNodeVectors sets node.embedding float32-byte-equal to stored vector');
					} else {
						bad('G-R1 node.embedding byte-equal', `got=${JSON.stringify(nodes[0].embedding)}`);
					}
					if (nodes[0]._standardKey === undefined) {
						ok('G-R1 transient _standardKey tag stripped after resolution');
					} else {
						bad('G-R1 _standardKey stripped', `still=${nodes[0]._standardKey}`);
					}
					const row = replayEngine.buildNodeRow(nodes[0]);
					if (bytesEqual(row.props.embedding, VA)) {
						ok('G-R1 buildNodeRow props.embedding == resolved vector');
					} else {
						bad('G-R1 buildNodeRow props.embedding', `got=${JSON.stringify(row.props.embedding)}`);
					}
					gr1ResolvedEmbedding = nodes[0].embedding;
					next();
				},
			);
		});
	});
};

// =====================================================================
// G-R2 — dual-read twin: legacy inline block, SAME vector -> IDENTICAL node.embedding
// =====================================================================
const runGR2 = (next) => {
	const nodes = deserializedTaggedNodes('A', DIMS, [inlineNodeObject('A', 'a:1', VA)]);
	// legacy inline: deserialize decodes the base64 to node.embedding; no embeddingRef.
	if (!Array.isArray(nodes[0].embedding) || nodes[0].embeddingRef !== null) {
		bad('G-R2 legacy inline deserialize', `emb=${typeof nodes[0].embedding} ref=${nodes[0].embeddingRef}`);
		finish();
		return;
	}
	// resolveNodeVectors is a no-op for an inline node (it has an embedding, no ref) — run it to prove that.
	replayEngine.resolveNodeVectors(
		{ nodes, storeResolver: makeResolver({}), header: { embeddingDims: DIMS } },
		(resolveErr) => {
			if (resolveErr) {
				bad('G-R2 resolveNodeVectors no-op on inline', resolveErr);
				finish();
				return;
			}
			if (bytesEqual(nodes[0].embedding, gr1ResolvedEmbedding)) {
				ok('G-R2 dual-read twin: legacy inline embedding == ref-resolved embedding (byte-identical)');
			} else {
				bad('G-R2 dual-read byte-identical', `inline=${JSON.stringify(nodes[0].embedding)} refResolved=${JSON.stringify(gr1ResolvedEmbedding)}`);
			}
			next();
		},
	);
};

// =====================================================================
// G-R3 — missing-ref FAIL LOUD (RED) then GREEN after the vector is added
// =====================================================================
const runGR3 = (next) => {
	initStore('miss', (initErr, storeMiss) => {
		if (initErr) {
			bad('G-R3 init store', initErr);
			finish();
			return;
		}
		// RED: refMiss is not in the (empty) store
		const redNodes = deserializedTaggedNodes('A', DIMS, [refNodeObject('A', 'a:miss', refMiss)]);
		replayEngine.resolveNodeVectors(
			{ nodes: redNodes, storeResolver: makeResolver({ A: storeMiss }), header: { embeddingDims: DIMS } },
			(redErr) => {
				const namesRefAndStandard =
					!!redErr && `${redErr}`.indexOf(refMiss) !== -1 && /standard 'A'/.test(`${redErr}`);
				if (redErr && namesRefAndStandard) {
					ok('G-R3 RED: missing ref fails loud naming ref + standardKey', `${refMiss.slice(0, 12)}...`);
				} else {
					bad('G-R3 RED missing-ref fail-loud', `err=${redErr}`);
					finish();
					return;
				}
				// GREEN: add the vector, re-run on a FRESH node
				putV(storeMiss, 'DmeClass Missing', VMISS, (putErr) => {
					if (putErr) {
						bad('G-R3 putVector (green)', putErr);
						finish();
						return;
					}
					const greenNodes = deserializedTaggedNodes('A', DIMS, [refNodeObject('A', 'a:miss', refMiss)]);
					replayEngine.resolveNodeVectors(
						{ nodes: greenNodes, storeResolver: makeResolver({ A: storeMiss }), header: { embeddingDims: DIMS } },
						(greenErr) => {
							if (!greenErr && bytesEqual(greenNodes[0].embedding, VMISS)) {
								ok('G-R3 GREEN: after adding the vector, the ref resolves');
							} else {
								bad('G-R3 GREEN resolves', `err=${greenErr} emb=${JSON.stringify(greenNodes[0].embedding)}`);
							}
							next();
						},
					);
				});
			},
		);
	});
};

// =====================================================================
// G-R4 — multi-standard: each ref resolves against its OWN store; wrong-store cross-check FAILS LOUD
// =====================================================================
const runGR4 = (next) => {
	initStore('A4', (aErr, storeA) => {
		if (aErr) {
			bad('G-R4 init store A', aErr);
			finish();
			return;
		}
		initStore('B4', (bErr, storeB) => {
			if (bErr) {
				bad('G-R4 init store B', bErr);
				finish();
				return;
			}
			putV(storeA, 'DmeClass Alpha', VA, (putAErr) => {
				if (putAErr) {
					bad('G-R4 putVector A', putAErr);
					finish();
					return;
				}
				putV(storeB, 'DmeClass Bravo', VB, (putBErr) => {
					if (putBErr) {
						bad('G-R4 putVector B', putBErr);
						finish();
						return;
					}
					// two blocks, two standards, accumulate a flat node list (as replay() does)
					const nodesA = deserializedTaggedNodes('A', DIMS, [refNodeObject('A', 'a:1', refA)]);
					const nodesB = deserializedTaggedNodes('B', DIMS, [refNodeObject('B', 'b:1', refB)]);
					const nodes = [...nodesA, ...nodesB];
					replayEngine.resolveNodeVectors(
						{ nodes, storeResolver: makeResolver({ A: storeA, B: storeB }), header: { embeddingDims: DIMS } },
						(resolveErr) => {
							if (resolveErr) {
								bad('G-R4 multi-standard resolve', resolveErr);
								finish();
								return;
							}
							const nodeA = nodes.find((n) => n.ref.source === 'A');
							const nodeB = nodes.find((n) => n.ref.source === 'B');
							if (bytesEqual(nodeA.embedding, VA) && bytesEqual(nodeB.embedding, VB)) {
								ok('G-R4 each standard resolves against its RESPECTIVE per-standard store');
							} else {
								bad('G-R4 respective-store resolution', `A=${JSON.stringify(nodeA.embedding)} B=${JSON.stringify(nodeB.embedding)}`);
							}
							// wrong-store cross-check: A's ref resolved via store B (refA absent from B) -> fail loud
							const crossNodes = deserializedTaggedNodes('A', DIMS, [refNodeObject('A', 'a:1', refA)]);
							replayEngine.resolveNodeVectors(
								{ nodes: crossNodes, storeResolver: makeResolver({ A: storeB }), header: { embeddingDims: DIMS } },
								(crossErr) => {
									if (crossErr && `${crossErr}`.indexOf(refA) !== -1) {
										ok('G-R4 wrong-store cross-check: A ref via B store FAILS LOUD', `${refA.slice(0, 12)}...`);
									} else {
										bad('G-R4 wrong-store cross-check fail-loud', `err=${crossErr}`);
									}
									next();
								},
							);
						},
					);
				});
			});
		});
	});
};

// =====================================================================
// G-R5 — dims mismatch FAILS LOUD (RED) then GREEN with matching dims
// =====================================================================
const runGR5 = (next) => {
	initStore('dims', (initErr, storeDims) => {
		if (initErr) {
			bad('G-R5 init store', initErr);
			finish();
			return;
		}
		putV(storeDims, 'DmeClass Dims', VDIM, (putErr) => {
			if (putErr) {
				bad('G-R5 putVector', putErr);
				finish();
				return;
			}
			// RED: header declares 8 dims, the stored vector is 4 dims
			const redNodes = deserializedTaggedNodes('A', DIMS, [refNodeObject('A', 'a:dims', refDim)]);
			replayEngine.resolveNodeVectors(
				{ nodes: redNodes, storeResolver: makeResolver({ A: storeDims }), header: { embeddingDims: 8 } },
				(redErr) => {
					if (redErr && /mismatch/i.test(`${redErr}`)) {
						ok('G-R5 RED: resolved dims != header.embeddingDims fails loud', `${DIMS} != 8`);
					} else {
						bad('G-R5 RED dims-mismatch fail-loud', `err=${redErr}`);
						finish();
						return;
					}
					// GREEN: header dims match the stored vector
					const greenNodes = deserializedTaggedNodes('A', DIMS, [refNodeObject('A', 'a:dims', refDim)]);
					replayEngine.resolveNodeVectors(
						{ nodes: greenNodes, storeResolver: makeResolver({ A: storeDims }), header: { embeddingDims: DIMS } },
						(greenErr) => {
							if (!greenErr && bytesEqual(greenNodes[0].embedding, VDIM)) {
								ok('G-R5 GREEN: matching dims resolves');
							} else {
								bad('G-R5 GREEN resolves', `err=${greenErr} emb=${JSON.stringify(greenNodes[0].embedding)}`);
							}
							next();
						},
					);
				},
			);
		});
	});
};

// run the gates in sequence
runGR1(() => runGR2(() => runGR3(() => runGR4(() => runGR5(() => finish())))));
