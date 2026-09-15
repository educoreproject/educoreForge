'use strict';

// toyDerivedPlugin.js — the TOY DERIVED plugin (matchBasis 'derived', producerKind 'inferred'): the third
// plugin on the SAME pairing, so every derived gate runs hermetically over the toy graph with no container,
// no network and no real judge (SPEC-bridgeFramework-v1.md §13; RULINGS §11.3, §11.4, §11.7, §11.9, §11.11).
//
// IT DECLARES NO HOOKS AT ALL, and that is the point rather than an economy. A derived producer has no
// document to walk, so walkSourceAssertions would have nothing to read; and a graph-sourced subject IS its own
// stableId, so a subjectStableIdFor that returned anything but identity would be answering a question nobody
// asked. SOURCE_ACQUISITION_REGISTRY.derived therefore FORBIDS both, and this file is a declaration and
// nothing else — pure DATA. That is the sharpest available answer to the design note's own test of whether
// derived is "a plugin on the framework, or a second system".
//
// It exports EXACTLY { bridgeDeclaration, bridgeHooks }, with bridgeHooks an EMPTY object — not absent. The
// contract still requires the key, because "this plugin supplies no hooks" is a claim worth making out loud.

const bridgeDeclaration = Object.freeze({
	bridgeName: 'toyDerivedPlugin',
	standardKey: 'toy',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'toy', iri: 'https://toy.example/standard/v1#' },
	subjectCuriePrefix: 'toy',
	// EMPTY, and required to be: this basis's acquisition row names no walkChannelSourceKind, so declaring a
	// channel here is refused BY NAME. Nothing is walked; the subjects come from the graph.
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	// the NEW entry into STEP 5 (§11.11): subjects are the graph's own nodes carrying this label. The label is
	// DATA — the framework names no standard. scopeStableIdListPath null means "every node with the label";
	// the real Ed-Fi plugin narrows to its declared evaluation scope instead.
	subjectSource: { kind: 'graphLabel', label: 'ToyProperty', scopeStableIdListPath: null },
	// K, the floor and the model. All three ride in the block header and in the census-fixture key, so changing
	// one re-keys the block rather than silently invalidating a fixture that still compares equal (§11.3/§11.10).
	// The toy graph gives every card the SAME vector, so every cosine is 1 and the tie-break — stableId
	// ascending — decides the whole pool. That is deliberate: it makes the toy pool exactly predictable, which
	// is what a gate over pool SHAPE (size ≤ K, order, floor) needs.
	candidateRetrieval: { method: 'cosineTopK-v1', k: 3, floor: 0.3, embeddingModelVersion: 'toy-embed-v1' },
	// THE BIAS AUDIT, as an ALLOW-list (§11.4). The rendered subject and candidate blocks carry ONLY these
	// names. Note what is NOT here and could not be even by accident: no identifier, no URI, no content hash,
	// no notation, no vector, no cross-reference — the declaration validator refuses every one of them BY NAME
	// against RENDERING_NEVER_NAME_LIST, so the omission is enforced rather than merely intended.
	//
	// (Those excluded property names are deliberately NOT spelled out here: BG-CONTAIN's substrate scan reads
	// this file's RAW TEXT, comments included, and refuses a plugin whose source carries certain hub-internal
	// tokens. Naming them to explain their absence would itself trip the gate — which it did, on my first
	// draft. The gate is right: a plugin has no business containing those strings for any reason.)
	renderingAllowList: {
		subject: ['name', 'description', 'owningConstructName'],
		candidate: ['name', 'propertyDefinition', 'domainName', 'domainDefinition'],
	},
	judgePromptVariant: 'derived',
	// the v1 category→predicate approximation, NAMED as such in the block header (§11.7 (a)). It must cover
	// every judge category or the declaration is refused: an uncovered category would reach the edge builder
	// with no relation, which is the exact class of silent default this contract exists to prevent.
	predicateByCategory: { strong: 'exactMatch', moderate: 'closeMatch', weakButReal: 'closeMatch' },
	predicateSource: { kind: 'judge', predicateRule: 'categoryTable-v1' },
	// the PRODUCER, in place of a mapping PROVIDER. Nobody authored these mappings; a tool proposed them and a
	// judge chose. mappingProvider is FORBIDDEN for this basis and its absence is checked, not assumed.
	mappingTool: { name: 'educoreForge bridge-framework derived', version: '1.0.0' },
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	remodelTableRef: null,
	classSideRemodelTable: [],
	// the same blinded triple the other two toy plugins declare. It is belt AND braces here: the allow-list
	// already makes these unreachable by the renderer, and the blinding declaration removes them at the seam.
	// Two independent mechanisms, because the whole value of the audit is that one of them failing is visible.
	blindingDeclaration: ['hubAnchorId', 'crossRefs', 'hubAnchorOriginalPropertyName', 'hubOptionCode', 'hubOptionOriginalPropertyName'],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

// NO HOOKS. See the header: both mandatory hooks are FORBIDDEN on a derived basis.
const bridgeHooks = {};

module.exports = { bridgeDeclaration, bridgeHooks };
