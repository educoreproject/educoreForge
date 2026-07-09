#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edfForge.js — the `edf-forge` CLI (forger, the first app). 3-layer orchestrator:
//   Layer 1 (this file): bootstrap process.global; instantiate shared resources (forge-store,
//     credential-accessor, instance-lifecycle, embedding-client); dispatch the -forge action.
//   Layer 2 (lib/): standard-registry (registry, not switch), materializer.
//   Layer 3: the per-standard forge bundle resolved from --standardName (e.g. lib.d/forge-ceds).
//
//   edf-forge -forge --standardName=<key> --source=<path> --destination=<graphName>
//             [--owner=<:golden|:user>]
//
// The control surface IS the contract (helpSpec.md). Action flags single-hyphen (-forge);
// parameter flags double-hyphen (--standardName=...). PURE forge -> materialize.
//
// SECRET: the Voyage key is read ONLY by the embedding-client from voyageEmbedding.ini via
// qtools-config-file-processor; it is never on the command line, in env, logged, or echoed here.
//
// Async style: qtools taskListPlus/pipeRunner; leaves resolve at the leaf. No async/await, no
// try/catch-for-control-flow. camelCase only.

const path = require('path');
const os = require('os');

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
const VOYAGE_CONFIG_PATH = path.join(
	CONFIGS_DIR,
	'instanceSpecific',
	'qbook',
	'voyageEmbedding.ini',
);

const standardRegistry = require('./lib/standard-registry');

// =====================================================================
// HELP TEXT — matches specification/forger/helpSpec.md (the control surface IS the contract)
// =====================================================================

const helpText = () => `
NAME
     edf-forge -- run a per-standard forge to produce a single-standard graph

SYNOPSIS
     edf-forge -forge --standardName=<standardKey> --source=<path>
                      --destination=<graphName> [--owner=<:golden|:user>]

DESCRIPTION
     edf-forge executes a standard/parser bundle (a forge in lib.d/) over a standard's source
     data and produces that standard's graph: its nodes (carrying the universal property
     contract) plus its internal edges. Embeddings are written by a library call as the nodes
     are written. The forge is PURE and deterministic for a given (source, standardName).

     The graph it produces is a single-standard VALIDATION graph (human-inspectable).

     Action flags take a single hyphen; parameters take a double hyphen.

COMMANDS
     -forge
            Parse the source with the forge module (resolved from --standardName) and
            materialize the single-standard graph at the destination.

OPTIONS
     --standardName=<standardKey>
            The standard being forged (e.g. CEDS). The per-standard forge module in lib.d/ is
            resolved from this name via a registry.   Known: ${standardRegistry
				.knownStandardNames()
				.join(', ')}

     --source=<path>
            The standard's source data (the parser bundle's input). Optional — defaults to the
            bundle's bundled source asset.

     --destination=<graphName>
            Where the validation graph materializes. Access is resolved from the graph registry
            by name (bolt location + credential, stored in the DB); not passed here.

     --owner=<:golden|:user>
            ownerStamp for the produced nodes/edges. Default :golden.

OUTPUT
     A materialized single-standard validation graph. Its nodes carry _id, _source, name,
     description, searchText, the stable identifier (uri), role, and an embedding.
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

	// getConfig over the project configs dir; falls back to {} for unknown sections.
	let wholeConfig = {};
	const hostConfigName =
		os.hostname() === 'qMax.local' || os.hostname() === 'qbook.local'
			? 'instanceSpecific/qbook'
			: '';
	const configDirPath = path.join(CONFIGS_DIR, hostConfigName);
	const systemIni = path.join(configDirPath, 'systemParameters.ini');
	const fs = require('fs');
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
// RUN
// =====================================================================

const run = () => {
	if (
		commandLineParameters.switches.help ||
		commandLineParameters.switches.h ||
		(!commandLineParameters.switches.forge &&
			Object.keys(commandLineParameters.switches).length === 0)
	) {
		console.log(helpText());
		process.exit(0);
		return;
	}

	bootstrapGlobal();
	const { xLog } = process.global;

	if (!commandLineParameters.switches.forge) {
		xLog.error(
			`edf-forge: unknown action. The only action is -forge. Use -help for usage.`,
		);
		process.exit(1);
		return;
	}

	const standardName = (commandLineParameters.values.standardName || [])[0];
	const source = (commandLineParameters.values.source || [])[0];
	const destination = (commandLineParameters.values.destination || [])[0];
	const ownerFlag = (commandLineParameters.values.owner || [])[0];
	const owner = ownerFlag || ':golden';

	if (!standardName) {
		xLog.error('edf-forge: --standardName is required. Use -help.');
		process.exit(1);
		return;
	}
	if (!destination) {
		xLog.error('edf-forge: --destination is required. Use -help.');
		process.exit(1);
		return;
	}

	// resolve the forge bundle from the registry (registry, not switch)
	const resolved = standardRegistry.resolveBundle({ standardName });
	if (resolved.error) {
		xLog.error(`edf-forge: ${resolved.error}`);
		process.exit(1);
		return;
	}
	const sourcePath = source || resolved.defaultSource;

	// shared resources
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	const credentialAccessor = require(path.join(
		CORE_LIB,
		'credential-accessor',
		'credential-accessor',
	))({ forgeStore });
	const embedder = require(path.join(CORE_LIB, 'embedding', 'embedding-client'))({
		configFilePath: VOYAGE_CONFIG_PATH,
	});

	// embedding sidecar (PLAN §3.4): the per-standard vector store + the caching-embedder DECORATOR
	// that wraps the raw embedder at the single injection point below. The decorator interns identical
	// searchText inputs to ONE embed call + ONE stored row and is the AUTHORITATIVE store writer on a
	// fresh forge (F4). The store path is derived via the SHARED helper (F3) — the SAME file the
	// extract path reads/writes for this standard. The forge keeps stamping INLINE embeddings on nodes
	// (F2); the block-format embeddingRef change is the extract path's job, not the forge's.
	const vectorStore = require(path.join(CORE_LIB, 'vector-store', 'vector-store'))();
	const vectorStorePath = require(path.join(
		CORE_LIB,
		'vector-store',
		'vector-store-path',
	))();
	const vectorStoreDbPath = vectorStorePath.vectorStoreDbPathForStandard({
		projectRoot,
		standardKey: resolved.standardName,
	});
	if (process.env.EDF_FORGE_VECTORSTORE_DIR) {
		console.error(
			`VECTORSTORE OVERRIDE ACTIVE: dir = ${process.env.EDF_FORGE_VECTORSTORE_DIR} (EDF_FORGE_VECTORSTORE_DIR)`,
		);
	}
	const cachingEmbedder = require(path.join(CORE_LIB, 'embedding', 'caching-embedder'))({
		embedder,
		vectorStore,
	});

	// EDF_FORGE_STORE_DB redirects the store (test harnesses); absent -> canonical, byte-identical.
	// An active override is ANNOUNCED on stderr so it can never silently redirect production writes.
	const dbPath =
		process.env.EDF_FORGE_STORE_DB ||
		path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');
	if (process.env.EDF_FORGE_STORE_DB) {
		console.error(
			`STORE OVERRIDE ACTIVE: forgeStore db = ${dbPath} (EDF_FORGE_STORE_DB)`,
		);
	}

	const taskList = new taskListPlus();

	// open the forge store
	taskList.push((args, next) => {
		const fs = require('fs');
		const storeDir = path.dirname(dbPath);
		if (!fs.existsSync(storeDir)) {
			fs.mkdirSync(storeDir, { recursive: true });
		}
		forgeStore.init({ dbPath }, (err) => next(err, args));
	});

	// open the per-standard vector sidecar store (the decorator fills it during the embed pass)
	taskList.push((args, next) => {
		const fs = require('fs');
		const vectorStoreDir = path.dirname(vectorStoreDbPath);
		if (!fs.existsSync(vectorStoreDir)) {
			fs.mkdirSync(vectorStoreDir, { recursive: true });
		}
		vectorStore.init({ dbPath: vectorStoreDbPath }, (err) => next(err, args));
	});

	// build the shared instance-lifecycle (provisions/owns the validation graph)
	taskList.push((args, next) => {
		require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({
			forgeStore,
			credentialAccessor,
		})((err, lifecycle) => next(err, { ...args, lifecycle }));
	});

	// run the resolved forge bundle (Layer 3)
	taskList.push((args, next) => {
		const bundle = resolved.bundleFactory({ embedder: cachingEmbedder });
		xLog.status(
			`edf-forge: forging ${resolved.standardName} from ${sourcePath} -> graph '${destination}' (owner ${owner})`,
		);
		bundle.forge({ sourcePath, owner }, (err, forged) => {
			if (err) {
				next(`edf-forge forge failed: ${err}`);
				return;
			}
			xLog.status(
				`edf-forge: forged ${forged.nodes.length} nodes, ${forged.edges.length} edges (${forged.embedCallCount} embedding calls)`,
			);
			next('', { ...args, forged });
		});
	});

	// materialize (serialize block -> provision graph -> replay)
	taskList.push((args, next) => {
		const materializer = require('./lib/materializer')({
			lifecycle: args.lifecycle,
		});
		materializer.materialize(
			{ forged: args.forged, destination },
			(err, result) => {
				if (err) {
					next(err);
					return;
				}
				next('', { ...args, materializeResult: result });
			},
		);
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			// NEVER tear down on error (DECISIONS §14).
			xLog.error(`edf-forge: ${err}`);
			process.exit(1);
			return;
		}
		const { materializeResult, forged } = args;
		xLog.result(
			JSON.stringify(
				{
					standardName: resolved.standardName,
					destination: materializeResult.destination,
					location: materializeResult.location,
					nodeCount: materializeResult.nodeCount,
					edgeCount: materializeResult.edgeCount,
					nodesMerged: materializeResult.replayResult.nodesMerged,
					edgesMerged: materializeResult.replayResult.edgesMerged,
					danglingRefs: (materializeResult.replayResult.danglingRefs || []).length,
					indexesBuilt: materializeResult.replayResult.indexesBuilt,
				},
				null,
				2,
			),
		);
		process.exit(0);
	});
};

run();
