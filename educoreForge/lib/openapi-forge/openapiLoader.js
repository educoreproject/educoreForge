'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiLoader.js — the H2 loaders of the OpenAPI kit (nextStandards-102326 K0, K1): the OpenAPI document(s), and the snapshot's
// standardSourceLocation (where the root's sourceUrl is read from, never hard-coded). This is where the publisher's bytes enter
// the forge, so it refuses what is not an OpenAPI 3 document with components.schemas; the KEYWORD checks are the walk's, against
// the registry, because only the walk knows each keyword's position.
// ⟪K1⟫ A dereferencedMultiFile profile names a LIST of files in one snapshot directory; each is read and checked the same way, and the
// payload carries every document by file name (the walk unions them). referencedSingleFile is K0's one document, unchanged.
// ⟪K2a, wave 2 lane E⟫ the text is parsed by the profile's sourceFormat through openapiSourceParser.js (json, yaml), the same module the
// round-trip pairs read through.

const fs = require('fs');
const path = require('path');
const { validateOpenapiProfile, sourceFileNameListOf } = require('./openapiProfileContract');
const { parseOpenapiSourceFile } = require('./openapiSourceParser');

const OPENAPI_VERSION_PATTERN = /^3\.[0-9]+\.[0-9]+$/;
const LOCATION_URL_PATTERN = /^upstreamUrl:[ \t]*(\S+)[ \t]*$/m;

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const moduleFunction =
	({ moduleName } = {}) =>
	({ openapiProfile }) => {
		validateOpenapiProfile(openapiProfile);
		const sourceFileNameList = sourceFileNameListOf(openapiProfile);

		// documentRefusalOf — '' when one parsed file is an OpenAPI 3 document with components.schemas and info.version, else why not
		const documentRefusalOf = ({ document, sourceFilePath }) => {
			if (!isPlainObject(document) || typeof document.openapi !== 'string' || !OPENAPI_VERSION_PATTERN.test(document.openapi)) {
				return `${moduleName} REFUSED: '${sourceFilePath}' states no OpenAPI 3 version (openapi: ${JSON.stringify(isPlainObject(document) ? document.openapi : undefined)})`;
			}
			if (!isPlainObject(document.components) || !isPlainObject(document.components.schemas)) {
				return `${moduleName} REFUSED: '${sourceFilePath}' has no components.schemas object; the kit forges the data model only`;
			}
			if (!isPlainObject(document.info) || typeof document.info.version !== 'string') {
				return `${moduleName} REFUSED: '${sourceFilePath}' has no info.version string; selfDescribedVersion is read from it, never assumed`;
			}
			return '';
		};

		// loadOpenapiDocument — every file the profile names → { sourceFileName, sourceFileNameList, document, documentByFileName }.
		// sourceFileName and document are the FIRST file's (the one the descriptor's sourceFile names, or the only one).
		const loadOpenapiDocument = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
			const snapshotDirPath = fs.statSync(sourcePath).isDirectory() ? sourcePath : path.dirname(sourcePath);
			if (!fs.statSync(sourcePath).isDirectory() && sourceFileNameList.indexOf(path.basename(sourcePath)) === -1) {
				callback(`${moduleName} REFUSED: the source '${sourcePath}' is not one of the profile's files (${sourceFileNameList.join(', ')})`);
				return;
			}
			const documentByFileName = {};
			const refusalText = sourceFileNameList.reduce((firstRefusal, sourceFileName) => {
				if (firstRefusal !== '') {
					return firstRefusal;
				}
				const sourceFilePath = path.join(snapshotDirPath, sourceFileName);
				if (!fs.existsSync(sourceFilePath)) {
					return `${moduleName} REFUSED: the OpenAPI source '${sourceFilePath}' is not on disk`;
				}
				const { parseRefusal, document } = parseOpenapiSourceFile({ sourceFilePath, sourceFormat: openapiProfile.sourceFormat });
				if (parseRefusal !== '') {
					return `${moduleName} ${parseRefusal}`;
				}
				const documentRefusal = documentRefusalOf({ document, sourceFilePath });
				if (documentRefusal === '') {
					documentByFileName[sourceFileName] = document;
					xLog.status(`[${moduleName}] ${sourceFileName}: OpenAPI ${document.openapi}, info.version ${document.info.version}: ${Object.keys(document.components.schemas).length} components.schemas`);
				}
				return documentRefusal;
			}, '');
			if (refusalText !== '') {
				callback(refusalText);
				return;
			}
			const versionTextList = sourceFileNameList.map((sourceFileName) => documentByFileName[sourceFileName].info.version).filter((versionText, versionIndex, versionList) => versionList.indexOf(versionText) === versionIndex);
			if (versionTextList.length !== 1) {
				callback(`${moduleName} REFUSED: the profile's files state ${versionTextList.length} different info.version values (${versionTextList.join(', ')}); one data model has one version`);
				return;
			}
			callback('', { sourceFileName: sourceFileNameList[0], sourceFileNameList, document: documentByFileName[sourceFileNameList[0]], documentByFileName });
		};

		// loadSourceLocation — the snapshot's standardSourceLocation, for the upstream URL the root states
		const loadSourceLocation = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
			const locationFilePath = additionalSourceInputPathByName.sourceLocation;
			const locationMatch = fs.readFileSync(locationFilePath, 'utf8').match(LOCATION_URL_PATTERN);
			if (!locationMatch) {
				callback(`${moduleName} REFUSED: '${locationFilePath}' states no 'upstreamUrl:' line; the root's sourceUrl is read from it and never assumed`);
				return;
			}
			callback('', { upstreamUrl: locationMatch[1] });
		};

		return { loadOpenapiDocument, loadSourceLocation };
	};

module.exports = moduleFunction({ moduleName });
