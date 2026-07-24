#!/usr/bin/env node
'use strict';

// test-decision-store.js — gates for the decisionStore (P3b-store).
//
// Everything runs against a throwaway database under the OS temp directory. runAllTests opens NO project
// database and never reaches Anthropic/Voyage/Docker — the required-path rule and a temp sqlite are what
// keep the suite hermetic, exactly as test-standards-database does.
//
// What is proven:
//   * the database path is REQUIRED with no default (the whole safety story), proven REFUSING;
//   * a decision block ROUND-TRIPS: save a frozen block, get it back BYTE-IDENTICAL, keyed per pair;
//   * the content address is STABLE (sha256 of the frozen text) and returned;
//   * SAVE is IDEMPOTENT: the same frozen bytes are the same block, the second save a no-op;
//   * a decisionBlockHash that DISAGREES with the frozen text it is handed with is REFUSED by name;
//   * VERIFY-ON-READ refuses a tampered frozen block by name (RED PROOF);
//   * an absent pair is { frozenText: null }, not an error;
//   * a genuine re-rebridge (different frozen text) appends, and the read returns the LATEST for the pair.
//
// Run: node lib/decision-store/test/test-decision-store.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for the decision store

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the database path is REQUIRED with no default, that frozen decision blocks round-trip
     byte-identical keyed per pair, that the content address is stable, that save is idempotent, that a
     disagreeing decisionBlockHash is refused, that VERIFY-ON-READ refuses a tampered block by name, that
     an absent pair answers { frozenText: null }, and that the latest block wins per pair. Throwaway
     database under the OS temp directory.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const decisionStoreModule = require('../decision-store')();
const contentAddress = require('../../content-address/content-address')();

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfDecisionGate-'));
const databaseFilePath = path.join(scratchDir, `gate_${process.pid}.sqlite3`);
const cleanup = () => fs.rmSync(scratchDir, { recursive: true, force: true });

// A representative frozen decision block, the exact shape decisionFreezer emits (a single-line JSON record
// whose sha256 IS the pin). The precise contents do not matter to the store — only that it is byte-stable
// text the store addresses, holds, and returns unchanged.
const PAIR_KEY = 'CEDS::CTDL';
const FROZEN_TEXT = JSON.stringify({
	recordType: 'inferredDecisionRecord',
	method: 'definitionEmbedding-opusRerank-v1',
	subjectSource: 'CTDL',
	subjectVersion: 'v1',
	objectSource: 'CEDS',
	objectVersion: 'v1',
	decisionCount: 1,
	decisions: [
		{
			fromStableId: "urn:ctdl:Credential's",
			role: 'DmeProperty',
			abstain: false,
			targetKey: 'P000123',
			chosenStableId: 'urn:ceds:P000123',
			retrievalRank: 0,
			cosineScore: 0.87,
			bestCosine: 0.87,
			pool: 'DmeProperty',
		},
	],
});
const FROZEN_HASH = contentAddress.blockIdForText(FROZEN_TEXT);

// A second, DIFFERENT frozen text for the same pair — a genuine re-rebridge result (latest-wins proof).
const FROZEN_TEXT_V2 = JSON.stringify({
	recordType: 'inferredDecisionRecord',
	method: 'definitionEmbedding-opusRerank-v1',
	subjectSource: 'CTDL',
	subjectVersion: 'v1',
	objectSource: 'CEDS',
	objectVersion: 'v1',
	decisionCount: 1,
	decisions: [
		{
			fromStableId: 'urn:ctdl:Credential',
			role: 'DmeProperty',
			abstain: false,
			targetKey: 'P000999',
			chosenStableId: 'urn:ceds:P000999',
			retrievalRank: 0,
			cosineScore: 0.91,
			bestCosine: 0.91,
			pool: 'DmeProperty',
		},
	],
});
const FROZEN_HASH_V2 = contentAddress.blockIdForText(FROZEN_TEXT_V2);

// =====================================================================
harness.section('THE PATH IS REQUIRED — proven REFUSING, the same safety story standards-database tells');
// =====================================================================

decisionStoreModule.open({}, (err) => {
	harness.match('opening with no path is REFUSED', err, /databaseFilePath is REQUIRED/);
	harness.match('  and says why there is no default', err, /can write anywhere/);
});
decisionStoreModule.open({ databaseFilePath: '' }, (err) => {
	harness.match('a blank path is REFUSED', err, /REQUIRED/);
});
decisionStoreModule.open({ databaseFilePath: '/no/such/directory/x.sqlite3' }, (err) => {
	harness.match('a path in a directory nobody prepared is REFUSED', err, /does not exist.*Refusing/s);
});

decisionStoreModule.open({ databaseFilePath }, (openErr, decisionStore) => {
	if (openErr) {
		harness.ok('a throwaway database opened', false, openErr);
		cleanup();
		harness.report();
		return;
	}
	harness.ok('a throwaway database opened', !!decisionStore);
	harness.equal('  and reports its own path', decisionStore.databaseFilePath, databaseFilePath);

	// =====================================================================
	harness.section('ROUND-TRIP — save a frozen block, get it back BYTE-IDENTICAL, keyed per pair');
	// =====================================================================

	// A pair with NO block yet answers with a null frozenText, not an error — the plugin reads this as
	// "no frozen block -> 0 inferred edges". Proven BEFORE the save so the empty state is a real observation.
	decisionStore.getDecisionBlock({ pairKey: PAIR_KEY }, (emptyErr, empty) => {
		harness.ok('an absent pair is { frozenText: null }, not an error', !emptyErr && empty && empty.frozenText === null, emptyErr);

		decisionStore.saveDecisionBlock(
			{ pairKey: PAIR_KEY, frozenText: FROZEN_TEXT, decisionBlockHash: FROZEN_HASH },
			(saveErr, saved) => {
				if (saveErr) {
					harness.ok('a frozen block saved', false, saveErr);
					cleanup();
					harness.report();
					return;
				}
				harness.match('a frozen block saved under a sha256 address', saved.decisionBlockHash, /^[0-9a-f]{64}$/);
				harness.equal('  and the address IS the content hash of the frozen text', saved.decisionBlockHash, FROZEN_HASH);
				harness.equal('  and it was genuinely new', saved.alreadyPresent, false);

				decisionStore.getDecisionBlock({ pairKey: PAIR_KEY }, (readErr, loaded) => {
					harness.ok('the frozen block reads back for its pair', !readErr && !!loaded, readErr);
					harness.equal('  BYTE-IDENTICAL to what was saved (round-trip)', loaded.frozenText, FROZEN_TEXT);
					harness.equal('  carrying the same content address', loaded.decisionBlockHash, FROZEN_HASH);

					// =====================================================================
					harness.section('IDEMPOTENCE — the same frozen bytes are the same block, the second save a no-op');
					// =====================================================================

					decisionStore.saveDecisionBlock(
						{ pairKey: PAIR_KEY, frozenText: FROZEN_TEXT, decisionBlockHash: FROZEN_HASH },
						(reErr, again) => {
							harness.ok('a re-save of identical frozen text succeeds', !reErr, reErr);
							harness.equal('  under the SAME address (content-addressed, stable)', again.decisionBlockHash, FROZEN_HASH);
							harness.equal('  and is a no-op, not a rewrite', again.alreadyPresent, true);

							// =====================================================================
							harness.section('A DISAGREEING decisionBlockHash is REFUSED by name');
							// =====================================================================
							// The caller hands both the frozen text and the hash it computed for it; they MUST agree.

							decisionStore.saveDecisionBlock(
								{ pairKey: PAIR_KEY, frozenText: FROZEN_TEXT, decisionBlockHash: 'deadbeef' },
								(mismatchErr) => {
									harness.match(
										'RED PROOF: a decisionBlockHash that does not match the frozen text is REFUSED',
										mismatchErr,
										/does not match the sha256 of the frozen text/,
									);
									harness.match('  naming the hash the text actually produces', mismatchErr, new RegExp(FROZEN_HASH));

									// a save with NO decisionBlockHash is allowed (the store computes it) — positive control.
									decisionStore.saveDecisionBlock(
										{ pairKey: PAIR_KEY, frozenText: FROZEN_TEXT },
										(noHashErr, noHash) => {
											harness.ok('a save WITHOUT a supplied hash is admitted (the store addresses it)', !noHashErr && noHash.decisionBlockHash === FROZEN_HASH, noHashErr);

											// empty / missing inputs
											decisionStore.saveDecisionBlock({ pairKey: '', frozenText: FROZEN_TEXT }, (blankPairErr) => {
												harness.match('an empty pairKey is REFUSED', blankPairErr, /pairKey is required/);
												decisionStore.saveDecisionBlock({ pairKey: PAIR_KEY, frozenText: '' }, (blankTextErr) => {
													harness.match('an empty frozenText is REFUSED', blankTextErr, /frozenText is required/);
													verifyOnReadGates(decisionStore);
												});
											});
										},
									);
								},
							);
						},
					);
				});
			},
		);
	});
});

// =====================================================================
// A function DECLARATION, not a const arrow: it is called from inside the callback nest above, where a const
// would sit in the temporal dead zone (the same hoisting discipline test-standards-database documents).
function verifyOnReadGates(decisionStore) {
	harness.section('VERIFY-ON-READ — a tampered frozen block is REFUSED BY NAME');

	// Corrupt the stored frozen text behind the store's back — exactly the scenario verify-on-read exists
	// for. A plain build replaying a corrupted block would silently write DIFFERENT edges than the rebridge
	// that made it; the recompute-and-refuse is what makes that impossible.
	const sqliteInstance = require('../../sqlite-instance/sqlite-instance')({});
	sqliteInstance.initDatabaseInstance(databaseFilePath, (ie, di) => {
		if (ie) {
			harness.ok('reopened the database to tamper with it', false, ie);
			cleanup();
			harness.report();
			return;
		}
		di.getTable('corruptor', { noTableNameOk: true, suppressStatementLog: true }, (te, tr) => {
			tr.runStatement(
				`UPDATE decisionBlocks SET frozenText='tampered' WHERE decisionBlockHash='${FROZEN_HASH}';`,
				{ noTableNameOk: true, suppressStatementLog: true },
				() => {
					decisionStore.getDecisionBlock({ pairKey: PAIR_KEY }, (corruptErr, corruptRow) => {
						harness.match('RED PROOF: a tampered frozen block is REFUSED', corruptErr, /content-address verification FAILED/);
						harness.match('  naming the pair', corruptErr, /CEDS::CTDL/);
						harness.match('  and what it actually hashes to', corruptErr, /hashes to [0-9a-f]{64}/);
						harness.ok('  and returns NOTHING', corruptRow === undefined);

						latestWinsGates();
					});
				},
			);
		});
	});
}

// =====================================================================
// A function DECLARATION for the same hoisting reason: called from inside the gates above.
function latestWinsGates() {
	harness.section('LATEST WINS — a genuine re-rebridge appends, and the read returns the newest per pair');

	// Use a fresh database so the tampered row from verifyOnReadGates does not confound this. A new store
	// object over a new temp file — still hermetic, still under the OS temp dir.
	const secondPath = path.join(scratchDir, `latest_${process.pid}.sqlite3`);
	decisionStoreModule.open({ databaseFilePath: secondPath }, (openErr, store2) => {
		if (openErr) {
			harness.ok('a second throwaway database opened', false, openErr);
			cleanup();
			harness.report();
			return;
		}
		store2.saveDecisionBlock({ pairKey: PAIR_KEY, frozenText: FROZEN_TEXT, decisionBlockHash: FROZEN_HASH }, (e1) => {
			harness.ok('the first frozen block saved', !e1, e1);
			store2.saveDecisionBlock({ pairKey: PAIR_KEY, frozenText: FROZEN_TEXT_V2, decisionBlockHash: FROZEN_HASH_V2 }, (e2, v2) => {
				harness.ok('a DIFFERENT frozen block for the same pair appends (different address)', !e2 && v2.decisionBlockHash === FROZEN_HASH_V2 && v2.decisionBlockHash !== FROZEN_HASH, e2);
				store2.getDecisionBlock({ pairKey: PAIR_KEY }, (rErr, latest) => {
					harness.ok('the read returns the LATEST block for the pair', !rErr && !!latest, rErr);
					harness.equal('  which is the second (re-rebridged) frozen text', latest.frozenText, FROZEN_TEXT_V2);
					harness.equal('  under the second address', latest.decisionBlockHash, FROZEN_HASH_V2);

					cleanup();
					harness.report();
				});
			});
		});
	});
}
