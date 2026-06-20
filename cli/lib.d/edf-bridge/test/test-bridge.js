#!/usr/bin/env node
'use strict';

// test-bridge.js — Phase 5 test gate for edf-bridge (bridgeMaker).
//
// SYNTHETIC standard (NOT a real one; real LIF is Phase 6/7 — per plan + FROZEN_LATTICE approval).
// Provisions a real working graph via the 1B instance-lifecycle, populates it via cypher with:
//   - a few real-shaped CEDS nodes (label DmeProperty/DmeOptionValue + ForgedNode, _source='CEDS',
//     each with a stableId and a canonical cedsId / cedsOptionId)
//   - a SYNTHETIC second standard 'synthstd': a DmeStandardRoot carrying a mappingInstruction, plus
//     nodes whose cedsId/cedsOptionId crossRefs point at those CEDS nodes — INCLUDING one whose
//     cedsId points at an ABSENT CEDS node (the orphan path).
//
// Asserts ALL gates:
//   G1  -specified: SPECIFIED_MAPPING edges exist for the known crossRefs, confidence=1.0,
//       provenanceTier='spec-authoritative', NO matchPredicate, endpoints resolved; the one pointing
//       at an absent CEDS node is NOT written (orphan report), no partial edge.
//   G2  -derived: invoking it changes the graph by NOTHING (edge count identical before/after), and
//       logs the stub line.
//   G3  scoped idempotency: running -specified again does NOT duplicate edges (idempotent MERGE) and
//       an already-bridged pair is not re-bridged.
//
// Calls the SAME library modules the CLI uses (no parallel test-only init). Force-tears-down the
// test container/volume at END even on failure.
//
// Run with: node test/test-bridge.js   (from the edf-bridge dir, or with an absolute path)

const path = require('path');
const fs = require('fs');
const os = require('os');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// --------------------------------------------------------------------------------
// minimal process.global (the makers read xLog from it). Mirrors the orchestrator bootstrap.
const verbose = process.argv.includes('-verbose');
process.global = {
	xLog: {
		status: (...args) => console.error('  ·', ...args),
		error: (...args) => console.error('  !', ...args),
		result: (...args) => console.log(...args),
		verbose: verbose ? (...args) => console.error('  …', ...args) : () => {},
	},
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
};

// --------------------------------------------------------------------------------
const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');

const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
const credentialAccessor = require(path.join(
	CORE_LIB,
	'credential-accessor',
	'credential-accessor',
))({ forgeStore });

const specifiedBridgeFactory = require('../lib/specified-bridge');
const derivedBridgeFactory = require('../lib/derived-bridge');
const impliedBridgeFactory = require('../lib/implied-bridge');

const TEST_GRAPH = '__TEST_bridge';
const SYNTH = 'synthstd';
const dbPath = path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');

// --------------------------------------------------------------------------------
// assertions
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

// a tiny deterministic embedding so the implied retrieve stage has vectors to rank (4-d is fine).
const embFor = (seed) => {
	const base = [0.1, 0.2, 0.3, 0.4];
	return base.map((v, i) => v + ((seed + i) % 5) * 0.01);
};

// --------------------------------------------------------------------------------
// the mappingInstruction the synthetic forge would have declared on its DmeStandardRoot.
const SYNTH_MAPPING_INSTRUCTION = JSON.stringify({
	cedsOriginalAnchorPropertyName: ['nativeCedsRef'],
	cedsOptionOriginalAnchorPropertyName: ['nativeCedsOptionRef'],
	crosswalkPrefix: ['synth'],
	crosswalkResolveProperty: 'stableUriPropertyName',
	includeInImplied: true,
	impliedTargets: ['CEDS'],
});

// populate the working graph. CEDS hub: two DmeProperty + one DmeOptionValue. Synthetic standard:
// a DmeStandardRoot + two DmeProperty (one resolves, one points at an ABSENT cedsId) + one
// DmeOptionValue (resolves at value level).
const populateGraph = (lifecycle, callback) => {
	const cypher = `
		// CEDS hub nodes (the bridge targets)
		CREATE (:ForgedNode:DmeProperty {stableId:'ceds:P000113', _source:'CEDS', name:'First Name', searchText:'CEDS|Person|First Name', cedsId:'P000113', embedding:$embCedsA})
		CREATE (:ForgedNode:DmeProperty {stableId:'ceds:P000115', _source:'CEDS', name:'Last Name',  searchText:'CEDS|Person|Last Name',  cedsId:'P000115', embedding:$embCedsB})
		CREATE (:ForgedNode:DmeOptionValue {stableId:'ceds:O000900', _source:'CEDS', name:'Male', searchText:'CEDS|Sex|Male', cedsOptionId:'O000900', embedding:$embCedsOpt})

		// synthetic standard root carrying the declarative mappingInstruction
		CREATE (:ForgedNode:DmeStandardRoot {stableId:'synthstd:root', _source:'synthstd', name:'synthstd', standardKey:'synthstd', mappingInstruction:$mappingInstruction})

		// synthetic standard nodes
		//   srcResolves      -> cedsId P000113 (a CEDS node exists)            => edge expected
		//   srcOrphan        -> cedsId P999999 (NO CEDS node)                  => orphan, NO edge
		//   srcValueResolves -> cedsOptionId O000900 (a CEDS value exists)     => value-level edge
		CREATE (:ForgedNode:DmeProperty {stableId:'synthstd:F1', _source:'synthstd', name:'firstName', searchText:'synthstd|Student|firstName', cedsId:'P000113', nativeCedsRef:'ceds:000113', embedding:$embSrcA})
		CREATE (:ForgedNode:DmeProperty {stableId:'synthstd:F2', _source:'synthstd', name:'phantomField', searchText:'synthstd|Student|phantomField', cedsId:'P999999', nativeCedsRef:'ceds:999999', embedding:$embSrcB})
		CREATE (:ForgedNode:DmeOptionValue {stableId:'synthstd:V1', _source:'synthstd', name:'M', searchText:'synthstd|Sex|M', cedsOptionId:'O000900', nativeCedsOptionRef:'M', embedding:$embSrcOpt})
	`;
	lifecycle.runCypher(
		{
			graphName: TEST_GRAPH,
			cypher,
			params: {
				mappingInstruction: SYNTH_MAPPING_INSTRUCTION,
				embCedsA: embFor(1),
				embCedsB: embFor(2),
				embCedsOpt: embFor(3),
				embSrcA: embFor(1), // identical to CEDS First Name -> high cosine
				embSrcB: embFor(7),
				embSrcOpt: embFor(3),
			},
		},
		callback,
	);
};

// count all edges in the graph (for the -derived no-op gate).
const countEdges = (lifecycle, callback) => {
	lifecycle.runCypher(
		{ graphName: TEST_GRAPH, cypher: 'MATCH ()-[r]->() RETURN count(r) AS c' },
		(err, result) => {
			if (err) {
				callback(err);
				return;
			}
			callback('', num(result.records[0].c));
		},
	);
};

// read back the SPECIFIED_MAPPING edges with their properties.
const readSpecifiedEdges = (lifecycle, callback) => {
	lifecycle.runCypher(
		{
			graphName: TEST_GRAPH,
			cypher: `
				MATCH (from)-[r:SPECIFIED_MAPPING]->(to)
				RETURN from.stableId AS fromId, to.stableId AS toId,
					r.confidence AS confidence, r.provenanceTier AS provenanceTier,
					r.matchPredicate AS matchPredicate, r.owner AS owner, r.bridgeLevel AS bridgeLevel
				ORDER BY fromId
			`,
		},
		(err, result) => {
			if (err) {
				callback(err);
				return;
			}
			callback(
				'',
				result.records.map((rec) => ({
					fromId: rec.fromId,
					toId: rec.toId,
					confidence: num(rec.confidence),
					provenanceTier: rec.provenanceTier,
					matchPredicate: rec.matchPredicate,
					owner: rec.owner,
					bridgeLevel: rec.bridgeLevel,
				})),
			);
		},
	);
};

// --------------------------------------------------------------------------------
const main = () => {
	let lifecycle = null;

	const taskList = new taskListPlus();

	// open the forge store
	taskList.push((args, next) => {
		const storeDir = path.dirname(dbPath);
		if (!fs.existsSync(storeDir)) {
			fs.mkdirSync(storeDir, { recursive: true });
		}
		forgeStore.init({ dbPath }, (err) => next(err, args));
	});

	// build the shared instance-lifecycle
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

	// pre-clean any leftover test instance from a prior aborted run (idempotent, force).
	taskList.push((args, next) => {
		lifecycle.destroyInstanceByName({ graphName: TEST_GRAPH, force: true }, () => {
			// ignore — graph may not exist; this is just hygiene.
			next('', args);
		});
	});

	// provision the working graph (type bronze = ephemeral, freely tearable).
	taskList.push((args, next) => {
		console.log(`\n[setup] provisioning '${TEST_GRAPH}' (this pulls/starts neo4j; ~30-90s)...`);
		lifecycle.createInstanceByName({ graphName: TEST_GRAPH, type: 'bronze' }, (err) => {
			next(err, args);
		});
	});

	// populate it with the synthetic standard + CEDS hub.
	taskList.push((args, next) => {
		console.log('[setup] populating CEDS hub + synthetic standard...');
		populateGraph(lifecycle, (err) => next(err, args));
	});

	// ---- GATE 1: -specified ----
	taskList.push((args, next) => {
		console.log('\n=== GATE 1: -specified ===');
		const specifiedBridge = specifiedBridgeFactory({ lifecycle });
		specifiedBridge.bridge(
			{ graphName: TEST_GRAPH, scope: SYNTH, owner: ':golden' },
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				console.log(`  result: ${JSON.stringify(result)}`);
				next('', { ...args, specifiedResult: result });
			},
		);
	});

	taskList.push((args, next) => {
		readSpecifiedEdges(lifecycle, (err, edges) => {
			if (err) {
				next(err);
				return;
			}
			const byFrom = {};
			edges.forEach((e) => {
				byFrom[e.fromId] = e;
			});

			// expected edges: element-level F1->P000113, value-level V1->O000900. NOT F2 (orphan).
			check('G1 two SPECIFIED_MAPPING edges written (element + value)', edges.length === 2);
			check('G1 element edge F1 -> ceds P000113 exists', !!byFrom['synthstd:F1'] && byFrom['synthstd:F1'].toId === 'ceds:P000113');
			check('G1 value edge V1 -> ceds O000900 exists', !!byFrom['synthstd:V1'] && byFrom['synthstd:V1'].toId === 'ceds:O000900');
			check('G1 orphan F2 (phantom cedsId) has NO edge', !byFrom['synthstd:F2']);
			check('G1 confidence === 1.0 on all', edges.every((e) => e.confidence === 1.0));
			check('G1 provenanceTier === spec-authoritative on all', edges.every((e) => e.provenanceTier === 'spec-authoritative'));
			check('G1 NO matchPredicate on any', edges.every((e) => e.matchPredicate === null || e.matchPredicate === undefined));
			check('G1 owner stamped :golden on all', edges.every((e) => e.owner === ':golden'));

			// orphan report from the maker carries the phantom.
			const orphans = args.specifiedResult.orphans || [];
			const phantomOrphan = orphans.find((o) => o.srcStableId === 'synthstd:F2');
			check('G1 orphan report contains F2 (phantom)', !!phantomOrphan && phantomOrphan.anchorValue === 'P999999');
			check('G1 maker reported edgesMerged === 2', args.specifiedResult.edgesMerged === 2);
			next('', args);
		});
	});

	// ---- GATE 2: -derived no-op ----
	taskList.push((args, next) => {
		console.log('\n=== GATE 2: -derived (no-op) ===');
		countEdges(lifecycle, (err, before) => {
			if (err) {
				next(err);
				return;
			}
			next('', { ...args, edgesBeforeDerived: before });
		});
	});

	taskList.push((args, next) => {
		const derivedBridge = derivedBridgeFactory({ lifecycle });
		derivedBridge.bridge(
			{ graphName: TEST_GRAPH, scope: SYNTH, owner: ':golden' },
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				check('G2 derived reports stubbed === true', result.stubbed === true);
				check('G2 derived reports edgesMerged === 0', result.edgesMerged === 0);
				check('G2 derived note is the stub line', /stubbed/.test(result.note || ''));
				next('', args);
			},
		);
	});

	taskList.push((args, next) => {
		countEdges(lifecycle, (err, after) => {
			if (err) {
				next(err);
				return;
			}
			check('G2 edge count UNCHANGED by -derived', after === args.edgesBeforeDerived);
			next('', args);
		});
	});

	// ---- GATE 3: scoped idempotency (re-run -specified) ----
	taskList.push((args, next) => {
		console.log('\n=== GATE 3: scoped idempotency (-specified again) ===');
		countEdges(lifecycle, (err, before) => {
			if (err) {
				next(err);
				return;
			}
			next('', { ...args, edgesBeforeRerun: before });
		});
	});

	taskList.push((args, next) => {
		const specifiedBridge = specifiedBridgeFactory({ lifecycle });
		specifiedBridge.bridge(
			{ graphName: TEST_GRAPH, scope: SYNTH, owner: ':golden' },
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				console.log(`  rerun result: ${JSON.stringify(result)}`);
				check('G3 rerun creates 0 new edges (idempotent MERGE)', result.edgesMerged === 0);
				check('G3 rerun reports 2 pairs already bridged', result.pairsAlreadyBridged === 2);
				next('', args);
			},
		);
	});

	taskList.push((args, next) => {
		countEdges(lifecycle, (err, after) => {
			if (err) {
				next(err);
				return;
			}
			check('G3 total edge count UNCHANGED after rerun', after === args.edgesBeforeRerun);
			next('', args);
		});
	});

	// ---- BONUS: -implied Phase-I wiring (Stage-1 scoped retrieve runs, emits NO edges) ----
	// This minimal fixture's CEDS nodes carry no legacy scoping label (just ForgedNode + role), so the
	// (CEDS,role) group is correctly SKIPPED (no scoped index) and candidatesRetrieved===0 — it
	// exercises the graceful skip path and the summary shape. The happy retrieve path (with scoping
	// labels) + the real golden 6-known-pairs check live in test/test-implied-retrieve.js.
	taskList.push((args, next) => {
		console.log('\n=== BONUS: -implied Phase-I (Stage-1 scoped retrieve; NO edges) ===');
		countEdges(lifecycle, (err, before) => {
			if (err) {
				next(err);
				return;
			}
			next('', { ...args, edgesBeforeImplied: before });
		});
	});

	taskList.push((args, next) => {
		const impliedBridge = impliedBridgeFactory({ lifecycle });
		impliedBridge.bridge(
			{ graphName: TEST_GRAPH, scope: SYNTH, owner: ':golden' },
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				console.log(`  implied result: ${JSON.stringify(result)}`);
				check('IMPLIED emits 0 edges (Phase I retrieve-only)', result.edgesMerged === 0);
				check('IMPLIED summary carries sourcesConsidered (number)', typeof result.sourcesConsidered === 'number');
				check('IMPLIED summary carries sourcesWithCandidates/sourcesZero/perSourceAvg/perSourceMax', ['sourcesWithCandidates', 'sourcesZero', 'perSourceAvg', 'perSourceMax'].every((k) => typeof result[k] === 'number'));
				check('IMPLIED no scoping label in minimal fixture -> group skipped (0 candidates)', result.candidatesRetrieved === 0);
				next('', { ...args, impliedResult: result });
			},
		);
	});

	taskList.push((args, next) => {
		countEdges(lifecycle, (err, after) => {
			if (err) {
				next(err);
				return;
			}
			check('IMPLIED edge count UNCHANGED (no edges emitted)', after === args.edgesBeforeImplied);
			next('', args);
		});
	});

	// run, then ALWAYS tear down.
	pipeRunner(taskList.getList(), {}, (runErr) => {
		const teardown = (done) => {
			if (!lifecycle) {
				done();
				return;
			}
			console.log('\n[teardown] destroying test instance (force)...');
			lifecycle.destroyInstanceByName({ graphName: TEST_GRAPH, force: true }, (tdErr) => {
				if (tdErr) {
					console.log(`  [teardown] WARNING: ${tdErr}`);
				} else {
					console.log('  [teardown] done.');
				}
				done();
			});
		};

		teardown(() => {
			if (runErr) {
				console.log(`\n!!! RUN ERROR (before all gates ran): ${runErr}`);
				failCount++;
			}
			console.log(`\n==================== RESULT ====================`);
			console.log(`  PASS: ${passCount}   FAIL: ${failCount}`);
			console.log(`  ${failCount === 0 ? 'GREEN' : 'RED'}`);
			console.log(`================================================\n`);
			process.exit(failCount === 0 ? 0 : 1);
		});
	});
};

main();
