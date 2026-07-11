#!/usr/bin/env node
'use strict';

// phaseD-gate-battery.js — the Phase D formal gate assertions that are not their own
// drivers (G-D1/G-D3 have dedicated drivers): G-D4 (offer side + compatible-only; the
// named gap was captured live in logs/phaseD-gd4-gap-capture.json), G-D5 (engine
// containment grep), G-D6 (§6.5 presentation audit over captured outputs), G-D7
// (no-decoy + canonical default), and the COMMA-GUARD constructed tests (one per new
// verb — the Phase-C pin). Read-only against the canonical store; the one store-writing
// comma test (-defineGroup) runs against the SCRATCH copy.
//
// Run: env -u ANTHROPIC_API_KEY node baselines/phaseD-gate-battery.js

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CODE = path.join(__dirname, '..');
const MANIFEST = path.join(CODE, 'cli', 'lib.d', 'manifest-editor', 'manifestEditor.js');
const ENGINE = path.join(
	CODE, 'npm', 'qtools-graph-forge-core', 'lib', 'replay', 'replay-engine.js',
);
const SCRATCH_DB =
	'/private/tmp/claude-501/-Users-tqwhite-Documents-webdev/5b0bbbb9-cad3-4583-9b51-98e12fe16175/scratchpad/scratchStore.sqlite3';
const M01 = '735aa6b9955f2f81a50c5ada052c594424b55c807621c12e19a516263f1d0b9a';
const M02 = 'e73b93da5aa68f90a64d6f4b90748523b19900bffbc971fbae3c41a2524a0e06';

let passCount = 0;
let failCount = 0;
const assert = (cond, label) => {
	if (cond) {
		passCount++;
		console.log(`  PASS: ${label}`);
	} else {
		failCount++;
		console.log(`  FAIL: ${label}`);
	}
};

const run = (args) => {
	const out = execFileSync('node', [MANIFEST, ...args], {
		encoding: 'utf8',
		env: { ...process.env },
	});
	// strip any pre-JSON narration; the payload may be an object OR an array
	return JSON.parse(out.slice(out.search(/[[{]/)));
};
const runExpectError = (args) => {
	let stderr = '';
	let failed = false;
	// the CLI reports handler errors via xLog.error (stderr) with exitCode 1 — an expected-
	// error probe reads that channel; a zero-exit success here is itself a failure signal.
	const result = require('child_process').spawnSync('node', [MANIFEST, ...args], {
		encoding: 'utf8',
	});
	failed = result.status !== 0;
	stderr = `${result.stderr || ''}${result.stdout || ''}`;
	return { failed, text: stderr };
};

// keyOrder — assert every LEAD key appears before every TRAIL key in an object's
// insertion order (JSON field order IS the §6.5 presentation order).
const keyOrder = (obj, leadKeys, trailKeys) => {
	const keys = Object.keys(obj);
	const maxLead = Math.max(...leadKeys.filter((k) => keys.includes(k)).map((k) => keys.indexOf(k)));
	const minTrail = Math.min(...trailKeys.filter((k) => keys.includes(k)).map((k) => keys.indexOf(k)));
	return maxLead < minTrail;
};

console.log('=== G-D4: the selection assist — offer side + compatible-only ===');
{
	// the (01,02) group exists NOW; offers on M02 @02 must include exactly it
	const offer02 = run(['-offerGroups', `--manifest=${M02}`, '--standard=synthstd@02']);
	assert(
		offer02.offerCount === 1 && offer02.gaps.length === 0,
		`offerGroups synthstd@02 on M02 offers EXACTLY the (01,02) group, no gaps (got ${offer02.offerCount}/${offer02.gaps.length})`,
	);
	assert(
		offer02.offers[0].versionKey === '(01,02)' &&
			`${offer02.offers[0].displayName}`.length > 0 &&
			Object.keys(offer02.offers[0])[0] === 'displayName',
		'the offer is displayName-LED and carries the (01,02) key',
	);
	// compatible-only: chosen @01 must offer ONLY the (01,01) group — never the (01,02)
	const offer01 = run(['-offerGroups', `--manifest=${M01}`, '--standard=synthstd@01']);
	assert(
		offer01.offerCount === 1 && offer01.offers[0].versionKey === '(01,01)',
		`offerGroups synthstd@01 on M01 offers ONLY the compatible (01,01) group (got ${offer01.offerCount}, key ${offer01.offers[0] && offer01.offers[0].versionKey})`,
	);
	// the live-captured named gap (taken before the (01,02) group existed)
	const gapCapture = JSON.parse(
		fs
			.readFileSync(
				'/Users/tqwhite/Documents/webdev/educoreForge/system/management/zNotesPlansDocs/pairwiseVersionSwitching-devlogs/logs/phaseD-gd4-gap-capture.json',
				'utf8',
			)
			.replace(/^[^{]*/, ''),
	);
	assert(
		gapCapture.gaps.length === 1 &&
			gapCapture.gaps[0] === 'no CEDS::synthstd mappings exist at (h01, s02); produce them via §7.2',
		'the named gap was captured LITERALLY in the spec §8 wording (pre-mint live capture)',
	);
}

console.log('=== G-D5: engine containment — no pair/group/version knowledge ===');
{
	const engineText = fs.readFileSync(ENGINE, 'utf8');
	// invariant 11.10: the engine knows NOTHING of pair-GROUPS, version keys, pointers,
	// or the pair modules. ('pairA'/'pairB' appear in the PRE-EXISTING legacy bridge-block
	// extract selectors — 6 hits at the Phase-C boundary commit, asserted UNCHANGED below:
	// zero NEW pair knowledge this phase.)
	const forbidden = [
		'pairGroup', 'versionKey', 'currentPairGroup', 'pairSubject',
		'pair-binding', 'pair-group-mint', 'resolveCurrentPairGroup', 'publishedVersion',
		'tierScope',
	];
	const hits = forbidden.filter((oneToken) => engineText.indexOf(oneToken) !== -1);
	assert(
		hits.length === 0,
		`replay-engine contains NO pair-group/version-key vocabulary (forbidden tokens found: ${hits.join(', ') || 'none'})`,
	);
	const legacyPairHitCount = (engineText.match(/pair[AB]/g) || []).length;
	const boundaryText = execFileSync(
		'git', ['show', '1028ead6:npm/qtools-graph-forge-core/lib/replay/replay-engine.js'],
		{ cwd: CODE, encoding: 'utf8' },
	);
	const boundaryPairHitCount = (boundaryText.match(/pair[AB]/g) || []).length;
	assert(
		legacyPairHitCount === boundaryPairHitCount,
		`legacy bridge-selector pairA/pairB references UNCHANGED vs the boundary commit (${legacyPairHitCount} == ${boundaryPairHitCount})`,
	);
	const gitDiff = execFileSync('git', ['diff', '--stat', 'npm/qtools-graph-forge-core/lib/replay/replay-engine.js'], { cwd: CODE, encoding: 'utf8' });
	const statMatch = gitDiff.match(/1 file changed, (\d+) insertions?\(\+\)(?:, (\d+) deletions?\(-\))?/);
	assert(
		!!statMatch && statMatch[1] === '8' && statMatch[2] === undefined,
		`engine diff is EXACTLY the tier addition: 8 insertions, 0 deletions (got: ${gitDiff.trim().split('\n').pop()})`,
	);
}

console.log('=== G-D6: §6.5 presentation audit over captured outputs ===');
{
	const lv = run(['-listVersions', '--standard=synthstd']);
	assert(
		lv.versions.every((oneVersion) =>
			keyOrder(oneVersion, ['publishedVersion', 'displayName'], ['snapshotKey']),
		),
		'listVersions: publishedVersion/displayName LEAD, snapshotKey TRAILS, every row',
	);
	const lg = run(['-listGroups', '--standard=synthstd']);
	assert(
		lg.groups.length >= 2 &&
			lg.groups.every((oneGroup) =>
				keyOrder(oneGroup, ['displayName', 'publishedVersionA', 'publishedVersionB'], ['versionKey', 'groupBlockId']),
			),
		'listGroups: displayName/publishedVersions LEAD, versionKey/groupBlockId TRAIL',
	);
	const offer = run(['-offerGroups', `--manifest=${M02}`, '--standard=synthstd@02']);
	assert(
		offer.offers.every((oneOffer) =>
			keyOrder(oneOffer, ['displayName', 'publishedVersionA', 'publishedVersionB'], ['versionKey', 'groupBlockId']),
		),
		'offerGroups: offers displayName-LED, keys TRAIL',
	);
	const report = JSON.parse(
		fs
			.readFileSync(
				'/Users/tqwhite/Documents/webdev/educoreForge/system/management/zNotesPlansDocs/pairwiseVersionSwitching-devlogs/logs/phaseD-gd3-build-matched.json',
				'utf8',
			)
			.replace(/^[^{]*/, ''),
	);
	assert(
		report.connectReport.pairs.every((onePair) =>
			keyOrder(onePair, ['pair', 'publishedVersionA', 'publishedVersionB'], ['versionKey', 'memberBlockIds']),
		),
		'connect report: pair display + publishedVersions LEAD, raw keys/blockIds TRAIL',
	);
}

console.log('=== G-D7: no decoy + canonical default ===');
{
	assert(!fs.existsSync(path.join(CODE, 'dataStore')), 'the decoy code/dataStore/ path is GONE from the tree');
	const manifests = run(['-listManifests']); // NO --db: must reach the canonical store
	const hasGolden = (manifests || []).some((oneRow) =>
		`${oneRow.manifestKey}`.startsWith('a9a79df5'),
	);
	assert(hasGolden, 'manifestEditor with NO --db reaches the CANONICAL store (golden manifest visible)');
	const scratchManifests = run(['-listManifests', `--db=${SCRATCH_DB}`]);
	assert(Array.isArray(scratchManifests), '--db override still honored (scratch store listable)');
}

console.log('=== COMMA-GUARD constructed tests (one per new verb — the pin) ===');
{
	// -defineGroup: comma-bearing displayName round-trips intact (SCRATCH store write)
	const define = run([
		'-defineGroup', '--pair=CEDS::CASE', '--versionKey=(01,01)',
		'--members=db227d12333decc02d41479e5c6922862ba9219d56b099422e7eaf93c972cbad',
		'--displayName=comma test, part two, (01,01) intact', `--db=${SCRATCH_DB}`,
	]);
	assert(
		define.displayName === 'comma test, part two, (01,01) intact',
		`-defineGroup: comma-bearing displayName intact ('${define.displayName}')`,
	);
	// -showGroup / -validateGroup: the symbolic ref's parenthesized comma survives
	const show = run(['-showGroup', '--group=CEDS::synthstd@(01,02)']);
	assert(show.versionKey === '(01,02)', '-showGroup: symbolic pair@(a,b) comma survives the parser');
	const validate = run(['-validateGroup', '--group=CEDS::synthstd@(01,02)']);
	assert(validate.valid === true, '-validateGroup: symbolic ref parses; group valid');
	// -listVersions: a comma-bearing standard name reaches the resolver INTACT (loud, unmangled)
	const lvErr = runExpectError(['-listVersions', '--standard=SIF,extra']);
	assert(
		lvErr.failed && lvErr.text.indexOf("'SIF,extra'") !== -1,
		'-listVersions: comma-bearing --standard rejected LOUDLY with the value intact (no truncation)',
	);
	// -listGroups: comma-bearing --version reaches the filter intact (echoed back)
	const lgComma = run(['-listGroups', '--standard=synthstd', '--version=01,zz']);
	assert(
		lgComma.version === '01,zz' && lgComma.groupCount === 0,
		`-listGroups: comma-bearing --version intact in output ('${lgComma.version}'), matches nothing`,
	);
	// -offerGroups: comma-bearing manifest key fails LOUDLY with the value intact
	const ogErr = runExpectError(['-offerGroups', '--manifest=zzz,yyy', '--standard=synthstd@01']);
	assert(
		ogErr.failed && ogErr.text.indexOf('zzz,yyy') !== -1,
		'-offerGroups: comma-bearing --manifest rejected LOUDLY with the value intact',
	);
	// -combine --group: TWO parenthesized-comma refs in ONE flag value (proven live in G-D1;
	// re-witnessed here against the scratch store for the battery record)
	const combine = run([
		'-combine',
		'--set=a84cd4b2917adbcbfe8814fba1f0126167a283186d522e8d87a69ead0497f93f',
		'--group=CEDS::EdFi@(01,01),CEDS::SIF@(01,01)', '--label=phaseD-comma-battery',
		`--db=${SCRATCH_DB}`,
	]);
	assert(
		combine.memberCount === 5,
		`-combine --group: paren-aware split yields two groups from one flag (1 std + 1 + 3 members = ${combine.memberCount})`,
	);
}

console.log('========================================');
console.log(`BATTERY RESULT: ${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
