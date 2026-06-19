#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edfBridge.js — the `edf-bridge` CLI (bridgeMaker, Phase 5). ONE app, THREE modes selected by
// flag and dispatched through a registry (NOT a switch). It mutates a working graph by MERGING
// cross-standard mapping edges of ONE provenance tier (helpSpec.md — the control surface IS the
// contract):
//
//   edf-bridge -specified --graph=<graphName> --scope=<standardKey> [--owner=<:golden|:user>]
//   edf-bridge -derived   --graph=<graphName> --scope=<standardKey>
//                         [--crosswalk=<lib.d/crosswalk-name>] [--source=<path>] [--owner=...]
//   edf-bridge -implied   --graph=<graphName> --scope=<standardKey> [--owner=<:golden|:user>]
//
// 3-layer orchestrator (mirrors edf-replay / edf-forge):
//   Layer 1 (this file): bootstrap process.global; instantiate shared resources (forge-store,
//     credential-accessor, instance-lifecycle); registry-dispatch the action.
//   Layer 2 (lib/): specified-bridge (-specified), derived-bridge (-derived STUB), implied-bridge
//     (-implied). The 1B instance-lifecycle is REQUIRED, not rebuilt — graph access (bolt +
//     credential) resolves BY NAME from the registry, never on the command line.
//
// GENERIC, no per-standard code: each maker reads the standard's mappingInstruction (declarative
// data on its DmeStandardRoot node) to know how to bridge. The forge already normalized native CEDS
// crossRefs into a canonical cedsId; -specified resolves on cedsId (reading the mappingInstruction's
// cedsOriginalAnchorPropertyName only to KNOW the origin, never to resolve).
//
// Idempotent MERGE on the resolved endpoint PAIR; existing pairs in scope are NOT re-bridged.
// Unresolved endpoints -> an orphan report (same discipline as replay — never a partial edge).
//
// Action flags single-hyphen (-specified); parameters double-hyphen (--graph=...).
//
// Async style: qtools taskListPlus/pipeRunner; neo4j resolves at the leaf. No async/await, no
// try/catch-for-control-flow, no Promises surfaced. camelCase only.

const path = require('path');
const os = require('os');
const fs = require('fs');

const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();
const configFileProcessor = require('qtools-config-file-processor');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// --------------------------------------------------------------------------------
// PROJECT ROOT + PATHS
const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();

const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CONFIGS_DIR = path.join(projectRoot, 'configs');

const specifiedBridgeFactory = require('./lib/specified-bridge');
const derivedBridgeFactory = require('./lib/derived-bridge');
const impliedBridgeFactory = require('./lib/implied-bridge');

// =====================================================================
// HELP TEXT — matches specification/bridgeMaker/helpSpec.md (control surface IS the contract)
// =====================================================================

const helpText = () => `
NAME
     edf-bridge -- bridgeMaker: add cross-standard mapping edges of one provenance tier to a graph

SYNOPSIS
     edf-bridge -specified --graph=<graphName> --scope=<standardKey> [--owner=<:golden|:user>]
     edf-bridge -derived   --graph=<graphName> --scope=<standardKey>
                           [--crosswalk=<lib.d/crosswalk-name>] [--source=<path>] [--owner=...]
     edf-bridge -implied   --graph=<graphName> --scope=<standardKey> [--owner=<:golden|:user>]

DESCRIPTION
     bridgeMaker mutates a working graph by MERGING cross-standard mapping edges of ONE provenance
     tier. It is generic: it reads each standard's mappingInstruction (declarative data on the
     DmeStandardRoot node) and contains NO per-standard code.

     The three modes run in a fixed order -- -specified, then -derived, then -implied -- because
     -implied calibrates on, and skips, the items the two deterministic tiers already covered.

     Action flags take a single hyphen; parameters take a double hyphen.

COMMANDS (modes)
     -specified  Deterministic anchor pass. Flat exact identity (native crossRef -> cedsId),
                 confidence 1.0, NO matchPredicate. Emits SPECIFIED_MAPPING.
     -derived    STUB (DECISIONS-firstApp §18; DESM unknown). Wires the flags, reads --scope, and
                 NO-OPs -- discovers nothing, invents no crosswalk. Logs 'derived: stubbed'.
     -implied    findMappedItem search. Runs LAST, only on items not already covered by
                 SPECIFIED/DERIVED. Stage-1 embedding retrieve adapted from trackA; Stage-2
                 (rerank/calibrate) is [PINNED-DEFERRED] and stubbed. Emits IMPLIED_MAPPING when
                 it emits, with calibrated confidence + matchPredicate.

OPTIONS
     --graph=<graphName>     The working graph to mutate (access resolved from the registry by name).
     --scope=<standardKey>   Bridge THIS standard against the rest -- not the whole graph. Existing
                             pairs are not re-bridged.
     --crosswalk=<name>      (-derived) The pluggable crosswalk module. Default: resolved from --scope.
     --source=<path>         (-derived) The external crosswalk artifact the module parses.
     --owner=<:golden|:user> ownerStamp for the emitted edges. Default :golden.

OUTPUT
     Edges merged into --graph (a mutation, not a new graph), plus per-tier bridge counts.
     Idempotent MERGE on the resolved endpoint pair; unresolved endpoints go to an orphan report.

NOTES
     matchPredicate  Stored ONLY on -derived and -implied edges, never -specified.
     provenanceTier  -specified stamps 'spec-authoritative'; -implied stamps 'embedding-inferred'.
`;

// =====================================================================
// BOOTSTRAP process.global (the universals triad)
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
// SHARED RESOURCES — open forge-store, build credential-accessor + lifecycle (mirrors edf-replay).
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
		callback('', { forgeStore, credentialAccessor, lifecycle: args.lifecycle });
	});
};

// =====================================================================
// COMMON OPTION READING — every mode shares --graph/--scope/--owner.
// =====================================================================

const readCommonOptions = () => {
	const graphName = (commandLineParameters.values.graph || [])[0];
	const scope = (commandLineParameters.values.scope || [])[0];
	const owner = (commandLineParameters.values.owner || [])[0] || ':golden';
	return { graphName, scope, owner };
};

const requireGraphAndScope = ({ graphName, scope }, actionLabel, callback) => {
	if (!graphName) {
		callback(`edf-bridge ${actionLabel}: --graph is required. Use -help.`);
		return false;
	}
	if (!scope) {
		callback(`edf-bridge ${actionLabel}: --scope is required. Use -help.`);
		return false;
	}
	return true;
};

// emit the canonical per-mode result blob (counts + orphan report) on stdout.
const emitResult = (xLog, blob) => {
	xLog.result(JSON.stringify(blob, null, 2));
};

// =====================================================================
// ACTION HANDLERS (registry, not switch)
// =====================================================================

const handleSpecified = ({ lifecycle }, callback) => {
	const { xLog } = process.global;
	const options = readCommonOptions();
	if (!requireGraphAndScope(options, '-specified', callback)) {
		return;
	}

	const specifiedBridge = specifiedBridgeFactory({ lifecycle });
	specifiedBridge.bridge(
		{ graphName: options.graphName, scope: options.scope, owner: options.owner },
		(err, result) => {
			if (err) {
				callback(err);
				return;
			}
			emitResult(xLog, {
				action: 'specified',
				graph: options.graphName,
				scope: options.scope,
				owner: options.owner,
				edgesMerged: result.edgesMerged,
				pairsAlreadyBridged: result.pairsAlreadyBridged,
				anchorsConsidered: result.anchorsConsidered,
				orphanCount: result.orphans.length,
				orphans: result.orphans,
			});
			callback('');
		},
	);
};

const handleDerived = ({ lifecycle }, callback) => {
	const { xLog } = process.global;
	const options = readCommonOptions();
	if (!requireGraphAndScope(options, '-derived', callback)) {
		return;
	}

	// -derived flags exist on the surface (helpSpec) but the stub reads --scope and no-ops.
	const crosswalk = (commandLineParameters.values.crosswalk || [])[0];
	const source = (commandLineParameters.values.source || [])[0];

	const derivedBridge = derivedBridgeFactory({ lifecycle });
	derivedBridge.bridge(
		{ graphName: options.graphName, scope: options.scope, owner: options.owner, crosswalk, source },
		(err, result) => {
			if (err) {
				callback(err);
				return;
			}
			emitResult(xLog, {
				action: 'derived',
				graph: options.graphName,
				scope: options.scope,
				stubbed: result.stubbed,
				edgesMerged: result.edgesMerged,
				note: result.note,
			});
			callback('');
		},
	);
};

const handleImplied = ({ lifecycle }, callback) => {
	const { xLog } = process.global;
	const options = readCommonOptions();
	if (!requireGraphAndScope(options, '-implied', callback)) {
		return;
	}

	const impliedBridge = impliedBridgeFactory({ lifecycle });
	impliedBridge.bridge(
		{ graphName: options.graphName, scope: options.scope, owner: options.owner },
		(err, result) => {
			if (err) {
				callback(err);
				return;
			}
			emitResult(xLog, {
				action: 'implied',
				graph: options.graphName,
				scope: options.scope,
				owner: options.owner,
				stageTwoStubbed: result.stageTwoStubbed,
				candidatesRetrieved: result.candidatesRetrieved,
				edgesMerged: result.edgesMerged,
				note: result.note,
			});
			callback('');
		},
	);
};

const actionRegistry = {
	specified: handleSpecified,
	derived: handleDerived,
	implied: handleImplied,
};

// =====================================================================
// RUN
// =====================================================================

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
			'edf-bridge: unknown action. Actions are -specified, -derived, -implied. Use -help.',
		);
		process.exit(1);
		return;
	}

	buildSharedResources((resourceErr, resources) => {
		if (resourceErr) {
			xLog.error(`edf-bridge: ${resourceErr}`);
			process.exit(1);
			return;
		}
		actionRegistry[actionName](resources, (err) => {
			if (err) {
				xLog.error(`edf-bridge: ${err}`);
				process.exit(1);
				return;
			}
			process.exit(0);
		});
	});
};

run();
