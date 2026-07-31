'use strict';

// judgment-cache.js — the ONE shared, content-addressed EVIDENCE-JUDGMENT cache: every LLM judgment
// a bridge buys is written here AT THE MOMENT IT IS DECIDED, so a killed run resumes for free and a
// decided judgment can never evaporate with the process (p9-judgmentPersistence; ⟪TQ RULING,
// 2026-07-30⟫ "make totally sure that all the results are written to disk as they are decided.
// Losing data is crazy." — a live API-cap kill at judgment 3,300 of 15,620 lost EVERY judgment
// because decisions froze only at run end).
//
// MODELED ON lib/embedding/vectorCache.js DELIBERATELY — same store shape, same config discipline,
// same idempotence story: a judgment is a pure function of (the EXACT rendered prompt text, the
// model that judged it, the renderer version that rendered it), so it need not be isolated per run.
//
// CONTENT-ADDRESSED, WITH THE MODEL AND RENDERER IN THE ADDRESS. The key is
// (promptHash, model, rendererVersion) — NEVER promptHash alone. THE SOUNDNESS INVARIANT: a cache
// hit is only valid because identical rendered evidence + the same model + the same renderer
// version produced it; a key that ignored the model would serve one model's judgment as another's,
// and a key that ignored the renderer version would survive a prompt-construction change the
// rendered bytes happen to mask. Never key on anything less than all three (refuse-by-name below).
// promptHash is sha256 of the EXACT rendered prompt text, computed by lib/content-address
// (blockIdForText) — the caller hashes with THAT one formula, never a second one.
//
// DECIDED-TIME TRUTH, FIRST WRITE WINS. putJudgment is INSERT OR IGNORE across the unique address:
// storing the same (promptHash, model, rendererVersion) twice is a no-op and the FIRST stored
// payload is retained — exactly the freeze discipline one level down (a re-judge of a byte-identical
// prompt that answered differently is LLM non-determinism; the decided-time truth is what replays).
// Reads return only what is present; a miss is an ANSWER ({ judgment: null }), not an error — the
// caller judges the miss live and stores it.
//
// WAL MODE, set at open. A crash mid-run must never take committed judgment rows with it, and the
// disk-truth contract (a row is visible to a FRESH connection the moment putJudgment's callback
// fires) is exactly what WAL's committed-write visibility provides.
//
// THE DATABASE PATH IS REQUIRED AND HAS NO DEFAULT here — the default lives in the caller
// (graphBuilder's actions.js, documented there), the same split vectorCache/embedding-client use.
// A store that must be told where it writes cannot fall through to writing anywhere.
//
// THE LAZY-REQUIRE TRAP. This module requires sqlite-instance at LOAD time, and sqlite-instance
// DESTRUCTURES process.global when its factory is invoked (the `({})` below). So callers on a
// pre-bootstrap path (actions.js) must require THIS module LAZILY — exactly as they already do for
// decision-store and standards-database. A top-level require in a path that runs before
// bootstrapGlobal (e.g. -help) would kill it.
//
// Async style: callback(errString, result); camelCase only; no async/await.

const path = require('path');
const fs = require('fs');
const sqlString = require('sqlstring-sqlite');

const TREE_LIB = path.join(__dirname, '..');
const sqliteInstance = require(path.join(TREE_LIB, 'sqlite-instance', 'sqlite-instance'))({});

// The option shape sqlite-instance needs for hand-written SQL: runStatement REFUSES a statement with
// no <!tableName!> substitution tag unless noTableNameOk says the caller means it. (Same as
// vectorCache and decision-store — the schema here is ours, not sqlite-instance's object mapping.)
const RAW_OPTS = { noTableNameOk: true, suppressStatementLog: true };

// START OF moduleFunction() ============================================================

const judgmentCache = () => {
	// -----
	// open — the ONLY door. databaseFilePath is required; there is no default and no fallback here.
	const open = ({ databaseFilePath }, callback) => {
		if (!databaseFilePath || typeof databaseFilePath !== 'string') {
			callback(
				`judgmentCache.open: databaseFilePath is REQUIRED and has no default. A caller that ` +
					`does not say where it is writing is a caller that can write anywhere.`,
			);
			return;
		}

		const parentDir = path.dirname(path.resolve(databaseFilePath));
		if (!fs.existsSync(parentDir)) {
			callback(
				`judgmentCache.open: the directory '${parentDir}' does not exist. Refusing to create a ` +
					`database somewhere nobody has prepared.`,
			);
			return;
		}

		sqliteInstance.initDatabaseInstance(databaseFilePath, (initErr, dbInstance) => {
			if (initErr) {
				callback(`judgmentCache.open '${databaseFilePath}': ${initErr}`);
				return;
			}

			// one table handle gives us runStatement/getData; every statement below is hand-written
			// because the schema is ours, not sqlite-instance's object mapping.
			dbInstance.getTable('judgmentCacheOps', RAW_OPTS, (tableErr, tableRef) => {
				if (tableErr) {
					callback(`judgmentCache.open '${databaseFilePath}': ${tableErr}`);
					return;
				}

				const esc = (value) => (value == null ? 'NULL' : sqlString.escape(`${value}`));
				const runSql = (statement, cb) => tableRef.runStatement(statement, RAW_OPTS, cb);
				const getRows = (statement, cb) => tableRef.getData(statement, RAW_OPTS, cb);

				buildSchema({ runSql }, (schemaErr) => {
					if (schemaErr) {
						callback(`judgmentCache.open '${databaseFilePath}': ${schemaErr}`);
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
// buildSchema — WAL first (the crash-safety mode this store exists for), then CREATE TABLE IF NOT
// EXISTS the one content-addressed table, plus the UNIQUE index that IS the content address
// (promptHash, model, rendererVersion). The unique index is what makes putJudgment idempotent by
// construction: a second insert of the same address collides and is ignored, first write retained.
const buildSchema = ({ runSql }, callback) => {
	runSql(`PRAGMA journal_mode=WAL;`, (walErr) => {
		if (walErr) {
			callback(walErr);
			return;
		}
		runSql(
			`CREATE TABLE IF NOT EXISTS judgmentCacheEntries (
				seq             INTEGER PRIMARY KEY AUTOINCREMENT,
				promptHash      TEXT NOT NULL,
				model           TEXT NOT NULL,
				rendererVersion TEXT NOT NULL,
				judgmentJson    TEXT NOT NULL,
				generation      TEXT,
				createdAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);`,
			(err) => {
				if (err) {
					callback(err);
					return;
				}
				runSql(
					`CREATE UNIQUE INDEX IF NOT EXISTS judgmentCacheKeyUnique
					 ON judgmentCacheEntries(promptHash, model, rendererVersion);`,
					(indexErr) => callback(indexErr || ''),
				);
			},
		);
	});
};

// -----
const makeApi = ({ esc, runSql, getRows, databaseFilePath }) => {
	// validateKey — the THREE-PART address, refused by name when any part is missing or blank.
	// THE SOUNDNESS INVARIANT lives here: a caller that supplies less than all three parts is a
	// caller that could serve a judgment across a model or renderer boundary. There is no default.
	const validateKey = ({ promptHash, model, rendererVersion } = {}, who) => {
		const parts = { promptHash, model, rendererVersion };
		const badPart = ['promptHash', 'model', 'rendererVersion'].find(
			(oneName) => typeof parts[oneName] !== 'string' || parts[oneName].trim() === '',
		);
		if (badPart) {
			return (
				`judgmentCache.${who}: ${badPart} is required and must be a non-empty string — the cache ` +
				`key is (promptHash, model, rendererVersion), ALL THREE; a hit is only sound because ` +
				`identical rendered evidence + same model + same renderer version. There is no default.`
			);
		}
		return '';
	};

	// -----
	// getJudgment — the cached judgment for this exact (promptHash, model, rendererVersion), or
	// { judgment: null } when absent (a miss is an answer, not an error). On a hit the stored
	// payload is parsed back verbatim, plus its generation/createdAt metadata.
	const getJudgment = ({ promptHash, model, rendererVersion } = {}, callback) => {
		const keyErr = validateKey({ promptHash, model, rendererVersion }, 'getJudgment');
		if (keyErr) {
			callback(keyErr);
			return;
		}
		getRows(
			`SELECT judgmentJson, generation, createdAt FROM judgmentCacheEntries
			 WHERE promptHash=${esc(promptHash)} AND model=${esc(model)}
			   AND rendererVersion=${esc(rendererVersion)} LIMIT 1;`,
			(err, rows) => {
				if (err) {
					callback(err);
					return;
				}
				const row = rows && rows[0];
				if (!row) {
					callback('', { judgment: null }); // absence is an answer; the caller judges live
					return;
				}
				let judgment = null;
				let parseFault = '';
				const attempt = () => {
					judgment = JSON.parse(row.judgmentJson);
				};
				try {
					attempt();
				} catch (parseError) {
					parseFault = parseError.message;
				}
				if (parseFault) {
					callback(
						`judgmentCache.getJudgment: the stored judgment for promptHash ${promptHash} ` +
							`(model ${model}, rendererVersion ${rendererVersion}) is not valid JSON ` +
							`(${parseFault}). The row is corrupt; refusing to return it.`,
					);
					return;
				}
				callback('', { judgment, generation: row.generation, createdAt: row.createdAt });
			},
		);
	};

	// -----
	// putJudgment — store ONE decided judgment idempotently (INSERT OR IGNORE across the unique
	// address; first write wins — decided-time truth). judgment is the full decided payload:
	//   { choice: '<1-based ordinal>' | 'NONE', chosenStableId: <string|null>, category, rationale }
	// choice/rationale are required (a judgment without them is not a judgment); category is
	// required as a string (the discrete ⟪A4⟫ verdict); chosenStableId must be present (null for an
	// abstain) so a hit can VERIFY the ordinal still names the same candidate. generation is
	// informational metadata (which pipeline generation bought this judgment), never part of the key.
	const putJudgment = ({ promptHash, model, rendererVersion, generation, judgment } = {}, callback) => {
		const keyErr = validateKey({ promptHash, model, rendererVersion }, 'putJudgment');
		if (keyErr) {
			callback(keyErr);
			return;
		}
		if (!judgment || typeof judgment !== 'object' || Array.isArray(judgment)) {
			callback('judgmentCache.putJudgment: judgment is required and must be a plain object');
			return;
		}
		if (typeof judgment.choice !== 'string' || judgment.choice.trim() === '') {
			callback(
				`judgmentCache.putJudgment: judgment.choice is required and must be a non-empty string ` +
					`(a 1-based candidate ordinal, or 'NONE' for an abstain)`,
			);
			return;
		}
		if (typeof judgment.category !== 'string' || judgment.category.trim() === '') {
			callback('judgmentCache.putJudgment: judgment.category is required and must be a non-empty string');
			return;
		}
		if (typeof judgment.rationale !== 'string' || judgment.rationale.trim() === '') {
			callback('judgmentCache.putJudgment: judgment.rationale is required and must be a non-empty string');
			return;
		}
		if (judgment.chosenStableId === undefined) {
			callback(
				`judgmentCache.putJudgment: judgment.chosenStableId is required (null for an abstain) — ` +
					`a hit verifies the stored ordinal still names the same candidate through it`,
			);
			return;
		}
		runSql(
			`INSERT OR IGNORE INTO judgmentCacheEntries
			 (promptHash, model, rendererVersion, judgmentJson, generation)
			 VALUES (${esc(promptHash)}, ${esc(model)}, ${esc(rendererVersion)},
			         ${esc(JSON.stringify(judgment))}, ${esc(generation == null ? null : generation)});`,
			(err) => {
				if (err) {
					callback(`judgmentCache.putJudgment: ${err}`);
					return;
				}
				callback('', { stored: true });
			},
		);
	};

	return {
		databaseFilePath,
		getJudgment,
		putJudgment,
	};
};

// END OF moduleFunction() ============================================================

module.exports = judgmentCache;
