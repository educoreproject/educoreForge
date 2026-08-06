#!/usr/bin/env node
'use strict';

// p4r_probeDelta.js — red levers for the REBUILT G4-C (R-P4-5, R-P4-6, R-P4-7).
//
// Two levers, run separately, each reverting EXACTLY ONE thing:
//
//   1. EXPECTATION PERTURBATION — the four new delta constants in the suite's single EXPECTED
//      block are moved. Proves the assertions read the observation. Not a shipped-configuration
//      probe and is recorded as such.
//
//   2. PRODUCTION MUTATION, SHIPPED CONFIGURATION — the merge's dropped-entry comparison reverts
//      from SIGNATURE-based to NAME-based, which is precisely the pre-R-P4-5 record that misled.
//      This is the lever that matters: the PREDECESSOR gate stayed green under exactly this
//      behaviour (it was this behaviour), and the rebuilt gate must go red on it.
//
// Run: node forges/pesc260805/test/probes/p4r_probeDelta.js
// ALWAYS restores both files, including on failure.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SUITE_PATH = path.join(BUNDLE_DIR, 'test', 'test-pesc260805SyntheticTier.js');
const TIER_PATH = path.join(BUNDLE_DIR, 'lib', 'syntheticTier.js');
const ARTIFACT_DIR = path.join(BUNDLE_DIR, 'test', 'test-artifacts');

const LEVERS = [
	{
		logName: 'p4r_probeExpectDelta_synthetic.log',
		targetPath: SUITE_PATH,
		before: `	absentChildElements: 2,
	reboundChildElements: 5,
	widenedChildElements: 1,
	addedChildElements: 33,`,
		after: `	absentChildElements: 3,
	reboundChildElements: 4,
	widenedChildElements: 2,
	addedChildElements: 34,`,
	},
	{
		logName: 'p4r_probeNameOnlyDelta_synthetic.log',
		targetPath: TIER_PATH,
		// THE ONE THING: dropped entries are found by NAME, not by SIGNATURE — the pre-R-P4-5
		// comparison, restored verbatim in spirit. Under it the five REBOUND and the one WIDENED
		// entry vanish from the record entirely (their names ARE present in the winner), which is
		// exactly the false picture §8f describes. Everything else in the tier is untouched.
		before: `				const droppedEntries = testScoreSignature.filter(
					(oneEntry) => !collegeKeySet.has(signatureEntryKey(oneEntry)),
				);`,
		after: `				/* PROBE — THE ONE THING: NAME-based, not SIGNATURE-based (the pre-R-P4-5 record). */
				const collegeNameSetProbe = new Set(collegeSignature.map((oneEntry) => oneEntry.name));
				const droppedEntries = testScoreSignature.filter(
					(oneEntry) => !collegeNameSetProbe.has(oneEntry.name),
				);`,
	},
	{
		logName: 'p4r_probeUnpublishedDelta_synthetic.log',
		targetPath: TIER_PATH,
		// THE ONE THING: the merged node stops PUBLISHING its delta (the report still computes it).
		// This is the "it is in the report, surely that is enough" defect — and it is not enough:
		// a consumer holding only the merged definition would have no way to learn what the merge
		// cost or added, which is the whole point of R-P4-5/6 landing on the node.
		before: `						absentChildElementSignatures: JSON.stringify(deltaSignatures.absent),
						absentChildElementCount: deltaSignatures.absent.length,
						reboundChildElementSignatures: JSON.stringify(deltaSignatures.rebound),
						reboundChildElementCount: deltaSignatures.rebound.length,
						widenedChildElementSignatures: JSON.stringify(deltaSignatures.widened),
						widenedChildElementCount: deltaSignatures.widened.length,
						addedChildElementSignatures: JSON.stringify(deltaSignatures.added),
						addedChildElementCount: deltaSignatures.added.length,`,
		after: `						/* PROBE — THE ONE THING: the delta is computed but NOT published on the node. */`,
	},
];

LEVERS.forEach((oneLever) => {
	const originalText = fs.readFileSync(oneLever.targetPath, 'utf8');
	const originalSha = crypto.createHash('sha256').update(originalText).digest('hex');
	const occurrences = originalText.split(oneLever.before).length - 1;
	if (occurrences !== 1) {
		throw new Error(
			`probe REFUSES: lever '${oneLever.logName}' matches its site ${occurrences} times, not once.`,
		);
	}
	let suiteOutput = '';
	try {
		fs.writeFileSync(oneLever.targetPath, originalText.replace(oneLever.before, oneLever.after));
		try {
			suiteOutput = execFileSync(process.execPath, [SUITE_PATH], {
				encoding: 'utf8',
				maxBuffer: 64 * 1024 * 1024,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (thrownError) {
			suiteOutput = `${thrownError.stdout || ''}${thrownError.stderr || ''}`;
		}
	} finally {
		fs.writeFileSync(oneLever.targetPath, originalText);
		const restoredSha = crypto
			.createHash('sha256')
			.update(fs.readFileSync(oneLever.targetPath, 'utf8'))
			.digest('hex');
		if (restoredSha !== originalSha) {
			throw new Error(`probe FAILED TO RESTORE ${oneLever.targetPath}.`);
		}
	}
	fs.writeFileSync(path.join(ARTIFACT_DIR, oneLever.logName), suiteOutput);
	const failedLabels = suiteOutput
		.split('\n')
		.filter((oneLine) => /^\s*FAIL\s+/.test(oneLine))
		.map((oneLine) => oneLine.replace(/^\s*FAIL\s+/, ''));
	console.log(`\n${oneLever.logName}: ${failedLabels.length} assertion(s) RED`);
	failedLabels.forEach((oneLabel) => console.log(`   ${oneLabel}`));
});
