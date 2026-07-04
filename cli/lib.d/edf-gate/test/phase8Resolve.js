#!/usr/bin/env node
'use strict';

// phase8Resolve.js — the PHASE-8 GATE OF RECORD (the RESOLVE VERB: a READ-ONLY query capability built ONCE
// as resolve-core and exposed THRICE — CLI verb, educore-standards MCP tool, askMilo tool). Resolve embeds a
// term/description, retrieves the top-K CEDS candidates by definition-embedding cosine, reranks (Opus) or
// ABSTAINS, and returns ranked HubReference addresses + confidence + a suggested predicate + an abstain flag.
// It is read-only over the finished graph (reads only immutable content-addressed blocks; writes nothing).
//
// G5 discipline: the STANDING suite gates (26-29) are DETERMINISTIC (a stub reranker) so they never flake on
// Opus variance; this gate of record additionally exercises the REAL Opus pipeline as a smoke + differentiator
// demonstration. The hard numeric accuracy guarantee is RETRIEVAL recall@K (reranker-independent); real Opus
// is abstain-first (it prefers NONE over a weak match — the correctness differentiator), so its end-to-end
// top-1 on the gold crosswalk is intentionally conservative and is REPORTED, not hard-gated.
//
// CHECKS (deterministic unless marked REAL):
//   accuracyRecallStub      — curated known-term recall@15 >= 0.80 (gold HubReference present in candidates).
//   accuracyTwinDegraded    — TWIN: replace the curated definitions with gibberish -> recall COLLAPSES (<=0.2),
//                             proving the accuracy gate measures real definition signal.
//   abstainBoundaryStub     — gibberish under cosineFloor 0.5 ABSTAINS (reason cosineFloor, suggested null);
//                             a real mappable term under the SAME floor does NOT abstain (the control twin).
//   surfacesParityStub      — CLI + MCP + askMilo adapters over ONE shared core return JSON-identical results.
//   parityTwinDivergent     — TWIN: a different input through the same surfaces yields a DIFFERENT result
//                             (identical-output is real agreement, not a constant).
//   realOpusSmoke   (REAL)  — the REAL Opus pipeline runs over a small positive+negative set without error and
//                             exercises the llm-NONE abstain differentiator (>=1 negative abstains via llmNone).
//                             Reports recall@15, end-to-end top-1, and negative-abstain-rate (informational).
//
// The READ-ONLY proof (all-scope fingerprint unchanged before/after a resolve call) is standing suite gate 28
// (it needs the live graph + fingerprinter); it is not duplicated here.
//
// Usage: node --max-old-space-size=4096 phase8Resolve.js [--manifest=<gatingManifestKey>] [--realLimit=6]
// Async style: qtools taskListPlus/pipeRunner. No async/await, no try/catch for control flow. camelCase.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();
const configFileProcessor = require('qtools-config-file-processor');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CODE = path.join(projectRoot, 'code');
const CORE_LIB = path.join(CODE, 'npm', 'qtools-graph-forge-core', 'lib');
const CONFIGS_DIR = path.join(projectRoot, 'configs');
const IMPLIED_LIB = path.join(CODE, 'cli', 'lib.d', 'bridge-maker', 'lib');
const RESOLVE_LIB = path.join(CODE, 'cli', 'lib.d', 'edf-resolve', 'lib');
const SURFACES_LIB = path.join(RESOLVE_LIB, 'surfaces');
const SUPPORT = path.join(__dirname, '..', 'lib', 'resolve-gate-support', 'resolveGateSupport');

const DEFAULT_GATING_MANIFEST = 'a9c2efcfbb302d84f69890ce86d2bd8c0f274e0901b309ce55baf4fc8a5c4d11';
const argVal = (name) => {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.split('=')[1] : undefined;
};
const gatingManifest = argVal('manifest') || DEFAULT_GATING_MANIFEST;
const realLimit = parseInt(argVal('realLimit') || '6', 10);

const RECALL_FLOOR = 0.8;
const ABSTAIN_FLOOR = 0.5;
const GIBBERISH = 'xyzzy plugh frobnicate the quux of zorkmid blivet wibble';

const llmClientFactory = require(path.join(IMPLIED_LIB, 'llm-client'));
const nodeLoaderFactory = require(path.join(IMPLIED_LIB, 'node-loader'));
const goldHarnessFactory = require(path.join(IMPLIED_LIB, 'gold-harness'));
const cliSurface = require(path.join(SURFACES_LIB, 'cliResolveSurface'));
const mcpSurface = require(path.join(SURFACES_LIB, 'mcpResolveTool'));
const askMiloSurface = require(path.join(SURFACES_LIB, 'askMiloResolveTool'));

// =====================================================================
const bootstrapGlobal = () => {
	const xLog = {
		status: (...a) => console.error(...a),
		error: (...a) => console.error(...a),
		result: (...a) => console.log(...a),
		verbose: () => {},
	};
	let wholeConfig = {};
	const hostConfigName =
		os.hostname() === 'qMax.local' || os.hostname() === 'qbook.local' ? 'instanceSpecific/qbook' : '';
	const systemIni = path.join(CONFIGS_DIR, hostConfigName, 'systemParameters.ini');
	if (fs.existsSync(systemIni)) {
		wholeConfig = configFileProcessor.getConfig(systemIni) || {};
	}
	process.global = {
		xLog,
		getConfig: (name) => (name === 'allConfigs' ? wholeConfig : wholeConfig[name] || {}),
		commandLineParameters: { switches: {}, values: {} },
		rawConfig: wholeConfig,
	};
};

bootstrapGlobal();
const { xLog } = process.global;

const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
const support = require(SUPPORT);
const nodeLoader = nodeLoaderFactory();

const round4 = (x) => Math.round(x * 1e4) / 1e4;
const checks = [];
const record = (name, passed, detail) => {
	checks.push({ name, passed, detail });
	xLog.status(`  ${passed ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
};

// run resolve over a list, collecting recall + e2e against gold tokens.
const measureSet = (resolveCore, items, callback) => {
	let inTopK = 0;
	let e2e = 0;
	let abstains = 0;
	let i = 0;
	const rows = [];
	const next = () => {
		if (i >= items.length) {
			callback('', { inTopK, e2e, abstains, total: items.length, rows });
			return;
		}
		const oneItem = items[i++];
		resolveCore.resolve({ term: oneItem.term, definition: oneItem.defText }, (err, result) => {
			if (err) {
				callback(err);
				return;
			}
			const found = support.goldInCandidates(result, oneItem.goldToken);
			if (found.hit) inTopK++;
			const pick = result.suggested ? result.suggested.hubReference.canonicalKey : null;
			if (pick && pick === oneItem.goldToken) e2e++;
			if (result.abstain) abstains++;
			rows.push({ from: oneItem.fromStableId, gold: oneItem.goldToken, pick, abstain: result.abstain });
			next();
		});
	};
	next();
};

const taskList = new taskListPlus();

taskList.push((args, next) => {
	forgeStore.init({ dbPath: path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3') }, (err) =>
		next(err, args),
	);
});

// curated known-term set + stub resolve-core
taskList.push((args, next) => {
	support.getCuratedKnownTerms({ forgeStore, gatingManifest }, (err, curated) =>
		next(err, { ...args, curated }),
	);
});
taskList.push((args, next) => {
	support.getStubResolveCore({ forgeStore, gatingManifest, topK: 15, cosineFloor: 0 }, (err, stubCore) =>
		next(err, { ...args, stubCore }),
	);
});

// CHECK accuracyRecallStub
taskList.push((args, next) => {
	measureSet(args.stubCore, args.curated, (err, m) => {
		if (err) {
			next(err);
			return;
		}
		const recall = round4(m.inTopK / m.total);
		record(
			'accuracyRecallStub',
			recall >= RECALL_FLOOR,
			`recall@15=${m.inTopK}/${m.total}=${recall} (REQUIRED >= ${RECALL_FLOOR})`,
		);
		next('', args);
	});
});

// CHECK accuracyTwinDegraded — gibberish definitions collapse recall
taskList.push((args, next) => {
	// PURE gibberish — no real element tokens (an earlier version leaked the real name via fromStableId,
	// keeping recall high; the degraded definition must carry ZERO real signal to collapse retrieval).
	const degraded = args.curated.map((oneTerm, idx) => ({
		...oneTerm,
		term: GIBBERISH,
		defText: `${GIBBERISH} variant ${idx}`,
	}));
	measureSet(args.stubCore, degraded, (err, m) => {
		if (err) {
			next(err);
			return;
		}
		const recall = round4(m.inTopK / m.total);
		record(
			'accuracyTwinDegraded',
			recall <= 0.2,
			`degraded recall@15=${m.inTopK}/${m.total}=${recall} (REQUIRED <= 0.2 — gibberish defs collapse retrieval; proves the gate measures real signal)`,
		);
		next('', args);
	});
});

// CHECK abstainBoundaryStub — gibberish@floor abstains; real term@floor resolves
taskList.push((args, next) => {
	args.stubCore.resolve(
		{ term: GIBBERISH, definition: GIBBERISH, cosineFloor: ABSTAIN_FLOOR },
		(err, unmappable) => {
			if (err) {
				next(err);
				return;
			}
			const real = args.curated[0];
			args.stubCore.resolve(
				{ term: real.term, definition: real.defText, cosineFloor: ABSTAIN_FLOOR },
				(err2, mappable) => {
					if (err2) {
						next(err2);
						return;
					}
					const ok =
						unmappable.abstain === true &&
						unmappable.suggested === null &&
						unmappable.abstainReason === 'cosineFloor' &&
						mappable.abstain === false &&
						!!mappable.suggested;
					record(
						'abstainBoundaryStub',
						ok,
						`gibberish(best=${unmappable.meta.bestCosine}) abstain=${unmappable.abstain}/${unmappable.abstainReason}; real(best=${mappable.meta.bestCosine}) abstain=${mappable.abstain} (REQUIRED: gibberish abstains via cosineFloor, real resolves)`,
					);
					next('', args);
				},
			);
		},
	);
});

// CHECK surfacesParityStub + parityTwinDivergent
taskList.push((args, next) => {
	const input = { term: 'School Identifier', definition: 'A unique identifier assigned to a school.' };
	cliSurface.resolveViaCli({ resolveCore: args.stubCore, input }, (e1, cliEnv) => {
		if (e1) {
			next(e1);
			return;
		}
		mcpSurface.resolveViaMcp({ resolveCore: args.stubCore, input }, (e2, mcpRes) => {
			if (e2) {
				next(e2);
				return;
			}
			askMiloSurface.resolveViaAskMilo({ resolveCore: args.stubCore, input }, (e3, amRes) => {
				if (e3) {
					next(e3);
					return;
				}
				const cliJson = JSON.stringify(cliSurface.extractResult(cliEnv));
				const mcpJson = JSON.stringify(mcpSurface.extractResult(mcpRes));
				const amJson = JSON.stringify(askMiloSurface.extractResult(amRes));
				const parity = cliJson === mcpJson && mcpJson === amJson;
				record(
					'surfacesParityStub',
					parity,
					`cli==mcp==askMilo JSON-identical: ${parity} (candidates=${JSON.parse(cliJson).candidates.length})`,
				);
				// twin: a different input must produce a different result through the same surface
				const other = { term: 'Birth Date', definition: 'The date on which a person was born.' };
				mcpSurface.resolveViaMcp({ resolveCore: args.stubCore, input: other }, (e4, mcpOther) => {
					if (e4) {
						next(e4);
						return;
					}
					const otherJson = JSON.stringify(mcpSurface.extractResult(mcpOther));
					record(
						'parityTwinDivergent',
						otherJson !== mcpJson,
						`different input -> different result: ${otherJson !== mcpJson} (proves parity is real agreement, not a constant)`,
					);
					next('', args);
				});
			});
		});
	});
});

// CHECK realOpusSmoke — REAL Opus over a small positive+negative set
taskList.push((args, next) => {
	const realCore = support.makeResolveCore({
		forgeStore,
		llmClient: llmClientFactory({}),
		gatingManifest,
		topK: 15,
		cosineFloor: 0,
	});
	// load EdFi sources to build a small negative set (the curated set is positives only).
	forgeStore.getManifest({ manifestKey: gatingManifest }, (mErr, manifest) => {
		if (mErr || !manifest) {
			next(mErr || 'no manifest');
			return;
		}
		let edfiRow = null;
		const sub = new taskListPlus();
		(manifest.members || []).forEach((oneMember) => {
			sub.push((a2, n2) =>
				forgeStore.getBlock({ blockId: oneMember.blockId }, (e, row) => {
					if (e) {
						n2(e);
						return;
					}
					if (row && row.type === 'standard' && row.subject === 'EdFi') edfiRow = row;
					n2('', a2);
				}),
			);
		});
		pipeRunner(sub.getList(), {}, (subErr) => {
			if (subErr || !edfiRow) {
				next(subErr || 'no EdFi block');
				return;
			}
			const edfiRecords = nodeLoader.collapseNodes(nodeLoader.deserialize(edfiRow.text).nodes);
			const byStableId = {};
			edfiRecords.forEach((r) => {
				byStableId[r.stableId] = r;
			});
			const gold = goldHarnessFactory().loadGoldFrame();
			const negatives = gold.negatives
				.slice()
				.sort((a, b) => (a.fromStableId < b.fromStableId ? -1 : 1))
				.filter((p) => byStableId[p.fromStableId])
				.slice(0, realLimit)
				.map((p) => ({ fromStableId: p.fromStableId, term: byStableId[p.fromStableId].name, defText: byStableId[p.fromStableId].defText, goldToken: null }));
			const positives = args.curated.slice(0, realLimit);
			measureSet(realCore, positives, (posErr, pm) => {
				if (posErr) {
					next(posErr);
					return;
				}
				// negatives: count llm-NONE abstains
				let negAbstain = 0;
				let j = 0;
				const negNext = () => {
					if (j >= negatives.length) {
						const negRate = negatives.length ? round4(negAbstain / negatives.length) : 0;
						const ranE2e = round4(pm.e2e / pm.total);
						const ranRecall = round4(pm.inTopK / pm.total);
						// robust assertion: real pipeline ran without error AND the llm-NONE differentiator fires.
						record(
							'realOpusSmoke',
							negAbstain >= 1,
							`REAL Opus over ${pm.total} positives + ${negatives.length} negatives: recall@15=${ranRecall}, e2e-top1=${ranE2e} (abstain-first, reported), negativeLlmNoneAbstain=${negAbstain}/${negatives.length}=${negRate} (REQUIRED: >=1 llm-NONE abstain — the differentiator works)`,
						);
						next('', args);
						return;
					}
					const oneNeg = negatives[j++];
					realCore.resolve({ term: oneNeg.term, definition: oneNeg.defText }, (rErr, r) => {
						if (rErr) {
							next(rErr);
							return;
						}
						if (r.abstain && r.abstainReason === 'llmNone') negAbstain++;
						negNext();
					});
				};
				negNext();
			});
		});
	});
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		xLog.error(`\nphase8Resolve GATE OF RECORD ERROR: ${err}`);
		process.exit(1);
	}
	const passed = checks.filter((c) => c.passed).length;
	const failed = checks.length - passed;
	xLog.result(
		JSON.stringify(
			{
				gateOfRecord: 'phase8Resolve',
				gatingManifest,
				total: checks.length,
				passed,
				failed,
				green: failed === 0,
				checks,
			},
			null,
			2,
		),
	);
	process.exit(failed === 0 ? 0 : 1);
});
