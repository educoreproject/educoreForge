'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiHooks.js — the H2/H3 hook set every OpenAPI-kit forge bundle uses (nextStandards-102326 K0; SPEC-forgeFramework-v1.md §5),
// built from the bundle's openapi profile: two loaders (the OpenAPI document; the snapshot's standardSourceLocation, for the
// upstream URL), describeSource, the walk, describeRoot. A bundle's own hooks module is one line over this (the
// jsonLdVocabularyHooks.js form); what differs between OpenAPI standards is profile DATA only.

const openapiLoaderFactory = require('./openapiLoader');
const openapiWalkFactory = require('./openapiWalk');

const LOADER_NAME = Object.freeze({ OPENAPI_DOCUMENT: 'openapiDocument', SOURCE_LOCATION: 'sourceLocation' });
const SOURCE_FORMAT_PREFIX = 'openapi-';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ openapiProfile }) => {
		const openapiLoader = openapiLoaderFactory({ openapiProfile });
		const openapiWalk = openapiWalkFactory({ openapiProfile });

		// describeSource — PURE. The document states its own version (info.version), so selfDescribedVersion is that text;
		// `version` is omitted so the root takes the framework's stamp.
		const describeSource = ({ parsed }) => ({
			selfDescribedVersion: parsed[LOADER_NAME.OPENAPI_DOCUMENT].document.info.version,
			sourceFormat: `${SOURCE_FORMAT_PREFIX}${openapiProfile.sourceFormat}`,
			sourceFiles: [parsed[LOADER_NAME.OPENAPI_DOCUMENT].sourceFileName],
			sourceUrl: parsed[LOADER_NAME.SOURCE_LOCATION].upstreamUrl,
		});

		const emitContractGraph = ({ parsed, metadata, kit }) => openapiWalk.emitContractGraph({ loaded: parsed[LOADER_NAME.OPENAPI_DOCUMENT], kit });

		// describeRoot — PURE. The document's own info.description, verbatim, when it states one; nothing is templated
		const describeRoot = ({ parsed, metadata }) => {
			const infoDescription = parsed[LOADER_NAME.OPENAPI_DOCUMENT].document.info.description;
			return typeof infoDescription === 'string' && infoDescription !== '' ? { description: infoDescription } : {};
		};

		return {
			sourceLoaderList: [
				{ loaderName: LOADER_NAME.OPENAPI_DOCUMENT, load: openapiLoader.loadOpenapiDocument },
				{ loaderName: LOADER_NAME.SOURCE_LOCATION, load: openapiLoader.loadSourceLocation },
			],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
