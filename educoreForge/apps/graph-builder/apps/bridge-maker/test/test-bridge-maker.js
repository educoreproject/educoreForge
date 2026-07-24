#!/usr/bin/env node
'use strict';

// test-bridge-maker.js — the REAL bridgeMaker's contract, ENFORCED. P0 of the bridge
// (implementationPlan_bridge_072426.md §5).
//
// What P0 has to prove, and this suite does, WITHOUT Docker/Voyage/a database (§3 hard line 2):
//   1. mapper resolves through a REGISTRY (BRIDGE_PLUGIN_BY_MAPPER, the HUB_FORGE_BY_STANDARD
//      shape) to a bridge plugin — and a mapper naming NO registered plugin is REFUSED BY NAME,
//      no silent default (§6 / polyArch2 §6). [failure side, observed red]
//   2. a DRIFTED bridge plugin (wrong argument/result shape) is REFUSED BY NAME before it runs —
//      the shape gate bites. [failure side, observed red]
//   3. the WRITE-INTO-GRAPH substrate is real: a resolved plugin composes the injected
//      relationshipWriter, which drives an injected graphWriter — proven with a graphWriter
//      DOUBLE (no container). [success side]
//   4. the DEFAULT generic plugin writes ZERO edges and returns a valid status — the P0
//      placeholder that nonetheless travels the real resolve+run+return path (never opens a
//      graph connection). [success side]
//   5. argument refusals: a run missing inGraph, mapper or applyLabel is refused, not guessed.
//
// DOCTRINE: a gate never observed failing is not a gate (harness.js). Every refusal below is a
// negative assertion naming the SPECIFIC error it expects, so a rejection for the wrong reason
// fails rather than false-greens.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-bridge-maker.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- enforce the real bridgeMaker contract (mapper resolution, drift refusal,
     the write-into-graph substrate under doubles, the zero-edge default plugin)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives the real bridgeMaker with an injected bridge-plugin registry and an injected
     graphWriter double, so the whole resolve -> compose -> write path runs in-process. Proven
     in the failure direction: an unregistered mapper and a drifted plugin are shown refused.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const bridgeMakerModule = require('../bridgeMaker');

// =====================================================================
// DOUBLES — no container, no Voyage, no database.
// =====================================================================

// a graphWriter double: the injected write seam. It records every edge write so the test can
// prove the plugin -> relationshipWriter -> graphWriter path reached the substrate.
const graphWriterDouble = () => {
	const writes = [];
	let closed = false;
	return {
		writes,
		wasClosed: () => closed,
		factory: ({ inGraph }) => ({
			writeRelationshipEdge: (spec, callback) => {
				writes.push({ inGraphName: inGraph && inGraph.graphName, ...spec });
				callback('', { edgeWritten: true });
			},
			close: (callback) => {
				closed = true;
				callback('');
			},
		}),
	};
};

// a deterministic bridge plugin (the smallest thing that proves the write path): it composes the
// injected relationshipWriter to write exactly two authored edges and returns the P0-shaped
// status. This is a TEST fixture standing in for the real producers that land in P2/P3.
const spyBridgePlugin = (injectedTools) => {
	const { relationshipWriter } = injectedTools;
	return ({ inGraph, hub, applyLabel }, callback) => {
		const authoredMappings = [
			{ fromStableId: 'src:1', toStableId: 'hub:1', relationshipType: 'EXACT_MATCH' },
			{ fromStableId: 'src:2', toStableId: 'hub:2', relationshipType: 'EXACT_MATCH' },
		];
		let index = 0;
		let written = 0;
		const writeNext = () => {
			if (index >= authoredMappings.length) {
				callback('', {
					edgesWritten: written,
					decisionBlock: null,
					counts: { authored: written, inferred: 0 },
				});
				return;
			}
			const authoredMapping = authoredMappings[index];
			index += 1;
			relationshipWriter({ authoredMapping, applyLabel }, (err) => {
				if (err) {
					callback(`spyBridge write failed: ${err}`);
					return;
				}
				written += 1;
				writeNext();
			});
		};
		writeNext();
	};
};

// a DRIFTED plugin: its produced callable is POSITIONAL (inGraph, hub, applyLabel) — arity 3
// where the contract declares ONE named-argument object (arity 2). This is exactly the drift the
// shape gate must catch before the plugin is ever run.
const driftedBridgePlugin = () => (inGraph, hub, applyLabel) => {
	// never reached — the gate refuses it first.
};

// =====================================================================
harness.section('DECLARATION — the registry and the declared default are exported');
// =====================================================================

harness.equal(
	'bridgeMaker exports DEFAULT_GENERIC_MAPPER = genericBridge',
	bridgeMakerModule.DEFAULT_GENERIC_MAPPER,
	'genericBridge',
);

harness.ok(
	'bridgeMaker exports BRIDGE_PLUGIN_BY_MAPPER as a data registry',
	!!bridgeMakerModule.BRIDGE_PLUGIN_BY_MAPPER &&
		typeof bridgeMakerModule.BRIDGE_PLUGIN_BY_MAPPER === 'object',
	`got ${typeof bridgeMakerModule.BRIDGE_PLUGIN_BY_MAPPER}`,
);

harness.ok(
	'the default generic plugin occupies its registry slot',
	typeof (bridgeMakerModule.BRIDGE_PLUGIN_BY_MAPPER || {}).genericBridge === 'function',
	'genericBridge slot is not a plugin factory',
);

// =====================================================================
harness.section('RESOLUTION — an unregistered mapper is REFUSED BY NAME (no silent default)');
// =====================================================================

// against the REAL registry (no test override) — this is the production refusal.
(() => {
	let observed = null;
	bridgeMakerModule().run(
		{ inGraph: { graphName: 'DEV_probe' }, mapper: 'totallyUnregistered', applyLabel: 'BridgedRelation' },
		(err, result) => {
			observed = { err, result };
		},
	);
	harness.rejects(
		'an unregistered mapper is refused, naming the mapper and the known plugins',
		[observed && observed.err],
		/totallyUnregistered.*genericBridge|genericBridge.*totallyUnregistered/,
	);
	harness.equal(
		'  and nothing is produced on refusal',
		observed && observed.result === undefined ? 'undefined' : 'produced',
		'undefined',
	);
})();

// =====================================================================
harness.section('THE SHAPE GATE BITES — a drifted bridge plugin is refused before it runs');
// =====================================================================

(() => {
	const writer = graphWriterDouble();
	const testRegistry = { driftedBridge: driftedBridgePlugin };
	let observed = null;
	bridgeMakerModule({ bridgePluginRegistry: testRegistry, graphWriterFactory: writer.factory }).run(
		{ inGraph: { graphName: 'DEV_probe' }, mapper: 'driftedBridge', applyLabel: 'BridgedRelation' },
		(err, result) => {
			observed = { err, result };
		},
	);
	harness.rejects(
		'a positional (arity-3) plugin callable is refused, naming the mapper',
		[observed && observed.err],
		/driftedBridge.*(shape|arity|argument|drift)/i,
	);
	harness.equal(
		'  and the drifted plugin never wrote an edge',
		writer.writes.length,
		0,
	);
})();

// =====================================================================
harness.section('WRITE-INTO-GRAPH — the substrate is real, proven under a graphWriter double');
// =====================================================================

(() => {
	const writer = graphWriterDouble();
	const testRegistry = { spyBridge: spyBridgePlugin };
	let observed = null;
	bridgeMakerModule({ bridgePluginRegistry: testRegistry, graphWriterFactory: writer.factory }).run(
		{ inGraph: { graphName: 'DEV_probe' }, mapper: 'spyBridge', applyLabel: 'BridgedRelation' },
		(err, result) => {
			observed = { err, result };
		},
	);
	harness.equal('a resolved plugin runs with no error', observed && observed.err, '');
	harness.equal(
		'the plugin -> relationshipWriter -> graphWriter path wrote both edges',
		writer.writes.length,
		2,
	);
	harness.equal(
		'  and every write carried the applyLabel handed to run',
		writer.writes.every((oneWrite) => oneWrite.applyLabel === 'BridgedRelation')
			? 'all BridgedRelation'
			: 'label drift',
		'all BridgedRelation',
	);
	harness.equal(
		'  and the relationship type reached the writer',
		writer.writes.map((oneWrite) => oneWrite.relationshipType).join(','),
		'EXACT_MATCH,EXACT_MATCH',
	);
	harness.equal(
		'the status report counts the edges written',
		observed && observed.result && observed.result.edgesWritten,
		2,
	);
	harness.ok(
		'the status report carries the declared keys (inGraph, mapper, applyLabel, edgesWritten, note)',
		observed &&
			observed.result &&
			observed.result.inGraph !== undefined &&
			observed.result.mapper === 'spyBridge' &&
			observed.result.applyLabel === 'BridgedRelation' &&
			observed.result.edgesWritten === 2 &&
			observed.result.note !== undefined,
		`result was ${JSON.stringify(observed && observed.result)}`,
	);
	harness.ok(
		'the graphWriter for this run was closed (no leaked connection)',
		writer.wasClosed(),
		'graphWriter.close was never called',
	);
})();

// =====================================================================
harness.section('THE DEFAULT GENERIC PLUGIN — zero edges, valid status, no graph connection');
// =====================================================================

(() => {
	const writer = graphWriterDouble();
	let observed = null;
	// default registry (no override), default mapper. graphWriterFactory injected only to PROVE it
	// is never used — the default plugin writes nothing and opens nothing.
	bridgeMakerModule({ graphWriterFactory: writer.factory }).run(
		{ inGraph: { graphName: 'DEV_probe' }, mapper: 'genericBridge', applyLabel: 'BridgedRelation' },
		(err, result) => {
			observed = { err, result };
		},
	);
	harness.equal('the default generic plugin runs with no error', observed && observed.err, '');
	harness.equal(
		'  and writes ZERO edges (the honest P0 placeholder)',
		observed && observed.result && observed.result.edgesWritten,
		0,
	);
	harness.equal(
		'  and never opened a graph connection',
		writer.writes.length,
		0,
	);
	harness.ok(
		'  and still returns a valid status carrying every declared key',
		observed &&
			observed.result &&
			observed.result.inGraph !== undefined &&
			observed.result.mapper === 'genericBridge' &&
			observed.result.applyLabel === 'BridgedRelation' &&
			observed.result.edgesWritten === 0 &&
			observed.result.note !== undefined,
		`result was ${JSON.stringify(observed && observed.result)}`,
	);
})();

// =====================================================================
harness.section('ARGUMENT REFUSALS — a missing required argument is refused, not guessed');
// =====================================================================

(() => {
	let missingGraph = null;
	bridgeMakerModule().run(
		{ mapper: 'genericBridge', applyLabel: 'BridgedRelation' },
		(err) => {
			missingGraph = err;
		},
	);
	harness.rejects('run without inGraph is refused', [missingGraph], /inGraph/);

	let missingMapper = null;
	bridgeMakerModule().run(
		{ inGraph: { graphName: 'DEV_probe' }, applyLabel: 'BridgedRelation' },
		(err) => {
			missingMapper = err;
		},
	);
	harness.rejects('run without mapper is refused', [missingMapper], /mapper/);

	let missingLabel = null;
	bridgeMakerModule().run(
		{ inGraph: { graphName: 'DEV_probe' }, mapper: 'genericBridge' },
		(err) => {
			missingLabel = err;
		},
	);
	harness.rejects('run without applyLabel is refused', [missingLabel], /applyLabel/);
})();

harness.report();
