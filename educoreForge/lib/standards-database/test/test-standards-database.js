#!/usr/bin/env node
'use strict';

// test-standards-database.js — gates for the standardsDatabase (standardsDatabase work order Phase 2).
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

const standardsDatabaseModule = require('../standards-database')();

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfStoreGate-'));
const databaseFilePath = path.join(scratchDir, `gate_${process.pid}.sqlite3`);
const cleanup = () => fs.rmSync(scratchDir, { recursive: true, force: true });

const BLOCK_TEXT = `{"kind":"header","blockType":"standardBase","standardKey":"LIF"}
{"kind":"node","stableId":"urn:a","note":"it's got an apostrophe"}
`;
const OTHER_TEXT = `{"kind":"header","blockType":"standardBase","standardKey":"CEDS"}\n`;

// HEADER-vs-KIND fixtures. A schema block says what it is in its own header; the caller says what
// kind it is being stored under. Nothing reconciled the two until now, so a block could be
// harvested carrying one word and stored under the other with no complaint.
const HUB_TEXT = `{"kind":"header","blockType":"hub","standardKey":"CEDS"}
{"kind":"node","stableId":"urn:ceds:hubRef:1"}
`;
const HEADERLESS_TEXT = `not a header line at all\n`;

// SUFFIX-vs-KIND fixtures (implementationPlan_hubPort_072326 §1). All three carry a header that
// SAYS standardBase, so the header-vs-kind gate lets them by — the suffix gate is the only thing
// that can catch a subjectRefId whose ROLE MARKER contradicts the kind. Distinct texts so each gets
// its own content address (the gate fires before the insert, but distinctness keeps the fixtures
// honest).
const BASE_TEXT_A = `{"kind":"header","blockType":"standardBase","standardKey":"CEDS","fixture":"a"}\n`;
const BASE_TEXT_B = `{"kind":"header","blockType":"standardBase","standardKey":"CEDS","fixture":"b"}\n`;
const BASE_TEXT_C = `{"kind":"header","blockType":"standardBase","standardKey":"CEDS","fixture":"c"}\n`;

// =====================================================================
harness.section('THE PATH IS REQUIRED — proven REFUSING, because this is the whole safety story');
// =====================================================================
// 2026-07-17: a scratch-intended save silently wrote the canonical standardsDatabase because it had no path
// handling and fell through to one. A caller that must say where it writes cannot fall through.

standardsDatabaseModule.open({}, (err) => {
	harness.match('opening with no path is REFUSED', err, /databaseFilePath is REQUIRED/);
	harness.match('  and says why there is no default', err, /can write anywhere/);
});
standardsDatabaseModule.open({ databaseFilePath: '' }, (err) => {
	harness.match('a blank path is REFUSED', err, /REQUIRED/);
});
standardsDatabaseModule.open({ databaseFilePath: '/no/such/directory/x.sqlite3' }, (err) => {
	harness.match(
		'a path in a directory nobody prepared is REFUSED',
		err,
		/does not exist.*Refusing/s,
	);
});

standardsDatabaseModule.open({ databaseFilePath }, (openErr, standardsDatabase) => {
	if (openErr) {
		harness.ok('a throwaway database opened', false, openErr);
		cleanup();
		harness.report();
		return;
	}
	harness.ok('a throwaway database opened', !!standardsDatabase);

	// =====================================================================
	harness.section('BLOCKS — content-addressed, deduping, taxonomy enforced');
	// =====================================================================

	standardsDatabase.saveBlock({ text: BLOCK_TEXT, kind: 'standardBase', subjectRefId: 'lif@1_base', version: '1' }, (e1, first) => {
		if (e1) {
			harness.ok('a block saved', false, e1);
			cleanup();
			harness.report();
			return;
		}
		harness.match('a block saved under a sha256 address', first.refId, /^[0-9a-f]{64}$/);
		harness.equal('  and it was genuinely new', first.alreadyPresent, false);

		standardsDatabase.saveBlock({ text: BLOCK_TEXT, kind: 'standardBase', subjectRefId: 'lif@1_base', version: '1' }, (e2, again) => {
			harness.equal('the SAME bytes are the SAME block', again.refId, first.refId);
			harness.equal('  and the second write is a no-op, not a rewrite', again.alreadyPresent, true);

			standardsDatabase.saveBlock({ text: OTHER_TEXT, kind: 'standardBase', subjectRefId: 'ceds@1_base' }, (e3, other) => {
				harness.ok('different bytes get a different address', other.refId !== first.refId);

				standardsDatabase.saveBlock({ text: 'x', kind: 'somethingInvented' }, (kindErr) => {
					harness.match(
						'an unknown kind is REFUSED (the taxonomy is LOCKED)',
						kindErr,
						/is not one of standardBase \| hub \| relationship/,
					);
					harness.match('  and says it is a caller bug, not an extension point', kindErr, /not an extension point/);

					standardsDatabase.saveBlock({ text: '', kind: 'standardBase' }, (emptyErr) => {
						harness.match('empty text is REFUSED', emptyErr, /non-empty string/);

						// =====================================================================
						harness.section('VERIFY-ON-READ — a corrupted block is refused BY NAME');
						// =====================================================================

						standardsDatabase.getBlock({ refId: first.refId }, (readErr, row) => {
							harness.ok('a clean block reads back', !readErr && !!row, readErr);
							harness.equal('  with its text intact, apostrophe and all', row.text, BLOCK_TEXT);

							standardsDatabase.getBlock({ refId: 'noSuchBlock' }, (missErr, missRow) => {
								harness.ok('an absent block is null, not an error', !missErr && missRow === null);

								// Corrupt the stored text behind the standardsDatabase's back — exactly the
								// scenario verify-on-read exists for.
								const sqliteInstance = require('../../sqlite-instance/sqlite-instance')({});
								sqliteInstance.initDatabaseInstance(databaseFilePath, (ie, di) => {
									di.getTable('corruptor', { noTableNameOk: true, suppressStatementLog: true }, (te, tr) => {
										tr.runStatement(
											`UPDATE blocks SET text='tampered' WHERE refId='${first.refId}';`,
											{ noTableNameOk: true, suppressStatementLog: true },
											() => {
												standardsDatabase.getBlock({ refId: first.refId }, (corruptErr, corruptRow) => {
													harness.match(
														'RED PROOF: a tampered block is REFUSED',
														corruptErr,
														/content-address verification FAILED/,
													);
													harness.match('  naming the block', corruptErr, new RegExp(first.refId));
													harness.match('  and what it actually hashes to', corruptErr, /hashes to [0-9a-f]{64}/);
													harness.ok('  and returns NOTHING', corruptRow === undefined);

													manifestGates(standardsDatabase, other.refId);
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
function manifestGates(standardsDatabase, otherBlockRefId) {
	harness.section('MANIFESTS — addressed by MEMBERSHIP, described for humans');

	const members = [
		{ schemaBlockRefId: otherBlockRefId, position: 0, description: 'CEDS 1 — standardBase' },
	];

	standardsDatabase.saveManifest({ name: 'gateManifest', description: 'the first one', members }, (e1, first) => {
		if (e1) {
			harness.ok('a manifest saved', false, e1);
			cleanup();
			harness.report();
			return;
		}
		harness.match('a manifest saved under a sha256 address', first.refId, /^[0-9a-f]{64}$/);
		harness.equal('  with its member count', first.memberCount, 1);

		// THE POINT OF THE WHOLE DESCRIPTION DECISION: same membership, different words.
		standardsDatabase.saveManifest(
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

				standardsDatabase.saveManifest({ name: 'x', members: [] }, (e3, empty) => {
					harness.ok('an empty membership still addresses (the caller decides if that is sane)', !!empty.refId);
					harness.ok('  and it is a DIFFERENT address from a populated one', empty.refId !== first.refId);

					standardsDatabase.saveManifest(
						{ name: 'bad', members: [{ schemaBlockRefId: otherBlockRefId, position: 'first' }] },
						(posErr) => {
							harness.match('a non-numeric position is REFUSED', posErr, /non-numeric position/);
							harness.match('  naming the offender', posErr, new RegExp(otherBlockRefId));

							standardsDatabase.getManifest({ refId: first.refId }, (readErr, manifest) => {
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
									'ceds@1_base',
								);

								standardsDatabase.getManifest({ refId: 'noSuchManifest' }, (mErr, mRow) => {
									harness.ok('an absent manifest is null, not an error', !mErr && mRow === null);
									headerKindGates(standardsDatabase);
								});
							});
						},
					);
				});
			},
		);
	});
};

// =====================================================================
// A function DECLARATION for the same hoisting reason as manifestGates: it is called from inside
// the gates above, before its own definition is reached.
function headerKindGates(standardsDatabase) {
	harness.section('HEADER-vs-KIND — a block is stored under the kind it SAYS it is');

	// A schema block says what it is in its own header; the caller says what kind it is being
	// stored under. Nothing reconciled the two, so a block harvested carrying one word could be
	// stored under the other and the standardsDatabase would hold a row whose text contradicts its own column.
	// The vocabulary split ('standard' vs 'standardBase') was the symptom; this is the defect.

	standardsDatabase.saveBlock({ text: HUB_TEXT, kind: 'standardBase', subjectRefId: 'ceds@1:hub' }, (disagreeErr) => {
		harness.match(
			'RED PROOF: a header disagreeing with the kind it is stored under is REFUSED',
			disagreeErr,
			/header says blockType/,
		);
		harness.match('  naming what the header says', disagreeErr, /blockType 'hub'/);
		harness.match(
			'  and naming the kind it was being stored under',
			disagreeErr,
			/kind 'standardBase'/,
		);

		standardsDatabase.saveBlock({ text: HEADERLESS_TEXT, kind: 'standardBase', subjectRefId: 'nothing@1' }, (headerlessErr) => {
			harness.match(
				'text carrying no readable header is REFUSED',
				headerlessErr,
				/no readable header/,
			);
			harness.match(
				'  naming the kind it was being stored under',
				headerlessErr,
				/kind 'standardBase'/,
			);

			standardsDatabase.saveBlock({ text: HUB_TEXT, kind: 'hub', subjectRefId: 'ceds@1_hub' }, (agreeErr, hubBlock) => {
				harness.ok(
					'a header AGREEING with its kind is admitted',
					!agreeErr && !!hubBlock && !!hubBlock.refId,
					agreeErr,
				);

				standardsDatabase.saveBlock({ text: HUB_TEXT, kind: 'somethingInvented', subjectRefId: 'x@1' }, (kindErr) => {
					harness.match(
						'an unknown kind is STILL refused, header or no header',
						kindErr,
						/is not one of standardBase \| hub \| relationship/,
					);

					suffixKindGates(standardsDatabase);
				});
			});
		});
	});
}

// =====================================================================
// A function DECLARATION for the same hoisting reason as headerKindGates: it is called from inside
// the gates above, before its own definition is reached.
function suffixKindGates(standardsDatabase) {
	harness.section('SUFFIX-vs-KIND — a subjectRefId carries the role marker its kind requires (hubPort §1)');

	// A subjectRefId's role marker (_base / _hub / _rel_) makes a block self-describing by name; the
	// kind column is the machine authority and the two MUST agree. A _hub-marked name stored under
	// kind 'standardBase' has an AGREEING header (both say standardBase), so the header gate lets it
	// by — and it was ADMITTED until this gate existed (proven: State-1 probe). Both the marker the
	// name carries and the kind it is stored under are named, because either could be the mistake.
	standardsDatabase.saveBlock(
		{ text: BASE_TEXT_A, kind: 'standardBase', subjectRefId: 'ceds@current_hub' },
		(disagreeErr) => {
			harness.match(
				'RED PROOF: a _hub-marked subjectRefId under kind standardBase is REFUSED',
				disagreeErr,
				/does not carry the '_base' role marker/,
			);
			harness.match('  naming the marker its NAME carries', disagreeErr, /'_hub'/);
			harness.match('  and the kind it is stored under', disagreeErr, /kind 'standardBase'/);

			standardsDatabase.saveBlock(
				{ text: BASE_TEXT_B, kind: 'standardBase', subjectRefId: 'ceds@current' },
				(absentErr) => {
					harness.match(
						'a subjectRefId carrying NO role marker under a kind that requires one is REFUSED',
						absentErr,
						/does not carry the '_base' role marker/,
					);
					harness.match(
						'  saying it carries no recognized marker',
						absentErr,
						/no recognized role marker/,
					);
					harness.match('  and naming the kind', absentErr, /kind 'standardBase'/);

					// POSITIVE CONTROL — a _base-marked name under kind standardBase is admitted, without
					// which "refuse everything" would satisfy the two refusals above.
					standardsDatabase.saveBlock(
						{ text: BASE_TEXT_C, kind: 'standardBase', subjectRefId: 'ceds@current_base' },
						(agreeErr, agreed) => {
							harness.ok(
								'a _base-marked subjectRefId under kind standardBase is ADMITTED (positive control)',
								!agreeErr && !!agreed && !!agreed.refId,
								agreeErr,
							);

							cleanup();
							harness.report();
						},
					);
				},
			);
		},
	);
}
