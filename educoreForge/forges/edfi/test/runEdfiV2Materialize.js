#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     runEdfiV2Materialize.js — materialize the V2 forge into the Phase 3 scratch container
     (forge-edfi round-trip campaign, ruling R-WO-13)

DESCRIPTION
     Forges snapshot 04 with forgeEdfiV2 (skipEmbedding — Layer 1 re-emission never reads
     vectors; zero embedding spend; deterministic) and materializes the result into the scratch
     container DEV_edfiRoundTrip_080326 via replayManager.create/init — the exact seam
     integration-forge.js proves. The materialization proof: node/edge counts read back over
     bolt equal the Phase 2 block census (6,336 nodes / 8,171 edges).

     WHY THIS RUNNER EXISTS (R-WO-13, recorded so nobody resurrects the alternative): the
     builder resolves a standard's forge EXCLUSIVELY through forges/edfi/parserDescriptor.ini
     (entryModule), which stays pinned to the incumbent forgeEdfi.js until campaign closeout
     (RT-12/RT-13 flips are later phases). There is deliberately NO override path — not in the
     forge spec, not in the recipe schema (additionalProperties: false). The REJECTED
     alternative was a sibling forges/edfiv2/ bundle with its own descriptor: that would be a
     second live registration for the same standard, discoverable by the roster scanner, and
     closeout debt for no gain. A checked-in bundle-local runner driving the forge and
     replayManager directly is the precedented path (the pesc campaign's
     DEV_pescRoundTrip_080326 was built exactly this way — its runner was never committed;
     this one is).

     GNC-001: the container name is DEV_* (scratch tier) and replayManager's nameRefusal
     enforces it structurally — GOLD_*/gf_* are refused in code before any docker command runs.

     Credentials live ONLY in the container environment (NEO4J_AUTH); the round-trip validator
     later resolves them via docker inspect (roundTripEdfiCompiler.resolveContainerBolt) — the
     same single-source pattern the ceds/pesc validators use.

EXIT
     0 materialized and count-verified;  1 refusal or count mismatch (the container is left
     in place for diagnosis when init succeeded but verification failed).
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');

const forgeEdfiV2 = require('../forgeEdfiV2.js')({});
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
forgeEdfiV2.forge({ sourcePath: SNAPSHOT_PATH, skipEmbedding: true }, (forgeError, forgeResult) => {
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
				sourceLabel: `nodeEdges from forgeEdfiV2 over snapshot 04 (Phase 3 round-trip materialization)`,
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
								`MATCH (oneNode:ForgedNode {_source: 'EdFi'})
								 OPTIONAL MATCH (:ForgedNode {_source: 'EdFi'})-[oneEdge]->(:ForgedNode {_source: 'EdFi'})
								 RETURN count(DISTINCT oneNode) AS nodeCount, count(DISTINCT oneEdge) AS edgeCount`,
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
											`${EXPECTED_NODE_COUNT}/${EXPECTED_EDGE_COUNT} — the loader dropped or added ` +
											`something; container left in place for diagnosis`,
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
