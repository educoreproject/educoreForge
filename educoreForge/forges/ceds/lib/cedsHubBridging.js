'use strict';

// cedsHubBridging.js — the CEDS hub's HALF of every bridge toward it (lib/bridge-framework/hubBridgingContract.js; R2 of the
// hub-neutral bridge lane, 2026-10-21). Every value is COPIED from what today's CEDS-targeting plugins carry, byte for byte,
// because R3 composes those plugins from this file and their declaration digests must not move (test-hubBridging (c) reads the
// plugins and proves each value). Located by this bundle's parserDescriptor.ini hubBridgingModule; the hub module (hubCeds.js)
// never requires it, so the forged CEDS output and its block ids cannot move by this file (plan trap T4).
//
// candidateRenderingAllowList is the list the ten current-generation derived plugins share. The two older pesc260805 plugins
// render five fields; they keep theirs as a declared pair override (SCARLET_ARROW ruling, 2026-10-21).
// judgeWording.toolCandidateNoun is today's exact text in the judge tool description ("the single best matching CEDS candidate"),
// so rendering it from here re-keys no cached judgment (TQ ruling Q-R1 (i)); R4 does the rendering.

const CEDS_TERM_IRI_PREFIX = 'https://w3id.org/CEDStandards/terms/';

const hubBridging = Object.freeze({
	hubToken: 'ceds',
	candidateRenderingAllowList: ['name', 'propertyDefinition', 'domainName', 'domainDefinition', 'rangeOptionSetName', 'rangeOptionSetDefinition', 'rangeClassName', 'rangeClassDefinition', 'componentIdeaList'],
	promptIdentifierScan: {
		identifierPatternList: [
			{ patternName: 'cedsPropertyId', regexSource: 'P\\d{6}' },
			{ patternName: 'cedsClassId', regexSource: 'C\\d{6}' },
		],
		// ONE list (2,731 CEDS ids), byte-equal to the ten per-plugin copies it replaces in R3 (sha256 a5863edc…)
		identifierListPath: 'lib/cedsHubIdentifierList.json',
	},
	// the names a source forge stamps when it carries CEDS anchors, in the order the plugins blind them
	sourceAnchorBlindingNameList: ['cedsId', 'cedsOriginalAnchorPropertyName', 'cedsOptionCode', 'cedsOptionOriginalAnchorPropertyName'],
	judgeWording: { toolCandidateNoun: 'CEDS candidate' },
	// a declared ceds: CURIE expands to the CEDS term IRI (today's ctdlCedsDeclaredCorrespondence rules)
	declaredTargetRuleList: [
		{ ruleKind: 'memberByNotation', pattern: '^ceds:(\\d{6})/?#(.+)$', containerStableIdTemplate: `${CEDS_TERM_IRI_PREFIX}C{1}`, memberEdgeType: 'HAS_VALUE', memberMatchProperty: 'notation', memberMatchGroup: 2 },
		{ ruleKind: 'stableIdTemplate', pattern: '^ceds:(\\d{6})$', stableIdTemplate: `${CEDS_TERM_IRI_PREFIX}C{1}` },
	],
	termKeyForm: 'absoluteIri',
	embeddingModelVersion: 'voyage-4-large',
	remodelTableRefList: ['ceds14PropertyRemodel'],
	retrievalTier: 'property',
});

module.exports = { hubBridging };
