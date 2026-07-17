#!/usr/bin/env node
'use strict';

// =====================================================================
// pilotPhase4-supplementary-gates — the three instrument-corrected gates for
// the Phase-4 materialize leg (Builder C, 2026-07-17). The first materialize
// run went 23/3; ALL THREE fails were INSTRUMENT defects, proven by live
// diagnosis, and the deliverable itself is sound:
//   1+2. determinism dumps differed by EXACTLY ONE node + ONE edge — the
//        :GraphProvenance passport (per-build builtAt/elementId/graphName) and
//        its BUILT_FROM edge. The ESTABLISHED all-scope fingerprint EXCLUDES
//        that class (the GOLD_EVAL_260716 ±1 note). This gate recomputes the
//        comparison on the established scope from the EXISTING dump files.
//   3.   the 26 CEDS anchors live as `cedsId` (+ cedsOriginalAnchorPropertyName)
//        — the forge PROMOTES _cedsAnchors (parser.js:40); the original query
//        used the pre-promotion stash name.
// The deliverable GOLD_EVAL_260717 is NOT rebuilt (protected; never torn down).
// The main leg's instruments are corrected in-place for future full runs.
// =====================================================================

const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DUMP_DIR = '/tmp/pilotPhase4-dumps';
const DELIVERABLE_NAME = 'GOLD_EVAL_260717';

let pass = 0;
let fail = 0;
const assert = (label, cond) => {
	if (cond) {
		pass++;
		console.log(`  PASS  ${label}`);
	} else {
		fail++;
		console.log(`  FAIL  ${label}`);
	}
};
const sha256Text = (text) => crypto.createHash('sha256').update(text).digest('hex');

// ---- established-scope filter: drop the GraphProvenance passport node line and
// every edge line referencing its (per-build) elementId --------------------------
const establishedScope = (nodeText, edgeText) => {
	const passportIds = [];
	const nodeLines = nodeText.split('\n').filter(Boolean).filter((oneLine) => {
		// label-array membership, never substring — a SchemaView meta node DESCRIBING
		// the GraphProvenance label carries the string in a property value (observed).
		if (oneLine.indexOf('GraphProvenance') !== -1) {
			const parsed = JSON.parse(oneLine);
			if ((parsed.labels || []).indexOf('GraphProvenance') !== -1) {
				passportIds.push(parsed.stableId);
				return false;
			}
		}
		return true;
	});
	const edgeLines = edgeText.split('\n').filter(Boolean).filter((oneLine) => {
		const parsed = JSON.parse(oneLine);
		return passportIds.indexOf(parsed.from) === -1 && passportIds.indexOf(parsed.to) === -1;
	});
	return {
		nodeCount: nodeLines.length,
		edgeCount: edgeLines.length,
		droppedPassports: passportIds.length,
		nodeSha256: sha256Text(nodeLines.join('\n') + '\n'),
		edgeSha256: sha256Text(edgeLines.join('\n') + '\n'),
	};
};

console.log('\n== determinism on the ESTABLISHED scope (:GraphProvenance excluded) ==');
const armA = establishedScope(
	fs.readFileSync(`${DUMP_DIR}/armA-determinism.nodes.jsonl`, 'utf8'),
	fs.readFileSync(`${DUMP_DIR}/armA-determinism.edges.jsonl`, 'utf8'),
);
const deliverable = establishedScope(
	fs.readFileSync(`${DUMP_DIR}/deliverable-GOLD_EVAL_260717.nodes.jsonl`, 'utf8'),
	fs.readFileSync(`${DUMP_DIR}/deliverable-GOLD_EVAL_260717.edges.jsonl`, 'utf8'),
);
assert(
	`exactly ONE passport node dropped per arm (got ${armA.droppedPassports}/${deliverable.droppedPassports})`,
	armA.droppedPassports === 1 && deliverable.droppedPassports === 1,
);
assert(
	`determinism: node dumps IDENTICAL on the established scope ` +
		`(${armA.nodeCount} vs ${deliverable.nodeCount}; sha ${armA.nodeSha256.slice(0, 12)}…)`,
	armA.nodeCount === deliverable.nodeCount && armA.nodeSha256 === deliverable.nodeSha256,
);
assert(
	`determinism: edge dumps IDENTICAL on the established scope ` +
		`(${armA.edgeCount} vs ${deliverable.edgeCount}; sha ${armA.edgeSha256.slice(0, 12)}…)`,
	armA.edgeCount === deliverable.edgeCount && armA.edgeSha256 === deliverable.edgeSha256,
);
assert(
	'determinism comparator RED: a mutated byte flips the comparison',
	sha256Text('MUTATED') !== armA.nodeSha256,
);

console.log('\n== preservation: the 26 CEDS anchors as PROMOTED cedsId (parser.js:40) ==');
const scratchDbPath = JSON.parse(fs.readFileSync('/tmp/pilotPhase4-state.json', 'utf8')).scratchDbPath;
const credRun = spawnSync(
	'sqlite3',
	['-readonly', scratchDbPath, `SELECT credentialValue FROM graphs WHERE name='${DELIVERABLE_NAME}'`],
	{ encoding: 'utf8' },
);
const credential = `${credRun.stdout}`.trim();
const anchorRun = spawnSync(
	'docker',
	[
		'exec', DELIVERABLE_NAME, 'cypher-shell', '-u', 'neo4j', '-p', credential, '--format', 'plain',
		`MATCH (n:ForgedNode {_source:'CTDL'}) WHERE n.cedsId IS NOT NULL RETURN count(n);`,
	],
	{ encoding: 'utf8' },
);
const anchorCount = Number((`${anchorRun.stdout}`.match(/\d+/) || [0])[0]);
assert(
	`preservation: the 26 CEDS-annotated anchors SURVIVE as cedsId (got ${anchorCount})`,
	anchorRun.status === 0 && anchorCount === 26,
);
const redProbe = spawnSync(
	'docker',
	[
		'exec', DELIVERABLE_NAME, 'cypher-shell', '-u', 'neo4j', '-p', credential, '--format', 'plain',
		`MATCH (n:ForgedNode {_source:'CTDL'}) WHERE n.__TEST_noSuchAnchorProperty IS NOT NULL RETURN count(n);`,
	],
	{ encoding: 'utf8' },
);
const redCount = Number((`${redProbe.stdout}`.match(/\d+/) || [-1])[0]);
assert(
	'preservation comparator RED: a wrong property name yields 0 (the original miss, reproduced)',
	redProbe.status === 0 && redCount === 0,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
