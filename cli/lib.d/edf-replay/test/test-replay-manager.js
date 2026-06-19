#!/usr/bin/env node
'use strict';

// test-replay-manager.js — Phase-4 GATE for edf-replay (replayManager).
//
// FAST + SYNTHETIC (not full CEDS — that is Phase-7 acceptance). Two tiny synthetic standards
// (a CEDS-like hub + a small CIP-like standard) plus a bridge block, all carrying the universal
// shape the engine requires (:ForgedNode label, stableId = the 'uri' value, provenanceTier on
// edges). Embeddings are OMITTED (no node carries one) with a small embeddingDims so the vector
// phase is a trivial empty-index build on neo4j:5.26.
//
// Drives the REAL code paths: forge-store (saveBlock/saveManifest) for setup, then the edf-replay
// Layer-2 modules graph-builder (-buildGraph: forge-store manifest read + engine replay + owner
// stamp) and schema-extractor (-extractSchema). Provisions instances via the 1B lifecycle.
//
// GATES (all asserted):
//   1. extract a `standard` block from a built graph -> PG-JSONL; persist via forge-store.saveBlock
//      -> a blockId that round-trips in forge-store.getBlock.
//   2. -extractSchema --selector=relationships pulls ONLY bridge edges, NOT standard nodes
//      (block has 0 nodes / only cross-standard edges).
//   3. buildGraph --destination=bronze then --destination=golden; integrity invariant
//      golden == replay(goldenManifest) (rebuild from same manifest -> node/edge-identical;
//      compare counts + spot refs).
//   4. --owner stamping: golden build carries :golden; user build carries :user (node label),
//      edges carry owner property.
//   5. teardown guard: --tearDown refuses golden/non-ephemeral without --force; succeeds on
//      ephemeral/bronze; NEVER invoked on an error path (a failed build leaves the instance).
//
// ALL test containers/volumes are force-torn-down at the END, even on failure — leave nothing stray.
//
// Run (Docker required): node test/test-replay-manager.js

const path = require('path');
const os = require('os');
const fs = require('fs');

// ---- bootstrap process.global (the same triad the CLI uses; tests exercise real code) ----
process.global = process.global || {};
const verbose = process.argv.indexOf('-verbose') !== -1;
process.global.xLog = {
	status: (...a) => console.error(...a),
	error: (...a) => console.error(...a),
	result: (...a) => (verbose ? console.error('[result]', ...a) : void 0),
	verbose: verbose ? (...a) => console.error(...a) : () => {},
};
process.global.getConfig = () => ({});
process.global.commandLineParameters = { switches: {}, values: {}, fileList: [] };

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const PROJECT_ROOT = '/Users/tqwhite/Documents/webdev/educoreForge/system';
const CORE_LIB = path.join(PROJECT_ROOT, 'code', 'npm', 'qtools-graph-forge-core', 'lib');

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
const credentialAccessor = require(path.join(
	CORE_LIB,
	'credential-accessor',
	'credential-accessor',
))({ forgeStore });

const graphBuilderFactory = require('../lib/graph-builder');
const schemaExtractorFactory = require('../lib/schema-extractor');

const dbPath = path.join(os.tmpdir(), `__TEST_edfReplay_${process.pid}.sqlite3`);

// unique graph names so this run never collides with other gf_ containers.
const BRONZE_GRAPH = `__TEST_replayBronze_${process.pid}`;
const GOLDEN_GRAPH = `__TEST_replayGolden_${process.pid}`;
const USER_GRAPH = `__TEST_replayUser_${process.pid}`;
const GOLDEN2_GRAPH = `__TEST_replayGolden2_${process.pid}`;
const allGraphNames = [BRONZE_GRAPH, GOLDEN_GRAPH, USER_GRAPH, GOLDEN2_GRAPH];

const EMBEDDING_DIMS = 8; // small; no node carries an embedding (vector phase is a trivial empty build)

let passed = 0;
let failed = 0;
const failures = [];
const check = (label, condition) => {
	if (condition) {
		passed++;
		console.log(`  PASS  ${label}`);
	} else {
		failed++;
		failures.push(label);
		console.log(`  FAIL  ${label}`);
	}
};

const toNum = (v) => (v && typeof v.toNumber === 'function' ? v.toNumber() : Number(v));

// =====================================================================
// SYNTHETIC FIXTURES — :ForgedNode + stableId(=uri) + provenanceTier (matches replay/test/test.js)
// =====================================================================

const headerFor = (standardKey) => ({
	blockType: 'standard',
	standardKey,
	version: '1',
	stableUriPropertyName: 'uri',
	resolutionKey: 'uri',
	goldenVersionAuthoredAgainst: '__TEST_golden',
	embeddingModelVersion: 'voyage-4-large',
	embeddingEncoding: 'base64',
	embeddingDtype: 'float32',
	embeddingByteOrder: 'little-endian',
	embeddingDims: EMBEDDING_DIMS,
});

const bridgeHeader = {
	blockType: 'bridge',
	pairA: 'CEDS',
	pairB: 'CIP',
	stableUriPropertyName: 'uri',
	resolutionKey: 'uri',
	goldenVersionAuthoredAgainst: '__TEST_golden',
	embeddingModelVersion: 'voyage-4-large',
	embeddingEncoding: 'base64',
	embeddingDtype: 'float32',
	embeddingByteOrder: 'little-endian',
	embeddingDims: EMBEDDING_DIMS,
};

const synthNode = ({ source, stableId, label, name }) => ({
	ref: { source, id: stableId },
	labels: ['ForgedNode', label],
	stableId,
	properties: { name: [name], _source: [source], uri: [stableId] },
});

const synthEdge = ({ type, fromSource, fromStableId, toSource, toStableId, tier }) => ({
	type,
	fromRef: { source: fromSource, id: fromStableId },
	toRef: { source: toSource, id: toStableId },
	properties: { provenanceTier: [tier] },
});

const cedsNodes = [
	synthNode({ source: 'CEDS', stableId: 'ceds://root', label: 'DmeStandardRoot', name: 'CEDS Root' }),
	synthNode({ source: 'CEDS', stableId: 'ceds://class/student', label: 'DmeClass', name: 'Student' }),
	synthNode({ source: 'CEDS', stableId: 'ceds://prop/firstName', label: 'DmeProperty', name: 'FirstName' }),
];
const cedsEdges = [
	synthEdge({ type: 'HAS_CLASS', fromSource: 'CEDS', fromStableId: 'ceds://root', toSource: 'CEDS', toStableId: 'ceds://class/student', tier: 'structural' }),
	synthEdge({ type: 'HAS_PROPERTY', fromSource: 'CEDS', fromStableId: 'ceds://class/student', toSource: 'CEDS', toStableId: 'ceds://prop/firstName', tier: 'structural' }),
];

const cipNodes = [
	synthNode({ source: 'CIP', stableId: 'cip://root', label: 'DmeStandardRoot', name: 'CIP Root' }),
	synthNode({ source: 'CIP', stableId: 'cip://class/program', label: 'DmeClass', name: 'Program' }),
];
const cipEdges = [
	synthEdge({ type: 'HAS_CLASS', fromSource: 'CIP', fromStableId: 'cip://root', toSource: 'CIP', toStableId: 'cip://class/program', tier: 'structural' }),
];

// one cross-source spec-authoritative bridge edge: CIP program -> CEDS student.
const bridgeEdges = [
	synthEdge({ type: 'MAPS_TO', fromSource: 'CIP', fromStableId: 'cip://class/program', toSource: 'CEDS', toStableId: 'ceds://class/student', tier: 'spec-authoritative' }),
];

const cedsBlockText = replayBlock.serializeBlock({ header: headerFor('CEDS'), nodes: cedsNodes, edges: cedsEdges });
const cipBlockText = replayBlock.serializeBlock({ header: headerFor('CIP'), nodes: cipNodes, edges: cipEdges });
const bridgeBlockText = replayBlock.serializeBlock({ header: bridgeHeader, nodes: [], edges: bridgeEdges });

const EXPECTED_NODES = cedsNodes.length + cipNodes.length; // 5
const EXPECTED_EDGES = cedsEdges.length + cipEdges.length + bridgeEdges.length; // 4

// =====================================================================
// HELPERS
// =====================================================================

let lifecycle = null;
let graphBuilder = null;
let schemaExtractor = null;

const countWhere = (graphName, cypher, cb) => {
	lifecycle.runCypher({ graphName, cypher }, (err, result) => {
		if (err) { cb(err); return; }
		cb('', toNum(result.records[0].c));
	});
};

// =====================================================================
// FINISH — report + ALWAYS force-tear-down every test graph (even on failure).
// =====================================================================
const finish = (pipelineErr) => {
	if (pipelineErr) {
		console.error(`\n*** pipeline error: ${pipelineErr}`);
		failed++;
		failures.push(`pipeline error: ${pipelineErr}`);
	}

	console.error('\n  ....  tearing down ALL test graphs (force) — leaving nothing stray');
	let idx = 0;
	const destroyNext = () => {
		if (idx >= allGraphNames.length) {
			try { fs.unlinkSync(dbPath); } catch (ignore) {}
			console.log(
				`\n=====================================================\n` +
					`RESULT: ${failed === 0 ? 'GREEN' : 'RED'}  (${passed} passed, ${failed} failed)\n` +
					(failures.length ? `FAILURES: ${failures.join('; ')}\n` : '') +
					`=====================================================`,
			);
			process.exit(failed === 0 ? 0 : 1);
			return;
		}
		const graphName = allGraphNames[idx];
		idx += 1;
		// force=true: these are all test graphs; the guard is exercised separately in GATE 5.
		lifecycle.destroyInstanceByName({ graphName, force: true }, () => destroyNext());
	};
	destroyNext();
};

console.log('edf-replay (replayManager) Phase-4 gate — synthetic two-standard + bridge:\n');

require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({
	forgeStore,
	credentialAccessor,
})((lifecycleErr, builtLifecycle) => {
	if (lifecycleErr) {
		console.error(`could not build instance-lifecycle: ${lifecycleErr}`);
		process.exit(1);
	}
	lifecycle = builtLifecycle;
	graphBuilder = graphBuilderFactory({ forgeStore, lifecycle });
	schemaExtractor = schemaExtractorFactory({ lifecycle });

	const taskList = new taskListPlus();

	// ---- forge-store init ----
	taskList.push((args, next) => {
		forgeStore.init({ dbPath }, (err) => next(err, args));
	});

	// ---- SETUP: persist the three synthetic blocks via forge-store.saveBlock ----
	taskList.push((args, next) => {
		const blockIds = {};
		const blockTaskList = new taskListPlus();
		const toSave = [
			{ key: 'ceds', type: 'standard', subject: 'CEDS', requires: [], text: cedsBlockText },
			{ key: 'cip', type: 'standard', subject: 'CIP', requires: [], text: cipBlockText },
			{ key: 'bridge', type: 'relationships', subject: null, requires: ['CEDS', 'CIP'], text: bridgeBlockText },
		];
		toSave.forEach((oneBlock) => {
			blockTaskList.push((blockArgs, blockNext) => {
				forgeStore.saveBlock(
					{ type: oneBlock.type, subject: oneBlock.subject, version: '1', requires: oneBlock.requires, text: oneBlock.text, producedBy: '__TEST_phase4' },
					(err, result) => {
						if (err) { blockNext(err); return; }
						blockIds[oneBlock.key] = result.blockId;
						blockNext('', blockArgs);
					},
				);
			});
		});
		pipeRunner(blockTaskList.getList(), {}, (err) => next(err, { ...args, blockIds }));
	});

	// ---- SETUP: compose the golden manifest (CEDS + CIP + bridge) via forge-store.saveManifest ----
	taskList.push((args, next) => {
		const { blockIds } = args;
		forgeStore.saveManifest(
			{
				label: 'golden',
				basedOn: null,
				note: '__TEST_ phase4 synthetic golden',
				members: [
					{ blockId: blockIds.ceds, position: null },
					{ blockId: blockIds.cip, position: null },
					{ blockId: blockIds.bridge, position: null },
				],
			},
			(err, result) => {
				if (err) { next(err); return; }
				check('forge-store composed the golden manifest', !!result.manifestKey);
				next('', { ...args, goldenManifestKey: result.manifestKey });
			},
		);
	});

	// =====================================================================
	// GATE 3a: buildGraph --destination=bronze (owner derives -> :user)
	// =====================================================================
	taskList.push((args, next) => {
		console.error('  ....  GATE 3a: buildGraph --destination=bronze');
		graphBuilder.buildGraph(
			{ manifestKey: args.goldenManifestKey, destination: BRONZE_GRAPH, role: 'bronze' },
			(err, result) => {
				if (err) { next(err); return; }
				check('bronze build replayed all nodes', result.replayResult.nodesMerged === EXPECTED_NODES);
				check('bronze build replayed all edges', result.replayResult.edgesMerged === EXPECTED_EDGES);
				check('bronze build has no dangling refs', (result.replayResult.danglingRefs || []).length === 0);
				check('bronze build owner derives to :user', result.owner === ':user');
				next('', { ...args, bronzeResult: result });
			},
		);
	});

	// read-back bronze counts
	taskList.push((args, next) => {
		countWhere(BRONZE_GRAPH, 'MATCH (n) RETURN count(n) AS c', (err, nodeCount) => {
			if (err) { next(err); return; }
			check(`bronze read-back node count == ${EXPECTED_NODES}`, nodeCount === EXPECTED_NODES);
			next('', { ...args, bronzeNodeCount: nodeCount });
		});
	});
	taskList.push((args, next) => {
		countWhere(BRONZE_GRAPH, 'MATCH ()-[r]->() RETURN count(r) AS c', (err, edgeCount) => {
			if (err) { next(err); return; }
			check(`bronze read-back edge count == ${EXPECTED_EDGES}`, edgeCount === EXPECTED_EDGES);
			next('', { ...args, bronzeEdgeCount: edgeCount });
		});
	});

	// =====================================================================
	// GATE 4 (user): buildGraph --destination=user --owner=:user stamps :user
	// =====================================================================
	taskList.push((args, next) => {
		console.error('  ....  GATE 4: buildGraph --destination=user (owner :user)');
		graphBuilder.buildGraph(
			{ manifestKey: args.goldenManifestKey, destination: USER_GRAPH, role: 'user' },
			(err, result) => {
				if (err) { next(err); return; }
				check('user build owner derives to :user', result.owner === ':user');
				next('', { ...args, userResult: result });
			},
		);
	});
	taskList.push((args, next) => {
		countWhere(USER_GRAPH, 'MATCH (n:user) RETURN count(n) AS c', (err, c) => {
			if (err) { next(err); return; }
			check(`user build: all ${EXPECTED_NODES} nodes carry :user label`, c === EXPECTED_NODES);
			next('', args);
		});
	});
	taskList.push((args, next) => {
		countWhere(USER_GRAPH, "MATCH (n:golden) RETURN count(n) AS c", (err, c) => {
			if (err) { next(err); return; }
			check('user build: NO node carries :golden label', c === 0);
			next('', args);
		});
	});
	taskList.push((args, next) => {
		countWhere(USER_GRAPH, "MATCH ()-[r]->() WHERE r.owner = ':user' RETURN count(r) AS c", (err, c) => {
			if (err) { next(err); return; }
			check(`user build: all ${EXPECTED_EDGES} edges carry owner=':user'`, c === EXPECTED_EDGES);
			next('', args);
		});
	});

	// =====================================================================
	// GATE 3b + 4 (golden): buildGraph --destination=golden stamps :golden
	// =====================================================================
	taskList.push((args, next) => {
		console.error('  ....  GATE 3b: buildGraph --destination=golden (owner :golden)');
		graphBuilder.buildGraph(
			{ manifestKey: args.goldenManifestKey, destination: GOLDEN_GRAPH, role: 'golden' },
			(err, result) => {
				if (err) { next(err); return; }
				check('golden build owner derives to :golden', result.owner === ':golden');
				check('golden build replayed all nodes', result.replayResult.nodesMerged === EXPECTED_NODES);
				check('golden build replayed all edges', result.replayResult.edgesMerged === EXPECTED_EDGES);
				next('', { ...args, goldenResult: result });
			},
		);
	});
	taskList.push((args, next) => {
		countWhere(GOLDEN_GRAPH, 'MATCH (n:golden) RETURN count(n) AS c', (err, c) => {
			if (err) { next(err); return; }
			check(`golden build: all ${EXPECTED_NODES} nodes carry :golden label`, c === EXPECTED_NODES);
			next('', args);
		});
	});
	taskList.push((args, next) => {
		countWhere(GOLDEN_GRAPH, "MATCH (n:user) RETURN count(n) AS c", (err, c) => {
			if (err) { next(err); return; }
			check('golden build: NO node carries :user label', c === 0);
			next('', args);
		});
	});

	// =====================================================================
	// GATE 3 (invariant): golden == replay(goldenManifest)
	//   Rebuild the SAME manifest into a fresh golden2; assert node/edge-identical + spot refs.
	// =====================================================================
	taskList.push((args, next) => {
		console.error('  ....  GATE 3: integrity invariant golden == replay(goldenManifest)');
		graphBuilder.buildGraph(
			{ manifestKey: args.goldenManifestKey, destination: GOLDEN2_GRAPH, role: 'golden' },
			(err, result) => {
				if (err) { next(err); return; }
				next('', { ...args, golden2Result: result });
			},
		);
	});
	taskList.push((args, next) => {
		// compare counts golden vs golden2
		countWhere(GOLDEN_GRAPH, 'MATCH (n) RETURN count(n) AS c', (err, gNodes) => {
			if (err) { next(err); return; }
			countWhere(GOLDEN2_GRAPH, 'MATCH (n) RETURN count(n) AS c', (err2, g2Nodes) => {
				if (err2) { next(err2); return; }
				check(`invariant: golden node count == golden2 node count (${gNodes} == ${g2Nodes})`, gNodes === g2Nodes && gNodes === EXPECTED_NODES);
				next('', args);
			});
		});
	});
	taskList.push((args, next) => {
		countWhere(GOLDEN_GRAPH, 'MATCH ()-[r]->() RETURN count(r) AS c', (err, gEdges) => {
			if (err) { next(err); return; }
			countWhere(GOLDEN2_GRAPH, 'MATCH ()-[r]->() RETURN count(r) AS c', (err2, g2Edges) => {
				if (err2) { next(err2); return; }
				check(`invariant: golden edge count == golden2 edge count (${gEdges} == ${g2Edges})`, gEdges === g2Edges && gEdges === EXPECTED_EDGES);
				next('', args);
			});
		});
	});
	taskList.push((args, next) => {
		// spot-ref: the same stableId set present in both rebuilds
		const stableIdSet = (graphName, cb) =>
			lifecycle.runCypher(
				{ graphName, cypher: 'MATCH (n:ForgedNode) RETURN n.stableId AS s ORDER BY s' },
				(err, result) => {
					if (err) { cb(err); return; }
					cb('', result.records.map((r) => r.s).join('|'));
				},
			);
		stableIdSet(GOLDEN_GRAPH, (err, gSet) => {
			if (err) { next(err); return; }
			stableIdSet(GOLDEN2_GRAPH, (err2, g2Set) => {
				if (err2) { next(err2); return; }
				check('invariant: golden stableId set == golden2 stableId set (spot ref)', gSet === g2Set && gSet.indexOf('ceds://class/student') !== -1);
				next('', args);
			});
		});
	});

	// =====================================================================
	// GATE 1: extractSchema --selector=standard --subject=CEDS -> PG-JSONL; round-trip via forge-store
	// =====================================================================
	taskList.push((args, next) => {
		console.error('  ....  GATE 1: extractSchema --selector=standard --subject=CEDS');
		lifecycle.resolveAccessByName({ graphName: GOLDEN_GRAPH }, (err, access) => {
			if (err) { next(err); return; }
			schemaExtractor.extractSchema(
				{ access, from: GOLDEN_GRAPH, selector: 'standard', subject: 'CEDS' },
				(extractErr, result) => {
					if (extractErr) { next(extractErr); return; }
					check('standard extract has CEDS nodes (3)', result.nodeCount === cedsNodes.length);
					check('standard extract has CEDS internal edges (2)', result.edgeCount === cedsEdges.length);
					// the block must deserialize cleanly
					let deserialized = null;
					let deErr = '';
					try { deserialized = replayBlock.deserializeBlock(result.blockText); } catch (e) { deErr = e.message; }
					check('standard block deserializes cleanly', !deErr && deserialized && deserialized.nodes.length === cedsNodes.length);
					next('', { ...args, standardBlockText: result.blockText });
				},
			);
		});
	});
	taskList.push((args, next) => {
		// persist the extracted standard block via forge-store.saveBlock -> blockId round-trips
		forgeStore.saveBlock(
			{ type: 'standard', subject: 'CEDS', version: '1', requires: [], text: args.standardBlockText, producedBy: '__TEST_phase4_extract' },
			(err, result) => {
				if (err) { next(err); return; }
				check('extracted standard block persisted -> blockId', !!result.blockId);
				forgeStore.getBlock({ blockId: result.blockId }, (getErr, row) => {
					if (getErr) { next(getErr); return; }
					const roundTripText = Buffer.isBuffer(row.text) ? row.text.toString('utf8') : `${row.text}`;
					check('extracted standard block round-trips in forge-store (text identical)', roundTripText === args.standardBlockText);
					next('', args);
				});
			},
		);
	});

	// =====================================================================
	// GATE 2: extractSchema --selector=relationships -> ONLY bridge edges, 0 nodes
	// =====================================================================
	taskList.push((args, next) => {
		console.error('  ....  GATE 2: extractSchema --selector=relationships');
		lifecycle.resolveAccessByName({ graphName: GOLDEN_GRAPH }, (err, access) => {
			if (err) { next(err); return; }
			schemaExtractor.extractSchema(
				{ access, from: GOLDEN_GRAPH, selector: 'relationships' },
				(extractErr, result) => {
					if (extractErr) { next(extractErr); return; }
					check('relationships block has 0 nodes', result.nodeCount === 0);
					check('relationships block has ONLY the cross-standard bridge edge(s)', result.edgeCount === bridgeEdges.length);
					let deserialized = null;
					let deErr = '';
					try { deserialized = replayBlock.deserializeBlock(result.blockText); } catch (e) { deErr = e.message; }
					check('relationships block deserializes with 0 nodes', !deErr && deserialized && deserialized.nodes.length === 0);
					// every edge is cross-source
					const allCross = deserialized && deserialized.edges.every((e) => e.fromRef.source !== e.toRef.source);
					check('relationships block edges are ALL cross-standard', !!allCross && deserialized.edges.length === bridgeEdges.length);
					next('', args);
				},
			);
		});
	});

	// =====================================================================
	// GATE 5a: teardown guard REFUSES golden (non-ephemeral) without force
	// =====================================================================
	taskList.push((args, next) => {
		console.error('  ....  GATE 5a: --tearDown refuses golden without --force');
		lifecycle.destroyInstanceByName({ graphName: GOLDEN_GRAPH, force: false }, (err, result) => {
			check('teardown guard REFUSES golden without --force', !!err && /non-ephemeral|refused/i.test(`${err}`));
			check('golden was NOT destroyed (guard held)', !result);
			next('', args);
		});
	});

	// confirm golden still present after the refused teardown
	taskList.push((args, next) => {
		countWhere(GOLDEN_GRAPH, 'MATCH (n) RETURN count(n) AS c', (err, c) => {
			check('golden still queryable after refused teardown', !err && c === EXPECTED_NODES);
			next('', args);
		});
	});

	// =====================================================================
	// GATE 5b: teardown SUCCEEDS on ephemeral/bronze (without force)
	// =====================================================================
	taskList.push((args, next) => {
		console.error('  ....  GATE 5b: --tearDown succeeds on bronze (ephemeral)');
		lifecycle.destroyInstanceByName({ graphName: BRONZE_GRAPH, force: false }, (err, result) => {
			check('teardown SUCCEEDS on ephemeral bronze without --force', !err && result && result.destroyed === true);
			next('', args);
		});
	});

	// =====================================================================
	// GATE 5c: NEVER torn down on an error path — a failed build leaves the instance in place.
	//   Drive a buildGraph that FAILS at replay (a manifest whose bridge requires a missing
	//   subject is malformed; we instead force a guaranteed replay error by building from a
	//   manifest with a deliberately broken block, then assert the instance still exists).
	// =====================================================================
	taskList.push((args, next) => {
		console.error('  ....  GATE 5c: a failed build leaves its instance in place (no error-path teardown)');
		// craft a manifest referencing a block with an edge missing provenanceTier -> replay ERROR.
		const badEdge = {
			type: 'MAPS_TO',
			fromRef: { source: 'CIP', id: 'cip://class/program' },
			toRef: { source: 'CEDS', id: 'ceds://class/student' },
			properties: {}, // NO provenanceTier -> engine enforcement ERROR (§21)
		};
		const badBlockText = replayBlock.serializeBlock({ header: bridgeHeader, nodes: [], edges: [badEdge] });
		forgeStore.saveBlock(
			{ type: 'relationships', subject: null, version: '1', requires: [], text: badBlockText, producedBy: '__TEST_phase4_bad' },
			(saveErr, saveResult) => {
				if (saveErr) { next(saveErr); return; }
				forgeStore.saveManifest(
					{ label: 'golden', basedOn: null, note: '__TEST_ bad', members: [{ blockId: saveResult.blockId, position: null }] },
					(mErr, mResult) => {
						if (mErr) { next(mErr); return; }
						next('', { ...args, badManifestKey: mResult.manifestKey });
					},
				);
			},
		);
	});
	taskList.push((args, next) => {
		// build into a fresh instance that we EXPECT to fail at replay (provenanceTier enforcement).
		const FAIL_GRAPH = `__TEST_replayFail_${process.pid}`;
		allGraphNames.push(FAIL_GRAPH); // ensure final cleanup tears it down
		graphBuilder.buildGraph(
			{ manifestKey: args.badManifestKey, destination: FAIL_GRAPH, owner: ':user' },
			(err) => {
				check('a malformed-block build FAILS at replay (provenanceTier enforcement)', !!err);
				// the instance must STILL EXIST (NEVER torn down on the error path, DECISIONS §14)
				countWhere(FAIL_GRAPH, 'MATCH (n) RETURN count(n) AS c', (queryErr, c) => {
					check('failed-build instance is LEFT IN PLACE (queryable, not torn down)', !queryErr && typeof c === 'number');
					next('', args);
				});
			},
		);
	});

	pipeRunner(taskList.getList(), {}, (err) => {
		finish(err);
	});
});
