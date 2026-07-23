#!/usr/bin/env node
'use strict';

// capture-baseline.js — PHASE 0 of workOrder_initHarvest_072226.md. Captures the IN-MEMORY schema
// block a forge bundle produces TODAY, before the transport serialization is deleted. After the
// work order's Phase 5 this artifact can never be produced again, so it is captured first and
// treated as immutable evidence.
//
// It needs NO graph: the in-memory schema block is a pure function of the forge bundle's output
// (standard-block.js is pure). It DOES spend Voyage credit unless --vectorize=false.
//
//   node capture-baseline.js --standard=lif                    real embeddings (small: ~2,982 nodes)
//   node capture-baseline.js --standard=ceds --vectorize=false structure only, no Voyage spend
//
// Writes <treeRoot>/.baseline_072226/<standard>[.novec].schemaBlock.jsonl plus a .meta.json
// carrying sha256, counts, and the capture parameters. Deliberate: its name does not match
// test-*.js, so runAllTests never runs it.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- capture the pre-change in-memory schema block (work order Phase 0)

SYNOPSIS
     ${moduleName} [--standard=<token>] [--vectorize=false] [-verbose] [-help]

DESCRIPTION
     Runs a forge bundle in memory and serializes its output through the pure standard-block
     serializer, writing the resulting schema block text and its sha256 to .baseline_072226/.
     No graph is provisioned. No store is touched.

EXIT STATUS
     0 captured;  1 otherwise.
`;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const commandLineParameters = require('../../../../../test/testLib/testAppStartup')({
	moduleName,
	helpText: helpText(),
});

const { xLog } = process.global;

const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const TREE_LIB = path.join(TREE_ROOT, 'lib');
const BASELINE_DIR = path.join(TREE_ROOT, '.baseline_072226');

const forgerModule = require('../forger');
const { buildStandardBlock } = require('../lib/standard-block');

const vectorize = (commandLineParameters.values.vectorize || [])[0] !== 'false';
const standard = (commandLineParameters.values.standard || ['lif'])[0];

const resolved = forgerModule.resolveBundle({ standard });
if (resolved.error) {
	xLog.error(resolved.error);
	process.exit(1);
}

let embedder = null;
if (vectorize) {
	embedder = require(path.join(TREE_LIB, 'embedding', 'embedding-client'))({
		configFilePath: forgerModule.resolveVoyageConfigPath({}),
	});
}

// the declared vector width is the SAME ini value the embedder sends to the API; there is no
// in-code width standing in for it (polyArch2 §6). Nothing embedded means nothing to declare.
const declaredEmbeddingDims = embedder ? embedder.resolveEmbeddingIdentity().embeddingDims : undefined;

const bundle = require(resolved.entryPath)({ embedder });

xLog.status(
	`[capture-baseline] forging ${resolved.standardName} from ${path.basename(
		resolved.defaultSource,
	)}${vectorize ? ' with real embeddings' : ' (vectorize OFF)'}`,
);

bundle.forge(
	{ sourcePath: resolved.defaultSource, owner: ':golden', skipEmbedding: !vectorize },
	(err, forged) => {
		if (err) {
			xLog.error(`[capture-baseline] forge failed: ${err}`);
			process.exit(1);
		}

		const block = buildStandardBlock({ forged, declaredEmbeddingDims });
		if (block.error) {
			xLog.error(`capture-baseline: ${block.error}`);
			process.exit(1);
		}
		const sha256 = crypto.createHash('sha256').update(Buffer.from(block.blockText, 'utf8')).digest('hex');

		if (!fs.existsSync(BASELINE_DIR)) {
			fs.mkdirSync(BASELINE_DIR, { recursive: true });
		}
		const tag = `${String(standard).toLowerCase()}${vectorize ? '' : '.novec'}`;
		const blockPath = path.join(BASELINE_DIR, `${tag}.schemaBlock.jsonl`);
		const metaPath = path.join(BASELINE_DIR, `${tag}.meta.json`);

		fs.writeFileSync(blockPath, block.blockText);

		// line-1 header, then node lines, then edge lines — count them from the ACTUAL text rather
		// than trusting the builder's own report, so the artifact is self-describing.
		const lines = block.blockText.split('\n').filter((oneLine) => oneLine.trim().length > 0);
		const kindCounts = lines.reduce((acc, oneLine) => {
			const kind = JSON.parse(oneLine).kind;
			acc[kind] = (acc[kind] || 0) + 1;
			return acc;
		}, {});

		const meta = {
			capturedFor: 'workOrder_initHarvest_072226.md Phase 0',
			standard: resolved.standardName,
			standardToken: standard,
			vectorize,
			sourceFile: path.basename(resolved.defaultSource),
			sha256,
			byteLength: Buffer.byteLength(block.blockText, 'utf8'),
			reportedNodeCount: block.nodeCount,
			reportedEdgeCount: block.edgeCount,
			lineKindCounts: kindCounts,
			blockFile: path.basename(blockPath),
		};
		fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, '\t')}\n`);

		xLog.status(
			`[capture-baseline] ${resolved.standardName}: ${block.nodeCount} nodes, ${block.edgeCount} edges, ` +
				`${meta.byteLength} bytes, sha256 ${sha256}`,
		);
		xLog.status(`[capture-baseline] wrote ${blockPath}`);
		xLog.status(`[capture-baseline] wrote ${metaPath}`);
		process.exit(0);
	},
);
