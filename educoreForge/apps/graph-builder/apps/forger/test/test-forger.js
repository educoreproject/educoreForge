#!/usr/bin/env node
'use strict';

// test-forger.js — FAST gates for the forger module: the destination guard (proven to REFUSE,
// in every direction — a guard never observed refusing is unproven), bundle resolution against
// the real forges/ tree, and the pure standard-block serializer. NOTHING here touches Docker,
// Neo4j, or Voyage; the full produce-and-write path is proven by the deliberate integration
// script (integration-forge-lif.js), which spends real resources and is not auto-discovered.
//
// Run: node apps/graph-builder/apps/forger/test/test-forger.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- fast gates for the forger module (guard, resolution, serializer)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the forger's HARD SAFETY LINE refuses every forbidden destination shape (GOLD_*,
     gf_*, non-DEV names, malformed handles) and admits DEV_* handles; that bundle resolution
     finds the real LIF bundle and rejects unknown standards naming the known roster; and that
     the pure standard-block serializer emits the proven PG-JSONL shape. No Docker, no Neo4j,
     no Voyage — the live path belongs to integration-forge-lif.js.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const forgerModule = require('../forger');
const { destinationRefusal, resolveBundle } = forgerModule;
const { buildStandardBlock } = require('../lib/standard-block');

// =====================================================================
harness.section('THE GUARD — refuses every forbidden destination (the failure side FIRST)');
// =====================================================================

const goodHandle = { graphName: 'DEV_gb_test_1', boltUrl: 'bolt://localhost:7999', password: 'x' };

harness.match(
	'GOLD_* is REFUSED by name',
	destinationRefusal({ ...goodHandle, graphName: 'GOLD_260718' }),
	/REFUSED.*GOLD_/,
);
harness.match(
	'gf_* is REFUSED by name',
	destinationRefusal({ ...goodHandle, graphName: 'gf_devGolden' }),
	/REFUSED.*GOLD_\*\/gf_\*/,
);
harness.match(
	'the refusal is case-insensitive (gold_ sneaking past casing)',
	destinationRefusal({ ...goodHandle, graphName: 'gold_evil' }),
	/REFUSED/,
);
harness.match(
	'a non-DEV name is REFUSED even when harmless-looking',
	destinationRefusal({ ...goodHandle, graphName: 'myScratch' }),
	/not a DEV_\* scratch graph/,
);
harness.match(
	'a missing handle is refused as malformed',
	destinationRefusal(undefined),
	/must be a graph handle/,
);
harness.match(
	'a handle without a password is refused as malformed',
	destinationRefusal({ graphName: 'DEV_x', boltUrl: 'bolt://localhost:1' }),
	/must be a graph handle/,
);

// positive control: the guard must ADMIT a proper DEV_* handle, or every refusal above is
// meaningless (a guard that refuses everything is not a guard).
harness.equal('a proper DEV_* handle is ADMITTED', destinationRefusal(goodHandle), '');

// the guard fires INSIDE forge() before anything else — no bundle load, no connection.
const forge = forgerModule().forge;
forge({ standard: 'lif', destination: { graphName: 'GOLD_260718', boltUrl: 'b', password: 'p' } }, (err) => {
	harness.match('forge() itself refuses a GOLD_* destination', err, /REFUSED.*GOLD_/);
});
forge({ standard: 'lif', destination: null }, (err) => {
	harness.match('forge() itself refuses a missing destination', err, /must be a graph handle/);
});

// =====================================================================
harness.section('BUNDLE RESOLUTION — the real forges/ tree');
// =====================================================================

const lif = resolveBundle({ standard: 'lif' });
harness.equal('lif resolves without error', lif.error || '', '');
harness.equal('  with the descriptor standardName', lif.standardName, 'LIF');
harness.match('  entry path points at forgeLif.js', lif.entryPath, /forges[\/\\]lif[\/\\]forgeLif\.js$/);
harness.ok(
	'  the default source file exists on disk',
	require('fs').existsSync(lif.defaultSource),
	lif.defaultSource,
);
harness.equal('token case is normalized (LIF -> forges/lif)', (resolveBundle({ standard: 'LIF' }).error || ''), '');

const unknown = resolveBundle({ standard: 'noSuchStandard' });
harness.match('an unknown standard errors', unknown.error, /no forge bundle for standard 'noSuchStandard'/);
harness.match('  and names the known roster so the caller can self-correct', unknown.error, /Known forges: .*lif/);

// =====================================================================
harness.section('STANDARD-BLOCK SERIALIZER — the pure transport (incumbent-faithful shape)');
// =====================================================================

const syntheticForged = {
	standardKey: 'lif',
	stableUriPropertyName: 'lifPath',
	metadata: { version: '2.0' },
	nodes: [
		{
			stableId: 'lif:root',
			labels: ['ForgedNode', 'LifRoot', 'DmeStandardRoot'],
			properties: {
				_id: 'lif:root',
				_source: 'LIF',
				name: 'LIF',
				searchText: 'LIF | root',
				tags: ['a', 'b'], // already-array property must NOT be double-wrapped
				embedding: [0.25, -0.5, 1.0],
				embeddingModelVersion: 'voyage-4-large',
			},
		},
		{
			stableId: 'lif:plain',
			labels: ['ForgedNode', 'LifEntity', 'DmeClass'],
			properties: { _id: 'lif:plain', _source: 'LIF', name: 'plain', searchText: 'plain' },
		},
	],
	edges: [
		{
			type: 'HAS_CLASS',
			fromRef: { source: 'LIF', id: 'lif:root' },
			toRef: { source: 'LIF', id: 'lif:plain' },
			properties: { provenanceTier: 'structural' },
		},
	],
};

const block = buildStandardBlock({ forged: syntheticForged });
harness.equal('node count reported', block.nodeCount, 2);
harness.equal('edge count reported', block.edgeCount, 1);

const lines = block.blockText.trim().split('\n').map((oneLine) => JSON.parse(oneLine));
const header = lines[0];
harness.equal('header blockType', header.blockType, 'standard');
harness.equal('header standardKey', header.standardKey, 'lif');
harness.equal('header resolutionKey IS the stableUriPropertyName', header.resolutionKey, 'lifPath');
harness.equal('header embeddingDims', header.embeddingDims, 1024);

const embeddedNode = lines.find((oneLine) => oneLine.stableId === 'lif:root');
harness.ok('embedded node carries base64 embedding scalar', typeof embeddedNode.embedding === 'string', JSON.stringify(embeddedNode.embedding));
harness.ok(
	'  and the embedding is NOT in properties (the scalar exception)',
	embeddedNode.properties.embedding === undefined,
);
harness.ok(
	'scalar properties are array-wrapped (PG-JSON multi-valued)',
	Array.isArray(embeddedNode.properties.name) && embeddedNode.properties.name[0] === 'LIF',
	JSON.stringify(embeddedNode.properties.name),
);
harness.equal(
	'already-array properties are not double-wrapped',
	JSON.stringify(embeddedNode.properties.tags),
	JSON.stringify(['a', 'b']),
);

const plainNode = lines.find((oneLine) => oneLine.stableId === 'lif:plain');
harness.ok('a node without embedding gets NO embedding field', plainNode.embedding === undefined);

const edgeLine = lines.find((oneLine) => oneLine.type === 'HAS_CLASS');
harness.ok('edge carries provenanceTier (array-wrapped)', edgeLine.properties.provenanceTier[0] === 'structural', JSON.stringify(edgeLine.properties));

// =====================================================================
harness.section('VOYAGE CONFIG PATH — the precedence rule: param > config > default');
// =====================================================================

const { resolveVoyageConfigPath, DEFAULT_VOYAGE_CONFIG_PATH } = forgerModule;

harness.equal(
	'the call param wins over everything',
	resolveVoyageConfigPath({
		paramPath: '/tmp/override.ini',
		getConfig: () => ({ voyageConfigFilePath: '/configured/path.ini' }),
	}),
	'/tmp/override.ini',
);
harness.equal(
	'the configured path wins when no param',
	resolveVoyageConfigPath({ getConfig: () => ({ voyageConfigFilePath: '/configured/path.ini' }) }),
	'/configured/path.ini',
);
harness.equal(
	'the in-code default governs when neither is given',
	resolveVoyageConfigPath({ getConfig: () => ({}) }),
	DEFAULT_VOYAGE_CONFIG_PATH,
);
harness.match(
	'and the default points at voyageEmbedding.ini (the secret stays in its own file)',
	DEFAULT_VOYAGE_CONFIG_PATH,
	/voyageEmbedding\.ini$/,
);

harness.report();
