'use strict';

// sif260928SourceGrammar.js — the LAYOUT of ImplementationSpecification_031326.tsv, as data. The
// loader classifies each line into one kind and walks this table; it holds no layout rule of its own.
//
// Measured by C1 (SPEC §9 A21) and again by A1b: lines end CRLF, there is NO trailing newline
// (16,101 lines by split), and the file is 159 repetitions of
//     <table title>        e.g. "AccountingPeriods: Table 1"
//     <column header>      the eight column names below, tab-separated
//     <data row>+          exactly eight tab-separated cells
// separated by runs of blank lines (163 blank lines in all). A table title is the spreadsheet's
// sheet name, which Excel truncates, so it is NOT the xpath's object name (653 rows disagree) and
// the loader carries it only as provenance.

const LINE_TERMINATOR = '\r\n';

const COLUMN_NAME_LIST = Object.freeze(['Name', 'Mandatory', 'Characteristics', 'Type', 'Description', 'XPath', 'CEDS ID', 'Format']);

const LINE_KIND = Object.freeze({
	BLANK: 'blank',
	TABLE_TITLE: 'tableTitle',
	COLUMN_HEADER: 'columnHeader',
	DATA_ROW: 'dataRow',
});

// a title is "<sheet name>: Table 1" with no tab in it
const TABLE_TITLE_RE = /^([^\t]+): Table 1$/;

// which line kinds may follow which; START and END are the file's edges. END follows a data row
// only, which is how "no trailing newline" is held (a trailing CRLF would end on a blank line).
const START_OF_FILE = 'startOfFile';
const END_OF_FILE = 'endOfFile';
const FOLLOWING_KIND_LIST_BY_KIND = Object.freeze({
	[START_OF_FILE]: Object.freeze([LINE_KIND.TABLE_TITLE]),
	[LINE_KIND.TABLE_TITLE]: Object.freeze([LINE_KIND.COLUMN_HEADER]),
	[LINE_KIND.COLUMN_HEADER]: Object.freeze([LINE_KIND.DATA_ROW]),
	[LINE_KIND.DATA_ROW]: Object.freeze([LINE_KIND.DATA_ROW, LINE_KIND.BLANK, END_OF_FILE]),
	[LINE_KIND.BLANK]: Object.freeze([LINE_KIND.BLANK, LINE_KIND.TABLE_TITLE]),
});

module.exports = Object.freeze({
	LINE_TERMINATOR,
	COLUMN_NAME_LIST,
	COLUMN_HEADER_TEXT: COLUMN_NAME_LIST.join('\t'),
	LINE_KIND,
	TABLE_TITLE_RE,
	START_OF_FILE,
	END_OF_FILE,
	FOLLOWING_KIND_LIST_BY_KIND,
});
