#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const qt = require('qtools-functional-library');
const path = require('path');
const fs = require('fs');

const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// shared resources — the store, the compose layer, the codecs, the addressing (single sources of truth)
const forgeStoreFactory = require('../../../npm/qtools-graph-forge-core/lib/forge-store/forge-store');
const manifestEditorFactory = require('../../../npm/qtools-graph-forge-core/lib/manifest-editor/manifest-editor');
const vectorStoreFactory = require('../../../npm/qtools-graph-forge-core/lib/vector-store/vector-store');
const replayBlock = require('../../../npm/qtools-graph-forge-core/lib/replay/replay-block');
const contentAddress = require('../../../npm/qtools-graph-forge-core/lib/content-address/content-address')();
const vectorStorePath = require('../../../npm/qtools-graph-forge-core/lib/vector-store/vector-store-path')();

const embeddingMigratorFactory = require('./lib/embedding-migrator');
const { eachEntrySequentialStackSafe } = require('./lib/each-entry-sequential-stack-safe')();

// START OF moduleFunction() ============================================================
//
// edfMigrateEmbeddings CLI — the Phase-5 migration control surface (embedding-sidecar PLAN §4
// Phase 5). Mirrors manifestEditor.js's three layers: (1) THIS orchestrator bootstraps, resolves
// the store path, opens the store, and dispatches the single action; (2) the embedding-migrator
// lib does the per-block work over the injected forge-store + manifest-editor + per-standard vector
// stores; (3) two actions — -census (dry-run collision scan; mints/writes nothing) and -migrate
// (mints per-standard sidecar stores + a new manifest generation; old blocks/manifests retained).
//
// Action flags take a SINGLE hyphen (-census -migrate); parameter flags take a DOUBLE hyphen
// (--manifest= --db= --vectorStoreDir= --label= --note= --producedBy=). Values arrive as arrays.
//
// SAFETY: this tool NEVER re-embeds — it reuses each block's historical inline vector bytes
// verbatim (the determinism guarantee). The caller points --db at a COPY of the store; the live
// store is never opened by this verb.

const moduleFunction =
	({ moduleName } = {}) =>
	({ unused } = {}) => {
		const { xLog } = process.global;

		const helpText = `
edfMigrateEmbeddings — migrate a golden manifest's inline embeddings into per-standard sidecar stores.

USAGE
  edfMigrateEmbeddings -census  --manifest=<manifestKey> --db=<storePath>
  edfMigrateEmbeddings -migrate --manifest=<manifestKey> --db=<storePath> --vectorStoreDir=<dir>
                                [--label=<text>] [--note=<text>] [--producedBy=<text>]

  -census   DRY RUN. Decode every standard block's inline embeddings, compute vectorId + vectorHash,
            and report COLLISIONS (same vectorId, byte-different vector = drifted historical embedding).
            Mints NOTHING, writes NOTHING. The empirical arbiter of whether input-addressed dedup is
            lossless on the real historical data.
  -migrate  putVector each distinct inline vector VERBATIM (no re-embed) into that standard's
            per-standard sidecar store under --vectorStoreDir, rewrite node lines to embeddingRef,
            re-hash each standard block, and combine(base=manifest, set=new blockIds) -> a NEW
            immutable manifest generation. Old blocks + manifest are RETAINED (rollback).

  --db             REQUIRED. The forge-store SQLite file (point at a COPY, never the live store).
  --vectorStoreDir REQUIRED for -migrate. Directory for per-standard vectorStore.sqlite3 files
                   (sets EDF_FORGE_VECTORSTORE_DIR for the vector-store-path helper).
`;

		// -----
		// parameter helpers — values arrive as arrays.
		const first = (name) => {
			const values = commandLineParameters.values[name];
			return values && values.length ? values[0] : undefined;
		};

		// =====================================================================
		// ORCHESTRATION — help, select action, validate params, open store, dispatch
		// =====================================================================

		if (commandLineParameters.switches.help || commandLineParameters.switches.h) {
			xLog.status(helpText);
			return {};
		}

		const dispatchActions = ['census', 'migrate'];
		const selectedActions = dispatchActions.filter(
			(oneAction) => commandLineParameters.switches[oneAction],
		);
		if (selectedActions.length === 0) {
			xLog.error(`no action: one of -census -migrate is required (use --help)`);
			return {};
		}
		if (selectedActions.length > 1) {
			xLog.error(
				`one action at a time, got: ${selectedActions.map((oneAction) => `-${oneAction}`).join(' ')}`,
			);
			return {};
		}
		const actionName = selectedActions[0];

		const manifestKey = first('manifest');
		const dbPath = first('db');
		if (!manifestKey) {
			xLog.error(`-${actionName} requires --manifest=<manifestKey>`);
			return {};
		}
		if (!dbPath) {
			xLog.error(`-${actionName} requires --db=<storePath>`);
			return {};
		}
		if (!fs.existsSync(dbPath)) {
			xLog.error(`--db path does not exist: ${dbPath}`);
			return {};
		}

		// -migrate writes per-standard stores; wire the directory override so vector-store-path
		// resolves there (mirrors edfReplay's EDF_FORGE_VECTORSTORE_DIR announced override).
		const vectorStoreDir = first('vectorStoreDir');
		if (actionName === 'migrate') {
			if (!vectorStoreDir) {
				xLog.error(`-migrate requires --vectorStoreDir=<dir>`);
				return {};
			}
			process.env.EDF_FORGE_VECTORSTORE_DIR = vectorStoreDir;
			xLog.status(`VECTORSTORE TARGET: ${vectorStoreDir} (EDF_FORGE_VECTORSTORE_DIR)`);
		}

		// projectRoot is only consulted by vector-store-path when the env override is absent (i.e.
		// never for -migrate here); computed for completeness. system root is 4 dirs up from this verb.
		const projectRoot = path.join(__dirname, '../../../..');

		// -----
		// openVectorStoreForStandard — lazy, cached, per-standard WRITE resolver. The try/catch is a
		// library-boundary guard around vector-store-path's throw on an unsafe standardKey (the SAME
		// sanctioned pattern edfReplay.buildStoreResolver uses), NOT try/catch-for-control-flow.
		const storeCache = new Map();
		const openVectorStoreForStandard = (standardKey, callback) => {
			if (storeCache.has(standardKey)) {
				callback('', storeCache.get(standardKey));
				return;
			}
			let vectorDbPath;
			try {
				vectorDbPath = vectorStorePath.vectorStoreDbPathForStandard({ projectRoot, standardKey });
			} catch (pathErr) {
				callback(`vectorStorePath: ${pathErr.message}`);
				return;
			}
			const dir = path.dirname(vectorDbPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			const store = vectorStoreFactory();
			store.init({ dbPath: vectorDbPath }, (initErr) => {
				if (initErr) {
					callback(`vectorStore init for standard '${standardKey}' failed: ${initErr}`);
					return;
				}
				storeCache.set(standardKey, store);
				callback('', store);
			});
		};

		const taskList = new taskListPlus();

		// open + init the (copy) forge-store
		taskList.push((args, next) => {
			const forgeStore = forgeStoreFactory();
			forgeStore.init({ dbPath }, (err) => next(err, { ...args, forgeStore }));
		});

		// build the compose layer + the migrator, dispatch the selected action
		taskList.push((args, next) => {
			const manifestEditor = manifestEditorFactory({ forgeStore: args.forgeStore });
			const migrator = embeddingMigratorFactory({
				forgeStore: args.forgeStore,
				manifestEditor,
				openVectorStoreForStandard,
				replayBlock,
				contentAddress,
				eachEntrySequentialStackSafe,
				xLog,
			});

			if (actionName === 'census') {
				migrator.census({ manifestKey }, (err, result) => next(err, { ...args, result }));
				return;
			}
			migrator.migrate(
				{ manifestKey, label: first('label'), note: first('note'), producedBy: first('producedBy') },
				(err, result) => next(err, { ...args, result }),
			);
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err) {
				xLog.error(`edfMigrateEmbeddings -${actionName} failed: ${err}`);
				process.exitCode = 1;
				return;
			}
			xLog.result(JSON.stringify(args.result, null, 2));
		});

		return {};
	};

// END OF moduleFunction() ============================================================

// prettier-ignore
{
	process.global = {};
	process.global.xLog = fs.existsSync('./lib/x-log')
		? require('./lib/x-log')
		: { status: console.error, error: console.error, result: console.log };
	process.global.getConfig = typeof(getConfig) != 'undefined'
		? getConfig
		: (moduleName => ({ [moduleName]: undefined }[moduleName]));
	process.global.commandLineParameters = typeof(commandLineParameters) != 'undefined'
		? commandLineParameters
		: undefined;
	process.global.rawConfig = {};
}

module.exports = moduleFunction({ moduleName })({});
