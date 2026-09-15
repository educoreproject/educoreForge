'use strict';

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

const bridgeDeclaration = Object.freeze({
	bridgeName: 'pescOptionSetCedsDerivedPlugin',
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
	// UNCHANGED FROM THE SIBLING, AND HONESTLY SO: the candidate pool IS the same 2,777 property-tier
	// cards, so the floor and K measured over that pool apply unchanged. What is NOT transferred is
	// any claim about how well these SUBJECTS retrieve — that is what P2 measures, separately.
	candidateRetrieval: { method: 'cosineTopK-v1', k: 15, floor: 0.3, embeddingModelVersion: 'voyage-4-large' },
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
	renderingAllowList: {
		subject: ['name', 'kind', 'description'],
		candidate: ['name', 'propertyDefinition', 'domainName', 'domainDefinition', 'rangeOptionSetName'],
	},
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
	remodelTableRef: null,
	classSideRemodelTable: [],
	blindingDeclaration: ['cedsId', 'crossRefs', 'cedsOriginalAnchorPropertyName', 'cedsOptionCode', 'cedsOptionOriginalAnchorPropertyName'],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

// NO HOOKS — forbidden on a derived basis, same as the sibling.
const bridgeHooks = {};

module.exports = { bridgeDeclaration, bridgeHooks };
