#!/usr/bin/env node
'use strict';

// test-xlsxReader.js — the xlsx reader against an INDEPENDENT oracle (lane DES, 2026-10-12): every non-empty cell of CEDS's
// own V13 element workbook (fixtures/cedsV13Workbook, a reader fixture since lane UNDES removed the layer that forged it:
// it is the one workbook in the tree with formula cells, which the V14 workbook gate D reads has none of) as openpyxl
// 3.1.5 reads it (fixtures/cedsV13.openpyxl.jsonl.gz, written by fixtures/openpyxlDump.py), compared cell by cell. ONE declared
// mapping between the two: openpyxl leaves an OOXML `_x000D_` escape undecoded and this reader decodes it (ECMA-376 §22.4.2.4).
// Twins (each OBSERVED red): drop the XML 1.0 §2.11 line-ending normalization; keep a formula cell's cached value instead of
// its formula; coerce a numeric-looking text cell to a number.
//
// Run: node lib/xlsx-reader/test/test-xlsxReader.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- the xlsx reader, cell by cell, against openpyxl's reading of the same workbook
SYNOPSIS
     ${moduleName} [-verbose] [-help]
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const harness = require('../../../test/testLib/harness')(moduleName);
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));

const READER_PATH = path.join(__dirname, '..', 'xlsx-reader.js');
const WORKBOOK_PATH = path.join(__dirname, 'fixtures', 'cedsV13Workbook', 'CEDS-V13.0.0.0.xlsx');
const ORACLE_PATH = path.join(__dirname, 'fixtures', 'cedsV13.openpyxl.jsonl.gz');

const oracleCellList = zlib.gunzipSync(fs.readFileSync(ORACLE_PATH)).toString('utf8').split('\n').filter(Boolean).map((oneLine) => JSON.parse(oneLine));

// compareWithOracle — { matchedCount, differenceList, extraCount } for one reader module
const compareWithOracle = (readerModule) => {
	const read = readerModule.readWorkbookBytes({ workbookBytes: fs.readFileSync(WORKBOOK_PATH) });
	if (read.error) {
		return { error: read.error };
	}
	const cellByAddress = new Map();
	read.workbook.sheetNameList.forEach((sheetName) => read.workbook.sheetByName[sheetName].rowList.forEach((oneRow) => oneRow.cellList.forEach((oneCell) => cellByAddress.set(`${sheetName}!${oneCell.cellReference}`, oneCell))));
	const differenceList = [];
	let matchedCount = 0;
	const seenAddressSet = new Set();
	oracleCellList.forEach((oneOracleCell) => {
		const address = `${oneOracleCell.sheet}!${oneOracleCell.ref}`;
		seenAddressSet.add(address);
		const cell = cellByAddress.get(address);
		const expectedText = oneOracleCell.pyType === 'str' ? oneOracleCell.value.replace(/_x000D_/g, '\r') : String(oneOracleCell.value);
		const actualText = cell === undefined ? undefined : cell.formulaText !== undefined ? cell.formulaText : cell.text;
		if (actualText === expectedText && (oneOracleCell.pyType !== 'int' || cell.cellType === 'number') && (oneOracleCell.pyType !== 'str' || cell.cellType !== 'number')) {
			matchedCount++;
		} else {
			differenceList.push(`${address}: openpyxl ${oneOracleCell.pyType} ${JSON.stringify(expectedText).slice(0, 80)} / reader ${cell ? cell.cellType : 'absent'} ${JSON.stringify(actualText).slice(0, 80)}`);
		}
	});
	const extraCount = Array.from(cellByAddress.keys()).filter((address) => !seenAddressSet.has(address) && (cellByAddress.get(address).text || '') !== '').length;
	return { matchedCount, differenceList, extraCount };
};

harness.section('the reader agrees with openpyxl on every cell of CEDS V13');
const real = compareWithOracle(require(READER_PATH)());
harness.equal('the reader reads the workbook', real.error, undefined);
harness.equal(`every one of the ${oracleCellList.length} oracle cells matches`, real.matchedCount, oracleCellList.length);
harness.equal('no cell differs', real.differenceList.slice(0, 3).join(' | '), '');
harness.equal('no non-empty cell the oracle lacks', real.extraCount, 0);

harness.section('refusals by name');
const reader = require(READER_PATH)();
harness.match('bytes that are not a zip are refused', reader.readWorkbookBytes({ workbookBytes: Buffer.from('not a zip') }).error, /not a readable zip archive/);
harness.match('a non-buffer is refused', reader.readWorkbookBytes({ workbookBytes: 'text' }).error, /must be a Buffer/);

harness.section('twins — each fault the gate exists for, OBSERVED red');
const twinList = [
	{ twinName: 'lineEndingNormalizationDropped', find: "parser.write(xmlText.replace(/\\r\\n?/g, '\\n')).close();", replace: 'parser.write(xmlText).close();' },
	{ twinName: 'formulaKeptAsCachedValue', find: "currentCell.formulaText = `=${joinedText}`;", replace: 'currentCell.formulaText = undefined;' },
	// shared strings that look numeric (Global ID '000328') lose their leading zeros
	{ twinName: 'numericTextCoerced', find: '		return { text: sharedString };', replace: "		return { text: /^\\d+$/.test(sharedString) ? String(Number(sharedString)) : sharedString };" },
];
twinList.forEach((oneTwin) => {
	const mutated = moduleDouble.loadWithMutations({ modulePath: READER_PATH, mutationList: [{ modulePath: READER_PATH, find: oneTwin.find, replace: oneTwin.replace }] });
	const twinResult = compareWithOracle(mutated());
	const wentRed = Boolean(twinResult.error) || twinResult.differenceList.length > 0;
	harness.ok(`twin '${oneTwin.twinName}' is RED (${twinResult.error ? 'refused' : `${twinResult.differenceList.length} differing cells`})`, wentRed);
});

harness.report();
