#!/usr/bin/env node
'use strict';

// test-sqlite-instance.js — gates for the VENDORED sqlite substrate (store work order Phase 1).
//
// This module was not written here; it was vendored from the project scaffold. A vendored module
// gets gated anyway, for two reasons that have nothing to do with distrusting its author:
//
//   1. It has to work in THIS tree. It previously lived four directories up and across the repo
//      (`../../../../server/data-model/lib/...`), which is exactly the relative escape that broke
//      the recreation's self-contained premise. A suite that requires it by its tree path is the
//      standing proof that the escape is gone.
//   2. The corrected version fixes a DOUBLE-APOSTROPHE bug: the old one doubled apostrophes by
//      hand and then handed the already-doubled value to sqlString.escape, so `it's` was STORED as
//      `it''s`. Everything above this module is content-addressed, and anything that changes bytes
//      on the way to disk can change a content address. TQ ruled the swap needs no special
//      handling because a new tree has no legacy rows — which is true, and is a reason not to run
//      a MIGRATION, not a reason to leave the round trip unproven.
//
// Everything here runs against a throwaway database in the OS temp directory. No project store is
// opened, ever, by anything in runAllTests.
//
// Run: node lib/sqlite-instance/test/test-sqlite-instance.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for the vendored sqlite substrate

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the vendored module loads from inside the tree, that text round-trips EXACTLY
     (including apostrophes, the bug the corrected version fixes), that deleteObject exists and
     refuses a missing refId, and that a delete of an absent record is an error rather than a
     silent success. Uses a throwaway database under the OS temp directory.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const sqliteInstance = require('../sqlite-instance')({});

// The same option shape forge-store uses (code fact, forge-store.js:48): runStatement REFUSES a
// statement with no <!tableName!> substitution tag unless noTableNameOk says the caller means it.
const rawOpts = { noTableNameOk: true, suppressStatementLog: true };

// a throwaway database. The pid keeps concurrent runs from colliding; the temp dir keeps this
// suite structurally incapable of touching anything in the project.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfSqliteGate-'));
const dbPath = path.join(scratchDir, `gate_${process.pid}.sqlite3`);

const cleanup = () => {
	fs.rmSync(scratchDir, { recursive: true, force: true });
};

// =====================================================================
harness.section('VENDORING — the module resolves from inside the tree');
// =====================================================================

harness.ok('sqlite-instance loaded by its tree path', typeof sqliteInstance.initDatabaseInstance === 'function');
harness.ok(
	'new-refid resolves as a SIBLING, not through a path escape',
	fs.existsSync(path.join(__dirname, '..', 'new-refid.js')),
);
harness.ok(
	'the vendored source contains no `../../` escape',
	fs.readFileSync(path.join(__dirname, '..', 'sqlite-instance.js'), 'utf8').indexOf('../../') === -1,
);

sqliteInstance.initDatabaseInstance(dbPath, (initErr, dbInstance) => {
	if (initErr) {
		harness.ok('database instance opened', false, initErr);
		cleanup();
		harness.report();
		return;
	}
	harness.ok('a throwaway database opened', !!dbInstance);

	dbInstance.getTable('gateTable', rawOpts, (tableErr, tableRef) => {
		if (tableErr) {
			harness.ok('table handle obtained', false, tableErr);
			cleanup();
			harness.report();
			return;
		}

		harness.ok('the table handle carries deleteObject (the new capability)', typeof tableRef.deleteObject === 'function');

		// =====================================================================
		harness.section('APOSTROPHES — the bug the corrected version fixes, proven fixed');
		// =====================================================================
		// The old module stored `it's` as `it''s`. This is the round trip that would have caught it.

		const TRICKY = `it's a "quoted" thing — O'Brien's ` + `'` + `nested' apostrophes`;

		tableRef.saveObject({ label: 'apostropheGate', body: TRICKY }, rawOpts, (saveErr, savedRefId) => {
			if (saveErr) {
				harness.ok('a record with apostrophes was saved', false, saveErr);
				cleanup();
				harness.report();
				return;
			}
			harness.ok('a record with apostrophes was saved', !!savedRefId, savedRefId);

			// getData takes a SQL STRING, not a criteria object (code fact).
			const selectSaved = `SELECT * FROM gateTable WHERE refId='${savedRefId}';`;
			tableRef.getData(selectSaved, rawOpts, (readErr, rows) => {
				if (readErr) {
					harness.ok('the record was read back', false, readErr);
					cleanup();
					harness.report();
					return;
				}
				const stored = rows && rows[0] ? rows[0].body : null;

				harness.equal('the text round-trips EXACTLY', stored, TRICKY);
				harness.ok(
					'  and specifically is NOT the doubled-apostrophe form the old version wrote',
					stored !== TRICKY.replace(/'/g, "''"),
					stored,
				);
				// RED PROOF for the assertion above: the comparison must be able to tell the two
				// apart, or "not doubled" is a sentence that always passes.
				harness.ok(
					'  RED PROOF: the doubled form IS distinguishable from the correct one',
					TRICKY.replace(/'/g, "''") !== TRICKY,
				);

				// =====================================================================
				harness.section('deleteObject — the guard, proven REFUSING');
				// =====================================================================
				// An unguarded delete builds a WHERE clause matching nothing — or everything.

				tableRef.deleteObject(null, rawOpts, (nullErr) => {
					harness.ok('a null refId is REFUSED, not run as a query', !!nullErr, nullErr);

					tableRef.deleteObject('', rawOpts, (blankErr) => {
						harness.ok('a blank refId is REFUSED', !!blankErr, blankErr);

						tableRef.deleteObject('noSuchRefId', rawOpts, (missErr) => {
							harness.match(
								'a refId matching no row is an ERROR, never a silent success',
								missErr || '',
								/No record with refId/,
							);

							tableRef.deleteObject(savedRefId, rawOpts, (delErr) => {
								harness.ok('a real refId deletes', !delErr, delErr);

								tableRef.getData(selectSaved, rawOpts, (gone, afterRows) => {
									harness.equal(
										'  and the row is actually gone',
										(afterRows || []).length,
										0,
									);
									cleanup();
									harness.report();
								});
							});
						});
					});
				});
			});
		});
	});
});
