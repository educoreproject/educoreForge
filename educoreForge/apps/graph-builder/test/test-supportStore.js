#!/usr/bin/env node
'use strict';

// test-supportStore.js — the gates for the SINGLE CONFIGURED SUPPORT STORE
// (Round-Trip Perfection Campaign, Phase 1, 2026-08-04).
//
// PROVES:
//   SECTION 1 — RESOLUTION + THE NO-DEFAULT REFUSAL. The path may come from [stores]
//     graphBuilderSupportFilePath, an explicit --standardsDatabaseFilePath still wins, and — THE RED
//     TWIN THIS PHASE TURNS ON — an ABSENT config key with no flag is REFUSED BY NAME rather than
//     resolved to anywhere at all. Config-supplied is not a code default.
//   SECTION 2 — THE GENERATION GUARD. standardsDatabase.open REFUSES BY NAME a database whose blocks
//     table carries the incumbent forge-store's 'blockId' instead of this generation's 'refId', and
//     refuses an unrecognized third shape too. A fresh database and a same-generation database open
//     normally, so the guard is not merely refusing everything.
//   SECTION 3 — -truncateStore's BACKUP VERIFICATION. It refuses when the backup cannot be opened,
//     when the backup cannot account for a table, and when a single row count disagrees. It empties
//     nothing in any of those cases.
//
// WHY SECTION 1's REFUSAL IS TESTED HERE AND NOT AT THE CLI. A CLI run discovers the real
// graphBuilder.ini, which HAS the key — so the absent-key case is unreachable from argv by
// construction. resolveSupportStoreFilePath is exported precisely so this claim is provable without
// launching a build, because a claim provable only by launching a build is a claim nobody re-checks.
//
// Run: node apps/graph-builder/test/test-supportStore.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for the single configured graphBuilder support store

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the config resolution and its no-default refusal, the cross-generation blocks-table guard,
     and -truncateStore's refusal to empty anything behind a backup it could not verify. Runs against
     throwaway temp databases; never opens the configured production store.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfSupportStoreGate-'));

const actions = require('../lib/actions')();
const { resolveSupportStoreFilePath } = actions;
const standardsDatabaseModule = require('../../../lib/standards-database/standards-database');

// =====================================================================
harness.section('SECTION 1 — resolution, and THE NO-DEFAULT REFUSAL (config-supplied is not a default)');
// =====================================================================

// THE RED TWIN. Neither channel spoke. There is no configured key and no flag, and the ONLY acceptable
// outcome is a named refusal — not the campaign's own store, not the tree's dataStores, not a temp
// file. If this ever returns a filePath, the 2026-07-17 defect is back: a build that does not say where
// it writes has been allowed to guess.
const noChannelSpoke = resolveSupportStoreFilePath({
	explicitValue: undefined,
	configuredValue: undefined,
	actionName: '-build',
});
harness.ok(
	'RED TWIN — an ABSENT config key with NO flag resolves NO path at all',
	noChannelSpoke.filePath === undefined,
	`resolved to '${noChannelSpoke.filePath}' — a default has crept back in`,
);
harness.match(
	'  and is refused BY NAME, saying config-supplied is not a code default',
	noChannelSpoke.error || '',
	/no support store path resolved, and there is NO DEFAULT/,
);
harness.match(
	'  naming the config key the operator should set',
	noChannelSpoke.error || '',
	/\[stores\] graphBuilderSupportFilePath/,
);
harness.ok(
	'  and the refusal names no candidate path, so nothing reads it as a suggestion to use one',
	!/dataStores\/graphBuilder\/graphBuilderSupport\.sqlite/.test(noChannelSpoke.error || ''),
	noChannelSpoke.error,
);

// GREEN — a configured key resolves, and says which channel answered.
const fromConfig = resolveSupportStoreFilePath({
	explicitValue: undefined,
	configuredValue: '/tmp/configured/support.sqlite',
	actionName: '-build',
});
harness.equal('a configured key resolves to that path', fromConfig.filePath, '/tmp/configured/support.sqlite');
harness.equal('  and reports it came from config', fromConfig.resolvedFrom, 'config');
harness.ok('  with no error', !fromConfig.error, fromConfig.error);

// GREEN — precedence: the explicit flag WINS. This is what keeps every hermetic suite's scratch-store
// isolation working after the config key exists.
const explicitWins = resolveSupportStoreFilePath({
	explicitValue: '/tmp/explicit/scratch.sqlite',
	configuredValue: '/tmp/configured/support.sqlite',
	actionName: '-build',
});
harness.equal('an explicit flag OVERRIDES the configured key', explicitWins.filePath, '/tmp/explicit/scratch.sqlite');
harness.equal('  and reports it came from the command line', explicitWins.resolvedFrom, 'commandLine');

// RED — a BLANK on either channel is refused, never quietly replaced by the other. Present-but-empty
// operator input is polyArch2 §6's worse fault: someone tried to say something and it did not arrive.
const blankExplicit = resolveSupportStoreFilePath({
	explicitValue: '   ',
	configuredValue: '/tmp/configured/support.sqlite',
	actionName: '-build',
});
harness.ok('RED — a BLANK flag resolves no path', blankExplicit.filePath === undefined, blankExplicit.filePath);
harness.match(
	'  refusing by name rather than falling through to the configured key',
	blankExplicit.error || '',
	/--standardsDatabaseFilePath was given but BLANK/,
);
const blankConfigured = resolveSupportStoreFilePath({
	explicitValue: undefined,
	configuredValue: '',
	actionName: '-build',
});
harness.ok('RED — a BLANK config value resolves no path', blankConfigured.filePath === undefined, blankConfigured.filePath);
harness.match(
	'  refusing by name',
	blankConfigured.error || '',
	/graphBuilderSupportFilePath is present in graphBuilder\.ini but BLANK/,
);

// The refusal names the ACTION that refused, so an operator reading a log knows which command stopped.
harness.match(
	'the refusal names the action (-replay, not just -build)',
	(resolveSupportStoreFilePath({ actionName: '-replay' }).error || ''),
	/graphBuilder -replay:/,
);

// =====================================================================
harness.section('SECTION 2 — THE GENERATION GUARD: a foreign blocks table is REFUSED BY NAME');
// =====================================================================
// The collision, confirmed by reading both declarations: this module declares blocks(refId, kind, ...)
// while npm/qtools-graph-forge-core/lib/forge-store/forge-store.js:115 declares blocks(blockId, type,
// ...). Both use CREATE TABLE IF NOT EXISTS, so whichever opens a file first wins its schema and the
// other's writes then fail on columns that are not there — far from the cause, mid-build.

// A database shaped like the INCUMBENT generation.
const incumbentShapedPath = path.join(scratchDir, 'incumbentGeneration.sqlite');
const seedIncumbent = new Database(incumbentShapedPath);
seedIncumbent
	.prepare(
		`CREATE TABLE blocks (
			blockId TEXT PRIMARY KEY, type TEXT NOT NULL, subject TEXT, version TEXT,
			requires TEXT, text BLOB NOT NULL, producedBy TEXT, createdAt TIMESTAMP
		)`,
	)
	.run();
seedIncumbent.close();

standardsDatabaseModule().open({ databaseFilePath: incumbentShapedPath }, (incumbentErr, incumbentApi) => {
	harness.ok(
		'RED TWIN — an INCUMBENT-generation store (blocks.blockId) is REFUSED, and no api is handed back',
		!!incumbentErr && !incumbentApi,
		`err='${incumbentErr}' api=${incumbentApi ? 'RETURNED' : 'none'}`,
	);
	harness.match(
		'  naming the offending column and the generation it belongs to',
		incumbentErr || '',
		/carries the column 'blockId', which is the INCUMBENT forge-store generation/,
	);
	harness.match(
		'  and stating it does NOT convert or migrate',
		incumbentErr || '',
		/Nothing is converted or migrated here/,
	);
	// The refusal must leave the foreign store ALONE — no table of ours added to somebody else's file.
	const afterRefusal = new Database(incumbentShapedPath, { readonly: true });
	const tableNames = afterRefusal
		.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`)
		.all()
		.map((oneRow) => oneRow.name);
	afterRefusal.close();
	harness.ok(
		'  and the refused database was NOT modified — no manifests/manifestBlocks were created in it',
		!tableNames.includes('manifests') && !tableNames.includes('manifestBlocks'),
		`tables now: ${tableNames.join(', ')}`,
	);

	// An UNRECOGNIZED third shape is refused too — guessing is worst exactly there.
	const foreignShapedPath = path.join(scratchDir, 'unknownGeneration.sqlite');
	const seedForeign = new Database(foreignShapedPath);
	seedForeign.prepare(`CREATE TABLE blocks (someOtherId TEXT PRIMARY KEY, payload TEXT)`).run();
	seedForeign.close();

	standardsDatabaseModule().open({ databaseFilePath: foreignShapedPath }, (foreignErr, foreignApi) => {
		harness.ok(
			'RED — a blocks table with NEITHER refId NOR blockId is refused, not written into',
			!!foreignErr && !foreignApi,
			`err='${foreignErr}'`,
		);
		harness.match(
			'  listing the columns it actually found',
			foreignErr || '',
			/carrying NEITHER 'refId'.*NOR 'blockId'/s,
		);

		// GREEN — the guard is not simply refusing everything. A FRESH database opens (no blocks table
		// yet is a new database, not a foreign one) and can then be reopened, now same-generation.
		const freshPath = path.join(scratchDir, 'freshGeneration.sqlite');
		standardsDatabaseModule().open({ databaseFilePath: freshPath }, (freshErr, freshApi) => {
			harness.accepts('GREEN — a FRESH database opens normally', freshErr ? [freshErr] : []);
			harness.ok('  and returns a working api', !!(freshApi && freshApi.saveBlock), 'no api');

			standardsDatabaseModule().open({ databaseFilePath: freshPath }, (reopenErr, reopenApi) => {
				harness.accepts(
					'GREEN — REOPENING a same-generation store (blocks.refId) is not refused',
					reopenErr ? [reopenErr] : [],
				);
				harness.ok('  and still returns a working api', !!(reopenApi && reopenApi.saveBlock), 'no api');
				runTruncateSection();
			});
		});
	});
});

// =====================================================================
function runTruncateSection() {
	harness.section('SECTION 3 — -truncateStore REFUSES behind a backup it could not verify');
	// =====================================================================
	// A BACKUP THAT WAS NEVER OPENED IS NOT A BACKUP — it is a file of the right size in the right
	// place, which is what a corrupt copy also looks like. These are the refusals that make the
	// difference observable. The sqlite runner is injected so the disagreement branch is reachable at
	// all: nothing can make a freshly written VACUUM INTO copy disagree with its own source.

	const liveStorePath = path.join(scratchDir, 'truncateTarget.sqlite');

	// stand up a real store through the owning modules so the table list is genuine
	standardsDatabaseModule().open({ databaseFilePath: liveStorePath }, (openErr) => {
		if (openErr) {
			harness.ok('a throwaway support store opened', false, openErr);
			harness.report();
			return;
		}
		require('../../../lib/decision-store/decision-store')().open(
			{ databaseFilePath: liveStorePath },
			() => {
				const vectorStoreOne = require('../../../lib/vector-store/vector-store')({});
				vectorStoreOne.init({ dbPath: liveStorePath }, () => {
					require('../../../lib/embedding/vectorCache')().open(
						{ databaseFilePath: liveStorePath },
						() => {
							require('../../../lib/judgment-cache/judgment-cache')().open(
								{ databaseFilePath: liveStorePath },
								() => driveTruncateRefusals(liveStorePath),
							);
						},
					);
				});
			},
		);
	});
}


// =====================================================================
// driveTruncateRefusals — the SECTION 3 drives, run in sequence
// =====================================================================
// Written as a LIST of named drives rather than nested callbacks. Each drive supplies its own sqlite
// runner double, its own expectation, and — the part that matters most — its own check that NOTHING WAS
// EMPTIED. A refusal that left the store half-truncated would satisfy the error assertion alone.
function driveTruncateRefusals(liveStorePath) {
	const originalGlobal = process.global;

	// process.global is FROZEN, so a parameter change means replacing the whole object — which is how
	// this tree's own suites vary it. Restored before harness.report().
	const withStorePath = (storeFilePath) => {
		const replacement = {
			xLog: originalGlobal.xLog,
			// getConfig returns an EMPTY [stores] section deliberately: this suite must never resolve the
			// real configured production store, so every drive travels by the explicit-flag channel.
			getConfig: () => ({}),
			commandLineParameters: {
				switches: {},
				values: { standardsDatabaseFilePath: [storeFilePath] },
				fileList: [],
			},
			rawConfig: {},
		};
		delete process.global;
		process.global = replacement;
	};

	const TRUNCATABLE = [
		'blocks',
		'manifests',
		'manifestBlocks',
		'decisionBlocks',
		'vectors',
		'vectorCacheEntries',
		'judgmentCacheEntries',
	];

	const rowCountsOf = (databaseFilePath) => {
		const oneConnection = new Database(databaseFilePath, { readonly: true });
		const counts = {};
		TRUNCATABLE.forEach((oneTableName) => {
			counts[oneTableName] = oneConnection.prepare(`SELECT count(*) AS n FROM ${oneTableName};`).get().n;
		});
		oneConnection.close();
		return counts;
	};

	const tableNamesOf = (databaseFilePath) => {
		const oneConnection = new Database(databaseFilePath, { readonly: true });
		const names = oneConnection
			.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`)
			.all()
			.map((oneRow) => oneRow.name);
		oneConnection.close();
		return names;
	};

	// The backup name is stamped to the SECOND and -truncateStore REFUSES to overwrite an existing
	// backup (correctly — it is the one file the operation cannot afford to damage). Several drives
	// inside one second therefore collide, so each drive clears the previous backup first. That refusal
	// is itself asserted as a gate below rather than engineered away with a finer timestamp.
	const clearBackups = () =>
		fs
			.readdirSync(scratchDir)
			.filter((oneEntry) => oneEntry.endsWith('.backup'))
			.forEach((oneEntry) => fs.unlinkSync(path.join(scratchDir, oneEntry)));

	const realRunner = require('../apps/store-migration/migrateCachesIntoSupportStore')({
		xLog: originalGlobal.xLog,
	}).runSqliteCli;

	const isBackupCountRead = (oneRequest) =>
		/\.backup$/.test(oneRequest.databaseFilePath) && /count\(\*\)/.test(oneRequest.statementText);

	// SEED one row into every truncatable table, so "nothing was emptied" is an observable claim.
	// Emptying an already-empty store would satisfy every assertion while proving nothing.
	const seed = new Database(liveStorePath);
	seed.prepare(`INSERT INTO blocks (refId, kind, text) VALUES ('seedRef','standardBase','seedText')`).run();
	seed.prepare(`INSERT INTO manifests (refId, name) VALUES ('seedManifest','seed')`).run();
	seed
		.prepare(`INSERT INTO manifestBlocks (manifestRefId, schemaBlockRefId) VALUES ('seedManifest','seedRef')`)
		.run();
	seed.prepare(`INSERT INTO decisionBlocks (decisionBlockHash, pairKey, frozenText) VALUES ('h','p','t')`).run();
	seed
		.prepare(
			`INSERT INTO vectors (vectorId, modelVersion, dims, dtype, inputText, vector, vectorHash)
			 VALUES ('v','m',1,'float32','t',X'00000000','h')`,
		)
		.run();
	seed
		.prepare(
			`INSERT INTO vectorCacheEntries (embeddingModelVersion, embeddingDims, textHash, vectorBase64, sourceText)
			 VALUES ('m',1,'h','b64','src')`,
		)
		.run();
	seed
		.prepare(
			`INSERT INTO judgmentCacheEntries (promptHash, model, rendererVersion, judgmentJson)
			 VALUES ('h','m','r','{}')`,
		)
		.run();
	seed.close();

	harness.ok(
		'every truncatable table was seeded, so "nothing was emptied" is a real claim',
		Object.values(rowCountsOf(liveStorePath)).every((oneCount) => oneCount === 1),
		JSON.stringify(rowCountsOf(liveStorePath)),
	);

	// Each drive: a label, the runner double it needs, and what must be true afterwards.
	const refusalDrives = [
		{
			label: 'RED TWIN — the BACKUP CANNOT BE READ',
			// the backup is really written; only the READ of it fails, which is exactly what a corrupt or
			// truncated copy looks like from the caller's side
			runSqliteCli: (oneRequest, oneCallback) => {
				if (isBackupCountRead(oneRequest)) {
					oneCallback('file is not a database');
					return;
				}
				realRunner(oneRequest, oneCallback);
			},
			expectedPattern: /a backup nobody has opened is not a backup/,
		},
		{
			label: 'RED TWIN — the backup CANNOT ACCOUNT FOR a table',
			// the backup opens, but one table is simply missing from its answer
			runSqliteCli: (oneRequest, oneCallback) => {
				if (!isBackupCountRead(oneRequest)) {
					realRunner(oneRequest, oneCallback);
					return;
				}
				realRunner(oneRequest, (err, output) => {
					if (err) {
						oneCallback(err);
						return;
					}
					oneCallback(
						'',
						`${output}`
							.split('\n')
							.filter((oneLine) => !oneLine.startsWith('judgmentCacheEntries|'))
							.join('\n'),
					);
				});
			},
			expectedPattern: /reported NO row count for \[judgmentCacheEntries\]/,
		},
		{
			label: 'RED TWIN — a single backup row count DISAGREES',
			// the backup opens and answers for every table, but one number is wrong. A same-size,
			// openable, WRONG backup is the failure a copy-and-hope implementation cannot see.
			runSqliteCli: (oneRequest, oneCallback) => {
				if (!isBackupCountRead(oneRequest)) {
					realRunner(oneRequest, oneCallback);
					return;
				}
				realRunner(oneRequest, (err, output) => {
					if (err) {
						oneCallback(err);
						return;
					}
					oneCallback(
						'',
						`${output}`
							.split('\n')
							.map((oneLine) => (oneLine.startsWith('vectors|') ? 'vectors|0' : oneLine))
							.join('\n'),
					);
				});
			},
			expectedPattern: /vectors \(live 1, backup 0\)/,
		},
	];

	const runDrive = (index) => {
		if (index >= refusalDrives.length) {
			runOverwriteRefusalDrive();
			return;
		}
		const oneDrive = refusalDrives[index];
		clearBackups();
		withStorePath(liveStorePath);
		actions.truncateStore(
			(driveErr, driveOutcome) => {
				harness.ok(
					`${oneDrive.label} — refused, and NO outcome returned`,
					!!driveErr && !driveOutcome,
					`err='${driveErr}'`,
				);
				harness.match('  refused BY NAME', driveErr || '', oneDrive.expectedPattern);
				harness.match('  and says the live store is untouched', driveErr || '', /live store is untouched/);
				const afterDrive = rowCountsOf(liveStorePath);
				harness.ok(
					'  AND NOTHING WAS EMPTIED — every seeded row survives',
					Object.values(afterDrive).every((oneCount) => oneCount === 1),
					JSON.stringify(afterDrive),
				);
				runDrive(index + 1);
			},
			{ runSqliteCli: oneDrive.runSqliteCli },
		);
	};

	// A backup path that ALREADY EXISTS is refused rather than overwritten. Discovered by accident —
	// three drives inside one second all wanted the same second-stamped filename — and kept as a gate,
	// because refusing is the intended conduct and a finer timestamp would have hidden it.
	const runOverwriteRefusalDrive = () => {
		clearBackups();
		withStorePath(liveStorePath);
		// take one good backup first, so the SECOND attempt in the same second collides
		actions.truncateStoreBackupProbe = undefined;
		const collidingPath = fs
			.readdirSync(scratchDir)
			.filter((oneEntry) => oneEntry.endsWith('.backup'));
		harness.ok('  (no stale backups before the overwrite drive)', collidingPath.length === 0, collidingPath.join(','));
		// write a file exactly where the next backup will want to go
		const stamp = new Date();
		const twoDigit = (oneNumber) => `${oneNumber}`.padStart(2, '0');
		const expectedBackupPath =
			`${liveStorePath}.beforeTruncate-` +
			`${stamp.getFullYear()}${twoDigit(stamp.getMonth() + 1)}${twoDigit(stamp.getDate())}` +
			`-${twoDigit(stamp.getHours())}${twoDigit(stamp.getMinutes())}${twoDigit(stamp.getSeconds())}.backup`;
		fs.writeFileSync(expectedBackupPath, 'not a database, and must not be overwritten');
		actions.truncateStore(
			(existsErr) => {
				harness.match(
					'RED — a backup path that ALREADY EXISTS is refused, never overwritten',
					existsErr || '',
					/already exists\. Refusing to overwrite a backup/,
				);
				harness.equal(
					'  and the pre-existing file was NOT overwritten',
					fs.readFileSync(expectedBackupPath, 'utf8'),
					'not a database, and must not be overwritten',
				);
				const afterExists = rowCountsOf(liveStorePath);
				harness.ok(
					'  AND NOTHING WAS EMPTIED',
					Object.values(afterExists).every((oneCount) => oneCount === 1),
					JSON.stringify(afterExists),
				);
				runGreenDrive();
			},
			{ runSqliteCli: realRunner },
		);
	};

	// GREEN — a genuinely verified backup, and only then an empty store.
	const runGreenDrive = () => {
		clearBackups();
		withStorePath(liveStorePath);
		actions.truncateStore(
			(goodErr, goodOutcome) => {
				harness.accepts('GREEN — with a VERIFIED backup, -truncateStore succeeds', goodErr ? [goodErr] : []);
				if (goodErr) {
					process.global = originalGlobal;
					harness.report();
					return;
				}
				const outcome = JSON.parse(goodOutcome.resultText);
				harness.equal('  reporting exit 0', goodOutcome.exitCode, 0);
				harness.ok('  and that the backup was verified', outcome.backupVerified === true, goodOutcome.resultText);
				harness.ok('  the backup file EXISTS on disk', fs.existsSync(outcome.backupFilePath), outcome.backupFilePath);
				harness.ok(
					'  the live store is NOW empty',
					Object.values(rowCountsOf(liveStorePath)).every((oneCount) => oneCount === 0),
					JSON.stringify(rowCountsOf(liveStorePath)),
				);
				harness.ok(
					'  and the BACKUP, read independently, still holds all seven seeded rows',
					Object.values(rowCountsOf(outcome.backupFilePath)).every((oneCount) => oneCount === 1),
					JSON.stringify(rowCountsOf(outcome.backupFilePath)),
				);
				// TRUNCATION IS BY DELETE, NOT DROP — the owning modules' schema must survive intact
				const survivingTables = tableNamesOf(liveStorePath);
				harness.ok(
					'  every truncated table STILL EXISTS (emptied by DELETE, never DROPped)',
					TRUNCATABLE.every((oneTableName) => survivingTables.includes(oneTableName)),
					survivingTables.join(', '),
				);

				// a store that does not exist is refused, never created-and-emptied
				withStorePath(path.join(scratchDir, 'notThere.sqlite'));
				actions.truncateStore((absentErr) => {
					harness.match(
						'RED — truncating a store that does not EXIST is refused by name',
						absentErr || '',
						/does not exist\. Refusing/,
					);
					process.global = originalGlobal;
					runSectionFour();
				});
			},
			{ runSqliteCli: realRunner },
		);
	};

	runDrive(0);
}

// =====================================================================
// SECTION 4 — the two guards this phase ADDED but had not yet gated
// =====================================================================
// Caught by the phase's own polyArch2 self-audit: both were written as refusals and neither had ever
// been observed refusing. A guard nobody has watched fail is a guard nobody has proven.
function runSectionFour() {
	harness.section('SECTION 4 — runSqliteCli and vectorStoreResolver refusals');

	// ---- runSqliteCli: a MISSING STATEMENT is a caller bug, named as one ---------------------------
	// This guard exists because its absence already cost a run. sqlite3 invoked with a database and NO
	// statement opens a REPL, reads EOF, and exits 0 with EMPTY stdout — so every caller read "success,
	// zero rows" from a query that never ran. A 560MB store reported 0 vectors and column lists came back
	// blank, all as clean results. The tool lied plausibly, which is worse than crashing.
	const migrationTool = require('../apps/store-migration/migrateCachesIntoSupportStore')({
		xLog: process.global.xLog,
	});

	migrationTool.runSqliteCli({ databaseFilePath: '/tmp/whatever.sqlite' }, (missingErr) => {
		harness.match(
			'RED — runSqliteCli with NO statementText is refused BY NAME, not run',
			missingErr || '',
			/statementText is REQUIRED and must be a non-empty string/,
		);
		harness.match(
			'  explaining WHY an empty statement is dangerous rather than merely wrong',
			missingErr || '',
			/exits 0 with empty output/,
		);
		migrationTool.runSqliteCli(
			{ databaseFilePath: '/tmp/whatever.sqlite', statementText: '   ' },
			(blankErr) => {
				harness.match(
					'RED — a BLANK statementText is as refused as an absent one',
					blankErr || '',
					/statementText is REQUIRED/,
				);
				migrationTool.runSqliteCli({ statementText: 'SELECT 1;' }, (noPathErr) => {
					harness.match(
						'RED — runSqliteCli with no databaseFilePath is refused BY NAME',
						noPathErr || '',
						/databaseFilePath is REQUIRED and has no default/,
					);

					// GREEN — the guard is not simply refusing everything.
					const probePath = path.join(scratchDir, 'runnerProbe.sqlite');
					migrationTool.runSqliteCli(
						{ databaseFilePath: probePath, statementText: `SELECT 42;` },
						(goodErr, goodOutput) => {
							harness.accepts('GREEN — a real statement runs', goodErr ? [goodErr] : []);
							harness.equal('  and returns its output', `${goodOutput}`.trim(), '42');
							runResolverGuard();
						},
					);
				});
			},
		);
	});
}

// ---- vectorStoreResolver: frozen vectors have no home of their own -------------------------------
// Under the single-file ruling the resolver opens the ONE configured support store for every standard.
// It therefore REQUIRES that path: a resolver that does not know which file it is opening is a resolver
// that can open anywhere, which is the 2026-07-17 lesson one layer down.
function runResolverGuard() {
	const buildLib = require('../lib/build')();
	harness.ok(
		'build.js exposes makeVectorStoreResolver so its refusals can be gated',
		typeof buildLib.makeVectorStoreResolver === 'function',
		`exports: ${Object.keys(buildLib).join(', ')}`,
	);
	if (typeof buildLib.makeVectorStoreResolver !== 'function') {
		harness.report();
		return;
	}

	buildLib.makeVectorStoreResolver({})('ceds', (noPathErr, noPathStore) => {
		harness.ok(
			'RED — a resolver built with NO supportStoreFilePath refuses, and returns no store',
			!!noPathErr && !noPathStore,
			`err='${noPathErr}'`,
		);
		harness.match(
			'  refusing BY NAME and pointing at the config key',
			noPathErr || '',
			/supportStoreFilePath is REQUIRED and has no default/,
		);
		harness.match(
			'  restating the lesson: a resolver that does not know its file can open anywhere',
			noPathErr || '',
			/is a resolver that can open anywhere/,
		);

		const resolverTargetPath = path.join(scratchDir, 'resolverTarget.sqlite');
		const realResolver = buildLib.makeVectorStoreResolver({
			supportStoreFilePath: resolverTargetPath,
		});

		realResolver('', (blankKeyErr) => {
			harness.match(
				'RED — a blank standardKey is refused, nothing substituted',
				blankKeyErr || '',
				/a standardKey is REQUIRED to resolve a vector store/,
			);

			// RED — THE M-3 DERIVATION LESSON, still enforced. The standardKey no longer picks the
			// filename, but it is still validated through the forge-bundle authority: dropping the check
			// because the filename stopped depending on it would keep the habit and discard the guard.
			realResolver('zorg', (unknownErr, unknownStore) => {
				harness.ok(
					'RED — an UNFORGEABLE standard is still refused even though it no longer names a file',
					!!unknownErr && !unknownStore,
					`err='${unknownErr}'`,
				);
				harness.match('  naming the standard', unknownErr || '', /'zorg' is not a forgeable standard/);

				// GREEN — a real standard resolves, and EVERY standard gets the SAME handle, which is what
				// "one file" means in practice.
				realResolver('ceds', (cedsErr, cedsStore) => {
					harness.accepts('GREEN — a real standard resolves a store', cedsErr ? [cedsErr] : []);
					realResolver('sif', (sifErr, sifStore) => {
						harness.accepts('  and so does a second one', sifErr ? [sifErr] : []);
						harness.ok(
							'  AND BOTH GET THE IDENTICAL HANDLE — the collapse to one file, observed',
							!!cedsStore && cedsStore === sifStore,
							`ceds===sif is ${cedsStore === sifStore}`,
						);
						harness.ok(
							'  and the resolved file carries the vectors table',
							tableNamesOfFile(resolverTargetPath).includes('vectors'),
							tableNamesOfFile(resolverTargetPath).join(', '),
						);
						harness.report();
					});
				});
			});
		});
	});
}

function tableNamesOfFile(databaseFilePath) {
	if (!fs.existsSync(databaseFilePath)) {
		return [];
	}
	const oneConnection = new Database(databaseFilePath, { readonly: true });
	const names = oneConnection
		.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`)
		.all()
		.map((oneRow) => oneRow.name);
	oneConnection.close();
	return names;
}
