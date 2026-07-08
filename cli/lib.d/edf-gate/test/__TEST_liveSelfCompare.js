#!/usr/bin/env node
'use strict';

// __TEST_liveSelfCompare.js — the REAL-SCALE self-consistency proof for assertGraphEquivalence
// (QUIET_ECHO's required item 2). Runs the ACTUAL assertGraphEquivalence orchestration + the real
// fingerprinter + graphDiff against a live graph compared to ITSELF, at full scale (~105k nodes /
// ~75k embeddings). Two independent read-only fingerprints of the same static graph MUST come back
// byteIdentical (regime=transport) with the embedding axis live. Anything else is a real finding.
//
// STRICTLY READ-ONLY, NO STORE MUTATION, NO CONTAINER WRITE, NO GRAPH BUILD: the graph is reached
// through a read-only lifecycle SHIM (a runCypher that opens a READ session directly against the bolt
// URI with runtime creds and returns records exactly as instance-lifecycle.runCypherAgainst does —
// result.records.map(r => r.toObject())). It never touches the forgeStore graphs table, never
// registers the graph, never writes to the container. Creds passed at runtime (argv), never committed.
//
// Usage: node __TEST_liveSelfCompare.js <boltUri> <password> [graphName] [user]
//   e.g. node __TEST_liveSelfCompare.js bolt://localhost:7714 <pw> gf_allStandards2 neo4j

const path = require('path');
const neo4j = require('neo4j-driver');

process.global = {
	xLog: {
		status: (...a) => console.error(...a),
		error: (...a) => console.error(...a),
		result: (...a) => console.log(...a),
		verbose: (...a) => console.error(...a),
	},
};

const boltUri = process.argv[2];
const password = process.argv[3];
const graphName = process.argv[4] || 'liveGraph';
const user = process.argv[5] || 'neo4j';

if (!boltUri || !password) {
	console.error('usage: node __TEST_liveSelfCompare.js <boltUri> <password> [graphName] [user]');
	process.exit(2);
}

const GATE_LIB = path.join(__dirname, '..', 'lib');
const fingerprinterFactory = require(path.join(GATE_LIB, 'graph-fingerprint', 'graphFingerprint'));
const differFactory = require(path.join(GATE_LIB, 'graph-diff', 'graphDiff'));
const graphEquivalenceFactory = require(path.join(GATE_LIB, 'graph-equivalence', 'graphEquivalence'));

// one driver, reused across all reads; READ sessions only. (lossless integers left intact, exactly
// as instance-lifecycle does, so the shim's records match the real path byte-for-byte.)
const driver = neo4j.driver(boltUri, neo4j.auth.basic(user, password));

// READ-ONLY lifecycle shim — the ONLY promise->callback adapter, at the driver boundary. Mirrors
// instance-lifecycle.runCypherAgainst's record shape.
const lifecycleShim = {
	runCypher: ({ graphName: requestedGraph, cypher }, cb) => {
		const session = driver.session({ defaultAccessMode: neo4j.session.READ });
		session.run(cypher).then(
			(result) => {
				const records = result.records.map((record) => record.toObject());
				session.close().then(() => cb('', { records, summary: result.summary }));
			},
			(err) => {
				session.close().then(() => cb(`runCypher(shim) failed: ${err.message || err}`));
			},
		);
	},
};

const fingerprinter = fingerprinterFactory({ lifecycle: lifecycleShim });
const differ = differFactory();
const graphEquivalence = graphEquivalenceFactory({ fingerprinter, differ });

console.error(`[liveSelfCompare] fingerprinting ${graphName} TWICE (read-only) and comparing…`);

graphEquivalence.assertGraphEquivalence({ graphA: graphName, graphB: graphName }, (err, result) => {
	const finish = (code) => driver.close().then(() => process.exit(code));
	if (err) {
		console.error(`[liveSelfCompare] ERROR: ${err}`);
		finish(1);
		return;
	}
	const expectedGreen =
		result.valid === true &&
		result.byteIdentical === true &&
		result.regime === 'transport' &&
		result.embeddingAxisLive === true;
	console.log(
		JSON.stringify(
			{
				graphName,
				verdict: expectedGreen
					? 'SELF-CONSISTENT byteIdentical (GREEN, regime=transport)'
					: 'UNEXPECTED — investigate (see fields)',
				valid: result.valid,
				regime: result.regime,
				byteIdentical: result.byteIdentical,
				structurallyEquivalent: result.structurallyEquivalent,
				embeddingAxisLive: result.embeddingAxisLive,
				nonEmpty: result.nonEmpty,
				nodeCountA: result.nodeCountA,
				nodeCountB: result.nodeCountB,
				edgeCountA: result.edgeCountA,
				edgeCountB: result.edgeCountB,
				embeddingCoverageA: result.embeddingCoverageA,
				embeddingDivergentCount: result.embeddingDivergentCount,
				fingerprintA: result.fingerprintA,
				fingerprintB: result.fingerprintB,
				diffSummary: result.diff.summary,
			},
			null,
			2,
		),
	);
	finish(expectedGreen ? 0 : 1);
});
