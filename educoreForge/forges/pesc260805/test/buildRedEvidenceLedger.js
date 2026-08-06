#!/usr/bin/env node
'use strict';

// Generates test/redEvidenceLedger.json for the pesc260805 bundle.
// Maps every SHIPPED assertion label to its red evidence: the retained log that recorded it
// FAILING, and the LEVER that produced that red (what was actually broken). The lever is the
// load-bearing half — G3-F proved an assertion can go red for a reason other than the one it
// names, so "it failed once" is not evidence unless we know WHY.

const fs = require('fs');
const path = require('path');

// resolved from this file's own location so the ledger stays reproducible wherever the bundle sits
const ARTIFACT_DIR = path.join(__dirname, 'test-artifacts');

// Every retained log that recorded a FAIL, with the lever that produced it. `shippedConfig`
// records whether the probe ran against the code we actually ship — the N1 lesson.
const EVIDENCE_SOURCES = [
	{
		logName: 'vr_baseline_source.log',
		suite: 'source',
		lever:
			'INHERITED BASELINE. The dead predecessor\'s uncommitted tree, run unmodified by VELVET_RIVER before any repair. The FAIL here is the real defect as found, not a planted one.',
		shippedConfig: true,
	},
	{
		logName: 'vr_baseline_derived.log',
		suite: 'derived',
		lever:
			'INHERITED BASELINE. The dead predecessor\'s uncommitted tree, run unmodified before any repair. The FAILs here are the four real defects as found.',
		shippedConfig: true,
	},
	{
		logName: 'vr_redProbe_source.log',
		suite: 'source',
		lever:
			'EXPECTATION PERTURBATION (round 1): dropped \'meta\' from PESC_TIER_VALUES and perturbed the source/derived/synthetic count constants.',
		shippedConfig: false,
	},
	{
		logName: 'vr_redProbe_derived.log',
		suite: 'derived',
		lever:
			'EXPECTATION PERTURBATION (round 1): inverted the ClassRankType out-degree and D-4 constants, the G3-D RED-1 planted-edge count, and the G3-F control/shape-attribution conditions.',
		shippedConfig: false,
	},
	{
		logName: 'vr_redProbe_partition.log',
		suite: 'derived',
		lever:
			'EXPECTATION PERTURBATION (round 1): made both G3-D removal probes name the SAME unserved reference, collapsing the partition claim.',
		shippedConfig: false,
	},
	{
		logName: 'vr_probeA.log',
		suite: 'derived',
		lever:
			'EXPECTATION PERTURBATION (round 2): perturbed the GAP 2 accounting, GAP 3 global-topology, GAP 4 root/reachability and GAP 6 presence constants.',
		shippedConfig: false,
	},
	{
		logName: 'vr_probeB.log',
		suite: 'derived',
		lever:
			'PRODUCTION MUTATION (round 2): removed BOTH undeclared-name guards (stageAnnotation and applyDerivedTier), REVERTED GAP 7\'s clone, and staged undeclaredDriftMarker onto all 12,909 definition nodes through the real writer.',
		shippedConfig: false,
		caveat:
			'NOT the shipped configuration — this probe also reverted GAP 7. Reds obtained here do not prove behavior of the code as shipped. This is the exact defect the second adversarial review found in N1; superseded for the GAP 1 assertions by vr_probeC.log.',
	},
	{
		logName: 'vr_probeC.log',
		suite: 'derived',
		lever:
			'PRODUCTION MUTATION, SHIPPED CONFIGURATION (round 3): neutralised ONLY the applyDerivedTier undeclared-name refusal. The probe build script ASSERTED that GAP 7\'s clone and stageAnnotation\'s guard both remained intact, so it could not silently diverge from shipped.',
		shippedConfig: true,
	},
	{
		logName: 'vr_probeD.log',
		suite: 'derived',
		lever:
			'PRODUCTION MUTATION, SHIPPED CONFIGURATION (round 3): applyDerivedTier still computes the annotated clone but RETURNS the caller\'s originals — the "clone became a no-op" defect.',
		shippedConfig: true,
	},
	{
		logName: 'vr_ledgerGate_red_derived.log',
		suite: 'derived',
		lever:
			'LEDGER GATE SELF-DEMONSTRATION (round 4): the gate ran with its own three assertions absent from the ledger, so an assertion genuinely lacked red evidence and the gate caught it. Its own first draft had EXEMPTED itself by computing the label set before its own checks ran; that vacuity was found and fixed, and this log is the run after the fix.',
		shippedConfig: true,
	},
	{
		logName: 'vr_ledgerGate_red_source.log',
		suite: 'source',
		lever:
			'LEDGER GATE SELF-DEMONSTRATION (round 4): as the derived twin — the gate ran with its own three assertions unledgered and caught them.',
		shippedConfig: true,
	},
	{
		logName: 'vr_ledgerStale_red_derived.log',
		suite: 'derived',
		lever:
			'LEDGER STALE-ENTRY PROBE (round 4): a fabricated entry for an assertion this suite does not run was added to the ledger; the stale-entry check caught it.',
		shippedConfig: true,
		optional: true,
	},
	{
		logName: 'vr_ledgerStale_red_source.log',
		suite: 'source',
		lever:
			'LEDGER STALE-ENTRY PROBE (round 4): as the derived twin — a fabricated ledger entry for an assertion this suite does not run was caught.',
		shippedConfig: true,
		optional: true,
	},
	{
		logName: 'vr_probeE.log',
		suite: 'derived',
		lever:
			'EXPECTATION PERTURBATION (round 3): inverted the ApplicationFeeAmountType definitionName comparison and the cross-family expected count, after both expressions were rewritten.',
		shippedConfig: false,
	},
	// ---- PHASE 4 (the synthetic tier) --------------------------------------------------------
	{
		logName: 'p4_probeExpect_synthetic.log',
		suite: 'synthetic',
		lever:
			"EXPECTATION PERTURBATION: every digit run inside the Phase 4 suite's single EXPECTED block incremented by one — which also corrupts the two collision-member sha12 prefixes, the prototype conflict table and the two alias namespace URNs — plus one entry dropped from the expected lost-element list. Perturbs ONLY the expectations; the production tier is untouched, and the RED levers read which member is which from production so they still run.",
		shippedConfig: false,
	},
	{
		logName: 'p4_probeWinner_synthetic.log',
		suite: 'synthetic',
		lever:
			"PRODUCTION MUTATION, SHIPPED CONFIGURATION: R-P3-1's conflict winner FLIPPED — the merged definition takes its content from the test-score member instead of the college-transcript member. One expression in lib/syntheticTier.js, nothing else touched.",
		shippedConfig: true,
	},
	{
		logName: 'p4_probeTier_synthetic.log',
		suite: 'synthetic',
		lever:
			"PRODUCTION MUTATION, SHIPPED CONFIGURATION: the 109 merged definition nodes stamped pescTier:'source' instead of 'synthetic' — the exact leak G4-F forbids, since the round-trip emitter reads that predicate and would re-emit a fabricated definition into a PESC file.",
		shippedConfig: true,
	},
	{
		logName: 'p4_probeAlias_synthetic.log',
		suite: 'synthetic',
		lever:
			"PRODUCTION MUTATION, SHIPPED CONFIGURATION: S-2's serving namespace repointed from CoreMain v1.8.0 to v1.19.1 — a substitution that still resolves all 129 names but is NOT the one that was ruled on. This probe also exposed a vacuity: three G4-E assertions compared the alias against the module's OWN constant and moved with it, and were rewritten against literals.",
		shippedConfig: true,
	},
	{
		logName: 'p4_probeContested_derived.log',
		suite: 'derived',
		lever:
			'EXPECTATION PERTURBATION (Phase 4): the RESTATED G3-D constants inverted — computed-resolution count expected at 1 rather than 0, the decided-resolution total moved off 201, the 195/6 split moved off, and the planted-edge count moved off 1.',
		shippedConfig: false,
	},
	{
		logName: 'p4_probeSyntheticCensus_source.log',
		suite: 'source',
		lever:
			"EXPECTATION PERTURBATION (Phase 4): the restated synthetic-tier census constant moved off 110, so the source suite's view of Phase 4's emission is wrong by one node.",
		shippedConfig: false,
	},
	{
		logName: 'p4_ledgerGate_red_synthetic.log',
		suite: 'synthetic',
		lever:
			"LEDGER GATE SELF-DEMONSTRATION (Phase 4): the new suite's ledger gate ran with its own three assertions absent from the ledger, so an assertion genuinely lacked red evidence and the gate caught it. As in the derived and source twins, the gate adds its own labels to the shipped set BEFORE comparing, so it cannot exempt itself.",
		shippedConfig: true,
		optional: true,
	},
	{
		logName: 'p4_ledgerStale_red_synthetic.log',
		suite: 'synthetic',
		lever:
			'LEDGER STALE-ENTRY PROBE (Phase 4): a fabricated entry for an assertion this suite does not run was added to the ledger; the stale-entry check caught it. Needed separately because the self-demonstration run above leaves no stale entries and that assertion stays green there.',
		shippedConfig: true,
		optional: true,
	},
];

// Phase 4 moved the shipped runs forward: the source and derived label sets CHANGED (G3-D restated
// around the synthetic resolutions; the source tier census restated off "synthetic is empty"), so
// a ledger built against the Phase 3 shipped logs would carry stale entries and miss new ones.
const SHIPPED_RUNS = {
	derived: 'p4_shipped_derived.log',
	source: 'p4_shipped_source.log',
	synthetic: 'p4_ledgerGate_red_synthetic.log',
};

const readLabels = (logName, kinds, allowMissing) => {
	const fullPath = path.join(ARTIFACT_DIR, logName);
	if (!fs.existsSync(fullPath)) {
		if (allowMissing) {
			return [];
		}
		throw new Error(`ledger builder REFUSES: retained log '${logName}' is missing — the ledger would understate the evidence.`);
	}
	const found = [];
	fs.readFileSync(fullPath, 'utf8')
		.split('\n')
		.forEach((oneLine) => {
			const matched = /^\s*(ok|FAIL)\s+(.*?)\s*$/.exec(oneLine);
			if (matched && kinds.indexOf(matched[1]) !== -1) {
				found.push(matched[2]);
			}
		});
	return found;
};

const buildSuiteLedger = (suiteName) => {
	const shippedLabels = [...new Set(readLabels(SHIPPED_RUNS[suiteName], ['ok', 'FAIL']))];

	// label -> list of evidence entries
	const evidenceByLabel = {};
	EVIDENCE_SOURCES.filter((oneSource) => oneSource.suite === suiteName).forEach((oneSource) => {
		readLabels(oneSource.logName, ['FAIL'], oneSource.optional === true).forEach((oneLabel) => {
			(evidenceByLabel[oneLabel] = evidenceByLabel[oneLabel] || []).push({
				probeLog: oneSource.logName,
				lever: oneSource.lever,
				shippedConfig: oneSource.shippedConfig,
				...(oneSource.caveat ? { caveat: oneSource.caveat } : {}),
			});
		});
	});

	const assertions = shippedLabels.sort().map((oneLabel) => {
		const evidence = evidenceByLabel[oneLabel];
		if (evidence !== undefined) {
			return { label: oneLabel, status: 'proven', redEvidence: evidence };
		}
		// ---- triage of the residue ----
		// A "RED:" / "RED-1" / "RED-2" / "CONTROL" assertion's own CONTENT is a red demonstration:
		// it asserts that some lever successfully produced a detectable failure. Showing IT failing
		// requires breaking the detector itself, which nobody has done. Honest bucket: (b).
		const selfDemonstrating = /\bRED\b|\bRED-[12]\b|\bCONTROL\b/.test(oneLabel);
		if (selfDemonstrating) {
			return {
				label: oneLabel,
				status: 'genuineGap',
				species: 'selfDemonstratingRedCheck',
				note:
					'This assertion\'s content IS a red demonstration — it asserts a lever produced a detectable failure. Observing IT fail requires breaking the detector it guards, which no probe has done. Counted in bucket (b) deliberately rather than waved through.',
			};
		}
		if (suiteName === 'synthetic') {
			// Phase 4 is the first suite built WITH the ledger discipline in force, so an unevidenced
			// assertion here has no predecessor to inherit doubt from and no lost receipts to plead:
			// it is simply a claim nobody has watched fail. Named as such.
			return {
				label: oneLabel,
				status: 'genuineGap',
				species: 'phase4Unevidenced',
				note:
					'No retained log records this assertion FAILING. Phase 4 pulled six levers (expectation perturbation, winner flip, tier leak, alias repoint, and the two restatement probes in the sibling suites); this assertion went red under none of them. It is a genuine gap, counted rather than waved through, and Phase 6 owns closing it.',
			};
		}
		if (suiteName === 'source') {
			return {
				label: oneLabel,
				status: 'recordsGap',
				note:
					'UNVERIFIABLE BUT BELIEVED. DEVLOG records "PHASE 2: CLOSED — 47/47 gates, all RED-first", and Phase 2 was independently reviewed and committed green at b02168b. The red receipts for that run were not retained. Do NOT re-run; hand to Phase 6.',
			};
		}
		// derived suite, pre-existing (the dead predecessor's Phase 3 work)
		return {
			label: oneLabel,
			status: 'genuineGap',
			species: 'predecessorClaimNotAdmissible',
			note:
				'The suite header CLAIMS "Every gate demonstrates RED first", but its author is the agent whose G3-F gate passed for the wrong reason and whose G3-D/G3-F RED levers were broken. That author\'s unwitnessed claim is not admissible evidence, so this is triaged as a GENUINE gap rather than a records gap. Several of these DO have a "RED (demonstrated)" evidence line in vr_baseline_derived.log showing the LEVER fired — that is partial, and is not the assertion being observed to fail.',
		};
	});

	return assertions;
};

const derivedAssertions = buildSuiteLedger('derived');
const sourceAssertions = buildSuiteLedger('source');
const syntheticAssertions = buildSuiteLedger('synthetic');

const tally = (assertions) => {
	const counts = { proven: 0, recordsGap: 0, genuineGap: 0 };
	assertions.forEach((oneAssertion) => {
		counts[oneAssertion.status]++;
	});
	return counts;
};

const ledger = {
	purpose:
		'Maps every SHIPPED assertion label in the pesc260805 suites to its red evidence: the retained log that recorded it FAILING and the LEVER that produced that red. Built by VELVET_RIVER at the close of Phase 3 on VELVET_COMPASS\'s order, after the third adversarial review observed that 34 of 66 derived assertions had no retained red receipt. An unevidenced claim decays into an assumed one; this file makes the gap a number that can only go down.',
	statuses: {
		proven: 'Observed FAILING in a retained log. redEvidence names the log, the lever, and whether the probe ran in the SHIPPED configuration.',
		recordsGap: 'Believed proven red in a run whose log was not retained. Cited, marked unverifiable-but-believed. Do NOT re-run these — Phase 6 mutation suite owns them.',
		genuineGap: 'Never demonstrated able to fail, by anyone. This is the real number. Phase 6 owns closing it. Do NOT close it here.',
	},
	shippedConfigurationNote:
		'A red obtained under a configuration that is not shipped proves nothing about what IS shipped. Learned the hard way: the GAP 1 assertions were originally red-proven by vr_probeB.log, which had also reverted GAP 7, making the assertion vacuous in the shipped build. vr_probeC.log supersedes it. Every entry therefore records shippedConfig.',
	suites: {
		derived: {
			suiteFile: 'test/test-pesc260805DerivedTier.js',
			shippedRunLog: SHIPPED_RUNS.derived,
			counts: tally(derivedAssertions),
			assertions: derivedAssertions,
		},
		source: {
			suiteFile: 'test/test-pesc260805SourceTier.js',
			shippedRunLog: SHIPPED_RUNS.source,
			counts: tally(sourceAssertions),
			assertions: sourceAssertions,
		},
		synthetic: {
			suiteFile: 'test/test-pesc260805SyntheticTier.js',
			shippedRunLog: SHIPPED_RUNS.synthetic,
			counts: tally(syntheticAssertions),
			assertions: syntheticAssertions,
		},
	},
};

const outputPath = path.join(ARTIFACT_DIR, '..', 'redEvidenceLedger.json');
fs.writeFileSync(outputPath, `${JSON.stringify(ledger, null, '\t')}\n`);

console.log(`wrote ${outputPath}`);
console.log(`derived: ${JSON.stringify(ledger.suites.derived.counts)}  (total ${derivedAssertions.length})`);
console.log(`source : ${JSON.stringify(ledger.suites.source.counts)}  (total ${sourceAssertions.length})`);
console.log(`synth  : ${JSON.stringify(ledger.suites.synthetic.counts)}  (total ${syntheticAssertions.length})`);
console.log('\ngenuineGap breakdown (derived):');
const bySpecies = {};
derivedAssertions
	.filter((oneAssertion) => oneAssertion.status === 'genuineGap')
	.forEach((oneAssertion) => {
		bySpecies[oneAssertion.species] = (bySpecies[oneAssertion.species] || 0) + 1;
	});
Object.keys(bySpecies).forEach((oneSpecies) => console.log(`   ${bySpecies[oneSpecies]}  ${oneSpecies}`));
