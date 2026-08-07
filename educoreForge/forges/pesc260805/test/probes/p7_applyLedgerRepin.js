#!/usr/bin/env node
'use strict';

// p7_applyLedgerRepin.js — applies Phase 7's ledger edits as a SCRIPT rather than a hand-edit of a
// 195 KB JSON file, so the change is reviewable as a diff of intent instead of a diff of bytes.
//
// IT IS IDEMPOTENT AND IT REFUSES RATHER THAN GUESSING. Re-running it after a successful run is a
// no-op that says so. If the ledger is not in the state this edit expects — the retired entry
// already gone, a successor label already present, the suite's labels not matching — it REFUSES BY
// NAME and changes nothing, because a partial application of a ledger edit is worse than none.
//
// WHAT IT DOES, and why each part is here:
//   1. RETIRES 'INTEGRATION roundTripValidator NOT declared yet' into retiredAssertions. NOTHING IS
//      DELETED (work order standing rule 4) and its red evidence is preserved — but per the ledger's
//      own retiredAssertionsNote that evidence does NOT transfer to the successors. An assertion
//      carrying a predecessor's receipt is how this campaign's genuine-gap residue was created.
//   2. ADDS the three successor assertions, each with red evidence from
//      test/probes/p7_repinnedDescriptorLevers.js — levers that MUTATE PRODUCTION DATA (the bundle's
//      parserDescriptor.ini), not test expectations.
//   3. RECORDS the INTERPOLATED-LABEL CLASS as a top-level block, because it is a structural limit of
//      a label-keyed ledger and CANNOT be expressed as a row inside the label-keyed map.

const fs = require('fs');
const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const LEDGER_PATH = path.join(__dirname, '..', 'redEvidenceLedger.json');

const RETIRED_LABEL = 'INTEGRATION roundTripValidator NOT declared yet (declared-and-broken = refusal)';

const LEVER_LOG = 'test/test-artifacts/p7/p7RepinnedDescriptorLevers.log';

const SUCCESSOR_ASSERTIONS = [
	{
		label: 'INTEGRATION roundTripValidator IS declared (Phase 5; re-pinned in Phase 7)',
		status: 'proven',
		redEvidence: [
			{
				probeLog: LEVER_LOG,
				lever:
					'PRODUCTION MUTATION, SHIPPED CONFIGURATION (Phase 7): the roundTripValidator line was ' +
					'deleted from the bundle\'s own parserDescriptor.ini — the pre-Phase-5 state — and the ' +
					'assertion was OBSERVED RED. The file is restored byte-for-byte and the restore is ' +
					'verified by comparison, not assumed.',
				shippedConfig: true,
			},
			{
				probeLog: LEVER_LOG,
				lever:
					'PRODUCTION MUTATION, SHIPPED CONFIGURATION (Phase 7): the declaration was repointed at ' +
					'a filename that does not exist (RT-13.3 declared-and-missing) and the assertion was ' +
					'OBSERVED RED.',
				shippedConfig: true,
			},
		],
		note:
			'Replaces the stale pin that asserted the OPPOSITE. Carries an ACCEPT-CONTROL: a no-op lever ' +
			'rewriting the ORIGINAL bytes leaves all three successors GREEN, which is what makes the reds ' +
			'interpretable — without it, a harness that broke the descriptor unconditionally, or a reader ' +
			'serving a stale cached parse, would produce an identical all-red table.',
	},
	{
		label:
			'INTEGRATION the declared roundTripValidator file EXISTS (RT-13.3: declared-and-missing refuses every build)',
		status: 'proven',
		redEvidence: [
			{
				probeLog: LEVER_LOG,
				lever:
					'PRODUCTION MUTATION, SHIPPED CONFIGURATION (Phase 7): the declaration was repointed at ' +
					'a filename that does not exist and the assertion was OBSERVED RED.',
				shippedConfig: true,
			},
		],
		note:
			'Deliberately a SEPARATE assertion rather than a conjunct, on the day this phase measured the ' +
			'conjunction class (78 of 233 shipped assertions carry a top-level &&). The separation is not ' +
			'cosmetic and it was MEASURED: the lever that declares a file which exists but exports no ' +
			'validate() reddens the declaration and exports assertions and leaves THIS one green, so a ' +
			'single conjunction would have hidden a case its own receipt could not distinguish.',
	},
	{
		label:
			'INTEGRATION the declared roundTripValidator exports validate() (RT-13.3: declared-and-broken is a refusal, never a downgrade to absent)',
		status: 'proven',
		redEvidence: [
			{
				probeLog: LEVER_LOG,
				lever:
					'PRODUCTION MUTATION, SHIPPED CONFIGURATION (Phase 7): the declaration was repointed at a ' +
					'module that EXISTS and LOADS but exports no validate(). The assertion was OBSERVED RED ' +
					'while the file-existence assertion stayed GREEN — the discriminating lever for this row.',
				shippedConfig: true,
			},
			{
				probeLog: LEVER_LOG,
				lever:
					'PRODUCTION MUTATION, SHIPPED CONFIGURATION (Phase 7): the roundTripValidator line was ' +
					'deleted from parserDescriptor.ini and the assertion was OBSERVED RED.',
				shippedConfig: true,
			},
		],
		note:
			'RT-13.3 is the requirement behind all three: a declared validator that does not exist or does ' +
			'not load REFUSES EVERY BUILD by name, stage on or off, and is never downgraded to absent.',
	},
];

const INTERPOLATED_LABEL_CLASS = {
	note:
		'A STRUCTURAL LIMIT OF A LABEL-KEYED LEDGER, recorded here because it CANNOT be recorded as a row ' +
		'inside the label-keyed suites map — the key does not exist as a constant. Measured 2026-08-07 ' +
		'(SCARLET_GARDEN) by sweeping all three suites for check() calls whose label is a template literal ' +
		'carrying an interpolation. Two members, with DIFFERENT failure modes; the second is the more ' +
		'serious and was not the one the sweep was ordered for.',
	standingRule:
		'AN ASSERTION LABEL MUST BE A CONSTANT. A label assembled at runtime cannot be joined to a ledger ' +
		'row, so the assertion is either permanently unledgerable or ledgerable only in one of its states. ' +
		'This is the conjunction class one step further out: there the label was the wrong GRANULARITY for ' +
		'the claim; here it is not even the same string twice.',
	members: [
		{
			site: 'test/test-pesc260805SourceTier.js:367',
			callText: 'check(`INTEGRATION forge run (${err})`, false)',
			status: 'genuineGap',
			failureMode: 'PERMANENTLY UNLEDGERABLE',
			reason:
				'The label interpolates the forge error text, so it has no value until the failure happens ' +
				'and a different value for every distinct failure. It can never be joined to a ledger row by ' +
				'label, and no lever can produce a receipt keyed to a key that does not exist. It is also ' +
				'UNREACHABLE on a healthy build (it sits in the forge error branch and its condition is the ' +
				'literal false), which is why it appears in a static parse of the suite but never in the ' +
				'executed set — the 233-versus-232 difference this phase reconciled.',
		},
		{
			site: 'test/test-pesc260805DerivedTier.js:378',
			callText:
				"check(`G3-A regeneration ran without refusal${regenerationError ? ` (${regenerationError})` : ''}`, regenerationError === '')",
			status: 'genuineGap',
			failureMode: 'LEDGERED ONLY IN ITS GREEN STATE',
			reason:
				'THE MORE SERIOUS OF THE TWO AND IT RUNS ON EVERY BUILD. On success the ternary collapses to ' +
				"the empty string and the label is the constant 'G3-A regeneration ran without refusal', " +
				'which is the form carried in this ledger. On FAILURE the label MUTATES to carry the error ' +
				'text. So at the exact moment the evidence matters, the ledger row for the green-path label ' +
				'goes STALE and the mutated label reports UNLEDGERED — the ledger gate would fail with two ' +
				'findings that are both artifacts of the label, and neither of which is the real defect. Its ' +
				'row is genuineGap for the ordinary reason (never demonstrated able to fail) AND for this ' +
				'additional structural one, which is why it is named here as well.',
		},
	],
	recommendedRepair:
		'Give each such assertion a CONSTANT label and move the interpolated detail into the evidence() ' +
		'line beside it, which is free-form and is not a ledger key. Cheap per site; the sweep that finds ' +
		'them is one regular expression over the suites and is worth running whenever an assertion is added.',
};

const applyTheRepin = () => {
	const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
	const sourceAssertions = ledger.suites.source.assertions;

	const retiredIndex = sourceAssertions.findIndex((oneEntry) => oneEntry.label === RETIRED_LABEL);
	const successorsAlreadyPresent = SUCCESSOR_ASSERTIONS.filter((oneSuccessor) =>
		sourceAssertions.some((oneEntry) => oneEntry.label === oneSuccessor.label),
	);

	if (retiredIndex === -1 && successorsAlreadyPresent.length === SUCCESSOR_ASSERTIONS.length) {
		return { alreadyApplied: true };
	}
	if (retiredIndex === -1) {
		return {
			refusal:
				`${moduleName}: the entry to retire is not in the ledger and the edit is only partly ` +
				`applied (${successorsAlreadyPresent.length} of ${SUCCESSOR_ASSERTIONS.length} successors ` +
				`present). Nothing was changed. Expected label: '${RETIRED_LABEL}'.`,
		};
	}
	if (successorsAlreadyPresent.length > 0) {
		return {
			refusal:
				`${moduleName}: the retired entry is still present AND ${successorsAlreadyPresent.length} ` +
				`successor label(s) are already in the ledger, which is a state this edit did not create ` +
				`and cannot safely reconcile. Nothing was changed. Present already: ` +
				successorsAlreadyPresent.map((oneRow) => oneRow.label).join(' | '),
		};
	}

	const retiredEntry = sourceAssertions[retiredIndex];
	sourceAssertions.splice(retiredIndex, 1);
	SUCCESSOR_ASSERTIONS.forEach((oneSuccessor, offset) => {
		sourceAssertions.splice(retiredIndex + offset, 0, oneSuccessor);
	});

	ledger.retiredAssertions.push({
		label: retiredEntry.label,
		retiredAtPhase: '7 (re-pinned, not deleted — the original entry and its evidence are preserved here)',
		status: retiredEntry.status,
		originalEntry: retiredEntry,
		reason:
			'PHASE 5 FALSIFIED THIS ASSERTION and it was the suite\'s single standing FAIL (54 passed / 1 ' +
			'failed) across Phases 5, 6 and 6.5, carried as a DECLARED debt so that a red suite could not be ' +
			'mistaken for a clean one. It asserted descriptor.roundTripValidator === undefined; Phase 5 ' +
			'declared roundTripValidator=roundTripValidator.js. The REQUIREMENT behind it (RT-13.3) is ' +
			'unchanged — only the state of the world moved — so it is re-pinned to the condition RT-13.3 ' +
			'actually cares about rather than dropped.',
		successors: SUCCESSOR_ASSERTIONS.map((oneSuccessor) => oneSuccessor.label),
		evidenceDoesNotTransfer:
			'Per this ledger\'s own retiredAssertionsNote, the retired entry\'s evidence does NOT transfer to ' +
			'the successors. All three were proven afresh by levers that mutate production data.',
	});

	ledger.interpolatedLabelClass = INTERPOLATED_LABEL_CLASS;

	fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, '\t')}\n`);
	return {
		applied: true,
		retiredLabel: RETIRED_LABEL,
		addedLabels: SUCCESSOR_ASSERTIONS.map((oneSuccessor) => oneSuccessor.label),
		sourceAssertionCount: sourceAssertions.length,
	};
};

if (require.main === module) {
	const outcome = applyTheRepin();
	if (outcome.refusal) {
		console.error(`\n${outcome.refusal}`);
		process.exit(1);
	}
	if (outcome.alreadyApplied) {
		console.log('already applied — the ledger is in the post-repin state. Nothing changed.');
		process.exit(0);
	}
	console.log(`RETIRED: ${outcome.retiredLabel}`);
	outcome.addedLabels.forEach((oneLabel) => console.log(`ADDED:   ${oneLabel}`));
	console.log(`\nsource suite ledger entries now: ${outcome.sourceAssertionCount}`);
	console.log('ADDED top-level block: interpolatedLabelClass (2 members)');
	process.exit(0);
}
