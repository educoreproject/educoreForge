'use strict';

// sifForgeDeclaration.js — H1 for the SIF forge bundle (SPEC-forgeFramework-v1.md §4; the SIF
// migration, hub-kit-role Phase 3). DATA, never code: the descriptor-shaped constants the bespoke
// forgeSif.js carried inline (STANDARD_KEY :61, STANDARD_SOURCE :62, STANDARD_DISPLAY :63,
// STABLE_URI_PROPERTY_NAME :64, ROOT_STABLE_ID :192, the root's label/parserVersion :373/:398, and
// sifMappingInstruction :118-126) written ONCE, in the framework's declared shape.
//
// Every value here is a BYTE of the SIF block or an identity rule the framework enforces; none is
// derived.
//
// THE ID THIS FILE MUST REPRODUCE:
//   I3 = d393b0406d08f613f3142711fca5a9f2b0c580e84c4bef3ffd6b18d4eaa2330a at 56,395,535 characters,
//   subject sif@unknown_01_base. It was re-forged on UNCHANGED code at Phase 3 entry (the null
//   experiment) and reproduced exactly, which is what licenses it as this migration's oracle.
//
// ⚠ NINE SIF EDGES COLLAPSE UNDER MERGE AT LOAD — 88,766 in, 88,757 harvested. That delta is BAKED
// INTO d393b040… and is NOT this phase's to fix. Node counts are exact both ways (27,069 → 27,069),
// so invariant I11 is unaffected. Docketed since Phase 0 with a candidate cause nobody has verified.
// "Fixing" it here would move I3 and destroy the oracle.

// STABLE_URI_PROPERTY_NAME — SIF addresses every node by its own synthetic stableId
// (forgeSif.js:64, :354). It is ALSO mappingInstruction.crosswalkResolveProperty, so it is written
// once and read twice, exactly as CEDS's 'uri' is.
const STABLE_URI_PROPERTY_NAME = 'sifStableId';

// the native annotation column the CEDS anchor is read from (forgeSif.js:65). Recorded as the
// mappingInstruction's declared origin, and carried on every annotated field as its crossRef locator.
const CEDS_ANCHOR_PROPERTY_NAME = 'CEDS ID';

const sifForgeDeclaration = Object.freeze({
	standardKey: 'sif',
	standardSource: 'SIF', // === parserDescriptor.ini standardName, EXACT (gate G-SOURCE); also the
	// _source on all 27,069 nodes and on every edge endpoint
	standardDisplayName: 'SIF Implementation Specification', // the root's standardName byte (:391)
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	// the REAL predicate, verbatim from normalize.js:63 SIF_STABLE_ID_RE, as data (FR6).
	//
	// trimmed:TRUE — AND THIS IS THE OPPOSITE OF CEDS'S, FOR A MEASURED REASON RATHER THAN BY
	// IMITATION. normalize.js:64-68 isCleanStableId applies `value === value.trim()` as a genuine
	// separate condition, because the pattern's `(/.+)?` DOES admit whitespace — unlike CEDS's
	// `^https?://\S+$`, whose `\S+` already subsumes the trim check, which is why CEDS declares
	// `false`. Measured over every stableId in the entry block: 36 SIF stableIds carry INTERNAL
	// whitespace (legitimate — they are codeset fingerprints and xpath-derived keys), and ZERO carry
	// leading or trailing whitespace. Declaring `false` here would silently widen the predicate.
	stableIdPattern: Object.freeze({ pattern: '^sif:[A-Za-z]+(/.+)?$', trimmed: true }),
	// SIF's root is addressed by a DECLARED literal (forgeSif.js:192 `ROOT_STABLE_ID = 'sif:root'`),
	// not by a sourceUrl — SIF has no sourceUrl at all (see the S4 row below). rootStableId is
	// REQUIRED when rootStableIdFrom is 'declared' and FORBIDDEN when it is 'sourceUrl'.
	rootStableIdFrom: 'declared',
	rootStableId: 'sif:root',
	rootLabel: 'SifRoot', // the root's per-standard label (:373)
	parserVersion: '1', // the root's parserVersion byte (:398)
	// DECLARED and POPULATED for SIF, unlike CEDS's empty one: SIF bridges TO the CEDS hub, and its
	// native anchor origin is the 'CEDS ID' TSV column. Six keys in THIS order — the JSON string is a
	// block byte (G-JSONKEYS).
	mappingInstruction: Object.freeze({
		cedsOriginalAnchorPropertyName: Object.freeze([CEDS_ANCHOR_PROPERTY_NAME]),
		cedsOptionOriginalAnchorPropertyName: Object.freeze([]),
		crosswalkPrefix: Object.freeze([]),
		crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
		includeInImplied: true,
		impliedTargets: Object.freeze(['CEDS']),
	}),
	// EMPTY, and MEASURED rather than assumed. The bespoke embedNodes (forgeSif.js:696-703) selects
	// `nodes` with NO role filter whatever — every one of the 27,069 nodes is embedded, including the
	// root. CEDS excludes three roles; SIF excludes none. An empty list is the honest declaration and
	// the framework's embedPass reproduces the bespoke behaviour exactly.
	nonEmbeddableRoleList: Object.freeze([]),
	// embed-text lists — TQ decision 1 (PLAN-forgeEmbedText-091426 §8.2), label verbatim (R-ET-15). List
	// order is the derivation's iteration order. Oracle (R-ET-17, evidence/P1-textListCensus-v2.log):
	// 3,855 text nodes / 27,700 EMBEDS_TEXT_OF edges (27,697 single-name, 3 multi-name); 5,929 empty
	// descriptions skipped and counted, none absent, none trimmed. Declaring this MOVES the SIF proxy and
	// block id (re-pinned by the supervisor after P9), by design.
	embedTextDeclaration: Object.freeze({
		embedTextLabel: 'SifEmbedText',
		textPropertyListByRole: Object.freeze({
			DmeClass: Object.freeze(['name', 'description']),
			DmeProperty: Object.freeze(['name', 'description']),
			DmeOptionSet: Object.freeze(['name', 'description']),
		}),
	}),
	// SIF has no "no mapping" sentinel: normalize.js normalizeCedsCrossRef either extracts a digit
	// core or RETURNS AN ERROR (which the walk turns into a refusal, R3) — there is no third,
	// absent-by-sentinel branch. An unannotated field simply carries no cedsId at all, which the
	// framework handles as absence rather than as a sentinel. Empty is the honest declaration.
	cedsAnchorAbsentSentinelList: Object.freeze([]),
	// the parser is DIRECTORY-bound (parserDescriptor.ini declares no sourceFile). It resolves BOTH
	// the Implementation-Specification TSV and refIdResolutionMap.tsv from inside that one snapshot
	// directory itself (parser.js:496-512), verifying the directory's SHA256SUMS first. So there is
	// no SECOND path for the framework to hand in, and the bespoke forge's `resolutionMapPath`
	// argument was never passed by the seam in production — the forger passes exactly
	// { sourcePath, owner, embedNodeLimit, skipEmbedding } (forger.js:904). The framework REFUSES an
	// unknown seam argument by name and its refusal text names this very case; the loader keeps the
	// resolution where the parser already had it.
	additionalSourceInputList: Object.freeze([]),
	// ---- COMPATIBILITY DECLARATIONS — THREE, EACH MEASURED, TWO DELIBERATELY ABSENT --------------
	// The framework REFUSES a declared-but-unneeded allowance BY NAME and refuses at the step in
	// question when one is undeclared-but-needed, so each precondition below was MEASURED against the
	// Phase 3 entry block rather than inherited. (This is the CEDS lesson: forgeCeds.js's own comment
	// claimed 27 blank descriptions that the emitted bytes say do not exist, and declaring the row it
	// implied would have failed the build for a defect a stale comment invented.)
	//
	//  S3  DROPPED  — RETIRED FROM THIS DECLARATION 2026-08-31 (versionFromStamp order). It read:
	//                 describeSource returns version '1.0' while selfDescribedVersion is null, so the
	//                 root's version differs from (selfDescribedVersion ?? 'unknown'). BOTH HALVES OF
	//                 THAT ARE GONE: describeSource no longer returns a version at all and the parser's
	//                 hard-coded '1.0' is deleted, so there is no declared version left to disagree
	//                 with anything and nothing to permit.
	//                 NOTE THE ROUTE: the row's own retiredBy prose names a DIFFERENT one — "SIF's
	//                 parser reports a real source version (or the root carries 'unknown')" — and
	//                 neither limb is true here. The declaration disappeared instead. The ROW itself
	//                 was DELETED in Phase 4 (2026-09-01), together with PESC's P17 and their shared
	//                 versionDisagreementRow factory. The two gates that depended on it were REWRITTEN
	//                 AGAINST THE NEW GUARD IN THE SAME PHASE — refuseVersionDisagreement, which is
	//                 STRICTER: the rows PERMITTED a declared-vs-resolved divergence, the guard FORBIDS
	//                 it, and no allowance can suppress it.
	//  S4  MET      — describeSource returns sourceUrl ''. The parser's metadata carries no sourceUrl
	//                 at all (parser.js:942-955), which the root stamps as '' (:394).
	//  S7  MET      — describeSource returns sourceFiles []. Same cause; the root stamps [] (:394).
	//
	//  S2  MET, AND DECLARED — BUT I GOT THIS WRONG FIRST AND THE ERROR IS WORTH MORE THAN THE FIX.
	//      My Phase 3 entry report said S2 must NOT be declared, "because ZERO of the 27,069 nodes
	//      carry name ''". THE MEASUREMENT WAS RIGHT AND THE CONCLUSION WAS WRONG: I checked the
	//      property S2's PROSE NAMED rather than the property this forge actually COERCES. The
	//      bespoke module stamps BOTH on adjacent lines — `name: name == null ? '' : ...` at :350 and
	//      `description: description || ''` at :351 — and S2 was authored against the FIRST while SIF
	//      only ever needed the SECOND. Re-measured over the same 27,069 nodes: 0 carry name '',
	//      16,181 carry description '', spread across ALL EIGHT non-root labels, and every node has a
	//      description property. Reading a row's description is not reading what the code does.
	//      The framework CAUGHT this rather than absorbing it: contractGraphKit.js:221-226 refused
	//      `description is ''` by name on the very first node of an in-process run, before any
	//      re-forge was spent. A silent default would have dropped 16,181 '' bytes and moved I3 with
	//      nothing to chase. S2's own contract said mustEqual ['name'], so it could not license
	//      'description' — a framework authoring error, corrected under RULING FJ-P3-2 with a ledger
	//      line, and NOT widened to ['name','description'] because a coercion measured never to fire
	//      is exactly what this registry refuses.
	//  S6  NOT MET, DELIBERATELY UNDECLARED — its precondition is "substitutionCount > 0", which is
	//      only reached when the walk hands kit.addEdge a type OUTSIDE EDGE_TYPES for the declared
	//      parentEdgeSubstitutionTable to translate. MEASURED by parsing the real snapshot
	//      in-process: `_parentEdge.type` is 'HAS_FIELD' for all 15,620 parent edges — the ONLY value
	//      that occurs — and every one of the ten outgoing native types is in the walk's translation
	//      table, so the bespoke `canonical || EDGE_TYPES.REFERENCES` alternative at :652 NEVER
	//      FIRES. Routing native types through the substitution table purely to satisfy the
	//      precondition would be MANUFACTURING the condition that justifies the allowance, which is
	//      circular. The walk instead translates explicitly through a REFUSING lookup — which is
	//      S6's own declared end state ("retiredBy: refuse the unknown type → byte-neutral").
	compatibilityDeclarationList: Object.freeze([
		Object.freeze({
			allowanceId: 'S2',
			// the ONE property this forge coerces to '' — see the S2 note above for the measurement
			// and for the error I made reading the row's prose instead of the code.
			coerceEmptyStringPropertyList: Object.freeze(['description']),
		}),
		Object.freeze({ allowanceId: 'S4' }),
		Object.freeze({ allowanceId: 'S7' }),
	]),
});

// exported un-applied (a plain frozen object, no factory): the declaration is data
module.exports = sifForgeDeclaration;
