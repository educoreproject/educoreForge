'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// pescldCsvReader.js — the strict RFC 4180 reader the PESC_LD forge reads its CSV snapshot with (zeroBacklog lane C1). The tree
// carries no CSV library and this source needs only the RFC's own grammar, so the reader is local, small and refuses rather than
// guesses. PURE: text in, records out; no I/O.
//
// What the PESC_LD CSVs are (measured over snapshot 01, 2026-10-22): records end in CRLF, a newline INSIDE a quoted cell is a bare
// LF (a picklist cell holds one value per line), the last record has no terminator, there is no byte-order mark and no escaped
// quote. The reader accepts the RFC in full (CRLF or LF terminators, "" escapes) and refuses by name:
//   - a quote that opens a cell anywhere but at its start, or text after a closing quote other than a separator or terminator;
//   - a quoted cell still open at the end of the text;
//   - a bare CR outside a quoted cell (neither a terminator nor data);
//   - a record whose cell count differs from the header's (a ragged row is a misread, never padded).
// A cell's text is returned VERBATIM: no trimming, no newline translation. Whitespace and repeats are the walk's declared rules.

const QUOTE = '"';
const SEPARATOR = ',';
const CARRIAGE_RETURN = '\r';
const LINE_FEED = '\n';

// parseCsvText({ csvText, sourceFileName }) → { refusalText } | { headerList, recordList: [{ cellList, lineNumber }] }
const parseCsvText = ({ csvText, sourceFileName }) => {
	if (typeof csvText !== 'string') {
		return { refusalText: `${moduleName} REFUSED: '${sourceFileName}' text is a ${typeof csvText}, not a string` };
	}
	if (csvText === '') {
		return { refusalText: `${moduleName} REFUSED: '${sourceFileName}' holds no header record (the text is empty)` };
	}
	const rawRecordList = [];
	let cellList = [];
	let cellText = '';
	let isInsideQuote = false;
	let isAfterClosingQuote = false;
	let lineNumber = 1;
	let recordStartLineNumber = 1;
	let charIndex = 0;

	const endCell = () => {
		cellList.push(cellText);
		cellText = '';
		isAfterClosingQuote = false;
	};
	const endRecord = () => {
		endCell();
		rawRecordList.push({ cellList, lineNumber: recordStartLineNumber });
		cellList = [];
	};

	while (charIndex < csvText.length) {
		const oneChar = csvText[charIndex];
		if (isInsideQuote) {
			if (oneChar === QUOTE && csvText[charIndex + 1] === QUOTE) {
				cellText += QUOTE;
				charIndex += 2;
				continue;
			}
			if (oneChar === QUOTE) {
				isInsideQuote = false;
				isAfterClosingQuote = true;
				charIndex += 1;
				continue;
			}
			if (oneChar === LINE_FEED) {
				lineNumber += 1;
			}
			cellText += oneChar;
			charIndex += 1;
			continue;
		}
		if (oneChar === SEPARATOR) {
			endCell();
			charIndex += 1;
			continue;
		}
		if (oneChar === CARRIAGE_RETURN && csvText[charIndex + 1] === LINE_FEED) {
			endRecord();
			lineNumber += 1;
			recordStartLineNumber = lineNumber;
			charIndex += 2;
			continue;
		}
		if (oneChar === LINE_FEED) {
			endRecord();
			lineNumber += 1;
			recordStartLineNumber = lineNumber;
			charIndex += 1;
			continue;
		}
		if (oneChar === CARRIAGE_RETURN) {
			return { refusalText: `${moduleName} REFUSED: '${sourceFileName}' line ${lineNumber} holds a bare carriage return outside a quoted cell (neither a record terminator nor cell text)` };
		}
		if (isAfterClosingQuote) {
			return { refusalText: `${moduleName} REFUSED: '${sourceFileName}' line ${lineNumber} has text after a closing quote (${JSON.stringify(csvText.slice(charIndex, charIndex + 20))}); a quoted cell ends at a separator or a record terminator` };
		}
		if (oneChar === QUOTE) {
			if (cellText.length !== 0) {
				return { refusalText: `${moduleName} REFUSED: '${sourceFileName}' line ${lineNumber} opens a quote inside a cell (after ${JSON.stringify(cellText)}); a quote may open a cell only at its start` };
			}
			isInsideQuote = true;
			charIndex += 1;
			continue;
		}
		cellText += oneChar;
		charIndex += 1;
	}
	if (isInsideQuote) {
		return { refusalText: `${moduleName} REFUSED: '${sourceFileName}' ends inside a quoted cell opened on or after line ${recordStartLineNumber}` };
	}
	// the last record: a text ending in a terminator leaves nothing pending (no phantom empty record)
	const isTextTerminated = csvText.endsWith(LINE_FEED);
	if (!isTextTerminated) {
		endRecord();
	}
	const headerList = rawRecordList[0].cellList;
	const raggedRecord = rawRecordList.find((oneRecord) => oneRecord.cellList.length !== headerList.length);
	if (raggedRecord !== undefined) {
		return { refusalText: `${moduleName} REFUSED: '${sourceFileName}' record at line ${raggedRecord.lineNumber} has ${raggedRecord.cellList.length} cells where the header has ${headerList.length}` };
	}
	return { headerList, recordList: rawRecordList.slice(1) };
};

module.exports = { parseCsvText, moduleName };
