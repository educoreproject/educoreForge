#!/usr/bin/env node
'use strict';

// __TEST_extractEmbeddingRef.js — Phase-2 gates G2, G3, and the F7 consistency gate (producer-side,
// GRAPH-FREE). Drives the REAL exported extract functions (replay-engine.shapeNode /
// putDistinctNodeVectors) and the REAL serializeNodeLine against SYNTHETIC neo-node objects + a
// throwaway temp vector-store. No graph, no docker, no bolt.
//
// G2 — extract -> block format: shapeNode(emitEmbeddingRef) sets a 64-hex embeddingRef (NOT base64
//      embedding); the ref == contentAddress.vectorIdForInput(modelVersion, searchText); the store
//      holds exactly one row per DISTINCT searchText; the ref resolves via getVector.
// G3 — BITE: shapeNode with emitEmbeddingRef=FALSE emits the legacy base64 `embedding` and NO
//      embeddingRef, so the "embeddingRef not base64" property genuinely distinguishes the modes;
//      plus the dedup twin (two nodes, same searchText -> ONE row, SAME ref).
// F7 — the caching-embedder DECORATOR's stored vectorId for a searchText EQUALS the EXTRACT's
//      embeddingRef for the same (modelVersion, searchText), and the extract ref resolves against
//      the decorator-filled store. The two write paths address IDENTICALLY (standing gate).

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
const cachingEmbedderFactory = require('../embedding/caching-embedder');

const MODEL = 'voyage-4-large';
const header = {
	blockType: 'standard',
	standardKey: 'CEDS',
	stableUriPropertyName: 'uri',
	resolutionKey: 'uri',
	embeddingModelVersion: MODEL,
	embeddingEncoding: 'base64',
	embeddingDtype: 'float32',
	embeddingByteOrder: 'little-endian',
	embeddingDims: 1024,
};

// a synthetic neo-node as rec.get('n') would return it (plain JS values; neoToJs passes them through)
const neoNode = ({ uri, searchText, embedding, labels, name }) => ({
	labels: labels || ['DmeClass'],
	properties: { _source: 'CEDS', uri, stableId: uri, name: name || uri, searchText, embedding },
});

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
const isHex64 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

const dbPath = path.join(os.tmpdir(), `__TEST_extractEmbeddingRef_${process.pid}.sqlite3`);
const cleanup = () => {
	[dbPath, `${dbPath}-shm`, `${dbPath}-wal`].forEach((oneFile) => {
		if (fs.existsSync(oneFile)) fs.unlinkSync(oneFile);
	});
};
cleanup();

const directRowCount = (dbFilePath, callback) => {
	const sqliteInstance = require('../../../../server/data-model/lib/sqlite-instance/sqlite-instance');
	const { initDatabaseInstance } = sqliteInstance({ unused: true });
	initDatabaseInstance(dbFilePath, (err, dbInstance) => {
		if (err) return callback(err);
		dbInstance.getTable('vectorStoreOps', { noTableNameOk: true, suppressStatementLog: true }, (tableErr, tableRef) => {
			if (tableErr) return callback(tableErr);
			tableRef.getData(
				'SELECT COUNT(*) AS n FROM vectors;',
				{ noTableNameOk: true, suppressStatementLog: true },
				(dataErr, rows) => (dataErr ? callback(dataErr) : callback('', rows && rows[0] ? Number(rows[0].n) : 0)),
			);
		});
	});
};

const finish = () => {
	cleanup();
	console.log(
		`\n${failCount === 0 ? 'ALL EXTRACT-EMBEDDING-REF CHECKS PASS' : 'EXTRACT-EMBEDDING-REF CHECKS FAILED'} ` +
			`(${passCount} pass, ${failCount} fail)`,
	);
	process.exit(failCount === 0 ? 0 : 1);
};

const vectorStore = vectorStoreFactory({});

vectorStore.init({ dbPath }, (initErr) => {
	if (initErr) {
		bad('init store', initErr);
		finish();
		return;
	}
	ok('init store', dbPath);

	// three nodes: Alpha, Beta, and Alpha-dup (same searchText as Alpha, different node/labels)
	const rawAlpha = neoNode({ uri: 'ceds:a', searchText: 'DmeClass Alpha', embedding: [1, 2, 3, 4] });
	const rawBeta = neoNode({ uri: 'ceds:b', searchText: 'DmeClass Beta', embedding: [5, 6, 7, 8] });
	const rawAlphaDup = neoNode({
		uri: 'ceds:a2',
		searchText: 'DmeClass Alpha',
		embedding: [1, 2, 3, 4],
		labels: ['DmeField'],
	});

	// G2 — shapeNode in emitEmbeddingRef mode
	const shapedAlpha = replayEngine.shapeNode(rawAlpha, header, true);
	const shapedBeta = replayEngine.shapeNode(rawBeta, header, true);
	const shapedAlphaDup = replayEngine.shapeNode(rawAlphaDup, header, true);

	const expectedRefAlpha = contentAddress.vectorIdForInput(MODEL, 'DmeClass Alpha');

	if (isHex64(shapedAlpha.embeddingRef) && shapedAlpha.embedding === undefined) {
		ok('G2 shapeNode emits 64-hex embeddingRef, NOT base64 embedding', shapedAlpha.embeddingRef.slice(0, 12));
	} else {
		bad('G2 shapeNode emits embeddingRef not embedding', `ref=${shapedAlpha.embeddingRef} embedding=${shapedAlpha.embedding}`);
	}
	if (shapedAlpha.embeddingRef === expectedRefAlpha) {
		ok('G2 embeddingRef == vectorIdForInput(modelVersion, searchText)');
	} else {
		bad('G2 embeddingRef == vectorIdForInput', `${shapedAlpha.embeddingRef} != ${expectedRefAlpha}`);
	}
	// dedup twin (G3): same searchText -> same ref
	if (shapedAlpha.embeddingRef === shapedAlphaDup.embeddingRef) {
		ok('G3 dedup twin: same searchText -> same embeddingRef');
	} else {
		bad('G3 dedup twin: same searchText -> same embeddingRef');
	}

	// G2 — serializeNodeLine carries embeddingRef (64-hex), NOT base64 embedding
	const lineAlpha = JSON.parse(replayBlock.serializeNodeLine(shapedAlpha));
	if (isHex64(lineAlpha.embeddingRef) && lineAlpha.embedding === undefined && lineAlpha.embeddingModelVersion === MODEL) {
		ok('G2 serialized node line carries embeddingRef + modelVersion, no base64 embedding');
	} else {
		bad('G2 serialized node line format', JSON.stringify({ ref: lineAlpha.embeddingRef, emb: lineAlpha.embedding }));
	}

	// G3 BITE — with emitEmbeddingRef=FALSE, the SAME node serializes the legacy base64 embedding and
	// NO embeddingRef. This proves the "embeddingRef not base64" property above genuinely gates on the
	// mode (force base64 -> the G2 format assertion would go RED).
	const legacyAlpha = replayEngine.shapeNode(rawAlpha, header, false);
	const legacyLine = JSON.parse(replayBlock.serializeNodeLine(legacyAlpha));
	if (legacyAlpha.embeddingRef === undefined && typeof legacyLine.embedding === 'string' && legacyLine.embeddingRef === undefined) {
		ok('G3 BITE: emitEmbeddingRef=false emits legacy base64 embedding, no embeddingRef', 'the format assertion is real');
	} else {
		bad('G3 BITE: legacy mode still emits base64', JSON.stringify({ ref: legacyAlpha.embeddingRef, emb: typeof legacyLine.embedding }));
	}

	// G2 — putDistinctNodeVectors: exactly one row per DISTINCT searchText (Alpha, Beta; Alpha-dup dedups)
	replayEngine.putDistinctNodeVectors(
		{ nodes: [shapedAlpha, shapedBeta, shapedAlphaDup], vectorStore },
		(putErr) => {
			if (putErr) {
				bad('G2 putDistinctNodeVectors', putErr);
				finish();
				return;
			}
			// carrier fields stripped after persistence
			if (shapedAlpha._sidecarVector === undefined && shapedAlpha._sidecarInputText === undefined) {
				ok('G2 putDistinctNodeVectors strips the non-serialized carrier fields');
			} else {
				bad('G2 carrier fields stripped');
			}
			directRowCount(dbPath, (countErr, rowCount) => {
				if (countErr) {
					bad('G2 row count', countErr);
					finish();
					return;
				}
				if (rowCount === 2) {
					ok('G2 store holds one row per DISTINCT searchText', `rows=${rowCount} (Alpha,Beta; Alpha-dup deduped)`);
				} else {
					bad('G2 store rows per distinct searchText', `rows=${rowCount}`);
				}
				// G2 — the ref resolves
				vectorStore.getVector({ vectorId: expectedRefAlpha }, (getErr, record) => {
					if (getErr) {
						bad('G2 getVector(embeddingRef) resolves', getErr);
						finish();
						return;
					}
					if (record && Array.isArray(record.vector) && record.vector.length === 4) {
						ok('G2 embeddingRef resolves via getVector', `dims=${record.vector.length}`);
					} else {
						bad('G2 embeddingRef resolves via getVector', `record=${!!record}`);
					}
					runStackSafety(runF7Gate);
				});
			});
		},
	);

	// STACK-SAFETY — putDistinctNodeVectors over MANY distinct vectors must complete without a stack
	// overflow (the sqlite-instance callback is synchronous; a naive per-vector recursion would grow
	// the stack by one frame per row — thousands deep on a real standard). Proven, not asserted.
	function runStackSafety(done) {
		const bigCount = 6000;
		const bigNodes = [];
		for (let n = 0; n < bigCount; n++) {
			bigNodes.push(
				replayEngine.shapeNode(
					neoNode({ uri: `ceds:big:${n}`, searchText: `DmeClass Big ${n}`, embedding: [n, n + 1, n + 2, n + 3] }),
					header,
					true,
				),
			);
		}
		const bigDbPath = path.join(os.tmpdir(), `__TEST_extractEmbeddingRef_BIG_${process.pid}.sqlite3`);
		[bigDbPath, `${bigDbPath}-shm`, `${bigDbPath}-wal`].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f));
		const bigStore = vectorStoreFactory({});
		bigStore.init({ dbPath: bigDbPath }, (bigInitErr) => {
			if (bigInitErr) {
				bad('stack-safety init store', bigInitErr);
				finish();
				return;
			}
			replayEngine.putDistinctNodeVectors({ nodes: bigNodes, vectorStore: bigStore }, (bigErr) => {
				if (bigErr) {
					bad('stack-safety putDistinctNodeVectors', bigErr);
					finish();
					return;
				}
				directRowCount(bigDbPath, (bigCountErr, bigRows) => {
					[bigDbPath, `${bigDbPath}-shm`, `${bigDbPath}-wal`].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f));
					if (bigCountErr) {
						bad('stack-safety row count', bigCountErr);
						finish();
						return;
					}
					if (bigRows === bigCount) {
						ok('stack-safe: putDistinctNodeVectors over 6000 distinct vectors completed', `rows=${bigRows}, no overflow`);
					} else {
						bad('stack-safety row count', `rows=${bigRows} != ${bigCount}`);
					}
					done();
				});
			});
		});
	}

	// F7 — decorator vectorId == extract embeddingRef, on a SEPARATE fresh store, and the extract ref
	// resolves against the decorator-filled store (the two write paths address identically).
	function runF7Gate() {
		const f7DbPath = path.join(os.tmpdir(), `__TEST_extractEmbeddingRef_F7_${process.pid}.sqlite3`);
		[f7DbPath, `${f7DbPath}-shm`, `${f7DbPath}-wal`].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f));

		const stubEmbedder = {
			embedText: (params, cb) => cb('', { vector: Float32Array.from([9, 9, 9, 9]), embeddingModelVersion: MODEL }),
			embedTexts: ({ texts }, cb) =>
				cb('', { vectors: texts.map(() => Float32Array.from([9, 9, 9, 9])), embeddingModelVersion: MODEL }),
			encodeVector: () => '',
			decodeVector: () => new Float32Array(0),
			stampedModelVersion: MODEL,
		};
		const f7Store = vectorStoreFactory({});
		f7Store.init({ dbPath: f7DbPath }, (f7InitErr) => {
			if (f7InitErr) {
				bad('F7 init store', f7InitErr);
				finish();
				return;
			}
			const decorator = cachingEmbedderFactory({ embedder: stubEmbedder, vectorStore: f7Store });
			const searchTexts = ['DmeClass Alpha', 'DmeClass Beta', 'DmeField Gamma'];
			decorator.embedTexts({ texts: searchTexts }, (decErr) => {
				if (decErr) {
					bad('F7 decorator embedTexts', decErr);
					finish();
					return;
				}
				// for each searchText: the decorator stored under vectorIdForInput(MODEL, st); the
				// extract (shapeNode) computes the SAME embeddingRef. Assert equality + resolvability.
				let allMatch = true;
				const checkNext = (i) => {
					if (i >= searchTexts.length) {
						if (allMatch) {
							ok('F7 decorator vectorId == extract embeddingRef for every input', searchTexts.length + ' inputs');
						}
						[f7DbPath, `${f7DbPath}-shm`, `${f7DbPath}-wal`].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f));
						finish();
						return;
					}
					const st = searchTexts[i];
					const decoratorVectorId = contentAddress.vectorIdForInput(MODEL, st);
					const shaped = replayEngine.shapeNode(
						neoNode({ uri: `ceds:${i}`, searchText: st, embedding: [1, 1, 1, 1] }),
						header,
						true,
					);
					if (shaped.embeddingRef !== decoratorVectorId) {
						allMatch = false;
						bad('F7 vectorId mismatch', `extract=${shaped.embeddingRef} decorator=${decoratorVectorId} (st="${st}")`);
						finish();
						return;
					}
					// the extract ref resolves against the DECORATOR-filled store
					f7Store.getVector({ vectorId: shaped.embeddingRef }, (rErr, rec) => {
						if (rErr || !rec) {
							allMatch = false;
							bad('F7 extract ref resolves against decorator store', rErr || 'no record');
							finish();
							return;
						}
						checkNext(i + 1);
					});
				};
				checkNext(0);
			});
		});
	}
});
