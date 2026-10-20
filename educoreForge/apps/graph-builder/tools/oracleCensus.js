#!/usr/bin/env node
'use strict';

// oracleCensus.js — freeze a family of standards in an already-built graph into file-based censuses (ctdlHub-101926 P0).
// READ-ONLY: one READ session, every query under a server-side transaction timeout. Later gates diff a forge's emitted
// {nodes, edges} against these files instead of against a live database, so the graph only has to be mounted once.
//
// Run: node apps/graph-builder/tools/oracleCensus.js --containerName=<container> --familySourceList=CTDL,CTDLASN,CTDLQData
//          --hubSourceName=CEDS --outputDirectoryPath=<dir> --graphLabel=GOLD_EVAL_260718

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- census of a family of standards in a built graph, written as one JSON file per standard (read-only)

SYNOPSIS
     ${moduleName} --containerName=<running graph container> --familySourceList=<_source,...> --hubSourceName=<_source>
                   --outputDirectoryPath=<dir> --graphLabel=<name of the graph the container holds> [-help]

DESCRIPTION
     Reads the bolt port and credential from the container (docker inspect), opens ONE READ session and reads every node
     whose _source is in the family, and every edge touching one. It never writes to the graph. It writes, into
     --outputDirectoryPath:

       <_source>.census.json        per family standard:
           nodes               {stableId, labels (sorted), role, properties (every property except 'embedding'; names sorted)}
           intraEdges          {type, from, to, properties}, both ends in this standard
           familyEdges         edges whose ends are in two different family standards, grouped by pair (pair names
                               ordered as --familySourceList orders them), with a count per pair; a standard's file holds
                               the pairs it takes part in
           hubEdges            edges between this standard and --hubSourceName, either direction
           otherExternalEdges  edges between this standard and any other _source (expected empty; reported, not assumed)
           propertyNameCensus  per role, each property name and how many nodes carry it
       <graphLabel>.inventory.json      node count per _source for the WHOLE graph (null _source reported as '(none)')

     Neo4j integers are written as JS numbers; every list is sorted, so two runs over the same graph write identical bytes.

EXIT STATUS
     0 written;  1 refused (missing argument, unreachable container, failed query).

EXAMPLES
     node apps/graph-builder/tools/oracleCensus.js --containerName=DEV_ctdlOracle260718 --familySourceList=CTDL,CTDLASN,CTDLQData \\
          --hubSourceName=CEDS --outputDirectoryPath=../../dataStores/ctdlHub_101926/oracle --graphLabel=GOLD_EVAL_260718

NOTES
     --graphLabel names the graph, not the container: a census of a COPY (DEV_ctdlOracle260718 mounts a copy of the
     volume GOLD_EVAL_260718_data) is labelled with the graph it copies. Both names are written into every file.
`;

const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;
const neo4j = require('neo4j-driver');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const { resolveContainerBolt } = require(path.join(TREE_ROOT, 'forges', 'ceds', 'lib', 'roundTripCompiler'))();

const TRANSACTION_TIMEOUT_MS = 120000;
const EXCLUDED_PROPERTY_NAME_LIST = Object.freeze(['embedding']);
const NULL_SOURCE_LABEL = '(none)';

const NODE_CYPHER = 'MATCH (n) WHERE n._source IN $familySourceList RETURN n._source AS sourceName, labels(n) AS labelList, properties(n) AS propertyMap';
const EDGE_CYPHER = `MATCH (a)-[r]->(b) WHERE a._source IN $familySourceList OR b._source IN $familySourceList
	RETURN type(r) AS edgeType, a.stableId AS fromStableId, a._source AS fromSourceName, b.stableId AS toStableId, b._source AS toSourceName, properties(r) AS propertyMap`;
const INVENTORY_CYPHER = 'MATCH (n) RETURN n._source AS sourceName, count(n) AS nodeCount';

const flagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};
const requiredFlagNameList = ['containerName', 'familySourceList', 'hubSourceName', 'outputDirectoryPath', 'graphLabel'];
const absentFlagNameList = requiredFlagNameList.filter((flagName) => typeof flagValueOf(flagName) !== 'string' || flagValueOf(flagName) === '');
if (absentFlagNameList.length !== 0) {
	xLog.error(`${moduleName}: REFUSED: required and absent: ${absentFlagNameList.map((flagName) => `--${flagName}`).join(', ')}. There are no defaults.\n(${moduleName} -help for the full page)`);
	process.exit(1);
}
const containerName = flagValueOf('containerName');
// qtools-parse-command-line already splits a comma list into the values array; joining and re-splitting accepts either form
const familySourceList = [].concat(commandLineParameters.values.familySourceList).join(',').split(',');
const hubSourceName = flagValueOf('hubSourceName');
const graphLabel = flagValueOf('graphLabel');
const outputDirectoryPath = path.resolve(flagValueOf('outputDirectoryPath'));
if (!fs.existsSync(outputDirectoryPath)) {
	xLog.error(`${moduleName}: REFUSED: --outputDirectoryPath '${outputDirectoryPath}' does not exist; it is not created on your behalf.`);
	process.exit(1);
}

// neo4j-driver returns Integer objects (nested inside lists too); the census holds plain numbers
const plainValueOf = (graphValue) => {
	if (neo4j.isInt(graphValue)) {
		return graphValue.toNumber();
	}
	if (Array.isArray(graphValue)) {
		return graphValue.map(plainValueOf);
	}
	return graphValue;
};
const sortedPropertyMapOf = (propertyMap) => Object.keys(propertyMap)
	.filter((propertyName) => !EXCLUDED_PROPERTY_NAME_LIST.includes(propertyName))
	.sort()
	.reduce((sortedMap, propertyName) => ({ ...sortedMap, [propertyName]: plainValueOf(propertyMap[propertyName]) }), {});

const compareText = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);
const edgeSortText = (oneEdge) => `${oneEdge.type}\u0000${oneEdge.from}\u0000${oneEdge.to}\u0000${JSON.stringify(oneEdge.properties)}`;
const sortEdgeList = (edgeList) => [...edgeList].sort((leftEdge, rightEdge) => compareText(edgeSortText(leftEdge), edgeSortText(rightEdge)));
const familyPairNameOf = (firstSourceName, secondSourceName) => [firstSourceName, secondSourceName]
	.sort((leftName, rightName) => familySourceList.indexOf(leftName) - familySourceList.indexOf(rightName))
	.join('::');

const censusOfStandard = ({ sourceName, nodeRowList, edgeRowList }) => {
	const nodeList = nodeRowList
		.filter((oneRow) => oneRow.sourceName === sourceName)
		.map((oneRow) => ({ stableId: oneRow.propertyMap.stableId, labels: [...oneRow.labelList].sort(), role: oneRow.propertyMap.role, properties: sortedPropertyMapOf(oneRow.propertyMap) }))
		.sort((leftNode, rightNode) => compareText(leftNode.stableId, rightNode.stableId));
	const touchingEdgeRowList = edgeRowList.filter((oneRow) => oneRow.fromSourceName === sourceName || oneRow.toSourceName === sourceName);
	const otherEndSourceOf = (oneRow) => (oneRow.fromSourceName === sourceName ? oneRow.toSourceName : oneRow.fromSourceName);
	const edgeOf = (oneRow) => ({ type: oneRow.edgeType, from: oneRow.fromStableId, fromSource: oneRow.fromSourceName, to: oneRow.toStableId, toSource: oneRow.toSourceName, properties: sortedPropertyMapOf(oneRow.propertyMap) });

	const intraEdgeList = touchingEdgeRowList.filter((oneRow) => oneRow.fromSourceName === sourceName && oneRow.toSourceName === sourceName).map(edgeOf);
	const familyEdgeRowList = touchingEdgeRowList.filter((oneRow) => otherEndSourceOf(oneRow) !== sourceName && familySourceList.includes(otherEndSourceOf(oneRow)));
	const familyEdgesByPair = familyEdgeRowList.reduce((byPair, oneRow) => {
		const pairName = familyPairNameOf(oneRow.fromSourceName, oneRow.toSourceName);
		return { ...byPair, [pairName]: [...(byPair[pairName] || []), edgeOf(oneRow)] };
	}, {});
	const familyEdges = Object.keys(familyEdgesByPair).sort().reduce((byPair, pairName) => ({ ...byPair, [pairName]: { count: familyEdgesByPair[pairName].length, edgeList: sortEdgeList(familyEdgesByPair[pairName]) } }), {});
	const hubEdgeList = touchingEdgeRowList.filter((oneRow) => otherEndSourceOf(oneRow) === hubSourceName).map(edgeOf);
	const otherExternalEdgeList = touchingEdgeRowList
		.filter((oneRow) => otherEndSourceOf(oneRow) !== sourceName && otherEndSourceOf(oneRow) !== hubSourceName && !familySourceList.includes(otherEndSourceOf(oneRow)))
		.map(edgeOf);

	const propertyNameCensus = nodeList.reduce((byRole, oneNode) => {
		const roleCensus = byRole[oneNode.role] || {};
		const nextRoleCensus = Object.keys(oneNode.properties).reduce((counts, propertyName) => ({ ...counts, [propertyName]: (counts[propertyName] || 0) + 1 }), roleCensus);
		return { ...byRole, [oneNode.role]: nextRoleCensus };
	}, {});
	const countByType = (edgeList) => edgeList.reduce((counts, oneEdge) => ({ ...counts, [oneEdge.type]: (counts[oneEdge.type] || 0) + 1 }), {});

	return {
		sourceName,
		graphLabel,
		containerName,
		summary: {
			nodeCount: nodeList.length,
			nodeCountByRole: nodeList.reduce((counts, oneNode) => ({ ...counts, [oneNode.role]: (counts[oneNode.role] || 0) + 1 }), {}),
			intraEdgeCount: intraEdgeList.length,
			intraEdgeCountByType: countByType(intraEdgeList),
			familyEdgeCountByPair: Object.keys(familyEdges).reduce((counts, pairName) => ({ ...counts, [pairName]: familyEdges[pairName].count }), {}),
			hubEdgeCount: hubEdgeList.length,
			hubEdgeCountByType: countByType(hubEdgeList),
			otherExternalEdgeCount: otherExternalEdgeList.length,
		},
		nodes: nodeList,
		intraEdges: sortEdgeList(intraEdgeList),
		familyEdges,
		hubSourceName,
		hubEdges: sortEdgeList(hubEdgeList),
		otherExternalEdges: sortEdgeList(otherExternalEdgeList),
		propertyNameCensus,
	};
};

const readRowList = ({ timedSession, cypherText, cypherParameters, rowOf }, callback) => timedSession.run(cypherText, cypherParameters).then(
	(queryResult) => callback('', queryResult.records.map(rowOf)),
	(queryError) => callback(`${moduleName}: query failed: ${queryError.message}`),
);

const taskList = new taskListPlus();
taskList.push((args, next) => resolveContainerBolt({ containerName }, (resolveError, resolved) => next(resolveError ? `${moduleName}: ${resolveError}` : '', { ...args, resolved })));
taskList.push((args, next) => {
	const driver = neo4j.driver(args.resolved.boltUrl, neo4j.auth.basic(args.resolved.user, args.resolved.password), { encrypted: false });
	const session = driver.session({ defaultAccessMode: neo4j.session.READ });
	const timedSession = { run: (cypherText, cypherParameters) => session.run(cypherText, cypherParameters, { timeout: TRANSACTION_TIMEOUT_MS }) };
	next('', { ...args, driver, session, timedSession });
});
taskList.push((args, next) => readRowList({
	timedSession: args.timedSession, cypherText: NODE_CYPHER, cypherParameters: { familySourceList },
	rowOf: (oneRecord) => ({ sourceName: oneRecord.get('sourceName'), labelList: oneRecord.get('labelList'), propertyMap: oneRecord.get('propertyMap') }),
}, (readError, nodeRowList) => next(readError, { ...args, nodeRowList })));
taskList.push((args, next) => readRowList({
	timedSession: args.timedSession, cypherText: EDGE_CYPHER, cypherParameters: { familySourceList },
	rowOf: (oneRecord) => ({
		edgeType: oneRecord.get('edgeType'), fromStableId: oneRecord.get('fromStableId'), fromSourceName: oneRecord.get('fromSourceName'),
		toStableId: oneRecord.get('toStableId'), toSourceName: oneRecord.get('toSourceName'), propertyMap: oneRecord.get('propertyMap'),
	}),
}, (readError, edgeRowList) => next(readError, { ...args, edgeRowList })));
taskList.push((args, next) => readRowList({
	timedSession: args.timedSession, cypherText: INVENTORY_CYPHER, cypherParameters: {},
	rowOf: (oneRecord) => ({ sourceName: oneRecord.get('sourceName') === null ? NULL_SOURCE_LABEL : oneRecord.get('sourceName'), nodeCount: plainValueOf(oneRecord.get('nodeCount')) }),
}, (readError, inventoryRowList) => next(readError, { ...args, inventoryRowList })));
taskList.push((args, next) => {
	const absentSourceList = familySourceList.filter((sourceName) => !args.nodeRowList.some((oneRow) => oneRow.sourceName === sourceName));
	if (absentSourceList.length !== 0) {
		next(`${moduleName}: the graph holds no node with _source ${absentSourceList.join(', ')}; a census of nothing is refused (check the casing)`, args);
		return;
	}
	const censusList = familySourceList.map((sourceName) => censusOfStandard({ sourceName, nodeRowList: args.nodeRowList, edgeRowList: args.edgeRowList }));
	next('', { ...args, censusList });
});

pipeRunner(taskList.getList(), {}, (pipeError, args) => {
	const closeThen = (afterClose) => (args && args.session ? args.session.close().then(() => args.driver.close()).then(afterClose, afterClose) : afterClose());
	closeThen(() => {
		if (pipeError) {
			xLog.error(`${moduleName}: REFUSED: ${pipeError}`);
			process.exit(1);
		}
		args.censusList.forEach((oneCensus) => {
			const censusFilePath = path.join(outputDirectoryPath, `${oneCensus.sourceName}.census.json`);
			fs.writeFileSync(censusFilePath, `${JSON.stringify(oneCensus, null, 1)}\n`);
			xLog.result(`${moduleName}: ${oneCensus.sourceName} ${JSON.stringify(oneCensus.summary)}\n  wrote ${censusFilePath}\n`);
		});
		const inventory = args.inventoryRowList
			.sort((leftRow, rightRow) => compareText(leftRow.sourceName, rightRow.sourceName))
			.reduce((counts, oneRow) => ({ ...counts, [oneRow.sourceName]: oneRow.nodeCount }), {});
		const inventoryFilePath = path.join(outputDirectoryPath, `${graphLabel}.inventory.json`);
		fs.writeFileSync(inventoryFilePath, `${JSON.stringify({ graphLabel, containerName, nodeCountBySource: inventory }, null, 2)}\n`);
		xLog.result(`${moduleName}: wrote ${inventoryFilePath}\n`);
		process.exit(0);
	});
});
