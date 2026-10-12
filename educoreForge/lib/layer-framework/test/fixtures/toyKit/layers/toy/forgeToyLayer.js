'use strict';
// a test fixture producer: one DmeArea per line of toyAreaList.txt, each placed on the toy base's one property
const fs = require('fs');
const path = require('path');
const vocabulary = require(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'vocabulary', 'vocabulary'));
const layerDeclaration = { layerKey: 'toy', roleList: [vocabulary.DME_ROLES.AREA], edgeTypeList: [vocabulary.EDGE_TYPES.HAS_DES_DOMAIN, vocabulary.EDGE_TYPES.PLACES_PROPERTY] };
const produceLayer = ({ sourceFilePathByName, baseIndex, layerIdentity }, callback) => {
	const nameList = fs.readFileSync(sourceFilePathByName['toyAreaList.txt'], 'utf8').split('\n').filter(Boolean);
	const [baseProperty] = baseIndex.nodeListOfRole(vocabulary.DME_ROLES.PROPERTY);
	const nodes = nameList.map((oneName) => ({ labels: ['ToyArea'], stableId: layerIdentity.stableIdFor('area', oneName), role: vocabulary.DME_ROLES.AREA, properties: { name: oneName } }));
	const edges = nodes.flatMap((oneNode) => [
		{ type: vocabulary.EDGE_TYPES.HAS_DES_DOMAIN, fromStableId: layerIdentity.layerRootStableId, toStableId: oneNode.stableId, properties: { provenanceTier: 'structural' } },
		{ type: vocabulary.EDGE_TYPES.PLACES_PROPERTY, fromStableId: oneNode.stableId, toStableId: baseProperty.stableId, properties: { provenanceTier: 'spec-authoritative' } },
	]);
	callback('', { nodes, edges, rootPropertyByName: { areaCount: nodes.length } });
};
module.exports = { layerDeclaration, produceLayer };
