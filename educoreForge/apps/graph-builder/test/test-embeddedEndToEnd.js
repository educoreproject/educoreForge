#!/usr/bin/env node
'use strict';

// test-embeddedEndToEnd.js — the credit-spending gate the fast contract suite structurally cannot be.
//
// test-build.js drives build.js over contract-ENFORCING doubles: "NO DOCKER, NO VOYAGE, NO DATABASE."
// That is correct for proving the pipeline SHAPE, but it means the REAL embedded path — forge, embed,
// harvest a standardBase block that CARRIES vectors, then restore that block on materialize — was
// exercised by no green run. The defect that hid there (build.js Phase A harvested a standardBase
// header WITHOUT embeddingDims/embeddingModelVersion/stableUriPropertyName, so the restore gate refused
// the embedded block: "line carries an embedding but header.embeddingDims 'undefined'") was invisible
// precisely because the suite was forbidden to spend credit. TQ's command (GRANITE_MIRROR, 2026-07-26):
// the suite CAN spend Voyage credit and it MUST. This is that gate.
//
// It runs the REAL graphBuilder -build on sif260928Only (39,268 contract-graph nodes, 41 embed batches — the
// forge whose source is COMMITTED; see the recipe note below) with --vectorize=true, cold, and proves the
// embedded spine (forge -> embed -> harvest -> compose -> materialize) completes. It provisions a DEV_* Docker graph and spends real embedding credit BY DESIGN,
// then disposes the materialize graph and its throwaway store so it leaves nothing behind.
//
// Run: node apps/graph-builder/test/test-embeddedEndToEnd.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- REAL embedded end-to-end gate (spends Voyage credit, provisions Docker)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Runs graphBuilder -build on sif260928Only (39,268 contract-graph nodes; the child is spawned with a
     6144 MB heap because graphBuilder's own heap gate refuses that load at the default ~4 GB —
     observed Phase 4 2026-08-15) with --vectorize=true, cold, and proves the embedded
     forge -> embed -> harvest -> compose -> materialize spine completes. This is the gate that
     would have caught the missing-embedding-header defect (2026-07-26): a standardBase block that
     carries vectors but whose header omits embeddingDims is refused on restore. It costs Docker +
     embedding credit BY DESIGN — the fast suite (test-build.js) uses doubles and cannot see it.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const treeRoot = path.join(__dirname, '..', '..', '..');
const graphBuilderPath = path.join(treeRoot, 'apps', 'graph-builder', 'graphBuilder.js');
// WHICH RECIPE, AND WHY (root-and-branch Phase 3/4, 2026-08-15). pesc260805Only (42k vectorized nodes)
// trips graphBuilder's heap gate outright; edfiOnly (~6.3k nodes) passed — but its MetaEd source is
// GITIGNORED (Ed-Fi Alliance-licensed bytes, .gitignore + README_PROVENANCE.md), so that gate passed
// ONLY on a machine holding the licensed snapshot: on a fresh clone it fails at source acquisition. A
// gate that passes on one machine is not a gate. sifOnly's source was committed, so it was the recipe.
// ⟪nextStandards W1, 2026-10-24⟫ zeroBacklog D3-6 retired the old sif forge and its sifOnly recipe, and this gate went on naming
// the deleted file. Its successor, sif260928 (source committed too), is the recipe now. The node count below was RE-DERIVED from a
// real build of this recipe, not carried over: the old 27,069 was the retired forge's.
const recipePath = path.join(treeRoot, 'recipes', 'sif260928Only.recipe.jsonc');
const SIF260928_CONTRACT_GRAPH_NODE_COUNT = 39268;

// hermetic: a throwaway standardsDatabase in a temp dir, never a project database (the -build guard
// that refuses a default path exists because a scratch save once wrote the canonical store).
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbEmbeddedGate-'));
const standardsDatabaseFilePath = path.join(scratchDir, 'embeddedGate.standardsDatabase.sqlite');
// ISOLATED vector cache in the same throwaway dir. The shared vector cache is ON by default, so without
// this override a warm production cache would serve every text for free and this gate would stop spending
// Voyage — the very thing it exists to exercise. Pointing it at a fresh temp cache keeps the run COLD (real
// embedding, real credit, BY DESIGN) and keeps the suite from writing into the production cache.
const isolatedCacheFilePath = path.join(scratchDir, 'isolatedGate.vectorCache.sqlite3');
// SCRATCH build-log root in the same throwaway dir (Phase 4 K3b): without this the build's run directory
// (<recipeName>_<stamp>/ with the round-trip verdicts) lands in the canonical dataStores/buildLogs home on
// EVERY suite run — re-littering it and, once, riding into a commit. The run dir is disposed with scratchDir.
const scratchBuildLogsDirPath = path.join(scratchDir, 'buildLogs');

harness.section('REAL embedded end-to-end — sif260928Only, --vectorize=true, cold');
harness.note('provisions a DEV_* Docker graph and spends Voyage embedding credit BY DESIGN (isolated cache)');

// SPAWNED HEAP (Phase 4 K3b, 2026-08-15): sifOnly forged 27,069 vectorized nodes × 1024 dims, and
// graphBuilder's own heap gate (build.js resolveHeapAdequacy: 16× raw vector bytes + 1GB) estimates
// ~5GB for that load — the default ~4GB heap of a bare `node` child is REFUSED before provisioning
// (observed: attempt 1, "estimated to need ~5GB … limited to 4GB … --max-old-space-size=5510"). The
// gate is right to refuse; the fix is to give the child the heap the load needs, stated here as a
// number with its derivation, not discovered by an OOM. 6144 MB brackets the gate's 5510 suggestion.
const SPAWNED_HEAP_MB = 6144;

const run = spawnSync(
	'node',
	[
		`--max-old-space-size=${SPAWNED_HEAP_MB}`,
		graphBuilderPath,
		'-build',
		`--recipePath=${recipePath}`,
		`--standardsDatabaseFilePath=${standardsDatabaseFilePath}`,
		`--embeddingCacheFilePath=${isolatedCacheFilePath}`,
		'--createStore=true', // W-C-11: this gate STARTS a cold isolated cache on purpose, and a new cache must be asked for
		`--buildLogsDirPath=${scratchBuildLogsDirPath}`,
		'--vectorize=true',
		// ⟪spend ledger R1⟫ the fixture pricing table and a scratch lifetime ledger: a gate run is not a line in the real record of spend
		`--spendPricingFilePath=${path.join(treeRoot, 'lib', 'spend-ledger', 'test', 'fixtures', 'spendPricing-fixture.ini')}`,
		`--lifetimeLedgerFilePath=${path.join(scratchDir, 'spendLedgerLifetime.jsonl')}`,
	],
	{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

const combinedOutput = `${run.stdout || ''}\n${run.stderr || ''}`;
const tail = combinedOutput.split('\n').slice(-15).join('\n');

harness.ok(
	'graphBuilder -build (embedded, cold) exits 0',
	run.status === 0,
	`exit=${run.status}; tail:\n${tail}`,
);

// the recipe's one forge produced the graph it is measured to produce: a gate on a forge that quietly lost (or gained) nodes is
// not the gate it was
harness.match(
	`the sif260928 forge's contract graph holds ${SIF260928_CONTRACT_GRAPH_NODE_COUNT} nodes`,
	combinedOutput,
	new RegExp(`\\[forge-sif260928\\] contract graph: ${SIF260928_CONTRACT_GRAPH_NODE_COUNT} nodes,`),
);

harness.match(
	'the build composed and materialized a manifest (memberCount reported)',
	combinedOutput,
	/"memberCount":\s*\d+/,
);

// The SPECIFIC failure this gate exists for: an embedded base block refused on restore because its
// header declares no embeddingDims. Named negative assertion — a red here must be THIS red.
harness.ok(
	'no embedded-block restore refusal (the missing-embeddingDims header defect)',
	!/header\.embeddingDims '[^']*' is invalid|is not a readable block/.test(combinedOutput),
	combinedOutput
		.split('\n')
		.filter((oneLine) => /embeddingDims|readable block|deserialize failed/.test(oneLine))
		.join('\n') || '(no refusal lines)',
);

// DISPOSE what the build leaves live: the scratch forge/dependency graphs destroy themselves, but the
// terminal materialize graph is the build's deliverable and stays up. A test must leave nothing behind.
const materializeGraph = combinedOutput.match(/DEV_gb_materialize_\d+_\d+/);
if (materializeGraph) {
	// -v: with its anonymous volumes (forgeClean CLEAN: plain rm -f orphaned neo4j data volumes)
	spawnSync('docker', ['rm', '-f', '-v', materializeGraph[0]], { encoding: 'utf8' });
}
try {
	fs.rmSync(scratchDir, { recursive: true, force: true });
} catch (disposeError) {
	// best-effort; a stranded temp dir is noise, not a test failure
}

harness.report();
