'use strict';

// decision-store.js — where FROZEN inferred-decision blocks live, and what a bridge reads and
// writes them through (design §5.5, the --rebridge/freeze model; implementationPlan_bridge_072426 §8).
//
// A sibling of standards-database, deliberately NOT the same store. The schema-block `blocks` table is
// governed by a LOCKED taxonomy (standardBase | hub | relationship) — a frozen decision block is NONE of
// those, so it cannot be stored there without lying about its kind. A decision block is its OWN kind and
// lives in its OWN table, in its OWN database.
//
// CONTENT-ADDRESSED, exactly as standards-database is. A block's decisionBlockHash IS sha256 of its frozen
// text (the pin the whole freeze model rests on — decisionFreezer computes the identical hash, and every
// materialized CLOSE_MATCH edge is stamped with it). Two consequences, both load-bearing:
//   * writing the same frozen text twice is a no-op (idempotent save), so a re-run of the same --rebridge
//     costs nothing and never forks the pair into two identical blocks;
//   * every READ recomputes the hash and REFUSES a mismatch, naming the block — a corrupted or tampered
//     frozen text must never flow into a plain build as though it were the addressed content, because a
//     replay off a corrupted block would silently write DIFFERENT edges than the rebridge that made it (the
//     G2 byte-identical-replay guarantee is exactly what verify-on-read protects).
//
// KEYED PER PAIR. getDecisionBlock({ pairKey }) is the retrieval door: a plain build asks "what is the
// frozen block for CEDS::CTDL?" and materializes it. The store is APPEND-ONLY (nothing is ever updated — a
// different decision set is a different row, standards-database's rule carried here); a genuine re-rebridge
// of a pair appends a new block, and the read returns the LATEST for that pair (highest seq). Idempotent
// re-save of the same frozen text is a no-op, so the only way a pair grows a second row is a genuinely
// different rebridge result — which is precisely what "refresh this pair's frozen block" means.
//
// THE DATABASE PATH IS REQUIRED AND HAS NO DEFAULT — the same safety story standards-database tells and for
// the same reason: a caller that must say where it is writing cannot fall through to writing anywhere.
//
// THE LAZY-REQUIRE TRAP. This module requires sqlite-instance at LOAD time, and sqlite-instance DESTRUCTURES
// process.global when its factory is invoked (the `({})` below). So this module MUST be required lazily by
// its CLI caller, AFTER bootstrapGlobal has run — a top-level require in actions.js would kill even -help.
// standards-database carries the identical trap and the identical warning; actions.js requires BOTH lazily.
//
// THE CONTRACT semanticBridge CALLS (bridgePlugins/semanticBridge.js — matched EXACTLY, not invented):
//   getDecisionBlock({ pairKey }, cb)   -> cb('', { frozenText })              // frozenText null when absent
//   saveDecisionBlock({ pairKey, frozenText, decisionBlockHash }, cb) -> cb('', { ... })
//
// Async style: callback(errString, result); qtools taskListPlus/pipeRunner for sequencing. camelCase only.

const path = require('path');
const fs = require('fs');
const sqlString = require('sqlstring-sqlite');

const TREE_LIB = path.join(__dirname, '..');
const sqliteInstance = require(path.join(TREE_LIB, 'sqlite-instance', 'sqlite-instance'))({});
const contentAddress = require(path.join(TREE_LIB, 'content-address', 'content-address'))();

// The option shape sqlite-instance needs for hand-written SQL: runStatement REFUSES a statement with no
// <!tableName!> substitution tag unless noTableNameOk says the caller means it. (Same as standards-database.)
const RAW_OPTS = { noTableNameOk: true, suppressStatementLog: true };

// START OF moduleFunction() ============================================================

const decisionStore = () => {
	// -----
	// open — the ONLY door. databaseFilePath is required; there is no default and no fallback.
	const open = ({ databaseFilePath }, callback) => {
		if (!databaseFilePath || typeof databaseFilePath !== 'string') {
			callback(
				`decisionStore.open: databaseFilePath is REQUIRED and has no default. A caller that ` +
					`does not say where it is writing is a caller that can write anywhere.`,
			);
			return;
		}

		const parentDir = path.dirname(path.resolve(databaseFilePath));
		if (!fs.existsSync(parentDir)) {
			callback(
				`decisionStore.open: the directory '${parentDir}' does not exist. Refusing to create a ` +
					`database somewhere nobody has prepared.`,
			);
			return;
		}

		sqliteInstance.initDatabaseInstance(databaseFilePath, (initErr, dbInstance) => {
			if (initErr) {
				callback(`decisionStore.open '${databaseFilePath}': ${initErr}`);
				return;
			}

			// one table handle gives us runStatement/getData; every statement below is hand-written
			// because the schema is ours, not sqlite-instance's object mapping.
			dbInstance.getTable('decisionStoreOps', RAW_OPTS, (tableErr, tableRef) => {
				if (tableErr) {
					callback(`decisionStore.open '${databaseFilePath}': ${tableErr}`);
					return;
				}

				const esc = (value) => (value == null ? 'NULL' : sqlString.escape(`${value}`));
				const runSql = (statement, cb) => tableRef.runStatement(statement, RAW_OPTS, cb);
				const getRows = (statement, cb) => tableRef.getData(statement, RAW_OPTS, cb);

				buildSchema({ runSql }, (schemaErr) => {
					if (schemaErr) {
						callback(`decisionStore.open '${databaseFilePath}': ${schemaErr}`);
						return;
					}
					callback('', makeApi({ esc, runSql, getRows, databaseFilePath }));
				});
			});
		});
	};

	return { open };
};

// -----
// buildSchema — CREATE TABLE IF NOT EXISTS the one content-addressed table this store holds.
//
// seq is the append order (AUTOINCREMENT), so "the latest block for a pair" is a total order even when two
// rebridges land in the same clock-second — createdAt alone could tie, seq cannot. decisionBlockHash is
// UNIQUE (the content address): re-saving identical frozen text collides on the index and is caught as a
// no-op before the insert, which is what makes saveDecisionBlock idempotent by construction.
const buildSchema = ({ runSql }, callback) => {
	runSql(
		`CREATE TABLE IF NOT EXISTS decisionBlocks (
			seq               INTEGER PRIMARY KEY AUTOINCREMENT,
			decisionBlockHash TEXT NOT NULL,
			pairKey           TEXT NOT NULL,
			frozenText        BLOB NOT NULL,
			createdAt         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);`,
		(err) => {
			if (err) {
				callback(err);
				return;
			}
			runSql(
				`CREATE UNIQUE INDEX IF NOT EXISTS decisionBlocksHashUnique ON decisionBlocks(decisionBlockHash);`,
				(indexErr) => callback(indexErr || ''),
			);
		},
	);
};

// -----
const makeApi = ({ esc, runSql, getRows, databaseFilePath }) => {
	// -----
	// saveDecisionBlock — content-address the frozen text, insert if absent. Idempotent by construction.
	//
	// The caller (decisionFreezer via semanticBridge) hands BOTH the frozen text and the decisionBlockHash it
	// computed for it. This recomputes the address and REFUSES a disagreement by name: the two must be the
	// same sha256 or one of them is wrong, and a store that admitted the mismatch would hold a row addressed
	// under a hash its own text does not produce — the exact corruption verify-on-read exists to make
	// impossible, admitted at the front door instead of the back. Both values are named because either could
	// be the mistaken one.
	const saveDecisionBlock = ({ pairKey, frozenText, decisionBlockHash }, callback) => {
		if (typeof pairKey !== 'string' || pairKey.trim() === '') {
			callback('decisionStore.saveDecisionBlock: pairKey is required and must be a non-empty string');
			return;
		}
		if (typeof frozenText !== 'string' || frozenText.length === 0) {
			callback('decisionStore.saveDecisionBlock: frozenText is required and must be a non-empty string');
			return;
		}

		const refId = contentAddress.blockIdForText(frozenText);
		if (decisionBlockHash != null && `${decisionBlockHash}` !== refId) {
			callback(
				`decisionStore.saveDecisionBlock: the caller's decisionBlockHash '${decisionBlockHash}' does ` +
					`not match the sha256 of the frozen text it was handed with (${refId}). One of the two is ` +
					`wrong and the store will not hold a block addressed under a hash its text does not produce.`,
			);
			return;
		}

		getRows(`SELECT seq FROM decisionBlocks WHERE decisionBlockHash=${esc(refId)};`, (err, rows) => {
			if (err) {
				callback(err);
				return;
			}
			if (rows && rows.length > 0) {
				// already present — the same frozen bytes ARE the same block. Not an error, not a rewrite.
				callback('', { decisionBlockHash: refId, pairKey, alreadyPresent: true, saved: false });
				return;
			}
			runSql(
				`INSERT INTO decisionBlocks (decisionBlockHash, pairKey, frozenText)
				 VALUES (${esc(refId)}, ${esc(pairKey)}, ${esc(frozenText)});`,
				(insertErr) => {
					if (insertErr) {
						callback(`decisionStore.saveDecisionBlock ${refId}: ${insertErr}`);
						return;
					}
					callback('', { decisionBlockHash: refId, pairKey, alreadyPresent: false, saved: true });
				},
			);
		});
	};

	// -----
	// getDecisionBlock — the frozen block for a pair, or { frozenText: null } when there is none.
	//
	// VERIFY-ON-READ. The store is content-addressed, so the hash of the text that came back must equal the
	// address it was stored under. A mismatch is refused loudly and by name — a plain build must never
	// materialize edges from a frozen block whose text has drifted from its own hash, because those edges
	// would be stamped with a decisionBlockHash the text no longer produces and the fingerprint would go RED
	// with no visible cause. Absence is an ANSWER ({ frozenText: null }), not an error: the plugin reads it
	// as "no frozen block for this pair -> 0 inferred edges" (design §5.5).
	const getDecisionBlock = ({ pairKey }, callback) => {
		if (typeof pairKey !== 'string' || pairKey.trim() === '') {
			callback('decisionStore.getDecisionBlock: pairKey is required and must be a non-empty string');
			return;
		}
		getRows(
			`SELECT decisionBlockHash, frozenText FROM decisionBlocks
			 WHERE pairKey=${esc(pairKey)} ORDER BY seq DESC LIMIT 1;`,
			(err, rows) => {
				if (err) {
					callback(err);
					return;
				}
				const row = rows && rows[0];
				if (!row) {
					callback('', { frozenText: null }); // absence is an answer; the caller decides
					return;
				}
				const recomputed = contentAddress.blockIdForText(row.frozenText);
				if (recomputed !== row.decisionBlockHash) {
					callback(
						`decisionStore.getDecisionBlock: content-address verification FAILED for the frozen ` +
							`decision block of pair '${pairKey}' (addressed ${row.decisionBlockHash}): the stored ` +
							`text hashes to ${recomputed}. The frozen text is corrupt or tampered. Refusing to ` +
							`return it.`,
					);
					return;
				}
				callback('', { frozenText: row.frozenText, decisionBlockHash: row.decisionBlockHash, pairKey });
			},
		);
	};

	return {
		databaseFilePath,
		getDecisionBlock,
		saveDecisionBlock,
	};
};

// END OF moduleFunction() ============================================================

module.exports = decisionStore;
