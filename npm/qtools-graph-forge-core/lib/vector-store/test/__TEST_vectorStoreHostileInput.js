#!/usr/bin/env node
'use strict';

// __TEST_vectorStoreHostileInput — REQUIRED hostile-inputText round-trip + SQL-injection proof
// (AMBER_FORGE, Phase 1; mandated by QUIET_ECHO). Because sqlite-instance runs pure string SQL
// with NO parameter binding, inputText (it is searchText — quotes, newlines, backslashes,
// unicode) must be persisted injection-safe AND read back BYTE-IDENTICAL. This exercises the REAL
// module against an inputText containing single/double quotes, a newline, a backslash, unicode,
// and a literal SQL-injection probe  '); DROP TABLE vectors;--  and proves:
//   (a) inputText round-trips byte-identical (===),
//   (b) the injection does NOT execute — the vectors table survives and an earlier benign row is
//       still present (a successful DROP would have wiped it),
//   (c) vectorId matches the shared content-address rule and the vector round-trips.
// Throwaway temp sqlite; the live forgeStore.sqlite3 is never touched.

const fs = require('fs');
const os = require('os');
const path = require('path');

// minimal process.global (mirrors forge-store/test/test.js)
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

const rawOpts = { noTableNameOk: true, suppressStatementLog: true };
const dbPath = path.join(os.tmpdir(), `__TEST_vectorStoreHostile_${process.pid}.sqlite3`);

const cleanupFiles = () => {
	['', '-wal', '-shm'].forEach((suffix) => {
		const target = `${dbPath}${suffix}`;
		if (fs.existsSync(target)) {
			fs.unlinkSync(target);
		}
	});
};

const results = [];
const check = (name, pass, detail) => {
	results.push({ name, pass });
	console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

// Build the hostile inputText from explicit char codes where an escape might be normalized —
// robustly gets a real newline (10) and backslash (92) into the string. Unicode + quotes + the
// injection probe are literal.
const NL = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);
const hostileInput = [
	"o'brien announced: ",
	'"drop the vectors"',
	NL,
	'line2' + BACKSLASH + 'escaped',
	' café résumé — 日本語 😀 ',
	"'); DROP TABLE vectors;--",
].join('');

const benignInput = 'role|name|benign-canary-row';
const modelVersion = 'voyage-4-large';
const inputVector = [0.5, -0.5, 2.0, -3.25, 0.015625];

const expectedHostileId = contentAddress.vectorIdForInput(modelVersion, hostileInput);
const expectedBenignId = contentAddress.vectorIdForInput(modelVersion, benignInput);

cleanupFiles();

const vs = vectorStore;
let raw;
const rawGet = (sql, cb) => raw.getData(sql, rawOpts, cb);

const taskList = new taskListPlus();

taskList.push((args, next) => {
	vs.init({ dbPath }, (err) => {
		check('init store', !err, err ? String(err) : '');
		next(err, args);
	});
});

taskList.push((args, next) => {
	const { initDatabaseInstance } = sqliteInstance({ unused: true });
	initDatabaseInstance(dbPath, (err, dbInstance) => {
		if (err) { next(err, args); return; }
		dbInstance.getTable('vectorStoreOps', rawOpts, (err2, handle) => {
			raw = handle;
			next(err2, args);
		});
	});
});

// benign canary row FIRST — a successful DROP TABLE later would wipe it
taskList.push((args, next) => {
	vs.putVector({ modelVersion, inputText: benignInput, vector: inputVector }, (err, result) => {
		check('put benign canary row', !err && result && result.vectorId === expectedBenignId, err ? String(err) : '');
		next(err, args);
	});
});

// the hostile put
taskList.push((args, next) => {
	vs.putVector({ modelVersion, inputText: hostileInput, vector: inputVector }, (err, result) => {
		const ok = !err && result && result.vectorId === expectedHostileId && result.deduped === false;
		check('put hostile inputText (no throw, expected vectorId)', ok, err ? String(err) : `deduped=${(result || {}).deduped}`);
		next(err, args);
	});
});

// (a) byte-identical round-trip
taskList.push((args, next) => {
	vs.getVector({ vectorId: expectedHostileId }, (err, record) => {
		const exact = !err && record && record.inputText === hostileInput;
		check('hostile inputText round-trips BYTE-IDENTICAL', exact,
			err ? String(err) : `len stored=${record ? record.inputText.length : 'n/a'} expected=${hostileInput.length}`);
		next(err, args);
	});
});

// (b1) table survived — it is still queryable and the row count is 2 (benign + hostile)
taskList.push((args, next) => {
	rawGet('SELECT count(*) AS n FROM vectors;', (err, rows) => {
		const n = rows && rows[0] ? Number(rows[0].n) : -1;
		check('injection did NOT run: vectors table intact, 2 rows', !err && n === 2, err ? String(err) : `count=${n}`);
		next(err, args);
	});
});

// (b2) the benign canary row still resolves (would be gone if DROP had executed)
taskList.push((args, next) => {
	vs.getVector({ vectorId: expectedBenignId }, (err, record) => {
		check('benign canary row survived the injection probe', !err && record && record.inputText === benignInput, err ? String(err) : '');
		next(err, args);
	});
});

// (c) vector round-trips for the hostile row
taskList.push((args, next) => {
	vs.getVector({ vectorId: expectedHostileId }, (err, record) => {
		const fr = inputVector.map((v) => Math.fround(v));
		const ok = !err && record && record.vector.length === fr.length && record.vector.every((v, i) => v === fr[i]);
		check('hostile row vector round-trips (float32 exact)', ok, err ? String(err) : '');
		next(err, args);
	});
});

// dedup a second hostile put — still 2 rows
taskList.push((args, next) => {
	vs.putVector({ modelVersion, inputText: hostileInput, vector: inputVector }, (err, result) => {
		if (err) { next(err, args); return; }
		rawGet('SELECT count(*) AS n FROM vectors;', (err2, rows) => {
			const n = rows && rows[0] ? Number(rows[0].n) : -1;
			check('re-put hostile -> deduped, still 2 rows', !err2 && result.deduped === true && n === 2, err2 ? String(err2) : `deduped=${result.deduped} count=${n}`);
			next('', args);
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
	console.log(`\n${failed.length === 0 ? 'ALL HOSTILE-INPUT CHECKS PASS' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
	process.exit(failed.length === 0 ? 0 : 1);
});
