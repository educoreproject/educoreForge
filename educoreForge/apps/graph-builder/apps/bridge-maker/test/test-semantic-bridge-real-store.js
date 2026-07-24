#!/usr/bin/env node
'use strict';

// test-semantic-bridge-real-store.js — the WIRING gate for P3b-store: the REAL decisionStore module
// (a content-addressed sqlite store, temp file under the OS tmp dir) driving the REAL semanticBridge
// plugin end-to-end through bridgeMaker.run. test-semantic-bridge.js proved the plugin against an
// in-memory decisionStore DOUBLE; this proves the REAL store SATISFIES that exact contract:
//
//   * WAS-REFUSED -> NOW-WORKS: a semantic run with NO decisionStore is refused BY NAME (the gap this
//     phase closed — before actions.js wired a store, build.js injected null and the plugin refused);
//     with the real store injected it runs.
//   * --REBRIDGE WRITES ONE: a --rebridge FREEZES a real frozen block INTO the sqlite store (verified by
//     reading it straight back out of the store) and materializes it into CLOSE_MATCH edges.
//   * PLAIN BUILD MATERIALIZES: a later plain build reads that SAME frozen block from the real store and
//     replays it into BYTE-IDENTICAL edges with ZERO llm / ZERO vectorizer calls (G2).
//   * NO-BLOCK -> 0 EDGES: a plain build for a pair with no frozen block in the store writes NO edges.
//
// HERMETIC: a STUB llmClient + a FAKE vectorizer + in-memory reader/writer doubles + a throwaway sqlite
// under the OS temp dir. No docker, no Voyage, no Opus, no project database (PLAN §3 hard line 2).
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-semantic-bridge-real-store.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- wiring gate: the REAL decisionStore driving the REAL semanticBridge

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the real content-addressed sqlite decisionStore satisfies the exact get/save contract
     semanticBridge calls: a missing store is refused by name, --rebridge freezes a block INTO the store
     and materializes it, a plain build replays that block from the store byte-identically with zero LLM,
     and a pair with no block writes zero edges. Stub llmClient, fake vectorizer, throwaway sqlite under
     the OS temp dir. No docker, no Voyage, no Opus, no project database.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const bridgeMakerModule = require('../bridgeMaker');
const decisionStoreModule = require('../../../../../lib/decision-store/decision-store')();

// ---- hermetic fixtures (same shapes as test-semantic-bridge section D) -----------------------------
const referenceNodes = [
	{ stableId: 'ref/P1', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P1', propertyKey: 'P1', qualifierKeys: [] } },
	{ stableId: 'ref/P2', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P2', propertyKey: 'P2', qualifierKeys: [] } },
	{ stableId: 'ref/P3', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P3', propertyKey: 'P3', qualifierKeys: [] } },
];
const sourceGraphNodes = [
	{ stableId: 's1', properties: { _source: 'CTDL', role: 'DmeProperty', name: 'src one', defText: 'src one' } },
	{ stableId: 's2', properties: { _source: 'CTDL', role: 'DmeProperty', name: 'src two', defText: 'src two' } },
	{ stableId: 's3', properties: { _source: 'CTDL', role: 'DmeProperty', name: 'src three', defText: 'src three' } },
];
const candidateGraphNodes = [
	{ stableId: 'c1', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds one', defText: 'ceds P1', cedsId: 'P1' } },
	{ stableId: 'c2', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds two', defText: 'ceds P2', cedsId: 'P2' } },
	{ stableId: 'c3', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds three', defText: 'ceds P3', cedsId: 'P3' } },
];
const textVectors = { 'src one': [0.9, 0.1, 0], 'src two': [0.1, 0.9, 0], 'src three': [0.3, 0.3, 0.3], 'ceds P1': [1, 0, 0], 'ceds P2': [0, 1, 0], 'ceds P3': [0, 0, 1] };

let stubRerankCalls = 0;
const stubLlm = {
	model: 'stub-reranker-pick1',
	rerank: ({ choiceEnum } = {}, callback) => { stubRerankCalls++; void choiceEnum; callback('', { choice: '1', model: 'stub-reranker-pick1', attempts: 1 }); },
};
let vectorizerCalls = 0;
const fakeVectorizerFactory = () => ({
	batchEmbed: ({ texts }, cb) => { vectorizerCalls++; cb('', { vectors: (texts || []).map((t) => textVectors[t] || null) }); },
});

const graphReaderDouble = ({ inGraph }) => ({
	readNodes: ({ label, propertyEquals }, callback) => {
		void inGraph;
		const eq = propertyEquals || {};
		if (label === 'HubReference') { callback('', { nodes: referenceNodes }); return; }
		if (eq._source === 'CTDL' && eq.role === 'DmeProperty') { callback('', { nodes: sourceGraphNodes }); return; }
		if (eq._source === 'CEDS' && eq.role === 'DmeProperty') { callback('', { nodes: candidateGraphNodes }); return; }
		callback('', { nodes: [] });
	},
	close: (callback) => callback(''),
});
const makeWriterDouble = (writes) => ({ inGraph }) => ({
	writeRelationshipEdge: (spec, callback) => { void inGraph; writes.push({ ...spec }); callback('', { edgeWritten: true }); },
	close: (callback) => callback(''),
});

const runConfig = { sourceStandard: 'CTDL', sourceVersion: 'v1', hubVersion: 'v14' };
const inferenceConfig = { llmClient: stubLlm, topK: 15, cosineFloor: 0.6, concurrency: 4 };
const PAIR_KEY = 'CEDS::CTDL';

const runOne = ({ decisionStore, rebridge, writes }, callback) =>
	bridgeMakerModule({ graphWriterFactory: makeWriterDouble(writes), graphReaderFactory: graphReaderDouble }).run(
		{
			inGraph: { graphName: 'DEV_probe', boltUrl: 'bolt://x', password: 'x' },
			mapper: 'ctdlIntoCedsSemantic', hub: 'ceds', applyLabel: 'BridgedRelation',
			rebridge, decisionStore, inferenceConfig, config: runConfig,
			componentOverrides: { vectorizer: fakeVectorizerFactory },
		},
		callback,
	);

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfBridgeStoreGate-'));
const databaseFilePath = path.join(scratchDir, `decisions_${process.pid}.sqlite3`);
const cleanup = () => fs.rmSync(scratchDir, { recursive: true, force: true });

// =====================================================================
harness.section('WAS-REFUSED — a semantic run with NO decisionStore is refused BY NAME (the gap this phase closed)');
// =====================================================================
runOne({ decisionStore: null, rebridge: false, writes: [] }, (missingErr) => {
	harness.match('RED PROOF: a plain semantic build with no decisionStore is REFUSED', `${missingErr}`, /a decisionStore \(getDecisionBlock\/saveDecisionBlock\) is REQUIRED/);

	decisionStoreModule.open({ databaseFilePath }, (openErr, decisionStore) => {
		if (openErr) {
			harness.ok('the real sqlite decisionStore opened', false, openErr);
			cleanup();
			harness.report();
			return;
		}
		harness.ok('the real sqlite decisionStore opened (temp file, hermetic)', !!decisionStore);

		// =====================================================================
		harness.section('--REBRIDGE WRITES ONE — freeze a real block INTO the sqlite store, then materialize it');
		// =====================================================================
		const rebridgeWrites = [];
		runOne({ decisionStore, rebridge: true, writes: rebridgeWrites }, (rebErr, rebReport) => {
			harness.ok(`--rebridge run did not error (${rebErr || 'ok'})`, !rebErr, rebErr);
			harness.equal('--rebridge wrote 2 CLOSE_MATCH edges (s1->P1, s2->P2; s3 abstained)', rebReport && rebReport.edgesWritten, 2);
			harness.ok('--rebridge returned a NON-NULL decisionBlock hash', rebReport && rebReport.decisionBlock != null);
			harness.equal('--rebridge counts.mode is rebridge', rebReport && rebReport.counts && rebReport.counts.mode, 'rebridge');

			// PROVE the frozen block actually LANDED in the real sqlite store (not just an in-memory echo).
			decisionStore.getDecisionBlock({ pairKey: PAIR_KEY }, (getErr, landed) => {
				harness.ok('a real frozen decision block now sits in the sqlite store for the pair', !getErr && landed && !!landed.frozenText, getErr);
				harness.equal('  addressed under the hash --rebridge reported (content-addressed pin)', landed && landed.decisionBlockHash, rebReport.decisionBlock);

				const rerankAfterRebridge = stubRerankCalls;
				const vectorizeAfterRebridge = vectorizerCalls;

				// =====================================================================
				harness.section('PLAIN BUILD MATERIALIZES — replay the SAME block from the real store, ZERO llm/vectorizer');
				// =====================================================================
				const matWrites = [];
				runOne({ decisionStore, rebridge: false, writes: matWrites }, (matErr, matReport) => {
					harness.ok(`plain-build materialize did not error (${matErr || 'ok'})`, !matErr, matErr);
					harness.equal('materialize wrote the SAME 2 CLOSE_MATCH edges', matReport && matReport.edgesWritten, 2);
					harness.equal('materialize counts.mode is materialize', matReport && matReport.counts && matReport.counts.mode, 'materialize');
					harness.equal('materialize decisionBlock hash EQUALS the rebridge hash (replay pins to the same stored block)', matReport && matReport.decisionBlock, rebReport.decisionBlock);
					harness.equal('materialize made ZERO reranker calls (no LLM on replay from the real store)', stubRerankCalls, rerankAfterRebridge);
					harness.equal('materialize made ZERO vectorizer calls (no Voyage on replay from the real store)', vectorizerCalls, vectorizeAfterRebridge);
					harness.equal('replay edges BYTE-IDENTICAL to the rebridge edges (G2, through the real store)', JSON.stringify(matWrites), JSON.stringify(rebridgeWrites));

					// =====================================================================
					harness.section('NO-BLOCK -> 0 EDGES — a fresh store has no block for the pair, so no edges (never a silent spend)');
					// =====================================================================
					const emptyPath = path.join(scratchDir, `empty_${process.pid}.sqlite3`);
					decisionStoreModule.open({ databaseFilePath: emptyPath }, (emptyOpenErr, emptyStore) => {
						if (emptyOpenErr) {
							harness.ok('a fresh empty sqlite store opened', false, emptyOpenErr);
							cleanup();
							harness.report();
							return;
						}
						const noWrites = [];
						runOne({ decisionStore: emptyStore, rebridge: false, writes: noWrites }, (nbErr, nbReport) => {
							harness.ok(`no-block build did not error (${nbErr || 'ok'})`, !nbErr, nbErr);
							harness.equal('no frozen block in the real store -> 0 inferred edges', nbReport && nbReport.edgesWritten, 0);
							harness.equal('no frozen block -> decisionBlock null (never a silent spend)', nbReport && nbReport.decisionBlock, null);
							harness.ok('no frozen block -> counts.noDecisionBlock flag set', nbReport && nbReport.counts && nbReport.counts.noDecisionBlock === true);
							harness.equal('no writes reached the graph', noWrites.length, 0);

							cleanup();
							harness.report();
						});
					});
				});
			});
		});
	});
});
