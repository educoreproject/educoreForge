'use strict';

// store-reference.js — a DELTA store over a read-only REFERENCE (EC2/EC3, build-store economy, VELVET_RIDGE for BRONZE_CROWN,
// 2026-10-25; design DESIGN-EC2EC3-slimStoresSharedCaches-102526.md, approved with ruling F the same day).
//
// WHY. A build used to get a cp -c clone of a whole store of record (9 GB) and wrote a fresh standards database beside it, so a
// one-standard bridged build re-wrote both hubs' blocks and 162,897 frozen vectors (1.83 GB, measured M2) that the store of record
// already held byte for byte. Now a build may name a REFERENCE per store family: it reads the reference in place and writes to its
// own small store only what the reference does not hold. There is still ONE database of record (TQ, 2026-08-04); a delta is a
// short-lived journal of it, and graphBuilder -foldStore returns the delta's novel rows to it.
//
// THE DELTA NAMES ITS OWN REFERENCE. stampReference writes one row per family into the delta's storeReferenceStamps table (the
// reference's absolute path, its row count and, where the family has one, its maximum append sequence). Every family module calls
// openReferenceLayer at open: a store with no stamp for that family is a standalone store and gets null (the code path of every
// store made before EC: nothing else changes); a stamped store REFUSES to open unless its reference is on disk and holds at least
// the rows it held when stamped. So a delta can never be read, written, replayed or promoted without the store it is a delta of
// (BRONZE_CROWN ruling F, condition 4): there is no way to open one half.
//
// THE REFERENCE IS PHYSICALLY READ-ONLY. It is opened with better-sqlite3 directly, { readonly: true, fileMustExist: true },
// because sqlite-instance has no read-only open and the guarantee must be the connection's, not the caller's discipline: a write
// through it is refused by SQLite itself ("attempt to write a readonly database", probed 2026-10-25).
//
//   stampReference({ databaseFilePath, familyName, referenceDatabaseFilePath }, callback) -> ('', { stamped, alreadyStamped })
//   openReferenceLayer({ getRows, familyName, databaseFilePath }, callback)                -> ('', layer | null)
//      layer = { familyName, referenceDatabaseFilePath, referenceRowCountAtStamp, referenceMaxSequenceAtStamp,
//                getReferenceRows(statement, callback) }
//   readStampList({ getRows }, callback)                                                    -> ('', [stampRow, ...])
//   rowsFromLayers({ getRows, referenceLayer })(statement, callback) -> the own store's rows, or the reference's when the own
//      store has none (for lookups by a unique address, where "own first" is the whole rule)
//
// Async style: callback(errString, result); camelCase only; no async/await.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const sqlString = require('sqlstring-sqlite');

const TREE_LIB = path.join(__dirname, '..');
// THE LAZY-REQUIRE TRAP: sqlite-instance's factory destructures process.global, and vector-store (which requires this module) is
// loaded by graphBuilder BEFORE bootstrap, so the factory is invoked only inside stampReference, never at load
const sqliteInstanceModule = require(path.join(TREE_LIB, 'sqlite-instance', 'sqlite-instance'));
const familyRegistry = require(path.join(__dirname, 'storeReferenceFamilyRegistry.json'));

const RAW_OPTS = { noTableNameOk: true, suppressStatementLog: true };
// the stamp table; storeReferenceOps is the bookkeeping table sqlite-instance's getTable makes for the handle, as every store has
const STORE_REFERENCE_TABLE_NAME = 'storeReferenceStamps';
const STORE_REFERENCE_HANDLE_TABLE_NAME = 'storeReferenceOps';
const esc = (value) => (value == null ? 'NULL' : sqlString.escape(`${value}`));

const familyRowFor = (familyName) => familyRegistry.familyList.find((oneFamily) => oneFamily.familyName === familyName);
const familyNameList = () => familyRegistry.familyList.map((oneFamily) => oneFamily.familyName);

// openReadOnlyConnection — the one place a better-sqlite3 exception becomes an error string (the reference is not opened through
// sqlite-instance, whose own boundary does the same conversion for every other store)
const openReadOnlyConnection = (referenceDatabaseFilePath) => {
	if (!fs.existsSync(referenceDatabaseFilePath)) {
		return { error: `the reference '${referenceDatabaseFilePath}' does not exist` };
	}
	let connection = null;
	let openFault = '';
	try {
		connection = new Database(referenceDatabaseFilePath, { readonly: true, fileMustExist: true });
		connection.pragma('busy_timeout = 5000');
	} catch (openError) {
		openFault = openError.message;
	}
	return openFault ? { error: `the reference '${referenceDatabaseFilePath}' could not be opened read-only: ${openFault}` } : { connection };
};
const allRowsOf = (connection, statement) => {
	let rowList = null;
	let queryFault = '';
	try {
		rowList = connection.prepare(statement).all();
	} catch (queryError) {
		queryFault = queryError.message;
	}
	return queryFault ? { error: queryFault } : { rowList };
};

// referenceShapeOf — the counted table's row count (and maximum sequence) in an opened reference, or a refusal naming why the
// reference is not a store of this family
const referenceShapeOf = ({ connection, familyRow, referenceDatabaseFilePath }) => {
	const tableCheck = allRowsOf(connection, `SELECT name FROM sqlite_master WHERE type='table' AND name=${esc(familyRow.countedTableName)};`);
	if (tableCheck.error) {
		return { error: `reading the reference '${referenceDatabaseFilePath}': ${tableCheck.error}` };
	}
	if (tableCheck.rowList.length === 0) {
		return { error: `the reference '${referenceDatabaseFilePath}' holds no ${familyRow.countedTableName} table: it is not a ${familyRow.familyName} store` };
	}
	const sequenceClause = familyRow.sequenceColumnName ? `, MAX(${familyRow.sequenceColumnName}) AS maxSequence` : '';
	const countRead = allRowsOf(connection, `SELECT COUNT(*) AS rowCount${sequenceClause} FROM ${familyRow.countedTableName};`);
	if (countRead.error) {
		return { error: `counting ${familyRow.countedTableName} in the reference '${referenceDatabaseFilePath}': ${countRead.error}` };
	}
	const countRow = countRead.rowList[0];
	return { rowCount: Number(countRow.rowCount), maxSequence: familyRow.sequenceColumnName ? (countRow.maxSequence == null ? 0 : Number(countRow.maxSequence)) : null };
};

const buildStampTable = ({ runSql }, callback) =>
	runSql(
		`CREATE TABLE IF NOT EXISTS ${STORE_REFERENCE_TABLE_NAME} (
			familyName                  TEXT PRIMARY KEY,
			referenceDatabaseFilePath   TEXT NOT NULL,
			referenceRowCountAtStamp    INTEGER NOT NULL,
			referenceMaxSequenceAtStamp INTEGER,
			stampedAt                   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);`,
		(err) => callback(err || ''),
	);

// readStampList — every family stamp this store carries; [] for a standalone store (no table at all)
const readStampList = ({ getRows }, callback) => {
	getRows(`SELECT name FROM sqlite_master WHERE type='table' AND name=${esc(STORE_REFERENCE_TABLE_NAME)};`, (tableErr, tableRows) => {
		if (tableErr) {
			callback(`storeReference.readStampList: ${tableErr}`);
			return;
		}
		if (!tableRows || tableRows.length === 0) {
			callback('', []);
			return;
		}
		getRows(`SELECT * FROM ${STORE_REFERENCE_TABLE_NAME} ORDER BY familyName;`, (readErr, stampRows) => callback(readErr ? `storeReference.readStampList: ${readErr}` : '', stampRows || []));
	});
};

// -----
// stampReference — make databaseFilePath a delta of referenceDatabaseFilePath for one family. Idempotent for the SAME reference
// (the first stamp is kept: its counts are what the delta was built over); a DIFFERENT reference is refused by name.
const stampReference = ({ databaseFilePath, familyName, referenceDatabaseFilePath }, callback) => {
	const familyRow = familyRowFor(familyName);
	if (!familyRow) {
		callback(`storeReference.stampReference: '${familyName}' is not a family in storeReferenceFamilyRegistry.json (${familyNameList().join(', ')})`);
		return;
	}
	if (typeof databaseFilePath !== 'string' || databaseFilePath.trim() === '' || typeof referenceDatabaseFilePath !== 'string' || referenceDatabaseFilePath.trim() === '') {
		callback(`storeReference.stampReference: databaseFilePath and referenceDatabaseFilePath are both REQUIRED (got '${databaseFilePath}', '${referenceDatabaseFilePath}'); there is no default`);
		return;
	}
	const deltaFilePath = path.resolve(databaseFilePath);
	const absoluteReferenceFilePath = path.resolve(referenceDatabaseFilePath);
	if (deltaFilePath === absoluteReferenceFilePath) {
		callback(`storeReference.stampReference: the ${familyName} store and its reference are the same file '${deltaFilePath}': a store cannot be a delta of itself`);
		return;
	}
	if (!fs.existsSync(path.dirname(deltaFilePath))) {
		callback(`storeReference.stampReference: the directory '${path.dirname(deltaFilePath)}' does not exist. Refusing to create a database somewhere nobody has prepared.`);
		return;
	}
	const opened = openReadOnlyConnection(absoluteReferenceFilePath);
	if (opened.error) {
		callback(`storeReference.stampReference (${familyName}): ${opened.error}`);
		return;
	}
	const shape = referenceShapeOf({ connection: opened.connection, familyRow, referenceDatabaseFilePath: absoluteReferenceFilePath });
	opened.connection.close();
	if (shape.error) {
		callback(`storeReference.stampReference (${familyName}): ${shape.error}`);
		return;
	}
	sqliteInstanceModule({}).initDatabaseInstance(deltaFilePath, (initErr, dbInstance) => {
		if (initErr) {
			callback(`storeReference.stampReference '${deltaFilePath}': ${initErr}`);
			return;
		}
		dbInstance.getTable(STORE_REFERENCE_HANDLE_TABLE_NAME, RAW_OPTS, (tableErr, tableRef) => {
			if (tableErr) {
				callback(`storeReference.stampReference '${deltaFilePath}': ${tableErr}`);
				return;
			}
			const runSql = (statement, cb) => tableRef.runStatement(statement, RAW_OPTS, cb);
			const getRows = (statement, cb) => tableRef.getData(statement, RAW_OPTS, cb);
			buildStampTable({ runSql }, (schemaErr) => {
				if (schemaErr) {
					callback(`storeReference.stampReference '${deltaFilePath}': ${schemaErr}`);
					return;
				}
				getRows(`SELECT * FROM ${STORE_REFERENCE_TABLE_NAME} WHERE familyName=${esc(familyName)};`, (readErr, stampRows) => {
					if (readErr) {
						callback(`storeReference.stampReference '${deltaFilePath}': ${readErr}`);
						return;
					}
					const existingStamp = (stampRows || [])[0];
					if (existingStamp) {
						if (existingStamp.referenceDatabaseFilePath !== absoluteReferenceFilePath) {
							callback(`storeReference.stampReference: '${deltaFilePath}' is already a ${familyName} delta of '${existingStamp.referenceDatabaseFilePath}', not of '${absoluteReferenceFilePath}'. A delta has ONE reference; use a new store.`);
							return;
						}
						callback('', { stamped: false, alreadyStamped: true });
						return;
					}
					runSql(
						`INSERT INTO ${STORE_REFERENCE_TABLE_NAME} (familyName, referenceDatabaseFilePath, referenceRowCountAtStamp, referenceMaxSequenceAtStamp)
						 VALUES (${esc(familyName)}, ${esc(absoluteReferenceFilePath)}, ${shape.rowCount}, ${shape.maxSequence == null ? 'NULL' : shape.maxSequence});`,
						(insertErr) => callback(insertErr ? `storeReference.stampReference '${deltaFilePath}': ${insertErr}` : '', insertErr ? undefined : { stamped: true, alreadyStamped: false }),
					);
				});
			});
		});
	});
};

// -----
// openReferenceLayer — null for a store with no stamp for this family; else the opened, verified reference. A stamped store whose
// reference is missing, unreadable, or SMALLER than when stamped is refused by name: the reference is append-only, so fewer rows
// means it is not the store this delta was built over, and reading the delta alone would serve half a store.
const openReferenceLayer = ({ getRows, familyName, databaseFilePath }, callback) => {
	const familyRow = familyRowFor(familyName);
	if (!familyRow) {
		callback(`storeReference.openReferenceLayer: '${familyName}' is not a family in storeReferenceFamilyRegistry.json (${familyNameList().join(', ')})`);
		return;
	}
	readStampList({ getRows }, (stampErr, stampList) => {
		if (stampErr) {
			callback(stampErr);
			return;
		}
		const stampRow = stampList.find((oneStamp) => oneStamp.familyName === familyName);
		if (!stampRow) {
			callback('', null);
			return;
		}
		const refusalPrefix = `'${databaseFilePath}' is a ${familyName} DELTA of '${stampRow.referenceDatabaseFilePath}' (stamped ${stampRow.stampedAt}), and it is never opened without that reference`;
		const opened = openReadOnlyConnection(stampRow.referenceDatabaseFilePath);
		if (opened.error) {
			callback(`storeReference: REFUSED — ${refusalPrefix}: ${opened.error}`);
			return;
		}
		const shape = referenceShapeOf({ connection: opened.connection, familyRow, referenceDatabaseFilePath: stampRow.referenceDatabaseFilePath });
		if (shape.error) {
			opened.connection.close();
			callback(`storeReference: REFUSED — ${refusalPrefix}: ${shape.error}`);
			return;
		}
		if (shape.rowCount < Number(stampRow.referenceRowCountAtStamp)) {
			opened.connection.close();
			callback(`storeReference: REFUSED — ${refusalPrefix}: it now holds ${shape.rowCount} ${familyRow.countedTableName} row(s), fewer than the ${stampRow.referenceRowCountAtStamp} it held when stamped. A reference only grows; this is not the store the delta was built over.`);
			return;
		}
		const getReferenceRows = (statement, rowsCallback) => {
			const read = allRowsOf(opened.connection, statement);
			rowsCallback(read.error ? `reference '${stampRow.referenceDatabaseFilePath}': ${read.error}` : null, read.error ? [] : read.rowList);
		};
		callback('', {
			familyName,
			referenceDatabaseFilePath: stampRow.referenceDatabaseFilePath,
			referenceRowCountAtStamp: Number(stampRow.referenceRowCountAtStamp),
			referenceMaxSequenceAtStamp: stampRow.referenceMaxSequenceAtStamp == null ? null : Number(stampRow.referenceMaxSequenceAtStamp),
			getReferenceRows,
		});
	});
};

// stampListOfFile — ⟪BRONZE_CROWN ruling 2026-10-25⟫ a store file's stamps, read through a READ-ONLY connection and synchronously, for a
// caller that must know whether a store is a delta before it does anything with it (-goldEvalCheck, -stampPromotion: golds come only from a
// store of record or a folded store). { stampList } ([] for a standalone store) or { error }.
const stampListOfFile = (databaseFilePath) => {
	const opened = openReadOnlyConnection(databaseFilePath);
	if (opened.error) {
		return { error: opened.error };
	}
	const tableRead = allRowsOf(opened.connection, `SELECT name FROM sqlite_master WHERE type='table' AND name=${esc(STORE_REFERENCE_TABLE_NAME)};`);
	const stampRead = tableRead.error || tableRead.rowList.length === 0 ? { rowList: [] } : allRowsOf(opened.connection, `SELECT * FROM ${STORE_REFERENCE_TABLE_NAME} ORDER BY familyName;`);
	opened.connection.close();
	return tableRead.error || stampRead.error ? { error: tableRead.error || stampRead.error } : { stampList: stampRead.rowList };
};

// rowsFromLayers — own store first; the reference only when the own store has no row (a lookup by unique address)
const rowsFromLayers =
	({ getRows, referenceLayer }) =>
	(statement, callback) => {
		getRows(statement, (ownErr, ownRows) => {
			if (ownErr || !referenceLayer || (ownRows && ownRows.length > 0)) {
				callback(ownErr, ownRows);
				return;
			}
			referenceLayer.getReferenceRows(statement, callback);
		});
	};

module.exports = { stampReference, openReferenceLayer, readStampList, stampListOfFile, rowsFromLayers, STORE_REFERENCE_TABLE_NAME, familyNameList };
