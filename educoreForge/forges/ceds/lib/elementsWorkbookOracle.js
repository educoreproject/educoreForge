'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// elementsWorkbookOracle.js — GATE D (lane DES, campaign cedsRichness-101226, 2026-10-12; COPPER_RIVER ruling Q5): the
// CEDS-Elements CEDS-V14.0.0.0.xlsx workbook, a SECOND, INDEPENDENT rendering of the same release, held against the RDF this
// build compiled FROM ITS GRAPH. The CEDS round trip compares the graph with the ontology it was forged from, so a defect
// shared by the forge and the compiler (a field read wrongly and written back the same wrong way) is invisible to it; the
// workbook was printed by CEDS from its own database, by code that shares nothing with ours.
//
//   compareWorkbookWithStatements({ workbook, emittedStatementMap, normalizeLiteral, layout, declaredDifferenceList })
//     -> { comparedRowCount, comparedFieldCount, agreeingFieldCount, declaredDifferenceList (observed), undeclaredDifferenceList,
//          unobservedDeclaredDifferenceList }
//
// A difference is (sheet, IRI, column) whose value set differs between the workbook and the emission. A difference listed in
// elementsWorkbookDeclaredDifferences.json (with its reason) is REPORTED and tolerated; any other fails the verdict; and a
// declared difference that is NOT observed fails it too, because a stale declaration would excuse a future real one.
// PURE: the workbook and the statements are handed in.

const unique = (valueList) => Array.from(new Set(valueList)).sort();

const expandCurie = ({ curieText, prefixByName }) => {
	const [prefixName, localName] = curieText.split(':');
	return prefixByName[prefixName] === undefined ? { error: `${moduleName}: prefix '${prefixName}' of ${curieText} is not declared in the layout` } : { predicate: `${prefixByName[prefixName]}${localName}` };
};

// objectListBySubjectAndPredicate — the emission, indexed: subject -> predicate -> [object text]
const objectIndexOf = (emittedStatementMap) => {
	const objectListByPair = new Map();
	emittedStatementMap.forEach((oneStatement) => {
		const pairText = `${oneStatement.subject}␟${oneStatement.predicate}`;
		(objectListByPair.get(pairText) || objectListByPair.set(pairText, []).get(pairText)).push(String(oneStatement.object));
	});
	return objectListByPair;
};

const compareWorkbookWithStatements = ({ workbook, emittedStatementMap, normalizeLiteral, layout, declaredDifferenceList }) => {
	const objectListByPair = objectIndexOf(emittedStatementMap);
	const declaredByIdentity = new Map(declaredDifferenceList.map((oneDeclared) => [`${oneDeclared.sheetName}␟${oneDeclared.iri}␟${oneDeclared.header}`, oneDeclared]));
	const observedDeclaredIdentitySet = new Set();
	const observedDeclaredList = [];
	const undeclaredDifferenceList = [];
	let comparedRowCount = 0;
	let comparedFieldCount = 0;
	let agreeingFieldCount = 0;
	for (const sheetLayout of layout.sheetList) {
		const sheet = workbook.sheetByName[sheetLayout.sheetName];
		if (!sheet) {
			return { error: `${moduleName}: the workbook has no sheet '${sheetLayout.sheetName}'` };
		}
		const [headerRow, ...bodyRowList] = sheet.rowList;
		const columnNumberByHeader = {};
		headerRow.cellList.forEach((oneCell) => {
			columnNumberByHeader[oneCell.text] = oneCell.columnNumber;
		});
		const missingHeaderList = [sheetLayout.iriColumnHeader].concat(sheetLayout.columnList.map((oneColumn) => oneColumn.header)).filter((oneHeader) => columnNumberByHeader[oneHeader] === undefined);
		if (missingHeaderList.length) {
			return { error: `${moduleName}: sheet '${sheetLayout.sheetName}' has no column(s) ${missingHeaderList.join(', ')}` };
		}
		const describedHeaderSet = new Set([sheetLayout.iriColumnHeader].concat(sheetLayout.columnList.map((oneColumn) => oneColumn.header), sheetLayout.notComparedColumnList));
		const undescribedHeaderList = Object.keys(columnNumberByHeader).filter((oneHeader) => !describedHeaderSet.has(oneHeader));
		if (undescribedHeaderList.length) {
			return { error: `${moduleName}: sheet '${sheetLayout.sheetName}' carries column(s) ${undescribedHeaderList.join(', ')} the layout neither compares nor lists as not compared` };
		}
		for (const oneRow of bodyRowList) {
			if (oneRow.cellList.length === 0) {
				continue;
			}
			const cellByColumnNumber = {};
			oneRow.cellList.forEach((oneCell) => {
				cellByColumnNumber[oneCell.columnNumber] = oneCell;
			});
			const iriCell = cellByColumnNumber[columnNumberByHeader[sheetLayout.iriColumnHeader]];
			if (!iriCell || !iriCell.text) {
				return { error: `${moduleName}: sheet '${sheetLayout.sheetName}' row ${oneRow.rowNumber} has no IRI` };
			}
			const iri = iriCell.text.trim();
			comparedRowCount++;
			for (const oneColumn of sheetLayout.columnList) {
				comparedFieldCount++;
				const cell = cellByColumnNumber[columnNumberByHeader[oneColumn.header]];
				const cellText = cell === undefined ? undefined : cell.formulaText !== undefined ? cell.formulaText : cell.text;
				const rawWorkbookValueList = cellText === undefined || cellText.trim() === '' ? [] : cellText.split(layout.valueSplitText);
				const workbookValueList = unique(rawWorkbookValueList.map((oneValue) => (oneColumn.objectKind === 'literal' ? normalizeLiteral(oneValue) : oneValue.trim())).filter((oneValue) => oneValue !== ''));
				const expanded = expandCurie({ curieText: oneColumn.predicate, prefixByName: layout.prefixByName });
				if (expanded.error) {
					return { error: expanded.error };
				}
				// the column's declared rendering rules (layout data): graph objects the workbook never prints, and the empty literal
				const graphValueList = unique(objectListByPair.get(`${iri}␟${expanded.predicate}`) || []).filter(
					(oneValue) =>
						(oneColumn.ignoredGraphObjectList || []).indexOf(oneValue) === -1 &&
						!(oneColumn.ignoredGraphObjectSubstringList || []).some((oneSubstring) => oneValue.indexOf(oneSubstring) !== -1) &&
						!(layout.graphEmptyLiteralIsEmptyCell === true && oneColumn.objectKind === 'literal' && oneValue === ''),
				);
				if (JSON.stringify(workbookValueList) === JSON.stringify(graphValueList)) {
					agreeingFieldCount++;
					continue;
				}
				const differenceIdentity = `${sheetLayout.sheetName}␟${iri}␟${oneColumn.header}`;
				const difference = { sheetName: sheetLayout.sheetName, iri, header: oneColumn.header, workbookValueList: workbookValueList.map((oneValue) => oneValue.slice(0, 160)), graphValueList: graphValueList.map((oneValue) => oneValue.slice(0, 160)) };
				if (declaredByIdentity.has(differenceIdentity)) {
					observedDeclaredIdentitySet.add(differenceIdentity);
					observedDeclaredList.push({ ...difference, reason: declaredByIdentity.get(differenceIdentity).reason });
				} else {
					undeclaredDifferenceList.push(difference);
				}
			}
		}
	}
	const unobservedDeclaredDifferenceList = declaredDifferenceList.filter((oneDeclared) => !observedDeclaredIdentitySet.has(`${oneDeclared.sheetName}␟${oneDeclared.iri}␟${oneDeclared.header}`));
	return { comparedRowCount, comparedFieldCount, agreeingFieldCount, declaredDifferenceList: observedDeclaredList, undeclaredDifferenceList, unobservedDeclaredDifferenceList };
};

module.exports = { compareWorkbookWithStatements, expandCurie };
