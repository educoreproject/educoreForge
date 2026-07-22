#!/usr/bin/env node
'use strict';

// integration-forge-lif.js — the LIVE milestone proof: replayManager.create provisions a real
// DEV_* scratch Neo4j; the forger forges REAL LIF into it; Cypher gates verify the graph in both
// directions (including one gate PROVEN TO GO RED on an injected fault); the scratch graph is
// destroyed. Spends real resources (a docker container; Voyage credit unless --vectorize=false),
// so it is DELIBERATE: its name does not match test-*.js and runAllTests never runs it.
//
//   node integration-forge-lif.js                  full proof (real Voyage embeddings)
//   node integration-forge-lif.js --vectorize=false smoke mode: no Voyage spend, embedding gate skipped
//   node integration-forge-lif.js -keepGraph       leave the scratch graph up for inspection
//
// On gate FAILURE the scratch graph is kept and named so it can be inspected (delete by hand:
// docker rm -f <name>). On success it is destroyed unless -keepGraph.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- live proof: provision scratch graph, forge real LIF, Cypher-gate, destroy

SYNOPSIS
     ${moduleName} [--vectorize=false] [-keepGraph] [-verbose] [-help]

DESCRIPTION
     The forge-LIF milestone acceptance run. Provisions a throwaway DEV_* Neo4j container,
     forges the real LIF source into it with real Voyage embeddings (unless --vectorize=false),
     asserts the Cypher gates, proves the searchText gate BITES by injecting a fault and
     watching it go red, and destroys the container.

EXIT STATUS
     0 all gates green AND the red-gate proof fired;  1 otherwise.
`;

const path = require('path');

const commandLineParameters = require('../../../../../test/testLib/testAppStartup')({
	moduleName,
	helpText: helpText(),
});

const harness = require('../../../../../test/testLib/harness')(moduleName);
const { xLog } = process.global;

const vectorize = (commandLineParameters.values.vectorize || [])[0] !== 'false';
const keepGraph = !!commandLineParameters.switches.keepGraph;

const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', '..', 'lib');
const { DME_ROLES } = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary'));
const neo4j = require('neo4j-driver');

const replayManager = require('../../replay-manager')();
const forger = require('../forger')();

// one cypher round-trip against the scratch graph
const runCypher = (handle, cypher, callback) => {
	const driver = neo4j.driver(handle.boltUrl, neo4j.auth.basic('neo4j', handle.password));
	const session = driver.session();
	session
		.run(cypher)
		.then((result) => {
			const records = result.records.map((oneRecord) => oneRecord.toObject());
			session.close().then(() => driver.close()).then(() => callback('', records));
		})
		.catch((err) => {
			session.close().then(() => driver.close()).catch(() => {});
			callback(`cypher failed: ${err.message}`);
		});
};

const asNumber = (value) => (value && typeof value.toNumber === 'function' ? value.toNumber() : value);

// the searchText gate as a FUNCTION, because the red-gate proof reruns it after the fault.
const searchTextViolations = (handle, callback) => {
	runCypher(
		handle,
		`MATCH (n:ForgedNode) WHERE n.searchText IS NULL OR n.searchText = '' RETURN count(n) AS violations`,
		(err, records) => callback(err, err ? undefined : asNumber(records[0].violations)),
	);
};

const finish = (handle, exitCode) => {
	const done = () => {
		harness.report(); // prints the tally; exits nonzero on assertion failures
		process.exit(exitCode);
	};
	if (!handle) {
		done();
		return;
	}
	if (keepGraph || exitCode !== 0) {
		xLog.status(
			`[${moduleName}] scratch graph KEPT for inspection: '${handle.graphName}' at ${handle.boltUrl} (docker rm -f ${handle.graphName} when done)`,
		);
		done();
		return;
	}
	replayManager.delete(handle, (err) => {
		if (err) {
			xLog.error(`[${moduleName}] cleanup failed (container may need manual rm): ${err}`);
		}
		done();
	});
};

// =====================================================================
// THE RUN — create -> forge -> gates -> red-proof -> destroy
// =====================================================================

xLog.status(`[${moduleName}] vectorize=${vectorize} keepGraph=${keepGraph}`);

replayManager.create({ purpose: 'lifProof' }, (createErr, handle) => {
	if (createErr) {
		harness.ok('scratch graph provisioned', false, createErr);
		finish(null, 1);
		return;
	}
	harness.section(`PROVISION — scratch graph '${handle.graphName}'`);
	harness.match('graph name is DEV_* (GNC-001 scratch tier)', handle.graphName, /^DEV_/);
	harness.match('bolt url handed back', handle.boltUrl, /^bolt:\/\/localhost:\d+$/);

	forger.forge(
		{ standard: 'lif', version: 'current', destination: handle, vectorize },
		(forgeErr, forged) => {
			if (forgeErr) {
				harness.ok('forge LIF into scratch graph', false, forgeErr);
				finish(handle, 1);
				return;
			}
			harness.section('FORGE — real LIF into the scratch graph');
			harness.equal('forger reports the standard', forged.standard, 'LIF');
			harness.ok(`forged a real graph (${forged.nodeCount} nodes)`, forged.nodeCount > 2900, forged.nodeCount);
			harness.equal('every serialized node was merged', forged.nodesMerged, forged.nodeCount);
			harness.equal('every serialized edge was merged', forged.edgesMerged, forged.edgeCount);
			if (vectorize) {
				harness.ok(`embedding calls were made (${forged.embedCallCount})`, forged.embedCallCount > 0);
			}

			harness.section('CYPHER GATES — the graph itself testifies');

			runCypher(handle, `MATCH (n:ForgedNode) RETURN count(n) AS n`, (e1, r1) => {
				if (e1) { harness.ok('node count query', false, e1); finish(handle, 1); return; }
				harness.equal('G1 node count in graph == forger report', asNumber(r1[0].n), forged.nodeCount);

				runCypher(
					handle,
					`MATCH (n:ForgedNode) WHERE n.stableId IS NULL OR n.stableId = '' RETURN count(n) AS v`,
					(e2, r2) => {
						if (e2) { harness.ok('stableId gate query', false, e2); finish(handle, 1); return; }
						harness.equal('G2a every node has a non-empty stableId', asNumber(r2[0].v), 0);

						runCypher(handle, `MATCH (n:ForgedNode) RETURN collect(DISTINCT n.role) AS roles`, (e3, r3) => {
							if (e3) { harness.ok('role gate query', false, e3); finish(handle, 1); return; }
							const roles = r3[0].roles;
							const legalRoles = Object.values(DME_ROLES);
							harness.ok(
								`G2b every role is in DME_ROLES (found: ${roles.join(', ')})`,
								roles.length > 0 && roles.every((oneRole) => legalRoles.includes(oneRole)),
								roles.join(','),
							);

							searchTextViolations(handle, (e4, v4) => {
								if (e4) { harness.ok('searchText gate query', false, e4); finish(handle, 1); return; }
								harness.equal('G3 every node has non-empty searchText', v4, 0);

								runCypher(
									handle,
									`MATCH ()-[r]->() WHERE type(r) IN ['HAS_CLASS','HAS_PROPERTY','HAS_OPTION_SET','HAS_VALUE','REFERENCES'] AND r.provenanceTier IS NULL RETURN count(r) AS v`,
									(e5, r5) => {
										if (e5) { harness.ok('provenanceTier gate query', false, e5); finish(handle, 1); return; }
										harness.equal('G4 every ownership/reference edge carries provenanceTier', asNumber(r5[0].v), 0);

										runCypher(
											handle,
											`MATCH (n:ForgedNode) WHERE n.crossRefs IS NULL RETURN count(n) AS v`,
											(e6, r6) => {
												if (e6) { harness.ok('crossRefs gate query', false, e6); finish(handle, 1); return; }
												harness.equal('G5 crossRefs present on every node (never absent)', asNumber(r6[0].v), 0);

												const embeddingGate = (afterEmbedding) => {
													if (!vectorize) {
														xLog.status('  (G6 embedding gate SKIPPED — vectorize=false smoke mode)');
														afterEmbedding();
														return;
													}
													runCypher(
														handle,
														`MATCH (n:ForgedNode) WHERE n.embedding IS NULL OR size(n.embedding) <> 1024 RETURN count(n) AS v`,
														(e7, r7) => {
															if (e7) { harness.ok('embedding gate query', false, e7); finish(handle, 1); return; }
															harness.equal('G6 every node carries a 1024-dim embedding', asNumber(r7[0].v), 0);
															afterEmbedding();
														},
													);
												};

												embeddingGate(() => {
													// ===== RED-GATE PROOF: a gate never observed failing is unproven =====
													harness.section('RED-GATE PROOF — inject a fault, watch G3 bite');
													runCypher(
														handle,
														`MATCH (n:ForgedNode) WITH n LIMIT 1 REMOVE n.searchText RETURN n.stableId AS victim`,
														(e8, r8) => {
															if (e8) { harness.ok('fault injection', false, e8); finish(handle, 1); return; }
															xLog.status(`  fault injected: searchText removed from '${r8[0].victim}'`);
															searchTextViolations(handle, (e9, v9) => {
																if (e9) { harness.ok('re-run G3', false, e9); finish(handle, 1); return; }
																harness.equal('G3 goes RED on the injected fault (violations=1)', v9, 1);
																finish(handle, 0);
															});
														},
													);
												});
											},
										);
									},
								);
							});
						});
					},
				);
			});
		},
	);
});
