#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edfReplay.js — the `edf-replay` CLI (replayManager, Phase 4). The single block<->graph
// boundary, BOTH directions (helpSpec.md — the control surface IS the contract):
//
//   edf-replay -buildGraph    --manifest=<manifestKey> --destination=<bronze|golden|user>
//                             [--owner=<:golden|:user>]
//   edf-replay -extractSchema --from=<graphName> --selector=<standard|relationships|overlay>
//                             [--subject=<standardKey>] [--out=<path>] [--tearDown] [--force]
//
// 3-layer orchestrator:
//   Layer 1 (this file): bootstrap process.global; instantiate shared resources (forge-store,
//     credential-accessor, instance-lifecycle); registry-dispatch the action.
//   Layer 2 (lib/): graph-builder (-buildGraph), schema-extractor (-extractSchema).
//   The Phase-2 replay engine + 1B instance-lifecycle + 1A forge-store are REQUIRED, not rebuilt.
//
// THE MANIFEST -> BLOCKS READ PATH IS forge-store (getManifest->deriveBuildOrder->getBlock); this
// CLI holds NO raw SQL and never shells out to manifestEditor (the writer). Graph access (bolt +
// credential) is resolved BY NAME via the 1B lifecycle/credential-accessor — never on the command
// line. NEVER tears down on an error path (DECISIONS §14): teardown is a deliberate success-path
// -extractSchema --tearDown only, guarded to refuse golden/non-ephemeral unless --force.
//
// Action flags single-hyphen (-buildGraph); parameters double-hyphen (--manifest=...).
//
// Async style: qtools taskListPlus/pipeRunner; engine/neo4j resolve at the leaf. No async/await,
// no try/catch-for-control-flow, no Promises surfaced. camelCase only.

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

const graphBuilderFactory = require('./lib/graph-builder');
const schemaExtractorFactory = require('./lib/schema-extractor');

// =====================================================================
// HELP TEXT — matches specification/replayManager/helpSpec.md (the control surface IS the contract)
// =====================================================================

const helpText = () => `
NAME
     edf-replay -- replayManager: the single block<->graph boundary, both directions

SYNOPSIS
     edf-replay -buildGraph    --manifest=<manifestKey> --destination=<bronze|golden|user>
                               [--owner=<:golden|:user>] [--skipFinishing]
     edf-replay -extractSchema --from=<graphName> --selector=<standard|relationships|overlay>
                               [--subject=<standardKey>] [--out=<path>] [--tearDown] [--force]

DESCRIPTION
     replayManager computes graphs from manifests and extracts schemaBlocks from graphs. It holds
     no SQL (the manifest->blocks read path is forge-store) and no credential knowledge (graph
     access is resolved from the registry BY NAME). Replay is idempotent and deterministic:
     graph CONTENT (every :ForgedNode node + its edges) == replay(goldenManifest). Content equality
     EXCLUDES the single :GraphProvenance passport node that -buildGraph stamps into every graph
     (its builtAt is non-deterministic) — equality/diff queries scope to (:ForgedNode), never bare
     (n). (Option A, SPEC-graphProvenanceNode-062026.md.)

     Action flags take a single hyphen; parameters take a double hyphen.

COMMANDS
     -buildGraph     CREATE + register the destination instance, resolve the manifest's ordered
                     blocks (CEDS-first topo), replay them in, run the FINISHING phase (the
                     replayManager finisher registry — schema view + structural constraints, sourced
                     from the vocabulary registry, NOT the manifest), stamp every node/edge --owner,
                     and finally stamp ONE :GraphProvenance passport node (graph-level provenance,
                     history + status) — excluded from content equality (Option A). --skipFinishing
                     yields a raw/unconstrained graph (no finisher output).
     -extractSchema  Serialize part of a live graph back out as exactly one PG-JSONL schemaBlock.

OPTIONS
     --manifest=<manifestKey>        The manifest to materialize.
     --destination=<bronze|golden|user>  Where to materialize.
     --owner=<:golden|:user>         ownerStamp. Defaults from --destination (golden -> :golden,
                                     otherwise :user). Override allowed.
     --skipFinishing                 (-buildGraph) GLOBAL skip switch for the finishing phase: build a
                                     raw graph with NO finisher output (no schema view, no constraints).
     --from=<graphName>              (-extractSchema) The live graph to read from.
     --selector=<standard|relationships|overlay>
                                     standard = one standard's nodes + internal edges;
                                     relationships = cross-standard bridge edges ONLY (0 nodes);
                                     overlay = a tenant's delta.
     --subject=<standardKey>         (-extractSchema, selector=standard|overlay) which standard.
     --out=<path>                    (-extractSchema) write the block to a file instead of stdout.
     --tearDown                      (-extractSchema) after a SUCCESSFUL extract, destroy the
                                     (ephemeral) source instance + drop its registry row. Guarded:
                                     refuses golden/non-ephemeral unless --force. NEVER on error.
     --force                         override the teardown guard.

OUTPUT
     -buildGraph     The materialized graph + a danglingRefs report + the :GraphProvenance passport.
     -extractSchema  One schemaBlock as PG-JSONL (stdout by default, or --out).
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
// SHARED RESOURCES — open forge-store, build credential-accessor + lifecycle.
// =====================================================================

// EDF_FORGE_STORE_DB redirects the store (test harnesses); absent -> canonical, byte-identical.
// An active override is ANNOUNCED on stderr so it can never silently redirect production writes.
const dbPath = () =>
	process.env.EDF_FORGE_STORE_DB ||
	path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');
if (process.env.EDF_FORGE_STORE_DB) {
	console.error(
		`STORE OVERRIDE ACTIVE: forgeStore db = ${dbPath()} (EDF_FORGE_STORE_DB)`,
	);
}

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
// ACTION HANDLERS (registry, not switch)
// =====================================================================

const handleBuildGraph = ({ forgeStore, lifecycle }, callback) => {
	const { xLog } = process.global;

	const manifestKey = (commandLineParameters.values.manifest || [])[0];
	const destination = (commandLineParameters.values.destination || [])[0];
	const owner = (commandLineParameters.values.owner || [])[0];
	// --skipFinishing / -skipFinishing — the GLOBAL finishing skip switch (Phase 7). Accept both the
	// single-hyphen switch form and the valueless double-hyphen form (qtools lands the latter as ===true).
	const skipFinishing =
		!!commandLineParameters.switches.skipFinishing ||
		commandLineParameters.values.skipFinishing === true ||
		(Array.isArray(commandLineParameters.values.skipFinishing) &&
			commandLineParameters.values.skipFinishing[0] === true);

	if (!manifestKey) {
		callback('edf-replay -buildGraph: --manifest is required. Use -help.');
		return;
	}
	if (!destination) {
		callback('edf-replay -buildGraph: --destination is required. Use -help.');
		return;
	}

	// the control surface names the destination by its ROLE token (bronze|golden|user), which is
	// ALSO the graph name for the first app — so role === destination here. (A future tenant-named
	// build would split these; graph-builder already supports a distinct `role`.)
	const graphBuilder = graphBuilderFactory({ forgeStore, lifecycle });
	graphBuilder.buildGraph(
		{ manifestKey, destination, owner, role: destination, skipFinishing },
		(err, result) => {
			if (err) {
				callback(err);
				return;
			}
			xLog.result(
				JSON.stringify(
					{
						action: 'buildGraph',
						destination: result.destination,
						location: result.location,
						owner: result.owner,
						blockCount: result.blockCount,
						nodesMerged: result.replayResult.nodesMerged,
						edgesMerged: result.replayResult.edgesMerged,
						danglingRefs: (result.replayResult.danglingRefs || []).length,
						indexesBuilt: result.replayResult.indexesBuilt,
						finishing: result.finishResult,
						ownerStamped: result.ownerStampResult,
						graphProvenance: result.provenanceResult,
					},
					null,
					2,
				),
			);
			callback('');
		},
	);
};

const handleExtractSchema = ({ lifecycle }, callback) => {
	const { xLog } = process.global;

	const from = (commandLineParameters.values.from || [])[0];
	const selector = (commandLineParameters.values.selector || [])[0];
	const subject = (commandLineParameters.values.subject || [])[0];
	const out = (commandLineParameters.values.out || [])[0];
	// --tearDown / --force are boolean flags. qtools lands a valueless `--x` as either a switch
	// (single-hyphen -x, or when followed by another flag) or values.x===true (double-hyphen at
	// end of args). Accept BOTH so `-tearDown`, `--tearDown`, `-force`, `--force` all work.
	const booleanFlag = (name) =>
		!!commandLineParameters.switches[name] ||
		commandLineParameters.values[name] === true ||
		(Array.isArray(commandLineParameters.values[name]) &&
			commandLineParameters.values[name][0] === true);
	const tearDown = booleanFlag('tearDown');
	const force = booleanFlag('force');

	if (!from) {
		callback('edf-replay -extractSchema: --from is required. Use -help.');
		return;
	}
	if (!selector) {
		callback('edf-replay -extractSchema: --selector is required. Use -help.');
		return;
	}

	const schemaExtractor = schemaExtractorFactory({ lifecycle });

	const taskList = new taskListPlus();

	// resolve access BY NAME (bolt + credential from the registry — never the command line)
	taskList.push((args, next) => {
		lifecycle.resolveAccessByName({ graphName: from }, (err, access) => {
			if (err) {
				next(`edf-replay -extractSchema: ${err}`);
				return;
			}
			next('', { ...args, access });
		});
	});

	// serialize EXACTLY ONE block
	taskList.push((args, next) => {
		schemaExtractor.extractSchema(
			{ access: args.access, from, selector, subject },
			(err, extractResult) => {
				if (err) {
					next(err);
					return;
				}
				next('', { ...args, extractResult });
			},
		);
	});

	// emit the block: --out file, else stdout (stdout is permitted, DECISIONS §14)
	taskList.push((args, next) => {
		const { blockText } = args.extractResult;
		if (out) {
			fs.writeFileSync(out, blockText);
			xLog.status(`[edf-replay] wrote block to ${out}`);
		} else {
			xLog.result(blockText);
		}
		next('', args);
	});

	// SUCCESS-PATH teardown ONLY (guarded). The guard lives in 1B destroyInstanceByName, which
	// refuses a non-ephemeral/golden graph unless force===true. This task runs only because the
	// extract above SUCCEEDED — teardown is NEVER on the error path (DECISIONS §14).
	taskList.push((args, next) => {
		if (!tearDown) {
			next('', { ...args, teardownResult: null });
			return;
		}
		lifecycle.destroyInstanceByName(
			{ graphName: from, force },
			(err, destroyResult) => {
				if (err) {
					// a teardown-guard refusal is a real, surfaced error AFTER a successful extract;
					// the block has already been emitted, so the extract itself stands.
					next(`edf-replay -extractSchema --tearDown: ${err}`);
					return;
				}
				xLog.status(`[edf-replay] tore down source instance '${from}'`);
				next('', { ...args, teardownResult: destroyResult });
			},
		);
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		const { extractResult, teardownResult } = args;
		xLog.status(
			JSON.stringify(
				{
					action: 'extractSchema',
					from,
					selector,
					subject: subject || null,
					nodeCount: extractResult.nodeCount,
					edgeCount: extractResult.edgeCount,
					out: out || '(stdout)',
					tornDown: !!teardownResult,
				},
				null,
				2,
			),
		);
		callback('');
	});
};

const actionRegistry = {
	buildGraph: handleBuildGraph,
	extractSchema: handleExtractSchema,
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
			'edf-replay: unknown action. Actions are -buildGraph and -extractSchema. Use -help.',
		);
		process.exit(1);
		return;
	}

	buildSharedResources((resourceErr, resources) => {
		if (resourceErr) {
			xLog.error(`edf-replay: ${resourceErr}`);
			process.exit(1);
			return;
		}
		actionRegistry[actionName](resources, (err) => {
			if (err) {
				// NEVER tear down on error (DECISIONS §14).
				xLog.error(`edf-replay: ${err}`);
				process.exit(1);
				return;
			}
			process.exit(0);
		});
	});
};

run();
