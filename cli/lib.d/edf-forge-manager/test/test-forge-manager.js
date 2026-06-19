#!/usr/bin/env node
'use strict';

// test-forge-manager.js — FAST SYNTHETIC end-to-end gate for edf-forge-manager (Phase 6).
//
// Uses the two synthetic forge bundles (forge-p6hub _source 'ceds', forge-p6second _source
// 'synthstd' with cedsId crossRefs into the hub) so the golden flow runs without the full CEDS
// parse or Voyage embeddings. Asserts:
//   GATE 1  -addStandard p6hub  then  -addStandard p6second  -> published golden with BOTH
//           standards' nodes AND >=1 SPECIFIED_MAPPING bridge.
//   GATE 2  golden ≡ replay(goldenManifest): rebuild the golden manifest into a fresh graph and
//           assert it is node/edge-identical to the live golden.
//   GATE 3  -rollback golden (to the pre-second manifest) rebuilds a graph identical to hub-only golden.
//   GATE 4  -list blocks|manifests|graphs reflects reality; --stale flags a constructed drift case.
//
// Force-tears-down ALL test containers/volumes at the END even on failure. Touches ONLY graphs it
// created (unique-tagged + the named 'golden'/'goldenCheck'); never the unrelated gf_ containers.
//
// Run: node test-forge-manager.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const neo4j = require('neo4j-driver');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const LIB_D = path.join(projectRoot, 'code', 'cli', 'lib.d');
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CANONICAL_DB_PATH = path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');
const MANAGER = path.join(LIB_D, 'edf-forge-manager', 'edfForgeManager.js');
const REPLAY = path.join(LIB_D, 'edf-replay', 'edfReplay.js');

const NEO4J_USER = 'neo4j';

// the test calls forge-store/sqlite-instance in-process, which read process.global; bootstrap it.
process.global = {
	xLog: {
		status: () => {},
		error: (...a) => console.error(...a),
		result: () => {},
		verbose: () => {},
	},
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
	rawConfig: {},
};

// --- minimal logging + assertion bookkeeping ------------------------------------------------
let passCount = 0;
let failCount = 0;
const failures = [];
const log = (msg) => console.log(msg);
const assert = (cond, label) => {
	if (cond) {
		passCount++;
		log(`  PASS: ${label}`);
	} else {
		failCount++;
		failures.push(label);
		log(`  FAIL: ${label}`);
	}
};

// --- run the manager / replay; capture stdout JSON ------------------------------------------
const runNode = (entryPath, args, callback) => {
	execFile(
		'node',
		[entryPath, ...args],
		{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
		(err, stdout, stderr) => {
			if (err) {
				callback(`exit ${err.code}: ${(stderr || '').trim() || err.message}`);
				return;
			}
			let parsed = null;
			const text = (stdout || '').trim();
			if (text) {
				try {
					parsed = JSON.parse(text);
				} catch (e) {
					parsed = null;
				}
			}
			callback('', { stdout, stderr, parsed });
		},
	);
};

// --- forge-store reads (manifest pointer, graph rows) ---------------------------------------
const openStore = (callback) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	forgeStore.init({ dbPath: CANONICAL_DB_PATH }, (err) => callback(err, forgeStore));
};

// --- snapshot a graph's nodes+edges by name (via the registry credential) -------------------
const snapshotGraph = (graphName, callback) => {
	openStore((storeErr, forgeStore) => {
		if (storeErr) {
			callback(storeErr);
			return;
		}
		forgeStore.getGraphByName({ name: graphName }, (err, graphRow) => {
			if (err || !graphRow) {
				callback(err || `no graph '${graphName}'`);
				return;
			}
			const driver = neo4j.driver(
				graphRow.location,
				neo4j.auth.basic(NEO4J_USER, graphRow.credentialValue),
				{ encrypted: false },
			);
			const session = driver.session({ defaultAccessMode: neo4j.session.READ });
			session
				.run(
					`MATCH (n:ForgedNode) RETURN n._source AS source, n.stableId AS stableId
					 ORDER BY source, stableId`,
				)
				.then((nodeResult) => {
					const nodes = nodeResult.records.map(
						(rec) => `${rec.get('source')}::${rec.get('stableId')}`,
					);
					session
						.run(
							`MATCH (a:ForgedNode)-[r]->(b:ForgedNode)
							 RETURN a.stableId AS fromId, type(r) AS type, b.stableId AS toId
							 ORDER BY fromId, type, toId`,
						)
						.then((edgeResult) => {
							const edges = edgeResult.records.map(
								(rec) =>
									`${rec.get('fromId')}-[${rec.get('type')}]->${rec.get('toId')}`,
							);
							const specifiedCount = edges.filter((e) =>
								e.includes('[SPECIFIED_MAPPING]'),
							).length;
							session
								.close()
								.then(() => driver.close())
								.then(() =>
									callback('', { nodes, edges, specifiedCount }),
								);
						})
						.catch((e) => {
							session.close().then(() => driver.close()).catch(() => {});
							callback(`snapshot edges: ${e.message}`);
						});
				})
				.catch((e) => {
					session.close().then(() => driver.close()).catch(() => {});
					callback(`snapshot nodes: ${e.message}`);
				});
		});
	});
};

const sameSet = (a, b) =>
	a.length === b.length && a.slice().sort().join('|') === b.slice().sort().join('|');

// --- docker cleanup -------------------------------------------------------------------------
const TEST_GRAPH_PREFIXES = ['p6val_']; // ephemeral validation graphs; tagged by run
const TEST_NAMED_GRAPHS = ['bronze', 'golden', 'goldenCheck', 'rollbackCheck'];

const dockerContainerNames = () => {
	const out = execFileSync(
		'docker',
		['ps', '-a', '--format', '{{.Names}}'],
		{ encoding: 'utf8' },
	).trim();
	return out ? out.split('\n') : [];
};
const dockerVolumeNames = () => {
	const out = execFileSync(
		'docker',
		['volume', 'ls', '--format', '{{.Name}}'],
		{ encoding: 'utf8' },
	).trim();
	return out ? out.split('\n') : [];
};

const isMineContainer = (name) =>
	TEST_NAMED_GRAPHS.some((g) => name === `gf_${g}`) ||
	TEST_GRAPH_PREFIXES.some((p) => name.startsWith(`gf_${p}`));
const isMineVolume = (name) =>
	TEST_NAMED_GRAPHS.some((g) => name === `gf_${g}_data`) ||
	TEST_GRAPH_PREFIXES.some((p) => name.startsWith(`gf_${p}`));

const forceTeardown = () => {
	log('\n--- teardown: removing ONLY this test\'s containers/volumes ---');
	let containers = [];
	let volumes = [];
	try {
		containers = dockerContainerNames().filter(isMineContainer);
		volumes = dockerVolumeNames().filter(isMineVolume);
	} catch (e) {
		log(`  teardown enumerate failed: ${e.message}`);
	}
	containers.forEach((name) => {
		try {
			execFileSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
			log(`  removed container ${name}`);
		} catch (e) {
			log(`  could not remove container ${name}: ${e.message}`);
		}
	});
	volumes.forEach((name) => {
		try {
			execFileSync('docker', ['volume', 'rm', '-f', name], { encoding: 'utf8' });
			log(`  removed volume ${name}`);
		} catch (e) {
			log(`  could not remove volume ${name}: ${e.message}`);
		}
	});
	// the canonical store is test scaffolding here; remove it so reruns are clean.
	try {
		if (fs.existsSync(CANONICAL_DB_PATH)) {
			fs.unlinkSync(CANONICAL_DB_PATH);
			log('  removed test forgeStore.sqlite3');
		}
	} catch (e) {
		log(`  could not remove store: ${e.message}`);
	}
};

// =====================================================================
// THE SEQUENCE (callback chain; resolves at the leaf, no async/await)
// =====================================================================

const finish = (fatalErr) => {
	forceTeardown();
	log('\n========================================');
	if (fatalErr) {
		log(`FATAL: ${fatalErr}`);
	}
	log(`RESULT: ${passCount} passed, ${failCount} failed` + (fatalErr ? ' (aborted)' : ''));
	log('========================================');
	process.exit(failCount > 0 || fatalErr ? 1 : 0);
};

// fresh start: remove any stale store + my containers from a prior run.
const preClean = () => {
	forceTeardown();
};

const main = () => {
	preClean();

	let goldenAfterHub = null; // golden manifestKey after p6hub (the rollback target)
	let goldenAfterSecond = null; // golden manifestKey after p6second
	let hubGoldenSnapshot = null; // snapshot of golden after hub-only (for rollback compare)
	let bothGoldenSnapshot = null; // snapshot of golden after both

	log('\n=== GATE 1a: -addStandard p6hub ===');
	runNode(MANAGER, ['-addStandard', '--standardName=p6hub'], (err1, res1) => {
		if (err1) {
			finish(`-addStandard p6hub failed: ${err1}`);
			return;
		}
		assert(!!res1.parsed && res1.parsed.published === true, 'p6hub published golden');
		goldenAfterHub = res1.parsed && res1.parsed.goldenManifestKey;
		assert(!!goldenAfterHub, 'p6hub returned a golden manifestKey');

		snapshotGraph('golden', (snapErr, hubSnap) => {
			if (snapErr) {
				finish(`snapshot golden after hub failed: ${snapErr}`);
				return;
			}
			hubGoldenSnapshot = hubSnap;
			assert(
				hubSnap.nodes.some((n) => n.startsWith('ceds::')),
				'hub-only golden contains ceds nodes',
			);
			assert(
				!hubSnap.nodes.some((n) => n.startsWith('synthstd::')),
				'hub-only golden has NO synthstd nodes yet',
			);

			log('\n=== GATE 1b: -addStandard p6second ===');
			runNode(MANAGER, ['-addStandard', '--standardName=p6second'], (err2, res2) => {
				if (err2) {
					finish(`-addStandard p6second failed: ${err2}`);
					return;
				}
				assert(
					!!res2.parsed && res2.parsed.published === true,
					'p6second published golden',
				);
				goldenAfterSecond = res2.parsed && res2.parsed.goldenManifestKey;
				assert(!!goldenAfterSecond, 'p6second returned a golden manifestKey');
				assert(
					goldenAfterSecond !== goldenAfterHub,
					'golden manifestKey advanced after second standard',
				);

				snapshotGraph('golden', (snap2Err, bothSnap) => {
					if (snap2Err) {
						finish(`snapshot golden after both failed: ${snap2Err}`);
						return;
					}
					bothGoldenSnapshot = bothSnap;
					assert(
						bothSnap.nodes.some((n) => n.startsWith('ceds::')) &&
							bothSnap.nodes.some((n) => n.startsWith('synthstd::')),
						'GATE1: published golden contains BOTH standards\' nodes',
					);
					assert(
						bothSnap.specifiedCount >= 1,
						`GATE1: golden has >=1 SPECIFIED_MAPPING bridge (got ${bothSnap.specifiedCount})`,
					);

					gate2(bothGoldenSnapshot, goldenAfterSecond, hubGoldenSnapshot, goldenAfterHub);
				});
			});
		});
	});
};

// GATE 2: golden ≡ replay(goldenManifest) — rebuild the golden manifest into a fresh graph.
const gate2 = (bothSnap, goldenManifestKey, hubSnap, goldenAfterHub) => {
	log('\n=== GATE 2: golden ≡ replay(goldenManifest) ===');
	runNode(
		REPLAY,
		[
			'-buildGraph',
			`--manifest=${goldenManifestKey}`,
			'--destination=goldenCheck',
			'--owner=:golden',
		],
		(err, res) => {
			if (err) {
				finish(`rebuild goldenCheck failed: ${err}`);
				return;
			}
			snapshotGraph('goldenCheck', (snapErr, checkSnap) => {
				if (snapErr) {
					finish(`snapshot goldenCheck failed: ${snapErr}`);
					return;
				}
				assert(
					sameSet(bothSnap.nodes, checkSnap.nodes),
					'GATE2: replay(goldenManifest) node set identical to live golden',
				);
				assert(
					sameSet(bothSnap.edges, checkSnap.edges),
					'GATE2: replay(goldenManifest) edge set identical to live golden',
				);
				gate3(hubSnap, goldenAfterHub, goldenManifestKey);
			});
		},
	);
};

// GATE 3: -rollback golden to the pre-second manifest rebuilds a graph identical to hub-only golden.
const gate3 = (hubSnap, goldenAfterHub) => {
	log('\n=== GATE 3: -rollback golden (to pre-second manifest) ===');
	runNode(
		MANAGER,
		['-rollback', '--graph=golden', `--to=${goldenAfterHub}`],
		(err, res) => {
			if (err) {
				finish(`-rollback failed: ${err}`);
				return;
			}
			assert(
				!!res.parsed && res.parsed.rolledBackTo === goldenAfterHub,
				'rollback reported repoint to the hub manifest',
			);
			snapshotGraph('golden', (snapErr, rolledSnap) => {
				if (snapErr) {
					finish(`snapshot golden after rollback failed: ${snapErr}`);
					return;
				}
				assert(
					sameSet(rolledSnap.nodes, hubSnap.nodes),
					'GATE3: rolled-back golden node set identical to hub-only golden',
				);
				assert(
					sameSet(rolledSnap.edges, hubSnap.edges),
					'GATE3: rolled-back golden edge set identical to hub-only golden',
				);
				assert(
					rolledSnap.specifiedCount === 0,
					'GATE3: rolled-back golden has no SPECIFIED_MAPPING (second standard gone)',
				);
				gate4();
			});
		},
	);
};

// GATE 4: -list blocks|manifests|graphs reflects reality; --stale flags drift.
// After GATE 3 the golden pointer is at goldenAfterHub but its newest pointer-log entry is the
// post-second publish -> golden is now a constructed DRIFT (stale) case.
const gate4 = () => {
	log('\n=== GATE 4: -list ===');
	runNode(MANAGER, ['-list', 'blocks'], (errB, resB) => {
		if (errB) {
			finish(`-list blocks failed: ${errB}`);
			return;
		}
		assert(
			!!resB.parsed && Array.isArray(resB.parsed.blocks) && resB.parsed.blocks.length >= 3,
			`GATE4: -list blocks shows the saved blocks (got ${resB.parsed && resB.parsed.blocks && resB.parsed.blocks.length})`,
		);

		runNode(MANAGER, ['-list', 'manifests'], (errM, resM) => {
			if (errM) {
				finish(`-list manifests failed: ${errM}`);
				return;
			}
			assert(
				!!resM.parsed &&
					Array.isArray(resM.parsed.manifests) &&
					resM.parsed.manifests.length >= 2,
				`GATE4: -list manifests shows >=2 manifests (got ${resM.parsed && resM.parsed.manifests && resM.parsed.manifests.length})`,
			);

			runNode(MANAGER, ['-list', 'graphs'], (errG, resG) => {
				if (errG) {
					finish(`-list graphs failed: ${errG}`);
					return;
				}
				const golden =
					resG.parsed &&
					(resG.parsed.graphs || []).find((g) => g.name === 'golden');
				assert(!!golden, 'GATE4: -list graphs includes golden');

				runNode(MANAGER, ['-list', 'graphs', '--stale'], (errS, resS) => {
					if (errS) {
						finish(`-list graphs --stale failed: ${errS}`);
						return;
					}
					const staleGolden =
						resS.parsed &&
						(resS.parsed.graphs || []).find((g) => g.name === 'golden');
					assert(
						!!staleGolden,
						'GATE4: --stale flags the constructed drift case (golden currentManifest behind newest pointer)',
					);
					finish('');
				});
			});
		});
	});
};

main();
