'use strict';

// usecaseBridging.js — the STANDARD half of every bridge from the use-case standard (useCaseForge-102926 Phase 2a, 2026-10-29;
// lib/bridge-framework/standardBridgingContract.js). Basis DECLARED (the CTDL→CEDS precedent, forges/ctdl/bridges/ctdlBridging.js):
// nothing is judged and nothing is embedded. Every case author's citation of another standard's element, carried by the use-case forge
// VERBATIM on a reference node (citedStandard, citedIdentifier; forges/usecase/lib/usecaseWalk.js), becomes ONE DECLARED_CORRESPONDENCE
// edge from that reference node to the cited standard's BASE node, with the predicate 'edc:cites' verbatim (RULED by SHADOW_MEADOW
// 2026-10-29, Q-U5 as amended: the standard states no predicate, and EDUcore, which owns it, states the relation; first spelled uc:cites, which
// has no expansion in lib/edc-uri/uriScheme.json, so cites is a declared EDUcore vocabulary term there). It is never coerced into a SKOS match.
//
// TWO FACETS, one per hub, because a declared target no rule of the paired hub matches is an ORPHAN (code fact,
// lib/bridge-framework/declaredTargetResolution.js header): one facet walking every citation would orphan each CEDS citation in the CTDL
// pairing. Each facet walks only the citations whose registry key belongs to its hub (bridges/usecaseCitationTargetForm.json):
//   ''              CEDS: subjects the element references citing CEDS (graph-anchored, linkageStatus linked); raw target ceds:{local},
//                   which the CEDS hub's OWN rules ^ceds:(C\d{6})$ / (P\d{6}) / (NI\d+) resolve to the CEDS term IRI (no hub file touched)
//   'CtdlCitation'  CTDL: the citations whose registry key is CTDL. The resolution registry has no CTDL key today, so this facet carries
//                   ZERO assertions until the coalition adds one (TQ, Q15).
// A target the hub's rules cannot resolve is an orphan record named in the frozen block, never dropped. A document-anchored citation
// (W3C-VC, W3C-DID), a whole-standard citation, an orphan element-to-be and a 'proposed' identifier are not walked: they stay on the gap
// list (SPEC §3.3), OpenBadges among them until Phase 2b.
//
// walkSourceAssertions — one assertion per reference node of this facet's hub.
// subjectStableIdFor — identity: the reference node IS the subject.

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const citationTargetForm = require(path.join(__dirname, 'usecaseCitationTargetForm.json'));

const { DME_ROLES } = vocabularyLib;

const CHANNEL_CITATION = 'citationChannel';
const NODE_PROPERTY = Object.freeze({ citedStandard: 'citedStandard', citedIdentifier: 'citedIdentifier', referenceKind: 'referenceKind', resolutionAnchor: 'resolutionAnchor', linkageStatus: 'linkageStatus' });
const CITES_PREDICATE = 'edc:cites';
// the walked population: an element citation, graph-anchored by the standard's own registry, linked by its author
const WALKED_REFERENCE = Object.freeze({ referenceKind: 'element', resolutionAnchor: 'graph', linkageStatus: 'linked' });
const REFERENCE_STABLE_ID_PREFIX = 'usecase:ref/';

const declarationTemplateFor = ({ subjectDiscriminator }) => Object.freeze({
	standardKey: 'usecase',
	pluginVersion: '1.0.0',
	producerKind: 'authored',
	matchBasis: 'declared',
	...(subjectDiscriminator === null ? {} : { subjectDiscriminator }),
	mappingProvider: {
		url: 'https://genericwhite.com/26/educore/useCaseV11/',
		verifiedBy: {
			sessionName: 'RADIANT_HAVEN',
			date: '2026-10-29',
			note: 'The published EDUcore Enhanced Cockburn use-case standard (format v0.11), HTTP 200 by curl on 2026-10-29. Each citation is the case author\'s own { standard, identifier }, read from forges/usecase snapshot 01 (the seven case documents, release 1.0), and each registry key\'s anchor and shorthand from the snapshot\'s resolutionRegistry.json, the standard\'s normative registry.',
		},
	},
	sourceCuriePrefix: { prefix: 'usecase', iri: 'https://w3id.org/EDUcore/UseCase/' },
	subjectCuriePrefix: 'usecase',
	sourceChannelList: [
		{
			channelKey: CHANNEL_CITATION,
			sourceKind: 'forgedGraph',
			tier: 'property',
			disposition: 'walk',
			absentTargetSentinelList: [''],
			channelPropertyList: Object.values(NODE_PROPERTY),
			columnClassification: {
				subjectIdentityColumnList: [],
				tupleFieldColumnList: [NODE_PROPERTY.citedIdentifier],
				sourceLabelColumnList: [],
				carriedRecordColumnList: [],
				evidenceOnlyColumnList: [],
				consistencyCheckColumnList: [],
				ignoredColumnList: [NODE_PROPERTY.citedStandard, NODE_PROPERTY.referenceKind, NODE_PROPERTY.resolutionAnchor, NODE_PROPERTY.linkageStatus],
			},
		},
	],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	tupleFieldColumnMap: {
		canonicalKey: { column: NODE_PROPERTY.citedIdentifier, transform: 'identity' },
	},
	predicateSource: {
		kind: 'declaredPredicate',
		predicateList: [CITES_PREDICATE],
		assertedBy: {
			documentName: 'EDUcore Enhanced Cockburn use cases, release 1.0 (forges/usecase/assets/standardSourceData/01/cases/*.json)',
			citation: "A case document's element citation { kind: 'element', standard, identifier, role } (v011-spec.md, \"Citations: the three worlds\") states that the case cites that element; the standard names no predicate for it, so the predicate written on the edge is EDUcore's declared term edc:cites (https://w3id.org/EDUcore/cites; SHADOW_MEADOW, Q-U5 as amended).",
		},
	},
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	classSideRemodelTable: [],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

const pairRowFor = () => ({
	candidateRetrieval: null,
	candidateRenderingAllowList: null,
	promptIdentifierScan: null,
	blindingOrder: [NODE_PROPERTY.citedIdentifier],
	hubAnchorListLength: null,
	declaredTargetRuleList: 'fromHub',
	remodelTableRef: null,
	hubRemodelTableListLength: null,
});

const FACET_ROW_LIST = Object.freeze([
	Object.freeze({ facetName: '', hubToken: 'ceds', subjectDiscriminator: null }),
	Object.freeze({ facetName: 'CtdlCitation', hubToken: 'ctdl', subjectDiscriminator: 'ctdlCitation' }),
]);

const standardBridging = Object.freeze({
	standardKey: 'usecase',
	bridgeNameStem: 'usecase',
	facetList: FACET_ROW_LIST.map((facetRow) => ({
		facetName: facetRow.facetName,
		declarationTemplate: declarationTemplateFor({ subjectDiscriminator: facetRow.subjectDiscriminator }),
		subjectRenderingAllowList: null,
		pairByHubToken: { [facetRow.hubToken]: pairRowFor() },
	})),
});

// rawTargetFor — the raw target in the form the paired hub's rules accept, or { error } naming what the data file lacks
const rawTargetFor = ({ oneNode, hubToken }) => {
	const template = citationTargetForm.rawTargetTemplateByHubToken[hubToken];
	if (template === undefined) {
		return { error: `usecaseBridging: usecaseCitationTargetForm.json names no rawTargetTemplate for hub '${hubToken}'` };
	}
	const localPart = oneNode.stableId.slice(`${REFERENCE_STABLE_ID_PREFIX}${oneNode.properties[NODE_PROPERTY.citedStandard]}/`.length);
	return { rawTarget: template.replace('{local}', localPart).replace('{identifier}', oneNode.properties[NODE_PROPERTY.citedIdentifier]) };
};

const walkSourceAssertionsFor = ({ hubToken }) => ({ sourceChannelPathByKey, sourceReader, xLog }, callback) => {
	void sourceChannelPathByKey; // a forgedGraph channel names no file
	sourceReader.readSourceNodes({ roleList: [DME_ROLES.EXTERNAL_REFERENCE] }, (readError, nodeList) => {
		if (readError) {
			callback(`usecaseBridging walkSourceAssertions: readSourceNodes: ${readError}`);
			return;
		}
		const walkedNodeList = nodeList
			.filter((oneNode) => Object.keys(WALKED_REFERENCE).every((propertyName) => oneNode.properties[propertyName] === WALKED_REFERENCE[propertyName]))
			.filter((oneNode) => citationTargetForm.hubTokenByCitedStandard[oneNode.properties[NODE_PROPERTY.citedStandard]] === hubToken);
		const assertionList = [];
		let refusal = null;
		walkedNodeList.forEach((oneNode) => {
			if (refusal !== null) {
				return;
			}
			const target = rawTargetFor({ oneNode, hubToken });
			if (target.error) {
				refusal = target.error;
				return;
			}
			assertionList.push({
				channelKey: CHANNEL_CITATION,
				subjectIdentity: { stableId: oneNode.stableId },
				rawTargetList: [{ sourceColumnName: NODE_PROPERTY.citedIdentifier, rawValue: target.rawTarget }],
				tupleFieldValues: { canonicalKey: target.rawTarget },
				sourcePredicate: CITES_PREDICATE,
				sourceLabelByColumn: {},
				sourceNoteByColumn: {},
				carriedRecord: {},
				evidence: { subject: {}, assertion: {} },
				sourceLocator: { channelKey: CHANNEL_CITATION, stableId: oneNode.stableId, rowNumber: 0 },
			});
		});
		if (refusal !== null) {
			callback(refusal);
			return;
		}
		xLog.status(`[usecaseBridging ${hubToken}] walked ${nodeList.length} external reference node(s); ${assertionList.length} cite a ${hubToken} element (graph-anchored, linked)`);
		callback('', { assertionList, channelReport: { [CHANNEL_CITATION]: { rowsRead: assertionList.length, assertionsYielded: assertionList.length, sentinelDropped: 0, malformedRows: 0, valueTierRows: 0 } } });
	});
};

const subjectStableIdFor = ({ subjectIdentityList, sourceReader, xLog }, callback) => {
	void sourceReader;
	const resolutionBySubjectKey = {};
	subjectIdentityList.forEach(({ subjectKey, subjectIdentity }) => {
		resolutionBySubjectKey[subjectKey] = { subjectStableId: subjectIdentity.stableId };
	});
	xLog.status(`[usecaseBridging] subjectStableIdFor: identity over ${subjectIdentityList.length} subject(s)`);
	callback('', { resolutionBySubjectKey });
};

const bridgeHooksByFacetName = FACET_ROW_LIST.reduce((byFacetName, facetRow) => ({ ...byFacetName, [facetRow.facetName]: { walkSourceAssertions: walkSourceAssertionsFor({ hubToken: facetRow.hubToken }), subjectStableIdFor } }), {});

module.exports = { standardBridging, bridgeHooksByFacetName };
