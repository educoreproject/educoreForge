'use strict';

// eduapiBridging.js — the STANDARD half of EduAPI 1.0's bridges (nextStandards wave 2 F2, 2026-10-24): ONE derived facet, every
// EduapiProperty a subject (Ed-Fi's form, forges/edfi/bridges/edfiBridging.js: scopeStableIdListPath null), judged toward each hub
// eduapiHubPairing.json names. The hub half comes from each hub's own bridging declaration and the two compose
// (lib/bridge-framework/bridgeComposer.js). The forge does no bridging (FBB-001); this file is where EduAPI meets a hub.
//
// NO CLASS FACET (the Open Badges form, GATEREPORT-F0 ruled 2026-10-24): eleven of the 39 schemas are the Imsx_* envelope or empty
// extension points, and the rest are carried by their properties' edges.
//
// THE JUDGE'S VIEW of a property (subjectRenderingAllowList): its name, its path (<Schema>.<property>, so its schema), its
// description, its type (and its items' type, so whether it is an array of what), its format, whether its schema requires it, and
// the names of the schemas it references (referencedSchemaNames, the kit's derived text: a bare $ref property publishes no
// description, so without it the judge sees 'primaryAddress' and not that it is an OptionallyTypedAddress). Nothing of EduAPI names a hub card.

const path = require('path');
const hubPairing = require(path.join(__dirname, 'eduapiHubPairing.json'));

const declarationTemplate = Object.freeze({
	standardKey: 'eduapi',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'eduapi', iri: 'urn:educore:eduapi:' },
	subjectCuriePrefix: 'eduapi',
	// EMPTY: nothing is walked; a derived producer opens no file
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	subjectSource: { kind: 'graphLabel', label: 'EduapiProperty', scopeStableIdListPath: null },
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

// PESC_LD's judged pair row (forges/pescld/bridges/pescldBridging.js), exactly as Open Badges took it (wave-2 work order: lane A's
// A2): embedText retrieval at 40 hits per text and k 40, the hub's own identifier scan, and the union blinding (this standard's crossRefs, then every paired hub's anchors)
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
	standardKey: 'eduapi',
	bridgeNameStem: 'eduapi',
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
