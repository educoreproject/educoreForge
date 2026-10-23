'use strict';

// openbadgesBridging.js — the STANDARD half of Open Badges 3.0's bridges (nextStandards-102326 A2, 2026-10-23): ONE derived facet, every
// OpenBadgesProperty a subject (Ed-Fi's form, forges/edfi/bridges/edfiBridging.js: scopeStableIdListPath null), judged toward each hub
// openbadgesHubPairing.json names. The hub half comes from each hub's own bridging declaration and the two compose
// (lib/bridge-framework/bridgeComposer.js). The forge does no bridging (FBB-001); this file is where Open Badges meets a hub.
//
// NO CLASS FACET (decided in the K0 design, BRONZE_CROWN ruled 2026-10-23): ten of the 32 schemas are API plumbing and the other 22
// are carried by their properties' edges; a second facet would double the roster rows for little signal.
//
// THE JUDGE'S VIEW of a property (subjectRenderingAllowList): its name, its path (<Schema>.<property>, so its schema), its
// description, its type (and its items' type, so whether it is an array of what), its format, whether its schema requires it, and
// the names of the schemas it references (referencedSchemaNames, the kit's derived text: a bare $ref property publishes no
// description, so without it the judge sees 'creator' and not that it is a Profile). Nothing of Open Badges names a hub card.

const path = require('path');
const hubPairing = require(path.join(__dirname, 'openbadgesHubPairing.json'));

const declarationTemplate = Object.freeze({
	standardKey: 'openbadges',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'openbadges', iri: 'urn:educore:openbadges:' },
	subjectCuriePrefix: 'openbadges',
	// EMPTY: nothing is walked; a derived producer opens no file
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	subjectSource: { kind: 'graphLabel', label: 'OpenBadgesProperty', scopeStableIdListPath: null },
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

// PESC_LD's judged pair row (forges/pescld/bridges/pescldBridging.js) as the START, per the work order: embedText retrieval at 40 hits
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
	standardKey: 'openbadges',
	bridgeNameStem: 'openbadges',
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
