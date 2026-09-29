'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sif260928Walk.js — the emission walk (PLAN §3 A1c; SPEC §3.1 as amended by §9). PURE and
// synchronous: it runs inside the framework's buildContractGraph, where a throw is the sanctioned
// refusal (the framework's one adapter hands it to the forge callback).
//
//   emitObjectsAndFields({ rowList, kit }) → mints, after the framework's root:
//     one Object per distinct object path (the first two xpath segments), in first-appearance order,
//     then one Field per loaded row, in source order.
//
// Each Field's structural parent is its Object. The walk adds NO edges: the edge types arrive with
// V1 and the tree with A2. No questionRefId either: A3 stamps it.
//
// The per-node facts are derived here from the loader's row; the loader already refused every
// malformed cell, so nothing below re-checks the source. The ONE refusal is the parentPath floor
// (gate (c)): a parentPath that is not the Object's path or beneath it is refused by name.
//
// THE FORGE DOES NO BRIDGING (FBB-001). cedsElementId and cedsIdCellText are SIF's own column,
// carried verbatim; nothing here reads them.

const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
const SIF260928_NODE_KIND_TABLE = require('./sif260928NodeKindTable');

const STABLE_ID_PREFIX_BY_KIND = Object.freeze({ object: 'sif260928:object', field: 'sif260928:field' });
const XPATH_SEPARATOR = '/';
const OBJECT_SEGMENT_COUNT = 2; // /<collection>/<object>
const ATTRIBUTE_NAME_PREFIX = '@';
// sharedBlock: the first of these named anywhere in the relative path, else MODEL_BLOCK_NAME (as C1)
const SHARED_BLOCK_NAME_LIST = Object.freeze(['SIF_Metadata', 'SIF_ExtendedElements']);
const MODEL_BLOCK_NAME = 'model';

// the Field's carried properties, in this order. A fact that is null or '' is omitted, never
// stamped: an empty cell is absent (SPEC §9 A25)
const FIELD_CARRY_LIST = Object.freeze([
	'xpath',
	'relativePath',
	'objectName',
	'parentPath',
	// the number of xpath segments. Not 'depth': the structural finalizer overwrites depth with the
	// parentId-chain length (SPEC §9 A25)
	'xpathDepth',
	'isAttribute',
	'sharedBlock',
	'type',
	'format',
	'mandatoryCellText',
	'characteristics',
	'obligation',
	'repeatable',
	'descriptionQuoted',
	'descriptionCellText',
	'cedsElementId',
	'cedsIdCellText',
]);
const OBJECT_CARRY_LIST = Object.freeze(['objectName', 'fieldCount']);

// ---- derived facts ----------------------------------------------------------------------------

// the attribute folds to its element's parent; an attribute on the object element would fold to
// the collection, above the object, so it is floored at the object
const parentSegmentListOf = ({ segmentList, isAttribute }) => {
	const foldedSegmentList = isAttribute ? segmentList.slice(0, -2) : segmentList.slice(0, -1);
	return foldedSegmentList.length < OBJECT_SEGMENT_COUNT ? segmentList.slice(0, OBJECT_SEGMENT_COUNT) : foldedSegmentList;
};

const joinXpath = (segmentList) => `${XPATH_SEPARATOR}${segmentList.join(XPATH_SEPARATOR)}`;

const fieldFactsOf = (row) => {
	const segmentList = row.xpath.split(XPATH_SEPARATOR).slice(1);
	const relativeSegmentList = segmentList.slice(OBJECT_SEGMENT_COUNT);
	const isAttribute = segmentList[segmentList.length - 1].startsWith(ATTRIBUTE_NAME_PREFIX);
	const sharedBlock = SHARED_BLOCK_NAME_LIST.find((blockName) => relativeSegmentList.includes(blockName));
	return {
		...row,
		objectPath: joinXpath(segmentList.slice(0, OBJECT_SEGMENT_COUNT)),
		objectName: segmentList[OBJECT_SEGMENT_COUNT - 1],
		relativePath: relativeSegmentList.join(XPATH_SEPARATOR),
		parentPath: joinXpath(parentSegmentListOf({ segmentList, isAttribute })),
		xpathDepth: segmentList.length,
		isAttribute,
		sharedBlock: sharedBlock === undefined ? MODEL_BLOCK_NAME : sharedBlock,
	};
};

// null (the loader's absence) and '' (an empty verbatim cell) are both omitted from the node
const presentFactsOf = (facts) =>
	Object.keys(facts).reduce((soFar, factName) => (facts[factName] === null || facts[factName] === '' ? soFar : { ...soFar, [factName]: facts[factName] }), {});

const assertParentPathWithinObject = ({ fieldFacts }) => {
	const { parentPath, objectPath, xpath, sourceLineNumber } = fieldFacts;
	if (parentPath !== objectPath && !parentPath.startsWith(`${objectPath}${XPATH_SEPARATOR}`)) {
		throw refuse.byName({
			moduleName,
			what: `line ${sourceLineNumber} (${xpath}) has parentPath '${parentPath}', above its object '${objectPath}'`,
			where: 'a Field sits within its object: parentPath is floored at the object path (SPEC §3.1)',
		});
	}
};

// ---- the walk -------------------------------------------------------------------------------

const emitObjectsAndFields = ({ rowList, kit }) => {
	const fieldFactsList = rowList.map(fieldFactsOf);

	const fieldCountByObjectPath = new Map();
	const objectNameByObjectPath = new Map();
	fieldFactsList.forEach((fieldFacts) => {
		fieldCountByObjectPath.set(fieldFacts.objectPath, (fieldCountByObjectPath.get(fieldFacts.objectPath) || 0) + 1);
		objectNameByObjectPath.set(fieldFacts.objectPath, fieldFacts.objectName);
	});

	const objectKind = SIF260928_NODE_KIND_TABLE.object;
	fieldCountByObjectPath.forEach((fieldCount, objectPath) => {
		const objectName = objectNameByObjectPath.get(objectPath);
		kit.makeNode({
			role: objectKind.role,
			perStandardLabel: objectKind.perStandardLabel,
			stableId: `${STABLE_ID_PREFIX_BY_KIND.object}${objectPath}`,
			name: objectName,
			structural: { parentId: kit.rootStableId, path: objectPath },
			carriedProperties: kit.carriedProperties({ parsedObject: { objectName, fieldCount }, carryList: OBJECT_CARRY_LIST }),
			origin: `object ${objectPath}`,
		});
	});

	const fieldKind = SIF260928_NODE_KIND_TABLE.field;
	fieldFactsList.forEach((fieldFacts) => {
		assertParentPathWithinObject({ fieldFacts });
		kit.makeNode({
			role: fieldKind.role,
			perStandardLabel: fieldKind.perStandardLabel,
			stableId: `${STABLE_ID_PREFIX_BY_KIND.field}${fieldFacts.xpath}`,
			name: fieldFacts.name,
			...(fieldFacts.description === null ? {} : { description: fieldFacts.description }),
			structural: { parentId: `${STABLE_ID_PREFIX_BY_KIND.object}${fieldFacts.objectPath}`, path: fieldFacts.xpath },
			carriedProperties: kit.carriedProperties({ parsedObject: presentFactsOf(fieldFacts), carryList: FIELD_CARRY_LIST }),
			origin: `line ${fieldFacts.sourceLineNumber} ${fieldFacts.xpath}`,
		});
	});

	return { objectCount: fieldCountByObjectPath.size, fieldCount: fieldFactsList.length };
};

module.exports = { emitObjectsAndFields, STABLE_ID_PREFIX_BY_KIND, FIELD_CARRY_LIST, moduleName };
