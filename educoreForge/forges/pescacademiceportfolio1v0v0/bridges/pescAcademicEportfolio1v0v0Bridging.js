'use strict';

// pescAcademicEportfolio1v0v0CedsDerivedPlugin.js — the PESC Academic ePortfolio 1.0.0 → CEDS DERIVED producer
// (WORKORDER-pescForgeBridge-093026 §3 B1, B6; goldJevCampaign BRIEF-E, lane E; College Transcript's plugin as the template; DESIGN-pescBridge.md Revision 3 §1.2, §2, §3, §4.1).
//
// WHAT IT DOES. For every element declaration a Academic ePortfolio can carry (the 1362 the forge marks reachable from
// the root), the framework finds the CEDS cards whose text is closest to the declaration's own texts, and the judge
// picks one card or none and names the relation, ONCE PER DOCUMENT SECTION the declaration occurs in (TQ, Q4): 2542
// units over 1362 subjects. The answer is written onto every occurrence of the declaration in that section, one edge
// per occurrence, each naming the declaration as judgedSubjectStableId. This file only says HOW. It is DATA: a derived
// basis forbids both documentary hooks, so bridgeHooks is empty.
//
// THE FORGE DOES NO BRIDGING (FBB-001). The forge stamps each occurrence with its sectionPath (a path fact). Reading
// the section as a judgment unit is the bridge's decision, made by the partition file beside this file, checksummed
// below. Both files beside this one are DERIVED: rewrite them with
//   node lib/pesc-release-forge/tools/writeScopeAndSections.js --bundle=forges/pescacademiceportfolio1v0v0
//        --outputDir=forges/pescacademiceportfolio1v0v0/bridges
// and restate the sha256 below when the section file moves (a new section is a new block, never a silent drift).
//
// THE PROMPT NAMES NO RELEASE (DESIGN-pescBridge §4.4). Nothing rendered says 1.0.0, the namespace, a file or the
// _source, so an unchanged unit in a later Academic ePortfolio version renders byte-identically and replays from the
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

// ⟪hub-neutral bridge lane R3, 2026-10-21⟫ MIGRATED from pescAcademicEportfolio1v0v0CedsDerivedPlugin.js: this file now declares the STANDARD half of the
// bridge; the hub half comes from the hub's own bridging declaration (forges/<hub>/lib/<hub>HubBridging.js) and the two compose
// (lib/bridge-framework/bridgeComposer.js) into the SAME declaration, digest for digest (test-bridgeComposer (a), P-a1).

const declarationTemplate = Object.freeze({
	standardKey: 'pescacademiceportfolio1v0v0',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'pescacademiceportfolio1v0v0', iri: 'urn:org:pesc:message:AcademicEportfolio:v1.0.0#' },
	// every subject_id is an occurrence's stableId, which begins with the bundle's key
	subjectCuriePrefix: 'pescacademiceportfolio1v0v0',
	// EMPTY, and required to be: nothing is walked, the subjects come from the graph
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	// every element declaration the forge minted, narrowed to the ones a Academic ePortfolio can carry
	subjectSource: { kind: 'graphLabel', label: 'PescAcademicEportfolio1v0v0Element', scopeStableIdListPath: 'bridges/pescAcademicEportfolio1v0v0ReachableSubjects.json' },
	judgePromptVariant: 'derivedJudgeSlotOwningDefinition',
	// ⟪lane JEVQ, ruling COPPER_RIVER 2026-10-13⟫ the split question's form, per bridge: the owning-definition form
	choiceQuestionFormName: 'owningConstructDefinitionState',
	// ⟪lane JEVQ, 2026-10-13⟫ WHAT THE SOURCE ELEMENT BELONGS TO, in PESC's own words, for Jev's split question only (the text
	// prompt is unchanged). The subject names its owner by parentId; the owner carries its published definition in
	// description. Measured on GOLD_EVAL_261013_cedsConcepts: only 685 of the 1,916 Element owner links carry one (named types 655 of 1,853, groups 30 of 46, anonymous types 0 of 17). An owner without one renders
	// none and says so (owningConstructDefinition.js); nothing is borrowed.
	owningConstructDefinitionSource: { kind: 'ownerNodeProperty', ownerReferencePropertyName: 'parentId', definitionPropertyName: 'description' },
	// the judge names the relation itself through the tool's predicate slot, so no category table is declared
	predicateSource: { kind: 'judge', predicateRule: 'judgeSlot-v1' },
	mappingTool: { name: 'educoreForge bridge-framework derived', version: '1.0.0' },
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	classSideRemodelTable: [],
	blockRecordsJudgeConfig: true,
	// each declaration's occurrences, read once through the forge's declaration → occurrence edge and frozen with its
	// record, so the materialiser writes one edge per occurrence
	materialisationFanout: { kind: 'edgeFromSubject', edgeType: 'HAS_INSTANCE' },
	// one judgment per (declaration, second-level document section). Every subject is split: a one-section
	// declaration is one unit carrying its section's label.
	judgmentPartition: {
		kind: 'objectPartitionFile',
		filePath: 'bridges/pescAcademicEportfolio1v0v0SectionPartition.tsv',
		sha256: 'c361288deadd6d7379d0d4ec993e10d03682ebe9634e4fd045f24c39b6457dd5',
		instanceObjectPropertyName: 'sectionPath',
		objectColumnName: 'sectionPath',
		partitionLabelColumnName: 'documentSection',
		renderedPropertyName: 'documentSection',
		unpartitionedSubjectRule: null,
	},
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

const standardBridging = Object.freeze({
	standardKey: 'pescacademiceportfolio1v0v0',
	bridgeNameStem: 'pescAcademicEportfolio1v0v0',
	facetList: [
		{
			facetName: '',
			declarationTemplate,
			// (was on candidateRetrieval)
			// SIF's retrieval cell (D2 sweep cell 3), which College Transcript's B2 sweep kept (DEVLOG-B2). BRIEF-B: this release
			// ships cell 3 unless High School Transcript's sweep beats it by the rule. neighbourVote is null because the measured
			// cohort vote hurt SIF and PESC has not been measured.
			// (was on renderingAllowList)
			// THE JUDGE'S VIEW (DESIGN-pescBridge §2.1). documentSection is not a node property: it is the partition label,
			// rendered into each unit's prompt, and the contract requires it here. contextPathSampleList holds two readable
			// paths from every section the declaration occurs in; a one-element list reaches the graph as a scalar.
			// (was on blindingDeclaration)
			// sectionPath must NOT appear here: the partition reads it from the occurrences, and the contract refuses a
			// partition on a blinded property
			subjectRenderingAllowList: ['documentSection', 'name', 'effectiveDocumentation', 'owningTypeName', 'typeName', 'contextPathSampleList', 'minOccursAsWritten', 'maxOccursAsWritten', 'codeListName', 'codeListDocumentation'],
			pairByHubToken: {
				ceds: {
					candidateRetrieval: { method: 'embedTextVote-v1', hitsPerText: 40, minScore: 0.3, k: 40, neighbourVote: null },
					candidateRenderingAllowList: null,
					promptIdentifierScan: 'fromHubWithLegacyListPath',
					blindingOrder: [{ hubAnchor: 0 }, 'crossRefs', { hubAnchor: 1 }, { hubAnchor: 2 }, { hubAnchor: 3 }],
					hubAnchorListLength: 4,
					declaredTargetRuleList: null,
					remodelTableRef: null,
					hubRemodelTableListLength: null,
				},
				// ⟪zeroBacklog B3⟫ toward the CTDL hub, in the post-refactor form: retrieval copied from the row above as the START (its measured
				// k / floor reasoning stands until measured against CTDL), the hub's own candidate list and identifier scan, and the union
				// blinding: this standard's own answer-key names, then every hub it pairs with (computed by the composer, never written here).
				ctdl: {
					candidateRetrieval: { method: 'embedTextVote-v1', hitsPerText: 40, minScore: 0.3, k: 40, neighbourVote: null },
					candidateRenderingAllowList: null,
					promptIdentifierScan: 'fromHub',
					blindingOrder: { standardBlindingNameList: ['crossRefs'], pairedHubAnchors: 'union' },
					hubAnchorListLength: null,
					declaredTargetRuleList: null,
					remodelTableRef: null,
					hubRemodelTableListLength: null,
				},
			},
		},
	],
});

// NO HOOKS: both documentary hooks are forbidden on a derived basis
const bridgeHooks = {};

const bridgeHooksByFacetName = { '': bridgeHooks };

module.exports = { standardBridging, bridgeHooksByFacetName };
