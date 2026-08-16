'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// boundedRunner.js — index-collecting bounded concurrency (SPEC-bridgeFramework-v1.md §7.3; BR-072):
// judgments are dispatched with a bounded runner that COLLECTS BY INDEX in subject order, so completion
// order can never reach the frozen text. A synchronous item is dispatched iteratively (a latch turns
// would-be recursion into a loop — the house lesson from the 2026-08-03 RangeError). Callback error-first.
//
//   runBounded({ itemList, concurrency, oneItem: (item, index, cb(errString, result)) }, cb(errString, resultList))
// The FIRST error stops dispatch and is reported; results collected so far are discarded (an error is fatal).

const runBounded = ({ itemList, concurrency, oneItem } = {}, callback) => {
	if (!Array.isArray(itemList)) {
		callback(`${moduleName} REFUSED: itemList must be an array`);
		return;
	}
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		callback(`${moduleName} REFUSED: concurrency must be a positive integer (got ${JSON.stringify(concurrency)})`);
		return;
	}
	if (typeof oneItem !== 'function') {
		callback(`${moduleName} REFUSED: oneItem must be a function (item, index, cb)`);
		return;
	}
	const resultList = new Array(itemList.length);
	let nextIndex = 0;
	let inFlight = 0;
	let settled = false;
	let dispatchLoopActive = false;
	const finish = (errString) => {
		if (settled) {
			return;
		}
		settled = true;
		callback(errString || '', errString ? undefined : resultList);
	};
	const dispatch = () => {
		if (dispatchLoopActive) {
			return;
		}
		dispatchLoopActive = true;
		while (!settled && inFlight < concurrency && nextIndex < itemList.length) {
			const thisIndex = nextIndex;
			nextIndex += 1;
			inFlight += 1;
			let calledBack = false;
			oneItem(itemList[thisIndex], thisIndex, (itemError, itemResult) => {
				if (calledBack) {
					return; // a double callback never advances the runner twice
				}
				calledBack = true;
				inFlight -= 1;
				if (itemError) {
					finish(itemError);
					return;
				}
				resultList[thisIndex] = itemResult;
				if (nextIndex >= itemList.length && inFlight === 0) {
					finish('');
					return;
				}
				dispatch();
			});
		}
		dispatchLoopActive = false;
		if (!settled && itemList.length === 0) {
			finish('');
		}
	};
	dispatch();
};

module.exports = { runBounded, moduleName };
