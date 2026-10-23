'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeGuideLayer.js — the producer of CEDS's `guide` layer: Appendix A of the CEDS Ontology Guide Version 14 (lane DES,
// campaign cedsRichness-101226, 2026-10-12). The step-4 cascade's coarse top: which Conceptual Model concept a class belongs
// to, and which date properties record an Event.
//
//   CedsConceptualConcept (role DmeConcept)  the eight concepts, with the guide's own definition (p. 6)
//   CedsClass -HAS_PRIMARY_CONCEPT->   concept   Table A-1, 400 classes
//   CedsClass -HAS_SECONDARY_CONCEPT-> concept   Table A-1, where the guide gives one (an em dash means none)
//   CedsProperty -HAS_EVENT_DATE_CONCEPT-> concept, one per concept Table A-2 lists for it, in the guide's order
//
// IDS ONLY: a class or property is found by its CEDS id (C###### / P######) as the base carries it in cedsId. A row whose id
// names no base node is REFUSED BY NAME (measured: 400 of 400 and 204 of 204 join). The guide's own class and property names
// ride on the edges (guideClassName, guidePropertyName, guideClassText), never on the V14 node: 16 of the guide's class
// names differ from the ontology's labels, and the V14 node keeps the ontology's.

const path = require('path');
const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', 'lib');
const vocabulary = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary'));
const { readGuideTables, NO_SECONDARY_CONCEPT_TEXT, CONCEPT_LIST_SEPARATOR } = require('./lib/guideTables');
// ⟪zeroBacklog A2-4, census row 11 (R6-3)⟫ how to read this layer, as DATA (the file says where its words come from); a layer-root property
const { layerUsageTips: GUIDE_LAYER_USAGE_TIPS } = require('./lib/guideLayerUsageTips.json');

const { DME_ROLES, EDGE_TYPES, PROVENANCE_TIER } = vocabulary;
const GUIDE_VERSION = '14';

const layerDeclaration = Object.freeze({
	layerKey: 'guide',
	roleList: Object.freeze([DME_ROLES.CONCEPT]),
	edgeTypeList: Object.freeze([EDGE_TYPES.DECLARES_CONCEPT, EDGE_TYPES.HAS_PRIMARY_CONCEPT, EDGE_TYPES.HAS_SECONDARY_CONCEPT, EDGE_TYPES.HAS_EVENT_DATE_CONCEPT]),
});

const produceLayer = ({ sourceFilePathByName, baseIndex, layerIdentity }, callback) => {
	const snapshotPath = path.dirname(Object.values(sourceFilePathByName)[0]);
	readGuideTables({ snapshotPath }, (readError, guideTables) => {
		if (readError) {
			callback(readError);
			return;
		}
		const nodeStableIdByCedsIdAndRole = {};
		[DME_ROLES.CLASS, DME_ROLES.PROPERTY].forEach((role) =>
			baseIndex.nodeListOfRole(role).forEach((oneNode) => {
				nodeStableIdByCedsIdAndRole[`${role}|${oneNode.propertyByName.cedsId}`] = oneNode.stableId;
			}),
		);
		const nodeList = [];
		const edgeList = [];
		const conceptStableIdByName = {};
		guideTables.conceptRowList.forEach((oneConcept) => {
			const conceptStableId = layerIdentity.stableIdFor('concept', oneConcept.conceptName);
			conceptStableIdByName[oneConcept.conceptName] = conceptStableId;
			nodeList.push({
				labels: ['CedsConceptualConcept'],
				stableId: conceptStableId,
				role: DME_ROLES.CONCEPT,
				properties: {
					name: oneConcept.conceptName,
					definition: oneConcept.conceptDefinition,
					description: `${oneConcept.conceptName}: ${oneConcept.conceptDefinition} (CEDS Conceptual Model, CEDS Ontology Guide Version 14)`,
					conceptOrdinal: Number(oneConcept.conceptOrdinal),
					guidePageNumber: Number(oneConcept.guidePageNumber),
					guideRowOrdinal: oneConcept.rowOrdinal,
					guideVersion: GUIDE_VERSION,
				},
			});
			edgeList.push({ type: EDGE_TYPES.DECLARES_CONCEPT, fromStableId: layerIdentity.layerRootStableId, toStableId: conceptStableId, properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL } });
		});
		const conceptStableIdOf = (conceptName, rowText) => {
			const conceptStableId = conceptStableIdByName[conceptName];
			return conceptStableId === undefined ? { error: `${moduleName}: ${rowText} names concept ${JSON.stringify(conceptName)}, which is not one of the guide's eight (${Object.keys(conceptStableIdByName).join(', ')})` } : { conceptStableId };
		};
		for (const oneRow of guideTables.classRowList) {
			const classStableId = nodeStableIdByCedsIdAndRole[`${DME_ROLES.CLASS}|${oneRow.classId}`];
			if (classStableId === undefined) {
				callback(`${moduleName}: Table A-1 row ${oneRow.rowOrdinal} names class ${oneRow.classId}, which the CEDS base does not carry`);
				return;
			}
			const conceptPairList = [[EDGE_TYPES.HAS_PRIMARY_CONCEPT, oneRow.primaryConcept]].concat(oneRow.secondaryConcept === NO_SECONDARY_CONCEPT_TEXT ? [] : [[EDGE_TYPES.HAS_SECONDARY_CONCEPT, oneRow.secondaryConcept]]);
			for (const [edgeType, conceptName] of conceptPairList) {
				const found = conceptStableIdOf(conceptName, `Table A-1 row ${oneRow.rowOrdinal} (${oneRow.classId})`);
				if (found.error) {
					callback(found.error);
					return;
				}
				edgeList.push({
					type: edgeType,
					fromStableId: classStableId,
					toStableId: found.conceptStableId,
					properties: { provenanceTier: PROVENANCE_TIER.SPEC_AUTHORITATIVE, guideClassName: oneRow.className, guideRowOrdinal: oneRow.rowOrdinal, guidePageNumber: Number(oneRow.guidePageNumber), guideVersion: GUIDE_VERSION },
				});
			}
		}
		for (const oneRow of guideTables.dateRowList) {
			const propertyStableId = nodeStableIdByCedsIdAndRole[`${DME_ROLES.PROPERTY}|${oneRow.propertyId}`];
			if (propertyStableId === undefined) {
				callback(`${moduleName}: Table A-2 row ${oneRow.rowOrdinal} names property ${oneRow.propertyId}, which the CEDS base does not carry`);
				return;
			}
			const conceptNameList = oneRow.conceptText.split(CONCEPT_LIST_SEPARATOR);
			for (let conceptIndex = 0; conceptIndex < conceptNameList.length; conceptIndex++) {
				const found = conceptStableIdOf(conceptNameList[conceptIndex], `Table A-2 row ${oneRow.rowOrdinal} (${oneRow.propertyId})`);
				if (found.error) {
					callback(found.error);
					return;
				}
				edgeList.push({
					type: EDGE_TYPES.HAS_EVENT_DATE_CONCEPT,
					fromStableId: propertyStableId,
					toStableId: found.conceptStableId,
					properties: {
						provenanceTier: PROVENANCE_TIER.SPEC_AUTHORITATIVE,
						conceptOrdinal: conceptIndex + 1,
						guidePropertyName: oneRow.propertyName,
						guideClassText: oneRow.classText,
						guideRowOrdinal: oneRow.rowOrdinal,
						guidePageNumber: Number(oneRow.guidePageNumber),
						guideVersion: GUIDE_VERSION,
					},
				});
			}
		}
		callback('', {
			nodes: nodeList,
			edges: edgeList,
			rootPropertyByName: {
				guideVersion: GUIDE_VERSION,
				layerUsageTips: GUIDE_LAYER_USAGE_TIPS,
				conceptCount: guideTables.conceptRowList.length,
				classConceptRowCount: guideTables.classRowList.length,
				eventDatePropertyCount: guideTables.dateRowList.length,
			},
			layerReport: {},
		});
	});
};

module.exports = { layerDeclaration, produceLayer, GUIDE_VERSION };
