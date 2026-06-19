'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// list.js — the -list inspector (helpSpec): blocks | manifests | graphs [--stale]. Pure store reads
// through store-access (no shell-outs, no graph touches). --stale:
//   blocks    -> orphan blocks (referenced by no manifest) = collectibleBlockIds.
//   graphs    -> graphs whose currentManifest is BEHIND the newest pointer-log entry (drift).
//   manifests -> (no stale notion) returns all; --stale narrows to manifests in no graph pointer.
//
// Async style: qtools taskListPlus/pipeRunner; reads resolve at the leaf. camelCase only.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const moduleFunction =
	({ moduleName } = {}) =>
	({ storeAccess } = {}) => {
		const { xLog } = process.global;

		const list = (callback) => {
			const clp = process.global.commandLineParameters;
			const what = (clp.fileList || [])[0];
			const stale =
				!!clp.switches.stale ||
				clp.values.stale === true ||
				(Array.isArray(clp.values.stale) && clp.values.stale[0] === true);

			if (!what || ['blocks', 'manifests', 'graphs'].indexOf(what) === -1) {
				callback('forgeManager -list: one of <blocks|manifests|graphs> is required. Use -help.');
				return;
			}

			const handlers = {
				blocks: (next) => {
					if (stale) {
						storeAccess.collectibleBlockIds((err, orphanIds) => {
							if (err) {
								next(err);
								return;
							}
							next('', { kind: 'blocks', stale: true, orphanBlockIds: orphanIds });
						});
						return;
					}
					storeAccess.listBlocks((err, rows) => {
						if (err) {
							next(err);
							return;
						}
						next('', { kind: 'blocks', stale: false, blocks: rows || [] });
					});
				},
				manifests: (next) => {
					storeAccess.listManifests((err, rows) => {
						if (err) {
							next(err);
							return;
						}
						next('', { kind: 'manifests', stale, manifests: rows || [] });
					});
				},
				graphs: (next) => {
					const taskList = new taskListPlus();
					taskList.push((args, innerNext) => {
						storeAccess.newestManifestKey((err, newest) =>
							innerNext(err, { ...args, newestManifest: newest }),
						);
					});
					taskList.push((args, innerNext) => {
						storeAccess.listGraphs((err, rows) =>
							innerNext(err, { ...args, graphRows: rows || [] }),
						);
					});
					// annotate each graph with staleness: its currentManifest is not the store's
					// newest (latest) manifest -> the graph is BEHIND the latest (helpSpec --stale).
					taskList.push((args, innerNext) => {
						const annotated = args.graphRows.map((oneGraph) => ({
							name: oneGraph.name,
							type: oneGraph.type,
							currentManifest: oneGraph.currentManifest,
							latestManifest: args.newestManifest,
							stale:
								args.newestManifest != null &&
								oneGraph.currentManifest != null &&
								oneGraph.currentManifest !== args.newestManifest,
						}));
						innerNext('', { ...args, annotated });
					});
					pipeRunner(taskList.getList(), {}, (err, args) => {
						if (err) {
							next(err);
							return;
						}
						const graphs = stale
							? args.annotated.filter((oneGraph) => oneGraph.stale)
							: args.annotated;
						next('', { kind: 'graphs', stale, graphs });
					});
				},
			};

			const taskList = new taskListPlus();
			taskList.push((args, next) => {
				storeAccess.open((err) => next(err, args));
			});
			taskList.push((args, next) => {
				handlers[what]((err, result) => next(err, { ...args, result }));
			});
			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', { action: 'list', ...args.result });
			});
		};

		return { list };
	};

module.exports = moduleFunction({ moduleName });
