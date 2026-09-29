'use strict';

// sif260928CedsDerivedPlugin.js — the SIF → CEDS DERIVED producer for the sif260928 forge (PLAN small phases §3 D1;
// SPEC-sifStructuralBridge-replacement §5 as amended by §9 A19–A30).
//
// WHAT IT DOES. For every SIF Question the forge minted, the framework finds the CEDS cards whose text is closest
// to the question's own texts, the judge picks one card or none and names the relation, and the answer is written
// onto every SIF Field the question stands for. This file only says HOW: what to search, what the judge may see,
// how a question is split by the CEDS domain of the objects it occurs in, and how an answer is spread onto Fields.
// It is DATA. A derived basis forbids both documentary hooks, so bridgeHooks is empty.
//
// THE FORGE DOES NO BRIDGING (FBB-001; SPEC §9 A20). The forge knows no CEDS domain. The domain of each SIF object
// is a BRIDGE input, objectDomainAssignment.tsv beside this file, checksummed below. It is C2's file rebuilt with
// the seven changes SPEC §9 A30 adopted; never edit it by hand, rebuild it through C2's judgment list.
//
// WHAT THE JUDGE NEVER SEES. SIF's own CEDS ID column reaches a Question as cedsElementId, and it is the answer
// key the yardstick scores against afterwards. It is blinded here AND left off the allow-list, and every prompt
// is scanned in the run for a CEDS identifier: the P and C forms by pattern, and the bare six-digit form SIF's
// column writes (which neither pattern catches) by the 354-id list.
//
// THE REMODEL IS NOT DECLARED (remodelTableRef null), deliberately. The hub's property remodel table is applied
// only by the documentary pool producer; a retrieved pool applies none. It matters to the SCORE, and the
// yardstick scorer applies it to the annotation before its card lookup.

const bridgeDeclaration = Object.freeze({
	bridgeName: 'sif260928CedsDerivedPlugin',
	standardKey: 'sif260928',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'sif260928', iri: 'http://www.sifassociation.org/datamodel/na/4.x#' },
	subjectCuriePrefix: 'sif260928',
	// EMPTY, and required to be: nothing is walked, the subjects come from the graph
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	// every Question the forge minted (about 5,018); a run narrows by window or named set, never by declaration
	subjectSource: { kind: 'graphLabel', label: 'Sif260928Question', scopeStableIdListPath: null },
	// TEXT-NODE MATCHING, NO COHORT VOTE (SPEC §5.2). Each of the question's texts (name, description, contextText)
	// searches the hub's texts. neighbourVote is null because the measured vote HURT SIF (the truth card reached the
	// top 15 for 98.7% of questions on text votes alone, 77.0% with the vote). hitsPerText, minScore and k are D2's
	// sweep cell 3, chosen by the rule committed to DEVLOG-D2 before the first cell (highest specified-target
	// admission with a median pool of at most 40; D1 started at 20 / 0.30 / 20).
	candidateRetrieval: {
		method: 'embedTextVote-v1',
		hitsPerText: 40,
		minScore: 0.30,
		k: 40,
		embeddingModelVersion: 'voyage-4-large',
		neighbourVote: null,
	},
	// THE JUDGE'S VIEW, as an allow-list (SPEC §5.3). objectDomain is not a node property: it is the judgment
	// partition's label, rendered into each unit's prompt (renderedPropertyName below), and the contract requires it
	// here. objectNameSampleList is at most twelve object names; a one-element list reaches the graph as a scalar.
	renderingAllowList: {
		subject: ['name', 'description', 'relativePath', 'contextText', 'instanceCount', 'objectNameSampleList', 'objectDomain'],
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
	// cedsElementId first: it is the SIF column the yardstick scores against. objectName and sharedBlock must NOT
	// appear here, because the judgment partition reads them from the subject and its instances.
	blindingDeclaration: ['cedsElementId', 'cedsId', 'crossRefs', 'cedsOriginalAnchorPropertyName', 'cedsOptionCode', 'cedsOptionOriginalAnchorPropertyName'],
	promptIdentifierScan: {
		identifierPatternList: [
			{ patternName: 'cedsPropertyId', regexSource: 'P\\d{6}' },
			{ patternName: 'cedsClassId', regexSource: 'C\\d{6}' },
		],
		identifierListPath: 'bridges/sif260928CedsIdList.json',
	},
	blockRecordsJudgeConfig: true,
	// each Question's Fields, read once through the forge's Question → Field edge and frozen with its record, so the
	// materialiser writes one edge per Field
	materialisationFanout: { kind: 'edgeFromSubject', edgeType: 'HAS_INSTANCE' },
	// one judgment per (Question, CEDS domain of the objects its Fields sit in). SIF_Metadata questions are one unit
	// whatever objects they are copied into; SIF_ExtendedElements is split like the model (SPEC §9 A20).
	judgmentPartition: {
		kind: 'objectPartitionFile',
		filePath: 'bridges/objectDomainAssignment.tsv',
		sha256: 'a8c7c36f60fcec8f667ab105072e7d807f5503dd15b040322dd267f4884b2f79',
		instanceObjectPropertyName: 'objectName',
		objectColumnName: 'object',
		partitionLabelColumnName: 'cedsDomainName',
		renderedPropertyName: 'objectDomain',
		unpartitionedSubjectRule: { propertyName: 'sharedBlock', valueList: ['SIF_Metadata'] },
	},
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

// NO HOOKS: both documentary hooks are forbidden on a derived basis
const bridgeHooks = {};

module.exports = { bridgeDeclaration, bridgeHooks };
