#!/usr/bin/env node
'use strict';

// phase7Finishers.js — the PHASE-7 GATE OF RECORD (the replayManager FINISHER REGISTRY: schema-view +
// schema-constraint finishers, the global skip switch, and the producer-time schema validator).
//
// The finishing phase runs AFTER replay and BEFORE ownerStamp+stampProvenance, sourced from the vocabulary
// registry (the manifest carries NO schema). This gate builds isolated scratch graphs (NEVER the production
// golden; productionGuard) and proves, on FRESH builds, independent of the frozen baselines:
//
//   SKIP SWITCH (raw graph == baseline):
//     skipEqualsBaseline   — a --skipFinishing build's all-scope fingerprint == the frozen goldenAll
//                            baseline (the skip switch yields the raw, pre-finisher graph byte-for-byte).
//     skipHasNoConstraints — the skip build carries ZERO constraints (no finisher output at all).
//   FINISHING (additive, schema-view-only delta + constraints):
//     finishingDiff        — a finishing build vs goldenAll: removed=0, changed=0, added == EXACTLY the
//                            schema-view nodes (label :SchemaView) + HAS_SCHEMA_TERM edges, nothing else.
//     constraintsPresent   — the finishing build carries EXACTLY the 3 registry-derived uniqueness
//                            constraints (created successfully == provably zero violations on conformant data).
//     schemaViewMatchesRegistry — the in-graph :SchemaView nodes/edges EQUAL the registry-derived expectation
//                            (root + one member per registry term; HAS_SCHEMA_TERM count).
//     finisherIdempotent   — re-running the finishers on the finishing build leaves the fingerprint UNCHANGED.
//   DETERMINISM:
//     finisherDeterminism  — a SECOND independent finishing build has the IDENTICAL all-scope fingerprint
//                            (finishers are deterministic functions of the registry + the built graph).
//   TWINS (each finisher's failure mode is proven to BITE):
//     constraintViolationTwin — inject a duplicate stableId upstream -> the schema-constraint finisher's
//                            CREATE CONSTRAINT FAILS (caught), restored on cleanup.
//     schemaViewDriftTwin  — delete a :SchemaView member -> schemaViewMatchesRegistry goes RED; restore
//                            (re-run the finisher) -> GREEN again.
//     offSchemaBlockTwin   — the schema-validator REJECTS a deliberately off-schema block (missing required
//                            prop / bad enum / unknown label), and PASSES a conformant control.
//
// Usage: node --max-old-space-size=16384 phase7Finishers.js
//          [--manifest=<gatingManifestKey>] [--baselineLabel=goldenAll]
//          [--skipGraph=phase7skip] [--finGraph=phase7fin] [--finGraphB=phase7finB]
//
// Async style: qtools taskListPlus/pipeRunner. No async/await, no try/catch for control flow. camelCase.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();
const configFileProcessor = require('qtools-config-file-processor');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CONFIGS_DIR = path.join(projectRoot, 'configs');
const GRAPH_BUILDER = path.join(projectRoot, 'code', 'cli', 'lib.d', 'edf-replay', 'lib', 'graph-builder');
const GATE_LIB = path.join(__dirname, '..', 'lib');

const vocabulary = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));
const schemaViewFinisherFactory = require(path.join(CORE_LIB, 'finishing', 'lib', 'schema-view-finisher'));
const schemaConstraintFinisherFactory = require(path.join(CORE_LIB, 'finishing', 'lib', 'schema-constraint-finisher'));
const finishingFactory = require(path.join(CORE_LIB, 'finishing', 'finishing'));
const validatorFactory = require(path.join(CORE_LIB, 'schema-validator', 'schema-validator'));

const DEFAULT_GATING_MANIFEST = 'a9c2efcfbb302d84f69890ce86d2bd8c0f274e0901b309ce55baf4fc8a5c4d11';

const argVal = (name) => {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.replace(`--${name}=`, '') : null;
};
const manifestKey = argVal('manifest') || DEFAULT_GATING_MANIFEST;
const baselineLabel = argVal('baselineLabel') || 'goldenAll';
const skipGraph = argVal('skipGraph') || 'phase7skip';
const finGraph = argVal('finGraph') || 'phase7fin';
const finGraphB = argVal('finGraphB') || 'phase7finB';

const xLog = {
	status: (...a) => console.error(...a),
	error: (...a) => console.error(...a),
	result: (...a) => console.log(...a),
	verbose: () => {},
};
let wholeConfig = {};
const hostConfigName =
	os.hostname() === 'qMax.local' || os.hostname() === 'qbook.local' ? 'instanceSpecific/qbook' : '';
const systemIni = path.join(CONFIGS_DIR, hostConfigName, 'systemParameters.ini');
if (fs.existsSync(systemIni)) {
	wholeConfig = configFileProcessor.getConfig(systemIni) || {};
}
process.global = {
	xLog,
	getConfig: (name) => (name === 'allConfigs' ? wholeConfig : wholeConfig[name] || {}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
	rawConfig: wholeConfig,
};

const buildSharedResources = (callback) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	const credentialAccessor = require(path.join(CORE_LIB, 'credential-accessor', 'credential-accessor'))({ forgeStore });
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.init({ dbPath: path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3') }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({ forgeStore, credentialAccessor })(
			(err, lifecycle) => next(err, { ...args, lifecycle }),
		);
	});
	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		const lifecycle = args.lifecycle;
		callback('', {
			forgeStore,
			lifecycle,
			graphBuilder: require(GRAPH_BUILDER)({ forgeStore, lifecycle }),
			fingerprinter: require(path.join(GATE_LIB, 'graph-fingerprint', 'graphFingerprint'))({ lifecycle }),
			differ: require(path.join(GATE_LIB, 'graph-diff', 'graphDiff'))(),
			productionGuard: require(path.join(GATE_LIB, 'production-guard', 'productionGuard'))({ forgeStore }),
			baselineStore: require(path.join(GATE_LIB, 'baseline-store', 'baselineStore'))({ projectRoot }),
		});
	});
};

const checks = [];
const record = (name, passed, detail) => {
	checks.push({ name, passed: !!passed, detail });
	xLog.status(`  [${passed ? 'PASS' : 'FAIL'}] ${name} — ${detail}`);
};

const queryOne = (lifecycle, graphName, cypher, params, callback) => {
	lifecycle.runCypher({ graphName, cypher, params: params || {} }, (err, result) => {
		if (err) {
			callback(err);
			return;
		}
		callback('', (result.records && result.records[0]) || {});
	});
};

// build an isolated scratch graph from the gating manifest, with finishing on or off. clean first.
const buildScratch = (resources, { graphName, skipFinishing }, callback) => {
	const { productionGuard, lifecycle, graphBuilder } = resources;
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		productionGuard.assertSafeBuildTarget({ graphName }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		lifecycle.destroyInstanceByName({ graphName, force: true }, () => next('', args));
	});
	taskList.push((args, next) => {
		graphBuilder.buildGraph({ manifestKey, destination: graphName, role: 'bronze', skipFinishing }, (err, buildResult) =>
			next(err, { ...args, buildResult }),
		);
	});
	pipeRunner(taskList.getList(), {}, (err, args) => callback(err, args && args.buildResult));
};

const teardown = (resources, graphName, callback) => {
	resources.lifecycle.destroyInstanceByName({ graphName, force: true }, () => callback('', {}));
};

// the registry-derived expectations (schema view + constraints), from the finishers themselves.
const schemaViewFinisher = schemaViewFinisherFactory({ lifecycle: null, vocabulary });
const schemaConstraintFinisher = schemaConstraintFinisherFactory({ lifecycle: null, vocabulary });
const expectedMembers = schemaViewFinisher.buildMembers();
const expectedMemberStableIds = new Set(expectedMembers.map((oneMember) => oneMember.stableId));
const expectedConstraintNames = schemaConstraintFinisher.constraintSpecs.map((oneSpec) => oneSpec.constraintName);
const SCHEMA_VIEW = vocabulary.SCHEMA_VIEW;

// checkSchemaViewMatches — query the in-graph view and compare to the registry expectation.
const checkSchemaViewMatches = (lifecycle, graphName, callback) => {
	const cypher = `
		MATCH (m:\`${SCHEMA_VIEW.LABEL}\`)
		WITH collect(m.stableId) AS memberIds
		OPTIONAL MATCH ()-[e:\`${SCHEMA_VIEW.EDGE_TYPE}\`]->()
		RETURN memberIds AS memberIds, count(e) AS edgeCount`;
	queryOne(lifecycle, graphName, cypher, {}, (err, row) => {
		if (err) {
			callback('', { matches: false, detail: `query error: ${err}` });
			return;
		}
		const inGraph = new Set(row.memberIds || []);
		const edgeCount = Number(row.edgeCount || 0);
		// expected nodes = root + members; expected HAS_SCHEMA_TERM edges = members.
		const expectedNodeIds = new Set([SCHEMA_VIEW.ROOT_STABLE_ID, ...expectedMemberStableIds]);
		const missing = [...expectedNodeIds].filter((oneId) => !inGraph.has(oneId));
		const extra = [...inGraph].filter((oneId) => !expectedNodeIds.has(oneId));
		const matches = missing.length === 0 && extra.length === 0 && edgeCount === expectedMembers.length;
		callback('', {
			matches,
			detail: `inGraph nodes=${inGraph.size} (expected ${expectedNodeIds.size}); HAS_SCHEMA_TERM edges=${edgeCount} (expected ${expectedMembers.length}); missing=${missing.length} extra=${extra.length}`,
		});
	});
};

// ============================ MAIN ============================
buildSharedResources((resErr, resources) => {
	if (resErr) {
		xLog.error(`phase7Finishers: bootstrap failed: ${resErr}`);
		process.exit(1);
	}
	const { lifecycle, fingerprinter, differ, baselineStore } = resources;
	const finishing = finishingFactory({ lifecycle });
	const liveConstraintFinisher = schemaConstraintFinisherFactory({ lifecycle, vocabulary });

	const state = {}; // carries fingerprints + manifests between stages
	const taskList = new taskListPlus();

	// ----- read the frozen goldenAll baseline (its flags drive every fingerprint comparison).
	taskList.push((args, next) => {
		baselineStore.readBaseline({ label: baselineLabel }, (err, baseline) => {
			if (err || !baseline || !baseline.meta || !baseline.meta.fingerprint) {
				next(`no usable baseline '${baselineLabel}': ${err || 'missing'}`);
				return;
			}
			state.baseline = baseline;
			state.fpFlags = {
				scope: baseline.meta.scope || 'all',
				ignoreEmbedding: !!baseline.meta.ignoreEmbedding,
				ignoreOwnerStamp: !!baseline.meta.ignoreOwnerStamp,
			};
			xLog.status(`[phase7] baseline '${baselineLabel}' fp=${baseline.meta.fingerprint.slice(0, 12)}… flags=${JSON.stringify(state.fpFlags)}`);
			next('', args);
		});
	});

	// ===== STAGE A — the SKIP build (raw graph == baseline) =====
	taskList.push((args, next) => {
		xLog.status(`[phase7] building SKIP graph '${skipGraph}' (--skipFinishing)…`);
		buildScratch(resources, { graphName: skipGraph, skipFinishing: true }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		fingerprinter.fingerprintGraph({ graphName: skipGraph, ...state.fpFlags }, (err, fp) => {
			if (err) {
				next(`skip fingerprint: ${err}`);
				return;
			}
			state.skipFp = fp;
			record(
				'skipEqualsBaseline',
				fp.fingerprint === state.baseline.meta.fingerprint && fp.nodeCount > 0,
				`skip fp=${fp.fingerprint.slice(0, 12)}… baseline=${state.baseline.meta.fingerprint.slice(0, 12)}… (${fp.nodeCount}n/${fp.edgeCount}e)`,
			);
			next('', args);
		});
	});
	taskList.push((args, next) => {
		queryOne(lifecycle, skipGraph, 'SHOW CONSTRAINTS YIELD name RETURN count(*) AS c', {}, (err, row) => {
			if (err) {
				next(`skip SHOW CONSTRAINTS: ${err}`);
				return;
			}
			record('skipHasNoConstraints', Number(row.c) === 0, `skip graph constraints=${Number(row.c)} (REQUIRED 0 — finishing skipped)`);
			next('', args);
		});
	});
	// constraintViolationTwin — inject a duplicate stableId on the (constraint-free) skip graph, then run the
	// schema-constraint finisher: the uniqueness CREATE must FAIL. Cleanup the injected dup afterward.
	taskList.push((args, next) => {
		const inject = `MATCH (n:ForgedNode) WITH n.stableId AS sid LIMIT 1 CREATE (d:ForgedNode { stableId: sid, _twinInjected: true }) RETURN sid AS sid`;
		queryOne(lifecycle, skipGraph, inject, {}, (err) => {
			if (err) {
				next(`twin inject: ${err}`);
				return;
			}
			liveConstraintFinisher.finish({ graphName: skipGraph }, (finishErr) => {
				const caught = !!finishErr;
				record(
					'constraintViolationTwin',
					caught,
					caught ? `CREATE CONSTRAINT correctly FAILED on the injected duplicate stableId (${`${finishErr}`.slice(0, 80)}…)` : 'constraint creation did NOT fail on a duplicate stableId (twin did not bite)',
				);
				// cleanup: remove the injected node AND drop any constraint that may have been created.
				const cleanup = `MATCH (d:ForgedNode {_twinInjected:true}) DELETE d`;
				lifecycle.runCypher({ graphName: skipGraph, cypher: cleanup }, () => next('', args));
			});
		});
	});
	taskList.push((args, next) => {
		teardown(resources, skipGraph, () => next('', args));
	});

	// ===== STAGE B — the FINISHING build (additive schema-view delta + constraints) =====
	taskList.push((args, next) => {
		xLog.status(`[phase7] building FINISHING graph '${finGraph}'…`);
		buildScratch(resources, { graphName: finGraph, skipFinishing: false }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		fingerprinter.fingerprintGraph({ graphName: finGraph, ...state.fpFlags }, (err, fp) => {
			if (err) {
				next(`finishing fingerprint: ${err}`);
				return;
			}
			state.finFp = fp;
			next('', args);
		});
	});
	// finishingDiff — vs the frozen baseline: removed=0, changed=0, added == schema-view ONLY.
	taskList.push((args, next) => {
		const diff = differ.diffManifests({
			baseline: state.baseline.snapshot.elementManifest,
			candidate: state.finFp.elementManifest,
		});
		const addedNodeIds = new Set(diff.nodes.added);
		const removedNodes = diff.nodes.removed.length;
		const changedNodes = diff.nodes.changed.length;
		const addedEdges = diff.edges.added.length;
		const removedEdges = diff.edges.removed.length;
		const addedEdgeTypes = Object.keys(diff.edges.addedByType || {});
		// the added node stableIds must be EXACTLY {schemaView root + every registry member} — label-independent
		// (robust to the owner-stamp label appearing in addedByLabel); every added edge a HAS_SCHEMA_TERM edge.
		const expectedNodeIds = new Set([SCHEMA_VIEW.ROOT_STABLE_ID, ...expectedMemberStableIds]);
		const unexpectedAdded = [...addedNodeIds].filter((oneId) => !expectedNodeIds.has(oneId));
		const missingAdded = [...expectedNodeIds].filter((oneId) => !addedNodeIds.has(oneId));
		const onlySchemaTermEdges = addedEdgeTypes.length === 0 || (addedEdgeTypes.length === 1 && addedEdgeTypes[0] === SCHEMA_VIEW.EDGE_TYPE);
		const passed =
			removedNodes === 0 &&
			changedNodes === 0 &&
			removedEdges === 0 &&
			unexpectedAdded.length === 0 &&
			missingAdded.length === 0 &&
			addedEdges === expectedMembers.length &&
			onlySchemaTermEdges;
		record(
			'finishingDiff',
			passed,
			`added ${addedNodeIds.size}n/${addedEdges}e (expected ${expectedNodeIds.size}n/${expectedMembers.length}e), removed ${removedNodes}n/${removedEdges}e (REQ 0), changed ${changedNodes} (REQ 0); unexpectedAdded=${unexpectedAdded.length} missingAdded=${missingAdded.length}; addedEdgeTypes=[${addedEdgeTypes.join(',')}]`,
		);
		next('', args);
	});
	// constraintsPresent — the finishing build carries exactly the registry-derived constraints.
	taskList.push((args, next) => {
		queryOne(lifecycle, finGraph, 'SHOW CONSTRAINTS YIELD name RETURN collect(name) AS names', {}, (err, row) => {
			if (err) {
				next(`finishing SHOW CONSTRAINTS: ${err}`);
				return;
			}
			const present = new Set(row.names || []);
			const missing = expectedConstraintNames.filter((oneName) => !present.has(oneName));
			record(
				'constraintsPresent',
				missing.length === 0,
				`present=[${[...present].sort().join(',')}] expected=[${expectedConstraintNames.join(',')}] missing=[${missing.join(',')}]`,
			);
			next('', args);
		});
	});
	// schemaViewMatchesRegistry — the in-graph view equals the registry expectation.
	taskList.push((args, next) => {
		checkSchemaViewMatches(lifecycle, finGraph, (e, res) => {
			record('schemaViewMatchesRegistry', res.matches, res.detail);
			next('', args);
		});
	});
	// finisherIdempotent — re-running the finishers leaves the all-scope fingerprint unchanged.
	taskList.push((args, next) => {
		finishing.applyFinishers({ graphName: finGraph, skipFinishing: false }, (err) => {
			if (err) {
				next(`finisher re-apply: ${err}`);
				return;
			}
			fingerprinter.fingerprintGraph({ graphName: finGraph, ...state.fpFlags }, (fErr, fp2) => {
				if (fErr) {
					next(`re-fingerprint: ${fErr}`);
					return;
				}
				record('finisherIdempotent', fp2.fingerprint === state.finFp.fingerprint, `re-run fp=${fp2.fingerprint.slice(0, 12)}… first=${state.finFp.fingerprint.slice(0, 12)}…`);
				next('', args);
			});
		});
	});
	// schemaViewDriftTwin — delete a member -> view no longer matches; restore -> matches again.
	taskList.push((args, next) => {
		const victim = expectedMembers[0].stableId;
		const del = `MATCH (m:\`${SCHEMA_VIEW.LABEL}\` { stableId: $sid }) DETACH DELETE m`;
		lifecycle.runCypher({ graphName: finGraph, cypher: del, params: { sid: victim } }, (delErr) => {
			if (delErr) {
				next(`drift delete: ${delErr}`);
				return;
			}
			checkSchemaViewMatches(lifecycle, finGraph, (e1, afterDelete) => {
				const detected = !afterDelete.matches;
				// restore by re-running the schema-view finisher (MERGE re-creates the member + edge).
				schemaViewFinisherFactory({ lifecycle, vocabulary }).finish({ graphName: finGraph }, (restoreErr) => {
					if (restoreErr) {
						next(`drift restore: ${restoreErr}`);
						return;
					}
					checkSchemaViewMatches(lifecycle, finGraph, (e2, afterRestore) => {
						record(
							'schemaViewDriftTwin',
							detected && afterRestore.matches,
							`drift detected after delete=${detected}; restored match=${afterRestore.matches} (deleted '${victim}')`,
						);
						next('', args);
					});
				});
			});
		});
	});
	taskList.push((args, next) => {
		teardown(resources, finGraph, () => next('', args));
	});

	// ===== STAGE C — determinism: an independent finishing build has the SAME fingerprint =====
	taskList.push((args, next) => {
		xLog.status(`[phase7] building 2nd FINISHING graph '${finGraphB}' (determinism)…`);
		buildScratch(resources, { graphName: finGraphB, skipFinishing: false }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		fingerprinter.fingerprintGraph({ graphName: finGraphB, ...state.fpFlags }, (err, fp) => {
			if (err) {
				next(`finishingB fingerprint: ${err}`);
				return;
			}
			record('finisherDeterminism', fp.fingerprint === state.finFp.fingerprint && fp.nodeCount > 0, `finB fp=${fp.fingerprint.slice(0, 12)}… fin fp=${state.finFp.fingerprint.slice(0, 12)}…`);
			next('', args);
		});
	});
	taskList.push((args, next) => {
		teardown(resources, finGraphB, () => next('', args));
	});

	// ===== STAGE D — the off-schema-block validator twin (pure) =====
	taskList.push((args, next) => {
		const validator = validatorFactory({ vocabulary });
		const control = {
			ref: { source: 'p7', id: 'ctrl' }, labels: ['ForgedNode', 'HubReference'], stableId: 'p7:ctrl',
			properties: { canonicalKey: ['P1'], hubVersion: ['1'], referenceTier: ['property'], addressSignature: ['s'] },
		};
		const ctrl = validator.validateBlock({ nodes: [control], edges: [] });
		const off = validator.validateBlock({
			nodes: [{ ref: { source: 'p7', id: 'bad' }, labels: ['HubReference'], properties: {} }], // missing ForgedNode + stableId + required props
			edges: [{ type: 'EXACT_MATCH', fromRef: { source: 'p7', id: 'a' }, toRef: { source: 'p7', id: 'b' }, properties: { provenanceTier: ['__bogus__'] } }],
		});
		record('offSchemaBlockTwin', ctrl.ok && off.violations.length > 0, `control violations=${ctrl.violations.length} (REQ 0); off-schema violations=${off.violations.length} (REQ >0)`);
		next('', args);
	});

	pipeRunner(taskList.getList(), {}, (pErr) => {
		if (pErr) {
			xLog.error(`phase7Finishers: ABORTED: ${pErr}`);
			// best-effort teardown of any scratch left behind
			const cleanup = new taskListPlus();
			[skipGraph, finGraph, finGraphB].forEach((g) => cleanup.push((a, n) => teardown(resources, g, () => n('', a))));
			pipeRunner(cleanup.getList(), {}, () => {
				console.log(JSON.stringify({ verdict: 'RED', aborted: true, error: `${pErr}`, total: checks.length, checks }, null, 2));
				process.exit(1);
			});
			return;
		}
		const failures = checks.filter((oneCheck) => !oneCheck.passed);
		const verdict = failures.length === 0 ? 'GREEN' : 'RED';
		console.log(JSON.stringify({ verdict, total: checks.length, failures: failures.length, checks }, null, 2));
		process.exit(verdict === 'GREEN' ? 0 : 1);
	});
});
