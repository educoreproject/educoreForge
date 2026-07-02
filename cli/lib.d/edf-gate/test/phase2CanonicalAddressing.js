#!/usr/bin/env node
'use strict';

// phase2CanonicalAddressing.js — the PHASE-2 GATE OF RECORD (canonical addressing).
//
// Phase 2 stamps the canonical-address components (canonicalKey + hubVersion + the four-part slot ids)
// onto the CEDS hub structural nodes — a PROPERTY-ONLY, additive delta. This harness proves it the way
// the plan requires (PLAN §Phase-2): an ADDITIVE phase is NOT fingerprint-identical, so the gate of
// record is a STRUCTURED diff that must equal EXACTLY the declared added properties on exactly the hub
// node types and nothing structural, PLUS canonicalKey uniqueness (zero-violation), PLUS canonicalKey
// joining the Ed-Fi Global IDs (379 of 385), PLUS a fault-injection TWIN observed failing (G3).
//
// It builds the CANDIDATE golden (the golden manifest with the re-forged CEDS block superseded) into an
// isolated scratch graph and compares — all-scope, embedding-excluded — against the reference golden
// replay (phase0a). Never touches the production golden (productionGuard).
//
// Usage:
//   node phase2CanonicalAddressing.js --candidateManifest=<key> [--reference=phase0a] [--candidate=phase2cand]
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

// the declared Phase-2 delta: the address-property keys, and which hub labels may carry which.
const ADDRESS_KEYS = ['hubName', 'hubVersion', 'canonicalKey', 'domainId', 'rangeOptionSetId', 'rangeDatatype'];
// known volatile properties — the SAME set forgeStructuralFingerprint excludes. These drift across any
// re-forge independent of the address stamping: `ingestedAt` is the per-build root timestamp (like
// GraphProvenance.builtAt), `embeddingModelVersion` differs only because the candidate is built
// embedding-free for the embedding-excluded comparison. The all-scope fingerprint drops `embedding`
// under ignoreEmbedding but not these two, so the diff assertion subtracts them and reports them openly.
const VOLATILE_PROPS = ['embedding', 'embeddingModelVersion', 'ingestedAt'];
const CEDS_URI_PREFIX = 'https://w3id.org/CEDStandards'; // every CEDS hub node's stableId is under this
const EXPECTED_REFERENCE_NODES = 75685; // all-scope golden node count (gate 14 fact)
const EXPECTED_JOIN = 379; // of 385 Yes-row CEDS-property targets (6 remodeled person-ids -> Phase 4)
const EXPECTED_JOIN_TOTAL = 385;
// the EXACT 6 unjoined targets (the remodeled person-ids -> Phase-4 version-bridge). Asserting the SET,
// not just the count, closes the gap where a different miss-set of the same size would pass.
const EXPECTED_MISSING = ['P001070', 'P001071', 'P001072', 'P001073', 'P001074', 'P001075'];

// arg parsing (standalone harness, plain argv)
const argVal = (name) => {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.replace(`--${name}=`, '') : null;
};
const candidateKeyFile = path.join(
	'/private/tmp/claude-501/-Users-tqwhite-Documents-webdev/c430e4af-6194-4a57-9daa-3faee3cce6a8/scratchpad',
	'candidate-manifest-key.txt',
);
const candidateManifest =
	argVal('candidateManifest') ||
	(fs.existsSync(candidateKeyFile) ? fs.readFileSync(candidateKeyFile, 'utf8').trim() : null);
const referenceGraph = argVal('reference') || 'phase0a';
const candidateGraph = argVal('candidate') || 'phase2cand';

// --------------------------------------------------------------------------------
// process.global bootstrap (mirror edfGate.bootstrapGlobal)
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

// --------------------------------------------------------------------------------
// shared resources (mirror edfGate.buildSharedResources)
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
			groundTruth: require(path.join(GATE_LIB, 'ground-truth', 'groundTruth'))(),
		});
	});
};

// --------------------------------------------------------------------------------
// cypher helper -> first row
const queryOne = (lifecycle, graphName, cypher, params, callback) => {
	lifecycle.runCypher({ graphName, cypher, params: params || {} }, (err, result) => {
		if (err) {
			callback(err);
			return;
		}
		callback('', (result.records && result.records[0]) || {});
	});
};

// --------------------------------------------------------------------------------
// Ed-Fi join expectation (computed from the crosswalk + the built graph's CEDS property canonicalKeys)
const computeEdfiJoin = (groundTruth, propertyKeySet) => {
	const fx = groundTruth.loadFixtures();
	const header = fx.elements.header;
	const uriCol = header.find((c) => /CEDSOntologyPropertyURI/i.test(c));
	const confCol = header.find((c) => /CEDSMappingConfidence/i.test(c) || /MappingConfidence/i.test(c));
	const tokenOf = (uri) => {
		const m = `${uri}`.match(/#?(P\d{6,})\s*$/);
		return m ? m[1] : null;
	};
	const yesTargets = new Set();
	fx.elements.records.forEach((r) => {
		if (`${r[confCol]}`.trim().toLowerCase() !== 'yes') return;
		const t = tokenOf(r[uriCol]);
		if (t) yesTargets.add(t);
	});
	const joined = [...yesTargets].filter((t) => propertyKeySet.has(t));
	const missing = [...yesTargets].filter((t) => !propertyKeySet.has(t));
	return { total: yesTargets.size, joined: joined.length, missing };
};

// --------------------------------------------------------------------------------
const checks = [];
const record = (name, passed, detail) => {
	checks.push({ name, passed: !!passed, detail });
	xLog.status(`  [${passed ? 'PASS' : 'FAIL'}] ${name} — ${detail}`);
};

const run = () => {
	if (!candidateManifest) {
		xLog.error('phase2 gate: no --candidateManifest (and no scratch key file). Aborting.');
		process.exit(2);
	}
	xLog.status(`[phase2 gate] candidate manifest ${candidateManifest.slice(0, 16)}…; reference '${referenceGraph}'; candidate graph '${candidateGraph}'`);

	buildSharedResources((err, resources) => {
		if (err) {
			xLog.error(`phase2 gate bootstrap failed: ${err}`);
			process.exit(2);
		}
		const { lifecycle, graphBuilder, fingerprinter, differ, productionGuard, groundTruth } = resources;
		const taskList = new taskListPlus();

		// 0) guard the candidate target name + clean any prior instance
		taskList.push((args, next) => {
			productionGuard.assertSafeBuildTarget({ graphName: candidateGraph }, (gErr) => {
				if (gErr) {
					next(`productionGuard refused '${candidateGraph}': ${gErr}`);
					return;
				}
				lifecycle.destroyInstanceByName({ graphName: candidateGraph, force: true }, () => next('', args));
			});
		});

		// 1) build the candidate golden into the isolated scratch graph
		taskList.push((args, next) => {
			xLog.status(`[phase2 gate] building candidate '${candidateGraph}' from manifest…`);
			graphBuilder.buildGraph({ manifestKey: candidateManifest, destination: candidateGraph, role: 'bronze' }, (bErr, buildResult) => {
				if (bErr) {
					next(`candidate build failed: ${bErr}`);
					return;
				}
				next('', { ...args, buildResult });
			});
		});

		// 2) fingerprint candidate + reference (all-scope, embedding-excluded) -> element manifests
		taskList.push((args, next) => {
			fingerprinter.fingerprintGraph({ graphName: candidateGraph, ignoreEmbedding: true, scope: 'all' }, (fErr, candFp) => {
				if (fErr) {
					next(`candidate fingerprint failed: ${fErr}`);
					return;
				}
				next('', { ...args, candFp });
			});
		});
		taskList.push((args, next) => {
			fingerprinter.fingerprintGraph({ graphName: referenceGraph, ignoreEmbedding: true, scope: 'all' }, (fErr, refFp) => {
				if (fErr) {
					next(`reference fingerprint failed (is '${referenceGraph}' up?): ${fErr}`);
					return;
				}
				next('', { ...args, refFp });
			});
		});

		// 3) STRUCTURED DIFF — reference (baseline, no address props) vs candidate (with address props)
		taskList.push((args, next) => {
			const { refFp, candFp } = args;
			record(
				'reference.sane',
				refFp.nodeCount === EXPECTED_REFERENCE_NODES,
				`reference '${referenceGraph}' all-scope nodeCount=${refFp.nodeCount} (expect ${EXPECTED_REFERENCE_NODES})`,
			);
			const diff = differ.diffManifests({ baseline: refFp.elementManifest, candidate: candFp.elementManifest });

			// 3a) nothing structural: zero added/removed nodes & edges
			const s = diff.summary;
			record(
				'diff.nothingStructural',
				s.addedNodes === 0 && s.removedNodes === 0 && s.addedEdges === 0 && s.removedEdges === 0,
				`addedNodes=${s.addedNodes} removedNodes=${s.removedNodes} addedEdges=${s.addedEdges} removedEdges=${s.removedEdges} (all must be 0)`,
			);

			// 3b) the ONLY substantive changed properties are the declared address keys (set equality);
			//     documented volatile props are subtracted and reported openly (never silently dropped).
			const changedKeys = Object.keys(diff.nodes.changedPropFrequency || {});
			const volatileObserved = changedKeys.filter((k) => VOLATILE_PROPS.includes(k)).sort();
			const substantive = changedKeys.filter((k) => !VOLATILE_PROPS.includes(k)).sort();
			const expected = ADDRESS_KEYS.slice().sort();
			const setsEqual =
				substantive.length === expected.length && substantive.every((k, i) => k === expected[i]);
			const freq = diff.nodes.changedPropFrequency || {};
			const volatileFreq = volatileObserved.map((k) => `${k}:${freq[k]}`).join(',');
			record(
				'diff.exactlyAddressProps',
				setsEqual,
				`substantiveChangedKeys=[${substantive.join(',')}] (expect [${expected.join(',')}]); volatileExcluded=[${volatileFreq}]`,
			);

			// 3c) every changed node is a CEDS hub node (stableId under the CEDS namespace)
			const nonCeds = diff.nodes.changed.filter((c) => !`${c.stableId}`.startsWith(CEDS_URI_PREFIX));
			record(
				'diff.onlyCedsNodesChanged',
				nonCeds.length === 0,
				`changedNodes=${diff.nodes.changed.length}, non-CEDS changed=${nonCeds.length}${nonCeds.length ? ' e.g. ' + nonCeds.slice(0, 3).map((c) => c.stableId).join(', ') : ''}`,
			);
			next('', { ...args, diff });
		});

		// 4) canonicalKey UNIQUENESS (zero-violation) + presence
		taskList.push((args, next) => {
			const cypher = `
				MATCH (n:ForgedNode) WHERE n.canonicalKey IS NOT NULL
				WITH n.canonicalKey AS k, count(*) AS c
				RETURN count(k) AS distinctKeys, sum(CASE WHEN c > 1 THEN 1 ELSE 0 END) AS violations, sum(c) AS stampedNodes
			`;
			queryOne(lifecycle, candidateGraph, cypher, {}, (qErr, row) => {
				if (qErr) {
					next(`uniqueness query failed: ${qErr}`);
					return;
				}
				const violations = Number(row.violations || 0);
				const distinctKeys = Number(row.distinctKeys || 0);
				record(
					'uniqueness.canonicalKey',
					violations === 0 && distinctKeys > 0,
					`distinctCanonicalKeys=${distinctKeys} violations=${violations} stampedNodes=${row.stampedNodes}`,
				);
				next('', args);
			});
		});

		// 5) Ed-Fi GLOBAL-ID JOIN — CEDS property canonicalKeys vs crosswalk #P###### (Yes rows)
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `MATCH (n:CedsProperty) WHERE n.canonicalKey IS NOT NULL RETURN collect(n.canonicalKey) AS keys`, {}, (qErr, row) => {
				if (qErr) {
					next(`property-key query failed: ${qErr}`);
					return;
				}
				const propertyKeySet = new Set(row.keys || []);
				const join = computeEdfiJoin(groundTruth, propertyKeySet);
				const missingSorted = join.missing.slice().sort();
				const missingSetExact =
					missingSorted.length === EXPECTED_MISSING.length &&
					missingSorted.every((t, i) => t === EXPECTED_MISSING[i]);
				record(
					'edfiGlobalIdJoin',
					join.joined === EXPECTED_JOIN && join.total === EXPECTED_JOIN_TOTAL && missingSetExact,
					`Yes-row CEDS-property targets=${join.total} joined=${join.joined} missing=[${missingSorted.join(',')}] expectMissing=[${EXPECTED_MISSING.join(',')}] setExact=${missingSetExact} (expect ${EXPECTED_JOIN}/${EXPECTED_JOIN_TOTAL})`,
				);
				next('', args);
			});
		});

		// 6) TWIN (G3) — inject a duplicate canonicalKey; the uniqueness gate MUST go RED.
		taskList.push((args, next) => {
			// corrupt: make the School operational-status property collide with the LEA one.
			const corrupt = `MATCH (n:CedsProperty {canonicalKey:'P000533'}) SET n.canonicalKey='P000174' RETURN count(n) AS hit`;
			queryOne(lifecycle, candidateGraph, corrupt, {}, (cErr, crow) => {
				if (cErr) {
					next(`twin corruption failed: ${cErr}`);
					return;
				}
				const cypher = `
					MATCH (n:ForgedNode) WHERE n.canonicalKey IS NOT NULL
					WITH n.canonicalKey AS k, count(*) AS c
					RETURN sum(CASE WHEN c > 1 THEN 1 ELSE 0 END) AS violations
				`;
				queryOne(lifecycle, candidateGraph, cypher, {}, (qErr, row) => {
					if (qErr) {
						next(`twin re-check failed: ${qErr}`);
						return;
					}
					const violations = Number(row.violations || 0);
					record(
						'twin.uniquenessCatchesCorruption',
						violations > 0,
						`corrupted P000533->P000174 (hit=${crow.hit}); uniqueness violations now ${violations} (must be > 0 — gate observed failing)`,
					);
					next('', args);
				});
			});
		});

		// 7) teardown the candidate scratch graph (it is now corrupted by the twin; disposable)
		taskList.push((args, next) => {
			lifecycle.destroyInstanceByName({ graphName: candidateGraph, force: true }, () => next('', args));
		});

		pipeRunner(taskList.getList(), {}, (pErr) => {
			if (pErr) {
				xLog.error(`\n[phase2 gate] ERROR: ${pErr}`);
				console.log(JSON.stringify({ verdict: 'ERROR', error: `${pErr}`, checks }, null, 2));
				process.exit(2);
			}
			const failures = checks.filter((c) => !c.passed);
			const verdict = failures.length === 0 ? 'GREEN' : 'RED';
			console.log(JSON.stringify({ verdict, candidateManifest, referenceGraph, total: checks.length, failures: failures.length, checks }, null, 2));
			process.exit(verdict === 'GREEN' ? 0 : 1);
		});
	});
};

run();
