'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripValidator.js — the round trip of CEDS's `textRepair` layer (lane DES, 2026-10-12; TQ ruling 3).
//
// THE SOURCE SIDE recomputes the whole repair decision from the two IDS files AND THE LIVE BASE as the graph holds it: one
// Cypher read finds every ontology node whose text carries U+FFFD and the CEDS properties whose option set holds it
// (HAS_OPTION_SET -> HAS_VALUE, walked IN THE GRAPH, not through the producer's index). THE GRAPH SIDE reads what the layer
// asserts: each CedsTextRepair node (repaired text, faithful text, source table and line) and the root's list of what was
// left alone, with its reason. Statements:
//   repair|<stableId>|<property>|<position>|repairedText / faithfulText / source     for every repair
//   unrepaired|<stableId>|<property>|<position>                                     -> the reason, for every text left alone
// So a repair the rule does not license is INVENTED, a repair the rule licenses but the layer lacks is LOST, a faithfulText
// that no longer equals the live CEDS node is both, and an unlisted damaged text is LOST.

const path = require('path');
const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', 'lib');
const { validatorFor } = require(path.join(TREE_LIB, 'layer-framework', 'layerRoundTrip'))();
const { readIdsSource } = require('./lib/idsSource');
const { REPAIR_SOURCE_COLUMN_BY_PROPERTY_NAME, REPLACEMENT_CHARACTER, repairPatternOf, DDL_FILE_NAME, POPULATE_FILE_NAME, UNREPAIRED_REASON } = require('./forgeTextRepairLayer');

const VERDICT_VERSION = 'cedsTextRepairLayer-1';
const SEMANTIC_VALIDATION_LIMIT =
	'Models every U+FFFD-bearing ontology text in the materialized CEDS base (hub cards, text nodes, path and searchText ' +
	'excluded as derived copies) and the repair decision for each: recomputed from the CEDS IDS v14.0.0.0 DDL and reference ' +
	'script against option-set membership read live from the graph, compared with the repair nodes and the unrepaired list ' +
	'the layer carries. Does NOT model whether the IDS text is itself right; it models that the layer says exactly what the ' +
	'declared rule licenses, and that every repair\'s faithful text is still the live CEDS text.';

const DAMAGED_TEXT_QUERY_NAME = 'damagedOntologyText';
const DAMAGED_TEXT_CYPHER = `
	MATCH (n:StandardBase {_source:$source})
	WHERE NOT n:HubReference AND NOT n:HubDefinition AND n.role <> 'DmeEmbedText'
	WITH n, [propertyName IN keys(n) WHERE NOT propertyName IN ['path', 'searchText']
	        AND any(oneValue IN (CASE WHEN n[propertyName] IS :: LIST<ANY> THEN n[propertyName] ELSE [n[propertyName]] END)
	                WHERE oneValue IS :: STRING AND oneValue CONTAINS '\\uFFFD')] AS damagedPropertyNameList
	WHERE size(damagedPropertyNameList) > 0
	OPTIONAL MATCH (p:StandardBase {_source:$source, role:'DmeProperty'})-[:HAS_OPTION_SET]->(:StandardBase)-[:HAS_VALUE]->(n)
	RETURN n.stableId AS stableId, n.cedsId AS cedsId, n.role AS role, n.notation AS notation,
	       [propertyName IN damagedPropertyNameList | { propertyName: propertyName, propertyValue: n[propertyName] }] AS damagedPropertyList,
	       collect(DISTINCT p.cedsId) AS propertyCedsIdList
	ORDER BY stableId`;

const statement = (kind, value) => ({ kind, value: `${value}` });
const valueListOf = (propertyValue) => (Array.isArray(propertyValue) ? propertyValue : [propertyValue]);

const sourceStatementsOf = ({ snapshotPath, layerGraph }, callback) => {
	const damagedRowList = (layerGraph.baseQueryRowListByName || {})[DAMAGED_TEXT_QUERY_NAME];
	if (!Array.isArray(damagedRowList)) {
		callback(`${moduleName}: the graph read carries no '${DAMAGED_TEXT_QUERY_NAME}' rows — the source side needs the live base's damaged texts`);
		return;
	}
	readIdsSource({ ddlFilePath: path.join(snapshotPath, DDL_FILE_NAME), populateFilePath: path.join(snapshotPath, POPULATE_FILE_NAME) }, (readError, idsSource) => {
		if (readError) {
			callback(readError);
			return;
		}
		const rowListByPropertyIdAndCode = {};
		idsSource.referenceRowList.forEach((oneRow) =>
			(idsSource.globalIdListByTableName[oneRow.tableName] || []).forEach((globalId) => {
				const rowIdentity = `P${globalId}␟${oneRow.code}`;
				(rowListByPropertyIdAndCode[rowIdentity] = rowListByPropertyIdAndCode[rowIdentity] || []).push(oneRow);
			}),
		);
		const statementMap = new Map();
		damagedRowList.forEach((oneDamaged) => {
			oneDamaged.damagedPropertyList.forEach(({ propertyName, propertyValue }) =>
				valueListOf(propertyValue).forEach((oneValue, valueOrdinal) => {
					if (typeof oneValue !== 'string' || oneValue.indexOf(REPLACEMENT_CHARACTER) === -1) {
						return;
					}
					const textKey = `${oneDamaged.stableId}|${propertyName}|${valueOrdinal}`;
					const leaveAlone = (reason) => statementMap.set(`unrepaired|${textKey}`, statement('unrepaired', reason));
					if (oneDamaged.role !== 'DmeOptionValue') {
						leaveAlone(UNREPAIRED_REASON.NOT_AN_OPTION_VALUE);
						return;
					}
					const sourceColumnName = REPAIR_SOURCE_COLUMN_BY_PROPERTY_NAME[propertyName];
					if (sourceColumnName === undefined) {
						leaveAlone(UNREPAIRED_REASON.PROPERTY_NOT_REPAIRABLE_FROM_IDS);
						return;
					}
					const candidateRowList = [];
					oneDamaged.propertyCedsIdList.forEach((propertyCedsId) =>
						valueListOf(oneDamaged.notation)
							.filter((oneNotation) => typeof oneNotation === 'string')
							.forEach((oneNotation) => (rowListByPropertyIdAndCode[`${propertyCedsId}␟${oneNotation.trim()}`] || []).forEach((oneRow) => candidateRowList.push(oneRow))),
					);
					const withText = candidateRowList.filter((oneRow) => typeof oneRow.valueByColumnName[sourceColumnName] === 'string');
					if (withText.length === 0) {
						leaveAlone(UNREPAIRED_REASON.NO_IDS_ROW);
						return;
					}
					const repairPattern = repairPatternOf(oneValue);
					const matching = withText.filter((oneRow) => repairPattern.test(oneRow.valueByColumnName[sourceColumnName]));
					const distinctTextList = Array.from(new Set(matching.map((oneRow) => oneRow.valueByColumnName[sourceColumnName])));
					if (distinctTextList.length !== 1) {
						leaveAlone(distinctTextList.length === 0 ? UNREPAIRED_REASON.IDS_TEXT_DIFFERS : UNREPAIRED_REASON.AMBIGUOUS);
						return;
					}
					const cited = matching.slice().sort((left, right) => (left.tableName < right.tableName ? -1 : left.tableName > right.tableName ? 1 : left.lineNumberByColumnName[sourceColumnName] - right.lineNumberByColumnName[sourceColumnName]))[0];
					statementMap.set(`repair|${textKey}|repairedText`, statement('repair', distinctTextList[0]));
					statementMap.set(`repair|${textKey}|faithfulText`, statement('repair', oneValue));
					statementMap.set(`repair|${textKey}|source`, statement('repair', `${POPULATE_FILE_NAME}:${cited.tableName}:${cited.lineNumberByColumnName[sourceColumnName]}:${cited.code}`));
				}),
			);
		});
		callback('', statementMap);
	});
};

const graphStatementsOfLayer = ({ layerGraph }) => {
	const graphStatements = new Map();
	const rootNode = layerGraph.nodes.find((oneNode) => oneNode.role === 'DmeLayerRoot');
	if (!rootNode || typeof rootNode.properties.unrepairedTextListText !== 'string') {
		return { error: `${moduleName}: the layer has no root carrying unrepairedTextListText` };
	}
	JSON.parse(rootNode.properties.unrepairedTextListText).forEach((oneEntry) =>
		graphStatements.set(`unrepaired|${oneEntry.stableId}|${oneEntry.propertyName}|${oneEntry.valueOrdinal}`, statement('unrepaired', oneEntry.reason)),
	);
	const repairedStableIdByRepair = {};
	layerGraph.edges.filter((oneEdge) => oneEdge.type === 'REPAIRS_TEXT_OF').forEach((oneEdge) => {
		repairedStableIdByRepair[oneEdge.fromStableId] = oneEdge.toStableId;
	});
	layerGraph.nodes
		.filter((oneNode) => oneNode.role === 'DmeTextRepair')
		.forEach((oneRepair) => {
			const properties = oneRepair.properties;
			// the repaired node is named by the EDGE, so a repair whose edge points elsewhere keys elsewhere
			const textKey = `${repairedStableIdByRepair[oneRepair.stableId]}|${properties.repairedPropertyName}|${properties.repairedValueOrdinal}`;
			graphStatements.set(`repair|${textKey}|repairedText`, statement('repair', properties.repairedText));
			graphStatements.set(`repair|${textKey}|faithfulText`, statement('repair', properties.faithfulText));
			graphStatements.set(`repair|${textKey}|source`, statement('repair', `${properties.repairSourceFileName}:${properties.repairSourceTableName}:${properties.repairSourceLineNumber}:${properties.repairSourceCode}`));
		});
	return { graphStatements };
};

// baseQueryRowsOfNodeEdges — the Docker-free double of DAMAGED_TEXT_CYPHER over engine-shape base nodeEdges (the suites'
// path; the live gate runs the Cypher itself)
const baseQueryRowsOfNodeEdges = ({ baseNodeEdges }) => {
	const unwrap = (propertyValue) => (Array.isArray(propertyValue) && propertyValue.length === 1 ? propertyValue[0] : propertyValue);
	const setStableIdListByValue = {};
	const propertyStableIdListBySet = {};
	baseNodeEdges.edges.forEach((oneEdge) => {
		if (oneEdge.type === 'HAS_VALUE') {
			(setStableIdListByValue[oneEdge.toRef.id] = setStableIdListByValue[oneEdge.toRef.id] || []).push(oneEdge.fromRef.id);
		} else if (oneEdge.type === 'HAS_OPTION_SET') {
			(propertyStableIdListBySet[oneEdge.toRef.id] = propertyStableIdListBySet[oneEdge.toRef.id] || []).push(oneEdge.fromRef.id);
		}
	});
	const nodeByStableId = {};
	baseNodeEdges.nodes.forEach((oneNode) => {
		nodeByStableId[oneNode.stableId] = oneNode;
	});
	const rowList = [];
	baseNodeEdges.nodes.forEach((oneNode) => {
		const role = unwrap(oneNode.properties.role);
		if (oneNode.labels.indexOf('HubReference') !== -1 || oneNode.labels.indexOf('HubDefinition') !== -1 || role === 'DmeEmbedText') {
			return;
		}
		const damagedPropertyList = Object.keys(oneNode.properties)
			.filter((propertyName) => ['path', 'searchText'].indexOf(propertyName) === -1)
			.filter((propertyName) => valueListOf(unwrap(oneNode.properties[propertyName])).some((oneValue) => typeof oneValue === 'string' && oneValue.indexOf(REPLACEMENT_CHARACTER) !== -1))
			.map((propertyName) => ({ propertyName, propertyValue: unwrap(oneNode.properties[propertyName]) }));
		if (!damagedPropertyList.length) {
			return;
		}
		const propertyCedsIdList = Array.from(new Set((setStableIdListByValue[oneNode.stableId] || []).flatMap((setStableId) => (propertyStableIdListBySet[setStableId] || []).map((propertyStableId) => unwrap(nodeByStableId[propertyStableId].properties.cedsId)))));
		rowList.push({ stableId: oneNode.stableId, cedsId: unwrap(oneNode.properties.cedsId), role, notation: unwrap(oneNode.properties.notation), damagedPropertyList, propertyCedsIdList });
	});
	return { [DAMAGED_TEXT_QUERY_NAME]: rowList };
};

const validatorApi = validatorFor({
	standardSource: 'CEDS',
	layerKey: 'textRepair',
	verdictVersion: VERDICT_VERSION,
	semanticValidationLimit: SEMANTIC_VALIDATION_LIMIT,
	sourceFileList: [DDL_FILE_NAME, POPULATE_FILE_NAME],
	baseQueryList: [{ queryName: DAMAGED_TEXT_QUERY_NAME, cypherText: DAMAGED_TEXT_CYPHER }],
	sourceStatementsOf,
	graphStatementsOf: ({ layerGraph }) => graphStatementsOfLayer({ layerGraph }),
});

module.exports = { validate: validatorApi.validate, validateWithLayerGraph: validatorApi.validateWithLayerGraph, graphStatementsOfLayer, baseQueryRowsOfNodeEdges, VERDICT_VERSION };
