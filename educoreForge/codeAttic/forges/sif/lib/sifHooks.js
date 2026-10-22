'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sifHooks.js — the H2/H3 hook set for the SIF forge bundle (SPEC-forgeFramework-v1.md §5;
// hub-kit-role Phase 3, migrated from forgeSif.js:746-830 whose forge() orchestrated
// parse -> buildContractGraph -> embedNodes by hand):
//   sourceLoaderList — ONE loader, `sifImplementationSpecification`: the flattened TSV parser. It is
//     DIRECTORY-bound and resolves BOTH the Implementation-Specification TSV and its sibling
//     refIdResolutionMap.tsv from inside the snapshot directory itself (parser.js:496-512), after
//     verifying that directory's SHA256SUMS.
//   describeSource   — PURE; the five keys, read off the parser's own metadata block
//     (parser.js:942-955). See the note on the two version keys below.
//   emitContractGraph — the walk, lib/forgeSifContractGraph.js (H3).
//   describeRoot     — PURE; the root description forgeSif.js:381 template-built, verbatim.
//
// describeSource / describeRoot are PURE (they read only their arguments); the loader speaks through
// the xLog the framework hands it. No logger is manufactured anywhere here (Profile §5.3), and no
// hook stamps a byte the framework owns.
//
// ⚠ WHERE `resolutionMapPath` WENT, AND WHY IT IS NOT A SEAM ARGUMENT. The bespoke forge() accepted
// a fifth option, `resolutionMapPath`, and threaded it into the parser. The framework's
// SEAM_ARGUMENT_NAME_LIST is exactly { sourcePath, owner, embedNodeLimit, skipEmbedding } and it
// REFUSES anything else BY NAME — its refusal text names this very case: "a per-standard input moves
// into a loader (SIF's resolutionMapPath) or the declaration", and test-gSeam.js:136,201 already
// carries the twin that proves the refusal fires on that exact name. MEASURED: the forger's own call
// site (forger.js:904) passes only the four, so the option was never supplied in production and the
// parser's directory-mode resolution is what has always run. The loader below therefore calls the
// parser exactly as production always reached it, and the option is simply gone rather than
// relocated to somewhere it would still be dead.
//
// NOTE ON WHAT IS *NOT* HERE. The bespoke embedNodes (forgeSif.js:696-741) is gone: the framework's
// embedPass does it, filtered by the declaration's nonEmbeddableRoleList — which for SIF is EMPTY,
// because the bespoke pass applied no role filter at all and embedded every node. The bespoke
// `skipEmbedding` / `embedNodeLimit` branches are gone too: they are seam arguments the framework
// reads (FR12). And the bespoke deriveVersionStamp call is gone: the framework calls the same
// function with the same precedence rule, from describeSource's `selfDescribedVersion`.

const parseSif = require('./parser');
const forgeSifContractGraph = require('./forgeSifContractGraph')();

// the ONE loader's logical name. lowerCamelCase, letters and digits, not 'metadata' (reserved) —
// the convention standardHookContract.js enforces by name.
const LOADER_NAME = Object.freeze({ SIF_IMPLEMENTATION_SPECIFICATION: 'sifImplementationSpecification' });

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// -----------------------------------------------------------------
		// H2 — the one loader (forgeSif.js STAGE 1, verbatim behaviour)
		// -----------------------------------------------------------------
		const loadSifImplementationSpecification = (
			{ sourcePath, additionalSourceInputPathByName, xLog },
			callback,
		) => {
			parseSif(sourcePath, {}, callback);
		};

		// -----------------------------------------------------------------
		// describeSource — PURE; the parser's metadata in the framework's five-key shape.
		//
		// ONE VERSION KEY NOW, NOT TWO. `version` IS NO LONGER RETURNED: the TSV declares no version, so
		// this bundle makes no version claim and the framework takes the root's version from the
		// provenance STAMP (versionFromStamp order, tqii 2026-08-31). The parser's hard-coded '1.0' is
		// gone with it — a forge that read no version now REPORTS no version rather than inventing one.
		// `selfDescribedVersion` REMAINS and stays null: it is the deriveVersionStamp INPUT and is
		// non-null ONLY when the source
		// SELF-DESCRIBES its version; SIF's TSV does not, and the parser accordingly never sets
		// versionSource at all, so the ternary the bespoke forge passed (forgeSif.js:762-765) resolves
		// to null here exactly as it did there. The stamp then falls to the provenance file or stamps
		// 'unknown' honestly. That is the precedence rule, not a substitution. THE DISAGREEMENT THAT
		// ALLOWANCE S3 DECLARED NO LONGER EXISTS — there is no declared version left to disagree with
		// anything, so SIF's declaration of S3 is dropped in this same phase.
		//
		// sourceFiles and sourceUrl are ABSENT from the parser's metadata entirely, so they resolve to
		// [] and '' — which is what allowances S7 and S4 declare. The `|| []` / `|| ''` here are
		// BYTE MANDATES reproducing forgeSif.js:394, not silent defaults: the root MUST carry those
		// exact empty values, the declaration says so by name, and the framework refuses the empties
		// unless the matching allowance is active.
		// -----------------------------------------------------------------
		const describeSource = ({ parsed }) => {
			const { metadata } = parsed[LOADER_NAME.SIF_IMPLEMENTATION_SPECIFICATION];
			return {
				// `version` DELIBERATELY OMITTED — the framework's REQUIRED key list no longer
				// contains it, and omission is how a bundle says 'I read no version'.
				selfDescribedVersion: metadata.versionSource === 'spec' ? metadata.version : null,
				sourceFormat: metadata.sourceFormat,
				sourceFiles: metadata.sourceFiles || [],
				sourceUrl: metadata.sourceUrl || '',
			};
		};

		// -----------------------------------------------------------------
		// H3 — the walk. The hooks un-wrap `parsed` and hand the walk the one loader's payload, which
		// is the house convention (edfiHooks.js:112-114 does the same for its three).
		// -----------------------------------------------------------------
		const emitContractGraph = ({ parsed, metadata, kit }) =>
			forgeSifContractGraph.emitContractGraph({
				sifSpecification: parsed[LOADER_NAME.SIF_IMPLEMENTATION_SPECIFICATION],
				kit,
			});

		// -----------------------------------------------------------------
		// describeRoot — PURE; the root description forgeSif.js:381 built, verbatim. The counts come
		// from the PARSER's own metadata rather than from the framework's: the framework's `metadata`
		// carries exactly seven keys (version, versionSource, sourceFormat, sourceFiles, sourceUrl,
		// snapshotKey, publishedVersion) and objectCount / fieldCount are not among them. They are read
		// from `parsed`, which describeRoot is handed for exactly this reason.
		// -----------------------------------------------------------------
		const describeRoot = ({ parsed, metadata }) => {
			const sourceMetadata = parsed[LOADER_NAME.SIF_IMPLEMENTATION_SPECIFICATION].metadata;
			return {
				description: `SIF Implementation Specification — ${sourceMetadata.objectCount} objects, ${sourceMetadata.fieldCount} fields`,
			};
		};

		return {
			sourceLoaderList: [
				{
					loaderName: LOADER_NAME.SIF_IMPLEMENTATION_SPECIFICATION,
					load: loadSifImplementationSpecification,
				},
			],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
