'use strict';

// test-vector-store.js — ⟪campaign P3, W-C-12 (V1-S115/S116/S117/S119, V1-C43)⟫ vector addressing and integrity. Before
// this suite lib/vector-store had none: its refusals were untwinned, its id ignored the vector's width, and its dedup
// trusted the id alone.
//
//   a  the same (model, text) at 512 and at 1024 dims are TWO rows with distinct ids (grammar 1 made them one, and the
//      first write won)
//   b  a corrupted vector blob is refused on read, naming vectorHash; a wrong dtype is refused on read
//   c  a put under an existing address with DIFFERENT bytes is refused (the store already holds a different answer)
//   d  embeddingRefGrammar is required on put: 1 (a pre-P3 block re-harvested) and 2 mint the two grammars' ids, and
//      anything else is refused by name; a grammar-1 row still reads back verified (historical stores stay readable)
//
// RED TWINS (in memory, vector-store double): dimsLeftOutOfTheId -> a red; payloadRehashSkipped -> b red;
// putHashCompareSkipped -> c red; grammarAcceptedUnchecked -> d red.
//
// Hermetic: scratch sqlite files under the OS temp dir; every store callback is delivered on a fresh stack (the store
// answers synchronously from inside its own error handling — test-gVecProp records why).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- W-C-12: vector ids carry the width; the store verifies payloads on read and on dedup

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { loadBuildJsDouble } = require(path.join(__dirname, '..', '..', 'bridge-framework', 'test', 'testSupport', 'bridgeTwinFactories'));
const contentAddress = require('../../content-address/content-address')();

const STORE_PATH = path.join(__dirname, '..', 'vector-store.js');
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'p3VectorStore-'));
let scratchCount = 0;
const vectorOf = (seed, dims) => Array.from({ length: dims }, (unused, position) => (position + seed) / dims);

// a scratch store, its callbacks hopped onto fresh stacks; storeMutationList compiles the module through the double
const openStore = (storeMutationList, done) => {
	scratchCount += 1;
	const dbPath = path.join(scratchRootPath, `vectors_${process.pid}_${scratchCount}.sqlite3`);
	const storeModule = storeMutationList.length ? loadBuildJsDouble({ buildJsPath: STORE_PATH, mutationList: storeMutationList }) : require(STORE_PATH);
	const realStore = storeModule({});
	realStore.init({ dbPath }, (initError) => setImmediate(() => {
		const store = {
			putVector: (entry, putDone) => realStore.putVector(entry, (putError, putResult) => setImmediate(() => putDone(putError, putResult))),
			getVector: (query, getDone) => realStore.getVector(query, (getError, record) => setImmediate(() => getDone(getError, record))),
		};
		done(initError, store, dbPath);
	}));
};
const rawUpdate = (dbPath, sqlText, parameterList) => {
	const database = new Database(dbPath);
	database.prepare(sqlText).run(...parameterList);
	database.close();
};

const judgeByConjunct = {
	a_widthIsInTheAddress: (storeMutationList, done) =>
		openStore(storeMutationList, (openError, store) => {
			store.putVector({ modelVersion: 'm1', inputText: 'same text', vector: vectorOf(1, 512), embeddingRefGrammar: 2 }, (narrowError, narrow) =>
				store.putVector({ modelVersion: 'm1', inputText: 'same text', vector: vectorOf(1, 1024), embeddingRefGrammar: 2 }, (wideError, wide) =>
					store.getVector({ vectorId: (wide || {}).vectorId }, (getError, record) => {
						const pass = !openError && !narrowError && !wideError && !getError && narrow.vectorId !== wide.vectorId && wide.deduped === false && record && record.dims === 1024;
						done({ pass, detail: openError || narrowError || wideError || getError || `512 → ${String((narrow || {}).vectorId).slice(0, 12)}, 1024 → ${String((wide || {}).vectorId).slice(0, 12)} (deduped ${(wide || {}).deduped}); read back ${record ? record.dims : 'nothing'} dims` });
					})));
		}),
	b_corruptRowsRefusedOnRead: (storeMutationList, done) =>
		openStore(storeMutationList, (openError, store, dbPath) => {
			store.putVector({ modelVersion: 'm1', inputText: 'blob text', vector: vectorOf(2, 8), embeddingRefGrammar: 2 }, (putError, blobRow) =>
				store.putVector({ modelVersion: 'm1', inputText: 'dtype text', vector: vectorOf(3, 8), embeddingRefGrammar: 2 }, (secondError, dtypeRow) => {
					const flippedBlob = Buffer.from(Float32Array.from(vectorOf(9, 8)).buffer);
					rawUpdate(dbPath, 'UPDATE vectors SET vector = ? WHERE vectorId = ?', [flippedBlob, blobRow.vectorId]);
					rawUpdate(dbPath, 'UPDATE vectors SET dtype = ? WHERE vectorId = ?', ['float64', dtypeRow.vectorId]);
					store.getVector({ vectorId: blobRow.vectorId }, (blobError) =>
						store.getVector({ vectorId: dtypeRow.vectorId }, (dtypeError) => {
							const pass = !openError && !putError && !secondError && /payload verification failed .* expected/.test(blobError || '') && /dtype 'float64'/.test(dtypeError || '');
							done({ pass, detail: `blob: ${String(blobError || 'SERVED').slice(0, 120)} | dtype: ${String(dtypeError || 'SERVED').slice(0, 80)}` });
						}));
				}));
		}),
	c_differentBytesUnderOneAddressRefused: (storeMutationList, done) =>
		openStore(storeMutationList, (openError, store) =>
			store.putVector({ modelVersion: 'm1', inputText: 'one answer', vector: vectorOf(4, 8), embeddingRefGrammar: 2 }, (firstError) =>
				store.putVector({ modelVersion: 'm1', inputText: 'one answer', vector: vectorOf(5, 8), embeddingRefGrammar: 2 }, (secondError, second) => {
					const pass = !openError && !firstError && /hashes to a different vector .* the store already holds a different answer/.test(secondError || '');
					done({ pass, detail: secondError || `ADMITTED (deduped ${(second || {}).deduped})` });
				}))),
	d_grammarRequiredAndBothRead: (storeMutationList, done) =>
		openStore(storeMutationList, (openError, store) =>
			store.putVector({ modelVersion: 'm1', inputText: 'legacy text', vector: vectorOf(6, 8), embeddingRefGrammar: 1 }, (legacyError, legacy) =>
				store.putVector({ modelVersion: 'm1', inputText: 'unnamed grammar', vector: vectorOf(7, 8) }, (missingError) =>
					store.getVector({ vectorId: (legacy || {}).vectorId }, (readError, record) => {
						const pass = !openError && !legacyError && (legacy || {}).vectorId === contentAddress.versionOneVectorIdForInput('m1', 'legacy text')
							&& /embeddingRefGrammar undefined is neither 1/.test(missingError || '') && !readError && record && record.inputText === 'legacy text';
						done({ pass, detail: `legacy ${String((legacy || {}).vectorId).slice(0, 12)} read ${readError || (record ? 'verified' : 'absent')}; missing grammar: ${missingError || 'ADMITTED'}` });
					})))),
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_widthIsInTheAddress', twinName: 'dimsLeftOutOfTheId', find: '? vectorIdForInput({ modelVersion, embeddingDims: dims, inputText })', replace: '? versionOneVectorIdForInput(modelVersion, inputText)' },
	{ conjunctRefId: 'b_corruptRowsRefusedOnRead', twinName: 'payloadRehashSkipped', find: '					if (recomputedHash !== row.vectorHash) {', replace: '					if (false) {' },
	{ conjunctRefId: 'c_differentBytesUnderOneAddressRefused', twinName: 'putHashCompareSkipped', find: '					if (args.rows[0].vectorHash !== vectorHash) {', replace: '					if (false) {' },
	{ conjunctRefId: 'd_grammarRequiredAndBothRead', twinName: 'grammarAcceptedUnchecked', find: '			if (embeddingRefGrammar !== 1 && embeddingRefGrammar !== 2) {', replace: '			if (false) {' },
];

const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
harness.section('BASELINE — the real store passes every conjunct');
runSequence(
	Object.keys(judgeByConjunct).map((conjunctRefId) => (stepDone) => judgeByConjunct[conjunctRefId]([], (verdict) => { harness.ok(`${conjunctRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each conjunct OBSERVED RED under a vector-store double');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) => {
				const mutation = { modulePath: STORE_PATH, find: oneTwin.find, replace: oneTwin.replace };
				moduleDouble.assertMutationApplies(mutation);
				// the module opens with a shebang line, which a compiled double cannot carry; dropping it changes no behaviour
				const shebangMutation = { modulePath: STORE_PATH, find: '#!/usr/bin/env node\n', replace: '' };
				judgeByConjunct[oneTwin.conjunctRefId]([shebangMutation, mutation], (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail.slice(0, 200)}`);
					stepDone();
				});
			}),
			() => {
				fs.rmSync(scratchRootPath, { recursive: true, force: true });
				harness.report();
			},
		);
	},
);
