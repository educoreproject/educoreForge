'use strict';

// pescCedsDerivedPlugin.js — the PESC → CEDS DERIVED producer, PROPERTY TIER.
// LUNAR_PRISM (P1), supervisor SABLE_RIVER. PLAN-pescDerivedBridge-v1.md; BRIEF-P1-pescPlugin.md;
// PLAN-derivedBridge-v1.md §11 (the twelve derived rulings, which BIND).
//
// THE THIRD MATCH BASIS AND THE FOURTH PLUGIN THROUGH ONE UNCHANGED SEAM. B3 proved `crosswalk`,
// B4 proved `standard`, D1–D4 proved `derived` on Ed-Fi. This proves `derived` on a SECOND standard
// AND — with its option-set sibling — that the seam is not tied to ONE SUBJECT SHAPE either.
// ZERO framework change is the proof, exactly as it was for SIF.
//
// WHY DERIVED AND NOT STANDARD, measured before any builder was briefed: PESC declares NO CEDS
// anchor anywhere. `grep -oiE '\bceds\b|cedsId|CEDS ID'` over all 64 source XSDs → ZERO word-boundary
// hits. (A naive substring grep returns 62 lines and every one is `cedStanding` or
// `cedSubjectCreditCodeType` — "ced" inside another word. That artifact is the same genus as the
// §5.3 "ten ceds mentions" that were all the single word "AdvancedStanding", and as the 97.5%
// option-set substring hit I caught in my own measurement. THIS CORPUS PUNISHES COUNTING A MATCH
// WITHOUT READING IT.) No authored crosswalk, no declared id → `matchBasis: derived`.
//
// IT DECLARES NO HOOKS. A derived producer has no document to walk and a graph-sourced subject is
// its own stableId, so SOURCE_ACQUISITION_REGISTRY.derived forbids both mandatory hooks and this
// file is a declaration and nothing else — pure DATA. Same shape as edfiCedsDerivedPlugin.js.
//
// COMPANION FILES, all under this bundle and all DATA:
//   bridgeData/pescDerivedDedupRule.json      — the ruled scope and the FOUR measured alternatives
//                                               (RULING P0b-R2). It is not in the declaration below
//                                               because the declaration's key set is CLOSED and
//                                               refuses unknown keys by name (bridgePluginContract.js:954).
//   bridgeData/pescDerivedConceptScope.json   — the 2,213 representative stableIds
//   bridgeData/pescDerivedConceptFanOut.json  — representative → its group's members (RULING P1-R3)
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE VALUE TIER IS IN SCOPE FOR THIS ORDER AND IS SERVED BY A SIBLING PLUGIN — NOT ABSENT.
// Stated here IN WORDS because an omission that is not declared is indistinguishable from an
// oversight, and the next builder would read silence as "not in scope". TQ ruled the value tier IN
// ("map everything — all the juice squeezed from the orange"). Its 156 latest-reachable option-set
// concepts are subjects of pescOptionSetCedsDerivedPlugin.js, which retrieves against the SAME
// property-tier hub cards this plugin does.
//
// WHY A SIBLING RATHER THAN A SECOND subjectSource HERE: `subjectSource` takes ONE label, singular
// ([code fact] bridgePluginContract.js:695; bridge-framework.js:896 filters on that one label). The
// property-tier subjects are `PescElementDecl`; the option-set subjects are `PescNamedDefinition`.
// Two labels cannot ride in one declaration without a framework change.
//
// AND WHY BOTH RETRIEVE AGAINST PROPERTY CARDS — a fact TQ did not have when he ruled, and now does:
// THE FRAMEWORK CANNOT READ VALUE-TIER CARDS AT ALL, and that is a REFUSAL rather than a gap.
// [code fact] bridge-framework.js:78 `const PROPERTY_TIER = 'property'`, passed as a MODULE LITERAL
// at :951 (retrieval) and :567 (card read) — never read from a declaration. graphSeamRules.js:146
// refuses a card of another tier BY NAME; :369 refuses a mapping edge to a value-tier card BY NAME;
// and gate BG-VALUE (c) with its `seamAdmitsValueObject` twin PROVES that refusal fires. Mapping to
// a CEDS value card is therefore not a plugin away — it is three framework edits away, one of which
// DELETES A PROOF THE FRAMEWORK CURRENTLY MAKES. Recorded on the after-PESC docket; NOT attempted here.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const bridgeDeclaration = Object.freeze({
	bridgeName: 'pescCedsDerivedPlugin',
	// MUST equal the bundle directory name (BR-009, pluginRegistry.js:48).
	standardKey: 'pesc260805',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	// PESC'S OWN PUBLISHED NAMESPACE, taken from the standard's own bytes rather than minted by us.
	// Every artifact in the corpus declares `targetNamespace="urn:org:pesc:{codes|core|sector|message}:NAME:vN"`
	// and the forge's parser REFUSES BY NAME any file that does not match that pattern
	// ([code fact] forges/pesc260805/lib/parser.js:40, :547) — so the prefix is enforced, not assumed.
	// (Contrast edfiCedsDerivedPlugin, which mints `urn:educore:edfi:` because Ed-Fi publishes no
	// URN scheme of its own.)
	sourceCuriePrefix: { prefix: 'pesc', iri: 'urn:org:pesc:' },
	subjectCuriePrefix: 'pesc',
	// EMPTY, and required to be. Nothing is walked. This one line is the whole of BG-NOCROSSWALK's
	// mechanism: a producer that opens no file cannot have read the answer out of one. It is also
	// why no `mappingProvider` appears below — FORBIDDEN when matchBasis is derived (§11.7 (c)),
	// because nobody authored these mappings.
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	// SUBJECTS ARE GRAPH NODES (§11.11), narrowed to the 2,213 CONCEPT REPRESENTATIVES of TQ's ruled
	// scope (a′). The scope list is DATA ON DISK and the framework refuses a scope that has drifted
	// from its graph rather than silently intersecting (bridge-framework.js:930) — so a stale scope
	// stops the build instead of quietly reporting a smaller population as a complete one.
	//
	// THE CAVEAT THAT TRAVELS WITH THIS LINE, and it is not decoration: a dedup group can contain
	// MORE THAN ONE DISTINCT EMBEDDED TEXT (369 of 2,222 groups do), so the lowest-stableId
	// representative SILENTLY DECIDES WHICH VECTOR THE WHOLE GROUP RETRIEVES ON. Recording the pool
	// with the fan-out makes that AUDITABLE; it does not make it CORRECT. THE REPRESENTATIVE'S POOL
	// IS A CHOICE THE DATA MADE FOR US, NOT A PROPERTY OF THE GROUP. See pescDerivedDedupRule.json.
	subjectSource: { kind: 'graphLabel', label: 'PescElementDecl', scopeStableIdListPath: 'bridgeData/pescDerivedConceptScope.json' },
	// K AND THE FLOOR — MEASURED FOR THIS TIER, AND THE QUALIFICATION IS THE POINT.
	// REPORT-P0 §4.2 measured over the whole PESC subject vector space (a CENSUS, not a sample —
	// 1,909 distinct searchText values ARE the entire space): at floor 0.30, ZERO subjects have an
	// empty pool and the mean pool is 14.99 of 15. So the floor discards NOTHING and the judged count
	// equals the subject count. K = 15 because the pool is very flat (median top-1→top-15 spread
	// 0.065), so a larger K buys little and a smaller one risks the ceiling.
	// BOTH FIGURES ARE PROPERTY-TIER MEASUREMENTS. They are honest for every subject this plugin
	// declares, because every candidate it can ever see is a property-tier card.
	candidateRetrieval: { k: 15, floor: 0.3, embeddingModelVersion: 'voyage-4-large' },
	// THE BIAS AUDIT (§4, RULING §11.4). An ALLOW-list, so it excludes what nobody thought of.
	//
	// SUBJECT SIDE — and two names here are STAMPED BY THE FORGE for this seat (RULING P1-R8):
	//   effectiveDescription  THE MANDATORY SEAT. The element's own prose, or its RESOLVES_TO type's.
	//                         Measured on the shipped artifact: own 5,481 + resolvedType 6,426 =
	//                         11,907 of 16,969 = 70.17% coverage, against 31.6% for own-prose alone.
	//                         It could NOT be reached by a declaration before being stamped: the
	//                         evidence path is a pure filter over one flat property bag
	//                         (evidenceRenderer.js:134) with no edge traversal anywhere.
	//   owningTypeName        ALSO STAMPED, and it REPAIRS a recipe that silently stopped working:
	//                         REPORT §5.4 says to parse the owning type from searchText, but after
	//                         the C2 hybrid a prose-bearing declaration's searchText is
	//                         `ElementName | effectiveDescription` and NO LONGER CONTAINS IT.
	//
	// `description` IS DELIBERATELY NOT NAMED. It would be pure duplication: where prose is the
	// element's own (5,481 nodes) description and effectiveDescription are the SAME STRING, and where
	// it is borrowed (6,426) description is empty and the renderer omits it anyway. Naming both pays
	// twice for the same tokens on 5,481 subjects and adds nothing on any. `documentation` is likewise
	// never named — it is BYTE-IDENTICAL to `description` on all 17,491 declarations (the forge emits
	// one value under two names), so it is pure token waste.
	// `proseSource` is stamped but NOT rendered: it is for the census and the rendering audit, not
	// for the judge, which is why it is absent from this list and present on the node.
	//
	// CANDIDATE SIDE — `rangeOptionSetDefinition` IS DELIBERATELY NOT NAMED (RULING P1-R6). I measured
	// it BYTE-IDENTICAL to `propertyDefinition` on 1,149 of the 1,207 option-set-bearing cards (95.2%),
	// which is the hub-side mirror of PESC's own documentation/description duplication. Of the pair,
	// `propertyDefinition` is named because it is the more universal: non-empty on 2,774 of 2,777
	// cards against 1,207. `rangeOptionSetName` IS named — it is a NAME, not a definition, it is not
	// duplicated by anything, and it is what makes a card's value-domain visible to the judge.
	// Absent is absent: a card lacking propertyDefinition (exactly 3 of 2,777) simply omits the line.
	renderingAllowList: {
		subject: ['name', 'owningTypeName', 'typeAsWritten', 'effectiveDescription'],
		candidate: ['name', 'propertyDefinition', 'domainName', 'domainDefinition', 'rangeOptionSetName'],
	},
	judgePromptVariant: 'derived',
	// THE V1 APPROXIMATION, NAMED AS SUCH (§11.7 (a)) — identical to the Ed-Fi derived table, on
	// purpose: two standards through one seam should not quietly differ in how a category becomes a
	// relation. The judge's return carries no predicate slot, so the relation is derived from its
	// CONFIDENCE CATEGORY through this table, stamped `predicateRule: 'categoryTable-v1'` inside the
	// block's content address so a later judge with a real predicate slot RE-MEASURES rather than
	// silently differing under the same story.
	predicateByCategory: { strong: 'exactMatch', moderate: 'closeMatch', weakButReal: 'closeMatch' },
	predicateSource: { kind: 'judge', predicateRule: 'categoryTable-v1' },
	// THE PRODUCER, in place of a mapping PROVIDER. Nobody authored these mappings.
	mappingTool: { name: 'educoreForge bridge-framework derived', version: '1.0.0' },
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	remodelTableRef: null,
	classSideRemodelTable: [],
	// The SAME list both sibling plugins declare, so the blinding reads as one contract rather than
	// two dialects. Belt AND braces: the allow-list already makes these unreachable by the renderer,
	// and this removes them at the seam — two independent mechanisms, because the value of an audit is
	// that one of them failing is visible. MEASURED CLEAN on the PESC side: `crossRefs` is empty on
	// EVERY PESC node on BOTH labels, and no PESC field carries anything shaped like a CEDS identifier
	// (\b[PCOSV]\d{5,}\b → ZERO). So an id-gate hit anywhere in P2 is a REAL FINDING, not noise.
	blindingDeclaration: ['cedsId', 'crossRefs', 'cedsOriginalAnchorPropertyName', 'cedsOptionCode', 'cedsOptionOriginalAnchorPropertyName'],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

// NO HOOKS. Both mandatory hooks are FORBIDDEN on a derived basis — see the header.
const bridgeHooks = {};

module.exports = { bridgeDeclaration, bridgeHooks };
