#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// =====================================================================
// runStoreMigration — the executable front for migrateCachesIntoSupportStore.
// =====================================================================
//   node runStoreMigration.js --targetFilePath=<path> --dataStoresDirPath=<path> [--schemaOnly]
//
// Both paths are REQUIRED and have no default, for the same reason standardsDatabase.open refuses an
// unnamed path: a migration that does not say where it is reading and writing is a migration that can
// read and write anywhere, and this one moves 2.3GB.
//
// EXIT CONTRACT: 0 only when every family reconciled EXACTLY and every verify-on-read sample passed.
// A count that is merely close exits non-zero. There is no tolerance and no percentage.
//
// Async style: callback(errString, result) + qtools-asynchronous-pipe-plus. No async/await.
// =====================================================================

const path = require('path');
const fs = require('fs');
const commandLineParser = require('qtools-parse-command-line');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const LIB_TREE = path.join(__dirname, '..', '..', '..', '..', 'lib');

const cliParameters = commandLineParser.getParameters({ noFunctions: true });
const firstValue = (name) => ((cliParameters.values || {})[name] || [])[0];

const targetFilePath = firstValue('targetFilePath');
const dataStoresDirPath = firstValue('dataStoresDirPath');
const schemaOnly = !!(cliParameters.switches || {}).schemaOnly;

if (!targetFilePath) {
	console.error(
		`${moduleName}: --targetFilePath=<path> is REQUIRED and has no default. It names the single ` +
			`support store every family is merged into.`,
	);
	process.exit(1);
}
if (!dataStoresDirPath) {
	console.error(
		`${moduleName}: --dataStoresDirPath=<path> is REQUIRED and has no default. It names the ` +
			`dataStores root the source caches are read from.`,
	);
	process.exit(1);
}

// process.global must be standing BEFORE the five store modules are required: standards-database
// requires sqlite-instance and CALLS its moduleFunction at load time, and that call destructures
// process.global. This is the same trap actions.js documents as its reason for lazy-requiring them.
const xLog = {
	status: (oneMessage) => console.log(oneMessage),
	error: (oneMessage) => console.error(`ERROR ${oneMessage}`),
	verbose: () => {},
	result: (oneMessage) => process.stdout.write(oneMessage),
};
process.global = {
	xLog,
	getConfig: () => ({}),
	commandLineParameters: cliParameters,
	rawConfig: {},
};
Object.freeze(process.global);

const standardsDatabase = require(path.join(LIB_TREE, 'standards-database', 'standards-database'));
const decisionStore = require(path.join(LIB_TREE, 'decision-store', 'decision-store'));
const vectorStore = require(path.join(LIB_TREE, 'vector-store', 'vector-store'));
const vectorCache = require(path.join(LIB_TREE, 'embedding', 'vectorCache'));
const judgmentCache = require(path.join(LIB_TREE, 'judgment-cache', 'judgment-cache'));

const migration = require('./migrateCachesIntoSupportStore')({ xLog });
const { runSqliteCli, resolveSourceFilePaths, measureExpectedDistinctCount, carryOneFamily, MIGRATION_PLAN } =
	migration;

const scratchDirPath = path.join(path.dirname(path.resolve(targetFilePath)), 'migrationScratch');

const taskList = new taskListPlus();

// ---------------------------------------------------------------------
// PHASE A — build the merged schema THROUGH THE FIVE OWNING MODULES
// ---------------------------------------------------------------------
taskList.push((args, next) => {
	const parentDir = path.dirname(path.resolve(targetFilePath));
	if (!fs.existsSync(parentDir)) {
		fs.mkdirSync(parentDir, { recursive: true });
		xLog.status(`prepared ${parentDir}`);
	}
	if (!fs.existsSync(scratchDirPath)) {
		fs.mkdirSync(scratchDirPath, { recursive: true });
	}
	xLog.status(`\nPHASE A — building merged schema through the five owning modules`);
	next('', args);
});

// Each family's door, as DATA. vector-store's door is init({dbPath}); the other four are
// open({databaseFilePath}). The difference is the module's, not this runner's, so it is recorded
// here rather than branched on at the call site.
const STORE_FAMILY_OPENERS = [
	{ familyName: 'standards-database', openStore: (cb) => standardsDatabase().open({ databaseFilePath: targetFilePath }, cb) },
	{ familyName: 'decision-store', openStore: (cb) => decisionStore().open({ databaseFilePath: targetFilePath }, cb) },
	{ familyName: 'vector-store', openStore: (cb) => { const one = vectorStore({}); one.init({ dbPath: targetFilePath }, (err) => cb(err, one)); } },
	{ familyName: 'vectorCache', openStore: (cb) => vectorCache().open({ databaseFilePath: targetFilePath }, cb) },
	{ familyName: 'judgment-cache', openStore: (cb) => judgmentCache().open({ databaseFilePath: targetFilePath }, cb) },
];

taskList.push((args, next) => {
	const openedApis = {};
	const openNext = (index) => {
		if (index >= STORE_FAMILY_OPENERS.length) {
			next('', { ...args, openedApis });
			return;
		}
		const oneFamily = STORE_FAMILY_OPENERS[index];
		oneFamily.openStore((err, api) => {
			if (err) {
				next(`${moduleName} PHASE A: opening ${oneFamily.familyName}: ${err}`);
				return;
			}
			openedApis[oneFamily.familyName] = api;
			xLog.status(`  opened ${index + 1}/${STORE_FAMILY_OPENERS.length} ${oneFamily.familyName}`);
			openNext(index + 1);
		});
	};
	openNext(0);
});

// Dump the merged schema. This is the collision audit's empirical confirmation, printed so the DEVLOG
// records what the file actually holds rather than what the source was read to imply.
taskList.push((args, next) => {
	runSqliteCli(
		{
			databaseFilePath: targetFilePath,
			statementText:
				`SELECT type||'  '||name||'  (on '||COALESCE(tbl_name,'-')||')' ` +
				`FROM sqlite_master ORDER BY type, name;`,
		},
		(err, dumpText) => {
			if (err) {
				next(err);
				return;
			}
			xLog.status(`\n  MERGED SCHEMA (${dumpText.split('\n').length} objects):`);
			dumpText.split('\n').forEach((oneLine) => xLog.status(`    ${oneLine}`));
			next('', args);
		},
	);
});

taskList.push((args, next) => {
	if (schemaOnly) {
		xLog.status(`\n--schemaOnly given: stopping before the carry.`);
		next('skipRestOfPipe', args);
		return;
	}
	next('', args);
});

// ---------------------------------------------------------------------
// PHASE B/C — per family: measure the expected distinct count, carry, reconcile
// ---------------------------------------------------------------------
taskList.push((args, next) => {
	const reconciliation = [];
	const doNextFamily = (index) => {
		if (index >= MIGRATION_PLAN.length) {
			next('', { ...args, reconciliation });
			return;
		}
		const onePlanRow = MIGRATION_PLAN[index];
		xLog.status(`\nPHASE B — carrying '${onePlanRow.familyName}'`);

		const resolved = resolveSourceFilePaths({ onePlanRow, dataStoresDirPath });
		if (resolved.error) {
			next(resolved.error);
			return;
		}
		xLog.status(`  ${resolved.sourceFilePaths.length} source store(s)`);

		measureExpectedDistinctCount(
			{
				onePlanRow,
				sourceFilePaths: resolved.sourceFilePaths,
				scratchFilePath: path.join(scratchDirPath, `${onePlanRow.familyName}.keyUnion.sqlite3`),
			},
			(measureError, expectedDistinctCount) => {
				if (measureError) {
					next(measureError);
					return;
				}
				xLog.status(`  EXPECTED distinct ${onePlanRow.distinctKeyExpression}: ${expectedDistinctCount}`);

				carryOneFamily(
					{ onePlanRow, sourceFilePaths: resolved.sourceFilePaths, targetFilePath },
					(carryError) => {
						if (carryError) {
							next(carryError);
							return;
						}
						runSqliteCli(
							{
								databaseFilePath: targetFilePath,
								statementText: `SELECT count(*) FROM ${onePlanRow.tableName};`,
							},
							(countError, countText) => {
								if (countError) {
									next(countError);
									return;
								}
								const observedCount = Number(countText);
								const reconciled = observedCount === expectedDistinctCount;
								xLog.status(
									`  OBSERVED in merged store: ${observedCount} — ` +
										`${reconciled ? 'RECONCILED EXACTLY' : 'MISMATCH'}`,
								);
								reconciliation.push({
									familyName: onePlanRow.familyName,
									sourceStoreCount: resolved.sourceFilePaths.length,
									expectedDistinctCount,
									observedCount,
									reconciled,
								});
								doNextFamily(index + 1);
							},
						);
					},
				);
			},
		);
	};
	doNextFamily(0);
});

// ---------------------------------------------------------------------
// PHASE C2 — VERIFY-ON-READ through the owning modules. A count proves nothing was dropped; only a
// read back through vector-store.getVector proves the carried bytes still satisfy dtype, blob length,
// determinant re-hash and payload re-hash. 156,493 corrupt rows would pass a count check happily.
// ---------------------------------------------------------------------
taskList.push((args, next) => {
	xLog.status(`\nPHASE C — verify-on-read sample through the owning modules`);
	runSqliteCli(
		{
			databaseFilePath: targetFilePath,
			statementText: `SELECT vectorId FROM vectors ORDER BY vectorId LIMIT 25;`,
		},
		(err, idText) => {
			if (err) {
				next(err);
				return;
			}
			const sampleVectorIds = idText.split('\n').filter((oneId) => oneId.trim() !== '');
			if (sampleVectorIds.length === 0) {
				next(
					`${moduleName} PHASE C: the merged store returned NO vectorIds to sample. A verify pass ` +
						`with nothing to verify is not a passing verify pass.`,
				);
				return;
			}
			const verifiedStore = args.openedApis['vector-store'];
			let verifiedCount = 0;
			const verifyNext = (index) => {
				if (index >= sampleVectorIds.length) {
					xLog.status(`  ${verifiedCount}/${sampleVectorIds.length} sampled vectors passed verify-on-read`);
					next('', { ...args, verifiedCount, sampledCount: sampleVectorIds.length });
					return;
				}
				verifiedStore.getVector({ vectorId: sampleVectorIds[index] }, (getError, oneVector) => {
					if (getError) {
						next(`${moduleName} PHASE C: verify-on-read REFUSED a carried vector: ${getError}`);
						return;
					}
					if (!oneVector) {
						next(
							`${moduleName} PHASE C: vectorId ${sampleVectorIds[index]} is in the merged table ` +
								`but getVector returned nothing.`,
						);
						return;
					}
					verifiedCount = verifiedCount + 1;
					verifyNext(index + 1);
				});
			};
			verifyNext(0);
		},
	);
});

pipeRunner(taskList.getList(), {}, (err, args) => {
	if (err && err !== 'skipRestOfPipe') {
		console.error(`\n${moduleName} FAILED: ${err}`);
		process.exit(1);
		return;
	}
	if (err === 'skipRestOfPipe') {
		console.log(`\nschema-only run complete.`);
		process.exit(0);
		return;
	}
	const unreconciled = (args.reconciliation || []).filter((oneRow) => !oneRow.reconciled);
	console.log(`\n================ MIGRATION SUMMARY ================`);
	(args.reconciliation || []).forEach((oneRow) => {
		console.log(
			`  ${oneRow.reconciled ? 'RECONCILED' : 'MISMATCH  '}  ${oneRow.familyName}: ` +
				`expected ${oneRow.expectedDistinctCount}, observed ${oneRow.observedCount} ` +
				`(from ${oneRow.sourceStoreCount} source store(s))`,
		);
	});
	console.log(`  verify-on-read: ${args.verifiedCount}/${args.sampledCount} sampled vectors passed`);
	if (unreconciled.length > 0) {
		console.error(
			`\n${moduleName}: ${unreconciled.length} family(ies) did NOT reconcile exactly. ` +
				`There is no tolerance for a near miss.`,
		);
		process.exit(1);
		return;
	}
	console.log(`\nALL FAMILIES RECONCILED EXACTLY.`);
	process.exit(0);
});
