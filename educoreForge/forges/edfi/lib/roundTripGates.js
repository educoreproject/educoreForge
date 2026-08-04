'use strict';

// roundTripGates.js (forge-edfi) — the gate HARNESS for gates/edfiRoundTripGates.jsonc.
//
// A gate is { id, title, measure, comparator, expected?, twin } — DATA (RT-10; the CEDS lesson,
// twice learned: a gate written as data cannot compute a signal and forget to assert it — the
// assertion lives here, once).
//
// States: PASS | FAIL | UNMEASURED. UNMEASURED (the dotted path resolves to undefined) is a
// FAILURE, never a skip. UNPROVEN (twin never observed RED) is judged by judgeSuite, which
// refuses acceptance while any gate is unproven. No expectFail gates exist and none may be
// registered.
//
// Pure, callback-shaped (R7), no network I/O. Registry over switch throughout.

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

const moduleFunction = () => {
	const resolveDottedPath = (rootObject, dottedPath) =>
		String(dottedPath)
			.split('.')
			.reduce(
				(resolvedSoFar, oneName) =>
					resolvedSoFar && typeof resolvedSoFar === 'object' ? resolvedSoFar[oneName] : undefined,
				rootObject,
			);

	// loadGateDeclarations — read the jsonc (comments stripped; the strip is grammar, the gates
	// are the data).
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
		const withoutComments = rawText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
		let declarations;
		let parseFault = '';
		try {
			declarations = JSON.parse(withoutComments);
		} catch (parseError) {
			parseFault = parseError.message;
		}
		if (parseFault) {
			callback(
				`${moduleName}.loadGateDeclarations: '${gatesFilePath}' failed to parse after comment strip: ${parseFault}`,
			);
			return;
		}
		if (!declarations || !Array.isArray(declarations.gates) || !declarations.gates.length) {
			callback(
				`${moduleName}.loadGateDeclarations: '${gatesFilePath}' declares no gates — an empty suite is a missing input, not a green one.`,
			);
			return;
		}
		const missingTwinList = declarations.gates.filter((oneGate) => !oneGate.twin);
		if (missingTwinList.length) {
			callback(
				`${moduleName}.loadGateDeclarations: gate(s) ${missingTwinList.map((oneGate) => oneGate.id).join(', ')} declare no twin — an untwinned gate is unprovable (RT-10).`,
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
					`${moduleName}.evaluateGates: gate '${oneGate.id}' names unknown comparator '${oneGate.comparator}'. Known: ${Object.keys(COMPARATOR_REGISTRY).join(', ')}. Refused rather than passed by default.`,
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
					: `measure '${oneGate.measure}' = ${JSON.stringify(measuredValue)}, comparator ${oneGate.comparator}${oneGate.expected !== undefined ? ` (expected ${JSON.stringify(oneGate.expected)})` : ''}`,
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

	// judgeSuite — acceptance is a WORD, never a percentage: zero FAIL, zero UNMEASURED, zero
	// UNPROVEN (a gate whose twin was never observed RED).
	const judgeSuite = ({ gateResults, twinRedByGateId } = {}, callback) => {
		if (!Array.isArray(gateResults)) {
			callback(`${moduleName}.judgeSuite: gateResults is REQUIRED.`);
			return;
		}
		const unprovenGateIds = gateResults
			.filter((oneResult) => !(twinRedByGateId || {})[oneResult.id])
			.map((oneResult) => oneResult.id);
		const failingGateResults = gateResults.filter((oneResult) => oneResult.state !== 'PASS');
		callback('', {
			accepted: failingGateResults.length === 0 && unprovenGateIds.length === 0,
			failingGateIds: failingGateResults.map((oneResult) => oneResult.id),
			unprovenGateIds,
		});
	};

	// countGatesUsingPercentInAcceptance — the structural G-percent measure: acceptance derives
	// from counts only; any gate judging a percent field of the verdict/report/probe data counts
	// here. 'suite.*' meta-measures are excluded — the meta-gate's own measure name necessarily
	// contains the word and must not count itself.
	const countGatesUsingPercentInAcceptance = ({ declarations }) =>
		declarations.gates.filter(
			(oneGate) => !oneGate.measure.startsWith('suite.') && /percent/i.test(oneGate.measure),
		).length;

	return {
		loadGateDeclarations,
		evaluateGates,
		judgeSuite,
		countGatesUsingPercentInAcceptance,
		COMPARATOR_REGISTRY,
	};
};

module.exports = moduleFunction;
