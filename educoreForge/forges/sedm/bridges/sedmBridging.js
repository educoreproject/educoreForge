'use strict';

// sedmBridging.js — the STANDARD half of SEDM's bridges (nextStandards-102326 wave 2, lane G; lib/bridge-framework/standardBridgingContract.js;
// DESIGN-G0-sedm-102426.md §7-8, BRONZE_CROWN rulings 2026-10-24). TWO facets; which hub each pairs with, and every hub-named value, is
// DATA in sedmHubPairing.json, so this file names no hub. The forge does no bridging (FBB-001); this file is where SEDM meets a hub.
//
// FACET '' — DECLARED IDENTITY, nothing judged (PESC_LD's C3 form). The working documents name, per SEDM element, the element of
// another standard it annotates, by that element's identifier (the forge carries the cell verbatim as globalIdText). The walk below
// writes each such cell as the CURIE the paired hub's own term rules resolve, by the form the pairing data declares for that hub
// (rawValuePatternSource -> curieTemplate): the hub's rules then decide scope and key exactly as for any other declared standard. A cell
// that matches neither the pattern nor a declared absent sentinel REFUSES by name; a sentinel cell is walked as itself and dropped by
// the channel's absentTargetSentinelList (counted). A CURIE whose term no card holds is an orphan, named in the frozen block.
//
// FACET 'Element' — JUDGED (the LIF / Open Badges form): every SedmElement a subject, judgeSlot-v1, Jev; the judged pair row is Open
// Badges' (itself PESC_LD's). THE JUDGE'S VIEW of an element: its name, its path (entity / category / name), its definition, its format.
// The identifier cells (globalIdText, edfiMapText) are blinded: another standard's identifier is an answer key, never evidence.
// No class facet: SEDM's entities carry no definitions (the LIF ruling).

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
const hubPairing = require(path.join(__dirname, 'sedmHubPairing.json'));

const { DME_ROLES } = vocabularyLib;

const CHANNEL_IDENTIFIER = 'identifierCurieChannel';
const JUDGED_FACET_NAME = 'Element';
const JUDGED_SUBJECT_LABEL = 'SedmElement';
const GROUP_REFERENCE_PATTERN = /\{(\d+)\}/g;

// the ONE declared-identity hub this facet pairs with: the pairing data names exactly one identifier form
const declaredHubTokenList = Object.keys(hubPairing.declaredIdentifierFormByHubToken);
if (declaredHubTokenList.length !== 1 || Object.keys(hubPairing.declaredTargetRuleListByHubToken).join() !== declaredHubTokenList.join()) {
	throw refuse.byName({ moduleName: 'sedmBridging', what: `sedmHubPairing.json names identifier forms for [${declaredHubTokenList.join(', ')}] and rule-taking for [${Object.keys(hubPairing.declaredTargetRuleListByHubToken).join(', ')}]`, where: 'the declared-identity facet pairs with ONE hub, which the pairing data names in both maps' });
}
const identifierForm = hubPairing.declaredIdentifierFormByHubToken[declaredHubTokenList[0]];
const identifierPattern = new RegExp(identifierForm.rawValuePatternSource);

const declarationTemplate = Object.freeze({
	standardKey: 'sedm',
	pluginVersion: '1.0.0',
	producerKind: 'authored',
	matchBasis: 'declaredIdentity',
	mappingProvider: hubPairing.declaredMappingProvider,
	sourceCuriePrefix: { prefix: 'sedm', iri: 'urn:educore:sedm:' },
	subjectCuriePrefix: 'sedm',
	sourceChannelList: [
		{
			channelKey: CHANNEL_IDENTIFIER,
			sourceKind: 'forgedGraph',
			tier: 'property',
			disposition: 'walk',
			absentTargetSentinelList: identifierForm.absentTargetSentinelList,
			channelPropertyList: [identifierForm.sourcePropertyName],
			columnClassification: {
				subjectIdentityColumnList: [],
				tupleFieldColumnList: [identifierForm.sourcePropertyName],
				sourceLabelColumnList: [],
				carriedRecordColumnList: [],
				evidenceOnlyColumnList: [],
				consistencyCheckColumnList: [],
				ignoredColumnList: [],
			},
		},
	],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	// the walk hands the cell already written in the hub's CURIE form (above), so the tuple transform is the identity
	tupleFieldColumnMap: {
		termIri: { column: identifierForm.sourcePropertyName, transform: 'identity' },
	},
	predicateSource: {
		kind: 'channelAssertion',
		predicate: 'exactMatch',
		assertedBy: hubPairing.declaredAssertedBy,
	},
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	classSideRemodelTable: [],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

// the declared pair row: nothing rendered (nothing is judged), this standard's identifier cells blinded beside the paired hubs' anchor
// names (the new-bridge union form), the hub's own rules taken as the pairing data says
const declaredPairRowFor = (declaredTargetRuleListPairValue) => Object.freeze({
	candidateRetrieval: null,
	candidateRenderingAllowList: null,
	promptIdentifierScan: null,
	blindingOrder: { standardBlindingNameList: ['globalIdText', 'edfiMapText'], pairedHubAnchors: 'union' },
	hubAnchorListLength: null,
	declaredTargetRuleList: declaredTargetRuleListPairValue,
	remodelTableRef: null,
	hubRemodelTableListLength: null,
});

const judgedDeclarationTemplate = Object.freeze({
	standardKey: 'sedm',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'sedm', iri: 'urn:educore:sedm:' },
	subjectCuriePrefix: 'sedm',
	// EMPTY: nothing is walked; a derived producer opens no file
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	subjectSource: { kind: 'graphLabel', label: JUDGED_SUBJECT_LABEL, scopeStableIdListPath: null },
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
// Open Badges' judged pair row (itself PESC_LD's): embedText retrieval at 40 hits per text and k 40, the hub's own identifier scan, and
// the union blinding (this standard's identifier cells, then every paired hub's anchors)
const judgedPairRow = Object.freeze({
	candidateRetrieval: { method: 'embedTextVote-v1', hitsPerText: 40, minScore: 0.3, k: 40, neighbourVote: null },
	candidateRenderingAllowList: null,
	promptIdentifierScan: 'fromHub',
	blindingOrder: { standardBlindingNameList: ['globalIdText', 'edfiMapText'], pairedHubAnchors: 'union' },
	hubAnchorListLength: null,
	declaredTargetRuleList: null,
	remodelTableRef: null,
	hubRemodelTableListLength: null,
});

const standardBridging = Object.freeze({
	standardKey: 'sedm',
	bridgeNameStem: 'sedm',
	facetList: [
		{
			facetName: '',
			declarationTemplate,
			subjectRenderingAllowList: null,
			pairByHubToken: Object.freeze(Object.fromEntries(Object.entries(hubPairing.declaredTargetRuleListByHubToken).map(([hubToken, pairValue]) => [hubToken, declaredPairRowFor(pairValue)]))),
		},
		{
			facetName: JUDGED_FACET_NAME,
			declarationTemplate: judgedDeclarationTemplate,
			subjectRenderingAllowList: ['name', 'path', 'description', 'format'],
			pairByHubToken: Object.freeze(Object.fromEntries(hubPairing.judgedHubTokenList.map((hubToken) => [hubToken, judgedPairRow]))),
		},
	],
});

// curieOf — a cell written in the hub's CURIE form: { curieText } | { refusalText }; a sentinel is returned as itself (the channel drops it)
const curieOf = ({ cellText, stableId }) => {
	if (identifierForm.absentTargetSentinelList.indexOf(cellText) !== -1) {
		return { curieText: cellText };
	}
	const cellMatch = cellText.match(identifierPattern);
	if (cellMatch === null) {
		return { refusalText: `sedmBridging walkSourceAssertions REFUSED: ${stableId} ${identifierForm.sourcePropertyName} ${JSON.stringify(cellText)} matches neither ${identifierForm.rawValuePatternSource} nor a declared sentinel (${JSON.stringify(identifierForm.absentTargetSentinelList)}); an identifier is never repaired (sedmHubPairing.json)` };
	}
	return { curieText: identifierForm.curieTemplate.replace(GROUP_REFERENCE_PATTERN, (wholeReference, groupNumberText) => cellMatch[Number(groupNumberText)]) };
};

const walkSourceAssertions = ({ sourceChannelPathByKey, sourceReader, xLog }, callback) => {
	void sourceChannelPathByKey; // a forgedGraph channel names no file
	sourceReader.readSourceNodes({ roleList: [DME_ROLES.PROPERTY] }, (readError, nodeList) => {
		if (readError) {
			callback(`sedmBridging walkSourceAssertions: readSourceNodes: ${readError}`);
			return;
		}
		const carryingNodeList = nodeList.filter((oneNode) => oneNode.properties[identifierForm.sourcePropertyName] !== undefined && oneNode.properties[identifierForm.sourcePropertyName] !== null);
		const curieList = carryingNodeList.map((oneNode) => curieOf({ cellText: String(oneNode.properties[identifierForm.sourcePropertyName]), stableId: oneNode.stableId }));
		const refusedCurie = curieList.find((oneCurie) => oneCurie.refusalText !== undefined);
		if (refusedCurie !== undefined) {
			callback(refusedCurie.refusalText);
			return;
		}
		const assertionList = carryingNodeList.map((oneNode, nodeIndex) => ({
			channelKey: CHANNEL_IDENTIFIER,
			subjectIdentity: { stableId: oneNode.stableId },
			rawTargetList: [{ sourceColumnName: identifierForm.sourcePropertyName, rawValue: curieList[nodeIndex].curieText }],
			tupleFieldValues: { termIri: curieList[nodeIndex].curieText },
			sourcePredicate: null,
			sourceLabelByColumn: {},
			sourceNoteByColumn: {},
			carriedRecord: {},
			evidence: { subject: {}, assertion: {} },
			sourceLocator: { channelKey: CHANNEL_IDENTIFIER, stableId: oneNode.stableId },
		}));
		// an element whose cell is empty carries no globalIdText at all and is not a row of this channel
		xLog.status(`[sedmBridging] walked ${nodeList.length} SEDM element(s); ${assertionList.length} carry ${identifierForm.sourcePropertyName}`);
		callback('', { assertionList, channelReport: { [CHANNEL_IDENTIFIER]: { rowsRead: assertionList.length, assertionsYielded: assertionList.length, sentinelDropped: 0, malformedRows: 0, valueTierRows: 0 } } });
	});
};

const subjectStableIdFor = ({ subjectIdentityList, sourceReader, xLog }, callback) => {
	void sourceReader;
	const resolutionBySubjectKey = {};
	subjectIdentityList.forEach(({ subjectKey, subjectIdentity }) => {
		resolutionBySubjectKey[subjectKey] = { subjectStableId: subjectIdentity.stableId };
	});
	xLog.status(`[sedmBridging] subjectStableIdFor: identity over ${subjectIdentityList.length} subject(s)`);
	callback('', { resolutionBySubjectKey });
};

// NO HOOKS on the judged facet: both documentary hooks are forbidden on a derived basis
const bridgeHooksByFacetName = { '': { walkSourceAssertions, subjectStableIdFor }, [JUDGED_FACET_NAME]: {} };

module.exports = { standardBridging, bridgeHooksByFacetName };
