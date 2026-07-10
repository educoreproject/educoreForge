#!/usr/bin/env node
'use strict';

// dependency-direction-lint.js — the Phase-B D5-invariant enforcer (work order G-B4/G-B5; a
// deliverable that outlives the phase). ONE COMMAND: node baselines/dependency-direction-lint.js
// Exit 0 = GREEN, exit 1 = RED. No arguments, no configuration, no state.
//
// WHAT IT ASSERTS (spec §9 D5: nothing may come to depend on edf-gate; the shared machinery
// lands in the neutral lib, never in the gate):
//   CHECK 1 — no product-code module outside cli/lib.d/edf-gate/ imports from edf-gate,
//             EXCEPT the two named-exemption edges below (exact-match, never a pattern).
//   CHECK 2 — the five shared modules (def-embedder, llm-client, node-loader,
//             inference-pipeline, gold-harness) exist ONLY at their core-lib homes.
//   CHECK 3 — zero residual imports of the RETIRED bridge-maker/lib module path (the
//             pre-Phase-B home of the five; distinct from the cli/bridge-maker/ parent dir).
//
// SCANNING IS MULTI-LINE-AWARE BY DELIBERATE DESIGN (supervisor ruling, 2026-07-10): the very
// edge that prompted this lint (gold-harness's GROUND_TRUTH) is a MULTI-LINE path.join whose
// 'edf-gate' segment sits alone on its own line — a single-line grep is born blind to it.
// Files are comment-stripped and whitespace-collapsed before require/path.join argument
// regions are examined.
//
// NAMED EXEMPTION TABLE (supervisor rulings, NOBLE_TRAIL 2026-07-10 20:31Z + 20:33Z — binding):
// exactly TWO edges, each exact-match on (file -> edf-gate ground-truth). Growth by even one
// edge = RED; a second edf-gate import inside an exempted file = RED (no shelter).
// DISPOSITION HOME (shared): Phase F's spec-compliance sweep formally adjudicates relocating
// ground-truth to its true home (likely the neutral core lib) and EMPTYING this table.
// Acknowledged debt with a named court date, not a rug.
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

// the five extracted shared modules and their one legitimate home each (CHECK 2)
const SHARED_MODULES = ['def-embedder', 'llm-client', 'node-loader', 'inference-pipeline', 'gold-harness'];

// CHECK 1 exemption table — EXACT-MATCH edges, never patterns. Each row: file (repo-relative),
// required target fragment (the edge), why, disposition.
const NAMED_EXEMPTIONS = [
	{
		file: 'npm/qtools-graph-forge-core/lib/gold-harness/gold-harness.js',
		targetFragment: 'ground-truth',
		why: 'gate-consumed-only test machinery: gold-harness has zero consumers in edf-resolve/edf-inferred; the edge is traversed only when the gate itself runs — D5 runtime invariant intact',
		disposition: 'Phase F adjudicates relocating ground-truth to its true home and emptying this table',
	},
	{
		file: 'cli/bridge-maker/edf-mapping/edfMapping.js',
		targetFragment: 'ground-truth',
		why: 'producer loading its OWN source data (EdFi crosswalk CSVs serve double duty as producer input and gate truth-set) through a loader mishoused inside the gate — not consumption of judgment',
		disposition: 'Phase F adjudicates relocating ground-truth to its true home and emptying this table',
	},
];

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

// require/path.join argument regions of the normalized text
const argRegions = (normalizedText) => {
	const regions = [];
	const finder = /(?:require|path\.join)\s*\(([^)]*)\)/g;
	let oneMatch;
	while ((oneMatch = finder.exec(normalizedText)) !== null) {
		regions.push(oneMatch[1]);
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

// ---- CHECK 2: the five shared modules exist only at their core-lib homes ---------------------
SHARED_MODULES.forEach((oneName) => {
	const expected = path.join(CORE_LIB_REL, oneName, `${oneName}.js`);
	const found = allFiles
		.map((oneFile) => path.relative(CODE, oneFile))
		.filter((rel) => path.basename(rel) === `${oneName}.js`);
	if (found.length !== 1 || found[0] !== expected) {
		problems.push(
			`SHARED-MODULE PLACEMENT: ${oneName}.js must exist EXACTLY once at ${expected}; found [${found.join(', ') || 'none'}]`,
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
console.log('verdict: GREEN — dependency direction holds (D5); five shared modules sited only in the core lib; retired paths dead');
process.exit(0);
