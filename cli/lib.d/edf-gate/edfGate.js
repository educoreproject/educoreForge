#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edfGate.js — the `edf-gate` CLI: the Phase-0 proving apparatus (gate harness).
//
//   edf-gate -fingerprint      --graph=<graphName> [--ignoreOwnerStamp]
//   edf-gate -proveDeterminism --manifest=<manifestKey> [--targetA=phase0a] [--targetB=phase0b]
//                              [--keepGraphs]
//   edf-gate -freezeBaseline   --manifest=<manifestKey> [--target=phase0baseline] [--label=golden]
//                              [--keepGraph]
//   edf-gate -diff             --baseline=<snapshotFile> --candidateGraph=<graphName>
//   edf-gate -runSuite         [--manifest=<manifestKey>]
//
// 3-layer orchestrator (mirrors edf-replay): Layer 1 (this file) bootstraps process.global and
// instantiates shared resources (forge-store, credential-accessor, instance-lifecycle, AND reuses
// edf-replay's graph-builder verbatim — the build path is not duplicated). Layer 2 (lib/) holds the
// fingerprint, diff, production-guard, baseline-store, gate-suite, ground-truth modules.
//
// THE KEYSTONE is -proveDeterminism: replay one manifest into TWO independent isolated graphs and
// assert their fingerprints are identical. Production golden is NEVER touched (productionGuard +
// isolated scratch names only).
//
// Action flags single-hyphen; parameters double-hyphen. Async style: qtools taskListPlus/pipeRunner;
// no async/await, no try/catch for control flow. camelCase only.

const path = require('path');
const os = require('os');
const fs = require('fs');

const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();
const configFileProcessor = require('qtools-config-file-processor');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// --------------------------------------------------------------------------------
// PROJECT ROOT + PATHS (mirror edfReplay.js)
const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();

const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CONFIGS_DIR = path.join(projectRoot, 'configs');
const GRAPH_BUILDER = path.join(
	projectRoot,
	'code',
	'cli',
	'lib.d',
	'edf-replay',
	'lib',
	'graph-builder',
);

const fingerprinterFactory = require('./lib/graph-fingerprint/graphFingerprint');
const differFactory = require('./lib/graph-diff/graphDiff');
const productionGuardFactory = require('./lib/production-guard/productionGuard');
const baselineStoreFactory = require('./lib/baseline-store/baselineStore');
const gateSuiteFactory = require('./lib/gate-suite/gateSuite');
const groundTruthFactory = require('./lib/ground-truth/groundTruth');

// booleanFlag — accept -name (switch), --name (valueless at end), or --name=true. Mirrors
// edfReplay.js so the apparatus parses boolean flags the same way the rest of the CLI does.
const booleanFlag = (name) =>
	!!commandLineParameters.switches[name] ||
	commandLineParameters.values[name] === true ||
	(Array.isArray(commandLineParameters.values[name]) &&
		commandLineParameters.values[name][0] === true);

// =====================================================================
// HELP
// =====================================================================

const helpText = () => `
NAME
     edf-gate -- Phase-0 proving apparatus: fingerprint, diff, determinism proof, baseline freeze.

SYNOPSIS
     edf-gate -fingerprint      --graph=<graphName> [--ignoreOwnerStamp]
     edf-gate -proveDeterminism --manifest=<manifestKey> [--targetA=phase0a] [--targetB=phase0b] [--keepGraphs]
     edf-gate -freezeBaseline   --manifest=<manifestKey> [--target=phase0baseline] [--label=golden] [--keepGraph]
     edf-gate -diff             --baseline=<snapshotFile> --candidateGraph=<graphName>
     edf-gate -runSuite         [--manifest=<manifestKey>]

DESCRIPTION
     The proving apparatus for the cross-standard-equivalence build. Fingerprints are
     order-independent and scoped to (:ForgedNode) content (the non-deterministic :GraphProvenance
     passport is excluded). -proveDeterminism replays ONE manifest into TWO independent isolated
     graphs and asserts identical fingerprints — the keystone determinism proof. Never touches the
     production golden (productionGuard refuses golden targets).

     Action flags single-hyphen; parameters double-hyphen.
`;

// =====================================================================
// BOOTSTRAP process.global (mirror edfReplay.js)
// =====================================================================

const bootstrapGlobal = () => {
	const verbose = !!commandLineParameters.switches.verbose;
	const xLog = {
		status: (...args) => console.error(...args),
		error: (...args) => console.error(...args),
		result: (...args) => console.log(...args),
		verbose: verbose ? (...args) => console.error(...args) : () => {},
	};

	let wholeConfig = {};
	const hostConfigName =
		os.hostname() === 'qMax.local' || os.hostname() === 'qbook.local'
			? 'instanceSpecific/qbook'
			: '';
	const configDirPath = path.join(CONFIGS_DIR, hostConfigName);
	const systemIni = path.join(configDirPath, 'systemParameters.ini');
	if (fs.existsSync(systemIni)) {
		wholeConfig = configFileProcessor.getConfig(systemIni) || {};
	}
	const getConfig = (name) =>
		name === 'allConfigs' ? wholeConfig : wholeConfig[name] || {};

	process.global = {
		xLog,
		getConfig,
		commandLineParameters,
		rawConfig: wholeConfig,
	};
};

// =====================================================================
// SHARED RESOURCES (mirror edfReplay.js + apparatus modules)
// =====================================================================

const dbPath = () => path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');

const buildSharedResources = (callback) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	const credentialAccessor = require(path.join(
		CORE_LIB,
		'credential-accessor',
		'credential-accessor',
	))({ forgeStore });

	const taskList = new taskListPlus();

	taskList.push((args, next) => {
		const storeDir = path.dirname(dbPath());
		if (!fs.existsSync(storeDir)) {
			fs.mkdirSync(storeDir, { recursive: true });
		}
		forgeStore.init({ dbPath: dbPath() }, (err) => next(err, args));
	});

	taskList.push((args, next) => {
		require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({
			forgeStore,
			credentialAccessor,
		})((err, lifecycle) => next(err, { ...args, lifecycle }));
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		const lifecycle = args.lifecycle;
		const graphBuilder = require(GRAPH_BUILDER)({ forgeStore, lifecycle });
		const fingerprinter = fingerprinterFactory({ lifecycle });
		const differ = differFactory();
		const productionGuard = productionGuardFactory({ forgeStore });
		const baselineStore = baselineStoreFactory({ projectRoot });
		const gateSuite = gateSuiteFactory();
		const groundTruth = groundTruthFactory();
		callback('', {
			forgeStore,
			credentialAccessor,
			lifecycle,
			graphBuilder,
			fingerprinter,
			differ,
			productionGuard,
			baselineStore,
			gateSuite,
			groundTruth,
		});
	});
};

// =====================================================================
// BUILD-INTO-ISOLATED-TARGET — guard, clean, build, fingerprint. Reused by several actions.
// =====================================================================
// buildIsolated({resources, manifestKey, graphName, role, clean}, cb) -> { fingerprint, buildResult }
// productionGuard refuses a golden target BEFORE any docker work. clean=true tears the target down
// first (force, ephemeral) for a from-scratch build.

const buildIsolated = (
	{ resources, manifestKey, graphName, role = 'bronze', clean = true, ignoreEmbedding = false, scope = 'forgedNode' },
	callback,
) => {
	const { xLog } = process.global;
	const { graphBuilder, lifecycle, productionGuard, fingerprinter } = resources;
	const taskList = new taskListPlus();

	// N1 guard — refuse golden targets before touching docker
	taskList.push((args, next) => {
		productionGuard.assertSafeBuildTarget({ graphName }, (err) => next(err, args));
	});

	// clean slate: destroy any pre-existing instance (force; it is ephemeral scratch)
	taskList.push((args, next) => {
		if (!clean) {
			next('', args);
			return;
		}
		lifecycle.destroyInstanceByName({ graphName, force: true }, (err) => {
			// a "no graph named" refusal on a fresh target is not an error for our purposes; only
			// surface a real docker/registry failure. The guard never lets golden through here
			// because productionGuard already cleared the name above.
			if (err && !/no graph named|refused/i.test(`${err}`)) {
				next(`buildIsolated clean '${graphName}': ${err}`);
				return;
			}
			next('', args);
		});
	});

	// build (replay) the manifest into the isolated target
	taskList.push((args, next) => {
		xLog.status(`[edf-gate] building isolated graph '${graphName}' (role=${role}) from manifest ${manifestKey.slice(0, 12)}…`);
		graphBuilder.buildGraph(
			{ manifestKey, destination: graphName, role },
			(err, buildResult) => {
				if (err) {
					next(`buildIsolated build '${graphName}': ${err}`);
					return;
				}
				next('', { ...args, buildResult });
			},
		);
	});

	// fingerprint the freshly built graph
	taskList.push((args, next) => {
		fingerprinter.fingerprintGraph({ graphName, ignoreEmbedding, scope }, (err, fingerprint) => {
			if (err) {
				next(`buildIsolated fingerprint '${graphName}': ${err}`);
				return;
			}
			next('', { ...args, fingerprint });
		});
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		callback('', { fingerprint: args.fingerprint, buildResult: args.buildResult });
	});
};

// =====================================================================
// ACTION: -fingerprint
// =====================================================================

const handleFingerprint = (resources, callback) => {
	const { xLog } = process.global;
	const graphName = (commandLineParameters.values.graph || [])[0];
	const ignoreOwnerStamp = booleanFlag('ignoreOwnerStamp');
	const ignoreEmbedding = booleanFlag('ignoreEmbedding');
	// scope: 'forgedNode' (default) or 'all' (every node+edge except :GraphProvenance). -allScope or --scope=all.
	const scope = booleanFlag('allScope') || (commandLineParameters.values.scope || [])[0] === 'all'
		? 'all'
		: 'forgedNode';
	if (!graphName) {
		callback('edf-gate -fingerprint: --graph is required. Use -help.');
		return;
	}
	resources.fingerprinter.fingerprintGraph(
		{ graphName, ignoreOwnerStamp, ignoreEmbedding, scope },
		(err, result) => {
			if (err) {
				callback(err);
				return;
			}
			xLog.result(
				JSON.stringify(
					{
						action: 'fingerprint',
						graph: graphName,
						fingerprint: result.fingerprint,
						nodeFingerprint: result.nodeFingerprint,
						edgeFingerprint: result.edgeFingerprint,
						nodeCount: result.nodeCount,
						edgeCount: result.edgeCount,
						ignoreOwnerStamp: result.ignoreOwnerStamp,
						ignoreEmbedding: result.ignoreEmbedding,
						scope: result.scope,
					},
					null,
					2,
				),
			);
			callback('');
		},
	);
};

// =====================================================================
// ACTION: -proveDeterminism (THE KEYSTONE)
// =====================================================================

const handleProveDeterminism = (resources, callback) => {
	const { xLog } = process.global;
	const manifestKey = (commandLineParameters.values.manifest || [])[0];
	const targetA = (commandLineParameters.values.targetA || ['phase0a'])[0];
	const targetB = (commandLineParameters.values.targetB || ['phase0b'])[0];
	const keepGraphs = booleanFlag('keepGraphs');
	const ignoreEmbedding = booleanFlag('ignoreEmbedding');

	if (!manifestKey) {
		callback('edf-gate -proveDeterminism: --manifest is required. Use -help.');
		return;
	}

	const taskList = new taskListPlus();

	// build A
	taskList.push((args, next) => {
		buildIsolated(
			{ resources, manifestKey, graphName: targetA, role: 'bronze', clean: true, ignoreEmbedding },
			(err, resultA) => {
				if (err) { next(err); return; }
				xLog.status(`[edf-gate] A '${targetA}': ${resultA.fingerprint.nodeCount} nodes / ${resultA.fingerprint.edgeCount} edges -> ${resultA.fingerprint.fingerprint.slice(0, 16)}…`);
				next('', { ...args, resultA });
			},
		);
	});

	// build B (independent isolated graph, identical inputs)
	taskList.push((args, next) => {
		buildIsolated(
			{ resources, manifestKey, graphName: targetB, role: 'bronze', clean: true, ignoreEmbedding },
			(err, resultB) => {
				if (err) { next(err); return; }
				xLog.status(`[edf-gate] B '${targetB}': ${resultB.fingerprint.nodeCount} nodes / ${resultB.fingerprint.edgeCount} edges -> ${resultB.fingerprint.fingerprint.slice(0, 16)}…`);
				next('', { ...args, resultB });
			},
		);
	});

	// compare + diff
	taskList.push((args, next) => {
		const fpA = args.resultA.fingerprint;
		const fpB = args.resultB.fingerprint;
		// nonEmpty guard: two EMPTY graphs would have equal fingerprints and falsely report GREEN.
		// Determinism requires identical fingerprints AND non-empty content on both sides.
		const nonEmpty = fpA.nodeCount > 0 && fpB.nodeCount > 0;
		const deterministic = fpA.fingerprint === fpB.fingerprint && nonEmpty;
		const diff = resources.differ.diffManifests({
			baseline: fpA.elementManifest,
			candidate: fpB.elementManifest,
		});
		next('', { ...args, deterministic, nonEmpty, diff, fpA, fpB });
	});

	// optional teardown of the scratch graphs
	taskList.push((args, next) => {
		if (keepGraphs) {
			next('', args);
			return;
		}
		resources.lifecycle.destroyInstanceByName({ graphName: targetA, force: true }, () => {
			resources.lifecycle.destroyInstanceByName({ graphName: targetB, force: true }, () => {
				next('', args);
			});
		});
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		const verdict = !args.nonEmpty
			? 'INVALID (RED) — empty graph(s); refusing to call determinism on zero content'
			: args.deterministic
				? 'DETERMINISTIC (GREEN)'
				: 'NON-DETERMINISTIC (RED)';
		xLog.result(
			JSON.stringify(
				{
					action: 'proveDeterminism',
					manifest: manifestKey,
					verdict,
					deterministic: args.deterministic,
					nonEmpty: args.nonEmpty,
					ignoreEmbedding,
					targetA,
					targetB,
					fingerprintA: args.fpA.fingerprint,
					fingerprintB: args.fpB.fingerprint,
					nodeCountA: args.fpA.nodeCount,
					nodeCountB: args.fpB.nodeCount,
					edgeCountA: args.fpA.edgeCount,
					edgeCountB: args.fpB.edgeCount,
					diffSummary: args.diff.summary,
					diffIdentical: args.diff.identical,
					// when RED, the first slices of the structured diff make the cause concrete
					diffDetail: args.diff.identical
						? null
						: {
								nodes: {
									addedByLabel: args.diff.nodes.addedByLabel,
									removedByLabel: args.diff.nodes.removedByLabel,
									changedPropFrequency: args.diff.nodes.changedPropFrequency,
									sampleChanged: args.diff.nodes.changed.slice(0, 10),
								},
								edges: {
									addedByType: args.diff.edges.addedByType,
									removedByType: args.diff.edges.removedByType,
								},
							},
					graphsKept: keepGraphs,
				},
				null,
				2,
			),
		);
		callback('');
	});
};

// =====================================================================
// ACTION: -freezeBaseline
// =====================================================================

const handleFreezeBaseline = (resources, callback) => {
	const { xLog } = process.global;
	const manifestKey = (commandLineParameters.values.manifest || [])[0];
	const target = (commandLineParameters.values.target || ['phase0baseline'])[0];
	const fromGraph = (commandLineParameters.values.fromGraph || [])[0];
	const label = (commandLineParameters.values.label || ['golden'])[0];
	const keepGraph = booleanFlag('keepGraph');
	const ignoreEmbedding = booleanFlag('ignoreEmbedding');
	const scope = booleanFlag('allScope') || (commandLineParameters.values.scope || [])[0] === 'all'
		? 'all'
		: 'forgedNode';

	if (!fromGraph && !manifestKey) {
		callback(
			'edf-gate -freezeBaseline: provide --manifest (build a fresh baseline) or --fromGraph (freeze an existing isolated graph). Use -help.',
		);
		return;
	}

	const taskList = new taskListPlus();

	// either fingerprint an existing isolated graph (--fromGraph) or build a fresh one (--manifest)
	taskList.push((args, next) => {
		if (fromGraph) {
			resources.fingerprinter.fingerprintGraph(
				{ graphName: fromGraph, ignoreEmbedding, scope },
				(err, fingerprint) =>
					next(err, { ...args, built: { fingerprint, buildResult: null } }),
			);
			return;
		}
		buildIsolated(
			{ resources, manifestKey, graphName: target, role: 'bronze', clean: true, ignoreEmbedding, scope },
			(err, built) => next(err, { ...args, built }),
		);
	});

	taskList.push((args, next) => {
		resources.baselineStore.freezeBaseline(
			{
				label,
				manifestKey: manifestKey || `graph:${fromGraph}`,
				fingerprint: args.built.fingerprint,
				buildResult: args.built.buildResult,
			},
			(err, frozen) => next(err, { ...args, frozen }),
		);
	});

	taskList.push((args, next) => {
		if (keepGraph) {
			next('', args);
			return;
		}
		resources.lifecycle.destroyInstanceByName({ graphName: target, force: true }, () =>
			next('', args),
		);
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		xLog.result(
			JSON.stringify(
				{
					action: 'freezeBaseline',
					label,
					manifest: manifestKey,
					baselineFingerprint: args.built.fingerprint.fingerprint,
					nodeCount: args.built.fingerprint.nodeCount,
					edgeCount: args.built.fingerprint.edgeCount,
					snapshotFile: args.frozen.snapshotFile,
					immutable: args.frozen.immutable,
				},
				null,
				2,
			),
		);
		callback('');
	});
};

// =====================================================================
// RUN
// =====================================================================

// =====================================================================
// ACTION: -runSuite (the cumulative gate suite)
// =====================================================================

const handleRunSuite = (resources, callback) => {
	const { xLog } = process.global;
	const manifestKey =
		(commandLineParameters.values.manifest || [])[0] || null;
	const targetA = (commandLineParameters.values.targetA || ['phase0a'])[0];
	const targetB = (commandLineParameters.values.targetB || ['phase0b'])[0];
	const baselineLabel = (commandLineParameters.values.baselineLabel || ['golden'])[0];
	const reuseGraphs = booleanFlag('reuseGraphs');
	const ignoreEmbedding = booleanFlag('ignoreEmbedding');
	// optional phase filter: run only gates whose descriptor.phase matches (gateSuite supports it). Used
	// for isolated demonstrations (e.g. the CanonicalAddressing standing-gate twin).
	const phaseFilter = (commandLineParameters.values.phase || [])[0] || null;

	const taskList = new taskListPlus();

	// ensure both scratch graphs exist (the determinism + regression gates read them). Build fresh
	// unless --reuseGraphs and they already resolve. Requires --manifest when a build is needed.
	const ensureGraph = (graphName, ensureNext) => {
		resources.lifecycle.resolveAccessByName({ graphName }, (err, access) => {
			if (reuseGraphs && !err && access && access.location) {
				xLog.status(`[edf-gate] reusing existing graph '${graphName}'`);
				ensureNext('', { reused: true });
				return;
			}
			if (!manifestKey) {
				ensureNext(
					`-runSuite needs to build '${graphName}' but no --manifest was given (and --reuseGraphs not satisfied).`,
				);
				return;
			}
			buildIsolated(
				{ resources, manifestKey, graphName, role: 'bronze', clean: true },
				(buildErr) => ensureNext(buildErr, { reused: false }),
			);
		});
	};

	taskList.push((args, next) => {
		ensureGraph(targetA, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		ensureGraph(targetB, (err) => next(err, args));
	});

	taskList.push((args, next) => {
		const ctx = {
			resources,
			manifestKey,
			targetA,
			targetB,
			candidateGraphName: targetA,
			baselineLabel,
			ignoreEmbedding,
			groundTruth: resources.groundTruth,
		};
		resources.gateSuite.runSuite({ ctx, phaseFilter }, (err, suiteResult) =>
			next(err, { ...args, suiteResult }),
		);
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		const { suiteResult } = args;
		xLog.result(
			JSON.stringify(
				{
					action: 'runSuite',
					verdict: suiteResult.green ? 'GREEN' : 'RED',
					green: suiteResult.green,
					summary: suiteResult.summary,
					gates: suiteResult.results,
				},
				null,
				2,
			),
		);
		callback('');
	});
};

// =====================================================================
// ACTION: -diff (baseline snapshot vs a candidate graph)
// =====================================================================

const handleDiff = (resources, callback) => {
	const { xLog } = process.global;
	const baselineLabel = (commandLineParameters.values.baselineLabel || ['golden'])[0];
	const candidateGraph = (commandLineParameters.values.candidateGraph || [])[0];
	const ignoreEmbedding = booleanFlag('ignoreEmbedding');
	if (!candidateGraph) {
		callback('edf-gate -diff: --candidateGraph is required. Use -help.');
		return;
	}

	const taskList = new taskListPlus();

	taskList.push((args, next) => {
		resources.baselineStore.readBaseline({ label: baselineLabel }, (err, baseline) =>
			next(err ? `-diff: ${err}` : '', { ...args, baseline }),
		);
	});

	taskList.push((args, next) => {
		resources.fingerprinter.fingerprintGraph(
			{ graphName: candidateGraph, ignoreEmbedding },
			(err, fingerprint) => next(err ? `-diff: ${err}` : '', { ...args, fingerprint }),
		);
	});

	taskList.push((args, next) => {
		const diff = resources.differ.diffManifests({
			baseline: args.baseline.snapshot.elementManifest,
			candidate: args.fingerprint.elementManifest,
		});
		next('', { ...args, diff });
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		xLog.result(
			JSON.stringify(
				{
					action: 'diff',
					baselineLabel,
					candidateGraph,
					baselineFingerprint: args.baseline.meta.fingerprint,
					candidateFingerprint: args.fingerprint.fingerprint,
					identical: args.diff.identical,
					summary: args.diff.summary,
					detail: args.diff.identical
						? null
						: {
								nodes: {
									addedByLabel: args.diff.nodes.addedByLabel,
									removedByLabel: args.diff.nodes.removedByLabel,
									changedPropFrequency: args.diff.nodes.changedPropFrequency,
								},
								edges: {
									addedByType: args.diff.edges.addedByType,
									removedByType: args.diff.edges.removedByType,
								},
							},
				},
				null,
				2,
			),
		);
		callback('');
	});
};

const actionRegistry = {
	fingerprint: handleFingerprint,
	proveDeterminism: handleProveDeterminism,
	freezeBaseline: handleFreezeBaseline,
	runSuite: handleRunSuite,
	diff: handleDiff,
};

const run = () => {
	const switches = commandLineParameters.switches || {};
	if (switches.help || switches.h || Object.keys(switches).length === 0) {
		console.log(helpText());
		process.exit(0);
		return;
	}

	bootstrapGlobal();
	const { xLog } = process.global;

	const actionName = Object.keys(actionRegistry).find((name) => switches[name]);
	if (!actionName) {
		xLog.error(
			'edf-gate: unknown action. Actions: -fingerprint, -proveDeterminism, -freezeBaseline, -runSuite, -diff. Use -help.',
		);
		process.exit(1);
		return;
	}

	buildSharedResources((resourceErr, resources) => {
		if (resourceErr) {
			xLog.error(`edf-gate: ${resourceErr}`);
			process.exit(1);
			return;
		}
		actionRegistry[actionName](resources, (err) => {
			if (err) {
				xLog.error(`edf-gate: ${err}`);
				process.exit(1);
				return;
			}
			process.exit(0);
		});
	});
};

run();
