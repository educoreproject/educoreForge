'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// pescHooks.js — the H2/H3 hook set for the PESC260805 forge bundle
// (SPEC-forgeFramework-v1.md §5; hub-kit-role Phase 4, migrated from forgePesc260805.js:636-905
// whose forge() orchestrated parse -> buildSourceTierGraph -> derived -> composition -> synthetic
// -> embed by hand):
//   sourceLoaderList  — ONE loader, `pescCorpus`: the 64-file XSD aggregate parser. It is
//     DIRECTORY-bound. ⚠ IT DOES NOT VERIFY CHECKSUMS: an earlier draft of this line said the
//     parser 'verifies the snapshot directory's SHA256SUMS itself', and grep -a finds no checksum
//     reference in lib/parser.js at all. The FRAMEWORK verifies, for every forge, at forge() step 2
//     (verifySnapshotChecksums, FR8) — which is CHECKSUM VERIFICATION PESC NEVER HAD before this
//     migration, and is why two test fixtures needed SHA256SUMS files.
//   describeSource    — PURE; the five keys. See the note on the two version keys below, which is
//     where allowance P17 comes from.
//   emitContractGraph — the walk, lib/forgePescContractGraph.js (H3): source, derived, searchText
//     composition and synthetic tiers, in that order, all minting through the kit.
//   describeRoot      — PURE; the root description the bespoke forge template-built at :196,
//     verbatim, plus the ONE licensed root extra property.
//
// describeSource / describeRoot are PURE (they read only their arguments). ⚠ THE LOADER DOES NOT
// SPEAK: an earlier draft of this line said it 'speaks through the xLog the framework hands it', and
// loadPescCorpus DISCARDS the xLog it is handed — parsePescCorpus takes no logger. The framework
// still hands one in, so the seam is there if the parser ever needs it. No logger is manufactured
// anywhere here (Profile §5.3), and no hook stamps a byte the framework owns.
//
// ⚠ WHAT IS *NOT* HERE, AND WHY THE LOSS IS ONLY NARRATION. The bespoke forge() printed four long
// xLog status lines (source/derived/synthetic/composition), guarded by its own `requiredStat` so a
// renamed stat refused by name instead of interpolating the word "undefined" into a fluent English
// sentence. The framework's pure layer takes no xLog by construction, so those lines are gone. The
// GUARD is not: `requiredStat` was lifted into the framework and is a member of the kit surface
// (contractGraphKit.js:335, "PESC's guard lifted"), and the walk uses it. And no FIGURE is lost —
// every stat those lines read still rides out in the returned `stats`, which is what the three PESC
// suites actually assert on. What is lost is the narration in the build log, recorded here rather
// than discovered later.
//
// ⚠ THE BESPOKE embedNodes IS GONE: the framework's embedPass does it, filtered by the
// declaration's nonEmbeddableRoleList — which for PESC is EMPTY, because the bespoke pass applied
// no role filter at all and embedded all 42,372 nodes including the root. `skipEmbedding` and
// `embedNodeLimit` are seam arguments the framework reads (FR12).

const path = require('path');
const parsePescCorpusFactory = require('./parser');
const forgePescContractGraphFactory = require('./forgePescContractGraph');
const pescForgeDeclaration = require('./pescForgeDeclaration');

const { parsePescCorpus } = parsePescCorpusFactory();
const forgePescContractGraph = forgePescContractGraphFactory();
const { PESC_TIER } = forgePescContractGraph;

// the ONE loader's logical name. lowerCamelCase, letters and digits, not 'metadata' (reserved) —
// the convention standardHookContract.js enforces by name.
const LOADER_NAME = Object.freeze({ PESC_CORPUS: 'pescCorpus' });

// AGGREGATE_VERSION — OURS, never a PESC edition (R-ACQ-7), carried from the bespoke forge's :70.
// It is a block byte twice: the root's `version` property and the block subject
// `pesc260805@aggregate_01_base`. It lives HERE rather than in the declaration because it is a
// describeSource VALUE, and the declaration is closed at its fourteen contract keys.
const AGGREGATE_VERSION = 'aggregate-01';
const SOURCE_FORMAT = 'pesc-xsd-directory';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// -----------------------------------------------------------------
		// H2 — the one loader (the bespoke forge's STAGE 1, verbatim behaviour)
		// -----------------------------------------------------------------
		const loadPescCorpus = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
			parsePescCorpus({ sourcePath }, callback);
		};

		// -----------------------------------------------------------------
		// describeSource — PURE; the parser's corpus in the framework's five-key shape.
		//
		// TWO VERSION KEYS (FR2), AND FOR PESC THEY DELIBERATELY DISAGREE — WHICH IS ALLOWANCE P17.
		// `version` is what the root carries and is a block byte: 'aggregate-01'.
		// `selfDescribedVersion` is the deriveVersionStamp INPUT and is non-null ONLY when the SOURCE
		// self-describes its version. **PESC's does not, and saying otherwise would be a lying root
		// byte.** snapshot-provenance.js:11 defines versionSource 'spec' as "the parser read the
		// version from a SELF-DESCRIBING source; the SOURCE WINS" — but `aggregate-01` is OURS
		// (R-ACQ-7), cut by us on 2026-08-05, and the snapshot's own README_PROVENANCE.md says in
		// capitals that it "must never be read as a PESC edition" because PESC publishes no coherent
		// whole-family release. MEASURED both ways before choosing:
		//     sourceVersion 'aggregate-01' -> { snapshotKey '01', publishedVersion 'aggregate-01', versionSource 'spec' }
		//     sourceVersion null           -> { snapshotKey '01', publishedVersion 'unknown',      versionSource 'unknown' }
		// The first was available and is REFUSED — it would claim in a BLOCK BYTE that PESC's source
		// self-describes a whole-family version it does not publish.
		// ⚠ AND THE OUTCOME MOVED AFTER THIS COMMENT WAS FIRST WRITTEN (RULING FJ-P4-7): the snapshot
		// now carries a standardSourceLocation declaring publishedVersion aggregate-01, so the stamp
		// takes the THIRD branch and returns { snapshotKey '01', publishedVersion 'aggregate-01',
		// versionSource 'provenance-file' } — the truthful label for a version that is OURS. P17 is
		// UNAFFECTED and still MET, because selfDescribedVersion is still null and the root's version
		// 'aggregate-01' still differs from (null ?? 'unknown'). Same shape SIF declares as S3.
		//
		// sourceUrl '' is what allowance P16 declares. sourceFiles is the 64 artifact filenames in
		// the parser's own order; all 64 are named in the snapshot's SHA256SUMS (measured 64 of 64),
		// which is why NO E8-analogue is declared.
		// -----------------------------------------------------------------
		const describeSource = ({ parsed }) => {
			const { artifacts } = parsed[LOADER_NAME.PESC_CORPUS];
			return {
				version: AGGREGATE_VERSION,
				selfDescribedVersion: null,
				sourceFormat: SOURCE_FORMAT,
				sourceFiles: artifacts.map((oneArtifact) => oneArtifact.filename),
				sourceUrl: '',
			};
		};

		// -----------------------------------------------------------------
		// H3 — the walk. The hooks un-wrap `parsed` and hand the walk the one loader's payload,
		// which is the house convention (sifHooks.js and edfiHooks.js do the same).
		//
		// `metadata` is deliberately NOT accepted: the framework hands the hook
		// { parsed, metadata, kit }, but PESC's walk reads no post-stamp metadata at all — the root
		// is minted by the framework BEFORE the walk runs, and every tier reads only the parsed
		// corpus and the graph it is building. Accepting it would misdeclare the seam, which is the
		// correction MIDNIGHT_PORTAL made to the SIF walk in Phase 3.
		// -----------------------------------------------------------------
		const emitContractGraph = ({ parsed, kit }) =>
			forgePescContractGraph.emitContractGraph({
				pescCorpus: parsed[LOADER_NAME.PESC_CORPUS],
				kit,
			});

		// -----------------------------------------------------------------
		// describeRoot — PURE; the root description the bespoke forge built at :196, verbatim
		// (em dash included — it is a block byte), plus the ONE root extra property.
		//
		// `pescTier: 'meta'` is the bundle-local tier marker the bespoke root carried and no other
		// standard's root has. The framework REFUSES an extraProperty no active allowance names
		// (rootNode.js:118-127), and allowance P5 — the registry's first offline-precondition row,
		// created in this commit — is what names it. The count comes from `parsed` rather than from
		// the framework's metadata, which carries no artifact count.
		// -----------------------------------------------------------------
		const describeRoot = ({ parsed }) => {
			const { artifacts } = parsed[LOADER_NAME.PESC_CORPUS];
			return {
				description: `${pescForgeDeclaration.standardDisplayName} — ${artifacts.length} schema artifacts, source tier`,
				extraProperties: { pescTier: PESC_TIER.META },
			};
		};

		return {
			sourceLoaderList: [
				{
					loaderName: LOADER_NAME.PESC_CORPUS,
					load: loadPescCorpus,
				},
			],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
