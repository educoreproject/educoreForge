'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sif260928Questions.js — the Questions (PLAN §3 A3; SPEC §3.1 Question as amended by §9 A16, A17,
// A20, A21 and A27). PURE and synchronous, called by the walk inside the framework's
// buildContractGraph.
//
//   questionFactsListOf({ fieldFactsList }) → one question per distinct identity tuple, in the order
//     its first Field appears in the source, each with the xpaths of its Fields in source order.
//   emitQuestions({ questionFactsList, kit, fieldStableIdOfXpath }) → mints each Question on the
//     root and adds Question -HAS_INSTANCE-> Field for every Field it stands for (15,620).
//
// IDENTITY (A17 as amended by A20 and A21): questionRefId = sha256 of JSON.stringify of the tuple
// QUESTION_IDENTITY_SLOT_LIST names, in that order. The description slot is the loader's
// description (one enclosing quote pair stripped, then trimmed; null when empty, A3). Fields group
// on the first three slots. A group whose Fields carry more than one distinct CEDS id is split: each
// Field's split slot is its own id, so the Fields with no id form their own question with a null
// slot. Every other group has a null split slot. SIF_Metadata is grouped like any other block.
//
// TEXTS (A5): each Question carries contextText, its relativePath made readable (lib/sif260928ContextText.js;
// SPEC §9 A22). The framework embeds name, description and contextText as declared in
// sif260928ForgeDeclaration.js; an absent description is omitted, so the framework counts it absent.
//
// THE FORGE DOES NO BRIDGING (FBB-001; A20). No CEDS domain enters the identity or any property.
// SIF's own CEDS ID column is read for exactly two things: the split, and cedsElementId, which a
// Question carries only when EVERY one of its Fields carries that same id (A27).

const path = require('path');
const crypto = require('crypto');
const { EDGE_TYPES } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const SIF260928_NODE_KIND_TABLE = require('./sif260928NodeKindTable');
const { contextTextOf } = require('./sif260928ContextText');

// the identity tuple, in order. The order IS the identity: a reordering mints different ids.
const QUESTION_IDENTITY_SLOT_LIST = Object.freeze(['name', 'descriptionOrNull', 'relativePath', 'splitCedsElementIdOrNull']);
// the slots Fields group on before any split
const QUESTION_GROUPING_SLOT_LIST = Object.freeze(['name', 'descriptionOrNull', 'relativePath']);
// sif260928:question/<questionRefId> — the bundle's <kind>/<rest> stableId form (A27)
const QUESTION_STABLE_ID_PREFIX = 'sif260928:question/';
// A7: the judge sees at most this many object names
const OBJECT_NAME_SAMPLE_LIMIT = 12;
// the Question's carried properties; name and description go through makeNode itself
const QUESTION_CARRY_LIST = Object.freeze(['questionRefId', 'relativePath', 'contextText', 'instanceCount', 'sharedBlock', 'objectNameList', 'objectNameSampleList', 'cedsElementId']);

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const slotValueByNameOf = ({ fieldFacts, splitCedsElementIdOrNull }) => ({
	name: fieldFacts.name,
	descriptionOrNull: fieldFacts.description,
	relativePath: fieldFacts.relativePath,
	splitCedsElementIdOrNull,
});
const serialisationOf = ({ slotValueByName, slotNameList }) => JSON.stringify(slotNameList.map((slotName) => slotValueByName[slotName]));

const groupInSourceOrder = ({ itemList, groupNameOf }) =>
	itemList.reduce((groupListByName, oneItem) => {
		const groupName = groupNameOf(oneItem);
		groupListByName.set(groupName, (groupListByName.get(groupName) || []).concat([oneItem]));
		return groupListByName;
	}, new Map());

const distinctCedsElementIdListOf = (fieldFactsList) => [...new Set(fieldFactsList.map((fieldFacts) => fieldFacts.cedsElementId).filter((cedsElementId) => cedsElementId !== null))];

// the split slot of every Field in one grouping: its own id when the grouping names more than one
const splitSlotOf = ({ groupFieldFactsList }) =>
	distinctCedsElementIdListOf(groupFieldFactsList).length > 1 ? (fieldFacts) => fieldFacts.cedsElementId : () => null;

const questionFactsOf = ({ questionFieldFactsList, splitCedsElementIdOrNull }) => {
	const firstFieldFacts = questionFieldFactsList[0];
	const slotValueByName = slotValueByNameOf({ fieldFacts: firstFieldFacts, splitCedsElementIdOrNull });
	const objectNameList = [...new Set(questionFieldFactsList.map((fieldFacts) => fieldFacts.objectName))].sort();
	const everyFieldCedsElementId = questionFieldFactsList.every((fieldFacts) => fieldFacts.cedsElementId !== null && fieldFacts.cedsElementId === firstFieldFacts.cedsElementId);
	return {
		questionRefId: sha256Hex(serialisationOf({ slotValueByName, slotNameList: QUESTION_IDENTITY_SLOT_LIST })),
		name: firstFieldFacts.name,
		description: firstFieldFacts.description,
		relativePath: firstFieldFacts.relativePath,
		// the readable path, one of the Question's three search texts (A5; SPEC §9 A22)
		contextText: contextTextOf(firstFieldFacts.relativePath),
		// the relative path fixes the block, so every Field of a question shares it
		sharedBlock: firstFieldFacts.sharedBlock,
		instanceCount: questionFieldFactsList.length,
		objectNameList,
		objectNameSampleList: objectNameList.slice(0, OBJECT_NAME_SAMPLE_LIMIT),
		...(everyFieldCedsElementId ? { cedsElementId: firstFieldFacts.cedsElementId } : {}),
		fieldXpathList: questionFieldFactsList.map((fieldFacts) => fieldFacts.xpath),
	};
};

// ---- the questions ----------------------------------------------------------------------------

const questionFactsListOf = ({ fieldFactsList }) => {
	const groupFieldFactsListByName = groupInSourceOrder({
		itemList: fieldFactsList,
		groupNameOf: (fieldFacts) => serialisationOf({ slotValueByName: slotValueByNameOf({ fieldFacts, splitCedsElementIdOrNull: null }), slotNameList: QUESTION_GROUPING_SLOT_LIST }),
	});
	return [...groupFieldFactsListByName.values()].reduce((questionFactsList, groupFieldFactsList) => {
		const splitSlotOfField = splitSlotOf({ groupFieldFactsList });
		const questionFieldFactsListBySplitSlot = groupInSourceOrder({ itemList: groupFieldFactsList, groupNameOf: (fieldFacts) => JSON.stringify(splitSlotOfField(fieldFacts)) });
		return questionFactsList.concat([...questionFieldFactsListBySplitSlot.values()].map((questionFieldFactsList) => questionFactsOf({ questionFieldFactsList, splitCedsElementIdOrNull: splitSlotOfField(questionFieldFactsList[0]) })));
	}, []);
};

const questionStableIdOf = (questionRefId) => `${QUESTION_STABLE_ID_PREFIX}${questionRefId}`;

const emitQuestions = ({ questionFactsList, kit, fieldStableIdOfXpath }) => {
	const questionKind = SIF260928_NODE_KIND_TABLE.question;
	questionFactsList.forEach((questionFacts) => {
		const questionStableId = questionStableIdOf(questionFacts.questionRefId);
		kit.makeNode({
			role: questionKind.role,
			perStandardLabel: questionKind.perStandardLabel,
			stableId: questionStableId,
			name: questionFacts.name,
			...(questionFacts.description === null ? {} : { description: questionFacts.description }),
			// a question spans objects, so it hangs on the root (A27)
			structural: { parentId: kit.rootStableId, path: questionFacts.relativePath },
			carriedProperties: kit.carriedProperties({ parsedObject: questionFacts, carryList: QUESTION_CARRY_LIST }),
			origin: `question ${questionFacts.questionRefId}`,
		});
		questionFacts.fieldXpathList.forEach((fieldXpath) => {
			kit.addEdge({ edgeType: EDGE_TYPES.HAS_INSTANCE, fromStableId: questionStableId, toStableId: fieldStableIdOfXpath(fieldXpath), edgeContext: `HAS_INSTANCE ${fieldXpath}` });
		});
	});
	return { questionCount: questionFactsList.length };
};

module.exports = { questionFactsListOf, emitQuestions, questionStableIdOf, QUESTION_IDENTITY_SLOT_LIST, moduleName };
