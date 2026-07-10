#!/usr/bin/env node
'use strict';

// roster-gate.js — the G-A2 ROSTER GATE harness (pairwiseVersionSwitching Phase A).
//
// Asserts the discovery roster equals the FROZEN expectation (roster-expected.json) exactly:
//   - prod mode: roster() must equal the synthetic:false SUBSET of the same frozen file
//     (a second expectation file is never hand-authored — boundary-review C3(i));
//   - test mode: roster({ includeSynthetic: true }) must equal all frozen bundles.
// Per-entry comparison on registryKey / standardName / synthetic, keyed by bundleDir.
// A standard appearing or vanishing is a RED naming it, never a surprise (spec §3.5).
//
// Exit 0 + 'verdict: GREEN' when both modes match; exit 1 + named problems otherwise.
// A malformed bundle fails earlier and louder: discovery itself throws naming the bundle.

const path = require('path');

const expected = require(path.join(__dirname, 'roster-expected.json'));
const discovery = require(path.join(
	__dirname,
	'..',
	'cli',
	'lib.d',
	'forger',
	'lib',
	'standard-discovery',
));

const compareRoster = (label, actualEntries, expectedBundles) => {
	const problems = [];
	const actualByBundleDir = {};
	actualEntries.forEach((entry) => {
		actualByBundleDir[entry.bundleDir] = entry;
	});
	expectedBundles.forEach((expectedBundle) => {
		const actual = actualByBundleDir[expectedBundle.bundleDir];
		if (!actual) {
			problems.push(
				`${label}: MISSING bundle '${expectedBundle.bundleDir}' (standardName '${expectedBundle.standardName}') — vanished from discovery`,
			);
			return;
		}
		['registryKey', 'standardName', 'synthetic'].forEach((field) => {
			if (actual[field] !== expectedBundle[field]) {
				problems.push(
					`${label}: bundle '${expectedBundle.bundleDir}' ${field} mismatch: discovered ${JSON.stringify(
						actual[field],
					)}, expected ${JSON.stringify(expectedBundle[field])}`,
				);
			}
		});
	});
	actualEntries.forEach((actual) => {
		if (!expectedBundles.find((expectedBundle) => expectedBundle.bundleDir === actual.bundleDir)) {
			problems.push(
				`${label}: UNEXPECTED bundle '${actual.bundleDir}' (standardName '${actual.standardName}') — appeared without a roster-expected amendment`,
			);
		}
	});
	return problems;
};

const prodExpected = expected.bundles.filter((bundle) => !bundle.synthetic);
const prodActual = discovery.roster();
const testActual = discovery.roster({ includeSynthetic: true });

const problems = [
	...compareRoster('prod', prodActual, prodExpected),
	...compareRoster('test', testActual, expected.bundles),
];

// the deliberate p6hub exemption (spec §3.5): in TEST mode both forge-ceds and forge-p6hub carry
// standardName 'CEDS' — the collision rule applies to enabled PRODUCTION bundles only, so a green
// test-mode roster above IS the exemption working. Assert it explicitly so the check never goes
// vacuous if the fixtures change.
const cedsNamed = testActual.filter((entry) => entry.standardName === 'CEDS');
const exemptionWitnessed =
	cedsNamed.length === 2 &&
	cedsNamed.some((entry) => entry.synthetic) &&
	cedsNamed.some((entry) => !entry.synthetic);
if (!exemptionWitnessed) {
	problems.push(
		`exemption check: expected exactly one production + one synthetic bundle with standardName 'CEDS' in test mode; found ${JSON.stringify(
			cedsNamed.map((entry) => entry.bundleDir),
		)}`,
	);
}

if (problems.length) {
	problems.forEach((problem) => console.error(`ROSTER GATE RED: ${problem}`));
	console.error(`verdict: RED (${problems.length} problem${problems.length === 1 ? '' : 's'})`);
	process.exit(1);
}
console.log(
	`verdict: GREEN — prod roster ${prodActual.length}/${prodExpected.length}, test roster ${testActual.length}/${expected.bundles.length} match roster-expected.json exactly; p6hub 'CEDS' test-mode exemption witnessed`,
);
