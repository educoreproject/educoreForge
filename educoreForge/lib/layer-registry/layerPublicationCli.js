#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// layerPublicationCli.js — the I/O shell of lib/layer-registry/layerPublication.js (mappingLayers ML3-a/b). No judge, no embedding.
//
// ACTIONS (exactly one):
//   -captureGold   read ONE gold READ-ONLY over bolt and freeze what rendering and import need into a JSON file: every HubReference card
//                  (stableId, uri, name), every ForgedNode element (stableId, _source), every standard root (name, key, version), the
//                  passport's manifestRefId and ⟪ML3.1⟫ each element's own name (subjectLabelList, by layerPublicationRules.json). Rendering reads this file, never the graph, so the same file gives the same bytes.
//       --goldContainerName=<container>  --goldCapturePath=<out.json>
//   -renderHubCards ⟪ML3.1c, TQ Q8⟫ the CARD DOWNLOAD: one cards.csv and one cards.jsonld per hub release from the capture's hubCardList
//                  (meaning URI, tier, domain, property, range, value, term, definition, each read from the card); a hub on the
//                  licence-hold list is refused by name.  --goldCapturePath  --licenceRulesPath=<downloadArtifactsRules.json>  --outputDirPath
//   -render        render every registered layer version (machine and curated) as ONE SSSOM set (R-b), one registry document per layer,
//                  the site registry, and one JSON-LD context per (version, standard), into --outputDirPath; with --publicFilterRulesPath
//                  ALSO a public filtered rendering of each (TQ Q37) under <outputDirPath>/public, never anywhere else.
//       --uriContractFilePath=<uriContract.sqlite> | --layerRegistryFilePath=<recipes/layers.json> --agentRegistryFilePath=<recipes/agents.json>  --storePath=<support store COPY>
//       --goldCapturePath=<capture.json>  --outputDirPath=<dir>  --publicFilterMode=licenceHoldList|none [--publicFilterRulesPath=<downloadArtifactsRules.json>, licenceHoldList only]
//   -gate          run the publication gates over a rendered tree (complete AND public) and write ONE gate report binding each file's
//                  sha256: (1) every record_id recomputes from its row; (2) sssom-py 'validate' exits 0 AND 'parse' keeps every row (a
//                  silent drop is a red, never a pass); (3) every registry document passes linkml-validate against sssom-schema; (4) ROUND
//                  TRIP: each set imports through lib/layer-import's resolver with ZERO refusals and its MSI multiset equals the source
//                  layer version's (decision blocks, or the stored curated set), held standards removed for a public set; (5) the public
//                  tree carries 0 subjects of a held standard. Exit 0 only when every gate is green.
//       --renderedDirPath=<render -outputDirPath>  --layerRegistryFilePath  --agentRegistryFilePath  --storePath  --goldCapturePath
//       --publicFilterMode [--publicFilterRulesPath]  --sssomValidatorPath=<sssom-py sssom>  --linkmlValidatorPath=<linkml-validate>
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
	render: ['storePath', 'goldCapturePath', 'outputDirPath', 'publicFilterMode'],
	gate: ['renderedDirPath', 'storePath', 'goldCapturePath', 'publicFilterMode', 'sssomValidatorPath', 'linkmlValidatorPath', 'sssomSchemaPath', 'gateReportPath'],
	publishPublic: ['renderedDirPath', 'gateReportPath', 'publicDestinationDirPath'],
	renderHubCards: ['goldCapturePath', 'licenceRulesPath', 'outputDirPath'],
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

// ⟪ML3.1c, TQ Q38: "mapping is not distribution"⟫ THE PUBLIC FILTER IS STATED, never defaulted: --publicFilterMode names one row of this
// map. licenceHoldList: the downloads rules' held standards are left out of the public renderings (--publicFilterRulesPath REQUIRED);
// none: nothing is left out, and every public set says public_filter "none" (it reads no rules file, so it can name none it ignored)
const PUBLIC_FILTER_BY_MODE = Object.freeze({
	licenceHoldList: () => {
		const rulesFilePath = parameterValueFor('publicFilterRulesPath');
		if (!rulesFilePath) {
			return { error: `-${actionName}: --publicFilterMode=licenceHoldList needs --publicFilterRulesPath` };
		}
		const downloadRules = JSON.parse(fs.readFileSync(rulesFilePath, 'utf8'));
		const filtered = require(path.join(__dirname, 'layerPublication')).publicFilterFor({ licenceHoldList: downloadRules.licenceHoldList, filterSourceText: `${path.basename(rulesFilePath)} licenceHoldList, sha256 ${sha256Hex(fs.readFileSync(rulesFilePath)).slice(0, 12)}` });
		return filtered.error ? filtered : { publicFilter: filtered.publicFilter, heldStandardKeyList: filtered.publicFilter.excludedStandardKeyList };
	},
	none: () => (parameterValueFor('publicFilterRulesPath') ? { error: `-${actionName}: --publicFilterMode=none reads no rules file; --publicFilterRulesPath is refused beside it` } : { publicFilter: require(path.join(__dirname, 'layerPublication')).NO_PUBLIC_FILTER, heldStandardKeyList: [] }),
});
const publicFilterFromMode = () => {
	const modeName = parameterValueFor('publicFilterMode');
	return PUBLIC_FILTER_BY_MODE[modeName] === undefined ? { error: `-${actionName}: --publicFilterMode=${JSON.stringify(modeName)} is not one of ${Object.keys(PUBLIC_FILTER_BY_MODE).join(', ')}` } : PUBLIC_FILTER_BY_MODE[modeName]();
};

// ⟪ML3.1b, by AMBER_JOURNEY's grant⟫ -render and -gate read the registry from EXACTLY ONE source: --uriContractFilePath (the registry of
// record once Part C retires the JSON) or --layerRegistryFilePath with --agentRegistryFilePath (until then)
const registryFromSource = () => {
	const uriContractFilePath = parameterValueFor('uriContractFilePath');
	const jsonGiven = Boolean(parameterValueFor('layerRegistryFilePath') || parameterValueFor('agentRegistryFilePath'));
	if (Boolean(uriContractFilePath) === jsonGiven) {
		return { error: `-${actionName}: name the registry by exactly one of --uriContractFilePath | --layerRegistryFilePath with --agentRegistryFilePath` };
	}
	if (!uriContractFilePath) {
		return layerRegistryLib.loadRegistry({ layerRegistryFilePath: parameterValueFor('layerRegistryFilePath'), agentRegistryFilePath: parameterValueFor('agentRegistryFilePath') });
	}
	const opened = require(path.join(__dirname, '..', 'uri-contract', 'uriContract')).openUriContractFile({ uriContractFilePath, accessMode: 'read' });
	return opened.error ? opened : opened.uriContract.loadRegistry();
};
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
	// ⟪ML3.1, Q42⟫ each element's OWN name: the forge-written property layerPublicationRules.json names for its subject prefix (O-2)
	// ⟪ML3.1c, TQ Q8⟫ every hub card's own fields, for the card download per hub release (hubCardPublication.js)
	hubCardList: 'MATCH (h:HubReference) WHERE h.uri IS NOT NULL RETURN h{.uri, .hubName, .hubVersion, .referenceTier, .domainId, .domainName, .propertyKey, .propertyName, .rangeOptionSetName, .rangeClassName, .rangeDatatype, .rangeOptionSetNameList, .rangeClassNameList, .rangeDatatypeList, .valueKey, .valueName, .termIri, .termName, .valueDefinition, .propertyDefinition, .termDefinition} AS card ORDER BY h.uri',
	subjectLabelList: 'MATCH (n:ForgedNode) WHERE n.stableId IS NOT NULL AND NOT n:HubReference WITH n, split(n.stableId, \':\')[0] AS subjectPrefix WHERE subjectPrefix IN keys($labelPropertyNameBySubjectPrefix) WITH n, n[$labelPropertyNameBySubjectPrefix[subjectPrefix]] AS label WHERE label IS NOT NULL RETURN n.stableId AS stableId, label ORDER BY stableId',
});
// the parameters a capture query takes (DATA beside the queries); a query with no row here takes none
const SUBJECT_LABEL_RULE_BY_PREFIX = require(path.join(__dirname, 'layerPublicationRules.json')).subjectLabelPropertyNameBySubjectPrefix;
const LABEL_PROPERTY_NAME_BY_SUBJECT_PREFIX = Object.keys(SUBJECT_LABEL_RULE_BY_PREFIX)
	.filter((oneSubjectPrefix) => oneSubjectPrefix !== 'about')
	.reduce((soFar, oneSubjectPrefix) => ({ ...soFar, [oneSubjectPrefix]: SUBJECT_LABEL_RULE_BY_PREFIX[oneSubjectPrefix] }), {});
const CAPTURE_PARAMETERS_BY_NAME = Object.freeze({ subjectLabelList: { labelPropertyNameBySubjectPrefix: LABEL_PROPERTY_NAME_BY_SUBJECT_PREFIX } });
// a property arrives as a scalar or, across the bolt boundary, as a one-value list (ML3 trap): the label is its FIRST value, verbatim
const firstValueOf = (rawValue) => (Array.isArray(rawValue) ? rawValue[0] : rawValue);

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
					// a field named *List stays a list; any other arrives as a scalar or a one-value list (the bolt trap) and keeps its first value
					capture.hubCardList = capture.hubCardList.map((oneRow) => Object.keys(oneRow.card).reduce((soFar, fieldName) => (oneRow.card[fieldName] === null ? soFar : { ...soFar, [fieldName]: /List$/.test(fieldName) ? oneRow.card[fieldName] : firstValueOf(oneRow.card[fieldName]) }), {}));
					capture.subjectLabelList = capture.subjectLabelList.map((oneRow) => ({ stableId: oneRow.stableId, label: String(firstValueOf(oneRow.label)) }));
					writeFileMakingDirs(parameterValueFor('goldCapturePath'), `${JSON.stringify(capture)}\n`);
					process.stdout.write(`${moduleName}: captured ${capture.cardList.length} cards, ${capture.elementList.length} elements, ${capture.standardList.length} standards from ${capture.goldContainerName} (manifest ${capture.manifestRefId})\n`);
				});
				return;
			}
			const session = driver.session({ defaultAccessMode: neo4j.session.READ });
			session
				.run(CAPTURE_QUERY_BY_NAME[queryNameList[queryIndex]], CAPTURE_PARAMETERS_BY_NAME[queryNameList[queryIndex]] === undefined ? {} : CAPTURE_PARAMETERS_BY_NAME[queryNameList[queryIndex]])
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
	const loaded = exitOnError(registryFromSource());
	const { registry } = loaded;
	const goldCapture = JSON.parse(fs.readFileSync(parameterValueFor('goldCapturePath'), 'utf8'));
	const cardByStableId = goldCapture.cardList.reduce((soFar, oneCard) => {
		soFar[oneCard.stableId] = { uri: oneCard.uri, name: oneCard.name };
		return soFar;
	}, {});
	// ⟪ML3.1⟫ a capture made before subject labels existed is refused by name, never rendered with every label empty
	if (!Array.isArray(goldCapture.subjectLabelList)) {
		refuseAndExit(`${parameterValueFor('goldCapturePath')} has no subjectLabelList: re-run -captureGold (ML3.1 Q42: every set carries subject_label)`);
	}
	const subjectLabelByStableId = goldCapture.subjectLabelList.reduce((soFar, oneRow) => {
		soFar[oneRow.stableId] = oneRow.label;
		return soFar;
	}, {});
	const { publicFilter } = exitOnError(publicFilterFromMode());
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
							memberRowsByBlockHash[oneMember.decisionBlockHash] = exitOnError(layerPublicationLib.machineMemberRowsFor({ member: oneMember, decisionBlock: JSON.parse(frozenTextFor(oneMember.decisionBlockHash)), cardByStableId, subjectLabelByStableId })).memberRows;
						}
						return { ...memberRowsByBlockHash[oneMember.decisionBlockHash], member: { pairKey: oneMember.pairKey, decisionBlockHash: oneMember.decisionBlockHash } };
					})
				: undefined;
			const wholeSetText = oneVersion.contentIdBasis === 'frozenSetBytes' ? frozenTextFor(oneVersion.wholeSetBlock.decisionBlockHash) : undefined;
			renderingList.forEach((oneRendering) => {
				const rendered = exitOnError(memberRowsList !== undefined
					? layerPublicationLib.machineVersionSetText({ layer: oneLayer, version: oneVersion, memberRowsList, publicFilter: oneRendering.filter })
					: layerPublicationLib.curatedVersionSetText({ layer: oneLayer, version: oneVersion, wholeSetText, publicFilter: oneRendering.filter, subjectLabelByStableId }));
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
				layerReport.versionList.push({ versionTag, rendering: oneRendering.filter === undefined ? 'complete' : 'publicFiltered', mappingSetId: rendered.mappingSetId, rowCount: rendered.rowCount, fullRowCount: rendered.fullRowCount, emptySubjectLabelCount: rendered.emptySubjectLabelCount, setSha256: sha256Hex(rendered.setText), contextStandardKeyList: contexts.contextDocumentList.map((oneContext) => oneContext.standardKey) });
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
	const { registry } = exitOnError(registryFromSource());
	const goldCapture = JSON.parse(fs.readFileSync(parameterValueFor('goldCapturePath'), 'utf8'));
	const { heldStandardKeyList } = exitOnError(publicFilterFromMode());
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

// =====================================================================
// -renderHubCards ⟪ML3.1c, TQ Q8⟫ one CSV and one JSON-LD per hub release, from the gold capture; a held hub is refused by name
// =====================================================================

const renderHubCards = () => {
	const goldCapture = JSON.parse(fs.readFileSync(parameterValueFor('goldCapturePath'), 'utf8'));
	if (!Array.isArray(goldCapture.hubCardList)) {
		refuseAndExit(`${parameterValueFor('goldCapturePath')} has no hubCardList: re-run -captureGold (ML3.1c, the card download)`);
	}
	const licenceRules = JSON.parse(fs.readFileSync(parameterValueFor('licenceRulesPath'), 'utf8'));
	const hubBundleTokenByHubName = require(path.join(__dirname, 'layerPublicationRules.json')).hubBundleTokenByHubName;
	const rendered = exitOnError(require(path.join(__dirname, 'hubCardPublication')).hubCardFileListFor({ cardList: goldCapture.hubCardList, hubBundleTokenByHubName, heldBundleTokenList: licenceRules.licenceHoldList.map((oneHold) => oneHold.bundleToken) }));
	const report = { goldContainerName: goldCapture.goldContainerName, goldManifestRefId: goldCapture.manifestRefId, hubFileList: [] };
	rendered.hubFileList.forEach((oneHubFile) => {
		const releaseDirPath = path.join(parameterValueFor('outputDirPath'), 'hubCards', oneHubFile.hubSegment, oneHubFile.hubReleaseSegment);
		writeFileMakingDirs(path.join(releaseDirPath, 'cards.csv'), oneHubFile.csvText);
		writeFileMakingDirs(path.join(releaseDirPath, 'cards.jsonld'), oneHubFile.jsonLdText);
		report.hubFileList.push({ hubName: oneHubFile.hubName, hubVersion: oneHubFile.hubVersion, hubSegment: oneHubFile.hubSegment, hubReleaseSegment: oneHubFile.hubReleaseSegment, cardCount: oneHubFile.cardCount, csvSha256: sha256Hex(oneHubFile.csvText), jsonLdSha256: sha256Hex(oneHubFile.jsonLdText) });
	});
	writeFileMakingDirs(path.join(parameterValueFor('outputDirPath'), 'hubCards', 'hubCards-report.json'), `${JSON.stringify(report, null, '\t')}\n`);
	process.stdout.write(`${moduleName}: rendered the cards of ${report.hubFileList.map((oneHubFile) => `${oneHubFile.hubName} ${oneHubFile.hubVersion} (${oneHubFile.cardCount})`).join(', ')} into ${parameterValueFor('outputDirPath')}/hubCards\n`);
};

const ACTION_BY_NAME = Object.freeze({ captureGold, render, gate, publishPublic, renderHubCards });
ACTION_BY_NAME[actionName]();
