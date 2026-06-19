#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edfForgeManager.js — the `edf-forge-manager` CLI (forgeManager, Phase 6). The ORCHESTRATOR:
// it owns the ordered workflows and NOTHING else (helpSpec — "Thin by mandate"). Each command is a
// sequence of shell-outs (by ABSOLUTE PATH to each component entry .js) to forger / replayManager /
// bridgeMaker / manifestEditor, plus cross-step invariant enforcement and the publish/rollback/list
// store bookkeeping that no component CLI owns. NO domain logic, NO neo4j, NO raw forge SQL.
//
// 3-layer orchestrator (mirrors edf-forge / edf-replay / edf-bridge):
//   Layer 1 (this file): bootstrap process.global; resolve the canonical store path + component
//     entry paths; instantiate shared resources (sub-cli shell-out helper, store-access view);
//     registry-dispatch the action (registry, NOT a switch).
//   Layer 2 (lib/): sub-cli (the shell-out + stdout-JSON parser), store-access (forge-store view).
//   Layer 3 (tools.d/): one handler per action — add-standard, rollback, list.
//
// STORE INVARIANT: forger/replay/bridge HARDCODE <projectRoot>/dataStores/forgeStore.sqlite3 (no
// --db flag); manifestEditor accepts --db and otherwise defaults elsewhere. So the canonical store
// IS that hardcoded path, and add-standard passes --db=<canonical> to EVERY manifestEditor shell-out.
//
// SUBJECT/SCOPE INVARIANT: a forge emits _source === its registry standardName; forgeManager passes
// that SAME standardName (from the registry row) as --subject (extractSchema) and --scope (bridge),
// with NO case transform, so they match _source.
//
// Action flags single-hyphen (-addStandard); parameters double-hyphen (--standardName=...).
//
// Async style: leaves resolve at the leaf; no async/await, no try/catch-for-control-flow,
// no Promises surfaced. camelCase only.

const path = require('path');
const os = require('os');
const fs = require('fs');

const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();
const configFileProcessor = require('qtools-config-file-processor');

// --------------------------------------------------------------------------------
// PROJECT ROOT + PATHS
const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();

const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CONFIGS_DIR = path.join(projectRoot, 'configs');
const LIB_D = path.join(projectRoot, 'code', 'cli', 'lib.d');

// the ONE canonical store all components share (the hardcoded sibling path).
const CANONICAL_DB_PATH = path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');

// ABSOLUTE entry paths to each component CLI (shelled out by `node <entryPath> ...`).
const ENTRIES = {
	forger: path.join(LIB_D, 'edf-forge', 'edfForge.js'),
	replay: path.join(LIB_D, 'edf-replay', 'edfReplay.js'),
	bridge: path.join(LIB_D, 'edf-bridge', 'edfBridge.js'),
	manifest: path.join(LIB_D, 'manifest-editor', 'manifestEditor.js'),
};

const standardRegistry = require(path.join(LIB_D, 'edf-forge', 'lib', 'standard-registry'));

const subCliFactory = require('./lib/sub-cli');
const storeAccessFactory = require('./lib/store-access');
const addStandardFactory = require('./tools.d/add-standard');
const rollbackFactory = require('./tools.d/rollback');
const listFactory = require('./tools.d/list');

// =====================================================================
// HELP TEXT — matches specification/forgeManager/helpSpec.md (the control surface IS the contract)
// =====================================================================

const helpText = () => `
NAME
     forgeManager -- orchestrator; runs the multistep processes by shelling out to the components

SYNOPSIS
     edf-forge-manager -addStandard --standardName=<standardKey> --source=<path> [--no-publish]
     edf-forge-manager -rollback    --graph=<graphName> [--to=<manifestKey>]
     edf-forge-manager -list        <blocks|manifests|graphs> [--stale]

DESCRIPTION
     forgeManager owns the ordered workflows and nothing else. It holds NO domain logic: each
     command is a sequence of shell-outs to forger, replayManager, bridgeMaker, and manifestEditor,
     plus the enforcement of cross-step invariants. Thin by mandate.

     Action flags take a single hyphen; parameters take a double hyphen.

COMMANDS
     -addStandard   The full golden flow end to end: forge -> extract standard -> save+combine
                    (bronze) -> buildGraph bronze -> bridge specified/derived/implied -> extract
                    relationships (tearDown) -> save+combine (golden) -> buildGraph golden ->
                    PUBLISH (advance golden's pointer). --no-publish stops before the publish.
     -rollback      Repoint a graph's currentManifest to a prior manifestKey and rebuild. --to
                    defaults to the immediately prior pointer.
     -list          Inspect the store: blocks | manifests | graphs. --stale flags orphan blocks
                    or graphs whose currentManifest is behind the newest pointer.

OPTIONS
     --standardName=<standardKey>   The standard to add (resolved through the forge registry).
     --source=<path>                (-addStandard) The standard's source data (else bundle default).
     --no-publish                   (-addStandard) Build everything but do not advance golden.
     --graph=<graphName>            (-rollback) The target graph.
     --to=<manifestKey>             (-rollback) The manifest to repoint to.
     --stale                        (-list) Show only stale/orphan entries.

OUTPUT
     A run summary: the new manifestKey(s), the materialized graph location, and per-tier bridge
     counts. Errors surface the failing component and step.
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

	// shared resources (instantiated once; injected into the handlers).
	const subCli = subCliFactory({});
	const storeAccess = storeAccessFactory({ coreLib: CORE_LIB, dbPath: CANONICAL_DB_PATH });
	const tmpDir = path.join(os.tmpdir(), 'edfForgeManager');
	if (!fs.existsSync(tmpDir)) {
		fs.mkdirSync(tmpDir, { recursive: true });
	}

	// action registry (registry, NOT switch). Each entry returns a (callback) => void runner.
	const actionRegistry = {
		addStandard: () =>
			addStandardFactory({
				subCli,
				storeAccess,
				entries: ENTRIES,
				dbPath: CANONICAL_DB_PATH,
				standardRegistry,
				tmpDir,
			}).addStandard,
		rollback: () => rollbackFactory({ subCli, storeAccess, entries: ENTRIES }).rollback,
		list: () => listFactory({ storeAccess }).list,
	};

	const actionName = Object.keys(actionRegistry).find((name) => switches[name]);
	if (!actionName) {
		xLog.error(
			'forgeManager: unknown action. Actions are -addStandard, -rollback, -list. Use -help.',
		);
		process.exit(1);
		return;
	}

	const runner = actionRegistry[actionName]();
	runner((err, summary) => {
		if (err) {
			xLog.error(`forgeManager -${actionName}: ${err}`);
			process.exit(1);
			return;
		}
		xLog.result(JSON.stringify(summary, null, 2));
		process.exit(0);
	});
};

run();
