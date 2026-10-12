'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeDesLayer.js — the producer of CEDS's `des` layer: the Domain Entity Schema (DES) Version 13, as CEDS published it in
// the V13 element workbook (lane DES, campaign cedsRichness-101226, 2026-10-12; TQ rulings 1 and 2, COPPER_RIVER's word).
//
// WHAT IT MINTS, from the four sheets of CEDS-V13.0.0.0.xlsx (layout as DATA in lib/desWorkbookLayout.json):
//   CedsDesDomain / CedsDesEntity / CedsDesCategory   role DmeArea          the DES's own structure, above properties
//   CedsDesElement                                    role DmeLayerElement  one per 'All - By Name' row (Global ID)
//   CedsDesPlacement                                  role DmePlacement     one per 'All - By Domain' row (Data Model ID)
// and the edges HAS_DES_DOMAIN, HAS_DES_ENTITY, HAS_DES_CATEGORY, HAS_DES_PLACEMENT, PLACES_ELEMENT, DECLARES_ELEMENT, and
// the TWO edges that reach the V14 base: PLACES_PROPERTY (placement -> property) and SAME_GLOBAL_ID_PROPERTY (element ->
// property), BOTH by 'P' + Global ID = the property's cedsId ONLY (ruling 1). An element whose id has no V14 property gets
// neither, and is counted on the layer root (ruling: never dropped, count stated).
//
// WHAT IT NEVER DOES: write V13 text onto a V14 node (ruling 1); link a DES entity or category to a CEDS class (ruling 2: a
// name match is not a join); mint option-set or option-value nodes (the V13 option-set cell rides verbatim on the element).
//
// FAITHFULNESS RULES, each refused BY NAME when the workbook breaks it (this is where the bytes enter the build):
//   * every sheet the workbook carries is in the layout, and every header is the layout's, in order
//   * every cell is of a type the layout allows its column (Data Model ID numeric, Global ID text, URL a formula)
//   * a column the layout calls elementMustEqual (an element column repeated on another sheet) EQUALS the element's value;
//     V13 measured 0 differences, and a future difference would otherwise be silently lost
//   * a Global ID is unique on 'All - By Name'; a Data Model ID is unique on 'All - By Domain'; every placement's and every
//     view row's Global ID names an element
//
// Pure after the one workbook read. Control flow: err-string-first callbacks.

const path = require('path');
const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', 'lib');
const vocabulary = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary'));
const xlsxReader = require(path.join(TREE_LIB, 'xlsx-reader', 'xlsx-reader'))();
const desWorkbookLayout = require('./lib/desWorkbookLayout.json');
const desWorkbookRecordsLib = require('./lib/desWorkbookRecords')();

const { DME_ROLES, EDGE_TYPES, PROVENANCE_TIER } = vocabulary;
const DES_VERSION = '13';
const WORKBOOK_FILE_NAME = 'CEDS-V13.0.0.0.xlsx';
const AREA_KIND = Object.freeze({ DOMAIN: 'desDomain', ENTITY: 'desEntity', CATEGORY: 'desCategory' });
// an area's kind, label, id token, ownership edge and wording, by its DEPTH in the DES path (1 domain, 2 entity, 3+ category)
const AREA_SHAPE_BY_DEPTH = Object.freeze({
	1: Object.freeze({ areaKind: AREA_KIND.DOMAIN, label: 'CedsDesDomain', idToken: 'domain', ownershipEdgeType: EDGE_TYPES.HAS_DES_DOMAIN, wordText: 'domain' }),
	2: Object.freeze({ areaKind: AREA_KIND.ENTITY, label: 'CedsDesEntity', idToken: 'entity', ownershipEdgeType: EDGE_TYPES.HAS_DES_ENTITY, wordText: 'entity' }),
	category: Object.freeze({ areaKind: AREA_KIND.CATEGORY, label: 'CedsDesCategory', idToken: 'category', ownershipEdgeType: EDGE_TYPES.HAS_DES_CATEGORY, wordText: 'category' }),
});
const areaShapeOf = (segmentList) => AREA_SHAPE_BY_DEPTH[segmentList.length] || AREA_SHAPE_BY_DEPTH.category;

const layerDeclaration = Object.freeze({
	layerKey: 'des',
	roleList: Object.freeze([DME_ROLES.AREA, DME_ROLES.LAYER_ELEMENT, DME_ROLES.PLACEMENT]),
	edgeTypeList: Object.freeze([
		EDGE_TYPES.HAS_DES_DOMAIN,
		EDGE_TYPES.HAS_DES_ENTITY,
		EDGE_TYPES.HAS_DES_CATEGORY,
		EDGE_TYPES.HAS_DES_PLACEMENT,
		EDGE_TYPES.PLACES_ELEMENT,
		EDGE_TYPES.PLACES_PROPERTY,
		EDGE_TYPES.SAME_GLOBAL_ID_PROPERTY,
		EDGE_TYPES.DECLARES_ELEMENT,
	]),
});

const structuralEdge = (type, fromStableId, toStableId, extraPropertyByName) => ({
	type,
	fromStableId,
	toStableId,
	properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL, ...(extraPropertyByName || {}) },
});

// the area path of a placement, as name segments: [domain, entity, ...categories]
const areaSegmentListOf = (placementPropertyByName) => {
	const categoryText = placementPropertyByName.desCategoryPathText;
	const categorySegmentList = categoryText === undefined ? [] : categoryText.split(desWorkbookLayout.categoryPathSeparator);
	return [placementPropertyByName.desDomainName, placementPropertyByName.desEntityName].concat(categorySegmentList);
};

const areaStableIdOf = ({ layerIdentity, segmentList }) =>
	`${layerIdentity.layerRootStableId}${areaShapeOf(segmentList).idToken}/${segmentList.map((oneSegment) => encodeURIComponent(oneSegment)).join('/')}`;

// the published 'Domain -> Entity -> Category' list an element's placements imply (sorted, one line each); compared with the
// verbatim cell to REPORT, never to replace it (measured: 1,883 of 1,965 agree on V13)
const impliedPlacementPathListTextOf = (placementPropertyByNameList) =>
	placementPropertyByNameList
		.map((onePlacement) => areaSegmentListOf(onePlacement).join(' -> '))
		.sort()
		.join('\n');

const produceLayer = ({ sourceFilePathByName, baseIndex, layerIdentity }, callback) => {
	const workbookFilePath = sourceFilePathByName[WORKBOOK_FILE_NAME];
	if (!workbookFilePath) {
		callback(`${moduleName}: the layer's sourceFileList names no ${WORKBOOK_FILE_NAME} (got ${Object.keys(sourceFilePathByName).join(', ')})`);
		return;
	}
	xlsxReader.readWorkbookFile({ filePath: workbookFilePath }, (readError, workbook) => {
		if (readError) {
			callback(readError);
			return;
		}
		const records = desWorkbookRecordsLib.recordsOfWorkbook({ workbook, layout: desWorkbookLayout });
		if (records.error) {
			callback(records.error);
			return;
		}
		// THE ID JOIN, V14 side: every CEDS property by its cedsId ('P' + Global ID); a duplicate cedsId is a broken base
		const propertyStableIdByCedsId = {};
		for (const oneProperty of baseIndex.nodeListOfRole(DME_ROLES.PROPERTY)) {
			const cedsId = oneProperty.propertyByName.cedsId;
			if (propertyStableIdByCedsId[cedsId] !== undefined) {
				callback(`${moduleName}: the CEDS base carries two DmeProperty nodes with cedsId ${cedsId}; the Global ID join cannot choose`);
				return;
			}
			propertyStableIdByCedsId[cedsId] = oneProperty.stableId;
		}

		const nodeList = [];
		const edgeList = [];
		const rootStableId = layerIdentity.layerRootStableId;

		// ---- elements ----
		const elementStableIdByGlobalId = {};
		const unjoinedGlobalIdList = [];
		records.elementRecordList.forEach((oneElement) => {
			const globalId = oneElement.propertyByName.globalId;
			const elementStableId = layerIdentity.stableIdFor('element', globalId);
			elementStableIdByGlobalId[globalId] = elementStableId;
			nodeList.push({
				labels: ['CedsDesElement'],
				stableId: elementStableId,
				role: DME_ROLES.LAYER_ELEMENT,
				properties: {
					...oneElement.propertyByName,
					...oneElement.rowNumberPropertyByName,
					// derived, declared: the DME reads one text field, description; for a DES element it is the V13 definition
					...(oneElement.propertyByName.definition === undefined ? {} : { description: oneElement.propertyByName.definition }),
					desVersion: DES_VERSION,
				},
			});
			edgeList.push(structuralEdge(EDGE_TYPES.DECLARES_ELEMENT, rootStableId, elementStableId));
			const propertyStableId = propertyStableIdByCedsId[`${desWorkbookLayout.cedsPropertyIdPrefix}${globalId}`];
			if (propertyStableId === undefined) {
				unjoinedGlobalIdList.push(globalId);
				return;
			}
			edgeList.push({ type: EDGE_TYPES.SAME_GLOBAL_ID_PROPERTY, fromStableId: elementStableId, toStableId: propertyStableId, properties: { provenanceTier: PROVENANCE_TIER.SPEC_AUTHORITATIVE, joinBasis: 'globalId', globalId } });
		});

		// ---- areas and placements ----
		const areaBySegmentIdentity = {};
		const placementPropertyListByGlobalId = {};
		let placementPropertyEdgeCount = 0;
		records.placementRecordList.forEach((onePlacement) => {
			const segmentList = areaSegmentListOf(onePlacement.propertyByName);
			for (let depth = 1; depth <= segmentList.length; depth++) {
				const prefixSegmentList = segmentList.slice(0, depth);
				const segmentIdentity = JSON.stringify(prefixSegmentList);
				if (areaBySegmentIdentity[segmentIdentity]) {
					continue;
				}
				const areaStableId = areaStableIdOf({ layerIdentity, segmentList: prefixSegmentList });
				const areaShape = areaShapeOf(prefixSegmentList);
				areaBySegmentIdentity[segmentIdentity] = areaStableId;
				nodeList.push({
					labels: [areaShape.label],
					stableId: areaStableId,
					role: DME_ROLES.AREA,
					properties: {
						name: prefixSegmentList[prefixSegmentList.length - 1],
						description: `DES ${areaShape.wordText} ${prefixSegmentList.join(' -> ')} (CEDS Domain Entity Schema, Version 13). An area of CEDS's own organising structure; a DES domain is not the rdfs domain of a property.`,
						areaKind: areaShape.areaKind,
						desDomainName: prefixSegmentList[0],
						...(prefixSegmentList.length >= 2 ? { desEntityName: prefixSegmentList[1] } : {}),
						...(prefixSegmentList.length >= 3 ? { desCategoryPathText: prefixSegmentList.slice(2).join(desWorkbookLayout.categoryPathSeparator), desCategoryDepth: prefixSegmentList.length - 2 } : {}),
						desAreaPathText: prefixSegmentList.join(' -> '),
						desVersion: DES_VERSION,
					},
				});
				const parentStableId = depth === 1 ? rootStableId : areaBySegmentIdentity[JSON.stringify(segmentList.slice(0, depth - 1))];
				edgeList.push(structuralEdge(areaShape.ownershipEdgeType, parentStableId, areaStableId));
			}
			const globalId = onePlacement.propertyByName.globalId;
			const placementStableId = layerIdentity.stableIdFor('placement', onePlacement.propertyByName.dataModelId);
			const elementName = records.elementRecordByGlobalId[globalId].propertyByName.name;
			nodeList.push({
				labels: ['CedsDesPlacement'],
				stableId: placementStableId,
				role: DME_ROLES.PLACEMENT,
				properties: {
					...onePlacement.propertyByName,
					...onePlacement.rowNumberPropertyByName,
					name: `${elementName} @ ${segmentList.join(' -> ')}`,
					desElementName: elementName,
					desAreaPathText: segmentList.join(' -> '),
					desVersion: DES_VERSION,
				},
			});
			edgeList.push(structuralEdge(EDGE_TYPES.HAS_DES_PLACEMENT, areaBySegmentIdentity[JSON.stringify(segmentList)], placementStableId));
			edgeList.push(structuralEdge(EDGE_TYPES.PLACES_ELEMENT, placementStableId, elementStableIdByGlobalId[globalId]));
			const propertyStableId = propertyStableIdByCedsId[`${desWorkbookLayout.cedsPropertyIdPrefix}${globalId}`];
			if (propertyStableId !== undefined) {
				edgeList.push({ type: EDGE_TYPES.PLACES_PROPERTY, fromStableId: placementStableId, toStableId: propertyStableId, properties: { provenanceTier: PROVENANCE_TIER.SPEC_AUTHORITATIVE, joinBasis: 'globalId', globalId } });
				placementPropertyEdgeCount++;
			}
			(placementPropertyListByGlobalId[globalId] = placementPropertyListByGlobalId[globalId] || []).push(onePlacement.propertyByName);
		});

		// ---- diagnostics: what CEDS's own two sheets disagree about (REPORTED, never repaired) ----
		const pathListDisagreementList = records.elementRecordList
			.filter((oneElement) => (oneElement.propertyByName.desPlacementPathListText || '') !== impliedPlacementPathListTextOf(placementPropertyListByGlobalId[oneElement.propertyByName.globalId] || []))
			.map((oneElement) => oneElement.propertyByName.globalId);
		const unplacedGlobalIdList = records.elementRecordList.map((oneElement) => oneElement.propertyByName.globalId).filter((globalId) => !placementPropertyListByGlobalId[globalId]);

		const countOfKind = (areaKind) => Object.keys(areaBySegmentIdentity).filter((segmentIdentity) => areaShapeOf(JSON.parse(segmentIdentity)).areaKind === areaKind).length;
		callback('', {
			nodes: nodeList,
			edges: edgeList,
			rootPropertyByName: {
				desVersion: DES_VERSION,
				desDomainCount: countOfKind(AREA_KIND.DOMAIN),
				desEntityCount: countOfKind(AREA_KIND.ENTITY),
				desCategoryCount: countOfKind(AREA_KIND.CATEGORY),
				desElementCount: records.elementRecordList.length,
				desPlacementCount: records.placementRecordList.length,
				globalIdJoinedElementCount: records.elementRecordList.length - unjoinedGlobalIdList.length,
				globalIdUnjoinedElementCount: unjoinedGlobalIdList.length,
				globalIdUnjoinedListText: JSON.stringify(unjoinedGlobalIdList),
				placementPropertyEdgeCount,
				unplacedElementCount: unplacedGlobalIdList.length,
				unplacedGlobalIdListText: JSON.stringify(unplacedGlobalIdList),
				placementPathListDisagreementCount: pathListDisagreementList.length,
			},
			layerReport: { unjoinedGlobalIdList, unplacedGlobalIdList, pathListDisagreementGlobalIdList: pathListDisagreementList },
		});
	});
};

module.exports = { layerDeclaration, produceLayer, DES_VERSION, WORKBOOK_FILE_NAME };
