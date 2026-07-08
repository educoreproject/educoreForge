'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// graphEquivalence.js — assertGraphEquivalence: two materialized graphs are identical UP TO the
// embedding-vector VALUES (Phase 0 of the embedding-sidecar build).
//
// This is the proving apparatus for the sidecar work: it certifies that a graph built the new way
// (embeddings resolved from the content-addressed sidecar store) is the SAME graph as the legacy
// build — structurally identical, and identical in its per-node embedding too when the cache was
// transported rather than re-embedded. A gate proven to bite; nothing later ships trusted.
//
// NOT to be confused with `edf-equivalence` (the Phase-6 MAPPING equivalence producer that emits
// curated EXACT_MATCH edges). That is a different sense of "equivalence" entirely. This module is
// about whole-graph materialization equivalence.
//
// REUSE, DO NOT FORK. It is built ON the two existing Phase-0 modules:
//   - graphFingerprint.js — its FULL mode (ignoreEmbedding=false) folds a per-node `embeddingHash`
//     into each canonical node line, so the embedding VALUE is compared through a stable hash.
//   - graphDiff.js — its describeNodeChange already separates `embeddingChanged` from
//     `changedProps` / `labelsChanged`, which is exactly the structural-vs-embedding split we need.
//   One FULL fingerprint per graph + one diff yields BOTH axes; no re-hash, single read per graph.
//   (Trap avoided: feeding a FULL manifest to fingerprintFromManifest with ignoreEmbedding=true
//   does NOT strip the embeddingHash already baked into the line — stripping happens at
//   buildNodeLine time — so we never do that.)
//
// THE VERDICT HAS TWO AXES:
//   structurallyEquivalent — no node/edge added/removed, and every differing node differs ONLY in
//                            its embedding. This is `equivalent`: "identical up to embedding values"
//                            (the load-bearing acceptance in PLAN §6.1).
//   byteIdentical          — additionally every embeddingHash matches (the whole graph is
//                            byte-for-byte the same, embeddings included).
//
// REGIMES map ONE-TO-ONE onto PLAN Decision D2 (transport-the-cache vs rebuild-on-target):
//   'transport'          = byteIdentical: the cache travelled, every vector resolved, the golden
//                          stays byte-reproducible. THE DEFAULT deploy regime (D2).
//   'rebuild-equivalent' = structurallyEquivalent but embeddings differ: the target re-embedded, so
//                          vectors drift ~1e-6. Valid ONLY where bit-identical reproduction is not
//                          asserted — the D2 opt-in rebuild regime. This gate is the arbiter (§3.6).
//   'divergent'          = a real structural fault: the graphs are not the same graph.
// A reader maps gate output straight to the deploy choice without guessing (per QUIET_ECHO ruling).
//
// EMBEDDING-AXIS LIVENESS (guards a false GREEN): a byteIdentical verdict is only meaningful if the
// embeddingHash axis is actually alive. If a live path ever produced manifests with absent/null
// embeddingHash on every node, a self-compare would STILL report byteIdentical (null == null) — a
// vacuous GREEN hiding a dead embedding axis. embeddingCoverage() counts non-null embeddingHash so
// the live caller can POSITIVELY assert presence (the embedding-axis analogue of the nonEmpty
// guard). assertGraphEquivalence returns coverage for both graphs so the hole is always visible.
//
// Async style: qtools taskListPlus/pipeRunner; lifecycle.runCypher resolves at the leaf (inside the
// injected fingerprinter). No async/await, no try/catch for control flow. camelCase only.
//
// @concept: [[GraphEquivalence]]
// @concept: [[EquivalenceUpToEmbeddingValues]]
// @concept: [[EquivalenceRegime]]
// @concept: [[EmbeddingAxisLiveness]]

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// =====================================================================
// PURE — classify a diff into the two-axis equivalence verdict
// =====================================================================

// A changed node is STRUCTURAL if its labels or any non-embedding property differ; it is
// EMBEDDING-ONLY if the only thing that differs is its embeddingHash. (graphDiff already stripped
// the raw `embedding` property from the compared map and surfaces `embeddingChanged` separately.)
const isStructuralNodeChange = (change) =>
	!!change.labelsChanged || (change.changedProps || []).length > 0;

// compareEquivalence({manifestA, manifestB}) -> verdict. PURE, synchronous.
// manifestA/manifestB are FULL-mode elementManifests: { nodes: string[], edges: string[] } of sorted
// canonical lines (each node line carries embeddingHash). manifestA is treated as the baseline.
const buildComparer = ({ differ }) => ({ manifestA, manifestB } = {}) => {
	const diff = differ.diffManifests({ baseline: manifestA, candidate: manifestB });

	const changed = diff.nodes.changed || [];
	const structuralChangedNodes = changed.filter(isStructuralNodeChange);
	const embeddingDivergence = changed
		.filter((oneChange) => oneChange.embeddingChanged)
		.map((oneChange) => oneChange.stableId)
		.sort();

	const structuralDifferenceCount =
		diff.summary.addedNodes +
		diff.summary.removedNodes +
		diff.summary.addedEdges +
		diff.summary.removedEdges +
		structuralChangedNodes.length;

	const structurallyEquivalent = structuralDifferenceCount === 0;
	// byteIdentical: EVERY node/edge line matches, embeddingHash included. diff.identical is exactly
	// that condition over FULL-mode manifests (the lines contain embeddingHash).
	const byteIdentical = diff.identical;
	const equivalent = structurallyEquivalent;

	const regime = !structurallyEquivalent
		? 'divergent'
		: byteIdentical
			? 'transport'
			: 'rebuild-equivalent';

	return {
		equivalent,
		structurallyEquivalent,
		byteIdentical,
		regime,
		embeddingDivergence,
		embeddingDivergentCount: embeddingDivergence.length,
		counts: {
			addedNodes: diff.summary.addedNodes,
			removedNodes: diff.summary.removedNodes,
			changedNodes: diff.summary.changedNodes,
			structuralChangedNodes: structuralChangedNodes.length,
			embeddingOnlyChangedNodes: changed.length - structuralChangedNodes.length,
			addedEdges: diff.summary.addedEdges,
			removedEdges: diff.summary.removedEdges,
		},
		diff,
	};
};

// embeddingCoverage(manifest) -> { total, withEmbeddingHash, withoutEmbeddingHash }. PURE. Counts
// node lines whose embeddingHash is present and non-null. Backs the live presence-assert that keeps
// byteIdentical from being vacuously true on a dead embedding axis.
const embeddingCoverage = (manifest = {}) => {
	const nodeLines = manifest.nodes || [];
	let withEmbeddingHash = 0;
	nodeLines.forEach((oneLine) => {
		const parsed = JSON.parse(oneLine);
		if (parsed.embeddingHash !== null && parsed.embeddingHash !== undefined) {
			withEmbeddingHash += 1;
		}
	});
	return {
		total: nodeLines.length,
		withEmbeddingHash,
		withoutEmbeddingHash: nodeLines.length - withEmbeddingHash,
	};
};

// =====================================================================
// MODULE — curried DI ({ fingerprinter, differ } from edf-gate shared resources)
// =====================================================================

const moduleFunction = ({ moduleName } = {}) => ({ fingerprinter, differ } = {}) => {
	const { xLog } = process.global;

	const compareEquivalence = buildComparer({ differ });

	// assertGraphEquivalence({graphA, graphB, ignoreOwnerStamp?, scope?}, cb) -> live verdict.
	// Fingerprints BOTH graphs in FULL mode (ignoreEmbedding=false, so embeddingHash is present),
	// then compares. Carries a nonEmpty guard (two empty graphs must NOT report equivalent) and the
	// embeddingHash presence coverage for both sides (the embedding-axis liveness assert).
	const assertGraphEquivalence = (
		{ graphA, graphB, ignoreOwnerStamp = false, scope = 'forgedNode' } = {},
		callback,
	) => {
		if (!graphA || !graphB) {
			callback('assertGraphEquivalence: graphA and graphB are both required');
			return;
		}

		const taskList = new taskListPlus();

		taskList.push((args, next) => {
			fingerprinter.fingerprintGraph(
				{ graphName: graphA, ignoreOwnerStamp, ignoreEmbedding: false, scope },
				(err, fingerprint) => {
					if (err) {
						next(`assertGraphEquivalence: fingerprint '${graphA}' failed: ${err}`);
						return;
					}
					next('', { ...args, fingerprintA: fingerprint });
				},
			);
		});

		taskList.push((args, next) => {
			fingerprinter.fingerprintGraph(
				{ graphName: graphB, ignoreOwnerStamp, ignoreEmbedding: false, scope },
				(err, fingerprint) => {
					if (err) {
						next(`assertGraphEquivalence: fingerprint '${graphB}' failed: ${err}`);
						return;
					}
					next('', { ...args, fingerprintB: fingerprint });
				},
			);
		});

		taskList.push((args, next) => {
			const manifestA = args.fingerprintA.elementManifest;
			const manifestB = args.fingerprintB.elementManifest;
			const verdict = compareEquivalence({ manifestA, manifestB });
			const coverageA = embeddingCoverage(manifestA);
			const coverageB = embeddingCoverage(manifestB);
			// nonEmpty: two empty graphs would compare byteIdentical and falsely report GREEN.
			const nonEmpty =
				args.fingerprintA.nodeCount > 0 && args.fingerprintB.nodeCount > 0;
			// embeddingAxisLive: the byteIdentical result is only trustworthy if embeddingHash is
			// actually populated (else null==null gives a vacuous match). Presence on BOTH sides.
			const embeddingAxisLive =
				coverageA.withEmbeddingHash > 0 && coverageB.withEmbeddingHash > 0;
			next('', {
				...args,
				verdict,
				coverageA,
				coverageB,
				nonEmpty,
				embeddingAxisLive,
			});
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err) {
				callback(err);
				return;
			}
			// A verdict is VALID only when both graphs are non-empty AND the embedding axis is live.
			// Without validity, byteIdentical/equivalent must not be read as a GREEN.
			const valid = args.nonEmpty && args.embeddingAxisLive;
			const result = {
				graphA,
				graphB,
				valid,
				nonEmpty: args.nonEmpty,
				embeddingAxisLive: args.embeddingAxisLive,
				...args.verdict,
				embeddingCoverageA: args.coverageA,
				embeddingCoverageB: args.coverageB,
				nodeCountA: args.fingerprintA.nodeCount,
				nodeCountB: args.fingerprintB.nodeCount,
				edgeCountA: args.fingerprintA.edgeCount,
				edgeCountB: args.fingerprintB.edgeCount,
				fingerprintA: args.fingerprintA.fingerprint,
				fingerprintB: args.fingerprintB.fingerprint,
			};
			xLog.verbose(
				`[graphEquivalence] ${graphA} vs ${graphB}: regime=${result.regime}, ` +
					`valid=${valid}, byteIdentical=${result.byteIdentical}, ` +
					`structurallyEquivalent=${result.structurallyEquivalent}, ` +
					`embeddingCoverage=${args.coverageA.withEmbeddingHash}/${args.coverageA.total}`,
			);
			callback('', result);
		});
	};

	return {
		assertGraphEquivalence,
		compareEquivalence,
		embeddingCoverage,
	};
};

module.exports = moduleFunction({ moduleName });
