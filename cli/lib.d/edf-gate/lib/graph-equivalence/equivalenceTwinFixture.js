'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// equivalenceTwinFixture.js — gate/twin support for the graph-equivalence gates (31-34).
//
// Builds a small, deterministic FULL-mode element manifest using the REAL fingerprinter line
// builders (fingerprinter.buildNodeLine / buildEdgeLine), so the twins exercise genuine canonical
// lines — the same format a live graph produces — with ZERO graph/docker dependency. This is the
// in-memory fault-injection substrate (the gate 04 / gate 09 pattern: perturb a manifest, assert
// the apparatus localizes the fault). It is NOT production code — it exists only to prove the
// equivalence comparator bites.
//
// Three nodes: two carry a non-null embeddingHash (an embedding-bearing node is required to prove
// the embedding axis), one carries embeddingHash=null (the ~28% of nodes with no searchText). Two
// internal edges. Every call returns a FRESH manifest so a gate can mutate a copy safely.
//
// This file lives in gates' lib/ (NOT gates.d/, where gateSuite would mis-load it as a gate).

const NODE_RECORDS = [
	{
		stableId: 'ceds:twinAlpha',
		labels: ['ForgedNode', 'CedsProperty', 'golden'],
		props: { name: 'Alpha', role: 'DmeProperty' },
		embeddingHash: 'aaaa1111aaaa1111',
	},
	{
		stableId: 'ceds:twinBeta',
		labels: ['ForgedNode', 'CedsClass', 'golden'],
		props: { name: 'Beta', role: 'DmeClass' },
		embeddingHash: 'bbbb2222bbbb2222',
	},
	{
		stableId: 'ceds:twinGamma',
		labels: ['ForgedNode', 'DmeSupport', 'golden'],
		props: { name: 'Gamma', role: 'DmeSupport' },
		embeddingHash: null,
	},
];

const EDGE_RECORDS = [
	{ fromId: 'ceds:twinBeta', toId: 'ceds:twinAlpha', type: 'HAS_PROPERTY', props: {} },
	{ fromId: 'ceds:twinAlpha', toId: 'ceds:twinGamma', type: 'SUPPORTED_BY', props: {} },
];

// buildTwinManifest(fingerprinter) -> { nodes: string[], edges: string[] } in the FULL-mode
// canonical line format (embeddingHash included), produced by the real line builders.
const buildTwinManifest = (fingerprinter) => ({
	nodes: NODE_RECORDS.map((oneRecord) =>
		fingerprinter.buildNodeLine(oneRecord, {
			ignoreOwnerStamp: false,
			ignoreEmbedding: false,
		}),
	),
	edges: EDGE_RECORDS.map((oneRecord) =>
		fingerprinter.buildEdgeLine(oneRecord, { ignoreOwnerStamp: false }),
	),
});

module.exports = { moduleName, buildTwinManifest, NODE_RECORDS, EDGE_RECORDS };
