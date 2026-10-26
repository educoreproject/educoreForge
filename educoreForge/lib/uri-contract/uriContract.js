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
//     publishedManifestFor({ publicLabel } | { manifestRefId }) → { publishedManifest } | { error }   null when absent
//     publishedManifestList()                → [{ manifestRefId, publicLabel, publishedAt }] in publication order
//   WRITERS (publish and create modes only; each is ONE transaction, refused whole or written whole)
//     appendAgent(agent)                                         → { alreadyPresent } | { error }
//     appendLayerVersion({ layer, version, decisionSchemaBlockList }) → { alreadyPresent } | { error }
//     appendLayerStatusChange({ layerKey, statusChange })         → { rowId } | { error }
//     publishManifest({ ... })                                    → { alreadyPresent } | { error }
//
// THE RULES THIS MODULE KEEPS, each a refusal by name:
//   * NO UPDATE, NO DELETE. The module issues neither; the schema adds BEFORE UPDATE / BEFORE DELETE triggers that abort, so
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
const agentRowFor = (agent) => ({ agentIri: agent.agentIri, agentKind: agent.agentKind, displayName: agent.displayName, aliasIri: agent.aliasIri === undefined ? null : agent.aliasIri, note: agent.note === undefined ? null : agent.note });

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
const agentFromRow = (agentRow) => withOptionalFields({ agentIri: agentRow.agentIri, agentKind: agentRow.agentKind, displayName: agentRow.displayName }, [['aliasIri', agentRow.aliasIri], ['note', agentRow.note]]);

// identityRowsEqual(left, right) → the two rows say the same thing, column for column
const identityRowsEqual = (leftRow, rightRow) => Object.keys(rightRow).every((columnName) => leftRow[columnName] === rightRow[columnName]);

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
		return sha256Hex(row.text) === refId ? { schemaBlock: { ...row, requires: JSON.parse(row.requiresJson) } } : { error: refusalText(`schema block ${refId} fails verify-on-read (its text hashes to ${sha256Hex(row.text)})`, 'a corrupted row is a defect to report; this file is never repaired') };
	};
	const publishedManifestFor = ({ publicLabel, manifestRefId } = {}) => {
		const row = isNonEmptyString(manifestRefId) ? database.prepare('SELECT * FROM publishedManifests WHERE manifestRefId = ?').get(manifestRefId) : database.prepare('SELECT * FROM publishedManifests WHERE publicLabel = ?').get(publicLabel);
		if (row === undefined) {
			return { publishedManifest: null };
		}
		const memberList = database.prepare('SELECT position, schemaBlockRefId FROM publishedManifestMembers WHERE manifestRefId = ? ORDER BY position').all(row.manifestRefId);
		const recomputedRefId = contentAddress.manifestKeyForMembership(memberList.map((oneMember) => ({ blockId: oneMember.schemaBlockRefId, position: oneMember.position })));
		if (recomputedRefId !== row.manifestRefId) {
			return { error: refusalText(`published manifest ${row.manifestRefId} fails verify-on-read (its members hash to ${recomputedRefId})`, 'a corrupted row is a defect to report; this file is never repaired') };
		}
		const statusChangeList = database.prepare('SELECT * FROM manifestStatusChanges WHERE manifestRefId = ? ORDER BY rowId').all(row.manifestRefId);
		return { publishedManifest: { ...row, defaultLayerByHub: row.defaultLayerByHubJson === null ? null : JSON.parse(row.defaultLayerByHubJson), memberList, statusChangeList, effectiveRegistrationStatus: statusChangeList[statusChangeList.length - 1].registrationStatus } };
	};
	const publishedManifestList = () => database.prepare('SELECT manifestRefId, publicLabel, publishedAt FROM publishedManifests ORDER BY rowid').all();

	const readerApi = { accessMode, registryShape, loadRegistry, decisionSchemaBlockTextFor, decisionSchemaBlockFor, schemaBlockFor, publishedManifestFor, publishedManifestList, close: () => database.close() };
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
	// runWriteTransaction(work) → work's { ... } | { error }: ONE transaction; a refusal from work rolls everything back
	const runWriteTransaction = (work) => {
		const ROLLBACK_SIGNAL = {};
		let refusal = null;
		const ran = attemptSql(() =>
			database.transaction(() => {
				const outcome = work();
				if (outcome.error) {
					refusal = outcome;
					throw ROLLBACK_SIGNAL;
				}
				return outcome;
			})(),
		);
		if (refusal !== null) {
			return refusal;
		}
		return ran.error ? { error: refusalText(`the write was rolled back: ${ran.error}`, 'uriContract writes are one transaction each') } : ran.result;
	};

	const agentRefusalFor = (agent) => closedFieldRefusal({ candidate: agent, fieldList: URI_CONTRACT_RULES.agentFieldList, label: `agent ${JSON.stringify(agent && agent.agentIri)}` });
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
		return insertIdentityRow({ tableName: 'decisionSchemaBlocks', row: { decisionSchemaBlockHash: sha256Hex(frozenText), pairKey, producerKind, frozenText }, identityWhereSql: 'decisionSchemaBlockHash = ?', identityValueList: [sha256Hex(frozenText)] });
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
			return { alreadyPresent: false };
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
	const publishManifest = ({ manifestRefId, publicLabel, memberList, defaultLayerByHub, basedOnManifestRefId, recordedNodeCount, recordedEdgeCount, publishedAt, publishedByAgentIri, registrationStatus, registrationAuthority, note } = {}) => {
		if (!isNonEmptyString(publicLabel) || !new RegExp(URI_CONTRACT_RULES.publicLabelPattern).test(publicLabel) || URI_CONTRACT_RULES.reservedPublicLabelList.indexOf(publicLabel) !== -1) {
			return { error: refusalText(`publicLabel ${JSON.stringify(publicLabel)} must match ${URI_CONTRACT_RULES.publicLabelPattern} and is never a reserved word (${URI_CONTRACT_RULES.reservedPublicLabelList.join(', ')})`, 'uriContractRules.json; the label is TQ\'s to choose') };
		}
		if (LAYER_REGISTRY_SCHEMA.registrationStatusList.indexOf(registrationStatus) === -1) {
			return { error: refusalText(`registrationStatus ${JSON.stringify(registrationStatus)} is not an ISO/IEC 11179-6 lifecycle status (${LAYER_REGISTRY_SCHEMA.registrationStatusList.join(', ')})`, 'publishManifest names the status it is published with; there is no default') };
		}
		if (!Array.isArray(memberList) || memberList.length === 0 || !(defaultLayerByHub === null || isPlainObject(defaultLayerByHub)) || !Number.isInteger(recordedNodeCount) || !Number.isInteger(recordedEdgeCount) || !new RegExp(LAYER_REGISTRY_SCHEMA.publishedAtPattern).test(String(publishedAt))) {
			return { error: refusalText('memberList (non-empty), defaultLayerByHub (null, or an object naming the producer that answers a conflicted pair), whole-number recordedNodeCount and recordedEdgeCount, and an ISO UTC publishedAt are required', 'publishManifest({ ... }); nothing here is defaulted') };
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
				if (SCHEMA_BLOCK_KINDS.indexOf(schemaBlock.kind) === -1 || !Array.isArray(schemaBlock.requires)) {
					return `member ${schemaBlock.refId}: kind ${JSON.stringify(schemaBlock.kind)} is not a schema block kind (${SCHEMA_BLOCK_KINDS.join(', ')}) or requires is not a list`;
				}
				const outsideRequirement = schemaBlock.requires.find((requiredRefId) => !memberRefIdSet.has(requiredRefId));
				return outsideRequirement === undefined ? '' : `member ${schemaBlock.refId} requires ${outsideRequirement}, which the manifest does not list (the closure must be published whole)`;
			})
			.find((oneFault) => oneFault !== '');
		if (blockFault !== undefined) {
			return { error: refusalText(blockFault, 'publishManifest memberList') };
		}
		const uriMint = edcUri.mint({ kind: 'manifest', publicLabel });
		const uriByContentMint = edcUri.mint({ kind: 'manifestByContent', manifestRefId });
		if (uriMint.error || uriByContentMint.error) {
			return { error: uriMint.error || uriByContentMint.error };
		}
		const manifestRow = { manifestRefId, publicLabel, uri: uriMint.uri, uriByContent: uriByContentMint.uri, defaultLayerByHubJson: defaultLayerByHub === null ? null : JSON.stringify(defaultLayerByHub), basedOnManifestRefId: isNonEmptyString(basedOnManifestRefId) ? basedOnManifestRefId : null, recordedNodeCount, recordedEdgeCount, publishedAt, publishedByAgentIri };
		const existingRow = database.prepare('SELECT * FROM publishedManifests WHERE manifestRefId = ? OR publicLabel = ?').get(manifestRefId, publicLabel);
		if (existingRow !== undefined) {
			const sameIdentity = existingRow.manifestRefId === manifestRefId && existingRow.publicLabel === publicLabel;
			return sameIdentity ? { alreadyPresent: true } : { error: refusalText(`label '${publicLabel}' or manifest ${manifestRefId} is already published (as '${existingRow.publicLabel}' / ${existingRow.manifestRefId})`, 'a label is never reassigned and a manifest is published once') };
		}
		return runWriteTransaction(() => {
			const blockOutcome = memberList
				.map(({ schemaBlock }) => insertIdentityRow({ tableName: 'schemaBlocks', row: { refId: schemaBlock.refId, kind: schemaBlock.kind, subject: schemaBlock.subject === undefined ? null : schemaBlock.subject, version: schemaBlock.version === undefined ? null : schemaBlock.version, requiresJson: JSON.stringify(schemaBlock.requires), text: schemaBlock.text, producedBy: schemaBlock.producedBy === undefined ? null : schemaBlock.producedBy }, identityWhereSql: 'refId = ?', identityValueList: [schemaBlock.refId] }))
				.find((oneOutcome) => oneOutcome.error);
			if (blockOutcome !== undefined) {
				return blockOutcome;
			}
			database.prepare(insertSqlFor('publishedManifests', manifestRow)).run(manifestRow);
			memberList.forEach((oneMember) => {
				const memberRow = { manifestRefId, position: oneMember.position, schemaBlockRefId: oneMember.schemaBlock.refId };
				database.prepare(insertSqlFor('publishedManifestMembers', memberRow)).run(memberRow);
			});
			const statusRow = { manifestRefId, registrationStatus, registrationAuthority, changedAt: publishedAt, changedByAgentIri: publishedByAgentIri, note: isNonEmptyString(note) ? note : null };
			database.prepare(insertSqlFor('manifestStatusChanges', statusRow)).run(statusRow);
			return { alreadyPresent: false, uri: uriMint.uri, uriByContent: uriByContentMint.uri };
		});
	};

	return { uriContract: { ...readerApi, writerActionName, appendAgent, appendLayerVersion, appendLayerStatusChange, publishManifest } };
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

// uriContractReaderFor — the three-function reader lane A's stubResolver kind cases are injected with; nothing more is exposed
const uriContractReaderFor = ({ uriContractFilePath } = {}) => {
	const opened = openUriContractFile({ uriContractFilePath, accessMode: 'read' });
	if (opened.error) {
		return opened;
	}
	const { schemaBlockFor, decisionSchemaBlockFor, publishedManifestFor } = opened.uriContract;
	return { uriContractReader: { schemaBlockFor, decisionSchemaBlockFor, publishedManifestFor }, uriContract: opened.uriContract };
};

module.exports = { openUriContractFile, uriContractFor, uriContractReaderFor, schemaSqlList, URI_CONTRACT_SCHEMA, URI_CONTRACT_RULES, moduleName };
