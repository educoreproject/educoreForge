'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// jsonLdVocabularyHooks.js — the H2/H3 hook set every CTDL-family forge bundle uses (SPEC-forgeFramework-v1.md §5;
// ctdlHub-101926 P1/P2), built from a bundle's vocabulary profile: two loaders (the JSON-LD vocabulary; the snapshot's
// standardSourceLocation, for the upstream URL, never hard-coded), describeSource, the walk, and describeRoot. A bundle's
// own hooks module is one line over this; what differs between CTDL, CTDL-ASN and CTDL-QData is profile DATA only.

const jsonLdVocabularyLoaderFactory = require('./jsonLdVocabularyLoader');
const jsonLdVocabularyWalkFactory = require('./jsonLdVocabularyWalk');

const LOADER_NAME = Object.freeze({ VOCABULARY: 'vocabulary', SOURCE_LOCATION: 'sourceLocation' });

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabularyProfile }) => {
		const jsonLdVocabularyLoader = jsonLdVocabularyLoaderFactory({ vocabularyProfile });
		const jsonLdVocabularyWalk = jsonLdVocabularyWalkFactory({ vocabularyProfile });

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
