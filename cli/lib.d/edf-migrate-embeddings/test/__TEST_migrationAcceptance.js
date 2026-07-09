#!/usr/bin/env node
'use strict';

// =====================================================================
// Phase-5 TIGHT ACCEPTANCE HARNESS — embedding-sidecar migration (SOLAR_HORIZON, 2026-07-09).
//
// Proves the option-(a) canonicalized migration of golden A introduced ONLY the expected
// canonicalization and nothing else, on REAL materialized Neo4j graphs (the load-bearing compare
// carried since Phase 3). Per GILDED_PRISM's marching orders (TQ ruling):
//   (i)  STRUCTURAL: replay(legacy A) vs replay(migrated A) are structurallyEquivalent — same nodes,
//        same edges, every non-embedding property byte-equal (zero tolerance).
//   (ii) EMBEDDINGS: byte-identical on every node EXCEPT exactly the census collision set; the set of
//        embedding-divergent stableIds must EQUAL the predicted divergent set (count == 3,622 for A,
//        same identities), and each divergent node's cosine to its legacy vector is within the measured
//        envelope (>= ~0.976, maxAbsDiff <= ~0.022) — no node moved MORE than predicted.
//   (iii) FORWARD DETERMINISM (Phase-4-deferred Option C): replay(migrated) twice -> byteIdentical graphs.
//
// Runs against a COPY store + scratch per-standard vector stores. Builds EPHEMERAL bronze scratch graphs
// (self-named, pid-stamped, non-production) and TEARS THEM DOWN (force) even on failure. Dynamic
// docker-ps protected-port guard: aborts if any scratch graph is assigned a port a running gf_* holds.
// Live store, production golden, and its pointer are NEVER touched.
//
// USAGE:
//   node __TEST_migrationAcceptance.js --db=<copyStore> --vectorStoreDir=<dir> \
//        --legacyManifest=<keyA> --migratedManifest=<keyDf> --expected=<divergence-expected.json>
//
// Async style: callback + qtools-asynchronous-pipe-plus; NO async/await, NO try/catch for control flow.
// =====================================================================

const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

process.global = process.global || {};
const noop = () => {};
process.global.xLog = process.global.xLog || {
	status: (msg) => console.error(msg),
	error: (msg) => console.error(`xLog.error: ${msg}`),
	result: (msg) => console.log(msg),
	verbose: noop,
};
process.global.getConfig = process.global.getConfig || (() => ({}));

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const CORE = path.join(__dirname, '../../../../npm/qtools-graph-forge-core/lib');
const forgeStore = require(path.join(CORE, 'forge-store/forge-store'))();
const credentialAccessor = require(path.join(CORE, 'credential-accessor/credential-accessor'))({ forgeStore });
const replayEngine = require(path.join(CORE, 'replay/replay-engine'));
const vectorStoreFactory = require(path.join(CORE, 'vector-store/vector-store'));
const { vectorStoreDbPathForStandard } = require(path.join(CORE, 'vector-store/vector-store-path'))();

const GATE = path.join(__dirname, '../../edf-gate/lib');
const graphFingerprintFactory = require(path.join(GATE, 'graph-fingerprint/graphFingerprint'));
const graphDiffFactory = require(path.join(GATE, 'graph-diff/graphDiff'));
const graphEquivalenceFactory = require(path.join(GATE, 'graph-equivalence/graphEquivalence'));

// -----
// CLI params
const arg = (name) => {
	const hit = process.argv.find((oneArg) => oneArg.indexOf(`--${name}=`) === 0);
	return hit ? hit.slice(name.length + 3) : undefined;
};
const dbPath = arg('db');
const vectorStoreDir = arg('vectorStoreDir');
const legacyManifest = arg('legacyManifest');
const migratedManifest = arg('migratedManifest');
const expectedPath = arg('expected');
if (!dbPath || !vectorStoreDir || !legacyManifest || !migratedManifest || !expectedPath) {
	console.error('usage: --db= --vectorStoreDir= --legacyManifest= --migratedManifest= --expected=');
	process.exit(2);
}
process.env.EDF_FORGE_VECTORSTORE_DIR = vectorStoreDir; // storeResolver reads migrated vectors from here

const pid = process.pid;
const legacyGraphName = `__TEST_phase5AcceptLegacy_${pid}`;
const migratedGraphName = `__TEST_phase5AcceptMigrated_${pid}`;
const determBGraphName = `__TEST_phase5DetermB_${pid}`;
const allGraphNames = [legacyGraphName, migratedGraphName, determBGraphName];

const ENVELOPE_COSINE_MIN = 0.976 - 1e-6;
const ENVELOPE_MAXABSDIFF_MAX = 0.0225;

let passed = 0;
let failed = 0;
const check = (label, condition, detail) => {
	if (condition) { passed += 1; console.log(`  PASS  ${label}${detail ? '  ' + detail : ''}`); }
	else { failed += 1; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
};

// -----
// dynamic protected-port set from docker ps (host-published ports of running gf_* containers)
const getProtectedPorts = (callback) => {
	execFile('docker', ['ps', '--format', '{{.Names}} {{.Ports}}'], (err, stdout) => {
		if (err) { callback('', new Set()); return; } // if docker ps unavailable, allocator still skips bound ports
		const protectedPorts = new Set();
		`${stdout}`.split('\n').forEach((line) => {
			if (!/(^|\s)gf_/.test(line)) return;
			const portMatches = `${line}`.match(/0\.0\.0\.0:(\d+)->/g) || [];
			portMatches.forEach((m) => {
				const p = parseInt(m.replace(/0\.0\.0\.0:/, '').replace(/->/, ''), 10);
				if (!Number.isNaN(p)) protectedPorts.add(p);
			});
		});
		callback('', protectedPorts);
	});
};
const portFromLocation = (location) => {
	const m = `${location}`.match(/:(\d+)\s*$/);
	return m ? parseInt(m[1], 10) : NaN;
};

// -----
// per-standard READ storeResolver over the scratch vector stores (mirrors edfReplay.buildStoreResolver)
const storeCache = new Map();
const storeResolver = (standardKey, callback) => {
	if (storeCache.has(standardKey)) { callback('', storeCache.get(standardKey)); return; }
	let vectorDbPath;
	try { vectorDbPath = vectorStoreDbPathForStandard({ projectRoot: '/unused-env-overrides', standardKey }); }
	catch (pathErr) { callback(`storeResolver: ${pathErr.message}`); return; }
	if (!fs.existsSync(vectorDbPath)) { callback(`storeResolver: no vector store for standard '${standardKey}' at ${vectorDbPath}`); return; }
	const store = vectorStoreFactory();
	store.init({ dbPath: vectorDbPath }, (initErr) => {
		if (initErr) { callback(`storeResolver: init '${standardKey}': ${initErr}`); return; }
		storeCache.set(standardKey, store);
		callback('', store);
	});
};

// -----
// load a manifest's block texts in replay order (standards/reference first, then bridge/mapping/etc.)
const TYPE_PRIORITY = { standard: 0, reference: 1, mapping: 2, bridge: 3, inferredDecision: 4 };
const loadManifestBlockTexts = (manifestKey, callback) => {
	forgeStore.getManifest({ manifestKey }, (mErr, manifest) => {
		if (mErr) { callback(mErr); return; }
		if (!manifest) { callback(`no manifest '${manifestKey}'`); return; }
		const members = manifest.members || [];
		const rows = [];
		const taskList = new taskListPlus();
		members.forEach((oneMember) => {
			taskList.push((args, next) => {
				forgeStore.getBlock({ blockId: oneMember.blockId }, (bErr, row) => {
					if (bErr) { next(bErr, args); return; }
					rows.push(row);
					next('', args);
				});
			});
		});
		pipeRunner(taskList.getList(), {}, (err) => {
			if (err) { callback(err); return; }
			rows.sort((a, b) => (TYPE_PRIORITY[a.type] ?? 9) - (TYPE_PRIORITY[b.type] ?? 9));
			callback('', rows.map((oneRow) => oneRow.text));
		});
	});
};

// =====================================================================
// vector math for the envelope check
const l2 = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const cosine = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; const na = l2(a), nb = l2(b); return na && nb ? d / (na * nb) : 0; };
const maxAbs = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) { const x = Math.abs(a[i] - b[i]); if (x > m) m = x; } return m; };
const toNum = (v) => (v && typeof v.toNumber === 'function' ? v.toNumber() : v);

// fetch embeddings for a set of stableIds from one graph, in batches
const fetchEmbeddings = (lifecycle, graphName, stableIds, callback) => {
	const out = new Map();
	const batchSize = 400;
	const batches = [];
	for (let i = 0; i < stableIds.length; i += batchSize) batches.push(stableIds.slice(i, i + batchSize));
	const taskList = new taskListPlus();
	batches.forEach((oneBatch) => {
		taskList.push((args, next) => {
			lifecycle.runCypher(
				{ graphName, cypher: 'MATCH (n:`ForgedNode`) WHERE n.stableId IN $ids RETURN n.stableId AS sid, n.embedding AS emb', params: { ids: oneBatch } },
				(err, result) => {
					if (err) { next(err, args); return; }
					(result.records || []).forEach((rec) => {
						const sid = rec.get ? rec.get('sid') : rec.sid;
						const emb = rec.get ? rec.get('emb') : rec.emb;
						out.set(sid, (emb || []).map(toNum));
					});
					next('', args);
				},
			);
		});
	});
	pipeRunner(taskList.getList(), {}, (err) => callback(err, err ? undefined : out));
};

// =====================================================================
// MAIN
// =====================================================================
const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
const expectedDivergent = (expected.divergentStableIds || []).slice().sort();

let lifecycle = null;
let fingerprinter = null;
let equivalence = null;

const cleanupAndExit = (code) => {
	let idx = 0;
	const destroyNext = () => {
		if (idx >= allGraphNames.length) {
			console.log(`\n=====================================================\nRESULT: ${failed === 0 ? 'GREEN' : 'RED'}  (${passed} passed, ${failed} failed)\n=====================================================`);
			process.exit(code);
			return;
		}
		const graphName = allGraphNames[idx];
		idx += 1;
		if (!lifecycle) { destroyNext(); return; }
		lifecycle.destroyInstanceByName({ graphName, force: true }, () => destroyNext());
	};
	destroyNext();
};

const provisionAndReplay = ({ graphName, manifestTexts, useResolver }, callback) => {
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		lifecycle.createInstanceByName({ graphName, type: 'bronze' }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		lifecycle.resolveAccessByName({ graphName }, (err, access) => {
			if (err) { next(err); return; }
			const port = portFromLocation(access.location);
			if (args.protectedPorts.has(port)) { next(`PORT COLLISION: ${graphName} assigned protected gf_* port ${port} — aborting`); return; }
			check(`port-safety: ${graphName} on ${port} not in protected set`, !args.protectedPorts.has(port), `[protected: ${[...args.protectedPorts].join(',')}]`);
			next('', { ...args, access });
		});
	});
	taskList.push((args, next) => {
		replayEngine.replay(
			{
				manifest: manifestTexts,
				boltUri: args.access.location,
				password: args.access.credential.value,
				graphName,
				storeResolver: useResolver ? storeResolver : undefined,
			},
			(err, result) => {
				if (err) { next(err); return; }
				next('', { ...args, replayResult: result });
			},
		);
	});
	pipeRunner(taskList.getList(), { protectedPorts: callback.protectedPorts }, (err, args) => callback(err, err ? undefined : args.replayResult));
};

// bootstrap: forgeStore.init(COPY) -> lifecycle -> fingerprinter/equivalence -> protected ports
forgeStore.init({ dbPath }, (initErr) => {
	if (initErr) { console.error(`forgeStore.init: ${initErr}`); process.exit(1); }
	require(path.join(CORE, 'instance-lifecycle/instance-lifecycle'))({ forgeStore, credentialAccessor })((lcErr, builtLifecycle) => {
		if (lcErr) { console.error(`instance-lifecycle: ${lcErr}`); process.exit(1); }
		lifecycle = builtLifecycle;
		fingerprinter = graphFingerprintFactory({ lifecycle });
		equivalence = graphEquivalenceFactory({ fingerprinter, differ: graphDiffFactory() });

		const taskList = new taskListPlus();
		let ctx = {};

		taskList.push((args, next) => getProtectedPorts((e, protectedPorts) => { ctx.protectedPorts = protectedPorts; next(e, args); }));
		taskList.push((args, next) => loadManifestBlockTexts(legacyManifest, (e, texts) => { ctx.legacyTexts = texts; next(e, args); }));
		taskList.push((args, next) => loadManifestBlockTexts(migratedManifest, (e, texts) => { ctx.migratedTexts = texts; next(e, args); }));

		// provision + replay legacy (inline, no resolver)
		taskList.push((args, next) => {
			const cb = (e, r) => { if (e) { next(e); return; } check('replay legacy: nodesMerged > 0', r.nodesMerged > 0, `[${r.nodesMerged} nodes, ${r.edgesMerged} edges]`); next('', args); };
			cb.protectedPorts = ctx.protectedPorts;
			provisionAndReplay({ graphName: legacyGraphName, manifestTexts: ctx.legacyTexts, useResolver: false }, Object.assign(cb, { protectedPorts: ctx.protectedPorts }));
		});
		// provision + replay migrated (WITH resolver)
		taskList.push((args, next) => {
			const cb = (e, r) => { if (e) { next(e); return; } check('replay migrated: nodesMerged matches legacy', r.nodesMerged > 0, `[${r.nodesMerged} nodes, ${r.edgesMerged} edges]`); next('', args); };
			provisionAndReplay({ graphName: migratedGraphName, manifestTexts: ctx.migratedTexts, useResolver: true }, Object.assign(cb, { protectedPorts: ctx.protectedPorts }));
		});

		// THE TIGHT ACCEPTANCE: assertGraphEquivalence(legacy, migrated)
		taskList.push((args, next) => {
			equivalence.assertGraphEquivalence({ graphA: legacyGraphName, graphB: migratedGraphName }, (err, verdict) => {
				if (err) { next(err); return; }
				ctx.verdict = verdict;
				check('acceptance valid (nonEmpty + embeddingAxisLive)', verdict.valid === true);
				check('(i) STRUCTURAL byte-identical (structurallyEquivalent, zero non-embedding change)', verdict.structurallyEquivalent === true,
					`[added ${verdict.counts.addedNodes}, removed ${verdict.counts.removedNodes}, structuralChanged ${verdict.counts.structuralChangedNodes}, addedEdges ${verdict.counts.addedEdges}, removedEdges ${verdict.counts.removedEdges}]`);
				check(`(ii) embedding-divergent count == predicted ${expectedDivergent.length} (per-standard canonicalization set)`, verdict.embeddingDivergentCount === expectedDivergent.length,
					`[actual ${verdict.embeddingDivergentCount}, expected ${expectedDivergent.length}]`);
				const actualDivergent = (verdict.embeddingDivergence || []).slice().sort();
				const identical = actualDivergent.length === expectedDivergent.length && actualDivergent.every((sid, i) => sid === expectedDivergent[i]);
				check('(ii) embedding-divergent SET identities == predicted set exactly', identical);
				check('sanity: NOT byteIdentical (embeddings deliberately canonicalized)', verdict.byteIdentical === false);
				next('', args);
			});
		});

		// ENVELOPE: fetch divergent nodes' vectors from both graphs, measure cosine/maxAbsDiff
		taskList.push((args, next) => {
			fetchEmbeddings(lifecycle, legacyGraphName, expectedDivergent, (e, legacyEmb) => {
				if (e) { next(e); return; } ctx.legacyEmb = legacyEmb; next('', args);
			});
		});
		taskList.push((args, next) => {
			fetchEmbeddings(lifecycle, migratedGraphName, expectedDivergent, (e, migratedEmb) => {
				if (e) { next(e); return; } ctx.migratedEmb = migratedEmb; next('', args);
			});
		});
		taskList.push((args, next) => {
			let minCos = 2, maxMad = 0, measured = 0, outOfEnvelope = 0;
			expectedDivergent.forEach((sid) => {
				const a = ctx.legacyEmb.get(sid), b = ctx.migratedEmb.get(sid);
				if (!a || !b || a.length !== b.length) return;
				measured += 1;
				const c = cosine(a, b), m = maxAbs(a, b);
				if (c < minCos) minCos = c;
				if (m > maxMad) maxMad = m;
				if (c < ENVELOPE_COSINE_MIN || m > ENVELOPE_MAXABSDIFF_MAX) outOfEnvelope += 1;
			});
			check('(ii) all divergent nodes measured in both graphs', measured === expectedDivergent.length, `[measured ${measured}/${expectedDivergent.length}]`);
			check('(ii) NO divergent node moved beyond the census envelope', outOfEnvelope === 0,
				`[minCosine ${minCos.toFixed(6)}, maxMaxAbsDiff ${maxMad.toFixed(6)}, outOfEnvelope ${outOfEnvelope}]`);
			ctx.envelope = { minCosine: minCos, maxMaxAbsDiff: maxMad, measured };
			next('', args);
		});

		// tear down the legacy graph now (its last use was the envelope fetch) so at most TWO large
		// neo4j:5.26 containers run at once — memory mitigation (Docker-OOM discipline).
		taskList.push((args, next) => {
			lifecycle.destroyInstanceByName({ graphName: legacyGraphName, force: true }, () => next('', args));
		});

		// (iii) FORWARD DETERMINISM: replay migrated again -> byteIdentical to first migrated graph
		taskList.push((args, next) => {
			const cb = (e, r) => { if (e) { next(e); return; } check('replay migrated (2nd, determinism): nodesMerged > 0', r.nodesMerged > 0); next('', args); };
			provisionAndReplay({ graphName: determBGraphName, manifestTexts: ctx.migratedTexts, useResolver: true }, Object.assign(cb, { protectedPorts: ctx.protectedPorts }));
		});
		taskList.push((args, next) => {
			equivalence.assertGraphEquivalence({ graphA: migratedGraphName, graphB: determBGraphName }, (err, verdict) => {
				if (err) { next(err); return; }
				check('(iii) FORWARD DETERMINISM: warm-store replay reproduces byteIdentical graph', verdict.valid === true && verdict.byteIdentical === true,
					`[byteIdentical ${verdict.byteIdentical}, divergent ${verdict.embeddingDivergentCount}]`);
				next('', args);
			});
		});

		// final report line
		taskList.push((args, next) => {
			console.log('\nACCEPTANCE SUMMARY: ' + JSON.stringify({
				structurallyEquivalent: ctx.verdict.structurallyEquivalent,
				byteIdentical: ctx.verdict.byteIdentical,
				embeddingDivergentCount: ctx.verdict.embeddingDivergentCount,
				predictedDivergentCount: expectedDivergent.length,
				envelope: ctx.envelope,
				regime: ctx.verdict.regime,
				nodeCountLegacy: ctx.verdict.nodeCountA,
				nodeCountMigrated: ctx.verdict.nodeCountB,
			}));
			next('', args);
		});

		pipeRunner(taskList.getList(), {}, (err) => {
			if (err) { failed += 1; console.log(`  FAIL  pipeline error: ${err}`); cleanupAndExit(1); return; }
			cleanupAndExit(failed === 0 ? 0 : 1);
		});
	});
});
