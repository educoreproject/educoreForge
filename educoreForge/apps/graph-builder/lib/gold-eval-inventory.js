'use strict';

// gold-eval-inventory.js — the -goldEvalCheck STANDARD-INVENTORY PROMOTION GATE (ctdlHub-101926 P8, WORKORDER-P8 step 1).
//
// WHY IT EXISTS. A DEV promotion once dropped CTDL from the gold lineage without anyone deciding to (STUDY-ctdlSecondHub
// risk 2; PLAN-ctdlHub §5 risk 6): GOLD_260718 held CTDL, and every later GOLD_EVAL_* did not. Nothing compared what a
// candidate holds with what it replaces. This gate does, and REFUSES BY NAME listing every standard and every hub the
// predecessor holds that the candidate lacks. What the candidate ADDS is reported, never refused.
//
// THE INVENTORY, as the work order defines it: the distinct `_source` on standard roots (:DmeStandardRoot), plus the
// HubDefinitions (by hubName). Two DIMENSIONS, each declared below as data with the cypher that reads it.
//
// WHERE EACH SIDE COMES FROM.
//   candidate    ALWAYS read live from its running container (--containerName), and only after the graph's ONE
//                GraphProvenance is shown to name the manifest under certification: an inventory of some other graph
//                would certify nothing about this one.
//   predecessor  --supersedes=<containerName>[,<containerName>...]. Read LIVE from each named running container, OR —
//                when --supersedesInventoryDirectoryPath names a directory — from <dir>/<containerName>.inventory.json
//                for EVERY predecessor. The two sources are never mixed in one run and never chosen silently: the
//                directory flag decides. A file exists so a production graph's inventory can be checked without ever
//                mounting its volume (P0's GOLD_EVAL_260718.inventory.json is the first such file).
//   --supersedes=none  the explicit statement that this graph supersedes nothing. It must stand alone.
//
// AN UNMEASURED DIMENSION REFUSES. P0's oracleCensus inventory file carries node counts per _source and NO hub list.
// Reading its absent hub list as 'no hubs' would let a hub drop pass unseen, so a dimension a file does not carry is
// UNMEASURED and named in the refusal — the same rule as a missing member, because the promoter learns the same thing:
// this candidate has not been shown to hold what its predecessor held.
//
// READ-ONLY. It runs three READ queries per live graph (roots, hubs, passport) and reads files; no write, no spend.

const path = require('path');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const moduleName = 'gold-eval-inventory';

const SUPERSEDES_NONE_TOKEN = 'none';
const INVENTORY_FILE_SUFFIX = '.inventory.json';

// the inventory's dimensions — what is compared, and the cypher that reads each from a live graph (inventoryName is the
// one column every dimension returns, so the comparison is dimension-blind)
const INVENTORY_DIMENSION_LIST = Object.freeze([
	Object.freeze({ dimensionName: 'standard', description: 'distinct _source on :DmeStandardRoot', readCypherText: 'MATCH (oneRoot:DmeStandardRoot) RETURN DISTINCT oneRoot._source AS inventoryName' }),
	Object.freeze({ dimensionName: 'hub', description: 'HubDefinition hubName', readCypherText: 'MATCH (oneHub:HubDefinition) RETURN DISTINCT oneHub.hubName AS inventoryName' }),
]);
const PASSPORT_CYPHER_TEXT = 'MATCH (onePassport:GraphProvenance) RETURN onePassport.manifestRefId AS manifestRefId, onePassport.graphName AS graphName';

// the inventory FILE shapes this gate reads, as data. A shape is recognised by its signature field; a dimension it does not
// carry is UNMEASURED. form 'nameList' is a JSON array of names; form 'countByName' is an object of name → node count,
// whose names with a positive count are the members and whose excludedNameList are census labels, not members.
const INVENTORY_FILE_SHAPE_LIST = Object.freeze([
	Object.freeze({
		shapeName: 'inventoryGate',
		signatureFieldName: 'standardSourceList',
		graphNameFieldName: 'graphName',
		fieldByDimensionName: Object.freeze({ standard: Object.freeze({ fieldName: 'standardSourceList', form: 'nameList' }), hub: Object.freeze({ fieldName: 'hubNameList', form: 'nameList' }) }),
	}),
	Object.freeze({
		// apps/graph-builder/tools/oracleCensus.js writes this (P0): node count per _source over the WHOLE graph, a null
		// _source counted under its NULL_SOURCE_LABEL '(none)'. It is a census of nodes, not of roots — said in every report.
		shapeName: 'oracleCensus',
		signatureFieldName: 'nodeCountBySource',
		graphNameFieldName: 'graphLabel',
		fieldByDimensionName: Object.freeze({ standard: Object.freeze({ fieldName: 'nodeCountBySource', form: 'countByName', excludedNameList: Object.freeze(['(none)']) }) }),
	}),
]);

const sortedDistinct = (nameList) => nameList.filter((oneName, nameIndex) => nameList.indexOf(oneName) === nameIndex).sort();

// ---------------------------------------------------------------------------------------------------------------------
// --supersedes
// ---------------------------------------------------------------------------------------------------------------------
const parseSupersedesList = (rawSupersedesList) => {
	const refusalOf = (refusalText) => ({ error: `${moduleName}: REFUSED — ${refusalText}`, supersedesNone: false, predecessorNameList: [] });
	if (!Array.isArray(rawSupersedesList) || rawSupersedesList.length === 0) {
		return refusalOf(
			`--supersedes=<containerName>[,<containerName>...] is REQUIRED for a graph whose recipe permits promotion, and has no ` +
				`default: a promotion must name what it supersedes so the inventory gate can show nothing was dropped, or say ` +
				`--supersedes=${SUPERSEDES_NONE_TOKEN}.`,
		);
	}
	const emptyValueList = rawSupersedesList.filter((oneValue) => typeof oneValue !== 'string' || oneValue.trim() === '');
	if (emptyValueList.length) {
		return refusalOf(`--supersedes was given ${emptyValueList.length} empty or non-string value(s); a blank names no predecessor and is refused rather than dropped.`);
	}
	const nameList = rawSupersedesList.map((oneValue) => oneValue.trim());
	if (nameList.indexOf(SUPERSEDES_NONE_TOKEN) !== -1) {
		if (nameList.length !== 1) {
			return refusalOf(`--supersedes names '${SUPERSEDES_NONE_TOKEN}' beside ${nameList.length - 1} predecessor(s); '${SUPERSEDES_NONE_TOKEN}' must stand alone.`);
		}
		return { error: '', supersedesNone: true, predecessorNameList: [] };
	}
	const repeatedNameList = sortedDistinct(nameList.filter((oneName, nameIndex) => nameList.indexOf(oneName) !== nameIndex));
	if (repeatedNameList.length) {
		return refusalOf(`--supersedes names a predecessor more than once: ${repeatedNameList.join(', ')}.`);
	}
	return { error: '', supersedesNone: false, predecessorNameList: nameList };
};

// ---------------------------------------------------------------------------------------------------------------------
// inventory files
// ---------------------------------------------------------------------------------------------------------------------
const namesOfField = ({ fieldDeclaration, fieldContent }) => {
	if (fieldDeclaration.form === 'nameList') {
		return Array.isArray(fieldContent) ? { nameList: sortedDistinct(fieldContent.map(String)) } : { error: `field '${fieldDeclaration.fieldName}' is not a list` };
	}
	if (fieldContent === null || typeof fieldContent !== 'object' || Array.isArray(fieldContent)) {
		return { error: `field '${fieldDeclaration.fieldName}' is not an object of name → count` };
	}
	const excludedNameList = fieldDeclaration.excludedNameList;
	return { nameList: sortedDistinct(Object.keys(fieldContent).filter((oneName) => excludedNameList.indexOf(oneName) === -1 && fieldContent[oneName] > 0)) };
};

const inventoryFromFileText = ({ inventoryFilePath, fileText }) => {
	let parsedFile;
	// boundary translation: an inventory file is evidence entering from disk; a parse fault is named, never thrown
	try {
		parsedFile = JSON.parse(fileText);
	} catch (parseError) {
		return { error: `${moduleName}: REFUSED — the inventory file ${inventoryFilePath} does not parse (${parseError.message}).` };
	}
	if (parsedFile === null || typeof parsedFile !== 'object' || Array.isArray(parsedFile)) {
		return { error: `${moduleName}: REFUSED — the inventory file ${inventoryFilePath} is not a JSON object.` };
	}
	const matchedShapeList = INVENTORY_FILE_SHAPE_LIST.filter((oneShape) => Object.prototype.hasOwnProperty.call(parsedFile, oneShape.signatureFieldName));
	if (matchedShapeList.length !== 1) {
		return {
			error:
				`${moduleName}: REFUSED — the inventory file ${inventoryFilePath} matches ${matchedShapeList.length === 0 ? 'no declared inventory file shape' : `${matchedShapeList.length} declared inventory file shapes`} ` +
				`(declared: ${INVENTORY_FILE_SHAPE_LIST.map((oneShape) => `${oneShape.shapeName} by '${oneShape.signatureFieldName}'`).join('; ')}).`,
		};
	}
	const fileShape = matchedShapeList[0];
	const graphName = parsedFile[fileShape.graphNameFieldName];
	if (typeof graphName !== 'string' || graphName === '') {
		return { error: `${moduleName}: REFUSED — the inventory file ${inventoryFilePath} (shape ${fileShape.shapeName}) names no graph in '${fileShape.graphNameFieldName}'.` };
	}
	const nameListByDimension = {};
	const unmeasuredDimensionList = [];
	const fieldFaultList = [];
	INVENTORY_DIMENSION_LIST.forEach((oneDimension) => {
		const fieldDeclaration = fileShape.fieldByDimensionName[oneDimension.dimensionName];
		if (!fieldDeclaration || !Object.prototype.hasOwnProperty.call(parsedFile, fieldDeclaration.fieldName)) {
			unmeasuredDimensionList.push(oneDimension.dimensionName);
			return;
		}
		const fieldNames = namesOfField({ fieldDeclaration, fieldContent: parsedFile[fieldDeclaration.fieldName] });
		if (fieldNames.error) {
			fieldFaultList.push(fieldNames.error);
			return;
		}
		nameListByDimension[oneDimension.dimensionName] = fieldNames.nameList;
	});
	if (fieldFaultList.length) {
		return { error: `${moduleName}: REFUSED — the inventory file ${inventoryFilePath} (shape ${fileShape.shapeName}): ${fieldFaultList.join('; ')}.` };
	}
	return { inventory: { graphName, inventoryOrigin: `file:${inventoryFilePath}`, inventoryFileShapeName: fileShape.shapeName, nameListByDimension, unmeasuredDimensionList } };
};

// ---------------------------------------------------------------------------------------------------------------------
// the comparison and its refusal
// ---------------------------------------------------------------------------------------------------------------------
const compareInventories = ({ candidateInventory, predecessorInventory }) => {
	const missingNameListByDimension = {};
	const addedNameListByDimension = {};
	const unmeasuredDimensionList = [];
	INVENTORY_DIMENSION_LIST.forEach((oneDimension) => {
		const dimensionName = oneDimension.dimensionName;
		const predecessorUnmeasured = predecessorInventory.unmeasuredDimensionList.indexOf(dimensionName) !== -1;
		const candidateUnmeasured = candidateInventory.unmeasuredDimensionList.indexOf(dimensionName) !== -1;
		if (predecessorUnmeasured || candidateUnmeasured) {
			unmeasuredDimensionList.push({ dimensionName, unmeasuredOnList: [].concat(predecessorUnmeasured ? [predecessorInventory.graphName] : [], candidateUnmeasured ? [candidateInventory.graphName] : []) });
			missingNameListByDimension[dimensionName] = [];
			addedNameListByDimension[dimensionName] = [];
			return;
		}
		const predecessorNameList = predecessorInventory.nameListByDimension[dimensionName];
		const candidateNameList = candidateInventory.nameListByDimension[dimensionName];
		const missingNameList = predecessorNameList.filter((oneName) => candidateNameList.indexOf(oneName) === -1);
		missingNameListByDimension[dimensionName] = missingNameList;
		addedNameListByDimension[dimensionName] = candidateNameList.filter((oneName) => predecessorNameList.indexOf(oneName) === -1);
	});
	return { missingNameListByDimension, addedNameListByDimension, unmeasuredDimensionList };
};

const inventoryRefusalFor = ({ candidateInventory, predecessorInventory, comparison }) => {
	const missingTextList = INVENTORY_DIMENSION_LIST.filter((oneDimension) => comparison.missingNameListByDimension[oneDimension.dimensionName].length).map(
		(oneDimension) => `${comparison.missingNameListByDimension[oneDimension.dimensionName].length} ${oneDimension.dimensionName}(s) MISSING (${oneDimension.description}): ${comparison.missingNameListByDimension[oneDimension.dimensionName].join(', ')}`,
	);
	const unmeasuredTextList = comparison.unmeasuredDimensionList.map((oneRow) => `the ${oneRow.dimensionName} dimension is UNMEASURED on ${oneRow.unmeasuredOnList.join(' and ')} — it cannot be shown that no ${oneRow.dimensionName} was dropped`);
	const faultTextList = missingTextList.concat(unmeasuredTextList);
	if (faultTextList.length === 0) {
		return '';
	}
	return (
		`${moduleName}: REFUSED — candidate '${candidateInventory.graphName}' does not hold everything its predecessor ` +
		`'${predecessorInventory.graphName}' (${predecessorInventory.inventoryOrigin}) holds:\n    - ${faultTextList.join('\n    - ')}`
	);
};

// ---------------------------------------------------------------------------------------------------------------------
// live reads
// ---------------------------------------------------------------------------------------------------------------------
const readLiveInventory = ({ graphReader, graphName }, callback) => {
	const taskList = new taskListPlus();
	INVENTORY_DIMENSION_LIST.forEach((oneDimension) => {
		taskList.push((args, next) => {
			graphReader.runCypher({ cypherText: oneDimension.readCypherText }, (cypherError, rowList) => {
				if (cypherError) {
					next(`${moduleName}: reading the ${oneDimension.dimensionName} inventory of '${graphName}' failed: ${cypherError}`);
					return;
				}
				next('', { ...args, nameListByDimension: { ...args.nameListByDimension, [oneDimension.dimensionName]: sortedDistinct(rowList.map((oneRow) => oneRow.inventoryName).filter((oneName) => typeof oneName === 'string' && oneName !== '')) } });
			});
		});
	});
	pipeRunner(taskList.getList(), { nameListByDimension: {} }, (pipeError, args) => {
		if (pipeError) {
			callback(pipeError);
			return;
		}
		callback('', { graphName, inventoryOrigin: `liveGraph:${graphName}`, nameListByDimension: args.nameListByDimension, unmeasuredDimensionList: [] });
	});
};

// opens one graph, runs work against it, and closes it whatever the outcome
const withGraphReader = ({ openGraphReader, containerName, work }, callback) => {
	openGraphReader({ containerName }, (openError, graphReader) => {
		if (openError) {
			callback(`${moduleName}: REFUSED — the graph '${containerName}' could not be opened for its inventory: ${openError}`);
			return;
		}
		work(graphReader, (workError, workResult) => graphReader.closeAll(() => callback(workError, workResult)));
	});
};

const readCandidateInventory = ({ openGraphReader, candidateContainerName, manifestRefId }, callback) => {
	withGraphReader(
		{
			openGraphReader,
			containerName: candidateContainerName,
			work: (graphReader, workCallback) => {
				graphReader.runCypher({ cypherText: PASSPORT_CYPHER_TEXT }, (cypherError, passportRowList) => {
					if (cypherError) {
						workCallback(`${moduleName}: reading the passport of '${candidateContainerName}' failed: ${cypherError}`);
						return;
					}
					if (passportRowList.length !== 1) {
						workCallback(`${moduleName}: REFUSED — the candidate '${candidateContainerName}' holds ${passportRowList.length} GraphProvenance node(s), not exactly one; the inventory cannot be tied to manifest ${manifestRefId}.`);
						return;
					}
					if (passportRowList[0].manifestRefId !== manifestRefId) {
						workCallback(`${moduleName}: REFUSED — the candidate '${candidateContainerName}' passport names manifest ${passportRowList[0].manifestRefId}, not ${manifestRefId}, the manifest under certification; its inventory says nothing about this one.`);
						return;
					}
					readLiveInventory({ graphReader, graphName: candidateContainerName }, workCallback);
				});
			},
		},
		callback,
	);
};

const readPredecessorInventory = ({ openGraphReader, predecessorName, inventoryDirectoryPath }, callback) => {
	if (inventoryDirectoryPath) {
		const inventoryFilePath = path.join(inventoryDirectoryPath, `${predecessorName}${INVENTORY_FILE_SUFFIX}`);
		if (!fs.existsSync(inventoryFilePath)) {
			callback(`${moduleName}: REFUSED — --supersedesInventoryDirectoryPath names ${inventoryDirectoryPath}, which holds no ${predecessorName}${INVENTORY_FILE_SUFFIX} (looked for ${inventoryFilePath}).`);
			return;
		}
		const fileRead = inventoryFromFileText({ inventoryFilePath, fileText: fs.readFileSync(inventoryFilePath, 'utf8') });
		if (fileRead.error) {
			callback(fileRead.error);
			return;
		}
		if (fileRead.inventory.graphName !== predecessorName) {
			callback(`${moduleName}: REFUSED — ${inventoryFilePath} is the inventory of '${fileRead.inventory.graphName}', not of '${predecessorName}'.`);
			return;
		}
		callback('', fileRead.inventory);
		return;
	}
	withGraphReader({ openGraphReader, containerName: predecessorName, work: (graphReader, workCallback) => readLiveInventory({ graphReader, graphName: predecessorName }, workCallback) }, callback);
};

// ---------------------------------------------------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------------------------------------------------
/**
 * runInventoryGate — callback(refusalText, gateReport). gateReport: { supersedesNone, candidateInventory, predecessorReportList:
 * [{ predecessorInventory, comparison }] }. Every predecessor is compared and every refusal is collected before answering,
 * so one run names everything that is missing against every predecessor.
 * openGraphReader({ containerName }, callback(openError, { runCypher({ cypherText }, cb(err, rowObjectList)), closeAll(cb) }))
 */
const runInventoryGate = ({ rawSupersedesList, candidateContainerName, manifestRefId, inventoryDirectoryPath, openGraphReader }, callback) => {
	const supersedesParse = parseSupersedesList(rawSupersedesList);
	if (supersedesParse.error) {
		callback(supersedesParse.error);
		return;
	}
	if (supersedesParse.supersedesNone) {
		callback('', { supersedesNone: true, candidateInventory: null, predecessorReportList: [] });
		return;
	}
	if (typeof candidateContainerName !== 'string' || candidateContainerName === '') {
		callback(`${moduleName}: REFUSED — --containerName=<the candidate's running container> is REQUIRED when --supersedes names a predecessor; the candidate's inventory is read from the live graph and has no default.`);
		return;
	}
	const taskList = new taskListPlus();
	taskList.push((args, next) => readCandidateInventory({ openGraphReader, candidateContainerName, manifestRefId }, (readError, candidateInventory) => next(readError, { ...args, candidateInventory })));
	supersedesParse.predecessorNameList.forEach((predecessorName) => {
		taskList.push((args, next) =>
			readPredecessorInventory({ openGraphReader, predecessorName, inventoryDirectoryPath }, (readError, predecessorInventory) => {
				if (readError) {
					next(readError);
					return;
				}
				const comparison = compareInventories({ candidateInventory: args.candidateInventory, predecessorInventory });
				const refusalText = inventoryRefusalFor({ candidateInventory: args.candidateInventory, predecessorInventory, comparison });
				next('', { ...args, predecessorReportList: args.predecessorReportList.concat([{ predecessorInventory, comparison, refusalText }]) });
			}),
		);
	});
	pipeRunner(taskList.getList(), { predecessorReportList: [] }, (pipeError, args) => {
		if (pipeError) {
			callback(pipeError);
			return;
		}
		const refusalTextList = args.predecessorReportList.map((oneReport) => oneReport.refusalText).filter((oneText) => oneText !== '');
		const gateReport = { supersedesNone: false, candidateInventory: args.candidateInventory, predecessorReportList: args.predecessorReportList };
		callback(refusalTextList.join('\n'), gateReport);
	});
};

module.exports = {
	parseSupersedesList,
	inventoryFromFileText,
	compareInventories,
	inventoryRefusalFor,
	runInventoryGate,
	INVENTORY_DIMENSION_LIST,
	INVENTORY_FILE_SHAPE_LIST,
	SUPERSEDES_NONE_TOKEN,
	moduleName,
};
