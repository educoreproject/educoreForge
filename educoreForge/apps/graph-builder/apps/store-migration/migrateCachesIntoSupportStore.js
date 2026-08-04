#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// =====================================================================
// migrateCachesIntoSupportStore — the ONE-TIME carry of the content-keyed caches into the single
// configured graphBuilder support store (Round-Trip Perfection Campaign, Phase 1, step 4).
// =====================================================================
//
// WHAT MOVES, AND WHY ONLY THIS. Three families are content-keyed, which is what makes carrying them
// across honest rather than an ad-hoc rescue of whatever happened to be lying around:
//   * vectors             (19 per-standard stores)  keyed sha256(modelVersion + NUL + inputText)
//   * vectorCacheEntries  (one store)               keyed (embeddingModelVersion, embeddingDims, textHash)
//   * judgmentCacheEntries(one store)               keyed (promptHash, model, rendererVersion)
// Reuse of a content-keyed row is BYTE-IDENTICAL to recomputing it, so the carry is a cache warm-up,
// not a data migration with a fidelity question attached. It also saves real embedding and judgment
// spend on every later phase, which is the reason the work order asks for it.
//
// WHAT DOES NOT MOVE. Schema blocks, manifests, manifestBlocks and decisionBlocks are NOT carried.
// Later phases forge them fresh, and no round-trip-era block exists to carry anyway (every
// quarantined store's newest block predates the era). This tool never opens the quarantine.
//
// THE THREE PHASES, AND WHY THEY ARE SPLIT THIS WAY.
//
//   A. BUILD THE SCHEMA THROUGH THE FIVE OWNING MODULES. Every table in the merged file is created
//      by the module that owns it — never hand-written here. A hand-written CREATE would be a second
//      declaration of somebody else's schema, and the day the owner added a column the two would
//      drift silently. This phase is also the EMPIRICAL confirmation of the collision audit: if two
//      families declared one table name with different columns, the second CREATE TABLE IF NOT
//      EXISTS would no-op and the loser's columns would simply be missing from the dump.
//
//   B. MERGE VIA ATTACH + INSERT OR IGNORE, through the sqlite3 CLI. This is a DELIBERATE departure
//      from doing the row work in Node, on two grounds. It adds NO table to the merged store — going
//      through sqlite-instance would require a table handle, and acquiring one mints an ops table
//      that none of the five families owns and nobody would later be able to account for. And a set
//      union of 431,219 rows including 1.5GB of vector BLOBs runs at C speed instead of marshalling
//      every BLOB through V8. The statement is pure set-union SQL against a schema the owning
//      modules already created, so nothing about the shape is being decided here.
//      INSERT OR IGNORE is correct rather than lenient: the target's PRIMARY KEY and UNIQUE indexes
//      ARE the content addresses, so a collision means the identical row is already present.
//
//   C. RECONCILE, then VERIFY-ON-READ THROUGH THE OWNING MODULES. The count check proves nothing was
//      dropped; reading sample rows back through vector-store.getVector and vectorCache.getVectors
//      proves the carried bytes still satisfy the integrity guarantees those modules enforce on every
//      read (dtype, blob length, determinant re-hash, payload re-hash). A row count alone would pass
//      just as happily on 156,493 corrupt rows.
//
// THE RECONCILIATION IS AGAINST DISTINCT KEYS, NOT THE PER-FILE SUM — and this is the one number in
// the phase that would have been wrong by accident. vectorId is a content address, so identical input
// text across two standards interns to ONE row: the 19 stores hold 156,757 rows but only 156,493
// distinct vectorIds, 264 of them shared. Reconciling the merged store against the naive sum would
// report a 264-row loss that never happened. Expected counts are therefore MEASURED from the sources
// at run time, never passed in as a remembered constant.
//
// WAL. Three source stores keep almost their entire contents in an uncheckpointed -wal (CTDLASN and
// CTDLQData have 4,096-byte main files), and about half the judgment cache is WAL-resident. A reader
// that saw only the main files would silently carry nothing from them. mode=ro DOES read the WAL when
// the -shm is present, which was verified by positive control rather than assumed, and both the
// expected counts and the merge itself go through the same mode=ro door so they cannot disagree about
// what the source contains.
//
// Async style: callback(errString, result) + qtools-asynchronous-pipe-plus taskList/pipeRunner. No
// async/await, no try/catch for control flow.
// =====================================================================

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const LIB_TREE = path.join(__dirname, '..', '..', '..', '..', 'lib');

const SQLITE_CLI = '/usr/bin/sqlite3';

// The merge plan is DATA, not a switch statement: one row per family carried, naming its source, the
// table, and the columns copied. Adding a family is a row here, never a new branch.
const MIGRATION_PLAN = [
	{
		familyName: 'vectorCacheEntries',
		sourceKind: 'singleFile',
		sourceFilePath: null, // resolved from sourceRoots below
		sourceRelativePath: path.join('vectorCache', 'vectorCache.sqlite3'),
		tableName: 'vectorCacheEntries',
		columnList: 'seq, embeddingModelVersion, embeddingDims, textHash, vectorBase64, sourceText, createdAt',
		distinctKeyExpression: 'seq',
	},
	{
		familyName: 'judgmentCacheEntries',
		sourceKind: 'singleFile',
		sourceFilePath: null,
		sourceRelativePath: path.join('judgmentCache', 'judgmentCache.sqlite3'),
		tableName: 'judgmentCacheEntries',
		columnList: 'seq, promptHash, model, rendererVersion, judgmentJson, generation, createdAt',
		distinctKeyExpression: 'seq',
	},
	{
		familyName: 'vectors',
		sourceKind: 'directoryGlob',
		sourceRelativePath: 'vectorStores',
		tableName: 'vectors',
		columnList: 'vectorId, modelVersion, dims, dtype, inputText, vector, vectorHash',
		distinctKeyExpression: 'vectorId',
	},
];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(injectedDeps = {}) => {
		const { xLog } = injectedDeps;

		// -----
		// runSqliteCli — one sqlite3 invocation, errors as values. maxBuffer is raised because a
		// reconciliation query set can return more than the default 1MB of text.
		//
		// IT REFUSES A MISSING STATEMENT BY NAME, and that guard is here because the absence of it
		// already cost a run. An earlier draft of the audit helper forgot to forward its SQL argument,
		// so sqlite3 was invoked with the database and no statement — which opens a REPL, reads EOF,
		// and exits 0 with empty stdout. Every query "succeeded" and returned nothing, and an empty
		// string reads downstream as zero rows and no columns: a 560MB store reported 0 vectors and a
		// table's column list came back blank, both as clean results rather than as errors. The tool
		// lied plausibly, which is worse than crashing. A caller that names no statement is a caller
		// bug, so it is named as one and no SQL is attempted.
		const runSqliteCli = ({ databaseFilePath, statementText }, callback) => {
			if (typeof databaseFilePath !== 'string' || databaseFilePath.trim() === '') {
				callback(
					`${moduleName}.runSqliteCli: databaseFilePath is REQUIRED and has no default.`,
				);
				return;
			}
			if (typeof statementText !== 'string' || statementText.trim() === '') {
				callback(
					`${moduleName}.runSqliteCli: statementText is REQUIRED and must be a non-empty ` +
						`string. Invoking sqlite3 with no statement exits 0 with empty output, which every ` +
						`caller here would read as "zero rows" rather than as "no query ran".`,
				);
				return;
			}
			execFile(
				SQLITE_CLI,
				[databaseFilePath, statementText],
				{ maxBuffer: 64 * 1024 * 1024 },
				(execError, stdout, stderr) => {
					if (execError) {
						callback(
							`${moduleName}: sqlite3 refused a statement against '${databaseFilePath}': ` +
								`${execError.message}${stderr ? ` / ${stderr}` : ''}`,
						);
						return;
					}
					callback('', `${stdout}`.trim());
				},
			);
		};

		// -----
		// resolveSourceFilePaths — turn one plan row into the concrete list of source files it names.
		// A plan row that resolves to NOTHING is a refusal, never an empty carry: "the directory held
		// no stores" and "I could not find the directory" must not arrive as the same silent zero.
		const resolveSourceFilePaths = ({ onePlanRow, dataStoresDirPath }) => {
			const resolvedRoot = path.join(dataStoresDirPath, onePlanRow.sourceRelativePath);

			if (onePlanRow.sourceKind === 'singleFile') {
				if (!fs.existsSync(resolvedRoot)) {
					return {
						error:
							`${moduleName}: the '${onePlanRow.familyName}' source store ` +
							`'${resolvedRoot}' does not exist. Refusing to report an empty carry as a ` +
							`successful one.`,
					};
				}
				return { sourceFilePaths: [resolvedRoot] };
			}

			if (onePlanRow.sourceKind === 'directoryGlob') {
				if (!fs.existsSync(resolvedRoot)) {
					return {
						error:
							`${moduleName}: the '${onePlanRow.familyName}' source directory ` +
							`'${resolvedRoot}' does not exist.`,
					};
				}
				// ONLY *.sqlite3 — the -wal and -shm sidecars are read BY sqlite through the main
				// file, never attached themselves. (The work order's "57 files" is 19 stores plus
				// their 19 -wal and 19 -shm sidecars; there are nineteen stores.)
				const sourceFilePaths = fs
					.readdirSync(resolvedRoot)
					.filter((oneEntry) => oneEntry.endsWith('.sqlite3'))
					.sort()
					.map((oneEntry) => path.join(resolvedRoot, oneEntry));
				if (sourceFilePaths.length === 0) {
					return {
						error:
							`${moduleName}: the '${onePlanRow.familyName}' source directory ` +
							`'${resolvedRoot}' contains no *.sqlite3 store. A scan that found nothing is ` +
							`reported as a failure, never as an empty roster.`,
					};
				}
				return { sourceFilePaths };
			}

			return {
				error:
					`${moduleName}: plan row '${onePlanRow.familyName}' declares sourceKind ` +
					`'${onePlanRow.sourceKind}', which is not one of: singleFile, directoryGlob. A plan ` +
					`row the tool cannot execute is a fault, not something to skip.`,
			};
		};

		// -----
		// measureExpectedDistinctCount — the reconciliation target, MEASURED from the sources rather
		// than remembered. Accumulates the distinct key set one source at a time into a scratch
		// database, because SQLITE_MAX_ATTACHED is 10 and there are nineteen vector stores. The
		// scratch table's PRIMARY KEY performs exactly the dedup the merged store will perform.
		const measureExpectedDistinctCount = (
			{ onePlanRow, sourceFilePaths, scratchFilePath },
			callback,
		) => {
			if (fs.existsSync(scratchFilePath)) {
				fs.unlinkSync(scratchFilePath);
			}

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				runSqliteCli(
					{
						databaseFilePath: scratchFilePath,
						statementText:
							`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; ` +
							`CREATE TABLE keyUnion (distinctKey TEXT PRIMARY KEY);`,
					},
					(err) => next(err, args),
				);
			});

			taskList.push((args, next) => {
				const accumulateNext = (index) => {
					if (index >= sourceFilePaths.length) {
						next('', args);
						return;
					}
					runSqliteCli(
						{
							databaseFilePath: scratchFilePath,
							statementText:
								`ATTACH DATABASE 'file:${sourceFilePaths[index]}?mode=ro' AS oneSource; ` +
								`INSERT OR IGNORE INTO keyUnion (distinctKey) ` +
								`SELECT ${onePlanRow.distinctKeyExpression} FROM oneSource.${onePlanRow.tableName}; ` +
								`DETACH DATABASE oneSource;`,
						},
						(err) => {
							if (err) {
								next(err);
								return;
							}
							accumulateNext(index + 1);
						},
					);
				};
				accumulateNext(0);
			});

			taskList.push((args, next) => {
				runSqliteCli(
					{ databaseFilePath: scratchFilePath, statementText: `SELECT count(*) FROM keyUnion;` },
					(err, countText) => next(err, { ...args, expectedDistinctCount: Number(countText) }),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(`${moduleName} measureExpectedDistinctCount '${onePlanRow.familyName}': ${err}`);
					return;
				}
				callback('', args.expectedDistinctCount);
			});
		};

		// -----
		// carryOneFamily — ATTACH each source read-only and INSERT OR IGNORE its rows into the target.
		const carryOneFamily = ({ onePlanRow, sourceFilePaths, targetFilePath }, callback) => {
			const carryNext = (index) => {
				if (index >= sourceFilePaths.length) {
					callback('');
					return;
				}
				runSqliteCli(
					{
						databaseFilePath: targetFilePath,
						statementText:
							`ATTACH DATABASE 'file:${sourceFilePaths[index]}?mode=ro' AS oneSource; ` +
							`INSERT OR IGNORE INTO ${onePlanRow.tableName} (${onePlanRow.columnList}) ` +
							`SELECT ${onePlanRow.columnList} FROM oneSource.${onePlanRow.tableName}; ` +
							`DETACH DATABASE oneSource;`,
					},
					(err) => {
						if (err) {
							callback(
								`${moduleName} carryOneFamily '${onePlanRow.familyName}' from ` +
									`'${sourceFilePaths[index]}': ${err}`,
							);
							return;
						}
						xLog.status(
							`    carried ${path.basename(sourceFilePaths[index])} ` +
								`(${index + 1}/${sourceFilePaths.length})`,
						);
						carryNext(index + 1);
					},
				);
			};
			carryNext(0);
		};

		return { runSqliteCli, resolveSourceFilePaths, measureExpectedDistinctCount, carryOneFamily, MIGRATION_PLAN };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
