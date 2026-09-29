#!/usr/bin/env node
'use strict';

// test-sif260928Tree.js — the phase A2 gates for the sif260928 per-object tree: the Containers, the
// HAS_FIELD and HAS_CHILD edges, and each node's structural parent (PLAN-sifReplacement-smallPhases-
// 092826.md §3 A2; SPEC §3.1, §3.2 as amended by §9 A25 and A26). ALL PURE: the whole forge runs in
// pure mode (skipEmbedding, no Docker, no network). Every conjunct is observed RED under its own twin
// before the family counts as green; the framework's gate engine does the sweep (gateSuiteRunner).
//
//   A2-CONTAINERS (a) Containers = 6,586, exactly the xpath prefixes below the object that are not
//                     rows, read from the TSV independently; none carries isUnbounded (A26)
//   A2-HASFIELD   (b) HAS_FIELD = 15,620, one per Field, from the Object of its xpath
//   A2-STRUCTURE  (c) the structural contract finalizes (acyclic), every node's parentId chain reaches
//                     the Object of its path, and each HAS_CHILD edge is the parentId it mirrors
//   A2-DEPTHONE   (d) every depth-1 Container has exactly one incoming HAS_CHILD, from its Object
//   A2-UNCHANGED  (e) the A1b and A1c counts are unchanged beside the new nodes and edges (restated in
//                     A3: the node labels and edge types gain the Questions and HAS_INSTANCE, counted
//                     by test-sif260928Questions.js; restated in A4: they gain the Codesets, their
//                     values, HAS_VALUE, CONSTRAINED_BY and REFERENCES_OBJECT, counted by
//                     test-sif260928Codesets.js)
//   A2-DEPTH          SPEC §9 A25: the framework's depth = xpathDepth - 1 for every Field (and the
//                     segment count - 1 for every Container)
//   A2-ATTRIBUTE      SPEC §9 A26: an attribute on an element that is itself a row is parented on
//                     that element's Field, through Field -HAS_CHILD-> Field (3,138)
//
// The twins mutate the walk in memory (moduleDouble); nothing in the tree is written.
//
// Run: PATH=/usr/local/bin:$PATH node forges/sif260928/test/test-sif260928Tree.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase A2 gates: containers, HAS_FIELD, the structural tree, depth-1 containers, unchanged counts, depth, attributes on fields

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const BUNDLE_DIR = path.join(__dirname, '..');
const TREE_ROOT = path.join(BUNDLE_DIR, '..', '..');
const FORGE_FRAMEWORK_DIR = path.join(TREE_ROOT, 'lib', 'forge-framework');
const ENTRY_MODULE_PATH = path.join(BUNDLE_DIR, 'forgeSif260928.js');
const WALK_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928Walk.js');
const DESCRIPTOR_PATH = path.join(BUNDLE_DIR, 'parserDescriptor.ini');

const { runGateFamily } = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'gateSuiteRunner'));
const moduleDouble = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'moduleDouble'));
const { makeTwinRegistry } = require(path.join(FORGE_FRAMEWORK_DIR, 'roundTripHarness', 'twinRegistry'));
const rosterLib = require(path.join(FORGE_FRAMEWORK_DIR, 'roster'));

const descriptorValueByName = rosterLib.readDescriptorSection(DESCRIPTOR_PATH).valueByName;
const SOURCE_PATH = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', descriptorValueByName.defaultSnapshot, descriptorValueByName.sourceFile);

// ---- FROZEN LITERALS. Never edited to match a measurement.
// PLAN §3 A2 (a), SPEC §1: Containers. (SPEC §1's '1,887 unbounded' is an XSD-only fact the snapshot
// cannot state; A26 ruled that no Container carries isUnbounded.)
const RULED_CONTAINER_COUNT = 6586;
// PLAN §3 A2 (b): one HAS_FIELD per Field
const RULED_HAS_FIELD_COUNT = 15620;
// PLAN §3 A1c (a) and A2 (e), SPEC §1: the earlier counts, beside the Containers; A3 adds the 5,018
// Questions (SPEC §9 A21) and their 15,620 HAS_INSTANCE edges (PLAN §3 A3 (b))
const RULED_NODE_COUNT_BY_LABEL = Object.freeze({
	Sif260928Root: 1,
	Sif260928Object: 159,
	Sif260928Container: 6586,
	Sif260928Field: 15620,
	Sif260928Question: 5018,
	// A4 (SPEC §9 A28), from evidence/A4/countCodesetsAndReferences.py, a count sharing no forge code
	Sif260928Codeset: 131,
	Sif260928CodesetValue: 4055,
	// A5 (SPEC §9 A1): one text node per distinct text, C1's literal (sifTextCountWitness-51d3db06b2e6.json)
	Sif260928EmbedText: 7698,
});
const RULED_HAS_INSTANCE_COUNT = 15620;
// A4, the same separate count: one HAS_VALUE per CodesetValue, one CONSTRAINED_BY per list-carrying
// Field, one REFERENCES_OBJECT per resolved RefId Field (SPEC §9 A24, A28)
const RULED_A4_EDGE_COUNT_BY_TYPE = Object.freeze({ HAS_VALUE: 4055, CONSTRAINED_BY: 1495, REFERENCES_OBJECT: 607 });
// A5: one EMBEDS_TEXT_OF per distinct (text, Question or Object) pair, rebuilt from C1's question map and
// segment table alone (14,380 Question pairs and 159 Object names; DEVLOG-A5.md)
const RULED_A5_EDGE_COUNT_BY_TYPE = Object.freeze({ EMBEDS_TEXT_OF: 14539 });
// Measured on the TSV by A2 BEFORE the tree existed (scratch script over the forge's loader):
// 699 three-segment Containers, and 3,138 attributes on an element that is itself a row, over
// 2,645 such elements. The other two rows follow: 6,586 - 699, and the 14,431 Fields not directly
// on their Object less the 3,138.
const RULED_HAS_CHILD_COUNT_BY_KIND_PAIR = Object.freeze({
	'object>container': 699,
	'container>container': 5887,
	'container>field': 11293,
	'field>field': 3138,
});
const RULED_ATTRIBUTE_ON_FIELD_COUNT = 3138;
const RULED_FIELD_WITH_ATTRIBUTE_CHILD_COUNT = 2645;
// SPEC §3.1 as amended: a Container carries only what its path implies, plus the kit's and the finalizer's stamps
const RULED_CONTAINER_PROPERTY_NAME_LIST = Object.freeze(['_id', '_source', 'name', 'role', 'sif260928StableId', 'parentId', 'path', 'objectName', 'depth', 'crossRefs'].sort());

// ---- named rows the twins act on
const NAMED_OBJECT_PATH = '/AccountingPeriods/AccountingPeriod';
const NAMED_OTHER_OBJECT_STABLE_ID = 'sif260928:object/ActivityProviders/ActivityProvider';
const NAMED_DEPTH_ONE_CONTAINER_PATH = '/AccountingPeriods/AccountingPeriod/SIF_Metadata';
const NAMED_CYCLE_CONTAINER_PATH = '/AccountingPeriods/AccountingPeriod/SIF_Metadata/TimeElements';
const NAMED_CYCLE_CHILD_CONTAINER_STABLE_ID = 'sif260928:container/AccountingPeriods/AccountingPeriod/SIF_Metadata/TimeElements/TimeElement';
const NAMED_NESTED_FIELD_XPATH = '/AccountingPeriods/AccountingPeriod/SIF_Metadata/TimeElements/TimeElement/Type';
const NAMED_NESTED_FIELD_GRANDPARENT_STABLE_ID = 'sif260928:container/AccountingPeriods/AccountingPeriod/SIF_Metadata/TimeElements';
const NAMED_HAS_FIELD_XPATH = '/AccountingPeriods/AccountingPeriod/EndDate';

// ---- the TSV read independently of the loader and the walk: every row's xpath, in source order
const XPATH_COLUMN_INDEX = 5;
const RAW_XPATH_LIST = fs
	.readFileSync(SOURCE_PATH, 'utf8')
	.split('\r\n')
	.filter((lineText) => !lineText.startsWith('Name\tMandatory\tCharacteristics\t'))
	.map((lineText) => lineText.split('\t'))
	.filter((cellList) => cellList.length === 8)
	.map((cellList) => cellList[XPATH_COLUMN_INDEX]);
const RAW_XPATH_SET = new Set(RAW_XPATH_LIST);
const segmentListOf = (nodePath) => nodePath.split('/').slice(1);
const pathOfSegmentList = (segmentList) => `/${segmentList.join('/')}`;
// the independent Container set: every prefix of three or more segments that is not a row (C1's rule)
const EXPECTED_CONTAINER_PATH_SET = new Set(
	RAW_XPATH_LIST.reduce((soFar, xpath) => {
		const segmentList = segmentListOf(xpath);
		return soFar.concat(segmentList.slice(3).map((unusedSegment, segmentIndex) => pathOfSegmentList(segmentList.slice(0, 3 + segmentIndex))).filter((prefixPath) => !RAW_XPATH_SET.has(prefixPath)));
	}, []),
);
const objectPathOf = (nodePath) => pathOfSegmentList(segmentListOf(nodePath).slice(0, 2));

// ---- the subject every conjunct reads and every twin mutates (on a clone)
const makeSubject = () => ({ bundleMutationList: [] });
const cloneSubject = (subject) => ({ ...subject, bundleMutationList: subject.bundleMutationList.slice() });

const forgeWith = ({ mutationList }, callback) => {
	const forgeBundle = mutationList.length ? moduleDouble.loadWithMutations({ modulePath: ENTRY_MODULE_PATH, mutationList }) : require(ENTRY_MODULE_PATH);
	forgeBundle({ embedder: null }).forge({ sourcePath: SOURCE_PATH, owner: 'test', skipEmbedding: true }, callback);
};

// a conjunct over the forged nodes and edges: a forge refusal is a FAIL, with the refusal as the detail
const overForged = (judgeForged) => (subject, callback) => {
	forgeWith({ mutationList: subject.bundleMutationList }, (forgeError, forged) => {
		if (forgeError) {
			callback('', { pass: false, detail: `forge refused: ${String(forgeError).slice(0, 300)}` });
			return;
		}
		callback('', judgeForged(forged));
	});
};

const nodeListByLabel = (forged, perStandardLabel) => forged.nodes.filter((oneNode) => oneNode.labels[1] === perStandardLabel);
const edgeListByType = (forged, edgeType) => forged.edges.filter((oneEdge) => oneEdge.type === edgeType);
const countBy = (itemList, countedValueOf) =>
	itemList.reduce((countByValue, oneItem) => {
		const countedValue = countedValueOf(oneItem);
		countByValue[countedValue] = (countByValue[countedValue] || 0) + 1;
		return countByValue;
	}, {});
const sortedEntriesText = (countByValue) => JSON.stringify(Object.entries(countByValue).sort());
const KIND_BY_PER_STANDARD_LABEL = Object.freeze({ Sif260928Object: 'object', Sif260928Container: 'container', Sif260928Field: 'field' });
const firstOf = (itemList) => (itemList.length ? ` (first ${JSON.stringify(itemList[0])})` : '');

const twinRegistry = makeTwinRegistry();
// a twin applies one mutation, or a list of them applied together
const registerMutationTwin = ({ gateId, conjunctId, twinName, mutation, mutationList = [mutation] }) => {
	twinRegistry.register({
		gateId,
		conjunctId,
		twinName,
		leverKind: 'productionMutation',
		shippedConfig: true,
		run: (subject) => {
			mutationList.forEach((oneMutation) => {
				moduleDouble.assertMutationApplies(oneMutation);
				subject.bundleMutationList.push(oneMutation);
			});
			return subject;
		},
	});
};
const walkMutation = ({ find, replace }) => ({ modulePath: WALK_MODULE_PATH, find, replace });

// the walk's own lines the twins rewrite
const CONTAINER_PARENT_LINE = 'structural: { parentId: attachToStructuralParent({ nodePath: containerFacts.containerPath }), path: containerFacts.containerPath },';
const FIELD_PARENT_LINE = 'structural: { parentId: attachToStructuralParent({ nodePath: fieldFacts.xpath }), path: fieldFacts.xpath },';

const CONTAINERS_GATE_ID = 'A2-CONTAINERS';
const HAS_FIELD_GATE_ID = 'A2-HASFIELD';
const STRUCTURE_GATE_ID = 'A2-STRUCTURE';
const DEPTH_ONE_GATE_ID = 'A2-DEPTHONE';
const UNCHANGED_GATE_ID = 'A2-UNCHANGED';
const DEPTH_GATE_ID = 'A2-DEPTH';
const ATTRIBUTE_GATE_ID = 'A2-ATTRIBUTE';

// =====================================================================
// (a) A2-CONTAINERS
// =====================================================================
const containersConjunctList = [
	{
		conjunctId: 'containersAreTheNonRowPrefixes',
		title: 'exactly 6,586 Containers, whose paths equal the TSV\'s non-row prefixes read independently; each is named for its last segment, carries its objectName and the ruled properties only, and none carries isUnbounded',
		twinNameList: ['depthThreePrefixesSkipped', 'rowPrefixesMintedAsContainers'],
		evaluate: overForged((forged) => {
			const containerNodeList = nodeListByLabel(forged, 'Sif260928Container');
			const mintedPathSet = new Set(containerNodeList.map((oneNode) => oneNode.properties.path));
			const missingPathList = [...EXPECTED_CONTAINER_PATH_SET].filter((containerPath) => !mintedPathSet.has(containerPath));
			const unexpectedPathList = [...mintedPathSet].filter((containerPath) => !EXPECTED_CONTAINER_PATH_SET.has(containerPath));
			const wrongList = containerNodeList
				.filter((oneNode) => {
					const segmentList = segmentListOf(oneNode.properties.path);
					return (
						oneNode.stableId !== `sif260928:container${oneNode.properties.path}` ||
						oneNode.properties.name !== segmentList[segmentList.length - 1] ||
						oneNode.properties.objectName !== segmentList[1] ||
						JSON.stringify(Object.keys(oneNode.properties).sort()) !== JSON.stringify(RULED_CONTAINER_PROPERTY_NAME_LIST)
					);
				})
				.map((oneNode) => oneNode.stableId);
			const isUnboundedCount = containerNodeList.filter((oneNode) => Object.prototype.hasOwnProperty.call(oneNode.properties, 'isUnbounded')).length;
			return {
				pass: containerNodeList.length === RULED_CONTAINER_COUNT && EXPECTED_CONTAINER_PATH_SET.size === RULED_CONTAINER_COUNT && missingPathList.length === 0 && unexpectedPathList.length === 0 && wrongList.length === 0 && isUnboundedCount === 0,
				detail: `Containers ${containerNodeList.length}, independent ${EXPECTED_CONTAINER_PATH_SET.size}; missing ${missingPathList.length}${firstOf(missingPathList)}; unexpected ${unexpectedPathList.length}${firstOf(unexpectedPathList)}; wrong ${wrongList.length}${firstOf(wrongList)}; isUnbounded on ${isUnboundedCount}`,
			};
		}),
	},
];
// the plan's twin: skip the three-segment prefixes, and re-parent their children one level up onto the
// Object, so the tree stays whole, the forge completes, and the count itself moves (6,586 - 699)
registerMutationTwin({
	gateId: CONTAINERS_GATE_ID,
	conjunctId: 'containersAreTheNonRowPrefixes',
	twinName: 'depthThreePrefixesSkipped',
	mutationList: [
		walkMutation({ find: 'let prefixSegmentCount = OBJECT_SEGMENT_COUNT + 1;', replace: 'let prefixSegmentCount = OBJECT_SEGMENT_COUNT + 2;' }),
		walkMutation({
			find: 'const parentPath = structuralParentPathOf(nodePath);',
			replace: 'const elementPath = structuralParentPathOf(nodePath);\n		const parentPath = nodeKindByPath.has(elementPath) ? elementPath : structuralParentPathOf(elementPath);',
		}),
	],
});
registerMutationTwin({ gateId: CONTAINERS_GATE_ID, conjunctId: 'containersAreTheNonRowPrefixes', twinName: 'rowPrefixesMintedAsContainers', mutation: walkMutation({ find: 'if (!xpathSet.has(containerPath) && !containerFactsByPath.has(containerPath)) {', replace: 'if (!containerFactsByPath.has(containerPath)) {' }) });

// =====================================================================
// (b) A2-HASFIELD
// =====================================================================
const hasFieldConjunctList = [
	{
		conjunctId: 'oneHasFieldPerField',
		title: 'HAS_FIELD = 15,620: every Field has exactly one, from the Object of its xpath, and HAS_FIELD reaches nothing but Fields',
		twinNameList: ['oneHasFieldDropped'],
		evaluate: overForged((forged) => {
			const hasFieldEdgeList = edgeListByType(forged, 'HAS_FIELD');
			const nodeByStableId = new Map(forged.nodes.map((oneNode) => [oneNode.stableId, oneNode]));
			const incomingCountByFieldStableId = countBy(hasFieldEdgeList, (oneEdge) => oneEdge.toRef.id);
			const fieldWrongList = nodeListByLabel(forged, 'Sif260928Field').filter((oneNode) => incomingCountByFieldStableId[oneNode.stableId] !== 1).map((oneNode) => oneNode.stableId);
			const edgeWrongList = hasFieldEdgeList
				.filter((oneEdge) => {
					const toNode = nodeByStableId.get(oneEdge.toRef.id);
					return toNode.labels[1] !== 'Sif260928Field' || oneEdge.fromRef.id !== `sif260928:object${objectPathOf(toNode.properties.xpath)}`;
				})
				.map((oneEdge) => `${oneEdge.fromRef.id} -> ${oneEdge.toRef.id}`);
			return {
				pass: hasFieldEdgeList.length === RULED_HAS_FIELD_COUNT && fieldWrongList.length === 0 && edgeWrongList.length === 0,
				detail: `HAS_FIELD ${hasFieldEdgeList.length}; Fields without exactly one ${fieldWrongList.length}${firstOf(fieldWrongList)}; edges from the wrong Object ${edgeWrongList.length}${firstOf(edgeWrongList)}`,
			};
		}),
	},
];
registerMutationTwin({
	gateId: HAS_FIELD_GATE_ID,
	conjunctId: 'oneHasFieldPerField',
	twinName: 'oneHasFieldDropped',
	mutation: walkMutation({ find: '		kit.addEdge({ edgeType: EDGE_TYPES.HAS_FIELD,', replace: `		if (fieldFacts.xpath !== '${NAMED_HAS_FIELD_XPATH}') kit.addEdge({ edgeType: EDGE_TYPES.HAS_FIELD,` }),
});

// =====================================================================
// (c) A2-STRUCTURE
// =====================================================================
const structureConjunctList = [
	{
		conjunctId: 'finalizesAndEveryNodeReachesItsObject',
		title: "the forge finalizes (the framework refuses a cycle); every Container's and Field's parentId chain reaches the Object of its path; a node's parent is the element one xpath segment up; HAS_CHILD counts by kind pair equal the ruled table, each edge mirrors its child's parentId, and a Field directly on its Object has none",
		twinNameList: ['containerMadeItsOwnDescendant', 'containerReparentedIntoAnotherObject'],
		evaluate: overForged((forged) => {
			const nodeByStableId = new Map(forged.nodes.map((oneNode) => [oneNode.stableId, oneNode]));
			const treeNodeList = forged.nodes.filter((oneNode) => oneNode.labels[1] === 'Sif260928Container' || oneNode.labels[1] === 'Sif260928Field');
			const objectOfChain = (oneNode) => {
				let cursor = oneNode;
				while (cursor.labels[1] !== 'Sif260928Object') {
					cursor = nodeByStableId.get(cursor.properties.parentId);
				}
				return cursor;
			};
			const notReachingList = treeNodeList.filter((oneNode) => objectOfChain(oneNode).properties.path !== objectPathOf(oneNode.properties.path)).map((oneNode) => oneNode.stableId);
			const wrongParentList = treeNodeList
				.filter((oneNode) => {
					const parentPath = pathOfSegmentList(segmentListOf(oneNode.properties.path).slice(0, -1));
					return nodeByStableId.get(oneNode.properties.parentId).properties.path !== parentPath;
				})
				.map((oneNode) => oneNode.stableId);
			const hasChildEdgeList = edgeListByType(forged, 'HAS_CHILD');
			const incomingHasChildByStableId = hasChildEdgeList.reduce((soFar, oneEdge) => soFar.set(oneEdge.toRef.id, (soFar.get(oneEdge.toRef.id) || []).concat([oneEdge.fromRef.id])), new Map());
			const mirrorWrongList = treeNodeList
				.filter((oneNode) => {
					const parentIsObject = nodeByStableId.get(oneNode.properties.parentId).labels[1] === 'Sif260928Object';
					const isTopLevelField = parentIsObject && oneNode.labels[1] === 'Sif260928Field';
					const incomingList = incomingHasChildByStableId.get(oneNode.stableId) || [];
					return isTopLevelField ? incomingList.length !== 0 : incomingList.length !== 1 || incomingList[0] !== oneNode.properties.parentId;
				})
				.map((oneNode) => oneNode.stableId);
			const countByKindPair = countBy(hasChildEdgeList, (oneEdge) => `${KIND_BY_PER_STANDARD_LABEL[nodeByStableId.get(oneEdge.fromRef.id).labels[1]]}>${KIND_BY_PER_STANDARD_LABEL[nodeByStableId.get(oneEdge.toRef.id).labels[1]]}`);
			return {
				pass: notReachingList.length === 0 && wrongParentList.length === 0 && mirrorWrongList.length === 0 && sortedEntriesText(countByKindPair) === sortedEntriesText(RULED_HAS_CHILD_COUNT_BY_KIND_PAIR),
				detail: `not reaching their Object ${notReachingList.length}${firstOf(notReachingList)}; parent not one segment up ${wrongParentList.length}${firstOf(wrongParentList)}; HAS_CHILD not mirroring parentId ${mirrorWrongList.length}${firstOf(mirrorWrongList)}; HAS_CHILD by kind pair ${JSON.stringify(countByKindPair)}`,
			};
		}),
	},
];
registerMutationTwin({
	gateId: STRUCTURE_GATE_ID,
	conjunctId: 'finalizesAndEveryNodeReachesItsObject',
	twinName: 'containerMadeItsOwnDescendant',
	mutation: walkMutation({ find: CONTAINER_PARENT_LINE, replace: `structural: { parentId: containerFacts.containerPath === '${NAMED_CYCLE_CONTAINER_PATH}' ? '${NAMED_CYCLE_CHILD_CONTAINER_STABLE_ID}' : attachToStructuralParent({ nodePath: containerFacts.containerPath }), path: containerFacts.containerPath },` }),
});
registerMutationTwin({
	gateId: STRUCTURE_GATE_ID,
	conjunctId: 'finalizesAndEveryNodeReachesItsObject',
	twinName: 'containerReparentedIntoAnotherObject',
	mutation: walkMutation({ find: CONTAINER_PARENT_LINE, replace: `structural: { parentId: containerFacts.containerPath === '${NAMED_DEPTH_ONE_CONTAINER_PATH}' ? '${NAMED_OTHER_OBJECT_STABLE_ID}' : attachToStructuralParent({ nodePath: containerFacts.containerPath }), path: containerFacts.containerPath },` }),
});

// =====================================================================
// (d) A2-DEPTHONE
// =====================================================================
const depthOneConjunctList = [
	{
		conjunctId: 'depthOneContainerHasOneEdgeFromItsObject',
		title: 'every depth-1 Container (699, three xpath segments) has exactly one incoming HAS_CHILD, and it comes from its Object',
		twinNameList: ['oneDepthOneEdgeDropped'],
		evaluate: overForged((forged) => {
			const depthOneContainerList = nodeListByLabel(forged, 'Sif260928Container').filter((oneNode) => segmentListOf(oneNode.properties.path).length === 3);
			const incomingByStableId = edgeListByType(forged, 'HAS_CHILD').reduce((soFar, oneEdge) => soFar.set(oneEdge.toRef.id, (soFar.get(oneEdge.toRef.id) || []).concat([oneEdge.fromRef.id])), new Map());
			const wrongList = depthOneContainerList
				.filter((oneNode) => {
					const incomingList = incomingByStableId.get(oneNode.stableId) || [];
					return incomingList.length !== 1 || incomingList[0] !== `sif260928:object${objectPathOf(oneNode.properties.path)}`;
				})
				.map((oneNode) => oneNode.stableId);
			return {
				pass: depthOneContainerList.length === RULED_HAS_CHILD_COUNT_BY_KIND_PAIR['object>container'] && wrongList.length === 0,
				detail: `depth-1 Containers ${depthOneContainerList.length}; without exactly one HAS_CHILD from their Object ${wrongList.length}${firstOf(wrongList)}`,
			};
		}),
	},
];
registerMutationTwin({
	gateId: DEPTH_ONE_GATE_ID,
	conjunctId: 'depthOneContainerHasOneEdgeFromItsObject',
	twinName: 'oneDepthOneEdgeDropped',
	mutation: walkMutation({ find: '		if (HAS_CHILD_CHILD_KIND_LIST_BY_PARENT_KIND[', replace: `		if (nodePath !== '${NAMED_DEPTH_ONE_CONTAINER_PATH}' && HAS_CHILD_CHILD_KIND_LIST_BY_PARENT_KIND[` }),
});

// =====================================================================
// (e) A2-UNCHANGED
// =====================================================================
const unchangedConjunctList = [
	{
		conjunctId: 'earlierCountsUnchanged',
		title: 'the nodes are exactly 1 root, 159 Objects, 6,586 Containers, 15,620 Fields, 5,018 Questions, 131 Codesets, 4,055 CodesetValues and (A5) 7,698 text nodes; the edges are HAS_FIELD, HAS_CHILD, HAS_INSTANCE, HAS_VALUE, CONSTRAINED_BY, REFERENCES_OBJECT and (A5) EMBEDS_TEXT_OF only; each Object still carries fieldCount = its rows',
		twinNameList: ['oneRowNotMinted'],
		evaluate: overForged((forged) => {
			const countByLabel = countBy(forged.nodes, (oneNode) => oneNode.labels[1]);
			const edgeCountByType = countBy(forged.edges, (oneEdge) => oneEdge.type);
			const rowCountByObjectPath = countBy(RAW_XPATH_LIST, objectPathOf);
			const fieldCountWrongList = nodeListByLabel(forged, 'Sif260928Object').filter((oneNode) => oneNode.properties.fieldCount !== rowCountByObjectPath[oneNode.properties.path]).map((oneNode) => oneNode.stableId);
			const ruledHasChildTotal = Object.values(RULED_HAS_CHILD_COUNT_BY_KIND_PAIR).reduce((soFar, pairCount) => soFar + pairCount, 0);
			return {
				pass: sortedEntriesText(countByLabel) === sortedEntriesText(RULED_NODE_COUNT_BY_LABEL) && sortedEntriesText(edgeCountByType) === sortedEntriesText({ HAS_FIELD: RULED_HAS_FIELD_COUNT, HAS_CHILD: ruledHasChildTotal, HAS_INSTANCE: RULED_HAS_INSTANCE_COUNT, ...RULED_A4_EDGE_COUNT_BY_TYPE, ...RULED_A5_EDGE_COUNT_BY_TYPE }) && fieldCountWrongList.length === 0,
				detail: `nodes ${JSON.stringify(countByLabel)}; edges ${JSON.stringify(edgeCountByType)}; Objects whose fieldCount is not their row count ${fieldCountWrongList.length}${firstOf(fieldCountWrongList)}`,
			};
		}),
	},
];
registerMutationTwin({ gateId: UNCHANGED_GATE_ID, conjunctId: 'earlierCountsUnchanged', twinName: 'oneRowNotMinted', mutation: walkMutation({ find: 'const fieldFactsList = rowList.map(fieldFactsOf);', replace: 'const fieldFactsList = rowList.slice(1).map(fieldFactsOf);' }) });

// =====================================================================
// A2-DEPTH (SPEC §9 A25)
// =====================================================================
const depthConjunctList = [
	{
		conjunctId: 'frameworkDepthEqualsXpathDepthLessOne',
		title: "the framework's depth equals xpathDepth - 1 on every Field, and the path's segment count - 1 on every Container; the check names the first offender",
		twinNameList: ['oneFieldNestedUnderWrongContainer'],
		evaluate: overForged((forged) => {
			const fieldWrongList = nodeListByLabel(forged, 'Sif260928Field').filter((oneNode) => oneNode.properties.depth !== oneNode.properties.xpathDepth - 1);
			const containerWrongList = nodeListByLabel(forged, 'Sif260928Container').filter((oneNode) => oneNode.properties.depth !== segmentListOf(oneNode.properties.path).length - 1);
			const offenderList = fieldWrongList.concat(containerWrongList).map((oneNode) => `${oneNode.stableId} depth ${oneNode.properties.depth} xpathDepth ${oneNode.properties.xpathDepth} parent ${oneNode.properties.parentId}`);
			return { pass: offenderList.length === 0, detail: `Fields wrong ${fieldWrongList.length}; Containers wrong ${containerWrongList.length}${firstOf(offenderList)}` };
		}),
	},
];
registerMutationTwin({
	gateId: DEPTH_GATE_ID,
	conjunctId: 'frameworkDepthEqualsXpathDepthLessOne',
	twinName: 'oneFieldNestedUnderWrongContainer',
	mutation: walkMutation({ find: FIELD_PARENT_LINE, replace: `structural: { parentId: fieldFacts.xpath === '${NAMED_NESTED_FIELD_XPATH}' ? '${NAMED_NESTED_FIELD_GRANDPARENT_STABLE_ID}' : attachToStructuralParent({ nodePath: fieldFacts.xpath }), path: fieldFacts.xpath },` }),
});

// =====================================================================
// A2-ATTRIBUTE (SPEC §9 A26)
// =====================================================================
const attributeConjunctList = [
	{
		conjunctId: 'attributeOnFieldElementParentedOnThatField',
		title: 'the 3,138 attributes whose element is itself a row (over 2,645 such elements) are each parented on that element\'s Field, with one Field -HAS_CHILD-> Field edge; no other Field has a Field parent',
		twinNameList: ['attributeFoldedToElementParent'],
		evaluate: overForged((forged) => {
			const nodeByStableId = new Map(forged.nodes.map((oneNode) => [oneNode.stableId, oneNode]));
			const expectedAttributeXpathList = RAW_XPATH_LIST.filter((xpath) => segmentListOf(xpath).length > 3 && RAW_XPATH_SET.has(pathOfSegmentList(segmentListOf(xpath).slice(0, -1))));
			const expectedAttributeXpathSet = new Set(expectedAttributeXpathList);
			const fieldParentedFieldList = nodeListByLabel(forged, 'Sif260928Field').filter((oneNode) => nodeByStableId.get(oneNode.properties.parentId).labels[1] === 'Sif260928Field');
			const wrongList = fieldParentedFieldList
				.filter((oneNode) => !expectedAttributeXpathSet.has(oneNode.properties.xpath) || oneNode.properties.isAttribute !== true || oneNode.properties.parentId !== `sif260928:field${pathOfSegmentList(segmentListOf(oneNode.properties.xpath).slice(0, -1))}`)
				.map((oneNode) => oneNode.stableId);
			const fieldToFieldEdgeList = edgeListByType(forged, 'HAS_CHILD').filter((oneEdge) => nodeByStableId.get(oneEdge.fromRef.id).labels[1] === 'Sif260928Field');
			const parentFieldCount = new Set(fieldParentedFieldList.map((oneNode) => oneNode.properties.parentId)).size;
			return {
				pass:
					expectedAttributeXpathList.length === RULED_ATTRIBUTE_ON_FIELD_COUNT &&
					fieldParentedFieldList.length === RULED_ATTRIBUTE_ON_FIELD_COUNT &&
					fieldToFieldEdgeList.length === RULED_ATTRIBUTE_ON_FIELD_COUNT &&
					parentFieldCount === RULED_FIELD_WITH_ATTRIBUTE_CHILD_COUNT &&
					wrongList.length === 0,
				detail: `independent ${expectedAttributeXpathList.length}; Field-parented Fields ${fieldParentedFieldList.length} over ${parentFieldCount} parent Fields; Field -HAS_CHILD-> Field ${fieldToFieldEdgeList.length}; wrong ${wrongList.length}${firstOf(wrongList)}`,
			};
		}),
	},
];
// the alternative A26 rejected: an attribute on an element row folds to the element's own parent
registerMutationTwin({
	gateId: ATTRIBUTE_GATE_ID,
	conjunctId: 'attributeOnFieldElementParentedOnThatField',
	twinName: 'attributeFoldedToElementParent',
	mutation: walkMutation({
		find: 'const parentPath = structuralParentPathOf(nodePath);',
		replace: "const elementPath = structuralParentPathOf(nodePath);\n		const parentPath = nodeKindByPath.get(elementPath) === 'field' ? structuralParentPathOf(elementPath) : elementPath;",
	}),
});

const gateDeclarationList = [
	{ gateId: CONTAINERS_GATE_ID, title: '(a) Containers = 6,586, the non-row xpath prefixes; no isUnbounded (A26)', conjunctList: containersConjunctList },
	{ gateId: HAS_FIELD_GATE_ID, title: '(b) HAS_FIELD = 15,620, one per Field', conjunctList: hasFieldConjunctList },
	{ gateId: STRUCTURE_GATE_ID, title: '(c) the structural contract finalizes and every node reaches its Object', conjunctList: structureConjunctList },
	{ gateId: DEPTH_ONE_GATE_ID, title: '(d) every depth-1 Container has exactly one HAS_CHILD from its Object', conjunctList: depthOneConjunctList },
	{ gateId: UNCHANGED_GATE_ID, title: '(e) the A1b and A1c counts are unchanged', conjunctList: unchangedConjunctList },
	{ gateId: DEPTH_GATE_ID, title: 'A25: framework depth = xpathDepth - 1', conjunctList: depthConjunctList },
	{ gateId: ATTRIBUTE_GATE_ID, title: 'A26: an attribute on an element row is parented on that Field', conjunctList: attributeConjunctList },
];

runGateFamily({ harness, familyName: 'sif260928 A2 tree', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 7, expectedTwinCount: 9 }, () => {
	harness.report();
});
