'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// store-access.js — forgeManager's read/bookkeeping view of the canonical forge-store. forgeManager
// owns the WORKFLOW; the component CLIs own the heavy lifting (forge/replay/bridge/manifest). But two
// pieces of bookkeeping are NOT owned by any component CLI and so fall to forgeManager:
//   * PUBLISH (advance a graph's currentManifest pointer) — -buildGraph builds the graph but does
//     NOT move the pointer; -addStandard's publish step (and -noPublish's omission of it) is the
//     forgeManager's invariant to enforce.
//   * ROLLBACK pointer move + prior-manifest discovery (manifestPointerLog).
//   * LIST blocks|manifests|graphs (+ --stale) inspection.
// These are store bookkeeping, NOT domain logic — they use the SAME forge-store library the
// component CLIs use, opened against the SAME canonical dbPath. No raw SQL of our own beyond the
// inspection SELECTs that the store API does not expose (listBlocks/listManifests/pointer history),
// run through the store's own sqlite handle.
//
// Async style: leaves resolve at the leaf; no async/await, no try/catch-for-control-flow. camelCase.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const moduleFunction =
	({ moduleName } = {}) =>
	({ coreLib, dbPath } = {}) => {
		const { xLog } = process.global;

		const forgeStore = require(path.join(coreLib, 'forge-store', 'forge-store'))();
		const credentialAccessor = require(path.join(
			coreLib,
			'credential-accessor',
			'credential-accessor',
		))({ forgeStore });
		let lifecycle = null; // built lazily in open()
		// a raw sqlite handle for the inspection reads the store API does not expose.
		// coreLib = <code>/npm/qtools-graph-forge-core/lib; the server tree is <code>/server.
		const sqliteInstance = require(path.join(
			coreLib,
			'..',
			'..',
			'..',
			'server',
			'data-model',
			'lib',
			'sqlite-instance',
			'sqlite-instance',
		));
		const rawOpts = { noTableNameOk: true, suppressStatementLog: true };
		let rawHandle = null;

		const open = (callback) => {
			const taskList = new taskListPlus();
			taskList.push((args, next) => {
				forgeStore.init({ dbPath }, (err) => next(err, args));
			});
			taskList.push((args, next) => {
				const { initDatabaseInstance } = sqliteInstance({ unused: true });
				initDatabaseInstance(dbPath, (err, dbInstance) =>
					next(err, { ...args, dbInstance }),
				);
			});
			taskList.push((args, next) => {
				args.dbInstance.getTable('forgeManagerReads', rawOpts, (err, tableRef) => {
					if (err) {
						next(err);
						return;
					}
					rawHandle = tableRef;
					next('', args);
				});
			});
			// the shared instance-lifecycle (for the fresh-graph reset replay requires).
			taskList.push((args, next) => {
				require(path.join(coreLib, 'instance-lifecycle', 'instance-lifecycle'))({
					forgeStore,
					credentialAccessor,
				})((err, builtLifecycle) => {
					if (err) {
						next(err);
						return;
					}
					lifecycle = builtLifecycle;
					next('', args);
				});
			});
			pipeRunner(taskList.getList(), {}, (err) => callback(err));
		};

		const getRows = (statement, callback) =>
			rawHandle.getData(statement, rawOpts, callback);

		// --- PUBLISH ---------------------------------------------------------------------------
		// advance a graph's currentManifest pointer (the production/composition split's publish).
		const publish = ({ graphName, manifestKey }, callback) => {
			forgeStore.setCurrentManifest({ name: graphName, manifestKey }, callback);
		};

		// --- RESET (fresh-graph guarantee) -----------------------------------------------------
		// resetGraph — destroy the named instance (container+volume) AND drop its registry row, so
		//   the next -buildGraph recreates it FRESH. The replay engine MERGEs (never deletes) and
		//   builds its resolution-key index on the EMPTY store, so the invariant
		//   `graph ≡ replay(manifest)` only holds against a clean instance. Idempotent: a no-op when
		//   the graph is absent. force=true because golden is a protected (non-ephemeral) type.
		const resetGraph = ({ graphName }, callback) => {
			forgeStore.getGraphByName({ name: graphName }, (err, graphRow) => {
				if (err) {
					callback(err);
					return;
				}
				if (!graphRow) {
					callback('', { reset: false }); // nothing to reset — first build
					return;
				}
				lifecycle.destroyInstanceByName(
					{ graphName, force: true },
					(destroyErr) => callback(destroyErr, destroyErr ? undefined : { reset: true }),
				);
			});
		};

		// --- ROLLBACK --------------------------------------------------------------------------
		// priorManifestKey — the immediately-prior pointer for a graph (the second-newest distinct
		//   manifestKey in its pointerLog). Returns null when there is no prior to roll back to.
		const priorManifestKey = ({ graphName }, callback) => {
			const taskList = new taskListPlus();
			taskList.push((args, next) => {
				forgeStore.getGraphByName({ name: graphName }, (err, graphRow) => {
					if (err) {
						next(err);
						return;
					}
					if (!graphRow) {
						next(`no graph named '${graphName}'`);
						return;
					}
					next('', { ...args, graphRow });
				});
			});
			taskList.push((args, next) => {
				getRows(
					`SELECT manifestKey, fromTime FROM manifestPointerLog
						WHERE graphId='${args.graphRow.graphId}'
						ORDER BY fromTime DESC;`,
					(err, rows) => {
						if (err) {
							next(err);
							return;
						}
						// collapse consecutive duplicates of the current pointer, then take the prior.
						const current = args.graphRow.currentManifest;
						const prior = (rows || [])
							.map((oneRow) => oneRow.manifestKey)
							.find((oneKey) => oneKey !== current);
						next('', { ...args, prior: prior || null });
					},
				);
			});
			pipeRunner(taskList.getList(), {}, (err, args) =>
				callback(err, err ? undefined : { priorManifestKey: args.prior }),
			);
		};

		const rollbackPointer = ({ graphName, toManifestKey }, callback) => {
			forgeStore.rollbackPointer({ name: graphName, toManifestKey }, callback);
		};

		const getGraphByName = ({ name }, callback) =>
			forgeStore.getGraphByName({ name }, callback);

		// --- LIST ------------------------------------------------------------------------------
		const listBlocks = (callback) =>
			getRows(
				`SELECT blockId, type, subject, version, producedBy, createdAt FROM blocks
					ORDER BY createdAt;`,
				callback,
			);

		const listManifests = (callback) =>
			getRows(
				`SELECT m.manifestKey, m.label, m.basedOn, m.note, m.createdAt,
						(SELECT count(*) FROM manifestBlocks mb WHERE mb.manifestKey=m.manifestKey) AS blockCount
					FROM manifests m ORDER BY m.createdAt;`,
				callback,
			);

		const listGraphs = (callback) => forgeStore.listGraphs(callback);

		// newestManifestKey — the most-recently-created manifest in the store (the "latest"). A graph
		//   whose currentManifest is not this is BEHIND the latest = stale (helpSpec -list --stale).
		const newestManifestKey = (callback) =>
			getRows(
				`SELECT manifestKey FROM manifests ORDER BY createdAt DESC, rowid DESC LIMIT 1;`,
				(err, rows) =>
					callback(err, err ? undefined : (rows && rows[0] ? rows[0].manifestKey : null)),
			);

		// collectibleBlockIds — blocks referenced by NO manifest (the --stale orphan set for blocks).
		const collectibleBlockIds = (callback) => forgeStore.collectibleBlockIds(callback);

		// newestManifestForGraph — the most recent pointer-log manifestKey for a graph (to detect a
		//   graph whose currentManifest is BEHIND its newest pointer = stale).
		const pointerHistory = ({ graphId }, callback) =>
			getRows(
				`SELECT manifestKey, fromTime FROM manifestPointerLog
					WHERE graphId='${graphId}' ORDER BY fromTime DESC;`,
				callback,
			);

		return {
			open,
			publish,
			resetGraph,
			priorManifestKey,
			rollbackPointer,
			getGraphByName,
			listBlocks,
			listManifests,
			listGraphs,
			newestManifestKey,
			collectibleBlockIds,
			pointerHistory,
			forgeStore,
		};
	};

module.exports = moduleFunction({ moduleName });
