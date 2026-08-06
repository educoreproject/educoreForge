#!/usr/bin/env node
'use strict';

// p4r_probeRescopedHelpers.js — RE-PROOF for the Phase 3 helpers that Phase 4 NARROWED.
//
// WHY. The Phase 4 review flagged ([G-4]) that four harness helpers were rescoped when the
// synthetic tier arrived — `namedDefinitionNodes` and `stripDerived` gained a pescTier filter,
// `assertPristineSourceGraph` gained a synthetic clause, and the G3-E BFS inherited the narrowed
// definition set — while the assertions that depend on them still cited red evidence from the
// Phase 3 vr_* runs. A receipt that points at a run of DIFFERENT CODE is not a receipt. These
// levers re-prove the dependent assertions against the code as it now stands, and each reverts
// EXACTLY ONE thing: the narrowing itself.
//
// Run: node forges/pesc260805/test/probes/p4r_probeRescopedHelpers.js
// Writes one log per lever into test/test-artifacts/. ALWAYS restores the suite file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SUITE_PATH = path.join(BUNDLE_DIR, 'test', 'test-pesc260805DerivedTier.js');
const ARTIFACT_DIR = path.join(BUNDLE_DIR, 'test', 'test-artifacts');

const LEVERS = [
	{
		logName: 'p4r_probeUnscopedDefinitions_derived.log',
		// ONE THING: `namedDefinitionNodes` stops excluding the 109 synthetic merged definitions,
		// which is precisely the Phase 4 narrowing. Every census, cluster and reachability figure in
		// this suite reads through that helper.
		before: `const namedDefinitionNodes = (forged) =>
	forged.nodes.filter(
		(oneNode) =>
			oneNode.labels.indexOf('PescNamedDefinition') !== -1 &&
			oneNode.properties.pescTier === 'source',
	);`,
		after: `const namedDefinitionNodes = (forged) =>
	forged.nodes.filter((oneNode) => oneNode.labels.indexOf('PescNamedDefinition') !== -1);`,
	},
	{
		logName: 'p4r_probeUnscopedStrip_derived.log',
		// ONE THING: `stripDerived` stops removing synthetic nodes, which is the other half of the
		// Phase 4 narrowing. The regeneration input then carries DECIDED definitions, and the
		// derived tier's purity guard is the thing that must object.
		before: `	stripped.nodes = stripped.nodes.filter(
		(oneNode) =>
			oneNode.properties.pescTier !== 'derived' && oneNode.properties.pescTier !== 'synthetic',
	);`,
		after: `	stripped.nodes = stripped.nodes.filter(
		(oneNode) => oneNode.properties.pescTier !== 'derived',
	);`,
	},
];

const originalText = fs.readFileSync(SUITE_PATH, 'utf8');
const originalSha = crypto.createHash('sha256').update(originalText).digest('hex');

LEVERS.forEach((oneLever) => {
	const occurrences = originalText.split(oneLever.before).length - 1;
	if (occurrences !== 1) {
		throw new Error(
			`probe REFUSES: lever '${oneLever.logName}' matches its site ${occurrences} times, not once.`,
		);
	}
});

LEVERS.forEach((oneLever) => {
	let suiteOutput = '';
	try {
		fs.writeFileSync(SUITE_PATH, originalText.replace(oneLever.before, oneLever.after));
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
		fs.writeFileSync(SUITE_PATH, originalText);
		const restoredSha = crypto
			.createHash('sha256')
			.update(fs.readFileSync(SUITE_PATH, 'utf8'))
			.digest('hex');
		if (restoredSha !== originalSha) {
			throw new Error(
				`probe FAILED TO RESTORE ${SUITE_PATH} (sha ${restoredSha} != ${originalSha}).`,
			);
		}
	}
	fs.writeFileSync(path.join(ARTIFACT_DIR, oneLever.logName), suiteOutput);
	const failedLabels = suiteOutput
		.split('\n')
		.filter((oneLine) => /^\s*FAIL\s+/.test(oneLine))
		.map((oneLine) => oneLine.replace(/^\s*FAIL\s+/, ''));
	console.log(`\n${oneLever.logName}: ${failedLabels.length} assertion(s) RED`);
	failedLabels.forEach((oneLabel) => console.log(`   ${oneLabel}`));
	if (failedLabels.length === 0) {
		console.log('   (no FAIL lines — inspect the log; the suite may have aborted rather than reported)');
	}
});
console.log(`\nsuite file restored (sha ${originalSha.substring(0, 12)})`);
