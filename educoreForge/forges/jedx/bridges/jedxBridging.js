'use strict';

// jedxBridging.js — the STANDARD half of every bridge from JEDx (nextStandards-102326 lane B, B2; lib/bridge-framework/standardBridgingContract.js).
//
// ONE facet, basis DERIVED. JEDx (the JEDx Open API Specification, HR Open schema types) borrows no term from any hub, so nothing
// can bridge by identity: the framework retrieves each property's nearest hub cards by its texts and the judge picks one card or
// none and names the relation (judgeSlot-v1). Every JEDx property is a subject (Ed-Fi's form: subjectSource over the property label,
// no scope list). The hubs it pairs with are DATA (jedxHubPairing.json), so this file names none.
//
// IT DECLARES NO HOOKS: a derived facet walks no document and a graph-sourced subject is its own stableId.
//
// The subject label (JedxProperty, the profile's perStandardLabelByRole) and every name on the allow-list were read off the forged
// graph (nextStandards-102326 B1 probe on kit K1, 2026-10-24: 694 JedxProperty nodes; referencedSchemaNames on 521 of them).

const path = require('path');

const declarationTemplate = Object.freeze({
	standardKey: 'jedx',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'jedx', iri: 'urn:educore:jedx:' },
	subjectCuriePrefix: 'jedx',
	// EMPTY, and required to be: nothing is walked, the subjects come from the graph
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	subjectSource: { kind: 'graphLabel', label: 'JedxProperty', scopeStableIdListPath: null },
	judgePromptVariant: 'derivedJudgeSlot',
	// the instruction form, as PESC_LD's and Open Badges' judged facets take it
	choiceQuestionFormName: 'matchingInstructionsState',
	// the judge names the relation itself through the tool's predicate slot, so no category table is declared
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

// the judged pair row, one for every hub the pairing data names: retrieval copied from PESC_LD's judged row as the START (WORKORDER-jedx
// B2), the hub's own candidate list and identifier scan, the union blinding (this standard's crossRefs, then every paired hub's anchors)
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
const hubPairing = require(path.join(__dirname, 'jedxHubPairing.json'));
const judgedPairByHubToken = Object.freeze(Object.fromEntries(hubPairing.judgedHubTokenList.map((hubToken) => [hubToken, judgedPairRow])));

const standardBridging = Object.freeze({
	standardKey: 'jedx',
	bridgeNameStem: 'jedx',
	facetList: [
		{
			facetName: '',
			declarationTemplate,
			// THE JUDGE'S VIEW of a property, the Open Badges list (one kit, one view): its name, its path (<Schema>/properties/<p>, so
			// its schema), its description, its type and its items' type, its format, whether its schema requires it, and the names of
			// the schemas and code lists it references (referencedSchemaNames, the kit's derived text: an inlined HR Open type is how
			// JEDx says what a property holds). Nothing of JEDx names a hub card.
			subjectRenderingAllowList: ['name', 'path', 'description', 'dataType', 'itemsDataType', 'dataFormat', 'isRequired', 'referencedSchemaNames'],
			pairByHubToken: judgedPairByHubToken,
		},
	],
});

const bridgeHooksByFacetName = { '': {} };

module.exports = { standardBridging, bridgeHooksByFacetName };
