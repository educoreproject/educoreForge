#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edfReference.js — the `edf-reference` CLI: PHASE-3 reference-subgraph producer (HubReference subgraph).
//
//   edf-reference -build [--gatingManifest=<key>] [--hubVersion=<v>] [--label=<text>] [--keyOut=<path>]
//
// Reads the ADDRESSED CEDS hub block from forgeStore, derives the HubReference reference subgraph (PURE,
// via the core reference-subgraph lib), serializes it as ONE additive 'reference' block, content-addresses
// it into forgeStore, and assembles a CANDIDATE manifest = (the gating manifest's members) + (the reference
// block). STRICTLY ADDITIVE: it adds a new block + a new manifest; it NEVER supersedes/edits an existing
// block, NEVER touches the production golden / golden pointer, NEVER commits.
//
// 3-layer orchestrator (mirrors edf-gate/edf-replay): Layer 1 (this file) bootstraps process.global +
// shared resources (forge-store, replay-block, reference-subgraph). Layer 2 = the core reference-subgraph
// derivation (pure). Block serialization reuses replay-block.serializeBlock (the same path the materializer
// uses), so the candidate replays through the existing engine unchanged (replay-engine.js untouched).
//
// Action flags single-hyphen; parameters double-hyphen. Async style: qtools taskListPlus/pipeRunner; no
// async/await, no try/catch for control flow. camelCase only.

const path = require('path');
const fs = require('fs');
const os = require('os');

const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();
const configFileProcessor = require('qtools-config-file-processor');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// --------------------------------------------------------------------------------
// PROJECT ROOT + PATHS (mirror edf-gate)
const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CONFIGS_DIR = path.join(projectRoot, 'configs');

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const referenceSubgraphFactory = require(path.join(CORE_LIB, 'reference-subgraph', 'referenceSubgraph'));

// discovery (spec §4.3, Phase C): the reference block is HUB-VERSION KEYED — its header
// gains hubSnapshotKey from the hub bundle's discovery binding. A new CEDS snapshot
// therefore yields a new reference block; existing behavior otherwise unchanged.
const standardDiscovery = require(path.join(
	projectRoot,
	'code',
	'cli',
	'lib.d',
	'forger',
	'lib',
	'standard-discovery',
));

const DEFAULT_GATING_MANIFEST =
	'0a952b7bd3ba6d0da3e1234ef83feb7607ee70e13f87fad48973352c3ead6263';
const EMBEDDING_DIMS = 1024;

// =====================================================================
// BOOTSTRAP process.global (mirror edf-gate.bootstrapGlobal)
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

// =====================================================================
// node serialization shape (mirror edf-forge/materializer.buildStandardBlock): every property value is a
// PG-JSON array (single-element [x]) except embedding; ref externalizes the stableId.
// =====================================================================
const toBlockNode = (oneNode) => {
	const properties = {};
	Object.keys(oneNode.properties).forEach((oneKey) => {
		if (oneKey === 'embedding' || oneKey === 'embeddingModelVersion') {
			return;
		}
		const value = oneNode.properties[oneKey];
		properties[oneKey] = Array.isArray(value) ? value : [value];
	});
	return {
		ref: { source: oneNode.properties._source, id: oneNode.stableId },
		labels: oneNode.labels,
		stableId: oneNode.stableId,
		properties,
	};
};

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
// shared resources
// =====================================================================
const buildSharedResources = (callback) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.init(
			{ dbPath: path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3') },
			(err) => next(err, args),
		);
	});
	pipeRunner(taskList.getList(), {}, (err) => {
		callback(err, { forgeStore });
	});
};

// =====================================================================
// ACTION: -build
// =====================================================================
const handleBuild = (resources, callback) => {
	const { xLog } = process.global;
	const { forgeStore } = resources;
	const gatingManifest =
		(commandLineParameters.values.gatingManifest || [])[0] || DEFAULT_GATING_MANIFEST;
	const hubVersionOverride = (commandLineParameters.values.hubVersion || [])[0] || null;
	const label =
		(commandLineParameters.values.label || [])[0] || 'phase3-hubReference-candidate';
	const keyOut = (commandLineParameters.values.keyOut || [])[0] || null;

	const taskList = new taskListPlus();

	// 1) read the gating manifest's members; find the addressed CEDS standard block
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey: gatingManifest }, (err, manifest) => {
			if (err) {
				next(`getManifest('${gatingManifest}') failed: ${err}`);
				return;
			}
			if (!manifest) {
				next(`no gating manifest '${gatingManifest}'`);
				return;
			}
			next('', { ...args, members: manifest.members || [] });
		});
	});

	// 2) locate the CEDS standard block among the members
	taskList.push((args, next) => {
		const sub = new taskListPlus();
		let cedsRow = null;
		args.members.forEach((oneMember) => {
			sub.push((a2, n2) => {
				if (cedsRow) {
					n2('', a2);
					return;
				}
				forgeStore.getBlock({ blockId: oneMember.blockId }, (err, row) => {
					if (err) {
						n2(err);
						return;
					}
					if (row && row.type === 'standard' && row.subject === 'CEDS') {
						cedsRow = row;
					}
					n2('', a2);
				});
			});
		});
		pipeRunner(sub.getList(), {}, (err) => {
			if (err) {
				next(err);
				return;
			}
			if (!cedsRow) {
				next('no CEDS standard block found in the gating manifest');
				return;
			}
			next('', { ...args, cedsRow });
		});
	});

	// 3) deserialize + derive the reference subgraph (PURE)
	taskList.push((args, next) => {
		const { header, nodes: cedsNodes, edges: cedsEdges } = replayBlock.deserializeBlock(
			args.cedsRow.text,
		);
		// hubVersion + namespace derived deterministically from the CEDS hub data (no Date/random).
		const sampleProperty = cedsNodes.find(
			(oneNode) => (oneNode.properties.role || [])[0] === 'DmeProperty',
		);
		const dataHubVersion =
			sampleProperty && (sampleProperty.properties.hubVersion || [])[0];
		const hubVersion = hubVersionOverride || dataHubVersion || header.version || '';
		const sampleUri = sampleProperty && (sampleProperty.properties.uri || [])[0];
		const hubNamespace = sampleUri
			? sampleUri.replace(/[^/]*$/, '')
			: 'https://w3id.org/CEDStandards/terms/';

		const builder = referenceSubgraphFactory({
			hubName: 'CEDS',
			hubVersion,
			hubDisplayName: 'Common Education Data Standards',
			hubNamespace,
			canonicalKeyName: 'CEDS Global ID',
			canonicalKeyMinted: false,
			sourceProvenance: `CEDS-Ontology.rdf v${hubVersion}; forge-ceds standard block ${args.cedsRow.blockId.slice(0, 12)}`,
		});
		const subgraph = builder.buildReferenceSubgraph({ cedsNodes, cedsEdges });
		xLog.status(
			`[edf-reference] derived ${subgraph.counts.hubReferenceTotal} HubReferences ` +
				`(${subgraph.counts.propertyTier} property / ${subgraph.counts.valueTier} value / ${subgraph.counts.qualified} qualified) ` +
				`+ ${subgraph.counts.hubDefinition} HubDefinition; ${subgraph.counts.edgeTotal} edges`,
		);
		next('', { ...args, header, hubVersion, subgraph });
	});

	// 4) serialize the reference block + content-address it into forgeStore (additive; dedup on blockId)
	taskList.push((args, next) => {
		const { subgraph, cedsRow } = args;
		// hubSnapshotKey (spec §4.3): the hub bundle's discovery-bound default snapshot.
		const hubEntry = standardDiscovery
			.roster()
			.find((oneEntry) => oneEntry.standardName === standardDiscovery.cedsHubStandardName);
		if (!hubEntry) {
			next(
				`edf-reference: discovery roster carries no production bundle named ` +
					`'${standardDiscovery.cedsHubStandardName}' — cannot stamp hubSnapshotKey`,
			);
			return;
		}
		const header = {
			blockType: 'reference',
			standardKey: 'CEDS',
			version: args.hubVersion,
			hubSnapshotKey: hubEntry.defaultSnapshot,
			stableUriPropertyName: 'uri',
			resolutionKey: 'uri',
			embeddingModelVersion: 'voyage-4-large',
			embeddingEncoding: 'base64',
			embeddingDtype: 'float32',
			embeddingByteOrder: 'little-endian',
			embeddingDims: EMBEDDING_DIMS,
		};
		const blockText = replayBlock.serializeBlock({
			header,
			nodes: subgraph.nodes.map(toBlockNode),
			edges: subgraph.edges.map(toBlockEdge),
		});
		forgeStore.saveBlock(
			{
				type: 'reference',
				subject: 'CEDS',
				version: args.hubVersion,
				requires: [cedsRow.blockId], // depends on the addressed CEDS hub block
				text: blockText,
				producedBy: 'edf-reference',
			},
			(err, result) => {
				if (err) {
					next(`saveBlock failed: ${err}`);
					return;
				}
				xLog.status(
					`[edf-reference] reference block saved: ${result.blockId.slice(0, 12)}… (${blockText.split('\n').filter(Boolean).length} lines)`,
				);
				next('', { ...args, referenceBlockId: result.blockId });
			},
		);
	});

	// 5) assemble the CANDIDATE manifest = gating members + the reference block (additive)
	taskList.push((args, next) => {
		const members = args.members
			.map((oneMember) => ({ blockId: oneMember.blockId, position: null }))
			.concat([{ blockId: args.referenceBlockId, position: null }]);
		forgeStore.saveManifest(
			{
				label,
				basedOn: gatingManifest,
				note: 'Phase 3 additive candidate: gating golden + HubReference reference subgraph',
				members,
			},
			(err, result) => {
				if (err) {
					next(`saveManifest failed: ${err}`);
					return;
				}
				next('', { ...args, candidateManifestKey: result.manifestKey });
			},
		);
	});

	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		if (keyOut) {
			fs.writeFileSync(keyOut, args.candidateManifestKey);
		}
		xLog.result(
			JSON.stringify(
				{
					action: 'build',
					gatingManifest,
					cedsBlockId: args.cedsRow.blockId,
					referenceBlockId: args.referenceBlockId,
					candidateManifestKey: args.candidateManifestKey,
					counts: args.subgraph.counts,
					identificationPatterns: args.subgraph.identificationPatterns,
				},
				null,
				2,
			),
		);
		callback('');
	});
};

// =====================================================================
// DISPATCH
// =====================================================================
const dispatchMap = { build: handleBuild };

const main = () => {
	bootstrapGlobal();
	const { xLog } = process.global;
	const action = Object.keys(commandLineParameters.switches).find(
		(oneSwitch) => dispatchMap[oneSwitch],
	);
	if (!action) {
		xLog.error(
			'edf-reference: unknown action. Actions: -build. Params: --gatingManifest= --hubVersion= --label= --keyOut=',
		);
		process.exit(2);
	}
	buildSharedResources((err, resources) => {
		if (err) {
			xLog.error(`edf-reference bootstrap failed: ${err}`);
			process.exit(2);
		}
		dispatchMap[action](resources, (handlerErr) => {
			if (handlerErr) {
				xLog.error(`[edf-reference] ERROR: ${handlerErr}`);
				process.exit(1);
			}
			process.exit(0);
		});
	});
};

main();
