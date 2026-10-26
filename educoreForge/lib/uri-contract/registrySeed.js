'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// registrySeed.js — move the mapping-layer registry (recipes/layers.json) and the agent registry (recipes/agents.json) into
// uriContract's layerVersions, layerStatusChanges and agents tables, with every decision schema block the versions are made of
// (ML3.1 Part B, Q45; AMBER_JOURNEY ruling Q3 2026-10-26: lane A runs this in Part C on the REAL file, then retires the JSON).
//
//   seedFromRegistry({ uriContract, layerRegistry, agentRegistry, decisionBlockTextFor }) → { seedReport } | { error }
//       uriContract           a WRITING uriContract (lib/uri-contract/uriContract.js), normally freshly created
//       decisionBlockTextFor  (decisionBlockHash) → { frozenText } | { error }   the support store's reader (a COPY, read only)
//   registryAgreement({ uriContract, layerRegistry, agentRegistry }) → { agree, differenceList }
//       THE ROW-FOR-ROW GATE: the registry rebuilt from the tables equals the JSON (minus its 'about' prose), value for value,
//       arrays in order, object keys in any order.
//
// ORDER IS THE JSON'S: agents first, then each layer's versions in list order, then that layer's status changes in list order,
// so a version a later one copies or supersedes is always already present. The registry is validated WHOLE by registryFor
// before anything is written, and again by every append. A field the tables cannot hold is refused by name (uriContractRules.json).

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const layerRegistryLib = require(path.join(__dirname, '..', 'layer-registry', 'layerRegistry'));
const URI_CONTRACT_RULES = require(path.join(__dirname, 'uriContractRules.json'));

const { LAYER_REGISTRY_SCHEMA } = layerRegistryLib;
const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

// producerKindForBlock({ pairKey, layer }) → the block's producer kind: a member block names it as its last pairKey segment; the
// whole-set block (layerSet::<layerKey>) is its layer's (layerRegistrySchema.json producerKindByLayerKind)
const producerKindForBlock = ({ pairKey, layer }) => (pairKey.indexOf('layerSet::') === 0 ? LAYER_REGISTRY_SCHEMA.producerKindByLayerKind[layer.layerKind] : pairKey.split('::').slice(-1)[0]);

const topFieldRefusal = ({ layerRegistry, agentRegistry }) => {
	if (!isPlainObject(layerRegistry) || !isPlainObject(agentRegistry)) {
		return 'layerRegistry and agentRegistry are required';
	}
	const unknownTop = Object.keys(layerRegistry).find((fieldName) => URI_CONTRACT_RULES.registryTopFieldList.indexOf(fieldName) === -1) || Object.keys(agentRegistry).find((fieldName) => URI_CONTRACT_RULES.agentRegistryTopFieldList.indexOf(fieldName) === -1);
	if (unknownTop !== undefined) {
		return `a registry carries the top field '${unknownTop}', which uriContract does not store`;
	}
	const officerMismatch = ['registrationAuthorityIri', 'registrarIri'].find((fieldName) => layerRegistry[fieldName] !== URI_CONTRACT_RULES[fieldName]);
	return officerMismatch === undefined ? '' : `the layer registry's ${officerMismatch} ${JSON.stringify(layerRegistry[officerMismatch])} is not uriContractRules.json's ${JSON.stringify(URI_CONTRACT_RULES[officerMismatch])}`;
};

const seedFromRegistry = ({ uriContract, layerRegistry, agentRegistry, decisionBlockTextFor } = {}) => {
	if (!uriContract || typeof uriContract.appendLayerVersion !== 'function' || typeof decisionBlockTextFor !== 'function') {
		return { error: refusalText('a WRITING uriContract and decisionBlockTextFor are required', 'seedFromRegistry({ uriContract, layerRegistry, agentRegistry, decisionBlockTextFor })') };
	}
	const topFault = topFieldRefusal({ layerRegistry, agentRegistry });
	if (topFault) {
		return { error: refusalText(topFault, 'recipes/layers.json, recipes/agents.json') };
	}
	const whole = layerRegistryLib.registryFor({ layerRegistry, agentRegistry });
	if (whole.error) {
		return { error: whole.error };
	}
	const seedReport = { agentCount: 0, layerCount: 0, versionCount: 0, statusChangeCount: 0, decisionSchemaBlockCount: 0, alreadyPresentCount: 0 };
	for (let agentIndex = 0; agentIndex < agentRegistry.agentList.length; agentIndex++) {
		const appended = uriContract.appendAgent(agentRegistry.agentList[agentIndex]);
		if (appended.error) {
			return { error: appended.error, seedReport };
		}
		seedReport.agentCount += 1;
		seedReport.alreadyPresentCount += appended.alreadyPresent ? 1 : 0;
	}
	const offeredHashSet = new Set();
	for (let layerIndex = 0; layerIndex < layerRegistry.layerList.length; layerIndex++) {
		const { versionList, statusChangeList, ...layerFieldsOnly } = layerRegistry.layerList[layerIndex];
		const layer = { ...layerFieldsOnly, versionList: [], statusChangeList: [] };
		for (let versionIndex = 0; versionIndex < versionList.length; versionIndex++) {
			const version = versionList[versionIndex];
			const blockReferenceList = version.memberBlockList.concat(version.wholeSetBlock === undefined ? [] : [version.wholeSetBlock]);
			const decisionSchemaBlockList = [];
			for (let blockIndex = 0; blockIndex < blockReferenceList.length; blockIndex++) {
				const { pairKey, decisionBlockHash } = blockReferenceList[blockIndex];
				if (offeredHashSet.has(decisionBlockHash)) {
					continue;
				}
				const read = decisionBlockTextFor(decisionBlockHash);
				if (read.error || read.frozenText === null || read.frozenText === undefined) {
					return { error: refusalText(`layer '${layer.layerKey}' version '${version.administrationRecord.versionTag}': decision block ${decisionBlockHash} (${pairKey}) ${read.error || 'is not in the support store'}`, 'the seed copies every block a version is made of; point --standardsDatabaseFilePath at a store that holds them'), seedReport };
				}
				decisionSchemaBlockList.push({ pairKey, producerKind: producerKindForBlock({ pairKey, layer }), frozenText: read.frozenText });
				offeredHashSet.add(decisionBlockHash);
			}
			const appended = uriContract.appendLayerVersion({ layer, version, decisionSchemaBlockList });
			if (appended.error) {
				return { error: appended.error, seedReport };
			}
			seedReport.versionCount += 1;
			seedReport.decisionSchemaBlockCount += decisionSchemaBlockList.length;
			seedReport.alreadyPresentCount += appended.alreadyPresent ? 1 : 0;
		}
		for (let changeIndex = 0; changeIndex < statusChangeList.length; changeIndex++) {
			const appended = uriContract.appendLayerStatusChange({ layerKey: layer.layerKey, statusChange: statusChangeList[changeIndex] });
			if (appended.error) {
				return { error: appended.error, seedReport };
			}
			seedReport.statusChangeCount += 1;
		}
		seedReport.layerCount += 1;
	}
	return { seedReport };
};

// canonicalText(candidate) → JSON with object keys sorted at every depth and arrays in order: equal texts mean equal values
const canonicalText = (candidate) => {
	if (Array.isArray(candidate)) {
		return `[${candidate.map(canonicalText).join(',')}]`;
	}
	if (isPlainObject(candidate)) {
		return `{${Object.keys(candidate).sort().map((fieldName) => `${JSON.stringify(fieldName)}:${canonicalText(candidate[fieldName])}`).join(',')}}`;
	}
	return JSON.stringify(candidate);
};
const withoutAbout = (candidate) => Object.keys(candidate).filter((fieldName) => fieldName !== 'about').reduce((soFar, fieldName) => ({ ...soFar, [fieldName]: candidate[fieldName] }), {});

const registryAgreement = ({ uriContract, layerRegistry, agentRegistry } = {}) => {
	const rebuilt = uriContract.registryShape();
	const differenceList = [];
	const compare = (label, leftValue, rightValue) => {
		if (canonicalText(leftValue) !== canonicalText(rightValue)) {
			differenceList.push(label);
		}
	};
	compare('agentList length', rebuilt.agentRegistry.agentList.length, agentRegistry.agentList.length);
	agentRegistry.agentList.forEach((oneAgent, agentIndex) => compare(`agent ${agentIndex} ${oneAgent.agentIri}`, rebuilt.agentRegistry.agentList[agentIndex], oneAgent));
	const jsonTop = withoutAbout(layerRegistry);
	compare('registry officers', { registrationAuthorityIri: rebuilt.layerRegistry.registrationAuthorityIri, registrarIri: rebuilt.layerRegistry.registrarIri }, { registrationAuthorityIri: jsonTop.registrationAuthorityIri, registrarIri: jsonTop.registrarIri });
	compare('layerList length', rebuilt.layerRegistry.layerList.length, jsonTop.layerList.length);
	jsonTop.layerList.forEach((oneLayer, layerIndex) => {
		const rebuiltLayer = rebuilt.layerRegistry.layerList[layerIndex] || {};
		Object.keys(oneLayer).filter((fieldName) => fieldName !== 'versionList').forEach((fieldName) => compare(`layer ${oneLayer.layerKey} ${fieldName}`, rebuiltLayer[fieldName], oneLayer[fieldName]));
		compare(`layer ${oneLayer.layerKey} versionList length`, (rebuiltLayer.versionList || []).length, oneLayer.versionList.length);
		oneLayer.versionList.forEach((oneVersion, versionIndex) => compare(`layer ${oneLayer.layerKey} version ${oneVersion.administrationRecord.versionTag}`, (rebuiltLayer.versionList || [])[versionIndex], oneVersion));
	});
	compare('the whole registry', rebuilt.layerRegistry, jsonTop);
	compare('the whole agent registry', rebuilt.agentRegistry, withoutAbout(agentRegistry));
	return { agree: differenceList.length === 0, differenceList };
};

module.exports = { seedFromRegistry, registryAgreement, canonicalText, producerKindForBlock, moduleName };
