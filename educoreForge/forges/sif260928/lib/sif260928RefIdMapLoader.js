'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sif260928RefIdMapLoader.js — reads refIdResolutionMap.tsv, the snapshot's second input (PLAN §3 A4;
// SPEC §9 A24 and A28). This is a data boundary like the TSV loader: every guard on the map's shape
// lives here, and the walk does not re-check it.
//
//   loadRefIdResolutionMap({ additionalSourceInputPathByName }, callback)
//     → callback('', { sourceFileName, resolvedTableTitleByRefIdName, mapRowCount })
//
// The map is a curated file, LF-terminated with a closing newline, whose first line is the column
// header. Only refIdProperty and resolvedTable are read. resolvedTable is a TABLE TITLE (a sheet name,
// cut at 31 characters), which the walk resolves to an Object; the walk also owns the sentinel that
// names no table. A row repeated identically is one entry; the same name with two different tables is
// refused by name.

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));

// the forge declaration's additionalSourceInputList names the input by this
const REF_ID_MAP_INPUT_NAME = 'refIdResolutionMap';
const LINE_TERMINATOR = '\n';
const CELL_SEPARATOR = '\t';
const COLUMN_NAME_LIST = Object.freeze(['refIdProperty', 'inferredTarget', 'resolvedTable', 'resolutionMethod', 'notes']);
const REF_ID_NAME_COLUMN_INDEX = COLUMN_NAME_LIST.indexOf('refIdProperty');
const RESOLVED_TABLE_COLUMN_INDEX = COLUMN_NAME_LIST.indexOf('resolvedTable');

const refusal = (what, where) => ({ refusalError: refuse.byName({ moduleName, what, where }) });

// ---- the parse, pure: returns { refusalError } or { loadedRefIdMap } ---------------------------

const parseRefIdResolutionMap = ({ mapText, sourceFileName }) => {
	if (mapText.includes('\r')) {
		return refusal(`${sourceFileName} holds a CR`, 'the map is LF-terminated');
	}
	if (!mapText.endsWith(LINE_TERMINATOR)) {
		return refusal(`${sourceFileName} does not end with a newline`, 'the map ends with a closing LF');
	}
	const [headerLineText, ...rowLineTextList] = mapText.slice(0, -LINE_TERMINATOR.length).split(LINE_TERMINATOR);
	if (headerLineText !== COLUMN_NAME_LIST.join(CELL_SEPARATOR)) {
		return refusal(`${sourceFileName} header is ${JSON.stringify(headerLineText)}`, `the header is ${COLUMN_NAME_LIST.join(', ')}, tab-separated`);
	}

	const resolvedTableTitleByRefIdName = {};
	for (let rowIndex = 0; rowIndex < rowLineTextList.length; rowIndex++) {
		const cellList = rowLineTextList[rowIndex].split(CELL_SEPARATOR);
		const mapLineNumber = rowIndex + 2;
		if (cellList.length !== COLUMN_NAME_LIST.length) {
			return refusal(`${sourceFileName} line ${mapLineNumber} has ${cellList.length} cells`, `every row has ${COLUMN_NAME_LIST.length} tab-separated cells`);
		}
		const refIdName = cellList[REF_ID_NAME_COLUMN_INDEX];
		const resolvedTableTitle = cellList[RESOLVED_TABLE_COLUMN_INDEX];
		if (refIdName === '' || resolvedTableTitle === '') {
			return refusal(`${sourceFileName} line ${mapLineNumber} has an empty refIdProperty or resolvedTable`, 'every row names a RefId and a table');
		}
		const earlierTableTitle = resolvedTableTitleByRefIdName[refIdName];
		if (earlierTableTitle !== undefined && earlierTableTitle !== resolvedTableTitle) {
			return refusal(`${sourceFileName} maps '${refIdName}' to '${earlierTableTitle}' and, on line ${mapLineNumber}, to '${resolvedTableTitle}'`, 'a RefId name resolves to one table');
		}
		resolvedTableTitleByRefIdName[refIdName] = resolvedTableTitle;
	}

	return { loadedRefIdMap: { sourceFileName, resolvedTableTitleByRefIdName, mapRowCount: rowLineTextList.length } };
};

const loadRefIdResolutionMap = ({ additionalSourceInputPathByName }, callback) => {
	const mapPath = additionalSourceInputPathByName[REF_ID_MAP_INPUT_NAME];
	fs.readFile(mapPath, 'utf8', (readError, mapText) => {
		if (readError) {
			callback(`${moduleName} could not read ${mapPath}: ${readError.message}`);
			return;
		}
		const parsed = parseRefIdResolutionMap({ mapText, sourceFileName: path.basename(mapPath) });
		if (parsed.refusalError) {
			callback(parsed.refusalError.message);
			return;
		}
		callback('', parsed.loadedRefIdMap);
	});
};

module.exports = { loadRefIdResolutionMap, parseRefIdResolutionMap, REF_ID_MAP_INPUT_NAME, moduleName };
