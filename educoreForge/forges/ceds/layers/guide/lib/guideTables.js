'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// guideTables.js — the three TSVs of the CEDS `guide` layer read into rows, PURE apart from the one read per file (lane DES,
// 2026-10-12). Shared by the producer and the round trip so both read the SOURCE the same way; the round trip's independence
// lies on the GRAPH side (it rebuilds every row from edges and concept nodes, never from the producer's records).
//
//   readGuideTables({ snapshotPath }, callback(errString, { conceptRowList, classRowList, dateRowList }))
//   row = { <field>: text, ... , rowOrdinal }   (rowOrdinal = 1-based position in its file, the guide's own order)
//
// The extractor writes plain tab-separated text with no quoting; a quote or a wrong field count is refused by name rather
// than parsed around, because a TSV that needed quoting is not the file the extractor wrote.

const fs = require('fs');
const path = require('path');

const GUIDE_TABLE_LIST = Object.freeze([
	Object.freeze({ tableName: 'concept', fileName: 'ontologyGuideV14-conceptualModelConcept.tsv', fieldList: Object.freeze(['conceptOrdinal', 'conceptName', 'conceptDefinition', 'guidePageNumber']) }),
	Object.freeze({ tableName: 'classConcept', fileName: 'ontologyGuideV14-tableA1-classConcept.tsv', fieldList: Object.freeze(['className', 'classId', 'primaryConcept', 'secondaryConcept', 'guidePageNumber']) }),
	Object.freeze({ tableName: 'dateEventProperty', fileName: 'ontologyGuideV14-tableA2-dateEventProperty.tsv', fieldList: Object.freeze(['propertyName', 'propertyId', 'classText', 'conceptText', 'guidePageNumber']) }),
]);
// Table A-1 writes an em dash where a class has no secondary concept ("Classes with a single clear concept leave Secondary as
// '—'", guide p.24); the em dash is the guide's word for absence and the graph carries no edge for it
const NO_SECONDARY_CONCEPT_TEXT = '—';
const CONCEPT_LIST_SEPARATOR = ', ';

const rowListOfFile = ({ filePath, guideTable }) => {
	const lineList = fs.readFileSync(filePath, 'utf8').split('\n').filter((oneLine) => oneLine !== '');
	const headerList = lineList[0].split('\t');
	if (JSON.stringify(headerList) !== JSON.stringify(guideTable.fieldList)) {
		return { error: `${moduleName}: ${guideTable.fileName} header ${JSON.stringify(headerList)} is not ${JSON.stringify(guideTable.fieldList)}` };
	}
	const rowList = [];
	for (let lineIndex = 1; lineIndex < lineList.length; lineIndex++) {
		const cellList = lineList[lineIndex].split('\t');
		if (cellList.length !== guideTable.fieldList.length || lineList[lineIndex].indexOf('"') !== -1) {
			return { error: `${moduleName}: ${guideTable.fileName} line ${lineIndex + 1} has ${cellList.length} fields${lineList[lineIndex].indexOf('"') !== -1 ? ' and a quote' : ''}; the extractor writes ${guideTable.fieldList.length} unquoted fields` };
		}
		rowList.push(guideTable.fieldList.reduce((soFar, fieldName, fieldIndex) => ({ ...soFar, [fieldName]: cellList[fieldIndex] }), { rowOrdinal: lineIndex }));
	}
	return { rowList };
};

const readGuideTables = ({ snapshotPath }, callback) => {
	const rowListByTableName = {};
	for (const guideTable of GUIDE_TABLE_LIST) {
		const filePath = path.join(snapshotPath, guideTable.fileName);
		if (!fs.existsSync(filePath)) {
			callback(`${moduleName}: ${filePath} is absent`);
			return;
		}
		const read = rowListOfFile({ filePath, guideTable });
		if (read.error) {
			callback(read.error);
			return;
		}
		rowListByTableName[guideTable.tableName] = read.rowList;
	}
	callback('', { conceptRowList: rowListByTableName.concept, classRowList: rowListByTableName.classConcept, dateRowList: rowListByTableName.dateEventProperty });
};

module.exports = { readGuideTables, GUIDE_TABLE_LIST, NO_SECONDARY_CONCEPT_TEXT, CONCEPT_LIST_SEPARATOR };
