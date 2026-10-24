'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sedmHooks.js — the H2/H3 hook set for the SEDM forge bundle (nextStandards-102326 wave 2, lane G; SPEC-forgeFramework-v1.md §5).
//   sourceLoaderList   ONE loader, sedmSnapshot (lib/sedmSourceLoader.js): the CSV and the structures JSON, verbatim
//   describeSource     PURE. SEDM states no version (working documents; the JSON's _meta version is its extraction's), so
//                      selfDescribedVersion is null and the framework stamps publishedVersion from standardSourceLocation ('unknown').
//                      No public URL is recorded for these files, so sourceUrl is null.
//   describeRoot       PURE. No description: the working documents state none for SEDM as a whole.
//   emitContractGraph  the walk (lib/sedmWalk.js)

const sedmSourceLoader = require('./sedmSourceLoader');
const sedmWalk = require('./sedmWalk');

const LOADER_NAME = Object.freeze({ SEDM_SNAPSHOT: 'sedmSnapshot' });
const SOURCE_FORMAT = 'csv+json';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		const describeSource = ({ parsed }) => ({
			selfDescribedVersion: null,
			sourceFormat: SOURCE_FORMAT,
			sourceFiles: parsed[LOADER_NAME.SEDM_SNAPSHOT].sourceFileNameList,
			sourceUrl: null,
		});

		const describeRoot = ({ parsed, metadata }) => ({});

		const emitContractGraph = ({ parsed, metadata, kit }) => sedmWalk.emitContractGraph({ loaded: parsed[LOADER_NAME.SEDM_SNAPSHOT], kit });

		return {
			sourceLoaderList: [{ loaderName: LOADER_NAME.SEDM_SNAPSHOT, load: sedmSourceLoader.loadSnapshot }],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
