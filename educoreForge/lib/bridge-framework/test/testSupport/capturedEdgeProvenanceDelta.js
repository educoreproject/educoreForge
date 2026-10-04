'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// capturedEdgeProvenanceDelta.js — TEST SUPPORT: lane P's change (mappingProvenance 2026-10-04), applied to an edge list
// CAPTURED before it, so an oracle that compares today's written edges with a branch-cut capture keeps proving what it was
// written to prove, and proves lane P changed nothing else. The capture files are NOT re-captured: re-capturing would make
// the oracle compare the code with itself.
//
// The delta is exactly what lane P does to a written edge, read from the vocabulary and the judge provider registry the
// production code reads, never restated:
//   mappingKind        MAPPING_KIND_BY_RESOLUTION[resolution]
//   mappingSource      judged: 'bridge-' + the registered provider that minted mappingTool; specified: the authored family
//                      of matchBasis + the bridge plugin's name, which an edge does not carry, so the caller names it
//   mappingConfidence  judged edges only: confidence
//   provenanceTier     'embedding-inferred' → 'judge-inferred' (ruled A1); every other tier unchanged
//
//   capturedEdgeListWithProvenanceDelta({ capturedEdgeList, specifiedBridgeName }) → edge list | throws by name
//   canonicalEdgeListText(edgeList, maskedPropertyNameList) → text with each edge's properties in sorted-name order, so the
//                      comparison is of CONTENT; the materialiser's key order is not a property of the graph

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', '..', '..', 'vocabulary', 'vocabulary'));
const { providerNameForJudgeModel } = require(path.join(__dirname, '..', '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'judgeProviderRegistry'));

const { MAPPING_PROPERTIES, MAPPING_KIND_BY_RESOLUTION, MAPPING_SOURCE_FAMILY, MAPPING_SOURCE_FAMILY_BY_AUTHORED_MATCH_BASIS, PROVENANCE_TIER, composeMappingSource } = vocabularyLib;

const TIER_RENAME_BY_CAPTURED_TIER = Object.freeze({ [PROVENANCE_TIER.EMBEDDING_INFERRED]: PROVENANCE_TIER.JUDGE_INFERRED });

const MAPPING_SOURCE_DELTA_BY_RESOLUTION = Object.freeze({
	judged: ({ capturedProperties }) => {
		const owner = providerNameForJudgeModel(capturedProperties.mappingTool);
		if (owner.error) {
			throw new Error(`${moduleName} REFUSED: captured judged edge: ${owner.error}`);
		}
		return composeMappingSource({ family: MAPPING_SOURCE_FAMILY.BRIDGE, sourceName: owner.providerName });
	},
	specified: ({ capturedProperties, specifiedBridgeName }) => {
		const family = MAPPING_SOURCE_FAMILY_BY_AUTHORED_MATCH_BASIS[capturedProperties.matchBasis];
		if (family === undefined || typeof specifiedBridgeName !== 'string' || !specifiedBridgeName) {
			throw new Error(`${moduleName} REFUSED: a captured specified edge (matchBasis ${JSON.stringify(capturedProperties.matchBasis)}) needs an authored family and the caller's specifiedBridgeName (got ${JSON.stringify(specifiedBridgeName)})`);
		}
		return composeMappingSource({ family, sourceName: specifiedBridgeName });
	},
});

const capturedEdgeListWithProvenanceDelta = ({ capturedEdgeList, specifiedBridgeName }) =>
	capturedEdgeList.map((capturedEdge) => {
		const capturedProperties = capturedEdge.properties;
		const sourceDelta = MAPPING_SOURCE_DELTA_BY_RESOLUTION[capturedProperties.resolution];
		if (sourceDelta === undefined) {
			throw new Error(`${moduleName} REFUSED: captured edge resolution ${JSON.stringify(capturedProperties.resolution)} has no delta row`);
		}
		const renamedTier = TIER_RENAME_BY_CAPTURED_TIER[capturedProperties.provenanceTier];
		const properties = {
			...capturedProperties,
			[MAPPING_PROPERTIES.PROVENANCE_TIER]: renamedTier === undefined ? capturedProperties.provenanceTier : renamedTier,
			[MAPPING_PROPERTIES.MAPPING_KIND]: MAPPING_KIND_BY_RESOLUTION[capturedProperties.resolution],
			[MAPPING_PROPERTIES.MAPPING_SOURCE]: sourceDelta({ capturedProperties, specifiedBridgeName }),
		};
		if (capturedProperties.resolution === 'judged') {
			properties[MAPPING_PROPERTIES.MAPPING_CONFIDENCE] = capturedProperties.confidence;
		}
		return { ...capturedEdge, properties };
	});

const canonicalEdgeListText = (edgeList, maskedPropertyNameList) =>
	JSON.stringify(
		edgeList.map((oneEdge) => ({
			...oneEdge,
			properties: Object.keys(oneEdge.properties)
				.sort()
				.reduce((soFar, onePropertyName) => ({ ...soFar, [onePropertyName]: maskedPropertyNameList.indexOf(onePropertyName) === -1 ? oneEdge.properties[onePropertyName] : 'MASKED' }), {}),
		})),
	);

module.exports = { capturedEdgeListWithProvenanceDelta, canonicalEdgeListText, moduleName };
