#!/usr/bin/env node
'use strict';

// test-bgMaterialisationFanout.js — BG-FANOUT: each judged record frozen with the instances its answer is written to,
// read through a declared edge (PLAN-sifReplacement-smallPhases §3 B4a; SPEC-sifStructuralBridge-replacement §9 A10),
// plus the oracle conjuncts B4a owes (§1.6 R1, §1.7).
//
//   BG-FANOUT  (a) each record's instanceStableIdList equals the graph's instance edges for its subject; (b) the list is
//              canonical: frozen sorted although the reader hands it over in graph order, and the block id equals a run
//              whose graph lists the edges already sorted; (c) a subject with no instance is refused by name;
//              (f) fan-out is admitted on the derived basis only, and refused under a row that does not admit it;
//              (g) a partition without fan-out is refused by name; (h) the declaration's shape: an undeclared member
//              and an unregistered kind are refused.
//   BG-FANOUT-ORACLE  (R1) run E's frozen block parses unchanged and keeps its id; (d, §1.7) with the key absent the toy
//              derived block equals the branch-cut text with frameworkFingerprint masked, (m) unmasked it differs in
//              that key alone, and (o) the key is optional: absent, no record carries the field.
//
// Run: node lib/bridge-framework/test/test-bgMaterialisationFanout.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-FANOUT + BG-FANOUT-ORACLE

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const instanceScenarioLib = require('./testSupport/toyInstanceScenario');
const { runConjunct, pureConjunct, succeeded, frameworkMutationTwin, scenarioTwin, refusalCase, blockOf, frameworkFile } = require('./testSupport/bridgeTwinFactories');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const FRAMEWORK_FILE = 'bridge-framework.js';
const CONTRACT_FILE = 'bridgePluginContract.js';
const FANOUT_FILE = 'materialisationFanout.js';
const DECISION_BLOCK_FILE = 'decisionBlock.js';
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const { IDENTIFIER_QUESTION, TIMESTAMP_QUESTION, derivedShape, instanceShapeWith } = instanceScenarioLib;
const instanceShape = instanceShapeWith();

// the frozen literals this phase is measured against
const INSTANCE_LIST_LITERAL_BY_SUBJECT = Object.freeze({
	[IDENTIFIER_QUESTION]: Object.freeze(['toy:field/StaffRecord.Identifier', 'toy:field/StudentEnrollment.Identifier', 'toy:field/StudentRecord.Identifier']),
	[TIMESTAMP_QUESTION]: Object.freeze(['toy:field/StaffRecord.Timestamp', 'toy:field/StudentRecord.Timestamp']),
});
const BRANCH_CUT_BLOCK_PATH = path.join(__dirname, 'fixtures', 'toyBridge', 'branchCutBlocks', 'toyDerivedPlugin-B4abranchCut-6ac1824.frozenText.json');
const RUN_E_BLOCK_PATH = path.join(TREE_ROOT, '..', '..', 'dataStores', 'bridgeAcceptance', 'edfiEval', 'runE_091726', 'block.json');
const RUN_E_BLOCK_ID = '7e362cebe7bb74d572e643eed37944d2577eb850313028bc0b9eb11f245c8755';
const FRAMEWORK_FINGERPRINT_TEXT_RE = /"frameworkFingerprint":"[0-9a-f]{64}"/g;
const FANOUT_RECORD_FIELD_NAME = 'instanceStableIdList';

const hasOwn = (candidate, propertyName) => Object.prototype.hasOwnProperty.call(candidate, propertyName);
const instanceListBySubjectOf = (outcome) =>
	blockOf(outcome).decisionRecordList.reduce((soFar, oneRecord) => ({ ...soFar, [oneRecord.subjectStableId]: hasOwn(oneRecord, FANOUT_RECORD_FIELD_NAME) ? oneRecord.instanceStableIdList : 'ABSENT' }), {});
const frozenTextOf = (outcome) => outcome.stores.decisionStore.rowList.find((oneRow) => oneRow.decisionBlockHash === outcome.runReport.decisionBlock.decisionBlockHash).frozenText;

// ---------------------------------------------------------------------
// BG-FANOUT (a) the list equals the graph's edges
// ---------------------------------------------------------------------
const LIST_SPREAD_FIND = '...(oneLeaf.instanceStableIdList === undefined ? {} : { instanceStableIdList: oneLeaf.instanceStableIdList }),';
const listConjunctList = [
	runConjunct({
		conjunctId: 'a_recordListEqualsGraphEdges',
		title: "(a) with fan-out declared and no partition, each of the two question records carries instanceStableIdList equal to its subject's HAS_INSTANCE edges (the literal lists), and nothing else is a record",
		twinNameList: ['instanceEdgeDropped', 'recordOmitsList'],
		shape: instanceShape,
		judge: succeeded((runReport, outcome) => {
			const listBySubject = instanceListBySubjectOf(outcome);
			return { pass: JSON.stringify(listBySubject) === JSON.stringify(INSTANCE_LIST_LITERAL_BY_SUBJECT), detail: JSON.stringify(listBySubject) };
		}),
	}),
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-FANOUT', conjunctId: 'a_recordListEqualsGraphEdges', twinName: 'instanceEdgeDropped', leverKind: 'inputFault', mutate: (scenario) => { scenario.instanceEdgeFilter = (oneEdge) => oneEdge.toStableId !== 'toy:field/StudentEnrollment.Identifier'; } });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-FANOUT', conjunctId: 'a_recordListEqualsGraphEdges', twinName: 'recordOmitsList', fileName: FRAMEWORK_FILE, find: LIST_SPREAD_FIND, replace: '' });

// ---------------------------------------------------------------------
// BG-FANOUT (b) the list is canonical: two runs, graph order and sorted order, freeze the same block
// ---------------------------------------------------------------------
const sortedEdgeShape = (scenario) => {
	instanceShape(scenario);
	scenario.graph.edgeList = scenario.graph.edgeList.slice().sort((leftEdge, rightEdge) => (`${leftEdge.fromStableId} ${leftEdge.toStableId}` < `${rightEdge.fromStableId} ${rightEdge.toStableId}` ? -1 : 1));
};
const canonicalConjunctList = [
	{
		conjunctId: 'b_listCanonicalAndBlockIdUnmoved',
		title: '(b) the reader hands each list over in graph order (unsorted in the toy); the frozen lists are sorted, and the block id equals that of the same run over a graph listing the edges already sorted',
		twinNameList: ['freezeDoesNotSortList'],
		evaluate: (scenario, callback) => {
			const sortedScenario = scenarioLib.cloneScenario(scenario);
			instanceShape(scenario);
			sortedEdgeShape(sortedScenario);
			scenarioLib.runScenario(scenario, (unusedGraphOrderError, graphOrderOutcome) => {
				scenarioLib.runScenario(sortedScenario, (unusedSortedError, sortedOutcome) => {
					const failedOutcome = [graphOrderOutcome, sortedOutcome].find((oneOutcome) => oneOutcome.runError || oneOutcome.constructionError || oneOutcome.thrownFromRun);
					if (failedOutcome !== undefined) {
						callback('', { pass: false, detail: `a run failed: ${failedOutcome.runError || failedOutcome.constructionError || failedOutcome.thrownFromRun}` });
						return;
					}
					const listBySubject = instanceListBySubjectOf(graphOrderOutcome);
					const listsSorted = JSON.stringify(listBySubject) === JSON.stringify(INSTANCE_LIST_LITERAL_BY_SUBJECT);
					const graphOrderBlockId = graphOrderOutcome.runReport.decisionBlock.decisionBlockHash;
					const sortedBlockId = sortedOutcome.runReport.decisionBlock.decisionBlockHash;
					callback('', { pass: listsSorted && graphOrderBlockId === sortedBlockId, detail: `lists ${JSON.stringify(listBySubject)}; block ids ${graphOrderBlockId.slice(0, 12)} vs ${sortedBlockId.slice(0, 12)}` });
				});
			});
		},
	},
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-FANOUT', conjunctId: 'b_listCanonicalAndBlockIdUnmoved', twinName: 'freezeDoesNotSortList', fileName: DECISION_BLOCK_FILE, find: "'assertingSubjectList', 'instanceStableIdList']);", replace: "'assertingSubjectList']);" });

// ---------------------------------------------------------------------
// BG-FANOUT (c) a subject with no instance is refused
// ---------------------------------------------------------------------
const ZERO_INSTANCE_CHECK_FIND = `		const instanceStableIdList = instanceStableIdListBySubject.get(oneLeaf.subjectStableId);
		if (instanceStableIdList === undefined) {`;
// the twin lets the subject through with an empty list: the fault the check exists for, its answer written nowhere
const ZERO_INSTANCE_CHECK_DELETED = `		const instanceStableIdList = instanceStableIdListBySubject.get(oneLeaf.subjectStableId) || [];
		if (false) {`;
const refusalConjunctList = [
	refusalCase({
		registry: twinRegistry, gateId: 'BG-FANOUT', conjunctId: 'c_zeroInstanceSubjectRefused',
		title: '(c) under fan-out, a question with every instance edge detached refuses the run by name',
		shape: (scenario) => {
			instanceShape(scenario);
			scenario.graph.edgeList = scenario.graph.edgeList.filter((oneEdge) => oneEdge.fromStableId !== TIMESTAMP_QUESTION);
		},
		regex: /subject toy:question\/Timestamp has no 'HAS_INSTANCE' instance/,
		twinName: 'zeroInstanceCheckDeleted', fileName: FANOUT_FILE, find: ZERO_INSTANCE_CHECK_FIND, replace: ZERO_INSTANCE_CHECK_DELETED,
	}),
];

// ---------------------------------------------------------------------
// BG-FANOUT (f, g, h) the contract
// ---------------------------------------------------------------------
const DERIVED_ROW_ADMITS = "		forbiddenDeclarationKeyList: Object.freeze(['tupleFieldColumnMap', 'mappingProvider']),\n		admitsMaterialisationFanout: true,";
const CROSSWALK_ROW_DENIES = "		forbiddenDeclarationKeyList: DERIVED_ONLY_KEY_LIST,\n		admitsMaterialisationFanout: false,\n	}),\n	derived:";
const contractConjunctList = [
	pureConjunct({
		conjunctId: 'f0_acquisitionRowsAdmitLiteral',
		title: '(f) SOURCE_ACQUISITION_REGISTRY admits fan-out on derived only: standard false, crosswalk false, derived true',
		twinNameList: ['crosswalkRowAdmits'],
		judge: (scenario) => {
			const contractLib = scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: frameworkFile(CONTRACT_FILE), mutationList: scenario.frameworkMutationList }) : require(frameworkFile(CONTRACT_FILE));
			const admitsByBasis = Object.keys(contractLib.SOURCE_ACQUISITION_REGISTRY).sort().reduce((soFar, oneBasis) => ({ ...soFar, [oneBasis]: contractLib.SOURCE_ACQUISITION_REGISTRY[oneBasis].admitsMaterialisationFanout }), {});
			return { pass: JSON.stringify(admitsByBasis) === JSON.stringify({ crosswalk: false, derived: true, standard: false }), detail: JSON.stringify(admitsByBasis) };
		},
	}),
	// f1 runs the derived toy under a derived row that does NOT admit fan-out, so removing the check lets a whole plugin
	// through and the run succeeds; a documentary plugin would instead crash on its absent allow-list, observing nothing
	refusalCase({
		registry: twinRegistry, gateId: 'BG-FANOUT', conjunctId: 'f1_basisNotAdmittingRefused',
		title: '(f) under an acquisition row that does not admit fan-out, a plugin declaring materialisationFanout is refused at registration by name',
		shape: (scenario) => {
			instanceShape(scenario);
			scenario.frameworkMutationList.push({ modulePath: frameworkFile(CONTRACT_FILE), find: DERIVED_ROW_ADMITS, replace: DERIVED_ROW_ADMITS.replace('admitsMaterialisationFanout: true', 'admitsMaterialisationFanout: false') });
		},
		regex: /carries materialisationFanout, which matchBasis 'derived' does not admit/,
		twinName: 'admitsCheckDeleted', fileName: CONTRACT_FILE, find: "if (bridgeDeclaration.materialisationFanout !== undefined && SOURCE_ACQUISITION_REGISTRY[bridgeDeclaration.matchBasis].admitsMaterialisationFanout !== true) {", replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-FANOUT', conjunctId: 'g_partitionWithoutFanoutRefused',
		title: '(g) a plugin declaring judgmentPartition without materialisationFanout is refused at registration by name',
		shape: instanceShapeWith((bridgeDeclaration) => {
			delete bridgeDeclaration.materialisationFanout;
			bridgeDeclaration.renderingAllowList = { ...bridgeDeclaration.renderingAllowList, subject: bridgeDeclaration.renderingAllowList.subject.concat(['objectPartition']) };
			bridgeDeclaration.judgmentPartition = {
				kind: 'objectPartitionFile',
				filePath: 'bridgeData/toyObjectPartition.tsv',
				sha256: 'c88af19f70f8117fc069ceef4d8f36157297ec3e3fe67a0dd3c2c419a51930a2',
				instanceObjectPropertyName: 'objectName',
				objectColumnName: 'object',
				partitionLabelColumnName: 'partitionLabel',
				renderedPropertyName: 'objectPartition',
				unpartitionedSubjectRule: { propertyName: 'sharedBlock', valueList: ['ToyMetadata'] },
			};
		}),
		regex: /carries judgmentPartition without materialisationFanout/,
		twinName: 'fanoutRequirementDeleted', fileName: CONTRACT_FILE, find: 'if (bridgeDeclaration.materialisationFanout === undefined) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-FANOUT', conjunctId: 'h1_undeclaredMemberRefused',
		title: '(h) a materialisationFanout declaration carrying a member its kind does not declare is refused at registration by name',
		shape: instanceShapeWith((bridgeDeclaration) => { bridgeDeclaration.materialisationFanout.edgeDirection = 'outgoing'; }),
		regex: /materialisationFanout' kind 'edgeFromSubject' must be exactly \{ kind, edgeType \}/,
		twinName: 'memberCheckDeleted', fileName: FANOUT_FILE, find: 'if (!hasExactMembers(value, memberNameList)) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-FANOUT', conjunctId: 'h2_unknownKindRefused',
		title: '(h) a materialisationFanout kind with no MATERIALISATION_FANOUT_KIND_REGISTRY row is refused at registration by name',
		shape: instanceShapeWith((bridgeDeclaration) => { bridgeDeclaration.materialisationFanout.kind = 'edgeToSubject'; }),
		regex: /materialisationFanout' must be an object whose kind is one of edgeFromSubject/,
		twinName: 'kindRowAdded', fileName: FANOUT_FILE, find: '		readInstanceStableIdListBySubject: readEdgeFromSubject,\n	}),\n});', replace: "		readInstanceStableIdListBySubject: readEdgeFromSubject,\n	}),\n	edgeToSubject: Object.freeze({ memberNameList: Object.freeze(['kind', 'edgeType']), readInstanceStableIdListBySubject: readEdgeFromSubject }),\n});",
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-FANOUT', conjunctId: 'f0_acquisitionRowsAdmitLiteral', twinName: 'crosswalkRowAdmits', fileName: CONTRACT_FILE, find: CROSSWALK_ROW_DENIES, replace: CROSSWALK_ROW_DENIES.replace('admitsMaterialisationFanout: false', 'admitsMaterialisationFanout: true') });

// ---------------------------------------------------------------------
// BG-FANOUT-ORACLE — R1, and the §1.7 conjuncts against the text captured at this phase's branch cut
// ---------------------------------------------------------------------
const branchCutText = fs.readFileSync(BRANCH_CUT_BLOCK_PATH, 'utf8');
const maskedTextOf = (frozenText) => {
	const fingerprintMatchList = frozenText.match(FRAMEWORK_FINGERPRINT_TEXT_RE) || [];
	return fingerprintMatchList.length === 1 ? { maskedText: frozenText.replace(FRAMEWORK_FINGERPRINT_TEXT_RE, '"frameworkFingerprint":"MASKED"') } : { error: `frameworkFingerprint occurs ${fingerprintMatchList.length} times in the frozen text (must be exactly once)` };
};
const differingHeaderNameList = (leftBlock, rightBlock) => {
	const nameList = Array.from(new Set(Object.keys(leftBlock.header).concat(Object.keys(rightBlock.header)))).sort();
	return nameList.filter((oneName) => JSON.stringify(leftBlock.header[oneName]) !== JSON.stringify(rightBlock.header[oneName]));
};
const runEBlockTextFor = (scenario) => {
	const frozenText = fs.readFileSync(RUN_E_BLOCK_PATH, 'utf8');
	return typeof scenario.runEBlockTextTransform === 'function' ? scenario.runEBlockTextTransform(frozenText) : frozenText;
};
const ABSTENTION_RECORD_FIND = "taskDone('', { ...oneTask.baseRecord, objectStableId: null, predicate: null, predicateAssertedBy: null, sourceLabel: null, confidence: null, abstained: true, judge: judgeRecord,";
const ABSTENTION_RECORD_FORCED = "taskDone('', { ...oneTask.baseRecord, objectStableId: null, predicate: null, predicateAssertedBy: null, sourceLabel: null, confidence: null, abstained: 'forced', judge: judgeRecord,";
const LIST_FORCED_EMPTY = '...(oneLeaf.instanceStableIdList === undefined ? { instanceStableIdList: [] } : { instanceStableIdList: oneLeaf.instanceStableIdList }),';
const oracleConjunctList = [
	pureConjunct({
		conjunctId: 'r1_runEBlockParsesAndKeepsItsId',
		title: "R1: run E's frozen block parses unchanged and blockIdFor equals the frozen literal",
		twinNameList: ['runEBlockOneByteChanged'],
		judge: (scenario) => {
			const decisionBlockLib = scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: frameworkFile(DECISION_BLOCK_FILE), mutationList: scenario.frameworkMutationList }) : require(frameworkFile(DECISION_BLOCK_FILE));
			const frozenText = runEBlockTextFor(scenario);
			const parsed = decisionBlockLib.parseFrozenText(frozenText);
			const blockId = decisionBlockLib.blockIdFor({ frozenText });
			return { pass: !parsed.error && blockId === RUN_E_BLOCK_ID, detail: `${parsed.error ? `parse REFUSED: ${parsed.error.message.slice(0, 160)}` : 'parses'}; blockIdFor ${blockId}` };
		},
	}),
	runConjunct({
		conjunctId: 'd_toyDerivedBlockMaskedIdentical',
		title: "(d, §1.7) with materialisationFanout absent, the toy derived block equals the text captured at this phase's cut (6ac1824) with frameworkFingerprint masked",
		twinNameList: ['abstentionFieldForced', 'recordGainsEmptyList'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const now = maskedTextOf(frozenTextOf(outcome));
			const then = maskedTextOf(branchCutText);
			if (now.error || then.error) {
				return { pass: false, detail: now.error || then.error };
			}
			const maskedEqual = now.maskedText === then.maskedText;
			return { pass: maskedEqual, detail: `masked texts ${maskedEqual ? 'EQUAL' : 'DIFFER'} (${now.maskedText.length} vs ${then.maskedText.length} bytes)` };
		}),
	}),
	runConjunct({
		conjunctId: 'm_unmaskedDiffersOnlyInFrameworkFingerprint',
		title: '(§1.7 m) unmasked, the toy derived block and the branch-cut text differ in exactly one header key, frameworkFingerprint',
		twinNameList: ['abstentionFieldForcedUnmasked'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const nowBlock = JSON.parse(frozenTextOf(outcome));
			const thenBlock = JSON.parse(branchCutText);
			const headerDiffList = differingHeaderNameList(nowBlock, thenBlock);
			const bodyEqual = JSON.stringify(nowBlock.decisionRecordList) === JSON.stringify(thenBlock.decisionRecordList) && JSON.stringify(nowBlock.refusalList) === JSON.stringify(thenBlock.refusalList);
			return { pass: headerDiffList.length === 1 && headerDiffList[0] === 'frameworkFingerprint' && bodyEqual, detail: `differing header keys [${headerDiffList.join(', ')}]; records and refusals ${bodyEqual ? 'equal' : 'DIFFER'}` };
		}),
	}),
	runConjunct({
		conjunctId: 'o_absentKeyIsOptionalAndOmitted',
		title: '(§1.7) the toy derived plugin, declaring no materialisationFanout, registers and runs, and no record carries instanceStableIdList (omitted, never null or empty)',
		twinNameList: ['fanoutKeyMadeRequired', 'recordGainsEmptyListToo'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const carryingCount = blockOf(outcome).decisionRecordList.filter((oneRecord) => hasOwn(oneRecord, FANOUT_RECORD_FIELD_NAME)).length;
			return { pass: carryingCount === 0, detail: `${carryingCount} record(s) carry ${FANOUT_RECORD_FIELD_NAME}` };
		}),
	}),
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-FANOUT-ORACLE', conjunctId: 'r1_runEBlockParsesAndKeepsItsId', twinName: 'runEBlockOneByteChanged', leverKind: 'inputFault', mutate: (scenario) => { scenario.runEBlockTextTransform = (frozenText) => frozenText.replace('"frameworkGeneration":"', '"frameworkGeneration":"x'); } });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-FANOUT-ORACLE', conjunctId: 'd_toyDerivedBlockMaskedIdentical', twinName: 'abstentionFieldForced', fileName: FRAMEWORK_FILE, find: ABSTENTION_RECORD_FIND, replace: ABSTENTION_RECORD_FORCED });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-FANOUT-ORACLE', conjunctId: 'd_toyDerivedBlockMaskedIdentical', twinName: 'recordGainsEmptyList', fileName: FRAMEWORK_FILE, find: LIST_SPREAD_FIND, replace: LIST_FORCED_EMPTY });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-FANOUT-ORACLE', conjunctId: 'm_unmaskedDiffersOnlyInFrameworkFingerprint', twinName: 'abstentionFieldForcedUnmasked', fileName: FRAMEWORK_FILE, find: ABSTENTION_RECORD_FIND, replace: ABSTENTION_RECORD_FORCED });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-FANOUT-ORACLE', conjunctId: 'o_absentKeyIsOptionalAndOmitted', twinName: 'fanoutKeyMadeRequired', fileName: CONTRACT_FILE, find: "materialisationFanout: Object.freeze({ optional: true, kind: 'materialisationFanout' }),", replace: "materialisationFanout: Object.freeze({ kind: 'materialisationFanout' })," });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-FANOUT-ORACLE', conjunctId: 'o_absentKeyIsOptionalAndOmitted', twinName: 'recordGainsEmptyListToo', fileName: FRAMEWORK_FILE, find: LIST_SPREAD_FIND, replace: LIST_FORCED_EMPTY });

const gateDeclarationList = [
	{ gateId: 'BG-FANOUT', title: 'each judged record is frozen with the instances its answer is written to, read through the declared edge', conjunctList: [].concat(listConjunctList, canonicalConjunctList, refusalConjunctList, contractConjunctList) },
	{ gateId: 'BG-FANOUT-ORACLE', title: 'run E still replays hermetically, and with the key absent the toy Ed-Fi-shaped block is unmoved but for its framework fingerprint', conjunctList: oracleConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-FANOUT+BG-FANOUT-ORACLE', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 8 + 4 },
	() => harness.report(),
);
