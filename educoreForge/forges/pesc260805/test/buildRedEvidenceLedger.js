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
	// ---- PHASE 4 REMEDIATION (the review's [G-3], [G-4] and the R-P4-5/6/7 rebuild) -----------
	{
		logName: 'p4r_probeComputedContested_derived.log',
		suite: 'derived',
		lever:
			"PRODUCTION MUTATION, SHIPPED CONFIGURATION: the contested-namespace branch of resolveOneReference now ALSO emits the structural RESOLVES_TO edge the quarantine exists to withhold — the half-applied quarantine. The recording is left exactly as shipped, so every census of RECORDED entries stays green and only the 'resolved by COMPUTATION' assertions can notice. One branch in lib/derivedTier.js; the probe script asserts by name that the contested CHECK, the one-symbol-space refusal, the per-node ambiguity accumulation and the absent-namespace refusal all remain intact. This SUPERSEDES p4_probeContested_derived.log (expectation perturbation) as the evidence for the restated G3-D assertions: that probe proved they read the observation, this one proves they resist a real defect.",
		shippedConfig: true,
		note:
			"A FIRST ATTEMPT IS RECORDED IN THE PROBE SCRIPT AND IS A FINDING: neutralising the contested-namespace CHECK outright does NOT reach G3-D. The build refuses earlier at the one-symbol-space guard ('AcRec:HighSchoolType matches 2 definitions'), because the 31 shared names make that guard fire first. The quarantine is not the only thing standing between this corpus and a computed contested resolution — but that also means deleting it produces no graph, and so cannot exercise the assertion.",
	},
	{
		logName: 'p4r_probeUnscopedDefinitions_derived.log',
		suite: 'derived',
		lever:
			"HARNESS MUTATION, RE-PROOF AFTER RESCOPING ([G-4]): the Phase 4 narrowing of namedDefinitionNodes is REVERTED — the helper stops excluding the 109 synthetic merged definitions, exactly as it read before Phase 4. Run against the code as it now stands, so the receipt points at THIS build rather than at a Phase 3 vr_* run of different code.",
		shippedConfig: true,
	},
	{
		logName: 'p4r_probeUnscopedStrip_derived.log',
		suite: 'derived',
		lever:
			"HARNESS MUTATION, RE-PROOF AFTER RESCOPING ([G-4]): the Phase 4 narrowing of stripDerived is REVERTED — the strip stops removing synthetic nodes, so the regeneration input carries DECIDED definitions.",
		shippedConfig: true,
		optional: true,
		abortsRatherThanFails: true,
		note:
			"This lever ABORTS the suite instead of reporting a FAIL: the derived tier's production purity guard refuses the synthetic input by name ('input carries synthetic-tier node … a decided definition must never seed a computation') and the throw propagates. The narrowing is therefore demonstrably load-bearing, but the log supplies no label-level evidence and the ledger takes none from it.",
	},
	{
		logName: 'p4r_probeExpectDelta_synthetic.log',
		suite: 'synthetic',
		lever:
			'EXPECTATION PERTURBATION: the four new R-P4-5/R-P4-6 delta constants (absent 2, rebound 5, widened 1, added 33) each moved by one. Proves the rebuilt G4-C assertions read the observation; NOT a shipped-configuration probe.',
		shippedConfig: false,
	},
	{
		logName: 'p4r_probeNameOnlyDelta_synthetic.log',
		suite: 'synthetic',
		lever:
			"PRODUCTION MUTATION, SHIPPED CONFIGURATION — THE R-P4-7 LEVER: the merge's dropped-entry comparison reverts from SIGNATURE-based to NAME-based, which IS the pre-R-P4-5 record that misled. Under it the five REBOUND and the one WIDENED entry vanish from the record entirely, because their NAMES are present in the winning member. The PREDECESSOR gate was green under exactly this behaviour — it could not be otherwise, since this behaviour was what it measured. The rebuilt gate goes red on six assertions. This is the demonstration that G4-C can now fail.",
		shippedConfig: true,
	},
	{
		logName: 'p4r_probeUnpublishedDelta_synthetic.log',
		suite: 'synthetic',
		lever:
			'PRODUCTION MUTATION, SHIPPED CONFIGURATION: the merged node stops PUBLISHING its delta (the report still computes it) — the "it is in the report, surely that is enough" defect.',
		shippedConfig: true,
		optional: true,
		abortsRatherThanFails: true,
		note:
			"This lever ABORTS rather than reporting a FAIL, by design: G4-C reads the delta properties with a presence check that THROWS a HARNESS FAULT when they are missing, because an absent property must never read as a zero. The defect is caught loudly and the log records it, but it supplies no label-level evidence and the ledger takes none from it.",
	},
	{
		logName: 'p4r_ledgerGate_red_synthetic.log',
		suite: 'synthetic',
		lever:
			"LEDGER GATE SELF-DEMONSTRATION (Phase 4 remediation): the rebuilt G4-C's fourteen new assertions and the two restated G4-A ones ran with no ledger entries at all, so assertions genuinely lacked red evidence and the gate caught it — together with the five stale entries left by the retired name-only loss assertions.",
		shippedConfig: true,
		optional: true,
	},
];

// ASSERTIONS WHOSE RED EVIDENCE MUST POST-DATE THE PHASE 4 RESCOPING ([G-4]).
// Phase 4 narrowed four harness helpers — namedDefinitionNodes and stripDerived gained a pescTier
// filter, assertPristineSourceGraph gained a synthetic clause, and the G3-E BFS inherited the
// narrowed definition set. Any assertion that reads through one of them and cites ONLY a Phase 3
// vr_* log is holding a receipt for a run of DIFFERENT CODE. This list names them; the ledger
// marks each one's provenance so the distinction is a visible field rather than an assumption.
const PHASE4_LOG_PREFIXES = ['p4_', 'p4r_'];
const RESCOPED_HELPER_DEPENDENTS = [
	{ helper: 'namedDefinitionNodes', labelMatch: /^G3-E GAP4: reachableFromLatestRoot/ },
	{ helper: 'namedDefinitionNodes', labelMatch: /^G3-E GAP4: the harness derives the SAME message-root set/ },
	{ helper: 'namedDefinitionNodes + the G3-E BFS', labelMatch: /^G3-E independent BFS reproduces/ },
	{ helper: 'namedDefinitionNodes + the G3-E BFS', labelMatch: /^G3-E RED: the independent BFS/ },
	{ helper: 'namedDefinitionNodes', labelMatch: /^G3-E the financial-aid orphan/ },
	{ helper: 'namedDefinitionNodes', labelMatch: /^G3-E GAP4: production stats agree/ },
	{ helper: 'stripDerived', labelMatch: /^G3-A / },
	{ helper: 'stripDerived + assertPristineSourceGraph', labelMatch: /^G3-D RED-2/ },
	{ helper: 'assertPristineSourceGraph', labelMatch: /^G3-F / },
];

// Phase 4 moved the shipped runs forward: the source and derived label sets CHANGED (G3-D restated
// around the synthetic resolutions; the source tier census restated off "synthetic is empty"), so
// a ledger built against the Phase 3 shipped logs would carry stale entries and miss new ones.
// PHASE 4 REMEDIATION moved them forward again: G4-C was rebuilt against signatures (R-P4-7) and
// two G4-A assertions were restated, so the synthetic label set CHANGED and the Phase 4 shipped log
// would now carry five stale entries and miss sixteen.
const SHIPPED_RUNS = {
	derived: 'p4r_shipped_derived.log',
	source: 'p4r_shipped_source.log',
	synthetic: 'p4r_ledgerGate_red_synthetic.log',
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
		// [G-4] PROVENANCE. If this assertion reads through a helper Phase 4 narrowed, say whether
		// its evidence was obtained BEFORE or AFTER the narrowing. A pre-rescoping-only receipt is
		// not deleted (the lever really did fire, once) — it is LABELLED, so nobody mistakes it for
		// a demonstration about the code that ships now.
		const rescopedDependency = RESCOPED_HELPER_DEPENDENTS.find((oneDependency) =>
			oneDependency.labelMatch.test(oneLabel),
		);
		const rescopingProvenance =
			rescopedDependency === undefined
				? {}
				: {
						rescopedHelper: rescopedDependency.helper,
						evidencePostDatesPhase4Rescoping: (evidence || []).some((oneEvidence) =>
							PHASE4_LOG_PREFIXES.some((onePrefix) => oneEvidence.probeLog.indexOf(onePrefix) === 0),
						),
					};
		if (evidence !== undefined) {
			return { label: oneLabel, status: 'proven', redEvidence: evidence, ...rescopingProvenance };
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
				...rescopingProvenance,
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
				...rescopingProvenance,
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
			...rescopingProvenance,
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
	rescopedHelperNote:
		'[G-4], Phase 4 review. Four harness helpers were NARROWED when the synthetic tier arrived (namedDefinitionNodes and stripDerived gained a pescTier filter, assertPristineSourceGraph gained a synthetic clause, and the G3-E BFS inherited the narrowed definition set), while assertions reading through them still cited Phase 3 vr_* logs — receipts for a run of DIFFERENT CODE. Every such assertion now carries rescopedHelper and evidencePostDatesPhase4Rescoping. Two re-proof levers were pulled against the code as it now stands: p4r_probeUnscopedDefinitions_derived.log (namedDefinitionNodes un-narrowed) and p4r_probeUnscopedStrip_derived.log (stripDerived un-narrowed, which ABORTS at the production purity refusal and therefore supplies no label-level evidence). Where evidencePostDatesPhase4Rescoping is false, the receipt is retained but explicitly labelled as pre-rescoping rather than silently carried forward.',
	rescopedHelperProvenance: {},
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

// the [G-4] rollup: how many rescoped-helper dependents hold a POST-rescoping receipt
const rescopedDependents = []
	.concat(derivedAssertions, sourceAssertions, syntheticAssertions)
	.filter((oneAssertion) => oneAssertion.rescopedHelper !== undefined);
ledger.rescopedHelperProvenance = {
	dependentAssertions: rescopedDependents.length,
	withPostRescopingEvidence: rescopedDependents.filter(
		(oneAssertion) => oneAssertion.evidencePostDatesPhase4Rescoping,
	).length,
	preRescopingEvidenceOnly: rescopedDependents
		.filter((oneAssertion) => !oneAssertion.evidencePostDatesPhase4Rescoping)
		.map((oneAssertion) => ({
			label: oneAssertion.label,
			rescopedHelper: oneAssertion.rescopedHelper,
			status: oneAssertion.status,
		})),
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
