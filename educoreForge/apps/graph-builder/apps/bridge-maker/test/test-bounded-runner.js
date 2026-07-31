#!/usr/bin/env node
'use strict';

// test-bounded-runner.js — the boundedRunner gate (p8-judgeConcurrency).
//
// boundedRunner is the bounded-concurrency dispatcher the evidence bridges' per-source judge loop
// now runs through (genericBridge.js / sifEvidenceBridge.js REBRIDGE mode). Its contract has two
// load-bearing halves — results BY INDEX (byte-determinism of the frozen decision block depends on
// it) and a REAL concurrency ceiling (rate-limit politeness depends on it) — and both are proven
// here MECHANICALLY, never assumed:
//
//   SECTION 1 — refusals by name: items not an array, concurrencyLimit not a positive integer
//               (zero, negative, fractional, string, missing), oneItem not a function, and the ONE
//               throw (no callback — R7: nowhere to deliver even a refusal).
//   SECTION 2 — ORDER PRESERVATION under staggered (reversed) delays: completion order is proven
//               to DIFFER from item order, and results[] is proven to be in ITEM order anyway.
//   SECTION 3 — THE CONCURRENCY CEILING: a live in-flight counter proves max in-flight EQUALS the
//               limit (the ceiling is both respected AND actually used), and launch order is
//               strictly item order.
//   SECTION 4 — ERROR SHORT-CIRCUIT: on an item error no NEW items launch, the in-flight items
//               settle first, the callback fires exactly ONCE, and among MULTIPLE settled errors
//               the LOWEST-INDEX error wins even when a higher-index error completed first on the
//               clock.
//   SECTION 5 — concurrencyLimit=1 degenerates to strict serial (start[i+1] only after end[i]).
//   SECTION 6 — STACK SAFETY: 20,000 fully-synchronous items complete iteratively (the SIF-scale
//               case), plus the empty-items and double-callback-guard edges.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-bounded-runner.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the boundedRunner gate: order-by-index, real ceiling, deterministic errors

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves boundedRunner's contract mechanically: refusals by name; results in ITEM order under
     completion orders that provably differ from item order; a max-in-flight counter that EQUALS
     the concurrency limit; error short-circuit with lowest-index preference among settled errors;
     concurrencyLimit=1 degenerating to strict serial; and iterative (stack-safe) dispatch over
     20,000 synchronous items.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const boundedRunner = require('../lib/boundedRunner');

// =====================================================================
harness.section('SECTION 1 — refusals by name (RED), and the R7 no-callback throw');
// =====================================================================

(() => {
	let observed = null;
	boundedRunner({ items: 'not-an-array', concurrencyLimit: 4, oneItem: (i, x, cb) => cb('') }, (err) => {
		observed = err;
	});
	harness.rejects('RED: items not an array is refused by name', [observed], /items is not an array/);
})();

[0, -1, 2.5, '8', undefined, null].forEach((badLimit) => {
	let observed = null;
	boundedRunner({ items: [], concurrencyLimit: badLimit, oneItem: (i, x, cb) => cb('') }, (err) => {
		observed = err;
	});
	harness.rejects(
		`RED: concurrencyLimit ${JSON.stringify(badLimit)} is refused by name (positive integer required)`,
		[observed],
		/concurrencyLimit is .* positive integer/s,
	);
});

(() => {
	let observed = null;
	boundedRunner({ items: [], concurrencyLimit: 4, oneItem: 'not-a-function' }, (err) => {
		observed = err;
	});
	harness.rejects('RED: oneItem not a function is refused by name', [observed], /oneItem is not a function/);
})();

(() => {
	let thrown = null;
	try {
		boundedRunner({ items: [], concurrencyLimit: 1, oneItem: (i, x, cb) => cb('') });
	} catch (error) {
		thrown = error;
	}
	harness.ok(
		'RED: a missing callback THROWS by name (R7 — nowhere to deliver even a refusal)',
		!!thrown && /callback is not a function/.test(thrown.message),
		thrown ? thrown.message : 'did not throw at all',
	);
})();

// =====================================================================
// The remaining sections are ASYNC (real timers stagger completion order), so they chain through
// callbacks and harness.report() fires at the very end of the chain.
// =====================================================================

// SECTION 2 — order preservation under staggered delays -------------------------------------------
const runOrderPreservation = (sectionDone) => {
	harness.section('SECTION 2 — ORDER PRESERVATION: reversed delays, completion order != item order, results BY INDEX anyway');

	const itemCount = 10;
	const items = Array.from({ length: itemCount }, (ignore, i) => i);
	const completionOrder = [];
	boundedRunner(
		{
			items,
			concurrencyLimit: itemCount, // everything in flight at once — maximum shuffle
			oneItem: (oneItem, index, cb) => {
				// REVERSED delays: the LAST-launched item completes FIRST, guaranteeing completion
				// order differs from item order (the fixture the determinism claim must survive).
				setTimeout(() => {
					completionOrder.push(index);
					cb('', `result-${index}`);
				}, (itemCount - index) * 6);
			},
		},
		(err, out) => {
			harness.equal('the run completes with no error', err, '');
			harness.ok(
				'completion order provably DIFFERS from item order (the shuffle is real, not assumed)',
				JSON.stringify(completionOrder) !== JSON.stringify(items),
				`completion order was ${JSON.stringify(completionOrder)}`,
			);
			harness.equal(
				'results[] is in ITEM order anyway (collected BY INDEX, never by completion)',
				JSON.stringify(out.results),
				JSON.stringify(items.map((i) => `result-${i}`)),
			);
			sectionDone();
		},
	);
};

// SECTION 3 — the concurrency ceiling -------------------------------------------------------------
const runConcurrencyCeiling = (sectionDone) => {
	harness.section('SECTION 3 — THE CONCURRENCY CEILING: max in-flight EQUALS the limit; launch order is item order');

	const itemCount = 12;
	const concurrencyLimit = 3;
	let inFlightNow = 0;
	let maxInFlightObserved = 0;
	const launchOrder = [];
	boundedRunner(
		{
			items: Array.from({ length: itemCount }, (ignore, i) => i),
			concurrencyLimit,
			oneItem: (oneItem, index, cb) => {
				launchOrder.push(index);
				inFlightNow += 1;
				maxInFlightObserved = Math.max(maxInFlightObserved, inFlightNow);
				setTimeout(() => {
					inFlightNow -= 1;
					cb('', index);
				}, 4 + (index % 3) * 5); // uneven latencies so slots free up out of order
			},
		},
		(err, out) => {
			harness.equal('the run completes with no error', err, '');
			harness.ok(
				`max in-flight never exceeded the limit (observed ${maxInFlightObserved}, limit ${concurrencyLimit})`,
				maxInFlightObserved <= concurrencyLimit,
				`observed ${maxInFlightObserved}`,
			);
			harness.equal(
				'and the ceiling was actually REACHED (the limit is used, not merely respected)',
				maxInFlightObserved,
				concurrencyLimit,
			);
			harness.equal(
				'launch order is strictly item order (only COMPLETION order may shuffle)',
				JSON.stringify(launchOrder),
				JSON.stringify(Array.from({ length: itemCount }, (ignore, i) => i)),
			);
			harness.equal('all results present, in item order', JSON.stringify(out.results), JSON.stringify(Array.from({ length: itemCount }, (ignore, i) => i)));
			sectionDone();
		},
	);
};

// SECTION 4 — error short-circuit with lowest-index preference ------------------------------------
const runErrorShortCircuit = (sectionDone) => {
	harness.section('SECTION 4 — ERROR SHORT-CIRCUIT: no new launches, in-flight settles, LOWEST-index error wins');

	// limit 4 over 10 items. Item 2 errors FIRST on the clock (10ms); item 1 errors LATER (30ms).
	// Items 0 and 3 succeed slowly. Correct behavior: items 4..9 never launch; the callback waits
	// for all four in-flight items to settle; the reported error is item 1's (lowest index among
	// settled errors) even though item 2's error arrived first in time.
	const launchCount = { n: 0 };
	let callbackCount = 0;
	let inFlightAtCallback = -1;
	let inFlightNow = 0;
	boundedRunner(
		{
			items: Array.from({ length: 10 }, (ignore, i) => i),
			concurrencyLimit: 4,
			oneItem: (oneItem, index, cb) => {
				launchCount.n += 1;
				inFlightNow += 1;
				const settle = (err, result) => {
					inFlightNow -= 1;
					cb(err, result);
				};
				if (index === 1) {
					setTimeout(() => settle('error-from-item-1'), 30);
					return;
				}
				if (index === 2) {
					setTimeout(() => settle('error-from-item-2'), 10);
					return;
				}
				setTimeout(() => settle('', index), 50);
			},
		},
		(err) => {
			callbackCount += 1;
			inFlightAtCallback = inFlightNow;
			harness.equal(
				'THE DETERMINISTIC ERROR: the LOWEST-index settled error wins, even though a higher-index error completed first on the clock',
				err,
				'error-from-item-1',
			);
			harness.equal('no NEW items launched after the first error (4 launched, 6 never started)', launchCount.n, 4);
			harness.equal('the callback waited for every in-flight item to settle (0 in flight at callback)', inFlightAtCallback, 0);
			// give any misbehaving extra callback a beat to arrive before asserting exactly-once
			setTimeout(() => {
				harness.equal('the final callback fired exactly ONCE', callbackCount, 1);
				sectionDone();
			}, 80);
		},
	);
};

// SECTION 5 — concurrencyLimit=1 degenerates to strict serial -------------------------------------
const runSerialDegeneration = (sectionDone) => {
	harness.section('SECTION 5 — concurrencyLimit=1 degenerates to strict serial');

	const events = [];
	boundedRunner(
		{
			items: [0, 1, 2, 3, 4],
			concurrencyLimit: 1,
			oneItem: (oneItem, index, cb) => {
				events.push(`start-${index}`);
				setTimeout(() => {
					events.push(`end-${index}`);
					cb('', index);
				}, 3);
			},
		},
		(err, out) => {
			harness.equal('the run completes with no error', err, '');
			harness.equal(
				'events interleave strictly serially (start-i+1 only ever after end-i)',
				JSON.stringify(events),
				JSON.stringify(['start-0', 'end-0', 'start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3', 'start-4', 'end-4']),
			);
			harness.equal('results in item order', JSON.stringify(out.results), JSON.stringify([0, 1, 2, 3, 4]));
			sectionDone();
		},
	);
};

// SECTION 6 — stack safety, empty items, double-callback guard ------------------------------------
const runEdgeCases = (sectionDone) => {
	harness.section('SECTION 6 — STACK SAFETY (20,000 sync items), empty items, double-callback guard');

	// 20,000 fully-synchronous items — the SIF-scale case. A recursive dispatcher would blow the
	// stack here; the iterative latch must not.
	let syncObserved = null;
	boundedRunner(
		{
			items: Array.from({ length: 20000 }, (ignore, i) => i),
			concurrencyLimit: 8,
			oneItem: (oneItem, index, cb) => cb('', index * 2),
		},
		(err, out) => {
			syncObserved = { err, out };
		},
	);
	harness.ok('20,000 synchronous items complete (iterative dispatch, no stack overflow)', !!syncObserved && syncObserved.err === '', syncObserved && syncObserved.err);
	harness.equal('  first and last results are in item order', `${syncObserved.out.results[0]},${syncObserved.out.results[19999]}`, '0,39998');
	harness.equal('  every slot is filled', syncObserved.out.results.filter((r) => r === undefined).length, 0);

	// empty items — success with an empty results array, immediately.
	let emptyObserved = null;
	boundedRunner({ items: [], concurrencyLimit: 8, oneItem: (i, x, cb) => cb('', i) }, (err, out) => {
		emptyObserved = { err, out };
	});
	harness.ok('empty items succeeds with an empty results array', !!emptyObserved && emptyObserved.err === '' && emptyObserved.out.results.length === 0);

	// double-callback guard — an item that calls back twice must not corrupt the accounting.
	let guardCallbackCount = 0;
	boundedRunner(
		{
			items: [0, 1],
			concurrencyLimit: 2,
			oneItem: (oneItem, index, cb) => {
				cb('', `ok-${index}`);
				cb('rogue second callback', 'must-be-ignored');
			},
		},
		(err, out) => {
			guardCallbackCount += 1;
			harness.equal('a rogue double-callback item still yields a clean run (second delivery ignored)', err, '');
			harness.equal('  results are the FIRST deliveries', JSON.stringify(out.results), JSON.stringify(['ok-0', 'ok-1']));
		},
	);
	setTimeout(() => {
		harness.equal('the final callback fired exactly once despite the rogue item', guardCallbackCount, 1);
		sectionDone();
	}, 20);
};

// =====================================================================
// RUN the async sections in sequence, then report.
// =====================================================================
runOrderPreservation(() =>
	runConcurrencyCeiling(() =>
		runErrorShortCircuit(() =>
			runSerialDegeneration(() =>
				runEdgeCases(() => {
					harness.report();
				}),
			),
		),
	),
);
