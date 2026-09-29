'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sif260928Hooks.js — the H2/H3 hook set for the sif260928 forge bundle (SPEC-forgeFramework-v1.md §5).
//
// As of A1c the framework runs the whole pipeline in pure mode: verify the TSV against SHA256SUMS,
// load and census the TSV, stamp the version, apply the version guard, and mint the root; the walk
// then mints the Objects and Fields. No edges yet (A2).
//   sourceLoaderList  — ONE loader, sifImplementationSpecificationTsv: the TSV loader
//                       (lib/sif260928TsvLoader.js; SPEC §9 A3, A4, A21). It hands the walk one
//                       row object per SIF field, or refuses by name.
//   describeSource    — PURE. The TSV declares no version (selfDescribedVersion null), so the
//                       framework takes the version from standardSourceLocation. sourceUrl is
//                       null: this TSV has no published URL, and the root omits the property.
//   describeRoot      — PURE apart from the version guard, which throws a named refusal when the
//                       stamp found no version (lib/sif260928VersionGuard.js).
//   emitContractGraph — runs the walk (lib/sif260928Walk.js), which mints 159 Objects and 15,620
//                       Fields through the kit, and returns the kit's collections.
//
// The forger hands the forge <snapshot>/ImplementationSpecification_031326.tsv (parserDescriptor.ini
// sourceFile), so sourcePath is that one file.

const versionGuard = require('./sif260928VersionGuard');
const tsvLoader = require('./sif260928TsvLoader');
const walk = require('./sif260928Walk');

const LOADER_NAME = Object.freeze({ SIF_IMPLEMENTATION_SPECIFICATION_TSV: 'sifImplementationSpecificationTsv' });
const SOURCE_FORMAT = 'tsv';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		const describeSource = ({ parsed }) => ({
			selfDescribedVersion: null,
			sourceFormat: SOURCE_FORMAT,
			sourceFiles: [parsed[LOADER_NAME.SIF_IMPLEMENTATION_SPECIFICATION_TSV].sourceFileName],
			sourceUrl: null,
		});

		const describeRoot = ({ parsed, metadata }) => {
			versionGuard.assertKnownVersion({ metadata });
			return {};
		};

		const emitContractGraph = ({ parsed, metadata, kit }) => {
			walk.emitObjectsAndFields({ rowList: parsed[LOADER_NAME.SIF_IMPLEMENTATION_SPECIFICATION_TSV].rowList, kit });
			return { nodes: kit.nodes, edges: kit.edges, stats: kit.stats };
		};

		return {
			sourceLoaderList: [
				{
					loaderName: LOADER_NAME.SIF_IMPLEMENTATION_SPECIFICATION_TSV,
					load: tsvLoader.loadImplementationSpecification,
				},
			],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
