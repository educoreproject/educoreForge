#!/usr/bin/env node
'use strict';

// test-write-shaped-graph.js — gates for the SHARED write path (work order Phase 1).
//
// Before this phase the three pre-write guards lived inside replay(), reachable only through
// block TEXT. replayManager.init loads SHAPED OBJECTS, so a second write path would have had to
// reimplement them — and a second implementation is a second thing to drift. The guards and the
// write sequence were therefore extracted into ONE shared path with two entry points:
//
//     replay()  =  deserialize -> writeShapedGraph
//     init()    =  applyLabels -> writeShapedGraph
//
// EVERY guard here is proven to FIRE. A guard never observed refusing is not a guard; it is a
// comment. The suite also gates the SHAPE checks — an independent review of the first version of
// this module found that a mis-shaped `groups` argument was ADMITTED, which is the same silent
// failure as a deleted guard wearing a different hat — and the wiring assertion that nothing
// touches the session until the validator has admitted the content.
//
// No docker, no Neo4j: the session is a stub that fails loudly if it is touched.
//
// Run: node lib/replay/test/test-write-shaped-graph.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for the shared shaped-graph write path

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the SHAPE checks fail CLOSED on a malformed groups argument, that all THREE pre-write
     guards refuse through the shaped-object path and name both their offender and its source, and
     that writeShapedGraph consults the validator BEFORE it touches the session. No docker, no
     Neo4j.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const replayEngine = require('../replay-engine');
const { validateShapedGraph, writeShapedGraph } = replayEngine;
const { PROVENANCE_TIERS } = require('../replay-block');

const GOOD_TIER = PROVENANCE_TIERS[0];

// a minimal well-formed node/edge pair, shaped as the engine writes them
const goodNode = (stableId) => ({
	ref: { source: 'LIF', id: stableId },
	labels: ['ForgedNode', 'DmeClass'],
	stableId,
	properties: { name: ['a name'] },
});

const goodEdge = (fromId, toId) => ({
	type: 'HAS_PROPERTY',
	fromRef: { source: 'LIF', id: fromId },
	toRef: { source: 'LIF', id: toId },
	properties: { provenanceTier: [GOOD_TIER] },
});

const SOURCE = "nodeEdges from forge bundle 'LIF'";
const oneGroup = (nodes, edges) => [{ sourceLabel: SOURCE, nodes, edges }];
const errorOf = (groups) => validateShapedGraph(groups).error;

// =====================================================================
harness.section('POSITIVE CONTROL — a well-formed shaped graph is admitted, and flattened ONCE');
// =====================================================================

const cleanResult = validateShapedGraph(
	oneGroup([goodNode('urn:a'), goodNode('urn:b')], [goodEdge('urn:a', 'urn:b')]),
);
harness.equal('clean nodes + edges validate', cleanResult.error, '');
harness.equal('  and the validator returns the nodes it walked', cleanResult.nodes.length, 2);
harness.equal('  and the edges it walked', cleanResult.edges.length, 1);
harness.equal(
	'  the returned node is the SAME object, not a copy (the writer writes what was checked)',
	cleanResult.nodes[0].stableId,
	'urn:a',
);

harness.equal(
	'a group with genuinely empty arrays is admitted (emptiness is the caller\'s business)',
	errorOf(oneGroup([], [])),
	'',
);
harness.equal('an empty GROUP LIST is admitted', errorOf([]), '');

// =====================================================================
harness.section('SHAPE — fails CLOSED, so a caller mistake can never bypass the guards');
// =====================================================================
// Found by independent review: the first version defaulted `groups = []` and read
// `oneGroup.nodes || []`, so a bare node array — exactly what a caller has in hand — was ADMITTED
// with every node violating every guard.

const bareNodeArray = [
	{ labels: ['DmeClass'], stableId: null },
	{ labels: [], stableId: null },
];
harness.match(
	'a bare NODE ARRAY (no group wrapper) is REFUSED, not admitted',
	errorOf(bareNodeArray),
	/shape enforcement/,
);
harness.match('undefined is REFUSED', errorOf(undefined), /shape enforcement.*ARRAY of groups/);
harness.match('null is REFUSED', errorOf(null), /shape enforcement/);
harness.match('a non-array object is REFUSED', errorOf({ nodes: [], edges: [] }), /shape enforcement/);
harness.match(
	'singular key misspellings are REFUSED rather than read as empty',
	errorOf([{ sourceLabel: 'x', node: [goodNode('urn:a')], edge: [] }]),
	/must carry nodes\[\] and edges\[\]/,
);
harness.match(
	'a missing nodes array never reads as an empty one',
	errorOf([{ sourceLabel: 'x', edges: [] }]),
	/A missing array must never read as an empty one/,
);
harness.match(
	'a group with NO sourceLabel is REFUSED (a guard must be able to name its source)',
	errorOf([{ nodes: [], edges: [] }]),
	/has no sourceLabel/,
);
harness.match(
	'a blank sourceLabel is REFUSED too',
	errorOf([{ sourceLabel: '   ', nodes: [], edges: [] }]),
	/has no sourceLabel/,
);
harness.match(
	'the refusal names WHICH group was mis-shaped',
	errorOf([{ sourceLabel: 'fine', nodes: [], edges: [] }, 'not a group']),
	/groups\[1\]/,
);
harness.match(
	'a STRING labels is REFUSED (indexOf would have matched it by substring)',
	errorOf(oneGroup([{ ...goodNode('urn:s'), labels: 'xxForgedNodeyy' }], [])),
	/labels is not an array/,
);

// =====================================================================
harness.section('GUARD 1 — the ForgedNode label requirement, proven REFUSING');
// =====================================================================
// A node without :ForgedNode merges fine and then EVERY edge touching it lands in danglingRefs
// while replay exits 0. That silence is the bug this guard replaced.

const unlabeled = { ...goodNode('urn:noLabel'), labels: ['DmeClass'] };
const labelRefusal = errorOf(oneGroup([goodNode('urn:a'), unlabeled], []));

harness.match('a node missing ForgedNode is REFUSED', labelRefusal, /ForgedNode enforcement/);
harness.match('  the refusal names the offending stableId', labelRefusal, /urn:noLabel/);
harness.match('  and names the source it came from', labelRefusal, /forge bundle 'LIF'/);
harness.match('  and states that nothing was written', labelRefusal, /No writes performed/);

harness.match(
	'a node with NO labels at all is refused too',
	errorOf(oneGroup([{ ...goodNode('urn:bare'), labels: [] }], [])),
	/ForgedNode enforcement/,
);

// =====================================================================
harness.section('GUARD 2 — the non-null stableId requirement, proven REFUSING');
// =====================================================================
// stableId is the MERGE resolution key. A null one previously aborted MID-BATCH, after earlier
// batches had already committed — a silent partial graph.

const nullIdRefusal = errorOf(
	oneGroup([goodNode('urn:a'), { ...goodNode('urn:x'), stableId: null }], []),
);
harness.match('a null stableId is REFUSED', nullIdRefusal, /stableId enforcement/);
harness.match('  and names the source it came from', nullIdRefusal, /forge bundle 'LIF'/);
harness.match('  and states that nothing was written', nullIdRefusal, /No writes performed/);

harness.match(
	'an UNDEFINED stableId is refused as well as a null one',
	errorOf(oneGroup([{ ...goodNode('urn:y'), stableId: undefined }], [])),
	/stableId enforcement/,
);
harness.match(
	'an EMPTY-STRING stableId is refused (it is not an identity; every such node would MERGE onto one another)',
	errorOf(oneGroup([{ ...goodNode('urn:z'), stableId: '' }], [])),
	/stableId enforcement/,
);
harness.match(
	'the label guard is reported FIRST when a node violates both',
	errorOf(oneGroup([{ ...goodNode('urn:both'), labels: [], stableId: null }], [])),
	/ForgedNode enforcement/,
);

// =====================================================================
harness.section('GUARD 3 — provenanceTier on every edge, proven REFUSING and naming its source');
// =====================================================================
// This is the guard the work order originally MISSED. An init() that reimplemented only the two
// node guards would have written malformed edges silently.

const noTier = { ...goodEdge('urn:a', 'urn:b'), properties: {} };
const tierRefusal = errorOf(oneGroup([goodNode('urn:a'), goodNode('urn:b')], [noTier]));

harness.match('an edge with NO provenanceTier is REFUSED', tierRefusal, /provenanceTier enforcement/);
harness.match('  the refusal names the edge type', tierRefusal, /HAS_PROPERTY/);
harness.match('  AND names the source it came from', tierRefusal, /forge bundle 'LIF'/);
harness.match('  and states that no edges were written', tierRefusal, /No edges written/);

harness.match(
	'an edge with an INVALID provenanceTier is refused',
	errorOf(
		oneGroup(
			[goodNode('urn:a'), goodNode('urn:b')],
			[{ ...goodEdge('urn:a', 'urn:b'), properties: { provenanceTier: ['nonsenseTier'] } }],
		),
	),
	/provenanceTier enforcement/,
);

harness.equal(
	'a SCALAR provenanceTier is accepted (the post-pgToStored shape)',
	errorOf(
		oneGroup(
			[goodNode('urn:a'), goodNode('urn:b')],
			[{ ...goodEdge('urn:a', 'urn:b'), properties: { provenanceTier: GOOD_TIER } }],
		),
	),
	'',
);

harness.equal(
	'an ARRAY provenanceTier is accepted (the PG-JSON shape)',
	errorOf(
		oneGroup(
			[goodNode('urn:a'), goodNode('urn:b')],
			[{ ...goodEdge('urn:a', 'urn:b'), properties: { provenanceTier: [GOOD_TIER] } }],
		),
	),
	'',
);

// =====================================================================
harness.section('MULTI-GROUP — replay passes one group per block; the offender is named');
// =====================================================================
// replay() keeps its per-block error text by passing one group per block. The guard must report
// WHICH group offended, or a golden manifest failure names nothing useful.

const twoGroups = [
	{ sourceLabel: 'standard CEDS v14.0.0.0', nodes: [goodNode('urn:ceds1')], edges: [] },
	{ sourceLabel: 'standard LIF v1', nodes: [{ ...goodNode('urn:lif1'), labels: [] }], edges: [] },
];
const groupRefusal = errorOf(twoGroups);

harness.match('the offending group is named', groupRefusal, /standard LIF v1/);
harness.ok(
	'  and the clean group is NOT named',
	groupRefusal.indexOf('standard CEDS') === -1,
	groupRefusal,
);

// =====================================================================
harness.section('WIRING — nothing touches the session until the validator has admitted');
// =====================================================================
// The single most safety-critical line of this phase is that writeShapedGraph consults the
// validator BEFORE it opens its mouth to the database. Without this gate that line could be
// deleted and every assertion above would stay green. The session is a stub that THROWS if
// touched, so "was not touched" is proven rather than assumed.

const throwingSession = {
	run: () => {
		throw new Error('SESSION TOUCHED — the write path spoke to the database before validating');
	},
};

let refusalSeen = null;
writeShapedGraph(
	{ session: throwingSession, groups: bareNodeArray, embeddingDims: null, graphName: 'DEV_x' },
	(err) => {
		refusalSeen = err;
	},
);
harness.match(
	'a mis-shaped groups REFUSES through the writer, error-first',
	refusalSeen,
	/shape enforcement/,
);

let guardRefusalSeen = null;
writeShapedGraph(
	{
		session: throwingSession,
		groups: oneGroup([{ ...goodNode('urn:w'), labels: [] }], []),
		embeddingDims: null,
		graphName: 'DEV_x',
	},
	(err) => {
		guardRefusalSeen = err;
	},
);
harness.match(
	'a guard violation REFUSES through the writer without touching the session',
	guardRefusalSeen,
	/ForgedNode enforcement/,
);

// THE RED PROOF for the wiring assertion above: with ADMISSIBLE content the very same stub session
// IS reached and throws. That is what proves the two assertions above are stopped by the guard and
// not merely by an inert code path.
let sessionWasReached = false;
try {
	writeShapedGraph(
		{
			session: throwingSession,
			groups: oneGroup([goodNode('urn:ok')], []),
			embeddingDims: null,
			graphName: 'DEV_x',
		},
		() => {},
	);
} catch (reachedError) {
	sessionWasReached = /SESSION TOUCHED/.test(reachedError.message);
}
harness.ok(
	'RED PROOF: admissible content DOES reach the session (so the refusals above are the guard, not inertness)',
	sessionWasReached,
);

// =====================================================================
harness.section('KERNEL VERSION PROBE — a garbled version is not an old server');
// =====================================================================
// `const major = parts[0] || 0; const minor = parts[1] || 0;` read an UNPARSEABLE kernel version
// (parseInt -> NaN) as version 0.0, i.e. "older than 5.13", and the vector index was skipped. The
// skip IS recorded — but as the WRONG FACT: "this server is too old" when the truth is "I could
// not read what this server said". Two different facts, one behavior, and the report asserts the
// one that is false. polyArch2 §6: a present-but-invalid input is the worse fault (audit B1,
// replay-engine.js:1145-1146).

const { kernelSupportsVectorIndex } = replayEngine;
const kernelAnswer = (versionString) =>
	(kernelSupportsVectorIndex || (() => ({})))(versionString) || {};

harness.equal('5.26.0 supports the vector index — the positive control', kernelAnswer('5.26.0').supported, true);
harness.equal('5.13.0 is the boundary and supports it', kernelAnswer('5.13.0').supported, true);
harness.equal('6.0.0 supports it', kernelAnswer('6.0.0').supported, true);
harness.equal('4.4.0 genuinely does NOT — an honest old server', kernelAnswer('4.4.0').supported, false);
harness.equal('5.12.0 genuinely does NOT either', kernelAnswer('5.12.0').supported, false);

harness.match(
	"a GARBLED version ('neo4j-5.26') is REFUSED, quoting it, not filed as an old server",
	kernelAnswer('neo4j-5.26').error,
	/neo4j-5\.26/,
);
harness.match(
	"a leading-v version ('v5.26.0') is refused rather than read as 0.0",
	kernelAnswer('v5.26.0').error,
	/v5\.26\.0/,
);
harness.match(
	'an EMPTY version string is refused',
	kernelAnswer('').error,
	/kernel version/i,
);
harness.match(
	'a version the server did not answer at all is refused',
	kernelAnswer(null).error,
	/kernel version/i,
);
harness.match(
	'a MAJOR-only version is refused — a missing minor is not minor 0',
	kernelAnswer('5').error,
	/'5'/,
);

harness.ok(
	'no `parts[0] || 0` version defaulting survives in replay-engine.js',
	!/parts\[0\]\s*\|\|/.test(
		require('fs')
			.readFileSync(require('path').join(__dirname, '..', 'replay-engine.js'), 'utf8')
			.split('\n')
			.filter((oneLine) => !/^\s*(\/\/|\*|\/\*)/.test(oneLine))
			.join('\n'),
	),
);

harness.report();
