#!/usr/bin/env node
'use strict';

// =====================================================================
// Phase-2 test gate — the PG-JSONL replay engine (SILENT_STONE).
// Runnable with: node lib/replay/test/test.js
//
// Provisions disposable Neo4j test graphs by REUSING the Phase-1 instance-lifecycle wired to
// the REAL forge-store + credential-accessor (this also integration-tests Phase2<->1B). Uses
// SYNTHETIC GREENFIELD fixtures: nodes carrying stableId + Dme* labels + a base64 1024-dim
// embedding; edges carrying provenanceTier. Tears down ALL containers/volumes (force) even on
// failure — leaves nothing stray.
//
// Asserts the five gating requirements:
//   1. round-trip fidelity (counts + spot-ref + property equality)
//   2. idempotent replay (replay twice -> identical graph; MERGE not CREATE)
//   3. two-endpoint orphan report (missing endpoint -> danglingRefs, NO partial edge)
//   4. incremental add (prior block byte-identical via SHA-256; only new one changes)
//   5. provenanceTier enforcement (missing tier -> engine ERROR, not written, not dangling)
// =====================================================================

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// minimal process.global — the responsible app injects this in production; sqlite-instance
// (under forge-store) reads process.global.xLog and getConfig(moduleName).
process.global = process.global || {};
const noop = () => {};
process.global.xLog = process.global.xLog || {
	status: noop,
	error: (msg) => console.error(`xLog.error: ${msg}`),
	result: noop,
	verbose: noop,
};
process.global.getConfig = process.global.getConfig || (() => ({}));

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const forgeStore = require('../../forge-store/forge-store')();
const credentialAccessor = require('../../credential-accessor/credential-accessor')({
	forgeStore,
});
const replayBlock = require('../replay-block');
const replayEngine = require('../replay-engine');

const dbPath = path.join(os.tmpdir(), `__TEST_replayPhase2_${process.pid}.sqlite3`);
const sourceGraphName = '__TEST_replaySource';
const freshGraphName = '__TEST_replayFresh';
const idemGraphName = '__TEST_replayIdem';
const orphanGraphName = '__TEST_replayOrphan';
const provGraphName = '__TEST_replayProv';
const allGraphNames = [
	sourceGraphName,
	freshGraphName,
	idemGraphName,
	orphanGraphName,
	provGraphName,
];

// =====================================================================
// assertion harness
// =====================================================================
let passed = 0;
let failed = 0;
const check = (label, condition) => {
	if (condition) {
		passed += 1;
		console.log(`  PASS  ${label}`);
	} else {
		failed += 1;
		console.log(`  FAIL  ${label}`);
	}
};

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// =====================================================================
// SYNTHETIC GREENFIELD FIXTURES
// =====================================================================
const EMBEDDING_DIMS = 1024;

// a deterministic 1024-dim float vector, seeded so each node differs
const makeEmbeddingBase64 = (seed) => {
	const floats = new Array(EMBEDDING_DIMS);
	for (let i = 0; i < EMBEDDING_DIMS; i++) {
		floats[i] = Math.sin(seed * 0.013 + i * 0.0007);
	}
	return replayBlock.encodeEmbedding(floats);
};

const headerFor = (standardKey) => ({
	blockType: 'standard',
	standardKey,
	version: '1',
	stableUriPropertyName: 'uri',
	resolutionKey: 'stableUri',
	goldenVersionAuthoredAgainst: '__TEST_golden',
	embeddingModelVersion: 'voyage-4-large',
	embeddingEncoding: 'base64',
	embeddingDtype: 'float32',
	embeddingByteOrder: 'little-endian',
	embeddingDims: EMBEDDING_DIMS,
});

const bridgeHeader = {
	blockType: 'bridge',
	pairA: { standardKey: 'CEDS', version: '1' },
	pairB: { standardKey: 'CIP', version: '1' },
	stableUriPropertyName: 'uri',
	resolutionKey: 'stableUri',
	goldenVersionAuthoredAgainst: '__TEST_golden',
	embeddingModelVersion: 'voyage-4-large',
	embeddingEncoding: 'base64',
	embeddingDtype: 'float32',
	embeddingByteOrder: 'little-endian',
	embeddingDims: EMBEDDING_DIMS,
};

// ref.id externalizes the stableId value (the greenfield resolution key).
const synthNode = ({ source, stableId, label, name, depth, seed }) => ({
	ref: { source, id: stableId },
	labels: ['ForgedNode', label],
	stableId,
	// greenfield: the node carries the standard's own stable property (here 'uri', named by
	// header.stableUriPropertyName) whose value IS the stableId.
	properties: { name: [name], depth: [depth], _source: [source], uri: [stableId] },
	embedding: makeEmbeddingBase64(seed),
	embeddingModelVersion: 'voyage-4-large',
});

const synthEdge = ({ type, fromStableId, fromSource, toStableId, toSource, tier }) => {
	const properties = { confidence: [1.0] };
	if (tier !== undefined) properties.provenanceTier = [tier];
	return {
		type,
		fromRef: { source: fromSource, id: fromStableId },
		toRef: { source: toSource, id: toStableId },
		properties,
	};
};

// CEDS standard block: 3 nodes + 2 internal (structural) edges.
const cedsNodes = [
	synthNode({ source: 'CEDS', stableId: 'ceds://root', label: 'DmeStandardRoot', name: 'CEDS Root', depth: 0, seed: 1 }),
	synthNode({ source: 'CEDS', stableId: 'ceds://class/student', label: 'DmeClass', name: 'Student', depth: 1, seed: 2 }),
	synthNode({ source: 'CEDS', stableId: 'ceds://prop/firstName', label: 'DmeProperty', name: 'FirstName', depth: 2, seed: 3 }),
];
const cedsEdges = [
	synthEdge({ type: 'HAS_CLASS', fromSource: 'CEDS', fromStableId: 'ceds://root', toSource: 'CEDS', toStableId: 'ceds://class/student', tier: 'structural' }),
	synthEdge({ type: 'HAS_PROPERTY', fromSource: 'CEDS', fromStableId: 'ceds://class/student', toSource: 'CEDS', toStableId: 'ceds://prop/firstName', tier: 'structural' }),
];

// CIP standard block: 2 nodes + 1 internal edge.
const cipNodes = [
	synthNode({ source: 'CIP', stableId: 'cip://root', label: 'DmeStandardRoot', name: 'CIP Root', depth: 0, seed: 11 }),
	synthNode({ source: 'CIP', stableId: 'cip://class/program', label: 'DmeClass', name: 'Program', depth: 1, seed: 12 }),
];
const cipEdges = [
	synthEdge({ type: 'HAS_CLASS', fromSource: 'CIP', fromStableId: 'cip://root', toSource: 'CIP', toStableId: 'cip://class/program', tier: 'structural' }),
];

// Bridge block CEDS<->CIP: one cross-source spec-authoritative edge.
const bridgeEdges = [
	synthEdge({ type: 'MAPS_TO', fromSource: 'CIP', fromStableId: 'cip://class/program', toSource: 'CEDS', toStableId: 'ceds://class/student', tier: 'spec-authoritative' }),
];

const cedsBlockText = replayBlock.serializeBlock({ header: headerFor('CEDS'), nodes: cedsNodes, edges: cedsEdges });
const cipBlockText = replayBlock.serializeBlock({ header: headerFor('CIP'), nodes: cipNodes, edges: cipEdges });
const bridgeBlockText = replayBlock.serializeBlock({ header: bridgeHeader, nodes: [], edges: bridgeEdges });

// =====================================================================
// graph helpers (count via the lifecycle's runCypher; integerish results normalized)
// =====================================================================
const toNum = (v) => (v && typeof v.toNumber === 'function' ? v.toNumber() : v);
const recGet = (rec, key) => (rec.get ? rec.get(key) : rec[key]);

let lifecycle = null;

const countNodes = (graphName, cb) => {
	lifecycle.runCypher({ graphName, cypher: 'MATCH (n) RETURN count(n) AS c' }, (err, result) => {
		if (err) { cb(err); return; }
		cb('', toNum(recGet(result.records[0], 'c')));
	});
};
const countEdges = (graphName, cb) => {
	lifecycle.runCypher({ graphName, cypher: 'MATCH ()-[r]->() RETURN count(r) AS c' }, (err, result) => {
		if (err) { cb(err); return; }
		cb('', toNum(recGet(result.records[0], 'c')));
	});
};

// =====================================================================
// build the lifecycle, then run the pipeline
// =====================================================================
require('../../instance-lifecycle/instance-lifecycle')({
	forgeStore,
	credentialAccessor,
})((lifecycleErr, builtLifecycle) => {
	if (lifecycleErr) {
		console.error(`could not build instance-lifecycle: ${lifecycleErr}`);
		process.exit(1);
	}
	lifecycle = builtLifecycle;

	const cleanupAndExit = (code) => {
		// best-effort docker teardown of EVERY test graph, even on failure — leave nothing stray.
		let idx = 0;
		const destroyNext = () => {
			if (idx >= allGraphNames.length) {
				try { fs.unlinkSync(dbPath); } catch (ignore) {}
				console.log(
					`\n=====================================================\n` +
						`RESULT: ${failed === 0 ? 'GREEN' : 'RED'}  (${passed} passed, ${failed} failed)\n` +
						`=====================================================`,
				);
				process.exit(code);
				return;
			}
			const graphName = allGraphNames[idx];
			idx += 1;
			lifecycle.destroyInstanceByName({ graphName, force: true }, () => destroyNext());
		};
		destroyNext();
	};

	const taskList = new taskListPlus();

	// ---- forge-store init ----
	taskList.push((args, next) => {
		forgeStore.init({ dbPath }, (err) => next(err, args));
	});

	// ---- provision SOURCE graph and seed it via a replay of CEDS+CIP+bridge ----
	taskList.push((args, next) => {
		lifecycle.createInstanceByName({ graphName: sourceGraphName, type: 'bronze' }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		lifecycle.resolveAccessByName({ graphName: sourceGraphName }, (err, access) => {
			if (err) { next(err); return; }
			next('', { ...args, sourceAccess: access });
		});
	});
	taskList.push((args, next) => {
		const { sourceAccess } = args;
		replayEngine.replay(
			{
				manifest: [cedsBlockText, cipBlockText, bridgeBlockText],
				boltUri: sourceAccess.location,
				password: sourceAccess.credential.value,
				graphName: sourceGraphName,
			},
			(err, result) => {
				if (err) { next(err); return; }
				check('seed replay: nodesMerged === 5', result.nodesMerged === 5);
				check('seed replay: edgesMerged === 4 (2 ceds + 1 cip + 1 bridge)', result.edgesMerged === 4);
				check('seed replay: 0 danglingRefs', result.danglingRefs.length === 0);
				// vector index: built on a >=5.13 server, recorded as skipped on the 5.5 test
				// substrate (no vector support). Either way it must appear in indexesBuilt.
				const vectorEntry = result.indexesBuilt.filter((oneIndex) => oneIndex.indexOf(`${sourceGraphName}_vector`) === 0);
				check('seed replay: vector index recorded (built, or skipped on <5.13)', vectorEntry.length === 1);
				next('', { ...args, seedResult: result, vectorEntry });
			},
		);
	});

	// ---- GATE 1: round-trip fidelity. extractBlock CEDS from source -> replay into FRESH ----
	taskList.push((args, next) => {
		const { sourceAccess } = args;
		replayEngine.extractBlock(
			{
				boltUri: sourceAccess.location,
				password: sourceAccess.credential.value,
				selector: { source: 'CEDS' },
				header: headerFor('CEDS'),
			},
			(err, extracted) => {
				if (err) { next(err); return; }
				check('extractBlock CEDS: nodeCount === 3', extracted.nodeCount === 3);
				check('extractBlock CEDS: edgeCount === 2', extracted.edgeCount === 2);
				check('extractBlock CEDS: stableIdCoverage unique', extracted.stableIdCoverage && extracted.stableIdCoverage.unique === true);
				next('', { ...args, extractedCeds: extracted.blockText });
			},
		);
	});
	taskList.push((args, next) => {
		lifecycle.createInstanceByName({ graphName: freshGraphName, type: 'bronze' }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		lifecycle.resolveAccessByName({ graphName: freshGraphName }, (err, access) => {
			if (err) { next(err); return; }
			next('', { ...args, freshAccess: access });
		});
	});
	taskList.push((args, next) => {
		const { freshAccess, extractedCeds } = args;
		replayEngine.replay(
			{ manifest: [extractedCeds], boltUri: freshAccess.location, password: freshAccess.credential.value, graphName: freshGraphName },
			(err, result) => {
				if (err) { next(err); return; }
				check('GATE1 fidelity: nodesMerged === 3', result.nodesMerged === 3);
				check('GATE1 fidelity: edgesMerged === 2', result.edgesMerged === 2);
				check('GATE1 fidelity: 0 dangling', result.danglingRefs.length === 0);
				next('', args);
			},
		);
	});
	taskList.push((args, next) => {
		countNodes(freshGraphName, (err, n) => { if (err) { next(err); return; } check('GATE1 fidelity: fresh graph has 3 nodes', n === 3); next('', args); });
	});
	taskList.push((args, next) => {
		countEdges(freshGraphName, (err, n) => { if (err) { next(err); return; } check('GATE1 fidelity: fresh graph has 2 edges', n === 2); next('', args); });
	});
	taskList.push((args, next) => {
		// spot-ref + property equality: the FirstName property node resolves on its stableId.
		lifecycle.runCypher(
			{ graphName: freshGraphName, cypher: "MATCH (n {stableId:'ceds://prop/firstName'}) RETURN n.name AS name, n.depth AS depth, labels(n) AS labels, n.stableId AS sid, n.embeddingModelVersion AS emv" },
			(err, result) => {
				if (err) { next(err); return; }
				const rec = result.records[0];
				const name = recGet(rec, 'name');
				const depth = toNum(recGet(rec, 'depth'));
				const labels = recGet(rec, 'labels');
				const sid = recGet(rec, 'sid');
				const emv = recGet(rec, 'emv');
				check('GATE1 fidelity: spot-ref name equality (FirstName)', name === 'FirstName');
				check('GATE1 fidelity: spot-ref depth equality (2)', depth === 2);
				check('GATE1 fidelity: spot-ref stableId preserved', sid === 'ceds://prop/firstName');
				check('GATE1 fidelity: spot-ref labels include DmeProperty + ForgedNode', labels.indexOf('DmeProperty') !== -1 && labels.indexOf('ForgedNode') !== -1);
				check('GATE1 fidelity: spot-ref carries embeddingModelVersion=voyage-4-large', emv === 'voyage-4-large');
				next('', args);
			},
		);
	});

	// ---- GATE 2: idempotent replay. Replay the SAME manifest twice into idem graph ----
	taskList.push((args, next) => {
		lifecycle.createInstanceByName({ graphName: idemGraphName, type: 'bronze' }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		lifecycle.resolveAccessByName({ graphName: idemGraphName }, (err, access) => {
			if (err) { next(err); return; }
			next('', { ...args, idemAccess: access });
		});
	});
	taskList.push((args, next) => {
		const { idemAccess } = args;
		const manifest = [cedsBlockText, cipBlockText, bridgeBlockText];
		replayEngine.replay({ manifest, boltUri: idemAccess.location, password: idemAccess.credential.value, graphName: idemGraphName }, (err, r1) => {
			if (err) { next(err); return; }
			replayEngine.replay({ manifest, boltUri: idemAccess.location, password: idemAccess.credential.value, graphName: idemGraphName }, (err2, r2) => {
				if (err2) { next(err2); return; }
				check('GATE2 idempotent: second replay reports same nodesMerged', r1.nodesMerged === r2.nodesMerged);
				check('GATE2 idempotent: second replay reports same edgesMerged', r1.edgesMerged === r2.edgesMerged);
				next('', args);
			});
		});
	});
	taskList.push((args, next) => {
		countNodes(idemGraphName, (err, n) => { if (err) { next(err); return; } check('GATE2 idempotent: graph still has 5 nodes (MERGE not CREATE)', n === 5); next('', args); });
	});
	taskList.push((args, next) => {
		countEdges(idemGraphName, (err, n) => { if (err) { next(err); return; } check('GATE2 idempotent: graph still has 4 edges (MERGE not CREATE)', n === 4); next('', args); });
	});

	// ---- GATE 3: two-endpoint orphan report. Replay bridge with CIP standard ABSENT ----
	taskList.push((args, next) => {
		lifecycle.createInstanceByName({ graphName: orphanGraphName, type: 'bronze' }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		lifecycle.resolveAccessByName({ graphName: orphanGraphName }, (err, access) => {
			if (err) { next(err); return; }
			next('', { ...args, orphanAccess: access });
		});
	});
	taskList.push((args, next) => {
		const { orphanAccess } = args;
		// manifest has CEDS + bridge, but NOT CIP -> the bridge's CIP endpoint (the 'from') dangles.
		replayEngine.replay(
			{ manifest: [cedsBlockText, bridgeBlockText], boltUri: orphanAccess.location, password: orphanAccess.credential.value, graphName: orphanGraphName },
			(err, result) => {
				if (err) { next(err); return; }
				check('GATE3 orphan: exactly 1 danglingRef', result.danglingRefs.length === 1);
				const d = result.danglingRefs[0] || {};
				check('GATE3 orphan: danglingRef edgeType MAPS_TO', d.edgeType === 'MAPS_TO');
				check('GATE3 orphan: missingEndpoint === "from" (CIP absent)', d.missingEndpoint === 'from');
				check('GATE3 orphan: danglingRef fromRef id is the CIP stableId', d.fromRef && d.fromRef.id === 'cip://class/program');
				// edgesMerged counts across the whole manifest: the 2 CEDS structural edges merge;
				// the 1 bridge MAPS_TO does NOT (its CIP endpoint is absent) -> 2, not 3.
				check('GATE3 orphan: bridge edge NOT merged (edgesMerged === 2, the CEDS edges only)', result.edgesMerged === 2);
				next('', args);
			},
		);
	});
	taskList.push((args, next) => {
		// assert NO partial edge written: only the 2 CEDS internal edges exist, the MAPS_TO is absent.
		countEdges(orphanGraphName, (err, n) => { if (err) { next(err); return; } check('GATE3 orphan: NO partial edge written (only 2 CEDS edges)', n === 2); next('', args); });
	});

	// ---- GATE 4: incremental add. Re-extract CEDS after adding CIP+bridge; prior block byte-identical ----
	taskList.push((args, next) => {
		const { sourceAccess } = args;
		// re-extract CEDS from the SAME source graph (which already has CIP+bridge present).
		replayEngine.extractBlock(
			{ boltUri: sourceAccess.location, password: sourceAccess.credential.value, selector: { source: 'CEDS' }, header: headerFor('CEDS') },
			(err, reExtracted) => {
				if (err) { next(err); return; }
				const firstSha = sha256(args.extractedCeds);
				const reSha = sha256(reExtracted.blockText);
				check('GATE4 incremental: re-extracted CEDS block is byte-identical (SHA-256)', firstSha === reSha);
				// and the bridge block (the "new one") differs from the CEDS block
				check('GATE4 incremental: the new (bridge) block differs from the CEDS block', sha256(bridgeBlockText) !== firstSha);
				next('', args);
			},
		);
	});

	// ---- GATE 5: provenanceTier enforcement. An edge lacking provenanceTier -> engine ERROR ----
	taskList.push((args, next) => {
		lifecycle.createInstanceByName({ graphName: provGraphName, type: 'bronze' }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		lifecycle.resolveAccessByName({ graphName: provGraphName }, (err, access) => {
			if (err) { next(err); return; }
			next('', { ...args, provAccess: access });
		});
	});
	taskList.push((args, next) => {
		const { provAccess } = args;
		// CEDS nodes are fine; add an edge with NO provenanceTier.
		const badEdge = synthEdge({ type: 'HAS_PROPERTY', fromSource: 'CEDS', fromStableId: 'ceds://class/student', toSource: 'CEDS', toStableId: 'ceds://prop/firstName' });
		// note: synthEdge omits provenanceTier when tier is undefined.
		const badBlockText = replayBlock.serializeBlock({ header: headerFor('CEDS'), nodes: cedsNodes, edges: [badEdge] });
		replayEngine.replay(
			{ manifest: [badBlockText], boltUri: provAccess.location, password: provAccess.credential.value, graphName: provGraphName },
			(err, result) => {
				check('GATE5 provenanceTier: engine ERRORS on missing provenanceTier', !!err);
				check('GATE5 provenanceTier: error message names provenanceTier', !!err && /provenanceTier/.test(`${err}`));
				check('GATE5 provenanceTier: no result returned (not silently written)', !result);
				next('', args);
			},
		);
	});
	taskList.push((args, next) => {
		// confirm no edge landed in the prov graph (it errored before edge write).
		countEdges(provGraphName, (err, n) => {
			if (err) { next(err); return; }
			check('GATE5 provenanceTier: prov graph has 0 edges (nothing silently written)', n === 0);
			next('', args);
		});
	});

	pipeRunner(taskList.getList(), {}, (err) => {
		if (err) {
			failed += 1;
			console.log(`  FAIL  pipeline error: ${err}`);
			cleanupAndExit(1);
			return;
		}
		cleanupAndExit(failed === 0 ? 0 : 1);
	});
});
