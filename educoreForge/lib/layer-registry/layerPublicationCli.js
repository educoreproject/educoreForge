#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// layerPublicationCli.js — the I/O shell of lib/layer-registry/layerPublication.js (mappingLayers ML3-a/b). No judge, no embedding.
//
// ACTIONS (exactly one):
//   -captureGold   read ONE gold READ-ONLY over bolt and freeze what rendering and import need into a JSON file: every HubReference card
//                  (stableId, uri, name), every ForgedNode element (stableId, _source), every standard root (name, key, version) and the
//                  passport's manifestRefId. Rendering reads this file, never the graph, so the same file gives the same bytes.
//       --goldContainerName=<container>  --goldCapturePath=<out.json>
//   -render        render every registered layer version (machine and curated) as ONE SSSOM set (R-b), one registry document per layer,
//                  the site registry, and one JSON-LD context per (version, standard), into --outputDirPath; with --publicFilterRulesPath
//                  ALSO a public filtered rendering of each (TQ Q37) under <outputDirPath>/public, never anywhere else.
//       --layerRegistryFilePath=<recipes/layers.json>  --agentRegistryFilePath=<recipes/agents.json>  --storePath=<support store COPY>
//       --goldCapturePath=<capture.json>  --outputDirPath=<dir>  --publicFilterRulesPath=<downloadArtifactsRules.json>
// Every parameter is REQUIRED for its action, with no default. Exit 0 when written; 1 on a refusal (printed).
//
// OUTPUT TREE (mirrors the edc URI paths):  layer/<layerKey>/registry.sssom.yml   layer/<layerKey>/<tag>/set.sssom.tsv
//   layer/<layerKey>/<tag>/context/<standardKey>.jsonld   registry/layers.sssom.yml   render-report.json   public/… (the same shape)
// -help prints this header.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const helpText = () => fs.readFileSync(__filename, 'utf8').split('\n').filter((oneLine) => oneLine.startsWith('//')).map((oneLine) => oneLine.replace(/^\/\/ ?/, '')).join('\n');
const argumentList = process.argv.slice(2);
const parameterValueFor = (parameterName) => {
	const prefix = `--${parameterName}=`;
	const argument = argumentList.find((oneArgument) => oneArgument.indexOf(prefix) === 0);
	return argument === undefined ? undefined : argument.slice(prefix.length);
};
const refuseAndExit = (refusalText) => {
	process.stderr.write(`${moduleName}: ${refusalText} (${moduleName} -help for the full page)\n`);
	process.exit(1);
};
if (argumentList.some((oneArgument) => ['-help', '--help', '-h'].indexOf(oneArgument) !== -1)) {
	process.stdout.write(`${helpText()}\n`);
	process.exit(0);
}
const REQUIRED_PARAMETER_NAME_LIST_BY_ACTION = Object.freeze({
	captureGold: ['goldContainerName', 'goldCapturePath'],
	render: ['layerRegistryFilePath', 'agentRegistryFilePath', 'storePath', 'goldCapturePath', 'outputDirPath', 'publicFilterRulesPath'],
});
const actionList = Object.keys(REQUIRED_PARAMETER_NAME_LIST_BY_ACTION).filter((actionName) => argumentList.indexOf(`-${actionName}`) !== -1);
if (actionList.length !== 1) {
	refuseAndExit(`exactly one action is required (${Object.keys(REQUIRED_PARAMETER_NAME_LIST_BY_ACTION).map((actionName) => `-${actionName}`).join(' | ')}); got ${actionList.length}`);
}
const actionName = actionList[0];
const missingParameterList = REQUIRED_PARAMETER_NAME_LIST_BY_ACTION[actionName].filter((parameterName) => !parameterValueFor(parameterName));
if (missingParameterList.length) {
	refuseAndExit(`-${actionName}: ${missingParameterList.map((parameterName) => `--${parameterName}`).join(', ')} REQUIRED, with no default`);
}

const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');
const exitOnError = (result) => {
	if (result.error) {
		refuseAndExit(result.error);
	}
	return result;
};
const writeFileMakingDirs = (filePath, text) => {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, text, 'utf8');
};

// =====================================================================
// -captureGold
// =====================================================================

const CAPTURE_QUERY_BY_NAME = Object.freeze({
	cardList: 'MATCH (h:HubReference) WHERE h.stableId IS NOT NULL RETURN h.stableId AS stableId, h.uri AS uri, h.name AS name ORDER BY stableId',
	elementList: 'MATCH (n:ForgedNode) WHERE n.stableId IS NOT NULL AND n._source IS NOT NULL AND NOT n:HubReference RETURN n.stableId AS stableId, n._source AS sourceName ORDER BY stableId, sourceName',
	standardList: "MATCH (n:ForgedNode) WHERE n.stableId ENDS WITH ':root' AND n._source IS NOT NULL RETURN n._source AS standardName, split(n.stableId, ':')[0] AS standardKey, n.version AS standardVersion ORDER BY standardName",
	hubList: 'MATCH (h:HubDefinition) RETURN h.hubName AS hubName, h.version AS hubVersion, h.namespace AS namespace ORDER BY hubName',
	passportList: 'MATCH (g:GraphProvenance) RETURN g.manifestRefId AS manifestRefId, g.graphName AS graphName',
});

const captureGold = () => {
	const { resolveContainerBolt } = require(path.join(__dirname, '..', 'graph-connection', 'containerBolt'));
	resolveContainerBolt({ containerName: parameterValueFor('goldContainerName') }, (boltError, bolt) => {
		if (boltError) {
			refuseAndExit(boltError);
		}
		const neo4j = require(path.join(__dirname, '..', '..', 'node_modules', 'neo4j-driver'));
		const driver = neo4j.driver(bolt.boltUrl, neo4j.auth.basic(bolt.user, bolt.password), { encrypted: false });
		const queryNameList = Object.keys(CAPTURE_QUERY_BY_NAME);
		const capture = { goldContainerName: parameterValueFor('goldContainerName') };
		const runNext = (queryIndex) => {
			if (queryIndex >= queryNameList.length) {
				driver.close().then(() => {
					if (capture.passportList.length !== 1) {
						refuseAndExit(`the gold carries ${capture.passportList.length} GraphProvenance passports, not one`);
					}
					capture.manifestRefId = capture.passportList[0].manifestRefId;
					writeFileMakingDirs(parameterValueFor('goldCapturePath'), `${JSON.stringify(capture)}\n`);
					process.stdout.write(`${moduleName}: captured ${capture.cardList.length} cards, ${capture.elementList.length} elements, ${capture.standardList.length} standards from ${capture.goldContainerName} (manifest ${capture.manifestRefId})\n`);
				});
				return;
			}
			const session = driver.session({ defaultAccessMode: neo4j.session.READ });
			session
				.run(CAPTURE_QUERY_BY_NAME[queryNameList[queryIndex]])
				.then((result) => {
					capture[queryNameList[queryIndex]] = result.records.map((oneRecord) => oneRecord.toObject());
					session.close().then(() => runNext(queryIndex + 1));
				})
				.catch((runError) => {
					driver.close().then(() => refuseAndExit(`${queryNameList[queryIndex]}: ${runError.message}`));
				});
		};
		runNext(0);
	});
};

// =====================================================================
// -render
// =====================================================================

const render = () => {
	const Database = require(path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'));
	const layerRegistryLib = require(path.join(__dirname, 'layerRegistry'));
	const layerPublicationLib = require(path.join(__dirname, 'layerPublication'));
	const loaded = exitOnError(layerRegistryLib.loadRegistry({ layerRegistryFilePath: parameterValueFor('layerRegistryFilePath'), agentRegistryFilePath: parameterValueFor('agentRegistryFilePath') }));
	const { registry } = loaded;
	const goldCapture = JSON.parse(fs.readFileSync(parameterValueFor('goldCapturePath'), 'utf8'));
	const cardByStableId = goldCapture.cardList.reduce((soFar, oneCard) => {
		soFar[oneCard.stableId] = { uri: oneCard.uri, name: oneCard.name };
		return soFar;
	}, {});
	const standardNameByStandardKey = goldCapture.standardList.reduce((soFar, oneStandard) => ({ ...soFar, [oneStandard.standardKey]: oneStandard.standardName }), {});
	const standardVersionByStandardKey = goldCapture.standardList.reduce((soFar, oneStandard) => ({ ...soFar, [oneStandard.standardKey]: oneStandard.standardVersion }), {});
	const downloadRules = JSON.parse(fs.readFileSync(parameterValueFor('publicFilterRulesPath'), 'utf8'));
	const { publicFilter } = exitOnError(layerPublicationLib.publicFilterFor({ licenceHoldList: downloadRules.licenceHoldList, filterSourceText: `downloadArtifactsRules.json licenceHoldList (TQ Q37), sha256 ${sha256Hex(fs.readFileSync(parameterValueFor('publicFilterRulesPath'))).slice(0, 12)}` }));
	const store = new Database(parameterValueFor('storePath'), { readonly: true, fileMustExist: true });
	const frozenTextFor = (decisionBlockHash) => {
		const stored = store.prepare('SELECT frozenText FROM decisionBlocks WHERE decisionBlockHash = ?').get(decisionBlockHash);
		if (stored === undefined) {
			refuseAndExit(`decision block ${decisionBlockHash} is not in ${parameterValueFor('storePath')}`);
		}
		if (sha256Hex(stored.frozenText) !== decisionBlockHash) {
			refuseAndExit(`decision block ${decisionBlockHash} does not re-hash to its id (verify-on-read)`);
		}
		return stored.frozenText;
	};
	const outputDirPath = parameterValueFor('outputDirPath');
	const report = { goldContainerName: goldCapture.goldContainerName, goldManifestRefId: goldCapture.manifestRefId, publicFilter, layerList: [] };
	const renderingList = [{ subTreeDirPath: outputDirPath, filter: undefined }, { subTreeDirPath: path.join(outputDirPath, 'public'), filter: publicFilter }];
	const layerKeyList = registry.layerRegistry.layerList.map((oneLayer) => oneLayer.layerKey);
	const memberRowsByBlockHash = {};
	registry.layerRegistry.layerList.forEach((oneLayer) => {
		const layerReport = { layerKey: oneLayer.layerKey, versionList: [] };
		const localNameByVersionTag = {};
		oneLayer.versionList.forEach((oneVersion) => {
			const versionTag = oneVersion.administrationRecord.versionTag;
			localNameByVersionTag[versionTag] = `${versionTag}/set.sssom.tsv`;
			// machine members are parsed one at a time and dropped (the largest frozen block is ~500 MB of JSON); their ROWS are kept by block
			// hash, because the jev and jev-cfg-* layers name the same blocks
			const memberRowsList = oneVersion.contentIdBasis === 'sortedMemberBlockHashList'
				? oneVersion.memberBlockList.map((oneMember) => {
						if (memberRowsByBlockHash[oneMember.decisionBlockHash] === undefined) {
							memberRowsByBlockHash[oneMember.decisionBlockHash] = exitOnError(layerPublicationLib.machineMemberRowsFor({ member: oneMember, decisionBlock: JSON.parse(frozenTextFor(oneMember.decisionBlockHash)), cardByStableId })).memberRows;
						}
						return { ...memberRowsByBlockHash[oneMember.decisionBlockHash], member: { pairKey: oneMember.pairKey, decisionBlockHash: oneMember.decisionBlockHash } };
					})
				: undefined;
			const wholeSetText = oneVersion.contentIdBasis === 'frozenSetBytes' ? frozenTextFor(oneVersion.wholeSetBlock.decisionBlockHash) : undefined;
			renderingList.forEach((oneRendering) => {
				const rendered = exitOnError(memberRowsList !== undefined
					? layerPublicationLib.machineVersionSetText({ layer: oneLayer, version: oneVersion, memberRowsList, publicFilter: oneRendering.filter })
					: layerPublicationLib.curatedVersionSetText({ layer: oneLayer, version: oneVersion, wholeSetText, publicFilter: oneRendering.filter }));
				const versionDirPath = path.join(oneRendering.subTreeDirPath, 'layer', oneLayer.layerKey, versionTag);
				writeFileMakingDirs(path.join(versionDirPath, 'set.sssom.tsv'), rendered.setText);
				const contexts = exitOnError(layerPublicationLib.contextDocumentTextList({ layer: oneLayer, version: oneVersion, subjectStableIdList: rendered.subjectStableIdList, standardNameByStandardKey, standardVersionByStandardKey, publicFilter: oneRendering.filter }));
				contexts.contextDocumentList.forEach((oneContext) => writeFileMakingDirs(path.join(versionDirPath, 'context', `${oneContext.standardKey}.jsonld`), oneContext.documentText));
				layerReport.versionList.push({ versionTag, rendering: oneRendering.filter === undefined ? 'complete' : 'publicFiltered', mappingSetId: rendered.mappingSetId, rowCount: rendered.rowCount, fullRowCount: rendered.fullRowCount, setSha256: sha256Hex(rendered.setText), contextStandardKeyList: contexts.contextDocumentList.map((oneContext) => oneContext.standardKey) });
			});
		});
		renderingList.forEach((oneRendering) => {
			const registryDocument = exitOnError(layerPublicationLib.registryDocumentText({ layer: oneLayer, registry, localNameByVersionTag, publicFilter: oneRendering.filter }));
			writeFileMakingDirs(path.join(oneRendering.subTreeDirPath, 'layer', oneLayer.layerKey, 'registry.sssom.yml'), registryDocument.documentText);
		});
		report.layerList.push(layerReport);
	});
	renderingList.forEach((oneRendering) => {
		const siteDocument = exitOnError(layerPublicationLib.siteRegistryDocumentText({ layerKeyList, publicFilter: oneRendering.filter }));
		writeFileMakingDirs(path.join(oneRendering.subTreeDirPath, 'registry', 'layers.sssom.yml'), siteDocument.documentText);
	});
	writeFileMakingDirs(path.join(outputDirPath, 'render-report.json'), `${JSON.stringify(report, null, '\t')}\n`);
	process.stdout.write(`${moduleName}: rendered ${report.layerList.reduce((soFar, oneLayer) => soFar + oneLayer.versionList.length, 0)} set(s) for ${report.layerList.length} layer(s) into ${outputDirPath}\n`);
};

const ACTION_BY_NAME = Object.freeze({ captureGold, render });
ACTION_BY_NAME[actionName]();
