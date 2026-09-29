#!/usr/bin/env node
'use strict';

// test-sif260928Questions.js — the phase A3 gates for the sif260928 Questions (PLAN-sifReplacement-
// smallPhases-092826.md §3 A3; SPEC §3.1 Question as amended by §9 A16, A17, A20, A21 and A27). ALL
// PURE: the whole forge runs in pure mode (skipEmbedding, no Docker, no network). Every conjunct is
// observed RED under its own twin before the family counts as green (gateSuiteRunner).
//
// The witness is C1's yardstick, built from the TSV alone with no shared code (EMERALD_BEACON). Neither
// side is ever edited to match the other: a difference goes to the supervisor.
//
//   A3-REFIDLIST  (a) the forge's sorted questionRefId list equals C1's list file byte for byte
//   A3-INSTANCES  (b) HAS_INSTANCE = 15,620, one per Field, from the Question whose questionRefId the
//                     Field carries
//   A3-MULTIID    (c) the multi-id split, read back from the forged graph, equals C1's multi-id list
//                     (4 groups, 9 annotated rows, 10 questions), and no Question's Fields name two ids
//   A3-NODOMAIN   (d) no label or property name the forge writes says 'domain', and every string it writes
//                     that equals one of the hub's 379 domain names or ids (G0's export) is a string the
//                     TSV itself contains. Ten hub names are SIF's own words (Activity, Assessment, ...):
//                     the forge may repeat its source, never introduce a domain.
//   A3-PROPERTIES     each Question's properties equal C1's map entry for its questionRefId, including
//                     objectNameSampleList (at most 12, sorted; A7) and cedsElementId only when every
//                     Field carries that same id (A27)
//
// The twins mutate the questions module or the walk in memory (moduleDouble); nothing is written.
//
// Run: PATH=/usr/local/bin:$PATH node forges/sif260928/test/test-sif260928Questions.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase A3 gates: the questionRefId list, HAS_INSTANCE, the multi-id split, no CEDS domain, the Question properties

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
const QUESTIONS_MODULE_PATH = path.join(BUNDLE_DIR, 'lib', 'sif260928Questions.js');
const DESCRIPTOR_PATH = path.join(BUNDLE_DIR, 'parserDescriptor.ini');
// <system>/dataStores, reached as system/code does it (a worktree reaches it through the supervisor's
// codeWorktrees/dataStores link)
const DATA_STORES_DIR = path.join(TREE_ROOT, '..', '..', 'dataStores');
const YARDSTICK_DIR = path.join(DATA_STORES_DIR, 'bridgeAcceptance', 'sif260928', 'yardstick');
const WITNESS_REF_ID_LIST_PATH = path.join(YARDSTICK_DIR, 'sifQuestionRefIdList-global-7f4ed86ec57a.txt');
const WITNESS_QUESTION_MAP_PATH = path.join(YARDSTICK_DIR, 'sifQuestionMap-global-c94179bc7a78.json');
const WITNESS_MULTI_ID_LIST_PATH = path.join(YARDSTICK_DIR, 'sifMultiIdList-global-37115a5e6498.json');
const HUB_DOMAIN_NAME_LIST_PATH = path.join(DATA_STORES_DIR, 'bridgeAcceptance', 'sifReplacementBaseline', 'hubExports', 'hubDomainNameList.json');

const { runGateFamily } = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'gateSuiteRunner'));
const moduleDouble = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'moduleDouble'));
const { makeTwinRegistry } = require(path.join(FORGE_FRAMEWORK_DIR, 'roundTripHarness', 'twinRegistry'));
const rosterLib = require(path.join(FORGE_FRAMEWORK_DIR, 'roster'));

const descriptorValueByName = rosterLib.readDescriptorSection(DESCRIPTOR_PATH).valueByName;
const SOURCE_PATH = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', descriptorValueByName.defaultSnapshot, descriptorValueByName.sourceFile);

// ---- FROZEN LITERALS. Never edited to match a measurement.
// SPEC §9 A21 (C1's measurement): 5,018 questions with the multi-id splits
const RULED_QUESTION_COUNT = 5018;
// PLAN §3 A3 (b), SPEC §3.2: one HAS_INSTANCE per Field
const RULED_HAS_INSTANCE_COUNT = 15620;
// PLAN §3 A3 (c), SPEC §1: 4 questions over 9 annotated rows, split into 10 (C1)
const RULED_MULTI_ID_GROUP_COUNT = 4;
const RULED_MULTI_ID_ANNOTATED_ROW_COUNT = 9;
const RULED_MULTI_ID_SPLIT_QUESTION_COUNT = 10;
// SPEC §9 A7: the judge's object-name sample
const RULED_OBJECT_NAME_SAMPLE_LIMIT = 12;
// Measured on C1's question map by A3 BEFORE the Questions existed (reported in the A3 opening IMCS):
// 1,248 questions carry one id on every Field; 8 carry one id on some Fields and none on the rest,
// and under the strict reading those 8 carry no cedsElementId (SPEC §9 A27).
const RULED_EVERY_FIELD_ONE_ID_QUESTION_COUNT = 1248;
const RULED_SOME_FIELDS_ONE_ID_QUESTION_COUNT = 8;
// the Question's property names: the kit's universal stamps, the brief's list (with A5's contextText),
// the finalizer's stamps
const RULED_QUESTION_REQUIRED_PROPERTY_NAME_LIST = Object.freeze(
	['_id', '_source', 'name', 'role', 'sif260928StableId', 'searchText', 'parentId', 'path', 'questionRefId', 'relativePath', 'contextText', 'instanceCount', 'sharedBlock', 'objectNameList', 'objectNameSampleList', 'depth', 'crossRefs'].sort(),
);
// present only when the question has one (description) or every Field agrees on one (cedsElementId)
const RULED_QUESTION_OPTIONAL_PROPERTY_NAME_LIST = Object.freeze(['description', 'cedsElementId']);

// ---- named rows and values the twins use
const NAMED_DETACHED_FIELD_XPATH = '/AccountingPeriods/AccountingPeriod/EndDate';
const NAMED_MISSTAMPED_FIELD_XPATH = '/AccountingPeriods/AccountingPeriod/StartDate';
const NAMED_DOMAIN_OBJECT_PATH = '/AccountingPeriods/AccountingPeriod';
const NAMED_HUB_DOMAIN_NAME = 'K12 Student Enrollment';
// Measured on the TSV by A3 (a script reading the raw CRLF cells, independent of the loader): the hub
// domain names that are also strings of the source itself, as a cell, a quote-stripped trimmed
// description or an xpath segment. No hub domain id (C + six digits) occurs in the TSV.
const RULED_HUB_DOMAIN_NAME_IN_SOURCE_LIST = Object.freeze(['Activity', 'Assessment', 'Assignment', 'Authentication', 'Contact', 'Course', 'Facility', 'Location', 'Organization', 'Program']);

// ---- the witnesses
const WITNESS_REF_ID_LIST_TEXT = fs.readFileSync(WITNESS_REF_ID_LIST_PATH, 'utf8');
const WITNESS_QUESTION_BY_REF_ID = new Map(JSON.parse(fs.readFileSync(WITNESS_QUESTION_MAP_PATH, 'utf8')).questionList.map((witnessQuestion) => [witnessQuestion.questionRefId, witnessQuestion]));
const WITNESS_MULTI_ID = JSON.parse(fs.readFileSync(WITNESS_MULTI_ID_LIST_PATH, 'utf8'));
const HUB_DOMAIN_LIST = JSON.parse(fs.readFileSync(HUB_DOMAIN_NAME_LIST_PATH, 'utf8')).domainList;
const HUB_DOMAIN_TEXT_SET = new Set(HUB_DOMAIN_LIST.reduce((soFar, hubDomain) => soFar.concat([hubDomain.domainName, hubDomain.domainId]), []));
// every string the TSV itself carries, read independently of the loader and the walk
const SOURCE_TEXT_SET = new Set(
	fs
		.readFileSync(SOURCE_PATH, 'utf8')
		.split('\r\n')
		.map((lineText) => lineText.split('\t'))
		.filter((cellList) => cellList.length === 8)
		.reduce((soFar, cellList) => {
			const descriptionCellText = cellList[4];
			const isQuoteWrapped = descriptionCellText.length >= 2 && descriptionCellText.startsWith('"') && descriptionCellText.endsWith('"');
			return soFar.concat(cellList, cellList[5].split('/'), [(isQuoteWrapped ? descriptionCellText.slice(1, -1) : descriptionCellText).trim()]);
		}, []),
);
if (!HUB_DOMAIN_TEXT_SET.has(NAMED_HUB_DOMAIN_NAME) || SOURCE_TEXT_SET.has(NAMED_HUB_DOMAIN_NAME)) {
	throw new Error(`${moduleName}: the twin's domain name '${NAMED_HUB_DOMAIN_NAME}' is not in ${HUB_DOMAIN_NAME_LIST_PATH}, or is a TSV string, so the domain twins would prove nothing`);
}

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
const firstOf = (itemList) => (itemList.length ? ` (first ${JSON.stringify(itemList[0])})` : '');
const sortedCopy = (itemList) => itemList.slice().sort();
// the forged HAS_INSTANCE edges as Question stableId → sorted Field xpaths
const fieldXpathListByQuestionStableIdOf = (forged) => {
	const nodeByStableId = new Map(forged.nodes.map((oneNode) => [oneNode.stableId, oneNode]));
	const fieldXpathListByQuestionStableId = edgeListByType(forged, 'HAS_INSTANCE').reduce(
		(soFar, oneEdge) => soFar.set(oneEdge.fromRef.id, (soFar.get(oneEdge.fromRef.id) || []).concat([nodeByStableId.get(oneEdge.toRef.id).properties.xpath])),
		new Map(),
	);
	fieldXpathListByQuestionStableId.forEach((fieldXpathList, questionStableId) => fieldXpathListByQuestionStableId.set(questionStableId, sortedCopy(fieldXpathList)));
	return fieldXpathListByQuestionStableId;
};

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
const questionsMutation = ({ find, replace }) => ({ modulePath: QUESTIONS_MODULE_PATH, find, replace });
const walkMutation = ({ find, replace }) => ({ modulePath: WALK_MODULE_PATH, find, replace });

const OBJECT_CARRY_LINE = 'carriedProperties: kit.carriedProperties({ parsedObject: { objectName, fieldCount }, carryList: OBJECT_CARRY_LIST }),';

const REF_ID_LIST_GATE_ID = 'A3-REFIDLIST';
const INSTANCES_GATE_ID = 'A3-INSTANCES';
const MULTI_ID_GATE_ID = 'A3-MULTIID';
const NO_DOMAIN_GATE_ID = 'A3-NODOMAIN';
const PROPERTIES_GATE_ID = 'A3-PROPERTIES';

// =====================================================================
// (a) A3-REFIDLIST
// =====================================================================
const refIdListConjunctList = [
	{
		conjunctId: 'sortedQuestionRefIdListEqualsWitness',
		title: "the forge's 5,018 Question questionRefIds, sorted one per line with a closing newline, equal C1's list file byte for byte",
		twinNameList: ['identitySlotsSwapped'],
		evaluate: overForged((forged) => {
			const forgedRefIdList = sortedCopy(nodeListByLabel(forged, 'Sif260928Question').map((oneNode) => oneNode.properties.questionRefId));
			const forgedListText = `${forgedRefIdList.join('\n')}\n`;
			const witnessRefIdList = WITNESS_REF_ID_LIST_TEXT.split('\n').slice(0, -1);
			const firstDifferentRowIndex = forgedRefIdList.findIndex((questionRefId, rowIndex) => questionRefId !== witnessRefIdList[rowIndex]);
			return {
				pass: forgedListText === WITNESS_REF_ID_LIST_TEXT && forgedRefIdList.length === RULED_QUESTION_COUNT && witnessRefIdList.length === RULED_QUESTION_COUNT,
				detail: `forged ${forgedRefIdList.length}, witness ${witnessRefIdList.length}; byte-equal ${forgedListText === WITNESS_REF_ID_LIST_TEXT}; first different row ${firstDifferentRowIndex === -1 ? 'none' : `${firstDifferentRowIndex + 1} (forged ${forgedRefIdList[firstDifferentRowIndex]}, witness ${witnessRefIdList[firstDifferentRowIndex]})`}`,
			};
		}),
	},
];
// the plan's twin: swap two positions of the A17 tuple
registerMutationTwin({
	gateId: REF_ID_LIST_GATE_ID,
	conjunctId: 'sortedQuestionRefIdListEqualsWitness',
	twinName: 'identitySlotsSwapped',
	mutation: questionsMutation({
		find: "const QUESTION_IDENTITY_SLOT_LIST = Object.freeze(['name', 'descriptionOrNull', 'relativePath', 'splitCedsElementIdOrNull']);",
		replace: "const QUESTION_IDENTITY_SLOT_LIST = Object.freeze(['descriptionOrNull', 'name', 'relativePath', 'splitCedsElementIdOrNull']);",
	}),
});

// =====================================================================
// (b) A3-INSTANCES
// =====================================================================
const instancesConjunctList = [
	{
		conjunctId: 'oneHasInstancePerFieldFromItsQuestion',
		title: "HAS_INSTANCE = 15,620: every Field has exactly one, from a Question; the Field's questionRefId equals that Question's; each Question's instanceCount equals its HAS_INSTANCE edges",
		twinNameList: ['oneInstanceDetached', 'oneFieldStampedWithAnotherQuestionRefId'],
		evaluate: overForged((forged) => {
			const nodeByStableId = new Map(forged.nodes.map((oneNode) => [oneNode.stableId, oneNode]));
			const hasInstanceEdgeList = edgeListByType(forged, 'HAS_INSTANCE');
			const incomingByFieldStableId = hasInstanceEdgeList.reduce((soFar, oneEdge) => soFar.set(oneEdge.toRef.id, (soFar.get(oneEdge.toRef.id) || []).concat([oneEdge.fromRef.id])), new Map());
			const fieldWrongList = nodeListByLabel(forged, 'Sif260928Field')
				.filter((fieldNode) => {
					const incomingList = incomingByFieldStableId.get(fieldNode.stableId) || [];
					if (incomingList.length !== 1) {
						return true;
					}
					const questionNode = nodeByStableId.get(incomingList[0]);
					return questionNode.labels[1] !== 'Sif260928Question' || fieldNode.properties.questionRefId !== questionNode.properties.questionRefId;
				})
				.map((fieldNode) => fieldNode.properties.xpath);
			const outgoingCountByQuestionStableId = hasInstanceEdgeList.reduce((soFar, oneEdge) => soFar.set(oneEdge.fromRef.id, (soFar.get(oneEdge.fromRef.id) || 0) + 1), new Map());
			const questionWrongList = nodeListByLabel(forged, 'Sif260928Question').filter((questionNode) => outgoingCountByQuestionStableId.get(questionNode.stableId) !== questionNode.properties.instanceCount).map((questionNode) => questionNode.stableId);
			return {
				pass: hasInstanceEdgeList.length === RULED_HAS_INSTANCE_COUNT && fieldWrongList.length === 0 && questionWrongList.length === 0,
				detail: `HAS_INSTANCE ${hasInstanceEdgeList.length}; Fields without exactly one from their own Question ${fieldWrongList.length}${firstOf(fieldWrongList)}; Questions whose instanceCount is not their edges ${questionWrongList.length}${firstOf(questionWrongList)}`,
			};
		}),
	},
];
// the plan's twin: detach one Field from its Question
registerMutationTwin({
	gateId: INSTANCES_GATE_ID,
	conjunctId: 'oneHasInstancePerFieldFromItsQuestion',
	twinName: 'oneInstanceDetached',
	mutation: questionsMutation({ find: '			kit.addEdge({ edgeType: EDGE_TYPES.HAS_INSTANCE,', replace: `			if (fieldXpath !== '${NAMED_DETACHED_FIELD_XPATH}') kit.addEdge({ edgeType: EDGE_TYPES.HAS_INSTANCE,` }),
});
// the edge stays, but the Field carries another Question's id
registerMutationTwin({
	gateId: INSTANCES_GATE_ID,
	conjunctId: 'oneHasInstancePerFieldFromItsQuestion',
	twinName: 'oneFieldStampedWithAnotherQuestionRefId',
	mutation: walkMutation({
		find: 'questionRefId: questionRefIdByXpath.get(fieldFacts.xpath) }',
		replace: `questionRefId: questionRefIdByXpath.get(fieldFacts.xpath === '${NAMED_MISSTAMPED_FIELD_XPATH}' ? '${NAMED_DETACHED_FIELD_XPATH}' : fieldFacts.xpath) }`,
	}),
});

// =====================================================================
// (c) A3-MULTIID
// =====================================================================
const multiIdConjunctList = [
	{
		conjunctId: 'multiIdSplitEqualsWitness',
		title: "read back from the forged graph, the (name, description, relativePath) groups holding more than one Question are C1's 4 multi-id groups over 9 annotated Fields, split into 10 Questions whose questionRefIds and Field xpaths equal C1's; no Question's Fields carry two distinct CEDS ids",
		twinNameList: ['splitSuppressed'],
		evaluate: overForged((forged) => {
			const questionNodeList = nodeListByLabel(forged, 'Sif260928Question');
			const fieldByXpath = new Map(nodeListByLabel(forged, 'Sif260928Field').map((fieldNode) => [fieldNode.properties.xpath, fieldNode]));
			const fieldXpathListByQuestionStableId = fieldXpathListByQuestionStableIdOf(forged);
			const questionNodeListByGroupText = questionNodeList.reduce((soFar, questionNode) => {
				const { name, description, relativePath } = questionNode.properties;
				const groupText = JSON.stringify([name, description === undefined ? null : description, relativePath]);
				return soFar.set(groupText, (soFar.get(groupText) || []).concat([questionNode]));
			}, new Map());
			const splitGroupList = [...questionNodeListByGroupText.values()].filter((groupQuestionNodeList) => groupQuestionNodeList.length > 1);
			const splitQuestionNodeList = splitGroupList.reduce((soFar, groupQuestionNodeList) => soFar.concat(groupQuestionNodeList), []);
			const annotatedRowCount = splitQuestionNodeList.reduce((soFar, questionNode) => soFar + fieldXpathListByQuestionStableId.get(questionNode.stableId).filter((fieldXpath) => fieldByXpath.get(fieldXpath).properties.cedsElementId !== undefined).length, 0);
			const forgedSplitText = JSON.stringify(sortedCopy(splitQuestionNodeList.map((questionNode) => JSON.stringify([questionNode.properties.questionRefId, fieldXpathListByQuestionStableId.get(questionNode.stableId)]))));
			const witnessSplitQuestionList = WITNESS_MULTI_ID.multiIdList.reduce((soFar, witnessGroup) => soFar.concat(witnessGroup.splitQuestionList), []);
			const witnessSplitText = JSON.stringify(sortedCopy(witnessSplitQuestionList.map((witnessQuestion) => JSON.stringify([witnessQuestion.questionRefId, sortedCopy(witnessQuestion.xpathList)]))));
			const twoIdQuestionList = questionNodeList
				.filter((questionNode) => new Set(fieldXpathListByQuestionStableId.get(questionNode.stableId).map((fieldXpath) => fieldByXpath.get(fieldXpath).properties.cedsElementId).filter((cedsElementId) => cedsElementId !== undefined)).size > 1)
				.map((questionNode) => `${questionNode.properties.name} ${questionNode.properties.relativePath}`);
			return {
				pass:
					splitGroupList.length === RULED_MULTI_ID_GROUP_COUNT &&
					annotatedRowCount === RULED_MULTI_ID_ANNOTATED_ROW_COUNT &&
					splitQuestionNodeList.length === RULED_MULTI_ID_SPLIT_QUESTION_COUNT &&
					WITNESS_MULTI_ID.multiIdQuestionCount === RULED_MULTI_ID_GROUP_COUNT &&
					witnessSplitQuestionList.length === RULED_MULTI_ID_SPLIT_QUESTION_COUNT &&
					forgedSplitText === witnessSplitText &&
					twoIdQuestionList.length === 0,
				detail: `split groups ${splitGroupList.length}, annotated rows in them ${annotatedRowCount}, split Questions ${splitQuestionNodeList.length}; equal to C1's split list ${forgedSplitText === witnessSplitText}; Questions whose Fields carry two ids ${twoIdQuestionList.length}${firstOf(twoIdQuestionList)}`,
			};
		}),
	},
];
// the plan's twin: no group is ever split
registerMutationTwin({
	gateId: MULTI_ID_GATE_ID,
	conjunctId: 'multiIdSplitEqualsWitness',
	twinName: 'splitSuppressed',
	mutation: questionsMutation({ find: 'distinctCedsElementIdListOf(groupFieldFactsList).length > 1 ?', replace: 'distinctCedsElementIdListOf(groupFieldFactsList).length > 1 && false ?' }),
});

// =====================================================================
// (d) A3-NODOMAIN
// =====================================================================
// every string the forge writes on a node or an edge, with where it sits
const writtenStringListOf = (forged) => {
	const stringEntryListOf = ({ ownerText, propertyByName }) =>
		Object.keys(propertyByName).reduce((soFar, propertyName) => {
			const propertyValue = propertyByName[propertyName];
			const valueList = Array.isArray(propertyValue) ? propertyValue : [propertyValue];
			return soFar.concat(valueList.filter((oneValue) => typeof oneValue === 'string').map((oneValue) => ({ ownerText, propertyName, stringValue: oneValue })));
		}, []);
	return forged.nodes
		.reduce((soFar, oneNode) => soFar.concat(stringEntryListOf({ ownerText: oneNode.stableId, propertyByName: oneNode.properties })), [])
		.concat(forged.edges.reduce((soFar, oneEdge) => soFar.concat(stringEntryListOf({ ownerText: `${oneEdge.type} ${oneEdge.fromRef.id} -> ${oneEdge.toRef.id}`, propertyByName: oneEdge.properties })), []));
};
const DOMAIN_WORD_PATTERN = /domain/i;
const noDomainConjunctList = [
	{
		conjunctId: 'noCedsDomainNamedInForgeOutput',
		title: "no node label, edge type or property name the forge writes contains 'domain'; every string it writes that equals one of the hub's 379 domain names or ids is a string of the TSV itself, and those are exactly the ten ruled source words",
		twinNameList: ['assignedDomainNameStampedOnObject', 'domainNameUnderAnotherPropertyName'],
		evaluate: overForged((forged) => {
			const namedDomainList = forged.nodes
				.reduce((soFar, oneNode) => soFar.concat(oneNode.labels, Object.keys(oneNode.properties).map((propertyName) => `${oneNode.stableId}.${propertyName}`)), [])
				.concat(forged.edges.reduce((soFar, oneEdge) => soFar.concat([oneEdge.type], Object.keys(oneEdge.properties)), []))
				.filter((nameText) => DOMAIN_WORD_PATTERN.test(nameText.split('.').pop()));
			const hubDomainStringEntryList = writtenStringListOf(forged).filter((stringEntry) => HUB_DOMAIN_TEXT_SET.has(stringEntry.stringValue));
			const introducedDomainList = hubDomainStringEntryList.filter((stringEntry) => !SOURCE_TEXT_SET.has(stringEntry.stringValue)).map((stringEntry) => `${stringEntry.ownerText}.${stringEntry.propertyName}=${stringEntry.stringValue}`);
			const repeatedSourceWordList = sortedCopy([...new Set(hubDomainStringEntryList.map((stringEntry) => stringEntry.stringValue))]);
			const sourceWordList = sortedCopy(HUB_DOMAIN_LIST.map((hubDomain) => hubDomain.domainName).filter((domainName) => SOURCE_TEXT_SET.has(domainName)));
			return {
				pass:
					HUB_DOMAIN_LIST.length === 379 &&
					namedDomainList.length === 0 &&
					introducedDomainList.length === 0 &&
					JSON.stringify(sourceWordList) === JSON.stringify(RULED_HUB_DOMAIN_NAME_IN_SOURCE_LIST) &&
					repeatedSourceWordList.every((domainName) => RULED_HUB_DOMAIN_NAME_IN_SOURCE_LIST.indexOf(domainName) !== -1),
				detail: `hub domains ${HUB_DOMAIN_LIST.length}; names containing 'domain' ${namedDomainList.length}${firstOf(namedDomainList)}; hub domain strings not in the TSV ${introducedDomainList.length}${firstOf(introducedDomainList)}; hub names in the TSV [${sourceWordList}]; repeated by the forge [${repeatedSourceWordList}]`,
			};
		}),
	},
];
// the plan's twin: an assignedDomainName on one Object
registerMutationTwin({
	gateId: NO_DOMAIN_GATE_ID,
	conjunctId: 'noCedsDomainNamedInForgeOutput',
	twinName: 'assignedDomainNameStampedOnObject',
	mutation: walkMutation({ find: OBJECT_CARRY_LINE, replace: `carriedProperties: { ...kit.carriedProperties({ parsedObject: { objectName, fieldCount }, carryList: OBJECT_CARRY_LIST }), ...(objectPath === '${NAMED_DOMAIN_OBJECT_PATH}' ? { assignedDomainName: '${NAMED_HUB_DOMAIN_NAME}' } : {}) },` }),
});
// the same fact under a name that does not say 'domain': only the value scan can see it
registerMutationTwin({
	gateId: NO_DOMAIN_GATE_ID,
	conjunctId: 'noCedsDomainNamedInForgeOutput',
	twinName: 'domainNameUnderAnotherPropertyName',
	mutation: walkMutation({ find: OBJECT_CARRY_LINE, replace: `carriedProperties: { ...kit.carriedProperties({ parsedObject: { objectName, fieldCount }, carryList: OBJECT_CARRY_LIST }), ...(objectPath === '${NAMED_DOMAIN_OBJECT_PATH}' ? { subjectArea: '${NAMED_HUB_DOMAIN_NAME}' } : {}) },` }),
});

// =====================================================================
// A3-PROPERTIES
// =====================================================================
const propertiesConjunctList = [
	{
		conjunctId: 'questionPropertiesEqualWitnessMap',
		title: "every Question is in C1's map under its questionRefId, with equal name, description (absent for null), relativePath, sharedBlock, instanceCount, objectNameList and Field xpaths; objectNameSampleList is the first 12 of objectNameList; cedsElementId is present exactly when every Field carries that one id (1,248 Questions; the 8 with an id on only some Fields carry none); stableId sif260928:question/<questionRefId>, role DmeProperty, parent the root; exactly the ruled property names",
		twinNameList: ['objectNameSampleUncapped', 'cedsElementIdWhenOnlySomeFieldsCarryIt'],
		evaluate: overForged((forged) => {
			const fieldXpathListByQuestionStableId = fieldXpathListByQuestionStableIdOf(forged);
			const questionNodeList = nodeListByLabel(forged, 'Sif260928Question');
			const wrongList = questionNodeList
				.filter((questionNode) => {
					const properties = questionNode.properties;
					const witnessQuestion = WITNESS_QUESTION_BY_REF_ID.get(properties.questionRefId);
					if (witnessQuestion === undefined) {
						return true;
					}
					const everyFieldOneId = witnessQuestion.cedsElementIdList.length === 1 && witnessQuestion.annotatedInstanceCount === witnessQuestion.instanceCount;
					const propertyNameList = Object.keys(properties).filter((propertyName) => RULED_QUESTION_OPTIONAL_PROPERTY_NAME_LIST.indexOf(propertyName) === -1).sort();
					return (
						questionNode.stableId !== `sif260928:question/${properties.questionRefId}` ||
						questionNode.role !== 'DmeProperty' ||
						properties.parentId !== 'sif260928:root' ||
						properties.name !== witnessQuestion.name ||
						(witnessQuestion.description === null ? properties.description !== undefined : properties.description !== witnessQuestion.description) ||
						properties.relativePath !== witnessQuestion.relativePath ||
						properties.sharedBlock !== witnessQuestion.sharedBlock ||
						properties.instanceCount !== witnessQuestion.instanceCount ||
						JSON.stringify(properties.objectNameList) !== JSON.stringify(witnessQuestion.objectNameList) ||
						JSON.stringify(properties.objectNameSampleList) !== JSON.stringify(witnessQuestion.objectNameList.slice(0, RULED_OBJECT_NAME_SAMPLE_LIMIT)) ||
						JSON.stringify(fieldXpathListByQuestionStableId.get(questionNode.stableId)) !== JSON.stringify(sortedCopy(witnessQuestion.xpathList)) ||
						properties.cedsElementId !== (everyFieldOneId ? witnessQuestion.cedsElementIdList[0] : undefined) ||
						JSON.stringify(propertyNameList) !== JSON.stringify(RULED_QUESTION_REQUIRED_PROPERTY_NAME_LIST)
					);
				})
				.map((questionNode) => questionNode.stableId);
			const witnessQuestionList = [...WITNESS_QUESTION_BY_REF_ID.values()];
			const witnessEveryFieldOneIdCount = witnessQuestionList.filter((witnessQuestion) => witnessQuestion.cedsElementIdList.length === 1 && witnessQuestion.annotatedInstanceCount === witnessQuestion.instanceCount).length;
			const witnessSomeFieldsOneIdCount = witnessQuestionList.filter((witnessQuestion) => witnessQuestion.cedsElementIdList.length === 1 && witnessQuestion.annotatedInstanceCount < witnessQuestion.instanceCount).length;
			const cedsElementIdQuestionCount = questionNodeList.filter((questionNode) => questionNode.properties.cedsElementId !== undefined).length;
			const uncappedSampleCount = questionNodeList.filter((questionNode) => questionNode.properties.objectNameSampleList.length > RULED_OBJECT_NAME_SAMPLE_LIMIT).length;
			return {
				pass:
					questionNodeList.length === RULED_QUESTION_COUNT &&
					wrongList.length === 0 &&
					witnessEveryFieldOneIdCount === RULED_EVERY_FIELD_ONE_ID_QUESTION_COUNT &&
					witnessSomeFieldsOneIdCount === RULED_SOME_FIELDS_ONE_ID_QUESTION_COUNT &&
					cedsElementIdQuestionCount === RULED_EVERY_FIELD_ONE_ID_QUESTION_COUNT &&
					uncappedSampleCount === 0,
				detail: `Questions ${questionNodeList.length}; wrong ${wrongList.length}${firstOf(wrongList)}; with cedsElementId ${cedsElementIdQuestionCount} (C1: every Field one id ${witnessEveryFieldOneIdCount}, some Fields ${witnessSomeFieldsOneIdCount}); samples over ${RULED_OBJECT_NAME_SAMPLE_LIMIT} ${uncappedSampleCount}`,
			};
		}),
	},
];
registerMutationTwin({
	gateId: PROPERTIES_GATE_ID,
	conjunctId: 'questionPropertiesEqualWitnessMap',
	twinName: 'objectNameSampleUncapped',
	mutation: questionsMutation({ find: 'objectNameSampleList: objectNameList.slice(0, OBJECT_NAME_SAMPLE_LIMIT),', replace: 'objectNameSampleList: objectNameList.slice(),' }),
});
// the reading A27 rejected: one distinct id on SOME Fields is enough
registerMutationTwin({
	gateId: PROPERTIES_GATE_ID,
	conjunctId: 'questionPropertiesEqualWitnessMap',
	twinName: 'cedsElementIdWhenOnlySomeFieldsCarryIt',
	mutation: questionsMutation({
		find: '...(everyFieldCedsElementId ? { cedsElementId: firstFieldFacts.cedsElementId } : {}),',
		replace: '...(distinctCedsElementIdListOf(questionFieldFactsList).length === 1 ? { cedsElementId: distinctCedsElementIdListOf(questionFieldFactsList)[0] } : {}),',
	}),
});

const gateDeclarationList = [
	{ gateId: REF_ID_LIST_GATE_ID, title: "(a) the sorted questionRefId list equals C1's, byte for byte", conjunctList: refIdListConjunctList },
	{ gateId: INSTANCES_GATE_ID, title: '(b) HAS_INSTANCE = 15,620, one per Field, from its own Question', conjunctList: instancesConjunctList },
	{ gateId: MULTI_ID_GATE_ID, title: "(c) the multi-id split equals C1's multi-id list", conjunctList: multiIdConjunctList },
	{ gateId: NO_DOMAIN_GATE_ID, title: '(d) no node or property names a CEDS domain', conjunctList: noDomainConjunctList },
	{ gateId: PROPERTIES_GATE_ID, title: "the Question properties equal C1's map (A7, A27)", conjunctList: propertiesConjunctList },
];

runGateFamily({ harness, familyName: 'sif260928 A3 questions', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 5, expectedTwinCount: 8 }, () => {
	harness.report();
});
