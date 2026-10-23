'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiLoader.js — the H2 loaders of the OpenAPI kit (nextStandards-102326 K0): the OpenAPI document, and the snapshot's
// standardSourceLocation (where the root's sourceUrl is read from, never hard-coded). This is where the publisher's bytes enter
// the forge, so it refuses what is not an OpenAPI 3 document with components.schemas; the KEYWORD checks are the walk's, against
// the registry, because only the walk knows each keyword's position.

const fs = require('fs');
const { validateOpenapiProfile } = require('./openapiProfileContract');

const OPENAPI_VERSION_PATTERN = /^3\.[0-9]+\.[0-9]+$/;
const LOCATION_URL_PATTERN = /^upstreamUrl:[ \t]*(\S+)[ \t]*$/m;

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const moduleFunction =
	({ moduleName } = {}) =>
	({ openapiProfile }) => {
		validateOpenapiProfile(openapiProfile);
		const { sourceFileName } = openapiProfile;

		// loadOpenapiDocument — the document the descriptor's sourceFile names → { sourceFileName, document }
		const loadOpenapiDocument = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
			const sourceFilePath = fs.statSync(sourcePath).isDirectory() ? `${sourcePath}/${sourceFileName}` : sourcePath;
			if (sourceFilePath.split('/').pop() !== sourceFileName) {
				callback(`${moduleName} REFUSED: the source '${sourceFilePath}' is not the profile's sourceFileName '${sourceFileName}'`);
				return;
			}
			if (!fs.existsSync(sourceFilePath)) {
				callback(`${moduleName} REFUSED: the OpenAPI source '${sourceFilePath}' is not on disk`);
				return;
			}
			let document;
			try {
				document = JSON.parse(fs.readFileSync(sourceFilePath, 'utf8'));
			} catch (parseError) {
				// localized parse boundary (house-sanctioned, jsonLdVocabularyLoader.js): the refusal, not the throw, is the flow
				callback(`${moduleName} REFUSED: '${sourceFilePath}' is not parseable JSON (${parseError.message}); reacquire per README_PROVENANCE.md`);
				return;
			}
			if (!isPlainObject(document) || typeof document.openapi !== 'string' || !OPENAPI_VERSION_PATTERN.test(document.openapi)) {
				callback(`${moduleName} REFUSED: '${sourceFilePath}' states no OpenAPI 3 version (openapi: ${JSON.stringify(isPlainObject(document) ? document.openapi : undefined)})`);
				return;
			}
			if (!isPlainObject(document.components) || !isPlainObject(document.components.schemas)) {
				callback(`${moduleName} REFUSED: '${sourceFilePath}' has no components.schemas object; the kit forges the data model only`);
				return;
			}
			if (!isPlainObject(document.info) || typeof document.info.version !== 'string') {
				callback(`${moduleName} REFUSED: '${sourceFilePath}' has no info.version string; selfDescribedVersion is read from it, never assumed`);
				return;
			}
			xLog.status(`[${moduleName}] OpenAPI ${document.openapi}, info.version ${document.info.version}: ${Object.keys(document.components.schemas).length} components.schemas`);
			callback('', { sourceFileName, document });
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
