#!/usr/bin/env node
'use strict';

// p7_expectationLeverSweep.js — Deliverable ZERO, the EXPECTATION-LEVER SWEEP (work order Phase 7).
//
// THE STANDING RULE THIS MEASURES, quoted from redEvidenceLedger.json's own evidenceApparatusScale
// block: "Every gate AND every production refusal must have at least one red lever that MUTATES
// PRODUCTION DATA — the input, the corpus, or the graph — and NOT only a test expectation."
//
// WHY THE RULE EXISTS, mechanically. An expectation lever reddens an assertion whether or not its
// predicate can ever be satisfied by real data, so it certifies a VACUOUS gate as proven. A data
// lever cannot pass a vacuous check, because a vacuous check does not respond to data at all.
// A row whose only receipt is an expectation perturbation therefore proves the assertion is
// WIRED UP, not that it is capable of catching a defect.
//
// WHY THIS INSTRUMENT EXISTS RATHER THAN THE NUMBER IT REPLACES. The ledger carries
// provenRowsRestingOnExpectationLeversAlone 63 of 114, measuredBy "the third independent
// adversarial review". That number was RECORDED, not COMPUTED — nothing recomputes it, so it
// cannot notice when the record moves underneath it, and it cannot disagree with the person who
// wrote it down. Phase 6.5's lesson, paid for in a full remediation round: AN INSTRUMENT THAT CAN
// DISAGREE WITH ITS AUTHOR IS THE ONLY KIND WORTH HAVING. This one recomputes from the ledger on
// every run and is free to return a figure nobody expected.
//
// THE CLASSIFICATION IS A DECLARED REGISTRY, NOT A SWITCH, and it REFUSES BY NAME on a lever whose
// opening token matches no declared class. That refusal is the whole safety property: silently
// binning an unrecognized lever as "expectation" would understate the sweep, and binning it as
// "data" would overstate it. There is no defensible guess, so it does not guess.
//
// Async style: this probe is synchronous file work end to end; no callbacks are required and none
// are invented. No async/await, no try/catch as control flow.

const fs = require('fs');
const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const LEDGER_PATH = path.join(__dirname, '..', 'redEvidenceLedger.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'test-artifacts', 'p7', 'p7ExpectationLeverSweep.json');

// =================================================================================================
// THE LEVER CLASS REGISTRY — data, in one place, greppable by name.
//
// `openingToken` is matched against the START of the lever prose. LONGEST TOKEN WINS, which is why
// 'PRODUCTION MUTATION, SHIPPED CONFIGURATION' must out-rank the bare 'PRODUCTION MUTATION' —
// prefix matching in declaration order would bin all 63 shipped-configuration levers under the
// 3-entry bare class and the sweep would still look plausible.
//
// `mutatesProductionData` is the ONLY property the sweep adjudicates on, and each entry states why
// it holds the value it holds, because that judgment is the substance of the measurement.
// =================================================================================================
/**
 * THE POLYMORPHIC SEAM OF THIS MODULE, DECLARED (polyArch2: a formally declared interface for every
 * polymorphic seam). Every registry entry is substitutable for every other at the one place that
 * consumes them, `classifyOneLever`, and adding a lever class must be an edit to DATA rather than to
 * control flow. Declaring the contract here is what makes that substitutability checkable instead of
 * conventional.
 *
 * @typedef {Object} LeverClassDescriptor
 * @property {string}  className    compound, greppable identifier for this class of red-evidence lever.
 * @property {string}  openingToken literal prefix matched against the START of the lever prose.
 *                                  LONGEST DECLARED TOKEN WINS — declaration order is NOT significant
 *                                  and must never be relied upon, which is why the matcher sorts by
 *                                  token length rather than taking the first hit.
 * @property {boolean} mutatesProductionData
 *                                  the ONLY property adjudicated on. True when the lever moves the
 *                                  input, the corpus, or the graph; false when it moves only a test
 *                                  expectation or the harness.
 * @property {string}  rationale    why this class holds that boolean. Required, because the judgment
 *                                  IS the measurement — an undefended classification would make the
 *                                  published figure an opinion wearing a number's clothes.
 */

/** @type {LeverClassDescriptor[]} */
const LEVER_CLASS_REGISTRY = [
	{
		className: 'productionMutationShippedConfiguration',
		openingToken: 'PRODUCTION MUTATION, SHIPPED CONFIGURATION',
		mutatesProductionData: true,
		rationale:
			'A defect is planted in production code and the probe runs against the SHIPPED recording ' +
			'configuration, so every census of recorded entries stays green and only assertions that ' +
			'compute from real data can notice. This is the strongest lever form in the ledger.',
	},
	{
		className: 'productionMutation',
		openingToken: 'PRODUCTION MUTATION',
		mutatesProductionData: true,
		rationale:
			'A defect is planted in production code or in the graph rows the reader delivers. The ' +
			'assertion must respond to real data to go red.',
	},
	{
		className: 'harnessMutation',
		openingToken: 'HARNESS MUTATION',
		mutatesProductionData: false,
		rationale:
			'The mutation lands in the TEST HARNESS, not in production code, the corpus or the graph. ' +
			'It proves the assertion is wired to the harness; it cannot prove the assertion would ' +
			'notice a defect in the thing being certified.',
	},
	{
		className: 'expectationPerturbation',
		openingToken: 'EXPECTATION PERTURBATION',
		mutatesProductionData: false,
		rationale:
			'Only the EXPECTED value in the test was moved. This reddens the assertion whether or not ' +
			'its predicate can ever be satisfied by real data — the exact mechanism by which a vacuous ' +
			'gate is certified proven.',
	},
	{
		className: 'ledgerGateSelfDemonstration',
		openingToken: 'LEDGER GATE SELF',
		mutatesProductionData: true,
		rationale:
			'THE LEDGER IS THIS GATE\'S PRODUCTION DATA. The ledger gate\'s job is to read ' +
			'redEvidenceLedger.json and refuse an unledgered assertion; a lever that removes a real ' +
			'entry moves exactly the input the gate consumes. Classifying this as an expectation lever ' +
			'would be a category error in the sweep\'s own favour — it would understate the evidence.',
	},
	{
		className: 'ledgerStaleEntryProbe',
		openingToken: 'LEDGER STALE',
		mutatesProductionData: true,
		rationale:
			'Same reasoning as the self-demonstration class: a FABRICATED ledger entry for an assertion ' +
			'the suite does not run is a mutation of the gate\'s input data, not of a test expectation.',
	},
	{
		className: 'inheritedBaseline',
		openingToken: 'INHERITED BASELINE',
		mutatesProductionData: false,
		rationale:
			'NOT A LEVER AT ALL. This records an OBSERVATION of a pre-existing broken tree run ' +
			'unmodified — nobody moved anything to produce the red. It is admissible as evidence that ' +
			'the assertion CAN fail, but it demonstrates no deliberate capability to detect a planted ' +
			'defect, so it cannot satisfy a rule about what a lever must mutate.',
	},
];

// =================================================================================================
// classifyOneLever — longest declared opening token wins; an unmatched lever is a REFUSAL.
// Returns { className, mutatesProductionData } or null when nothing matches.
// =================================================================================================
const classifyOneLever = (leverText) => {
	if (typeof leverText !== 'string' || leverText.trim() === '') {
		return null;
	}
	const matches = LEVER_CLASS_REGISTRY.filter((oneClass) =>
		leverText.startsWith(oneClass.openingToken),
	).sort((classA, classB) => classB.openingToken.length - classA.openingToken.length);
	return matches.length === 0 ? null : matches[0];
};

// =================================================================================================
// THE ACCEPT-CONTROL (standing rule, PHASE 7 AMENDMENT: a filter must be proven to FILTER, not
// merely to return nothing).
//
// This sweep's refusal list is empty against the live ledger. So would be the refusal list of a
// classifier that matched everything to the first registry entry, and so would be that of one that
// silently binned every unrecognized lever as expectation-only. All three produce an identical
// clean run. Planted specimens requiring DIFFERENT scores are the only way to tell them apart.
//
// The REJECT specimen is the load-bearing one: without a lever that MUST refuse, a classifier that
// never refuses looks exactly like a classifier with nothing to refuse.
// =================================================================================================
const SELF_TEST_SPECIMENS = [
	{
		specimenName: 'ACCEPT a shipped-configuration production mutation as a DATA lever',
		leverText: 'PRODUCTION MUTATION, SHIPPED CONFIGURATION: the 109 merged definitions ...',
		expectedClassName: 'productionMutationShippedConfiguration',
		expectedMutatesProductionData: true,
	},
	{
		specimenName: 'LONGEST TOKEN WINS — the bare class must not swallow the shipped-config class',
		leverText: 'PRODUCTION MUTATION (round 2): removed BOTH undeclared-name guards ...',
		expectedClassName: 'productionMutation',
		expectedMutatesProductionData: true,
	},
	{
		specimenName: 'ACCEPT an expectation perturbation as NOT a data lever',
		leverText: 'EXPECTATION PERTURBATION (round 2): perturbed the GAP 2 accounting ...',
		expectedClassName: 'expectationPerturbation',
		expectedMutatesProductionData: false,
	},
	{
		specimenName: 'ACCEPT an inherited baseline as NOT a lever',
		leverText: "INHERITED BASELINE. The dead predecessor's uncommitted tree ...",
		expectedClassName: 'inheritedBaseline',
		expectedMutatesProductionData: false,
	},
	{
		// THE REJECT CONTROL.
		specimenName: 'REFUSE a lever whose opening token is not declared',
		leverText: 'VIBES-BASED ASSURANCE: it looked right when I read it.',
		expectedClassName: null,
		expectedMutatesProductionData: null,
	},
];

const selfTestFailureOf = () => {
	const failures = [];
	SELF_TEST_SPECIMENS.forEach((oneSpecimen) => {
		const observed = classifyOneLever(oneSpecimen.leverText);
		const observedClassName = observed === null ? null : observed.className;
		const observedMutates = observed === null ? null : observed.mutatesProductionData;
		if (observedClassName !== oneSpecimen.expectedClassName) {
			failures.push(
				`${oneSpecimen.specimenName}: className ${JSON.stringify(observedClassName)} ` +
					`(expected ${JSON.stringify(oneSpecimen.expectedClassName)})`,
			);
			return;
		}
		if (observedMutates !== oneSpecimen.expectedMutatesProductionData) {
			failures.push(
				`${oneSpecimen.specimenName}: mutatesProductionData ${JSON.stringify(observedMutates)} ` +
					`(expected ${JSON.stringify(oneSpecimen.expectedMutatesProductionData)})`,
			);
		}
	});
	return failures.length === 0
		? ''
		: `${moduleName} self-test FAILED — the lever classifier does not behave as declared, so ` +
				`every figure it produces is unproven. ${failures.join(' | ')}`;
};

// =================================================================================================
// sweepTheLedger — recompute the apparatus-scale figures from the ledger itself.
// =================================================================================================
// =================================================================================================
// THE SWEEP IS TWO INDEPENDENT PASSES, AND THAT IS THE WHOLE POINT OF THIS SHAPE.
//
// THE VACUOUS VERSION THAT SHIPPED FIRST, recorded because the repair is meaningless without it. One
// pass incremented `provenRowsTotal` and then pushed the row into EXACTLY ONE of two arrays, so
// `dataLever.length + expectationOnly.length === provenRowsTotal` held BY CONSTRUCTION. The probe
// printed "CLOSES: 51 + 65 = 116" and there was no comparison and no failure branch anywhere in it.
// The independent reviewer demonstrated it empirically: with EVERY lever string doctored to
// "EXPECTATION PERTURBATION doctored" it still printed `CLOSES: 0 + 116 = 116`.
//
// THE AUTHOR HAD ALREADY FOUND THIS EXACT CLASS, hours earlier, in mp_auditConjunctiveAssertions.js
// — named it "a tautology wearing a measurement's clothes", fixed it properly there by counting both
// populations independently — AND DID NOT LOOK AT THIS SIBLING PROBE, written the same afternoon,
// carrying the same shape. **A fix feels like it discharges the whole class. The class is a PATTERN,
// not a location.** That is the lesson and it cost an independent review round.
//
// PASS 1 (census) counts `proven` rows and records their identity keys. It classifies nothing.
// PASS 2 (classification) walks the ledger AGAIN and records which keys it actually classified.
// The comparison of the two CAN DIVERGE: a row silently skipped in the classification pass — the
// fail-open shape this campaign keeps producing — makes the classified set smaller than the census,
// and the caller refuses. A partition cannot express that failure; two passes can.
// =================================================================================================

const rowKeyOf = (suiteName, label) => `${suiteName}::${label}`;

// PASS 1 — CENSUS ONLY. Deliberately does no classification and shares no code with pass 2.
const censusOfProvenRows = (ledger) => {
	const provenRowKeys = [];
	Object.keys(ledger.suites).forEach((oneSuiteName) => {
		ledger.suites[oneSuiteName].assertions.forEach((oneEntry) => {
			if (oneEntry.status === 'proven') {
				provenRowKeys.push(rowKeyOf(oneSuiteName, oneEntry.label));
			}
		});
	});
	return { provenRowKeys, provenRowCount: provenRowKeys.length };
};

// PASS 2 — CLASSIFICATION. Records every key it reaches so the caller can compare against the census.
const classifyProvenRows = (ledger) => {
	const unclassifiedLevers = [];
	const provenRestingOnExpectationLeversAlone = [];
	const provenCarryingADataLever = [];
	const classifiedRowKeys = [];
	const leverClassCounts = {};
	let provenRowsWithNoRedEvidence = 0;

	Object.keys(ledger.suites).forEach((oneSuiteName) => {
		ledger.suites[oneSuiteName].assertions.forEach((oneEntry) => {
			if (oneEntry.status !== 'proven') {
				return;
			}
			const oneRowKey = rowKeyOf(oneSuiteName, oneEntry.label);
			// A `proven` row with no redEvidence at all is a contradiction in the ledger's own terms —
			// `proven` MEANS "observed failing in a retained log". Counted separately rather than folded
			// into either bucket, because it is a different defect from a weak lever.
			if (!Array.isArray(oneEntry.redEvidence) || oneEntry.redEvidence.length === 0) {
				provenRowsWithNoRedEvidence += 1;
				provenRestingOnExpectationLeversAlone.push({
					suiteName: oneSuiteName,
					label: oneEntry.label,
					reason: 'status proven with NO redEvidence array at all',
				});
				classifiedRowKeys.push(oneRowKey);
				return;
			}
			let carriesADataLever = false;
			const classNamesOnThisRow = [];
			oneEntry.redEvidence.forEach((oneLever) => {
				const classified = classifyOneLever(oneLever.lever);
				if (classified === null) {
					unclassifiedLevers.push({
						suiteName: oneSuiteName,
						label: oneEntry.label,
						leverOpening: String(oneLever.lever).substring(0, 80),
					});
					return;
				}
				leverClassCounts[classified.className] = (leverClassCounts[classified.className] || 0) + 1;
				classNamesOnThisRow.push(classified.className);
				if (classified.mutatesProductionData) {
					carriesADataLever = true;
				}
			});
			if (carriesADataLever) {
				provenCarryingADataLever.push({ suiteName: oneSuiteName, label: oneEntry.label });
			} else {
				provenRestingOnExpectationLeversAlone.push({
					suiteName: oneSuiteName,
					label: oneEntry.label,
					reason: `every lever is non-mutating: ${[...new Set(classNamesOnThisRow)].join(', ')}`,
				});
			}
			classifiedRowKeys.push(oneRowKey);
		});
	});

	return {
		provenRestingOnExpectationLeversAlone,
		provenCarryingADataLever,
		classifiedRowKeys,
		leverClassCounts,
		unclassifiedLevers,
		provenRowsWithNoRedEvidence,
	};
};

const sweepTheLedger = (ledger) => {
	const census = censusOfProvenRows(ledger);
	const classified = classifyProvenRows(ledger);
	// THE FALSIFIABLE COMPARISONS. Neither holds by construction.
	const censusKeySet = new Set(census.provenRowKeys);
	const classifiedKeySet = new Set(classified.classifiedRowKeys);
	const inCensusNotClassified = [...censusKeySet].filter((oneKey) => !classifiedKeySet.has(oneKey));
	const inClassifiedNotCensus = [...classifiedKeySet].filter((oneKey) => !censusKeySet.has(oneKey));
	const bucketTotal =
		classified.provenCarryingADataLever.length +
		classified.provenRestingOnExpectationLeversAlone.length;
	// THE RE-STATED POPULATION MUST STAY VISIBLE. Once the 65 rows became `expectationLeverOnly` they
	// stopped being `proven`, so every figure above reports them as ZERO — which is correct and is
	// exactly how a residue disappears into a status rename. A backlog that shrinks without a per-item
	// disposition is indistinguishable from one that was truncated, so the population is counted here
	// and published beside the proven figures rather than left to be inferred from the ledger.
	const expectationLeverOnlyRows = [];
	Object.keys(ledger.suites).forEach((oneSuiteName) => {
		ledger.suites[oneSuiteName].assertions.forEach((oneEntry) => {
			if (oneEntry.status === 'expectationLeverOnly') {
				expectationLeverOnlyRows.push(rowKeyOf(oneSuiteName, oneEntry.label));
			}
		});
	});
	return {
		expectationLeverOnlyCount: expectationLeverOnlyRows.length,
		expectationLeverOnlyRows,
		provenRowsTotal: census.provenRowCount,
		classifiedRowCount: classified.classifiedRowKeys.length,
		bucketTotal,
		inCensusNotClassified,
		inClassifiedNotCensus,
		provenRowsWithNoRedEvidence: classified.provenRowsWithNoRedEvidence,
		provenCarryingADataLeverCount: classified.provenCarryingADataLever.length,
		provenRestingOnExpectationLeversAloneCount:
			classified.provenRestingOnExpectationLeversAlone.length,
		provenRestingOnExpectationLeversAlone: classified.provenRestingOnExpectationLeversAlone,
		leverClassCounts: classified.leverClassCounts,
		unclassifiedLevers: classified.unclassifiedLevers,
	};
};

const runSweep = () => {
	const selfTestFailure = selfTestFailureOf();
	if (selfTestFailure !== '') {
		return { selfTestFailure };
	}
	const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
	const swept = sweepTheLedger(ledger);
	// REFUSE BY NAME rather than publish a figure computed over levers the classifier did not
	// understand. A sweep that skipped what it could not read would understate itself silently.
	if (swept.unclassifiedLevers.length > 0) {
		return {
			refusal:
				`${moduleName}: ${swept.unclassifiedLevers.length} red-evidence lever(s) carry an opening ` +
				`token matching no class declared in LEVER_CLASS_REGISTRY, so they could not be judged ` +
				`data-mutating or expectation-only. Declare the class (with its rationale) or correct the ` +
				`lever prose; do NOT let the sweep guess. Unclassified: ` +
				swept.unclassifiedLevers
					.map((oneRow) => `[${oneRow.suiteName}] ${oneRow.label} :: ${oneRow.leverOpening}`)
					.join(' | '),
			swept,
		};
	}
	// THE RECONCILIATION REFUSAL — the branch the vacuous version did not have. Each of these three
	// CAN fail: a row the classification pass skipped, a row it invented, or a classified row that
	// reached neither bucket. None of them is expressible as a partition identity.
	const reconciliationFaults = [];
	if (swept.inCensusNotClassified.length > 0) {
		reconciliationFaults.push(
			`${swept.inCensusNotClassified.length} proven row(s) counted by the census were NEVER ` +
				`CLASSIFIED, so every figure below understates by that much: ` +
				swept.inCensusNotClassified.join(' | '),
		);
	}
	if (swept.inClassifiedNotCensus.length > 0) {
		reconciliationFaults.push(
			`${swept.inClassifiedNotCensus.length} classified row(s) are absent from the census — the ` +
				`classification pass reached a row the census does not consider proven: ` +
				swept.inClassifiedNotCensus.join(' | '),
		);
	}
	if (swept.bucketTotal !== swept.classifiedRowCount) {
		reconciliationFaults.push(
			`${swept.classifiedRowCount} row(s) were classified but only ${swept.bucketTotal} landed in a ` +
				`bucket — ${swept.classifiedRowCount - swept.bucketTotal} fell through both.`,
		);
	}
	if (reconciliationFaults.length > 0) {
		return {
			refusal:
				`${moduleName}: THE SWEEP DOES NOT RECONCILE and its figures are unpublishable. ` +
				reconciliationFaults.join('  ALSO: '),
			swept,
		};
	}
	return { swept };
};

module.exports = { runSweep, classifyOneLever, LEVER_CLASS_REGISTRY };

if (require.main === module) {
	const outcome = runSweep();
	if (outcome.selfTestFailure) {
		console.error(`\n${outcome.selfTestFailure}`);
		process.exit(1);
	}
	console.log(
		`classifier self-test: ${SELF_TEST_SPECIMENS.length}/${SELF_TEST_SPECIMENS.length} specimens ` +
			`scored as declared (including one longest-token-wins control and one REFUSE control).\n`,
	);
	if (outcome.refusal) {
		console.error(outcome.refusal);
		process.exit(1);
	}
	const swept = outcome.swept;
	console.log('=== LEVER CLASS COUNTS (every red-evidence entry on a `proven` row) ===');
	LEVER_CLASS_REGISTRY.forEach((oneClass) => {
		console.log(
			`  ${String(swept.leverClassCounts[oneClass.className] || 0).padStart(4)}  ` +
				`${oneClass.mutatesProductionData ? 'DATA      ' : 'expectation'}  ${oneClass.className}`,
		);
	});
	console.log('\n=== THE SWEEP ===');
	console.log(
		`  re-stated expectationLeverOnly (NOT proven) ${swept.expectationLeverOnlyCount}  ` +
			`<- the population this sweep found; published here so it cannot vanish into a rename`,
	);
	console.log(`  proven rows total .......................... ${swept.provenRowsTotal}`);
	console.log(`  carrying at least one DATA lever ........... ${swept.provenCarryingADataLeverCount}`);
	console.log(
		`  resting on expectation levers ALONE ........ ${swept.provenRestingOnExpectationLeversAloneCount}`,
	);
	console.log(`  of those, carrying no redEvidence at all ... ${swept.provenRowsWithNoRedEvidence}`);
	console.log(
		`\nRECONCILIATION (two INDEPENDENT passes, compared — not a partition):\n` +
			`  census pass counted ................ ${swept.provenRowsTotal} proven rows\n` +
			`  classification pass reached ........ ${swept.classifiedRowCount} rows\n` +
			`  of those, landed in a bucket ....... ${swept.bucketTotal} ` +
			`(${swept.provenCarryingADataLeverCount} data + ` +
			`${swept.provenRestingOnExpectationLeversAloneCount} expectation-only)\n` +
			`  in census but never classified ..... ${swept.inCensusNotClassified.length}\n` +
			`  classified but absent from census .. ${swept.inClassifiedNotCensus.length}\n` +
			`Each of those last three CAN be nonzero; the earlier form of this probe summed a ` +
			`partition and could not.`,
	);
	fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(swept, null, 2)}\n`);
	console.log(`\nwrote ${OUTPUT_PATH}`);
	// The sweep REPORTS; it does not fail the run on a high expectation-only count. That figure is
	// the phase's finding, not a regression — and the work order requires those rows be RE-STATED as
	// genuineGap, which is a ledger edit, not something a measurement may do to itself.
	process.exit(0);
}
