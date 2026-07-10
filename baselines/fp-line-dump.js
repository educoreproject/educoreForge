#!/usr/bin/env node
'use strict';

// fp-line-dump.js — G-A7 evidence harness (pairwiseVersionSwitching Phase A).
//
// Dumps, per discovered standard, the SAME canonical node/edge lines the structural fingerprint
// hashes (serialization replicated verbatim from forgeStructuralFingerprint.js — the two must
// stay in sync; this is a phase harness, not a product). Captured once BEFORE stamping (A4) and
// once AFTER; a line-level diff of the two dumps proves the stamping delta is EXACTLY the
// pre-declared property list and nothing else — a stronger proof than hash inequality alone.
//
// Usage: node fp-line-dump.js --outDir=<dir>
// Writes <dir>/<registryKey>.nodes.jsonl + <dir>/<registryKey>.edges.jsonl (sorted lines).

const path = require('path');
const fs = require('fs');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const EDF_FORGE_LIB = path.join(projectRoot, 'code', 'cli', 'lib.d', 'forger', 'lib');

process.global = {
	xLog: { status: () => {}, error: (...a) => console.error(...a), result: () => {}, verbose: () => {} },
	getConfig: () => ({}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
};

const { roster } = require(path.join(EDF_FORGE_LIB, 'standard-discovery'));
const embedder = require(path.join(CORE_LIB, 'embedding', 'embedding-client'))({});

// --- serialization replicated from forgeStructuralFingerprint.js (keep in sync) ---
const VOLATILE_PROPS = new Set(['embedding', 'embeddingModelVersion', 'ingestedAt']);
const canonicalProps = (properties) => {
	const out = {};
	Object.keys(properties || {})
		.filter((k) => !VOLATILE_PROPS.has(k))
		.sort()
		.forEach((k) => {
			out[k] = properties[k];
		});
	return out;
};
const nodeLine = (node) =>
	JSON.stringify({
		stableId: node.stableId !== undefined ? node.stableId : null,
		labels: (node.labels || []).slice().sort(),
		role: node.role !== undefined ? node.role : null,
		props: canonicalProps(node.properties),
	});
const edgeLine = (edge) =>
	JSON.stringify({
		type: edge.type,
		fromRef: edge.fromRef,
		toRef: edge.toRef,
		props: canonicalProps(edge.properties),
	});
// --- end replicated serialization ---

const argOutDir = (process.argv.find((a) => a.startsWith('--outDir=')) || '').replace('--outDir=', '');
if (!argOutDir) {
	console.error('fp-line-dump: --outDir= is required');
	process.exit(1);
}
fs.mkdirSync(argOutDir, { recursive: true });

const rosterEntries = roster({ includeSynthetic: true });
let i = 0;
const nextStandard = () => {
	if (i >= rosterEntries.length) {
		console.error(`[fp-line-dump] wrote ${rosterEntries.length} standards -> ${argOutDir}`);
		process.exit(0);
		return;
	}
	const entry = rosterEntries[i];
	i++;
	const bundleFactory = require(entry.bundleFactoryPath);
	const bundle = bundleFactory({ embedder });
	bundle.forge({ sourcePath: entry.defaultSource, skipEmbedding: true }, (err, forged) => {
		if (err) {
			console.error(`[fp-line-dump] ${entry.registryKey}: forge failed: ${err}`);
			process.exit(1);
			return;
		}
		const nodeLines = (forged.nodes || []).map(nodeLine).sort();
		const edgeLines = (forged.edges || []).map(edgeLine).sort();
		fs.writeFileSync(path.join(argOutDir, `${entry.registryKey}.nodes.jsonl`), nodeLines.join('\n'));
		fs.writeFileSync(path.join(argOutDir, `${entry.registryKey}.edges.jsonl`), edgeLines.join('\n'));
		console.error(
			`[fp-line-dump] ${entry.registryKey} (${entry.standardName}): ${nodeLines.length}n/${edgeLines.length}e`,
		);
		nextStandard();
	});
};
nextStandard();
