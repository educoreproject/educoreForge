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
// ("map everything — all the juice squeezed from the orange"). Its **223** latest-reachable
// option-set concepts (RULING P1-R13 — NOT the 156 of PLAN §1-A, whose key omitted the rendered
// `description` and left 43% of its groups internally impure) are subjects of
// pescOptionSetCedsDerivedPlugin.js, which retrieves against the SAME property-tier hub cards this
// plugin does.
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

// ⟪hub-neutral bridge lane R3, 2026-10-21⟫ MIGRATED from pescCedsDerivedPlugin.js (facet '') and pescOptionSetCedsDerivedPlugin.js (facet OptionSet): this file now declares the STANDARD half of the
// bridge; the hub half comes from the hub's own bridging declaration (forges/<hub>/lib/<hub>HubBridging.js) and the two compose
// (lib/bridge-framework/bridgeComposer.js) into the SAME declaration, digest for digest (test-bridgeComposer (a), P-a1).


// ==== FACET OptionSet — the header of pescOptionSetCedsDerivedPlugin.js, kept ====
// pescOptionSetCedsDerivedPlugin.js — the PESC → CEDS DERIVED producer, VALUE TIER SUBJECTS.
// LUNAR_PRISM (P1), supervisor SABLE_RIVER. RULING P1-R2 (two plugins, one seam), P1-R5 (relatedMatch
// plus its recorded understatement), P1-R6 (name one of the duplicated definition fields), P1-R7.
//
// THIS FILE IS THE PHASE'S SHARPEST CLAIM. B3 proved `crosswalk`, B4 proved `standard`, D proved
// `derived` — three MATCH BASES through one unchanged seam. THIS PROVES THE SEAM IS NOT TIED TO ONE
// SUBJECT SHAPE EITHER: a SECOND SUBJECT LABEL, `PescNamedDefinition`, through the same seam, with
// ZERO framework bytes. SABLE_RIVER adopted that framing: "a second subject LABEL through the same
// seam tests the seam harder than a second standard did."
//
// ─── WHY THIS EXISTS AS A SEPARATE FILE ──────────────────────────────────────────────────────────
// `subjectSource` takes ONE label, singular ([code fact] bridgePluginContract.js:695; consumed at
// bridge-framework.js:896). The property tier's subjects are `PescElementDecl`; these are
// `PescNamedDefinition`. Two labels cannot ride in one declaration without a framework change, so
// TQ's "map everything — all the juice squeezed from the orange" ruling is honoured by a SIBLING,
// not by a wider declaration.
//
// ─── WHAT THESE SUBJECTS RETRIEVE AGAINST, AND WHY IT IS NOT THE VALUE-TIER CARDS ────────────────
// They retrieve against the SAME 2,777 PROPERTY-tier hub cards the sibling uses, because THE
// FRAMEWORK CANNOT READ VALUE-TIER CARDS AT ALL. That is a REFUSAL, not a gap: PROPERTY_TIER is a
// module literal (bridge-framework.js:78) passed at :951 and :567 and never read from a declaration;
// graphSeamRules.js:146 refuses an off-tier card BY NAME; :369 refuses a mapping edge to a value-tier
// card BY NAME; and gate BG-VALUE (c) with its `seamAdmitsValueObject` twin PROVES that refusal
// fires. TQ ruled the value tier in without that price in front of him and now has it.
//
// THE SEMANTIC CASE, MEASURED BEFORE IT WAS RELIED ON (SABLE_RIVER's condition 1):
//   1,207 of 2,777 property cards (43.5%) carry a non-empty rangeOptionSetName AND
//   rangeOptionSetDefinition — they co-occur exactly. Control: propertyDefinition non-empty on 2,774,
//   i.e. absent on exactly 3, independently reproducing the figure already on the record, which is
//   what says the counter works rather than that a number was produced.
//   ⚠️ AND A CORRECTION I MADE TO MYSELF, kept here because the count survives and the reading did
//   not: rangeOptionSetName appears SOMEWHERE in embedText on 1,177 of 1,207 (97.5%), which LOOKS
//   like "the option set is in the vector" and IS A SUBSTRING ARTIFACT — CEDS names these properties
//   `Has <OptionSetName>`, so the name sits inside the PROPERTY NAME by convention. Measuring
//   POSITION rather than EXISTENCE decomposes the same 1,207 into 1,172 INCIDENTAL and 31
//   INDEPENDENT, of which 30 are ABSENT FROM THE VECTOR ENTIRELY. Same number, opposite meaning.
//   See test/probes/p1_optionSetInVector.js (retained AS the artifact-producing first attempt) and
//   p1_optionSetVectorPart.js (the correction).
//
// ─── THE LIMITATION THAT TRAVELS WITH EVERY NUMBER THIS PLUGIN PRODUCES ──────────────────────────
// THESE SUBJECTS ARE EMBEDDED ON THE COMPOSITION THIS ORDER ALREADY MEASURED AS THE LOSER. Measured:
// their searchText is `CoreMain v1.13.0 | AccreditationTypeType` — an artifact-and-version prefix
// REPORT-P0 §4.1 called "pure noise" — mean 42.5 chars, max 72. Their descriptions average 183
// characters and are THE RICHEST PROSE IN THE STANDARD, and they are NOT IN THEIR VECTORS AT ALL.
// TQ authorised a re-embed to fix exactly this defect and P0b implemented it FOR PROPERTY-ROLE
// DECLARATIONS ONLY. Extending it here is a NEW forge change and a NEW authorisation, and it is his.
// P2's census emits these subjects' REAL pools, reported SEPARATELY from the property tier's and
// NEVER POOLED — two populations on two differently-shaped compositions are not mutually comparable,
// and that standing rule has bitten this order in three different forms already.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const propertyDeclarationTemplate = Object.freeze({
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
	// ⚠️ THIS PREFIX IS A SHAPE-FITTING DEVICE SATISFYING A startsWith CHECK. IT IS NOT A NAMESPACE
	// CLAIM, AND A READER MUST NOT TAKE IT AS ONE. Recorded as data by RULING P2-R1 because without
	// this note a future reader takes the declaration at face value, which is precisely the harm.
	//
	// (1) PESC'S stableIds ARE URNs; Ed-Fi's AND SIF's ARE CURIEs. The whole proof is one query:
	//         sif:field//AccountingPeriods/AccountingPeriod/@RefId          <- CURIE
	//         edfi:property/abstractEntity.EducationOrganization.Address    <- CURIE
	//         urn:org:pesc:core:CoreMain:v1.0.0#complexType/...             <- A URN
	//     PESC mints URNs CORRECTLY: urn:org:pesc:* is its OWN published namespace, enforced by its
	//     parser's refusal ([code fact] forges/pesc260805/lib/parser.js:40, :547).
	// (2) THE EXPORTER ASSUMES THE CURIE SHAPE and says so in its own comment ([code fact]
	//     lib/bridge-framework/sssomExporter.js:194-198): "a forged id already carries its standard's
	//     prefix (`toy:property/...`, `<standard>:property/...`); prepending would double it". Its rule
	//     is a literal indexOf(prefix + ':') !== 0 -> REFUSE. The assumption held for three standards
	//     and is wrong in general; PESC is simply the first to prove it. Docketed as framework defect
	//     item 14 — NOT repairable here, and lib/bridge-framework/ is this order's hard line.
	// (3) SO THE VALUE BELOW IS CHOSEN TO SATISFY THAT startsWith, NOT TO DECLARE A CURIE PREFIX.
	//     MEASURED against the exporter's own predicate with four real stableIds
	//     (test/probes/p2_curiePrefixCandidates.js): 'pesc' passes 0 of 4 — the defect this replaces;
	//     'urn' passes 4 of 4 but asserts the namespace is THE URN SCHEME, which is false of every URN
	//     ever minted; 'urn:org:pesc' passes 4 of 4 AND names PESC's actual org namespace.
	//     THE SUBJECT ID ITSELF IS VERBATIM AND HONEST — urn:org:pesc:... is a valid IRI and SSSOM
	//     permits a full IRI as subject_id. Only the PREFIX LABEL is a fitting device, which is a far
	//     narrower thing than the choice first appeared to be.
	subjectCuriePrefix: 'urn:org:pesc',
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
	classSideRemodelTable: [],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

const optionSetDeclarationTemplate = Object.freeze({
	standardKey: 'pesc260805',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	// THE ONE KIT EDIT OF PHASE 7, AND IT IS A DECLARATION RATHER THAN A CODE CHANGE. This plugin and its
	// property-tier sibling pescCedsDerivedPlugin share BOTH a standard pair (ceds ← pesc260805) AND a
	// producerKind ('inferred'), so both compose the subject
	// 'ceds@14.0.0.0_rel_pesc260805@aggregate-01_close' and the manifest editor refuses the second — after
	// the colliding bridge's whole judge run. Declaring a discriminator appends '~optionSet' AFTER the
	// producer suffix, giving this tier its own subject and its own relationship block.
	//
	// IT IS THE ONLY PLUGIN IN THE TREE THAT DECLARES ONE, AND THAT IS THE DESIGN, NOT AN OVERSIGHT. The
	// key is opt-in: the other four declare nothing, compose exactly the strings they composed before, and
	// no existing relationship block re-keys. 'optionSet' names the TIER this plugin asserts over — the
	// same word its bridgeName carries — so the subject reads as what it is rather than as a serial number.
	subjectDiscriminator: 'optionSet',
	matchBasis: 'derived',
	// PESC's own published namespace, enforced by its parser's refusal (parser.js:40, :547) rather
	// than assumed — identical to the sibling, because the standard is the same standard.
	sourceCuriePrefix: { prefix: 'pesc', iri: 'urn:org:pesc:' },
	// ⚠️ THIS PREFIX IS A SHAPE-FITTING DEVICE SATISFYING A startsWith CHECK. IT IS NOT A NAMESPACE
	// CLAIM, AND A READER MUST NOT TAKE IT AS ONE. Recorded as data by RULING P2-R1 because without
	// this note a future reader takes the declaration at face value, which is precisely the harm.
	//
	// (1) PESC'S stableIds ARE URNs; Ed-Fi's AND SIF's ARE CURIEs. The whole proof is one query:
	//         sif:field//AccountingPeriods/AccountingPeriod/@RefId          <- CURIE
	//         edfi:property/abstractEntity.EducationOrganization.Address    <- CURIE
	//         urn:org:pesc:core:CoreMain:v1.0.0#complexType/...             <- A URN
	//     PESC mints URNs CORRECTLY: urn:org:pesc:* is its OWN published namespace, enforced by its
	//     parser's refusal ([code fact] forges/pesc260805/lib/parser.js:40, :547).
	// (2) THE EXPORTER ASSUMES THE CURIE SHAPE and says so in its own comment ([code fact]
	//     lib/bridge-framework/sssomExporter.js:194-198): "a forged id already carries its standard's
	//     prefix (`toy:property/...`, `<standard>:property/...`); prepending would double it". Its rule
	//     is a literal indexOf(prefix + ':') !== 0 -> REFUSE. The assumption held for three standards
	//     and is wrong in general; PESC is simply the first to prove it. Docketed as framework defect
	//     item 14 — NOT repairable here, and lib/bridge-framework/ is this order's hard line.
	// (3) SO THE VALUE BELOW IS CHOSEN TO SATISFY THAT startsWith, NOT TO DECLARE A CURIE PREFIX.
	//     MEASURED against the exporter's own predicate with four real stableIds
	//     (test/probes/p2_curiePrefixCandidates.js): 'pesc' passes 0 of 4 — the defect this replaces;
	//     'urn' passes 4 of 4 but asserts the namespace is THE URN SCHEME, which is false of every URN
	//     ever minted; 'urn:org:pesc' passes 4 of 4 AND names PESC's actual org namespace.
	//     THE SUBJECT ID ITSELF IS VERBATIM AND HONEST — urn:org:pesc:... is a valid IRI and SSSOM
	//     permits a full IRI as subject_id. Only the PREFIX LABEL is a fitting device, which is a far
	//     narrower thing than the choice first appeared to be.
	subjectCuriePrefix: 'urn:org:pesc',
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	// THE SECOND SUBJECT LABEL. Scoped to the **223** latest-reachable option-set CONCEPTS (RULING
	// P1-R13) — the forge's own `reachableFromLatestRoot` marker intersected with the concept key
	// (family, kind, name, description), then one representative per concept.
	//
	// ⚠️ NOT 156, AND THE DIFFERENCE IS A DEFECT THAT WAS CAUGHT: (family, kind, name) gives 156 and
	// reproduces PLAN §1-A exactly, by two independent family derivations, with the cluster count 236
	// as a control. AND 67 OF THOSE 156 GROUPS — 43% — DIFFER INTERNALLY IN `description`, which this
	// plugin RENDERS. The dedup key must EQUAL OR CONTAIN the rendering allow-list, so 156 is unsound
	// in exactly the way PLAN §1's 1,201 was unsound. See bridgeData/pescOptionSetDedupRule.json for
	// the four measured alternatives and the three impurity examples.
	// THE TELL WAS THAT THE COUNT WAS TIDY. A `false` on that marker must NOT be read as "obsolete": it conflates genuinely
	// orphaned, quarantined-contested, older-message-version and substitution-group-only, and
	// "latest" is the FORGE's numeric inference, not something PESC asserts. The scope file records
	// that it excluded on an inferred marker rather than an asserted one.
	subjectSource: { kind: 'graphLabel', label: 'PescNamedDefinition', scopeStableIdListPath: 'bridgeData/pescOptionSetConceptScope.json' },
	judgePromptVariant: 'derived',
	// ⚠️ ALL THREE CATEGORIES MAP TO relatedMatch, AND THAT IS AN UNDERSTATEMENT WE ARE RECORDING AS ONE.
	//
	// WHAT WE KNOW: the PESC code list is THE VALUE DOMAIN OF the CEDS property. WHAT SKOS CAN SAY:
	// nothing of the sort — SKOS_PREDICATES is a CLOSED FIVE-VALUE SET (vocabulary.js:405-409) refused
	// by name outside it (bridgePluginContract.js:769), and it models relations between CONCEPTS, not
	// between a concept and a property's RANGE. Not a gap in this codebase; a limit of the interchange
	// standard. OBSERVED, not merely read: p1_pluginDeclarationValidation.js NEGATIVE 4 plants
	// 'valueDomainOf' and watches the shipped validator refuse it by name.
	//
	// SO relatedMatch IS THE HONEST FLOOR — TRUE, and WEAKER THAN WHAT WE KNOW. exactMatch or
	// closeMatch would assert that the code list IS the property, which is FALSE, and the two failure
	// modes are not symmetric: AN OVERSTATED EDGE IS INDISTINGUISHABLE FROM A CORRECT ONE DOWNSTREAM;
	// AN UNDERSTATED ONE UNDER-CLAIMS VISIBLY and can be strengthened later.
	//
	// ONE PREDICATE FOR ALL THREE CATEGORIES IS CORRECT, NOT LAZY: the RELATION does not vary with the
	// judge's confidence, and confidence rides separately on every judged row. Three predicates would
	// make the relation appear to change with certainty — its own quiet falsehood.
	//
	// THE FULL RECORD, as RULING P1-R5 requires: bridgeData/pescOptionSetUnderstatementRecord.json.
	// It is on disk rather than in this object because the declaration's key set is CLOSED and refuses
	// unknown keys by name (bridgePluginContract.js:954, observed in NEGATIVE 1).
	predicateByCategory: { strong: 'relatedMatch', moderate: 'relatedMatch', weakButReal: 'relatedMatch' },
	predicateSource: { kind: 'judge', predicateRule: 'categoryTable-v1' },
	mappingTool: { name: 'educoreForge bridge-framework derived', version: '1.0.0' },
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	classSideRemodelTable: [],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

const standardBridging = Object.freeze({
	standardKey: 'pesc260805',
	bridgeNameStem: 'pesc',
	facetList: [
		{
			facetName: '',
			declarationTemplate: propertyDeclarationTemplate,
			// (was on candidateRetrieval)
			// K AND THE FLOOR — MEASURED FOR THIS TIER, AND THE QUALIFICATION IS THE POINT.
			// REPORT-P0 §4.2 measured over the whole PESC subject vector space (a CENSUS, not a sample —
			// 1,909 distinct searchText values ARE the entire space): at floor 0.30, ZERO subjects have an
			// empty pool and the mean pool is 14.99 of 15. So the floor discards NOTHING and the judged count
			// equals the subject count. K = 15 because the pool is very flat (median top-1→top-15 spread
			// 0.065), so a larger K buys little and a smaller one risks the ceiling.
			// BOTH FIGURES ARE PROPERTY-TIER MEASUREMENTS. They are honest for every subject this plugin
			// declares, because every candidate it can ever see is a property-tier card.
			// (was on renderingAllowList)
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
			// (was on blindingDeclaration)
			// The SAME list both sibling plugins declare, so the blinding reads as one contract rather than
			// two dialects. Belt AND braces: the allow-list already makes these unreachable by the renderer,
			// and this removes them at the seam — two independent mechanisms, because the value of an audit is
			// that one of them failing is visible. MEASURED CLEAN on the PESC side: `crossRefs` is empty on
			// EVERY PESC node on BOTH labels, and no PESC field carries anything shaped like a CEDS identifier
			// (\b[PCOSV]\d{5,}\b → ZERO). So an id-gate hit anywhere in P2 is a REAL FINDING, not noise.
			subjectRenderingAllowList: ['name', 'owningTypeName', 'typeAsWritten', 'effectiveDescription'],
			// candidateRenderingAllowList below is a PAIR OVERRIDE (SCARLET_ARROW ruling, 2026-10-21): this older generation renders
			// five card fields, not the CEDS hub's nine; kept so the declaration digest does not move. A retirement candidate.
			pairByHubToken: {
				ceds: {
					candidateRetrieval: { method: 'cosineTopK-v1', k: 15, floor: 0.3 },
					candidateRenderingAllowList: ['name', 'propertyDefinition', 'domainName', 'domainDefinition', 'rangeOptionSetName'],
					promptIdentifierScan: null,
					blindingOrder: [{ hubAnchor: 0 }, 'crossRefs', { hubAnchor: 1 }, { hubAnchor: 2 }, { hubAnchor: 3 }],
					hubAnchorListLength: 4,
					declaredTargetRuleList: null,
					remodelTableRef: null,
					hubRemodelTableListLength: null,
				},
			},
		},
		{
			facetName: 'OptionSet',
			declarationTemplate: optionSetDeclarationTemplate,
			// (was on candidateRetrieval)
			// UNCHANGED FROM THE SIBLING, AND HONESTLY SO: the candidate pool IS the same 2,777 property-tier
			// cards, so the floor and K measured over that pool apply unchanged. What is NOT transferred is
			// any claim about how well these SUBJECTS retrieve — that is what P2 measures, separately.
			// (was on renderingAllowList)
			// SUBJECT SIDE — every name here was checked against keys(n) on THIS label before being written,
			// because a renderingAllowList naming a property no node carries renders NOTHING SILENTLY: the
			// framework's own guard against that (graphSeamRules.js allowListRefusal) is DEAD CODE, never
			// called from anywhere in the repository. The acceptance suite carries the conjunct that closes
			// the hazard for these plugins; it does not fix the framework and must not be described as doing so.
			//
			//   name         452/452 populated
			//   kind         452/452 — the XSD kind. The ONLY structural signal available on this label:
			//                MEASURED, `typeAsWritten` IS NOT A PROPERTY OF THESE NODES AT ALL. Declaring it
			//                — as the property tier legitimately does — would have rendered nothing, forever,
			//                greenly.
			//   description  346/452 (76.5%), mean 183 characters, THE RICHEST PROSE IN THE CORPUS: option
			//                sets enumerate their code values inline. No RESOLVES_TO seat is needed here
			//                because the prose is already on the subject itself.
			//
			// `documentation` is NOT named: MEASURED byte-identical to `description` on 452 of 452 of these
			// nodes — verified on THIS label rather than inherited from the element-declaration finding, since
			// a duplication proven elsewhere is not a duplication proven here. Naming both pays twice.
			//
			// CANDIDATE SIDE — identical to the sibling's, and deliberately so: two plugins judging against
			// one pool should not show the judge two different views of the same card.
			// `rangeOptionSetDefinition` is omitted per RULING P1-R6 (byte-identical to propertyDefinition on
			// 1,149 of 1,207); `rangeOptionSetName` is KEPT and matters more here than anywhere, because it is
			// the field that makes a card's VALUE DOMAIN visible to a judge weighing a code list against it.
			subjectRenderingAllowList: ['name', 'kind', 'description'],
			// candidateRenderingAllowList below is a PAIR OVERRIDE (SCARLET_ARROW ruling, 2026-10-21): this older generation renders
			// five card fields, not the CEDS hub's nine; kept so the declaration digest does not move. A retirement candidate.
			pairByHubToken: {
				ceds: {
					candidateRetrieval: { method: 'cosineTopK-v1', k: 15, floor: 0.3 },
					candidateRenderingAllowList: ['name', 'propertyDefinition', 'domainName', 'domainDefinition', 'rangeOptionSetName'],
					promptIdentifierScan: null,
					blindingOrder: [{ hubAnchor: 0 }, 'crossRefs', { hubAnchor: 1 }, { hubAnchor: 2 }, { hubAnchor: 3 }],
					hubAnchorListLength: 4,
					declaredTargetRuleList: null,
					remodelTableRef: null,
					hubRemodelTableListLength: null,
				},
			},
		},
	],
});

// NO HOOKS: both documentary hooks are forbidden on a derived basis, in either facet
const bridgeHooksByFacetName = { '': {}, OptionSet: {} };

module.exports = { standardBridging, bridgeHooksByFacetName };
