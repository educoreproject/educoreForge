'use strict';

// standards-database.js — where schema blocks live, and what they belong to.
//
// A port of the incumbent's `forge-store`, renamed at TQ's instruction (2026-07-22): "forge-store"
// named who wrote to it; this names what is in it.
//
// CONTENT-ADDRESSED. A schema block's refId IS sha256 of its text. Two consequences follow and both
// are load-bearing:
//   * writing the same block twice is a no-op, so a failed build leaves a warm cache rather than a
//     mess, and re-runs are cheap;
//   * every READ recomputes the hash and REFUSES a mismatch, naming the block. A corrupted or
//     tampered text must never flow into a build as though it were the addressed content. This is
//     the single choke point for every read-side consumer, which is why it is here and not in each
//     of them.
//
// Nothing is ever UPDATED. A different block is a different row; a different membership is a
// different manifest. That is what makes an address mean something.
//
// THE DATABASE PATH IS REQUIRED AND HAS NO DEFAULT. This is the whole of the safety story and it is
// deliberately not more than that. On 2026-07-17 a scratch-intended `manifestEditor -save` silently
// wrote the canonical store because it had no path handling and fell through to one. A caller that
// must say where it is writing cannot fall through to anywhere. (The supervisor previously proposed
// elaborate refusal machinery — "structurally unable to reach the canonical store" — which TQ
// retired on 2026-07-22 as a phrase with no definition behind it. This is what survived, and it is
// the part that was ever true.)
//
// SCOPE. Three tables: blocks, manifests, manifestBlocks. The incumbent also carries `graphs` +
// `manifestPointerLog` (which graph points at which manifest, with credentials) and
// `currentPairGroup` + `pairGroupPointerLog` (pairwise version switching). Neither is ported:
//   * graphs would resurrect the credential registry replayManager deliberately deleted — a scratch
//     graph's credential lives in its handle and nowhere else;
//   * the pairGroup machinery keys RELATIONSHIP blocks by pair@versionKey, which is Phase C. It gets
//     ported when bridging does, not before.
//
// VOCABULARY (TQ, 2026-07-22): `refId` is a thing's own id; `<subject>RefId` is a reference to
// another thing. "key" is banned as too general.
//
// Async style: callback(errString, result); qtools taskListPlus/pipeRunner for sequencing.

const path = require('path');
const fs = require('fs');
const sqlString = require('sqlstring-sqlite');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const TREE_LIB = path.join(__dirname, '..');
const sqliteInstance = require(path.join(TREE_LIB, 'sqlite-instance', 'sqlite-instance'))({});
const contentAddress = require(path.join(TREE_LIB, 'content-address', 'content-address'))();
const vocabulary = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary'));

// The option shape sqlite-instance needs for hand-written SQL: runStatement REFUSES a statement
// with no <!tableName!> substitution tag unless noTableNameOk says the caller means it.
const RAW_OPTS = { noTableNameOk: true, suppressStatementLog: true };

// The LOCKED block taxonomy is the VOCABULARY REGISTRY's, not this module's. It used to be
// declared here and re-exported to manifestEditor, which made the store the accidental home of a
// word list that has nothing to do with sqlite — and forced manifestEditor into a lazy require to
// avoid dragging sqlite-instance in behind it. vocabulary is a pure data module, so the import is
// unconditional and the load-order debt is gone.
const KINDS = vocabulary.SCHEMA_BLOCK_KINDS;

// -----
// headerBlockTypeOfText — what a schema block SAYS it is, read from its own first line.
//
// A schema block is PG-JSONL and line 1 IS the header (replay-block.serializeHeaderLine). Read
// here with a plain JSON.parse rather than through replay-block.deserializeBlock deliberately: the
// store must not parse a few hundred megabytes of node lines to learn one field, and a store that
// required the replay codec would refuse blocks it is perfectly able to hold.
//
// Returns '' when there is no readable header — which saveBlock treats as a refusal, not as
// permission. A block whose kind nothing certifies is exactly the case this gate exists for.
const headerBlockTypeOfText = (text) => {
	const firstLine = String(text).split('\n')[0];
	let header;
	try {
		header = JSON.parse(firstLine);
	} catch (parseError) {
		return '';
	}
	if (!header || typeof header !== 'object' || typeof header.blockType !== 'string') {
		return '';
	}
	return header.blockType;
};

// START OF moduleFunction() ============================================================

const standardsDatabase = () => {
	// -----
	// open — the ONLY door. databaseFilePath is required; there is no default and no fallback.
	const open = ({ databaseFilePath }, callback) => {
		if (!databaseFilePath || typeof databaseFilePath !== 'string') {
			callback(
				`standardsDatabase.open: databaseFilePath is REQUIRED and has no default. A caller ` +
					`that does not say where it is writing is a caller that can write anywhere.`,
			);
			return;
		}

		const parentDir = path.dirname(path.resolve(databaseFilePath));
		if (!fs.existsSync(parentDir)) {
			callback(
				`standardsDatabase.open: the directory '${parentDir}' does not exist. Refusing to ` +
					`create a database somewhere nobody has prepared.`,
			);
			return;
		}

		sqliteInstance.initDatabaseInstance(databaseFilePath, (initErr, dbInstance) => {
			if (initErr) {
				callback(`standardsDatabase.open '${databaseFilePath}': ${initErr}`);
				return;
			}

			// one table handle gives us runStatement/getData; every statement below is hand-written
			// because the schema is ours, not sqlite-instance's object mapping.
			dbInstance.getTable('standardsDatabaseOps', RAW_OPTS, (tableErr, tableRef) => {
				if (tableErr) {
					callback(`standardsDatabase.open '${databaseFilePath}': ${tableErr}`);
					return;
				}

				const esc = (value) => (value == null ? 'NULL' : sqlString.escape(`${value}`));
				const escJson = (value) =>
					value == null ? 'NULL' : sqlString.escape(JSON.stringify(value));
				const runSql = (statement, cb) => tableRef.runStatement(statement, RAW_OPTS, cb);
				const getRows = (statement, cb) => tableRef.getData(statement, RAW_OPTS, cb);

				buildSchema({ runSql, getRows }, (schemaErr) => {
					if (schemaErr) {
						callback(`standardsDatabase.open '${databaseFilePath}': ${schemaErr}`);
						return;
					}
					callback('', makeApi({ esc, escJson, runSql, getRows, databaseFilePath }));
				});
			});
		});
	};

	return { open };
};

// -----
// buildSchema — CREATE TABLE IF NOT EXISTS, in dependency order.
const buildSchema = ({ runSql, getRows }, callback) => {
	const taskList = new taskListPlus();

	// blocks — the content-addressed heart. refId IS sha256(text).
	taskList.push((args, next) => {
		runSql(
			`CREATE TABLE IF NOT EXISTS blocks (
				refId        TEXT PRIMARY KEY,
				kind         TEXT NOT NULL,
				subject TEXT,
				version      TEXT,
				requires     TEXT,
				text         BLOB NOT NULL,
				producedBy   TEXT,
				createdAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);`,
			(err) => next(err, args),
		);
	});

	// manifests — refId is the hash of the MEMBERSHIP, so identical membership is the same manifest.
	// name and description are for FINDING; they are deliberately not part of the address.
	taskList.push((args, next) => {
		runSql(
			`CREATE TABLE IF NOT EXISTS manifests (
				refId                 TEXT PRIMARY KEY,
				name                  TEXT,
				description           TEXT,
				recipeName            TEXT,
				recipeHash            TEXT,
				recipeFileName        TEXT,
				basedOnManifestRefId  TEXT,
				createdAt             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (basedOnManifestRefId) REFERENCES manifests(refId)
			);`,
			(err) => next(err, args),
		);
	});

	// manifestBlocks — the membership. description lives HERE rather than on the block because the
	// same block can be used by two manifests for different reasons, and because it must stay out
	// of the content address: manifestKeyForMembership hashes schemaBlockRefId + position, nothing
	// else. Fixing a typo in a description must never change a manifest's identity.
	taskList.push((args, next) => {
		runSql(
			`CREATE TABLE IF NOT EXISTS manifestBlocks (
				manifestRefId    TEXT NOT NULL,
				schemaBlockRefId TEXT NOT NULL,
				position         INTEGER,
				description      TEXT,
				PRIMARY KEY (manifestRefId, schemaBlockRefId),
				FOREIGN KEY (manifestRefId)    REFERENCES manifests(refId),
				FOREIGN KEY (schemaBlockRefId) REFERENCES blocks(refId)
			);`,
			(err) => next(err, args),
		);
	});

	// sqlite-instance adds columns dynamically for objects saved through saveObject — but this
	// module writes hand-written INSERTs through runStatement, so it bypasses that machinery
	// entirely. CREATE TABLE IF NOT EXISTS does NOT retrofit a table that already exists, so a
	// database made before a column was added would silently lack it and every write of that column
	// would fail. Ask the table what it actually has and add what is missing.
	taskList.push((args, next) => {
		ensureColumns(
			{ runSql, getRows },
			{
				manifests: { recipeName: 'TEXT', recipeHash: 'TEXT', recipeFileName: 'TEXT' },
			},
			(err) => next(err, args),
		);
	});

	pipeRunner(taskList.getList(), {}, (err) => callback(err || ''));
};

// -----
// ensureColumns — idempotent, additive, and never destructive. Reads PRAGMA table_info and ALTERs
// in only the columns a table lacks. Adding a column is the one schema change sqlite does cheaply
// and safely; anything more than adding belongs in a deliberate migration, not here.
const ensureColumns = ({ runSql, getRows }, wanted, callback) => {
	const tableNames = Object.keys(wanted);
	const nextTable = (index) => {
		if (index >= tableNames.length) {
			callback('');
			return;
		}
		const tableName = tableNames[index];
		getRows(`PRAGMA table_info(${tableName});`, (err, rows) => {
			if (err) {
				callback(`ensureColumns ${tableName}: ${err}`);
				return;
			}
			const present = new Set((rows || []).map((oneRow) => oneRow.name));
			const missing = Object.keys(wanted[tableName]).filter((one) => !present.has(one));
			const nextColumn = (columnIndex) => {
				if (columnIndex >= missing.length) {
					nextTable(index + 1);
					return;
				}
				const columnName = missing[columnIndex];
				runSql(
					`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${wanted[tableName][columnName]};`,
					(alterErr) => {
						if (alterErr) {
							callback(`ensureColumns ${tableName}.${columnName}: ${alterErr}`);
							return;
						}
						nextColumn(columnIndex + 1);
					},
				);
			};
			nextColumn(0);
		});
	};
	nextTable(0);
};

// -----
const makeApi = ({ esc, escJson, runSql, getRows, databaseFilePath }) => {
	// -----
	// saveBlock — content-address the text, insert if absent. Idempotent by construction.
	const saveBlock = ({ text, kind, subject, version, requires, producedBy }, callback) => {
		if (typeof text !== 'string' || text.length === 0) {
			callback('standardsDatabase.saveBlock: text is required and must be a non-empty string');
			return;
		}
		if (!KINDS.includes(kind)) {
			callback(
				`standardsDatabase.saveBlock: kind '${kind}' is not one of ${KINDS.join(' | ')}. ` +
					`The block taxonomy is LOCKED (targetArchitectureDesign §2); an unknown kind is a ` +
					`caller bug, not an extension point.`,
			);
			return;
		}

		// HEADER vs KIND. The block says what it is; the caller says what it is being stored under.
		// Until 2026-07-23 nothing reconciled the two, so a block harvested carrying one word could
		// be stored under the other and the store would hold a row whose text contradicts its own
		// kind column — silently, and forever, because the text is content-addressed and immutable.
		// Both values are named because either one may be the mistaken one, and the caller cannot
		// tell which without seeing both.
		const headerBlockType = headerBlockTypeOfText(text);
		if (!headerBlockType) {
			callback(
				`standardsDatabase.saveBlock: the schema block being stored under kind '${kind}' ` +
					`carries no readable header — line 1 is not JSON, or declares no blockType. A ` +
					`block whose kind nothing certifies is a block stored on the caller's word alone.`,
			);
			return;
		}
		if (headerBlockType !== kind) {
			callback(
				`standardsDatabase.saveBlock: the schema block's header says blockType ` +
					`'${headerBlockType}' but it is being stored under kind '${kind}'. One of the two ` +
					`is wrong and the store cannot tell which. The block taxonomy is LOCKED ` +
					`(targetArchitectureDesign §2) and a block's header is the same vocabulary as its ` +
					`kind: ${KINDS.join(' | ')}.`,
			);
			return;
		}

		// SUFFIX vs KIND (implementationPlan_hubPort_072326 §1). The subject carries a role
		// marker (_base / _hub / _rel_) so a block is self-describing by NAME; the kind column is the
		// authority and the two MUST agree. This EXTENDS the header/kind gate above — one more place a
		// block cannot misdescribe itself. A _hub-marked name stored under kind 'standardBase' has an
		// AGREEING header (both standardBase), so only THIS gate can catch it; it was admitted until
		// now (proven — the suffix-gate RED PROOF). Both the marker the NAME carries and the kind it is
		// stored under are named, because either could be the mistake. The suffix↔kind mapping is DATA
		// in lib/vocabulary (SCHEMA_BLOCK_KIND_SUFFIX), consulted here, never a conditional.
		if (!vocabulary.subjectAgreesWithKind(subject, kind)) {
			const requiredMarker = vocabulary.suffixMarkerForKind(kind);
			const carriedKind = vocabulary.kindImpliedBySubject(subject);
			const carriedNote = carriedKind
				? `It carries the '${vocabulary.suffixMarkerForKind(carriedKind)}' role marker of kind ` +
					`'${carriedKind}' instead.`
				: `It carries no recognized role marker.`;
			callback(
				`standardsDatabase.saveBlock: the schema block's subject ` +
					`'${subject}' does not carry the '${requiredMarker}' role marker that kind ` +
					`'${kind}' requires. ${carriedNote} A block's NAME must describe its kind ` +
					`(implementationPlan_hubPort_072326 §1): _base->standardBase, _hub->hub, ` +
					`_rel_->relationship.`,
			);
			return;
		}

		const refId = contentAddress.blockIdForText(text);

		getRows(`SELECT refId FROM blocks WHERE refId=${esc(refId)};`, (err, rows) => {
			if (err) {
				callback(err);
				return;
			}
			if (rows && rows.length > 0) {
				// already present — the same bytes ARE the same block. Not an error, not a rewrite.
				callback('', { refId, alreadyPresent: true });
				return;
			}
			runSql(
				`INSERT INTO blocks (refId, kind, subject, version, requires, text, producedBy)
				 VALUES (${esc(refId)}, ${esc(kind)}, ${esc(subject)}, ${esc(version)},
				         ${escJson(requires)}, ${esc(text)}, ${esc(producedBy)});`,
				(insertErr) => {
					if (insertErr) {
						callback(`standardsDatabase.saveBlock ${refId}: ${insertErr}`);
						return;
					}
					callback('', { refId, alreadyPresent: false });
				},
			);
		});
	};

	// -----
	// getBlock — VERIFY-ON-READ. The store is content-addressed, so the hash of what came back must
	// equal the address it was fetched under. A mismatch is refused loudly and by name: corrupted
	// text flowing into a build as though it were the addressed content is the failure this store
	// exists to make impossible.
	const getBlock = ({ refId }, callback) => {
		if (!refId) {
			callback('standardsDatabase.getBlock: refId is required');
			return;
		}
		getRows(`SELECT * FROM blocks WHERE refId=${esc(refId)};`, (err, rows) => {
			if (err) {
				callback(err);
				return;
			}
			const row = rows && rows[0];
			if (!row) {
				callback('', null); // absence is an answer, not an error; the caller decides
				return;
			}
			const recomputed = contentAddress.blockIdForText(row.text);
			if (recomputed !== row.refId) {
				callback(
					`standardsDatabase.getBlock: content-address verification FAILED for block ` +
						`${row.refId} (kind ${row.kind}, subject ${row.subject}, version ` +
						`${row.version}): the stored text hashes to ${recomputed}. The text is corrupt ` +
						`or tampered. Refusing to return it.`,
				);
				return;
			}
			if (row.requires != null) {
				row.requires = JSON.parse(row.requires);
			}
			callback('', row);
		});
	};

	// -----
	// getBlockMeta — the row WITHOUT the text BLOB, for callers that need what a block IS rather
	// than what it contains. No content-address recompute, because there is no content to check —
	// and no multi-hundred-megabyte read to pay for.
	const getBlockMeta = ({ refId }, callback) => {
		getRows(
			`SELECT refId, kind, subject, version, producedBy, createdAt
			 FROM blocks WHERE refId=${esc(refId)};`,
			(err, rows) => callback(err || '', err ? undefined : (rows && rows[0]) || null),
		);
	};

	// -----
	// saveManifest — the manifest's refId IS the hash of its membership, so composing the same set
	// twice yields the same manifest rather than a second one.
	//
	// The shared addressing rule (contentAddress.manifestKeyForMembership) speaks `blockId`; our
	// members speak `schemaBlockRefId`. The mapping happens HERE, at the boundary, rather than by
	// changing the shared rule — every phase that mints or verifies a manifest address must use the
	// identical function or two manifests with the same members would get different addresses.
	const saveManifest = (
		{ name, description, recipeName, recipeHash, recipeFileName, basedOnManifestRefId, members = [] },
		callback,
	) => {
		const forAddressing = members.map((oneMember) => ({
			blockId: oneMember.schemaBlockRefId,
			position: oneMember.position,
		}));
		const effective = contentAddress.dedupMembersByBlockId(forAddressing);
		const refId = contentAddress.manifestKeyForMembership(effective);

		const badPosition = members.filter(
			(oneMember) =>
				oneMember.position != null && !Number.isFinite(Number(oneMember.position)),
		);
		if (badPosition.length > 0) {
			callback(
				`standardsDatabase.saveManifest: ${badPosition.length} member(s) carry a non-numeric ` +
					`position — first offender ${badPosition[0].schemaBlockRefId} ` +
					`(position ${JSON.stringify(badPosition[0].position)}). Refusing to save.`,
			);
			return;
		}

		const taskList = new taskListPlus();

		taskList.push((args, next) => {
			getRows(`SELECT refId FROM manifests WHERE refId=${esc(refId)};`, (err, rows) =>
				next(err, { ...args, alreadyPresent: !!(rows && rows.length) }),
			);
		});

		taskList.push((args, next) => {
			if (args.alreadyPresent) {
				next('skipRestOfPipe', args);
				return;
			}
			runSql(
				`INSERT INTO manifests
					(refId, name, description, recipeName, recipeHash, recipeFileName, basedOnManifestRefId)
				 VALUES (${esc(refId)}, ${esc(name)}, ${esc(description)}, ${esc(recipeName)},
				         ${esc(recipeHash)}, ${esc(recipeFileName)}, ${esc(basedOnManifestRefId)});`,
				(err) => next(err, args),
			);
		});

		taskList.push((args, next) => {
			const insertNext = (index) => {
				if (index >= members.length) {
					next('', args);
					return;
				}
				const oneMember = members[index];
				runSql(
					`INSERT OR IGNORE INTO manifestBlocks
						(manifestRefId, schemaBlockRefId, position, description)
					 VALUES (${esc(refId)}, ${esc(oneMember.schemaBlockRefId)},
					         ${oneMember.position == null ? 'NULL' : Number(oneMember.position)},
					         ${esc(oneMember.description)});`,
					(err) => {
						if (err) {
							next(err);
							return;
						}
						insertNext(index + 1);
					},
				);
			};
			insertNext(0);
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err && err !== 'skipRestOfPipe') {
				callback(`standardsDatabase.saveManifest ${refId}: ${err}`);
				return;
			}
			callback('', { refId, memberCount: members.length, alreadyPresent: !!args.alreadyPresent });
		});
	};

	// -----
	// getManifest — the manifest row plus its membership, joined to each block's subject and kind
	// so a caller can render it for a human without a second round trip. Ordered by position, then
	// by refId so the order is total even when positions are absent.
	const getManifest = ({ refId }, callback) => {
		if (!refId) {
			callback('standardsDatabase.getManifest: refId is required');
			return;
		}
		getRows(`SELECT * FROM manifests WHERE refId=${esc(refId)};`, (err, rows) => {
			if (err) {
				callback(err);
				return;
			}
			const manifestRow = rows && rows[0];
			if (!manifestRow) {
				callback('', null);
				return;
			}
			getRows(
				`SELECT mb.schemaBlockRefId, mb.position, mb.description,
				        b.kind, b.subject, b.version
				 FROM manifestBlocks mb
				 LEFT JOIN blocks b ON b.refId = mb.schemaBlockRefId
				 WHERE mb.manifestRefId=${esc(refId)}
				 ORDER BY mb.position, mb.schemaBlockRefId;`,
				(memberErr, memberRows) => {
					if (memberErr) {
						callback(memberErr);
						return;
					}
					callback('', { ...manifestRow, members: memberRows || [] });
				},
			);
		});
	};

	return {
		databaseFilePath,
		saveBlock,
		getBlock,
		getBlockMeta,
		saveManifest,
		getManifest,
	};
};

// END OF moduleFunction() ============================================================

// KINDS is deliberately NOT re-exported here. It lives in lib/vocabulary and every consumer reads
// it from there; a second door onto a locked taxonomy is how the taxonomy stops being locked.
module.exports = standardsDatabase;
