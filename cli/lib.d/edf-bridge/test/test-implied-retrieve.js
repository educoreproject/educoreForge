#!/usr/bin/env node
'use strict';

// test-implied-retrieve.js — Phase-I gate for -implied Stage-1 (the scoped vector-index retrieve).
//
// SECTION 1 (GOLDEN, read-only — the real gate): runs the implied bridge against the live 'golden'
// graph, scope=LIF, and asserts the brief's Phase-I gate on REAL data:
//   - bounded completion (no CPU runaway; one index probe per source)
//   - 100% coverage: every uncovered mappable LIF source gets a candidate pool (sourcesZero===0)
//   - per-source candidate count <= candidatePoolK
//   - emits NO edges (golden IMPLIED_MAPPING count unchanged at 0)
//   - the 6 known LIF->CEDS SPECIFIED pairs: their true CEDS target lands IN the top-100 scoped pool
//     for 5 of 6 (Credential.level reachable at K=100; JobCode.jobCodeValue is the documented
//     vector-unreachable miss awaiting the deferred hybrid channel).
// Read-mostly: it (idempotently, IF NOT EXISTS) ensures the scoped indexes and reads — it writes NO
// graph content, so golden == replay(goldenManifest) is preserved. It does NOT tear golden down.
//
// SECTION 2 (SYNTHETIC bronze — provisioning + edges-cases): provisions a throwaway graph and proves
// what golden (whose indexes already exist) cannot: self-provisioning a scoped index FROM SCRATCH,
// candidates are EXACTLY the target standard, a covered source is excluded, and includeInImplied=false
// opts a standard out. Force-tears-down its own instance at end.
//
// Calls the SAME library module the CLI uses (no parallel test-only init). qtools async throughout.
// Run: node test/test-implied-retrieve.js   (from the edf-bridge dir, or with an absolute path)

const path = require('path');
const fs = require('fs');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const verbose = process.argv.includes('-verbose');
process.global = {
	xLog: {
		status: verbose ? (...args) => console.error('  ·', ...args) : () => {},
		error: (...args) => console.error('  !', ...args),
		result: (...args) => console.log(...args),
		verbose: verbose ? (...args) => console.error('  …', ...args) : () => {},
	},
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
};

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');

const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
const credentialAccessor = require(path.join(CORE_LIB, 'credential-accessor', 'credential-accessor'))({
	forgeStore,
});
const impliedBridgeFactory = require('../lib/implied-bridge');

const GOLDEN = 'golden';
const TEST_GRAPH = '__TEST_impliedRetrieve';
const OUT_PATH = path.join('/tmp', '__TEST_impliedRetrieve_pools.json');
const dbPath = path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');

let passCount = 0;
let failCount = 0;
const check = (label, condition) => {
	if (condition) {
		passCount++;
		console.log(`  PASS  ${label}`);
	} else {
		failCount++;
		console.log(`  FAIL  ${label}`);
	}
};
const num = (value) => {
	if (value && typeof value === 'object' && typeof value.toNumber === 'function') {
		return value.toNumber();
	}
	return Number(value) || 0;
};

// an N-dim toy embedding from a seed (synthetic section only; golden carries real voyage vectors).
const embFor = (seed, dims = 8) =>
	Array.from({ length: dims }, (unused, i) => 0.05 + ((seed + i) % 7) * 0.01);

// run a self-contained section: its internal failures become FAIL checks but never abort the suite.
const runSection = (label, bodyFn, done) => {
	console.log(`\n========== ${label} ==========`);
	bodyFn((err) => {
		if (err) {
			check(`${label} ran without a fatal error`, false);
			console.log(`  ! section error: ${err}`);
		}
		done();
	});
};

const countImplied = (lifecycle, graphName, callback) => {
	lifecycle.runCypher(
		{ graphName, cypher: 'MATCH ()-[r:IMPLIED_MAPPING]->() RETURN count(r) AS c' },
		(err, result) => {
			if (err) {
				callback(err);
				return;
			}
			callback('', num(result.records[0].c));
		},
	);
};

// ---------------------------------------------------------------------------------------------
// SECTION 1 — golden, read-only
// ---------------------------------------------------------------------------------------------
const sectionGolden = (lifecycle, sectionDone) => {
	const taskList = new taskListPlus();

	taskList.push((args, next) => {
		countImplied(lifecycle, GOLDEN, (err, before) => {
			if (err) {
				next(err);
				return;
			}
			next('', { ...args, impliedBefore: before });
		});
	});

	taskList.push((args, next) => {
		const startMs = Date.now();
		const impliedBridge = impliedBridgeFactory({ lifecycle });
		impliedBridge.bridge({ graphName: GOLDEN, scope: 'LIF', owner: ':golden' }, (err, result) => {
			if (err) {
				next(err);
				return;
			}
			const elapsed = Date.now() - startMs;
			console.log(`  golden summary: ${JSON.stringify(result)} (${elapsed}ms)`);
			check('G1 bounded completion (< 120s, no runaway)', elapsed < 120000);
			check('G1 sourcesConsidered === 2975 (uncovered mappable LIF)', result.sourcesConsidered === 2975);
			check('G1 sourcesWithCandidates === 2975 (100% coverage)', result.sourcesWithCandidates === 2975);
			check('G1 sourcesZero === 0', result.sourcesZero === 0);
			check('G1 perSourceMax <= candidatePoolK (100)', result.perSourceMax <= 100);
			check('G1 edgesMerged === 0 (Phase I emits no edges)', result.edgesMerged === 0);
			next('', { ...args, goldenResult: result });
		});
	});

	taskList.push((args, next) => {
		countImplied(lifecycle, GOLDEN, (err, after) => {
			if (err) {
				next(err);
				return;
			}
			check('G1 golden IMPLIED_MAPPING count UNCHANGED (no edges written)', after === args.impliedBefore);
			next('', args);
		});
	});

	// the 6 known LIF->CEDS SPECIFIED pairs: is the true CEDS target in the top-100 scoped pool?
	// mirrors the production pool (probe 200 -> filter exact -> top candidatePoolK 100).
	taskList.push((args, next) => {
		lifecycle.runCypher(
			{
				graphName: GOLDEN,
				cypher: `
					MATCH (s)-[:SPECIFIED_MAPPING]->(t)
					WHERE s._source = 'LIF' AND s.role = 'DmeProperty'
					CALL {
						WITH s, t
						CALL db.index.vector.queryNodes('forgeVec_CEDS_' + s.role, toInteger(200), s.embedding)
							YIELD node, score
						WITH s, t, node, score
						WHERE node._source = 'CEDS' AND node.role = s.role AND node.stableId <> s.stableId
						WITH t, node ORDER BY score DESC LIMIT toInteger(100)
						WITH t, collect(node.stableId) AS ids
						RETURN (t.stableId IN ids) AS inPool
					}
					RETURN s.stableId AS lif, t.stableId AS ceds, inPool
				`,
				params: {},
			},
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				const rows = (result.records || []).map((r) => ({
					lif: r.lif,
					ceds: r.ceds,
					inPool: r.inPool === true,
				}));
				const inPoolCount = rows.filter((r) => r.inPool).length;
				rows.forEach((r) => console.log(`    pair ${r.lif} -> ${r.ceds}: inPool=${r.inPool}`));
				check('G1 six known pairs evaluated', rows.length === 6);
				check('G1 known pairs in top-100 pool === 5 of 6 (JobCode the documented miss)', inPoolCount === 5);
				next('', args);
			},
		);
	});

	pipeRunner(taskList.getList(), {}, (err) => sectionDone(err));
};

// ---------------------------------------------------------------------------------------------
// SECTION 2 — synthetic bronze: provisioning, exactness, covered-exclusion, opt-out
// ---------------------------------------------------------------------------------------------
const TSTD_INSTRUCTION = JSON.stringify({
	includeInImplied: true,
	impliedTargets: ['CEDS'],
	probeK: 50,
	candidatePoolK: 5,
});
const OPTOUT_INSTRUCTION = JSON.stringify({ includeInImplied: false, impliedTargets: ['CEDS'] });

const populateSynthetic = (lifecycle, callback) => {
	// CEDS hub: 3 CedsProperty (carry the legacy scoping label, mirroring real golden) + 1
	// CedsOptionValue. Source standard 'tstd': T1/T2 uncovered DmeProperty (T1 == CP1 embedding ->
	// top match), Tcov a COVERED DmeProperty (a SPECIFIED edge -> must be excluded). Opt-out standard.
	const cypher = `
		CREATE (cp1:ForgedNode:DmeProperty:CedsProperty {stableId:'ceds:CP1', _source:'CEDS', role:'DmeProperty', name:'First Name', searchText:'CEDS|First Name', embedding:$embCp1})
		CREATE (:ForgedNode:DmeProperty:CedsProperty {stableId:'ceds:CP2', _source:'CEDS', role:'DmeProperty', name:'Last Name', searchText:'CEDS|Last Name', embedding:$embCp2})
		CREATE (:ForgedNode:DmeProperty:CedsProperty {stableId:'ceds:CP3', _source:'CEDS', role:'DmeProperty', name:'Birth Date', searchText:'CEDS|Birth Date', embedding:$embCp3})
		CREATE (:ForgedNode:DmeOptionValue:CedsOptionValue {stableId:'ceds:CV1', _source:'CEDS', role:'DmeOptionValue', name:'Male', searchText:'CEDS|Male', embedding:$embCv1})

		CREATE (:ForgedNode:DmeStandardRoot {stableId:'tstd:root', _source:'tstd', role:'DmeStandardRoot', name:'tstd', standardKey:'tstd', mappingInstruction:$tstdInstruction})
		CREATE (t1:ForgedNode:DmeProperty {stableId:'tstd:T1', _source:'tstd', role:'DmeProperty', name:'firstName', searchText:'tstd|firstName', embedding:$embT1})
		CREATE (:ForgedNode:DmeProperty {stableId:'tstd:T2', _source:'tstd', role:'DmeProperty', name:'familyName', searchText:'tstd|familyName', embedding:$embT2})
		CREATE (tcov:ForgedNode:DmeProperty {stableId:'tstd:Tcov', _source:'tstd', role:'DmeProperty', name:'covered', searchText:'tstd|covered', embedding:$embTcov})
		CREATE (tcov)-[:SPECIFIED_MAPPING {confidence:1.0, provenanceTier:'spec-authoritative', owner:':golden'}]->(cp3)

		CREATE (:ForgedNode:DmeStandardRoot {stableId:'optout:root', _source:'optout', role:'DmeStandardRoot', name:'optout', standardKey:'optout', mappingInstruction:$optoutInstruction})
		CREATE (:ForgedNode:DmeProperty {stableId:'optout:X1', _source:'optout', role:'DmeProperty', name:'whatever', searchText:'optout|whatever', embedding:$embX1})
	`;
	lifecycle.runCypher(
		{
			graphName: TEST_GRAPH,
			cypher,
			params: {
				tstdInstruction: TSTD_INSTRUCTION,
				optoutInstruction: OPTOUT_INSTRUCTION,
				embCp1: embFor(1),
				embCp2: embFor(2),
				embCp3: embFor(3),
				embCv1: embFor(4),
				embT1: embFor(1), // identical to CP1 -> highest cosine
				embT2: embFor(2),
				embTcov: embFor(3),
				embX1: embFor(5),
			},
		},
		callback,
	);
};

const sectionSynthetic = (lifecycle, sectionDone) => {
	const taskList = new taskListPlus();

	taskList.push((args, next) => {
		lifecycle.destroyInstanceByName({ graphName: TEST_GRAPH, force: true }, () => next('', args));
	});

	taskList.push((args, next) => {
		console.log(`  [setup] provisioning '${TEST_GRAPH}' (starts neo4j; ~30-90s)...`);
		lifecycle.createInstanceByName({ graphName: TEST_GRAPH, type: 'bronze' }, (err) =>
			next(err, args),
		);
	});

	taskList.push((args, next) => {
		console.log('  [setup] populating synthetic CEDS hub + source standards...');
		populateSynthetic(lifecycle, (err) => next(err, args));
	});

	// run the implied retrieve on scope=tstd, with --out so we can inspect the candidate pools.
	taskList.push((args, next) => {
		const impliedBridge = impliedBridgeFactory({ lifecycle });
		impliedBridge.bridge(
			{ graphName: TEST_GRAPH, scope: 'tstd', owner: ':golden', outPath: OUT_PATH },
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				console.log(`  tstd summary: ${JSON.stringify(result)}`);
				check('S2 sourcesConsidered === 2 (T1,T2; Tcov covered-excluded)', result.sourcesConsidered === 2);
				check('S2 sourcesWithCandidates === 2', result.sourcesWithCandidates === 2);
				check('S2 sourcesZero === 0', result.sourcesZero === 0);
				check('S2 candidatesRetrieved === 6 (3 CEDS props x 2 sources)', result.candidatesRetrieved === 6);
				check('S2 perSourceMax === 3 (only 3 CEDS DmeProperty exist)', result.perSourceMax === 3);
				check('S2 perSourceMax <= candidatePoolK (5)', result.perSourceMax <= 5);
				check('S2 edgesMerged === 0', result.edgesMerged === 0);
				next('', { ...args, tstdResult: result });
			},
		);
	});

	// self-provisioned scoped index exists and is ONLINE.
	taskList.push((args, next) => {
		lifecycle.runCypher(
			{ graphName: TEST_GRAPH, cypher: 'SHOW VECTOR INDEXES YIELD name, state RETURN name, state' },
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				const row = (result.records || []).find((r) => r.name === 'forgeVec_CEDS_DmeProperty');
				check('S2 scoped index forgeVec_CEDS_DmeProperty self-provisioned', !!row);
				check('S2 scoped index ONLINE', !!row && row.state === 'ONLINE');
				next('', args);
			},
		);
	});

	// --out pools: candidates are EXACTLY the CEDS properties; covered source Tcov absent.
	taskList.push((args, next) => {
		let pools = null;
		let readErr = null;
		try {
			pools = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
		} catch (e) {
			readErr = e;
		}
		if (readErr) {
			check('S2 --out pools file written and parseable', false);
			next('', args);
			return;
		}
		check('S2 --out pools file written and parseable', Array.isArray(pools));
		const srcIds = (pools || []).map((p) => p.srcStableId).sort();
		check('S2 pools cover exactly T1,T2 (Tcov excluded)', JSON.stringify(srcIds) === JSON.stringify(['tstd:T1', 'tstd:T2']));
		const cedsSet = new Set(['ceds:CP1', 'ceds:CP2', 'ceds:CP3']);
		const allCandsAreCeds = (pools || []).every((p) => (p.cands || []).every((c) => cedsSet.has(c.stableId)));
		check('S2 every candidate is one of the 3 CEDS DmeProperty (exact target set)', allCandsAreCeds);
		const t1 = (pools || []).find((p) => p.srcStableId === 'tstd:T1');
		const t1Top = t1 && t1.cands && t1.cands.length > 0 ? t1.cands[0].stableId : null;
		check('S2 T1 top candidate is CP1 (identical embedding ranks #1)', t1Top === 'ceds:CP1');
		next('', args);
	});

	// opt-out: includeInImplied=false -> nothing considered.
	taskList.push((args, next) => {
		const impliedBridge = impliedBridgeFactory({ lifecycle });
		impliedBridge.bridge({ graphName: TEST_GRAPH, scope: 'optout', owner: ':golden' }, (err, result) => {
			if (err) {
				next(err);
				return;
			}
			check('S2 opt-out sourcesConsidered === 0 (includeInImplied=false)', result.sourcesConsidered === 0);
			check('S2 opt-out candidatesRetrieved === 0', result.candidatesRetrieved === 0);
			check('S2 opt-out edgesMerged === 0', result.edgesMerged === 0);
			next('', args);
		});
	});

	pipeRunner(taskList.getList(), {}, (err) => {
		// ALWAYS tear down the synthetic instance, even on error.
		console.log('  [teardown] destroying synthetic instance (force)...');
		lifecycle.destroyInstanceByName({ graphName: TEST_GRAPH, force: true }, (tdErr) => {
			if (tdErr) {
				console.log(`  [teardown] WARNING: ${tdErr}`);
			}
			try {
				if (fs.existsSync(OUT_PATH)) {
					fs.unlinkSync(OUT_PATH);
				}
			} catch (e) {
				// non-fatal cleanup
			}
			sectionDone(err);
		});
	});
};

// ---------------------------------------------------------------------------------------------
const main = () => {
	let lifecycle = null;
	const taskList = new taskListPlus();

	taskList.push((args, next) => {
		const storeDir = path.dirname(dbPath);
		if (!fs.existsSync(storeDir)) {
			fs.mkdirSync(storeDir, { recursive: true });
		}
		forgeStore.init({ dbPath }, (err) => next(err, args));
	});

	taskList.push((args, next) => {
		require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({
			forgeStore,
			credentialAccessor,
		})((err, built) => {
			if (err) {
				next(err);
				return;
			}
			lifecycle = built;
			next('', args);
		});
	});

	taskList.push((args, next) => {
		runSection('SECTION 1 — golden (read-only, the gate)', (done) => sectionGolden(lifecycle, done), () =>
			next('', args),
		);
	});

	taskList.push((args, next) => {
		runSection('SECTION 2 — synthetic bronze (provisioning + edge cases)', (done) =>
			sectionSynthetic(lifecycle, done), () => next('', args),
		);
	});

	pipeRunner(taskList.getList(), {}, (runErr) => {
		if (runErr) {
			console.log(`\n!!! SUITE INIT ERROR: ${runErr}`);
			failCount++;
		}
		console.log(`\n==================== RESULT ====================`);
		console.log(`  PASS: ${passCount}   FAIL: ${failCount}`);
		console.log(`  ${failCount === 0 ? 'GREEN' : 'RED'}`);
		console.log(`================================================\n`);
		process.exit(failCount === 0 ? 0 : 1);
	});
};

main();
