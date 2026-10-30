'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// usecaseSnapshotLoader.js — the H2 loader for the use-case forge bundle (useCaseForge-102926 Phase 1): the ONE place the snapshot
// enters the forge, so the one place it refuses. The framework has already verified every file SHA256SUMS lists; this loader reads
// exactly the case documents, format schemas and registry the source profile places, and refuses by name:
//   - a sourcePath that is not the snapshot directory, or a file it reads that SHA256SUMS does not list (an unverified byte);
//   - a file that is not JSON;
//   - a format schema whose $id states no format version, or two schemas for one version;
//   - a case that names a format version the snapshot holds no schema for, or names none while the snapshot holds several (R3);
//   - a case that fails ITS format's schema (ajv, Draft 2020-12): the file and the JSON pointer of the first error;
//   - an empty list anywhere in a case (the round trip cannot tell [] from absent; a declared limit, none in snapshot 01).
// Case documents are read in byte-sorted file-name order (the corpus's CASE_ORDER is retired by this order).

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const sourceProfile = require('./usecaseSourceProfile.json');

const CHECKSUM_FILE_NAME = 'SHA256SUMS';
const CHECKSUM_LINE_RE = /^[0-9a-f]{64}[ \t]+\*?(.+?)\s*$/;
const FORMAT_VERSION_FROM_SCHEMA_ID_RE = new RegExp(sourceProfile.formatVersionFromSchemaIdPatternSource);

const listedFileNameListOf = (snapshotDirPath) => fs.readFileSync(path.join(snapshotDirPath, CHECKSUM_FILE_NAME), 'utf8')
	.split('\n')
	.map((oneLine) => oneLine.match(CHECKSUM_LINE_RE))
	.filter((lineMatch) => lineMatch !== null)
	.map((lineMatch) => lineMatch[1]);

// parsedJsonOf — { value } | { refusalText }: JSON.parse's throw contained at the library boundary, never used to steer the walk
const parsedJsonOf = ({ snapshotDirPath, relativePath }) => {
	const fileText = fs.readFileSync(path.join(snapshotDirPath, relativePath), 'utf8');
	try {
		return { value: JSON.parse(fileText) };
	} catch (parseError) {
		return { refusalText: `${moduleName} REFUSED: '${relativePath}' is not JSON (${parseError.message})` };
	}
};

// emptyListPointerOf — the JSON pointer of the first empty list in a document, or ''
const emptyListPointerOf = (candidate, pointer) => {
	if (Array.isArray(candidate)) {
		if (candidate.length === 0) {
			return pointer === '' ? '/' : pointer;
		}
		return candidate.map((member, memberIndex) => emptyListPointerOf(member, `${pointer}/${memberIndex}`)).find((found) => found !== '') || '';
	}
	if (candidate !== null && typeof candidate === 'object') {
		return Object.keys(candidate).map((memberName) => emptyListPointerOf(candidate[memberName], `${pointer}/${memberName}`)).find((found) => found !== '') || '';
	}
	return '';
};

// loadSnapshot — the H2 load: { sourcePath, additionalSourceInputPathByName, xLog }, callback(errString, loaded)
const loadSnapshot = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
	if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
		callback(`${moduleName} REFUSED: sourcePath '${sourcePath}' is not the snapshot directory (parserDescriptor.ini names no sourceFile: the forge reads a directory)`);
		return;
	}
	const snapshotDirPath = sourcePath;
	const listedFileNameList = listedFileNameListOf(snapshotDirPath);
	const filesUnder = (directoryName) => (fs.existsSync(path.join(snapshotDirPath, directoryName))
		? fs.readdirSync(path.join(snapshotDirPath, directoryName)).filter((fileName) => fileName.endsWith(sourceProfile.caseFileNameSuffix)).sort().map((fileName) => `${directoryName}/${fileName}`)
		: []);
	const caseFileNameList = filesUnder(sourceProfile.caseDirectoryName);
	const formatFileNameList = filesUnder(sourceProfile.formatDirectoryName);
	const readFileNameList = caseFileNameList.concat(formatFileNameList, [sourceProfile.registryFileName]);
	if (caseFileNameList.length === 0) {
		callback(`${moduleName} REFUSED: the snapshot holds no case documents under '${sourceProfile.caseDirectoryName}/'`);
		return;
	}
	const unlistedFileName = readFileNameList.find((fileName) => listedFileNameList.indexOf(fileName) === -1);
	if (unlistedFileName !== undefined) {
		callback(`${moduleName} REFUSED: '${unlistedFileName}' is not listed in ${CHECKSUM_FILE_NAME}, so it was never verified; reacquire per README_PROVENANCE.md`);
		return;
	}

	// the format schemas, by the format version each $id states
	const schemaByFormatVersion = {};
	const schemaFileNameByFormatVersion = {};
	for (let formatIndex = 0; formatIndex < formatFileNameList.length; formatIndex++) {
		const formatFileName = formatFileNameList[formatIndex];
		const parsed = parsedJsonOf({ snapshotDirPath, relativePath: formatFileName });
		if (parsed.refusalText) {
			callback(parsed.refusalText);
			return;
		}
		const idMatch = typeof parsed.value.$id === 'string' ? parsed.value.$id.match(FORMAT_VERSION_FROM_SCHEMA_ID_RE) : null;
		if (idMatch === null) {
			callback(`${moduleName} REFUSED: format schema '${formatFileName}' $id ${JSON.stringify(parsed.value.$id)} states no format version (${sourceProfile.formatVersionFromSchemaIdPatternSource})`);
			return;
		}
		if (schemaByFormatVersion[idMatch[1]] !== undefined) {
			callback(`${moduleName} REFUSED: format version '${idMatch[1]}' has two schemas: '${schemaFileNameByFormatVersion[idMatch[1]]}' and '${formatFileName}'`);
			return;
		}
		schemaByFormatVersion[idMatch[1]] = parsed.value;
		schemaFileNameByFormatVersion[idMatch[1]] = formatFileName;
	}
	const formatVersionList = Object.keys(schemaByFormatVersion).sort();
	const validatorByFormatVersion = formatVersionList.reduce((byVersion, formatVersion) => ({ ...byVersion, [formatVersion]: new Ajv2020({ strict: false, allErrors: false }).compile(schemaByFormatVersion[formatVersion]) }), {});

	const registryParsed = parsedJsonOf({ snapshotDirPath, relativePath: sourceProfile.registryFileName });
	if (registryParsed.refusalText) {
		callback(registryParsed.refusalText);
		return;
	}

	const caseRecordList = [];
	for (let caseIndex = 0; caseIndex < caseFileNameList.length; caseIndex++) {
		const caseFileName = caseFileNameList[caseIndex];
		const parsed = parsedJsonOf({ snapshotDirPath, relativePath: caseFileName });
		if (parsed.refusalText) {
			callback(parsed.refusalText);
			return;
		}
		const caseDocument = parsed.value;
		const statedFormatVersion = caseDocument[sourceProfile.formatVersionPropertyName];
		if (statedFormatVersion === undefined && formatVersionList.length !== 1) {
			callback(`${moduleName} REFUSED: '${caseFileName}' states no ${sourceProfile.formatVersionPropertyName} and the snapshot holds ${formatVersionList.length} format schemas (${formatVersionList.join(', ') || 'none'}): which one it is written to is not guessed`);
			return;
		}
		const formatVersion = statedFormatVersion === undefined ? formatVersionList[0] : statedFormatVersion;
		if (validatorByFormatVersion[formatVersion] === undefined) {
			callback(`${moduleName} REFUSED: '${caseFileName}' names format version '${formatVersion}', and the snapshot holds a schema for ${formatVersionList.join(', ')} only`);
			return;
		}
		const validateCase = validatorByFormatVersion[formatVersion];
		if (!validateCase(caseDocument)) {
			const firstError = validateCase.errors[0];
			callback(`${moduleName} REFUSED: '${caseFileName}' fails the format ${formatVersion} schema (${schemaFileNameByFormatVersion[formatVersion]}) at '${firstError.instancePath || '/'}': ${firstError.message}${firstError.params ? ` ${JSON.stringify(firstError.params)}` : ''}`);
			return;
		}
		const emptyListPointer = emptyListPointerOf(caseDocument, '');
		if (emptyListPointer !== '') {
			callback(`${moduleName} REFUSED: '${caseFileName}' carries an empty list at '${emptyListPointer}': the round trip cannot tell an empty list from an absent one (a declared limit of release 1.0's forge; omit the field)`);
			return;
		}
		caseRecordList.push({ fileName: caseFileName, caseDocument, formatVersion, formatVersionSource: statedFormatVersion === undefined ? 'schemaId' : 'document' });
	}

	xLog.status(`[${moduleName}] ${caseRecordList.length} case documents, format schemas ${formatVersionList.join(', ')}, registry ${Object.keys(registryParsed.value).filter((oneName) => !oneName.startsWith('$')).length} standards`);
	callback('', { caseRecordList, resolutionRegistry: registryParsed.value, schemaFileNameByFormatVersion, sourceFileNameList: readFileNameList });
};

module.exports = { loadSnapshot, emptyListPointerOf, moduleName };
