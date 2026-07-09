#!/usr/bin/env node
'use strict';

// test-end-to-end.js — the GATE end-to-end run for the LIF forge bundle: forge FULL LIF ->
// materialize a validation graph (1B instance-lifecycle + Phase-2 replay engine) -> read it back by
// cypher and assert node/edge counts, DmeStandardRoot with stableUriPropertyName='lifPath', a sample
// DmeProperty carrying lifPath(stableId)+searchText+embedding, AND the count of nodes carrying a
// canonical cedsId (LIF→CEDS crossRefs survived into the graph — critical for Phase-7 specified
// bridging). Reports node/edge counts, embedding-call count, wall-clock, and #nodes-with-cedsId.
//
// This bundle materializes through the SAME core libs edf-forge's materializer uses, but stamps
// the LIF source on node/edge refs (edf-forge's lib/materializer hardcodes 'CEDS', which is why the
// LIF bundle serializes its own standard block here rather than reusing that module).
//
// Tears down the validation graph at the END (force) on SUCCESS only — NEVER on error
// (DECISIONS §14: a failed run is left in place for deliberate cleanup).
//
// Run (Docker + live Voyage required): node test/test-end-to-end.js

const path = require('path');

// ---- bootstrap process.global (same triad the CLI uses; tests exercise real code) ----
process.global = process.global || {};
const verbose = process.argv.indexOf('-verbose') !== -1;
process.global.xLog = {
	status: (...a) => console.error(...a),
	error: (...a) => console.error(...a),
	result: (...a) => console.log(...a),
	verbose: verbose ? (...a) => console.error(...a) : () => {},
};
process.global.getConfig = () => ({});
process.global.commandLineParameters = { switches: {}, values: {}, fileList: [] };

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const PROJECT_ROOT = '/Users/tqwhite/Documents/webdev/educoreForge/system';
const CORE_LIB = path.join(PROJECT_ROOT, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const VOYAGE_CONFIG_PATH = path.join(
	PROJECT_ROOT,
	'configs',
	'instanceSpecific',
	'qbook',
	'voyageEmbedding.ini',
);
const LIF_SOURCE = path.join(
	__dirname,
	'..',
	'assets',
	'standardSourceData',
	'01',
	'data_model_1_bare_openapi_schema.1.json',
);

const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
const credentialAccessor = require(path.join(
	CORE_LIB,
	'credential-accessor',
	'credential-accessor',
))({ forgeStore });
const embedder = require(path.join(CORE_LIB, 'embedding', 'embedding-client'))({
	configFilePath: VOYAGE_CONFIG_PATH,
});
const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const replayEngine = require(path.join(CORE_LIB, 'replay', 'replay-engine'));
const forgeBundle = require('../forgeLif')({ embedder });
const os = require('os');
const fs = require('fs');

const GRAPH_NAME = '__TEST_lifValidation';
const dbPath = path.join(os.tmpdir(), `__TEST_lifForgeE2E_${process.pid}.sqlite3`);
const EMBEDDING_DIMS = 1024;

let pass = 0;
let fail = 0;
const failures = [];
const check = (label, condition) => {
	if (condition) {
		pass++;
		console.log(`  PASS  ${label}`);
	} else {
		fail++;
		failures.push(label);
		console.log(`  FAIL  ${label}`);
	}
};

// -----
// buildLifStandardBlock — serialize the forged LIF graph into ONE PG-JSONL 'standard' block,
//   stamping the LIF source on node + edge refs (mirrors edf-forge/lib/materializer, LIF-sourced).
const buildLifStandardBlock = (forged) => {
	const header = {
		blockType: 'standard',
		standardKey: forged.standardKey,
		version: forged.metadata.version,
		stableUriPropertyName: forged.stableUriPropertyName,
		resolutionKey: forged.stableUriPropertyName,
		embeddingModelVersion: 'voyage-4-large',
		embeddingEncoding: 'base64',
		embeddingDtype: 'float32',
		embeddingByteOrder: 'little-endian',
		embeddingDims: EMBEDDING_DIMS,
	};

	const nodes = forged.nodes.map((oneNode) => {
		const properties = {};
		Object.keys(oneNode.properties).forEach((oneKey) => {
			if (oneKey === 'embedding' || oneKey === 'embeddingModelVersion') {
				return;
			}
			const value = oneNode.properties[oneKey];
			properties[oneKey] = Array.isArray(value) ? value : [value];
		});
		const serialized = {
			ref: { source: 'LIF', id: oneNode.stableId },
			labels: oneNode.labels,
			stableId: oneNode.stableId,
			properties,
		};
		if (oneNode.properties.embedding) {
			serialized.embedding = replayBlock.encodeEmbedding(oneNode.properties.embedding);
			serialized.embeddingModelVersion =
				oneNode.properties.embeddingModelVersion || 'voyage-4-large';
		}
		return serialized;
	});

	const edges = forged.edges.map((oneEdge) => {
		const properties = {};
		Object.keys(oneEdge.properties || {}).forEach((oneKey) => {
			const value = oneEdge.properties[oneKey];
			properties[oneKey] = Array.isArray(value) ? value : [value];
		});
		return { type: oneEdge.type, fromRef: oneEdge.fromRef, toRef: oneEdge.toRef, properties };
	});

	return replayBlock.serializeBlock({ header, nodes, edges });
};

const startMs = Date.now();
console.log('forge-lif end-to-end gate (forge FULL LIF -> materialize -> read back):\n');

let lifecycleRef;
let forgedNodeCount = 0;
let forgedEdgeCount = 0;
let embedCallCount = 0;
let forgedCedsIdCount = 0;

const finish = (pipelineErr) => {
	const wallMs = Date.now() - startMs;
	console.log(`\nwall-clock: ${(wallMs / 1000).toFixed(1)}s`);
	console.log(
		`forged: ${forgedNodeCount} nodes, ${forgedEdgeCount} edges, ${embedCallCount} embedding calls, ${forgedCedsIdCount} nodes-with-cedsId`,
	);

	const reportAndExit = (code) => {
		try {
			fs.unlinkSync(dbPath);
		} catch (ignore) {}
		console.log(`\nforge-lif e2e gate: ${pass} passed, ${fail} failed`);
		if (failures.length) {
			console.log(`FAILURES: ${failures.join('; ')}`);
		}
		process.exit(code);
	};

	if (pipelineErr || fail > 0) {
		// NEVER tear down on error — leave the graph in place for deliberate inspection.
		console.error(
			`\n*** NOT tearing down '${GRAPH_NAME}' (run failed / had failures) — left in place per DECISIONS §14.${
				pipelineErr ? ` pipeline error: ${pipelineErr}` : ''
			}`,
		);
		reportAndExit(1);
		return;
	}

	lifecycleRef.destroyInstanceByName({ graphName: GRAPH_NAME, force: true }, (destroyErr) => {
		if (destroyErr) {
			console.error(`teardown warning: ${destroyErr}`);
		} else {
			console.log(`\ntore down validation graph '${GRAPH_NAME}'`);
		}
		reportAndExit(0);
	});
};

const taskList = new taskListPlus();

taskList.push((args, next) => {
	forgeStore.init({ dbPath }, (err) => next(err, args));
});

taskList.push((args, next) => {
	require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({
		forgeStore,
		credentialAccessor,
	})((err, lifecycle) => {
		if (err) {
			next(err);
			return;
		}
		lifecycleRef = lifecycle;
		next('', { ...args, lifecycle });
	});
});

// forge FULL LIF (full embedding pass — the gate forges full LIF once)
taskList.push((args, next) => {
	console.error('  ....  forging FULL LIF (parse + build + embed)');
	forgeBundle.forge({ sourcePath: LIF_SOURCE, owner: ':golden' }, (err, forged) => {
		if (err) {
			next(err);
			return;
		}
		forgedNodeCount = forged.nodes.length;
		forgedEdgeCount = forged.edges.length;
		embedCallCount = forged.embedCallCount;
		forgedCedsIdCount = forged.nodes.filter((n) => /^(C|P|OS|OV)\d{6,}$/.test(n.properties.cedsId)).length;
		check('forge produced nodes', forged.nodes.length > 1000);
		check('forge produced edges', forged.edges.length > 1000);
		check('forge made embedding calls', forged.embedCallCount > 0);
		check('forge captured a non-zero count of canonical cedsId nodes', forgedCedsIdCount > 0);
		const allEmbedded = forged.nodes.every(
			(n) => Array.isArray(n.properties.embedding) && n.properties.embedding.length === 1024,
		);
		check('every forged node carries a 1024-dim embedding', allEmbedded);
		next('', { ...args, forged });
	});
});

// materialize: serialize LIF-sourced standard block -> provision validation graph -> replay
taskList.push((args, next) => {
	console.error('  ....  serializing LIF standard block + provisioning validation graph');
	const blockText = buildLifStandardBlock(args.forged);

	args.lifecycle.resolveAccessByName({ graphName: GRAPH_NAME }, (resolveErr, existing) => {
		const replayInto = (access) => {
			console.error('  ....  replaying block into validation graph');
			replayEngine.replay(
				{
					manifest: [blockText],
					boltUri: access.location,
					password: access.credential.value,
					graphName: GRAPH_NAME,
				},
				(err, replayResult) => {
					if (err) {
						next(`replay failed: ${err}`);
						return;
					}
					check('replay merged all nodes', replayResult.nodesMerged === forgedNodeCount);
					check('replay merged all edges', replayResult.edgesMerged === forgedEdgeCount);
					check(
						'no dangling refs on replay',
						(replayResult.danglingRefs || []).length === 0,
					);
					console.error(
						`  ....  replay: nodesMerged=${replayResult.nodesMerged}, edgesMerged=${replayResult.edgesMerged}, indexes=${JSON.stringify(
							replayResult.indexesBuilt,
						)}`,
					);
					next('', { ...args, replayResult });
				},
			);
		};

		if (!resolveErr && existing && existing.location) {
			replayInto(existing);
			return;
		}
		args.lifecycle.createInstanceByName(
			{ graphName: GRAPH_NAME, type: 'ephemeral' },
			(createErr) => {
				if (createErr) {
					next(`create '${GRAPH_NAME}' failed: ${createErr}`);
					return;
				}
				args.lifecycle.resolveAccessByName({ graphName: GRAPH_NAME }, (err2, fresh) => {
					if (err2) {
						next(err2);
						return;
					}
					replayInto(fresh);
				});
			},
		);
	});
});

// READ IT BACK by cypher (the Phase-4 stand-in)
taskList.push((args, next) => {
	args.lifecycle.runCypher(
		{ graphName: GRAPH_NAME, cypher: 'MATCH (n) RETURN count(n) AS c' },
		(err, result) => {
			if (err) {
				next(err);
				return;
			}
			const c = Number(result.records[0].c);
			check(`read-back node count matches forged (${c} == ${forgedNodeCount})`, c === forgedNodeCount);
			next('', args);
		},
	);
});

taskList.push((args, next) => {
	args.lifecycle.runCypher(
		{ graphName: GRAPH_NAME, cypher: 'MATCH ()-[r]->() RETURN count(r) AS c' },
		(err, result) => {
			if (err) {
				next(err);
				return;
			}
			const c = Number(result.records[0].c);
			check(`read-back edge count matches forged (${c} == ${forgedEdgeCount})`, c === forgedEdgeCount);
			next('', args);
		},
	);
});

taskList.push((args, next) => {
	args.lifecycle.runCypher(
		{
			graphName: GRAPH_NAME,
			cypher:
				'MATCH (n:DmeStandardRoot) RETURN n.stableUriPropertyName AS p, n.standardKey AS k',
		},
		(err, result) => {
			if (err) {
				next(err);
				return;
			}
			check('DmeStandardRoot exists in the graph', result.records.length === 1);
			check(
				"DmeStandardRoot has stableUriPropertyName='lifPath'",
				result.records.length === 1 && result.records[0].p === 'lifPath',
			);
			next('', args);
		},
	);
});

taskList.push((args, next) => {
	args.lifecycle.runCypher(
		{
			graphName: GRAPH_NAME,
			cypher:
				'MATCH (n:DmeProperty) WHERE n.embedding IS NOT NULL AND n.searchText IS NOT NULL AND n.lifPath IS NOT NULL ' +
				'RETURN n.lifPath AS s, n.searchText AS t, size(n.embedding) AS dims LIMIT 1',
		},
		(err, result) => {
			if (err) {
				next(err);
				return;
			}
			const rec = result.records[0];
			check('a sample DmeProperty has lifPath+searchText+embedding', !!rec);
			check('sample DmeProperty embedding is 1024-dim', rec && Number(rec.dims) === 1024);
			if (rec) {
				console.error(`  ....  sample DmeProperty lifPath=${rec.s}`);
			}
			next('', args);
		},
	);
});

// the CRITICAL Phase-7 assertion: nodes carrying a canonical cedsId survived into the graph
taskList.push((args, next) => {
	args.lifecycle.runCypher(
		{
			graphName: GRAPH_NAME,
			cypher: "MATCH (n) WHERE n.cedsId =~ '^(C|P|OS|OV)[0-9]{6,}$' RETURN count(n) AS c",
		},
		(err, result) => {
			if (err) {
				next(err);
				return;
			}
			const c = Number(result.records[0].c);
			check(
				`read-back: a NON-ZERO count of nodes carry a canonical cedsId (${c} in graph; ${forgedCedsIdCount} forged)`,
				c > 0 && c === forgedCedsIdCount,
			);
			console.error(`  ....  nodes-with-cedsId in graph: ${c}`);
			next('', args);
		},
	);
});

pipeRunner(taskList.getList(), {}, (err) => {
	finish(err);
});
