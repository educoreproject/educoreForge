#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edfEquivalence.js — the `edf-equivalence` CLI: PHASE-6 EQUIVALENCE-LAYER producer (the keystone).
//
//   edf-equivalence -emit [--gatingManifest=K] [--label=L]
//   edf-equivalence -conservativity [--manifest=K]
//
// Equivalence itself is DERIVED, never materialized (WHITEPAPER §4.7/§7: a HubReference with >=2 exactMatch
// sources IS the cluster; NO Cluster node). So the ONLY graph mutation this producer makes is the CURATION:
//
// -emit : reads the DURABLE curation fixture (assets/curationInputs.js — frozen, human-vetted), resolves
//   each promotion to its QUALIFIED HubReference, and PURELY emits a curated EXACT_MATCH edge + a reified
//   MappingAssertion node (+ REIFIED_AS / ASSERTS) per promotion (reify-on-demand: the mapping must carry the
//   CURATED_BY relationship). Serializes ONE additive blockType:'curatedMapping' block, content-addresses it,
//   and assembles a CANDIDATE manifest = gating members + the curation block. STRICTLY ADDITIVE; NEVER touches
//   the production golden / golden pointer; NEVER commits; ZERO LLM (deterministic replay).
//
// -conservativity : reads a manifest, gathers every EXACT_MATCH edge from its 'mapping' blocks, resolves the
//   pinned must-never-merge reference pairs (DEVLOG §6L-c) from the reference block, and runs the PURE
//   conservativity check — a producer-side sanity report (the graph-level enforcement lives in gate 13).
//
// Action flags single-hyphen; parameters double-hyphen. qtools taskListPlus/pipeRunner; no async/await, no
// try/catch for control flow; native JS only where no qtools lib applies. camelCase only. Mirrors edf-mapping
// / bridgeMaker (ex edf-implied; Phase 4/5).

const path = require('path');
const fs = require('fs');
const os = require('os');

const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();
const configFileProcessor = require('qtools-config-file-processor');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CONFIGS_DIR = path.join(projectRoot, 'configs');
const DATASTORES = path.join(projectRoot, 'dataStores');

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const equivalenceSubgraphFactory = require(path.join(CORE_LIB, 'equivalence-subgraph', 'equivalenceSubgraph'));
const curationFixture = require(path.join(__dirname, 'assets', 'curationInputs'));

// the SIF-anchor gating manifest (Phase-5 re-freeze, 181be81d) — the basedOn for this additive candidate.
const DEFAULT_GATING_MANIFEST =
	'181be81d4b7fb3c1e42867735e1d3dc36f312dc80ba694d63f4231b1a16467dd';
const EMBEDDING_DIMS = 1024;

// single PG-JSON array element -> scalar; list-valued property -> array.
const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);
const asList = (value) =>
	Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

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

const strParam = (name, fallback) => (commandLineParameters.values[name] || [])[0] || fallback;

// edge / node serialization (mirror edf-mapping/bridgeMaker): every property value a PG-JSON array.
const toBlockEdge = (oneEdge) => {
	const properties = {};
	Object.keys(oneEdge.properties || {}).forEach((oneKey) => {
		const value = oneEdge.properties[oneKey];
		properties[oneKey] = Array.isArray(value) ? value : [value];
	});
	return { type: oneEdge.type, fromRef: oneEdge.fromRef, toRef: oneEdge.toRef, properties };
};
const toBlockNode = (oneNode) => {
	const properties = {};
	Object.keys(oneNode.properties || {}).forEach((oneKey) => {
		const value = oneNode.properties[oneKey];
		properties[oneKey] = Array.isArray(value) ? value : [value];
	});
	return { ref: oneNode.ref, stableId: oneNode.stableId, labels: oneNode.labels, properties };
};

// =====================================================================
const buildSharedResources = (callback) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.init({ dbPath: path.join(DATASTORES, 'forgeStore.sqlite3') }, (err) => next(err, args));
	});
	pipeRunner(taskList.getList(), {}, (err) => {
		if (err) {
			callback(err);
			return;
		}
		callback('', { forgeStore });
	});
};

// load a manifest's members; locate + deserialize the CEDS 'reference' block and the source 'standard' block.
//   -> { members, sourceRow, referenceRow, sourceBlock, referenceBlock, subjectVersion, objectVersion }
const loadBlocks = ({ forgeStore, manifestKey, sourceStandard }, callback) => {
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey }, (err, manifest) => {
			if (err || !manifest) {
				next(err || `no manifest '${manifestKey}'`);
				return;
			}
			next('', { ...args, members: manifest.members || [] });
		});
	});
	taskList.push((args, next) => {
		let referenceRow = null;
		let sourceRow = null;
		const sub = new taskListPlus();
		args.members.forEach((oneMember) => {
			sub.push((a2, n2) => {
				forgeStore.getBlock({ blockId: oneMember.blockId }, (err, row) => {
					if (err) {
						n2(err);
						return;
					}
					if (row && row.type === 'reference' && row.subject === 'CEDS') referenceRow = row;
					if (row && row.type === 'standard' && row.subject === sourceStandard) sourceRow = row;
					n2('', a2);
				});
			});
		});
		pipeRunner(sub.getList(), {}, (err) => {
			if (err) {
				next(err);
				return;
			}
			if (!referenceRow) next("no CEDS 'reference' block in the manifest (run edf-reference first)");
			else if (!sourceRow) next(`no '${sourceStandard}' standard block in the manifest`);
			else next('', { ...args, referenceRow, sourceRow });
		});
	});
	taskList.push((args, next) => {
		const sourceBlock = replayBlock.deserializeBlock(args.sourceRow.text);
		const referenceBlock = replayBlock.deserializeBlock(args.referenceRow.text);
		next('', {
			...args,
			sourceBlock,
			referenceBlock,
			subjectVersion: sourceBlock.header.version || '',
			objectVersion: referenceBlock.header.version || '',
		});
	});
	pipeRunner(taskList.getList(), {}, (err, args) => callback(err, args));
};

// =====================================================================
// ACTION: -emit (curated EXACT_MATCH + reified MappingAssertion block + candidate manifest)
// =====================================================================
const handleEmit = (resources, callback) => {
	const { xLog } = process.global;
	const { forgeStore } = resources;
	const gatingManifest = strParam('gatingManifest', DEFAULT_GATING_MANIFEST);
	const sourceStandard = curationFixture.sourceStandard || 'SIF';
	const label = strParam('label', 'phase6-equivalence-candidate');

	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		loadBlocks({ forgeStore, manifestKey: gatingManifest, sourceStandard }, (err, loaded) =>
			next(err, { ...args, ...loaded }),
		);
	});
	taskList.push((args, next) => {
		const builder = equivalenceSubgraphFactory({
			curationPredicate: 'exactMatch',
			mappingJustification: 'semapv:ManualMappingCuration',
			subjectSource: sourceStandard,
			subjectVersion: args.subjectVersion,
			objectSource: 'CEDS',
			objectVersion: args.objectVersion,
			mappingTool: 'edf-equivalence',
		});
		const curationInputs = curationFixture.promotions || [];
		const subgraph = builder.buildCurationSubgraph({
			curationInputs,
			sourceNodes: args.sourceBlock.nodes,
			referenceNodes: args.referenceBlock.nodes,
		});
		xLog.status(
			`[edf-equivalence -emit] curation inputs=${subgraph.counts.curationInputsConsidered} -> ` +
				`curated EXACT_MATCH=${subgraph.counts.curatedExactMatchEdges}, MappingAssertion nodes=` +
				`${subgraph.counts.reifiedAssertionNodes}, reify edges=${subgraph.counts.reifyEdges} ` +
				`(orphans=${subgraph.counts.orphans}, fromGaps=${subgraph.counts.fromGaps})`,
		);
		if (subgraph.orphans.length > 0) {
			xLog.status(`[edf-equivalence -emit] ORPHANS: ${JSON.stringify(subgraph.orphans)}`);
		}
		if (subgraph.diagnostics.fromGaps.length > 0) {
			xLog.status(`[edf-equivalence -emit] FROM-GAPS: ${JSON.stringify(subgraph.diagnostics.fromGaps)}`);
		}
		next('', { ...args, subgraph });
	});
	taskList.push((args, next) => {
		const header = {
			blockType: 'curatedMapping',
			standardKey: sourceStandard,
			version: args.subjectVersion,
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
			nodes: args.subgraph.nodes.map(toBlockNode),
			edges: args.subgraph.edges.map(toBlockEdge),
		});
		forgeStore.saveBlock(
			{
				type: 'mapping',
				subject: sourceStandard,
				version: args.subjectVersion,
				requires: [args.sourceRow.blockId, args.referenceRow.blockId],
				text: blockText,
				producedBy: 'edf-equivalence',
			},
			(err, result) => {
				if (err) {
					next(`saveBlock(curatedMapping) failed: ${err}`);
					return;
				}
				xLog.status(
					`[edf-equivalence -emit] curated mapping block saved: ${result.blockId.slice(0, 12)}… ` +
						`(${blockText.split('\n').filter(Boolean).length} lines)`,
				);
				next('', { ...args, mappingBlockId: result.blockId });
			},
		);
	});
	taskList.push((args, next) => {
		const members = args.members
			.map((oneMember) => ({ blockId: oneMember.blockId, position: null }))
			.concat([{ blockId: args.mappingBlockId, position: null }]);
		forgeStore.saveManifest(
			{
				label,
				basedOn: gatingManifest,
				note: `Phase 6 additive candidate: gating golden + ${sourceStandard} curated EXACT_MATCH promotions (reify-on-demand MappingAssertion)`,
				members,
			},
			(err, result) => next(err, err ? null : { ...args, candidateManifestKey: result.manifestKey }),
		);
	});
	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		process.global.xLog.result(
			JSON.stringify(
				{
					action: 'emit',
					gatingManifest,
					sourceStandard,
					mappingBlockId: args.mappingBlockId,
					candidateManifestKey: args.candidateManifestKey,
					curatedExactMatchEdges: args.subgraph.counts.curatedExactMatchEdges,
					reifiedAssertionNodes: args.subgraph.counts.reifiedAssertionNodes,
					reifyEdges: args.subgraph.counts.reifyEdges,
					orphans: args.subgraph.orphans,
					fromGaps: args.subgraph.diagnostics.fromGaps,
				},
				null,
				2,
			),
		);
		callback('');
	});
};

// =====================================================================
// ACTION: -conservativity (producer-side report: gather EXACT_MATCH from a manifest, run the pure check)
// =====================================================================
// resolve ALL HubReference stableIds carrying a given base property (canonicalKey/propertyKey) — multiplicity
// safe (Fix 3): a property realized by >1 HubReference cannot hide a bridge.
const refsByProperty = ({ referenceNodes, propertyKey }) => {
	const out = [];
	(referenceNodes || []).forEach((oneNode) => {
		const props = oneNode.properties || {};
		if (v1(props.role) !== 'HubReference') {
			return;
		}
		if (v1(props.canonicalKey) === propertyKey || v1(props.propertyKey) === propertyKey) {
			out.push(oneNode.stableId);
		}
	});
	return out;
};

const handleConservativity = (resources, callback) => {
	const { xLog } = process.global;
	const { forgeStore } = resources;
	const manifestKey = strParam('manifest', strParam('gatingManifest', DEFAULT_GATING_MANIFEST));
	const sourceStandard = curationFixture.sourceStandard || 'SIF';

	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		loadBlocks({ forgeStore, manifestKey, sourceStandard }, (err, loaded) =>
			next(err, { ...args, ...loaded }),
		);
	});
	// gather EXACT_MATCH edges across ALL 'mapping' blocks in the manifest.
	taskList.push((args, next) => {
		const exactMatchEdges = [];
		const sub = new taskListPlus();
		args.members.forEach((oneMember) => {
			sub.push((a2, n2) => {
				forgeStore.getBlock({ blockId: oneMember.blockId }, (err, row) => {
					if (err) {
						n2(err);
						return;
					}
					if (row && row.type === 'mapping') {
						const block = replayBlock.deserializeBlock(row.text);
						(block.edges || []).forEach((oneEdge) => {
							if (oneEdge.type === 'EXACT_MATCH') {
								exactMatchEdges.push({ fromId: oneEdge.fromRef.id, toId: oneEdge.toRef.id });
							}
						});
					}
					n2('', a2);
				});
			});
		});
		pipeRunner(sub.getList(), {}, (err) => next(err, err ? null : { ...args, exactMatchEdges }));
	});
	taskList.push((args, next) => {
		const referenceNodes = args.referenceBlock.nodes;
		const builder = equivalenceSubgraphFactory({ subjectSource: sourceStandard });
		// (A) the GENERAL structural invariant (no list): same base property, differing qualifier.
		const general = builder.checkQualifierConservativity({ exactMatchEdges: args.exactMatchEdges, referenceNodes });
		// (B) explicit DIFFERENT-PROPERTY pairs (multiplicity-safe ref sets).
		const diffPropPairs = (curationFixture.differentPropertyMustNeverMerge || []).map((onePair) => ({
			label: onePair.label,
			refsA: refsByProperty({ referenceNodes, propertyKey: onePair.propertyA }),
			refsB: refsByProperty({ referenceNodes, propertyKey: onePair.propertyB }),
		}));
		const explicit = builder.checkConservativity({ exactMatchEdges: args.exactMatchEdges, mustNeverMergePairs: diffPropPairs });
		const clusters = builder.buildEquivalenceClusters({ exactMatchEdges: args.exactMatchEdges });
		next('', { ...args, general, explicit, diffPropPairs, clusters });
	});
	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		process.global.xLog.result(
			JSON.stringify(
				{
					action: 'conservativity',
					manifestKey,
					exactMatchEdges: args.exactMatchEdges.length,
					equivalenceClusters: args.clusters.counts.equivalenceClusters,
					generalQualifierInvariant: {
						pass: args.general.pass,
						sourcesChecked: args.general.counts.sourcesChecked,
						violations: args.general.violations.slice(0, 20),
					},
					differentPropertyPairs: {
						pass: args.explicit.pass,
						pairs: args.diffPropPairs.map((p) => ({ label: p.label, refsA: p.refsA.length, refsB: p.refsB.length })),
						violations: args.explicit.violations,
					},
					pass: args.general.pass && args.explicit.pass,
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
const dispatchMap = { emit: handleEmit, conservativity: handleConservativity };

const main = () => {
	bootstrapGlobal();
	const { xLog } = process.global;
	const action = Object.keys(commandLineParameters.switches).find((s) => dispatchMap[s]);
	if (!action) {
		xLog.error(
			'edf-equivalence: unknown action. Actions: -emit | -conservativity. Params: --gatingManifest= --manifest= --label=',
		);
		process.exit(2);
	}
	buildSharedResources((err, resources) => {
		if (err) {
			xLog.error(`edf-equivalence bootstrap failed: ${err}`);
			process.exit(2);
		}
		dispatchMap[action](resources, (handlerErr) => {
			if (handlerErr) {
				xLog.error(`[edf-equivalence] ERROR: ${handlerErr}`);
				process.exit(1);
			}
			process.exit(0);
		});
	});
};

main();
