'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sif260928References.js — the one native relation, Field -REFERENCES_OBJECT-> Object (PLAN §3 A4;
// SPEC §9 A24 and A28). PURE and synchronous, called by the walk inside the framework's
// buildContractGraph.
//
//   referenceFactsOf({ fieldFactsList, resolvedTableTitleByRefIdName }) →
//     { referenceFactsList: [{ fieldXpath, targetObjectPath, resolvedThrough }], unresolvedFieldXpathList }
//   emitReferences({ referenceFactsList, kit, stableIdOfPath }) → one edge per resolved Field
//
// THE RULE (A24, A28), and nothing else: a RefId field is one whose name, with one leading '@' (the
// XML attribute marker) dropped, ends 'RefId' and is not 'RefId' itself (the object's own identity).
// It resolves
//   1. through refIdResolutionMap.tsv, whose resolvedTable is a TABLE TITLE naming one Object; or,
//      when the map does not name it,
//   2. through an exact match of the name less 'RefId' to an Object's name.
// No pluralisation, no case folding, no other heuristic. A field that resolves neither way gets no
// edge and is returned by xpath, for the gate to count and list. The map's one sentinel names no
// table (SIF's polymorphic reference); any other map target that names no table is refused by name.

const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
const { EDGE_TYPES } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const REF_ID_NAME_SUFFIX = 'RefId';
const ATTRIBUTE_NAME_PREFIX = '@';
// the map's resolvedTable for a reference whose target no table states (SIF_RefId)
const UNRESOLVABLE_TABLE_TITLE_LIST = Object.freeze(['UNRESOLVABLE_GENERIC_REF']);
// how an edge was resolved, stamped on it so the graph says which rule made it
const RESOLVED_THROUGH = Object.freeze({ REF_ID_MAP: 'refIdResolutionMap', OBJECT_NAME: 'objectName' });

const bareNameOf = (fieldName) => (fieldName.startsWith(ATTRIBUTE_NAME_PREFIX) ? fieldName.slice(ATTRIBUTE_NAME_PREFIX.length) : fieldName);
const isRefIdName = (bareName) => bareName.endsWith(REF_ID_NAME_SUFFIX) && bareName !== REF_ID_NAME_SUFFIX;

// the map's target for one name: the Object's path, or null for the sentinel
const mapTargetObjectPathOf = ({ refIdName, resolvedTableTitle, objectPathByTableTitle }) => {
	if (UNRESOLVABLE_TABLE_TITLE_LIST.indexOf(resolvedTableTitle) !== -1) {
		return null;
	}
	const targetObjectPath = objectPathByTableTitle.get(resolvedTableTitle);
	if (targetObjectPath === undefined) {
		throw refuse.byName({
			moduleName,
			what: `refIdResolutionMap.tsv resolves '${refIdName}' to table '${resolvedTableTitle}', which is no table title of the TSV`,
			where: `resolvedTable is a table title (a '<TableName>: Table N' line) or one of ${UNRESOLVABLE_TABLE_TITLE_LIST.join(', ')}`,
		});
	}
	return targetObjectPath;
};

// the exact-name rule: the Object whose name is the RefId name less 'RefId', or null when none is
const exactObjectPathOf = ({ bareName, objectPathByObjectName }) => {
	const objectName = bareName.slice(0, -REF_ID_NAME_SUFFIX.length);
	return objectPathByObjectName.has(objectName) ? objectPathByObjectName.get(objectName) : null;
};

const referenceFactsOf = ({ fieldFactsList, resolvedTableTitleByRefIdName }) => {
	const objectPathByTableTitle = new Map(fieldFactsList.map((fieldFacts) => [fieldFacts.tableTitleName, fieldFacts.objectPath]));
	const objectPathByObjectName = new Map(fieldFactsList.map((fieldFacts) => [fieldFacts.objectName, fieldFacts.objectPath]));

	return fieldFactsList.reduce(
		(soFar, fieldFacts) => {
			const bareName = bareNameOf(fieldFacts.name);
			if (!isRefIdName(bareName)) {
				return soFar;
			}
			const resolvedTableTitle = resolvedTableTitleByRefIdName[bareName];
			const reference =
				resolvedTableTitle !== undefined
					? { targetObjectPath: mapTargetObjectPathOf({ refIdName: bareName, resolvedTableTitle, objectPathByTableTitle }), resolvedThrough: RESOLVED_THROUGH.REF_ID_MAP }
					: { targetObjectPath: exactObjectPathOf({ bareName, objectPathByObjectName }), resolvedThrough: RESOLVED_THROUGH.OBJECT_NAME };
			if (reference.targetObjectPath === null) {
				soFar.unresolvedFieldXpathList.push(fieldFacts.xpath);
				return soFar;
			}
			soFar.referenceFactsList.push({ fieldXpath: fieldFacts.xpath, ...reference });
			return soFar;
		},
		{ referenceFactsList: [], unresolvedFieldXpathList: [] },
	);
};

const emitReferences = ({ referenceFactsList, kit, stableIdOfPath }) => {
	referenceFactsList.forEach((referenceFacts) => {
		kit.addEdge({
			edgeType: EDGE_TYPES.REFERENCES_OBJECT,
			fromStableId: stableIdOfPath(referenceFacts.fieldXpath),
			toStableId: stableIdOfPath(referenceFacts.targetObjectPath),
			edgeProperties: { resolvedThrough: referenceFacts.resolvedThrough },
			edgeContext: `REFERENCES_OBJECT ${referenceFacts.fieldXpath}`,
		});
	});
	return { referenceCount: referenceFactsList.length };
};

module.exports = { referenceFactsOf, emitReferences, RESOLVED_THROUGH, moduleName };
