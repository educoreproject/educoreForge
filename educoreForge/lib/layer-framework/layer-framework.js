'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// layer-framework.js — the LAYER role of a standard's kit (lane DES, campaign cedsRichness-101226, 2026-10-12; COPPER_RIVER
// ruling Q1). A layer is a separately published, separately versioned companion of ONE standard (vocabulary
// SCHEMA_BLOCK_KIND.LAYER): its nodes are its own, its edges may land on that standard's base nodes, it requires exactly that
// base block, and it never relates the standard to another standard (FBB-001).
//
// THE BUNDLE DECLARES, THE RECIPE ACTIVATES (the hubModule pattern, SPEC-hubKitRole §4.2):
//   forges/<standard>/layers/<layerKey>/layerDescriptor.ini   [layerDescriptor] layerKey, displayName, entryModule,
//                                                            defaultSnapshot, sourceFileList, layerVersion, layerLabel,
//                                                            roundTripValidator
//   forges/<standard>/layers/<layerKey>/assets/layerSourceData/<NN>/   the pinned snapshot: the bytes, SHA256SUMS,
//                                                            README_PROVENANCE.md, LICENSE, layerSourceLocation
//   forges/<standard>/parserDescriptor.ini  layerNamespace=   the ONE declared home of every layer id's root
//
// THE PRODUCER (the layer's entryModule) exports { layerDeclaration, produceLayer }:
//   layerDeclaration = { layerKey, roleList, edgeTypeList }      DATA: what the layer may mint
//   produceLayer({ sourceFilePathByName, baseIndex, layerIdentity }, callback(errString, { nodes, edges, layerReport }))
// It returns PRODUCER-shape nodes ({ labels, stableId, role, properties }) and edges ({ type, fromStableId, toStableId,
// properties }), plus optional rootPropertyByName (counts the root should carry) and layerReport (diagnostics). It never
// stamps _source, _id, uri, role, layerKey, layerVersion, ForgedNode or the layer label into properties: this framework
// does, the same way on every layer. The FRAMEWORK mints the layer root (provenance from the snapshot's layerSourceLocation
// and SHA256SUMS, never from the producer) and the HAS_LAYER edge from the standard's root; the producer links its own top
// nodes FROM layerIdentity.layerRootStableId.
//
// INTEGRITY, refused by name (this is where layer bytes ENTER the build; FBB-001 and R3 are enforced here, once):
//   a duplicate stableId; a stableId outside the layer's id root; a role the declaration does not list or that is not a
//   layer role; a node with no name; an absent or null property value; an edge type the declaration does not list; an
//   edge with no valid provenanceTier; an endpoint that is neither a layer node nor a base node; an edge between two base
//   nodes (a layer never adds to its base).
//
// Control flow: err-string-first callbacks; no async/await; try/catch only at the require boundary.

const fs = require('fs');
const path = require('path');
const configFileProcessor = require('qtools-config-file-processor');
const vocabulary = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const sourceVerificationLib = require(path.join(__dirname, '..', 'forge-framework', 'sourceVerification'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const LAYERS_DIR_NAME = 'layers';
const LAYER_DESCRIPTOR_FILE_NAME = 'layerDescriptor.ini';
const LAYER_SOURCE_DATA_DIR_NAME = path.join('assets', 'layerSourceData');
const LAYER_SOURCE_LOCATION_FILE_NAME = 'layerSourceLocation';
const CHECKSUM_FILE_NAME = 'SHA256SUMS';
const REQUIRED_DESCRIPTOR_FIELD_LIST = Object.freeze(['layerKey', 'displayName', 'entryModule', 'defaultSnapshot', 'sourceFileList', 'layerVersion', 'layerLabel', 'roundTripValidator']);
const REQUIRED_SOURCE_LOCATION_FIELD_LIST = Object.freeze(['publishedVersion', 'publishedVersionEvidence', 'upstreamUrl', 'upstreamCommit', 'licence']);
// the properties the FRAMEWORK owns on every layer node; a producer that stamps one is refused, so no layer can disagree
const FRAMEWORK_OWNED_PROPERTY_NAME_LIST = Object.freeze(['_id', '_source', 'uri', 'layerKey', 'layerVersion', 'role']);

const refusal = (what, where) => refuse.byName({ moduleName, what, where }).message;

// -----
// unwrapScalar — engine-shape properties are PG-JSON arrays; a one-element array is a scalar (README_addingAField's
// "shape-agnostic unwrap": never test Array.isArray to decide what a value MEANS)
const unwrapScalar = (propertyValue) => (Array.isArray(propertyValue) && propertyValue.length === 1 ? propertyValue[0] : propertyValue);

// buildBaseIndex — a READ-ONLY view of the standard's engine-shape base nodeEdges, built once per layer run
const buildBaseIndex = ({ baseNodeEdges }) => {
	const nodeByStableId = {};
	const nodeListByRole = {};
	(baseNodeEdges.nodes || []).forEach((oneNode) => {
		const propertyByName = {};
		Object.keys(oneNode.properties || {}).forEach((onePropertyName) => {
			propertyByName[onePropertyName] = unwrapScalar(oneNode.properties[onePropertyName]);
		});
		const indexedNode = { stableId: oneNode.stableId, labels: oneNode.labels || [], role: propertyByName.role, propertyByName };
		nodeByStableId[oneNode.stableId] = indexedNode;
		(nodeListByRole[indexedNode.role] = nodeListByRole[indexedNode.role] || []).push(indexedNode);
	});
	const outgoingByTypeAndFrom = {};
	(baseNodeEdges.edges || []).forEach((oneEdge) => {
		const byFrom = (outgoingByTypeAndFrom[oneEdge.type] = outgoingByTypeAndFrom[oneEdge.type] || {});
		(byFrom[oneEdge.fromRef.id] = byFrom[oneEdge.fromRef.id] || []).push(oneEdge.toRef.id);
	});
	return {
		nodeByStableId,
		nodeListOfRole: (role) => nodeListByRole[role] || [],
		targetStableIdListOf: ({ edgeType, fromStableId }) => ((outgoingByTypeAndFrom[edgeType] || {})[fromStableId] || []).slice(),
	};
};

// readKeyValueFile — the `name: value` provenance records every snapshot keeps (standardSourceLocation's shape)
const readKeyValueFile = (filePath) => {
	const valueByName = {};
	fs.readFileSync(filePath, 'utf8')
		.split('\n')
		.forEach((oneLine) => {
			const lineMatch = /^([A-Za-z][A-Za-z0-9]*):\s?(.*)$/.exec(oneLine);
			if (lineMatch) {
				valueByName[lineMatch[1]] = lineMatch[2].trim();
			}
		});
	return valueByName;
};

// -----
// declaredLayerKeyList — every layer a standard's kit declares (a directory under layers/ carrying a layerDescriptor.ini)
const declaredLayerKeyList = ({ bundleDir }) => {
	const layersDirPath = path.join(bundleDir, LAYERS_DIR_NAME);
	if (!fs.existsSync(layersDirPath)) {
		return [];
	}
	return fs
		.readdirSync(layersDirPath, { withFileTypes: true })
		.filter((oneEntry) => oneEntry.isDirectory() && fs.existsSync(path.join(layersDirPath, oneEntry.name, LAYER_DESCRIPTOR_FILE_NAME)))
		.map((oneEntry) => oneEntry.name)
		.sort();
};

// resolveLayer — read and validate one layer's descriptor and pin its snapshot; { error } or the resolved facts
const resolveLayer = ({ bundleDir, layerKey }) => {
	const layerDirPath = path.join(bundleDir, LAYERS_DIR_NAME, `${layerKey}`);
	const descriptorPath = path.join(layerDirPath, LAYER_DESCRIPTOR_FILE_NAME);
	if (!fs.existsSync(descriptorPath)) {
		return { error: refusal(`no layer '${layerKey}' in ${bundleDir} (no ${descriptorPath})`, `layers this kit declares: ${declaredLayerKeyList({ bundleDir }).join(', ') || '(none)'}`) };
	}
	// qtools-config-file-processor DISCARDS sectionless keys, so an absent section is a layer that declares nothing
	const descriptor = (configFileProcessor.getConfig(descriptorPath) || {}).layerDescriptor;
	if (!descriptor) {
		return { error: refusal(`${descriptorPath} has no [layerDescriptor] section`, `a layer IS its descriptor; it declares ${REQUIRED_DESCRIPTOR_FIELD_LIST.join(', ')} (sectionless keys are discarded by the ini reader)`) };
	}
	const missingFieldList = REQUIRED_DESCRIPTOR_FIELD_LIST.filter((fieldName) => descriptor[fieldName] === undefined || `${descriptor[fieldName]}`.trim() === '');
	if (missingFieldList.length) {
		return { error: refusal(`${descriptorPath} declares no ${missingFieldList.join(', ')}`, 'every field of [layerDescriptor] is required; there is no default') };
	}
	if (`${descriptor.layerKey}` !== `${layerKey}`) {
		return { error: refusal(`${descriptorPath} declares layerKey '${descriptor.layerKey}' but sits in directory '${layerKey}'`, 'a layer key IS its directory') };
	}
	// defaultSnapshot is coerced to a NUMBER by the ini reader ('01' -> 1): match the directory numerically (forger's rule)
	const snapshotsDirPath = path.join(layerDirPath, LAYER_SOURCE_DATA_DIR_NAME);
	const snapshotDirNameList = fs.existsSync(snapshotsDirPath) ? fs.readdirSync(snapshotsDirPath, { withFileTypes: true }).filter((oneEntry) => oneEntry.isDirectory()).map((oneEntry) => oneEntry.name) : [];
	const matchingDirNameList = snapshotDirNameList.filter((oneName) => Number(oneName) === Number(descriptor.defaultSnapshot));
	if (matchingDirNameList.length !== 1) {
		return { error: refusal(`layer '${layerKey}' defaultSnapshot '${descriptor.defaultSnapshot}' matches ${matchingDirNameList.length} snapshot directories (found: ${snapshotDirNameList.join(', ') || 'none'})`, `pin exactly one directory under ${snapshotsDirPath}`) };
	}
	const snapshotDirPath = path.join(snapshotsDirPath, matchingDirNameList[0]);
	const sourceFileList = `${descriptor.sourceFileList}`.split(',').map((oneName) => oneName.trim()).filter((oneName) => oneName !== '');
	const locationPath = path.join(snapshotDirPath, LAYER_SOURCE_LOCATION_FILE_NAME);
	if (!fs.existsSync(locationPath)) {
		return { error: refusal(`layer '${layerKey}' snapshot ${snapshotDirPath} carries no ${LAYER_SOURCE_LOCATION_FILE_NAME}`, 'doctrine RT-12: a snapshot records where its bytes came from (URL, commit, licence)') };
	}
	const sourceLocation = readKeyValueFile(locationPath);
	const missingLocationFieldList = REQUIRED_SOURCE_LOCATION_FIELD_LIST.filter((fieldName) => !sourceLocation[fieldName]);
	if (missingLocationFieldList.length) {
		return { error: refusal(`${locationPath} records no ${missingLocationFieldList.join(', ')}`, 'doctrine RT-12: URL, commit, licence and the published version with its evidence are all required') };
	}
	if (`${sourceLocation.publishedVersion}` !== `${descriptor.layerVersion}`) {
		return { error: refusal(`layer '${layerKey}' declares layerVersion '${descriptor.layerVersion}' but its snapshot records publishedVersion '${sourceLocation.publishedVersion}'`, 'the descriptor and the provenance record must agree; neither is preferred') };
	}
	return {
		layerKey: `${descriptor.layerKey}`,
		displayName: `${descriptor.displayName}`,
		layerDirPath,
		entryPath: path.join(layerDirPath, `${descriptor.entryModule}`),
		snapshotDirPath,
		snapshotKey: matchingDirNameList[0],
		sourceFileList,
		layerVersion: `${descriptor.layerVersion}`,
		layerLabel: `${descriptor.layerLabel}`,
		roundTripValidatorPath: path.join(layerDirPath, `${descriptor.roundTripValidator}`),
		sourceLocation,
	};
};

// layerIdentityFor — the ids and names every node of one layer run shares
const layerIdentityFor = ({ resolvedLayer, standardName, layerNamespace }) => {
	const layerRootStableId = `${layerNamespace}${resolvedLayer.layerKey}/${vocabulary.slugifyVersion(resolvedLayer.layerVersion)}/`;
	return {
		standardName,
		layerKey: resolvedLayer.layerKey,
		layerVersion: resolvedLayer.layerVersion,
		layerLabel: resolvedLayer.layerLabel,
		layerRootStableId,
		stableIdFor: (kindToken, naturalIdText) => `${layerRootStableId}${kindToken}/${encodeURIComponent(naturalIdText)}`,
	};
};

// integrityRefusal — '' or the first violation, named
const integrityRefusal = ({ produced, layerDeclaration, layerIdentity, baseIndex }) => {
	const layerStableIdSet = new Set();
	for (const oneNode of produced.nodes) {
		if (typeof oneNode.stableId !== 'string' || !oneNode.stableId.startsWith(layerIdentity.layerRootStableId)) {
			return `node ${JSON.stringify(oneNode.stableId)} lies outside the layer's id root ${layerIdentity.layerRootStableId}`;
		}
		if (layerStableIdSet.has(oneNode.stableId)) {
			return `node ${oneNode.stableId} is minted twice`;
		}
		layerStableIdSet.add(oneNode.stableId);
		const role = oneNode.role;
		if (vocabulary.LAYER_ROLE_LIST.indexOf(role) === -1 || layerDeclaration.roleList.indexOf(role) === -1) {
			return `node ${oneNode.stableId} has role ${JSON.stringify(role)}, which is not a layer role this layer declares (${layerDeclaration.roleList.join(', ')})`;
		}
		const ownedName = FRAMEWORK_OWNED_PROPERTY_NAME_LIST.find((onePropertyName) => Object.prototype.hasOwnProperty.call(oneNode.properties, onePropertyName));
		if (ownedName) {
			return `node ${oneNode.stableId} stamps '${ownedName}', which the layer framework owns`;
		}
		if (typeof oneNode.properties.name !== 'string' || oneNode.properties.name.trim() === '') {
			return `node ${oneNode.stableId} carries no name`;
		}
		const absentName = Object.keys(oneNode.properties).find((onePropertyName) => oneNode.properties[onePropertyName] === undefined || oneNode.properties[onePropertyName] === null);
		if (absentName) {
			return `node ${oneNode.stableId} carries '${absentName}' with no value — an absent value is left off, never written as null`;
		}
	}
	for (const oneEdge of produced.edges) {
		if (layerDeclaration.edgeTypeList.indexOf(oneEdge.type) === -1) {
			return `edge type ${JSON.stringify(oneEdge.type)} is not one this layer declares (${layerDeclaration.edgeTypeList.join(', ')})`;
		}
		if (!vocabulary.isValidProvenanceTier((oneEdge.properties || {}).provenanceTier)) {
			return `edge ${oneEdge.type} ${oneEdge.fromStableId} -> ${oneEdge.toStableId} carries no valid provenanceTier`;
		}
		const fromIsLayer = layerStableIdSet.has(oneEdge.fromStableId);
		const toIsLayer = layerStableIdSet.has(oneEdge.toStableId);
		const fromIsBase = !!baseIndex.nodeByStableId[oneEdge.fromStableId];
		const toIsBase = !!baseIndex.nodeByStableId[oneEdge.toStableId];
		if (!(fromIsLayer || fromIsBase) || !(toIsLayer || toIsBase)) {
			return `edge ${oneEdge.type} ${oneEdge.fromStableId} -> ${oneEdge.toStableId} has an endpoint that is neither a layer node nor a base node`;
		}
		if (!fromIsLayer && !toIsLayer) {
			return `edge ${oneEdge.type} ${oneEdge.fromStableId} -> ${oneEdge.toStableId} joins two base nodes — a layer never adds to its base`;
		}
		const absentEdgeProperty = Object.keys(oneEdge.properties || {}).find((onePropertyName) => oneEdge.properties[onePropertyName] === undefined || oneEdge.properties[onePropertyName] === null);
		if (absentEdgeProperty) {
			return `edge ${oneEdge.type} ${oneEdge.fromStableId} -> ${oneEdge.toStableId} carries '${absentEdgeProperty}' with no value`;
		}
	}
	return '';
};

// rootNodeFor — the layer root the framework mints: provenance read from the verified snapshot, never from the producer
const rootNodeFor = ({ resolvedLayer, layerIdentity, verifiedChecksumByFileName, rootPropertyByName }) => ({
	labels: [`${resolvedLayer.layerLabel}Root`],
	stableId: layerIdentity.layerRootStableId,
	role: vocabulary.DME_ROLES.LAYER_ROOT,
	properties: {
		name: `${resolvedLayer.displayName}`,
		description: `${resolvedLayer.displayName}, layer '${resolvedLayer.layerKey}' version ${resolvedLayer.layerVersion} of ${layerIdentity.standardName}: a separately published companion of the standard, carried beside it and never written onto it.`,
		sourceUrl: resolvedLayer.sourceLocation.upstreamUrl,
		sourceCommit: resolvedLayer.sourceLocation.upstreamCommit,
		sourceLicence: resolvedLayer.sourceLocation.licence,
		publishedVersionEvidence: resolvedLayer.sourceLocation.publishedVersionEvidence,
		sourceFiles: resolvedLayer.sourceFileList.slice(),
		sourceFileChecksumText: JSON.stringify(resolvedLayer.sourceFileList.reduce((soFar, oneName) => ({ ...soFar, [oneName]: verifiedChecksumByFileName[oneName] }), {})),
		snapshotKey: resolvedLayer.snapshotKey,
		...rootPropertyByName,
	},
});

// stampFrameworkProperties — the producer-shape nodes and edges, with the framework's owned properties and labels
const stampedGraphFor = ({ nodeList, edgeList, layerIdentity }) => ({
	nodes: nodeList.map((oneNode) => ({
		labels: [vocabulary.NODE_LABELS.FORGED_NODE, layerIdentity.layerLabel].concat(oneNode.labels || []),
		stableId: oneNode.stableId,
		properties: {
			...oneNode.properties,
			_id: oneNode.stableId,
			_source: layerIdentity.standardName,
			uri: oneNode.stableId,
			role: oneNode.role,
			layerKey: layerIdentity.layerKey,
			layerVersion: layerIdentity.layerVersion,
		},
	})),
	edges: edgeList.map((oneEdge) => ({
		type: oneEdge.type,
		fromRef: { source: layerIdentity.standardName, id: oneEdge.fromStableId },
		toRef: { source: layerIdentity.standardName, id: oneEdge.toStableId },
		properties: { ...oneEdge.properties },
	})),
});

const countBy = (itemList, nameOf) => itemList.reduce((soFar, oneItem) => ({ ...soFar, [nameOf(oneItem)]: (soFar[nameOf(oneItem)] || 0) + 1 }), {});

// -----
// forgeLayer — verify, produce, check, stamp. callback(errString, { stampedGraph, harvestEdgeTypeList, layerStats,
// layerReport, layerIdentity }). stampedGraph is PRODUCER shape with the framework's stamps; the forger shapes it for the engine.
const forgeLayer = ({ resolvedLayer, baseNodeEdges, standardName, layerNamespace } = {}, callback) => {
	if (typeof layerNamespace !== 'string' || !/^https?:\/\/\S+\/$/.test(layerNamespace)) {
		callback(refusal(`layerNamespace is ${JSON.stringify(layerNamespace)}`, "the standard's parserDescriptor.ini declares layerNamespace= (an http(s) root ending in '/'), the one home of every layer id root"));
		return;
	}
	if (!baseNodeEdges || !Array.isArray(baseNodeEdges.nodes) || !Array.isArray(baseNodeEdges.edges)) {
		callback(refusal('baseNodeEdges carries no nodes[] and edges[]', "a layer is produced over its standard's base, forged in the same build"));
		return;
	}
	sourceVerificationLib.verifySnapshotChecksums({ snapshotDirPath: resolvedLayer.snapshotDirPath, relativePathList: resolvedLayer.sourceFileList }, (verifyError) => {
		if (verifyError) {
			callback(`layer '${resolvedLayer.layerKey}' source verification: ${verifyError}`);
			return;
		}
		const verifiedChecksumByFileName = {};
		fs.readFileSync(path.join(resolvedLayer.snapshotDirPath, CHECKSUM_FILE_NAME), 'utf8')
			.split('\n')
			.forEach((oneLine) => {
				const lineMatch = /^([0-9a-f]{64})[ \t]+\*?(.+?)\s*$/.exec(oneLine.trim());
				if (lineMatch) {
					verifiedChecksumByFileName[lineMatch[2]] = lineMatch[1];
				}
			});
		let producerModule;
		try {
			producerModule = require(resolvedLayer.entryPath);
		} catch (requireError) {
			callback(refusal(`layer '${resolvedLayer.layerKey}' entryModule ${resolvedLayer.entryPath} does not load: ${requireError.message}`, 'the layer descriptor names the producer file'));
			return;
		}
		const { layerDeclaration, produceLayer } = producerModule || {};
		if (!layerDeclaration || typeof produceLayer !== 'function' || layerDeclaration.layerKey !== resolvedLayer.layerKey || !Array.isArray(layerDeclaration.roleList) || !Array.isArray(layerDeclaration.edgeTypeList)) {
			callback(refusal(`layer '${resolvedLayer.layerKey}' entryModule exports no { layerDeclaration { layerKey, roleList, edgeTypeList }, produceLayer } for this layer`, resolvedLayer.entryPath));
			return;
		}
		const baseIndex = buildBaseIndex({ baseNodeEdges });
		const baseRootList = baseIndex.nodeListOfRole(vocabulary.DME_ROLES.STANDARD_ROOT);
		if (baseRootList.length !== 1) {
			callback(refusal(`the base nodeEdges hold ${baseRootList.length} DmeStandardRoot nodes`, 'a layer hangs on exactly one standard root'));
			return;
		}
		const layerIdentity = layerIdentityFor({ resolvedLayer, standardName, layerNamespace });
		const sourceFilePathByName = resolvedLayer.sourceFileList.reduce((soFar, oneName) => ({ ...soFar, [oneName]: path.join(resolvedLayer.snapshotDirPath, oneName) }), {});
		produceLayer({ sourceFilePathByName, baseIndex, layerIdentity }, (produceError, produced) => {
			if (produceError) {
				callback(`layer '${resolvedLayer.layerKey}' producer: ${produceError}`);
				return;
			}
			const rootNode = rootNodeFor({ resolvedLayer, layerIdentity, verifiedChecksumByFileName, rootPropertyByName: produced.rootPropertyByName || {} });
			const nodeList = [rootNode].concat(produced.nodes);
			const edgeList = [{ type: vocabulary.EDGE_TYPES.HAS_LAYER, fromStableId: baseRootList[0].stableId, toStableId: layerIdentity.layerRootStableId, properties: { provenanceTier: vocabulary.PROVENANCE_TIER.STRUCTURAL } }].concat(produced.edges);
			const checkedDeclaration = { ...layerDeclaration, roleList: [vocabulary.DME_ROLES.LAYER_ROOT].concat(layerDeclaration.roleList), edgeTypeList: [vocabulary.EDGE_TYPES.HAS_LAYER].concat(layerDeclaration.edgeTypeList) };
			const integrityFault = integrityRefusal({ produced: { nodes: nodeList, edges: edgeList }, layerDeclaration: checkedDeclaration, layerIdentity, baseIndex });
			if (integrityFault) {
				callback(refusal(`layer '${resolvedLayer.layerKey}': ${integrityFault}`, `${resolvedLayer.entryPath} (layer integrity: where layer bytes enter the build)`));
				return;
			}
			const stampedGraph = stampedGraphFor({ nodeList, edgeList, layerIdentity });
			callback('', {
				stampedGraph,
				harvestEdgeTypeList: checkedDeclaration.edgeTypeList.slice(),
				layerStats: {
					nodeCountByRole: countBy(stampedGraph.nodes, (oneNode) => oneNode.properties.role),
					edgeCountByType: countBy(stampedGraph.edges, (oneEdge) => oneEdge.type),
				},
				layerReport: produced.layerReport || {},
				layerIdentity,
			});
		});
	});
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => ({ declaredLayerKeyList, resolveLayer, forgeLayer, buildBaseIndex, layerIdentityFor, integrityRefusal, unwrapScalar, readKeyValueFile });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
