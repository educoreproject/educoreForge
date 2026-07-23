#!/usr/bin/env node
'use strict';

// integration-restore.js — the LIVE proof for replayManager.init's RESTORATION payload (work
// order Phase 4). It is the acceptance for that phase, and nothing else is.
//
// The question it answers is the only one that matters about restoration: does a graph built out
// of a harvested schema block hold what the graph it was harvested FROM held? So it runs the full
// round trip across TWO graphs, with the first one DESTROYED before the second is built — the
// destruction is deliberate, because a second graph standing next to a live first one could pass
// this proof by accident.
//
//   forge LIF in memory  ->  create DEV_ graph ONE  ->  init(nodeEdges)  ->  harvest a block
//     ->  DELETE graph ONE  ->  create DEV_ graph TWO  ->  init(schemaBlocks)  ->  Cypher gates
//
// The block is offered to init in the { text, refId } record form, so the content-address
// verification is exercised on the honest side too, not only in the fast suite's refusals.
//
// NO EMBEDDINGS, deliberately: the forge runs with skipEmbedding, so this script spends docker
// containers but never a cent of Voyage credit. Restoration fidelity of vectors is the embedding
// sidecar's proof, not this one's.
//
// Deliberate: its name does not match test-*.js, so runAllTests never runs it.
//
//   node integration-restore.js                  the round trip
//   node integration-restore.js -keepGraph       leave the RESTORED graph up for inspection

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- live proof: harvest a block out of one graph, restore it into another

SYNOPSIS
     ${moduleName} [-keepGraph] [-verbose] [-quiet] [-help]

DESCRIPTION
     Forges LIF in memory (no embeddings, no Voyage spend), loads it into a throwaway DEV_* graph
     through the CREATION payload, harvests a schema block, DESTROYS that graph, provisions a
     second DEV_* graph, and loads the harvested block through the RESTORATION payload
     (init({ schemaBlocks })). Cypher then interrogates the restored graph: same node and edge
     counts as the original, every node still carrying :StandardBase (proving the labels rode
     along INSIDE the block, which is why applyLabels is refused on this path), and every node
     carrying its stableId. Ends with red proofs that the restoration refusals bite against a live
     graph without writing anything. Both graphs are destroyed.

EXIT STATUS
     0 all gates green AND the red proofs fired;  1 otherwise.
`;

const { execFile } = require('child_process');

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

const BASE_GRAPH_LABEL = 'StandardBase';
const STANDARD = 'lif';
const MIN_NODES = 2900; // LIF's floor, same as integration-init's — a shrunken corpus is a finding

const keepGraph = !!commandLineParameters.switches.keepGraph;

// Two graphs exist over the life of this script and BOTH must be cleaned up, including on the
// failure paths — a leaked DEV_* container is a cost the next run pays. Handles are collected as
// they are provisioned and released together at the end. A failed run keeps the graphs so they can
// be inspected, the same convention integration-init uses.
const liveHandles = [];

// a DECLARATION, not a const arrow: it is called from inside deeply nested callbacks defined
// above its own position in the source, and a const in the temporal dead zone would surface as a
// ReferenceError swallowed by the surrounding error handling.
function finish(failedHard) {
	if (keepGraph || failedHard) {
		liveHandles.forEach((oneHandle) =>
			xLog.status(`[${moduleName}] scratch graph '${oneHandle.graphName}' KEPT for inspection`),
		);
		harness.report();
		return;
	}
	function deleteNext(index) {
		if (index >= liveHandles.length) {
			harness.report();
			return;
		}
		replayManager.delete(liveHandles[index], (err) => {
			if (err) {
				xLog.error(`[${moduleName}] cleanup failed: ${err}`);
			}
			deleteNext(index + 1);
		});
	}
	deleteNext(0);
}

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

// countOf — a single-number Cypher answer, which is what every gate below asks for.
const countOf = (handle, cypher, callback) => {
	query(handle, cypher, (err, rows) => {
		if (err) {
			callback(err);
			return;
		}
		callback('', rows[0].get('c').toNumber());
	});
};

// ---- run the real forge bundle in memory (forge bundles are graph-blind; no graph exists yet) --

const resolved = forgerModule.resolveBundle({ standard: STANDARD });
if (resolved.error) {
	xLog.error(resolved.error);
	process.exit(1);
}

xLog.status(`[${moduleName}] forging ${resolved.standardName} in memory (NO embeddings)`);

require(resolved.entryPath)({ embedder: null }).forge(
	{ sourcePath: resolved.defaultSource, owner: ':golden', skipEmbedding: true },
	(forgeErr, forged) => {
		if (forgeErr) {
			harness.ok('forge bundle ran', false, forgeErr);
			finish(1);
			return;
		}

		const shaped = shapeForgedGraph({ forged });
		if (shaped.error) {
			harness.ok('shapeForgedGraph produced engine shape', false, shaped.error);
			finish(1);
			return;
		}

		harness.section('SOURCE MATERIAL — a real corpus, forged in memory');
		harness.ok(
			`LIF shaped (${shaped.nodes.length} nodes >= floor ${MIN_NODES})`,
			shaped.nodes.length >= MIN_NODES,
			shaped.nodes.length,
		);
		harness.equal('no embeddings were computed (no Voyage spend)', shaped.embeddingDims, null);

		// The header is what makes the harvested bytes interpretable later. embeddingDims comes from
		// what was actually forged rather than from a constant, so a header cannot claim vectors the
		// block does not carry.
		const header = {
			blockType: 'standard',
			standardKey: forged.standardKey,
			version: forged.metadata.version,
			stableUriPropertyName: forged.stableUriPropertyName,
			resolutionKey: forged.stableUriPropertyName,
			embeddingModelVersion: 'voyage-4-large',
			embeddingEncoding: 'base64',
			embeddingDtype: 'float32',
			embeddingByteOrder: 'little-endian',
			embeddingDims: shaped.embeddingDims,
		};

		// ==========================================================================
		// GRAPH ONE — creation, then harvest
		// ==========================================================================
		replayManager.create({ purpose: 'lifRestoreOrigin' }, (createErr, originHandle) => {
			if (createErr) {
				harness.ok('origin graph provisioned', false, createErr);
				finish(1);
				return;
			}
			liveHandles.push(originHandle);

			harness.section(`ORIGIN GRAPH '${originHandle.graphName}' — the creation payload`);
			harness.match('origin graph name is DEV_* (GNC-001)', originHandle.graphName, /^DEV_/);

			replayManager.init(
				{
					inGraph: originHandle,
					nodeEdges: shaped,
					applyLabels: [BASE_GRAPH_LABEL],
					sourceLabel: `nodeEdges from forge bundle '${resolved.standardName}'`,
				},
				(initErr, originReport) => {
					if (initErr) {
						harness.ok('init loaded the origin graph', false, initErr);
						finish(1);
						return;
					}
					harness.equal(
						'every node merged into the origin',
						originReport.nodesMerged,
						shaped.nodes.length,
					);
					harness.equal(
						'every edge merged into the origin',
						originReport.edgesMerged,
						shaped.edges.length,
					);

					// The ORIGIN's own census, read from the graph itself. Every restoration gate below
					// compares against THESE numbers, never against a number written in a document.
					countOf(originHandle, 'MATCH (n:ForgedNode) RETURN count(n) AS c', (e1, originNodes) => {
						if (e1) {
							harness.ok('origin node census ran', false, e1);
							finish(1);
							return;
						}
						countOf(originHandle, 'MATCH ()-[r]->() RETURN count(r) AS c', (e2, originEdges) => {
							if (e2) {
								harness.ok('origin edge census ran', false, e2);
								finish(1);
								return;
							}
							xLog.status(
								`[${moduleName}] ORIGIN census: ${originNodes} nodes, ${originEdges} edges`,
							);
							harness.ok('the origin graph holds nodes', originNodes > 0, originNodes);
							harness.ok('the origin graph holds edges', originEdges > 0, originEdges);

							replayManager.harvest(
								{ inGraph: originHandle, selectionLabels: [BASE_GRAPH_LABEL], header },
								(harvestErr, schemaBlock) => {
									if (harvestErr) {
										harness.ok('a schema block was harvested', false, harvestErr);
										finish(1);
										return;
									}

									harness.section('HARVEST — the durable artifact comes out');
									harness.match(
										'the block carries a sha256 content address',
										schemaBlock.blockId,
										/^[0-9a-f]{64}$/,
									);
									harness.equal(
										'the harvested node count equals the origin census',
										schemaBlock.nodeCount,
										originNodes,
									);
									harness.equal(
										'the harvested edge count equals the origin census',
										schemaBlock.edgeCount,
										originEdges,
									);

									// DESTROY the origin BEFORE restoring. A restored graph standing next to
									// a live original could pass every gate below by accident.
									replayManager.delete(originHandle, (deleteErr) => {
										if (deleteErr) {
											harness.ok('the origin graph was destroyed', false, deleteErr);
											finish(1);
											return;
										}
										liveHandles.length = 0;

										// Asserted against docker rather than against delete's own say-so: the
										// point of destroying the origin is that it is GONE, and a verb
										// reporting success is not the same fact.
										execFile(
											'docker',
											['ps', '-a', '--filter', `name=^${originHandle.graphName}$`, '--format', '{{.Names}}'],
											{ encoding: 'utf-8' },
											(psErr, psOut) => {
												harness.equal(
													'the ORIGIN graph is GONE from docker before restoration begins',
													`${psOut || ''}`.trim(),
													'',
												);
												restoreAndGate({ schemaBlock, originNodes, originEdges });
											},
										);
									});
								},
							);
						});
					});
				},
			);
		});

		// ==========================================================================
		// GRAPH TWO — restoration, and the gates that are the point of this script
		// ==========================================================================
		// A DECLARATION for the temporal-dead-zone reason stated at the top: it is called from
		// inside the callback chain above, which is written before it in the source.
		function restoreAndGate({ schemaBlock, originNodes, originEdges }) {
			replayManager.create({ purpose: 'lifRestoreTarget' }, (createErr, restoredHandle) => {
				if (createErr) {
					harness.ok('restoration graph provisioned', false, createErr);
					finish(1);
					return;
				}
				liveHandles.push(restoredHandle);

				harness.section(`RESTORED GRAPH '${restoredHandle.graphName}' — the restoration payload`);
				harness.match(
					'restoration graph name is DEV_* (GNC-001)',
					restoredHandle.graphName,
					/^DEV_/,
				);

				// The { text, refId } record form: the honest side of the content-address check, which
				// the fast suite only ever exercises with a lie.
				replayManager.init(
					{
						inGraph: restoredHandle,
						schemaBlocks: [{ text: schemaBlock.blockText, refId: schemaBlock.blockId }],
					},
					(restoreErr, restoreReport) => {
						if (restoreErr) {
							harness.ok('init restored the graph from the schema block', false, restoreErr);
							finish(1);
							return;
						}

						harness.section('RESTORATION REPORT — the same shape the creation payload returns');
						harness.equal(
							'nodesMerged equals the origin census',
							restoreReport.nodesMerged,
							originNodes,
						);
						harness.equal(
							'edgesMerged equals the origin census',
							restoreReport.edgesMerged,
							originEdges,
						);
						harness.ok(
							'no dangling edge refs — every endpoint resolved',
							!restoreReport.danglingRefs || restoreReport.danglingRefs.length === 0,
							restoreReport.danglingRefs,
						);
						harness.ok(
							'the resolution-key index was built',
							(restoreReport.indexesBuilt || []).includes('replay_reskey'),
							restoreReport.indexesBuilt,
						);

						harness.section('CYPHER GATES — the RESTORED graph itself testifies');
						countOf(
							restoredHandle,
							'MATCH (n:ForgedNode) RETURN count(n) AS c',
							(e1, restoredNodes) => {
								if (e1) {
									harness.ok('restored node census ran', false, e1);
									finish(1);
									return;
								}
								harness.equal(
									'the restored graph holds the SAME node count as the original',
									restoredNodes,
									originNodes,
								);

								countOf(
									restoredHandle,
									'MATCH ()-[r]->() RETURN count(r) AS c',
									(e2, restoredEdges) => {
										if (e2) {
											harness.ok('restored edge census ran', false, e2);
											finish(1);
											return;
										}
										harness.equal(
											'the restored graph holds the SAME edge count as the original',
											restoredEdges,
											originEdges,
										);

										// THE LABEL GATE, and the reason applyLabels is refused on this path:
										// nothing stamped :StandardBase during restoration. If every node
										// still carries it, the label rode along INSIDE the block's node
										// lines, exactly as harvest wrote it.
										countOf(
											restoredHandle,
											`MATCH (n:ForgedNode) WHERE NOT n:${BASE_GRAPH_LABEL} RETURN count(n) AS c`,
											(e3, unlabeled) => {
												if (e3) {
													harness.ok('restored label query ran', false, e3);
													finish(1);
													return;
												}
												harness.equal(
													`every restored node still carries :${BASE_GRAPH_LABEL} — the label ` +
														`rode along INSIDE the block, which is why applyLabels is refused here`,
													unlabeled,
													0,
												);

												countOf(
													restoredHandle,
													'MATCH (n:ForgedNode) WHERE n.stableId IS NULL RETURN count(n) AS c',
													(e4, nullIds) => {
														if (e4) {
															harness.ok('restored stableId query ran', false, e4);
															finish(1);
															return;
														}
														harness.equal(
															'every restored node carries its stableId (the resolution key)',
															nullIds,
															0,
														);

														redProofsAgainstLiveGraph({ restoredHandle, restoredNodes });
													},
												);
											},
										);
									},
								);
							},
						);
					},
				);
			});
		}

		// ==========================================================================
		// RED PROOFS — the restoration refusals bite against a LIVE graph
		// ==========================================================================
		// The fast suite proves these refusals in memory. A guard that only works in memory is not
		// the guard we need: here they are offered a real, populated, connectable graph, and the
		// graph must be exactly as it was afterwards.
		function redProofsAgainstLiveGraph({ restoredHandle, restoredNodes }) {
			harness.section('RED PROOFS — refusals against a live, populated graph');

			replayManager.init({ inGraph: restoredHandle, schemaBlocks: [] }, (emptyErr) => {
				harness.match(
					'an EMPTY schemaBlocks array is refused against a live graph',
					emptyErr,
					/schemaBlocks is empty/,
				);

				replayManager.init(
					{
						inGraph: restoredHandle,
						schemaBlocks: [{ text: 'not the block that was harvested\n', refId: 'aLieAboutTheAddress' }],
					},
					(lieErr) => {
						harness.match(
							'a block whose claimed refId is a LIE is refused against a live graph',
							lieErr,
							/content address/i,
						);
						harness.match('  and the refusal names the claimed address', lieErr, /aLieAboutTheAddress/);

						countOf(
							restoredHandle,
							'MATCH (n) RETURN count(n) AS c',
							(afterErr, afterCount) => {
								if (afterErr) {
									harness.ok('post-refusal census ran', false, afterErr);
									finish(1);
									return;
								}
								harness.equal(
									'  and NOTHING was written — the restored graph is untouched',
									afterCount,
									restoredNodes,
								);
								finish();
							},
						);
					},
				);
			});
		}
	},
);
