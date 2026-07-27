'use strict';

// vectorCache.js — the ONE shared, content-addressed embedding cache that every forge and every
// bridge reads and writes through embedding-client. A vector is a pure function of (the text, the
// model that embedded it, the dimension it was cut to), so it need not be isolated per standard —
// the same string embedded for CEDS and for SIF is the same vector, and paying Voyage twice for it
// is waste. This store makes the embedding of any distinct text a once-ever cost.
//
// CONTENT-ADDRESSED, WITH THE MODEL IN THE ADDRESS. The key is (embeddingModelVersion, embeddingDims,
// textHash) — NOT textHash alone. The same text under voyage-4-large and under some future model are
// DIFFERENT vectors; a key that ignored the model would transparently serve a stale vector into a new
// golden, and every content address computed from it would name a model that did not make it. The
// three columns are the address; nothing here is ever silently substituted (polyArch2 §6).
//
// textHash is sha256(text) as hex — the SAME hash the bridge vectorizer has always used — so a text
// embedded by the forge is a cache HIT for the bridge and vice versa. It is exported (textHashOf) so
// the one caller (embedding-client) hashes identically to what is stored, never a second formula.
//
// IDEMPOTENT BY THE UNIQUE INDEX. putVectors is INSERT OR IGNORE across the address: storing the same
// (model, dims, textHash) twice is a no-op, so a re-forge over the same text neither errors nor forks
// a second row. Reads return only what is present; a miss is an ANSWER (absent from byHash), not an
// error — the caller embeds the miss and stores it.
//
// THE DATABASE PATH IS REQUIRED AND HAS NO DEFAULT here — the default lives in the caller
// (embedding-client), documented there. A store that must be told where it writes cannot fall through
// to writing anywhere. (Same safety story as decision-store and standards-database.)
//
// THE LAZY-REQUIRE TRAP. This module requires sqlite-instance at LOAD time, and sqlite-instance
// DESTRUCTURES process.global when its factory is invoked (the `({})` below). So embedding-client
// requires THIS module LAZILY — only on the first embed with caching on, long after bootstrapGlobal —
// exactly as actions.js requires decision-store and standards-database lazily. A top-level require in
// a path that runs before bootstrap (e.g. -help) would kill it.
//
// Async style: callback(errString, result); camelCase only; no async/await.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlString = require('sqlstring-sqlite');

const TREE_LIB = path.join(__dirname, '..');
const sqliteInstance = require(path.join(TREE_LIB, 'sqlite-instance', 'sqlite-instance'))({});

// The option shape sqlite-instance needs for hand-written SQL: runStatement REFUSES a statement with
// no <!tableName!> substitution tag unless noTableNameOk says the caller means it. (Same as
// decision-store — the schema here is ours, not sqlite-instance's object mapping.)
const RAW_OPTS = { noTableNameOk: true, suppressStatementLog: true };

// textHashOf — sha256(text) as hex. The single hashing formula; exported so the caller stores and
// looks up under one address, never two. Matches the bridge vectorizer's long-standing hash so the
// two share cache entries for identical text.
const textHashOf = (text) => crypto.createHash('sha256').update(`${text}`, 'utf8').digest('hex');

// START OF moduleFunction() ============================================================

const vectorCache = () => {
	// -----
	// open — the ONLY door. databaseFilePath is required; there is no default and no fallback here.
	const open = ({ databaseFilePath }, callback) => {
		if (!databaseFilePath || typeof databaseFilePath !== 'string') {
			callback(
				`vectorCache.open: databaseFilePath is REQUIRED and has no default. A caller that ` +
					`does not say where it is writing is a caller that can write anywhere.`,
			);
			return;
		}

		const parentDir = path.dirname(path.resolve(databaseFilePath));
		if (!fs.existsSync(parentDir)) {
			callback(
				`vectorCache.open: the directory '${parentDir}' does not exist. Refusing to create a ` +
					`database somewhere nobody has prepared.`,
			);
			return;
		}

		sqliteInstance.initDatabaseInstance(databaseFilePath, (initErr, dbInstance) => {
			if (initErr) {
				callback(`vectorCache.open '${databaseFilePath}': ${initErr}`);
				return;
			}

			// one table handle gives us runStatement/getData; every statement below is hand-written
			// because the schema is ours, not sqlite-instance's object mapping.
			dbInstance.getTable('vectorCacheOps', RAW_OPTS, (tableErr, tableRef) => {
				if (tableErr) {
					callback(`vectorCache.open '${databaseFilePath}': ${tableErr}`);
					return;
				}

				const esc = (value) => (value == null ? 'NULL' : sqlString.escape(`${value}`));
				const runSql = (statement, cb) => tableRef.runStatement(statement, RAW_OPTS, cb);
				const getRows = (statement, cb) => tableRef.getData(statement, RAW_OPTS, cb);

				buildSchema({ runSql }, (schemaErr) => {
					if (schemaErr) {
						callback(`vectorCache.open '${databaseFilePath}': ${schemaErr}`);
						return;
					}
					callback('', makeApi({ esc, runSql, getRows, databaseFilePath }));
				});
			});
		});
	};

	return { open, textHashOf };
};

// -----
// buildSchema — CREATE TABLE IF NOT EXISTS the one content-addressed table, plus the UNIQUE index that
// IS the content address (model, dims, textHash). The unique index is what makes putVectors idempotent
// by construction: a second insert of the same address collides and is ignored.
const buildSchema = ({ runSql }, callback) => {
	runSql(
		`CREATE TABLE IF NOT EXISTS vectorCacheEntries (
			seq                   INTEGER PRIMARY KEY AUTOINCREMENT,
			embeddingModelVersion TEXT NOT NULL,
			embeddingDims         INTEGER NOT NULL,
			textHash              TEXT NOT NULL,
			vectorBase64          TEXT NOT NULL,
			sourceText            TEXT NOT NULL,
			createdAt             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);`,
		(err) => {
			if (err) {
				callback(err);
				return;
			}
			runSql(
				`CREATE UNIQUE INDEX IF NOT EXISTS vectorCacheKeyUnique
				 ON vectorCacheEntries(embeddingModelVersion, embeddingDims, textHash);`,
				(indexErr) => callback(indexErr || ''),
			);
		},
	);
};

// -----
const makeApi = ({ esc, runSql, getRows, databaseFilePath }) => {
	// validateIdentity — model and dims are the address; a bad one is a fault, never a default.
	const validateIdentity = (embeddingModelVersion, embeddingDims, who) => {
		if (typeof embeddingModelVersion !== 'string' || embeddingModelVersion.trim() === '') {
			return `vectorCache.${who}: embeddingModelVersion is required and must be a non-empty string`;
		}
		if (!Number.isInteger(embeddingDims) || embeddingDims <= 0) {
			return `vectorCache.${who}: embeddingDims must be a positive whole number, got ${JSON.stringify(embeddingDims)}`;
		}
		return '';
	};

	// -----
	// getVectors — the cache HITS for these hashes, as { byHash: { textHash: vectorBase64 } }. Absent
	// hashes are simply not in byHash (a miss is an answer, not an error). Dedups the hash list before
	// the IN clause; an empty request returns an empty map without touching the database.
	const getVectors = ({ embeddingModelVersion, embeddingDims, textHashes } = {}, callback) => {
		const identityErr = validateIdentity(embeddingModelVersion, embeddingDims, 'getVectors');
		if (identityErr) {
			callback(identityErr);
			return;
		}
		if (!Array.isArray(textHashes)) {
			callback('vectorCache.getVectors: textHashes is required and must be an array');
			return;
		}
		const distinct = [...new Set(textHashes.map((oneHash) => `${oneHash}`))];
		if (distinct.length === 0) {
			callback('', { byHash: {} });
			return;
		}
		const inList = distinct.map((oneHash) => esc(oneHash)).join(', ');
		getRows(
			`SELECT textHash, vectorBase64 FROM vectorCacheEntries
			 WHERE embeddingModelVersion=${esc(embeddingModelVersion)}
			   AND embeddingDims=${Number(embeddingDims)}
			   AND textHash IN (${inList});`,
			(err, rows) => {
				if (err) {
					callback(err);
					return;
				}
				const byHash = {};
				(rows || []).forEach((oneRow) => {
					byHash[oneRow.textHash] = oneRow.vectorBase64;
				});
				callback('', { byHash });
			},
		);
	};

	// -----
	// putVectors — store these entries idempotently (INSERT OR IGNORE across the unique address). Each
	// entry is { textHash, sourceText, vectorBase64 }; the model/dims are the shared address for the
	// whole batch. Re-storing a present address is a no-op. An empty batch is a no-op success.
	const putVectors = ({ embeddingModelVersion, embeddingDims, entries } = {}, callback) => {
		const identityErr = validateIdentity(embeddingModelVersion, embeddingDims, 'putVectors');
		if (identityErr) {
			callback(identityErr);
			return;
		}
		if (!Array.isArray(entries)) {
			callback('vectorCache.putVectors: entries is required and must be an array');
			return;
		}
		if (entries.length === 0) {
			callback('', { requested: 0 });
			return;
		}
		const badIndex = entries.findIndex(
			(oneEntry) =>
				!oneEntry ||
				typeof oneEntry.textHash !== 'string' ||
				oneEntry.textHash.trim() === '' ||
				typeof oneEntry.vectorBase64 !== 'string' ||
				typeof oneEntry.sourceText !== 'string',
		);
		if (badIndex !== -1) {
			callback(
				`vectorCache.putVectors: entries[${badIndex}] must have string textHash (non-empty), ` +
					`vectorBase64, and sourceText`,
			);
			return;
		}
		const tuples = entries
			.map(
				(oneEntry) =>
					`(${esc(embeddingModelVersion)}, ${Number(embeddingDims)}, ${esc(oneEntry.textHash)}, ` +
					`${esc(oneEntry.vectorBase64)}, ${esc(oneEntry.sourceText)})`,
			)
			.join(', ');
		runSql(
			`INSERT OR IGNORE INTO vectorCacheEntries
			 (embeddingModelVersion, embeddingDims, textHash, vectorBase64, sourceText)
			 VALUES ${tuples};`,
			(err) => {
				if (err) {
					callback(`vectorCache.putVectors: ${err}`);
					return;
				}
				callback('', { requested: entries.length });
			},
		);
	};

	return {
		databaseFilePath,
		getVectors,
		putVectors,
	};
};

// END OF moduleFunction() ============================================================

module.exports = vectorCache;
