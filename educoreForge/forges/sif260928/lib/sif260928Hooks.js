'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sif260928Hooks.js — the H2/H3 hook set for the sif260928 forge bundle (SPEC-forgeFramework-v1.md §5).
//
// As of A4 the framework runs the whole pipeline in pure mode: verify the TSV and the RefId map
// against SHA256SUMS, load and census the TSV, load the map, stamp the version, apply the version
// guard, and mint the root; the walk then mints the Objects, Containers, Fields, Questions, Codesets
// and CodesetValues and adds the HAS_FIELD, HAS_CHILD, HAS_INSTANCE, HAS_VALUE, CONSTRAINED_BY and
// REFERENCES_OBJECT edges.
//   sourceLoaderList  — TWO loaders, run in this order:
//                       sifImplementationSpecificationTsv, the TSV loader (lib/sif260928TsvLoader.js;
//                       SPEC §9 A3, A4, A21, A28), which hands the walk one row object per SIF field,
//                       or refuses by name; and sifRefIdResolutionMap, the map loader
//                       (lib/sif260928RefIdMapLoader.js; A24), which reads the snapshot's declared
//                       second input, refIdResolutionMap.tsv.
//   describeSource    — PURE. The TSV declares no version (selfDescribedVersion null), so the
//                       framework takes the version from standardSourceLocation. sourceFiles names
//                       the TSV and the map. sourceUrl is null: this TSV has no published URL, and
//                       the root omits the property.
//   describeRoot      — PURE apart from the version guard, which throws a named refusal when the
//                       stamp found no version (lib/sif260928VersionGuard.js).
//   emitContractGraph — runs the walk (lib/sif260928Walk.js), which mints 159 Objects, 6,586
//                       Containers, 15,620 Fields, 5,018 Questions, 131 Codesets and 4,055
//                       CodesetValues through the kit and adds 15,620 HAS_FIELD, 21,017 HAS_CHILD,
//                       15,620 HAS_INSTANCE, 4,055 HAS_VALUE, 1,495 CONSTRAINED_BY and 607
//                       REFERENCES_OBJECT edges, and returns the kit's collections.
//
// The forger hands the forge <snapshot>/ImplementationSpecification_031326.tsv (parserDescriptor.ini
// sourceFile), so sourcePath is that one file; the framework resolves the map beside it from the
// declaration's additionalSourceInputList.

const versionGuard = require('./sif260928VersionGuard');
const tsvLoader = require('./sif260928TsvLoader');
const refIdMapLoader = require('./sif260928RefIdMapLoader');
const walk = require('./sif260928Walk');

const LOADER_NAME = Object.freeze({ SIF_IMPLEMENTATION_SPECIFICATION_TSV: 'sifImplementationSpecificationTsv', SIF_REF_ID_RESOLUTION_MAP: 'sifRefIdResolutionMap' });
const SOURCE_FORMAT = 'tsv';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		const describeSource = ({ parsed }) => ({
			selfDescribedVersion: null,
			sourceFormat: SOURCE_FORMAT,
			sourceFiles: [parsed[LOADER_NAME.SIF_IMPLEMENTATION_SPECIFICATION_TSV].sourceFileName, parsed[LOADER_NAME.SIF_REF_ID_RESOLUTION_MAP].sourceFileName],
			sourceUrl: null,
		});

		const describeRoot = ({ parsed, metadata }) => {
			versionGuard.assertKnownVersion({ metadata });
			return {};
		};

		const emitContractGraph = ({ parsed, metadata, kit }) => {
			walk.emitObjectTree({
				rowList: parsed[LOADER_NAME.SIF_IMPLEMENTATION_SPECIFICATION_TSV].rowList,
				resolvedTableTitleByRefIdName: parsed[LOADER_NAME.SIF_REF_ID_RESOLUTION_MAP].resolvedTableTitleByRefIdName,
				kit,
			});
			return { nodes: kit.nodes, edges: kit.edges, stats: kit.stats };
		};

		return {
			sourceLoaderList: [
				{
					loaderName: LOADER_NAME.SIF_IMPLEMENTATION_SPECIFICATION_TSV,
					load: tsvLoader.loadImplementationSpecification,
				},
				{
					loaderName: LOADER_NAME.SIF_REF_ID_RESOLUTION_MAP,
					load: refIdMapLoader.loadRefIdResolutionMap,
				},
			],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
