'use strict';

// uri-contract-actions.js — the graphBuilder actions that write and check uriContract.sqlite (ML3.1 Part B; WORKORDER-ML3.1 section 3
// and the rulings of 2026-10-26). actions.js exposes them; this file keeps their bodies out of actions.js, which both ML3.1 lanes edit.
//
//   -seedUriContractFromRegistryJson  CREATES a uriContract from recipes/layers.json + recipes/agents.json and a support store's
//                                     decision blocks; it is built under a temporary name, the row-for-row agreement is checked,
//                                     and only then renamed into place (a file that disagrees is never left looking finished)
//   -publishManifest                  the manifest's identity row, members, schema blocks (the closure), frozen vectors, recorded
//                                     counts (the hermetic replay) and first status row; --publicLabel and --registrationStatus REQUIRED
//   -appendManifestStatus             a published manifest's later status (endorsement, supersession) as a NEW history row;
//                                     --registrationStatus and --note REQUIRED
//   -replayOldest                     the replay-the-oldest discipline: the hermetic count of the OLDEST published manifest must equal
//                                     the counts recorded at publish; --live=true also replays it into a DEV_ graph from an export of
//                                     uriContract ALONE and compares the graph's conservation counts
//   -rebuildUriContractIndexes        verifies every derived row against a recomputation of its write-once source; refuses on any
//                                     difference; fills sources never indexed (--verifyOnly=true writes nothing)
// and the shared door the publish actions open uriContract through (uriContractForPublishAction).
//
// WHERE THE FILE IS (AMBER_JOURNEY ruling Q3): an explicit --uriContractFilePath wins, else [stores] uriContractFilePath in
// graphBuilder.ini; absent or blank is refused by name (config-supplied is not a code default). Every action but the seed requires
// the file to EXIST (never a cold store); the seed requires it to be ABSENT (never written over).

const fs = require('fs');
const path = require('path');

const TREE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
const uriContractLib = require(path.join(TREE_LIB, 'uri-contract', 'uriContract'));
const registrySeedLib = require(path.join(TREE_LIB, 'uri-contract', 'registrySeed'));
const replayCountLib = require(path.join(TREE_LIB, 'uri-contract', 'replayCount'));
const manifestPublicationLib = require(path.join(TREE_LIB, 'uri-contract', 'manifestPublication'));
const publishInputsLib = require(path.join(TREE_LIB, 'uri-contract', 'publishInputs'));

const firstValue = (commandLineParameters, parameterName) => (commandLineParameters.values[parameterName] || [])[0];
const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.trim().length > 0;

// resolveUriContractFilePath — { filePath, resolvedFrom } | { error }
const resolveUriContractFilePath = ({ commandLineParameters, storesConfig, actionName }) => {
	const explicitValue = firstValue(commandLineParameters, 'uriContractFilePath');
	if (typeof explicitValue === 'string') {
		return isNonEmptyString(explicitValue) ? { filePath: explicitValue, resolvedFrom: 'commandLine' } : { error: `graphBuilder ${actionName}: --uriContractFilePath was given but BLANK; a blank is refused rather than replaced by the configured path` };
	}
	const configuredValue = (storesConfig || {}).uriContractFilePath;
	if (typeof configuredValue === 'string') {
		return isNonEmptyString(configuredValue) ? { filePath: configuredValue, resolvedFrom: 'config' } : { error: `graphBuilder ${actionName}: [stores] uriContractFilePath is present in graphBuilder.ini but BLANK; name a path or remove the key` };
	}
	return { error: `graphBuilder ${actionName}: no uriContract path resolved, and there is NO DEFAULT. Set [stores] uriContractFilePath in graphBuilder.ini, or pass --uriContractFilePath=<path>.` };
};

// attemptJsonParse — the ONE boundary where JSON.parse's throw becomes an error string
const attemptJsonParse = (fileText) => {
	let parsedJson = null;
	let parseFault = '';
	try {
		parsedJson = JSON.parse(fileText);
	} catch (parseError) {
		parseFault = parseError.message;
	}
	return parseFault ? { error: parseFault } : { parsedJson };
};
// readJsonParameterFile({ commandLineParameters, parameterName, actionName }) → { parsedJson } | { absent: true } | { error }
const readJsonParameterFile = ({ commandLineParameters, parameterName, actionName }) => {
	const filePath = firstValue(commandLineParameters, parameterName);
	if (filePath === undefined) {
		return { absent: true };
	}
	if (!isNonEmptyString(filePath) || !fs.existsSync(filePath)) {
		return { error: `graphBuilder ${actionName}: --${parameterName} ${JSON.stringify(filePath)} does not exist` };
	}
	const parsed = attemptJsonParse(fs.readFileSync(filePath, 'utf8'));
	return parsed.error ? { error: `graphBuilder ${actionName}: --${parameterName} ${filePath} is not JSON: ${parsed.error}` } : { parsedJson: parsed.parsedJson };
};

// openSupportStoreReadOnly(filePath) → { supportStore } | { error }: the support store a publish READS (blocks, decisions, vectors)
const openSupportStoreReadOnly = (filePath) => {
	if (!isNonEmptyString(filePath) || !fs.existsSync(filePath)) {
		return { error: `the support store ${JSON.stringify(filePath)} does not exist` };
	}
	const Database = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'better-sqlite3'));
	return { supportStore: new Database(filePath, { readonly: true, fileMustExist: true }) };
};
const decisionBlockReaderFor = (supportStore) => {
	const statement = supportStore.prepare('SELECT CAST(frozenText AS TEXT) AS frozenText FROM decisionBlocks WHERE decisionBlockHash = ? LIMIT 1');
	return (decisionBlockHash) => {
		const row = statement.get(decisionBlockHash);
		return { frozenText: row === undefined ? null : row.frozenText };
	};
};

// ---------------------------------------------------------------------
// the publish actions' door: uriContract opened for writing, its registry with the operator's layer and agent definitions
// ---------------------------------------------------------------------
const uriContractForPublishAction = ({ commandLineParameters, storesConfig, actionName, writerActionName, layerKey, layerIsCreatedByAction }) => {
	const resolved = resolveUriContractFilePath({ commandLineParameters, storesConfig, actionName });
	if (resolved.error) {
		return resolved;
	}
	const layerDefinition = readJsonParameterFile({ commandLineParameters, parameterName: 'layerDefinitionPath', actionName });
	const agentDefinition = readJsonParameterFile({ commandLineParameters, parameterName: 'agentDefinitionPath', actionName });
	if (layerDefinition.error || agentDefinition.error) {
		return { error: layerDefinition.error || agentDefinition.error };
	}
	const opened = uriContractLib.openUriContractFile({ uriContractFilePath: resolved.filePath, accessMode: 'publish', writerActionName });
	if (opened.error) {
		return { error: `graphBuilder ${actionName}: ${opened.error}` };
	}
	const prepared = publishInputsLib.registryForPublish({ uriContract: opened.uriContract, layerKey, layerDefinition: layerDefinition.absent ? undefined : layerDefinition.parsedJson, agentDefinitionList: agentDefinition.absent ? undefined : agentDefinition.parsedJson, layerIsCreatedByAction });
	if (prepared.error) {
		opened.uriContract.close();
		return { error: `graphBuilder ${actionName}: ${prepared.error}` };
	}
	return { uriContract: opened.uriContract, registry: prepared.registry, newAgentList: prepared.newAgentList, uriContractFilePath: resolved.filePath };
};
// appendPublishedVersion({ uriContract, newAgentList, uriContractAppend }) → { error } | {}: the new agents, then the version
const appendPublishedVersion = ({ uriContract, newAgentList, uriContractAppend }) => {
	const agentsAppended = publishInputsLib.appendNewAgents({ uriContract, newAgentList });
	if (agentsAppended.error) {
		return agentsAppended;
	}
	return uriContract.appendLayerVersion(uriContractAppend);
};

// ---------------------------------------------------------------------
// -seedUriContractFromRegistryJson
// ---------------------------------------------------------------------
const seedUriContractFromRegistryJsonAction = ({ resolveStoreFamilyPath }) => (callback) => {
	const { xLog, commandLineParameters, getConfig } = process.global;
	const actionName = '-seedUriContractFromRegistryJson';
	const resolved = resolveUriContractFilePath({ commandLineParameters, storesConfig: getConfig('stores'), actionName });
	if (resolved.error) {
		callback(resolved.error);
		return;
	}
	const layerFile = readJsonParameterFile({ commandLineParameters, parameterName: 'layerRegistryFilePath', actionName });
	const agentFile = readJsonParameterFile({ commandLineParameters, parameterName: 'agentRegistryFilePath', actionName });
	if (layerFile.absent || agentFile.absent || layerFile.error || agentFile.error) {
		callback(layerFile.error || agentFile.error || `graphBuilder ${actionName}: --layerRegistryFilePath and --agentRegistryFilePath are REQUIRED, with no default (the seed names the registry it moves)`);
		return;
	}
	const supportResolution = resolveStoreFamilyPath({ familyName: 'standardsDatabase', commandLineParameters, storesConfig: getConfig('stores'), actionName });
	if (supportResolution.error) {
		callback(supportResolution.error);
		return;
	}
	if (fs.existsSync(resolved.filePath)) {
		callback(`graphBuilder ${actionName}: REFUSED — ${resolved.filePath} already exists; a uriContract is created once and never written over`);
		return;
	}
	const openedStore = openSupportStoreReadOnly(supportResolution.filePath);
	if (openedStore.error) {
		callback(`graphBuilder ${actionName}: ${openedStore.error}`);
		return;
	}
	const temporaryFilePath = `${resolved.filePath}.seeding-${process.pid}`;
	const created = uriContractLib.openUriContractFile({ uriContractFilePath: temporaryFilePath, accessMode: 'create', writerActionName: 'seedUriContractFromRegistryJson' });
	if (created.error) {
		openedStore.supportStore.close();
		callback(`graphBuilder ${actionName}: ${created.error}`);
		return;
	}
	const seeded = registrySeedLib.seedFromRegistry({ uriContract: created.uriContract, layerRegistry: layerFile.parsedJson, agentRegistry: agentFile.parsedJson, decisionBlockTextFor: decisionBlockReaderFor(openedStore.supportStore) });
	openedStore.supportStore.close();
	const agreement = seeded.error ? null : registrySeedLib.registryAgreement({ uriContract: created.uriContract, layerRegistry: layerFile.parsedJson, agentRegistry: agentFile.parsedJson });
	const derivedCheck = seeded.error || !agreement.agree ? null : created.uriContract.verifyDerivedIndexes();
	created.uriContract.close();
	if (seeded.error || !agreement.agree || derivedCheck.error || derivedCheck.differenceList.length || derivedCheck.absentSourceCount) {
		callback(`graphBuilder ${actionName}: REFUSED — ${seeded.error || (!agreement.agree ? `the tables do not equal the JSON: ${agreement.differenceList.join('; ')}` : `the derived rows do not verify: ${derivedCheck.error || JSON.stringify(derivedCheck)}`)}. The partial file is left at ${temporaryFilePath} for inspection; it was never named as a uriContract.`);
		return;
	}
	fs.renameSync(temporaryFilePath, resolved.filePath);
	xLog.status(`graphBuilder: [seedUriContractFromRegistryJson] ${resolved.filePath}: ${JSON.stringify(seeded.seedReport)}; row-for-row agreement with the JSON: yes`);
	callback('', { exitCode: 0, resultText: JSON.stringify({ uriContractFilePath: resolved.filePath, seedReport: seeded.seedReport, rowForRowAgreement: true, derivedSourcesVerified: derivedCheck.verifiedSourceCount }, null, 2) });
};

// ---------------------------------------------------------------------
// -publishManifest
// ---------------------------------------------------------------------
const publishManifestAction = ({ resolveStoreFamilyPath }) => (callback) => {
	const { xLog, commandLineParameters, getConfig } = process.global;
	const actionName = '-publishManifest';
	const missingParameterList = ['manifestRefId', 'publicLabel', 'registrationStatus'].filter((parameterName) => !isNonEmptyString(firstValue(commandLineParameters, parameterName)));
	if (missingParameterList.length) {
		callback(`graphBuilder ${actionName}: ${missingParameterList.map((parameterName) => `--${parameterName}`).join(', ')} REQUIRED, with no default — the label is TQ's to choose and a status is stated, never assumed`);
		return;
	}
	const declaredDefault = readJsonParameterFile({ commandLineParameters, parameterName: 'defaultLayerByHubPath', actionName });
	if (declaredDefault.error) {
		callback(declaredDefault.error);
		return;
	}
	const supportResolution = resolveStoreFamilyPath({ familyName: 'standardsDatabase', commandLineParameters, storesConfig: getConfig('stores'), actionName });
	if (supportResolution.error) {
		callback(supportResolution.error);
		return;
	}
	const resolved = resolveUriContractFilePath({ commandLineParameters, storesConfig: getConfig('stores'), actionName });
	if (resolved.error) {
		callback(resolved.error);
		return;
	}
	const openedStore = openSupportStoreReadOnly(supportResolution.filePath);
	if (openedStore.error) {
		callback(`graphBuilder ${actionName}: ${openedStore.error}`);
		return;
	}
	const manifestRefId = firstValue(commandLineParameters, 'manifestRefId');
	const gathered = manifestPublicationLib.manifestForPublish({ supportStore: openedStore.supportStore, manifestRefId });
	openedStore.supportStore.close();
	if (gathered.error) {
		callback(`graphBuilder ${actionName}: ${gathered.error}`);
		return;
	}
	const conflicts = manifestPublicationLib.answerConflictListFor({ memberList: gathered.memberList });
	const defaulted = conflicts.error ? conflicts : manifestPublicationLib.defaultLayerByHubFor({ answerConflictList: conflicts.answerConflictList, declaredDefaultLayerByHub: declaredDefault.absent ? undefined : declaredDefault.parsedJson });
	if (defaulted.error) {
		callback(`graphBuilder ${actionName}: ${defaulted.error}`);
		return;
	}
	const blockTextByPosition = gathered.memberList.map((oneMember) => oneMember.schemaBlock.text);
	const counted = replayCountLib.hermeticReplayCountFor({ memberCount: blockTextByPosition.length, blockTextAt: (position) => blockTextByPosition[position] });
	if (counted.error) {
		callback(`graphBuilder ${actionName}: ${counted.error}`);
		return;
	}
	const opened = uriContractLib.openUriContractFile({ uriContractFilePath: resolved.filePath, accessMode: 'publish', writerActionName: 'publishManifest' });
	if (opened.error) {
		callback(`graphBuilder ${actionName}: ${opened.error}`);
		return;
	}
	const rules = uriContractLib.URI_CONTRACT_RULES;
	const published = opened.uriContract.publishManifest({
		manifestRefId,
		publicLabel: firstValue(commandLineParameters, 'publicLabel'),
		memberList: gathered.memberList,
		frozenVectorList: gathered.frozenVectorList,
		decisionSchemaBlockList: gathered.decisionSchemaBlockList,
		manifestRecord: gathered.manifestRecord,
		ancestorRecordList: gathered.ancestorRecordList,
		defaultLayerByHub: defaulted.defaultLayerByHub,
		basedOnManifestRefId: gathered.basedOnManifestRefId,
		recordedNodeCount: counted.nodeCount,
		recordedEdgeCount: counted.edgeCount,
		publishedAt: new Date().toISOString(),
		publishedByAgentIri: rules.registrarIri,
		registrationStatus: firstValue(commandLineParameters, 'registrationStatus'),
		registrationAuthority: rules.registrationAuthorityIri,
		note: firstValue(commandLineParameters, 'note'),
	});
	opened.uriContract.close();
	if (published.error) {
		callback(`graphBuilder ${actionName}: ${published.error}`);
		return;
	}
	const report = { manifestRefId, publicLabel: firstValue(commandLineParameters, 'publicLabel'), alreadyPresent: published.alreadyPresent, uri: published.uri, uriByContent: published.uriByContent, memberCount: gathered.memberList.length, frozenVectorCount: gathered.frozenVectorList.length, citedDecisionSchemaBlockCount: gathered.decisionSchemaBlockList.length, recordedNodeCount: counted.nodeCount, recordedEdgeCount: counted.edgeCount, danglingEdgeCount: counted.danglingEdgeCount, answerSlotCount: conflicts.answerSlotCount, answerConflictCount: conflicts.answerConflictList.length, defaultLayerByHub: defaulted.defaultLayerByHub, uriContractFilePath: resolved.filePath };
	xLog.status(`graphBuilder: [publishManifest] ${published.alreadyPresent ? 'alreadyPresent' : 'published'} ${report.publicLabel} (${manifestRefId}): ${report.memberCount} blocks, ${report.frozenVectorCount} vectors, recorded ${report.recordedNodeCount} nodes / ${report.recordedEdgeCount} edges`);
	callback('', { exitCode: 0, resultText: JSON.stringify(report, null, 2) });
};

// ---------------------------------------------------------------------
// -appendManifestStatus --manifestRefId --registrationStatus --note [--uriContractFilePath]
// ---------------------------------------------------------------------
// A published manifest's later status (an endorsement, a supersession) as one NEW manifestStatusChanges row: -publishManifest
// writes only the first. The changing agent and the registration authority are uriContractRules.json's, as at publish.
const appendManifestStatusAction = () => (callback) => {
	const { xLog, commandLineParameters, getConfig } = process.global;
	const actionName = '-appendManifestStatus';
	const missingParameterList = ['manifestRefId', 'registrationStatus', 'note'].filter((parameterName) => !isNonEmptyString(firstValue(commandLineParameters, parameterName)));
	if (missingParameterList.length) {
		callback(`graphBuilder ${actionName}: ${missingParameterList.map((parameterName) => `--${parameterName}`).join(', ')} REQUIRED, with no default — a status is stated, never assumed, and its reason is recorded with it`);
		return;
	}
	const resolved = resolveUriContractFilePath({ commandLineParameters, storesConfig: getConfig('stores'), actionName });
	if (resolved.error) {
		callback(resolved.error);
		return;
	}
	const opened = uriContractLib.openUriContractFile({ uriContractFilePath: resolved.filePath, accessMode: 'publish', writerActionName: 'appendManifestStatus' });
	if (opened.error) {
		callback(`graphBuilder ${actionName}: ${opened.error}`);
		return;
	}
	const manifestRefId = firstValue(commandLineParameters, 'manifestRefId');
	const appended = opened.uriContract.appendManifestStatusChange({
		manifestRefId,
		registrationStatus: firstValue(commandLineParameters, 'registrationStatus'),
		changedAt: new Date().toISOString(),
		changedBy: uriContractLib.URI_CONTRACT_RULES.registrarIri,
		note: firstValue(commandLineParameters, 'note'),
	});
	const readBack = appended.error ? null : opened.uriContract.publishedManifestFor({ manifestRefId });
	opened.uriContract.close();
	if (appended.error || readBack.error) {
		callback(`graphBuilder ${actionName}: ${appended.error || readBack.error}`);
		return;
	}
	const { publishedManifest } = readBack;
	const report = { manifestRefId, publicLabel: publishedManifest.publicLabel, rowId: appended.rowId, effectiveRegistrationStatus: publishedManifest.effectiveRegistrationStatus, statusHistory: publishedManifest.statusChangeList.map((oneRow) => ({ registrationStatus: oneRow.registrationStatus, changedAt: oneRow.changedAt, changedBy: oneRow.changedByAgentIri, note: oneRow.note })), uriContractFilePath: resolved.filePath };
	xLog.status(`graphBuilder: [appendManifestStatus] ${report.publicLabel} (${manifestRefId}) is now ${report.effectiveRegistrationStatus} (row ${report.rowId})`);
	callback('', { exitCode: 0, resultText: JSON.stringify(report, null, 2) });
};

// ---------------------------------------------------------------------
// -replayOldest [--live=true --exportStoreFilePath=<new scratch store>]
// ---------------------------------------------------------------------
// exportManifestStore — the manifest's blocks, membership and frozen vectors written from uriContract ALONE into a FRESH support store
// (blocks and vectors through the store modules' own writers; the manifest rows with the metadata the recipe finisher reads, exactly as
// published, ancestors included), so -replay reads it exactly as it reads any store. TRAPS found by the first live runs: the parent a
// manifest names is not in the export unless its record is (FOREIGN KEY); 213,773 synchronous callbacks overflow the stack
const exportManifestStore = ({ uriContract, publishedManifest, exportStoreFilePath }, callback) => {
	const { taskListPlus, pipeRunner } = new (require('qtools-asynchronous-pipe-plus'))();
	const standardsDatabaseModule = require(path.join(TREE_LIB, 'standards-database', 'standards-database'))();
	const vectorStoreModule = require(path.join(TREE_LIB, 'vector-store', 'vector-store'));
	const contentAddress = require(path.join(TREE_LIB, 'content-address', 'content-address'))();
	const taskList = new taskListPlus();
	taskList.push((args, next) => standardsDatabaseModule.open({ databaseFilePath: exportStoreFilePath }, (openError, standardsDatabase) => next(openError, { ...args, standardsDatabase })));
	taskList.push((args, next) => {
		const saveNext = (memberIndex) => {
			if (memberIndex >= publishedManifest.memberList.length) {
				next('', args);
				return;
			}
			const read = uriContract.schemaBlockFor(publishedManifest.memberList[memberIndex].schemaBlockRefId);
			if (read.error || read.schemaBlock === null) {
				next(read.error || `member ${publishedManifest.memberList[memberIndex].schemaBlockRefId} is not in uriContract`, args);
				return;
			}
			const { schemaBlock } = read;
			args.standardsDatabase.saveBlock({ text: schemaBlock.text, kind: schemaBlock.kind, subject: schemaBlock.subject, version: schemaBlock.version, requires: schemaBlock.requires, producedBy: schemaBlock.producedBy }, (saveError) => (saveError ? next(saveError, args) : setImmediate(() => saveNext(memberIndex + 1))));
		};
		saveNext(0);
	});
	// the manifest rows the recipe finisher reads, written EXACTLY as published (createdAt included, which saveManifest would stamp anew):
	// the basedOn ancestors deepest first as metadata-only rows, then this manifest with its members' metadata. A raw connection on the
	// SCRATCH export store, foreign keys off only so an ancestor may name the parent its own store had already pruned.
	taskList.push((args, next) => {
		const Database = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'better-sqlite3'));
		const exportConnection = new Database(exportStoreFilePath, { fileMustExist: true });
		exportConnection.pragma('foreign_keys = OFF');
		const manifestStatement = exportConnection.prepare('INSERT INTO manifests (refId, name, description, recipeName, recipeHash, recipeFileName, basedOnManifestRefId, createdAt) VALUES (@refId, @name, @description, @recipeName, @recipeHash, @recipeFileName, @basedOnManifestRefId, @createdAt)');
		const memberStatement = exportConnection.prepare('INSERT INTO manifestBlocks (manifestRefId, schemaBlockRefId, position, description, producedByRecipeName) VALUES (?, ?, ?, ?, ?)');
		const recordRowOf = (oneRecord) => ['refId', 'name', 'description', 'recipeName', 'recipeHash', 'recipeFileName', 'basedOnManifestRefId', 'createdAt'].reduce((soFar, fieldName) => ({ ...soFar, [fieldName]: oneRecord[fieldName] === undefined ? null : oneRecord[fieldName] }), {});
		exportConnection.exec('BEGIN IMMEDIATE');
		publishedManifest.ancestorRecordList.slice().reverse().forEach((oneRecord) => manifestStatement.run(recordRowOf(oneRecord)));
		manifestStatement.run(recordRowOf({ ...publishedManifest.manifestRecord, refId: publishedManifest.manifestRefId }));
		publishedManifest.memberList.forEach((oneMember) => memberStatement.run(publishedManifest.manifestRefId, oneMember.schemaBlockRefId, oneMember.position, oneMember.memberDescription, oneMember.producedByRecipeName));
		exportConnection.exec('COMMIT');
		exportConnection.close();
		next('', args);
	});
	// read back through the store module: the manifest exists and holds every member, so -replay will find what was published
	taskList.push((args, next) =>
		args.standardsDatabase.getManifest({ refId: publishedManifest.manifestRefId }, (readError, manifestRow) => {
			if (readError || !manifestRow || (manifestRow.members || []).length !== publishedManifest.memberList.length) {
				next(readError || `the export store does not answer manifest ${publishedManifest.manifestRefId} with its ${publishedManifest.memberList.length} members`, args);
				return;
			}
			next('', { ...args, savedManifest: { refId: manifestRow.refId } });
		}),
	);
	taskList.push((args, next) => {
		const vectorStore = vectorStoreModule({});
		vectorStore.init({ dbPath: exportStoreFilePath }, (initError) => next(initError, { ...args, vectorStore }));
	});
	taskList.push((args, next) => {
		const vectorIdList = [...new Set(publishedManifest.memberList.reduce((soFar, oneMember) => soFar.concat(uriContractLib.embeddingRefListOf(uriContract.schemaBlockFor(oneMember.schemaBlockRefId).schemaBlock.text)), []))];
		const putNext = (vectorIndex) => {
			if (vectorIndex >= vectorIdList.length) {
				next('', { ...args, exportedVectorCount: vectorIdList.length });
				return;
			}
			const read = uriContract.frozenVectorFor(vectorIdList[vectorIndex]);
			if (read.error || read.frozenVector === null) {
				next(read.error || `vector ${vectorIdList[vectorIndex]} is not in uriContract`, args);
				return;
			}
			const { frozenVector } = read;
			const embeddingRefGrammar = contentAddress.vectorIdForInput({ modelVersion: frozenVector.modelVersion, embeddingDims: frozenVector.dims, inputText: frozenVector.inputText }) === frozenVector.vectorId ? 2 : 1;
			// setImmediate: the store answers synchronously, and 213,773 nested callbacks overflow the stack (found by the first export of goldWave3)
			args.vectorStore.putVector({ modelVersion: frozenVector.modelVersion, inputText: frozenVector.inputText, vector: frozenVector.vector, embeddingRefGrammar }, (putError) => (putError ? next(putError, args) : setImmediate(() => putNext(vectorIndex + 1))));
		};
		putNext(0);
	});
	pipeRunner(taskList.getList(), {}, (pipeError, args) => callback(pipeError, pipeError ? undefined : { standardsDatabase: args.standardsDatabase, exportedManifestRefId: args.savedManifest && args.savedManifest.refId, exportedVectorCount: args.exportedVectorCount }));
};

const replayOldestAction = ({ buildLib }) => (callback) => {
	const { xLog, commandLineParameters, getConfig } = process.global;
	const actionName = '-replayOldest';
	const resolved = resolveUriContractFilePath({ commandLineParameters, storesConfig: getConfig('stores'), actionName });
	if (resolved.error) {
		callback(resolved.error);
		return;
	}
	const liveText = firstValue(commandLineParameters, 'live');
	if (liveText !== undefined && liveText !== 'true') {
		callback(`graphBuilder ${actionName}: --live must be 'true' when given (got '${liveText}')`);
		return;
	}
	const exportStoreFilePath = firstValue(commandLineParameters, 'exportStoreFilePath');
	if (liveText === 'true' && (!isNonEmptyString(exportStoreFilePath) || fs.existsSync(exportStoreFilePath))) {
		callback(`graphBuilder ${actionName} --live=true: --exportStoreFilePath=<a NEW scratch store path> is REQUIRED and must not exist (got ${JSON.stringify(exportStoreFilePath)}); the live replay reads only what is exported there from uriContract`);
		return;
	}
	const opened = uriContractLib.openUriContractFile({ uriContractFilePath: resolved.filePath, accessMode: 'read' });
	if (opened.error) {
		callback(`graphBuilder ${actionName}: ${opened.error}`);
		return;
	}
	const { uriContract } = opened;
	const manifestList = uriContract.publishedManifestList();
	if (manifestList.length === 0) {
		uriContract.close();
		callback(`graphBuilder ${actionName}: REFUSED — ${resolved.filePath} holds no published manifest; there is nothing to replay`);
		return;
	}
	const read = uriContract.publishedManifestFor({ manifestRefId: manifestList[0].manifestRefId });
	if (read.error) {
		uriContract.close();
		callback(`graphBuilder ${actionName}: ${read.error}`);
		return;
	}
	const { publishedManifest } = read;
	let blockFault = '';
	const counted = replayCountLib.hermeticReplayCountFor({
		memberCount: publishedManifest.memberList.length,
		blockTextAt: (position) => {
			const blockRead = uriContract.schemaBlockFor(publishedManifest.memberList[position].schemaBlockRefId);
			blockFault = blockFault || blockRead.error || (blockRead.schemaBlock === null ? `member ${position} is absent` : '');
			return blockRead.schemaBlock === null || blockRead.error ? '' : blockRead.schemaBlock.text;
		},
	});
	const hermetic = { nodeCount: counted.nodeCount, edgeCount: counted.edgeCount, danglingEdgeCount: counted.danglingEdgeCount };
	const recorded = { nodeCount: publishedManifest.recordedNodeCount, edgeCount: publishedManifest.recordedEdgeCount };
	const hermeticFault = blockFault || counted.error || (hermetic.nodeCount !== recorded.nodeCount || hermetic.edgeCount !== recorded.edgeCount ? `the hermetic replay gives ${hermetic.nodeCount} nodes / ${hermetic.edgeCount} edges; ${publishedManifest.publicLabel} was published with ${recorded.nodeCount} / ${recorded.edgeCount}` : '');
	const reportBase = { oldestManifest: { manifestRefId: publishedManifest.manifestRefId, publicLabel: publishedManifest.publicLabel, publishedAt: publishedManifest.publishedAt }, recorded, hermetic };
	if (hermeticFault) {
		uriContract.close();
		callback(`graphBuilder ${actionName}: REFUSED — ${hermeticFault}. replayManager must read every schema block format it has ever written (uriContract README_AI rule 7).`);
		return;
	}
	xLog.status(`graphBuilder: [replayOldest] hermetic ${hermetic.nodeCount} nodes / ${hermetic.edgeCount} edges = recorded, for ${publishedManifest.publicLabel}`);
	if (liveText !== 'true') {
		uriContract.close();
		callback('', { exitCode: 0, resultText: JSON.stringify({ ...reportBase, verdict: 'hermetic count equals recorded' }, null, 2) });
		return;
	}
	exportManifestStore({ uriContract, publishedManifest, exportStoreFilePath }, (exportError, exported) => {
		uriContract.close();
		if (exportError) {
			callback(`graphBuilder ${actionName} --live: exporting ${publishedManifest.publicLabel} from uriContract: ${exportError}`);
			return;
		}
		if (exported.exportedManifestRefId !== publishedManifest.manifestRefId) {
			callback(`graphBuilder ${actionName} --live: the exported store addressed the manifest as ${exported.exportedManifestRefId}, not ${publishedManifest.manifestRefId}`);
			return;
		}
		buildLib.replay({ manifestRefId: publishedManifest.manifestRefId }, { xLog, standardsDatabase: exported.standardsDatabase }, (replayError, replayResult) => {
			if (replayError) {
				callback(`graphBuilder ${actionName} --live: the replay from uriContract alone failed: ${replayError}`);
				return;
			}
			callback('', { exitCode: 0, resultText: JSON.stringify({ ...reportBase, live: { exportStoreFilePath, exportedVectorCount: exported.exportedVectorCount, replayResult }, verdict: 'hermetic count equals recorded; compare live.replayResult conservation with them' }, null, 2) });
		});
	});
};

// ---------------------------------------------------------------------
// -rebuildUriContractIndexes [--verifyOnly=true]
// ---------------------------------------------------------------------
const rebuildUriContractIndexesAction = () => (callback) => {
	const { xLog, commandLineParameters, getConfig } = process.global;
	const actionName = '-rebuildUriContractIndexes';
	const resolved = resolveUriContractFilePath({ commandLineParameters, storesConfig: getConfig('stores'), actionName });
	if (resolved.error) {
		callback(resolved.error);
		return;
	}
	const verifyOnlyText = firstValue(commandLineParameters, 'verifyOnly');
	if (verifyOnlyText !== undefined && verifyOnlyText !== 'true') {
		callback(`graphBuilder ${actionName}: --verifyOnly must be 'true' when given (got '${verifyOnlyText}')`);
		return;
	}
	const opened = uriContractLib.openUriContractFile({ uriContractFilePath: resolved.filePath, accessMode: verifyOnlyText === 'true' ? 'read' : 'publish', writerActionName: verifyOnlyText === 'true' ? undefined : 'rebuildUriContractIndexes' });
	if (opened.error) {
		callback(`graphBuilder ${actionName}: ${opened.error}`);
		return;
	}
	const outcome = verifyOnlyText === 'true' ? opened.uriContract.verifyDerivedIndexes() : opened.uriContract.fillAbsentDerivedIndexes();
	opened.uriContract.close();
	if (outcome.error || outcome.differenceList.length) {
		callback(`graphBuilder ${actionName}: ${outcome.error || `REFUSED — ${outcome.differenceList.join('; ')}`}`);
		return;
	}
	xLog.status(`graphBuilder: [rebuildUriContractIndexes] ${JSON.stringify(outcome)}`);
	callback('', { exitCode: 0, resultText: JSON.stringify({ uriContractFilePath: resolved.filePath, ...outcome }, null, 2) });
};

module.exports = { resolveUriContractFilePath, readJsonParameterFile, uriContractForPublishAction, appendPublishedVersion, seedUriContractFromRegistryJsonAction, publishManifestAction, appendManifestStatusAction, replayOldestAction, rebuildUriContractIndexesAction, exportManifestStore };
