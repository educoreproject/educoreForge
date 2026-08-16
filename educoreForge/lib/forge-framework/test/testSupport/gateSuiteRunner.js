'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// gateSuiteRunner.js — TEST SUPPORT: runs ONE gate family the same way every time (SPEC §10, §12.2;
// Profile §11.1): (1) the registry audit — no missing, no orphaned twin; (2) evaluateGates over the
// baseline scenario — every conjunct PASS (UNMEASURED is a failure); (3) sweepTwins — every conjunct
// OBSERVED RED under a counting twin (DEFECTIVE and UNPROVEN are failures; expectationLever recorded);
// (4) one report line per conjunct for the DEVLOG's red-observation table. Uses the framework's own
// harness engine (roundTripHarness/gateEvaluator + twinRegistry) — the same engine every forge's
// round-trip gates use, so the unit suite proves the engine as it uses it.
//
//   runGateFamily({ harness, familyName, gateDeclarationList, twinRegistry, makeSubject, cloneSubject,
//                   expectedConjunctCount, expectedTwinCount }, whenDone)

const path = require('path');
const gateEvaluator = require(path.join(__dirname, '..', '..', 'roundTripHarness', 'gateEvaluator'));

//   expectedUnprovenConjunctList — conjuncts RED-BY-DESIGN in this phase (FA6: G-SHARE's ≥1-caller until
//   F3b re-points it): named here, asserted to be EXACTLY the UNPROVEN set, and printed as such — never a
//   silent skip
const runGateFamily = ({ harness, familyName, gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount, expectedTwinCount, expectedUnprovenConjunctList = [] }, whenDone) => {
	const xLog = process.global.xLog;

	harness.section(`${familyName} — REGISTRY AUDIT: every declared twin implemented, no orphan`);
	const audit = twinRegistry.auditRegistryAgainst({ gateDeclarationList });
	harness.equal('no declared twin is missing an implementation', audit.missingList.length, 0);
	audit.missingList.forEach((oneMissing) => harness.note(`missing: ${oneMissing}`));
	harness.equal('no orphaned twin implementation', audit.orphanList.length, 0);
	audit.orphanList.forEach((oneOrphan) => harness.note(`orphaned: ${oneOrphan}`));
	if (expectedTwinCount !== undefined) {
		harness.equal(`registered twin count EQUALS the frozen ${expectedTwinCount}`, twinRegistry.entries().length, expectedTwinCount);
	}

	harness.section(`${familyName} — GATES over the baseline (every conjunct must PASS; UNMEASURED is a failure)`);
	gateEvaluator.evaluateGates({ gateDeclarationList, subject: makeSubject(), cloneSubject }, (evaluateError, evaluation) => {
		harness.ok('the gates evaluate', !evaluateError, evaluateError);
		if (evaluateError) {
			whenDone();
			return;
		}
		if (expectedConjunctCount !== undefined) {
			harness.equal(`conjunct count EQUALS the frozen ${expectedConjunctCount}`, evaluation.conjunctCount, expectedConjunctCount);
		}
		evaluation.gateResultList.forEach((oneGate) => {
			oneGate.conjunctResultList.forEach((oneConjunct) => {
				harness.ok(`${oneGate.gateId}/${oneConjunct.conjunctId} PASS — ${oneConjunct.title}`, oneConjunct.status === 'PASS', `${oneConjunct.status}: ${oneConjunct.detail}`);
			});
		});
		harness.ok(`${familyName}: the whole family is accepted`, evaluation.accepted, evaluation.failingList.join('; '));

		harness.section(`${familyName} — THE TWIN SWEEP: every conjunct OBSERVED RED under its own twin`);
		gateEvaluator.sweepTwins({ gateDeclarationList, twinRegistry, subject: makeSubject(), cloneSubject }, (sweepError, sweep) => {
			harness.ok('the sweep runs', !sweepError, sweepError);
			if (sweepError) {
				whenDone();
				return;
			}
			sweep.conjunctReportList.forEach((oneReport) => {
				const conjunctRefId = `${oneReport.gateId}/${oneReport.conjunctId}`;
				if (expectedUnprovenConjunctList.indexOf(conjunctRefId) !== -1) {
					harness.ok(`${conjunctRefId} is RED-BY-DESIGN in this phase (UNPROVEN, expectationLever recorded)`, oneReport.status === 'UNPROVEN', `${oneReport.status}: ${oneReport.note}`);
					xLog.status(`  RED-BY-DESIGN ${conjunctRefId}: not counted toward observed-red in this phase — ${oneReport.note}`);
				} else {
					harness.ok(
						`${conjunctRefId} observed RED`,
						oneReport.status === 'observedRed',
						`${oneReport.status}: ${oneReport.note}`,
					);
				}
				oneReport.twinReportList.forEach((oneTwin) => {
					// the DEVLOG's red-observation line: gate/conjunct, twin, leverKind, what the gate said under the twin
					xLog.status(
						`  RED-OBSERVED ${oneReport.gateId}/${oneReport.conjunctId} twin='${oneTwin.twinName}' lever=${oneTwin.leverKind}${oneTwin.shippedConfig === false ? ' shippedConfig=false' : ''} → ${oneTwin.statusUnderTwin}${oneTwin.leverKind === 'expectationLever' ? ' (recorded, not counted)' : ''}: ${String(oneTwin.detail).slice(0, 220)}`,
					);
				});
			});
			harness.equal('DEFECTIVE conjunct count', sweep.defectiveCount, 0);
			harness.equal(`UNPROVEN conjunct count EQUALS the named RED-BY-DESIGN count (${expectedUnprovenConjunctList.length})`, sweep.unprovenCount, expectedUnprovenConjunctList.length);
			harness.equal('FAILING-baseline conjunct count', sweep.failingCount, 0);
			harness.ok(`${familyName}: EVERY conjunct is now an observed twin${expectedUnprovenConjunctList.length ? ` (except the ${expectedUnprovenConjunctList.length} named RED-BY-DESIGN)` : ''}`, sweep.defectiveCount === 0 && sweep.failingCount === 0 && sweep.unprovenCount === expectedUnprovenConjunctList.length);
			xLog.status(`  ${familyName}: ${sweep.observedRedCount}/${sweep.conjunctCount} conjuncts observed red, ${sweep.twinRunCount} twin runs${sweep.expectationLeverList.length ? `, expectationLever (recorded only): ${sweep.expectationLeverList.join('; ')}` : ''}${sweep.shippedConfigFalseList.length ? `, shippedConfig:false twins: ${sweep.shippedConfigFalseList.join('; ')}` : ''}`);
			whenDone({ evaluation, sweep });
		});
	});
};

module.exports = { runGateFamily, moduleName };
