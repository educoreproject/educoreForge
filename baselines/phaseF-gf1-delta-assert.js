#!/usr/bin/env node
'use strict';

// phaseF-gf1-delta-assert.js — G-F1's exactness instrument (Phase F work item 1): the diff
// between the V1 (@01) and V2 (@02) demo graphs is confined EXACTLY to the p6second pair's
// content. Method: partition each dump's lines (phaseE-graph-dump.js output, sorted jsonl)
// into the p6second scope (any line mentioning p6second / synthstd / the synthetic version
// stamps) and THE REST; assert THE REST is line-for-line IDENTICAL across V1 and V2 (no other
// standard's nodes or mappings moved); then assert the p6second scope's delta matches the
// pre-declared enumeration (DEVLOG §3.3): S200001 and S200003 leave, S200101 arrives,
// S200002 stays, exactly one mapping-edge endpoint moves, root stamps 01->02.
//
// Run: node baselines/phaseF-gf1-delta-assert.js --dumpDir=<dir with pvsFv1/pvsFv2 dumps>
// Exit 0 = G-F1 GREEN; exit 1 = RED with the offending lines printed.

const fs = require('fs');
const path = require('path');

const dumpDirArg = process.argv.find((oneArg) => oneArg.startsWith('--dumpDir='));
if (!dumpDirArg) {
	console.error('usage: node phaseF-gf1-delta-assert.js --dumpDir=<dir>');
	process.exit(2);
}
const DUMP_DIR = dumpDirArg.replace('--dumpDir=', '');

const P6_SCOPE_MARKS = ['p6second', 'synthstd', 'synthetic-01', 'synthetic-02'];
const inScope = (oneLine) => P6_SCOPE_MARKS.some((oneMark) => oneLine.includes(oneMark));

const readLines = (fileName) =>
	fs
		.readFileSync(path.join(DUMP_DIR, fileName), 'utf8')
		.split('\n')
		.filter((oneLine) => oneLine.length);

const partition = (lines) => ({
	scoped: lines.filter(inScope),
	rest: lines.filter((oneLine) => !inScope(oneLine)),
});

let problems = 0;
const assertOk = (cond, label, detail) => {
	if (cond) {
		console.log(`  PASS: ${label}`);
	} else {
		problems++;
		console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

['nodes', 'edges'].forEach((kind) => {
	const v1 = partition(readLines(`pvsFv1.${kind}.jsonl`));
	const v2 = partition(readLines(`pvsFv2.${kind}.jsonl`));

	// THE KEYSTONE: everything outside the p6second scope is line-for-line identical
	const restIdentical =
		v1.rest.length === v2.rest.length &&
		v1.rest.every((oneLine, index) => oneLine === v2.rest[index]);
	assertOk(
		restIdentical,
		`${kind}: NON-p6second content BYTE-IDENTICAL across the switch (${v1.rest.length} lines)`,
		restIdentical
			? ''
			: `first divergence: ${v1.rest.find((oneLine, index) => oneLine !== v2.rest[index]) || v2.rest[v1.rest.length]}`,
	);

	console.log(
		`  INFO: ${kind} p6second-scope lines V1=${v1.scoped.length} V2=${v2.scoped.length}`,
	);

	// ADDRESS-level membership, never raw substring: the @02 fixture's own description prose
	// documents its rename ("address MOVED from S200001"), so the string legitimately appears
	// in V2 as DOCUMENTATION. What must move is the ADDRESS — stableId on nodes, from/to on
	// edges. (Instrument corrected after first run; the battery-correction precedent.)
	const parsed = (lines) => lines.map((oneLine) => JSON.parse(oneLine));
	if (kind === 'nodes') {
		const hasAddress = (lines, id) =>
			parsed(lines).some((oneNode) => oneNode.stableId === `urn:p6second:${id}`);
		const hasText = (lines, token) => lines.some((oneLine) => oneLine.includes(token));
		assertOk(hasAddress(v1.scoped, 'S200001'), 'V1 carries the S200001 ADDRESS (Learner @01)');
		assertOk(hasAddress(v1.scoped, 'S200003'), 'V1 carries the S200003 ADDRESS (Unit, the orphan)');
		assertOk(!hasAddress(v1.scoped, 'S200101'), 'V1 does NOT carry the S200101 address');
		assertOk(hasAddress(v2.scoped, 'S200101'), 'V2 carries the S200101 ADDRESS (the renamed Learner)');
		assertOk(!hasAddress(v2.scoped, 'S200001'), 'V2 does NOT carry the S200001 address (moved)');
		assertOk(!hasAddress(v2.scoped, 'S200003'), 'V2 does NOT carry the S200003 address (Unit removed)');
		assertOk(
			hasAddress(v1.scoped, 'S200002') && hasAddress(v2.scoped, 'S200002'),
			'the S200002 address (School) present in BOTH',
		);
		assertOk(
			hasText(v1.scoped, 'synthetic-01') && hasText(v2.scoped, 'synthetic-02'),
			'root publishedVersion stamps read synthetic-01 (V1) / synthetic-02 (V2)',
		);
	}

	if (kind === 'edges') {
		const endpoint = (lines, id) =>
			parsed(lines).some(
				(oneEdge) =>
					oneEdge.from === `urn:p6second:${id}` || oneEdge.to === `urn:p6second:${id}`,
			);
		assertOk(
			endpoint(v1.scoped, 'S200001') && !endpoint(v2.scoped, 'S200001'),
			'V1 edges reach the S200001 address; NO V2 edge does (the endpoint moved)',
		);
		assertOk(
			endpoint(v2.scoped, 'S200101') && !endpoint(v1.scoped, 'S200101'),
			'V2 edges reach the S200101 address; no V1 edge does',
		);
		assertOk(
			endpoint(v1.scoped, 'S200002') && endpoint(v2.scoped, 'S200002'),
			'the S200002 mapping edge survives the switch in both',
		);
	}

	// print the full scoped delta for the DEVLOG narration (lines in one, not the other)
	const v2Set = new Set(v2.scoped);
	const v1Set = new Set(v1.scoped);
	const departed = v1.scoped.filter((oneLine) => !v2Set.has(oneLine));
	const arrived = v2.scoped.filter((oneLine) => !v1Set.has(oneLine));
	console.log(`  DELTA (${kind}): ${departed.length} departed / ${arrived.length} arrived`);
	departed.forEach((oneLine) => console.log(`    - ${oneLine.slice(0, 220)}`));
	arrived.forEach((oneLine) => console.log(`    + ${oneLine.slice(0, 220)}`));
});

if (problems) {
	console.log(`G-F1 VERDICT: RED (${problems} assertion failure${problems === 1 ? '' : 's'})`);
	process.exit(1);
}
console.log(
	'G-F1 VERDICT: GREEN — the version switch moved EXACTLY the p6second pair content; no other standard’s nodes or mappings moved',
);
process.exit(0);
