'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// resolveGateSupport.js — shared support for the PHASE-8 resolve gates (26-29) + the gate of record. Builds
// (and MEMOIZES, per gating manifest, across the suite process) a resolve-core wired with a DETERMINISTIC
// STUB reranker (so the standing suite gates never flake on Opus variance — G5), and the deterministic
// curated KNOWN-TERM test set (Appendix A): the first N Ed-Fi gold-crosswalk positives (sorted by source
// stableId) whose Ed-Fi source element is materialized, each carrying its gold CEDS token. The standing
// gates assert RETRIEVAL correctness (recall@K, deterministic) + the deterministic cosineFloor abstain
// boundary + read-only + 3-surface parity; the gate of record additionally exercises the REAL Opus pipeline.
// No async/await, no try/catch for control flow. camelCase only.

const path = require('path');

const RESOLVE_LIB = path.join(__dirname, '..', '..', '..', 'edf-resolve', 'lib');
const IMPLIED_LIB = path.join(__dirname, '..', '..', '..', 'bridge-maker', 'lib');

const resolveCoreFactory = require(path.join(RESOLVE_LIB, 'resolve-core'));
const defEmbedderFactory = require(path.join(IMPLIED_LIB, 'def-embedder'));
const nodeLoaderFactory = require(path.join(IMPLIED_LIB, 'node-loader'));
const goldHarnessFactory = require(path.join(IMPLIED_LIB, 'gold-harness'));

const { pipeRunner, taskListPlus } = new require(path.join(
	__dirname,
	'..',
	'..',
	'..',
	'..',
	'node_modules',
	'qtools-asynchronous-pipe-plus',
))();

// project dataStores (the shared embedding cache lives here — same cache the Phase-5 track uses).
const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const DATASTORES = path.join(findProjectRoot(), 'dataStores');
const CACHE_FILE = path.join(DATASTORES, 'phase5DefEmbCache.json');

const CURATED_N = 15; // modest documented known-term set (LLM-free for the standing gates; ~15 voyage embeds)

// DETERMINISTIC stub reranker: always pick retrieval rank 1; never LLM-abstains (abstain only via cosineFloor).
// Stable model id so meta is byte-stable across surfaces.
const stubLlm = {
	model: 'stub-reranker-pick1',
	rerank: ({ choiceEnum } = {}, callback) => callback('', { choice: '1', model: 'stub-reranker-pick1', attempts: 1 }),
};

const sharedDefEmbedder = defEmbedderFactory({ cacheFilePath: CACHE_FILE });
const nodeLoader = nodeLoaderFactory();

// memoization keyed by manifest (Node module singleton -> shared across all gates in one suite process).
const stubCoreByManifest = {};
const curatedByManifest = {};

// getStubResolveCore — a resolve-core wired with the stub reranker, context pre-loaded. Memoized.
const getStubResolveCore = ({ forgeStore, gatingManifest, topK = 15, cosineFloor = 0 } = {}, callback) => {
	const key = `${gatingManifest}|${topK}|${cosineFloor}`;
	if (stubCoreByManifest[key]) {
		callback('', stubCoreByManifest[key]);
		return;
	}
	const resolveCore = resolveCoreFactory({
		forgeStore,
		defEmbedder: sharedDefEmbedder,
		llmClient: stubLlm,
		gatingManifest,
		topK,
		cosineFloor,
	});
	resolveCore.loadContext((err) => {
		if (err) {
			callback(err);
			return;
		}
		stubCoreByManifest[key] = resolveCore;
		callback('', resolveCore);
	});
};

// makeResolveCore — a resolve-core wired with a CALLER-SUPPLIED llmClient (e.g. the real Opus client for the
// gate of record, or a custom stub). Not memoized.
const makeResolveCore = ({ forgeStore, llmClient, gatingManifest, topK = 15, cosineFloor = 0 } = {}) =>
	resolveCoreFactory({ forgeStore, defEmbedder: sharedDefEmbedder, llmClient, gatingManifest, topK, cosineFloor });

// getCuratedKnownTerms — the deterministic Appendix-A known-term set. Memoized.
//   -> [{ fromStableId, term, defText, goldToken }]
const getCuratedKnownTerms = ({ forgeStore, gatingManifest, n = CURATED_N } = {}, callback) => {
	const key = `${gatingManifest}|${n}`;
	if (curatedByManifest[key]) {
		callback('', curatedByManifest[key]);
		return;
	}
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey: gatingManifest }, (err, manifest) => {
			if (err || !manifest) {
				next(err || `resolveGateSupport: no manifest '${gatingManifest}'`);
				return;
			}
			next('', { ...args, members: manifest.members || [] });
		});
	});
	taskList.push((args, next) => {
		let edfiRow = null;
		const sub = new taskListPlus();
		args.members.forEach((oneMember) => {
			sub.push((a2, n2) => {
				forgeStore.getBlock({ blockId: oneMember.blockId }, (err, row) => {
					if (err) {
						n2(err);
						return;
					}
					if (row && row.type === 'standard' && row.subject === 'EdFi') edfiRow = row;
					n2('', a2);
				});
			});
		});
		pipeRunner(sub.getList(), {}, (err) => {
			if (err) {
				next(err);
				return;
			}
			if (!edfiRow) next("resolveGateSupport: no EdFi 'standard' block in the gating manifest");
			else next('', { ...args, edfiRow });
		});
	});
	taskList.push((args, next) => {
		const edfiRecords = nodeLoader.collapseNodes(nodeLoader.deserialize(args.edfiRow.text).nodes);
		const byStableId = {};
		edfiRecords.forEach((oneRecord) => {
			byStableId[oneRecord.stableId] = oneRecord;
		});
		const gold = goldHarnessFactory().loadGoldFrame();
		const curated = gold.positives
			.slice()
			.sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : a.fromStableId > b.fromStableId ? 1 : 0))
			.filter((onePositive) => byStableId[onePositive.fromStableId])
			.slice(0, n)
			.map((onePositive) => {
				const src = byStableId[onePositive.fromStableId];
				return {
					fromStableId: onePositive.fromStableId,
					term: src.name,
					defText: src.defText,
					goldToken: onePositive.goldToken,
				};
			});
		next('', { ...args, curated });
	});
	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		curatedByManifest[key] = args.curated;
		callback('', args.curated);
	});
};

// goldInCandidates — is the gold token's HubReference present among the resolve candidates? -> { hit, rank, address }
const goldInCandidates = (resolveResult, goldToken) => {
	const cand = (resolveResult.candidates || []).find(
		(oneCandidate) => oneCandidate.hubReference && oneCandidate.hubReference.canonicalKey === goldToken,
	);
	return cand
		? { hit: true, rank: cand.rank, address: cand.hubReference.address }
		: { hit: false, rank: null, address: null };
};

module.exports = {
	CURATED_N,
	CACHE_FILE,
	stubLlm,
	getStubResolveCore,
	makeResolveCore,
	getCuratedKnownTerms,
	goldInCandidates,
	sharedDefEmbedder,
};
