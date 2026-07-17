#!/usr/bin/env node
'use strict';

// =====================================================================
// pilotPhase3-container-leg — Phase 3 MATERIALIZED gates for the forge-
// architecture pilot (SPECIFICATION v2 S8/S9/S10 G2+G4+G7+G8; IMPLEMENTATION_PLAN
// v2 Phase 3; Builder C). Consumes the state file written by
// pilotPhase3-gate-battery.js (the store-plane leg). Run that leg FIRST.
// =====================================================================
// MEMORY DISCIPLINE (the hard line): this box hosts LIVE production mirrors
// (GOLD_260716, gf_pvsEcand) — an OOM is catastrophic. Therefore:
//   - containers are created by DIRECT memory-safe docker run (the GOLD_EVAL_260716
//     pattern: --memory=1200m, --oom-score-adj=800, heap 512m/512m, pagecache 256m)
//     — NEVER via instance-lifecycle's uncapped createInstance;
//   - ONE container exists at a time, sequential, torn down before the next;
//   - a preflight memory-headroom check ABORTS (STOP + escalate) when the Docker VM
//     lacks 2x the cap in headroom;
//   - ports are chosen free at runtime and NEVER from the forbidden set
//     (7700-7703, 7706-7709, 7712/7713, 7716/7717, 7688/7690, 7475/7476).
//
// GATES (each comparator observed RED where injectable):
//   G2  purity — the gate-30 XOR partition (node _source XOR :GraphMeta), run on
//       BOTH arms; RED = an injected __TEST_purityRed node (neither marker), then
//       cleaned by an authorized DETACH DELETE and GREEN re-observed.
//   G4  the S9 equivalence census (AMENDED v3 per BR2-1), on the GENESIS arm:
//       three-way classification of the frozen baseline 378 (149 gathered ∪ 229
//       authored) into {reproduced-by-pairing-X | ruled-correct-loss (exactly the
//       2 pre-ruled HAS_CLASS edges, identity confirmed) | unresolved-reported},
//       ZERO unclassified; per-edge provenance asserted on the MATERIALIZED graph
//       (provenanceSource='uriBridge' + provenanceTier='structural' — edge
//       existence alone is the false-green trap); surplus-over-authored fully
//       classified into {147 reciprocals (68/79/0)} ∪ {130 novel-modern (96/34/0),
//       each provenance-traced to its source crossRef}; any surplus edge in
//       NEITHER class = FAIL.
//   G7  clean-room — the ACCUMULATED arm (standards replayed, then bridges
//       appended into the same graph) fingerprints IDENTICAL to the GENESIS arm
//       (one replay of the composed manifest). Raw replay both arms, no finishing
//       (the phaseD-gd1raw precedent: the contract is REPLAYED CONTENT equality).
//   G8  safety — canonical store byte-identical; docker container set restored to
//       its preflight baseline; the live mirrors' containers verified Running with
//       unchanged StartedAt.
//
// Async style: qtools taskListPlus/pipeRunner; no async/await for control flow
// (neo4j-driver promises resolve at the leaf via .then/.catch routed error-first,
// the replay-engine precedent). No try/catch for control flow.
// =====================================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
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
const STATE_PATH = '/tmp/pilotPhase3-state.json';
const ARTIFACTS_DIR = path.join(__dirname, 'pilotPhase3Artifacts');
const DUMP_DIR = '/tmp/pilotPhase3-dumps';

const FIXTURE_A = require(path.join(__dirname, 'ctdlPilotFixtures', 'fixture-a-familyEndpointTriples.json'));
const familyModule = require(path.join(
	CODE_ROOT, 'cli', 'parserLib', 'forge-ctdl', 'modules', 'ctdlFamilyStructure.js',
));
const { LOCATOR_EDGE } = familyModule;

const replayEngine = require(path.join(CORE_LIB, 'replay', 'replay-engine'));
const forgeStoreFactory = require(path.join(CORE_LIB, 'forge-store', 'forge-store'));
const storeReaderFactory = require(path.join(CORE_LIB, 'store-reader', 'store-reader'));
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// neo4j-driver resolution order: core-lib's own node_modules first (the module that
// declares the dependency), then the code-root and cli trees.
const NEO4J_DRIVER_CANDIDATES = [
	path.join(CODE_ROOT, 'npm', 'qtools-graph-forge-core', 'node_modules', 'neo4j-driver'),
	path.join(CODE_ROOT, 'node_modules', 'neo4j-driver'),
	path.join(CODE_ROOT, 'cli', 'node_modules', 'neo4j-driver'),
];
const neo4jDriverPath = NEO4J_DRIVER_CANDIDATES.find((onePath) => fs.existsSync(onePath));
if (!neo4jDriverPath) {
	console.error(`pilotPhase3-container-leg: no neo4j-driver found in: ${NEO4J_DRIVER_CANDIDATES.join(', ')}`);
	process.exit(2);
}
const neo4j = require(neo4jDriverPath);

// ---- constants -----------------------------------------------------------------
const NEO4J_IMAGE = 'neo4j:5.26';
const MEMORY_CAP_MB = 1200;
const HEADROOM_REQUIRED_MB = 2 * MEMORY_CAP_MB;
const FORBIDDEN_PORTS = new Set([
	7700, 7701, 7702, 7703, 7706, 7707, 7708, 7709, 7712, 7713, 7716, 7717,
	7688, 7690, 7475, 7476,
]);
const PORT_CANDIDATE_START = 7940;
const READY_TIMEOUT_MS = 120000;
const LIVE_MIRROR_CONTAINERS = ['GOLD_260716', 'gf_pvsEcand'];
const CONTAINER_PREFIX = 'pilotP3';

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

// =====================================================================
// container mechanics (memory-safe, direct — the GOLD_EVAL_260716 pattern)
// =====================================================================
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

const findFreePortPair = (callback) => {
	const mapped = dockerMappedPorts();
	const tryCandidate = (candidate) => {
		if (candidate > 65000) {
			callback('no free bolt/http port pair found');
			return;
		}
		const boltPort = candidate;
		const httpPort = candidate + 1;
		const clashes =
			FORBIDDEN_PORTS.has(boltPort) || FORBIDDEN_PORTS.has(httpPort) ||
			mapped.has(boltPort) || mapped.has(httpPort);
		if (clashes) {
			tryCandidate(candidate + 2);
			return;
		}
		isPortBindable(boltPort, (boltFree) => {
			if (!boltFree) {
				tryCandidate(candidate + 2);
				return;
			}
			isPortBindable(httpPort, (httpFree) => {
				if (!httpFree) {
					tryCandidate(candidate + 2);
					return;
				}
				callback('', { boltPort, httpPort });
			});
		});
	};
	tryCandidate(PORT_CANDIDATE_START);
};

const waitForNeo4jReady = ({ boltUri, password }, callback) => {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	const attemptOne = () => {
		const driver = neo4j.driver(boltUri, neo4j.auth.basic('neo4j', password), { encrypted: false });
		const session = driver.session();
		session
			.run('RETURN 1 AS ok')
			.then(() => session.close().then(() => driver.close().then(() => callback(''))))
			.catch(() => {
				session.close().then(() => driver.close()).catch(() => {});
				if (Date.now() > deadline) {
					callback(`neo4j at ${boltUri} not ready within ${READY_TIMEOUT_MS / 1000}s`);
					return;
				}
				setTimeout(attemptOne, 2500);
			});
	};
	attemptOne();
};

const createMemorySafeContainer = ({ containerName }, callback) => {
	findFreePortPair((portErr, ports) => {
		if (portErr) {
			callback(portErr);
			return;
		}
		const password = crypto.randomBytes(18).toString('hex');
		const runResult = docker([
			'run', '-d',
			'--name', containerName,
			'-p', `${ports.boltPort}:7687`,
			'-p', `${ports.httpPort}:7474`,
			'--memory', `${MEMORY_CAP_MB}m`,
			'--oom-score-adj', '800',
			'-e', `NEO4J_AUTH=neo4j/${password}`,
			'-e', 'NEO4J_server_memory_heap_initial__size=512m',
			'-e', 'NEO4J_server_memory_heap_max__size=512m',
			'-e', 'NEO4J_server_memory_pagecache_size=256m',
			'-e', 'NEO4J_PLUGINS=["apoc"]',
			'-e', 'NEO4J_dbms_security_procedures_unrestricted=apoc.*',
			'-e', 'NEO4J_dbms_security_procedures_allowlist=apoc.*',
			NEO4J_IMAGE,
		]);
		if (runResult.status !== 0) {
			callback(`docker run ${containerName} failed: ${runResult.stderr}`);
			return;
		}
		const boltUri = `bolt://localhost:${ports.boltPort}`;
		console.error(
			`[containerLeg] created ${containerName} (bolt ${ports.boltPort}, http ${ports.httpPort}, ` +
				`--memory=${MEMORY_CAP_MB}m heap 512m pagecache 256m) — awaiting readiness`,
		);
		waitForNeo4jReady({ boltUri, password }, (readyErr) => {
			if (readyErr) {
				callback(readyErr);
				return;
			}
			callback('', { containerName, boltUri, password, ...ports });
		});
	});
};

const teardownContainer = ({ containerName }, callback) => {
	// AUTHORIZED destructive op (FADED_FORGE, this run): rm -f of ONLY the
	// pilotP3-prefixed containers this leg creates. No volume exists (none mounted).
	if (containerName.indexOf(CONTAINER_PREFIX) !== 0) {
		callback(`REFUSED: teardown of non-${CONTAINER_PREFIX} container '${containerName}'`);
		return;
	}
	const rmResult = docker(['rm', '-f', containerName]);
	if (rmResult.status !== 0) {
		callback(`docker rm -f ${containerName} failed: ${rmResult.stderr}`);
		return;
	}
	console.error(`[containerLeg] tore down ${containerName}`);
	callback('');
};

// runCypher against a leg-owned container (retry pin: transient flakes get widening
// waits; a genuine failure surfaces loudly).
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

// =====================================================================
// gate helpers
// =====================================================================

// G2 — the gate-30 XOR partition, query verbatim from
// cli/lib.d/edf-gate/gates.d/30-graphMetaPurityXor.js (GraphMeta label literal —
// the leg has no registry context; the label is registry-pinned 'GraphMeta').
const runPurityGate = ({ boltUri, password }, callback) => {
	const cypher = `
		MATCH (n)
		WITH n, (n._source IS NOT NULL) AS hasSource, (n:\`GraphMeta\`) AS isMeta
		WHERE NOT (hasSource XOR isMeta)
		RETURN count(n) AS violations,
			collect(CASE WHEN hasSource AND isMeta THEN 'BOTH: ' ELSE 'NEITHER: ' END +
				coalesce(n.stableId, n.name, 'labels=' + reduce(s='', l IN labels(n) | s + l + ' ')))[0..10] AS examples
	`;
	runCypher({ boltUri, password, cypher }, (err, result) => {
		if (err) {
			callback(err);
			return;
		}
		const row = result.records[0] || {};
		callback('', { violations: Number(row.violations || 0), examples: row.examples || [] });
	});
};

// canonical line dump (the phaseE-graph-dump serialization, embedding props
// excluded — none exist in this skipEmbedding build; kept for shape fidelity).
const EXCLUDED_NODE_PROPS = ['embedding', 'embeddingRef', 'embeddingModelVersion'];
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

const dumpGraph = ({ boltUri, password, dumpLabel }, callback) => {
	const BATCH_SIZE = 20000;
	const nodeLines = [];
	const edgeLines = [];
	const fetchNodes = (skipCount, afterNodes) => {
		runCypher(
			{
				boltUri,
				password,
				cypher: `MATCH (n:ForgedNode) RETURN n.stableId AS stableId, labels(n) AS labels,
					properties(n) AS props ORDER BY n.stableId SKIP ${skipCount} LIMIT ${BATCH_SIZE}`,
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
							props: sortedProps(oneRecord.props),
						}),
					);
				});
				if (result.records.length === BATCH_SIZE) {
					fetchNodes(skipCount + BATCH_SIZE, afterNodes);
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
				cypher: `MATCH (a:ForgedNode)-[r]->(b:ForgedNode)
					RETURN type(r) AS edgeType, a.stableId AS fromId, b.stableId AS toId,
					properties(r) AS props ORDER BY edgeType, fromId, toId SKIP ${skipCount} LIMIT ${BATCH_SIZE}`,
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
							props: sortedProps(oneRecord.props),
						}),
					);
				});
				if (result.records.length === BATCH_SIZE) {
					fetchEdges(skipCount + BATCH_SIZE, afterEdges);
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
				nodePath,
				edgePath,
				nodeSha256: sha256Text(nodeText),
				edgeSha256: sha256Text(edgeText),
			});
		}),
	);
};

// =====================================================================
// the leg
// =====================================================================
if (!fs.existsSync(STATE_PATH)) {
	console.error(`pilotPhase3-container-leg: no state file at ${STATE_PATH} — run pilotPhase3-gate-battery.js first`);
	process.exit(2);
}
const legState = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
if (!fs.existsSync(legState.scratchDbPath)) {
	console.error(`pilotPhase3-container-leg: scratch store ${legState.scratchDbPath} is gone — re-run the store leg`);
	process.exit(2);
}
console.error(
	`STORE OVERRIDE ACTIVE: block reads below run against the scratch copy ` +
		`${legState.scratchDbPath} — canonical is READ-ONLY this run`,
);

const canonicalShaBefore = sha256File(CANONICAL_STORE);
const state = { dumps: {} };
const taskList = new taskListPlus();

// ---- 0. preflight: docker baseline + live-mirror snapshot + memory headroom --------
taskList.push((args, next) => {
	section('preflight (docker baseline, live mirrors, memory headroom)');
	assert('canonical store sha256 intact at leg start', canonicalShaBefore === CANONICAL_SHA256);

	const psBaseline = docker(['ps', '-a', '--format', '{{.Names}}']);
	state.containerBaseline = `${psBaseline.stdout}`.trim().split('\n').filter(Boolean).sort();
	assert('docker reachable (container baseline recorded)', psBaseline.status === 0);
	assert(
		`no leftover ${CONTAINER_PREFIX}* container from a prior run`,
		state.containerBaseline.every((oneName) => oneName.indexOf(CONTAINER_PREFIX) !== 0),
	);

	state.liveMirrorSnapshot = {};
	LIVE_MIRROR_CONTAINERS.forEach((oneName) => {
		const inspect = docker(['inspect', '--format', '{{.State.Running}}|{{.State.StartedAt}}', oneName]);
		state.liveMirrorSnapshot[oneName] = inspect.status === 0 ? `${inspect.stdout}`.trim() : 'ABSENT';
	});
	console.error(`[containerLeg] live mirrors: ${JSON.stringify(state.liveMirrorSnapshot)}`);

	const memTotalRun = docker(['info', '--format', '{{.MemTotal}}']);
	const memTotalMb = Math.floor(Number(`${memTotalRun.stdout}`.trim()) / (1024 * 1024));
	const statsRun = docker(['stats', '--no-stream', '--format', '{{.MemUsage}}']);
	let usedMb = 0;
	`${statsRun.stdout}`.trim().split('\n').filter(Boolean).forEach((oneLine) => {
		const usage = oneLine.split('/')[0].trim();
		const valueMatch = usage.match(/^([0-9.]+)\s*(KiB|MiB|GiB)/i);
		if (valueMatch) {
			const scale = { kib: 1 / 1024, mib: 1, gib: 1024 }[valueMatch[2].toLowerCase()];
			usedMb += Number(valueMatch[1]) * scale;
		}
	});
	const headroomMb = memTotalMb - Math.round(usedMb);
	console.error(`[containerLeg] docker VM ${memTotalMb}MB total, ~${Math.round(usedMb)}MB in use, headroom ~${headroomMb}MB`);
	if (headroomMb < HEADROOM_REQUIRED_MB) {
		next(
			`MEMORY HEADROOM TOO TIGHT: ~${headroomMb}MB free < required ${HEADROOM_REQUIRED_MB}MB — ` +
				`STOP per the hard line; escalate to FADED_FORGE before any container is created`,
		);
		return;
	}
	assert(`memory headroom ~${headroomMb}MB >= ${HEADROOM_REQUIRED_MB}MB`, headroomMb >= HEADROOM_REQUIRED_MB);
	next('', args);
});

// ---- 1. load the six genesis block texts from the scratch store --------------------
taskList.push((args, next) => {
	section('load genesis block texts (scratch store)');
	const forgeStore = forgeStoreFactory();
	const orderedBlockIds = [
		legState.savedStandards.CTDL,
		legState.savedStandards.CTDLASN,
		legState.savedStandards.CTDLQData,
		...legState.bridgeBlocks.map((oneBlock) => oneBlock.blockId),
	];
	const blockTexts = [];
	const sub = new taskListPlus();
	sub.push((subArgs, subNext) => forgeStore.init({ dbPath: legState.scratchDbPath }, (err) => subNext(err, subArgs)));
	orderedBlockIds.forEach((oneBlockId) => {
		sub.push((subArgs, subNext) => {
			forgeStore.getBlock({ blockId: oneBlockId }, (err, row) => {
				if (err || !row) {
					subNext(err || `block ${oneBlockId} not found in scratch store`);
					return;
				}
				blockTexts.push(row.text);
				subNext('', subArgs);
			});
		});
	});
	pipeRunner(sub.getList(), {}, (err) => {
		if (err) {
			next(err);
			return;
		}
		assert('all SIX genesis blocks loaded (3 standards + 3 structuralBridge)', blockTexts.length === 6);
		state.forgeStore = forgeStore;
		state.standardTexts = blockTexts.slice(0, 3);
		state.bridgeTexts = blockTexts.slice(3);
		state.allTexts = blockTexts;
		next('', args);
	});
});

// ---- 2. ARM A — the ACCUMULATED graph (S8 semantics, two replays, one graph) --------
taskList.push((args, next) => {
	section('ARM A: accumulated graph (standards replayed, bridges appended)');
	createMemorySafeContainer({ containerName: `${CONTAINER_PREFIX}accum` }, (err, containerA) => {
		if (err) {
			next(`ARM A container: ${err}`);
			return;
		}
		state.containerA = containerA;
		replayEngine.replay(
			{ manifest: state.standardTexts, boltUri: containerA.boltUri, password: containerA.password, graphName: 'pilotP3accum' },
			(standardsErr, standardsReplay) => {
				if (standardsErr) {
					next(`ARM A standards replay: ${standardsErr}`);
					return;
				}
				const standardsDangling =
					(standardsReplay && standardsReplay.danglingRefs && standardsReplay.danglingRefs.length) || 0;
				assert('ARM A: standards replay clean (zero dangling refs)', standardsDangling === 0);
				replayEngine.replay(
					{ manifest: state.bridgeTexts, boltUri: containerA.boltUri, password: containerA.password, graphName: 'pilotP3accum' },
					(bridgesErr, bridgesReplay) => {
						if (bridgesErr) {
							next(`ARM A bridges replay (accumulation append): ${bridgesErr}`);
							return;
						}
						const bridgesDangling =
							(bridgesReplay && bridgesReplay.danglingRefs && bridgesReplay.danglingRefs.length) || 0;
						assert(
							'ARM A: bridge append clean (zero dangling refs — every endpoint pre-laid by the standards)',
							bridgesDangling === 0,
						);
						next('', args);
					},
				);
			},
		);
	});
});

// ---- 3. G2 on ARM A (GREEN, injected RED, GREEN again) ------------------------------
taskList.push((args, next) => {
	section('G2 purity on ARM A (gate-30 XOR; RED observed on an injected node)');
	const { boltUri, password } = state.containerA;
	runPurityGate({ boltUri, password }, (err, verdict) => {
		if (err) {
			next(`G2 armA initial: ${err}`);
			return;
		}
		assert(`G2 ARM A GREEN: zero XOR violations (got ${verdict.violations})`, verdict.violations === 0);
		runCypher(
			{ boltUri, password, cypher: `CREATE (:ForgedNode {stableId:'__TEST_purityRed'})` },
			(injectErr) => {
				if (injectErr) {
					next(`G2 RED injection: ${injectErr}`);
					return;
				}
				runPurityGate({ boltUri, password }, (redErr, redVerdict) => {
					if (redErr) {
						next(`G2 armA red read: ${redErr}`);
						return;
					}
					assert(
						`G2 RED observed: injected no-marker node detected (violations=${redVerdict.violations}, named=${/__TEST_purityRed/.test(JSON.stringify(redVerdict.examples))})`,
						redVerdict.violations === 1 && /__TEST_purityRed/.test(JSON.stringify(redVerdict.examples)),
					);
					// AUTHORIZED destructive op (FADED_FORGE, this run): DETACH DELETE of
					// the single injected __TEST_purityRed node in this leg-owned container.
					runCypher(
						{ boltUri, password, cypher: `MATCH (n:ForgedNode {stableId:'__TEST_purityRed'}) DETACH DELETE n` },
						(cleanErr) => {
							if (cleanErr) {
								next(`G2 injection cleanup: ${cleanErr}`);
								return;
							}
							runPurityGate({ boltUri, password }, (greenErr, greenVerdict) => {
								assert(
									'G2 ARM A GREEN re-observed after injection cleanup',
									!greenErr && greenVerdict.violations === 0,
								);
								next(greenErr || '', args);
							});
						},
					);
				});
			},
		);
	});
});

// ---- 4. dump ARM A + teardown -------------------------------------------------------
taskList.push((args, next) => {
	section('ARM A canonical dump + teardown (one container at a time)');
	dumpGraph(
		{ boltUri: state.containerA.boltUri, password: state.containerA.password, dumpLabel: 'armA-accumulated' },
		(err, dumpVerdict) => {
			if (err) {
				next(`ARM A dump: ${err}`);
				return;
			}
			state.dumps.armA = dumpVerdict;
			console.error(
				`[containerLeg] ARM A: ${dumpVerdict.nodeCount} nodes / ${dumpVerdict.edgeCount} edges ` +
					`(nodes ${dumpVerdict.nodeSha256.slice(0, 12)}…, edges ${dumpVerdict.edgeSha256.slice(0, 12)}…)`,
			);
			assert('ARM A dump non-empty', dumpVerdict.nodeCount > 0 && dumpVerdict.edgeCount > 0);
			teardownContainer({ containerName: state.containerA.containerName }, (teardownErr) => {
				assert('ARM A container torn down before ARM B exists (sequential discipline)', !teardownErr);
				next(teardownErr || '', args);
			});
		},
	);
});

// ---- 5. ARM B — the GENESIS clean-room graph (one replay of the composed manifest) --
taskList.push((args, next) => {
	section('ARM B: genesis clean-room (single replay of the composed six)');
	createMemorySafeContainer({ containerName: `${CONTAINER_PREFIX}genesis` }, (err, containerB) => {
		if (err) {
			next(`ARM B container: ${err}`);
			return;
		}
		state.containerB = containerB;
		replayEngine.replay(
			{ manifest: state.allTexts, boltUri: containerB.boltUri, password: containerB.password, graphName: 'pilotP3genesis' },
			(replayErr, genesisReplay) => {
				if (replayErr) {
					next(`ARM B genesis replay: ${replayErr}`);
					return;
				}
				const genesisDangling =
					(genesisReplay && genesisReplay.danglingRefs && genesisReplay.danglingRefs.length) || 0;
				assert('ARM B: genesis replay clean (zero dangling refs)', genesisDangling === 0);
				runPurityGate({ boltUri: containerB.boltUri, password: containerB.password }, (purityErr, verdict) => {
					assert(
						`G2 ARM B GREEN: zero XOR violations on the genesis graph (got ${purityErr ? 'ERR' : verdict.violations})`,
						!purityErr && verdict.violations === 0,
					);
					next(purityErr || '', args);
				});
			},
		);
	});
});

// ---- 6. G4 — the keystone census (S9 AMENDED v3) on the genesis graph ----------------
taskList.push((args, next) => {
	section('G4 equivalence census (S9 v3): three-way baseline + surplus classes + provenance');
	const { boltUri, password } = state.containerB;

	// 6a. every cross-source edge with its provenance, straight off the graph
	runCypher(
		{
			boltUri,
			password,
			cypher: `MATCH (a:ForgedNode)-[r]->(b:ForgedNode)
				WHERE a._source <> b._source
				RETURN type(r) AS edgeType, a.stableId AS fromId, b.stableId AS toId,
					a._source AS fromSource, b._source AS toSource,
					r.provenanceSource AS provenanceSource, r.provenanceTier AS provenanceTier,
					r.crossRefLocator AS crossRefLocator`,
		},
		(err, result) => {
			if (err) {
				next(`G4 family-edge query: ${err}`);
				return;
			}
			const familyEdges = result.records;
			const pairingOf = (sourceA, sourceB) => {
				const ordered =
					sourceA === 'CTDL' || (sourceA < sourceB && sourceB !== 'CTDL')
						? [sourceA, sourceB]
						: [sourceB, sourceA];
				return `${ordered[0]}::${ordered[1]}`;
			};
			const graphTriples = new Map(); // tripleKey -> edge record + pairing
			familyEdges.forEach((oneEdge) => {
				graphTriples.set(tripleKey(oneEdge.edgeType, oneEdge.fromId, oneEdge.toId), {
					...oneEdge,
					pairing: pairingOf(oneEdge.fromSource, oneEdge.toSource),
				});
			});

			const perPairingGraphCounts = {};
			graphTriples.forEach((oneEdge) => {
				perPairingGraphCounts[oneEdge.pairing] = (perPairingGraphCounts[oneEdge.pairing] || 0) + 1;
			});
			assert(
				`family cross-source edge population = 506 as frozen (got ${JSON.stringify(perPairingGraphCounts)})`,
				PAIRINGS.every((onePairing) => perPairingGraphCounts[onePairing] === EXPECTED_FAMILY_EDGES[onePairing]) &&
					graphTriples.size === 506,
			);
			const provenanceBad = Array.from(graphTriples.values()).filter(
				(oneEdge) => oneEdge.provenanceSource !== 'uriBridge' || oneEdge.provenanceTier !== 'structural',
			);
			assert(
				`S9.2 per-edge provenance: EVERY family edge carries provenanceSource='uriBridge' + tier='structural' ` +
					`on the MATERIALIZED graph (bad=${provenanceBad.length})`,
				provenanceBad.length === 0,
			);

			// 6b. derivation map (novel-modern trace): store-reader over the three
			// standard blocks + the module's own LOCATOR_EDGE + identity join — every
			// authored edge maps back to {sourceStandard, ownerNode, raw, locator}
			// (re-derivation mirrors ctdlFamilyStructure.js:102-207).
			const storeReader = storeReaderFactory();
			storeReader.makeReader(
				{
					forgeStore: state.forgeStore,
					memberBlockIds: [
						legState.savedStandards.CTDL,
						legState.savedStandards.CTDLASN,
						legState.savedStandards.CTDLQData,
					],
				},
				(readerErr, reader) => {
					if (readerErr) {
						next(`G4 reader: ${readerErr}`);
						return;
					}
					const identityUniverse = new Map();
					['CTDL', 'CTDLASN', 'CTDLQData'].forEach((oneStandardKey) => {
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
					['CTDL', 'CTDLASN', 'CTDLQData'].forEach((sourceStandardKey) => {
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

					// 6c. three-way classification of the frozen baseline 378
					const classification = { reproducedByPairing: {}, ruledCorrectLoss: [], unresolvedReported: [] };
					const authoredKeys = new Set();
					const gatheredKeys = new Set();
					let baselineTotal = 0;
					let reproducedProvenanceBad = 0;
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
								const graphEdge = graphTriples.get(key);
								if (graphEdge.provenanceSource !== 'uriBridge' || graphEdge.provenanceTier !== 'structural') {
									reproducedProvenanceBad++;
								}
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
					assert(`baseline census universe = 378 triples (got ${baselineTotal})`, baselineTotal === 378);
					assert(
						`three-way census: 376 reproduced / 2 ruled-correct-loss / 0 unresolved — ZERO unclassified ` +
							`(got ${reproducedTotal}/${classification.ruledCorrectLoss.length}/${classification.unresolvedReported.length})`,
						reproducedTotal === 376 &&
							classification.ruledCorrectLoss.length === 2 &&
							classification.unresolvedReported.length === 0,
					);
					assert(
						'pre-ruled correct-loss identity CONFIRMED: exactly the 2 HAS_CLASS edges (ctdl:root -> schema:MonetaryAmount/QuantitativeValue)',
						JSON.stringify(classification.ruledCorrectLoss.slice().sort()) ===
							JSON.stringify(PRE_RULED_CORRECT_LOSSES.slice().sort()),
					);
					assert(
						'every REPRODUCED baseline triple carries full provenance on the graph (the false-green killer)',
						reproducedProvenanceBad === 0,
					);

					// 6d. surplus-over-authored classification (S9.4 v3: reciprocal ∪ novel-modern)
					const surplus = { reciprocal: {}, novelModern: {}, neitherClass: [] };
					const novelEnumeration = [];
					PAIRINGS.forEach((onePairing) => {
						surplus.reciprocal[onePairing] = 0;
						surplus.novelModern[onePairing] = 0;
					});
					graphTriples.forEach((oneEdge, oneKey) => {
						if (authoredKeys.has(oneKey)) {
							return; // the authored-229 reproduction, censused above
						}
						if (gatheredKeys.has(oneKey)) {
							surplus.reciprocal[oneEdge.pairing]++;
							return;
						}
						const trace = derivationByTriple.get(oneKey);
						if (trace) {
							surplus.novelModern[oneEdge.pairing]++;
							novelEnumeration.push({ triple: oneKey, pairing: oneEdge.pairing, ...trace });
							return;
						}
						surplus.neitherClass.push(oneKey);
					});
					const reciprocalTotal = PAIRINGS.reduce((sum, onePairing) => sum + surplus.reciprocal[onePairing], 0);
					const novelTotal = PAIRINGS.reduce((sum, onePairing) => sum + surplus.novelModern[onePairing], 0);
					assert(
						`surplus reciprocal class = 147 (68/79/0) — the gathered set re-authored ` +
							`(got ${reciprocalTotal}: ${PAIRINGS.map((p) => surplus.reciprocal[p]).join('/')})`,
						reciprocalTotal === 147 &&
							PAIRINGS.every((onePairing) => surplus.reciprocal[onePairing] === EXPECTED_RECIPROCALS[onePairing]),
					);
					assert(
						`surplus novel-modern class = 130 (96/34/0), EACH traced to its source crossRef ` +
							`(got ${novelTotal}: ${PAIRINGS.map((p) => surplus.novelModern[p]).join('/')})`,
						novelTotal === 130 &&
							PAIRINGS.every((onePairing) => surplus.novelModern[onePairing] === EXPECTED_NOVEL[onePairing]) &&
							novelEnumeration.length === 130,
					);
					assert(
						`ZERO surplus edges in NEITHER class (got ${surplus.neitherClass.length})`,
						surplus.neitherClass.length === 0,
					);

					// 6e. comparator REDs (the census must be able to fail)
					const redCopy = new Map(graphTriples);
					const firstAuthoredKey = authoredKeys.values().next().value;
					redCopy.delete(firstAuthoredKey);
					assert(
						'G4 comparator RED: a synthetically-removed authored triple IS detected as missing',
						!redCopy.has(firstAuthoredKey) && graphTriples.has(firstAuthoredKey),
					);
					const syntheticSurplusKey = tripleKey('HAS_PROPERTY', 'ceterms:__TEST_neitherClass', 'ceasn:__TEST_x');
					const syntheticVerdict =
						authoredKeys.has(syntheticSurplusKey) || gatheredKeys.has(syntheticSurplusKey)
							? 'inBaseline'
							: derivationByTriple.has(syntheticSurplusKey)
								? 'traced'
								: 'NEITHER_CLASS';
					assert(
						'G4 comparator RED: a synthetic surplus edge in neither class IS detected as FAIL-class',
						syntheticVerdict === 'NEITHER_CLASS',
					);

					// 6f. census artifact (committed at sign-off)
					if (!fs.existsSync(ARTIFACTS_DIR)) {
						fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
					}
					const censusArtifact = {
						gate: 'G4-equivalenceCensus',
						spec: 'SPECIFICATION.md v2 S9 as AMENDED v3 (BR2-1); S10 G4',
						genesisManifestKey: legState.genesisManifestKey,
						baseline: {
							universe: baselineTotal,
							reproducedByPairing: classification.reproducedByPairing,
							reproducedTotal,
							ruledCorrectLoss: classification.ruledCorrectLoss,
							unresolvedReported: classification.unresolvedReported,
						},
						familyEdgePopulation: perPairingGraphCounts,
						surplusOverAuthored: {
							reciprocal: surplus.reciprocal,
							reciprocalTotal,
							novelModern: surplus.novelModern,
							novelTotal,
							neitherClass: surplus.neitherClass,
						},
						provenance: {
							familyEdgesMissingProvenance: provenanceBad.length,
							reproducedMissingProvenance: reproducedProvenanceBad,
						},
						novelModernEnumeration: novelEnumeration.sort((a, b) => (a.triple < b.triple ? -1 : 1)),
					};
					fs.writeFileSync(
						path.join(ARTIFACTS_DIR, 'pilotPhase3-g4-census.json'),
						JSON.stringify(censusArtifact, null, 2),
					);
					console.error(`[containerLeg] G4 census artifact written (${novelEnumeration.length} novel edges enumerated)`);
					next('', args);
				},
			);
		},
	);
});

// ---- 7. dump ARM B + teardown --------------------------------------------------------
taskList.push((args, next) => {
	section('ARM B canonical dump + teardown');
	dumpGraph(
		{ boltUri: state.containerB.boltUri, password: state.containerB.password, dumpLabel: 'armB-genesis' },
		(err, dumpVerdict) => {
			if (err) {
				next(`ARM B dump: ${err}`);
				return;
			}
			state.dumps.armB = dumpVerdict;
			console.error(
				`[containerLeg] ARM B: ${dumpVerdict.nodeCount} nodes / ${dumpVerdict.edgeCount} edges ` +
					`(nodes ${dumpVerdict.nodeSha256.slice(0, 12)}…, edges ${dumpVerdict.edgeSha256.slice(0, 12)}…)`,
			);
			teardownContainer({ containerName: state.containerB.containerName }, (teardownErr) => {
				assert('ARM B container torn down', !teardownErr);
				next(teardownErr || '', args);
			});
		},
	);
});

// ---- 8. G7 clean-room: accumulated == genesis rebuild --------------------------------
taskList.push((args, next) => {
	section('G7 clean-room (accumulated fingerprint == genesis fingerprint)');
	const { armA, armB } = state.dumps;
	assert(
		`G7: node dumps IDENTICAL (${armA.nodeCount} vs ${armB.nodeCount} nodes; sha ${armA.nodeSha256.slice(0, 12)}…)`,
		armA.nodeSha256 === armB.nodeSha256 && armA.nodeCount === armB.nodeCount,
	);
	assert(
		`G7: edge dumps IDENTICAL (${armA.edgeCount} vs ${armB.edgeCount} edges; sha ${armA.edgeSha256.slice(0, 12)}…)`,
		armA.edgeSha256 === armB.edgeSha256 && armA.edgeCount === armB.edgeCount,
	);
	// comparator RED: one mutated byte must flip the comparison
	const mutated = sha256Text(fs.readFileSync(armA.nodePath, 'utf8').replace('ForgedNode', 'ForgedNodX'));
	assert('G7 comparator RED: a single mutated byte IS detected as a mismatch', mutated !== armA.nodeSha256);
	next('', args);
});

// ---- 9. G8 safety ---------------------------------------------------------------------
taskList.push((args, next) => {
	section('G8 safety (canonical byte-identical; container set restored; live mirrors untouched)');
	assert(
		'G8: canonical store BYTE-IDENTICAL after the container leg',
		sha256File(CANONICAL_STORE) === canonicalShaBefore,
	);
	const psAfter = docker(['ps', '-a', '--format', '{{.Names}}']);
	const containersAfter = `${psAfter.stdout}`.trim().split('\n').filter(Boolean).sort();
	assert(
		'G8: docker container set IDENTICAL to the preflight baseline (both pilotP3 containers gone)',
		JSON.stringify(containersAfter) === JSON.stringify(state.containerBaseline),
	);
	let mirrorsIntact = true;
	LIVE_MIRROR_CONTAINERS.forEach((oneName) => {
		const inspect = docker(['inspect', '--format', '{{.State.Running}}|{{.State.StartedAt}}', oneName]);
		const nowState = inspect.status === 0 ? `${inspect.stdout}`.trim() : 'ABSENT';
		if (nowState !== state.liveMirrorSnapshot[oneName]) {
			mirrorsIntact = false;
			console.error(`  G8 MIRROR DELTA: ${oneName} was '${state.liveMirrorSnapshot[oneName]}' now '${nowState}'`);
		}
	});
	assert(
		`G8: live mirrors (${LIVE_MIRROR_CONTAINERS.join(', ')}) Running with UNCHANGED StartedAt`,
		mirrorsIntact,
	);
	next('', args);
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`\nCONTAINER LEG ABORTED: ${err}`);
		// emergency hygiene: never leave a leg-owned container behind, even on abort
		[`${CONTAINER_PREFIX}accum`, `${CONTAINER_PREFIX}genesis`].forEach((oneName) => {
			const inspect = docker(['inspect', oneName]);
			if (inspect.status === 0) {
				console.error(`[containerLeg] abort hygiene: removing leg-owned ${oneName}`);
				docker(['rm', '-f', oneName]);
			}
		});
		fail++;
	}
	console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
	console.log(`dumps retained for the report: ${DUMP_DIR}`);
	process.exit(fail ? 1 : 0);
});
