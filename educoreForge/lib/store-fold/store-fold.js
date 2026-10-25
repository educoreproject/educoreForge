'use strict';

// store-fold.js — return a store's novel rows to the store of record (EC3, build-store economy, VELVET_RIDGE for BRONZE_CROWN,
// 2026-10-25). The CLI is graphBuilder -foldStore (apps/graph-builder/lib/actions.js); this module is its whole body but the
// schema step, which the action injects because the owning modules (standards-database, vector-store, decision-store,
// judgment-cache, vectorCache) declare their own tables and the fold never declares one itself.
//
// THE WAVE LANES' FOLD DISCIPLINE, made one tool (storeFoldTableRegistry.json is the table list, in parent-before-child order):
//   1. count the source rows whose UNIQUE content address the target lacks (missing), and the ones it holds (overlap);
//   2. compare every overlapping row's payload: a different payload under one address is a CONFLICT. First writer wins, so the
//      target's row stands; but ANY conflict stops the fold before a row is written (BRONZE_CROWN, 2026-10-25), and the plan
//      names the first few;
//   3. a decision block for a pair the target already holds blocks for is an ORDER CONFLICT (the latest block for a pair is the
//      highest seq, and an insert lands last): allowed only when the source is a delta of THIS target stamped after every one of
//      the target's blocks for that pair (lib/store-reference's referenceMaxSequenceAtStamp);
//   4. on --apply, ONE transaction: INSERT OR IGNORE the missing rows in the source's own order, check every table's
//      after = before + missing, run PRAGMA foreign_key_check (a delta ran without FOREIGN KEYs, ruling F: the store of record is
//      where they hold), and ROLLBACK on any failure, so a refused fold leaves the target exactly as it was;
//   5. one machine-wide fold lock (a directory, mkdir is atomic), held across plan and apply.
//
// The source is opened READ-ONLY and never written. Both connections are better-sqlite3 directly, not sqlite-instance: the fold
// streams rows with bound parameters (BLOB vectors, decision blocks of hundreds of MB), which sqlite-instance's string SQL
// cannot do, and every exception is turned into an error string at the one boundary (attemptSql) rather than used for control.
//
//   planFold({ sourceFilePath, targetFilePath }) -> { plan } | { error }                            (reads both, writes neither)
//   applyFold({ plan, ensureTargetSchema }, callback) -> ('', report) | (refusal)                   (writes the target only)
//      ensureTargetSchema(familyNameList, done): the action's; opens each owning module on the target so its tables exist
//   acquireFoldLock({ lockDirPath, ownerText }) -> '' | refusal;  releaseFoldLock({ lockDirPath }) -> '' | refusal
//
// Async style: callback(errString, result); camelCase only; no async/await.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const tableRegistry = require(path.join(__dirname, 'storeFoldTableRegistry.json'));

const STORE_REFERENCE_TABLE_NAME = 'storeReferenceStamps';
const FOLD_LOCK_DIR_PATH = '/tmp/miloPersistence/educoreForgeStoreFold.lock';
const CONFLICT_EXAMPLE_LIMIT = 5;
const ADDRESS_SEPARATOR = '\u0000';

// attemptSql — the ONE boundary where a better-sqlite3 exception becomes an error string
const attemptSql = (sqlWork) => {
	let result = null;
	let sqlFault = '';
	try {
		result = sqlWork();
	} catch (sqlError) {
		sqlFault = sqlError.message;
	}
	return sqlFault ? { error: sqlFault } : { result };
};

const quoted = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;
const tableExists = (connection, tableName) => connection.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).all(tableName).length > 0;
const columnNameListOf = (connection, tableName) => connection.prepare(`PRAGMA table_info(${quoted(tableName)})`).all().map((oneColumn) => oneColumn.name);
const addressOf = (oneRow, addressColumnList) => addressColumnList.map((columnName) => String(oneRow[columnName])).join(ADDRESS_SEPARATOR);
const payloadEqual = (leftValue, rightValue) => (Buffer.isBuffer(leftValue) && Buffer.isBuffer(rightValue) ? leftValue.equals(rightValue) : leftValue === rightValue);

// orderThresholdFor — the target's decision-block seq at or below which the source is known to be LATER: the source's own
// decisionStore stamp, when the source is a delta of this very target; otherwise null (no row of the target is known older)
const orderThresholdFor = ({ sourceConnection, targetFilePath }) => {
	if (!tableExists(sourceConnection, STORE_REFERENCE_TABLE_NAME)) {
		return null;
	}
	const stampRow = sourceConnection.prepare(`SELECT referenceDatabaseFilePath, referenceMaxSequenceAtStamp FROM ${STORE_REFERENCE_TABLE_NAME} WHERE familyName='decisionStore'`).get();
	return stampRow && path.resolve(stampRow.referenceDatabaseFilePath) === path.resolve(targetFilePath) && stampRow.referenceMaxSequenceAtStamp != null ? Number(stampRow.referenceMaxSequenceAtStamp) : null;
};

// planTable — one registry table: counts, overlap, conflicts. Reads only.
const planTable = ({ sourceConnection, targetConnection, tableRow, orderThreshold }) => {
	const { tableName, addressColumnList, payloadColumnList, pairColumnName } = tableRow;
	const sourceRowCount = sourceConnection.prepare(`SELECT COUNT(*) AS rowCount FROM ${quoted(tableName)}`).get().rowCount;
	const targetTablePresent = tableExists(targetConnection, tableName);
	const targetRowCountBefore = targetTablePresent ? targetConnection.prepare(`SELECT COUNT(*) AS rowCount FROM ${quoted(tableName)}`).get().rowCount : 0;
	const addressSelect = addressColumnList.map(quoted).join(', ');
	const targetAddressSet = new Set(targetTablePresent ? targetConnection.prepare(`SELECT ${addressSelect} FROM ${quoted(tableName)}`).all().map((oneRow) => addressOf(oneRow, addressColumnList)) : []);
	const payloadSelect = addressColumnList.concat(payloadColumnList).map(quoted).join(', ');
	const targetPayloadStatement = targetTablePresent ? targetConnection.prepare(`SELECT ${payloadColumnList.map(quoted).join(', ')} FROM ${quoted(tableName)} WHERE ${addressColumnList.map((columnName) => `${quoted(columnName)} = ?`).join(' AND ')}`) : null;
	const targetPairStatement = pairColumnName && targetTablePresent ? targetConnection.prepare(`SELECT seq FROM ${quoted(tableName)} WHERE ${quoted(pairColumnName)} = ? ORDER BY seq DESC LIMIT 1`) : null;
	let missingCount = 0;
	let overlapCount = 0;
	const conflictExampleList = [];
	let conflictCount = 0;
	const orderConflictExampleList = [];
	let orderConflictCount = 0;
	const checkedPairSet = new Set();
	for (const sourceRow of sourceConnection.prepare(`SELECT ${payloadSelect}${pairColumnName && payloadColumnList.indexOf(pairColumnName) === -1 ? `, ${quoted(pairColumnName)}` : ''} FROM ${quoted(tableName)}`).iterate()) {
		const sourceAddress = addressOf(sourceRow, addressColumnList);
		if (!targetAddressSet.has(sourceAddress)) {
			missingCount += 1;
			if (targetPairStatement && !checkedPairSet.has(sourceRow[pairColumnName])) {
				checkedPairSet.add(sourceRow[pairColumnName]);
				const latestTargetRow = targetPairStatement.get(sourceRow[pairColumnName]);
				if (latestTargetRow && (orderThreshold === null || Number(latestTargetRow.seq) > orderThreshold)) {
					orderConflictCount += 1;
					if (orderConflictExampleList.length < CONFLICT_EXAMPLE_LIMIT) {
						orderConflictExampleList.push(`${pairColumnName} '${sourceRow[pairColumnName]}': the target already holds its block seq ${latestTargetRow.seq}${orderThreshold === null ? ' and the source is not a delta of this target, so which is later is unknown' : `, written after the source's stamp (seq ${orderThreshold})`}`);
					}
				}
			}
			continue;
		}
		overlapCount += 1;
		const targetPayloadRow = targetPayloadStatement.get(...addressColumnList.map((columnName) => sourceRow[columnName]));
		const differingColumnList = payloadColumnList.filter((columnName) => !payloadEqual(sourceRow[columnName], targetPayloadRow[columnName]));
		if (differingColumnList.length > 0) {
			conflictCount += 1;
			if (conflictExampleList.length < CONFLICT_EXAMPLE_LIMIT) {
				conflictExampleList.push(`address (${addressColumnList.join(', ')}) = (${sourceAddress.split(ADDRESS_SEPARATOR).join(', ')}): ${differingColumnList.join(', ')} differ`);
			}
		}
	}
	return { tableName, familyName: tableRow.familyName, sourceRowCount, targetTablePresent, targetRowCountBefore, missingCount, overlapCount, conflictCount, conflictExampleList, orderConflictCount, orderConflictExampleList };
};

// -----
// planFold — what a fold WOULD do. Both stores are opened read-only; nothing is written anywhere.
const planFold = ({ sourceFilePath, targetFilePath }) => {
	if (typeof sourceFilePath !== 'string' || sourceFilePath.trim() === '' || typeof targetFilePath !== 'string' || targetFilePath.trim() === '') {
		return { error: `storeFold.planFold: sourceFilePath and targetFilePath are both REQUIRED (got '${sourceFilePath}', '${targetFilePath}'); there is no default` };
	}
	const absoluteSourceFilePath = path.resolve(sourceFilePath);
	const absoluteTargetFilePath = path.resolve(targetFilePath);
	if (absoluteSourceFilePath === absoluteTargetFilePath) {
		return { error: `storeFold.planFold: the source and the target are the same file '${absoluteSourceFilePath}'` };
	}
	const absentList = [absoluteSourceFilePath, absoluteTargetFilePath].filter((filePath) => !fs.existsSync(filePath));
	if (absentList.length > 0) {
		return { error: `storeFold.planFold: not on disk: ${absentList.join(', ')}. A fold never creates a store; the target is a store of record that already exists.` };
	}
	const opened = attemptSql(() => ({ sourceConnection: new Database(absoluteSourceFilePath, { readonly: true, fileMustExist: true }), targetConnection: new Database(absoluteTargetFilePath, { readonly: true, fileMustExist: true }) }));
	if (opened.error) {
		return { error: `storeFold.planFold: opening the stores read-only: ${opened.error}` };
	}
	const { sourceConnection, targetConnection } = opened.result;
	const targetIsDelta = attemptSql(() => tableExists(targetConnection, STORE_REFERENCE_TABLE_NAME));
	if (targetIsDelta.error || targetIsDelta.result) {
		sourceConnection.close();
		targetConnection.close();
		return { error: targetIsDelta.error ? `storeFold.planFold: reading the target: ${targetIsDelta.error}` : `storeFold.planFold: the target '${absoluteTargetFilePath}' is itself a DELTA (it carries ${STORE_REFERENCE_TABLE_NAME}); a fold goes INTO a store of record, never into a delta` };
	}
	const planned = attemptSql(() => {
		const orderThreshold = orderThresholdFor({ sourceConnection, targetFilePath: absoluteTargetFilePath });
		const tablePlanList = tableRegistry.tableList
			.filter((tableRow) => tableExists(sourceConnection, tableRow.tableName))
			.map((tableRow) => planTable({ sourceConnection, targetConnection, tableRow, orderThreshold }));
		return { tablePlanList, orderThreshold };
	});
	sourceConnection.close();
	targetConnection.close();
	if (planned.error) {
		return { error: `storeFold.planFold: reading the stores: ${planned.error}` };
	}
	const { tablePlanList, orderThreshold } = planned.result;
	if (tablePlanList.length === 0) {
		return { error: `storeFold.planFold: '${absoluteSourceFilePath}' holds none of the tables in storeFoldTableRegistry.json (${tableRegistry.tableList.map((tableRow) => tableRow.tableName).join(', ')}): it is not a graphBuilder store` };
	}
	const conflictTotal = tablePlanList.reduce((soFar, tablePlan) => soFar + tablePlan.conflictCount + tablePlan.orderConflictCount, 0);
	return { plan: { sourceFilePath: absoluteSourceFilePath, targetFilePath: absoluteTargetFilePath, orderThreshold, tablePlanList, conflictTotal, missingTotal: tablePlanList.reduce((soFar, tablePlan) => soFar + tablePlan.missingCount, 0) } };
};

// copiedColumnListFor — every source column but the omitted ones, or a refusal naming the columns the target's table lacks (two
// schema generations; checked for every table BEFORE the transaction opens, so nothing is half-written over it)
const copiedColumnListFor = ({ sourceConnection, targetConnection, tableRow }) => {
	const targetColumnNameSet = new Set(columnNameListOf(targetConnection, tableRow.tableName));
	const copiedColumnList = columnNameListOf(sourceConnection, tableRow.tableName).filter((columnName) => tableRow.omittedColumnList.indexOf(columnName) === -1);
	const absentInTargetList = copiedColumnList.filter((columnName) => !targetColumnNameSet.has(columnName));
	return absentInTargetList.length > 0 ? { error: `${tableRow.tableName}: the target's table lacks column(s) ${absentInTargetList.join(', ')} the source carries; the two are not the same schema generation` } : { copiedColumnList };
};

// insertMissingRows — inside the open transaction: the source rows whose address the target lacks, in the source's own order,
// INSERT OR IGNORE with the copied columns. Returns the count it inserted.
const insertMissingRows = ({ sourceConnection, targetConnection, tableRow, copiedColumnList }) => {
	const { tableName, addressColumnList, sourceOrderColumnName } = tableRow;
	const presentStatement = targetConnection.prepare(`SELECT 1 FROM ${quoted(tableName)} WHERE ${addressColumnList.map((columnName) => `${quoted(columnName)} = ?`).join(' AND ')} LIMIT 1`);
	const insertStatement = targetConnection.prepare(`INSERT OR IGNORE INTO ${quoted(tableName)} (${copiedColumnList.map(quoted).join(', ')}) VALUES (${copiedColumnList.map(() => '?').join(', ')})`);
	let insertedCount = 0;
	const orderClause = sourceOrderColumnName ? ` ORDER BY ${quoted(sourceOrderColumnName)}` : '';
	for (const sourceRow of sourceConnection.prepare(`SELECT ${copiedColumnList.map(quoted).join(', ')} FROM ${quoted(tableName)}${orderClause}`).iterate()) {
		if (presentStatement.get(...addressColumnList.map((columnName) => sourceRow[columnName]))) {
			continue;
		}
		insertedCount += insertStatement.run(...copiedColumnList.map((columnName) => sourceRow[columnName])).changes;
	}
	return insertedCount;
};

// -----
// applyFold — write the plan. Refuses a plan with any conflict; ONE transaction; rolls back on a count or FOREIGN KEY failure.
const applyFold = ({ plan, ensureTargetSchema }, callback) => {
	if (!plan || !Array.isArray(plan.tablePlanList)) {
		callback('storeFold.applyFold: a plan from planFold is REQUIRED');
		return;
	}
	if (plan.conflictTotal > 0) {
		callback(`storeFold.applyFold: REFUSED — the plan holds ${plan.conflictTotal} conflict(s); a fold with any conflict is a STOP (nothing was written). Read the dry run's listing.`);
		return;
	}
	const familyNameList = [...new Set(plan.tablePlanList.map((tablePlan) => tablePlan.familyName))];
	ensureTargetSchema(familyNameList, (schemaErr) => {
		if (schemaErr) {
			callback(`storeFold.applyFold: preparing the target's tables through their owning modules: ${schemaErr}`);
			return;
		}
		const opened = attemptSql(() => {
			const targetConnection = new Database(plan.targetFilePath, { fileMustExist: true });
			targetConnection.pragma('busy_timeout = 5000');
			// the FOREIGN KEYs are checked ONCE, explicitly, over the whole fold (PRAGMA foreign_key_check below), not row by row: the
			// refusal then names the offending row, and no statement fails part-way through a table
			targetConnection.pragma('foreign_keys = OFF');
			return { sourceConnection: new Database(plan.sourceFilePath, { readonly: true, fileMustExist: true }), targetConnection };
		});
		if (opened.error) {
			callback(`storeFold.applyFold: opening the stores: ${opened.error}`);
			return;
		}
		const { sourceConnection, targetConnection } = opened.result;
		const tableRowByName = new Map(tableRegistry.tableList.map((tableRow) => [tableRow.tableName, tableRow]));
		const columnCheck = attemptSql(() => plan.tablePlanList.map((tablePlan) => ({ tableName: tablePlan.tableName, ...copiedColumnListFor({ sourceConnection, targetConnection, tableRow: tableRowByName.get(tablePlan.tableName) }) })));
		const columnRefusalList = columnCheck.error ? [columnCheck.error] : columnCheck.result.filter((oneCheck) => oneCheck.error).map((oneCheck) => oneCheck.error);
		if (columnRefusalList.length > 0) {
			sourceConnection.close();
			targetConnection.close();
			callback(`storeFold.applyFold: REFUSED before writing — ${columnRefusalList.join('; ')}`);
			return;
		}
		const copiedColumnListByTableName = new Map(columnCheck.result.map((oneCheck) => [oneCheck.tableName, oneCheck.copiedColumnList]));
		const folded = attemptSql(() => {
			targetConnection.exec('BEGIN IMMEDIATE');
			const tableReportList = plan.tablePlanList.map((tablePlan) => {
				const tableRow = tableRowByName.get(tablePlan.tableName);
				const beforeCount = targetConnection.prepare(`SELECT COUNT(*) AS rowCount FROM ${quoted(tablePlan.tableName)}`).get().rowCount;
				const insertedCount = insertMissingRows({ sourceConnection, targetConnection, tableRow, copiedColumnList: copiedColumnListByTableName.get(tablePlan.tableName) });
				const afterCount = targetConnection.prepare(`SELECT COUNT(*) AS rowCount FROM ${quoted(tablePlan.tableName)}`).get().rowCount;
				return { tableName: tablePlan.tableName, beforeCount, plannedMissingCount: tablePlan.missingCount, insertedCount, afterCount, conserved: afterCount === beforeCount + tablePlan.missingCount && insertedCount === tablePlan.missingCount };
			});
			const foreignKeyViolationList = targetConnection.prepare('PRAGMA foreign_key_check').all();
			return { tableReportList, foreignKeyViolationList };
		});
		const rollBack = () => attemptSql(() => targetConnection.inTransaction && targetConnection.exec('ROLLBACK'));
		const closeBoth = () => {
			sourceConnection.close();
			targetConnection.close();
		};
		if (folded.error) {
			const rollbackResult = rollBack();
			closeBoth();
			callback(`storeFold.applyFold: REFUSED and ROLLED BACK — ${folded.error}${rollbackResult.error ? ` (and the ROLLBACK failed: ${rollbackResult.error})` : ''}`);
			return;
		}
		const { tableReportList, foreignKeyViolationList } = folded.result;
		const unconservedList = tableReportList.filter((tableReport) => !tableReport.conserved);
		if (unconservedList.length > 0 || foreignKeyViolationList.length > 0) {
			const rollbackResult = rollBack();
			closeBoth();
			callback(
				`storeFold.applyFold: REFUSED and ROLLED BACK — ` +
					(unconservedList.length > 0 ? `after != before + missing for ${unconservedList.map((tableReport) => `${tableReport.tableName} (before ${tableReport.beforeCount} + missing ${tableReport.plannedMissingCount}, inserted ${tableReport.insertedCount}, after ${tableReport.afterCount})`).join('; ')}` : '') +
					(foreignKeyViolationList.length > 0 ? `${unconservedList.length > 0 ? '; and ' : ''}PRAGMA foreign_key_check found ${foreignKeyViolationList.length} row(s) naming a parent the target does not hold (first: ${JSON.stringify(foreignKeyViolationList[0])})` : '') +
					`${rollbackResult.error ? ` (and the ROLLBACK failed: ${rollbackResult.error})` : ''}. The target is exactly as it was.`,
			);
			return;
		}
		const committed = attemptSql(() => targetConnection.exec('COMMIT'));
		closeBoth();
		if (committed.error) {
			callback(`storeFold.applyFold: COMMIT failed: ${committed.error}`);
			return;
		}
		callback('', { sourceFilePath: plan.sourceFilePath, targetFilePath: plan.targetFilePath, tableReportList, foreignKeyViolationCount: 0 });
	});
};

// -----
// THE FOLD LOCK — one per machine (a directory; mkdir is atomic). Held from the plan through the apply, so two folds can never
// count missing rows against a target the other is writing.
const acquireFoldLock = ({ lockDirPath = FOLD_LOCK_DIR_PATH, ownerText }) => {
	const made = attemptSql(() => fs.mkdirSync(lockDirPath));
	if (made.error) {
		const ownerFilePath = path.join(lockDirPath, 'owner');
		const heldBy = fs.existsSync(ownerFilePath) ? fs.readFileSync(ownerFilePath, 'utf8').trim() : 'an owner that wrote no name';
		return `storeFold: the fold lock '${lockDirPath}' is held (${heldBy}). One fold at a time; wait for it, or remove the lock by hand only after checking that process is gone.`;
	}
	fs.writeFileSync(path.join(lockDirPath, 'owner'), `${ownerText} (pid ${process.pid} at ${new Date().toISOString()})`);
	return '';
};
const releaseFoldLock = ({ lockDirPath = FOLD_LOCK_DIR_PATH }) => {
	const removed = attemptSql(() => fs.rmSync(lockDirPath, { recursive: true }));
	return removed.error ? `storeFold: releasing the fold lock '${lockDirPath}': ${removed.error}` : '';
};

module.exports = { planFold, applyFold, acquireFoldLock, releaseFoldLock, FOLD_LOCK_DIR_PATH, tableRegistry };
