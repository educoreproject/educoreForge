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
// column writes (which neither pattern catches) by the id list: the 354 ids SIF's column names, widened (phase D4,
// RULING EBONY_DREAM 2026-09-29) to every id the live hub's cards carry, in bare form, 2,731 in all. D3 found a SIF
// description quoting 'CEDS Id 000102', an id outside the 354; over all 6,011 rendered prompts it was the only
// bare six-digit token outside them, so the widened list adds no false positive.
//
// THE REMODEL IS NOT DECLARED (remodelTableRef null), deliberately. The hub's property remodel table is applied
// only by the documentary pool producer; a retrieved pool applies none. It matters to the SCORE, and the
// yardstick scorer applies it to the annotation before its card lookup.

// ⟪hub-neutral bridge lane R3, 2026-10-21⟫ MIGRATED from sif260928CedsDerivedPlugin.js: this file now declares the STANDARD half of the
// bridge; the hub half comes from the hub's own bridging declaration (forges/<hub>/lib/<hub>HubBridging.js) and the two compose
// (lib/bridge-framework/bridgeComposer.js) into the SAME declaration, digest for digest (test-bridgeComposer (a), P-a1).

const declarationTemplate = Object.freeze({
	standardKey: 'sif260928',
	pluginVersion: '1.0.0',
	producerKind: 'inferred',
	matchBasis: 'derived',
	sourceCuriePrefix: { prefix: 'sif260928', iri: 'http://www.sifassociation.org/datamodel/na/4.x#' },
	subjectCuriePrefix: 'sif260928',
	// EMPTY, and required to be: nothing is walked, the subjects come from the graph
	sourceChannelList: [],
	subjectIdentity: { kind: 'forgedNode', property: 'stableId' },
	// every Question the forge minted EXCEPT ONE: 5,017 of 5,018 (goldJev lane A, ruled by QUIET_ORBIT 2026-10-01).
	// The excluded Question (sif260928:question/183a6000…1ca7) carries SIF's own description "This element
	// corresponds to the global CEDS Id 000102": its text names its answer, so the prompt identifier scan
	// (rightly) refuses to show it to the judge. The forge carries SIF's text verbatim (FBB-001), so the subject
	// is left unjudged here, by declaration, rather than redacted. The list file is every Question stableId in
	// the sif260928 base block 576db6546c8f minus that one; regenerate it if the forge's Questions change.
	// Any other narrowing still belongs to the run (window or named set), never to this declaration.
	subjectSource: { kind: 'graphLabel', label: 'Sif260928Question', scopeStableIdListPath: 'bridges/sif260928ScopeWithoutIdentifierLeak.json' },
	judgePromptVariant: 'derivedJudgeSlot',
	// ⟪lane JEVQ, ruling COPPER_RIVER 2026-10-13⟫ THE SPLIT QUESTION'S FORM, per bridge. SIF keeps the instruction form (Claude's
	// prompt as matchingInstructions) and the judge identity it has always had: SIF publishes no definition for its objects
	// (0 of 159 Sif260928Object nodes carry one), so the owning-definition form would only remove the instructions, and the
	// gate measured that SIF then picks more and is wrong more often (DEVLOG-JEVQ §5.2, §5.3, §5C).
	choiceQuestionFormName: 'matchingInstructionsState',
	// the judge names the relation itself through the tool's predicate slot, so no category table is declared
	predicateSource: { kind: 'judge', predicateRule: 'judgeSlot-v1' },
	mappingTool: { name: 'educoreForge bridge-framework derived', version: '1.0.0' },
	evidenceColumnMap: { subject: [], assertion: [] },
	consistencyCheckColumnList: [],
	segmentNormalisationRuleList: [],
	classSideRemodelTable: [],
	blockRecordsJudgeConfig: true,
	// each Question's Fields, read once through the forge's Question → Field edge and frozen with its record, so the
	// materialiser writes one edge per Field
	materialisationFanout: { kind: 'edgeFromSubject', edgeType: 'HAS_INSTANCE' },
	evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
	compatibilityDeclarationList: [],
});

// ⟪zeroBacklog B3⟫ SIF's own answer-key column (see WHAT THE JUDGE NEVER SEES above), named ONCE and blinded by every pair row: it is
// not a hub anchor, so no hub's union supplies it. Hoisted from the ceds row with its value unchanged (P-a1 is the proof).
const SIF_ANSWER_KEY_COLUMN_NAME = 'cedsElementId';

const standardBridging = Object.freeze({
	standardKey: 'sif260928',
	bridgeNameStem: 'sif260928',
	facetList: [
		{
			facetName: '',
			declarationTemplate,
			// (was on candidateRetrieval)
			// TEXT-NODE MATCHING, NO COHORT VOTE (SPEC §5.2). Each of the question's texts (name, description, contextText)
			// searches the hub's texts. neighbourVote is null because the measured vote HURT SIF (the truth card reached the
			// top 15 for 98.7% of questions on text votes alone, 77.0% with the vote). hitsPerText, minScore and k are D2's
			// sweep cell 3, chosen by the rule committed to DEVLOG-D2 before the first cell (highest specified-target
			// admission with a median pool of at most 40; D1 started at 20 / 0.30 / 20).
			// (was on renderingAllowList)
			// THE JUDGE'S VIEW, as an allow-list (SPEC §5.3). objectDomain is not a node property: it is the judgment
			// partition's label, rendered into each unit's prompt (renderedPropertyName below), and the contract requires it
			// here. objectNameSampleList is at most twelve object names; a one-element list reaches the graph as a scalar.
			// (was on blindingDeclaration)
			// cedsElementId first: it is the SIF column the yardstick scores against. objectName and sharedBlock must NOT
			// appear here, because the judgment partition reads them from the subject and its instances.
			subjectRenderingAllowList: ['name', 'description', 'relativePath', 'contextText', 'instanceCount', 'objectNameSampleList', 'objectDomain'],
			pairByHubToken: {
				ceds: {
					candidateRetrieval: { method: 'embedTextVote-v1', hitsPerText: 40, minScore: 0.3, k: 40, neighbourVote: null },
					candidateRenderingAllowList: null,
					promptIdentifierScan: 'fromHubWithLegacyListPath',
					blindingOrder: [SIF_ANSWER_KEY_COLUMN_NAME, { hubAnchor: 0 }, 'crossRefs', { hubAnchor: 1 }, { hubAnchor: 2 }, { hubAnchor: 3 }],
					hubAnchorListLength: 4,
					declaredTargetRuleList: null,
					remodelTableRef: null,
					hubRemodelTableListLength: null,
					// ⟪zeroBacklog A2-5, census row 12 (R7-2); BRONZE_CROWN ruling 2026-10-22⟫ MOVED here from the declarationTemplate: the partition is by
					// the TARGET hub's domains (cedsDomainName), so it belongs to the ceds pairing; byte-identical in what it composes and renders.
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
				},
				// ⟪zeroBacklog B3⟫ toward the CTDL hub, in the post-refactor form: retrieval copied from the row above as the START (its measured
				// k / floor reasoning stands until measured against CTDL), the hub's own candidate list and identifier scan, and the union
				// blinding: this standard's own answer-key names, then every hub it pairs with (computed by the composer, never written here).
				ctdl: {
					// the ceds row's settings (40 / 0.3 / 40), RESTORED (BRONZE_CROWN ruling 2026-10-23). The B3 run used hitsPerText 20 because at 40
					// the frozen block passed V8's string ceiling; the size fix (per-record retrievalHitList, c1da0eb3) took that block from 95% to 55%,
					// and the measured cost of 20 was retrieval, not size: on 200 sampled subjects the pools at 20 and 40 had Jaccard median 0.40.
					candidateRetrieval: { method: 'embedTextVote-v1', hitsPerText: 40, minScore: 0.3, k: 40, neighbourVote: null },
					candidateRenderingAllowList: null,
					promptIdentifierScan: 'fromHub',
					blindingOrder: { standardBlindingNameList: [SIF_ANSWER_KEY_COLUMN_NAME, 'crossRefs'], pairedHubAnchors: 'union' },
					hubAnchorListLength: null,
					declaredTargetRuleList: null,
					remodelTableRef: null,
					hubRemodelTableListLength: null,
					// ⟪zeroBacklog lane B, BRONZE_CROWN ruling 2026-10-23⟫ NO judgment partition for the CTDL pairing: the ceds row's partition
					// (objectDomainAssignment.tsv) splits a question's units by the CEDS domain of its objects, a CEDS structure that must not
					// shape CTDL judging. The ceds pairing declares its own on its row (zeroBacklog A2-5); the template carries none.
					judgmentPartition: null,
				},
			},
		},
	],
});

// NO HOOKS: both documentary hooks are forbidden on a derived basis
const bridgeHooks = {};

const bridgeHooksByFacetName = { '': bridgeHooks };

module.exports = { standardBridging, bridgeHooksByFacetName };
