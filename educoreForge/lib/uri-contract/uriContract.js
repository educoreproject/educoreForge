'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// uriContract.js — THE ONE READER AND THE ONE WRITER of uriContract.sqlite, the write-once store that holds all and only what
// recreates and resolves every published EDUcore URI (ML3.1 Part B; PROPOSAL-dataStoreLayout-102626 section 3 and Appendix B).
// The tables are DATA (uriContractSchema.json); what may be written and by whom is DATA (uriContractRules.json).
//
//   openUriContractFile({ uriContractFilePath, accessMode, writerActionName }) → { uriContract } | { error }
//       accessMode 'read' (the file must exist; opened read-only), 'publish' (must exist) or 'create' (must NOT exist: only
//       the seed action creates a file). A writing mode names its writerActionName, one of the publish actions.
//   uriContractFor({ database, accessMode, writerActionName }) → the same, over an INJECTED better-sqlite3 handle
//   uriContractReaderFor({ uriContractFilePath }) → { uriContractReader } | { error }   the READ-ONLY reader lane A's stubResolver
//       kind cases are injected with (AMBER_JOURNEY 2026-10-26): exactly schemaBlockFor, decisionSchemaBlockFor and
//       publishedManifestFor, each returning { error } or its result; licence-held text is the resolver's concern
//
//   READERS (every mode)
//     registryShape()                        → { layerRegistry, agentRegistry }   the layers.json / agents.json shape, rebuilt
//     loadRegistry()                         → lib/layer-registry registryFor(...) over registryShape()
//     decisionSchemaBlockTextFor(hash)       → { frozenText } | { error }        frozenText null when absent; VERIFIED
//     decisionSchemaBlockFor(hash)           → { decisionSchemaBlock } | { error }  the row { hash, pairKey, producerKind, frozenText }
//     schemaBlockFor(refId)                  → { schemaBlock } | { error }       schemaBlock null when absent; VERIFIED
//     frozenVectorFor(vectorId)              → { frozenVector } | { error }      the vector-store getVector record shape; VERIFIED
//     publishedManifestFor({ publicLabel } | { manifestRefId }) → { publishedManifest } | { error }   null when absent
//     publishedManifestList()                → [{ manifestRefId, publicLabel, publishedAt }] in publication order
//   WRITERS (publish and create modes only; each is ONE transaction, refused whole or written whole)
//     appendAgent(agent)                                         → { alreadyPresent } | { error }
//     appendLayerVersion({ layer, version, decisionSchemaBlockList }) → { alreadyPresent } | { error }
//     appendLayerStatusChange({ layerKey, statusChange })         → { rowId } | { error }
//     publishManifest({ ... , frozenVectorList, decisionSchemaBlockList }) → { alreadyPresent } | { error }   with exactly the
//                                                                    frozen vectors its members reference by embeddingRef, and the
//                                                                    decision schema blocks their edges cite that uriContract lacks
//
// THE RULES THIS MODULE KEEPS, each a refusal by name:
//   * NO UPDATE, NO DELETE. The module issues neither; the schema adds BEFORE UPDATE / BEFORE DELETE triggers on all nine tables, so
//     raw SQL cannot edit the file either. A status change is a new history row.
//   * IDENTITY ROWS ARE INSERTED ONCE. Re-writing an identical identity row answers alreadyPresent; a different row under
//     the same identity is refused (a published thing never changes).
//   * VERIFY ON READ. Every schema block and decision schema block text is re-hashed when read; a mismatch is refused,
//     naming the row. A manifest's refId is recomputed from its members.
//   * THE TABLES CAN NEVER HOLD A REGISTRY THE REGISTRY REFUSES. A layer version or status change is appended by rebuilding
//     the registry with it and passing the whole through lib/layer-registry registryFor before anything is inserted.
//   * NOTHING IS SILENTLY DROPPED. A layer, version, status change or agent field outside uriContractRules.json's closed
//     lists is refused, so the tables equal the registry they were written from.
// PURE over the injected handle and synchronous (better-sqlite3); attemptSql is the ONE boundary where a library exception
// becomes an error string, as in lib/store-fold.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const layerRegistryLib = require(path.join(__dirname, '..', 'layer-registry', 'layerRegistry'));
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const edcUri = require(path.join(__dirname, '..', 'edc-uri', 'edcUri'));
const contentAddress = require(path.join(__dirname, '..', 'content-address', 'content-address'))();
const derivedIndexesLib = require(path.join(__dirname, 'derivedIndexes'));
const { uriContractRelationsFor } = require(path.join(__dirname, 'uriContractRelations'));

const URI_CONTRACT_SCHEMA = require(path.join(__dirname, 'uriContractSchema.json'));
const URI_CONTRACT_RULES = require(path.join(__dirname, 'uriContractRules.json'));
const { LAYER_REGISTRY_SCHEMA } = layerRegistryLib;
const { DECISION_BLOCK_PRODUCER_KIND_LIST, SCHEMA_BLOCK_KINDS } = vocabularyLib;

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const jsonOrNull = (candidate) => (candidate === undefined ? null : JSON.stringify(candidate));
const parsedOrUndefined = (columnText) => (columnText === null || columnText === undefined ? undefined : JSON.parse(columnText));

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

// ---------------------------------------------------------------------
// THE SCHEMA, from uriContractSchema.json
// ---------------------------------------------------------------------

const TABLE_BY_NAME = URI_CONTRACT_SCHEMA.tableList.reduce((soFar, oneTable) => ({ ...soFar, [oneTable.tableName]: oneTable }), {});
const statusListSql = () => LAYER_REGISTRY_SCHEMA.registrationStatusList.map((oneStatus) => `'${oneStatus.replace(/'/g, "''")}'`).join(', ');

const createTableSqlFor = (oneTable) => {
	const columnSqlList = oneTable.columnList.map((oneColumn) => `${oneColumn.columnName} ${oneColumn.sqlType} ${oneColumn.constraintText.replace('<!registrationStatusList!>', statusListSql())}`.trim());
	return `CREATE TABLE ${oneTable.tableName} (\n\t${columnSqlList.concat(oneTable.tableConstraintList).join(',\n\t')}\n)`;
};
const triggerSqlListFor = (oneTable) =>
	['UPDATE', 'DELETE'].map((operationName) => `CREATE TRIGGER ${oneTable.tableName}No${operationName.charAt(0)}${operationName.slice(1).toLowerCase()} BEFORE ${operationName} ON ${oneTable.tableName} BEGIN SELECT RAISE(ABORT, '${URI_CONTRACT_SCHEMA.writeOnceTriggerMessage} (${oneTable.tableName})'); END`);
const triggerNameListFor = (oneTable) => ['Update', 'Delete'].map((operationWord) => `${oneTable.tableName}No${operationWord}`);

// schemaSqlList() → every statement that makes an empty uriContract, in dependency order
const schemaSqlList = () =>
	URI_CONTRACT_SCHEMA.tableList
		.map(createTableSqlFor)
		.concat(URI_CONTRACT_SCHEMA.indexList)
		.concat(URI_CONTRACT_SCHEMA.tableList.reduce((soFar, oneTable) => soFar.concat(triggerSqlListFor(oneTable)), []));

// schemaRefusal(database) → '' | reason: every table with exactly its columns, every write-once trigger present
const schemaRefusal = (database) => {
	const tableNameList = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((oneRow) => oneRow.name);
	const expectedTableNameList = URI_CONTRACT_SCHEMA.tableList.map((oneTable) => oneTable.tableName);
	const strangerTableList = tableNameList.filter((tableName) => expectedTableNameList.indexOf(tableName) === -1);
	const absentTableList = expectedTableNameList.filter((tableName) => tableNameList.indexOf(tableName) === -1);
	if (strangerTableList.length || absentTableList.length) {
		return `the file's tables are not uriContract's (absent: ${absentTableList.join(', ') || 'none'}; not uriContract's: ${strangerTableList.join(', ') || 'none'})`;
	}
	const columnFault = URI_CONTRACT_SCHEMA.tableList
		.map((oneTable) => {
			const actual = database.prepare(`PRAGMA table_info(${oneTable.tableName})`).all().map((oneColumn) => oneColumn.name).join(',');
			const expected = oneTable.columnList.map((oneColumn) => oneColumn.columnName).join(',');
			return actual === expected ? '' : `table ${oneTable.tableName} has columns [${actual}], uriContractSchema.json says [${expected}]`;
		})
		.find((oneFault) => oneFault !== '');
	if (columnFault !== undefined) {
		return columnFault;
	}
	const triggerNameSet = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((oneRow) => oneRow.name));
	const absentTriggerList = URI_CONTRACT_SCHEMA.tableList.reduce((soFar, oneTable) => soFar.concat(triggerNameListFor(oneTable)), []).filter((triggerName) => !triggerNameSet.has(triggerName));
	return absentTriggerList.length ? `the write-once triggers ${absentTriggerList.join(', ')} are absent (a uriContract without them can be edited)` : '';
};

// ---------------------------------------------------------------------
// ROW <-> REGISTRY SHAPE
// ---------------------------------------------------------------------

const unknownFieldOf = (candidate, fieldList) => Object.keys(candidate).find((fieldName) => fieldList.indexOf(fieldName) === -1);

// fieldListRefusal({ layer, version, statusChange, agent }) → '' | reason: a field outside the closed lists is refused
const closedFieldRefusal = ({ candidate, fieldList, label }) => {
	if (!isPlainObject(candidate)) {
		return `${label} is not an object`;
	}
	const unknownField = unknownFieldOf(candidate, fieldList);
	return unknownField === undefined ? '' : `${label} carries the field '${unknownField}', which uriContract does not store (uriContractRules.json: ${fieldList.join(', ')}); it would be dropped, so it is refused`;
};

const layerVersionRowFor = ({ layer, version }) => ({
	layerKey: layer.layerKey,
	versionTag: version.administrationRecord.versionTag,
	contentId: version.administrationRecord.contentId,
	layerKind: layer.layerKind,
	displayName: layer.displayName,
	layerAuthorAgentIri: layer.authorAgentIri,
	standardListJson: JSON.stringify(layer.standardList),
	hubListJson: JSON.stringify(layer.hubList),
	authorAgentIri: version.authorAgentIri,
	registrationAuthorityIri: version.administrationRecord.registrationAuthority,
	registrarIri: version.administrationRecord.registrar,
	submitterAgentIri: version.administrationRecord.submitter,
	publishedAt: version.administrationRecord.publishedAt,
	contentIdBasis: version.contentIdBasis,
	memberListJson: JSON.stringify(version.memberBlockList),
	wholeSetBlockJson: jsonOrNull(version.wholeSetBlock),
	sssomPath: version.sssomPath === undefined ? null : version.sssomPath,
	importRecordJson: jsonOrNull(version.importRecord),
	copiedFromLayerVersion: version.copiedFromLayerVersion === undefined ? null : version.copiedFromLayerVersion,
	note: version.note === undefined ? null : version.note,
});
const publicationStatusRowFor = ({ layer, version }) => ({
	layerKey: layer.layerKey,
	versionTag: version.administrationRecord.versionTag,
	statusChangeKind: 'atPublication',
	registrationStatus: version.registrationStatus,
	supersededByVersionTag: null,
	scoreListJson: jsonOrNull(version.scoreList),
	changedAt: version.administrationRecord.publishedAt,
	changedByAgentIri: version.administrationRecord.submitter,
	note: null,
});
const appendedStatusRowFor = ({ layerKey, statusChange }) => ({
	layerKey,
	versionTag: statusChange.versionTag,
	statusChangeKind: 'appended',
	registrationStatus: statusChange.registrationStatus,
	supersededByVersionTag: statusChange.supersededByVersionTag === undefined ? null : statusChange.supersededByVersionTag,
	scoreListJson: null,
	changedAt: statusChange.changedAt,
	changedByAgentIri: statusChange.changedBy,
	note: statusChange.note === undefined ? null : statusChange.note,
});
const agentRowFor = (agent) => ({
	agentIri: agent.agentIri,
	agentKind: agent.agentKind,
	displayName: agent.displayName,
	description: agent.description === undefined ? null : agent.description,
	homepageIri: agent.homepageIri === undefined ? null : agent.homepageIri,
	aliasIriListJson: jsonOrNull(agent.aliasIriList),
	judgeConfigurationJson: jsonOrNull(agent.judgeConfiguration),
	note: agent.note === undefined ? null : agent.note,
});

// withOptionalFields(base, [[fieldName, columnValue]]) → base plus each field whose column is not NULL
const withOptionalFields = (base, pairList) => pairList.reduce((soFar, [fieldName, columnValue]) => (columnValue === null || columnValue === undefined ? soFar : { ...soFar, [fieldName]: columnValue }), base);

const versionFromRows = ({ versionRow, publicationRow }) =>
	withOptionalFields(
		{
			administrationRecord: { registrationAuthority: versionRow.registrationAuthorityIri, registrar: versionRow.registrarIri, submitter: versionRow.submitterAgentIri, publishedAt: versionRow.publishedAt, contentId: versionRow.contentId, versionTag: versionRow.versionTag },
			registrationStatus: publicationRow.registrationStatus,
			authorAgentIri: versionRow.authorAgentIri,
			contentIdBasis: versionRow.contentIdBasis,
			memberBlockList: JSON.parse(versionRow.memberListJson),
		},
		[
			['wholeSetBlock', parsedOrUndefined(versionRow.wholeSetBlockJson)],
			['sssomPath', versionRow.sssomPath],
			['importRecord', parsedOrUndefined(versionRow.importRecordJson)],
			['copiedFromLayerVersion', versionRow.copiedFromLayerVersion],
			['scoreList', parsedOrUndefined(publicationRow.scoreListJson)],
			['note', versionRow.note],
		],
	);
const statusChangeFromRow = (statusRow) => withOptionalFields({ versionTag: statusRow.versionTag, registrationStatus: statusRow.registrationStatus, changedAt: statusRow.changedAt, changedBy: statusRow.changedByAgentIri }, [['supersededByVersionTag', statusRow.supersededByVersionTag], ['note', statusRow.note]]);
const agentFromRow = (agentRow) => withOptionalFields({ agentIri: agentRow.agentIri, agentKind: agentRow.agentKind, displayName: agentRow.displayName }, [['description', agentRow.description], ['homepageIri', agentRow.homepageIri], ['aliasIriList', parsedOrUndefined(agentRow.aliasIriListJson)], ['judgeConfiguration', parsedOrUndefined(agentRow.judgeConfigurationJson)], ['note', agentRow.note]]);

// FROZEN VECTORS — the same three checks lib/vector-store getVector makes on every read (W-C-12: grammar 2, or grammar 1 for a
// row minted before campaign P3), applied on the way IN as well as on the way out
const FROZEN_VECTOR_DTYPE = 'float32';
const BYTES_PER_FLOAT = 4;
const frozenVectorRefusal = (row) => {
	if (row.dtype !== FROZEN_VECTOR_DTYPE || !Buffer.isBuffer(row.vector) || row.vector.length !== Number(row.dims) * BYTES_PER_FLOAT) {
		return `structure: dtype ${JSON.stringify(row.dtype)} (expected ${FROZEN_VECTOR_DTYPE}), ${Buffer.isBuffer(row.vector) ? row.vector.length : 'no'} bytes for ${row.dims} dims`;
	}
	const NUL = String.fromCharCode(0);
	if (`${row.modelVersion}`.indexOf(NUL) !== -1 || `${row.inputText}`.indexOf(NUL) !== -1) {
		return 'a stored determinant carries a NUL byte';
	}
	const recomputedId = contentAddress.vectorIdForInput({ modelVersion: row.modelVersion, embeddingDims: Number(row.dims), inputText: row.inputText });
	if (recomputedId !== row.vectorId && contentAddress.versionOneVectorIdForInput(row.modelVersion, row.inputText) !== row.vectorId) {
		return `determinants: (modelVersion, dims, inputText) hash to ${recomputedId}, not the vectorId`;
	}
	return contentAddress.vectorHashForBytes(row.vector) === row.vectorHash ? '' : `payload: the vector bytes hash to ${contentAddress.vectorHashForBytes(row.vector)}, not vectorHash ${row.vectorHash}`;
};
const decodedVectorOf = (vectorBuffer, dims) => Array.from({ length: Number(dims) }, (unused, floatIndex) => vectorBuffer.readFloatLE(floatIndex * BYTES_PER_FLOAT));

// embeddingRefListOf(blockText) → every embeddingRef a schema block's node lines carry (each node line parsed, never pattern-matched)
const embeddingRefListOf = (blockText) =>
	blockText
		.split('\n')
		.filter((oneLine) => oneLine.indexOf('"kind":"node"') !== -1 && oneLine.indexOf('"embeddingRef"') !== -1)
		.map((oneLine) => JSON.parse(oneLine).embeddingRef)
		.filter((embeddingRef) => typeof embeddingRef === 'string' && embeddingRef.length > 0);

// decisionBlockHashListOf(blockText) → every decisionBlockHash a schema block's edge lines carry (each edge line parsed): the decision
// schema blocks a published manifest's assertion URIs resolve through
const decisionBlockHashListOf = (blockText) =>
	blockText
		.split('\n')
		.filter((oneLine) => oneLine.indexOf('"kind":"edge"') !== -1 && oneLine.indexOf('"decisionBlockHash"') !== -1)
		.map((oneLine) => JSON.parse(oneLine).properties.decisionBlockHash)
		.filter((hashValue) => Array.isArray(hashValue) && typeof hashValue[0] === 'string')
		.map((hashValue) => hashValue[0]);

// identityRowsEqual(left, right) → the two rows say the same thing, column for column
const identityRowsEqual = (leftRow, rightRow) => Object.keys(rightRow).every((columnName) => (Buffer.isBuffer(rightRow[columnName]) ? Buffer.isBuffer(leftRow[columnName]) && leftRow[columnName].equals(rightRow[columnName]) : leftRow[columnName] === rightRow[columnName]));

// ---------------------------------------------------------------------
// THE STORE, over an injected handle
// ---------------------------------------------------------------------

const insertSqlFor = (tableName, row) => `INSERT INTO ${tableName} (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map((columnName) => `@${columnName}`).join(', ')})`;

const uriContractFor = ({ database, accessMode, writerActionName } = {}) => {
	const accessRule = URI_CONTRACT_RULES.accessModeByName[accessMode];
	if (!database || accessRule === undefined) {
		return { error: refusalText(`a database handle and an accessMode (${Object.keys(URI_CONTRACT_RULES.accessModeByName).join(', ')}) are required (got ${JSON.stringify(accessMode)})`, 'uriContractFor({ database, accessMode, writerActionName })') };
	}
	if (accessRule.writerActionRequired && URI_CONTRACT_RULES.writerActionNameList.indexOf(writerActionName) === -1) {
		return { error: refusalText(`accessMode '${accessMode}' is for the publish actions only (${URI_CONTRACT_RULES.writerActionNameList.join(', ')}); got writerActionName ${JSON.stringify(writerActionName)}`, 'uriContractRules.json writerActionNameList: nothing else writes the forever store') };
	}
	if (accessMode === 'create' && URI_CONTRACT_RULES.createActionNameList.indexOf(writerActionName) === -1) {
		return { error: refusalText(`'${writerActionName}' may not create a uriContract`, `uriContractRules.json createActionNameList (${URI_CONTRACT_RULES.createActionNameList.join(', ')})`) };
	}
	if (accessMode === 'create') {
		const created = attemptSql(() => database.transaction(() => schemaSqlList().forEach((oneStatement) => database.exec(oneStatement)))());
		if (created.error) {
			return { error: refusalText(`creating the schema: ${created.error}`, 'uriContractSchema.json') };
		}
	}
	const foreignKeys = attemptSql(() => database.pragma('foreign_keys = ON'));
	if (foreignKeys.error || database.pragma('foreign_keys', { simple: true }) !== 1) {
		return { error: refusalText('the connection does not enforce FOREIGN KEYs', 'PRAGMA foreign_keys = ON is required on every uriContract connection') };
	}
	const schemaFault = schemaRefusal(database);
	if (schemaFault) {
		return { error: refusalText(schemaFault, 'a uriContract is created only by -seedUriContractFromRegistryJson, from uriContractSchema.json; nothing here converts or repairs a file') };
	}

	// ----- READERS
	const registryShape = () => {
		const agentList = database.prepare('SELECT * FROM agents ORDER BY rowid').all().map(agentFromRow);
		const versionRowList = database.prepare('SELECT * FROM layerVersions ORDER BY rowid').all();
		const statusRowList = database.prepare('SELECT * FROM layerStatusChanges ORDER BY rowId').all();
		const publicationRowByVersion = statusRowList.filter((oneRow) => oneRow.statusChangeKind === 'atPublication').reduce((soFar, oneRow) => ({ ...soFar, [`${oneRow.layerKey}\u0000${oneRow.versionTag}`]: oneRow }), {});
		const layerKeyOrderList = [];
		const versionRowListByLayerKey = {};
		versionRowList.forEach((oneRow) => {
			if (versionRowListByLayerKey[oneRow.layerKey] === undefined) {
				versionRowListByLayerKey[oneRow.layerKey] = [];
				layerKeyOrderList.push(oneRow.layerKey);
			}
			versionRowListByLayerKey[oneRow.layerKey].push(oneRow);
		});
		const layerList = layerKeyOrderList.map((layerKey) => {
			const layerVersionRowList = versionRowListByLayerKey[layerKey];
			const latestRow = layerVersionRowList[layerVersionRowList.length - 1];
			return {
				layerKey,
				displayName: latestRow.displayName,
				layerKind: latestRow.layerKind,
				authorAgentIri: latestRow.layerAuthorAgentIri,
				standardList: JSON.parse(latestRow.standardListJson),
				hubList: JSON.parse(latestRow.hubListJson),
				versionList: layerVersionRowList.map((versionRow) => versionFromRows({ versionRow, publicationRow: publicationRowByVersion[`${layerKey}\u0000${versionRow.versionTag}`] })),
				statusChangeList: statusRowList.filter((oneRow) => oneRow.layerKey === layerKey && oneRow.statusChangeKind === 'appended').map(statusChangeFromRow),
			};
		});
		return { layerRegistry: { registrationAuthorityIri: URI_CONTRACT_RULES.registrationAuthorityIri, registrarIri: URI_CONTRACT_RULES.registrarIri, layerList }, agentRegistry: { agentList } };
	};
	const loadRegistry = () => layerRegistryLib.registryFor(registryShape());

	const decisionSchemaBlockTextFor = (decisionSchemaBlockHash) => {
		const row = database.prepare('SELECT frozenText FROM decisionSchemaBlocks WHERE decisionSchemaBlockHash = ?').get(decisionSchemaBlockHash);
		if (row === undefined) {
			return { frozenText: null };
		}
		return sha256Hex(row.frozenText) === decisionSchemaBlockHash ? { frozenText: row.frozenText } : { error: refusalText(`decision schema block ${decisionSchemaBlockHash} fails verify-on-read (its text hashes to ${sha256Hex(row.frozenText)})`, 'a corrupted row is a defect to report; this file is never repaired') };
	};
	// decisionSchemaBlockFor — the whole row (lane A's uriContractReader interface, AMBER_JOURNEY 2026-10-26), verified
	const decisionSchemaBlockFor = (decisionSchemaBlockHash) => {
		const row = database.prepare('SELECT decisionSchemaBlockHash, pairKey, producerKind FROM decisionSchemaBlocks WHERE decisionSchemaBlockHash = ?').get(decisionSchemaBlockHash);
		if (row === undefined) {
			return { decisionSchemaBlock: null };
		}
		const read = decisionSchemaBlockTextFor(decisionSchemaBlockHash);
		return read.error ? read : { decisionSchemaBlock: { ...row, frozenText: read.frozenText } };
	};
	const schemaBlockFor = (refId) => {
		const row = database.prepare('SELECT * FROM schemaBlocks WHERE refId = ?').get(refId);
		if (row === undefined) {
			return { schemaBlock: null };
		}
		return sha256Hex(row.text) === refId ? { schemaBlock: { ...row, requires: row.requiresJson === null ? null : JSON.parse(row.requiresJson) } } : { error: refusalText(`schema block ${refId} fails verify-on-read (its text hashes to ${sha256Hex(row.text)})`, 'a corrupted row is a defect to report; this file is never repaired') };
	};
	// frozenVectorFor — the record lib/vector-store getVector returns, verified as getVector verifies (structure, determinants, payload)
	const frozenVectorFor = (vectorId) => {
		const row = database.prepare('SELECT * FROM frozenVectors WHERE vectorId = ?').get(vectorId);
		if (row === undefined) {
			return { frozenVector: null };
		}
		const fault = frozenVectorRefusal(row);
		return fault ? { error: refusalText(`frozen vector ${vectorId} fails verify-on-read: ${fault}`, 'a corrupted row is a defect to report; this file is never repaired') } : { frozenVector: { vectorId: row.vectorId, modelVersion: row.modelVersion, dims: row.dims, dtype: row.dtype, inputText: row.inputText, vector: decodedVectorOf(row.vector, row.dims), vectorHash: row.vectorHash } };
	};
	const publishedManifestFor = ({ publicLabel, manifestRefId } = {}) => {
		const row = isNonEmptyString(manifestRefId) ? database.prepare('SELECT * FROM publishedManifests WHERE manifestRefId = ?').get(manifestRefId) : database.prepare('SELECT * FROM publishedManifests WHERE publicLabel = ?').get(publicLabel);
		if (row === undefined) {
			return { publishedManifest: null };
		}
		const memberList = database.prepare('SELECT position, schemaBlockRefId, memberDescription, producedByRecipeName FROM publishedManifestMembers WHERE manifestRefId = ? ORDER BY position').all(row.manifestRefId);
		const recomputedRefId = contentAddress.manifestKeyForMembership(memberList.map((oneMember) => ({ blockId: oneMember.schemaBlockRefId, position: oneMember.position })));
		if (recomputedRefId !== row.manifestRefId) {
			return { error: refusalText(`published manifest ${row.manifestRefId} fails verify-on-read (its members hash to ${recomputedRefId})`, 'a corrupted row is a defect to report; this file is never repaired') };
		}
		const statusChangeList = database.prepare('SELECT * FROM manifestStatusChanges WHERE manifestRefId = ? ORDER BY rowId').all(row.manifestRefId);
		return { publishedManifest: { ...row, defaultLayerByHub: row.defaultLayerByHubJson === null ? null : JSON.parse(row.defaultLayerByHubJson), manifestRecord: JSON.parse(row.manifestRecordJson), ancestorRecordList: JSON.parse(row.ancestorRecordListJson), memberList, statusChangeList, effectiveRegistrationStatus: statusChangeList[statusChangeList.length - 1].registrationStatus } };
	};
	// ⟪TQ ruling Q3⟫ agentRecordFor — the agent's PROFILE (its row) plus a RECORD computed, never stored: every layer version in which
	// it holds a role, that version's effective status and its assertion and abstention counts (summed from derivedLayerVersionCounts,
	// standard scope: the version's own member blocks, counted once at publish and verified by -rebuildUriContractIndexes), the scores
	// recorded with its versions, and its first and last contribution dates
	const countsForVersion = (layerKey, versionTag) => database.prepare("SELECT COALESCE(SUM(mappedCount), 0) AS assertionCount, COALESCE(SUM(abstainedCount), 0) AS abstentionCount, COUNT(*) AS scopeRowCount FROM derivedLayerVersionCounts WHERE layerKey = ? AND versionTag = ? AND countScope = 'standard'").get(layerKey, versionTag);
	const agentRecordFor = (agentIri) => {
		const agentRow = database.prepare('SELECT * FROM agents WHERE agentIri = ?').get(agentIri);
		if (agentRow === undefined) {
			return { agentRecord: null };
		}
		const loaded = loadRegistry();
		if (loaded.error) {
			return loaded;
		}
		const { layerRegistry } = loaded.registry;
		const layersAuthored = [];
		const scores = [];
		const contributionDateList = [];
		for (let layerIndex = 0; layerIndex < layerRegistry.layerList.length; layerIndex++) {
			const oneLayer = layerRegistry.layerList[layerIndex];
			const versionList = [];
			for (let versionIndex = 0; versionIndex < oneLayer.versionList.length; versionIndex++) {
				const oneVersion = oneLayer.versionList[versionIndex];
				const record = oneVersion.administrationRecord;
				const roleList = [['layerAuthor', oneLayer.authorAgentIri], ['versionAuthor', oneVersion.authorAgentIri], ['submitter', record.submitter], ['registrationAuthority', record.registrationAuthority], ['registrar', record.registrar]].filter(([, roleAgentIri]) => roleAgentIri === agentIri).map(([roleName]) => roleName);
				if (roleList.length === 0) {
					continue;
				}
				const counted = countsForVersion(oneLayer.layerKey, record.versionTag);
				if (counted.scopeRowCount === 0) {
					return { error: refusalText(`layer '${oneLayer.layerKey}' version '${record.versionTag}' has no derived counts`, 'graphBuilder -rebuildUriContractIndexes fills a source never indexed') };
				}
				const layerVersionUri = edcUri.mint({ kind: 'layerVersion', layerKey: oneLayer.layerKey, versionTag: record.versionTag }).uri;
				versionList.push({ versionTag: record.versionTag, layerVersionUri, contentId: record.contentId, publishedAt: record.publishedAt, effectiveRegistrationStatus: loaded.registry.effectiveStatusFor({ layerKey: oneLayer.layerKey, versionTag: record.versionTag }).registrationStatus, roleList, assertionCount: counted.assertionCount, abstentionCount: counted.abstentionCount });
				(oneVersion.scoreList || []).forEach((oneScore) => scores.push({ layerVersionUri, ...oneScore }));
				contributionDateList.push(record.publishedAt);
			}
			oneLayer.statusChangeList.filter((oneChange) => oneChange.changedBy === agentIri).forEach((oneChange) => contributionDateList.push(oneChange.changedAt));
			if (versionList.length) {
				layersAuthored.push({ layerKey: oneLayer.layerKey, layerUri: edcUri.mint({ kind: 'layer', layerKey: oneLayer.layerKey }).uri, layerKind: oneLayer.layerKind, displayName: oneLayer.displayName, versionList });
			}
		}
		const sortedDateList = contributionDateList.slice().sort();
		return { agentRecord: { profile: agentFromRow(agentRow), layersAuthored, scores, firstContributionAt: sortedDateList.length ? sortedDateList[0] : null, lastContributionAt: sortedDateList.length ? sortedDateList[sortedDateList.length - 1] : null, recordNote: 'computed from layerVersions and layerStatusChanges at resolution; never stored' } };
	};
	const publishedManifestList = () => database.prepare('SELECT manifestRefId, publicLabel, publishedAt FROM publishedManifests ORDER BY rowid').all();

	// ⟪derived tables⟫ derivedComparisonFor — every identity source's derived rows RECOMPUTED and compared with the stored ones, column for
	// column, in a canonical order. absentSourceList = sources never indexed (only the writer may fill them); differenceList = a stored
	// row set that is not what its source yields (a defect: nothing here changes or removes a row)
	const DERIVED_COLUMN_LIST_BY_TABLE = URI_CONTRACT_SCHEMA.tableList.filter((oneTable) => oneTable.rowRole === 'derived').reduce((soFar, oneTable) => ({ ...soFar, [oneTable.tableName]: oneTable.columnList.map((oneColumn) => oneColumn.columnName) }), {});
	const canonicalRowListText = (tableName, rowList) => rowList.map((oneRow) => JSON.stringify(DERIVED_COLUMN_LIST_BY_TABLE[tableName].map((columnName) => (oneRow[columnName] === undefined ? null : oneRow[columnName])))).sort().join('\n');
	const derivedSourceList = () => {
		const loaded = loadRegistry();
		const versionSourceList = loaded.error ? [] : loaded.registry.layerRegistry.layerList.reduce((soFar, oneLayer) => soFar.concat(oneLayer.versionList.map((oneVersion) => ({ sourceKind: 'layerVersion', sourceIdentity: `${oneLayer.layerKey}\u0000${oneVersion.administrationRecord.versionTag}`, layer: oneLayer, version: oneVersion }))), []);
		return { error: loaded.error, sourceList: database.prepare('SELECT refId FROM schemaBlocks ORDER BY rowid').all().map((oneRow) => ({ sourceKind: 'schemaBlock', sourceIdentity: oneRow.refId })).concat(versionSourceList) };
	};
	const computedDerivedRowsFor = (oneSource) => {
		if (oneSource.sourceKind === 'schemaBlock') {
			const read = schemaBlockFor(oneSource.sourceIdentity);
			if (read.error) {
				return read;
			}
			const derived = derivedIndexesLib.derivedRowsForSchemaBlock(read.schemaBlock);
			return derived.error ? derived : { rowListByTable: { derivedElementIndex: derived.elementRowList, derivedHubCards: derived.hubCardRowList, derivedAnswerEdges: derived.answerEdgeRowList } };
		}
		const derived = derivedIndexesLib.derivedRowsForLayerVersion({ layer: oneSource.layer, version: oneSource.version, blockTextFor: decisionSchemaBlockTextFor });
		return derived.error ? derived : { rowListByTable: { derivedLayerVersionCounts: derived.countRowList } };
	};
	const storedDerivedRowsFor = (oneSource, tableName) =>
		oneSource.sourceKind === 'schemaBlock'
			? database.prepare(`SELECT * FROM ${tableName} WHERE schemaBlockRefId = ?`).all(oneSource.sourceIdentity)
			: database.prepare(`SELECT * FROM ${tableName} WHERE layerKey = ? AND versionTag = ?`).all(oneSource.layer.layerKey, oneSource.version.administrationRecord.versionTag);
	const derivedComparisonFor = () => {
		const listed = derivedSourceList();
		if (listed.error) {
			return { error: listed.error };
		}
		const absentSourceList = [];
		const differenceList = [];
		let verifiedSourceCount = 0;
		for (let sourceIndex = 0; sourceIndex < listed.sourceList.length; sourceIndex++) {
			const oneSource = listed.sourceList[sourceIndex];
			const computed = computedDerivedRowsFor(oneSource);
			if (computed.error) {
				return { error: computed.error };
			}
			const indexedRow = database.prepare('SELECT derivedRowCount FROM derivedIndexedSources WHERE sourceKind = ? AND sourceIdentity = ?').get(oneSource.sourceKind, oneSource.sourceIdentity);
			const computedRowCount = Object.keys(computed.rowListByTable).reduce((soFar, tableName) => soFar + computed.rowListByTable[tableName].length, 0);
			if (indexedRow === undefined) {
				absentSourceList.push({ ...oneSource, rowListByTable: computed.rowListByTable, computedRowCount });
				continue;
			}
			const differingTable = Object.keys(computed.rowListByTable).find((tableName) => canonicalRowListText(tableName, storedDerivedRowsFor(oneSource, tableName)) !== canonicalRowListText(tableName, computed.rowListByTable[tableName]));
			if (differingTable !== undefined || indexedRow.derivedRowCount !== computedRowCount) {
				differenceList.push(`${oneSource.sourceKind} ${oneSource.sourceIdentity.replace('\u0000', '/')}: ${differingTable !== undefined ? `${differingTable} rows differ from a recomputation` : `derivedRowCount ${indexedRow.derivedRowCount}, recomputed ${computedRowCount}`}`);
			}
			verifiedSourceCount += 1;
		}
		return { verifiedSourceCount, absentSourceList, differenceList };
	};
	const verifyDerivedIndexes = () => {
		const compared = derivedComparisonFor();
		return compared.error ? compared : { verifiedSourceCount: compared.verifiedSourceCount, absentSourceCount: compared.absentSourceList.length, differenceList: compared.differenceList };
	};

	const coreReaderApi = { accessMode, registryShape, loadRegistry, verifyDerivedIndexes, decisionSchemaBlockTextFor, decisionSchemaBlockFor, schemaBlockFor, frozenVectorFor, agentRecordFor, publishedManifestFor, publishedManifestList, close: () => database.close() };
	const readerApi = { ...coreReaderApi, relations: uriContractRelationsFor({ database, uriContract: coreReaderApi }) };
	if (accessMode === 'read') {
		return { uriContract: readerApi };
	}

	// ----- WRITERS (publish, create)
	// insertIdentityRow({ tableName, row, identityWhereSql, identityValueList }) → { alreadyPresent } | { error }, inside a transaction
	const insertIdentityRow = ({ tableName, row, identityWhereSql, identityValueList }) => {
		const existingRow = database.prepare(`SELECT ${Object.keys(row).join(', ')} FROM ${tableName} WHERE ${identityWhereSql}`).get(...identityValueList);
		if (existingRow !== undefined) {
			return identityRowsEqual(existingRow, row) ? { alreadyPresent: true } : { error: refusalText(`${tableName} already holds ${identityValueList.join(' / ')} with different content`, 'a published identity row is written once and never changed') };
		}
		database.prepare(insertSqlFor(tableName, row)).run(row);
		return { alreadyPresent: false };
	};
	// runWriteTransaction(work) → work's { ... } | { error }: ONE explicit transaction (BEGIN IMMEDIATE ... COMMIT); a refusal from work,
	// or a library fault inside it, is answered by ROLLBACK (lib/store-fold's shape: explicit statements, no throw to roll back)
	const runWriteTransaction = (work) => {
		const begun = attemptSql(() => database.exec('BEGIN IMMEDIATE'));
		if (begun.error) {
			return { error: refusalText(`opening the write transaction: ${begun.error}`, 'uriContract writes are one transaction each') };
		}
		const worked = attemptSql(work);
		const outcome = worked.error ? { error: refusalText(`the write was rolled back: ${worked.error}`, 'uriContract writes are one transaction each') } : worked.result;
		const finished = attemptSql(() => database.exec(outcome.error ? 'ROLLBACK' : 'COMMIT'));
		if (finished.error) {
			return { error: refusalText(`${outcome.error ? 'rolling back' : 'committing'}: ${finished.error}${outcome.error ? ` (after: ${outcome.error})` : ''}`, 'uriContract writes are one transaction each') };
		}
		return outcome;
	};

	// ----- DERIVED ROWS, written inside the transaction that writes their source (derivedIndexes.js; README_AI "derived tables")
	const isIndexed = (sourceKind, sourceIdentity) => database.prepare('SELECT derivedRowCount FROM derivedIndexedSources WHERE sourceKind = ? AND sourceIdentity = ?').get(sourceKind, sourceIdentity) !== undefined;
	const insertDerivedRows = (tableName, rowList) => {
		if (rowList.length === 0) {
			return;
		}
		const statement = database.prepare(insertSqlFor(tableName, rowList[0]));
		rowList.forEach((oneRow) => statement.run(oneRow));
	};
	const writeDerivedRowsForSchemaBlock = (schemaBlock) => {
		if (isIndexed('schemaBlock', schemaBlock.refId)) {
			return { alreadyPresent: true };
		}
		const derived = derivedIndexesLib.derivedRowsForSchemaBlock(schemaBlock);
		if (derived.error) {
			return derived;
		}
		insertDerivedRows('derivedElementIndex', derived.elementRowList);
		insertDerivedRows('derivedHubCards', derived.hubCardRowList);
		insertDerivedRows('derivedAnswerEdges', derived.answerEdgeRowList);
		insertDerivedRows('derivedIndexedSources', [{ sourceKind: 'schemaBlock', sourceIdentity: schemaBlock.refId, derivedRowCount: derived.elementRowList.length + derived.hubCardRowList.length + derived.answerEdgeRowList.length }]);
		return { alreadyPresent: false };
	};
	const writeDerivedRowsForLayerVersion = ({ layer, version }) => {
		const sourceIdentity = `${layer.layerKey}\u0000${version.administrationRecord.versionTag}`;
		if (isIndexed('layerVersion', sourceIdentity)) {
			return { alreadyPresent: true };
		}
		const derived = derivedIndexesLib.derivedRowsForLayerVersion({ layer, version, blockTextFor: decisionSchemaBlockTextFor });
		if (derived.error) {
			return derived;
		}
		insertDerivedRows('derivedLayerVersionCounts', derived.countRowList);
		insertDerivedRows('derivedIndexedSources', [{ sourceKind: 'layerVersion', sourceIdentity, derivedRowCount: derived.countRowList.length }]);
		return { alreadyPresent: false };
	};

	const agentRefusalFor = (agent) => {
		const label = `agent ${JSON.stringify(agent && agent.agentIri)}`;
		const kindFieldList = isPlainObject(agent) ? URI_CONTRACT_RULES.agentFieldListByKind[agent.agentKind] : undefined;
		if (!Array.isArray(kindFieldList)) {
			return `${label} has agentKind ${JSON.stringify(agent && agent.agentKind)}, which is not one of ${Object.keys(URI_CONTRACT_RULES.agentFieldListByKind).filter((kindName) => kindName !== 'about').join(', ')}`;
		}
		const fieldFault = closedFieldRefusal({ candidate: agent, fieldList: kindFieldList, label: `${label} (a ${agent.agentKind})` });
		if (fieldFault) {
			return fieldFault;
		}
		const aliasFault = agent.aliasIriList !== undefined && (!Array.isArray(agent.aliasIriList) || !agent.aliasIriList.every(isNonEmptyString));
		const emailField = agent.agentKind === 'person' ? ['displayName', 'description', 'note'].find((fieldName) => typeof agent[fieldName] === 'string' && new RegExp(URI_CONTRACT_RULES.personTextRefusalPattern).test(agent[fieldName])) : undefined;
		return aliasFault ? `${label}: aliasIriList is a list of IRIs` : emailField !== undefined ? `${label}: a person's ${emailField} carries an e-mail address; persons are pseudonymous (a role and aliases, never a name or an e-mail)` : '';
	};
	const appendAgent = (agent) => {
		const fieldFault = agentRefusalFor(agent);
		if (fieldFault) {
			return { error: refusalText(fieldFault, 'appendAgent') };
		}
		const { agentRegistry, layerRegistry } = registryShape();
		const alreadyListed = agentRegistry.agentList.some((oneAgent) => oneAgent.agentIri === agent.agentIri);
		const checked = layerRegistryLib.registryFor({ layerRegistry, agentRegistry: { agentList: alreadyListed ? agentRegistry.agentList : agentRegistry.agentList.concat([agent]) } });
		if (checked.error) {
			return { error: checked.error };
		}
		return runWriteTransaction(() => insertIdentityRow({ tableName: 'agents', row: agentRowFor(agent), identityWhereSql: 'agentIri = ?', identityValueList: [agent.agentIri] }));
	};

	// appendDecisionSchemaBlockRow — inside a transaction; the hash is COMPUTED here, never taken on trust
	const appendDecisionSchemaBlockRow = ({ pairKey, producerKind, frozenText }) => {
		if (!isNonEmptyString(pairKey) || !isNonEmptyString(frozenText) || DECISION_BLOCK_PRODUCER_KIND_LIST.indexOf(producerKind) === -1) {
			return { error: refusalText(`a decision schema block needs a pairKey, its frozenText and a producerKind in ${DECISION_BLOCK_PRODUCER_KIND_LIST.join(', ')} (got ${JSON.stringify(pairKey)}, ${JSON.stringify(producerKind)})`, 'appendLayerVersion decisionSchemaBlockList') };
		}
		// THE BYTES ARE THE IDENTITY, the pairKey is not: one frozen text can be a version's whole set AND its only pair block (a
		// single-pair curated set splits into a block byte-identical to the set), so a held hash is alreadyPresent whatever pairKey it
		// was first written under. The row keeps that FIRST pairKey; a version's own memberListJson names the pairKeys it uses.
		// (lib/decision-store keys the same way: decisionBlockHash UNIQUE, an identical re-save a no-op.)
		const decisionSchemaBlockHash = sha256Hex(frozenText);
		if (database.prepare('SELECT decisionSchemaBlockHash FROM decisionSchemaBlocks WHERE decisionSchemaBlockHash = ?').get(decisionSchemaBlockHash) !== undefined) {
			return { alreadyPresent: true };
		}
		database.prepare(insertSqlFor('decisionSchemaBlocks', { decisionSchemaBlockHash, pairKey, producerKind, frozenText })).run({ decisionSchemaBlockHash, pairKey, producerKind, frozenText });
		return { alreadyPresent: false };
	};

	// appendLayerVersion — the version, its decision schema blocks and its publication-status row, in ONE transaction. The layer
	// is the registry's layer entry (its versionList and statusChangeList are not read: the tables are the record of those).
	const appendLayerVersion = ({ layer, version, decisionSchemaBlockList } = {}) => {
		const layerFault = closedFieldRefusal({ candidate: layer, fieldList: URI_CONTRACT_RULES.layerFieldList, label: 'the layer' }) || closedFieldRefusal({ candidate: version, fieldList: URI_CONTRACT_RULES.versionFieldList, label: `layer ${JSON.stringify(layer && layer.layerKey)}'s version` });
		if (layerFault) {
			return { error: refusalText(layerFault, 'appendLayerVersion') };
		}
		if (!Array.isArray(decisionSchemaBlockList)) {
			return { error: refusalText('decisionSchemaBlockList is required (an empty list is stated, never assumed)', 'appendLayerVersion({ layer, version, decisionSchemaBlockList })') };
		}
		const { layerRegistry, agentRegistry } = registryShape();
		const storedLayer = layerRegistry.layerList.find((oneLayer) => oneLayer.layerKey === layer.layerKey);
		const versionTag = isPlainObject(version.administrationRecord) ? version.administrationRecord.versionTag : undefined;
		const storedVersion = storedLayer === undefined ? undefined : storedLayer.versionList.find((oneVersion) => oneVersion.administrationRecord.versionTag === versionTag);
		const candidateLayer = { ...layer, versionList: (storedLayer === undefined ? [] : storedLayer.versionList).concat(storedVersion === undefined ? [version] : []), statusChangeList: storedLayer === undefined ? [] : storedLayer.statusChangeList };
		const candidateRegistry = { ...layerRegistry, layerList: storedLayer === undefined ? layerRegistry.layerList.concat([candidateLayer]) : layerRegistry.layerList.map((oneLayer) => (oneLayer.layerKey === layer.layerKey ? candidateLayer : oneLayer)) };
		const checked = layerRegistryLib.registryFor({ layerRegistry: candidateRegistry, agentRegistry });
		if (checked.error) {
			return { error: checked.error };
		}
		const offeredHashSet = new Set(decisionSchemaBlockList.map((oneBlock) => (isNonEmptyString(oneBlock.frozenText) ? sha256Hex(oneBlock.frozenText) : '')));
		const neededHashList = version.memberBlockList.map((oneMember) => oneMember.decisionBlockHash).concat(version.wholeSetBlock === undefined ? [] : [version.wholeSetBlock.decisionBlockHash]);
		const unheldHash = neededHashList.find((oneHash) => !offeredHashSet.has(oneHash) && decisionSchemaBlockTextFor(oneHash).frozenText === null);
		if (unheldHash !== undefined) {
			return { error: refusalText(`layer '${layer.layerKey}' version '${versionTag}' names decision schema block ${unheldHash}, which is neither offered nor held`, 'every block a published layer version is made of is copied into uriContract with it (PROPOSAL section 3: "all of")') };
		}
		return runWriteTransaction(() => {
			const blockOutcome = decisionSchemaBlockList.map(appendDecisionSchemaBlockRow).find((oneOutcome) => oneOutcome.error);
			if (blockOutcome !== undefined) {
				return blockOutcome;
			}
			const versionOutcome = insertIdentityRow({ tableName: 'layerVersions', row: layerVersionRowFor({ layer, version }), identityWhereSql: 'layerKey = ? AND versionTag = ?', identityValueList: [layer.layerKey, versionTag] });
			if (versionOutcome.error || versionOutcome.alreadyPresent) {
				return versionOutcome;
			}
			database.prepare(insertSqlFor('layerStatusChanges', publicationStatusRowFor({ layer, version }))).run(publicationStatusRowFor({ layer, version }));
			const derivedOutcome = writeDerivedRowsForLayerVersion({ layer, version });
			return derivedOutcome.error ? derivedOutcome : { alreadyPresent: false };
		});
	};

	const appendLayerStatusChange = ({ layerKey, statusChange } = {}) => {
		const fieldFault = closedFieldRefusal({ candidate: statusChange, fieldList: URI_CONTRACT_RULES.statusChangeFieldList, label: `layer ${JSON.stringify(layerKey)}'s status change` });
		if (fieldFault) {
			return { error: refusalText(fieldFault, 'appendLayerStatusChange') };
		}
		const loaded = loadRegistry();
		if (loaded.error) {
			return loaded;
		}
		const appended = loaded.registry.withAppendedStatusChange({ layerKey, statusChange });
		if (appended.error) {
			return appended;
		}
		return runWriteTransaction(() => {
			const statusRow = appendedStatusRowFor({ layerKey, statusChange });
			return { rowId: Number(database.prepare(insertSqlFor('layerStatusChanges', statusRow)).run(statusRow).lastInsertRowid) };
		});
	};

	// publishManifest — the identity row, its members in order, every member schema block (the closure: a member's requires
	// must be members too), and the first status row, in ONE transaction. Re-publishing the same manifest under the same label
	// answers alreadyPresent and writes nothing; a second label for one manifest, or one label for two, is refused.
	const publishManifest = ({ manifestRefId, publicLabel, memberList, frozenVectorList, decisionSchemaBlockList, manifestRecord, ancestorRecordList, defaultLayerByHub, basedOnManifestRefId, recordedNodeCount, recordedEdgeCount, publishedAt, publishedByAgentIri, registrationStatus, registrationAuthority, note } = {}) => {
		if (!isNonEmptyString(publicLabel) || !new RegExp(URI_CONTRACT_RULES.publicLabelPattern).test(publicLabel) || URI_CONTRACT_RULES.reservedPublicLabelList.indexOf(publicLabel) !== -1) {
			return { error: refusalText(`publicLabel ${JSON.stringify(publicLabel)} must match ${URI_CONTRACT_RULES.publicLabelPattern} and is never a reserved word (${URI_CONTRACT_RULES.reservedPublicLabelList.join(', ')})`, 'uriContractRules.json; the label is TQ\'s to choose') };
		}
		if (LAYER_REGISTRY_SCHEMA.registrationStatusList.indexOf(registrationStatus) === -1) {
			return { error: refusalText(`registrationStatus ${JSON.stringify(registrationStatus)} is not an ISO/IEC 11179-6 lifecycle status (${LAYER_REGISTRY_SCHEMA.registrationStatusList.join(', ')})`, 'publishManifest names the status it is published with; there is no default') };
		}
		if (!Array.isArray(memberList) || memberList.length === 0 || !(defaultLayerByHub === null || isPlainObject(defaultLayerByHub)) || !Number.isInteger(recordedNodeCount) || !Number.isInteger(recordedEdgeCount) || !new RegExp(LAYER_REGISTRY_SCHEMA.publishedAtPattern).test(String(publishedAt))) {
			return { error: refusalText('memberList (non-empty), defaultLayerByHub (null, or an object naming the producer that answers a conflicted pair), whole-number recordedNodeCount and recordedEdgeCount, and an ISO UTC publishedAt are required', 'publishManifest({ ... }); nothing here is defaulted') };
		}
		// the store metadata the graph's recipe subgraph is generated from (manifest-recipe-finisher): this manifest's row and its
		// basedOn ancestors' rows, copied as the support store holds them
		const recordFault = [['manifestRecord', manifestRecord]].concat((Array.isArray(ancestorRecordList) ? ancestorRecordList : [null]).map((oneRecord) => ['an ancestor record', oneRecord])).find(([, oneRecord]) => !isPlainObject(oneRecord) || unknownFieldOf(oneRecord, URI_CONTRACT_RULES.manifestRecordFieldList) !== undefined);
		if (recordFault !== undefined) {
			return { error: refusalText(`${recordFault[0]} must be an object carrying only ${URI_CONTRACT_RULES.manifestRecordFieldList.join(', ')} (and ancestorRecordList a list)`, 'publishManifest copies the manifest metadata the recipe subgraph is generated from') };
		}
		const agentIriSet = new Set(registryShape().agentRegistry.agentList.map((oneAgent) => oneAgent.agentIri));
		const unknownAgent = [publishedByAgentIri, registrationAuthority].find((agentIri) => !agentIriSet.has(agentIri));
		if (unknownAgent !== undefined) {
			return { error: refusalText(`agent ${JSON.stringify(unknownAgent)} is not in uriContract's agents`, 'an agent is appended before it publishes') };
		}
		const recomputedRefId = contentAddress.manifestKeyForMembership(memberList.map((oneMember) => ({ blockId: oneMember.schemaBlock.refId, position: oneMember.position })));
		if (recomputedRefId !== manifestRefId) {
			return { error: refusalText(`manifest ${manifestRefId}: its members hash to ${recomputedRefId}`, 'lib/content-address manifestKeyForMembership is the manifest\'s identity') };
		}
		const memberRefIdSet = new Set(memberList.map((oneMember) => oneMember.schemaBlock.refId));
		const blockFault = memberList
			.map(({ schemaBlock }) => {
				if (!isPlainObject(schemaBlock) || !isNonEmptyString(schemaBlock.text) || sha256Hex(schemaBlock.text) !== schemaBlock.refId) {
					return `member ${schemaBlock && schemaBlock.refId}: its text does not hash to its refId`;
				}
				if (SCHEMA_BLOCK_KINDS.indexOf(schemaBlock.kind) === -1 || !(schemaBlock.requires === null || Array.isArray(schemaBlock.requires))) {
					return `member ${schemaBlock.refId}: kind ${JSON.stringify(schemaBlock.kind)} is not a schema block kind (${SCHEMA_BLOCK_KINDS.join(', ')}) or requires is neither null nor a list`;
				}
				// requires null: the block names no requirement (the support store's own reading, standards-database getBlock)
				const requiredRefIdList = schemaBlock.requires === null ? [] : schemaBlock.requires;
				const outsideRequirement = requiredRefIdList.find((requiredRefId) => !memberRefIdSet.has(requiredRefId));
				return outsideRequirement === undefined ? '' : `member ${schemaBlock.refId} requires ${outsideRequirement}, which the manifest does not list (the closure must be published whole)`;
			})
			.find((oneFault) => oneFault !== '');
		if (blockFault !== undefined) {
			return { error: refusalText(blockFault, 'publishManifest memberList') };
		}
		// the frozen vectors: EXACTLY the set the members reference (none missing, none extra), each verified before it is written
		if (!Array.isArray(frozenVectorList)) {
			return { error: refusalText('frozenVectorList is required (an empty list is stated, never assumed)', 'publishManifest copies every vector its members reference by embeddingRef') };
		}
		const referencedVectorIdSet = new Set(memberList.reduce((soFar, { schemaBlock }) => soFar.concat(embeddingRefListOf(schemaBlock.text)), []));
		const offeredVectorIdSet = new Set(frozenVectorList.map((oneVector) => oneVector.vectorId));
		const absentVectorId = [...referencedVectorIdSet].find((vectorId) => !offeredVectorIdSet.has(vectorId));
		const extraVectorId = [...offeredVectorIdSet].find((vectorId) => !referencedVectorIdSet.has(vectorId));
		if (absentVectorId !== undefined || extraVectorId !== undefined || offeredVectorIdSet.size !== frozenVectorList.length) {
			return { error: refusalText(absentVectorId !== undefined ? `a member references vector ${absentVectorId}, which frozenVectorList does not carry (${referencedVectorIdSet.size} referenced, ${offeredVectorIdSet.size} offered)` : extraVectorId !== undefined ? `frozenVectorList carries vector ${extraVectorId}, which no member references` : 'frozenVectorList names one vectorId twice', 'uriContract holds all and ONLY the vectors its published blocks reference') };
		}
		const badVector = frozenVectorList.map((oneVector) => ({ vectorId: oneVector.vectorId, fault: frozenVectorRefusal(oneVector) })).find((oneCheck) => oneCheck.fault !== '');
		if (badVector !== undefined) {
			return { error: refusalText(`frozen vector ${badVector.vectorId}: ${badVector.fault}`, 'a vector is verified before it is written, as on every read') };
		}
		// the decision schema blocks the members' edges cite (an assertion URI on a published edge resolves through its block): each
		// either already held (a published layer version's) or offered here; nothing offered that no edge cites
		if (!Array.isArray(decisionSchemaBlockList)) {
			return { error: refusalText('decisionSchemaBlockList is required (an empty list is stated, never assumed)', 'publishManifest copies every decision schema block its members\' edges cite') };
		}
		const citedHashSet = new Set(memberList.reduce((soFar, { schemaBlock }) => soFar.concat(decisionBlockHashListOf(schemaBlock.text)), []));
		const offeredBlockHashSet = new Set(decisionSchemaBlockList.map((oneBlock) => (isNonEmptyString(oneBlock.frozenText) ? sha256Hex(oneBlock.frozenText) : '')));
		const uncitedHash = [...offeredBlockHashSet].find((oneHash) => !citedHashSet.has(oneHash));
		const unheldCitedHash = [...citedHashSet].find((oneHash) => !offeredBlockHashSet.has(oneHash) && decisionSchemaBlockTextFor(oneHash).frozenText === null);
		if (uncitedHash !== undefined || unheldCitedHash !== undefined) {
			return { error: refusalText(unheldCitedHash !== undefined ? `a member edge cites decision schema block ${unheldCitedHash}, which is neither held nor offered` : `decisionSchemaBlockList offers ${uncitedHash}, which no member edge cites`, 'uriContract holds all and ONLY the decision schema blocks its published URIs resolve through') };
		}
		const uriMint = edcUri.mint({ kind: 'manifest', publicLabel });
		const uriByContentMint = edcUri.mint({ kind: 'manifestByContent', manifestRefId });
		if (uriMint.error || uriByContentMint.error) {
			return { error: uriMint.error || uriByContentMint.error };
		}
		const manifestRow = { manifestRefId, publicLabel, uri: uriMint.uri, uriByContent: uriByContentMint.uri, defaultLayerByHubJson: defaultLayerByHub === null ? null : JSON.stringify(defaultLayerByHub), basedOnManifestRefId: isNonEmptyString(basedOnManifestRefId) ? basedOnManifestRefId : null, recordedNodeCount, recordedEdgeCount, manifestRecordJson: JSON.stringify(manifestRecord), ancestorRecordListJson: JSON.stringify(ancestorRecordList), publishedAt, publishedByAgentIri };
		const existingRow = database.prepare('SELECT * FROM publishedManifests WHERE manifestRefId = ? OR publicLabel = ?').get(manifestRefId, publicLabel);
		if (existingRow !== undefined) {
			const sameIdentity = existingRow.manifestRefId === manifestRefId && existingRow.publicLabel === publicLabel;
			return sameIdentity ? { alreadyPresent: true } : { error: refusalText(`label '${publicLabel}' or manifest ${manifestRefId} is already published (as '${existingRow.publicLabel}' / ${existingRow.manifestRefId})`, 'a label is never reassigned and a manifest is published once') };
		}
		return runWriteTransaction(() => {
			const blockOutcome = memberList
				.map(({ schemaBlock }) => insertIdentityRow({ tableName: 'schemaBlocks', row: { refId: schemaBlock.refId, kind: schemaBlock.kind, subject: schemaBlock.subject === undefined ? null : schemaBlock.subject, version: schemaBlock.version === undefined ? null : schemaBlock.version, requiresJson: schemaBlock.requires === null ? null : JSON.stringify(schemaBlock.requires), text: schemaBlock.text, producedBy: schemaBlock.producedBy === undefined ? null : schemaBlock.producedBy }, identityWhereSql: 'refId = ?', identityValueList: [schemaBlock.refId] }))
				.find((oneOutcome) => oneOutcome.error);
			if (blockOutcome !== undefined) {
				return blockOutcome;
			}
			const decisionOutcome = decisionSchemaBlockList.map(appendDecisionSchemaBlockRow).find((oneOutcome) => oneOutcome.error);
			if (decisionOutcome !== undefined) {
				return decisionOutcome;
			}
			const derivedOutcome = memberList.map(({ schemaBlock }) => writeDerivedRowsForSchemaBlock(schemaBlock)).find((oneOutcome) => oneOutcome.error);
			if (derivedOutcome !== undefined) {
				return derivedOutcome;
			}
			const vectorOutcome = frozenVectorList
				.map((oneVector) => insertIdentityRow({ tableName: 'frozenVectors', row: { vectorId: oneVector.vectorId, modelVersion: oneVector.modelVersion, dims: Number(oneVector.dims), dtype: oneVector.dtype, inputText: oneVector.inputText, vector: oneVector.vector, vectorHash: oneVector.vectorHash }, identityWhereSql: 'vectorId = ?', identityValueList: [oneVector.vectorId] }))
				.find((oneOutcome) => oneOutcome.error);
			if (vectorOutcome !== undefined) {
				return vectorOutcome;
			}
			database.prepare(insertSqlFor('publishedManifests', manifestRow)).run(manifestRow);
			memberList.forEach((oneMember) => {
				const memberRow = { manifestRefId, position: oneMember.position, schemaBlockRefId: oneMember.schemaBlock.refId, memberDescription: isNonEmptyString(oneMember.memberDescription) ? oneMember.memberDescription : null, producedByRecipeName: isNonEmptyString(oneMember.producedByRecipeName) ? oneMember.producedByRecipeName : null };
				database.prepare(insertSqlFor('publishedManifestMembers', memberRow)).run(memberRow);
			});
			const statusRow = { manifestRefId, registrationStatus, registrationAuthority, changedAt: publishedAt, changedByAgentIri: publishedByAgentIri, note: isNonEmptyString(note) ? note : null };
			database.prepare(insertSqlFor('manifestStatusChanges', statusRow)).run(statusRow);
			return { alreadyPresent: false, uri: uriMint.uri, uriByContent: uriByContentMint.uri };
		});
	};

	// fillAbsentDerivedIndexes — -rebuildUriContractIndexes: verify every source, REFUSE on any difference, then write the derived rows of
	// the sources never indexed (in one transaction). It changes and removes nothing.
	const fillAbsentDerivedIndexes = () => {
		const compared = derivedComparisonFor();
		if (compared.error) {
			return compared;
		}
		if (compared.differenceList.length) {
			return { error: refusalText(`${compared.differenceList.length} derived row set(s) differ from a recomputation of their write-once source: ${compared.differenceList.slice(0, 5).join('; ')}`, 'a derived row that is not what its source yields is a defect to report; this file is never repaired') };
		}
		const filled = runWriteTransaction(() => {
			compared.absentSourceList.forEach((oneSource) => {
				Object.keys(oneSource.rowListByTable).forEach((tableName) => insertDerivedRows(tableName, oneSource.rowListByTable[tableName]));
				insertDerivedRows('derivedIndexedSources', [{ sourceKind: oneSource.sourceKind, sourceIdentity: oneSource.sourceIdentity, derivedRowCount: oneSource.computedRowCount }]);
			});
			return { filledSourceCount: compared.absentSourceList.length };
		});
		return filled.error ? filled : { verifiedSourceCount: compared.verifiedSourceCount, filledSourceCount: filled.filledSourceCount, differenceList: [] };
	};

	return { uriContract: { ...readerApi, writerActionName, appendAgent, appendLayerVersion, appendLayerStatusChange, publishManifest, fillAbsentDerivedIndexes } };
};

// openUriContractFile — the ONE place a uriContract file is opened. The path is REQUIRED (no default); 'read' and 'publish'
// require the file to exist (never a cold store), 'create' requires it to be absent (never written over).
const openUriContractFile = ({ uriContractFilePath, accessMode, writerActionName } = {}) => {
	const accessRule = URI_CONTRACT_RULES.accessModeByName[accessMode];
	if (!isNonEmptyString(uriContractFilePath) || accessRule === undefined) {
		return { error: refusalText(`uriContractFilePath and an accessMode (${Object.keys(URI_CONTRACT_RULES.accessModeByName).join(', ')}) are required (got ${JSON.stringify(uriContractFilePath)}, ${JSON.stringify(accessMode)})`, 'there is no default uriContract') };
	}
	const fileExists = fs.existsSync(uriContractFilePath);
	if (accessRule.fileMustExist && !fileExists) {
		return { error: refusalText(`uriContract ${uriContractFilePath} does not exist`, 'a uriContract is created only by -seedUriContractFromRegistryJson; it is never created by a read or a publish') };
	}
	if (accessRule.fileMustBeAbsent && fileExists) {
		return { error: refusalText(`uriContract ${uriContractFilePath} already exists`, 'a uriContract is created once and never written over') };
	}
	const Database = require(path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'));
	const opened = attemptSql(() => new Database(uriContractFilePath, { readonly: accessRule.readonly, fileMustExist: accessRule.fileMustExist }));
	if (opened.error) {
		return { error: refusalText(`opening ${uriContractFilePath}: ${opened.error}`, 'openUriContractFile') };
	}
	const built = uriContractFor({ database: opened.result, accessMode, writerActionName });
	if (built.error) {
		opened.result.close();
	}
	return built;
};

// uriContractReaderFor — THE uriContractReader lane A's stubResolver kind cases are injected with, VERBATIM as declared in
// lib/edc-uri/stubResolver.js on ml/m31a-respell (AMBER_JOURNEY relay 2026-10-26). Callback style; null = not published; err =
// reader failure (a hash that fails verify-on-read is an err); nothing else is exposed.
//   schemaBlockFor(schemaBlockRefId, cb(err, { schemaBlockRefId, blockKind, subject, version, text } | null))
//   decisionSchemaBlockFor(decisionBlockHash, cb(err, { decisionBlockHash, pairKey, frozenText } | null))
//   publishedManifestFor({ publicLabel } | { manifestRefId }, cb(err, { manifestRefId, publicLabel, publishedAt, memberList: [{ schemaBlockRefId,
//       position }], defaultLayerByHub: null | { <hubSegment>: { decisionBlockHashList } }, latestStatus: { registrationStatus, changedAt } } | null))
//   agentRecordFor(agentIri, cb(err, { profile, layersAuthored, scores, firstContributionAt, lastContributionAt } | null))
const uriContractReaderFor = ({ uriContractFilePath } = {}) => {
	const opened = openUriContractFile({ uriContractFilePath, accessMode: 'read' });
	if (opened.error) {
		return opened;
	}
	const { uriContract } = opened;
	const answerWith = (read, shapeFor, callback) => (read.error ? callback(read.error) : callback('', shapeFor(read)));
	const uriContractReader = {
		schemaBlockFor: (schemaBlockRefId, callback) => answerWith(uriContract.schemaBlockFor(schemaBlockRefId), ({ schemaBlock }) => (schemaBlock === null ? null : { schemaBlockRefId: schemaBlock.refId, blockKind: schemaBlock.kind, subject: schemaBlock.subject, version: schemaBlock.version, text: schemaBlock.text }), callback),
		decisionSchemaBlockFor: (decisionBlockHash, callback) => answerWith(uriContract.decisionSchemaBlockFor(decisionBlockHash), ({ decisionSchemaBlock }) => (decisionSchemaBlock === null ? null : { decisionBlockHash: decisionSchemaBlock.decisionSchemaBlockHash, pairKey: decisionSchemaBlock.pairKey, frozenText: decisionSchemaBlock.frozenText }), callback),
		publishedManifestFor: (manifestSelector, callback) =>
			answerWith(
				uriContract.publishedManifestFor(manifestSelector),
				({ publishedManifest }) => {
					if (publishedManifest === null) {
						return null;
					}
					const latestStatusRow = publishedManifest.statusChangeList[publishedManifest.statusChangeList.length - 1];
					return { manifestRefId: publishedManifest.manifestRefId, publicLabel: publishedManifest.publicLabel, publishedAt: publishedManifest.publishedAt, memberList: publishedManifest.memberList.map((oneMember) => ({ schemaBlockRefId: oneMember.schemaBlockRefId, position: oneMember.position })), defaultLayerByHub: publishedManifest.defaultLayerByHub, latestStatus: { registrationStatus: latestStatusRow.registrationStatus, changedAt: latestStatusRow.changedAt } };
				},
				callback,
			),
		agentRecordFor: (agentIri, callback) => answerWith(uriContract.agentRecordFor(agentIri), ({ agentRecord }) => agentRecord, callback),
		// the COMPUTED RELATIONS (uriContractRelations.js), lane A's shapes, VERBATIM
		elementRecordFor: (elementSelector, callback) => answerWith(uriContract.relations.elementRecordFor(elementSelector), ({ answer }) => answer, callback),
		publishedLayerVersionListForStandard: (standardSelector, callback) => answerWith(uriContract.relations.publishedLayerVersionListForStandard(standardSelector), ({ answer }) => answer, callback),
		mappingsToMeaningFor: (meaningIri, callback) => answerWith(uriContract.relations.mappingsToMeaningFor(meaningIri), ({ answer }) => answer, callback),
		layerHistoryFor: (layerKey, callback) => answerWith(uriContract.relations.layerHistoryFor(layerKey), ({ answer }) => answer, callback),
		layerVersionRecordFor: (layerVersionSelector, callback) => answerWith(uriContract.relations.layerVersionRecordFor(layerVersionSelector), ({ answer }) => answer, callback),
		manifestInventoryFor: (manifestSelector, callback) => answerWith(uriContract.relations.manifestInventoryFor(manifestSelector), ({ answer }) => answer, callback),
		rootCountsFor: (callback) => answerWith(uriContract.relations.rootCountsFor(), ({ answer }) => answer, callback),
		publishedManifestListFor: (pageSpec, callback) => answerWith(uriContract.relations.publishedManifestListFor(pageSpec), ({ answer }) => answer, callback),
		manifestStandardListFor: (manifestSelector, callback) => answerWith(uriContract.relations.manifestStandardListFor(manifestSelector), ({ answer }) => answer, callback),
		manifestElementListFor: (manifestSelector, listSpec, callback) => answerWith(uriContract.relations.manifestElementListFor(manifestSelector, listSpec), ({ answer }) => answer, callback),
		agentListFor: (pageSpec, callback) => answerWith(uriContract.relations.agentListFor(pageSpec), ({ answer }) => answer, callback),
		layerListFor: (callback) => answerWith(uriContract.relations.layerListFor(), ({ answer }) => answer, callback),
		manifestHubListFor: (manifestSelector, callback) => answerWith(uriContract.relations.manifestHubListFor(manifestSelector), ({ answer }) => answer, callback),
		hubDomainListFor: (manifestSelector, listSpec, callback) => answerWith(uriContract.relations.hubDomainListFor(manifestSelector, listSpec), ({ answer }) => answer, callback),
		hubDomainCardListFor: (manifestSelector, listSpec, callback) => answerWith(uriContract.relations.hubDomainCardListFor(manifestSelector, listSpec), ({ answer }) => answer, callback),
	};
	return { uriContractReader, uriContract };
};

module.exports = { openUriContractFile, uriContractFor, uriContractReaderFor, schemaSqlList, embeddingRefListOf, decisionBlockHashListOf, URI_CONTRACT_SCHEMA, URI_CONTRACT_RULES, moduleName };
