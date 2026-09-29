'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sif260928TsvLoader.js — reads ImplementationSpecification_031326.tsv into one row object per
// SIF field (PLAN §3 A1b; SPEC §9 A3, A4, A21). This is the forge's data boundary: every guard on
// the source's shape lives here, and nothing downstream re-checks it.
//
//   loadImplementationSpecification({ sourcePath }, callback) → callback('', loadedSpecification)
//     loadedSpecification = { sourceFileName, rowList, sourceCensus, sourceReport }
//
// In order, each step refusing by name:
//   1. LAYOUT   lines split on CRLF; a stray CR or LF is refused. Each line is classified (blank,
//               table title, column header, 8-cell data row) and the sequence must follow
//               sif260928SourceGrammar's table, which ends on a data row (no trailing newline).
//   2. ROWS     per data row:
//               Description — ONE enclosing pair of double quotes is stripped, then the result is
//                 trimmed (A3). Doubled quotes inside ("") are kept as they are. descriptionQuoted
//                 records the strip, and descriptionCellText keeps the cell verbatim, because the
//                 trim loses padding that the flag alone cannot restore. An empty result is absent
//                 (null), never ''.
//               Characteristics — an empty cell means absent: characteristics, obligation and
//                 repeatable are null (A4). A non-empty cell outside the closed table is refused.
//                 obligationSourceColumnName names the column the obligation came from.
//               Mandatory — carried verbatim as mandatoryCellText and never folded into obligation.
//               CEDS ID — a SIF property carried verbatim (cedsIdCellText) and as cedsElementId,
//                 'P' plus the six digits. Anything but empty or six digits is refused. Nothing
//                 else reads it (FBB-001: the forge does no bridging).
//   3. XPATH    xpath is unique across the file.
//   4. CENSUS   the measured counts equal the snapshot's entry in sif260928SourceCensus.json.

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
const sourceGrammar = require('./sif260928SourceGrammar');
const { CHARACTERISTICS_TABLE } = require('./sif260928CharacteristicsTable');

const SOURCE_CENSUS_PATH = path.join(__dirname, 'sif260928SourceCensus.json');
const CHARACTERISTICS_COLUMN_NAME = 'Characteristics';
const CEDS_ID_CELL_RE = /^\d{6}$/;
const CEDS_ELEMENT_ID_PREFIX = 'P';
const METADATA_XPATH_SEGMENT = '/SIF_Metadata/';
const EXTENDED_ELEMENTS_XPATH_SEGMENT = '/SIF_ExtendedElements/';
const ATTRIBUTE_NAME_PREFIX = '@';
const { LINE_KIND } = sourceGrammar;

const refusal = (what, where) => ({ refusalError: refuse.byName({ moduleName, what, where }) });

// ---- 1. LAYOUT --------------------------------------------------------------------------------

const classifyLine = (lineText) => {
	if (lineText === '') {
		return { lineKind: LINE_KIND.BLANK };
	}
	if (lineText === sourceGrammar.COLUMN_HEADER_TEXT) {
		return { lineKind: LINE_KIND.COLUMN_HEADER };
	}
	const titleMatch = sourceGrammar.TABLE_TITLE_RE.exec(lineText);
	if (titleMatch) {
		return { lineKind: LINE_KIND.TABLE_TITLE, tableTitleName: titleMatch[1] };
	}
	const cellList = lineText.split('\t');
	if (cellList.length === sourceGrammar.COLUMN_NAME_LIST.length) {
		return { lineKind: LINE_KIND.DATA_ROW, cellList };
	}
	return { lineKind: null, cellCount: cellList.length };
};

const readLayout = ({ sourceText }) => {
	const lineTextList = sourceText.split(sourceGrammar.LINE_TERMINATOR);
	const lineCountByKind = { [LINE_KIND.BLANK]: 0, [LINE_KIND.TABLE_TITLE]: 0, [LINE_KIND.COLUMN_HEADER]: 0, [LINE_KIND.DATA_ROW]: 0 };
	const dataLineList = [];
	let previousKind = sourceGrammar.START_OF_FILE;
	let tableTitleName = null;

	for (let lineIndex = 0; lineIndex < lineTextList.length; lineIndex++) {
		const lineText = lineTextList[lineIndex];
		const sourceLineNumber = lineIndex + 1;
		if (/[\r\n]/.test(lineText)) {
			return refusal(`line ${sourceLineNumber} holds a CR or LF that is not part of a CRLF line ending`, 'the SIF TSV ends every line with CRLF; re-export the sheet');
		}
		const classified = classifyLine(lineText);
		if (classified.lineKind === null) {
			return refusal(
				`line ${sourceLineNumber} is not a blank line, a table title, the column header or a data row of ${sourceGrammar.COLUMN_NAME_LIST.length} cells (it has ${classified.cellCount}): ${JSON.stringify(lineText.slice(0, 120))}`,
				'every line of the SIF TSV is one of those four kinds (sif260928SourceGrammar)',
			);
		}
		if (sourceGrammar.FOLLOWING_KIND_LIST_BY_KIND[previousKind].indexOf(classified.lineKind) === -1) {
			return refusal(`line ${sourceLineNumber} is a ${classified.lineKind} line after a ${previousKind} line`, `after a ${previousKind} line the SIF TSV has one of: ${sourceGrammar.FOLLOWING_KIND_LIST_BY_KIND[previousKind].join(', ')}`);
		}
		lineCountByKind[classified.lineKind]++;
		if (classified.lineKind === LINE_KIND.TABLE_TITLE) {
			tableTitleName = classified.tableTitleName;
		}
		if (classified.lineKind === LINE_KIND.DATA_ROW) {
			dataLineList.push({ sourceLineNumber, tableTitleName, cellList: classified.cellList });
		}
		previousKind = classified.lineKind;
	}
	if (sourceGrammar.FOLLOWING_KIND_LIST_BY_KIND[previousKind].indexOf(sourceGrammar.END_OF_FILE) === -1) {
		return refusal(`the file ends on a ${previousKind} line`, 'the SIF TSV ends on its last data row, with no trailing newline');
	}
	return { lineCount: lineTextList.length, lineCountByKind, dataLineList };
};

// ---- 2. ROWS ----------------------------------------------------------------------------------

// SPEC §9 A3: exactly ONE enclosing pair, so a cell ending ""checked out.""" keeps its inner quotes
const stripOneEnclosingQuotePair = (cellText) => {
	const isQuoteWrapped = cellText.length >= 2 && cellText.startsWith('"') && cellText.endsWith('"');
	return { isQuoteWrapped, unwrappedText: isQuoteWrapped ? cellText.slice(1, -1) : cellText };
};

const interpretDataLine = ({ sourceLineNumber, tableTitleName, cellList }) => {
	const [name, mandatoryCellText, characteristicsCellText, type, descriptionCellText, xpath, cedsIdCellText, format] = cellList;

	const characteristicsEntry = characteristicsCellText === '' ? null : CHARACTERISTICS_TABLE[characteristicsCellText];
	if (characteristicsEntry === undefined) {
		return refusal(
			`line ${sourceLineNumber} (${xpath}) has Characteristics '${characteristicsCellText}', which is not in the closed table`,
			`Characteristics is empty (absent) or one of ${Object.keys(CHARACTERISTICS_TABLE).join(', ')} (sif260928CharacteristicsTable)`,
		);
	}
	if (cedsIdCellText !== '' && !CEDS_ID_CELL_RE.test(cedsIdCellText)) {
		return refusal(`line ${sourceLineNumber} (${xpath}) has CEDS ID '${cedsIdCellText}'`, 'the CEDS ID cell is empty or six digits');
	}

	const { isQuoteWrapped, unwrappedText } = stripOneEnclosingQuotePair(descriptionCellText);
	const trimmedDescription = unwrappedText.trim();

	return {
		sourceRow: {
			sourceLineNumber,
			tableTitleName,
			name,
			mandatoryCellText,
			characteristicsCellText,
			characteristics: characteristicsEntry === null ? null : characteristicsCellText,
			obligation: characteristicsEntry === null ? null : characteristicsEntry.obligation,
			repeatable: characteristicsEntry === null ? null : characteristicsEntry.repeatable,
			obligationSourceColumnName: characteristicsEntry === null ? null : CHARACTERISTICS_COLUMN_NAME,
			type,
			descriptionCellText,
			description: trimmedDescription === '' ? null : trimmedDescription,
			descriptionQuoted: isQuoteWrapped,
			descriptionTrimmed: trimmedDescription !== unwrappedText,
			xpath,
			cedsIdCellText,
			cedsElementId: cedsIdCellText === '' ? null : `${CEDS_ELEMENT_ID_PREFIX}${cedsIdCellText}`,
			format,
		},
	};
};

// ---- 3. XPATH ---------------------------------------------------------------------------------

const findDuplicateXpath = ({ rowList }) => {
	const sourceLineNumberByXpath = new Map();
	for (let rowIndex = 0; rowIndex < rowList.length; rowIndex++) {
		const oneRow = rowList[rowIndex];
		if (sourceLineNumberByXpath.has(oneRow.xpath)) {
			return refusal(`xpath '${oneRow.xpath}' appears on line ${sourceLineNumberByXpath.get(oneRow.xpath)} and again on line ${oneRow.sourceLineNumber}`, 'xpath is the identity of a SIF field row and is unique in the TSV');
		}
		sourceLineNumberByXpath.set(oneRow.xpath, oneRow.sourceLineNumber);
	}
	return {};
};

// ---- 4. CENSUS --------------------------------------------------------------------------------

const countWhere = (rowList, predicate) => rowList.filter(predicate).length;

const measureCensus = ({ layout, rowList }) => ({
	lineCount: layout.lineCount,
	tableTitleLineCount: layout.lineCountByKind[LINE_KIND.TABLE_TITLE],
	columnHeaderLineCount: layout.lineCountByKind[LINE_KIND.COLUMN_HEADER],
	blankLineCount: layout.lineCountByKind[LINE_KIND.BLANK],
	rowCount: rowList.length,
	metadataRowCount: countWhere(rowList, (oneRow) => oneRow.xpath.includes(METADATA_XPATH_SEGMENT)),
	extendedElementsRowCount: countWhere(rowList, (oneRow) => oneRow.xpath.includes(EXTENDED_ELEMENTS_XPATH_SEGMENT)),
	cedsAnnotatedRowCount: countWhere(rowList, (oneRow) => oneRow.cedsElementId !== null),
	distinctCedsElementIdCount: new Set(rowList.filter((oneRow) => oneRow.cedsElementId !== null).map((oneRow) => oneRow.cedsElementId)).size,
	emptyDescriptionRowCount: countWhere(rowList, (oneRow) => oneRow.description === null),
	attributeRowCount: countWhere(rowList, (oneRow) => oneRow.xpath.split('/').pop().startsWith(ATTRIBUTE_NAME_PREFIX)),
	emptyCharacteristicsRowCount: countWhere(rowList, (oneRow) => oneRow.characteristics === null),
	quoteWrappedDescriptionRowCount: countWhere(rowList, (oneRow) => oneRow.descriptionQuoted),
});

const compareCensus = ({ measuredCensus, snapshotName }) => {
	const declaredCensus = JSON.parse(fs.readFileSync(SOURCE_CENSUS_PATH, 'utf8')).censusBySnapshotName[snapshotName];
	if (declaredCensus === undefined) {
		return refusal(`snapshot '${snapshotName}' has no declared census`, `add its counts under censusBySnapshotName in ${path.basename(SOURCE_CENSUS_PATH)}`);
	}
	const countNameList = [...new Set([...Object.keys(declaredCensus), ...Object.keys(measuredCensus)])];
	const mismatchList = countNameList
		.filter((countName) => declaredCensus[countName] !== measuredCensus[countName])
		.map((countName) => `${countName} measured ${measuredCensus[countName]}, declared ${declaredCensus[countName]}`);
	if (mismatchList.length) {
		return refusal(`sourceCensus of snapshot '${snapshotName}' disagrees: ${mismatchList.join('; ')}`, `the TSV is not the one ${path.basename(SOURCE_CENSUS_PATH)} describes; a census value is never edited to match a measurement`);
	}
	return {};
};

// the report: facts worth seeing that no gate freezes
const describeSourceReport = ({ rowList }) => {
	const rowCountByCellText = (cellName) =>
		rowList.reduce((rowCountByText, oneRow) => ({ ...rowCountByText, [oneRow[cellName]]: (rowCountByText[oneRow[cellName]] || 0) + 1 }), {});
	const mandatoryAssertedRowList = rowList.filter((oneRow) => oneRow.mandatoryCellText !== '');
	return {
		characteristicsRowCountByCellText: rowCountByCellText('characteristicsCellText'),
		mandatoryRowCountByCellText: rowCountByCellText('mandatoryCellText'),
		mandatoryAssertedRowCountByCharacteristicsCellText: mandatoryAssertedRowList.reduce(
			(rowCountByText, oneRow) => ({ ...rowCountByText, [oneRow.characteristicsCellText]: (rowCountByText[oneRow.characteristicsCellText] || 0) + 1 }),
			{},
		),
		descriptionTrimmedRowCount: countWhere(rowList, (oneRow) => oneRow.descriptionTrimmed),
	};
};

// ---- the parse, pure: returns { refusalError } or { loadedSpecification } ---------------------

const parseImplementationSpecification = ({ sourceText, sourceFileName, snapshotName }) => {
	const layout = readLayout({ sourceText });
	if (layout.refusalError) {
		return layout;
	}

	const rowList = [];
	for (let dataLineIndex = 0; dataLineIndex < layout.dataLineList.length; dataLineIndex++) {
		const interpreted = interpretDataLine(layout.dataLineList[dataLineIndex]);
		if (interpreted.refusalError) {
			return interpreted;
		}
		rowList.push(interpreted.sourceRow);
	}

	const duplicateCheck = findDuplicateXpath({ rowList });
	if (duplicateCheck.refusalError) {
		return duplicateCheck;
	}

	const sourceCensus = measureCensus({ layout, rowList });
	const censusCheck = compareCensus({ measuredCensus: sourceCensus, snapshotName });
	if (censusCheck.refusalError) {
		return censusCheck;
	}

	return { loadedSpecification: { sourceFileName, rowList, sourceCensus, sourceReport: describeSourceReport({ rowList }) } };
};

// the snapshot is the directory the TSV sits in (the forger hands sourcePath = <snapshot>/<sourceFile>)
const loadImplementationSpecification = ({ sourcePath }, callback) => {
	fs.readFile(sourcePath, 'utf8', (readError, sourceText) => {
		if (readError) {
			callback(`${moduleName} could not read ${sourcePath}: ${readError.message}`);
			return;
		}
		const parsed = parseImplementationSpecification({ sourceText, sourceFileName: path.basename(sourcePath), snapshotName: path.basename(path.dirname(sourcePath)) });
		if (parsed.refusalError) {
			callback(parsed.refusalError.message);
			return;
		}
		callback('', parsed.loadedSpecification);
	});
};

module.exports = { loadImplementationSpecification, parseImplementationSpecification, moduleName };
