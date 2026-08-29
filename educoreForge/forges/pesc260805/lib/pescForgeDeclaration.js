'use strict';

// pescForgeDeclaration.js — H1 for the PESC260805 forge bundle (SPEC-forgeFramework-v1.md §4; the
// PESC migration, hub-kit-role Phase 4). DATA, never code: the descriptor-shaped constants the
// bespoke forgePesc260805.js carried inline (STANDARD_KEY :63, STANDARD_SOURCE :66,
// STANDARD_DISPLAY :67, STABLE_URI_PROPERTY_NAME :68, ROOT_STABLE_ID :69, AGGREGATE_VERSION :70,
// the root's label :198 and parserVersion :211, and pescMappingInstruction :76-83) written ONCE, in
// the framework's declared shape.
//
// ⚠ THE ID THIS FILE MUST PRODUCE IS **NOT** THE ID IT REPLACES, AND THAT IS RULED, NOT ACCIDENTAL.
//   I4  = f139654a98cd0ef238759e6dc2bda2e532f13d5a7db00bfea94d89c3317b149d at 88,551,726 — the
//         PRE-migration id, reproduced on unchanged code at this phase's entry gate (the null
//         experiment, and the fifth independent reproduction of that id).
//   I4' = the POST-migration id, recorded in the DEVLOG and the lineage record when measured.
// RULING FJ-P4-5 re-keys PESC by controlled experiment rather than holding f139654a, because the
// PESC root is the ONE node in this block that does not already look like a framework root. The
// other 42,371 nodes carry depth and crossRefs; the root carries neither, and carries none of
// snapshotKey / publishedVersion / versionSource / coreVersion either — MEASURED at entry, and
// independently by the supervisor from the same store. structural-contract.js:181,185-189 stamps
// depth and crossRefs on EVERY node with no allowance channel and no root exemption, so no
// declaration-only migration can hold f139654a. Suppressing them would mean editing
// lib/structural-contract/, shared by all four forges and sixteen producers. The root is therefore
// made CONFORMANT with CEDS, SIF and Ed-Fi instead — the framework owns the root — and the
// predicted new root line was written into the DEVLOG in full BEFORE the re-forge, so the check
// afterwards is an assertion rather than an interpretation.
//
// Every value here is a BYTE of the PESC block or an identity rule the framework enforces; none is
// derived.

const path = require('path');
const { PERMISSIVE_STABLE_ID_PATTERN } = require(
	path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'migrationAllowanceRegistry'),
);

// STABLE_URI_PROPERTY_NAME — PESC addresses every node by its own synthetic stableId. It is ALSO
// mappingInstruction.crosswalkResolveProperty, so it is written once and read twice, exactly as
// CEDS's 'uri' and SIF's 'sifStableId' are.
const STABLE_URI_PROPERTY_NAME = 'pesc260805StableId';

// AGGREGATE_VERSION — OURS, never a PESC edition (R-ACQ-7). PESC publishes no coherent
// whole-family release, so this token is an educoreForge aggregate version cut on 2026-08-05;
// manifest.json names every constituent at its real published version. It is a BLOCK BYTE twice
// over: the root's `version` property AND the block subject `pesc260805@aggregate_01_base`.
// ⚠ It is deliberately NOT passed as describeSource's selfDescribedVersion — see allowance P17.
const AGGREGATE_VERSION = 'aggregate-01';

const pescForgeDeclaration = Object.freeze({
	standardKey: 'pesc260805',
	// D-6 (supervisor ruling, pescForgeRebuild-080526): deliberately DISTINCT from the incumbent's
	// 'PESC' so both bundles can coexist in one graph while the rebuild earns the incumbent's
	// retirement on evidence. === parserDescriptor.ini standardName, EXACT (gate G-SOURCE); also the
	// _source on all 42,372 nodes and on every edge endpoint.
	standardSource: 'PESC260805',
	standardDisplayName: 'Postsecondary Electronic Standards Council (PESC) - pesc260805 rebuild',
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	// THE SHARED PERMISSIVE PATTERN, and the choice is MEASURED rather than defensive. PESC's
	// identity space is genuinely heterogeneous by design (design §4, rulings D-1..D-3):
	// content-addressed `pescArtifact:<sha256>`, namespace-qualified
	// `<targetNamespace>#<kind>/<localName>` where the namespace is a `urn:org:pesc:*` URN, and
	// positional descendants `.../el/<n>:<name>`, `/attr/<n>:<name>`, `/restriction/<n>`, `/anon/<n>`.
	// No single structured pattern describes that set without either lying or becoming a disjunction
	// of every emission site. MEASURED over all 42,372 stableIds in the entry block: ZERO contain
	// whitespace of any kind, ZERO carry leading or trailing whitespace, and 42,372 match ^\S+$ — so
	// the permissive pattern is the honest predicate here rather than a weakened one.
	// ⚠ `trimmed: true` is REDUNDANT under ^\S+$ (which already excludes all whitespace), exactly as
	// CEDS's declaration notes for its own ^https?://\S+$ — but this is the SHARED frozen constant
	// the framework exports for this case and inventing a local variant to drop one redundant flag
	// would be a gratuitous divergence inside a byte-identity phase.
	// ⚠ The registry comment at migrationAllowanceRegistry.js:37 says PESC "declares it under
	// allowance P10 in F3d". MEASURED: nothing in the tree gates this constant behind any allowance,
	// and no P10 row exists (the other P10 references are the bridge framework's unrelated RULING
	// P10). It is exported DATA and is declared here directly. Docketed as stale prose.
	stableIdPattern: PERMISSIVE_STABLE_ID_PATTERN,
	// PESC's root is addressed by a DECLARED literal (the bespoke ROOT_STABLE_ID), not by a
	// sourceUrl — PESC's root sourceUrl is '' (see P16). rootStableId is REQUIRED when
	// rootStableIdFrom is 'declared' and FORBIDDEN when it is 'sourceUrl'.
	rootStableIdFrom: 'declared',
	rootStableId: 'pesc260805:root',
	rootLabel: 'Pesc260805Root', // the root's per-standard label, and one of the nine in the census
	parserVersion: '1', // the root's parserVersion byte; NEVER licensed for omission (FR10)
	// DECLARED AND HONESTLY EMPTY, unlike SIF's populated one. Phase 2 of the PESC rebuild makes no
	// mapping claims: no CEDS anchors exist in XSD source, so the instruction is empty rather than
	// borrowed from a sibling. Six keys in THIS order — the JSON string is a block byte (G-JSONKEYS)
	// and it is reproduced character-for-character from the bespoke pescMappingInstruction.
	mappingInstruction: Object.freeze({
		cedsOriginalAnchorPropertyName: Object.freeze([]),
		cedsOptionOriginalAnchorPropertyName: Object.freeze([]),
		crosswalkPrefix: Object.freeze([]),
		crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
		includeInImplied: false,
		impliedTargets: Object.freeze([]),
	}),
	// EMPTY, and MEASURED rather than assumed. The bespoke embedNodes (forgePesc260805.js:634-637)
	// selects `nodes` with NO role filter whatever — every one of the 42,372 nodes is embedded,
	// including the root, which is why the root carries embeddingModelVersion in the block. CEDS
	// excludes three roles; PESC and SIF exclude none.
	nonEmbeddableRoleList: Object.freeze([]),
	// PESC has no CEDS anchor at all in this tier, so it has no "no mapping" sentinel to declare.
	// Empty is the honest declaration, not a placeholder.
	cedsAnchorAbsentSentinelList: Object.freeze([]),
	// the parser is DIRECTORY-bound (parserDescriptor.ini declares no sourceFile): it demands the
	// snapshot DIRECTORY — the 64-file XSD aggregate — and verifies that directory's SHA256SUMS
	// itself. There is no SECOND path for the framework to hand in.
	additionalSourceInputList: Object.freeze([]),
	// ---- COMPATIBILITY DECLARATIONS — FIVE, EACH MEASURED AGAINST THE ENTRY BLOCK ----------------
	// The framework REFUSES a declared-but-unneeded allowance BY NAME and refuses at the step in
	// question when one is undeclared-but-needed, so each precondition below was MEASURED on the
	// Phase 4 entry block rather than inherited. THREE OF THESE FOUR ROWS DID NOT EXIST BEFORE THIS
	// COMMIT, and THREE of them were already named in framework refusal prose that could never have
	// worked (contractGraphKit.js:223 "P9", rootNode.js:124 "P5: pescTier", contractGraphKit.js:310
	// "an active P4 edgeTypeAllowList") — because PESC was the only forge allowed to declare them.
	//
	//  P16  MET — describeSource returns sourceUrl ''. The root carries sourceUrl [""] in the entry
	//             block. The ONLY row F3a shipped for this bundle.
	//  P9   MET — 27,139 of the 42,372 nodes carry description ''. Checked against the property the
	//             forge COERCES (`description: documentation || ''`), not the property any prose
	//             names — the discipline S2 was corrected under in Phase 3. ZERO nodes carry name '',
	//             so 'name' is NOT declared; ZERO nodes lack a description property, so omitting was
	//             never available.
	//  P5   MET — the root carries pescTier 'meta'. The registry's FIRST offline-precondition row:
	//             the framework evaluates preconditions at describeSource and contractGraph only,
	//             and neither can observe a root extra property, so a forge-time predicate here
	//             would be a proxy. probeEvidence below is what the contract checks.
	//  P4   MET — SEVEN of PESC's TEN edge types are outside EDGE_TYPES, carrying 41,378 of the
	//             70,628 edges (58.6%): DECLARES 12,991 · RESOLVES_TO 17,706 · SAME_DEFINITION 10,400 ·
	//             MERGED_FROM 140 · IMPORTS 76 · IN_NAMESPACE 64 · SERVED_BY 1. Measured on the entry
	//             block. S6 is NOT the mechanism: substitution translates a native type INTO a
	//             registry member, and these are relations rather than synonyms — substituting them
	//             would collapse 41,378 edges onto one type.
	//  P17  MET — the root's version 'aggregate-01' differs from (selfDescribedVersion ?? 'unknown')
	//             = 'unknown', because describeSource returns selfDescribedVersion null. PESC is the
	//             SIF case, not the CEDS case: measured, CEDS 14.0.0.0/14.0.0.0/spec (genuinely
	//             self-describing) against SIF 1.0/unknown/unknown (declares S3) and PESC
	//             aggregate-01/unknown/unknown.
	//
	// NO E8-ANALOGUE IS DECLARED, and that is measured too: E8's precondition is "at least one
	// sourceFiles entry that is not a verified file". All 64 artifact filenames the root carries are
	// named in the snapshot's SHA256SUMS (64 of 64, zero missing), so every entry IS a verified file
	// and the precondition is NOT met. Declaring it would be the declared-but-unneeded defect.
	// NO S7-ANALOGUE either: sourceFiles has 64 entries, not zero.
	compatibilityDeclarationList: Object.freeze([
		Object.freeze({ allowanceId: 'P16' }),
		Object.freeze({
			allowanceId: 'P9',
			// the ONE property this forge coerces to '' — see the P9 note above for the measurement
			// and for why 'name' is deliberately absent from this list.
			coerceEmptyStringPropertyList: Object.freeze(['description']),
		}),
		Object.freeze({
			allowanceId: 'P5',
			// the ONE root extra this forge stamps; mustEqual pins it so a second per-standard root
			// property cannot be smuggled in under the same row.
			rootExtraPropertyNameList: Object.freeze(['pescTier']),
			// OFFLINE row: the contract checks the PRESENCE of this object, not its contents
			// (forgeDeclarationContract.js:178). The probe is the entry-gate measurement itself.
			probeEvidence: Object.freeze({
				probeName: 'phase4EntryBlockRootPropertyCensus',
				probeDate: '2026-08-29',
				probeResult:
					"the pesc260805:root node of block f139654a carries pescTier 'meta'; no other standard's root carries a tier marker",
			}),
		}),
		Object.freeze({ allowanceId: 'P17' }),
		Object.freeze({
			allowanceId: 'P4',
			// the seven relations the PESC graph model is built on, pinned EXACTLY and in this order by
			// the row's mustEqual: an eighth un-registered type emitted later is refused by name rather
			// than quietly admitted.
			edgeTypeAllowList: Object.freeze([
				'DECLARES',
				'IMPORTS',
				'IN_NAMESPACE',
				'MERGED_FROM',
				'RESOLVES_TO',
				'SAME_DEFINITION',
				'SERVED_BY',
			]),
		}),
	]),
});

// exported un-applied (a plain frozen object, no factory): the declaration is data
module.exports = pescForgeDeclaration;
