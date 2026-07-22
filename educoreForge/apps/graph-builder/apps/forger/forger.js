'use strict';

// forger — forge ONE standard's source INTO a graph it is handed. In-process module of
// graphBuilder; async callback style (err-string first, no async/await, no try/catch for
// control flow).
//
//   forger() -> { forge(spec, callback) }
//
//     spec = {
//       standard                   token, e.g. 'lif' (resolves forges/<standard>/)
//       version                    recipe version token (reported; the bundle stamps the real
//                                  version provenance itself via deriveVersionStamp)
//       destination                the graph HANDLE from replayManager.create():
//                                  { graphName, boltUrl, password } — the forger writes into
//                                  this graph; it NEVER provisions, deletes, or registers one
//       source?                    path to source data; default = the bundle's own asset
//       owner?                     ownerStamp pass-through (default ':golden', incumbent-faithful)
//       vectorize?                 default true. false = skip the embedding pass entirely — the
//                                  SPEND KNOB: no Voyage client is even constructed
//       embedNodeLimit?            embed only the first N nodes (spend bound for smoke runs)
//       embeddingConfigFilePath?   override the Voyage ini; an active override is ANNOUNCED on
//                                  stderr so it can never silently redirect embedding credentials
//     }
//
//     callback('', { standard, version, destination, boltUrl, nodeCount, edgeCount,
//                    embedCallCount, nodesMerged, edgesMerged })
//
// SEAM (targetArchitectureDesign §4): `g = replayManager.create(); thisStandard.forge(g); ...`
// — replayManager owns the graph lifecycle; the forger's ONLY job is produce-and-write. The
// deliberate CONTRAST with the incumbent forger app (cli/lib.d/forger): no forge-store, no
// vector-store cache (TQ 2026-07-21: real Voyage, no cache — "Voyage is very cheap"), no
// credential registry, no instance-lifecycle, no provisioning.
//
// HARD SAFETY LINE: the forger writes ONLY to graphs named DEV_* (GNC-001 scratch tier). Any
// other destination — and explicitly anything matching GOLD_* or gf_* — is REFUSED before a
// connection is even attempted. This is the 2026-07-17 store-corruption lesson one layer down:
// being well-behaved is not enough; the write path is structurally unable to reach production.
//
// SECRET: the Voyage key is read ONLY by the embedding-client from voyageEmbedding.ini; it is
// never on the command line, in env, logged, or echoed here.

const path = require('path');
const fs = require('fs');

const configFileProcessor = require('qtools-config-file-processor');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const { buildStandardBlock } = require('./lib/standard-block');

// tree root (educoreForge/) is four levels up: forger -> apps -> graph-builder -> apps -> root
const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const TREE_LIB = path.join(TREE_ROOT, 'lib');
const FORGES_DIR = path.join(TREE_ROOT, 'forges');
// the system/ root (configs live beside code/, not inside it): educoreForge -> code -> system
const SYSTEM_ROOT = path.join(TREE_ROOT, '..', '..');
const DEFAULT_VOYAGE_CONFIG_PATH = path.join(
	SYSTEM_ROOT,
	'configs',
	'instanceSpecific',
	'qbook',
	'voyageEmbedding.ini',
);

const replayEngine = require(path.join(TREE_LIB, 'replay', 'replay-engine'));

// -----
// resolveVoyageConfigPath — the Voyage ini precedence as ONE provable rule: call param (announced
// by the caller) > getConfig('forger').voyageConfigFilePath (graphBuilder.ini) > the computed
// in-code default. getConfig is injectable for the test suite only; production passes nothing.
const resolveVoyageConfigPath = ({ paramPath, getConfig = process.global.getConfig } = {}) => {
	const configuredPath = ((getConfig && getConfig('forger')) || {}).voyageConfigFilePath;
	return paramPath || configuredPath || DEFAULT_VOYAGE_CONFIG_PATH;
};

// -----
// destinationRefusal — the HARD SAFETY LINE, applied before any connection. Returns '' when the
// destination is writable, otherwise the refusal message. Exported for the test suite: a guard
// never observed refusing is unproven.
const destinationRefusal = (destination) => {
	const graphName = destination && destination.graphName;
	if (!graphName || !destination.boltUrl || !destination.password) {
		return `forger: destination must be a graph handle { graphName, boltUrl, password } from replayManager.create — got ${JSON.stringify(
			destination,
		)}`;
	}
	if (/^(GOLD_|gf_)/i.test(graphName)) {
		return `forger: REFUSED — destination '${graphName}' matches GOLD_*/gf_* (production/live tier). The forger writes only to DEV_* scratch graphs.`;
	}
	if (!/^DEV_/.test(graphName)) {
		return `forger: REFUSED — destination '${graphName}' is not a DEV_* scratch graph (GNC-001). The forger writes only to DEV_* graphs.`;
	}
	return '';
};

// -----
// resolveBundle — forges/<standard>/parserDescriptor.ini is the bundle's self-description
// (discovery pattern, not a registry). Returns { error } or the resolved bundle facts.
const resolveBundle = ({ standard }) => {
	const bundleDir = path.join(FORGES_DIR, String(standard).toLowerCase());
	const descriptorPath = path.join(bundleDir, 'parserDescriptor.ini');
	if (!fs.existsSync(descriptorPath)) {
		const known = fs.existsSync(FORGES_DIR)
			? fs
					.readdirSync(FORGES_DIR, { withFileTypes: true })
					.filter((oneEntry) => oneEntry.isDirectory())
					.map((oneEntry) => oneEntry.name)
					.sort()
					.join(', ')
			: '(none)';
		return {
			error: `forger: no forge bundle for standard '${standard}' (no ${descriptorPath}). Known forges: ${known}`,
		};
	}
	const descriptor = (configFileProcessor.getConfig(descriptorPath) || {}).parserDescriptor || {};
	if (!descriptor.entryModule) {
		return { error: `forger: ${descriptorPath} has no entryModule` };
	}
	// canonicalize defaultSnapshot against the ENUMERATED snapshot directory names:
	// qtools-config-file-processor coerces `01` to the NUMBER 1 (code fact, same hazard the
	// incumbent standard-discovery documents), so the directory name is authoritative — match
	// numerically, use the canonical name ('01').
	let defaultSource = null;
	if (descriptor.defaultSnapshot !== undefined && descriptor.sourceFile) {
		const snapshotsDir = path.join(bundleDir, 'assets', 'standardSourceData');
		const snapshotDirNames = fs.existsSync(snapshotsDir)
			? fs
					.readdirSync(snapshotsDir, { withFileTypes: true })
					.filter((oneEntry) => oneEntry.isDirectory())
					.map((oneEntry) => oneEntry.name)
			: [];
		const matches = snapshotDirNames.filter(
			(oneName) => Number(oneName) === Number(descriptor.defaultSnapshot),
		);
		if (matches.length !== 1) {
			return {
				error: `forger: ${bundleDir} defaultSnapshot '${descriptor.defaultSnapshot}' matches ${
					matches.length === 0 ? 'no' : 'more than one'
				} snapshot directory (found: ${snapshotDirNames.join(', ') || 'none'})`,
			};
		}
		defaultSource = path.join(snapshotsDir, matches[0], `${descriptor.sourceFile}`);
	}
	return {
		bundleDir,
		standardName: descriptor.standardName || standard,
		entryPath: path.join(bundleDir, descriptor.entryModule),
		defaultSource,
	};
};

// START OF moduleFunction() ============================================================

const forger = () => {
	const forge = (spec, callback) => {
		const { xLog } = process.global;
		const {
			standard,
			version,
			destination,
			source,
			owner = ':golden',
			vectorize = true,
			embedNodeLimit,
			embeddingConfigFilePath,
		} = spec || {};

		// the guard fires FIRST — before the bundle loads, before anything connects.
		const refusal = destinationRefusal(destination);
		if (refusal) {
			callback(refusal);
			return;
		}

		const resolved = resolveBundle({ standard });
		if (resolved.error) {
			callback(resolved.error);
			return;
		}
		const sourcePath = source || resolved.defaultSource;
		if (!sourcePath) {
			callback(
				`forger: standard '${standard}' has no bundled default source and none was given`,
			);
			return;
		}

		// the vectorizer seam: OUR name for the capability is vectorizer; the copied bundles take
		// the dependency as { embedder } (byte-faithful port). vectorize:false is the spend knob —
		// no Voyage client is constructed at all, and the bundle runs skipEmbedding.
		//
		// Voyage config path precedence: call param (announced — it can never silently redirect
		// embedding credentials) > getConfig('forger').voyageConfigFilePath (graphBuilder.ini) >
		// the computed in-code default. The SECRET stays in voyageEmbedding.ini either way; only
		// the POINTER is configurable.
		let embedder = null;
		if (vectorize) {
			if (embeddingConfigFilePath) {
				console.error(
					`EMBEDDING CONFIG OVERRIDE ACTIVE: configFilePath = ${embeddingConfigFilePath} (embeddingConfigFilePath)`,
				);
			}
			embedder = require(path.join(TREE_LIB, 'embedding', 'embedding-client'))({
				configFilePath: resolveVoyageConfigPath({ paramPath: embeddingConfigFilePath }),
			});
		}

		const bundle = require(resolved.entryPath)({ embedder });

		const taskList = new taskListPlus();

		// run the forge bundle: parse -> contract graph -> (embed)
		taskList.push((args, next) => {
			xLog.status(
				`[forger] forging ${resolved.standardName} from ${path.basename(
					sourcePath,
				)} -> graph '${destination.graphName}'${vectorize ? '' : ' (vectorize OFF)'}`,
			);
			bundle.forge(
				{ sourcePath, owner, embedNodeLimit, skipEmbedding: !vectorize },
				(err, forged) => {
					if (err) {
						next(`forger: forge of '${standard}' failed: ${err}`);
						return;
					}
					xLog.status(
						`[forger] forged ${forged.nodes.length} nodes, ${forged.edges.length} edges (${forged.embedCallCount} embedding calls)`,
					);
					next('', { ...args, forged });
				},
			);
		});

		// serialize the ONE standard block (pure; the transport into the scratch graph)
		taskList.push((args, next) => {
			const block = buildStandardBlock({ forged: args.forged });
			xLog.status(
				`[forger] serialized standard block: ${block.nodeCount} nodes, ${block.edgeCount} edges`,
			);
			next('', { ...args, block });
		});

		// write into the handed graph (replay-engine MERGE; idempotent)
		taskList.push((args, next) => {
			replayEngine.replay(
				{
					manifest: [args.block.blockText],
					boltUri: destination.boltUrl,
					password: destination.password,
					graphName: destination.graphName,
				},
				(err, replayResult) => {
					if (err) {
						next(`forger: replay into '${destination.graphName}' failed: ${err}`);
						return;
					}
					next('', { ...args, replayResult });
				},
			);
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err) {
				callback(err);
				return;
			}
			callback('', {
				standard: resolved.standardName,
				version: args.forged.metadata.version || version,
				destination: destination.graphName,
				boltUrl: destination.boltUrl,
				nodeCount: args.block.nodeCount,
				edgeCount: args.block.edgeCount,
				embedCallCount: args.forged.embedCallCount,
				nodesMerged: args.replayResult.nodesMerged,
				edgesMerged: args.replayResult.edgesMerged,
			});
		});
	};

	return { forge };
};

// END OF moduleFunction() ============================================================

module.exports = forger;
module.exports.destinationRefusal = destinationRefusal;
module.exports.resolveBundle = resolveBundle;
module.exports.resolveVoyageConfigPath = resolveVoyageConfigPath;
module.exports.DEFAULT_VOYAGE_CONFIG_PATH = DEFAULT_VOYAGE_CONFIG_PATH;
