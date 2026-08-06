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
	// ---- PHASE 4.6a REVIEW-REMEDIATION levers (session MYSTIC_PORTAL, round 2) ---------------
	{
		logName: 'mp_r2redProbeA_perturbedExpected.log',
		suite: 'synthetic',
		lever:
			'EXPECTATION PERTURBATION (Phase 4.6a remediation): every Phase 4.6a pin incremented by one inside the single EXPECTED block, including the pins ADDED at remediation — the acceptance-1 population (75 merged definitions with branch children), the GAP 2 empty-render census in BOTH referrer scopes (96/30 and 94/29), the GAP 3 content-decided count, and the revised disposition table. Supersedes mp_redProbeA for every label the remediation renamed or re-formed. Perturbs ONLY expectations; production is untouched.',
		shippedConfig: false,
	},
	{
		logName: 'mp_r2redProbeB_annotationLeak.log',
		suite: 'synthetic',
		lever:
			"PRODUCTION MUTATION, SHIPPED CONFIGURATION (Phase 4.6a remediation): the derived-annotation strip disabled again, against the REMEDIATED code, so the tier-leakage assertions carry a receipt from the suite as it now stands rather than as it stood before the rebuild. Reverts exactly one thing. Reddens the two G4-G derived-regeneration assertions as well, which is how it demonstrates the leak was load-bearing there too.",
		shippedConfig: true,
	},
	{
		logName: 'mp_r2redProbeC_noChildren.log',
		suite: 'synthetic',
		lever:
			"PRODUCTION MUTATION, SHIPPED CONFIGURATION (Phase 4.6a remediation): the child union truncated to empty. Against the REMEDIATED code this no longer reaches the suite at all — the acceptance criterion is now enforced IN PRODUCTION, so the build REFUSES by name, enumerating all 75 merged definitions that would render empty. It therefore supplies NO label-level evidence and the ledger takes none from it. It is retained because it demonstrates something the suite cannot: that the criterion the vacuous gate failed to assert now stops a build rather than merely failing a test.",
		shippedConfig: true,
		optional: true,
	},
	{
		logName: 'mp_r2redProbeH_statsNodeDivergence.log',
		suite: 'synthetic',
		lever:
			"PRODUCTION MUTATION, SHIPPED CONFIGURATION (Phase 4.6a remediation): the STATS accumulator for collegeContributedChildElements offset by three, reproducing a divergence that actually shipped for one build — the contribution count is published TWICE, on every merged node and in stats, by two separate accumulators, and a fix applied to one and not the other made the build report 36 where the graph said 33. Nothing failed at the time because the only stats use of that figure was an upper bound, and a number used only as a loose bound is not being checked. Reverts exactly one thing.",
		shippedConfig: true,
	},
	// ---- PHASE 4.6a levers, first round ------------------------------------------------------
	{
		logName: 'mp_redProbeA_perturbedExpected.log',
		suite: 'synthetic',
		lever:
			"EXPECTATION PERTURBATION (Phase 4.6a): every count this phase introduced or moved, incremented by one inside the single EXPECTED block — the child union 522, winner-takes-all 520, losing-branch contributions 2, both-branch names 235, the bothBranchesAgree disposition, the contributed classification 35/33/2, absent-after-union 0, the two residue edge counts 5 and 38, the PersonType exemplar 18, and the two synthetic census sums. Perturbs ONLY expectations; the production tier is untouched.",
		shippedConfig: false,
	},
	{
		logName: 'mp_redProbeB_annotationLeak.log',
		suite: 'synthetic',
		lever:
			"PRODUCTION MUTATION, SHIPPED CONFIGURATION (Phase 4.6a): the derived-annotation strip in duplicateChildOntoMergedDefinition disabled, so S-1c's bulk property copy carries derived annotations onto synthetic children. This is not a hypothetical — it is the REAL defect the first build of this phase shipped, discovered because it moved Gate 3's regeneration compare from 14,600,360 to 14,694,411 canonical bytes and pushed the held-reference census from 201 to 335. The lever reverts exactly one thing: the strip.",
		shippedConfig: true,
	},
	{
		logName: 'mp_redProbeC_noChildren.log',
		suite: 'synthetic',
		lever:
			"PRODUCTION MUTATION, SHIPPED CONFIGURATION (Phase 4.6a): the child union truncated to empty immediately after it is computed, reproducing the PRE-4.6a shape in which merged definitions carry no children at all. Reverts exactly one thing. This lever ABORTS after its first FAIL — with no children the G4-A re-parent probe finds no S-1c node to orphan — so it supplies label evidence for the re-stated parentage assertion and nothing after it. That is why the expectation perturbation is retained alongside it rather than instead of it.",
		shippedConfig: true,
	},
	{
		logName: 'mp_redProbeE_perturbedDeltaPins.log',
		suite: 'synthetic',
		lever:
			'EXPECTATION PERTURBATION (Phase 4.6a, round 2): the four inherited delta pins incremented by one — MERGED_FROM 140, and the signature-level absent 2 / rebound 5 / widened 1. Separated from round A deliberately: these pins are Phase 4 claims this phase must leave standing, so a lever that moves them proves they are still load-bearing after the union landed.',
		shippedConfig: false,
	},
	{
		logName: 'mp_redProbeF_childrenStampedSource.log',
		suite: 'synthetic',
		lever:
			"PRODUCTION MUTATION, SHIPPED CONFIGURATION (Phase 4.6a): duplicated children stamped pescTier:'source' at emission — the tier leak that would put fabricated element declarations into the source projection Phase 5's emitter reads. Reverts exactly one thing. Aborts inside the G4.6a block, so its label evidence covers the assertions ahead of that point.",
		shippedConfig: true,
	},
	{
		logName: 'mp_redProbeG_sourcePin.log',
		suite: 'source',
		lever:
			'EXPECTATION PERTURBATION (Phase 4.6a): the census pin for the synthetic tier, as held in the SOURCE suite, incremented by one (109 + 522 + 1 -> 109 + 523 + 1). The pin exists in BOTH suites on purpose — a census only one suite can see is one edit away from being unwatched — so it is red-proven in both.',
		shippedConfig: false,
	},
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
	// PHASE 4.6a: the source and synthetic suites both gained and re-stated assertions, so their
	// shipped label sets moved. The derived suite is untouched by this phase and keeps its run.
	// updated again at the review remediation: the synthetic suite's label set moved when the
	// vacuous acceptance gate was rebuilt, the SUBSET gate was re-formed on set membership, the
	// SHORTFALL conjunction was split, and GAP 2/3/5/7 assertions were added.
	source: 'mp_r2_shipped_source.log',
	synthetic: 'mp_r2_shipped_synthetic.log',
};

// RETIRED ASSERTIONS — recorded rather than allowed to vanish (supervisor condition, Phase 4.6a).
// When a phase legitimately reverses what an assertion claims, the assertion is RE-STATED and its
// predecessor's red evidence is RETIRED WITH IT. Saying so keeps the residue accounting honest in
// both directions: the old receipt is not lost, and — crucially — it does NOT transfer to the new
// claim. An assertion carrying a predecessor's receipt is how this campaign's genuine-gap residue
// was created in the first place.
const RETIRED_ASSERTIONS = [
	{
		label:
			'G4.6a the merged targets render their children directly — no reached target that has children renders empty',
		retiredAtPhase: '4.6a (independent review remediation)',
		reason:
			'STRUCTURALLY VACUOUS, and its ledger row LAUNDERED that. The filter demanded a target have ZERO HAS_PROPERTY children AND have child records — mutually exclusive by construction, so the set was empty for any input and the gate asserted nothing while printing a reassuring zero. Thirty of ninety-six reached targets do render empty. It also used the forbidden `|| 0` silent default in the same expression. Its receipt was mp_redProbeA, an expectation perturbation that reddened only its OTHER conjunct (the PersonType pin), so a half-proven conjunction was recorded whole. Replaced by three separately-labelled assertions — the acceptance criterion measured over branch-children versus own-children, the GAP 2 empty-render census, and the PersonType exemplar on its own label — each with its own lever. The criterion is ALSO now enforced in production, so a violation refuses the build rather than failing a test.',
		precedent: 'R-P4-7, which found the same species: a gate walking a set that cannot be non-empty.',
	},
	{
		label:
			'G4-C the rebound+widened entries are a SUBSET of the college contributions, not additional to them',
		retiredAtPhase: '4.6a (independent review remediation)',
		reason:
			'CARDINALITY-ONLY (6===6 && 6<33), which two entirely disjoint sets would satisfy. The claim was verified true in fact, so only the gate was weak. Re-formed on SET MEMBERSHIP by (owning type, child name), with a lever that swaps one member for a name in neither set — leaving cardinality identical, so the predecessor form would still have passed.',
	},
	{
		label:
			'G4.6a SHORTFALL RED: removing ONE branch contribution shortens the union by EXACTLY one, and the contribution count follows it',
		retiredAtPhase: '4.6a (independent review remediation)',
		reason:
			'A conjunction of two independent claims whose retained receipt reddened only the second. Split into two labelled assertions, and given a second lever that removes a WINNING-branch child — moving the delta claim while leaving the contribution claim untouched, so each is evidenced independently rather than jointly asserted.',
	},
	{
		label:
			'G4-A the merged node holds NO CHILD NODES and its contentFromStableId still reaches the changed source element',
		retiredAtPhase: '4.6a',
		reason:
			'R-P4-3 ORDERED the "holds no child nodes" half reversed: merged definitions must carry their children directly. The assertion bundled two claims, so it was SPLIT rather than deleted — the contentFromStableId half is asserted verbatim under its own label, and the no-children half becomes its positive form "the merged nodes hold EXACTLY their union of children". Neither successor inherits this receipt: the retired red proof demonstrated that a node could be made to HOLD children, which is now the expected state and proves nothing about either new claim. Both successors were demonstrated red on their own levers (mp_redProbeC_noChildren.log and mp_redProbeA_perturbedExpected.log).',
		precedent:
			'G3-D was RE-STATED, not deleted, when Phase 4 legitimately changed what it asserted about RESOLVES_TO into the contested namespace.',
	},
	{
		label: 'G4-F the synthetic tier emits exactly 110 nodes and 549 edges',
		retiredAtPhase: '4.6a',
		reason:
			'Census pin moved by R-P4-3: 110 -> 632 nodes (+522 duplicated child declarations) and 549 -> 1114 edges (+522 HAS_PROPERTY, +38 HAS_RESTRICTION, +5 HAS_SUPPORT). Re-stated with the new figures written as sums so a future drift names WHICH part moved. Red-proven afresh by mp_redProbeA_perturbedExpected.log.',
	},
	{
		label:
			'INTEGRATION synthetic tier is EXACTLY 110 nodes (109 S-1 merged definitions + 1 S-2 alias namespace)',
		retiredAtPhase: '4.6a',
		reason:
			'The same census pin in the source suite, restated to 632. Red-proven afresh by mp_redProbeG_sourcePin.log. This pin had already been re-stated once, at Phase 4, from "synthetic tier is EMPTY until Phase 4 emits it".',
	},
	{
		label:
			'G4-C the merged nodes publish the delta themselves and agree with the report in all four buckets',
		retiredAtPhase: '4.6a',
		reason:
			'LABEL SURVIVES, CONTENT CHANGED. R-P4-11 retired the one-sided "added" bucket in favour of "contributed", which names the contributing branch and carries both directions, and R-P4-10 zeroed "absent" because the union now carries every loser-only name. The label is unchanged, so the ledger would have carried the old receipt forward silently; it is listed here so the substitution is visible. Red-proven afresh by mp_redProbeA_perturbedExpected.log and mp_redProbeE_perturbedDeltaPins.log.',
	},
];

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
	retiredAssertionsNote:
		'Assertions a later phase legitimately reversed or re-stated, kept here so the residue accounting stays honest in BOTH directions. A retired assertion is not deleted and its red evidence is not lost — but it also does NOT transfer to whatever replaced it. An assertion carrying a predecessor receipt is how the genuine-gap residue was created in the first place, so each entry names the successors and the levers that proved them afresh.',
	retiredAssertions: RETIRED_ASSERTIONS,
	conjunctionEvidenceNote:
		'A METHOD GAP THIS LEDGER CANNOT CURRENTLY CLOSE, recorded at the Phase 4.6a independent ' +
		'review. Evidence is keyed to an assertion LABEL: a label appears in a retained log as FAILING ' +
		'and the row is marked "proven". But a conjunction fails when ANY conjunct fails, so such a ' +
		'receipt proves only that SOME conjunct can fail — never that every conjunct can. A label is ' +
		'therefore the wrong granularity for a claim with several independent parts, and this is the ' +
		'inherited-receipt pattern arriving through a CONJUNCTION rather than through a rename. ' +
		'THE MEASUREMENT IS IN conjunctionEvidenceMeasurement BELOW, computed at ledger-build time by ' +
		'test/probes/mp_auditConjunctiveAssertions.js and never transcribed into this prose. It was ' +
		'transcribed once, and this note published 229/75/8 while the auditor already reported ' +
		'232/78/11 — a hand-copied figure in a document is a figure that goes quietly wrong, and ' +
		'Phase 6 would have inherited the stale one as its brief. Two instances were found and fixed at this ' +
		'remediation (the acceptance-1 gate and the SHORTFALL assertion); the remaining rows are ' +
		'REPORTED, NOT SILENTLY RECLASSIFIED, because deciding which are genuinely under-evidenced ' +
		'requires reading each lever against each conjunct. Closing the class needs one assertion per ' +
		'claim, or a lever per conjunct, or a ledger that records evidence per CONJUNCT rather than ' +
		'per label. That is a specification change and it belongs to whoever owns the ledger, not to a ' +
		'phase builder patching his own rows.',
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

// ---- the conjunction figures are READ from the auditor, never copied ------------------------
// The shipped ledger published 229/75/8 while the auditor already reported 232/78/11, and Phase 6
// would have inherited the stale number as its brief. A figure transcribed by hand into a document
// is a figure that will go quietly wrong; this one is computed.
//
// Run AFTER the first write and with the module cache dropped, because the audit classifies rows by
// the STATUS this build just produced. Auditing the previous ledger would answer a question about
// a file that no longer exists.
delete require.cache[require.resolve(outputPath)];
delete require.cache[require.resolve(path.join(__dirname, 'probes', 'mp_auditConjunctiveAssertions.js'))];
const { auditConjunctiveAssertions } = require(
	path.join(__dirname, 'probes', 'mp_auditConjunctiveAssertions.js'),
);
const conjunctionAudit = auditConjunctiveAssertions();
ledger.conjunctionEvidenceMeasurement = {
	measuredBy: 'test/probes/mp_auditConjunctiveAssertions.js',
	shippedAssertions: conjunctionAudit.totalShipped,
	carryingATopLevelConjunction: conjunctionAudit.totalConjunctive,
	provenWithThreeOrMoreConjuncts: conjunctionAudit.riskRows.length,
	labelsThatFailedToJoinTheLedger: conjunctionAudit.unjoinedLabels.length,
	unjoinedLabels: conjunctionAudit.unjoinedLabels,
	riskRows: conjunctionAudit.riskRows,
	note:
		'Computed at ledger-build time, never transcribed. labelsThatFailedToJoinTheLedger is the ' +
		'auditor reporting its OWN incompleteness: any nonzero value means the risk list understates ' +
		'the problem by that many rows, which is the fail-open behaviour the audit was corrected for.',
};
fs.writeFileSync(outputPath, `${JSON.stringify(ledger, null, '\t')}\n`);
console.log(
	`\nconjunction audit (computed, not copied): ${conjunctionAudit.totalShipped} shipped, ` +
		`${conjunctionAudit.totalConjunctive} conjunctive, ${conjunctionAudit.riskRows.length} proven with 3+ conjuncts, ` +
		`${conjunctionAudit.unjoinedLabels.length} failed to join`,
);

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
