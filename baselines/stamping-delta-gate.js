#!/usr/bin/env node
'use strict';

// stamping-delta-gate.js — the G-A7 keystone assertion (pairwiseVersionSwitching Phase A).
//
// Compares the pre-stamp canonical line dump (fpLineDump-postSwap) against the post-stamp dump
// (fpLineDump-postA), line by line, and asserts the difference is EXACTLY the pre-declared
// property list (PHASE-A-DEVLOG §4 table) and NOTHING else:
//   - edge lines byte-identical, all 18 standards;
//   - node counts identical;
//   - exactly ONE node line differs per standard — the DmeStandardRoot — and its prop delta is
//     exactly the declared additions with the declared values (no removals, no value changes).
//
// Usage: node stamping-delta-gate.js --pre=<dumpDir> --post=<dumpDir>
// Exit 0 + verdict GREEN, or exit 1 with every violation named.

const fs = require('fs');
const path = require('path');

const argOf = (name) =>
	(process.argv.find((a) => a.startsWith(`--${name}=`)) || '').replace(`--${name}=`, '');
const preDir = argOf('pre');
const postDir = argOf('post');
if (!preDir || !postDir) {
	console.error('stamping-delta-gate: --pre= and --post= dump directories are required');
	process.exit(1);
}

// THE PRE-DECLARED DELTA (PHASE-A-DEVLOG §4, written before the gated run — the AZURE_PATH
// discipline). 'spec' parsers keep their existing versionSource; the others gain one.
const SPEC_PARSERS = ['ceds', 'lif', 'case', 'clr', 'openbadges', 'eduapi', 'dctap'];
const DECLARED_PUBLISHED_VERSION = {
	ceds: '14.0.0.0',
	lif: '2.0',
	sif: 'unknown',
	case: '1.1',
	edfi: 'unknown',
	jedx: 'unknown',
	sedm: 'unknown',
	cip: '2020',
	soc: 'O*NET-SOC 2019',
	clr: '2.0',
	openbadges: '3.0',
	eduapi: '1.0',
	pesc: 'unknown',
	medbiquitous: 'unknown',
	ctdl: 'Release 20260327',
	dctap: 'Draft - Request for Comments',
	p6hub: 'synthetic-01',
	p6second: 'synthetic-01',
};
const DECLARED_VERSION_SOURCE = {
	sif: 'unknown',
	edfi: 'unknown',
	jedx: 'unknown',
	sedm: 'unknown',
	pesc: 'unknown',
	medbiquitous: 'unknown',
	cip: 'provenance-file',
	soc: 'provenance-file',
	ctdl: 'provenance-file',
	p6hub: 'provenance-file',
	p6second: 'provenance-file',
};

const readLines = (dir, key, kind) =>
	fs.readFileSync(path.join(dir, `${key}.${kind}.jsonl`), 'utf8').split('\n').filter(Boolean);

const problems = [];
const keys = Object.keys(DECLARED_PUBLISHED_VERSION);
keys.forEach((key) => {
	const preNodes = readLines(preDir, key, 'nodes');
	const postNodes = readLines(postDir, key, 'nodes');
	const preEdges = readLines(preDir, key, 'edges');
	const postEdges = readLines(postDir, key, 'edges');

	if (preEdges.join('\n') !== postEdges.join('\n')) {
		problems.push(`${key}: edge lines changed (${preEdges.length} -> ${postEdges.length}) — NOT declared`);
	}
	if (preNodes.length !== postNodes.length) {
		problems.push(`${key}: node count changed ${preNodes.length} -> ${postNodes.length} — NOT declared`);
		return;
	}
	const preSet = new Set(preNodes);
	const postSet = new Set(postNodes);
	const onlyPre = preNodes.filter((line) => !postSet.has(line));
	const onlyPost = postNodes.filter((line) => !preSet.has(line));
	if (onlyPre.length !== 1 || onlyPost.length !== 1) {
		problems.push(
			`${key}: expected exactly one changed node line, found ${onlyPre.length} removed / ${onlyPost.length} added`,
		);
		return;
	}
	const preRoot = JSON.parse(onlyPre[0]);
	const postRoot = JSON.parse(onlyPost[0]);
	if (preRoot.role !== 'DmeStandardRoot' || postRoot.role !== 'DmeStandardRoot') {
		problems.push(`${key}: the changed node line is not the DmeStandardRoot (pre role ${preRoot.role}, post role ${postRoot.role})`);
		return;
	}
	const preKeys = Object.keys(preRoot.props);
	const postKeys = Object.keys(postRoot.props);
	const added = postKeys.filter((k) => !preKeys.includes(k)).sort();
	const removed = preKeys.filter((k) => !postKeys.includes(k));
	const valueChanged = preKeys.filter(
		(k) => postKeys.includes(k) && JSON.stringify(preRoot.props[k]) !== JSON.stringify(postRoot.props[k]),
	);
	const expectedAdded = ['publishedVersion', 'snapshotKey', ...(SPEC_PARSERS.includes(key) ? [] : ['versionSource'])].sort();
	if (JSON.stringify(added) !== JSON.stringify(expectedAdded)) {
		problems.push(`${key}: added props [${added}] != declared [${expectedAdded}]`);
	}
	if (removed.length) {
		problems.push(`${key}: props REMOVED [${removed}] — nothing may be removed`);
	}
	if (valueChanged.length) {
		problems.push(`${key}: existing prop VALUES changed [${valueChanged}] — nothing may change`);
	}
	if (postRoot.props.snapshotKey !== '01') {
		problems.push(`${key}: snapshotKey ${JSON.stringify(postRoot.props.snapshotKey)} != declared '01'`);
	}
	if (postRoot.props.publishedVersion !== DECLARED_PUBLISHED_VERSION[key]) {
		problems.push(
			`${key}: publishedVersion ${JSON.stringify(postRoot.props.publishedVersion)} != declared ${JSON.stringify(DECLARED_PUBLISHED_VERSION[key])}`,
		);
	}
	if (!SPEC_PARSERS.includes(key) && postRoot.props.versionSource !== DECLARED_VERSION_SOURCE[key]) {
		problems.push(
			`${key}: versionSource ${JSON.stringify(postRoot.props.versionSource)} != declared ${JSON.stringify(DECLARED_VERSION_SOURCE[key])}`,
		);
	}
	if (SPEC_PARSERS.includes(key) && postRoot.props.versionSource !== 'spec') {
		problems.push(`${key}: versionSource ${JSON.stringify(postRoot.props.versionSource)} != existing 'spec'`);
	}
});

if (problems.length) {
	problems.forEach((problem) => console.error(`STAMPING DELTA RED: ${problem}`));
	console.error(`verdict: RED (${problems.length} problem${problems.length === 1 ? '' : 's'})`);
	process.exit(1);
}
console.log(
	`verdict: GREEN — all ${keys.length} standards changed by EXACTLY the pre-declared root-prop delta; edges byte-identical; non-root nodes byte-identical; counts unchanged`,
);
