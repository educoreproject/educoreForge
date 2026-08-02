#!/usr/bin/env node
'use strict';

// test-cedsGates.js — the STANDING gate for the gate harness itself.
//
// A suite that judges the forge has to be judged by something, and it cannot be itself. This is
// that something. HERMETIC: no Docker, no network, no graph, no LLM, no Voyage. Every measurement
// here is hand-built data.
//
// THE CENTRAL ASSERTION IS THE TWIN SWEEP. Doctrine D1 says a gate never observed failing is
// unproven, so this file takes an all-green measurement bundle, runs EVERY declared twin against
// it, and asserts that EVERY gate turns RED. A gate that stays green while its own twin corrupts
// its measure is a defect in the gate -- exactly the failure this project shipped twice (Phase-3,
// 2026-06-30; gate 23 in Phase 7) and swore off.
//
// The other assertions defend the harness's own honesty:
//   - a missing measure is UNMEASURED (a failure), never a silent PASS
//   - a passing gate whose twin has not been observed is UNPROVEN, never PASS
//   - malformed declarations are REFUSED by name rather than run partially
//   - the jsonc comment stripper does not eat the http:// inside a predicate URI
//
// Run: node forges/ceds/test/test-cedsGates.js [-verbose]

const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- standing gate for the CEDS fidelity gate harness

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the harness judges rather than merely computes: every declared twin is run and every
     gate must go RED under it; unmeasured is a failure not a skip; an unobserved twin downgrades a
     passing gate to UNPROVEN; malformed declarations are refused. Hermetic.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const gatesLib = require('../lib/roundTripGates')();
const twinsLib = require('../lib/roundTripGateTwins')();

const DECLARATIONS_PATH = path.join(__dirname, '..', 'gates', 'cedsFidelityGates.jsonc');

// =====================================================================================
// allGreenMeasurements — a bundle in which EVERY gate passes.
// =====================================================================================
// Built FROM the declarations, so it cannot drift out of step with them: whatever a gate
// expects is what this bundle supplies. That is the point -- the twin sweep needs a known
// green starting state, and hand-maintaining 46 expectations twice would guarantee skew.
const allGreenMeasurementsFrom = (declarations) => {
	const measurements = { report: { headline: {}, canonicalizationFaults: [] }, graph: {}, probe: {}, suite: {} };

	declarations.gates.forEach((oneGate) => {
		const { measure, comparator, expected } = oneGate;

		if (measure.indexOf('report.') === 0) {
			const dotted = measure.slice('report.'.length).split('.');
			const lastKey = dotted.pop();
			const container = dotted.reduce((soFar, oneKey) => {
				soFar[oneKey] = soFar[oneKey] || {};
				return soFar[oneKey];
			}, measurements.report);
			container[lastKey] = comparator === 'isEmpty' ? [] : expected;
			return;
		}
		const separatorIndex = measure.indexOf(':');
		const kind = measure.slice(0, separatorIndex);
		const name = measure.slice(separatorIndex + 1);
		measurements[kind] = measurements[kind] || {};

		// TWO GATES MAY SHARE ONE MEASURE. P-1 and P-2 both read report:matchedByPredicate --
		// P-1 asserts the predicates that already round-trip, P-2 the ones enrichment must
		// deliver -- and that split is deliberate: it keeps "unregressed" and "delivered" as
		// separate verdicts. A green fixture must therefore MERGE their expectations rather
		// than let the second gate's map silently replace the first's, which would leave P-1
		// reading eleven undefineds and looking like a harness bug.
		if (comparator === 'mapEquals') {
			measurements[kind][name] = { ...(measurements[kind][name] || {}), ...expected };
			return;
		}
		measurements[kind][name] =
			comparator === 'setEquals'
				? { equal: true, onlyInLeft: [], onlyInRight: [] }
				: comparator === 'isEmpty'
					? []
					: expected;
	});

	// F-3's floors and the headline the twins move: supplied at the measured baseline.
	measurements.report.headline.sourceStatements = 239761;
	measurements.report.headline.emittedStatements = 239761;
	measurements.report.headline.emittedSubjects = 23237;
	measurements.report.headline.matched = 239761;
	measurements.report.headline.lost = 0;
	measurements.report.headline.invented = 0;
	return measurements;
};

// =====================================================================================
let loadedDeclarations = null;

const runLoadSection = (whenDone) => {
	harness.section('DECLARATIONS — data, refused when malformed, and the URI hazard');

	gatesLib.loadGateDeclarations({ filePath: DECLARATIONS_PATH }, (loadError, loadResult) => {
		harness.ok('the real declarations load', !loadError, loadError);
		if (loadError) {
			whenDone();
			return;
		}
		loadedDeclarations = loadResult.declarations;
		const gates = loadedDeclarations.gates;

		harness.ok('the suite declares gates', gates.length > 0, `${gates.length}`);
		harness.equal('every gate carries a comparator', gates.filter((one) => !one.comparator).length, 0);
		harness.equal('every gate carries a twin', gates.filter((one) => !one.twin).length, 0);
		harness.equal(
			'every gate carries an expected value',
			gates.filter((one) => one.expected === undefined).length,
			0,
		);
		harness.equal('gate ids are unique', new Set(gates.map((one) => one.id)).size, gates.length);

		// THE URI HAZARD. Predicate URIs appear as object KEYS in the P-1/P-2 expectations. A
		// naive //-stripping regex eats every one of them and leaves a file that STILL PARSES.
		const predicateGate = gates.find((one) => one.id === 'P-1');
		const predicateKeys = Object.keys((predicateGate || {}).expected || {});
		harness.ok('P-1 declares predicate expectations', predicateKeys.length > 0, `${predicateKeys.length}`);
		harness.ok(
			'the comment stripper did NOT eat http:// inside quoted keys',
			predicateKeys.every((oneKey) => oneKey.indexOf('http') === 0 && oneKey.indexOf('//') > 0),
			predicateKeys[0],
		);

		// Refusals: a suite that runs partially is worse than one that refuses.
		gatesLib.loadGateDeclarations({ filePath: '/nonexistent/gates.jsonc' }, (missingError) => {
			harness.rejects('a missing declarations file is REFUSED', [missingError], /does not exist/);
			whenDone();
		});
	});
};

const runStripperSection = (whenDone) => {
	harness.section('COMMENT STRIPPER — string state, not a regex');

	const withUriInString = '{ "a": "http://x.example/p" } // trailing';
	harness.equal(
		'a // inside a quoted string survives',
		JSON.parse(gatesLib.stripJsonComments(withUriInString)).a,
		'http://x.example/p',
	);
	const withBlock = '{ /* gone */ "b": 1 }';
	harness.equal('a block comment is removed', JSON.parse(gatesLib.stripJsonComments(withBlock)).b, 1);
	const withEscapedQuote = '{ "c": "he said \\" // not a comment" }';
	harness.equal(
		'an escaped quote does not end string state',
		JSON.parse(gatesLib.stripJsonComments(withEscapedQuote)).c,
		'he said " // not a comment',
	);
	whenDone();
};

const runComparatorSection = (whenDone) => {
	harness.section('COMPARATORS — the entire judging vocabulary');

	const { comparators } = gatesLib;
	harness.ok('equals passes on equality', comparators.equals({ actual: 0, expected: 0 }).passed);
	harness.ok('equals fails on inequality', !comparators.equals({ actual: 1, expected: 0 }).passed);
	harness.ok('isEmpty passes on []', comparators.isEmpty({ actual: [] }).passed);
	harness.ok('isEmpty fails on a populated array', !comparators.isEmpty({ actual: ['x'] }).passed);
	harness.ok('atLeast fails on a non-number', !comparators.atLeast({ actual: 'x', expected: 1 }).passed);
	harness.ok(
		'setEquals fails when the sets differ',
		!comparators.setEquals({ actual: { equal: false, onlyInLeft: ['x'], onlyInRight: [] } }).passed,
	);
	harness.ok(
		'mapEquals fails on ONE wrong entry among many',
		!comparators.mapEquals({ actual: { a: 1, b: 2 }, expected: { a: 1, b: 3 } }).passed,
	);
	harness.ok(
		'mapEquals names the mismatching key',
		comparators.mapEquals({ actual: { a: 1, b: 2 }, expected: { a: 1, b: 3 } }).detail.indexOf('b') >= 0,
	);
	whenDone();
};

const runGreenSection = (whenDone) => {
	harness.section('ALL-GREEN BUNDLE — the suite can report ACCEPTED at all');

	const measurements = allGreenMeasurementsFrom(loadedDeclarations);
	const observedTwins = {};
	loadedDeclarations.gates.forEach((oneGate) => {
		observedTwins[oneGate.id] = true;
	});

	gatesLib.evaluateSuite({ declarations: loadedDeclarations, measurements, observedTwins }, (evalError, result) => {
		harness.ok('the suite evaluates', !evalError, evalError);
		if (evalError) {
			whenDone();
			return;
		}
		const { suiteResult } = result;
		harness.equal('zero FAIL', suiteResult.failed, 0);
		harness.equal('zero UNMEASURED', suiteResult.unmeasured, 0);
		harness.equal('zero UNPROVEN', suiteResult.unproven, 0);
		harness.equal('every gate PASSes', suiteResult.passed, loadedDeclarations.gates.length);
		harness.ok('the suite reports ACCEPTED', suiteResult.accepted === true);

		// A suite that can never report success is decoration, not enforcement -- and an
		// enormous honest failure would be indistinguishable from a broken harness.
		harness.note('a green suite is REACHABLE, which is what makes a red one meaningful');
		whenDone();
	});
};

const runUnprovenSection = (whenDone) => {
	harness.section('UNPROVEN and UNMEASURED — the two ways a green comparison is still not a PASS');

	const measurements = allGreenMeasurementsFrom(loadedDeclarations);

	gatesLib.evaluateSuite({ declarations: loadedDeclarations, measurements, observedTwins: {} }, (e1, r1) => {
		harness.ok('evaluates with NO twins observed', !e1, e1);
		harness.equal('every passing gate is UNPROVEN, not PASS', r1.suiteResult.passed, 0);
		harness.equal(
			'all gates report UNPROVEN',
			r1.suiteResult.unproven,
			loadedDeclarations.gates.length,
		);
		harness.ok('the suite is NOT accepted on unproven gates', r1.suiteResult.accepted === false);

		// Now: delete a measure entirely. The gate must NOT pass.
		const starved = allGreenMeasurementsFrom(loadedDeclarations);
		delete starved.graph.optionSetSubClassOfCount;
		const allObserved = {};
		loadedDeclarations.gates.forEach((oneGate) => {
			allObserved[oneGate.id] = true;
		});
		gatesLib.evaluateSuite(
			{ declarations: loadedDeclarations, measurements: starved, observedTwins: allObserved },
			(e2, r2) => {
				harness.ok('evaluates with one measure missing', !e2, e2);
				const s1 = r2.suiteResult.gates.find((one) => one.id === 'S-1');
				harness.equal('a missing measure is UNMEASURED', s1.status, 'UNMEASURED');
				harness.ok('UNMEASURED is not PASS', s1.status !== 'PASS');
				harness.ok('the suite is NOT accepted', r2.suiteResult.accepted === false);
				harness.note('a gate that passes because nobody measured it is the bug this suite exists to catch');
				whenDone();
			},
		);
	});
};

const runTwinSweepSection = (whenDone) => {
	harness.section('THE TWIN SWEEP — every gate must be OBSERVED going RED');

	twinsLib.auditRegistryAgainst({ declarations: loadedDeclarations }, (auditError, audit) => {
		harness.ok('the twin registry audits', !auditError, auditError);
		harness.equal(
			'every declared twin has an implementation',
			audit.missing.length,
			0,
		);
		if (audit.missing.length) {
			harness.note(`missing: ${audit.missing.join(', ')}`);
		}
		harness.equal('no orphaned twin implementations', audit.orphaned.length, 0);
		if (audit.orphaned.length) {
			harness.note(`orphaned: ${audit.orphaned.join(', ')}`);
		}

		const measurements = allGreenMeasurementsFrom(loadedDeclarations);
		gatesLib.runTwins(
			{ declarations: loadedDeclarations, measurements, twinRegistry: twinsLib.twinRegistry },
			(twinError, twinResult) => {
				harness.ok('the twin sweep runs', !twinError, twinError);
				if (twinError) {
					whenDone();
					return;
				}
				const defective = twinResult.twinReports.filter((one) => one.ran && !one.gateWentRed);
				const unrun = twinResult.twinReports.filter((one) => !one.ran);

				harness.equal('every twin ran', unrun.length, 0);
				harness.equal(
					'EVERY gate went RED under its own twin',
					defective.length,
					0,
				);
				defective.forEach((oneReport) => {
					harness.note(`DEFECTIVE GATE ${oneReport.gateId}: ${oneReport.note}`);
				});
				harness.equal(
					'every gate is now an observed twin',
					Object.keys(twinResult.observedTwins).length,
					loadedDeclarations.gates.length,
				);
				harness.note('doctrine D1 satisfied: no gate in this suite is unproven');
				whenDone();
			},
		);
	});
};

const runRenderSection = (whenDone) => {
	harness.section('RENDERING — the verdict is a word, never a percentage');

	const measurements = allGreenMeasurementsFrom(loadedDeclarations);
	gatesLib.evaluateSuite({ declarations: loadedDeclarations, measurements, observedTwins: {} }, (e1, r1) => {
		gatesLib.renderSuiteText({ suiteResult: r1.suiteResult, twinReports: [] }, (renderError, rendered) => {
			harness.ok('renders', !renderError, renderError);
			harness.match('states a verdict', rendered.text, /VERDICT: NOT ACCEPTED/);
			harness.match('explains UNPROVEN', rendered.text, /nobody has watched it fail/);
			harness.ok(
				'no percentage appears in the verdict line',
				!/VERDICT.*%/.test(rendered.text),
			);
			whenDone();
		});
	});
};

// serial, because the harness tallies into one report
runLoadSection(() => {
	runStripperSection(() => {
		runComparatorSection(() => {
			runGreenSection(() => {
				runUnprovenSection(() => {
					runTwinSweepSection(() => {
						runRenderSection(() => {
							harness.report();
						});
					});
				});
			});
		});
	});
});
