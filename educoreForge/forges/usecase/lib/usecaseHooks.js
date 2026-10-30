'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// usecaseHooks.js — the H2/H3 hook set for the use-case forge bundle (useCaseForge-102926 Phase 1; SPEC-forgeFramework-v1.md §5).
//   sourceLoaderList   ONE loader, usecaseSnapshot (lib/usecaseSnapshotLoader.js): the case documents, each validated against ITS
//                      format's schema, and the resolution registry
//   describeSource     PURE. selfDescribedVersion null: no file of the snapshot states the RELEASE (the schema $id states the FORMAT,
//                      a different number), so the framework stamps publishedVersion 1.0 from standardSourceLocation. sourceUrl is the
//                      published standard (https://genericwhite.com/26/educore/useCaseV11/), named in the source profile.
//   describeRoot       PURE. No description: the corpus states none for itself.
//   emitContractGraph  the walk (lib/usecaseWalk.js)

const usecaseSnapshotLoader = require('./usecaseSnapshotLoader');
const usecaseWalk = require('./usecaseWalk');

const LOADER_NAME = Object.freeze({ USECASE_SNAPSHOT: 'usecaseSnapshot' });
const SOURCE_FORMAT = 'json';
const SOURCE_URL = 'https://genericwhite.com/26/educore/useCaseV11/';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		const describeSource = ({ parsed }) => ({
			selfDescribedVersion: null,
			sourceFormat: SOURCE_FORMAT,
			sourceFiles: parsed[LOADER_NAME.USECASE_SNAPSHOT].sourceFileNameList,
			sourceUrl: SOURCE_URL,
		});

		const describeRoot = ({ parsed, metadata }) => ({});

		const emitContractGraph = ({ parsed, metadata, kit }) => usecaseWalk.emitContractGraph({ loaded: parsed[LOADER_NAME.USECASE_SNAPSHOT], kit });

		return {
			sourceLoaderList: [{ loaderName: LOADER_NAME.USECASE_SNAPSHOT, load: usecaseSnapshotLoader.loadSnapshot }],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
