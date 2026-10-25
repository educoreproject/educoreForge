'use strict';

// clrBridging.js — the STANDARD half of CLR 2.0's bridges (nextStandards-102326 wave 2 D2, 2026-10-24): ONE derived facet, every
// ClrProperty a subject (Ed-Fi's form, forges/edfi/bridges/edfiBridging.js: scopeStableIdListPath null), judged toward each hub
// clrHubPairing.json names. The hub half comes from each hub's own bridging declaration and the two compose
// (lib/bridge-framework/bridgeComposer.js). The forge does no bridging (FBB-001); this file is where CLR meets a hub.
//
// NO CLASS FACET (Open Badges' ruled choice, kept in DESIGN-D0-clr-102426.md): ten of the 34 schemas are API plumbing and the other 24
// are carried by their properties' edges; a second facet would double the roster rows for little signal.
//
// THE JUDGE'S VIEW of a property (subjectRenderingAllowList): its name, its path (<Schema>.<property>, so its schema), its
// description, its type (and its items' type, so whether it is an array of what), its format, whether its schema requires it, and
// the names of the schemas it references (referencedSchemaNames, the kit's derived text: a bare $ref property publishes no
// description, so without it the judge sees 'creator' and not that it is a Profile). Nothing of CLR names a hub card. This is Open Badges' view, unchanged.

const path = require('path');
const hubPairing = require(path.join(__dirname, 'clrHubPairing.json'));

const declarationTemplate = Object.freeze({
	standardKey: 'clr',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'clr', iri: 'urn:educore:clr:' },
	subjectCuriePrefix: 'clr',
	// EMPTY: nothing is walked; a derived producer opens no file
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	subjectSource: { kind: 'graphLabel', label: 'ClrProperty', scopeStableIdListPath: null },
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

// Open Badges' judged pair row (forges/openbadges/bridges/openbadgesBridging.js, itself PESC_LD's), unchanged: embedText retrieval at 40 hits
// per text and k 40, the hub's own identifier scan, and the union blinding (this standard's crossRefs, then every paired hub's anchors)
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
	standardKey: 'clr',
	bridgeNameStem: 'clr',
	facetList: [
		{
			facetName: '',
			declarationTemplate,
			subjectRenderingAllowList: ['name', 'path', 'description', 'dataType', 'itemsDataType', 'dataFormat', 'isRequired', 'referencedSchemaNames'],
			pairByHubToken: Object.freeze(Object.fromEntries(hubPairing.judgedHubTokenList.map((hubToken) => [hubToken, judgedPairRow]))),
		},
	],
});

// NO HOOKS: both mandatory hooks are FORBIDDEN on a derived basis (the Ed-Fi form)
const bridgeHooksByFacetName = { '': {} };

module.exports = { standardBridging, bridgeHooksByFacetName };
