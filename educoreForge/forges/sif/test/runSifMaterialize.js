#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     runSifMaterialize.js — materialize the SIF forge into the Phase 2 scratch container
     (forge-sif round-trip campaign; the edfi R-WO-13 checked-in-runner precedent)

DESCRIPTION
     Forges snapshot 01 with forgeSif (skipEmbedding — Layer 1 re-emission never reads vectors;
     zero embedding spend; deterministic) and materializes the result into the scratch container
     DEV_sifRoundTrip_080326 via replayManager.create/init.

     THE MATERIALIZATION PROOF, AND WHAT IT ACTUALLY COMPARES. Two amendments, both kept here
     because the second only makes sense against the first.

     2026-08-04 (supervisor-approved, after this gate went RED on its first run): the graph was
     verified against the block's DISTINCT (type|from|to) TRIPLE count rather than its raw
     declaration count. The first version compared 88,766 block DECLARATIONS against 88,757
     distinct graph RELATIONSHIPS and reported loader loss that had not happened — two different
     measurables. The block carried 7 duplicated REFERENCES triples (9 surplus declarations)
     because lib/parser.js dedups references by (source, target, VIA) while forgeSif's edge
     translation erased via, so distinct-via references to one target became byte-identical
     declarations that the loader's MERGE collapsed. Recorded as R-SF-9 (via-erasure), a named
     enrichment-backlog item — NOT fixed then: this runner measures, it does not adjudicate forge
     semantics. That was a defensible call and it is why the finding survived to be fixed.

     2026-09-02 — R-SF-9 IS RESOLVED, and this runner is RE-KEYED, not renumbered. The forge now
     carries via/mandatory/nativeEdgeType onto the canonical edge, and the shared write path merges
     on the full property map instead of on the bare (from, type, to) pattern, so the nine no
     longer collapse. "What the loader can hold" therefore changed, and the comparison follows it:
     graph relationships are now checked against distinct block edge IDENTITIES
     (type|from|to|sorted key=value). NOTHING WAS RENUMBERED — no count in this file was ever a
     literal but the two census-of-record anchors, and both are unchanged.

     THE TRIPLE CENSUS IS DELIBERATELY STILL COMPUTED AND STILL PRINTED ON EVERY RUN. Those seven
     triples are still seven triples and the block still declares nine surplus BY TRIPLE; what
     changed is that the loader now keeps them as separate relationships. Printing it is how the
     collapse stopped being silent for a month, and removing it to tidy the output would erase the
     measurement that made the defect visible.

     Assertions: node count EXACT against the R-SF-3 census of record (27,069); block
     declaration count EXACT against that same census (88,766 — the anchor); graph relationships
     EQUAL to distinct block edge identities (88,766 since the R-SF-9 resolution; it was 88,757
     against distinct TRIPLES before it).

     WHY THIS RUNNER EXISTS (the edfi R-WO-13 precedent, recorded so nobody resurrects the
     alternative): the builder resolves a standard's forge EXCLUSIVELY through
     forges/sif/parserDescriptor.ini, and this phase's fence forbids shared-infrastructure
     edits (R-SF-4). A checked-in bundle-local runner driving the forge and replayManager
     directly is the precedented path.

     GNC-001: the container name is DEV_* (scratch tier) and replayManager's nameRefusal
     enforces it structurally — GOLD_*/gf_* are refused in code before any docker command runs.

     Credentials live ONLY in the container environment (NEO4J_AUTH); the round-trip validator
     later resolves them via docker inspect (roundTripSifCompiler.resolveContainerBolt) — the
     same single-source pattern the ceds/pesc/edfi validators use.

OPTIONS
     -verifyOnly            skip forge/provision/init and run ONLY the count verification
                            against an already-materialized container. The block-side census is
                            still computed from the real forge (it is the answer key), so this
                            re-verifies without rebuilding — and it is how the verification leg
                            is exercised while a loaded container is being preserved as evidence.
     --containerName=<name> verify (or provision) a container other than the default scratch
                            container. GNC-001 still applies: replayManager refuses non-DEV_
                            names in code.

EXIT
     0 materialized (or verified) and count-verified;  1 refusal or count mismatch (the
     container is left in place for diagnosis when init succeeded but verification failed).
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');

const forgeSif = require('../forgeSif.js')({ embedder: null });
const roundTripSifCompiler = require('../lib/roundTripSifCompiler')();
const replayManager = require('../../../apps/graph-builder/apps/replay-manager')();
// the forger's OWN producer->engine translator (ref externalization + PG-JSON property arrays)
// — the same seam forger.forge uses before replayManager.init; bundle output is NOT engine shape
const { shapeForgedGraph } = require('../../../apps/graph-builder/apps/forger/lib/shape-forged-graph')();

const { commandLineParameters } = process.global;
const verifyOnly = Boolean(commandLineParameters.switches.verifyOnly);
const containerName =
	(commandLineParameters.values.containerName || [])[0] || 'DEV_sifRoundTrip_080326';

const BASE_GRAPH_LABEL = 'StandardBase';
const SNAPSHOT_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
const EXPECTED_NODE_COUNT = 27069; // the R-SF-3 census of record (DEVLOG handoff, 1f8501ea…)
const EXPECTED_DECLARED_EDGE_COUNT = 88766;

const failOut = (failureMessage) => {
	console.error(`${moduleName} FAILED: ${failureMessage}`);
	process.exit(1);
};

// -----
// censusBlockEdges — the block's edge measurables, kept apart because conflating them is the
// exact defect the 2026-08-04 amendment corrected. declaredCount is what the forge EMITTED.
//
// ⚠ RE-KEYED 2026-09-02, WHEN R-SF-9 WAS RESOLVED. distinctCount is "what the loader can hold",
// and that quantity CHANGED when the write path stopped keying its merge on the bare triple. It is
// now distinct by (type, from, to, SORTED key=VALUE property pairs), which is the loader's real
// identity. This is a RE-KEYING, not a renumbering: nothing here was a hardcoded number and nothing
// was renumbered to make a red go green.
//
// The TRIPLE census is DELIBERATELY KEPT AND STILL PRINTED. It is R-SF-9's own history — those seven
// triples are still seven triples, the block still declares nine surplus BY TRIPLE, and the only
// thing that changed is that the loader no longer collapses them. Deleting the triple census to
// tidy the output would erase the measurement that made the defect visible for a month.
const censusBlockEdges = ({ edges }) => {
	const countByTriple = new Map();
	const countByIdentity = new Map();
	edges.forEach((oneEdge) => {
		const edgeTriple = `${oneEdge.type}|${oneEdge.fromRef.id}|${oneEdge.toRef.id}`;
		countByTriple.set(edgeTriple, (countByTriple.get(edgeTriple) || 0) + 1);
		const propertyNameList = Object.keys(oneEdge.properties || {}).sort();
		const propertyText = propertyNameList
			.map((onePropertyName) => `${onePropertyName}=${JSON.stringify(oneEdge.properties[onePropertyName])}`)
			.join(',');
		const edgeIdentity = `${edgeTriple}|${propertyText}`;
		countByIdentity.set(edgeIdentity, (countByIdentity.get(edgeIdentity) || 0) + 1);
	});
	const duplicateList = [...countByTriple.entries()]
		.filter(([, occurrenceCount]) => occurrenceCount > 1)
		.map(([edgeTriple, occurrenceCount]) => ({ edgeTriple, occurrenceCount }))
		.sort((leftEntry, rightEntry) => leftEntry.edgeTriple.localeCompare(rightEntry.edgeTriple));
	return {
		declaredCount: edges.length,
		distinctCount: countByIdentity.size,
		distinctTripleCount: countByTriple.size,
		duplicateList,
		surplusDeclarationCount: edges.length - countByTriple.size,
		// declarations that are identical in EVERY property, which a property-keyed merge still
		// collapses and correctly so. Non-zero here would be a genuine duplicate emission.
		identicalDeclarationCount: edges.length - countByIdentity.size,
	};
};

// -----
// reportDuplicateCensus — printed on EVERY run, including the zero case. A collapse nobody
// printed is indistinguishable from no collapse at all.
const reportDuplicateCensus = ({ edgeCensus }) => {
	console.error(
		`[${moduleName}] block edges: ${edgeCensus.declaredCount} declared, ` +
			`${edgeCensus.distinctCount} distinct (type|from|to|key=value) — ` +
			`${edgeCensus.identicalDeclarationCount} identical declaration(s); ` +
			`${edgeCensus.distinctTripleCount} distinct (type|from|to), ` +
			`${edgeCensus.surplusDeclarationCount} surplus by triple`,
	);
	if (!edgeCensus.duplicateList.length) {
		console.error(`[${moduleName}] triples carrying more than one declaration: NONE`);
		return;
	}
	console.error(
		`[${moduleName}] triples carrying more than one declaration (R-SF-9 via-erasure, RESOLVED ` +
			`2026-09-02; ${edgeCensus.duplicateList.length} triple(s)) — these are DISTINGUISHED BY ` +
			`their via/mandatory properties and the loader now KEEPS them as separate relationships:`,
	);
	edgeCensus.duplicateList.forEach((oneDuplicate) => {
		console.error(`[${moduleName}]   x${oneDuplicate.occurrenceCount}  ${oneDuplicate.edgeTriple}`);
	});
};

// -----
// verifyMaterializedCounts — read the graph over bolt (endpoint from docker inspect) and compare
// against the block census: nodes EXACT, graph relationships EQUAL to distinct block edge IDENTITIES
// (type, from, to, sorted key=value) — re-keyed 2026-09-02 with the R-SF-9 resolution.
const verifyMaterializedCounts = ({ edgeCensus }, callback) => {
	roundTripSifCompiler.resolveContainerBolt({ containerName }, (resolveError, boltTriple) => {
		if (resolveError) {
			callback(resolveError);
			return;
		}
		const neo4j = require('neo4j-driver');
		const driver = neo4j.driver(
			boltTriple.boltUrl,
			neo4j.auth.basic(boltTriple.user, boltTriple.password),
			{ encrypted: false, disableLosslessIntegers: true },
		);
		const session = driver.session();
		// COUNTED IN TWO STAGES, DELIBERATELY (a SCALE finding of this phase, 2026-08-04): the
		// inherited edfi query shape put both patterns in ONE match, which is a cartesian product
		// — 27,069 nodes x 88,757 relationships is 2.4 BILLION rows for DISTINCT to collapse.
		// Observed: it churned a full core for >10 minutes on this corpus and was killed. It is
		// tolerable at edfi's scale (6,336 x 8,171 = 51M rows, 47x less work) and NOT at SIF's,
		// which is exactly the kind of thing this phase was told to report rather than suffer.
		// The WITH barrier makes the node count a single scalar before the relationship pattern
		// runs, so each relationship is matched exactly once and DISTINCT is unnecessary — the
		// pattern itself cannot duplicate a relationship between two named-label endpoints.
		session
			.run(
				`MATCH (oneNode:ForgedNode {_source: 'SIF'})
				 WITH count(oneNode) AS nodeCount
				 OPTIONAL MATCH (:ForgedNode {_source: 'SIF'})-[oneEdge]->(:ForgedNode {_source: 'SIF'})
				 RETURN nodeCount, count(oneEdge) AS edgeCount`,
			)
			.then((countResult) => {
				session.close();
				return driver.close().then(() => countResult);
			})
			.then((countResult) => {
				const nodeCount = countResult.records[0].get('nodeCount');
				const edgeCount = countResult.records[0].get('edgeCount');
				const nodesMatch = nodeCount === EXPECTED_NODE_COUNT;
				const edgesMatch = edgeCount === edgeCensus.distinctCount;
				console.log(
					JSON.stringify(
						{
							containerName,
							boltUrl: boltTriple.boltUrl,
							verifyOnly,
							materializedNodeCount: nodeCount,
							materializedEdgeCount: edgeCount,
							expectedNodeCount: EXPECTED_NODE_COUNT,
							blockDeclaredEdgeCount: edgeCensus.declaredCount,
							expectedDistinctEdgeCount: edgeCensus.distinctCount,
							duplicateTripleCount: edgeCensus.duplicateList.length,
							surplusDeclarationCount: edgeCensus.surplusDeclarationCount,
							nodesMatch,
							edgesMatch,
							countsMatch: nodesMatch && edgesMatch,
						},
						null,
						1,
					),
				);
				if (!nodesMatch || !edgesMatch) {
					callback(
						`materialized counts ${nodeCount}/${edgeCount} do not equal the block census ` +
							`${EXPECTED_NODE_COUNT} nodes / ${edgeCensus.distinctCount} distinct edges ` +
							`(block declared ${edgeCensus.declaredCount}; ${edgeCensus.surplusDeclarationCount} ` +
							`surplus declaration(s) named above) — the loader dropped or added something; ` +
							`container left in place for diagnosis`,
					);
					return;
				}
				callback('');
			})
			.catch((queryError) => {
				session.close();
				failOut(`count verification query: ${queryError.message}`);
			});
	});
};

console.error(`[${moduleName}] forging snapshot 01 (skipEmbedding) ...`);
forgeSif.forge({ sourcePath: SNAPSHOT_PATH, skipEmbedding: true }, (forgeError, forgeResult) => {
	if (forgeError) {
		failOut(forgeError);
		return;
	}
	const edgeCensus = censusBlockEdges({ edges: forgeResult.edges });
	console.error(`[${moduleName}] forged ${forgeResult.nodes.length} nodes`);
	reportDuplicateCensus({ edgeCensus });

	if (
		forgeResult.nodes.length !== EXPECTED_NODE_COUNT ||
		edgeCensus.declaredCount !== EXPECTED_DECLARED_EDGE_COUNT
	) {
		failOut(
			`forge output ${forgeResult.nodes.length}/${edgeCensus.declaredCount} does not match the ` +
				`R-SF-3 census of record ${EXPECTED_NODE_COUNT}/${EXPECTED_DECLARED_EDGE_COUNT} — ` +
				`refusing to materialize an unexpected block`,
		);
		return;
	}

	const finish = (verifyError) => {
		if (verifyError) {
			failOut(verifyError);
			return;
		}
		console.error(
			`[${moduleName}] ${verifyOnly ? 'VERIFIED (verifyOnly)' : 'MATERIALIZED AND COUNT-VERIFIED'}`,
		);
		process.exit(0);
	};

	if (verifyOnly) {
		console.error(
			`[${moduleName}] -verifyOnly: skipping provision/init; verifying '${containerName}' ...`,
		);
		verifyMaterializedCounts({ edgeCensus }, finish);
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

	console.error(`[${moduleName}] provisioning scratch container '${containerName}' ...`);
	replayManager.create({ graphName: containerName }, (createError, graphHandle) => {
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
				sourceLabel: `nodeEdges from forgeSif over snapshot 01 (Phase 2 round-trip materialization)`,
			},
			(initError, loadReport) => {
				if (initError) {
					failOut(initError);
					return;
				}
				console.error(`[${moduleName}] init complete; verifying counts over bolt via docker inspect ...`);
				verifyMaterializedCounts({ edgeCensus }, finish);
			},
		);
	});
});
