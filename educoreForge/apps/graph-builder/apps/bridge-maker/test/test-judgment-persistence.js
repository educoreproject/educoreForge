#!/usr/bin/env node
'use strict';

// test-judgment-persistence.js — THE P9 GATE (p9-judgmentPersistence, 2026-07-31): the judgment
// cache IS the checkpoint, decided = persisted, and the forensic match log tells the whole story.
//
// CONTEXT (real money): a live API-cap kill at judgment 3,300 of 15,620 lost EVERY judgment
// because decisions froze only at run end. ⟪TQ RULING⟫ "make totally sure that all the results are
// written to disk as they are decided. Losing data is crazy."
//
// PROVES (all hermetic — REAL bridgeMaker.run, REAL kitLoader, REAL judgment-cache on a throwaway
// sqlite file, REAL match-forensics on a throwaway directory, STUB llmClient, doubles for graph
// reader/writer/vectorizer):
//   PART A — cachedJudgment unit fault twins: cache-active-but-no-model refused; blank
//     rendererVersion refused; a cached ordinal resolving to a DIFFERENT candidate refused (the
//     soundness invariant); a pick not in its own pool refused; and the forensics-failure contract
//     (LOUD via xLog.error + judgeMeta.forensicsError, but NONFATAL — the judgment still lands).
//   PART B — RUN A (live-stub, fresh cache) then RUN B (same cache, fresh stub): B makes ZERO
//     llm calls and the frozen decision block is BYTE-IDENTICAL (text and hash) with byte-identical
//     written edges. The forensic trail carries one 'live' record per judgment from A and one
//     'cache:<promptHash>' record per judgment from B — live records carry usage token counts,
//     cache records carry usage null.
//   PART C/D — THE CRASH SIMULATION: RUN C (fresh cache, concurrency 1, stub ERRORS at judgment 4)
//     fails as a run but leaves judgments 1..3 ON DISK; RUN D (same cache, healthy stub) completes
//     with EXACTLY 3 live calls (6 - 3 cached) and freezes a block BYTE-IDENTICAL to RUN A's.
//     This is the $300 scenario, ended.
//   PART E — genericBridge's config.judgmentKey seam (structural dedupe, opt-in): a hook grouping
//     two of three sources judges TWICE, fans out honestly (judgedVia stamp + representative
//     reference, NO duplicated evidencePackage), writes a 'dedupe:<key>' forensic record for the
//     member, and a RERUN over the same cache makes ZERO llm calls with a byte-identical block.
//     Plus the RED twin: a non-function config.judgmentKey is refused by name.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-judgment-persistence.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- THE P9 GATE: decided = persisted; cache-resume byte-identity; forensic completeness

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the judgment-cache checkpoint end-to-end through the REAL bridgeMaker.run with a real
     sqlite judgment cache: run A live, run B all-cache-hits byte-identical, run C killed mid-run,
     run D resuming with only the unjudged remainder — plus the forensic match log's per-judgment
     completeness (live/cache/dedupe records, usage on live ones) and the loud-but-nonfatal
     forensics failure contract.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const bridgeMakerModule = require('../bridgeMaker');
const cachedJudgmentFactory = require('../lib/cachedJudgment');
const evidenceFreezerFactory = require('../lib/evidenceFreezer');
const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const judgmentCacheModule = require(path.join(TREE_ROOT, 'lib', 'judgment-cache', 'judgment-cache'))();
const matchForensicsModule = require(path.join(TREE_ROOT, 'lib', 'match-forensics', 'match-forensics'))();

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfJudgmentPersistenceGate-'));

// =====================================================================
// PART A — cachedJudgment unit fault twins
// =====================================================================
harness.section('PART A — cachedJudgment fault twins: soundness refusals + loud-but-nonfatal forensics');

const passthroughSelect = (wrapper, llmClient, cb) =>
	cb('', { abstain: false, pick: wrapper.pool[0].candidate, category: 'strong', rationale: 'unit-stub pick' });
const unitPool = [{ candidate: { stableId: 'cand:one', name: 'Candidate One' }, cosine: 0.9 }];
const stubCacheNeverHit = {
	getJudgment: (key, cb) => cb('', { judgment: null }),
	putJudgment: (row, cb) => cb('', { stored: true }),
};

(() => {
	// RED: cache active but the llmClient declares no model identity.
	const judgeOne = cachedJudgmentFactory({
		judgmentCache: stubCacheNeverHit,
		rendererVersion: 'r-v1',
		evidenceSelect: passthroughSelect,
		llmClient: { rerank: (s, cb) => cb('', { choice: '1' }) }, // no .model
	});
	let observed = null;
	judgeOne({ promptText: 'p', pool: unitPool, sourceStableId: 's1' }, (err) => { observed = err; });
	harness.rejects('RED: cache active + llmClient.model missing is refused by name', [observed], /llmClient\.model is not a non-empty string.*soundly cached/s);
})();

(() => {
	// RED: cache active but rendererVersion blank — the third key part is not optional.
	const judgeOne = cachedJudgmentFactory({
		judgmentCache: stubCacheNeverHit,
		rendererVersion: '  ',
		evidenceSelect: passthroughSelect,
		llmClient: { rerank: (s, cb) => cb('', { choice: '1' }), model: 'stub-judge-model-v1' },
	});
	let observed = null;
	judgeOne({ promptText: 'p', pool: unitPool, sourceStableId: 's1' }, (err) => { observed = err; });
	harness.rejects('RED: cache active + blank rendererVersion is refused by name', [observed], /rendererVersion is required/);
})();

(() => {
	// RED: a cached ordinal that resolves to a DIFFERENT candidate than at decision time.
	const lyingCache = {
		getJudgment: (key, cb) =>
			cb('', { judgment: { choice: '1', chosenStableId: 'cand:SOMETHING_ELSE', category: 'strong', rationale: 'x' } }),
		putJudgment: (row, cb) => cb('', { stored: true }),
	};
	const judgeOne = cachedJudgmentFactory({
		judgmentCache: lyingCache,
		rendererVersion: 'r-v1',
		evidenceSelect: passthroughSelect,
		llmClient: { rerank: (s, cb) => cb('', { choice: '1' }), model: 'stub-judge-model-v1' },
	});
	let observed = null;
	judgeOne({ promptText: 'p', pool: unitPool, sourceStableId: 's1' }, (err) => { observed = err; });
	harness.rejects(
		'RED: a cached ordinal now naming a DIFFERENT candidate is refused (soundness invariant), never replayed',
		[observed],
		/named candidate 'cand:SOMETHING_ELSE'.*soundness invariant is violated/s,
	);
})();

(() => {
	// RED: a live selectResult whose pick is not an object in its own pool cannot be addressed.
	const derived = cachedJudgmentFactory.judgmentPayloadFrom(
		{ abstain: false, pick: { stableId: 'cand:foreign' }, category: 'strong', rationale: 'x' },
		unitPool,
	);
	harness.match('RED: a pick not in its own pool is refused rather than mis-persisted', derived.error, /not an object in the pool/);
})();

(() => {
	// FORENSICS FAILURE — LOUD (xLog.error) BUT NONFATAL (the judgment still lands, with the
	// failure surfaced in judgeMeta.forensicsError).
	const failingForensics = { appendRecord: (spec, cb) => cb('the disk is full (simulated)') };
	const judgeOne = cachedJudgmentFactory({
		judgmentCache: stubCacheNeverHit,
		matchForensics: failingForensics,
		pairKey: 'CEDS::UNIT',
		generation: 'unit-gen-v1',
		rendererVersion: 'r-v1',
		evidenceSelect: passthroughSelect,
		llmClient: { rerank: (s, cb) => cb('', { choice: '1' }), model: 'stub-judge-model-v1' },
	});
	const xLog = process.global.xLog;
	const originalError = xLog.error;
	let loudMessage = null;
	xLog.error = (message) => { loudMessage = message; };
	let observed = null;
	judgeOne({ promptText: 'p', pool: unitPool, sourceStableId: 's1' }, (err, out) => { observed = { err, out }; });
	xLog.error = originalError;
	harness.equal('a forensics write failure is NONFATAL: the judgment is still delivered with no error', observed && observed.err, '');
	harness.ok('  the judgment itself is intact', observed && observed.out && observed.out.selectResult && !observed.out.selectResult.abstain);
	harness.match('  the failure IS surfaced LOUDLY through xLog.error', loudMessage, /FORENSIC LOG WRITE FAILED.*disk is full/s);
	harness.match('  and rides judgeMeta.forensicsError for the caller', observed && observed.out && observed.out.judgeMeta.forensicsError, /disk is full/);
})();

// =====================================================================
// SHARED FIXTURE for PARTS B-E — six sources with DISTINCT retrieval cosines so every rendered
// prompt is unique and the stub llm can answer as a PURE FUNCTION OF THE PROMPT (never call
// order) — the property that makes a mixed cache-hit/live run byte-identical to an all-live run.
// =====================================================================
const referenceNodesRaw = [
	{
		stableId: 'cedsHubRef:addr1',
		properties: {
			role: 'HubReference', referenceTier: 'property', canonicalKey: 'P000104', propertyKey: 'P000104',
			name: 'Staff Evaluation Score or Rating', domainId: 'C200366', rangeDatatype: 'string', qualifierKeys: [],
		},
	},
	{
		stableId: 'cedsHubRef:addr2',
		properties: {
			role: 'HubReference', referenceTier: 'property', canonicalKey: 'P600253', propertyKey: 'P600253',
			name: 'Has Local Education Agency Title I Support Service', domainId: 'C200188', rangeClassId: 'C200196', qualifierKeys: [],
		},
	},
];

// per-source cosine against addr1 ([1,0,0]); addr2 is [0,0,1], orthogonal to every source, so
// addr1 is ALWAYS pool ordinal 1 and its rendered cosine uniquely identifies the source.
const SOURCE_COSINES = [0.9, 0.8, 0.7, 0.6, 0.55, 0.5];
const sourceGraphNodes = SOURCE_COSINES.map((oneCosine, i) => ({
	stableId: `sP${i + 1}`,
	properties: {
		_source: 'LIF', role: 'DmeProperty', name: `Persistence Probe ${i + 1}`,
		defText: `persistence probe text ${i + 1}`,
	},
}));

const textVectors = {
	'Staff Evaluation Score or Rating': [1, 0, 0],
	'Has Local Education Agency Title I Support Service': [0, 0, 1],
};
SOURCE_COSINES.forEach((oneCosine, i) => {
	textVectors[`persistence probe text ${i + 1}`] = [oneCosine, Math.sqrt(1 - oneCosine * oneCosine), 0];
});

// STUB_RESPONSES — keyed by the FIRST candidate's rendered cosine (round6 of the values above,
// which are exact at 6 places): a pure function of the prompt.
const STUB_RESPONSES = {
	0.9: { choice: '1', category: 'strong', rationale: 'probe 1 aligns exactly' },
	0.8: { choice: 'NONE', rationale: 'probe 2: nothing genuinely supported' },
	0.7: { choice: '1', category: 'moderate', rationale: 'probe 3 aligns moderately' },
	0.6: { choice: '1', category: 'weakButReal', rationale: 'probe 4 alignment is weak but real' },
	0.55: { choice: 'NONE', rationale: 'probe 5: nothing genuinely supported' },
	0.5: { choice: '1', category: 'strong', rationale: 'probe 6 aligns on the tuple facts' },
};

// makeStubLlm — counts calls; answers by prompt; optionally ERRORS on its Nth call (1-based) to
// simulate the API-cap kill; declares its model identity (the cache requires one) and returns a
// usage envelope exactly as the R-a-wired live llmClient now does.
const makeStubLlm = ({ counter, errorOnCall = null }) => ({
	model: 'stub-judge-model-v1',
	rerank: (spec, callback) => {
		counter.calls += 1;
		if (errorOnCall !== null && counter.calls === errorOnCall) {
			callback('SIMULATED API CAP KILL (the $300 scenario)');
			return;
		}
		const match = spec.userPrompt.match(/retrieval cosine ([0-9.]+)/);
		const response = match ? STUB_RESPONSES[match[1]] : null;
		if (!response) {
			callback(`stub llm: unrecognized prompt (first cosine ${match && match[1]})`);
			return;
		}
		callback('', {
			...response,
			model: 'stub-judge-model-v1',
			attempts: 1,
			usage: { inputTokens: 1000 + counter.calls, outputTokens: 40 },
			stopReason: 'tool_use',
			retryReasons: [],
		});
	},
});

const graphReaderDouble = ({ inGraph }) => ({
	readNodes: ({ label, propertyEquals }, callback) => {
		void inGraph;
		const eq = propertyEquals || {};
		if (label === 'HubReference') { callback('', { nodes: referenceNodesRaw }); return; }
		if (eq._source === 'LIF' && eq.role === 'DmeProperty') { callback('', { nodes: sourceGraphNodes }); return; }
		callback('', { nodes: [] });
	},
	close: (callback) => callback(''),
});

const makeWriterDouble = (writes) => ({ inGraph }) => ({
	writeRelationshipEdge: (spec, callback) => { void inGraph; writes.push({ ...spec }); callback('', { edgeWritten: true }); },
	close: (callback) => callback(''),
});

const fakeVectorizerFactory = () => ({
	batchEmbed: ({ texts }, cb) => cb('', { vectors: (texts || []).map((t) => textVectors[t] || null) }),
});

const runConfigBase = { sourceStandard: 'lif', sourceVersion: 'v1', hubVersion: 'v14.0.0.0' };

// runPersistencePass — one REBRIDGE through the REAL bridgeMaker.run with a REAL judgment cache
// (and optionally a REAL forensics writer) wired in exactly as build.js wires them.
const runPersistencePass = ({ graphName, stubLlm, judgmentCache, matchForensics = null, configOverrides = {}, writes }, passDone) => {
	const decisionBlocks = {};
	const decisionStore = {
		getDecisionBlock: ({ pairKey }, cb) => cb('', decisionBlocks[pairKey] ? { frozenText: decisionBlocks[pairKey].frozenText } : { frozenText: null }),
		saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => { decisionBlocks[pairKey] = { frozenText, decisionBlockHash }; cb('', { saved: true }); },
	};
	bridgeMakerModule({ graphWriterFactory: makeWriterDouble(writes), graphReaderFactory: graphReaderDouble }).run(
		{
			inGraph: { graphName, boltUrl: 'bolt://x', password: 'x' },
			bridge: 'genericBridge', hub: 'ceds', applyLabel: 'BridgedRelation',
			rebridge: true, decisionStore, judgmentCache, matchForensics,
			inferenceConfig: { llmClient: stubLlm, topK: 15, cosineFloor: 0, concurrency: 4 },
			config: { ...runConfigBase, ...configOverrides },
			componentOverrides: { vectorizer: fakeVectorizerFactory, graphReader: graphReaderDouble },
		},
		(err, report) => passDone(err, { report, frozenBlock: decisionBlocks['CEDS::LIF'] }),
	);
};

const readForensicLines = (baseDir, pairKey, generation) => {
	const filePath = path.join(baseDir, pairKey, `${generation}.jsonl`);
	if (!fs.existsSync(filePath)) {
		return [];
	}
	return fs
		.readFileSync(filePath, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((oneLine) => JSON.parse(oneLine));
};

const genericBridgeGeneration = require(path.join(TREE_ROOT, 'forges', 'bridges', 'genericBridge')).EVIDENCE_GENERATION;

// =====================================================================
// PARTS B-E are ASYNC (real sqlite opens); the whole chain owns harness.report() at its tail.
// =====================================================================
harness.section('PART B — RUN A (live) then RUN B (all-cache-hits): zero spend, byte-identical frozen block');

const cacheDbAB = path.join(scratchDir, 'judgmentCacheAB.sqlite3');
const forensicsDirAB = path.join(scratchDir, 'matchForensicsAB');

judgmentCacheModule.open({ databaseFilePath: cacheDbAB }, (cacheOpenErr, judgmentCacheAB) => {
	harness.accepts('the REAL judgment cache opens on a throwaway file', cacheOpenErr ? [cacheOpenErr] : []);
	matchForensicsModule.open({ baseDirPath: forensicsDirAB }, (forensicsOpenErr, matchForensicsAB) => {
		harness.accepts('the REAL forensics writer opens on a throwaway dir', forensicsOpenErr ? [forensicsOpenErr] : []);

		const counterA = { calls: 0 };
		const writesA = [];
		runPersistencePass(
			{ graphName: 'DEV_p9_runA', stubLlm: makeStubLlm({ counter: counterA }), judgmentCache: judgmentCacheAB, matchForensics: matchForensicsAB, writes: writesA },
			(runAErr, runAOut) => {
				harness.ok(`RUN A (live, fresh cache) did not error (${runAErr || 'ok'})`, !runAErr, runAErr);
				harness.equal('RUN A: exactly 6 live llm calls (one per source)', counterA.calls, 6);
				harness.ok('RUN A: a real frozen block was saved', !!runAOut.frozenBlock);
				harness.note(`RUN A decisionBlockHash: ${runAOut.frozenBlock && runAOut.frozenBlock.decisionBlockHash}`);

				const linesAfterA = readForensicLines(forensicsDirAB, 'CEDS::LIF', genericBridgeGeneration);
				harness.equal('FORENSICS after RUN A: exactly 6 records (one per judgment)', linesAfterA.length, 6);
				harness.ok(
					"  every RUN A record is judgedVia 'live'",
					linesAfterA.every((oneRecord) => oneRecord.judgedVia === 'live'),
					JSON.stringify(linesAfterA.map((r) => r.judgedVia)),
				);
				harness.ok(
					'  every live record carries REAL usage token counts (⟪TQ⟫ "you get the costs in the return")',
					linesAfterA.every((oneRecord) => oneRecord.usage && Number.isInteger(oneRecord.usage.inputTokens) && Number.isInteger(oneRecord.usage.outputTokens)),
					JSON.stringify(linesAfterA.map((r) => r.usage)),
				);
				harness.ok(
					'  every live record carries the full rendered promptText, its promptHash, model, rendererVersion, and the candidate pool in rendered order',
					linesAfterA.every(
						(oneRecord) =>
							typeof oneRecord.promptText === 'string' && oneRecord.promptText.length > 0 &&
							typeof oneRecord.promptHash === 'string' && oneRecord.model === 'stub-judge-model-v1' &&
							typeof oneRecord.rendererVersion === 'string' && Array.isArray(oneRecord.candidatePool) &&
							oneRecord.candidatePool[0] === 'cedsHubRef:addr1',
					),
				);
				harness.ok(
					'  every live record explains its retries ({ count, reasons }) and its latencyMs',
					linesAfterA.every((oneRecord) => oneRecord.retries && oneRecord.retries.count === 0 && typeof oneRecord.latencyMs === 'number'),
				);

				const counterB = { calls: 0 };
				const writesB = [];
				runPersistencePass(
					{ graphName: 'DEV_p9_runB', stubLlm: makeStubLlm({ counter: counterB }), judgmentCache: judgmentCacheAB, matchForensics: matchForensicsAB, writes: writesB },
					(runBErr, runBOut) => {
						harness.ok(`RUN B (same cache) did not error (${runBErr || 'ok'})`, !runBErr, runBErr);
						harness.equal('RUN B: ZERO llm calls — every judgment served from the cache, zero spend', counterB.calls, 0);
						harness.equal(
							'PROOF: RUN B frozen decision block is BYTE-IDENTICAL to RUN A (live vs all-cache-hits)',
							runBOut.frozenBlock.frozenText,
							runAOut.frozenBlock.frozenText,
						);
						harness.equal('  and the content-address (decisionBlockHash) is IDENTICAL', runBOut.frozenBlock.decisionBlockHash, runAOut.frozenBlock.decisionBlockHash);
						harness.equal('  and the WRITTEN edges are byte-identical, in the same order', JSON.stringify(writesB), JSON.stringify(writesA));

						const linesAfterB = readForensicLines(forensicsDirAB, 'CEDS::LIF', genericBridgeGeneration);
						harness.equal('FORENSICS after RUN B: 12 records total (6 live + 6 cache-hit) — the story is COMPLETE', linesAfterB.length, 12);
						const cacheHitRecords = linesAfterB.slice(6);
						harness.ok(
							"  every RUN B record is judgedVia 'cache:<promptHash>' naming its own hash",
							cacheHitRecords.every((oneRecord) => oneRecord.judgedVia === `cache:${oneRecord.promptHash}`),
							JSON.stringify(cacheHitRecords.map((r) => r.judgedVia)),
						);
						harness.ok(
							'  and cache-hit records carry usage null (no spend is never dressed up as spend)',
							cacheHitRecords.every((oneRecord) => oneRecord.usage === null),
						);

						runPartCD();
					},
				);
			},
		);
	});
});

// =====================================================================
// PART C/D — the crash simulation: killed at judgment 4, resumed for 3.
// =====================================================================
const runPartCD = () => {
	harness.section('PART C/D — CRASH SIMULATION: killed at judgment 4 of 6; resume completes with 3 live calls; block byte-identical to RUN A');

	const cacheDbCD = path.join(scratchDir, 'judgmentCacheCD.sqlite3');
	judgmentCacheModule.open({ databaseFilePath: cacheDbCD }, (cacheOpenErr, judgmentCacheCD) => {
		harness.accepts('the C/D judgment cache opens fresh', cacheOpenErr ? [cacheOpenErr] : []);

		const counterC = { calls: 0 };
		const writesC = [];
		// concurrency 1 makes the kill point exact: judgments 1..3 decided AND PERSISTED, 4 dies.
		runPersistencePass(
			{
				graphName: 'DEV_p9_runC',
				stubLlm: makeStubLlm({ counter: counterC, errorOnCall: 4 }),
				judgmentCache: judgmentCacheCD,
				configOverrides: { evidenceJudgeConcurrency: 1 },
				writes: writesC,
			},
			(runCErr, runCOut) => {
				harness.rejects('RUN C dies mid-run exactly as the real API-cap kill did', [runCErr], /SIMULATED API CAP KILL/);
				harness.ok('  and froze NO decision block (the run never reached the freeze step)', !runCOut.frozenBlock);
				harness.equal('  the stub was killed on its 4th call', counterC.calls, 4);

				// re-fetch RUN A's block for the identity proof (recomputed here so PART C/D does not
				// depend on closure order): run a fresh all-live pass into a THROWAWAY cache.
				const counterRef = { calls: 0 };
				const writesRef = [];
				const cacheDbRef = path.join(scratchDir, 'judgmentCacheRef.sqlite3');
				judgmentCacheModule.open({ databaseFilePath: cacheDbRef }, (refOpenErr, judgmentCacheRef) => {
					harness.accepts('the reference cache opens', refOpenErr ? [refOpenErr] : []);
					runPersistencePass(
						{ graphName: 'DEV_p9_runRef', stubLlm: makeStubLlm({ counter: counterRef }), judgmentCache: judgmentCacheRef, writes: writesRef },
						(refErr, refOut) => {
							harness.ok(`the reference all-live pass did not error (${refErr || 'ok'})`, !refErr, refErr);

							const counterD = { calls: 0 };
							const writesD = [];
							runPersistencePass(
								{ graphName: 'DEV_p9_runD', stubLlm: makeStubLlm({ counter: counterD }), judgmentCache: judgmentCacheCD, writes: writesD },
								(runDErr, runDOut) => {
									harness.ok(`RUN D (resume over the killed run's cache) did not error (${runDErr || 'ok'})`, !runDErr, runDErr);
									harness.equal(
										'THE RESUME PROOF: RUN D made EXACTLY 3 live calls — the 3 judgments the kill destroyed before P9, and ONLY those (3 were already on disk)',
										counterD.calls,
										3,
									);
									harness.equal(
										'  and the frozen block is BYTE-IDENTICAL to an uninterrupted all-live run',
										runDOut.frozenBlock.frozenText,
										refOut.frozenBlock.frozenText,
									);
									harness.equal('  hash-identical too', runDOut.frozenBlock.decisionBlockHash, refOut.frozenBlock.decisionBlockHash);
									harness.equal('  and the written edges are byte-identical', JSON.stringify(writesD), JSON.stringify(writesRef));
									harness.note(`RUN D decisionBlockHash: ${runDOut.frozenBlock.decisionBlockHash}`);

									runPartE();
								},
							);
						},
					);
				});
			},
		);
	});
};

// =====================================================================
// PART E — genericBridge's config.judgmentKey seam: opt-in structural dedupe + forensic honesty.
// =====================================================================
const runPartE = () => {
	harness.section('PART E — config.judgmentKey (opt-in dedupe): judge once, fan out honestly, forensic record per member');

	// RED twin first: a non-function judgmentKey is refused by name.
	(() => {
		const genericBridgeFactory = require(path.join(TREE_ROOT, 'forges', 'bridges', 'genericBridge'));
		const noopKit = {
			config: { sourceStandard: 'lif', judgmentKey: 'notAFunction' },
			decisionStore: { getDecisionBlock: (a, cb) => cb('', { frozenText: null }), saveDecisionBlock: (a, cb) => cb('') },
			rebridge: false,
			graphReader: { readNodes: (s, cb) => cb('', { nodes: [] }), close: (cb) => cb('') },
			sourceWalker: { walk: (s, cb) => cb('', { sourceNodes: [] }) },
			evidenceFreezer: {}, materializer: () => {}, writer: () => {},
		};
		let observed = null;
		genericBridgeFactory({ kit: noopKit })({ inGraph: { graphName: 'x' }, hub: 'ceds', applyLabel: 'BridgedRelation' }, (err) => { observed = err; });
		harness.rejects('RED: a non-function config.judgmentKey is refused by name', [observed], /config\.judgmentKey is "notAFunction".*must be a function/s);
	})();

	// probes 1 and 3 share a structural key; probe 2 is individual. The hook is callback-shaped (R7).
	const dedupeKeyHook = (sourceElement, cb) =>
		cb('', sourceElement.stableId === 'sP1' || sourceElement.stableId === 'sP3' ? 'unit:sharedShape' : null);

	const cacheDbE = path.join(scratchDir, 'judgmentCacheE.sqlite3');
	const forensicsDirE = path.join(scratchDir, 'matchForensicsE');
	judgmentCacheModule.open({ databaseFilePath: cacheDbE }, (cacheOpenErr, judgmentCacheE) => {
		harness.accepts('the PART E judgment cache opens fresh', cacheOpenErr ? [cacheOpenErr] : []);
		matchForensicsModule.open({ baseDirPath: forensicsDirE }, (forensicsOpenErr, matchForensicsE) => {
			harness.accepts('the PART E forensics writer opens', forensicsOpenErr ? [forensicsOpenErr] : []);

			const counterE = { calls: 0 };
			const writesE = [];
			runPersistencePass(
				{
					graphName: 'DEV_p9_runE',
					stubLlm: makeStubLlm({ counter: counterE }),
					judgmentCache: judgmentCacheE,
					matchForensics: matchForensicsE,
					configOverrides: { judgmentKey: dedupeKeyHook },
					writes: writesE,
				},
				(runEErr, runEOut) => {
					harness.ok(`the dedupe run did not error (${runEErr || 'ok'})`, !runEErr, runEErr);
					harness.equal('DEDUPE: 5 live calls for 6 sources (sP1 represents sP3)', counterE.calls, 5);

					const parsed = evidenceFreezerFactory().parse(runEOut.frozenBlock.frozenText);
					harness.ok('the frozen block parses', !parsed.error, parsed.error);
					const memberEntry = parsed.frozenEvidence.find((oneEntry) => oneEntry.sourceStableId === 'sP3');
					const representativeEntry = parsed.frozenEvidence.find((oneEntry) => oneEntry.sourceStableId === 'sP1');
					harness.ok('the fanned-out member has a frozen entry', !!memberEntry);
					harness.equal("  HONESTY: it is stamped judgedVia 'dedupe:<key>'", memberEntry && memberEntry.judgedVia, 'dedupe:unit:sharedShape');
					harness.equal('  and names its representative', memberEntry && memberEntry.representativeSourceStableId, 'sP1');
					harness.ok('  and REFERENCES rather than duplicates the evidencePackage (none of its own)', memberEntry && memberEntry.evidencePackage === undefined);
					harness.ok('  while the representative entry carries the real evidencePackage', representativeEntry && !!representativeEntry.evidencePackage);
					harness.equal('  and the member inherited the representative judgment verbatim', JSON.stringify(memberEntry && memberEntry.judgment), JSON.stringify(representativeEntry && representativeEntry.judgment));

					const memberDecision = parsed.decisions.find((oneDecision) => oneDecision.fromStableId === 'sP3');
					harness.ok("  the member's DECISION exists and carries the representative's pick (an edge for every member)", memberDecision && memberDecision.targetKey === 'P000104', JSON.stringify(memberDecision));
					harness.equal('  6 decisions total — every source decided', parsed.decisions.length, 6);

					const linesE = readForensicLines(forensicsDirE, 'CEDS::LIF', genericBridgeGeneration);
					harness.equal('FORENSICS: 6 records — 5 live + 1 dedupe (complete per source element)', linesE.length, 6);
					const dedupeRecord = linesE.find((oneRecord) => oneRecord.sourceStableId === 'sP3');
					harness.ok('  the member record exists', !!dedupeRecord);
					harness.equal("  judgedVia 'dedupe:<key>'", dedupeRecord && dedupeRecord.judgedVia, 'dedupe:unit:sharedShape');
					harness.equal('  naming the representative', dedupeRecord && dedupeRecord.representativeSourceStableId, 'sP1');
					harness.ok("  carrying the REPRESENTATIVE's promptHash and usage null", dedupeRecord && typeof dedupeRecord.promptHash === 'string' && dedupeRecord.usage === null);

					// RERUN over the same cache: zero spend, byte-identical block (cache + dedupe compose).
					const counterE2 = { calls: 0 };
					const writesE2 = [];
					runPersistencePass(
						{
							graphName: 'DEV_p9_runE2',
							stubLlm: makeStubLlm({ counter: counterE2 }),
							judgmentCache: judgmentCacheE,
							configOverrides: { judgmentKey: dedupeKeyHook },
							writes: writesE2,
						},
						(runE2Err, runE2Out) => {
							harness.ok(`the dedupe RERUN did not error (${runE2Err || 'ok'})`, !runE2Err, runE2Err);
							harness.equal('RERUN: zero live calls (cache + dedupe compose)', counterE2.calls, 0);
							harness.equal('RERUN: byte-identical frozen block (dedupe is deterministic across reruns)', runE2Out.frozenBlock.frozenText, runEOut.frozenBlock.frozenText);
							harness.report();
						},
					);
				},
			);
		});
	});
};
