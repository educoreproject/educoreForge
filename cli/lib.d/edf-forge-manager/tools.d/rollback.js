'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// rollback.js — the -rollback workflow (helpSpec). Repoint a graph's currentManifest to a PRIOR
// manifestKey (the prior manifest was never destroyed — retain-all) and REBUILD the graph from it.
//   forgeManager: repoint via store-access (forge-store.rollbackPointer) + shell out replay
//   -buildGraph --destination=<graph> to rebuild. --to defaults to the immediately-prior pointer.
//
// Async style: qtools taskListPlus/pipeRunner; shell-out resolves at the leaf. camelCase only.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const moduleFunction =
	({ moduleName } = {}) =>
	({ subCli, storeAccess, entries } = {}) => {
		const { xLog } = process.global;

		const rollback = (callback) => {
			const clp = process.global.commandLineParameters;
			const graphName = (clp.values.graph || [])[0];
			const toArg = (clp.values.to || [])[0];

			if (!graphName) {
				callback('forgeManager -rollback: --graph is required. Use -help.');
				return;
			}

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				storeAccess.open((err) => next(err, args));
			});

			// resolve the target manifestKey: explicit --to, else the immediately-prior pointer.
			taskList.push((args, next) => {
				if (toArg) {
					next('', { ...args, toManifestKey: toArg });
					return;
				}
				storeAccess.priorManifestKey({ graphName }, (err, result) => {
					if (err) {
						next(err);
						return;
					}
					if (!result.priorManifestKey) {
						next(
							`forgeManager -rollback: graph '${graphName}' has no prior manifest to roll back to (pass --to=<manifestKey>)`,
						);
						return;
					}
					next('', { ...args, toManifestKey: result.priorManifestKey });
				});
			});

			// reset the graph to a FRESH instance before rebuild — replay MERGEs and never deletes,
			// so a rebuild into the live (larger) graph would leave stale nodes. A fresh instance is
			// what makes the rolled-back graph EQUAL replay(rolledBackManifest). This drops the old
			// registry row + pointer history; the repoint below re-establishes the pointer.
			taskList.push((args, next) => {
				storeAccess.resetGraph({ graphName }, (err) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args });
				});
			});

			// rebuild the graph FRESH from the target manifest (recreates the instance + registry row).
			taskList.push((args, next) => {
				subCli.runComponentJson(
					{
						entryPath: entries.replay,
						args: [
							'-buildGraph',
							`--manifest=${args.toManifestKey}`,
							`--destination=${graphName}`,
							'--owner=:golden',
						],
						label: 'replay -buildGraph(rollback rebuild)',
					},
					(err, buildResult) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(
							`[rollback] rebuilt '${graphName}' (nodes ${buildResult.nodesMerged}, edges ${buildResult.edgesMerged})`,
						);
						next('', { ...args, buildResult });
					},
				);
			});

			// repoint: set currentManifest to the rolled-back target on the freshly-rebuilt graph.
			taskList.push((args, next) => {
				storeAccess.publish(
					{ graphName, manifestKey: args.toManifestKey },
					(err) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(
							`[rollback] repointed '${graphName}' -> ${args.toManifestKey}`,
						);
						next('', { ...args });
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					action: 'rollback',
					graph: graphName,
					rolledBackTo: args.toManifestKey,
					location: args.buildResult.location,
					nodesMerged: args.buildResult.nodesMerged,
					edgesMerged: args.buildResult.edgesMerged,
				});
			});
		};

		return { rollback };
	};

module.exports = moduleFunction({ moduleName });
