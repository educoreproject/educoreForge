'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// hooks.js — the H2/H3 hook set every PESC release bundle shares (SPEC-forgeFramework-v1.md §5;
// DESIGN-pescForge.md §1.2, §4.1).
//
//   require('<lib>/pesc-release-forge/hooks').makeReleaseHooks({ standardKey, frozenReleaseCensus, frozenCensusName })
//     → { sourceLoaderList, describeSource, describeRoot, emitContractGraph }
//
//   sourceLoaderList  — TWO loaders, run in this order:
//                       pescReleaseXsdSet (xsdSetLoader.js): parse the folder, resolve every QName
//                         inside the release, and hold the counts to the bundle's frozen census;
//                       pescReleaseManifestEntry (manifestEntryLoader.js): the expander's entry,
//                         whose member files must be exactly the folder's .xsd files by sha256.
//   describeSource    — PURE. The XSD files are not read for a version (selfDescribedVersion null),
//                       so the framework takes it from standardSourceLocation. sourceFiles names the
//                       .xsd files in the parser's order and then the manifest entry. sourceUrl null:
//                       a release is our closure of PESC files, not a published bundle with a URL.
//   describeRoot      — PURE apart from the version guard, which throws a named refusal.
//   emitContractGraph — PHASE F1: MINTS NOTHING. The walk is phase F2 (WORKORDER §3). Until then
//                       the forge returns the root alone, and carries the loaders' census in
//                       `stats` so the census gate (F4) reads it where it will read it from then on.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { makeXsdSetLoader } = require('./xsdSetLoader');
const manifestEntryLoader = require('./manifestEntryLoader');
const versionGuard = require('./versionGuard');

const LOADER_NAME = Object.freeze({ PESC_RELEASE_XSD_SET: 'pescReleaseXsdSet', PESC_RELEASE_MANIFEST_ENTRY: 'pescReleaseManifestEntry' });
const SOURCE_FORMAT = 'pesc-xsd-release-folder';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ standardKey, frozenReleaseCensus, frozenCensusName }) => {
		if (typeof standardKey !== 'string' || frozenReleaseCensus === null || typeof frozenReleaseCensus !== 'object' || typeof frozenCensusName !== 'string') {
			throw refuse.byName({ moduleName, what: `makeReleaseHooks was given standardKey ${JSON.stringify(standardKey)}, frozenReleaseCensus ${frozenReleaseCensus === null ? 'null' : typeof frozenReleaseCensus}, frozenCensusName ${JSON.stringify(frozenCensusName)}`, where: 'a release bundle hands its standardKey, its frozen census object and that census file\'s name (releaseBundle.makeBundleHooks)' });
		}
		const xsdSetLoader = makeXsdSetLoader({ frozenReleaseCensus, frozenCensusName });

		const describeSource = ({ parsed }) => ({
			selfDescribedVersion: null,
			sourceFormat: SOURCE_FORMAT,
			sourceFiles: parsed[LOADER_NAME.PESC_RELEASE_XSD_SET].artifacts.map((oneArtifact) => oneArtifact.filename).concat([parsed[LOADER_NAME.PESC_RELEASE_MANIFEST_ENTRY].sourceFileName]),
			sourceUrl: null,
		});

		const describeRoot = ({ parsed, metadata }) => {
			versionGuard.assertKnownVersion({ metadata, releaseEntry: parsed[LOADER_NAME.PESC_RELEASE_MANIFEST_ENTRY].releaseEntry, standardKey });
			return {};
		};

		const emitContractGraph = ({ parsed, kit }) => ({
			nodes: kit.nodes,
			edges: kit.edges,
			stats: {
				releaseCensus: parsed[LOADER_NAME.PESC_RELEASE_XSD_SET].releaseCensus,
			},
		});

		return {
			sourceLoaderList: [
				{
					loaderName: LOADER_NAME.PESC_RELEASE_XSD_SET,
					load: (loaderArgs, callback) => xsdSetLoader.load(loaderArgs, callback),
				},
				{
					loaderName: LOADER_NAME.PESC_RELEASE_MANIFEST_ENTRY,
					load: manifestEntryLoader.loadReleaseManifestEntry,
				},
			],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = { makeReleaseHooks: moduleFunction({ moduleName }), LOADER_NAME, SOURCE_FORMAT, moduleName };
