#!/usr/bin/env node
'use strict';

// =====================================================================
// edf-bridge-maker — the MINIMAL bridgeMaker runner (forgeArchitectureRefactor
// SPECIFICATION v2 S3, pilot scope)
// =====================================================================
// Loads ONE named forge module (the S2 uniform contract), validates its interface,
// checks its requires against the working manifest THROUGH standardDiscovery (ERROR,
// never silent-skip — the F8 golden-build ruling), runs it with an injected READER
// (S4 store-plane, refreshed between modules — R2-3), collects its emissions, and
// persists them under STAGE-THEN-POINT (S7):
//   STAGE: every emission serialized (replay-block canonical form) and saved as a
//          structuralBridge block — saved-but-unreferenced is inert.
//   POINT: only after EVERY module ran clean — pairGroups minted per pairing and the
//          CURRENT pointers advanced. Mint policy = UNION-WITH-CURRENT (R2-1): the
//          new group carries the current group's members PLUS the new blocks, so a
//          structural mint can never silently repoint a pair away from its crosswalk.
// Manifest composition/publication is NOT this tool's business (Phase-3 genesis).
//
// SEAM (the pattern the pilot sets): modules read only through the reader and emit
// pure pairing content ({ pairA, pairB, edges, counts }); THIS RUNNER owns version
// stamps (pair-binding, discovery casing), block serialization, and every store
// write. producedBy = the module's name, stamped at saveBlock (the store column is
// the canonical block-level producedBy surface — the pair-group-mint precedent).
//
// DETERMINISM (S11): pairGroup displayName is RUNNER-SUPPLIED and deterministic
// (NEVER the mint-date default); module ordering (when >1 module arrives in later
// phases) is topological over runAfter, recipe-order tie-break — the pilot runs ONE.
//
// Module resolution order (S3): each discovery bundle's modules/ directory (roster
// order), then the shared library directory cli/parserLib/modules/.
//
// USAGE:
//   EDF_FORGE_STORE_DB=/tmp/scratch.sqlite3 \
//     node edfBridgeMaker.js -run --module=ctdlFamilyStructure --manifest=<workingKey> \
//       [--noMint] [--reportOut=<path>]
// =====================================================================

const path = require('path');
const fs = require('fs');
const os = require('os');

const commandLineParser = require('qtools-parse-command-line');
const configFileProcessor = require('qtools-config-file-processor');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const commandLineParameters = commandLineParser.getParameters();

// --------------------------------------------------------------------------------
// PROJECT ROOT + PATHS (the edf-* tool convention)
const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CONFIGS_DIR = path.join(projectRoot, 'configs');
const PARSER_LIB_DIR = path.join(projectRoot, 'code', 'cli', 'parserLib');
const SHARED_MODULES_DIR = path.join(PARSER_LIB_DIR, 'modules');

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const storeReader = require(path.join(CORE_LIB, 'store-reader', 'store-reader'))();
const pairBinding = require(path.join(CORE_LIB, 'pair-binding', 'pair-binding'))();
const pairGroupMint = require(path.join(CORE_LIB, 'pair-group-mint', 'pair-group-mint'))();
const {
	STRUCTURAL_BRIDGE_BLOCK_TYPE,
	pairSubjectText,
} = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));
const standardDiscovery = require(
	path.join(projectRoot, 'code', 'cli', 'lib.d', 'forger', 'lib', 'standard-discovery'),
);

const PRODUCED_BY_RUNNER = 'edf-bridge-maker';

// =====================================================================
// BOOTSTRAP process.global (the edf-* tool convention)
// =====================================================================
const bootstrapGlobal = () => {
	const verbose = !!commandLineParameters.switches.verbose;
	const xLog = {
		status: (...a) => console.error(...a),
		error: (...a) => console.error(...a),
		result: (...a) => console.log(...a),
		verbose: verbose ? (...a) => console.error(...a) : () => {},
	};
	let wholeConfig = {};
	const hostConfigName =
		os.hostname() === 'qMax.local' || os.hostname() === 'qbook.local'
			? 'instanceSpecific/qbook'
			: '';
	const systemIni = path.join(CONFIGS_DIR, hostConfigName, 'systemParameters.ini');
	if (fs.existsSync(systemIni)) {
		wholeConfig = configFileProcessor.getConfig(systemIni) || {};
	}
	process.global = {
		xLog,
		getConfig: (name) => (name === 'allConfigs' ? wholeConfig : wholeConfig[name] || {}),
		commandLineParameters,
		rawConfig: wholeConfig,
	};
};

// edge serialization shape (the edf-mapping/edf-ctdl-uri-bridge convention): every
// property value becomes a PG-JSON array before the canonical serializer sees it.
const toBlockEdge = (oneEdge) => {
	const properties = {};
	Object.keys(oneEdge.properties || {}).forEach((oneKey) => {
		const value = oneEdge.properties[oneKey];
		properties[oneKey] = Array.isArray(value) ? value : [value];
	});
	return {
		type: oneEdge.type,
		fromRef: oneEdge.fromRef,
		toRef: oneEdge.toRef,
		properties,
	};
};

// =====================================================================
// MODULE RESOLUTION (S3 order: standard-folder modules/ dirs, then the shared dir)
// =====================================================================
const resolveModuleByName = (moduleNameWanted) => {
	const candidatePaths = [];
	standardDiscovery.roster().forEach((oneEntry) => {
		candidatePaths.push({
			home: oneEntry.bundleDir,
			modulePath: path.join(oneEntry.bundlePath, 'modules', `${moduleNameWanted}.js`),
		});
	});
	candidatePaths.push({
		home: 'sharedLibrary',
		modulePath: path.join(SHARED_MODULES_DIR, `${moduleNameWanted}.js`),
	});
	const found = candidatePaths.find((oneCandidate) => fs.existsSync(oneCandidate.modulePath));
	if (!found) {
		return {
			error:
				`no module '${moduleNameWanted}' found; searched ` +
				`${candidatePaths.length - 1} discovery bundles' modules/ dirs and ${SHARED_MODULES_DIR}`,
		};
	}
	return { loadedFrom: found.home, modulePath: found.modulePath, forgeModule: require(found.modulePath) };
};

const validateModuleInterface = ({ forgeModule, moduleNameWanted }) => {
	const problems = [];
	if (!forgeModule || typeof forgeModule !== 'object') {
		return { error: `module '${moduleNameWanted}' did not export an object` };
	}
	if (forgeModule.kind !== 'structure') {
		problems.push(`kind '${forgeModule.kind}' (pilot supports 'structure')`);
	}
	if (forgeModule.name !== moduleNameWanted) {
		problems.push(`name '${forgeModule.name}' does not match the requested '${moduleNameWanted}'`);
	}
	if (
		!Array.isArray(forgeModule.requires) ||
		forgeModule.requires.length === 0 ||
		forgeModule.requires.some((oneKey) => typeof oneKey !== 'string')
	) {
		problems.push(`requires must be a non-empty array of standardKey strings`);
	}
	if (typeof forgeModule.run !== 'function') {
		problems.push(`run is not a function`);
	}
	return problems.length
		? { error: `module '${moduleNameWanted}' fails interface validation: ${problems.join('; ')}` }
		: {};
};

// =====================================================================
// shared resources — EDF_FORGE_STORE_DB override, ANNOUNCED on stderr
// =====================================================================
const buildSharedResources = (callback) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	const dbPath =
		process.env.EDF_FORGE_STORE_DB ||
		path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');
	if (process.env.EDF_FORGE_STORE_DB) {
		console.error(`STORE OVERRIDE ACTIVE: forgeStore db = ${dbPath} (EDF_FORGE_STORE_DB)`);
	}
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.init({ dbPath }, (err) => next(err, args));
	});
	pipeRunner(taskList.getList(), {}, (err) => {
		callback(err, { forgeStore });
	});
};

// =====================================================================
// ACTION: -run
// =====================================================================
const handleRun = (resources, callback) => {
	const { xLog } = process.global;
	const { forgeStore } = resources;

	const moduleNameWanted = (commandLineParameters.values.module || [])[0] || null;
	const manifestKey = (commandLineParameters.values.manifest || [])[0] || null;
	const reportOut = (commandLineParameters.values.reportOut || [])[0] || null;
	const noMint = !!commandLineParameters.switches.noMint;

	if (!moduleNameWanted || !manifestKey) {
		callback('edf-bridge-maker -run: --module=<name> and --manifest=<workingManifestKey> are required');
		return;
	}

	// resolve + validate the module (synchronous, loud)
	const resolved = resolveModuleByName(moduleNameWanted);
	if (resolved.error) {
		callback(`edf-bridge-maker: ${resolved.error}`);
		return;
	}
	const { forgeModule, loadedFrom } = resolved;
	const interfaceVerdict = validateModuleInterface({ forgeModule, moduleNameWanted });
	if (interfaceVerdict.error) {
		callback(`edf-bridge-maker: ${interfaceVerdict.error}`);
		return;
	}

	// requires -> discovery casing (S2: resolved through standardDiscovery, never
	// string-equal against spoken names)
	const roster = standardDiscovery.roster();
	const requiresResolved = [];
	for (const oneRequire of forgeModule.requires) {
		const found = pairBinding.findRosterEntry({ roster, standardName: oneRequire });
		if (found.error) {
			callback(`edf-bridge-maker: requires entry '${oneRequire}': ${found.error}`);
			return;
		}
		requiresResolved.push(found.entry.standardName);
	}

	const taskList = new taskListPlus();

	// 1) working manifest members
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey }, (err, manifest) => {
			if (err) {
				next(`getManifest('${manifestKey}') failed: ${err}`);
				return;
			}
			if (!manifest) {
				next(`no working manifest '${manifestKey}'`);
				return;
			}
			next('', {
				...args,
				workingMemberIds: (manifest.members || []).map((oneMember) => oneMember.blockId),
			});
		});
	});

	// 2) reader over the WORKING manifest (R2-3: rebuilt from the accumulated member
	//    list — with >1 module this task re-runs per module after emissions append)
	taskList.push((args, next) => {
		storeReader.makeReader(
			{ forgeStore, memberBlockIds: args.workingMemberIds },
			(err, reader) => next(err, { ...args, reader }),
		);
	});

	// 3) requires-check against the reader (ERROR, never silent-skip)
	taskList.push((args, next) => {
		const presentKeys = args.reader
			.standardsPresent()
			.map((oneEntry) => oneEntry.standardKey);
		const missing = requiresResolved.filter((oneKey) => presentKeys.indexOf(oneKey) === -1);
		if (missing.length > 0) {
			next(
				`edf-bridge-maker: module '${moduleNameWanted}' requires standards absent from the ` +
					`working manifest: ${missing.join(', ')} (present: ${presentKeys.join(', ') || 'none'})`,
			);
			return;
		}
		next('', args);
	});

	// 4) run the module; emissions are BUFFERED (the runner is the only store writer)
	taskList.push((args, next) => {
		const emissions = [];
		const emitBlock = (oneEmission) => {
			const shapeProblems = [];
			if (!oneEmission || typeof oneEmission.pairA !== 'string' || typeof oneEmission.pairB !== 'string') {
				shapeProblems.push('pairA/pairB must be standardKey strings');
			}
			if (!Array.isArray(oneEmission && oneEmission.edges) || oneEmission.edges.length === 0) {
				shapeProblems.push('edges must be a non-empty array (a zero-edge pairing emits NOTHING — R2-7)');
			}
			if (shapeProblems.length) {
				throw new Error(`edf-bridge-maker emitBlock: malformed emission — ${shapeProblems.join('; ')}`);
			}
			emissions.push(oneEmission);
		};
		const log = (message) => xLog.status(`[${moduleNameWanted}] ${message}`);
		forgeModule.run({ reader: args.reader, emitBlock, log }, (err, moduleReport) => {
			next(err, { ...args, emissions, moduleReport });
		});
	});

	// 5) STAGE: serialize + saveBlock every emission (choke-validated structuralBridge;
	//    saved-but-unreferenced = inert)
	taskList.push((args, next) => {
		const stagedBlocks = [];
		const stageTaskList = new taskListPlus();
		args.emissions.forEach((oneEmission) => {
			stageTaskList.push((stageArgs, stageNext) => {
				const binding = pairBinding.resolvePairBinding({
					roster,
					hubStandardName: oneEmission.pairA,
					spokeStandardName: oneEmission.pairB,
					warn: (message) => xLog.status(`[edf-bridge-maker] ${message}`),
				});
				if (binding.error) {
					stageNext(`pair binding for ${oneEmission.pairA}::${oneEmission.pairB}: ${binding.error}`);
					return;
				}
				const standardsPresent = args.reader.standardsPresent();
				const blockIdFor = (standardKey) => {
					const entry = standardsPresent.find((oneStd) => oneStd.standardKey === standardKey);
					return entry ? entry.blockId : null;
				};
				// S1.7: requires = EXACTLY the two standard blockIds of the version-pair —
				// closure then enforces version alignment.
				const requires = [blockIdFor(binding.pairA), blockIdFor(binding.pairB)];
				if (requires.some((oneId) => !oneId)) {
					stageNext(
						`cannot resolve standard blockIds for requires of ${binding.pairSubject} ` +
							`(got: ${JSON.stringify(requires)})`,
					);
					return;
				}
				const blockText = replayBlock.serializeBlock({
					header: {
						blockType: STRUCTURAL_BRIDGE_BLOCK_TYPE,
						pairA: binding.pairA,
						pairAVersion: binding.pairAVersion,
						pairB: binding.pairB,
						pairBVersion: binding.pairBVersion,
						publishedVersionA: binding.publishedVersionA,
						publishedVersionB: binding.publishedVersionB,
						tierScope: 'structural',
						stableUriPropertyName: 'uri',
						resolutionKey: 'uri',
					},
					nodes: [], // structural bridge edges only (reify-on-demand); zero nodes
					edges: oneEmission.edges.map(toBlockEdge),
				});

				// round-trip guardrail (the uriBridge precedent): prove the block
				// deserializes before saving.
				let rtError = null;
				const readBack = (() => {
					try {
						return replayBlock.deserializeBlock(blockText);
					} catch (rtErr) {
						rtError = rtErr;
						return null;
					}
				})();
				if (rtError) {
					stageNext(`serialize/deserialize round-trip FAILED (${binding.pairSubject}): ${rtError.message}`);
					return;
				}
				if (readBack.edges.length !== oneEmission.edges.length || readBack.nodes.length !== 0) {
					stageNext(
						`round-trip mismatch (${binding.pairSubject}): wrote ${oneEmission.edges.length} ` +
							`edges/0 nodes, read ${readBack.edges.length}/${readBack.nodes.length}`,
					);
					return;
				}

				forgeStore.saveBlock(
					{
						type: STRUCTURAL_BRIDGE_BLOCK_TYPE,
						subject: binding.pairSubject,
						version: binding.versionKey,
						requires,
						text: blockText,
						producedBy: forgeModule.name,
					},
					(err, result) => {
						if (err) {
							stageNext(`saveBlock (${binding.pairSubject}) failed: ${err}`);
							return;
						}
						xLog.status(
							`[edf-bridge-maker] STAGED ${binding.pairSubject}@${binding.versionKey}: ` +
								`${result.blockId.slice(0, 12)}… (${oneEmission.edges.length} edges)`,
						);
						stagedBlocks.push({
							blockId: result.blockId,
							binding,
							counts: oneEmission.counts,
						});
						stageNext('', stageArgs);
					},
				);
			});
		});
		pipeRunner(stageTaskList.getList(), {}, (err) =>
			next(err, {
				...args,
				stagedBlocks,
				// R2-3: the working member list accumulates the emissions — a subsequent
				// module's reader (rebuilt from this list) sees them.
				workingMemberIds: args.workingMemberIds.concat(
					stagedBlocks.map((oneStaged) => oneStaged.blockId),
				),
			}),
		);
	});

	// 6) POINT: union-with-current pairGroup mint + pointer advance (R2-1) — only
	//    reached when every module ran clean (S7). --noMint stops after STAGE.
	taskList.push((args, next) => {
		if (noMint) {
			next('', { ...args, mintedGroups: [], mintSkipped: true });
			return;
		}
		const mintedGroups = [];
		const mintTaskList = new taskListPlus();
		args.stagedBlocks.forEach((oneStaged) => {
			mintTaskList.push((mintArgs, mintNext) => {
				const { binding } = oneStaged;
				forgeStore.resolveCurrentPairGroup(
					{ pairSubject: binding.pairSubject, versionKey: binding.versionKey },
					(err, current) => {
						// 'no CURRENT pair-group exists' is the FIRST-MINT case, not a failure;
						// any other error (incl. POINTER CORRUPT) stays fatal.
						if (err && !/no CURRENT pair-group exists/.test(`${err}`)) {
							mintNext(`resolveCurrentPairGroup(${binding.pairSubject}): ${err}`);
							return;
						}
						let currentMembers = [];
						if (!err && current && current.block) {
							const contentLine = `${current.block.text}`.split('\n')[1];
							let guardError = null;
							const parsedContent = (() => {
								try {
									return JSON.parse(contentLine == null ? '' : contentLine);
								} catch (parseErr) {
									guardError = parseErr;
									return null;
								}
							})();
							if (guardError) {
								mintNext(
									`current pairGroup ${current.groupBlockId} content line is not ` +
										`valid JSON: ${guardError.message}`,
								);
								return;
							}
							currentMembers = (parsedContent && parsedContent.members) || [];
						}
						// UNION-WITH-CURRENT (R2-1): never a kind-partial repoint.
						const unionMembers = Array.from(
							new Set([...currentMembers, oneStaged.blockId]),
						).sort();
						pairGroupMint.mintPairGroupIntoStore(
							{
								forgeStore,
								pairA: binding.pairA,
								pairAVersion: binding.pairAVersion,
								pairB: binding.pairB,
								pairBVersion: binding.pairBVersion,
								publishedVersionA: binding.publishedVersionA,
								publishedVersionB: binding.publishedVersionB,
								pairSubject: binding.pairSubject,
								versionKey: binding.versionKey,
								members: unionMembers,
								// S11/S3: deterministic, runner-supplied — NEVER the mint-date default
								displayName: `${binding.pairSubject} @ ${binding.versionKey} — bridgeMaker:${forgeModule.name}`,
								note: `bridgeMaker union-with-current mint (module ${forgeModule.name})`,
								producedBy: PRODUCED_BY_RUNNER,
							},
							(mintErr, mintResult) => {
								if (mintErr) {
									mintNext(`mint (${binding.pairSubject}): ${mintErr}`);
									return;
								}
								mintedGroups.push(mintResult);
								mintNext('', mintArgs);
							},
						);
					},
				);
			});
		});
		pipeRunner(mintTaskList.getList(), {}, (err) =>
			next(err, { ...args, mintedGroups, mintSkipped: false }),
		);
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		const report = {
			action: 'run',
			module: forgeModule.name,
			loadedFrom,
			workingManifest: manifestKey,
			requiresResolved,
			stagedBlocks: args.stagedBlocks.map((oneStaged) => ({
				pairSubject: oneStaged.binding.pairSubject,
				versionKey: oneStaged.binding.versionKey,
				blockId: oneStaged.blockId,
				counts: oneStaged.counts,
			})),
			mintedGroups: args.mintedGroups,
			mintSkipped: args.mintSkipped,
			moduleReport: args.moduleReport,
		};
		if (reportOut) {
			fs.writeFileSync(reportOut, JSON.stringify(report, null, 2));
		}
		xLog.result(JSON.stringify(report, null, 2));
		callback('');
	});
};

// =====================================================================
// DISPATCH
// =====================================================================
const dispatchMap = {
	run: handleRun,
};

const main = () => {
	bootstrapGlobal();
	const { xLog } = process.global;
	const action = Object.keys(commandLineParameters.switches).find(
		(oneSwitch) => dispatchMap[oneSwitch],
	);
	if (!action) {
		xLog.error(
			'edf-bridge-maker: unknown action. Actions: -run. ' +
				'Params: --module=<name> --manifest=<workingManifestKey> [--reportOut=<path>]. ' +
				'Switches: -noMint (stage only, no pairGroup mint/pointer advance).',
		);
		process.exit(2);
	}
	buildSharedResources((err, resources) => {
		if (err) {
			xLog.error(`edf-bridge-maker bootstrap failed: ${err}`);
			process.exit(2);
		}
		dispatchMap[action](resources, (actionErr) => {
			if (actionErr) {
				xLog.error(`edf-bridge-maker -${action}: ${actionErr}`);
				process.exit(1);
			}
			process.exit(0);
		});
	});
};

main();
