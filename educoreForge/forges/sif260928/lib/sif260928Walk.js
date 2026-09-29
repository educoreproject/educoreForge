'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sif260928Walk.js — the emission walk (PLAN §3 A1c, A2, A3 and A4; SPEC §3.1 and §3.2 as amended by
// §9, including A24 to A28). PURE and synchronous: it runs inside the framework's buildContractGraph,
// where a throw is the sanctioned refusal (the framework's one adapter hands it to the forge callback).
//
//   emitObjectTree({ rowList, resolvedTableTitleByRefIdName, kit }) → mints, after the framework's root:
//     one Object per distinct object path (the first two xpath segments), in first-appearance order;
//     one Container per xpath prefix below the object that is not itself a row (6,586), each after
//       its ancestors, carrying no isUnbounded (the TSV never states it; A26);
//     one Field per loaded row, in source order, carrying the questionRefId of its Question;
//     one Question per distinct identity tuple, on the root (lib/sif260928Questions.js; A3);
//     one Codeset per distinct quote-wrapped Format cell, on the root, with its CodesetValues
//       (lib/sif260928Codesets.js; A28).
//   and adds Object -HAS_FIELD-> Field for every Field, HAS_CHILD along the element tree,
//   Question -HAS_INSTANCE-> Field for every Field, Codeset -HAS_VALUE-> CodesetValue,
//   Field -CONSTRAINED_BY-> Codeset for every list-carrying Field, and Field -REFERENCES_OBJECT->
//   Object for every RefId Field that resolves (lib/sif260928References.js; A24, A28). It returns the
//   counts, and the xpaths of the RefId Fields that resolved to nothing.
//
// Every node's structural parent is the element one xpath segment up: the Object, a Container, or,
// for an attribute on an element that is itself a row, that element's Field (A26). HAS_CHILD mirrors
// that parentId, except that a Field directly on its Object has only its HAS_FIELD edge.
//
// The per-node facts are derived here from the loader's row; the loader already refused every
// malformed cell, so nothing below re-checks the source. The walk's own refusal is the parentPath
// floor (A1c gate (c)): a parentPath that is not the Object's path or beneath it is refused by name.
// parentPath is SPEC §3.1's attribute-folded property; it is not the structural parent. The
// references module adds one more (A4): a map target that names no table of the TSV.
//
// THE FORGE DOES NO BRIDGING (FBB-001). cedsElementId and cedsIdCellText are SIF's own column,
// carried verbatim; the walk never reads them, and the Questions read cedsElementId only to split a
// question whose Fields name more than one id (A21) and to carry an id every Field agrees on (A27).

const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
const { EDGE_TYPES } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const SIF260928_NODE_KIND_TABLE = require('./sif260928NodeKindTable');
const questions = require('./sif260928Questions');
const codesets = require('./sif260928Codesets');
const references = require('./sif260928References');

const STABLE_ID_PREFIX_BY_KIND = Object.freeze({ object: 'sif260928:object', container: 'sif260928:container', field: 'sif260928:field' });
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
	// the id of the Field's Question (A3; SPEC §9 A17)
	'questionRefId',
]);
const OBJECT_CARRY_LIST = Object.freeze(['objectName', 'fieldCount']);
// a Container has no row, so it carries only what its path implies (SPEC §3.1)
const CONTAINER_CARRY_LIST = Object.freeze(['objectName']);

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

// ---- the per-object tree (A2) ------------------------------------------------------------------

// every xpath prefix below the object that is not itself a row is a Container (SPEC §3.1, decision
// D2), listed in first-appearance order with each Container after its own ancestors
const containerFactsListOf = ({ fieldFactsList }) => {
	const xpathSet = new Set(fieldFactsList.map((fieldFacts) => fieldFacts.xpath));
	const containerFactsByPath = new Map();
	fieldFactsList.forEach((fieldFacts) => {
		const segmentList = fieldFacts.xpath.split(XPATH_SEPARATOR).slice(1);
		for (let prefixSegmentCount = OBJECT_SEGMENT_COUNT + 1; prefixSegmentCount < segmentList.length; prefixSegmentCount++) {
			const containerPath = joinXpath(segmentList.slice(0, prefixSegmentCount));
			if (!xpathSet.has(containerPath) && !containerFactsByPath.has(containerPath)) {
				containerFactsByPath.set(containerPath, { containerPath, name: segmentList[prefixSegmentCount - 1], objectName: fieldFacts.objectName });
			}
		}
	});
	return [...containerFactsByPath.values()];
};

// a node's structural parent is the element one xpath segment up: its Object, a Container, or, for
// an attribute on an element that is itself a row, that element's Field. Every such prefix is a
// minted node, so the framework's depth is the xpath segment count less one (SPEC §9 A25).
const structuralParentPathOf = (nodePath) => nodePath.slice(0, nodePath.lastIndexOf(XPATH_SEPARATOR));

// which structural parent → child pairs carry a HAS_CHILD edge. A Field directly on its Object
// has no HAS_CHILD: its HAS_FIELD edge already joins them.
const HAS_CHILD_CHILD_KIND_LIST_BY_PARENT_KIND = Object.freeze({
	object: Object.freeze(['container']),
	container: Object.freeze(['container', 'field']),
	field: Object.freeze(['field']),
});

// ---- the walk -------------------------------------------------------------------------------

const emitObjectTree = ({ rowList, resolvedTableTitleByRefIdName, kit }) => {
	const fieldFactsList = rowList.map(fieldFactsOf);
	const containerFactsList = containerFactsListOf({ fieldFactsList });
	const questionFactsList = questions.questionFactsListOf({ fieldFactsList });
	const questionRefIdByXpath = new Map(questionFactsList.reduce((soFar, questionFacts) => soFar.concat(questionFacts.fieldXpathList.map((fieldXpath) => [fieldXpath, questionFacts.questionRefId])), []));

	const fieldCountByObjectPath = new Map();
	const objectNameByObjectPath = new Map();
	fieldFactsList.forEach((fieldFacts) => {
		fieldCountByObjectPath.set(fieldFacts.objectPath, (fieldCountByObjectPath.get(fieldFacts.objectPath) || 0) + 1);
		objectNameByObjectPath.set(fieldFacts.objectPath, fieldFacts.objectName);
	});

	const nodeKindByPath = new Map([
		...[...fieldCountByObjectPath.keys()].map((objectPath) => [objectPath, 'object']),
		...containerFactsList.map((containerFacts) => [containerFacts.containerPath, 'container']),
		...fieldFactsList.map((fieldFacts) => [fieldFacts.xpath, 'field']),
	]);
	const stableIdOfPath = (nodePath) => `${STABLE_ID_PREFIX_BY_KIND[nodeKindByPath.get(nodePath)]}${nodePath}`;

	// adds the HAS_CHILD edge the table asks for, and returns the parent's stableId for parentId, so
	// the edge and the parentId are derived from one parent and cannot disagree
	const attachToStructuralParent = ({ nodePath }) => {
		const parentPath = structuralParentPathOf(nodePath);
		if (HAS_CHILD_CHILD_KIND_LIST_BY_PARENT_KIND[nodeKindByPath.get(parentPath)].includes(nodeKindByPath.get(nodePath))) {
			kit.addEdge({ edgeType: EDGE_TYPES.HAS_CHILD, fromStableId: stableIdOfPath(parentPath), toStableId: stableIdOfPath(nodePath), edgeContext: `HAS_CHILD ${nodePath}` });
		}
		return stableIdOfPath(parentPath);
	};

	const objectKind = SIF260928_NODE_KIND_TABLE.object;
	fieldCountByObjectPath.forEach((fieldCount, objectPath) => {
		const objectName = objectNameByObjectPath.get(objectPath);
		kit.makeNode({
			role: objectKind.role,
			perStandardLabel: objectKind.perStandardLabel,
			stableId: stableIdOfPath(objectPath),
			name: objectName,
			structural: { parentId: kit.rootStableId, path: objectPath },
			carriedProperties: kit.carriedProperties({ parsedObject: { objectName, fieldCount }, carryList: OBJECT_CARRY_LIST }),
			origin: `object ${objectPath}`,
		});
	});

	const containerKind = SIF260928_NODE_KIND_TABLE.container;
	containerFactsList.forEach((containerFacts) => {
		kit.makeNode({
			role: containerKind.role,
			perStandardLabel: containerKind.perStandardLabel,
			stableId: stableIdOfPath(containerFacts.containerPath),
			name: containerFacts.name,
			structural: { parentId: attachToStructuralParent({ nodePath: containerFacts.containerPath }), path: containerFacts.containerPath },
			carriedProperties: kit.carriedProperties({ parsedObject: containerFacts, carryList: CONTAINER_CARRY_LIST }),
			origin: `container ${containerFacts.containerPath}`,
		});
	});

	const fieldKind = SIF260928_NODE_KIND_TABLE.field;
	fieldFactsList.forEach((fieldFacts) => {
		assertParentPathWithinObject({ fieldFacts });
		kit.makeNode({
			role: fieldKind.role,
			perStandardLabel: fieldKind.perStandardLabel,
			stableId: stableIdOfPath(fieldFacts.xpath),
			name: fieldFacts.name,
			...(fieldFacts.description === null ? {} : { description: fieldFacts.description }),
			structural: { parentId: attachToStructuralParent({ nodePath: fieldFacts.xpath }), path: fieldFacts.xpath },
			carriedProperties: kit.carriedProperties({ parsedObject: presentFactsOf({ ...fieldFacts, questionRefId: questionRefIdByXpath.get(fieldFacts.xpath) }), carryList: FIELD_CARRY_LIST }),
			origin: `line ${fieldFacts.sourceLineNumber} ${fieldFacts.xpath}`,
		});
		kit.addEdge({ edgeType: EDGE_TYPES.HAS_FIELD, fromStableId: stableIdOfPath(fieldFacts.objectPath), toStableId: stableIdOfPath(fieldFacts.xpath), edgeContext: `HAS_FIELD ${fieldFacts.xpath}` });
	});

	const { questionCount } = questions.emitQuestions({ questionFactsList, kit, fieldStableIdOfXpath: stableIdOfPath });

	const { codesetCount, codesetValueCount } = codesets.emitCodesets({ codesetFactsList: codesets.codesetFactsListOf({ fieldFactsList }), kit, fieldStableIdOfXpath: stableIdOfPath });

	const { referenceFactsList, unresolvedFieldXpathList } = references.referenceFactsOf({ fieldFactsList, resolvedTableTitleByRefIdName });
	const { referenceCount } = references.emitReferences({ referenceFactsList, kit, stableIdOfPath });

	return {
		objectCount: fieldCountByObjectPath.size,
		containerCount: containerFactsList.length,
		fieldCount: fieldFactsList.length,
		questionCount,
		codesetCount,
		codesetValueCount,
		referenceCount,
		unresolvedFieldXpathList,
	};
};

module.exports = { emitObjectTree, STABLE_ID_PREFIX_BY_KIND, FIELD_CARRY_LIST, moduleName };
