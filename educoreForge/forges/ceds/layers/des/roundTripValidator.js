'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripValidator.js — the round trip of CEDS's `des` layer (lane DES, campaign cedsRichness-101226, 2026-10-12): every
// cell of every sheet of CEDS-V13.0.0.0.xlsx, re-emitted FROM THE GRAPH and compared cell by cell with the workbook.
//
// STATEMENTS (one per non-empty cell, keyed '<sheet>|<row>|<header>', value = what the cell states: its text, or its formula
// for a formula column), plus the header cells, plus the two id joins:
//   join|placement|<Data Model ID>   'P' + Global ID, for every placement whose Global ID names a V14 property (source side:
//                                    the workbook against the base's property ids; graph side: the PLACES_PROPERTY edge)
//   join|element|<Global ID>         the same for SAME_GLOBAL_ID_PROPERTY
//
// INDEPENDENCE: the source side reads the workbook through xlsx-reader and the layout's column->storage rule ONLY; it
// does not use the producer's records module, so a producer that dropped, merged or moved a value cannot agree with itself
// here. The graph side re-emits each sheet from the nodes AND THE EDGES: a placement's Domain / Entity / Category come
// from walking HAS_DES_* up from the placement, and its element columns from following PLACES_ELEMENT, so a wrong or missing
// edge shows up as a wrong cell.

const path = require('path');
const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', 'lib');
const xlsxReader = require(path.join(TREE_LIB, 'xlsx-reader', 'xlsx-reader'))();
const { validatorFor } = require(path.join(TREE_LIB, 'layer-framework', 'layerRoundTrip'))();
const desWorkbookLayout = require('./lib/desWorkbookLayout.json');
const { WORKBOOK_FILE_NAME } = require('./forgeDesLayer');

const VERDICT_VERSION = 'cedsDesLayer-1';
const SEMANTIC_VALIDATION_LIMIT =
	'Models every non-empty cell of the four sheets of CEDS-V13.0.0.0.xlsx as one statement (sheet, row, header -> text, or ' +
	'formula text for the URL column), the header cells, and the two Global ID joins to V14 properties. Does NOT model cell ' +
	'styling, column widths, empty rows, or a cell\'s numeric-vs-text type beyond the layout\'s per-column type rule (refused at ' +
	'forge time, not measured here). Header cells are re-emitted from the layout, which the forge refuses to let disagree ' +
	'with the workbook.';

const statement = (kind, value) => ({ kind, value });

// ---- SOURCE: the workbook's own cells ----
const sourceStatementsOf = ({ snapshotPath }, callback) => {
	xlsxReader.readWorkbookFile({ filePath: path.join(snapshotPath, WORKBOOK_FILE_NAME) }, (readError, workbook) => {
		if (readError) {
			callback(readError);
			return;
		}
		const statementMap = new Map();
		for (const oneSheet of desWorkbookLayout.sheetList) {
			const sheet = workbook.sheetByName[oneSheet.sheetName];
			if (!sheet) {
				callback(`${moduleName}: the workbook has no sheet '${oneSheet.sheetName}'`);
				return;
			}
			sheet.rowList.forEach((oneRow, rowIndex) => {
				oneRow.cellList.forEach((oneCell) => {
					if (rowIndex === 0) {
						statementMap.set(`${oneSheet.sheetName}|header|${oneCell.columnNumber}`, statement('header', oneCell.text));
						return;
					}
					const columnLayout = oneSheet.columnList[oneCell.columnNumber - 1];
					const cellValue = columnLayout && columnLayout.storedAs === 'formula' ? oneCell.formulaText : oneCell.text;
					statementMap.set(`${oneSheet.sheetName}|${oneRow.rowNumber}|${columnLayout ? columnLayout.header : `column${oneCell.columnNumber}`}`, statement('cell', cellValue));
				});
			});
		}
		callback('', statementMap);
	});
};

// the joins the SOURCE implies, given the base's property ids (read from the same graph, never from the layer)
const sourceJoinStatementsOf = ({ workbookStatementMap, basePropertyCedsIdSet }) => {
	const joinMap = new Map();
	const placementSheet = desWorkbookLayout.placementSheetName;
	const elementSheet = desWorkbookLayout.elementSheetName;
	const globalIdByRowKey = {};
	workbookStatementMap.forEach((oneStatement, oneStatementKey) => {
		const [sheetName, rowText, header] = oneStatementKey.split('|');
		if (oneStatement.kind === 'cell' && (header === desWorkbookLayout.globalIdColumnHeader || header === desWorkbookLayout.dataModelIdColumnHeader)) {
			(globalIdByRowKey[`${sheetName}|${rowText}`] = globalIdByRowKey[`${sheetName}|${rowText}`] || {})[header] = oneStatement.value;
		}
	});
	Object.keys(globalIdByRowKey).forEach((rowKey) => {
		const rowIds = globalIdByRowKey[rowKey];
		const propertyId = `${desWorkbookLayout.cedsPropertyIdPrefix}${rowIds[desWorkbookLayout.globalIdColumnHeader]}`;
		if (!basePropertyCedsIdSet.has(propertyId)) {
			return;
		}
		if (rowKey.startsWith(`${placementSheet}|`)) {
			joinMap.set(`join|placement|${rowIds[desWorkbookLayout.dataModelIdColumnHeader]}`, statement('join', propertyId));
		} else if (rowKey.startsWith(`${elementSheet}|`)) {
			joinMap.set(`join|element|${rowIds[desWorkbookLayout.globalIdColumnHeader]}`, statement('join', propertyId));
		}
	});
	return joinMap;
};

// ---- GRAPH: the sheets re-emitted from nodes and edges ----
const graphStatementsOfLayer = ({ layerGraph }) => {
	const nodeByStableId = {};
	layerGraph.nodes.forEach((oneNode) => {
		nodeByStableId[oneNode.stableId] = oneNode;
	});
	const parentStableIdByChild = {};
	const elementStableIdByPlacement = {};
	const propertyCedsIdListByLayerNode = {};
	for (const oneEdge of layerGraph.edges) {
		if (['HAS_DES_ENTITY', 'HAS_DES_CATEGORY', 'HAS_DES_PLACEMENT', 'HAS_DES_DOMAIN'].indexOf(oneEdge.type) !== -1) {
			if (parentStableIdByChild[oneEdge.toStableId] !== undefined) {
				return { error: `${moduleName}: ${oneEdge.toStableId} has two DES parents` };
			}
			parentStableIdByChild[oneEdge.toStableId] = oneEdge.fromStableId;
		} else if (oneEdge.type === 'PLACES_ELEMENT') {
			elementStableIdByPlacement[oneEdge.fromStableId] = oneEdge.toStableId;
		} else if (oneEdge.type === 'PLACES_PROPERTY' || oneEdge.type === 'SAME_GLOBAL_ID_PROPERTY') {
			const baseEndpoint = layerGraph.baseEndpointByStableId[oneEdge.toStableId];
			(propertyCedsIdListByLayerNode[oneEdge.fromStableId] = propertyCedsIdListByLayerNode[oneEdge.fromStableId] || []).push(baseEndpoint ? baseEndpoint.cedsId : `(no base node ${oneEdge.toStableId})`);
		}
	}
	const graphStatements = new Map();
	desWorkbookLayout.sheetList.forEach((oneSheet) => {
		oneSheet.columnList.forEach((oneColumn, columnIndex) => {
			graphStatements.set(`${oneSheet.sheetName}|header|${columnIndex + 1}`, statement('header', oneColumn.header));
		});
	});
	// the area path of a placement, walked up the HAS_DES_* edges to the layer root
	const areaNameListAbove = (placementStableId) => {
		const nameList = [];
		let cursorStableId = parentStableIdByChild[placementStableId];
		while (cursorStableId !== undefined && nodeByStableId[cursorStableId] && nodeByStableId[cursorStableId].role === 'DmeArea') {
			nameList.unshift(nodeByStableId[cursorStableId].properties.name);
			cursorStableId = parentStableIdByChild[cursorStableId];
		}
		return nameList;
	};
	const emitCell = ({ sheetName, rowNumber, header, cellValue }) => {
		if (cellValue !== undefined && cellValue !== null) {
			graphStatements.set(`${sheetName}|${rowNumber}|${header}`, statement('cell', `${cellValue}`));
		}
	};
	for (const oneNode of layerGraph.nodes) {
		const properties = oneNode.properties;
		if (oneNode.role === 'DmeLayerElement') {
			desWorkbookLayout.sheetList
				.filter((oneSheet) => oneSheet.sheetRole !== 'placement')
				.forEach((oneSheet) => {
					const rowNumber = properties[`${oneSheet.sheetSlotName}RowNumber`];
					if (rowNumber === undefined) {
						return;
					}
					oneSheet.columnList.forEach((oneColumn) => emitCell({ sheetName: oneSheet.sheetName, rowNumber, header: oneColumn.header, cellValue: properties[oneColumn.propertyName] }));
				});
			(propertyCedsIdListByLayerNode[oneNode.stableId] || []).forEach((cedsId) => graphStatements.set(`join|element|${properties.globalId}`, statement('join', cedsId)));
		} else if (oneNode.role === 'DmePlacement') {
			const placementSheet = desWorkbookLayout.sheetList.find((oneSheet) => oneSheet.sheetRole === 'placement');
			const rowNumber = properties[`${placementSheet.sheetSlotName}RowNumber`];
			const element = nodeByStableId[elementStableIdByPlacement[oneNode.stableId]];
			const areaNameList = areaNameListAbove(oneNode.stableId);
			const walkedValueByPropertyName = {
				desDomainName: areaNameList[0],
				desEntityName: areaNameList[1],
				desCategoryPathText: areaNameList.length > 2 ? areaNameList.slice(2).join(desWorkbookLayout.categoryPathSeparator) : undefined,
			};
			placementSheet.columnList.forEach((oneColumn) => {
				const cellValue =
					oneColumn.landsOn === 'elementMustEqual'
						? element && element.properties[oneColumn.propertyName]
						: Object.prototype.hasOwnProperty.call(walkedValueByPropertyName, oneColumn.propertyName)
							? walkedValueByPropertyName[oneColumn.propertyName]
							: properties[oneColumn.propertyName];
				emitCell({ sheetName: placementSheet.sheetName, rowNumber, header: oneColumn.header, cellValue });
			});
			(propertyCedsIdListByLayerNode[oneNode.stableId] || []).forEach((cedsId) => graphStatements.set(`join|placement|${properties.dataModelId}`, statement('join', cedsId)));
		}
	}
	return { graphStatements };
};

const validatorApi = validatorFor({
	standardSource: 'CEDS',
	layerKey: 'des',
	verdictVersion: VERDICT_VERSION,
	semanticValidationLimit: SEMANTIC_VALIDATION_LIMIT,
	sourceFileList: [WORKBOOK_FILE_NAME],
	// the joins need the base's property ids, which only the graph holds; the layer's own nodes are not read here
	sourceStatementsOf: ({ snapshotPath, layerGraph }, callback) =>
		sourceStatementsOf({ snapshotPath }, (sourceError, workbookStatementMap) => {
			if (sourceError) {
				callback(sourceError);
				return;
			}
			const joinMap = sourceJoinStatementsOf({ workbookStatementMap, basePropertyCedsIdSet: new Set(layerGraph.basePropertyCedsIdList || []) });
			joinMap.forEach((oneStatement, oneStatementKey) => workbookStatementMap.set(oneStatementKey, oneStatement));
			callback('', workbookStatementMap);
		}),
	graphStatementsOf: ({ layerGraph }) => graphStatementsOfLayer({ layerGraph }),
});

module.exports = { validate: validatorApi.validate, validateWithLayerGraph: validatorApi.validateWithLayerGraph, graphStatementsOfLayer, VERDICT_VERSION };
