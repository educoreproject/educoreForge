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
//   -gate          run the publication gates over a rendered tree (complete AND public) and write ONE gate report binding each file's
//                  sha256: (1) every record_id recomputes from its row; (2) sssom-py 'validate' exits 0 AND 'parse' keeps every row (a
//                  silent drop is a red, never a pass); (3) every registry document passes linkml-validate against sssom-schema; (4) ROUND
//                  TRIP: each set imports through lib/layer-import's resolver with ZERO refusals and its MSI multiset equals the source
//                  layer version's (decision blocks, or the stored curated set), held standards removed for a public set; (5) the public
//                  tree carries 0 subjects of a held standard. Exit 0 only when every gate is green.
//       --renderedDirPath=<render -outputDirPath>  --layerRegistryFilePath  --agentRegistryFilePath  --storePath  --goldCapturePath
//       --publicFilterRulesPath  --sssomValidatorPath=<sssom-py sssom>  --linkmlValidatorPath=<linkml-validate>
//       --sssomSchemaPath=<sssom_schema.yaml>  --gateReportPath=<out.json>
//   -publishPublic copy <renderedDirPath>/public to the downloads tree ONLY when the gate report is green and every file's bytes still
//                  match the sha256 the gate bound (TQ Q37: nothing reaches downloadArtifacts ungated). The destination must be a
//                  directory named mappingLayers (the lane's one grant under downloadArtifacts).
//       --renderedDirPath  --gateReportPath  --publicDestinationDirPath=<…/downloadArtifacts/<gold>/mappingLayers>
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
	gate: ['renderedDirPath', 'layerRegistryFilePath', 'agentRegistryFilePath', 'storePath', 'goldCapturePath', 'publicFilterRulesPath', 'sssomValidatorPath', 'linkmlValidatorPath', 'sssomSchemaPath', 'gateReportPath'],
	publishPublic: ['renderedDirPath', 'gateReportPath', 'publicDestinationDirPath'],
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
	// the versions the gold's OWN match edges stamp on their subjects: for SEDM and MedBiquitous they are the pair versions 'unknown_01' /
	// 'unknown_02' while the standard root says 'unknown' (measured 2026-10-25); an assertion id hashes the edge's version, so both count
	edgeSubjectVersionList: 'MATCH ()-[r]->() WHERE r.assertionId IS NOT NULL AND r.subjectSource IS NOT NULL RETURN DISTINCT r.subjectSource AS standardName, r.subjectVersion AS standardVersion ORDER BY standardName, standardVersion',
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
	const memberRowsByBlockHash = {};
	const listedLayerKeyListByRendering = { complete: [], publicFiltered: [] };
	registry.layerRegistry.layerList.forEach((oneLayer) => {
		const layerReport = { layerKey: oneLayer.layerKey, versionList: [] };
		const localNameByVersionTagByRendering = { complete: {}, publicFiltered: {} };
		oneLayer.versionList.forEach((oneVersion) => {
			const versionTag = oneVersion.administrationRecord.versionTag;
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
				const renderingName = oneRendering.filter === undefined ? 'complete' : 'publicFiltered';
				// a public rendering whose filter leaves no row is not written, and its registry does not list it (an empty set is no set)
				if (renderingName === 'publicFiltered' && rendered.rowCount === 0) {
					layerReport.versionList.push({ versionTag, rendering: renderingName, notWritten: 'the filter leaves no row', fullRowCount: rendered.fullRowCount });
					return;
				}
				localNameByVersionTagByRendering[renderingName][versionTag] = `${versionTag}/set.sssom.tsv`;
				const versionDirPath = path.join(oneRendering.subTreeDirPath, 'layer', oneLayer.layerKey, versionTag);
				writeFileMakingDirs(path.join(versionDirPath, 'set.sssom.tsv'), rendered.setText);
				const contexts = exitOnError(layerPublicationLib.contextDocumentTextList({ layer: oneLayer, version: oneVersion, subjectStableIdList: rendered.subjectStableIdList, standardNameByStandardKey: rendered.standardNameByStandardKey, standardVersionByStandardKey: rendered.standardVersionByStandardKey, publicFilter: oneRendering.filter }));
				contexts.contextDocumentList.forEach((oneContext) => writeFileMakingDirs(path.join(versionDirPath, 'context', `${oneContext.standardKey}.jsonld`), oneContext.documentText));
				layerReport.versionList.push({ versionTag, rendering: oneRendering.filter === undefined ? 'complete' : 'publicFiltered', mappingSetId: rendered.mappingSetId, rowCount: rendered.rowCount, fullRowCount: rendered.fullRowCount, setSha256: sha256Hex(rendered.setText), contextStandardKeyList: contexts.contextDocumentList.map((oneContext) => oneContext.standardKey) });
			});
		});
		renderingList.forEach((oneRendering) => {
			const localNameByVersionTag = localNameByVersionTagByRendering[oneRendering.filter === undefined ? 'complete' : 'publicFiltered'];
			if (Object.keys(localNameByVersionTag).length === 0) {
				return;
			}
			listedLayerKeyListByRendering[oneRendering.filter === undefined ? 'complete' : 'publicFiltered'].push(oneLayer.layerKey);
			const registryDocument = exitOnError(layerPublicationLib.registryDocumentText({ layer: oneLayer, registry, localNameByVersionTag, publicFilter: oneRendering.filter }));
			writeFileMakingDirs(path.join(oneRendering.subTreeDirPath, 'layer', oneLayer.layerKey, 'registry.sssom.yml'), registryDocument.documentText);
		});
		report.layerList.push(layerReport);
	});
	renderingList.forEach((oneRendering) => {
		const siteDocument = exitOnError(layerPublicationLib.siteRegistryDocumentText({ layerKeyList: listedLayerKeyListByRendering[oneRendering.filter === undefined ? 'complete' : 'publicFiltered'], publicFilter: oneRendering.filter }));
		writeFileMakingDirs(path.join(oneRendering.subTreeDirPath, 'registry', 'layers.sssom.yml'), siteDocument.documentText);
	});
	writeFileMakingDirs(path.join(outputDirPath, 'render-report.json'), `${JSON.stringify(report, null, '\t')}\n`);
	process.stdout.write(`${moduleName}: rendered ${report.layerList.reduce((soFar, oneLayer) => soFar + oneLayer.versionList.length, 0)} set(s) for ${report.layerList.length} layer(s) into ${outputDirPath}\n`);
};


// =====================================================================
// -gate
// =====================================================================

const PUBLIC_DESTINATION_DIR_NAME = 'mappingLayers';
const listFilesUnder = (dirPath) => fs.readdirSync(dirPath, { withFileTypes: true }).reduce((soFar, oneEntry) => soFar.concat(oneEntry.isDirectory() ? listFilesUnder(path.join(dirPath, oneEntry.name)) : [path.join(dirPath, oneEntry.name)]), []);
const isPublishedFile = (filePath) => /\.(sssom\.tsv|sssom\.yml|jsonld)$/.test(filePath);

const gate = () => {
	const { spawnSync } = require('child_process');
	const os = require('os');
	const Database = require(path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'));
	const layerRegistryLib = require(path.join(__dirname, 'layerRegistry'));
	const layerPublicationLib = require(path.join(__dirname, 'layerPublication'));
	const { resolveImportRows } = require(path.join(__dirname, '..', 'layer-import', 'layerImport'));
	const importRules = require(path.join(__dirname, '..', 'layer-import', 'importRules.json'));
	const { assertionsFromDecisionBlock } = require(path.join(__dirname, '..', 'layer-agreement', 'layerAssertions'));
	const assertionIdentity = require(path.join(__dirname, '..', 'edc-uri', 'assertionIdentity'));
	const subjectCurieLib = require(path.join(__dirname, '..', 'edc-uri', 'subjectCurie'));
	const { parseSssomTsv } = require(path.join(__dirname, '..', 'bridge-framework', 'sssomExporter'));
	const renderedDirPath = parameterValueFor('renderedDirPath');
	const { registry } = exitOnError(layerRegistryLib.loadRegistry({ layerRegistryFilePath: parameterValueFor('layerRegistryFilePath'), agentRegistryFilePath: parameterValueFor('agentRegistryFilePath') }));
	const goldCapture = JSON.parse(fs.readFileSync(parameterValueFor('goldCapturePath'), 'utf8'));
	const downloadRules = JSON.parse(fs.readFileSync(parameterValueFor('publicFilterRulesPath'), 'utf8'));
	const heldStandardKeyList = downloadRules.licenceHoldList.map((oneHold) => oneHold.bundleToken);
	const store = new Database(parameterValueFor('storePath'), { readonly: true, fileMustExist: true });
	const frozenTextFor = (decisionBlockHash) => {
		const stored = store.prepare('SELECT frozenText FROM decisionBlocks WHERE decisionBlockHash = ?').get(decisionBlockHash);
		if (stored === undefined || sha256Hex(stored.frozenText) !== decisionBlockHash) {
			refuseAndExit(`decision block ${decisionBlockHash} is absent from the store or does not re-hash to its id`);
		}
		return stored.frozenText;
	};
	const curieMapOf = (headerLineList) => headerLineList.reduce((soFar, oneLine) => {
		const matched = /^#  ([A-Za-z_][A-Za-z0-9_]*): (".*")$/.exec(oneLine);
		return matched ? { ...soFar, [matched[1]]: JSON.parse(matched[2]) } : soFar;
	}, {});
	const msiOf = (subjectIri, predicateIri, objectIri) => exitOnError(assertionIdentity.mappingSamenessIdFor({ subjectIriList: [subjectIri], predicateIri, objectIriList: [objectIri], isNegative: false })).mappingSamenessId;
	// counted LINEARLY: a spread inside reduce is quadratic, and these lists run to 41,025 rows (the ML2 trap, measured again here)
	const countList = (textList) => {
		const countByText = {};
		textList.forEach((oneText) => {
			countByText[oneText] = (countByText[oneText] || 0) + 1;
		});
		return countByText;
	};
	const sameMultiset = (leftList, rightList) => {
		const leftCount = countList(leftList);
		const rightCount = countList(rightList);
		return leftList.length === rightList.length && Object.keys(leftCount).every((oneText) => leftCount[oneText] === rightCount[oneText]);
	};
	// the SOURCE MSI list of a layer version, from what is frozen (never from a rendering)
	const sourceMsiListByVersionKey = {};
	const sourceMsiListFor = (layer, version, isPublic) => {
		const versionKey = `${layer.layerKey}/${version.administrationRecord.versionTag}/${isPublic ? 'public' : 'complete'}`;
		if (sourceMsiListByVersionKey[versionKey] !== undefined) {
			return sourceMsiListByVersionKey[versionKey];
		}
		const isKept = (standardKey) => !isPublic || heldStandardKeyList.indexOf(standardKey) === -1;
		let msiList = [];
		if (version.contentIdBasis === 'sortedMemberBlockHashList') {
			version.memberBlockList.forEach((oneMember) => {
				if (!isKept(oneMember.pairKey.split('::')[1].split('@')[0])) {
					return;
				}
				const decisionBlock = JSON.parse(frozenTextFor(oneMember.decisionBlockHash));
				const { header } = decisionBlock;
				const read = exitOnError(assertionsFromDecisionBlock({ decisionBlock, sourceLabel: oneMember.pairKey }));
				msiList = msiList.concat(read.assertionList.map((oneAssertion) => msiOf(exitOnError(subjectCurieLib.subjectCurieFor({ stableId: oneAssertion.fromStableId, standardName: header.sourceStandardName, standardVersion: String(header.sourceVersion) })).elementIri, exitOnError(assertionIdentity.predicateIriFor(oneAssertion.predicateId)).iri, oneAssertion.isAbstention ? importRules.noTermFoundIri : exitOnError(assertionIdentity.nodeIriFor({ stableId: oneAssertion.objectId, standardName: header.hubName, standardVersion: String(header.hubVersion) })).iri)));
			});
		} else {
			const parsed = parseSssomTsv(frozenTextFor(version.wholeSetBlock.decisionBlockHash));
			const standardByStandardKey = layer.standardList.reduce((soFar, oneStandard) => ({ ...soFar, [oneStandard.standardKey]: oneStandard }), {});
			msiList = parsed.rowList.filter((oneRow) => isKept(oneRow.subject_id.slice(0, oneRow.subject_id.indexOf(':')))).map((oneRow) => msiOf(exitOnError(subjectCurieLib.subjectCurieFor({ stableId: oneRow.subject_id, standardName: standardByStandardKey[oneRow.subject_id.slice(0, oneRow.subject_id.indexOf(':'))].standardName, standardVersion: oneRow.subject_source_version })).elementIri, exitOnError(assertionIdentity.predicateIriFor(oneRow.predicate_id)).iri, oneRow.object_id === 'sssom:NoTermFound' ? importRules.noTermFoundIri : oneRow.object_id));
		}
		sourceMsiListByVersionKey[versionKey] = msiList;
		return msiList;
	};
	const runChild = (commandPath, argumentListForChild) => spawnSync(commandPath, argumentListForChild, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
	const fileReportList = [];
	['complete', 'public'].forEach((renderingName) => {
		const subTreeDirPath = renderingName === 'complete' ? renderedDirPath : path.join(renderedDirPath, 'public');
		registry.layerRegistry.layerList.forEach((oneLayer) => {
			oneLayer.versionList.forEach((oneVersion) => {
				const setFilePath = path.join(subTreeDirPath, 'layer', oneLayer.layerKey, oneVersion.administrationRecord.versionTag, 'set.sssom.tsv');
				if (!fs.existsSync(setFilePath)) {
					fileReportList.push({ filePath: setFilePath, rendering: renderingName, kind: 'set', absent: true, pass: renderingName === 'public' });
					return;
				}
				const setText = fs.readFileSync(setFilePath, 'utf8');
				const parsed = parseSssomTsv(setText);
				const recomputation = layerPublicationLib.recordIdRecomputation({ setText });
				const validateRun = runChild(parameterValueFor('sssomValidatorPath'), ['validate', setFilePath]);
				const parsedFilePath = path.join(os.tmpdir(), `layerPublicationGate-${process.pid}.tsv`);
				const parseRun = runChild(parameterValueFor('sssomValidatorPath'), ['parse', setFilePath, '-o', parsedFilePath]);
				const sssomPyRowCount = fs.existsSync(parsedFilePath) ? fs.readFileSync(parsedFilePath, 'utf8').split('\n').filter((oneLine) => oneLine.length && !oneLine.startsWith('#')).length - 1 : -1;
				if (fs.existsSync(parsedFilePath)) {
					fs.unlinkSync(parsedFilePath);
				}
				const resolved = resolveImportRows({ sssomText: setText, prefixExpansionByPrefix: curieMapOf(parsed.headerLineList), goldCapture, importRules });
				const importedMsiList = resolved.error ? [] : resolved.acceptedList.map((oneAccepted) => msiOf(oneAccepted.subjectIri, oneAccepted.predicateIri, oneAccepted.objectIri));
				const heldSubjectCount = renderingName === 'public' ? parsed.rowList.filter((oneRow) => heldStandardKeyList.indexOf(oneRow.subject_id.slice(0, oneRow.subject_id.indexOf(':'))) !== -1).length : 0;
				const check = {
					recordIdRecomputes: recomputation.error === undefined,
					sssomValidateExit0: validateRun.status === 0,
					sssomParseKeepsEveryRow: parseRun.status === 0 && sssomPyRowCount === parsed.rowList.length,
					roundTripZeroRefusals: !resolved.error && resolved.refusalList.length === 0 && resolved.acceptedList.length === parsed.rowList.length,
					roundTripMsiEqualsSource: !resolved.error && sameMultiset(importedMsiList, sourceMsiListFor(oneLayer, oneVersion, renderingName === 'public')),
					zeroHeldSubjects: heldSubjectCount === 0,
				};
				fileReportList.push({ filePath: setFilePath, rendering: renderingName, kind: 'set', sha256: sha256Hex(setText), rowCount: parsed.rowList.length, sssomPyRowCount, refusalCount: resolved.error ? -1 : resolved.refusalList.length, heldSubjectCount, check, pass: Object.keys(check).every((oneCheck) => check[oneCheck]), detail: recomputation.error || resolved.error || (validateRun.status === 0 ? '' : `${validateRun.stderr}`.slice(-600)) });
				process.stdout.write(`${moduleName}: [gate] ${renderingName} ${oneLayer.layerKey}/${oneVersion.administrationRecord.versionTag}: ${Object.keys(check).filter((oneCheck) => !check[oneCheck]).join(', ') || 'GREEN'}\n`);
			});
		});
		listFilesUnder(subTreeDirPath).filter((oneFilePath) => /registry.*\.sssom\.yml$|\/registry\/layers\.sssom\.yml$/.test(oneFilePath) && (renderingName === 'public' || oneFilePath.indexOf(path.join(renderedDirPath, 'public')) !== 0)).forEach((registryFilePath) => {
			const linkmlRun = runChild(parameterValueFor('linkmlValidatorPath'), ['-s', parameterValueFor('sssomSchemaPath'), '-C', 'mapping registry', registryFilePath]);
			const linkmlText = `${linkmlRun.stdout}\n${linkmlRun.stderr}`;
			const pass = linkmlRun.status === 0 && linkmlText.indexOf('[ERROR]') === -1;
			fileReportList.push({ filePath: registryFilePath, rendering: renderingName, kind: 'registry', sha256: sha256Hex(fs.readFileSync(registryFilePath, 'utf8')), check: { linkmlValidates: pass }, pass, detail: pass ? '' : linkmlText.slice(-600) });
		});
		listFilesUnder(subTreeDirPath).filter((oneFilePath) => /\.jsonld$/.test(oneFilePath) && (renderingName === 'public' || oneFilePath.indexOf(path.join(renderedDirPath, 'public')) !== 0)).forEach((contextFilePath) => {
			const contextText = fs.readFileSync(contextFilePath, 'utf8');
			const standardKey = path.basename(contextFilePath, '.jsonld');
			const pass = renderingName !== 'public' || heldStandardKeyList.indexOf(standardKey) === -1;
			fileReportList.push({ filePath: contextFilePath, rendering: renderingName, kind: 'context', sha256: sha256Hex(contextText), check: { notAHeldStandard: pass }, pass });
		});
	});
	const publicFileList = listFilesUnder(path.join(renderedDirPath, 'public')).filter(isPublishedFile);
	const unboundPublicFile = publicFileList.find((oneFilePath) => !fileReportList.some((oneReport) => oneReport.filePath === oneFilePath && oneReport.sha256 !== undefined));
	const gateReport = {
		renderedDirPath,
		heldStandardKeyList,
		goldContainerName: goldCapture.goldContainerName,
		goldManifestRefId: goldCapture.manifestRefId,
		allGreen: fileReportList.every((oneReport) => oneReport.pass) && unboundPublicFile === undefined,
		unboundPublicFile: unboundPublicFile === undefined ? null : unboundPublicFile,
		fileReportList,
	};
	writeFileMakingDirs(parameterValueFor('gateReportPath'), `${JSON.stringify(gateReport, null, '\t')}\n`);
	process.stdout.write(`${moduleName}: gates ${gateReport.allGreen ? 'ALL GREEN' : 'RED'} over ${fileReportList.length} file(s); report ${parameterValueFor('gateReportPath')}\n`);
	process.exit(gateReport.allGreen ? 0 : 1);
};

// =====================================================================
// -publishPublic
// =====================================================================

const publishPublic = () => {
	const renderedDirPath = parameterValueFor('renderedDirPath');
	const publicDestinationDirPath = path.resolve(parameterValueFor('publicDestinationDirPath'));
	if (path.basename(publicDestinationDirPath) !== PUBLIC_DESTINATION_DIR_NAME) {
		refuseAndExit(`--publicDestinationDirPath ${publicDestinationDirPath} is not a directory named ${PUBLIC_DESTINATION_DIR_NAME} (the lane writes under downloadArtifacts/<gold>/${PUBLIC_DESTINATION_DIR_NAME}/ only)`);
	}
	const gateReport = JSON.parse(fs.readFileSync(parameterValueFor('gateReportPath'), 'utf8'));
	if (gateReport.allGreen !== true || path.resolve(gateReport.renderedDirPath) !== path.resolve(renderedDirPath)) {
		refuseAndExit(`the gate report is ${gateReport.allGreen ? 'green but for another rendered tree' : 'NOT green'}; nothing is published ungated (TQ Q37)`);
	}
	const publicDirPath = path.join(renderedDirPath, 'public');
	const publicFileList = listFilesUnder(publicDirPath).filter(isPublishedFile);
	const sha256ByFilePath = gateReport.fileReportList.reduce((soFar, oneReport) => ({ ...soFar, [oneReport.filePath]: oneReport.sha256 }), {});
	const driftedFile = publicFileList.find((oneFilePath) => sha256ByFilePath[oneFilePath] !== sha256Hex(fs.readFileSync(oneFilePath, 'utf8')));
	if (driftedFile !== undefined) {
		refuseAndExit(`${driftedFile} is not the bytes the gate bound (sha256 ${sha256ByFilePath[driftedFile] || 'never gated'}); re-run -gate`);
	}
	publicFileList.forEach((oneFilePath) => writeFileMakingDirs(path.join(publicDestinationDirPath, path.relative(publicDirPath, oneFilePath)), fs.readFileSync(oneFilePath, 'utf8')));
	process.stdout.write(`${moduleName}: published ${publicFileList.length} gated file(s) into ${publicDestinationDirPath}\n`);
};

const ACTION_BY_NAME = Object.freeze({ captureGold, render, gate, publishPublic });
ACTION_BY_NAME[actionName]();
