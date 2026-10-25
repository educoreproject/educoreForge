'use strict';

// medbiqBridging.js — the STANDARD half of MedBiquitous's bridges (nextStandards wave 3 lane I2, 2026-10-25; the LIF form): ONE derived facet, the
// MedbiqFields of the current-version files a subject (bridges/medbiqJudgedSubjects.json, written by bridgeData/medbiqJudgedSubjectRule.js),
// judged toward each hub medbiqHubPairing.json names. The hub half comes from each hub's own bridging declaration and the two compose
// (lib/bridge-framework/bridgeComposer.js). The forge does no bridging (FBB-001); this file is where MedBiquitous meets a hub.
//
// NO CLASS FACET (the Open Badges ruling): the types are carried by their fields' edges, and a second facet would double the roster rows.
//
// THE JUDGE'S VIEW of a field (subjectRenderingAllowList; Phase 0 ruling 5 and K3c, BRONZE_CROWN 2026-10-25): MedBiquitous documents no field
// in its schemas, so the view is the standard's own structure: the field's name and path ('<owning type>.<field>'), its own description (none
// today), its type or the element it references as written (typeQName, refQName), its occurrence (minOccurs, maxOccurs, use), the value names
// of the option set it is typed by (optionValueNameList) and its owning type's own documentation (owningTypeDescription). Nothing of
// MedBiquitous names a hub card.

const path = require('path');
const hubPairing = require(path.join(__dirname, 'medbiqHubPairing.json'));

const declarationTemplate = Object.freeze({
	standardKey: 'medbiq',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'medbiq', iri: 'urn:educore:medbiq:' },
	subjectCuriePrefix: 'medbiq',
	// EMPTY: nothing is walked; a derived producer opens no file
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	subjectSource: { kind: 'graphLabel', label: 'MedbiqField', scopeStableIdListPath: 'bridges/medbiqJudgedSubjects.json' },
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

// Open Badges' judged pair row (forges/openbadges/bridges/openbadgesBridging.js, itself PESC_LD's): embedText retrieval at 40 hits per text and
// k 40, the hub's own identifier scan, and the union blinding (this standard's crossRefs, then every paired hub's anchors)
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
	standardKey: 'medbiq',
	bridgeNameStem: 'medbiq',
	facetList: [
		{
			facetName: '',
			declarationTemplate,
			subjectRenderingAllowList: ['name', 'path', 'description', 'typeQName', 'refQName', 'minOccurs', 'maxOccurs', 'use', 'optionValueNameList', 'owningTypeDescription'],
			pairByHubToken: Object.freeze(Object.fromEntries(hubPairing.judgedHubTokenList.map((hubToken) => [hubToken, judgedPairRow]))),
		},
	],
});

// NO HOOKS: both mandatory hooks are FORBIDDEN on a derived basis (the Ed-Fi form)
const bridgeHooksByFacetName = { '': {} };

module.exports = { standardBridging, bridgeHooksByFacetName };
