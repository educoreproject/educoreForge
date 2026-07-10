#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edfInferred.js — the `edf-inferred` CLI: PHASE-5 INFERRED-track producer (probabilistic track).
// (Renamed from bridge-maker/bridgeMaker.js 2026-07-10 per spec §9 D2; earlier from
// edf-implied/edfImplied.js 2026-07-04. Frozen blocks minted before the renames carry
// producedBy/mappingTool 'edf-implied' or 'bridgeMaker' as honest history; as of Phase C
// this module stamps 'edf-inferred' (the producedBy pin), subject = the pair 'CEDS::<spoke>',
// version = the version key '(a,b)', with pair fields + tierScope in the header (spec §4).
// Mixed stamps across eras are expected — frozen history is never rewritten.)
//
//   edfInferred -accuracy [--gatingManifest=K] [--limit=N] [--cosineFloor=F] [--concurrency=C]
//   edfInferred -emit --scope=sifAnchor [--sampleSize=N] [--gatingManifest=K] [--cosineFloor=F] ...
//
// -accuracy : the PRODUCER-ACCURACY gate (production-time, vs Appendix A). Runs the inference pipeline on
//   the Ed-Fi gold harness (the authored crosswalk frame) and reports recall@15, reranker-only rank-1,
//   end-to-end rank-1, abstention accuracy, false-NONE. NOT a replay gate — it measures the LLM pipeline.
// -emit : runs the inference pipeline ONCE over a SCOPED crosswalk-less source set (default: the SIF
//   person/identifier anchor set + a representative sample), FREEZES every decision (pick/abstain + pools +
//   scores) into a content-addressed 'inferredDecision' block (blockId = its content hash = the pin), then
//   PURELY materializes the non-abstain picks into CLOSE_MATCH edges (reusing the Phase-4 resolver), saves
//   ONE additive blockType:'inferredMapping' edge block stamped with the decision-block hash, and assembles
//   a CANDIDATE manifest = gating members + the edge block. The decision block is NOT a manifest member
//   (non-materializing) so the all-scope diff stays EXACTLY the new closeMatch edges. STRICTLY ADDITIVE;
//   NEVER touches the production golden / golden pointer; NEVER commits. Replay makes ZERO LLM calls.
//
// Action flags single-hyphen; parameters double-hyphen. qtools taskListPlus/pipeRunner; no async/await,
// no try/catch for control flow. camelCase only. Mirrors edf-mapping/edf-reference (Phase 3/4).

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
const inferredSubgraphFactory = require(path.join(CORE_LIB, 'inferred-subgraph', 'inferredSubgraph'));
const nodeLoaderFactory = require(path.join(CORE_LIB, 'node-loader', 'node-loader'));
const defEmbedderFactory = require(path.join(CORE_LIB, 'def-embedder', 'def-embedder'));
const inferencePipelineFactory = require(path.join(CORE_LIB, 'inference-pipeline', 'inference-pipeline'));
const llmClientFactory = require(path.join(CORE_LIB, 'llm-client', 'llm-client'));
const goldHarnessFactory = require(path.join(CORE_LIB, 'gold-harness', 'gold-harness'));
const valueScope = require(path.join(__dirname, 'lib', 'value-scope'));
const valueCrosswalk = require(path.join(projectRoot, 'code', 'cli', 'bridge-maker', 'edf-mapping', 'lib', 'value-crosswalk'));

// pair-keying (spec §4/§7.1, Phase C): fresh emissions stamp subject = 'CEDS::<spoke>' with
// the version key read from the discovery bindings of the two standards.
const standardDiscovery = require(path.join(projectRoot, 'code', 'cli', 'lib.d', 'forger', 'lib', 'standard-discovery'));
const pairBinding = require(path.join(CORE_LIB, 'pair-binding', 'pair-binding'))({});

// resolveEmitPairBinding — the discovery-bound pair stamp for one spoke; a named error is
// FATAL to the action (a fresh emission without a complete version key would be rejected
// at the saveBlock choke point anyway — fail here, earlier and clearer).
const resolveEmitPairBinding = ({ spokeStandardName, warn }) =>
	pairBinding.resolvePairBinding({
		roster: standardDiscovery.roster({ includeSynthetic: true }),
		hubStandardName: standardDiscovery.cedsHubStandardName,
		spokeStandardName,
		warn,
	});

// headerTierScope — guarded read of a mapping block row's header tierScope (Phase C+ blocks
// declare it; pre-Phase-C blocks carry none and are read by the legacy subject convention).
const headerTierScope = (row) => {
	let header;
	try {
		header = JSON.parse(`${row.text}`.split('\n')[0]);
	} catch (parseErr) {
		return null;
	}
	return header && header.tierScope ? header.tierScope : null;
};

// isPropertyTierMappingRowForSource — the ONE gating discrimination (M14 convention, Phase-C
// form): legacy rows match by bare subject EXACTLY (the '-value' suffix can never match);
// pair-keyed rows match by pair subject + declared tierScope 'property'. tierScope and the
// edge property provenanceTier are DIFFERENT AXES (tierScope = granularity level;
// provenanceTier = authorship class) — never conflate them.
const isPropertyTierMappingRowForSource = ({ row, sourceStandard, pairSubject }) => {
	if (row.subject === sourceStandard) {
		return true; // legacy bare-subject convention (pre-Phase-C blocks)
	}
	return pairSubject != null && row.subject === pairSubject && headerTierScope(row) === 'property';
};

const DEFAULT_GATING_MANIFEST =
	'14665fcf49c3614ce7f8448b729545e7194bee50a598fa721cbd4c1431d6d12d';
const TOP_K = 15;
// Appendix-A thresholds, DATA-DERIVED for the chosen model (WILD_FALCON ruling 2026-06-30). The PLAN's
// "reranker >= 0.85" is the SONNET/HAIKU regime; OPUS (the abstain-first choice) has a measured reranker-only
// of ~0.80 (eval 0.824; this build 0.799 within prompt-reconstruction drift), and a wrong closeMatch is
// structurally safe (only exactMatch composes to equivalence — Phase 6), so the Opus reranker floor is set
// data-derived to 0.78. recall@15 floor 0.85 (measured 0.871; the PLAN's 0.89 was a mislabel == recall@25 0.903).
const APPENDIX_A = {
	recallFloor: 0.85,
	rerankerFloor: 0.78,
	recallNote: 'measured recall@15=0.871; PLAN 0.89 == recall@25 (0.903); K=15 kept',
	rerankerNote: 'OPUS data-derived floor (eval 0.824 / this build 0.799); the 0.85 was Sonnet/Haiku; wrong closeMatch is structurally safe',
};

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

const intParam = (name, fallback) => {
	const v = (commandLineParameters.values[name] || [])[0];
	return v === undefined ? fallback : parseInt(v, 10);
};
const floatParam = (name, fallback) => {
	const v = (commandLineParameters.values[name] || [])[0];
	return v === undefined ? fallback : parseFloat(v);
};
const strParam = (name, fallback) => (commandLineParameters.values[name] || [])[0] || fallback;

// edge serialization shape (mirror edf-mapping.toBlockEdge): every property value a PG-JSON array.
const toBlockEdge = (oneEdge) => {
	const properties = {};
	Object.keys(oneEdge.properties || {}).forEach((oneKey) => {
		const value = oneEdge.properties[oneKey];
		properties[oneKey] = Array.isArray(value) ? value : [value];
	});
	return { type: oneEdge.type, fromRef: oneEdge.fromRef, toRef: oneEdge.toRef, properties };
};

// =====================================================================
// shared resources
// =====================================================================
const buildSharedResources = (callback) => {
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
			callback(err);
			return;
		}
		// pass-through config knobs (Phase C injection-survey adjudication): behavior-neutral
		// when unused — an undefined value leaves each client's own default in force. These are
		// the doors the zero-spend recipe points at keyless scratch inis.
		const llmClient = llmClientFactory({
			model: strParam('model', undefined),
			configFilePath: strParam('configFilePath', undefined),
		});
		const defEmbedder = defEmbedderFactory({
			cacheFilePath: path.join(DATASTORES, 'phase5DefEmbCache.json'),
			embeddingConfigFilePath: strParam('embeddingConfigFilePath', undefined),
		});
		const nodeLoader = nodeLoaderFactory();
		const cosineFloor = floatParam('cosineFloor', 0);
		const concurrency = intParam('concurrency', 8);
		const pipeline = inferencePipelineFactory({ llmClient, topK: TOP_K, cosineFloor, concurrency });
		callback('', { forgeStore, llmClient, defEmbedder, nodeLoader, pipeline, cosineFloor, concurrency });
	});
};

// read the gating manifest and return the deserialized blocks we need.
//   -> { members, cedsRecords (by role idx), referenceBlock {row, nodes}, sourceRow, sourceRecords }
const loadBlocks = ({ forgeStore, nodeLoader, gatingManifest, sourceStandard, pairSubject }, callback) => {
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey: gatingManifest }, (err, manifest) => {
			if (err || !manifest) {
				next(err || `no gating manifest '${gatingManifest}'`);
				return;
			}
			next('', { ...args, members: manifest.members || [] });
		});
	});
	taskList.push((args, next) => {
		let cedsRow = null;
		let referenceRow = null;
		let sourceRow = null;
		// property-tier mapping blocks for this source standard (type 'mapping', subject EXACTLY the
		// standard — the value tier writes subject '<standard>-value', which must NOT gate itself).
		// Collected here (same member pass, no extra store reads) for -emit --tier=value's discovery
		// of the CURRENT matchedMappingBlock within the gating manifest.
		const propertyMappingRows = [];
		const sub = new taskListPlus();
		args.members.forEach((oneMember) => {
			sub.push((a2, n2) => {
				forgeStore.getBlock({ blockId: oneMember.blockId }, (err, row) => {
					if (err) {
						n2(err);
						return;
					}
					if (row && row.type === 'standard' && row.subject === 'CEDS') cedsRow = row;
					if (row && row.type === 'reference' && row.subject === 'CEDS') referenceRow = row;
					if (row && row.type === 'standard' && row.subject === sourceStandard) sourceRow = row;
					// property-tier gating match, Phase-C form: legacy bare subject OR pair subject +
					// declared tierScope 'property' (the tierScope-preferential compatibility contract).
					if (
						row &&
						row.type === 'mapping' &&
						isPropertyTierMappingRowForSource({ row, sourceStandard, pairSubject })
					)
						propertyMappingRows.push(row);
					n2('', a2);
				});
			});
		});
		pipeRunner(sub.getList(), {}, (err) => {
			if (err) {
				next(err);
				return;
			}
			if (!cedsRow) next("no CEDS 'standard' block in the gating manifest");
			else if (!referenceRow) next("no CEDS 'reference' block (run edf-reference first)");
			else if (!sourceRow) next(`no '${sourceStandard}' standard block in the gating manifest`);
			else next('', { ...args, cedsRow, referenceRow, sourceRow, propertyMappingRows });
		});
	});
	taskList.push((args, next) => {
		const cedsBlock = nodeLoader.deserialize(args.cedsRow.text);
		const referenceBlock = nodeLoader.deserialize(args.referenceRow.text);
		const sourceBlock = nodeLoader.deserialize(args.sourceRow.text);
		const cedsRecords = nodeLoader.collapseNodes(cedsBlock.nodes);
		const sourceRecords = nodeLoader.collapseNodes(sourceBlock.nodes);
		next('', {
			...args,
			cedsRecords,
			sourceRecords,
			cedsClassIndex: nodeLoader.buildClassIndex(cedsRecords),
			sourceClassIndex: nodeLoader.buildClassIndex(sourceRecords),
			referenceNodes: referenceBlock.nodes,
			sourceVersion: sourceBlock.header.version || '',
			referenceVersion: referenceBlock.header.version || '',
		});
	});
	pipeRunner(taskList.getList(), {}, (err, args) => {
		callback(err, args);
	});
};

// embed defText for candidate property pool + a chosen source set; attach .vector in place.
const attachVectors = ({ defEmbedder, candidateRecords, sourceRecords }, callback) => {
	const allRecords = candidateRecords.concat(sourceRecords);
	const texts = allRecords.map((r) => r.defText);
	defEmbedder.batchEmbed({ texts }, (err, result) => {
		if (err) {
			callback(err);
			return;
		}
		allRecords.forEach((r, i) => {
			r.vector = result.vectors[i];
		});
		callback('');
	});
};

// deterministic JSON for the frozen decision record (sorted by source stableId).
//   The in-text requires field declares the SAME full derivation inputs as the containing
//   block's store-row requires (M3 shape): source + reference + the CEDS standard block that
//   supplied the candidate pool, + (value tier only) the property-tier mapping block that
//   scoped it. Previously the in-text field under-declared [source, reference] while the
//   store row declared more — the frozen record now tells the same truth as the store.
const serializeDecisions = ({
	sourceStandard,
	gatingManifest,
	sourceBlockId,
	referenceBlockId,
	cedsStandardBlockId,
	matchedMappingBlockId,
	gapFill,
	decisions,
	pairStamp,
	tierScope,
}) => {
	const sorted = decisions
		.map((d) => ({
			fromStableId: d.source.stableId,
			role: d.source.role,
			abstain: d.abstain,
			abstainReason: d.abstainReason || null,
			targetKey: d.targetKey || null,
			chosenStableId: d.chosenStableId || null,
			retrievalRank: typeof d.retrievalRank === 'number' ? d.retrievalRank : null,
			cosineScore: typeof d.cosineScore === 'number' ? d.cosineScore : null,
			bestCosine: typeof d.bestCosine === 'number' ? d.bestCosine : null,
			pool: d.pool,
		}))
		.sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : a.fromStableId > b.fromStableId ? 1 : 0));
	return JSON.stringify(
		{
			recordType: 'inferredDecisionRecord',
			phase: 5,
			method: 'definitionEmbedding-opusRerank-v1',
			// pair/version-key fields (spec §4.4 — the decision record is a per-pair audit record;
			// the whole single-line record IS the block's first line, so these fields are what the
			// saveBlock choke point validates). tierScope: granularity level (property|value),
			// a DIFFERENT AXIS from the edges' provenanceTier (authorship class).
			...(pairStamp
				? {
						pairA: pairStamp.pairA,
						pairAVersion: pairStamp.pairAVersion,
						pairB: pairStamp.pairB,
						pairBVersion: pairStamp.pairBVersion,
						publishedVersionA: pairStamp.publishedVersionA,
						publishedVersionB: pairStamp.publishedVersionB,
					}
				: {}),
			...(tierScope ? { tierScope } : {}),
			sourceStandard,
			topK: TOP_K,
			basedOnGatingManifest: gatingManifest,
			requires: [sourceBlockId, referenceBlockId, cedsStandardBlockId].concat(
				matchedMappingBlockId ? [matchedMappingBlockId] : [],
			),
			// A0.1 GAP-FILL record (CRIMSON condition 1): the ENGINE-computed gap set this run inferred
			// over, frozen here so the gate 'recorded set EQUALS a fresh recompute' has its recorded
			// side (see -gapCheck). Property tier only; the value tier freezes no gapFill.
			...(gapFill ? { gapFill } : {}),
			decisionCount: sorted.length,
			decisions: sorted,
		},
		null,
		0,
	);
};

// A0.1 GAP-FILL computation (WORKORDER-inferenceAndSelfDoc-070226, CRIMSON condition 1) — the
// inference maker's PERMANENT default policy: authored wins; inference fills only the un-authored
// remainder. The gap set is COMPUTED from store data every run (never a prepared list): the source
// standard's DmeProperty stableIds MINUS those carrying an authored PROPERTY-tier EXACT_MATCH in the
// gating manifest's property-tier mapping blocks (subject === sourceStandard EXACTLY — the value
// tier's '<standard>-value' subject is excluded by construction, so an authored VALUE edge never
// suppresses property inference; inferred property blocks in the manifest contribute nothing because
// they emit CLOSE_MATCH only, and a combined authored block's value-tier EXACT edges have value-node
// fromRefs that cannot collide with DmeProperty stableIds). Deterministic: sorted outputs only.
const computeAuthoredGapSet = ({ sourceRecords, propertyMappingRows, nodeLoader }) => {
	const authoredMappedFromIds = new Set();
	const consultedBlockIds = [];
	(propertyMappingRows || []).forEach((oneRow) => {
		consultedBlockIds.push(oneRow.blockId);
		const mappingBlock = nodeLoader.deserialize(oneRow.text);
		(mappingBlock.edges || []).forEach((oneEdge) => {
			if (oneEdge.type === 'EXACT_MATCH' && oneEdge.fromRef && oneEdge.fromRef.id) {
				authoredMappedFromIds.add(oneEdge.fromRef.id);
			}
		});
	});
	const allPropertyIds = sourceRecords
		.filter((oneRecord) => oneRecord.role === 'DmeProperty')
		.map((oneRecord) => oneRecord.stableId);
	const gapSetSorted = allPropertyIds
		.filter((oneId) => !authoredMappedFromIds.has(oneId))		.sort();
	return {
		policy: 'gapFill-authoredWins',
		consultedBlockIds: consultedBlockIds.slice().sort(),
		sourcePropertyCount: allPropertyIds.length,
		authoredMappedCount: allPropertyIds.length - gapSetSorted.length,
		gapCount: gapSetSorted.length,
		gapSetSorted,
	};
};

// =====================================================================
// ACTION: -accuracy (producer accuracy gate on the Ed-Fi gold harness)
// =====================================================================
const handleAccuracy = (resources, callback) => {
	if (strParam('tier', 'property') === 'value') {
		handleAccuracyValue(resources, callback);
		return;
	}
	const { xLog } = process.global;
	const { forgeStore, nodeLoader, defEmbedder, pipeline, cosineFloor } = resources;
	const gatingManifest = strParam('gatingManifest', DEFAULT_GATING_MANIFEST);
	const limit = intParam('limit', 0);

	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		loadBlocks({ forgeStore, nodeLoader, gatingManifest, sourceStandard: 'EdFi' }, (err, loaded) =>
			next(err, { ...args, ...loaded }),
		);
	});
	taskList.push((args, next) => {
		const gold = goldHarnessFactory().loadGoldFrame();
		// index EdFi sources by stableId
		const sourceById = {};
		args.sourceRecords.forEach((r) => {
			sourceById[r.stableId] = r;
		});
		// build harness: positives (with goldToken) + negatives (goldToken null), only those materialized.
		let harness = [];
		const goldByStableId = {};
		gold.positives.forEach((p) => {
			const src = sourceById[p.fromStableId];
			if (src) {
				goldByStableId[p.fromStableId] = p.goldToken;
				harness.push({ src, label: 'positive', goldToken: p.goldToken });
			}
		});
		gold.negatives.forEach((n) => {
			const src = sourceById[n.fromStableId];
			if (src) {
				harness.push({ src, label: 'negative', goldToken: null });
			}
		});
		if (limit > 0) {
			harness = harness.slice(0, limit);
		}
		// candidate pool = CEDS DmeProperty (the crosswalk gold is property-tier).
		const candidateRecords = args.cedsRecords.filter((r) => r.role === 'DmeProperty');
		next('', { ...args, harness, candidateRecords, goldByStableId });
	});
	taskList.push((args, next) => {
		xLog.status(
			`[edfInferred -accuracy] harness=${args.harness.length} (pos+neg), CEDS property candidates=${args.candidateRecords.length}; embedding definitions…`,
		);
		const sourceRecords = args.harness.map((h) => h.src);
		attachVectors({ defEmbedder, candidateRecords: args.candidateRecords, sourceRecords }, (err) =>
			next(err, args),
		);
	});
	taskList.push((args, next) => {
		const candidatePoolByRole = { DmeProperty: args.candidateRecords };
		const sources = args.harness.map((h) => h.src);
		const labelByStableId = {};
		const goldByStableId = args.goldByStableId;
		args.harness.forEach((h) => {
			labelByStableId[h.src.stableId] = h.label;
		});
		xLog.status(`[edfInferred -accuracy] reranking ${sources.length} sources via ${resources.llmClient.model}…`);
		pipeline.processSources(
			{
				sources,
				candidatePoolByRole,
				sourceClassIndex: args.sourceClassIndex,
				candidateClassIndex: args.cedsClassIndex,
			},
			(err, out) => {
				if (err) {
					next(err);
					return;
				}
				// metrics
				let posTotal = 0;
				let negTotal = 0;
				let goldInPool = 0; // recall@15 numerator (positives whose gold token in top-15)
				let rerankerHit = 0; // pick==gold among gold-in-pool
				let e2eHit = 0; // pick==gold among ALL positives
				let negAbstain = 0; // negatives correctly abstained
				let falseNone = 0; // positives in-pool wrongly abstained
				out.decisions.forEach((d) => {
					const label = labelByStableId[d.source.stableId];
					if (label === 'positive') {
						posTotal++;
						const gold = goldByStableId[d.source.stableId];
						const inPool = d.pool.some((c) => c.cedsId === gold);
						if (inPool) {
							goldInPool++;
							if (!d.abstain && d.targetKey === gold) {
								rerankerHit++;
							}
							if (d.abstain) {
								falseNone++;
							}
						}
						if (!d.abstain && d.targetKey === gold) {
							e2eHit++;
						}
					} else if (label === 'negative') {
						negTotal++;
						if (d.abstain) {
							negAbstain++;
						}
					}
				});
				const round = (x) => Math.round(x * 1e4) / 1e4;
				const metrics = {
					model: resources.llmClient.model,
					cosineFloor,
					topK: TOP_K,
					positives: posTotal,
					negatives: negTotal,
					recallAt15: posTotal ? round(goldInPool / posTotal) : null,
					rerankerRank1: goldInPool ? round(rerankerHit / goldInPool) : null,
					endToEndRank1: posTotal ? round(e2eHit / posTotal) : null,
					abstentionAccuracy: negTotal ? round(negAbstain / negTotal) : null,
					falseNoneRate: goldInPool ? round(falseNone / goldInPool) : null,
					goldInPool,
				};
				next('', { ...args, metrics });
			},
		);
	});
	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		const m = args.metrics;
		const recallPass = m.recallAt15 !== null && m.recallAt15 >= APPENDIX_A.recallFloor;
		const rerankPass = m.rerankerRank1 !== null && m.rerankerRank1 >= APPENDIX_A.rerankerFloor;
		process.global.xLog.result(
			JSON.stringify(
				{
					action: 'accuracy',
					gatingManifest,
					metrics: m,
					thresholds: APPENDIX_A,
					verdict: {
						recallAt15: `${m.recallAt15} >= ${APPENDIX_A.recallFloor} -> ${recallPass ? 'PASS' : 'FAIL'}`,
						rerankerRank1: `${m.rerankerRank1} >= ${APPENDIX_A.rerankerFloor} -> ${rerankPass ? 'PASS' : 'FAIL'}`,
						green: recallPass && rerankPass,
					},
				},
				null,
				2,
			),
		);
		callback('');
	});
};

// =====================================================================
// ACTION: -accuracy --tier=value  (CODESET-VALUE Phase B — value gold harness + derived abstain floor)
// =====================================================================
//
// Measures the SCOPED-INFERRED value matcher (PLAN §5/§6 risk 3): retrieval+rerank is NEVER run against
// the global ~19,546 CEDS option values — every source is scoped to the option set of its OWN parent
// property (here: the SAME property the authored descriptor row itself names, isolating "how good is
// exact-shortcut + reranker GIVEN the correct scope" from the separate scope-DISCOVERY problem, which
// differs by standard — LIF resolves parent scope via a clean parentId chain (see -emit --tier=value
// below); Ed-Fi's descriptor->field relationship is many-to-one so graph-derived scope discovery is
// unreliable there, exactly the ambiguity documented in edf-mapping/lib/value-crosswalk.js).
//
// Gold = the SAME authored descriptor Yes/Yes rows Phase A already resolves deterministically (a KNOWN
// fromStableId -> KNOWN goldToken, KNOWN scope). A deterministic STRIDE SAMPLE (sorted by fromStableId) is
// the held-out measurement set — never used to influence matching, only to measure it.
//
// Two-step matcher per source (PLAN §5 steps 1-2): (1) exact notation/name shortcut within the scoped pool
// (no LLM, no confidence gate needed — it either matches text exactly or it doesn't); (2) for shortcut
// misses, retrieve top-K by definition-embedding cosine WITHIN THE SAME SCOPED POOL + Opus rerank (pick one
// or NONE). The abstain floor is DERIVED (not reused from the property-tier floor — PLAN's explicit
// instruction) from the LLM-rerank tier ONLY: a grid search over observed retrieval-cosine scores for the
// threshold that best separates CORRECT vs INCORRECT non-abstain picks (maximize kept-correct +
// excluded-incorrect), mirroring the property-tier reranker floor's data-derived methodology (WILD_FALCON
// 2026-06-30) applied fresh to the value tier's own confidence distribution.
const deriveAbstainFloor = (scoredDecisions) => {
	// scoredDecisions: [{ score, correct }] — non-abstain LLM-rerank picks only (exact-shortcut excluded;
	// it needs no confidence gate). Returns { floor, rationale, distribution }.
	if (scoredDecisions.length === 0) {
		return { floor: null, rationale: 'no LLM-rerank picks to derive a floor from', distribution: [] };
	}
	const candidates = Array.from(new Set(scoredDecisions.map((d) => d.score))).sort((a, b) => a - b);
	let best = { floor: candidates[0], objective: -1 };
	candidates.forEach((oneThreshold) => {
		let keptCorrect = 0;
		let excludedIncorrect = 0;
		scoredDecisions.forEach((d) => {
			if (d.score >= oneThreshold) {
				if (d.correct) keptCorrect++;
			} else if (!d.correct) {
				excludedIncorrect++;
			}
		});
		const objective = keptCorrect + excludedIncorrect;
		if (objective > best.objective) {
			best = { floor: oneThreshold, objective };
		}
	});
	const correctScores = scoredDecisions.filter((d) => d.correct).map((d) => d.score);
	const incorrectScores = scoredDecisions.filter((d) => !d.correct).map((d) => d.score);
	return {
		floor: Math.round(best.floor * 1e4) / 1e4,
		rationale: `grid search over ${candidates.length} observed cosine scores; maximizes (kept-correct + excluded-incorrect) = ${best.objective}/${scoredDecisions.length}`,
		distribution: {
			correctCount: correctScores.length,
			incorrectCount: incorrectScores.length,
			correctScoreRange: correctScores.length ? [Math.min(...correctScores), Math.max(...correctScores)] : null,
			incorrectScoreRange: incorrectScores.length ? [Math.min(...incorrectScores), Math.max(...incorrectScores)] : null,
		},
	};
};

const handleAccuracyValue = (resources, callback) => {
	const { xLog } = process.global;
	const { forgeStore, nodeLoader, defEmbedder, pipeline } = resources;
	const gatingManifest = strParam('gatingManifest', DEFAULT_GATING_MANIFEST);
	const sampleSize = intParam('sampleSize', 400);

	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		loadBlocks({ forgeStore, nodeLoader, gatingManifest, sourceStandard: 'EdFi' }, (err, loaded) =>
			next(err, { ...args, ...loaded }),
		);
	});
	// build the value-crosswalk indexes (needs the RAW ceds block nodes; loadBlocks only kept collapsed records)
	taskList.push((args, next) => {
		const cedsRawBlock = replayBlock.deserializeBlock(args.cedsRow.text);
		const valueIndex = valueCrosswalk.buildValueTargetIndex(cedsRawBlock.nodes);
		const propertyRangeOptionSetIndex = valueCrosswalk.buildPropertyRangeOptionSetIndex(args.referenceNodes);
		const goldResult = valueCrosswalk.loadAuthoredValueMappings({
			sourceStandard: 'EdFi',
			valueIndex,
			propertyRangeOptionSetIndex,
		});
		const sourceById = {};
		args.sourceRecords.forEach((r) => {
			sourceById[r.stableId] = r;
		});
		const positives = goldResult.authoredMappings.filter((m) => sourceById[m.fromStableId]);
		positives.sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : 1));
		const stride = Math.max(1, Math.floor(positives.length / sampleSize));
		const sampled = positives.filter((_, i) => i % stride === 0).slice(0, sampleSize);
		const optionSetCandidateIndex = valueScope.buildOptionSetCandidateIndex(args.cedsRecords);
		xLog.status(
			`[edfInferred -accuracy --tier=value] gold positives=${positives.length}, sampled (stride=${stride})=${sampled.length}`,
		);
		next('', { ...args, sourceById, sampled, optionSetCandidateIndex });
	});
	// split: exact-shortcut resolved (no LLM) vs needs-LLM-rerank
	taskList.push((args, next) => {
		const exactDecisions = [];
		const needsLlm = [];
		args.sampled.forEach((oneGold) => {
			const sourceRecord = args.sourceById[oneGold.fromStableId];
			const candidates = args.optionSetCandidateIndex[oneGold.rangeOptionSetId] || [];
			// L4: ambiguous multi-hit shortcuts (hit=null, ambiguousHits>1) fall to the LLM leg.
			const { hit } = valueScope.exactShortcut(sourceRecord, candidates);
			if (hit) {
				exactDecisions.push({ gold: oneGold, method: 'exactShortcut', correct: hit.canonicalKey === oneGold.valueToken });
			} else {
				needsLlm.push({ gold: oneGold, sourceRecord, candidates });
			}
		});
		xLog.status(
			`[edfInferred -accuracy --tier=value] exact-shortcut resolved ${exactDecisions.length} (${
				exactDecisions.filter((d) => d.correct).length
			} correct); ${needsLlm.length} need LLM rerank`,
		);
		next('', { ...args, exactDecisions, needsLlm });
	});
	// embed sources + the union of scoped candidates actually needed
	taskList.push((args, next) => {
		if (args.needsLlm.length === 0) {
			next('', { ...args, candidatesByOptionSet: {} });
			return;
		}
		const sourceRecords = args.needsLlm.map((n) => n.sourceRecord);
		const candidatesByOptionSet = {};
		const candidateUnion = [];
		const seen = new Set();
		args.needsLlm.forEach((n) => {
			candidatesByOptionSet[n.gold.rangeOptionSetId] = n.candidates;
			n.candidates.forEach((c) => {
				if (!seen.has(c.stableId)) {
					seen.add(c.stableId);
					candidateUnion.push(c);
				}
			});
		});
		xLog.status(
			`[edfInferred -accuracy --tier=value] embedding ${sourceRecords.length} sources + ${candidateUnion.length} scoped candidates…`,
		);
		attachVectors({ defEmbedder, candidateRecords: candidateUnion, sourceRecords }, (err) =>
			next(err, { ...args, candidatesByOptionSet }),
		);
	});
	// scoped retrieve + rerank (per-source pool via candidatePoolForSource)
	taskList.push((args, next) => {
		if (args.needsLlm.length === 0) {
			next('', { ...args, llmDecisions: [] });
			return;
		}
		const goldByStableId = {};
		args.needsLlm.forEach((n) => {
			goldByStableId[n.sourceRecord.stableId] = n.gold;
		});
		const sources = args.needsLlm.map((n) => n.sourceRecord);
		const candidatePoolForSource = (source) => args.candidatesByOptionSet[goldByStableId[source.stableId].rangeOptionSetId] || [];
		xLog.status(`[edfInferred -accuracy --tier=value] reranking ${sources.length} sources via ${resources.llmClient.model}…`);
		pipeline.processSources(
			{ sources, candidatePoolByRole: {}, candidatePoolForSource, sourceClassIndex: {}, candidateClassIndex: {} },
			(err, out) => {
				if (err) {
					next(err);
					return;
				}
				const llmDecisions = out.decisions.map((d) => ({
					decision: d,
					gold: goldByStableId[d.source.stableId],
					correct: !d.abstain && d.targetKey === goldByStableId[d.source.stableId].valueToken,
				}));
				next('', { ...args, llmDecisions });
			},
		);
	});
	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		const exactCorrect = args.exactDecisions.filter((d) => d.correct).length;
		const llmPicks = args.llmDecisions.filter((d) => !d.decision.abstain);
		const llmCorrectPicks = llmPicks.filter((d) => d.correct).length;
		const llmAbstains = args.llmDecisions.length - llmPicks.length;
		const scoredForFloor = llmPicks.map((d) => ({ score: d.decision.cosineScore, correct: d.correct }));
		const floorResult = deriveAbstainFloor(scoredForFloor);
		const totalConsidered = args.exactDecisions.length + args.llmDecisions.length;
		const totalCorrect = exactCorrect + llmCorrectPicks;
		const round = (x) => Math.round(x * 1e4) / 1e4;
		process.global.xLog.result(
			JSON.stringify(
				{
					action: 'accuracy',
					tier: 'value',
					gatingManifest,
					sampled: totalConsidered,
					exactShortcut: { count: args.exactDecisions.length, correct: exactCorrect, accuracy: args.exactDecisions.length ? round(exactCorrect / args.exactDecisions.length) : null },
					llmRerank: {
						count: args.llmDecisions.length,
						picks: llmPicks.length,
						picksCorrect: llmCorrectPicks,
						abstains: llmAbstains,
						rank1AccuracyAmongPicks: llmPicks.length ? round(llmCorrectPicks / llmPicks.length) : null,
					},
					endToEndAccuracy: totalConsidered ? round(totalCorrect / totalConsidered) : null,
					derivedAbstainFloor: floorResult,
				},
				null,
				2,
			),
		);
		callback('');
	});
};

// =====================================================================
// ACTION: -emit (scoped frozen-decision block + closeMatch edge block + candidate manifest)
// =====================================================================
const selectScopeSources = ({ sourceRecords, scope, sampleSize }) => {
	// the SIF person/identifier anchor set: identifier-reference properties (the Appendix-B #1 dependency).
	const isAnchor = (r) =>
		r.role === 'DmeProperty' &&
		/RefId$/i.test(r.name) &&
		/(student|staff|person|contact|teacher|employee)/i.test(r.name);
	const anchors = sourceRecords.filter(isAnchor);
	const anchorIds = new Set(anchors.map((r) => r.stableId));
	// a deterministic representative sample of OTHER DmeProperty sources (sorted by stableId).
	const others = sourceRecords
		.filter((r) => r.role === 'DmeProperty' && !anchorIds.has(r.stableId))
		.sort((a, b) => (a.stableId < b.stableId ? -1 : 1))
		.slice(0, sampleSize);
	const selected = anchors.concat(others);
	return { selected, anchorCount: anchors.length, sampleCount: others.length };
};

const handleEmit = (resources, callback) => {
	if (strParam('tier', 'property') === 'value') {
		handleEmitValue(resources, callback);
		return;
	}
	const { xLog } = process.global;
	const { forgeStore, nodeLoader, defEmbedder, pipeline, cosineFloor } = resources;
	const gatingManifest = strParam('gatingManifest', DEFAULT_GATING_MANIFEST);
	const sourceStandard = strParam('sourceStandard', 'SIF');
	const scope = strParam('scope', 'sifAnchor');
	const sampleSize = intParam('sampleSize', 50);
	const limit = intParam('limit', 0);
	const label = strParam('label', 'phase5-inferred-candidate');

	// incremental decision freezing (CRIMSON condition 8): each completed decision appends one slim
	// JSON line to the journal as it lands, so a mid-run failure loses minutes, not hours —
	// --resumeJournal= replays a prior run's lines and only the remainder is re-scored. The frozen
	// decision BLOCK is still minted once, at the end, from the union (serializeDecisions sorts, so
	// the block is byte-identical whether the run was interrupted or not).
	const decisionJournal = strParam(
		'decisionJournal',
		path.join(DATASTORES, 'emitJournals', `${sourceStandard}-property-pid${process.pid}.jsonl`),
	);
	const resumeJournal = strParam('resumeJournal', '');

	// the discovery-bound pair stamp (spec §7.1) — fatal when unresolvable: a fresh emission
	// without a complete version key is rejected at the saveBlock choke point anyway.
	const emitPairBinding = resolveEmitPairBinding({
		spokeStandardName: sourceStandard,
		warn: (message) => xLog.error(message),
	});
	if (emitPairBinding.error) {
		callback(`[edfInferred -emit] ${emitPairBinding.error}`);
		return;
	}

	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		loadBlocks(
			{ forgeStore, nodeLoader, gatingManifest, sourceStandard, pairSubject: emitPairBinding.pairSubject },
			(err, loaded) => next(err, { ...args, ...loaded }),
		);
	});
	// A0.1 GAP-FILL (permanent default policy): compute the engine gap set and restrict selection to it.
	taskList.push((args, next) => {
		const gapFill = computeAuthoredGapSet({
			sourceRecords: args.sourceRecords,
			propertyMappingRows: args.propertyMappingRows,
			nodeLoader,
		});
		const gapIds = new Set(gapFill.gapSetSorted);
		const gapScopedSourceRecords = args.sourceRecords.filter(
			(oneRecord) => oneRecord.role !== 'DmeProperty' || gapIds.has(oneRecord.stableId),
		);
		xLog.status(
			`[edfInferred -emit] GAP-FILL (A0.1, authored wins): ${gapFill.sourcePropertyCount} ${sourceStandard} DmeProperty, ` +
				`${gapFill.authoredMappedCount} authored-mapped (PROPERTY-tier EXACT_MATCH), gap=${gapFill.gapCount}; ` +
				`consulted mapping block(s): ${gapFill.consultedBlockIds.map((oneId) => oneId.slice(0, 12)).join(', ') || '(none in gating manifest)'}`,
		);
		next('', { ...args, gapFill, gapScopedSourceRecords });
	});
	taskList.push((args, next) => {
		const sel = selectScopeSources({ sourceRecords: args.gapScopedSourceRecords, scope, sampleSize });
		let selected = sel.selected;
		if (limit > 0) {
			selected = selected.slice(0, limit);
		}
		const candidateRecords = args.cedsRecords.filter((r) => r.role === 'DmeProperty');
		xLog.status(
			`[edfInferred -emit] scope='${scope}' selected=${selected.length} (anchors=${sel.anchorCount}, sample=${sel.sampleCount}) of gap=${args.gapFill.gapCount} (${args.sourceRecords.filter((r) => r.role === 'DmeProperty').length} total ${sourceStandard} DmeProperty); candidates=${candidateRecords.length}`,
		);
		xLog.status(
			`[edfInferred -emit] DEFERRED SCOPE (NOT run, logged per WILD_FALCON no-silent-cap): all other ${sourceStandard} roles + any un-run crosswalk-less standards — a parameterized re-run, not new code.`,
		);
		next('', { ...args, selected, candidateRecords, scopeMeta: sel });
	});
	taskList.push((args, next) => {
		attachVectors({ defEmbedder, candidateRecords: args.candidateRecords, sourceRecords: args.selected }, (err) =>
			next(err, args),
		);
	});
	taskList.push((args, next) => {
		// resume: previously journaled decisions are replayed, not re-scored (no LLM re-spend)
		let resumedDecisions = [];
		if (resumeJournal) {
			if (!fs.existsSync(resumeJournal)) {
				next(`--resumeJournal file not found: ${resumeJournal}`);
				return;
			}
			resumedDecisions = fs
				.readFileSync(resumeJournal, 'utf8')
				.split('\n')
				.filter(Boolean)
				.map((oneLine) => JSON.parse(oneLine))
				.map((slim) => ({
					source: { stableId: slim.fromStableId, role: slim.role },
					abstain: slim.abstain,
					abstainReason: slim.abstainReason,
					targetKey: slim.targetKey,
					chosenStableId: slim.chosenStableId,
					chosenOrdinal: slim.chosenOrdinal,
					retrievalRank: slim.retrievalRank,
					cosineScore: slim.cosineScore,
					bestCosine: slim.bestCosine,
					pool: slim.pool,
				}));
		}
		const resumedIds = new Set(resumedDecisions.map((d) => d.source.stableId));
		const toScore = args.selected.filter((r) => !resumedIds.has(r.stableId));
		if (resumedDecisions.length > 0) {
			xLog.status(
				`[edfInferred -emit] resume: ${resumedDecisions.length} decision(s) replayed from ${resumeJournal}; ${toScore.length} still to score`,
			);
		}
		fs.mkdirSync(path.dirname(decisionJournal), { recursive: true });
		const journalFd = fs.openSync(decisionJournal, 'a');
		const journalDecision = (d) => {
			const slim = {
				fromStableId: d.source.stableId,
				role: d.source.role,
				abstain: d.abstain,
				abstainReason: d.abstainReason || null,
				targetKey: d.targetKey || null,
				chosenStableId: d.chosenStableId || null,
				chosenOrdinal: typeof d.chosenOrdinal === 'number' ? d.chosenOrdinal : null,
				retrievalRank: typeof d.retrievalRank === 'number' ? d.retrievalRank : null,
				cosineScore: typeof d.cosineScore === 'number' ? d.cosineScore : null,
				bestCosine: typeof d.bestCosine === 'number' ? d.bestCosine : null,
				pool: d.pool,
			};
			fs.writeSync(journalFd, `${JSON.stringify(slim)}\n`);
		};
		xLog.status(`[edfInferred -emit] decision journal (incremental freeze): ${decisionJournal}`);
		const candidatePoolByRole = { DmeProperty: args.candidateRecords };
		xLog.status(`[edfInferred -emit] reranking ${toScore.length} sources via ${resources.llmClient.model}…`);
		pipeline.processSources(
			{
				sources: toScore,
				candidatePoolByRole,
				sourceClassIndex: args.sourceClassIndex,
				candidateClassIndex: args.cedsClassIndex,
				onDecision: journalDecision,
			},
			(err, out) => {
				fs.closeSync(journalFd);
				next(err, err ? null : { ...args, decisions: resumedDecisions.concat(out.decisions) });
			},
		);
	});
	// FREEZE the decision record -> content-addressed block (NON-materializing; not a manifest member).
	taskList.push((args, next) => {
		const text = serializeDecisions({
			sourceStandard,
			gatingManifest,
			sourceBlockId: args.sourceRow.blockId,
			referenceBlockId: args.referenceRow.blockId,
			cedsStandardBlockId: args.cedsRow.blockId,
			gapFill: args.gapFill,
			decisions: args.decisions,
			pairStamp: emitPairBinding,
			tierScope: 'property',
		});
		forgeStore.saveBlock(
			{
				type: 'inferredDecision',
				subject: emitPairBinding.pairSubject,
				version: emitPairBinding.versionKey,
				// FULL derivation inputs (M3 pattern): the CEDS standard block supplied the
				// DmeProperty candidate pool these decisions chose from — declared like the
				// mapping block below already does.
				requires: [
					args.sourceRow.blockId,
					args.referenceRow.blockId,
					args.cedsRow.blockId,
				],
				text,
				producedBy: 'edf-inferred',
			},
			(err, result) => {
				if (err) {
					next(`saveBlock(inferredDecision) failed: ${err}`);
					return;
				}
				xLog.status(`[edfInferred -emit] frozen decision block: ${result.blockId.slice(0, 12)}… (pin)`);
				next('', { ...args, decisionBlockId: result.blockId });
			},
		);
	});
	// MATERIALIZE picks -> CLOSE_MATCH edges (pure), pinned to the decision-block hash.
	taskList.push((args, next) => {
		const inferredDecisions = args.decisions
			.filter((d) => !d.abstain && d.targetKey)
			.map((d) => ({
				fromStableId: d.source.stableId,
				targetKey: d.targetKey,
				confidence: typeof d.cosineScore === 'number' ? d.cosineScore : null,
				rerankScore: typeof d.cosineScore === 'number' ? d.cosineScore : null,
				cosineScore: typeof d.cosineScore === 'number' ? d.cosineScore : null,
				retrievalRank: typeof d.retrievalRank === 'number' ? d.retrievalRank : null,
			}));
		const builder = inferredSubgraphFactory({
			predicate: 'closeMatch',
			mappingJustification: 'semapv:SemanticSimilarity',
			subjectSource: sourceStandard,
			subjectVersion: args.sourceVersion,
			objectSource: 'CEDS',
			objectVersion: args.referenceVersion,
			mappingTool: 'edf-inferred',
			decisionBlockHash: args.decisionBlockId,
		});
		const subgraph = builder.buildInferredSubgraph({
			inferredDecisions,
			sourceNodes: args.sourceRecords,
			referenceNodes: args.referenceNodes,
		});
		const abstains = args.decisions.filter((d) => d.abstain).length;
		const abstainByReason = {};
		args.decisions.filter((d) => d.abstain).forEach((d) => {
			abstainByReason[d.abstainReason] = (abstainByReason[d.abstainReason] || 0) + 1;
		});
		xLog.status(
			`[edfInferred -emit] decisions=${args.decisions.length}: picks=${args.decisions.length - abstains}, abstains=${abstains} ${JSON.stringify(abstainByReason)}; CLOSE_MATCH edges=${subgraph.counts.edgesTotal} (orphans=${subgraph.counts.orphans}, fromGaps=${subgraph.counts.fromGaps})`,
		);
		next('', { ...args, subgraph, abstains, abstainByReason });
	});
	// serialize the inferredMapping edge block (edges only) + content-address.
	taskList.push((args, next) => {
		// L13: NO embedding metadata here — this block is EDGES ONLY (zero nodes, zero
		// embeddings); stamping model/dims was misleading provenance for header readers.
		// Phase C: the header carries the PAIR FIELDS instead of standardKey (spec §4.1/§4.2;
		// the manifestEditor header->row projection anticipates exactly this shape) + tierScope
		// ('property' — granularity axis, distinct from the edges' provenanceTier authorship axis).
		// The spoke's own version string stays in the preserved `version` field.
		const header = {
			blockType: 'inferredMapping',
			version: args.sourceVersion,
			stableUriPropertyName: 'uri',
			resolutionKey: 'uri',
			pairA: emitPairBinding.pairA,
			pairAVersion: emitPairBinding.pairAVersion,
			pairB: emitPairBinding.pairB,
			pairBVersion: emitPairBinding.pairBVersion,
			publishedVersionA: emitPairBinding.publishedVersionA,
			publishedVersionB: emitPairBinding.publishedVersionB,
			tierScope: 'property',
			decisionBlockHash: args.decisionBlockId,
			method: 'definitionEmbedding-opusRerank-v1',
		};
		const blockText = replayBlock.serializeBlock({
			header,
			nodes: [],
			edges: args.subgraph.edges.map(toBlockEdge),
		});
		forgeStore.saveBlock(
			{
				type: 'mapping',
				subject: emitPairBinding.pairSubject,
				version: emitPairBinding.versionKey,
				// FULL derivation inputs (M3 pattern): source + reference + the CEDS standard block
				// whose DmeProperty records supplied the candidate pool — every read input declared.
				requires: [
					args.sourceRow.blockId,
					args.referenceRow.blockId,
					args.cedsRow.blockId,
				],
				text: blockText,
				producedBy: 'edf-inferred',
			},
			(err, result) => {
				if (err) {
					next(`saveBlock(inferredMapping) failed: ${err}`);
					return;
				}
				xLog.status(
					`[edfInferred -emit] inferred mapping block saved: ${result.blockId.slice(0, 12)}… (${blockText.split('\n').filter(Boolean).length} lines)`,
				);
				next('', { ...args, mappingBlockId: result.blockId });
			},
		);
	});
	// assemble CANDIDATE manifest = gating members + the edge block (decision block NOT a member).
	taskList.push((args, next) => {
		const members = args.members
			.map((m) => ({ blockId: m.blockId, position: null }))
			.concat([{ blockId: args.mappingBlockId, position: null }]);
		forgeStore.saveManifest(
			{
				label,
				basedOn: gatingManifest,
				note: `Phase 5 additive candidate: gating golden + ${sourceStandard} inferred CLOSE_MATCH mappings (scope=${scope}); frozen decisions ${args.decisionBlockId.slice(0, 12)}…`,
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
					scope,
					selected: args.selected.length,
					scopeMeta: { anchorCount: args.scopeMeta.anchorCount, sampleCount: args.scopeMeta.sampleCount },
					decisionBlockId: args.decisionBlockId,
					mappingBlockId: args.mappingBlockId,
					candidateManifestKey: args.candidateManifestKey,
					closeMatchEdges: args.subgraph.counts.edgesTotal,
					picks: args.decisions.length - args.abstains,
					abstains: args.abstains,
					abstainByReason: args.abstainByReason,
					orphans: args.subgraph.orphans.slice(0, 10),
					fromGaps: args.subgraph.diagnostics.fromGaps.slice(0, 10),
				},
				null,
				2,
			),
		);
		callback('');
	});
};

// =====================================================================
// ACTION: -emit --tier=value  (CODESET-VALUE Phase C — scoped inferred CLOSE_MATCH, PLAN §5)
// =====================================================================
//
// The scoped inferred value matcher for crosswalk-less standards (default: LIF). A source option value is
// offered to matching ONLY within the option set of its OWN parent property's ALREADY-MATCHED CEDS target
// (resolved via a 2-hop parentId chain: value -> DmeOptionSet -> DmeProperty, then a lookup into the
// EXISTING mapping block's EXACT_MATCH/CLOSE_MATCH edges for that property — see value-scope.js). A source
// whose parent is unmatched, or whose match has no option set, is UNSCOPABLE and ABSTAINS (never global-
// retrieve as a hidden default — PLAN §5 rule 3, measured live: 648/1,873 LIF values, 34.6%).
//
// Two-step matcher per scoped source (PLAN §5 steps 1-2): (1) exact notation/name shortcut within the
// scoped pool (no LLM — measured live: 1,107/1,225 scoped LIF values, 90.4%, resolve here for FREE);
// (2) shortcut misses go through retrieve-top-K-by-cosine + Opus rerank, WITHIN THE SAME SCOPED POOL, gated
// by the Phase-B DERIVED floor (--abstainFloor=, default from the 070126 gold run) on the pick's retrieval
// cosine — a pick below the floor is converted to an abstain, never emitted.
//
// The gating property-tier mapping block (the parent-match set that scopes every value) is DISCOVERED
// within the gating manifest: the newest 'mapping' block whose subject is EXACTLY the source standard
// (createdAt, blockId tie-break). NO cross-build default — a manifest without one is a hard error.
// --matchedMappingBlock remains as an explicit operator pin.

const handleEmitValue = (resources, callback) => {
	const { xLog } = process.global;
	const { forgeStore, nodeLoader, defEmbedder, pipeline } = resources;
	const gatingManifest = strParam('gatingManifest', DEFAULT_GATING_MANIFEST);
	const sourceStandard = strParam('sourceStandard', 'LIF');
	const matchedMappingBlock = strParam('matchedMappingBlock', null);
	const abstainFloor = floatParam('abstainFloor', 0.3924); // Phase-B derived floor, 070126 gold run (see DEVLOG)
	// the property-tier reranker floor a CLOSE_MATCH parent must clear before it may scope child
	// values (EXACT_MATCH parents always pass) — value-scope confidence honesty.
	const scopeParentFloor = floatParam('scopeParentFloor', APPENDIX_A.rerankerFloor);
	const label = strParam('label', 'phase5-codesetValue-inferred-candidate');

	// the discovery-bound pair stamp (spec §7.1) — fatal when unresolvable.
	const emitPairBinding = resolveEmitPairBinding({
		spokeStandardName: sourceStandard,
		warn: (message) => xLog.error(message),
	});
	if (emitPairBinding.error) {
		callback(`[edfInferred -emit --tier=value] ${emitPairBinding.error}`);
		return;
	}

	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		loadBlocks(
			{ forgeStore, nodeLoader, gatingManifest, sourceStandard, pairSubject: emitPairBinding.pairSubject },
			(err, loaded) => next(err, { ...args, ...loaded }),
		);
	});
	// resolve the gating property-tier mapping block: explicit --matchedMappingBlock pin, else
	// discover within the gating manifest; ABSENT -> hard error (never a stale cross-build default).
	taskList.push((args, next) => {
		if (matchedMappingBlock) {
			forgeStore.getBlock({ blockId: matchedMappingBlock }, (err, row) => {
				if (err || !row) {
					next(err || `matchedMappingBlock '${matchedMappingBlock}' not found`);
					return;
				}
				const matchedBlock = replayBlock.deserializeBlock(row.text);
				next('', { ...args, matchedMappingBlockRow: row, matchedMappingEdges: matchedBlock.edges });
			});
			return;
		}
		const candidates = (args.propertyMappingRows || []).slice().sort((a, b) => {
			const ca = `${a.createdAt || ''}`;
			const cb = `${b.createdAt || ''}`;
			if (ca !== cb) return ca < cb ? 1 : -1; // newest first
			return a.blockId < b.blockId ? 1 : -1; // deterministic tie-break
		});
		if (candidates.length === 0) {
			next(
				`[edfInferred -emit --tier=value] no property-tier mapping block (type 'mapping', subject '${sourceStandard}') ` +
					`in gating manifest '${gatingManifest}' — the parent-match set that scopes values is MISSING. ` +
					`Emit the property tier first (edfInferred -emit / edf-mapping -build) or pin one explicitly ` +
					`with --matchedMappingBlock=. Refusing to default across builds.`,
			);
			return;
		}
		const row = candidates[0];
		if (candidates.length > 1) {
			xLog.status(
				`[edfInferred -emit --tier=value] ${candidates.length} property-tier mapping blocks for '${sourceStandard}' ` +
					`in the gating manifest; using newest ${row.blockId.slice(0, 12)}… (createdAt ${row.createdAt})`,
			);
		}
		xLog.status(
			`[edfInferred -emit --tier=value] matchedMappingBlock discovered in gating manifest: ${row.blockId.slice(0, 12)}…`,
		);
		const matchedBlock = replayBlock.deserializeBlock(row.text);
		next('', { ...args, matchedMappingBlockRow: row, matchedMappingEdges: matchedBlock.edges });
	});
	// build scope indexes + resolve every source's scope (or record it unscopable)
	taskList.push((args, next) => {
		const propertyRangeOptionSetIndex = valueScope.buildPropertyRangeOptionSetIndex(args.referenceNodes);
		const matchedTargetIndex = valueScope.buildMatchedTargetIndex(args.matchedMappingEdges);
		const optionSetCandidateIndex = valueScope.buildOptionSetCandidateIndex(args.cedsRecords);
		const sourceRecordsById = {};
		args.sourceRecords.forEach((r) => {
			sourceRecordsById[r.stableId] = r;
		});
		const sourceValues = args.sourceRecords.filter((r) => r.role === 'DmeOptionValue');
		const scoped = [];
		const unscopedDecisions = [];
		// M7 diagnostic: 'unscopedParent' is reserved for LEGITIMATE scoping outcomes (chain intact,
		// parent unmatched / not property-parented / matched target has no set); a broken parentId
		// chain is a CONTRACT VIOLATION in the source block and abstains as 'unresolvableParentChain'
		// — reported loudly below, never blended into unscopedParent.
		const contractViolationReasons = {
			valueParentIdMissing: true,
			optionSetParentIdMissing: true,
			parentUnresolvable: true,
		};
		const unscopableTally = {};
		sourceValues.forEach((oneValue) => {
			const { scope, unscopableReason } = valueScope.resolveValueParentScope({
				sourceValueRecord: oneValue,
				sourceRecordsById,
				matchedTargetIndex,
				propertyRangeOptionSetIndex,
				rerankerFloor: scopeParentFloor,
			});
			if (!scope) {
				unscopableTally[unscopableReason] = (unscopableTally[unscopableReason] || 0) + 1;
				unscopedDecisions.push({
					source: { stableId: oneValue.stableId, role: oneValue.role },
					abstain: true,
					abstainReason: contractViolationReasons[unscopableReason]
						? 'unresolvableParentChain'
						: 'unscopedParent',
					unscopableReason,
					targetKey: null,
					pool: [],
				});
				return;
			}
			scoped.push({ sourceRecord: oneValue, scope, candidates: optionSetCandidateIndex[scope.rangeOptionSetId] || [] });
		});
		const violationCount = Object.keys(contractViolationReasons).reduce(
			(sum, oneReason) => sum + (unscopableTally[oneReason] || 0),
			0,
		);
		if (violationCount > 0) {
			xLog.error(
				`[edfInferred -emit --tier=value] ${sourceStandard} parentId CONTRACT VIOLATION on ${violationCount}/${sourceValues.length} values (${JSON.stringify(unscopableTally)}) — the source block's parentId chain is broken (wrong referent or dangling); these abstains are a block defect, NOT a scoping outcome`,
			);
		}
		xLog.status(
			`[edfInferred -emit --tier=value] ${sourceStandard} DmeOptionValue=${sourceValues.length}; scoped=${scoped.length}, unscoped=${unscopedDecisions.length} byReason=${JSON.stringify(unscopableTally)} (scopeParentFloor=${scopeParentFloor}: CLOSE parents below it abstain as parentMatchBelowFloor)`,
		);
		next('', { ...args, scoped, unscopedDecisions });
	});
	// exact-shortcut split
	taskList.push((args, next) => {
		const exactDecisions = [];
		const needsLlm = [];
		const ambiguousShortcuts = []; // L4: multi-hit shortcut collisions — reported, routed to LLM
		args.scoped.forEach((oneScoped) => {
			const { hit, ambiguousHits } = valueScope.exactShortcut(oneScoped.sourceRecord, oneScoped.candidates);
			if (ambiguousHits.length > 1) {
				ambiguousShortcuts.push({
					sourceStableId: oneScoped.sourceRecord.stableId,
					collidingCandidates: ambiguousHits.map((oneHit) => oneHit.canonicalKey),
				});
			}
			if (hit) {
				exactDecisions.push({
					source: { stableId: oneScoped.sourceRecord.stableId, role: oneScoped.sourceRecord.role },
					abstain: false,
					abstainReason: null,
					targetKey: `${oneScoped.scope.targetPropertyKey}|${hit.canonicalKey}`,
					chosenStableId: hit.stableId,
					cosineScore: 1.0,
					bestCosine: 1.0,
					retrievalRank: 1,
					pool: [{ stableId: hit.stableId, cedsId: hit.canonicalKey, cosine: 1.0 }],
					method: 'exactShortcut',
					scopeParentPredicate: oneScoped.scope.parentPredicate,
					scopeParentConfidence: oneScoped.scope.parentConfidence,
				});
			} else {
				needsLlm.push(oneScoped);
			}
		});
		if (ambiguousShortcuts.length > 0) {
			xLog.status(
				`[edfInferred -emit --tier=value] L4 AMBIGUOUS exact-shortcut collisions (no deterministic pick — routed to LLM rerank): ${ambiguousShortcuts.length} source(s): ${JSON.stringify(ambiguousShortcuts.slice(0, 10))}${ambiguousShortcuts.length > 10 ? ' …' : ''}`,
			);
		}
		xLog.status(`[edfInferred -emit --tier=value] exact-shortcut resolved ${exactDecisions.length}; ${needsLlm.length} need LLM rerank (${ambiguousShortcuts.length} of those ambiguous multi-hit)`);
		next('', { ...args, exactDecisions, needsLlm });
	});
	// embed + scoped rerank for shortcut misses
	taskList.push((args, next) => {
		if (args.needsLlm.length === 0) {
			next('', { ...args, llmDecisions: [] });
			return;
		}
		const sourceRecords = args.needsLlm.map((n) => n.sourceRecord);
		const candidateUnion = [];
		const seen = new Set();
		const candidatesBySourceId = {};
		args.needsLlm.forEach((n) => {
			candidatesBySourceId[n.sourceRecord.stableId] = n.candidates;
			n.candidates.forEach((c) => {
				if (!seen.has(c.stableId)) {
					seen.add(c.stableId);
					candidateUnion.push(c);
				}
			});
		});
		xLog.status(`[edfInferred -emit --tier=value] embedding ${sourceRecords.length} sources + ${candidateUnion.length} scoped candidates…`);
		attachVectors({ defEmbedder, candidateRecords: candidateUnion, sourceRecords }, (err) =>
			next(err, { ...args, candidatesBySourceId }),
		);
	});
	taskList.push((args, next) => {
		if (args.needsLlm.length === 0) {
			next('', { ...args, llmDecisions: [] });
			return;
		}
		const sources = args.needsLlm.map((n) => n.sourceRecord);
		const candidatePoolForSource = (source) => args.candidatesBySourceId[source.stableId] || [];
		const targetPropertyKeyBySourceId = {};
		const scopeBySourceId = {};
		args.needsLlm.forEach((n) => {
			targetPropertyKeyBySourceId[n.sourceRecord.stableId] = n.scope.targetPropertyKey;
			scopeBySourceId[n.sourceRecord.stableId] = n.scope;
		});
		xLog.status(`[edfInferred -emit --tier=value] reranking ${sources.length} sources via ${resources.llmClient.model}…`);
		pipeline.processSources(
			{ sources, candidatePoolByRole: {}, candidatePoolForSource, sourceClassIndex: {}, candidateClassIndex: {} },
			(err, out) => {
				if (err) {
					next(err);
					return;
				}
				// gate picks by the DERIVED abstain floor (below-floor -> abstain, never emitted), and rewrite
				// targetKey to the COMPOSITE '${propertyKey}|${OVtoken}' form the resolver now requires (a bare
				// OV token is ambiguous — see mappingSubgraph.js buildReferenceIndex's baseValueRef comment).
				const gated = out.decisions.map((d) => {
					if (!d.abstain && typeof d.cosineScore === 'number' && d.cosineScore < abstainFloor) {
						return { ...d, abstain: true, abstainReason: 'belowValueFloor', targetKey: null };
					}
					if (!d.abstain && d.targetKey) {
						const scope = scopeBySourceId[d.source.stableId] || {};
						return {
							...d,
							targetKey: `${targetPropertyKeyBySourceId[d.source.stableId]}|${d.targetKey}`,
							scopeParentPredicate: scope.parentPredicate,
							scopeParentConfidence: scope.parentConfidence,
						};
					}
					return d;
				});
				next('', { ...args, llmDecisions: gated });
			},
		);
	});
	// FREEZE all decisions (exact + llm + unscoped) -> content-addressed block (NON-materializing).
	taskList.push((args, next) => {
		const decisions = args.exactDecisions.concat(args.llmDecisions).concat(args.unscopedDecisions);
		const text = serializeDecisions({
			sourceStandard,
			gatingManifest,
			sourceBlockId: args.sourceRow.blockId,
			referenceBlockId: args.referenceRow.blockId,
			cedsStandardBlockId: args.cedsRow.blockId,
			matchedMappingBlockId: args.matchedMappingBlockRow.blockId,
			decisions,
			pairStamp: emitPairBinding,
			tierScope: 'value',
		});
		forgeStore.saveBlock(
			{
				type: 'inferredDecision',
				subject: emitPairBinding.pairSubject,
				version: emitPairBinding.versionKey,
				// FULL derivation inputs (M3 pattern): the CEDS standard block supplied the scoped
				// candidate pool for these decisions — declared alongside the scoping mapping block.
				requires: [
					args.sourceRow.blockId,
					args.referenceRow.blockId,
					args.cedsRow.blockId,
					args.matchedMappingBlockRow.blockId,
				],
				text,
				producedBy: 'edf-inferred',
			},
			(err, result) => {
				if (err) {
					next(`saveBlock(inferredDecision) failed: ${err}`);
					return;
				}
				xLog.status(`[edfInferred -emit --tier=value] frozen decision block: ${result.blockId.slice(0, 12)}… (pin)`);
				next('', { ...args, decisionBlockId: result.blockId, decisions });
			},
		);
	});
	// MATERIALIZE picks -> CLOSE_MATCH edges (pure), pinned to the decision-block hash.
	taskList.push((args, next) => {
		// value-scope confidence honesty: every value edge's validity is CONDITIONAL on its parent
		// hypothesis. An EXACT_MATCH parent is authored certainty -> the child's own score stands.
		// A CLOSE_MATCH parent is itself inferred -> effective confidence = min(parentConfidence,
		// childScore), so a doubly-inferred edge can NEVER read 1.0. The raw child score stays
		// legible on the edge as cosineScore/rerankScore; scopeParentPredicate/scopeParentConfidence
		// carry the parent evidence for downstream gating.
		const inferredDecisions = args.decisions
			.filter((d) => !d.abstain && d.targetKey)
			.map((d) => {
				const childScore = typeof d.cosineScore === 'number' ? d.cosineScore : null;
				const parentConfidence =
					typeof d.scopeParentConfidence === 'number' ? d.scopeParentConfidence : null;
				const confidence =
					d.scopeParentPredicate === 'EXACT_MATCH'
						? childScore
						: childScore !== null && parentConfidence !== null
							? Math.min(parentConfidence, childScore)
							: parentConfidence !== null
								? parentConfidence
								: childScore;
				return {
					fromStableId: d.source.stableId,
					targetKey: d.targetKey,
					confidence,
					rerankScore: childScore,
					cosineScore: childScore,
					retrievalRank: typeof d.retrievalRank === 'number' ? d.retrievalRank : null,
					scopeParentPredicate: d.scopeParentPredicate || null,
					scopeParentConfidence: parentConfidence,
				};
			});
		const builder = inferredSubgraphFactory({
			predicate: 'closeMatch',
			mappingJustification: 'semapv:SemanticSimilarity',
			subjectSource: sourceStandard,
			subjectVersion: args.sourceVersion,
			objectSource: 'CEDS',
			objectVersion: args.referenceVersion,
			mappingTool: 'edf-inferred',
			decisionBlockHash: args.decisionBlockId,
		});
		const subgraph = builder.buildInferredSubgraph({
			inferredDecisions,
			sourceNodes: args.sourceRecords,
			referenceNodes: args.referenceNodes,
		});
		const abstains = args.decisions.filter((d) => d.abstain).length;
		const abstainByReason = {};
		args.decisions.filter((d) => d.abstain).forEach((d) => {
			abstainByReason[d.abstainReason] = (abstainByReason[d.abstainReason] || 0) + 1;
		});
		xLog.status(
			`[edfInferred -emit --tier=value] decisions=${args.decisions.length}: picks=${args.decisions.length - abstains}, abstains=${abstains} ${JSON.stringify(abstainByReason)}; CLOSE_MATCH edges=${subgraph.counts.edgesTotal} (orphans=${subgraph.counts.orphans}, fromGaps=${subgraph.counts.fromGaps})`,
		);
		next('', { ...args, subgraph, abstains, abstainByReason });
	});
	// serialize the inferredMapping edge block (edges only) + content-address.
	taskList.push((args, next) => {
		// L13: NO embedding metadata here — this block is EDGES ONLY (zero nodes, zero
		// embeddings); stamping model/dims was misleading provenance for header readers.
		// Phase C: pair fields replace standardKey; tierScope 'value' is the declared
		// granularity discriminator (the M14 subject-suffix convention's successor).
		const header = {
			blockType: 'inferredMapping',
			version: args.sourceVersion,
			stableUriPropertyName: 'uri',
			resolutionKey: 'uri',
			pairA: emitPairBinding.pairA,
			pairAVersion: emitPairBinding.pairAVersion,
			pairB: emitPairBinding.pairB,
			pairBVersion: emitPairBinding.pairBVersion,
			publishedVersionA: emitPairBinding.publishedVersionA,
			publishedVersionB: emitPairBinding.publishedVersionB,
			tierScope: 'value',
			decisionBlockHash: args.decisionBlockId,
			method: 'definitionEmbedding-opusRerank-v1_valueTierScoped',
		};
		const blockText = replayBlock.serializeBlock({
			header,
			nodes: [],
			edges: args.subgraph.edges.map(toBlockEdge),
		});
		forgeStore.saveBlock(
			{
				type: 'mapping',
				subject: emitPairBinding.pairSubject,
				version: emitPairBinding.versionKey,
				// FULL derivation inputs (Phase C): source + reference + the CEDS standard block that
				// supplied the scoped candidate pool + the property-tier mapping block that scoped it —
				// dependency-driven invalidation and requires-walking provenance need every read input.
				requires: [
					args.sourceRow.blockId,
					args.referenceRow.blockId,
					args.cedsRow.blockId,
					args.matchedMappingBlockRow.blockId,
				],
				text: blockText,
				producedBy: 'edf-inferred',
			},
			(err, result) => {
				if (err) {
					next(`saveBlock(inferredMapping) failed: ${err}`);
					return;
				}
				xLog.status(
					`[edfInferred -emit --tier=value] inferred VALUE mapping block saved: ${result.blockId.slice(0, 12)}… (${blockText.split('\n').filter(Boolean).length} lines)`,
				);
				next('', { ...args, mappingBlockId: result.blockId });
			},
		);
	});
	// assemble CANDIDATE manifest = gating members + the edge block (decision block NOT a member).
	taskList.push((args, next) => {
		const members = args.members
			.map((m) => ({ blockId: m.blockId, position: null }))
			.concat([{ blockId: args.mappingBlockId, position: null }]);
		forgeStore.saveManifest(
			{
				label,
				basedOn: gatingManifest,
				note: `Phase 5 CODESET-VALUE additive candidate: gating golden + ${sourceStandard} scoped-inferred value CLOSE_MATCH mappings; abstainFloor=${abstainFloor}; frozen decisions ${args.decisionBlockId.slice(0, 12)}…`,
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
					tier: 'value',
					gatingManifest,
					sourceStandard,
					abstainFloor,
					totalSourceValues: args.scoped.length + args.unscopedDecisions.length,
					scoped: args.scoped.length,
					unscoped: args.unscopedDecisions.length,
					exactShortcut: args.exactDecisions.length,
					llmRerankAttempted: args.llmDecisions.length,
					decisionBlockId: args.decisionBlockId,
					mappingBlockId: args.mappingBlockId,
					candidateManifestKey: args.candidateManifestKey,
					closeMatchEdges: args.subgraph.counts.edgesTotal,
					picks: args.decisions.length - args.abstains,
					abstains: args.abstains,
					abstainByReason: args.abstainByReason,
					orphans: args.subgraph.orphans.slice(0, 10),
					fromGaps: args.subgraph.diagnostics.fromGaps.slice(0, 10),
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
// =====================================================================
// ACTION: -gapCheck — the A0.1 gate (CRIMSON condition 1) as ONE COMMAND: the gap set RECORDED in a
// frozen decision block must EQUAL a fresh engine recompute from the same gating manifest. Reads the
// decision block (--decisionBlock=), takes sourceStandard + basedOnGatingManifest + gapFill from the
// frozen record itself, recomputes, compares element-for-element. Exit 0 GATE PASS / exit 1 FAIL.
// =====================================================================
const handleGapCheck = (resources, callback) => {
	const { xLog } = process.global;
	const { forgeStore, nodeLoader } = resources;
	const decisionBlockId = strParam('decisionBlock', '');
	if (!decisionBlockId) {
		callback('edfInferred -gapCheck: --decisionBlock= is required');
		return;
	}
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.getBlock({ blockId: decisionBlockId }, (err, row) => {
			if (err || !row) {
				next(err || `no decision block '${decisionBlockId}'`);
				return;
			}
			const record = JSON.parse(row.text);
			if (record.recordType !== 'inferredDecisionRecord') {
				next(`block ${decisionBlockId.slice(0, 12)}… is not an inferredDecisionRecord`);
				return;
			}
			if (!record.gapFill) {
				next(`decision block ${decisionBlockId.slice(0, 12)}… carries NO gapFill record — pre-gap-fill era block, nothing to gate`);
				return;
			}
			next('', { ...args, record });
		});
	});
	taskList.push((args, next) => {
		loadBlocks(
			{
				forgeStore,
				nodeLoader,
				gatingManifest: args.record.basedOnGatingManifest,
				sourceStandard: args.record.sourceStandard,
			},
			(err, loaded) => next(err, { ...args, ...loaded }),
		);
	});
	taskList.push((args, next) => {
		const fresh = computeAuthoredGapSet({
			sourceRecords: args.sourceRecords,
			propertyMappingRows: args.propertyMappingRows,
			nodeLoader,
		});
		const recorded = args.record.gapFill;
		const sameLength = recorded.gapSetSorted.length === fresh.gapSetSorted.length;
		const firstMismatch = sameLength
			? recorded.gapSetSorted.findIndex((oneId, idx) => oneId !== fresh.gapSetSorted[idx])
			: -2;
		const setsEqual = sameLength && firstMismatch === -1;
		const blocksEqual =
			JSON.stringify(recorded.consultedBlockIds) === JSON.stringify(fresh.consultedBlockIds);
		const verdict = setsEqual && blocksEqual ? 'GATE PASS' : 'GATE FAIL';
		xLog.result(
			JSON.stringify(
				{
					action: 'gapCheck',
					decisionBlock: decisionBlockId,
					sourceStandard: args.record.sourceStandard,
					gatingManifest: args.record.basedOnGatingManifest,
					recorded: { gapCount: recorded.gapCount, authoredMappedCount: recorded.authoredMappedCount, consultedBlockIds: recorded.consultedBlockIds },
					fresh: { gapCount: fresh.gapCount, authoredMappedCount: fresh.authoredMappedCount, consultedBlockIds: fresh.consultedBlockIds },
					gapSetsEqual: setsEqual,
					consultedBlocksEqual: blocksEqual,
					...(setsEqual ? {} : { firstMismatchIndex: firstMismatch }),
					verdict,
				},
				null,
				2,
			),
		);
		next(setsEqual && blocksEqual ? '' : `gapCheck FAILED: recorded gap set does not equal the fresh recompute (${verdict})`, args);
	});
	pipeRunner(taskList.getList(), {}, (err) => callback(err ? err : ''));
};

const dispatchMap = { accuracy: handleAccuracy, emit: handleEmit, gapCheck: handleGapCheck };

const main = () => {
	bootstrapGlobal();
	const { xLog } = process.global;
	const action = Object.keys(commandLineParameters.switches).find((s) => dispatchMap[s]);
	if (!action) {
		xLog.error(
			'edfInferred: unknown action. Actions: -accuracy | -emit | -gapCheck. Params: --gatingManifest= --scope= --sampleSize= --limit= --cosineFloor= --concurrency= --model= --decisionJournal= --resumeJournal= --decisionBlock=',
		);
		process.exit(2);
	}
	buildSharedResources((err, resources) => {
		if (err) {
			xLog.error(`edfInferred bootstrap failed: ${err}`);
			process.exit(2);
		}
		dispatchMap[action](resources, (handlerErr) => {
			if (handlerErr) {
				xLog.error(`[edfInferred] ERROR: ${handlerErr}`);
				process.exit(1);
			}
			process.exit(0);
		});
	});
};

main();
