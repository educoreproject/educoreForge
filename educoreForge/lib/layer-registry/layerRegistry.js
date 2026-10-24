'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// layerRegistry.js — the mapping-layer registry and the agent registry (mappingLayers ML1-b; SPEC §3.3, §4.5, §7; rulings R-1, R-4
// of DESIGN-ML1a, BRONZE_CROWN 2026-10-24). The registries are DATA (recipes/layers.json, recipes/agents.json); what they may say
// is DATA too (layerRegistrySchema.json). PURE and synchronous: every function RETURNS { error } or its result.
//
//   registryFor({ layerRegistry, agentRegistry })            → { registry } | { error }    validates both, whole
//   loadRegistry({ layerRegistryFilePath, agentRegistryFilePath }) → the same, from the two files
//   registry.layerFor(layerKey)                               → { layer } | { error }      an unknown layerKey refused by name
//   registry.versionFor({ layerKey, versionTag })             → { version } | { error }
//   registry.currentStandardVersionFor(layerKey)              → { version } | { error }    the latest-published STANDARD version
//   registry.withAppendedVersion({ layerKey, version })       → { layerRegistry } | { error }  a NEW registry object; nothing mutated
//   contentIdForMemberBlockList(memberBlockList)              → sha256 of the sorted, '\n'-joined member decisionBlockHashes (R-1)
//
// A version is refused by name when: its status is outside the ISO/IEC 11179 list; its administration record lacks a field; its
// tag is used by another version of the same layer (a tag is NEVER reassigned); its content id does not match its basis; or an
// agent it names is not in the agent registry. A floating layer follows its Standard version, never merely its newest (SPEC §5.3).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const edcUri = require(path.join(__dirname, '..', 'edc-uri', 'edcUri'));
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));

const LAYER_REGISTRY_SCHEMA = require(path.join(__dirname, 'layerRegistrySchema.json'));
const { DECISION_BLOCK_PRODUCER_KIND_LIST } = vocabularyLib;

// CONTENT_ID_BASIS_REGISTRY — how a version's content id is computed from what it records, one row per basis (DATA, no branch)
//   sortedMemberBlockHashList: a machine layer version spans one decision block per (source, hub) pair (R-1)
//   frozenSetBytes: a published SSSOM set; the whole set is itself frozen as one block whose hash IS the content id (R-4)
const CONTENT_ID_BASIS_REGISTRY = Object.freeze({
	sortedMemberBlockHashList: (version) => contentIdForMemberBlockList(version.memberBlockList),
	frozenSetBytes: (version) => (version.wholeSetBlock && typeof version.wholeSetBlock.decisionBlockHash === 'string' ? version.wholeSetBlock.decisionBlockHash : ''),
});

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;

const contentIdForMemberBlockList = (memberBlockList) =>
	sha256Hex(
		memberBlockList
			.map((oneMember) => oneMember.decisionBlockHash)
			.slice()
			.sort()
			.join('\n'),
	);

// agentRefusal(agent) → '' | reason: its IRI parses as an agent kind and its stated kind is that kind's
const agentRefusal = (agent) => {
	if (!isPlainObject(agent) || !isNonEmptyString(agent.agentIri) || !isNonEmptyString(agent.displayName)) {
		return `agent ${JSON.stringify(agent)} needs agentIri and displayName`;
	}
	const parsed = edcUri.parse(agent.agentIri);
	const expectedKind = parsed.error ? undefined : LAYER_REGISTRY_SCHEMA.agentKindByUriKind[parsed.kind];
	if (expectedKind === undefined) {
		return `agent ${agent.agentIri} is not an edc agent IRI (${parsed.error || parsed.kind})`;
	}
	if (agent.agentKind !== expectedKind) {
		return `agent ${agent.agentIri} says agentKind '${agent.agentKind}', its IRI is a '${expectedKind}'`;
	}
	return '';
};

// versionRefusal({ layer, version, agentIriSet }) → '' | reason
const versionRefusal = ({ layer, version, agentIriSet }) => {
	if (!isPlainObject(version) || !isPlainObject(version.administrationRecord)) {
		return `layer '${layer.layerKey}': a version has no administrationRecord (${LAYER_REGISTRY_SCHEMA.administrationRecordFieldList.join(', ')})`;
	}
	const record = version.administrationRecord;
	const absentField = LAYER_REGISTRY_SCHEMA.administrationRecordFieldList.find((oneField) => !isNonEmptyString(record[oneField]));
	if (absentField !== undefined) {
		return `layer '${layer.layerKey}' version ${JSON.stringify(record.versionTag)}: the administration record lacks '${absentField}'`;
	}
	const label = `layer '${layer.layerKey}' version '${record.versionTag}'`;
	if (!new RegExp(LAYER_REGISTRY_SCHEMA.versionTagPattern).test(record.versionTag)) {
		return `${label}: the tag does not match ${LAYER_REGISTRY_SCHEMA.versionTagPattern}`;
	}
	if (LAYER_REGISTRY_SCHEMA.registrationStatusList.indexOf(version.registrationStatus) === -1) {
		return `${label}: registrationStatus ${JSON.stringify(version.registrationStatus)} is not an ISO/IEC 11179-6 lifecycle status (${LAYER_REGISTRY_SCHEMA.registrationStatusList.join(', ')})`;
	}
	if (!new RegExp(LAYER_REGISTRY_SCHEMA.contentIdPattern).test(record.contentId) || !new RegExp(LAYER_REGISTRY_SCHEMA.publishedAtPattern).test(record.publishedAt)) {
		return `${label}: contentId must be 64 hex and publishedAt an ISO UTC instant (got ${record.contentId}, ${record.publishedAt})`;
	}
	const unknownAgentIri = [record.registrationAuthority, record.registrar, record.submitter, version.authorAgentIri].find((oneIri) => !agentIriSet.has(oneIri));
	if (unknownAgentIri !== undefined) {
		return `${label}: agent ${JSON.stringify(unknownAgentIri)} is not in the agent registry`;
	}
	if (!Array.isArray(version.memberBlockList) || version.memberBlockList.length === 0 || !version.memberBlockList.every((oneMember) => isNonEmptyString(oneMember.pairKey) && new RegExp(LAYER_REGISTRY_SCHEMA.contentIdPattern).test(oneMember.decisionBlockHash))) {
		return `${label}: memberBlockList must list { pairKey, decisionBlockHash } for every block the version spans`;
	}
	const basisRow = CONTENT_ID_BASIS_REGISTRY[version.contentIdBasis];
	if (basisRow === undefined) {
		return `${label}: contentIdBasis ${JSON.stringify(version.contentIdBasis)} is not one of ${Object.keys(CONTENT_ID_BASIS_REGISTRY).join(', ')}`;
	}
	if (basisRow(version) !== record.contentId) {
		return `${label}: contentId ${record.contentId} does not match its basis '${version.contentIdBasis}' (${basisRow(version) || 'absent'})`;
	}
	return '';
};

// layerRefusal({ layer, agentIriSet }) → '' | reason
const layerRefusal = ({ layer, agentIriSet }) => {
	if (!isPlainObject(layer) || !isNonEmptyString(layer.layerKey) || !new RegExp(LAYER_REGISTRY_SCHEMA.layerKeyPattern).test(layer.layerKey)) {
		return `a layer's layerKey ${JSON.stringify(layer && layer.layerKey)} does not match ${LAYER_REGISTRY_SCHEMA.layerKeyPattern}`;
	}
	const producerKind = LAYER_REGISTRY_SCHEMA.producerKindByLayerKind[layer.layerKind];
	if (producerKind === undefined || DECISION_BLOCK_PRODUCER_KIND_LIST.indexOf(producerKind) === -1) {
		return `layer '${layer.layerKey}': layerKind ${JSON.stringify(layer.layerKind)} names no decision-block producer kind (${Object.keys(LAYER_REGISTRY_SCHEMA.producerKindByLayerKind).join(', ')})`;
	}
	if (!isNonEmptyString(layer.displayName) || !agentIriSet.has(layer.authorAgentIri)) {
		return `layer '${layer.layerKey}' needs a displayName and an authorAgentIri in the agent registry (got ${JSON.stringify(layer.authorAgentIri)})`;
	}
	const sourceListRefusal = [['standardList', 'standardKey'], ['hubList', 'hubKey']].map(([listName, keyName]) => {
		const sourceList = layer[listName];
		if (!Array.isArray(sourceList) || sourceList.length === 0 || !sourceList.every((oneSource) => isNonEmptyString(oneSource[keyName]) && isNonEmptyString(oneSource.sourceIri))) {
			return `layer '${layer.layerKey}': ${listName} must list { ${keyName}, sourceIri, … } for every source (R-4 splits a set by them)`;
		}
		return new Set(sourceList.map((oneSource) => oneSource.sourceIri)).size === sourceList.length ? '' : `layer '${layer.layerKey}': ${listName} names one sourceIri twice`;
	}).find((oneReason) => oneReason !== '');
	if (sourceListRefusal !== undefined) {
		return sourceListRefusal;
	}
	if (!Array.isArray(layer.versionList)) {
		return `layer '${layer.layerKey}' has no versionList (an empty list is stated, never assumed)`;
	}
	const contentIdByTag = {};
	for (let versionIndex = 0; versionIndex < layer.versionList.length; versionIndex++) {
		const oneVersion = layer.versionList[versionIndex];
		const reason = versionRefusal({ layer, version: oneVersion, agentIriSet });
		if (reason) {
			return reason;
		}
		const { versionTag, contentId } = oneVersion.administrationRecord;
		if (contentIdByTag[versionTag] !== undefined) {
			return `layer '${layer.layerKey}': tag '${versionTag}' is REASSIGNED (content ${contentIdByTag[versionTag]} and ${contentId}); a tag is never reused`;
		}
		contentIdByTag[versionTag] = contentId;
	}
	return '';
};

const registryFor = ({ layerRegistry, agentRegistry } = {}) => {
	if (!isPlainObject(agentRegistry) || !Array.isArray(agentRegistry.agentList)) {
		return { error: refusalText('the agent registry has no agentList', 'recipes/agents.json') };
	}
	const badAgent = agentRegistry.agentList.map(agentRefusal).find((oneReason) => oneReason !== '');
	if (badAgent !== undefined) {
		return { error: refusalText(badAgent, 'recipes/agents.json') };
	}
	const agentIriSet = new Set(agentRegistry.agentList.map((oneAgent) => oneAgent.agentIri));
	if (agentIriSet.size !== agentRegistry.agentList.length) {
		return { error: refusalText('the agent registry lists one agentIri twice', 'recipes/agents.json') };
	}
	if (!isPlainObject(layerRegistry) || !Array.isArray(layerRegistry.layerList)) {
		return { error: refusalText('the layer registry has no layerList', 'recipes/layers.json') };
	}
	// the registry's own authority and registrar: what -publishLayer writes into every new version's administration record
	const unknownOfficer = ['registrationAuthorityIri', 'registrarIri'].find((oneName) => !agentIriSet.has(layerRegistry[oneName]));
	if (unknownOfficer !== undefined) {
		return { error: refusalText(`the layer registry's ${unknownOfficer} ${JSON.stringify(layerRegistry[unknownOfficer])} is not in the agent registry`, 'recipes/layers.json names its registration authority and registrar; both are agents') };
	}
	const badLayer = layerRegistry.layerList.map((oneLayer) => layerRefusal({ layer: oneLayer, agentIriSet })).find((oneReason) => oneReason !== '');
	if (badLayer !== undefined) {
		return { error: refusalText(badLayer, 'recipes/layers.json') };
	}
	const layerByLayerKey = layerRegistry.layerList.reduce((soFar, oneLayer) => ({ ...soFar, [oneLayer.layerKey]: oneLayer }), {});
	if (Object.keys(layerByLayerKey).length !== layerRegistry.layerList.length) {
		return { error: refusalText('the layer registry lists one layerKey twice', 'recipes/layers.json') };
	}
	const layerFor = (layerKey) =>
		layerByLayerKey[layerKey] === undefined ? { error: refusalText(`layerKey ${JSON.stringify(layerKey)} is not in the registry`, `recipes/layers.json (${Object.keys(layerByLayerKey).join(', ')}); a layer is registered before it is published to`) } : { layer: layerByLayerKey[layerKey] };
	const versionFor = ({ layerKey, versionTag }) => {
		const found = layerFor(layerKey);
		if (found.error) {
			return found;
		}
		const version = found.layer.versionList.find((oneVersion) => oneVersion.administrationRecord.versionTag === versionTag);
		return version === undefined ? { error: refusalText(`layer '${layerKey}' has no version tagged ${JSON.stringify(versionTag)}`, 'recipes/layers.json') } : { version };
	};
	const currentStandardVersionFor = (layerKey) => {
		const found = layerFor(layerKey);
		if (found.error) {
			return found;
		}
		const standardList = found.layer.versionList.filter((oneVersion) => oneVersion.registrationStatus === 'Standard').sort((leftVersion, rightVersion) => (leftVersion.administrationRecord.publishedAt < rightVersion.administrationRecord.publishedAt ? -1 : leftVersion.administrationRecord.publishedAt > rightVersion.administrationRecord.publishedAt ? 1 : 0));
		return standardList.length === 0 ? { error: refusalText(`layer '${layerKey}' has no Standard version`, 'a floating layer follows its Standard version, never merely its newest (SPEC §5.3)') } : { version: standardList[standardList.length - 1] };
	};
	const withAppendedVersion = ({ layerKey, version }) => {
		const found = layerFor(layerKey);
		if (found.error) {
			return found;
		}
		const candidateRegistry = { ...layerRegistry, layerList: layerRegistry.layerList.map((oneLayer) => (oneLayer.layerKey === layerKey ? { ...oneLayer, versionList: oneLayer.versionList.concat([version]) } : oneLayer)) };
		const checked = registryFor({ layerRegistry: candidateRegistry, agentRegistry });
		return checked.error ? { error: checked.error } : { layerRegistry: candidateRegistry };
	};
	return { registry: { layerFor, versionFor, currentStandardVersionFor, withAppendedVersion, layerRegistry, agentRegistry } };
};

// readJsonFile(filePath) → { parsedJson } | { error }: a missing or malformed registry is refused by name, never defaulted
const readJsonFile = (filePath) => {
	if (!isNonEmptyString(filePath) || !fs.existsSync(filePath)) {
		return { error: refusalText(`registry file ${JSON.stringify(filePath)} does not exist`, 'recipes/layers.json and recipes/agents.json are required; there is no default registry') };
	}
	const fileText = fs.readFileSync(filePath, 'utf8');
	let parsedJson;
	let parseFault = '';
	try {
		parsedJson = JSON.parse(fileText);
	} catch (parseError) {
		parseFault = parseError.message;
	}
	return parseFault ? { error: refusalText(`registry file ${filePath} is not JSON: ${parseFault}`, 'the registries are plain JSON') } : { parsedJson };
};

const loadRegistry = ({ layerRegistryFilePath, agentRegistryFilePath } = {}) => {
	const layerFile = readJsonFile(layerRegistryFilePath);
	if (layerFile.error) {
		return layerFile;
	}
	const agentFile = readJsonFile(agentRegistryFilePath);
	if (agentFile.error) {
		return agentFile;
	}
	return registryFor({ layerRegistry: layerFile.parsedJson, agentRegistry: agentFile.parsedJson });
};

// registryText(layerRegistry) → the one serialization a registry file is written in (tabs, trailing newline)
const registryText = (layerRegistry) => `${JSON.stringify(layerRegistry, null, '\t')}\n`;

module.exports = { registryFor, loadRegistry, registryText, contentIdForMemberBlockList, CONTENT_ID_BASIS_REGISTRY, LAYER_REGISTRY_SCHEMA, moduleName };
