#!/usr/bin/env node
'use strict';

// test-uriContract.js — gates for lib/uri-contract (ML3.1 Part B; WORKORDER-ML3.1 section 5 "uriContract"). Every gate is built on
// a small STATED world in a temp directory (never the real uriContract, never a production registry spread into a fixture), and every
// refusal is OBSERVED firing on a fixture that states its fault:
//   * the module has NO UPDATE / DELETE path (static scan of lib/uri-contract, with a planted twin), and the file itself refuses
//     an UPDATE or DELETE on every one of the eight tables (the write-once triggers), and a file without them is refused at open;
//   * verify-on-read catches a corrupted decision schema block, schema block and manifest membership;
//   * identity rows are written once (identical = alreadyPresent, different = refused); unknown fields are refused, never dropped;
//   * the tables never hold a registry lib/layer-registry refuses; the seed and the row-for-row agreement, with a red twin;
//   * publishManifest's refusals (hash, closure, reserved label, label reuse) and its idempotence;
//   * the hermetic replay count, its dangling edge, and its refusal of an unreadable block.
//
// Run: node lib/uri-contract/test/test-uriContract.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for lib/uri-contract (the write-once uriContract store)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Builds temp uriContract files from a stated fixture world and proves: no UPDATE or DELETE path in the module and none
     possible in the file; verify-on-read; insert-once identity rows; closed field lists; registry validation on every append;
     the JSON seed and its row-for-row agreement; publishManifest's refusals; the hermetic replay count. No docker, no spend.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const uriContractLib = require('../uriContract');
const registrySeedLib = require('../registrySeed');
const replayCountLib = require('../replayCount');
const { contentIdForMemberBlockList } = require('../../layer-registry/layerRegistry');
const replayBlock = require('../../replay/replay-block')();
const contentAddress = require('../../content-address/content-address')();
const Database = require('../../../node_modules/better-sqlite3');

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const scratchDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'test-uriContract-'));
let scratchFileIndex = 0;
const freshPath = () => path.join(scratchDirPath, `uriContract-${(scratchFileIndex += 1)}.sqlite`);
const createContract = () => {
	const uriContractFilePath = freshPath();
	return { ...uriContractLib.openUriContractFile({ uriContractFilePath, accessMode: 'create', writerActionName: 'seedUriContractFromRegistryJson' }), uriContractFilePath };
};
// sameValue — harness.equal is strict (===); a value with structure is compared by its JSON text
const sameValue = (label, actual, expected) => harness.equal(label, JSON.stringify(actual), JSON.stringify(expected));

// ---------------------------------------------------------------------
// THE STATED WORLD: two agents, a curated layer (one set, two pair blocks) and a judge layer (two member blocks), one status change
// ---------------------------------------------------------------------
const ORGANISATION_IRI = 'https://w3id.org/EDUcore/agent/org/educore';
const PERSON_IRI = 'https://w3id.org/EDUcore/agent/u-0005';
const JUDGE_IRI = 'https://w3id.org/EDUcore/agent/judge/jev:toy:cfg-000000000001';
const agentRegistry = {
	about: 'stated fixture',
	agentList: [
		{ agentIri: ORGANISATION_IRI, agentKind: 'organisation', displayName: 'EDUcore', note: 'the registration authority' },
		{ agentIri: PERSON_IRI, agentKind: 'person', displayName: 'rater 05, survey A' },
		{ agentIri: JUDGE_IRI, agentKind: 'judge', displayName: 'a toy judge' },
	],
};
const blockTextByHash = {};
const frozen = (text) => {
	blockTextByHash[sha256Hex(text)] = text;
	return sha256Hex(text);
};
const curatedSetText = '#curie_map:\n#  toy: urn:toy:\nsubject_id\tpredicate_id\tobject_id\ntoy:a\tskos:exactMatch\thub:x\n';
const curatedPairText = `${curatedSetText}#pair\n`;
const judgedMemberTextList = ['{"header":{"toy":1},"decisionRecordList":[]}', '{"header":{"toy":2},"decisionRecordList":[]}'];
const judgedMemberBlockList = judgedMemberTextList.map((frozenText, memberIndex) => ({ pairKey: `toyhub@1::toy${memberIndex}@1::toyBridge::inferred`, decisionBlockHash: frozen(frozenText) }));
const layerRegistryFor = () => ({
	about: 'stated fixture',
	registrationAuthorityIri: ORGANISATION_IRI,
	registrarIri: ORGANISATION_IRI,
	layerList: [
		{
			layerKey: 'toyCurated',
			displayName: 'a toy curator',
			layerKind: 'curated',
			authorAgentIri: PERSON_IRI,
			standardList: [{ standardKey: 'toy', standardName: 'Toy', sourceIri: 'urn:educore:toy:' }],
			hubList: [{ hubKey: 'toyhub', hubName: 'ToyHub', sourceIri: 'urn:educore:hub:ToyHub:' }],
			versionList: [
				{
					administrationRecord: { registrationAuthority: ORGANISATION_IRI, registrar: ORGANISATION_IRI, submitter: PERSON_IRI, publishedAt: '2026-10-01T00:00:00Z', contentId: frozen(curatedSetText), versionTag: 'r1' },
					registrationStatus: 'Candidate',
					authorAgentIri: PERSON_IRI,
					contentIdBasis: 'frozenSetBytes',
					wholeSetBlock: { pairKey: 'layerSet::toyCurated', decisionBlockHash: frozen(curatedSetText) },
					memberBlockList: [{ pairKey: 'toyhub@1::toy@1::layer.toyCurated::curated', decisionBlockHash: frozen(curatedPairText) }],
					sssomPath: '/nowhere/toy.sssom.tsv',
				},
			],
			statusChangeList: [],
		},
		{
			layerKey: 'toyJudge',
			displayName: 'a toy judge layer',
			layerKind: 'judge',
			authorAgentIri: ORGANISATION_IRI,
			standardList: [{ standardKey: 'toy0', standardName: 'Toy0', sourceIri: 'urn:educore:toy0:' }],
			hubList: [{ hubKey: 'toyhub', hubName: 'ToyHub', sourceIri: 'urn:educore:hub:ToyHub:' }],
			versionList: [
				{
					administrationRecord: { registrationAuthority: ORGANISATION_IRI, registrar: ORGANISATION_IRI, submitter: ORGANISATION_IRI, publishedAt: '2026-10-02T00:00:00Z', contentId: contentIdForMemberBlockList(judgedMemberBlockList.slice(0, 1)), versionTag: 'base' },
					registrationStatus: 'Standard',
					authorAgentIri: JUDGE_IRI,
					contentIdBasis: 'sortedMemberBlockHashList',
					memberBlockList: judgedMemberBlockList.slice(0, 1),
					note: 'the first judge version',
				},
				{
					administrationRecord: { registrationAuthority: ORGANISATION_IRI, registrar: ORGANISATION_IRI, submitter: ORGANISATION_IRI, publishedAt: '2026-10-03T00:00:00Z', contentId: contentIdForMemberBlockList(judgedMemberBlockList), versionTag: 'wave1' },
					registrationStatus: 'Standard',
					authorAgentIri: JUDGE_IRI,
					contentIdBasis: 'sortedMemberBlockHashList',
					memberBlockList: judgedMemberBlockList,
					scoreList: [{ againstLayerVersion: 'https://w3id.org/EDUcore/layer/toyCurated/r1', metric: 'agreement', value: 0.5, coverage: 2, reportPath: 'toy/report.json' }],
				},
			],
			statusChangeList: [{ versionTag: 'base', registrationStatus: 'Superseded', changedAt: '2026-10-04T00:00:00Z', changedBy: ORGANISATION_IRI, supersededByVersionTag: 'wave1', note: 'wave1 replaces base' }],
		},
	],
});
const decisionBlockTextFor = (decisionBlockHash) => ({ frozenText: blockTextByHash[decisionBlockHash] === undefined ? null : blockTextByHash[decisionBlockHash] });
const seededContract = () => {
	const created = createContract();
	const seeded = registrySeedLib.seedFromRegistry({ uriContract: created.uriContract, layerRegistry: layerRegistryFor(), agentRegistry, decisionBlockTextFor });
	return { ...created, seeded };
};
// rawHandleFor(filePath) → a raw connection, for planting faults the module itself can never make
const rawHandleFor = (filePath) => new Database(filePath, { fileMustExist: true });

// the manifest fixture: two standardBase blocks, the second requiring the first, sharing one edge and carrying one dangling edge
const headerFor = (standardKey) => ({ blockType: 'standardBase', standardKey, version: '1', stableUriPropertyName: 'stableId', resolutionKey: 'stableId' });
const nodeFor = (stableId) => ({ ref: { source: 'Toy', id: stableId }, labels: ['ForgedNode', 'ToyNode'], stableId, properties: { name: [stableId], parentId: ['toy:root'], ...(stableId === 'toy:a' ? { definition: ['the toy a'] } : {}) } });
const edgeFor = (fromStableId, toStableId) => ({ type: 'HAS_PART', fromRef: { source: 'Toy', id: fromStableId }, toRef: { source: 'Toy', id: toStableId }, properties: { provenanceTier: ['structural'] } });
// one frozen vector, referenced by toy:b's embeddingRef (a 2-dim float32 vector, its id by the grammar-2 recipe)
const toyVectorBuffer = Buffer.alloc(8);
toyVectorBuffer.writeFloatLE(0.25, 0);
toyVectorBuffer.writeFloatLE(-0.5, 4);
const toyVector = { modelVersion: 'toy-model', dims: 2, dtype: 'float32', inputText: 'toy b text', vector: toyVectorBuffer, vectorHash: contentAddress.vectorHashForBytes(toyVectorBuffer) };
toyVector.vectorId = contentAddress.vectorIdForInput({ modelVersion: toyVector.modelVersion, embeddingDims: toyVector.dims, inputText: toyVector.inputText });
const baseText = replayBlock.serializeBlock({ header: headerFor('toy'), nodes: [nodeFor('toy:a'), { ...nodeFor('toy:b'), embeddingRef: toyVector.vectorId, embeddingModelVersion: 'toy-model' }], edges: [edgeFor('toy:a', 'toy:b')] });
const secondText = replayBlock.serializeBlock({ header: headerFor('toy2'), nodes: [nodeFor('toy:c'), nodeFor('toy:a')], edges: [edgeFor('toy:c', 'toy:a'), edgeFor('toy:a', 'toy:b'), edgeFor('toy:c', 'toy:nowhere')] });
// a relationship block: toy:a EXACT_MATCH one ToyHub meaning card, materialised from judgedMemberBlockList[0]'s decision block
const TOY_MEANING_IRI = `https://w3id.org/EDUcore/ToyHub/hub/1.0/${'a'.repeat(64)}`;
const relationshipText = replayBlock.serializeBlock({
	header: { blockType: 'relationship', pairA: 'toyhub', pairAVersion: '1.0', pairB: 'toy', pairBVersion: '1', producer: 'inferred' },
	nodes: [{ ref: { source: 'ToyHub', id: TOY_MEANING_IRI }, labels: ['ForgedNode', 'HubReference'], stableId: TOY_MEANING_IRI, properties: { name: ['a toy meaning'] } }],
	edges: [{ type: 'EXACT_MATCH', fromRef: { source: 'Toy', id: 'toy:a' }, toRef: { source: 'ToyHub', id: TOY_MEANING_IRI }, properties: { mappingKind: ['inferred'], decisionBlockHash: [judgedMemberBlockList[0].decisionBlockHash] } }],
});
const schemaBlockFor = (text, requires) => ({ refId: sha256Hex(text), kind: 'standardBase', subject: 'toy@1_base', version: '1', requires, text, producedBy: 'fixture' });
const memberList = [
	{ position: 0, schemaBlock: schemaBlockFor(baseText, []) },
	{ position: 1, schemaBlock: schemaBlockFor(secondText, [sha256Hex(baseText)]) },
	{ position: 2, schemaBlock: { ...schemaBlockFor(relationshipText, [sha256Hex(baseText)]), kind: 'relationship', subject: 'toyhub@1_0_rel_toy@1_exact' } },
];
const manifestRefId = contentAddress.manifestKeyForMembership(memberList.map((oneMember) => ({ blockId: oneMember.schemaBlock.refId, position: oneMember.position })));
const publishArgs = { manifestRefId, publicLabel: 'educore-2026-10', memberList, frozenVectorList: [toyVector], decisionSchemaBlockList: [], defaultLayerByHub: null, recordedNodeCount: 3, recordedEdgeCount: 2, publishedAt: '2026-10-26T00:00:00Z', publishedByAgentIri: ORGANISATION_IRI, registrationStatus: 'Candidate', registrationAuthority: ORGANISATION_IRI };
// =====================================================================
harness.section('NO UPDATE OR DELETE PATH: the module source (static) and the file (the write-once triggers)');
// =====================================================================

const FORBIDDEN_SQL_PATTERN_LIST = [/\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i, /\bINSERT\s+OR\s+REPLACE\b/i, /\bREPLACE\s+INTO\b/i, /\bDROP\s+(TABLE|TRIGGER|INDEX)\b/i, /\bVACUUM\b/i, /\bON\s+CONFLICT\b[^;]*\bDO\s+UPDATE\b/i];
const forbiddenSqlIn = (sourceText) => FORBIDDEN_SQL_PATTERN_LIST.filter((onePattern) => onePattern.test(sourceText)).map(String);
const moduleSourceList = fs.readdirSync(path.join(__dirname, '..')).filter((fileName) => fileName.endsWith('.js')).map((fileName) => ({ fileName, sourceText: fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8') }));
harness.ok('lib/uri-contract has source files to scan (the scan is not vacuous)', moduleSourceList.length >= 3, moduleSourceList.map((oneFile) => oneFile.fileName).join(', '));
moduleSourceList.forEach(({ fileName, sourceText }) => sameValue(`${fileName} carries no UPDATE / DELETE / REPLACE / DROP / VACUUM statement`, forbiddenSqlIn(sourceText), []));
harness.ok('TWIN: the scan goes red on a planted DELETE FROM', forbiddenSqlIn(`${moduleSourceList[0].sourceText}\nconst plant = 'DELETE FROM agents WHERE 1';`).length === 1);
harness.ok('TWIN: the scan goes red on a planted UPDATE ... SET', forbiddenSqlIn("db.prepare('UPDATE layerVersions SET note = ?')").length === 1);

const writeOnce = seededContract();
harness.ok('the stated world seeds', writeOnce.seeded.error === undefined, writeOnce.seeded.error);
const writeOncePath = writeOnce.uriContractFilePath;
harness.ok('…and a manifest publishes into it, so every table holds a row to refuse editing', writeOnce.uriContract.publishManifest(publishArgs).alreadyPresent === false);
writeOnce.uriContract.close();
const plantedHandle = rawHandleFor(writeOncePath);
uriContractLib.URI_CONTRACT_SCHEMA.tableList.forEach((oneTable) => {
	const firstColumn = oneTable.columnList[0].columnName;
	const updateFault = (() => {
		try {
			plantedHandle.prepare(`UPDATE ${oneTable.tableName} SET ${firstColumn} = ${firstColumn}`).run();
			return '';
		} catch (sqlError) {
			return sqlError.message;
		}
	})();
	const deleteFault = (() => {
		try {
			plantedHandle.prepare(`DELETE FROM ${oneTable.tableName}`).run();
			return '';
		} catch (sqlError) {
			return sqlError.message;
		}
	})();
	harness.match(`raw UPDATE of ${oneTable.tableName} is aborted by the file itself`, updateFault, /uriContract is write-once/);
	harness.match(`raw DELETE from ${oneTable.tableName} is aborted by the file itself`, deleteFault, /uriContract is write-once/);
});
const rowCountAfterPlanting = plantedHandle.prepare('SELECT COUNT(*) AS rowCount FROM layerVersions').get().rowCount;
harness.equal('…and the rows are all still there (3 layer versions)', rowCountAfterPlanting, 3);
plantedHandle.exec('DROP TRIGGER agentsNoUpdate');
plantedHandle.close();
harness.match('TWIN: a file whose write-once trigger was dropped is refused at open', uriContractLib.openUriContractFile({ uriContractFilePath: writeOncePath, accessMode: 'read' }).error, /write-once triggers agentsNoUpdate are absent/);

// =====================================================================
harness.section('ACCESS: no default path, no cold store, no overwrite, writers only for the publish actions');
// =====================================================================

harness.match('a missing path is refused (there is no default uriContract)', uriContractLib.openUriContractFile({ accessMode: 'read' }).error, /uriContractFilePath and an accessMode .* are required/);
harness.match('read of an absent file is refused (never a cold store)', uriContractLib.openUriContractFile({ uriContractFilePath: path.join(scratchDirPath, 'absent.sqlite'), accessMode: 'read' }).error, /does not exist/);
harness.ok('…and nothing was created', !fs.existsSync(path.join(scratchDirPath, 'absent.sqlite')));
harness.match('publish of an absent file is refused', uriContractLib.openUriContractFile({ uriContractFilePath: path.join(scratchDirPath, 'absent.sqlite'), accessMode: 'publish', writerActionName: 'publishLayer' }).error, /does not exist/);
const existingPath = writeOncePath;
harness.match('create over an existing file is refused', uriContractLib.openUriContractFile({ uriContractFilePath: existingPath, accessMode: 'create', writerActionName: 'seedUriContractFromRegistryJson' }).error, /already exists/);
harness.match('a writing mode without a publish action is refused', uriContractLib.openUriContractFile({ uriContractFilePath: freshPath(), accessMode: 'create', writerActionName: 'build' }).error, /for the publish actions only/);
harness.match('publishLayer may not CREATE a uriContract', uriContractLib.openUriContractFile({ uriContractFilePath: freshPath(), accessMode: 'create', writerActionName: 'publishLayer' }).error, /may not create a uriContract/);
const foreignPath = freshPath();
const foreignHandle = new Database(foreignPath);
foreignHandle.exec('CREATE TABLE blocks (refId TEXT)');
foreignHandle.close();
harness.match('a file that is not a uriContract is refused at open', uriContractLib.openUriContractFile({ uriContractFilePath: foreignPath, accessMode: 'read' }).error, /tables are not uriContract's/);

// =====================================================================
harness.section('THE SEED and THE ROW-FOR-ROW AGREEMENT (the tables equal the registry they came from)');
// =====================================================================

const seededWorld = seededContract();
sameValue('the seed reports every row (4 distinct decision schema blocks: the curated set, its pair block, two judged members)', seededWorld.seeded.seedReport, { agentCount: 3, layerCount: 2, versionCount: 3, statusChangeCount: 1, decisionSchemaBlockCount: 4, alreadyPresentCount: 0 });
const agreement = registrySeedLib.registryAgreement({ uriContract: seededWorld.uriContract, layerRegistry: layerRegistryFor(), agentRegistry });
harness.ok('the registry rebuilt from the tables equals the JSON, row for row', agreement.agree, agreement.differenceList.join('; '));
const shiftedRegistry = layerRegistryFor();
shiftedRegistry.layerList[1].versionList[0].note = 'a different note';
const disagreement = registrySeedLib.registryAgreement({ uriContract: seededWorld.uriContract, layerRegistry: shiftedRegistry, agentRegistry });
harness.ok('TWIN: one changed note in the JSON makes the agreement red, naming the version', !disagreement.agree && disagreement.differenceList.indexOf('layer toyJudge version base') !== -1, disagreement.differenceList.join('; '));
const loadedFromTables = seededWorld.uriContract.loadRegistry();
harness.ok('the tables load through lib/layer-registry registryFor', loadedFromTables.error === undefined, loadedFromTables.error);
harness.equal('the effective status after the appended change is Superseded', loadedFromTables.registry.effectiveStatusFor({ layerKey: 'toyJudge', versionTag: 'base' }).registrationStatus, 'Superseded');
harness.equal('a floating layer follows its Standard version', loadedFromTables.registry.currentStandardVersionFor('toyJudge').version.administrationRecord.versionTag, 'wave1');
harness.equal('the score list is carried by the publication status row and comes back on the version', loadedFromTables.registry.versionFor({ layerKey: 'toyJudge', versionTag: 'wave1' }).version.scoreList.length, 1);
const reseeded = registrySeedLib.seedFromRegistry({ uriContract: seededWorld.uriContract, layerRegistry: (() => ({ ...layerRegistryFor(), layerList: layerRegistryFor().layerList.map((oneLayer) => ({ ...oneLayer, statusChangeList: [] })) }))(), agentRegistry, decisionBlockTextFor });
harness.equal('re-seeding identical identity rows answers alreadyPresent for every agent and version', reseeded.seedReport && reseeded.seedReport.alreadyPresentCount, 6);
const unknownTopRegistry = { ...layerRegistryFor(), stray: true };
harness.match('a registry top field uriContract cannot hold is refused', registrySeedLib.seedFromRegistry({ uriContract: createContract().uriContract, layerRegistry: unknownTopRegistry, agentRegistry, decisionBlockTextFor }).error, /top field 'stray'/);
harness.match('a decision block the support store lacks is refused, naming the version', registrySeedLib.seedFromRegistry({ uriContract: createContract().uriContract, layerRegistry: layerRegistryFor(), agentRegistry, decisionBlockTextFor: () => ({ frozenText: null }) }).error, /layer 'toyCurated' version 'r1': decision block .* is not in the support store/);

// =====================================================================
harness.section('INSERT-ONCE IDENTITY, CLOSED FIELDS, AND THE REGISTRY CHECK ON EVERY APPEND');
// =====================================================================

const { uriContract } = seededWorld;
sameValue('an identical agent answers alreadyPresent', uriContract.appendAgent(agentRegistry.agentList[1]), { alreadyPresent: true });
harness.match('the same agentIri with a different displayName is refused', uriContract.appendAgent({ ...agentRegistry.agentList[1], displayName: 'renamed' }).error, /already holds .* with different content/);
harness.match('an agent field uriContract cannot store is refused, never dropped', uriContract.appendAgent({ ...agentRegistry.agentList[1], orcid: 'x' }).error, /carries the field 'orcid'/);
harness.match('a person may not carry a homepage (pseudonymous: a role and aliases)', uriContract.appendAgent({ agentIri: 'https://w3id.org/EDUcore/agent/u-0099', agentKind: 'person', displayName: 'rater 99', homepageIri: 'https://example.org/me' }).error, /carries the field 'homepageIri'/);
harness.match('a person may not carry a judge configuration', uriContract.appendAgent({ agentIri: 'https://w3id.org/EDUcore/agent/u-0099', agentKind: 'person', displayName: 'rater 99', judgeConfiguration: {} }).error, /carries the field 'judgeConfiguration'/);
harness.match('a person whose text carries an e-mail address is refused', uriContract.appendAgent({ agentIri: 'https://w3id.org/EDUcore/agent/u-0099', agentKind: 'person', displayName: 'rater 99', note: 'reach me at someone@example.org' }).error, /carries an e-mail address/);
const fullJudge = { agentIri: 'https://w3id.org/EDUcore/agent/judge/jev:toy:cfg-000000000002', agentKind: 'judge', displayName: 'a configured toy judge', description: 'a judge', homepageIri: 'https://example.org/jev', aliasIriList: ['https://example.org/alias'], judgeConfiguration: { model: 'toy', hitsPerText: 40 } };
sameValue('a judge with a description, homepage, aliases and configuration appends', uriContract.appendAgent(fullJudge), { alreadyPresent: false });
sameValue('…and reads back field for field', uriContract.registryShape().agentRegistry.agentList.find((oneAgent) => oneAgent.agentIri === fullJudge.agentIri), fullJudge);
const judgeLayer = layerRegistryFor().layerList[1];
const thirdBlockText = '{"header":{"toy":3},"decisionRecordList":[]}';
const thirdMemberBlockList = judgedMemberBlockList.concat([{ pairKey: 'toyhub@1::toy2@1::toyBridge::inferred', decisionBlockHash: sha256Hex(thirdBlockText) }]);
const waveTwo = {
	administrationRecord: { registrationAuthority: ORGANISATION_IRI, registrar: ORGANISATION_IRI, submitter: ORGANISATION_IRI, publishedAt: '2026-10-05T00:00:00Z', contentId: contentIdForMemberBlockList(thirdMemberBlockList), versionTag: 'wave2' },
	registrationStatus: 'Candidate',
	authorAgentIri: JUDGE_IRI,
	contentIdBasis: 'sortedMemberBlockHashList',
	memberBlockList: thirdMemberBlockList,
};
harness.match('a version naming a decision block neither offered nor held is refused', uriContract.appendLayerVersion({ layer: judgeLayer, version: waveTwo, decisionSchemaBlockList: [] }).error, /names decision schema block .* which is neither offered nor held/);
harness.match('a version field uriContract cannot store is refused', uriContract.appendLayerVersion({ layer: judgeLayer, version: { ...waveTwo, stray: 1 }, decisionSchemaBlockList: [] }).error, /carries the field 'stray'/);
harness.match('a version the registry refuses (unknown author) is refused before anything is written', uriContract.appendLayerVersion({ layer: judgeLayer, version: { ...waveTwo, authorAgentIri: 'https://w3id.org/EDUcore/agent/nobody' }, decisionSchemaBlockList: [{ pairKey: 'toyhub@1::toy2@1::toyBridge::inferred', producerKind: 'inferred', frozenText: thirdBlockText }] }).error, /is not in the agent registry/);
harness.equal('…and the refused append wrote no decision schema block', uriContract.decisionSchemaBlockTextFor(sha256Hex(thirdBlockText)).frozenText, null);
sameValue('a valid version with its new block appends', uriContract.appendLayerVersion({ layer: judgeLayer, version: waveTwo, decisionSchemaBlockList: [{ pairKey: 'toyhub@1::toy2@1::toyBridge::inferred', producerKind: 'inferred', frozenText: thirdBlockText }] }), { alreadyPresent: false });
harness.match('the same tag with other content is refused (a tag is never reassigned)', uriContract.appendLayerVersion({ layer: judgeLayer, version: { ...waveTwo, note: 'changed' }, decisionSchemaBlockList: [] }).error, /REASSIGNED|already holds .* with different content/);
harness.match('a status change the registry refuses (successor not a version) is refused', uriContract.appendLayerStatusChange({ layerKey: 'toyJudge', statusChange: { versionTag: 'wave1', registrationStatus: 'Superseded', changedAt: '2026-10-06T00:00:00Z', changedBy: ORGANISATION_IRI, supersededByVersionTag: 'wave9' } }).error, /names its successor/);
harness.ok('a valid status change appends as a new history row', Number.isInteger(uriContract.appendLayerStatusChange({ layerKey: 'toyJudge', statusChange: { versionTag: 'wave1', registrationStatus: 'Superseded', changedAt: '2026-10-06T00:00:00Z', changedBy: ORGANISATION_IRI, supersededByVersionTag: 'wave2' } }).rowId));
harness.equal('…and the version row keeps the status it was published with', uriContract.loadRegistry().registry.versionFor({ layerKey: 'toyJudge', versionTag: 'wave1' }).version.registrationStatus, 'Standard');
const readOnly = uriContractLib.openUriContractFile({ uriContractFilePath: seededWorld.uriContractFilePath, accessMode: 'read' });
harness.ok('a read-mode uriContract offers no writer at all', readOnly.uriContract && readOnly.uriContract.appendAgent === undefined && readOnly.uriContract.publishManifest === undefined && readOnly.uriContract.appendLayerVersion === undefined);

// =====================================================================
harness.section('VERIFY ON READ: a corrupted row is refused, never served');
// =====================================================================

// plantCorruption(filePath, sqlText) — drop the triggers, corrupt one row, restore the triggers (the module can do none of this)
const plantCorruption = (filePath, sqlText, parameterList) => {
	const handle = rawHandleFor(filePath);
	uriContractLib.URI_CONTRACT_SCHEMA.tableList.forEach((oneTable) => ['Update', 'Delete'].forEach((operationWord) => handle.exec(`DROP TRIGGER IF EXISTS ${oneTable.tableName}No${operationWord}`)));
	handle.prepare(sqlText).run(...parameterList);
	uriContractLib.schemaSqlList().filter((oneStatement) => oneStatement.indexOf('CREATE TRIGGER') === 0).forEach((oneStatement) => handle.exec(oneStatement));
	handle.close();
};
const corruptedPath = seededWorld.uriContractFilePath;
readOnly.uriContract.close();
uriContract.close();
const curatedSetHash = sha256Hex(curatedSetText);
plantCorruption(corruptedPath, 'UPDATE decisionSchemaBlocks SET frozenText = ? WHERE decisionSchemaBlockHash = ?', [`${curatedSetText}tampered`, curatedSetHash]);
const reopened = uriContractLib.openUriContractFile({ uriContractFilePath: corruptedPath, accessMode: 'read' });
harness.match('a decision schema block whose text no longer hashes to its address is refused on read', reopened.uriContract.decisionSchemaBlockTextFor(curatedSetHash).error, /fails verify-on-read/);
harness.equal('…an intact block still reads', reopened.uriContract.decisionSchemaBlockTextFor(judgedMemberBlockList[0].decisionBlockHash).frozenText, judgedMemberTextList[0]);
reopened.uriContract.close();

// =====================================================================
harness.section('publishManifest: hash, closure, label, idempotence; a schema block and a membership verified on read');
// =====================================================================

const manifestWorld = seededContract();
harness.match('a manifest whose members do not hash to its refId is refused', manifestWorld.uriContract.publishManifest({ ...publishArgs, manifestRefId: 'f'.repeat(64) }).error, /its members hash to/);
harness.match('a member requiring a block the manifest does not list is refused (the closure is published whole)', manifestWorld.uriContract.publishManifest({ ...publishArgs, memberList: [memberList[1]], manifestRefId: contentAddress.manifestKeyForMembership([{ blockId: memberList[1].schemaBlock.refId, position: 1 }]) }).error, /requires .* which the manifest does not list/);
harness.match('the reserved label sha256 is refused', manifestWorld.uriContract.publishManifest({ ...publishArgs, publicLabel: 'sha256' }).error, /never a reserved word/);
harness.match('a publish without a registration status is refused (no default)', manifestWorld.uriContract.publishManifest({ ...publishArgs, registrationStatus: undefined }).error, /registrationStatus undefined is not/);
harness.match('a member whose text does not hash to its refId is refused', manifestWorld.uriContract.publishManifest({ ...publishArgs, memberList: [{ position: 0, schemaBlock: { ...memberList[0].schemaBlock, text: `${baseText} ` } }, memberList[1], memberList[2]] }).error, /its text does not hash to its refId/);
harness.match('a manifest offered without a vector its member references is refused', manifestWorld.uriContract.publishManifest({ ...publishArgs, frozenVectorList: [] }).error, /references vector .* which frozenVectorList does not carry/);
harness.match('a vector no member references is refused (ONLY what recreates)', manifestWorld.uriContract.publishManifest({ ...publishArgs, frozenVectorList: [toyVector, { ...toyVector, vectorId: 'e'.repeat(64) }] }).error, /which no member references/);
harness.match('a vector whose bytes do not hash to its vectorHash is refused before it is written', manifestWorld.uriContract.publishManifest({ ...publishArgs, frozenVectorList: [{ ...toyVector, vectorHash: 'd'.repeat(64) }] }).error, /payload: the vector bytes hash to/);
harness.match('a vector whose determinants do not hash to its vectorId is refused', manifestWorld.uriContract.publishManifest({ ...publishArgs, frozenVectorList: [{ ...toyVector, inputText: 'another text' }] }).error, /determinants: .* hash to/);
const bareWorld = createContract();
bareWorld.uriContract.appendAgent(agentRegistry.agentList[0]);
harness.match('an edge citing a decision schema block that is neither held nor offered is refused (assertion URIs must resolve)', bareWorld.uriContract.publishManifest({ ...publishArgs, decisionSchemaBlockList: [] }).error, /cites decision schema block .* which is neither held nor offered/);
sameValue('…and offering it publishes', bareWorld.uriContract.publishManifest({ ...publishArgs, decisionSchemaBlockList: [{ pairKey: judgedMemberBlockList[0].pairKey, producerKind: 'inferred', frozenText: judgedMemberTextList[0] }] }).alreadyPresent, false);
bareWorld.uriContract.close();
harness.match('a decision schema block no member edge cites is refused', manifestWorld.uriContract.publishManifest({ ...publishArgs, decisionSchemaBlockList: [{ pairKey: 'x::y::z::authored', producerKind: 'authored', frozenText: 'an uncited block' }] }).error, /which no member edge cites/);
const firstPublish = manifestWorld.uriContract.publishManifest(publishArgs);
harness.ok('the manifest publishes', firstPublish.error === undefined && firstPublish.alreadyPresent === false, firstPublish.error);
harness.equal('re-publishing the same manifest under the same label is alreadyPresent', manifestWorld.uriContract.publishManifest(publishArgs).alreadyPresent, true);
harness.match('the same label for another manifest is refused (a label is never reassigned)', manifestWorld.uriContract.publishManifest({ ...publishArgs, memberList: [memberList[0]], manifestRefId: contentAddress.manifestKeyForMembership([{ blockId: memberList[0].schemaBlock.refId, position: 0 }]) }).error, /already published/);
const readBack = manifestWorld.uriContract.publishedManifestFor({ publicLabel: 'educore-2026-10' });
sameValue('it reads back by label with its members, its status and its URIs', [readBack.publishedManifest.memberList.length, readBack.publishedManifest.effectiveRegistrationStatus, readBack.publishedManifest.uri, readBack.publishedManifest.uriByContent], [3, 'Candidate', 'https://w3id.org/EDUcore/manifest/educore-2026-10', `https://w3id.org/EDUcore/manifest/sha256/${manifestRefId}`]);
sameValue('the frozen vector reads back verified, decoded as getVector decodes it', manifestWorld.uriContract.frozenVectorFor(toyVector.vectorId).frozenVector.vector, [0.25, -0.5]);
harness.equal('…and by hash', manifestWorld.uriContract.publishedManifestFor({ manifestRefId }).publishedManifest.publicLabel, 'educore-2026-10');
const reader = uriContractLib.uriContractReaderFor({ uriContractFilePath: manifestWorld.uriContractFilePath });
// answerOf(readerFunction, argument) → { errorText, answer }: the reader is callback-style (lane A's interface) and answers synchronously
const answerOf = (readerFunction, argument) => {
	const captured = { errorText: 'no callback', answer: undefined };
	readerFunction(argument, (readError, answer) => {
		captured.errorText = readError;
		captured.answer = answer;
	});
	return captured;
};
sameValue('the uriContractReader lane A is injected with exposes exactly its sixteen functions', Object.keys(reader.uriContractReader).sort(), ['agentListFor', 'agentRecordFor', 'decisionSchemaBlockFor', 'elementRecordFor', 'layerHistoryFor', 'layerListFor', 'layerVersionRecordFor', 'manifestElementListFor', 'manifestInventoryFor', 'manifestStandardListFor', 'mappingsToMeaningFor', 'publishedLayerVersionListForStandard', 'publishedManifestFor', 'publishedManifestListFor', 'rootCountsFor', 'schemaBlockFor']);
sameValue('decisionSchemaBlockFor answers { decisionBlockHash, pairKey, frozenText }', Object.keys(answerOf(reader.uriContractReader.decisionSchemaBlockFor, judgedMemberBlockList[0].decisionBlockHash).answer).sort(), ['decisionBlockHash', 'frozenText', 'pairKey']);
sameValue('schemaBlockFor answers { schemaBlockRefId, blockKind, subject, version, text }', Object.keys(answerOf(reader.uriContractReader.schemaBlockFor, sha256Hex(baseText)).answer).sort(), ['blockKind', 'schemaBlockRefId', 'subject', 'text', 'version']);
sameValue('an absent hash answers null, not an error', answerOf(reader.uriContractReader.schemaBlockFor, '0'.repeat(64)), { errorText: '', answer: null });
const manifestAnswer = answerOf(reader.uriContractReader.publishedManifestFor, { publicLabel: 'educore-2026-10' }).answer;
sameValue('publishedManifestFor answers the identity row, ordered members, latest status and publishedAt', [Object.keys(manifestAnswer).sort(), manifestAnswer.memberList, manifestAnswer.latestStatus], [['defaultLayerByHub', 'latestStatus', 'manifestRefId', 'memberList', 'publicLabel', 'publishedAt'], [{ schemaBlockRefId: sha256Hex(baseText), position: 0 }, { schemaBlockRefId: sha256Hex(secondText), position: 1 }, { schemaBlockRefId: sha256Hex(relationshipText), position: 2 }], { registrationStatus: 'Candidate', changedAt: '2026-10-26T00:00:00Z' }]);
const judgeRecord = answerOf(reader.uriContractReader.agentRecordFor, JUDGE_IRI).answer;
sameValue('agentRecordFor computes the judge\'s record: its versions, their effective status, their counts', judgeRecord.layersAuthored.map((oneLayer) => [oneLayer.layerKey, oneLayer.versionList.map((oneVersion) => [oneVersion.versionTag, oneVersion.effectiveRegistrationStatus, oneVersion.roleList.join('+'), oneVersion.assertionCount, oneVersion.abstentionCount])]), [['toyJudge', [['base', 'Superseded', 'versionAuthor', 0, 0], ['wave1', 'Standard', 'versionAuthor', 0, 0]]]]);
sameValue('…its scores and its first and last contribution', [judgeRecord.scores.length, judgeRecord.firstContributionAt, judgeRecord.lastContributionAt], [1, '2026-10-02T00:00:00Z', '2026-10-03T00:00:00Z']);
const personRecord = answerOf(reader.uriContractReader.agentRecordFor, PERSON_IRI).answer;
sameValue('a curated set is counted by its rows (one assertion, no abstention)', personRecord.layersAuthored[0].versionList.map((oneVersion) => [oneVersion.assertionCount, oneVersion.abstentionCount]), [[1, 0]]);
harness.equal('an unknown agent answers null', answerOf(reader.uriContractReader.agentRecordFor, 'https://w3id.org/EDUcore/agent/nobody').answer, null);

// =====================================================================
harness.section('THE COMPUTED RELATIONS (lane A\'s twelve relation functions) and the DERIVED tables they read');
// =====================================================================
const callOf = (readerFunction, ...argumentList) => {
	const captured = { errorText: 'no callback', answer: undefined };
	readerFunction(...argumentList, (readError, answer) => {
		captured.errorText = readError;
		captured.answer = answer;
	});
	return captured;
};
const relationReader = reader.uriContractReader;
sameValue('1 elementRecordFor: the node, its parent, its siblings (code-point order), its definition text verbatim', callOf(relationReader.elementRecordFor, { standardName: 'Toy', standardVersion: '1', elementStableId: 'toy:a' }).answer, { schemaBlockRefId: sha256Hex(baseText), node: { stableId: 'toy:a', labels: ['ForgedNode', 'ToyNode'], properties: { definition: ['the toy a'], name: ['toy:a'], parentId: ['toy:root'] } }, parentStableId: 'toy:root', siblingStableIdList: ['toy:b'], definitionText: 'the toy a' });
sameValue('…an element no published manifest holds answers null', callOf(relationReader.elementRecordFor, { standardName: 'Toy', standardVersion: '1', elementStableId: 'toy:nowhere' }), { errorText: '', answer: null });
sameValue('2 publishedLayerVersionListForStandard: the versions with a member block for Toy0@1, with their effective status', callOf(relationReader.publishedLayerVersionListForStandard, { standardName: 'Toy0', standardVersion: '1' }).answer, [{ layerKey: 'toyJudge', versionTag: 'base', registrationStatus: 'Superseded' }, { layerKey: 'toyJudge', versionTag: 'wave1', registrationStatus: 'Standard' }]);
sameValue('3 mappingsToMeaningFor: per manifest, standard, first-publishing layer version and relation, the element count', callOf(relationReader.mappingsToMeaningFor, TOY_MEANING_IRI).answer, [{ manifestRefId, standardName: 'Toy', standardVersion: '1', layerKey: 'toyJudge', versionTag: 'base', relationType: 'EXACT_MATCH', elementCount: 1 }]);
const history = callOf(relationReader.layerHistoryFor, 'toyJudge').answer;
sameValue('4 layerHistoryFor: every version with its whole status history (publication row first) and its scores', history.versionList.map((oneVersion) => [oneVersion.versionTag, oneVersion.statusHistory.map((oneStatus) => oneStatus.registrationStatus), oneVersion.scores === null ? null : oneVersion.scores.length]), [['base', ['Standard', 'Superseded'], null], ['wave1', ['Standard'], 1]]);
const versionRecord = callOf(relationReader.layerVersionRecordFor, { layerKey: 'toyCurated', versionTag: 'r1' }).answer;
sameValue('5 layerVersionRecordFor: counts by standard and by hub, from the member blocks; the abstention rate', [versionRecord.countByStandard, versionRecord.countByHub, versionRecord.abstentionRate, versionRecord.latestStatus.registrationStatus], [{ toy: { rowCount: 1, mappedCount: 1, abstainedCount: 0 } }, { ToyHub: { rowCount: 1, mappedCount: 1, abstainedCount: 0 } }, 0, 'Candidate']);
const inventory = callOf(relationReader.manifestInventoryFor, { publicLabel: 'educore-2026-10' }).answer;
sameValue('6 manifestInventoryFor: standards, hubs, the wholly-cited layer versions, the recorded counts', [inventory.standardList, inventory.hubList, inventory.layerVersionList, inventory.nodeCount, inventory.edgeCount], [[{ standardName: 'Toy', standardVersion: '1' }], [{ hubName: 'ToyHub', hubVersion: '1.0' }], [{ layerKey: 'toyJudge', versionTag: 'base' }], 3, 2]);
sameValue('7 rootCountsFor', callOf(relationReader.rootCountsFor).answer, { manifestCount: 1, layerCount: 2, layerVersionCount: 3, agentCount: 3 });
sameValue('8 publishedManifestListFor, page 1', callOf(relationReader.publishedManifestListFor, { pageNumber: 1, pageSize: 10 }).answer, { totalCount: 1, manifestList: [{ manifestRefId, publicLabel: 'educore-2026-10', publishedAt: '2026-10-26T00:00:00Z', latestStatus: { registrationStatus: 'Candidate', changedAt: '2026-10-26T00:00:00Z' } }] });
harness.match('…page 0 is refused (pages are numbered from 1)', callOf(relationReader.publishedManifestListFor, { pageNumber: 0, pageSize: 10 }).errorText, /pages are numbered from 1/);
sameValue('9 manifestStandardListFor: one row per base block with its element count', callOf(relationReader.manifestStandardListFor, { manifestRefId }).answer.standardList, [{ standardName: 'Toy', standardVersion: '1', standardKey: 'toy', elementCount: 2, schemaBlockRefId: sha256Hex(baseText) }, { standardName: 'Toy', standardVersion: '1', standardKey: 'toy2', elementCount: 2, schemaBlockRefId: sha256Hex(secondText) }]);
sameValue('10 manifestElementListFor: distinct elements in code-point order, paged', callOf(relationReader.manifestElementListFor, { manifestRefId }, { standardName: 'Toy', standardVersion: '1', pageNumber: 2, pageSize: 2 }).answer, { totalCount: 3, elementList: [{ elementStableId: 'toy:c', role: null }] });
sameValue('11 agentListFor: profiles in registration order', callOf(relationReader.agentListFor, { pageNumber: 1, pageSize: 2 }).answer, { totalCount: 3, agentList: [{ profile: agentRegistry.agentList[0] }, { profile: agentRegistry.agentList[1] }] });
sameValue('12 layerListFor: each layer, its version count, its current Standard version', callOf(relationReader.layerListFor).answer, [{ layerKey: 'toyCurated', displayName: 'a toy curator', layerKind: 'curated', versionCount: 1, currentStandardVersionTag: null }, { layerKey: 'toyJudge', displayName: 'a toy judge layer', layerKind: 'judge', versionCount: 2, currentStandardVersionTag: 'wave1' }]);
sameValue('the derived tables verify: every source recomputes to its stored rows, none absent', reader.uriContract.verifyDerivedIndexes(), { verifiedSourceCount: 6, absentSourceCount: 0, differenceList: [] });
harness.match('the reader factory refuses an absent file', uriContractLib.uriContractReaderFor({ uriContractFilePath: path.join(scratchDirPath, 'absent.sqlite') }).error, /does not exist/);
reader.uriContract.close();
const manifestPath = manifestWorld.uriContractFilePath;
manifestWorld.uriContract.close();
plantCorruption(manifestPath, 'UPDATE schemaBlocks SET text = ? WHERE refId = ?', [`${baseText}x`, sha256Hex(baseText)]);
plantCorruption(manifestPath, 'UPDATE publishedManifestMembers SET position = 7 WHERE position = 2', []);
plantCorruption(manifestPath, 'UPDATE frozenVectors SET vectorHash = ? WHERE vectorId = ?', ['c'.repeat(64), toyVector.vectorId]);
const corruptedManifest = uriContractLib.openUriContractFile({ uriContractFilePath: manifestPath, accessMode: 'read' }).uriContract;
harness.match('a schema block whose text no longer hashes to its refId is refused on read', corruptedManifest.schemaBlockFor(sha256Hex(baseText)).error, /fails verify-on-read/);
harness.match('a manifest whose membership no longer hashes to its refId is refused on read', corruptedManifest.publishedManifestFor({ manifestRefId }).error, /fails verify-on-read \(its members hash to/);
harness.match('a frozen vector whose bytes no longer hash to its vectorHash is refused on read', corruptedManifest.frozenVectorFor(toyVector.vectorId).error, /fails verify-on-read: payload/);
corruptedManifest.close();
const derivedWorld = seededContract();
harness.equal('a second world publishes the manifest', derivedWorld.uriContract.publishManifest(publishArgs).alreadyPresent, false);
derivedWorld.uriContract.close();
plantCorruption(derivedWorld.uriContractFilePath, "UPDATE derivedElementIndex SET definitionText = 'tampered' WHERE elementStableId = 'toy:a' AND schemaBlockRefId = ?", [sha256Hex(baseText)]);
const derivedReopened = uriContractLib.openUriContractFile({ uriContractFilePath: derivedWorld.uriContractFilePath, accessMode: 'publish', writerActionName: 'publishManifest' }).uriContract;
sameValue('TWIN: a tampered derived row is reported by the verification, naming its source and table', derivedReopened.verifyDerivedIndexes().differenceList, [`schemaBlock ${sha256Hex(baseText)}: derivedElementIndex rows differ from a recomputation`]);
harness.match('…and -rebuildUriContractIndexes refuses rather than repairs it', derivedReopened.fillAbsentDerivedIndexes().error, /1 derived row set\(s\) differ from a recomputation/);
derivedReopened.close();

// =====================================================================
harness.section('THE HERMETIC REPLAY COUNT (replay()\'s own deserialize and guards, then MERGE semantics)');
// =====================================================================

const blockTextListOf = (textList) => ({ memberCount: textList.length, blockTextAt: (position) => textList[position] });
const counted = replayCountLib.hermeticReplayCountFor(blockTextListOf([baseText, secondText]));
sameValue('two blocks: 3 distinct nodes, 2 distinct edges (one shared edge merges), 1 dangling', counted, { nodeCount: 3, edgeCount: 2, danglingEdgeCount: 1, blockCount: 2 });
harness.match('an unreadable member is refused by position', replayCountLib.hermeticReplayCountFor(blockTextListOf([baseText, '{"kind":"nonsense"}\n'])).error, /member 1 is not a readable schema block/);
const unlabeledText = replayBlock.serializeBlock({ header: headerFor('toy3'), nodes: [{ ...nodeFor('toy:z'), labels: ['ToyNode'] }], edges: [] });
harness.match('a member replay\'s guards refuse is refused (a node without :ForgedNode)', replayCountLib.hermeticReplayCountFor(blockTextListOf([unlabeledText])).error, /member 0: .*ForgedNode/);
harness.match('an empty manifest is refused', replayCountLib.hermeticReplayCountFor({ memberCount: 0, blockTextAt: () => '' }).error, /memberCount \(a positive whole number\)/);

fs.rmSync(scratchDirPath, { recursive: true, force: true });
harness.report();
