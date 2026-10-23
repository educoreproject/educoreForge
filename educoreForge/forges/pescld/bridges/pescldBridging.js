'use strict';

// pescldBridging.js — the STANDARD half of every bridge from PESC_LD (zeroBacklog lane C2; lib/bridge-framework/standardBridgingContract.js).
// ONE facet, basis DECLARED IDENTITY: a PESC_LD shape, profile row or picklist value whose term is a hub's own term IS that hub
// term (the same IRI), so it meets the hub's TERM card by an EXACT_MATCH that nothing judges and nothing infers.
//
// WHAT THIS FILE KNOWS, AND WHAT IT DOES NOT (BRONZE_CROWN ruling, option A; DESIGN-C2-pescLdDeclaredIdentity-102226.md). It knows
// the source's side only: every PESC_LD node that carries a termCurie (the term exactly as the package writes it, forges/pescld) is
// a subject, keyed by that CURIE. Which keys belong to a hub, and how a key becomes the hub's card key, is the HUB's declaration
// (its declaredTargetRuleList, taken 'fromHub' in each pair row): a key no rule of that hub matches is out of its scope and is
// counted, not orphaned; a key a rule matches and no term card holds is an orphan, named in the frozen block. So this file names
// no hub vocabulary, and the same facet pairs with any hub that declares rules.
//
// walkSourceAssertions — one assertion per term-bearing PESC_LD node: termCurie as the tuple field termIri's raw value.
// subjectStableIdFor — identity: the PESC_LD node IS the subject.

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const { DME_ROLES } = vocabularyLib;

const CHANNEL_TERM = 'termCurieChannel';
const NODE_PROPERTY = Object.freeze({ termCurie: 'termCurie' });
const ABSENT_TERM_SENTINEL = '';
// a shape (its target class), a profile row (its property), a picklist value (its concept): the PESC_LD roles that carry a term
const TERM_BEARING_ROLE_LIST = Object.freeze([DME_ROLES.CLASS, DME_ROLES.PROPERTY, DME_ROLES.OPTION_VALUE]);

const declarationTemplate = Object.freeze({
	standardKey: 'pescld',
	pluginVersion: '1.0.0',
	producerKind: 'authored',
	matchBasis: 'declaredIdentity',
	mappingProvider: {
		url: 'https://pesc.org/',
		verifiedBy: {
			sessionName: 'IVORY_TRAIL',
			date: '2026-10-22',
			note: 'PESC home page, HTTP 200 by curl -L on 2026-10-22. PESC publishes the JSON-LD College Transcript package (v0.0.2) whose TAP CSVs are forges/pescld snapshot 01; each term a row, shape or picklist value names is read from those CSVs verbatim.',
		},
	},
	sourceCuriePrefix: { prefix: 'pescld', iri: 'urn:educore:pescld:' },
	subjectCuriePrefix: 'pescld',
	sourceChannelList: [
		{
			channelKey: CHANNEL_TERM,
			sourceKind: 'forgedGraph',
			tier: 'property',
			disposition: 'walk',
			absentTargetSentinelList: [ABSENT_TERM_SENTINEL],
			channelPropertyList: [NODE_PROPERTY.termCurie],
			columnClassification: {
				subjectIdentityColumnList: [],
				tupleFieldColumnList: [NODE_PROPERTY.termCurie],
				sourceLabelColumnList: [],
				carriedRecordColumnList: [],
				evidenceOnlyColumnList: [],
				consistencyCheckColumnList: [],
				ignoredColumnList: [],
			},
		},
	],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	tupleFieldColumnMap: {
		termIri: { column: NODE_PROPERTY.termCurie, transform: 'identity' },
	},
	predicateSource: {
		kind: 'channelAssertion',
		predicate: 'exactMatch',
		assertedBy: {
			documentName: 'PESC Transcript TAP CSVs v0.0.1 (JSON-LD College Transcript package v0.0.2; forges/pescld/assets/standardSourceData/01)',
			citation: 'A shape names the class it targets (shapes.csv target), a profile row names its property (propertyID), a picklist names its concepts (valueConstraint), each by CURIE. A CURIE under a hub vocabulary USES that hub term as its own: identity of IRI is the assertion, not a judgment of meaning.',
		},
	},
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	classSideRemodelTable: [],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

// the pair row every hub takes: nothing rendered (nothing is judged), the standard's own term names blinded beside the paired
// hubs' anchor names (the new-bridge union form, R3), and the hub's own rules, taken as pescldHubPairing.json says for that hub
// (C3: the hubs and their rule-taking are DATA, so this file names none)
const hubPairing = require(path.join(__dirname, 'pescldHubPairing.json'));
const pairRowFor = (declaredTargetRuleListPairValue) => Object.freeze({
	candidateRetrieval: null,
	candidateRenderingAllowList: null,
	promptIdentifierScan: null,
	blindingOrder: { standardBlindingNameList: ['termCurie', 'termIri'], pairedHubAnchors: 'union' },
	hubAnchorListLength: null,
	declaredTargetRuleList: declaredTargetRuleListPairValue,
	remodelTableRef: null,
	hubRemodelTableListLength: null,
});
const pairByHubToken = Object.freeze(Object.fromEntries(Object.entries(hubPairing.declaredTargetRuleListByHubToken).map(([hubToken, pairValue]) => [hubToken, pairRowFor(pairValue)])));

const standardBridging = Object.freeze({
	standardKey: 'pescld',
	bridgeNameStem: 'pescld',
	facetList: [
		{
			facetName: '',
			declarationTemplate,
			subjectRenderingAllowList: null,
			pairByHubToken,
		},
	],
});

const walkSourceAssertions = ({ sourceChannelPathByKey, sourceReader, xLog }, callback) => {
	void sourceChannelPathByKey; // a forgedGraph channel names no file
	sourceReader.readSourceNodes({ roleList: TERM_BEARING_ROLE_LIST }, (readError, nodeList) => {
		if (readError) {
			callback(`pescldBridging walkSourceAssertions: readSourceNodes: ${readError}`);
			return;
		}
		const termNodeList = nodeList.filter((oneNode) => oneNode.properties[NODE_PROPERTY.termCurie] !== undefined && oneNode.properties[NODE_PROPERTY.termCurie] !== null);
		const assertionList = termNodeList.map((oneNode) => {
			const rawTermCurie = String(oneNode.properties[NODE_PROPERTY.termCurie]);
			return {
				channelKey: CHANNEL_TERM,
				subjectIdentity: { stableId: oneNode.stableId },
				rawTargetList: [{ sourceColumnName: NODE_PROPERTY.termCurie, rawValue: rawTermCurie }],
				tupleFieldValues: { termIri: rawTermCurie },
				sourcePredicate: null,
				sourceLabelByColumn: {},
				sourceNoteByColumn: {},
				carriedRecord: {},
				evidence: { subject: {}, assertion: {} },
				sourceLocator: { channelKey: CHANNEL_TERM, stableId: oneNode.stableId },
			};
		});
		// a node with no term (a picklist value written as a bare literal) is not read as a row of this channel at all
		xLog.status(`[pescldBridging] walked ${nodeList.length} PESC_LD shape/row/value node(s); ${assertionList.length} carry a termCurie`);
		callback('', { assertionList, channelReport: { [CHANNEL_TERM]: { rowsRead: assertionList.length, assertionsYielded: assertionList.length, sentinelDropped: 0, malformedRows: 0, valueTierRows: 0 } } });
	});
};

const subjectStableIdFor = ({ subjectIdentityList, sourceReader, xLog }, callback) => {
	void sourceReader;
	const resolutionBySubjectKey = {};
	subjectIdentityList.forEach(({ subjectKey, subjectIdentity }) => {
		resolutionBySubjectKey[subjectKey] = { subjectStableId: subjectIdentity.stableId };
	});
	xLog.status(`[pescldBridging] subjectStableIdFor: identity over ${subjectIdentityList.length} subject(s)`);
	callback('', { resolutionBySubjectKey });
};

const bridgeHooksByFacetName = { '': { walkSourceAssertions, subjectStableIdFor } };

module.exports = { standardBridging, bridgeHooksByFacetName };
