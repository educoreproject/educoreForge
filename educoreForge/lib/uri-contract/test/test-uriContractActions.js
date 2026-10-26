#!/usr/bin/env node
'use strict';

// test-uriContractActions.js — the uriContract actions END TO END, through graphBuilder itself (ML3.1 Part B; WORKORDER-ML3.1 section 5).
// A temp SUPPORT STORE is written through the store modules' own writers (standards-database, vector-store, decision-store), a stated
// registry is written as JSON, and graphBuilder is SPAWNED for each action:
//   -seedUriContractFromRegistryJson   creates the file; row-for-row agreement; refuses an existing target; never names a failed seed
//   -publishManifest                   publishes the stated manifest (blocks, vectors, counts); refusals by name
//   -replayOldest                      hermetic count = recorded; TWIN: a planted recorded count goes RED
//   -rebuildUriContractIndexes         verifies the derived rows (and fills none: all were written with their sources)
//   -publishLayer                      a NEW curated layer and a new agent, by definition files, into uriContract; a second version;
//                                      the refusals (an unknown layer without a definition, a definition that differs)
//   the stub resolver                  served from uriContract ALONE (no support store parameter exists): layer, version by tag and by
//                                      content, agent, interpretation pinned and floating, assertion
// No docker, no spend: the sssom validator is a stated stand-in script that exits 0 (the real validator is gated in test-publishLayer
// and test-layerImport, which this does not replace).
//
// Run: node lib/uri-contract/test/test-uriContractActions.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the uriContract actions end to end, through a spawned graphBuilder

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Writes a temp support store through the store modules, then spawns graphBuilder -seedUriContractFromRegistryJson,
     -publishManifest, -replayOldest, -rebuildUriContractIndexes and -publishLayer against temp files, and serves the stub resolver
     from the resulting uriContract alone. Every refusal is observed firing. No docker, no spend.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const harness = require('../../../test/testLib/harness')(moduleName);
const replayBlock = require('../../replay/replay-block')();
const contentAddress = require('../../content-address/content-address')();
const standardsDatabaseModule = require('../../standards-database/standards-database')();
const vectorStoreModule = require('../../vector-store/vector-store');
const decisionStoreModule = require('../../decision-store/decision-store')();
const uriContractLib = require('../uriContract');
const { contentIdForMemberBlockList } = require('../../layer-registry/layerRegistry');
const Database = require('../../../node_modules/better-sqlite3');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const GRAPH_BUILDER = path.join(TREE_ROOT, 'apps', 'graph-builder', 'graphBuilder.js');
const STUB_SERVER = path.join(TREE_ROOT, 'lib', 'edc-uri', 'stubResolverServer.js');
const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const sameValue = (label, actual, expected) => harness.equal(label, JSON.stringify(actual), JSON.stringify(expected));
const scratchDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'test-uriContractActions-'));
const supportStorePath = path.join(scratchDirPath, 'support.sqlite');
const uriContractPath = path.join(scratchDirPath, 'uriContract.sqlite');
const writeJson = (fileName, parsedJson) => {
	const filePath = path.join(scratchDirPath, fileName);
	fs.writeFileSync(filePath, `${JSON.stringify(parsedJson, null, '\t')}\n`);
	return filePath;
};
// runGraphBuilder(argumentList) → { exitCode, outputText }: graphBuilder reads JSON on stdin, so stdin is always closed empty
const runGraphBuilder = (argumentList) => {
	const run = spawnSync('node', [GRAPH_BUILDER, ...argumentList], { input: '', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	return { exitCode: run.status, outputText: `${run.stdout}\n${run.stderr}` };
};
// jsonOf(outputText) → the result JSON graphBuilder prints last (a '{' alone on its line opens it; status lines may carry braces)
const jsonOf = (outputText) => {
	const start = outputText.lastIndexOf('\n{\n') + 1;
	const end = outputText.lastIndexOf('\n}') + 2;
	let parsed = null;
	try {
		parsed = JSON.parse(outputText.slice(start, end + 1));
	} catch (parseError) {
		parsed = { unparsed: outputText.slice(0, 2000) };
	}
	return parsed;
};

// ---------------------------------------------------------------------
// THE STATED WORLD
// ---------------------------------------------------------------------
const ORGANISATION_IRI = 'https://w3id.org/EDUcore/agent/org/educore';
const JUDGE_IRI = 'https://w3id.org/EDUcore/agent/judge/jev:toy:cfg-000000000001';
const RATER_IRI = 'https://w3id.org/EDUcore/agent/u-0042';
const TOY_MEANING_IRI = `https://w3id.org/EDUcore/ToyHub/hub/1.0/${'a'.repeat(64)}`;
const judgedBlockText = JSON.stringify({ header: { sourceStandardName: 'Toy', sourceVersion: '1', hubName: 'ToyHub', hubVersion: '1.0', producerKind: 'inferred', matchBasis: 'derived' }, decisionRecordList: [{ subjectStableId: 'toy:a', objectStableId: TOY_MEANING_IRI, predicate: 'exactMatch' }, { subjectStableId: 'toy:b' }], refusalList: [] });
const judgedMemberBlockList = [{ pairKey: 'toyhub@1.0::toy@1::toyBridge::inferred', decisionBlockHash: sha256Hex(judgedBlockText) }];
const agentRegistry = { about: 'stated', agentList: [{ agentIri: ORGANISATION_IRI, agentKind: 'organisation', displayName: 'EDUcore' }, { agentIri: JUDGE_IRI, agentKind: 'judge', displayName: 'a toy judge' }] };
const sourceListsFor = () => ({ standardList: [{ standardKey: 'toy', standardName: 'Toy', sourceIri: 'urn:educore:toy:' }], hubList: [{ hubKey: 'toyhub', hubName: 'ToyHub', sourceIri: 'urn:educore:hub:ToyHub:' }] });
const layerRegistry = {
	about: 'stated',
	registrationAuthorityIri: ORGANISATION_IRI,
	registrarIri: ORGANISATION_IRI,
	layerList: [
		{
			layerKey: 'toyJudge',
			displayName: 'a toy judge layer',
			layerKind: 'judge',
			authorAgentIri: ORGANISATION_IRI,
			...sourceListsFor(),
			versionList: [{ administrationRecord: { registrationAuthority: ORGANISATION_IRI, registrar: ORGANISATION_IRI, submitter: ORGANISATION_IRI, publishedAt: '2026-10-02T00:00:00Z', contentId: contentIdForMemberBlockList(judgedMemberBlockList), versionTag: 'base' }, registrationStatus: 'Standard', authorAgentIri: JUDGE_IRI, contentIdBasis: 'sortedMemberBlockHashList', memberBlockList: judgedMemberBlockList }],
			statusChangeList: [],
		},
	],
};
const nodeFor = (stableId) => ({ ref: { source: 'Toy', id: stableId }, labels: ['ForgedNode', 'ToyNode'], stableId, properties: { name: [stableId], parentId: ['toy:root'] } });
const vectorFloatList = [0.25, -0.5];
const toyVectorId = contentAddress.vectorIdForInput({ modelVersion: 'toy-model', embeddingDims: 2, inputText: 'toy b text' });
const baseText = replayBlock.serializeBlock({ header: { blockType: 'standardBase', standardKey: 'toy', version: '1', stableUriPropertyName: 'stableId', resolutionKey: 'stableId', embeddingRefGrammar: 2 }, nodes: [nodeFor('toy:a'), { ...nodeFor('toy:b'), embeddingRef: toyVectorId, embeddingModelVersion: 'toy-model' }], edges: [{ type: 'HAS_PART', fromRef: { source: 'Toy', id: 'toy:a' }, toRef: { source: 'Toy', id: 'toy:b' }, properties: { provenanceTier: ['structural'] } }] });
const relationshipText = replayBlock.serializeBlock({
	header: { blockType: 'relationship', pairA: 'toyhub', pairAVersion: '1.0', pairB: 'toy', pairBVersion: '1', producer: 'inferred' },
	nodes: [{ ref: { source: 'ToyHub', id: TOY_MEANING_IRI }, labels: ['ForgedNode', 'HubReference'], stableId: TOY_MEANING_IRI, properties: { name: ['a toy meaning'] } }],
	edges: [{ type: 'EXACT_MATCH', fromRef: { source: 'Toy', id: 'toy:a' }, toRef: { source: 'ToyHub', id: TOY_MEANING_IRI }, properties: { mappingKind: ['inferred'], decisionBlockHash: [judgedMemberBlockList[0].decisionBlockHash] } }],
});
const curatedSetText = ['#curie_map:', '#  toy: "urn:educore:toy:"', '#mapping_set_id: "https://w3id.org/EDUcore/layer/rater-42/r1"', `#mapping_provider: ${JSON.stringify(RATER_IRI)}`, '#object_source: "urn:educore:hub:ToyHub:"', '#object_source_version: "1.0"', ['subject_id', 'predicate_id', 'object_id', 'mapping_justification', 'subject_source', 'subject_source_version'].join('\t'), ['toy:a', 'skos:exactMatch', TOY_MEANING_IRI, 'semapv:ManualMappingCuration', 'urn:educore:toy:', '1'].join('\t')].join('\n') + '\n';

// ---------------------------------------------------------------------
// the support store, through the store modules' own writers
// ---------------------------------------------------------------------
const taskList = new taskListPlus();
taskList.push((args, next) => standardsDatabaseModule.open({ databaseFilePath: supportStorePath }, (openError, standardsDatabase) => next(openError, { ...args, standardsDatabase })));
taskList.push((args, next) => args.standardsDatabase.saveBlock({ text: baseText, kind: 'standardBase', subject: 'toy@1_base', version: '1', requires: [], producedBy: 'fixture' }, (saveError) => next(saveError, args)));
taskList.push((args, next) => args.standardsDatabase.saveBlock({ text: relationshipText, kind: 'relationship', subject: 'toyhub@1_0_rel_toy@1_exact', version: '1', requires: [sha256Hex(baseText)], producedBy: 'fixture' }, (saveError) => next(saveError, args)));
taskList.push((args, next) => args.standardsDatabase.saveManifest({ name: 'toyManifest', members: [{ schemaBlockRefId: sha256Hex(baseText), position: 0 }, { schemaBlockRefId: sha256Hex(relationshipText), position: 1 }] }, (saveError, saved) => next(saveError, { ...args, manifestRefId: saved && saved.refId })));
taskList.push((args, next) => {
	const vectorStore = vectorStoreModule({});
	vectorStore.init({ dbPath: supportStorePath }, (initError) => (initError ? next(initError, args) : vectorStore.putVector({ modelVersion: 'toy-model', inputText: 'toy b text', vector: vectorFloatList, embeddingRefGrammar: 2 }, (putError) => next(putError, args))));
});
taskList.push((args, next) => decisionStoreModule.open({ databaseFilePath: supportStorePath }, (openError, decisionStore) => (openError ? next(openError, args) : decisionStore.saveDecisionBlock({ pairKey: judgedMemberBlockList[0].pairKey, frozenText: judgedBlockText, decisionBlockHash: judgedMemberBlockList[0].decisionBlockHash }, (saveError) => next(saveError, { ...args, decisionStore })))));

pipeRunner(taskList.getList(), {}, (setupError, setup) => setImmediate(() => runGates(setupError, setup)));
// runGates — off the store modules' callback stack (sqlite-instance catches what a callback throws and re-enters it)
const runGates = (setupError, setup) => {
	if (setupError) {
		harness.ok('the temp support store is written through the store modules', false, setupError);
		harness.report();
		return;
	}
	const { manifestRefId } = setup;
	const layerRegistryPath = writeJson('layers.json', layerRegistry);
	const agentRegistryPath = writeJson('agents.json', agentRegistry);
	const contractFlag = `--uriContractFilePath=${uriContractPath}`;
	const storeFlag = `--standardsDatabaseFilePath=${supportStorePath}`;

	// =====================================================================
	harness.section('-seedUriContractFromRegistryJson');
	// =====================================================================
	const seeded = runGraphBuilder(['-seedUriContractFromRegistryJson', contractFlag, storeFlag, `--layerRegistryFilePath=${layerRegistryPath}`, `--agentRegistryFilePath=${agentRegistryPath}`]);
	harness.ok('the seed exits 0 and reports row-for-row agreement', seeded.exitCode === 0 && jsonOf(seeded.outputText).rowForRowAgreement === true, seeded.outputText.slice(-1500));
	harness.ok('…and the file exists under its own name', fs.existsSync(uriContractPath));
	harness.match('a second seed onto the same path is refused (never written over)', runGraphBuilder(['-seedUriContractFromRegistryJson', contractFlag, storeFlag, `--layerRegistryFilePath=${layerRegistryPath}`, `--agentRegistryFilePath=${agentRegistryPath}`]).outputText, /already exists; a uriContract is created once/);
	const failedSeedPath = path.join(scratchDirPath, 'failed.sqlite');
	const emptyStorePath = path.join(scratchDirPath, 'empty.sqlite');
	new Database(emptyStorePath).exec('CREATE TABLE decisionBlocks (decisionBlockHash TEXT, frozenText BLOB)');
	const failedSeed = runGraphBuilder(['-seedUriContractFromRegistryJson', `--uriContractFilePath=${failedSeedPath}`, `--standardsDatabaseFilePath=${emptyStorePath}`, `--layerRegistryFilePath=${layerRegistryPath}`, `--agentRegistryFilePath=${agentRegistryPath}`]);
	harness.match('a seed whose support store lacks a block is REFUSED, naming the block', failedSeed.outputText, /decision block .* is not in the support store/);
	harness.ok('…and NOTHING is left under the uriContract name (only the temporary file, for inspection)', !fs.existsSync(failedSeedPath) && fs.readdirSync(scratchDirPath).some((fileName) => fileName.indexOf('failed.sqlite.seeding-') === 0));
	harness.match('the seed without its registry files is refused (no default)', runGraphBuilder(['-seedUriContractFromRegistryJson', `--uriContractFilePath=${path.join(scratchDirPath, 'never.sqlite')}`, storeFlag]).outputText, /--layerRegistryFilePath and --agentRegistryFilePath are REQUIRED/);

	// =====================================================================
	harness.section('-publishManifest');
	// =====================================================================
	harness.match('without --publicLabel it is refused (the label is TQ\'s)', runGraphBuilder(['-publishManifest', contractFlag, storeFlag, `--manifestRefId=${manifestRefId}`, '--registrationStatus=Candidate']).outputText, /--publicLabel REQUIRED/);
	harness.match('a declared defaultLayerByHub with no conflict to settle is refused', runGraphBuilder(['-publishManifest', contractFlag, storeFlag, `--manifestRefId=${manifestRefId}`, '--publicLabel=toy-2026-10', '--registrationStatus=Candidate', `--defaultLayerByHubPath=${writeJson('default.json', { ToyHub: { decisionBlockHashList: [judgedMemberBlockList[0].decisionBlockHash] } })}`]).outputText, /no subject in this manifest has answer edges from two decision schema blocks/);
	harness.match('an unknown manifest is refused', runGraphBuilder(['-publishManifest', contractFlag, storeFlag, `--manifestRefId=${'f'.repeat(64)}`, '--publicLabel=toy-2026-10', '--registrationStatus=Candidate']).outputText, /is not in the support store/);
	const published = runGraphBuilder(['-publishManifest', contractFlag, storeFlag, `--manifestRefId=${manifestRefId}`, '--publicLabel=toy-2026-10', '--registrationStatus=Candidate']);
	const publishReport = jsonOf(published.outputText);
	sameValue('it publishes: 2 blocks, 1 frozen vector, recorded 3 nodes / 2 edges, defaultLayerByHub null', [published.exitCode, publishReport.memberCount, publishReport.frozenVectorCount, publishReport.recordedNodeCount, publishReport.recordedEdgeCount, publishReport.defaultLayerByHub], [0, 2, 1, 3, 2, null]);
	harness.equal('re-publishing is alreadyPresent', jsonOf(runGraphBuilder(['-publishManifest', contractFlag, storeFlag, `--manifestRefId=${manifestRefId}`, '--publicLabel=toy-2026-10', '--registrationStatus=Candidate']).outputText).alreadyPresent, true);

	// =====================================================================
	harness.section('-replayOldest and -rebuildUriContractIndexes');
	// =====================================================================
	const replayed = runGraphBuilder(['-replayOldest', contractFlag]);
	sameValue('the oldest manifest replays hermetically to its recorded counts', [replayed.exitCode, jsonOf(replayed.outputText).hermetic], [0, { nodeCount: 3, edgeCount: 2, danglingEdgeCount: 0 }]);
	const verified = runGraphBuilder(['-rebuildUriContractIndexes', '--verifyOnly=true', contractFlag]);
	sameValue('every derived row verifies; none absent', [verified.exitCode, jsonOf(verified.outputText).absentSourceCount, jsonOf(verified.outputText).differenceList], [0, 0, []]);
	const filled = runGraphBuilder(['-rebuildUriContractIndexes', contractFlag]);
	harness.equal('the rebuild fills nothing (every source was indexed with its rows)', jsonOf(filled.outputText).filledSourceCount, 0);
	const twinPath = path.join(scratchDirPath, 'twin.sqlite');
	fs.copyFileSync(uriContractPath, twinPath);
	const twinHandle = new Database(twinPath);
	twinHandle.exec('DROP TRIGGER publishedManifestsNoUpdate');
	twinHandle.exec('UPDATE publishedManifests SET recordedNodeCount = recordedNodeCount + 1');
	twinHandle.exec(uriContractLib.schemaSqlList().find((oneStatement) => oneStatement.indexOf('CREATE TRIGGER publishedManifestsNoUpdate') === 0));
	twinHandle.close();
	harness.match('TWIN: a recorded count the hermetic replay does not reproduce goes RED', runGraphBuilder(['-replayOldest', `--uriContractFilePath=${twinPath}`]).outputText, /REFUSED — the hermetic replay gives 3 nodes \/ 2 edges; toy-2026-10 was published with 4 \/ 2/);
	harness.match('--live without a new export store is refused', runGraphBuilder(['-replayOldest', contractFlag, '--live=true']).outputText, /--exportStoreFilePath=<a NEW scratch store path> is REQUIRED/);

	// =====================================================================
	harness.section('-publishLayer into uriContract: a new layer and a new agent by definition files');
	// =====================================================================
	const validatorPath = path.join(scratchDirPath, 'sssomValidatorStandIn.sh');
	fs.writeFileSync(validatorPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
	const setPath = path.join(scratchDirPath, 'raterSet.sssom.tsv');
	fs.writeFileSync(setPath, curatedSetText);
	const publishLayerArgumentsFor = (extraList) => ['-publishLayer', contractFlag, '--layerKey=rater-42', '--versionTag=r1', `--sssomPath=${setPath}`, `--decisionStoreFilePath=${supportStorePath}`, `--sssomValidatorPath=${validatorPath}`, ...extraList];
	const raterLayerDefinition = { layerKey: 'rater-42', displayName: 'rater 42', layerKind: 'human', authorAgentIri: RATER_IRI, ...sourceListsFor() };
	const raterAgentList = [{ agentIri: RATER_IRI, agentKind: 'person', displayName: 'rater 42, survey C' }];
	harness.match('an unknown layer without a definition is refused', runGraphBuilder(publishLayerArgumentsFor([])).outputText, /layer 'rater-42' is not in uriContract/);
	harness.match('…and with a definition but its author not yet an agent, refused', runGraphBuilder(publishLayerArgumentsFor([`--layerDefinitionPath=${writeJson('raterLayer.json', raterLayerDefinition)}`])).outputText, /is not in the agent registry|needs a displayName and an authorAgentIri/);
	const layerPublished = runGraphBuilder(publishLayerArgumentsFor([`--layerDefinitionPath=${path.join(scratchDirPath, 'raterLayer.json')}`, `--agentDefinitionPath=${writeJson('raterAgent.json', raterAgentList)}`]));
	harness.ok('with both definitions it publishes', layerPublished.exitCode === 0, layerPublished.outputText.slice(-1500));
	const readBack = uriContractLib.openUriContractFile({ uriContractFilePath: uriContractPath, accessMode: 'read' }).uriContract;
	const readRegistry = readBack.loadRegistry();
	if (readRegistry.error || readRegistry.registry.layerFor('rater-42').error) {
		harness.ok('uriContract loads with the published layer', false, readRegistry.error || readRegistry.registry.layerFor('rater-42').error);
		harness.report();
		return;
	}
	sameValue('uriContract now holds the layer, its Candidate version and the rater', [readRegistry.registry.layerFor('rater-42').layer.versionList.map((oneVersion) => [oneVersion.administrationRecord.versionTag, oneVersion.registrationStatus]), readRegistry.registry.agentRegistry.agentList.some((oneAgent) => oneAgent.agentIri === RATER_IRI)], [[['r1', 'Candidate']], true]);
	harness.equal('…and the set\'s frozen bytes are in uriContract under its content id', readBack.decisionSchemaBlockTextFor(sha256Hex(curatedSetText)).frozenText, curatedSetText);
	readBack.close();
	harness.match('a definition that differs from the stored layer is refused', runGraphBuilder(['-publishLayer', contractFlag, '--layerKey=rater-42', '--versionTag=r2', `--sssomPath=${setPath}`, `--decisionStoreFilePath=${supportStorePath}`, `--sssomValidatorPath=${validatorPath}`, `--layerDefinitionPath=${writeJson('raterLayerRenamed.json', { ...raterLayerDefinition, displayName: 'renamed' })}`]).outputText, /already defined in uriContract and the offered definition differs in 'displayName'/);
	harness.equal('the same bytes again are alreadyPresent (no definition needed now)', jsonOf(runGraphBuilder(publishLayerArgumentsFor([])).outputText).alreadyPresent, true);

	// =====================================================================
	harness.section('THE STUB RESOLVER, from uriContract ALONE');
	// =====================================================================
	const port = 20000 + (process.pid % 20000);
	const server = spawn('node', [STUB_SERVER, `--port=${port}`, contractFlag], { stdio: ['ignore', 'pipe', 'pipe'] });
	const probeList = [
		['layer (floating, its Standard version)', 'layer/toyJudge', 200, (body) => body.currentStandardVersionTag === 'base' && body.versionList.length === 1],
		['layer version by tag (with its computed counts)', 'layer/toyJudge/base', 200, (body) => body.latestStatus.registrationStatus === 'Standard' && body.countByStandard.toy.mappedCount === 1],
		['layer version by content', `layer/toyJudge/sha256/${contentIdForMemberBlockList(judgedMemberBlockList)}`, 200, (body) => body.versionTag === 'base'],
		['agent (profile plus computed record)', 'agent/judge/jev:toy:cfg-000000000001', 200, (body) => body.displayName === 'a toy judge' && body.layersAuthored[0].versionList[0].assertionCount === 1],
		['interpretation, pinned', 'Toy/1/toy:a@toyJudge/base', 200, (body) => body.assertionList.length === 1 && body.assertionList[0].object === TOY_MEANING_IRI],
		['interpretation, floating', 'Toy/1/toy:b@toyJudge', 200, (body) => body.answer === 'sssom:NoTermFound'],
		['the curated layer version just published', 'layer/rater-42/r1', 200, (body) => body.latestStatus.registrationStatus === 'Candidate'],
	];
	const fetchPath = (requestPath, done) => {
		http.get({ host: '127.0.0.1', port, path: `/EDUcore/${requestPath}` }, (response) => {
			let bodyText = '';
			response.on('data', (chunk) => (bodyText += chunk));
			response.on('end', () => done('', { httpStatus: response.statusCode, body: JSON.parse(bodyText) }));
		}).on('error', (requestError) => done(requestError.message));
	};
	const probeNext = (probeIndex) => {
		if (probeIndex >= probeList.length) {
			server.kill();
			fs.rmSync(scratchDirPath, { recursive: true, force: true });
			harness.report();
			return;
		}
		const [label, requestPath, expectedStatus, bodyCheck] = probeList[probeIndex];
		fetchPath(requestPath, (fetchError, fetched) => {
			const bodyVerdict = (() => {
				try {
					return !fetchError && bodyCheck(fetched.body);
				} catch (checkError) {
					return false;
				}
			})();
			harness.ok(`the stub resolves ${label} (${requestPath})`, !fetchError && fetched.httpStatus === expectedStatus && bodyVerdict, fetchError || `${fetched.httpStatus} ${JSON.stringify(fetched.body).slice(0, 900)}`);
			probeNext(probeIndex + 1);
		});
	};
	let started = false;
	server.stdout.on('data', (chunk) => {
		if (!started && String(chunk).indexOf('listening') !== -1) {
			started = true;
			probeNext(0);
		}
	});
	server.on('exit', (exitCode) => {
		if (!started) {
			harness.ok('the stub resolver starts on uriContract alone', false, `exit ${exitCode}`);
			harness.report();
		}
	});
};
