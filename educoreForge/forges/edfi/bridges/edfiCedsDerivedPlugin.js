'use strict';

// edfiCedsDerivedPlugin.js — the Ed-Fi → CEDS DERIVED producer (PLAN-derivedBridge-v1.md; RULINGS §11.1–
// §11.12). It proposes mappings from MEANING ALONE: no crosswalk document, no shared key, no authored
// assertion. The framework retrieves candidates by cosine over the vectors already stored on the graph, the
// judge chooses one or abstains, and the result is scored — blind — against the frozen Ed-Fi crosswalk block
// that this plugin cannot reach.
//
// TQ, 2026-08-17: "Ed-Fi is the only standard with good specifications. Derived mappings are going to be the
// vast majority. The reason we do Ed-Fi first is to evaluate the inferred mapping against the specified."
// That is what this file is for. Ed-Fi is not the target; Ed-Fi is the MEASURING STICK.
//
// IT DECLARES NO HOOKS. A derived producer has no document to walk and a graph-sourced subject is its own
// stableId, so SOURCE_ACQUISITION_REGISTRY.derived forbids both mandatory hooks and this file is a
// declaration and nothing else — pure DATA. Compare edfiCedsCrosswalkPlugin.js, which is 499 lines of column
// map and label table because it has a document to describe.
//
// WHAT IT MUST NOT BE ABLE TO DO, and how that is enforced rather than intended:
//   - read the crosswalk: it declares NO channel, so no file is opened at all (BG-NOCROSSWALK)
//   - read the truth block: it runs against its OWN decision store (RULING §11.5); the scoring harness is
//     the only reader of the crosswalk store, and it reads by path, read-only
//   - see an identifier: renderingAllowList is an ALLOW-list, and the declaration validator refuses any name
//     on RENDERING_NEVER_NAME_LIST — including cedsId, which TQ named by name

const bridgeDeclaration = Object.freeze({
	bridgeName: 'edfiCedsDerivedPlugin',
	standardKey: 'edfi',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'edfi', iri: 'urn:educore:edfi:' },
	subjectCuriePrefix: 'edfi',
	// EMPTY, and required to be. Nothing is walked. This single line is the whole of BG-NOCROSSWALK's
	// mechanism: a producer that opens no file cannot have read the answer out of one.
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	// SUBJECTS ARE GRAPH NODES (RULING §11.11). All 1,904 EdfiProperty nodes carry depth 2 and role
	// 'DmeProperty' — there is no leaf/non-leaf distinction to make, so the label IS the population.
	// scopeStableIdListPath narrows that to the 701 the frozen crosswalk block names, which are the only
	// subjects that can be SCORED. The path is relative and resolves beside this plugin, so the scope travels
	// with the bundle and the declaration digest is not machine-specific.
	//
	// D2 (debug, free) runs over ALL 1,904 by pointing this at null; D3/D4 (real judge) run over the 701 only.
	// Spending on the 1,203 the crosswalk never mentions is TQ's decision AFTER the score (§11.2).
	// ⟪PHASE-SWITCHED, DELIBERATELY, AT A COMMITTED BOUNDARY⟫ RULING §11.2 splits the population by phase:
	//   D2 (debug, FREE)      — scopeStableIdListPath: null   → ALL 1,904 EdfiProperty nodes. Free, so there is
	//                           no reason not to see the whole population, and the pool statistics for the 1,203
	//                           subjects the crosswalk never mentions are the only evidence anyone has about the
	//                           63% of Ed-Fi that has no crosswalk at all.
	//   D3/D4 (REAL judge)    — 'bridgeData/edfiDerivedScorableScope.json' → the 701 SCORABLE only. Spending on
	//                           the 1,203 unscorable is TQ's decision AFTER the score.
	// The two runs have different declarationDigests and therefore different block ids. That is correct and is
	// the point: they ARE different runs over different populations, and a scheme that gave them one id would be
	// hiding that. Both digests and both block ids are recorded in the DEVLOG at the phase boundary.
	// CURRENT PHASE: D3/D4 — switched from null at the CP1 boundary, 2026-08-17, on the supervisor's GO.
	// ⟪2026-09-10, OCEAN_SUMMIT, TQ RULING⟫ Back to null — EVERY EdfiProperty node. The 701-id scope file was the
	// AEM crosswalk's own subject population (scalar and descriptor properties only; zero reference-typed
	// properties), kept so the derived run could be scored against that crosswalk. TQ ruled the crosswalk
	// untrustworthy on 2026-09-10 ("it will not be included in the graph and will not be used as a basis for
	// evaluating our performance") after 87 of its 184 class-contended rows read as plainly wrong and 166 of the
	// 184 proved to be the alphabetically-first CEDS class. The file is deleted from source (fileStash backup
	// 2026-09-10 10-08-41). Operator narrowing for evaluation now belongs to the run, not the declaration —
	// see the named-subject-set work order (WORKORDER-namedSubjectSet-091026.md). declarationDigest and every
	// derived block id move with this line; the 80.9% yardstick those ids served is retired.
	subjectSource: { kind: 'graphLabel', label: 'EdfiProperty', scopeStableIdListPath: null },
	// K AND THE FLOOR, RULED ON THE MEASURED CURVE (§11.3). The D0 review computed recall@K over the 655
	// subjects with a picked truth object: @10 = 0.768, @15 = 0.815, @25 = 0.858, rank-1 = 0.415.
	//   K = 15 — the July-tuned value. K = 10 would cap the judge at 0.768 before Opus is asked anything;
	//            K = 15 buys 4.7 points for more prompt tokens and NOT ONE extra call.
	//   floor = 0.30 — deliberately BELOW the measured top-1 minimum (0.325), so v1 measures THE JUDGE rather
	//            than the floor. The only prior floor (0.78, from the July attic harness) would have emptied
	//            the large majority of pools — median top-1 cosine here is 0.696 — and the experiment would
	//            have reported nothing while looking clean.
	// Both are members of the census-fixture key and ride in the block header: changing either RE-KEYS the
	// block rather than silently invalidating a fixture that still compares equal.
	candidateRetrieval: { k: 15, floor: 0.3, embeddingModelVersion: 'voyage-4-large' },
	// THE BIAS AUDIT (§4, RULING §11.4). Measured against the live graph before being written here: every
	// value of every name below was regex-scanned across all 1,904 Ed-Fi nodes and all 2,777 property-tier hub
	// cards, and NONE carries a CEDS identifier.
	//
	// `searchText` is VERIFIED SAFE and still excluded: it is "<owningConstruct> | <propertyName>", averaging
	// 39 characters, and adds nothing the three subject names below do not already say.
	// `propertyDefinition` is absent on 3 of 2,777 cards; absent is absent, and the line is simply omitted.
	renderingAllowList: {
		// ⟪v12⟫ componentIdeaList is COMPUTED by the renderer's shared splitter and declared here like any other
		// name: the allow-list still governs, so the field cannot appear in a plugin that has not asked for it.
		subject: ['name', 'path', 'description', 'propertyType', 'owningConstructName', 'owningConstructType', 'componentIdeaList'],
		// ⟪PROMPT v2 — 2026-09-11⟫ rangeClassName / rangeClassDefinition ADDED. The hub has minted both since
		// 2026-07-01 (hub-framework.js:600,605; 485 of 94,602 cards carry them) and the prompt threw them away:
		// measured over the promptV1 run, 635 option-set cards showed their range and 0 of 244 REFERENCE cards
		// showed theirs, so a card that points at another object rendered identically to one holding a literal.
		// The graph knew; the prompt did not say. Guidance line (3) is unusable without these two names.
		candidate: ['name', 'propertyDefinition', 'domainName', 'domainDefinition', 'rangeOptionSetName', 'rangeOptionSetDefinition', 'rangeClassName', 'rangeClassDefinition', 'componentIdeaList'],
	},
	judgePromptVariant: 'derived',
	// THE V1 APPROXIMATION, NAMED AS SUCH (§11.7 (a)). The judge's return carries no predicate slot and TQ has
	// ruled the judge is embellished only after Ed-Fi is complete, so the relation is derived from the judge's
	// CONFIDENCE CATEGORY through this table. That is not a conforming design and is not presented as one: it
	// is a declared, time-boxed non-conformance, stamped predicateRule 'categoryTable-v1' in the block header
	// and in the SSSOM comment, so a later judge with a real predicate slot RE-MEASURES rather than silently
	// differing. §6's per-predicate metric measures this table, not the judge, and says so.
	predicateByCategory: { strong: 'exactMatch', moderate: 'closeMatch', weakButReal: 'closeMatch' },
	predicateSource: { kind: 'judge', predicateRule: 'categoryTable-v1' },
	// THE PRODUCER, in place of a mapping PROVIDER. Nobody authored these mappings — mappingProvider is
	// FORBIDDEN for this basis, on the edge and in the SSSOM alike (§11.7 (c), amended 2026-08-17).
	mappingTool: { name: 'educoreForge bridge-framework derived', version: '1.0.0' },
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	remodelTableRef: null,
	classSideRemodelTable: [],
	// The SAME list the crosswalk plugin declares — cedsId first, because TQ named it by name. Belt AND
	// braces: the allow-list already makes these unreachable by the renderer, and this removes them at the
	// seam. Two independent mechanisms, because the value of an audit is that one of them failing is visible.
	blindingDeclaration: ['cedsId', 'crossRefs', 'cedsOriginalAnchorPropertyName', 'cedsOptionCode', 'cedsOptionOriginalAnchorPropertyName'],
	// ⟪PROMPT v2 — 2026-09-11, OCEAN_SUMMIT, TQ-authorised: "Revise the prompt to include meaning and whatever
	// else you think will help and rerun the set."⟫ globalGuidance turned ON. The block has existed, guarded and
	// empty, since the framework was built; these are the first lines to go in it, and every one of them was
	// EARNED BY A MEASURED FAILURE in the promptV1 run over the frozen 100, not invented:
	//
	//   (1) MEANING OVER WORDING. Of 7 declined date subjects, FOUR had a card that meant the same thing sitting
	//       in the pool and were declined anyway — ProbationCompleteDate against Employment End Date,
	//       SectionAttendanceTakenEvent.EventDate against Attendance Event Date, USMostRecentEntry against Last
	//       Qualifying Move Date, and one arguable fourth. The judge declines when no candidate is PHRASED like
	//       the source. 46 of 100 subjects abstained; this is the costliest defect found.
	//   (2) ABSTENTION IS NOT A SAFE DEFAULT. Stated because (1) is only half the lesson: the v1 system prompt
	//       says abstaining "is a correct and expected answer, not a failure", which is true and was read as
	//       permission. The symmetry has to be said out loud or fixing (1) just trades one error for the other.
	//   (3) VALUE vs REFERENCE. The judge matched Ed-Fi's ApplicantProfile.Telephone (a reference to a Telephone
	//       object) to the card holding the digits rather than the card that POINTS AT the telephone. TQ caught
	//       it. This line pairs with the two rangeClass names added to renderingAllowList above: until now a
	//       reference card rendered identically to a literal one — 0 of 244 reference cards in that run showed
	//       their range at all — so the judge could not have seen the difference it is now asked to weigh.
	//   (4) THE DOMAIN IS HALF THE IDEA. The v1 run's largest error class was right-property/wrong-class, and
	//       TQ ruled on 2026-09-10 that such a mapping asserts something false.
	//
	// CANDIDATE-BLIND BY CONSTRUCTION (A2 smuggling gate, evidenceRenderer.js:222-230): the gate refuses any
	// global segment containing a candidate's stableId, canonicalKey, NAME or uri. These lines therefore name no
	// CEDS card and no CEDS domain — they state rules about SHAPE and KIND, which is what makes them safe to
	// apply to every subject in every pool.
	// ⟪v4, 2026-09-11 — TQ⟫ globalGuidance back ON, with TWO lines instead of v2's five, written by TQ.
	//
	// I had switched it off for v3 and that was a MISTAKE OF MY OWN MAKING: TQ's system prompt refers to "the
	// GUIDANCE" twice — "You will refer to the GUIDANCE as well as simply thinking about the meaning" — so an
	// empty block left the frame pointing at something that was not there. He caught it; the fix is to supply the
	// guidance the system prompt promises rather than to delete the promise.
	//
	// WHAT SURVIVED THE CUT, and it is the interesting part. v2 had five lines and all five were measured inert.
	// TQ kept the one that states what a correspondence IS, rewrote the abstention line into the system prompt's
	// own vocabulary (CANDIDATE ELEMENT / SOURCE ELEMENT, with *means* emphasised), and dropped the three that
	// were rules about how to decide — abstention-is-not-a-safe-default, value-versus-reference, and
	// domain-is-half-the-idea. That is the same distinction the 2026-09-11 probes found from the other end: the
	// judge takes descriptions and refuses instructions. Two lines that DESCRIBE beat five that DIRECT.
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: true },
	globalGuidanceList: [
		"Person, student, school are FUNDAMENTAL IDEAS. If any of the CANDIDATE ELEMENTS have COMPONENT IDEAS that share one or more FUNDAMENTAL IDEAS with the SOURCE ELEMENT, one of those must be chosen unless there is a very important reason not to.",
		"Judge by MEANING, not by wording. Two elements correspond when they assert the same fact about the world, even when their names share no words and their phrasing is nothing alike.",
		"Answer NONE only when no CANDIDATE ELEMENT *means* the same thing as the SOURCE ELEMENT.",
		"When evaluating two elements, consider the COMPONENT IDEAS of one against the totality of the other. The number of COMPONENT IDEAS that match are not dispositive but should enhance the potential for the two elements to be considered a match.",
		"If a FUNDAMENTAL IDEA matches a COMPONENT IDEA in the *domain* of a CANDIDATE ELEMENT, it is mandatory that it be chosen over those that do not.",
	],
	compatibilityDeclarationList: [],
});

// NO HOOKS. See the header: both mandatory hooks are FORBIDDEN on a derived basis.
const bridgeHooks = {};

module.exports = { bridgeDeclaration, bridgeHooks };
