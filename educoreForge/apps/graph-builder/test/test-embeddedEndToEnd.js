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
// It runs the REAL graphBuilder -build on the SMALLEST standard (CTDL-ASN: ~119 nodes, one embed batch)
// with --vectorize=true, cold, and proves the embedded spine (forge -> embed -> harvest -> compose ->
// materialize) completes. It provisions a DEV_* Docker graph and spends real embedding credit BY DESIGN,
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
     Runs graphBuilder -build on edfiOnly (the SMALLEST survival forge, ~6.3k nodes — pesc260805's
     42k vectorized nodes trip graphBuilder's own 4 GB heap gate in this spawned process; observed
     Phase 3 2026-08-15) with --vectorize=true, cold, and proves the embedded
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
const recipePath = path.join(treeRoot, 'recipes', 'edfiOnly.recipe.jsonc');

// hermetic: a throwaway standardsDatabase in a temp dir, never a project database (the -build guard
// that refuses a default path exists because a scratch save once wrote the canonical store).
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbEmbeddedGate-'));
const standardsDatabaseFilePath = path.join(scratchDir, 'embeddedGate.standardsDatabase.sqlite');
// ISOLATED vector cache in the same throwaway dir. The shared vector cache is ON by default, so without
// this override a warm production cache would serve every text for free and this gate would stop spending
// Voyage — the very thing it exists to exercise. Pointing it at a fresh temp cache keeps the run COLD (real
// embedding, real credit, BY DESIGN) and keeps the suite from writing into the production cache.
const isolatedCacheFilePath = path.join(scratchDir, 'isolatedGate.vectorCache.sqlite3');

harness.section('REAL embedded end-to-end — edfiOnly, --vectorize=true, cold');
harness.note('provisions a DEV_* Docker graph and spends Voyage embedding credit BY DESIGN (isolated cache)');

const run = spawnSync(
	'node',
	[
		graphBuilderPath,
		'-build',
		`--recipePath=${recipePath}`,
		`--standardsDatabaseFilePath=${standardsDatabaseFilePath}`,
		`--embeddingCacheFilePath=${isolatedCacheFilePath}`,
		'--vectorize=true',
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
	spawnSync('docker', ['rm', '-f', materializeGraph[0]], { encoding: 'utf8' });
}
try {
	fs.rmSync(scratchDir, { recursive: true, force: true });
} catch (disposeError) {
	// best-effort; a stranded temp dir is noise, not a test failure
}

harness.report();
