#!/usr/bin/env node
'use strict';

// forgeStructuralFingerprint.js — the Phase-1 GATE OF RECORD harness (embedding-excluded, producer
// level). For each discovered standard, runs its producer's forge() with skipEmbedding (PURE structural
// output, no API calls) and computes a canonical, order-independent STRUCTURAL fingerprint of the
// emitted {nodes, edges} — excluding the known volatile properties (embedding, embeddingModelVersion,
// ingestedAt). Capturing this BEFORE and AFTER the vocabulary-registry swap and comparing per standard
// proves zero behavior change at the exact boundary that changed (the producer), with no embedding
// variance and no docker.
//
// Usage:
//   node forgeStructuralFingerprint.js                 # all registered standards -> JSON map
//   node forgeStructuralFingerprint.js --only=ceds,sif # subset
//   node forgeStructuralFingerprint.js --out=<path>    # write JSON to a file
//
// No async/await, no try/catch for control flow (the one try/catch around a producer's forge is a
// crash-containment boundary so one bad producer doesn't abort the whole capture — not control flow).

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

// migrated to parser-bundle auto-discovery in the same change that swapped the roster's source
// (BINDING spec §3.5 — "the measuring instrument migrates in the same step"). Test mode: this
// harness fingerprints ALL bundles including the two synthetics.
const { roster } = require(path.join(EDF_FORGE_LIB, 'standard-discovery'));
const embedder = require(path.join(CORE_LIB, 'embedding', 'embedding-client'))({});

// volatile properties excluded from the structural fingerprint (non-deterministic or embedding-borne).
const VOLATILE_PROPS = new Set(['embedding', 'embeddingModelVersion', 'ingestedAt']);

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

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

const structuralFingerprint = ({ nodes, edges }) => {
	const nodeLines = (nodes || []).map(nodeLine).sort();
	const edgeLines = (edges || []).map(edgeLine).sort();
	return {
		fingerprint: sha256Hex(
			`forgeStructural/v1|nodes:${sha256Hex(nodeLines.join('\n'))}|edges:${sha256Hex(edgeLines.join('\n'))}|n:${nodeLines.length}|e:${edgeLines.length}`,
		),
		nodeCount: nodeLines.length,
		edgeCount: edgeLines.length,
	};
};

// arg parsing (plain argv; this is a standalone harness, not a qtools CLI)
const argOnly = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '');
const argOut = (process.argv.find((a) => a.startsWith('--out=')) || '').replace('--out=', '');
const onlyKeys = argOnly ? argOnly.split(',').map((s) => s.trim()).filter(Boolean) : null;

const rosterEntries = roster({ includeSynthetic: true });
const entryByKey = {};
rosterEntries.forEach((entry) => {
	entryByKey[entry.registryKey] = entry;
});

// REPORT KEY ORDER: the legacy registry (wave) order the frozen baselines were captured in.
// The discovery roster sorts canonically by bundleDir; re-ordering the REPORT would break
// byte-identity with fp-preA.json on order alone while the forge is unchanged — the same
// comparability rationale as the registryKey naming pin (boundary review C3(ii)). Standards
// unknown to the legacy order (added after the swap) append at the end, sorted.
const LEGACY_REPORT_ORDER = [
	'ceds', 'lif', 'sif', 'case', 'edfi', 'jedx', 'sedm', 'cip', 'soc', 'clr',
	'openbadges', 'eduapi', 'pesc', 'medbiquitous', 'ctdl', 'dctap', 'p6hub', 'p6second',
];
const presentKeys = Object.keys(entryByKey);
const allKeys = [
	...LEGACY_REPORT_ORDER.filter((key) => presentKeys.indexOf(key) !== -1),
	...presentKeys.filter((key) => LEGACY_REPORT_ORDER.indexOf(key) === -1).sort(),
];
const keys = onlyKeys ? allKeys.filter((k) => onlyKeys.indexOf(k) !== -1) : allKeys;

const results = {};
let i = 0;

const nextStandard = () => {
	if (i >= keys.length) {
		const out = JSON.stringify(results, null, 2);
		if (argOut) {
			fs.writeFileSync(argOut, out);
			console.error(`[forgeStructuralFingerprint] wrote ${keys.length} standards -> ${argOut}`);
		}
		console.log(out);
		process.exit(0);
		return;
	}
	const key = keys[i];
	i++;
	// resolve the bundle by its roster entry's PATH (not by standardName — p6hub/p6second share
	// standardNames with other bundles, which would mis-resolve). Each key maps to exactly one
	// producer bundle.
	const rosterEntry = entryByKey[key];
	const bundleFactory = require(rosterEntry.bundleFactoryPath);
	const bundle = bundleFactory({ embedder });
	const standardName = rosterEntry.standardName;
	bundle.forge({ sourcePath: rosterEntry.defaultSource, skipEmbedding: true }, (err, forged) => {
		if (err) {
			results[key] = { error: `forge failed: ${err}` };
			nextStandard();
			return;
		}
		const fp = structuralFingerprint({ nodes: forged.nodes, edges: forged.edges });
		results[key] = { standardName, ...fp };
		console.error(`[forgeStructuralFingerprint] ${key} (${standardName}): ${fp.nodeCount}n/${fp.edgeCount}e -> ${fp.fingerprint.slice(0, 16)}…`);
		nextStandard();
	});
};

nextStandard();
