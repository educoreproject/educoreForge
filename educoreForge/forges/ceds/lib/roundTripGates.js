'use strict';

// =====================================================================================
// roundTripGates — the gate HARNESS. It evaluates; the gates only declare.
// =====================================================================================
//
// ⟪TQ, 2026-08-02⟫ "Please enhance the spec with very thorough gates."
// Declarations: forges/ceds/gates/cedsFidelityGates.jsonc
// Spec:         zNotesPlansDocs/cedsHubEnrichment_080226/cedsForgeRevision-080226.md §9
//
// THE ONE STRUCTURAL IDEA. This project has twice shipped a gate that COMPUTED a signal
// and forgot to ASSERT it -- the Phase-3 review of 2026-06-30, and gate 23 in Phase 7. The
// remedy is not vigilance, it is arithmetic: a gate declares {measure, comparator,
// expected} and THIS module performs the comparison. A gate cannot forget a check it does
// not contain. Gate M-4 then asserts that every declaration actually carries a comparator,
// which closes the loop on the loop.
//
// WHAT THIS MODULE DOES NOT DO. It runs no Cypher, opens no file beyond its own
// declarations, and touches no graph. Measures arrive already resolved, as data. That is
// what makes the harness itself testable without Docker, and it is also the honest
// division: measuring is I/O, judging is arithmetic, and mixing them is how a gate ends up
// believing whatever the thing it measures tells it.
//
// TWINS INJECT AT THE MEASURE BOUNDARY. A twin's job is to prove THE GATE BITES, not to
// break the system. Corrupting a cloned measurement proves exactly that, hermetically. A
// gate whose twin has not been observed RED is reported UNPROVEN and can never be PASS.

const fs = require('fs');
const path = require('path');

const moduleName = path.basename(__filename).replace(/\.js$/, '');

const DEFAULT_DECLARATIONS_PATH = path.join(__dirname, '..', 'gates', 'cedsFidelityGates.jsonc');

// Required on every declaration. M-4 exists because this list is enforceable and a
// hand-written gate function is not.
const REQUIRED_GATE_KEYS = ['id', 'family', 'contract', 'measure', 'comparator', 'twin'];

const GATE_STATUS = {
	pass: 'PASS',
	fail: 'FAIL',
	unproven: 'UNPROVEN',
	unmeasured: 'UNMEASURED',
};

const roundTripGates = () => {
	// =================================================================================
	// stripJsonComments — a REAL scanner, not a regex
	// =================================================================================
	// The declarations carry predicate URIs as object KEYS: "http://purl.org/dc/..." . A
	// naive //-stripping regex eats every one of them and turns the file into rubble that
	// still parses, which is the worst available outcome. This walks the text in string
	// state so a // inside a quoted value is untouchable.
	const stripJsonComments = (text) => {
		const characters = String(text);
		let output = '';
		let index = 0;
		let inString = false;
		let inLineComment = false;
		let inBlockComment = false;

		while (index < characters.length) {
			const current = characters[index];
			const next = characters[index + 1];

			if (inLineComment) {
				if (current === '\n') {
					inLineComment = false;
					output += current;
				}
				index += 1;
				continue;
			}
			if (inBlockComment) {
				if (current === '*' && next === '/') {
					inBlockComment = false;
					index += 2;
					continue;
				}
				index += 1;
				continue;
			}
			if (inString) {
				output += current;
				if (current === '\\') {
					output += next === undefined ? '' : next;
					index += 2;
					continue;
				}
				if (current === '"') {
					inString = false;
				}
				index += 1;
				continue;
			}
			if (current === '"') {
				inString = true;
				output += current;
				index += 1;
				continue;
			}
			if (current === '/' && next === '/') {
				inLineComment = true;
				index += 2;
				continue;
			}
			if (current === '/' && next === '*') {
				inBlockComment = true;
				index += 2;
				continue;
			}
			output += current;
			index += 1;
		}
		return output;
	};

	// parseJsonOrFault — the callback-shaped parse the house style asks for. JSON.parse
	// throws synchronously and has no callback form, so the adapter lives here ONCE rather
	// than as a try/catch at every call site.
	const parseJsonOrFault = ({ text, sourceLabel }, callback) => {
		let parsed;
		let faultMessage = '';
		try {
			parsed = JSON.parse(text);
		} catch (parseError) {
			faultMessage = parseError.message;
		}
		if (faultMessage) {
			callback(`${moduleName}: '${sourceLabel}' is not parseable JSON: ${faultMessage}`);
			return;
		}
		callback('', { parsed });
	};

	// =================================================================================
	// loadGateDeclarations
	// =================================================================================
	const loadGateDeclarations = ({ filePath } = {}, callback) => {
		const resolvedPath = filePath || DEFAULT_DECLARATIONS_PATH;
		if (!fs.existsSync(resolvedPath)) {
			callback(
				`${moduleName}.loadGateDeclarations: declarations '${resolvedPath}' does not exist. ` +
					`The suite is REFUSED rather than run empty -- an empty suite passes everything.`,
			);
			return;
		}
		parseJsonOrFault(
			{ text: stripJsonComments(fs.readFileSync(resolvedPath, 'utf8')), sourceLabel: resolvedPath },
			(parseError, parseResult) => {
				if (parseError) {
					callback(parseError);
					return;
				}
				const declarations = parseResult.parsed;
				if (!declarations || !Array.isArray(declarations.gates) || !declarations.gates.length) {
					callback(
						`${moduleName}.loadGateDeclarations: '${resolvedPath}' declares no gates. REFUSED: ` +
							`a suite with no gates reports GREEN and means nothing.`,
					);
					return;
				}
				const malformed = [];
				const seenIds = {};
				declarations.gates.forEach((oneGate, oneIndex) => {
					REQUIRED_GATE_KEYS.forEach((oneKey) => {
						if (oneGate[oneKey] === undefined || oneGate[oneKey] === '') {
							malformed.push(`gate at index ${oneIndex}: missing '${oneKey}'`);
						}
					});
					if (oneGate.expected === undefined) {
						malformed.push(`gate '${oneGate.id}': missing 'expected'`);
					}
					if (seenIds[oneGate.id]) {
						malformed.push(`duplicate gate id '${oneGate.id}'`);
					}
					seenIds[oneGate.id] = true;
				});
				if (malformed.length) {
					callback(
						`${moduleName}.loadGateDeclarations: REFUSED, ${malformed.length} malformed ` +
							`declaration(s): ${malformed.join('; ')}`,
					);
					return;
				}
				callback('', { declarations, declarationsPath: resolvedPath });
			},
		);
	};

	// =================================================================================
	// comparators — the entire judging vocabulary, in one place
	// =================================================================================
	// Each returns { passed, detail }. A comparator NEVER throws and never guesses: an
	// unusable measure is a FAILED comparison with a named reason, not a silent false.
	const comparators = {
		equals: ({ actual, expected }) => ({
			passed: actual === expected,
			detail: `actual ${JSON.stringify(actual)} vs expected ${JSON.stringify(expected)}`,
		}),
		notEquals: ({ actual, expected }) => ({
			passed: actual !== expected,
			detail: `actual ${JSON.stringify(actual)} must differ from ${JSON.stringify(expected)}`,
		}),
		atLeast: ({ actual, expected }) => ({
			passed: typeof actual === 'number' && actual >= expected,
			detail: `actual ${JSON.stringify(actual)} >= ${JSON.stringify(expected)}`,
		}),
		atMost: ({ actual, expected }) => ({
			passed: typeof actual === 'number' && actual <= expected,
			detail: `actual ${JSON.stringify(actual)} <= ${JSON.stringify(expected)}`,
		}),
		isEmpty: ({ actual }) => {
			const length = Array.isArray(actual)
				? actual.length
				: actual && typeof actual === 'object'
					? Object.keys(actual).length
					: actual
						? 1
						: 0;
			return { passed: length === 0, detail: `length ${length}, expected 0` };
		},
		setEquals: ({ actual }) => {
			// The measure itself reports { equal, onlyInLeft, onlyInRight } -- set arithmetic
			// belongs with the thing that knows what the sets ARE.
			const value = actual || {};
			return {
				passed: value.equal === true,
				detail: value.equal
					? 'sets identical'
					: `onlyInGraph [${(value.onlyInLeft || []).join(', ')}] ; ` +
						`onlyInDocumentation [${(value.onlyInRight || []).join(', ')}]`,
			};
		},
		mapEquals: ({ actual, expected }) => {
			const actualMap = actual || {};
			const mismatches = Object.keys(expected || {})
				.filter((oneKey) => actualMap[oneKey] !== expected[oneKey])
				.map(
					(oneKey) =>
						`${oneKey}: actual ${JSON.stringify(actualMap[oneKey])} vs expected ${expected[oneKey]}`,
				);
			return {
				passed: mismatches.length === 0,
				detail: mismatches.length
					? `${mismatches.length} mismatch(es) -- ${mismatches.slice(0, 6).join(' | ')}`
					: `all ${Object.keys(expected || {}).length} entries match`,
			};
		},
	};

	// =================================================================================
	// resolveMeasure — read a declared measure out of the supplied measurement bundle
	// =================================================================================
	// report.<dotted.path>  a value in the round-trip report
	// report:<name>         a derived measure the caller computed from the report
	// graph:<name>          a read-only Cypher measure
	// probe:<name>          a hermetic runtime probe
	// suite:<name>          a measure of the suite itself
	//
	// A measure that was never supplied is UNMEASURED, which is a FAILURE mode, not a skip.
	// Gate M-2 forbids skipping, and a gate quietly passing because nobody measured it is
	// precisely the shape of the bug this suite exists to prevent.
	const resolveMeasure = ({ measure, measurements }) => {
		const bundle = measurements || {};
		const dottedRead = (root, dottedPath) =>
			String(dottedPath)
				.split('.')
				.reduce(
					(soFar, oneKey) =>
						soFar === undefined || soFar === null ? undefined : soFar[oneKey],
					root,
				);

		if (measure.indexOf('report.') === 0) {
			return { present: true, value: dottedRead(bundle.report, measure.slice('report.'.length)) };
		}
		const separatorIndex = measure.indexOf(':');
		if (separatorIndex < 1) {
			return { present: false, reason: `measure '${measure}' names no kind` };
		}
		const kind = measure.slice(0, separatorIndex);
		const name = measure.slice(separatorIndex + 1);
		const kindBundle = bundle[kind];
		if (!kindBundle || !Object.prototype.hasOwnProperty.call(kindBundle, name)) {
			return { present: false, reason: `no '${kind}' measure named '${name}' was supplied` };
		}
		return { present: true, value: kindBundle[name] };
	};

	// =================================================================================
	// evaluateGate — one gate, one verdict
	// =================================================================================
	const evaluateGate = ({ gate, measurements, observedTwins }) => {
		const comparator = comparators[gate.comparator];
		if (!comparator) {
			return {
				id: gate.id,
				family: gate.family,
				contract: gate.contract,
				status: GATE_STATUS.fail,
				detail: `unknown comparator '${gate.comparator}'`,
				twinObserved: false,
			};
		}
		const resolved = resolveMeasure({ measure: gate.measure, measurements });
		if (!resolved.present) {
			return {
				id: gate.id,
				family: gate.family,
				contract: gate.contract,
				status: GATE_STATUS.unmeasured,
				detail: resolved.reason,
				twinObserved: !!(observedTwins || {})[gate.id],
			};
		}
		const outcome = comparator({ actual: resolved.value, expected: gate.expected });
		const twinObserved = !!(observedTwins || {})[gate.id];
		const status = !outcome.passed
			? GATE_STATUS.fail
			: twinObserved
				? GATE_STATUS.pass
				: GATE_STATUS.unproven;
		return {
			id: gate.id,
			family: gate.family,
			contract: gate.contract,
			note: gate.note || '',
			measure: gate.measure,
			comparator: gate.comparator,
			status,
			detail: outcome.detail,
			twin: gate.twin,
			twinObserved,
		};
	};

	// =================================================================================
	// evaluateSuite
	// =================================================================================
	// observedTwins is { gateId: true } for every twin that has been RUN and SEEN to turn
	// its gate RED. Passing the comparison is not enough to PASS: an unproven gate is a
	// gate nobody has watched fail, and this project has shipped several of those.
	const evaluateSuite = ({ declarations, measurements, observedTwins } = {}, callback) => {
		if (!declarations || !Array.isArray(declarations.gates)) {
			callback(`${moduleName}.evaluateSuite: declarations are REQUIRED and have no default.`);
			return;
		}
		const gateResults = declarations.gates.map((oneGate) =>
			evaluateGate({ gate: oneGate, measurements, observedTwins }),
		);

		const countOf = (status) => gateResults.filter((oneResult) => oneResult.status === status).length;
		const failed = countOf(GATE_STATUS.fail);
		const unmeasured = countOf(GATE_STATUS.unmeasured);
		const unproven = countOf(GATE_STATUS.unproven);
		const passed = countOf(GATE_STATUS.pass);

		const byFamily = {};
		gateResults.forEach((oneResult) => {
			byFamily[oneResult.family] = byFamily[oneResult.family] || { total: 0, passed: 0 };
			byFamily[oneResult.family].total += 1;
			if (oneResult.status === GATE_STATUS.pass) {
				byFamily[oneResult.family].passed += 1;
			}
		});

		callback('', {
			suiteResult: {
				suiteName: declarations.suiteName || '',
				suiteVersion: declarations.suiteVersion || '',
				acceptanceRule: declarations.acceptanceRule || '',
				total: gateResults.length,
				passed,
				failed,
				unmeasured,
				unproven,
				// ACCEPTANCE. Not a percentage, not a majority, not "mostly green".
				accepted: failed === 0 && unmeasured === 0 && unproven === 0,
				byFamily,
				gates: gateResults,
			},
		});
	};

	// =================================================================================
	// runTwins — prove each gate BITES
	// =================================================================================
	// twinRegistry maps twinName -> ({ measurements }) => mutatedMeasurements. Each twin
	// receives a DEEP CLONE and returns a corrupted copy; the harness re-evaluates that one
	// gate against the corruption and records the twin as observed ONLY if the gate turned
	// RED. A twin that leaves its gate green is a defect IN THE GATE, and is reported as
	// such rather than quietly counted.
	const runTwins = ({ declarations, measurements, twinRegistry } = {}, callback) => {
		if (!declarations || !Array.isArray(declarations.gates)) {
			callback(`${moduleName}.runTwins: declarations are REQUIRED and have no default.`);
			return;
		}
		const registry = twinRegistry || {};
		const observedTwins = {};
		const twinReports = [];

		declarations.gates.forEach((oneGate) => {
			const twinFunction = registry[oneGate.twin];
			if (typeof twinFunction !== 'function') {
				twinReports.push({
					gateId: oneGate.id,
					twin: oneGate.twin,
					ran: false,
					gateWentRed: false,
					note: `no twin implementation registered under '${oneGate.twin}'`,
				});
				return;
			}
			const corrupted = twinFunction({
				measurements: JSON.parse(JSON.stringify(measurements || {})),
				gate: oneGate,
			});
			const underTwin = evaluateGate({
				gate: oneGate,
				measurements: corrupted,
				observedTwins: { [oneGate.id]: true },
			});
			const gateWentRed =
				underTwin.status === GATE_STATUS.fail || underTwin.status === GATE_STATUS.unmeasured;
			if (gateWentRed) {
				observedTwins[oneGate.id] = true;
			}
			twinReports.push({
				gateId: oneGate.id,
				twin: oneGate.twin,
				ran: true,
				gateWentRed,
				note: gateWentRed
					? `gate correctly went ${underTwin.status} under its twin`
					: `DEFECT IN THE GATE: it stayed ${underTwin.status} while its twin corrupted the measure`,
			});
		});

		callback('', { observedTwins, twinReports });
	};

	// =================================================================================
	// renderSuiteText
	// =================================================================================
	const renderSuiteText = ({ suiteResult, twinReports } = {}, callback) => {
		if (!suiteResult) {
			callback(`${moduleName}.renderSuiteText: suiteResult is REQUIRED and has no default.`);
			return;
		}
		const padRight = (value, width) => `${value}`.padEnd(width, ' ');
		const lines = [];
		lines.push('='.repeat(96));
		lines.push(`CEDS FIDELITY GATES — ${suiteResult.suiteName} v${suiteResult.suiteVersion}`);
		lines.push('='.repeat(96));
		lines.push(`  acceptance: ${suiteResult.acceptanceRule}`);
		lines.push('');
		lines.push(
			`  ${suiteResult.total} gates: ${suiteResult.passed} PASS, ${suiteResult.failed} FAIL, ` +
				`${suiteResult.unmeasured} UNMEASURED, ${suiteResult.unproven} UNPROVEN`,
		);
		lines.push('');
		lines.push(`  VERDICT: ${suiteResult.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'}`);
		if (!suiteResult.accepted) {
			lines.push('');
			lines.push('  A red suite during enrichment is CORRECT. Its redness is the work order.');
			lines.push('  UNPROVEN means the gate passed but nobody has watched it fail.');
			lines.push('  UNMEASURED means nobody supplied the measure -- which is a failure, not a skip.');
		}
		lines.push('');
		lines.push('-'.repeat(96));
		lines.push(`  ${padRight('GATE', 7)}${padRight('STATUS', 12)}${padRight('TWIN', 9)}CONTRACT`);
		lines.push('-'.repeat(96));
		suiteResult.gates.forEach((oneGate) => {
			lines.push(
				`  ${padRight(oneGate.id, 7)}${padRight(oneGate.status, 12)}` +
					`${padRight(oneGate.twinObserved ? 'observed' : 'unrun', 9)}${oneGate.contract}`,
			);
			if (oneGate.status !== GATE_STATUS.pass) {
				lines.push(`  ${' '.repeat(28)}-> ${oneGate.detail}`);
			}
		});
		lines.push('');

		const gateDefects = (twinReports || []).filter((oneReport) => oneReport.ran && !oneReport.gateWentRed);
		if (gateDefects.length) {
			lines.push('-'.repeat(96));
			lines.push('DEFECTIVE GATES — these stayed green while their twin corrupted the measure');
			lines.push('-'.repeat(96));
			gateDefects.forEach((oneReport) => {
				lines.push(`  ${padRight(oneReport.gateId, 7)}twin '${oneReport.twin}': ${oneReport.note}`);
			});
			lines.push('');
		}
		callback('', { text: lines.join('\n') });
	};

	return {
		loadGateDeclarations,
		evaluateSuite,
		evaluateGate,
		runTwins,
		renderSuiteText,
		stripJsonComments,
		comparators,
		GATE_STATUS,
		DEFAULT_DECLARATIONS_PATH,
	};
};

module.exports = roundTripGates;
