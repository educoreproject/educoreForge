'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// pescldSourceLoader.js — the H2 loader for the PESC_LD forge bundle (zeroBacklog lane C1): the ONE place the CSV snapshot enters
// the forge, so the one place it refuses. The framework has already verified every file SHA256SUMS lists (a directory source);
// this loader reads exactly the files the source profile names, and refuses by name:
//   - a sourcePath that is not the snapshot directory, or a profile-named file SHA256SUMS does not list (an unverified byte);
//   - a CSV the strict reader refuses (pescldCsvReader.js);
//   - a header that departs from the profile's column table: a missing column, an unknown column, a column named twice;
//   - a namespace prefix declared twice, or about.csv not two cells per record, or a metadata name stated twice.
// It returns records whose cells are VERBATIM (keyed by column name, each with its file and line). It does not trim, merge,
// de-duplicate or resolve anything: those are the walk's declared rules. It reads neither the TTL (the round trip's second
// oracle) nor the combined JSON (lossy; not a source, WORKORDER-C).

const fs = require('fs');
const path = require('path');
const { parseCsvText } = require('./pescldCsvReader');
const sourceProfile = require('./pescldSourceProfile.json');

const CHECKSUM_FILE_NAME = 'SHA256SUMS';
const CHECKSUM_LINE_RE = /^[0-9a-f]{64}[ \t]+\*?(.+?)\s*$/;

// listedFileNameListOf — the relative paths SHA256SUMS names
const listedFileNameListOf = (snapshotDirPath) => fs.readFileSync(path.join(snapshotDirPath, CHECKSUM_FILE_NAME), 'utf8')
	.split('\n')
	.map((oneLine) => oneLine.match(CHECKSUM_LINE_RE))
	.filter((lineMatch) => lineMatch !== null)
	.map((lineMatch) => lineMatch[1]);

// headerProblemOf — '' when headerList holds every required column and nothing unknown, else the problem
const headerProblemOf = ({ headerList, columnList }) => {
	const knownColumnNameList = columnList.map((oneColumn) => oneColumn.columnName);
	const repeatedColumnName = headerList.find((columnName, columnIndex) => headerList.indexOf(columnName) !== columnIndex);
	if (repeatedColumnName !== undefined) {
		return `column '${repeatedColumnName}' is named twice`;
	}
	const unknownColumnName = headerList.find((columnName) => knownColumnNameList.indexOf(columnName) === -1);
	if (unknownColumnName !== undefined) {
		return `column '${unknownColumnName}' is not in the source profile (known: ${knownColumnNameList.join(', ')})`;
	}
	const missingColumn = columnList.find((oneColumn) => !oneColumn.isOptionalColumn && headerList.indexOf(oneColumn.columnName) === -1);
	if (missingColumn !== undefined) {
		return `required column '${missingColumn.columnName}' is absent`;
	}
	return '';
};

// readCsvFile — { refusalText } | { headerList, recordList } for one profile-named file
const readCsvFile = ({ snapshotDirPath, sourceFileName }) => parseCsvText({ csvText: fs.readFileSync(path.join(snapshotDirPath, sourceFileName), 'utf8'), sourceFileName });

// tableRecordListOf — records as { cellByColumnName, sourceFileName, lineNumber }
const tableRecordListOf = ({ headerList, recordList, sourceFileName }) => recordList.map((oneRecord) => ({
	cellByColumnName: headerList.reduce((cellByColumnName, columnName, columnIndex) => ({ ...cellByColumnName, [columnName]: oneRecord.cellList[columnIndex] }), {}),
	sourceFileName,
	lineNumber: oneRecord.lineNumber,
}));

// loadSnapshot — the H2 load: { sourcePath, additionalSourceInputPathByName, xLog }, callback(errString, loaded)
const loadSnapshot = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
	if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
		callback(`${moduleName} REFUSED: sourcePath '${sourcePath}' is not the snapshot directory (parserDescriptor.ini names no sourceFile: the forge reads a directory)`);
		return;
	}
	const snapshotDirPath = sourcePath;
	const profileFileNameList = [sourceProfile.shapeFileName, sourceProfile.namespaceFileName, sourceProfile.packageMetadataFileName].concat(sourceProfile.tapFileNameList);
	const listedFileNameList = listedFileNameListOf(snapshotDirPath);
	const unlistedFileName = profileFileNameList.find((fileName) => listedFileNameList.indexOf(fileName) === -1);
	if (unlistedFileName !== undefined) {
		callback(`${moduleName} REFUSED: '${unlistedFileName}' is named by the source profile but not listed in ${CHECKSUM_FILE_NAME}, so it was never verified; reacquire per README_PROVENANCE.md`);
		return;
	}

	const readByFileName = profileFileNameList.reduce((readByName, fileName) => ({ ...readByName, [fileName]: readCsvFile({ snapshotDirPath, sourceFileName: fileName }) }), {});
	const refusedFileName = profileFileNameList.find((fileName) => readByFileName[fileName].refusalText !== undefined);
	if (refusedFileName !== undefined) {
		callback(readByFileName[refusedFileName].refusalText);
		return;
	}

	// shapes.csv and the seven TAP files: headers against the profile's column tables
	const tableFileList = [{ fileName: sourceProfile.shapeFileName, columnList: sourceProfile.shapeColumnList }]
		.concat(sourceProfile.tapFileNameList.map((fileName) => ({ fileName, columnList: sourceProfile.tapColumnList })));
	const headerFault = tableFileList
		.map(({ fileName, columnList }) => ({ fileName, headerProblem: headerProblemOf({ headerList: readByFileName[fileName].headerList, columnList }) }))
		.find((oneCheck) => oneCheck.headerProblem !== '');
	if (headerFault !== undefined) {
		callback(`${moduleName} REFUSED: '${headerFault.fileName}' header: ${headerFault.headerProblem}`);
		return;
	}
	const shapeRecordList = tableRecordListOf({ ...readByFileName[sourceProfile.shapeFileName], sourceFileName: sourceProfile.shapeFileName });
	const tapRecordList = sourceProfile.tapFileNameList.reduce(
		(recordList, fileName) => recordList.concat(tableRecordListOf({ ...readByFileName[fileName], sourceFileName: fileName })),
		[],
	);

	// namespaces.csv: prefix → IRI, each prefix once
	const namespaceRead = readByFileName[sourceProfile.namespaceFileName];
	if (JSON.stringify(namespaceRead.headerList) !== JSON.stringify(sourceProfile.namespaceColumnNameList)) {
		callback(`${moduleName} REFUSED: '${sourceProfile.namespaceFileName}' header is ${JSON.stringify(namespaceRead.headerList)}, not ${JSON.stringify(sourceProfile.namespaceColumnNameList)}`);
		return;
	}
	const namespacePrefixList = namespaceRead.recordList.map((oneRecord) => oneRecord.cellList[0]);
	const repeatedPrefix = namespacePrefixList.find((onePrefix, prefixIndex) => namespacePrefixList.indexOf(onePrefix) !== prefixIndex);
	if (repeatedPrefix !== undefined) {
		callback(`${moduleName} REFUSED: '${sourceProfile.namespaceFileName}' declares prefix '${repeatedPrefix}' twice`);
		return;
	}
	const namespaceIriByPrefix = namespaceRead.recordList.reduce((iriByPrefix, oneRecord) => ({ ...iriByPrefix, [oneRecord.cellList[0]]: oneRecord.cellList[1] }), {});

	// about.csv: name,value records with NO header line, so its first record is data too
	const metadataRead = readByFileName[sourceProfile.packageMetadataFileName];
	const metadataCellListList = [metadataRead.headerList].concat(metadataRead.recordList.map((oneRecord) => oneRecord.cellList));
	if (metadataCellListList.some((cellList) => cellList.length !== sourceProfile.packageMetadataColumnCount)) {
		callback(`${moduleName} REFUSED: '${sourceProfile.packageMetadataFileName}' is not ${sourceProfile.packageMetadataColumnCount} cells (name, value) per record`);
		return;
	}
	const metadataNameList = metadataCellListList.map((cellList) => cellList[0]);
	const repeatedMetadataName = metadataNameList.find((oneName, nameIndex) => metadataNameList.indexOf(oneName) !== nameIndex);
	if (repeatedMetadataName !== undefined) {
		callback(`${moduleName} REFUSED: '${sourceProfile.packageMetadataFileName}' states '${repeatedMetadataName}' twice`);
		return;
	}
	const packageMetadataByName = metadataCellListList.reduce((byName, cellList) => ({ ...byName, [cellList[0]]: cellList[1] }), {});

	xLog.status(`[${moduleName}] ${shapeRecordList.length} shape records, ${tapRecordList.length} TAP records over ${sourceProfile.tapFileNameList.length} files, ${namespacePrefixList.length} namespace prefixes`);
	callback('', { shapeRecordList, tapRecordList, namespaceIriByPrefix, packageMetadataByName, sourceFileNameList: profileFileNameList });
};

module.exports = { loadSnapshot, moduleName };
