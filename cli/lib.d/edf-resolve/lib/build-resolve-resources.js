'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// build-resolve-resources.js — composes the REAL dependencies the runnable resolve surfaces need
// (forge-store + def-embedder + llm-client + the shared resolve-core), so the CLI verb, the MCP-tool
// adapter, and the askMilo-tool adapter all wire resolve-core identically (DRY). The surfaces-parity gate
// does NOT use this builder — it injects a DETERMINISTIC STUB llmClient straight into resolve-core so the
// 3-way comparison can't flake on Opus variance. Reuses the SAME def-embedder + llm-client the Phase-5
// inferred track uses (cache file shared). No async/await, no try/catch for control flow. camelCase only.

const path = require('path');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CODE = path.join(projectRoot, 'code');
const CORE_LIB = path.join(CODE, 'npm', 'qtools-graph-forge-core', 'lib');
const IMPLIED_LIB = path.join(CODE, 'cli', 'lib.d', 'bridge-maker', 'lib');
const DATASTORES = path.join(projectRoot, 'dataStores');

const { pipeRunner, taskListPlus } = new require(path.join(
	CODE,
	'cli',
	'node_modules',
	'qtools-asynchronous-pipe-plus',
))();

const defEmbedderFactory = require(path.join(IMPLIED_LIB, 'def-embedder'));
const llmClientFactory = require(path.join(IMPLIED_LIB, 'llm-client'));
const resolveCoreFactory = require(path.join(__dirname, 'resolve-core'));

// the gating manifest the Phase-7 re-freeze targets (the finished golden's content blocks). Overridable.
const DEFAULT_GATING_MANIFEST =
	'a9c2efcfbb302d84f69890ce86d2bd8c0f274e0901b309ce55baf4fc8a5c4d11';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(
		{ gatingManifest = DEFAULT_GATING_MANIFEST, model, topK = 15, cosineFloor = 0, concurrency = 8 } = {},
		callback,
	) => {
		const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
		// EDF_FORGE_STORE_DB redirects the store (test harnesses); absent -> canonical, byte-identical.
		// An active override is ANNOUNCED on stderr so it can never silently redirect production writes.
		const dbPath =
			process.env.EDF_FORGE_STORE_DB || path.join(DATASTORES, 'forgeStore.sqlite3');
		if (process.env.EDF_FORGE_STORE_DB) {
			console.error(
				`STORE OVERRIDE ACTIVE: forgeStore db = ${dbPath} (EDF_FORGE_STORE_DB)`,
			);
		}
		const taskList = new taskListPlus();
		taskList.push((args, next) => {
			forgeStore.init({ dbPath }, (err) => next(err, args));
		});
		pipeRunner(taskList.getList(), {}, (err) => {
			if (err) {
				callback(`build-resolve-resources: forgeStore init failed: ${err}`);
				return;
			}
			const defEmbedder = defEmbedderFactory({
				cacheFilePath: path.join(DATASTORES, 'phase5DefEmbCache.json'),
			});
			const llmClient = llmClientFactory({ model });
			const resolveCore = resolveCoreFactory({
				forgeStore,
				defEmbedder,
				llmClient,
				gatingManifest,
				topK,
				cosineFloor,
				concurrency,
			});
			callback('', { forgeStore, defEmbedder, llmClient, resolveCore, gatingManifest });
		});
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.DEFAULT_GATING_MANIFEST = DEFAULT_GATING_MANIFEST;
