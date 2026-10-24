'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sedmSourceLoader.js — the H2 loader for the SEDM forge bundle (nextStandards-102326 wave 2, lane G): the ONE place snapshot 01
// enters the forge, so the one place it refuses. The framework has already verified every file SHA256SUMS lists; this loader reads
// exactly the two files the source profile names, and refuses by name:
//   - a sourcePath that is not the snapshot directory, or a profile-named file SHA256SUMS does not list (an unverified byte);
//   - a CSV the strict reader refuses (the PESC_LD bundle's RFC 4180 reader, required read-only: BRONZE_CROWN ruling 4, 2026-10-24);
//   - a header that departs from the profile's column table: a different column count, or a position whose header text is not the
//     profile's (the header REPEATS names, Description and Example twice, so columns are addressed by position, never by name);
//   - a structures file that is not one JSON object.
// It returns the records' cells VERBATIM, by position, each record with its line. It trims, merges and filters nothing: those are
// the walk's declared rules.

const fs = require('fs');
const path = require('path');
const { parseCsvText } = require(path.join(__dirname, '..', '..', 'pescld', 'lib', 'pescldCsvReader'));
const sourceProfile = require('./sedmSourceProfile.json');

const CHECKSUM_FILE_NAME = 'SHA256SUMS';
const CHECKSUM_LINE_RE = /^[0-9a-f]{64}[ \t]+\*?(.+?)\s*$/;

// listedFileNameListOf — the relative paths SHA256SUMS names
const listedFileNameListOf = (snapshotDirPath) => fs.readFileSync(path.join(snapshotDirPath, CHECKSUM_FILE_NAME), 'utf8')
	.split('\n')
	.map((oneLine) => oneLine.match(CHECKSUM_LINE_RE))
	.filter((lineMatch) => lineMatch !== null)
	.map((lineMatch) => lineMatch[1]);

// headerProblemOf — '' when every position holds the profile's header text, else the first departure
const headerProblemOf = ({ headerList }) => {
	if (headerList.length !== sourceProfile.columnList.length) {
		return `the header has ${headerList.length} columns where the profile names ${sourceProfile.columnList.length}`;
	}
	const departingColumn = sourceProfile.columnList.find((oneColumn) => headerList[oneColumn.position] !== oneColumn.columnName);
	return departingColumn === undefined ? '' : `position ${departingColumn.position} is headed ${JSON.stringify(headerList[departingColumn.position])}, not the profile's ${JSON.stringify(departingColumn.columnName)}`;
};

// parsedStructuresOf — { structures } | { refusalText }. JSON.parse throws on malformed text; the throw is translated ONCE, here,
// into a refusal by name (the single-site boundary dispensation the bundles take for JSON.parse), never control flow
const parsedStructuresOf = ({ structuresText }) => {
	let parseFault = '';
	let structures;
	try {
		structures = JSON.parse(structuresText);
	} catch (parseError) {
		parseFault = parseError.message;
	}
	if (parseFault !== '') {
		return { refusalText: `${moduleName} REFUSED: '${sourceProfile.structuresFileName}' is not JSON (${parseFault})` };
	}
	if (structures === null || typeof structures !== 'object' || Array.isArray(structures)) {
		return { refusalText: `${moduleName} REFUSED: '${sourceProfile.structuresFileName}' is not one JSON object` };
	}
	return { structures };
};

// loadSnapshot — the H2 load: { sourcePath, additionalSourceInputPathByName, xLog }, callback(errString, loaded)
const loadSnapshot = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
	if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
		callback(`${moduleName} REFUSED: sourcePath '${sourcePath}' is not the snapshot directory (parserDescriptor.ini names no sourceFile: the forge reads a directory)`);
		return;
	}
	const snapshotDirPath = sourcePath;
	const profileFileNameList = [sourceProfile.csvFileName, sourceProfile.structuresFileName];
	const listedFileNameList = listedFileNameListOf(snapshotDirPath);
	const unlistedFileName = profileFileNameList.find((fileName) => listedFileNameList.indexOf(fileName) === -1);
	if (unlistedFileName !== undefined) {
		callback(`${moduleName} REFUSED: '${unlistedFileName}' is named by the source profile but not listed in ${CHECKSUM_FILE_NAME}, so it was never verified; reacquire per README_PROVENANCE.md`);
		return;
	}

	const csvRead = parseCsvText({ csvText: fs.readFileSync(path.join(snapshotDirPath, sourceProfile.csvFileName), 'utf8'), sourceFileName: sourceProfile.csvFileName });
	if (csvRead.refusalText !== undefined) {
		callback(csvRead.refusalText);
		return;
	}
	const headerProblem = headerProblemOf({ headerList: csvRead.headerList });
	if (headerProblem !== '') {
		callback(`${moduleName} REFUSED: '${sourceProfile.csvFileName}' header: ${headerProblem}`);
		return;
	}
	const structuresRead = parsedStructuresOf({ structuresText: fs.readFileSync(path.join(snapshotDirPath, sourceProfile.structuresFileName), 'utf8') });
	if (structuresRead.refusalText !== undefined) {
		callback(structuresRead.refusalText);
		return;
	}

	const recordList = csvRead.recordList.map((oneRecord) => ({ cellList: oneRecord.cellList, sourceFileName: sourceProfile.csvFileName, lineNumber: oneRecord.lineNumber }));
	xLog.status(`[${moduleName}] ${recordList.length} CSV records x ${csvRead.headerList.length} columns; structures sections ${Object.keys(structuresRead.structures).length}`);
	callback('', { recordList, structures: structuresRead.structures, sourceFileNameList: profileFileNameList });
};

module.exports = { loadSnapshot, moduleName };
