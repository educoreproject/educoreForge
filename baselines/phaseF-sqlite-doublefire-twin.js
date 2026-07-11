#!/usr/bin/env node
'use strict';

// phaseF-sqlite-doublefire-twin.js — the Phase-F FIX-NOW red/green twin for the
// sqlite-instance double-callback defect (Phase-C boundary elevation; supervisor scope
// ruling 2026-07-11: ALL THREE sites — runStatementActual, getDataActual,
// checkTableExistsActual). One probe per site: a deliberately-THROWING downstream
// callback counts its own invocations. PRE-FIX each site fires the callback TWICE
// (success fire inside the try, then the unwound throw re-enters the catch and fires
// the error path). POST-FIX each site fires ONCE and the deliberate throw PROPAGATES
// to this twin's observation boundary (the try/catch here is test scaffolding
// observing a deliberate throw, not control flow in product code).
//
// Run: node baselines/phaseF-sqlite-doublefire-twin.js
// Output: per-site fire counts + propagation observations + a PRE-FIX/POST-FIX shape verdict.

const fs = require('fs');
const path = require('path');

// minimal process.global — the responsible app injects this in production (the
// forge-store test/test.js pattern).
process.global = process.global || {};
const noop = () => {};
process.global.xLog = process.global.xLog || {
	status: noop,
	error: (msg) => console.error(`xLog.error: ${msg}`),
	result: noop,
	verbose: noop,
};
process.global.getConfig = process.global.getConfig || (() => ({}));

const CODE = path.join(__dirname, '..');
const sqliteInstance = require(
	path.join(CODE, 'server', 'data-model', 'lib', 'sqlite-instance', 'sqlite-instance'),
)({});

const DB_PATH = path.join(
	require('os').tmpdir(),
	`phaseF_doubleFire_twin_${process.pid}.sqlite3`,
);

const report = [];
const probe = (label, executor) => {
	let fireCount = 0;
	let propagated = null;
	const throwingCallback = (...cbArgs) => {
		fireCount++;
		if (fireCount === 1) {
			throw new Error(`deliberate downstream throw [${label}]`);
		}
	};
	try {
		executor(throwingCallback);
	} catch (err) {
		propagated = err.toString();
	}
	report.push({ label, fireCount, propagated });
	console.log(
		`${label}: callback fired ${fireCount}x; deliberate throw ${
			propagated ? `PROPAGATED (${propagated})` : 'SWALLOWED (re-entered the catch)'
		}`,
	);
};

sqliteInstance.initDatabaseInstance(DB_PATH, (initErr, dbInstance) => {
	if (initErr) {
		console.error(`init failed: ${initErr}`);
		process.exit(2);
	}
	const { getTable, checkTableExists } = dbInstance;

	getTable('__TEST_PHF_doubleFire', (tableErr, tableRef) => {
		if (tableErr) {
			console.error(`getTable failed: ${tableErr}`);
			process.exit(2);
		}

		probe('site-1 runStatementActual', (throwingCallback) =>
			tableRef.runStatement(
				`INSERT INTO <!tableName!> (refId) VALUES ('__TEST_PHF_x1');`,
				{},
				throwingCallback,
			),
		);

		probe('site-2 getDataActual', (throwingCallback) =>
			tableRef.getData(`SELECT * FROM <!tableName!>;`, {}, throwingCallback),
		);

		probe('site-3 checkTableExistsActual', (throwingCallback) =>
			checkTableExists('__TEST_PHF_doubleFire', throwingCallback),
		);

		const doubleFired = report.filter((row) => row.fireCount > 1);
		const singleFired = report.filter(
			(row) => row.fireCount === 1 && row.propagated,
		);
		if (doubleFired.length === 3) {
			console.log(
				'VERDICT: PRE-FIX SHAPE — all three sites double-fired (the defect, observed wild)',
			);
		} else if (singleFired.length === 3) {
			console.log(
				'VERDICT: POST-FIX SHAPE — all three sites fired once and the throw propagated honestly',
			);
		} else {
			console.log(
				`VERDICT: MIXED/UNEXPECTED — ${JSON.stringify(report)} (investigate before proceeding)`,
			);
		}

		fs.unlinkSync(DB_PATH);
		['-shm', '-wal'].forEach((suffix) => {
			const sidecar = `${DB_PATH}${suffix}`;
			if (fs.existsSync(sidecar)) {
				fs.unlinkSync(sidecar);
			}
		});
	});
});
