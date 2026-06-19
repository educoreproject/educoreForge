#!/usr/bin/env node
'use strict';

// test-end-to-end.js — the GATE end-to-end run: forge FULL CEDS -> materialize a validation
// graph (1B instance-lifecycle + Phase-2 engine) -> read it back by cypher and assert node/edge
// counts, DmeStandardRoot with stableUriPropertyName='uri', and a sample DmeProperty carrying
// stableId+searchText+embedding. This stands in for Phase-4 replayManager -extractSchema, which
// will read the same graph. Reports node/edge counts, embedding-call count, and wall-clock.
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
const CEDS_SOURCE = path.join(
	__dirname,
	'..',
	'..',
	'forge-ceds',
	'assets',
	'standardSourceData',
	'01',
	'CEDS-Ontology.rdf',
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
const forgeBundle = require('../../forge-ceds/forgeCeds')({ embedder });
const os = require('os');
const fs = require('fs');

const GRAPH_NAME = '__TEST_cedsValidation';
const dbPath = path.join(os.tmpdir(), `__TEST_edfForgeE2E_${process.pid}.sqlite3`);

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

const startMs = Date.now();
console.log('edf-forge end-to-end gate (forge FULL CEDS -> materialize -> read back):\n');

let lifecycleRef;
let forgedNodeCount = 0;
let forgedEdgeCount = 0;
let embedCallCount = 0;

// finish — report + (on success only) tear down the validation graph.
const finish = (pipelineErr) => {
	const wallMs = Date.now() - startMs;
	console.log(`\nwall-clock: ${(wallMs / 1000).toFixed(1)}s`);
	console.log(
		`forged: ${forgedNodeCount} nodes, ${forgedEdgeCount} edges, ${embedCallCount} embedding calls`,
	);

	const reportAndExit = (code) => {
		try {
			fs.unlinkSync(dbPath);
		} catch (ignore) {}
		console.log(`\nedf-forge e2e gate: ${pass} passed, ${fail} failed`);
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

	// success: tear down (force, ephemeral graph).
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

// forge FULL CEDS (full embedding pass — the gate forges full CEDS once)
taskList.push((args, next) => {
	console.error('  ....  forging FULL CEDS (parse + build + embed; this takes a few minutes)');
	forgeBundle.forge({ sourcePath: CEDS_SOURCE, owner: ':golden' }, (err, forged) => {
		if (err) {
			next(err);
			return;
		}
		forgedNodeCount = forged.nodes.length;
		forgedEdgeCount = forged.edges.length;
		embedCallCount = forged.embedCallCount;
		check('forge produced nodes', forged.nodes.length > 20000);
		check('forge produced edges', forged.edges.length > 20000);
		check('forge made embedding calls', forged.embedCallCount > 0);
		// every node carries an embedding after the full pass
		const allEmbedded = forged.nodes.every(
			(n) => Array.isArray(n.properties.embedding) && n.properties.embedding.length === 1024,
		);
		check('every forged node carries a 1024-dim embedding', allEmbedded);
		next('', { ...args, forged });
	});
});

// materialize into the validation graph
taskList.push((args, next) => {
	const materializer = require('../lib/materializer')({ lifecycle: args.lifecycle });
	console.error('  ....  materializing into validation graph (provision + replay)');
	materializer.materialize(
		{ forged: args.forged, destination: GRAPH_NAME },
		(err, result) => {
			if (err) {
				next(err);
				return;
			}
			check('replay merged all nodes', result.replayResult.nodesMerged === forgedNodeCount);
			check('replay merged all edges', result.replayResult.edgesMerged === forgedEdgeCount);
			check(
				'no dangling refs on replay',
				(result.replayResult.danglingRefs || []).length === 0,
			);
			console.error(
				`  ....  replay: nodesMerged=${result.replayResult.nodesMerged}, edgesMerged=${result.replayResult.edgesMerged}, indexes=${JSON.stringify(
					result.replayResult.indexesBuilt,
				)}`,
			);
			next('', { ...args, materializeResult: result });
		},
	);
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
				"MATCH (n:DmeStandardRoot) RETURN n.stableUriPropertyName AS p, n.standardKey AS k",
		},
		(err, result) => {
			if (err) {
				next(err);
				return;
			}
			check('DmeStandardRoot exists in the graph', result.records.length === 1);
			check(
				"DmeStandardRoot has stableUriPropertyName='uri'",
				result.records.length === 1 && result.records[0].p === 'uri',
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
				'MATCH (n:DmeProperty) WHERE n.embedding IS NOT NULL AND n.searchText IS NOT NULL AND n.stableId IS NOT NULL ' +
				'RETURN n.stableId AS s, n.searchText AS t, size(n.embedding) AS dims LIMIT 1',
		},
		(err, result) => {
			if (err) {
				next(err);
				return;
			}
			const rec = result.records[0];
			check('a sample DmeProperty has stableId+searchText+embedding', !!rec);
			check(
				'sample DmeProperty embedding is 1024-dim',
				rec && Number(rec.dims) === 1024,
			);
			if (rec) {
				console.error(`  ....  sample DmeProperty stableId=${rec.s}`);
			}
			next('', args);
		},
	);
});

pipeRunner(taskList.getList(), {}, (err) => {
	finish(err);
});
