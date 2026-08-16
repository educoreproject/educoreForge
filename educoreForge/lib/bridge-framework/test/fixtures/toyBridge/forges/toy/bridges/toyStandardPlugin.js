'use strict';

// toyStandardPlugin.js — the TOY standard-declared plugin (matchBasis 'standard', forgedGraph channel): the
// second plugin on the SAME pairing, so the composability gate and the conflict detector both have hermetic
// subjects (SPEC-bridgeFramework-v1.md §13, §5.5). The standard's own forged nodes carry the anchor
// (hubAnchorId, a blinded property) — read UNBLINDED through sourceReader.forWalk() over the declared
// channelPropertyList, the SOLE blinding exemption (RULING BF7). Subject identity is the node itself.
// predicateSource is a CHANNEL ASSERTION with a citation (BR-012). Exports EXACTLY { bridgeDeclaration, bridgeHooks }.

const CHANNEL_ANCHOR = 'anchorColumn';

const bridgeDeclaration = Object.freeze({
	bridgeName: 'toyStandardPlugin',
	standardKey: 'toy',
	pluginVersion: '1.0.0',
	producerKind: 'authored',
	matchBasis: 'standard',
	mappingProvider: { url: 'https://toy.example/standard/v1', verifiedBy: { sessionName: 'FROZEN_STREAM', date: '2026-08-16', note: 'toy fixture — declared verified so the export path runs' } },
	sourceCuriePrefix: { prefix: 'toy', iri: 'https://toy.example/standard/v1#' },
	subjectCuriePrefix: 'toy',
	sourceChannelList: [
		{
			channelKey: CHANNEL_ANCHOR,
			sourceKind: 'forgedGraph',
			tier: 'property',
			disposition: 'walk',
			absentTargetSentinelList: [''],
			channelPropertyList: ['hubAnchorId', 'crossRefs'],
			columnClassification: {
				subjectIdentityColumnList: [],
				tupleFieldColumnList: ['hubAnchorId'],
				sourceLabelColumnList: [],
				carriedRecordColumnList: ['crossRefs'],
				evidenceOnlyColumnList: [],
				consistencyCheckColumnList: [],
				ignoredColumnList: [],
			},
		},
	],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	tupleFieldColumnMap: { canonicalKey: { column: 'hubAnchorId', transform: 'identity' } },
	predicateSource: {
		kind: 'channelAssertion',
		predicate: 'exactMatch',
		assertedBy: { documentName: 'ToyStandardSpecification_v1', citation: 'The Hub Global Id column states which hub property the element IS.' },
	},
	evidenceColumnMap: { subject: ['description'], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	remodelTableRef: 'toyRemodel',
	classSideRemodelTable: [],
	blindingDeclaration: ['hubAnchorId', 'crossRefs', 'hubAnchorOriginalPropertyName', 'hubOptionCode', 'hubOptionOriginalPropertyName'],
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	globalGuidanceList: [],
	compatibilityDeclarationList: [],
});

// walkSourceAssertions — reads the standard's own property nodes through the WALK view; every property node is a
// row; the anchor cell is the raw target ('' is the channel sentinel — the framework drops and counts it)
const walkSourceAssertions = ({ sourceChannelPathByKey, sourceReader, xLog }, callback) => {
	void sourceChannelPathByKey; // a forgedGraph channel names no file
	sourceReader.readSourceNodes({ roleList: ['property'] }, (readError, nodeList) => {
		if (readError) {
			callback(readError);
			return;
		}
		const assertionList = nodeList.map((oneNode) => {
			const rawAnchor = oneNode.properties.hubAnchorId;
			const parsedCrossRefs = typeof oneNode.properties.crossRefs === 'string' ? JSON.parse(oneNode.properties.crossRefs) : []; // a JSON string, PARSED IN THE WALK (RULING BF13)
			return {
				channelKey: CHANNEL_ANCHOR,
				subjectIdentity: { stableId: oneNode.stableId },
				rawTargetList: [{ sourceColumnName: 'hubAnchorId', rawValue: rawAnchor === undefined ? '' : String(rawAnchor) }],
				tupleFieldValues: { canonicalKey: rawAnchor === undefined ? '' : String(rawAnchor) },
				sourcePredicate: null,
				sourceLabelByColumn: {},
				sourceNoteByColumn: {},
				carriedRecord: { crossRefs: parsedCrossRefs },
				evidence: { subject: {}, assertion: {} },
				sourceLocator: { channelKey: CHANNEL_ANCHOR, stableId: oneNode.stableId },
			};
		});
		xLog.status(`[toyStandardPlugin] walked ${assertionList.length} property node(s) through forWalk()`);
		callback('', { assertionList, channelReport: { [CHANNEL_ANCHOR]: { rowsRead: nodeList.length, assertionsYielded: assertionList.length, sentinelDropped: 0, malformedRows: 0, valueTierRows: 0 } } });
	});
};

// subjectStableIdFor — identity: the forged node IS the subject (1:1)
const subjectStableIdFor = ({ subjectIdentityList, sourceReader, xLog }, callback) => {
	void sourceReader;
	const resolutionBySubjectKey = {};
	subjectIdentityList.forEach(({ subjectKey, subjectIdentity }) => {
		resolutionBySubjectKey[subjectKey] = { subjectStableId: subjectIdentity.stableId };
	});
	xLog.status(`[toyStandardPlugin] identity resolution over ${subjectIdentityList.length} subject(s)`);
	callback('', { resolutionBySubjectKey });
};

const bridgeHooks = { walkSourceAssertions, subjectStableIdFor };

module.exports = { bridgeDeclaration, bridgeHooks };
