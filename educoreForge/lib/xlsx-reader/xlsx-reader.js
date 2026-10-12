'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// xlsx-reader.js — read an Office Open XML workbook (.xlsx) CELL BY CELL, exactly as the file states each cell
// (lane DES, campaign cedsRichness-101226, 2026-10-12). Built for forges that must round-trip a published workbook,
// so it returns what the file SAYS, not what a spreadsheet application would DISPLAY:
//
//   readWorkbookFile({ filePath }, callback) -> callback(errString, workbook)
//   readWorkbookBytes({ workbookBytes })     -> { error } | { workbook }
//
//   workbook = { sheetNameList, sheetByName: { <name>: { rowList: [ { rowNumber, cellList } ] } } }
//   cell     = { cellReference, columnNumber, cellType, text, formulaText }
//
//   cellType     'sharedString' | 'inlineString' | 'formulaString' | 'number' | 'boolean' | 'error'
//   text         the cell's stored value as text: a string cell's string (rich-text runs joined, phonetic runs
//                left out, _xHHHH_ escapes decoded per ECMA-376 §22.4.2.4), a number cell's <v> text VERBATIM
//                (never coerced, so '000328' can never become 328 and 74974 stays '74974')
//   formulaText  the formula as written, WITH its leading '=' (the cell a person typed), or undefined
//
// WHY THESE CHOICES. A workbook's URL column can be a =HYPERLINK(...) formula (CEDS V13: 5,110 of 5,110); a reader
// that kept only the cached value would store something the publisher did not write. Global IDs are text cells with
// leading zeros; a numeric coercion would silently join '328' instead of '000328'. openpyxl, the independent oracle
// this reader is proven against (test/), leaves _x000D_ undecoded; this reader decodes it, and the test maps the one
// to the other by a declared rule rather than by agreeing with openpyxl's omission.
//
// Unzip is fflate (exact-pinned 0.8.2, zero dependencies); XML is sax, already in the tree. Pure apart from the one
// file read. Control flow: err-string-first callbacks; no async/await; try/catch only at the two synchronous
// third-party boundaries (unzip, XML parse), converted to an error value.

const fs = require('fs');
const fflate = require('fflate');
const sax = require('sax');

const CELL_TYPE_BY_ATTRIBUTE = Object.freeze({
	s: 'sharedString',
	inlineStr: 'inlineString',
	str: 'formulaString',
	n: 'number',
	b: 'boolean',
	e: 'error',
	d: 'number',
});
// an absent t= attribute means a number cell (ECMA-376 §18.3.1.4, ST_CellType default "n")
const DEFAULT_CELL_TYPE_ATTRIBUTE = 'n';

// _xHHHH_ escape (ECMA-376 §22.4.2.4): a character not representable in XML is written as _x + 4 hex + _
const ESCAPED_CHARACTER_PATTERN = /_x([0-9A-Fa-f]{4})_/g;
const decodeEscapedCharacters = (escapedText) =>
	escapedText.replace(ESCAPED_CHARACTER_PATTERN, (matchedText, hexText) => String.fromCharCode(parseInt(hexText, 16)));

const columnNumberOfReference = (cellReference) => {
	const lettersMatch = /^([A-Z]+)/.exec(cellReference || '');
	if (!lettersMatch) {
		return undefined;
	}
	return lettersMatch[1].split('').reduce((soFar, oneLetter) => soFar * 26 + (oneLetter.charCodeAt(0) - 64), 0);
};

// parseXmlText — run sax over one XML part, handing every event to the handler table; returns '' or an error
const parseXmlText = ({ xmlText, partName, handlerByEvent }) => {
	const parser = sax.parser(true, { trim: false, normalize: false });
	let parseError = '';
	parser.onerror = (saxError) => {
		parseError = `${moduleName}: ${partName} is not well-formed XML: ${saxError.message}`;
		parser.error = null;
	};
	Object.keys(handlerByEvent).forEach((eventName) => {
		parser[eventName] = handlerByEvent[eventName];
	});
	// XML 1.0 §2.11: a conformant processor normalizes every literal CR LF and lone CR to LF BEFORE parsing, so a
	// character reference (&#13;) still yields a CR while a raw line ending does not. sax does not do this itself;
	// skipping it stored CR LF where the workbook's text says LF (observed: 5,896 cells of CEDS V13 against openpyxl).
	parser.write(xmlText.replace(/\r\n?/g, '\n')).close();
	return parseError;
};

const textOfPart = ({ unzippedPartByName, partName }) => {
	const partBytes = unzippedPartByName[partName];
	return partBytes === undefined ? undefined : Buffer.from(partBytes).toString('utf8');
};

// readSharedStringList — xl/sharedStrings.xml: one string per <si>, the <t> texts of its runs joined; <rPh>
// (phonetic guide) text is NOT part of the string and is skipped
const readSharedStringList = ({ unzippedPartByName }) => {
	const xmlText = textOfPart({ unzippedPartByName, partName: 'xl/sharedStrings.xml' });
	if (xmlText === undefined) {
		return { sharedStringList: [] };
	}
	const sharedStringList = [];
	let currentPieceList = null;
	let insideTextElement = false;
	let phoneticDepth = 0;
	const parseError = parseXmlText({
		xmlText,
		partName: 'xl/sharedStrings.xml',
		handlerByEvent: {
			onopentag: (tag) => {
				if (tag.name === 'si') {
					currentPieceList = [];
				} else if (tag.name === 'rPh') {
					phoneticDepth++;
				} else if (tag.name === 't' && phoneticDepth === 0) {
					insideTextElement = true;
				}
			},
			onclosetag: (tagName) => {
				if (tagName === 'si') {
					sharedStringList.push(decodeEscapedCharacters(currentPieceList.join('')));
					currentPieceList = null;
				} else if (tagName === 'rPh') {
					phoneticDepth--;
				} else if (tagName === 't') {
					insideTextElement = false;
				}
			},
			ontext: (textPiece) => {
				if (insideTextElement && currentPieceList) {
					currentPieceList.push(textPiece);
				}
			},
			oncdata: (textPiece) => {
				if (insideTextElement && currentPieceList) {
					currentPieceList.push(textPiece);
				}
			},
		},
	});
	return parseError ? { error: parseError } : { sharedStringList };
};

// readSheetPartByName — xl/workbook.xml names the sheets in order; xl/_rels/workbook.xml.rels maps each r:id to a part
const readSheetPartByName = ({ unzippedPartByName }) => {
	const workbookXmlText = textOfPart({ unzippedPartByName, partName: 'xl/workbook.xml' });
	const relationshipXmlText = textOfPart({ unzippedPartByName, partName: 'xl/_rels/workbook.xml.rels' });
	if (workbookXmlText === undefined || relationshipXmlText === undefined) {
		return { error: `${moduleName}: the archive carries no xl/workbook.xml or no xl/_rels/workbook.xml.rels — not an xlsx workbook` };
	}
	const targetByRelationshipId = {};
	const relationshipError = parseXmlText({
		xmlText: relationshipXmlText,
		partName: 'xl/_rels/workbook.xml.rels',
		handlerByEvent: {
			onopentag: (tag) => {
				if (tag.name === 'Relationship') {
					targetByRelationshipId[tag.attributes.Id] = tag.attributes.Target;
				}
			},
		},
	});
	if (relationshipError) {
		return { error: relationshipError };
	}
	const sheetNameList = [];
	const sheetPartByName = {};
	let unresolvedSheetName = '';
	const workbookError = parseXmlText({
		xmlText: workbookXmlText,
		partName: 'xl/workbook.xml',
		handlerByEvent: {
			onopentag: (tag) => {
				if (tag.name !== 'sheet') {
					return;
				}
				const relationshipTarget = targetByRelationshipId[tag.attributes['r:id']];
				if (relationshipTarget === undefined) {
					unresolvedSheetName = tag.attributes.name;
					return;
				}
				sheetNameList.push(tag.attributes.name);
				sheetPartByName[tag.attributes.name] = relationshipTarget.startsWith('/') ? relationshipTarget.slice(1) : `xl/${relationshipTarget}`;
			},
		},
	});
	if (workbookError) {
		return { error: workbookError };
	}
	if (unresolvedSheetName) {
		return { error: `${moduleName}: sheet '${unresolvedSheetName}' names a relationship id the workbook rels do not declare` };
	}
	return { sheetNameList, sheetPartByName };
};

// readSheetRowList — one worksheet part; rows and cells in document order, every cell as the file states it
const readSheetRowList = ({ unzippedPartByName, sheetPartName, sharedStringList }) => {
	const xmlText = textOfPart({ unzippedPartByName, partName: sheetPartName });
	if (xmlText === undefined) {
		return { error: `${moduleName}: worksheet part ${sheetPartName} is named by the workbook but absent from the archive` };
	}
	const rowList = [];
	let currentRow = null;
	let currentCell = null;
	let textTarget = '';
	let pieceList = [];
	let cellFault = '';
	const parseError = parseXmlText({
		xmlText,
		partName: sheetPartName,
		handlerByEvent: {
			onopentag: (tag) => {
				if (tag.name === 'row') {
					currentRow = { rowNumber: Number(tag.attributes.r), cellList: [] };
				} else if (tag.name === 'c') {
					const typeAttribute = tag.attributes.t === undefined ? DEFAULT_CELL_TYPE_ATTRIBUTE : tag.attributes.t;
					const cellType = CELL_TYPE_BY_ATTRIBUTE[typeAttribute];
					if (cellType === undefined && !cellFault) {
						cellFault = `${moduleName}: cell ${tag.attributes.r} in ${sheetPartName} has type '${typeAttribute}', which ECMA-376 does not define`;
					}
					currentCell = { cellReference: tag.attributes.r, columnNumber: columnNumberOfReference(tag.attributes.r), cellType, rawValueText: undefined, formulaText: undefined, inlineText: undefined };
				} else if (currentCell && (tag.name === 'v' || tag.name === 'f')) {
					textTarget = tag.name;
					pieceList = [];
				} else if (currentCell && tag.name === 't') {
					textTarget = 'is';
					pieceList = currentCell.inlineText === undefined ? [] : [currentCell.inlineText];
				}
			},
			onclosetag: (tagName) => {
				if (currentCell && textTarget && (tagName === 'v' || tagName === 'f' || tagName === 't')) {
					const joinedText = pieceList.join('');
					if (textTarget === 'v') {
						currentCell.rawValueText = joinedText;
					} else if (textTarget === 'f') {
						currentCell.formulaText = `=${joinedText}`;
					} else {
						currentCell.inlineText = joinedText;
					}
					textTarget = '';
				} else if (tagName === 'c' && currentCell) {
					const resolved = resolveCellText({ cell: currentCell, sharedStringList, sheetPartName });
					if (resolved.error && !cellFault) {
						cellFault = resolved.error;
					}
					const hasContent = resolved.text !== undefined || currentCell.formulaText !== undefined;
					if (hasContent) {
						currentRow.cellList.push({
							cellReference: currentCell.cellReference,
							columnNumber: currentCell.columnNumber,
							cellType: currentCell.cellType,
							text: resolved.text,
							formulaText: currentCell.formulaText,
						});
					}
					currentCell = null;
				} else if (tagName === 'row' && currentRow) {
					rowList.push(currentRow);
					currentRow = null;
				}
			},
			ontext: (textPiece) => {
				if (textTarget) {
					pieceList.push(textPiece);
				}
			},
			oncdata: (textPiece) => {
				if (textTarget) {
					pieceList.push(textPiece);
				}
			},
		},
	});
	if (parseError) {
		return { error: parseError };
	}
	if (cellFault) {
		return { error: cellFault };
	}
	return { rowList };
};

// resolveCellText — a cell's stored value as text, by its type; a shared-string index that resolves to nothing is a
// damaged workbook, refused by name
const resolveCellText = ({ cell, sharedStringList, sheetPartName }) => {
	if (cell.cellType === 'sharedString') {
		if (cell.rawValueText === undefined) {
			return { text: undefined };
		}
		const sharedString = sharedStringList[Number(cell.rawValueText)];
		if (sharedString === undefined) {
			return { error: `${moduleName}: cell ${cell.cellReference} in ${sheetPartName} names shared string ${cell.rawValueText}, which the workbook does not hold` };
		}
		return { text: sharedString };
	}
	if (cell.cellType === 'inlineString') {
		return { text: cell.inlineText === undefined ? undefined : decodeEscapedCharacters(cell.inlineText) };
	}
	if (cell.cellType === 'formulaString') {
		return { text: cell.rawValueText === undefined ? undefined : decodeEscapedCharacters(cell.rawValueText) };
	}
	return { text: cell.rawValueText };
};

const readWorkbookBytes = ({ workbookBytes } = {}) => {
	if (!Buffer.isBuffer(workbookBytes) && !(workbookBytes instanceof Uint8Array)) {
		return { error: `${moduleName}: workbookBytes must be a Buffer or Uint8Array (got ${typeof workbookBytes})` };
	}
	let unzippedPartByName;
	try {
		unzippedPartByName = fflate.unzipSync(new Uint8Array(workbookBytes));
	} catch (unzipError) {
		return { error: `${moduleName}: the bytes are not a readable zip archive: ${unzipError.message}` };
	}
	const sharedStrings = readSharedStringList({ unzippedPartByName });
	if (sharedStrings.error) {
		return { error: sharedStrings.error };
	}
	const sheetParts = readSheetPartByName({ unzippedPartByName });
	if (sheetParts.error) {
		return { error: sheetParts.error };
	}
	const sheetByName = {};
	for (const sheetName of sheetParts.sheetNameList) {
		const sheet = readSheetRowList({ unzippedPartByName, sheetPartName: sheetParts.sheetPartByName[sheetName], sharedStringList: sharedStrings.sharedStringList });
		if (sheet.error) {
			return { error: `${sheet.error} (sheet '${sheetName}')` };
		}
		sheetByName[sheetName] = { rowList: sheet.rowList };
	}
	return { workbook: { sheetNameList: sheetParts.sheetNameList, sheetByName } };
};

const readWorkbookFile = ({ filePath } = {}, callback) => {
	if (typeof filePath !== 'string' || filePath === '') {
		callback(`${moduleName}: filePath is ${JSON.stringify(filePath)}; name the .xlsx to read`);
		return;
	}
	fs.readFile(filePath, (readError, workbookBytes) => {
		if (readError) {
			callback(`${moduleName}: cannot read ${filePath}: ${readError.message}`);
			return;
		}
		const read = readWorkbookBytes({ workbookBytes });
		callback(read.error || '', read.workbook);
	});
};

// cellTextByColumnNumber — one row's cells as { <columnNumber>: cell }, for keyed reads by a header row
const cellByColumnNumberOf = (oneRow) =>
	oneRow.cellList.reduce((soFar, oneCell) => ({ ...soFar, [oneCell.columnNumber]: oneCell }), {});

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => ({ readWorkbookFile, readWorkbookBytes, cellByColumnNumberOf, decodeEscapedCharacters });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
