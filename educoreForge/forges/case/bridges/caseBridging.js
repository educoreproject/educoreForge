'use strict';

// caseBridging.js — the STANDARD half of CASE 1.1's bridges (nextStandards wave 2 lane E2, 2026-10-24; the Open Badges form): ONE derived facet, every
// CaseProperty a subject (Ed-Fi's form, forges/edfi/bridges/edfiBridging.js: scopeStableIdListPath null), judged toward each hub
// caseHubPairing.json names. The hub half comes from each hub's own bridging declaration and the two compose
// (lib/bridge-framework/bridgeComposer.js). The forge does no bridging (FBB-001); this file is where CASE meets a hub.
//
// NO CLASS FACET (the Open Badges ruling, kept for CASE in DESIGN-E0 §6, ruled 2026-10-24): 18 of the 39 schemas are empty extension
// containers or API plumbing and the rest are carried by their properties' edges; a second facet would double the roster rows for little signal.
//
// THE JUDGE'S VIEW of a property (subjectRenderingAllowList): its name, its path (<Schema>.<property>, so its schema), its
// description, its type (and its items' type, so whether it is an array of what), its format, whether its schema requires it, and
// the names of the schemas it references (referencedSchemaNames, the kit's derived text: a bare $ref property publishes no
// description, so without it the judge sees 'originNodeURI' and not that it is a LinkGenURIDType). Nothing of CASE names a hub card.

const path = require('path');
const hubPairing = require(path.join(__dirname, 'caseHubPairing.json'));

const declarationTemplate = Object.freeze({
	standardKey: 'case',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'case', iri: 'urn:educore:case:' },
	subjectCuriePrefix: 'case',
	// EMPTY: nothing is walked; a derived producer opens no file
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	subjectSource: { kind: 'graphLabel', label: 'CaseProperty', scopeStableIdListPath: null },
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

// Open Badges' judged pair row (forges/openbadges/bridges/openbadgesBridging.js, itself PESC_LD's), per the work order: embedText retrieval at 40 hits
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
	standardKey: 'case',
	bridgeNameStem: 'case',
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
