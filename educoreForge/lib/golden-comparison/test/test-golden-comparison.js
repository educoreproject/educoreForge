#!/usr/bin/env node
'use strict';

// test-golden-comparison.js — the acceptance comparison must catch an EDGE regression, not only a
// node regression. Exercised with INJECTED node/edge sets: no docker, no neo4j, no live graph.
//
// Run: node lib/golden-comparison/test/test-golden-comparison.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const path = require('path');

const helpText = () => `
NAME
     ${moduleName} -- gates for the golden acceptance comparison (nodes AND edges)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves diffSets/compareGraph over injected sets: identical sets are identical; a missing node
     is caught; and -- the point of the fix -- deleting an ENTIRE edge class from the candidate is
     caught, where a node-only comparison would report success. All four sets are REQUIRED; an
     absent set is refused rather than read as "no differences".

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const { diffSets, compareGraph } = require(path.join(__dirname, '..', 'golden-comparison'))();

// A tiny standard-shaped fixture: three base-role nodes and three edges, one per edge class.
const goldenNodeIds = new Set(['urn:a', 'urn:b', 'urn:c']);
const goldenEdgeKeys = new Set([
	'urn:b|SUBCLASS_OF|urn:a',
	'urn:c|HAS_VALUE|urn:a',
	'urn:c|REFERENCES|urn:b',
]);

// =====================================================================
harness.section('IDENTICAL — the positive control: same nodes AND same edges');
// =====================================================================

const identical = compareGraph({
	goldenNodeIds,
	harvestedNodeIds: new Set(goldenNodeIds),
	goldenEdgeKeys,
	harvestedEdgeKeys: new Set(goldenEdgeKeys),
});
harness.ok('identical node and edge sets compare identical', identical.identical === true, JSON.stringify(identical));
harness.equal('  nothing missing among nodes', identical.nodes.missing.length, 0);
harness.equal('  nothing missing among edges', identical.edges.missing.length, 0);

// =====================================================================
harness.section('A DROPPED NODE is caught — the comparison already did this');
// =====================================================================

const nodeGone = compareGraph({
	goldenNodeIds,
	harvestedNodeIds: new Set(['urn:a', 'urn:b']), // urn:c dropped
	goldenEdgeKeys,
	harvestedEdgeKeys: new Set(goldenEdgeKeys),
});
harness.ok('a dropped node makes the comparison NOT identical', nodeGone.identical === false);
harness.equal('  and names the missing node', nodeGone.nodes.missing.join(','), 'urn:c');

// =====================================================================
harness.section('AN EDGE-ONLY REGRESSION is caught — the fix (nodes identical, an edge class gone)');
// =====================================================================
// The historical defect: delete the entire SUBCLASS_OF loop from the forge and the node set is
// unchanged, so a node-only comparison reports full success. The candidate here has EVERY node the
// golden has, but its SUBCLASS_OF edges are gone.

const harvestedEdgesMinusClass = new Set(
	[...goldenEdgeKeys].filter((oneKey) => !oneKey.includes('|SUBCLASS_OF|')),
);

// The incumbent behavior, reconstructed: node-only comparison. It reports IDENTICAL despite the
// edge regression -- this is exactly the green-that-lies the fix removes.
const nodeOnly = diffSets(goldenNodeIds, new Set(goldenNodeIds));
harness.ok(
	'node-only comparison reports IDENTICAL despite the dropped edge class — the defect it hid',
	nodeOnly.identical === true,
	JSON.stringify(nodeOnly),
);

// The edge-aware comparison CATCHES it.
const edgeGone = compareGraph({
	goldenNodeIds,
	harvestedNodeIds: new Set(goldenNodeIds), // nodes IDENTICAL
	goldenEdgeKeys,
	harvestedEdgeKeys: harvestedEdgesMinusClass,
});
harness.ok(
	'the edge-aware comparison is NOT identical when an edge class is dropped',
	edgeGone.identical === false,
	JSON.stringify(edgeGone),
);
harness.equal('  the node sets still agree (the regression is edges-only)', edgeGone.nodes.identical, true);
harness.equal('  and the dropped SUBCLASS_OF edge is reported MISSING', edgeGone.edges.missing.join(','), 'urn:b|SUBCLASS_OF|urn:a');

const edgeInvented = compareGraph({
	goldenNodeIds,
	harvestedNodeIds: new Set(goldenNodeIds),
	goldenEdgeKeys,
	harvestedEdgeKeys: new Set([...goldenEdgeKeys, 'urn:a|REFERENCES|urn:c']), // an edge the golden lacks
});
harness.ok('an INVENTED edge is caught as EXTRA', edgeInvented.identical === false, JSON.stringify(edgeInvented));
harness.equal('  and named', edgeInvented.edges.extra.join(','), 'urn:a|REFERENCES|urn:c');

// =====================================================================
harness.section('A MISSING SET is a fault — it must never read as "no differences"');
// =====================================================================

const refused = (fn) => {
	let message = '';
	try {
		fn();
	} catch (error) {
		message = error.message;
	}
	return [message];
};

harness.rejects(
	'an absent harvestedEdgeKeys is REFUSED, not read as "no edge differences"',
	refused(() =>
		compareGraph({ goldenNodeIds, harvestedNodeIds: new Set(goldenNodeIds), goldenEdgeKeys }),
	),
	/harvestedEdgeKeys must be a Set/,
);
harness.rejects(
	'an absent goldenEdgeKeys is refused too',
	refused(() =>
		compareGraph({ goldenNodeIds, harvestedNodeIds: new Set(goldenNodeIds), harvestedEdgeKeys: new Set() }),
	),
	/goldenEdgeKeys must be a Set/,
);

harness.report();
