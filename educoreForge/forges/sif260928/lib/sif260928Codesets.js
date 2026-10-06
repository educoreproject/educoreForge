'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sif260928Codesets.js — SIF's code lists (PLAN §3 A4; SPEC §9 A28). PURE and synchronous, called by
// the walk inside the framework's buildContractGraph.
//
//   codesetFactsListOf({ fieldFactsList }) → one Codeset per distinct verbatim Format cell that is a
//     code list, in the order its first Field appears, with its values in source order and the xpaths
//     of every Field carrying that exact cell.
//   emitCodesets({ codesetFactsList, kit, fieldStableIdOfXpath }) → mints each Codeset on the root,
//     its CodesetValues through kit.emitOptionValue (Codeset -HAS_VALUE-> CodesetValue), and
//     Field -HAS_OPTION_SET-> Codeset for every Field carrying the cell (⟪campaign P3, W-C-2 / S3⟫ the one
//     option-set edge every standard writes; it was CONSTRAINED_BY, a SIF-only type no reader followed).
//
// WHERE THE VALUES COME FROM (A28, measured): the snapshot states allowed values only in a Format cell
// wrapped in one pair of double quotes, which the loader has already split into codeListValueList.
// Nothing else is a code list: an unquoted Format cell (a fixed value, an object name, a pattern), an
// @...Codeset attribute that only points at a codeset elsewhere, and a Type name, whose values the
// snapshot does not state, all mint nothing.
//
// ⟪campaign P3, G18 (part of S3)⟫ A Codeset is NAMED FROM ITS SOURCE: the snapshot gives a code list no name of
// its own, but every one is stated in the Format cell of named Fields. The name is the element names of the
// Fields that carry the cell — each as <parent element>/<field> (a bare 'Code' says nothing), distinct, in the
// order the Fields first appear — the first CODESET_NAME_ELEMENT_LIMIT of them, then 'and N more'. Its IDENTITY
// is still the cell itself (stableId = sha256 of the cell), so naming moves no address.

const path = require('path');
const crypto = require('crypto');
const { EDGE_TYPES, rootOwnershipEdgeTypeFor } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const SIF260928_NODE_KIND_TABLE = require('./sif260928NodeKindTable');

// sif260928:codeset/<sha256 of the verbatim cell> and sif260928:codesetValue/<that sha>/<value>; the
// structural path is the same address without the standard prefix (the cell itself can run to 20 kB)
const STANDARD_STABLE_ID_PREFIX = 'sif260928:';
const CODESET_PATH_PREFIX = 'codeset/';
const CODESET_VALUE_PATH_PREFIX = 'codesetValue/';
const CODESET_CARRY_LIST = Object.freeze(['formatCellText', 'valueCount']);
const CODESET_VALUE_CARRY_LIST = Object.freeze(['valueOrdinal']);
const CODESET_NAME_ELEMENT_LIMIT = 3;

// '/A/B/GradeLevel/Code' -> 'GradeLevel/Code'
const elementNameOfXpath = (xpath) => xpath.split('/').filter((oneSegment) => oneSegment !== '').slice(-2).join('/');
const codesetNameOf = (fieldXpathList) => {
	const elementNameList = fieldXpathList.map(elementNameOfXpath).filter((oneName, nameIndex, allNameList) => allNameList.indexOf(oneName) === nameIndex);
	const shownNameList = elementNameList.slice(0, CODESET_NAME_ELEMENT_LIMIT);
	const hiddenCount = elementNameList.length - shownNameList.length;
	return hiddenCount > 0 ? `${shownNameList.join(', ')} and ${hiddenCount} more` : shownNameList.join(', ');
};

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// ---- the code lists ---------------------------------------------------------------------------

const codesetFactsListOf = ({ fieldFactsList }) => {
	const codesetFactsByFormatCellText = fieldFactsList
		.filter((fieldFacts) => fieldFacts.codeListValueList !== null)
		.reduce((soFar, fieldFacts) => {
			const codesetFacts = soFar.get(fieldFacts.format);
			if (codesetFacts === undefined) {
				const codesetDigest = sha256Hex(fieldFacts.format);
				return soFar.set(fieldFacts.format, {
					codesetDigest,
					codesetPath: `${CODESET_PATH_PREFIX}${codesetDigest}`,
					formatCellText: fieldFacts.format,
					valueTextList: fieldFacts.codeListValueList,
					valueCount: fieldFacts.codeListValueList.length,
					fieldXpathList: [fieldFacts.xpath],
				});
			}
			codesetFacts.fieldXpathList.push(fieldFacts.xpath);
			return soFar;
		}, new Map());
	return [...codesetFactsByFormatCellText.values()];
};

const emitCodesets = ({ codesetFactsList, kit, fieldStableIdOfXpath }) => {
	const codesetKind = SIF260928_NODE_KIND_TABLE.codeset;
	const codesetValueKind = SIF260928_NODE_KIND_TABLE.codesetValue;
	codesetFactsList.forEach((codesetFacts) => {
		const codesetStableId = `${STANDARD_STABLE_ID_PREFIX}${codesetFacts.codesetPath}`;
		kit.makeNode({
			role: codesetKind.role,
			perStandardLabel: codesetKind.perStandardLabel,
			stableId: codesetStableId,
			name: codesetNameOf(codesetFacts.fieldXpathList),
			// a code list is shared by Fields across objects, so it hangs on the root
			structural: { parentId: kit.rootStableId, path: codesetFacts.codesetPath },
			carriedProperties: kit.carriedProperties({ parsedObject: codesetFacts, carryList: CODESET_CARRY_LIST }),
			origin: `codeset ${codesetFacts.formatCellText.slice(0, 80)}`,
		});
		// ⟪campaign P3, W-C-1⟫ a node parented on the root is REACHED from it, by the edge its role names
		kit.addEdge({ edgeType: rootOwnershipEdgeTypeFor(codesetKind.role), fromStableId: kit.rootStableId, toStableId: codesetStableId, edgeContext: `root ownership ${codesetFacts.codesetPath}` });
		codesetFacts.valueTextList.forEach((valueText, valueIndex) => {
			const codesetValuePath = `${CODESET_VALUE_PATH_PREFIX}${codesetFacts.codesetDigest}/${valueText}`;
			kit.emitOptionValue({
				optionSetStableId: codesetStableId,
				optionValueStableId: `${STANDARD_STABLE_ID_PREFIX}${codesetValuePath}`,
				perStandardLabel: codesetValueKind.perStandardLabel,
				name: valueText,
				path: codesetValuePath,
				carriedProperties: kit.carriedProperties({ parsedObject: { valueOrdinal: valueIndex + 1 }, carryList: CODESET_VALUE_CARRY_LIST }),
				edgeContext: `HAS_VALUE ${codesetStableId} ${valueText}`,
				origin: `codeset value ${valueText}`,
			});
		});
		codesetFacts.fieldXpathList.forEach((fieldXpath) => {
			kit.addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: fieldStableIdOfXpath(fieldXpath), toStableId: codesetStableId, edgeContext: `HAS_OPTION_SET ${fieldXpath}` });
		});
	});
	return { codesetCount: codesetFactsList.length, codesetValueCount: codesetFactsList.reduce((soFar, codesetFacts) => soFar + codesetFacts.valueCount, 0) };
};

module.exports = { codesetFactsListOf, emitCodesets, codesetNameOf, moduleName };
