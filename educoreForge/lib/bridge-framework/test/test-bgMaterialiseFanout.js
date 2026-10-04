#!/usr/bin/env node
'use strict';

// test-bgMaterialiseFanout.js — BG-MATFANOUT: under fan-out the materialiser writes one mapping edge per instance, from
// the instance to the chosen card, each naming the judged subject (PLAN-sifReplacement-smallPhases §3 B4b; SPEC-
// sifStructuralBridge-replacement §9 A10), plus the oracle conjuncts B4b owes (§1.6 R1, §1.7).
//
//   BG-MATFANOUT  (a) edges = Σ instanceStableIdList.length over picked records, the (from, to) set a literal;
//              (a2) two partition units of one subject, over disjoint instances, write per instance whether they pick two
//              cards or one card under two predicates; (b) every edge's judgedSubjectStableId is the subject whose
//              instance edge reaches its from-node; (c) the materialiser's source reads no instance edge; (e) one edge per
//              (instance, object): an instance listed twice in one record (a duplicated instance edge in the graph) and
//              an instance listed by two records are each refused by name.
//   BG-MATFANOUT-ORACLE  (R1) run E's frozen block parses unchanged and keeps its id; (d, §1.7) without fan-out the toy
//              derived block equals the branch-cut text with frameworkFingerprint masked, (d2) its written edges equal the
//              branch-cut edge list with decisionBlockHash and matchId masked, each matchId the four-line form over its own
//              hash, and (m) unmasked the block differs in frameworkFingerprint alone.
//
// Run: node lib/bridge-framework/test/test-bgMaterialiseFanout.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-MATFANOUT + BG-MATFANOUT-ORACLE

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const instanceScenarioLib = require('./testSupport/toyInstanceScenario');
const { runConjunct, pureConjunct, succeeded, frameworkMutationTwin, scenarioTwin, refusalCase, blockOf, edgesOf, frameworkFile } = require('./testSupport/bridgeTwinFactories');
const { capturedEdgeListWithProvenanceDelta, canonicalEdgeListText } = require('./testSupport/capturedEdgeProvenanceDelta');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const toyGraphLib = require(path.join(__dirname, 'fixtures', 'toyBridge', 'toyGraph'));
const graphDoubleLib = require(frameworkFile('graphDouble.js'));

const twinRegistry = makeTwinRegistry();
const FRAMEWORK_FILE = 'bridge-framework.js';
const MATERIALISER_FILE = 'materialiser.js';
const DECISION_BLOCK_FILE = 'decisionBlock.js';
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const { IDENTIFIER_QUESTION, TIMESTAMP_QUESTION, INSTANCE_EDGE_LIST, derivedShape, instanceShapeWith } = instanceScenarioLib;
const instanceShape = instanceShapeWith();

// the frozen literals this phase is measured against
const IDENTIFIER_CARD = 'toyhub:card/P000001.C1';
const SECOND_CARD = 'toyhub:card/P000006.C1';
const STAFF_IDENTIFIER = 'toy:field/StaffRecord.Identifier';
const ENROLLMENT_IDENTIFIER = 'toy:field/StudentEnrollment.Identifier';
const STUDENT_IDENTIFIER = 'toy:field/StudentRecord.Identifier';
const STUDENT_TIMESTAMP = 'toy:field/StudentRecord.Timestamp';
const STAFF_TIMESTAMP = 'toy:field/StaffRecord.Timestamp';
// the toy fan-out run: Identifier picks the first card over its three instances; Timestamp abstains and writes nothing
const FANOUT_EDGE_LITERAL = Object.freeze([`${STAFF_IDENTIFIER} → ${IDENTIFIER_CARD}`, `${ENROLLMENT_IDENTIFIER} → ${IDENTIFIER_CARD}`, `${STUDENT_IDENTIFIER} → ${IDENTIFIER_CARD}`]);
const BRANCH_CUT_BLOCK_PATH = path.join(__dirname, 'fixtures', 'toyBridge', 'branchCutBlocks', 'toyDerivedPlugin-B4bbranchCut-a4a512a.frozenText.json');
const BRANCH_CUT_EDGE_LIST_PATH = path.join(__dirname, 'fixtures', 'toyBridge', 'branchCutBlocks', 'toyDerivedPlugin-B4bbranchCut-a4a512a.writtenEdgeList.json');
const RUN_E_BLOCK_PATH = path.join(TREE_ROOT, '..', '..', 'dataStores', 'bridgeAcceptance', 'edfiEval', 'runE_091726', 'block.json');
const RUN_E_BLOCK_ID = '7e362cebe7bb74d572e643eed37944d2577eb850313028bc0b9eb11f245c8755';
const FRAMEWORK_FINGERPRINT_TEXT_RE = /"frameworkFingerprint":"[0-9a-f]{64}"/g;
const DIRECT_APPLY_LABEL = 'B4bToyMaterialise';
const DIRECT_OBJECT_MATCH_FIELD = 'ToyHub:semanticSimilarity';

const cloneJson = scenarioLib.cloneJson;
const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');
const edgeLineOf = (oneEdge) => `${oneEdge.fromStableId} → ${oneEdge.toStableId}`;
const frozenTextOf = (outcome) => outcome.stores.decisionStore.rowList.find((oneRow) => oneRow.decisionBlockHash === outcome.runReport.decisionBlock.decisionBlockHash).frozenText;
// the subject whose instance edge reaches each field, read by the TEST from the toy graph (the materialiser never reads it)
const questionByInstanceStableId = INSTANCE_EDGE_LIST.reduce((soFar, oneEdge) => ({ ...soFar, [oneEdge.toStableId]: oneEdge.fromStableId }), {});
const materialiserFor = (scenario) => (scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: frameworkFile(MATERIALISER_FILE), mutationList: scenario.frameworkMutationList }) : require(frameworkFile(MATERIALISER_FILE)));

// directRun — run the toy fan-out scenario to freeze a REAL block, let reshapeRecordList rework its records, then call
// materialiseBlock DIRECTLY against a fresh graph double of the same toy graph. → { error?, recordList, edgeList }
const directRun = ({ scenario, reshapeRecordList }, callback) => {
	instanceShape(scenario);
	const graphForWriter = cloneJson(scenario.graph);
	scenarioLib.runScenario(scenario, (unusedError, outcome) => {
		const failureText = outcome.runError || outcome.constructionError || outcome.thrownFromRun;
		if (failureText) {
			callback({ error: `the toy fan-out run failed: ${failureText}` });
			return;
		}
		const block = blockOf(outcome);
		const recordList = reshapeRecordList(block.decisionRecordList, scenario);
		const graphDouble = graphDoubleLib.graphDoubleFrom(graphForWriter);
		const writer = graphDouble.graphWriterFactory({ inGraph: {}, applyLabel: DIRECT_APPLY_LABEL, sourceStandardName: toyGraphLib.SOURCE_STANDARD_NAME });
		const materialiserLib = materialiserFor(scenario);
		materialiserLib.materialiseBlock(
			{ block: { ...block, decisionRecordList: recordList }, decisionBlockHash: outcome.runReport.decisionBlock.decisionBlockHash, writer, sourceStandardName: toyGraphLib.SOURCE_STANDARD_NAME, sourceVersion: String(toyGraphLib.SOURCE_VERSION), hubName: block.header.hubName, hubVersion: '1', mappingProviderUrl: null, subjectMatchField: null, objectMatchField: DIRECT_OBJECT_MATCH_FIELD, runWindowMark: null },
			(materialiseError) => {
				callback({ error: materialiseError || undefined, recordList, edgeList: graphDouble.state.writtenEdgeList, uniquenessRefusal: materialiserLib.edgeUniquenessRefusal(recordList) });
			},
		);
	});
};
// pickedLike — a picked record for a subject, its judge fields copied from the Identifier record the toy judge picked
const pickedLike = ({ identifierRecord, subjectStableId, instanceStableIdList, objectStableId, predicate, targetKey }) => ({ ...cloneJson(identifierRecord), subjectStableId, instanceStableIdList, objectStableId, predicate, targetKey });
const identifierRecordOf = (recordList) => recordList.find((oneRecord) => oneRecord.subjectStableId === IDENTIFIER_QUESTION);

// ---------------------------------------------------------------------
// BG-MATFANOUT (a) edges = Σ instance counts over picked records
// ---------------------------------------------------------------------
const INSTANCE_EXPANSION_FIND = ': oneRecord.instanceStableIdList.map((instanceStableId) => ({ record: oneRecord, fromStableId: instanceStableId, instanceStableId })),';
const countConjunctList = [
	runConjunct({
		conjunctId: 'a_edgesEqualSumOfInstanceCounts',
		title: '(a) the toy fan-out run writes Σ instanceStableIdList.length over its picked records (3; the abstained Timestamp and its two instances write none), and the (from, to) set is the literal: each Identifier field to the chosen card',
		twinNameList: ['oneInstanceSkipped'],
		shape: instanceShape,
		judge: succeeded((runReport, outcome) => {
			const pickedList = blockOf(outcome).decisionRecordList.filter((oneRecord) => typeof oneRecord.objectStableId === 'string' && oneRecord.objectStableId.length > 0);
			const instanceTotal = pickedList.reduce((soFar, oneRecord) => soFar + oneRecord.instanceStableIdList.length, 0);
			const edgeLineList = edgesOf(outcome).map(edgeLineOf).sort();
			const pass = edgeLineList.length === instanceTotal && runReport.edgesWritten === instanceTotal && JSON.stringify(edgeLineList) === JSON.stringify(FANOUT_EDGE_LITERAL);
			return { pass, detail: `${edgeLineList.length} edge(s), edgesWritten ${runReport.edgesWritten}, Σ instances ${instanceTotal}: ${JSON.stringify(edgeLineList)}` };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATFANOUT', conjunctId: 'a_edgesEqualSumOfInstanceCounts', twinName: 'oneInstanceSkipped', fileName: MATERIALISER_FILE, find: INSTANCE_EXPANSION_FIND, replace: INSTANCE_EXPANSION_FIND.replace('instanceStableIdList.map(', 'instanceStableIdList.slice(1).map(') });

// ---------------------------------------------------------------------
// BG-MATFANOUT (a2) partition units of one subject write per instance, without a subject-grain collision
// ---------------------------------------------------------------------
// Identifier split into two units over disjoint instances: Staff, and the two Student fields
const unitRecordListFor = ({ staffCard, staffPredicate, studentCard, studentPredicate }) => (recordList) => {
	const identifierRecord = identifierRecordOf(recordList);
	return recordList.filter((oneRecord) => oneRecord !== identifierRecord).concat([
		pickedLike({ identifierRecord, subjectStableId: IDENTIFIER_QUESTION, instanceStableIdList: [STAFF_IDENTIFIER], objectStableId: staffCard, predicate: staffPredicate, targetKey: `retrieval:${IDENTIFIER_QUESTION}#partition:Toy Staff` }),
		pickedLike({ identifierRecord, subjectStableId: IDENTIFIER_QUESTION, instanceStableIdList: [ENROLLMENT_IDENTIFIER, STUDENT_IDENTIFIER], objectStableId: studentCard, predicate: studentPredicate, targetKey: `retrieval:${IDENTIFIER_QUESTION}#partition:Toy Student` }),
	]);
};
const UNIT_VARIANT_LIST = Object.freeze([
	{ variantName: 'twoCards', reshape: unitRecordListFor({ staffCard: IDENTIFIER_CARD, staffPredicate: 'closeMatch', studentCard: SECOND_CARD, studentPredicate: 'exactMatch' }), literal: [`${STAFF_IDENTIFIER} -CLOSE_MATCH-> ${IDENTIFIER_CARD}`, `${ENROLLMENT_IDENTIFIER} -EXACT_MATCH-> ${SECOND_CARD}`, `${STUDENT_IDENTIFIER} -EXACT_MATCH-> ${SECOND_CARD}`] },
	{ variantName: 'oneCardTwoPredicates', reshape: unitRecordListFor({ staffCard: IDENTIFIER_CARD, staffPredicate: 'closeMatch', studentCard: IDENTIFIER_CARD, studentPredicate: 'exactMatch' }), literal: [`${STAFF_IDENTIFIER} -CLOSE_MATCH-> ${IDENTIFIER_CARD}`, `${ENROLLMENT_IDENTIFIER} -EXACT_MATCH-> ${IDENTIFIER_CARD}`, `${STUDENT_IDENTIFIER} -EXACT_MATCH-> ${IDENTIFIER_CARD}`] },
]);
const typedEdgeLineOf = (oneEdge) => `${oneEdge.fromStableId} -${oneEdge.type}-> ${oneEdge.toStableId}`;
const FANOUT_UNIQUENESS_FIND = '\t\tif (instanceStableId !== undefined) {\n\t\t\treturn refuse.byName({ moduleName, what: `instance ${instanceStableId}';
const FANOUT_UNIQUENESS_DELETED = '\t\tif (false) {\n\t\t\treturn refuse.byName({ moduleName, what: `instance ${instanceStableId}';
const PAIR_REF_ID_FIND = 'const pairRefId = `${fromStableId}\\u001f${oneRecord.objectStableId}`;';
const unitConjunctList = [
	{
		conjunctId: 'a2_partitionUnitsWritePerInstance',
		title: '(a2) Identifier split into two units over disjoint instances (Staff; the two Student fields) writes one edge per instance with no refusal, both when the units pick two cards and when they pick ONE card under two predicates (refused at subject grain before B4b)',
		twinNameList: ['uniquenessAtSubjectGrain'],
		evaluate: (scenario, callback) => {
			const resultList = [];
			const nextVariant = (variantIndex) => {
				if (variantIndex >= UNIT_VARIANT_LIST.length) {
					const failedList = resultList.filter((oneResult) => !oneResult.pass);
					callback('', { pass: failedList.length === 0, detail: resultList.map((oneResult) => `${oneResult.variantName}: ${oneResult.detail}`).join(' | ') });
					return;
				}
				const oneVariant = UNIT_VARIANT_LIST[variantIndex];
				directRun({ scenario: scenarioLib.cloneScenario(scenario), reshapeRecordList: oneVariant.reshape }, (directResult) => {
					const refusalText = directResult.error || (directResult.uniquenessRefusal ? directResult.uniquenessRefusal.message : '');
					const edgeLineList = (directResult.edgeList || []).map(typedEdgeLineOf).sort();
					const pass = !refusalText && JSON.stringify(edgeLineList) === JSON.stringify(oneVariant.literal);
					resultList.push({ variantName: oneVariant.variantName, pass, detail: refusalText ? `REFUSED ${String(refusalText).slice(0, 200)}` : JSON.stringify(edgeLineList) });
					nextVariant(variantIndex + 1);
				});
			};
			nextVariant(0);
		},
	},
];
// the twin restores the pre-B4b rule exactly: the two-predicate check keyed on (subject, object), and no per-instance check
// (which, keyed on the subject, would refuse a subject's own second instance and redden the setup run instead)
scenarioTwin({
	registry: twinRegistry, gateId: 'BG-MATFANOUT', conjunctId: 'a2_partitionUnitsWritePerInstance', twinName: 'uniquenessAtSubjectGrain', leverKind: 'productionMutation',
	mutate: (scenario) => {
		[
			{ find: PAIR_REF_ID_FIND, replace: 'const pairRefId = `${oneRecord.subjectStableId}\\u001f${oneRecord.objectStableId}`;' },
			{ find: FANOUT_UNIQUENESS_FIND, replace: FANOUT_UNIQUENESS_DELETED },
		].forEach((oneMutation) => {
			moduleDouble.assertMutationApplies({ modulePath: frameworkFile(MATERIALISER_FILE), find: oneMutation.find });
			scenario.frameworkMutationList.push({ modulePath: frameworkFile(MATERIALISER_FILE), ...oneMutation });
		});
	},
});

// ---------------------------------------------------------------------
// BG-MATFANOUT (b) each edge names the subject whose instance it leaves
// ---------------------------------------------------------------------
// both questions pick: Timestamp is re-pointed at the second card, its judge fields copied from the Identifier record
const bothPickRecordListFor = (recordList, scenario) => {
	const identifierRecord = identifierRecordOf(recordList);
	const timestampRecord = recordList.find((oneRecord) => oneRecord.subjectStableId === TIMESTAMP_QUESTION);
	const reshapedList = recordList.filter((oneRecord) => oneRecord !== timestampRecord).concat([pickedLike({ identifierRecord, subjectStableId: TIMESTAMP_QUESTION, instanceStableIdList: timestampRecord.instanceStableIdList, objectStableId: SECOND_CARD, predicate: 'exactMatch', targetKey: timestampRecord.targetKey })]);
	if (scenario.swapInstanceListsOfTwoRecords !== true) {
		return reshapedList;
	}
	const reshapedIdentifier = identifierRecordOf(reshapedList);
	const reshapedTimestamp = reshapedList.find((oneRecord) => oneRecord.subjectStableId === TIMESTAMP_QUESTION);
	const identifierInstanceList = reshapedIdentifier.instanceStableIdList;
	reshapedIdentifier.instanceStableIdList = reshapedTimestamp.instanceStableIdList;
	reshapedTimestamp.instanceStableIdList = identifierInstanceList;
	return reshapedList;
};
const JUDGED_SUBJECT_FIND = '\t\tedgeProperties[MAPPING_PROPERTIES.JUDGED_SUBJECT_STABLE_ID] = record.subjectStableId;';
const subjectConjunctList = [
	{
		conjunctId: 'b_judgedSubjectEqualsQuestionOfInstance',
		title: "(b) with both questions picking, all five edges carry judgedSubjectStableId, each equal to the question whose instance edge in the toy graph reaches the edge's from-node",
		twinNameList: ['twoRecordsInstanceListsSwapped', 'judgedSubjectFromInstance'],
		evaluate: (scenario, callback) => {
			directRun({ scenario, reshapeRecordList: bothPickRecordListFor }, (directResult) => {
				if (directResult.error) {
					callback('', { pass: false, detail: `REFUSED ${String(directResult.error).slice(0, 240)}` });
					return;
				}
				const mismatchList = directResult.edgeList.filter((oneEdge) => oneEdge.properties.judgedSubjectStableId !== questionByInstanceStableId[oneEdge.fromStableId]);
				const pass = directResult.edgeList.length === 5 && mismatchList.length === 0;
				callback('', { pass, detail: `${directResult.edgeList.length} edge(s); mismatched ${JSON.stringify(mismatchList.map((oneEdge) => `${oneEdge.fromStableId} says ${oneEdge.properties.judgedSubjectStableId}`))}` });
			});
		},
	},
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-MATFANOUT', conjunctId: 'b_judgedSubjectEqualsQuestionOfInstance', twinName: 'twoRecordsInstanceListsSwapped', leverKind: 'inputFault', mutate: (scenario) => { scenario.swapInstanceListsOfTwoRecords = true; } });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATFANOUT', conjunctId: 'b_judgedSubjectEqualsQuestionOfInstance', twinName: 'judgedSubjectFromInstance', fileName: MATERIALISER_FILE, find: JUDGED_SUBJECT_FIND, replace: JUDGED_SUBJECT_FIND.replace('= record.subjectStableId;', '= instanceStableId;') });

// ---------------------------------------------------------------------
// BG-MATFANOUT (c) the materialiser reads the block only: no instance edge, no reader view, in its source
// ---------------------------------------------------------------------
const GRAPH_READ_PATTERN_LIST = Object.freeze([/HAS_INSTANCE/, /readEdgesAmongSource/, /readNodesByStableId/, /readSourceNodes/, /readSubjectNodes/, /\bfor(Evidence|Walk|Retrieval)\b/, /materialisationFanout/]);
const JUSTIFICATION_LINE = "const JUSTIFICATION_BY_RESOLUTION = Object.freeze({ specified: 'semapv:ManualMappingCuration', judged: 'semapv:CompositeMatching' });";
const scanConjunctList = [
	pureConjunct({
		conjunctId: 'c_materialiserSourceReadsNoInstanceEdge',
		title: '(c) a source scan of materialiser.js finds no instance-edge type, no reader view or read, and no fan-out declaration',
		twinNameList: ['instanceEdgeReadInserted'],
		judge: (scenario) => {
			const sourceText = scenario.frameworkMutationList
				.filter((oneMutation) => oneMutation.modulePath === frameworkFile(MATERIALISER_FILE))
				.reduce((soFar, oneMutation) => soFar.replace(oneMutation.find, () => oneMutation.replace), fs.readFileSync(frameworkFile(MATERIALISER_FILE), 'utf8'));
			const hitList = GRAPH_READ_PATTERN_LIST.filter((onePattern) => onePattern.test(sourceText)).map(String);
			return { pass: hitList.length === 0, detail: hitList.length === 0 ? `${GRAPH_READ_PATTERN_LIST.length} patterns, none present` : `present: ${hitList.join(', ')}` };
		},
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATFANOUT', conjunctId: 'c_materialiserSourceReadsNoInstanceEdge', twinName: 'instanceEdgeReadInserted', fileName: MATERIALISER_FILE, find: JUSTIFICATION_LINE, replace: `${JUSTIFICATION_LINE}\nconst INSTANCE_EDGE_TYPE = vocabularyLib.EDGE_TYPES.HAS_INSTANCE;` });

// ---------------------------------------------------------------------
// BG-MATFANOUT (e) one edge per (instance, object)
// ---------------------------------------------------------------------
// Timestamp also picks the Identifier card, and also lists the StudentRecord Identifier field
const sharedInstanceRecordListFor = (recordList) => {
	const identifierRecord = identifierRecordOf(recordList);
	const timestampRecord = recordList.find((oneRecord) => oneRecord.subjectStableId === TIMESTAMP_QUESTION);
	return recordList.filter((oneRecord) => oneRecord !== timestampRecord).concat([pickedLike({ identifierRecord, subjectStableId: TIMESTAMP_QUESTION, instanceStableIdList: [STAFF_TIMESTAMP, STUDENT_IDENTIFIER, STUDENT_TIMESTAMP], objectStableId: IDENTIFIER_CARD, predicate: 'closeMatch', targetKey: timestampRecord.targetKey })]);
};
const SHARED_INSTANCE_RE = /instance toy:field\/StudentRecord\.Identifier → toyhub:card\/P000001\.C1 is reached twice \(subject toy:question\/Identifier closeMatch, then subject toy:question\/Timestamp closeMatch\)/;
const uniquenessConjunctList = [
	refusalCase({
		registry: twinRegistry, gateId: 'BG-MATFANOUT', conjunctId: 'e1_instanceListedTwiceRefused',
		title: '(e) the toy graph carrying the Staff Identifier instance edge TWICE (instance edges are not deduplicated upstream) freezes that instance twice in one list, and the run is refused at freeze by name',
		shape: (scenario) => {
			instanceShape(scenario);
			scenario.graph.edgeList = scenario.graph.edgeList.concat([cloneJson(INSTANCE_EDGE_LIST.find((oneEdge) => oneEdge.toStableId === STAFF_IDENTIFIER))]);
		},
		regex: /instance toy:field\/StaffRecord\.Identifier → toyhub:card\/P000001\.C1 is reached twice \(subject toy:question\/Identifier closeMatch, then subject toy:question\/Identifier closeMatch\)/,
		twinName: 'fanoutUniquenessCheckDeleted', fileName: MATERIALISER_FILE, find: FANOUT_UNIQUENESS_FIND, replace: FANOUT_UNIQUENESS_DELETED,
	}),
	{
		conjunctId: 'e2_instanceSharedByTwoRecordsRefused',
		title: '(e) an instance listed by two picked records that choose the same card is refused by name, both by edgeUniquenessRefusal (the freeze check) and by materialiseBlock, and nothing is written',
		twinNameList: ['fanoutUniquenessCheckDeletedToo'],
		evaluate: (scenario, callback) => {
			directRun({ scenario, reshapeRecordList: sharedInstanceRecordListFor }, (directResult) => {
				const freezeText = directResult.uniquenessRefusal ? directResult.uniquenessRefusal.message : '';
				const materialiseText = directResult.error ? String(directResult.error) : '';
				const pass = SHARED_INSTANCE_RE.test(freezeText) && SHARED_INSTANCE_RE.test(materialiseText) && directResult.edgeList.length === 0;
				callback('', { pass, detail: `freeze: ${freezeText ? freezeText.slice(0, 160) : 'NO REFUSAL'}; materialise: ${materialiseText ? materialiseText.slice(0, 80) : 'NO REFUSAL'}; ${directResult.edgeList ? directResult.edgeList.length : 0} edge(s) written` });
			});
		},
	},
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATFANOUT', conjunctId: 'e2_instanceSharedByTwoRecordsRefused', twinName: 'fanoutUniquenessCheckDeletedToo', fileName: MATERIALISER_FILE, find: FANOUT_UNIQUENESS_FIND, replace: FANOUT_UNIQUENESS_DELETED });

// ---------------------------------------------------------------------
// BG-MATFANOUT-ORACLE — R1, and the §1.7 conjuncts against the run captured at this phase's branch cut
// ---------------------------------------------------------------------
const branchCutText = fs.readFileSync(BRANCH_CUT_BLOCK_PATH, 'utf8');
// lane P (2026-10-04) added mappingKind/mappingSource/mappingConfidence and renamed one tier AFTER this capture; the delta is
// applied to the capture rather than re-capturing it (testSupport/capturedEdgeProvenanceDelta.js)
const branchCutEdgeList = capturedEdgeListWithProvenanceDelta({ capturedEdgeList: JSON.parse(fs.readFileSync(BRANCH_CUT_EDGE_LIST_PATH, 'utf8')), specifiedBridgeName: null });
const maskedTextOf = (frozenText) => {
	const fingerprintMatchList = frozenText.match(FRAMEWORK_FINGERPRINT_TEXT_RE) || [];
	return fingerprintMatchList.length === 1 ? { maskedText: frozenText.replace(FRAMEWORK_FINGERPRINT_TEXT_RE, '"frameworkFingerprint":"MASKED"') } : { error: `frameworkFingerprint occurs ${fingerprintMatchList.length} times in the frozen text (must be exactly once)` };
};
// the two edge properties that are functions of the block id, which frameworkFingerprint moves
// properties compared in sorted-name order: lane P's fields land at a different position in the materialiser's object
const maskedEdgeListText = (edgeList) => canonicalEdgeListText(edgeList, ['decisionBlockHash', 'matchId']);
const fourLineMatchIdOf = (oneEdge) => sha256Hex(`${oneEdge.properties.decisionBlockHash}\n${oneEdge.fromStableId}\n${oneEdge.properties.predicate}\n${oneEdge.toStableId}`);
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
const FANOUT_PROPERTY_GUARD_FIND = '\tif (instanceStableId !== undefined) {\n\t\tedgeProperties[MAPPING_PROPERTIES.JUDGED_SUBJECT_STABLE_ID]';
const FOUR_LINE_MATCH_ID_FIND = '\t\t[MAPPING_PROPERTIES.MATCH_ID]: sha256Hex(`${decisionBlockHash}\\n${record.subjectStableId}\\n${record.predicate}\\n${record.objectStableId}`),';
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
		title: "(d, §1.7) without fan-out, the toy derived block equals the text captured at this phase's cut (a4a512a) with frameworkFingerprint masked",
		twinNameList: ['abstentionFieldForced'],
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
		conjunctId: 'd2_toyDerivedEdgeListMaskedIdentical',
		title: "(d, §1.7) without fan-out, the toy derived run's written edges equal the list captured at this phase's cut (a4a512a) with decisionBlockHash and matchId masked, and every matchId is the four-line form over its own edge's hash",
		twinNameList: ['judgedSubjectForcedWithoutFanout', 'matchIdGainsFifthLineAlways'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const edgeList = edgesOf(outcome);
			const maskedEqual = maskedEdgeListText(edgeList) === maskedEdgeListText(branchCutEdgeList);
			const matchIdMismatchCount = edgeList.filter((oneEdge) => oneEdge.properties.matchId !== fourLineMatchIdOf(oneEdge)).length;
			return { pass: edgeList.length === branchCutEdgeList.length && maskedEqual && matchIdMismatchCount === 0, detail: `${edgeList.length} vs ${branchCutEdgeList.length} edge(s); masked lists ${maskedEqual ? 'EQUAL' : 'DIFFER'}; ${matchIdMismatchCount} matchId(s) not the four-line form` };
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
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-MATFANOUT-ORACLE', conjunctId: 'r1_runEBlockParsesAndKeepsItsId', twinName: 'runEBlockOneByteChanged', leverKind: 'inputFault', mutate: (scenario) => { scenario.runEBlockTextTransform = (frozenText) => frozenText.replace('"frameworkGeneration":"', '"frameworkGeneration":"x'); } });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATFANOUT-ORACLE', conjunctId: 'd_toyDerivedBlockMaskedIdentical', twinName: 'abstentionFieldForced', fileName: FRAMEWORK_FILE, find: ABSTENTION_RECORD_FIND, replace: ABSTENTION_RECORD_FORCED });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATFANOUT-ORACLE', conjunctId: 'd2_toyDerivedEdgeListMaskedIdentical', twinName: 'judgedSubjectForcedWithoutFanout', fileName: MATERIALISER_FILE, find: FANOUT_PROPERTY_GUARD_FIND, replace: FANOUT_PROPERTY_GUARD_FIND.replace('if (instanceStableId !== undefined) {', 'if (true) {') });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATFANOUT-ORACLE', conjunctId: 'd2_toyDerivedEdgeListMaskedIdentical', twinName: 'matchIdGainsFifthLineAlways', fileName: MATERIALISER_FILE, find: FOUR_LINE_MATCH_ID_FIND, replace: FOUR_LINE_MATCH_ID_FIND.replace('${record.objectStableId}`),', '${record.objectStableId}\\n${instanceStableId}`),') });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATFANOUT-ORACLE', conjunctId: 'm_unmaskedDiffersOnlyInFrameworkFingerprint', twinName: 'abstentionFieldForcedUnmasked', fileName: FRAMEWORK_FILE, find: ABSTENTION_RECORD_FIND, replace: ABSTENTION_RECORD_FORCED });

const gateDeclarationList = [
	{ gateId: 'BG-MATFANOUT', title: 'under fan-out the materialiser writes one edge per instance, from the instance to the chosen card, naming the judged subject', conjunctList: [].concat(countConjunctList, unitConjunctList, subjectConjunctList, scanConjunctList, uniquenessConjunctList) },
	{ gateId: 'BG-MATFANOUT-ORACLE', title: 'run E still replays hermetically, and without fan-out the toy Ed-Fi-shaped block and its edges are unmoved but for the framework fingerprint', conjunctList: oracleConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-MATFANOUT+BG-MATFANOUT-ORACLE', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 6 + 4 },
	() => harness.report(),
);
