#!/usr/bin/env node
'use strict';

// test-replay-manager.js — FAST gates for replayManager: the GNC-001 name guard proven to
// REFUSE in every direction, and the honest not-implemented refusal on extract. NOTHING here
// runs docker; real provision/destroy is proven by the deliberate integration script
// (the forger's integration-forge-lif.js exercises create -> forge -> gates -> delete).
//
// Run: node apps/graph-builder/apps/replay-manager/test/test-replay-manager.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- fast gates for replayManager (name guard, honest extract refusal)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the GNC-001 name guard refuses GOLD_*, gf_* and non-DEV names for BOTH create and
     delete before any docker command could run, admits DEV_* names (positive control), and
     that extract fails honestly rather than minting a fake block ref. No docker, no Neo4j.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const replayManagerModule = require('../replayManager');
const { nameRefusal } = replayManagerModule;
const manager = replayManagerModule();

// =====================================================================
harness.section('THE NAME GUARD — refuses production/live tiers by name (failure side FIRST)');
// =====================================================================

harness.match('GOLD_* refused', nameRefusal('GOLD_260718', 'create'), /REFUSED.*production\/live/);
harness.match('gf_* refused', nameRefusal('gf_devGolden', 'create'), /REFUSED/);
harness.match('case variants refused (Gf_, gold_)', nameRefusal('Gf_sneaky', 'create'), /REFUSED/);
harness.match('a non-DEV name is refused', nameRefusal('scratch1', 'create'), /not a DEV_\* scratch graph/);
harness.match('an empty name is refused', nameRefusal('', 'create'), /no graphName/);
harness.equal('a DEV_* name is ADMITTED (positive control)', nameRefusal('DEV_gb_forge_1', 'create'), '');
harness.match(
	'the refusal message names the verb that was refused',
	nameRefusal('GOLD_x', 'delete'),
	/replayManager\.delete/,
);

// the guard fires INSIDE create/delete before any docker command
manager.create({ graphName: 'GOLD_260718' }, (err) => {
	harness.match('create() itself refuses a GOLD_* graphName', err, /REFUSED/);
});
manager.create({ graphName: 'notDevNamed' }, (err) => {
	harness.match('create() itself refuses a non-DEV graphName', err, /not a DEV_\*/);
});
manager.delete({ graphName: 'gf_devGolden' }, (err) => {
	harness.match('delete() itself refuses a gf_* graphName', err, /REFUSED/);
});
manager.delete({}, (err) => {
	harness.match('delete() with no name is refused', err, /no graphName/);
});

// =====================================================================
harness.section('EXTRACT — fails honestly until the replayManager milestone lands');
// =====================================================================

manager.extract({ graphName: 'DEV_x' }, 'standardBase', (err, result) => {
	harness.match('extract refuses with a reason', err, /not implemented yet/);
	harness.match('  naming the milestone that owns it', err, /replayManager milestone/);
	harness.ok('  and returns NO fake block ref', result === undefined);
});

// =====================================================================
harness.section('SETTINGS — config overrides map to provisioning knobs, defaults govern absent config');
// =====================================================================

const { resolveSettings } = replayManagerModule;

const defaults = resolveSettings(() => ({}));
harness.equal('default image', defaults.neo4jImage, 'neo4j:5.26');
harness.equal('default portSearchStart', defaults.portSearchStart, 7801);
harness.equal('default portSearchSpan', defaults.portSearchSpan, 200);
harness.equal('default readyTimeout (ms)', defaults.readyTimeoutMs, 90000);

const overridden = resolveSettings(() => ({
	neo4jImage: 'neo4j:9.99',
	portSearchStart: '7811', // ini values may arrive as strings — must coerce
	readyTimeoutSeconds: 5,
}));
harness.equal('configured image wins', overridden.neo4jImage, 'neo4j:9.99');
harness.equal('configured start coerces string -> number', overridden.portSearchStart, 7811);
harness.equal('configured timeout converts seconds -> ms', overridden.readyTimeoutMs, 5000);
harness.equal('unconfigured knob keeps its default alongside overrides', overridden.portSearchSpan, 200);

// the LIVE-proven behavior, now gated: the real tree config moves the port off the default
harness.equal(
	'the real graphBuilder.ini governs (portSearchStart 7811, proven live 2026-07-21)',
	resolveSettings().portSearchStart,
	7811,
);

// =====================================================================
harness.section('INIT — the loader: refusals first, then the pure label application');
// =====================================================================
// init is the CREATION entry point into the shared write path (targetArchitectureDesign §4).
// Everything gated here happens BEFORE any bolt traffic, so no docker and no Neo4j: a refusal
// that arrives without a connection is itself the proof that nothing was written. The happy path
// is proven live by the deliberate integration script.

const DEV_HANDLE = {
	graphName: 'DEV_gb_test_1',
	containerName: 'DEV_gb_test_1',
	boltUrl: 'bolt://localhost:1',
	password: 'unused',
};
const nodeEdgesOf = (nodes, edges) => ({ nodes: nodes || [], edges: edges || [] });

manager.init({ inGraph: { graphName: 'GOLD_260718' }, nodeEdges: nodeEdgesOf() }, (err) => {
	harness.match('init() refuses a GOLD_* graph', err, /REFUSED/);
});
manager.init({ inGraph: { graphName: 'gf_devGolden' }, nodeEdges: nodeEdgesOf() }, (err) => {
	harness.match('init() refuses a gf_* graph', err, /REFUSED/);
});
manager.init({ inGraph: { graphName: 'scratch' }, nodeEdges: nodeEdgesOf() }, (err) => {
	harness.match('init() refuses a non-DEV_* graph', err, /not a DEV_\*/);
});
manager.init({ nodeEdges: nodeEdgesOf() }, (err) => {
	harness.match('init() with no graph at all is refused', err, /no graphName/);
});

// The payload must BE what it claims. A missing array must never read as an empty one — the same
// fail-closed rule the shared write path learned the hard way.
manager.init({ inGraph: DEV_HANDLE }, (err) => {
	harness.match('init() with no payload is refused', err, /nodeEdges/);
});
manager.init({ inGraph: DEV_HANDLE, nodeEdges: { nodes: [] } }, (err) => {
	harness.match('init() refuses nodeEdges missing its edges array', err, /nodes\[\] and edges\[\]/);
});
manager.init({ inGraph: DEV_HANDLE, nodeEdges: [] }, (err) => {
	harness.match('init() refuses a bare array as nodeEdges', err, /nodes\[\] and edges\[\]/);
});
manager.init(
	{ inGraph: DEV_HANDLE, nodeEdges: nodeEdgesOf(), applyLabels: ':StandardBase:' },
	(err) => {
		harness.match('init() refuses a non-array applyLabels', err, /applyLabels must be an array/);
	},
);
manager.init({ inGraph: DEV_HANDLE, schemaBlocks: ['...'] }, (err) => {
	harness.match(
		'init() refuses the schemaBlocks payload HONESTLY (it is a later milestone)',
		err,
		/not implemented yet/,
	);
});

// -----
// withAppliedLabels — pure, and exported so the labelling can be gated without a database.
const { withAppliedLabels } = replayManagerModule;
const sourceNodes = [
	{ stableId: 'urn:a', labels: ['ForgedNode', 'DmeClass'], properties: {} },
	{ stableId: 'urn:b', labels: ['ForgedNode'], properties: {} },
];

const labelled = withAppliedLabels(sourceNodes, ['StandardBase']);
harness.ok('every node gains the applied label', labelled.every((n) => n.labels.includes('StandardBase')));
harness.ok('  and keeps the labels it arrived with', labelled[0].labels.includes('DmeClass'));
harness.equal('  with no duplication', labelled[0].labels.filter((l) => l === 'StandardBase').length, 1);

// The caller's nodes are reused by the forger and by the Phase-4 fidelity gate. Mutating them
// would make a second use of the same objects behave differently from the first.
harness.ok(
	'the CALLER\'s nodes are NOT mutated',
	sourceNodes[0].labels.indexOf('StandardBase') === -1,
	sourceNodes[0].labels,
);
harness.equal(
	'applying an already-present label is idempotent',
	withAppliedLabels([{ labels: ['ForgedNode', 'StandardBase'] }], ['StandardBase'])[0].labels.length,
	2,
);
harness.equal(
	'applying NO labels leaves the label set alone',
	withAppliedLabels(sourceNodes, [])[0].labels.length,
	2,
);

harness.report();
