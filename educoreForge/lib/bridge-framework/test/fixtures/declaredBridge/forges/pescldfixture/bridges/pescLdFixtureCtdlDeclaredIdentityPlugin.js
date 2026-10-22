'use strict';

// pescLdFixtureCtdlDeclaredIdentityPlugin.js — ⟪ctdlHub-101926 P6 step 4⟫ the DECLARED-IDENTITY test spoke: a bridge plugin
// over a FIXTURE standard ('PESCLDFixture'), never a PESC forge (no PESC_LD forge is built in this lane). Its subjects are one
// node per row of the REAL PESC_LD v0.0.2 Transcript application profile whose propertyID is a ceterms: IRI (16 rows,
// fixtures/declaredBridge/pescLdCetermsRows.json), each carrying termIri = the row's propertyID VERBATIM. The bridge joins
// that IRI to the CTDL hub's TERM cards (termIriIndex) and emits EXACT_MATCH with matchBasis 'declaredIdentity': the spoke's
// own term IS the hub's term, the same IRI, so nothing is judged and nothing is inferred.
//
// THE IRI FORM. The PESC_LD rows write CURIEs (ceterms:name) and the CTDL term cards carry termIri in the same CURIE form
// (measured on DEV_p5TwoHubs, 2026-10-21), so the transform is identity; no namespace is expanded here.
//
// ⟪zeroBacklog lane C, 2026-10-22⟫ THE HUB'S RULES DECIDE SCOPE AND KEY FORM. A declared-identity bridge now carries the target hub's
// declaredTargetRuleList (stableIdTemplate rules only): a subject key no rule matches is OUT OF THE HUB'S SCOPE (counted, never an
// orphan); a key a rule matches is filled into the template and looked up as a term card's termIri. The rule below is a copy of the
// CTDL hub's own (forges/ctdl/lib/ctdlHubBridging.js), which a composed bridge takes 'fromHub'; this legacy-form fixture states it.

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'vocabulary', 'vocabulary'));

const { DME_ROLES } = vocabularyLib;

const CHANNEL_TERM_IRI = 'termIriChannel';
const NODE_PROPERTY = Object.freeze({ termIri: 'termIri' });
const ABSENT_TERM_IRI_SENTINEL = '';

const bridgeDeclaration = Object.freeze({
	bridgeName: 'pescLdFixtureCtdlDeclaredIdentityPlugin',
	standardKey: 'pescldfixture',
	pluginVersion: '1.0.0',
	producerKind: 'authored',
	matchBasis: 'declaredIdentity',
	mappingProvider: {
		url: 'https://pesc.org/',
		verifiedBy: {
			sessionName: 'STERLING_PORTAL',
			date: '2026-10-21',
			note: 'PESC home page, HTTP 200 by curl -L on 2026-10-21 (redirects to https://pesc.org/). PESC publishes the JSON-LD College Transcript v0.0.2 package whose Transcript application profile (PESC Transcript TAP_v0.0.1.json) is the source of these rows.',
		},
	},
	sourceCuriePrefix: { prefix: 'pescld', iri: 'https://pesc.org/jsonld/collegeTranscript/' },
	subjectCuriePrefix: 'pescldfixture',
	sourceChannelList: [
		{
			channelKey: CHANNEL_TERM_IRI,
			sourceKind: 'forgedGraph',
			tier: 'property',
			disposition: 'walk',
			absentTargetSentinelList: [ABSENT_TERM_IRI_SENTINEL],
			channelPropertyList: [NODE_PROPERTY.termIri],
			columnClassification: {
				subjectIdentityColumnList: [],
				tupleFieldColumnList: [NODE_PROPERTY.termIri],
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
		termIri: { column: NODE_PROPERTY.termIri, transform: 'identity' },
	},
	predicateSource: {
		kind: 'channelAssertion',
		predicate: 'exactMatch',
		assertedBy: {
			documentName: 'PESC Transcript TAP_v0.0.1.json (JSON-LD College Transcript v0.0.2, Application Profile)',
			citation: 'Each application-profile row names its property by IRI in propertyID; a row whose propertyID is ceterms:<term> USES that CTDL term as its own property, the same IRI. Identity of IRI is the assertion; it is not a judgment of meaning.',
		},
	},
	declaredTargetRuleList: [{ ruleKind: 'stableIdTemplate', pattern: '^(ceterms:[A-Za-z][A-Za-z0-9_]*)$', stableIdTemplate: '{1}' }],
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	remodelTableRef: null,
	classSideRemodelTable: [],
	blindingDeclaration: [NODE_PROPERTY.termIri],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

const rawTermIriOf = (termIriValue) => (termIriValue === undefined || termIriValue === null ? ABSENT_TERM_IRI_SENTINEL : String(termIriValue));

const walkSourceAssertions = ({ sourceChannelPathByKey, sourceReader, xLog }, callback) => {
	void sourceChannelPathByKey; // a forgedGraph channel names no file
	sourceReader.readSourceNodes({ roleList: [DME_ROLES.PROPERTY] }, (readError, nodeList) => {
		if (readError) {
			callback(`pescLdFixtureCtdlDeclaredIdentityPlugin walkSourceAssertions: readSourceNodes: ${readError}`);
			return;
		}
		const assertionList = nodeList.map((oneNode) => {
			const rawTermIri = rawTermIriOf(oneNode.properties[NODE_PROPERTY.termIri]);
			return {
				channelKey: CHANNEL_TERM_IRI,
				subjectIdentity: { stableId: oneNode.stableId },
				rawTargetList: [{ sourceColumnName: NODE_PROPERTY.termIri, rawValue: rawTermIri }],
				tupleFieldValues: { termIri: rawTermIri },
				sourcePredicate: null,
				sourceLabelByColumn: {},
				sourceNoteByColumn: {},
				carriedRecord: {},
				evidence: { subject: {}, assertion: {} },
				sourceLocator: { channelKey: CHANNEL_TERM_IRI, stableId: oneNode.stableId },
			};
		});
		xLog.status(`[pescLdFixtureCtdlDeclaredIdentityPlugin] walked ${assertionList.length} fixture row node(s), one termIri each`);
		callback('', { assertionList, channelReport: { [CHANNEL_TERM_IRI]: { rowsRead: nodeList.length, assertionsYielded: assertionList.length, sentinelDropped: 0, malformedRows: 0, valueTierRows: 0 } } });
	});
};

const subjectStableIdFor = ({ subjectIdentityList, sourceReader, xLog }, callback) => {
	void sourceReader;
	const resolutionBySubjectKey = {};
	subjectIdentityList.forEach(({ subjectKey, subjectIdentity }) => {
		resolutionBySubjectKey[subjectKey] = { subjectStableId: subjectIdentity.stableId };
	});
	xLog.status(`[pescLdFixtureCtdlDeclaredIdentityPlugin] subjectStableIdFor: identity over ${subjectIdentityList.length} subject(s)`);
	callback('', { resolutionBySubjectKey });
};

const bridgeHooks = { walkSourceAssertions, subjectStableIdFor };

// ⟪R4⟫ judgeWording: the CTDL hub's own noun (forges/ctdl/lib/ctdlHubBridging.js)
const bridgeTarget = { targetHub: 'ctdl', judgeWording: { toolCandidateNoun: 'CTDL candidate' } };

module.exports = { bridgeDeclaration, bridgeHooks, bridgeTarget };
