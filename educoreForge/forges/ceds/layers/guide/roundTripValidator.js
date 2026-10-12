'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripValidator.js — the round trip of CEDS's `guide` layer (lane DES, 2026-10-12): every cell of the three Appendix A
// TSVs, rebuilt FROM THE GRAPH and compared cell by cell.
//
// The graph side rebuilds Table A-1 from the HAS_PRIMARY_CONCEPT / HAS_SECONDARY_CONCEPT edges (class id from the BASE class
// the edge leaves, concept from the concept node it reaches, the em dash where no secondary edge exists), Table A-2 from the
// HAS_EVENT_DATE_CONCEPT edges (concepts joined in conceptOrdinal order), and the concept list from the concept nodes. So a
// missing, extra or misdirected edge is a wrong cell. Statements are keyed '<table>|<row id>|<field>'.

const path = require('path');
const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', 'lib');
const { validatorFor } = require(path.join(TREE_LIB, 'layer-framework', 'layerRoundTrip'))();
const { readGuideTables, GUIDE_TABLE_LIST, NO_SECONDARY_CONCEPT_TEXT, CONCEPT_LIST_SEPARATOR } = require('./lib/guideTables');

const VERDICT_VERSION = 'cedsGuideLayer-1';
const SEMANTIC_VALIDATION_LIMIT =
	'Models every cell of the three TSVs extracted from Appendix A of the CEDS Ontology Guide Version 14 (concepts, Table A-1, ' +
	'Table A-2), keyed by concept name, class id or property id. Does NOT model the PDF itself: the TSVs are the declared ' +
	'source, extracted by tools/extractGuideAppendixA.py and checked by eye against the rendered PDF (pages 6, 24, 25, 40, 49) ' +
	'on 2026-10-12. Row ORDER is carried (rowOrdinal) and compared.';

const statement = (kind, value) => ({ kind, value: `${value}` });

const sourceStatementsOf = ({ snapshotPath }, callback) => {
	readGuideTables({ snapshotPath }, (readError, guideTables) => {
		if (readError) {
			callback(readError);
			return;
		}
		const statementMap = new Map();
		const rowListByTableName = { concept: guideTables.conceptRowList, classConcept: guideTables.classRowList, dateEventProperty: guideTables.dateRowList };
		GUIDE_TABLE_LIST.forEach((guideTable) => {
			// a row's id is its second field in every guide table (conceptName, classId, propertyId)
			const idFieldName = guideTable.fieldList[1];
			rowListByTableName[guideTable.tableName].forEach((oneRow) => {
				guideTable.fieldList.concat(['rowOrdinal']).forEach((fieldName) => statementMap.set(`${guideTable.tableName}|${oneRow[idFieldName]}|${fieldName}`, statement('cell', oneRow[fieldName])));
			});
		});
		callback('', statementMap);
	});
};

const graphStatementsOfLayer = ({ layerGraph }) => {
	const nodeByStableId = {};
	layerGraph.nodes.forEach((oneNode) => {
		nodeByStableId[oneNode.stableId] = oneNode;
	});
	const graphStatements = new Map();
	const conceptOrdinalByName = {};
	layerGraph.nodes
		.filter((oneNode) => oneNode.role === 'DmeConcept')
		.sort((left, right) => left.properties.conceptOrdinal - right.properties.conceptOrdinal)
		.forEach((oneConcept) => {
			const rowStatementPrefix = `concept|${oneConcept.properties.name}`;
			conceptOrdinalByName[oneConcept.properties.name] = oneConcept.properties.conceptOrdinal;
			graphStatements.set(`${rowStatementPrefix}|conceptOrdinal`, statement('cell', oneConcept.properties.conceptOrdinal));
			graphStatements.set(`${rowStatementPrefix}|conceptName`, statement('cell', oneConcept.properties.name));
			graphStatements.set(`${rowStatementPrefix}|conceptDefinition`, statement('cell', oneConcept.properties.definition));
			graphStatements.set(`${rowStatementPrefix}|guidePageNumber`, statement('cell', oneConcept.properties.guidePageNumber));
			graphStatements.set(`${rowStatementPrefix}|rowOrdinal`, statement('cell', oneConcept.properties.guideRowOrdinal));
		});
	const conceptNameOf = (stableId) => (nodeByStableId[stableId] ? nodeByStableId[stableId].properties.name : `(no concept ${stableId})`);
	const cedsIdOf = (stableId) => (layerGraph.baseEndpointByStableId[stableId] || {}).cedsId;
	const dateEdgeListByProperty = {};
	for (const oneEdge of layerGraph.edges) {
		const properties = oneEdge.properties;
		if (oneEdge.type === 'HAS_PRIMARY_CONCEPT' || oneEdge.type === 'HAS_SECONDARY_CONCEPT') {
			const rowStatementPrefix = `classConcept|${cedsIdOf(oneEdge.fromStableId)}`;
			graphStatements.set(`${rowStatementPrefix}|className`, statement('cell', properties.guideClassName));
			graphStatements.set(`${rowStatementPrefix}|classId`, statement('cell', cedsIdOf(oneEdge.fromStableId)));
			graphStatements.set(`${rowStatementPrefix}|${oneEdge.type === 'HAS_PRIMARY_CONCEPT' ? 'primaryConcept' : 'secondaryConcept'}`, statement('cell', conceptNameOf(oneEdge.toStableId)));
			graphStatements.set(`${rowStatementPrefix}|guidePageNumber`, statement('cell', properties.guidePageNumber));
			graphStatements.set(`${rowStatementPrefix}|rowOrdinal`, statement('cell', properties.guideRowOrdinal));
		} else if (oneEdge.type === 'HAS_EVENT_DATE_CONCEPT') {
			(dateEdgeListByProperty[oneEdge.fromStableId] = dateEdgeListByProperty[oneEdge.fromStableId] || []).push(oneEdge);
		}
	}
	// a class with no secondary edge: the guide's em dash
	Array.from(graphStatements.keys()).forEach((oneKey) => {
		const [tableName, classId, fieldName] = oneKey.split('|');
		if (tableName === 'classConcept' && fieldName === 'primaryConcept' && !graphStatements.has(`classConcept|${classId}|secondaryConcept`)) {
			graphStatements.set(`classConcept|${classId}|secondaryConcept`, statement('cell', NO_SECONDARY_CONCEPT_TEXT));
		}
	});
	Object.keys(dateEdgeListByProperty).forEach((propertyStableId) => {
		const edgeList = dateEdgeListByProperty[propertyStableId].slice().sort((left, right) => left.properties.conceptOrdinal - right.properties.conceptOrdinal);
		const propertyId = cedsIdOf(propertyStableId);
		const rowStatementPrefix = `dateEventProperty|${propertyId}`;
		const firstProperties = edgeList[0].properties;
		graphStatements.set(`${rowStatementPrefix}|propertyName`, statement('cell', firstProperties.guidePropertyName));
		graphStatements.set(`${rowStatementPrefix}|propertyId`, statement('cell', propertyId));
		graphStatements.set(`${rowStatementPrefix}|classText`, statement('cell', firstProperties.guideClassText));
		graphStatements.set(`${rowStatementPrefix}|conceptText`, statement('cell', edgeList.map((oneEdge) => conceptNameOf(oneEdge.toStableId)).join(CONCEPT_LIST_SEPARATOR)));
		graphStatements.set(`${rowStatementPrefix}|guidePageNumber`, statement('cell', firstProperties.guidePageNumber));
		graphStatements.set(`${rowStatementPrefix}|rowOrdinal`, statement('cell', firstProperties.guideRowOrdinal));
	});
	return { graphStatements };
};

const validatorApi = validatorFor({
	standardSource: 'CEDS',
	layerKey: 'guide',
	verdictVersion: VERDICT_VERSION,
	semanticValidationLimit: SEMANTIC_VALIDATION_LIMIT,
	sourceFileList: GUIDE_TABLE_LIST.map((guideTable) => guideTable.fileName).concat(['CEDS_Ontology_Guide_Version_14.pdf']),
	sourceStatementsOf: ({ snapshotPath }, callback) => sourceStatementsOf({ snapshotPath }, callback),
	graphStatementsOf: ({ layerGraph }) => graphStatementsOfLayer({ layerGraph }),
});

module.exports = { validate: validatorApi.validate, validateWithLayerGraph: validatorApi.validateWithLayerGraph, graphStatementsOfLayer, VERDICT_VERSION };
