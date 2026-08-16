#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     runEdfiMaterialize.js — materialize the forge into the round-trip scratch container
     (forge-edfi round-trip campaign, ruling R-WO-13; renamed from runEdfiV2Materialize.js at
     the Phase 5 closeout)

DESCRIPTION
     Forges snapshot 04 with forgeEdfi (skipEmbedding — Layer 1 re-emission never reads
     vectors; zero embedding spend; deterministic) and materializes the result into the scratch
     container DEV_edfiRoundTrip_080326 via replayManager.create/init — the exact seam
     integration-forge.js proves. The materialization proof: node/edge counts read back over
     bolt equal the Phase 2 block census (6,336 nodes / 8,171 edges).

     WHY THIS RUNNER EXISTS (R-WO-13). Originally (Phases 3–4) it was the ONLY way to
     materialize this forge: the builder resolves a standard's forge EXCLUSIVELY through
     forges/edfi/parserDescriptor.ini (entryModule), which stayed pinned to the incumbent forge
     until campaign closeout, and there is deliberately NO override path — not in the forge
     spec, not in the recipe schema (additionalProperties: false). The REJECTED alternative was
     a sibling forges/edfiv2/ bundle with its own descriptor: a second live registration for the
     same standard, discoverable by the roster scanner, and closeout debt for no gain. Recorded
     so nobody resurrects it.

     SINCE THE PHASE 5 CLOSEOUT the descriptor pins this forge and snapshot 04, so a stage-ON
     recipe build materializes and round-trips edfi through the ordinary builder path. This
     runner remains the fast bundle-local materializer for the scratch round-trip container —
     forge + replayManager directly, no recipe, no bridges, no embedding spend — which is what
     runEdfiRoundTripRealGraph.js validates against.

     GNC-001: the container name is DEV_* (scratch tier) and replayManager's nameRefusal
     enforces it structurally — GOLD_*/gf_* are refused in code before any docker command runs.

     Credentials live ONLY in the container environment (NEO4J_AUTH); the round-trip validator
     later resolves them via docker inspect (roundTripEdfiCompiler.resolveContainerBolt) — the
     same single-source pattern the ceds/pesc validators use.

     EDGE-TRIPLE UNIQUENESS (the R-WO-15(d)/(f) remediation, Phase 1). Between the census check
     and materialization the runner refuses any block carrying two edges with the same
     (from, type, to) triple, naming every offender. The replay engine MERGEs on that triple, so
     duplicates collapse into one relationship silently; today the collapse is harmless because
     every REFERENCES edge carries only provenanceTier, but the moment edges carry per-edge data
     it becomes last-write-wins data loss with no error raised anywhere. The check is ORTHOGONAL
     to the census check above, not a refinement of it: a duplicated triple leaves the forge-side
     edge COUNT unchanged, so counting cannot see it.

EXIT
     0 materialized and count-verified;  1 refusal, count mismatch, or duplicate edge triples
     (the container is left in place for diagnosis when init succeeded but verification failed).
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');

const forgeEdfi = require('../forgeEdfi.js')({ embedder: null }); // the framework refuses an ABSENT embedder key by name (F3b)
const roundTripEdfiCompiler = require('../lib/roundTripEdfiCompiler')();
const replayManager = require('../../../apps/graph-builder/apps/replay-manager')();
// the forger's OWN producer->engine translator (ref externalization + PG-JSON property arrays)
// — the same seam forger.forge uses before replayManager.init; bundle output is NOT engine shape
const { shapeForgedGraph } = require('../../../apps/graph-builder/apps/forger/lib/shape-forged-graph')();

const SCRATCH_GRAPH_NAME = 'DEV_edfiRoundTrip_080326';
const BASE_GRAPH_LABEL = 'StandardBase';
const SNAPSHOT_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '04');
const EXPECTED_NODE_COUNT = 6336; // Phase 2 census of record (DEVLOG handoff)
const EXPECTED_EDGE_COUNT = 8171;

const failOut = (failureMessage) => {
	console.error(`${moduleName} FAILED: ${failureMessage}`);
	process.exit(1);
};

console.error(`[${moduleName}] forging snapshot 04 (skipEmbedding) ...`);
forgeEdfi.forge({ sourcePath: SNAPSHOT_PATH, skipEmbedding: true }, (forgeError, forgeResult) => {
	if (forgeError) {
		failOut(forgeError);
		return;
	}
	console.error(
		`[${moduleName}] forged ${forgeResult.nodes.length} nodes / ${forgeResult.edges.length} edges`,
	);
	if (forgeResult.nodes.length !== EXPECTED_NODE_COUNT || forgeResult.edges.length !== EXPECTED_EDGE_COUNT) {
		failOut(
			`forge output ${forgeResult.nodes.length}/${forgeResult.edges.length} does not match the ` +
				`Phase 2 census of record ${EXPECTED_NODE_COUNT}/${EXPECTED_EDGE_COUNT} — refusing to ` +
				`materialize an unexpected block`,
		);
		return;
	}

	// ── PHASE 1 GATE — edge-triple uniqueness ────────────────────────────────────────────────
	// Runs on the FORGED BLOCK, before materialization, because the failure it guards against
	// happens inside replayManager.init and leaves no trace: the engine's `MERGE ... SET r +=
	// e.props` folds two edges sharing (from, type, to) into ONE relationship and reports success.
	//
	// THIS IS NOT A REFINEMENT OF THE COUNT ASSERTION ABOVE — it is orthogonal to it. A duplicated
	// triple does not change the forge-side edge count at all, so cardinality is structurally
	// unable to see it. Both checks are needed and neither implies the other.
	const edgeTripleAudit = roundTripEdfiCompiler.findDuplicateEdgeTriples({
		edgeList: forgeResult.edges,
	});
	console.error(
		`[${moduleName}] edge-triple uniqueness: ${forgeResult.edges.length} edges / ` +
			`${edgeTripleAudit.distinctCount} distinct (from, type, to) triples`,
	);
	if (edgeTripleAudit.duplicateList.length) {
		edgeTripleAudit.duplicateList.forEach((oneDuplicate) => {
			console.error(
				`  DUPLICATE x${oneDuplicate.occurrenceCount}  ${oneDuplicate.fromStableId} ` +
					`-[${oneDuplicate.edgeType}]-> ${oneDuplicate.toStableId}`,
			);
		});
		failOut(
			`${edgeTripleAudit.duplicateList.length} duplicate (from, type, to) edge triple(s) in a block ` +
				`of ${forgeResult.edges.length} edges — every offending triple is listed above. Duplicate ` +
				`triples collapse under the replay engine's MERGE; with edge properties, collapse is ` +
				`last-write-wins data loss. Refusing to materialize`,
		);
		return;
	}

	// engine shape via the forger's own translator; with skipEmbedding no node carries a vector,
	// so the shaper declares embeddingDims null — the explicit "nothing was embedded" declaration
	// replayManager verifies against the payload
	const shaped = shapeForgedGraph({ forged: forgeResult, declaredEmbeddingDims: null });
	if (shaped.error) {
		failOut(shaped.error);
		return;
	}
	const nodeEdges = shaped;

	console.error(`[${moduleName}] provisioning scratch container '${SCRATCH_GRAPH_NAME}' ...`);
	replayManager.create({ graphName: SCRATCH_GRAPH_NAME }, (createError, graphHandle) => {
		if (createError) {
			failOut(createError);
			return;
		}
		console.error(`[${moduleName}] container ready at ${graphHandle.boltUrl}`);
		replayManager.init(
			{
				inGraph: graphHandle,
				nodeEdges,
				applyLabels: [BASE_GRAPH_LABEL],
				sourceLabel: `nodeEdges from forgeEdfi over snapshot 04 (Phase 3 round-trip materialization)`,
			},
			(initError, loadReport) => {
				if (initError) {
					failOut(initError);
					return;
				}
				console.error(`[${moduleName}] init complete; verifying counts over bolt via docker inspect ...`);
				roundTripEdfiCompiler.resolveContainerBolt(
					{ containerName: SCRATCH_GRAPH_NAME },
					(resolveError, boltTriple) => {
						if (resolveError) {
							failOut(resolveError);
							return;
						}
						const neo4j = require('neo4j-driver');
						const driver = neo4j.driver(
							boltTriple.boltUrl,
							neo4j.auth.basic(boltTriple.user, boltTriple.password),
							{ encrypted: false, disableLosslessIntegers: true },
						);
						const session = driver.session();
						session
							.run(
								// ┌─ TRAP ─────────────────────────────────────────────────────────────────┐
								// DO NOT remove the WITH barrier below, and DO NOT clone this query without
								// it. It is load-bearing, not style. (Doctrine amendment A8, §5.4a under
								// RT-7.)
								//
								// WHAT THE NAIVE SHAPE DOES: put the node pattern and the relationship
								// pattern in ONE match scope and the relationship match re-runs for EVERY
								// node row, leaving DISTINCT to collapse a CARTESIAN PRODUCT — rows =
								// nodes x relationships.
								//
								// OBSERVED COST, not theorized:
								//   at SIF scale (27,069 nodes x 88,757 rels = ~2.4 BILLION rows):
								//       naive form  — a full core at 101% CPU for OVER TEN MINUTES,
								//                     killed before it ever returned
								//       barriered   — 3.5 seconds
								//   at Ed-Fi scale (6,336 x 8,171 = ~51.8M rows):
								//       naive form  — 34.2 SECONDS
								//       barriered   — 176 ms  (~194x)
								//
								// WHY THAT MATTERS MORE AT THIS SCALE, NOT LESS: 34 seconds COMPLETES. It
								// looks fine. That is how this survived a signed-off runner until a bigger
								// corpus made it fatal. A cost that is merely survivable is the dangerous
								// kind, because nothing prompts anyone to question it.
								//
								// WHY THE BARRIER WORKS: aggregating to a single row first means each
								// relationship is matched exactly once, which makes DISTINCT UNNECESSARY
								// rather than merely cheaper. Same answers both forms — proven on ONE graph
								// before this edit shipped (6,336 / 8,171 either way).
								//
								// PROVENANCE: found by the forge-sif Phase 2 builder, which inherited this
								// shape FROM this runner and hit the wall first, then reported it across the
								// fence instead of reaching across it. The reference implementation
								// (forges/ceds/test/runCedsHubBridgeGates.js) already used the barriered
								// idiom; this query was written fresh instead of copied from it.
								// └────────────────────────────────────────────────────────────────────────┘
								`MATCH (oneNode:ForgedNode {_source: 'EdFi'})
								 WITH count(oneNode) AS nodeCount
								 OPTIONAL MATCH (:ForgedNode {_source: 'EdFi'})-[oneEdge]->(:ForgedNode {_source: 'EdFi'})
								 RETURN nodeCount, count(oneEdge) AS edgeCount`,
							)
							.then((countResult) => {
								session.close();
								return driver.close().then(() => countResult);
							})
							.then((countResult) => {
								const nodeCount = countResult.records[0].get('nodeCount');
								const edgeCount = countResult.records[0].get('edgeCount');
								const countsMatch =
									nodeCount === EXPECTED_NODE_COUNT && edgeCount === EXPECTED_EDGE_COUNT;
								console.log(
									JSON.stringify(
										{
											containerName: SCRATCH_GRAPH_NAME,
											boltUrl: boltTriple.boltUrl,
											materializedNodeCount: nodeCount,
											materializedEdgeCount: edgeCount,
											expectedNodeCount: EXPECTED_NODE_COUNT,
											expectedEdgeCount: EXPECTED_EDGE_COUNT,
											countsMatch,
										},
										null,
										1,
									),
								);
								if (!countsMatch) {
									failOut(
										`materialized counts ${nodeCount}/${edgeCount} do not equal the block census ` +
											`${EXPECTED_NODE_COUNT}/${EXPECTED_EDGE_COUNT} — either the loader dropped or ` +
											`added rows, or the graph was touched between init and verification. ` +
											`Block-side duplicate (from, type, to) triples are EXCLUDED as a cause: the ` +
											`uniqueness check above passed on this exact block. Container left in place ` +
											`for diagnosis`,
									);
									return;
								}
								console.error(`[${moduleName}] MATERIALIZED AND COUNT-VERIFIED`);
								process.exit(0);
							})
							.catch((queryError) => {
								session.close();
								failOut(`count verification query: ${queryError.message}`);
							});
					},
				);
			},
		);
	});
});
