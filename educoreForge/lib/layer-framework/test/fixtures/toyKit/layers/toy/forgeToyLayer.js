'use strict';
// a test fixture producer: one DmeTextRepair per line of toyRepairList.txt, each repairing the toy base's one property
const fs = require('fs');
const path = require('path');
const vocabulary = require(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'vocabulary', 'vocabulary'));
const layerDeclaration = { layerKey: 'toy', roleList: [vocabulary.DME_ROLES.TEXT_REPAIR], edgeTypeList: [vocabulary.EDGE_TYPES.DECLARES_REPAIR, vocabulary.EDGE_TYPES.REPAIRS_TEXT_OF] };
const produceLayer = ({ sourceFilePathByName, baseIndex, layerIdentity }, callback) => {
	const nameList = fs.readFileSync(sourceFilePathByName['toyRepairList.txt'], 'utf8').split('\n').filter(Boolean);
	const [baseProperty] = baseIndex.nodeListOfRole(vocabulary.DME_ROLES.PROPERTY);
	const nodes = nameList.map((oneName) => ({ labels: ['ToyRepair'], stableId: layerIdentity.stableIdFor('repair', oneName), role: vocabulary.DME_ROLES.TEXT_REPAIR, properties: { name: oneName } }));
	const edges = nodes.flatMap((oneNode) => [
		{ type: vocabulary.EDGE_TYPES.DECLARES_REPAIR, fromStableId: layerIdentity.layerRootStableId, toStableId: oneNode.stableId, properties: { provenanceTier: 'structural' } },
		{ type: vocabulary.EDGE_TYPES.REPAIRS_TEXT_OF, fromStableId: oneNode.stableId, toStableId: baseProperty.stableId, properties: { provenanceTier: 'spec-authoritative' } },
	]);
	callback('', { nodes, edges, rootPropertyByName: { repairCount: nodes.length } });
};
module.exports = { layerDeclaration, produceLayer };
