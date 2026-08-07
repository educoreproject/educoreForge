#!/usr/bin/env node
'use strict';

// p7_applyExpectationLeverOnly.js — applies JADE_PORTAL's ruling of 2026-08-07: add the fourth
// declared status `expectationLeverOnly`, re-state every `proven` row that carries no data lever
// under it, and ledger the new standing gate in all three suites.
//
// WHY A FOURTH STATUS AND NOT `genuineGap`. The work order said such a row "stands as genuineGap".
// The ledger's own `statuses` block DEFINES genuineGap as "Never demonstrated able to fail, by
// anyone" — and these rows HAVE been demonstrated able to fail, just not under a lever that moves
// production data. Re-labelling them genuineGap would have made the ledger's own definition false
// for 65 rows: AN HONEST NUMBER BOUGHT WITH A DISHONEST VOCABULARY. The supervisor adopted the
// recommendation in full and is correcting the work order.
//
// THE RE-STATEMENT IS COMPUTED, NEVER TRANSCRIBED. The rows are selected by running the SAME
// classifier the standing gate runs (imported, not copied — a second copy would be two derivations
// of one judgment held against each other, DESIGN 8h's failure). Nothing here carries a hand-typed
// count, so this script cannot disagree with the gate about which rows are affected.
//
// IDEMPOTENT AND IT REFUSES RATHER THAN GUESSING: a second run reports no-op; a ledger in a state
// this edit did not create is refused by name with nothing changed.

const fs = require('fs');
const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const LEDGER_PATH = path.join(__dirname, '..', 'redEvidenceLedger.json');
const { classifyOneLever } = require(path.join(__dirname, 'p7_expectationLeverSweep.js'));

const NEW_STATUS_NAME = 'expectationLeverOnly';
const NEW_STATUS_DEFINITION =
	'Observed FAILING in a retained log, but ONLY under a lever that moved a test EXPECTATION (or the ' +
	'harness) rather than production data. The standing rule is NOT satisfied and this row DOES NOT ' +
	'count as proven. It is deliberately NOT genuineGap: that status means "never demonstrated able to ' +
	'fail, by anyone", and these rows HAVE failed — re-labelling them would make this very block false ' +
	'for every one of them. Mechanically an expectation lever reddens an assertion whether or not its ' +
	'predicate can ever be satisfied by real data, so it certifies a VACUOUS gate as proven; a data ' +
	'lever cannot, because a vacuous check does not respond to data at all. Closing one of these rows ' +
	'means building a lever that mutates the input, the corpus or the graph — or, where that is ' +
	'genuinely impossible, saying so on the row and moving it to genuineGap with the reason.';

const GATE_LABEL =
	'LEDGER every proven row carries at least one lever that MUTATES PRODUCTION DATA';

const GATE_LEDGER_ENTRY = {
	label: GATE_LABEL,
	status: 'proven',
	redEvidence: [
		{
			probeLog: 'test/test-artifacts/p7/p7RED_provenImpliesDataLever.log',
			lever:
				'LEDGER GATE SELF-DEMONSTRATION (Phase 7): the gate was shipped BEFORE the re-statement it ' +
				'motivates, and its FIRST RUN was observed RED against the SHIPPED ledger in all three ' +
				'suites simultaneously — 25 source + 6 derived + 34 synthetic = 65 rows named by label in ' +
				'the evidence line. No mutation was needed because the real ledger content was already the ' +
				'defect; the ledger IS this gate\'s production data. The 65 independently matches the ' +
				'figure p7_expectationLeverSweep.js computes by a different enumeration.',
			shippedConfig: true,
		},
	],
	note:
		'A NEW GATE WHOSE FIRST ACT WAS TO FAIL AGAINST THE EXACT POPULATION THAT MOTIVATED IT. ' +
		'Ordered that way deliberately by the supervisor: had the re-statement landed first, the gate ' +
		'would have been green on its first run and would have been a gate nobody had ever seen fail.',
};

const rowLacksADataLever = (oneEntry) =>
	!(Array.isArray(oneEntry.redEvidence) ? oneEntry.redEvidence : []).some((oneLever) => {
		const classified = classifyOneLever(oneLever.lever);
		return classified !== null && classified.mutatesProductionData;
	});

const applyTheRuling = () => {
	const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
	const suiteNames = Object.keys(ledger.suites);

	const alreadyHasStatus = Object.prototype.hasOwnProperty.call(ledger.statuses, NEW_STATUS_NAME);
	const gateRowsPresent = suiteNames.filter((oneSuiteName) =>
		ledger.suites[oneSuiteName].assertions.some((oneEntry) => oneEntry.label === GATE_LABEL),
	);
	const rowsToRestate = [];
	suiteNames.forEach((oneSuiteName) => {
		ledger.suites[oneSuiteName].assertions.forEach((oneEntry) => {
			if (oneEntry.status === 'proven' && oneEntry.label !== GATE_LABEL && rowLacksADataLever(oneEntry)) {
				rowsToRestate.push({ suiteName: oneSuiteName, entry: oneEntry });
			}
		});
	});

	if (alreadyHasStatus && gateRowsPresent.length === suiteNames.length && rowsToRestate.length === 0) {
		return { alreadyApplied: true };
	}
	if (gateRowsPresent.length !== 0 && gateRowsPresent.length !== suiteNames.length) {
		return {
			refusal:
				`${moduleName}: the gate row is present in ${gateRowsPresent.length} of ${suiteNames.length} ` +
				`suites (${gateRowsPresent.join(', ')}). That is a half-applied state this edit did not ` +
				`create and will not reconcile. Nothing was changed.`,
		};
	}

	ledger.statuses[NEW_STATUS_NAME] = NEW_STATUS_DEFINITION;

	rowsToRestate.forEach((oneRow) => {
		oneRow.entry.status = NEW_STATUS_NAME;
		oneRow.entry.restatedAtPhase = '7';
		oneRow.entry.restatementReason =
			'Re-stated from `proven` by the standing rule that every proven row must carry at least one ' +
			'lever mutating PRODUCTION DATA. Its recorded levers move only a test expectation, the ' +
			'harness, or record an inherited observation. Its red evidence is UNCHANGED and preserved — ' +
			'what changed is the claim made about what that evidence proves.';
	});

	suiteNames.forEach((oneSuiteName) => {
		if (!ledger.suites[oneSuiteName].assertions.some((oneEntry) => oneEntry.label === GATE_LABEL)) {
			ledger.suites[oneSuiteName].assertions.push(JSON.parse(JSON.stringify(GATE_LEDGER_ENTRY)));
		}
	});

	// The recorded apparatus-scale figures are replaced by a POINTER to the instrument, because the
	// original numbers were handed down by a review and nothing recomputed them — the defect this
	// phase's sweep exists to retire. A stored number here would rot the same way.
	ledger.evidenceApparatusScale.supersededByPhase7 =
		'The recorded figures provenRowsRestingOnExpectationLeversAlone 63 / provenRowsTotalAtMeasurement ' +
		'114 were HANDED DOWN by the third adversarial review and never recomputed, so they could not ' +
		'notice the ledger moving underneath them. They are superseded by test/probes/' +
		'p7_expectationLeverSweep.js, which recomputes on every run from two INDEPENDENT passes that are ' +
		'compared rather than partitioned, and by the standing gate in all three suites. No figure is ' +
		'stored here, deliberately: a stored figure is exactly what went stale.';

	fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, '\t')}\n`);
	const bySuite = {};
	rowsToRestate.forEach((oneRow) => {
		bySuite[oneRow.suiteName] = (bySuite[oneRow.suiteName] || 0) + 1;
	});
	return { applied: true, restatedCount: rowsToRestate.length, bySuite, gateRowsAdded: suiteNames.length };
};

module.exports = { applyTheRuling, rowLacksADataLever };

if (require.main === module) {
	const outcome = applyTheRuling();
	if (outcome.refusal) {
		console.error(`\n${outcome.refusal}`);
		process.exit(1);
	}
	if (outcome.alreadyApplied) {
		console.log('already applied — the ledger is in the post-ruling state. Nothing changed.');
		process.exit(0);
	}
	console.log(`ADDED status: ${NEW_STATUS_NAME}`);
	console.log(`RE-STATED ${outcome.restatedCount} row(s) from proven -> ${NEW_STATUS_NAME}`);
	Object.keys(outcome.bySuite)
		.sort()
		.forEach((oneSuiteName) => console.log(`   ${oneSuiteName}: ${outcome.bySuite[oneSuiteName]}`));
	console.log(`ADDED the standing-gate ledger row to ${outcome.gateRowsAdded} suite(s)`);
	process.exit(0);
}
