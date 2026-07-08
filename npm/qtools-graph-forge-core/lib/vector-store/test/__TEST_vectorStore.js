#!/usr/bin/env node
'use strict';

// __TEST_vectorStore — standalone, graph-free bite driver for the embedding sidecar vector store
// (AMBER_FORGE, Phase 1). Proves the module-level properties AND that its guards BITE:
//   * happy path: put -> has -> get round-trips at float32 precision, metadata intact
//   * DEDUP twin: same (modelVersion, inputText) put twice -> exactly ONE row, same vectorId
//   * VERIFY-ON-READ twins (each shown RED-on-fault THEN GREEN-on-restore):
//       (payload)     flip a stored vector byte     -> getVector REFUSES (vectorHash mismatch)
//       (determinant) tamper stored inputText       -> getVector REFUSES (vectorId mismatch)
//       (structural)  wrong stored dims             -> getVector REFUSES (length guard)
// Runs on a THROWAWAY temp sqlite (os.tmpdir); the live forgeStore.sqlite3 is never touched.
// Corruption is injected through a SECOND raw sqlite-instance handle (WAL — committed writes are
// visible across connections), while the behavior under test runs the REAL vector-store module.

const fs = require('fs');
const os = require('os');
const path = require('path');

// minimal process.global — the responsible app injects this in production; sqlite-instance reads
// process.global.xLog and getConfig(moduleName). Mirrors forge-store/test/test.js.
process.global = process.global || {};
const noop = () => {};
process.global.xLog = process.global.xLog || {
	status: noop,
	error: (msg) => console.error(`xLog.error: ${msg}`),
	result: noop,
	verbose: noop,
};
process.global.getConfig = process.global.getConfig || (() => ({}));

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const vectorStore = require('../vector-store')();
const contentAddress = require('../../content-address/content-address')();
const sqliteInstance = require('../../../../../server/data-model/lib/sqlite-instance/sqlite-instance');

// -----
const rawOpts = { noTableNameOk: true, suppressStatementLog: true };
const dbPath = path.join(os.tmpdir(), `__TEST_vectorStore_${process.pid}.sqlite3`);

const cleanupFiles = () => {
	['', '-wal', '-shm'].forEach((suffix) => {
		const target = `${dbPath}${suffix}`;
		if (fs.existsSync(target)) {
			fs.unlinkSync(target);
		}
	});
};

const encode = (vals) => {
	const buf = Buffer.allocUnsafe(vals.length * 4);
	for (let i = 0; i < vals.length; i++) {
		buf.writeFloatLE(vals[i], i * 4);
	}
	return buf;
};
const fr = (arr) => arr.map((value) => Math.fround(value));
// Object.is (not ===) so the edge floats compare correctly: NaN === NaN is false but
// Object.is(NaN, NaN) is true, and Object.is distinguishes -0 from +0 (the point of the -0 fixture).
const sameNumbers = (a, b) =>
	Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

const NUL = String.fromCharCode(0);

const results = [];
const check = (name, pass, detail) => {
	results.push({ name, pass });
	console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

// fixture
const modelVersion = 'voyage-4-large';
const inputText = 'role|name|structural-context-alpha'; // no quotes -> easy inline raw restore
// includes float EDGE cases (QUIET_ECHO closeout item 2): NaN, +Infinity, -Infinity, -0 — a
// STANDING regression that they round-trip through the float32 BLOB (compared via Object.is).
const inputVector = [0.1, -0.25, 3.5, 0.0, -1.0, 123.456, 1e-6, -0.0009765625, NaN, Infinity, -Infinity, -0];
const expectedVectorId = contentAddress.vectorIdForInput(modelVersion, inputText);
const originalBuffer = encode(inputVector);
const originalHex = originalBuffer.toString('hex');
const expectedVectorHash = contentAddress.vectorHashForBytes(originalBuffer);

// =====================================================================

cleanupFiles();

const vs = vectorStore;
let raw; // second raw sqlite-instance handle for count + corruption injection

const rawGet = (sql, cb) => raw.getData(sql, rawOpts, cb);
const rawRun = (sql, cb) => raw.runStatement(sql, rawOpts, cb);

const taskList = new taskListPlus();

// --- init the module store
taskList.push((args, next) => {
	vs.init({ dbPath }, (err) => {
		check('init store', !err, err ? String(err) : dbPath);
		next(err, args);
	});
});

// --- open a second raw handle on the same file
taskList.push((args, next) => {
	const { initDatabaseInstance } = sqliteInstance({ unused: true });
	initDatabaseInstance(dbPath, (err, dbInstance) => {
		if (err) {
			next(err, args);
			return;
		}
		dbInstance.getTable('vectorStoreOps', rawOpts, (err2, handle) => {
			raw = handle;
			next(err2, args);
		});
	});
});

// --- happy path: putVector
taskList.push((args, next) => {
	vs.putVector({ modelVersion, inputText, vector: inputVector }, (err, result) => {
		const ok =
			!err && result && result.vectorId === expectedVectorId && result.deduped === false;
		check('putVector returns expected vectorId, deduped=false', ok,
			err ? String(err) : `${(result || {}).vectorId} deduped=${(result || {}).deduped}`);
		next(err, args);
	});
});

// --- hasVector true
taskList.push((args, next) => {
	vs.hasVector({ vectorId: expectedVectorId }, (err, present) => {
		check('hasVector true for stored id', !err && present === true, err ? String(err) : `present=${present}`);
		next(err, args);
	});
});

// --- getVector round-trips
taskList.push((args, next) => {
	vs.getVector({ vectorId: expectedVectorId }, (err, record) => {
		const ok =
			!err &&
			record &&
			record.vectorId === expectedVectorId &&
			record.modelVersion === modelVersion &&
			record.inputText === inputText &&
			record.dims === inputVector.length &&
			record.dtype === 'float32' &&
			record.vectorHash === expectedVectorHash &&
			sameNumbers(record.vector, fr(inputVector));
		check('getVector round-trips (float32 exact) + metadata', ok,
			err ? String(err) : `dims=${(record || {}).dims}`);
		next(err, args);
	});
});

// --- DEDUP: second identical put -> deduped=true, same id
taskList.push((args, next) => {
	vs.putVector({ modelVersion, inputText, vector: inputVector }, (err, result) => {
		const ok = !err && result && result.vectorId === expectedVectorId && result.deduped === true;
		check('putVector twice -> deduped=true, same vectorId', ok,
			err ? String(err) : `deduped=${(result || {}).deduped}`);
		next(err, args);
	});
});

// --- DEDUP: exactly one row
taskList.push((args, next) => {
	rawGet('SELECT count(*) AS n FROM vectors;', (err, rows) => {
		const n = rows && rows[0] ? Number(rows[0].n) : -1;
		check('dedup: exactly ONE row in vectors', !err && n === 1, err ? String(err) : `count=${n}`);
		next(err, args);
	});
});

// --- PAYLOAD corruption RED: flip one stored vector byte -> getVector refuses
taskList.push((args, next) => {
	const corrupt = Buffer.from(originalBuffer);
	corrupt[0] = corrupt[0] ^ 0xff;
	rawRun(`UPDATE vectors SET vector=X'${corrupt.toString('hex')}' WHERE vectorId='${expectedVectorId}';`, (err) => {
		if (err) { next(err, args); return; }
		vs.getVector({ vectorId: expectedVectorId }, (getErr, record) => {
			const refused = !!getErr && (record === undefined || record === null);
			check('RED payload-corrupt: getVector REFUSES (vectorHash mismatch)', refused,
				getErr ? String(getErr).slice(0, 80) : 'NO ERROR — did not refuse');
			next('', args);
		});
	});
});

// --- PAYLOAD restore GREEN
taskList.push((args, next) => {
	rawRun(`UPDATE vectors SET vector=X'${originalHex}' WHERE vectorId='${expectedVectorId}';`, (err) => {
		if (err) { next(err, args); return; }
		vs.getVector({ vectorId: expectedVectorId }, (getErr, record) => {
			const ok = !getErr && record && sameNumbers(record.vector, fr(inputVector));
			check('GREEN payload-restored: getVector returns correct vector', ok, getErr ? String(getErr) : '');
			next('', args);
		});
	});
});

// --- DETERMINANT corruption RED: tamper stored inputText -> getVector refuses
taskList.push((args, next) => {
	rawRun(`UPDATE vectors SET inputText='TAMPERED-DIFFERENT-INPUT' WHERE vectorId='${expectedVectorId}';`, (err) => {
		if (err) { next(err, args); return; }
		vs.getVector({ vectorId: expectedVectorId }, (getErr, record) => {
			const refused = !!getErr && (record === undefined || record === null);
			check('RED determinant-corrupt: getVector REFUSES (vectorId mismatch)', refused,
				getErr ? String(getErr).slice(0, 80) : 'NO ERROR — did not refuse');
			next('', args);
		});
	});
});

// --- DETERMINANT restore GREEN
taskList.push((args, next) => {
	rawRun(`UPDATE vectors SET inputText='${inputText}' WHERE vectorId='${expectedVectorId}';`, (err) => {
		if (err) { next(err, args); return; }
		vs.getVector({ vectorId: expectedVectorId }, (getErr, record) => {
			const ok = !getErr && record && record.inputText === inputText;
			check('GREEN determinant-restored: getVector ok', ok, getErr ? String(getErr) : '');
			next('', args);
		});
	});
});

// --- STRUCTURAL corruption RED: wrong stored dims -> getVector refuses (length guard, checked first)
taskList.push((args, next) => {
	rawRun(`UPDATE vectors SET dims=7 WHERE vectorId='${expectedVectorId}';`, (err) => {
		if (err) { next(err, args); return; }
		vs.getVector({ vectorId: expectedVectorId }, (getErr, record) => {
			const refused = !!getErr && (record === undefined || record === null);
			check('RED structural-corrupt: getVector REFUSES (length != dims*4)', refused,
				getErr ? String(getErr).slice(0, 80) : 'NO ERROR — did not refuse');
			next('', args);
		});
	});
});

// --- STRUCTURAL restore GREEN
taskList.push((args, next) => {
	rawRun(`UPDATE vectors SET dims=${inputVector.length} WHERE vectorId='${expectedVectorId}';`, (err) => {
		if (err) { next(err, args); return; }
		vs.getVector({ vectorId: expectedVectorId }, (getErr, record) => {
			const ok = !getErr && record && record.dims === inputVector.length;
			check('GREEN structural-restored: getVector ok', ok, getErr ? String(getErr) : '');
			next('', args);
		});
	});
});

// --- required-field guard: empty vector refused loudly (no SQL)
taskList.push((args, next) => {
	vs.putVector({ modelVersion, inputText, vector: [] }, (err, result) => {
		check('putVector empty vector -> refused', !!err && !result, err ? String(err).slice(0, 60) : 'NO ERROR');
		next('', args);
	});
});

// --- NUL guard (unit): vectorIdForInput THROWS on a NUL-containing determinant (load-bearing;
//     every later phase recomputes against it)
taskList.push((args, next) => {
	let threw = false;
	try {
		contentAddress.vectorIdForInput('voyage-4-large', 'x' + NUL + 'y');
	} catch (thrownError) {
		threw = /must not contain a NUL/.test(thrownError.message);
	}
	check('vectorIdForInput THROWS on NUL in a determinant', threw, threw ? '' : 'did NOT throw');
	next('', args);
});

// --- NUL guard (write side): NUL in inputText -> putVector refuses, no data
taskList.push((args, next) => {
	vs.putVector({ modelVersion, inputText: 'has' + NUL + 'nul', vector: inputVector }, (err, result) => {
		check('putVector NUL in inputText -> refused', !!err && !result, err ? String(err).slice(0, 70) : 'NO ERROR — did not refuse');
		next('', args);
	});
});

// --- NUL guard (write side): NUL in modelVersion -> putVector refuses, no data
taskList.push((args, next) => {
	vs.putVector({ modelVersion: modelVersion + NUL, inputText: 'clean-input', vector: inputVector }, (err, result) => {
		check('putVector NUL in modelVersion -> refused', !!err && !result, err ? String(err).slice(0, 70) : 'NO ERROR — did not refuse');
		next('', args);
	});
});

// --- NUL guard (read side): a NUL directly injected into a stored determinant -> getVector REFUSES
//     loudly WITHOUT letting vectorIdForInput throw uncaught. Injected via CAST(X'<hex>' AS TEXT)
//     so the NUL byte lands inside the stored TEXT. Self-validates the NUL actually stored first.
//     (This is the LAST check — it corrupts the happy-path row.)
taskList.push((args, next) => {
	const tamperedHex = Buffer.from('a' + NUL + 'b', 'utf8').toString('hex');
	rawRun(`UPDATE vectors SET inputText=CAST(X'${tamperedHex}' AS TEXT) WHERE vectorId='${expectedVectorId}';`, (err) => {
		if (err) { next(err, args); return; }
		rawGet(`SELECT inputText FROM vectors WHERE vectorId='${expectedVectorId}';`, (selErr, rows) => {
			const stored = rows && rows[0] ? String(rows[0].inputText) : '';
			const nulActuallyStored = stored.indexOf(NUL) !== -1;
			vs.getVector({ vectorId: expectedVectorId }, (getErr, record) => {
				const refused = !!getErr && (record === undefined || record === null);
				// only a meaningful assertion if the injection truly embedded a NUL
				check('RED NUL-in-stored-determinant: getVector REFUSES (no throw leak)',
					nulActuallyStored ? refused : true,
					nulActuallyStored ? (getErr ? String(getErr).slice(0, 70) : 'NO ERROR / THREW') : 'SKIPPED — SQLite did not store an embedded NUL');
				next('', args);
			});
		});
	});
});

pipeRunner(taskList.getList(), {}, (err) => {
	cleanupFiles();
	if (err) {
		console.log(`\nDRIVER ERROR: ${err}`);
		process.exit(1);
	}
	const failed = results.filter((r) => !r.pass);
	console.log(`\n${failed.length === 0 ? 'ALL VECTOR-STORE CHECKS PASS' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
	process.exit(failed.length === 0 ? 0 : 1);
});
