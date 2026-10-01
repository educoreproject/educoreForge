'use strict';

// pescDocumentResponse1v0v0CedsDerivedPlugin.js — the PESC Document Response 1.0.0 → CEDS DERIVED producer
// (WORKORDER-pescForgeBridge-093026 §3 B1, B6; goldJevCampaign BRIEF-B, lane B2x; College Transcript's plugin as the template; DESIGN-pescBridge.md Revision 3 §1.2, §2, §3, §4.1).
//
// WHAT IT DOES. For every element declaration a Document Response can carry (the 189 the forge marks reachable from
// the root), the framework finds the CEDS cards whose text is closest to the declaration's own texts, and the judge
// picks one card or none and names the relation, ONCE PER DOCUMENT SECTION the declaration occurs in (TQ, Q4): 396
// units over 189 subjects. The answer is written onto every occurrence of the declaration in that section, one edge
// per occurrence, each naming the declaration as judgedSubjectStableId. This file only says HOW. It is DATA: a derived
// basis forbids both documentary hooks, so bridgeHooks is empty.
//
// THE FORGE DOES NO BRIDGING (FBB-001). The forge stamps each occurrence with its sectionPath (a path fact). Reading
// the section as a judgment unit is the bridge's decision, made by the partition file beside this file, checksummed
// below. Both files beside this one are DERIVED: rewrite them with
//   node lib/pesc-release-forge/tools/writeScopeAndSections.js --bundle=forges/pescdocumentresponse1v0v0
//        --outputDir=forges/pescdocumentresponse1v0v0/bridges
// and restate the sha256 below when the section file moves (a new section is a new block, never a silent drift).
//
// THE PROMPT NAMES NO RELEASE (DESIGN-pescBridge §4.4). Nothing rendered says 1.0.0, the namespace, a file or the
// _source, so an unchanged unit in a later Document Response version renders byte-identically and replays from the
// judgment cache. typeQName, targetNamespace, occurrenceSectionList, releaseIndependentId, definitionDigest, every
// stableId and path stay off the allow-list for that reason. contextText is embedded for retrieval but NOT rendered:
// it is the declaration's FIRST path, which for a spanning declaration lies in another section than the unit judged.
//
// THE RENDERER SORTS. The subject lines are printed in alphabetical order of their names (evidenceRenderer.js
// renderKeyValueLines), so documentSection is one line among the others, not the first.
//
// NO CEDS ANSWER KEY. PESC publishes no CEDS column; the blinding list keeps the hub's own id-bearing names off by name
// should a later edition carry one, and the scan refuses any CEDS identifier in a rendered prompt: the P and C forms by
// pattern, the bare six-digit form by the id list beside this file (a copy of the SIF list, 2,731 ids, because a
// plugin's paths resolve against its own bundle).

const bridgeDeclaration = Object.freeze({
	bridgeName: 'pescDocumentResponse1v0v0CedsDerivedPlugin',
	standardKey: 'pescdocumentresponse1v0v0',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'pescdocumentresponse1v0v0', iri: 'urn:org:pesc:message:DocumentResponse:v1.0.0#' },
	// every subject_id is an occurrence's stableId, which begins with the bundle's key
	subjectCuriePrefix: 'pescdocumentresponse1v0v0',
	// EMPTY, and required to be: nothing is walked, the subjects come from the graph
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	// every element declaration the forge minted, narrowed to the ones a Document Response can carry
	subjectSource: { kind: 'graphLabel', label: 'PescDocumentResponse1v0v0Element', scopeStableIdListPath: 'bridges/pescDocumentResponse1v0v0ReachableSubjects.json' },
	// SIF's retrieval cell (D2 sweep cell 3), which College Transcript's B2 sweep kept (DEVLOG-B2). BRIEF-B: this release
	// ships cell 3 unless High School Transcript's sweep beats it by the rule. neighbourVote is null because the measured
	// cohort vote hurt SIF and PESC has not been measured.
	candidateRetrieval: {
		method: 'embedTextVote-v1',
		hitsPerText: 40,
		minScore: 0.30,
		k: 40,
		embeddingModelVersion: 'voyage-4-large',
		neighbourVote: null,
	},
	// THE JUDGE'S VIEW (DESIGN-pescBridge §2.1). documentSection is not a node property: it is the partition label,
	// rendered into each unit's prompt, and the contract requires it here. contextPathSampleList holds two readable
	// paths from every section the declaration occurs in; a one-element list reaches the graph as a scalar.
	renderingAllowList: {
		subject: ['documentSection', 'name', 'effectiveDocumentation', 'owningTypeName', 'typeName', 'contextPathSampleList', 'minOccursAsWritten', 'maxOccursAsWritten', 'codeListName', 'codeListDocumentation'],
		candidate: ['name', 'propertyDefinition', 'domainName', 'domainDefinition', 'rangeOptionSetName', 'rangeOptionSetDefinition', 'rangeClassName', 'rangeClassDefinition', 'componentIdeaList'],
	},
	judgePromptVariant: 'derivedJudgeSlot',
	// the judge names the relation itself through the tool's predicate slot, so no category table is declared
	predicateSource: { kind: 'judge', predicateRule: 'judgeSlot-v1' },
	mappingTool: { name: 'educoreForge bridge-framework derived', version: '1.0.0' },
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	remodelTableRef: null,
	classSideRemodelTable: [],
	// sectionPath must NOT appear here: the partition reads it from the occurrences, and the contract refuses a
	// partition on a blinded property
	blindingDeclaration: ['cedsId', 'crossRefs', 'cedsOriginalAnchorPropertyName', 'cedsOptionCode', 'cedsOptionOriginalAnchorPropertyName'],
	promptIdentifierScan: {
		identifierPatternList: [
			{ patternName: 'cedsPropertyId', regexSource: 'P\\d{6}' },
			{ patternName: 'cedsClassId', regexSource: 'C\\d{6}' },
		],
		identifierListPath: 'bridges/pescDocumentResponse1v0v0CedsIdList.json',
	},
	blockRecordsJudgeConfig: true,
	// each declaration's occurrences, read once through the forge's declaration → occurrence edge and frozen with its
	// record, so the materialiser writes one edge per occurrence
	materialisationFanout: { kind: 'edgeFromSubject', edgeType: 'HAS_INSTANCE' },
	// one judgment per (declaration, second-level document section). Every subject is split: a one-section
	// declaration is one unit carrying its section's label.
	judgmentPartition: {
		kind: 'objectPartitionFile',
		filePath: 'bridges/pescDocumentResponse1v0v0SectionPartition.tsv',
		sha256: '635d3e6cf47f9df735a703b1c2e73cd615a7886f7947ed1a9f492fce3b0a9484',
		instanceObjectPropertyName: 'sectionPath',
		objectColumnName: 'sectionPath',
		partitionLabelColumnName: 'documentSection',
		renderedPropertyName: 'documentSection',
		unpartitionedSubjectRule: null,
	},
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

// NO HOOKS: both documentary hooks are forbidden on a derived basis
const bridgeHooks = {};

module.exports = { bridgeDeclaration, bridgeHooks };
