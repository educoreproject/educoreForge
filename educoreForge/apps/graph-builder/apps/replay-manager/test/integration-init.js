#!/usr/bin/env node
'use strict';

// integration-init.js — the LIVE proof for replayManager.init (work order Phase 2): a real DEV_*
// scratch Neo4j is provisioned, a REAL forge bundle's output is shaped and loaded through init,
// and Cypher gates interrogate the graph itself. Includes a RED-GATE PROOF: a deliberately
// unlabeled node is offered to init against the live graph and must be REFUSED with the graph
// left untouched — the guards proven to bite where it actually matters rather than only in
// memory.
//
// Spends a docker container. Spends Voyage credit only with --vectorize=true (default OFF here:
// the guards and the load are what this proves, and embeddings are proven by integration-forge).
// Deliberate: its name does not match test-*.js, so runAllTests never runs it.
//
//   node integration-init.js                     LIF, no embeddings
//   node integration-init.js --standard=ceds     the big one
//   node integration-init.js --vectorize=true    with real embeddings
//   node integration-init.js -keepGraph          leave the scratch graph up for inspection

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- live proof: provision, shape a real forge bundle's output, init it, gate it

SYNOPSIS
     ${moduleName} [--standard=<token>] [--vectorize=true] [-keepGraph] [-verbose] [-help]

DESCRIPTION
     Provisions a throwaway DEV_* Neo4j, runs a real forge bundle in memory, shapes its output to
     engine shape, loads it with replayManager.init applying the StandardBase label, and asserts
     Cypher gates over the resulting graph. Then proves the pre-write guards REFUSE through init
     against the live graph without writing anything, and destroys the container.

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

const neo4j = require('neo4j-driver');
const replayManagerModule = require('../replayManager');
const replayManager = replayManagerModule();
const forgerModule = require('../../forger/forger');
const { shapeForgedGraph } = require('../../forger/lib/shape-forged-graph');

const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', '..', 'lib');

const BASE_GRAPH_LABEL = 'StandardBase';
const MIN_NODES = { lif: 2900, ceds: 23000 };

const vectorize = (commandLineParameters.values.vectorize || [])[0] === 'true';
const keepGraph = !!commandLineParameters.switches.keepGraph;
const standard = (commandLineParameters.values.standard || ['lif'])[0];

if (MIN_NODES[standard] === undefined) {
	xLog.error(`${moduleName}: no MIN_NODES floor for '${standard}' — add one before proving`);
	process.exit(1);
}

// harness.report() exits with the right code by itself (0 only when nothing failed), so the
// caller's job here is just to destroy the scratch graph first. A failed run KEEPS the graph so it
// can be inspected — the same convention integration-forge uses.
const finish = (handle, failedHard) => {
	if (!handle || keepGraph || failedHard) {
		if (handle && (keepGraph || failedHard)) {
			xLog.status(`[${moduleName}] scratch graph '${handle.graphName}' KEPT for inspection`);
		}
		harness.report();
		return;
	}
	replayManager.delete(handle, (err) => {
		if (err) xLog.error(`[${moduleName}] cleanup failed: ${err}`);
		harness.report();
	});
};

const query = (handle, cypher, callback) => {
	const driver = neo4j.driver(handle.boltUrl, neo4j.auth.basic('neo4j', handle.password), {
		encrypted: false,
	});
	const session = driver.session({ defaultAccessMode: neo4j.session.READ });
	session
		.run(cypher)
		.then((result) => {
			session.close().then(() => driver.close());
			callback('', result.records);
		})
		.catch((err) => {
			session.close().then(() => driver.close());
			callback(err.message);
		});
};

// ---- run the real forge bundle in memory (no graph involved: forge bundles are graph-blind) ----
const resolved = forgerModule.resolveBundle({ standard });
if (resolved.error) {
	xLog.error(resolved.error);
	process.exit(1);
}
const embedder = vectorize
	? require(path.join(TREE_LIB, 'embedding', 'embedding-client'))({
			configFilePath: forgerModule.resolveVoyageConfigPath({}),
		})
	: null;

// the declared vector width is the SAME ini value the embedder sends to the API; there is no
// in-code width standing in for it (polyArch2 §6). Nothing embedded means nothing to declare.
const declaredEmbeddingDims = embedder ? embedder.resolveEmbeddingIdentity().embeddingDims : undefined;

xLog.status(`[${moduleName}] forging ${resolved.standardName} in memory (vectorize=${vectorize})`);

require(resolved.entryPath)({ embedder }).forge(
	{ sourcePath: resolved.defaultSource, owner: ':golden', skipEmbedding: !vectorize },
	(forgeErr, forged) => {
		if (forgeErr) {
			harness.ok('forge bundle ran', false, forgeErr);
			finish(null, 1);
			return;
		}

		const shaped = shapeForgedGraph({ forged, declaredEmbeddingDims });
		if (shaped.error) {
			harness.ok('shapeForgedGraph produced engine shape', false, shaped.error);
			finish(null, 1);
			return;
		}

		harness.section('SHAPE — the forge bundle output translated to engine shape');
		harness.ok(
			`real corpus shaped (${shaped.nodes.length} nodes >= floor ${MIN_NODES[standard]})`,
			shaped.nodes.length >= MIN_NODES[standard],
			shaped.nodes.length,
		);
		harness.equal('node count survives shaping', shaped.nodes.length, forged.nodes.length);
		harness.equal('edge count survives shaping', shaped.edges.length, forged.edges.length);
		harness.ok('every shaped node has a ref.source', shaped.nodes.every((n) => !!n.ref.source));
		harness.equal(
			'embeddingDims reflects reality',
			shaped.embeddingDims,
			vectorize ? 1024 : null,
		);

		replayManager.create({ purpose: `${standard}InitProof` }, (createErr, handle) => {
			if (createErr) {
				harness.ok('scratch graph provisioned', false, createErr);
				finish(null, 1);
				return;
			}
			harness.section(`PROVISION — scratch graph '${handle.graphName}'`);
			harness.match('graph name is DEV_* (GNC-001 scratch tier)', handle.graphName, /^DEV_/);

			replayManager.init(
				{
					inGraph: handle,
					nodeEdges: shaped,
					applyLabels: [BASE_GRAPH_LABEL],
					sourceLabel: `nodeEdges from forge bundle '${resolved.standardName}'`,
				},
				(initErr, report) => {
					if (initErr) {
						harness.ok('init loaded the graph', false, initErr);
						finish(handle, 1);
						return;
					}

					harness.section('INIT — the load reports what it did');
					harness.equal('every node was merged', report.nodesMerged, shaped.nodes.length);
					harness.equal('every edge was merged', report.edgesMerged, shaped.edges.length);
					harness.ok(
						'no dangling edge refs',
						!report.danglingRefs || report.danglingRefs.length === 0,
						report.danglingRefs,
					);
					harness.ok(
						'the resolution-key index was built',
						(report.indexesBuilt || []).includes('replay_reskey'),
						report.indexesBuilt,
					);

					harness.section('CYPHER GATES — the graph itself testifies');
					query(handle, 'MATCH (n:ForgedNode) RETURN count(n) AS c', (e1, rows) => {
						if (e1) {
							harness.ok('graph is queryable', false, e1);
							finish(handle, 1);
							return;
						}
						harness.equal(
							'the graph holds exactly the shaped nodes',
							rows[0].get('c').toNumber(),
							shaped.nodes.length,
						);

						query(
							handle,
							`MATCH (n:ForgedNode) WHERE NOT n:${BASE_GRAPH_LABEL} RETURN count(n) AS c`,
							(e2, labelRows) => {
								if (e2) {
									harness.ok('label query ran', false, e2);
									finish(handle, 1);
									return;
								}
								harness.equal(
									`applyLabels reached EVERY node (none missing :${BASE_GRAPH_LABEL})`,
									labelRows[0].get('c').toNumber(),
									0,
								);

								query(
									handle,
									'MATCH (n:ForgedNode) WHERE n.stableId IS NULL RETURN count(n) AS c',
									(e3, idRows) => {
										if (e3) {
											harness.ok('stableId query ran', false, e3);
											finish(handle, 1);
											return;
										}
										harness.equal(
											'every node carries its stableId (the resolution key)',
											idRows[0].get('c').toNumber(),
											0,
										);

										// ==========================================================
										harness.section('RED-GATE PROOF — the guards bite against a LIVE graph');
										// ==========================================================
										// Offer init one unlabeled node. It must refuse, and the graph
										// must be exactly as it was. A guard that only works in memory
										// is not the guard we need.
										const poison = {
											nodes: [
												{
													ref: { source: 'POISON', id: 'urn:poison' },
													labels: ['DmeClass'],
													stableId: 'urn:poison',
													properties: { uri: ['urn:poison'] },
												},
											],
											edges: [],
										};
										replayManager.init(
											{
												inGraph: handle,
												nodeEdges: poison,
												applyLabels: [BASE_GRAPH_LABEL],
												sourceLabel: 'the deliberate poison batch',
											},
											(poisonErr) => {
												harness.match(
													'an unlabeled node is REFUSED through init',
													poisonErr,
													/ForgedNode enforcement/,
												);
												harness.match(
													'  and the refusal names the source',
													poisonErr,
													/deliberate poison batch/,
												);
												query(
													handle,
													'MATCH (n) RETURN count(n) AS c',
													(e4, afterRows) => {
														if (e4) {
															harness.ok('post-poison query ran', false, e4);
															finish(handle, 1);
															return;
														}
														harness.equal(
															'  and NOTHING was written — the graph is untouched',
															afterRows[0].get('c').toNumber(),
															shaped.nodes.length,
														);
														finish(handle);
													},
												);
											},
										);
									},
								);
							},
						);
					});
				},
			);
		});
	},
);
