#!/usr/bin/env node
'use strict';

// phaseE-graph-dump.js — G-E2's property-level diff instrument (Phase E, method D2 declared
// to the supervisor). Serializes ONE built graph's :ForgedNode content to a deterministic
// sorted line dump so two graphs can be compared line-for-line:
//   nodes: one JSON line per node — { stableId, labels (sorted), props (sorted keys) }
//   edges: one JSON line per edge — { type, from, to, props (sorted keys) }
// DECLARED EXCLUSION (DEVLOG §3.2.5): embedding-representation fields ('embedding',
// 'embeddingRef', 'embeddingModelVersion') are excluded from node props — the golden's
// blocks predate the sidecar migration (inline base64) while fresh blocks carry sidecar
// refs; embedding CONTENT equivalence is evidenced by the reuse statistics, and the
// fingerprint instrument runs -ignoreEmbedding. Everything else is dumped verbatim.
//
// Run: EDF_FORGE_STORE_DB=<canonical> node baselines/phaseE-graph-dump.js \
//        --graph=<graphName> --outDir=<dir>
// Writes <outDir>/<graphName>.nodes.jsonl + <outDir>/<graphName>.edges.jsonl (sorted).
//
// Wiring mirrors the sanctioned phaseD-teardown.js pattern (forge-store + credential-
// accessor + instance-lifecycle). Readiness: the target graph's container must already
// be RUNNING (this tool reads built graphs; it provisions nothing); cypher calls retry
// on transient connection errors (pin (v) — generous timeouts, never a one-shot flake).
//
// Async style: qtools taskListPlus/pipeRunner; no async/await, no try/catch for control
// flow. camelCase; compound names.

const path = require('path');
const fs = require('fs');

process.global = {
	xLog: { status: console.error, error: console.error, result: console.log },
	getConfig: () => undefined,
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
	rawConfig: {},
};

const commandLineParser = require(path.join(
	__dirname, '..', 'cli', 'node_modules', 'qtools-parse-command-line',
));
const commandLineParameters = commandLineParser.getParameters();

const CORE_LIB = path.join(__dirname, '..', 'npm', 'qtools-graph-forge-core', 'lib');

const { pipeRunner, taskListPlus } = new (require(path.join(
	__dirname, '..', 'cli', 'node_modules', 'qtools-asynchronous-pipe-plus',
)))();

const EXCLUDED_NODE_PROPS = ['embedding', 'embeddingRef', 'embeddingModelVersion'];

const firstValue = (name) => {
	const values = commandLineParameters.values[name];
	return values && values.length ? values[0] : undefined;
};

const graphName = firstValue('graph');
const outDir = firstValue('outDir');

if (!graphName || !outDir) {
	console.error('usage: EDF_FORGE_STORE_DB=<store> node phaseE-graph-dump.js --graph=<name> --outDir=<dir>');
	process.exit(1);
}
if (!process.env.EDF_FORGE_STORE_DB) {
	console.error('REFUSED: EDF_FORGE_STORE_DB must be set explicitly (disclosure-5a discipline)');
	process.exit(1);
}

const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
const credentialAccessor = require(path.join(
	CORE_LIB, 'credential-accessor', 'credential-accessor',
))({ forgeStore });

const sortedProps = (rawProps) => {
	const shaped = {};
	Object.keys(rawProps || {})
		.filter((oneKey) => !EXCLUDED_NODE_PROPS.includes(oneKey))
		.sort()
		.forEach((oneKey) => {
			shaped[oneKey] = rawProps[oneKey];
		});
	return shaped;
};

// runCypherWithRetry — pin (v): transient bolt flakes get retries with widening waits,
// a genuine failure surfaces loudly after the last attempt.
const runCypherWithRetry = ({ lifecycle, cypher, params }, callback) => {
	const waits = [0, 2000, 5000, 15000];
	const attemptOne = (attemptIndex) => {
		lifecycle.runCypher({ graphName, cypher, params }, (err, result) => {
			if (!err) {
				callback('', result);
				return;
			}
			if (attemptIndex >= waits.length - 1) {
				callback(`runCypher failed after ${waits.length} attempts: ${err}`);
				return;
			}
			console.error(`[phaseE-graph-dump] attempt ${attemptIndex + 1} failed (${err}); retrying in ${waits[attemptIndex + 1]}ms`);
			setTimeout(() => attemptOne(attemptIndex + 1), waits[attemptIndex + 1]);
		});
	};
	attemptOne(0);
};

const BATCH_SIZE = 20000;

const taskList = new taskListPlus();

taskList.push((args, next) => {
	forgeStore.init({ dbPath: process.env.EDF_FORGE_STORE_DB }, (err) => next(err, args));
});

taskList.push((args, next) => {
	require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({
		forgeStore,
		credentialAccessor,
	})((err, lifecycle) => next(err, { ...args, lifecycle }));
});

// nodes — batched by SKIP/LIMIT over a stable ORDER BY stableId.
taskList.push((args, next) => {
	const nodeLines = [];
	const fetchBatch = (skipCount) => {
		runCypherWithRetry(
			{
				lifecycle: args.lifecycle,
				// SKIP/LIMIT inlined as integer literals — the driver would send JS numbers as
				// floats, which Neo4j rejects for SKIP/LIMIT (observed on the first live run).
				cypher: `MATCH (n:ForgedNode) RETURN n.stableId AS stableId, labels(n) AS labels,
					properties(n) AS props ORDER BY n.stableId SKIP ${skipCount} LIMIT ${BATCH_SIZE}`,
				params: {},
			},
			(err, result) => {
				if (err) {
					next(`node dump: ${err}`);
					return;
				}
				result.records.forEach((oneRecord) => {
					nodeLines.push(
						JSON.stringify({
							stableId: oneRecord.stableId,
							labels: (oneRecord.labels || []).slice().sort(),
							props: sortedProps(oneRecord.props),
						}),
					);
				});
				if (result.records.length === BATCH_SIZE) {
					fetchBatch(skipCount + BATCH_SIZE);
					return;
				}
				next('', { ...args, nodeLines });
			},
		);
	};
	fetchBatch(0);
});

// edges — batched the same way over a stable composite order.
taskList.push((args, next) => {
	const edgeLines = [];
	const fetchBatch = (skipCount) => {
		runCypherWithRetry(
			{
				lifecycle: args.lifecycle,
				cypher: `MATCH (a:ForgedNode)-[r]->(b:ForgedNode)
					RETURN type(r) AS edgeType, a.stableId AS fromId, b.stableId AS toId,
					properties(r) AS props
					ORDER BY edgeType, fromId, toId SKIP ${skipCount} LIMIT ${BATCH_SIZE}`,
				params: {},
			},
			(err, result) => {
				if (err) {
					next(`edge dump: ${err}`);
					return;
				}
				result.records.forEach((oneRecord) => {
					edgeLines.push(
						JSON.stringify({
							type: oneRecord.edgeType,
							from: oneRecord.fromId,
							to: oneRecord.toId,
							props: sortedProps(oneRecord.props),
						}),
					);
				});
				if (result.records.length === BATCH_SIZE) {
					fetchBatch(skipCount + BATCH_SIZE);
					return;
				}
				next('', { ...args, edgeLines });
			},
		);
	};
	fetchBatch(0);
});

// write the two sorted dumps.
taskList.push((args, next) => {
	if (!fs.existsSync(outDir)) {
		fs.mkdirSync(outDir, { recursive: true });
	}
	const nodePath = path.join(outDir, `${graphName}.nodes.jsonl`);
	const edgePath = path.join(outDir, `${graphName}.edges.jsonl`);
	fs.writeFileSync(nodePath, args.nodeLines.sort().join('\n') + '\n');
	fs.writeFileSync(edgePath, args.edgeLines.sort().join('\n') + '\n');
	console.error(`[phaseE-graph-dump] ${graphName}: ${args.nodeLines.length} nodes, ${args.edgeLines.length} edges`);
	console.log(JSON.stringify({ graphName, nodeCount: args.nodeLines.length, edgeCount: args.edgeLines.length, nodePath, edgePath }));
	next('', args);
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`phaseE-graph-dump FAILED: ${err}`);
		process.exit(1);
	}
	process.exit(0);
});
