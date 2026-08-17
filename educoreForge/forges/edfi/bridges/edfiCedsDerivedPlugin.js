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
	subjectSource: { kind: 'graphLabel', label: 'EdfiProperty', scopeStableIdListPath: 'bridgeData/edfiDerivedScorableScope.json' },
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
		subject: ['name', 'path', 'description', 'propertyType', 'owningConstructName', 'owningConstructType'],
		candidate: ['name', 'propertyDefinition', 'domainName', 'domainDefinition', 'rangeOptionSetName', 'rangeOptionSetDefinition'],
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
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

// NO HOOKS. See the header: both mandatory hooks are FORBIDDEN on a derived basis.
const bridgeHooks = {};

module.exports = { bridgeDeclaration, bridgeHooks };
