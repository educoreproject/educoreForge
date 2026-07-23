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
harness.section('HARVEST — refusals fire before any bolt traffic');
// =====================================================================

manager.harvest({ inGraph: { graphName: 'GOLD_260718' } }, (err) => {
	harness.match('harvest refuses a GOLD_* graph', err, /REFUSED/);
});
manager.harvest({ inGraph: { graphName: 'DEV_x' } }, (err, result) => {
	harness.match(
		'harvest refuses a handle with no credential',
		err,
		/carries no boltUrl\/password/,
	);
	harness.ok('  and returns NO schema block', result === undefined);
});
manager.harvest(
	{ inGraph: { graphName: 'DEV_x', boltUrl: 'bolt://localhost:1', password: 'p' } },
	(err) => {
		harness.match(
			'harvest refuses to mint a schema block with a GUESSED header',
			err,
			/header carrying at least blockType and standardKey is required/,
		);
	},
);

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
// =====================================================================
harness.section('INIT — the RESTORATION payload: refusals first, then the pure address check');
// =====================================================================
// init({ schemaBlocks }) routes to replay-engine.replay, which is deserialize -> writeShapedGraph:
// the SAME write path the creation payload uses. Everything gated here happens BEFORE any bolt
// traffic, so a refusal arriving without a connection is itself the proof nothing was written.
// The happy path is proven live by the deliberate integration script (integration-restore.js).

const contentAddress = require('../../../../../lib/content-address/content-address')();

// a syntactically plausible block text; these gates never reach a deserializer, so its content
// only has to be a string whose content address is computable.
const BLOCK_TEXT = '#HEADER {"blockType":"standardBase"}\n#NODE {"stableId":"urn:a"}\n';
const TRUE_ADDRESS = contentAddress.blockIdForText(BLOCK_TEXT);

// -----
// The name guard still fires FIRST — before the payload is even looked at.
manager.init({ inGraph: { graphName: 'GOLD_260718' }, schemaBlocks: [BLOCK_TEXT] }, (err) => {
	harness.match('a GOLD_* graph is refused BEFORE the restoration payload is examined', err, /REFUSED/);
});

// -----
// An EMPTY array is REFUSED. Loading nothing and reporting success is the silent-failure shape
// this project keeps designing out.
manager.init({ inGraph: DEV_HANDLE, schemaBlocks: [] }, (err) => {
	harness.match('an EMPTY schemaBlocks array is refused', err, /schemaBlocks is empty/);
});
manager.init({ inGraph: DEV_HANDLE, schemaBlocks: BLOCK_TEXT }, (err) => {
	harness.match(
		'a bare string as schemaBlocks is refused (a missing array must never read as one)',
		err,
		/schemaBlocks must be an array/,
	);
});

// -----
// BOTH payloads at once: a caller supplying both has not decided what it is doing.
manager.init(
	{ inGraph: DEV_HANDLE, nodeEdges: nodeEdgesOf(), schemaBlocks: [BLOCK_TEXT] },
	(err) => {
		harness.match(
			'nodeEdges AND schemaBlocks together are refused',
			err,
			/both nodeEdges and schemaBlocks/,
		);
	},
);

// -----
// applyLabels on the RESTORATION path is refused, WITH THE REASON: a harvested block already
// carries the labels stamped at creation time, so stamping more would make the block and the
// graph restored from it disagree about what is in the graph.
manager.init(
	{ inGraph: DEV_HANDLE, schemaBlocks: [BLOCK_TEXT], applyLabels: ['StandardBase'] },
	(err) => {
		harness.match('applyLabels on the restoration path is refused', err, /applyLabels/);
		harness.match(
			'  and the refusal gives the REASON (the block already carries its labels)',
			err,
			/already carr/i,
		);
		harness.match('  and it names the offending labels', err, /StandardBase/);
	},
);

// -----
// A LYING refId. Never trust a caller's id — harvest mints it, manifestEditor.add recomputes it,
// and this is the third door.
manager.init(
	{ inGraph: DEV_HANDLE, schemaBlocks: [{ text: BLOCK_TEXT, refId: 'deadbeefNotTheAddress' }] },
	(err) => {
		harness.match('a block whose claimed refId is a LIE is refused', err, /content address/i);
		harness.match('  and the refusal names the CLAIMED address', err, /deadbeefNotTheAddress/);
		harness.match('  and the refusal names the TRUE address', err, new RegExp(TRUE_ADDRESS));
	},
);

// -----
// schemaBlockTexts — the pure normalizer, exported so both sides of the address check can be
// gated without a database (the same reason withAppliedLabels is exported).
const { schemaBlockTexts } = replayManagerModule;

harness.equal(
	'a bare TEXT string is admitted as-is',
	schemaBlockTexts([BLOCK_TEXT]).texts[0],
	BLOCK_TEXT,
);
harness.equal(
	'  and admitting it produces no error (positive control)',
	schemaBlockTexts([BLOCK_TEXT]).error,
	'',
);
const honestObject = schemaBlockTexts([{ text: BLOCK_TEXT, refId: TRUE_ADDRESS }]);
harness.equal('an object whose refId is TRUE is admitted', honestObject.error, '');
harness.equal('  and yields the block text', honestObject.texts[0], BLOCK_TEXT);
harness.equal(
	'an object with NO refId is admitted (there is nothing to verify against)',
	schemaBlockTexts([{ text: BLOCK_TEXT }]).error,
	'',
);
harness.match(
	'a block with no text at all is refused, by index',
	schemaBlockTexts([{ refId: TRUE_ADDRESS }]).error,
	/schemaBlocks\[0\]/,
);
harness.match(
	'an empty text is refused (an empty block is not a block)',
	schemaBlockTexts(['']).error,
	/schemaBlocks\[0\]/,
);
harness.match(
	'a non-string, non-object entry is refused by index',
	schemaBlockTexts([BLOCK_TEXT, 42]).error,
	/schemaBlocks\[1\]/,
);
harness.equal(
	'a refused payload yields NO texts — nothing partially normalized escapes',
	schemaBlockTexts([BLOCK_TEXT, 42]).texts.length,
	0,
);

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
