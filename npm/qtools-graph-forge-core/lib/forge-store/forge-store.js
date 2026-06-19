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
// forge-store — the relational SQLite store (schemas.md §1). Five content-addressed,
// immutable tables: blocks, manifests, manifestBlocks, graphs, manifestPointerLog.
// The graphs row additionally carries credentialReference + credentialValue (DECISIONS
// §5 reconciliation). Blocks dedup on blockId; manifests dedup on identical membership.
// Retain-all GC. Manifest pointer moves are append-only into manifestPointerLog and
// NEVER delete a prior manifest.
//
// Built ON server/data-model/lib/sqlite-instance (its initDatabaseInstance + getTable
// give us a managed better-sqlite3 db with callback-style runStatement/getData). We do
// not hand-roll better-sqlite3.

const moduleFunction =
	({ moduleName } = {}) =>
	(injectedDeps = {}) => {
		const { blockIdForText, manifestKeyForMembership } = contentAddress;

		// rawOpts: bypass sqlite-instance's <!tableName!> requirement and statement noise;
		// we issue fully-formed SQL against our explicitly-named tables.
		const rawOpts = { noTableNameOk: true, suppressStatementLog: true };

		// closured once init() succeeds:
		let dbHandle; // { runStatement, getData } from a sqlite-instance table handle

		// -----
		// helpers

		const esc = (value) =>
			value == null ? 'NULL' : sqlString.escape(`${value}`);

		const jsonOrNull = (value) =>
			value == null ? 'NULL' : sqlString.escape(JSON.stringify(value));

		const newGraphId = () =>
			`graph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

		// nextPointerTime — strictly-monotonic ISO-ish timestamp for manifestPointerLog.
		//   The schema PK is (graphId, fromTime) and the column default CURRENT_TIMESTAMP
		//   has only 1-second resolution, so two pointer moves in the same second would
		//   collide. We supply fromTime explicitly at ms resolution, with a per-process
		//   monotonic guard so even same-millisecond moves stay distinct.
		let lastPointerTimeMs = 0;
		const nextPointerTime = () => {
			let nowMs = Date.now();
			if (nowMs <= lastPointerTimeMs) {
				nowMs = lastPointerTimeMs + 1;
			}
			lastPointerTimeMs = nowMs;
			return new Date(nowMs).toISOString().replace('T', ' ').replace('Z', '');
		};

		const runSql = (statement, callback) =>
			dbHandle.runStatement(statement, rawOpts, callback);

		const getRows = (statement, callback) =>
			dbHandle.getData(statement, rawOpts, callback);

		// =====================================================================
		// INIT — open/create the db, ensure the 5 tables
		// =====================================================================

		const init = ({ dbPath }, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				const { initDatabaseInstance } = sqliteInstance({ unused: true });
				initDatabaseInstance(dbPath, (err, dbInstance) => {
					next(err, { ...args, dbInstance });
				});
			});

			// acquire one raw table handle (owner is incidental; we use it only for its
			// runStatement/getData against our own fully-named tables)
			taskList.push((args, next) => {
				const { dbInstance } = args;
				dbInstance.getTable('forgeStoreOps', rawOpts, (err, tableRef) => {
					if (err) {
						next(err, args);
						return;
					}
					dbHandle = tableRef;
					next('', { ...args, tableRef });
				});
			});

			taskList.push((args, next) => {
				const createBlocks = `CREATE TABLE IF NOT EXISTS blocks (
					blockId    TEXT PRIMARY KEY,
					type       TEXT NOT NULL,
					subject    TEXT,
					version    TEXT,
					requires   TEXT,
					text       BLOB NOT NULL,
					producedBy TEXT,
					createdAt  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				);`;
				runSql(createBlocks, (err) => next(err, args));
			});

			taskList.push((args, next) => {
				const createManifests = `CREATE TABLE IF NOT EXISTS manifests (
					manifestKey TEXT PRIMARY KEY,
					label       TEXT,
					basedOn      TEXT,
					note         TEXT,
					createdAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					FOREIGN KEY (basedOn) REFERENCES manifests(manifestKey)
				);`;
				runSql(createManifests, (err) => next(err, args));
			});

			taskList.push((args, next) => {
				const createManifestBlocks = `CREATE TABLE IF NOT EXISTS manifestBlocks (
					manifestKey TEXT NOT NULL,
					blockId     TEXT NOT NULL,
					position    INTEGER,
					PRIMARY KEY (manifestKey, blockId),
					FOREIGN KEY (manifestKey) REFERENCES manifests(manifestKey),
					FOREIGN KEY (blockId)     REFERENCES blocks(blockId)
				);`;
				runSql(createManifestBlocks, (err) => next(err, args));
			});

			taskList.push((args, next) => {
				// graphs gains credentialReference + credentialValue (DECISIONS §5)
				const createGraphs = `CREATE TABLE IF NOT EXISTS graphs (
					graphId             TEXT PRIMARY KEY,
					name                TEXT UNIQUE NOT NULL,
					location            TEXT,
					currentManifest     TEXT,
					type                TEXT,
					credentialReference TEXT,
					credentialValue     TEXT,
					createdAt           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					FOREIGN KEY (currentManifest) REFERENCES manifests(manifestKey)
				);`;
				runSql(createGraphs, (err) => next(err, args));
			});

			taskList.push((args, next) => {
				const createPointerLog = `CREATE TABLE IF NOT EXISTS manifestPointerLog (
					graphId     TEXT NOT NULL,
					manifestKey TEXT NOT NULL,
					fromTime    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					PRIMARY KEY (graphId, fromTime),
					FOREIGN KEY (graphId)     REFERENCES graphs(graphId),
					FOREIGN KEY (manifestKey) REFERENCES manifests(manifestKey)
				);`;
				runSql(createPointerLog, (err) => next(err, args));
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				callback(err, err ? undefined : {});
			});
		};

		// =====================================================================
		// BLOCKS
		// =====================================================================

		// saveBlock — content-address the text, insert if absent (dedup on blockId).
		const saveBlock = (
			{ type, subject, version, requires, text, producedBy },
			callback,
		) => {
			const blockId = blockIdForText(text);

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				getRows(
					`SELECT blockId FROM blocks WHERE blockId=${esc(blockId)};`,
					(err, rows) => next(err, { ...args, rows }),
				);
			});

			taskList.push((args, next) => {
				if (args.rows && args.rows.length > 0) {
					next('skipRestOfPipe', args); // already present — dedup
					return;
				}
				const statement = `INSERT INTO blocks
					(blockId, type, subject, version, requires, text, producedBy)
					VALUES (${esc(blockId)}, ${esc(type)}, ${esc(subject)}, ${esc(version)},
						${jsonOrNull(requires)}, ${esc(text)}, ${esc(producedBy)});`;
				runSql(statement, (err) => next(err, args));
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				callback(err === 'skipRestOfPipe' ? '' : err, { blockId });
			});
		};

		// getBlock — fetch one block by id; requires parsed back to an array.
		const getBlock = ({ blockId }, callback) => {
			getRows(
				`SELECT * FROM blocks WHERE blockId=${esc(blockId)};`,
				(err, rows) => {
					if (err) {
						callback(err);
						return;
					}
					const row = rows.qtGetSurePath('[0]', null);
					if (row && row.requires != null) {
						row.requires = JSON.parse(row.requires);
					}
					callback('', row);
				},
			);
		};

		// =====================================================================
		// MANIFESTS
		// =====================================================================

		// saveManifest — derive manifestKey from membership, dedup on identical
		// membership, write manifests + manifestBlocks rows.
		const saveManifest = ({ label, basedOn, note, members = [] }, callback) => {
			const manifestKey = manifestKeyForMembership(members);

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				getRows(
					`SELECT manifestKey FROM manifests WHERE manifestKey=${esc(manifestKey)};`,
					(err, rows) => next(err, { ...args, rows }),
				);
			});

			taskList.push((args, next) => {
				if (args.rows && args.rows.length > 0) {
					next('skipRestOfPipe', args); // identical membership — dedup
					return;
				}
				const statement = `INSERT INTO manifests
					(manifestKey, label, basedOn, note)
					VALUES (${esc(manifestKey)}, ${esc(label)}, ${esc(basedOn)}, ${esc(note)});`;
				runSql(statement, (err) => next(err, args));
			});

			// write each membership row
			members.forEach((oneMember) => {
				taskList.push((args, next) => {
					const position =
						oneMember.position == null ? 'NULL' : Number(oneMember.position);
					const statement = `INSERT INTO manifestBlocks
						(manifestKey, blockId, position)
						VALUES (${esc(manifestKey)}, ${esc(oneMember.blockId)}, ${position});`;
					runSql(statement, (err) => next(err, args));
				});
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				callback(err === 'skipRestOfPipe' ? '' : err, { manifestKey });
			});
		};

		// getManifest — manifest row + ordered members.
		const getManifest = ({ manifestKey }, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				getRows(
					`SELECT * FROM manifests WHERE manifestKey=${esc(manifestKey)};`,
					(err, rows) => next(err, { ...args, manifestRow: rows.qtGetSurePath('[0]', null) }),
				);
			});

			taskList.push((args, next) => {
				getRows(
					`SELECT blockId, position FROM manifestBlocks
						WHERE manifestKey=${esc(manifestKey)};`,
					(err, rows) => next(err, { ...args, members: rows }),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				if (!args.manifestRow) {
					callback('', null);
					return;
				}
				callback('', { ...args.manifestRow, members: args.members || [] });
			});
		};

		// =====================================================================
		// GRAPHS (registry)
		// =====================================================================

		// upsertGraph — insert or update by unique name. Only provided fields are
		// written/overwritten (partial update preserves untouched columns).
		const upsertGraph = (
			{ name, location, type, credentialReference, credentialValue },
			callback,
		) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				getRows(
					`SELECT * FROM graphs WHERE name=${esc(name)};`,
					(err, rows) => next(err, { ...args, existing: rows.qtGetSurePath('[0]', null) }),
				);
			});

			taskList.push((args, next) => {
				const { existing } = args;

				if (existing) {
					const assignments = [];
					if (location !== undefined) assignments.push(`location=${esc(location)}`);
					if (type !== undefined) assignments.push(`type=${esc(type)}`);
					if (credentialReference !== undefined)
						assignments.push(`credentialReference=${esc(credentialReference)}`);
					if (credentialValue !== undefined)
						assignments.push(`credentialValue=${esc(credentialValue)}`);

					if (assignments.length === 0) {
						next('', { ...args, graphId: existing.graphId });
						return;
					}
					runSql(
						`UPDATE graphs SET ${assignments.join(', ')} WHERE name=${esc(name)};`,
						(err) => next(err, { ...args, graphId: existing.graphId }),
					);
					return;
				}

				const graphId = newGraphId();
				runSql(
					`INSERT INTO graphs
						(graphId, name, location, type, credentialReference, credentialValue)
						VALUES (${esc(graphId)}, ${esc(name)}, ${esc(location)}, ${esc(type)},
							${esc(credentialReference)}, ${esc(credentialValue)});`,
					(err) => next(err, { ...args, graphId }),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				callback(err, err ? undefined : { graphId: args.graphId, name });
			});
		};

		// getGraphByName — raw registry row (incl. credential columns). Credential
		// values are returned here for credential-accessor's use; never logged.
		const getGraphByName = ({ name }, callback) => {
			getRows(
				`SELECT * FROM graphs WHERE name=${esc(name)};`,
				(err, rows) => {
					if (err) {
						callback(err);
						return;
					}
					callback('', rows.qtGetSurePath('[0]', null));
				},
			);
		};

		// setCurrentManifest — advance a graph's pointer AND append a pointer-log row.
		// NEVER deletes a prior manifest.
		const setCurrentManifest = ({ name, manifestKey }, callback) => {
			pointerMove({ name, manifestKey }, callback);
		};

		// rollbackPointer — repoint currentManifest to a PRIOR manifestKey + append a
		// pointer-log row; the prior manifest row is never deleted. Same mechanism as
		// setCurrentManifest, distinct verb for caller intent.
		const rollbackPointer = ({ name, toManifestKey }, callback) => {
			pointerMove({ name, manifestKey: toManifestKey }, callback);
		};

		// pointerMove — shared pointer advance/rollback.
		const pointerMove = ({ name, manifestKey }, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				getGraphByName({ name }, (err, graphRow) => {
					if (err) {
						next(err, args);
						return;
					}
					if (!graphRow) {
						next(`no graph named '${name}' [${moduleName}]`, args);
						return;
					}
					next('', { ...args, graphRow });
				});
			});

			taskList.push((args, next) => {
				runSql(
					`UPDATE graphs SET currentManifest=${esc(manifestKey)} WHERE name=${esc(name)};`,
					(err) => next(err, args),
				);
			});

			taskList.push((args, next) => {
				runSql(
					`INSERT INTO manifestPointerLog (graphId, manifestKey, fromTime)
						VALUES (${esc(args.graphRow.graphId)}, ${esc(manifestKey)}, ${esc(nextPointerTime())});`,
					(err) => next(err, args),
				);
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				callback(err, err ? undefined : { name, manifestKey });
			});
		};

		// listGraphs — all registry rows.
		const listGraphs = (callback) => {
			getRows(`SELECT * FROM graphs;`, (err, rows) =>
				callback(err, err ? undefined : rows),
			);
		};

		// dropGraph — remove a graph registry row + its pointer-log rows. Manifests and
		// blocks are NEVER touched (retain-all).
		const dropGraph = ({ name }, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				getGraphByName({ name }, (err, graphRow) =>
					next(err, { ...args, graphRow }),
				);
			});

			taskList.push((args, next) => {
				if (!args.graphRow) {
					next('', args);
					return;
				}
				runSql(
					`DELETE FROM manifestPointerLog WHERE graphId=${esc(args.graphRow.graphId)};`,
					(err) => next(err, args),
				);
			});

			taskList.push((args, next) => {
				runSql(`DELETE FROM graphs WHERE name=${esc(name)};`, (err) =>
					next(err, args),
				);
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				callback(err, err ? undefined : { name });
			});
		};

		// =====================================================================
		// GC (retain-all)
		// =====================================================================

		// collectibleBlockIds — blockIds referenced by NO retained manifest. Every
		// manifest is retained (retain-all), so a block is collectible iff it appears
		// in no manifestBlocks row.
		const collectibleBlockIds = (callback) => {
			getRows(
				`SELECT b.blockId AS blockId FROM blocks b
					WHERE NOT EXISTS (
						SELECT 1 FROM manifestBlocks mb WHERE mb.blockId = b.blockId
					);`,
				(err, rows) => {
					if (err) {
						callback(err);
						return;
					}
					callback('', rows.map((oneRow) => oneRow.blockId));
				},
			);
		};

		// =====================================================================
		// VALIDATION — bridge-closure law
		// =====================================================================

		// validateManifestClosure — a manifest is well-formed iff every
		// relationships/overlay block's required subjects are present in the manifest
		// AND ordered earlier (topo over `requires`). Returns {wellFormed, violations}.
		const validateManifestClosure = ({ manifestKey }, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				getManifest({ manifestKey }, (err, manifest) => {
					if (err) {
						next(err, args);
						return;
					}
					if (!manifest) {
						next(`no manifest '${manifestKey}' [${moduleName}]`, args);
						return;
					}
					next('', { ...args, members: manifest.members });
				});
			});

			// load each member block's metadata (type, subject, requires)
			taskList.push((args, next) => {
				const blockTaskList = new taskListPlus();
				const memberBlocks = [];

				args.members.forEach((oneMember) => {
					blockTaskList.push((blockArgs, blockNext) => {
						getBlock({ blockId: oneMember.blockId }, (err, blockRow) => {
							if (err) {
								blockNext(err, blockArgs);
								return;
							}
							memberBlocks.push({
								blockId: oneMember.blockId,
								position: oneMember.position,
								type: blockRow ? blockRow.type : null,
								subject: blockRow ? blockRow.subject : null,
								requires:
									blockRow && blockRow.requires ? blockRow.requires : [],
							});
							blockNext('', blockArgs);
						});
					});
				});

				pipeRunner(blockTaskList.getList(), {}, (err) =>
					next(err, { ...args, memberBlocks }),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}

				const { memberBlocks } = args;

				// derive build order: explicit position when set, else topo over requires.
				const ordered = deriveBuildOrder(memberBlocks);

				if (ordered.cycle) {
					callback('', {
						wellFormed: false,
						violations: [
							{
								kind: 'cycle',
								detail: `requires graph has a cycle among: ${ordered.cycleMembers.join(', ')}`,
							},
						],
					});
					return;
				}

				const orderedBlocks = ordered.list;
				const subjectFirstAppearance = {};
				orderedBlocks.forEach((oneBlock, index) => {
					if (
						oneBlock.subject != null &&
						subjectFirstAppearance[oneBlock.subject] === undefined
					) {
						subjectFirstAppearance[oneBlock.subject] = index;
					}
				});

				const violations = [];

				orderedBlocks.forEach((oneBlock, index) => {
					if (oneBlock.type !== 'relationships' && oneBlock.type !== 'overlay') {
						return;
					}
					(oneBlock.requires || []).forEach((requiredSubject) => {
						const subjectIndex = subjectFirstAppearance[requiredSubject];
						if (subjectIndex === undefined) {
							violations.push({
								kind: 'missing',
								blockId: oneBlock.blockId,
								requiredSubject,
								detail: `block ${oneBlock.blockId} (${oneBlock.type}) requires subject '${requiredSubject}' which is absent from the manifest`,
							});
							return;
						}
						if (subjectIndex >= index) {
							violations.push({
								kind: 'order',
								blockId: oneBlock.blockId,
								requiredSubject,
								detail: `block ${oneBlock.blockId} (${oneBlock.type}) requires subject '${requiredSubject}' which is not ordered earlier`,
							});
						}
					});
				});

				callback('', { wellFormed: violations.length === 0, violations });
			});
		};

		// deriveBuildOrder — order memberBlocks: explicit position first (ascending),
		// then a topological sort over `requires` (a block sorts after blocks whose
		// subject it requires). Detects cycles.
		const deriveBuildOrder = (memberBlocks) => {
			const explicit = memberBlocks
				.filter((oneBlock) => oneBlock.position != null)
				.sort((first, second) => first.position - second.position);

			const derived = memberBlocks.filter((oneBlock) => oneBlock.position == null);

			// map subject -> blocks providing it (among the derived set)
			const bySubject = {};
			derived.forEach((oneBlock) => {
				if (oneBlock.subject != null) {
					bySubject[oneBlock.subject] = bySubject[oneBlock.subject] || [];
					bySubject[oneBlock.subject].push(oneBlock);
				}
			});

			const visited = {};
			const onStack = {};
			const result = [];
			let cycle = false;
			const cycleMembers = [];

			const visit = (oneBlock) => {
				if (cycle) return;
				if (visited[oneBlock.blockId]) return;
				if (onStack[oneBlock.blockId]) {
					cycle = true;
					cycleMembers.push(oneBlock.blockId);
					return;
				}
				onStack[oneBlock.blockId] = true;
				(oneBlock.requires || []).forEach((requiredSubject) => {
					(bySubject[requiredSubject] || []).forEach((providerBlock) => {
						if (providerBlock.blockId !== oneBlock.blockId) {
							visit(providerBlock);
						}
					});
				});
				onStack[oneBlock.blockId] = false;
				visited[oneBlock.blockId] = true;
				result.push(oneBlock);
			};

			derived.forEach((oneBlock) => visit(oneBlock));

			if (cycle) {
				return { cycle: true, cycleMembers };
			}

			return { cycle: false, list: [...explicit, ...result] };
		};

		return {
			init,
			saveBlock,
			getBlock,
			saveManifest,
			getManifest,
			upsertGraph,
			getGraphByName,
			setCurrentManifest,
			rollbackPointer,
			listGraphs,
			dropGraph,
			collectibleBlockIds,
			validateManifestClosure,
			deriveBuildOrder,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
