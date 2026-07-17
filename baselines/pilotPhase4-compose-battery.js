#!/usr/bin/env node
'use strict';

// =====================================================================
// pilotPhase4-compose-battery — Phase 4 STORE/COMPOSE leg for the forge-
// architecture pilot (SPECIFICATION v2 S14; IMPLEMENTATION_PLAN v2 Phase 4;
// Builder C continuing). The materialize leg (determinism + the live
// GOLD_EVAL_260717 + S14 graph gates) is pilotPhase4-materialize-leg.js,
// which consumes this battery's state file.
// =====================================================================
// What this leg does:
//   0. preconditions (canonical + goldEval-copy hashes, fixtures, keyless ini,
//      CTDL vector sidecar present)
//   1. scratch store = SQLite-backup COPY of the goldEval260716 store copy
//      (the BASE golden's own store — the composed golden's blocks and manifest
//      accumulate here; canonical and the goldEval copy are READ-ONLY)
//   2. BASE-MANIFEST resolution FROM THE STORE (never memory): the named
//      'golden' pointer is measured and REPORTED (the known stale-pointer trap);
//      the authoritative base = the consensus currentManifest of the three
//      GOLD_EVAL_260716 build rows (gevalmeasure/goldevaldeta/goldevaldetb),
//      asserted == fixture-c's baselineManifestKey (d8606a1e…)
//   3. EMBEDDED modern CTDL via THE ESTABLISHED phaseE-forge-sweep recipe
//      (forger -forge -> edf-replay -extractSchema -> manifestEditor -save),
//      with TWO safety adaptations, both flagged:
//        - the validation graph's container is PRE-CREATED memory-safe
//          (1200m/512m/256m) and pre-REGISTERED in the scratch store's graphs
//          registry, so the forger's materializer REUSES it instead of
//          provisioning an uncapped instance (the OOM hard line);
//        - the forge runs against the KEYLESS voyage ini (the phaseE zero-spend
//          posture): a cache miss REFUSES LOUDLY and can never spend — the
//          FADED_FORGE pause-on-spend directive, structurally enforced. Warm/miss
//          batch counts parsed from the forge log and reported.
//   4. re-stage the three pairings via the REAL edf-bridge-maker over a working
//      manifest of {embedded CTDL + the golden's CTDLASN + CTDLQData blocks} —
//      expect the frozen 311/178/17 AND the SAME content-addressed blockIds as
//      Phase 3 (edge content is embedding-independent; asserted, not assumed)
//   5. S14 EXPLICIT-MEMBER COMPOSITION: base members MINUS the three legacy
//      carriers (fixture-c) PLUS embedded CTDL (at the old block's position)
//      PLUS the three pairings appended. Membership assertion; closure PASS;
//      closure RED on an injected-fault manifest.
//   6. state file for the materialize leg + G8 (store-plane: canonical AND the
//      goldEval copy byte-identical)
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
const PROJECT_ROOT = path.join(CODE_ROOT, '..');
const CORE_LIB = path.join(CODE_ROOT, 'npm', 'qtools-graph-forge-core', 'lib');
const CANONICAL_STORE = path.join(PROJECT_ROOT, 'dataStores', 'forgeStore.sqlite3');
const CANONICAL_SHA256 = '65a49a28dbfe6e393b8a97551197f61a512ce7462ff440ce7b42538cb43252ea' /* re-pinned 2026-07-17: FADED_FORGE incident ruling (Option A) — one inert pilotPhase4 CTDL block appended by the then-unpatched manifestEditor; prior sha 69cd3733… */;
const GOLDEVAL_COPY = '/tmp/goldEval260716.sqlite3';
const GOLDEVAL_SHA256 = 'c346fe25cf1965d06a2f4267332df61e9a0db763bf68bf2e0244728ca29c6abe';
const KEYLESS_INI = path.join(__dirname, 'keyless-scratch-inis', 'voyageEmbedding.ini');
const STATE_PATH = '/tmp/pilotPhase4-state.json';

const FORGER_CLI = path.join(CODE_ROOT, 'cli', 'lib.d', 'forger', 'forger.js');
const REPLAY_CLI = path.join(CODE_ROOT, 'cli', 'lib.d', 'edf-replay', 'edfReplay.js');
// manifestEditor.js is DELIBERATELY absent here: it has no EDF_FORGE_STORE_DB
// handling (welded to canonical — the 2026-07-17 incident); scratch-store block
// saves go through the in-process forgeStore API instead.
const BRIDGE_MAKER_CLI = path.join(CODE_ROOT, 'cli', 'lib.d', 'edf-bridge-maker', 'edfBridgeMaker.js');

const FIXTURE_C = require(path.join(__dirname, 'ctdlPilotFixtures', 'fixture-c-legacyCarrierBlockIds.json'));
const G1_ARTIFACT = require(path.join(__dirname, 'pilotPhase3Artifacts', 'pilotPhase3-g1-identityDiff.json'));
const LEGACY_CARRIER_IDS = FIXTURE_C.legacyCarriers.map((oneCarrier) => oneCarrier.blockId);
const OLD_CTDL_BLOCK_ID = FIXTURE_C.legacyCarriers.find(
	(oneCarrier) => oneCarrier.type === 'standard' && oneCarrier.subject === 'CTDL',
).blockId;

// the golden's EMBEDDED sibling standard blocks (Phase-2 byte-fidelity constants)
const GOLDEN_CTDLASN_BLOCK_ID = '98a5a6864978e2ac1a9ca0018291cb80896bbefb3bb5e2067c90028513906d97';
const GOLDEN_CTDLQDATA_BLOCK_ID = '5b228ff8f9e9f0293af3afb5c2e2e2a97d8b35c53b5cc26a0f591a3be6caeebe';

// Phase-3's staged pairing blockIds (committed at 86dcb77) — the embedding-
// independence cross-check: the SAME edge content must content-address here too.
const PHASE3_BRIDGE_BLOCK_IDS = {
	'CTDL::CTDLASN': '1e4d1ac4538b6b5abcb45f1bebf52b2f8f771b93ff150491a7cb323f56fa91c2',
	'CTDL::CTDLQData': '636801a60bf381304ed4c760fa2ffe8f2fafcff4382be1ee8e1028b887a19cad',
	'CTDLASN::CTDLQData': 'a0fff1fd5d777aeba0a464da7e5aafd515cc3117b2a7236021cd5ac3909c6142',
};

const VALIDATION_GRAPH_NAME = 'pilotP4valCtdl';
const VALIDATION_CONTAINER = `gf_${VALIDATION_GRAPH_NAME}`; // lifecycle naming convention
const NEO4J_IMAGE = 'neo4j:5.26';
const FORBIDDEN_PORTS = new Set([
	7700, 7701, 7702, 7703, 7706, 7707, 7708, 7709, 7712, 7713, 7716, 7717,
	7688, 7690, 7475, 7476,
]);

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const forgeStoreFactory = require(path.join(CORE_LIB, 'forge-store', 'forge-store'));
const vectorStorePath = require(path.join(CORE_LIB, 'vector-store', 'vector-store-path'))();
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

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

const docker = (dockerArgs) =>
	spawnSync('docker', dockerArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

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
		const boltPort = candidate;
		const httpPort = candidate + 1;
		if (
			FORBIDDEN_PORTS.has(boltPort) || FORBIDDEN_PORTS.has(httpPort) ||
			mapped.has(boltPort) || mapped.has(httpPort)
		) {
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
	tryCandidate(startAt);
};

const createMemorySafeContainer = ({ containerName, boltPort, httpPort, password }, callback) => {
	const runResult = docker([
		'run', '-d',
		'--name', containerName,
		'-p', `${boltPort}:7687`,
		'-p', `${httpPort}:7474`,
		'--memory', '1200m',
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
	// readiness: neo4j bolt auth round-trip via cypher-shell inside the container
	const deadline = Date.now() + 120000;
	const attemptOne = () => {
		const probe = docker([
			'exec', containerName, 'cypher-shell', '-u', 'neo4j', '-p', password, 'RETURN 1;',
		]);
		if (probe.status === 0) {
			callback('');
			return;
		}
		if (Date.now() > deadline) {
			callback(`neo4j in ${containerName} not ready within 120s`);
			return;
		}
		setTimeout(attemptOne, 3000);
	};
	setTimeout(attemptOne, 5000);
};

const runBridgeMaker = ({ dbPath, manifestKey, reportPath }) =>
	spawnSync(
		'node',
		[
			BRIDGE_MAKER_CLI, '-run',
			'--module=ctdlFamilyStructure',
			`--manifest=${manifestKey}`,
			`--reportOut=${reportPath}`,
		],
		{ env: { ...process.env, EDF_FORGE_STORE_DB: dbPath }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
	);

// =====================================================================
// the battery
// =====================================================================
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), '__TEST_pilotPhase4_'));
const scratchDbPath = path.join(scratchRoot, 'pilotP4-goldEvalCopy.sqlite3');
const blockFilePath = path.join(scratchRoot, 'pilotP4_std_ctdl_embedded.block');
const forgeLogPath = path.join(scratchRoot, 'pilotP4_forge_ctdl.log');
const bridgeReportPath = path.join(scratchRoot, 'bridgeMakerReport.json');
const canonicalShaBefore = sha256File(CANONICAL_STORE);
const goldEvalShaBefore = sha256File(GOLDEVAL_COPY);
const ctdlSidecarPath = vectorStorePath.vectorStoreDbPathForStandard({
	projectRoot: PROJECT_ROOT,
	standardKey: 'CTDL',
});

const state = {};
const taskList = new taskListPlus();

// ---- 0. preconditions ---------------------------------------------------------------
taskList.push((args, next) => {
	section('preconditions');
	assert('canonical store sha256 intact', canonicalShaBefore === CANONICAL_SHA256);
	assert('goldEval260716 store copy sha256 intact (the base golden bytes)', goldEvalShaBefore === GOLDEVAL_SHA256);
	assert('keyless voyage ini present (the zero-spend posture)', fs.existsSync(KEYLESS_INI));
	assert(`CTDL vector sidecar present (${path.basename(ctdlSidecarPath)})`, fs.existsSync(ctdlSidecarPath));
	assert('fixture-c legacy carriers loaded (3)', LEGACY_CARRIER_IDS.length === 3);
	state.ctdlSidecarShaBefore = sha256File(ctdlSidecarPath);
	const leftover = docker(['inspect', VALIDATION_CONTAINER]);
	assert(`no leftover ${VALIDATION_CONTAINER} container`, leftover.status !== 0);
	next('', args);
});

// ---- 1. scratch store = backup COPY of the goldEval store ----------------------------
taskList.push((args, next) => {
	section('scratch store from the goldEval260716 copy (SQLite backup API)');
	console.error(
		`STORE OVERRIDE ACTIVE: every store write below runs against the scratch copy ` +
			`${scratchDbPath} — canonical AND the goldEval copy are READ-ONLY this run`,
	);
	const backupRun = spawnSync('sqlite3', [GOLDEVAL_COPY, `.backup ${scratchDbPath}`], { encoding: 'utf8' });
	assert('sqlite .backup goldEvalCopy -> scratch succeeded', backupRun.status === 0 && fs.existsSync(scratchDbPath));
	assert('goldEval copy sha256 UNCHANGED by the backup read', sha256File(GOLDEVAL_COPY) === GOLDEVAL_SHA256);
	next('', args);
});

// ---- 1b. manifestEditor EDF_FORGE_STORE_DB gate (the 2026-07-17 incident, closed) ----
// RED evidence = the incident itself: the UNPATCHED manifestEditor, run under
// EDF_FORGE_STORE_DB=scratch, appended block 9767c883… to CANONICAL (sha 69cd3733…
// -> 65a49a28…; FADED_FORGE ruling Option A accepted the delta). GREEN below: the
// PATCHED CLI honors the env var — banner announced, block lands in SCRATCH ONLY,
// canonical byte-identical.
taskList.push((args, next) => {
	section('manifestEditor store-override gate (incident-closing; RED = the incident record)');
	const MANIFEST_CLI = path.join(CODE_ROOT, 'cli', 'lib.d', 'manifest-editor', 'manifestEditor.js');
	const probeText = replayBlock.serializeBlock({
		header: {
			blockType: 'standard',
			standardKey: '__TEST_p4OverrideProbe',
			version: 'probe',
			stableUriPropertyName: 'uri',
			resolutionKey: 'uri',
		},
		nodes: [
			{
				ref: { source: '__TEST_p4OverrideProbe', id: 'probe:only' },
				labels: ['ForgedNode'],
				stableId: 'probe:only',
				properties: { _source: ['__TEST_p4OverrideProbe'] },
			},
		],
		edges: [],
	});
	const probePath = path.join(scratchRoot, 'overrideProbe.block');
	fs.writeFileSync(probePath, probeText);
	const canonicalShaPre = sha256File(CANONICAL_STORE);
	const saveRun = spawnSync(
		'node',
		[MANIFEST_CLI, '-save', `--block=${probePath}`, '--producedBy=__TEST_p4OverrideProbe'],
		{ env: { ...process.env, EDF_FORGE_STORE_DB: scratchDbPath }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);
	const saveOutput = `${saveRun.stdout}\n${saveRun.stderr}`;
	assert('patched manifestEditor -save exits 0 under the env override', saveRun.status === 0);
	assert('STORE OVERRIDE banner ANNOUNCED by manifestEditor', /STORE OVERRIDE ACTIVE/.test(saveOutput));
	assert(
		'canonical BYTE-IDENTICAL after the overridden -save (the incident gap is CLOSED)',
		sha256File(CANONICAL_STORE) === canonicalShaPre,
	);
	const verifyStore = forgeStoreFactory();
	verifyStore.init({ dbPath: scratchDbPath }, (initErr) => {
		if (initErr) {
			next(`override-gate verify store init: ${initErr}`);
			return;
		}
		verifyStore.getBlock(
			{ blockId: `${(saveOutput.match(/[0-9a-f]{64}/) || [])[0]}` },
			(err, row) => {
				assert(
					'probe block landed in the SCRATCH store (env override honored end-to-end)',
					!err && !!row && row.producedBy === '__TEST_p4OverrideProbe',
				);
				next('', args);
			},
		);
	});
});

// ---- 2. BASE-MANIFEST resolution from the store (the stale-pointer trap, measured) ----
taskList.push((args, next) => {
	section('base-manifest resolution FROM THE STORE (never memory)');
	const forgeStore = forgeStoreFactory();
	const sub = new taskListPlus();
	sub.push((subArgs, subNext) => forgeStore.init({ dbPath: scratchDbPath }, (err) => subNext(err, subArgs)));
	sub.push((subArgs, subNext) => {
		// the named 'golden' pointer — measured for the record (the KNOWN trap)
		forgeStore.getGraphByName({ name: 'golden' }, (err, goldenRow) => {
			if (err) {
				subNext(`getGraphByName(golden): ${err}`);
				return;
			}
			state.namedGoldenPointer = goldenRow ? goldenRow.currentManifest : null;
			console.error(
				`[pilotPhase4] named 'golden' pointer = ${`${state.namedGoldenPointer}`.slice(0, 12)}… ` +
					`(measured; the build rows below are the authority)`,
			);
			subNext('', subArgs);
		});
	});
	// the three GOLD_EVAL_260716 build rows are the authority: their consensus
	// currentManifest is the manifest the LIVE golden was materialized from.
	const buildRowNames = ['gevalmeasure', 'goldevaldeta', 'goldevaldetb'];
	const buildRowManifests = [];
	buildRowNames.forEach((oneName) => {
		sub.push((subArgs, subNext) => {
			forgeStore.getGraphByName({ name: oneName }, (err, row) => {
				if (err || !row) {
					subNext(err || `no graph row '${oneName}' in the base store`);
					return;
				}
				buildRowManifests.push(row.currentManifest);
				subNext('', subArgs);
			});
		});
	});
	sub.push((subArgs, subNext) => {
		const consensus = buildRowManifests.every((oneKey) => oneKey === buildRowManifests[0])
			? buildRowManifests[0]
			: null;
		assert(
			`base = CONSENSUS of the three build rows (${`${consensus}`.slice(0, 12)}…)`,
			!!consensus,
		);
		assert(
			'base manifest == fixture-c baselineManifestKey (d8606a1e…)',
			consensus === FIXTURE_C.baselineManifestKey,
		);
		assert(
			`the named 'golden' pointer is STALE vs the build consensus (trap observed: ` +
				`${`${state.namedGoldenPointer}`.slice(0, 12)}… != ${`${consensus}`.slice(0, 12)}…)`,
			state.namedGoldenPointer !== consensus,
		);
		state.baseManifestKey = consensus;
		forgeStore.getManifest({ manifestKey: consensus }, (err, manifest) => {
			if (err || !manifest) {
				subNext(err || `base manifest ${consensus} unreadable`);
				return;
			}
			state.baseMemberIds = (manifest.members || []).map((oneMember) => oneMember.blockId);
			assert(`base manifest carries 34 members (got ${state.baseMemberIds.length})`, state.baseMemberIds.length === 34);
			assert(
				'base manifest contains ALL THREE legacy carriers (they are what S14 removes)',
				LEGACY_CARRIER_IDS.every((oneId) => state.baseMemberIds.indexOf(oneId) !== -1),
			);
			subNext('', subArgs);
		});
	});
	pipeRunner(sub.getList(), {}, (err) => {
		state.forgeStore = forgeStore;
		next(err, args);
	});
});

// ---- 3. EMBEDDED modern CTDL via the established phaseE recipe ------------------------
taskList.push((args, next) => {
	section('embedded modern CTDL (phaseE recipe; memory-safe reuse; keyless zero-spend)');
	findFreePortPair(7940, (portErr, ports) => {
		if (portErr) {
			next(portErr);
			return;
		}
		const password = crypto.randomBytes(18).toString('hex');
		createMemorySafeContainer(
			{ containerName: VALIDATION_CONTAINER, boltPort: ports.boltPort, httpPort: ports.httpPort, password },
			(containerErr) => {
				if (containerErr) {
					next(containerErr);
					return;
				}
				console.error(`[pilotPhase4] ${VALIDATION_CONTAINER} up (bolt ${ports.boltPort}, capped 1200m)`);
				// pre-REGISTER so the forger's materializer REUSES the capped container
				state.forgeStore.upsertGraph(
					{
						name: VALIDATION_GRAPH_NAME,
						location: `bolt://localhost:${ports.boltPort}`,
						type: 'ephemeral',
						credentialReference: 'pilotPhase4:directCapped',
						credentialValue: password,
					},
					(upsertErr) => {
						if (upsertErr) {
							next(`upsertGraph(${VALIDATION_GRAPH_NAME}): ${upsertErr}`);
							return;
						}
						const forgeRun = spawnSync(
							'node',
							[
								FORGER_CLI, '-forge',
								'--standardName=ctdl',
								`--destination=${VALIDATION_GRAPH_NAME}`,
								'--owner=:golden',
								`--embeddingConfigFilePath=${KEYLESS_INI}`,
							],
							{
								env: { ...process.env, EDF_FORGE_STORE_DB: scratchDbPath },
								encoding: 'utf8',
								maxBuffer: 256 * 1024 * 1024,
							},
						);
						fs.writeFileSync(forgeLogPath, `${forgeRun.stdout}\n${forgeRun.stderr}`);
						const forgeLog = `${forgeRun.stdout}\n${forgeRun.stderr}`;
						const warmBatches = (forgeLog.match(/0 miss — warm/g) || []).length;
						const missBatches = (forgeLog.match(/ embedded \(/g) || []).length;
						state.embeddingReuse = { warmBatches, missBatches };
						console.error(
							`[pilotPhase4] embedding reuse: warmBatches=${warmBatches} missBatches=${missBatches} rc=${forgeRun.status}`,
						);
						assert('forge (embeddings ON, keyless ini) exits 0', forgeRun.status === 0);
						assert(
							`ZERO cache-miss batches (warm=${warmBatches}, miss=${missBatches}) — no spend, ` +
								`the pause-on-spend trigger never fired`,
							missBatches === 0 && warmBatches > 0,
						);
						if (forgeRun.status !== 0 || missBatches !== 0) {
							next(
								`EMBEDDING CACHE NOT WARM or forge failure (warm=${warmBatches} miss=${missBatches}) — ` +
									`STOP: report the miss count to FADED_FORGE before any spend decision. Log: ${forgeLogPath}`,
							);
							return;
						}
						next('', args);
					},
				);
			},
		);
	});
});

// ---- 3b. extractSchema -> save (the block), then self-teardown ------------------------
taskList.push((args, next) => {
	section('extractSchema -> manifestEditor -save (sidecar-ref block) + self-teardown');
	const extractRun = spawnSync(
		'node',
		[
			REPLAY_CLI, '-extractSchema',
			`--from=${VALIDATION_GRAPH_NAME}`,
			'--selector=standard',
			'--subject=CTDL',
			`--out=${blockFilePath}`,
		],
		{ env: { ...process.env, EDF_FORGE_STORE_DB: scratchDbPath }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
	);
	assert('extractSchema exits 0', extractRun.status === 0);
	if (extractRun.status !== 0) {
		next(`extractSchema failed:\n${extractRun.stderr}`);
		return;
	}
	const blockText = fs.readFileSync(blockFilePath, 'utf8');
	assert(
		'extracted block is SIDECAR-REF style (embeddingRef present, no inline "embedding")',
		blockText.indexOf('"embeddingRef"') !== -1 && blockText.indexOf('"embedding":') === -1,
	);
	const parsedBlock = replayBlock.deserializeBlock(blockText);
	assert(`extracted block carries 994 nodes (got ${parsedBlock.nodes.length})`, parsedBlock.nodes.length === 994);
	// extract-path blocks carry header version NULL BY DESIGN (S6: store rows carry
	// version=NULL, schema-extractor convention; resolution is block-text inspection).
	// The release identity therefore lives in the NODE properties — assert it there.
	assert(
		`extracted header version is NULL (the extract-path convention) and the block text carries 20260327`,
		parsedBlock.header.version == null && /20260327/.test(blockText),
	);
	// G1 replication vs the committed Phase-3 artifact: same node-identity universe
	const extractedIds = new Set(parsedBlock.nodes.map((oneNode) => oneNode.stableId));
	const artifactAddsAbsent = G1_ARTIFACT.drops.every((oneDrop) => !extractedIds.has(oneDrop.stableId));
	assert(
		'embedded block node identity matches Phase-3 fresh CTDL (994; all 20 G1 drops absent)',
		extractedIds.size === 994 && artifactAddsAbsent,
	);
	// SAVE via the in-process forgeStore API against the SCRATCH store. NEVER via
	// manifestEditor -save: that CLI carries NO EDF_FORGE_STORE_DB handling and is
	// WELDED TO CANONICAL (the forgeManager --db / edf-gate gotcha family) — the
	// 2026-07-17 incident, observed live: one -save silently appended the block to
	// the canonical store. forgeStore.saveBlock is the exact API -save wraps.
	state.forgeStore.saveBlock(
		{
			type: 'standard',
			subject: 'CTDL',
			version: parsedBlock.header.version || null,
			requires: [],
			text: blockText,
			producedBy: 'pilotPhase4:freshForge-embedded',
		},
		(saveErr, saveResult) => {
			assert('embedded CTDL block saved to the SCRATCH store (in-process API)', !saveErr && !!saveResult);
			if (saveErr) {
				next(`scratch saveBlock failed: ${saveErr}`);
				return;
			}
			state.embeddedCtdlBlockId = saveResult.blockId;
			console.error(`[pilotPhase4] embedded CTDL block: ${state.embeddedCtdlBlockId.slice(0, 12)}…`);
			assert(
				'embedded CTDL blockId differs from the old block AND both stale generations (a NEW generation)',
				state.embeddedCtdlBlockId !== OLD_CTDL_BLOCK_ID &&
					state.embeddedCtdlBlockId.indexOf('d9ee61c9') !== 0 &&
					state.embeddedCtdlBlockId.indexOf('dd0424a4') !== 0,
			);
			// AUTHORIZED self-teardown of the leg-owned validation container (pilotP4 scope)
			const rmRun = docker(['rm', '-f', VALIDATION_CONTAINER]);
			assert(`validation container ${VALIDATION_CONTAINER} torn down`, rmRun.status === 0);
			assert(
				'CTDL vector sidecar byte-identical after the warm forge+extract (read-only in effect)',
				sha256File(ctdlSidecarPath) === state.ctdlSidecarShaBefore,
			);
			next('', args);
		},
	);
});

// ---- 4. re-stage the three pairings over {embedded CTDL + golden ASN/QData} ----------
taskList.push((args, next) => {
	section('re-stage pairings (real bridgeMaker; S1.7 requires = the COMPOSED standard blockIds)');
	state.forgeStore.saveManifest(
		{
			label: '__TEST_pilotP4_working',
			note: 'Phase 4 working manifest: embedded modern CTDL + the golden\'s embedded CTDLASN/CTDLQData',
			members: [
				{ blockId: state.embeddedCtdlBlockId, position: null },
				{ blockId: GOLDEN_CTDLASN_BLOCK_ID, position: null },
				{ blockId: GOLDEN_CTDLQDATA_BLOCK_ID, position: null },
			],
		},
		(err, manifestResult) => {
			if (err) {
				next(`working manifest save failed: ${err}`);
				return;
			}
			state.workingManifestKey = manifestResult.manifestKey;
			const bridgeRun = runBridgeMaker({
				dbPath: scratchDbPath,
				manifestKey: state.workingManifestKey,
				reportPath: bridgeReportPath,
			});
			assert('bridgeMaker exits 0', bridgeRun.status === 0);
			if (bridgeRun.status !== 0) {
				next(`bridgeMaker failed:\n${bridgeRun.stderr}`);
				return;
			}
			const report = JSON.parse(fs.readFileSync(bridgeReportPath, 'utf8'));
			state.bridgeBlocks = report.stagedBlocks.map((oneBlock) => ({
				pairSubject: oneBlock.pairSubject,
				blockId: oneBlock.blockId,
				versionKey: oneBlock.versionKey,
				edgeCount: oneBlock.counts.edges,
			}));
			const countsBySubject = {};
			report.stagedBlocks.forEach((oneBlock) => {
				countsBySubject[oneBlock.pairSubject] = oneBlock.counts.edges;
			});
			assert(
				`emissions = frozen 311/178/17 (got ${countsBySubject['CTDL::CTDLASN']}/${countsBySubject['CTDL::CTDLQData']}/${countsBySubject['CTDLASN::CTDLQData']})`,
				countsBySubject['CTDL::CTDLASN'] === 311 &&
					countsBySubject['CTDL::CTDLQData'] === 178 &&
					countsBySubject['CTDLASN::CTDLQData'] === 17,
			);
			assert(
				'staged blockIds IDENTICAL to Phase 3 (edge content embedding-independent — proven, not assumed)',
				report.stagedBlocks.every(
					(oneBlock) => PHASE3_BRIDGE_BLOCK_IDS[oneBlock.pairSubject] === oneBlock.blockId,
				),
			);
			next('', args);
		},
	);
});

// ---- 5. S14 explicit-member composition + membership + closure (PASS and RED) --------
taskList.push((args, next) => {
	section('S14 explicit-member composition (base MINUS carriers PLUS modern family)');
	const composedMembers = [];
	state.baseMemberIds.forEach((oneId) => {
		if (oneId === OLD_CTDL_BLOCK_ID) {
			composedMembers.push(state.embeddedCtdlBlockId); // modern CTDL at the old position
			return;
		}
		if (LEGACY_CARRIER_IDS.indexOf(oneId) !== -1) {
			return; // legacy bridge + consolidated block: REMOVED (S14)
		}
		composedMembers.push(oneId);
	});
	state.bridgeBlocks.forEach((oneBridge) => composedMembers.push(oneBridge.blockId));

	assert(`composed member count = 35 (34 - 3 carriers + 1 CTDL + 3 pairings; got ${composedMembers.length})`, composedMembers.length === 35);
	assert(
		'S14 MEMBERSHIP ASSERTION: composed list carries ZERO legacy carrier blockIds',
		composedMembers.every((oneId) => LEGACY_CARRIER_IDS.indexOf(oneId) === -1),
	);
	assert(
		'composed list carries the embedded CTDL + both golden siblings + all three pairings',
		[state.embeddedCtdlBlockId, GOLDEN_CTDLASN_BLOCK_ID, GOLDEN_CTDLQDATA_BLOCK_ID,
			...state.bridgeBlocks.map((oneBridge) => oneBridge.blockId),
		].every((oneId) => composedMembers.indexOf(oneId) !== -1),
	);

	state.forgeStore.saveManifest(
		{
			label: 'pilotP4-fullGolden-GOLD_EVAL_260717',
			note:
				'Phase 4 S14 explicit-member composition: production base d8606a1e MINUS the three legacy ' +
				'carriers PLUS embedded modern CTDL PLUS the three pilot structuralBridge pairings',
			members: composedMembers.map((oneId) => ({ blockId: oneId, position: null })),
		},
		(err, manifestResult) => {
			if (err) {
				next(`composed manifest save failed: ${err}`);
				return;
			}
			state.composedManifestKey = manifestResult.manifestKey;
			console.error(`[pilotPhase4] composed manifest: ${state.composedManifestKey.slice(0, 12)}…`);
			// DELTA-CLOSURE gate (FADED_FORGE ruling, 2026-07-17): the BASE production
			// golden itself fails blockId-closure with 41 pre-existing violations — 13
			// legacy CEDS::X / CIP::SOC mapping blocks whose requires pin SUPERSEDED
			// GENERATIONS of the standard blocks (the D1 closure discipline postdates
			// this manifest lineage; measured 41 == 41, zero touching the removed
			// carriers). Absolute closure would demand a legacy re-key campaign (BR1-4
			// territory, a separate work-order). The Phase-4 contract is therefore:
			// the composition introduces ZERO NEW violations, heals nothing silently,
			// and none of the pre-existing violations involve the removed carriers or
			// the new pairing blocks.
			const violationKey = (oneViolation) => `${oneViolation.blockId}>${oneViolation.requiredBlockId}`;
			// each closure call runs in an ISOLATED subprocess: full-golden closure
			// peaks 4-6GB of heap PER CALL (the 66MB CEDS reference block deserialized);
			// two calls in one process OOM even an 8GB heap (observed 2026-07-17).
			const closureProbe = (manifestKey) => {
				const probeRun = spawnSync(
					'node',
					[
						'--max-old-space-size=8192',
						path.join(__dirname, 'pilotPhase4-closure-probe.js'),
						`--db=${scratchDbPath}`,
						`--manifest=${manifestKey}`,
					],
					{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
				);
				if (probeRun.status !== 0) {
					return { error: `closure probe failed (${manifestKey.slice(0, 12)}…): ${probeRun.stderr}` };
				}
				return JSON.parse(probeRun.stdout);
			};
			{
				const baseVerdict = closureProbe(state.baseManifestKey);
				if (baseVerdict.error) {
					next(baseVerdict.error);
					return;
				}
				const baseViolations = new Set((baseVerdict.violations || []).map(violationKey));
				const verdict = closureProbe(state.composedManifestKey);
				if (verdict.error) {
					next(verdict.error);
					return;
				}
				{
					const composedViolations = (verdict.violations || []).map(violationKey);
					const newViolations = composedViolations.filter((oneKey) => !baseViolations.has(oneKey));
					const healedViolations = [...baseViolations].filter(
						(oneKey) => composedViolations.indexOf(oneKey) === -1,
					);
					const pairingIds = state.bridgeBlocks.map((oneBridge) => oneBridge.blockId);
					const involvesNewOrRemoved = composedViolations.filter((oneKey) =>
						[...LEGACY_CARRIER_IDS, ...pairingIds, state.embeddedCtdlBlockId].some(
							(oneId) => oneKey.indexOf(oneId) !== -1,
						),
					);
					assert(
						`DELTA-closure: ZERO NEW violations vs the base's ${baseViolations.size} pre-existing ` +
							`(composed ${composedViolations.length}; new ${newViolations.length}; healed ${healedViolations.length})`,
						newViolations.length === 0 && healedViolations.length === 0,
					);
					assert(
						'DELTA-closure: no violation involves the removed carriers, the embedded CTDL, or the pairings',
						involvesNewOrRemoved.length === 0,
					);
					// legacy-closure-debt artifact (FADED_FORGE ruling addition 1): the 41
					// pre-existing violations, enumerated as the input for the FUTURE
					// 'legacy mapping-block requires rekey campaign' work-order (BR1-4's
					// version-following verb is its prerequisite). Measured and named
					// today; retired deliberately later.
					const p4ArtifactsDir = path.join(__dirname, 'pilotPhase4Artifacts');
					if (!fs.existsSync(p4ArtifactsDir)) {
						fs.mkdirSync(p4ArtifactsDir, { recursive: true });
					}
					const byOwningBlock = {};
					(verdict.violations || []).forEach((oneViolation) => {
						const owner = `${oneViolation.detail}`.split(' requires ')[0];
						byOwningBlock[owner] = byOwningBlock[owner] || [];
						byOwningBlock[owner].push({
							requiredBlockId: oneViolation.requiredBlockId,
							detail: oneViolation.detail,
						});
					});
					fs.writeFileSync(
						path.join(p4ArtifactsDir, 'legacyClosureDebt.json'),
						JSON.stringify(
							{
								artifact: 'legacyClosureDebt',
								ruling:
									'FADED_FORGE 2026-07-17: delta-closure approved; absolute closure deferred to a ' +
									'future legacy mapping-block requires rekey campaign (prerequisite: BR1-4 ' +
									'version-following re-key verb)',
								baseManifestKey: state.baseManifestKey,
								composedManifestKey: state.composedManifestKey,
								violationCount: (verdict.violations || []).length,
								byOwningBlock,
								violations: verdict.violations || [],
							},
							null,
							2,
						),
					);
					console.error(
						`[pilotPhase4] legacyClosureDebt artifact written (${(verdict.violations || []).length} violations enumerated)`,
					);
					// delta-closure RED: composed minus the CTDLASN standard MUST add NEW
					// violations (the pairings' requires break) — the comparator can fail.
					const redMembers = composedMembers.filter((oneId) => oneId !== GOLDEN_CTDLASN_BLOCK_ID);
					state.forgeStore.saveManifest(
						{
							label: '__TEST_pilotP4_closureRed',
							note: 'delta-closure RED fixture: composed minus the CTDLASN standard',
							members: redMembers.map((oneId) => ({ blockId: oneId, position: null })),
						},
						(redErr, redManifest) => {
							if (redErr) {
								next(`closure RED fixture: ${redErr}`);
								return;
							}
							const redVerdict = closureProbe(redManifest.manifestKey);
							const redKeys = redVerdict.error ? [] : (redVerdict.violations || []).map(violationKey);
							const redNew = redKeys.filter((oneKey) => !baseViolations.has(oneKey));
							assert(
								`delta-closure RED: composed minus CTDLASN adds NEW violations (${redNew.length} detected)`,
								!redVerdict.error && redNew.length > 0,
							);
							next('', args);
						},
					);
				}
			}
		},
	);
});

// ---- 6. state file + G8 (store-plane) --------------------------------------------------
taskList.push((args, next) => {
	section('state hand-off + G8 (store-plane)');
	const stateOut = {
		writtenBy: 'pilotPhase4-compose-battery',
		scratchDbPath,
		scratchRoot,
		baseManifestKey: state.baseManifestKey,
		namedGoldenPointerObserved: state.namedGoldenPointer,
		embeddedCtdlBlockId: state.embeddedCtdlBlockId,
		bridgeBlocks: state.bridgeBlocks,
		workingManifestKey: state.workingManifestKey,
		composedManifestKey: state.composedManifestKey,
		embeddingReuse: state.embeddingReuse,
	};
	fs.writeFileSync(STATE_PATH, JSON.stringify(stateOut, null, 2));
	assert(`state file written (${STATE_PATH})`, fs.existsSync(STATE_PATH));
	assert('G8: canonical BYTE-IDENTICAL', sha256File(CANONICAL_STORE) === CANONICAL_SHA256);
	assert('G8: goldEval260716 copy BYTE-IDENTICAL', sha256File(GOLDEVAL_COPY) === GOLDEVAL_SHA256);
	next('', args);
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`\nBATTERY ABORTED: ${err}`);
		const leftover = docker(['inspect', VALIDATION_CONTAINER]);
		if (leftover.status === 0) {
			console.error(`[pilotPhase4] abort hygiene: removing leg-owned ${VALIDATION_CONTAINER}`);
			docker(['rm', '-f', VALIDATION_CONTAINER]);
		}
		fail++;
	}
	console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
	console.log(`scratch store retained for the materialize leg: ${scratchDbPath}`);
	process.exit(fail ? 1 : 0);
});
