'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// capturedEdgeProvenanceDelta.js — TEST SUPPORT: lane P's change (mappingProvenance 2026-10-04), applied to an edge list
// CAPTURED before it, so an oracle that compares today's written edges with a branch-cut capture keeps proving what it was
// written to prove, and proves lane P changed nothing else. The capture files are NOT re-captured: re-capturing would make
// the oracle compare the code with itself.
//
// The delta is exactly what lane P does to a written edge, read from the vocabulary and the judge provider registry the
// production code reads, never restated:
//   mappingKind        MAPPING_KIND_BY_RESOLUTION[resolution] (a debug judge's edge too: there is no debug kind)
//   mappingSource      judged: 'bridge-' + the registered provider that minted mappingTool; specified: the authored family
//                      of matchBasis + the bridge plugin's name, which an edge does not carry, so the caller names it
//   mappingConfidence  judged edges only: confidence, or the provider's FIXED value (the debug judge: 0)
//   provenanceTier     REMOVED: retired from mapping edges (TQ, 2026-10-04)
// and then CAMPAIGN P3's change (2026-10-06; W-B-1 / W-B-2), again read from the vocabulary, never restated:
//   every name in MAPPING_PROPERTY_REPLACEMENT_BY_RETIRED_NAME is RENAMED to its replacement (mappingJustification →
//   mappingMethod, mappingTool → judgeIdentity, mappingToolVersion → rendererVersion) — except `confidence`, which is
//   DROPPED: its replacement, mappingConfidence, is already on the edge (lane P wrote it), and it is that duplication
//   W-B-2 removed. A captured edge carrying a replacement name ALREADY is refused by name (it is not a pre-P3 capture).
//   The judge's numbers and text (W-B-3 / W-B-4) need no delta: a captured debug-judge edge carried neither, and so does
//   today's.
//
//   capturedEdgeListWithProvenanceDelta({ capturedEdgeList, specifiedBridgeName }) → edge list | throws by name
//   canonicalEdgeListText(edgeList, maskedPropertyNameList) → text with each edge's properties in sorted-name order, so the
//                      comparison is of CONTENT; the materialiser's key order is not a property of the graph

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', '..', '..', 'vocabulary', 'vocabulary'));
const { providerNameForJudgeModel, FIXED_MAPPING_CONFIDENCE_BY_PROVIDER_NAME } = require(path.join(__dirname, '..', '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'judgeProviderRegistry'));

const { MAPPING_PROPERTIES, MAPPING_KIND_BY_RESOLUTION, MAPPING_SOURCE_FAMILY, MAPPING_SOURCE_FAMILY_BY_AUTHORED_MATCH_BASIS, composeMappingSource, MAPPING_PROPERTY_REPLACEMENT_BY_RETIRED_NAME } = vocabularyLib;

// campaignP3RenameDelta(properties) → properties with the retired names renamed (or, for the duplicate, dropped)
const campaignP3RenameDelta = (properties) =>
	Object.keys(properties).reduce((soFar, onePropertyName) => {
		const replacementName = MAPPING_PROPERTY_REPLACEMENT_BY_RETIRED_NAME[onePropertyName];
		if (replacementName === undefined) {
			return { ...soFar, [onePropertyName]: properties[onePropertyName] };
		}
		if (onePropertyName === 'confidence') {
			return soFar;
		}
		if (Object.prototype.hasOwnProperty.call(properties, replacementName)) {
			throw new Error(`${moduleName} REFUSED: the captured edge carries both '${onePropertyName}' and its replacement '${replacementName}' — not a pre-P3 capture`);
		}
		return { ...soFar, [replacementName]: properties[onePropertyName] };
	}, {});

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
		const { provenanceTier: retiredTier, ...retainedProperties } = capturedProperties;
		const properties = {
			...retainedProperties,
			[MAPPING_PROPERTIES.MAPPING_KIND]: MAPPING_KIND_BY_RESOLUTION[capturedProperties.resolution],
			[MAPPING_PROPERTIES.MAPPING_SOURCE]: sourceDelta({ capturedProperties, specifiedBridgeName }),
		};
		if (capturedProperties.resolution === 'judged') {
			const owner = providerNameForJudgeModel(capturedProperties.mappingTool);
			if (owner.error) {
				throw new Error(`${moduleName} REFUSED: captured judged edge: ${owner.error}`);
			}
			const fixedConfidence = FIXED_MAPPING_CONFIDENCE_BY_PROVIDER_NAME[owner.providerName];
			properties[MAPPING_PROPERTIES.MAPPING_CONFIDENCE] = fixedConfidence === undefined ? capturedProperties.confidence : fixedConfidence;
		}
		return { ...capturedEdge, properties: campaignP3RenameDelta(properties) };
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

module.exports = { capturedEdgeListWithProvenanceDelta, campaignP3RenameDelta, canonicalEdgeListText, moduleName };
