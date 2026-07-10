#!/usr/bin/env node
'use strict';

// resolve-baseline-harness.js — Phase-0 capture harness for the ADJUDICATED Phase-B resolve
// comparison (work order front-gate F4): the gate suite's DETERMINISTIC STUB llmClient path over a
// FIXED query set — the 15 curated known terms (resolveGateSupport.getCuratedKnownTerms, Appendix-A
// derivation) plus the two surfaces-parity cases (gate 29) — against the suite's gating manifest
// (the one the frozen phase0Baselines pin). Output: baselines/resolve-preB.json. Phase B re-runs
// THIS harness unchanged after the bridge reorg; outputs must be byte-identical.
//
// ZERO-SPEND, STRUCTURALLY: the def-embedder is constructed with embeddingConfigFilePath pointed at
// the KEYLESS scratch ini (baselines/keyless-scratch-inis/voyageEmbedding.ini — the ini is the ONLY
// Voyage key source [code-fact embedding-client.js:10]), so a query-embedding cache miss FAILS
// LOUDLY instead of calling Voyage. A clean completion therefore PROVES the whole run (context pool
// + every query) was served from the content-addressed cache (dataStores/phase5DefEmbCache.json).
// The reranker is the suite's deterministic pick-1 stub — no Anthropic client is ever constructed.
//
// Run (from repo root): node baselines/resolve-baseline-harness.js --out=baselines/resolve-preB.json
//
// No async/await, no try/catch for control flow. camelCase only. Standalone harness
// (plain argv + process.global bootstrap, the forgeStructuralFingerprint.js pattern).

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CODE = path.join(projectRoot, 'code');
const CORE_LIB = path.join(CODE, 'npm', 'qtools-graph-forge-core', 'lib');
const RESOLVE_LIB = path.join(CODE, 'cli', 'lib.d', 'edf-resolve', 'lib');
// G-B2 AUTHORIZED INSTRUMENT MIGRATION (Phase B, work item 5): def-embedder extracted to the core lib
// (spec §9 D4); RESOLVE_LIB and GATE_SUPPORT did not move and remain as frozen at Phase 0.
const GATE_SUPPORT = path.join(CODE, 'cli', 'lib.d', 'edf-gate', 'lib', 'resolve-gate-support', 'resolveGateSupport');
const DATASTORES = path.join(projectRoot, 'dataStores');

process.global = {
	xLog: {
		status: (...a) => console.error(...a),
		error: (...a) => console.error(...a),
		result: () => {},
		verbose: () => {},
	},
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
};

const { pipeRunner, taskListPlus } = new (require(path.join(CODE, 'cli', 'node_modules', 'qtools-asynchronous-pipe-plus')))();

const resolveCoreFactory = require(path.join(RESOLVE_LIB, 'resolve-core'));
const defEmbedderFactory = require(path.join(CORE_LIB, 'def-embedder', 'def-embedder'));
const { getCuratedKnownTerms } = require(GATE_SUPPORT);

// the suite's gating manifest — the one the frozen phase0Baselines pin (golden.baseline.json)
const GATING_MANIFEST = 'a9c2efcfbb302d84f69890ce86d2bd8c0f274e0901b309ce55baf4fc8a5c4d11';
const CACHE_FILE = path.join(DATASTORES, 'phase5DefEmbCache.json');
const KEYLESS_VOYAGE_INI = path.join(CODE, 'baselines', 'keyless-scratch-inis', 'voyageEmbedding.ini');
const CANONICAL_STORE = path.join(DATASTORES, 'forgeStore.sqlite3');

// the suite's deterministic stub reranker (resolveGateSupport verbatim): always pick rank 1
const stubLlm = {
	model: 'stub-reranker-pick1',
	rerank: ({ choiceEnum } = {}, callback) => callback('', { choice: '1', model: 'stub-reranker-pick1', attempts: 1 }),
};

// gate-29 parity cases, verbatim
const PARITY_CASES = [
	{ label: 'parity-minimal', input: { term: 'School Identifier', definition: 'A unique identifier assigned to a school.' } },
	{
		label: 'parity-allOptionalParams',
		input: {
			term: 'School Identifier',
			definition: 'A unique identifier assigned to a school.',
			datatype: 'string',
			context: 'organization identification',
			topK: 8,
			cosineFloor: 0.1,
		},
	},
];

const argOut = (process.argv.find((a) => a.startsWith('--out=')) || '').replace('--out=', '');
const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const taskList = new taskListPlus();

taskList.push((args, next) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	forgeStore.init({ dbPath: CANONICAL_STORE }, (err) => next(err, { ...args, forgeStore }));
});

taskList.push((args, next) => {
	// the ZERO-SPEND tripwire: keyless voyage ini — a cache miss errors, never spends
	const defEmbedder = defEmbedderFactory({
		cacheFilePath: CACHE_FILE,
		embeddingConfigFilePath: KEYLESS_VOYAGE_INI,
	});
	const resolveCore = resolveCoreFactory({
		forgeStore: args.forgeStore,
		defEmbedder,
		llmClient: stubLlm,
		gatingManifest: GATING_MANIFEST,
		topK: 15,
		cosineFloor: 0,
	});
	resolveCore.loadContext((err) => next(err, { ...args, resolveCore }));
});

taskList.push((args, next) => {
	getCuratedKnownTerms({ forgeStore: args.forgeStore, gatingManifest: GATING_MANIFEST }, (err, curated) =>
		next(err, { ...args, curated }),
	);
});

taskList.push((args, next) => {
	const queries = [
		...args.curated.map((oneTerm, index) => ({
			label: `curated-${String(index + 1).padStart(2, '0')}-${oneTerm.fromStableId}`,
			input: { term: oneTerm.term, definition: oneTerm.defText },
		})),
		...PARITY_CASES,
	];
	const results = [];
	const subTasks = new taskListPlus();
	queries.forEach((oneQuery) => {
		subTasks.push((a2, n2) => {
			args.resolveCore.resolve(oneQuery.input, (err, result) => {
				if (err) {
					n2(`resolve failed for ${oneQuery.label}: ${err}`);
					return;
				}
				results.push({ label: oneQuery.label, input: oneQuery.input, result });
				n2('', a2);
			});
		});
	});
	pipeRunner(subTasks.getList(), {}, (err) => next(err, { ...args, results }));
});

pipeRunner(taskList.getList(), {}, (err, args) => {
	if (err) {
		console.error(`resolve-baseline-harness: FAILED LOUDLY (this is the tripwire or a real fault): ${err}`);
		process.exit(1);
		return;
	}
	const payload = {
		harness: 'resolve-baseline-harness/v1',
		gatingManifest: GATING_MANIFEST,
		params: { topK: 15, cosineFloor: 0, reranker: 'stub-reranker-pick1' },
		queryCount: args.results.length,
		results: args.results,
	};
	const out = JSON.stringify(payload, null, 2);
	payload.resultsDigest = sha256Hex(out);
	if (argOut) {
		fs.writeFileSync(argOut, JSON.stringify(payload, null, 2));
		console.error(`resolve-baseline-harness: wrote ${args.results.length} query results -> ${argOut}`);
	} else {
		console.log(JSON.stringify(payload, null, 2));
	}
	process.exit(0);
});
