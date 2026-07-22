#!/usr/bin/env node
'use strict';

// test-forger.js — FAST gates for the forger module: that its destination guard MOVED intact to
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
     Proves the DEV_*-only line moved intact to replayManager (GOLD_*,
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
const { resolveBundle } = forgerModule;
const { buildStandardBlock } = require('../lib/standard-block');

// =====================================================================
harness.section('THE GUARD MOVED — the forger has no destination left to refuse');
// =====================================================================
// The forger used to carry its own DEV_*-only destination refusal. Work order Phase 5 took its
// destination away entirely: it produces nodeEdges and writes nothing, so there is nothing here
// to guard. A removed guard must be PROVEN to have moved rather than assumed to have — the
// migration is checked at the site of the removal, not asserted in a comment.

harness.ok(
	'the forger no longer exports a destination guard (it has no destination)',
	forgerModule.destinationRefusal === undefined,
	typeof forgerModule.destinationRefusal,
);

const replayManagerModule = require('../../replay-manager/replayManager');
harness.match(
	'the DEV_*-only line is now held by replayManager: GOLD_* refused',
	replayManagerModule.nameRefusal('GOLD_260718', 'init'),
	/REFUSED.*production\/live/,
);
harness.match(
	'  gf_* refused',
	replayManagerModule.nameRefusal('gf_devGolden', 'init'),
	/REFUSED/,
);
harness.match(
	'  and a non-DEV name refused',
	replayManagerModule.nameRefusal('myScratch', 'init'),
	/not a DEV_\* scratch graph/,
);
harness.equal(
	'  while a proper DEV_* name is ADMITTED (a guard that refuses everything is not a guard)',
	replayManagerModule.nameRefusal('DEV_gb_test_1', 'init'),
	'',
);

// A destination handed to forge() is now IGNORED, not honored: there is no code path from the
// forger to a graph at all. Passing one cannot cause a write, which is the property that matters.
const forge = forgerModule().forge;
harness.ok(
	'forge() takes no destination — the forger module never requires the replay engine',
	require('fs')
		.readFileSync(require('path').join(__dirname, '..', 'forger.js'), 'utf8')
		.indexOf('replay-engine') === -1,
);

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
