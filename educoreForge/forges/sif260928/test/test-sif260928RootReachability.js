#!/usr/bin/env node
'use strict';

// test-sif260928RootReachability.js — ⟪campaign P3, W-C-1 (V1-C28, V1-S36; PLAN G5)⟫ every sif260928 node is reachable
// from the root, and the instance structure (G5) holds. ALL PURE: the whole forge runs in pure mode (skipEmbedding).
//
// The bundle minted its Objects, Questions and Codesets with parentId = the root and NO edge from it: the live graph
// had 0 root out-edges, and all 39,267 non-root SIF nodes were unreachable by a walk from the root. Every other forge
// gives its root HAS_CLASS / HAS_SUPPORT.
//
//   ROOT-OWNERSHIP (a) every node whose parentId is the root is reached from the root by exactly ONE edge, of the type
//                      ROOT_OWNERSHIP_EDGE_TYPE_BY_ROLE names for its role, and the root's out-edges are exactly HAS_CLASS
//                      159, HAS_PROPERTY 5,018, HAS_OPTION_SET 131
//                  (b) a walk from the root over every edge EXCEPT EMBEDS_TEXT_OF, plus EMBEDS_TEXT_OF reversed (a text
//                      runs text -> node in every standard), reaches every node: unreachable 0
//                  (c) a role with no row is refused BY NAME (rootOwnershipEdgeTypeFor)
//   G5-INSTANCES   (d) every Field has exactly one incoming HAS_INSTANCE and one incoming HAS_FIELD; every Question's
//                      instanceCount equals its HAS_INSTANCE out-degree; the instanceCounts sum to the Field count 15,620
//
// Run: node forges/sif260928/test/test-sif260928RootReachability.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- W-C-1: every sif260928 node is reachable from the root; G5 instance structure

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');

const BUNDLE_DIR = path.join(__dirname, '..');
const TREE_ROOT = path.join(BUNDLE_DIR, '..', '..');
const FORGE_FRAMEWORK_DIR = path.join(TREE_ROOT, 'lib', 'forge-framework');
const ENTRY_MODULE_PATH = path.join(BUNDLE_DIR, 'forgeSif260928.js');
const WALK_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928Walk.js');
const QUESTIONS_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928Questions.js');
const CODESETS_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928Codesets.js');
const DESCRIPTOR_PATH = path.join(BUNDLE_DIR, 'parserDescriptor.ini');
const VOCABULARY_MODULE_PATH = path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary.js');

const { runGateFamily } = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'gateSuiteRunner'));
const moduleDouble = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'moduleDouble'));
const { makeTwinRegistry } = require(path.join(FORGE_FRAMEWORK_DIR, 'roundTripHarness', 'twinRegistry'));
const rosterLib = require(path.join(FORGE_FRAMEWORK_DIR, 'roster'));
const { DME_ROLES, EDGE_TYPES, ROOT_OWNERSHIP_EDGE_TYPE_BY_ROLE, rootOwnershipEdgeTypeFor } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));

const descriptorValueByName = rosterLib.readDescriptorSection(DESCRIPTOR_PATH).valueByName;
const SOURCE_FILE_NAME = descriptorValueByName.sourceFile;
const REAL_SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', descriptorValueByName.defaultSnapshot);

// the counts the earlier phases froze (A1c, A3, A4): 159 Objects, 5,018 Questions, 131 Codesets, 15,620 Fields
const RULED_ROOT_EDGE_COUNT_BY_TYPE = Object.freeze({ HAS_CLASS: 159, HAS_OPTION_SET: 131, HAS_PROPERTY: 5018 });
const RULED_FIELD_COUNT = 15620;

const makeSubject = () => ({ bundleMutationList: [] });
const cloneSubject = (subject) => ({ ...subject, bundleMutationList: subject.bundleMutationList.slice() });

const forgeWith = ({ mutationList }, callback) => {
	const forgeBundle = mutationList.length ? moduleDouble.loadWithMutations({ modulePath: ENTRY_MODULE_PATH, mutationList }) : require(ENTRY_MODULE_PATH);
	forgeBundle({ embedder: null }).forge({ sourcePath: path.join(REAL_SNAPSHOT_DIR, SOURCE_FILE_NAME), owner: 'test', skipEmbedding: true }, callback);
};
const overForged = (judgeForged) => (subject, callback) => {
	forgeWith({ mutationList: subject.bundleMutationList }, (forgeError, forged) => {
		if (forgeError) {
			callback('', { pass: false, detail: `forge refused: ${String(forgeError).slice(0, 300)}` });
			return;
		}
		callback('', judgeForged(forged));
	});
};

const rootNodeOf = (forged) => forged.nodes.find((oneNode) => oneNode.role === DME_ROLES.STANDARD_ROOT);
const countBy = (itemList, groupNameOf) => itemList.reduce((soFar, oneItem) => ({ ...soFar, [groupNameOf(oneItem)]: (soFar[groupNameOf(oneItem)] || 0) + 1 }), {});
const sortedEntriesText = (countByName) => JSON.stringify(Object.keys(countByName).sort().map((oneName) => [oneName, countByName[oneName]]));
const firstOf = (itemList) => (itemList.length ? ` (first ${JSON.stringify(itemList[0])})` : '');

const twinRegistry = makeTwinRegistry();
const registerMutationTwin = ({ gateId, conjunctId, twinName, mutation }) => {
	twinRegistry.register({
		gateId,
		conjunctId,
		twinName,
		leverKind: 'productionMutation',
		shippedConfig: true,
		run: (subject) => {
			moduleDouble.assertMutationApplies(mutation);
			subject.bundleMutationList.push(mutation);
			return subject;
		},
	});
};

const ROOT_GATE_ID = 'ROOT-OWNERSHIP';
const INSTANCE_GATE_ID = 'G5-INSTANCES';

const rootConjunctList = [
	{
		conjunctId: 'rootParentedNodesOwnedByTheirRoleEdge',
		title: 'every node parented on the root has exactly one root edge, of its role\'s ROOT_OWNERSHIP type; the root\'s out-edges are exactly HAS_CLASS 159, HAS_PROPERTY 5,018, HAS_OPTION_SET 131',
		twinNameList: ['codesetRootEdgeDropped', 'objectRootEdgeAsSupport'],
		evaluate: overForged((forged) => {
			const rootNode = rootNodeOf(forged);
			const rootEdgeList = forged.edges.filter((oneEdge) => oneEdge.fromRef.id === rootNode.stableId);
			const rootEdgeListByTarget = rootEdgeList.reduce((soFar, oneEdge) => soFar.set(oneEdge.toRef.id, (soFar.get(oneEdge.toRef.id) || []).concat([oneEdge])), new Map());
			const wrongList = forged.nodes
				.filter((oneNode) => oneNode.properties.parentId === rootNode.stableId && oneNode.role !== DME_ROLES.EMBED_TEXT)
				.filter((oneNode) => {
					const edgeList = rootEdgeListByTarget.get(oneNode.stableId) || [];
					return edgeList.length !== 1 || edgeList[0].type !== ROOT_OWNERSHIP_EDGE_TYPE_BY_ROLE[oneNode.role];
				})
				.map((oneNode) => `${oneNode.role} ${oneNode.stableId}: ${(rootEdgeListByTarget.get(oneNode.stableId) || []).map((oneEdge) => oneEdge.type).join(',') || 'NO root edge'}`);
			const rootEdgeCountByType = countBy(rootEdgeList, (oneEdge) => oneEdge.type);
			return {
				pass: wrongList.length === 0 && sortedEntriesText(rootEdgeCountByType) === sortedEntriesText(RULED_ROOT_EDGE_COUNT_BY_TYPE),
				detail: `root edges ${JSON.stringify(rootEdgeCountByType)}; root-parented nodes owned wrongly ${wrongList.length}${firstOf(wrongList)}`,
			};
		}),
	},
	{
		conjunctId: 'everyNodeReachableFromTheRoot',
		title: 'a walk from the root over every edge except EMBEDS_TEXT_OF, plus EMBEDS_TEXT_OF reversed, reaches every node (unreachable 0)',
		// a Codeset is still reachable through its Fields' HAS_OPTION_SET; a Question is reachable ONLY from the root
		twinNameList: ['questionRootEdgeDropped'],
		evaluate: overForged((forged) => {
			const rootNode = rootNodeOf(forged);
			const nextStableIdListByStableId = forged.edges.reduce((soFar, oneEdge) => {
				const [fromStableId, toStableId] = oneEdge.type === EDGE_TYPES.EMBEDS_TEXT_OF ? [oneEdge.toRef.id, oneEdge.fromRef.id] : [oneEdge.fromRef.id, oneEdge.toRef.id];
				return soFar.set(fromStableId, (soFar.get(fromStableId) || []).concat([toStableId]));
			}, new Map());
			const reachedStableIdSet = new Set([rootNode.stableId]);
			let frontierList = [rootNode.stableId];
			while (frontierList.length > 0) {
				frontierList = frontierList.reduce((soFar, oneStableId) => soFar.concat((nextStableIdListByStableId.get(oneStableId) || []).filter((nextStableId) => !reachedStableIdSet.has(nextStableId) && reachedStableIdSet.add(nextStableId))), []);
			}
			const unreachableList = forged.nodes.filter((oneNode) => !reachedStableIdSet.has(oneNode.stableId)).map((oneNode) => `${oneNode.labels[1]} ${oneNode.stableId}`);
			const unreachableCountByLabel = countBy(unreachableList, (oneLine) => oneLine.split(' ')[0]);
			return { pass: unreachableList.length === 0, detail: `unreachable ${unreachableList.length} ${JSON.stringify(unreachableCountByLabel)}${firstOf(unreachableList)}` };
		}),
	},
	{
		conjunctId: 'roleWithoutRowRefusedByName',
		title: 'rootOwnershipEdgeTypeFor refuses a role with no row (DmeEditHistoryEntry) BY NAME, and answers each of the four rows',
		twinNameList: ['helperRefusalRemoved'],
		evaluate: (subject, callback) => {
			const vocabularyMutationList = subject.bundleMutationList.filter((oneMutation) => oneMutation.modulePath === VOCABULARY_MODULE_PATH);
			const helperFor = vocabularyMutationList.length ? moduleDouble.loadWithMutations({ modulePath: VOCABULARY_MODULE_PATH, mutationList: vocabularyMutationList }).rootOwnershipEdgeTypeFor : rootOwnershipEdgeTypeFor;
			let refusalText = '';
			try {
				// the helper's refusal is a THROW by its declared contract; catching it here observes that contract
				helperFor(DME_ROLES.EDIT_HISTORY_ENTRY);
			} catch (helperError) {
				refusalText = helperError.message;
			}
			const answeredList = [DME_ROLES.CLASS, DME_ROLES.PROPERTY, DME_ROLES.OPTION_SET, DME_ROLES.SUPPORT].map((oneRole) => helperFor(oneRole));
			callback('', {
				pass: /role DmeEditHistoryEntry has no root ownership edge type/.test(refusalText) && answeredList.join(',') === 'HAS_CLASS,HAS_PROPERTY,HAS_OPTION_SET,HAS_SUPPORT',
				detail: `${refusalText || 'NOT refused'}; rows ${answeredList.join(',')}`,
			});
		},
	},
];
registerMutationTwin({ gateId: ROOT_GATE_ID, conjunctId: 'everyNodeReachableFromTheRoot', twinName: 'questionRootEdgeDropped', mutation: { modulePath: QUESTIONS_MODULE_PATH, find: '		kit.addEdge({ edgeType: rootOwnershipEdgeTypeFor(questionKind.role),', replace: '		false && kit.addEdge({ edgeType: rootOwnershipEdgeTypeFor(questionKind.role),' } });
registerMutationTwin({ gateId: ROOT_GATE_ID, conjunctId: 'rootParentedNodesOwnedByTheirRoleEdge', twinName: 'objectRootEdgeAsSupport', mutation: { modulePath: WALK_MODULE_PATH, find: 'kit.addEdge({ edgeType: rootOwnershipEdgeTypeFor(objectKind.role),', replace: 'kit.addEdge({ edgeType: EDGE_TYPES.HAS_SUPPORT,' } });
// the helper guesses HAS_SUPPORT for a role with no row instead of refusing
registerMutationTwin({ gateId: ROOT_GATE_ID, conjunctId: 'roleWithoutRowRefusedByName', twinName: 'helperRefusalRemoved', mutation: { modulePath: VOCABULARY_MODULE_PATH, find: '	if (!Object.prototype.hasOwnProperty.call(ROOT_OWNERSHIP_EDGE_TYPE_BY_ROLE, role)) {\n		throw', replace: '	if (!Object.prototype.hasOwnProperty.call(ROOT_OWNERSHIP_EDGE_TYPE_BY_ROLE, role)) {\n		return EDGE_TYPES.HAS_SUPPORT;\n		throw' } });
registerMutationTwin({ gateId: ROOT_GATE_ID, conjunctId: 'rootParentedNodesOwnedByTheirRoleEdge', twinName: 'codesetRootEdgeDropped', mutation: { modulePath: CODESETS_MODULE_PATH, find: '		kit.addEdge({ edgeType: rootOwnershipEdgeTypeFor(codesetKind.role),', replace: '		false && kit.addEdge({ edgeType: rootOwnershipEdgeTypeFor(codesetKind.role),' } });

const instanceConjunctList = [
	{
		conjunctId: 'instanceStructureHolds',
		title: 'every Field has exactly one incoming HAS_INSTANCE and one incoming HAS_FIELD; every Question\'s instanceCount equals its HAS_INSTANCE out-degree; the instanceCounts sum to 15,620',
		twinNameList: ['oneInstanceEdgeDropped'],
		evaluate: overForged((forged) => {
			const incomingCountByTypeAndStableId = forged.edges.reduce((soFar, oneEdge) => soFar.set(`${oneEdge.type} ${oneEdge.toRef.id}`, (soFar.get(`${oneEdge.type} ${oneEdge.toRef.id}`) || 0) + 1), new Map());
			const outgoingInstanceCountByStableId = forged.edges.filter((oneEdge) => oneEdge.type === EDGE_TYPES.HAS_INSTANCE).reduce((soFar, oneEdge) => soFar.set(oneEdge.fromRef.id, (soFar.get(oneEdge.fromRef.id) || 0) + 1), new Map());
			const fieldNodeList = forged.nodes.filter((oneNode) => oneNode.labels[1] === 'Sif260928Field');
			const questionNodeList = forged.nodes.filter((oneNode) => oneNode.labels[1] === 'Sif260928Question');
			const fieldWrongList = fieldNodeList.filter((oneNode) => incomingCountByTypeAndStableId.get(`HAS_INSTANCE ${oneNode.stableId}`) !== 1 || incomingCountByTypeAndStableId.get(`HAS_FIELD ${oneNode.stableId}`) !== 1).map((oneNode) => oneNode.stableId);
			const questionWrongList = questionNodeList.filter((oneNode) => oneNode.properties.instanceCount !== (outgoingInstanceCountByStableId.get(oneNode.stableId) || 0)).map((oneNode) => `${oneNode.stableId} instanceCount ${oneNode.properties.instanceCount} vs ${outgoingInstanceCountByStableId.get(oneNode.stableId) || 0}`);
			const instanceCountSum = questionNodeList.reduce((soFar, oneNode) => soFar + oneNode.properties.instanceCount, 0);
			return {
				pass: fieldNodeList.length === RULED_FIELD_COUNT && fieldWrongList.length === 0 && questionWrongList.length === 0 && instanceCountSum === RULED_FIELD_COUNT,
				detail: `Fields ${fieldNodeList.length}; Fields wrong ${fieldWrongList.length}${firstOf(fieldWrongList)}; Questions wrong ${questionWrongList.length}${firstOf(questionWrongList)}; instanceCount sum ${instanceCountSum}`,
			};
		}),
	},
];
// the first instance edge of every Question skipped: instanceCount (from the facts) no longer equals the out-degree
registerMutationTwin({ gateId: INSTANCE_GATE_ID, conjunctId: 'instanceStructureHolds', twinName: 'oneInstanceEdgeDropped', mutation: { modulePath: QUESTIONS_MODULE_PATH, find: '		questionFacts.fieldXpathList.forEach((fieldXpath) => {', replace: '		questionFacts.fieldXpathList.slice(1).forEach((fieldXpath) => {' } });

const gateDeclarationList = [
	{ gateId: ROOT_GATE_ID, title: '(a)-(c) every node is reachable from the root', conjunctList: rootConjunctList },
	{ gateId: INSTANCE_GATE_ID, title: '(d) the G5 instance structure', conjunctList: instanceConjunctList },
];

runGateFamily({ harness, familyName: 'sif260928 W-C-1 root reachability', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 4, expectedTwinCount: 5 }, () => {
	harness.report();
});
