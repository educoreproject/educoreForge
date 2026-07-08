#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const qt = require('qtools-functional-library');

const sqlString = require('sqlstring-sqlite');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const sqliteInstance = require('../../../../server/data-model/lib/sqlite-instance/sqlite-instance');

const contentAddress = require('../content-address/content-address')();

// START OF moduleFunction() ============================================================
//
// vector-store — the content-addressed embedding SIDECAR store (embedding-sidecar PLAN §3.2).
// A per-standard SQLite file (one vectorStore.sqlite3 per standard, beside that standard's
// block artifacts — D1) holding ONE table, `vectors`. It is the sibling of forge-store and is
// deliberately built the SAME way (server/data-model/lib/sqlite-instance's initDatabaseInstance
// + getTable give a managed better-sqlite3 db with callback-style runStatement/getData; we do
// not hand-roll better-sqlite3).
//
// ADDRESSING (PLAN §3.1): a node's embedding vector is a pure function of its determinants —
// (embeddingModelVersion, embeddingInputText = searchText). The row key
//   vectorId = sha256(modelVersion + NUL + inputText)   [contentAddress.vectorIdForInput]
// interns identical inputs to ONE row (dedup) and is recomputable from the block alone. The
// raw little-endian float32 bytes are stored as a BLOB (NOT base64 — sheds ~33% inflation).
//
// INTEGRITY — TWO independent guarantees, both re-checked on every read (verify-on-read),
// mirroring forge-store.getBlock:250-259 (blockId == sha256(text)). Because vectorId addresses
// the INPUT (for dedup), re-hashing the input alone is a WEAKER guarantee than the sibling's;
// so a second column, vectorHash = sha256(raw vector bytes) [contentAddress.vectorHashForBytes],
// addresses the PAYLOAD. getVector REFUSES loudly (error channel, returns NO data) on:
//   (1) structural: dtype != 'float32' or blob length != dims*4      (cheap, checked FIRST)
//   (2) determinant: sha256(modelVersion + NUL + inputText) != vectorId
//   (3) payload:     sha256(vector bytes)                != vectorHash
// A refusal is fail-loud-not-silent (never returns tampered content into a build), exactly as
// forge-store refuses a corrupted block.
//
// SQL SAFETY: sqlite-instance runs pure STRING SQL (db.exec / db.prepare().all()) with NO
// parameter binding. Text columns (inputText is searchText — it carries quotes, newlines,
// backslashes, unicode) are persisted via sqlString.escape (the sqlstring-sqlite library — the
// SAME mechanism forge-store uses; NOT hand-rolled quoting). The genuinely-binary vector column
// is written as a SQLite X'<hex>' blob literal (hex is injection-inert ASCII); better-sqlite3
// returns it as a Node Buffer on read.
//
// Async style (project doctrine): callback + qtools-asynchronous-pipe-plus taskList; NO
// async/await, NO try/catch for control flow; string error channel ('' == success). camelCase.

const moduleFunction =
	({ moduleName } = {}) =>
	(injectedDeps = {}) => {
		const { vectorIdForInput, vectorHashForBytes } = contentAddress;

		// rawOpts: bypass sqlite-instance's <!tableName!> requirement and statement noise; we
		// issue fully-formed SQL against our explicitly-named `vectors` table.
		const rawOpts = { noTableNameOk: true, suppressStatementLog: true };

		// closured once init() succeeds:
		let dbHandle; // { runStatement, getData } from a sqlite-instance table handle

		const DTYPE = 'float32';
		const BYTES_PER_FLOAT = 4;
		const NUL = String.fromCharCode(0);

		// -----
		// helpers

		const esc = (value) => (value == null ? 'NULL' : sqlString.escape(`${value}`));

		const runSql = (statement, callback) =>
			dbHandle.runStatement(statement, rawOpts, callback);

		const getRows = (statement, callback) =>
			dbHandle.getData(statement, rawOpts, callback);

		// encodeVectorBlob — number[] | Float32Array -> raw little-endian float32 Buffer. This is
		// the deliberate double->float32 narrowing (the wire dtype is float32), matching
		// replay-block.encodeEmbedding's byte layout but WITHOUT the base64 step.
		const encodeVectorBlob = (vectorValues) => {
			const buf = Buffer.allocUnsafe(vectorValues.length * BYTES_PER_FLOAT);
			for (let i = 0; i < vectorValues.length; i++) {
				buf.writeFloatLE(vectorValues[i], i * BYTES_PER_FLOAT);
			}
			return buf;
		};

		// decodeVectorBlob — raw little-endian float32 Buffer -> number[] (Neo4j LIST<FLOAT>).
		// The caller has already verified buffer.length === dims * 4 (structural guard).
		const decodeVectorBlob = (buffer, dims) => {
			const out = new Array(dims);
			for (let i = 0; i < dims; i++) {
				out[i] = buffer.readFloatLE(i * BYTES_PER_FLOAT);
			}
			return out;
		};

		// =====================================================================
		// INIT — open/create the db, ensure the single `vectors` table
		// =====================================================================

		const init = ({ dbPath }, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				const { initDatabaseInstance } = sqliteInstance({ unused: true });
				initDatabaseInstance(dbPath, (err, dbInstance) => {
					next(err, { ...args, dbInstance });
				});
			});

			// acquire one raw table handle (owner incidental; used only for its
			// runStatement/getData against our own fully-named table)
			taskList.push((args, next) => {
				const { dbInstance } = args;
				dbInstance.getTable('vectorStoreOps', rawOpts, (err, tableRef) => {
					if (err) {
						next(err, args);
						return;
					}
					dbHandle = tableRef;
					next('', { ...args, tableRef });
				});
			});

			taskList.push((args, next) => {
				const createVectors = `CREATE TABLE IF NOT EXISTS vectors (
					vectorId     TEXT PRIMARY KEY,
					modelVersion TEXT NOT NULL,
					dims         INTEGER NOT NULL,
					dtype        TEXT NOT NULL,
					inputText    TEXT NOT NULL,
					vector       BLOB NOT NULL,
					vectorHash   TEXT NOT NULL
				);`;
				runSql(createVectors, (err) => next(err, args));
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				callback(err, err ? undefined : {});
			});
		};

		// =====================================================================
		// VECTORS
		// =====================================================================

		// putVector — compute vectorId from the determinants, content-address the raw bytes,
		//   idempotent insert-or-ignore (dedup on vectorId, FIRST-WRITE-WINS — mirrors
		//   saveBlock). Returns { vectorId, deduped }. `vector` is a number[] | Float32Array.
		const putVector = ({ modelVersion, inputText, vector }, callback) => {
			// required-field guards — determinants and payload must be present (a null here is a
			// caller bug; content-address helpers assume non-null). Fail loud BEFORE any SQL.
			if (modelVersion == null || `${modelVersion}` === '') {
				callback(`${moduleName}.putVector: modelVersion is required`);
				return;
			}
			if (inputText == null) {
				callback(`${moduleName}.putVector: inputText is required`);
				return;
			}
			// NUL-free guard (separator-collision): a NUL in either determinant would make the
			// vectorId key ambiguous (NUL is the field separator in vectorIdForInput). Refuse loudly
			// on the callback channel BEFORE computing the key, so no colliding pair is ever stored
			// and vectorIdForInput never has to throw on the write path.
			if (`${modelVersion}`.indexOf(NUL) !== -1 || `${inputText}`.indexOf(NUL) !== -1) {
				callback(
					`${moduleName}.putVector: modelVersion/inputText must not contain a NUL byte ` +
						`(NUL is the vectorId field separator — it would make the key ambiguous)`,
				);
				return;
			}
			if (
				vector == null ||
				typeof vector.length !== 'number' ||
				vector.length === 0
			) {
				callback(
					`${moduleName}.putVector: vector must be a non-empty number[] / Float32Array`,
				);
				return;
			}

			const vectorId = vectorIdForInput(modelVersion, inputText);
			const dims = vector.length;
			const vectorBuffer = encodeVectorBlob(vector);
			const vectorHash = vectorHashForBytes(vectorBuffer);

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				getRows(
					`SELECT vectorId FROM vectors WHERE vectorId=${esc(vectorId)};`,
					(err, rows) => next(err, { ...args, rows }),
				);
			});

			taskList.push((args, next) => {
				if (args.rows && args.rows.length > 0) {
					next('skipRestOfPipe', { ...args, deduped: true }); // already present — dedup
					return;
				}
				const statement = `INSERT INTO vectors
					(vectorId, modelVersion, dims, dtype, inputText, vector, vectorHash)
					VALUES (${esc(vectorId)}, ${esc(modelVersion)}, ${Number(dims)}, ${esc(DTYPE)},
						${esc(inputText)}, X'${vectorBuffer.toString('hex')}', ${esc(vectorHash)});`;
				runSql(statement, (err) => next(err, { ...args, deduped: false }));
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				const deduped = args ? !!args.deduped : false;
				callback(err === 'skipRestOfPipe' ? '' : err, { vectorId, deduped });
			});
		};

		// getVector — fetch one vector by id, VERIFY-ON-READ, return the decoded record.
		//   Absence is NOT an error (cold cache) — returns null. A present-but-corrupt row is
		//   REFUSED loudly (error channel, no data), NAMING the vector — a tampered vector must
		//   never flow into a build. Mirrors forge-store.getBlock:240-272.
		const getVector = ({ vectorId }, callback) => {
			getRows(
				`SELECT * FROM vectors WHERE vectorId=${esc(vectorId)};`,
				(err, rows) => {
					if (err) {
						callback(err);
						return;
					}
					const row = rows.qtGetSurePath('[0]', null);
					if (!row) {
						callback('', null);
						return;
					}

					// (1) structural guard — cheap, checked FIRST.
					if (row.dtype !== DTYPE) {
						callback(
							`${moduleName}.getVector: vector ${row.vectorId} has dtype '${row.dtype}', ` +
								`expected '${DTYPE}' — the row is corrupt. Refusing to return it.`,
						);
						return;
					}
					const expectedBytes = Number(row.dims) * BYTES_PER_FLOAT;
					if (!Buffer.isBuffer(row.vector) || row.vector.length !== expectedBytes) {
						callback(
							`${moduleName}.getVector: vector ${row.vectorId} blob length ` +
								`${Buffer.isBuffer(row.vector) ? row.vector.length : '(not a blob)'} != ` +
								`expected ${expectedBytes} (${row.dims} dims x ${BYTES_PER_FLOAT}-byte float32) ` +
								`— the row is corrupt. Refusing to return it.`,
						);
						return;
					}

					// stored-determinant NUL guard — a NUL in a stored determinant is corruption /
					// tampering (putVector rejects it on write). Refuse loudly, AND prevent the
					// determinant re-hash below (vectorIdForInput) from THROWING on the NUL.
					if (
						`${row.modelVersion}`.indexOf(NUL) !== -1 ||
						`${row.inputText}`.indexOf(NUL) !== -1
					) {
						callback(
							`${moduleName}.getVector: vector ${row.vectorId} has a NUL byte in a stored ` +
								`determinant — the row is corrupt or tampered. Refusing to return it.`,
						);
						return;
					}

					// (2) determinant re-hash — sha256(modelVersion + NUL + inputText) MUST == vectorId.
					const recomputedId = vectorIdForInput(row.modelVersion, row.inputText);
					if (recomputedId !== row.vectorId) {
						callback(
							`${moduleName}.getVector: content-address verification failed reading vector ` +
								`${row.vectorId}: (modelVersion, inputText) hashes to ${recomputedId} — the ` +
								`determinants are corrupt or tampered. Refusing to return it.`,
						);
						return;
					}

					// (3) payload re-hash — sha256(raw vector bytes) MUST == vectorHash.
					const recomputedHash = vectorHashForBytes(row.vector);
					if (recomputedHash !== row.vectorHash) {
						callback(
							`${moduleName}.getVector: payload verification failed reading vector ` +
								`${row.vectorId}: stored vector bytes hash to ${recomputedHash}, expected ` +
								`${row.vectorHash} — the vector is corrupt or tampered. Refusing to return it.`,
						);
						return;
					}

					callback('', {
						vectorId: row.vectorId,
						modelVersion: row.modelVersion,
						dims: Number(row.dims),
						dtype: row.dtype,
						inputText: row.inputText,
						vector: decodeVectorBlob(row.vector, Number(row.dims)),
						vectorHash: row.vectorHash,
					});
				},
			);
		};

		// hasVector — presence check by id (no text/blob read, no verify-on-read).
		const hasVector = ({ vectorId }, callback) => {
			getRows(
				`SELECT vectorId FROM vectors WHERE vectorId=${esc(vectorId)};`,
				(err, rows) => {
					if (err) {
						callback(err);
						return;
					}
					callback('', !!(rows && rows.length > 0));
				},
			);
		};

		return {
			init,
			putVector,
			getVector,
			hasVector,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
