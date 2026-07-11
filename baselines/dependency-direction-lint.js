#!/usr/bin/env node
'use strict';

// dependency-direction-lint.js — the Phase-B D5-invariant enforcer (work order G-B4/G-B5; a
// deliverable that outlives the phase). ONE COMMAND: node baselines/dependency-direction-lint.js
// Exit 0 = GREEN, exit 1 = RED. No arguments, no configuration, no state.
//
// WHAT IT ASSERTS (spec §9 D5: nothing may come to depend on edf-gate; the shared machinery
// lands in the neutral lib, never in the gate):
//   CHECK 1 — no product-code module outside cli/lib.d/edf-gate/ imports from edf-gate,
//             with NO exemptions (the table below was EMPTIED in Phase F when ground-truth
//             moved to the neutral core lib — the named court date was kept).
//   CHECK 2 — the six shared modules (def-embedder, llm-client, node-loader,
//             inference-pipeline, gold-harness, ground-truth) exist ONLY at their
//             core-lib homes.
//   CHECK 3 — zero residual imports of the RETIRED bridge-maker/lib module path (the
//             pre-Phase-B home of the five; distinct from the cli/bridge-maker/ parent dir).
//
// SCANNING IS MULTI-LINE-AWARE BY DELIBERATE DESIGN (supervisor ruling, 2026-07-10): the very
// edge that prompted this lint (gold-harness's GROUND_TRUTH) is a MULTI-LINE path.join whose
// 'edf-gate' segment sits alone on its own line — a single-line grep is born blind to it.
// Files are comment-stripped and whitespace-collapsed before require/path.join argument
// regions are examined.
//
// NAMED EXEMPTION TABLE — EMPTIED (Phase F, supervisor ruling NOBLE_TRAIL 2026-07-11):
// the two exempted ground-truth edges (gold-harness, edf-mapping) were retired by relocating
// ground-truth to npm/qtools-graph-forge-core/lib/ground-truth and repointing every consumer
// (including edf-mapping/lib/value-crosswalk.js, a third edge the pre-Phase-F truncating
// region capture could not see). The Phase-B disposition ("Phase F adjudicates… and EMPTYING
// this table") is hereby executed. Any inbound edf-gate import is now RED, no exceptions.
//
// Informational (outside product-code scope, PRINTED on every run so they can never hide):
// the G-B2-authorized baseline instrument and test scaffolding that also touch edf-gate paths.
//
// No async/await, no try/catch for control flow. camelCase only. Standalone (fs/path only).

const path = require('path');
const fs = require('fs');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const CODE = path.join(findProjectRoot(), 'code');
const CORE_LIB_REL = path.join('npm', 'qtools-graph-forge-core', 'lib');

// the shared modules and their one legitimate home each (CHECK 2). fileName defaults to
// <name>.js; ground-truth's entry file is camelCase groundTruth.js (relocated Phase F).
const SHARED_MODULES = [
	{ name: 'def-embedder' },
	{ name: 'llm-client' },
	{ name: 'node-loader' },
	{ name: 'inference-pipeline' },
	{ name: 'gold-harness' },
	{ name: 'ground-truth', fileName: 'groundTruth.js' },
];

// CHECK 1 exemption table — EXACT-MATCH edges, never patterns. Each row: file (repo-relative),
// required target fragment (the edge), why, disposition.
const NAMED_EXEMPTIONS = [];

// informational: instruments/tests outside product-code scope; printed every run, never hidden
const INFORMATIONAL = [
	{ file: 'baselines/resolve-baseline-harness.js', note: 'G-B2-authorized baseline instrument (frozen-comparison harness)' },
	{ file: 'cli/lib.d/edf-migrate-embeddings/test/__TEST_migrationAcceptance.js', note: 'test scaffolding for edf-migrate-embeddings' },
];

// ---- file walk (node_modules/.git excluded) -------------------------------------------------
const walk = (dir, hits = []) => {
	fs.readdirSync(dir).forEach((oneEntry) => {
		if (oneEntry === 'node_modules' || oneEntry === '.git') {
			return;
		}
		const full = path.join(dir, oneEntry);
		const stats = fs.statSync(full);
		if (stats.isDirectory()) {
			walk(full, hits);
		} else if (oneEntry.endsWith('.js')) {
			hits.push(full);
		}
	});
	return hits;
};

// ---- comment-strip + whitespace-collapse (the multi-line-aware normalization) ----------------
const normalize = (source) => {
	const noBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
	const noLineComments = noBlockComments
		.split('\n')
		.map((oneLine) => {
			const commentStart = oneLine.search(/(^|\s)\/\//);
			return commentStart === -1 ? oneLine : oneLine.slice(0, commentStart);
		})
		.join(' ');
	return noLineComments.replace(/\s+/g, ' ');
};

// require/path.join argument regions of the normalized text. Capture is PAREN-BALANCE-AWARE
// (Phase F): the earlier /\(([^)]*)\)/ capture died at the FIRST close-paren, so any region
// containing a nested call — path.join(findProjectRoot(), ..., 'edf-gate', ...) — truncated
// before its meat and CHECK 1 was born blind to it (the witnessed value-crosswalk evasion).
const argRegions = (normalizedText) => {
	const regions = [];
	const finder = /(?:require|path\.join)\s*\(/g;
	let oneMatch;
	while ((oneMatch = finder.exec(normalizedText)) !== null) {
		const start = oneMatch.index + oneMatch[0].length;
		let depth = 1;
		let cursor = start;
		while (cursor < normalizedText.length && depth > 0) {
			const oneChar = normalizedText[cursor];
			if (oneChar === '(') {
				depth++;
			}
			if (oneChar === ')') {
				depth--;
			}
			cursor++;
		}
		regions.push(normalizedText.slice(start, cursor - 1));
	}
	return regions;
};

const allFiles = walk(CODE);
const problems = [];
const infoLines = [];
const exemptionSeen = NAMED_EXEMPTIONS.map(() => false);

// ---- CHECK 1: edf-gate inbound imports ------------------------------------------------------
allFiles.forEach((oneFile) => {
	const rel = path.relative(CODE, oneFile);
	if (rel.startsWith(path.join('cli', 'lib.d', 'edf-gate') + path.sep)) {
		return; // edf-gate importing itself is its own business
	}
	if (rel === path.join('baselines', 'dependency-direction-lint.js')) {
		return; // this file carries gate paths as its own pattern data, not as imports
	}
	const regions = argRegions(normalize(fs.readFileSync(oneFile, 'utf8')));
	regions
		.filter((oneRegion) => oneRegion.includes('edf-gate'))
		.forEach((oneRegion) => {
			const informational = INFORMATIONAL.find((row) => row.file === rel);
			if (informational) {
				infoLines.push(`INFORMATIONAL (non-product scope): ${rel} -> edf-gate [${informational.note}]`);
				return;
			}
			const exemptIndex = NAMED_EXEMPTIONS.findIndex(
				(row) => row.file === rel && oneRegion.includes(row.targetFragment),
			);
			if (exemptIndex !== -1) {
				exemptionSeen[exemptIndex] = true;
				infoLines.push(
					`EXEMPT (named debt): ${rel} -> edf-gate ground-truth — WHY: ${NAMED_EXEMPTIONS[exemptIndex].why} — DISPOSITION: ${NAMED_EXEMPTIONS[exemptIndex].disposition}`,
				);
				return;
			}
			problems.push(
				`GATE-IMPORT VIOLATION (D5): ${rel} imports from edf-gate and is NOT in the exemption table: "${oneRegion.trim().slice(0, 120)}"`,
			);
		});
});

// ---- CHECK 2: the six shared modules exist only at their core-lib homes ----------------------
SHARED_MODULES.forEach((oneModule) => {
	const fileName = oneModule.fileName || `${oneModule.name}.js`;
	const expected = path.join(CORE_LIB_REL, oneModule.name, fileName);
	const found = allFiles
		.map((oneFile) => path.relative(CODE, oneFile))
		.filter((rel) => path.basename(rel) === fileName);
	if (found.length !== 1 || found[0] !== expected) {
		problems.push(
			`SHARED-MODULE PLACEMENT: ${fileName} must exist EXACTLY once at ${expected}; found [${found.join(', ') || 'none'}]`,
		);
	}
});

// ---- CHECK 3: zero residual retired-path imports (bridge-maker/lib, the five's old home) -----
allFiles.forEach((oneFile) => {
	const rel = path.relative(CODE, oneFile);
	if (rel === path.join('baselines', 'dependency-direction-lint.js')) {
		return; // this file names the retired path in its own patterns
	}
	const regions = argRegions(normalize(fs.readFileSync(oneFile, 'utf8')));
	regions
		.filter((oneRegion) => /bridge-maker[\/']\s*,?\s*'?lib'?(?![-\w])/.test(oneRegion) && !oneRegion.includes('edf-inferred') && !oneRegion.includes('edf-mapping') && !oneRegion.includes('edf-equivalence'))
		.forEach((oneRegion) => {
			problems.push(`RETIRED-PATH IMPORT: ${rel} still references bridge-maker/lib: "${oneRegion.trim().slice(0, 120)}"`);
		});
});

// ---- verdict ---------------------------------------------------------------------------------
infoLines.forEach((oneLine) => console.log(oneLine));
NAMED_EXEMPTIONS.forEach((row, index) => {
	if (!exemptionSeen[index]) {
		console.log(`NOTE: exemption row ${index + 1} (${row.file}) was NOT traversed this run — table may be emptiable; see disposition.`);
	}
});
if (problems.length) {
	problems.forEach((oneProblem) => console.error(`RED: ${oneProblem}`));
	console.error(`verdict: RED (${problems.length} problem${problems.length === 1 ? '' : 's'})`);
	process.exit(1);
}
console.log('verdict: GREEN — dependency direction holds (D5), ZERO exemptions; six shared modules sited only in the core lib; retired paths dead');
process.exit(0);
