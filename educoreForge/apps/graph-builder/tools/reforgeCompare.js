#!/usr/bin/env node
'use strict';

// reforgeCompare.js — is forging REPEATABLE? (lane REFORGE, forgeClean PLAN R3, 2026-10-08). The forger's claim is that it
// "correctly and repeatably forges the known standards from scratch" and "replays manifests at will". This tool is the
// instrument that tests the second word of that claim: two from-scratch builds (or two replays of one manifest) are
// compared store by store and graph by graph, and every difference that is not on the NAMED volatile list is a bug.
//
// It does not build. A build is graphBuilder's job, run twice (evidence/REFORGE/runReforgeBuild.sh in the forgeClean
// folder); this tool reads what those builds left behind:
//   -fingerprint     ONE READ session on a named graph container: every node and every edge, hashed into a record file
//   -compareGraphs   two record files → the graph comparison (nodes, edges)
//   -compareStores   two builds' sqlite stores → the table-by-table comparison (blocks, manifests, decision blocks, …)
//   -summarize       the comparison reports of one reforge run → ONE evidence file, the input -stampPromotion reads to
//                    write the reforgeDeterminism BuildAttestation
// Every comparison report is JSON with a verdict; exit status 0 only when everything compared is identical.
//
// The rules live in lib/reforge-compare.js (pure, gated by test/test-reforgeCompare.js); the volatile list and the store
// table registry are DATA in lib/reforgeVolatileFieldList.json and lib/reforgeStoreTableRules.json.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- prove forging is repeatable: compare two from-scratch builds (or two replays) store by store and
     graph by graph, every difference not on the NAMED volatile list reported as a bug

SYNOPSIS
     ${moduleName} -fingerprint   --containerName=<a running graph> --fingerprintFilePath=<out.jsonl>
     ${moduleName} -compareGraphs --fingerprintFilePathA=<a.jsonl> --fingerprintFilePathB=<b.jsonl> --reportFilePath=<out.json>
                                  [--detailLimit=<N>]
     ${moduleName} -compareStores --storeFilePathListA=<a1,a2,...> --storeFilePathListB=<b1,b2,...> --reportFilePath=<out.json>
                                  [--detailLimit=<N>]
     ${moduleName} -summarize     --reforgeRunRefId=<name> --reportFilePathList=<r1,r2,...> --summaryFilePath=<out.json>
     ${moduleName} -help

DESCRIPTION
     -fingerprint reads the bolt port and credential from the container (docker inspect), opens ONE READ session and
     streams every node (labels, properties) and then every edge (type, properties, endpoints). Each becomes a record:
     a sha256 over its canonical, type-tagged content with the volatile properties removed, its identity text (sorted
     labels + stableId; an edge names its endpoints by identity when that identity is unique in the graph, else by the
     endpoint's content hash), and a short digest per property so a difference can be named down to the property. The
     record file ends with a summary line: counts, the node-set and edge-set digests (sha256 over the SORTED record
     hashes, so the read order cannot move them) and how often each volatile property was removed. READ-ONLY.

     -compareGraphs compares the two record files as MULTISETS of hashes, per kind (nodes, edges). A surplus record whose
     identity has a surplus twin on the other side is reported as CHANGED with the properties that differ; the rest as
     only-A / only-B. Totals are complete; the samples are the first --detailLimit (default 20) per kind.

     -compareStores opens each named sqlite file READ-ONLY (the Nth A file is compared with the Nth B file), and compares
     every table in it under lib/reforgeStoreTableRules.json: large columns by sha256, and the store's own content address
     re-verified on both sides (blocks.refId = sha256(text), decisionBlocks.decisionBlockHash = sha256(frozenText)). A table
     with no rule is REFUSED by name, never skipped: a table nobody registered is a table nobody compared.

     -summarize reads the named comparison reports and writes the evidence file for the reforgeDeterminism attestation:
     the run's name, the code head the tool runs on (and whether its tree is clean), every report's path, sha256, kinds
     and verdict, the manifest ids the compared stores composed, and one overall verdict (pass only when every report
     passed). graphBuilder -stampPromotion --reforgeEvidencePath=<it> records it in the graph.

THE VOLATILE LIST
     lib/reforgeVolatileFieldList.json — one row per excluded field: { scope (graphNode | graphEdge | storeRow),
     subjectName (ONE label, edge type or table), propertyName (ONE name), reason }. Names only: a wildcard or regex
     character in a name is REFUSED, and so is a row without a reason. A property is excluded only from a record whose
     labels (or edge type, or table) include the row's subjectName. Each report counts how often each row was used.

EXIT STATUS
     0  the action completed and everything it compared is identical (or the fingerprint was written)
     1  a difference was found, or the action was refused (a missing parameter, an unregistered table, a bad list)

EXAMPLES
     node apps/graph-builder/tools/reforgeCompare.js -fingerprint --containerName=DEV_reforge_plainA --fingerprintFilePath=/tmp/plainA.jsonl
     node apps/graph-builder/tools/reforgeCompare.js -compareGraphs --fingerprintFilePathA=/tmp/plainA.jsonl --fingerprintFilePathB=/tmp/plainB.jsonl --reportFilePath=/tmp/graphs.json
`;

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const reforgeCompareLib = require(path.join(__dirname, '..', 'lib', 'reforge-compare'));
// the CEDS round-trip compiler's resolver, as -stampPromotion and graphStructureCheck use it (its module export is a factory)
const { resolveContainerBolt } = require(path.join(TREE_ROOT, 'forges', 'ceds', 'lib', 'roundTripCompiler'))();

const VOLATILE_FIELD_LIST_FILE_PATH = path.join(__dirname, '..', 'lib', 'reforgeVolatileFieldList.json');
const STORE_TABLE_RULES_FILE_PATH = path.join(__dirname, '..', 'lib', 'reforgeStoreTableRules.json');
const DEFAULT_DETAIL_LIMIT = 20;
const NODE_CYPHER = 'MATCH (n) RETURN elementId(n) AS elementRefId, labels(n) AS labelList, properties(n) AS propertyByName';
const EDGE_CYPHER = 'MATCH (a)-[r]->(b) RETURN elementId(a) AS startElementRefId, type(r) AS edgeType, properties(r) AS propertyByName, elementId(b) AS endElementRefId';

const flagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};
// a LIST flag: qtools-parse-command-line already splits a comma list into the values array, so EVERY element is read (and
// each split again, for a caller who hands one joined string through the JSON envelope). Reading only the first element
// compared the first store of a list and silently skipped the rest.
const listFlagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	const elementList = Array.isArray(flagValue) ? flagValue : flagValue === undefined ? [] : [flagValue];
	return elementList.reduce((soFar, oneElement) => soFar.concat(`${oneElement}`.split(',')), []).filter((oneFilePath) => oneFilePath !== '');
};

// readJsonFile — the one sanctioned try/catch shape: a synchronous parse converted to an error value
const readJsonFile = (filePath) => {
	if (!fs.existsSync(filePath)) {
		return { error: `${moduleName}: ${filePath} does not exist` };
	}
	try {
		return { parsed: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
	} catch (parseError) {
		return { error: `${moduleName}: ${filePath} is not JSON: ${parseError.message}` };
	}
};

const loadVolatileFieldList = () => {
	const read = readJsonFile(VOLATILE_FIELD_LIST_FILE_PATH);
	return read.error ? { volatileFieldList: [], refusal: read.error } : reforgeCompareLib.volatileFieldListFrom(read.parsed);
};

const detailLimitOf = () => {
	const rawValue = flagValueOf('detailLimit');
	if (rawValue === undefined) {
		return { detailLimit: DEFAULT_DETAIL_LIMIT };
	}
	const detailLimit = Number(rawValue);
	return Number.isInteger(detailLimit) && detailLimit >= 0 ? { detailLimit } : { refusal: `${moduleName}: --detailLimit=${rawValue} is not a non-negative integer` };
};

const requireFlags = (flagNameList) => {
	const missingList = flagNameList.filter((flagName) => typeof flagValueOf(flagName) !== 'string' || flagValueOf(flagName) === '');
	return missingList.length ? `${moduleName}: REFUSED: ${missingList.map((flagName) => `--${flagName}`).join(', ')} REQUIRED, with no default\n${helpText}` : '';
};

const writeReport = ({ reportFilePath, report }) => {
	fs.writeFileSync(reportFilePath, `${JSON.stringify(report, null, 2)}\n`);
	reforgeCompareLib.reportLineListFor(report).forEach((oneLine) => xLog.result(`${oneLine}\n`));
	xLog.result(`${moduleName}: wrote ${reportFilePath}\n`);
};

// codeHeadOf — the commit this tool runs on and whether its tree is clean; the attestation cites both
const codeHeadOf = () => {
	const runGit = (gitArgumentList) => execFileSync('git', ['-C', TREE_ROOT].concat(gitArgumentList), { encoding: 'utf8' }).trim();
	return { codeHead: runGit(['rev-parse', 'HEAD']), dirtyPathCount: runGit(['status', '--porcelain']).split('\n').filter((oneLine) => oneLine.trim() !== '').length };
};

// ===== -fingerprint =====================================================================================================
// streamCypher — run one query and hand each record to onRecord; the driver's observer API at the leaf (DOCTRINE.md)
const streamCypher = ({ session, cypherText, onRecord }, callback) => {
	session.run(cypherText).subscribe({
		onNext: onRecord,
		onCompleted: () => callback(''),
		onError: (streamError) => callback(`${moduleName}: '${cypherText}' failed: ${streamError.message}`),
	});
};

const fingerprintAction = (callback) => {
	const refusal = requireFlags(['containerName', 'fingerprintFilePath']);
	const { volatileFieldList, refusal: volatileRefusal } = loadVolatileFieldList();
	if (refusal || volatileRefusal) {
		callback(refusal || volatileRefusal);
		return;
	}
	const neo4j = require('neo4j-driver');
	const containerName = flagValueOf('containerName');
	const fingerprintFilePath = flagValueOf('fingerprintFilePath');
	const taskList = new taskListPlus();
	taskList.push((args, next) => resolveContainerBolt({ containerName }, (resolveError, resolved) => next(resolveError ? `${moduleName}: ${resolveError}` : '', { ...args, resolved })));
	taskList.push((args, next) => {
		const driver = neo4j.driver(args.resolved.boltUrl, neo4j.auth.basic('neo4j', args.resolved.password), { encrypted: false });
		next('', { ...args, driver, session: driver.session({ defaultAccessMode: neo4j.session.READ }), recordStream: fs.createWriteStream(fingerprintFilePath) });
	});
	// pass 1: nodes. Each record is written as it is made; only elementId → (identity, hash) is kept for the edge pass.
	taskList.push((args, next) => {
		const nodeByElementRefId = new Map();
		const identityCountByText = new Map();
		const nodeHashList = [];
		const excludedCountByName = {};
		streamCypher(
			{
				session: args.session,
				cypherText: NODE_CYPHER,
				onRecord: (oneRecord) => {
					const nodeRecord = reforgeCompareLib.nodeRecordFor({ labelList: oneRecord.get('labelList'), propertyByName: oneRecord.get('propertyByName'), volatileFieldList });
					nodeByElementRefId.set(oneRecord.get('elementRefId'), { identityText: nodeRecord.identityText, nodeHash: nodeRecord.nodeHash });
					identityCountByText.set(nodeRecord.identityText, (identityCountByText.get(nodeRecord.identityText) || 0) + 1);
					nodeHashList.push(nodeRecord.nodeHash);
					nodeRecord.excludedPropertyNameList.forEach((oneName) => { excludedCountByName[`graphNode.${oneName}`] = (excludedCountByName[`graphNode.${oneName}`] || 0) + 1; });
					args.recordStream.write(`${JSON.stringify({ recordKind: 'node', hash: nodeRecord.nodeHash, identityText: nodeRecord.identityText, propertyDigestByName: nodeRecord.propertyDigestByName })}\n`);
				},
			},
			(streamError) => next(streamError, { ...args, nodeByElementRefId, identityCountByText, nodeHashList, excludedCountByName }),
		);
	});
	// pass 2: edges, their endpoints named through the node pass
	taskList.push((args, next) => {
		const edgeHashList = [];
		const endpointNameOf = (elementRefId) => reforgeCompareLib.endpointNameFor({ nodeRecord: args.nodeByElementRefId.get(elementRefId), identityCountByText: args.identityCountByText });
		streamCypher(
			{
				session: args.session,
				cypherText: EDGE_CYPHER,
				onRecord: (oneRecord) => {
					const edgeRecord = reforgeCompareLib.edgeRecordFor({ edgeType: oneRecord.get('edgeType'), startEndpointName: endpointNameOf(oneRecord.get('startElementRefId')), endEndpointName: endpointNameOf(oneRecord.get('endElementRefId')), propertyByName: oneRecord.get('propertyByName'), volatileFieldList });
					edgeHashList.push(edgeRecord.edgeHash);
					edgeRecord.excludedPropertyNameList.forEach((oneName) => { args.excludedCountByName[`graphEdge.${oneName}`] = (args.excludedCountByName[`graphEdge.${oneName}`] || 0) + 1; });
					args.recordStream.write(`${JSON.stringify({ recordKind: 'edge', hash: edgeRecord.edgeHash, identityText: edgeRecord.identityText, propertyDigestByName: edgeRecord.propertyDigestByName })}\n`);
				},
			},
			(streamError) => next(streamError, { ...args, edgeHashList }),
		);
	});
	taskList.push((args, next) => {
		const summary = {
			recordKind: 'summary',
			fingerprintFormat: reforgeCompareLib.FINGERPRINT_FORMAT,
			containerName,
			nodeCount: args.nodeHashList.length,
			edgeCount: args.edgeHashList.length,
			nodeSetDigest: reforgeCompareLib.setDigestOf(args.nodeHashList),
			edgeSetDigest: reforgeCompareLib.setDigestOf(args.edgeHashList),
			graphFingerprint: reforgeCompareLib.sha256Of(`${reforgeCompareLib.setDigestOf(args.nodeHashList)}\n${reforgeCompareLib.setDigestOf(args.edgeHashList)}`),
			duplicateIdentityCount: Array.from(args.identityCountByText.values()).filter((oneCount) => oneCount > 1).length,
			excludedCountByName: args.excludedCountByName,
			volatileFieldListSha256: reforgeCompareLib.sha256Of(fs.readFileSync(VOLATILE_FIELD_LIST_FILE_PATH, 'utf8')),
		};
		args.recordStream.end(`${JSON.stringify(summary)}\n`, () => next('', { ...args, summary }));
	});
	pipeRunner(taskList.getList(), {}, (pipeError, args) => {
		const closeThen = (afterClose) => (args && args.session ? args.session.close().then(() => args.driver.close()).then(afterClose, afterClose) : afterClose());
		closeThen(() => {
			if (pipeError) {
				callback(pipeError);
				return;
			}
			const { summary } = args;
			xLog.result(`${moduleName}: ${containerName}: ${summary.nodeCount} node(s), ${summary.edgeCount} edge(s); graphFingerprint ${summary.graphFingerprint}; excluded ${JSON.stringify(summary.excludedCountByName)}; wrote ${fingerprintFilePath}\n`);
			callback('', 0);
		});
	});
};

// ===== -compareGraphs ===================================================================================================
// readRecordFile — the records of one fingerprint file, by kind, and its summary line (refused when there is none: a
// file without its summary is a fingerprint that did not finish)
const readRecordFile = (filePath, callback) => {
	if (!fs.existsSync(filePath)) {
		callback(`${moduleName}: fingerprint file ${filePath} does not exist`);
		return;
	}
	const recordListByKind = { node: [], edge: [] };
	let summary = null;
	let lineFault = '';
	const lineReader = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
	lineReader.on('line', (oneLine) => {
		const read = oneLine.trim() === '' ? { parsed: null } : (() => {
			try {
				return { parsed: JSON.parse(oneLine) };
			} catch (parseError) {
				return { error: parseError.message };
			}
		})();
		if (read.error) {
			lineFault = lineFault || `${moduleName}: ${filePath}: a line is not JSON (${read.error})`;
			return;
		}
		if (!read.parsed) {
			return;
		}
		if (read.parsed.recordKind === 'summary') {
			summary = read.parsed;
			return;
		}
		if (!recordListByKind[read.parsed.recordKind]) {
			lineFault = lineFault || `${moduleName}: ${filePath}: unknown recordKind ${JSON.stringify(read.parsed.recordKind)}`;
			return;
		}
		recordListByKind[read.parsed.recordKind].push(read.parsed);
	});
	lineReader.on('close', () => {
		if (lineFault) {
			callback(lineFault);
			return;
		}
		if (!summary || summary.fingerprintFormat !== reforgeCompareLib.FINGERPRINT_FORMAT) {
			callback(`${moduleName}: ${filePath} has no ${reforgeCompareLib.FINGERPRINT_FORMAT} summary line — the fingerprint did not finish, or is another format`);
			return;
		}
		callback('', { recordListByKind, summary });
	});
};

const compareGraphsAction = (callback) => {
	const refusal = requireFlags(['fingerprintFilePathA', 'fingerprintFilePathB', 'reportFilePath']);
	const { detailLimit, refusal: detailRefusal } = detailLimitOf();
	if (refusal || detailRefusal) {
		callback(refusal || detailRefusal);
		return;
	}
	readRecordFile(flagValueOf('fingerprintFilePathA'), (errorA, readA) => {
		if (errorA) {
			callback(errorA);
			return;
		}
		readRecordFile(flagValueOf('fingerprintFilePathB'), (errorB, readB) => {
			if (errorB) {
				callback(errorB);
				return;
			}
			if (readA.summary.volatileFieldListSha256 !== readB.summary.volatileFieldListSha256) {
				callback(`${moduleName}: REFUSED: the two fingerprints were taken under DIFFERENT volatile lists (${readA.summary.volatileFieldListSha256.slice(0, 12)} vs ${readB.summary.volatileFieldListSha256.slice(0, 12)}) — re-take both under one list`);
				return;
			}
			const comparisonList = ['node', 'edge'].map((oneKind) => reforgeCompareLib.compareRecordSets({ kindName: `graph ${oneKind}s`, recordListA: readA.recordListByKind[oneKind], recordListB: readB.recordListByKind[oneKind], hashFieldName: 'hash', detailLimit }));
			const verdict = reforgeCompareLib.verdictFor(comparisonList);
			const report = {
				reportKind: 'compareGraphs',
				verdict,
				comparisonList,
				fingerprintA: { filePath: flagValueOf('fingerprintFilePathA'), ...readA.summary },
				fingerprintB: { filePath: flagValueOf('fingerprintFilePathB'), ...readB.summary },
			};
			writeReport({ reportFilePath: flagValueOf('reportFilePath'), report });
			callback('', verdict.verdict === 'pass' ? 0 : 1);
		});
	});
};

// ===== -compareStores ===================================================================================================
// openReadOnly — better-sqlite3 opens synchronously and throws on a bad file: converted to an error value at the boundary
const openReadOnly = (filePath) => {
	if (!fs.existsSync(filePath)) {
		return { error: `${moduleName}: store ${filePath} does not exist` };
	}
	const BetterSqlite = require('better-sqlite3');
	try {
		return { database: new BetterSqlite(filePath, { readonly: true, fileMustExist: true }) };
	} catch (openError) {
		return { error: `${moduleName}: store ${filePath} could not be opened read-only: ${openError.message}` };
	}
};

// storeRecordListFor — every row of every table in one store, as records; refused when a table has no rule
const storeRecordListFor = ({ database, filePath, tableRuleByName, volatileFieldList }) => {
	const tableNameList = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((oneRow) => oneRow.name);
	// a store with no table is not an empty comparison, it is no comparison (an unreadable WAL, the wrong file): refused
	if (tableNameList.length === 0) {
		return { error: `${moduleName}: REFUSED: ${filePath} holds NO table — there is nothing to compare, and comparing nothing must not read as identical` };
	}
	const unregisteredList = tableNameList.filter((oneName) => !tableRuleByName[oneName]);
	if (unregisteredList.length) {
		return { error: `${moduleName}: REFUSED: ${filePath} holds table(s) ${unregisteredList.join(', ')} with no rule in reforgeStoreTableRules.json — a table nobody registered is a table nobody compared` };
	}
	const recordListByTable = {};
	const contentAddressFaultList = [];
	tableNameList.forEach((tableName) => {
		const tableRule = tableRuleByName[tableName];
		recordListByTable[tableName] = [];
		for (const oneRow of database.prepare(`SELECT * FROM "${tableName}"`).iterate()) {
			const digestedRow = Object.keys(oneRow).reduce((soFar, columnName) => {
				if (tableRule.digestColumnNameList.indexOf(columnName) === -1) {
					return Object.assign(soFar, { [columnName]: oneRow[columnName] });
				}
				return Object.assign(soFar, { [`${columnName}Sha256`]: reforgeCompareLib.sha256Of(oneRow[columnName] === null ? '' : oneRow[columnName]) });
			}, {});
			if (tableRule.contentAddressColumnName && digestedRow[tableRule.contentAddressColumnName] !== digestedRow[`${tableRule.digestColumnNameList[0]}Sha256`]) {
				contentAddressFaultList.push(`${tableName} ${tableRule.contentAddressColumnName} ${digestedRow[tableRule.contentAddressColumnName]} is not sha256(${tableRule.digestColumnNameList[0]})`);
			}
			const identityText = tableRule.identityColumnNameList.map((columnName) => `${oneRow[columnName]}`).join('|');
			recordListByTable[tableName].push(reforgeCompareLib.storeRowRecordFor({ tableName, identityText, rowByColumnName: digestedRow, volatileFieldList }));
		}
	});
	const manifestRefIdList = tableNameList.indexOf('manifests') === -1 ? [] : database.prepare('SELECT refId FROM manifests ORDER BY refId').all().map((oneRow) => oneRow.refId);
	return { recordListByTable, contentAddressFaultList, manifestRefIdList };
};

const compareStoresAction = (callback) => {
	const refusal = requireFlags(['storeFilePathListA', 'storeFilePathListB', 'reportFilePath']);
	const { detailLimit, refusal: detailRefusal } = detailLimitOf();
	const { volatileFieldList, refusal: volatileRefusal } = loadVolatileFieldList();
	const rulesRead = readJsonFile(STORE_TABLE_RULES_FILE_PATH);
	const { tableRuleByName, refusal: rulesRefusal } = rulesRead.error ? { refusal: rulesRead.error } : reforgeCompareLib.storeTableRuleByNameFrom(rulesRead.parsed);
	const storeFilePathListA = listFlagValueOf('storeFilePathListA');
	const storeFilePathListB = listFlagValueOf('storeFilePathListB');
	const pairRefusal = storeFilePathListA.length === storeFilePathListB.length ? '' : `${moduleName}: REFUSED: ${storeFilePathListA.length} A store(s) and ${storeFilePathListB.length} B store(s) — the Nth A file is compared with the Nth B file`;
	const firstRefusal = refusal || detailRefusal || volatileRefusal || rulesRefusal || pairRefusal;
	if (firstRefusal) {
		callback(firstRefusal);
		return;
	}
	const sideList = [];
	const openFaultList = [];
	storeFilePathListA.forEach((filePathA, pairIndex) => {
		const filePathB = storeFilePathListB[pairIndex];
		const openedA = openReadOnly(filePathA);
		const openedB = openReadOnly(filePathB);
		if (openedA.error || openedB.error) {
			openFaultList.push(openedA.error || openedB.error);
			return;
		}
		const readA = storeRecordListFor({ database: openedA.database, filePath: filePathA, tableRuleByName, volatileFieldList });
		const readB = storeRecordListFor({ database: openedB.database, filePath: filePathB, tableRuleByName, volatileFieldList });
		openedA.database.close();
		openedB.database.close();
		if (readA.error || readB.error) {
			openFaultList.push(readA.error || readB.error);
			return;
		}
		sideList.push({ filePathA, filePathB, readA, readB });
	});
	if (openFaultList.length) {
		callback(openFaultList.join('\n'));
		return;
	}
	const comparisonList = [];
	sideList.forEach((oneSide) => {
		const tableNameList = Array.from(new Set(Object.keys(oneSide.readA.recordListByTable).concat(Object.keys(oneSide.readB.recordListByTable)))).sort();
		tableNameList.forEach((tableName) =>
			comparisonList.push({
				...reforgeCompareLib.compareRecordSets({ kindName: `${path.basename(oneSide.filePathA)} ↔ ${path.basename(oneSide.filePathB)} table ${tableName}`, recordListA: oneSide.readA.recordListByTable[tableName] || [], recordListB: oneSide.readB.recordListByTable[tableName] || [], hashFieldName: 'rowHash', detailLimit }),
				excludedCountByName: reforgeCompareLib.excludedCensusOf((oneSide.readA.recordListByTable[tableName] || []).concat(oneSide.readB.recordListByTable[tableName] || [])),
			}),
		);
	});
	const contentAddressFaultList = sideList.reduce((soFar, oneSide) => soFar.concat(oneSide.readA.contentAddressFaultList.map((oneFault) => `A ${oneFault}`), oneSide.readB.contentAddressFaultList.map((oneFault) => `B ${oneFault}`)), []);
	// a content-address fault is its own comparison row: a store that breaks its own address rule fails whatever B says
	const contentAddressComparison = { kindName: 'content addresses (refId = sha256(text), decisionBlockHash = sha256(frozenText))', countA: contentAddressFaultList.length, countB: contentAddressFaultList.length, digestA: reforgeCompareLib.setDigestOf([]), digestB: reforgeCompareLib.setDigestOf([]), identical: contentAddressFaultList.length === 0, changedCount: 0, onlyACount: contentAddressFaultList.length, onlyBCount: 0, changedPropertyCountByName: {}, changedSampleList: [], onlyASampleList: contentAddressFaultList.slice(0, detailLimit), onlyBSampleList: [] };
	const verdict = reforgeCompareLib.verdictFor(comparisonList.concat([contentAddressComparison]));
	const report = {
		reportKind: 'compareStores',
		verdict,
		comparisonList: comparisonList.concat([contentAddressComparison]),
		manifestRefIdListA: sideList.reduce((soFar, oneSide) => soFar.concat(oneSide.readA.manifestRefIdList), []),
		manifestRefIdListB: sideList.reduce((soFar, oneSide) => soFar.concat(oneSide.readB.manifestRefIdList), []),
		storeFilePathListA,
		storeFilePathListB,
	};
	writeReport({ reportFilePath: flagValueOf('reportFilePath'), report });
	callback('', verdict.verdict === 'pass' ? 0 : 1);
};

// ===== -summarize =======================================================================================================
const summarizeAction = (callback) => {
	const refusal = requireFlags(['reforgeRunRefId', 'reportFilePathList', 'summaryFilePath']);
	if (refusal) {
		callback(refusal);
		return;
	}
	const reportFilePathList = listFlagValueOf('reportFilePathList');
	const readList = reportFilePathList.map((oneFilePath) => ({ filePath: oneFilePath, ...readJsonFile(oneFilePath) }));
	const unreadable = readList.find((oneRead) => oneRead.error || !oneRead.parsed || !oneRead.parsed.verdict || ['compareGraphs', 'compareStores'].indexOf(oneRead.parsed.reportKind) === -1);
	if (unreadable) {
		callback(`${moduleName}: REFUSED: ${unreadable.filePath} is not a reforgeCompare comparison report${unreadable.error ? ` (${unreadable.error})` : ''}`);
		return;
	}
	const reportRowList = readList.map((oneRead) => ({
		filePath: oneRead.filePath,
		sha256: reforgeCompareLib.sha256Of(fs.readFileSync(oneRead.filePath)),
		reportKind: oneRead.parsed.reportKind,
		verdict: oneRead.parsed.verdict.verdict,
		detail: oneRead.parsed.verdict.detail,
		graphFingerprintList: oneRead.parsed.reportKind === 'compareGraphs' ? [oneRead.parsed.fingerprintA.graphFingerprint, oneRead.parsed.fingerprintB.graphFingerprint] : [],
	}));
	const manifestRefIdList = Array.from(new Set(readList.reduce((soFar, oneRead) => soFar.concat(oneRead.parsed.manifestRefIdListA || [], oneRead.parsed.manifestRefIdListB || []), []))).sort();
	const failedList = reportRowList.filter((oneRow) => oneRow.verdict !== 'pass');
	const { codeHead, dirtyPathCount } = codeHeadOf();
	const summary = {
		summaryFormat: reforgeCompareLib.REFORGE_EVIDENCE_FORMAT,
		reforgeRunRefId: flagValueOf('reforgeRunRefId'),
		codeHead,
		dirtyPathCount,
		verdict: failedList.length === 0 && reportRowList.length > 0 ? 'pass' : 'fail',
		detail: `reforgeCompare run ${flagValueOf('reforgeRunRefId')} on head ${codeHead.slice(0, 12)}${dirtyPathCount ? ` (+${dirtyPathCount} uncommitted path(s))` : ''}: ${reportRowList.length - failedList.length} of ${reportRowList.length} comparison report(s) identical${failedList.length ? `; DIFFERENT: ${failedList.map((oneRow) => path.basename(oneRow.filePath)).join(', ')}` : ''}`,
		manifestRefIdList,
		reportRowList,
	};
	fs.writeFileSync(flagValueOf('summaryFilePath'), `${JSON.stringify(summary, null, 2)}\n`);
	xLog.result(`[reforgeCompare] ${summary.verdict.toUpperCase()} — ${summary.detail}\n${moduleName}: wrote ${flagValueOf('summaryFilePath')}\n`);
	callback('', summary.verdict === 'pass' ? 0 : 1);
};

// ===== dispatch =========================================================================================================
const ACTION_BY_SWITCH_NAME = Object.freeze({ fingerprint: fingerprintAction, compareGraphs: compareGraphsAction, compareStores: compareStoresAction, summarize: summarizeAction });
const chosenSwitchNameList = Object.keys(ACTION_BY_SWITCH_NAME).filter((switchName) => commandLineParameters.switches[switchName]);
if (chosenSwitchNameList.length !== 1) {
	xLog.error(`${moduleName}: REFUSED: name exactly ONE action (${Object.keys(ACTION_BY_SWITCH_NAME).map((switchName) => `-${switchName}`).join(', ')}); got ${chosenSwitchNameList.length ? chosenSwitchNameList.map((switchName) => `-${switchName}`).join(', ') : 'none'}\n${helpText}`);
	process.exit(1);
}
ACTION_BY_SWITCH_NAME[chosenSwitchNameList[0]]((actionError, exitCode) => {
	if (actionError) {
		xLog.error(`${moduleName}: ${actionError}`);
		process.exit(1);
	}
	process.exit(exitCode);
});
