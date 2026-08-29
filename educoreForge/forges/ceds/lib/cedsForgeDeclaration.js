'use strict';

// cedsForgeDeclaration.js — H1 for the CEDS forge bundle (SPEC-forgeFramework-v1.md §4; the CEDS
// migration, hub-kit-role Phase 1). DATA, never code: the descriptor-shaped constants the bespoke
// forgeCeds.js carried inline (STANDARD_KEY :71, STABLE_URI_PROPERTY_NAME :72, HUB_NAME :85, the
// root's labels/standardName/parserVersion :468-500, emptyMappingInstruction :88-95, and the
// embeddable-role exclusion :829-833) written ONCE, in the framework's declared shape.
//
// Every value here is a BYTE of the CEDS block (09a5d658…) or an identity rule the framework
// enforces; none is derived. The pre-migration id is 09a5d658807b9c22b44b28289d9ad4b47df15e45f44c9-
// eacec765962fe487c33 at 419,649,468 and MUST be reproduced — the hub module cedsHubForge.js is not
// touched by this phase, so the provenance stamp that names it does not move.
//
// COMPATIBILITY DECLARATIONS: NONE. This is a measured result, not an omission. The FR6/FR7 probes
// were run for the first time at Phase 1 entry, against the 420MB Phase 0 CEDS block text rather
// than against the code's own comments, and they found:
//   * ZERO nodes carrying description ''  → no coercion row. NOTE: forgeCeds.js's own comment
//     asserted "27 option values carry a blank one"; that comment is FALSE against the emitted
//     bytes and is deliberately not carried forward. Declaring the row it implied would have been
//     worse than useless — the framework REFUSES a declared-but-unneeded allowance BY NAME, so the
//     build would have failed for a defect a stale comment invented.
//   * ZERO nodes carrying name ''         → no coercion row. Exactly FOUR of 119,805 nodes are
//     NAMELESS, which is ruling FR4's "CEDS's four foreign terms need NO allowance", confirmed by
//     measurement rather than inherited.
//   * sourceUrl is a real non-empty URL   → no sourceUrl row (unlike E6/S4/P16).
//   * sourceFiles is ['CEDS-Ontology.rdf'], which IS the single entry in the snapshot's SHA256SUMS
//                                          → step 4's FA5 cross-check passes on a VERIFIED file, so
//     no E8-style logicalSourceFileNameList row.
// A NEW row would also have to be added to MIGRATION_ALLOWANCE_REGISTRY, which is a framework edit;
// needing none is why this phase leaves lib/forge-framework untouched.

const path = require('path');
const { DME_ROLES } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

// STABLE_URI_PROPERTY_NAME — CEDS addresses every node by its source uri (forgeCeds.js:72, :195).
// It is ALSO mappingInstruction.crosswalkResolveProperty, so it is written once and read twice.
const STABLE_URI_PROPERTY_NAME = 'uri';

const cedsForgeDeclaration = Object.freeze({
	standardKey: 'ceds',
	standardSource: 'CEDS', // === parserDescriptor.ini standardName, EXACT (gate G-SOURCE); also the
	// _source on all 119,805 nodes, and === hubName, which is what SPEC I12 asserts
	standardDisplayName: 'Common Education Data Standards', // the root's standardName byte (:481)
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	// the REAL predicate, verbatim from normalize.js:74 CEDS_URI_RE, as data (FR6).
	// trimmed:false is the EXACT reproduction of isCleanStableId (normalize.js:75-76), which applies
	// no trim step. The kit's trimmed:true would add only `stableId === stableId.trim()`, a condition
	// `\S+` already subsumes — the two are PROVABLY equivalent for THIS pattern, not merely equivalent
	// on today's data — so `false` is chosen as the honest transcription rather than the sibling idiom.
	// Measured at Phase 1 entry over every stableId in the block: 0 fail the pattern, 0 carry whitespace.
	stableIdPattern: Object.freeze({ pattern: '^https?://\\S+$', trimmed: false }),
	// CEDS's root is addressed by its sourceUrl, NOT by a declared id (forgeCeds.js:469
	// `stableId: metadata.sourceUrl`). rootNode.js:44-55 names CEDS by name for this branch, and
	// rootStableId is FORBIDDEN when rootStableIdFrom is 'sourceUrl', so it is absent here.
	// The bespoke root ALSO carried `_id: 'ceds:root'`, which differs from its stableId. That is
	// BYTE-INVISIBLE and the framework's `_id: stableId` is therefore neutral — measured, not assumed:
	// replay-engine.js:111 overwrites _id at load AND replay-engine.js:353 EXCLUDES _id from the
	// harvested block text entirely, and the string "_id" occurs ZERO times in the 420MB CEDS block.
	rootStableIdFrom: 'sourceUrl',
	rootLabel: 'CedsOntology', // the root's per-standard label (:468)
	parserVersion: '1', // the root's parserVersion byte (:494) — CEDS's is '1', not Ed-Fi's '2'
	// DECLARED present-but-unpopulated for CEDS (DECISIONS §12; forgeCeds.js:88-95). Six keys in
	// THIS order — the JSON string is a block byte (G-JSONKEYS).
	mappingInstruction: Object.freeze({
		cedsOriginalAnchorPropertyName: Object.freeze([]),
		cedsOptionOriginalAnchorPropertyName: Object.freeze([]),
		crosswalkPrefix: Object.freeze([]),
		crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
		includeInImplied: true,
		impliedTargets: Object.freeze(['CEDS']),
	}),
	// the three roles forgeCeds.js:829-833 excluded from the embedding pass. They carry NO
	// searchText at all, which the kit reproduces by omitting it for a non-embeddable role. The
	// reason is load-bearing and is the source's own: there is ONE vector index in the published
	// graph, golden_vector on :ForgedNode(embedding), so anything embedded becomes a semantic-search
	// result — a search for "school" must never start returning changelog entries.
	nonEmbeddableRoleList: Object.freeze([
		DME_ROLES.EDIT_HISTORY_ENTRY,
		DME_ROLES.RESTRICTION,
		DME_ROLES.VOCABULARY_TERM,
	]),
	// CEDS has no "no mapping" sentinel: it is the hub, so an unnormalizable anchor is a REFUSAL
	// (R3, forgeCeds.js:139-153), never an absence. Empty is the honest declaration.
	cedsAnchorAbsentSentinelList: Object.freeze([]),
	// the parser is FILE-bound on one file (parserDescriptor.ini sourceFile=CEDS-Ontology.rdf) and
	// consumes nothing beside it.
	additionalSourceInputList: Object.freeze([]),
	compatibilityDeclarationList: Object.freeze([]), // NONE — see the header block for the probes
});

// exported un-applied (a plain frozen object, no factory): the declaration is data
module.exports = cedsForgeDeclaration;
