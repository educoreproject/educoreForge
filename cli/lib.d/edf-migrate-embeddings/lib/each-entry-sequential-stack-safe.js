'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================
//
// each-entry-sequential-stack-safe — run an async worker over items ONE at a time, STACK-SAFE
// whether the worker's callback fires synchronously (sqlite-instance/better-sqlite3 IS
// synchronous) or asynchronously. This is the SAME verified trampoline as
// replay-engine.js:403 (which does not export it); it is replicated here rather than reached
// into, so this migration verb stays self-contained. The Phase-2 lesson that motivates it: a
// naive putOne(i+1)-from-the-callback recursion grows the JS stack by one frame per item under
// a synchronous store — thousands deep on a real standard (SIF ~27k distinct searchText) ->
// stack overflow. This trampoline LOOPS on synchronous completion instead of recursing, and
// re-enters on asynchronous completion.
//
// Async style (project doctrine): callback + error-first; NO async/await, NO try/catch for
// control flow. camelCase.

const moduleFunction =
	({ moduleName } = {}) =>
	(injectedDeps = {}) => {
		const eachEntrySequentialStackSafe = (items, worker, done) => {
			let index = 0;
			let running = false;
			let advanced = false;
			const iterate = () => {
				if (running) {
					advanced = true; // a synchronous completion re-entered — let the active loop continue
					return;
				}
				running = true;
				advanced = true;
				while (advanced) {
					advanced = false;
					if (index >= items.length) {
						running = false;
						done('');
						return;
					}
					const current = items[index];
					index++;
					worker(current, (err) => {
						if (err) {
							running = false;
							done(err);
							return;
						}
						if (running) {
							advanced = true; // synchronous callback: continue the while loop, no recursion
						} else {
							iterate(); // asynchronous callback: re-enter the driver
						}
					});
				}
				running = false;
			};
			iterate();
		};

		return { eachEntrySequentialStackSafe };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
