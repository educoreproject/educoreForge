'use strict';

// boundedRunner.js — the bounded-concurrency list dispatcher (p8-judgeConcurrency, 2026-07-30).
//
// WHY IT EXISTS: the evidence bridges' per-source judge loop (genericBridge.js /
// sifEvidenceBridge.js, REBRIDGE mode) ran STRICTLY SERIALLY — taskListPlus is serial by
// construction — and that made big standards infeasible: measured 2026-07-29 on the live SIF run,
// ~25 seconds per Opus judgment × 15,620 source elements ≈ 4.5 days of wall clock for one
// --rebridge. The per-source judgments are independent of one another (each composes, renders,
// selects, and normalizes for ONE source; nothing downstream is touched until ALL are done), so
// they may overlap — but the frozen decision block they feed is content-addressed and must stay
// BYTE-IDENTICAL to what the serial loop produced. This module supplies exactly that: bounded
// parallel launch, results collected BY INDEX, output order = item order, always.
//
//   boundedRunner({ items, concurrencyLimit, oneItem }, callback)
//     items            an array; each element is handed to oneItem untouched
//     concurrencyLimit a positive integer — at most this many oneItem calls in flight at once
//     oneItem          (item, index, callback(errString, result)) — R7 callback-shaped
//     callback         ('', { results }) on success; results[i] is oneItem's result for items[i],
//                      ALWAYS in ITEM ORDER regardless of completion order
//
// LAUNCH ORDER is item order (index 0 first, strictly ascending). COMPLETION order is whatever
// each item's own latency dictates; no result is ever keyed by completion order.
//
// ERROR SEMANTICS (deterministic, never a race winner): on any item error the runner STOPS
// LAUNCHING new items, lets the already-in-flight items settle, and calls back ONCE with a single
// error — the error belonging to the LOWEST item index among the settled errors. The same fault
// set therefore always reports the same error, however the completion timing shuffles.
//
// STACK SAFETY: a fully-synchronous oneItem (the hermetic-test case, and any degenerate pure item)
// is dispatched ITERATIVELY — the dispatchLoopActive latch below turns would-be recursion
// (launch -> sync settle -> launch ...) into one while loop, so 15,620 synchronous completions
// never build 15,620 stack frames. A concurrencyLimit of 1 degenerates to the exact serial
// behavior the taskListPlus loop had.
//
// DOUBLE-CALLBACK GUARD: an item that calls its callback twice (a defect in the item, not here)
// has its second delivery ignored — the accounting (inFlightCount/settledCount) must never be
// corrupted by a misbehaving item into firing the final callback early or twice.
//
// Pure orchestration: no dependencies beyond the language, no timers of its own, no state outside
// one call. House style: qtools curried moduleFunction; callback(errString, result) with '' on
// success; no async/await, no try/catch control flow; refuse-by-name on malformed input
// (polyArch2 §6). R7 (⟪TQ RULING, 2026-07-29⟫, evidenceContracts.js): callback-shaped throughout.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ items, concurrencyLimit, oneItem } = {}, callback) => {
		if (typeof callback !== 'function') {
			// R7: every public callable takes a callback — with no callback there is nowhere to
			// deliver even a refusal, so this ONE fault throws by name instead.
			throw new Error(
				`${moduleName}: callback is not a function — there is nowhere to deliver a result; there is no default.`,
			);
		}
		if (!Array.isArray(items)) {
			callback(`${moduleName}: items is not an array (got ${typeof items}) — there is no default.`);
			return;
		}
		if (!Number.isInteger(concurrencyLimit) || concurrencyLimit < 1) {
			callback(
				`${moduleName}: concurrencyLimit is ${JSON.stringify(
					concurrencyLimit,
				)} — it must be a positive integer; there is no default.`,
			);
			return;
		}
		if (typeof oneItem !== 'function') {
			callback(`${moduleName}: oneItem is not a function (got ${typeof oneItem}) — there is no default.`);
			return;
		}

		const results = new Array(items.length);
		let nextIndex = 0; // the next item index to launch — advances in strict item order
		let inFlightCount = 0;
		let settledCount = 0;
		let lowestErrorIndex = -1; // -1 == no error settled yet
		let lowestErrorValue = '';
		let callbackHasFired = false;
		let dispatchLoopActive = false; // the sync-reentrancy latch (see STACK SAFETY above)

		const maybeFinish = () => {
			if (callbackHasFired || inFlightCount > 0) {
				return;
			}
			if (lowestErrorIndex >= 0) {
				callbackHasFired = true;
				callback(lowestErrorValue);
				return;
			}
			if (settledCount === items.length) {
				callbackHasFired = true;
				callback('', { results });
			}
		};

		const settleOne = (settledIndex, itemError, itemResult) => {
			inFlightCount -= 1;
			settledCount += 1;
			if (itemError) {
				// first error wins deterministically: the LOWEST index among settled errors, never
				// whichever error happened to complete first on the clock.
				if (lowestErrorIndex < 0 || settledIndex < lowestErrorIndex) {
					lowestErrorIndex = settledIndex;
					lowestErrorValue = itemError;
				}
			} else {
				results[settledIndex] = itemResult;
			}
			if (dispatchLoopActive) {
				// a synchronous settle inside the launch loop — the loop itself continues launching
				// (or stops, if this settle recorded an error) and runs maybeFinish at its own tail.
				return;
			}
			dispatch();
		};

		const dispatch = () => {
			dispatchLoopActive = true;
			while (
				!callbackHasFired &&
				lowestErrorIndex < 0 && // an error stops LAUNCHING; in-flight items still settle
				nextIndex < items.length &&
				inFlightCount < concurrencyLimit
			) {
				const thisIndex = nextIndex;
				nextIndex += 1;
				inFlightCount += 1;
				let alreadySettled = false;
				oneItem(items[thisIndex], thisIndex, (itemError, itemResult) => {
					if (alreadySettled) {
						return; // double-callback guard — a misbehaving item must not corrupt the accounting
					}
					alreadySettled = true;
					settleOne(thisIndex, itemError, itemResult);
				});
			}
			dispatchLoopActive = false;
			maybeFinish();
		};

		dispatch();
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
