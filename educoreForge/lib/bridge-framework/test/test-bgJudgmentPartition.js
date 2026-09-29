#!/usr/bin/env node
'use strict';

// test-bgJudgmentPartition.js — BG-PARTITION: each subject judged once per partition of its instances, the partition
// read from a declared, checksummed file (PLAN-sifReplacement-smallPhases §3 B4p; SPEC-sifStructuralBridge-replacement
// §9 A20), plus the oracle conjuncts B4p owes (§1.6 R1, §1.7).
//
//   BG-PARTITION  (a) a toy subject whose instances sit in objects of two partitions yields two judgment units, each
//                 prompt stating its label on the declared line, each record carrying its label and its instances;
//                 (b) the file's sha256 is checked, an object missing from the file is refused by name, and so are the
//                 file's other faults (header, blank cell, duplicate object) and the instance faults (no object named,
//                 no instance); (c) a subject the unpartitioned rule names is ONE unit with label null, all its
//                 instances and no label line; (e) the frozen instance list is canonical (sorted by the freeze);
//                 (f) the contract refuses a basis that does not admit a partition, a rendered name outside the
//                 subject allow-list, a blinded property, a rendered name a subject already carries, a malformed
//                 declaration and an unregistered kind.
//   BG-PARTITION-ORACLE  (R1) run E's frozen block parses unchanged and keeps its id; (d, §1.7) with the key absent
//                 the toy derived block equals the branch-cut text with frameworkFingerprint masked, (m) unmasked it
//                 differs in that key alone, and (o) the key is optional: absent, it is omitted from every record.
//
// Run: node lib/bridge-framework/test/test-bgJudgmentPartition.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-PARTITION + BG-PARTITION-ORACLE

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, pureConjunct, succeeded, frameworkMutationTwin, scenarioTwin, refusalCase, blockOf, frameworkFile } = require('./testSupport/bridgeTwinFactories');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const FRAMEWORK_FILE = 'bridge-framework.js';
const CONTRACT_FILE = 'bridgePluginContract.js';
const PARTITION_FILE = 'judgmentPartition.js';
const DECISION_BLOCK_FILE = 'decisionBlock.js';
const TOY_EMBED_MODEL = 'toy-embed-v1';
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const TOY_BUNDLE_DIR = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy');
const cloneJson = scenarioLib.cloneJson;
const sha256OfBytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// the frozen literals this phase is measured against
const PARTITION_FILE_RELATIVE_PATH = 'bridgeData/toyObjectPartition.tsv';
const PARTITION_FILE_SHA256_LITERAL = 'c88af19f70f8117fc069ceef4d8f36157297ec3e3fe67a0dd3c2c419a51930a2';
const RENDERED_PROPERTY_NAME = 'objectPartition';
const IDENTIFIER_QUESTION = 'toy:question/Identifier';
const TIMESTAMP_QUESTION = 'toy:question/Timestamp';
const IDENTIFIER_UNIT_LITERAL_LIST = Object.freeze([
	Object.freeze({ judgmentPartitionLabel: 'Toy Staff', judgmentPartitionInstanceStableIdList: Object.freeze(['toy:field/StaffRecord.Identifier']) }),
	Object.freeze({ judgmentPartitionLabel: 'Toy Student', judgmentPartitionInstanceStableIdList: Object.freeze(['toy:field/StudentEnrollment.Identifier', 'toy:field/StudentRecord.Identifier']) }),
]);
const TIMESTAMP_UNIT_LITERAL = Object.freeze({ judgmentPartitionLabel: null, judgmentPartitionInstanceStableIdList: Object.freeze(['toy:field/StaffRecord.Timestamp', 'toy:field/StudentRecord.Timestamp']) });
const PARTITIONED_UNIT_COUNT_LITERAL = 3;
const BRANCH_CUT_BLOCK_PATH = path.join(__dirname, 'fixtures', 'toyBridge', 'branchCutBlocks', 'toyDerivedPlugin-B4pbranchCut-16f661a.frozenText.json');
const RUN_E_BLOCK_PATH = path.join(TREE_ROOT, '..', '..', 'dataStores', 'bridgeAcceptance', 'edfiEval', 'runE_091726', 'block.json');
const RUN_E_BLOCK_ID = '7e362cebe7bb74d572e643eed37944d2577eb850313028bc0b9eb11f245c8755';
const FRAMEWORK_FINGERPRINT_TEXT_RE = /"frameworkFingerprint":"[0-9a-f]{64}"/g;
const PARTITION_RECORD_FIELD_NAME_LIST = Object.freeze(['judgmentPartitionLabel', 'judgmentPartitionInstanceStableIdList']);

// ---------------------------------------------------------------------
// the toy partition scenario: two questions over five fields in three objects
// ---------------------------------------------------------------------
const questionNode = ({ element, description, sharedBlock }) => ({
	stableId: `toy:question/${element}`,
	labels: ['ToyQuestion'],
	properties: { stableId: `toy:question/${element}`, name: element, description, role: 'property', sharedBlock, _source: scenarioLib.toyGraphLib.SOURCE_STANDARD_NAME, embedding: scenarioLib.toyGraphLib.EMBEDDING.slice(), embeddingModelVersion: TOY_EMBED_MODEL },
});
const fieldNode = ({ objectName, element }) => ({
	stableId: `toy:field/${objectName}.${element}`,
	labels: ['ToyField'],
	properties: { stableId: `toy:field/${objectName}.${element}`, name: element, objectName, role: 'support', _source: scenarioLib.toyGraphLib.SOURCE_STANDARD_NAME },
});
const PARTITION_NODE_LIST = Object.freeze([
	questionNode({ element: 'Identifier', description: 'The identifier of the record subject.', sharedBlock: 'model' }),
	questionNode({ element: 'Timestamp', description: 'When the record was last changed.', sharedBlock: 'ToyMetadata' }),
	fieldNode({ objectName: 'StudentRecord', element: 'Identifier' }),
	fieldNode({ objectName: 'StudentEnrollment', element: 'Identifier' }),
	fieldNode({ objectName: 'StaffRecord', element: 'Identifier' }),
	fieldNode({ objectName: 'StudentRecord', element: 'Timestamp' }),
	fieldNode({ objectName: 'StaffRecord', element: 'Timestamp' }),
]);
const instanceEdge = (fromStableId, toStableId) => ({ fromStableId, toStableId, type: 'HAS_INSTANCE', properties: { provenanceTier: 'structural' } });
const PARTITION_EDGE_LIST = Object.freeze([
	instanceEdge(IDENTIFIER_QUESTION, 'toy:field/StudentRecord.Identifier'),
	instanceEdge(IDENTIFIER_QUESTION, 'toy:field/StudentEnrollment.Identifier'),
	instanceEdge(IDENTIFIER_QUESTION, 'toy:field/StaffRecord.Identifier'),
	instanceEdge(TIMESTAMP_QUESTION, 'toy:field/StudentRecord.Timestamp'),
	instanceEdge(TIMESTAMP_QUESTION, 'toy:field/StaffRecord.Timestamp'),
]);
const partitionDeclarationFixture = () => ({
	kind: 'objectPartitionFile',
	filePath: PARTITION_FILE_RELATIVE_PATH,
	sha256: PARTITION_FILE_SHA256_LITERAL,
	instanceEdgeType: 'HAS_INSTANCE',
	instanceObjectPropertyName: 'objectName',
	objectColumnName: 'object',
	partitionLabelColumnName: 'partitionLabel',
	renderedPropertyName: RENDERED_PROPERTY_NAME,
	unpartitionedSubjectRule: { propertyName: 'sharedBlock', valueList: ['ToyMetadata'] },
});
const toyDerivedDeclaration = () => cloneJson(require(path.join(TOY_BUNDLE_DIR, 'bridges', `${DERIVED_PLUGIN_NAME}.js`)).bridgeDeclaration);
const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};
// partitionShape — the derived toy over the question nodes, declaring the partition; mutateDeclaration adjusts it after
const partitionShapeWith = (mutateDeclaration) => (scenario) => {
	derivedShape(scenario);
	scenario.graph.nodeList = scenario.graph.nodeList.concat(cloneJson(PARTITION_NODE_LIST));
	scenario.graph.edgeList = scenario.graph.edgeList.concat(cloneJson(PARTITION_EDGE_LIST));
	const bridgeDeclaration = toyDerivedDeclaration();
	bridgeDeclaration.subjectSource = { kind: 'graphLabel', label: 'ToyQuestion', scopeStableIdListPath: null };
	bridgeDeclaration.renderingAllowList = { ...bridgeDeclaration.renderingAllowList, subject: bridgeDeclaration.renderingAllowList.subject.concat([RENDERED_PROPERTY_NAME]) };
	bridgeDeclaration.judgmentPartition = partitionDeclarationFixture();
	if (scenario.partitionDeclarationTransform !== undefined) {
		scenario.partitionDeclarationTransform(bridgeDeclaration);
	}
	if (mutateDeclaration !== undefined) {
		mutateDeclaration(bridgeDeclaration, scenario);
	}
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = { bridgeDeclaration };
};
const partitionShape = partitionShapeWith();
// a scratch copy of the partition file with its bytes transformed; the declaration points at it by absolute path.
// restateSha: the declared sha256 follows the new bytes, so only the fault under test can fire.
const scratchPartitionFileFor = ({ transformText, restateSha }) => (bridgeDeclaration) => {
	const scratchDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'toyPartition-'));
	const scratchFilePath = path.join(scratchDirPath, 'toyObjectPartition.tsv');
	const fixtureText = fs.readFileSync(path.join(TOY_BUNDLE_DIR, PARTITION_FILE_RELATIVE_PATH), 'utf8');
	fs.writeFileSync(scratchFilePath, transformText(fixtureText));
	bridgeDeclaration.judgmentPartition.filePath = scratchFilePath;
	if (restateSha) {
		bridgeDeclaration.judgmentPartition.sha256 = sha256OfBytes(fs.readFileSync(scratchFilePath));
	}
};

// ---------------------------------------------------------------------
// reading an outcome: the block's records for one subject, and the user prompt each was judged on
// ---------------------------------------------------------------------
const recordListFor = (outcome, subjectStableId) => blockOf(outcome).decisionRecordList.filter((oneRecord) => oneRecord.subjectStableId === subjectStableId);
const partitionFieldsOf = (oneRecord) => PARTITION_RECORD_FIELD_NAME_LIST.reduce((soFar, oneName) => (Object.prototype.hasOwnProperty.call(oneRecord, oneName) ? { ...soFar, [oneName]: oneRecord[oneName] } : soFar), {});
const userPromptFor = (outcome, oneRecord) => {
	const forensicEntry = outcome.stores.matchForensics.recordList.find((oneEntry) => oneEntry.record.promptHash === oneRecord.judge.promptHash);
	return forensicEntry === undefined ? '' : forensicEntry.record.userPrompt;
};
const labelLineRe = new RegExp(`^\\s*${RENDERED_PROPERTY_NAME}: (.*)$`, 'm');
const renderedLabelOf = (userPrompt) => {
	const match = labelLineRe.exec(userPrompt);
	return match === null ? null : match[1];
};

// ---------------------------------------------------------------------
// BG-PARTITION (a) two units, each stating its label
// ---------------------------------------------------------------------
const MATERIAL_ACCUMULATOR_FIND = "typeof oneTask.baseRecord.judgmentPartitionLabel === 'string' ? { [bridgeDeclaration.judgmentPartition.renderedPropertyName]: oneTask.baseRecord.judgmentPartitionLabel } : {}";
const unitConjunctList = [
	runConjunct({
		conjunctId: 'a_twoUnitsEachStatingItsLabel',
		title: `(a) the Identifier question, with instances in two partitions, freezes two records carrying exactly the literal labels and instance lists, each judged on a prompt whose '${RENDERED_PROPERTY_NAME}' line states its label; ${PARTITIONED_UNIT_COUNT_LITERAL} units in all`,
		twinNameList: ['partitionRemoved', 'labelNotRendered'],
		shape: partitionShape,
		judge: succeeded((runReport, outcome) => {
			// the frozen text orders one subject's records by the object each picked, so they are compared in label order
			const identifierRecordList = recordListFor(outcome, IDENTIFIER_QUESTION).sort((leftRecord, rightRecord) => (leftRecord.judgmentPartitionLabel < rightRecord.judgmentPartitionLabel ? -1 : 1));
			const unitList = identifierRecordList.map(partitionFieldsOf);
			const unitsExact = JSON.stringify(unitList) === JSON.stringify(IDENTIFIER_UNIT_LITERAL_LIST);
			const renderedLabelList = identifierRecordList.map((oneRecord) => renderedLabelOf(userPromptFor(outcome, oneRecord)));
			const labelsRendered = identifierRecordList.length === 2 && identifierRecordList.every((oneRecord, oneIndex) => renderedLabelList[oneIndex] === oneRecord.judgmentPartitionLabel);
			const promptHashesDistinct = new Set(identifierRecordList.map((oneRecord) => oneRecord.judge.promptHash)).size === identifierRecordList.length;
			const unitCount = blockOf(outcome).decisionRecordList.length;
			return {
				pass: unitsExact && labelsRendered && promptHashesDistinct && unitCount === PARTITIONED_UNIT_COUNT_LITERAL,
				detail: `units ${JSON.stringify(unitList)}; rendered labels [${renderedLabelList.join(' | ')}]; prompt hashes distinct ${promptHashesDistinct}; ${unitCount} unit(s) in the block`,
			};
		}),
	}),
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'a_twoUnitsEachStatingItsLabel', twinName: 'partitionRemoved', leverKind: 'inputFault', mutate: (scenario) => { scenario.partitionDeclarationTransform = (bridgeDeclaration) => { delete bridgeDeclaration.judgmentPartition; }; } });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'a_twoUnitsEachStatingItsLabel', twinName: 'labelNotRendered', fileName: FRAMEWORK_FILE, find: MATERIAL_ACCUMULATOR_FIND, replace: '{}' });

// ---------------------------------------------------------------------
// BG-PARTITION (b) the file and the instances are checked at the data boundary
// ---------------------------------------------------------------------
const PARTITION_REFUSAL_WHERE = 'the partition file is declared, checksummed data; fix the file or the declaration, never the check';
const fileRefusalConjunctList = [
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'b1_shaMismatchRefused',
		title: '(b) a partition file one byte away from its declared sha256 refuses the run by name',
		shape: partitionShapeWith(scratchPartitionFileFor({ transformText: (text) => text.replace('Toy Staff', 'Toy Stafe'), restateSha: false })),
		regex: /judgmentPartition file .* has sha256 [0-9a-f]{64} but the declaration states c88af19f/,
		twinName: 'shaCheckDeleted', fileName: PARTITION_FILE, find: 'if (measuredSha256 !== partitionDeclaration.sha256) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'b2_objectMissingFromFileRefused',
		title: '(b) an object an instance sits in, missing from the file (its line deleted, sha restated), refuses the run by name',
		shape: partitionShapeWith(scratchPartitionFileFor({ transformText: (text) => text.replace(/^StaffRecord\t.*\n/m, ''), restateSha: true })),
		regex: /object 'StaffRecord' \(instance toy:field\/StaffRecord\.Identifier of subject toy:question\/Identifier\) is missing from the judgment partition file/,
		twinName: 'coverageCheckDeleted', fileName: PARTITION_FILE, find: 'if (partitionLabel === undefined) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'b3_fileAbsentRefused',
		title: '(b) a declared partition file that is not there refuses the run by name',
		shape: partitionShapeWith((bridgeDeclaration) => { bridgeDeclaration.judgmentPartition.filePath = 'bridgeData/noSuchPartitionFile.tsv'; }),
		regex: /judgmentPartition\.filePath names no file at .*noSuchPartitionFile\.tsv/,
		twinName: 'existenceCheckDeleted', fileName: PARTITION_FILE, find: 'if (!fs.existsSync(filePath)) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'b4_headerLacksColumnRefused',
		title: '(b) a file whose header lacks the declared label column refuses the run by name',
		shape: partitionShapeWith(scratchPartitionFileFor({ transformText: (text) => text.replace('object\tpartitionLabel\t', 'object\tlabel\t'), restateSha: true })),
		regex: /header \[object, label, reason\] lacks column 'partitionLabel'/,
		twinName: 'headerCheckDeleted', fileName: PARTITION_FILE, find: 'if (objectColumnIndex === -1 || labelColumnIndex === -1) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'b5_blankLabelCellRefused',
		title: '(b) a line with a blank label cell refuses the run by name',
		shape: partitionShapeWith(scratchPartitionFileFor({ transformText: (text) => text.replace('StudentEnrollment\tToy Student\t', 'StudentEnrollment\t \t'), restateSha: true })),
		regex: /line 3 has a blank 'partitionLabel' cell/,
		twinName: 'blankCellCheckDeleted', fileName: PARTITION_FILE, find: "if (objectName === '' || partitionLabel === '') {", replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'b6_duplicateObjectRefused',
		title: '(b) a file naming one object twice refuses the run by name, even when both lines agree',
		shape: partitionShapeWith(scratchPartitionFileFor({ transformText: (text) => `${text}StaffRecord\tToy Staff\tthe same line again\n`, restateSha: true })),
		regex: /names object 'StaffRecord' twice \(line 6\)/,
		twinName: 'duplicateCheckDeleted', fileName: PARTITION_FILE, find: 'if (labelByObjectName.has(objectName)) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'b7_instanceNamesNoObjectRefused',
		title: '(b) an instance carrying no object-naming property refuses the run by name',
		shape: (scenario) => {
			partitionShape(scenario);
			scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) => (oneNode.stableId === 'toy:field/StaffRecord.Identifier' ? { ...oneNode, properties: Object.keys(oneNode.properties).filter((oneName) => oneName !== 'objectName').reduce((soFar, oneName) => ({ ...soFar, [oneName]: oneNode.properties[oneName] }), {}) } : oneNode));
		},
		regex: /instance toy:field\/StaffRecord\.Identifier of subject toy:question\/Identifier carries no 'objectName'/,
		twinName: 'objectNameCheckDeleted', fileName: PARTITION_FILE, find: 'if (!isNonEmptyString(objectName)) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'b8_subjectWithoutInstanceRefused',
		title: '(b) a partitioned subject with no instance edge refuses the run by name',
		shape: (scenario) => {
			partitionShape(scenario);
			scenario.graph.edgeList = scenario.graph.edgeList.filter((oneEdge) => oneEdge.fromStableId !== TIMESTAMP_QUESTION);
		},
		regex: /subject toy:question\/Timestamp has no 'HAS_INSTANCE' instance/,
		twinName: 'noInstanceCheckDeleted', fileName: PARTITION_FILE, find: 'if (instanceStableIdList.length === 0) {', replace: 'if (false) {',
	}),
];

// ---------------------------------------------------------------------
// BG-PARTITION (c) the unpartitioned subject is one unit
// ---------------------------------------------------------------------
const unpartitionedConjunctList = [
	runConjunct({
		conjunctId: 'c_unpartitionedSubjectIsOneUnit',
		title: '(c) the Timestamp question, named by the unpartitioned rule, freezes ONE record with label null and all its instances, judged on a prompt with no partition line',
		twinNameList: ['unpartitionedRuleDropped', 'ruleNeverMatches'],
		shape: partitionShape,
		judge: succeeded((runReport, outcome) => {
			const timestampRecordList = recordListFor(outcome, TIMESTAMP_QUESTION);
			const unitList = timestampRecordList.map(partitionFieldsOf);
			const unitExact = timestampRecordList.length === 1 && JSON.stringify(unitList[0]) === JSON.stringify(TIMESTAMP_UNIT_LITERAL);
			const renderedLabel = timestampRecordList.length === 1 ? renderedLabelOf(userPromptFor(outcome, timestampRecordList[0])) : 'n/a';
			return { pass: unitExact && renderedLabel === null && timestampRecordList[0].targetKey === `retrieval:${TIMESTAMP_QUESTION}`, detail: `${timestampRecordList.length} record(s) ${JSON.stringify(unitList)}; rendered label ${JSON.stringify(renderedLabel)}` };
		}),
	}),
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'c_unpartitionedSubjectIsOneUnit', twinName: 'unpartitionedRuleDropped', leverKind: 'inputFault', mutate: (scenario) => { scenario.partitionDeclarationTransform = (bridgeDeclaration) => { bridgeDeclaration.judgmentPartition.unpartitionedSubjectRule = null; }; } });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'c_unpartitionedSubjectIsOneUnit', twinName: 'ruleNeverMatches', fileName: PARTITION_FILE, find: 'if (rule !== null && rule.valueList.indexOf(subjectProperties[rule.propertyName]) !== -1) {', replace: 'if (false) {' });

// ---------------------------------------------------------------------
// BG-PARTITION (e) the frozen instance list is canonical
// ---------------------------------------------------------------------
const canonicalConjunctList = [
	runConjunct({
		conjunctId: 'e_instanceListSortedByTheFreeze',
		title: '(e) with the partition producing its instance lists in REVERSE order, the frozen lists are still sorted: the freeze canonicalises judgmentPartitionInstanceStableIdList',
		twinNameList: ['freezeDoesNotSortInstanceList'],
		shape: (scenario) => {
			partitionShape(scenario);
			scenario.frameworkMutationList.push({ modulePath: frameworkFile(PARTITION_FILE), find: "const instanceStableIdList = (instanceStableIdListBySubject.get(oneLeaf.subjectStableId) || []).slice().sort(compareStrings);", replace: "const instanceStableIdList = (instanceStableIdListBySubject.get(oneLeaf.subjectStableId) || []).slice().sort(compareStrings).reverse();" });
		},
		judge: succeeded((runReport, outcome) => {
			const multiInstanceList = blockOf(outcome).decisionRecordList.filter((oneRecord) => oneRecord.judgmentPartitionInstanceStableIdList.length > 1).map((oneRecord) => oneRecord.judgmentPartitionInstanceStableIdList);
			const allSorted = multiInstanceList.every((oneList) => JSON.stringify(oneList) === JSON.stringify(oneList.slice().sort()));
			return { pass: multiInstanceList.length === 2 && allSorted, detail: `${multiInstanceList.length} multi-instance list(s): ${JSON.stringify(multiInstanceList)}` };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'e_instanceListSortedByTheFreeze', twinName: 'freezeDoesNotSortInstanceList', fileName: DECISION_BLOCK_FILE, find: "'assertingSubjectList', 'judgmentPartitionInstanceStableIdList']);", replace: "'assertingSubjectList']);" });

// ---------------------------------------------------------------------
// BG-PARTITION (f) the declaration's cross-key rules
// ---------------------------------------------------------------------
const contractConjunctList = [
	// f1 runs the derived toy under a derived row that does NOT admit a partition, so removing the check lets a whole
	// plugin through and the run succeeds; a documentary plugin would instead crash on its absent allow-list, which
	// observes nothing. f0 holds the shipped rows to their literal values.
	pureConjunct({
		conjunctId: 'f0_acquisitionRowsAdmitLiteral',
		title: '(f) SOURCE_ACQUISITION_REGISTRY admits a partition on derived only: standard false, crosswalk false, derived true',
		twinNameList: ['crosswalkRowAdmits'],
		judge: (scenario) => {
			const contractLib = scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: frameworkFile(CONTRACT_FILE), mutationList: scenario.frameworkMutationList }) : require(frameworkFile(CONTRACT_FILE));
			const admitsByBasis = Object.keys(contractLib.SOURCE_ACQUISITION_REGISTRY).sort().reduce((soFar, oneBasis) => ({ ...soFar, [oneBasis]: contractLib.SOURCE_ACQUISITION_REGISTRY[oneBasis].admitsJudgmentPartition }), {});
			return { pass: JSON.stringify(admitsByBasis) === JSON.stringify({ crosswalk: false, derived: true, standard: false }), detail: JSON.stringify(admitsByBasis) };
		},
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'f1_basisNotAdmittingRefused',
		title: '(f) under an acquisition row that does not admit a partition, a plugin declaring judgmentPartition is refused at registration by name',
		shape: (scenario) => {
			partitionShape(scenario);
			scenario.frameworkMutationList.push({ modulePath: frameworkFile(CONTRACT_FILE), find: "		forbiddenDeclarationKeyList: Object.freeze(['tupleFieldColumnMap', 'mappingProvider']),\n		admitsJudgmentPartition: true,", replace: "		forbiddenDeclarationKeyList: Object.freeze(['tupleFieldColumnMap', 'mappingProvider']),\n		admitsJudgmentPartition: false," });
		},
		regex: /carries judgmentPartition, which matchBasis 'derived' does not admit/,
		twinName: 'admitsCheckDeleted', fileName: CONTRACT_FILE, find: 'if (SOURCE_ACQUISITION_REGISTRY[bridgeDeclaration.matchBasis].admitsJudgmentPartition !== true) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'f2_renderedNameOutsideAllowListRefused',
		title: '(f) a renderedPropertyName the subject allow-list does not name is refused at registration by name',
		shape: partitionShapeWith((bridgeDeclaration) => { bridgeDeclaration.renderingAllowList.subject = bridgeDeclaration.renderingAllowList.subject.filter((oneName) => oneName !== RENDERED_PROPERTY_NAME); }),
		regex: /judgmentPartition\.renderedPropertyName 'objectPartition' is not in renderingAllowList\.subject/,
		twinName: 'allowListCheckDeleted', fileName: CONTRACT_FILE, find: 'if (bridgeDeclaration.renderingAllowList.subject.indexOf(partitionDeclaration.renderedPropertyName) === -1) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'f3_blindedRulePropertyRefused',
		title: '(f) an unpartitioned rule reading a property the plugin blinds is refused at registration by name',
		shape: partitionShapeWith((bridgeDeclaration) => { bridgeDeclaration.blindingDeclaration = bridgeDeclaration.blindingDeclaration.concat(['sharedBlock']); }),
		regex: /judgmentPartition reads property 'sharedBlock', which blindingDeclaration names/,
		twinName: 'blindingCheckDeleted', fileName: CONTRACT_FILE, find: 'if (blindedReadName !== undefined) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'f4_renderedNameCarriedBySubjectRefused',
		title: '(f) a subject that already carries the property the label renders under refuses the run by name',
		shape: (scenario) => {
			partitionShape(scenario);
			scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) => (oneNode.stableId === IDENTIFIER_QUESTION ? { ...oneNode, properties: { ...oneNode.properties, [RENDERED_PROPERTY_NAME]: 'stamped by the forge' } } : oneNode));
		},
		regex: /subject toy:question\/Identifier already carries a property named 'objectPartition'/,
		twinName: 'collisionCheckDeleted', fileName: PARTITION_FILE, find: 'if (Object.prototype.hasOwnProperty.call(subjectProperties, partitionDeclaration.renderedPropertyName)) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'f5_declarationShapeRefused',
		title: '(f) a judgmentPartition declaration missing a member is refused at registration by name',
		shape: partitionShapeWith((bridgeDeclaration) => { delete bridgeDeclaration.judgmentPartition.instanceEdgeType; }),
		regex: /judgmentPartition' kind 'objectPartitionFile' must be exactly \{ kind, filePath, sha256, instanceEdgeType/,
		twinName: 'memberCheckDeleted', fileName: PARTITION_FILE, find: 'if (!hasExactMembers(value, memberNameList)) {', replace: 'if (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'f6_unknownKindRefused',
		title: '(f) a judgmentPartition kind with no JUDGMENT_PARTITION_KIND_REGISTRY row is refused at registration by name',
		shape: partitionShapeWith((bridgeDeclaration) => { bridgeDeclaration.judgmentPartition.kind = 'objectPartitionSheet'; }),
		regex: /judgmentPartition' must be an object whose kind is one of objectPartitionFile/,
		twinName: 'kindRowAdded', fileName: PARTITION_FILE, find: '		readLabelByObjectName: readPartitionFile,\n	}),\n});', replace: "		readLabelByObjectName: readPartitionFile,\n	}),\n	objectPartitionSheet: Object.freeze({ memberNameList: Object.freeze(['kind', 'filePath', 'sha256', 'instanceEdgeType', 'instanceObjectPropertyName', 'objectColumnName', 'partitionLabelColumnName', 'renderedPropertyName', 'unpartitionedSubjectRule']), readLabelByObjectName: readPartitionFile }),\n});",
	}),
];

// ---------------------------------------------------------------------
// BG-PARTITION-ORACLE — R1, and the §1.7 conjuncts against the text captured at this phase's branch cut
// ---------------------------------------------------------------------
const branchCutText = fs.readFileSync(BRANCH_CUT_BLOCK_PATH, 'utf8');
const maskedTextOf = (frozenText) => {
	const fingerprintMatchList = frozenText.match(FRAMEWORK_FINGERPRINT_TEXT_RE) || [];
	return fingerprintMatchList.length === 1 ? { maskedText: frozenText.replace(FRAMEWORK_FINGERPRINT_TEXT_RE, '"frameworkFingerprint":"MASKED"') } : { error: `frameworkFingerprint occurs ${fingerprintMatchList.length} times in the frozen text (must be exactly once)` };
};
const frozenTextOf = (outcome) => outcome.stores.decisionStore.rowList.find((oneRow) => oneRow.decisionBlockHash === outcome.runReport.decisionBlock.decisionBlockHash).frozenText;
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
const PARTITION_FIELDS_SPREAD_FIND = '...(oneLeaf.judgmentPartitionInstanceStableIdList === undefined ? {} : { judgmentPartitionLabel: oneLeaf.judgmentPartitionLabel, judgmentPartitionInstanceStableIdList: oneLeaf.judgmentPartitionInstanceStableIdList }),';
const PARTITION_FIELDS_NULLED = '...(oneLeaf.judgmentPartitionInstanceStableIdList === undefined ? { judgmentPartitionLabel: null } : { judgmentPartitionLabel: oneLeaf.judgmentPartitionLabel, judgmentPartitionInstanceStableIdList: oneLeaf.judgmentPartitionInstanceStableIdList }),';
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PARTITION', conjunctId: 'f0_acquisitionRowsAdmitLiteral', twinName: 'crosswalkRowAdmits', fileName: CONTRACT_FILE, find: "		forbiddenDeclarationKeyList: DERIVED_ONLY_KEY_LIST,\n		admitsJudgmentPartition: false,\n	}),\n	derived:", replace: "		forbiddenDeclarationKeyList: DERIVED_ONLY_KEY_LIST,\n		admitsJudgmentPartition: true,\n	}),\n	derived:" });
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
		title: "(d, §1.7) with judgmentPartition absent, the toy derived block equals the text captured at this phase's cut (16f661a) with frameworkFingerprint masked",
		twinNameList: ['abstentionFieldForced', 'unpartitionedRecordGainsLabel'],
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
		title: '(§1.7) the toy derived plugin, declaring no judgmentPartition, registers and runs, and no record carries a partition field (omitted, never null)',
		twinNameList: ['partitionKeyMadeRequired', 'unpartitionedRecordGainsLabelToo'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const carryingList = blockOf(outcome).decisionRecordList.filter((oneRecord) => PARTITION_RECORD_FIELD_NAME_LIST.some((oneName) => Object.prototype.hasOwnProperty.call(oneRecord, oneName)));
			return { pass: carryingList.length === 0, detail: `${carryingList.length} record(s) carry a partition field` };
		}),
	}),
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-PARTITION-ORACLE', conjunctId: 'r1_runEBlockParsesAndKeepsItsId', twinName: 'runEBlockOneByteChanged', leverKind: 'inputFault', mutate: (scenario) => { scenario.runEBlockTextTransform = (frozenText) => frozenText.replace('"frameworkGeneration":"', '"frameworkGeneration":"x'); } });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PARTITION-ORACLE', conjunctId: 'd_toyDerivedBlockMaskedIdentical', twinName: 'abstentionFieldForced', fileName: FRAMEWORK_FILE, find: ABSTENTION_RECORD_FIND, replace: ABSTENTION_RECORD_FORCED });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PARTITION-ORACLE', conjunctId: 'd_toyDerivedBlockMaskedIdentical', twinName: 'unpartitionedRecordGainsLabel', fileName: FRAMEWORK_FILE, find: PARTITION_FIELDS_SPREAD_FIND, replace: PARTITION_FIELDS_NULLED });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PARTITION-ORACLE', conjunctId: 'm_unmaskedDiffersOnlyInFrameworkFingerprint', twinName: 'abstentionFieldForcedUnmasked', fileName: FRAMEWORK_FILE, find: ABSTENTION_RECORD_FIND, replace: ABSTENTION_RECORD_FORCED });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PARTITION-ORACLE', conjunctId: 'o_absentKeyIsOptionalAndOmitted', twinName: 'partitionKeyMadeRequired', fileName: CONTRACT_FILE, find: "judgmentPartition: Object.freeze({ optional: true, kind: 'judgmentPartition' }),", replace: "judgmentPartition: Object.freeze({ kind: 'judgmentPartition' })," });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PARTITION-ORACLE', conjunctId: 'o_absentKeyIsOptionalAndOmitted', twinName: 'unpartitionedRecordGainsLabelToo', fileName: FRAMEWORK_FILE, find: PARTITION_FIELDS_SPREAD_FIND, replace: PARTITION_FIELDS_NULLED });

const gateDeclarationList = [
	{ gateId: 'BG-PARTITION', title: 'each subject is judged once per partition of its instances, the partition read from a declared, checksummed file', conjunctList: [].concat(unitConjunctList, fileRefusalConjunctList, unpartitionedConjunctList, canonicalConjunctList, contractConjunctList) },
	{ gateId: 'BG-PARTITION-ORACLE', title: 'run E still replays hermetically, and with the key absent the toy Ed-Fi-shaped block is unmoved but for its framework fingerprint', conjunctList: oracleConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-PARTITION+BG-PARTITION-ORACLE', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 18 + 4 },
	() => harness.report(),
);
