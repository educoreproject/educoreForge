'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sif260928RoundTripPair.js — the two sides of the eight-column regeneration proof (PLAN §3 A6; SPEC
// §9 A3, A25). The SOURCE side reads only the snapshot bytes; the GRAPH side reads only the graph
// reader. Neither calls the forge's loader or walk, so the proof cannot merely show that the forge
// agrees with itself. Both sides produce Map<statementKey, statement> over one vocabulary:
//
//   file|<sourceFileName>    { sha256, byteLength, lineCount }   the whole TSV, byte for byte
//   table|<objectPath>       { tableTitleText, titleLineNumber }  each table's title line
//   row|<xpath>              { sourceLineNumber, cellList, description, descriptionQuoted }
//   container|<path>         source side only, explicitlyOmitted  an element path with no row
//
// The GRAPH side regenerates the whole file from the graph alone: each Field's eight cells on its
// sourceLineNumber, each Object's tableTitleName two lines above its first Field and the column
// header one line above, every other line blank, lines joined with CRLF and no trailing newline.
// The header text and the line terminator are the grammar's constants, not graph content.
//
// A row's eight cells come from the Field's verbatim cell properties. An absent property is an empty
// cell: the walk omits an empty cell and never stamps '' (SPEC §9 A25), so absence here is the ruled
// encoding of an empty cell, not a default. A row also carries the two readings the forge stores of
// its Description cell: description (one enclosing quote pair stripped, then trimmed, absent when
// empty; A3) and descriptionQuoted. The source side reads the same cell under the same rule,
// independently, so a Field whose stored reading disagrees with its own cell is a content gap.
//
// Every graph label is classified by GRAPH_LABEL_DISPOSITION_TABLE. A node carrying none of those
// labels, or more than one, is an emission FAULT: the proof refuses to vouch for a graph holding a
// kind of node it has not classified.
//
// diffStatements compares values, not only keys (the harness's default diff compares keys, and a
// changed cell keeps its statementKey). A graph statement with no source statement is INVENTED. A source
// statement with no graph statement is LOST (lostReason absentFromGraph), explicitlyOmitted for a
// container and a contentGap otherwise. A statement on both sides whose values differ is ONE lost
// item, a contentGap with lostReason valueDiffers and the differing field names; it is not also
// counted as an invention, so each kind of fault moves exactly one of the verdict's totals.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sourceGrammar = require('./sif260928SourceGrammar');

// the eight TSV columns, in order, and the Field property each is regenerated from (SPEC §9 A25)
const COLUMN_PROPERTY_NAME_LIST = Object.freeze([
	Object.freeze({ columnName: 'Name', propertyName: 'name' }),
	Object.freeze({ columnName: 'Mandatory', propertyName: 'mandatoryCellText' }),
	Object.freeze({ columnName: 'Characteristics', propertyName: 'characteristics' }),
	Object.freeze({ columnName: 'Type', propertyName: 'type' }),
	Object.freeze({ columnName: 'Description', propertyName: 'descriptionCellText' }),
	Object.freeze({ columnName: 'XPath', propertyName: 'xpath' }),
	Object.freeze({ columnName: 'CEDS ID', propertyName: 'cedsIdCellText' }),
	Object.freeze({ columnName: 'Format', propertyName: 'format' }),
]);
const XPATH_COLUMN_INDEX = COLUMN_PROPERTY_NAME_LIST.findIndex((oneColumn) => oneColumn.columnName === 'XPath');
const DESCRIPTION_COLUMN_INDEX = COLUMN_PROPERTY_NAME_LIST.findIndex((oneColumn) => oneColumn.columnName === 'Description');

// what the proof does with each kind of graph node
const NODE_DISPOSITION = Object.freeze({
	ROW: 'row', // a TSV data row: regenerated and compared
	TABLE: 'table', // a TSV table: its title line regenerated and compared
	OMITTED_STRUCTURE: 'omittedStructure', // an element path with no row: the source lists it as explicitlyOmitted
	DERIVED_STRUCTURE: 'derivedStructure', // built from rows by the forge; no row or line of its own
});
const GRAPH_LABEL_DISPOSITION_TABLE = Object.freeze({
	Sif260928Field: NODE_DISPOSITION.ROW,
	Sif260928Object: NODE_DISPOSITION.TABLE,
	Sif260928Container: NODE_DISPOSITION.OMITTED_STRUCTURE,
	Sif260928Root: NODE_DISPOSITION.DERIVED_STRUCTURE,
	Sif260928Question: NODE_DISPOSITION.DERIVED_STRUCTURE,
	Sif260928Codeset: NODE_DISPOSITION.DERIVED_STRUCTURE,
	Sif260928CodesetValue: NODE_DISPOSITION.DERIVED_STRUCTURE,
	Sif260928EmbedText: NODE_DISPOSITION.DERIVED_STRUCTURE,
});

const STATEMENT_KIND = Object.freeze({ FILE: 'file', TABLE: 'table', ROW: 'row', CONTAINER: 'container' });
const LOST_REASON = Object.freeze({ ABSENT_FROM_GRAPH: 'absentFromGraph', VALUE_DIFFERS: 'valueDiffers' });
// ⟪G21⟫ the declaration the verdict carries: THIS module is the rule and 'container' the one kind it omits — an element
// path prefix derived from row xpaths, with no line of its own in the TSV (containerPathListOf)
const OMISSION_DECLARATION = Object.freeze({
	rule: 'forges/sif260928/lib/sif260928RoundTripPair.js',
	kindPropertyName: 'omittedKind',
	kindList: Object.freeze([STATEMENT_KIND.CONTAINER]),
	caveatText: '',
});
const STATEMENT_SEPARATOR = '|';
const XPATH_SEPARATOR = '/';
const OBJECT_SEGMENT_COUNT = 2; // /<collection>/<object>
// the title line sits two lines above a table's first row, the column header one line above
const TITLE_LINE_OFFSET = 2;
const COLUMN_HEADER_LINE_OFFSET = 1;
const TABLE_TITLE_SUFFIX = ': Table 1';

const SEMANTIC_VALIDATION_LIMIT =
	'BYTE-FOR-BYTE regeneration of ImplementationSpecification_031326.tsv from the graph alone: every ' +
	'data row (all eight cells verbatim, on its own line), every table title line, the column header, ' +
	'the blank separator lines, CRLF line endings and the absent trailing newline, compared by sha256 ' +
	'with the snapshot bytes, and row by row keyed by xpath so a failure names its row and column. Each ' +
	"Field's stored description (one enclosing quote pair stripped, then trimmed; SPEC §9 A3) and " +
	'descriptionQuoted are compared with the same reading of its own cell. NOT modelled: the 6,586 ' +
	'Containers (element paths with no row) are listed from the source as explicitlyOmitted, because a ' +
	'row regeneration has no line for them; Questions, Codesets, CodesetValues, search texts and the ' +
	'root are structure the forge derives from rows and are proved by the A2 to A5 gates, not here; so ' +
	'are the Field facts derived from cells (obligation, repeatable, cedsElementId, questionRefId, the ' +
	'path facts) and every edge, including the REFERENCES_OBJECT edges read from refIdResolutionMap.tsv, ' +
	'whose bytes are verified at intake but not regenerated. The column header text and the line ' +
	'terminator come from the source grammar, not from the graph.';

const statementKeyOf = (statementKind, subjectText) => `${statementKind}${STATEMENT_SEPARATOR}${subjectText}`;
const sha256Of = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const objectPathOf = (xpath) => `${XPATH_SEPARATOR}${xpath.split(XPATH_SEPARATOR).slice(1, 1 + OBJECT_SEGMENT_COUNT).join(XPATH_SEPARATOR)}`;

// SPEC §9 A3: exactly one enclosing pair of double quotes is stripped, then the text is trimmed; an
// empty result is absent (null). Written here, apart from the loader, so the graph is checked against
// the rule and not against the loader's own reading.
const descriptionReadingOf = (descriptionCellText) => {
	const descriptionQuoted = descriptionCellText.length >= 2 && descriptionCellText.startsWith('"') && descriptionCellText.endsWith('"');
	const trimmedText = (descriptionQuoted ? descriptionCellText.slice(1, -1) : descriptionCellText).trim();
	return { description: trimmedText === '' ? null : trimmedText, descriptionQuoted };
};

const fileStatementOf = (fileText) => ({ sha256: sha256Of(fileText), byteLength: Buffer.byteLength(fileText, 'utf8'), lineCount: fileText.split(sourceGrammar.LINE_TERMINATOR).length });

const rowStatementOf = ({ sourceLineNumber, cellList, description, descriptionQuoted }) => ({ sourceLineNumber, cellList, description, descriptionQuoted });

// ---- the SOURCE side ---------------------------------------------------------------------------

// every xpath prefix below its object that is not itself a row: the element paths the graph holds as
// Containers, which have no line in the TSV
const containerPathListOf = (xpathList) => {
	const xpathSet = new Set(xpathList);
	const containerPathSet = new Set();
	xpathList.forEach((xpath) => {
		const segmentList = xpath.split(XPATH_SEPARATOR).slice(1);
		for (let prefixSegmentCount = OBJECT_SEGMENT_COUNT + 1; prefixSegmentCount < segmentList.length; prefixSegmentCount++) {
			const prefixPath = `${XPATH_SEPARATOR}${segmentList.slice(0, prefixSegmentCount).join(XPATH_SEPARATOR)}`;
			if (!xpathSet.has(prefixPath)) {
				containerPathSet.add(prefixPath);
			}
		}
	});
	return [...containerPathSet];
};

const sourceStatementsOf = ({ sourceFileName, sourceText }) => {
	const statements = new Map();
	statements.set(statementKeyOf(STATEMENT_KIND.FILE, sourceFileName), fileStatementOf(sourceText));

	const lineTextList = sourceText.split(sourceGrammar.LINE_TERMINATOR);
	const xpathList = [];
	let pendingTitle = null;
	lineTextList.forEach((lineText, lineIndex) => {
		const sourceLineNumber = lineIndex + 1;
		const titleMatch = sourceGrammar.TABLE_TITLE_RE.exec(lineText);
		if (titleMatch) {
			pendingTitle = { tableTitleText: lineText, titleLineNumber: sourceLineNumber };
			return;
		}
		const cellList = lineText.split('\t');
		if (lineText === sourceGrammar.COLUMN_HEADER_TEXT || cellList.length !== COLUMN_PROPERTY_NAME_LIST.length) {
			return;
		}
		const xpath = cellList[XPATH_COLUMN_INDEX];
		if (pendingTitle !== null) {
			statements.set(statementKeyOf(STATEMENT_KIND.TABLE, objectPathOf(xpath)), pendingTitle);
			pendingTitle = null;
		}
		xpathList.push(xpath);
		statements.set(statementKeyOf(STATEMENT_KIND.ROW, xpath), rowStatementOf({ sourceLineNumber, cellList, ...descriptionReadingOf(cellList[DESCRIPTION_COLUMN_INDEX]) }));
	});

	containerPathListOf(xpathList).forEach((containerPath) => {
		statements.set(statementKeyOf(STATEMENT_KIND.CONTAINER, containerPath), { containerPath, omittedKind: STATEMENT_KIND.CONTAINER, explicitlyOmitted: true });
	});
	return { statements, stats: { lineCount: lineTextList.length, rowCount: xpathList.length, statementCount: statements.size } };
};

// ---- the GRAPH side ----------------------------------------------------------------------------

// an absent verbatim cell property is an empty cell (SPEC §9 A25)
const cellTextOf = (properties, propertyName) => (properties[propertyName] === undefined ? '' : String(properties[propertyName]));

const dispositionOf = (oneNode) => {
	const classifiedLabelList = oneNode.labels.filter((oneLabel) => GRAPH_LABEL_DISPOSITION_TABLE[oneLabel] !== undefined);
	if (classifiedLabelList.length !== 1) {
		return { fault: `node '${oneNode.stableId}' carries ${classifiedLabelList.length} classified labels (${oneNode.labels.join(', ')}); every node carries exactly one of ${Object.keys(GRAPH_LABEL_DISPOSITION_TABLE).join(', ')}` };
	}
	return { perStandardLabel: classifiedLabelList[0], disposition: GRAPH_LABEL_DISPOSITION_TABLE[classifiedLabelList[0]] };
};

const graphStatementsOf = ({ graph, sourceFileName }) => {
	const nodeListByDisposition = { [NODE_DISPOSITION.ROW]: [], [NODE_DISPOSITION.TABLE]: [], [NODE_DISPOSITION.OMITTED_STRUCTURE]: [], [NODE_DISPOSITION.DERIVED_STRUCTURE]: [] };
	const nodeCountByLabel = {};
	for (let nodeIndex = 0; nodeIndex < graph.nodes.length; nodeIndex++) {
		const oneNode = graph.nodes[nodeIndex];
		const classified = dispositionOf(oneNode);
		if (classified.fault !== undefined) {
			return { fault: classified.fault };
		}
		nodeListByDisposition[classified.disposition].push(oneNode);
		nodeCountByLabel[classified.perStandardLabel] = (nodeCountByLabel[classified.perStandardLabel] || 0) + 1;
	}

	const statements = new Map();
	const lineTextByLineNumber = new Map();
	let lineCollisionCount = 0;
	let unplacedLineCount = 0;
	// a line with no whole positive line number cannot be placed; it is counted, and its absence
	// from the regenerated text is what the file statement then reports
	const placeLine = (lineNumber, lineText) => {
		if (!Number.isInteger(lineNumber) || lineNumber < 1) {
			unplacedLineCount++;
			return;
		}
		if (lineTextByLineNumber.has(lineNumber)) {
			lineCollisionCount++;
		}
		lineTextByLineNumber.set(lineNumber, lineText);
	};

	const firstRowLineNumberByObjectPath = new Map();
	nodeListByDisposition[NODE_DISPOSITION.ROW].forEach((oneNode) => {
		const { properties } = oneNode;
		const cellList = COLUMN_PROPERTY_NAME_LIST.map((oneColumn) => cellTextOf(properties, oneColumn.propertyName));
		const sourceLineNumber = properties.sourceLineNumber;
		statements.set(
			statementKeyOf(STATEMENT_KIND.ROW, properties.xpath),
			rowStatementOf({ sourceLineNumber, cellList, description: properties.description === undefined ? null : properties.description, descriptionQuoted: properties.descriptionQuoted }),
		);
		placeLine(sourceLineNumber, cellList.join('\t'));
		const objectPath = objectPathOf(properties.xpath);
		if (!firstRowLineNumberByObjectPath.has(objectPath) || sourceLineNumber < firstRowLineNumberByObjectPath.get(objectPath)) {
			firstRowLineNumberByObjectPath.set(objectPath, sourceLineNumber);
		}
	});

	nodeListByDisposition[NODE_DISPOSITION.TABLE].forEach((oneNode) => {
		const { properties } = oneNode;
		const firstRowLineNumber = firstRowLineNumberByObjectPath.get(properties.path);
		const tableTitleText = `${properties.tableTitleName}${TABLE_TITLE_SUFFIX}`;
		const titleLineNumber = firstRowLineNumber === undefined ? null : firstRowLineNumber - TITLE_LINE_OFFSET;
		statements.set(statementKeyOf(STATEMENT_KIND.TABLE, properties.path), { tableTitleText, titleLineNumber });
		if (titleLineNumber !== null) {
			placeLine(titleLineNumber, tableTitleText);
			placeLine(firstRowLineNumber - COLUMN_HEADER_LINE_OFFSET, sourceGrammar.COLUMN_HEADER_TEXT);
		}
	});

	const lastLineNumber = Math.max(0, ...lineTextByLineNumber.keys());
	const regeneratedLineList = [];
	for (let lineNumber = 1; lineNumber <= lastLineNumber; lineNumber++) {
		regeneratedLineList.push(lineTextByLineNumber.has(lineNumber) ? lineTextByLineNumber.get(lineNumber) : '');
	}
	const regeneratedText = regeneratedLineList.join(sourceGrammar.LINE_TERMINATOR);
	statements.set(statementKeyOf(STATEMENT_KIND.FILE, sourceFileName), fileStatementOf(regeneratedText));

	return {
		statements,
		stats: {
			nodeCount: graph.nodes.length,
			edgeCount: graph.edges.length,
			nodeCountByLabel,
			nodeCountByDisposition: Object.keys(nodeListByDisposition).reduce((soFar, disposition) => ({ ...soFar, [disposition]: nodeListByDisposition[disposition].length }), {}),
			regeneratedLineCount: regeneratedLineList.length,
			lineCollisionCount,
			unplacedLineCount,
			statementCount: statements.size,
		},
	};
};

// ---- the DIFF ----------------------------------------------------------------------------------

const differingFieldNameListOf = (sourceStatement, graphStatement) =>
	[...new Set([...Object.keys(sourceStatement), ...Object.keys(graphStatement)])].filter((fieldName) => JSON.stringify(sourceStatement[fieldName]) !== JSON.stringify(graphStatement[fieldName]));

const diffStatementsOf = ({ sourceStatements, graphStatements }) => {
	const inventedList = [];
	const lostList = [];
	let matchedCount = 0;
	graphStatements.forEach((graphStatement, statementKey) => {
		if (!sourceStatements.has(statementKey)) {
			inventedList.push({ statementKey, statement: graphStatement });
		}
	});
	sourceStatements.forEach((sourceStatement, statementKey) => {
		if (!graphStatements.has(statementKey)) {
			lostList.push({ statementKey, statement: sourceStatement, lostCategory: sourceStatement.explicitlyOmitted === true ? 'explicitlyOmitted' : 'contentGap', lostReason: LOST_REASON.ABSENT_FROM_GRAPH });
			return;
		}
		const graphStatement = graphStatements.get(statementKey);
		const differingFieldNameList = differingFieldNameListOf(sourceStatement, graphStatement);
		if (differingFieldNameList.length) {
			lostList.push({ statementKey, statement: sourceStatement, graphStatement, lostCategory: 'contentGap', lostReason: LOST_REASON.VALUE_DIFFERS, differingFieldNameList });
			return;
		}
		matchedCount++;
	});
	return { inventedList, lostList, matchedCount };
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ sourceFileName } = {}) => {
		if (typeof sourceFileName !== 'string' || sourceFileName.length === 0) {
			throw new Error(`${moduleName} REFUSED: sourceFileName is required — the validator passes parserDescriptor.ini's sourceFile`);
		}

		// snapshotPath is the snapshot directory (the round-trip stage passes resolveBundle's
		// snapshotDirPath) or the TSV inside it
		const canonicalizeSource = ({ snapshotPath, verifiedFileList }, callback) => {
			const isDirectory = fs.statSync(snapshotPath).isDirectory();
			if (!isDirectory && path.basename(snapshotPath) !== sourceFileName) {
				callback(`${moduleName} REFUSED: snapshotPath '${snapshotPath}' is neither the snapshot directory nor its ${sourceFileName} — the answer key is that file`);
				return;
			}
			if (verifiedFileList.indexOf(sourceFileName) === -1) {
				callback(`${moduleName} REFUSED: ${sourceFileName} is not among the files intake verified against SHA256SUMS (${verifiedFileList.join(', ')}) — the answer key is only ever a verified file`);
				return;
			}
			const sourceFilePath = isDirectory ? path.join(snapshotPath, sourceFileName) : snapshotPath;
			fs.readFile(sourceFilePath, 'utf8', (readError, sourceText) => {
				if (readError) {
					callback(`${moduleName} could not read ${sourceFilePath}: ${readError.message}`);
					return;
				}
				callback('', sourceStatementsOf({ sourceFileName, sourceText }));
			});
		};

		const emitFromGraph = ({ reader }, callback) => {
			reader.readAll((readError, graph) => {
				if (readError) {
					callback(readError);
					return;
				}
				callback('', graphStatementsOf({ graph, sourceFileName }));
			});
		};

		const diffStatements = ({ sourceStatements, graphStatements }, callback) => {
			callback('', diffStatementsOf({ sourceStatements, graphStatements }));
		};

		return { canonicalizeSource, emitFromGraph, diffStatements, semanticValidationLimit: SEMANTIC_VALIDATION_LIMIT, omissionDeclaration: OMISSION_DECLARATION };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.GRAPH_LABEL_DISPOSITION_TABLE = GRAPH_LABEL_DISPOSITION_TABLE;
module.exports.NODE_DISPOSITION = NODE_DISPOSITION;
module.exports.LOST_REASON = LOST_REASON;
module.exports.STATEMENT_KIND = STATEMENT_KIND;
module.exports.OMISSION_DECLARATION = OMISSION_DECLARATION;
