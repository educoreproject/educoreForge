#!/usr/bin/env node
'use strict';

// =====================================================================
// pilotPhase4-materialize-leg — Phase 4 MATERIALIZED gates + the deliverable
// (SPECIFICATION v2 S14 gates; IMPLEMENTATION_PLAN v2 Phase 4; Builder C
// continuing). Consumes /tmp/pilotPhase4-state.json written by
// pilotPhase4-compose-battery.js. RUN WITH: node --max-old-space-size=8192.
// =====================================================================
// Build method (the memory-safe reuse pattern, extended from the compose leg):
// every container is PRE-CREATED by a DIRECT memory-capped docker run
// (--memory=1200m, heap 512m/512m, pagecache 256m, --oom-score-adj=800) and
// pre-REGISTERED in the SCRATCH store's graphs registry, so the sanctioned
// `edf-replay -buildGraph` (replay + storeResolver sidecar reads + FINISHING +
// ownerStamp + GraphProvenance) reuses it instead of provisioning an uncapped
// instance. The deliverable golden therefore has the ESTABLISHED shape (meta
// nodes, owner stamps, provenance passport) while the OOM hard line holds.
//
// Sequence (ONE full-scale graph at a time — the GOLD_EVAL_260716 precedent):
//   ARM A  (determinism): container pilotP4detA -> buildGraph(composed) ->
//          canonical dump/fingerprint -> TEARDOWN.
//   DELIVERABLE: persistent container GOLD_EVAL_260717 (volume
//          GOLD_EVAL_260717_data, --restart unless-stopped) -> buildGraph(same
//          manifest) -> dump/fingerprint -> DETERMINISM = A == deliverable ->
//          S14 gates + the full-scale S9 census + purity, all on the LIVE
//          deliverable -> LEAVE UP (never torn down; not scratch).
//
// S14 gates (mandatory): membership (compose leg) | S9 census at FULL scale |
// preservation (24 CTDL->CEDS EXACT_MATCH + 26 _cedsAnchors) | zero-NULL-
// provenance census over the family cross-standard populations.
// =====================================================================

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const { spawnSync } = require('child_process');

const xLogStub = {
	status: () => {},
	error: (...a) => console.error(...a),
	result: () => {},
	verbose: () => {},
};
process.global = {
	xLog: xLogStub,
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
};

const CODE_ROOT = path.join(__dirname, '..');
const CORE_LIB = path.join(CODE_ROOT, 'npm', 'qtools-graph-forge-core', 'lib');
const CANONICAL_STORE = path.join(CODE_ROOT, '..', 'dataStores', 'forgeStore.sqlite3');
const CANONICAL_SHA256 = '65a49a28dbfe6e393b8a97551197f61a512ce7462ff440ce7b42538cb43252ea' /* re-pinned 2026-07-17: FADED_FORGE incident ruling (Option A) — one inert pilotPhase4 CTDL block appended by the then-unpatched manifestEditor; prior sha 69cd3733… */;
const GOLDEVAL_COPY = '/tmp/goldEval260716.sqlite3';
const GOLDEVAL_SHA256 = 'c346fe25cf1965d06a2f4267332df61e9a0db763bf68bf2e0244728ca29c6abe';
const STATE_PATH = '/tmp/pilotPhase4-state.json';
const DUMP_DIR = '/tmp/pilotPhase4-dumps';
const ARTIFACTS_DIR = path.join(__dirname, 'pilotPhase4Artifacts');
const REPLAY_CLI = path.join(CODE_ROOT, 'cli', 'lib.d', 'edf-replay', 'edfReplay.js');

const FIXTURE_A = require(path.join(__dirname, 'ctdlPilotFixtures', 'fixture-a-familyEndpointTriples.json'));
const familyModule = require(path.join(
	CODE_ROOT, 'cli', 'parserLib', 'forge-ctdl', 'modules', 'ctdlFamilyStructure.js',
));
const { LOCATOR_EDGE } = familyModule;

const forgeStoreFactory = require(path.join(CORE_LIB, 'forge-store', 'forge-store'));
const storeReaderFactory = require(path.join(CORE_LIB, 'store-reader', 'store-reader'));
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const NEO4J_DRIVER_CANDIDATES = [
	path.join(CODE_ROOT, 'npm', 'qtools-graph-forge-core', 'node_modules', 'neo4j-driver'),
	path.join(CODE_ROOT, 'node_modules', 'neo4j-driver'),
	path.join(CODE_ROOT, 'cli', 'node_modules', 'neo4j-driver'),
];
const neo4jDriverPath = NEO4J_DRIVER_CANDIDATES.find((onePath) => fs.existsSync(onePath));
if (!neo4jDriverPath) {
	console.error('pilotPhase4-materialize-leg: no neo4j-driver found');
	process.exit(2);
}
const neo4j = require(neo4jDriverPath);

const NEO4J_IMAGE = 'neo4j:5.26';
// TWO memory profiles (FADED_FORGE memory-fork ruling, 2026-07-17): the 1024-dim
// vector-index BUILD needs native memory beyond the 1200m serving envelope (the
// capped server died at the index step — observed; the GOLD_EVAL_260716 precedent
// built its index UNCAPPED and transplanted databases). BUILD runs hard-capped at
// 2000m (< headroom; an OOM kills ONLY the leg's container); the persistent
// deliverable is then RECREATED on its volume at the proven 1200m SERVING profile.
const BUILD_PROFILE = { memoryMb: 2000, heap: '1g', pagecache: '384m' };
const SERVE_PROFILE = { memoryMb: 1200, heap: '512m', pagecache: '256m' };
const HEADROOM_REQUIRED_MB = 2400;
const FORBIDDEN_PORTS = new Set([
	7700, 7701, 7702, 7703, 7706, 7707, 7708, 7709, 7712, 7713, 7716, 7717,
	7688, 7690, 7475, 7476,
]);
const LIVE_MIRROR_CONTAINERS = ['GOLD_260716', 'gf_pvsEcand'];
const DET_GRAPH_NAME = 'pilotP4detA';
const DELIVERABLE_NAME = 'GOLD_EVAL_260717';
const DELIVERABLE_VOLUME = 'GOLD_EVAL_260717_data';

const FAMILY_SOURCES = ['CTDL', 'CTDLASN', 'CTDLQData'];
const PAIRINGS = ['CTDL::CTDLASN', 'CTDL::CTDLQData', 'CTDLASN::CTDLQData'];
const EXPECTED_FAMILY_EDGES = { 'CTDL::CTDLASN': 311, 'CTDL::CTDLQData': 178, 'CTDLASN::CTDLQData': 17 };
const EXPECTED_RECIPROCALS = { 'CTDL::CTDLASN': 68, 'CTDL::CTDLQData': 79, 'CTDLASN::CTDLQData': 0 };
const EXPECTED_NOVEL = { 'CTDL::CTDLASN': 96, 'CTDL::CTDLQData': 34, 'CTDLASN::CTDLQData': 0 };
const PRE_RULED_CORRECT_LOSSES = [
	'HAS_CLASS|ctdl:root|schema:MonetaryAmount',
	'HAS_CLASS|ctdl:root|schema:QuantitativeValue',
];

let pass = 0;
let fail = 0;
const assert = (label, cond) => {
	if (cond) {
		pass++;
		console.log(`  PASS  ${label}`);
	} else {
		fail++;
		console.log(`  FAIL  ${label}`);
	}
};
const section = (title) => console.log(`\n== ${title} ==`);
const sha256File = (filePath) =>
	`${spawnSync('shasum', ['-a', '256', filePath], { encoding: 'utf8' }).stdout}`.split(' ')[0];
const sha256Text = (text) => crypto.createHash('sha256').update(text).digest('hex');
const tripleKey = (type, fromId, toId) => `${type}|${fromId}|${toId}`;
const docker = (dockerArgs) =>
	spawnSync('docker', dockerArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// ---- container mechanics (the compose leg's, plus persistent-mode flags) -------------
const isPortBindable = (port, callback) => {
	const probe = net.createServer();
	probe.once('error', () => callback(false));
	probe.once('listening', () => probe.close(() => callback(true)));
	probe.listen(port, '0.0.0.0');
};
const dockerMappedPorts = () => {
	const psRun = docker(['ps', '-a', '--format', '{{.Ports}}']);
	const mapped = new Set();
	`${psRun.stdout}`.replace(/[^0-9\n:>-]/g, ' ').split(/\s+/).forEach((oneToken) => {
		const portMatch = oneToken.match(/^(\d{4,5})$/);
		if (portMatch) {
			mapped.add(Number(portMatch[1]));
		}
	});
	return mapped;
};
const findFreePortPair = (startAt, callback) => {
	const mapped = dockerMappedPorts();
	const tryCandidate = (candidate) => {
		if (candidate > 65000) {
			callback('no free bolt/http port pair found');
			return;
		}
		if (
			FORBIDDEN_PORTS.has(candidate) || FORBIDDEN_PORTS.has(candidate + 1) ||
			mapped.has(candidate) || mapped.has(candidate + 1)
		) {
			tryCandidate(candidate + 2);
			return;
		}
		isPortBindable(candidate, (boltFree) => {
			if (!boltFree) {
				tryCandidate(candidate + 2);
				return;
			}
			isPortBindable(candidate + 1, (httpFree) => {
				if (!httpFree) {
					tryCandidate(candidate + 2);
					return;
				}
				callback('', { boltPort: candidate, httpPort: candidate + 1 });
			});
		});
	};
	tryCandidate(startAt);
};

const runContainerWithProfile = ({ containerName, persistent, volumeName, profile, ports, password }) =>
	docker([
		'run', '-d',
		'--name', containerName,
		'-p', `${ports.boltPort}:7687`,
		'-p', `${ports.httpPort}:7474`,
		'--memory', `${profile.memoryMb}m`,
		'--oom-score-adj', '800',
		'-e', `NEO4J_AUTH=neo4j/${password}`,
		'-e', `NEO4J_server_memory_heap_initial__size=${profile.heap}`,
		'-e', `NEO4J_server_memory_heap_max__size=${profile.heap}`,
		'-e', `NEO4J_server_memory_pagecache_size=${profile.pagecache}`,
		'-e', 'NEO4J_PLUGINS=["apoc"]',
		'-e', 'NEO4J_dbms_security_procedures_unrestricted=apoc.*',
		'-e', 'NEO4J_dbms_security_procedures_allowlist=apoc.*',
		...(persistent
			? [
					'-e', 'NEO4J_db_recovery_fail__on__missing__files=false',
					'--restart', 'unless-stopped',
					'-v', `${volumeName}:/data`,
				]
			: []),
		NEO4J_IMAGE,
	]);

const awaitNeo4jReady = ({ containerName, password }, callback) => {
	const deadline = Date.now() + 180000;
	const attemptOne = () => {
		const probe = docker(['exec', containerName, 'cypher-shell', '-u', 'neo4j', '-p', password, 'RETURN 1;']);
		if (probe.status === 0) {
			callback('');
			return;
		}
		if (Date.now() > deadline) {
			callback(`neo4j in ${containerName} not ready within 180s`);
			return;
		}
		setTimeout(attemptOne, 3000);
	};
	setTimeout(attemptOne, 5000);
};

const createCappedContainer = ({ containerName, persistent, volumeName, profile }, callback) => {
	findFreePortPair(7940, (portErr, ports) => {
		if (portErr) {
			callback(portErr);
			return;
		}
		const password = crypto.randomBytes(18).toString('hex');
		const runResult = runContainerWithProfile({ containerName, persistent, volumeName, profile, ports, password });
		if (runResult.status !== 0) {
			callback(`docker run ${containerName} failed: ${runResult.stderr}`);
			return;
		}
		awaitNeo4jReady({ containerName, password }, (readyErr) => {
			if (readyErr) {
				callback(readyErr);
				return;
			}
			console.error(
				`[materializeLeg] ${containerName} ready (bolt ${ports.boltPort}, capped ${profile.memoryMb}m, ` +
					`heap ${profile.heap}, pagecache ${profile.pagecache}` +
					`${persistent ? `, persistent volume ${volumeName}` : ''})`,
			);
			callback('', { containerName, boltUri: `bolt://localhost:${ports.boltPort}`, password, ...ports });
		});
	});
};

const runCypher = ({ boltUri, password, cypher, params = {} }, callback) => {
	const waits = [0, 2000, 5000, 15000];
	const attemptOne = (attemptIndex) => {
		const driver = neo4j.driver(boltUri, neo4j.auth.basic('neo4j', password), { encrypted: false });
		const session = driver.session();
		session
			.run(cypher, params)
			.then((result) => {
				const records = result.records.map((oneRecord) => {
					const shaped = {};
					oneRecord.keys.forEach((oneKey) => {
						const value = oneRecord.get(oneKey);
						shaped[oneKey] = neo4j.isInt(value) ? value.toNumber() : value;
					});
					return shaped;
				});
				session.close().then(() => driver.close().then(() => callback('', { records })));
			})
			.catch((queryErr) => {
				session.close().then(() => driver.close()).catch(() => {});
				if (attemptIndex >= waits.length - 1) {
					callback(`runCypher failed after ${waits.length} attempts: ${queryErr.message}`);
					return;
				}
				setTimeout(() => attemptOne(attemptIndex + 1), waits[attemptIndex + 1]);
			});
	};
	attemptOne(0);
};

// canonical dump — embedding representations excluded IN CYPHER via apoc
// (105K nodes x 1024-float vectors must never cross the wire; the phaseE
// declared-exclusion precedent: content equivalence is embedding-exclusive).
const EXCLUDED_PROPS_CYPHER = `['embedding','embeddingRef','embeddingModelVersion']`;
const dumpGraph = ({ boltUri, password, dumpLabel }, callback) => {
	const NODE_BATCH = 5000;
	const EDGE_BATCH = 20000;
	const nodeLines = [];
	const edgeLines = [];
	const sortedShape = (rawProps) => {
		const shaped = {};
		Object.keys(rawProps || {}).sort().forEach((oneKey) => {
			shaped[oneKey] = rawProps[oneKey];
		});
		return shaped;
	};
	const fetchNodes = (skipCount, afterNodes) => {
		runCypher(
			{
				boltUri,
				password,
				// :GraphProvenance excluded — the passport carries per-build builtAt/
				// graphName (the established all-scope fingerprint exclusion; the ±1
				// GOLD_EVAL_260716 note; observed live as the ONLY two-build delta).
				cypher: `MATCH (n) WHERE NOT n:GraphProvenance
					RETURN coalesce(n.stableId, elementId(n)) AS stableId, labels(n) AS labels,
					apoc.map.removeKeys(properties(n), ${EXCLUDED_PROPS_CYPHER}) AS props
					ORDER BY stableId SKIP ${skipCount} LIMIT ${NODE_BATCH}`,
			},
			(err, result) => {
				if (err) {
					callback(`node dump: ${err}`);
					return;
				}
				result.records.forEach((oneRecord) => {
					nodeLines.push(
						JSON.stringify({
							stableId: oneRecord.stableId,
							labels: (oneRecord.labels || []).slice().sort(),
							props: sortedShape(oneRecord.props),
						}),
					);
				});
				if (result.records.length === NODE_BATCH) {
					fetchNodes(skipCount + NODE_BATCH, afterNodes);
					return;
				}
				afterNodes();
			},
		);
	};
	const fetchEdges = (skipCount, afterEdges) => {
		runCypher(
			{
				boltUri,
				password,
				cypher: `MATCH (a)-[r]->(b)
					WHERE NOT a:GraphProvenance AND NOT b:GraphProvenance
					RETURN type(r) AS edgeType, coalesce(a.stableId, elementId(a)) AS fromId,
					coalesce(b.stableId, elementId(b)) AS toId,
					apoc.map.removeKeys(properties(r), ${EXCLUDED_PROPS_CYPHER}) AS props
					ORDER BY edgeType, fromId, toId SKIP ${skipCount} LIMIT ${EDGE_BATCH}`,
			},
			(err, result) => {
				if (err) {
					callback(`edge dump: ${err}`);
					return;
				}
				result.records.forEach((oneRecord) => {
					edgeLines.push(
						JSON.stringify({
							type: oneRecord.edgeType,
							from: oneRecord.fromId,
							to: oneRecord.toId,
							props: sortedShape(oneRecord.props),
						}),
					);
				});
				if (result.records.length === EDGE_BATCH) {
					fetchEdges(skipCount + EDGE_BATCH, afterEdges);
					return;
				}
				afterEdges();
			},
		);
	};
	fetchNodes(0, () =>
		fetchEdges(0, () => {
			if (!fs.existsSync(DUMP_DIR)) {
				fs.mkdirSync(DUMP_DIR, { recursive: true });
			}
			const nodeText = nodeLines.sort().join('\n') + '\n';
			const edgeText = edgeLines.sort().join('\n') + '\n';
			const nodePath = path.join(DUMP_DIR, `${dumpLabel}.nodes.jsonl`);
			const edgePath = path.join(DUMP_DIR, `${dumpLabel}.edges.jsonl`);
			fs.writeFileSync(nodePath, nodeText);
			fs.writeFileSync(edgePath, edgeText);
			callback('', {
				nodeCount: nodeLines.length,
				edgeCount: edgeLines.length,
				nodeSha256: sha256Text(nodeText),
				edgeSha256: sha256Text(edgeText),
				nodePath,
				edgePath,
			});
		}),
	);
};

const runBuildGraph = ({ dbPath, manifestKey, destination }) =>
	spawnSync(
		'node',
		[
			'--max-old-space-size=8192',
			REPLAY_CLI, '-buildGraph',
			`--manifest=${manifestKey}`,
			`--destination=${destination}`,
			'--owner=:golden',
		],
		{ env: { ...process.env, EDF_FORGE_STORE_DB: dbPath }, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
	);

// =====================================================================
// the leg
// =====================================================================
if (!fs.existsSync(STATE_PATH)) {
	console.error(`pilotPhase4-materialize-leg: no state file at ${STATE_PATH} — run the compose battery first`);
	process.exit(2);
}
const legState = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
if (!fs.existsSync(legState.scratchDbPath)) {
	console.error(`pilotPhase4-materialize-leg: scratch store ${legState.scratchDbPath} is gone`);
	process.exit(2);
}
console.error(
	`STORE OVERRIDE ACTIVE: buildGraph + block reads run against the scratch copy ` +
		`${legState.scratchDbPath} — canonical and the goldEval copy are READ-ONLY`,
);

const canonicalShaBefore = sha256File(CANONICAL_STORE);
const state = { dumps: {} };
const taskList = new taskListPlus();

// ---- 0. preflight ---------------------------------------------------------------------
taskList.push((args, next) => {
	section('preflight');
	assert('canonical intact at leg start', canonicalShaBefore === CANONICAL_SHA256);
	const psBaseline = docker(['ps', '-a', '--format', '{{.Names}}']);
	state.containerBaseline = `${psBaseline.stdout}`.trim().split('\n').filter(Boolean).sort();
	assert('docker reachable', psBaseline.status === 0);
	assert(
		`no leftover pilotP4/deliverable container`,
		state.containerBaseline.every(
			(oneName) => oneName.indexOf('pilotP4') === -1 && oneName !== DELIVERABLE_NAME,
		),
	);
	state.liveMirrorSnapshot = {};
	LIVE_MIRROR_CONTAINERS.forEach((oneName) => {
		const inspect = docker(['inspect', '--format', '{{.State.Running}}|{{.State.StartedAt}}', oneName]);
		state.liveMirrorSnapshot[oneName] = inspect.status === 0 ? `${inspect.stdout}`.trim() : 'ABSENT';
	});
	const memTotalMb = Math.floor(Number(`${docker(['info', '--format', '{{.MemTotal}}']).stdout}`.trim()) / 1048576);
	let usedMb = 0;
	`${docker(['stats', '--no-stream', '--format', '{{.MemUsage}}']).stdout}`
		.trim().split('\n').filter(Boolean).forEach((oneLine) => {
			const valueMatch = oneLine.split('/')[0].trim().match(/^([0-9.]+)\s*(KiB|MiB|GiB)/i);
			if (valueMatch) {
				usedMb += Number(valueMatch[1]) * { kib: 1 / 1024, mib: 1, gib: 1024 }[valueMatch[2].toLowerCase()];
			}
		});
	const headroomMb = memTotalMb - Math.round(usedMb);
	console.error(`[materializeLeg] docker VM ${memTotalMb}MB, ~${Math.round(usedMb)}MB in use, headroom ~${headroomMb}MB`);
	if (headroomMb < HEADROOM_REQUIRED_MB) {
		next(`MEMORY HEADROOM TOO TIGHT (~${headroomMb}MB < ${HEADROOM_REQUIRED_MB}MB) — STOP + escalate`);
		return;
	}
	assert(`memory headroom ~${headroomMb}MB sufficient`, headroomMb >= HEADROOM_REQUIRED_MB);
	next('', args);
});

// ---- 1. open the scratch store (registration + census derivation reads) ----------------
taskList.push((args, next) => {
	const forgeStore = forgeStoreFactory();
	forgeStore.init({ dbPath: legState.scratchDbPath }, (err) => {
		state.forgeStore = forgeStore;
		next(err, args);
	});
});

// ---- 2. ARM A — determinism build ------------------------------------------------------
taskList.push((args, next) => {
	section('ARM A: determinism build (capped container, sanctioned buildGraph pipeline)');
	createCappedContainer({ containerName: DET_GRAPH_NAME, persistent: false, profile: BUILD_PROFILE }, (err, containerA) => {
		if (err) {
			next(`ARM A container: ${err}`);
			return;
		}
		state.containerA = containerA;
		state.forgeStore.upsertGraph(
			{
				name: DET_GRAPH_NAME,
				location: containerA.boltUri,
				type: 'ephemeral',
				credentialReference: 'pilotPhase4:directCapped',
				credentialValue: containerA.password,
			},
			(upsertErr) => {
				if (upsertErr) {
					next(`upsertGraph(${DET_GRAPH_NAME}): ${upsertErr}`);
					return;
				}
				console.error(`[materializeLeg] ARM A buildGraph starting (full-scale; this takes a while)…`);
				const buildRun = runBuildGraph({
					dbPath: legState.scratchDbPath,
					manifestKey: legState.composedManifestKey,
					destination: DET_GRAPH_NAME,
				});
				fs.writeFileSync(path.join('/tmp', 'pilotP4-buildA.log'), `${buildRun.stdout}\n${buildRun.stderr}`);
				assert('ARM A buildGraph exits 0 (replay+finishing+ownerStamp+provenance)', buildRun.status === 0);
				assert(
					'ARM A buildGraph REUSED the pre-registered capped container (never provisioned)',
					/already provisioned/.test(`${buildRun.stderr}${buildRun.stdout}`),
				);
				if (buildRun.status !== 0) {
					next(`ARM A buildGraph failed — see /tmp/pilotP4-buildA.log (last 2k: ${`${buildRun.stderr}`.slice(-2000)})`);
					return;
				}
				dumpGraph(
					{ boltUri: containerA.boltUri, password: containerA.password, dumpLabel: 'armA-determinism' },
					(dumpErr, dumpVerdict) => {
						if (dumpErr) {
							next(`ARM A dump: ${dumpErr}`);
							return;
						}
						state.dumps.armA = dumpVerdict;
						console.error(
							`[materializeLeg] ARM A: ${dumpVerdict.nodeCount} nodes / ${dumpVerdict.edgeCount} edges ` +
								`(n ${dumpVerdict.nodeSha256.slice(0, 12)}…, e ${dumpVerdict.edgeSha256.slice(0, 12)}…)`,
						);
						// AUTHORIZED teardown of the leg-owned determinism container
						const rmRun = docker(['rm', '-f', DET_GRAPH_NAME]);
						assert('ARM A torn down before the deliverable exists (sequential discipline)', rmRun.status === 0);
						next('', args);
					},
				);
			},
		);
	});
});

// ---- 3. DELIVERABLE — GOLD_EVAL_260717 (persistent; LEAVE UP) ---------------------------
taskList.push((args, next) => {
	section(`DELIVERABLE: ${DELIVERABLE_NAME} (persistent, memory-safe, GNC-001 naming)`);
	createCappedContainer(
		{ containerName: DELIVERABLE_NAME, persistent: true, volumeName: DELIVERABLE_VOLUME, profile: BUILD_PROFILE },
		(err, deliverable) => {
			if (err) {
				next(`deliverable container: ${err}`);
				return;
			}
			state.deliverable = deliverable;
			state.forgeStore.upsertGraph(
				{
					name: DELIVERABLE_NAME,
					location: deliverable.boltUri,
					type: 'golden',
					credentialReference: 'pilotPhase4:directCapped',
					credentialValue: deliverable.password,
				},
				(upsertErr) => {
					if (upsertErr) {
						next(`upsertGraph(${DELIVERABLE_NAME}): ${upsertErr}`);
						return;
					}
					console.error(`[materializeLeg] deliverable buildGraph starting (full-scale)…`);
					const buildRun = runBuildGraph({
						dbPath: legState.scratchDbPath,
						manifestKey: legState.composedManifestKey,
						destination: DELIVERABLE_NAME,
					});
					fs.writeFileSync(path.join('/tmp', 'pilotP4-buildDeliverable.log'), `${buildRun.stdout}\n${buildRun.stderr}`);
					assert('deliverable buildGraph exits 0', buildRun.status === 0);
					if (buildRun.status !== 0) {
						next(`deliverable buildGraph failed — see /tmp/pilotP4-buildDeliverable.log`);
						return;
					}
					dumpGraph(
						{ boltUri: deliverable.boltUri, password: deliverable.password, dumpLabel: 'deliverable-GOLD_EVAL_260717' },
						(dumpErr, dumpVerdict) => {
							if (dumpErr) {
								next(`deliverable dump: ${dumpErr}`);
								return;
							}
							state.dumps.deliverable = dumpVerdict;
							console.error(
								`[materializeLeg] deliverable: ${dumpVerdict.nodeCount} nodes / ${dumpVerdict.edgeCount} edges`,
							);
							// RECREATE at the SERVING profile (the ruling's ceremony): the bytes
							// live in the volume; the container is remade on the SAME ports +
							// credential with the proven 1200m/512m/256m envelope (GOLD_260716's).
							// The GNC-001 identity (container + volume NAME) is preserved.
							const stopRun = docker(['stop', DELIVERABLE_NAME]);
							const rmRun = stopRun.status === 0 ? docker(['rm', DELIVERABLE_NAME]) : stopRun;
							if (rmRun.status !== 0) {
								next(`deliverable serving-profile recreate (stop/rm): ${rmRun.stderr}`);
								return;
							}
							const recreateRun = runContainerWithProfile({
								containerName: DELIVERABLE_NAME,
								persistent: true,
								volumeName: DELIVERABLE_VOLUME,
								profile: SERVE_PROFILE,
								ports: { boltPort: deliverable.boltPort, httpPort: deliverable.httpPort },
								password: deliverable.password,
							});
							if (recreateRun.status !== 0) {
								next(`deliverable serving-profile recreate (run): ${recreateRun.stderr}`);
								return;
							}
							awaitNeo4jReady({ containerName: DELIVERABLE_NAME, password: deliverable.password }, (readyErr) => {
								assert(
									`deliverable RECREATED at the serving profile (${SERVE_PROFILE.memoryMb}m/` +
										`${SERVE_PROFILE.heap}/${SERVE_PROFILE.pagecache}) on its volume, same ports + credential`,
									!readyErr,
								);
								if (readyErr) {
									next(readyErr);
									return;
								}
								// served-graph verifications (the ruling's additions): counts match
								// the fingerprinted dump; the vector index survived the recreate and
								// is ONLINE; RestartCount 0 (asserted at G8 after the gates settle).
								runCypher(
									{
										boltUri: deliverable.boltUri,
										password: deliverable.password,
										cypher: `MATCH (n) WITH count(n) AS nodes MATCH ()-[r]->()
											RETURN nodes, count(r) AS edges`,
									},
									(countErr, countResult) => {
										const countRow = countErr ? {} : countResult.records[0] || {};
										assert(
											`served graph counts match the fingerprinted build ` +
												`(${countRow.nodes}/${countRow.edges} vs ${dumpVerdict.nodeCount}/${dumpVerdict.edgeCount})`,
											!countErr &&
												Number(countRow.nodes) === dumpVerdict.nodeCount &&
												Number(countRow.edges) === dumpVerdict.edgeCount,
										);
										runCypher(
											{
												boltUri: deliverable.boltUri,
												password: deliverable.password,
												cypher: `SHOW INDEXES YIELD type, state WHERE type = 'VECTOR'
													RETURN count(*) AS vectorIndexes,
													sum(CASE WHEN state = 'ONLINE' THEN 1 ELSE 0 END) AS online`,
											},
											(indexErr, indexResult) => {
												const indexRow = indexErr ? {} : indexResult.records[0] || {};
												assert(
													`vector index PRESENT + ONLINE on the served graph ` +
														`(${indexRow.online}/${indexRow.vectorIndexes})`,
													!indexErr &&
														Number(indexRow.vectorIndexes) > 0 &&
														Number(indexRow.online) === Number(indexRow.vectorIndexes),
												);
												next(indexErr || '', args);
											},
										);
									},
								);
							});
						},
					);
				},
			);
		},
	);
});

// ---- 4. DETERMINISM: arm A == deliverable ----------------------------------------------
taskList.push((args, next) => {
	section('determinism (sequential two-build fingerprint equality)');
	const { armA, deliverable } = state.dumps;
	assert(
		`node dumps IDENTICAL (${armA.nodeCount} vs ${deliverable.nodeCount}; sha ${armA.nodeSha256.slice(0, 12)}…)`,
		armA.nodeSha256 === deliverable.nodeSha256 && armA.nodeCount === deliverable.nodeCount,
	);
	assert(
		`edge dumps IDENTICAL (${armA.edgeCount} vs ${deliverable.edgeCount}; sha ${armA.edgeSha256.slice(0, 12)}…)`,
		armA.edgeSha256 === deliverable.edgeSha256 && armA.edgeCount === deliverable.edgeCount,
	);
	const mutated = sha256Text(`${fs.readFileSync(armA.nodePath, 'utf8').slice(0, 100000)}MUTATED`);
	assert('determinism comparator RED: a mutated byte flips the comparison', mutated !== armA.nodeSha256);
	next('', args);
});

// ---- 5. purity (gate-30 XOR) on the live deliverable ------------------------------------
taskList.push((args, next) => {
	section('purity XOR on the live deliverable (finishing meta nodes included)');
	const { boltUri, password } = state.deliverable;
	runCypher(
		{
			boltUri,
			password,
			cypher: `
				MATCH (n)
				WITH n, (n._source IS NOT NULL) AS hasSource, (n:\`GraphMeta\`) AS isMeta
				RETURN sum(CASE WHEN NOT (hasSource XOR isMeta) THEN 1 ELSE 0 END) AS violations,
					sum(CASE WHEN isMeta THEN 1 ELSE 0 END) AS metaCount,
					count(n) AS total`,
		},
		(err, result) => {
			if (err) {
				next(`purity query: ${err}`);
				return;
			}
			const row = result.records[0] || {};
			state.purity = row;
			assert(
				`purity XOR: ZERO violations on ${row.total} nodes (${row.metaCount} :GraphMeta from finishing)`,
				Number(row.violations) === 0 && Number(row.metaCount) > 0,
			);
			next('', args);
		},
	);
});

// ---- 6. S14 + S9 census at FULL scale ----------------------------------------------------
taskList.push((args, next) => {
	section('S14 gates + S9 census at FULL scale (the composed golden)');
	const { boltUri, password } = state.deliverable;

	runCypher(
		{
			boltUri,
			password,
			cypher: `MATCH (a:ForgedNode)-[r]->(b:ForgedNode)
				WHERE a._source IN $family AND b._source IN $family AND a._source <> b._source
				RETURN type(r) AS edgeType, a.stableId AS fromId, b.stableId AS toId,
					a._source AS fromSource, b._source AS toSource,
					r.provenanceSource AS provenanceSource, r.provenanceTier AS provenanceTier`,
			params: { family: FAMILY_SOURCES },
		},
		(err, result) => {
			if (err) {
				next(`family census query: ${err}`);
				return;
			}
			const pairingOf = (sourceA, sourceB) => {
				const ordered =
					sourceA === 'CTDL' || (sourceA < sourceB && sourceB !== 'CTDL')
						? [sourceA, sourceB]
						: [sourceB, sourceA];
				return `${ordered[0]}::${ordered[1]}`;
			};
			const graphTriples = new Map();
			result.records.forEach((oneEdge) => {
				graphTriples.set(tripleKey(oneEdge.edgeType, oneEdge.fromId, oneEdge.toId), {
					...oneEdge,
					pairing: pairingOf(oneEdge.fromSource, oneEdge.toSource),
				});
			});
			const perPairing = {};
			graphTriples.forEach((oneEdge) => {
				perPairing[oneEdge.pairing] = (perPairing[oneEdge.pairing] || 0) + 1;
			});
			assert(
				`FULL-SCALE family population = 506 (311/178/17) — the false-green killer at scale ` +
					`(got ${JSON.stringify(perPairing)}; total ${graphTriples.size})`,
				graphTriples.size === 506 &&
					PAIRINGS.every((onePairing) => perPairing[onePairing] === EXPECTED_FAMILY_EDGES[onePairing]),
			);
			const nullProvenance = Array.from(graphTriples.values()).filter(
				(oneEdge) => !oneEdge.provenanceSource || oneEdge.provenanceTier !== 'structural',
			);
			assert(
				`S14 ZERO-NULL-PROVENANCE census: every family cross-standard edge fully stamped ` +
					`(bad=${nullProvenance.length}) — no legacy carrier leaked back in`,
				nullProvenance.length === 0,
			);

			// derivation map for the novel trace (store-reader over the composed standards)
			const storeReader = storeReaderFactory();
			storeReader.makeReader(
				{
					forgeStore: state.forgeStore,
					memberBlockIds: [
						legState.embeddedCtdlBlockId,
						'98a5a6864978e2ac1a9ca0018291cb80896bbefb3bb5e2067c90028513906d97',
						'5b228ff8f9e9f0293af3afb5c2e2e2a97d8b35c53b5cc26a0f591a3be6caeebe',
					],
				},
				(readerErr, reader) => {
					if (readerErr) {
						next(`census reader: ${readerErr}`);
						return;
					}
					const identityUniverse = new Map();
					FAMILY_SOURCES.forEach((oneStandardKey) => {
						reader.nodesFor(oneStandardKey).forEach((oneNode) => {
							const identifiers = new Set(oneNode.uris);
							if (oneNode.stableId) {
								identifiers.add(oneNode.stableId);
							}
							identifiers.forEach((oneIdentifier) => {
								if (!identityUniverse.has(oneIdentifier)) {
									identityUniverse.set(oneIdentifier, { ownerStandard: oneStandardKey });
								}
							});
						});
					});
					const derivationByTriple = new Map();
					FAMILY_SOURCES.forEach((sourceStandardKey) => {
						reader.nodesFor(sourceStandardKey).forEach((oneNode) => {
							oneNode.crossRefs.forEach((oneRef) => {
								const raw = oneRef.raw || oneRef.id;
								const targetEntry = identityUniverse.get(raw);
								const rule = LOCATOR_EDGE[oneRef.locator];
								if (!targetEntry || !rule || targetEntry.ownerStandard === sourceStandardKey) {
									return;
								}
								const [fromId, toId] =
									rule.direction === 'targetToSource'
										? [raw, oneNode.stableId]
										: [oneNode.stableId, raw];
								derivationByTriple.set(tripleKey(rule.type, fromId, toId), {
									sourceStandard: sourceStandardKey,
									ownerNodeStableId: oneNode.stableId,
									raw,
									locator: oneRef.locator,
								});
							});
						});
					});

					// three-way baseline census (fixture-a 378)
					const authoredKeys = new Set();
					const gatheredKeys = new Set();
					const classification = { reproducedByPairing: {}, ruledCorrectLoss: [], unresolvedReported: [] };
					let baselineTotal = 0;
					PAIRINGS.forEach((onePairing) => {
						classification.reproducedByPairing[onePairing] = 0;
						FIXTURE_A.byPairing[onePairing].triples.forEach((oneTriple) => {
							baselineTotal++;
							const key = tripleKey(oneTriple.type, oneTriple.fromStableId, oneTriple.toStableId);
							if (oneTriple.authored) {
								authoredKeys.add(key);
							}
							if (oneTriple.gathered) {
								gatheredKeys.add(key);
							}
							if (graphTriples.has(key)) {
								classification.reproducedByPairing[onePairing]++;
								return;
							}
							if (PRE_RULED_CORRECT_LOSSES.indexOf(key) !== -1) {
								classification.ruledCorrectLoss.push(key);
								return;
							}
							classification.unresolvedReported.push(key);
						});
					});
					const reproducedTotal = PAIRINGS.reduce(
						(sum, onePairing) => sum + classification.reproducedByPairing[onePairing],
						0,
					);
					assert(
						`FULL-SCALE S9 census: 376 reproduced / 2 ruled-correct-loss / 0 unresolved of ${baselineTotal} ` +
							`(got ${reproducedTotal}/${classification.ruledCorrectLoss.length}/${classification.unresolvedReported.length})`,
						baselineTotal === 378 &&
							reproducedTotal === 376 &&
							classification.ruledCorrectLoss.length === 2 &&
							classification.unresolvedReported.length === 0,
					);

					// surplus classes
					const surplus = { reciprocal: {}, novelModern: {}, neitherClass: [] };
					PAIRINGS.forEach((onePairing) => {
						surplus.reciprocal[onePairing] = 0;
						surplus.novelModern[onePairing] = 0;
					});
					graphTriples.forEach((oneEdge, oneKey) => {
						if (authoredKeys.has(oneKey)) {
							return;
						}
						if (gatheredKeys.has(oneKey)) {
							surplus.reciprocal[oneEdge.pairing]++;
							return;
						}
						if (derivationByTriple.has(oneKey)) {
							surplus.novelModern[oneEdge.pairing]++;
							return;
						}
						surplus.neitherClass.push(oneKey);
					});
					const reciprocalTotal = PAIRINGS.reduce((sum, p) => sum + surplus.reciprocal[p], 0);
					const novelTotal = PAIRINGS.reduce((sum, p) => sum + surplus.novelModern[p], 0);
					assert(
						`FULL-SCALE surplus classes: 147 reciprocal (68/79/0) ∪ 130 novel-modern (96/34/0), zero neither ` +
							`(got ${reciprocalTotal}: ${PAIRINGS.map((p) => surplus.reciprocal[p]).join('/')}; ` +
							`${novelTotal}: ${PAIRINGS.map((p) => surplus.novelModern[p]).join('/')}; neither=${surplus.neitherClass.length})`,
						reciprocalTotal === 147 &&
							novelTotal === 130 &&
							surplus.neitherClass.length === 0 &&
							PAIRINGS.every(
								(onePairing) =>
									surplus.reciprocal[onePairing] === EXPECTED_RECIPROCALS[onePairing] &&
									surplus.novelModern[onePairing] === EXPECTED_NOVEL[onePairing],
							),
					);
					state.censusSummary = {
						baseline: { reproducedTotal, correctLoss: classification.ruledCorrectLoss, unresolved: classification.unresolvedReported.length },
						familyPopulation: perPairing,
						surplus: { reciprocal: surplus.reciprocal, novelModern: surplus.novelModern, neither: surplus.neitherClass.length },
					};
					next('', args);
				},
			);
		},
	);
});

// ---- 7. preservation asserts (24 EXACT_MATCH + 26 anchors) -------------------------------
taskList.push((args, next) => {
	section('S14 preservation asserts');
	const { boltUri, password } = state.deliverable;
	runCypher(
		{
			boltUri,
			password,
			cypher: `MATCH (a:ForgedNode {_source:'CTDL'})-[r]->(b:ForgedNode {_source:'CEDS'})
				RETURN type(r) AS edgeType, count(*) AS n ORDER BY edgeType`,
		},
		(err, result) => {
			if (err) {
				next(`preservation edge query: ${err}`);
				return;
			}
			const histogram = {};
			result.records.forEach((oneRecord) => {
				histogram[oneRecord.edgeType] = Number(oneRecord.n);
			});
			state.ctdlCedsHistogram = histogram;
			console.error(`[materializeLeg] CTDL->CEDS edge histogram: ${JSON.stringify(histogram)}`);
			assert(
				`preservation: the 24 CTDL->CEDS EXACT_MATCH spec-authoritative edges SURVIVE ` +
					`(got ${histogram.EXACT_MATCH || 0})`,
				histogram.EXACT_MATCH === 24,
			);
			runCypher(
				{
					boltUri,
					password,
					// the forge PROMOTES _cedsAnchors to cedsId (+ cedsOriginalAnchorPropertyName)
					// — parser.js:40; the pre-promotion stash name never reaches the graph.
					cypher: `MATCH (n:ForgedNode {_source:'CTDL'}) WHERE n.cedsId IS NOT NULL
						RETURN count(n) AS anchors`,
				},
				(anchorErr, anchorResult) => {
					if (anchorErr) {
						next(`anchor query: ${anchorErr}`);
						return;
					}
					const anchors = Number((anchorResult.records[0] || {}).anchors || 0);
					assert(`preservation: the 26 CEDS-annotated anchors SURVIVE (got ${anchors})`, anchors === 26);
					next('', args);
				},
			);
		},
	);
});

// ---- 8. G8 + report artifact --------------------------------------------------------------
taskList.push((args, next) => {
	section('G8 safety + deliverable report');
	assert('G8: canonical BYTE-IDENTICAL', sha256File(CANONICAL_STORE) === CANONICAL_SHA256);
	assert('G8: goldEval copy BYTE-IDENTICAL', sha256File(GOLDEVAL_COPY) === GOLDEVAL_SHA256);
	const psAfter = docker(['ps', '-a', '--format', '{{.Names}}']);
	const containersAfter = `${psAfter.stdout}`.trim().split('\n').filter(Boolean).sort();
	const expectedAfter = [...state.containerBaseline, DELIVERABLE_NAME].sort();
	assert(
		`G8: docker delta = EXACTLY the persistent deliverable ${DELIVERABLE_NAME} (scratch containers gone)`,
		JSON.stringify(containersAfter) === JSON.stringify(expectedAfter),
	);
	let mirrorsIntact = true;
	LIVE_MIRROR_CONTAINERS.forEach((oneName) => {
		const inspect = docker(['inspect', '--format', '{{.State.Running}}|{{.State.StartedAt}}', oneName]);
		const nowState = inspect.status === 0 ? `${inspect.stdout}`.trim() : 'ABSENT';
		if (nowState !== state.liveMirrorSnapshot[oneName]) {
			mirrorsIntact = false;
			console.error(`  G8 MIRROR DELTA: ${oneName}`);
		}
	});
	assert('G8: live mirrors Running with UNCHANGED StartedAt', mirrorsIntact);
	const restartInspect = docker(['inspect', '--format', '{{.RestartCount}}', DELIVERABLE_NAME]);
	assert(
		`served deliverable RestartCount = 0 (got ${`${restartInspect.stdout}`.trim()})`,
		restartInspect.status === 0 && `${restartInspect.stdout}`.trim() === '0',
	);

	if (!fs.existsSync(ARTIFACTS_DIR)) {
		fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
	}
	const report = {
		gate: 'Phase4-S14-fullGolden',
		spec: 'SPECIFICATION.md v2 S14; IMPLEMENTATION_PLAN v2 Phase 4',
		deliverable: {
			containerName: DELIVERABLE_NAME,
			volume: DELIVERABLE_VOLUME,
			boltPort: state.deliverable.boltPort,
			httpPort: state.deliverable.httpPort,
			composedManifestKey: legState.composedManifestKey,
			baseManifestKey: legState.baseManifestKey,
			embeddedCtdlBlockId: legState.embeddedCtdlBlockId,
			nodeCount: state.dumps.deliverable.nodeCount,
			edgeCount: state.dumps.deliverable.edgeCount,
			nodeDumpSha256: state.dumps.deliverable.nodeSha256,
			edgeDumpSha256: state.dumps.deliverable.edgeSha256,
		},
		purity: state.purity,
		census: state.censusSummary,
		ctdlCedsHistogram: state.ctdlCedsHistogram,
		embeddingReuse: legState.embeddingReuse,
	};
	fs.writeFileSync(
		path.join(ARTIFACTS_DIR, 'pilotPhase4-fullGolden-report.json'),
		JSON.stringify(report, null, 2),
	);
	console.error('[materializeLeg] report artifact written');
	next('', args);
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`\nMATERIALIZE LEG ABORTED: ${err}`);
		// abort hygiene: remove ONLY the scratch determinism container; the
		// PERSISTENT deliverable is NEVER auto-removed (not scratch — FADED_FORGE
		// owns its fate on a RED).
		const leftover = docker(['inspect', DET_GRAPH_NAME]);
		if (leftover.status === 0) {
			console.error(`[materializeLeg] abort hygiene: removing leg-owned ${DET_GRAPH_NAME}`);
			docker(['rm', '-f', DET_GRAPH_NAME]);
		}
		fail++;
	}
	console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
	console.log(`deliverable: ${DELIVERABLE_NAME} (LEFT UP); dumps: ${DUMP_DIR}`);
	process.exit(fail ? 1 : 0);
});
