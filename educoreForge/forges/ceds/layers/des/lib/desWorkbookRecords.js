'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// desWorkbookRecords.js — the DES V13 workbook (as xlsx-reader returns it) read through its declared layout
// (desWorkbookLayout.json) into ELEMENT and PLACEMENT records, refusing by name every way the workbook could disagree with
// its layout. PURE.
//
//   recordsOfWorkbook({ workbook, layout }) -> { error } | { elementRecordList, elementRecordByGlobalId, placementRecordList }
//   record = { propertyByName, rowNumberPropertyByName }   (an empty cell is an ABSENT property, never '')
//
// A sheet's data rows are the rows after its header that carry at least one cell; a row of styled-but-empty cells (V13's
// 'All - By Name' has 34 after its last element) is not a statement and is not a record.

const LANDS_ON = Object.freeze({ ELEMENT: 'element', PLACEMENT: 'placement', ELEMENT_MUST_EQUAL: 'elementMustEqual', SHEET_SLOT: 'sheetSlot' });
const SHEET_ROLE = Object.freeze({ ELEMENT: 'element', PLACEMENT: 'placement', ELEMENT_VIEW: 'elementView' });

// cellValueOf — what a cell states, by the column's declared storage: its formula text, or its stored text
const cellValueOf = ({ cell, columnLayout }) => (columnLayout.storedAs === 'formula' ? cell.formulaText : cell.text);

// sheetRowsOf — one sheet's header check and its data rows as [{ rowNumber, valueByColumnIndex }], or an error
const sheetRowsOf = ({ workbook, sheetLayout }) => {
	const sheet = workbook.sheetByName[sheetLayout.sheetName];
	if (!sheet) {
		return { error: `${moduleName}: the workbook has no sheet '${sheetLayout.sheetName}' (it has ${workbook.sheetNameList.join(', ')})` };
	}
	const [headerRow, ...bodyRowList] = sheet.rowList;
	const headerTextList = (headerRow ? headerRow.cellList : []).map((oneCell) => oneCell.text);
	const layoutHeaderList = sheetLayout.columnList.map((oneColumn) => oneColumn.header);
	if (JSON.stringify(headerTextList) !== JSON.stringify(layoutHeaderList) || (headerRow && headerRow.cellList.some((oneCell, cellIndex) => oneCell.columnNumber !== cellIndex + 1))) {
		return { error: `${moduleName}: sheet '${sheetLayout.sheetName}' header ${JSON.stringify(headerTextList)} is not the layout's ${JSON.stringify(layoutHeaderList)} in columns A onward` };
	}
	const rowList = [];
	for (const oneRow of bodyRowList) {
		if (oneRow.cellList.length === 0) {
			continue;
		}
		const valueByColumnIndex = {};
		for (const oneCell of oneRow.cellList) {
			const columnLayout = sheetLayout.columnList[oneCell.columnNumber - 1];
			if (!columnLayout) {
				return { error: `${moduleName}: sheet '${sheetLayout.sheetName}' cell ${oneCell.cellReference} lies beyond the layout's ${sheetLayout.columnList.length} columns` };
			}
			if (columnLayout.cellTypeList.indexOf(oneCell.cellType) === -1) {
				return { error: `${moduleName}: sheet '${sheetLayout.sheetName}' cell ${oneCell.cellReference} ('${columnLayout.header}') is a ${oneCell.cellType} cell; the layout allows ${columnLayout.cellTypeList.join(', ')}` };
			}
			const cellValue = cellValueOf({ cell: oneCell, columnLayout });
			if (cellValue === undefined) {
				return { error: `${moduleName}: sheet '${sheetLayout.sheetName}' cell ${oneCell.cellReference} ('${columnLayout.header}') carries no ${columnLayout.storedAs === 'formula' ? 'formula' : 'value'}, which its column stores` };
			}
			valueByColumnIndex[oneCell.columnNumber - 1] = cellValue;
		}
		rowList.push({ rowNumber: oneRow.rowNumber, valueByColumnIndex });
	}
	return { rowList };
};

const propertyByNameOf = ({ sheetLayout, oneRow, landsOnList }) =>
	sheetLayout.columnList.reduce((soFar, oneColumn, columnIndex) => {
		if (landsOnList.indexOf(oneColumn.landsOn) === -1 || oneRow.valueByColumnIndex[columnIndex] === undefined) {
			return soFar;
		}
		return { ...soFar, [oneColumn.propertyName]: oneRow.valueByColumnIndex[columnIndex] };
	}, {});

// mustEqualFaultOf — the first elementMustEqual column whose value differs from the element's (absent counts as a value)
const mustEqualFaultOf = ({ sheetLayout, oneRow, elementRecord }) => {
	const faultColumnIndex = sheetLayout.columnList.findIndex(
		(oneColumn, columnIndex) => oneColumn.landsOn === LANDS_ON.ELEMENT_MUST_EQUAL && oneRow.valueByColumnIndex[columnIndex] !== elementRecord.propertyByName[oneColumn.propertyName],
	);
	if (faultColumnIndex === -1) {
		return '';
	}
	const faultColumn = sheetLayout.columnList[faultColumnIndex];
	return `${moduleName}: sheet '${sheetLayout.sheetName}' row ${oneRow.rowNumber} '${faultColumn.header}' is ${JSON.stringify(oneRow.valueByColumnIndex[faultColumnIndex])} but element ${elementRecord.propertyByName.globalId} says ${JSON.stringify(elementRecord.propertyByName[faultColumn.propertyName])} — the layout says this column repeats the element, and a differing value would be lost`;
};

const recordsOfWorkbook = ({ workbook, layout }) => {
	const layoutSheetNameList = layout.sheetList.map((oneSheet) => oneSheet.sheetName);
	const unknownSheetNameList = workbook.sheetNameList.filter((oneName) => layoutSheetNameList.indexOf(oneName) === -1);
	if (unknownSheetNameList.length) {
		return { error: `${moduleName}: the workbook carries sheet(s) ${unknownSheetNameList.join(', ')} the layout does not describe — every sheet comes out of the graph, so every sheet must be described` };
	}
	if (JSON.stringify(workbook.sheetNameList) !== JSON.stringify(layoutSheetNameList)) {
		return { error: `${moduleName}: the workbook's sheets ${JSON.stringify(workbook.sheetNameList)} are not the layout's ${JSON.stringify(layoutSheetNameList)} in order` };
	}
	const rowListBySheetName = {};
	for (const oneSheet of layout.sheetList) {
		const sheetRows = sheetRowsOf({ workbook, sheetLayout: oneSheet });
		if (sheetRows.error) {
			return { error: sheetRows.error };
		}
		rowListBySheetName[oneSheet.sheetName] = sheetRows.rowList;
	}
	const sheetLayoutOfRole = (sheetRole) => layout.sheetList.filter((oneSheet) => oneSheet.sheetRole === sheetRole);

	// elements first: every other sheet refers to them
	const [elementSheet] = sheetLayoutOfRole(SHEET_ROLE.ELEMENT);
	const elementRecordList = [];
	const elementRecordByGlobalId = {};
	for (const oneRow of rowListBySheetName[elementSheet.sheetName]) {
		const propertyByName = propertyByNameOf({ sheetLayout: elementSheet, oneRow, landsOnList: [LANDS_ON.ELEMENT] });
		if (propertyByName.globalId === undefined) {
			return { error: `${moduleName}: sheet '${elementSheet.sheetName}' row ${oneRow.rowNumber} carries no Global ID` };
		}
		if (elementRecordByGlobalId[propertyByName.globalId]) {
			return { error: `${moduleName}: Global ID ${propertyByName.globalId} names two rows of '${elementSheet.sheetName}'` };
		}
		const elementRecord = { propertyByName, rowNumberPropertyByName: { [`${elementSheet.sheetSlotName}RowNumber`]: oneRow.rowNumber } };
		elementRecordList.push(elementRecord);
		elementRecordByGlobalId[propertyByName.globalId] = elementRecord;
	}

	const elementOfRow = ({ sheetLayout, oneRow }) => {
		const globalIdColumnIndex = sheetLayout.columnList.findIndex((oneColumn) => oneColumn.header === layout.globalIdColumnHeader);
		const globalId = oneRow.valueByColumnIndex[globalIdColumnIndex];
		const elementRecord = elementRecordByGlobalId[globalId];
		return elementRecord ? { elementRecord } : { error: `${moduleName}: sheet '${sheetLayout.sheetName}' row ${oneRow.rowNumber} names Global ID ${JSON.stringify(globalId)}, which '${elementSheet.sheetName}' does not carry` };
	};

	// element views ('New', 'Changed'): their own slot columns and row number land on the element; the rest must equal it
	for (const oneSheet of sheetLayoutOfRole(SHEET_ROLE.ELEMENT_VIEW)) {
		for (const oneRow of rowListBySheetName[oneSheet.sheetName]) {
			const found = elementOfRow({ sheetLayout: oneSheet, oneRow });
			if (found.error) {
				return { error: found.error };
			}
			const mustEqualFault = mustEqualFaultOf({ sheetLayout: oneSheet, oneRow, elementRecord: found.elementRecord });
			if (mustEqualFault) {
				return { error: mustEqualFault };
			}
			const rowNumberPropertyName = `${oneSheet.sheetSlotName}RowNumber`;
			if (found.elementRecord.rowNumberPropertyByName[rowNumberPropertyName] !== undefined) {
				return { error: `${moduleName}: element ${found.elementRecord.propertyByName.globalId} appears twice on '${oneSheet.sheetName}'` };
			}
			Object.assign(found.elementRecord.propertyByName, propertyByNameOf({ sheetLayout: oneSheet, oneRow, landsOnList: [LANDS_ON.SHEET_SLOT] }));
			found.elementRecord.rowNumberPropertyByName[rowNumberPropertyName] = oneRow.rowNumber;
		}
	}

	// placements
	const [placementSheet] = sheetLayoutOfRole(SHEET_ROLE.PLACEMENT);
	const placementRecordList = [];
	const seenDataModelIdSet = new Set();
	for (const oneRow of rowListBySheetName[placementSheet.sheetName]) {
		const found = elementOfRow({ sheetLayout: placementSheet, oneRow });
		if (found.error) {
			return { error: found.error };
		}
		const mustEqualFault = mustEqualFaultOf({ sheetLayout: placementSheet, oneRow, elementRecord: found.elementRecord });
		if (mustEqualFault) {
			return { error: mustEqualFault };
		}
		const propertyByName = propertyByNameOf({ sheetLayout: placementSheet, oneRow, landsOnList: [LANDS_ON.PLACEMENT] });
		if (propertyByName.dataModelId === undefined || seenDataModelIdSet.has(propertyByName.dataModelId)) {
			return { error: `${moduleName}: sheet '${placementSheet.sheetName}' row ${oneRow.rowNumber} has ${propertyByName.dataModelId === undefined ? 'no' : 'a repeated'} Data Model ID ${JSON.stringify(propertyByName.dataModelId)}` };
		}
		if (propertyByName.desDomainName === undefined || propertyByName.desEntityName === undefined) {
			return { error: `${moduleName}: sheet '${placementSheet.sheetName}' row ${oneRow.rowNumber} has no Domain or no Entity` };
		}
		seenDataModelIdSet.add(propertyByName.dataModelId);
		placementRecordList.push({ propertyByName: { ...propertyByName, globalId: found.elementRecord.propertyByName.globalId }, rowNumberPropertyByName: { [`${placementSheet.sheetSlotName}RowNumber`]: oneRow.rowNumber } });
	}
	return { elementRecordList, elementRecordByGlobalId, placementRecordList };
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => ({ recordsOfWorkbook, LANDS_ON, SHEET_ROLE });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
