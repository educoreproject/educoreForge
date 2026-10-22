'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// pescldHooks.js — the H2/H3 hook set for the PESC_LD forge bundle (zeroBacklog lane C1; SPEC-forgeFramework-v1.md §5).
//   sourceLoaderList   ONE loader, pescldSnapshot (lib/pescldSourceLoader.js): the snapshot directory's CSVs, verbatim
//   describeSource     PURE. The package states no version of its own (about.csv carries a date, not a version), so
//                      selfDescribedVersion is null and the framework stamps publishedVersion from standardSourceLocation.
//                      sourceUrl is about.csv's own 'url' (the TAP spreadsheet the CSVs were exported from).
//   describeRoot       PURE. No description: the package states none, and a template is not a description.
//   emitContractGraph  the walk (lib/pescldWalk.js)

const pescldSourceLoader = require('./pescldSourceLoader');
const pescldWalk = require('./pescldWalk');

const LOADER_NAME = Object.freeze({ PESCLD_SNAPSHOT: 'pescldSnapshot' });
const SOURCE_FORMAT = 'csv';
const SOURCE_URL_METADATA_NAME = 'url';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		const describeSource = ({ parsed }) => {
			const loaded = parsed[LOADER_NAME.PESCLD_SNAPSHOT];
			const sourceUrl = loaded.packageMetadataByName[SOURCE_URL_METADATA_NAME];
			return {
				selfDescribedVersion: null,
				sourceFormat: SOURCE_FORMAT,
				sourceFiles: loaded.sourceFileNameList,
				sourceUrl: sourceUrl === undefined ? null : sourceUrl,
			};
		};

		const describeRoot = ({ parsed, metadata }) => ({});

		const emitContractGraph = ({ parsed, metadata, kit }) => pescldWalk.emitContractGraph({ loaded: parsed[LOADER_NAME.PESCLD_SNAPSHOT], kit });

		return {
			sourceLoaderList: [{ loaderName: LOADER_NAME.PESCLD_SNAPSHOT, load: pescldSourceLoader.loadSnapshot }],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
