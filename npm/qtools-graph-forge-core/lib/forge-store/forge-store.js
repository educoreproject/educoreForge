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
		const { blockIdForText, manifestKeyForMembership, dedupMembersByBlockId } =
			contentAddress;

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

		// parseRequiresColumn — guarded parse of a block row's requires column (L9): one corrupt
		// row must surface as a named, explicit error on the error channel, never a raw
		// JSON.parse stack. The guard is isolated to the parse itself (the one sanctioned local
		// exception, mirroring llm-client's response-body guard). A null column passes through
		// unchanged so each caller keeps its own null semantics.
		const parseRequiresColumn = (row) => {
			if (row.requires == null) {
				return { requires: row.requires };
			}
			let parsed;
			try {
				parsed = JSON.parse(row.requires);
			} catch (parseErr) {
				return {
					error:
						`block ${row.blockId} (type ${row.type}, subject ${row.subject}, version ` +
						`${row.version}): requires column is not valid JSON (${parseErr.message}) — ` +
						`the row is corrupt. Refusing to return it.`,
				};
			}
			return { requires: parsed };
		};

		// getBlock — fetch one block by id; requires parsed back to an array.
		//   VERIFY-ON-READ (item 19): the store is content-addressed — blockId IS sha256(text).
		//   Every read recomputes the hash and REFUSES a mismatch loudly, NAMING the block: a
		//   corrupted/tampered text must never flow into a build as though it were the addressed
		//   content. This is the single choke point for every read-side consumer (replay
		//   graph-builder, node-loader, the edf pipeline loadBlocks).
		const getBlock = ({ blockId }, callback) => {
			getRows(
				`SELECT * FROM blocks WHERE blockId=${esc(blockId)};`,
				(err, rows) => {
					if (err) {
						callback(err);
						return;
					}
					const row = rows.qtGetSurePath('[0]', null);
					if (row) {
						const recomputedId = blockIdForText(row.text);
						if (recomputedId !== row.blockId) {
							callback(
								`content-address verification failed reading block ${row.blockId} ` +
									`(type ${row.type}, subject ${row.subject}, version ${row.version}): ` +
									`stored text hashes to ${recomputedId} — the block text is corrupt or ` +
									`tampered. Refusing to return it.`,
							);
							return;
						}
					}
					if (row) {
						const parsedRequires = parseRequiresColumn(row);
						if (parsedRequires.error) {
							callback(`getBlock: ${parsedRequires.error}`);
							return;
						}
						row.requires = parsedRequires.requires;
					}
					callback('', row);
				},
			);
		};

		// listBlocks — all block rows; requires parsed back to an array per row
		// (mirrors getBlock's requires-parsing). No filtering — callers (e.g.
		// manifest-editor) apply any type-scoping semantics.
		const listBlocks = (callback) => {
			getRows(`SELECT * FROM blocks;`, (err, rows) => {
				if (err) {
					callback(err);
					return;
				}
				let requiresParseError = null;
				const parsedRows = rows.map((oneRow) => {
					if (requiresParseError) {
						return null;
					}
					const parsedRequires = parseRequiresColumn(oneRow);
					if (parsedRequires.error) {
						requiresParseError = `listBlocks: ${parsedRequires.error}`;
						return null;
					}
					return {
						...oneRow,
						requires: parsedRequires.requires != null ? parsedRequires.requires : [],
					};
				});
				if (requiresParseError) {
					callback(requiresParseError);
					return;
				}
				callback('', parsedRows);
			});
		};

		// =====================================================================
		// MANIFESTS
		// =====================================================================

		// saveManifest — derive manifestKey from membership, dedup on identical
		// membership, write manifests + manifestBlocks rows.
		//   M5: members are deduped by blockId (first occurrence wins) with the SAME rule
		//   manifestKeyForMembership hashes, so the stored rows always match the key and a
		//   duplicated blockId can neither mint a spurious key nor blow the composite PK.
		//   M4: the manifest row + ALL member rows land in ONE transaction (BEGIN IMMEDIATE /
		//   COMMIT, ROLLBACK on any error) — a mid-membership crash can no longer leave a
		//   partial manifest. The identical-membership dedup path VERIFIES the stored member
		//   count before reporting success, so a partial manifest written by a pre-transaction
		//   store is refused loudly instead of silently blessed.
		const saveManifest = ({ label, basedOn, note, members = [] }, callback) => {
			const effectiveMembers = dedupMembersByBlockId(members);
			const manifestKey = manifestKeyForMembership(effectiveMembers);

			// L10 — a member position must be numeric or absent: a non-numeric position would
			// otherwise interpolate NaN into the member INSERT. Fail fast HERE, before the
			// transaction opens (no BEGIN/ROLLBACK churn), naming the first offender.
			const badPositionMembers = effectiveMembers.filter(
				(oneMember) =>
					oneMember.position != null && !Number.isFinite(Number(oneMember.position)),
			);
			if (badPositionMembers.length > 0) {
				callback(
					`saveManifest: ${badPositionMembers.length} member(s) carry a non-numeric ` +
						`position — first offender blockId ${badPositionMembers[0].blockId} ` +
						`(position ${JSON.stringify(badPositionMembers[0].position)}). Refusing to save.`,
					{ manifestKey },
				);
				return;
			}

			let transactionOpen = false;

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				getRows(
					`SELECT manifestKey FROM manifests WHERE manifestKey=${esc(manifestKey)};`,
					(err, rows) => next(err, { ...args, rows }),
				);
			});

			taskList.push((args, next) => {
				if (args.rows && args.rows.length > 0) {
					// identical membership — dedup path. VERIFY completeness before success (M4).
					getRows(
						`SELECT count(*) AS memberCount FROM manifestBlocks
							WHERE manifestKey=${esc(manifestKey)};`,
						(err, countRows) => {
							if (err) {
								next(err);
								return;
							}
							const memberCount = countRows.qtGetSurePath('[0].memberCount', -1);
							if (memberCount !== effectiveMembers.length) {
								next(
									`saveManifest: manifest ${manifestKey} already exists with ` +
										`${memberCount} member row(s) but this membership hashes to ` +
										`${effectiveMembers.length} member(s) — a prior save left a PARTIAL ` +
										`manifest. Refusing to report success; repair the store (remove the ` +
										`manifests + manifestBlocks rows for this key, then re-save).`,
								);
								return;
							}
							next('skipRestOfPipe', args);
						},
					);
					return;
				}
				runSql('BEGIN IMMEDIATE;', (err) => {
					if (err) {
						next(err);
						return;
					}
					transactionOpen = true;
					next('', args);
				});
			});

			taskList.push((args, next) => {
				const statement = `INSERT INTO manifests
					(manifestKey, label, basedOn, note)
					VALUES (${esc(manifestKey)}, ${esc(label)}, ${esc(basedOn)}, ${esc(note)});`;
				runSql(statement, (err) => next(err, args));
			});

			// write each membership row (inside the transaction)
			effectiveMembers.forEach((oneMember) => {
				taskList.push((args, next) => {
					const position =
						oneMember.position == null ? 'NULL' : Number(oneMember.position);
					const statement = `INSERT INTO manifestBlocks
						(manifestKey, blockId, position)
						VALUES (${esc(manifestKey)}, ${esc(oneMember.blockId)}, ${position});`;
					runSql(statement, (err) => next(err, args));
				});
			});

			taskList.push((args, next) => {
				runSql('COMMIT;', (err) => {
					if (err) {
						next(err);
						return;
					}
					transactionOpen = false;
					next('', args);
				});
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				if (err && err !== 'skipRestOfPipe' && transactionOpen) {
					// roll the open transaction back, then surface the ORIGINAL error.
					runSql('ROLLBACK;', () => callback(err, { manifestKey }));
					return;
				}
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

		// listManifests — all manifest rows (no members; use getManifest for that).
		const listManifests = (callback) => {
			getRows(`SELECT * FROM manifests;`, (err, rows) =>
				callback(err, err ? undefined : rows),
			);
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

		// validateManifestClosure — blockId-canonical closure check (D1 design review).
		// Producers emit `requires` as arrays of 64-hex blockIds (content hashes) — that
		// IS the canonical contract, for every block type (standard/reference/mapping).
		// A manifest is well-formed iff every member's required blockIds are (a) members
		// of the manifest and (b) ordered earlier in the derived build order. Content-
		// addressing rationale: a mapping is computed against EXACT reference content;
		// recombining with a re-forged reference (a different blockId) MUST fail closure
		// and force a re-forge — that strictness is the point. Returns {wellFormed, violations}.
		const HEX64_RE = /^[0-9a-f]{64}$/;
		const shortBlockId = (blockId) => (blockId || '').slice(0, 8);
		const describeBlockMeta = (blockMeta) =>
			blockMeta
				? `${blockMeta.type} ${blockMeta.subject == null ? '' : blockMeta.subject}`.trim()
				: '(unknown block)';

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

				// LEGACY DETECTION FIRST — any member with a non-hex64 requires entry
				// predates the pure blockId-requires contract. Validate it as legacy, not
				// as closure: no subject-semantics shim, single code path.
				const legacyViolations = [];
				memberBlocks.forEach((oneBlock) => {
					const hasLegacyRequires = (oneBlock.requires || []).some(
						(oneRequire) => !HEX64_RE.test(oneRequire),
					);
					if (hasLegacyRequires) {
						legacyViolations.push({
							blockId: oneBlock.blockId,
							type: oneBlock.type,
							detail:
								'legacy subject-form requires — not validatable under the pure model',
						});
					}
				});

				if (legacyViolations.length > 0) {
					callback('', { wellFormed: false, violations: legacyViolations });
					return;
				}

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
				const memberIds = new Set(orderedBlocks.map((oneBlock) => oneBlock.blockId));
				const positionByBlockId = {};
				const metaByBlockId = {};
				orderedBlocks.forEach((oneBlock, index) => {
					positionByBlockId[oneBlock.blockId] = index;
					metaByBlockId[oneBlock.blockId] = {
						type: oneBlock.type,
						subject: oneBlock.subject,
					};
				});

				const violations = [];
				const missingLookups = []; // { oneBlock, requiredBlockId } needing a getBlock lookup

				orderedBlocks.forEach((oneBlock, index) => {
					(oneBlock.requires || []).forEach((requiredBlockId) => {
						if (!memberIds.has(requiredBlockId)) {
							missingLookups.push({ oneBlock, requiredBlockId });
							return;
						}
						if (positionByBlockId[requiredBlockId] >= index) {
							violations.push({
								kind: 'order',
								blockId: oneBlock.blockId,
								requiredBlockId,
								detail: `block ${shortBlockId(oneBlock.blockId)} (${describeBlockMeta(metaByBlockId[oneBlock.blockId])}) requires ${shortBlockId(requiredBlockId)} (${describeBlockMeta(metaByBlockId[requiredBlockId])}) which is ordered later`,
							});
						}
					});
				});

				// resolve (type, subject) for required blockIds absent from the manifest
				// via a store lookup, so violation messages stay human-readable.
				const lookupTaskList = new taskListPlus();
				missingLookups.forEach(({ oneBlock, requiredBlockId }) => {
					lookupTaskList.push((lookupArgs, lookupNext) => {
						getBlock({ blockId: requiredBlockId }, (err, blockRow) => {
							if (err) {
								lookupNext(err, lookupArgs);
								return;
							}
							const requiredMeta = blockRow
								? { type: blockRow.type, subject: blockRow.subject }
								: null;
							violations.push({
								kind: 'missing',
								blockId: oneBlock.blockId,
								requiredBlockId,
								detail: `block ${shortBlockId(oneBlock.blockId)} (${describeBlockMeta(metaByBlockId[oneBlock.blockId])}) requires ${shortBlockId(requiredBlockId)} (${describeBlockMeta(requiredMeta)}) which is absent from the manifest`,
							});
							lookupNext('', lookupArgs);
						});
					});
				});

				pipeRunner(lookupTaskList.getList(), {}, (err) => {
					if (err) {
						callback(err);
						return;
					}
					callback('', { wellFormed: violations.length === 0, violations });
				});
			});
		};

		// deriveBuildOrder — blockId-canonical reader semantics (D1 design review).
		// Order memberBlocks: explicit `position` entries first (ascending), then a
		// TOPOLOGICAL sort over blockId-requires for ALL block types — a block sorts
		// after every block whose blockId it requires. Deterministic tie-break among
		// ready nodes: type rank (standard=0, reference=1, mapping=2, anything else=3),
		// then subject (null last), then blockId. DEGRADES, NEVER THROWS: any requires
		// entry that isn't a resolvable member blockId is ignored for ordering (the
		// block still places by tie-break/insertion) and is surfaced via the returned
		// `unresolvedRequires` list so -show can report it. Keeps cycle detection,
		// reporting cycleMembers by blockId.
		const buildOrderTypeRank = { standard: 0, reference: 1, mapping: 2 };
		const rankForBuildOrderType = (oneBlock) =>
			buildOrderTypeRank[oneBlock.type] !== undefined
				? buildOrderTypeRank[oneBlock.type]
				: 3;

		const compareReadyBlocks = (first, second) => {
			const rankDiff = rankForBuildOrderType(first) - rankForBuildOrderType(second);
			if (rankDiff !== 0) return rankDiff;

			const firstSubject = first.subject == null ? null : first.subject;
			const secondSubject = second.subject == null ? null : second.subject;
			if (firstSubject !== secondSubject) {
				if (firstSubject == null) return 1; // null sorts last
				if (secondSubject == null) return -1;
				return firstSubject < secondSubject ? -1 : 1;
			}

			return first.blockId < second.blockId ? -1 : first.blockId > second.blockId ? 1 : 0;
		};

		const deriveBuildOrder = (memberBlocks) => {
			const explicit = memberBlocks
				.filter((oneBlock) => oneBlock.position != null)
				.sort((first, second) => first.position - second.position);

			const derived = memberBlocks.filter((oneBlock) => oneBlock.position == null);

			const explicitBlockIds = new Set(explicit.map((oneBlock) => oneBlock.blockId));
			const derivedById = {};
			derived.forEach((oneBlock) => {
				derivedById[oneBlock.blockId] = oneBlock;
			});

			// dependents[providerBlockId] -> [dependentBlockId, ...] within the derived
			// set only; requires pointing at an explicit-position block are trivially
			// satisfied (explicit always sorts first) and requires pointing at no member
			// blockId degrade to "unresolved" rather than throwing.
			const dependents = {};
			const remainingRequires = {};
			const unresolvedByBlockId = {};

			derived.forEach((oneBlock) => {
				dependents[oneBlock.blockId] = [];
				remainingRequires[oneBlock.blockId] = 0;
			});

			derived.forEach((oneBlock) => {
				const unresolved = [];
				(oneBlock.requires || []).forEach((requiredBlockId) => {
					if (requiredBlockId === oneBlock.blockId) {
						return; // self-reference — not a real ordering constraint, ignore
					}
					if (derivedById[requiredBlockId]) {
						dependents[requiredBlockId].push(oneBlock.blockId);
						remainingRequires[oneBlock.blockId] += 1;
						return;
					}
					if (explicitBlockIds.has(requiredBlockId)) {
						return; // resolvable, trivially satisfied — explicit blocks sort first
					}
					unresolved.push(requiredBlockId);
				});
				if (unresolved.length > 0) {
					unresolvedByBlockId[oneBlock.blockId] = unresolved;
				}
			});

			// Kahn's algorithm with a deterministic tie-break among ready nodes.
			const remaining = new Set(derived.map((oneBlock) => oneBlock.blockId));
			const result = [];
			let cycle = false;
			const cycleMembers = [];

			while (remaining.size > 0) {
				const readyNodes = [...remaining]
					.map((blockId) => derivedById[blockId])
					.filter((oneBlock) => remainingRequires[oneBlock.blockId] === 0)
					.sort(compareReadyBlocks);

				if (readyNodes.length === 0) {
					cycle = true;
					cycleMembers.push(...remaining);
					break;
				}

				const chosen = readyNodes[0];
				result.push(chosen);
				remaining.delete(chosen.blockId);
				dependents[chosen.blockId].forEach((dependentBlockId) => {
					remainingRequires[dependentBlockId] -= 1;
				});
			}

			if (cycle) {
				return { cycle: true, cycleMembers };
			}

			const unresolvedRequires = Object.keys(unresolvedByBlockId).map((blockId) => ({
				blockId,
				requires: unresolvedByBlockId[blockId],
			}));

			return { cycle: false, list: [...explicit, ...result], unresolvedRequires };
		};

		return {
			init,
			saveBlock,
			getBlock,
			listBlocks,
			saveManifest,
			getManifest,
			listManifests,
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
