#!/usr/bin/env node
'use strict';

// test-standards-database.js — gates for the store (store work order Phase 2).
//
// Everything runs against a throwaway database under the OS temp directory. No project database is
// opened by anything in runAllTests — which is not merely a convention here but the property the
// required-path rule exists to give us.
//
// Run: node lib/standards-database/test/test-standards-database.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for the standards database

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the database path is REQUIRED with no default, that blocks are content-addressed and
     dedup, that VERIFY-ON-READ refuses a corrupted block by name, that an unknown kind is refused,
     and that manifests address by membership so identical membership is the same manifest while a
     description change is not. Throwaway database under the OS temp directory.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const standardsDatabase = require('../standards-database')();

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfStoreGate-'));
const databaseFilePath = path.join(scratchDir, `gate_${process.pid}.sqlite3`);
const cleanup = () => fs.rmSync(scratchDir, { recursive: true, force: true });

const BLOCK_TEXT = `{"kind":"header","blockType":"standardBase","standardKey":"LIF"}
{"kind":"node","stableId":"urn:a","note":"it's got an apostrophe"}
`;
const OTHER_TEXT = `{"kind":"header","blockType":"standardBase","standardKey":"CEDS"}\n`;

// =====================================================================
harness.section('THE PATH IS REQUIRED — proven REFUSING, because this is the whole safety story');
// =====================================================================
// 2026-07-17: a scratch-intended save silently wrote the canonical store because it had no path
// handling and fell through to one. A caller that must say where it writes cannot fall through.

standardsDatabase.open({}, (err) => {
	harness.match('opening with no path is REFUSED', err, /databaseFilePath is REQUIRED/);
	harness.match('  and says why there is no default', err, /can write anywhere/);
});
standardsDatabase.open({ databaseFilePath: '' }, (err) => {
	harness.match('a blank path is REFUSED', err, /REQUIRED/);
});
standardsDatabase.open({ databaseFilePath: '/no/such/directory/x.sqlite3' }, (err) => {
	harness.match(
		'a path in a directory nobody prepared is REFUSED',
		err,
		/does not exist.*Refusing/s,
	);
});

standardsDatabase.open({ databaseFilePath }, (openErr, store) => {
	if (openErr) {
		harness.ok('a throwaway database opened', false, openErr);
		cleanup();
		harness.report();
		return;
	}
	harness.ok('a throwaway database opened', !!store);

	// =====================================================================
	harness.section('BLOCKS — content-addressed, deduping, taxonomy enforced');
	// =====================================================================

	store.saveBlock({ text: BLOCK_TEXT, kind: 'standardBase', subjectRefId: 'lif@1', version: '1' }, (e1, first) => {
		if (e1) {
			harness.ok('a block saved', false, e1);
			cleanup();
			harness.report();
			return;
		}
		harness.match('a block saved under a sha256 address', first.refId, /^[0-9a-f]{64}$/);
		harness.equal('  and it was genuinely new', first.alreadyPresent, false);

		store.saveBlock({ text: BLOCK_TEXT, kind: 'standardBase', subjectRefId: 'lif@1', version: '1' }, (e2, again) => {
			harness.equal('the SAME bytes are the SAME block', again.refId, first.refId);
			harness.equal('  and the second write is a no-op, not a rewrite', again.alreadyPresent, true);

			store.saveBlock({ text: OTHER_TEXT, kind: 'standardBase', subjectRefId: 'ceds@1' }, (e3, other) => {
				harness.ok('different bytes get a different address', other.refId !== first.refId);

				store.saveBlock({ text: 'x', kind: 'somethingInvented' }, (kindErr) => {
					harness.match(
						'an unknown kind is REFUSED (the taxonomy is LOCKED)',
						kindErr,
						/is not one of standardBase \| hub \| relationship/,
					);
					harness.match('  and says it is a caller bug, not an extension point', kindErr, /not an extension point/);

					store.saveBlock({ text: '', kind: 'standardBase' }, (emptyErr) => {
						harness.match('empty text is REFUSED', emptyErr, /non-empty string/);

						// =====================================================================
						harness.section('VERIFY-ON-READ — a corrupted block is refused BY NAME');
						// =====================================================================

						store.getBlock({ refId: first.refId }, (readErr, row) => {
							harness.ok('a clean block reads back', !readErr && !!row, readErr);
							harness.equal('  with its text intact, apostrophe and all', row.text, BLOCK_TEXT);

							store.getBlock({ refId: 'noSuchBlock' }, (missErr, missRow) => {
								harness.ok('an absent block is null, not an error', !missErr && missRow === null);

								// Corrupt the stored text behind the store's back — exactly the
								// scenario verify-on-read exists for.
								const sqliteInstance = require('../../sqlite-instance/sqlite-instance')({});
								sqliteInstance.initDatabaseInstance(databaseFilePath, (ie, di) => {
									di.getTable('corruptor', { noTableNameOk: true, suppressStatementLog: true }, (te, tr) => {
										tr.runStatement(
											`UPDATE blocks SET text='tampered' WHERE refId='${first.refId}';`,
											{ noTableNameOk: true, suppressStatementLog: true },
											() => {
												store.getBlock({ refId: first.refId }, (corruptErr, corruptRow) => {
													harness.match(
														'RED PROOF: a tampered block is REFUSED',
														corruptErr,
														/content-address verification FAILED/,
													);
													harness.match('  naming the block', corruptErr, new RegExp(first.refId));
													harness.match('  and what it actually hashes to', corruptErr, /hashes to [0-9a-f]{64}/);
													harness.ok('  and returns NOTHING', corruptRow === undefined);

													manifestGates(store, other.refId);
												});
											},
										);
									});
								});
							});
						});
					});
				});
			});
		});
	});
});

// =====================================================================
// A function DECLARATION, not a const arrow: it is called from inside the block gates above, and a
// const would sit in the temporal dead zone at that moment. (Found the hard way — the resulting
// ReferenceError was swallowed by sqlite-instance's SQL error handling and RETRIED, so a plain
// hoisting mistake presented as twenty-seven assertion failures. Same shape as the readiness-probe
// bug fixed earlier today: an infrastructure catch that cannot tell a caller's throw from its own.)
function manifestGates(store, otherBlockRefId) {
	harness.section('MANIFESTS — addressed by MEMBERSHIP, described for humans');

	const members = [
		{ schemaBlockRefId: otherBlockRefId, position: 0, description: 'CEDS 1 — standardBase' },
	];

	store.saveManifest({ name: 'gateManifest', description: 'the first one', members }, (e1, first) => {
		if (e1) {
			harness.ok('a manifest saved', false, e1);
			cleanup();
			harness.report();
			return;
		}
		harness.match('a manifest saved under a sha256 address', first.refId, /^[0-9a-f]{64}$/);
		harness.equal('  with its member count', first.memberCount, 1);

		// THE POINT OF THE WHOLE DESCRIPTION DECISION: same membership, different words.
		store.saveManifest(
			{
				name: 'a completely different name',
				description: 'entirely different prose',
				members: [
					{ schemaBlockRefId: otherBlockRefId, position: 0, description: 'described differently' },
				],
			},
			(e2, second) => {
				harness.equal(
					'identical MEMBERSHIP is the same manifest, whatever the descriptions say',
					second.refId,
					first.refId,
				);
				harness.equal('  and it deduped rather than making a second one', second.alreadyPresent, true);

				store.saveManifest({ name: 'x', members: [] }, (e3, empty) => {
					harness.ok('an empty membership still addresses (the caller decides if that is sane)', !!empty.refId);
					harness.ok('  and it is a DIFFERENT address from a populated one', empty.refId !== first.refId);

					store.saveManifest(
						{ name: 'bad', members: [{ schemaBlockRefId: otherBlockRefId, position: 'first' }] },
						(posErr) => {
							harness.match('a non-numeric position is REFUSED', posErr, /non-numeric position/);
							harness.match('  naming the offender', posErr, new RegExp(otherBlockRefId));

							store.getManifest({ refId: first.refId }, (readErr, manifest) => {
								harness.ok('the manifest reads back', !readErr && !!manifest, readErr);
								harness.equal('  with its membership', manifest.members.length, 1);
								harness.equal(
									'  carrying the human description',
									manifest.members[0].description,
									'CEDS 1 — standardBase',
								);
								harness.equal(
									'  and the block subject, joined so a human can read it without a second trip',
									manifest.members[0].subjectRefId,
									'ceds@1',
								);

								store.getManifest({ refId: 'noSuchManifest' }, (mErr, mRow) => {
									harness.ok('an absent manifest is null, not an error', !mErr && mRow === null);
									cleanup();
									harness.report();
								});
							});
						},
					);
				});
			},
		);
	});
};
