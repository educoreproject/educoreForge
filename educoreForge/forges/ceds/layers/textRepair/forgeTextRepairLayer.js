'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeTextRepairLayer.js — the producer of CEDS's `textRepair` layer: the DECLARED SOURCE EXCEPTION for the U+FFFD
// replacement characters in the CEDS V14 ontology (TQ ruling 3, 2026-10-12; README_sourceExceptions.md case 12; lane DES).
//
// THE RULING: the ontology's text stays the faithful value (the CEDS round trip is unchanged); the correct text, taken from the
// CEDS IDS v14 reference data, rides BESIDE it with its provenance (file, sha256, line). Never a silent overwrite. Terms the
// IDS cannot correct are listed and left alone.
//
// SO: one CedsTextRepair node (role DmeTextRepair) per repaired (node, property, value position), linked to the damaged V14
// node by REPAIRS_TEXT_OF. The V14 node is never written to. A repair is minted ONLY when all three hold:
//   1. ID JOIN, never text search: option value -> its option set (HAS_VALUE) -> every property ranging over that set
//      (HAS_OPTION_SET) -> every IDS reference table whose DDL CEDS_GlobalId names that property's id -> the row whose Code
//      equals the value's notation;
//   2. the IDS text equals the faithful text at every character that is not U+FFFD, each U+FFFD standing for exactly ONE
//      other character;
//   3. exactly one distinct candidate text survives (two = ambiguous, listed, left alone).
// The IDS column a property is repaired from is DATA (REPAIR_SOURCE_COLUMN_BY_PROPERTY_NAME): an option value's name and
// prefLabel are the IDS Description; its definition and description are the IDS Definition (measured: the ontology's
// dc:description of a named individual is the definition text, and the IDS Description column repairs none of them).
//
// Every U+FFFD-bearing text in the base that is NOT repaired is counted and listed on the layer root
// (unrepairedTextListText), each with its reason, so no reader can mistake the layer for "the damage is fixed".

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', 'lib');
const vocabulary = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary'));
const { readIdsSource } = require('./lib/idsSource');

const { DME_ROLES, EDGE_TYPES, PROVENANCE_TIER } = vocabulary;
const DDL_FILE_NAME = 'CEDS-IDS.sql';
const POPULATE_FILE_NAME = 'Populate-CEDS-Ref-Tables.sql';
const REPLACEMENT_CHARACTER = '�';
const DERIVED_NODE_LABEL_LIST = Object.freeze(['HubReference', 'HubDefinition']);
// properties the CEDS forge BUILDS from a term's name (path, searchText) are copies, not ontology statements: their damage is
// the name's damage, counted once on the name
const DERIVED_PROPERTY_NAME_LIST = Object.freeze(['path', 'searchText']);
const REPAIR_RULE_NAME = 'idsReferenceRowByIdJoinOneCharacterPerReplacementCharacter';
const REPAIR_SOURCE_COLUMN_BY_PROPERTY_NAME = Object.freeze({ name: 'Description', prefLabel: 'Description', definition: 'Definition', description: 'Definition' });
const UNREPAIRED_REASON = Object.freeze({
	NOT_AN_OPTION_VALUE: 'notAnOptionValue',
	PROPERTY_NOT_REPAIRABLE_FROM_IDS: 'propertyHasNoIdsColumn',
	NO_IDS_ROW: 'noIdsReferenceRowByIdJoin',
	IDS_TEXT_DIFFERS: 'idsTextDiffersBeyondTheDamage',
	AMBIGUOUS: 'moreThanOneIdsText',
});

const layerDeclaration = Object.freeze({
	layerKey: 'textRepair',
	roleList: Object.freeze([DME_ROLES.TEXT_REPAIR]),
	edgeTypeList: Object.freeze([EDGE_TYPES.REPAIRS_TEXT_OF, EDGE_TYPES.DECLARES_REPAIR]),
});

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the repair rule, as a test: every non-U+FFFD character equal, every U+FFFD exactly one other character
const repairPatternOf = (faithfulText) => new RegExp(`^${faithfulText.split(REPLACEMENT_CHARACTER).map(escapeRegExp).join(`[^${REPLACEMENT_CHARACTER}]`)}$`, 'su');
const valueListOf = (propertyValue) => (Array.isArray(propertyValue) ? propertyValue : [propertyValue]);
const sha256OfFile = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const produceLayer = ({ sourceFilePathByName, baseIndex, layerIdentity }, callback) => {
	const ddlFilePath = sourceFilePathByName[DDL_FILE_NAME];
	const populateFilePath = sourceFilePathByName[POPULATE_FILE_NAME];
	if (!ddlFilePath || !populateFilePath) {
		callback(`${moduleName}: the layer's sourceFileList must name ${DDL_FILE_NAME} and ${POPULATE_FILE_NAME} (got ${Object.keys(sourceFilePathByName).join(', ')})`);
		return;
	}
	readIdsSource({ ddlFilePath, populateFilePath }, (readError, idsSource) => {
		if (readError) {
			callback(readError);
			return;
		}
		const populateSha256 = sha256OfFile(populateFilePath);
		// the id join, IDS side: property id -> reference tables that name it; table -> rows by Code
		const tableNameListByPropertyCedsId = {};
		Object.keys(idsSource.globalIdListByTableName).forEach((tableName) =>
			idsSource.globalIdListByTableName[tableName].forEach((globalId) => {
				(tableNameListByPropertyCedsId[`P${globalId}`] = tableNameListByPropertyCedsId[`P${globalId}`] || []).push(tableName);
			}),
		);
		const rowListByTableAndCode = {};
		idsSource.referenceRowList.forEach((oneRow) => {
			const rowIdentity = `${oneRow.tableName}␟${oneRow.code}`;
			(rowListByTableAndCode[rowIdentity] = rowListByTableAndCode[rowIdentity] || []).push(oneRow);
		});
		// the id join, ontology side: option value -> option sets (HAS_VALUE, reversed) -> properties (HAS_OPTION_SET, reversed)
		const optionSetStableIdListByValue = {};
		baseIndex.nodeListOfRole(DME_ROLES.OPTION_SET).forEach((oneSet) =>
			baseIndex.targetStableIdListOf({ edgeType: EDGE_TYPES.HAS_VALUE, fromStableId: oneSet.stableId }).forEach((valueStableId) => {
				(optionSetStableIdListByValue[valueStableId] = optionSetStableIdListByValue[valueStableId] || []).push(oneSet.stableId);
			}),
		);
		const propertyCedsIdListBySet = {};
		baseIndex.nodeListOfRole(DME_ROLES.PROPERTY).forEach((oneProperty) =>
			baseIndex.targetStableIdListOf({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: oneProperty.stableId }).forEach((setStableId) => {
				(propertyCedsIdListBySet[setStableId] = propertyCedsIdListBySet[setStableId] || []).push(oneProperty.propertyByName.cedsId);
			}),
		);

		const nodeList = [];
		const edgeList = [];
		const unrepairedList = [];
		const damagedNodeStableIdSet = new Set();
		// the ontology's OWN terms only: the folded hub's cards and definition, and the framework's text nodes, are derived
		// from them (a card copies an option value's damaged name), so counting them would count one damage several times
		const baseNodeList = Object.values(baseIndex.nodeByStableId).filter((oneNode) => !DERIVED_NODE_LABEL_LIST.some((oneLabel) => oneNode.labels.indexOf(oneLabel) !== -1) && oneNode.role !== DME_ROLES.EMBED_TEXT).sort((left, right) => (left.stableId < right.stableId ? -1 : left.stableId > right.stableId ? 1 : 0));
		for (const oneNode of baseNodeList) {
			for (const propertyName of Object.keys(oneNode.propertyByName).filter((onePropertyName) => DERIVED_PROPERTY_NAME_LIST.indexOf(onePropertyName) === -1).sort()) {
				valueListOf(oneNode.propertyByName[propertyName]).forEach((oneValue, valueOrdinal) => {
					if (typeof oneValue !== 'string' || oneValue.indexOf(REPLACEMENT_CHARACTER) === -1) {
						return;
					}
					damagedNodeStableIdSet.add(oneNode.stableId);
					const unrepaired = (reason) => unrepairedList.push({ stableId: oneNode.stableId, cedsId: oneNode.propertyByName.cedsId, role: oneNode.role, propertyName, valueOrdinal, reason });
					if (oneNode.role !== DME_ROLES.OPTION_VALUE) {
						unrepaired(UNREPAIRED_REASON.NOT_AN_OPTION_VALUE);
						return;
					}
					const sourceColumnName = REPAIR_SOURCE_COLUMN_BY_PROPERTY_NAME[propertyName];
					if (sourceColumnName === undefined) {
						unrepaired(UNREPAIRED_REASON.PROPERTY_NOT_REPAIRABLE_FROM_IDS);
						return;
					}
					const notationList = valueListOf(oneNode.propertyByName.notation).filter((oneNotation) => typeof oneNotation === 'string');
					const candidateRowList = [];
					(optionSetStableIdListByValue[oneNode.stableId] || []).forEach((setStableId) =>
						(propertyCedsIdListBySet[setStableId] || []).forEach((propertyCedsId) =>
							(tableNameListByPropertyCedsId[propertyCedsId] || []).forEach((tableName) =>
								notationList.forEach((oneNotation) => (rowListByTableAndCode[`${tableName}␟${oneNotation.trim()}`] || []).forEach((oneRow) => candidateRowList.push(oneRow))),
							),
						),
					);
					const textCandidateRowList = candidateRowList.filter((oneRow) => typeof oneRow.valueByColumnName[sourceColumnName] === 'string');
					if (textCandidateRowList.length === 0) {
						unrepaired(UNREPAIRED_REASON.NO_IDS_ROW);
						return;
					}
					const repairPattern = repairPatternOf(oneValue);
					const matchingRowList = textCandidateRowList.filter((oneRow) => repairPattern.test(oneRow.valueByColumnName[sourceColumnName]));
					const distinctRepairedTextList = Array.from(new Set(matchingRowList.map((oneRow) => oneRow.valueByColumnName[sourceColumnName])));
					if (distinctRepairedTextList.length === 0) {
						unrepaired(UNREPAIRED_REASON.IDS_TEXT_DIFFERS);
						return;
					}
					if (distinctRepairedTextList.length > 1) {
						unrepaired(UNREPAIRED_REASON.AMBIGUOUS);
						return;
					}
					// the row that cites it: the first, in table then line order, among those carrying the one repaired text
					const citedRow = matchingRowList.slice().sort((left, right) => (left.tableName < right.tableName ? -1 : left.tableName > right.tableName ? 1 : left.lineNumberByColumnName[sourceColumnName] - right.lineNumberByColumnName[sourceColumnName]))[0];
					const repairStableId = layerIdentity.stableIdFor('repair', `${oneNode.propertyByName.cedsId}/${propertyName}/${valueOrdinal}`);
					nodeList.push({
						labels: ['CedsTextRepair'],
						stableId: repairStableId,
						role: DME_ROLES.TEXT_REPAIR,
						properties: {
							name: `${distinctRepairedTextList[0]}`.slice(0, 200),
							description: `Repaired ${propertyName} of CEDS ${oneNode.propertyByName.cedsId}: the ontology writes '${oneValue}' (U+FFFD replacement characters); the CEDS IDS v14 reference data writes '${distinctRepairedTextList[0]}'. The ontology's text is kept unchanged on the CEDS node; this repair rides beside it.`,
							repairedStableId: oneNode.stableId,
							repairedCedsId: oneNode.propertyByName.cedsId,
							repairedPropertyName: propertyName,
							repairedValueOrdinal: valueOrdinal,
							faithfulText: oneValue,
							repairedText: distinctRepairedTextList[0],
							replacementCharacterCount: oneValue.split(REPLACEMENT_CHARACTER).length - 1,
							repairSourceFileName: POPULATE_FILE_NAME,
							repairSourceSha256: populateSha256,
							repairSourceLineNumber: citedRow.lineNumberByColumnName[sourceColumnName],
							repairSourceStatementKind: citedRow.statementKindByColumnName[sourceColumnName],
							repairSourceTableName: citedRow.tableName,
							repairSourceColumnName: sourceColumnName,
							repairSourceCode: citedRow.code,
							repairRuleName: REPAIR_RULE_NAME,
						},
					});
					edgeList.push({ type: EDGE_TYPES.DECLARES_REPAIR, fromStableId: layerIdentity.layerRootStableId, toStableId: repairStableId, properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL } });
					edgeList.push({ type: EDGE_TYPES.REPAIRS_TEXT_OF, fromStableId: repairStableId, toStableId: oneNode.stableId, properties: { provenanceTier: PROVENANCE_TIER.SPEC_AUTHORITATIVE, repairedPropertyName: propertyName } });
				});
			}
		}
		const unrepairedCountByReason = unrepairedList.reduce((soFar, oneEntry) => ({ ...soFar, [oneEntry.reason]: (soFar[oneEntry.reason] || 0) + 1 }), {});
		callback('', {
			nodes: nodeList,
			edges: edgeList,
			rootPropertyByName: {
				repairRuleName: REPAIR_RULE_NAME,
				damagedTextCount: nodeList.length + unrepairedList.length,
				damagedNodeCount: damagedNodeStableIdSet.size,
				repairedTextCount: nodeList.length,
				unrepairedTextCount: unrepairedList.length,
				unrepairedCountByReasonText: JSON.stringify(unrepairedCountByReason),
				unrepairedTextListText: JSON.stringify(unrepairedList),
				idsReferenceRowCount: idsSource.referenceRowList.length,
				idsSkippedDuplicateInsertCount: idsSource.skippedInsertList.length,
			},
			layerReport: { unrepairedCountByReason },
		});
	});
};

module.exports = { layerDeclaration, produceLayer, REPAIR_SOURCE_COLUMN_BY_PROPERTY_NAME, REPLACEMENT_CHARACTER, repairPatternOf, DDL_FILE_NAME, POPULATE_FILE_NAME, UNREPAIRED_REASON };
