#!/usr/bin/env node
'use strict';

// mp_probeStatusLineGuard.js — Phase 4.6a (session MYSTIC_PORTAL).
// RED-BEFORE-GREEN for the requiredStat guard added to forgePesc260805's synthetic status line.
//
// WHY THIS EXISTS. A status line is the one place the campaign's absent-property discipline cannot
// reach by itself: `${stats.misspelled}` is a valid expression that interpolates the word
// "undefined" into an otherwise fluent English sentence. Nothing throws, no assertion fails, and
// the build prints a confident, plausible, WRONG report. It happened here — the first build after
// R-P4-11 renamed the delta stats printed "…14 conflict and undefined child elements are genuinely
// ABSENT… and undefined ADDED by the winning member".
//
// Runs the real forge with a CAPTURING xLog, then demonstrates the guard refusing a stale name.

const path = require('path');

const capturedStatusLines = [];
process.global = process.global || {};
process.global.xLog = {
	status: (oneLine) => capturedStatusLines.push(oneLine),
	error: (oneLine) => console.error(oneLine),
	result: () => {},
	verbose: () => {},
};

const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const bundle = require(path.join(BUNDLE_DIR, 'forgePesc260805'))({ embedder: null });

let pass = 0;
let fail = 0;
const check = (label, condition) => {
	if (condition) {
		pass++;
		console.log(`  ok    ${label}`);
	} else {
		fail++;
		console.error(`  FAIL  ${label}`);
	}
};
const evidence = (line) => console.log(`        ${line}`);

// ---- RED FIRST, against the guard itself -------------------------------------------------
// The guard is a local function inside the forge, so it is exercised here in the identical shape
// rather than imported. Reverting to the pre-guard form (plain interpolation) is what produces the
// defect, and that is shown alongside so the difference is the guard and nothing else.
const requiredStat = (statsObject, statName) => {
	if (!Object.prototype.hasOwnProperty.call(statsObject, statName)) {
		throw new Error(
			`forge-pesc260805 builder bug: the synthetic tier publishes no stat '${statName}', so the ` +
				`build status line would have printed 'undefined' inside a sentence that reads like a ` +
				`measurement. Available: ${Object.keys(statsObject).sort().join(', ')}`,
		);
	}
	return statsObject[statName];
};

const pretendStats = { contributedChildElements: 35 };
const unguardedSentence = `…and ${pretendStats.absentChildElements} ADDED by the winning member`;
evidence(`RED (demonstrated), UNGUARDED interpolation of a stale stat name: "${unguardedSentence}"`);
check('STATUS-GUARD RED: plain interpolation of an absent stat silently yields the word "undefined" in a fluent sentence', /undefined/.test(unguardedSentence));

let guardRefusal = '';
try {
	requiredStat(pretendStats, 'absentChildElements');
} catch (thrownError) {
	guardRefusal = thrownError.message;
}
evidence(`GREEN: the same stale name through the guard -> ${guardRefusal.substring(0, 160)}`);
check('STATUS-GUARD: the guard REFUSES a stale stat name and names it', guardRefusal.indexOf("publishes no stat 'absentChildElements'") !== -1);
check('STATUS-GUARD: the refusal enumerates what IS available, so the fix is in the message', guardRefusal.indexOf('contributedChildElements') !== -1);

// ---- and the shipped status line itself is clean -----------------------------------------
bundle.forge({ sourcePath: SNAPSHOT_DIR, owner: 'probe', skipEmbedding: true }, (err) => {
	if (err) {
		console.error(`forge failed: ${err}`);
		process.exit(1);
	}
	const syntheticStatusLine = capturedStatusLines.find(
		(oneLine) => oneLine.indexOf('synthetic tier:') !== -1,
	);
	console.log(`\nSHIPPED STATUS LINE:\n${syntheticStatusLine}\n`);
	const linesCarryingUndefined = capturedStatusLines.filter((oneLine) => /undefined/.test(oneLine));
	evidence(`status lines emitted: ${capturedStatusLines.length}; carrying the word "undefined": ${linesCarryingUndefined.length}`);
	linesCarryingUndefined.forEach((oneLine) => evidence(`  ${oneLine.substring(0, 200)}`));
	check('STATUS-GUARD: no build status line contains the word "undefined"', linesCarryingUndefined.length === 0);
	check('STATUS-GUARD: the synthetic status line reports the materialized classification AND labels the signature basis', syntheticStatusLine.indexOf('materialized') !== -1 && syntheticStatusLine.indexOf('signature basis') !== -1);
	check('STATUS-GUARD: the status line warns against summing the overlapping counts', syntheticStatusLine.indexOf('do not sum') !== -1);

	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail === 0 ? 0 : 1);
});
