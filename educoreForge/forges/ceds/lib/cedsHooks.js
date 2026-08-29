'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// cedsHooks.js — the H2/H3 hook set for the CEDS forge bundle (SPEC-forgeFramework-v1.md §5;
// hub-kit-role Phase 1, migrated from forgeCeds.js:887-961 whose forge() orchestrated
// parse -> buildContractGraph -> embedNodes by hand):
//   sourceLoaderList — ONE loader, `cedsOntology`: the RDF/XML parser. It consumes ONLY bytes the
//     framework has already verified — forge() step 2 verifies every SHA256SUMS-listed file of the
//     snapshot before step 3 runs, and CEDS's snapshot lists exactly the one file the parser reads.
//   describeSource   — PURE; the five keys, read off the parser's own metadata block
//     (forges/ceds/lib/parser.js:624-631). TWO version keys (FR2): `version` is what the parser read
//     from owl:versionInfo and becomes the root's version byte; `selfDescribedVersion` is the
//     deriveVersionStamp INPUT and is non-null ONLY when versionSource is 'spec', which is exactly
//     the ternary forgeCeds.js:915-917 passed. The framework then calls the same
//     deriveVersionStamp the bespoke forge called, so snapshotKey / publishedVersion / versionSource
//     are derived identically.
//   emitContractGraph — the walk, lib/forgeCedsContractGraph.js (H3).
//   describeRoot     — PURE; the root description forgeCeds.js:479 template-built, verbatim.
//
// describeSource / describeRoot are PURE (they read only their arguments); the loader speaks through
// the xLog the framework hands it. No logger is manufactured anywhere here (Profile §5.3), and no
// hook stamps a byte the framework owns.
//
// NOTE ON WHAT IS *NOT* HERE. The bespoke forge's embedNodes (forgeCeds.js:819-878) is gone: the
// framework's embedPass does it, filtered by the declaration's nonEmbeddableRoleList, which carries
// the same three roles the bespoke filter named. And the bespoke `skipEmbedding` / `embedNodeLimit`
// branches are gone: they are seam arguments the framework reads (FR12).

const { parseCeds } = require('./parser');
const forgeCedsContractGraph = require('./forgeCedsContractGraph')();

// the ONE loader's logical name. lowerCamelCase, letters and digits, not 'metadata' (reserved) —
// the convention standardHookContract.js enforces by name.
const LOADER_NAME = Object.freeze({ CEDS_ONTOLOGY: 'cedsOntology' });

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// -----------------------------------------------------------------
		// H2 — the one loader (forgeCeds.js STAGE 1, verbatim behaviour)
		// -----------------------------------------------------------------
		const loadCedsOntology = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
			parseCeds({ sourcePath, xLog }, callback);
		};

		// -----------------------------------------------------------------
		// describeSource — PURE; the parser's metadata in the framework's five-key shape.
		// versionSource 'spec' means the parser READ owl:versionInfo from the ontology, and the
		// source then WINS over any provenance file; anything else means the source did not
		// self-describe, so the stamp input is null and deriveVersionStamp falls to the provenance
		// file or stamps 'unknown' honestly. That is the precedence rule, not a substitution.
		// -----------------------------------------------------------------
		const describeSource = ({ parsed }) => {
			const { metadata } = parsed[LOADER_NAME.CEDS_ONTOLOGY];
			return {
				version: metadata.version,
				selfDescribedVersion: metadata.versionSource === 'spec' ? metadata.version : null,
				sourceFormat: metadata.sourceFormat,
				sourceFiles: metadata.sourceFiles,
				sourceUrl: metadata.sourceUrl,
			};
		};

		// -----------------------------------------------------------------
		// H3 — the walk
		// -----------------------------------------------------------------
		const emitContractGraph = ({ parsed, metadata, kit }) =>
			forgeCedsContractGraph.emitContractGraph({ parsed, metadata, kit });

		// -----------------------------------------------------------------
		// describeRoot — PURE; the root description forgeCeds.js:479 built, verbatim. `metadata` is
		// POST-stamp, and deriveVersionStamp never returns `version`, so metadata.version here is
		// the parser's own reading — the identical string the bespoke root interpolated.
		// -----------------------------------------------------------------
		const describeRoot = ({ parsed, metadata }) => ({
			description: `Common Education Data Standards ontology, version ${metadata.version}`,
		});

		return {
			sourceLoaderList: [
				{ loaderName: LOADER_NAME.CEDS_ONTOLOGY, load: loadCedsOntology },
			],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
