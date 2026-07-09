#!/usr/bin/env node
'use strict';

// __TEST_cachingEmbedder.js — Phase-2 gate G1 (producer-side, graph-free). Proves the caching
// embedder's INTERNING against a stub embedder (counts every text it is asked to embed) and a REAL
// vector-store on a THROWAWAY temp sqlite. No graph, no docker, no production store, no network.
//
// Asserts PLAN §6.3: (b) embedder called EXACTLY once per DISTINCT input (interning), (c) the store
// holds exactly the distinct-input row count, (d) a fully-warm re-run makes ZERO embedder calls;
// plus vector correctness (float32-exact on both the miss path and the store-hit path) and a BITE
// check (the raw stub re-embeds a within-batch duplicate, so the decorator's distinct-only property
// is a real behavior change, not vacuously true).

const os = require('os');
const fs = require('fs');
const path = require('path');

// process.global is the DI channel these modules expect; sqlite-instance reads xLog + getConfig
// (mirrors __TEST_vectorStore.js / forge-store/test).
process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: () => {},
	result: () => {},
};
process.global.getConfig = process.global.getConfig || (() => ({}));

const vectorStoreFactory = require('../vector-store/vector-store');
const cachingEmbedderFactory = require('./caching-embedder');

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

// -----
// deterministic stub embedder — same formal interface as embedding-client. Records every text it is
// asked to embed (so the test can prove interning) and produces a deterministic 4-dim vector whose
// components are small exactly-float32-representable integers (byte-exact through the store).
const makeStubEmbedder = () => {
	const embeddedTexts = [];
	let callCount = 0;
	const vectorFor = (oneText) => {
		let charSum = 0;
		for (let i = 0; i < oneText.length; i++) charSum += oneText.charCodeAt(i);
		return Float32Array.from([
			oneText.length,
			charSum,
			oneText.charCodeAt(0),
			oneText.charCodeAt(oneText.length - 1),
		]);
	};
	const embedTexts = ({ texts }, callback) => {
		callCount++;
		texts.forEach((oneText) => embeddedTexts.push(`${oneText}`));
		callback('', {
			vectors: texts.map((oneText) => vectorFor(`${oneText}`)),
			embeddingModelVersion: 'voyage-4-large',
		});
	};
	const embedText = ({ text }, callback) =>
		embedTexts({ texts: [text] }, (err, result) =>
			err ? callback(err) : callback('', {
				vector: result.vectors[0],
				embeddingModelVersion: result.embeddingModelVersion,
			}),
		);
	return {
		embedText,
		embedTexts,
		encodeVector: () => '',
		decodeVector: () => new Float32Array(0),
		stampedModelVersion: 'voyage-4-large',
		// test probes:
		_embeddedTexts: embeddedTexts,
		_reset: () => {
			embeddedTexts.length = 0;
			callCount = 0;
		},
		_callCount: () => callCount,
		_vectorFor: vectorFor,
	};
};

const float32Equal = (a, b) => {
	if (!a || !b || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
	return true;
};

const dbPath = path.join(os.tmpdir(), `__TEST_cachingEmbedder_${process.pid}.sqlite3`);
const cleanup = () => {
	[dbPath, `${dbPath}-shm`, `${dbPath}-wal`].forEach((oneFile) => {
		if (fs.existsSync(oneFile)) fs.unlinkSync(oneFile);
	});
};
cleanup();

const vectorStore = vectorStoreFactory({});
const stub = makeStubEmbedder();

vectorStore.init({ dbPath }, (initErr) => {
	if (initErr) {
		bad('init store', initErr);
		finish();
		return;
	}
	ok('init store', dbPath);

	const cachingEmbedder = cachingEmbedderFactory({ embedder: stub, vectorStore });

	// interface preservation
	['embedText', 'embedTexts', 'encodeVector', 'decodeVector'].forEach((oneMember) => {
		if (typeof cachingEmbedder[oneMember] !== 'function') {
			bad('interface preserved', `${oneMember} missing`);
		}
	});
	if (cachingEmbedder.stampedModelVersion !== 'voyage-4-large') {
		bad('interface preserved', 'stampedModelVersion');
	} else {
		ok('interface preserved', 'embedText/embedTexts/encode/decode/stampedModelVersion present');
	}

	// batch 1: ['A','B','A'] — within-batch duplicate A; distinct {A,B}
	cachingEmbedder.embedTexts({ texts: ['A', 'B', 'A'] }, (err, result) => {
		if (err) {
			bad('batch1 embedTexts', err);
			finish();
			return;
		}
		// aligned 1:1, and the two A slots identical
		if (result.vectors.length === 3 && float32Equal(result.vectors[0], result.vectors[2])) {
			ok('batch1 aligned + dup slots identical', 'vectors[0]==vectors[2]');
		} else {
			bad('batch1 aligned + dup slots identical');
		}
		// vectors correct vs stub's deterministic value
		if (
			float32Equal(result.vectors[0], stub._vectorFor('A')) &&
			float32Equal(result.vectors[1], stub._vectorFor('B'))
		) {
			ok('batch1 vectors correct (float32-exact)');
		} else {
			bad('batch1 vectors correct (float32-exact)');
		}
		// interning within batch: stub embedded exactly ['A','B'] (A once), one call
		if (
			stub._embeddedTexts.length === 2 &&
			stub._embeddedTexts.includes('A') &&
			stub._embeddedTexts.includes('B') &&
			stub._callCount() === 1
		) {
			ok('batch1 interning: A embedded once, B once, 1 call', stub._embeddedTexts.join(','));
		} else {
			bad('batch1 interning', `${stub._embeddedTexts.join(',')} calls=${stub._callCount()}`);
		}

		// batch 2: ['B','C','A'] — B,A already stored (hits); only C is a miss
		cachingEmbedder.embedTexts({ texts: ['B', 'C', 'A'] }, (err2, result2) => {
			if (err2) {
				bad('batch2 embedTexts', err2);
				finish();
				return;
			}
			// only C newly embedded -> cumulative distinct embedded == {A,B,C}, each once
			const embeddedSorted = stub._embeddedTexts.slice().sort().join(',');
			if (embeddedSorted === 'A,B,C' && stub._embeddedTexts.length === 3) {
				ok('§6.3(b) interning: exactly one embed per DISTINCT input', embeddedSorted);
			} else {
				bad('§6.3(b) interning', embeddedSorted);
			}
			if (stub._callCount() === 2) {
				ok('batch2 made exactly ONE additional embed call (for C only)', 'calls=2');
			} else {
				bad('batch2 call count', `calls=${stub._callCount()}`);
			}
			// batch2 vectors correct: B,A from store (hit path), C fresh
			if (
				float32Equal(result2.vectors[0], stub._vectorFor('B')) &&
				float32Equal(result2.vectors[1], stub._vectorFor('C')) &&
				float32Equal(result2.vectors[2], stub._vectorFor('A'))
			) {
				ok('batch2 vectors correct incl. store-hit path (B,A) + fresh (C)');
			} else {
				bad('batch2 vectors correct');
			}

			// §6.3(c): store holds exactly the distinct-input row count (3)
			directRowCount(vectorStore, dbPath, (countErr, rowCount) => {
				if (countErr) {
					bad('§6.3(c) row count query', countErr);
					finish();
					return;
				}
				if (rowCount === 3) {
					ok('§6.3(c) store rows == distinct inputs', `rows=${rowCount}`);
				} else {
					bad('§6.3(c) store rows == distinct inputs', `rows=${rowCount}`);
				}

				// §6.3(d): fully-warm re-run makes ZERO embedder calls
				stub._reset();
				cachingEmbedder.embedTexts(
					{ texts: ['A', 'B', 'C', 'A'] },
					(err3, result3) => {
						if (err3) {
							bad('warm re-run embedTexts', err3);
							finish();
							return;
						}
						if (stub._callCount() === 0 && stub._embeddedTexts.length === 0) {
							ok('§6.3(d) fully-warm re-run: ZERO embedder calls', 'calls=0');
						} else {
							bad('§6.3(d) fully-warm re-run', `calls=${stub._callCount()}`);
						}
						// warm vectors still correct + aligned (A slots identical)
						if (
							float32Equal(result3.vectors[0], stub._vectorFor('A')) &&
							float32Equal(result3.vectors[2], stub._vectorFor('C')) &&
							float32Equal(result3.vectors[0], result3.vectors[3])
						) {
							ok('warm re-run vectors correct + aligned', 'all from store');
						} else {
							bad('warm re-run vectors correct + aligned');
						}

						// BITE: the raw stub, undecorated, re-embeds a within-batch duplicate — so the
						// decorator's distinct-only property is a REAL behavior change, not vacuous.
						const rawStub = makeStubEmbedder();
						rawStub.embedTexts({ texts: ['A', 'B', 'A'] }, () => {
							if (
								rawStub._embeddedTexts.length === 3 &&
								rawStub._embeddedTexts.filter((t) => t === 'A').length === 2
							) {
								ok('BITE: raw (undecorated) embedder re-embeds the duplicate', 'embedded 3 incl. A twice');
							} else {
								bad('BITE: raw embedder re-embeds the duplicate', rawStub._embeddedTexts.join(','));
							}
							finish();
						});
					},
				);
			});
		});
	});
});

// directRowCount — count rows in the vectors table by opening the same sqlite file read-only via the
// same sqlite-instance the store uses. Keeps the assertion honest (reads the real persisted table).
function directRowCount(store, dbFilePath, callback) {
	const sqliteInstance = require('../../../../server/data-model/lib/sqlite-instance/sqlite-instance');
	const { initDatabaseInstance } = sqliteInstance({ unused: true });
	initDatabaseInstance(dbFilePath, (err, dbInstance) => {
		if (err) {
			callback(err);
			return;
		}
		dbInstance.getTable('vectorStoreOps', { noTableNameOk: true, suppressStatementLog: true }, (tableErr, tableRef) => {
			if (tableErr) {
				callback(tableErr);
				return;
			}
			tableRef.getData(
				'SELECT COUNT(*) AS n FROM vectors;',
				{ noTableNameOk: true, suppressStatementLog: true },
				(dataErr, rows) => {
					if (dataErr) {
						callback(dataErr);
						return;
					}
					callback('', rows && rows[0] ? Number(rows[0].n) : 0);
				},
			);
		});
	});
}

function finish() {
	cleanup();
	console.log(
		`\n${failCount === 0 ? 'ALL CACHING-EMBEDDER CHECKS PASS' : 'CACHING-EMBEDDER CHECKS FAILED'} ` +
			`(${passCount} pass, ${failCount} fail)`,
	);
	process.exit(failCount === 0 ? 0 : 1);
}
