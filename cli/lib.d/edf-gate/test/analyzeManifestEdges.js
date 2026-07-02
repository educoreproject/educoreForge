#!/usr/bin/env node
'use strict';

// analyzeManifestEdges.js — Phase-1 review investigation (WILD_FALCON Task 1): the replay engine reports
// edgesMerged=189958 but only 189952 edges materialize in BOTH the deployed golden and new builds. This
// resolves the gap by analyzing the manifest's raw edge RECORDS: total records vs distinct (by
// from+to+type), to determine whether the 6 are MERGE-deduped DUPLICATES (benign) or dropped edges to
// non-resolvable endpoints (a real defect). Read-only; no graph, no writes.
//
// Usage: node analyzeManifestEdges.js <manifestKey>

const path = require('path');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const GRAPH_BUILDER = path.join(projectRoot, 'code', 'cli', 'lib.d', 'edf-replay', 'lib', 'graph-builder');
const dbPath = path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');

process.global = {
	xLog: { status: () => {}, error: (...a) => console.error(...a), result: () => {}, verbose: () => {} },
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
};

const manifestKey = process.argv[2];
if (!manifestKey) { console.error('manifestKey required'); process.exit(1); }

const { deserializeBlock } = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
const credentialAccessor = require(path.join(CORE_LIB, 'credential-accessor', 'credential-accessor'))({ forgeStore });

const taskList = new taskListPlus();
taskList.push((args, next) => forgeStore.init({ dbPath }, (err) => next(err, args)));
taskList.push((args, next) => {
	require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({ forgeStore, credentialAccessor })((err, lifecycle) => next(err, { ...args, lifecycle }));
});
taskList.push((args, next) => {
	const graphBuilder = require(GRAPH_BUILDER)({ forgeStore, lifecycle: args.lifecycle });
	graphBuilder.resolveOrderedBlockTexts({ manifestKey }, (err, resolved) => next(err, { ...args, blockTexts: resolved.blockTexts }));
});

pipeRunner(taskList.getList(), {}, (err, args) => {
	if (err) { console.error('analyze failed:', err); process.exit(1); return; }
	const edgeKeyCount = new Map();   // from|to|type -> count
	const edgeFullCount = new Map();  // from|to|type|propsJson -> count
	let totalEdgeRecords = 0;
	args.blockTexts.forEach((text) => {
		const { edges } = deserializeBlock(text);
		edges.forEach((e) => {
			totalEdgeRecords++;
			const key = `${e.fromRef.source}:${e.fromRef.id}|${e.toRef.source}:${e.toRef.id}|${e.type}`;
			const fullKey = `${key}|${JSON.stringify(e.properties || {})}`;
			edgeKeyCount.set(key, (edgeKeyCount.get(key) || 0) + 1);
			edgeFullCount.set(fullKey, (edgeFullCount.get(fullKey) || 0) + 1);
		});
	});
	const distinctByEndpointsType = edgeKeyCount.size;
	const distinctByFull = edgeFullCount.size;
	// the duplicates: keys appearing more than once (by endpoints+type — the MERGE key)
	const dupes = [...edgeKeyCount.entries()].filter(([, c]) => c > 1);
	const dupeExtra = dupes.reduce((sum, [, c]) => sum + (c - 1), 0);

	console.log(JSON.stringify({
		manifestKey: manifestKey.slice(0, 16) + '…',
		totalEdgeRecords,
		distinctByEndpointsType,
		distinctByFullRecord: distinctByFull,
		duplicateCollapses_byEndpointsType: dupeExtra,
		duplicateKeyGroups: dupes.length,
		interpretation: dupeExtra === (totalEdgeRecords - distinctByEndpointsType)
			? 'the merged-vs-materialized gap is MERGE dedup of duplicate edge records (same from+to+type)'
			: 'gap not fully explained by endpoint+type dedup — investigate further',
		sampleDuplicates: dupes.slice(0, 12).map(([k, c]) => ({ key: k, recordCount: c })),
	}, null, 2));
	process.exit(0);
});
