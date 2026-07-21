'use strict';

// harness.js — the shared assertion harness for the educoreForge tree.
//
//   const harness = require('<...>/test/testLib/harness')('test-recipe');
//   harness.section('LAYER 1 — structural');
//   harness.ok(label, condition, detail);
//   harness.equal(label, actual, expected);
//   harness.match(label, text, regex);
//   harness.accepts(label, errors);                 // expects NO errors
//   harness.rejects(label, errors, regex);          // expects errors AND a SPECIFIC one
//   harness.doesNotThrow(label, fn);
//   harness.note(text);                             // a declared gap, never silent
//   harness.report();                               // prints tally, exits 0/1
//
// DOCTRINE (why rejects() takes a regex and will not accept anything less):
// a gate that has never been observed failing is unproven, and a fixture that fails for the
// WRONG reason is a false green wearing a red coat. Every negative assertion must name the
// specific error it expects, so a rejection caused by an unrelated defect FAILS the test
// rather than silently confirming it. This is the expectFail-masking trap that has bitten
// this project before; the harness refuses to make it available.
//
// OUTPUT CHANNELS (qtools discipline — the harness logs through process.global.xLog):
//   passing assertions .... xLog.verbose  — diagnostic detail, shown only with -verbose
//   section headers ....... xLog.status   — progress
//   failures .............. xLog.error    — always shown, never suppressed by quiet
//   the final tally ....... xLog.result   — the answer
// A quiet green run says so in one line; a red run says exactly what broke without a re-run.
// All of it lands on STDOUT: testAppStartup calls xLog.logToStdOut() because a test app's report
// is its product, not progress chatter alongside some other payload. See that module for why.

const makeHarness = (suiteName) => {
	const xLog = process.global.xLog;
	const failures = [];
	let passCount = 0;

	const pass = (label) => {
		passCount += 1;
		xLog.verbose(`  ok   ${label}`);
	};

	const fail = (label, detail) => {
		failures.push({ label, detail });
		xLog.error(`  FAIL ${label}`);
		if (detail) {
			xLog.error(`       ${String(detail).split('\n').join('\n       ')}`);
		}
	};

	const section = (title) => {
		xLog.status(`\n${title}`);
	};

	// a gap we are choosing to leave open. Declared out loud so it cannot read as coverage.
	const note = (text) => {
		xLog.status(`  --   ${String(text).split('\n').join('\n       ')}`);
	};

	const ok = (label, condition, detail) => {
		if (condition) {
			pass(label);
			return;
		}
		fail(label, detail);
	};

	const equal = (label, actual, expected) => {
		ok(
			label,
			actual === expected,
			actual === expected
				? ''
				: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
	};

	const match = (label, text, regex) => {
		const subject = String(text == null ? '' : text);
		ok(
			label,
			regex.test(subject),
			regex.test(subject) ? '' : `expected to match ${regex}\nactual: ${subject.slice(0, 400)}`,
		);
	};

	// expects a CLEAN result — no errors at all. Prints every stray error when it fails, so a
	// green-turned-red says WHY without a second run.
	const accepts = (label, errors) => {
		const list = Array.isArray(errors) ? errors : [];
		ok(label, list.length === 0, list.length ? `unexpected errors:\n- ${list.join('\n- ')}` : '');
	};

	// expects a rejection AND the SPECIFIC reason. Two distinct failure modes are reported
	// differently on purpose: "did not reject at all" is a missing gate; "rejected for the wrong
	// reason" is a misleading gate. Both are failures.
	const rejects = (label, errors, regex) => {
		const list = Array.isArray(errors) ? errors : [];
		if (!list.length) {
			fail(label, `expected a rejection matching ${regex}, but there were NO errors`);
			return;
		}
		if (!list.some((e) => regex.test(String(e)))) {
			fail(
				label,
				`rejected, but for the WRONG reason — no error matched ${regex}\nactual errors:\n- ${list.join(
					'\n- ',
				)}`,
			);
			return;
		}
		pass(label);
	};

	const doesNotThrow = (label, fn) => {
		let thrown = null;
		try {
			fn();
		} catch (error) {
			thrown = error;
		}
		ok(label, thrown === null, thrown ? `threw: ${thrown.message}` : '');
	};

	const report = () => {
		const total = passCount + failures.length;
		if (failures.length) {
			xLog.error(`\n${suiteName}: FAILURES`);
			failures.forEach((f) => xLog.error(`  - ${f.label}`));
		}
		// xLog.result writes with process.stdout.write and adds NO newline (code fact,
		// qtools-x-log) — the caller owns line termination so results stay pipe-composable.
		xLog.result(
			`${suiteName}: ${passCount}/${total} passed, ${failures.length} failed.\n`,
		);
		process.exit(failures.length ? 1 : 0);
	};

	xLog.status(suiteName);
	return { section, note, ok, equal, match, accepts, rejects, doesNotThrow, report };
};

module.exports = makeHarness;
