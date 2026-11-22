#!/usr/bin/env node
'use strict';

// test-sqlite-instance-callbackDiscipline.js — the two F-16 gates for the vendored sqlite substrate (deep review 2026-11-21).
//
//   1. A REFUSED WRITE IS AN ERROR. saveObject's last step used to push the write's error onto a local list nobody read and
//      call next('') — so a write the engine refused (a constraint, a trigger, a locked file) came back as success, with a
//      refId for a row that does not exist. The refusal here is a BEFORE INSERT / BEFORE UPDATE trigger that RAISEs, which
//      is the most direct way to make sqlite say no to one statement and to nothing else.
//   2. THE CALLER'S CALLBACK RUNS OUTSIDE THE MODULE'S try. runStatement and getData called the callback inside the try that
//      wraps the better-sqlite3 call, and pipeRunner continues synchronously, so everything downstream (the caller's whole
//      chain) ran inside that try. A throw anywhere downstream was caught, logged as an SQL error, and the callback was
//      called a SECOND time with that text as its error: the chain forked. Each case counts callback entries and requires
//      exactly one, and requires the throw to reach the caller as the throw it was.
//
// The try in capturedThrowOf is the ASSERTION, not control flow: the gate is that a deliberate throw propagates, and the
// only way to observe a propagated throw is to catch it at the top.
//
// Everything runs against a throwaway database in the OS temp directory.
//
// Run: node lib/sqlite-instance/test/test-sqlite-instance-callbackDiscipline.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- F-16 gates: a refused write is an error; the callback runs once, outside the module's try

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Makes sqlite refuse an INSERT and an UPDATE with a trigger and requires saveObject to return the refusal. Then throws
     from inside the callback of runStatement, getData and saveObject and requires the callback to have been entered once
     and the throw to reach the caller unchanged. Uses a throwaway database under the OS temp directory.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const sqliteInstance = require('../sqlite-instance')({});

const rawOpts = { noTableNameOk: true, suppressStatementLog: true };

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfSqliteCallbackGate-'));
const dbPath = path.join(scratchDir, `gate_${process.pid}.sqlite3`);

const DOWNSTREAM_THROW_TEXT = 'deliberateDownstreamThrow';

// capturedThrowOf — run oneFunction, return what it threw (null when nothing). See the header: this try is the assertion.
const capturedThrowOf = (oneFunction) => {
	try {
		oneFunction();
	} catch (thrownError) {
		return thrownError;
	}
	return null;
};

// throwOnceCase — call startCall with a callback that counts its entries and throws on every one; report entries and throw
const throwOnceCase = ({ caseLabel, startCall }) => {
	let callbackEntryCount = 0;
	const thrownError = capturedThrowOf(() =>
		startCall(() => {
			callbackEntryCount += 1;
			throw new Error(DOWNSTREAM_THROW_TEXT);
		}),
	);
	harness.equal(`${caseLabel}: the callback is entered exactly once`, callbackEntryCount, 1);
	harness.ok(
		`${caseLabel}: the downstream throw reaches the caller as itself, not as an SQL error`,
		!!thrownError && thrownError.message === DOWNSTREAM_THROW_TEXT,
		thrownError ? thrownError.message : 'nothing was thrown',
	);
};

const taskList = new taskListPlus();

taskList.push((args, next) => {
	sqliteInstance.initDatabaseInstance(dbPath, (err, dbInstance) => next(err, { ...args, dbInstance }));
});

taskList.push((args, next) => {
	args.dbInstance.getTable('refusalGateTable', rawOpts, (err, tableRef) => next(err, { ...args, tableRef }));
});

// a row that exists before the UPDATE refusal is armed
taskList.push((args, next) => {
	args.tableRef.saveObject({ refId: 'existingRowRefId', label: 'before' }, rawOpts, (err) => next(err, args));
});

taskList.push((args, next) => {
	harness.section('A REFUSED WRITE IS AN ERROR — INSERT and UPDATE');
	args.tableRef.runStatement(
		`CREATE TRIGGER refusalGateInsert BEFORE INSERT ON <!tableName!> BEGIN SELECT RAISE(ABORT, 'refusedByInsertGate'); END;
		 CREATE TRIGGER refusalGateUpdate BEFORE UPDATE ON <!tableName!> BEGIN SELECT RAISE(ABORT, 'refusedByUpdateGate'); END;`,
		rawOpts,
		(err) => next(err, args),
	);
});

taskList.push((args, next) => {
	args.tableRef.saveObject({ label: 'refusedInsert' }, rawOpts, (saveErr, savedRefId) => {
		harness.match('a refused INSERT returns the refusal as its error', saveErr, /refusedByInsertGate/);
		args.tableRef.getData(`SELECT count(*) AS rowCount FROM <!tableName!>;`, rawOpts, (readErr, rowList) => {
			harness.equal('  and indeed no row was written (only the pre-existing one)', rowList && rowList[0] && rowList[0].rowCount, 1);
			next(readErr, { ...args, insertRefusedRefId: savedRefId });
		});
	});
});

taskList.push((args, next) => {
	args.tableRef.saveObject({ refId: 'existingRowRefId', label: 'after' }, rawOpts, (saveErr) => {
		harness.match('a refused UPDATE returns the refusal as its error', saveErr, /refusedByUpdateGate/);
		args.tableRef.getData(`SELECT label FROM <!tableName!> WHERE refId='existingRowRefId';`, rawOpts, (readErr, rowList) => {
			harness.equal('  and indeed the row is unchanged', rowList && rowList[0] && rowList[0].label, 'before');
			next(readErr, args);
		});
	});
});

// control: the gate can tell success from refusal (a write with no trigger in the way succeeds, no error)
taskList.push((args, next) => {
	args.dbInstance.getTable('acceptingGateTable', rawOpts, (tableErr, acceptingTableRef) => {
		if (tableErr) {
			next(tableErr, args);
			return;
		}
		acceptingTableRef.saveObject({ label: 'accepted' }, rawOpts, (saveErr, savedRefId) => {
			harness.ok('CONTROL: an unrefused write returns no error and a refId', !saveErr && !!savedRefId, saveErr);
			next('', { ...args, acceptingTableRef });
		});
	});
});

taskList.push((args, next) => {
	harness.section('THE CALLBACK RUNS ONCE, OUTSIDE THE MODULE try');
	throwOnceCase({
		caseLabel: 'runStatement',
		startCall: (oneCallback) => args.acceptingTableRef.runStatement(`UPDATE <!tableName!> SET label=label;`, rawOpts, oneCallback),
	});
	throwOnceCase({
		caseLabel: 'getData',
		startCall: (oneCallback) => args.acceptingTableRef.getData(`SELECT * FROM <!tableName!>;`, rawOpts, oneCallback),
	});
	// the real failure scenario: saveObject's whole pipe runs synchronously inside getData's callback
	throwOnceCase({
		caseLabel: 'saveObject (its pipe runs inside getData)',
		startCall: (oneCallback) => args.acceptingTableRef.saveObject({ label: 'throwFromCallback' }, rawOpts, oneCallback),
	});
	// pass 2's third site (T0 2.1): checkTableExists had the same shape
	throwOnceCase({
		caseLabel: 'checkTableExists',
		startCall: (oneCallback) => args.dbInstance.checkTableExists('acceptingGateTable', oneCallback),
	});
	next('', args);
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		harness.ok('the gate fixture ran to completion', false, err);
	}
	fs.rmSync(scratchDir, { recursive: true, force: true });
	harness.report();
});
