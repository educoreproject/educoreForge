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
	// ⟪zeroBacklog B2, R3-F2⟫ CTDL's own prose cites CTDL terms ("Subclasses of ceterms:Credential …": 402 cards' domainDefinition, 24
	// cards' propertyDefinition on GOLD_EVAL_261021_ctdlHub), which the scan above refuses. A candidate's prose renders each CURIE as
	// its local name ("Subclasses of Credential"); the pattern is the scan's own prefix alternation, so nothing the scan would catch
	// survives in candidate prose, and a CURIE on the SUBJECT side still refuses.
	renderedProseIdentifierRule: { patternSource: '\\b(?:ceterms|ceasn|qdata):([A-Za-z][A-Za-z0-9_]*)', replacementTemplate: '$1' },
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
