'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// xsdHooks.js — the H2/H3 hook set every XSD-kit forge bundle uses (wave 3 lane I, K3; SPEC-forgeFramework-v1.md §5), built from the
// bundle's xsd profile: two loaders (the schema sets; the snapshot's standardSourceLocation, for the upstream URL), describeSource, the
// walk, describeRoot. A bundle's own hooks module is one line over this (the openapiHooks.js form); what differs between XSD standards is
// profile DATA only.

const xsdSetLoaderFactory = require('./xsdSetLoader');
const xsdWalkFactory = require('./xsdWalk');

const LOADER_NAME = Object.freeze({ SCHEMA_SETS: 'xsdSchemaSets', SOURCE_LOCATION: 'sourceLocation' });
const SOURCE_FORMAT = 'xsd-schema-sets';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ xsdProfile }) => {
		const xsdSetLoader = xsdSetLoaderFactory({ xsdProfile });
		const xsdWalk = xsdWalkFactory({ xsdProfile });

		// describeSource — PURE. A portfolio of schemas states no one version of its own, so selfDescribedVersion is null and the root takes
		// the framework's stamp; sourceFiles are the forged files, in path order.
		const describeSource = ({ parsed }) => ({
			selfDescribedVersion: null,
			sourceFormat: SOURCE_FORMAT,
			sourceFiles: parsed[LOADER_NAME.SCHEMA_SETS].schemaFileList.map((oneFile) => oneFile.schemaFileRelativePath),
			sourceUrl: parsed[LOADER_NAME.SOURCE_LOCATION].upstreamUrl,
		});

		const emitContractGraph = ({ parsed, metadata, kit }) => xsdWalk.emitContractGraph({ loaded: parsed[LOADER_NAME.SCHEMA_SETS], kit });

		// describeRoot — PURE. Nothing is templated: the root states only what the framework stamps
		const describeRoot = ({ parsed, metadata }) => ({});

		return {
			sourceLoaderList: [
				{ loaderName: LOADER_NAME.SCHEMA_SETS, load: xsdSetLoader.loadSchemaSets },
				{ loaderName: LOADER_NAME.SOURCE_LOCATION, load: xsdSetLoader.loadSourceLocation },
			],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
