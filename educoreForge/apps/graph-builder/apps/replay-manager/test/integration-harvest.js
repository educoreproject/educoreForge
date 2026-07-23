#!/usr/bin/env node
'use strict';

// integration-harvest.js — the LIVE proof for replayManager.harvest AND the punch-24 fidelity
// DIAGNOSTIC (work order Phases 3 and 4).
//
// It is one script because it is one question. Both sides of the comparison exist only right now:
//   side A — the IN-MEMORY schema block, built by the pure standard-block serializer
//   side B — the HARVESTED schema block, taken back out of a graph that side A was loaded into
// Work order Phase 5 deletes the in-memory serializer from the pipeline. After that, side A can
// only be produced by a test fixture, and this comparison must already have been made.
//
// The acceptance target is NO LONGER byte-identity (targetArchitectureDesign §0, TQ 2026-07-22):
// the recreation mints its own schema block lineage. What matters now is INFORMATION LOSS. So this
// script does not assert "the bytes match" -- it MEASURES what differs and classifies each
// difference as NORMALIZATION (a stable, intentional canonical form) or LOSS (a fact that went in
// and did not come out). Loss is a defect regardless of bytes.
//
// Spends a docker container; Voyage credit only with --vectorize=true.
//
//   node integration-harvest.js                  LIF, no embeddings
//   node integration-harvest.js --vectorize=true LIF with real vectors (proves the embedding leg)
//   node integration-harvest.js --standard=ceds  the big one

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- live harvest proof + the punch-24 information-loss diagnostic

SYNOPSIS
     ${moduleName} [--standard=<token>] [--vectorize=true] [-keepGraph] [-verbose] [-help]

DESCRIPTION
     Forges a real standard in memory, builds the in-memory schema block, loads the same content
     into a scratch graph through replayManager.init, harvests it back with
     replayManager.harvest, and reports every difference between the two -- classified as
     NORMALIZATION or as LOSS. Asserts that nothing was LOST; ordering and canonical-form
     differences are reported, not failed.

EXIT STATUS
     0 no information loss;  1 loss detected or a gate failed.
`;

const path = require('path');

const commandLineParameters = require('../../../../../test/testLib/testAppStartup')({
	moduleName,
	helpText: helpText(),
});

const harness = require('../../../../../test/testLib/harness')(moduleName);
const { xLog } = process.global;

const replayManagerModule = require('../replayManager');
const replayManager = replayManagerModule();
const forgerModule = require('../../forger/forger');
const { shapeForgedGraph } = require('../../forger/lib/shape-forged-graph');
const { buildStandardBlock } = require('../../forger/lib/standard-block');

const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', '..', 'lib');

const BASE_GRAPH_LABEL = 'StandardBase';

const vectorize = (commandLineParameters.values.vectorize || [])[0] === 'true';
const keepGraph = !!commandLineParameters.switches.keepGraph;
const standard = (commandLineParameters.values.standard || ['lif'])[0];

const finish = (handle, failedHard) => {
	if (!handle || keepGraph || failedHard) {
		if (handle) xLog.status(`[${moduleName}] scratch graph '${handle.graphName}' KEPT`);
		harness.report();
		return;
	}
	replayManager.delete(handle, () => harness.report());
};

// ---- the comparison ------------------------------------------------------------------------
// Each side is parsed back into records so differences can be attributed to a FACT rather than to
// a byte offset. Comparing raw text would only ever tell us "they differ", which we already know.

const parseLines = (blockText) =>
	blockText
		.split('\n')
		.filter((oneLine) => oneLine.trim().length > 0)
		.map((oneLine) => JSON.parse(oneLine));

const nodesByStableId = (records) => {
	const out = new Map();
	records.filter((r) => r.kind === 'node').forEach((r) => out.set(r.stableId, r));
	return out;
};

const edgeKey = (r) => `${r.fromRef.id}|${r.type}|${r.toRef.id}`;
const edgesByKey = (records) => {
	const out = new Map();
	records.filter((r) => r.kind === 'edge').forEach((r) => out.set(edgeKey(r), r));
	return out;
};

const propKeysOf = (record) => Object.keys(record.properties || {}).sort();

// ---- run -------------------------------------------------------------------------------------

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

xLog.status(`[${moduleName}] forging ${resolved.standardName} (vectorize=${vectorize})`);

require(resolved.entryPath)({ embedder }).forge(
	{ sourcePath: resolved.defaultSource, owner: ':golden', skipEmbedding: !vectorize },
	(forgeErr, forged) => {
		if (forgeErr) {
			harness.ok('forge bundle ran', false, forgeErr);
			finish(null, 1);
			return;
		}

		// SIDE A — the in-memory schema block, exactly as the pipeline builds it today
		const sideA = buildStandardBlock({ forged });
		const shaped = shapeForgedGraph({ forged });
		if (shaped.error) {
			harness.ok('shapeForgedGraph produced engine shape', false, shaped.error);
			finish(null, 1);
			return;
		}

		// The header is handed to BOTH sides so header bytes are identical by construction and the
		// comparison is about CONTENT. A header difference would be a caller choice, not a finding.
		const header = {
			blockType: 'standardBase',
			standardKey: forged.standardKey,
			version: forged.metadata.version,
			stableUriPropertyName: forged.stableUriPropertyName,
			resolutionKey: forged.stableUriPropertyName,
			embeddingModelVersion: 'voyage-4-large',
			embeddingEncoding: 'base64',
			embeddingDtype: 'float32',
			embeddingByteOrder: 'little-endian',
			embeddingDims: 1024,
		};

		replayManager.create({ purpose: `${standard}HarvestProof` }, (createErr, handle) => {
			if (createErr) {
				harness.ok('scratch graph provisioned', false, createErr);
				finish(null, 1);
				return;
			}

			replayManager.init(
				{
					inGraph: handle,
					nodeEdges: shaped,
					applyLabels: [BASE_GRAPH_LABEL],
					sourceLabel: `nodeEdges from forge bundle '${resolved.standardName}'`,
				},
				(initErr) => {
					if (initErr) {
						harness.ok('init loaded the graph', false, initErr);
						finish(handle, 1);
						return;
					}

					replayManager.harvest(
						{ inGraph: handle, selectionLabels: [BASE_GRAPH_LABEL], header },
						(harvestErr, sideB) => {
							if (harvestErr) {
								harness.ok('harvest produced a schema block', false, harvestErr);
								finish(handle, 1);
								return;
							}

							harness.section('HARVEST — a schema block came out of the graph');
							harness.ok('blockText is non-empty', sideB.blockText.length > 0);
							harness.match(
								'blockId is a sha256 content address',
								sideB.blockId,
								/^[0-9a-f]{64}$/,
							);
							harness.equal(
								'harvested node count equals what was loaded',
								sideB.nodeCount,
								shaped.nodes.length,
							);
							harness.equal(
								'harvested edge count equals what was loaded',
								sideB.edgeCount,
								shaped.edges.length,
							);
							harness.ok(
								'every node carried a stableId (coverage is total)',
								sideB.stableIdCoverage &&
									sideB.stableIdCoverage.present === sideB.stableIdCoverage.total,
								sideB.stableIdCoverage,
							);
							harness.ok(
								'  and every stableId was unique',
								sideB.stableIdCoverage && sideB.stableIdCoverage.unique === true,
								sideB.stableIdCoverage,
							);

							// ==================================================================
							harness.section('PUNCH 24 — information-loss diagnostic (in-memory vs harvested)');
							// ==================================================================

							const aRecords = parseLines(sideA.blockText);
							const bRecords = parseLines(sideB.blockText);
							const aNodes = nodesByStableId(aRecords);
							const bNodes = nodesByStableId(bRecords);
							const aEdges = edgesByKey(aRecords);
							const bEdges = edgesByKey(bRecords);

							const bytesIdentical = sideA.blockText === sideB.blockText;
							xLog.status(
								`  bytes identical: ${bytesIdentical} ` +
									`(A ${sideA.blockText.length} bytes, B ${sideB.blockText.length} bytes)`,
							);

							// --- LOSS CHECK 1: every node that went in came out
							const missingNodes = [...aNodes.keys()].filter((k) => !bNodes.has(k));
							const extraNodes = [...bNodes.keys()].filter((k) => !aNodes.has(k));
							harness.equal('LOSS: no node disappeared', missingNodes.length, 0);
							harness.equal('  and none appeared from nowhere', extraNodes.length, 0);

							// --- LOSS CHECK 2: every edge that went in came out
							const missingEdges = [...aEdges.keys()].filter((k) => !bEdges.has(k));
							harness.equal('LOSS: no edge disappeared', missingEdges.length, 0);
							harness.equal(
								'  and none appeared from nowhere',
								[...bEdges.keys()].filter((k) => !aEdges.has(k)).length,
								0,
							);

							// --- LOSS CHECK 3: property-level. Which keys vanished, which were added?
							// A key present on A and absent on B is LOSS. A key present only on B is
							// NORMALIZATION (the write path stamps _source/_id/stableId deliberately).
							const KNOWN_ADDITIONS = ['_id', '_source', 'stableId', 'embeddingModelVersion'];
							const lostKeys = new Map();
							const addedKeys = new Map();
							aNodes.forEach((aNode, stableId) => {
								const bNode = bNodes.get(stableId);
								if (!bNode) return;
								const aKeys = propKeysOf(aNode);
								const bKeys = propKeysOf(bNode);
								aKeys
									.filter((k) => !bKeys.includes(k))
									.forEach((k) => lostKeys.set(k, (lostKeys.get(k) || 0) + 1));
								bKeys
									.filter((k) => !aKeys.includes(k))
									.forEach((k) => addedKeys.set(k, (addedKeys.get(k) || 0) + 1));
							});

							if (lostKeys.size) {
								xLog.status(`  keys absent from the harvested PROPERTY MAP: ${JSON.stringify([...lostKeys])}`);
							}
							if (addedKeys.size) {
								xLog.status(`  ADDED property keys: ${JSON.stringify([...addedKeys])}`);
							}

							// A key missing from the property map is only LOSS if its VALUE is
							// unrecoverable. `_source` and `_id` are EXTERNALIZED into ref.source /
							// ref.id by the harvest -- the same fact, carried once instead of twice.
							// Calling that "loss" would be as wrong as ignoring it, so the recovery is
							// CHECKED rather than assumed: for every node, the value that left the
							// property map must be found in its externalized home.
							const EXTERNALIZED = { _source: (r) => r.ref.source, _id: (r) => r.ref.id };
							let unrecoverable = 0;
							let firstUnrecoverable = null;
							aNodes.forEach((aNode, stableId) => {
								const bNode = bNodes.get(stableId);
								if (!bNode) return;
								propKeysOf(aNode).forEach((k) => {
									if (k in (bNode.properties || {})) return;
									const recover = EXTERNALIZED[k];
									const aValue = Array.isArray(aNode.properties[k])
										? aNode.properties[k][0]
										: aNode.properties[k];
									if (!recover || recover(bNode) !== aValue) {
										unrecoverable++;
										if (!firstUnrecoverable) {
											firstUnrecoverable = {
												stableId,
												key: k,
												wentIn: aValue,
												cameOut: recover ? recover(bNode) : '(nowhere to look)',
											};
										}
									}
								});
							});
							if (firstUnrecoverable) {
								xLog.status(`  first UNRECOVERABLE fact: ${JSON.stringify(firstUnrecoverable)}`);
							}
							harness.equal(
								'LOSS: every value that left the property map is RECOVERABLE from the record',
								unrecoverable,
								0,
							);
							harness.ok(
								'NORMALIZATION: the only keys that left are the externalized ones',
								[...lostKeys.keys()].every((k) => Object.keys(EXTERNALIZED).includes(k)),
								[...lostKeys.keys()],
							);
							harness.ok(
								'NORMALIZATION: every added key is a KNOWN write-path stamp',
								[...addedKeys.keys()].every((k) => KNOWN_ADDITIONS.includes(k)),
								[...addedKeys.keys()],
							);

							// --- LOSS CHECK 4: property VALUES for the keys both sides carry
							let valueMismatches = 0;
							let firstMismatch = null;
							aNodes.forEach((aNode, stableId) => {
								const bNode = bNodes.get(stableId);
								if (!bNode) return;
								propKeysOf(aNode).forEach((k) => {
									if (!(k in (bNode.properties || {}))) return;
									const av = JSON.stringify(aNode.properties[k]);
									const bv = JSON.stringify(bNode.properties[k]);
									if (av !== bv) {
										valueMismatches++;
										if (!firstMismatch) {
											firstMismatch = { stableId, key: k, a: av, b: bv };
										}
									}
								});
							});
							if (firstMismatch) {
								xLog.status(`  first value mismatch: ${JSON.stringify(firstMismatch)}`);
							}
							harness.equal(
								'LOSS: no shared property value changed through the round trip',
								valueMismatches,
								0,
							);

							// --- LOSS CHECK 5: embeddings survive the round trip exactly
							if (vectorize) {
								let embMismatch = 0;
								let embChecked = 0;
								aNodes.forEach((aNode, stableId) => {
									const bNode = bNodes.get(stableId);
									if (!bNode || !aNode.embedding) return;
									embChecked++;
									if (aNode.embedding !== bNode.embedding) embMismatch++;
								});
								harness.ok(`embeddings were present to check (${embChecked})`, embChecked > 0);
								harness.equal(
									'LOSS: every embedding survived write-then-read byte-for-byte',
									embMismatch,
									0,
								);
							} else {
								harness.note(
									'embedding fidelity NOT checked this run (--vectorize=true to check it)',
								);
							}

							// --- NORMALIZATION: order. Reported, never failed.
							const aOrder = [...aNodes.keys()];
							const bOrder = [...bNodes.keys()];
							const sameOrder = aOrder.every((k, i) => k === bOrder[i]);
							xLog.status(
								`  NORMALIZATION node order: ${sameOrder ? 'identical' : 'DIFFERENT (harvest sorts by stableId)'}`,
							);
							harness.ok(
								'NORMALIZATION: the harvested order is stable and sorted by stableId',
								bOrder.every((k, i) => i === 0 || String(bOrder[i - 1]) <= String(k)),
							);

							// ==================================================================
							harness.section('RED PROOF — the loss detector is proven to DETECT');
							// ==================================================================
							// Every assertion above passed. That is only meaningful if the checks can
							// fail: a detector never observed detecting is a detector we are merely
							// hoping for. So mutilate a COPY of the harvested side and confirm each
							// check reports the damage.
							const mutilated = new Map();
							bNodes.forEach((r, k) => mutilated.set(k, JSON.parse(JSON.stringify(r))));
							const victimId = [...mutilated.keys()][0];
							const victim = mutilated.get(victimId);
							const victimKey = propKeysOf(victim).find(
								(k) => !Object.keys(EXTERNALIZED).includes(k),
							);
							delete victim.properties[victimKey];
							mutilated.delete([...mutilated.keys()][1]);

							let injectedUnrecoverable = 0;
							aNodes.forEach((aNode, stableId) => {
								const bNode = mutilated.get(stableId);
								if (!bNode) return;
								propKeysOf(aNode).forEach((k) => {
									if (k in (bNode.properties || {})) return;
									const recover = EXTERNALIZED[k];
									const aValue = Array.isArray(aNode.properties[k])
										? aNode.properties[k][0]
										: aNode.properties[k];
									if (!recover || recover(bNode) !== aValue) injectedUnrecoverable++;
								});
							});
							harness.ok(
								`a DELETED property ('${victimKey}') is detected as unrecoverable loss`,
								injectedUnrecoverable > 0,
								injectedUnrecoverable,
							);
							harness.ok(
								'a DELETED node is detected as missing',
								[...aNodes.keys()].filter((k) => !mutilated.has(k)).length > 0,
							);

							finish(handle);
						},
					);
				},
			);
		});
	},
);
