#!/usr/bin/env node
'use strict';

// phase5Implied.js — the PHASE-5 GATE OF RECORD (inferred-track CLOSE_MATCH mappings).
//
// Phase 5 runs the inferred pipeline (definition-embedding retrieve K=15 -> cosine-floor pre-abstain ->
// Opus rerank -> ABSTAIN -> closeMatch) ONCE at production time and QUARANTINES every non-deterministic LLM
// decision into a content-addressed 'inferredDecision' block (its blockId = the content hash = the pin);
// the closeMatch EDGES are then PURELY materialized from that frozen block. So replay is deterministic and
// makes ZERO LLM calls. This gate proves:
//   PURE TWINS (no graph; over the FROZEN decision block + the candidate's source/reference blocks):
//     baseline       — non-abstain decisions materialize EXACTLY the edge block's CLOSE_MATCH edge count.
//     perturb        — flip ONE pick's target -> that edge's endpoint moves (materialization changes ->
//                      a fingerprint would go RED). The decisionBlockHash pins the edges to the frozen set.
//     abstainBoundary— dropping ONE non-abstain decision (an abstain) removes EXACTLY one edge (a
//                      below-threshold / NONE source yields NO edge — the abstain-boundary invariant).
//     reify          — NO curation input -> ZERO MappingAssertion nodes; a 1-entry curation fixture ->
//                      EXACTLY one MappingAssertion node (reify-on-demand; §6.1).
//   GRAPH GATE (build the candidate into an isolated scratch graph; reference = the gating golden):
//     provenance     — reference graph's all-scope fingerprint == the frozen goldenAll baseline (it IS the
//                      gating golden).
//     additive diff  — candidate vs reference (all-scope, ignoreOwnerStamp): zero removed/changed, ZERO
//                      added nodes, addedEdges == N, and EVERY added edge is CLOSE_MATCH (the all-scope diff
//                      == exactly the new closeMatch edges).
//     provenance stamp—every CLOSE_MATCH edge: predicate=closeMatch, mappingJustification=
//                      semapv:SemanticSimilarity, provenanceTier=embedding-inferred, decisionBlockHash set,
//                      target is a HubReference.
//     replayDeterminism—rebuild the SAME manifest -> identical all-scope fingerprint (no LLM at replay).
// Never touches the production golden (productionGuard). Mirrors phase4Mapping.js.
//
// Usage: node phase5Implied.js --candidateManifest=<key> [--reference=phase4golden] [--candidate=phase5cand]
//        [--gatingManifest=<key>]
//
// Async style: qtools taskListPlus/pipeRunner. No async/await, no try/catch for control flow. camelCase.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();
const configFileProcessor = require('qtools-config-file-processor');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CONFIGS_DIR = path.join(projectRoot, 'configs');
const GRAPH_BUILDER = path.join(projectRoot, 'code', 'cli', 'lib.d', 'edf-replay', 'lib', 'graph-builder');
const GATE_LIB = path.join(__dirname, '..', 'lib');

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const inferredSubgraphFactory = require(path.join(CORE_LIB, 'inferred-subgraph', 'inferredSubgraph'));

const DEFAULT_GATING_MANIFEST = '14665fcf49c3614ce7f8448b729545e7194bee50a598fa721cbd4c1431d6d12d';

const argVal = (name) => {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.replace(`--${name}=`, '') : null;
};
const candidateManifest = argVal('candidateManifest');
const gatingManifest = argVal('gatingManifest') || DEFAULT_GATING_MANIFEST;
const referenceGraph = argVal('reference') || 'phase4golden';
const candidateGraph = argVal('candidate') || 'phase5cand';

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
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
	rawConfig: wholeConfig,
};

const buildSharedResources = (callback) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	const credentialAccessor = require(path.join(CORE_LIB, 'credential-accessor', 'credential-accessor'))({ forgeStore });
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.init({ dbPath: path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3') }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({ forgeStore, credentialAccessor })(
			(err, lifecycle) => next(err, { ...args, lifecycle }),
		);
	});
	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		const lifecycle = args.lifecycle;
		callback('', {
			forgeStore,
			lifecycle,
			graphBuilder: require(GRAPH_BUILDER)({ forgeStore, lifecycle }),
			fingerprinter: require(path.join(GATE_LIB, 'graph-fingerprint', 'graphFingerprint'))({ lifecycle }),
			differ: require(path.join(GATE_LIB, 'graph-diff', 'graphDiff'))(),
			productionGuard: require(path.join(GATE_LIB, 'production-guard', 'productionGuard'))({ forgeStore }),
			baselineStore: require(path.join(GATE_LIB, 'baseline-store', 'baselineStore'))({ projectRoot }),
		});
	});
};

const queryOne = (lifecycle, graphName, cypher, params, callback) => {
	lifecycle.runCypher({ graphName, cypher, params: params || {} }, (err, result) => {
		if (err) {
			callback(err);
			return;
		}
		callback('', (result.records && result.records[0]) || {});
	});
};

const checks = [];
const record = (name, passed, detail) => {
	checks.push({ name, passed: !!passed, detail });
	xLog.status(`  [${passed ? 'PASS' : 'FAIL'}] ${name} — ${detail}`);
};

// load the Phase-5 artifacts from the candidate manifest: the NEW inferred edge block (the member NOT in
// the gating manifest), its frozen decision block (by header hash), and the source + reference blocks.
const loadArtifacts = (forgeStore, callback) => {
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey: candidateManifest }, (err, m) => {
			if (err || !m) {
				next(err || `no candidate manifest ${candidateManifest}`);
				return;
			}
			next('', { ...args, candMembers: (m.members || []).map((x) => x.blockId) });
		});
	});
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey: gatingManifest }, (err, m) => {
			if (err || !m) {
				next(err || `no gating manifest ${gatingManifest}`);
				return;
			}
			const gatingSet = new Set((m.members || []).map((x) => x.blockId));
			const extra = args.candMembers.filter((b) => !gatingSet.has(b));
			if (extra.length !== 1) {
				next(`expected EXACTLY 1 new member (the inferred edge block); found ${extra.length}`);
				return;
			}
			next('', { ...args, edgeBlockId: extra[0] });
		});
	});
	taskList.push((args, next) => {
		forgeStore.getBlock({ blockId: args.edgeBlockId }, (err, row) => {
			if (err || !row) {
				next(err || 'inferred edge block not found');
				return;
			}
			const edgeBlock = replayBlock.deserializeBlock(row.text);
			// the pin rides every edge as a property (replay-block's header schema is fixed and would drop it).
			const firstEdge = edgeBlock.edges[0];
			const dbh =
				firstEdge && firstEdge.properties && firstEdge.properties.decisionBlockHash
					? (Array.isArray(firstEdge.properties.decisionBlockHash)
							? firstEdge.properties.decisionBlockHash[0]
							: firstEdge.properties.decisionBlockHash)
					: null;
			next('', { ...args, edgeBlock, edgeBlockRow: row, decisionBlockHash: dbh });
		});
	});
	taskList.push((args, next) => {
		forgeStore.getBlock({ blockId: args.decisionBlockHash }, (err, row) => {
			if (err || !row) {
				next(err || `frozen decision block ${args.decisionBlockHash} not found`);
				return;
			}
			let parsed = null;
			let perr = null;
			const attempt = () => {
				parsed = JSON.parse(row.text);
			};
			try {
				attempt();
			} catch (e) {
				perr = e;
			}
			if (perr) {
				next(`decision block not JSON: ${perr.message}`);
				return;
			}
			next('', { ...args, decisionRecord: parsed });
		});
	});
	taskList.push((args, next) => {
		// fetch reference (CEDS) + source (the decision record's sourceStandard) blocks from candidate members.
		const sub = new taskListPlus();
		let referenceNodes = null;
		let sourceNodes = null;
		const sourceStandard = args.decisionRecord.sourceStandard;
		args.candMembers.forEach((blockId) => {
			sub.push((a2, n2) => {
				forgeStore.getBlock({ blockId }, (err, row) => {
					if (err) {
						n2(err);
						return;
					}
					if (row && row.type === 'reference' && row.subject === 'CEDS') {
						referenceNodes = replayBlock.deserializeBlock(row.text).nodes;
					}
					if (row && row.type === 'standard' && row.subject === sourceStandard) {
						sourceNodes = replayBlock.deserializeBlock(row.text).nodes;
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
			if (!referenceNodes || !sourceNodes) {
				next('could not load reference and/or source blocks from candidate manifest');
				return;
			}
			next('', { ...args, referenceNodes, sourceNodes, sourceStandard });
		});
	});
	pipeRunner(taskList.getList(), {}, (err, args) => callback(err, args));
};

// inferredDecisions (non-abstain) reconstructed from the frozen decision record.
const nonAbstainDecisions = (decisionRecord) =>
	decisionRecord.decisions
		.filter((d) => !d.abstain && d.targetKey)
		.map((d) => ({
			fromStableId: d.fromStableId,
			targetKey: d.targetKey,
			confidence: d.cosineScore,
			cosineScore: d.cosineScore,
			retrievalRank: d.retrievalRank,
		}));

const edgeKeySet = (edges) => new Set(edges.map((e) => `${e.fromRef.id}|${e.toRef.id}`));

const run = () => {
	if (!candidateManifest) {
		xLog.error('phase5 gate: no --candidateManifest. Aborting.');
		process.exit(2);
	}
	xLog.status(`[phase5 gate] candidate manifest ${candidateManifest.slice(0, 16)}…; reference '${referenceGraph}'; candidate graph '${candidateGraph}'`);

	buildSharedResources((err, resources) => {
		if (err) {
			xLog.error(`phase5 gate bootstrap failed: ${err}`);
			process.exit(2);
		}
		const { forgeStore, lifecycle, graphBuilder, fingerprinter, differ, productionGuard, baselineStore } = resources;

		loadArtifacts(forgeStore, (laErr, art) => {
			if (laErr) {
				xLog.error(`phase5 gate artifact load failed: ${laErr}`);
				process.exit(2);
			}
			const { decisionRecord, referenceNodes, sourceNodes, sourceStandard, decisionBlockHash } = art;
			const edgeBlockEdgeCount = art.edgeBlock.edges.length;

			const builder = inferredSubgraphFactory({
				predicate: 'closeMatch',
				mappingJustification: 'semapv:SemanticSimilarity',
				subjectSource: sourceStandard,
				objectSource: 'CEDS',
				mappingTool: 'edf-implied',
				decisionBlockHash,
			});

			const taskList = new taskListPlus();

			// ---- PURE TWIN 0: baseline derive == the edge block's edge count ----
			taskList.push((args, next) => {
				const base = builder.buildInferredSubgraph({
					inferredDecisions: nonAbstainDecisions(decisionRecord),
					sourceNodes,
					referenceNodes,
				});
				const N = base.counts.edgesTotal;
				record('twinPure.baselineMatchesEdgeBlock', N === edgeBlockEdgeCount && N > 0, `pure derive CLOSE_MATCH edges=${N}; edge block edges=${edgeBlockEdgeCount} (must be equal and > 0)`);
				next('', { ...args, base, N, baseKeys: edgeKeySet(base.edges) });
			});

			// ---- PURE TWIN 1: perturb one pick -> that edge's endpoint MOVES ----
			// HARDENED (WILD_FALCON 2026-06-30): pick two BASE EDGES that resolve to DISTINCT HubReferences, so
			// swapping one source's target genuinely moves an endpoint. The earlier picks[0]/picks[1] form would
			// false-RED on a pure SIF-anchor run where the first two picks both resolve to P001572 (Person
			// Identifier). If fewer than two distinct-ref picks exist, SKIP with a logged reason rather than
			// asserting on identical refs.
			taskList.push((args, next) => {
				const baseEdges = args.base.edges; // each has scalar properties + fromRef/toRef
				const eA = baseEdges[0] || null;
				let eB = null;
				for (let i = 1; i < baseEdges.length; i++) {
					if (eA && baseEdges[i].toRef.id !== eA.toRef.id) {
						eB = baseEdges[i];
						break;
					}
				}
				if (!eA || !eB) {
					const distinctRefs = new Set(baseEdges.map((e) => e.toRef.id)).size;
					record('twinPure.perturbMovesEdge', true, `SKIPPED (logged): only ${distinctRefs} distinct resolved HubReference(s) among ${baseEdges.length} edges (<2) — cannot construct a meaningful endpoint-move without asserting on identical refs`);
					next('', args);
					return;
				}
				const fromA = eA.fromRef.id;
				const refA = eA.toRef.id;
				const refB = eB.toRef.id;
				const targetKeyB = eB.properties.cedsAnchorKey; // the CEDS token that resolves to refB
				const picks = nonAbstainDecisions(decisionRecord);
				const perturbed = picks.map((p) => (p.fromStableId === fromA ? { ...p, targetKey: targetKeyB } : p));
				const after = builder.buildInferredSubgraph({ inferredDecisions: perturbed, sourceNodes, referenceNodes });
				const afterKeys = edgeKeySet(after.edges);
				const movedAway = !afterKeys.has(`${fromA}|${refA}`);
				const movedTo = afterKeys.has(`${fromA}|${refB}`);
				record('twinPure.perturbMovesEdge', movedAway && movedTo, `perturb '${fromA.split('/').pop()}' from ref …${refA.slice(-8)} -> …${refB.slice(-8)} (DISTINCT resolved refs): original pair gone=${movedAway}, new pair present=${movedTo} (a fingerprint would go RED)`);
				next('', args);
			});

			// ---- PURE TWIN 2: abstain-boundary — drop one pick -> exactly one fewer edge ----
			taskList.push((args, next) => {
				const picks = nonAbstainDecisions(decisionRecord);
				const dropped = picks.slice(1); // simulate the first source ABSTAINING
				const after = builder.buildInferredSubgraph({ inferredDecisions: dropped, sourceNodes, referenceNodes });
				const okExactlyOneFewer = after.counts.edgesTotal === args.N - 1;
				record('twinPure.abstainYieldsNoEdge', okExactlyOneFewer, `dropping one pick (an abstain) -> edges ${args.N} -> ${after.counts.edgesTotal} (must be exactly N-1; a below-threshold/NONE source yields NO edge)`);
				next('', args);
			});

			// ---- PURE TWIN 3: reify-on-demand — 0 nodes by default, exactly 1 with a curation fixture ----
			taskList.push((args, next) => {
				const noCuration = builder.buildInferredSubgraph({
					inferredDecisions: nonAbstainDecisions(decisionRecord),
					sourceNodes,
					referenceNodes,
				});
				const firstPick = nonAbstainDecisions(decisionRecord)[0];
				const withCuration = builder.buildInferredSubgraph({
					inferredDecisions: nonAbstainDecisions(decisionRecord),
					sourceNodes,
					referenceNodes,
					curationInputs: [{ fromStableId: firstPick.fromStableId, targetKey: firstPick.targetKey, annotation: 'CURATED_BY', note: 'phase5 reify twin' }],
				});
				record('twinPure.reifyOnDemand', noCuration.counts.reifiedNodes === 0 && withCuration.counts.reifiedNodes === 1, `MappingAssertion nodes: no curation=${noCuration.counts.reifiedNodes} (must be 0), 1-entry curation=${withCuration.counts.reifiedNodes} (must be exactly 1)`);
				next('', args);
			});

			// ---- GRAPH GATE ----
			// guard + clean candidate
			taskList.push((args, next) => {
				productionGuard.assertSafeBuildTarget({ graphName: candidateGraph }, (gErr) => {
					if (gErr) {
						next(`productionGuard refused '${candidateGraph}': ${gErr}`);
						return;
					}
					lifecycle.destroyInstanceByName({ graphName: candidateGraph, force: true }, () => next('', args));
				});
			});
			// build candidate
			taskList.push((args, next) => {
				xLog.status(`[phase5 gate] building candidate '${candidateGraph}'…`);
				graphBuilder.buildGraph({ manifestKey: candidateManifest, destination: candidateGraph, role: 'bronze' }, (bErr) => next(bErr, args));
			});
			// provenance: reference == frozen goldenAll
			taskList.push((args, next) => {
				baselineStore.readBaseline({ label: 'goldenAll' }, (bErr, baseline) => {
					if (bErr || !baseline || !baseline.meta || !baseline.meta.fingerprint) {
						record('reference.provenanceGoldenAll', false, `no usable goldenAll baseline: ${bErr || 'missing'}`);
						next('', args);
						return;
					}
					const scope = baseline.meta.scope || 'all';
					fingerprinter.fingerprintGraph({ graphName: referenceGraph, scope, ignoreEmbedding: !!baseline.meta.ignoreEmbedding, ignoreOwnerStamp: !!baseline.meta.ignoreOwnerStamp }, (fErr, live) => {
						if (fErr) {
							record('reference.provenanceGoldenAll', false, `reference provenance fingerprint failed: ${fErr}`);
							next('', args);
							return;
						}
						const matches = live.fingerprint === baseline.meta.fingerprint;
						record('reference.provenanceGoldenAll', matches && live.nodeCount > 0, `reference '${referenceGraph}' all-scope fp=${live.fingerprint.slice(0, 12)}… == frozen goldenAll ${baseline.meta.fingerprint.slice(0, 12)}…? ${matches} (it IS the gating golden)`);
						next('', { ...args, refNodeCount: live.nodeCount });
					});
				});
			});
			// fingerprint candidate + reference (all-scope, ignoreEmbedding, ignoreOwnerStamp) + diff
			taskList.push((args, next) => {
				fingerprinter.fingerprintGraph({ graphName: candidateGraph, ignoreEmbedding: true, scope: 'all', ignoreOwnerStamp: true }, (fErr, candFp) => {
					if (fErr) {
						next(`candidate fingerprint failed: ${fErr}`);
						return;
					}
					next('', { ...args, candFp });
				});
			});
			taskList.push((args, next) => {
				fingerprinter.fingerprintGraph({ graphName: referenceGraph, ignoreEmbedding: true, scope: 'all', ignoreOwnerStamp: true }, (fErr, refFp) => {
					if (fErr) {
						next(`reference fingerprint failed (is '${referenceGraph}' up?): ${fErr}`);
						return;
					}
					next('', { ...args, refFp });
				});
			});
			taskList.push((args, next) => {
				const diff = differ.diffManifests({ baseline: args.refFp.elementManifest, candidate: args.candFp.elementManifest });
				const s = diff.summary;
				record('diff.nothingRemovedOrChanged', s.removedNodes === 0 && s.changedNodes === 0 && s.removedEdges === 0, `removedNodes=${s.removedNodes} changedNodes=${s.changedNodes} removedEdges=${s.removedEdges} (all must be 0)`);
				record('diff.zeroAddedNodes', s.addedNodes === 0, `addedNodes=${s.addedNodes} (must be 0 — inferred mappings are EDGES, reify-on-demand)`);
				record('diff.addedEdgeCountExact', s.addedEdges === args.N, `addedEdges=${s.addedEdges} (expect ${args.N} CLOSE_MATCH edges from the frozen decisions)`);
				const addedByType = diff.edges.addedByType || {};
				const strayTypes = Object.keys(addedByType).filter((t) => t !== 'CLOSE_MATCH');
				record('diff.onlyCloseMatchAdded', strayTypes.length === 0 && (addedByType.CLOSE_MATCH || 0) === args.N, `addedByType=${JSON.stringify(addedByType)}; strayTypes=[${strayTypes.join(',')}] (expect only CLOSE_MATCH=${args.N})`);
				next('', args);
			});
			// provenance stamps on every CLOSE_MATCH edge
			taskList.push((args, next) => {
				queryOne(lifecycle, candidateGraph, `
					MATCH ()-[r:CLOSE_MATCH]->(t)
					RETURN
						count(r) AS edges,
						sum(CASE WHEN r.predicate='closeMatch' AND r.mappingJustification='semapv:SemanticSimilarity' AND r.provenanceTier='embedding-inferred' AND r.decisionBlockHash IS NOT NULL THEN 1 ELSE 0 END) AS stamped,
						sum(CASE WHEN t:HubReference THEN 1 ELSE 0 END) AS toHubRef,
						sum(CASE WHEN r.decisionBlockHash = $dh THEN 1 ELSE 0 END) AS pinned
				`, { dh: decisionBlockHash }, (qErr, row) => {
					if (qErr) {
						next(`stamp query failed: ${qErr}`);
						return;
					}
					const edges = Number(row.edges || 0), stamped = Number(row.stamped || 0), toHubRef = Number(row.toHubRef || 0), pinned = Number(row.pinned || 0);
					record('provenance.inferredStampOnEveryEdge', edges === args.N && stamped === args.N && toHubRef === args.N && pinned === args.N, `CLOSE_MATCH=${edges}; {predicate=closeMatch, justification=SemanticSimilarity, tier=embedding-inferred, decisionBlockHash set}=${stamped}; ->HubReference=${toHubRef}; pinned to frozen block=${pinned} (all must equal ${args.N})`);
					next('', args);
				});
			});
			// replay determinism: rebuild SAME manifest -> identical all-scope fingerprint (no LLM)
			taskList.push((args, next) => {
				lifecycle.destroyInstanceByName({ graphName: candidateGraph, force: true }, () => {
					graphBuilder.buildGraph({ manifestKey: candidateManifest, destination: candidateGraph, role: 'bronze' }, (bErr) => {
						if (bErr) {
							next(`determinism rebuild failed: ${bErr}`);
							return;
						}
						fingerprinter.fingerprintGraph({ graphName: candidateGraph, ignoreEmbedding: true, scope: 'all', ignoreOwnerStamp: true }, (fErr, candFp2) => {
							if (fErr) {
								next(`determinism re-fingerprint failed: ${fErr}`);
								return;
							}
							record('replay.deterministicAcrossRebuild', candFp2.fingerprint === args.candFp.fingerprint, `rebuild all-scope fp=${candFp2.fingerprint.slice(0, 12)}… == first build ${args.candFp.fingerprint.slice(0, 12)}…? ${candFp2.fingerprint === args.candFp.fingerprint} (frozen-block replay is byte-deterministic; ZERO LLM at replay)`);
							next('', args);
						});
					});
				});
			});
			// teardown
			taskList.push((args, next) => {
				lifecycle.destroyInstanceByName({ graphName: candidateGraph, force: true }, () => next('', args));
			});

			pipeRunner(taskList.getList(), {}, (pErr) => {
				if (pErr) {
					xLog.error(`\n[phase5 gate] ERROR: ${pErr}`);
					console.log(JSON.stringify({ verdict: 'ERROR', error: `${pErr}`, checks }, null, 2));
					process.exit(2);
				}
				const failures = checks.filter((c) => !c.passed);
				const verdict = failures.length === 0 ? 'GREEN' : 'RED';
				console.log(JSON.stringify({ verdict, candidateManifest, referenceGraph, total: checks.length, failures: failures.length, checks }, null, 2));
				process.exit(verdict === 'GREEN' ? 0 : 1);
			});
		});
	});
};

run();
