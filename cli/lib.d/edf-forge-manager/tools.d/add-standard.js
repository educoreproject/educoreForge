'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// add-standard.js — the -addStandard golden flow (helpSpec; DECISIONS-firstApp §17). THIN: an
// ordered sequence of shell-outs to the component CLIs + the publish bookkeeping + the cross-step
// invariant that --subject/--scope === the registry standardName === the forged _source.
//
// THE FLOW (helpSpec -addStandard, end to end):
//   1. forger  -forge                              -> validation graph (its nodes carry _source=std)
//   2. replay  -extractSchema=standard  --out      -> standard block file  (--subject=std)
//   3. manifest -save (the standard block)         -> blockId
//   4. manifest -combine (golden base + new block) -> bronze manifestKey
//   5. replay  -buildGraph --destination=bronze    -> bronze graph (the working graph)
//   6. replay  -extractSchema=relationships --tearDown --out  -> relationships block file (tears bronze)
//   7. manifest -save (relationships) + -combine (golden + standard + relationships) -> golden manifestKey
//   8. replay  -buildGraph --destination=golden    -> the rebuilt golden  (== replay(goldenManifest))
//   9. PUBLISH: advance golden's currentManifest pointer to the new golden manifestKey.
//      --no-publish stops before step 9 (production/composition split).
//
// (2026-07-04, edf-bridge retirement: the legacy bridge -specified/-derived/-implied step that
// mutated bronze between build and extract is GONE — mapping edges come from mapping blocks at
// replay, never from a live bridge pass; every live graph carries zero legacy edges.)
//
// The STORE: every component reads/writes ONE canonical store. forger/replay HARDCODE
// <projectRoot>/dataStores/forgeStore.sqlite3 (no --db flag); manifestEditor accepts --db and
// defaults elsewhere, so forgeManager passes --db=<canonical> to EVERY manifestEditor shell-out.
//
// Async style: qtools taskListPlus/pipeRunner; shell-outs resolve at the leaf. No async/await, no
// try/catch-for-control-flow. camelCase only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const moduleFunction =
	({ moduleName } = {}) =>
	({ subCli, storeAccess, entries, dbPath, standardDiscovery, tmpDir } = {}) => {
		const { xLog } = process.global;

		// manifestEditor always gets --db so it shares the canonical store with the siblings.
		const withDb = (args) => [...args, `--db=${dbPath}`];

		const addStandard = (callback) => {
			const clp = process.global.commandLineParameters;
			const standardNameArg = (clp.values.standardName || [])[0];
			const source = (clp.values.source || [])[0];
			const noPublish =
				!!clp.switches['no-publish'] ||
				clp.values['no-publish'] === true ||
				(Array.isArray(clp.values['no-publish']) &&
					clp.values['no-publish'][0] === true);

			if (!standardNameArg) {
				callback('forgeManager -addStandard: --standardName is required. Use -help.');
				return;
			}

			// INVARIANT: resolve the discovery roster entry so the canonical standardName (=== the
			// forged _source) drives --subject/--scope. NO case transform — pass it through verbatim.
			const resolved = standardDiscovery.resolveBundle({ standardName: standardNameArg });
			if (resolved.error) {
				callback(`forgeManager -addStandard: ${resolved.error}`);
				return;
			}
			const standardKey = resolved.standardName; // === _source the forge emits

			// The validation graph is materialized type='ephemeral' (tearable under any name), so it
			// carries a per-run tag to avoid colliding with other-project gf_ containers. bronze and
			// golden MUST be named exactly 'bronze'/'golden': -buildGraph derives the instance TYPE
			// (and the teardown-guard's ephemerality) from role===destination===the graph NAME, so a
			// tagged 'bronze_x' name would register as type 'user' and refuse the --tearDown reclaim.
			// The flow is sequential and tears bronze down each pass, so the fixed name is safe.
			const runTag = `${Date.now().toString(36)}`;
			const validationGraph = `p6val_${standardKey}_${runTag}`;
			const bronzeGraph = 'bronze';
			const goldenGraph = 'golden'; // the production graph (first-app: golden IS named 'golden')

			const standardBlockOut = path.join(tmpDir, `standard_${standardKey}_${runTag}.block`);
			const relationshipsBlockOut = path.join(
				tmpDir,
				`relationships_${standardKey}_${runTag}.block`,
			);

			const taskList = new taskListPlus();

			// open the store-access view (publish + golden-base discovery).
			taskList.push((args, next) => {
				storeAccess.open((err) => next(err, args));
			});

			// discover the current golden base manifest (the combine base). null on first standard.
			taskList.push((args, next) => {
				storeAccess.getGraphByName({ name: goldenGraph }, (err, graphRow) => {
					if (err) {
						next(err);
						return;
					}
					const goldenBase = graphRow ? graphRow.currentManifest : null;
					xLog.status(
						`[addStandard] golden base manifest: ${goldenBase || '(none — genesis)'}`,
					);
					next('', { ...args, goldenBase });
				});
			});

			// 1. forger -forge -> validation graph
			taskList.push((args, next) => {
				const forgeArgs = [
					'-forge',
					`--standardName=${standardNameArg}`,
					`--destination=${validationGraph}`,
					'--owner=:golden',
				];
				if (source) {
					forgeArgs.push(`--source=${source}`);
				}
				subCli.runComponentJson(
					{ entryPath: entries.forger, args: forgeArgs, label: 'forger -forge' },
					(err, forgeResult) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(
							`[addStandard] forged ${forgeResult.nodeCount} nodes / ${forgeResult.edgeCount} edges into '${validationGraph}'`,
						);
						next('', { ...args, forgeResult });
					},
				);
			});

			// 2. replay -extractSchema=standard --out  (--subject === standardKey === _source)
			taskList.push((args, next) => {
				subCli.runComponent(
					{
						entryPath: entries.replay,
						args: [
							'-extractSchema',
							`--from=${validationGraph}`,
							'--selector=standard',
							`--subject=${standardKey}`,
							`--out=${standardBlockOut}`,
							'--tearDown', // validation graph is ephemeral — reclaim it
						],
						label: 'replay -extractSchema=standard',
					},
					(err) => {
						if (err) {
							next(err);
							return;
						}
						if (!fs.existsSync(standardBlockOut)) {
							next('replay -extractSchema=standard: no block file produced');
							return;
						}
						next('', { ...args });
					},
				);
			});

			// 3. manifestEditor -save (standard block) -> blockId
			taskList.push((args, next) => {
				subCli.runComponentJson(
					{
						entryPath: entries.manifest,
						args: withDb([
							'-save',
							`--block=${standardBlockOut}`,
							'--producedBy=forgeManager:addStandard',
						]),
						label: 'manifestEditor -save(standard)',
					},
					(err, saveResult) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(`[addStandard] standard blockId ${saveResult.blockId}`);
						next('', { ...args, standardBlockId: saveResult.blockId });
					},
				);
			});

			// 4. manifestEditor -combine (golden base + standard block) -> bronze manifestKey
			taskList.push((args, next) => {
				const combineArgs = ['-combine', `--set=${args.standardBlockId}`, '--label=bronze'];
				if (args.goldenBase) {
					combineArgs.push(`--base=${args.goldenBase}`);
				}
				subCli.runComponentJson(
					{
						entryPath: entries.manifest,
						args: withDb(combineArgs),
						label: 'manifestEditor -combine(bronze)',
					},
					(err, combineResult) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(`[addStandard] bronze manifestKey ${combineResult.manifestKey}`);
						next('', { ...args, bronzeManifestKey: combineResult.manifestKey });
					},
				);
			});

			// 5-pre. reset bronze to a FRESH instance before the build (mirrors golden's 9a). The
			//     replay engine MERGEs and never deletes, and the step-7 extraction gathers ALL
			//     cross-source edges graph-wide — a surviving bronze from a FAILED prior run (teardown
			//     only happens on success) would sweep that run's stale edges into THIS run's
			//     content-addressed relationships block. No-op when bronze is absent (the normal case).
			taskList.push((args, next) => {
				storeAccess.resetGraph({ graphName: bronzeGraph }, (err) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args });
				});
			});

			// 5. replay -buildGraph --destination=bronze (the working graph)
			taskList.push((args, next) => {
				subCli.runComponentJson(
					{
						entryPath: entries.replay,
						args: [
							'-buildGraph',
							`--manifest=${args.bronzeManifestKey}`,
							`--destination=${bronzeGraph}`,
							'--owner=:golden',
						],
						label: 'replay -buildGraph(bronze)',
					},
					(err, buildResult) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(
							`[addStandard] bronze built at ${buildResult.location} (nodes ${buildResult.nodesMerged})`,
						);
						next('', { ...args, bronzeLocation: buildResult.location });
					},
				);
			});

			// 6. replay -extractSchema=relationships --tearDown --out (tears down bronze)
			taskList.push((args, next) => {
				subCli.runComponent(
					{
						entryPath: entries.replay,
						args: [
							'-extractSchema',
							`--from=${bronzeGraph}`,
							'--selector=relationships',
							`--out=${relationshipsBlockOut}`,
							'--tearDown',
						],
						label: 'replay -extractSchema=relationships',
					},
					(err) => {
						if (err) {
							next(err);
							return;
						}
						if (!fs.existsSync(relationshipsBlockOut)) {
							next('replay -extractSchema=relationships: no block file produced');
							return;
						}
						next('', { ...args });
					},
				);
			});

			// 7a. manifestEditor -save (relationships block) -> relationships blockId
			taskList.push((args, next) => {
				subCli.runComponentJson(
					{
						entryPath: entries.manifest,
						args: withDb([
							'-save',
							`--block=${relationshipsBlockOut}`,
							'--producedBy=forgeManager:addStandard',
						]),
						label: 'manifestEditor -save(relationships)',
					},
					(err, saveResult) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(`[addStandard] relationships blockId ${saveResult.blockId}`);
						next('', { ...args, relationshipsBlockId: saveResult.blockId });
					},
				);
			});

			// 7b. manifestEditor -combine (golden base + standard + relationships) -> golden manifestKey
			taskList.push((args, next) => {
				const setBlocks = `${args.standardBlockId},${args.relationshipsBlockId}`;
				const combineArgs = ['-combine', `--set=${setBlocks}`, '--label=golden'];
				if (args.goldenBase) {
					combineArgs.push(`--base=${args.goldenBase}`);
				}
				subCli.runComponentJson(
					{
						entryPath: entries.manifest,
						args: withDb(combineArgs),
						label: 'manifestEditor -combine(golden)',
					},
					(err, combineResult) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(`[addStandard] golden manifestKey ${combineResult.manifestKey}`);
						next('', { ...args, goldenManifestKey: combineResult.manifestKey });
					},
				);
			});

			// 8a. reset golden to a FRESH instance before the promote. The replay engine MERGEs and
			//     never deletes, building its index on an EMPTY store, so `golden ≡ replay(goldenManifest)`
			//     holds only against a clean instance. On the first standard golden is absent (no-op).
			taskList.push((args, next) => {
				storeAccess.resetGraph({ graphName: goldenGraph }, (err) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args });
				});
			});

			// 8b. replay -buildGraph --destination=golden (the atomic promote = rebuild-into-golden).
			//    golden ≡ replay(goldenManifest). NOT the publish — the pointer move is step 9.
			taskList.push((args, next) => {
				subCli.runComponentJson(
					{
						entryPath: entries.replay,
						args: [
							'-buildGraph',
							`--manifest=${args.goldenManifestKey}`,
							`--destination=${goldenGraph}`,
							'--owner=:golden',
						],
						label: 'replay -buildGraph(golden)',
					},
					(err, buildResult) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(
							`[addStandard] golden built at ${buildResult.location} (nodes ${buildResult.nodesMerged}, edges ${buildResult.edgesMerged})`,
						);
						next('', { ...args, goldenLocation: buildResult.location });
					},
				);
			});

			// 9. PUBLISH — advance golden's currentManifest pointer. --no-publish stops before this.
			taskList.push((args, next) => {
				if (noPublish) {
					xLog.status('[addStandard] --no-publish: golden built but pointer NOT advanced');
					next('', { ...args, published: false });
					return;
				}
				storeAccess.publish(
					{ graphName: goldenGraph, manifestKey: args.goldenManifestKey },
					(err) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(
							`[addStandard] PUBLISHED golden -> ${args.goldenManifestKey}`,
						);
						next('', { ...args, published: true });
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				// best-effort cleanup of the temp block files (never affects the result/store).
				[standardBlockOut, relationshipsBlockOut].forEach((onePath) => {
					if (fs.existsSync(onePath)) {
						fs.unlinkSync(onePath);
					}
				});
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					action: 'addStandard',
					standardName: standardKey,
					goldenManifestKey: args.goldenManifestKey,
					goldenGraph,
					goldenLocation: args.goldenLocation,
					published: args.published,
				});
			});
		};

		return { addStandard };
	};

module.exports = moduleFunction({ moduleName });
