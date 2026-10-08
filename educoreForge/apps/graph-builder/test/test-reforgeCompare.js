#!/usr/bin/env node
'use strict';

// test-reforgeCompare.js — gate for lane REFORGE (forgeClean PLAN R3, 2026-10-08): the rules reforgeCompare applies when it
// decides whether two from-scratch builds are the same. Pure (lib/reforge-compare.js) plus the tool's store comparison
// driven end to end over two throwaway sqlite files (no graph, no docker).
//
// PROVES:
//   (a) the same records read in a different order are IDENTICAL (the read order of a query cannot move a fingerprint)
//   (b) A TIMESTAMP LEAK is reported BY NAME: the node and the property that differs
//   (c) AN UNSORTED SET ITERATION is reported BY NAME: a list property whose order differs is a difference, never sorted away
//   (d) a NAMED volatile row removes exactly its property from exactly its label's records, and is counted as used
//   (e) a volatile row that is a PATTERN, or has no reason, is REFUSED by name; so is a duplicate row
//   (f) a neo4j Integer 1 and a Float 1.0 DIFFER (the type is part of the value)
//   (g) one changed node is reported ONCE, as a node: its edges name it by identity and stay identical; an edge whose
//       type changes is reported as an edge
//   (h) the comparison is a MULTISET: two identical nodes against one is a difference
//   (i) an empty comparison list FAILS, never passes
//   (j) -compareStores end to end: identical stores pass; a changed block text and an unregistered table are named; a
//       block whose refId is not sha256(text) fails the content-address row
// RED TWINS (in memory, a double of lib/reforge-compare.js): wrongLabelExcluded -> (d); listSortedAway -> (c);
// integerReadAsFloat -> (f); patternAdmitted -> (e); emptyListPasses -> (i); endpointByHashAlways -> (g);
// multisetCollapsed -> (h); orderSensitiveDigest -> (a).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: reforgeCompare's comparison rules (lane REFORGE)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const neo4j = require('neo4j-driver');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const LIB_PATH = path.join(__dirname, '..', 'lib', 'reforge-compare.js');
const TOOL_PATH = path.join(__dirname, '..', 'tools', 'reforgeCompare.js');
const libFor = (mutationList) => (mutationList.length === 0 ? require(LIB_PATH) : loadBuildJsDouble({ buildJsPath: LIB_PATH, mutationList }));

const NODE_LIST = [
	{ labelList: ['DmeClass', 'ForgedNode'], propertyByName: { stableId: 'toy:Person', name: 'Person', siblingCount: neo4j.int(3) } },
	{ labelList: ['DmeProperty', 'ForgedNode'], propertyByName: { stableId: 'toy:Person.birthDate', name: 'birthDate', tagList: ['a', 'b'] } },
	{ labelList: ['GraphMeta', 'GraphProvenance'], propertyByName: { stableId: 'graphProvenance', graphName: 'DEV_one' } },
];
const nodeRecordListOf = (lib, nodeList, volatileFieldList) => nodeList.map((oneNode) => lib.nodeRecordFor({ ...oneNode, volatileFieldList: volatileFieldList || [] }));
const compareNodes = (lib, nodeListA, nodeListB, volatileFieldList) => lib.compareRecordSets({ kindName: 'nodes', recordListA: nodeRecordListOf(lib, nodeListA, volatileFieldList), recordListB: nodeRecordListOf(lib, nodeListB, volatileFieldList), hashFieldName: 'nodeHash', detailLimit: 5 });
const withProperty = (nodeIndex, propertyName, propertyValue) => NODE_LIST.map((oneNode, index) => (index === nodeIndex ? { ...oneNode, propertyByName: { ...oneNode.propertyByName, [propertyName]: propertyValue } } : oneNode));
// edges named through the node records exactly as the tool names them
const edgeRecordListOf = (lib, nodeList, edgeList) => {
	const nodeRecordList = nodeRecordListOf(lib, nodeList, []);
	const identityCountByText = nodeRecordList.reduce((soFar, oneRecord) => soFar.set(oneRecord.identityText, (soFar.get(oneRecord.identityText) || 0) + 1), new Map());
	return edgeList.map((oneEdge) => lib.edgeRecordFor({ edgeType: oneEdge.edgeType, startEndpointName: lib.endpointNameFor({ nodeRecord: nodeRecordList[oneEdge.startIndex], identityCountByText }), endEndpointName: lib.endpointNameFor({ nodeRecord: nodeRecordList[oneEdge.endIndex], identityCountByText }), propertyByName: oneEdge.propertyByName || {}, volatileFieldList: [] }));
};
const EDGE_LIST = [{ edgeType: 'HAS_PROPERTY', startIndex: 0, endIndex: 1 }];

// the tool, run as the operator runs it; exitCode from the process
const runTool = (argumentList, callback) => execFile('node', [TOOL_PATH].concat(argumentList), { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (runError, stdoutText, stderrText) => callback({ exitCode: runError ? runError.code : 0, outputText: `${stdoutText}${stderrText}` }));
const makeStore = (filePath, { blockText, extraTable, forgedRefId }) => {
	const BetterSqlite = require('better-sqlite3');
	const database = new BetterSqlite(filePath);
	const refId = forgedRefId || crypto.createHash('sha256').update(blockText).digest('hex');
	database.exec('CREATE TABLE blocks (refId TEXT PRIMARY KEY, kind TEXT, subject TEXT, version TEXT, requires TEXT, text TEXT, producedBy TEXT, createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
	database.prepare('INSERT INTO blocks (refId, kind, subject, version, requires, text, producedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(refId, 'standardBase', 'toy@1_base', '1', '[]', blockText, 'toyRecipe', `2026-10-08 0${Math.floor(Math.random() * 9)}:00:00`);
	if (extraTable) {
		database.exec(`CREATE TABLE ${extraTable} (refId TEXT)`);
	}
	database.close();
};

const conjunctJudgeByRefId = {
	a_readOrderCannotMove: (mutationList, done) => {
		const lib = libFor(mutationList);
		const comparison = compareNodes(lib, NODE_LIST, NODE_LIST.slice().reverse());
		const digestA = lib.setDigestOf(['b', 'a', 'c']);
		const digestB = lib.setDigestOf(['c', 'b', 'a']);
		done({ pass: comparison.identical && lib.verdictFor([comparison]).verdict === 'pass' && digestA === digestB, detail: `identical ${comparison.identical}; set digests ${digestA === digestB ? 'equal' : 'DIFFER'} across order` });
	},
	b_timestampLeakNamed: (mutationList, done) => {
		const lib = libFor(mutationList);
		const comparison = compareNodes(lib, withProperty(0, 'builtAt', '2026-10-08T14:00:00Z'), withProperty(0, 'builtAt', '2026-10-08T14:31:07Z'));
		const reportText = lib.reportLineListFor({ comparisonList: [comparison], verdict: lib.verdictFor([comparison]) }).join('\n');
		done({ pass: !comparison.identical && comparison.changedCount === 1 && comparison.changedPropertyCountByName.builtAt === 1 && /changed DmeClass:ForgedNode\|toy:Person: builtAt /.test(reportText) && /properties builtAt ×1/.test(reportText), detail: reportText.split('\n').slice(0, 3).join(' / ') });
	},
	c_unsortedSetNamed: (mutationList, done) => {
		const lib = libFor(mutationList);
		const comparison = compareNodes(lib, NODE_LIST, withProperty(1, 'tagList', ['b', 'a']));
		done({ pass: !comparison.identical && comparison.changedPropertyCountByName.tagList === 1 && comparison.changedSampleList[0].identityText === 'DmeProperty:ForgedNode|toy:Person.birthDate', detail: JSON.stringify(comparison.changedSampleList) });
	},
	d_namedVolatileRowExcludesExactly: (mutationList, done) => {
		const lib = libFor(mutationList);
		const { volatileFieldList } = lib.volatileFieldListFrom([{ scope: 'graphNode', subjectName: 'GraphProvenance', propertyName: 'graphName', reason: 'the container name is chosen per run, not forged' }]);
		const excludedComparison = compareNodes(lib, NODE_LIST, withProperty(2, 'graphName', 'DEV_two'), volatileFieldList);
		// the same property on ANOTHER label is not excluded: the row names one label
		const otherLabelComparison = compareNodes(lib, withProperty(0, 'graphName', 'x'), withProperty(0, 'graphName', 'y'), volatileFieldList);
		const usedCensus = lib.excludedCensusOf(nodeRecordListOf(lib, NODE_LIST, volatileFieldList));
		done({ pass: excludedComparison.identical && !otherLabelComparison.identical && usedCensus.graphName === 1, detail: `on its label identical ${excludedComparison.identical}; on another label identical ${otherLabelComparison.identical}; used ${JSON.stringify(usedCensus)}` });
	},
	e_patternAndReasonlessRefused: (mutationList, done) => {
		const lib = libFor(mutationList);
		const patternRead = lib.volatileFieldListFrom([{ scope: 'graphNode', subjectName: 'GraphProvenance', propertyName: '*At', reason: 'every timestamp, whatever it is called' }]);
		const reasonlessRead = lib.volatileFieldListFrom([{ scope: 'graphNode', subjectName: 'GraphProvenance', propertyName: 'builtAt', reason: '' }]);
		const subjectPatternRead = lib.volatileFieldListFrom([{ scope: 'graphNode', subjectName: 'Graph.*', propertyName: 'builtAt', reason: 'the wall clock of the build' }]);
		const duplicateRead = lib.volatileFieldListFrom([{ scope: 'storeRow', subjectName: 'blocks', propertyName: 'createdAt', reason: 'the wall clock of the build' }, { scope: 'storeRow', subjectName: 'blocks', propertyName: 'createdAt', reason: 'the wall clock of the build' }]);
		done({ pass: /propertyName "\*At" is not ONE property name \(no patterns\)/.test(patternRead.refusal) && /reason is absent/.test(reasonlessRead.refusal) && /subjectName "Graph\.\*"/.test(subjectPatternRead.refusal) && /listed twice/.test(duplicateRead.refusal), detail: [patternRead.refusal, reasonlessRead.refusal, subjectPatternRead.refusal, duplicateRead.refusal].map((oneText) => oneText || '(accepted)').join(' | ') });
	},
	f_integerIsNotFloat: (mutationList, done) => {
		const lib = libFor(mutationList);
		const comparison = compareNodes(lib, NODE_LIST, withProperty(0, 'siblingCount', 3));
		done({ pass: !comparison.identical && comparison.changedPropertyCountByName.siblingCount === 1, detail: `${lib.canonicalValueTextOf(neo4j.int(3))} vs ${lib.canonicalValueTextOf(3)}` });
	},
	g_changedNodeReportedOnce: (mutationList, done) => {
		const lib = libFor(mutationList);
		const nodeListB = withProperty(0, 'name', 'Human');
		const edgeComparison = lib.compareRecordSets({ kindName: 'edges', recordListA: edgeRecordListOf(lib, NODE_LIST, EDGE_LIST), recordListB: edgeRecordListOf(lib, nodeListB, EDGE_LIST), hashFieldName: 'edgeHash', detailLimit: 5 });
		const typeComparison = lib.compareRecordSets({ kindName: 'edges', recordListA: edgeRecordListOf(lib, NODE_LIST, EDGE_LIST), recordListB: edgeRecordListOf(lib, NODE_LIST, [{ ...EDGE_LIST[0], edgeType: 'REFERENCES' }]), hashFieldName: 'edgeHash', detailLimit: 5 });
		done({ pass: edgeComparison.identical && !typeComparison.identical && typeComparison.onlyACount === 1 && /-\[HAS_PROPERTY\]->/.test(typeComparison.onlyASampleList[0]), detail: `edges after a node change identical ${edgeComparison.identical}; type change: ${typeComparison.onlyASampleList[0]} / ${typeComparison.onlyBSampleList[0]}` });
	},
	h_multisetNotSet: (mutationList, done) => {
		const lib = libFor(mutationList);
		const comparison = compareNodes(lib, NODE_LIST.concat([NODE_LIST[0]]), NODE_LIST);
		done({ pass: !comparison.identical && comparison.onlyACount === 1 && comparison.countA === 4, detail: `countA ${comparison.countA} countB ${comparison.countB} onlyA ${comparison.onlyACount}` });
	},
	i_emptyComparisonFails: (mutationList, done) => {
		const verdict = libFor(mutationList).verdictFor([]);
		done({ pass: verdict.verdict === 'fail' && /no comparison ran/.test(verdict.detail), detail: `${verdict.verdict}: ${verdict.detail}` });
	},
	j_compareStoresEndToEnd: (mutationList, done) => {
		if (mutationList.length) {
			done({ pass: true, detail: 'not a twin target (the tool loads the real lib)' });
			return;
		}
		const workDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'reforgeCompare-'));
		const pathOf = (fileName) => path.join(workDirPath, fileName);
		makeStore(pathOf('a.sqlite3'), { blockText: 'block one' });
		makeStore(pathOf('b.sqlite3'), { blockText: 'block one' });
		makeStore(pathOf('c.sqlite3'), { blockText: 'block one, changed' });
		makeStore(pathOf('d.sqlite3'), { blockText: 'block one', extraTable: 'mysteryTable' });
		makeStore(pathOf('e.sqlite3'), { blockText: 'block one', forgedRefId: 'f'.repeat(64) });
		const storeArgumentsFor = (fileNameB, reportName) => ['-compareStores', `--storeFilePathListA=${pathOf('a.sqlite3')}`, `--storeFilePathListB=${pathOf(fileNameB)}`, `--reportFilePath=${pathOf(reportName)}`];
		runTool(storeArgumentsFor('b.sqlite3', 'same.json'), (sameRun) =>
			runTool(storeArgumentsFor('c.sqlite3', 'changed.json'), (changedRun) =>
				runTool(storeArgumentsFor('d.sqlite3', 'mystery.json'), (mysteryRun) =>
					runTool(storeArgumentsFor('e.sqlite3', 'address.json'), (addressRun) => {
						const pass =
							sameRun.exitCode === 0 &&
							/IDENTICAL a\.sqlite3 ↔ b\.sqlite3 table blocks/.test(sameRun.outputText) &&
							changedRun.exitCode === 1 &&
							/changed blocks\|standardBase\|toy@1_base: refId [0-9a-f]+→[0-9a-f]+, textSha256 /.test(changedRun.outputText) &&
							mysteryRun.exitCode === 1 &&
							/table\(s\) mysteryTable with no rule in reforgeStoreTableRules\.json/.test(mysteryRun.outputText) &&
							addressRun.exitCode === 1 &&
							/B blocks refId f{64} is not sha256\(text\)/.test(addressRun.outputText);
						fs.rmSync(workDirPath, { recursive: true, force: true });
						done({ pass, detail: `same exit ${sameRun.exitCode}; changed exit ${changedRun.exitCode}; mystery exit ${mysteryRun.exitCode}; address exit ${addressRun.exitCode}${pass ? '' : `\n${[sameRun, changedRun, mysteryRun, addressRun].map((oneRun) => oneRun.outputText.slice(0, 600)).join('\n---\n')}`}` });
					}),
				),
			),
		);
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'd_namedVolatileRowExcludesExactly', twinName: 'wrongLabelExcluded', find: 'oneRow.scope === scope && subjectNameList.indexOf(oneRow.subjectName) !== -1', replace: 'oneRow.scope === scope' },
	{ conjunctRefId: 'c_unsortedSetNamed', twinName: 'listSortedAway', find: "return ['list', oneValue.map(canonicalValueOf)];", replace: "return ['list', oneValue.map(canonicalValueOf).sort()];" },
	{ conjunctRefId: 'f_integerIsNotFloat', twinName: 'integerReadAsFloat', find: "typeof oneValue.toNumber === 'function') {\n\t\treturn ['int', oneValue.toString()];", replace: "typeof oneValue.toNumber === 'function') {\n\t\treturn ['float', oneValue.toString()];" },
	{ conjunctRefId: 'e_patternAndReasonlessRefused', twinName: 'patternAdmitted', find: 'const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;', replace: 'const FIELD_NAME_RE = /^.+$/;' },
	{ conjunctRefId: 'i_emptyComparisonFails', twinName: 'emptyListPasses', find: "return { verdict: 'fail', detail: `${moduleName}: no comparison ran", replace: "return { verdict: 'pass', detail: `${moduleName}: no comparison ran" },
	{ conjunctRefId: 'g_changedNodeReportedOnce', twinName: 'endpointByHashAlways', find: "(identityCountByText.get(nodeRecord.identityText) === 1 ? nodeRecord.identityText :", replace: "(false ? nodeRecord.identityText :" },
	{ conjunctRefId: 'h_multisetNotSet', twinName: 'multisetCollapsed', find: 'countByHash.set(oneHash, (countByHash.get(oneHash) || 0) + 1)', replace: 'countByHash.set(oneHash, 1)' },
	{ conjunctRefId: 'a_readOrderCannotMove', twinName: 'orderSensitiveDigest', find: "sha256Of(hashList.slice().sort().join('\\n'))", replace: "sha256Of(hashList.slice().join('\\n'))" },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
harness.section('BASELINE — the real rules pass every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a double of lib/reforge-compare.js (in memory)');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) =>
				conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }], (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
					stepDone();
				})),
			() => harness.report(),
		);
	},
);
