'use strict';

// roundTripGates.js (forge-sif) — the gate HARNESS for gates/sifRoundTripGates.jsonc. Bundle-local
// per R-SF-4 (no shared infrastructure); the shape is the pesc/CEDS-proven harness.
//
// A gate is { id, title, measure, comparator, expected?, twin } — DATA. This module resolves the
// measure out of the measurement bundle and ASSERTS it. The failure mode this design ends: a gate
// that computes a signal and forgets to assert it. Here the assertion lives in the harness, once.
//
// States: PASS | FAIL | UNMEASURED. UNMEASURED (the dotted path resolves to undefined) is a
// FAILURE, never a skip — a gate passing for want of measurement is the exact bug the suite
// exists to catch. UNPROVEN (twin never observed RED) is judged by the caller, which runs the
// twins; judgeSuite refuses acceptance while any gate is unproven.
//
// Pure, callback-shaped (R7), no I/O beyond reading the declarations file. Registry over switch
// throughout.

const fs = require('fs');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// comparator registry — an unknown comparator is a refusal by name, never a silent pass.
const COMPARATOR_REGISTRY = {
	isZero: ({ measuredValue }) => measuredValue === 0,
	isTrue: ({ measuredValue }) => measuredValue === true,
	equals: ({ measuredValue, expected }) => measuredValue === expected,
	atLeast: ({ measuredValue, expected }) =>
		typeof measuredValue === 'number' && measuredValue >= expected,
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		const resolveDottedPath = (root, dottedPath) =>
			String(dottedPath)
				.split('.')
				.reduce(
					(soFar, oneName) =>
						soFar && typeof soFar === 'object' ? soFar[oneName] : undefined,
					root,
				);

		// loadGateDeclarations — read the jsonc (line comments and block comments stripped; the
		// strip is grammar, the gates are the data).
		const loadGateDeclarations = ({ gatesFilePath } = {}, callback) => {
			if (typeof gatesFilePath !== 'string' || gatesFilePath.trim() === '') {
				callback(`${moduleName}.loadGateDeclarations: gatesFilePath is REQUIRED and has no default.`);
				return;
			}
			if (!fs.existsSync(gatesFilePath)) {
				callback(`${moduleName}.loadGateDeclarations: '${gatesFilePath}' does not exist.`);
				return;
			}
			const rawText = fs.readFileSync(gatesFilePath, 'utf8');
			const withoutComments = rawText
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/^\s*\/\/.*$/gm, '');
			let declarations;
			let parseFault = '';
			try {
				declarations = JSON.parse(withoutComments);
			} catch (parseError) {
				parseFault = parseError.message;
			}
			if (parseFault) {
				callback(
					`${moduleName}.loadGateDeclarations: '${gatesFilePath}' failed to parse after ` +
						`comment strip: ${parseFault}`,
				);
				return;
			}
			if (!declarations || !Array.isArray(declarations.gates) || !declarations.gates.length) {
				callback(
					`${moduleName}.loadGateDeclarations: '${gatesFilePath}' declares no gates — an ` +
						`empty suite is a missing input, not a green one.`,
				);
				return;
			}
			callback('', { declarations });
		};

		// evaluateGates — the whole assertion pass. callback('', { gateResults, tally })
		const evaluateGates = ({ declarations, measurements } = {}, callback) => {
			if (!declarations || !Array.isArray(declarations.gates)) {
				callback(`${moduleName}.evaluateGates: declarations.gates is REQUIRED.`);
				return;
			}
			if (!measurements || typeof measurements !== 'object') {
				callback(`${moduleName}.evaluateGates: measurements bundle is REQUIRED.`);
				return;
			}
			const gateResults = [];
			for (const oneGate of declarations.gates) {
				const comparator = COMPARATOR_REGISTRY[oneGate.comparator];
				if (!comparator) {
					callback(
						`${moduleName}.evaluateGates: gate '${oneGate.id}' names unknown comparator ` +
							`'${oneGate.comparator}'. Known: ${Object.keys(COMPARATOR_REGISTRY).join(', ')}. ` +
							`Refused rather than passed by default.`,
					);
					return;
				}
				const measuredValue = resolveDottedPath(measurements, oneGate.measure);
				if (measuredValue === undefined) {
					gateResults.push({
						id: oneGate.id,
						title: oneGate.title,
						state: 'UNMEASURED',
						detail: `measure '${oneGate.measure}' resolved to undefined — nobody supplied it`,
					});
					continue;
				}
				const passed = comparator({ measuredValue, expected: oneGate.expected });
				gateResults.push({
					id: oneGate.id,
					title: oneGate.title,
					state: passed ? 'PASS' : 'FAIL',
					detail: passed
						? ''
						: `measure '${oneGate.measure}' = ${JSON.stringify(measuredValue)}, comparator ` +
							`${oneGate.comparator}${oneGate.expected !== undefined ? ` (expected ${JSON.stringify(oneGate.expected)})` : ''}`,
				});
			}
			const tally = { pass: 0, fail: 0, unmeasured: 0 };
			gateResults.forEach((oneResult) => {
				if (oneResult.state === 'PASS') tally.pass += 1;
				else if (oneResult.state === 'FAIL') tally.fail += 1;
				else tally.unmeasured += 1;
			});
			callback('', { gateResults, tally });
		};

		// judgeSuite — the verdict is a WORD, never a percentage: acceptance is zero FAIL, zero
		// UNMEASURED, zero UNPROVEN (a gate whose twin was never observed RED).
		const judgeSuite = ({ gateResults, twinRedByGateId } = {}, callback) => {
			if (!Array.isArray(gateResults)) {
				callback(`${moduleName}.judgeSuite: gateResults is REQUIRED.`);
				return;
			}
			const unproven = gateResults
				.filter((oneResult) => !(twinRedByGateId || {})[oneResult.id])
				.map((oneResult) => oneResult.id);
			const failing = gateResults.filter((oneResult) => oneResult.state !== 'PASS');
			callback('', {
				accepted: failing.length === 0 && unproven.length === 0,
				failingGateIds: failing.map((oneResult) => oneResult.id),
				unprovenGateIds: unproven,
			});
		};

		return {
			loadGateDeclarations,
			evaluateGates,
			judgeSuite,
			COMPARATOR_REGISTRY,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
