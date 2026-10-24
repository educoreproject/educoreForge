'use strict';

// lifBridging.js — the STANDARD half of LIF 2.0's bridges (nextStandards-102326 C2, 2026-10-24): ONE derived facet, every LifProperty
// a subject (Ed-Fi's form, forges/edfi/bridges/edfiBridging.js: scopeStableIdListPath null; BRONZE_CROWN ruled the whole 1,393 in scope,
// container properties included, as Open Badges judged all), judged toward each hub lifHubPairing.json names. The hub half comes from
// each hub's own bridging declaration and the two compose (lib/bridge-framework/bridgeComposer.js). The forge does no bridging (FBB-001);
// this file is where LIF meets a hub.
//
// NO CLASS FACET: LIF's 140 classes publish no description (8 entities, 132 untitled inline objects with derived names); their
// properties carry the meaning, and Open Badges' A2 ruling (no class facet) applies.
//
// THE JUDGE'S VIEW of a property (subjectRenderingAllowList): its name, its path (the entity and every inline object above it), its
// description, its type, its format, and whether its object requires it. LIF's useRecommendations is guidance, not a definition, and is
// not shown (C0 design §4). itemsDataType and referencedSchemaNames are not listed: no LIF property carries them (no items, no recovered
// reference). Nothing of LIF names a hub card; the six CEDS element URLs in LIF descriptions are the description's own text.

const path = require('path');
const hubPairing = require(path.join(__dirname, 'lifHubPairing.json'));

const declarationTemplate = Object.freeze({
	standardKey: 'lif',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'lif', iri: 'urn:educore:lif:' },
	subjectCuriePrefix: 'lif',
	// EMPTY: nothing is walked; a derived producer opens no file
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	subjectSource: { kind: 'graphLabel', label: 'LifProperty', scopeStableIdListPath: null },
	judgePromptVariant: 'derivedJudgeSlot',
	choiceQuestionFormName: 'matchingInstructionsState',
	predicateSource: { kind: 'judge', predicateRule: 'judgeSlot-v1' },
	mappingTool: { name: 'educoreForge bridge-framework derived', version: '1.0.0' },
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	classSideRemodelTable: [],
	blockRecordsJudgeConfig: true,
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

// Open Badges' judged pair row (itself PESC_LD's), per the work order: embedText retrieval at 40 hits per text and k 40, the hub's own
// identifier scan, and the union blinding (this standard's crossRefs, then every paired hub's anchors)
const judgedPairRow = Object.freeze({
	candidateRetrieval: { method: 'embedTextVote-v1', hitsPerText: 40, minScore: 0.3, k: 40, neighbourVote: null },
	candidateRenderingAllowList: null,
	promptIdentifierScan: 'fromHub',
	blindingOrder: { standardBlindingNameList: ['crossRefs'], pairedHubAnchors: 'union' },
	hubAnchorListLength: null,
	declaredTargetRuleList: null,
	remodelTableRef: null,
	hubRemodelTableListLength: null,
});

const standardBridging = Object.freeze({
	standardKey: 'lif',
	bridgeNameStem: 'lif',
	facetList: [
		{
			facetName: '',
			declarationTemplate,
			subjectRenderingAllowList: ['name', 'path', 'description', 'dataType', 'dataFormat', 'isRequired'],
			pairByHubToken: Object.freeze(Object.fromEntries(hubPairing.judgedHubTokenList.map((hubToken) => [hubToken, judgedPairRow]))),
		},
	],
});

// NO HOOKS: both mandatory hooks are FORBIDDEN on a derived basis (the Ed-Fi form)
const bridgeHooksByFacetName = { '': {} };

module.exports = { standardBridging, bridgeHooksByFacetName };
