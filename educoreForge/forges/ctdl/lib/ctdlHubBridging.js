'use strict';

// ctdlHubBridging.js — the CTDL hub's HALF of every bridge toward it (lib/bridge-framework/hubBridgingContract.js; R2 of the
// hub-neutral bridge lane, 2026-10-21). Located by this bundle's parserDescriptor.ini hubBridgingModule; the hub module
// (hubCtdl.js) never requires it, so the forged CTDL output and its block ids cannot move by this file (plan trap T4).
//
// COPIED: declaredTargetRuleList (today's ctdlasnCtdlDeclaredCorrespondence rule; test-hubBridging (f) proves it), termKeyForm
// (the as-built term cards are keyed by CURIE), embeddingModelVersion (the model the CTDL hub cards were embedded with in P8),
// retrievalTier. PROPOSED, read by nothing until a JUDGED bridge toward CTDL exists, which must confirm them against the shaped
// CTDL cards it renders: candidateRenderingAllowList, promptIdentifierScan (CTDL CURIEs; no id list), judgeWording.

const hubBridging = Object.freeze({
	hubToken: 'ctdl',
	candidateRenderingAllowList: ['name', 'propertyDefinition', 'domainName', 'domainDefinition', 'rangeClassNameList', 'componentIdeaList'],
	promptIdentifierScan: {
		identifierPatternList: [{ patternName: 'ctdlTermCurie', regexSource: '\\b(?:ceterms|ceasn|qdata):[A-Za-z][A-Za-z0-9_]*' }],
		identifierListPath: null,
	},
	// no source forge stamps CTDL anchors today
	sourceAnchorBlindingNameList: [],
	judgeWording: { toolCandidateNoun: 'CTDL candidate' },
	declaredTargetRuleList: [{ ruleKind: 'stableIdTemplate', pattern: '^(ceterms:[A-Za-z][A-Za-z0-9_]*)$', stableIdTemplate: '{1}' }],
	termKeyForm: 'curie',
	embeddingModelVersion: 'voyage-4-large',
	remodelTableRefList: [],
	retrievalTier: 'property',
});

module.exports = { hubBridging };
