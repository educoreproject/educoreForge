'use strict';

// ctdlCedsDeclaredCorrespondence.js — ⟪ctdlHub-101926 P6 step 5; rulings R6, R-2, R-7⟫ the DECLARED SEAM from CTDL to CEDS: every
// assertion CTDL publishes about a CEDS term, carried by the CTDL forge VERBATIM as declaredCorrespondenceList [{ predicate,
// target }] on its own concept nodes (53 entries on 52 nodes in Release 20260327 and again in Release 20260927, P10: owl:equivalentClass 26, skos:narrowMatch 22,
// skos:relatedMatch 5), becomes ONE DECLARED_CORRESPONDENCE edge to the CEDS BASE node it names, with the predicate verbatim. It is
// never a match edge (TQ question Q-T1): no predicate is translated into EXACT/CLOSE/BROAD/NARROW, and no CEDS hub card is touched.
//
// THE NAMESPACE RULE (declaredTargetRuleList, R-7). CTDL's JSON-LD @context is a URL (https://credreg.net/ctdl/schema/context/json);
// the snapshot does not carry the ceds: expansion, so the rule is stated here as data and was VERIFIED against the CEDS forge's
// stableIds on DEV_p5TwoHubs (CEDS block 45a83bae), 2026-10-21: 53 / 53 resolve, each to exactly one node (DEVLOG-P6 §1.3).
//   ceds:NNNNNN#Label   and   ceds:NNNNNN/#Code   → the CEDS option value under option set C{NNNNNN} (HAS_VALUE) whose notation is
//                                                  the Label or Code (24 and 27 entries)
//   ceds:NNNNNN                                    → the CEDS option set C{NNNNNN} (2 entries, both owl:equivalentClass from a CTDL
//                                                  concept; the property P{NNNNNN} also exists and is NOT the target of a class)
// A target no rule resolves is an ORPHAN record named in the frozen block, never dropped.
//
// walkSourceAssertions — the CTDL native terms that carry declaredCorrespondenceList; one assertion per entry, predicate verbatim.
// subjectStableIdFor — identity: the CTDL node IS the subject.

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const { DME_ROLES } = vocabularyLib;

const CHANNEL_DECLARED = 'declaredCorrespondenceChannel';
const NODE_PROPERTY = Object.freeze({ declaredCorrespondenceList: 'declaredCorrespondenceList' });
// the CTDL native term roles: a subject is a term the spoke itself owns, never the root and its carried foreign entries (Q-T8)
const NATIVE_TERM_ROLE_LIST = Object.freeze([DME_ROLES.CLASS, DME_ROLES.PROPERTY, DME_ROLES.OPTION_SET, DME_ROLES.OPTION_VALUE]);
const CEDS_TERM_IRI_PREFIX = 'https://w3id.org/CEDStandards/terms/';

const bridgeDeclaration = Object.freeze({
	bridgeName: 'ctdlCedsDeclaredCorrespondence',
	standardKey: 'ctdl',
	pluginVersion: '1.0.0',
	producerKind: 'authored',
	matchBasis: 'declared',
	mappingProvider: {
		url: 'https://credreg.net/ctdl/terms',
		verifiedBy: {
			sessionName: 'INDIGO_CASCADE',
			date: '2026-10-21',
			note: 'Credential Engine, publisher of CTDL. curl is refused by the credreg.net Cloudflare challenge; on 2026-10-21 (ctdlHub P10) the page was read through a real Chrome driven by Playwright and states "Release 20260927", "This is the September 2026 CTDL release". The assertions themselves are read from the CTDL forge snapshot 02, Release 20260927 (ctdl-schema.json, sha256 bf5dd4b5c975…). Earlier verification (STERLING_PORTAL, 2026-10-21) was against snapshot 01, Release 20260327.',
		},
	},
	sourceCuriePrefix: { prefix: 'ceterms', iri: 'https://purl.org/ctdl/terms/' },
	subjectCuriePrefix: 'financialAid',
	// the 52 declaring CTDL concepts sit in two concept schemes' namespaces (measured: financialAid 26, support 26)
	additionalSubjectCuriePrefixList: ['support'],
	sourceChannelList: [
		{
			channelKey: CHANNEL_DECLARED,
			sourceKind: 'forgedGraph',
			tier: 'property',
			disposition: 'walk',
			absentTargetSentinelList: [''],
			channelPropertyList: [NODE_PROPERTY.declaredCorrespondenceList],
			columnClassification: {
				subjectIdentityColumnList: [],
				tupleFieldColumnList: [NODE_PROPERTY.declaredCorrespondenceList],
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
		canonicalKey: { column: NODE_PROPERTY.declaredCorrespondenceList, transform: 'identity' },
	},
	predicateSource: {
		kind: 'declaredPredicate',
		predicateList: ['owl:equivalentClass', 'skos:narrowMatch', 'skos:relatedMatch'],
		assertedBy: {
			documentName: 'CTDL schema, Release 20260927 (forges/ctdl/assets/standardSourceData/02/ctdl-schema.json)',
			citation: "Each CTDL concept's own JSON-LD entry states owl:equivalentClass, skos:narrowMatch or skos:relatedMatch with a ceds: target; the CTDL forge carries each statement verbatim as a declaredCorrespondenceList entry { predicate, target } (ctdlHub P1, allowance A2: 53 entries on 52 nodes). The predicate written on the edge is the source's own.",
		},
	},
	declaredTargetRuleList: [
		{ ruleKind: 'memberByNotation', pattern: '^ceds:(\\d{6})/?#(.+)$', containerStableIdTemplate: `${CEDS_TERM_IRI_PREFIX}C{1}`, memberEdgeType: 'HAS_VALUE', memberMatchProperty: 'notation', memberMatchGroup: 2 },
		{ ruleKind: 'stableIdTemplate', pattern: '^ceds:(\\d{6})$', stableIdTemplate: `${CEDS_TERM_IRI_PREFIX}C{1}` },
	],
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	remodelTableRef: null,
	classSideRemodelTable: [],
	blindingDeclaration: [NODE_PROPERTY.declaredCorrespondenceList],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

// declaredEntryListFrom — the carried list is a JSON STRING on the node; a malformed one is a SOURCE fault, refused by name.
// JSON.parse throws on malformed text; the throw is translated ONCE, here (the single-site boundary dispensation
// sifCedsStandardPlugin's crossRefsFrom takes), never used as control flow.
const declaredEntryListFrom = ({ rawText, stableId }) => {
	if (typeof rawText !== 'string') {
		return { error: `ctdlCedsDeclaredCorrespondence: node '${stableId}' carries declaredCorrespondenceList as ${typeof rawText}, not the JSON string the forge stamps` };
	}
	let parsed = null;
	let parseFault = null;
	try {
		parsed = JSON.parse(rawText);
	} catch (parseError) {
		parseFault = parseError.message;
	}
	if (parseFault !== null || !Array.isArray(parsed) || parsed.some((oneEntry) => !oneEntry || typeof oneEntry.predicate !== 'string' || typeof oneEntry.target !== 'string')) {
		return { error: `ctdlCedsDeclaredCorrespondence: node '${stableId}' declaredCorrespondenceList is not a list of { predicate, target } (${parseFault || 'wrong shape'})` };
	}
	return { entryList: parsed };
};

const walkSourceAssertions = ({ sourceChannelPathByKey, sourceReader, xLog }, callback) => {
	void sourceChannelPathByKey; // a forgedGraph channel names no file
	sourceReader.readSourceNodes({ roleList: NATIVE_TERM_ROLE_LIST }, (readError, nodeList) => {
		if (readError) {
			callback(`ctdlCedsDeclaredCorrespondence walkSourceAssertions: readSourceNodes: ${readError}`);
			return;
		}
		const assertionList = [];
		let refusal = null;
		const declaringNodeList = nodeList.filter((oneNode) => oneNode.properties[NODE_PROPERTY.declaredCorrespondenceList] !== undefined && oneNode.properties[NODE_PROPERTY.declaredCorrespondenceList] !== null);
		declaringNodeList.forEach((oneNode) => {
			if (refusal !== null) {
				return;
			}
			const carried = declaredEntryListFrom({ rawText: oneNode.properties[NODE_PROPERTY.declaredCorrespondenceList], stableId: oneNode.stableId });
			if (carried.error) {
				refusal = carried.error;
				return;
			}
			carried.entryList.forEach((oneEntry, entryIndex) => {
				assertionList.push({
					channelKey: CHANNEL_DECLARED,
					subjectIdentity: { stableId: oneNode.stableId },
					rawTargetList: [{ sourceColumnName: NODE_PROPERTY.declaredCorrespondenceList, rawValue: oneEntry.target }],
					tupleFieldValues: { canonicalKey: oneEntry.target },
					sourcePredicate: oneEntry.predicate,
					sourceLabelByColumn: {},
					sourceNoteByColumn: {},
					carriedRecord: {},
					evidence: { subject: {}, assertion: {} },
					sourceLocator: { channelKey: CHANNEL_DECLARED, stableId: oneNode.stableId, rowNumber: entryIndex },
				});
			});
		});
		if (refusal !== null) {
			callback(refusal);
			return;
		}
		xLog.status(`[ctdlCedsDeclaredCorrespondence] walked ${nodeList.length} CTDL native term(s); ${declaringNodeList.length} carry declaredCorrespondenceList; ${assertionList.length} declared assertion(s)`);
		callback('', { assertionList, channelReport: { [CHANNEL_DECLARED]: { rowsRead: assertionList.length, assertionsYielded: assertionList.length, sentinelDropped: 0, malformedRows: 0, valueTierRows: 0 } } });
	});
};

const subjectStableIdFor = ({ subjectIdentityList, sourceReader, xLog }, callback) => {
	void sourceReader;
	const resolutionBySubjectKey = {};
	subjectIdentityList.forEach(({ subjectKey, subjectIdentity }) => {
		resolutionBySubjectKey[subjectKey] = { subjectStableId: subjectIdentity.stableId };
	});
	xLog.status(`[ctdlCedsDeclaredCorrespondence] subjectStableIdFor: identity over ${subjectIdentityList.length} subject(s)`);
	callback('', { resolutionBySubjectKey });
};

const bridgeHooks = { walkSourceAssertions, subjectStableIdFor };

// the TARGET STANDARD: a declared bridge reaches CEDS's base nodes, not its hub cards (objectKind baseNode, ruling R-2)
const bridgeTarget = { targetHub: 'ceds' };

module.exports = { bridgeDeclaration, bridgeHooks, bridgeTarget };
