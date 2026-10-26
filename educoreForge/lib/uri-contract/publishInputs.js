'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// publishInputs.js — the registry a publish action works against, read from uriContract, plus what the operator brings that the
// tables do not yet hold (ML3.1 Part B; AMBER_JOURNEY ruling 2026-10-26). uriContract keeps a layer's fields on its version rows,
// so a layer with no published version does not exist there, and with agents.json retired nothing else can add an agent. The two
// inputs that replace hand-editing the JSON:
//   layerDefinition      { layerKey, displayName, layerKind, authorAgentIri, standardList, hubList } (--layerDefinitionPath):
//                        REQUIRED when the layer is not yet in uriContract; identical to the stored layer is accepted; different
//                        is REFUSED by name (a layer's definition is not edited by publishing to it)
//   agentDefinitionList  [{ agentIri, agentKind, displayName, aliasIri?, note? }] (--agentDefinitionPath): appended before the
//                        version; an identical existing agent is alreadyPresent, a different one under the same IRI is refused
//
//   registryForPublish({ uriContract, layerKey, layerDefinition, agentDefinitionList, layerIsCreatedByAction })
//       → { registry, newAgentList } | { error }
//       layerIsCreatedByAction  true for -importLayer, which creates its own imported-<slug> layer (a definition is then refused)
//   appendNewAgents({ uriContract, newAgentList }) → { appendedCount } | { error }
//
// The returned registry is lib/layer-registry registryFor(...).registry over the tables plus these inputs, so publishLayer and
// importLayer validate against exactly what uriContract will hold.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const layerRegistryLib = require(path.join(__dirname, '..', 'layer-registry', 'layerRegistry'));
const { canonicalText } = require(path.join(__dirname, 'registrySeed'));
const URI_CONTRACT_RULES = require(path.join(__dirname, 'uriContractRules.json'));

const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const LAYER_DEFINITION_FIELD_LIST = URI_CONTRACT_RULES.layerFieldList.filter((fieldName) => fieldName !== 'versionList' && fieldName !== 'statusChangeList');

const registryForPublish = ({ uriContract, layerKey, layerDefinition, agentDefinitionList, layerIsCreatedByAction } = {}) => {
	if (!uriContract || typeof uriContract.registryShape !== 'function') {
		return { error: refusalText('a uriContract is required', 'registryForPublish({ uriContract, ... })') };
	}
	const { layerRegistry, agentRegistry } = uriContract.registryShape();
	const storedAgentByIri = agentRegistry.agentList.reduce((soFar, oneAgent) => ({ ...soFar, [oneAgent.agentIri]: oneAgent }), {});
	const offeredAgentList = agentDefinitionList === undefined ? [] : agentDefinitionList;
	if (!Array.isArray(offeredAgentList) || !offeredAgentList.every(isPlainObject)) {
		return { error: refusalText('the agent definition must be a JSON list of agent objects', '--agentDefinitionPath') };
	}
	const conflictingAgent = offeredAgentList.find((oneAgent) => storedAgentByIri[oneAgent.agentIri] !== undefined && canonicalText(storedAgentByIri[oneAgent.agentIri]) !== canonicalText(oneAgent));
	if (conflictingAgent !== undefined) {
		return { error: refusalText(`agent ${conflictingAgent.agentIri} is already in uriContract with different content`, '--agentDefinitionPath appends new agents; an agent of record is never edited') };
	}
	const newAgentList = offeredAgentList.filter((oneAgent) => storedAgentByIri[oneAgent.agentIri] === undefined);
	const storedLayer = layerRegistry.layerList.find((oneLayer) => oneLayer.layerKey === layerKey);
	const definitionGiven = layerDefinition !== undefined;
	if (definitionGiven && layerIsCreatedByAction) {
		return { error: refusalText('-importLayer creates its own imported-<slug> layer; a layer definition is not accepted', '--layerDefinitionPath is for -publishLayer') };
	}
	if (definitionGiven && (!isPlainObject(layerDefinition) || layerDefinition.layerKey !== layerKey || Object.keys(layerDefinition).sort().join(',') !== LAYER_DEFINITION_FIELD_LIST.slice().sort().join(','))) {
		return { error: refusalText(`the layer definition must carry exactly ${LAYER_DEFINITION_FIELD_LIST.join(', ')}, for layer '${layerKey}'`, '--layerDefinitionPath') };
	}
	if (storedLayer === undefined && !definitionGiven && !layerIsCreatedByAction) {
		return { error: refusalText(`layer '${layerKey}' is not in uriContract`, 'its first publish names its definition with --layerDefinitionPath (layerKey, displayName, layerKind, authorAgentIri, standardList, hubList)') };
	}
	if (storedLayer !== undefined && definitionGiven) {
		const differingField = LAYER_DEFINITION_FIELD_LIST.find((fieldName) => canonicalText(storedLayer[fieldName]) !== canonicalText(layerDefinition[fieldName]));
		if (differingField !== undefined) {
			return { error: refusalText(`layer '${layerKey}' is already defined in uriContract and the offered definition differs in '${differingField}'`, 'a layer\'s definition is not edited by publishing to it; omit --layerDefinitionPath or make it identical') };
		}
	}
	const candidateLayerRegistry = storedLayer === undefined && definitionGiven ? { ...layerRegistry, layerList: layerRegistry.layerList.concat([{ ...layerDefinition, versionList: [], statusChangeList: [] }]) } : layerRegistry;
	const checked = layerRegistryLib.registryFor({ layerRegistry: candidateLayerRegistry, agentRegistry: { agentList: agentRegistry.agentList.concat(newAgentList) } });
	return checked.error ? { error: checked.error } : { registry: checked.registry, newAgentList };
};

const appendNewAgents = ({ uriContract, newAgentList } = {}) => {
	for (let agentIndex = 0; agentIndex < newAgentList.length; agentIndex++) {
		const appended = uriContract.appendAgent(newAgentList[agentIndex]);
		if (appended.error) {
			return { error: appended.error };
		}
	}
	return { appendedCount: newAgentList.length };
};

module.exports = { registryForPublish, appendNewAgents, LAYER_DEFINITION_FIELD_LIST, moduleName };
