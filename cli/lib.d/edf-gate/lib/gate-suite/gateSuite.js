'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// gateSuite.js — the cumulative gate-suite runner (Phase 0, deliverable 4; gate doctrine G7).
//
// "Run the suite" is the single source of pass/fail. Gates are CODE, NAMED, and CUMULATIVE: each is a
// self-registering descriptor in gates.d/ exporting { name, phase, kind, expectFail, run(ctx, cb) }.
// kind ∈ positive | twin | regression | health. expectFail=true marks a gate that is registered now
// but only passes once a LATER phase lands (the Appendix-B equivalence cases) — its failure today is
// EXPECTED and tracked, not a red.
//
// Verdict: GREEN iff every non-expectFail gate PASSED. An expectFail gate that fails is XFAIL (fine);
// one that unexpectedly passes is UPASS (surfaced, not a failure — it means a later phase's behavior
// arrived early). A non-expectFail gate that fails is the only thing that turns the suite RED.
//
// Discovery is config-free auto-discovery of gates.d/*.js (the .d/ registry pattern — no switch, no
// hardcoded gate list). Gates run SEQUENTIALLY (several touch docker/Neo4j; serial keeps resource use
// sane and output readable).
//
// Async style: qtools taskListPlus/pipeRunner. No async/await, no try/catch for control flow. camelCase.
//
// @concept: [[GateSuite]]
// @concept: [[CumulativeGating]]
// @concept: [[FaultInjectionTwin]]

const path = require('path');
const fs = require('fs');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const GATES_DIR = path.join(__dirname, '..', '..', 'gates.d');

const moduleFunction = ({ moduleName } = {}) => () => {
	const { xLog } = process.global;

	// discoverGates() -> [descriptor]. Each gates.d/*.js exports a factory () -> descriptor.
	const discoverGates = () => {
		if (!fs.existsSync(GATES_DIR)) {
			return [];
		}
		return fs
			.readdirSync(GATES_DIR)
			.filter((name) => name.endsWith('.js'))
			.sort()
			.map((name) => {
				const factory = require(path.join(GATES_DIR, name));
				const descriptor = factory();
				descriptor.sourceFile = name;
				return descriptor;
			});
	};

	// classify a single gate result into a verdict token.
	const classify = (descriptor, passed) => {
		if (descriptor.expectFail) {
			return passed ? 'UPASS' : 'XFAIL';
		}
		return passed ? 'PASS' : 'FAIL';
	};

	// runSuite({ctx, phaseFilter?}, cb) -> { green, results, summary }
	const runSuite = ({ ctx, phaseFilter } = {}, callback) => {
		const allGates = discoverGates();
		const gates = phaseFilter
			? allGates.filter((g) => g.phase === phaseFilter)
			: allGates;

		const results = [];
		const taskList = new taskListPlus();

		gates.forEach((descriptor) => {
			taskList.push((args, next) => {
				xLog.status(`[gateSuite] running ${descriptor.name} (${descriptor.kind}${descriptor.expectFail ? ', expect-fail' : ''})…`);
				descriptor.run(ctx, (err, outcome) => {
					// a gate that ERRORS counts as not-passed with the error captured. We never let a
					// single gate throw down the whole suite — explicit local handling (no try/catch).
					const passed = !err && outcome && outcome.passed;
					const verdict = classify(descriptor, passed);
					results.push({
						name: descriptor.name,
						phase: descriptor.phase,
						kind: descriptor.kind,
						expectFail: !!descriptor.expectFail,
						verdict,
						passed: !!passed,
						detail: err ? `error: ${err}` : (outcome && outcome.detail) || '',
					});
					xLog.status(`[gateSuite]   -> ${verdict}: ${descriptor.name}`);
					next('', args);
				});
			});
		});

		pipeRunner(taskList.getList(), {}, (err) => {
			if (err) {
				callback(err);
				return;
			}
			const realFailures = results.filter(
				(r) => !r.expectFail && !r.passed,
			);
			const xfail = results.filter((r) => r.verdict === 'XFAIL');
			const upass = results.filter((r) => r.verdict === 'UPASS');
			const green = realFailures.length === 0;
			const summary = {
				total: results.length,
				passed: results.filter((r) => r.verdict === 'PASS').length,
				realFailures: realFailures.length,
				expectedFailures: xfail.length,
				unexpectedPasses: upass.length,
			};
			callback('', { green, results, summary });
		});
	};

	return { runSuite, discoverGates };
};

module.exports = moduleFunction({ moduleName });
