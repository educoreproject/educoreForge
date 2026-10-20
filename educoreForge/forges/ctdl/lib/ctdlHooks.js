'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// ctdlHooks.js — the H2/H3 hook set for the CTDL forge bundle (SPEC-forgeFramework-v1.md §5; ctdlHub-101926
// P1). Two loaders (the JSON-LD vocabulary; the snapshot's standardSourceLocation, for the upstream URL),
// describeSource, the walk, and describeRoot. The vocabulary profile is the bundle's data; the loader and
// the walk are profile-driven and live in lib/ctdl-family-forge/, which the CTDL-ASN and CTDL-QData bundles share (ruling 2026-10-20).

const path = require('path');
const vocabularyProfile = require('./ctdlVocabularyProfile.json');
const CTDL_FAMILY_FORGE_LIB = path.join(__dirname, '..', '..', '..', 'lib', 'ctdl-family-forge');
const jsonLdVocabularyLoader = require(path.join(CTDL_FAMILY_FORGE_LIB, 'jsonLdVocabularyLoader'))({ vocabularyProfile });
const jsonLdVocabularyWalk = require(path.join(CTDL_FAMILY_FORGE_LIB, 'jsonLdVocabularyWalk'))({ vocabularyProfile });

const LOADER_NAME = Object.freeze({ VOCABULARY: 'vocabulary', SOURCE_LOCATION: 'sourceLocation' });

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// describeSource — PURE. The JSON-LD declares no version of its own, so selfDescribedVersion is null and
		// the framework stamps publishedVersion from standardSourceLocation (versionSource 'provenance-file'),
		// as the July forge's root recorded; `version` is omitted so the root takes it from that stamp.
		const describeSource = ({ parsed }) => ({
			selfDescribedVersion: null,
			sourceFormat: 'json-ld',
			sourceFiles: [parsed[LOADER_NAME.VOCABULARY].sourceFileName],
			sourceUrl: parsed[LOADER_NAME.SOURCE_LOCATION].upstreamUrl,
		});

		const emitContractGraph = ({ parsed, metadata, kit }) =>
			jsonLdVocabularyWalk.emitContractGraph({ vocabulary: parsed[LOADER_NAME.VOCABULARY], kit });

		// describeRoot — PURE. The July root description, counts from the native entries; and the foreign
		// entries the source re-describes, carried verbatim (A5, allowance CT1) as JSON [{ iri, statements }]
		const describeRoot = ({ parsed, metadata }) => {
			const { nativeEntryList, foreignEntryList } = parsed[LOADER_NAME.VOCABULARY];
			const termKindCountList = vocabularyProfile.termKindOrder.map((oneTermKind) => {
				const typeName = Object.keys(vocabularyProfile.termKindByType).find((oneType) => vocabularyProfile.termKindByType[oneType].termKind === oneTermKind);
				const kindCount = nativeEntryList.filter((oneEntry) => oneEntry['@type'] === typeName).length;
				return `${kindCount} ${vocabularyProfile.termKindByType[typeName].descriptionNoun}`;
			});
			const foreignTermEntryList = foreignEntryList.map((oneEntry) => {
				const { '@id': iri, ...statements } = oneEntry;
				return { iri, statements };
			});
			return {
				description: `${vocabularyProfile.descriptionTemplateSubject} — ${termKindCountList.join(', ')}`,
				extraProperties: { foreignTermEntryList: JSON.stringify(foreignTermEntryList) },
			};
		};

		return {
			sourceLoaderList: [
				{ loaderName: LOADER_NAME.VOCABULARY, load: jsonLdVocabularyLoader.loadVocabulary },
				{ loaderName: LOADER_NAME.SOURCE_LOCATION, load: jsonLdVocabularyLoader.loadSourceLocation },
			],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
